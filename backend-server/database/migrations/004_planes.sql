-- ============================================
-- MIGRACIÓN 004: SISTEMA DE PLANES GRANULAR
-- ============================================

-- Tabla de planes configurable desde dashboard
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Procuración
    proc_executions_limit INTEGER DEFAULT 50,   -- -1 = ilimitado
    proc_expedientes_limit INTEGER DEFAULT -1,  -- máx expedientes por run, -1 = sin límite

    -- Informes
    informe_limit INTEGER DEFAULT 10,           -- total informes por período, -1 = ilimitado

    -- Monitoreo
    monitor_partes_limit INTEGER DEFAULT 3,     -- partes activas simultáneas
    monitor_novedades_limit INTEGER DEFAULT 10, -- consultas novedades por período, -1 = ilimitado
    -- La consulta inicial SIEMPRE está permitida (1 por parte, es prerequisito)

    -- Período
    period_days INTEGER DEFAULT 30,

    -- Estado
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Planes por defecto
INSERT INTO plans (name, display_name, description, proc_executions_limit, proc_expedientes_limit, informe_limit, monitor_partes_limit, monitor_novedades_limit, period_days)
VALUES
    ('BASIC',      'Plan Básico',        'Plan de entrada con funcionalidades esenciales', 50,  -1, 10,  3,  10,  30),
    ('PRO',        'Plan Profesional',   'Plan completo para uso profesional',             200, -1, 50,  10, 100, 30),
    ('ENTERPRISE', 'Plan Enterprise',    'Sin límites operativos',                         -1,  -1, -1,  50, -1,  30)
ON CONFLICT (name) DO NOTHING;

-- Trigger updated_at para plans
DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Extender subscriptions con columnas por subsistema
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS period_start TIMESTAMP DEFAULT NOW();
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS proc_usage INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS informe_usage INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS monitor_novedades_usage INTEGER DEFAULT 0;
-- Bonificaciones adicionales otorgadas por admin (suman al límite del plan)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS proc_bonus INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS informe_bonus INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS monitor_novedades_bonus INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS monitor_partes_bonus INTEGER DEFAULT 0;

-- Linkear suscripciones existentes a plan_id según nombre del plan
UPDATE subscriptions s
SET plan_id = p.id
FROM plans p
WHERE s.plan = p.name
  AND s.plan_id IS NULL;

-- Tabla de ajustes manuales de uso (admin concede/deduce usos)
CREATE TABLE IF NOT EXISTS usage_adjustments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_email VARCHAR(255),
    subsystem VARCHAR(30) NOT NULL CHECK (subsystem IN ('proc','informe','monitor_novedades','monitor_partes')),
    amount INTEGER NOT NULL,   -- positivo = otorgar, negativo = deducir
    reason TEXT,
    ticket_id INTEGER REFERENCES support_tickets(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Extender usage_logs con subsistema
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS subsystem VARCHAR(20);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS expedientes_count INTEGER;

-- Índices
CREATE INDEX IF NOT EXISTS idx_plans_name      ON plans(name);
CREATE INDEX IF NOT EXISTS idx_plans_active    ON plans(active);
CREATE INDEX IF NOT EXISTS idx_adj_user        ON usage_adjustments(user_id);
CREATE INDEX IF NOT EXISTS idx_adj_subsystem   ON usage_adjustments(subsystem);
CREATE INDEX IF NOT EXISTS idx_logs_subsystem  ON usage_logs(subsystem);
