/**
 * verify-etapa15-f2-quota.js — Etapa 1.5, F2 (cupo de la cuenta de verificación).
 *
 * 🔴 Es la ÚNICA parte del bloque 1.5 que OTORGA cupo, así que el harness se centra en
 * las 7 protecciones del plan (§7 F2), no solo en el camino feliz. El caso más importante
 * es el #6: que el endpoint IGNORE un `user_id` mandado por el cliente.
 *
 * Crea en staging un fixture con el CUIT de verificación (que ahí no existe), lo manipula
 * para forzar cada escenario, y lo borra al terminar.
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-etapa15-f2-quota.js dotenv_config_path=.env.staging
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

const CUIT_VERIF = process.env.VERIFICATION_TEST_CUIT || '27320694359';

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

function request(method, urlPath, { token, body } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const payload = body ? JSON.stringify(body) : null;
        if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
        const req = https.request(BASE_URL + urlPath, { method, headers }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
                resolve({ status: res.statusCode, body: json });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

const tokenAdmin = () => jwt.sign({ id: 6, email: 'admin@procurador.com', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

async function main() {
    console.log(`▶ Etapa 1.5 F2 — cupo de verificación, contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);
    const tokenA = tokenAdmin();

    let userVerif = null;   // fixture con el CUIT de verificación
    let userOtro = null;    // 2ª cuenta, para probar la PROTECCIÓN 2
    let comboId = null;
    const parteIds = [];

    // Deja el cupo del fixture en un estado concreto (usa SQL directo, no endpoints).
    const setCupo = async (vals) => {
        await db.query(
            `UPDATE subscriptions SET usage_count=$2, usage_limit=$3,
                    proc_usage=$4, batch_usage=$5, informe_usage=$6, monitor_novedades_usage=$7,
                    proc_bonus=$8, batch_bonus=$9, informe_bonus=$10, monitor_novedades_bonus=$11
              WHERE user_id=$1`,
            [userVerif, vals.usage_count, vals.usage_limit, vals.proc, vals.batch, vals.informe,
             vals.monitor, vals.proc_b || 0, vals.batch_b || 0, vals.informe_b || 0, vals.monitor_b || 0]
        );
    };
    const limpiarCooldown = () => db.query("DELETE FROM admin_events WHERE action='verification_quota_topup'");
    const leerSub = async () => (await db.query('SELECT * FROM subscriptions WHERE user_id=$1', [userVerif])).rows[0];

    try {
        comboId = (await db.query("SELECT id FROM plans WHERE name='COMBO_PROMO'")).rows[0].id;

        const mk = async (email, cuit) => {
            const { rows } = await db.query(
                `INSERT INTO users (email, password_hash, role, registration_status, email_verified, cuit)
                 VALUES ($1,'x','user','active',true,$2) RETURNING id`, [email, cuit]);
            const id = rows[0].id;
            await db.query(
                `INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at)
                 VALUES ($1,'COMBO_PROMO',$2,'active',0,110, NOW() + INTERVAL '30 days')`, [id, comboId]);
            return id;
        };
        userVerif = await mk('f2-verif-fixture@stub.local', CUIT_VERIF);
        userOtro  = await mk('f2-otro-fixture@stub.local', '20999999992');
        console.log(`Fixture: cuenta de verificación = ${userVerif} (CUIT ${CUIT_VERIF}) · otra cuenta = ${userOtro}\n`);

        // 2 partes activas → el costo de monitor por prueba debe ser 2
        for (const nombre of ['F2 PARTE UNO', 'F2 PARTE DOS']) {
            const { rows } = await db.query(
                `INSERT INTO monitor_partes (user_id, nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla, tiene_linea_base, activo)
                 VALUES ($1,$2,'14','FCR',true,true) RETURNING id`, [userVerif, nombre]);
            parteIds.push(rows[0].id);
        }

        // ── 1-2. Auth ────────────────────────────────────────────────────────
        let r = await request('GET', '/admin/diagnostics/verification/quota');
        check('1. GET /quota sin token → 401', r.status === 401, `status=${r.status}`);
        r = await request('POST', '/admin/diagnostics/verification/quota/top-up');
        check('2. POST /top-up sin token → 401 (PROTECCIÓN 1)', r.status === 401, `status=${r.status}`);

        // ── 3-4. Lectura del estado ──────────────────────────────────────────
        await setCupo({ usage_count: 0, usage_limit: 110, proc: 0, batch: 0, informe: 0, monitor: 0 });
        r = await request('GET', '/admin/diagnostics/verification/quota', { token: tokenA });
        check('3. GET /quota → 200 con los 4 submódulos + global', r.status === 200 &&
            ['proc', 'batch', 'informe', 'monitor_novedades'].every(k => r.body?.cupo?.submodulos?.[k]) && !!r.body?.cupo?.global);
        check('4. El costo de monitor por prueba = partes activas (2), no un número fijo',
            r.body?.cupo?.partesActivas === 2 && r.body?.cupo?.submodulos?.monitor_novedades?.costoPorPrueba === 2,
            `partes=${r.body?.cupo?.partesActivas} costo=${r.body?.cupo?.submodulos?.monitor_novedades?.costoPorPrueba}`);
        check('5. Con la cuenta vacía, alcanzaParaUnaPrueba = true', r.body?.cupo?.alcanzaParaUnaPrueba === true);

        // ── 6. PROTECCIÓN 3 — idempotencia: si ya alcanza, no toca nada ──────
        r = await request('POST', '/admin/diagnostics/verification/quota/top-up', { token: tokenA });
        check('6. Con cupo de sobra → aplicado:false, motivo "ya_alcanza" (PROTECCIÓN 3)',
            r.status === 200 && r.body?.aplicado === false && r.body?.motivo === 'ya_alcanza', JSON.stringify(r.body?.motivo));
        const eventosTrasIdem = (await db.query("SELECT COUNT(*)::int c FROM admin_events WHERE action='verification_quota_topup'")).rows[0].c;
        check('7. Una llamada que no aplicó nada NO escribe auditoría (no dispara el cooldown)', eventosTrasIdem === 0, `eventos=${eventosTrasIdem}`);

        // ── 8-11. Recarga real ───────────────────────────────────────────────
        // informe 48/50 (quedan 2, la reserva pide 6) y global 105/110 (quedan 5, pide 12)
        await setCupo({ usage_count: 105, usage_limit: 110, proc: 0, batch: 0, informe: 48, monitor: 0 });
        const subAntes = await leerSub();

        r = await request('POST', '/admin/diagnostics/verification/quota/top-up', { token: tokenA });
        check('8. Con cupo insuficiente → aplicado:true', r.status === 200 && r.body?.aplicado === true, JSON.stringify(r.body?.motivo));
        check('9. Tras recargar, alcanzaParaReserva = true', r.body?.cupo?.alcanzaParaReserva === true);

        const subDespues = await leerSub();
        check('10. PROTECCIÓN 7 — los contadores de USO no se tocaron (solo bonus/limit)',
            subDespues.informe_usage === subAntes.informe_usage &&
            subDespues.usage_count === subAntes.usage_count &&
            subDespues.proc_usage === subAntes.proc_usage,
            `informe_usage ${subAntes.informe_usage}→${subDespues.informe_usage}, usage_count ${subAntes.usage_count}→${subDespues.usage_count}`);
        check('11. Subió informe_bonus y usage_limit (los dos mecanismos de §4)',
            subDespues.informe_bonus > subAntes.informe_bonus && subDespues.usage_limit > subAntes.usage_limit,
            `bonus ${subAntes.informe_bonus}→${subDespues.informe_bonus}, limit ${subAntes.usage_limit}→${subDespues.usage_limit}`);
        check('12. PROTECCIÓN 6 — quedó la auditoría en admin_events',
            (await db.query("SELECT COUNT(*)::int c FROM admin_events WHERE action='verification_quota_topup'")).rows[0].c === 1);
        check('13. Y el ajuste quedó también en usage_adjustments',
            (await db.query('SELECT COUNT(*)::int c FROM usage_adjustments WHERE user_id=$1', [userVerif])).rows[0].c > 0);

        // ── 14. PROTECCIÓN 5 — cooldown ──────────────────────────────────────
        await setCupo({ usage_count: 105, usage_limit: 110, proc: 0, batch: 0, informe: 48, monitor: 0 });
        r = await request('POST', '/admin/diagnostics/verification/quota/top-up', { token: tokenA });
        check('14. PROTECCIÓN 5 — 2ª recarga dentro de 24 h → 429 cooldown',
            r.status === 429 && r.body?.motivo === 'cooldown', `status=${r.status} motivo=${r.body?.motivo}`);

        // ── 15-16. 🚨 PROTECCIÓN 2 — el user_id del cliente se IGNORA ────────
        // El test más importante del harness: si esto fallara, el endpoint sería una vía
        // para recargarle cupo a cualquier cuenta.
        await limpiarCooldown();
        const otroAntes = (await db.query('SELECT * FROM subscriptions WHERE user_id=$1', [userOtro])).rows[0];
        await setCupo({ usage_count: 105, usage_limit: 110, proc: 0, batch: 0, informe: 48, monitor: 0 });

        r = await request('POST', '/admin/diagnostics/verification/quota/top-up', {
            token: tokenA,
            body: { user_id: userOtro, userId: userOtro, cuit: '20999999992' }
        });
        const otroDespues = (await db.query('SELECT * FROM subscriptions WHERE user_id=$1', [userOtro])).rows[0];
        check('15. 🚨 PROTECCIÓN 2 — con user_id ajeno en el body, la OTRA cuenta queda intacta',
            otroDespues.usage_limit === otroAntes.usage_limit &&
            otroDespues.informe_bonus === otroAntes.informe_bonus &&
            otroDespues.proc_bonus === otroAntes.proc_bonus,
            `limit ${otroAntes.usage_limit}→${otroDespues.usage_limit}, informe_bonus ${otroAntes.informe_bonus}→${otroDespues.informe_bonus}`);
        check('16. 🚨 PROTECCIÓN 2 — la recarga se aplicó a la cuenta de verificación, no a la del body',
            r.body?.aplicado === true && r.body?.cupo?.cuit === CUIT_VERIF, `cuit recargado=${r.body?.cupo?.cuit}`);

        // ── 17. PROTECCIÓN 4 — techo de bonus acumulado ──────────────────────
        // El escenario tiene que cumplir DOS condiciones a la vez para llegar al techo:
        // que falte cupo (remaining < necesario) Y que bonus + faltante supere 200. Con
        // bonus=199 y used bajo, el remaining es enorme y no hay faltante — el primer
        // intento de este test fallaba por eso (error del test, no del endpoint).
        // limit 50 + bonus 199 = 249 efectivo; con used=245 quedan 4 y la reserva pide 6
        // → faltante 2, y 199+2 supera el techo → debe recortar a 1.
        await limpiarCooldown();
        await setCupo({ usage_count: 0, usage_limit: 110, proc: 0, batch: 0, informe: 245, monitor: 0, informe_b: 199 });
        r = await request('POST', '/admin/diagnostics/verification/quota/top-up', { token: tokenA });
        const subTecho = await leerSub();
        check('17. PROTECCIÓN 4 — el techo de bonus acumulado (200) se respeta y se deja constancia',
            subTecho.informe_bonus <= 200 && (r.body?.recortados || []).some(x => x.motivo === 'techo_bonus_acumulado'),
            `informe_bonus=${subTecho.informe_bonus} recortados=${JSON.stringify(r.body?.recortados)}`);

        // ── 18. Global ilimitado (cuenta paga) → no se toca ──────────────────
        await limpiarCooldown();
        await setCupo({ usage_count: 5, usage_limit: 999999, proc: 0, batch: 0, informe: 48, monitor: 0 });
        await db.query("UPDATE subscriptions SET payment_provider='mercadopago' WHERE user_id=$1", [userVerif]);
        r = await request('POST', '/admin/diagnostics/verification/quota/top-up', { token: tokenA });
        const subPaga = await leerSub();
        check('18. §4.1 — cuenta paga (global 999999): NO se toca el global, sí los submódulos',
            subPaga.usage_limit === 999999 &&
            !(r.body?.aplicados || []).some(a => a.subsistema === 'global') &&
            (r.body?.aplicados || []).some(a => a.subsistema === 'informe' && a.sumado > 0),
            `limit=${subPaga.usage_limit} aplicados=${JSON.stringify(r.body?.aplicados)}`);
        await db.query('UPDATE subscriptions SET payment_provider=NULL WHERE user_id=$1', [userVerif]);

    } catch (e) {
        console.error('❌ Error inesperado en el harness:', e);
        failed++;
    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        await db.query("DELETE FROM admin_events WHERE action='verification_quota_topup'");
        for (const id of [userVerif, userOtro].filter(Boolean)) {
            await db.query('DELETE FROM usage_adjustments WHERE user_id=$1', [id]);
            await db.query('DELETE FROM monitor_partes WHERE user_id=$1', [id]);
            await db.query('DELETE FROM subscriptions WHERE user_id=$1', [id]);
            await db.query('DELETE FROM users WHERE id=$1', [id]);
        }
        await db.end();
        console.log('   fixtures, partes, ajustes y eventos de auditoría eliminados');
    }

    console.log(`\n${passed}/${passed + failed} PASS`);
    if (failed > 0) { console.log('Fallidas:', fails.join(' | ')); process.exit(1); }
}

main();
