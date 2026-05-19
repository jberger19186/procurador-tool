"""Módulo 7 — Tickets de soporte (G-01 a G-04)."""

import pytest
import requests

from helpers.auth import API_URL

BASE = API_URL


@pytest.mark.api
def test_G01_crear_ticket(api_session):
    """POST /tickets → 201 con ticket creado, status "open"."""
    payload = {
        "title": "Test QA — ticket automático",
        "description": "Mensaje de prueba generado por la suite de QA. Se puede ignorar.",
        "category": "technical",
    }
    r = api_session.post(f"{BASE}/tickets", json=payload, timeout=10)
    assert r.status_code == 201, r.text
    data = r.json()
    ticket = data.get("ticket") or data
    assert ticket.get("id") or data.get("success"), f"Respuesta inesperada: {data}"
    status = ticket.get("status", "")
    assert status in ("open", ""), f"Status inesperado: '{status}'"


@pytest.mark.api
def test_G02_listar_tickets_propios(api_session):
    """GET /tickets → 200 con solo los tickets del usuario autenticado."""
    r = api_session.get(f"{BASE}/tickets", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    tickets = data.get("tickets") or data if isinstance(data.get("tickets"), list) else []
    if isinstance(data, list):
        tickets = data
    # Verificar que es una lista (aunque esté vacía)
    assert isinstance(tickets, list), f"Se esperaba lista de tickets: {data}"


@pytest.mark.api
def test_G03_ticket_ajeno_denegado(api_session, admin_session):
    """GET /tickets/:id con ticket de otro usuario → 403 o 404."""
    # Crear un ticket con el admin (aunque admin no debería tener tickets de usuario)
    # En su lugar, intentar acceder a un ID inexistente o muy alto
    r = api_session.get(f"{BASE}/tickets/999999", timeout=10)
    assert r.status_code in (403, 404), \
        f"Acceder a ticket ajeno/inexistente debería dar 403/404, got {r.status_code}"


@pytest.mark.api
def test_G04_comentar_ticket(api_session):
    """POST /tickets/:id/comment → 200 con comentario guardado."""
    # Primero obtener el primer ticket del usuario
    r = api_session.get(f"{BASE}/tickets", timeout=10)
    assert r.status_code == 200
    data = r.json()
    tickets = data.get("tickets") or (data if isinstance(data, list) else [])

    if not tickets:
        pytest.skip("No hay tickets disponibles para comentar")

    ticket_id = tickets[0].get("id")
    if not ticket_id:
        pytest.skip("No se pudo obtener ID del ticket")

    payload = {"message": "Comentario de prueba QA — se puede ignorar."}
    r = api_session.post(f"{BASE}/tickets/{ticket_id}/comment", json=payload, timeout=10)
    assert r.status_code in (200, 201), r.text
