/**
 * Verifica `datosSnapshot()` de `routes/bitacora.js` — arma el JSONB que
 * `POST /usuarios/api/expedientes/capture-lote` guarda en
 * `expediente_snapshots.data`, extendido 2026-09-04 con las 5 secciones extra
 * del informe.
 *
 *   node backend-server/test/datos-snapshot.test.js
 *
 * `routes/bitacora.js` solo exporta el router (igual que TODOS los demás
 * archivos de `routes/`, sin precedente de exportar funciones internas en este
 * proyecto) y su endpoint real necesita Postgres — sin eso no se puede montar
 * un Express real como se hizo para `capture.js` (que es puramente en
 * memoria). `datosSnapshot()` en cambio es una función PURA (sin DB, sin
 * `req`/`res`) — se extrae del fuente REAL por balanceo simple de llaves
 * (mismo criterio que ya usa `visorInformeCaptura.test.js` para
 * `campoDeCaso()`) y se ejecuta tal cual, sin reimplementarla.
 *
 * ⚠️ Lo que este archivo NO prueba (documentado, no escondido): que el INSERT
 * real a `expediente_snapshots` en Postgres persista este JSON correctamente
 * — eso requiere una base real y queda para la corrida en staging/F3 con el
 * operador presente, fuera del alcance de esta verificación.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let ok = 0, fail = 0;
function check(nombre, fn) {
    try { fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}

function extraerFuncion(src, nombre) {
    const encabezado = new RegExp('function\\s+' + nombre + '\\s*\\(');
    const m = encabezado.exec(src);
    assert.ok(m, 'no se encontro function ' + nombre + '() en bitacora.js');
    const cierre = src.indexOf('\n}', m.index);
    assert.ok(cierre > -1, 'no se encontro el cierre en columna 0 de ' + nombre + '()');
    return src.slice(m.index, cierre + 2);
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bitacora.js'), 'utf8');
// eslint-disable-next-line no-new-func
const { datosSnapshot } = new Function(extraerFuncion(SRC, 'datosSnapshot') + '\nreturn { datosSnapshot };')();

console.log('\ndatosSnapshot() -- JSONB de expediente_snapshots.data (routes/bitacora.js)\n');

const casoInforme = {
    expediente: 'FCR 018745/2017',
    movimientos: [{ fecha: '13/08/2026', tipo: 'PROVEIDO', detalle: 'Se tiene presente' }],
    pdf: 'informe_FCR 018745_2017_2026-09-04T17-27-53.pdf',
    historicos: [{ fecha: '30/11/2018', tipo: 'X', detalle: 'CONFRONTE OFICIO' }],
    intervinientes: ['LETRADO APODERADO|DAMIAN HORACIO ISLA MATA'],
    vinculados: ['FCR 999/2020 - Conexo'],
    recursos: ['Apelación concedida'],
    notas: ['Nota interna'],
};

// ---------------------------------------------------------------------------
console.log('A. kind="informe" -- las 6 claves aparecen, con contenido');
// ---------------------------------------------------------------------------
check('A1 . movimientos siempre presente', () => {
    const d = datosSnapshot(casoInforme, 'informe');
    assert.deepStrictEqual(d.movimientos, casoInforme.movimientos);
});
check('A2 . pdf presente (no-regresion del fix de la propuesta hermana)', () => {
    assert.strictEqual(datosSnapshot(casoInforme, 'informe').pdf, casoInforme.pdf);
});
check('A3 . historicos/intervinientes/vinculados/recursos/notas presentes con el contenido real', () => {
    const d = datosSnapshot(casoInforme, 'informe');
    assert.deepStrictEqual(d.historicos, casoInforme.historicos);
    assert.deepStrictEqual(d.intervinientes, casoInforme.intervinientes);
    assert.deepStrictEqual(d.vinculados, casoInforme.vinculados);
    assert.deepStrictEqual(d.recursos, casoInforme.recursos);
    assert.deepStrictEqual(d.notas, casoInforme.notas);
});

// ---------------------------------------------------------------------------
console.log('\nB. Secciones vacias -> la CLAVE se omite (no "clave": [])');
// ---------------------------------------------------------------------------
check('B1 . historicos=[] -> la clave "historicos" no existe en el JSON', () => {
    const d = datosSnapshot(Object.assign({}, casoInforme, { historicos: [] }), 'informe');
    assert.ok(!('historicos' in d), 'la clave no debe existir cuando esta vacia');
});
check('B2 . pdf="" -> la clave "pdf" no existe', () => {
    const d = datosSnapshot(Object.assign({}, casoInforme, { pdf: '' }), 'informe');
    assert.ok(!('pdf' in d));
});
check('B3 . campo ausente (undefined) en vez de []  -> tampoco aparece la clave', () => {
    const sinIntervinientes = Object.assign({}, casoInforme);
    delete sinIntervinientes.intervinientes;
    const d = datosSnapshot(sinIntervinientes, 'informe');
    assert.ok(!('intervinientes' in d));
});
check('B4 . el JSON serializado de una seccion vacia NO contiene "[]" para esa clave', () => {
    const d = datosSnapshot(Object.assign({}, casoInforme, { recursos: [] }), 'informe');
    const json = JSON.stringify(d);
    assert.ok(!json.includes('"recursos"'), 'json=' + json);
});

// ---------------------------------------------------------------------------
console.log('\nC. NO-REGRESION: kind="procuracion" -- NINGUNA de las 5 secciones ni pdf, aunque vengan pobladas');
// ---------------------------------------------------------------------------
check('C1 . un caso de PROCURACION con historicos/intervinientes/pdf poblados los IGNORA -- solo movimientos', () => {
    const d = datosSnapshot(casoInforme, 'procuracion');
    assert.deepStrictEqual(Object.keys(d), ['movimientos'], 'kind=procuracion no debe llevar ninguna clave extra, ni pdf');
    assert.deepStrictEqual(d.movimientos, casoInforme.movimientos);
});

console.log('\n' + ok + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
