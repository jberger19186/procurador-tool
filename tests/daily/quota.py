"""
tests/daily/quota.py — cupo de la cuenta de verificación (Etapa 1.5 F2).

Decisión del operador (2026-08-27): el script recarga cupo SOLO, sin flag ni
confirmación. Es seguro porque el endpoint ya trae sus propias protecciones
(no se duplican acá): VERIF_TECHO_BONUS=200 acumulado por submódulo que nunca
se resetea, tope por llamada, y hasta 5 recargas por ventana móvil de 24 h.
Ver routes/admin.js y CLAUDE.md § "corré la prueba diaria de la app".
"""

from __future__ import annotations

import sys
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

import requests

from daily.config import API_URL


def get_quota(admin_token: str) -> dict:
    """GET /admin/diagnostics/verification/quota — lectura, sin efectos."""
    r = requests.get(
        f"{API_URL}/admin/diagnostics/verification/quota",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15, verify=False,
    )
    r.raise_for_status()
    return r.json()["cupo"]


def ensure_quota(admin_token: str) -> dict:
    """
    Garantiza que haya cupo para al menos 1 corrida, recargando si hace falta.

    Siempre llama al endpoint de top-up (es idempotente: si ya alcanza,
    responde `aplicado:false, motivo:'ya_alcanza'` sin tocar nada — no hay
    costo en llamarlo de más). Devuelve un dict con:
      - cupo: el estado final
      - recargo: bool, si esta llamada aplicó una recarga real
      - recargas_restantes / recargas_maximo: si vinieron en la respuesta
      - bloqueado: bool — True si el cupo NO alcanza para 1 corrida y no se
        pudo destrabar (cooldown agotado con cupo insuficiente)
      - motivo_bloqueo: mensaje legible, solo si bloqueado=True
    """
    r = requests.post(
        f"{API_URL}/admin/diagnostics/verification/quota/top-up",
        headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
        json={}, timeout=20, verify=False,
    )
    body = r.json()

    if r.status_code == 429:
        # Cooldown agotado (motivo='cooldown'). El cupo que trae el propio 429
        # es el real — puede alcanzar igual (recarga de otra sesión reciente)
        # o no. Se decide mirando el cupo, no el status code por sí solo.
        cupo = body.get("cupo") or get_quota(admin_token)
        usadas = body.get("usadas")
        maximo = body.get("maximo")
        restantes = (maximo - usadas) if (usadas is not None and maximo is not None) else 0
        if cupo.get("alcanzaParaUnaPrueba"):
            return {
                "cupo": cupo, "recargo": False,
                "recargas_restantes": restantes, "recargas_maximo": maximo,
                "bloqueado": False,
            }
        return {
            "cupo": cupo, "recargo": False,
            "recargas_restantes": 0, "recargas_maximo": maximo,
            "bloqueado": True,
            "motivo_bloqueo": body.get("error", "Cooldown agotado y el cupo no alcanza."),
        }

    r.raise_for_status()
    cupo = body["cupo"]
    return {
        "cupo": cupo,
        "recargo": bool(body.get("aplicado")),
        "recargas_restantes": body.get("recargasRestantes"),
        "recargas_maximo": body.get("recargasMaximo"),
        "bloqueado": not cupo.get("alcanzaParaUnaPrueba", False),
        "motivo_bloqueo": None if cupo.get("alcanzaParaUnaPrueba") else "El cupo no alcanza ni tras la recarga.",
    }


def resumen_legible(estado_cupo: dict) -> str:
    """Tabla de texto plano para la salida de consola del CLI."""
    cupo = estado_cupo["cupo"]
    lineas = []
    if estado_cupo["recargo"]:
        rr = estado_cupo.get("recargas_restantes")
        rm = estado_cupo.get("recargas_maximo")
        extra = f" (quedan {rr}/{rm} recargas en 24h)" if rr is not None else ""
        lineas.append(f"  🔋 Cupo recargado automáticamente.{extra}")
    for k, sub in cupo.get("submodulos", {}).items():
        estado = "✅" if sub["remaining"] >= sub["costoPorPrueba"] else "⚠️"
        lineas.append(
            f"  {estado} {k:<20} {sub['remaining']:>4} restantes"
            f" (necesita {sub['costoPorPrueba']})"
        )
    g = cupo["global"]
    estado_g = "✅" if g["remaining"] >= g["costoPorPrueba"] else "⚠️"
    lineas.append(f"  {estado_g} {'global':<20} {g['remaining']:>4} restantes (necesita {g['costoPorPrueba']})")
    lineas.append(f"  alcanzaParaUnaPrueba={cupo['alcanzaParaUnaPrueba']} · alcanzaParaReserva={cupo['alcanzaParaReserva']}")
    return "\n".join(lineas)
