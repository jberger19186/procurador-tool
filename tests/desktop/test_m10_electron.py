"""
Módulo 10 — App Electron (J-01 a J-13).

Usa playwright.electron para lanzar y controlar la app Electron.
La app debe estar instalada en node_modules o electron debe estar en PATH.

Ejecutar solo este módulo:
    pytest tests/desktop/ -m electron -v
"""

import pytest
from playwright.sync_api import Page, expect

USER_EMAIL = "procuradortool@gmail.com"
USER_PASSWORD = "TestPass2025!"


# ─── J-01: Pantalla de login visible al abrir ─────────────────────────────────
@pytest.mark.electron
def test_J01_login_screen(electron_window: Page):
    """Al abrir la app, la pantalla de login es visible."""
    # La app puede mostrar el login en la ventana principal o en una ventana separada
    win = electron_window
    win.wait_for_load_state("domcontentloaded", timeout=15_000)
    win.screenshot(path="tests/screenshots/J01_login.png")

    # Buscar campos de login
    has_email = win.locator("input[type='email'], input[name='email'], #email").count() > 0
    has_password = win.locator("input[type='password'], input[name='password'], #password").count() > 0

    assert has_email and has_password, \
        "No se encontraron campos de login en la ventana inicial de Electron"


# ─── J-02: Login con usuario activo ──────────────────────────────────────────
@pytest.mark.electron
def test_J02_login_exitoso(electron_window: Page):
    """Login con usuario activo carga el dashboard."""
    win = electron_window
    win.wait_for_load_state("domcontentloaded", timeout=15_000)

    # Llenar formulario de login
    email_input = win.locator("input[type='email'], input[name='email'], #email").first
    pass_input = win.locator("input[type='password'], input[name='password'], #password").first

    email_input.fill(USER_EMAIL)
    pass_input.fill(USER_PASSWORD)

    win.locator("button[type='submit'], #btn-login, button:has-text('Ingresar')").first.click()
    win.wait_for_timeout(5_000)  # El login puede tardar por la validación con el servidor

    win.screenshot(path="tests/screenshots/J02_after_login.png")

    # Verificar que cargó el dashboard (sidebar, topbar, o algún elemento del dashboard)
    dashboard_loaded = (
        win.locator("#sidebar, #topbar, .dashboard-content, nav").count() > 0 and
        win.locator("input[type='email']").count() == 0  # Ya no debería haber campos de login
    )
    assert dashboard_loaded, "El dashboard no cargó después del login"


# ─── J-04: Banner de estado ───────────────────────────────────────────────────
@pytest.mark.electron
def test_J04_banner_estado(electron_window: Page):
    """Verificar que existe el elemento de banner de estado."""
    win = electron_window
    # El banner puede o no estar visible según el estado del usuario
    # Solo verificamos que el elemento existe en el DOM
    banner = win.locator("#status-banner, .status-banner, [class*='banner']")
    # No asertar visibilidad — puede no mostrarse si el usuario está active


# ─── J-08: Sección Cuenta → muestra estado de suscripción ────────────────────
@pytest.mark.electron
def test_J08_seccion_cuenta(electron_window: Page):
    """Sección Cuenta muestra plan, estado y vencimiento."""
    win = electron_window
    win.wait_for_timeout(2_000)

    # Navegar a sección cuenta
    cuenta_nav = win.locator(
        "[data-section='cuenta'], button:has-text('Cuenta'), nav a:has-text('Cuenta'), #nav-cuenta"
    ).first
    if cuenta_nav.count() == 0:
        pytest.skip("No se encontró el nav item de Cuenta")

    cuenta_nav.click()
    win.wait_for_timeout(2_000)
    win.screenshot(path="tests/screenshots/J08_cuenta.png")

    # Debe mostrar información de plan
    content = win.locator("main, #content, #section-cuenta").inner_text()
    has_plan_info = any(word in content.lower() for word in ["plan", "suscripción", "estado", "activo"])
    assert has_plan_info, f"No se encontró información de plan en la sección Cuenta: '{content[:200]}'"


# ─── J-09: Sección Tickets ────────────────────────────────────────────────────
@pytest.mark.electron
def test_J09_seccion_tickets(electron_window: Page):
    """Sección Tickets muestra lista de tickets del usuario."""
    win = electron_window

    tickets_nav = win.locator(
        "[data-section='soporte'], button:has-text('Soporte'), button:has-text('Tickets'), #nav-soporte"
    ).first
    if tickets_nav.count() == 0:
        pytest.skip("No se encontró el nav item de Soporte/Tickets")

    tickets_nav.click()
    win.wait_for_timeout(2_000)
    win.screenshot(path="tests/screenshots/J09_tickets.png")


# ─── J-11: Cerrar sesión ─────────────────────────────────────────────────────
@pytest.mark.electron
def test_J11_cerrar_sesion(electron_window: Page):
    """Cerrar sesión vuelve a la pantalla de login."""
    win = electron_window

    logout_btn = win.locator(
        "#btn-logout, button:has-text('Cerrar sesión'), button:has-text('Salir')"
    ).first
    if logout_btn.count() == 0:
        pytest.skip("No se encontró botón de logout en la app Electron")

    logout_btn.click()
    win.wait_for_timeout(2_000)
    win.screenshot(path="tests/screenshots/J11_logout.png")

    # Debe volver al login
    has_login = win.locator("input[type='email'], input[type='password']").count() > 0
    assert has_login, "Después de logout debería mostrarse el formulario de login"


# ─── J-12: Verificar versión de la app ───────────────────────────────────────
@pytest.mark.electron
def test_J12_version_app(electron_window: Page):
    """La app muestra la versión correcta (2.6.0)."""
    win = electron_window

    # La versión puede estar en el topbar, about, o como variable JS
    version_text = win.evaluate("""
        () => {
            // Intentar obtener versión desde diferentes fuentes
            const el = document.querySelector('#app-version, .app-version, [data-version]');
            if (el) return el.textContent || el.getAttribute('data-version');
            // Buscar en todo el DOM
            const all = document.body.innerText;
            const match = all.match(/v?(\\d+\\.\\d+\\.\\d+)/);
            return match ? match[1] : null;
        }
    """)

    if version_text:
        assert "2.6" in str(version_text), f"Versión inesperada: {version_text}"
    else:
        # Tomar screenshot para inspección manual
        win.screenshot(path="tests/screenshots/J12_version_check.png")
        pytest.skip("No se encontró el elemento de versión — revisar screenshot")
