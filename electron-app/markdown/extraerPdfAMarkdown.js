// extraerPdfAMarkdown.js — Módulo Markdown/Anonimización, bloque M2.
/**
 * Extrae el informe PDF principal (el que genera la propia app) a Markdown,
 * preservando el orden de lectura y con marcador descriptivo en toda
 * página/sección sin texto extraíble.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DOS CAPAS, A PROPÓSITO
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. GENÉRICA (`extraerTextoPdf`) — abre cualquier PDF con pdfjs-dist y
 *      devuelve sus líneas de texto ya reconstruidas en orden de lectura real
 *      (no en el orden en que vinieron los items del PDF, que no está
 *      garantizado). La reutiliza M3 para los adjuntos del SCW, cuyo layout
 *      no se conoce de antemano.
 *   2. ESPECÍFICA DEL INFORME (`renderizarInformeMarkdown`) — conoce la
 *      plantilla exacta que genera `informequickscwpjn.js` (título · carátula
 *      · dependencia · situación · tabla de "Movimientos" · pie de página) y
 *      la traduce a Markdown. Un adjunto del SCW (M3) NO tiene esta estructura
 *      y no debe pasar por esta función.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  pdfjs-dist EN NODE/ELECTRON — NO ES TRIVIAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Desde la v4, pdfjs-dist es ESM puro (no hay build CJS) — se carga con
 * `import()` dinámico desde este módulo CommonJS (funciona en el proceso
 * principal de Electron, que corre sobre Node ≥18). `disableWorker: true`
 * evita depender de Web Workers (no existen en Node tal como los usa el
 * browser). `standardFontDataUrl`/`cMapUrl` apuntan a los recursos que trae el
 * propio paquete — sin esto, pdfjs solo emite un warning (no falla), pero usa
 * métricas de fuente por defecto que pueden desalinear texto en documentos con
 * fuentes no embebidas.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Reconstrucción de líneas en orden de lectura real ─────────────────────
// pdfjs-dist entrega los "items" de texto de una página en el orden del
// content stream del PDF, que NO es necesariamente el orden de lectura
// (columnas, tablas, texto rotado). El algoritmo estándar: ordenar por
// posición vertical (transform[5], "y") descendente — arriba primero — y
// horizontal (transform[4], "x") ascendente, agrupando en la misma línea los
// items cuya "y" cae dentro de una tolerancia (la mitad de la altura de letra
// típica del documento).
const TOLERANCIA_LINEA_PT = 3;

function reconstruirLineasPagina(items) {
    // Los PDF que genera la propia app dejan "items fantasma" vacíos (mismo
    // x/y que la línea real, altura 0) — artefacto del renderer de Puppeteer,
    // no texto real. Filtrarlos ANTES de agrupar evita líneas en blanco.
    const noVacios = items.filter(it => (it.str || '').trim().length > 0);
    if (noVacios.length === 0) return [];

    // transform = [a, b, c, d, e, f] → e=x, f=y (coordenadas del punto de
    // inserción del texto, sistema de PDF: y crece hacia ARRIBA).
    const conPos = noVacios.map(it => ({
        x: it.transform[4],
        y: it.transform[5],
        texto: it.str,
    }));

    // Orden primario por y descendente (arriba → abajo). Un sort estable
    // (garantizado por V8 desde hace años) preserva el orden original entre
    // items con la misma y, que ya vienen left-to-right en el content stream.
    conPos.sort((a, b) => b.y - a.y);

    // Agrupar en líneas: cada nuevo item abre una línea nueva si su "y" se
    // aleja de la línea actual más que la tolerancia; si no, se suma a ella.
    const lineas = [];
    let actual = null;
    for (const item of conPos) {
        if (actual && Math.abs(actual.y - item.y) <= TOLERANCIA_LINEA_PT) {
            actual.items.push(item);
        } else {
            actual = { y: item.y, items: [item] };
            lineas.push(actual);
        }
    }

    // Dentro de cada línea, ordenar por x ascendente (izquierda → derecha) y
    // concatenar con un espacio simple (pdfjs ya separa palabras en items
    // distintos cuando corresponde; un espacio de más se colapsa al trim()).
    return lineas.map(l =>
        l.items.sort((a, b) => a.x - b.x).map(i => i.texto).join(' ').replace(/\s+/g, ' ').trim()
    ).filter(t => t.length > 0);
}

// Pie de página que estampa `informequickscwpjn.js` en cada hoja — no es
// contenido del expediente, se descarta antes de clasificar.
const RE_PIE_PAGINA = /^Sistema Procurador SCW \| Generado: /i;

/**
 * Capa genérica — abre un PDF y devuelve el texto de cada página ya
 * reconstruido en líneas, en orden de lectura. No interpreta el contenido.
 *
 * @param {string} pdfPath
 * @returns {Promise<{ numPaginas: number, paginas: Array<{ numero: number, lineas: string[] }> }>}
 */
