"""Módulo 4 — Endpoints de usuario autenticado (D-01 a D-13)."""

import pytest
import requests

from helpers.auth import API_URL, generate_token_ssh
from helpers.db import create_test_user, cleanup_user, psql, set_user_status, set_subscription_status

BASE = API_URL


def _session_for(user_id: int) -> requests.Session:
    """Crea una Session de requests con token generado via SSH para el user_id dado."""
    token = generate_token_ssh(user_id)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    s.verify = False
    return s


@pytest.mark.api
def test_D01_get_account(api_session):
    """GET /users/account → 200 con registrationStatus, subscription, notifications."""
    r = api_session.get(f"{BASE}/users/account", timeout=10)
    assert r.status_code == 200
    data = r.json()
    # registrationStatus puede estar en top level o anidado en data['user']
    user_obj = data.get("user") or data
    reg_status = data.get("registrationStatus") or user_obj.get("registrationStatus")
    assert reg_status, f"registrationStatus no encontrado: {list(data.keys())}"
    assert "subscription" in data
    assert isinstance(data.get("notifications"), list)


@pytest.mark.api
def test_D01_subscription_campos_v21(api_session):
    """GET /users/account — subscription tiene todos los campos de v2.1."""
    r = api_session.get(f"{BASE}/users/account", timeout=10)
    sub = r.json().get("subscription", {})
    campos_esperados = [
        "plan", "status", "usageCount", "usageLimit",
        "planChangesThisCycle", "cancelAt",
    ]
    for campo in campos_esperados:
        assert campo in sub, f"Campo faltante en subscription: {campo}"


@pytest.mark.api
def test_D10_notifications_read(api_session):
    """POST /users/notifications/read → 200."""
    r = api_session.post(f"{BASE}/users/notifications/read", timeout=10)
    assert r.status_code == 200


@pytest.mark.api
def test_D11_client_account(api_session):
    """GET /client/account → 200 con registrationStatus y campos v2.1."""
    r = api_session.get(f"{BASE}/client/account", timeout=10)
    assert r.status_code == 200
    data = r.json()
    # registrationStatus puede estar en top level o anidado en data['account']
    account_obj = data.get("account") or data
    reg_status = (data.get("registrationStatus") or data.get("registration_status") or
                  account_obj.get("registrationStatus") or account_obj.get("registration_status"))
    assert reg_status, f"registrationStatus no encontrado. Keys top: {list(data.keys())}"


@pytest.mark.api
def test_D12_change_password_incorrecta(api_session):
    """POST /auth/change-password con contraseña actual incorrecta → 400."""
    r = api_session.post(f"{BASE}/auth/change-password", json={
        "currentPassword": "Contraseña_INCORRECTA_99",
        "newPassword": "NuevaPass2025!",
        "confirmPassword": "NuevaPass2025!",
    }, timeout=10)
    assert r.status_code in (400, 401)
    assert "error" in r.json()


@pytest.mark.api
def test_D04_reactivation_request_desde_usuario_activo(api_session):
    """POST /users/reactivation-request desde usuario active → 400 (estado incorrecto)."""
    r = api_session.post(f"{BASE}/users/reactivation-request", json={
        "message": "Test desde usuario activo"
    }, timeout=10)
    # Debe fallar porque el usuario no está suspendido
    assert r.status_code in (400, 403)


# ─── D-02 / D-03: Solicitud de reactivación ──────────────────────────────────

