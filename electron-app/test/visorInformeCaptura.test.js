/**
 * Verifica la cadena del lado Electron: movimientos leidos del backup ->
 * generador_visor.js -> DATOS_BATCH -> payload que el visor postea a /usuarios/capture.
 *
 *   node electron-app/test/visorInformeCaptura.test.js
 *
 * Corre las funciones REALES (`leerMovimientosInforme` y `generarVisorHTML`) y
 * despues extrae `campoDeCaso` del HTML generado y la evalua, para no reimplementar
 * lo que hay que probar. Los movimientos salen del `listaMovimientos.json` real de
 * esta maquina cuando esta disponible; si no, de uno sintetico (y el resumen lo dice).
 *
 * NO-REGRESION: el caso 5 confirma que un expediente FALLIDO sigue mandando
 * `movs: '[]'` -- que es el comportamiento correcto, no el bug.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { leerMovimientosInforme } = require('../informe/movimientosInforme');
const { generarVisorHTML } = require('../informe/generador_visor');

let ok = 0, fail = 0;
function check(nombre, fn) {
    try { fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}

/** Extrae DATOS_BATCH del HTML generado, contando llaves (tolera anidamiento). */
function leerDatosBatch(html) {
    const i = html.indexOf('const DATOS_BATCH =');
    assert.ok(i > -1, 'el visor no define DATOS_BATCH');
    let d = 0, s = html.indexOf('{', i), j = s, enStr = null;
    for (; j < html.length; j++) {
        const c = html[j];
        if (enStr) { if (c === '\\') j++; else if (c === enStr) enStr = null; continue; }
        if (c === '"' || c === "'") { enStr = c; continue; }
        if (c === '{') d++;
        else if (c === '}') { d--; if (!d) break; }
    }
    return JSON.parse(html.slice(s, j + 1));
}

/** Evalua la `campoDeCaso` REAL del visor generado, sin reescribirla. */
function campoDeCasoDelVisor(html, DATOS_BATCH) {
    const m = html.match(/function nombrePdfDe\(exp\)[\s\S]*?\n  \}/);
    const c = html.match(/function campoDeCaso\(exp\)[\s\S]*?\n  \}/);
    assert.ok(m, 'no se encontro nombrePdfDe() en el visor');
    assert.ok(c, 'no se encontro campoDeCaso() en el visor');
    // eslint-disable-next-line no-new-func
    return new Function('DATOS_BATCH', m[0] + '\n' + c[0] + '\nreturn campoDeCaso;')(DATOS_BATCH);
}

const REAL = path.join(os.homedir(), 'AppData', 'Roaming', 'procurador-electron',
    'usuarios', '27320694359', 'descargas');

