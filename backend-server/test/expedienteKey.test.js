/**
 * Test de la normalización canónica de expedientes (Bitácora F1.1).
 *
 *   node backend-server/test/expedienteKey.test.js
 *
 * Ejercita el fixture COMPARTIDO con Electron (tests/fixtures/expediente-key-cases.json).
 * Su contraparte es electron-app/test/tokenizar-fixture.test.js: si las dos
 * implementaciones divergen, uno de los dos falla.
 */

const assert = require('assert');
const path = require('path');
const { tokenizar, expedienteKey, esExpedienteValido } = require('../utils/expedienteKey');

const FIXTURE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'expediente-key-cases.json');
const { casos } = require(FIXTURE);

let ok = 0;
let fail = 0;

function check(nombre, fn) {
    try {
        fn();
        console.log(`  ✅ ${nombre}`);
        ok++;
    } catch (e) {
        console.error(`  ❌ ${nombre}\n     ${e.message}`);
        fail++;
    }
}

console.log(`\n🔑 Normalización de expedientes — ${casos.length} casos del fixture compartido\n`);

for (const caso of casos) {
    check(`${JSON.stringify(caso.input)} → ${JSON.stringify(caso.key)}  · ${caso.descripcion}`, () => {
        assert.deepStrictEqual(tokenizar(caso.input), caso.tokens, 'tokenizar()');
        assert.strictEqual(expedienteKey(caso.input), caso.key, 'expedienteKey()');
    });
}

console.log('\n🛡️  Robustez de la entrada (el backend recibe datos por HTTP)\n');

check('null no lanza, devuelve clave vacía', () => {
    assert.strictEqual(expedienteKey(null), '');
});
check('undefined no lanza, devuelve clave vacía', () => {
    assert.strictEqual(expedienteKey(undefined), '');
});
check('un número no lanza (se coacciona a string)', () => {
    assert.strictEqual(expedienteKey(18745), '18745');
});

console.log('\n🎯 La propiedad que sostiene la deduplicación\n');

check('las dos formas del MISMO expediente producen la misma clave', () => {
    assert.strictEqual(
        expedienteKey('FCR 018745/2017'),
        expedienteKey('FCR 18745/2017'),
        'el padding de ceros no debe generar dos fichas'
    );
});
check('expedientes distintos producen claves distintas', () => {
    assert.notStrictEqual(expedienteKey('FCR 18745/2017'), expedienteKey('FCR 118745/2017'));
    assert.notStrictEqual(expedienteKey('FCR 18745/2017'), expedienteKey('CAF 18745/2017'));
    assert.notStrictEqual(expedienteKey('FCR 18745/2017'), expedienteKey('FCR 18745/2018'));
});
check('esExpedienteValido rechaza lo que no produce clave', () => {
    assert.strictEqual(esExpedienteValido('FCR 18745/2017'), true);
    assert.strictEqual(esExpedienteValido(''), false);
    assert.strictEqual(esExpedienteValido('   '), false);
    assert.strictEqual(esExpedienteValido(null), false);
});

console.log(`\n${ok} PASS, ${fail} FAIL\n`);
process.exit(fail > 0 ? 1 : 0);
