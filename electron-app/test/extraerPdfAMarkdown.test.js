/**
 * Verifica el motor de extracción PDF→Markdown del módulo Markdown/Anonimización
 * (bloque M2, plan `docs/internal/plan-modulo-markdown-anonimizacion-2026-08-26.md`).
 *
 *   node electron-app/test/extraerPdfAMarkdown.test.js [ruta_pdf_real]
 *
 * Dos capas de prueba, siguiendo la lección de F3.0 de Bitácora (no construir
 * bloques sin ejercitarlos contra datos reales desde el primer día):
 *
 *   1. Unidades sobre `reconstruirLineasPagina` y `renderizarInformeMarkdown`
 *      con datos sintéticos — cazan casos de borde que un PDF real de hoy no
 *      trae pero podría traer mañana (página sin texto, continuación sin fila
 *      previa, celda con "|").
 *   2. Integración contra un PDF real de informe — si se pasa una ruta como
 *      argumento se usa esa; si no, se busca automáticamente el más reciente
 *      en `%APPDATA%\procurador-electron\usuarios\*\descargas\informe_*.pdf`.
 *      Sin esto, M2 se declararía listo sin haber tocado un solo PDF real.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    reconstruirLineasPagina,
    renderizarInformeMarkdown,
    procesarInformeAMarkdown,
    derivarNombreSalida,
} = require('../markdown/extraerPdfAMarkdown');

let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`✅ ${nombre}`); }
    else { fail++; console.log(`❌ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. UNIDADES — reconstruirLineasPagina
// ═══════════════════════════════════════════════════════════════════════════

function itemFake(x, y, str, height) {
    return { transform: [1, 0, 0, 1, x, y], str, height: height ?? 10 };
}

(function testReconstruirLineas() {
    // Items deliberadamente desordenados y con un item vacío (fantasma) —
    // el orden de entrada NO debe importar, solo la posición.
    const items = [
        itemFake(100, 500, 'mundo'),      // línea de abajo, 2da palabra
        itemFake(50, 700, 'Hola'),        // línea de arriba, 1ra palabra
        itemFake(50, 500, ''),            // item fantasma (altura 0, texto vacío)
        itemFake(120, 700, 'PDF'),        // línea de arriba, 3ra palabra
        itemFake(50, 500, 'Hola'),        // línea de abajo, 1ra palabra
        itemFake(85, 700, 'del'),         // línea de arriba, 2da palabra
    ];
    const lineas = reconstruirLineasPagina(items);
    check('reconstruirLineasPagina: reordena por y desc y x asc pese al orden de entrada',
        lineas.length === 2 && lineas[0] === 'Hola del PDF' && lineas[1] === 'Hola mundo',
        JSON.stringify(lineas));

    check('reconstruirLineasPagina: página sin items no vacíos devuelve []',
        reconstruirLineasPagina([itemFake(0, 0, ''), itemFake(0, 0, '   ')]).length === 0);

    // Dos líneas MUY cercanas en y (menos que la tolerancia) deben agruparse
    // en una sola — simula el jitter sub-píxel real de un renderer.
    const cercanas = [itemFake(50, 700.0, 'A'), itemFake(60, 701.5, 'B')];
    check('reconstruirLineasPagina: tolerancia de línea agrupa y-deltas chicos (jitter)',
        reconstruirLineasPagina(cercanas).length === 1);
})();

// ═══════════════════════════════════════════════════════════════════════════
//  2. UNIDADES — renderizarInformeMarkdown (plantilla del informe)
// ═══════════════════════════════════════════════════════════════════════════

(function testRenderizarInforme() {
    const paginas = [
        {
            numero: 1,
            lineas: [
                'FCR 018745/2017',
                'AFIP-DGI (BD 7570/10/2017) c/ PARDO MONTOYA, SHIRLEY',
                'LICET s/EJECUCION FISCAL - A.F.I.P.',
                'Justicia Federal de Comodoro Rivadavia | JUZGADO FEDERAL DE RIO GALLEGOS',
                'Situacion: ARCHÍVESE',
                'Movimientos',
                '20/11/2025 - FIRMA DESPACHO: ARCHIVO',
                '-> Ver documento',
                '3/02/2023 - CEDULA ELECTRONICA TRIBUNAL: CEDULA N° 23000062608263 - NOTIFICADO EL DIA:',
                '03/02/2023 12:25',   // continuación sin fecha, envuelve la fila anterior
            ],
        },
        {
            numero: 2,
            lineas: [], // simula una página sin texto extraíble (imagen pura)
        },
        {
            numero: 3,
            lineas: [
                '1/02/2023 - MOVIMIENTO: EN DESPACHO',
            ],
        },
    ];

    const { markdown, paginasSinTexto } = renderizarInformeMarkdown(paginas);

    check('renderizarInformeMarkdown: título como H1 (primera línea de página 1)',
        markdown.startsWith('# FCR 018745/2017'));
    check('renderizarInformeMarkdown: carátula y jurisdicción como blockquote (sin inventar etiquetas)',
        markdown.includes('> AFIP-DGI (BD 7570/10/2017) c/ PARDO MONTOYA, SHIRLEY') &&
        markdown.includes('> Justicia Federal de Comodoro Rivadavia'));
    check('renderizarInformeMarkdown: "Situacion:" se etiqueta explícitamente',
        markdown.includes('**Situación:** ARCHÍVESE'));
    check('renderizarInformeMarkdown: encabezado de sección Movimientos',
        markdown.includes('## Movimientos'));
    check('renderizarInformeMarkdown: fila de movimiento con marcador de documento vinculado',
        markdown.includes('| 20/11/2025 | FIRMA DESPACHO: ARCHIVO 📎 |'));
    check('renderizarInformeMarkdown: continuación sin fecha se funde en la fila anterior (no crea fila nueva)',
        markdown.includes('| 3/02/2023 | CEDULA ELECTRONICA TRIBUNAL: CEDULA N° 23000062608263 - NOTIFICADO EL DIA: 03/02/2023 12:25 |') &&
        !markdown.includes('| 03/02/2023 12:25 |'));
    check('renderizarInformeMarkdown: página sin texto deja el marcador honesto y CORTA la tabla',
        markdown.includes('> [Página 2 — imagen sin texto extraíble]'));
    check('renderizarInformeMarkdown: paginasSinTexto reporta exactamente [2]',
        paginasSinTexto.length === 1 && paginasSinTexto[0] === 2, JSON.stringify(paginasSinTexto));
    check('renderizarInformeMarkdown: la tabla se retoma en la página 3 (2 tablas separadas por el marcador)',
        (markdown.match(/\| Fecha \| Detalle \|/g) || []).length === 2);

    // Celda con "|" no debe romper la tabla.
    const conPipe = renderizarInformeMarkdown([{
        numero: 1,
        lineas: ['EXP 1/2020', 'Movimientos', '1/01/2020 - DESPACHO: A | B'],
    }]);
    check('renderizarInformeMarkdown: un "|" en el detalle se escapa (no corta la fila)',
        conPipe.markdown.includes('DESPACHO: A \\| B'));

    // Continuación sin ninguna fila previa (caso borde, no debería pasar en
    // la plantilla real) — no debe tirar excepción ni perder el texto.
    const sinFilaPrevia = renderizarInformeMarkdown([{
        numero: 1,
        lineas: ['EXP 1/2020', 'Movimientos', 'texto suelto sin fecha ni "-> Ver documento"'],
    }]);
    check('renderizarInformeMarkdown: continuación sin fila previa no explota, queda como nota',
        sinFilaPrevia.markdown.includes('> texto suelto sin fecha'));

    // ── F5 (2026-08-31) ──────────────────────────────────────────────────
    // 🚨 La tabla de movimientos NUNCA cerraba: `enMovimientos` se ponía en
    // true y no volvía atrás, así que TODA sección posterior del informe
    // (Intervinientes, Vinculados, Recursos, Notas, Movimientos Históricos —
    // los 7 títulos que dibuja `agregarSeccion()` en testM2.js) se pegaba con
    // un espacio a la última fila parseada. El caso grave es Intervinientes:
    // el roster de partes y letrados con nombres, tomo/folio y CUIT terminaba
    // adentro de una celda de un movimiento sin relación, con sus `|`
    // escapados a `\|`. No produce una fuga por sí solo (M4 escanea texto
    // libre), pero hace impracticable la revisión manual del `.md` — que es la
    // única garantía real que el módulo ofrece (ver el encabezado de
    // anonimizar.js y los TyC).
    const conSecciones = renderizarInformeMarkdown([{
        numero: 1,
        lineas: [
            'EXP 1/2020', 'Situacion: EN TRAMITE', 'Movimientos',
            '1/01/2020 - PRIMER MOVIMIENTO',
            'Intervinientes',
            'LETRADO APODERADO|APELLIDO UNO|Tomo: 1|20111111112',
            'DEMANDADO|NOMBRE : APELLIDO DOS||',
            'Notas', 'Una nota del expediente.',
        ],
    }]);
    check('F5 — un título de sección CIERRA la tabla de movimientos',
        /\| 1\/01\/2020 \| PRIMER MOVIMIENTO \|/.test(conSecciones.markdown), conSecciones.markdown);
    check('F5 — "Intervinientes" queda como sección propia, no dentro de una celda',
        conSecciones.markdown.includes('## Intervinientes') &&
        !/\| 1\/01\/2020 \|[^\n]*Intervinientes/.test(conSecciones.markdown), conSecciones.markdown);
    check('F5 — el roster de partes conserva una línea por interviniente',
        /APELLIDO UNO\|Tomo: 1\|20111111112 {2}\n/.test(conSecciones.markdown), conSecciones.markdown);
    check('F5 — las secciones siguientes (Notas) también se separan',
        conSecciones.markdown.includes('## Notas') &&
        conSecciones.markdown.includes('Una nota del expediente.'));

    const conHistoricos = renderizarInformeMarkdown([{
        numero: 1,
        lineas: ['EXP 1/2020', 'Movimientos', '1/01/2020 - A', 'Movimientos Históricos', '2/01/2019 - B'],
    }]);
    check('F5 — "Movimientos Históricos" abre su propia tabla, no continúa la anterior',
        conHistoricos.markdown.includes('## Movimientos Históricos') &&
        (conHistoricos.markdown.match(/\| Fecha \| Detalle \|/g) || []).length === 2,
        conHistoricos.markdown);

    // El caso hermano del que ya estaba cubierto arriba: un "-> Ver documento"
    // sin fila previa se descartaba en SILENCIO (el otro sí se preservaba).
    const verDocHuerfano = renderizarInformeMarkdown([{
        numero: 1,
        lineas: ['EXP 1/2020', 'Movimientos', '-> Ver documento', '1/01/2020 - X'],
    }]);
    check('F5 — "-> Ver documento" sin fila previa no se pierde en silencio',
        verDocHuerfano.markdown.includes('> -> Ver documento'), verDocHuerfano.markdown);
})();

// ═══════════════════════════════════════════════════════════════════════════
//  3. UNIDAD — derivarNombreSalida (convención de nombres v2.7.33)
// ═══════════════════════════════════════════════════════════════════════════

(function testDerivarNombreSalida() {
    const nombre = derivarNombreSalida('C:/x/informe_FCR 018745_2017_2026-08-25T18-09-54.pdf');
    check('derivarNombreSalida: prefijo markdown_, mismo <exp> que el PDF de origen, sin timestamp del origen',
        nombre.startsWith('markdown_FCR 018745_2017_') && nombre.endsWith('.md') &&
        !nombre.includes('2026-08-25T18-09-54'),
        nombre);

    // ── F5 (2026-08-31) ──────────────────────────────────────────────────
    // El PDF de entrada lo elige el usuario desde un diálogo nativo: no tiene
    // por qué venir de la app. Sin sanear, un nombre con caracteres ilegales
    // en Windows hacía que `fs.writeFileSync` tirara un ENOENT no controlado.
    const ILEGALES = /[\\/:"*?<>|]/;
    const raro = derivarNombreSalida('C:/x/Informe: FCR 123 <final>.pdf');
    check('F5 — derivarNombreSalida sanea los caracteres ilegales de Windows',
        !ILEGALES.test(raro) && raro.endsWith('.md'), raro);

    const mayus = derivarNombreSalida('C:/x/informe_FCR 018745_2017_2026-08-25T18-09-54.PDF');
    check('F5 — la extensión .PDF en mayúsculas también se saca',
        !/\.PDF/i.test(mayus.replace(/\.md$/, '')) && mayus.startsWith('markdown_FCR 018745_2017_'), mayus);

    const largo = derivarNombreSalida('C:/x/' + 'A'.repeat(300) + '.pdf');
    check('F5 — un nombre de origen larguísimo se recorta (límite de path de Windows)',
        largo.length < 130, `largo=${largo.length}`);

    check('F5 — un nombre vacío tras sanear cae a un stem por defecto',
        derivarNombreSalida('C:/x/.pdf').startsWith('markdown_informe_'));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  4. INTEGRACIÓN — contra un PDF real de informe
// ═══════════════════════════════════════════════════════════════════════════

function buscarInformeReal() {
    const argPath = process.argv[2];
    if (argPath && fs.existsSync(argPath)) return argPath;

    const base = path.join(os.homedir(), 'AppData', 'Roaming', 'procurador-electron', 'usuarios');
    if (!fs.existsSync(base)) return null;
    let mejor = null, mejorMtime = 0;
    for (const cuit of fs.readdirSync(base)) {
        const descargas = path.join(base, cuit, 'descargas');
        if (!fs.existsSync(descargas)) continue;
        for (const f of fs.readdirSync(descargas)) {
            if (!/^informe_.*\.pdf$/i.test(f)) continue;
            const full = path.join(descargas, f);
            const mtime = fs.statSync(full).mtimeMs;
            if (mtime > mejorMtime) { mejorMtime = mtime; mejor = full; }
        }
    }
    return mejor;
}

async function testIntegracionReal() {
    const pdfPath = buscarInformeReal();
    if (!pdfPath) {
        console.log('⚠️  Sin PDF real disponible (ni por argumento ni en la carpeta de descargas) — se omite la integración.');
        return;
    }
    console.log(`\n▶ Integración contra PDF real: ${pdfPath}`);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-m2-test-'));
    try {
        const { mdPath, numPaginas, paginasSinTexto } = await procesarInformeAMarkdown(pdfPath, outDir);

        check('procesarInformeAMarkdown: escribe el archivo .md en outputDir', fs.existsSync(mdPath), mdPath);
        check('procesarInformeAMarkdown: nombre de archivo sigue la convención markdown_<exp>_<ISO>.md',
            /^markdown_.+_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/.test(path.basename(mdPath)),
            path.basename(mdPath));

        const contenido = fs.readFileSync(mdPath, 'utf8');
        check('procesarInformeAMarkdown: el .md tiene un título H1', /^# /.test(contenido));
        check('procesarInformeAMarkdown: el .md tiene la sección Movimientos', contenido.includes('## Movimientos'));
        check('procesarInformeAMarkdown: el .md tiene al menos una fila de la tabla', /^\| \d{1,2}\/\d{1,2}\/\d{4} \|/m.test(contenido));
        check('procesarInformeAMarkdown: numPaginas > 0', numPaginas > 0, `numPaginas=${numPaginas}`);

        // Dato de M0: el informe que genera la app dio 0% de páginas sin texto
        // sobre 30 informes reales — un informe real con páginas sin texto acá
        // sería una regresión respecto de esa medición, no un resultado neutro.
        check('procesarInformeAMarkdown: 0 páginas sin texto (coincide con la medición de M0)',
            paginasSinTexto.length === 0, `paginasSinTexto=${JSON.stringify(paginasSinTexto)}`);

        console.log(`   ${numPaginas} páginas · ${contenido.length} chars de Markdown · archivo: ${path.basename(mdPath)}`);
    } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
}

testIntegracionReal().then(() => {
    console.log(`\n${ok}/${ok + fail} PASS`);
    if (fail > 0) process.exit(1);
}).catch(e => {
    console.error('❌ Error inesperado:', e);
    process.exit(1);
});
