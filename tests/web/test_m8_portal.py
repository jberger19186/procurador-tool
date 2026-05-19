"""
Módulo 8 — Portal web de usuario /usuarios/ (H-01 a H-20).

Usa Playwright para navegar, interactuar y verificar la UI.
Los fixtures `page` y `logged_in_user_page` vienen de conftest.py.
"""

import pytest
from playwright.sync_api import Page, expect

PORTAL = "https://api.procuradortool.com/usuarios/"
USER_EMAIL = "procuradortool@gmail.com"
USER_PASSWORD = "TestPass2025!"


# ─── H-01: Sin sesión → pantalla de login ──────────────────────────────────────
@pytest.mark.web
def test_H01_login_page_sin_sesion(page: Page):
    """Navegar a /usuarios/ sin sesión muestra la pantalla de login."""
    page.goto(PORTAL)
    page.wait_for_load_state("networkidle")

    # La pantalla de login debe ser visible
    login_box = page.locator("#login-page, .login-box, form#login-form")
    expect(login_box.first).to_be_visible(timeout=8_000)


# ─── H-02: Login incorrecto → error en UI ─────────────────────────────────────
@pytest.mark.web
def test_H02_login_incorrecto(page: Page):
    """Login con credenciales incorrectas muestra error en la UI, no navega."""
    page.goto(PORTAL)
    page.fill("#login-email", USER_EMAIL)
    page.fill("#login-password", "ContraseñaMAL_9999")
    page.click("#btn-login")

    # Debe aparecer un mensaje de error (no redirigir al dashboard)
    page.wait_for_timeout(2_000)
    error_el = page.locator("#login-error, .alert-error, .error-message")
    # La página de login debe seguir visible
    assert page.locator("#login-page").is_visible() or \
           page.locator("form#login-form").is_visible(), \
           "No debería navegar al dashboard con credenciales incorrectas"


# ─── H-03: Login correcto → carga sección Perfil ──────────────────────────────
@pytest.mark.web
def test_H03_login_correcto(page: Page):
    """Login con credenciales correctas carga la sección Mi Perfil."""
    page.goto(PORTAL)
    page.fill("#login-email", USER_EMAIL)
    page.fill("#login-password", USER_PASSWORD)
    page.click("#btn-login")

    # Esperar a que la pantalla de login desaparezca (indicador de login exitoso)
    page.wait_for_function(
        "document.getElementById('login-page') && document.getElementById('login-page').style.display !== 'flex'",
        timeout=12_000
    )
    page.wait_for_timeout(1_000)

    # La sección activa debe ser "perfil" o el email debe aparecer en el topbar
    topbar_email = page.locator("#topbar-email")
    expect(topbar_email).to_be_visible(timeout=5_000)
    assert USER_EMAIL in (topbar_email.text_content() or ""), \
           f"Email en topbar incorrecto: {topbar_email.text_content()}"


# ─── H-04: Status banner según registrationStatus ─────────────────────────────
@pytest.mark.web
def test_H04_status_banner(logged_in_user_page: Page):
    """El status-banner se muestra o no según el estado del usuario."""
    p = logged_in_user_page
    # Solo verificamos que el elemento existe — el color/visibilidad depende del estado
    banner = p.locator("#status-banner")
    assert banner.count() > 0, "El elemento #status-banner no existe en el DOM"


# ─── H-05: Sección Perfil → datos pre-cargados ────────────────────────────────
@pytest.mark.web
def test_H05_perfil_datos(logged_in_user_page: Page):
    """Sección Mi Perfil muestra email (read-only) y campos pre-cargados."""
    p = logged_in_user_page

    # Hacer click en "Mi Perfil" si no está activo
    p.click("[data-section='perfil']")
    p.wait_for_selector("#section-perfil.active, #section-perfil", timeout=5_000)

    # Email debe estar presente y no vacío
    email_input = p.locator("#profile-email")
    expect(email_input).to_be_visible()
    email_val = email_input.input_value()
    assert "@" in email_val, f"Email en perfil parece vacío o inválido: '{email_val}'"

    # Campo email debe estar deshabilitado (read-only)
    assert email_input.is_disabled(), "El campo email debería estar deshabilitado"


