// dev-tools/sim-renewal.js — Simula el cobro mensual de renovación (paso 12 del plan
// de pruebas). Replica exactamente lo que hace el webhook de MP para un pago recurrente
// aprobado: inserta el pago, aplica la renovación (reset de contadores + nueva fecha) y
// encola la factura pendiente. NO es código de producción — solo prueba E2E.
//
// Uso: node dev-tools/sim-renewal.js <subId> <userId> <plan> <amount>
require('dotenv').config();
const db = require('../db');
const { applyRenewal } = require('../services/subscriptionService');
const { enqueueInvoice } = require('../services/invoiceService');

(async () => {
  const subId  = parseInt(process.argv[2], 10);
  const userId = parseInt(process.argv[3], 10);
  const plan   = process.argv[4];
  const amount = parseFloat(process.argv[5]);
  const extPayId = 'renewal-sim-' + Date.now();

  const nextBillingDate = new Date();
  nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

  const { rows: [savedPayment] } = await db.query(
    `INSERT INTO payments
       (user_id, subscription_id, external_payment_id, amount, currency, status, plan, period_start, raw_response)
     VALUES ($1, $2, $3, $4, 'ARS', 'approved', $5, NOW(), $6)
     RETURNING id`,
    [userId, subId, extPayId, amount, plan, JSON.stringify({ simulated: true, reason: 'renewal test paso 12' })]
  );
  console.log('✅ Pago insertado id:', savedPayment.id, 'ext:', extPayId);

  await applyRenewal(subId, plan, nextBillingDate);
  console.log('✅ applyRenewal aplicado — next_billing_date:', nextBillingDate.toISOString());

  await enqueueInvoice(savedPayment.id);
  console.log('✅ Factura pendiente encolada para pago', savedPayment.id);

  process.exit(0);
})().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
