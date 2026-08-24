/**
 * verify-v3-bitacora-api.js — V3 del plan de verificación runtime (2026-08-23).
 *
 * Ejercita la API de Bitácora (routes/bitacora.js) con HTTP real contra
 * localhost:3444 (bypassa nginx/basic-auth, corre EN el servidor de staging).
 * Cubre: el gate checkBitacoraPlan (con/sin flag, las 3 ramas de la gracia de
 * 90 días), IDOR entre 2 usuarios, validaciones de entrada, y que el gate NO
 * alcance rutas ajenas al mount de /bitacora,/expedientes,/feriados (P1).
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'. Nunca correr esto
 * sin ese guard — ver el incidente del 2026-07-24 documentado en CLAUDE.md.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-v3-bitacora-api.js dotenv_config_path=.env.staging
 */

'use strict';

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// .env.staging (preload) solo sobreescribe DB_NAME/etc — JWT_SECRET y el resto
// de las credenciales viven en el .env base. dotenv no pisa vars ya seteadas,
// así que este segundo load solo RELLENA lo que falte (mismo patrón documentado
// en CLAUDE.md para scripts de mantenimiento contra staging).
require('dotenv').config();

// ── Guard de seguridad — el más importante del script ──────────────────────
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

function tokenFor(userId, extra = {}) {
    return jwt.sign({ id: userId, role: 'user', ...extra }, JWT_SECRET, { expiresIn: '1h' });
}

