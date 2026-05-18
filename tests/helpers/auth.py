"""
helpers/auth.py — Obtención de tokens JWT para los tests.

Estrategia:
  1. Intenta login HTTP normal (POST /auth/login).
  2. Si falla (rate limit, estado bloqueado, etc.) genera el token
     directamente en el servidor via SSH + Node.js, replicando
     exactamente el mismo payload que usa la API real: {id, role}.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import textwrap
from typing import Optional

import requests

# ─── Constantes ────────────────────────────────────────────────────────────────
API_URL = "https://api.procuradortool.com"
SSH_KEY = "C:/Users/JONATHAN/.ssh/do_procurador"
SSH_HOST = "root@142.93.64.94"
BACKEND_PATH = "/var/www/procurador/backend-server"

# Credenciales de los usuarios de prueba que deben existir en la DB
TEST_USERS = {
    "user":  {"email": "procuradortool@gmail.com", "password": "TestPass2025!", "machine_id": "TEST-CLAUDE-QA"},
    "admin": {"email": "admin@procurador.com",      "password": "Admin2025!",   "machine_id": "TEST-CLAUDE-ADMIN"},
}


# ─── Login HTTP normal ──────────────────────────────────────────────────────────
def login_http(email: str, password: str, machine_id: str = "TEST-QA") -> Optional[str]:
    """Hace POST /auth/login y devuelve el token, o None si falla."""
    try:
        r = requests.post(
            f"{API_URL}/auth/login",
            json={"email": email, "password": password, "machineId": machine_id},
            timeout=10,
            verify=False,
        )
        data = r.json()
        return data.get("token")
    except Exception:
        return None


# ─── Generación de token via SSH ───────────────────────────────────────────────
def _ssh_run(remote_cmd: str) -> str:
    """Ejecuta un comando en el servidor via SSH y retorna stdout."""
    result = subprocess.run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", SSH_HOST, remote_cmd],
        capture_output=True,
        text=True,
        timeout=20,
    )
    return result.stdout.strip()


def generate_token_ssh(user_id: int, role: str = "user") -> str:
    """
    Genera un JWT válido directamente en el servidor usando el JWT_SECRET real.
    Payload idéntico al de la API: { id, role }.
    """
    js_code = textwrap.dedent(f"""
        require('dotenv').config({{ quiet: true }});
        const jwt = require('jsonwebtoken');
        const tok = jwt.sign({{ id: {user_id}, role: '{role}' }}, process.env.JWT_SECRET, {{ expiresIn: '2h' }});
        process.stdout.write(tok + '\\n');
    """).strip()

    # Escribir el script en un archivo temporal local y subirlo via SCP
    with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False) as f:
        f.write(js_code)
        local_path = f.name

    remote_path = f"{BACKEND_PATH}/_qa_token_{user_id}.js"
    try:
        subprocess.run(
            ["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
             local_path, f"{SSH_HOST}:{remote_path}"],
            check=True, capture_output=True, timeout=15,
        )
        token = _ssh_run(
            f"cd {BACKEND_PATH} && node _qa_token_{user_id}.js 2>/dev/null && rm -f _qa_token_{user_id}.js"
        )
    finally:
        os.unlink(local_path)

    if not token:
        raise RuntimeError(f"No se pudo generar token SSH para user_id={user_id}")
    return token


# ─── Helpers de alto nivel ─────────────────────────────────────────────────────
def get_user_token() -> str:
    """Token del usuario de prueba (procuradortool@gmail.com). Fallback a SSH."""
    u = TEST_USERS["user"]
    token = login_http(u["email"], u["password"], u["machine_id"])
    if token:
        return token
    # Obtener el ID del usuario desde la DB
    raw = _ssh_run(
        f"sudo -u postgres psql procurador_db -t -c "
        f"\"SELECT id FROM users WHERE email='{u['email']}';\" 2>/dev/null"
    )
    user_id = int(raw.strip())
    return generate_token_ssh(user_id, role="user")


def get_admin_token() -> str:
    """Token del admin (admin@procurador.com). Fallback a SSH."""
    u = TEST_USERS["admin"]
    token = login_http(u["email"], u["password"], u["machine_id"])
    if token:
        return token
    raw = _ssh_run(
        f"sudo -u postgres psql procurador_db -t -c "
        f"\"SELECT id FROM users WHERE email='{u['email']}';\" 2>/dev/null"
    )
    user_id = int(raw.strip())
    return generate_token_ssh(user_id, role="admin")


def get_token_for_user_id(user_id: int, role: str = "user") -> str:
    """Genera un token SSH para cualquier user_id dado (útil para usuarios bloqueados)."""
    return generate_token_ssh(user_id, role)
