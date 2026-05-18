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
        localStorage.setItem('procurador_user_token', '{user_token}');
    """)
    p.reload()
    # Esperar a que cargue el dashboard (sidebar visible = login ok)
    p.wait_for_selector("#sidebar", timeout=10_000)
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
        localStorage.setItem('procurador_admin_token', '{admin_token}');
    """)
    p.reload()
    p.wait_for_selector("#sidebar, #dashboard-sidebar, nav", timeout=10_000)
    yield p
    ctx.close()


# ─── Fixture de Playwright — Electron ─────────────────────────────────────────
@pytest.fixture(scope="session")
def electron_app(playwright_instance: Playwright):
    """
    Lanza la app Electron usando el launcher de Playwright.
    Requiere que electron esté instalado en node_modules del electron-app.
    """
    import os
    electron_exe = os.path.join(ELECTRON_APP_PATH, "node_modules", ".bin", "electron.cmd")
    app = playwright_instance.electron.launch(
        executable_path=electron_exe if os.path.exists(electron_exe) else "electron",
        args=[ELECTRON_APP_PATH],
    )
    yield app
    app.close()


@pytest.fixture(scope="function")
def electron_window(electron_app):
    """Primera ventana de la app Electron."""
    window = electron_app.first_window()
    window.wait_for_load_state("domcontentloaded")
    return window