async function main() {
    console.log('\nvisor de informe -- cadena movimientos -> DATOS_BATCH -> payload de captura\n');

    let movimientos = leerMovimientosInforme(REAL, 'fcr 18745/2017');
    const fuente = movimientos.length ? 'corrida REAL de esta maquina' : 'sinteticos (no habia corrida real)';
    if (!movimientos.length) {
        movimientos = [
            { fecha: '26/11/2025', tipo: 'INFORMACION', detalle: 'Agregado al Paquete Nro. 2647202526' },
            { fecha: '20/11/2025', tipo: 'MOVIMIENTO', detalle: 'PARA ARCHIVAR' }
        ];
    }
    console.log('   movimientos de entrada: ' + movimientos.length + ' (' + fuente + ')\n');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'visorinf-'));
    try {
        // Un PDF de mentira con el nombre que buscaria `buscarPdfExpediente`, para que
        // `rutaPDF` se resuelva de verdad (parte D: la referencia al PDF en el snapshot).
        fs.writeFileSync(path.join(tmp, 'informe_FCR 018745_2017_2026-09-04T15-02-56.pdf'), '%PDF-1.4\n');

        const resumen = [
            { expediente: 'FCR 018745/2017', ok: true, exitCode: 0, caratula: 'AFIP c/ PRUEBA s/EJECUCION', movimientos },
            { expediente: 'CNT 999/2024', ok: false, exitCode: 1, motivo: 'Expediente inexistente', movimientos: [] }
        ];
        const resumenPath = path.join(tmp, 'resumen.json');
        fs.writeFileSync(resumenPath, JSON.stringify(resumen), 'utf8');

        const bitacoraInfo = { enabled: true, seguidos: [], ssoToken: 'TOKEN_DE_PRUEBA' };
        const rutaHTML = await generarVisorHTML(resumenPath, { rutas: { descargas: tmp } }, null, bitacoraInfo);

        const html = fs.readFileSync(rutaHTML, 'utf8');
        const DB = leerDatosBatch(html);
        const campoDeCaso = campoDeCasoDelVisor(html, DB);

        check('1 . el generador ya NO descarta los movimientos', () => {
            assert.strictEqual(DB.expedientes[0].movimientos.length, movimientos.length);
            assert.strictEqual(DB.expedientes[0].movimientos[0].detalle, movimientos[0].detalle);
        });

        check('2 . el payload de captura lleva los movimientos (antes iba fijo en "[]")', () => {
            const c = campoDeCaso(DB.expedientes[0]);
            assert.notStrictEqual(c.movs, '[]', 'movs sigue vacio: el bug no se corrigio');
            const parsed = JSON.parse(c.movs);
            assert.strictEqual(parsed.length, movimientos.length);
            assert.strictEqual(parsed[0].detalle, movimientos[0].detalle);
        });

        check('3 . [parte D] lleva el nombre del PDF de esa corrida, decodificado', () => {
            const c = campoDeCaso(DB.expedientes[0]);
            assert.strictEqual(c.pdf, 'informe_FCR 018745_2017_2026-09-04T15-02-56.pdf');
        });

        check('4 . la caratula (B4) no se rompio', () => {
            assert.strictEqual(campoDeCaso(DB.expedientes[0]).car, 'AFIP c/ PRUEBA s/EJECUCION');
        });

        check('5 . [no-regresion] un expediente FALLIDO sigue mandando movs "[]" y sin PDF', () => {
            const c = campoDeCaso(DB.expedientes[1]);
            assert.strictEqual(c.movs, '[]');
            assert.strictEqual(c.pdf, '');
        });

        check('6 . el HTML generado tiene un solo cierre de <script> (regresion E9)', () => {
            assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
        });

        check('7 . el informe no pasa a ser el caso mas pesado del borrador', () => {
            // `captureDrafts.js` rechaza ENTERO un borrador > 256 KB, asi que agregarle
            // movimientos al informe podia romper una captura que hoy funciona. Medido
            // sobre la forma que el borrador REALMENTE guarda (`normalizarCaso`, o sea
            // solo fecha/tipo/detalle) y con datos reales de esta maquina:
            //     informe con tope 15 ... 1.584 B/caso  -> 165 casos hasta el tope
            //     procuracion (ya en produccion) 1.820 B/caso -> 144 casos
            // O sea que el informe queda POR DEBAJO de lo que el producto ya acepta: el
            // limite lo sigue marcando procuracion, no este cambio. El bar del test es
            // ese: si un caso de informe superara el promedio real de procuracion,
            // habria que bajar el tope de movimientos.
            const BASELINE_PROCURACION_BYTES = 1820;
            const c = campoDeCaso(DB.expedientes[0]);
            const norm = {                      // misma forma que normalizarCaso()
                expediente: c.exp, jurisdiccion: c.jur, dependencia: c.dep, caratula: c.car,
                situacion_actual: c.sit, fecha_corrida: c.fproc, pdf: c.pdf,
                movimientos: JSON.parse(c.movs).map(m => ({ fecha: m.fecha, tipo: m.tipo, detalle: m.detalle }))
            };
            const bytes = Buffer.byteLength(JSON.stringify(norm), 'utf8');
            assert.ok(
                bytes <= BASELINE_PROCURACION_BYTES,
                'un caso de informe pesa ' + bytes + ' B, mas que el promedio real de ' +
                'procuracion (' + BASELINE_PROCURACION_BYTES + ' B): bajar MAX_MOVS_DEFAULT'
            );
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    console.log('\n' + ok + ' PASS, ' + fail + ' FAIL');
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERROR: ' + e.stack); process.exit(1); });
