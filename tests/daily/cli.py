"""
tests/daily/cli.py — F3: punto de entrada único de la prueba diaria.

Fusiona los dos modos existentes en un solo comando (antes eran `ejecutar.py`
y `run.py` por separado, cada uno documentado como comando propio):

  python tests/daily/cli.py               -> modo automático (F2): los 6
                                              flujos por código, sin intervención.
  python tests/daily/cli.py --asistido     -> modo asistido (F1): pre-vuelo +
                                              pausa para correr los flujos vos
                                              (a mano o con computer-use) + cierre.
  python tests/daily/cli.py --desatendido  -> modo desatendido (F5): igual que
                                              el automático, pero pensado para
                                              correr sin nadie mirando (tarea
                                              programada) — loguea a archivo en
                                              vez de solo consola y reporta con
                                              `origen=app-automatica`. Ver §7 de
                                              la propuesta: NO está activado por
                                              defecto en ningún lado todavía.

`ejecutar.py` y `run.py` siguen existiendo y siendo ejecutables por separado
(no se duplicó su lógica, este CLI solo los invoca) — por si alguna vez hace
falta correr un modo puntual sin pasar por el menú de flags.

Uso: python tests/daily/cli.py [--asistido | --desatendido]
"""

from __future__ import annotations

import asyncio
import sys
import time
from argparse import ArgumentParser
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from daily import ejecutar as ejecutar_mod
from daily import run as run_mod

LOGS_DIR = Path(__file__).resolve().parent / "logs"
LOGS_A_CONSERVAR = 30  # ~1 mes de corridas diarias, mismo orden de magnitud que la retención de backups del proyecto


def _rotar_logs() -> None:
    """Conserva solo los últimos LOGS_A_CONSERVAR archivos — sin esto, una
    tarea programada corriendo indefinidamente llena el disco despacio pero
    sin parar."""
    if not LOGS_DIR.exists():
        return
    archivos = sorted(LOGS_DIR.glob("daily-*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    for viejo in archivos[LOGS_A_CONSERVAR:]:
        try:
            viejo.unlink()
        except OSError:
            pass


def _correr_desatendido() -> int:
    """
    Nadie va a estar mirando esta consola (Task Scheduler la corre en
    background) — todo el output va a un archivo con timestamp, no solo a
    stdout. `ejecutar.run_async(desatendido=True)` ya trae su propia red de
    seguridad (reporta con `forzar_error` ante un crash, para que la alerta
    por email del backend lo detecte el mismo día en vez de a los 7 días).
    """
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    _rotar_logs()
    log_path = LOGS_DIR / f"daily-{time.strftime('%Y-%m-%dT%H-%M-%S')}.log"

    class _Tee:
        def __init__(self, *streams):
            self._streams = streams

        def write(self, data):
            for s in self._streams:
                s.write(data)
                s.flush()

        def flush(self):
            for s in self._streams:
                s.flush()

    with open(log_path, "w", encoding="utf-8") as f:
        tee_out, tee_err = sys.stdout, sys.stderr
        sys.stdout = _Tee(tee_out, f)
        sys.stderr = _Tee(tee_err, f)
        try:
            return asyncio.run(ejecutar_mod.run_async(desatendido=True))
        finally:
            sys.stdout, sys.stderr = tee_out, tee_err


def main() -> int:
    parser = ArgumentParser(
        description="Prueba diaria de la app contra el PJN real (tests/daily/, F0-F5).",
    )
    modo = parser.add_mutually_exclusive_group()
    modo.add_argument(
        "--asistido", action="store_true",
        help="Modo asistido (F1): pre-vuelo + pausa para correr los flujos vos + cierre. "
             "Por defecto corre el modo automático (F2): los 6 flujos por código.",
    )
    modo.add_argument(
        "--desatendido", action="store_true",
        help="Modo desatendido (F5): automático + log a archivo + origen "
             "'app-automatica'. Pensado para Task Scheduler — NO activado por "
             "defecto en ningún lado, hay que registrar la tarea a mano "
             "(registrar-tarea-programada.ps1) cuando se decida usarlo.",
    )
    args = parser.parse_args()

    if args.asistido:
        return run_mod.main()
    if args.desatendido:
        return _correr_desatendido()
    return asyncio.run(ejecutar_mod.run_async())


if __name__ == "__main__":
    sys.exit(main())
