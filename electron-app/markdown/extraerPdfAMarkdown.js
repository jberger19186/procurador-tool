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

/**
 * Render genérico — para PDFs sin la plantilla conocida del informe (los
 * adjuntos del SCW que descarga M3: despachos, cédulas, DEOs, sentencias,
 * cuyo layout no se conoce de antemano). A diferencia de
 * `renderizarInformeMarkdown`, NO intenta reconocer una tabla de movimientos
 * ni un encabezado — solo concatena las líneas de cada página como texto
 * corrido, dejando el mismo marcador honesto en las páginas sin texto.
 *
 * @param {Array<{ numero: number, lineas: string[] }>} paginas
 * @returns {{ markdown: string, paginasSinTexto: number[] }}
 */
function renderizarGenericoMarkdown(paginas) {
    const bloques = [];
    const paginasSinTexto = [];
    for (const pagina of paginas) {
        if (pagina.lineas.length === 0) {
            bloques.push(`> [Página ${pagina.numero} — imagen sin texto extraíble]`);
            paginasSinTexto.push(pagina.numero);
            continue;
        }
        bloques.push(pagina.lineas.join('  \n'));
    }
    return { markdown: bloques.join('\n\n'), paginasSinTexto };
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

// 🚨 F5 (2026-08-31): el informe NO termina en la tabla de movimientos.
// `agregarSeccion(...)` de `testM2.js` dibuja SIETE títulos de sección, cada uno
// como una línea suelta de texto en negrita: Resumen · Movimientos ·
// Movimientos Históricos · Intervinientes · Vinculados · Recursos · Notas.
// Esta función solo conocía "Movimientos", y una vez dentro de la tabla NUNCA
// salía: todo lo que venía después caía en la rama de "continuación" y se
// pegaba, con un espacio, a la ÚLTIMA fila parseada.
//
// Confirmado renderizando la estructura real: la sección **Intervinientes**
// entera —el roster de partes y letrados con sus nombres, tomo/folio y CUIT—
// terminaba dentro de una sola celda de un movimiento sin relación, con sus
// `|` escapados a `\|`, o sea con la estructura original destruida y sin
// ningún encabezado que la separe.
//
// No es solo una fealdad de formato: el `mapping.txt`, los TyC y el propio
// encabezado de `anonimizar.js` apoyan TODA la seguridad del módulo en que el
// usuario REVISE el `.md` antes de compartirlo. Con el listado de partes
// enterrado sin marcador en medio de un evento procesal, esa revisión —que es
// la única garantía real que el producto ofrece— se vuelve impracticable.
const RE_SECCION_INFORME = /^(Resumen|Movimientos(?:\s+Hist[oó]ricos)?|Intervinientes|Vinculados|Recursos|Notas)$/i;
// Cuál de esas secciones se renderiza como TABLA. Reemplaza al viejo
// `RE_MOVIMIENTOS_HEADER` (`^movimientos$`, exacto), que dejaba a "Movimientos
// Históricos" —que también trae filas `DD/MM/AAAA - detalle`— cayendo en la
// rama de texto corrido en vez de abrir su propia tabla.
const RE_SECCION_TABLA = /^Movimientos(\s+Hist[oó]ricos)?$/i;

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
    let enSeccionTexto = false;   // dentro de una sección que NO es una tabla
    const lineasCaratula = [];
    const lineasSeccion = [];     // cuerpo de la sección de texto en curso
    let filasActuales = [];       // tabla en construcción
    let ultimaFila = null;        // para adosar "-> Ver documento" y continuaciones

    const flushCaratula = () => {
        if (lineasCaratula.length > 0) {
            bloques.push(lineasCaratula.map(l => `> ${l}`).join('\n'));
            lineasCaratula.length = 0;
        }
    };

    // F5: cierra la sección de texto en curso (Intervinientes, Notas…). Se
    // emite con doble espacio al final de cada línea para que el Markdown
    // conserve los saltos — cada fila del roster de partes es una línea propia
    // en el PDF y debe seguir siéndolo.
    const flushSeccionTexto = () => {
        if (lineasSeccion.length > 0) {
            bloques.push(lineasSeccion.join('  \n'));
            lineasSeccion.length = 0;
        }
    };

    // F5: cierra lo que haya abierto (tabla o sección de texto) antes de
    // empezar algo nuevo. Es el paso que faltaba y que hacía que la tabla de
    // movimientos se tragara todo el resto del informe.
    const cerrarSeccionActual = () => {
        if (enMovimientos) {
            flushTablaMovimientos(filasActuales, bloques);
            filasActuales = [];
            ultimaFila = null;
        }
        flushSeccionTexto();
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
            // F5 — un título de sección corta SIEMPRE lo que estuviera abierto,
            // sin importar el estado. Va antes que todo lo demás para que ni la
            // tabla ni la carátula se lo coman.
            if (RE_SECCION_INFORME.test(linea)) {
                flushCaratula();
                cerrarSeccionActual();
                bloques.push(`## ${linea}`);
                enMovimientos = RE_SECCION_TABLA.test(linea);
                enSeccionTexto = !enMovimientos;
                // Ya pasamos el encabezado: ninguna línea posterior puede ser
                // el título del documento.
                tituloEmitido = true;
                continue;
            }

            if (enSeccionTexto) {
                lineasSeccion.push(linea);
                continue;
            }

            if (!enMovimientos) {
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
                // F5: sin fila previa el marcador se descartaba en silencio —
                // inconsistente con el caso hermano de abajo (una continuación
                // huérfana SÍ se preserva como nota). Se perdía el dato de que
                // ese movimiento tenía un adjunto, y M3 lo bajaba igual: quedaba
                // un "Anexo N" sin ningún 📎 en la tabla que le correspondiera.
                if (ultimaFila) ultimaFila.tieneDocumento = true;
                else bloques.push(`> ${linea}`);
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
    cerrarSeccionActual();   // F5: cierra la tabla Y la sección de texto en curso

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

// F5 (2026-08-31): el nombre del PDF de entrada lo elige el USUARIO desde un
// diálogo nativo — no tiene por qué venir de la app, y en Windows puede traer
// `< > : " / \ | ? *`, que son ilegales en un nombre de archivo. Sin sanear,
// el `fs.writeFileSync` de más abajo tiraba un ENOENT no controlado (probado:
// `Informe: FCR 123.pdf` alcanza). El sanitizador es el MISMO que M3 ya usa
// para el `filename` del `Content-Disposition` (`descargarAdjuntos.js`) — el
// patrón ya existía en el módulo vecino y nunca se había aplicado acá.
// El recorte a 80 caracteres cubre el otro fallo medido: un nombre de origen
// largo excedía el límite de path de Windows.
const MAX_LARGO_STEM = 80;

function derivarNombreSalida(pdfPath) {
    // `.pdf` en minúscula solamente en `path.basename` — un `.PDF` en
    // mayúsculas se arrastraba entero al nombre nuevo.
    const nombre = path.basename(pdfPath);
    const base = nombre.replace(/\.pdf$/i, '');
    const exp = base
        .replace(RE_PREFIJO_INFORME, '')
        .replace(RE_SUFIJO_TIMESTAMP_ISO, '')
        .replace(/[\\/:"*?<>|]/g, '_')
        .replace(/[\s.]+$/, '')          // Windows no admite el punto/espacio final
        .slice(0, MAX_LARGO_STEM)
        .trim();
    const sello = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `markdown_${exp || 'informe'}_${sello}.md`;
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
    renderizarGenericoMarkdown,
    procesarInformeAMarkdown,
    derivarNombreSalida,
};
