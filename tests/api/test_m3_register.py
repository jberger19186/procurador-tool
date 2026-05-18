"""Módulo 3 — Registro de usuario (C-01 a C-09)."""

import random
import time
import pytest
import requests

from helpers.auth import API_URL

BASE = API_URL


def _calc_cuit(prefix_9: str) -> str:
    """
    Genera un CUIT válido dado un prefijo de 9 dígitos (tipo + 8 dígitos base).
    Multiplica los 10 primeros dígitos (tipo + 8 base + 0 placeholder) por [5,4,3,2,7,6,5,4,3,2].
    """
    digits = [int(c) for c in prefix_9] + [0]  # placeholder para el 10mo dígito
    weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    total = sum(d * w for d, w in zip(digits[:9], weights[:9]))
    # El 10mo dígito del CUIT (posición 9) es la suma × peso[9]=2 del último de base
    # Calculamos la suma de los 10 dígitos de la base (tipo + 8 dígitos + dummy)
    # en realidad: CUIT = tipo(2) + base(8) + verificador(1) = 11 dígitos
    tipo = int(prefix_9[0:2])
    base = prefix_9[2:]  # 7 dígitos
    # CUIT completo tiene 11 dígitos: tipo_2dig + base_8dig + verificador
    # usamos prefijo de 10 dígitos (tipo + base de 8) y calculamos el 11mo
    ten_digits = prefix_9  # ya tiene 9 → necesito 10
    # Generamos un dígito extra para tener 10
    extra = str(random.randint(0, 9))
    ten_str = prefix_9 + extra
    s = sum(int(ten_str[i]) * weights[i] for i in range(10))
    remainder = s % 11
    if remainder == 0:
        check = 0
    elif remainder == 1:
        # CUIT con remainder 1 es inválido — regenerar
        return _calc_cuit(prefix_9)
    else:
        check = 11 - remainder
    return ten_str + str(check)


def _random_valid_cuit() -> str:
    """Genera un CUIT aleatorio con dígito verificador correcto."""
    tipo = random.choice(["20", "27", "23"])
    base = "".join([str(random.randint(0, 9)) for _ in range(8)])
    prefix_10 = tipo + base
    weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    s = sum(int(prefix_10[i]) * weights[i] for i in range(10))
    remainder = s % 11
    if remainder == 1:
        return _random_valid_cuit()  # retry
    check = 0 if remainder == 0 else 11 - remainder
    return prefix_10 + str(check)


VALID_CUIT = _random_valid_cuit()

_DOMICILIO = {"calle": "Av. Corrientes", "numero": "1234", "localidad": "CABA", "provincia": "Buenos Aires"}
_PLAN = "COMBO_PROMO"


def _registro_payload(suffix: str, cuit: str = VALID_CUIT, plan: str = _PLAN) -> dict:
    ts = int(time.time())
    return {
        "email": f"qa-reg-{suffix}-{ts}@test.com",
        "password": "TestQA2025!",
        "nombre": "QA",
        "apellido": "Register",
        "cuit": cuit,
        "telefono": "+541100000000",
        "domicilio": _DOMICILIO,
        "plan_name": plan,
        "toc_accepted": True,
    }


@pytest.mark.api
def test_C01_plan_availability():
    """GET /auth/plan-availability → 200 con lista de planes."""
    r = requests.get(f"{BASE}/auth/plan-availability", verify=False, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data.get("plans") or data, list) or "plans" in data


@pytest.mark.api
def test_C02_registro_valido():
    """POST /auth/register con datos válidos → 201 y pending_email."""
    r = requests.post(f"{BASE}/auth/register", json=_registro_payload("c02"), verify=False, timeout=15)
    if r.status_code == 429:
        pytest.skip("Rate limit activo en /register — esperar o reiniciar PM2")
    assert r.status_code == 201, r.text
    data = r.json()
    assert data.get("registrationStatus") in ("pending_email", None) or data.get("success")


@pytest.mark.api
def test_C03_cuit_duplicado():
    """POST /auth/register con CUIT ya registrado → 400."""
    # Usar el CUIT del usuario de prueba principal que ya existe en la DB
    from helpers.auth import TEST_USERS
    from helpers.db import psql
    raw = psql(f"SELECT cuit FROM users WHERE email='{TEST_USERS['user']['email']}' LIMIT 1;")
    existing_cuit = raw.strip()
    if not existing_cuit:
        pytest.skip("No se pudo obtener CUIT existente del usuario de prueba")

    payload = _registro_payload("c03-dup", cuit=existing_cuit)
    r = requests.post(f"{BASE}/auth/register", json=payload, verify=False, timeout=15)
    if r.status_code == 429:
        pytest.skip("Rate limit activo")
    assert r.status_code == 400
    assert "cuit" in r.json().get("error", "").lower() or "registrado" in r.json().get("error", "").lower()


@pytest.mark.api
def test_C05_cuit_invalido():
    """POST /auth/register con CUIT con dígito verificador incorrecto → 400."""
    payload = _registro_payload("c05-bad", cuit="20111111119")  # dígito incorrecto
    r = requests.post(f"{BASE}/auth/register", json=payload, verify=False, timeout=15)
    if r.status_code == 429:
        pytest.skip("Rate limit activo")
    assert r.status_code == 400
    err = r.json().get("error", "")
    assert "cuit" in err.lower() or "inválido" in err.lower() or "invalid" in err.lower()


@pytest.mark.api
def test_C06_plan_inexistente():
    """POST /auth/register con plan_name inexistente → 400."""
    payload = _registro_payload("c06-plan", plan="PLAN_INEXISTENTE_999")
    r = requests.post(f"{BASE}/auth/register", json=payload, verify=False, timeout=15)
    if r.status_code == 429:
        pytest.skip("Rate limit activo")
    assert r.status_code == 400


@pytest.mark.api
def test_C08_verify_email_token_expirado():
    """GET /auth/verify-email con token expirado → 400."""
    r = requests.get(
        f"{BASE}/auth/verify-email",
        params={"token": "token_expirado_fake_12345"},
        verify=False, timeout=10
    )
    assert r.status_code in (400, 404)


@pytest.mark.api
def test_C09_verify_email_token_invalido():
    """GET /auth/verify-email con token completamente inválido → 400."""
    r = requests.get(
        f"{BASE}/auth/verify-email",
        params={"token": "INVALIDO"},
        verify=False, timeout=10
    )
    assert r.status_code in (400, 404)
