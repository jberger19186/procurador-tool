/**
 * services/invoiceService.js
 * Gestión de facturas.
 *
 * Flujo actual (manual):
 *   webhooks.js llama enqueueInvoice(paymentId) → inserta row con status='pending'
 *   El admin sube el PDF desde el dashboard (sección Facturación)
 *   → actualiza pdf_url, invoice_type, cae, numero, status='issued'
 *
 * Flujo futuro (automático — requiere contratar Facturante):
 *   processInvoice(invoiceId) → emite via SOAP de Facturante
 *   cron invoice-retry (cada 1h) → releva pending con retry_count < 3
 *   Activar descomentando el cron en server.js y configurando FACTURANTE_WSDL_URL
 */

const db = require('../db');
const { crearFacturaC } = require('../utils/facturante');
const mailer = require('../utils/mailer');
const logger = require('../utils/logger');

/**
 * enqueueInvoice — crea un registro invoices con status='pending'
 * para que el cron lo procese (o processInvoice lo ejecute directo)
 *
 * @param {number} paymentId
 * @returns {Promise<number>} invoiceId creado
 */
async function enqueueInvoice(paymentId) {
  const { rows: [payment] } = await db.query(
    'SELECT user_id, amount, plan FROM payments WHERE id = $1',
    [paymentId]
  );
  if (!payment) throw new Error(`Pago ${paymentId} no encontrado`);

  const { rows: [invoice] } = await db.query(
    `INSERT INTO invoices (payment_id, user_id, amount, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id`,
    [paymentId, payment.user_id, payment.amount]
  );

  logger.info('[InvoiceService] Factura encolada', { invoiceId: invoice.id, paymentId });
  return invoice.id;
}

/**
 * processInvoice — emite la factura via Facturante (REQUIERE FACTURANTE_WSDL_URL configurado)
 * Actualiza el row en invoices según resultado.
 * No llamar sin credenciales de Facturante — falla silenciosamente en status='failed'.
 *
 * @param {number} invoiceId
 */
async function processInvoice(invoiceId) {
  if (!process.env.FACTURANTE_WSDL_URL) {
    logger.warn('[InvoiceService] processInvoice ignorado — FACTURANTE_WSDL_URL no configurado', { invoiceId });
    return;
  }
  const { rows: [inv] } = await db.query(
    `SELECT i.*, u.email, u.nombre, u.apellido, u.cuit, p.amount, p.plan
     FROM invoices i
     JOIN users u ON u.id = i.user_id
     JOIN payments p ON p.id = i.payment_id
     WHERE i.id = $1`,
    [invoiceId]
  );
  if (!inv) throw new Error(`Invoice ${invoiceId} no encontrado`);

  const razonSocial = [inv.nombre, inv.apellido].filter(Boolean).join(' ') || 'Consumidor Final';
  const concepto    = `Suscripción Procurador SCW — ${(inv.plan || '').replace('_', ' ')}`;

  try {
    const { cae, numero, pdfUrl, facturanteId } = await crearFacturaC({
      cuit:       inv.cuit,
      razonSocial,
      importe:    parseFloat(inv.amount),
      concepto,
      email:      inv.email
    });

    await db.query(
      `UPDATE invoices
       SET status        = 'issued',
           cae           = $1,
           numero        = $2,
           pdf_url       = $3,
           facturante_id = $4,
           issued_at     = NOW(),
           last_error    = NULL
       WHERE id = $5`,
      [cae, numero, pdfUrl, facturanteId, invoiceId]
    );

    // Enviar email al usuario con link al PDF
    await mailer.sendInvoiceEmail(inv.email, pdfUrl, numero).catch(err =>
      logger.error('[InvoiceService] Error enviando email factura', { err: err.message })
    );

    logger.info('[InvoiceService] Factura emitida OK', { invoiceId, cae, numero });

  } catch (err) {
    const isPermanent = err.isPermanent === true;
    const newRetryCount = (inv.retry_count || 0) + 1;
    const newStatus = (isPermanent || newRetryCount >= 3) ? 'failed' : 'pending';

    await db.query(
      `UPDATE invoices
       SET status      = $1,
           retry_count = $2,
           last_error  = $3
       WHERE id = $4`,
      [newStatus, newRetryCount, err.message, invoiceId]
    );

    if (newStatus === 'failed') {
      logger.error('[InvoiceService] Factura fallida definitivamente', { invoiceId, err: err.message });
      // Alertar al admin
      const adminEmail = process.env.INVOICE_ADMIN_ALERT_EMAIL;
      if (adminEmail) {
        mailer.sendMail({
          to: adminEmail,
          subject: `⚠️ Factura #${invoiceId} no pudo emitirse`,
          text: `La factura ID ${invoiceId} del usuario ${inv.email} falló después de ${newRetryCount} intentos.\nError: ${err.message}`
        }).catch(() => {});
      }
    } else {
      logger.warn('[InvoiceService] Factura pendiente reintento', { invoiceId, retryCount: newRetryCount });
    }

    throw err;
  }
}

/**
 * retryPendingInvoices — releva invoices pendientes y los procesa
 * Llamado por el cron invoice-retry cada 1 hora
 */
async function retryPendingInvoices() {
  const { rows } = await db.query(
    `SELECT id FROM invoices
     WHERE status = 'pending'
       AND retry_count < 3
       AND created_at < NOW() - INTERVAL '30 minutes'
     ORDER BY created_at ASC
     LIMIT 20`
  );

  if (rows.length === 0) return;

  logger.info('[InvoiceService] Reintentando facturas pendientes', { count: rows.length });

  for (const { id } of rows) {
    await processInvoice(id).catch(err =>
      logger.error('[InvoiceService] Error en reintento', { invoiceId: id, err: err.message })
    );
  }
}

module.exports = { enqueueInvoice, processInvoice, retryPendingInvoices };
