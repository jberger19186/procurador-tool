-- ============================================================
-- Migración 001: Flujo de Usuario v2.1
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1a. Actualizar CHECK constraint de users.registration_status
-- ────────────────────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_registration_status_check;

-- Migrar valores obsoletos antes de agregar el nuevo constraint
UPDATE users SET registration_status = 'pending_activation' WHERE registration_status = 'pending_payment';
UPDATE users SET registration_status = 'pending_activation' WHERE registration_status = 'trial';

ALTER TABLE users ADD CONSTRAINT users_registration_status_check
  CHECK (registration_status IN (
    'pending_email',
    'pending_activation',
    'active',
    'rejected',
    'suspended',
    'suspended_admin',
    'suspended_plan_expired',
    'cancelled'
  ));

-- ────────────────────────────────────────────────────────────
-- 1b. Actualizar CHECK constraint de subscriptions.status
-- ────────────────────────────────────────────────────────────
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS check_status_valid;

-- Migrar valores obsoletos
UPDATE subscriptions SET status = 'suspended' WHERE status = 'expired';

ALTER TABLE subscriptions ADD CONSTRAINT check_status_valid
  CHECK (status IN (
    'active',
    'suspended',
    'suspended_admin',
    'suspended_plan_expired',
    'cancelled'
  ));

-- ────────────────────────────────────────────────────────────
-- 1c. Columnas nuevas en subscriptions
-- ────────────────────────────────────────────────────────────
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS suspension_cause VARCHAR(20)
    CHECK (suspension_cause IN ('payment', 'admin', 'plan_expired'))
    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_by INTEGER REFERENCES users(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS billing_paused BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_expiry_date TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_changes_this_cycle INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_plan JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_change_history JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS reactivation_request JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_grace_ends_at TIMESTAMP DEFAULT NULL;

-- ────────────────────────────────────────────────────────────
-- 1d. UNIQUE en users.cuit
-- ────────────────────────────────────────────────────────────
-- ATENCIÓN: verificar manualmente que no haya CUITs duplicados antes
-- de correr en producción:
--   SELECT cuit, COUNT(*) FROM users WHERE cuit IS NOT NULL GROUP BY cuit HAVING COUNT(*) > 1;
ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS users_cuit_unique UNIQUE (cuit);

-- ────────────────────────────────────────────────────────────
-- 1e. Tabla user_events (auditoría de eventos de usuario)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_events (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type  VARCHAR(50) NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_event_type ON user_events(event_type);

-- ────────────────────────────────────────────────────────────
-- 1f. Tabla admin_events (auditoría de acciones de admin)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_events (
  id          SERIAL PRIMARY KEY,
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_events_user_id ON admin_events(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_events_admin_id ON admin_events(admin_id);

-- ────────────────────────────────────────────────────────────
-- 1g. Tabla notifications (notificaciones in-app)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(50) NOT NULL,
  message     TEXT NOT NULL,
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, read);

-- ────────────────────────────────────────────────────────────
-- 1h. Columna plan_expiry_date en tabla plans (para vigencia global)
-- ────────────────────────────────────────────────────────────
ALTER TABLE plans ADD COLUMN IF NOT EXISTS plan_expiry_date TIMESTAMP DEFAULT NULL;

COMMIT;
