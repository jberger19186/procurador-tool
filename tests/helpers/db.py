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
    # Escapar $ para evitar expansión de variables bash en el host remoto.
    # Los hashes bcrypt contienen $ que bash interpolaría dentro de comillas dobles.
    safe_query = query.replace("$", r"\$")
    cmd = f"sudo -u postgres psql {DB} -t -c \"{safe_query}\" 2>/dev/null"
    result = subprocess.run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", SSH_HOST, cmd],
        capture_output=True, text=True, timeout=30,
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
    """Elimina el usuario de prueba y todos sus registros relacionados (una sola llamada SSH)."""
    combined = (
        f"DELETE FROM ticket_comments WHERE ticket_id IN "
        f"  (SELECT id FROM support_tickets WHERE user_id={user_id}); "
        f"DELETE FROM support_tickets WHERE user_id={user_id}; "
        f"DELETE FROM notifications WHERE user_id={user_id}; "
        f"DELETE FROM user_events WHERE user_id={user_id}; "
        f"DELETE FROM admin_events WHERE user_id={user_id}; "
        f"DELETE FROM usage_logs WHERE user_id={user_id}; "
        f"DELETE FROM active_executions WHERE user_id={user_id}; "
        f"DELETE FROM subscriptions WHERE user_id={user_id}; "
        f"DELETE FROM users WHERE id={user_id};"
    )
    psql(combined)


def random_valid_cuit() -> str:
    """Genera un CUIT aleatorio con dígito verificador correcto."""
    import random
    weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    while True:
        tipo = random.choice(["20", "27", "23"])
        base = "".join([str(random.randint(0, 9)) for _ in range(8)])
        prefix_10 = tipo + base
        s = sum(int(prefix_10[i]) * weights[i] for i in range(10))
        remainder = s % 11
        if remainder == 1:
            continue
        check = 0 if remainder == 0 else 11 - remainder
        return prefix_10 + str(check)


# Hash de "TestPass2025!" — reutilizado para usuarios de prueba sintéticos
TEST_PASSWORD = "TestPass2025!"
TEST_PASSWORD_HASH = "$2b$10$qRlcbP12LK4i26nfi5EPBeOH4xXveKi15Q/5K2EKe2vQyCLkMya1y"


def _psql_int(raw: str) -> int:
    """Extrae el primer entero de la salida de psql (maneja command tags como 'INSERT 0 1')."""
    for line in raw.splitlines():
        s = line.strip()
        if s.lstrip('-').isdigit():
            return int(s)
    raise ValueError(f"No se encontró entero en la salida de psql: {raw!r}")


def create_test_user(email: str,
                     password_hash: str = TEST_PASSWORD_HASH,
                     cuit: str | None = None,
                     plan_name: str = "COMBO_PROMO",
                     registration_status: str = "active",
                     sub_status: str = "active") -> int:
    """
    Crea un usuario de prueba directamente en la DB.
    Si el email ya existe lo elimina antes de insertar (idempotente).
    Retorna el user_id creado.
    """
    # Limpiar usuario anterior si quedó de un run previo
    existing = psql(f"SELECT id FROM users WHERE email='{email}' LIMIT 1;")
    if existing.strip():
        cleanup_user(int(existing.strip()))

    if cuit is None:
        cuit = random_valid_cuit()

    raw = psql(
        f"INSERT INTO users (email, password_hash, cuit, nombre, apellido, "
        f"registration_status, role, created_at, updated_at) "
        f"VALUES ('{email}', '{password_hash}', '{cuit}', 'QA', 'Test', "
        f"'{registration_status}', 'user', NOW(), NOW()) "
        f"RETURNING id;"
    )
    # psql -t no siempre suprime el command tag (INSERT 0 1) en DML+RETURNING
    user_id = _psql_int(raw)

    # Obtener plan_id
    plan_raw = psql(f"SELECT id FROM plans WHERE name='{plan_name}' LIMIT 1;")
    plan_id = _psql_int(plan_raw)

    psql(
        f"INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, "
        f"period_start, expires_at, created_at, updated_at) "
        f"VALUES ({user_id}, '{plan_name}', {plan_id}, '{sub_status}', 0, 20, "
        f"NOW(), NOW() + INTERVAL '30 days', NOW(), NOW());"
    )
    return user_id


def ensure_special_users() -> dict:
    """
    Crea (si no existen) los usuarios de prueba con estados especiales necesarios para A04-A08.
    Retorna un dict con {estado: {email, password, id}}.
    """
    password = TEST_PASSWORD
    phash = TEST_PASSWORD_HASH

    specs = {
        "rejected":              ("qa-sp-rejected@test.com",             "rejected",             "cancelled"),
        "suspended_admin":       ("qa-sp-suspended-admin@test.com",      "suspended_admin",      "suspended"),
        "suspended_plan_expired":("qa-sp-suspended-plan@test.com",       "suspended_plan_expired","suspended"),
        "cancelled":             ("qa-sp-cancelled@test.com",            "cancelled",            "cancelled"),
        "pending_activation":    ("qa-sp-pending-act@test.com",          "pending_activation",   "suspended"),
    }

    result = {}
    for state, (email, reg_status, sub_status) in specs.items():
        raw = psql(f"SELECT id FROM users WHERE email='{email}' LIMIT 1;")
        if raw.strip():
            user_id = _psql_int(raw)
        else:
            user_id = create_test_user(
                email=email,
                password_hash=phash,
                registration_status=reg_status,
                sub_status=sub_status,
            )
            # Para suspended_admin: agregar suspension_cause
            if reg_status == "suspended_admin":
                psql(
                    f"UPDATE subscriptions SET suspension_cause='admin', suspended_at=NOW(), "
                    f"suspension_reason='Test suspension' WHERE user_id={user_id};"
                )

        result[state] = {"email": email, "password": password, "id": user_id}
    return result
