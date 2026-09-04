/**
 * Verifica la cadena del lado Electron: movimientos+secciones leidos del backup ->
 * generador_visor.js -> DATOS_BATCH -> payload que el visor postea a /usuarios/capture,
 * incluido el umbral de tamaño (2026-09-04) que decide si el lote lleva las 5
 * secciones extra del informe.
 *
 *   node electron-app/test/visorInformeCaptura.test.js
 *
 * Corre las funciones REALES (`leerSeccionesInforme`, `generarVisorHTML`,
 * `campoDeCaso`, `accionLote`) y despues extrae del HTML generado las que
 * corren en el navegador, para no reimplementar lo que hay que probar.
 * `accionLote` se corre con `seleccionados`/`enviarCaptura`/
 * `marcarLoteComoGuardado` STUBEADOS (no hace falta jsdom: la función solo los
 * usa como valores, nunca toca `document`) — es la MISMA función del visor,
 * con un mock alrededor, no una reescrita.
 *
 * NO-REGRESION: el caso 5 confirma que un expediente FALLIDO sigue mandando
 * `movs: '[]'` -- que es el comportamiento correcto, no el bug.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { leerSeccionesInforme } = require('../informe/movimientosInforme');
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

/**
 * Extrae `var NOMBRE = ...;` o `function nombre(...) { ... }` del visor
 * generado, tal cual salió del template real. El cierre de función es
 * `\n  }` (2 espacios) porque así indenta ESTE archivo su `<script>` — mismo
 * criterio ya usado acá antes de esta extensión.
 */
function extraerBloque(html, nombre, tipo) {
    const patron = tipo === 'var'
        ? new RegExp('var\\s+' + nombre + '\\s*=[^;]*;')
        : new RegExp('function\\s+' + nombre + '\\s*\\([\\s\\S]*?\\n  \\}');
    const m = html.match(patron);
    assert.ok(m, 'no se encontro "' + nombre + '" en el visor generado');
    return m[0];
}

/**
 * Arma un sandbox con las funciones REALES `campoDeCaso`/`accionLote` del
 * visor generado, con `seleccionados`/`enviarCaptura`/`marcarLoteComoGuardado`
 * inyectados como parámetros (así el `new Function` no necesita `document` ni
 * ningún global del navegador — ninguna de las dos funciones lo toca).
 */
function sandboxDelVisor(html, DATOS_BATCH) {
    const umbral = extraerBloque(html, 'UMBRAL_SECCIONES_LOTE', 'var');
    const nombrePdfDeSrc = extraerBloque(html, 'nombrePdfDe', 'function');
    const campoDeCasoSrc = extraerBloque(html, 'campoDeCaso', 'function');
    const accionLoteSrc = extraerBloque(html, 'accionLote', 'function');

    const capturas = [];   // lo que enviarCaptura() recibió en cada llamada
    // eslint-disable-next-line no-new-func
    const factory = new Function(
        'DATOS_BATCH', 'seleccionados', 'enviarCaptura', 'marcarLoteComoGuardado',
        umbral + '\n' + nombrePdfDeSrc + '\n' + campoDeCasoSrc + '\n' + accionLoteSrc +
        '\nreturn { campoDeCaso: campoDeCaso, accionLote: accionLote };'
    );
    const seleccionados = new Set();
    const api = factory(
        DATOS_BATCH, seleccionados,
        (campos) => capturas.push(campos),
        () => {}
    );
    return { api, seleccionados, capturas };
}

const REAL = path.join(os.homedir(), 'AppData', 'Roaming', 'procurador-electron',
    'usuarios', '27320694359', 'descargas');

