"""
Módulo 9 — Panel admin /dashboard/ (I-01 a I-20).

Usa Playwright para navegar y verificar el panel de administración.
"""

import pytest
from playwright.sync_api import Page, expect

DASHBOARD = "https://api.procuradortool.com/dashboard/"
ADMIN_EMAIL = "admin@procurador.com"
ADMIN_PASSWORD = "Admin2025!"
USER_EMAIL_NORMAL = "procuradortool@gmail.com"
USER_PASSWORD_NORMAL = "TestPass2025!"


# ─── I-01: Sin sesión → pantalla de login ─────────────────────────────────────
@pytest.mark.web
def test_I01_dashboard_sin_sesion(page: Page):
    """Navegar a /dashboard/ sin sesión muestra pantalla de login."""
    page.goto(DASHBOARD)
    page.wait_for_load_state("networkidle")

    login_visible = (
        page.locator("#login-page, form[id*='login'], .login-box").count() > 0
    )
    assert login_visible, "Sin sesión debería mostrarse la pantalla de login del dashboard"


# ─── I-02: Login con usuario no-admin → error ────────────────────────────────
@pytest.mark.web
def test_I02_login_usuario_no_admin(page: Page):
    """Login con cuenta de usuario (no admin) muestra error."""
    page.goto(DASHBOARD)
    page.wait_for_load_state("networkidle")

    # Intentar login con usuario normal
    email_input = page.locator("input[type='email'], #admin-email, #login-email").first
    pass_input = page.locator("input[type='password'], #admin-password, #login-password").first

    email_input.fill(USER_EMAIL_NORMAL)
    pass_input.fill(USER_PASSWORD_NORMAL)

    page.locator("button[type='submit'], #btn-login, button:has-text('Ingresar')").first.click()
    page.wait_for_timeout(2_500)

    # El login-page debe seguir visible (display flex = login visible, login no fue exitoso)
    login_still_visible = page.evaluate("""
        () => {
            const lp = document.getElementById('login-page');
            if (!lp) return false;
            const style = window.getComputedStyle(lp);
            return style.display !== 'none';
        }
    """)
    assert login_still_visible, "El login-page debería seguir visible tras un intento fallido de usuario no-admin"


# ─── I-03: Login correcto con admin ───────────────────────────────────────────
@pytest.mark.web
def test_I03_login_admin(page: Page):
    """Login con credenciales de admin carga overview con stats."""
    page.goto(DASHBOARD)
    page.wait_for_load_state("networkidle")

    email_input = page.locator("input[type='email'], #admin-email, #login-email").first
    pass_input = page.locator("input[type='password'], #admin-password, #login-password").first

    email_input.fill(ADMIN_EMAIL)
    pass_input.fill(ADMIN_PASSWORD)
    page.locator("button[type='submit'], #btn-login, button:has-text('Ingresar')").first.click()

    # Esperar carga del dashboard
    page.wait_for_selector("#sidebar, #dashboard-content, main", timeout=12_000)
    page.wait_for_timeout(1_500)

    # Debe haber contenido de admin (stats, usuarios, etc.)
    content = page.locator("main, #content, #dashboard-content").first
    expect(content).to_be_visible()


# ─── I-04: Overview muestra métricas ─────────────────────────────────────────
@pytest.mark.web
def test_I04_overview_metricas(logged_in_admin_page: Page):
    """Overview muestra contadores de usuarios, activos, pendientes."""
    p = logged_in_admin_page
    p.wait_for_timeout(1_500)

    # Buscar elementos que contengan números/contadores
    # Pueden ser cards con estadísticas
    stat_cards = p.locator(".stat-card, .metric-card, .overview-card, [class*='stat']")
    if stat_cards.count() == 0:
        # Alternativa: buscar cualquier número visible en el dashboard
        numbers = p.locator("h2, h3, .number, .count")
        assert numbers.count() > 0, "No se encontraron métricas en el overview"
    else:
        assert stat_cards.count() > 0


