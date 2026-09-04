/**
 * Verifica el extractor de movimientos + secciones del informe (Bitácora: el
 * snapshot quedaba vacío, y luego se extendió a guardar históricos/
 * intervinientes/vinculados/recursos/notas — 2026-09-04).
 *
 *   node electron-app/test/movimientosInforme.test.js
 *
 * DATOS REALES, NO FABRICADOS
 * ---------------------------
 * Los grupos A y C corren contra los backups REALES que dejaron corridas de
 * informe en esta máquina. Esos archivos NO se versionan: traen carátulas y
 * nombres de partes reales (mismo criterio que ya se aplicó a las capturas de
 * la demo). Si no están, esos grupos se SALTEAN con aviso — y el resumen lo
 * dice, para que "todo verde" no se confunda con "se probó contra datos reales".
 *
 * El grupo B arma árboles de directorios temporales para los caminos que no se
 * pueden provocar con el archivo real (mtime viejo, JSON corrupto, varios
 * `_temp`). El grupo D hace lo mismo para las 5 secciones extra (centinelas de
 * "sección vacía", el recorte a 15, y el aislamiento entre secciones).
 *
 * CONTROLES NEGATIVOS
 * -------------------
 * B4/B5/B6/B7/B8 (movimientos) y D2/D3/D5/D6/D7 (secciones extra) existen para
 * que el test pueda FALLAR: comprueban que el extractor devuelve `[]` cuando
 * debe (backup viejo, expediente ajeno, JSON roto, centinela de vacío, sección
 * ajena corrupta). Sin ellos, un extractor que devolviera siempre el primer
 * archivo que encuentra (o que tratara cualquier cosa como "hay contenido")
 * pasaría igual, y el test no probaría nada.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { leerMovimientosInforme, leerSeccionesInforme, MAX_MOVS_DEFAULT } = require('../informe/movimientosInforme');

// Corrida real en esta máquina (D6: descargas por CUIT).
const REAL = path.join(
    os.homedir(), 'AppData', 'Roaming', 'procurador-electron',
    'usuarios', '27320694359', 'descargas'
);
const REAL_EXP = 'fcr 18745/2017';   // la corrida dejó `fcr_18745_2017_backup`

let ok = 0, fail = 0, skip = 0;
function check(nombre, fn) {
    try { fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}
function omitir(nombre, motivo) { console.log('  SKIP ' + nombre + ' -- ' + motivo); skip++; }

/** Escribe un arbol `<raiz>/<temp>/<exp>_backup/listaMovimientos.json`. */
function sembrar(raiz, temp, expCarpeta, contenido, mtime) {
    const dir = path.join(raiz, temp, expCarpeta + '_backup');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'listaMovimientos.json');
    fs.writeFileSync(f, contenido, 'utf8');
    if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
    return f;
}
const MOV = (n) => JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
        pagina: 1, fila: i + 1, oficina: 'FIS', fecha: '0' + ((i % 9) + 1) + '/01/2026',
        tipo: 'MOVIMIENTO', detalle: 'detalle ' + (i + 1), aFs: '', archivo: 'nn',
        downloadNumber: null, viewHref: null
    }))
);

console.log('\nmovimientosInforme -- extractor de movimientos para el snapshot de Bitacora\n');