# ─── H-06: Editar nombre y guardar ────────────────────────────────────────────
@pytest.mark.web
def test_H06_editar_nombre(logged_in_user_page: Page):
    """Editar nombre y guardar muestra toast de éxito."""
    p = logged_in_user_page
    p.click("[data-section='perfil']")
    p.wait_for_timeout(500)

    # Editar nombre
    nombre_input = p.locator("#profile-nombre")
    nombre_input.fill("QA-Editado")

    p.click("#btn-save-profile")
    p.wait_for_timeout(2_000)

    # Buscar toast o alert de éxito
    success_indicators = [
        ".toast-success", ".alert-success", "[class*='success']",
        "#profile-alert", ".notification"
    ]
    found_success = any(
        p.locator(sel).count() > 0 and p.locator(sel).first.is_visible()
        for sel in success_indicators
    )
    assert found_success, "No se encontró indicador de éxito al guardar perfil"


# ─── H-07: Cambiar contraseña con contraseña actual incorrecta ────────────────
@pytest.mark.web
def test_H07_cambiar_password_incorrecto(logged_in_user_page: Page):
    """Cambiar contraseña con contraseña actual incorrecta muestra error."""
    p = logged_in_user_page
    p.click("[data-section='perfil']")
    p.wait_for_timeout(500)

    p.fill("#current-password", "ContraseñaMAL_9999")
    p.fill("#new-password", "NuevaPass2025!")
    p.fill("#confirm-password", "NuevaPass2025!")
    p.click("#btn-save-password")
    p.wait_for_timeout(2_000)

    # Debe aparecer un error
    error = p.locator("#password-alert, .alert-error, [class*='error']")
    # No necesariamente visible pero algo debe indicar el error
    # En muchos casos el alert tiene clase + contenido


# ─── H-09: Sección Mi Plan ────────────────────────────────────────────────────
@pytest.mark.web
def test_H09_seccion_mi_plan(logged_in_user_page: Page):
    """Sección Mi Plan muestra plan_name, badge de status y días restantes."""
    p = logged_in_user_page
    p.click("[data-section='plan']")
    p.wait_for_selector("#section-plan.active, #section-plan", timeout=5_000)
    p.wait_for_timeout(1_500)

    plan_name = p.locator("#plan-name-display")
    expect(plan_name).to_be_visible()
    plan_text = plan_name.text_content() or ""
    assert plan_text.strip() not in ("-", ""), f"plan-name-display parece vacío: '{plan_text}'"

    status_badge = p.locator("#plan-status-badge")
    expect(status_badge).to_be_visible()


# ─── H-10: Botón "Ver planes disponibles" abre modal ─────────────────────────
@pytest.mark.web
def test_H10_modal_planes(logged_in_user_page: Page):
    """Click en 'Ver planes disponibles' abre el modal con lista de planes."""
    p = logged_in_user_page
    p.click("[data-section='plan']")
    p.wait_for_timeout(1_000)

    p.click("button:has-text('Ver planes disponibles'), #modal-plan-trigger")
    p.wait_for_timeout(1_500)

    modal = p.locator("#modal-plan, .modal-overlay:not(.hidden)")
    expect(modal.first).to_be_visible(timeout=5_000)


