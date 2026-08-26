/**
 * verify-markdown-m1.js — M1 del módulo Markdown/Anonimización (habilitación por plan).
 *
 * Ejercita el gate `plans.markdown_enabled` con HTTP real contra localhost:3444
 * (bypassa nginx/basic-auth, corre EN el servidor de staging): GET /client/account
 * (markdownEnabled) y POST/PUT /admin/plans (persistencia + COALESCE en la edición
 * parcial, mismo patrón que ya se verificó para bitacora_enabled/visibility).
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'. Nunca correr esto
 * sin ese guard — ver el incidente del 2026-07-24 documentado en CLAUDE.md.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-markdown-m1.js dotenv_config_path=.env.staging
 */

'use strict';

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`❌ ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging". ` +
        'Este script solo debe correr contra la base de staging.');
    process.exit(1);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE_URL = 'https://localhost:3444';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('❌ Falta JWT_SECRET en el entorno.'); process.exit(1); }

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

function request(method, path, { token, body, admin } = {}) {
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

function tokenFor(userId, extra = {}) {
    return jwt.sign({ id: userId, role: 'user', ...extra }, JWT_SECRET, { expiresIn: '1h' });
}
function adminTokenFor(adminId) {
    return jwt.sign({ id: adminId, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}

async function main() {
    console.log(`▶ Markdown M1 — habilitación por plan contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    const USER_A = 215; // fixture estándar del proyecto
    let comboId = null, flagOriginal = null;
    let planTestId = null;

    try {
        const { rows: adminRows } = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if (adminRows.length === 0) throw new Error('No hay ningún usuario admin en staging.');
        const ADMIN_ID = adminRows[0].id;
        const adminToken = adminTokenFor(ADMIN_ID);

        // ── 1. La columna existe y nace en false en todos los planes ────────
        const { rows: planRows } = await db.query('SELECT id, name, markdown_enabled, bitacora_enabled FROM plans');
        check('1. plans.markdown_enabled existe y todos los planes reales están en false',
            planRows.length > 0 && planRows.every(p => p.markdown_enabled === false),
            JSON.stringify(planRows.map(p => `${p.name}=${p.markdown_enabled}`)));

        const combo = planRows.find(p => p.name === 'COMBO_PROMO');
        comboId = combo.id;
        flagOriginal = combo.markdown_enabled;
        const bitacoraEnabledOriginal = combo.bitacora_enabled;

        // ── 2. GET /client/account expone markdownEnabled=false por default ─
        let r = await request('GET', '/client/account', { token: tokenFor(USER_A) });
        check('2. GET /client/account devuelve markdownEnabled (false, flag apagado)',
            r.status === 200 && r.body?.account?.markdownEnabled === false,
            `status=${r.status} markdownEnabled=${r.body?.account?.markdownEnabled}`);

        // ── 3. Encender el flag vía PUT /admin/plans/:id y verificar reflejo ─
        r = await request('PUT', `/admin/plans/${comboId}`, { token: adminToken, body: { markdown_enabled: true } });
        check('3. PUT /admin/plans/:id con markdown_enabled=true → 200 y el campo queda true',
            r.status === 200 && r.body?.plan?.markdown_enabled === true,
            `status=${r.status} markdown_enabled=${r.body?.plan?.markdown_enabled}`);

        r = await request('GET', '/client/account', { token: tokenFor(USER_A) });
        check('4. Con el flag encendido, GET /client/account refleja markdownEnabled=true',
            r.status === 200 && r.body?.account?.markdownEnabled === true,
            `markdownEnabled=${r.body?.account?.markdownEnabled}`);

        // ── 5. CRÍTICO — COALESCE: un PUT que NO toca markdown_enabled no lo resetea ──
        // Mismo bug que hubiera afectado a bitacora_enabled/visibility sin el COALESCE.
        r = await request('PUT', `/admin/plans/${comboId}`, { token: adminToken, body: { display_name: 'Combo Beta' } });
        check('5. Un PUT que solo cambia display_name NO apaga markdown_enabled (COALESCE)',
            r.status === 200 && r.body?.plan?.markdown_enabled === true,
            `markdown_enabled tras PUT parcial=${r.body?.plan?.markdown_enabled}`);

        // ── 6. Apagar el flag explícitamente sí lo apaga ────────────────────
        r = await request('PUT', `/admin/plans/${comboId}`, { token: adminToken, body: { markdown_enabled: false } });
        check('6. PUT con markdown_enabled=false apaga el flag explícitamente',
            r.status === 200 && r.body?.plan?.markdown_enabled === false,
            `markdown_enabled=${r.body?.plan?.markdown_enabled}`);

        r = await request('GET', '/client/account', { token: tokenFor(USER_A) });
        check('7. Con el flag apagado de nuevo, GET /client/account refleja markdownEnabled=false',
            r.status === 200 && r.body?.account?.markdownEnabled === false,
            `markdownEnabled=${r.body?.account?.markdownEnabled}`);

        // ── 8. No-regresión: bitacora_enabled no se ve afectado por estos cambios ─
        // Comparado contra el valor real leído ANTES de tocar nada (no asumido) —
        // los 3 PUT anteriores solo mandaron markdown_enabled/display_name.
        const { rows: comboCheck } = await db.query('SELECT bitacora_enabled FROM plans WHERE id = $1', [comboId]);
        check('8. bitacora_enabled de COMBO_PROMO no cambió por tocar markdown_enabled (no-regresión)',
            comboCheck[0].bitacora_enabled === bitacoraEnabledOriginal,
            `antes=${bitacoraEnabledOriginal} después=${comboCheck[0].bitacora_enabled}`);

        // ── 9. POST /admin/plans (alta) persiste markdown_enabled=true desde el alta ──
        const nombrePlanTest = `TEST_MD_M1_${Date.now()}`;
        r = await request('POST', '/admin/plans', {
            token: adminToken,
            body: { name: nombrePlanTest, display_name: 'Test Markdown M1', markdown_enabled: true }
        });
        check('9. POST /admin/plans (alta) persiste markdown_enabled=true desde el alta',
            r.status === 200 && r.body?.plan?.markdown_enabled === true,
            `status=${r.status} markdown_enabled=${r.body?.plan?.markdown_enabled}`);
        planTestId = r.body?.plan?.id || null;

        // ── 10. GET /admin/plans (SELECT *) expone markdown_enabled sin cambios ──
        r = await request('GET', '/admin/plans', { token: adminToken });
        const planListado = (r.body?.plans || []).find(p => p.id === planTestId);
        check('10. GET /admin/plans expone markdown_enabled en el listado (SELECT * sin tocar)',
            r.status === 200 && planListado?.markdown_enabled === true,
            `markdown_enabled=${planListado?.markdown_enabled}`);

        // ── 11. No-regresión de endpoints ajenos al cambio ──────────────────
        r = await request('GET', '/usuarios/api/plans', { token: tokenFor(USER_A) });
        check('11. GET /usuarios/api/plans sigue en 200 (no-regresión)', r.status === 200, `status=${r.status}`);

    } catch (e) {
        console.error('❌ Error inesperado en el harness:', e);
        failed++;
    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        if (planTestId) await db.query('DELETE FROM plans WHERE id = $1', [planTestId]);
        if (comboId !== null) await db.query('UPDATE plans SET markdown_enabled = $1 WHERE id = $2', [flagOriginal, comboId]);
        await db.end();
        console.log(`   plan de prueba "${planTestId}" borrado`);
        console.log(`   COMBO_PROMO.markdown_enabled restaurado a ${flagOriginal}`);
    }

    console.log(`\n${passed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.log('Fallidas:', fails.join(' | '));
        process.exit(1);
    }
}

main();
