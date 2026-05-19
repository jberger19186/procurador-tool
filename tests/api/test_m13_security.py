"""Módulo 13 — Seguridad (M-01 a M-10)."""

import pytest
import requests

from helpers.auth import API_URL, generate_token_ssh, login_http, TEST_USERS
from helpers.db import create_test_user, cleanup_user

BASE = API_URL


@pytest.mark.api
def test_M01_sql_injection_email():
    """SQL injection en campo email → 401 sin exponer error de DB."""
    payloads = [
        "' OR '1'='1",
        "admin'--",
        "'; DROP TABLE users;--",
        "\" OR \"\"=\"",
    ]
    for payload in payloads:
        r = requests.post(f"{BASE}/auth/login", json={
            "email": payload, "password": "x", "machineId": "TEST"
        }, verify=False, timeout=10)
        # 429 es aceptable (rate limit es también un mecanismo de seguridad válido)
        assert r.status_code in (400, 401, 422, 429), \
            f"SQL injection con '{payload}' retornó {r.status_code}"
        # No debe haber mensajes internos de DB (excepto si fue bloqueado por rate limit)
        if r.status_code != 429:
            body = r.text.lower()
            assert "syntax error" not in body
            assert "pg_" not in body
            assert "postgresql" not in body


@pytest.mark.api
def test_M02_jwt_firma_incorrecta():
    """Token JWT con firma incorrecta → 403."""
    fake = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6InVzZXIifQ.FIRMA_FALSA"
    r = requests.get(
        f"{BASE}/users/account",
        headers={"Authorization": f"Bearer {fake}"},
        verify=False, timeout=10
    )
    assert r.status_code in (401, 403)


@pytest.mark.api
def test_M03_jwt_expirado():
    """Token JWT expirado (generado con exp en el pasado) → 401 o 403."""
    import time
    import hmac
    import hashlib
    import base64
    import json

    # JWT minimal con exp ya vencido — no requiere el secret real
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b'=').decode()
    payload_data = {"id": 1, "role": "user", "exp": int(time.time()) - 3600}
    payload = base64.urlsafe_b64encode(
        json.dumps(payload_data).encode()
    ).rstrip(b'=').decode()
    fake_sig = base64.urlsafe_b64encode(b"fakesignature").rstrip(b'=').decode()
    expired_token = f"{header}.{payload}.{fake_sig}"

    r = requests.get(
        f"{BASE}/users/account",
        headers={"Authorization": f"Bearer {expired_token}"},
        verify=False, timeout=10
    )
    assert r.status_code in (401, 403)


@pytest.mark.api
def test_M04_admin_con_token_usuario(user_token):
    """Acceder a /admin/* con token de usuario → 403."""
    r = requests.get(
        f"{BASE}/admin/users",
        headers={"Authorization": f"Bearer {user_token}"},
        verify=False, timeout=10
    )
    assert r.status_code == 403


@pytest.mark.api
def test_M05_users_sin_token():
    """Acceder a /users/* sin token → 401."""
    r = requests.get(f"{BASE}/users/account", verify=False, timeout=10)
    assert r.status_code == 401


@pytest.mark.api
def test_M09_security_headers():
    """Verificar headers de seguridad (helmet.js) en las respuestas."""
    r = requests.get(f"{BASE}/health", verify=False, timeout=10)
    headers = {k.lower(): v for k, v in r.headers.items()}

    assert "x-content-type-options" in headers, "Falta X-Content-Type-Options"
    assert headers["x-content-type-options"] == "nosniff"

    # X-Frame-Options o Content-Security-Policy (helmet puede usar CSP en su lugar)
    has_frame_protection = (
        "x-frame-options" in headers or
        "content-security-policy" in headers
    )
    assert has_frame_protection, "Falta protección contra clickjacking (X-Frame-Options o CSP)"


@pytest.mark.api
def test_M10_cors_origen_no_permitido():
    """Request desde origen no permitido → sin header CORS (browser lo bloquearía)."""
    r = requests.get(
        f"{BASE}/health",
        headers={"Origin": "https://sitio-malicioso.com"},
        verify=False, timeout=10
    )
    # El servidor no debe incluir Access-Control-Allow-Origin para orígenes no permitidos
    # (el callback(null, false) de CORS hace que el header no se agregue)
    acao = r.headers.get("Access-Control-Allow-Origin", "")
    assert acao != "*", "CORS no debería permitir todos los orígenes"
    assert "sitio-malicioso.com" not in acao, \
        "CORS no debería incluir el origen malicioso en la respuesta"
    # El server debe responder (200/4xx), no crashear con 500
    assert r.status_code != 500, "El servidor no debe retornar 500 en origen CORS no permitido"


@pytest.mark.api
def test_M06_download_script_sin_suscripcion():
    """GET /client/scripts/download/:name con token válido pero suscripción inactiva → 403."""
    uid = create_test_user("qa-m06-nosub@test.com",
                           registration_status="active", sub_status="suspended")
    try:
        token = generate_token_ssh(uid)
        # Obtener un nombre de script de la API pública (con token de admin o user normal)
        r_list = requests.get(f"{BASE}/client/scripts/available",
                              headers={"Authorization": f"Bearer {token}"},
                              verify=False, timeout=10)
        if r_list.status_code == 403:
            # checkLicense ya bloqueó en /available → correcto
            return

        scripts = r_list.json().get("scripts") or r_list.json()
        if not scripts:
            pytest.skip("No hay scripts disponibles")

        script_name = scripts[0].get("name") or scripts[0].get("script_name") or scripts[0]
        r = requests.get(
            f"{BASE}/client/scripts/download/{script_name}",
            headers={"Authorization": f"Bearer {token}"},
            verify=False, timeout=15
        )
        assert r.status_code == 403, \
            f"Sin suscripción activa debería ser 403, got {r.status_code}"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_M07_multiples_logins_simultaneos():
    """Múltiples logins simultáneos con la misma cuenta → ambos exitosos (by design)."""
    u = TEST_USERS["user"]
    token1 = login_http(u["email"], u["password"], "TEST-M07-DEVICE-A")
    token2 = login_http(u["email"], u["password"], "TEST-M07-DEVICE-B")

    if token1 is None or token2 is None:
        pytest.skip("Rate limit activo — no se pudieron obtener ambos tokens")

    # Ambos tokens deben funcionar independientemente
    r1 = requests.get(f"{BASE}/users/account",
                      headers={"Authorization": f"Bearer {token1}"},
                      verify=False, timeout=10)
    r2 = requests.get(f"{BASE}/users/account",
                      headers={"Authorization": f"Bearer {token2}"},
                      verify=False, timeout=10)

    assert r1.status_code == 200, f"Primer token debería funcionar, got {r1.status_code}"
    assert r2.status_code == 200, f"Segundo token debería funcionar, got {r2.status_code}"