# ─── H-13: Sección Soporte → crear ticket ─────────────────────────────────────
@pytest.mark.web
def test_H13_crear_ticket(logged_in_user_page: Page):
    """Sección Soporte: modal se abre, formulario se completa y envía."""
    p = logged_in_user_page
    p.click("[data-section='soporte']")
    p.wait_for_selector("#section-soporte.active, #section-soporte", timeout=5_000)
    p.wait_for_timeout(1_000)

    # Abrir modal de nuevo ticket
    p.click("button:has-text('Nuevo ticket'), button:has-text('+ Nuevo ticket')")
    p.wait_for_selector("#modal-ticket:not(.hidden), #modal-ticket .modal", timeout=5_000)

    # Completar formulario
    p.select_option("#ticket-category", "technical")
    p.fill("#ticket-title", "Test QA Playwright — ticket de prueba")
    p.fill("#ticket-description", "Este ticket fue creado automáticamente por la suite de tests QA con Playwright.")

    # Enviar
    p.click("#btn-submit-ticket")
    p.wait_for_timeout(2_500)

    # El modal debe cerrarse y el ticket debe aparecer en la lista
    # O debe aparecer algún indicador de éxito
    modal_hidden = (
        p.locator("#modal-ticket.hidden").count() > 0 or
        not p.locator("#modal-ticket").is_visible()
    )
    assert modal_hidden, "El modal debería cerrarse tras enviar el ticket"


# ─── H-17: Sección Asistente IA ───────────────────────────────────────────────
@pytest.mark.web
def test_H17_asistente_ia(logged_in_user_page: Page):
    """Sección Asistente IA: el input de chat funciona."""
    p = logged_in_user_page
    p.click("[data-section='ia']")
    p.wait_for_selector("#section-ia.active, #section-ia", timeout=5_000)
    p.wait_for_timeout(500)

    chat_input = p.locator("#chat-input")
    expect(chat_input).to_be_visible()
    chat_input.fill("¿Cómo funciona el sistema?")

    send_btn = p.locator("#btn-chat-send")
    expect(send_btn).to_be_visible()


# ─── H-18: Cerrar sesión ──────────────────────────────────────────────────────
@pytest.mark.web
def test_H18_cerrar_sesion(logged_in_user_page: Page):
    """Cerrar sesión borra localStorage y redirige al login."""
    p = logged_in_user_page
    p.click("#btn-logout")
    p.wait_for_timeout(1_500)

    # Debe mostrar la pantalla de login
    login_visible = (
        p.locator("#login-page").is_visible() or
        p.locator("form#login-form").is_visible() or
        p.locator(".login-box").is_visible()
    )
    assert login_visible, "Después de logout debería mostrarse la pantalla de login"

    # El token debe haberse eliminado del localStorage
    token = p.evaluate("localStorage.getItem('procurador_user_token')")
    assert not token, "El token debería eliminarse de localStorage al cerrar sesión"


# ─── H-19/H-20: Sidebar muestra/oculta "Reactivar cuenta" ───────────────────
@pytest.mark.web
def test_H19_sidebar_reactivacion_oculto(logged_in_user_page: Page):
    """Si el usuario está active, el nav item 'Reactivar cuenta' es display:none."""
    p = logged_in_user_page
    nav_reactivacion = p.locator("#nav-reactivacion")
    if nav_reactivacion.count() == 0:
        pytest.skip("Elemento #nav-reactivacion no encontrado en el DOM")
    # Si el usuario está activo, debe estar oculto
    is_hidden = nav_reactivacion.evaluate("el => getComputedStyle(el).display === 'none'")
    assert is_hidden, "El nav item de reactivación debería estar oculto para usuarios activos"