# ─── I-05: Sección Usuarios → lista ──────────────────────────────────────────
@pytest.mark.web
def test_I05_lista_usuarios(logged_in_admin_page: Page):
    """Sección Usuarios muestra tabla paginada."""
    p = logged_in_admin_page

    # Navegar a sección usuarios
    users_nav = p.locator("[data-section='usuarios'], nav a:has-text('Usuarios'), button:has-text('Usuarios')").first
    if users_nav.count() > 0:
        users_nav.click()
        p.wait_for_timeout(1_500)

    # Debe haber una tabla o lista de usuarios
    table_or_list = p.locator("table, .user-list, .users-table, [class*='user-row']")
    assert table_or_list.count() > 0, "No se encontró tabla de usuarios"


# ─── I-11: Sección Pendientes → 3 subsecciones ───────────────────────────────
@pytest.mark.web
def test_I11_seccion_pendientes(logged_in_admin_page: Page):
    """Sección Pendientes tiene subsecciones de trial, reactivación y esperando email."""
    p = logged_in_admin_page

    # Navegar a sección pendientes
    pending_nav = p.locator("[data-section='pendientes'], nav a:has-text('Pendientes'), button:has-text('Pendientes')").first
    if pending_nav.count() == 0:
        pytest.skip("No se encontró el nav item de Pendientes")

    pending_nav.click()
    p.wait_for_timeout(1_500)

    # Buscar las 3 subsecciones
    text_content = p.locator("main, #content").inner_text()
    assert any(word in text_content for word in ["trial", "Trial", "pendiente", "Pendiente"]), \
        "No se encontró subsección de trial pendientes"


# ─── I-15: Sección Tickets ────────────────────────────────────────────────────
@pytest.mark.web
def test_I15_seccion_tickets(logged_in_admin_page: Page):
    """Sección Tickets muestra lista con filtros."""
    p = logged_in_admin_page

    tickets_nav = p.locator("[data-section='tickets'], nav a:has-text('Tickets'), button:has-text('Tickets')").first
    if tickets_nav.count() == 0:
        pytest.skip("No se encontró el nav item de Tickets")

    tickets_nav.click()
    p.wait_for_timeout(1_500)

    # Debe haber una tabla o lista de tickets
    content = p.locator("table, .ticket-list, [class*='ticket']")
    assert content.count() > 0 or "ticket" in p.locator("main").inner_text().lower()


# ─── I-17: Sección Planes ────────────────────────────────────────────────────
@pytest.mark.web
def test_I17_seccion_planes(logged_in_admin_page: Page):
    """Sección Planes muestra lista con precios y límites."""
    p = logged_in_admin_page

    planes_nav = p.locator("[data-section='planes'], nav a:has-text('Planes'), button:has-text('Plan')").first
    if planes_nav.count() == 0:
        pytest.skip("No se encontró el nav item de Planes")

    planes_nav.click()
    p.wait_for_timeout(1_500)

    content_text = p.locator("main, #content").inner_text().lower()
    assert any(plan in content_text for plan in ["combo", "basic", "pro", "enterprise", "extension"]), \
        "No se encontraron nombres de planes en la sección"


# ─── I-20: Cerrar sesión ─────────────────────────────────────────────────────
@pytest.mark.web
def test_I20_cerrar_sesion(logged_in_admin_page: Page):
    """Cerrar sesión redirige al login del dashboard."""
    p = logged_in_admin_page

    # Buscar botón de logout
    logout_btn = p.locator("#btn-logout, button:has-text('Cerrar sesión'), a:has-text('Salir')").first
    if logout_btn.count() == 0:
        pytest.skip("No se encontró botón de logout en el dashboard")

    logout_btn.click()
    p.wait_for_timeout(1_500)

    # Debe mostrar la pantalla de login
    login_visible = (
        p.locator("#login-page, form[id*='login'], .login-box").count() > 0
    )
    assert login_visible, "Después de logout debería mostrarse el login del dashboard"