async function main() {
    console.log('\nvisor de informe -- cadena secciones -> DATOS_BATCH -> payload de captura\n');

    let secciones = leerSeccionesInforme(REAL, 'fcr 18745/2017');
    const fuente = secciones.movimientos.length ? 'corrida REAL de esta maquina' : 'sinteticos (no habia corrida real)';
    if (!secciones.movimientos.length) {
        secciones = {
            movimientos: [
                { fecha: '26/11/2025', tipo: 'INFORMACION', detalle: 'Agregado al Paquete Nro. 2647202526' },
                { fecha: '20/11/2025', tipo: 'MOVIMIENTO', detalle: 'PARA ARCHIVAR' }
            ],
            historicos: [{ fecha: '01/01/2020', tipo: 'X', detalle: 'historico sintetico' }],
            intervinientes: ['LETRADO APODERADO|PERSONA SINTETICA|Tomo: 1 Folio: 1|20000000000'],
            vinculados: ['FCR 1/2020 - Conexo'],
            recursos: ['Recurso sintetico'],
            notas: ['Nota sintetica'],
        };
    }
    console.log('   movimientos de entrada: ' + secciones.movimientos.length + ' (' + fuente + ')\n');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'visorinf-'));
    try {
        // Un PDF de mentira con el nombre que buscaria `buscarPdfExpediente`, para que
        // `rutaPDF` se resuelva de verdad (parte D: la referencia al PDF en el snapshot).
        fs.writeFileSync(path.join(tmp, 'informe_FCR 018745_2017_2026-09-04T15-02-56.pdf'), '%PDF-1.4\n');

        const resumen = [
            Object.assign(
                { expediente: 'FCR 018745/2017', ok: true, exitCode: 0, caratula: 'AFIP c/ PRUEBA s/EJECUCION' },
                secciones
            ),
            { expediente: 'CNT 999/2024', ok: false, exitCode: 1, motivo: 'Expediente inexistente', movimientos: [] }
        ];
        const resumenPath = path.join(tmp, 'resumen.json');
        fs.writeFileSync(resumenPath, JSON.stringify(resumen), 'utf8');

        const bitacoraInfo = { enabled: true, seguidos: [], ssoToken: 'TOKEN_DE_PRUEBA' };
        const rutaHTML = await generarVisorHTML(resumenPath, { rutas: { descargas: tmp } }, null, bitacoraInfo);

        const html = fs.readFileSync(rutaHTML, 'utf8');
        const DB = leerDatosBatch(html);

        // ---------------------------------------------------------------------
        console.log('A. DATOS_BATCH -- las 6 secciones llegan (no solo movimientos)');
        // ---------------------------------------------------------------------
        check('A1 . el generador ya NO descarta los movimientos', () => {
            assert.strictEqual(DB.expedientes[0].movimientos.length, secciones.movimientos.length);
            assert.strictEqual(DB.expedientes[0].movimientos[0].detalle, secciones.movimientos[0].detalle);
        });

        check('A2 . las 5 secciones extra llegan a DATOS_BATCH.expedientes[0] (antes no existian en absoluto)', () => {
            const exp = DB.expedientes[0];
            assert.strictEqual(exp.historicos.length, secciones.historicos.length);
            assert.strictEqual(exp.intervinientes.length, secciones.intervinientes.length);
            assert.strictEqual(exp.vinculados.length, secciones.vinculados.length);
            assert.strictEqual(exp.recursos.length, secciones.recursos.length);
            assert.strictEqual(exp.notas.length, secciones.notas.length);
            assert.strictEqual(exp.intervinientes[0], secciones.intervinientes[0]);
        });

        check('A3 . un expediente sin secciones (resumen sintetico de main.js sin esas claves) no rompe -- guard Array.isArray', () => {
            // El caso 2 (fallido) del propio resumen no manda historicos/intervinientes/etc.
            const exp = DB.expedientes[1];
            assert.deepStrictEqual(exp.historicos, []);
            assert.deepStrictEqual(exp.intervinientes, []);
            assert.deepStrictEqual(exp.vinculados, []);
            assert.deepStrictEqual(exp.recursos, []);
            assert.deepStrictEqual(exp.notas, []);
        });

        // ---------------------------------------------------------------------
        console.log('\nB. campoDeCaso() -- payload individual (siempre incluirSecciones=true por default)');
        // ---------------------------------------------------------------------
        const { api, seleccionados, capturas } = sandboxDelVisor(html, DB);
        const { campoDeCaso, accionLote } = api;

        check('B1 . el payload de captura lleva los movimientos (antes iba fijo en "[]")', () => {
            const c = campoDeCaso(DB.expedientes[0]);
            assert.notStrictEqual(c.movs, '[]', 'movs sigue vacio: el bug no se corrigio');
            const parsed = JSON.parse(c.movs);
            assert.strictEqual(parsed.length, secciones.movimientos.length);
            assert.strictEqual(parsed[0].detalle, secciones.movimientos[0].detalle);
        });

        check('B2 . [parte D] lleva el nombre del PDF de esa corrida, decodificado', () => {
            const c = campoDeCaso(DB.expedientes[0]);
            assert.strictEqual(c.pdf, 'informe_FCR 018745_2017_2026-09-04T15-02-56.pdf');
        });

        check('B3 . la caratula (B4) no se rompio', () => {
            assert.strictEqual(campoDeCaso(DB.expedientes[0]).car, 'AFIP c/ PRUEBA s/EJECUCION');
        });

        check('B4 . [no-regresion] un expediente FALLIDO sigue mandando movs "[]" y sin PDF', () => {
            const c = campoDeCaso(DB.expedientes[1]);
            assert.strictEqual(c.movs, '[]');
            assert.strictEqual(c.pdf, '');
        });

        check('B5 . sin 2do argumento (default true) -- las 5 secciones extra viajan en el payload', () => {
            const c = campoDeCaso(DB.expedientes[0]);
            assert.ok('hist' in c && 'interv' in c && 'vinc' in c && 'rec' in c && 'notas' in c);
            assert.strictEqual(JSON.parse(c.hist).length, secciones.historicos.length);
            assert.strictEqual(JSON.parse(c.interv).length, secciones.intervinientes.length);
            assert.strictEqual(JSON.parse(c.interv)[0], secciones.intervinientes[0]);
        });

        check('B6 . con incluirSecciones=false EXPLICITO -- las 5 secciones NO viajan (ni la clave existe)', () => {
            const c = campoDeCaso(DB.expedientes[0], false);
            assert.ok(!('hist' in c) && !('interv' in c) && !('vinc' in c) && !('rec' in c) && !('notas' in c));
            // movs/pdf/car siguen viajando -- solo se omiten las 5 nuevas.
            assert.notStrictEqual(c.movs, '[]');
            assert.strictEqual(c.pdf, 'informe_FCR 018745_2017_2026-09-04T15-02-56.pdf');
        });

        check('B7 . el HTML generado tiene un solo cierre de <script> (regresion E9)', () => {
            assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
        });

        // ---------------------------------------------------------------------
        console.log('\nC. accionLote() -- el umbral de tamaño (2026-09-04), corrido con la función REAL del visor');
        // ---------------------------------------------------------------------
        check('C1 . lote CHICO (1 caso) + snapshot-lote -> incluye las 5 secciones extra', () => {
            capturas.length = 0;
            seleccionados.clear(); seleccionados.add(0);
            accionLote('snapshot-lote', null);
            assert.strictEqual(capturas.length, 1);
            const lote = JSON.parse(capturas[0].lote);
            assert.strictEqual(lote.length, 1);
            assert.ok('interv' in lote[0], 'con 1 caso (<=50) el umbral tiene que incluir las secciones');
            assert.strictEqual(JSON.parse(lote[0].interv).length, secciones.intervinientes.length);
        });

        check('C2 . accion "ficha-lote" (no persiste snapshot) -- NUNCA incluye las secciones extra, sea cual sea el tamaño', () => {
            capturas.length = 0;
            seleccionados.clear(); seleccionados.add(0);
            accionLote('ficha-lote', null);
            const lote = JSON.parse(capturas[0].lote);
            assert.ok(!('interv' in lote[0]), 'ficha-lote no persiste el snapshot: no tiene sentido pagar el peso de las secciones');
            assert.notStrictEqual(lote[0].movs, undefined, 'movs SI sigue viajando -- eso lo usa la ficha');
        });

        check('C3 . lote GRANDE (51 casos, > UMBRAL_SECCIONES_LOTE=50) + snapshot-lote -> NO incluye las secciones extra', () => {
            // 51 copias del mismo expediente -- alcanza para probar el umbral, no la
            // deduplicacion (que no es responsabilidad de esta funcion).
            DB.expedientes = Array.from({ length: 51 }, () => DB.expedientes[0]);
            capturas.length = 0;
            seleccionados.clear();
            for (let i = 0; i < 51; i++) seleccionados.add(i);
            accionLote('snapshot-lote', null);
            const lote = JSON.parse(capturas[0].lote);
            assert.strictEqual(lote.length, 51);
            assert.ok(!('interv' in lote[0]), 'con 51 casos (> 50) el umbral NO debe incluir las secciones');
            assert.notStrictEqual(lote[0].movs, undefined, 'movs SI sigue viajando -- el umbral solo afecta a las 5 secciones nuevas');
        });

        check('C4 . [control negativo, EXACTO en el borde] 50 casos SI entra, 51 NO -- confirma "<=" y no "<"', () => {
            DB.expedientes = Array.from({ length: 51 }, () => DB.expedientes[0]);
            capturas.length = 0;
            seleccionados.clear();
            for (let i = 0; i < 50; i++) seleccionados.add(i);   // exactamente 50
            accionLote('snapshot-lote', null);
            const lote50 = JSON.parse(capturas[0].lote);
            assert.ok('interv' in lote50[0], '50 casos (== umbral) tiene que incluir las secciones');

            capturas.length = 0;
            seleccionados.add(50);   // ahora 51
            accionLote('snapshot-lote', null);
            const lote51 = JSON.parse(capturas[0].lote);
            assert.ok(!('interv' in lote51[0]), '51 casos (> umbral) NO tiene que incluirlas');
        });

        // ---------------------------------------------------------------------
        console.log('\nD. Presupuesto de bytes -- con numero medido, no estimacion');
        // ---------------------------------------------------------------------
        check('D1 . 1 caso CON las 6 secciones entra comodo en 256 KB (aunque se seleccionaran 50 iguales)', () => {
            // DB.expedientes[0] sigue siendo el objeto ENRIQUECIDO original (con
            // rutaPDF ya resuelto) aun despues de que C3/C4 reasignaran el ARRAY --
            // ver el comentario de esa mutacion. Usarlo acá (en vez del `resumen`
            // crudo, sin rutaPDF) mide el caso real tal como sale del generador.
            const c = campoDeCaso(DB.expedientes[0]);
            const norm = {   // misma forma que normalizarCaso() de capture.js
                expediente: c.exp, jurisdiccion: c.jur, dependencia: c.dep, caratula: c.car,
                situacion_actual: c.sit, fecha_corrida: c.fproc, pdf: c.pdf,
                movimientos: JSON.parse(c.movs).map(m => ({ fecha: m.fecha, tipo: m.tipo, detalle: m.detalle })),
                historicos: JSON.parse(c.hist), intervinientes: JSON.parse(c.interv),
                vinculados: JSON.parse(c.vinc), recursos: JSON.parse(c.rec), notas: JSON.parse(c.notas),
            };
            const bytesUnCaso = Buffer.byteLength(JSON.stringify(norm), 'utf8');
            const bytesUmbral = bytesUnCaso * 50;   // el peor caso posible en el borde del umbral
            console.log('       (medido: ' + bytesUnCaso + ' B/caso con 6 secciones, ' + Math.round(bytesUmbral / 1024) + ' KB para 50 casos iguales)');
            assert.ok(bytesUmbral < 256 * 1024, '50 casos identicos a este medirian ' + Math.round(bytesUmbral / 1024) + ' KB (tope 256 KB)');
        });

        check('D2 . 120 casos SIN las 6 secciones (formato de hoy, > 50) sigue entrando en 256 KB (MAX_CASOS_LOTE corregido)', () => {
            const c = campoDeCaso(DB.expedientes[0], false);
            const norm = {
                expediente: c.exp, jurisdiccion: c.jur, dependencia: c.dep, caratula: c.car,
                situacion_actual: c.sit, fecha_corrida: c.fproc, pdf: c.pdf,
                movimientos: JSON.parse(c.movs).map(m => ({ fecha: m.fecha, tipo: m.tipo, detalle: m.detalle })),
            };
            const bytesUnCaso = Buffer.byteLength(JSON.stringify(norm), 'utf8');
            const bytes120 = bytesUnCaso * 120;
            console.log('       (medido: ' + bytesUnCaso + ' B/caso sin secciones, ' + Math.round(bytes120 / 1024) + ' KB para 120 casos)');
            assert.ok(bytes120 < 256 * 1024, '120 casos medirian ' + Math.round(bytes120 / 1024) + ' KB (tope 256 KB)');
        });

        check('D3 . [peor caso REAL disponible] combinar intervinientes reales (FCR 751/2025) + historicos reales (FCR 9391/2018) en 50 casos', () => {
            // D1 midió sobre 'fcr 18745/2017', que en esta máquina NO tiene ninguna
            // de las 5 secciones extra tildada (todas en 0) -- es el caso MÁS LIVIANO
            // posible, no representativo. Acá se combina el fixture con intervinientes
            // reales (5, con tomo/folio/CUIT) y el que tiene históricos reales (15) en
            // UN SOLO caso sintético, para medir sobre contenido real más pesado.
            const seccInterv = leerSeccionesInforme(REAL, 'FCR 751/2025');
            const seccHist = leerSeccionesInforme(REAL, 'FCR 9391/2018');
            if (seccInterv.intervinientes.length === 0 || seccHist.historicos.length === 0) {
                console.log('       SKIP -- faltan los fixtures reales de intervinientes/historicos en esta máquina');
                return;
            }
            const expPesado = Object.assign({}, DB.expedientes[0], {
                historicos: seccHist.historicos,
                intervinientes: seccInterv.intervinientes,
            });
            const c = campoDeCaso(expPesado);
            const norm = {
                expediente: c.exp, jurisdiccion: c.jur, dependencia: c.dep, caratula: c.car,
                situacion_actual: c.sit, fecha_corrida: c.fproc, pdf: c.pdf,
                movimientos: JSON.parse(c.movs).map(m => ({ fecha: m.fecha, tipo: m.tipo, detalle: m.detalle })),
                historicos: JSON.parse(c.hist), intervinientes: JSON.parse(c.interv),
                vinculados: JSON.parse(c.vinc), recursos: JSON.parse(c.rec), notas: JSON.parse(c.notas),
            };
            const bytesUnCaso = Buffer.byteLength(JSON.stringify(norm), 'utf8');
            const bytes50 = bytesUnCaso * 50;
            console.log('       (medido: ' + bytesUnCaso + ' B/caso, historicos+intervinientes reales combinados, ' + Math.round(bytes50 / 1024) + ' KB para 50 casos iguales)');
            assert.ok(bytes50 < 256 * 1024, '50 casos así de pesados medirían ' + Math.round(bytes50 / 1024) + ' KB (tope 256 KB)');
        });

        check('D4 . [documentado, no un bug] un caso PATOLÓGICO (las 6 secciones al tope de 15, ~90 chars/item) puede superar 256 KB en 50 casos -- y el sistema lo rechaza con aviso, no en silencio', () => {
            // Ningún fixture real de esta máquina tiene las 4 secciones de texto
            // (intervinientes/vinculados/recursos/notas) pobladas A LA VEZ con 15
            // filas cada una -- es el peor caso permitido por el propio tope de 15,
            // no observado en producción. Se fabrica a propósito (la propuesta lo
            // autoriza para "una sección con más de 15 items reales") para confirmar
            // que, si llegara a pasar, `captureDrafts.js` lo rechaza con
            // `captura=lote_grande` (ya verificado en capture-secciones.test.js del
            // lado del backend) en vez de perder datos o romper el servidor.
            const filaRealista = (i) => 'LETRADO APODERADO|PERSONA NUMERO ' + i + '|Tomo: 111 Folio: 678 - Federal|2022367078' + (i % 10);
            const seccionPesada = Array.from({ length: 15 }, (_, i) => filaRealista(i));
            const movPesado = Array.from({ length: 15 }, (_, i) => ({ fecha: '0' + ((i % 9) + 1) + '/01/2026', tipo: 'CAMBIO DE ESTADO DE EXPEDIENTE', detalle: 'CONFRONTE OFICIO NUMERO ' + i + ' PARA TRAMITE ADMINISTRATIVO EXTENSO' }));
            const expPatologico = Object.assign({}, DB.expedientes[0], {
                movimientos: movPesado, historicos: movPesado,
                intervinientes: seccionPesada, vinculados: seccionPesada,
                recursos: seccionPesada, notas: seccionPesada,
            });
            const c = campoDeCaso(expPatologico);
            const norm = {
                expediente: c.exp, jurisdiccion: c.jur, dependencia: c.dep, caratula: c.car,
                situacion_actual: c.sit, fecha_corrida: c.fproc, pdf: c.pdf,
                movimientos: JSON.parse(c.movs).map(m => ({ fecha: m.fecha, tipo: m.tipo, detalle: m.detalle })),
                historicos: JSON.parse(c.hist), intervinientes: JSON.parse(c.interv),
                vinculados: JSON.parse(c.vinc), recursos: JSON.parse(c.rec), notas: JSON.parse(c.notas),
            };
            const bytesUnCaso = Buffer.byteLength(JSON.stringify(norm), 'utf8');
            const bytes50 = bytesUnCaso * 50;
            console.log('       (medido: ' + bytesUnCaso + ' B/caso patologico, ' + Math.round(bytes50 / 1024) + ' KB para 50 iguales -- tope 256 KB)');
            if (bytes50 >= 256 * 1024) {
                console.log('       CONFIRMADO: este caso extremo SI puede superar el tope -- captureDrafts.js lo rechaza con aviso (ver capture-secciones.test.js), no lo pierde en silencio.');
            }
            // No se afirma que 50 casos así SIEMPRE entren -- se documenta el número
            // real y se deja constancia de que el rechazo, si ocurre, es explícito.
            assert.ok(bytesUnCaso > 0);
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    console.log('\n' + ok + ' PASS, ' + fail + ' FAIL');
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERROR: ' + e.stack); process.exit(1); });
