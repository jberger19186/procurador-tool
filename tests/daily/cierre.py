"""
tests/daily/cierre.py — lee los resultados que dejó la corrida (manual o de
F2), reporta al dashboard, cierra la app y enumera las pestañas de Chrome que
quedaron abiertas (no se pueden cerrar por código, ver §4 de la propuesta).

Uso: python tests/daily/cierre.py [--desde-epoch 1234567890] [--flujos proc,batch,informe,informe_lote,monitor]

Sin --desde-epoch, toma el visor más reciente de cada tipo sin filtrar por
fecha (riesgo de leer un resultado viejo si un flujo no llegó a correr —
preferible usar --desde-epoch cuando se sepa el instante exacto en que
arrancó la corrida, que es lo que hace `run.py`).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from helpers.auth import get_admin_token

from daily import close_env
from daily import report as report_mod
from daily.results import leer_ultimo_resultado

FLUJOS_DEFAULT = ["proc", "batch", "informe", "informe_lote", "monitor"]


def run(
    flujos: list[str],
    desde_epoch: float | None,
    notas: str = "",
    origen: str = "script-daily",
    forzar_error: bool = False,
) -> dict:
    print("=== Cierre: leyendo resultados y reportando ===\n")

    resultados = [leer_ultimo_resultado(clave, desde_epoch) for clave in flujos]
    print(report_mod.resumen_legible(resultados))

    sin_datos = [r for r in resultados if r.estado == "sin_datos"]
    if sin_datos:
        claves = ", ".join(r.clave for r in sin_datos)
        print(f"\n⚠️  Sin visor encontrado para: {claves} — se reportan como 'omitido'.")

    print("\nPosteando a Verificación funcional (PJN real)...")
    admin_token = get_admin_token()
    resp = report_mod.post_report(admin_token, resultados, notas, origen=origen, forzar_error=forzar_error)
    print(f"  ✅ Reportado. estado general: {resp['entry']['estado']}")

    print("\nCerrando la app...")
    limpio = close_env.close_app()
    print("  ✅ Cerrada limpio" if limpio else "  ⚠️  Se forzó el cierre (CloseMainWindow no bastó)")

    print("\nPestañas de Chrome que quedaron abiertas:")
    titulos = close_env.list_chrome_tab_titles()
    if titulos:
        for t in titulos:
            print(f"  📄 {t}")
        print(f"  → {len(titulos)} pestaña(s) — cerralas manualmente cuando quieras.")
    else:
        print("  (ninguna, o Chrome no está corriendo)")

    return {"resultados": resultados, "reporte": resp, "pestañas_abiertas": titulos}


def main():
    parser = argparse.ArgumentParser(description="Cierre de la prueba diaria: lee resultados, reporta, cierra la app.")
    parser.add_argument("--desde-epoch", type=float, default=None, help="Ignorar visores anteriores a este timestamp Unix.")
    parser.add_argument("--flujos", type=str, default=",".join(FLUJOS_DEFAULT), help="Lista de flujos separados por coma.")
    parser.add_argument("--notas", type=str, default="", help="Notas libres para el reporte.")
    args = parser.parse_args()

    flujos = [f.strip() for f in args.flujos.split(",") if f.strip()]
    run(flujos, args.desde_epoch, args.notas)


if __name__ == "__main__":
    main()
