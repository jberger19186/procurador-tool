"""
tests/daily/preflight.py — chequeo previo a la corrida: cupo (con recarga
automática si hace falta) + partes con línea base. No lanza la app ni corre
ningún flujo — eso es F2/F3.

Uso: python tests/daily/preflight.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from helpers.auth import get_admin_token, get_token_for_user_id

from daily import partes as partes_mod
from daily import quota as quota_mod
from daily.config import VERIFICATION_USER_ID


def run() -> bool:
    """Devuelve True si está todo en orden para arrancar la corrida."""
    print("=== Pre-vuelo: prueba diaria de la app ===\n")

    print("1) Cupo de la cuenta de verificación")
    admin_token = get_admin_token()
    estado_cupo = quota_mod.ensure_quota(admin_token)
    print(quota_mod.resumen_legible(estado_cupo))

    if estado_cupo["bloqueado"]:
        print(f"\n❌ BLOQUEADO: {estado_cupo['motivo_bloqueo']}")
        print("   Salida inmediata: Usos Extra o Ajustes Manuales en la ficha del usuario 250.")
        return False

    print("\n2) Partes del Monitor")
    user_token = get_token_for_user_id(VERIFICATION_USER_ID, role="user")
    partes = partes_mod.get_partes(user_token)
    print(partes_mod.resumen_legible(partes))

    base = partes_mod.con_linea_base(partes)
    if not base:
        print("\n⚠️  Ninguna parte tiene línea base — 'Buscar Novedades' no tendría nada que comparar.")
        print("   (F2 resuelve esto con la parte descartable DON COCHO — §6.6 de la propuesta)")

    print("\n✅ Pre-vuelo OK — se puede arrancar la corrida.")
    return True


if __name__ == "__main__":
    ok = run()
    sys.exit(0 if ok else 1)
