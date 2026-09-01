/**
 * verify-s7-rate-limits.js — S7 de la Etapa 3 (SEC-2, 2026-09-01).
 *
 * Audita las hipótesis de S7 del plan-seguridad-lanzamiento-2026-08.md contra staging,
 * con TRÁFICO REAL (no lectura de código), sobre los 9 rate limiters de
 * middleware/rateLimiter.js:
 *
 *   1. loginLimiter          (20/15min)  — POST /auth/login, credenciales inválidas
 *   2. apiLimiter             (100/min)   — GET /api/extension/electron-token, sin token
 *   3. adminLimiter           (200/min)   — GET /admin/<ruta-inexistente>, sin token
 *   4. generalAuthLimiter     (300/5min)  — GET /monitor/x + GET /license/x (bucket COMPARTIDO
 *                                           entre los 6 mounts que lo usan — se mide eso)
 *   5. analyticsEventLimiter  (60/min)    — POST /analytics/event, público
 *   6. scriptDownloadLimiter  (150/5min)  — GET /client/scripts/download/testM2, con token real
 *   7. scriptExecutionLimiter (30/min)    — POST /scripts/execute, con token real
 *   8. registerLimiter        (3/hora)    — YA confirmado con tráfico real HOY por
 *      verify-s4-abuso-registro.js (3 registros reales → 201, el 4to → 429). Este script
 *      hace 1 sondeo adicional sin crear un registro nuevo (payload inválido, igual cuenta
 *      contra el limiter) para confirmar que el estado sigue vivo en memoria del proceso.
 *   9. captureLimiter         (30/5min)   — YA confirmado con tráfico real HOY por
 *      verify-s1-capture-superficie.js (101 POSTs reales, eviction confirmada). Mismo
 *      criterio: 1 sondeo adicional, sin flood completo (ya costó ~20 min en S1).
 *
 * Además:
 *   - El escenario NAT del estudio jurídico: cuántos "logins" concurrentes (cada uno
 *     descargando los 13 scripts de SCRIPTS_DISTRIBUIBLES) caben desde una sola IP antes
 *     de la auto-denegación de scriptDownloadLimiter.
 *   - Impacto de memoria del proceso durante la corrida completa (via /health).
 *
 * Ningún request de este script ejecuta un flujo real contra el PJN, ni migra la DB, ni
 * escribe en producción. El único estado que deja en la base es 1 fixture de usuario (con
 * suscripción activa, necesaria para scriptDownloadLimiter/scriptExecutionLimiter), borrado
 * en el `finally`.
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-s7-rate-limits.js dotenv_config_path=.env.staging
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

function request(method, path, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const h = { 'Content-Type': 'application/json', ...headers };
        if (data) h['Content-Length'] = Buffer.byteLength(data);
        const req = https.request(BASE_URL + path, { method, headers: h }, (res) => {
            let chunks = '';
            res.on('data', (c) => chunks += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(chunks); } catch (_) {}
                resolve({ status: res.statusCode, headers: res.headers, body: json, raw: chunks });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

// Dispara N requests en tandas de `conc` en paralelo (rápido, sin tumbar el proceso
// de un solo golpe). Devuelve el array de resultados en el mismo orden de disparo.
async function flood(n, factory, conc = 20) {
    const out = new Array(n);
    for (let i = 0; i < n; i += conc) {
        const batch = [];
        for (let j = i; j < Math.min(i + conc, n); j++) batch.push(factory(j).then(r => (out[j] = r)));
        await Promise.all(batch);
    }
    return out;
}

function countStatus(results, status) {
    return results.filter(r => r && r.status === status).length;
}
function firstIndexOfStatus(results, status) {
    return results.findIndex(r => r && r.status === status);
}

// Verifica un umbral SIN depender del orden exacto en que el servidor procesó
// requests concurrentes (Promise.all dentro de cada tanda de `flood()` no
// garantiza que la request de índice N sea la N-ésima que el servidor contó —
// solo garantiza que TODA la tanda anterior ya terminó). En vez de mirar un
// índice puntual, se cuenta cuántas pasaron y cuántas fueron 429, con un
// margen de tolerancia por tráfico residual de fases previas de la cadena.
function checkUmbral(nombre, results, limiteDocumentado, statusExito, tolerancia = 3) {
    const exitosos = countStatus(results, statusExito);
    const bloqueados = countStatus(results, 429);
    check(`${nombre}: al menos 1 request bloqueada con 429 (el limiter disparó de verdad)`,
        bloqueados >= 1, `429=${bloqueados} de ${results.length}`);
    check(`${nombre}: el número de requests que pasaron (${exitosos}) está cerca del umbral documentado (${limiteDocumentado}, ±${tolerancia})`,
        exitosos <= limiteDocumentado && exitosos >= limiteDocumentado - tolerancia,
        `exitosos=${exitosos} límite=${limiteDocumentado}`);
    console.log(`   ${nombre}: exitosos(${statusExito})=${exitosos} bloqueados(429)=${bloqueados} de ${results.length} enviados`);
}

async function health() {
    const r = await request('GET', '/health');
    return r.body;
}

async function crearFixtureConSuscripcion({ email }) {
    const u = await db.query(`
        INSERT INTO users (email, password_hash, registration_status, cuit, nombre, apellido, email_verified)
        VALUES ($1, 'x', 'active', $2, 'FixtureS7', 'Test', true)
        RETURNING id
    `, [email, 'TEST-S7-' + Math.random().toString(36).slice(2, 10)]);
    const userId = u.rows[0].id;
    await db.query(`
        INSERT INTO subscriptions (user_id, plan, status, expires_at, usage_limit, usage_count, payment_provider)
        VALUES ($1, 'COMBO_PROMO', 'active', NOW() + INTERVAL '30 days', 999999, 0, 'mercadopago')
    `, [userId]);
    return userId;
}

async function borrarFixture(userId) {
    await db.query(`DELETE FROM active_executions WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM usage_logs WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

function mintToken(userId) {
    return jwt.sign({ id: userId, role: 'user' }, JWT_SECRET, { expiresIn: '10m' });
}

async function run() {
    console.log('🔍 S7 — rate limits y DoS bajo volumen real\n');
    const fixtureIds = [];
    const sid = 's7-flood-' + Date.now(); // usado en el bloque 5 y limpiado en el finally

    try {
        const memInicio = await health();
        console.log(`   Memoria al inicio: ${memInicio?.memory?.used_mb}MB / ${memInicio?.memory?.total_mb}MB\n`);

        // ═══ 1. loginLimiter (20/15min) — POST /auth/login, credenciales inválidas ═══
        console.log('── 1. loginLimiter (20/15min) — 21 intentos reales ──');
        // /auth/login exige `machineId` en el body (400 sin él, antes de mirar
        // credenciales) — se manda para que el "no bloqueado" real sea 401
        // (credenciales inválidas), representativo de un intento real de fuerza bruta.
        const rLogin = await flood(21, () => request('POST', '/auth/login', {
            body: { email: 's7-loginflood@test.invalid', password: 'wrong-' + Math.random(), machineId: 'S7-LOADTEST-MACHINE' }
        }), 5);
        checkUmbral('loginLimiter (20/15min)', rLogin, 20, 401);

        // ═══ 2. apiLimiter (100/min) — GET /api/extension/electron-token, SIN token ═══
        // Sin Authorization: cuenta igual (apiLimiter corre ANTES del router, en
        // app.use('/api', apiLimiter) — server.js:142, antes de app.use('/api/extension',...)
        // en la línea 194). Evita a propósito pegarle a /electron-download (llama a la API
        // de GitHub sin autenticar en CADA request, compartida con el flujo real de descarga
        // del instalador en producción — ver hallazgo aparte más abajo).
        console.log('\n── 2. apiLimiter (100/min) — 101 requests reales, sin auth ──');
        const rApi = await flood(101, () => request('GET', '/api/extension/electron-token'), 25);
        checkUmbral('apiLimiter (100/min)', rApi, 100, 401);
        console.log('   (cuenta requests sin Authorization — apiLimiter corre ANTES del auth de la ruta)');

        // ═══ 3. adminLimiter (200/min) — GET /admin/<inexistente>, SIN token ═══
        // router.use(adminLimiter) en admin.js:97 corre ANTES de cualquier authenticateAdmin
        // de ruta — cuenta también requests sin credenciales.
        console.log('\n── 3. adminLimiter (200/min) — 201 requests reales, sin auth ──');
        const rAdmin = await flood(201, () => request('GET', '/admin/__s7-loadtest__'), 25);
        checkUmbral('adminLimiter (200/min)', rAdmin, 200, 404);
        console.log('   (ruta inexistente bajo /admin — router.use(adminLimiter) cuenta ANTES de llegar a authenticateAdmin de cualquier ruta real)');

        // ═══ 4. generalAuthLimiter (300/5min) — BUCKET COMPARTIDO entre /tickets,
        //    /monitor, /license, /users, /usuarios/api ×2 (misma instancia de middleware,
        //    server.js:202-205,413-414) ═══
        console.log('\n── 4. generalAuthLimiter (300/5min) — bucket COMPARTIDO entre 2 mounts distintos ──');
        // Tolerancia: si alguna fase previa de la cadena dejó tráfico residual bajo este
        // MISMO limiter compartido (server.js:202-205,413-414) dentro de la ventana de
        // 5 min, el corte real puede caer un poco antes de la posición 300 exacta — no
        // invalida la hipótesis (bucket compartido), así que el check no exige "0 en los
        // primeros 150" sino que el corte aparezca cerca de 300, no cerca de 150 (que sí
        // indicaría un bucket independiente por mount, refutando la hipótesis).
        const mitad1 = 150, mitad2 = 151; // 301 combinados
        const rGA1 = await flood(mitad1, () => request('GET', '/monitor/__s7-loadtest__'), 25);
        const rGA2 = await flood(mitad2, () => request('GET', '/license/__s7-loadtest__'), 25);
        const combinado = [...rGA1, ...rGA2];
        const corte = firstIndexOfStatus(combinado, 429); // -1 si nunca aparece
        check('generalAuthLimiter dispara en algún punto de los 301 combinados (confirma el umbral real, no solo leído del código)',
            corte !== -1, `corte=${corte}`);
        check('El corte aparece cerca de la posición 300 (≥250), no cerca de 150 — confirma que /monitor y /license COMPARTEN el mismo bucket por IP, no uno independiente de 300 cada uno',
            corte >= 250, `corte real en la request combinada #${corte + 1} (esperado ≥251, con margen por tráfico residual de fases previas)`);
        console.log(`   /monitor: 401=${countStatus(rGA1, 401)} 404=${countStatus(rGA1, 404)} 429=${countStatus(rGA1, 429)}`);
        console.log(`   /license: 401=${countStatus(rGA2, 401)} 404=${countStatus(rGA2, 404)} 429=${countStatus(rGA2, 429)}`);
        console.log(`   corte combinado en la request #${corte + 1} de 301 (si fuera independiente por mount, no habría 429 hasta la #301 de CADA mount por separado)`);

        // ═══ 5. analyticsEventLimiter (60/min) — POST /analytics/event, público ═══
        console.log('\n── 5. analyticsEventLimiter (60/min) — 61 requests reales ──');
        const rAnalytics = await flood(61, (i) => request('POST', '/analytics/event', {
            body: { session_id: sid, event: 'page_view', extra: `s7-${i}` }
        }), 20);
        // analyticsEventLimiter responde 200 (o 204 según el handler) al aceptar — se
        // acepta cualquier status distinto de 429 como "no bloqueado" (el handler puede
        // devolver 200 con {ok:true} incluso ante datos parciales, es un beacon público).
        const analyticsAceptados = rAnalytics.filter(r => r.status !== 429).length;
        const analyticsBloqueados = countStatus(rAnalytics, 429);
        check('analyticsEventLimiter (60/min): al menos 1 request bloqueada con 429',
            analyticsBloqueados >= 1, `429=${analyticsBloqueados} de ${rAnalytics.length}`);
        check('analyticsEventLimiter (60/min): los aceptados están cerca del umbral documentado (60, ±3)',
            analyticsAceptados <= 60 && analyticsAceptados >= 57, `aceptados=${analyticsAceptados}`);
        console.log(`   aceptados=${analyticsAceptados} bloqueados(429)=${analyticsBloqueados} de ${rAnalytics.length}`);

        // ═══ Fixture con suscripción activa, para 6 y 7 ═══
        console.log('\n── Creando fixture con suscripción activa (para scriptDownloadLimiter/scriptExecutionLimiter) ──');
        const fixtureId = await crearFixtureConSuscripcion({ email: `s7-fixture-${Date.now()}@test.local` });
        fixtureIds.push(fixtureId);
        const token = mintToken(fixtureId);
        console.log(`   fixture id=${fixtureId}`);

        // ═══ 6. scriptDownloadLimiter (150/5min) — con token real ═══
        console.log('\n── 6. scriptDownloadLimiter (150/5min) — 151 descargas reales de testM2.js ──');
        const rDownload = await flood(151, () => request('GET', '/client/scripts/download/testM2', {
            headers: { Authorization: `Bearer ${token}` }
        }), 20);
        checkUmbral('scriptDownloadLimiter (150/5min)', rDownload, 150, 200);

        // NAT: ¿cuántos "logins" (13 scripts de SCRIPTS_DISTRIBUIBLES c/u) caben antes
        // de la auto-denegación, desde una sola IP?
        const SCRIPTS_POR_LOGIN = 13; // SCRIPTS_DISTRIBUIBLES, client.js:18-25
        const loginsAntesDeAutodenegar = Math.floor(150 / SCRIPTS_POR_LOGIN);
        console.log(`   → NAT: con 150/5min y ~${SCRIPTS_POR_LOGIN} scripts por login real, el cupo compartido de`);
        console.log(`     una IP alcanza para ${loginsAntesDeAutodenegar} logins completos en la misma ventana de 5 min`);
        console.log(`     (${loginsAntesDeAutodenegar * SCRIPTS_POR_LOGIN}/150 usados); el login #${loginsAntesDeAutodenegar + 1} ya`);
        console.log(`     empieza a recibir 429 a mitad de su propia descarga de scripts.`);

        // ═══ 7. scriptExecutionLimiter (30/min) — con token real, scriptName inexistente
        //    (falla rápido en getDecryptedScript sin llegar a vm.Script — ver hallazgo
        //    aparte sobre /scripts/execute) ═══
        console.log('\n── 7. scriptExecutionLimiter (30/min) — 31 requests reales, scriptName inexistente ──');
        const rExec = await flood(31, () => request('POST', '/scripts/execute', {
            headers: { Authorization: `Bearer ${token}` },
            body: { scriptName: 's7-noexiste-' + Date.now(), params: {} }
        }), 10);
        checkUmbral('scriptExecutionLimiter (30/min)', rExec, 30, 500);
        console.log(`   (nota: /scripts/execute usa vm.Script con require expuesto en el sandbox — confirmado`);
        console.log(`    código muerto, ningún cliente real lo llama, ver informe §NN)`);

        // ═══ 8. registerLimiter (3/hora) — sondeo, NO re-flood completo ═══
        // verify-s4-abuso-registro.js ya lo confirmó hoy con 3 registros reales + 4to
        // rechazado. Un sondeo con payload inválido (cuenta igual, no crea usuario ni
        // manda email) confirma que el estado del limiter sigue vivo en memoria del
        // proceso — dato relevante para el punto de instances:1.
        console.log('\n── 8. registerLimiter (3/hora) — sondeo (NO re-flood, ya confirmado hoy por S4) ──');
        const rReg = await request('POST', '/auth/register', { body: { nombre: 'x' } }); // payload incompleto a propósito
        console.log(`   sondeo: HTTP ${rReg.status}${rReg.body?.action ? ' action=' + rReg.body.action : ''}`);
        check('El sondeo da 429 (si la ventana de S4 sigue viva) o 400 (validación, si ya expiró/rotó) — nunca 201 sin datos completos',
            rReg.status === 429 || rReg.status === 400, `status=${rReg.status}`);
        if (rReg.status === 429) {
            console.log('   → confirma que el estado de registerLimiter (S4, misma sesión de auditoría) sigue vivo');
            console.log('     en la memoria del proceso — ninguna corrida posterior lo reinició.');
        }

        // ═══ 9. captureLimiter (30/5min) — sondeo, NO re-flood completo ═══
        // verify-s1-capture-superficie.js ya lo saturó hoy con 101 POSTs reales
        // (costó ~20 min real). Un sondeo confirma que sigue activo sin repetir el costo.
        console.log('\n── 9. captureLimiter (30/5min) — sondeo (NO re-flood, ya confirmado hoy por S1) ──');
        // /usuarios/capture espera application/x-www-form-urlencoded (deep-link de los
        // visores, un <form> HTML real) — el helper request() manda JSON, así que se arma
        // la llamada a mano.
        const rCap = await new Promise((resolve, reject) => {
            const data = 'accion=entrada&expediente=S7-SONDEO';
            const req = https.request(BASE_URL + '/usuarios/capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
            }, (res) => { let c = ''; res.on('data', d => c += d); res.on('end', () => resolve({ status: res.statusCode, raw: c })); });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
        console.log(`   sondeo: HTTP ${rCap.status}`);
        check('El sondeo NO da 500 (captureLimiter sigue montado y respondiendo, 303/429/400 son todos válidos)',
            rCap.status !== 500, `status=${rCap.status}`);

        // ═══ Memoria al cierre del flood completo ═══
        const memFin = await health();
        console.log(`\n   Memoria al cierre del flood: ${memFin?.memory?.used_mb}MB / ${memFin?.memory?.total_mb}MB`);
        check('El proceso sigue respondiendo /health (200) tras ~1000 requests de flood combinadas',
            memFin?.status === 'ok', `status=${memFin?.status}`);

    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        for (const id of fixtureIds) {
            try { await borrarFixture(id); } catch (e) { console.error(`  ⚠️ error borrando fixture ${id}: ${e.message}`); }
        }
        try {
            const r = await db.query(`DELETE FROM analytics_events WHERE session_id = $1 RETURNING id`, [sid]);
            console.log(`  analytics_events de prueba borrados: ${r.rowCount}`);
        } catch (e) { console.error(`  ⚠️ error borrando analytics_events: ${e.message}`); }
        try {
            const residuo = await db.query(`SELECT count(*) FROM users WHERE email LIKE 's7-%'`);
            check('Sin residuo de fixtures S7 al cerrar', residuo.rows[0].count === '0', `quedaron ${residuo.rows[0].count}`);
        } catch (_) { /* no bloquear el cierre por esto */ }
        await db.end();
    }

    console.log(`\n${'='.repeat(60)}\n${passed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.log('Fallos:', fails.join(', '));
        process.exit(1);
    }
}

run().catch(err => { console.error('❌ Error fatal:', err); process.exit(1); });
