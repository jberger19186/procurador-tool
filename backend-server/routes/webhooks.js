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
const { paymentClient, preApprovalClient } = require('../utils/mercadopago');
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

  // M-2: comparación de tiempo constante (evita timing attacks).
  // timingSafeEqual exige buffers de igual longitud → se valida la longitud primero.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(v1, 'utf8');
  const signatureValid = expectedBuf.length === receivedBuf.length &&
                         crypto.timingSafeEqual(expectedBuf, receivedBuf);

  if (!signatureValid) {
    // B-4: no registrar la firma esperada (evita fuga en logs)
    logger.warn('[Webhooks] Firma MP inválida', { requestId: xRequestId });
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
      const isNew = rowCount > 0;
      const isPreapproval = (type === 'preapproval' || type === 'subscription_preapproval');

      // Los PAGOS se deduplican estricto: un mismo pago no debe procesarse 2 veces
      // (evita doble factura / doble aplicación). Los PREAPPROVALS se procesan SIEMPRE:
      // un mismo preapproval emite varios eventos en su ciclo (authorized→paused→
      // cancelled) con el MISMO id → dedup por id perdería los cambios de estado. El sync
      // de estado (handlePreapprovalEvent) es idempotente, así que reprocesar es inocuo.
      if (!isNew && !isPreapproval) {
        logger.info('[Webhooks] Evento duplicado ignorado', { externalId, type });
        return;
      }

      logger.info('[Webhooks] Procesando evento MP', { externalId, type, isNew });

      if (type === 'payment' || type === 'subscription_authorized_payment') {
        // 'payment': pago directo
        // 'subscription_authorized_payment': cobro autorizado dentro de una suscripción recurrente
        await handlePaymentEvent(data.id);
      } else if (type === 'preapproval' || type === 'subscription_preapproval') {
        // MP puede enviar 'preapproval' o 'subscription_preapproval' según el contexto
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
  const externalRef   = payment.external_reference || '';
  const preapprovalId = payment.preapproval_id || metadata?.preapproval_id;

  // Extraer userId de external_reference "user_{id}" si está disponible
  const refUserId = externalRef.startsWith('user_') ? parseInt(externalRef.slice(5), 10) : null;

  // Buscar suscripción por prioridad:
  // 1. external_reference "user_{id}" — independiente del email de MP
  // 2. external_subscription_id (preapproval ya vinculado)
  // 3. email del pagador — fallback cuando los emails coinciden
  let sub = null;

  if (refUserId) {
    const { rows } = await db.query(
      `SELECT s.id AS sub_id, s.plan, s.trial_bonus_until, s.status AS sub_status,
              u.id AS user_id, u.email, u.cuit, u.nombre, u.apellido
       FROM subscriptions s JOIN users u ON u.id = s.user_id
       WHERE u.id = $1 OR s.external_subscription_id = $2
       ORDER BY s.id DESC LIMIT 1`,
      [refUserId, preapprovalId || '']
    );
    sub = rows[0] || null;
  }

  if (!sub) {
    const { rows } = await db.query(
      `SELECT s.id AS sub_id, s.plan, s.trial_bonus_until, s.status AS sub_status,
              u.id AS user_id, u.email, u.cuit, u.nombre, u.apellido
       FROM subscriptions s JOIN users u ON u.id = s.user_id
       WHERE s.external_subscription_id = $1
          OR (u.email = $2 AND $2 <> '')
       ORDER BY s.id DESC LIMIT 1`,
      [preapprovalId || '', payer?.email || '']
    );
    sub = rows[0] || null;
  }

  if (!sub) {
    logger.warn('[Webhooks] Suscripción no encontrada para pago', { paymentId, preapprovalId, email: payer?.email, externalRef });
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

    const isFirstPayment = !sub.trial_bonus_until;

    if (isFirstPayment) {
      // Primer pago → aplicar trial bonus (usage_limit = plan + 20)
      await applyTrialBonus(sub.sub_id, sub.plan, nextBillingDate);
      logger.info('[Webhooks] Primer pago aprobado — trial bonus aplicado', { userId: sub.user_id });
    } else {
      // Renovación (o pago luego de fallo) → sin bonus, limpia gracia
      await applyRenewal(sub.sub_id, sub.plan, nextBillingDate);
      logger.info('[Webhooks] Renovación/recuperación aprobada', { userId: sub.user_id });
    }

    // Marcar método de pago configurado en la suscripción
    // (preapprovalId puede ser null en sandbox — usamos el paymentId como fallback)
    await db.query(
      `UPDATE subscriptions
       SET payment_provider          = 'mercadopago',
           external_subscription_id  = COALESCE(NULLIF(external_subscription_id, ''), $1),
           updated_at                = NOW()
       WHERE id = $2`,
      [preapprovalId || `pay-${paymentId}`, sub.sub_id]
    );

    // Si la cuenta estaba suspendida por falta de pago → reactivar
    // (puede ocurrir si el usuario pagó después de que venció la gracia)
    await db.query(
      `UPDATE users
       SET registration_status = 'active', updated_at = NOW()
       WHERE id = $1
         AND registration_status IN ('suspended', 'suspended_plan_expired')`,
      [sub.user_id]
    );

    // Crear registro de factura pendiente (fire-and-forget)
    // El admin sube el PDF manualmente desde el dashboard → sección Facturación
    // (Facturante automático desactivado hasta contratar el servicio)
    enqueueInvoice(savedPayment.id).catch(err =>
      logger.error('[Webhooks] Error creando registro de factura', { paymentId, err: err.message })
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
  // Consultar el preapproval en MP para obtener el email del pagador
  let mpPreapproval;
  try {
    mpPreapproval = await preApprovalClient.get({ id: String(preapprovalId) });
  } catch (err) {
    logger.warn('[Webhooks] No se pudo obtener preapproval de MP', { preapprovalId, err: err.message });
    return;
  }

  // MP puede devolver el email en distintos campos según la versión del SDK/plan
  const payerEmail = mpPreapproval?.payer_email
    || mpPreapproval?.payer?.email
    || mpPreapproval?.summarized?.payer_email
    || '';

  // external_reference = "user_{userId}" — seteado por nosotros al generar el init_point
  const externalRef  = mpPreapproval?.external_reference || '';
  const refUserId    = externalRef.startsWith('user_') ? parseInt(externalRef.slice(5), 10) : null;

  logger.info('[Webhooks] Preapproval data', {
    preapprovalId, payerEmail, externalRef, refUserId,
    status: mpPreapproval?.status,
    planId: mpPreapproval?.preapproval_plan_id,
    keys:   Object.keys(mpPreapproval || {}).join(',')
  });

  // Buscar suscripción por prioridad:
  // 1. external_subscription_id ya vinculado exactamente (renovaciones)
  // 2. external_reference "user_{id}" — funciona independientemente del email de MP
  // 3. email del pagador — fallback cuando portal email = MP email
  let sub = null;

  if (refUserId) {
    // Prioridad 1: user_id extraído de external_reference (el más confiable)
    const { rows } = await db.query(
      `SELECT s.id, s.status, s.external_subscription_id AS linked_id
       FROM subscriptions s
       WHERE s.user_id = $1
         OR s.external_subscription_id = $2
       ORDER BY s.id DESC LIMIT 1`,
      [refUserId, String(preapprovalId)]
    );
    sub = rows[0] || null;
  }

  if (!sub && payerEmail) {
    // Fallback: email del pagador (útil cuando portal email = MP email)
    const { rows } = await db.query(
      `SELECT s.id, s.status, s.external_subscription_id AS linked_id
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE u.email = $1
          OR s.external_subscription_id = $2
       ORDER BY s.id DESC LIMIT 1`,
      [payerEmail, String(preapprovalId)]
    );
    sub = rows[0] || null;
  }

  if (!sub) {
    // Fallback final: por el preapproval_id ya vinculado. Imprescindible para el caso
    // plan-based, donde MP no devuelve external_reference ni payer_email → las búsquedas
    // anteriores no corren, pero la suscripción YA tiene este preapproval vinculado
    // (cancelación/pausa de una suscripción existente desde la cuenta de MP del usuario).
    const { rows } = await db.query(
      `SELECT s.id, s.status, s.external_subscription_id AS linked_id FROM subscriptions s
       WHERE s.external_subscription_id = $1
       ORDER BY s.id DESC LIMIT 1`,
      [String(preapprovalId)]
    );
    sub = rows[0] || null;
  }

  if (!sub) {
    logger.warn('[Webhooks] Preapproval sin suscripción local', { preapprovalId, payerEmail, externalRef });
    return;
  }

  // Reflejar el ESTADO del preapproval en nuestra DB. Esto sincroniza la suscripción
  // sin importar dónde se originó la acción: si el usuario cancela/pausa/reactiva
  // directamente desde su cuenta de MercadoPago (fuera de nuestro portal), el webhook
  // mantiene la DB coherente con MP. Sin esto, una cancelación externa dejaba la cuenta
  // como "activa/renovando" mientras MP no cobraba → servicio gratis indefinido.
  const mpStatus = mpPreapproval?.status;

  // Guard anti-pisado: si la suscripción ya está vinculada a OTRO preapproval real
  // (distinto del de este webhook), un evento cancelled/paused de un preapproval VIEJO
  // no debe pisar la suscripción nueva. (Ej.: el usuario canceló en MP, reactivó con un
  // preapproval nuevo, y MP reenvía el webhook del viejo cancelado.) Los eventos
  // 'authorized' SÍ pueden re-vincular: el preapproval autorizado más nuevo gana.
  const linkedId = sub.linked_id || null;
  const isLinked = linkedId && linkedId === String(preapprovalId);
  const linkedToOther = linkedId && !linkedId.startsWith('pay-') && linkedId !== String(preapprovalId);

  if ((mpStatus === 'cancelled' || mpStatus === 'paused') && linkedToOther) {
    logger.info('[Webhooks] Preapproval ' + mpStatus + ' es de un preapproval viejo (no el vinculado) — se ignora para no pisar la suscripción activa', { preapprovalId, linkedId, subId: sub.id });
    return;
  }

  if (mpStatus === 'cancelled' || mpStatus === 'paused') {
    // Cobro frenado en MP → programar baja al fin del período ya pagado (igual que la
    // cancelación desde el portal). El cron de vencimiento cierra la cuenta en cancel_at.
    await db.query(
      `UPDATE subscriptions
       SET cancel_at                = COALESCE(cancel_at, next_billing_date, NOW()),
           auto_renewal             = FALSE,
           payment_provider         = 'mercadopago',
           external_subscription_id = $1,
           updated_at               = NOW()
       WHERE id = $2`,
      [String(preapprovalId), sub.id]
    );
    logger.info('[Webhooks] Preapproval ' + mpStatus + ' en MP — baja programada al fin del período', { preapprovalId, subId: sub.id });
    return;
  }

  if (mpStatus === 'authorized') {
    // Autorizado/reactivado en MP → asegurar estado activo y renovable (cubre la
    // reactivación hecha desde la cuenta de MP del usuario)
    await db.query(
      `UPDATE subscriptions
       SET cancel_at                = NULL,
           auto_renewal             = TRUE,
           payment_provider         = 'mercadopago',
           external_subscription_id = $1,
           updated_at               = NOW()
       WHERE id = $2`,
      [String(preapprovalId), sub.id]
    );
    logger.info('[Webhooks] Preapproval authorized en MP — suscripción activa/renovable', { preapprovalId, subId: sub.id });
    return;
  }

  // Otros estados (pending, etc.): solo vincular el preapproval_id real (necesario para
  // poder cancelar luego vía API de MP)
  await db.query(
    `UPDATE subscriptions
     SET external_subscription_id = $1,
         payment_provider          = 'mercadopago',
         updated_at                = NOW()
     WHERE id = $2`,
    [String(preapprovalId), sub.id]
  );

  logger.info('[Webhooks] Preapproval ID vinculado a suscripción', { preapprovalId, subId: sub.id, externalRef, payerEmail, mpStatus });
}

module.exports = router;
