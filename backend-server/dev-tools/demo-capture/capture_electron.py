"""
demo-capture/capture_electron.py — D3 (demo Etapa 1.6), pipeline 3 de 3: la
app Electron viva.

Captura los pasos del guion que solo existen DENTRO de la app en vivo:
formularios y modales de Procuración (2.1-2.3), Informe (3.1-3.2, 3.5),
Monitor (4.1-4.3) y Markdown (6.1-6.5). Los pasos 6.6-6.8 (el ".md abierto
en un editor" + el mock de un chat de IA) NO viven acá — son mockups, sin
ninguna dependencia de la app — y quedan fuera de este script a propósito.

Reusa el lanzamiento + login de tests/daily/electron_driver.py (mismo motivo
que documenta el propio plan: no duplicar la lógica de CDP/login que F2 ya
verificó 6/6 veces reales — es la clase de duplicación que este proyecto ya
pagó 2 veces como bug real). Reusa las piezas sueltas (`_esperar_cdp`,
`_login_si_hace_falta`, `assert_no_instance_running`, `close_app`) en vez de
`launch_and_connect()` completa porque necesita apuntar a un `.exe` distinto:
el build LOCAL 2.7.51 (`electron-app/dist/win-unpacked/`), no el instalado
(2.7.50, sin el módulo Markdown — ver demo-guion.md §6 y el roadmap,
dependencia #11, "gate real, ya cerrado").

🚨 CUENTA REAL, DATOS FALSOS POR SUSTITUCIÓN — no hay stub para la app de
escritorio (a diferencia del portal). No existe todavía una cuenta de demo
dedicada en producción (decisión pendiente del operador) — mientras tanto
esto usa la cuenta de verificación YA logueada en esta máquina
(tests/daily/), con "Recordar mis datos" ya tildado. Sustituye TODO lo que
se ve en pantalla antes de cada screenshot:
  - el chip de usuario del sidebar (D2, demo-anonimizar.js)
  - adentro del modal de Monitor, la lista de Partes y la tabla de
    Expedientes — que si no, mostrarían datos reales de esa cuenta (partes
    monitoreadas reales, expedientes reales del PJN).
Si la cuenta de verificación no tiene ninguna parte/expediente guardado
todavía, la sustitución igual corre — no hay ninguna ventana en la que se
vea el dato real sin sustituir, porque la sustitución pasa ANTES del
screenshot, nunca después (regla de oro, plan D3 §0.1/§4).

🚨 NUNCA dispara un flujo real contra el PJN ni abre un diálogo nativo. Los
botones que lo harían — "▶ Procurar" (sidebar y subtoolbar), "Confirmar" del
modal de lote, "▶ Ejecutar" de Informe, "📥 Consulta Inicial"/"🔍 Buscar
Novedades" de Monitor, "▶ Procesar" de Markdown, "📁 Seleccionar .txt/PDF" —
quedan SIN TOCAR en todo este script. Los estados "en curso"/"resultado" que
pide el guion (2.2, 2.3, 3.5, 6.2, 6.3, 6.4) se simulan escribiendo
directamente en el DOM (`addLog()`, asignación de variables de estado ya
existentes en el propio renderer.js) — mismo criterio que el guion pide
explícitamente: "evita gastar cupo", "no un GIF real de la corrida".

Uso: python backend-server/dev-tools/demo-capture/capture_electron.py
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[3] / "tests"
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from daily import electron_driver  # noqa: E402
from daily.close_env import assert_no_instance_running, close_app  # noqa: E402

from capture_common import REPO_ROOT, VIEWPORT, ruta_captura  # noqa: E402

LOCAL_EXE_PATH = str(
    REPO_ROOT / "electron-app" / "dist" / "win-unpacked" / "Procurador SCW.exe"
)
FIXTURES_JSON = REPO_ROOT / "backend-server" / "dev-tools" / "demo-fixtures" / "output" / "fixtures-electron.json"
ANONIMIZAR_JS = REPO_ROOT / "backend-server" / "dev-tools" / "demo-fixtures" / "demo-anonimizar.js"


def _log(msg: str) -> None:
    print(f"  {msg}")


def cargar_fixtures() -> dict:
    if not FIXTURES_JSON.exists():
        raise FileNotFoundError(
            f"No existe {FIXTURES_JSON}. Corré generar-visores.js primero "
            "(genera fixtures-electron.json además de los visores)."
        )
    return json.loads(FIXTURES_JSON.read_text(encoding="utf-8"))


def cargar_fuente_sustitucion() -> tuple[str, str]:
    """Extrae del propio demo-anonimizar.js (D2) las 2 funciones autocontenidas
    que necesita este script, sin retipearlas ni reimportarlas por Node —
    Python solo puede inyectar TEXTO de función en la página, así que se lee
    el archivo y se recorta cada función por su firma exacta."""
    src = ANONIMIZAR_JS.read_text(encoding="utf-8")

    def extraer(nombre_funcion: str) -> str:
        inicio = src.index(f"function {nombre_funcion}(")
        # Recorte por balance de llaves — más robusto que un regex acá,
        # porque el cuerpo de estas funciones tiene objetos anidados.
        profundidad = 0
        i = src.index("{", inicio)
        inicio_cuerpo = i
        while True:
            if src[i] == "{":
                profundidad += 1
            elif src[i] == "}":
                profundidad -= 1
                if profundidad == 0:
                    break
            i += 1
        return src[inicio:i + 1]

    return (
        extraer("aplicarSustitucionLoginElectron"),
        extraer("aplicarSustitucionPrincipalElectron"),
    )


async def capturar(page, capitulo: str, nombre_archivo: str, descripcion: str) -> None:
    destino = ruta_captura(capitulo, nombre_archivo)
    await page.screenshot(path=str(destino))
    _log(f"✓ {capitulo}/{nombre_archivo} — {descripcion}")


async def run() -> int:
    fixtures = cargar_fixtures()
    cuenta = fixtures["cuenta"]
    expedientes = fixtures["expedientes"]
    parte_demo = fixtures["parteDemo"]
    monitor_expedientes = fixtures["monitorExpedientesInicial"]
    _, fuente_sustitucion_principal = cargar_fuente_sustitucion()

    if not Path(LOCAL_EXE_PATH).exists():
        raise FileNotFoundError(
            f"No existe el build local: {LOCAL_EXE_PATH}. "
            "Corré 'npm run build:dir' en electron-app/ primero."
        )

    print(f"Usando build local: {LOCAL_EXE_PATH}")
    assert_no_instance_running()

    proc = subprocess.Popen([LOCAL_EXE_PATH, f"--remote-debugging-port={electron_driver.DEBUG_PORT}"])
    pw = None
    try:
        electron_driver._esperar_cdp(electron_driver.DEBUG_PORT)
        pw = await electron_driver.async_playwright().start()
        browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{electron_driver.DEBUG_PORT}")
        page = await electron_driver._login_si_hace_falta(browser)
        _log("App conectada y logueada.")

        await page.set_viewport_size(VIEWPORT)

        async def sustituir_principal():
            await page.evaluate(f"({fuente_sustitucion_principal})({json.dumps(cuenta)})")

        await sustituir_principal()
        await page.wait_for_timeout(500)

        # ── Capítulo 2 — Procuración (2.1-2.3) ───────────────────────────────
        print("\nCapítulo 2 — Procuración:")
        await capturar(page, "procuracion", "2.1-tab-procurar.png", "tab Procurar activo, fecha límite de hoy")

        await page.evaluate("showProcurarCustomModal()")
        await page.wait_for_timeout(400)
        # Fake del archivo cargado — NUNCA clickea "Seleccionar .txt" (diálogo
        # nativo) ni "Confirmar" (dispararía una corrida real).
        await page.evaluate(
            """() => {
                document.getElementById('lblArchivoCustom').textContent = 'demo-batch.txt';
                const resumen = document.getElementById('resumenCustom');
                resumen.style.display = 'block';
                resumen.textContent = '2 expedientes válidos';
                document.getElementById('btnConfirmProcurarCustom').disabled = false;
            }"""
        )
        await capturar(page, "procuracion", "2.2-por-lote.png", "campo Por lote con un archivo .txt cargado")
        await page.evaluate("closeModal('modalProcurarCustom')")
        await page.wait_for_timeout(300)

        # Consola "en curso" — simulada con la función REAL addLog(), sin
        # correr nada real (mismo criterio que el guion pide: evita cupo).
        await page.evaluate(
            """(exps) => {
                addLog('info', '[INICIO] Procuración por lote iniciada — 2 expedientes');
                addLog('info', `Procesando ${exps[0].expediente}...`);
                addLog('success', `OK — ${exps[0].expediente}: 4 movimiento(s) nuevo(s)`);
                addLog('info', `Procesando ${exps[1].expediente}...`);
                const wrap = document.getElementById('batch-progress-wrap');
                wrap.style.display = '';
                document.getElementById('batch-progress-label').textContent = 'Procesando 2 de 2...';
                document.getElementById('batch-progress-eta').textContent = 'ETA: 8s';
                document.getElementById('batch-progress-bar').style.width = '75%';
            }""",
            expedientes,
        )
        await capturar(page, "procuracion", "2.3-consola-en-curso.png", "consola de actividad con líneas de log reales, estado en curso")
        # Limpiar el estado fabricado antes de seguir — no debe arrastrarse a
        # capturas de otros capítulos.
        await page.evaluate(
            """() => {
                document.getElementById('batch-progress-wrap').style.display = 'none';
                document.getElementById('consoleOutput').innerHTML =
                    '<div class="console-line console-info"><span class="console-time">[INICIO]</span><span>Sistema iniciado correctamente ✅</span></div>';
            }"""
        )

        # ── Capítulo 3 — Informe (3.1, 3.2, 3.5) ─────────────────────────────
        print("\nCapítulo 3 — Informe:")
        await page.evaluate("openInformeModal()")
        await page.wait_for_timeout(300)
        await page.fill("#informe-expediente", expedientes[0]["expediente"])
        await capturar(page, "informe", "3.1-modal-individual.png", "modal Informe, pestaña Individual, expediente completo")

        await page.check("#informe-intervinientes")
        await page.check("#informe-vinculados")
        await capturar(page, "informe", "3.2-selector-secciones.png", "selector de secciones a incluir")

        await page.click("[data-informe-tab='batch']")
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
                document.getElementById('informe-batch-filename').textContent = 'demo-batch.txt';
                const preview = document.getElementById('informe-batch-preview');
                preview.style.display = '';
                preview.textContent = '2 expediente(s) válido(s)';
            }"""
        )
        await capturar(page, "informe", "3.5-batch-cargado.png", "pestaña Batch (.txt) con 2 expedientes cargados")
        await page.evaluate("closeModal('modalInforme')")
        await page.wait_for_timeout(300)

        # ── Capítulo 4 — Monitor de partes (4.1-4.3) ─────────────────────────
        print("\nCapítulo 4 — Monitor de partes:")
        await page.evaluate("openMonitorModal()")
        await page.wait_for_timeout(1200)  # deja terminar el fetch real de partes ANTES de sustituir

        await page.evaluate("document.getElementById('btnMonitorAgregarParte').click()")
        await page.wait_for_timeout(200)
        await page.select_option("#monitor-form-jurisdiccion", "14")  # FCR
        await page.fill("#monitor-form-nombre", parte_demo["nombre_parte"])
        await capturar(page, "monitor", "4.1-alta-parte.png", "formulario de alta — jurisdicción + nombre")
        await page.evaluate("document.getElementById('btnMonitorCancelarParte').click()")
        await page.wait_for_timeout(200)

        # Sustitución REAL: reasignar el caché de partes del renderer y
        # volver a pintar con la función REAL — no una tabla hecha a mano.
        # Sin esto se verían las partes reales de la cuenta de verificación
        # (DON COCHO, LA TOSTADORA MODERNA, lo que sea que tenga guardado).
        await page.evaluate(
            """(parte) => {
                _monitorPartes = [
                    { id: 1, jurisdiccion_sigla: parte.jurisdiccion_sigla, nombre_parte: parte.nombre_parte,
                      tiene_linea_base: true, fecha_creacion: new Date(Date.now() - 20*86400000).toISOString() },
                ];
                renderizarListaPartes();
                document.getElementById('monitor-partes-count').textContent = '1 de 20 parte(s)';
            }""",
            parte_demo,
        )
        await capturar(page, "monitor", "4.2-listado-partes.png", "listado de partes con badge Base lista, cupo N de 20")

        await page.click("[data-tab='monitor-expedientes']")
        await page.wait_for_timeout(1200)  # deja terminar el fetch real ANTES de sustituir
        await page.evaluate(
            """(exps) => {
                const tbody = document.getElementById('monitor-exp-tbody');
                tbody.innerHTML = exps.map(e =>
                    '<tr style="border-bottom:1px solid #f3f4f6;">' +
                    '<td style="padding:7px 6px;font-weight:500;color:#1d4ed8;white-space:nowrap;">' + e.numero_expediente + '</td>' +
                    '<td style="padding:7px 6px;">' + e.dependencia + '</td>' +
                    '<td style="padding:7px 6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + e.caratula + '">' + e.caratula + '</td>' +
                    '<td style="padding:7px 6px;">' + e.situacion + '</td>' +
                    '<td style="padding:7px 6px;color:#6b7280;">' + e.ultima_actuacion + '</td>' +
                    '</tr>'
                ).join('');
                document.getElementById('monitor-exp-loading').style.display = 'none';
                document.getElementById('monitor-exp-empty').style.display = 'none';
                document.getElementById('monitor-exp-tabla-wrap').style.display = '';
                document.getElementById('monitor-exp-titulo').textContent =
                    parteDemoTitulo;
            }""".replace("parteDemoTitulo", json.dumps(f"{parte_demo['jurisdiccion_sigla']} · {parte_demo['nombre_parte']}")),
            monitor_expedientes,
        )
        await capturar(page, "monitor", "4.3-tabla-expedientes.png", "tabla de expedientes por parte")
        await page.evaluate("closeModal('modalMonitor')")
        await page.wait_for_timeout(300)

        # ── Capítulo 6 — Markdown / Anonimización (6.1-6.5) ──────────────────
        print("\nCapítulo 6 — Markdown / Anonimización:")
        await page.evaluate("openMarkdownModal()")
        await page.wait_for_timeout(300)
        await capturar(page, "markdown", "6.1-dropzone-vacia.png", "dropzone vacía — Arrastrá un informe PDF acá")

        await page.evaluate(
            """(nombre) => { markdownSetArchivo(nombre); }""",
            f"informe_{expedientes[0]['expediente'].replace('/', '_')}_demo.pdf",
        )
        await capturar(page, "markdown", "6.2-dropzone-archivo.png", "dropzone con el archivo cargado")

        await page.evaluate(
            """() => {
                document.getElementById('md-progreso').style.display = '';
                document.getElementById('md-progreso-label').textContent = 'Generando la versión anonimizada...';
                const log = document.getElementById('md-progreso-log');
                log.innerHTML = '';
                ['Extrayendo el informe principal...', '✅ informe.pdf', 'Extrayendo texto de informe.pdf...', 'Generando la versión anonimizada...']
                    .forEach(t => { const d = document.createElement('div'); d.textContent = t; log.appendChild(d); });
            }"""
        )
        await capturar(page, "markdown", "6.3-log-progreso.png", "log de progreso corriendo")

        await page.evaluate(
            """() => {
                document.getElementById('md-resultado-resumen').textContent =
                    '6 entidad(es) detectada(s) para anonimizar';
                document.getElementById('md-resultado').style.display = '';
            }"""
        )
        await capturar(page, "markdown", "6.4-resultado.png", "resultado — 3 botones (Markdown completo / anonimizado / mapping.txt)")

        await page.click("[data-md-tab='mapping']")
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
                document.getElementById('md-mapping-sin-datos').style.display = 'none';
                const ta = document.getElementById('md-mapping-textarea');
                ta.style.display = '';
                ta.value = [
                    'GONZÁLEZ MARÍA => Actor',
                    'ASEGURADORA DEMO S.A. => Demandado',
                    'JUZGADO FEDERAL DE COMODORO RIVADAVIA => Juzgado interviniente',
                ].join('\\n');
            }"""
        )
        await capturar(page, "markdown", "6.5-editor-mapeo.png", "editor de mapeo con el .txt de reemplazos cargado")
        await page.evaluate("closeModal('modalMarkdown')")

        await browser.close()
        print("\n✅ 14 capturas generadas.")
        return 0
    finally:
        if pw is not None:
            await electron_driver.disconnect(pw)
        print("\nCerrando la app...")
        limpio = close_app()
        _log("Cierre limpio." if limpio else "Se forzó el cierre (Stop-Process).")


def main() -> int:
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())
