-- Migración 2026-06-26: UNIQUE en invoices.payment_id
-- Motivo: el endpoint POST /admin/invoices/from-payment/:paymentId usa
--   INSERT ... ON CONFLICT (payment_id) DO UPDATE
-- que requiere una restricción UNIQUE (o índice único) sobre payment_id. La tabla
-- solo tenía la FK, por eso al subir el PDF de un pago sin factura aparecía:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Además formaliza la invariante del modelo: 1 factura por pago (el helper
-- linkInvoiceToPayment ya lo asumía a nivel código). NULL queda permitido y repetible
-- (facturas manuales sin pago asociado), porque Postgres no aplica UNIQUE a los NULL.
--
-- Idempotente: no falla si ya existe.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'invoices'::regclass
          AND contype = 'u'
          AND conname = 'invoices_payment_id_key'
    ) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_payment_id_key UNIQUE (payment_id);
    END IF;
END$$;
