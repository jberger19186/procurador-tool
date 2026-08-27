"""
tests/daily/electron_driver.py — lanza el `.exe` instalado (confirmado mejor
que el lanzamiento desde código en el spike F0: verifica lo que corre el
usuario final, no una aproximación) y conecta Playwright por CDP.

No reusa `tests/conftest.py::electron_app` tal cual porque ese fixture lanza
`node_modules/.bin/electron.cmd` (desde código) — F0 concluyó explícitamente
que corresponde usar el `.exe` real acá. El patrón de auto-login sí se
inspira en el mismo fixture.

🚨 Usa la API ASYNC de Playwright (`playwright.async_api`), no la sync — un
primer intento con la sync API + `ThreadPoolExecutor` para el timeout de
`page.evaluate()` rompió con `greenlet.error: Cannot switch to a different
thread`: la sync API de Playwright está atada al hilo que abrió la conexión
(usa greenlets para simular sincronía sobre el protocolo async real), así que
NO admite invocarse desde un hilo worker distinto. `asyncio.wait_for()` sobre
la API async resuelve el timeout sin cruzar threads, que es justamente lo que
hace falta para no colgarse para siempre si un flujo real no responde.
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from playwright.async_api import Browser, Page, async_playwright

from daily.close_env import assert_no_instance_running
from daily.config import APP_EXE_PATH

DEBUG_PORT = 9222


def _esperar_cdp(port: int, intentos: int = 15) -> None:
    """Bloqueante a propósito — corre antes de tener loop de asyncio armado."""
    for _ in range(intentos):
        time.sleep(1)
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return
        except Exception:
            continue
    raise RuntimeError(f"CDP no respondió en el puerto {port} tras {intentos}s.")


async def _pagina_principal(browser: Browser) -> Page:
    for pg in browser.contexts[0].pages:
        if "login.html" not in pg.url:
            return pg
    return browser.contexts[0].pages[0]


async def _login_si_hace_falta(browser: Browser) -> Page:
    ctx = browser.contexts[0]
    login_page = None
    for pg in ctx.pages:
        if "login.html" in pg.url:
            login_page = pg
            break
    if not login_page:
        return await _pagina_principal(browser)

    # Ya logueado antes con "Recordar mis datos" -> el botón "Iniciar Sesión"
    # ya viene con la cuenta guardada precargada, no hace falta tipear nada
    # (mismo comportamiento verificado en la corrida manual del 2026-08-27).
    await login_page.wait_for_timeout(1500)
    boton = login_page.locator("button:has-text('Iniciar Sesión')")
    if await boton.count() == 0:
        raise RuntimeError(
            "La app quedó en login.html sin cuenta recordada disponible. "
            "Abrí la app una vez a mano, tildá 'Recordar mis datos' y logueate "
            "con la cuenta de verificación antes de correr F2."
        )
    async with ctx.expect_page(timeout=30_000) as nueva_pagina_info:
        await boton.first.click()
    dashboard = await nueva_pagina_info.value
    await dashboard.wait_for_load_state("domcontentloaded", timeout=20_000)
    await dashboard.wait_for_timeout(1500)
    return dashboard


async def launch_and_connect() -> tuple[subprocess.Popen, object, Browser, Page]:
    """
    Lanza el .exe real, conecta CDP, resuelve el login si hace falta.
    Devuelve (proceso, playwright_context, browser, page_principal).
    """
    assert_no_instance_running()

    proc = subprocess.Popen([APP_EXE_PATH, f"--remote-debugging-port={DEBUG_PORT}"])
    _esperar_cdp(DEBUG_PORT)

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{DEBUG_PORT}")
    page = await _login_si_hace_falta(browser)
    return proc, pw, browser, page


async def evaluar_con_timeout(page: Page, expr: str, arg=None, timeout_seg: float = 180.0):
    """
    `page.evaluate()` de Playwright no tiene timeout propio — espera a que la
    promesa resuelva sin límite. Un flujo real puede tardar minutos (el
    Monitor con reintentos), pero si algo se cuelga del todo, el script no
    debe quedar esperando para siempre.
    """
    try:
        return await asyncio.wait_for(page.evaluate(expr, arg), timeout=timeout_seg)
    except asyncio.TimeoutError:
        raise TimeoutError(f"Timeout de {timeout_seg}s esperando la respuesta de: {expr[:80]}...")


async def disconnect(pw) -> None:
    """Cierra la conexión CDP (NO cierra la app — eso es close_env.close_app())."""
    try:
        await pw.stop()
    except Exception:
        pass
