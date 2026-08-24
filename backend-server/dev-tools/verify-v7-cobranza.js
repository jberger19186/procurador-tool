/**
 * verify-v7-cobranza.js — V7 del plan de verificación runtime (2026-08-23).
 *
 * Verifica la cadena de cobranza (checkout + webhooks + servicio de suscripción +
 * los crons de gracia/cancelación) contra **staging**, con HTTP real donde la
 * superficie es HTTP y llamadas directas a los módulos reales donde la superficie
 * es de servicio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ REGLA DE SEGURIDAD CENTRAL DE ESTE BLOQUE — leer antes de agregar un caso
 * ═══════════════════════════════════════════════════════════════════════════
 * Este script NUNCA debe alcanzar un camino que ESCRIBA en MercadoPago
 * (crear/pausar/cancelar/actualizar un preapproval). Tres reglas concretas:
 *
 *  1. `/checkout/init` solo se ejercita en casos NEGATIVOS (401/403/400). El
 *     camino feliz llama a `createPreapproval()`, que crea un preapproval REAL
 *     en la cuenta de MP. **Nunca pedir un plan_name que coincida con el de la
 *     suscripción del fixture estando `active`** — eso pasa el guard B3 y cobra.
 *
 *  2. El fixture SIEMPRE lleva `external_subscription_id` con el prefijo
 *     placeholder `pay-`. `resolveRealPreapprovalId()` devuelve el id directo
 *     (→ write a MP) solo si NO empieza con `pay-`; con el placeholder hace una
 *     búsqueda de solo lectura que no matchea nada y devuelve null. Verificado
 *     por `assertFixtureSinPreapprovalReal()` antes de cada cancel/reactivate.
 *
 *  3. Los webhooks se disparan con ids de pago inexistentes: `paymentClient.get()`
 *     es una LECTURA y falla con "not found" (camino benigno ya contemplado).
 *
 * Además: aborta si `DB_NAME` no contiene "staging" (regla nacida del incidente
 * del 2026-07-24), y limpia el fixture al terminar.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-v7-cobranza.js dotenv_config_path=.env.staging
 */

'use strict';

const https  = require('https');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const { Pool } = require('pg');

// `.env.staging` (preload) trae los overrides; JWT_SECRET / MP_* viven en el .env
// base. dotenv no pisa lo ya seteado, así que este load solo RELLENA (mismo patrón
// que verify-v3-bitacora-api.js).
require('dotenv').config();

// ── Guards de seguridad ─────────────────────────────────────────────────────
if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`❌ ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging".`);
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const MP_SECRET  = process.env.MP_WEBHOOK_SECRET;
if (!JWT_SECRET) { console.error('❌ Falta JWT_SECRET.'); process.exit(1); }
if (!MP_SECRET)  { console.error('❌ Falta MP_WEBHOOK_SECRET (necesario para firmar los webhooks).'); process.exit(1); }

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

