/**
 * Verifica que la normalización de expedientes del lado Electron siga coincidiendo
 * con la canónica del backend (Bitácora F1.1).
 *
 *   node electron-app/test/tokenizar-fixture.test.js
 *
 * Ejercita el MISMO fixture que backend-server/test/expedienteKey.test.js
 * (tests/fixtures/expediente-key-cases.json). Si alguien toca la normalización de
 * un solo lado, uno de los dos tests falla — que es exactamente para lo que existe.
 *
 * ⚠️ `tokenizar` no se exporta desde buscarPdfExpediente.js (es interna a ese
 * módulo, que expone solo buscarPdfExpediente). Para no cambiar la superficie
 * pública de un archivo que ya está en producción enlazando PDFs, el test la
 * extrae del fuente y la evalúa. Es más frágil que un require, pero no toca
 * código que hoy funciona — y si el día de mañana se exporta, este test se
 * simplifica a un require.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'expediente-key-cases.json');
const FUENTE = path.join(__dirname, '..', 'informe', 'buscarPdfExpediente.js');

const { casos } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Extraer la función `tokenizar` del módulo real, sin modificarlo.
const fuente = fs.readFileSync(FUENTE, 'utf8');
const match = fuente.match(/function tokenizar\(texto\)\s*\{[\s\S]*?\n\}/);
if (!match) {
    console.error('❌ No se encontró `function tokenizar(texto)` en buscarPdfExpediente.js.');
    console.error('   Si se renombró o se movió, actualizar este test (y verificar que la');
    console.error('   normalización siga coincidiendo con backend-server/utils/expedienteKey.js).');
    process.exit(1);
}
// eslint-disable-next-line no-eval
const tokenizar = eval(`(${match[0].replace('function tokenizar', 'function')})`);

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

console.log(`\n🔑 tokenizar() de Electron vs. fixture compartido — ${casos.length} casos\n`);

for (const caso of casos) {
    // El fixture incluye la cadena vacía y variantes que del lado Electron no se
    // dan (allí la entrada siempre es un nombre de archivo o un expediente ya
    // validado), pero se verifican igual: si el comportamiento difiere para
    // CUALQUIER string, las implementaciones derivaron.
    check(`${JSON.stringify(caso.input)} → ${JSON.stringify(caso.key)}`, () => {
        assert.deepStrictEqual(tokenizar(caso.input), caso.tokens, 'tokens');
        assert.strictEqual(tokenizar(caso.input).join('|'), caso.key, 'clave');
    });
}

console.log(`\n${ok} PASS, ${fail} FAIL`);
if (fail > 0) {
    console.error('\n⚠️  Las dos implementaciones DERIVARON.');
    console.error('   Comparar electron-app/informe/buscarPdfExpediente.js (tokenizar)');
    console.error('   contra backend-server/utils/expedienteKey.js (canónica) y alinearlas.\n');
}
process.exit(fail > 0 ? 1 : 0);
