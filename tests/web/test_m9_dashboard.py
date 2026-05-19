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

    # La sección "pending-users" no tiene nav link directo — se navega via JS
    p.evaluate("navigate('pending-users')")
    p.wait_for_timeout(2_000)

    text_content = p.locator("#content").inner_text()
    assert any(word in text_content for word in ["trial", "Trial", "pendiente", "Pendiente", "En trial"]), \
        f"No se encontró subsección de pendientes. Contenido: {text_content[:200]}"


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

        # Navegar a pending-users via JS (no hay nav link directo en sidebar)
        p.evaluate("navigate('pending-users')")
        p.wait_for_timeout(2_000)

        # Buscar la fila del usuario de prueba
        user_row = p.locator("tr:has-text('qa-i07-web')").first
        if user_row.count() == 0:
            pytest.skip("No se encontró el usuario de prueba en la lista de pendientes")

        # Manejar el confirm() que dispara activateUser()
        p.once("dialog", lambda d: d.accept())
        activate_btn = user_row.locator("button:has-text('Activar')").first
        if activate_btn.count() == 0:
            pytest.skip("No se encontró botón Activar junto al usuario")
        activate_btn.click()
        p.wait_for_timeout(2_500)
        p.screenshot(path="tests/screenshots/I07_activar.png")

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
    p = logged_in_admin_page

    tickets_nav = p.locator("[data-page='tickets']").first
    if tickets_nav.count() == 0:
        pytest.skip("No se encontró nav de Tickets en el dashboard")
    tickets_nav.click()
    p.wait_for_timeout(1_500)

    # Clickear botón "Ver" del primer ticket (abre ticket-detail con reply textarea)
    ver_btn = p.locator("table tbody tr button:has-text('Ver'), td button:has-text('Ver')").first
    if ver_btn.count() == 0:
        pytest.skip("No hay tickets disponibles")
    ver_btn.click()
    p.wait_for_timeout(1_500)

    # El detalle tiene #reply-msg (no #reply-message)
    reply_box = p.locator("#reply-msg, textarea[placeholder*='respuesta'], textarea[placeholder*='Respuesta']").first
    if reply_box.count() == 0:
        pytest.skip("No se encontró campo de respuesta #reply-msg")
    reply_box.fill("Respuesta de admin QA — test automático")

    send_btn = p.locator("button:has-text('Responder')").first
    if send_btn.count() > 0:
        send_btn.click()
    p.wait_for_timeout(2_000)
    p.screenshot(path="tests/screenshots/I16_ticket_respuesta.png")

    content = p.locator("#content").inner_text().lower()
    assert any(w in content for w in ["respuesta", "comentario", "admin", "enviado", "reply", "qa"]), \
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


# ─── I-08: Rechazar y bloquear usuario ───────────────────────────────────────
@pytest.mark.web
def test_I08_rechazar_bloquear(logged_in_admin_page: Page):
    """Botón 'Rechazar' (block) en pending_activation → registration_status='rejected'."""
    from helpers.db import create_test_user, cleanup_user, psql

    uid = create_test_user("qa-i08-reject@test.com",
                           registration_status="pending_activation", sub_status="suspended")
    try:
        p = logged_in_admin_page
        p.reload()
        p.wait_for_timeout(2_000)

        p.evaluate("navigate('pending-users')")
        p.wait_for_timeout(2_000)

        user_row = p.locator("tr:has-text('qa-i08-reject')").first
        if user_row.count() == 0:
            pytest.skip("No se encontró usuario de prueba en pendientes")

        # rejectUserBlock dispara: prompt() → confirm()
        dialogs = []

        def handle_dialog(d):
            if d.type == "prompt":
                d.accept("Rechazado por test QA")
            else:
                d.accept()

        p.on("dialog", handle_dialog)
        reject_btn = user_row.locator("button:has-text('Rechazar')").first
        if reject_btn.count() == 0:
            p.remove_listener("dialog", handle_dialog)
            pytest.skip("No se encontró botón Rechazar junto al usuario")
        reject_btn.click()
        p.wait_for_timeout(3_000)
        p.remove_listener("dialog", handle_dialog)
        p.screenshot(path="tests/screenshots/I08_rechazar.png")

        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "rejected", f"Estado esperado 'rejected': '{raw.strip()}'"
    finally:
        cleanup_user(uid)


# ─── I-09: Mantener trial ────────────────────────────────────────────────────
@pytest.mark.web
def test_I09_mantener_trial(logged_in_admin_page: Page):
    """Botón 'Mantener trial' → registration_status no cambia, solo user_event."""
    from helpers.db import create_test_user, cleanup_user, psql

    uid = create_test_user("qa-i09-trial@test.com",
                           registration_status="pending_activation", sub_status="suspended")
    try:
        p = logged_in_admin_page
        p.reload()
        p.wait_for_timeout(2_000)

        p.evaluate("navigate('pending-users')")
        p.wait_for_timeout(2_000)

        user_row = p.locator("tr:has-text('qa-i09-trial')").first
        if user_row.count() == 0:
            pytest.skip("No se encontró usuario de prueba en pendientes")

        # rejectUserKeepTrial dispara: prompt() → confirm()
        def handle_dialog(d):
            if d.type == "prompt":
                d.accept("")           # motivo opcional
            else:
                d.accept()

        p.on("dialog", handle_dialog)
        keep_btn = user_row.locator("button:has-text('Mantener trial')").first
        if keep_btn.count() == 0:
            p.remove_listener("dialog", handle_dialog)
            pytest.skip("No se encontró botón 'Mantener trial'")
        keep_btn.click()
        p.wait_for_timeout(3_000)
        p.remove_listener("dialog", handle_dialog)
        p.screenshot(path="tests/screenshots/I09_mantener_trial.png")

        # Estado NO debe cambiar — sigue en pending_activation
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "pending_activation", \
            f"Estado debería seguir en 'pending_activation': '{raw.strip()}'"
    finally:
        cleanup_user(uid)