// Servicio real (no un stub): pure-DB en applyTrialBonus/applyRenewal; cancel /
// reactivate tocan MP solo si el preapproval es resoluble — ver regla 2 arriba.
const subService = require('../services/subscriptionService');

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`✅ ${name}`); }
    else { failed++; fails.push(name); console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function request(method, path, { token, body, headers: extraHeaders } = {}) {
    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        const req = https.request(BASE_URL + path, { method, headers }, (res) => {
            let chunks = '';
            res.on('data', c => chunks += c);
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

const tokenFor = (userId) => jwt.sign({ id: userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

/** Firma un webhook con el mismo manifest que verifyMPSignature(). */
function firmarWebhook(dataId, requestId, ts) {
    const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
    const v1 = crypto.createHmac('sha256', MP_SECRET).update(manifest).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

async function main() {
    console.log(`▶ V7 — Cobranza contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    let USER = null, SUB = null;
    let comboId = null, extensionName = null;

    /**
     * Regla de seguridad 2: confirma que el fixture NO tiene un preapproval
     * resoluble antes de llamar a cancel/reactivate (que escribirían en MP).
     */
    async function assertFixtureSinPreapprovalReal(etiqueta) {
        const { rows: [s] } = await db.query('SELECT external_subscription_id FROM subscriptions WHERE user_id = $1', [USER]);
        const ext = s?.external_subscription_id;
        const seguro = !ext || ext.startsWith('pay-');
        if (!seguro) {
            throw new Error(`ABORT (${etiqueta}): el fixture tiene external_subscription_id="${ext}" ` +
                'que NO es un placeholder pay-* → una llamada a cancel/reactivate escribiría en MercadoPago.');
        }
    }

    try {
        // ── Fixture ────────────────────────────────────────────────────────
        const { rows: planRows } = await db.query(
            "SELECT id, name FROM plans WHERE name IN ('COMBO_PROMO','EXTENSION_PROMO') ORDER BY name DESC"
        );
        comboId = planRows.find(p => p.name === 'COMBO_PROMO').id;
        extensionName = planRows.find(p => p.name === 'EXTENSION_PROMO').name;

        const { rows: [u] } = await db.query(
            `INSERT INTO users (email, password_hash, role, registration_status, email_verified, cuit)
             VALUES ('v7-fixture@stub.local', 'x', 'user', 'active', true, '20999999982') RETURNING id`
        );
        USER = u.id;
        const { rows: [s] } = await db.query(
            `INSERT INTO subscriptions
               (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at,
                external_subscription_id, payment_provider)
             VALUES ($1,'COMBO_PROMO',$2,'active',12,999999, NOW() + INTERVAL '30 days',
                     $3,'mercadopago')
             RETURNING id`,
            [USER, comboId, `pay-V7-${Date.now()}`]
        );
        SUB = s.id;
        console.log(`Fixture: user=${USER} sub=${SUB} plan=COMBO_PROMO, external_subscription_id=pay-* (placeholder seguro)\n`);

        const token = tokenFor(USER);

        // ═══ A. Superficie HTTP: auth y validación ═══
        let r = await request('GET', '/usuarios/api/checkout/status', {});
        check('1. GET /checkout/status sin token → 401', r.status === 401, `status=${r.status}`);

        r = await request('POST', '/usuarios/api/checkout/init', { body: { plan_name: 'COMBO_PROMO' } });
        check('2. POST /checkout/init sin token → 401 (no llega a crear preapproval)', r.status === 401, `status=${r.status}`);

        r = await request('GET', '/usuarios/api/checkout/status', { token });
        check('3. GET /checkout/status con token → 200 con el shape esperado',
            r.status === 200 && r.body?.plan === 'COMBO_PROMO' && r.body?.has_payment_method === true,
            `status=${r.status} body=${r.raw.slice(0, 140)}`);

        r = await request('POST', '/usuarios/api/checkout/init', { token, body: {} });
        check('4. POST /checkout/init sin plan_name → 400', r.status === 400, `status=${r.status}`);

        // ═══ B. Gate de activación (§4 del flujo oficial) ═══
        for (const estado of ['pending_activation', 'pending_email']) {
            await db.query('UPDATE users SET registration_status = $1 WHERE id = $2', [estado, USER]);
            r = await request('POST', '/usuarios/api/checkout/init', { token, body: { plan_name: 'COMBO_PROMO' } });
            check(`5. POST /checkout/init con ${estado} → 403 (debe activar el admin primero)`,
                r.status === 403, `status=${r.status} body=${r.raw.slice(0, 120)}`);
        }
        await db.query("UPDATE users SET registration_status = 'active' WHERE id = $1", [USER]);

        // ═══ C. B3 — guard de plan mismatch (hallazgo 2026-07-24, toca cobro) ═══
        // ⚠️ Este es el ÚNICO caso de /checkout/init con la cuenta `active`, y es a
        // propósito un MISMATCH: así el guard corta ANTES de createPreapproval().
        // Pedir el plan que coincide crearía un preapproval real en MP.
        r = await request('POST', '/usuarios/api/checkout/init', { token, body: { plan_name: extensionName } });
        check('6. POST /checkout/init con plan ≠ al de la suscripción → 400 (guard B3: no se paga un plan y se aplican los límites de otro)',
            r.status === 400, `status=${r.status}`);
        check('7. El mensaje del guard B3 deriva a "Cambiar plan" (no deja al usuario sin salida)',
            /cambiar plan/i.test(r.body?.error || ''), `error=${r.body?.error}`);

        // ═══ D. Webhook — firma HMAC ═══
        const fakePayId = `v7-nonexistent-${Date.now()}`;
        const payload = { type: 'payment', data: { id: fakePayId } };

        r = await request('POST', '/webhooks/mercadopago', { body: payload });
        check('8. Webhook sin x-signature → 401', r.status === 401, `status=${r.status}`);

        r = await request('POST', '/webhooks/mercadopago', { body: payload, headers: { 'x-signature': 'basura', 'x-request-id': 'rq1' } });
        check('9. Webhook con x-signature malformada → 401', r.status === 401, `status=${r.status}`);

        const ts = String(Date.now());
        const buena = firmarWebhook(fakePayId, 'rq-v7', ts);
        r = await request('POST', '/webhooks/mercadopago', {
            body: payload, headers: { ...buena, 'x-signature': `ts=${ts},v1=${'0'.repeat(64)}` }
        });
        check('10. Webhook con firma inválida (hash incorrecto) → 401', r.status === 401, `status=${r.status}`);

        // Prueba POSITIVA — la que el smoke oficial (API-2) NO hace: un 401 sin firma
        // pasaría igual aunque el parseo del body estuviese roto (P-F2.2-a).
        r = await request('POST', '/webhooks/mercadopago', { body: payload, headers: buena });
        check('11. Webhook con firma VÁLIDA → 200 (prueba positiva: la firma se calcula sobre el body parseado)',
            r.status === 200, `status=${r.status}`);

        // El manifest incluye ts: un ts distinto al firmado invalida la firma.
        r = await request('POST', '/webhooks/mercadopago', {
            body: payload, headers: { ...buena, 'x-signature': buena['x-signature'].replace(`ts=${ts}`, `ts=${Number(ts) + 1}`) }
        });
        check('12. Webhook con el mismo v1 pero otro ts → 401 (el ts es parte del manifest firmado)',
            r.status === 401, `status=${r.status}`);

        // ═══ E. Webhook — idempotencia de webhook_events ═══
        await sleep(700);   // el handler responde 200 y procesa en setImmediate
        let { rows: ev } = await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE external_id = $1", [fakePayId]);
        check('13. El webhook con firma válida quedó registrado en webhook_events', ev[0].n === 1, `n=${ev[0].n}`);

        await request('POST', '/webhooks/mercadopago', { body: payload, headers: firmarWebhook(fakePayId, 'rq-v7-b', String(Date.now())) });
        await sleep(700);
        ({ rows: ev } = await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE external_id = $1", [fakePayId]));
        check('14. El mismo external_id reenviado NO duplica la fila (ON CONFLICT DO NOTHING)', ev[0].n === 1, `n=${ev[0].n}`);

        const { rows: pays } = await db.query('SELECT count(*)::int AS n FROM payments WHERE user_id = $1', [USER]);
        check('15. Un payment id inexistente en MP no crea ninguna fila en payments (camino benigno "not found")',
            pays[0].n === 0, `n=${pays[0].n}`);

        // ═══ F. applyTrialBonus — B1 (expires_at) ═══
        const nbd = new Date(Date.now() + 30 * 86400000);
        await db.query(
            `UPDATE subscriptions SET expires_at = NOW() - INTERVAL '1 day', next_billing_date = NULL,
                    trial_bonus_until = NULL, usage_count = 18, usage_limit = 20,
                    proc_usage = 7, informe_usage = 3, batch_usage = 2, monitor_novedades_usage = 5,
                    status = 'suspended' WHERE id = $1`, [SUB]);
        await subService.applyTrialBonus(SUB, 'COMBO_PROMO', nbd);

        let { rows: [sub] } = await db.query('SELECT * FROM subscriptions WHERE id = $1', [SUB]);
        const cerca = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 5000;
        check('16. applyTrialBonus — B1: expires_at AVANZA al fin del período pago (antes quedaba vencido y bloqueaba a un cliente al día)',
            sub.expires_at && cerca(sub.expires_at, nbd), `expires_at=${sub.expires_at}`);
        check('17. applyTrialBonus — next_billing_date = fin del período', sub.next_billing_date && cerca(sub.next_billing_date, nbd), `nbd=${sub.next_billing_date}`);
        check('18. applyTrialBonus — usage_limit = 999999 (tope global desactivado; rige el submódulo)', Number(sub.usage_limit) === 999999, `usage_limit=${sub.usage_limit}`);
        check('19. applyTrialBonus — los 4 contadores por submódulo y el global a 0',
            [sub.usage_count, sub.proc_usage, sub.informe_usage, sub.batch_usage, sub.monitor_novedades_usage].every(v => Number(v) === 0),
            `count=${sub.usage_count} proc=${sub.proc_usage} inf=${sub.informe_usage} batch=${sub.batch_usage} nov=${sub.monitor_novedades_usage}`);
        check('20. applyTrialBonus — status=active y trial_bonus_until seteado',
            sub.status === 'active' && !!sub.trial_bonus_until, `status=${sub.status} tbu=${sub.trial_bonus_until}`);

        // ═══ G. applyRenewal — B1 + limpieza de gracia/cancelación ═══
        const nbd2 = new Date(Date.now() + 60 * 86400000);
        await db.query(
            `UPDATE subscriptions SET expires_at = NOW() - INTERVAL '1 day',
                    payment_grace_ends_at = NOW() + INTERVAL '1 day', suspension_cause = 'payment',
                    suspended_at = NOW(), cancel_at = NOW() + INTERVAL '5 days', auto_renewal = FALSE,
                    usage_count = 40, proc_usage = 40, status = 'suspended' WHERE id = $1`, [SUB]);
        await subService.applyRenewal(SUB, 'COMBO_PROMO', nbd2);

        ({ rows: [sub] } = await db.query('SELECT * FROM subscriptions WHERE id = $1', [SUB]));
        check('21. applyRenewal — B1: expires_at avanza con la renovación', sub.expires_at && cerca(sub.expires_at, nbd2), `expires_at=${sub.expires_at}`);
        check('22. applyRenewal — limpia la gracia por pago (payment_grace_ends_at / suspension_cause / suspended_at)',
            !sub.payment_grace_ends_at && !sub.suspension_cause && !sub.suspended_at,
            `grace=${sub.payment_grace_ends_at} cause=${sub.suspension_cause} susp=${sub.suspended_at}`);
        check('23. applyRenewal — limpia cancel_at y restaura auto_renewal (un cobro aprobado revierte una baja programada que MP no llegó a cancelar)',
            sub.cancel_at === null && sub.auto_renewal === true, `cancel_at=${sub.cancel_at} auto=${sub.auto_renewal}`);
        check('24. applyRenewal — contadores a 0 y status=active',
            Number(sub.usage_count) === 0 && Number(sub.proc_usage) === 0 && sub.status === 'active',
            `count=${sub.usage_count} proc=${sub.proc_usage} status=${sub.status}`);

        // ═══ H. B2 — un plan fuera de PLAN_LIMITS NO debe abortar (perdía el pago) ═══
        let throwB2 = null;
        try { await subService.applyTrialBonus(SUB, 'PLAN_PRIVADO_INEXISTENTE_V7', nbd); }
        catch (e) { throwB2 = e; }
        check('25. B2 — applyTrialBonus con un plan fuera de PLAN_LIMITS NO lanza (antes hacía ROLLBACK de la transacción del webhook → pago perdido)',
            throwB2 === null, `err=${throwB2 && throwB2.message}`);

        throwB2 = null;
        try { await subService.applyRenewal(SUB, 'PLAN_PRIVADO_INEXISTENTE_V7', nbd2); }
        catch (e) { throwB2 = e; }
        check('26. B2 — applyRenewal con un plan fuera de PLAN_LIMITS tampoco lanza', throwB2 === null, `err=${throwB2 && throwB2.message}`);

        // ═══ I. cancelSubscription ═══
        await db.query(
            `UPDATE subscriptions SET next_billing_date = $2, expires_at = $2, cancel_at = NULL,
                    auto_renewal = TRUE WHERE id = $1`, [SUB, nbd2]);
        await assertFixtureSinPreapprovalReal('cancelSubscription');
        const { cancelAt } = await subService.cancelSubscription(USER);

        ({ rows: [sub] } = await db.query('SELECT * FROM subscriptions WHERE id = $1', [SUB]));
        check('27. cancelSubscription — cancel_at = fin del período pago (el usuario conserva el acceso ya pagado)',
            cerca(sub.cancel_at, nbd2) && cerca(cancelAt, nbd2), `cancel_at=${sub.cancel_at}`);
        check('28. cancelSubscription — auto_renewal = FALSE', sub.auto_renewal === false, `auto=${sub.auto_renewal}`);
        const { rows: evc } = await db.query(
            "SELECT count(*)::int AS n FROM user_events WHERE user_id = $1 AND event_type = 'subscription_cancel_scheduled'", [USER]);
        check('29. cancelSubscription — queda registrado en el historial de la cuenta (visible en la ficha del admin)', evc[0].n === 1, `n=${evc[0].n}`);

        // B1 defensivo: sin next_billing_date, cancel_at NO debe quedar NULL
        await db.query(
            `UPDATE subscriptions SET next_billing_date = NULL, expires_at = $2, cancel_at = NULL,
                    auto_renewal = TRUE WHERE id = $1`, [SUB, nbd2]);
        await assertFixtureSinPreapprovalReal('cancelSubscription-defensivo');
        await subService.cancelSubscription(USER);
        ({ rows: [sub] } = await db.query('SELECT cancel_at FROM subscriptions WHERE id = $1', [SUB]));
        check('30. cancelSubscription — B1 defensivo: con next_billing_date NULL, cancel_at cae a expires_at (no queda NULL = acceso vivo sin cobro)',
            sub.cancel_at !== null && cerca(sub.cancel_at, nbd2), `cancel_at=${sub.cancel_at}`);

        // ═══ J. reactivateSubscription — guards ═══
        await db.query('UPDATE subscriptions SET cancel_at = NULL WHERE id = $1', [SUB]);
        let err = null;
        try { await subService.reactivateSubscription(USER); } catch (e) { err = e; }
        check('31. reactivateSubscription sin cancelación programada → error explícito', !!err && /no tiene una cancelación/i.test(err.message), `err=${err && err.message}`);

        await db.query("UPDATE subscriptions SET cancel_at = NOW() - INTERVAL '2 days' WHERE id = $1", [SUB]);
        err = null;
        try { await subService.reactivateSubscription(USER); } catch (e) { err = e; }
        check('32. reactivateSubscription con cancel_at ya vencido → error (hay que re-suscribirse, no reanudar)',
            !!err && /venció/i.test(err.message), `err=${err && err.message}`);

        await db.query('UPDATE subscriptions SET cancel_at = $2 WHERE id = $1', [SUB, nbd2]);
        await assertFixtureSinPreapprovalReal('reactivateSubscription');
        err = null;
        try { await subService.reactivateSubscription(USER); } catch (e) { err = e; }
        check('33. reactivateSubscription sin preapproval reanudable en MP → error (el portal ofrece re-suscribirse con checkout nuevo)',
            !!err && /mercadopago/i.test(err.message), `err=${err && err.message}`);
        ({ rows: [sub] } = await db.query('SELECT cancel_at FROM subscriptions WHERE id = $1', [SUB]));
        check('34. …y NO limpia cancel_at si no pudo reanudar en MP (si no, quedaría acceso sin cobro garantizado)',
            sub.cancel_at !== null, `cancel_at=${sub.cancel_at}`);

        // ═══ K. Crons — gracia por pago y cancelación vencida ═══
        const SQL_CRON_GRACIA = `
            SELECT u.id FROM users u JOIN subscriptions s ON u.id = s.user_id
            WHERE u.registration_status = 'active'
              AND s.payment_grace_ends_at IS NOT NULL AND s.payment_grace_ends_at < NOW() AND u.id = $1`;

        await db.query("UPDATE users SET registration_status='active' WHERE id=$1", [USER]);
        await db.query("UPDATE subscriptions SET payment_grace_ends_at = NOW() + INTERVAL '2 days' WHERE id=$1", [SUB]);
        let { rowCount } = await db.query(SQL_CRON_GRACIA, [USER]);
        check('35. Cron de suspensión por pago — gracia AÚN VIGENTE no selecciona al usuario', rowCount === 0, `rowCount=${rowCount}`);

        await db.query("UPDATE subscriptions SET payment_grace_ends_at = NOW() - INTERVAL '1 hour' WHERE id=$1", [SUB]);
        ({ rowCount } = await db.query(SQL_CRON_GRACIA, [USER]));
        check('36. Cron de suspensión por pago — gracia VENCIDA sí lo selecciona', rowCount === 1, `rowCount=${rowCount}`);

        const SQL_CRON_CANCEL = `
            SELECT u.id FROM users u JOIN subscriptions s ON u.id = s.user_id
            WHERE u.registration_status = 'active' AND s.cancel_at IS NOT NULL
              AND s.cancel_at < NOW() - INTERVAL '2 hours' AND s.auto_renewal = FALSE
              AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'approved'
                              AND p.created_at > s.cancel_at - INTERVAL '1 hour')
              AND u.id = $1`;

        await db.query("UPDATE subscriptions SET payment_grace_ends_at = NULL, cancel_at = NOW() - INTERVAL '3 hours', auto_renewal = FALSE WHERE id=$1", [SUB]);
        ({ rowCount } = await db.query(SQL_CRON_CANCEL, [USER]));
        check('37. Cron de cancelaciones vencidas — cancel_at pasado + auto_renewal=FALSE lo selecciona', rowCount === 1, `rowCount=${rowCount}`);

        // Doble protección: un pago aprobado reciente lo saca de la selección.
        await db.query(
            `INSERT INTO payments (user_id, subscription_id, external_payment_id, amount, currency, status, plan, created_at)
             VALUES ($1,$2,$3,15000,'ARS','approved','COMBO_PROMO', NOW())`,
            [USER, SUB, `v7-guard-${Date.now()}`]);
        ({ rowCount } = await db.query(SQL_CRON_CANCEL, [USER]));
        check('38. Cron de cancelaciones vencidas — un pago APROBADO reciente lo excluye (doble protección: no cancelar a quien acaba de pagar)',
            rowCount === 0, `rowCount=${rowCount}`);

        await db.query("UPDATE subscriptions SET auto_renewal = TRUE WHERE id=$1", [SUB]);
        ({ rowCount } = await db.query(SQL_CRON_CANCEL, [USER]));
        check('39. Cron de cancelaciones vencidas — auto_renewal=TRUE lo excluye', rowCount === 0, `rowCount=${rowCount}`);

    } finally {
        console.log('\n🧹 Limpiando fixture...');
        if (USER !== null) {
            await db.query('DELETE FROM notifications WHERE user_id = $1', [USER]).catch(() => {});
            await db.query('DELETE FROM user_events WHERE user_id = $1', [USER]).catch(() => {});
            await db.query('DELETE FROM payments WHERE user_id = $1', [USER]).catch(() => {});
            await db.query('DELETE FROM invoices WHERE user_id = $1', [USER]).catch(() => {});
            await db.query('DELETE FROM subscriptions WHERE user_id = $1', [USER]);
            await db.query('DELETE FROM users WHERE id = $1', [USER]);
        }
        await db.query("DELETE FROM webhook_events WHERE external_id LIKE 'v7-nonexistent-%'").catch(() => {});
        console.log('   usuario/suscripción/pagos/eventos del fixture eliminados');
        console.log('   webhook_events de prueba eliminados');
        await db.end();
    }

    console.log(`\n═══ ${passed}/${passed + failed} PASS ═══`);
    if (failed) { console.log('Fallidos:', fails.join(', ')); process.exit(1); }
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
