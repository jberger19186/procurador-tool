"""
tests/daily/partes.py — estado de las partes del Monitor de la cuenta de
verificación (solo lectura). El alta/baja de la parte descartable (DON COCHO,
§6.6 de la propuesta) vive en F2, junto con la ejecución real de los flujos —
acá solo se INSPECCIONA el estado, no se modifica nada.
"""

from __future__ import annotations

import sys
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

import requests

from daily.config import API_URL


def get_partes(user_token: str) -> list[dict]:
    """GET /monitor/partes — requiere un token de la propia cuenta (no admin)."""
    r = requests.get(
        f"{API_URL}/monitor/partes",
        headers={"Authorization": f"Bearer {user_token}"},
        timeout=15, verify=False,
    )
    r.raise_for_status()
    return r.json()["partes"]


def con_linea_base(partes: list[dict]) -> list[dict]:
    return [p for p in partes if p.get("tiene_linea_base") and p.get("activo")]


def resumen_legible(partes: list[dict]) -> str:
    if not partes:
        return "  ⚠️ No hay ninguna parte cargada en la cuenta de verificación."
    lineas = []
    base = con_linea_base(partes)
    for p in partes:
        marca = "✅" if p.get("tiene_linea_base") else "⬜"
        activo = "" if p.get("activo") else " (inactiva)"
        lineas.append(f"  {marca} {p['nombre_parte']} [{p['jurisdiccion_sigla']}]{activo}")
    lineas.append(f"  → {len(base)}/{len(partes)} con línea base y activas — necesarias para 'Buscar Novedades'")
    return "\n".join(lineas)
