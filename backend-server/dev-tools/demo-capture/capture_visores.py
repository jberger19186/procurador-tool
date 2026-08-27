"""
demo-capture/capture_visores.py — D3 (demo Etapa 1.6), pipeline 1 de 3.

Captura los pasos del guion que viven DENTRO de un visor HTML ya generado
por D2 (`demo-fixtures/generar-visores.js`): Procuración (cap. 2), Informe
(cap. 3), Monitor (cap. 4), y el paso 5.1 de Bitácora (la barra de 5
acciones vive en el modal de detalle del visor de Procuración, no en el
portal — ver demo-guion.md §5.1).

No usa la app Electron ni ninguna cuenta real — abre los archivos HTML
estáticos que ya produjo D2, servidos por un HTTP simple local. Cero riesgo
de dato real: todo lo que aparece en pantalla viene de los fixtures
sintéticos.

Regenera los visores primero (llama a generar-visores.js) para que la
captura siempre refleje el fixture actual — "una sola invocación regenera
todo", el requisito de reproducibilidad del plan (D3).

Uso: python backend-server/dev-tools/demo-capture/capture_visores.py
"""

from __future__ import annotations

import http.server
import subprocess
import sys
import threading
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from playwright.sync_api import sync_playwright

from capture_common import DEMO_FIXTURES_DIR, DEMO_FIXTURES_OUTPUT_DIR, VIEWPORT, archivo_mas_reciente, ruta_captura

PORT = 5501


def _log(msg: str) -> None:
    print(f"  {msg}")


def regenerar_visores() -> None:
    print("Regenerando visores desde los fixtures (generar-visores.js)...")
    resultado = subprocess.run(
        ["node", "generar-visores.js"],
        cwd=str(DEMO_FIXTURES_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if resultado.returncode != 0:
        print(resultado.stdout)
        print(resultado.stderr)
        raise RuntimeError("generar-visores.js falló — ver salida arriba.")
    _log("OK.")


def iniciar_servidor() -> http.server.ThreadingHTTPServer:
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *a, directory=str(DEMO_FIXTURES_OUTPUT_DIR), **kw
    )
    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    return servidor


def capturar(page, capitulo: str, nombre_archivo: str, descripcion: str) -> None:
    destino = ruta_captura(capitulo, nombre_archivo)
    page.screenshot(path=str(destino))
    _log(f"✓ {capitulo}/{nombre_archivo} — {descripcion}")


def main() -> int:
    regenerar_visores()

    servidor = iniciar_servidor()
    try:
        with sync_playwright() as pw:
            # channel="chrome" (Chrome real instalado), no el Chromium que
            # trae Playwright por defecto — el paso 3.4 abre un PDF, y el
            # Chromium de Playwright NO trae el visor de PDF integrado
            # (queda en blanco, confirmado con un PDF mínimo de referencia
            # conocido-funcional, no solo con el placeholder propio). El
            # Chrome real sí lo tiene, headless o no.
            browser = pw.chromium.launch(channel="chrome")
            page = browser.new_page(viewport=VIEWPORT)

            errores_consola = []
            page.on("console", lambda msg: errores_consola.append(msg.text) if msg.type == "error" else None)

            # ── Capítulo 2 — Procuración (2.4, 2.5) ──────────────────────────
            print("\nCapítulo 2 — Procuración:")
            archivo_lote = archivo_mas_reciente(DEMO_FIXTURES_OUTPUT_DIR, "procurar-lote_visor_")
            page.goto(f"http://127.0.0.1:{PORT}/{archivo_lote.name}")
            page.wait_for_load_state("networkidle")
            capturar(page, "procuracion", "2.4-visor-novedades.png", "tabla de expedientes con movimientos")

            page.locator(".btn-ver").first.click()
            page.wait_for_timeout(300)
            capturar(page, "procuracion", "2.5-modal-detalle.png", "modal de detalle de un movimiento")

            # ── Capítulo 5 — Bitácora, paso 5.1 (vive en este mismo visor) ──
            print("\nCapítulo 5 — Bitácora (5.1, desde el visor de Procuración):")
            capturar(page, "bitacora", "5.1-barra-acciones.png", "barra de 5 acciones del modal (+ Vencimiento / + Tarea / + Nota / Guardar caso / Guardar procuración)")
            page.keyboard.press("Escape")

            # ── Capítulo 3 — Informe (3.3, 3.4) ──────────────────────────────
            print("\nCapítulo 3 — Informe:")
            archivo_informe_lote = archivo_mas_reciente(DEMO_FIXTURES_OUTPUT_DIR, "informe-lote_visor_")
            page.goto(f"http://127.0.0.1:{PORT}/{archivo_informe_lote.name}")
            page.wait_for_load_state("networkidle")
            capturar(page, "informe", "3.3-visor-informe.png", "header sticky, stats row, tabla con botón Abrir PDF")

            # El link "Abrir PDF" no tiene target — navega la MISMA pestaña, y
            # Chromium headless toma el PDF con su visor nativo integrado.
            # `page.expect_navigation()` + click revienta con
            # "net::ERR_ABORTED; maybe frame was detached?" — el visor de PDF
            # de Chromium hace un swap de frame interno que Playwright no ve
            # como una navegación normal, aunque el archivo SÍ se sirve bien
            # (confirmado: el 200 aparece en el log del servidor igual).
            # `page.goto()` directo al href evita el problema del todo.
            href_pdf = page.get_by_text("📄 Abrir PDF").first.get_attribute("href")
            # El propio Chromium interrumpe la navegación normal para pasarle
            # el control a su visor de PDF interno — Playwright lo reporta
            # como net::ERR_ABORTED aunque el PDF sí se sirve y se muestra
            # (confirmado: el 200 real queda en el log del servidor de este
            # mismo script). Se ignora ese error puntual y se espera a que
            # el visor termine de pintar antes de capturar.
            try:
                page.goto(f"http://127.0.0.1:{PORT}/{href_pdf.removeprefix('./')}")
            except Exception as e:
                if "ERR_ABORTED" not in str(e):
                    raise
            page.wait_for_timeout(1500)
            capturar(page, "informe", "3.4-pdf-abierto.png", "el PDF del informe abierto")

            # ── Capítulo 4 — Monitor de partes (4.5, 4.6) ────────────────────
            print("\nCapítulo 4 — Monitor de partes:")
            archivo_monitor_inicial = archivo_mas_reciente(DEMO_FIXTURES_OUTPUT_DIR, "monitor-inicial_visor_")
            page.goto(f"http://127.0.0.1:{PORT}/{archivo_monitor_inicial.name}")
            page.wait_for_load_state("networkidle")
            capturar(page, "monitor", "4.5-consulta-inicial.png", "3 tarjetas: Partes procesadas / Exitosas / Expedientes en base")

            archivo_monitor_novedades = archivo_mas_reciente(DEMO_FIXTURES_OUTPUT_DIR, "monitor-novedades_visor_")
            page.goto(f"http://127.0.0.1:{PORT}/{archivo_monitor_novedades.name}")
            page.wait_for_load_state("networkidle")
            capturar(page, "monitor", "4.6-novedades.png", "Novedades detectadas: N, filas resaltadas")

            browser.close()

            if errores_consola:
                print(f"\n⚠️  {len(errores_consola)} error(es) de consola durante la captura:")
                for e in errores_consola:
                    print(f"   - {e}")
                return 1

            print("\n✅ Sin errores de consola. 7 capturas generadas.")
            return 0
    finally:
        servidor.shutdown()


if __name__ == "__main__":
    sys.exit(main())
