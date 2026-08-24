/**
 * utils/mercadopago.js
 * Inicializa el SDK oficial de MercadoPago v3 y exporta los clientes
 * que se reutilizan en toda la aplicación.
 *
 * Documentación: https://github.com/mercadopago/sdk-nodejs
 */

const { MercadoPagoConfig, PreApproval, Payment, PreApprovalPlan } = require('mercadopago');

// ═══════════════════════════════════════════════════════════════════════════
//  Guard de entorno — staging NUNCA debe poder cobrar de verdad
// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo de V7 (2026-08-24): `.env.staging` llevaba desde junio un comentario
// diciendo "MercadoPago FIJADO EN SANDBOX — no cambiar aunque prod pase a real
// en B3"… y al mismo tiempo tenía el MISMO MP_ACCESS_TOKEN que producción, byte
// por byte. La intención estaba escrita; lo que no existía era un mecanismo.
// Era inocuo mientras prod también apuntara al sandbox (B3 pendiente), pero al
// cargar las credenciales reales lo único que mantendría a staging sin cobrar
// sería que nadie sincronice los dos archivos — en el entorno donde justamente
// se prueba lo destructivo.
//
// Esto lo convierte en un mecanismo: si la base es de staging, el token debe
// venir acompañado de `MP_ENV=sandbox` declarado explícitamente. Si no está
// (p. ej. porque alguien copió la .env de producción encima), el token se ANULA.
// Fail-closed pero proporcionado: staging sigue levantando y sirviendo todo lo
// demás — solo queda sin poder emitir un cobro.
//
// Se vacía `process.env.MP_ACCESS_TOKEN`, no solo la config del SDK, porque hay
// tres lecturas crudas de la variable que no pasan por el cliente:
// subscriptionService (markPaymentConfigured y resolveRealPreapprovalId) y el
// cron de cancelaciones vencidas de server.js — este último hace un PUT, o sea
// una ESCRITURA. Vaciar únicamente el SDK las dejaría abiertas. Las tres leen
// process.env en el momento de la llamada, así que anularlo acá (module load,
// durante el boot) las cubre a todas.
const esStaging = /staging/i.test(process.env.DB_NAME || '');
if (esStaging && process.env.MP_ACCESS_TOKEN && process.env.MP_ENV !== 'sandbox') {
  console.error(
    '[MercadoPago] ⛔ STAGING SIN MP_ENV=sandbox — TOKEN ANULADO.\n' +
    `    La base es "${process.env.DB_NAME}" pero las credenciales de MercadoPago no están\n` +
    '    declaradas como de sandbox, así que este entorno queda SIN capacidad de cobro\n' +
    '    para no arriesgar cargos reales. El resto de la aplicación funciona normal.\n' +
    '    Si efectivamente son credenciales de sandbox: agregá MP_ENV=sandbox a .env.staging.'
  );
  process.env.MP_ACCESS_TOKEN = '';
}

if (!process.env.MP_ACCESS_TOKEN) {
  console.warn('[MercadoPago] MP_ACCESS_TOKEN no configurado — módulo de pagos deshabilitado');
}

const mpConfig = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || '',
  options: {
    timeout: 10000,           // 10s timeout por request
    idempotencyKey: undefined // se setea por request en cada llamada
  }
});

// Clientes reutilizables
const preApprovalClient     = new PreApproval(mpConfig);
const preApprovalPlanClient = new PreApprovalPlan(mpConfig);
const paymentClient         = new Payment(mpConfig);

/**
 * PLAN_LIMITS — límites de uso por plan (para calcular usage_limit post-pago)
 * Debe mantenerse sincronizado con checkLicense.js
 */
const PLAN_LIMITS = {
  EXTENSION_PROMO: { proc: 0,   informe: 0,  partes: 0,  batch: 0,  novedades: 5  },
  COMBO_PROMO:     { proc: 50,  informe: 50, partes: 20, batch: 20, novedades: 50 },
  BASIC:           { proc: 50,  informe: 10, partes: 3,  batch: 0,  novedades: 0  },
  PRO:             { proc: 200, informe: 50, partes: 10, batch: 0,  novedades: 0  },
  ENTERPRISE:      { proc: 9999,informe: 9999,partes: 50,batch: 0,  novedades: 0  }
};

/**
 * PLAN_PRICES — precios en ARS (lee desde .env con fallback a valores por defecto)
 */
const PLAN_PRICES = {
  EXTENSION_PROMO: parseInt(process.env.MP_PLAN_EXTENSION_PROMO_PRICE || '1500', 10),
  COMBO_PROMO:     parseInt(process.env.MP_PLAN_COMBO_PROMO_PRICE     || '15000', 10)
};

/**
 * isPlanPayable — retorna true si el plan admite cobro vía MP
 */
function isPlanPayable(planName) {
  return Object.keys(PLAN_PRICES).includes(planName);
}

module.exports = {
  mpConfig,
  preApprovalClient,
  preApprovalPlanClient,
  paymentClient,
  PLAN_LIMITS,
  PLAN_PRICES,
  isPlanPayable
};
