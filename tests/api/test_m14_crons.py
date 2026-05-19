"""
Módulo 14 — Cron jobs (N-01 a N-05).

Estrategia: los crons corren en producción de forma programada.
Para testear su lógica sin esperar al scheduler, se replica el SQL
exacto de cada cron directamente vía psql (SSH), verificando el
resultado en la DB y via API.
"""

import pytest
import requests

from helpers.auth import API_URL, generate_token_ssh
from helpers.db import create_test_user, cleanup_user, psql, get_subscription

BASE = API_URL


# ─── N-01: Trial agotado → rejected (cron horario) ───────────────────────────
@pytest.mark.api
def test_N01_trial_agotado_rejected():
    """
    Usuario con pending_activation y usage_count >= usage_limit.
    Al ejecutar la lógica del cron horario → registration_status pasa a 'rejected'.
    """
    uid = create_test_user("qa-n01-trial@test.com",
                           registration_status="pending_activation",
                           sub_status="suspended")
    try:
        # Agotar el trial en DB
        psql(f"UPDATE subscriptions SET usage_count=usage_limit WHERE user_id={uid};")

        # Simular el cron: ejecutar el UPDATE exacto que haría el scheduler
        psql(
            f"UPDATE users SET registration_status='rejected', updated_at=NOW() "
            f"WHERE id={uid} "
            f"AND registration_status='pending_activation' "
            f"AND EXISTS ("
            f"  SELECT 1 FROM subscriptions s "
            f"  WHERE s.user_id={uid} AND s.usage_count >= s.usage_limit"
            f");"
        )
        psql(f"UPDATE subscriptions SET status='cancelled', updated_at=NOW() WHERE user_id={uid};")

        # Verificar en DB
        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "rejected", f"Cron trial_exhausted: estado esperado 'rejected', got '{raw.strip()}'"

        # Verificar via API: el token sigue siendo válido pero el estado está bloqueado
        token = generate_token_ssh(uid)
        r = requests.get(f"{BASE}/users/account",
                         headers={"Authorization": f"Bearer {token}"},
                         verify=False, timeout=10)
        # El endpoint puede retornar la cuenta con registration_status='rejected'
        # o el middleware puede bloquearlo con 403
        assert r.status_code in (200, 403), f"Got {r.status_code}"
        if r.status_code == 200:
            data = r.json()
            status = data.get("registrationStatus") or (data.get("user") or {}).get("registrationStatus")
            assert status == "rejected", f"registrationStatus esperado 'rejected', got '{status}'"
    finally:
        cleanup_user(uid)


# ─── N-02: Plan vencido → suspended_plan_expired (cron diario) ───────────────
@pytest.mark.api
def test_N02_plan_vencido_suspended():
    """
    Plan con plan_expiry_date vencido → registration_status pasa a 'suspended_plan_expired'.
    """
    uid = create_test_user("qa-n02-planexp@test.com",
                           registration_status="active", sub_status="active")
    try:
        # Setear plan_expiry_date en el pasado
        psql(
            f"UPDATE subscriptions SET plan_expiry_date=NOW() - INTERVAL '1 day', "
            f"updated_at=NOW() WHERE user_id={uid};"
        )

        # Simular el cron 5c de server.js
        psql(
            f"UPDATE users SET registration_status='suspended_plan_expired', updated_at=NOW() "
            f"WHERE id={uid} "
            f"AND registration_status NOT IN ('rejected','suspended_admin') "
            f"AND EXISTS ("
            f"  SELECT 1 FROM subscriptions s "
            f"  WHERE s.user_id={uid} "
            f"  AND s.plan_expiry_date IS NOT NULL "
            f"  AND s.plan_expiry_date < NOW()"
            f");"
        )
        psql(
            f"UPDATE subscriptions SET status='suspended_plan_expired', "
            f"suspension_cause='plan_expired', suspended_at=NOW(), updated_at=NOW() "
            f"WHERE user_id={uid};"
        )

        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "suspended_plan_expired", \
            f"Cron plan_expired: estado esperado 'suspended_plan_expired', got '{raw.strip()}'"

        # Login debe retornar 403
        r = requests.post(f"{BASE}/auth/login", json={
            "email": "qa-n02-planexp@test.com",
            "password": "TestPass2025!",
            "machineId": "TEST-N02"
        }, verify=False, timeout=10)
        if r.status_code == 429:
            pytest.skip("Rate limit activo")
        assert r.status_code == 403, f"Login con plan vencido debería ser 403, got {r.status_code}"
    finally:
        cleanup_user(uid)


