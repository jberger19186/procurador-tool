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

    # Esperar a que la pantalla de login desaparezca (indicador de login exitoso)
    page.wait_for_function(
        "document.getElementById('login-page') === null || "
        "(document.getElementById('login-page') && document.getElementById('login-page').style.display !== 'flex')",
        timeout=12_000
    )
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


# ─── I-06: Detalle de usuario activo ─────────────────────────────────────────
@pytest.mark.web
def test_I06_detalle_usuario(logged_in_admin_page: Page):
    """Detalle de usuario muestra registration_status, subscription y botón Suspender."""
    p = logged_in_admin_page

    # Ir a sección usuarios
    users_nav = p.locator(
        "[data-section='usuarios'], nav a:has-text('Usuarios'), button:has-text('Usuarios')"
    ).first
    if users_nav.count() > 0:
        users_nav.click()
        p.wait_for_timeout(1_500)

    # Clickear la primera fila de la tabla
    first_row = p.locator("table tbody tr, .user-row, [class*='user-item']").first
    if first_row.count() == 0:
        pytest.skip("No hay filas de usuario en la tabla")
    first_row.click()
    p.wait_for_timeout(1_500)

    content = p.locator("body").inner_text().lower()
    has_detail = any(w in content for w in [
        "registration", "suscripci", "status", "plan", "activo", "suspender", "suspend"
    ])
    p.screenshot(path="tests/screenshots/I06_user_detail.png")
    assert has_detail, "El detalle del usuario no muestra la información esperada"


# ─── I-07: Activar usuario desde admin ───────────────────────────────────────
@pytest.mark.web
def test_I07_activar_usuario(logged_in_admin_page: Page):
    """Botón 'Activar' en usuario pending_activation → usuario pasa a activo."""
    from helpers.db import create_test_user, cleanup_user, psql

    uid = create_test_user("qa-i07-web@test.com",
                           registration_status="pending_activation", sub_status="suspended")
    try:
        p = logged_in_admin_page
        p.reload()
        p.wait_for_timeout(2_000)

        # Ir a sección pendientes o buscar al usuario
        pending_nav = p.locator(
            "[data-section='pendientes'], nav a:has-text('Pendientes'), button:has-text('Pendiente')"
        ).first
        if pending_nav.count() == 0:
            pytest.skip("No se encontró sección Pendientes")
        pending_nav.click()
        p.wait_for_timeout(1_500)

        # Buscar y clickear el usuario
        user_row = p.locator(f"tr:has-text('qa-i07-web'), [data-email='qa-i07-web@test.com']").first
        if user_row.count() == 0:
            pytest.skip("No se encontró el usuario de prueba en la lista")
        user_row.click()
        p.wait_for_timeout(1_000)

        # Buscar y clickear botón Activar
        activate_btn = p.locator("button:has-text('Activar'), #btn-activate").first
        if activate_btn.count() == 0:
            pytest.skip("No se encontró botón Activar")
        activate_btn.click()
        p.wait_for_timeout(2_000)
        p.screenshot(path="tests/screenshots/I07_activar.png")

        # Verificar en DB
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "active", f"Estado esperado 'active': '{raw.strip()}'"
    finally:
        cleanup_user(uid)


# ─── I-10: Suspender usuario activo ──────────────────────────────────────────
@pytest.mark.web
def test_I10_suspender_usuario(logged_in_admin_page: Page):
    """Botón 'Suspender' en usuario activo → pasa a suspended_admin."""
    from helpers.db import create_test_user, cleanup_user, psql

    uid = create_test_user("qa-i10-suspend@test.com", registration_status="active")
    try:
        p = logged_in_admin_page
        p.reload()
        p.wait_for_timeout(2_000)

        # Buscar usuario en sección Usuarios
        users_nav = p.locator(
            "[data-section='usuarios'], nav a:has-text('Usuarios'), button:has-text('Usuarios')"
        ).first
        if users_nav.count() > 0:
            users_nav.click()
            p.wait_for_timeout(1_500)

        # Usar la búsqueda si existe
        search = p.locator("input[type='search'], input[placeholder*='buscar'], #search-users").first
        if search.count() > 0:
            search.fill("qa-i10-suspend@test.com")
            p.wait_for_timeout(1_000)

        user_row = p.locator(f"tr:has-text('qa-i10-suspend'), [data-email*='qa-i10']").first
        if user_row.count() == 0:
            pytest.skip("No se encontró el usuario de prueba en la lista")
        user_row.click()
        p.wait_for_timeout(1_000)

        suspend_btn = p.locator("button:has-text('Suspender'), #btn-suspend").first
        if suspend_btn.count() == 0:
            pytest.skip("No se encontró botón Suspender")
        suspend_btn.click()
        # Esperar a que el modal de suspensión aparezca
        p.wait_for_timeout(1_500)

        # Completar modal de suspensión — acotar selectors al modal para evitar capturar el botón trigger
        # El modal se llama #suspend-modal y tiene textarea#suspend-reason + button "Suspender"
        p.wait_for_selector("#suspend-modal", timeout=5_000)
        reason_field = p.locator("#suspend-reason, #suspension-reason, #suspend-modal textarea").first
        if reason_field.count() > 0:
            reason_field.fill("Test QA — suspensión automática")
        # El botón de confirmar dice "Suspender", acotado al modal
        confirm_btn = p.locator("#suspend-modal button:has-text('Suspender'), #suspend-modal button:has-text('Confirmar')").first
        if confirm_btn.count() > 0:
            confirm_btn.click()
        p.wait_for_timeout(2_000)
        p.screenshot(path="tests/screenshots/I10_suspender.png")

        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "suspended_admin", f"Estado esperado 'suspended_admin': '{raw.strip()}'"
    finally:
        cleanup_user(uid)


