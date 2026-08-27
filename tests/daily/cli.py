"""
tests/daily/cli.py — F3: punto de entrada único de la prueba diaria.

Fusiona los dos modos existentes en un solo comando (antes eran `ejecutar.py`
y `run.py` por separado, cada uno documentado como comando propio):

  python tests/daily/cli.py               -> modo automático (F2): los 6
                                              flujos por código, sin intervención.
  python tests/daily/cli.py --asistido     -> modo asistido (F1): pre-vuelo +
                                              pausa para correr los flujos vos
                                              (a mano o con computer-use) + cierre.

`ejecutar.py` y `run.py` siguen existiendo y siendo ejecutables por separado
(no se duplicó su lógica, este CLI solo los invoca) — por si alguna vez hace
falta correr un modo puntual sin pasar por el menú de flags.

Uso: python tests/daily/cli.py [--asistido]
"""

from __future__ import annotations

import asyncio
import sys
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


def main() -> int:
    parser = ArgumentParser(
        description="Prueba diaria de la app contra el PJN real (tests/daily/, F0-F3).",
    )
    parser.add_argument(
        "--asistido", action="store_true",
        help="Modo asistido (F1): pre-vuelo + pausa para correr los flujos vos + cierre. "
             "Por defecto corre el modo automático (F2): los 6 flujos por código.",
    )
    args = parser.parse_args()

    if args.asistido:
        return run_mod.main()
    return asyncio.run(ejecutar_mod.run_async())


if __name__ == "__main__":
    sys.exit(main())