// ---------------------------------------------------------------------------
console.log('A. Contra la corrida REAL de informe de esta maquina');
// ---------------------------------------------------------------------------
const backupReal = path.join(REAL, '27320694359_temp', 'fcr_18745_2017_backup', 'listaMovimientos.json');
if (fs.existsSync(backupReal)) {
    const crudo = JSON.parse(fs.readFileSync(backupReal, 'utf8'));

    check('A1 . lee la corrida real (' + crudo.length + ' movimientos en disco) y recorta a ' + MAX_MOVS_DEFAULT, () => {
        const movs = leerMovimientosInforme(REAL, REAL_EXP);
        assert.strictEqual(movs.length, Math.min(crudo.length, MAX_MOVS_DEFAULT));
        assert.ok(movs.length > 0, 'el informe real tiene movimientos: no puede devolver []');
    });

    check('A2 . conserva el contenido real, no lo inventa', () => {
        const movs = leerMovimientosInforme(REAL, REAL_EXP);
        assert.strictEqual(movs[0].fecha, crudo[0].fecha);
        assert.strictEqual(movs[0].tipo, crudo[0].tipo);
        assert.strictEqual(movs[0].detalle, crudo[0].detalle);
        assert.ok(movs[0].detalle.length > 0, 'el detalle real no puede venir vacio');
    });

    check('A3 . deja solo fecha/tipo/detalle (lo que el backend conserva)', () => {
        const movs = leerMovimientosInforme(REAL, REAL_EXP);
        assert.deepStrictEqual(Object.keys(movs[0]).sort(), ['detalle', 'fecha', 'tipo']);
    });

    check('A4 . recorta por el principio = los mas recientes (orden del PJN)', () => {
        const movs = leerMovimientosInforme(REAL, REAL_EXP, { max: 3 });
        assert.deepStrictEqual(movs.map(m => m.detalle), crudo.slice(0, 3).map(m => m.detalle));
    });

    check('A5 . el lote real (solo movimientos+pdf) entra en el presupuesto de 256 KB del borrador', () => {
        // captureDrafts.js rechaza ENTERO un borrador > 256 KB. Con el tope de 15,
        // MAX_CASOS_LOTE (120, corregido 2026-09-04 -- ver capture.js) tiene que
        // seguir entrando. Se mide igual con 200 (más estricto que el tope real
        // de 120) para dejar margen de sobra.
        const uno = leerMovimientosInforme(REAL, REAL_EXP);
        const bytes = Buffer.byteLength(JSON.stringify(uno), 'utf8') * 200;
        assert.ok(bytes < 256 * 1024, '200 casos medirian ' + Math.round(bytes / 1024) + ' KB (tope 256 KB)');
    });
} else {
    omitir('A1-A5 . datos reales', 'no existe ' + backupReal);
}

// ---------------------------------------------------------------------------
console.log('\nC. leerSeccionesInforme() -- las 6 secciones, contra fixtures REALES (2026-09-04)');
// ---------------------------------------------------------------------------
// FCR 751/2025: tiene las 7 secciones de backup (datosGenerales incluido) --
// intervinientes con contenido real (26 filas crudas, 5 reales tras limpiar),
// historicos/vinculados/recursos/notas todas "vacías" (traen el centinela).
const backup751 = path.join(REAL, '27320694359_temp', 'FCR_751_2025_backup');
// FCR 9391/2018: historicos con contenido REAL (32 filas -> recorta a 15).
const backup9391 = path.join(REAL, '27320694359_temp', 'FCR_9391_2018_backup');

if (fs.existsSync(path.join(backup751, 'intervinientes.json'))) {
    const intervCrudo = JSON.parse(fs.readFileSync(path.join(backup751, 'intervinientes.json'), 'utf8'));

    check('C1 . intervinientes: ' + intervCrudo.length + ' filas crudas se limpian a 5 reales (encabezado+vacíos+duplicado descartados)', () => {
        const secs = leerSeccionesInforme(REAL, 'FCR 751/2025');
        assert.strictEqual(secs.intervinientes.length, 5, 'medido contra el fixture real: 26 crudas -> 5 reales');
        assert.ok(secs.intervinientes.some(s => s.includes('DAMIAN HORACIO ISLA MATA')));
        assert.ok(!secs.intervinientes.some(s => s.startsWith('TIPO|NOMBRE')), 'la fila de encabezado no debe sobrevivir');
        assert.ok(!secs.intervinientes.some(s => s.trim() === ''), 'ninguna fila vacía debe sobrevivir');
    });

    check('C2 . historicos/vinculados/recursos/notas VACÍOS (centinela del PJN) -> [], no el mensaje', () => {
        const secs = leerSeccionesInforme(REAL, 'FCR 751/2025');
        assert.deepStrictEqual(secs.historicos, [], 'el centinela {tipo:"info"} debe dar []');
        assert.deepStrictEqual(secs.vinculados, [], 'el mensaje "no posee vinculados..." debe dar []');
        assert.deepStrictEqual(secs.recursos, [], 'el mensaje "no posee recursos" debe dar []');
        assert.deepStrictEqual(secs.notas, [], 'el mensaje "no posee notas" debe dar []');
    });

    check('C3 . movimientos actuales sigue funcionando igual dentro de leerSeccionesInforme (no-regresión de A1-A4)', () => {
        const movsIndependiente = leerMovimientosInforme(REAL, 'FCR 751/2025');
        const secs = leerSeccionesInforme(REAL, 'FCR 751/2025');
        assert.deepStrictEqual(secs.movimientos, movsIndependiente);
        assert.ok(secs.movimientos.length > 0);
    });
} else {
    omitir('C1-C3 . intervinientes reales (FCR 751/2025)', 'no existe ' + backup751);
}

