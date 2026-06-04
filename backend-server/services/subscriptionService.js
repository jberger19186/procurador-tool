/**
 * services/subscriptionService.js
 * Lógica de negocio para gestión de suscripciones vía MercadoPago
 *
 * Flujo principal (plan-based):
 *   1. createPreapproval()  → devuelve el init_point del plan MP pre-creado
 *   2. linkPreapproval()    → vincula el preapproval_id a la suscripción tras confirmación
 *   3. applyTrialBonus()    → se llama desde webhooks.js al primer pago aprobado
 *   4. cancelSubscription() → cancela el preapproval en MP y programa cancel_at
 *
 * Los planes MP se crean una sola vez vía script y sus IDs se guardan en .env:
 *   MP_PLAN_COMBO_PROMO_ID, MP_PLAN_EXTENSION_PROMO_ID
 */

const db = require('../db');  // pool compartido para servicios (ver db.js)
const { preApprovalClient, preApprovalPlanClient, PLAN_LIMITS, PLAN_PRICES, isPlanPayable } = require('../utils/mercadopago');
const logger = require('../utils/logger');

// Map de plan → variable de entorno con el ID del plan en MP
const PLAN_ENV_KEYS = {
  COMBO_PROMO:     'MP_PLAN_COMBO_PROMO_ID',
  EXTENSION_PROMO: 'MP_PLAN_EXTENSION_PROMO_ID'
};

/**
 * createPreapproval — devuelve la URL de checkout del plan MP para que el usuario se suscriba
 *
 * Flujo plan-based:
 *   - El plan ya existe en MP (creado una vez, ID en .env)
 *   - Se devuelve el init_point del plan
 *   - El usuario completa el checkout en MP, que crea el preapproval automáticamente
 *   - MP redirige a back_url?preapproval_id=xxx
 *   - El cliente llama a /checkout/confirm con ese preapproval_id
 *
 * @param {number} userId
 * @param {string} planName  ej: 'COMBO_PROMO'
 * @returns {Promise<{initPoint: string, preapprovalId: null}>}
 */
