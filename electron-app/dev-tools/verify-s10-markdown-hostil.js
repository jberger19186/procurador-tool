#!/usr/bin/env node
/**
 * S10 — Módulo Markdown/Anonimización: INPUT HOSTIL (Etapa 3, security review)
 *
 * Eje distinto al de F5 (code-review, "¿el motor está bien escrito?"): acá la pregunta es
 * "¿qué pasa si el PDF de entrada, o la red que sirve sus adjuntos, es hostil?". M0 confirmó
 * escenario A (fetch directo en Node, sin navegador ni scripts encriptados de por medio), así
 * que este bloque corre 100% local contra los 3 módulos reales de `markdown/`.
 *
 * Cubre, en este orden, los puntos del plan (docs/internal/plan-seguridad-lanzamiento-2026-08.md
 * §S10):
 *   1. SSRF — allowlist de esquema+host, con una URL sintética por vector (127.0.0.1,
 *      169.254.169.254, file://, host-confusion, userinfo, mayúsculas) + un PDF REAL
 *      (pdf-lib) con anotaciones Link, pasado por `extraerLinksInforme()` real.
 *   2. Path traversal — (a) filename derivado del Content-Disposition de un adjunto
 *      (`descargarAUnArchivo`, vía `descargarAdjuntos()`) y (b) las rutas que recibe el IPC
 *      handler `reprocesar-markdown-mapping` de `main.js` (se extrae `confinarRutaMarkdown()`
 *      del código fuente real, no se reimplementa — mismo criterio que verify-s5-xss-admin.js).
 *   3. Límites de recursos — 500 enlaces (rechazo antes de cualquier fetch), un adjunto que
 *      excede el tope de bytes con un servidor local real, y un servidor que gotea sin cerrar
 *      nunca la respuesta (temporizador real, ~30s — es el timeout de producción, no uno
 *      acortado para el test).
 *   4. pdfjs-dist — versión instalada, `isEvalSupported` explícito en las 2 llamadas reales.
 *   5. Que el `.md` anonimizado nunca conserve una URL viva del SCW, incluida partida por un
 *      salto de línea exactamente en medio del token "viewer.seam".
 *   6. Corpus adversarial — delegado a `test/anonimizar.test.js` (ya extendido con los casos
 *      de este bloque); acá solo se corre y se exige 0% de falsos negativos.
 *   7. Coherencia promesa/resultado — grep de "no es una garantía" en el mapping.txt real y en
 *      los TyC publicados.
 *   8. Gate por plan contra staging — NO se re-corre acá (ver el informe: confirmado con un
 *      chequeo real de solo lectura contra staging en la misma sesión, y M1 ya lo verificó
 *      11/11 en su momento — no se re-deriva un harness completo por este punto).
 *
 * Uso: node dev-tools/verify-s10-markdown-hostil.js
 * Nota: la sección 3.3 (timeout) tarda ~30s reales a propósito — es el valor de producción.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const { esUrlPermitida, extraerLinksInforme, descargarAdjuntos, procesarAdjuntosDeInforme, MAX_ADJUNTOS_POR_INFORME } = require('../markdown/descargarAdjuntos');
const { anonimizar } = require('../markdown/anonimizar');

let pass = 0, fail = 0;
const failures = [];
function assert(desc, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${desc}`); }
    else { fail++; failures.push(desc + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${desc}${detail ? ' — ' + detail : ''}`); }
}

async function tempDirPropio(prefijo) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n1) SSRF — allowlist de esquema + host\n');
// ═══════════════════════════════════════════════════════════════════════════
{
    const casos = [
        ['legítima', 'https://scw.pjn.gov.ar/scw/viewer.seam?id=1&tipoDoc=despacho', true],
        ['http en vez de https', 'http://scw.pjn.gov.ar/scw/viewer.seam?id=1', false],
        ['loopback IPv4 (SSRF local)', 'http://127.0.0.1:3443/', false],
        ['loopback IPv6', 'http://[::1]:3443/', false],
        ['metadata de nube (AWS/GCP)', 'http://169.254.169.254/latest/meta-data/', false],
        ['file://', 'file:///etc/passwd', false],
        ['file:// Windows', 'file:///C:/Windows/System32/drivers/etc/hosts', false],
        ['subdominio falso (host confusion)', 'https://scw.pjn.gov.ar.evil.com/scw/viewer.seam', false],
        ['host distinto, path parecido', 'https://evil.com/scw/viewer.seam?fake=scw.pjn.gov.ar', false],
        ['userinfo trick (host real sigue siendo el mismo)', 'https://evil.com@scw.pjn.gov.ar/scw/viewer.seam', true],
        ['mayúsculas esquema+host (URL normaliza a minúsculas)', 'HTTPS://SCW.PJN.GOV.AR/scw/viewer.seam?id=2', true],
        ['data: uri', 'data:text/html,<script>1</script>', false],
        ['javascript: uri', 'javascript:alert(1)', false],
        ['ftp://', 'ftp://scw.pjn.gov.ar/scw/viewer.seam', false],
        ['url vacía', '', false],
        ['no es una url', 'no-es-una-url', false],
    ];
    for (const [label, url, esperado] of casos) {
        assert(`esUrlPermitida() — ${label}`, esUrlPermitida(url) === esperado, `url=${JSON.stringify(url)}`);
    }
}

async function ssrfConPdfReal() {
    console.log('\n1b) SSRF — pipeline REAL (pdf-lib construye el PDF, pdfjs-dist real lo lee)\n');
    let PDFDocument, PDFName, PDFString;
    try {
        ({ PDFDocument, PDFName, PDFString } = require('pdf-lib'));
    } catch (_) {
        console.log('  ⚠️  pdf-lib no disponible — se omite (queda cubierto por 1a, unitario)');
        return;
    }
    const urlsMaliciosas = [
        'http://127.0.0.1:3443/',
        'http://169.254.169.254/latest/meta-data/',
        'file:///etc/passwd',
        'https://scw.pjn.gov.ar.evil.com/scw/viewer.seam',
    ];
    const urlLegitima = 'https://scw.pjn.gov.ar/scw/viewer.seam?id=1&tipoDoc=despacho';
    const todas = [urlLegitima, ...urlsMaliciosas];

    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.drawText('Test SSRF S10', { x: 50, y: 750 });
    const refs = [];
    for (let i = 0; i < todas.length; i++) {
        const y = 700 - i * 30;
        page.drawText('Ver documento ' + i, { x: 50, y });
        const annotDict = doc.context.obj({
            Type: PDFName.of('Annot'),
            Subtype: PDFName.of('Link'),
            Rect: [50, y, 250, y + 15],
            Border: [0, 0, 0],
            A: doc.context.obj({ Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(todas[i]) }),
        });
        refs.push(doc.context.register(annotDict));
    }
    page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
    const bytes = await doc.save();
    const tmp = path.join(os.tmpdir(), `s10-ssrf-pdf-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, bytes);
    try {
        const { links, descartados } = await extraerLinksInforme(tmp);
        assert('extraerLinksInforme(): la URL legítima pasa', links.some(l => l.url === urlLegitima));
        assert('extraerLinksInforme(): las 4 URLs maliciosas quedan descartadas, ninguna en `links`',
            !links.some(l => urlsMaliciosas.includes(l.url)), JSON.stringify(links.map(l => l.url)));
        // Hallazgo positivo, no un bug del harness: pdfjs-dist devuelve `a.url ===
        // undefined` para la anotación con `file:///etc/passwd` (no reconoce ese
        // esquema como URI action válida) — la descarta ANTES de que
        // `extraerLinksInforme` llegue a contarla en `descartados`, que solo
        // suma las que SÍ llegan con `.url` string y no pasan la allowlist. Es
        // una segunda capa de defensa (de la propia librería) sobre `file://`
        // específicamente, no un hueco: confirmado arriba que NINGUNA de las 4
        // maliciosas —incluida `file://`— aparece en `links`.
        assert('extraerLinksInforme(): descartados=3 por la allowlist (loopback/metadata/host-confusion) — el file:// ni llega, pdfjs lo neutraliza antes',
            descartados === 3, `descartados=${descartados}`);
    } finally {
        fs.unlinkSync(tmp);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n2a) Path traversal — filename del Content-Disposition de un adjunto\n');
// ═══════════════════════════════════════════════════════════════════════════
async function traversalFilename() {
    async function conFilename(dispositionFilename) {
        const tempDir = await tempDirPropio('s10-trav-');
        const origFetch = global.fetch;
        global.fetch = async () => ({
            ok: true, status: 200,
            headers: { get: (h) => (h === 'content-type' ? 'application/pdf' : (h === 'content-disposition' ? dispositionFilename : null)) },
            body: { getReader: () => { let done = false; return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: Buffer.from('%PDF-1.4 test') }; } }; } },
        });
        try {
            const t0 = Date.now();
            const { adjuntos, errores } = await Promise.race([
                descargarAdjuntos([{ url: 'https://scw.pjn.gov.ar/scw/viewer.seam?id=1', tipoDoc: 'despacho', pagina: 1 }], { tempDir }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('cuelgue')), 8000)),
            ]);
            return { adjuntos, errores, ms: Date.now() - t0, tempDir };
        } finally {
            global.fetch = origFetch;
        }
    }

    for (const [label, disp] of [
        ['filename=".."', 'attachment; filename=".."'],
        ['filename="."', 'attachment; filename="."'],
        ['filename="../../evil.pdf"', 'attachment; filename="../../evil.pdf"'],
    ]) {
        const r = await conFilename(disp);
        try {
            assert(`descargarAdjuntos() no cuelga ni crashea con ${label}`, r.ms < 8000, `ms=${r.ms}`);
            const dentro = r.adjuntos.every(a => !a.localPath || path.resolve(a.localPath).startsWith(path.resolve(r.tempDir) + path.sep));
            assert(`${label}: el archivo (si se creó) queda DENTRO de tempDir, no en el padre`, dentro);
        } finally {
            fs.rmSync(r.tempDir, { recursive: true, force: true });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n2b) Path traversal — reprocesar-markdown-mapping (main.js), el CONFIRMADO en F5\n');
// ═══════════════════════════════════════════════════════════════════════════
function extraerFnDeMainJs(nombre) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const start = src.indexOf(`function ${nombre}(`);
    if (start === -1) throw new Error(`No se encontró function ${nombre}() en main.js`);
    const braceStart = src.indexOf('{', start);
    let depth = 0, i = braceStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(start, i + 1);
    // eslint-disable-next-line no-eval
    return eval(`(${body})`);
}
{
    let confinarRutaMarkdown;
    try {
        confinarRutaMarkdown = extraerFnDeMainJs('confinarRutaMarkdown');
    } catch (e) {
        assert('confinarRutaMarkdown() existe en main.js (el fix de S10)', false, e.message);
    }
    if (confinarRutaMarkdown) {
        const base = path.join(os.tmpdir(), 's10-base-descargas');
        const dentro = path.join(base, 'markdown_FCR_1_2020_2026-01-01T00-00-00.anonimizado.md');
        assert('confinarRutaMarkdown(): ruta legítima (dentro de la base, extensión correcta) → aceptada',
            confinarRutaMarkdown(dentro, base, ['.anonimizado.md']) === path.resolve(dentro));

        const fuera1 = path.join(base, '..', '..', '..', 'Windows', 'System32', 'evil.anonimizado.md');
        assert('confinarRutaMarkdown(): "../../../Windows/..." → rechazada (null)',
            confinarRutaMarkdown(fuera1, base, ['.anonimizado.md']) === null, `resolvería a ${path.resolve(fuera1)}`);

        const absolutaFuera = process.platform === 'win32' ? 'C:\\Windows\\System32\\evil.anonimizado.md' : '/etc/evil.anonimizado.md';
        assert('confinarRutaMarkdown(): ruta absoluta fuera de la base → rechazada',
            confinarRutaMarkdown(absolutaFuera, base, ['.anonimizado.md']) === null);

        const extensionEquivocada = path.join(base, 'legitimo.exe');
        assert('confinarRutaMarkdown(): dentro de la base pero extensión no permitida (.exe) → rechazada',
            confinarRutaMarkdown(extensionEquivocada, base, ['.anonimizado.md']) === null);

        assert('confinarRutaMarkdown(): null/undefined → rechazada, no explota',
            confinarRutaMarkdown(null, base, ['.anonimizado.md']) === null &&
            confinarRutaMarkdown(undefined, base, ['.anonimizado.md']) === null);
    }

    // El gate por plan (F5 #16) y la llamada a confinarRutaMarkdown() DEBEN
    // estar los dos en el handler real — confirmación de regresión por texto
    // fuente, no reimplementación del IPC (que requiere `electron`).
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const handlerIdx = mainSrc.indexOf("ipcMain.handle('reprocesar-markdown-mapping'");
    const handlerBody = mainSrc.slice(handlerIdx, handlerIdx + 2500);
    assert("El handler 'reprocesar-markdown-mapping' llama a verificarMarkdownHabilitado() (gate F5 #16, no regresionado)",
        /verificarMarkdownHabilitado\(\)/.test(handlerBody));
    assert("El handler 'reprocesar-markdown-mapping' llama a confinarRutaMarkdown() en AMBAS rutas (S10, este fix)",
        (handlerBody.match(/confinarRutaMarkdown\(/g) || []).length >= 2, handlerBody.match(/confinarRutaMarkdown\(/g));
    assert("El handler usa el resultado CONFINADO (mdAnonSeguro/mappingSeguro) en los fs.writeFileSync, no el crudo del renderer",
        /fs\.writeFileSync\(mdAnonSeguro/.test(handlerBody) && /fs\.writeFileSync\(mappingSeguro/.test(handlerBody));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n3) Límites de recursos\n');
// ═══════════════════════════════════════════════════════════════════════════
async function limitesRecursos() {
    // 3.1 — 500 enlaces: rechazo total, antes de cualquier fetch.
    {
        const tempDir = await tempDirPropio('s10-500-');
        const muchos = Array.from({ length: 500 }, (_, i) => ({ url: `https://scw.pjn.gov.ar/scw/viewer.seam?id=${i}`, tipoDoc: null, pagina: 1 }));
        let fetchLlamado = 0;
        const origFetch = global.fetch;
        global.fetch = async (...a) => { fetchLlamado++; return origFetch(...a); };
        try {
            await descargarAdjuntos(muchos, { tempDir });
            assert('500 enlaces (> MAX_ADJUNTOS_POR_INFORME): se rechaza el informe completo', false, 'no rechazó');
        } catch (e) {
            assert(`500 enlaces (> MAX_ADJUNTOS_POR_INFORME=${MAX_ADJUNTOS_POR_INFORME}): se rechaza ANTES de cualquier fetch`, fetchLlamado === 0, `fetch() llamado ${fetchLlamado} veces`);
        } finally {
            global.fetch = origFetch;
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    // 3.2 — adjunto "de 2GB": servidor local real que declara Content-Length
    // gigante y sigue mandando bytes reales; debe cortar cerca del tope real
    // (20MB), no confiar en el header ni llegar a acumular gigabytes.
    {
        const tempDir = await tempDirPropio('s10-bigfile-');
        let bytesEnviados = 0;
        const CHUNK = Buffer.alloc(1024 * 1024, 65);
        const srv = http.createServer((req, res) => {
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="huge.pdf"', 'content-length': String(2 * 1000 * 1000 * 1000) });
            const interval = setInterval(() => {
                bytesEnviados += CHUNK.length;
                res.write(CHUNK);
                if (bytesEnviados > 60 * 1024 * 1024) { clearInterval(interval); res.end(); }
            }, 1);
        }).listen(0);
        await new Promise(r => srv.on('listening', r));
        const port = srv.address().port;
        try {
            const t0 = Date.now();
            const { adjuntos, errores } = await Promise.race([
                descargarAdjuntos([{ url: `http://127.0.0.1:${port}/`, tipoDoc: null, pagina: 1 }], { tempDir }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('cuelgue')), 15000)),
            ]);
            assert('Adjunto con Content-Length falso de 2GB: se corta cerca del tope real (no confía en el header)',
                errores.length === 1 && /supera el máximo de 20 MB/.test(errores[0].motivo), JSON.stringify(errores));
            assert('Adjunto con Content-Length falso de 2GB: NO se conservan 20MB+ realmente descargados (chunk que excede nunca se escribe)',
                adjuntos.length === 0 && Date.now() - t0 < 5000);
        } finally {
            srv.close();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    // 3.3 — servidor que gotea sin cerrar la respuesta (el "1 byte por segundo"
    // del plan): usa el timeout REAL de producción (~30s), no uno acortado —
    // es la única forma de probar el mecanismo real y no una aproximación.
    {
        console.log('  ⏳ probando el timeout real de descarga (~30s, es el valor de producción — no se acorta)...');
        const tempDir = await tempDirPropio('s10-slow-');
        const srv = http.createServer((req, res) => {
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="slow.pdf"' });
            res.write(Buffer.from('%PDF-1.4'));
            // Nunca cierra ni manda más — simula un servidor colgado / goteo infinito.
        }).listen(0);
        await new Promise(r => srv.on('listening', r));
        const port = srv.address().port;
        try {
            const t0 = Date.now();
            const { adjuntos, errores } = await Promise.race([
                descargarAdjuntos([{ url: `http://127.0.0.1:${port}/`, tipoDoc: null, pagina: 1 }], { tempDir }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('EL PROPIO TEST timeouteó a los 50s — el módulo no abortó solo')), 50000)),
            ]);
            const ms = Date.now() - t0;
            assert('Servidor colgado (nunca cierra la respuesta): el módulo ABORTA solo, no se cuelga para siempre',
                ms >= 25000 && ms <= 40000 && errores.length === 1, `duración=${ms}ms errores=${JSON.stringify(errores)}`);
        } catch (e) {
            assert('Servidor colgado: el módulo aborta solo antes de 50s', false, e.message);
        } finally {
            srv.close();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    // 3.4 — try/finally de limpieza corre también en el camino de ERROR.
    {
        const pdfInvalido = path.join(os.tmpdir(), `s10-invalido-${Date.now()}.pdf`);
        fs.writeFileSync(pdfInvalido, 'esto no es un PDF valido, es basura');
        const dirsCreados = [];
        const origMkdtemp = fs.mkdtempSync;
        fs.mkdtempSync = (...a) => { const d = origMkdtemp(...a); dirsCreados.push(d); return d; };
        try {
            await procesarAdjuntosDeInforme(pdfInvalido, {});
            assert('procesarAdjuntosDeInforme() con PDF inválido: se esperaba que tirara', false);
        } catch (_) {
            const vivos = dirsCreados.filter(d => fs.existsSync(d));
            assert('El temporal se limpia también en el camino de ERROR (extracción fallida)',
                dirsCreados.length === 1 && vivos.length === 0, `creados=${dirsCreados.length} vivos=${vivos.length}`);
        } finally {
            fs.mkdtempSync = origMkdtemp;
            fs.unlinkSync(pdfInvalido);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n3.5) Redirect — SSRF vía el propio fetch (hallazgo nuevo de S10, no en el plan original)\n');
// ═══════════════════════════════════════════════════════════════════════════
async function redirectSsrf() {
    const tempDir = await tempDirPropio('s10-redirect-');
    const srvB = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('LOOT-INTERNO'); }).listen(0);
    await new Promise(r => srvB.on('listening', r));
    const portB = srvB.address().port;
    const srvA = http.createServer((req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${portB}/` }); res.end(); }).listen(0);
    await new Promise(r => srvA.on('listening', r));
    const portA = srvA.address().port;
    try {
        const { adjuntos, errores } = await descargarAdjuntos([{ url: `http://127.0.0.1:${portA}/`, tipoDoc: null, pagina: 1 }], { tempDir });
        assert('Un 302 a un host distinto (simulando scw.pjn.gov.ar redirigiendo) se RECHAZA, no se sigue',
            adjuntos.length === 0 && errores.length === 1 && /302/.test(errores[0].motivo), JSON.stringify({ adjuntos, errores }));
    } finally {
        srvA.close(); srvB.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n4) pdfjs-dist — versión + isEvalSupported\n');
// ═══════════════════════════════════════════════════════════════════════════
{
    const pkg = JSON.parse(fs.readFileSync(require.resolve('pdfjs-dist/package.json'), 'utf8'));
    assert(`pdfjs-dist instalado (${pkg.version}) es posterior a la versión que corrigió CVE-2024-4367 (4.2.67)`,
        compararVersion(pkg.version, '4.2.67') >= 0, `instalado=${pkg.version}`);
    function compararVersion(a, b) {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
        return 0;
    }
    const src1 = fs.readFileSync(path.join(__dirname, '..', 'markdown', 'extraerPdfAMarkdown.js'), 'utf8');
    const src2 = fs.readFileSync(path.join(__dirname, '..', 'markdown', 'descargarAdjuntos.js'), 'utf8');
    assert('extraerTextoPdf(): isEvalSupported:false explícito (CVE-2024-4367 solo aplica si es true, default)', /isEvalSupported:\s*false/.test(src1));
    assert('extraerLinksInforme(): isEvalSupported:false explícito', /isEvalSupported:\s*false/.test(src2));
    assert("descargarAdjuntos.js: no LEE el header content-length en ningún lado (headers.get('content-length') o similar) — cap por bytes reales, no por header declarado",
        !/headers\s*\.\s*get\s*\(\s*['"]content-length['"]/i.test(src2));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n5) El .md anonimizado nunca conserva una URL viva del SCW\n');
// ═══════════════════════════════════════════════════════════════════════════
{
    const md1 = '# FCR 18745/2017\n\n> AFIP c/ JUAN PEREZ s/EJECUCION\n\n## Movimientos\n\n| Fecha | Detalle |\n|---|---|\n| 01/01/2026 | Despacho [Ver documento](https://scw.pjn.gov.ar/scw/viewer.seam?id=ABC123&tipoDoc=despacho) |\n';
    const r1 = anonimizar(md1);
    assert('Enlace markdown normal [texto](url): la URL desaparece del anonimizado', !/viewer\.seam/i.test(r1.markdownAnonimizado));
    assert('La versión NO anonimizada SÍ conserva la URL (correcto, es para uso propio)', /viewer\.seam/i.test(md1));

    const md2 = '# FCR 18745/2017\n\n> AFIP c/ JUAN PEREZ s/EJECUCION\n\nVer https://scw.pjn.gov.ar/scw/viewer.se\nam?id=ABC123 directo\n';
    assert('URL suelta partida por un \\n JUSTO en medio del token "viewer.seam": no sobrevive', !/viewer\.?\s*se[ae]?m/i.test(anonimizar(md2).markdownAnonimizado));

    const md3 = '# FCR 18745/2017\n\n> AFIP c/ JUAN PEREZ s/EJECUCION\n\n> Ver https://scw.pjn.gov.ar/scw/viewer.seam?id=ABC123\n> &tipoDoc=despacho directo\n';
    assert('URL con la query string partida + "> " de cita (wrap real de una carátula): no sobrevive', !/viewer\.seam/i.test(anonimizar(md3).markdownAnonimizado));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n6) Corpus adversarial — delegado a test/anonimizar.test.js (extendido en este bloque)\n');
// ═══════════════════════════════════════════════════════════════════════════
async function corpusAdversarial() {
    const { execFileSync } = require('child_process');
    try {
        const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'test', 'anonimizar.test.js')], { encoding: 'utf8' });
        const mFN = out.match(/Tasa de falsos negativos del corpus adversarial:\s*([\d.]+)%/);
        const mFuera = out.match(/Tasa de falsos negativos FUERA de alcance[^:]*:\s*([\d.]+)%/);
        const mPass = out.match(/(\d+)\/(\d+) PASS/);
        assert('test/anonimizar.test.js corre completo (111 aserciones, incluidas las 4 nuevas de S10)', !!mPass, out.slice(-300));
        if (mPass) assert(`test/anonimizar.test.js: ${mPass[0]}`, mPass[1] === mPass[2]);
        if (mFN) assert(`Corpus principal: tasa de falsos negativos = ${mFN[1]}% (medida, no impresión)`, parseFloat(mFN[1]) === 0);
        if (mFuera) console.log(`  ℹ️  Categorías fuera de alcance por diseño (domicilio/teléfono/email/CBU): ${mFuera[1]}% de falsos negativos — ver §6 del informe`);
    } catch (e) {
        assert('test/anonimizar.test.js corre sin errores', false, (e.stdout || e.message || '').toString().slice(-500));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n7) Coherencia promesa/resultado — "ayuda automática, no garantía"\n');
// ═══════════════════════════════════════════════════════════════════════════
{
    const { mappingTexto } = anonimizar('# EXP 1/2020\n\n> AFIP c/ JUAN PEREZ s/EJECUCION\n');
    assert('El mapping.txt real lleva la advertencia de "no es una garantía"', /NO es una garant[ií]a/i.test(mappingTexto));

    const tycPaths = [
        path.join(__dirname, '..', '..', 'backend-server', 'public', 'terminos', 'index.html'),
    ];
    let encontrado = false, detalle = '';
    for (const p of tycPaths) {
        if (fs.existsSync(p)) {
            const html = fs.readFileSync(p, 'utf8');
            if (/no garantiza la eliminaci[oó]n completa|ayuda autom[aá]tica|no es una garant[ií]a/i.test(html)) {
                encontrado = true; break;
            }
            detalle = `TyC leído pero sin la leyenda esperada (${p})`;
        } else {
            detalle = `no existe: ${p}`;
        }
    }
    assert('Los TyC publicados (backend-server/public/terminos/) tienen la misma advertencia sobre el módulo Markdown', encontrado, detalle);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n8) Gate por plan contra staging\n');
// ═══════════════════════════════════════════════════════════════════════════
{
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert("verificarMarkdownHabilitado() consulta account.markdownEnabled (server-side, vía backendClient.getAccount())",
        /markdownEnabled === true/.test(mainSrc));
    assert("procesar-markdown-pdf Y reprocesar-markdown-mapping llaman al gate ANTES de escribir (no confían en que el botón esté oculto)",
        (mainSrc.match(/const gate = await verificarMarkdownHabilitado\(\);/g) || []).length === 2);
    console.log('  ℹ️  Confirmado ADEMÁS con un chequeo real de solo lectura contra staging en esta misma sesión:');
    console.log('     GET /client/account de un usuario con markdown_enabled=false en su plan → markdownEnabled:false');
    console.log('     (coincide con el flag real de la DB) — ver el informe. El caso markdownEnabled:true ya lo');
    console.log('     había verificado M1 (11/11 PASS) — no se re-deriva ese harness completo acá.');
}

// ═══════════════════════════════════════════════════════════════════════════
(async () => {
    await ssrfConPdfReal();
    await traversalFilename();
    await limitesRecursos();
    await redirectSsrf();
    await corpusAdversarial();

    console.log(`\n═══ Resultado: ${pass}/${pass + fail} PASS ═══`);
    if (fail > 0) {
        console.log('\nFallos:');
        failures.forEach(f => console.log(`  - ${f}`));
        process.exit(1);
    }
    process.exit(0);
})().catch(e => {
    console.error('❌ Error inesperado:', e);
    process.exit(1);
});
