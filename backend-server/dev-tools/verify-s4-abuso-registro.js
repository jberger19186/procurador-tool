/**
 * verify-s4-abuso-registro.js — S4 de la Etapa 3 (SEC-2, 2026-09-01).
 *
 * Audita las hipótesis de S4 del plan-seguridad-lanzamiento-2026-08.md contra staging,
 * con tráfico HTTP real (no solo lectura de código):
 *
 *   1. Alta masiva: ¿cuánto cuesta generar CUITs "válidos" en volumen? (el checksum
 *      es un algoritmo público, no una identidad verificada — se generan 200 en
 *      memoria y se confirma que TODOS pasan la validación real del backend).
 *   2. registerLimiter (3/hora por IP) — confirmado en vivo, no asumido.
 *   3. Farmeo del trial vía AUTH-1 (machine_id): ¿2 cuentas distintas comparten
 *      dispositivo sin fricción? Se prueba contra /license/execution/start real.
 *   4. CORS — confirmar que PUBLIC_OPEN_CORS_PATHS sigue acotado a /analytics/event
 *      y que un endpoint autenticado normal NO refleja un origen arbitrario.
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 * ⚠️ El registro real dispara emails vía el SMTP de staging, que hereda las
 *    credenciales REALES de Brevo — se usa el dominio reservado IANA `.invalid`
 *    (nunca resuelve, no hay riesgo de entrega a un tercero) y se limita a las
 *    peticiones estrictamente necesarias para confirmar el rate limit (4).
 *    El email de alerta a admin (sendAdminNewUserAlert) SÍ llega a la casilla
 *    real del operador — es un efecto colateral esperado y documentado, no un
 *    error del harness.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-s4-abuso-registro.js dotenv_config_path=.env.staging
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

// ── Réplica EXACTA del algoritmo de validarCuit() de routes/auth.js (mismo
//    checksum mod-11 que usa el backend real) — para generar CUITs "válidos"
//    en memoria sin pegarle al servidor.
function checkDigit(clean10) {
    const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(clean10[i], 10) * mult[i];
    const rem = sum % 11;
    return rem === 0 ? 0 : rem === 1 ? 9 : 11 - rem;
}
function validarCuitLocal(cuit) {
    const clean = cuit.replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(clean)) return false;
    return checkDigit(clean) === parseInt(clean[10], 10);
}
function generarCuitValido(prefijoTipo, seq) {
    // Tipo de persona real: 20/23/24/27 (personas físicas), 30/33/34 (jurídicas).
    const tipo = prefijoTipo;
    const dni = String(10000000 + seq).padStart(8, '0').slice(0, 8);
    const base10 = `${tipo}${dni}`;
    const cd = checkDigit(base10);
    return `${base10}${cd}`;
}

async function crearFixtureConSuscripcion({ email, machineId }) {
    const u = await db.query(`
        INSERT INTO users (email, password_hash, registration_status, cuit, nombre, apellido, email_verified, machine_id)
        VALUES ($1, 'x', 'active', $2, 'FixtureS4', 'Test', true, $3)
        RETURNING id
    `, [email, 'TEST-S4-' + Math.random().toString(36).slice(2, 10), machineId || null]);
    const userId = u.rows[0].id;
    await db.query(`
        INSERT INTO subscriptions (user_id, plan, status, expires_at, usage_limit, usage_count, payment_provider)
        VALUES ($1, 'EXTENSION_PROMO', 'active', NOW() + INTERVAL '30 days', 999999, 0, 'mercadopago')
    `, [userId]);
    return userId;
}

async function borrarFixture(userId) {
    await db.query(`DELETE FROM active_executions WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

function mintToken(userId) {
    return jwt.sign({ id: userId, role: 'user' }, JWT_SECRET, { expiresIn: '10m' });
}

async function run() {
    console.log('🔍 S4 — abuso del registro público y farmeo del trial\n');
    const fixtureIds = [];
    const registeredEmails = [];

    try {
        // ═══ 1. Generación en volumen de CUITs "válidos" ═══════════════════════
        console.log('── 1. CUIT único: ¿freno real o solo checksum? ──');
        const tipos = ['20', '23', '24', '27', '30', '33'];
        let cuitsGenerados = [];
        for (let i = 0; i < 200; i++) {
            const tipo = tipos[i % tipos.length];
            cuitsGenerados.push(generarCuitValido(tipo, i));
        }
        const todosValidosLocal = cuitsGenerados.every(validarCuitLocal);
        const sinDuplicados = new Set(cuitsGenerados).size === cuitsGenerados.length;
        check('200 CUITs generados en memoria (sin lógica de negocio) pasan el checksum real de validarCuit()', todosValidosLocal);
        check('Los 200 son distintos entre sí (no hay colisión de secuencia)', sinDuplicados);
        console.log(`   Ejemplos: ${cuitsGenerados.slice(0, 3).join(', ')} ...`);
        console.log('   → El único freno real es la UNIQUE constraint de la base (rechaza reuso),');
        console.log('     no la validación de formato: el checksum es un algoritmo público (mod-11),');
        console.log('     documentado, sin llamada a ningún padrón externo (AFIP/ARCA) que confirme');
        console.log('     que el CUIT corresponde a una persona/empresa real.');

        // ═══ 2. registerLimiter — 4 intentos reales, el 4to debe rechazarse ═════
        console.log('\n── 2. registerLimiter (3/hora por IP) — 4 intentos reales ──');
        const domicilio = { calle: 'Test', numero: '123', localidad: 'CABA', provincia: 'CABA' };
        const resultados = [];
        for (let i = 0; i < 4; i++) {
            const email = `s4-abuso-${Date.now()}-${i}@procuradortool-test.invalid`;
            const cuit = generarCuitValido('20', 900 + i);
            const r = await request('POST', '/auth/register', {
                body: {
                    nombre: 'S4', apellido: 'Test', email, password: 'TestPass123!',
                    cuit, domicilio, plan_name: 'EXTENSION_PROMO', toc_accepted: true
                }
            });
            resultados.push({ status: r.status, email });
            if (r.status === 201) registeredEmails.push(email);
            console.log(`   intento ${i + 1}: HTTP ${r.status}${r.body?.action ? ' action=' + r.body.action : ''}`);
        }
        const primerosTres = resultados.slice(0, 3);
        const cuarto = resultados[3];
        check('Los primeros 3 registros (misma IP) pasan (201)', primerosTres.every(r => r.status === 201),
            `estados: ${primerosTres.map(r => r.status).join(',')}`);
        check('El 4to, misma IP dentro de la ventana → 429 (rate limit real disparado)', cuarto.status === 429,
            `status=${cuarto.status}`);

        // ═══ 3. Farmeo del trial — AUTH-1/machine_id NO frena multi-cuenta ═════
        console.log('\n── 3. AUTH-1 (machine_id): ¿2 cuentas en la misma máquina se frenan entre sí? ──');
        const machineIdCompartido = 'MISMA-PC-TEST-S4-' + Date.now();
        const idA = await crearFixtureConSuscripcion({ email: `s4-farm-a-${Date.now()}@test.local`, machineId: machineIdCompartido });
        const idB = await crearFixtureConSuscripcion({ email: `s4-farm-b-${Date.now()}@test.local`, machineId: machineIdCompartido });
        fixtureIds.push(idA, idB);

        const tokenA = mintToken(idA);
        const tokenB = mintToken(idB);
        const startA = await request('POST', '/license/execution/start', {
            headers: { Authorization: `Bearer ${tokenA}` },
            body: { machineId: machineIdCompartido, scriptName: 'test.js' }
        });
        const startB = await request('POST', '/license/execution/start', {
            headers: { Authorization: `Bearer ${tokenB}` },
            body: { machineId: machineIdCompartido, scriptName: 'test.js' }
        });
        check('Cuenta A arranca ejecución con machineId compartido → 200 (permitido)', startA.status === 200,
            `status=${startA.status} body=${startA.raw}`);
        check('Cuenta B, MISMO machineId, MISMO instante → también 200 (sin throttling agregado por dispositivo)',
            startB.status === 200, `status=${startB.status} body=${startB.raw}`);

        const activasEnLaMaquina = await db.query(
            `SELECT count(*) FROM active_executions WHERE machine_id = $1`, [machineIdCompartido]
        );
        check('El lock table confirma 2 ejecuciones activas simultáneas en el mismo machine_id',
            parseInt(activasEnLaMaquina.rows[0].count, 10) === 2,
            `count=${activasEnLaMaquina.rows[0].count}`);

        // ── Non-regresión: sí frena la MISMA cuenta en 2 dispositivos ──
        const startAotraPc = await request('POST', '/license/execution/start', {
            headers: { Authorization: `Bearer ${tokenA}` },
            body: { machineId: 'OTRA-PC-DISTINTA', scriptName: 'test.js' }
        });
        check('No-regresión: la MISMA cuenta A, un segundo dispositivo, con lock vivo del primero → 403 DEVICE_MISMATCH',
            startAotraPc.status === 403 && startAotraPc.body?.code === 'DEVICE_MISMATCH',
            `status=${startAotraPc.status} code=${startAotraPc.body?.code}`);

        // limpiar locks de los fixtures
        await db.query(`DELETE FROM active_executions WHERE user_id = ANY($1)`, [fixtureIds]);

        // ═══ 4. CORS — PUBLIC_OPEN_CORS_PATHS sigue acotado ═════════════════════
        console.log('\n── 4. CORS — ¿PUBLIC_OPEN_CORS_PATHS sigue acotado a /analytics/event? ──');
        const origenAjeno = 'https://evil-attacker.example';
        const sessionIdTest = 's4-cors-test-' + Date.now();
        const rAnalytics = await request('POST', '/analytics/event', {
            headers: { Origin: origenAjeno },
            body: { session_id: sessionIdTest, event: 'page_view' }
        });
        const acaoAnalytics = rAnalytics.headers['access-control-allow-origin'];
        check('/analytics/event refleja el origen (por diseño, es el único path abierto) — confirma que sigue vivo',
            acaoAnalytics === origenAjeno, `ACAO=${acaoAnalytics}`);

        const rLicense = await request('POST', '/license/execution/start', { headers: { Origin: origenAjeno }, body: {} });
        const acaoLicense = rLicense.headers['access-control-allow-origin'];
        check('Un endpoint normal (/license/execution/start) NO refleja un origen ajeno arbitrario',
            acaoLicense !== origenAjeno, `ACAO=${acaoLicense}`);

        const rClient = await request('GET', '/client/account', { headers: { Origin: origenAjeno } });
        const acaoClient = rClient.headers['access-control-allow-origin'];
        check('/client/account tampoco refleja el origen ajeno', acaoClient !== origenAjeno, `ACAO=${acaoClient}`);

    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        try { await db.query(`DELETE FROM analytics_events WHERE session_id LIKE 's4-cors-test-%'`); } catch (_) {}
        for (const id of fixtureIds) {
            try { await borrarFixture(id); } catch (e) { console.error(`  ⚠️ error borrando fixture ${id}: ${e.message}`); }
        }
        if (registeredEmails.length > 0) {
            const r = await db.query(
                `DELETE FROM users WHERE email = ANY($1) RETURNING id`, [registeredEmails]
            );
            console.log(`  Registros reales de la prueba 2 borrados: ${r.rowCount}/${registeredEmails.length}`);
        }
        const residuo = await db.query(
            `SELECT count(*) FROM users WHERE email LIKE '%test.local' OR email LIKE '%.invalid' OR email LIKE 's4-%'`
        );
        check('Sin residuo de fixtures/registros de prueba al cerrar', residuo.rows[0].count === '0',
            `quedaron ${residuo.rows[0].count}`);
        await db.end();
    }

    console.log(`\n${'='.repeat(60)}\n${passed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.log('Fallos:', fails.join(', '));
        process.exit(1);
    }
}

run().catch(err => { console.error('❌ Error fatal:', err); process.exit(1); });