async function createPreapproval(userId, planName) {
  if (!isPlanPayable(planName)) {
    throw new Error(`Plan ${planName} no admite cobro automático`);
  }

  const planEnvKey = PLAN_ENV_KEYS[planName];
  const planId     = process.env[planEnvKey];

  if (!planId) {
    throw new Error(`Plan MP no configurado para ${planName} (falta ${planEnvKey} en .env)`);
  }

  // Obtener el init_point del plan desde MP
  // NOTA: el SDK v3 usa { preApprovalPlanId } (no { id })
  const plan = await preApprovalPlanClient.get({ preApprovalPlanId: planId });
  if (!plan || !plan.init_point) {
    throw new Error(`Plan MP ${planId} no encontrado o sin init_point`);
  }

  // Obtener el email del usuario para pre-llenarlo en el checkout de MP.
  // Esto hace que la preapproval quede asociada al email del portal,
  // permitiendo que el webhook subscription_preapproval lo identifique correctamente.
  const { rows: [user] } = await db.query(
    'SELECT email FROM users WHERE id = $1',
    [userId]
  );
  const userEmail = user?.email || '';

  // Enriquecer la URL del checkout con identificadores para el webhook:
  //
  // - external_reference: "user_{userId}" — identificador primario, independiente del email.
  //   MP lo almacena en la preapproval y lo devuelve en todos los webhooks.
  //   Funciona aunque el usuario tenga distintos emails en el portal y en MP.
  //
  // - payer_email: email del usuario en el portal — pre-llena el formulario en MP
  //   y sirve como fallback de identificación cuando los emails coinciden.
  const initPointUrl = new URL(plan.init_point);
  initPointUrl.searchParams.set('external_reference', `user_${userId}`);
  if (userEmail) {
    initPointUrl.searchParams.set('payer_email', userEmail);
  }

  logger.info('[SubscriptionService] init_point del plan MP obtenido', { userId, planName, planId, userEmail });

  return {
    initPoint:     initPointUrl.toString(),
    preapprovalId: null   // se obtiene después del checkout via /confirm
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

  // Modelo trial-hasta-pago: al configurar el pago se asignan los límites del PLAN
  // (sin el +20 del trial) y el contador arranca limpio en 0. Los 20 usos del trial
  // se eliminan: a partir de acá rige el plan.
  const baseProcLimit = limits.proc > 0 ? limits.proc : limits.novedades;
  const newUsageLimit = baseProcLimit;

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
     SET usage_limit             = $1,
         usage_count             = 0,
         proc_usage              = 0,
         informe_usage           = 0,
         batch_usage             = 0,
         monitor_novedades_usage = 0,
         next_billing_date       = $2,
         last_payment_at         = NOW(),
         status                  = 'active',
         period_start            = NOW(),
         -- Si había una cancelación programada pero el cobro de renovación fue aprobado,
         -- significa que el preapproval NO fue cancelado en MP (ej: fallo de red al cancelar).
         -- En ese caso limpiamos cancel_at y restauramos auto_renewal para evitar que el
         -- cron de cancelaciones vencidas marque la cuenta como cancelada incorrectamente.
         cancel_at               = NULL,
         auto_renewal            = TRUE,
         -- Limpiar campos de gracia/suspensión por pago (el pago fue ok)
         payment_grace_ends_at   = NULL,
         suspension_cause        = NULL,
         suspended_at            = NULL,
         updated_at              = NOW()
     WHERE id = $3`,
    [baseProcLimit, nextBillingDate, subscriptionId]
  );

  logger.info('[SubscriptionService] Renovación aplicada', { subscriptionId, baseProcLimit, nextBillingDate });
}

/**
 * markPaymentConfigured — marca payment_provider='mercadopago' cuando no se recibe preapproval_id
 * Se usa cuando MP no devuelve preapproval_id en el redirect (ej: sandbox).
 *
 * Intenta también reclamar el preapproval_id más reciente de webhook_events
 * que no esté vinculado a ninguna suscripción todavía (creado en los últimos 10 min).
 * Esto permite que la cancelación posterior pueda invocar la API de MP correctamente.
 *
 * @param {number} userId
 */
async function markPaymentConfigured(userId) {
  // Buscar el preapproval más reciente no vinculado a ninguna suscripción
  const { rows: [recentEvent] } = await db.query(
    `SELECT we.external_id AS preapproval_id
     FROM webhook_events we
     WHERE we.event_type IN ('preapproval', 'subscription_preapproval')
       AND we.created_at > NOW() - INTERVAL '10 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM subscriptions s
         WHERE s.external_subscription_id = we.external_id
       )
     ORDER BY we.created_at DESC
     LIMIT 1`
  );

  const preapprovalId = recentEvent?.preapproval_id || null;

  await db.query(
    `UPDATE subscriptions
     SET payment_provider          = 'mercadopago',
         external_subscription_id  = COALESCE(NULLIF(external_subscription_id, ''), $1),
         updated_at                = NOW()
     WHERE user_id = $2`,
    [preapprovalId, userId]
  );

  logger.info('[SubscriptionService] Pago marcado como configurado', { userId, preapprovalId: preapprovalId || '(ninguno reciente)' });
}

/**
 * reactivateSubscription — deshace una cancelación programada (quita cancel_at)
 * Solo válido cuando cancel_at está seteado pero aún no venció.
 * Reactiva también el preapproval en MP si hay external_subscription_id real.
 *
 * @param {number} userId
 */
async function reactivateSubscription(userId) {
  const { rows: [sub] } = await db.query(
    'SELECT id, cancel_at, external_subscription_id FROM subscriptions WHERE user_id = $1',
    [userId]
  );
  if (!sub) throw new Error(`Suscripción no encontrada para usuario ${userId}`);
  if (!sub.cancel_at) throw new Error('La suscripción no tiene una cancelación programada');
  if (new Date(sub.cancel_at) < new Date()) throw new Error('La cancelación ya venció — la suscripción expiró');

  // Reactivar preapproval en MP si tenemos el ID real
  const hasRealPreapproval = sub.external_subscription_id &&
                              !sub.external_subscription_id.startsWith('pay-');
  if (hasRealPreapproval) {
    try {
      await preApprovalClient.update({
        id: sub.external_subscription_id,
        body: { status: 'authorized' }
      });
      logger.info('[SubscriptionService] Preapproval MP reactivado', { preapprovalId: sub.external_subscription_id });
    } catch (err) {
      logger.error('[SubscriptionService] Error reactivando preapproval MP', { err: err.message });
      // No bloquear la reactivación local si MP falla
    }
  }

  await db.query(
    `UPDATE subscriptions
     SET cancel_at    = NULL,
         auto_renewal = TRUE,
         updated_at   = NOW()
     WHERE id = $1`,
    [sub.id]
  );

  logger.info('[SubscriptionService] Cancelación revertida — suscripción reactivada', { userId });
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
  // Nota: los IDs que empiezan con 'pay-' son placeholders internos, no preapproval IDs reales de MP
  const hasRealPreapproval = sub.external_subscription_id &&
                              !sub.external_subscription_id.startsWith('pay-');
  if (hasRealPreapproval) {
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
  } else if (sub.external_subscription_id) {
    logger.warn('[SubscriptionService] external_subscription_id es un placeholder — cancelación solo local', {
      id: sub.external_subscription_id
    });
  } else {
    logger.warn('[SubscriptionService] Sin external_subscription_id — cancelación solo local', { userId });
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
  markPaymentConfigured,
  reactivateSubscription,
  applyTrialBonus,
  applyRenewal,
  cancelSubscription
};