if (fs.existsSync(path.join(backup9391, 'listaMovimientosHistoricos.json'))) {
    const histCrudo = JSON.parse(fs.readFileSync(path.join(backup9391, 'listaMovimientosHistoricos.json'), 'utf8'));

    check('C4 . historicos CON contenido real (' + histCrudo.length + ' filas) se recorta a ' + MAX_MOVS_DEFAULT, () => {
        const secs = leerSeccionesInforme(REAL, 'FCR 9391/2018');
        assert.strictEqual(secs.historicos.length, Math.min(histCrudo.length, MAX_MOVS_DEFAULT));
        assert.strictEqual(secs.historicos[0].detalle, histCrudo[0].detalle);
        assert.deepStrictEqual(Object.keys(secs.historicos[0]).sort(), ['detalle', 'fecha', 'tipo']);
    });

    check('C5 . ese mismo expediente no tiene intervinientes/vinculados/recursos/notas -> las 4 en []', () => {
        const secs = leerSeccionesInforme(REAL, 'FCR 9391/2018');
        assert.deepStrictEqual(secs.intervinientes, []);
        assert.deepStrictEqual(secs.vinculados, []);
        assert.deepStrictEqual(secs.recursos, []);
        assert.deepStrictEqual(secs.notas, []);
    });
} else {
    omitir('C4-C5 . historicos reales (FCR 9391/2018)', 'no existe ' + backup9391);
}

check('C6 . expediente SIN ninguna sección extra (solo datosGenerales+listaMovimientos, ej. FCR 18745/2017 de ayer) -> las 5 extra en []', () => {
    const secs = leerSeccionesInforme(REAL, REAL_EXP);
    assert.deepStrictEqual(secs.historicos, []);
    assert.deepStrictEqual(secs.intervinientes, []);
    assert.deepStrictEqual(secs.vinculados, []);
    assert.deepStrictEqual(secs.recursos, []);
    assert.deepStrictEqual(secs.notas, []);
    assert.ok(secs.movimientos.length > 0, 'movimientos SÍ debe tener datos -- este expediente lo tiene');
});

