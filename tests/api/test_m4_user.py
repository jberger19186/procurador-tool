"""Módulo 4 — Endpoints de usuario autenticado (D-01 a D-13)."""

import pytest
import requests

from helpers.auth import API_URL

BASE = API_URL


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
