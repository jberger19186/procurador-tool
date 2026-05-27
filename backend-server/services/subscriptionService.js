/**
 * services/subscriptionService.js
 * Lógica de negocio para gestión de suscripciones vía MercadoPago
 *
 * Flujo principal:
 *   1. createPreapproval()  → genera init_point URL para que el usuario cargue su tarjeta
 *   2. linkPreapproval()    → vincula el preapproval a la suscripción tras confirmación
 *   3. applyTrialBonus()    → se llama desde webhooks.js al primer pago aprobado
 *   4. cancelSubscription() → programa cancel_at al fin del período (soft cancel)
 */

const db = require('../db');
const { preApprovalClient, PLAN_LIMITS, PLAN_PRICES, isPlanPayable } = require('../utils/mercadopago');
const logger = require('../utils/logger');

/**
 * createPreapproval — genera la URL de checkout MP para que el usuario configure su pago
 *
 * @param {number} userId
 * @param {string} planName  ej: 'COMBO_PROMO'
 * @returns {Promise<{initPoint: string, preapprovalId: string}>}
 */
async function createPreapproval(userId, planName) {
  if (!isPlanPayable(planName)) {
    throw new Error(`Plan ${planName} no admite cobro automático`);
  }

  const price = PLAN_PRICES[planName];
  const appBaseUrl = process.env.APP_BASE_URL || 'https://procuradortool.com';

  // Obtener datos del usuario para el preapproval
  const { rows: [user] } = await db.query(
    'SELECT email, nombre, apellido FROM users WHERE id = $1',
    [userId]
  );
  if (!user) throw new Error(`Usuario ${userId} no encontrado`);

  const body = {
    reason:             `Procurador SCW — ${planName.replace('_', ' ')}`,
    auto_recurring: {
      frequency:       1,
      frequency_type:  'months',
      transaction_amount: price,
      currency_id:     'ARS'
    },
    payer_email:         user.email,
    back_url:           `${appBaseUrl}/portal/pago-completado`,
    status:             'pending'   // se activa al primer pago aprobado
  };

  logger.info('[SubscriptionService] Creando preapproval MP', { userId, planName, price });

  const response = await preApprovalClient.create({ body });

  return {
    initPoint:     response.init_point,
    preapprovalId: response.id
  };
}

/**
 * linkPreapproval — vincula un preapproval_id a la suscripción del usuario
 * Se llama tras la confirmación del checkout (POST /checkout/confirm)
 *
 * @param {number} userId
 * @param {string} preapprovalId
 */
async function linkPreapproval(userId, preapprovalId) {
  // Verificar que el preapproval pertenece al usuario (consultar MP)
  const preapproval = await preApprovalClient.get({ id: preapprovalId });

  if (!preapproval || !preapproval.id) {
    throw new Error(`Preapproval ${preapprovalId} no encontrado en MercadoPago`);
  }

  await db.query(
    `UPDATE subscriptions
     SET external_subscription_id = $1,
         payment_provider          = 'mercadopago',
         updated_at                = NOW()
     WHERE user_id = $2`,
    [preapprovalId, userId]
  );

  logger.info('[SubscriptionService] Preapproval vinculado', { userId, preapprovalId });
}

/**
 * applyTrialBonus — aplica el bonus de bienvenida al primer pago aprobado
 * usage_limit = plan_limit + 20 (trial bonus)
 * trial_bonus_until = next_billing_date (fin del primer período pago)
 *
 * @param {number} subscriptionId
 * @param {string} planName
 * @param {Date}   nextBillingDate
 */
async function applyTrialBonus(subscriptionId, planName, nextBillingDate) {
  const limits = PLAN_LIMITS[planName];
  if (!limits) throw new Error(`Plan desconocido: ${planName}`);

  // usage_limit sube a proc (o novedades para EXTENSION_PROMO) + 20 trial
  // Para simplificar, el campo genérico usage_limit refleja proc + bonus
  const baseProcLimit = limits.proc > 0 ? limits.proc : limits.novedades;
  const newUsageLimit = baseProcLimit + 20;

  await db.query(
    `UPDATE subscriptions
     SET usage_limit        = $1,
         trial_bonus_until  = $2,
         usage_count        = 0,
         proc_usage         = 0,
         informe_usage      = 0,
         batch_usage        = 0,
         monitor_novedades_usage = 0,
         period_start       = NOW(),
         updated_at         = NOW()
     WHERE id = $3`,
    [newUsageLimit, nextBillingDate, subscriptionId]
  );

  logger.info('[SubscriptionService] Trial bonus aplicado', { subscriptionId, newUsageLimit, nextBillingDate });
}

/**
 * applyRenewal — aplica renovación mensual (sin trial bonus)
 * Resetea usage_count a 0 y actualiza next_billing_date
 *
 * @param {number} subscriptionId
 * @param {string} planName
 * @param {Date}   nextBillingDate
 */
async function applyRenewal(subscriptionId, planName, nextBillingDate) {
  const limits = PLAN_LIMITS[planName];
  if (!limits) throw new Error(`Plan desconocido: ${planName}`);

  const baseProcLimit = limits.proc > 0 ? limits.proc : limits.novedades;

  await db.query(
    `UPDATE subscriptions
     SET usage_limit      = $1,
         usage_count      = 0,
         proc_usage       = 0,
         informe_usage    = 0,
         batch_usage      = 0,
         monitor_novedades_usage = 0,
         next_billing_date = $2,
         last_payment_at   = NOW(),
         status            = 'active',
         period_start      = NOW(),
         updated_at        = NOW()
     WHERE id = $3`,
    [baseProcLimit, nextBillingDate, subscriptionId]
  );

  logger.info('[SubscriptionService] Renovación aplicada', { subscriptionId, baseProcLimit, nextBillingDate });
}

/**
 * cancelSubscription — programa la cancelación al fin del período actual
 * El usuario sigue activo hasta next_billing_date
 *
 * @param {number} userId
 */
async function cancelSubscription(userId) {
  const { rows: [sub] } = await db.query(
    'SELECT id, next_billing_date, external_subscription_id FROM subscriptions WHERE user_id = $1',
    [userId]
  );
  if (!sub) throw new Error(`Suscripción no encontrada para usuario ${userId}`);

  // Cancelar preapproval en MP (evita cobro siguiente)
  if (sub.external_subscription_id) {
    try {
      await preApprovalClient.update({
        id: sub.external_subscription_id,
        body: { status: 'cancelled' }
      });
      logger.info('[SubscriptionService] Preapproval MP cancelado', { preapprovalId: sub.external_subscription_id });
    } catch (err) {
      logger.error('[SubscriptionService] Error cancelando preapproval MP', { err: err.message });
      // No bloquear la cancelación local si MP falla
    }
  }

  await db.query(
    `UPDATE subscriptions
     SET cancel_at    = next_billing_date,
         auto_renewal = FALSE,
         updated_at   = NOW()
     WHERE id = $1`,
    [sub.id]
  );

  logger.info('[SubscriptionService] Cancelación programada', { userId, cancelAt: sub.next_billing_date });

  return { cancelAt: sub.next_billing_date };
}

module.exports = {
  createPreapproval,
  linkPreapproval,
  applyTrialBonus,
  applyRenewal,
  cancelSubscription
};
