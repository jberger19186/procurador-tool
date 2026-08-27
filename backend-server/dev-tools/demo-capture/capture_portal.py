"""
demo-capture/capture_portal.py — D3 (demo Etapa 1.6), pipeline 2 de 3.

Captura los pasos del guion que viven en el portal de usuarios: Bitácora +
Mis Expedientes (cap. 5, pasos 5.2-5.7 — 5.1 lo cubre capture_visores.py,
vive en el visor de Procuración, no acá) y Dashboard y Gestión (cap. 7,
pasos 7.1-7.5).

Conduce `stub-portal.js --demo` (D2) — sirve los archivos REALES de
`public/usuarios/` contra una API falsa con el dataset sintético de la
demo. Cero cuenta real, cero dato real: mismo criterio de cero riesgo que
capture_visores.py.

Uso: python backend-server/dev-tools/demo-capture/capture_portal.py
"""

from __future__ import annotations

import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

from capture_common import REPO_ROOT, VIEWPORT, ruta_captura

PORT = 5511
BASE_URL = f"http://127.0.0.1:{PORT}/usuarios/"
STUB_PATH = REPO_ROOT / "backend-server" / "dev-tools" / "stub-portal.js"


def _log(msg: str) -> None:
    print(f"  {msg}")


def esperar_stub(intentos: int = 20) -> None:
    for _ in range(intentos):
        try:
            urllib.request.urlopen(BASE_URL, timeout=1)
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"stub-portal.js --demo no respondió en {BASE_URL} tras {intentos * 0.5}s.")


def capturar(page, capitulo: str, nombre_archivo: str, descripcion: str) -> None:
    destino = ruta_captura(capitulo, nombre_archivo)
    page.screenshot(path=str(destino))
    _log(f"✓ {capitulo}/{nombre_archivo} — {descripcion}")


def cerrar_banner_si_hay(page) -> None:
    """§0.6 del guion: cualquier banner de cupo/pago se cierra antes de
    capturar, en cualquier pantalla donde aparezca — acá vive en
    #status-banner (un solo div para los 3 casos, a diferencia de Electron)."""
    banner = page.locator("#status-banner")
    if banner.count() and banner.is_visible():
        cerrar = banner.locator("button, .close, [onclick*='close' i]").first
        if cerrar.count():
            cerrar.click()
        else:
            page.evaluate("document.getElementById('status-banner').style.display = 'none'")


def main() -> int:
    print("Levantando stub-portal.js --demo...")
    proc = subprocess.Popen(
        ["node", str(STUB_PATH), str(PORT), "--demo"],
        cwd=str(STUB_PATH.parent),
    )
    try:
        esperar_stub()
        _log("OK.")

        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome")
            page = browser.new_page(viewport=VIEWPORT)

            errores_consola = []
            page.on("console", lambda msg: errores_consola.append(msg.text) if msg.type == "error" else None)

            page.goto(BASE_URL)
            page.wait_for_load_state("networkidle")

            # Login — cualquier email/password entra (V0, stub-portal.js).
            page.fill("#login-email", "demo@procuradortool.com")
            page.fill("#login-password", "demo12345")
            page.click("#btn-login")
            page.wait_for_timeout(1200)
            cerrar_banner_si_hay(page)

            # ── Capítulo 5 — Bitácora (5.2-5.7) ──────────────────────────────
            print("\nCapítulo 5 — Bitácora / Mis Expedientes:")
            page.click("[data-section='bitacora']")
            page.wait_for_timeout(800)
            cerrar_banner_si_hay(page)
            capturar(page, "bitacora", "5.6-banner-avisos.png", "banner de avisos (vencidos + próximos 7 días)")
            capturar(page, "bitacora", "5.2-mes.png", "vista Mes — calendario con entradas coloreadas por tipo")

            page.click("[data-view='semana']")
            page.wait_for_timeout(500)
            capturar(page, "bitacora", "5.3-semana.png", "vista Semana (F3.4, Bloque A)")

            page.click("#btn-bitacora-nueva")
            page.wait_for_timeout(400)
            # Calculadora de plazos: fecha de hoy + 15 días hábiles.
            calc_fecha = page.locator("#modal-bitacora-entrada input[type='date']").first
            if calc_fecha.count():
                calc_fecha.fill(time.strftime("%Y-%m-%d"))
            calc_dias = page.locator("#modal-bitacora-entrada input[type='number']").first
            if calc_dias.count():
                calc_dias.fill("15")
            calcular_btn = page.locator("#bit-plazo-calcular")
            if calcular_btn.count():
                calcular_btn.click()
                page.wait_for_timeout(300)
            capturar(page, "bitacora", "5.5-modal-entrada.png", "modal de nueva entrada con la calculadora de plazos")
            page.keyboard.press("Escape")
            # El toast de "Vencimiento calculado" tarda unos segundos en irse
            # solo — sin esperarlo, quedaba colado en capturas de pasos
            # siguientes (confirmado visualmente: apareció superpuesto en la
            # primera corrida de 7.1, encima del panel de Mi Plan).
            page.wait_for_timeout(3000)

            page.evaluate("openExportModal()")
            page.wait_for_timeout(400)
            page.check("#export-formato-ics")
            page.wait_for_timeout(200)
            capturar(page, "bitacora", "5.7-modal-exportacion.png", "modal de exportación con iCalendar (.ics) marcado")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

            page.click("[data-section='mis-expedientes']")
            page.wait_for_timeout(600)
            page.locator(".mexp-table tbody tr").first.click()
            page.wait_for_timeout(500)
            capturar(page, "bitacora", "5.4-ficha-expediente.png", "ficha de un caso — historial de entradas + snapshots")

            # ── Capítulo 7 — Dashboard y Gestión (7.1-7.5) ───────────────────
            print("\nCapítulo 7 — Dashboard y Gestión (Portal):")
            page.click("[data-section='plan']")
            page.wait_for_timeout(600)
            cerrar_banner_si_hay(page)
            capturar(page, "portal", "7.1-mi-plan.png", "nombre del plan, badge de estado, días restantes")

            downloads = page.locator("#downloads-card")
            if downloads.count():
                downloads.scroll_into_view_if_needed()
                page.wait_for_timeout(300)
            capturar(page, "portal", "7.2-descargas.png", "tarjeta Descargas — instalador + extensión")

            page.click("[data-section='facturacion']")
            page.wait_for_timeout(600)
            cerrar_banner_si_hay(page)
            capturar(page, "portal", "7.3-facturacion.png", "historial de pagos/facturas")

            page.click("[data-section='soporte']")
            page.wait_for_timeout(600)
            cerrar_banner_si_hay(page)
            capturar(page, "portal", "7.4-soporte.png", "listado de tickets propios")

            page.click("[data-section='ayuda']")
            page.wait_for_timeout(600)
            cerrar_banner_si_hay(page)
            capturar(page, "portal", "7.5-ayuda.png", "buscador de FAQ")

            browser.close()

            if errores_consola:
                print(f"\n⚠️  {len(errores_consola)} error(es) de consola durante la captura:")
                for e in errores_consola:
                    print(f"   - {e}")
                return 1

            print("\n✅ Sin errores de consola. 10 capturas generadas.")
            return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
