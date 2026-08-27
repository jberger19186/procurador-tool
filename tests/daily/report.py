"""
tests/daily/report.py — construye y postea el reporte a
POST /admin/diagnostics/verification/report (mismo endpoint que usó la
corrida manual del 2026-08-27; la tarjeta "Verificación funcional (PJN real)"
del dashboard se actualiza igual, cambia solo cómo se corre, no dónde se ve).
"""

from __future__ import annotations

import sys
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

import requests

from daily.config import API_URL, NOMBRES_FLUJO
from daily.results import ResultadoFlujo


def build_payload(resultados: list[ResultadoFlujo], notas: str = "") -> dict:
    estados = {r.estado for r in resultados}
    if estados <= {"ok"}:
        estado_general = "ok"
    elif "error" in estados:
        estado_general = "parcial" if "ok" in estados else "error"
    else:
        estado_general = "parcial"  # solo sin_datos / omitido junto con ok

    flujos = []
    for r in resultados:
        estado_reportado = "omitido" if r.estado == "sin_datos" else r.estado
        flujos.append({
            "clave": r.clave,
            "estado": estado_reportado,
            "detalle": r.detalle,
        })

    return {
        "estado": estado_general,
        # El backend solo distingue 2 valores de origen: 'app-automatica' (F5,
        # desatendido) y cualquier otra cosa cae a 'computer-use' (routes/admin.js,
        # el reporte no valida contra una lista abierta). 'script-daily' se pisa en
        # silencio con 'computer-use' — hallazgo de F1, no bloqueante: las `notas`
        # SÍ quedan tal cual, así que el origen real sigue siendo legible en el
        # detalle. Ampliar la whitelist del backend queda como candidato de F3 si
        # se quiere distinguir en la propia tarjeta, no en las notas.
        "origen": "script-daily",
        "flujos": flujos,
        "notas": notas,
    }


def post_report(admin_token: str, resultados: list[ResultadoFlujo], notas: str = "") -> dict:
    payload = build_payload(resultados, notas)
    r = requests.post(
        f"{API_URL}/admin/diagnostics/verification/report",
        headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
        json=payload, timeout=20, verify=False,
    )
    r.raise_for_status()
    return r.json()


def resumen_legible(resultados: list[ResultadoFlujo]) -> str:
    lineas = []
    for r in resultados:
        icono = {"ok": "✅", "error": "❌", "sin_datos": "⬜"}.get(r.estado, "?")
        nombre = NOMBRES_FLUJO.get(r.clave, r.clave)
        lineas.append(f"  {icono} {nombre:<28} {r.detalle}")
    return "\n".join(lineas)
