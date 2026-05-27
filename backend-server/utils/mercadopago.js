/**
 * utils/mercadopago.js
 * Inicializa el SDK oficial de MercadoPago v3 y exporta los clientes
 * que se reutilizan en toda la aplicación.
 *
 * Documentación: https://github.com/mercadopago/sdk-nodejs
 */

const { MercadoPagoConfig, PreApproval, Payment, PreApprovalPlan } = require('mercadopago');

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
  COMBO_PROMO:     { proc: 50,  informe: 10, partes: 3,  batch: 20, novedades: 10 },
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
