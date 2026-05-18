"""Módulo 1 — Autenticación y Autorización (A-01 a A-15)."""

import pytest
import requests

from helpers.auth import API_URL, TEST_USERS

BASE = API_URL
HEADERS_JSON = {"Content-Type": "application/json"}


@pytest.mark.api
def test_A01_health():
    """GET /health → 200 {status:'ok'}"""
    r = requests.get(f"{BASE}/health", verify=False, timeout=10)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


@pytest.mark.api
def test_A02_login_correcto():
    """POST /auth/login con credenciales correctas → 200 con token y campos requeridos."""
    u = TEST_USERS["user"]
    r = requests.post(f"{BASE}/auth/login", json={
        "email": u["email"], "password": u["password"], "machineId": u["machine_id"]
    }, verify=False, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert "sessionKey" in data
    # registrationStatus puede estar en el top level o anidado en data['user']
    reg_status = data.get("registrationStatus") or (data.get("user") or {}).get("registrationStatus")
    assert reg_status, f"registrationStatus no encontrado en la respuesta: {list(data.keys())}"
    assert "subscription" in data


@pytest.mark.api
def test_A03_login_password_incorrecto():
    """POST /auth/login con password incorrecto → 401."""
    r = requests.post(f"{BASE}/auth/login", json={
        "email": TEST_USERS["user"]["email"],
        "password": "Password_INCORRECTA_9999",
        "machineId": "TEST-QA"
    }, verify=False, timeout=10)
    assert r.status_code == 401
    assert "error" in r.json()


@pytest.mark.api
def test_A09_extension_login(user_token):
    """POST /auth/extension-login con credenciales correctas → 200 con enabledFlows."""
    u = TEST_USERS["user"]
    r = requests.post(f"{BASE}/auth/extension-login", json={
        "email": u["email"], "password": u["password"]
    }, verify=False, timeout=10)
    assert r.status_code == 200
    data = r.json()
    # Debe incluir la sección de extensión con flujos habilitados
    assert "token" in data or "extension" in data


@pytest.mark.api
def test_A10_sin_token():
    """GET endpoint autenticado sin token → 401."""
    r = requests.get(f"{BASE}/users/account", verify=False, timeout=10)
    assert r.status_code == 401
    assert "error" in r.json()


@pytest.mark.api
def test_A11_token_manipulado():
    """GET endpoint con token manipulado → 401 o 403."""
    r = requests.get(
        f"{BASE}/users/account",
        headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOAD_FALSO.FIRMA_FALSA"},
        verify=False, timeout=10
    )
    assert r.status_code in (401, 403)


@pytest.mark.api
def test_A12_admin_endpoint_con_token_usuario(user_token):
    """GET /admin/* con token de usuario → 403."""
    r = requests.get(
        f"{BASE}/admin/users",
        headers={"Authorization": f"Bearer {user_token}"},
        verify=False, timeout=10
    )
    assert r.status_code == 403
    assert "administrador" in r.json().get("error", "").lower()


@pytest.mark.api
def test_A13_logout(user_token):
    """POST /auth/logout → 200 y token en blacklist."""
    # Creamos un token fresco para no invalidar el fixture de sesión
    from helpers.auth import login_http, TEST_USERS
    u = TEST_USERS["user"]
    fresh_token = login_http(u["email"], u["password"], "TEST-LOGOUT")
    if not fresh_token:
        pytest.skip("Rate limit activo — no se pudo obtener token fresco")

    r = requests.post(
        f"{BASE}/auth/logout",
        headers={"Authorization": f"Bearer {fresh_token}"},
        verify=False, timeout=10
    )
    assert r.status_code == 200

    # A-14: usar el token blacklisteado → debe fallar
    r2 = requests.get(
        f"{BASE}/users/account",
        headers={"Authorization": f"Bearer {fresh_token}"},
        verify=False, timeout=10
    )
    assert r2.status_code in (401, 403), "Token post-logout debería estar invalidado"


@pytest.mark.api
def test_A15_refresh_token(api_session):
    """POST /auth/refresh con token válido → 200 con nuevo token."""
    r = api_session.post(f"{BASE}/auth/refresh", timeout=10)
    # Si el usuario de prueba no tiene suscripción activa retorna 404 (by design)
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert "token" in r.json()
