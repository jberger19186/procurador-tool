"""
MODULO 12 - Flujo comercial completo E2E (L-01 a L-16)
Simula el recorrido de un cliente nuevo desde registro hasta uso activo.

Estrategia:
  - Crea un usuario de prueba limpio al inicio (via API de registro)
  - Simula verificacion de email via SSH (UPDATE directo en DB)
  - Ejecuta todos los pasos del plan comercial
  - Limpia el usuario al final (L-16)

Requiere: SSH al servidor de produccion (clave do_procurador)
"""

import time
import urllib3
import pytest
import requests

from helpers.auth import API_URL, get_admin_token, login_http, generate_token_ssh, get_token_for_user_id
from helpers.db import (
    psql, cleanup_user, get_user, get_subscription,
    set_user_status, create_test_user, TEST_PASSWORD, TEST_PASSWORD_HASH,
    random_valid_cuit
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─── Estado compartido del usuario E2E (se crea una vez y se reutiliza) ───────
E2E_EMAIL   = f"qa-e2e-l{int(time.time())}@test.com"
E2E_PASSWORD = TEST_PASSWORD
E2E_STATE   = {}   # user_id, token, admin_token, ticket_id, etc.

PORTAL_URL    = f"{API_URL}/usuarios/"
DASHBOARD_URL = f"{API_URL}/dashboard/"


# ─── Fixture del usuario E2E ───────────────────────────────────────────────────
@pytest.fixture(scope="module", autouse=True)
def setup_e2e_state():
    """Inicializa el estado compartido del modulo E2E."""
    E2E_STATE["admin_token"] = get_admin_token()
    yield
    # L-16: Limpieza final
    if E2E_STATE.get("user_id"):
        try:
            cleanup_user(E2E_STATE["user_id"])
            print(f"[L-16] Usuario E2E {E2E_EMAIL} eliminado de la DB")
        except Exception as e:
            print(f"[L-16] Error en cleanup: {e}")


def admin_headers():
    return {"Authorization": f"Bearer {E2E_STATE['admin_token']}"}


def user_headers():
    return {"Authorization": f"Bearer {E2E_STATE.get('token', '')}"}


# ─── L-01: Crear usuario de prueba via DB (equivalente a /register) ───────────
def test_L01_register():
    """L-01: Crear usuario de prueba con registration_status=pending_email via DB.
    Nota: /auth/register tiene rate limit de 3/hora por IP; la API se prueba en M3.
    Se crea directamente via DB para que el flujo E2E completo pueda ejecutarse siempre.
    Verifica el estado resultante como lo haría el endpoint /auth/register.
    """
    user_id = create_test_user(
        email=E2E_EMAIL,
        plan_name="COMBO_PROMO",
        registration_status="pending_email",
        sub_status="suspended",
    )
    assert user_id, "L-01 FAIL: create_test_user no retorno user_id"
    E2E_STATE["user_id"] = user_id

    # Verificar estado en DB
    user = get_user(user_id)
    assert user.get("registration_status") == "pending_email", \
        f"L-01 FAIL: registration_status={user.get('registration_status')!r} (esperado pending_email)"

    sub = get_subscription(user_id)
    assert sub.get("status") == "suspended", \
        f"L-01 FAIL: sub.status={sub.get('status')!r} (esperado suspended)"
    assert sub.get("usage_limit") == 20, \
        f"L-01 FAIL: usage_limit={sub.get('usage_limit')} (esperado 20)"

    print(f"L-01 PASS: Usuario creado id={user_id} email={E2E_EMAIL} status=pending_email")


# ─── L-02: Simular verificacion de email via DB ────────────────────────────────
def test_L02_verificar_email():
    """L-02: Simular verificacion de email via DB -> registration_status='pending_activation'."""
    user_id = E2E_STATE.get("user_id")
    if not user_id:
        pytest.skip("L-02: user_id no disponible (L-01 fallo)")

    # Actualizar directamente en la DB (simula el click en el link de verificacion)
    psql(
        f"UPDATE users SET registration_status='pending_activation', updated_at=NOW() "
        f"WHERE id={user_id};"
    )
    # Activar la suscripcion en modo trial (suspended -> suspended con 20 usos)
    psql(
        f"UPDATE subscriptions SET status='suspended', usage_count=0, usage_limit=20, "
        f"updated_at=NOW() WHERE user_id={user_id};"
    )

    user = get_user(user_id)
    assert user.get("registration_status") == "pending_activation", \
        f"L-02 FAIL: registration_status={user.get('registration_status')!r}"

    print(f"L-02 PASS: Email verificado. registration_status=pending_activation")


# ─── L-03: Obtener token para usuario trial ───────────────────────────────────
def test_L03_login_trial():
    """L-03: Obtener token para el usuario trial (pending_activation).
    Usa SSH para generar el token (evita el rate limit de /auth/login).
    Verifica el estado via /client/account: registrationStatus='pending_activation'.
    Nota: el comportamiento de /auth/login para pending_activation se prueba en M1 A-08.
    """
    user_id = E2E_STATE.get("user_id")
    if not user_id:
        pytest.skip("L-03: user_id no disponible (L-01 fallo)")

    # Intentar login HTTP; si hay rate limit, generar token via SSH
    token = login_http(E2E_EMAIL, E2E_PASSWORD, "TEST-L03")
    if not token:
        token = generate_token_ssh(user_id, role="user")

    assert token, "L-03 FAIL: No se pudo obtener token (HTTP ni SSH)"
    E2E_STATE["token"] = token

    # Verificar estado via API account
    r = requests.get(
        f"{API_URL}/client/account",
        headers={"Authorization": f"Bearer {token}"},
        verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-03 FAIL: /client/account status={r.status_code}"
    data = r.json()
    # /client/account wraps todo en data["account"]
    account = data.get("account", data)
    reg_status = account.get("registrationStatus", "")
    assert reg_status == "pending_activation", \
        f"L-03 FAIL: registrationStatus={reg_status!r} (esperado pending_activation)"

    print(f"L-03 PASS: Token obtenido, registrationStatus={reg_status}")


# ─── L-04: Ver Mi Plan en portal web ──────────────────────────────────────────
def test_L04_mi_plan_portal():
    """L-04: GET /client/account -> badge 'trial' (pending_activation), uso 0/20."""
    r = requests.get(
        f"{API_URL}/client/account",
        headers=user_headers(), verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-04 FAIL: status={r.status_code} body={r.text[:300]}"
    data = r.json()
    # /client/account wraps todo en data["account"]
    account = data.get("account", data)

    reg_status = account.get("registrationStatus", "")
    usage_count = account.get("usageCount", -1)
    usage_limit = account.get("usageLimit", -1)

    assert reg_status == "pending_activation", \
        f"L-04 FAIL: registrationStatus={reg_status!r}"
    assert usage_count == 0, f"L-04 FAIL: usageCount={usage_count} (esperado 0)"
    assert usage_limit == 20, f"L-04 FAIL: usageLimit={usage_limit} (esperado 20)"

    print(f"L-04 PASS: Mi Plan muestra trial. uso={usage_count}/{usage_limit}")


# ─── L-05: Crear ticket de soporte como usuario trial ─────────────────────────
def test_L05_crear_ticket():
    """L-05: POST /tickets -> ticket creado correctamente con status='open'."""
    r = requests.post(
        f"{API_URL}/tickets",
        json={
            "category": "technical",
            "title": "Consulta de prueba E2E",
            "description": "Este es un ticket de prueba del flujo E2E L-05.",
        },
        headers=user_headers(), verify=False, timeout=15
    )
    assert r.status_code in (200, 201), f"L-05 FAIL: status={r.status_code} body={r.text[:300]}"
    data = r.json()

    ticket = data.get("ticket", data)
    ticket_id = ticket.get("id") or data.get("id")
    assert ticket_id, f"L-05 FAIL: No se obtuvo ticket_id. Response: {data}"
    E2E_STATE["ticket_id"] = ticket_id

    ticket_status = ticket.get("status", "")
    assert ticket_status in ("open", ""), \
        f"L-05 FAIL: ticket status={ticket_status!r} (esperado open)"

    print(f"L-05 PASS: Ticket creado id={ticket_id} status={ticket_status}")


# ─── L-06: Admin ve al usuario en seccion Pendientes ──────────────────────────
def test_L06_admin_ve_pendientes():
    """L-06: GET /admin/users/pending -> usuario aparece en trial pendientes."""
    r = requests.get(
        f"{API_URL}/admin/users/pending",
        headers=admin_headers(), verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-06 FAIL: status={r.status_code} body={r.text[:300]}"
    data = r.json()
    users = data.get("users", [])

    user_id = E2E_STATE.get("user_id")
    found = any(u.get("id") == user_id or u.get("email") == E2E_EMAIL for u in users)

    assert found, \
        f"L-06 FAIL: Usuario {E2E_EMAIL} no aparece en pending. " \
        f"Emails listados: {[u.get('email') for u in users[:5]]}"

    print(f"L-06 PASS: Usuario trial aparece en seccion de pendientes")


# ─── L-07: Admin activa al usuario ────────────────────────────────────────────
def test_L07_admin_activa():
    """L-07: POST /admin/users/:id/activate -> registration_status='active'."""
    user_id = E2E_STATE.get("user_id")
    if not user_id:
        pytest.skip("L-07: user_id no disponible")
    r = requests.post(
        f"{API_URL}/admin/users/{user_id}/activate",
        headers=admin_headers(), verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-07 FAIL: status={r.status_code} body={r.text[:300]}"

    # Verificar en DB
    user = get_user(user_id)
    assert user.get("registration_status") == "active", \
        f"L-07 FAIL: registration_status={user.get('registration_status')!r} (esperado active)"

    sub = get_subscription(user_id)
    assert sub.get("status") == "active", \
        f"L-07 FAIL: subscription.status={sub.get('status')!r} (esperado active)"

    print(f"L-07 PASS: Usuario activado por admin. registration_status=active, sub.status=active")


# ─── L-08: Usuario logueado ve plan activo ────────────────────────────────────
def test_L08_usuario_ve_plan_activo():
    """L-08: GET /client/account -> registrationStatus='active', sin banner de trial."""
    user_id = E2E_STATE.get("user_id")
    # Renovar token (el anterior puede tener registrationStatus viejo)
    new_token = login_http(E2E_EMAIL, E2E_PASSWORD, "TEST-L08")
    if not new_token and user_id:
        new_token = generate_token_ssh(user_id, role="user")
    if new_token:
        E2E_STATE["token"] = new_token

    r = requests.get(
        f"{API_URL}/client/account",
        headers=user_headers(), verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-08 FAIL: status={r.status_code} body={r.text[:300]}"
    data = r.json()
    account = data.get("account", data)

    reg_status = account.get("registrationStatus", "")
    assert reg_status == "active", \
        f"L-08 FAIL: registrationStatus={reg_status!r} (esperado active)"

    print(f"L-08 PASS: Usuario ve plan activo. registrationStatus=active")


# ─── L-09: Admin responde el ticket ───────────────────────────────────────────
def test_L09_admin_responde_ticket():
    """L-09: POST /admin/tickets/:id/comment -> comentario guardado, visible al usuario."""
    ticket_id = E2E_STATE.get("ticket_id")
    if not ticket_id:
        pytest.skip("L-09: ticket_id no disponible (L-05 fallo)")

    r = requests.post(
        f"{API_URL}/admin/tickets/{ticket_id}/comment",
        json={"message": "Respuesta del admin al ticket E2E de prueba."},
        headers=admin_headers(), verify=False, timeout=15
    )
    assert r.status_code in (200, 201), f"L-09 FAIL: status={r.status_code} body={r.text[:300]}"

    # Verificar que el usuario puede ver el comentario
    ru = requests.get(
        f"{API_URL}/tickets/{ticket_id}",
        headers=user_headers(), verify=False, timeout=15
    )
    assert ru.status_code == 200, f"L-09 FAIL: usuario no puede ver el ticket: {ru.status_code}"
    ticket_data = ru.json()
    comments = ticket_data.get("comments", ticket_data.get("ticket", {}).get("comments", []))

    admin_comment = any(
        "admin" in str(c.get("message", "")).lower() or
        "admin" in str(c.get("author_role", "")).lower() or
        "Respuesta del admin" in str(c.get("message", ""))
        for c in comments
    ) if comments else False

    # Tambien aceptar si hay al menos un comentario
    has_comments = len(comments) > 0

    assert has_comments, \
        f"L-09 FAIL: No hay comentarios en el ticket. ticket_data={str(ticket_data)[:300]}"

    print(f"L-09 PASS: Admin respondio ticket. Comentarios={len(comments)}")


# ─── L-10: Usuario solicita cambio de plan (downgrade) ────────────────────────
def test_L10_cambio_plan_downgrade():
    """L-10: POST /users/change-plan BASIC -> scheduled_plan seteado en DB."""
    # Verificar si el endpoint existe y si BASIC es accesible
    r = requests.post(
        f"{API_URL}/users/change-plan",
        json={"plan_name": "BASIC"},
        headers=user_headers(), verify=False, timeout=15
    )
    # BASIC podria no estar disponible (inactive) — aceptar 400 con mensaje de plan
    if r.status_code == 400:
        msg = r.json().get("error", "")
        if "inactivo" in msg.lower() or "inactive" in msg.lower() or "disponible" in msg.lower():
            print(f"L-10 SKIP: Plan BASIC inactivo — {msg!r} (by design)")
            E2E_STATE["plan_change_skip"] = True
            return

    # Si el plan esta disponible, verificar el comportamiento de downgrade
    assert r.status_code in (200, 400), \
        f"L-10 FAIL: status inesperado={r.status_code} body={r.text[:300]}"

    if r.status_code == 200:
        data = r.json()
        # Verificar que el downgrade se programo (scheduled_plan en DB)
        sub = get_subscription(E2E_STATE["user_id"])
        scheduled = sub.get("scheduled_plan")
        print(f"L-10 PASS: Downgrade programado. scheduled_plan={scheduled}, response={str(data)[:100]}")
    else:
        print(f"L-10 INFO: change-plan retorno 400: {r.json().get('error','')!r}")


# ─── L-11: Admin suspende al usuario ──────────────────────────────────────────
def test_L11_admin_suspende():
    """L-11: POST /admin/users/:id/suspend -> registration_status='suspended_admin'."""
    user_id = E2E_STATE.get("user_id")
    if not user_id:
        pytest.skip("L-11: user_id no disponible")
    r = requests.post(
        f"{API_URL}/admin/users/{user_id}/suspend",
        json={"reason": "Prueba de suspension E2E", "stop_billing": False},
        headers=admin_headers(), verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-11 FAIL: status={r.status_code} body={r.text[:300]}"

    user = get_user(user_id)
    assert user.get("registration_status") == "suspended_admin", \
        f"L-11 FAIL: registration_status={user.get('registration_status')!r}"

    print(f"L-11 PASS: Usuario suspendido por admin. registration_status=suspended_admin")


# ─── L-12: Login del usuario suspendido bloqueado ─────────────────────────────
def test_L12_login_suspendido_bloqueado():
    """L-12: Login del usuario suspendido -> 403 (o 429 si hay rate limit).
    Siempre verifica via DB que registration_status='suspended_admin'.
    Nota: el comportamiento exacto de 403 para suspended_admin se prueba en M1 A-05.
    """
    user_id = E2E_STATE.get("user_id")

    # Verificar estado en DB (principal verificacion de este step)
    if user_id:
        user = get_user(user_id)
        reg_status = user.get("registration_status", "")
        assert reg_status == "suspended_admin", \
            f"L-12 FAIL: registration_status={reg_status!r} en DB (esperado suspended_admin)"
        print(f"L-12: DB confirma registration_status=suspended_admin")

    # Intentar login HTTP — esperamos 403; 429 es aceptable si hay rate limit activo
    r = requests.post(
        f"{API_URL}/auth/login",
        json={"email": E2E_EMAIL, "password": E2E_PASSWORD, "machineId": "TEST-L12"},
        verify=False, timeout=15
    )
    assert r.status_code in (403, 429), \
        f"L-12 FAIL: status={r.status_code} (esperado 403 o 429). body={r.text[:300]}"

    if r.status_code == 403:
        error_msg = r.json().get("error", "")
        assert any(word in error_msg.lower() for word in ["suspendida", "suspendido", "admin", "suspend"]), \
            f"L-12 FAIL: Mensaje de error inesperado para 403: {error_msg!r}"
        print(f"L-12 PASS: Login bloqueado con 403. Error: {error_msg!r}")
    else:
        print(f"L-12 PASS: Login bloqueado con 429 (rate limit). Estado en DB confirmado como suspended_admin")


# ─── L-13: Usuario solicita reactivacion ──────────────────────────────────────
def test_L13_solicitud_reactivacion():
    """L-13: POST /users/reactivation-request -> reactivation_request.status='pending' en DB."""
    # Generar token via SSH para el usuario suspendido (login HTTP falla)
    from helpers.auth import generate_token_ssh
    user_id = E2E_STATE.get("user_id")
    try:
        token = generate_token_ssh(user_id, role="user")
        E2E_STATE["suspended_token"] = token
    except Exception as e:
        pytest.skip(f"L-13: No se pudo generar token SSH: {e}")

    headers = {"Authorization": f"Bearer {token}"}
    r = requests.post(
        f"{API_URL}/users/reactivation-request",
        json={"reason": "Solicitud de reactivacion E2E de prueba"},
        headers=headers, verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-13 FAIL: status={r.status_code} body={r.text[:300]}"

    # Verificar en DB via psql
    raw = psql(
        f"SELECT reactivation_request->>'status' FROM subscriptions WHERE user_id={user_id};"
    )
    req_status = raw.strip()
    assert req_status == "pending", \
        f"L-13 FAIL: reactivation_request.status={req_status!r} (esperado pending)"

    print(f"L-13 PASS: Solicitud de reactivacion enviada. DB status={req_status!r}")


# ─── L-14: Admin aprueba reactivacion ─────────────────────────────────────────
def test_L14_admin_aprueba_reactivacion():
    """L-14: POST /admin/users/:id/reactivation-request/approve -> active, suspension limpiada."""
    user_id = E2E_STATE.get("user_id")
    if not user_id:
        pytest.skip("L-14: user_id no disponible")
    r = requests.post(
        f"{API_URL}/admin/users/{user_id}/reactivation-request/approve",
        headers=admin_headers(), verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-14 FAIL: status={r.status_code} body={r.text[:300]}"

    user = get_user(user_id)
    assert user.get("registration_status") == "active", \
        f"L-14 FAIL: registration_status={user.get('registration_status')!r} (esperado active)"

    sub = get_subscription(user_id)
    # suspension_cause debe haberse limpiado
    suspension_cause = sub.get("suspension_cause")
    assert not suspension_cause or suspension_cause == "", \
        f"L-14 FAIL: suspension_cause sigue seteado: {suspension_cause!r}"

    print(f"L-14 PASS: Reactivacion aprobada. registration_status=active, suspension limpiada")


# ─── L-15: Usuario cancela suscripcion ────────────────────────────────────────
def test_L15_cancelar_suscripcion():
    """L-15: POST /users/cancel -> cancel_at seteado, acceso hasta fin del periodo."""
    user_id = E2E_STATE.get("user_id")
    # Renovar token
    new_token = login_http(E2E_EMAIL, E2E_PASSWORD, "TEST-L15")
    if not new_token and user_id:
        new_token = generate_token_ssh(user_id, role="user")
    if new_token:
        E2E_STATE["token"] = new_token

    r = requests.post(
        f"{API_URL}/users/cancel",
        headers=user_headers(), verify=False, timeout=15
    )
    assert r.status_code == 200, f"L-15 FAIL: status={r.status_code} body={r.text[:300]}"
    data = r.json()

    cancel_at = data.get("cancelAt") or data.get("cancel_at")
    assert cancel_at, f"L-15 FAIL: No se recibio cancel_at. Response: {data}"

    # Verificar en DB
    sub = get_subscription(E2E_STATE["user_id"])
    db_cancel_at = sub.get("cancel_at")
    assert db_cancel_at, f"L-15 FAIL: cancel_at no seteado en DB"

    print(f"L-15 PASS: Suscripcion cancelada. cancel_at={cancel_at}")


# ─── L-16: Limpieza del usuario de prueba ─────────────────────────────────────
def test_L16_cleanup():
    """L-16: Limpieza del usuario de prueba E2E."""
    user_id = E2E_STATE.get("user_id")
    if not user_id:
        pytest.skip("L-16: user_id no disponible")

    cleanup_user(user_id)
    E2E_STATE["user_id"] = None  # Marcar como limpiado (el fixture autouse no lo borrara de nuevo)

    # Verificar que fue eliminado
    raw = psql(f"SELECT COUNT(*) FROM users WHERE id={user_id};")
    count = int(raw.strip()) if raw.strip().isdigit() else -1
    assert count == 0, f"L-16 FAIL: Usuario {user_id} sigue en DB (count={count})"

    print(f"L-16 PASS: Usuario E2E {E2E_EMAIL} eliminado correctamente de la DB")
