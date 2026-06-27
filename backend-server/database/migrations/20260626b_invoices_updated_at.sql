-- Migración 2026-06-26 (b): agregar invoices.updated_at
-- Motivo: el endpoint POST /admin/invoices/:invoiceId/upload (y los helpers de
-- link/unlink pago<->factura) hacen UPDATE invoices SET ... updated_at = NOW(), pero
-- la tabla no tenía esa columna → al subir el PDF a una factura con registro existente
-- (ej. una factura 'pending' creada por enqueueInvoice) aparecía:
--   "column \"updated_at\" of relation \"invoices\" does not exist"
-- El camino from-payment (INSERT ... ON CONFLICT) no la usaba, por eso ese sí funcionaba.
--
-- Additivo, consistente con payments/subscriptions. Idempotente. Aplicada en prod.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
