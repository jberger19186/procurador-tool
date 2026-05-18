#!/usr/bin/env python3
"""
run_tests.py — Runner interactivo para la suite QA de Procurador SCW.

Uso:
    python tests/run_tests.py               # menú interactivo
    python tests/run_tests.py --api         # solo tests de API (M1–M7, M13)
    python tests/run_tests.py --web         # solo portales web (M8, M9)
    python tests/run_tests.py --electron    # solo app Electron (M10)
    python tests/run_tests.py --all         # todo
    python tests/run_tests.py --fast        # API + web, sin Electron
"""

import argparse
import os
import subprocess
import sys
from datetime import datetime

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPORT_DIR = os.path.join(TESTS_DIR, "reports")
os.makedirs(REPORT_DIR, exist_ok=True)
os.makedirs(os.path.join(TESTS_DIR, "screenshots"), exist_ok=True)


def run(args: list[str], label: str = "") -> int:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = os.path.join(REPORT_DIR, f"report_{label}_{timestamp}.html")

    cmd = [
        sys.executable, "-m", "pytest",
        *args,
        "--html", report_file,
        "--self-contained-html",
        "-v",
    ]
    print(f"\n{'='*60}")
    print(f"  Ejecutando: {label or 'tests seleccionados'}")
    print(f"  Reporte:    {report_file}")
    print(f"{'='*60}\n")

    result = subprocess.run(cmd, cwd=TESTS_DIR)
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description="Runner de tests QA — Procurador SCW")
    parser.add_argument("--api",      action="store_true", help="Tests de API (M1–M7, M12, M13)")
    parser.add_argument("--web",      action="store_true", help="Tests de portales web (M8, M9)")
    parser.add_argument("--electron", action="store_true", help="Tests de Electron (M10)")
    parser.add_argument("--all",      action="store_true", help="Todos los tests")
    parser.add_argument("--fast",     action="store_true", help="API + web (sin Electron)")
    parser.add_argument("--headed",   action="store_true", help="Forzar modo headed en Playwright")
    parser.add_argument("--headless", action="store_true", help="Forzar modo headless en Playwright")
    args = parser.parse_args()

    # Configurar modo headed/headless via variable de entorno que usa conftest.py
    if args.headless:
        os.environ["PLAYWRIGHT_HEADLESS"] = "1"
    elif args.headed:
        os.environ["PLAYWRIGHT_HEADLESS"] = "0"

    exit_codes = []

    if args.all or args.api or args.fast:
        code = run(["-m", "api", "api/"], label="api")
        exit_codes.append(code)

    if args.all or args.web or args.fast:
        code = run(["-m", "web", "web/", "--timeout=30"], label="web")
        exit_codes.append(code)

    if args.all or args.electron:
        code = run(["-m", "electron", "desktop/", "--timeout=60"], label="electron")
        exit_codes.append(code)

    if not any(vars(args).values()):
        # Menú interactivo
        print("\n🧪 Suite QA — Procurador SCW")
        print("────────────────────────────")
        print("1. Tests de API (M1–M7, M12, M13)  [~3 min]")
        print("2. Portales web (M8, M9)             [~5 min] — requiere Chromium")
        print("3. App Electron (M10)                [~3 min] — requiere app")
        print("4. Todo                              [~12 min]")
        print("5. API + Web (rápido)                [~8 min]")
        choice = input("\nElegí una opción [1-5]: ").strip()

        if choice == "1":
            exit_codes.append(run(["-m", "api", "api/"], label="api"))
        elif choice == "2":
            exit_codes.append(run(["-m", "web", "web/"], label="web"))
        elif choice == "3":
            exit_codes.append(run(["-m", "electron", "desktop/"], label="electron"))
        elif choice == "4":
            exit_codes.append(run(["-m", "api", "api/"], label="api"))
            exit_codes.append(run(["-m", "web", "web/"], label="web"))
            exit_codes.append(run(["-m", "electron", "desktop/"], label="electron"))
        elif choice == "5":
            exit_codes.append(run(["-m", "api", "api/"], label="api"))
            exit_codes.append(run(["-m", "web", "web/"], label="web"))
        else:
            print("Opción inválida")
            sys.exit(1)

    # Resumen
    total_fails = sum(1 for c in exit_codes if c != 0)
    print(f"\n{'='*60}")
    if total_fails == 0:
        print("  ✅ TODOS LOS TESTS PASARON")
    else:
        print(f"  ❌ {total_fails} grupo(s) con fallos — revisar reportes en tests/reports/")
    print(f"{'='*60}\n")

    sys.exit(1 if total_fails > 0 else 0)


if __name__ == "__main__":
    main()
