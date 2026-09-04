/**
 * verify-e14-scripts-por-plan.js — criterio de aceptación de la fase E14
 * (C.1 capa 3: "módulos por plan").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ ES ESTO Y CONTRA QUÉ CORRE
 * ═══════════════════════════════════════════════════════════════════════════
 * Tres capas, de la más barata a la más cara:
 *
 *   §1  Las TRES consultas SQL se leen del `routes/client.js` REAL (no una copia
 *       pegada acá) y se EJECUTAN contra un motor relacional de verdad —`node:sqlite`,
 *       módulo interno de Node, sin instalar nada—, sobre tablas `users`,
 *       `subscriptions` y `plans` creadas para la corrida. Esto es lo que prueba el
 *       riesgo que la ficha marca como "lo que más fácil se rompe": que el
 *       `LEFT JOIN plans` sea LEFT y no interno, que no haya columna ambigua, y que
 *       `plan_type`/`payment_provider` lleguen de verdad. Con un stub de la base eso
 *       no se puede probar: el stub devuelve lo que uno le diga.
 *
 *       ⚠️ HONESTIDAD SOBRE EL ALCANCE: SQLite NO es PostgreSQL. La traducción está
 *       acotada y declarada (`NOW()` → `CURRENT_TIMESTAMP`, `$1` → `?`) y se verifica
 *       que sea reversible. Lo que esta capa demuestra es la ESTRUCTURA del JOIN y la
 *       semántica de NULL, no el dialecto. La corrida contra Postgres real queda para
 *       staging.
 *
 *   §2  `scriptsPermitidos()` unitario contra la tabla de la spec C.1 capa 3.
 *
 *   §3  HTTP real contra el router REAL de `routes/client.js`, montado en un Express
 *       local. Lo único falso es el pool de PostgreSQL, que acá está respaldado por la
 *       MISMA base SQLite de §1: las filas que ve el endpoint son las que un motor
 *       relacional devolvió, no las que un stub inventó. `/scripts/download` llega
 *       hasta el 200 completo (descifrado AES real, marca de agua HMAC real, firma RSA
 *       real con un par efímero de la corrida).
 *
 * ⚠️ NUNCA toca producción ni staging: no abre sockets salientes, no lee ningún `.env`
 * del servidor, y genera sus propias claves (JWT, AES, RSA, WM) por corrida.
 *
 *   node dev-tools/verify-e14-scripts-por-plan.js
 */

const crypto = require('crypto');

// ─── Secretos propios de la corrida (nada del servidor) ────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'e14-harness-' + crypto.randomBytes(24).toString('hex');
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.WM_SECRET = crypto.randomBytes(32).toString('hex');
{
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    process.env.RSA_PRIVATE_KEY = privateKey;
    process.env.RSA_PUBLIC_KEY = publicKey;
}

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');

const { scriptsPermitidos, SCRIPTS_DISTRIBUIBLES, HELPERS_SIEMPRE } =
    require('../utils/scriptsDistribuibles');

// ─── Contador ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const fallas = [];
function check(desc, cond, detalle) {
    if (cond) { pass++; console.log('  [PASS] ' + desc); }
    else { fail++; fallas.push(desc); console.log('  [FAIL] ' + desc + (detalle ? ' -> ' + detalle : '')); }
}
function seccion(t) { console.log('\n' + '-'.repeat(74) + '\n' + t + '\n' + '-'.repeat(74)); }

// ═══════════════════════════════════════════════════════════════════════════
//  Extraer las 3 consultas del routes/client.js REAL
// ═══════════════════════════════════════════════════════════════════════════
const CLIENT_JS = fs.readFileSync(path.join(__dirname, '..', 'routes', 'client.js'), 'utf8');

