/**
 * Verifica el render del modal "Ver snapshot" de Mis Expedientes (portal), tras
 * la extensión de 2026-09-04 que agrega 5 secciones extra al snapshot de
 * informe (históricos/intervinientes/vinculados/recursos/notas).
 *
 *   node backend-server/test/mexp-snapshot-render.test.js
 *
 * Corre las funciones REALES de `public/usuarios/app.js` (extraídas del fuente
 * por balanceo de llaves, no reimplementadas) — `renderMexpSnapshot` y sus 4
 * helpers son funciones puras de armado de HTML (nunca tocan `document`, solo
 * asignan `.textContent`/`.innerHTML` de lo que se les pasa), así que no hace
 * falta jsdom: alcanza con objetos planos como stub de `titleEl`/`body`.
 *
 * NO-REGRESIÓN (el eje central de este archivo): un snapshot como los que YA
 * existen en producción (ids 17/44/45, solo `movimientos`+`pdf`, sin ninguna de
 * las 5 claves nuevas) tiene que renderizar EXACTAMENTE igual que antes de esta
 * extensión — ni un título de sección nuevo, ni un "(0)" de una sección que
 * nunca tuvo dato.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let ok = 0, fail = 0;
function check(nombre, fn) {
    try { fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}

/**
 * Extrae `function <nombre>(...) { ... }` del fuente. NO balancea llaves
 * carácter por carácter (un regex literal como `/"/g`, que `escapeHtml` usa de
 * verdad, tiene una comilla suelta que rompe cualquier contador ingenuo de
 * comillas) — en cambio busca el primer `\n}` en columna 0, que es como este
 * archivo cierra SIEMPRE sus funciones de nivel superior (los bloques internos
 * quedan indentados). Mismo criterio que ya usa `visorInformeCaptura.test.js`
 * para extraer `campoDeCaso()`/`nombrePdfDe()` del visor generado.
 */
function extraerFuncion(src, nombre) {
    const encabezado = new RegExp('function\\s+' + nombre + '\\s*\\(');
    const m = encabezado.exec(src);
    assert.ok(m, 'no se encontro function ' + nombre + '() en app.js');
    const cierre = src.indexOf('\n}', m.index);
    assert.ok(cierre > -1, 'no se encontro el cierre en columna 0 de ' + nombre + '()');
    return src.slice(m.index, cierre + 2);
}

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'usuarios', 'app.js'), 'utf8');

const NOMBRES = [
    'escapeHtml', 'bitUtcYmd', 'bitFormatUtcDate',
    'mexpSnapshotMovHtml', 'mexpSnapshotMovimientosHtml',
    'mexpSnapshotSeccionMovsHtml', 'mexpSnapshotSeccionTextoHtml',
    'renderMexpSnapshot',
];
const cuerpo = NOMBRES.map(n => extraerFuncion(APP_JS, n)).join('\n');

// eslint-disable-next-line no-new-func
const modulo = new Function(cuerpo + '\nreturn { renderMexpSnapshot, escapeHtml };')();
const { renderMexpSnapshot } = modulo;

function render(snapshot) {
    const titleEl = { textContent: '' };
    const body = { innerHTML: '' };
    renderMexpSnapshot(snapshot, titleEl, body);
    return { titulo: titleEl.textContent, html: body.innerHTML };
}

console.log('\nrenderMexpSnapshot -- modal de historial de Mis Expedientes (portal)\n');

// ---------------------------------------------------------------------------
console.log('A. No-regresion: snapshots como los que YA existen en produccion');
// ---------------------------------------------------------------------------
check('A1 . snapshot de PROCURACION (solo movimientos) -- sin ninguna seccion nueva', () => {
    const { html } = render({
        kind: 'procuracion', run_date: '2026-09-04T12:00:00Z', situacion: 'EN TRAMITE',
        data: { movimientos: [{ fecha: '01/09/2026', tipo: 'MOVIMIENTO', detalle: 'algo paso' }] }
    });
    assert.ok(html.includes('algo paso'), 'el movimiento real tiene que verse');
    assert.ok(!html.includes('Movimientos históricos'), 'procuracion no debe mostrar historicos');
    assert.ok(!html.includes('Intervinientes'), 'procuracion no debe mostrar intervinientes');
    assert.ok(!html.includes('Vinculados'), 'procuracion no debe mostrar vinculados');
    assert.ok(!html.includes('Recursos'), 'procuracion no debe mostrar recursos');
    assert.ok(!html.includes('Notas'), 'procuracion no debe mostrar notas');
});

check('A2 . snapshot de INFORME VIEJO (ids 17/44 reales: movimientos vacios, sin pdf, sin secciones) -- "Sin movimientos", nada mas', () => {
    const { html } = render({ kind: 'informe', run_date: '2026-08-04T10:00:00Z', situacion: null, data: { movimientos: [] } });
    assert.ok(html.includes('Sin movimientos registrados'), 'debe seguir mostrando el mensaje de vacio de siempre');
    assert.ok(!html.includes('📄 Informe generado'), 'sin pdf en el snapshot, no debe inventarse la linea');
    assert.ok(!html.includes('Movimientos históricos'), 'sin la clave, no debe aparecer el titulo');
});

