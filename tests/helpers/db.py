"""
helpers/db.py — Operaciones de DB via SSH + psql.

No usa psycopg2 (evita tener que exponer la DB al exterior).
Todas las queries corren en el servidor a través de sudo -u postgres psql.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any

SSH_KEY = "C:/Users/JONATHAN/.ssh/do_procurador"
SSH_HOST = "root@142.93.64.94"
DB = "procurador_db"


def psql(query: str) -> str:
    """Ejecuta una query en producción y retorna el output crudo de psql."""
    cmd = f"sudo -u postgres psql {DB} -t -c \"{query}\" 2>/dev/null"
    result = subprocess.run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", SSH_HOST, cmd],
        capture_output=True, text=True, timeout=20,
    )
    return result.stdout.strip()


def psql_json(query: str) -> Any:
    """Ejecuta una query que retorna JSON y lo parsea. Útil para campos JSONB."""
    raw = psql(query)
    if not raw or raw.lower() in ("", "null"):
        return None
    return json.loads(raw)


def get_user(user_id: int) -> dict:
    """Retorna registration_status del usuario."""
    raw = psql(
        f"SELECT row_to_json(u) FROM "
        f"(SELECT id, email, registration_status, role FROM users WHERE id={user_id}) u;"
    )
    return json.loads(raw) if raw else {}


def get_subscription(user_id: int) -> dict:
    """Retorna todos los campos de la suscripción del usuario."""
    raw = psql(
        f"SELECT row_to_json(s) FROM "
        f"(SELECT * FROM subscriptions WHERE user_id={user_id}) s;"
    )
    return json.loads(raw) if raw else {}


def set_user_status(user_id: int, registration_status: str) -> None:
    psql(f"UPDATE users SET registration_status='{registration_status}', updated_at=NOW() WHERE id={user_id};")


def set_subscription_status(user_id: int, status: str) -> None:
    psql(f"UPDATE subscriptions SET status='{status}', updated_at=NOW() WHERE user_id={user_id};")


def set_plan_expiry(user_id: int, days_from_now: int) -> None:
    """Setea plan_expiry_date N días desde ahora (negativo = ya vencido)."""
    interval = f"NOW() + INTERVAL '{days_from_now} days'"
    psql(
        f"UPDATE subscriptions SET plan_expiry_date={interval}, updated_at=NOW() "
        f"WHERE user_id={user_id};"
    )


def cleanup_user(user_id: int) -> None:
    """Elimina el usuario de prueba y todos sus registros relacionados."""
    queries = [
        f"DELETE FROM ticket_comments WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id={user_id});",
        f"DELETE FROM support_tickets WHERE user_id={user_id};",
        f"DELETE FROM notifications WHERE user_id={user_id};",
        f"DELETE FROM user_events WHERE user_id={user_id};",
        f"DELETE FROM admin_events WHERE user_id={user_id};",
        f"DELETE FROM usage_logs WHERE user_id={user_id};",
        f"DELETE FROM active_executions WHERE user_id={user_id};",
        f"DELETE FROM subscriptions WHERE user_id={user_id};",
        f"DELETE FROM users WHERE id={user_id};",
    ]
    for q in queries:
        psql(q)


def create_test_user(email: str, password_hash: str, cuit: str,
                     plan_name: str = "COMBO_PROMO",
                     registration_status: str = "active") -> int:
    """
    Crea un usuario de prueba directamente en la DB.
    Retorna el user_id creado.
    Útil para tests que necesitan estados específicos sin pasar por el flujo de registro.
    """
    raw = psql(
        f"INSERT INTO users (email, password_hash, cuit, nombre, apellido, "
        f"telefono, registration_status, role, created_at, updated_at) "
        f"VALUES ('{email}', '{password_hash}', '{cuit}', 'QA', 'Test', "
        f"'+5411000000', '{registration_status}', 'user', NOW(), NOW()) "
        f"RETURNING id;"
    )
    user_id = int(raw.strip())

    # Obtener plan_id
    plan_raw = psql(f"SELECT id FROM plans WHERE name='{plan_name}' LIMIT 1;")
    plan_id = int(plan_raw.strip())

    psql(
        f"INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, "
        f"period_start, expires_at, created_at, updated_at) "
        f"VALUES ({user_id}, '{plan_name}', {plan_id}, 'active', 0, 20, "
        f"NOW(), NOW() + INTERVAL '30 days', NOW(), NOW());"
    )
    return user_id