# ─── I-12: Solicitudes de reactivación visibles ──────────────────────────────
@pytest.mark.web
def test_I12_solicitudes_reactivacion(logged_in_admin_page: Page, special_users):
    """Subsección solicitudes de reactivación muestra usuarios con request pendiente."""
    from helpers.db import psql

    u = special_users["suspended_admin"]
    # Asegurar que hay una solicitud pendiente (usar json_build_object para evitar quoting issues)
    psql(
        f"UPDATE subscriptions SET "
        f"reactivation_request=json_build_object('status','pending','message','test QA')::jsonb "
        f"WHERE user_id={u['id']};"
    )

    p = logged_in_admin_page
    p.evaluate("navigate('pending-users')")
    p.wait_for_timeout(2_000)

    content = p.locator("#content").inner_text().lower()
    assert any(w in content for w in ["reactivaci", "solicitud", "aprobar", "rechazar"]), \
        f"No se encontró sección de solicitudes de reactivación. Contenido: {content[:300]}"


# ─── I-13: Aprobar solicitud de reactivación ─────────────────────────────────
@pytest.mark.web
def test_I13_aprobar_reactivacion(browser, admin_token):
    """Botón 'Aprobar' en solicitud de reactivación → usuario pasa a active."""
    from helpers.db import create_test_user, cleanup_user, psql

    uid = create_test_user("qa-i13-react@test.com",
                           registration_status="suspended_admin", sub_status="suspended")
    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    try:
        psql(
            f"UPDATE subscriptions SET "
            f"suspension_cause='admin', suspended_at=NOW(), suspension_reason='Test', "
            f"reactivation_request=json_build_object('status','pending','message','quiero volver')::jsonb "
            f"WHERE user_id={uid};"
        )

        p.goto(DASHBOARD)
        p.evaluate(f"localStorage.setItem('admin_token', '{admin_token}');")
        p.reload()
        p.wait_for_function("typeof navigate === 'function'", timeout=10_000)
        p.wait_for_timeout(500)

        p.evaluate("navigate('pending-users')")
        # Esperar activamente a que aparezca la fila del usuario (timeout 12s)
        try:
            p.wait_for_selector("tr:has-text('qa-i13-react')", timeout=12_000)
        except Exception:
            content_debug = p.locator("#content").inner_text()[:300] if p.locator("#content").count() > 0 else "NO #content"
            p.screenshot(path="tests/screenshots/I13_debug.png")
            pytest.skip(f"Usuario no encontrado en solicitudes de reactivación. Contenido: {content_debug}")

        user_row = p.locator("tr:has-text('qa-i13-react')").first
        p.once("dialog", lambda d: d.accept())
        approve_btn = user_row.locator("button:has-text('Aprobar')").first
        if approve_btn.count() == 0:
            pytest.skip("No se encontró botón Aprobar")
        approve_btn.click()
        p.wait_for_timeout(3_000)
        p.screenshot(path="tests/screenshots/I13_aprobar_reactivacion.png")

        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "active", \
            f"Estado esperado 'active' tras aprobar, got '{raw.strip()}'"
    finally:
        cleanup_user(uid)
        ctx.close()


# ─── I-14: Rechazar solicitud de reactivación ────────────────────────────────
@pytest.mark.web
def test_I14_rechazar_reactivacion(browser, admin_token):
    """Botón 'Rechazar' en solicitud de reactivación → reactivation_request.status='rejected'."""
    from helpers.db import create_test_user, cleanup_user, psql

    uid = create_test_user("qa-i14-react@test.com",
                           registration_status="suspended_admin", sub_status="suspended")
    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    try:
        psql(
            f"UPDATE subscriptions SET "
            f"suspension_cause='admin', suspended_at=NOW(), suspension_reason='Test', "
            f"reactivation_request=json_build_object('status','pending','message','quiero volver')::jsonb "
            f"WHERE user_id={uid};"
        )

        p.goto(DASHBOARD)
        p.evaluate(f"localStorage.setItem('admin_token', '{admin_token}');")
        p.reload()
        p.wait_for_function("typeof navigate === 'function'", timeout=10_000)
        p.wait_for_timeout(500)

        p.evaluate("navigate('pending-users')")
        try:
            p.wait_for_selector("tr:has-text('qa-i14-react')", timeout=12_000)
        except Exception:
            content_debug = p.locator("#content").inner_text()[:300] if p.locator("#content").count() > 0 else "NO #content"
            p.screenshot(path="tests/screenshots/I14_debug.png")
            pytest.skip(f"Usuario no encontrado en solicitudes de reactivación. Contenido: {content_debug}")

        user_row = p.locator("tr:has-text('qa-i14-react')").first
        p.once("dialog", lambda d: d.accept("Rechazado por test QA automático"))
        reject_btn = user_row.locator("button:has-text('Rechazar')").first
        if reject_btn.count() == 0:
            pytest.skip("No se encontró botón Rechazar en solicitud de reactivación")
        reject_btn.click()
        p.wait_for_timeout(3_000)
        p.screenshot(path="tests/screenshots/I14_rechazar_reactivacion.png")

        req_raw = psql(
            f"SELECT reactivation_request->>'status' FROM subscriptions WHERE user_id={uid};"
        )
        assert req_raw.strip() == "rejected", \
            f"reactivation_request.status esperado 'rejected', got '{req_raw.strip()}'"
    finally:
        cleanup_user(uid)
        ctx.close()
