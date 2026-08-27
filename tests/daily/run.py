"""
tests/daily/run.py — entrada de una línea de F1: preflight + pausa para que
el operador corra los flujos (a mano o vía computer-use) + cierre.

F1 NO corre los flujos (eso es F2/F3) — este orquestador asiste el "antes" y
el "después" de una corrida manual, que es exactamente el valor que F1 promete
por sí sola aunque el resto del plan no se haga (§7 de la propuesta).

Uso: python tests/daily/run.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from daily import cierre as cierre_mod
from daily import preflight as preflight_mod
from daily.close_env import assert_no_instance_running


def main() -> int:
    print("=" * 60)
    print("  Prueba diaria de la app — pre-vuelo + corrida manual + cierre")
    print("=" * 60 + "\n")

    try:
        assert_no_instance_running()
    except RuntimeError as e:
        print(f"❌ {e}")
        return 1

    if not preflight_mod.run():
        return 1

    marca = time.time()
    print(
        "\n" + "-" * 60 +
        "\n👉 Abrí la app y corré los flujos ahora (a mano, o pedile a Claude"
        "\n   'corré la prueba diaria de la app con computer use')."
        "\n   Cuando termines, volvé acá y presioná Enter."
        "\n" + "-" * 60
    )
    input()

    resultado = cierre_mod.run(cierre_mod.FLUJOS_DEFAULT, desde_epoch=marca, notas="Corrida vía tests/daily/run.py (F1)")

    hubo_error = any(r.estado == "error" for r in resultado["resultados"])
    return 1 if hubo_error else 0


if __name__ == "__main__":
    sys.exit(main())
