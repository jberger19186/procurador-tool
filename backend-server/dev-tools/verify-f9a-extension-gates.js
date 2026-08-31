/**
 * verify-f9a-extension-gates.js — V6-b de F9a (plan-code-review-integral-2026-08-26.md).
 *
 * Ejercita los DOS gates de la extensión Chrome — POST /auth/extension-login (email+password)
 * y GET /client/extension-auth (Bearer token) — con HTTP real contra localhost:3444. Son dos
 * implementaciones INDEPENDIENTES del mismo criterio (mismo comentario en el código de ambas:
 * "Mismo criterio que /auth/extension-login y /auth/refresh"), así que el punto central de este
 * harness es verificar que las DOS coinciden en cada estado, no solo que una de las dos funciona.
 *
 * También verifica el caso concreto que motivó FLOW_ALIASES en auth.js: los planes activos
 * (EXTENSION_PROMO/COMBO_PROMO) guardan "notificaciones" en extension_flows, no "notif" (el
 * nombre interno que usa background.js) — confirmado por lectura directa de la DB de staging.
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'. Ver el incidente del 2026-07-24 (V3) y
 * el de F8 (2026-08-31, reencrypt apuntando a producción por el mismo bug de dotenv) en CLAUDE.md.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-f9a-extension-gates.js dotenv_config_path=.env.staging
 */

'use strict';

const https = require('https');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`❌ ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging". ` +
        'Este script solo debe correr contra la base de staging.');
    process.exit(1);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE_URL = 'https://localhost:3444';

