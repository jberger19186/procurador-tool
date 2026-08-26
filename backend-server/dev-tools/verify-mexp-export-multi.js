/**
 * verify-mexp-export-multi.js — Mis Expedientes, Bloque B (exportar una
 * selección múltiple de casos).
 *
 * Ejercita GET /usuarios/api/bitacora/export?alcance=expediente con VARIOS
 * ids en `expediente_id` (antes solo aceptaba uno) — HTTP real contra
 * localhost:3444 (bypassa nginx/basic-auth, corre EN el servidor de
 * staging). Cubre los 3 formatos y, sobre todo, la validación IDOR
 * **por id** (no alcanza con que la lista "contenga" ids del usuario).
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-mexp-export-multi.js dotenv_config_path=.env.staging
 */

'use strict';

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

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

/** Igual que las otras harnesses, pero deja el body como Buffer — necesario
 *  para parsear el .xlsx (texto lo corromperia). */
function requestBinary(method, path, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
        const headers = {};
        if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
        const req = https.request(BASE_URL + path, { method, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                buffer: Buffer.concat(chunks),
            }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function requestJson(path, opts) {
    const r = await requestBinary('GET', path, opts);
    let body = null;
    try { body = JSON.parse(r.buffer.toString('utf8')); } catch (e) { /* no era JSON */ }
    return { status: r.status, headers: r.headers, body };
}

function tokenFor(userId, extra) {
    return jwt.sign(Object.assign({ id: userId, role: 'user' }, extra || {}), JWT_SECRET, { expiresIn: '1h' });
}

async function main() {
    console.log(`▶ Mis Expedientes — export de selección múltiple, contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    const USER_A = 215;
    let USER_B = null;
    let comboId = null, flagOriginal = null;
    const fichaIdsA = [];
    let fichaIdB = null;
    const entradaIds = [];

    try {
        const { rows: planRows } = await db.query(
            "SELECT id, bitacora_enabled FROM plans WHERE name = 'COMBO_PROMO'"
        );
        comboId = planRows[0].id;
        flagOriginal = planRows[0].bitacora_enabled;
        await db.query('UPDATE plans SET bitacora_enabled = true WHERE id = $1', [comboId]);

        const { rows: bRows } = await db.query(
            `INSERT INTO users (email, password_hash, role, registration_status, email_verified, cuit)
             VALUES ('mexp-export-fixture-b@stub.local', 'x', 'user', 'active', true, '20999999991')
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

        const crearFichaConEntrada = async (userId, expediente, caratula) => {
            const { rows } = await db.query(
                `INSERT INTO expedientes_seguidos (user_id, expediente, expediente_key, caratula)
                 VALUES ($1, $2, $2, $3) RETURNING id`,
                [userId, expediente, caratula]
            );
            const fichaId = rows[0].id;
            const { rows: eRows } = await db.query(
                `INSERT INTO bitacora_entries (user_id, expediente_id, kind, title, due_at, all_day, source)
                 VALUES ($1, $2, 'vencimiento', $3, NOW() + INTERVAL '3 days', true, 'manual') RETURNING id`,
                [userId, fichaId, `Vencimiento de ${expediente}`]
            );
            entradaIds.push(eRows[0].id);
            return fichaId;
        };

        fichaIdsA.push(await crearFichaConEntrada(USER_A, 'MEXP-EXPORT-A1/2026', 'ACTOR c/ DEMANDADO A1'));
        fichaIdsA.push(await crearFichaConEntrada(USER_A, 'MEXP-EXPORT-A2/2026', 'ACTOR c/ DEMANDADO A2'));
        fichaIdsA.push(await crearFichaConEntrada(USER_A, 'MEXP-EXPORT-A3/2026', 'ACTOR c/ DEMANDADO A3'));
        fichaIdB = await crearFichaConEntrada(USER_B, 'MEXP-EXPORT-B1/2026', 'OTRO c/ AJENO');

        const idA1 = fichaIdsA[0];
        const idA2 = fichaIdsA[1];

        let r = await requestJson(`/usuarios/api/bitacora/export?alcance=expediente&formato=json&expediente_id=${idA1},${idA2}`, { token: tokenA });
        check('1. JSON con 2 ids → 200', r.status === 200, `status=${r.status}`);
        check('2. JSON trae exactamente los 2 expedientes pedidos',
            !!r.body && r.body.expedientes.length === 2 &&
            new Set(r.body.expedientes.map(x => x.id)).size === 2 &&
            [idA1, idA2].every(id => r.body.expedientes.some(x => x.id === id)),
            `ids=${JSON.stringify((r.body && r.body.expedientes || []).map(x => x.id))}`);
        check('3. JSON trae las 2 entradas correspondientes (una por ficha)',
            !!r.body && r.body.entradas.length === 2,
            `entradas=${r.body && r.body.entradas && r.body.entradas.length}`);

        let rb = await requestBinary('GET', `/usuarios/api/bitacora/export?alcance=expediente&formato=xlsx&expediente_id=${idA1},${idA2}`, { token: tokenA });
        check('4. XLSX con 2 ids → 200 spreadsheetml', rb.status === 200 && /spreadsheetml/.test(rb.headers['content-type'] || ''));
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(rb.buffer);
        const wsExp = wb.getWorksheet('Expedientes');
        check('5. XLSX con 2 ids → la hoja "Expedientes" existe',
            !!wsExp, `hojas=${wb.worksheets.map(w => w.name).join(',')}`);
        check('6. XLSX — la hoja "Expedientes" tiene 2 filas de datos (+1 de encabezado)',
            !!wsExp && wsExp.rowCount === 3, `rowCount=${wsExp && wsExp.rowCount}`);

        rb = await requestBinary('GET', `/usuarios/api/bitacora/export?alcance=expediente&formato=xlsx&expediente_id=${idA1}`, { token: tokenA });
        const wbUno = new ExcelJS.Workbook();
        await wbUno.xlsx.load(rb.buffer);
        check('7. XLSX con 1 solo id → NO trae la hoja "Expedientes" (no-regresión)',
            !wbUno.getWorksheet('Expedientes'), `hojas=${wbUno.worksheets.map(w => w.name).join(',')}`);

        rb = await requestBinary('GET', `/usuarios/api/bitacora/export?alcance=expediente&formato=ics&expediente_id=${idA1},${idA2}`, { token: tokenA });
        const icsRaw = rb.buffer.toString('utf8');
        const vcount = (icsRaw.match(/BEGIN:VEVENT/g) || []).length;
        check('8. .ics con 2 ids → 200 text/calendar', rb.status === 200 && /text\/calendar/.test(rb.headers['content-type'] || ''));
        check('9. .ics con 2 ids → 2 VEVENT (uno por entrada)', vcount === 2, `vevents=${vcount}`);

        r = await requestJson(`/usuarios/api/bitacora/export?alcance=expediente&formato=json&expediente_id=${idA1},${fichaIdB}`, { token: tokenA });
        check('10. IDOR mezclado (1 propio + 1 ajeno) → 200, solo el propio',
            r.status === 200 && !!r.body && r.body.expedientes.length === 1 && r.body.expedientes[0].id === idA1,
            `status=${r.status} expedientes=${JSON.stringify((r.body && r.body.expedientes || []).map(x => x.id))}`);

        r = await requestJson(`/usuarios/api/bitacora/export?alcance=expediente&formato=json&expediente_id=${fichaIdB}`, { token: tokenA });
        check('11. IDOR — solo un id ajeno → 404', r.status === 404, `status=${r.status}`);

        r = await requestJson(`/usuarios/api/bitacora/export?alcance=expediente&formato=json&expediente_id=${idA1},999999999`, { token: tokenA });
        check('12. Id inexistente mezclado con uno real → 200, solo el real',
            r.status === 200 && !!r.body && r.body.expedientes.length === 1 && r.body.expedientes[0].id === idA1,
            `status=${r.status}`);

        const listaLarga = Array.from({ length: 201 }, (_, i) => 900000 + i).join(',');
        r = await requestJson(`/usuarios/api/bitacora/export?alcance=expediente&formato=json&expediente_id=${listaLarga}`, { token: tokenA });
        check('13. Más de 200 ids → 400', r.status === 400, `status=${r.status}`);

        r = await requestJson('/usuarios/api/bitacora/export?alcance=todo&formato=json', { token: tokenA });
        check('14. No-regresión alcance=todo (3 fichas de A, sin filtrar por selección)',
            r.status === 200 && !!r.body && r.body.expedientes.length >= 3,
            `status=${r.status} n=${r.body && r.body.expedientes && r.body.expedientes.length}`);

    } catch (e) {
        console.error('❌ Error inesperado en el harness:', e);
        failed++;
    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        if (entradaIds.length > 0) await db.query('DELETE FROM bitacora_entries WHERE id = ANY($1)', [entradaIds]);
        const idsFichas = fichaIdsA.concat(fichaIdB !== null ? [fichaIdB] : []);
        if (idsFichas.length > 0) await db.query('DELETE FROM expedientes_seguidos WHERE id = ANY($1)', [idsFichas]);
        if (comboId !== null) await db.query('UPDATE plans SET bitacora_enabled = $1 WHERE id = $2', [flagOriginal, comboId]);
        if (USER_B !== null) {
            await db.query('DELETE FROM subscriptions WHERE user_id = $1', [USER_B]);
            await db.query('DELETE FROM users WHERE id = $1', [USER_B]);
        }
        await db.end();
        console.log(`   ${entradaIds.length} entradas + ${idsFichas.length} fichas de fixture borradas`);
        console.log('   Flag COMBO_PROMO.bitacora_enabled restaurado a', flagOriginal);
        console.log('   usuario B efímero eliminado');
    }

    console.log(`\n${passed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.log('Fallidas:', fails.join(' | '));
        process.exit(1);
    }
}

main();
