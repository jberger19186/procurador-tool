-- ============================================================
-- Migración 001: Flujo de Usuario v2.1
-- Idempotente: cada bloque maneja objetos ya existentes.
-- Sin transacción global para que un error no aborte todo.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1a. Ampliar columna registration_status a VARCHAR(30)
-- (suspended_plan_expired tiene 22 chars — VARCHAR(20) era insuficiente)
-- ────────────────────────────────────────────────────────────
ALTER TABLE users ALTER COLUMN registration_status TYPE VARCHAR(30);

-- ────────────────────────────────────────────────────────────
-- 1b. CHECK constraint de users.registration_status
-- ────────────────────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_registration_status_check;

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
-- 1b. CHECK constraint de subscriptions.status
-- ────────────────────────────────────────────────────────────
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS check_status_valid;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

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
-- 1c. Columnas nuevas en subscriptions (IF NOT EXISTS es seguro)
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
-- Usa excepción para manejar el caso de que ya exista
-- (ya sea como constraint o como índice)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_cuit_unique UNIQUE (cuit);
  RAISE NOTICE 'Constraint users_cuit_unique creado.';
EXCEPTION
  WHEN duplicate_table THEN
    RAISE NOTICE 'Constraint users_cuit_unique ya existe, omitiendo.';
  WHEN duplicate_object THEN
    RAISE NOTICE 'Constraint users_cuit_unique ya existe, omitiendo.';
END $$;

-- ────────────────────────────────────────────────────────────
-- 1e. Tabla user_events
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_events (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type  VARCHAR(50) NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_id    ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_event_type ON user_events(event_type);

-- ────────────────────────────────────────────────────────────
-- 1f. Tabla admin_events
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_events (
  id          SERIAL PRIMARY KEY,
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_events_user_id  ON admin_events(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_events_admin_id ON admin_events(admin_id);

-- ────────────────────────────────────────────────────────────
-- 1g. Tabla notifications
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
-- 1h. Columna plan_expiry_date en tabla plans
-- ────────────────────────────────────────────────────────────
ALTER TABLE plans ADD COLUMN IF NOT EXISTS plan_expiry_date TIMESTAMP DEFAULT NULL;

-- ────────────────────────────────────────────────────────────
-- 1i. Columna payload en user_events (puede pre-existir con esquema diferente)
-- ────────────────────────────────────────────────────────────
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';

-- ────────────────────────────────────────────────────────────
-- 1j. Permisos para procurador_user en tablas nuevas
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  EXECUTE 'GRANT ALL PRIVILEGES ON TABLE user_events TO procurador_user';
  EXECUTE 'GRANT ALL PRIVILEGES ON TABLE admin_events TO procurador_user';
  EXECUTE 'GRANT ALL PRIVILEGES ON TABLE notifications TO procurador_user';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE user_events_id_seq TO procurador_user';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE admin_events_id_seq TO procurador_user';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO procurador_user';
  RAISE NOTICE 'Permisos otorgados a procurador_user en tablas de eventos.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Aviso al otorgar permisos: %', SQLERRM;
END $$;

-- ────────────────────────────────────────────────────────────
-- Verificación final
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  col_count INTEGER;
  tbl_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'subscriptions'
    AND column_name IN ('suspension_cause','suspended_at','billing_paused',
                        'suspension_reason','plan_expiry_date','plan_changes_this_cycle',
                        'next_billing_date','payment_provider','cancel_at',
                        'scheduled_plan','plan_change_history','reactivation_request',
                        'payment_grace_ends_at','suspended_by');

  SELECT COUNT(*) INTO tbl_count
  FROM pg_tables
  WHERE tablename IN ('user_events','admin_events','notifications');

  RAISE NOTICE '✅ Migración completada: % columnas nuevas en subscriptions, % tablas nuevas creadas.', col_count, tbl_count;
END $$;
