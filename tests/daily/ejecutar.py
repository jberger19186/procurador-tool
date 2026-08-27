"""
tests/daily/ejecutar.py — F2: dispara los 6 flujos reales contra el PJN vía
`window.electronAPI`, sin ningún click ni diálogo nativo. Es el módulo que
reemplaza la corrida manual con computer-use. El punto de entrada
recomendado es `cli.py` (F3), que expone este módulo como el modo por
defecto — este archivo sigue siendo ejecutable directo si hace falta.

🚨 Consume cupo real: proc +1, batch +1, informe +3 (compartido individual y
lote), monitor +3 (1 por parte activa en el momento de "novedades" — incluye
la parte descartable), global +6. Ver §6.1: la recarga de cupo, si hiciera
falta, es automática.

🚨 Requiere el setup de una sola vez de §6.6: que NO exista ya una parte
"DON COCHO"/"FCR" activa (si existe, `crear_parte_descartable()` da 409). El
setup real (borrar la DON COCHO histórica, posible porque pasó los 30 días)
se hizo a mano una sola vez el 2026-08-27 — no lo repite este script.

Uso: python tests/daily/ejecutar.py
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from helpers.auth import get_admin_token

from daily import cierre as cierre_mod
from daily import electron_driver
from daily import flujos
from daily import preflight as preflight_mod
from daily import quota as quota_mod
from daily import resumen as resumen_mod

FLUJOS_REPORTADOS = ["proc", "batch", "informe", "informe_lote", "monitor", "monitor_inicial"]


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")


async def run_async() -> int:
    print("=" * 60)
    print("  F2 — Ejecución real de los 6 flujos contra el PJN")
    print("=" * 60 + "\n")

    ok, detalle_pre = preflight_mod.run(retornar_detalle=True)
    if not ok:
        return 1
    cupo_antes = detalle_pre["cupo"]

    print("\nLanzando la app real y conectando por CDP...")
    proc, pw, browser, page = await electron_driver.launch_and_connect()
    _log("App conectada.")

    marca = time.time()
    parte_descartable_id = None

    try:
        _log("Flujo 1/6 — Procuración...")
        r1 = await flujos.correr_procuracion(page)
        _log(f"  success={r1.get('success')}")

        _log("Flujo 2/6 — Procuración por lote...")
        r2 = await flujos.correr_procuracion_lote(page)
        _log(f"  success={r2.get('success')}")

        _log("Flujo 3/6 — Informe individual...")
        r3 = await flujos.correr_informe_individual(page)
        _log(f"  success={r3.get('success')}")

        _log("Flujo 4/6 — Informe por lote...")
        r4 = await flujos.correr_informe_lote(page)
        _log(f"  success={r4.get('success')}")

        _log("Flujo 6a — Creando parte descartable (DON COCHO)...")
        resp_crear = await flujos.crear_parte_descartable(page)
        if not resp_crear.get("success"):
            raise RuntimeError(f"No se pudo crear la parte descartable: {resp_crear}")
        parte_creada = resp_crear["parte"]
        parte_descartable_id = parte_creada["id"]
        _log(f"  creada id={parte_descartable_id}")

        _log("Flujo 6/6 — Monitor: consulta inicial (sobre la descartable)...")
        r6 = await flujos.correr_monitor_inicial(page, parte_creada)
        _log(f"  success={r6.get('success')}")

        _log("Flujo 5/6 — Monitor: buscar novedades (sobre TODAS las partes activas)...")
        todas_las_partes = await flujos.obtener_partes(page)
        r5 = await flujos.correr_monitor_novedades(page, todas_las_partes)
        _log(f"  success={r5.get('success')}")

    finally:
        if parte_descartable_id is not None:
            _log(f"Borrando parte descartable id={parte_descartable_id}...")
            try:
                resp_borrar = await flujos.eliminar_parte(page, parte_descartable_id)
                _log(f"  {'OK' if resp_borrar.get('success') else 'FALLÓ: ' + str(resp_borrar)}")
            except Exception as e:
                _log(f"  ⚠️  No se pudo borrar la parte descartable: {e}")
                _log(f"     Borrarla a mano: DELETE /monitor/partes/{parte_descartable_id}")

        _log("Desconectando CDP...")
        await electron_driver.disconnect(pw)

    print("\nCerrando la app y reportando (F1)...")
    resultado = cierre_mod.run(FLUJOS_REPORTADOS, desde_epoch=marca, notas="Corrida real vía tests/daily/ejecutar.py (F2/F3, modo automático)")

    admin_token = get_admin_token()
    cupo_despues = quota_mod.get_quota(admin_token)
    resumen_mod.imprimir_resumen_final(
        resultado["resultados"], cupo_antes, cupo_despues,
        detalle_pre.get("recargas_restantes"), resultado["pestañas_abiertas"],
    )

    hubo_error = any(r.estado == "error" for r in resultado["resultados"])
    return 1 if hubo_error else 0


def run() -> int:
    return asyncio.run(run_async())


if __name__ == "__main__":
    sys.exit(run())