function cuerpoDeRuta(marcador) {
    const i = CLIENT_JS.indexOf(marcador);
    if (i === -1) throw new Error('No encontre la ruta ' + marcador + ' en routes/client.js');
    const j = CLIENT_JS.indexOf('\nrouter.', i + 10);
    return CLIENT_JS.slice(i, j === -1 ? CLIENT_JS.length : j);
}
function sqlDeSuscripcion(marcador) {
    const cuerpo = cuerpoDeRuta(marcador);
    const m = cuerpo.match(/const subResult = await db\.query\(`([\s\S]*?)`/);
    if (!m) throw new Error('No encontre la consulta de suscripcion en ' + marcador);
    return m[1].trim();
}

const SQL = {
    check: sqlDeSuscripcion("router.get('/scripts/check/:scriptName'"),
    download: sqlDeSuscripcion("router.get('/scripts/download/:scriptName'"),
    available: sqlDeSuscripcion("router.get('/scripts/available'"),
};

// ═══════════════════════════════════════════════════════════════════════════
//  §1 — Las consultas reales, ejecutadas en un motor relacional real
// ═══════════════════════════════════════════════════════════════════════════
seccion('1. Las 3 consultas de routes/client.js, EJECUTADAS (node:sqlite)');

// Traduccion acotada y declarada. Cualquier otra diferencia de dialecto haria
// fallar la consulta aca, que es justamente lo que queremos que pase.
function aSqlite(sql) {
    return sql.replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\$1/g, '?');
}

const db = new DatabaseSync(':memory:');
db.exec(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        registration_status TEXT NOT NULL,
        -- B.7 (E5): el gate requireLegalOk consulta esta columna en /scripts/check y
        -- /scripts/download. Sin ella el middleware cae a su rama fail-open y el
        -- harness estaria probando el camino de error, no el real.
        legal_suspended INTEGER
    );
    CREATE TABLE plans (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        plan_type TEXT
    );
    CREATE TABLE subscriptions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        plan TEXT NOT NULL,
        plan_id INTEGER,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        payment_provider TEXT,
        -- subscriptions_user_id_key UNIQUE (user_id) -- schema.sql:2095. Es lo que
        -- hace deterministico el rows[0] del que ahora dependen los tres guards:
        -- como mucho puede haber UNA suscripcion por usuario, asi que no existe el
        -- caso "cual de las dos filas gano". Se replica aca para que el harness
        -- enforce la misma invariante que Postgres.
        UNIQUE (user_id)
    );
    CREATE TABLE encrypted_scripts (
        script_name TEXT PRIMARY KEY,
        encrypted_content TEXT,
        iv TEXT,
        hash TEXT,
        version TEXT,
        active INTEGER
    );
`);

// Planes reales (scripts/insert_plans.sql) + el legado 'electron' + uno sin tipo.
db.exec(`
    INSERT INTO plans (id, name, plan_type) VALUES
        (1, 'EXTENSION_PROMO', 'extension'),
        (2, 'COMBO_PROMO',     'combo'),
        (3, 'LEGADO_ELECTRON', 'electron'),
        (4, 'PLAN_SIN_TIPO',    NULL);