async function extraerTextoPdf(pdfPath) {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

    const data = fs.readFileSync(pdfPath);
    const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(data),
        disableWorker: true,
        isEvalSupported: false,
        standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts') + path.sep,
        cMapUrl: path.join(pdfjsRoot, 'cmaps') + path.sep,
        cMapPacked: true,
    }).promise;

    const paginas = [];
    for (let numero = 1; numero <= doc.numPages; numero++) {
        const page = await doc.getPage(numero);
        const content = await page.getTextContent();
        const lineas = reconstruirLineasPagina(content.items).filter(l => !RE_PIE_PAGINA.test(l));
        paginas.push({ numero, lineas });
        page.cleanup();
    }

    await doc.destroy();
    return { numPaginas: doc.numPages, paginas };
}

// ─── Clasificación y render específicos de la plantilla del informe ────────
// Ver `informequickscwpjn.js` para el layout real: título (expediente) →
// carátula (1-2 líneas) → dependencia/jurisdicción → "Situacion: X" →
// encabezado "Movimientos" → filas "DD/MM/YYYY - detalle" (algunas con una
// línea de continuación sin fecha, que envuelve el detalle) → sub-líneas
// "-> Ver documento" que señalan un adjunto (M3 se ocupa de bajarlo).

const RE_MOVIMIENTO = /^(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(.+)$/;
const RE_VER_DOCUMENTO = /^->\s*Ver documento/i;
const RE_SITUACION = /^Situaci[oó]n:\s*(.*)$/i;
const RE_MOVIMIENTOS_HEADER = /^movimientos$/i;

function escaparCeldaTabla(texto) {
    // Una "|" sin escapar corta la fila de una tabla Markdown en dos celdas.
    return texto.replace(/\|/g, '\\|');
}

function flushTablaMovimientos(filas, bloques) {
    if (filas.length === 0) return;
    const cuerpo = filas.map(f =>
        `| ${escaparCeldaTabla(f.fecha)} | ${escaparCeldaTabla(f.detalle)}${f.tieneDocumento ? ' 📎' : ''} |`
    ).join('\n');
    bloques.push(`| Fecha | Detalle |\n|---|---|\n${cuerpo}`);
}

/**
 * Capa específica del informe — recibe la salida de `extraerTextoPdf` y
 * devuelve el Markdown final.
 *
 * @param {Array<{ numero: number, lineas: string[] }>} paginas
 * @returns {{ markdown: string, paginasSinTexto: number[] }}
 */
function renderizarInformeMarkdown(paginas) {
    const bloques = [];
    const paginasSinTexto = [];

    let tituloEmitido = false;
    let enMovimientos = false;
    const lineasCaratula = [];
    let filasActuales = [];       // tabla en construcción
    let ultimaFila = null;        // para adosar "-> Ver documento" y continuaciones

    const flushCaratula = () => {
        if (lineasCaratula.length > 0) {
            bloques.push(lineasCaratula.map(l => `> ${l}`).join('\n'));
            lineasCaratula.length = 0;
        }
    };

    for (const pagina of paginas) {
        if (pagina.lineas.length === 0) {
            // Página sin texto extraíble — se corta la tabla en curso (una
            // tabla Markdown no puede interrumpirse a mitad y seguir siendo
            // la misma tabla) y se deja un marcador honesto en su lugar.
            if (enMovimientos) { flushTablaMovimientos(filasActuales, bloques); filasActuales = []; ultimaFila = null; }
            bloques.push(`> [Página ${pagina.numero} — imagen sin texto extraíble]`);
            paginasSinTexto.push(pagina.numero);
            continue;
        }

        for (const linea of pagina.lineas) {
            if (!enMovimientos) {
                if (RE_MOVIMIENTOS_HEADER.test(linea)) {
                    flushCaratula();
                    bloques.push('## Movimientos');
                    enMovimientos = true;
                    continue;
                }
                if (!tituloEmitido) {
                    bloques.push(`# ${linea}`);
                    tituloEmitido = true;
                    continue;
                }
                const mSituacion = linea.match(RE_SITUACION);
                if (mSituacion) {
                    flushCaratula();
                    bloques.push(`**Situación:** ${mSituacion[1]}`);
                    continue;
                }
                // Todo lo demás en el bloque de encabezado (carátula,
                // jurisdicción/dependencia) se acumula como cita, en el
                // orden en que aparece — sin inventar etiquetas que el PDF
                // no trae (no todos los fueros escriben "Justicia X | ...").
                lineasCaratula.push(linea);
                continue;
            }

            // ── Dentro de "Movimientos" ──
            if (RE_VER_DOCUMENTO.test(linea)) {
                if (ultimaFila) ultimaFila.tieneDocumento = true;
                continue;
            }
            const mMov = linea.match(RE_MOVIMIENTO);
            if (mMov) {
                ultimaFila = { fecha: mMov[1], detalle: mMov[2], tieneDocumento: false };
                filasActuales.push(ultimaFila);
                continue;
            }
            // Sin fecha y no es "-> Ver documento": es la continuación de la
            // fila anterior, que el PDF envolvió a la línea siguiente.
            if (ultimaFila) {
                ultimaFila.detalle += ' ' + linea;
            } else {
                // Caso borde: una continuación sin ninguna fila previa (no
                // debería ocurrir en la plantilla real) — no se descarta el
                // texto, se deja como nota suelta para no perder información.
                bloques.push(`> ${linea}`);
            }
        }
    }

    flushCaratula();
    flushTablaMovimientos(filasActuales, bloques);

    return { markdown: bloques.join('\n\n') + '\n', paginasSinTexto };
}

// ─── Nombre del archivo de salida ───────────────────────────────────────────
// Mismo `<exp>` que ya lleva el PDF de origen (`informe_<exp>_<ISO>.pdf`,
// convención de v2.7.33) — no se re-deriva del texto extraído: el PDF de
// entrada YA es la fuente de verdad para ese identificador, y reusar el
// mismo token evita una tercera implementación de "cómo se sanea un
// expediente para nombre de archivo" (la canónica vive en
// `expedienteKey.js`/`buscarPdfExpediente.js`, y esto no es ese problema).
const RE_SUFIJO_TIMESTAMP_ISO = /_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const RE_PREFIJO_INFORME = /^(informe|expediente)_/i;

function derivarNombreSalida(pdfPath) {
    const base = path.basename(pdfPath, '.pdf');
    const exp = base.replace(RE_PREFIJO_INFORME, '').replace(RE_SUFIJO_TIMESTAMP_ISO, '');
    const sello = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `markdown_${exp}_${sello}.md`;
}

/**
 * Pipeline completo: PDF de informe → archivo .md en `outputDir`.
 *
 * @param {string} pdfPath - Ruta al PDF del informe (generado por la app)
 * @param {string} outputDir - Carpeta de descargas del usuario (PROCURADOR_DATA_DIR/descargas)
 * @returns {Promise<{ mdPath: string, numPaginas: number, paginasSinTexto: number[] }>}
 */
async function procesarInformeAMarkdown(pdfPath, outputDir) {
    const { numPaginas, paginas } = await extraerTextoPdf(pdfPath);
    const { markdown, paginasSinTexto } = renderizarInformeMarkdown(paginas);

    fs.mkdirSync(outputDir, { recursive: true });
    const mdPath = path.join(outputDir, derivarNombreSalida(pdfPath));
    fs.writeFileSync(mdPath, markdown, 'utf8');

    return { mdPath, numPaginas, paginasSinTexto };
}

module.exports = {
    reconstruirLineasPagina,
    extraerTextoPdf,
    renderizarInformeMarkdown,
    procesarInformeAMarkdown,
    derivarNombreSalida,
};
