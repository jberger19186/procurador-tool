-- 20260728_add_subscriptions_date_indexes.sql
-- Bloque B.2 (E3-4): índices parciales sobre las 4 columnas de fecha que consultan
-- 6+ crons diarios en server.js (5b/5c/5d/5f/5g/5h). Con el volumen actual (3 filas)
-- son invisibles, pero con MercadoPago en producción real (B3) el volumen crece y
-- estos WHERE hoy hacen Seq Scan sin ningún índice de soporte.
-- CONCURRENTLY para no bloquear la tabla durante la creación (irrelevante hoy, pero
-- es la práctica correcta y no cuesta nada adoptarla ahora).
-- Nota: CREATE INDEX CONCURRENTLY no puede ejecutarse dentro de una transacción.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sub_plan_expiry
  ON subscriptions (plan_expiry_date) WHERE plan_expiry_date IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sub_cancel_at
  ON subscriptions (cancel_at) WHERE cancel_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sub_payment_grace_ends_at
  ON subscriptions (payment_grace_ends_at) WHERE payment_grace_ends_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sub_next_billing_date
  ON subscriptions (next_billing_date) WHERE next_billing_date IS NOT NULL;
