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
const { preApprovalClient, preApprovalPlanClient, paymentClient, PLAN_LIMITS, PLAN_PRICES, isPlanPayable } = require('../utils/mercadopago');
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
  // Verificar que el preapproval existe y está AUTORIZADO en MP (un preapproval
  // pendiente = checkout sin completar → no cuenta como método de pago configurado)
  const preapproval = await preApprovalClient.get({ id: preapprovalId });

  if (!preapproval || !preapproval.id) {
    throw new Error(`Preapproval ${preapprovalId} no encontrado en MercadoPago`);
  }
  if (preapproval.status !== 'authorized') {
    throw new Error(`La suscripción en MercadoPago no está autorizada (estado: ${preapproval.status})`);
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
 * applyTrialBonus — se aplica al primer pago aprobado: contadores a 0, tope global
 * desactivado (usage_limit=999999) y enforcement por submódulo según el plan.
 * trial_bonus_until = next_billing_date (fin del primer período pago)
 *
 * @param {number} subscriptionId
 * @param {string} planName
 * @param {Date}   nextBillingDate
 */
async function applyTrialBonus(subscriptionId, planName, nextBillingDate) {
  const limits = PLAN_LIMITS[planName];
  if (!limits) throw new Error(`Plan desconocido: ${planName}`);

  // Modelo trial-hasta-pago: al configurar el pago el contador arranca limpio en 0 y
  // el enforcement pasa a ser POR SUBMÓDULO (proc/informe/batch/novedades, vía
  // log-execution + pre-check de la app). El tope GLOBAL se desactiva (999999): si
  // quedara en el límite de proc, usage_count —que suma TODAS las ejecuciones de todos
  // los módulos— bloquearía antes de tiempo a un pago que mezcla módulos (ej. 45 proc
  // + 5 informes = 50 global ≥ límite, con submódulos aún disponibles).
  const newUsageLimit = 999999;

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

  // Igual que applyTrialBonus: el global queda desactivado (999999); rige el submódulo.
  const baseProcLimit = 999999;

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
 * ⚠️ VERIFICA contra MercadoPago antes de marcar: busca un preapproval AUTORIZADO
 * con external_reference=user_{id}. Sin esa verificación, un usuario que entraba al
 * checkout y volvía SIN pagar (botón de MP deshabilitado, pestaña cerrada, back)
 * quedaba marcado con método de pago configurado sin haber pagado nunca
 * (la suscripción quedaba "paga" sin pago y sin reset de contadores — bug 2026-06-12).
 *
 * @param {number} userId
 * @returns {Promise<{configured: boolean, preapprovalId: string|null}>}
 */
async function markPaymentConfigured(userId) {
  // Email del usuario para el matcheo por payer_email (fallback de identificación)
  const { rows: [usr] } = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
  const userEmail = (usr?.email || '').toLowerCase();
  const { rows: [subRow] } = await db.query(
    'SELECT id, plan, trial_bonus_until, checkout_initiated_at FROM subscriptions WHERE user_id = $1',
    [userId]
  );
  if (!subRow) return { configured: false, preapprovalId: null };

  // Un preapproval cuenta como "de este usuario" solo si es atribuible:
  // external_reference=user_{id} o payer_email coincidente. OJO: el search de MP
  // IGNORA el query param external_reference (devuelve todos los preapprovals del
  // vendedor) → el filtro DEBE hacerse acá. Sin esto, cualquier preapproval
  // autorizado de otro usuario daba match (validado en staging 2026-06-12).
  const belongsToUser = (p) =>
    p.status === 'authorized' && (
      p.external_reference === `user_${userId}` ||
      (userEmail && (p.payer_email || '').toLowerCase() === userEmail)
    );

  // 1) Verificación primaria: buscar en MP un preapproval autorizado atribuible al usuario
  let authorized = null;
  let claimedByWindow = false;
  let searchResults = [];
  try {
    const resp = await fetch(
      `https://api.mercadopago.com/preapproval/search?limit=50`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN || ''}` } }
    );
    if (resp.ok) {
      const data = await resp.json();
      searchResults = data.results || [];
      authorized = searchResults.find(belongsToUser) || null;
    } else {
      logger.warn('[SubscriptionService] MP preapproval/search no-ok', { userId, status: resp.status });
    }
  } catch (e) {
    logger.warn('[SubscriptionService] Error consultando MP preapproval/search', { userId, err: e.message });
  }

  // 1b) Claim por ventana de checkout: el checkout plan-based de MP NO persiste
  //     external_reference ni payer_email en el preapproval (quedan vacíos), así que
  //     un pago real puede quedar inatribuible. Si este usuario inició un checkout
  //     (checkout_initiated_at), se reclama el preapproval AUTORIZADO de NUESTRO plan,
  //     SIN identificadores (no atribuible a otro flujo), SIN dueño en la DB y creado
  //     DENTRO de la ventana. Riesgo de colisión: dos usuarios pagando en la misma
  //     ventana de minutos (aceptable en Beta; el más reciente gana, el otro se
  //     resuelve manualmente).
  if (!authorized && subRow.checkout_initiated_at) {
    const windowStart = new Date(new Date(subRow.checkout_initiated_at).getTime() - 2 * 60 * 1000);
    const ourPlanIds = [process.env.MP_PLAN_COMBO_PROMO_ID, process.env.MP_PLAN_EXTENSION_PROMO_ID].filter(Boolean);
    const candidates = [];
    for (const p of searchResults) {
      if (p.status !== 'authorized') continue;
      if (!ourPlanIds.includes(p.preapproval_plan_id)) continue;
      if (p.external_reference || p.payer_email) continue;     // atribuible por otra vía → no reclamar
      if (new Date(p.date_created) < windowStart) continue;
      const { rows: [linked] } = await db.query(
        'SELECT 1 FROM subscriptions WHERE external_subscription_id = $1', [p.id]
      );
      if (linked) continue;                                     // ya es de otro usuario
      candidates.push(p);
    }
    candidates.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));
    if (candidates.length > 0) {
      authorized = candidates[0];
      claimedByWindow = true;
      logger.info('[SubscriptionService] Preapproval reclamado por ventana de checkout', {
        userId, preapprovalId: authorized.id, initiatedAt: subRow.checkout_initiated_at, candidatos: candidates.length
      });
    }
  }

  // 2) Fallback: webhook de preapproval reciente sin vincular (evidencia de checkout
  //    real), verificando en MP que esté autorizado Y sea atribuible a este usuario
  if (!authorized) {
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
    if (recentEvent?.preapproval_id) {
      try {
        const p = await preApprovalClient.get({ id: recentEvent.preapproval_id });
        if (p && belongsToUser(p)) authorized = p;
      } catch (_) { /* no verificable → no se marca */ }
    }
  }

  if (!authorized) {
    logger.info('[SubscriptionService] Confirm sin preapproval autorizado en MP — NO se marca el método de pago', { userId });
    return { configured: false, preapprovalId: null };
  }

  await db.query(
    `UPDATE subscriptions
     SET payment_provider          = 'mercadopago',
         external_subscription_id  = COALESCE(NULLIF(external_subscription_id, ''), $1),
         updated_at                = NOW()
     WHERE user_id = $2`,
    [authorized.id, userId]
  );
  logger.info('[SubscriptionService] Método de pago verificado y marcado', { userId, preapprovalId: authorized.id });

  // Si se reclamó por ventana, el webhook del primer pago NO pudo atribuirlo (llegó
  // antes de la vinculación, sin identificadores) → reconciliarlo ahora: registra el
  // pago y aplica trial bonus / renovación (lo que habría hecho el webhook).
  if (claimedByWindow) {
    try {
      await reconcileClaimedCheckout(userId, subRow, authorized);
    } catch (e) {
      logger.warn('[SubscriptionService] Error reconciliando primer pago del checkout reclamado', { userId, err: e.message });
    }
  }

  return { configured: true, preapprovalId: authorized.id };
}

/**
 * reconcileClaimedCheckout — registra el primer pago de un preapproval reclamado por
 * ventana y aplica los efectos que el webhook no pudo aplicar por falta de atribución
 * (insert en payments + applyTrialBonus/applyRenewal + activación + factura pendiente).
 * Identifica el pago entre los webhooks recientes: aprobado, del MISMO pagador de MP
 * (payer_id del preapproval) y posterior a la creación del preapproval.
 */
async function reconcileClaimedCheckout(userId, subRow, preapproval) {
  const { rows: events } = await db.query(
    `SELECT external_id FROM webhook_events
     WHERE provider = 'mercadopago'
       AND event_type IN ('payment', 'subscription_authorized_payment')
       AND created_at >= $1::timestamptz - INTERVAL '2 minutes'
     ORDER BY id DESC LIMIT 10`,
    [preapproval.date_created]
  );

  for (const ev of events) {
    let payment;
    try { payment = await paymentClient.get({ id: ev.external_id }); } catch (_) { continue; }
    if (!payment || payment.status !== 'approved') continue;
    if (String(payment.payer?.id || '') !== String(preapproval.payer_id || '')) continue;
    if (new Date(payment.date_created) < new Date(new Date(preapproval.date_created).getTime() - 60 * 1000)) continue;

    // ¿Ya registrado? (el webhook pudo haberlo procesado por otra vía)
    const { rows: [existing] } = await db.query(
      'SELECT 1 FROM payments WHERE external_payment_id = $1', [String(payment.id)]
    );
    if (existing) break;

    const { rows: [saved] } = await db.query(
      `INSERT INTO payments
         (user_id, subscription_id, external_payment_id, amount, currency, status, plan, period_start, raw_response)
       VALUES ($1, $2, $3, $4, 'ARS', $5, $6, NOW(), $7)
       ON CONFLICT (external_payment_id) DO UPDATE
         SET status = EXCLUDED.status, raw_response = EXCLUDED.raw_response
       RETURNING id`,
      [userId, subRow.id, String(payment.id), payment.transaction_amount, payment.status, subRow.plan, JSON.stringify(payment)]
    );

    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    if (!subRow.trial_bonus_until) {
      await applyTrialBonus(subRow.id, subRow.plan, nextBillingDate);
    } else {
      await applyRenewal(subRow.id, subRow.plan, nextBillingDate);
    }

    await db.query(
      `UPDATE subscriptions
       SET status = 'active', next_billing_date = $1, last_payment_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [nextBillingDate, subRow.id]
    );

    // Factura pendiente (manual hasta contratar Facturante) — fire-and-forget
    try {
      const { enqueueInvoice } = require('./invoiceService');
      await enqueueInvoice(saved.id);
    } catch (e) {
      logger.warn('[SubscriptionService] Error encolando factura del pago reconciliado', { paymentId: payment.id, err: e.message });
    }

    logger.info('[SubscriptionService] Primer pago reconciliado tras claim por ventana', {
      userId, paymentId: payment.id, amount: payment.transaction_amount
    });
    break; // solo el primer pago
  }
}

/**
 * resolveRealPreapprovalId — devuelve el preapproval_id REAL del usuario en MP.
 * Usa external_subscription_id si es real (no placeholder 'pay-...'); si no, lo busca
 * en MP por external_reference=user_{id}. (El search de MP ignora el query param y
 * devuelve todos los del vendedor → filtramos del lado nuestro. En checkouts plan-based
 * el external_reference puede no persistirse → devuelve null si no se identifica con
 * seguridad, para no tocar la suscripción de otro usuario.)
 */
async function resolveRealPreapprovalId(userId, externalSubId) {
  if (externalSubId && !externalSubId.startsWith('pay-')) return externalSubId;
  try {
    const resp = await fetch(
      `https://api.mercadopago.com/preapproval/search?external_reference=user_${userId}`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN || ''}` } }
    );
    if (resp.ok) {
      const data = await resp.json();
      const match = (data.results || []).find(
        p => ['authorized', 'paused'].includes(p.status) && p.external_reference === `user_${userId}`
      );
      if (match) {
        logger.info('[SubscriptionService] Preapproval real resuelto en MP', { userId, preapprovalId: match.id });
        return match.id;
      }
    }
  } catch (e) {
    logger.warn('[SubscriptionService] No se pudo resolver preapproval real en MP', { userId, err: e.message });
  }
  return null;
}

/**
 * reactivateSubscription — deshace una cancelación programada REANUDANDO el preapproval
 * en MP (status: paused → authorized). NO genera un pago nuevo: el cobro se reanuda en la
 * fecha original (next_billing_date). Válido solo mientras cancel_at no venció.
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
  if (new Date(sub.cancel_at) < new Date()) throw new Error('La cancelación ya venció — volvé a suscribirte');

  // Reanudar el preapproval pausado en MP (paused → authorized)
  const preapprovalId = await resolveRealPreapprovalId(userId, sub.external_subscription_id);
  if (preapprovalId) {
    await preApprovalClient.update({ id: preapprovalId, body: { status: 'authorized' } });
    logger.info('[SubscriptionService] Preapproval MP reanudado (paused→authorized)', { preapprovalId });
  } else {
    // No hay preapproval reanudable (caso de borde) → no podemos garantizar el cobro futuro
    throw new Error('No se pudo reanudar la suscripción en MercadoPago. Configurá nuevamente tu método de pago.');
  }

  await db.query(
    `UPDATE subscriptions
     SET cancel_at = NULL, auto_renewal = TRUE, updated_at = NOW()
     WHERE id = $1`,
    [sub.id]
  );
  logger.info('[SubscriptionService] Cancelación revertida — suscripción reanudada sin nuevo cobro', { userId });
}

/**
 * cancelSubscription — programa la cancelación al fin del período actual.
 * PAUSA el preapproval en MP (no lo cancela): pausado no cobra pero es reversible, así
 * "Volver a suscribirme" puede reanudarlo sin un pago nuevo. El cron de vencimiento lo
 * cancela definitivamente en cancel_at si el usuario no reactivó. El usuario sigue activo
 * hasta next_billing_date.
 *
 * @param {number} userId
 */
async function cancelSubscription(userId) {
  const { rows: [sub] } = await db.query(
    'SELECT id, next_billing_date, external_subscription_id FROM subscriptions WHERE user_id = $1',
    [userId]
  );
  if (!sub) throw new Error(`Suscripción no encontrada para usuario ${userId}`);

  const preapprovalId = await resolveRealPreapprovalId(userId, sub.external_subscription_id);
  if (preapprovalId) {
    try {
      await preApprovalClient.update({ id: preapprovalId, body: { status: 'paused' } });
      logger.info('[SubscriptionService] Preapproval MP pausado (no se cobra el próximo período; reversible)', { preapprovalId });
    } catch (err) {
      logger.error('[SubscriptionService] Error pausando preapproval MP', { preapprovalId, err: err.message });
      // No bloquear la cancelación local si MP falla
    }
  } else {
    logger.warn('[SubscriptionService] Sin preapproval real identificable — cancelación solo local; revisar manualmente que no quede cobro vivo en MP', {
      userId, external: sub.external_subscription_id || null
    });
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
