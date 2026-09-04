/**
 * Verifica `routes/capture.js` (el ÚNICO endpoint anónimo del sistema) tras la
 * extensión de 2026-09-04 que agrega 5 secciones extra al payload de captura
 * (históricos/intervinientes/vinculados/recursos/notas).
 *
 *   node backend-server/test/capture-secciones.test.js
 *
 * HTTP REAL, no simulado: levanta un `express()` mínimo con el MISMO parser
 * body que `server.js` monta para esta ruta (`express.urlencoded({extended:
 * false})`, ver server.js:198) más el router real de `routes/capture.js`, y le
 * pega POSTs reales por loopback. No necesita Postgres: este endpoint solo
 * toca el buffer en memoria de `utils/captureDrafts.js` — se requiere ese
 * mismo módulo acá para leer el borrador creado, sin loguear la respuesta a
 * mano (Node cachea el módulo: es el MISMO singleton que usa el router).
 *
 * CONTROLES NEGATIVOS: F1-F5 existen para que el test pueda fallar (JSON
 * corrupto en una sección, un array no-array, más de 500 filas, un item de
 * más de 600 caracteres, más de MAX_CASOS_LOTE casos). Sin ellos, un
 * `normalizarCaso()` que devolviera cualquier cosa sin sanear pasaría igual.
 */

const assert = require('assert');
const express = require('express');

const { reclamarDraft, _stats } = require('../utils/captureDrafts');

