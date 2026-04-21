-- 008_active_executions.sql
-- Control de ejecución simultánea multi-dispositivo
-- Solo puede haber una ejecución activa por usuario a la vez.
-- El lock se libera automáticamente por TTL si el cliente no envía heartbeats.

CREATE TABLE IF NOT EXISTS active_executions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    machine_id      VARCHAR(255) NOT NULL,
    script_name     VARCHAR(100),
    started_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_heartbeat  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at      TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- Un usuario solo puede tener un lock activo a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_executions_user
    ON active_executions(user_id);

-- Índice para limpieza eficiente de locks expirados
CREATE INDEX IF NOT EXISTS idx_active_executions_expires
    ON active_executions(expires_at);