// ---------------------------------------------------------------------------
console.log('\nB. Estructura y controles negativos (arboles temporales)');
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'movinf-'));
try {
    check('B1 . informe sin movimientos -> [] (el script no escribe el archivo)', () => {
        const raiz = path.join(tmp, 'b1');
        fs.mkdirSync(path.join(raiz, '27_temp'), { recursive: true });
        assert.deepStrictEqual(leerMovimientosInforme(raiz, 'FCR 1/2020'), []);
    });

    check('B2 . varios _temp -> gana el mas reciente por mtime', () => {
        const raiz = path.join(tmp, 'b2');
        sembrar(raiz, 'default_temp', 'FCR_1_2020', MOV(2), Date.now() - 600000);
        sembrar(raiz, '27320694359_temp', 'FCR_1_2020', MOV(5), Date.now());
        assert.strictEqual(leerMovimientosInforme(raiz, 'FCR 1/2020').length, 5);
    });

    check('B3 . normaliza el expediente igual que el script (no alfanumerico -> _)', () => {
        const raiz = path.join(tmp, 'b3');
        sembrar(raiz, 'x_temp', 'FCR_018745_2017', MOV(4), Date.now());
        assert.strictEqual(leerMovimientosInforme(raiz, 'FCR 018745/2017').length, 4);
    });

    // -- controles negativos --------------------------------------------------
    check('B4 . [negativo] backup ANTERIOR a la corrida -> [] (no arrastra el viejo)', () => {
        const raiz = path.join(tmp, 'b4');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(9), ahora - 3600000);   // de hace 1 hora
        assert.strictEqual(leerMovimientosInforme(raiz, 'FCR 1/2020').length, 9, 'sin guarda debe leerlo');
        assert.deepStrictEqual(
            leerMovimientosInforme(raiz, 'FCR 1/2020', { desdeMs: ahora - 60000 }), [],
            'con desdeMs posterior al archivo tiene que descartarlo'
        );
    });

    check('B5 . [negativo] expediente ajeno -> [] aunque haya otros backups', () => {
        const raiz = path.join(tmp, 'b5');
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(7), Date.now());
        assert.deepStrictEqual(leerMovimientosInforme(raiz, 'CNT 999/2024'), []);
    });

    check('B6 . [negativo] JSON corrupto -> [] sin lanzar', () => {
        const raiz = path.join(tmp, 'b6');
        sembrar(raiz, 'x_temp', 'FCR_1_2020', '{esto no es JSON', Date.now());
        assert.deepStrictEqual(leerMovimientosInforme(raiz, 'FCR 1/2020'), []);
    });

    check('B7 . [negativo] carpeta inexistente -> [] sin lanzar', () => {
        assert.deepStrictEqual(leerMovimientosInforme(path.join(tmp, 'no-existe'), 'FCR 1/2020'), []);
    });

    check('B8 . [negativo] JSON valido pero no-array -> []', () => {
        const raiz = path.join(tmp, 'b8');
        sembrar(raiz, 'x_temp', 'FCR_1_2020', '{"movimientos":[]}', Date.now());
        assert.deepStrictEqual(leerMovimientosInforme(raiz, 'FCR 1/2020'), []);
    });

    check('B9 . campos ausentes -> strings vacios, sin undefined ni null', () => {
        const raiz = path.join(tmp, 'b9');
        sembrar(raiz, 'x_temp', 'FCR_1_2020', '[{"fecha":"01/01/2026"}]', Date.now());
        assert.deepStrictEqual(leerMovimientosInforme(raiz, 'FCR 1/2020'), [
            { fecha: '01/01/2026', tipo: '', detalle: '' }
        ]);
    });
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('\nD. leerSeccionesInforme() -- estructura y controles negativos (sintético)');
// ---------------------------------------------------------------------------
/** Escribe UN archivo cualquiera dentro de `<raiz>/<temp>/<expCarpeta>_backup/`. */
function sembrarArchivo(raiz, temp, expCarpeta, nombreArchivo, contenido, mtime) {
    const dir = path.join(raiz, temp, expCarpeta + '_backup');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, nombreArchivo);
    fs.writeFileSync(f, contenido, 'utf8');
    if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
    return f;
}

