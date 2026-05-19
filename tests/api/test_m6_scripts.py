"""Módulo 6 — Scripts cifrados y licencia (F-01 a F-10)."""

import pytest
import requests

from helpers.auth import API_URL, generate_token_ssh
from helpers.db import create_test_user, cleanup_user, psql

BASE = API_URL


@pytest.mark.api
def test_F01_scripts_available(api_session):
    """GET /client/scripts/available → 200 con lista de scripts."""
    r = api_session.get(f"{BASE}/client/scripts/available", timeout=10)
    assert r.status_code == 200
    data = r.json()
    scripts = data.get("scripts") or data
    assert isinstance(scripts, list)
    assert len(scripts) > 0, "No se encontraron scripts disponibles"


@pytest.mark.api
def test_F01_sin_suscripcion():
    """GET /client/scripts/available sin token → 401."""
    r = requests.get(f"{BASE}/client/scripts/available", verify=False, timeout=10)
    assert r.status_code == 401


@pytest.mark.api
def test_F03_check_script(api_session):
    """GET /client/scripts/check/:name → 200 con version/hash/needsUpdate."""
    # Primero obtenemos un nombre de script válido
    r = api_session.get(f"{BASE}/client/scripts/available", timeout=10)
    scripts = r.json().get("scripts") or r.json()
    if not scripts:
        pytest.skip("No hay scripts disponibles")

    script_name = scripts[0].get("name") or scripts[0].get("script_name") or scripts[0]
    r2 = api_session.get(f"{BASE}/client/scripts/check/{script_name}", timeout=10)
    assert r2.status_code == 200
    data = r2.json()
    assert "version" in data or "hash" in data or "needsUpdate" in data


@pytest.mark.api
def test_F04_download_script(api_session):
    """GET /client/scripts/download/:name → 200 con contenido del script."""
    r = api_session.get(f"{BASE}/client/scripts/available", timeout=10)
    scripts = r.json().get("scripts") or r.json()
    if not scripts:
        pytest.skip("No hay scripts disponibles")

    script_name = scripts[0].get("name") or scripts[0].get("script_name") or scripts[0]
    r2 = api_session.get(f"{BASE}/client/scripts/download/{script_name}", timeout=15)
    assert r2.status_code == 200
    # El servidor retorna texto cifrado o estructura {encrypted, iv, signature}
    assert len(r2.content) > 0


@pytest.mark.api
def test_F05_execution_lock(api_session):
    """POST /license/execution/start → 200 con lock adquirido."""
    r = api_session.post(f"{BASE}/license/execution/start", json={
        "machineId": "TEST-QA-LOCK", "scriptName": "qa_test"
    }, timeout=10)
    assert r.status_code in (200, 409)  # 409 si ya hay un lock activo

    if r.status_code == 200:
        # F-07: heartbeat
        r2 = api_session.post(f"{BASE}/license/execution/heartbeat", json={
            "machineId": "TEST-QA-LOCK"
        }, timeout=10)
        assert r2.status_code == 200

        # F-08: liberar lock
        r3 = api_session.post(f"{BASE}/license/execution/end", json={
            "machineId": "TEST-QA-LOCK"
        }, timeout=10)
        assert r3.status_code == 200


@pytest.mark.api
def test_F02_scripts_sin_suscripcion_activa():
    """GET /client/scripts/available con suscripción suspendida → 403 checkLicense."""
    uid = create_test_user("qa-f02-nosub@test.com",
                           registration_status="active", sub_status="suspended")
    try:
        token = generate_token_ssh(uid)
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {token}"})
        s.verify = False
        r = s.get(f"{BASE}/client/scripts/available", timeout=10)
        assert r.status_code == 403, \
            f"Con suscripción suspendida debería ser 403, got {r.status_code}: {r.text}"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_F06_execution_lock_duplicado(api_session):
    """POST /license/execution/start con lock ya activo → 200 idempotente o 409."""
    machine = "TEST-QA-DUP-LOCK"
    # Primero liberar si quedó algo de run anterior
    api_session.post(f"{BASE}/license/execution/end",
                     json={"machineId": machine}, timeout=10)

    # Adquirir lock
    r1 = api_session.post(f"{BASE}/license/execution/start",
                          json={"machineId": machine, "scriptName": "qa_test"}, timeout=10)
    assert r1.status_code in (200, 409), f"Start inicial falló: {r1.status_code}"

    if r1.status_code == 200:
        # Segundo intento con mismo machineId → idempotente (200) o conflicto (409)
        r2 = api_session.post(f"{BASE}/license/execution/start",
                              json={"machineId": machine, "scriptName": "qa_test"}, timeout=10)
        assert r2.status_code in (200, 409), \
            f"Segundo lock debería ser 200 o 409, got {r2.status_code}"

        # Cleanup: liberar lock
        api_session.post(f"{BASE}/license/execution/end",
                         json={"machineId": machine}, timeout=10)


@pytest.mark.api
def test_F10_download_trial_agotado():
    """GET /client/scripts/download/:name con trial agotado → 403 checkLicense."""
    uid = create_test_user("qa-f10-trial@test.com",
                           registration_status="pending_activation", sub_status="suspended")
    try:
        # Agotar el trial en DB
        psql(f"UPDATE subscriptions SET usage_count=usage_limit WHERE user_id={uid};")

        token = generate_token_ssh(uid)
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {token}"})
        s.verify = False

        # Obtener nombre de script disponible con un token válido
        r_list = requests.get(f"{BASE}/client/scripts/available",
                              headers={"Authorization": f"Bearer {token}"},
                              verify=False, timeout=10)
        if r_list.status_code == 403:
            # checkLicense ya bloqueó antes de llegar a download → test pasa
            return

        scripts = r_list.json().get("scripts") or r_list.json()
        if not scripts:
            pytest.skip("No hay scripts disponibles para probar")

        script_name = scripts[0].get("name") or scripts[0].get("script_name") or scripts[0]
        r = s.get(f"{BASE}/client/scripts/download/{script_name}", timeout=15)
        assert r.status_code == 403, \
            f"Con trial agotado debería ser 403, got {r.status_code}"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_F09_log_execution(api_session):
    """POST /client/scripts/log-execution → 200."""
    r = api_session.post(f"{BASE}/client/scripts/log-execution", json={
        "scriptName": "qa_test_log",
        "success": True,
        "executionTime": 1234,
        "subsystem": "procuracion",
    }, timeout=10)
    assert r.status_code == 200
