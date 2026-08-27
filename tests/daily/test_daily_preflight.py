"""
tests/daily/test_daily_preflight.py — wrapper pytest del pre-vuelo, marcado
`daily` para que quede excluido de cualquier `pytest` sin filtro explícito
(ver tests/pytest.ini, `addopts = -m "not daily"`).

Por ahora solo cubre el pre-vuelo (F1): cupo + partes, sin correr ningún
flujo real. Cuando F2/F3 existan, este archivo (o uno nuevo al lado) sumará
el resto del ciclo completo bajo el mismo marker.

Uso: pytest -m daily tests/daily/test_daily_preflight.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from daily import preflight


@pytest.mark.daily
def test_preflight_cupo_y_partes():
    """
    Corre el pre-vuelo real contra producción: verifica (y recarga si hace
    falta) el cupo de la cuenta de verificación, y lee el estado de las
    partes del Monitor. No dispara ningún flujo — solo falla si el cupo
    queda bloqueado (cooldown agotado con cupo insuficiente) o si algún
    endpoint no responde.
    """
    ok = preflight.run()
    assert ok, "El pre-vuelo no pasó — ver la salida de consola para el motivo."
