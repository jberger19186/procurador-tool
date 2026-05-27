/**
 * routes/checkout.js
 * Endpoints para el flujo de pago del usuario final (configura tarjeta via MercadoPago)
 *
 * Todos los endpoints requieren JWT válido.
 * Solo disponibles si PAYMENT_MODULE_ENABLED=true o usuario en PAYMENT_BETA_USER_IDS.
 *
 * Rutas montadas en server.js:
 *   app.use('/usuarios/api/checkout', require('./routes/checkout'));
 */

const express = require('express');
const router  = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const { createPreapproval, linkPreapproval, cancelSubscription } = require('../services/subscriptionService');
const logger  = require('../utils/logger');

// ── Middleware: verificar feature flag ───────────────────────────────────────
function checkPaymentEnabled(req, res, next) {
  const enabled = process.env.PAYMENT_MODULE_ENABLED === 'true';
  if (enabled) return next();

  // Beta: acceso por user_id
  const betaIds = (process.env.PAYMENT_BETA_USER_IDS || '')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
  if (req.user && betaIds.includes(req.user.id)) return next();

  return res.status(503).json({ error: 'Módulo de pagos no disponible aún' });
}

// Aplicar auth + flag a todas las rutas
router.use(authenticateToken);
router.use(checkPaymentEnabled);

// ── POST /usuarios/api/checkout/init ─────────────────────────────────────────
// Genera la URL de checkout MP para que el usuario ingrese su tarjeta
router.post('/init', async (req, res) => {
  const { plan_name } = req.body;
  const userId = req.user.id;

  if (!plan_name) {
    return res.status(400).json({ error: 'plan_name requerido' });
  }

  try {
    const { initPoint, preapprovalId } = await createPreapproval(userId, plan_name);
    logger.info('[Checkout] init_point generado', { userId, plan_name });
    res.json({ init_point: initPoint, preapproval_id: preapprovalId });
  } catch (err) {
    logger.error('[Checkout] Error creando preapproval', { userId, err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /usuarios/api/checkout/confirm ──────────────────────────────────────
// Vincula el preapproval_id retornado por MP al usuario
// El usuario llega aquí tras completar el checkout en MP
router.post('/confirm', async (req, res) => {
  const { preapproval_id } = req.body;
  const userId = req.user.id;

  if (!preapproval_id) {
    return res.status(400).json({ error: 'preapproval_id requerido' });
  }

  try {
    await linkPreapproval(userId, preapproval_id);
    logger.info('[Checkout] Preapproval vinculado', { userId, preapproval_id });
    res.json({ ok: true, message: 'Método de pago configurado. El primer cobro se procesará automáticamente.' });
  } catch (err) {
    logger.error('[Checkout] Error vinculando preapproval', { userId, err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /usuarios/api/checkout/cancel ───────────────────────────────────────
// Programa la cancelación de la suscripción al fin del período actual
router.post('/cancel', async (req, res) => {
  const userId = req.user.id;

  try {
    const { cancelAt } = await cancelSubscription(userId);
    logger.info('[Checkout] Cancelación programada', { userId, cancelAt });
    res.json({ ok: true, cancel_at: cancelAt, message: 'Tu suscripción se cancelará al finalizar el período actual.' });
  } catch (err) {
    logger.error('[Checkout] Error cancelando suscripción', { userId, err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /usuarios/api/checkout/status ────────────────────────────────────────
// Retorna el estado actual de la suscripción del usuario (para la UI)
router.get('/status', async (req, res) => {
  const userId = req.user.id;
  const db = req.app.get('db');

  try {
    const { rows: [sub] } = await db.query(
      `SELECT status, plan, next_billing_date, cancel_at, trial_bonus_until,
              external_subscription_id, payment_provider, last_payment_at,
              usage_count, usage_limit
       FROM subscriptions WHERE user_id = $1`,
      [userId]
    );
    if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });

    res.json({
      status:                 sub.status,
      plan:                   sub.plan,
      next_billing_date:      sub.next_billing_date,
      cancel_at:              sub.cancel_at,
      trial_bonus_until:      sub.trial_bonus_until,
      has_payment_method:     !!sub.external_subscription_id,
      payment_provider:       sub.payment_provider,
      last_payment_at:        sub.last_payment_at,
      usage_count:            sub.usage_count,
      usage_limit:            sub.usage_limit
    });
  } catch (err) {
    logger.error('[Checkout] Error consultando status', { userId, err: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
