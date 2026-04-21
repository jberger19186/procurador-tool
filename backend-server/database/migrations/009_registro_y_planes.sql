-- Migración 009 — Registro público, nuevos campos en users y plans, planes promo
-- Ejecutar: psql -U <user> -d <db> -f 009_registro_y_planes.sql

-- ─── Nuevos campos en users ───────────────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS nombre               VARCHAR(100),
    ADD COLUMN IF NOT EXISTS apellido             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cuit                 VARCHAR(20),
    ADD COLUMN IF NOT EXISTS domicilio            JSONB,
    -- domicilio: { calle, numero, piso?, depto?, localidad, provincia }
    ADD COLUMN IF NOT EXISTS registration_status  VARCHAR(20) DEFAULT 'active'
        CHECK (registration_status IN ('pending_email','pending_payment','active','trial')),
    ADD COLUMN IF NOT EXISTS toc_accepted_at      TIMESTAMP,
    ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS email_verify_token   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMP;

-- Usuarios existentes: marcarlos como verificados y activos
UPDATE users SET email_verified = true, registration_status = 'active'
    WHERE email_verified IS NULL OR email_verified = false;

-- ─── Nuevos campos en plans ───────────────────────────────────────────────────
ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS price_usd        DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS price_ars        DECIMAL(12,2),
    ADD COLUMN IF NOT EXISTS plan_type        VARCHAR(20) DEFAULT 'electron'
        CHECK (plan_type IN ('electron','extension','combo')),
    ADD COLUMN IF NOT EXISTS promo_type       VARCHAR(10) DEFAULT NULL
        CHECK (promo_type IN ('date','quota')),
    -- promo_type = 'date'  → respetar promo_end_date
    -- promo_type = 'quota' → respetar promo_max_users
    -- NULL                 → promo indefinida (se cierra manualmente poniendo active=false)
    ADD COLUMN IF NOT EXISTS promo_end_date   TIMESTAMP DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS promo_max_users  INTEGER   DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS promo_used_count INTEGER   DEFAULT 0,
    ADD COLUMN IF NOT EXISTS promo_alert_days INTEGER   DEFAULT 15;
    -- promo_alert_days: días de anticipación con que se avisa al usuario (configurable por plan)

-- Marcar planes existentes como tipo electron
UPDATE plans
    SET plan_type = 'electron'
    WHERE name IN ('BASIC','PRO','ENTERPRISE')
      AND (plan_type IS NULL OR plan_type != 'electron');

-- ─── Nuevos planes promo ──────────────────────────────────────────────────────
INSERT INTO plans (
    name,
    display_name,
    description,
    plan_type,
    price_usd,
    proc_executions_limit,
    informe_limit,
    monitor_partes_limit,
    monitor_novedades_limit,
    batch_executions_limit,
    extension_flows,
    promo_type,
    promo_alert_days
) VALUES
(
    'EXTENSION_PROMO',
    'Solo Extensión — Promo Lanzamiento',
    'Acceso completo a los 5 flujos de la extensión Chrome. Precio promocional de lanzamiento: $1 USD.',
    'extension',
    1.00,
    0, 0, 0, 0, 0,
    '["consulta","escritos1","escritos2","notificaciones","deox"]'::jsonb,
    NULL,
    15
),
(
    'COMBO_PROMO',
    'Extensión + App Electron — Beta',
    'Extensión Chrome completa más aplicación Electron. Precio promocional versión Beta: $9.99 USD.',
    'combo',
    9.99,
    50, 10, 3, 10, 20,
    '["consulta","escritos1","escritos2","notificaciones","deox"]'::jsonb,
    NULL,
    15
)
ON CONFLICT (name) DO NOTHING;

-- Extender check constraint de subscriptions para incluir nuevos planes promo
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS check_plan_valid;
ALTER TABLE subscriptions ADD CONSTRAINT check_plan_valid
    CHECK (plan IN ('BASIC','PRO','ENTERPRISE','EXTENSION_PROMO','COMBO_PROMO'));

-- Resincronizar secuencias (por si el restore dejó valores desajustados)
SELECT setval(pg_get_serial_sequence('plans',        'id'), (SELECT MAX(id) FROM plans));
SELECT setval(pg_get_serial_sequence('users',        'id'), (SELECT MAX(id) FROM users));
SELECT setval(pg_get_serial_sequence('subscriptions','id'), (SELECT MAX(id) FROM subscriptions));
