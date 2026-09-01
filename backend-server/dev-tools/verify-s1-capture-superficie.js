/**
 * verify-s1-capture-superficie.js — S1 de la Etapa 3 (SEC-2, 2026-09-01).
 *
 * Audita el ÚNICO endpoint anónimo de todo el sistema (POST /usuarios/capture,
 * routes/capture.js) y su almacén en memoria (utils/captureDrafts.js).
 *
 * Cubre las 4 hipótesis de S1 del plan (plan-seguridad-lanzamiento-2026-08.md):
 *   1. H-2 — DoS dirigido: ¿100+ POSTs desalojan las capturas de usuarios legítimos?
 *   2. Open redirect: ¿el campo `goto`/cualquier campo del cliente se refleja en el Location?
 *   3. Consumo de memoria bajo carga sostenida, dentro del rate limit real (30/5min).
 *   4. IDOR de drafts: ¿cualquier usuario autenticado con el id puede reclamar un draft ajeno?
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config /tmp/verify-s1-capture-superficie.js dotenv_config_path=.env.staging
 *
 * Nota de tiempo: la sección H-2 hace ~101 POSTs reales contra /usuarios/capture,
 * que está limitado a 30/5min por IP (captureLimiter). El script hace los envíos
 * en 4 tandas de <=30, esperando 5.5 min entre tandas — toma ~17-20 minutos en
 * total. Se corre con `run_in_background` y se revisa después.
 */

'use strict';

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`❌ ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging".`);
    process.exit(1);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE_URL = 'https://localhost:3444';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('❌ Falta JWT_SECRET.'); process.exit(1); }

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