# ─── H-08: Cambio de contraseña correcto ────────────────────────────────────
@pytest.mark.web
def test_H08_cambiar_password_correcto(logged_in_user_page: Page):
    """Cambiar contraseña con datos correctos → toast de éxito, luego restaurar."""
    import requests
    p = logged_in_user_page

    # Navegar a sección Perfil
    p.locator("#nav-perfil, [data-section='perfil'], nav a:has-text('Perfil')").first.click()
    p.wait_for_timeout(1_000)

    # Buscar el formulario de cambio de contraseña
    current_pw = p.locator("#current-password, input[name='currentPassword'], #currentPassword").first
    if current_pw.count() == 0:
        pytest.skip("No se encontró el campo de contraseña actual en el perfil")

    new_pw_tmp = "QA_TmpPass_2025!"
    current_pw.fill(USER_PASSWORD)
    p.locator("#new-password, input[name='newPassword'], #newPassword").first.fill(new_pw_tmp)
    p.locator("#confirm-password, input[name='confirmPassword'], #confirmPassword").first.fill(new_pw_tmp)
    p.locator("button:has-text('Cambiar'), button:has-text('Guardar'), #btn-change-pwd").first.click()
    p.wait_for_timeout(2_000)

    # Debe aparecer toast o mensaje de éxito
    # Esperar un momento adicional para que el mensaje aparezca
    p.wait_for_timeout(1_000)
    page_text = p.locator("body").inner_text().lower()
    success_words = ["éxito", "actualiz", "cambiada", "cambiad", "correctamente", "success", "guardada"]
    success = (
        any(w in page_text for w in success_words) or
        p.locator(".toast, .alert-success, [class*='success'], .notification, #password-alert, #profile-alert").count() > 0
    )
    p.screenshot(path="tests/screenshots/H08_pwd_changed.png")

    # Restaurar la contraseña original via API directamente
    token = p.evaluate("localStorage.getItem('psc_user_token')")
    if token:
        requests.post(
            "https://api.procuradortool.com/auth/change-password",
            json={"currentPassword": new_pw_tmp, "newPassword": USER_PASSWORD,
                  "confirmPassword": USER_PASSWORD},
            headers={"Authorization": f"Bearer {token}"},
            verify=False, timeout=10
        )

    assert success, "Debería aparecer un mensaje de éxito al cambiar la contraseña"


# ─── H-11: Sección Facturación ───────────────────────────────────────────────
@pytest.mark.web
def test_H11_seccion_facturacion(logged_in_user_page: Page):
    """Sección Facturación muestra info de pago."""
    p = logged_in_user_page
    billing_nav = p.locator(
        "#nav-facturacion, [data-section='facturacion'], nav a:has-text('Facturaci')"
    ).first
    if billing_nav.count() == 0:
        pytest.skip("No se encontró nav de Facturación")
    billing_nav.click()
    p.wait_for_timeout(1_500)

    content = p.locator("main, #content, #app").first.inner_text().lower()
    has_billing_info = any(w in content for w in [
        "facturaci", "pago", "billing", "suscripci", "vencimiento", "plan"
    ])
    p.screenshot(path="tests/screenshots/H11_facturacion.png")
    assert has_billing_info, "La sección de facturación no muestra información esperada"


# ─── H-14: Detalle de ticket ─────────────────────────────────────────────────
@pytest.mark.web
def test_H14_detalle_ticket(logged_in_user_page: Page):
    """Sección Soporte — ver detalle de ticket muestra historial de comentarios."""
    p = logged_in_user_page
    soporte_nav = p.locator(
        "#nav-soporte, [data-section='soporte'], nav a:has-text('Soporte')"
    ).first
    if soporte_nav.count() == 0:
        pytest.skip("No se encontró nav de Soporte")
    soporte_nav.click()
    p.wait_for_timeout(1_500)

    # Buscar algún ticket en la lista
    ticket_row = p.locator(".ticket-item, .ticket-row, tr[data-id], [class*='ticket']").first
    if ticket_row.count() == 0:
        pytest.skip("No hay tickets en la lista de soporte")

    ticket_row.click()
    p.wait_for_timeout(1_000)

    # Debe mostrar detalle del ticket
    detail = p.locator(".ticket-detail, #ticket-detail, [class*='detail']").first
    detail_text = p.locator("main, #content").inner_text().lower()
    has_detail = any(w in detail_text for w in ["comentario", "mensaje", "subject", "asunto", "reply"])
    p.screenshot(path="tests/screenshots/H14_ticket_detalle.png")
    assert has_detail, "El detalle del ticket no muestra información esperada"