const db = new Pool({
    user: process.env.DB_USER || 'procurador_user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    connectionTimeoutMillis: 5000,
});

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`✅ ${name}`); }
    else { failed++; fails.push(name); console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function request(method, path, { token, body } = {}) {
    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        const req = https.request(BASE_URL + path, { method, headers }, (res) => {
            let chunks = '';
            res.on('data', (c) => chunks += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(chunks); } catch (_) {}
                resolve({ status: res.statusCode, body: json, raw: chunks });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

const FIXTURE_EMAIL = 'f9a-fixture@stub.local';
const FIXTURE_PASSWORD = 'F9aFixture!2026';

async function extensionLogin() {
    return request('POST', '/auth/extension-login', { body: { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD } });
}
async function extensionAuth(token) {
    return request('GET', '/client/extension-auth', { token });
}

async function main() {
    console.log(`▶ F9a/V6-b — gates de la extensión contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    let userId = null;
    let comboId = null;
    let realToken = null; // token real emitido por el propio /auth/extension-login cuando corresponda

    try {
        const { rows: planRows } = await db.query(
            "SELECT id, extension_flows FROM plans WHERE name = 'COMBO_PROMO'"
        );
        comboId = planRows[0].id;
        const comboFlows = planRows[0].extension_flows;
        console.log(`COMBO_PROMO.extension_flows = ${JSON.stringify(comboFlows)}\n`);

        const pwHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);
        const { rows: uRows } = await db.query(
            `INSERT INTO users (email, password_hash, role, registration_status, email_verified, cuit)
             VALUES ($1, $2, 'user', 'pending_activation', true, '20999999991')
             RETURNING id`,
            [FIXTURE_EMAIL, pwHash]
        );
        userId = uRows[0].id;
        console.log(`Fixture: user id = ${userId}\n`);

        // ═══ 1. Trial, con usos disponibles (5/20) ═══
        await db.query(
            `INSERT INTO subscriptions (user_id, plan, plan_id, status, payment_provider, usage_count, usage_limit, expires_at)
             VALUES ($1, 'COMBO_PROMO', $2, 'suspended', NULL, 5, 20, NOW() + INTERVAL '30 days')`,
            [userId, comboId]
        );

        let r = await extensionLogin();
        check('1a. extension-login, trial 5/20 → 200 + token', r.status === 200 && r.body?.success === true && !!r.body?.token, `status=${r.status} body=${r.raw.slice(0,150)}`);
        realToken = r.body?.token;
        check('1b. extension-login, enabledFlows refleja el plan (incluye "notificaciones")', Array.isArray(r.body?.extension?.enabledFlows) && r.body.extension.enabledFlows.includes('notificaciones'), `enabledFlows=${JSON.stringify(r.body?.extension?.enabledFlows)}`);

        r = await extensionAuth(realToken);
        check('1c. extension-auth con el token real de extension-login → 200 (misma cuenta, mismo criterio)', r.status === 200 && r.body?.success === true, `status=${r.status} body=${r.raw.slice(0,150)}`);
        check('1d. extension-auth, enabledFlows coincide con extension-login (misma fuente, 2 implementaciones)', JSON.stringify(r.body?.enabledFlows) === JSON.stringify(comboFlows), `login=${JSON.stringify(comboFlows)} auth=${JSON.stringify(r.body?.enabledFlows)}`);

        // ═══ 2. Trial agotado (20/20), registration_status pending_activation ═══
        await db.query('UPDATE subscriptions SET usage_count = 20 WHERE user_id = $1', [userId]);

        r = await extensionLogin();
        check('2a. extension-login, trial 20/20 pending_activation → 403 + action:subscribe', r.status === 403 && r.body?.action === 'subscribe', `status=${r.status} body=${r.raw.slice(0,200)}`);
        check('2b. extension-login, mensaje de trial agotado menciona "pendiente de activación"', /pendiente de activaci/i.test(r.body?.error || ''), `error="${r.body?.error}"`);

        r = await extensionAuth(realToken);
        check('2c. extension-auth, MISMO estado (20/20 pending_activation) → también 403 (las 2 implementaciones coinciden)', r.status === 403 && r.body?.action === 'subscribe', `status=${r.status} body=${r.raw.slice(0,200)}`);
        check('2d. extension-auth, mismo mensaje de "pendiente de activación"', /pendiente de activaci/i.test(r.body?.error || ''), `error="${r.body?.error}"`);

        // ═══ 3. Trial agotado, pero registration_status = active (ya lo activó el admin) ═══
        await db.query("UPDATE users SET registration_status = 'active' WHERE id = $1", [userId]);
        await db.query("UPDATE subscriptions SET status = 'active' WHERE user_id = $1", [userId]);

        r = await extensionLogin();
        check('3a. extension-login, trial 20/20 + registration active → 403, mensaje distinto ("configurá tu método de pago")', r.status === 403 && /configur.{1,3} tu m.todo de pago/i.test(r.body?.error || ''), `error="${r.body?.error}"`);

        r = await extensionAuth(realToken);
        check('3b. extension-auth, mismo estado → mismo mensaje de "configurá tu método de pago"', r.status === 403 && /configur.{1,3} tu m.todo de pago/i.test(r.body?.error || ''), `error="${r.body?.error}"`);

        // ═══ 4. Pagado (payment_provider seteado) — el trial ya no debe bloquear aunque usage_count=usage_limit ═══
        await db.query("UPDATE subscriptions SET payment_provider = 'mercadopago', usage_count = 999999, usage_limit = 999999 WHERE user_id = $1", [userId]);

        r = await extensionLogin();
        check('4a. extension-login, pagado (payment_provider set) → 200 pese a usage_count=usage_limit', r.status === 200 && r.body?.success === true, `status=${r.status} body=${r.raw.slice(0,150)}`);

        r = await extensionAuth(realToken);
        check('4b. extension-auth, mismo estado → 200', r.status === 200 && r.body?.success === true, `status=${r.status}`);

        // ═══ 5. Suscripción vencida (expires_at en el pasado) ═══
        await db.query("UPDATE subscriptions SET expires_at = NOW() - INTERVAL '1 day' WHERE user_id = $1", [userId]);

        r = await extensionLogin();
        check('5a. extension-login, expires_at vencido → 403 "No tenés una suscripción activa"', r.status === 403 && /no ten.{1,3}s una suscripci.n activa/i.test(r.body?.error || ''), `error="${r.body?.error}"`);

        r = await extensionAuth(realToken);
        check('5b. extension-auth, mismo estado → mismo 403', r.status === 403 && /no ten.{1,3}s una suscripci.n activa/i.test(r.body?.error || ''), `error="${r.body?.error}"`);

        // Restaurar vigencia para los casos de registration_status terminales
        await db.query("UPDATE subscriptions SET expires_at = NOW() + INTERVAL '30 days' WHERE user_id = $1", [userId]);

        // ═══ 6. Estados bloqueantes de registration_status (blockedExtStatuses) ═══
        for (const status of ['rejected', 'suspended_admin', 'suspended_plan_expired', 'cancelled', 'pending_email']) {
            await db.query('UPDATE users SET registration_status = $1 WHERE id = $2', [status, userId]);
            r = await extensionLogin();
            check(`6. extension-login, registration_status='${status}' → 403 (bloqueado antes de mirar la suscripción)`, r.status === 403, `status=${r.status} error="${r.body?.error}"`);
        }
        // extension-auth NO tiene el mapa de mensajes por status bloqueante (solo mira status/expires_at
        // de subscriptions vía authenticateToken + su propia query) — confirmar que igual bloquea, aunque
        // sea con el mensaje genérico de "sin suscripción activa" en vez del mensaje específico.
        await db.query('UPDATE users SET registration_status = $1 WHERE id = $2', ['rejected', userId]);
        r = await extensionAuth(realToken);
        check('6b. extension-auth con registration_status=rejected → sigue bloqueando (403), aunque no tenga el mapa de mensajes de extension-login', r.status === 403, `status=${r.status} body=${r.raw.slice(0,150)}`);

        // ═══ 7. Sin token / credenciales inválidas ═══
        r = await extensionAuth(null);
        check('7a. extension-auth sin token → 401', r.status === 401, `status=${r.status}`);

        r = await request('POST', '/auth/extension-login', { body: { email: FIXTURE_EMAIL, password: 'contraseña-incorrecta' } });
        check('7b. extension-login con password incorrecta → 401', r.status === 401, `status=${r.status}`);

        r = await request('POST', '/auth/extension-login', { body: { email: 'no-existe-f9a@stub.local', password: 'x' } });
        check('7c. extension-login con email inexistente → 401 (mismo mensaje que password incorrecta, anti-enumeración)', r.status === 401, `status=${r.status}`);

    } finally {
        console.log('\n🧹 Limpiando fixture...');
        if (userId !== null) {
            await db.query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
            await db.query('DELETE FROM users WHERE id = $1', [userId]);
            console.log(`   usuario fixture ${userId} eliminado`);
        }
        await db.end();
    }

    console.log(`\n═══ ${passed}/${passed + failed} PASS ═══`);
    if (failed) { console.log('Fallidos:', fails.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