const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'movinf-d-'));
try {
    check('D1 . intervinientes: 20 filas reales (sin encabezado, sin vacías, sin duplicar) se recortan a 15', () => {
        const raiz = path.join(tmpD, 'd1');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(1), ahora);   // ancla (listaMovimientos.json)
        const filas = Array.from({ length: 20 }, (_, i) => `LETRADO APODERADO|PERSONA NUMERO ${i}|Tomo: 1 Folio: ${i}|2022367078${i % 10}`);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'intervinientes.json', JSON.stringify(filas), ahora);
        const secs = leerSeccionesInforme(raiz, 'FCR 1/2020');
        assert.strictEqual(secs.intervinientes.length, 15, '20 filas reales -> recorta a MAX_MOVS_DEFAULT (15)');
    });

    check('D2 . intervinientes: descarta la fila de encabezado y las filas vacías, y deduplica', () => {
        const raiz = path.join(tmpD, 'd2');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(1), ahora);
        const filas = [
            'TIPO|NOMBRE|TOMO/FOLIO :\nTOMO/FOLIO|I.E.J. :\nI.E.J.',   // encabezado -> fuera
            '', '',                                                      // vacías -> fuera
            'TIPO :\nACTOR|NOMBRE :\nJUAN PEREZ||',                      // "TIPO :" se saca, el resto queda
            'TIPO :\nACTOR|NOMBRE :\nJUAN PEREZ||',                      // duplicado -> se deduplica
        ];
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'intervinientes.json', JSON.stringify(filas), ahora);
        const secs = leerSeccionesInforme(raiz, 'FCR 1/2020');
        assert.deepStrictEqual(secs.intervinientes, ['ACTOR|NOMBRE :\nJUAN PEREZ||']);
    });

    check('D3 . historicos: el centinela se detecta por FORMA (length=1, tipo="info"), no por el texto exacto', () => {
        const raiz = path.join(tmpD, 'd3');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(1), ahora);
        // Texto DISTINTO al real ("El expediente no posee actuaciones históricas.")
        // -- si el PJN cambia la redacción, este criterio (forma, no texto) sigue andando.
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'listaMovimientosHistoricos.json',
            JSON.stringify([{ tipo: 'info', detalle: 'Otro texto cualquiera del PJN' }]), ahora);
        assert.deepStrictEqual(leerSeccionesInforme(raiz, 'FCR 1/2020').historicos, []);
    });

    check('D4 . [negativo] vinculados/recursos/notas: el centinela "El expediente no posee..." -> []', () => {
        const raiz = path.join(tmpD, 'd4');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(1), ahora);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'vinculados.json', JSON.stringify(['El expediente no posee vinculados posibles de ser visualizados.']), ahora);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'recursos.json', JSON.stringify(['El expediente no posee recursos']), ahora);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'notas.json', JSON.stringify(['El expediente no posee notas']), ahora);
        const secs = leerSeccionesInforme(raiz, 'FCR 1/2020');
        assert.deepStrictEqual(secs.vinculados, []);
        assert.deepStrictEqual(secs.recursos, []);
        assert.deepStrictEqual(secs.notas, []);
    });

    check('D5 . [negativo, control de que el centinela NO es sobre-agresivo] un solo dato real que no arranca con el mensaje de vacío SOBREVIVE', () => {
        const raiz = path.join(tmpD, 'd5');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(1), ahora);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'notas.json', JSON.stringify(['Verificar domicilio del demandado antes de la audiencia']), ahora);
        assert.deepStrictEqual(
            leerSeccionesInforme(raiz, 'FCR 1/2020').notas,
            ['Verificar domicilio del demandado antes de la audiencia'],
            'un dato real de 1 sola entrada NO debe confundirse con el centinela de vacío'
        );
    });

    check('D6 . [negativo] aislamiento entre secciones: "vinculados.json" corrupto NO vacía las demás', () => {
        const raiz = path.join(tmpD, 'd6');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(3), ahora);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'vinculados.json', '{esto no es JSON ni array', ahora);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'recursos.json', JSON.stringify(['Recurso real']), ahora);
        const secs = leerSeccionesInforme(raiz, 'FCR 1/2020');
        assert.deepStrictEqual(secs.vinculados, [], 'la seccion corrupta sola debe dar []');
        assert.strictEqual(secs.movimientos.length, 3, 'movimientos no debe verse afectado');
        assert.deepStrictEqual(secs.recursos, ['Recurso real'], 'recursos (sano) no debe verse afectado por vinculados (roto)');
    });

    check('D7 . [negativo] historicos con forma no-array (objeto suelto) -> []', () => {
        const raiz = path.join(tmpD, 'd7');
        const ahora = Date.now();
        sembrar(raiz, 'x_temp', 'FCR_1_2020', MOV(1), ahora);
        sembrarArchivo(raiz, 'x_temp', 'FCR_1_2020', 'listaMovimientosHistoricos.json', '{"no":"es un array"}', ahora);
        assert.deepStrictEqual(leerSeccionesInforme(raiz, 'FCR 1/2020').historicos, []);
    });

    check('D8 . expediente sin NINGÚN backup -> las 6 claves en [] (nunca undefined, nunca lanza)', () => {
        const secs = leerSeccionesInforme(path.join(tmpD, 'no-existe'), 'FCR 1/2020');
        assert.deepStrictEqual(secs, {
            movimientos: [], historicos: [], intervinientes: [],
            vinculados: [], recursos: [], notas: [],
        });
    });
} finally {
    fs.rmSync(tmpD, { recursive: true, force: true });
}

console.log('\n' + ok + ' PASS, ' + fail + ' FAIL' + (skip ? ', ' + skip + ' OMITIDO' : ''));
if (skip) console.log('AVISO: se saltearon casos con datos reales: el resultado NO cubre el archivo real.');
process.exit(fail > 0 ? 1 : 0);
