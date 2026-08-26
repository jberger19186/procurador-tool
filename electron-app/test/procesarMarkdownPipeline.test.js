/**
 * Verifica el pipeline COMBINADO que orquesta el handler `procesar-markdown-pdf`
 * de main.js (bloque M5) — M2 (informe) + M3 (adjuntos) + M4 (anonimización) +
 * escritura de los 3 archivos con el mismo "stem". Ninguno de los tests de
 * M2/M3/M4 por separado ejercita esta combinación exacta.
 *
 *   node electron-app/test/procesarMarkdownPipeline.test.js
 *
 * No depende de Electron (no hay `ipcMain`/`BrowserWindow` acá) — reproduce
 * la MISMA secuencia de llamadas que main.js hace dentro del handler, para
 * poder correrla sin el runtime completo de la app.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { extraerTextoPdf, renderizarInformeMarkdown, derivarNombreSalida } = require('../markdown/extraerPdfAMarkdown');
const { procesarAdjuntosDeInforme } = require('../markdown/descargarAdjuntos');
const { anonimizar } = require('../markdown/anonimizar');

let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`✅ ${nombre}`); }
    else { fail++; console.log(`❌ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

/** Replica exacta de la orquestación de main.js (sin IPC, sin webContents.send). */
async function procesarComoMainJs(pdfPath, outputDir, { conAdjuntos = true } = {}) {
    const { paginas } = await extraerTextoPdf(pdfPath);
    const { markdown: markdownInforme, paginasSinTexto: paginasSinTextoInforme } = renderizarInformeMarkdown(paginas);

    let markdownAnexos = '';
    let resumenAdjuntos = { totalAdjuntos: 0, descartadosPorAllowlist: 0, errores: [], paginasSinTexto: [] };
    if (conAdjuntos) {
        try {
            resumenAdjuntos = await procesarAdjuntosDeInforme(pdfPath, {});
            markdownAnexos = resumenAdjuntos.markdown || '';
        } catch (_) { /* mismo criterio que main.js: no aborta */ }
    }

    const markdownCompleto = markdownAnexos
        ? `${markdownInforme}\n\n---\n\n${markdownAnexos}\n`
        : markdownInforme;

    const { markdownAnonimizado, mappingTexto, entradas } = anonimizar(markdownCompleto);

    fs.mkdirSync(outputDir, { recursive: true });
    const stem = derivarNombreSalida(pdfPath).replace(/\.md$/, '');
    const mdPath = path.join(outputDir, `${stem}.md`);
    const mdAnonimizadoPath = path.join(outputDir, `${stem}.anonimizado.md`);
    const mappingPath = path.join(outputDir, `${stem}.mapping.txt`);

    fs.writeFileSync(mdPath, markdownCompleto, 'utf8');
    fs.writeFileSync(mdAnonimizadoPath, markdownAnonimizado, 'utf8');
    fs.writeFileSync(mappingPath, mappingTexto, 'utf8');

    return {
        mdPath, mdAnonimizadoPath, mappingPath, markdownCompleto, mappingTexto,
        resumen: {
            paginasSinTexto: paginasSinTextoInforme.length + (resumenAdjuntos.paginasSinTexto?.length || 0),
            totalAdjuntos: resumenAdjuntos.totalAdjuntos,
            erroresAdjuntos: resumenAdjuntos.errores?.length || 0,
            entidadesDetectadas: entradas.length,
        },
    };
}

