/**
 * Verifica el extractor de movimientos del informe (Bitácora: el snapshot quedaba vacío).
 *
 *   node electron-app/test/movimientosInforme.test.js
 *
 * DATOS REALES, NO FABRICADOS
 * ---------------------------
 * El grupo A corre contra el `listaMovimientos.json` REAL que dejó una corrida de
 * informe en esta máquina. Ese archivo NO se versiona: trae la carátula y el nombre
 * de una parte real (mismo criterio que ya se aplicó a las capturas de la demo). Si
 * no está, el grupo A se SALTEA con aviso — y el resumen lo dice, para que "todo
 * verde" no se confunda con "se probó contra datos reales".
 *
 * El grupo B arma árboles de directorios temporales para los caminos que no se
 * pueden provocar con el archivo real (mtime viejo, JSON corrupto, varios `_temp`).
 *
 * CONTROLES NEGATIVOS
 * -------------------
 * B4/B5/B6/B7/B8 existen para que el test pueda FALLAR: comprueban que el extractor
 * devuelve `[]` cuando debe (backup viejo, expediente ajeno, JSON roto, sin backup).
 * Sin ellos, un extractor que devolviera siempre el primer archivo que encuentra
 * pasaría igual, y el test no probaría nada.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { leerMovimientosInforme, MAX_MOVS_DEFAULT } = require('../informe/movimientosInforme');

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

    check('A5 . el lote real entra en el presupuesto de 256 KB del borrador', () => {
        // captureDrafts.js rechaza ENTERO un borrador > 256 KB. Con el tope de 15,
        // 200 casos (MAX_CASOS_CAPTURE_LOTE) tienen que seguir entrando.
        const uno = leerMovimientosInforme(REAL, REAL_EXP);
        const bytes = Buffer.byteLength(JSON.stringify(uno), 'utf8') * 200;
        assert.ok(bytes < 256 * 1024, '200 casos medirian ' + Math.round(bytes / 1024) + ' KB (tope 256 KB)');
    });
} else {
    omitir('A1-A5 . datos reales', 'no existe ' + backupReal);
}

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

console.log('\n' + ok + ' PASS, ' + fail + ' FAIL' + (skip ? ', ' + skip + ' OMITIDO' : ''));
if (skip) console.log('AVISO: se saltearon casos con datos reales: el resultado NO cubre el archivo real.');
process.exit(fail > 0 ? 1 : 0);