let ok = 0, fail = 0;
async function check(nombre, fn) {
    try { await fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}

async function main() {
    const app = express();
    // Mismo parser, mismo path-scope que server.js:198 — sin esto req.body
    // quedaría undefined y todo el router respondería como si el form viniera
    // vacío (falso negativo: parecería que la validación funciona cuando en
    // realidad nunca se ejerció el parseo real).
    app.use('/usuarios/capture', express.urlencoded({ extended: false, limit: '1mb' }));
    app.use('/usuarios/capture', require('../routes/capture'));

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}/usuarios/capture`;

    /** POST real, sin seguir el 303 (queremos leer el Location). */
    async function postCapture(campos) {
        const body = new URLSearchParams(campos).toString();
        return fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
            redirect: 'manual',
        });
    }

    /** Extrae `draft=<id>` del Location del 303 y reclama el borrador REAL. */
    function draftIdDe(res) {
        const loc = res.headers.get('location') || '';
        const m = loc.match(/[?&]draft=([^&]+)/);
        assert.ok(m, 'la respuesta no trae ?draft= -- loc=' + loc);
        return decodeURIComponent(m[1]);
    }

    console.log('\ncapture.js -- secciones extra del informe en el endpoint anonimo\n');

    // -------------------------------------------------------------------------
    console.log('A. Un caso individual (accion:"ficha") con las 6 secciones');
    // -------------------------------------------------------------------------
    // Forma EXACTA que arma campoDeCaso() del visor cuando incluirSecciones=true
    // (ver visor_informes_template.html) -- ya limpio del lado de Electron, acá
    // solo se sanea largo/tipo, no se reprocesa contenido.
    const casoCompleto = {
        accion: 'ficha',
        exp: 'FCR 018745/2017', jur: '', dep: '',
        car: 'RIO GALLEGOS AFIP c/ AGUA DEL CAMPO SRL s/EJECUCION FISCAL',
        sit: '', fproc: '4/9/2026, 14:30:00',
        movs: JSON.stringify([{ fecha: '13/08/2026', tipo: 'PROVEIDO', detalle: 'Se tiene presente' }]),
        pdf: 'informe_FCR 018745_2017_2026-09-04T17-27-53.pdf',
        hist: JSON.stringify([{ fecha: '30/11/2018', tipo: 'CAMBIO DE ESTADO', detalle: 'CONFRONTE OFICIO' }]),
        interv: JSON.stringify([
            'DEMANDADO|NOMBRE :\nAGUA DEL CAMPO SOCIEDAD DE RESPONSABILIDAD LIMITADA||',
            'LETRADO APODERADO|DAMIAN HORACIO ISLA MATA|Tomo: 111 Folio: 678 - Federal|20223670785',
        ]),
        vinc: JSON.stringify(['FCR 999/2020 - Conexo']),
        rec: JSON.stringify(['Apelación concedida - Cámara Federal']),
        notas: JSON.stringify(['Nota interna: verificar domicilio']),
    };

    let draftIdA;
    {
        const res = await postCapture(casoCompleto);
        await check('A1 . 303 con ?draft= (no 500, el POST se procesa)', () => {
            assert.strictEqual(res.status, 303);
            draftIdA = draftIdDe(res);
        });
    }

    let payloadA;
    await check('A2 . el borrador reclamado trae exactamente 1 caso', () => {
        payloadA = reclamarDraft(draftIdA);
        assert.ok(payloadA, 'el borrador tiene que existir');
        assert.strictEqual(payloadA.casos.length, 1);
    });

    await check('A3 . movimientos + pdf viajan igual que antes (no-regresion)', () => {
        const c = payloadA.casos[0];
        assert.strictEqual(c.expediente, 'FCR 018745/2017');
        assert.strictEqual(c.caratula, casoCompleto.car);
        assert.strictEqual(c.movimientos.length, 1);
        assert.strictEqual(c.movimientos[0].detalle, 'Se tiene presente');
        assert.strictEqual(c.pdf, casoCompleto.pdf);
    });

    await check('A4 . historicos llega con la misma forma que movimientos (fecha/tipo/detalle)', () => {
        const c = payloadA.casos[0];
        assert.strictEqual(c.historicos.length, 1);
        assert.strictEqual(c.historicos[0].detalle, 'CONFRONTE OFICIO');
        assert.deepStrictEqual(Object.keys(c.historicos[0]).sort(), ['detalle', 'fecha', 'tipo']);
    });

    await check('A5 . intervinientes/vinculados/recursos/notas llegan como string[], contenido intacto', () => {
        const c = payloadA.casos[0];
        assert.strictEqual(c.intervinientes.length, 2);
        assert.ok(c.intervinientes[1].includes('DAMIAN HORACIO ISLA MATA'));
        assert.deepStrictEqual(c.vinculados, ['FCR 999/2020 - Conexo']);
        assert.deepStrictEqual(c.recursos, ['Apelación concedida - Cámara Federal']);
        assert.deepStrictEqual(c.notas, ['Nota interna: verificar domicilio']);
    });

    // -------------------------------------------------------------------------
    console.log('\nB. Secciones AUSENTES (lote >50, incluirSecciones=false del lado del visor)');
    // -------------------------------------------------------------------------
    await check('B1 . sin los campos hist/interv/vinc/rec/notas -> las 5 claves quedan en [], no undefined', async () => {
        const sinSecciones = Object.assign({}, casoCompleto);
        delete sinSecciones.hist; delete sinSecciones.interv;
        delete sinSecciones.vinc; delete sinSecciones.rec; delete sinSecciones.notas;
        const res = await postCapture(sinSecciones);
        assert.strictEqual(res.status, 303);
        const payload = reclamarDraft(draftIdDe(res));
        const c = payload.casos[0];
        assert.deepStrictEqual(c.historicos, []);
        assert.deepStrictEqual(c.intervinientes, []);
        assert.deepStrictEqual(c.vinculados, []);
        assert.deepStrictEqual(c.recursos, []);
        assert.deepStrictEqual(c.notas, []);
        // no-regresion explicita: movs/pdf siguen sin depender de las secciones nuevas
        assert.strictEqual(c.movimientos.length, 1);
        assert.strictEqual(c.pdf, casoCompleto.pdf);
    });

    // -------------------------------------------------------------------------
    console.log('\nC. [negativo] cada seccion se aisla -- una rota no tira las demas ni el request');
    // -------------------------------------------------------------------------
    await check('C1 . JSON corrupto en "interv" -> esa seccion sola queda en [], el resto del caso sigue OK', async () => {
        const corrupto = Object.assign({}, casoCompleto, { interv: '{esto no es JSON ni array' });
        const res = await postCapture(corrupto);
        assert.strictEqual(res.status, 303, 'un JSON corrupto en 1 campo no debe tirar un 500');
        const c = reclamarDraft(draftIdDe(res)).casos[0];
        assert.deepStrictEqual(c.intervinientes, []);
        assert.strictEqual(c.movimientos.length, 1, 'movimientos no debe verse afectado por interv roto');
        assert.strictEqual(c.vinculados.length, 1, 'vinculados no debe verse afectado por interv roto');
    });

    await check('C2 . JSON valido pero NO-array en "notas" -> []', async () => {
        const noArray = Object.assign({}, casoCompleto, { notas: JSON.stringify({ no: 'es un array' }) });
        const res = await postCapture(noArray);
        assert.strictEqual(res.status, 303);
        const c = reclamarDraft(draftIdDe(res)).casos[0];
        assert.deepStrictEqual(c.notas, []);
    });

    await check('C3 . [negativo, control de que SÍ puede fallar] "hist" con forma de movimiento normal SIGUE funcionando (no es un false-negative del test C1/C2)', async () => {
        const res = await postCapture(casoCompleto);
        const c = reclamarDraft(draftIdDe(res)).casos[0];
        assert.strictEqual(c.historicos.length, 1, 'el caso base SIGUE andando -- prueba que C1/C2 detectan algo real, no que el parser siempre da []');
    });

    // -------------------------------------------------------------------------
    console.log('\nD. [negativo] cotas defensivas server-side (MAX_FILAS_SECCION / MAX_LARGO_ITEM_SECCION)');
    // -------------------------------------------------------------------------
    await check('D1 . una seccion de texto con 700 items se recorta a 500 (MAX_FILAS_SECCION)', async () => {
        const muchos = JSON.stringify(Array.from({ length: 700 }, (_, i) => 'item ' + i));
        const res = await postCapture(Object.assign({}, casoCompleto, { vinc: muchos }));
        assert.strictEqual(res.status, 303);
        const c = reclamarDraft(draftIdDe(res)).casos[0];
        assert.strictEqual(c.vinculados.length, 500);
    });

    await check('D2 . un item de 900 caracteres se recorta a 600 (MAX_LARGO_ITEM_SECCION)', async () => {
        const largo = 'X'.repeat(900);
        const res = await postCapture(Object.assign({}, casoCompleto, { rec: JSON.stringify([largo]) }));
        assert.strictEqual(res.status, 303);
        const c = reclamarDraft(draftIdDe(res)).casos[0];
        assert.strictEqual(c.recursos[0].length, 600);
    });

    await check('D3 . items vacios (tras trim) se descartan, no quedan strings ""', async () => {
        const res = await postCapture(Object.assign({}, casoCompleto, { notas: JSON.stringify(['real', '   ', '']) }));
        assert.strictEqual(res.status, 303);
        const c = reclamarDraft(draftIdDe(res)).casos[0];
        assert.deepStrictEqual(c.notas, ['real']);
    });

    // -------------------------------------------------------------------------
    console.log('\nE. [negativo] tope de filas del LOTE (hallazgo H3, corregido 2026-09-04: 200 -> 120)');
    // -------------------------------------------------------------------------
    await check('E1 . un lote de 120 casos (== MAX_CASOS_LOTE) entra', async () => {
        const lote = JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ exp: 'FCR ' + i + '/2026' })));
        const res = await postCapture({ accion: 'entrada-lote', tipo: 'nota', lote });
        assert.strictEqual(res.status, 303);
        const loc = res.headers.get('location') || '';
        assert.ok(!loc.includes('captura=lote_grande'), 'loc=' + loc);
    });

    await check('E2 . un lote de 121 casos (> MAX_CASOS_LOTE) se rechaza con captura=lote_grande, ANTES de crear el draft', async () => {
        const antes = _stats().vivos;
        const lote = JSON.stringify(Array.from({ length: 121 }, (_, i) => ({ exp: 'FCR ' + i + '/2026' })));
        const res = await postCapture({ accion: 'entrada-lote', tipo: 'nota', lote });
        assert.strictEqual(res.status, 303);
        const loc = res.headers.get('location') || '';
        assert.ok(loc.includes('captura=lote_grande'), 'loc=' + loc);
        assert.strictEqual(_stats().vivos, antes, 'no debe haber creado ningun draft nuevo');
    });

    server.close();
    console.log('\n' + ok + ' PASS, ' + fail + ' FAIL');
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERROR: ' + e.stack); process.exit(1); });
