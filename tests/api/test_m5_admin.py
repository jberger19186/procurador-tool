"""Módulo 5 — Endpoints de admin (E-01 a E-15)."""

import pytest
import requests

from helpers.auth import API_URL

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