async function main() {
    console.log(`▶ V3 — API Bitácora contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    // ── Fixture: usuario B efímero para IDOR (user 215 ya existe, es el fixture estándar) ──
    // Todo (creación Y limpieza) va en el mismo try/finally: si algo falla a
    // mitad de la creación del fixture, igual queda limpio (lección del primer
    // intento: un fallo acá antes dejaba un usuario B huérfano sin suscripción).
    const USER_A = 215;
    let USER_B = null;
    let comboId = null, flagOriginal = null;

    try {
        const { rows: planRows } = await db.query(
            "SELECT id, bitacora_enabled FROM plans WHERE name = 'COMBO_PROMO'"
        );
        comboId = planRows[0].id;
        flagOriginal = planRows[0].bitacora_enabled;

        const { rows: bRows } = await db.query(
            `INSERT INTO users (email, password_hash, role, registration_status, email_verified, cuit)
             VALUES ('v3-fixture-b@stub.local', 'x', 'user', 'active', true, '20999999990')
             RETURNING id`
        );
        USER_B = bRows[0].id;
        await db.query(
            `INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at)
             VALUES ($1, 'COMBO_PROMO', $2, 'active', 0, 999999, NOW() + INTERVAL '30 days')`,
            [USER_B, comboId]
        );
        console.log(`Fixture: user A = ${USER_A} (existente), user B = ${USER_B} (creado para IDOR)\n`);

        const tokenA = tokenFor(USER_A);
        const tokenB = tokenFor(USER_B);
        // ═══ 1. Gate sin flag ═══
        await db.query('UPDATE plans SET bitacora_enabled = false WHERE id = $1', [comboId]);

        let r = await request('GET', '/usuarios/api/bitacora', { token: tokenA });
        check('1. GET /bitacora sin flag → 403 BITACORA_NO_INCLUIDA', r.status === 403 && r.body?.code === 'BITACORA_NO_INCLUIDA', `status=${r.status} code=${r.body?.code}`);

        r = await request('GET', '/usuarios/api/expedientes', { token: tokenA });
        check('2. GET /expedientes sin flag → 403', r.status === 403 && r.body?.code === 'BITACORA_NO_INCLUIDA', `status=${r.status}`);

        r = await request('GET', '/usuarios/api/feriados', { token: tokenA });
        check('3. GET /feriados sin flag → 403', r.status === 403 && r.body?.code === 'BITACORA_NO_INCLUIDA', `status=${r.status}`);

        r = await request('GET', '/usuarios/api/sugerencias', { token: tokenA });
        check('4. GET /sugerencias sin flag → 403', r.status === 403 && r.body?.code === 'BITACORA_NO_INCLUIDA', `status=${r.status}`);

        r = await request('GET', '/usuarios/api/bitacora', {});
        check('5. GET /bitacora sin token → 401', r.status === 401, `status=${r.status}`);

        // ═══ 2. P1 — el gate NO debe alcanzar rutas ajenas al mount ═══
        r = await request('GET', '/usuarios/api/plans', { token: tokenA });
        check('6. GET /plans (router usuarios.js, sin flag) → NO 403 del gate de Bitácora', r.status !== 403, `status=${r.status} body=${r.raw.slice(0,120)}`);

        r = await request('GET', '/usuarios/api/subscription/current', { token: tokenA });
        check('7. GET /subscription/current (sin flag) → NO 403 del gate de Bitácora', r.status !== 403, `status=${r.status}`);

        // ═══ 3. Habilitar flag → el gate deja pasar ═══
        await db.query('UPDATE plans SET bitacora_enabled = true WHERE id = $1', [comboId]);

        r = await request('GET', '/usuarios/api/bitacora', { token: tokenA });
        check('8. GET /bitacora CON flag → 200', r.status === 200 && r.body?.success === true, `status=${r.status}`);

        r = await request('GET', '/usuarios/api/expedientes', { token: tokenA });
        check('9. GET /expedientes CON flag → 200', r.status === 200 && r.body?.success === true, `status=${r.status}`);

        r = await request('GET', '/usuarios/api/feriados', { token: tokenA });
        check('10. GET /feriados CON flag → 200 (lectura pública de config, igual gateada)', r.status === 200 && Array.isArray(r.body?.feriados), `status=${r.status}`);

        // ═══ 4. Validaciones de entrada — POST /bitacora ═══
        r = await request('POST', '/usuarios/api/bitacora', { token: tokenA, body: { kind: 'tipo-inexistente', title: 'x' } });
        check('11. POST /bitacora kind inválido → 400', r.status === 400, `status=${r.status}`);

        r = await request('POST', '/usuarios/api/bitacora', { token: tokenA, body: { kind: 'nota', title: '' } });
        check('12. POST /bitacora title vacío → 400', r.status === 400, `status=${r.status}`);

        r = await request('POST', '/usuarios/api/bitacora', { token: tokenA, body: { kind: 'nota', title: 'x', repeat_rule: 'diario' } });
        check('13. POST /bitacora repeat_rule inválido → 400', r.status === 400, `status=${r.status}`);

        r = await request('POST', '/usuarios/api/bitacora', { token: tokenA, body: { kind: 'nota', title: 'x', due_at: 'no-es-una-fecha' } });
        check('14. POST /bitacora due_at inválido → 400', r.status === 400, `status=${r.status}`);

        const descLarga = 'a'.repeat(6000);
        r = await request('POST', '/usuarios/api/bitacora', { token: tokenA, body: { kind: 'nota', title: 'V3 desc larga', description: descLarga } });
        check('15. POST /bitacora description de 6000 chars → 201 (se trunca a 5000, no rechaza)',
            r.status === 201 && r.body?.entrada?.description?.length === 5000,
            `status=${r.status} len=${r.body?.entrada?.description?.length}`);
        const entradaTruncadaId = r.body?.entrada?.id;

        // ═══ 5. Crear entrada real de A (para IDOR) ═══
        r = await request('POST', '/usuarios/api/bitacora', { token: tokenA, body: { kind: 'tarea', title: 'V3 entrada de A' } });
        check('16. POST /bitacora válido (A) → 201', r.status === 201 && r.body?.entrada?.id > 0, `status=${r.status}`);
        const entradaA = r.body?.entrada?.id;

        r = await request('POST', '/usuarios/api/expedientes', { token: tokenA, body: { expediente: 'FCR 18745/2017' } });
        check('17. POST /expedientes válido (A) → 200/201', [200, 201].includes(r.status) && r.body?.expediente?.id > 0, `status=${r.status}`);
        const expedienteA = r.body?.expediente?.id;

        // ═══ 6. B también con flag (mismo plan) — IDOR sobre los recursos de A ═══
        r = await request('PUT', `/usuarios/api/bitacora/${entradaA}`, { token: tokenB, body: { title: 'hijackeado' } });
        check('18. PUT /bitacora/:id de A, como B → 404 (IDOR bloqueado)', r.status === 404, `status=${r.status}`);

        r = await request('DELETE', `/usuarios/api/bitacora/${entradaA}`, { token: tokenB });
        check('19. DELETE /bitacora/:id de A, como B → 404 (IDOR bloqueado)', r.status === 404, `status=${r.status}`);

        r = await request('GET', `/usuarios/api/expedientes/${expedienteA}`, { token: tokenB });
        check('20. GET /expedientes/:id de A, como B → 404 (IDOR bloqueado)', r.status === 404, `status=${r.status}`);

        r = await request('GET', `/usuarios/api/expedientes/${expedienteA}/snapshots/1`, { token: tokenB });
        check('21. GET /expedientes/:id/snapshots/:id de A, como B → 404 (IDOR bloqueado)', r.status === 404, `status=${r.status}`);

        // Confirmación positiva: A sí puede editar y borrar lo suyo
        r = await request('PUT', `/usuarios/api/bitacora/${entradaA}`, { token: tokenA, body: { title: 'V3 entrada de A (editada)' } });
        check('22. PUT /bitacora/:id de A, como A → 200 (no-regresión del camino feliz)', r.status === 200 && r.body?.entrada?.title === 'V3 entrada de A (editada)', `status=${r.status}`);

        r = await request('DELETE', `/usuarios/api/bitacora/${entradaA}`, { token: tokenA });
        check('23. DELETE /bitacora/:id de A, como A → 200', r.status === 200, `status=${r.status}`);
        r = await request('DELETE', `/usuarios/api/bitacora/${entradaTruncadaId}`, { token: tokenA });
        check('23b. DELETE de la entrada de la prueba #15 → 200', r.status === 200, `status=${r.status}`);

        // ═══ 7. Gracia de 90 días en /bitacora/export (conGracia) ═══
        await db.query('UPDATE plans SET bitacora_enabled = false WHERE id = $1', [comboId]);

        // 7a. Sin bitacora_lost_access_at (nunca tuvo el flag) → 403 sin gracia
        await db.query('UPDATE users SET bitacora_lost_access_at = NULL WHERE id = $1', [USER_A]);
        r = await request('GET', '/usuarios/api/bitacora/export', { token: tokenA });
        check('24. GET /bitacora/export sin flag y sin lost_access_at → 403 BITACORA_NO_INCLUIDA', r.status === 403 && r.body?.code === 'BITACORA_NO_INCLUIDA', `status=${r.status} code=${r.body?.code}`);

        // 7b. Perdió el acceso hace 10 días → dentro de la gracia → 200
        await db.query("UPDATE users SET bitacora_lost_access_at = NOW() - INTERVAL '10 days' WHERE id = $1", [USER_A]);
        r = await request('GET', '/usuarios/api/bitacora/export', { token: tokenA });
        check('25. GET /bitacora/export, perdido hace 10 días → 200 (dentro de la gracia)', r.status === 200, `status=${r.status} body=${r.raw.slice(0,150)}`);

        // 7c. Perdió el acceso hace 100 días → gracia vencida → 403
        await db.query("UPDATE users SET bitacora_lost_access_at = NOW() - INTERVAL '100 days' WHERE id = $1", [USER_A]);
        r = await request('GET', '/usuarios/api/bitacora/export', { token: tokenA });
        check('26. GET /bitacora/export, perdido hace 100 días → 403 BITACORA_GRACIA_VENCIDA', r.status === 403 && r.body?.code === 'BITACORA_GRACIA_VENCIDA', `status=${r.status} code=${r.body?.code}`);

        // 7d. El resto de /bitacora/* NO tiene gracia — mismo estado (100 días), debe seguir en 403 duro
        r = await request('GET', '/usuarios/api/bitacora', { token: tokenA });
        check('27. GET /bitacora (sin conGracia), en la misma ventana de 100 días → 403 (la gracia es SOLO del export)', r.status === 403 && r.body?.code === 'BITACORA_NO_INCLUIDA', `status=${r.status} code=${r.body?.code}`);

        // ═══ 8. capture-draft — mismo gate, endpoint anónimo aparte ═══
        r = await request('GET', '/usuarios/api/capture-draft/no-existe-123', { token: tokenA });
        check('28. GET /capture-draft/:id con flag apagado → 403 (gate corre antes que el 404 del draft)', r.status === 403, `status=${r.status}`);

    } finally {
        // ── Limpieza: dejar staging exactamente como estaba (defensiva ante
        // un fallo a mitad de la creación del fixture, cuando comboId/USER_B
        // pueden seguir en null). ──
        console.log('\n🧹 Limpiando fixtures...');
        if (comboId !== null) await db.query('UPDATE plans SET bitacora_enabled = $1 WHERE id = $2', [flagOriginal, comboId]);
        await db.query('UPDATE users SET bitacora_lost_access_at = NULL WHERE id = $1', [USER_A]);
        const ids = USER_B !== null ? [USER_A, USER_B] : [USER_A];
        await db.query('DELETE FROM bitacora_entries WHERE user_id = ANY($1)', [ids]);
        await db.query('DELETE FROM expedientes_seguidos WHERE user_id = ANY($1)', [ids]);
        if (USER_B !== null) {
            await db.query('DELETE FROM subscriptions WHERE user_id = $1', [USER_B]);
            await db.query('DELETE FROM users WHERE id = $1', [USER_B]);
        }
        console.log('   Flag COMBO_PROMO.bitacora_enabled restaurado a', flagOriginal);
        console.log('   user 215.bitacora_lost_access_at → NULL');
        console.log('   fixtures de bitacora_entries/expedientes_seguidos de A y B borrados');
        console.log('   usuario B efímero eliminado');
        await db.end();
    }

    console.log(`\n═══ ${passed}/${passed + failed} PASS ═══`);
    if (failed) { console.log('Fallidos:', fails.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
