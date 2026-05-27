/**
 * routes/webhooks.js
 * Receptor de webhooks de MercadoPago
 *
 * MercadoPago envía notificaciones para:
 *   - payment        → pago aprobado / rechazado
 *   - preapproval    → cambio de estado de la suscripción recurrente
 *
 * Seguridad: firma HMAC-SHA256 validada en cada request
 * Idempotencia: tabla webhook_events evita procesar el mismo evento dos veces
 * Timeout: MP espera 200 en < 22s → procesamiento pesado en setImmediate
 *
 * Montado en server.js:
 *   app.use('/webhooks', require('./routes/webhooks'));
 *   IMPORTANTE: montar ANTES del bodyParser JSON para poder leer rawBody
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');
const { paymentClient } = require('../utils/mercadopago');
const { applyTrialBonus, applyRenewal } = require('../services/subscriptionService');
const { enqueueInvoice }                = require('../services/invoiceService');
const mailer  = require('../utils/mailer');
const logger  = require('../utils/logger');

// ── Middleware: feature flag ──────────────────────────────────────────────────
router.use((req, res, next) => {
  if (process.env.PAYMENT_MODULE_ENABLED !== 'true') {
    return res.status(404).json({ error: 'not found' });
  }
  next();
});

// ── Middleware: raw body para verificar firma ────────────────────────────────
// express.json() en server.js ya parsea el body; aquí recalculamos
// la firma sobre el contenido raw. Se requiere que server.js pase rawBody:
//   app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
function verifyMPSignature(req, res, next) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('[Webhooks] MP_WEBHOOK_SECRET no configurado — omitiendo validación de firma');
    return next();
  }

  const xSignature  = req.headers['x-signature']  || '';
  const xRequestId  = req.headers['x-request-id'] || '';

  // Extraer ts y v1 del header x-signature (formato: "ts=<ts>,v1=<hash>")
  const tsMatch = xSignature.match(/ts=([^,]+)/);
  const v1Match = xSignature.match(/v1=([^,]+)/);
  if (!tsMatch || !v1Match) {
    logger.warn('[Webhooks] Firma MP ausente o malformada');
    return res.status(401).json({ error: 'firma inválida' });
  }

  const ts = tsMatch[1];
  const v1 = v1Match[1];

  // El data ID viene en el body (data.id) o en query (?data.id=...)
  const dataId = (req.body?.data?.id) || req.query['data.id'] || '';

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  if (expected !== v1) {
    logger.warn('[Webhooks] Firma MP inválida', { expected, received: v1 });
    return res.status(401).json({ error: 'firma inválida' });
  }

  next();
}

// ── POST /webhooks/mercadopago ────────────────────────────────────────────────
router.post('/mercadopago', verifyMPSignature, async (req, res) => {
  const { type, data, action } = req.body;
  const xRequestId = req.headers['x-request-id'] || '';
  const externalId = data?.id ? String(data.id) : xRequestId;

  // Responder 200 inmediatamente (MP tiene deadline de 22s)
  res.status(200).end();

  // Procesar en background
  setImmediate(async () => {
    try {
      // Idempotencia: registrar el evento (UNIQUE en provider + external_id)
      const { rowCount } = await db.query(
        `INSERT INTO webhook_events (provider, external_id, event_type, payload)
         VALUES ('mercadopago', $1, $2, $3)
         ON CONFLICT (provider, external_id) DO NOTHING`,
        [externalId, type || action, JSON.stringify(req.body)]
      );

      if (rowCount === 0) {
        logger.info('[Webhooks] Evento duplicado ignorado', { externalId, type });
        return;
      }

      logger.info('[Webhooks] Procesando evento MP', { externalId, type });

      if (type === 'payment') {
        await handlePaymentEvent(data.id);
      } else if (type === 'preapproval') {
        await handlePreapprovalEvent(data.id);
      } else {
        logger.info('[Webhooks] Tipo de evento no manejado', { type });
      }

      // Marcar como procesado
      await db.query(
        `UPDATE webhook_events SET processed_at = NOW() WHERE provider = 'mercadopago' AND external_id = $1`,
        [externalId]
      );

    } catch (err) {
      logger.error('[Webhooks] Error procesando evento MP', { externalId, err: err.message });
    }
  });
});

// ── Handlers internos ─────────────────────────────────────────────────────────

async function handlePaymentEvent(paymentId) {
  // Consultar el pago en MP para obtener el estado actualizado
  const payment = await paymentClient.get({ id: paymentId });
  if (!payment) {
    logger.warn('[Webhooks] Pago no encontrado en MP', { paymentId });
    return;
  }

  const { status, payer, transaction_amount, metadata, date_approved } = payment;
  const externalRef = payment.external_reference || '';
  const preapprovalId = payment.preapproval_id || metadata?.preapproval_id;

  // Buscar suscripción por external_subscription_id o por email del pagador
  const { rows: [sub] } = await db.query(
    `SELECT s.id AS sub_id, s.plan, s.trial_bonus_until, s.status AS sub_status,
            u.id AS user_id, u.email, u.cuit, u.nombre, u.apellido
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.external_subscription_id = $1
        OR u.email = $2
     ORDER BY s.id DESC LIMIT 1`,
    [preapprovalId || '', payer?.email || '']
  );

  if (!sub) {
    logger.warn('[Webhooks] Suscripción no encontrada para pago', { paymentId, preapprovalId, email: payer?.email });
    return;
  }

  // Guardar el pago en la tabla payments (upsert por external_payment_id)
  const { rows: [savedPayment] } = await db.query(
    `INSERT INTO payments
       (user_id, subscription_id, external_payment_id, amount, currency, status, plan, period_start, raw_response)
     VALUES ($1, $2, $3, $4, 'ARS', $5, $6, NOW(), $7)
     ON CONFLICT (external_payment_id) DO UPDATE
       SET status = EXCLUDED.status, raw_response = EXCLUDED.raw_response
     RETURNING id`,
    [
      sub.user_id, sub.sub_id, String(paymentId),
      transaction_amount, status,
      sub.plan, JSON.stringify(payment)
    ]
  );

  if (status === 'approved') {
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    const isFistPayment = !sub.trial_bonus_until;

    if (isFistPayment) {
      // Primer pago → aplicar trial bonus (usage_limit = plan + 20)
      await applyTrialBonus(sub.sub_id, sub.plan, nextBillingDate);
      logger.info('[Webhooks] Primer pago aprobado — trial bonus aplicado', { userId: sub.user_id });
    } else {
      // Renovación → sin bonus
      await applyRenewal(sub.sub_id, sub.plan, nextBillingDate);
      logger.info('[Webhooks] Renovación aprobada', { userId: sub.user_id });
    }

    // Encolar factura (fire-and-forget)
    enqueueInvoice(savedPayment.id).catch(err =>
      logger.error('[Webhooks] Error encolando factura', { paymentId, err: err.message })
    );

  } else if (status === 'rejected') {
    // Pago rechazado → gracia de 3 días
    const graceEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    await db.query(
      `UPDATE subscriptions
       SET payment_grace_ends_at = $1,
           suspension_cause      = 'payment',
           updated_at            = NOW()
       WHERE id = $2`,
      [graceEnd, sub.sub_id]
    );

    // Notificar al usuario
    await mailer.sendPaymentFailedEmail(sub.email, graceEnd).catch(err =>
      logger.error('[Webhooks] Error enviando email pago rechazado', { err: err.message })
    );

    logger.warn('[Webhooks] Pago rechazado — gracia otorgada', { userId: sub.user_id, graceEnd });
  }
}

async function handlePreapprovalEvent(preapprovalId) {
  const preapproval = await db.query(
    'SELECT id, status FROM subscriptions WHERE external_subscription_id = $1',
    [String(preapprovalId)]
  );
  if (!preapproval.rows[0]) {
    logger.warn('[Webhooks] Preapproval sin suscripción local', { preapprovalId });
    return;
  }
  // Solo logueamos el evento — los cambios de estado se manejan via pago (handlePaymentEvent)
  logger.info('[Webhooks] Evento preapproval registrado', { preapprovalId });
}

module.exports = router;
