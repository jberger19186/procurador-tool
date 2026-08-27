"""
tests/daily/resumen.py — compara el cupo real consumido contra el modelo
documentado (proc +1 · batch +1 · informe +3 · monitor_novedades +N partes ·
global +6), y arma la tabla final de salida del CLI (F3, §"salida legible").
"""

from __future__ import annotations

import sys
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from daily.config import NOMBRES_FLUJO
from daily.results import ResultadoFlujo


def diff_cupo(cupo_antes: dict, cupo_despues: dict) -> dict:
    """
    Consumo real por submódulo + global, comparado contra el costo por
    prueba que el propio endpoint ya informa (costoPorPrueba). No hardcodea
    el modelo: lo toma del cupo real, así que si el backend cambia un costo
    no queda desactualizado acá.
    """
    diffs = {}
    for k, sub_antes in cupo_antes.get("submodulos", {}).items():
        sub_despues = cupo_despues["submodulos"][k]
        consumido = sub_antes["used"] - sub_despues["used"]
        # `used` puede no subir 1:1 si hubo recarga de bonus en el medio —
        # se reporta el delta real observado, con el costo esperado al lado.
        diffs[k] = {"consumido": consumido, "esperado": sub_despues["costoPorPrueba"]}
    g_antes, g_despues = cupo_antes["global"], cupo_despues["global"]
    diffs["global"] = {
        "consumido": g_antes["used"] - g_despues["used"],
        "esperado": g_despues["costoPorPrueba"],
    }
    return diffs


def tabla_flujos(resultados: list[ResultadoFlujo]) -> str:
    lineas = []
    for r in resultados:
        icono = {"ok": "✅", "error": "❌", "sin_datos": "⬜"}.get(r.estado, "?")
        nombre = NOMBRES_FLUJO.get(r.clave, r.clave)
        lineas.append(f"  {icono} {nombre:<28} {r.detalle}")
    return "\n".join(lineas)


def tabla_cupo(diffs: dict) -> str:
    lineas = []
    for k, d in diffs.items():
        if k == "global":
            continue
        marca = "✅" if d["consumido"] == d["esperado"] else "⚠️"
        lineas.append(f"  {marca} {k:<20} consumido {d['consumido']:>3} (esperado {d['esperado']})")
    g = diffs.get("global")
    if g:
        marca = "✅" if g["consumido"] == g["esperado"] else "⚠️"
        lineas.append(f"  {marca} {'global':<20} consumido {g['consumido']:>3} (esperado {g['esperado']})")
    return "\n".join(lineas)


def imprimir_resumen_final(resultados: list[ResultadoFlujo], cupo_antes: dict, cupo_despues: dict,
                            recargas_restantes: int | None, pestañas: list[str]) -> None:
    print("\n" + "=" * 60)
    print("  RESUMEN FINAL")
    print("=" * 60)

    print("\nFlujos:")
    print(tabla_flujos(resultados))

    print("\nConsumo de cupo (real vs. esperado):")
    print(tabla_cupo(diff_cupo(cupo_antes, cupo_despues)))

    if recargas_restantes is not None:
        print(f"\nRecargas de cupo disponibles en las próximas 24h: {recargas_restantes}")

    print("\nPestañas de Chrome abiertas:")
    if pestañas:
        for t in pestañas:
            print(f"  📄 {t}")
    else:
        print("  (ninguna)")

    hubo_error = any(r.estado == "error" for r in resultados)
    print("\n" + ("❌ Hubo al menos un flujo con error." if hubo_error else "✅ Los 6 flujos en ok."))
