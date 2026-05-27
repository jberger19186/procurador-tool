-- ============================================================
-- Migración 005 — Fase 5: Cobranza (MercadoPago + Facturante)
-- Aplicar con: psql -U procurador_user -d procurador_db -f 005_fase5_payments.sql
-- Reversible: ver sección ROLLBACK al final (comentada)
-- ============================================================

BEGIN;

-- ── Columnas nuevas en subscriptions ─────────────────────────
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS external_subscription_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS payment_method_id        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS last_payment_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_renewal             BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS trial_bonus_until        TIMESTAMPTZ;

-- Índice único sobre external_subscription_id (solo filas no-NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subs_external
  ON subscriptions(external_subscription_id)
  WHERE external_subscription_id IS NOT NULL;

COMMENT ON COLUMN subscriptions.external_subscription_id IS 'ID preapproval de MercadoPago';
COMMENT ON COLUMN subscriptions.payment_method_id        IS 'Token de tarjeta en MercadoPago';
COMMENT ON COLUMN subscriptions.last_payment_at          IS 'Timestamp del último pago aprobado';
COMMENT ON COLUMN subscriptions.auto_renewal             IS 'Si false, no renovar al vencimiento';
COMMENT ON COLUMN subscriptions.trial_bonus_until        IS 'Los +20 usos trial vencen aquí (fin del primer período pago)';

-- ── Columna nueva en users ────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cuit_deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN users.cuit_deleted_at IS 'CUIT anulado 90 días post-cancelación (retención legal)';

-- ── Tabla payments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                   SERIAL PRIMARY KEY,
  user_id              INT NOT NULL REFERENCES users(id),
  subscription_id      INT REFERENCES subscriptions(id),
  external_payment_id  VARCHAR(120) UNIQUE,          -- ID pago MP
  amount               NUMERIC(10,2) NOT NULL,
  currency             VARCHAR(3)  DEFAULT 'ARS',
  status               VARCHAR(30) NOT NULL,          -- approved | rejected | refunded | pending
  payment_method       VARCHAR(30),                   -- card | manual_extra | etc.
  plan                 VARCHAR(50),                   -- snapshot del plan al momento del pago
  period_start         TIMESTAMPTZ,
  period_end           TIMESTAMPTZ,
  refund_amount        NUMERIC(10,2),
  refunded_at          TIMESTAMPTZ,
  refund_reason        TEXT,
  raw_response         JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user
  ON payments(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_status
  ON payments(status) WHERE status IN ('pending', 'rejected');

COMMENT ON TABLE payments IS 'Historial de cobros (MercadoPago) por usuario';

-- ── Tabla usage_extras ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_extras (
  id                   SERIAL PRIMARY KEY,
  user_id              INT NOT NULL REFERENCES users(id),
  subscription_id      INT REFERENCES subscriptions(id),
  payment_id           INT REFERENCES payments(id),  -- NULL = cortesía sin cobro
  extra_uses           INT NOT NULL,
  remaining_uses       INT NOT NULL,
  reason               TEXT,                          -- "Ticket #123 — solicitud extra"
  created_by_admin_id  INT REFERENCES users(id),
  expires_at           TIMESTAMPTZ,                   -- NULL = no vence
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extras_user
  ON usage_extras(user_id) WHERE remaining_uses > 0;

COMMENT ON TABLE usage_extras IS 'Usos extra asignados por admin (cobrados o de cortesía)';

-- ── Tabla invoices ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                   SERIAL PRIMARY KEY,
  payment_id           INT REFERENCES payments(id),
  user_id              INT NOT NULL REFERENCES users(id),
  facturante_id        VARCHAR(80),
  invoice_type         VARCHAR(5)  DEFAULT 'C',       -- monotributista
  cae                  VARCHAR(40),
  numero               VARCHAR(20),
  amount               NUMERIC(10,2),
  pdf_url              TEXT,
  status               VARCHAR(20) DEFAULT 'pending', -- pending | issued | failed
  retry_count          INT DEFAULT 0,
  last_error           TEXT,
  issued_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_user
  ON invoices(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_retry
  ON invoices(status, retry_count) WHERE status IN ('pending', 'failed');

COMMENT ON TABLE invoices IS 'Facturas emitidas via Facturante (Factura C, monotributista)';

-- ── Tabla webhook_events (idempotencia) ───────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id           SERIAL PRIMARY KEY,
  provider     VARCHAR(20) NOT NULL,                  -- 'mercadopago'
  external_id  VARCHAR(120) NOT NULL,                 -- ID del evento MP
  event_type   VARCHAR(60),
  payload      JSONB,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_webhook_provider_event UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_webhooks_unprocessed
  ON webhook_events(created_at) WHERE processed_at IS NULL;

COMMENT ON TABLE webhook_events IS 'Log de idempotencia para webhooks de MercadoPago';

COMMIT;

-- ============================================================
-- ROLLBACK (ejecutar solo para revertir, con cuidado en producción)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS webhook_events;
-- DROP TABLE IF EXISTS invoices;
-- DROP TABLE IF EXISTS usage_extras;
-- DROP TABLE IF EXISTS payments;
-- ALTER TABLE users      DROP COLUMN IF EXISTS cuit_deleted_at;
-- ALTER TABLE subscriptions
--   DROP COLUMN IF EXISTS trial_bonus_until,
--   DROP COLUMN IF EXISTS auto_renewal,
--   DROP COLUMN IF EXISTS last_payment_at,
--   DROP COLUMN IF EXISTS payment_method_id,
--   DROP COLUMN IF EXISTS external_subscription_id;
-- DROP INDEX IF EXISTS idx_subs_external;
-- COMMIT;