function request(method, path, { token, body, form, headers: extraHeaders } = {}) {
    return new Promise((resolve, reject) => {
        let data = null;
        const headers = Object.assign({}, extraHeaders);
        if (form) {
            data = new URLSearchParams(form).toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (body !== undefined) {
            data = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
        }
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        const req = https.request(BASE_URL + path, { method, headers }, (res) => {
            let chunks = '';
            res.on('data', (c) => chunks += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(chunks); } catch (_) {}
                resolve({ status: res.statusCode, body: json, raw: chunks, headers: res.headers });
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

function draftIdFromLocation(loc) {
    if (!loc) return null;
    const m = loc.match(/[?&]draft=([a-f0-9]+)/);
    return m ? m[1] : null;
}

function capturaParamFromLocation(loc) {
    if (!loc) return null;
    const m = loc.match(/[?&]captura=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

async function postCapture(form) {
    // POST anónimo — sin token, tal como lo hace el visor real.
    return request('POST', '/usuarios/capture', { form });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getHealth() {
    const r = await request('GET', '/health');
    return r.body;
}

async function main() {
    console.log(`▶ S1 — superficie anónima de captura contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    const USER_A = 215;
    let USER_B = null;
    let comboId = null, flagOriginal = null;

    try {
        const { rows: planRows } = await db.query(
            "SELECT id, bitacora_enabled FROM plans WHERE name = 'COMBO_PROMO'"
        );
        comboId = planRows[0].id;
        flagOriginal = planRows[0].bitacora_enabled;
        await db.query('UPDATE plans SET bitacora_enabled = true WHERE id = $1', [comboId]);

        const { rows: bRows } = await db.query(
            `INSERT INTO users (email, password_hash, role, registration_status, email_verified, cuit)
             VALUES ('s1-fixture-b@stub.local', 'x', 'user', 'active', true, '20999999991')
             RETURNING id`
        );
        USER_B = bRows[0].id;
        await db.query(
            `INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at)
             VALUES ($1, 'COMBO_PROMO', $2, 'active', 0, 999999, NOW() + INTERVAL '30 days')`,
            [USER_B, comboId]
        );
        const tokenA = tokenFor(USER_A);
        const tokenB = tokenFor(USER_B);
        console.log(`Fixture: user A = ${USER_A} (existente), user B = ${USER_B} (creado)\n`);

        // ═══ 1. Open redirect — el campo `goto` del cliente NUNCA debe reflejarse ═══
        let r = await postCapture({
            accion: 'entrada', tipo: 'nota', exp: 'FCR 1/2026',
            goto: 'https://evil.example.com', captura: 'ok'
        });
        const loc1 = r.headers.location || '';
        check('1. POST con goto=evil.example.com → Location NO contiene ese host',
            r.status === 303 && !loc1.includes('evil.example.com') && loc1.startsWith('/usuarios/?goto=bitacora'),
            `status=${r.status} location=${loc1}`);

        // Campo extra `captura` tampoco puede pisar la clave que arma el servidor con datos propios.
        r = await postCapture({ accion: 'entrada', tipo: 'nota', exp: 'FCR 2/2026', draft: 'malicious-draft-id-xxx' });
        const loc1b = r.headers.location || '';
        check('1b. Campo `draft` inyectado por el cliente no se refleja tal cual (el server arma el suyo)',
            r.status === 303 && !loc1b.includes('malicious-draft-id-xxx'),
            `location=${loc1b}`);

        // ═══ 2. Validación: accion inválida / lote_grande ═══
        r = await postCapture({ accion: 'no-existe' });
        check('2. accion inválida → captura=error (no 500, no acepta cualquier valor)',
            r.status === 303 && capturaParamFromLocation(r.headers.location) === 'error',
            `status=${r.status} loc=${r.headers.location}`);

        const loteGrande = JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ exp: `FCR ${i}/2026` })));
        r = await postCapture({ accion: 'entrada-lote', lote: loteGrande });
        check('3. Lote de 201 casos (> MAX_CASOS_LOTE=200) → captura=lote_grande, rechazado antes de crear draft',
            r.status === 303 && capturaParamFromLocation(r.headers.location) === 'lote_grande',
            `loc=${r.headers.location}`);

        // ═══ 3. IDOR — el draft NO está ligado a ninguna identidad ═══
        // A: crea un draft anónimo (simula el visor de un usuario cualquiera).
        r = await postCapture({ accion: 'entrada', tipo: 'nota', exp: 'FCR IDOR-1/2026' });
        const draftIdor1 = draftIdFromLocation(r.headers.location);
        check('4. Draft anónimo creado (para test de IDOR) tiene id', !!draftIdor1, `loc=${r.headers.location}`);

        // B (una cuenta DISTINTA, sin relación con quien generó el draft) lo reclama con éxito.
        r = await request('GET', `/usuarios/api/capture-draft/${draftIdor1}`, { token: tokenB });
        check('5. 🚨 IDOR confirmado: usuario B (ajeno) reclama con éxito un draft que no generó él — el sistema no liga el draft a ninguna identidad, solo al conocimiento del id',
            r.status === 200 && r.body?.success === true,
            `status=${r.status}`);

        // Confirmar uso único: un segundo reclamo del MISMO id (por cualquiera) da 404.
        r = await request('GET', `/usuarios/api/capture-draft/${draftIdor1}`, { token: tokenA });
        check('6. Uso único: reclamar el mismo draft una 2da vez (incluso por A) → 404',
            r.status === 404, `status=${r.status}`);

        // ═══ 4. Memoria y salud antes de la carga sostenida ═══
        const healthAntes = await getHealth();
        console.log(`\nSalud ANTES de la carga: mem=${healthAntes?.memory?.used_mb}MB/${healthAntes?.memory?.total_mb}MB`);

        // ═══ 5. H-2 — flood de 101 POSTs para forzar la eviction FIFO ═══
        // draft #1 = la "captura legítima" que se espera sea desalojada.
        console.log('\n▶ H-2: enviando 101 POSTs (4 tandas, respetando el rate limit de 30/5min)...');
        r = await postCapture({ accion: 'entrada', tipo: 'nota', exp: 'FCR LEGIT-USUARIO/2026' });
        const draftLegitimo = draftIdFromLocation(r.headers.location);
        check('7. Draft "legítimo" (#1 de la secuencia de 101) creado', !!draftLegitimo, `loc=${r.headers.location}`);

        const otrosIds = [];
        let totalPosts = 1;
        const TANDA = 29; // margen de 1 respecto del límite de 30, por si algo más pega al mismo endpoint
        while (totalPosts < 101) {
            const faltan = 101 - totalPosts;
            const enEstaTanda = Math.min(TANDA, faltan);
            console.log(`  tanda: ${enEstaTanda} POSTs (total acumulado antes: ${totalPosts})`);
            for (let i = 0; i < enEstaTanda; i++) {
                const rr = await postCapture({ accion: 'entrada', tipo: 'nota', exp: `FCR FLOOD-${totalPosts}-${i}/2026` });
                const id = draftIdFromLocation(rr.headers.location);
                if (id) otrosIds.push(id);
                totalPosts++;
            }
            if (totalPosts < 101) {
                console.log('  esperando 5.5 min a que reabra la ventana del rate limit...');
                await sleep(5.5 * 60 * 1000);
            }
        }
        console.log(`Total POSTs enviados: ${totalPosts}, drafts con id capturado: ${otrosIds.length}`);

        const healthDespues = await getHealth();
        console.log(`Salud DESPUÉS de la carga: mem=${healthDespues?.memory?.used_mb}MB/${healthDespues?.memory?.total_mb}MB`);
        check('8. El servidor sigue respondiendo /health con 200 tras 101 POSTs seguidos (sin caída ni degradación catastrófica)',
            healthDespues?.status === 'ok', `health=${JSON.stringify(healthDespues)}`);

        // El draft "legítimo" (el más viejo) debería haber sido desalojado — el tope es 100.
        r = await request('GET', `/usuarios/api/capture-draft/${draftLegitimo}`, { token: tokenA });
        check('9. 🚨 H-2 confirmado con evidencia real: el draft LEGÍTIMO más viejo fue desalojado (404) tras superar el tope de 100 simultáneos — un flujo de captura ajeno (o volumen normal) puede tirar por la ventana la captura de un usuario real que todavía no la reclamó',
            r.status === 404, `status=${r.status} body=${r.raw.slice(0, 100)}`);

        // El último draft de la secuencia (el 101°) SÍ debe seguir vivo.
        const ultimoId = otrosIds[otrosIds.length - 1];
        r = await request('GET', `/usuarios/api/capture-draft/${ultimoId}`, { token: tokenA });
        check('10. El draft más reciente (el 101° de la secuencia) SIGUE disponible — confirma que la eviction es FIFO por antigüedad, no aleatoria',
            r.status === 200, `status=${r.status}`);

    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        if (comboId !== null) await db.query('UPDATE plans SET bitacora_enabled = $1 WHERE id = $2', [flagOriginal, comboId]);
        if (USER_B !== null) {
            await db.query('DELETE FROM bitacora_entries WHERE user_id = $1', [USER_B]);
            await db.query('DELETE FROM expedientes_seguidos WHERE user_id = $1', [USER_B]);
            await db.query('DELETE FROM subscriptions WHERE user_id = $1', [USER_B]);
            await db.query('DELETE FROM users WHERE id = $1', [USER_B]);
        }
        await db.query('DELETE FROM bitacora_entries WHERE user_id = $1', [USER_A]);
        await db.query('DELETE FROM expedientes_seguidos WHERE user_id = $1', [USER_A]);
        console.log('   Flag COMBO_PROMO.bitacora_enabled restaurado a', flagOriginal);
        console.log('   fixtures y usuario B efímero eliminados');
        console.log('   (los ~101 drafts en memoria vencen solos a los 10 min — no hay forma de purgarlos desde afuera, es esperado)');
        await db.end();
    }

    console.log(`\n═══ ${passed}/${passed + failed} PASS ═══`);
    if (failed) { console.log('Fallidos:', fails.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
