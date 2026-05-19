"""
conftest.py — Fixtures globales de la suite QA de Procurador SCW.

Fixtures disponibles:
  api_url         — URL base del backend
  user_token      — JWT de usuario activo (scope=session)
  admin_token     — JWT de admin (scope=session)
  api_session     — requests.Session con token de usuario y SSL desactivado
  admin_session   — requests.Session con token de admin
  browser         — instancia Playwright Chromium (scope=session)
  page            — página nueva por test (scope=function)
  logged_in_user_page   — página ya logueada como usuario
  logged_in_admin_page  — página ya logueada como admin
"""

import urllib3
import pytest
import requests
from playwright.sync_api import sync_playwright, Browser, Page, Playwright

from helpers.auth import get_user_token, get_admin_token, API_URL

# Silenciar warnings de SSL (usamos verify=False en tests)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ─── Constantes ────────────────────────────────────────────────────────────────
PORTAL_URL = f"{API_URL}/usuarios/"
DASHBOARD_URL = f"{API_URL}/dashboard/"
ELECTRON_APP_PATH = "C:/Users/JONATHAN/source/repos/ProcuradorTool/electron-app"

USER_EMAIL = "procuradortool@gmail.com"
USER_PASSWORD = "TestPass2025!"
ADMIN_EMAIL = "admin@procurador.com"
ADMIN_PASSWORD = "Admin2025!"


# ─── Fixtures de API ───────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def api_url() -> str:
    return API_URL


@pytest.fixture(scope="session")
def user_token() -> str:
    """JWT de usuario de prueba. Se obtiene una sola vez por sesión de pytest."""
    token = get_user_token()
    assert token, "No se pudo obtener token de usuario (login HTTP + SSH fallback fallaron)"
    return token


@pytest.fixture(scope="session")
def admin_token() -> str:
    """JWT de admin. Se obtiene una sola vez por sesión de pytest."""
    token = get_admin_token()
    assert token, "No se pudo obtener token de admin"
    return token


@pytest.fixture(scope="session")
def api_session(user_token: str) -> requests.Session:
    """Session de requests preconfigurada para usuario autenticado."""
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {user_token}"})
    s.verify = False
    return s


@pytest.fixture(scope="session")
def admin_session(admin_token: str) -> requests.Session:
    """Session de requests preconfigurada para admin autenticado."""
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}"})
    s.verify = False
    return s


# ─── Fixtures de Playwright — Browser ─────────────────────────────────────────
@pytest.fixture(scope="session")
def playwright_instance():
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="session")
def browser(playwright_instance: Playwright) -> Browser:
    """Instancia de Chromium compartida por todos los tests web."""
    b = playwright_instance.chromium.launch(
        headless=False,              # False = podés ver lo que hace; True para CI
        slow_mo=200,                 # 200ms entre acciones para debugging visual
        args=["--ignore-certificate-errors"],
    )
    yield b
    b.close()


@pytest.fixture(scope="function")
def page(browser: Browser) -> Page:
    """Página nueva por cada test (contexto limpio)."""
    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    yield p
    ctx.close()


# ─── Fixtures de Playwright — Portales con sesión ──────────────────────────────
@pytest.fixture(scope="function")
def logged_in_user_page(browser: Browser, user_token: str) -> Page:
    """
    Página del portal /usuarios/ ya logueada.
    Inyecta el token en localStorage tal como lo hace app.js.
    """
    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    p.goto(PORTAL_URL)
    # Inyectar token en localStorage (el mismo key que usa app.js)
    p.evaluate(f"""
        localStorage.setItem('psc_user_token', '{user_token}');
    """)
    p.reload()
    # Esperar a que cargue el dashboard — #app debe ser visible y #login-page oculto
    p.wait_for_function("document.getElementById('login-page') && document.getElementById('login-page').style.display !== 'flex'", timeout=10_000)
    p.wait_for_timeout(1_000)
    yield p
    ctx.close()


@pytest.fixture(scope="function")
def logged_in_admin_page(browser: Browser, admin_token: str) -> Page:
    """
    Página del panel admin /dashboard/ ya logueada.
    Inyecta el token en localStorage.
    """
    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    p.goto(DASHBOARD_URL)
    p.evaluate(f"""
        localStorage.setItem('admin_token', '{admin_token}');
    """)
    p.reload()
    # Esperar a que el dashboard admin cargue
    p.wait_for_function("document.getElementById('login-page') === null || (document.getElementById('login-page') && document.getElementById('login-page').style.display !== 'flex')", timeout=10_000)
    p.wait_for_timeout(1_500)
    yield p
    ctx.close()


# ─── Fixture de Playwright — Electron (via CDP) ───────────────────────────────
@pytest.fixture(scope="session")
def electron_app(playwright_instance: Playwright):
    """
    Lanza la app Electron con --remote-debugging-port y conecta Playwright vía CDP.
    La API playwright.electron no existe en Python — se usa chromium.connect_over_cdp().
    Requiere que electron esté instalado en node_modules del electron-app.
    """
    import os
    import subprocess
    import time

    electron_exe = os.path.join(ELECTRON_APP_PATH, "node_modules", ".bin", "electron.cmd")
    if not os.path.exists(electron_exe):
        pytest.skip("Electron no encontrado en node_modules — ejecutar npm install en electron-app/")

    DEBUG_PORT = 9222
    proc = subprocess.Popen(
        [electron_exe, ELECTRON_APP_PATH, f"--remote-debugging-port={DEBUG_PORT}"],
        cwd=ELECTRON_APP_PATH,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Esperar hasta que el puerto responda (máx 15 seg)
    import urllib.request
    for _ in range(15):
        time.sleep(1)
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json/version", timeout=1)
            break
        except Exception:
            continue

    browser = None
    try:
        browser = playwright_instance.chromium.connect_over_cdp(f"http://127.0.0.1:{DEBUG_PORT}")

        # Si la app arrancó en login.html (sin sesión guardada), hacer login automático
        # para que index.html esté correctamente registrado en los contextos de Playwright.
        time.sleep(2)
        login_page = None
        for ctx in browser.contexts:
            for p in ctx.pages:
                try:
                    if "login.html" in p.url:
                        login_page = p
                        break
                except Exception:
                    pass
            if login_page:
                break

        if login_page:
            # Usar expect_page para capturar el nuevo BrowserWindow (index.html)
            ctx = browser.contexts[0]
            try:
                with ctx.expect_page(timeout=30_000) as new_page_info:
                    login_page.locator("#email").fill(USER_EMAIL)
                    login_page.locator("#password").fill(USER_PASSWORD)
                    login_page.locator("button[type='submit'], #loginButton").first.click()
                dashboard = new_page_info.value
                dashboard.wait_for_load_state("domcontentloaded", timeout=20_000)
            except Exception as e:
                print(f"[electron_app fixture] Auto-login falló (se continuará de todos modos): {e}")

        yield browser
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


@pytest.fixture(scope="function")
def electron_window(electron_app):
    """Primera página/ventana de la app Electron conectada via CDP."""
    contexts = electron_app.contexts
    if not contexts or not contexts[0].pages:
        pytest.skip("No se encontró ninguna ventana en la app Electron")
    page = contexts[0].pages[0]
    page.wait_for_load_state("domcontentloaded", timeout=10_000)
    return page
