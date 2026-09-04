/**
 * Verificación funcional de E11 (llave de captura) y E14 (scripts por plan) contra
 * el PROCESO REAL de staging, ya reiniciado con el código nuevo — no un stub, no
 * node:sqlite. El propósito es distinto al de los harnesses locales de cada fase
 * (que ya corrieron 57/57 y 102/102): acá lo que importa es que la consulta
 * LEFT JOIN de E14 y los endpoints nuevos de E11 funcionen contra el Postgres real
 * de staging, con sus columnas y tipos reales.
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'. Nunca contra producción.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-e11-e14-staging-live.js dotenv_config_path=.env.staging
 *
 * Crea sus propios usuarios/plan efímeros y los borra al terminar (pase lo que pase).
 */

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging".`);
    process.exit(1);
}

const BASE = 'https://localhost:3444';
const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

let ok = 0, fail = 0;
const assert = require('assert');
function check(nombre, fn) {
    try { fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}
async function checkAsync(nombre, fn) {
    try { await fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}

function req(metodo, ruta, { token, form, json } = {}) {
    return new Promise((resolve, reject) => {
        let body = null, headers = {};
        if (form) { body = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
        if (json) { body = JSON.stringify(json); headers['Content-Type'] = 'application/json'; }
        if (body) headers['Content-Length'] = Buffer.byteLength(body);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const r = https.request(BASE + ruta, { method: metodo, headers, rejectUnauthorized: false }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

const stamp = Date.now();
const cleanupUserIds = [];
const cleanupPlanIds = [];

async function crearUsuario({ planName, planType, bitacoraEnabled, paymentProvider }) {
    const pRes = await pool.query(
        `INSERT INTO plans (name, display_name, active, visibility, plan_type, bitacora_enabled)
         VALUES ($1,$1,true,'private',$2,$3) RETURNING id`,
        [`QA_E11E14_${planName}_${stamp}`, planType, bitacoraEnabled]);
    const planId = pRes.rows[0].id;
    cleanupPlanIds.push(planId);

    const email = `qa-e11e14-${planName.toLowerCase()}-${stamp}@test.com`;
    const uRes = await pool.query(
        `INSERT INTO users (email, password_hash, nombre, registration_status, email_verified, role)
         VALUES ($1,'x','QA E11/E14','active',true,'user') RETURNING id`, [email]);
    const userId = uRes.rows[0].id;
    cleanupUserIds.push(userId);

    await pool.query(
        `INSERT INTO subscriptions (user_id, plan_id, plan, status, payment_provider, usage_count, usage_limit, expires_at)
         SELECT $1,$2,name,'active',$3,0,999999,NOW()+INTERVAL '30 days' FROM plans WHERE id=$2`,
        [userId, planId, paymentProvider || null]);

    const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { userId, planId, token, email };
}

async function main() {
    console.log('\nE11 + E14 — verificación contra el proceso REAL de staging (Postgres real)\n');

    // ═══════════════════════════════════════════════════════════════════════
    // E11 — llave de captura de 30 min
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── E11: llave de captura ──');

    const A = await crearUsuario({ planName: 'BITACORA_A', planType: 'combo', bitacoraEnabled: true });
    const B = await crearUsuario({ planName: 'BITACORA_B', planType: 'combo', bitacoraEnabled: true });
    console.log(`   fixture: usuario A=${A.userId}, usuario B=${B.userId}\n`);

    // 1. Emisión de la llave
    const emitRes = await req('POST', '/client/bitacora/capture-token', { token: A.token });
    let captureToken = null;
    await checkAsync('1. POST /client/bitacora/capture-token emite la llave (200, scope=capture, TTL=1800s)', async () => {
        assert.strictEqual(emitRes.status, 200, 'status ' + emitRes.status + ' ' + emitRes.body.slice(0, 200));
        const d = JSON.parse(emitRes.body);
        assert.ok(d.success && d.captureToken, 'sin captureToken: ' + emitRes.body);
        assert.strictEqual(d.expiresIn, 1800, 'expiresIn: ' + d.expiresIn);
        captureToken = d.captureToken;
        const payload = jwt.decode(captureToken);
        assert.strictEqual(payload.scope, 'capture', 'scope: ' + payload.scope);
        assert.strictEqual(String(payload.id), String(A.userId), 'id de la llave no es A');
        assert.ok(payload.jti, 'sin jti');
    });
    if (!captureToken) throw new Error('sin llave no se puede seguir la cadena de E11');

    // 2. La llave NO sirve como sesión
    const cuentaConLlave = await req('GET', '/client/account', { token: captureToken });
    check('2. la llave de captura contra /client/account → 401 (no es sesión)', () => {
        assert.strictEqual(cuentaConLlave.status, 401, 'status ' + cuentaConLlave.status + ' ' + cuentaConLlave.body.slice(0, 150));
    });

    // 3. POST /usuarios/capture con capture_token → borrador con dueño
    const postCapture = await req('POST', '/usuarios/capture', {
        form: { accion: 'ficha', origen: 'procuracion', capture_token: captureToken,
                exp: 'FCR 99999/2026', car: 'QA E11 c/ TEST s/VERIFY STAGING' }
    });
    let draftId = null;
    check('3. POST /usuarios/capture con llave válida → 303 con draft=', () => {
        assert.strictEqual(postCapture.status, 303, 'status ' + postCapture.status);
        const loc = postCapture.headers.location || '';
        assert.ok(!/captura=(error|lote_grande)/.test(loc), 'rechazada: ' + loc);
        draftId = new URLSearchParams(loc.split('?')[1] || '').get('draft');
        assert.ok(draftId, 'sin draft en ' + loc);
    });
    if (!draftId) throw new Error('sin draft no se puede seguir la cadena de E11');

    // 4. Usuario B (con SESIÓN propia) no puede reclamar el borrador de A
    const reclamoB = await req('GET', `/usuarios/api/capture-draft/${draftId}`, { token: B.token });
    check('4. usuario B con su sesión → 403 sobre el borrador de A (no lo destruye)', () => {
        assert.strictEqual(reclamoB.status, 403, 'status ' + reclamoB.status + ' ' + reclamoB.body.slice(0, 150));
    });

    // 5. El propio dueño (con la LLAVE) reclama su borrador
    const reclamoA = await req('GET', `/usuarios/api/capture-draft/${draftId}`, { token: captureToken });
    check('5. usuario A con SU llave → 200, reclama el borrador', () => {
        assert.strictEqual(reclamoA.status, 200, 'status ' + reclamoA.status + ' ' + reclamoA.body.slice(0, 200));
    });

    // 6. Un solo uso: la misma llave no reclama de nuevo
    const reclamoA2 = await req('GET', `/usuarios/api/capture-draft/${draftId}`, { token: captureToken });
    check('6. la misma llave reclamando de nuevo → 403 (blacklisteada, un solo uso)', () => {
        assert.strictEqual(reclamoA2.status, 403, 'status ' + reclamoA2.status + ' ' + reclamoA2.body.slice(0, 150));
    });

    // 7. Compatibilidad: visor viejo (sin capture_token) sigue funcionando
    const postSinLlave = await req('POST', '/usuarios/capture', {
        form: { accion: 'ficha', origen: 'procuracion', exp: 'FCR 88888/2026', car: 'QA sin llave' }
    });
    check('7. compatibilidad: POST sin capture_token sigue dando 303 (visor viejo)', () => {
        assert.strictEqual(postSinLlave.status, 303, 'status ' + postSinLlave.status);
        assert.ok(!/captura=error/.test(postSinLlave.headers.location || ''), 'rechazado: ' + postSinLlave.headers.location);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // E14 — scripts por plan
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n── E14: scripts por plan ──');

    const trial = await crearUsuario({ planName: 'TRIAL', planType: 'combo', bitacoraEnabled: false, paymentProvider: null });
    const comboPago = await crearUsuario({ planName: 'COMBOPAGO', planType: 'combo', bitacoraEnabled: false, paymentProvider: 'mercadopago' });
    const extPago = await crearUsuario({ planName: 'EXTPAGO', planType: 'extension', bitacoraEnabled: false, paymentProvider: 'mercadopago' });
    console.log(`   fixture: trial=${trial.userId}, combo pago=${comboPago.userId}, extension pago=${extPago.userId}\n`);

    const availTrial = await req('GET', '/client/scripts/available', { token: trial.token });
    let scriptsTrial = [];
    check('8. trial (sin payment_provider) → available lista scripts (>0)', () => {
        assert.strictEqual(availTrial.status, 200, 'status ' + availTrial.status + ' ' + availTrial.body.slice(0, 200));
        const d = JSON.parse(availTrial.body);
        scriptsTrial = d.scripts || d;
        assert.ok(Array.isArray(scriptsTrial) && scriptsTrial.length > 0, 'available vacío para trial: ' + availTrial.body.slice(0, 200));
    });

    const availCombo = await req('GET', '/client/scripts/available', { token: comboPago.token });
    check('9. combo PAGO → available devuelve los mismos scripts que el trial (13)', () => {
        assert.strictEqual(availCombo.status, 200, 'status ' + availCombo.status);
        const d = JSON.parse(availCombo.body);
        const scriptsCombo = d.scripts || d;
        assert.strictEqual(scriptsCombo.length, scriptsTrial.length, 'combo pago trae ' + scriptsCombo.length + ', trial trae ' + scriptsTrial.length);
    });

    const availExt = await req('GET', '/client/scripts/available', { token: extPago.token });
    check('10. [EL FIX] extension PAGO → available VACÍO (antes traía los 13)', () => {
        assert.strictEqual(availExt.status, 200, 'status ' + availExt.status + ' ' + availExt.body.slice(0, 200));
        const d = JSON.parse(availExt.body);
        const scriptsExt = d.scripts || d;
        assert.strictEqual(scriptsExt.length, 0, 'extension pago sigue viendo ' + scriptsExt.length + ' scripts: ' + JSON.stringify(scriptsExt));
    });

    if (scriptsTrial.length > 0) {
        const nombreScript = (scriptsTrial[0].name || scriptsTrial[0]).replace(/\.js$/, '');
        const dlExt = await req('GET', `/client/scripts/download/${nombreScript}`, { token: extPago.token });
        check(`11. [EL FIX] extension PAGO → download de "${nombreScript}" da 404`, () => {
            assert.strictEqual(dlExt.status, 404, 'status ' + dlExt.status + ' ' + dlExt.body.slice(0, 150));
        });

        const dlTrial = await req('GET', `/client/scripts/download/${nombreScript}`, { token: trial.token });
        check(`12. no-regresión: trial → download de "${nombreScript}" sigue en 200`, () => {
            assert.strictEqual(dlTrial.status, 200, 'status ' + dlTrial.status + ' ' + dlTrial.body.slice(0, 150));
        });
    }
}

async function limpiar() {
    try {
        for (const userId of cleanupUserIds) {
            await pool.query(
                `DELETE FROM expediente_snapshots WHERE expediente_id IN
                 (SELECT id FROM expedientes_seguidos WHERE user_id=$1)`, [userId]);
            await pool.query('DELETE FROM bitacora_entries WHERE user_id=$1', [userId]);
            await pool.query('DELETE FROM expedientes_seguidos WHERE user_id=$1', [userId]);
            await pool.query('DELETE FROM subscriptions WHERE user_id=$1', [userId]);
            await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        }
        for (const planId of cleanupPlanIds) {
            await pool.query('DELETE FROM plans WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_id=$1)', [planId]);
        }
        // Limpieza de higiene: un plan QA_SNAPINF_* quedó huérfano de una sesión
        // anterior (verify-snapshot-informe.js no borraba el plan, solo el usuario).
        const huerfanos = await pool.query(
            `DELETE FROM plans WHERE name LIKE 'QA_SNAPINF_%'
               AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_id = plans.id)
             RETURNING id, name`);
        console.log(`\n   limpieza: ${cleanupUserIds.length} usuarios + ${cleanupPlanIds.length} planes propios` +
            (huerfanos.rows.length ? ` + ${huerfanos.rows.length} plan(es) huérfano(s) de una corrida anterior (${huerfanos.rows.map(r => r.name).join(', ')})` : ''));
    } catch (e) { console.error('\n   AVISO: limpieza incompleta: ' + e.message); }
}

main()
    .catch(e => { console.error('\nERROR: ' + e.stack); fail++; })
    .then(limpiar)
    .then(async () => {
        await pool.end();
        console.log('\n' + ok + ' PASS, ' + fail + ' FAIL\n');
        process.exit(fail > 0 ? 1 : 0);
    });