check('A3 . snapshot de INFORME id 45 (real, previo a esta extension: movimientos+pdf, SIN las 5 secciones) -- igual que antes', () => {
    const { html } = render({
        kind: 'informe', run_date: '2026-09-04T17:27:53Z', situacion: '',
        data: {
            movimientos: [{ fecha: '26/11/2025', tipo: 'INFORMACION', detalle: 'Agregado al Paquete Nro. 2647202526' }],
            pdf: 'informe_FCR 018745_2017_2026-09-04T17-27-53.pdf'
        }
    });
    assert.ok(html.includes('📄 Informe generado'), 'el pdf tiene que seguir viendose (fix previo, no tocar)');
    assert.ok(html.includes('informe_FCR 018745_2017_2026-09-04T17-27-53.pdf'));
    assert.ok(html.includes('Agregado al Paquete Nro. 2647202526'));
    assert.ok(!html.includes('Movimientos históricos'), 'sin la clave en data, no debe inventarse la seccion');
    assert.ok(!html.includes('Intervinientes'));
});

// ---------------------------------------------------------------------------
console.log('\nB. Las 5 secciones nuevas, con datos reales del fixture');
// ---------------------------------------------------------------------------
const snapshotCompleto = {
    kind: 'informe', run_date: '2026-09-04T09:14:00Z', situacion: 'EN TRAMITE',
    data: {
        movimientos: [{ fecha: '13/08/2026', tipo: 'PROVEIDO', detalle: 'Se tiene presente' }],
        pdf: 'informe_FCR 000751_2025_2026-09-04T09-14-00.pdf',
        historicos: [{ fecha: '30/11/2018', tipo: 'CAMBIO DE ESTADO DE EXPEDIENTE', detalle: 'CONFRONTE OFICIO' }],
        intervinientes: [
            'DEMANDADO|NOMBRE :\nAGUA DEL CAMPO SOCIEDAD DE RESPONSABILIDAD LIMITADA||',
            'LETRADO APODERADO|DAMIAN HORACIO ISLA MATA|Tomo: 111 Folio: 678 - Federal|20223670785',
        ],
        vinculados: ['FCR 999/2020 - Conexo'],
        recursos: ['Apelación concedida - Cámara Federal'],
        notas: ['Nota interna: verificar domicilio'],
    }
};

check('B1 . las 5 secciones aparecen, cada una con su titulo y su conteo real', () => {
    const { html } = render(snapshotCompleto);
    assert.ok(html.includes('Movimientos históricos (1)'));
    assert.ok(html.includes('Intervinientes (2)'));
    assert.ok(html.includes('Vinculados (1)'));
    assert.ok(html.includes('Recursos (1)'));
    assert.ok(html.includes('Notas (1)'));
});

check('B2 . el contenido real de cada seccion se ve (no solo el titulo)', () => {
    const { html } = render(snapshotCompleto);
    assert.ok(html.includes('CONFRONTE OFICIO'));
    assert.ok(html.includes('DAMIAN HORACIO ISLA MATA'));
    assert.ok(html.includes('FCR 999/2020 - Conexo'));
    assert.ok(html.includes('Apelación concedida'));
    assert.ok(html.includes('verificar domicilio'));
});

check('B3 . una seccion presente pero VACIA ([]) no se muestra -- "Recursos (0)" seria peor que nada', () => {
    const conRecursosVacios = JSON.parse(JSON.stringify(snapshotCompleto));
    conRecursosVacios.data.recursos = [];
    const { html } = render(conRecursosVacios);
    assert.ok(!html.includes('Recursos'), 'una seccion vacia NO debe renderizar ni su titulo');
    assert.ok(html.includes('Notas (1)'), 'las demas secciones no deben verse afectadas');
});

// ---------------------------------------------------------------------------
console.log('\nC. [negativo] Escape de XSS -- el dato viene del PJN, no confiable');
// ---------------------------------------------------------------------------
check('C1 . un interviniente con <script> queda escapado, no ejecutable', () => {
    const hostil = JSON.parse(JSON.stringify(snapshotCompleto));
    hostil.data.intervinientes = ['<script>alert(1)</script>'];
    const { html } = render(hostil);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'no debe quedar el tag crudo');
    assert.ok(html.includes('&lt;script&gt;'), 'debe quedar escapado');
});

check('C2 . un movimiento historico con comillas/ángulos en el detalle queda escapado', () => {
    const hostil = JSON.parse(JSON.stringify(snapshotCompleto));
    hostil.data.historicos = [{ fecha: '01/01/2020', tipo: 'X', detalle: '"><img src=x onerror=alert(1)>' }];
    const { html } = render(hostil);
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'no debe quedar el tag crudo');
});

// ---------------------------------------------------------------------------
console.log('\nD. Saltos de linea internos (intervinientes trae "TIPO\\nNOMBRE")');
// ---------------------------------------------------------------------------
check('D1 . el salto de linea interno se preserva con white-space:pre-wrap, no se pierde', () => {
    const { html } = render(snapshotCompleto);
    // El primer interviniente del fixture tiene un '\n' real adentro del string.
    assert.ok(html.includes('white-space:pre-wrap'), 'debe usar pre-wrap para no perder el salto interno');
});

console.log('\n' + ok + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