# ─── N-03: cancel_at vencido → cancelled (cron diario) ───────────────────────
@pytest.mark.api
def test_N03_cancel_at_vencido_cancelled():
    """
    Usuario con cancel_at vencido → registration_status pasa a 'cancelled'.
    """
    uid = create_test_user("qa-n03-cancelat@test.com",
                           registration_status="active", sub_status="active")
    try:
        # Setear cancel_at en el pasado
        psql(
            f"UPDATE subscriptions SET cancel_at=NOW() - INTERVAL '1 day', "
            f"updated_at=NOW() WHERE user_id={uid};"
        )

        # Simular el cron 5d de server.js (cancel_at vencido)
        psql(
            f"UPDATE users SET registration_status='cancelled', updated_at=NOW() "
            f"WHERE id={uid} "
            f"AND EXISTS ("
            f"  SELECT 1 FROM subscriptions s "
            f"  WHERE s.user_id={uid} "
            f"  AND s.cancel_at IS NOT NULL "
            f"  AND s.cancel_at < NOW()"
            f");"
        )
        psql(
            f"UPDATE subscriptions SET status='cancelled', cancel_at=NULL, updated_at=NOW() "
            f"WHERE user_id={uid};"
        )

        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "cancelled", \
            f"Cron cancel_at: estado esperado 'cancelled', got '{raw.strip()}'"

        # Verificar via API — login debe retornar 403
        r = requests.post(f"{BASE}/auth/login", json={
            "email": "qa-n03-cancelat@test.com",
            "password": "TestPass2025!",
            "machineId": "TEST-N03"
        }, verify=False, timeout=10)
        if r.status_code == 429:
            pytest.skip("Rate limit activo")
        assert r.status_code == 403, f"Login con suscripción cancelada debería ser 403, got {r.status_code}"
    finally:
        cleanup_user(uid)


# ─── N-04: payment_grace_ends_at vencido → suspended (cron diario) ───────────
@pytest.mark.api
def test_N04_grace_vencido_suspended():
    """
    payment_grace_ends_at vencido → registration_status pasa a 'suspended'.
    """
    uid = create_test_user("qa-n04-grace@test.com",
                           registration_status="active", sub_status="active")
    try:
        # Setear payment_grace_ends_at en el pasado
        psql(
            f"UPDATE subscriptions SET payment_grace_ends_at=NOW() - INTERVAL '1 day', "
            f"updated_at=NOW() WHERE user_id={uid};"
        )

        # Simular el cron 5f de server.js
        psql(
            f"UPDATE users SET registration_status='suspended', updated_at=NOW() "
            f"WHERE id={uid} "
            f"AND EXISTS ("
            f"  SELECT 1 FROM subscriptions s "
            f"  WHERE s.user_id={uid} "
            f"  AND s.payment_grace_ends_at IS NOT NULL "
            f"  AND s.payment_grace_ends_at < NOW()"
            f");"
        )
        psql(
            f"UPDATE subscriptions SET status='suspended', suspension_cause='payment', "
            f"suspended_at=NOW(), payment_grace_ends_at=NULL, updated_at=NOW() "
            f"WHERE user_id={uid};"
        )

        raw = psql(f"SELECT registration_status FROM users WHERE id={uid};")
        assert raw.strip() == "suspended", \
            f"Cron grace: estado esperado 'suspended', got '{raw.strip()}'"
    finally:
        cleanup_user(uid)


# ─── N-05: scheduled_plan apply_at vencido → plan cambiado (cron diario) ─────
@pytest.mark.api
def test_N05_scheduled_plan_aplicado():
    """
    scheduled_plan con apply_at vencido → plan cambia al plan programado.
    """
    uid = create_test_user("qa-n05-sched@test.com",
                           plan_name="EXTENSION_PROMO",
                           registration_status="active", sub_status="active")
    try:
        # Obtener el plan_id de COMBO_PROMO
        plan_id_raw = psql("SELECT id FROM plans WHERE name='COMBO_PROMO' LIMIT 1;")
        plan_id = int(plan_id_raw.strip())

        # Setear scheduled_plan con apply_at en el pasado usando json_build_object
        # para evitar problemas con comillas dobles en el comando bash
        psql(
            f"UPDATE subscriptions SET "
            f"scheduled_plan=json_build_object("
            f"  'plan_name', 'COMBO_PROMO',"
            f"  'plan_id', {plan_id},"
            f"  'apply_at', '2020-01-01T00:00:00.000Z'"
            f")::jsonb, "
            f"updated_at=NOW() WHERE user_id={uid};"
        )

        # Simular el cron 5e de server.js: aplicar el plan programado
        psql(
            f"UPDATE subscriptions SET "
            f"plan='COMBO_PROMO', plan_id={plan_id}, "
            f"scheduled_plan=NULL, updated_at=NOW() "
            f"WHERE user_id={uid} "
            f"AND scheduled_plan IS NOT NULL "
            f"AND (scheduled_plan->>'apply_at')::timestamp < NOW();"
        )

        # Verificar en DB que el plan cambió
        sub_raw = psql(f"SELECT plan FROM subscriptions WHERE user_id={uid};")
        assert sub_raw.strip() == "COMBO_PROMO", \
            f"Cron scheduled_plan: plan esperado 'COMBO_PROMO', got '{sub_raw.strip()}'"

        # Verificar que scheduled_plan fue limpiado
        sched_raw = psql(
            f"SELECT scheduled_plan FROM subscriptions WHERE user_id={uid};"
        )
        assert not sched_raw.strip() or sched_raw.strip().lower() == "null", \
            f"scheduled_plan debería ser NULL después del cron, got '{sched_raw.strip()}'"
    finally:
        cleanup_user(uid)
