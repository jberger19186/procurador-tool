-- ============================================
-- MIGRACIÓN 005: LÍMITES INDEPENDIENTES PARA PROCURAR BATCH
-- ============================================

-- Agregar límites de batch a la tabla plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS batch_executions_limit INTEGER DEFAULT 20;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS batch_expedientes_limit INTEGER DEFAULT 10;

-- Actualizar planes existentes con valores de batch
UPDATE plans SET batch_executions_limit = 20,  batch_expedientes_limit = 10  WHERE name = 'BASIC';
UPDATE plans SET batch_executions_limit = 100, batch_expedientes_limit = 50  WHERE name = 'PRO';
UPDATE plans SET batch_executions_limit = -1,  batch_expedientes_limit = -1  WHERE name = 'ENTERPRISE';

-- Agregar uso de batch a subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS batch_usage INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS batch_bonus INTEGER DEFAULT 0;

-- Ampliar el CHECK constraint de usage_adjustments para incluir 'batch'
ALTER TABLE usage_adjustments DROP CONSTRAINT IF EXISTS usage_adjustments_subsystem_check;
ALTER TABLE usage_adjustments ADD CONSTRAINT usage_adjustments_subsystem_check
    CHECK (subsystem IN ('proc','batch','informe','monitor_novedades','monitor_partes'));

-- Índice adicional
CREATE INDEX IF NOT EXISTS idx_logs_subsystem_batch ON usage_logs(subsystem) WHERE subsystem = 'batch';