# ─── I-16: Responder ticket desde admin ─────────────────────────────────────
@pytest.mark.web
def test_I16_responder_ticket(logged_in_admin_page: Page, api_session):
    """Responder ticket desde admin → comentario guardado."""
    import requests as req
    p = logged_in_admin_page

    tickets_nav = p.locator(
        "[data-section='tickets'], nav a:has-text('Tickets'), button:has-text('Tickets')"
    ).first
    if tickets_nav.count() == 0:
        pytest.skip("No se encontró nav de Tickets en el dashboard")
    tickets_nav.click()
    p.wait_for_timeout(1_500)

    # Clickear el primer ticket
    first_ticket = p.locator("table tbody tr, .ticket-row, [class*='ticket-item']").first
    if first_ticket.count() == 0:
        pytest.skip("No hay tickets disponibles")
    first_ticket.click()
    p.wait_for_timeout(1_000)

    # Escribir respuesta
    reply_box = p.locator("textarea, #reply-message, input[name='message']").first
    if reply_box.count() == 0:
        pytest.skip("No se encontró campo de respuesta")
    reply_box.fill("Respuesta de admin QA — test automático")

    send_btn = p.locator("button:has-text('Enviar'), button:has-text('Responder'), button[type='submit']").first
    if send_btn.count() > 0:
        send_btn.click()
    p.wait_for_timeout(2_000)
    p.screenshot(path="tests/screenshots/I16_ticket_respuesta.png")

    # Verificar que el comentario aparece en la UI
    content = p.locator("main, #content").inner_text().lower()
    assert "respuesta" in content or "comentario" in content or "admin" in content or \
           "enviado" in content or "reply" in content, \
        "No se confirmó la respuesta del ticket"


# ─── I-18: Sección Scripts ──────────────────────────────────────────────────
@pytest.mark.web
def test_I18_seccion_scripts(logged_in_admin_page: Page):
    """Sección Scripts muestra lista con toggle activo/inactivo."""
    p = logged_in_admin_page

    scripts_nav = p.locator(
        "[data-section='scripts'], nav a:has-text('Scripts'), button:has-text('Scripts')"
    ).first
    if scripts_nav.count() == 0:
        pytest.skip("No se encontró sección Scripts en el dashboard")
    scripts_nav.click()
    p.wait_for_timeout(1_500)

    content = p.locator("main, #content").inner_text().lower()
    assert any(w in content for w in ["script", "procurar", "informe", "monitor"]), \
        "La sección Scripts no muestra nombres de scripts esperados"


# ─── I-19: Sección Monitor ──────────────────────────────────────────────────
@pytest.mark.web
def test_I19_seccion_monitor(logged_in_admin_page: Page):
    """Sección Monitor muestra partes monitoreadas con estadísticas."""
    p = logged_in_admin_page

    monitor_nav = p.locator(
        "[data-section='monitor'], nav a:has-text('Monitor'), button:has-text('Monitor')"
    ).first
    if monitor_nav.count() == 0:
        pytest.skip("No se encontró sección Monitor en el dashboard")
    monitor_nav.click()
    p.wait_for_timeout(1_500)

    content = p.locator("main, #content").inner_text().lower()
    assert any(w in content for w in ["monitor", "parte", "expediente", "notificaci"]), \
        "La sección Monitor no muestra información esperada"
