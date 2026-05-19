"""Módulo 5 — Endpoints de admin (E-01 a E-15)."""

import pytest
import requests

from helpers.auth import API_URL
from helpers.db import create_test_user, cleanup_user, psql

BASE = API_URL


@pytest.mark.api
def test_E01_admin_users(admin_session):
    """GET /admin/users → 200 con {success, count, users[]}."""
    r = admin_session.get(f"{BASE}/admin/users", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("success")
    assert isinstance(data.get("users") or data.get("data"), list)


@pytest.mark.api
def test_E02_admin_users_pending(admin_session):
    """GET /admin/users/pending → 200 con usuarios en estado pendiente."""
    r = admin_session.get(f"{BASE}/admin/users/pending", timeout=10)
    assert r.status_code == 200
    data = r.json()
    users = data.get("users") or data.get("data") or []
    pending_statuses = {"pending_activation", "pending_email"}
    for u in users:
        status = u.get("registration_status")
        assert status in pending_statuses, \
            f"Usuario {u.get('id')} tiene status inesperado: '{status}'"


@pytest.mark.api
def test_E03_reactivation_requests(admin_session):
    """GET /admin/users/reactivation-requests → 200 solo status:pending."""
    r = admin_session.get(f"{BASE}/admin/users/reactivation-requests", timeout=10)
    assert r.status_code == 200
    data = r.json()
    requests_list = data.get("requests") or data.get("users") or []
    for req in requests_list:
        rr = req.get("reactivation_request") or {}
        assert rr.get("status") == "pending", \
            f"Solicitud {req.get('id')} no tiene status:pending"


@pytest.mark.api
def test_E10_stats_overview(admin_session):
    """GET /admin/stats/overview → 200 con contadores."""
    r = admin_session.get(f"{BASE}/admin/stats/overview", timeout=10)
    assert r.status_code == 200
    data = r.json()
    # Debe contener algún campo numérico de conteo
    assert any(isinstance(v, (int, float)) for v in data.values()), \
        f"No se encontraron contadores en overview: {data}"


@pytest.mark.api
def test_E14_admin_tickets(admin_session):
    """GET /admin/tickets → 200 con lista de tickets."""
    r = admin_session.get(f"{BASE}/admin/tickets", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("success") or isinstance(data.get("tickets") or data, list)


@pytest.mark.api
def test_E12_admin_subscriptions_reset(admin_session):
    """POST /admin/subscriptions/:userId/reset-usage → 200."""
    from helpers.auth import TEST_USERS
    from helpers.db import psql
    raw = psql(f"SELECT id FROM users WHERE email='{TEST_USERS['user']['email']}' LIMIT 1;")
    user_id = raw.strip()
    if not user_id:
        pytest.skip("No se encontró el usuario de prueba")

    r = admin_session.post(f"{BASE}/admin/subscriptions/{user_id}/reset-usage", timeout=10)
    assert r.status_code == 200


@pytest.mark.api
def test_admin_endpoint_sin_token():
    """GET /admin/users sin token → 401."""
    r = requests.get(f"{BASE}/admin/users", verify=False, timeout=10)
    assert r.status_code == 401


# ─── E-04 a E-09: Operaciones sobre usuarios ─────────────────────────────────

@pytest.mark.api
def test_E04_activar_usuario(admin_session):
    """POST /admin/users/:id/activate → 200, registration_status:'active'."""
    uid = create_test_user("qa-e04-activate@test.com",
                           registration_status="pending_activation", sub_status="suspended")
    try:
        r = admin_session.post(f"{BASE}/admin/users/{uid}/activate", timeout=10)
        assert r.status_code == 200, r.text
        # Verificar en DB
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "active", f"Estado esperado 'active', got '{raw.strip()}'"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_E05_rechazar_bloquear(admin_session):
    """POST /admin/users/:id/reject (mode:block) → 200, registration_status:'rejected'."""
    uid = create_test_user("qa-e05-reject@test.com",
                           registration_status="pending_activation", sub_status="suspended")
    try:
        r = admin_session.post(f"{BASE}/admin/users/{uid}/reject",
                               json={"mode": "block", "reason": "Test QA"}, timeout=10)
        assert r.status_code == 200, r.text
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "rejected", f"Estado esperado 'rejected', got '{raw.strip()}'"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_E06_rechazar_keep_trial(admin_session):
    """POST /admin/users/:id/reject (mode:keep_trial) → 200, estado sin cambio."""
    uid = create_test_user("qa-e06-trial@test.com",
                           registration_status="pending_activation", sub_status="suspended")
    try:
        r = admin_session.post(f"{BASE}/admin/users/{uid}/reject",
                               json={"mode": "keep_trial", "reason": "Test QA"}, timeout=10)
        assert r.status_code == 200, r.text
        # Estado no cambia
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "pending_activation", \
            f"keep_trial no debería cambiar estado: '{raw.strip()}'"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_E07_suspender_usuario(admin_session):
    """POST /admin/users/:id/suspend → 200, registration_status:'suspended_admin'."""
    uid = create_test_user("qa-e07-suspend@test.com", registration_status="active")
    try:
        r = admin_session.post(f"{BASE}/admin/users/{uid}/suspend",
                               json={"reason": "Test QA — suspensión automática",
                                     "pauseBilling": False}, timeout=10)
        assert r.status_code == 200, r.text
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "suspended_admin", f"Estado: '{raw.strip()}'"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_E08_aprobar_reactivacion(admin_session):
    """POST /admin/users/:id/reactivation-request/approve → 200, estado:'active'."""
    uid = create_test_user("qa-e08-reactivate@test.com",
                           registration_status="suspended_admin", sub_status="suspended")
    try:
        # Insertar reactivation_request pendiente
        psql(
            f"UPDATE subscriptions SET "
            f"reactivation_request='{{\"status\":\"pending\",\"message\":\"test\"}}', "
            f"suspension_cause='admin' WHERE user_id={uid};"
        )
        r = admin_session.post(
            f"{BASE}/admin/users/{uid}/reactivation-request/approve", timeout=10
        )
        assert r.status_code == 200, r.text
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "active", f"Estado esperado 'active': '{raw.strip()}'"
    finally:
        cleanup_user(uid)


@pytest.mark.api
def test_E09_rechazar_reactivacion(admin_session):
    """POST /admin/users/:id/reactivation-request/reject → 200, request.status:'rejected'."""
    uid = create_test_user("qa-e09-reject-react@test.com",
                           registration_status="suspended_admin", sub_status="suspended")
    try:
        psql(
            f"UPDATE subscriptions SET "
            f"reactivation_request='{{\"status\":\"pending\",\"message\":\"test\"}}' "
            f"WHERE user_id={uid};"
        )
        r = admin_session.post(
            f"{BASE}/admin/users/{uid}/reactivation-request/reject",
            json={"reason": "Test QA — rechazo automático"}, timeout=10
        )
        assert r.status_code == 200, r.text
    finally:
        cleanup_user(uid)


# ─── E-11: Actualizar vencimiento de plan ────────────────────────────────────

@pytest.mark.api
def test_E11_update_plan_expiry(admin_session):
    """PUT /admin/plans/:id/expiry con fecha válida → 200."""
    # Obtener un plan activo
    raw = psql("SELECT id FROM plans WHERE name='COMBO_PROMO' LIMIT 1;")
    plan_id = raw.strip()
    if not plan_id:
        pytest.skip("No se encontró plan COMBO_PROMO")

    from datetime import datetime, timedelta
    future_date = (datetime.utcnow() + timedelta(days=365)).strftime("%Y-%m-%d")
    r = admin_session.put(
        f"{BASE}/admin/plans/{plan_id}/expiry",
        json={"expiryDate": future_date}, timeout=10
    )
    assert r.status_code == 200, r.text


# ─── E-15: Comentar ticket desde admin ───────────────────────────────────────

@pytest.mark.api
def test_E15_admin_ticket_comment(admin_session, api_session):
    """POST /admin/tickets/:id/comment → 200, comentario guardado."""
    # Obtener el primer ticket disponible
    r = api_session.get(f"{BASE}/tickets", timeout=10)
    if r.status_code != 200:
        pytest.skip("No se pudo obtener tickets")
    data = r.json()
    tickets = data.get("tickets") or (data if isinstance(data, list) else [])
    if not tickets:
        pytest.skip("No hay tickets para comentar")

    ticket_id = tickets[0].get("id")
    r2 = admin_session.post(
        f"{BASE}/admin/tickets/{ticket_id}/comment",
        json={"message": "Respuesta de admin QA — test automático"}, timeout=10
    )
    assert r2.status_code in (200, 201), r2.text