`);

const FUTURO = '2099-01-01 00:00:00';
const PASADO = '2000-01-01 00:00:00';
const U = {
    TRIAL_COMBO:    { id: 10, plan_id: 2,    pp: null,          exp: FUTURO, reg: 'pending_activation', st: 'suspended' },
    TRIAL_SIN_PLAN: { id: 11, plan_id: null, pp: null,          exp: FUTURO, reg: 'pending_activation', st: 'suspended' },
    TRIAL_EXT:      { id: 12, plan_id: 1,    pp: null,          exp: FUTURO, reg: 'pending_activation', st: 'suspended' },
    PAGO_COMBO:     { id: 20, plan_id: 2,    pp: 'mercadopago', exp: FUTURO, reg: 'active',             st: 'active' },
    PAGO_ELECTRON:  { id: 21, plan_id: 3,    pp: 'mercadopago', exp: FUTURO, reg: 'active',             st: 'active' },
    PAGO_EXT:       { id: 22, plan_id: 1,    pp: 'mercadopago', exp: FUTURO, reg: 'active',             st: 'active' },
    PAGO_SIN_TIPO:  { id: 23, plan_id: 4,    pp: 'mercadopago', exp: FUTURO, reg: 'active',             st: 'active' },
    VENCIDO:        { id: 30, plan_id: 2,    pp: 'mercadopago', exp: PASADO, reg: 'active',             st: 'active' },
};
{
    // legal_suspended = 0 (no suspendido). SQLite no tiene BOOLEAN nativo y el
    // middleware compara con === true, asi que 0/1 caeria a next() igual; se pone
    // explicito para que la consulta encuentre la columna y no use el fail-open.
    const iu = db.prepare('INSERT INTO users (id, registration_status, legal_suspended) VALUES (?, ?, 0)');
    const is = db.prepare(
        'INSERT INTO subscriptions (user_id, plan, plan_id, status, expires_at, payment_provider) VALUES (?, ?, ?, ?, ?, ?)');
    for (const nombre of Object.keys(U)) {
        const u = U[nombre];
        iu.run(u.id, u.reg);
        is.run(u.id, nombre, u.plan_id, u.st, u.exp, u.pp);
    }
}

// La traduccion es visible y reversible, no un secreto del harness.
for (const nombre of Object.keys(SQL)) {
    const sql = SQL[nombre];
    const t = aSqlite(sql);
    check(nombre + ': la traduccion a SQLite toca solo NOW()/$1 y es reversible',
        t.replace(/CURRENT_TIMESTAMP/g, 'NOW()').replace(/\?/g, '$1') === sql);
    check(nombre + ': la consulta trae el LEFT JOIN a plans',
        /LEFT JOIN plans p ON p\.id = s\.plan_id/.test(sql), sql.replace(/\s+/g, ' ').slice(0, 90));
}

function correr(nombre, userId) {
    return db.prepare(aSqlite(SQL[nombre])).all(userId);
}

// (a) Las tres consultas son SQL valido y no tienen columna ambigua.
for (const nombre of ['check', 'download', 'available']) {
    let ok = true, err = '';
    try { correr(nombre, U.PAGO_COMBO.id); } catch (e) { ok = false; err = e.message; }
    check(nombre + ': la consulta es SQL valido y sin ambiguedad', ok, err);
}

// (b) El LEFT JOIN: una suscripcion con plan_id NULL SIGUE devolviendo su fila.
//     Es el riesgo que la ficha marca en primer lugar.
for (const nombre of ['check', 'download', 'available']) {
    const filas = correr(nombre, U.TRIAL_SIN_PLAN.id);
    check(nombre + ': plan_id NULL devuelve fila igual (LEFT JOIN)', filas.length === 1,
        'filas=' + filas.length);
    check(nombre + ': y su plan_type llega NULL, no ausente',
        filas.length === 1 && filas[0].plan_type === null,
        filas.length ? JSON.stringify(filas[0].plan_type) : 'sin fila');
}

// (c) CONTROL NEGATIVO: con JOIN interno la misma fila DESAPARECE. Si esto no
//     fallara, el check (b) no probaria nada.
for (const nombre of ['check', 'download', 'available']) {
    const interno = aSqlite(SQL[nombre]).replace(/LEFT JOIN plans/g, 'JOIN plans');
    check(nombre + ': control negativo - con JOIN interno el trial sin plan se pierde',
        db.prepare(interno).all(U.TRIAL_SIN_PLAN.id).length === 0);
}

// (d) Las columnas nuevas llegan con el valor correcto.
const espera = {
    TRIAL_COMBO: ['combo', null], TRIAL_EXT: ['extension', null],
    PAGO_COMBO: ['combo', 'mercadopago'], PAGO_ELECTRON: ['electron', 'mercadopago'],
    PAGO_EXT: ['extension', 'mercadopago'], PAGO_SIN_TIPO: [null, 'mercadopago'],
};
for (const quien of Object.keys(espera)) {
    const pt = espera[quien][0], pp = espera[quien][1];
    for (const nombre of ['check', 'download', 'available']) {
        const f = correr(nombre, U[quien].id)[0];
        check(nombre + '/' + quien + ': plan_type=' + pt + ' payment_provider=' + pp,
            !!f && f.plan_type === pt && f.payment_provider === pp,
            f ? 'got ' + f.plan_type + '/' + f.payment_provider : 'sin fila');
    }
}

// (e) No-regresion: el filtro de suscripcion viva sigue cortando lo que cortaba.
for (const nombre of ['check', 'download', 'available']) {
    check(nombre + ': suscripcion vencida sigue sin devolver fila',
        correr(nombre, U.VENCIDO.id).length === 0);
    check(nombre + ': usuario inexistente sigue sin devolver fila',
        correr(nombre, 999).length === 0);
}

// (e-bis) NINGUNA de las tres consultas puede devolver mas de una fila. `plans.id`
//     es PK y `subscriptions.user_id` es UNIQUE, asi que el LEFT JOIN no puede
//     multiplicar filas. Importa porque los tres guards leen `rows[0]`.
for (const nombre of ['check', 'download', 'available']) {
    let maxFilas = 0;
    for (const quien of Object.keys(U)) maxFilas = Math.max(maxFilas, correr(nombre, U[quien].id).length);
    check(nombre + ': el LEFT JOIN nunca multiplica filas (rows[0] es deterministico)',
        maxFilas <= 1, 'max=' + maxFilas);
}

// (f) `available` conserva `s.plan`, que la respuesta ya devolvia.
check('available: sigue trayendo s.plan (la respuesta lo usa)',
    correr('available', U.PAGO_COMBO.id)[0].plan === 'PAGO_COMBO');

// (g) `download` usa `s.*`: tiene que seguir trayendo las columnas de subscriptions.
{
    const f = correr('download', U.PAGO_COMBO.id)[0];
    check('download: `s.*` sigue trayendo las columnas de subscriptions',
        f.status === 'active' && f.user_id === U.PAGO_COMBO.id && f.plan_id === 2);
    check('download: `plan_type` no piso ninguna columna de subscriptions',
        ('plan' in f) && ('plan_id' in f) && ('plan_type' in f) && f.plan === 'PAGO_COMBO');
}

// ═══════════════════════════════════════════════════════════════════════════
//  §2 — scriptsPermitidos() contra la tabla de la spec
// ═══════════════════════════════════════════════════════════════════════════
seccion('2. scriptsPermitidos(): la tabla de C.1 capa 3');

const TODOS = 13;
const casos = [
    ['trial con plan combo',            { payment_provider: null, plan_type: 'combo' },              TODOS],
    ['trial sin plan (plan_type NULL)', { payment_provider: null, plan_type: null },                 TODOS],
    ['trial con plan extension',        { payment_provider: null, plan_type: 'extension' },          TODOS],
    ['pago combo',                      { payment_provider: 'mercadopago', plan_type: 'combo' },     TODOS],
    ['pago electron (legado)',          { payment_provider: 'mercadopago', plan_type: 'electron' },  TODOS],
    ['pago EXTENSION_PROMO',            { payment_provider: 'mercadopago', plan_type: 'extension' }, 0],
    ['pago con plan_type NULL',         { payment_provider: 'mercadopago', plan_type: null },        TODOS],
    ['sin fila de suscripcion',         undefined,                                                   0],
];
for (const c of casos) {
    check(c[0] + ' -> ' + c[2] + ' scripts', scriptsPermitidos(c[1]).size === c[2],
        'got ' + scriptsPermitidos(c[1]).size);
}

// Normalizacion defensiva: el CHECK del schema guarda minusculas, pero un dato
// con espacios o mayusculas no debe abrir el paso.
for (const v of ['EXTENSION', ' extension ', 'Extension']) {
    check('pago con plan_type ' + JSON.stringify(v) + ' sigue denegado',
        scriptsPermitidos({ payment_provider: 'mercadopago', plan_type: v }).size === 0);
}

check('los 3 helpers estan dentro de la lista maestra (la clausura es no-op hoy)',
    HELPERS_SIEMPRE.every(h => SCRIPTS_DISTRIBUIBLES.has(h)));
check('a un plan `extension` NO se le cuela ningun helper',
    HELPERS_SIEMPRE.every(h =>
        !scriptsPermitidos({ payment_provider: 'mercadopago', plan_type: 'extension' }).has(h)));
check('un plan que SI recibe scripts recibe tambien sus 3 helpers',
    HELPERS_SIEMPRE.every(h =>
        scriptsPermitidos({ payment_provider: 'mercadopago', plan_type: 'combo' }).has(h)));
check('el llamador no puede mutar la lista maestra',
    (function () {
        scriptsPermitidos({ payment_provider: null }).add('backup-db.js');
        return SCRIPTS_DISTRIBUIBLES.size === 13 && !SCRIPTS_DISTRIBUIBLES.has('backup-db.js');
    })());

// ═══════════════════════════════════════════════════════════════════════════
//  §3 — HTTP real contra el router real
// ═══════════════════════════════════════════════════════════════════════════
seccion('3. HTTP real contra routes/client.js (pool respaldado por la base de la §1)');

// Los 7 de operacion que E1 dejo fuera de la whitelist (no-regresion).
const OPERACION = ['backup-db.js', 'health-check.js', 'data-retention.js',
    'canary-test.js', 'test_registro.js', 'validarCampoParteScwpjn.js', 'reset-admin-password.js'];

// Poblar `encrypted_scripts` con contenido cifrado REAL (mismo AES-256-CBC que
// `utils/scriptEncryption.js`), para que /download llegue al 200 de verdad.
{
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const ins = db.prepare(
        'INSERT INTO encrypted_scripts (script_name, encrypted_content, iv, hash, version, active) VALUES (?,?,?,?,?,1)');
    const todos = Array.from(SCRIPTS_DISTRIBUIBLES).concat(OPERACION);
    for (const name of todos) {
        const code = '// fixture ' + name + '\nmodule.exports = ' + JSON.stringify(name) + ';\n';
        const iv = crypto.randomBytes(16);
        const c = crypto.createCipheriv('aes-256-cbc', key, iv);
        const enc = c.update(code, 'utf8', 'hex') + c.final('hex');
        ins.run(name, enc, iv.toString('hex'),
            crypto.createHash('sha256').update(code).digest('hex'), '1.0.0');
    }
}

// Pool falso: traduce a SQLite y ejecuta contra la base real de la §1. Registra
// las consultas para poder distinguir "el guard corto" de "el guard dejo pasar".
const consultas = [];
const dbStub = {
    query: async (sql, params) => {
        params = params || [];
        consultas.push(sql);
        const t = aSqlite(sql).replace(/\$(\d+)/g, '?');
        const s = db.prepare(t);
        if (/^\s*(SELECT|WITH)/i.test(t)) return { rows: s.all.apply(s, params) };
        const r = s.run.apply(s, params);
        return { rows: [], rowCount: r.changes };
    },
};

const app = express();
app.set('db', dbStub);
app.use(express.json());
app.use('/client', require('../routes/client'));

const server = http.createServer(app);

function tok(userId) {
    return jwt.sign({ id: userId, email: 'u' + userId + '@test.local', role: 'user' },
        process.env.JWT_SECRET, { expiresIn: '10m' });
}

function pedir(puerto, ruta, userId) {
    return new Promise((res, rej) => {
        const r = http.request({
            host: '127.0.0.1', port: puerto, path: ruta, method: 'GET',
            headers: { Authorization: 'Bearer ' + tok(userId) },
        }, resp => {
            let b = '';
            resp.on('data', d => { b += d; });
            resp.on('end', () => {
                let j = null;
                try { j = JSON.parse(b); } catch (_) { /* respuesta no-JSON */ }
                res({ status: resp.statusCode, body: j, raw: b });
            });
        });
        r.on('error', rej);
        r.end();
    });
}

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // Escenario -> cuantos scripts le corresponden.
    const escenarios = [
        ['TRIAL_COMBO', 13], ['TRIAL_SIN_PLAN', 13], ['TRIAL_EXT', 13],
        ['PAGO_COMBO', 13], ['PAGO_ELECTRON', 13], ['PAGO_SIN_TIPO', 13],
        ['PAGO_EXT', 0],
    ];

    // ── /scripts/available ────────────────────────────────────────────────
    console.log('\n  /scripts/available');
    for (const e of escenarios) {
        const r = await pedir(port, '/client/scripts/available', U[e[0]].id);
        const n = r.body && r.body.scripts ? r.body.scripts.length : -1;
        check('available/' + e[0] + ': 200 con ' + e[1] + ' scripts',
            r.status === 200 && n === e[1], 'status=' + r.status + ' n=' + n);
    }
    {
        const r = await pedir(port, '/client/scripts/available', U.PAGO_EXT.id);
        check('available/PAGO_EXT: la lista viene VACIA, ni siquiera con los helpers',
            r.status === 200 && r.body.scripts.length === 0 && r.raw.indexOf('sessionManager') === -1,
            r.raw.slice(0, 120));
    }
    {
        const r = await pedir(port, '/client/scripts/available', U.VENCIDO.id);
        check('available/VENCIDO: sigue en 403 (no-regresion)', r.status === 403, 'status=' + r.status);
    }
    {
        const r = await pedir(port, '/client/scripts/available', U.PAGO_COMBO.id);
        const nombres = r.body.scripts.map(s => s.name);
        check('available/PAGO_COMBO: no lista ningun script de operacion',
            OPERACION.every(o => nombres.indexOf(o) === -1), nombres.join(','));
        check('available/PAGO_COMBO: los 3 helpers estan listados',
            HELPERS_SIEMPRE.every(h => nombres.indexOf(h) !== -1));
    }

    // ── /scripts/check ────────────────────────────────────────────────────
    console.log('\n  /scripts/check');
    for (const e of escenarios) {
        const r = await pedir(port, '/client/scripts/check/testM2.js', U[e[0]].id);
        const esperado = e[1] > 0 ? 200 : 404;
        check('check/' + e[0] + ': testM2.js -> ' + esperado, r.status === esperado, 'status=' + r.status);
    }
    {
        let todos404 = true, primerFallo = '';
        for (const s of SCRIPTS_DISTRIBUIBLES) {
            const r = await pedir(port, '/client/scripts/check/' + s, U.PAGO_EXT.id);
            if (r.status !== 404) { todos404 = false; primerFallo = s + '->' + r.status; break; }
        }
        check('check/PAGO_EXT: los 13 distribuibles dan 404', todos404, primerFallo);
    }
    {
        // Sin `.js` (el cliente puede pedir cualquiera de las dos formas).
        const a = await pedir(port, '/client/scripts/check/testM2', U.PAGO_EXT.id);
        const b = await pedir(port, '/client/scripts/check/testM2', U.PAGO_COMBO.id);
        check('check: la normalizacion sin `.js` respeta el plan (ext 404 / combo 200)',
            a.status === 404 && b.status === 200, 'ext=' + a.status + ' combo=' + b.status);
    }
    {
        let ok = true, cual = '';
        for (const o of OPERACION) {
            const r = await pedir(port, '/client/scripts/check/' + o, U.PAGO_COMBO.id);
            if (r.status !== 404) { ok = false; cual = o + '->' + r.status; break; }
        }
        check('check/PAGO_COMBO: los 7 de operacion siguen en 404 (no-regresion E1/F6)', ok, cual);
    }
    {
        // El guard corta ANTES de tocar encrypted_scripts: el 404 no confirma
        // que el script exista en el servidor.
        consultas.length = 0;
        await pedir(port, '/client/scripts/check/testM2.js', U.PAGO_EXT.id);
        check('check/PAGO_EXT: ni siquiera consulta encrypted_scripts (no filtra existencia)',
            !consultas.some(q => /encrypted_scripts/i.test(q)), consultas.length + ' consultas');
    }

    // ── /scripts/download ─────────────────────────────────────────────────
    console.log('\n  /scripts/download');
    {
        const r = await pedir(port, '/client/scripts/download/testM2.js', U.PAGO_COMBO.id);
        check('download/PAGO_COMBO: 200 con contenido, hash y firma',
            r.status === 200 && !!(r.body && r.body.script && r.body.script.content) &&
            !!(r.body && r.body.security && r.body.security.signature),
            'status=' + r.status + ' ' + r.raw.slice(0, 140));
        check('download/PAGO_COMBO: el contenido llega con marca de agua',
            /\/\/ wm:[0-9a-f]{32}\n$/.test((r.body && r.body.script && r.body.script.content) || ''));
        if (r.status === 200) {
            const v = crypto.createVerify('RSA-SHA256');
            v.update(r.body.security.checksum);
            check('download/PAGO_COMBO: la firma RSA verifica (cadena intacta)',
                v.verify(process.env.RSA_PUBLIC_KEY, r.body.security.signature, 'base64'));
        } else {
            check('download/PAGO_COMBO: la firma RSA verifica (cadena intacta)', false, 'no hubo 200');
        }
    }
    for (const e of escenarios) {
        const r = await pedir(port, '/client/scripts/download/testM2.js', U[e[0]].id);
        const esperado = e[1] > 0 ? 200 : 404;
        check('download/' + e[0] + ': testM2.js -> ' + esperado, r.status === esperado, 'status=' + r.status);
    }
    {
        let todos404 = true, primerFallo = '';
        for (const s of SCRIPTS_DISTRIBUIBLES) {
            const r = await pedir(port, '/client/scripts/download/' + s, U.PAGO_EXT.id);
            if (r.status !== 404) { todos404 = false; primerFallo = s + '->' + r.status; break; }
        }
        check('download/PAGO_EXT: los 13 distribuibles dan 404 (criterio de la ficha)',
            todos404, primerFallo);
    }
    {
        consultas.length = 0;
        await pedir(port, '/client/scripts/download/testM2.js', U.PAGO_EXT.id);
        check('download/PAGO_EXT: no descifra nada (corta antes de encrypted_scripts)',
            !consultas.some(q => /encrypted_scripts/i.test(q)), consultas.length + ' consultas');
    }
    {
        let ok = true, cual = '';
        for (const o of OPERACION) {
            const r = await pedir(port, '/client/scripts/download/' + o, U.PAGO_COMBO.id);
            if (r.status !== 404) { ok = false; cual = o + '->' + r.status; break; }
        }
        check('download/PAGO_COMBO: los 7 de operacion siguen en 404 (no-regresion E1)', ok, cual);
    }
    {
        const r = await pedir(port, '/client/scripts/download/testM2.js', U.VENCIDO.id);
        check('download/VENCIDO: sigue en 403 (no-regresion)', r.status === 403, 'status=' + r.status);
    }

    // ── Coherencia entre los tres ─────────────────────────────────────────
    console.log('\n  Coherencia available <-> check <-> download');
    for (const quien of ['TRIAL_EXT', 'PAGO_COMBO', 'PAGO_EXT']) {
        const av = await pedir(port, '/client/scripts/available', U[quien].id);
        const listados = new Set(((av.body && av.body.scripts) || []).map(s => s.name));
        let coherente = true, detalle = '';
        for (const s of SCRIPTS_DISTRIBUIBLES) {
            const d = await pedir(port, '/client/scripts/download/' + s, U[quien].id);
            const c = await pedir(port, '/client/scripts/check/' + s, U[quien].id);
            const deberia = listados.has(s);
            if ((d.status === 200) !== deberia || (c.status === 200) !== deberia) {
                coherente = false;
                detalle = s + ': listado=' + deberia + ' download=' + d.status + ' check=' + c.status;
                break;
            }
        }
        check(quien + ': lo que available lista es exactamente lo que check/download entregan',
            coherente, detalle);
    }

    server.close();
    db.close();

    seccion('RESULTADO: ' + pass + ' PASS / ' + fail + ' FAIL');
    if (fail) { console.log('\nFallas:\n  - ' + fallas.join('\n  - ')); }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n[ERROR]', e); process.exit(1); });
