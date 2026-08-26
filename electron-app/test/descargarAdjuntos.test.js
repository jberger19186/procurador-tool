/**
 * Verifica el motor de descarga y unificación de adjuntos (bloque M3),
 * plan `docs/internal/plan-modulo-markdown-anonimizacion-2026-08-26.md`.
 *
 *   node electron-app/test/descargarAdjuntos.test.js [ruta_pdf_real] [--full]
 *
 * Tres capas:
 *   1. Unidades sobre la allowlist y la deduplicación por URL — sintéticas,
 *      cubren los casos que un PDF real de hoy no trae pero un informe
 *      manipulado sí podría (SSRF vía file://, host ajeno, IP de metadata).
 *   2. Unidades sobre el registro de deduplicación por `filename` y los
 *      límites de tamaño — con `fetch` mockeado (Node expone `fetch` como
 *      global mutable en este proceso), para no depender de que dos
 *      informes reales compartan un adjunto para poder probar el reuso.
 *   3. Integración real contra el SCW: extracción de links de un PDF real
 *      (todos, sin recortar) + descarga real de una MUESTRA CHICA (2 de los
 *      ~35 medidos) para no golpear el servidor real en cada corrida de este
 *      test. `--full` descarga y extrae TODOS los adjuntos reales (más lento,
 *      opt-in, deliberadamente no es el default).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    esUrlPermitida,
    extraerLinksInforme,
    deduplicarPorUrl,
    crearRegistroAdjuntos,
    descargarAdjuntos,
    extraerAdjuntosAMarkdown,
    procesarAdjuntosDeInforme,
    MAX_BYTES_POR_ADJUNTO,
} = require('../markdown/descargarAdjuntos');

let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`✅ ${nombre}`); }
    else { fail++; console.log(`❌ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. UNIDADES — allowlist de host (adelanto de S10 de SEC-2)
// ═══════════════════════════════════════════════════════════════════════════

(function testAllowlist() {
    check('esUrlPermitida: acepta la forma real medida por M0',
        esUrlPermitida('https://scw.pjn.gov.ar/scw/viewer.seam?id=abc%3D&tipoDoc=despacho'));
    check('esUrlPermitida: rechaza http (sin TLS)',
        !esUrlPermitida('http://scw.pjn.gov.ar/scw/viewer.seam?id=abc'));
    check('esUrlPermitida: rechaza un host ajeno (SSRF a localhost)',
        !esUrlPermitida('https://127.0.0.1:3443/scw/viewer.seam?id=abc'));
    check('esUrlPermitida: rechaza un host ajeno (SSRF a metadata de nube)',
        !esUrlPermitida('https://169.254.169.254/scw/viewer.seam'));
    check('esUrlPermitida: rechaza file://',
        !esUrlPermitida('file:///etc/passwd'));
    check('esUrlPermitida: rechaza un subdominio parecido pero distinto (typosquatting)',
        !esUrlPermitida('https://scw.pjn.gov.ar.evil.com/scw/viewer.seam'));
    check('esUrlPermitida: rechaza el host correcto con un path ajeno',
        !esUrlPermitida('https://scw.pjn.gov.ar/otra-cosa'));
    check('esUrlPermitida: rechaza una URL malformada sin explotar',
        !esUrlPermitida('no-es-una-url'));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  2. UNIDAD — deduplicarPorUrl
// ═══════════════════════════════════════════════════════════════════════════

(function testDedupUrl() {
    const links = [
        { url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=A', pagina: 1 },
        { url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=B', pagina: 1 },
        { url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=A', pagina: 2 }, // repetida
    ];
    const unicos = deduplicarPorUrl(links);
    check('deduplicarPorUrl: 3 links con 1 URL repetida → 2 únicos, preserva el orden de aparición',
        unicos.length === 2 && unicos[0].url.endsWith('id=A') && unicos[1].url.endsWith('id=B'),
        JSON.stringify(unicos));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  3. UNIDADES — descargarAdjuntos con fetch mockeado (sin red real)
// ═══════════════════════════════════════════════════════════════════════════

function respuestaFake({ status = 200, filename, bytes }) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (h) => h.toLowerCase() === 'content-disposition' ? `inline; filename="${filename}"` : null },
        body: {
            getReader() {
                let leido = false;
                return {
                    async read() {
                        if (leido) return { done: true, value: undefined };
                        leido = true;
                        return { done: false, value: bytes };
                    },
                };
            },
        },
    };
}

async function testDescargaMockeada() {
    const fetchOriginal = global.fetch;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-descargar-adjuntos-'));

    try {
        // ── 3a. Descarga simple: filename derivado del Content-Disposition ──
        global.fetch = async () => respuestaFake({ filename: 'doc111.pdf', bytes: Buffer.from('%PDF-fake') });
        let { adjuntos, errores } = await descargarAdjuntos(
            [{ url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=X1', tipoDoc: 'despacho', pagina: 1 }],
            { tempDir }
        );
        check('descargarAdjuntos: 1 link → 1 adjunto, filename tomado del Content-Disposition',
            adjuntos.length === 1 && adjuntos[0].filename === 'doc111.pdf' && errores.length === 0,
            JSON.stringify({ adjuntos, errores }));
        check('descargarAdjuntos: el archivo se escribió realmente en tempDir',
            fs.existsSync(adjuntos[0].localPath));

        // ── 3b. Dedup por filename, entre 2 llamadas que comparten `registro` ──
        // Simula 2 informes del mismo expediente: URLs (tokens) DISTINTAS,
        // mismo documento subyacente → mismo filename en el Content-Disposition
        // (exactamente el hallazgo de M0). Se registra el filename recién
        // extraído (como haría `extraerAdjuntosAMarkdown` en el pipeline real)
        // antes de la segunda descarga, para aislar la prueba de la extracción.
        const registro = crearRegistroAdjuntos();
        registro.set('doc222.pdf', { localPath: '/ya/existente/doc222.pdf', markdown: '## contenido ya extraído' });
        global.fetch = async () => respuestaFake({ filename: 'doc222.pdf', bytes: Buffer.from('%PDF-otra-corrida') });
        const r2 = await descargarAdjuntos(
            [{ url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=TOKEN-DISTINTO', tipoDoc: 'cedula', pagina: 1 }],
            { tempDir, registro }
        );
        check('descargarAdjuntos: mismo filename que ya está en el registro → reusado:true, no descarga de nuevo',
            r2.adjuntos.length === 1 && r2.adjuntos[0].reusado === true && r2.adjuntos[0].bytes === 0,
            JSON.stringify(r2.adjuntos));

        // ── 3c. Tope de tamaño por adjunto ──
        global.fetch = async () => respuestaFake({ filename: 'doc-grande.pdf', bytes: Buffer.alloc(MAX_BYTES_POR_ADJUNTO + 1) });
        const r3 = await descargarAdjuntos(
            [{ url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=GRANDE', tipoDoc: 'despacho', pagina: 1 }],
            { tempDir }
        );
        check('descargarAdjuntos: un adjunto que excede el tope de bytes queda en errores, no en adjuntos',
            r3.adjuntos.length === 0 && r3.errores.length === 1 && /máximo/.test(r3.errores[0].motivo),
            JSON.stringify(r3));

        // ── 3d. Un fallo puntual no aborta el resto del lote ──
        let llamada = 0;
        global.fetch = async () => {
            llamada++;
            if (llamada === 1) throw new Error('red caída');
            return respuestaFake({ filename: `doc-ok-${llamada}.pdf`, bytes: Buffer.from('%PDF-') });
        };
        const r4 = await descargarAdjuntos(
            [
                { url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=FALLA', tipoDoc: 'despacho', pagina: 1 },
                { url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=OK', tipoDoc: 'despacho', pagina: 2 },
            ],
            { tempDir }
        );
        check('descargarAdjuntos: 1 falla + 1 OK → el lote sigue, no se corta en el primer error',
            r4.errores.length === 1 && r4.adjuntos.length === 1,
            JSON.stringify(r4));

        // ── 3e. onProgress se llama con los eventos esperados ──
        const eventos = [];
        global.fetch = async () => respuestaFake({ filename: 'doc-progreso.pdf', bytes: Buffer.from('%PDF-') });
        await descargarAdjuntos(
            [{ url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=PROG', tipoDoc: 'despacho', pagina: 1 }],
            { tempDir, onProgress: (e) => eventos.push(e.tipo) }
        );
        check('descargarAdjuntos: onProgress emite descarga-inicio y descarga-fin',
            eventos.includes('descarga-inicio') && eventos.includes('descarga-fin'), JSON.stringify(eventos));

    } finally {
        global.fetch = fetchOriginal;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. INTEGRACIÓN REAL — contra el SCW, con un PDF real de informe
// ═══════════════════════════════════════════════════════════════════════════

function buscarInformeReal() {
    const argPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
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
        console.log('⚠️  Sin PDF real disponible — se omite la integración de M3.');
        return;
    }
    console.log(`\n▶ Integración M3 contra PDF real: ${pdfPath}`);

    const { links, descartados } = await extraerLinksInforme(pdfPath);
    check('extraerLinksInforme: encuentra al menos 1 link real', links.length > 0, `links=${links.length}`);
    check('extraerLinksInforme: 0 descartados por allowlist (todas las URLs reales son del SCW)',
        descartados === 0, `descartados=${descartados}`);
    check('extraerLinksInforme: cada link trae tipoDoc reconocido',
        links.every(l => ['despacho', 'cedula', 'deo', 'sentencia'].includes(l.tipoDoc)),
        JSON.stringify([...new Set(links.map(l => l.tipoDoc))]));

    const unicos = deduplicarPorUrl(links);
    check('deduplicarPorUrl sobre datos reales: no aumenta la cantidad', unicos.length <= links.length);

    const completo = process.argv.includes('--full');
    const muestra = completo ? unicos : unicos.slice(0, 2);
    console.log(`   Descargando ${muestra.length} de ${unicos.length} adjuntos reales${completo ? ' (--full)' : ' (muestra chica, no golpear el servidor de más)'}...`);

    const registro = crearRegistroAdjuntos();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-m3-integracion-'));
    try {
        const { adjuntos, errores } = await descargarAdjuntos(muestra, { tempDir, registro });
        check('descargarAdjuntos (real): sin errores en la muestra', errores.length === 0, JSON.stringify(errores));
        check('descargarAdjuntos (real): cada adjunto descargado es un PDF real (magic bytes %PDF-)',
            adjuntos.every(a => fs.readFileSync(a.localPath).subarray(0, 5).toString() === '%PDF-'));

        const { markdown, paginasSinTexto } = await extraerAdjuntosAMarkdown(adjuntos, registro);
        check('extraerAdjuntosAMarkdown (real): produce encabezados de Anexo numerados',
            /## Anexo 1 —/.test(markdown) && (muestra.length < 2 || /## Anexo 2 —/.test(markdown)));
        console.log(`   ${adjuntos.length} adjuntos reales extraídos · ${markdown.length} chars de Markdown · ${paginasSinTexto.length} páginas sin texto`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    if (completo) {
        console.log('\n▶ Pipeline COMPLETO (procesarAdjuntosDeInforme) contra los ' + links.length + ' links reales...');
        const r = await procesarAdjuntosDeInforme(pdfPath);
        check('procesarAdjuntosDeInforme (--full): procesa todos los adjuntos sin excepción no controlada',
            r.totalAdjuntos === unicos.length, `totalAdjuntos=${r.totalAdjuntos} unicos=${unicos.length}`);
        check('procesarAdjuntosDeInforme (--full): 0 errores contra el servidor real', r.errores.length === 0, JSON.stringify(r.errores));
        console.log(`   ${r.totalAdjuntos} adjuntos · ${r.markdown.length} chars · ${r.paginasSinTexto.length} páginas sin texto`);
    }
}

testDescargaMockeada()
    .then(testIntegracionReal)
    .then(() => {
        console.log(`\n${ok}/${ok + fail} PASS`);
        if (fail > 0) process.exit(1);
    })
    .catch(e => {
        console.error('❌ Error inesperado:', e);
        process.exit(1);
    });