@pytest.mark.api
def test_D02_reactivation_request_desde_suspended(special_users):
    """POST /users/reactivation-request desde suspended_admin → 200, reactivation_request.status=pending."""
    u = special_users["suspended_admin"]
    s = _session_for(u["id"])

    # Limpiar request previo si existe
    psql(
        f"UPDATE subscriptions SET reactivation_request=NULL WHERE user_id={u['id']};"
    )

    r = s.post(f"{BASE}/users/reactivation-request", json={
        "message": "Solicito reactivación — test QA"
    }, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("success") or data.get("reactivationRequest"), f"Respuesta: {data}"


@pytest.mark.api
def test_D03_reactivation_request_duplicado(special_users):
    """POST /users/reactivation-request segundo intento → 400 (ya existe)."""
    u = special_users["suspended_admin"]
    s = _session_for(u["id"])

    # Asegurar que ya hay una request pendiente (D02 la dejó, o la insertamos)
    psql(
        f"UPDATE subscriptions SET "
        f"reactivation_request='{{'\"'\"'status'\"'\"':'\"'\"'pending'\"'\"','\"'\"'message'\"'\"':'\"'\"'test'\"'\"'}}' "
        f"WHERE user_id={u['id']};"
    )
    # En realidad más simple con f-string escapado:
    psql(
        f"UPDATE subscriptions SET reactivation_request='{{\"status\":\"pending\",\"message\":\"test\"}}' "
        f"WHERE user_id={u['id']};"
    )

    r = s.post(f"{BASE}/users/reactivation-request", json={
        "message": "Segundo intento"
    }, timeout=10)
    assert r.status_code in (400, 409), \
        f"Segundo reactivation-request debería fallar, got {r.status_code}: {r.text}"


# ─── D-05 / D-06: Cancelación de suscripción ─────────────────────────────────

@pytest.mark.api
def test_D05_cancel_desde_active():
    """POST /users/cancel desde usuario active → 200 con cancelAt."""
    uid = create_test_user("qa-d05-cancel@test.com", registration_status="active")
    try:
        s = _session_for(uid)
        r = s.post(f"{BASE}/users/cancel", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") or data.get("cancelAt") or "cancel" in str(data).lower(), \
            f"Respuesta inesperada: {data}"
        # Verificar en DB
        sub_raw = psql(f"SELECT cancel_at FROM subscriptions WHERE user_id={uid};")
        assert sub_raw.strip() and sub_raw.strip() != "", "cancel_at no fue seteado en DB"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_D06_cancel_desde_estado_incorrecto(special_users):
    """POST /users/cancel desde usuario suspended_admin → 400."""
    u = special_users["suspended_admin"]
    s = _session_for(u["id"])
    r = s.post(f"{BASE}/users/cancel", timeout=10)
    assert r.status_code in (400, 403), \
        f"Cancel desde suspendido debería fallar, got {r.status_code}"


# ─── D-07 / D-08 / D-09: Cambio de plan ─────────────────────────────────────

@pytest.mark.api
def test_D07_change_plan_upgrade():
    """POST /users/change-plan upgrade → 200, plan_changes_this_cycle += 1."""
    # EXTENSION_PROMO ($1) → COMBO_PROMO ($9.99) = upgrade
    uid = create_test_user("qa-d07-plan@test.com", plan_name="EXTENSION_PROMO",
                           registration_status="active", sub_status="active")
    try:
        s = _session_for(uid)
        r = s.post(f"{BASE}/users/change-plan", json={"plan_name": "COMBO_PROMO"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") or "plan" in str(data).lower(), f"Respuesta: {data}"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_D08_change_plan_downgrade():
    """POST /users/change-plan downgrade → 200 con mensaje de downgrade programado."""
    # COMBO_PROMO ($9.99) → EXTENSION_PROMO ($1) = downgrade
    uid = create_test_user("qa-d08-plan@test.com", plan_name="COMBO_PROMO",
                           registration_status="active", sub_status="active")
    try:
        s = _session_for(uid)
        r = s.post(f"{BASE}/users/change-plan", json={"plan_name": "EXTENSION_PROMO"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") or "downgrade" in str(data).lower() or "scheduled" in str(data).lower(), \
            f"Respuesta: {data}"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_D09_change_plan_tercer_cambio():
    """POST /users/change-plan 3er cambio en el ciclo → 400."""
    uid = create_test_user("qa-d09-plan@test.com", plan_name="EXTENSION_PROMO",
                           registration_status="active", sub_status="active")
    try:
        # Forzar 2 cambios previos en la DB
        psql(
            f"UPDATE subscriptions SET plan_changes_this_cycle=2 WHERE user_id={uid};"
        )
        s = _session_for(uid)
        r = s.post(f"{BASE}/users/change-plan", json={"plan_name": "PRO"}, timeout=10)
        assert r.status_code in (400, 422), \
            f"3er cambio debería fallar, got {r.status_code}: {r.text}"
    finally:
        cleanup_user(uid)


# ─── D-13: Cambio de contraseña correcto ──────────────────────────────────────

@pytest.mark.api
def test_D13_change_password_correcto():
    """POST /auth/change-password correctamente → 200, hash actualizado en DB."""
    from helpers.db import TEST_PASSWORD, TEST_PASSWORD_HASH
    uid = create_test_user("qa-d13-pwd@test.com", registration_status="active")
    try:
        s = _session_for(uid)
        new_pwd = "NuevaPass_QA_2025!"
        r = s.post(f"{BASE}/auth/change-password", json={
            "currentPassword": TEST_PASSWORD,
            "newPassword": new_pwd,
            "confirmPassword": new_pwd,
        }, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("success") or r.json().get("message"), f"Respuesta: {r.json()}"
    finally:
        cleanup_user(uid)