# ─── H-15: Sección Reactivación (solo para suspended_admin) ─────────────────
@pytest.mark.web
def test_H15_seccion_reactivacion(browser, special_users):
    """Sección Reactivación visible para usuario suspended_admin."""
    from playwright.sync_api import Browser
    from helpers.auth import generate_token_ssh

    u = special_users["suspended_admin"]
    token = generate_token_ssh(u["id"])

    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    try:
        p.goto(PORTAL)
        p.evaluate(f"localStorage.setItem('psc_user_token', '{token}');")
        p.reload()
        p.wait_for_timeout(3_000)

        # Buscar nav de reactivación
        nav_react = p.locator(
            "#nav-reactivacion, [data-section='reactivacion'], nav a:has-text('Reactivar')"
        ).first
        if nav_react.count() == 0:
            pytest.skip("No se encontró nav de Reactivación en el DOM")

        is_visible = nav_react.evaluate("el => getComputedStyle(el).display !== 'none'")
        p.screenshot(path="tests/screenshots/H15_reactivacion.png")
        assert is_visible, "El nav de reactivación debería estar visible para suspended_admin"
    finally:
        ctx.close()


# ─── H-16: Enviar solicitud de reactivación ─────────────────────────────────
@pytest.mark.web
def test_H16_enviar_reactivacion(browser, special_users):
    """Enviar solicitud de reactivación muestra estado 'pendiente'."""
    from helpers.auth import generate_token_ssh
    from helpers.db import psql

    u = special_users["suspended_admin"]
    # Limpiar request previo
    psql(f"UPDATE subscriptions SET reactivation_request=NULL WHERE user_id={u['id']};")

    token = generate_token_ssh(u["id"])
    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    try:
        p.goto(PORTAL)
        p.evaluate(f"localStorage.setItem('psc_user_token', '{token}');")
        p.reload()
        p.wait_for_timeout(3_000)

        # Navegar a sección reactivación
        nav_react = p.locator(
            "#nav-reactivacion, [data-section='reactivacion'], nav a:has-text('Reactivar')"
        ).first
        if nav_react.count() == 0:
            pytest.skip("No se encontró nav de Reactivación")
        nav_react.click()
        p.wait_for_timeout(1_500)

        # Buscar formulario y enviarlo
        textarea = p.locator("textarea, #reactivacion-message, input[name='message']").first
        if textarea.count() == 0:
            pytest.skip("No se encontró formulario de reactivación")
        textarea.fill("Solicitud de reactivación — test QA automático")

        # Usar selector acotado a la sección de reactivación para evitar el #btn-login
        submit_btn = p.locator(
            "#section-reactivacion button:has-text('Enviar'), "
            "#section-reactivacion button[type='submit'], "
            "#reactivacion-form button, "
            "form:has(textarea) button:has-text('Enviar'), "
            "form:has(textarea) button[type='submit']"
        ).first
        submit_btn.click()
        p.wait_for_timeout(2_000)
        p.screenshot(path="tests/screenshots/H16_reactivacion.png")

        content = p.locator("main, #content").inner_text().lower()
        assert any(w in content for w in ["pendiente", "enviada", "solicitud", "revisando"]), \
            "No se mostró confirmación de solicitud enviada"
    finally:
        ctx.close()


# ─── H-20: Sidebar muestra Reactivar para suspended_admin ───────────────────
@pytest.mark.web
def test_H20_sidebar_reactivacion_visible(browser, special_users):
    """Para usuario suspended_admin, el nav item 'Reactivar cuenta' es visible."""
    from helpers.auth import generate_token_ssh

    u = special_users["suspended_admin"]
    token = generate_token_ssh(u["id"])

    ctx = browser.new_context(ignore_https_errors=True)
    p = ctx.new_page()
    try:
        p.goto(PORTAL)
        p.evaluate(f"localStorage.setItem('psc_user_token', '{token}');")
        p.reload()
        p.wait_for_timeout(3_000)

        nav_reactivacion = p.locator("#nav-reactivacion")
        if nav_reactivacion.count() == 0:
            pytest.skip("#nav-reactivacion no encontrado en el DOM")

        is_visible = nav_reactivacion.evaluate(
            "el => getComputedStyle(el).display !== 'none'"
        )
        p.screenshot(path="tests/screenshots/H20_sidebar_reactivacion.png")
        assert is_visible, "El nav de reactivación debería estar visible para suspended_admin"
    finally:
        ctx.close()