function buscarInformeReal() {
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

async function main() {
    const pdfPath = buscarInformeReal();
    if (!pdfPath) {
        console.log('⚠️  Sin PDF real disponible — se omite el test del pipeline combinado.');
        return;
    }
    console.log(`▶ Pipeline combinado (M2+M3+M4) contra: ${pdfPath}\n`);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pipeline-md-'));
    try {
        // ── 1. Corrida completa, con adjuntos ──
        const r = await procesarComoMainJs(pdfPath, outDir);

        check('Los 3 archivos existen en disco', [r.mdPath, r.mdAnonimizadoPath, r.mappingPath].every(fs.existsSync));

        const nombreCompleto = path.basename(r.mdPath);
        const nombreAnon = path.basename(r.mdAnonimizadoPath);
        const nombreMapping = path.basename(r.mappingPath);
        check('Los 3 archivos comparten el mismo "stem" (quedan agrupados en la carpeta)',
            nombreAnon.startsWith(nombreCompleto.replace(/\.md$/, '')) &&
            nombreMapping.startsWith(nombreCompleto.replace(/\.md$/, '')),
            `${nombreCompleto} / ${nombreAnon} / ${nombreMapping}`);
        check('El nombre completo NO incluye ya ".anonimizado" (evita doble sufijo)',
            !nombreCompleto.includes('.anonimizado'));

        const completo = fs.readFileSync(r.mdPath, 'utf8');
        const anonimizado = fs.readFileSync(r.mdAnonimizadoPath, 'utf8');
        const mapping = fs.readFileSync(r.mappingPath, 'utf8');

        check('El .md completo tiene el informe (título + Movimientos)',
            /^# /m.test(completo) && completo.includes('## Movimientos'));
        check('El .md completo NO está anonimizado (las entidades reales siguen ahí)',
            completo !== anonimizado);
        check('El .md anonimizado NO contiene URLs de viewer.seam (Regla 4, defensa en profundidad)',
            !/viewer\.seam/i.test(anonimizado));
        check('El mapping.txt tiene la advertencia de "no es una garantía"',
            /NO es una garant[ií]a/i.test(mapping));

        if (r.resumen.totalAdjuntos > 0) {
            check('Con adjuntos reales: el .md completo es MÁS LARGO que el informe solo (los anexos se concatenaron)',
                completo.length > completo.replace(/[\s\S]*?---\n\n/, '').length || completo.includes('## Anexo 1'),
                `totalAdjuntos=${r.resumen.totalAdjuntos}`);
        }
        console.log(`   resumen: ${JSON.stringify(r.resumen)}`);

        // ── 2. Reprocesar el mapping — mismo criterio que reprocesar-markdown-mapping ──
        // Se edita el mapping.txt (se borra la línea del actor, si existe, simulando
        // lo que sugiere el propio encabezado del archivo) y se vuelve a aplicar
        // SOBRE EL ORIGINAL guardado (r.markdownCompleto), nunca sobre el anonimizado.
        const mappingSinComentarios = r.mappingTexto.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
        const { markdownAnonimizado: anon2, mappingTexto: mapping2 } = anonimizar(r.markdownCompleto, mappingSinComentarios);
        fs.writeFileSync(r.mdAnonimizadoPath, anon2, 'utf8');
        fs.writeFileSync(r.mappingPath, mapping2, 'utf8');

        check('Reprocesar con el mapping tal cual (sin comentarios) da el MISMO anonimizado (idempotente)',
            anon2 === anonimizado, 'el resultado cambió al reprocesar sin haber editado ninguna línea real');

        // ── 3. Sin adjuntos (informe de 1 sola página, sin links) — no debe romper nada ──
        const outDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pipeline-md-sin-adj-'));
        try {
            const r2 = await procesarComoMainJs(pdfPath, outDir2, { conAdjuntos: false });
            check('Sin adjuntos: el pipeline igual produce los 3 archivos', [r2.mdPath, r2.mdAnonimizadoPath, r2.mappingPath].every(fs.existsSync));
            check('Sin adjuntos: el .md completo NO tiene el separador "---" de anexos',
                !fs.readFileSync(r2.mdPath, 'utf8').includes('\n---\n'));
        } finally {
            fs.rmSync(outDir2, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
    }

    console.log(`\n${ok}/${ok + fail} PASS`);
    if (fail > 0) process.exit(1);
}

main().catch(e => { console.error('❌ Error inesperado:', e); process.exit(1); });
