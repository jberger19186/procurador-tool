-- ============================================
-- SCHEMA COMPLETO - FASE 1 COMPLETADA
-- Backend de Encriptación con Sistema de Caché
-- ============================================

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    machine_id VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

-- Tabla de suscripciones
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plan VARCHAR(50) NOT NULL, -- 'BASIC', 'PRO', 'ENTERPRISE'
    status VARCHAR(50) NOT NULL, -- 'active', 'cancelled', 'expired', 'suspended'
    expires_at TIMESTAMP NOT NULL,
    usage_count INTEGER DEFAULT 0,
    usage_limit INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de scripts encriptados
CREATE TABLE IF NOT EXISTS encrypted_scripts (
    id SERIAL PRIMARY KEY,
    script_name VARCHAR(255) UNIQUE NOT NULL,
    encrypted_content TEXT NOT NULL,
    iv VARCHAR(32) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    version VARCHAR(20) DEFAULT '1.0.0',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de tokens JWT invalidados (logout persistente)
CREATE TABLE IF NOT EXISTS token_blacklist (
    token_hash  VARCHAR(64) PRIMARY KEY,   -- SHA-256 del token (no se almacena el JWT completo)
    expires_at  TIMESTAMP   NOT NULL,      -- Expira junto con el JWT original
    created_at  TIMESTAMP   DEFAULT NOW()
);

-- Tabla de logs de uso
CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    script_name VARCHAR(100),
    execution_date TIMESTAMP DEFAULT NOW(),
    success BOOLEAN,
    error_message TEXT
);

-- Tabla de tickets de soporte
CREATE TABLE IF NOT EXISTS support_tickets (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER     REFERENCES users(id) ON DELETE CASCADE,
    category        VARCHAR(20) NOT NULL CHECK (category IN ('technical', 'billing', 'commercial')),
    title           VARCHAR(200) NOT NULL,
    description     TEXT        NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'open'   CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority        VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    benefit_type    VARCHAR(30),
    benefit_value   DECIMAL(10,2),
    benefit_applied BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMP
);

-- Tabla de comentarios de tickets
CREATE TABLE IF NOT EXISTS ticket_comments (
    id          SERIAL PRIMARY KEY,
    ticket_id   INTEGER     NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id   INTEGER     NOT NULL REFERENCES users(id),
    author_role VARCHAR(10) NOT NULL CHECK (author_role IN ('user', 'admin')),
    message     TEXT        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ============================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ============================================

CREATE INDEX IF NOT EXISTS idx_user_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_machine_id ON users(machine_id);
CREATE INDEX IF NOT EXISTS idx_subscription_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_logs(execution_date);
CREATE INDEX IF NOT EXISTS idx_usage_script ON usage_logs(script_name);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);
CREATE INDEX IF NOT EXISTS idx_script_name ON encrypted_scripts(script_name);
CREATE INDEX IF NOT EXISTS idx_script_active ON encrypted_scripts(active);
CREATE INDEX IF NOT EXISTS idx_tickets_user     ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status   ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_comments_ticket  ON ticket_comments(ticket_id);

-- ============================================
-- TRIGGERS PARA UPDATED_AT AUTOMÁTICO
-- ============================================

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para encrypted_scripts
DROP TRIGGER IF EXISTS update_encrypted_scripts_updated_at ON encrypted_scripts;
CREATE TRIGGER update_encrypted_scripts_updated_at 
    BEFORE UPDATE ON encrypted_scripts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para subscriptions
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para support_tickets
DROP TRIGGER IF EXISTS update_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER update_support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CONSTRAINTS ADICIONALES
-- ============================================

-- Asegurar que los planes sean válidos
ALTER TABLE subscriptions 
DROP CONSTRAINT IF EXISTS check_plan_valid;

ALTER TABLE subscriptions
ADD CONSTRAINT check_plan_valid 
CHECK (plan IN ('BASIC', 'PRO', 'ENTERPRISE'));

-- Asegurar que los estados sean válidos
ALTER TABLE subscriptions 
DROP CONSTRAINT IF EXISTS check_status_valid;

ALTER TABLE subscriptions
ADD CONSTRAINT check_status_valid 
CHECK (status IN ('active', 'cancelled', 'expired', 'suspended'));

-- Asegurar que los roles sean válidos
ALTER TABLE users 
DROP CONSTRAINT IF EXISTS check_role_valid;

ALTER TABLE users
ADD CONSTRAINT check_role_valid 
CHECK (role IN ('user', 'admin'));

-- Asegurar que usage_count no sea negativo
ALTER TABLE subscriptions 
DROP CONSTRAINT IF EXISTS check_usage_count_positive;

ALTER TABLE subscriptions
ADD CONSTRAINT check_usage_count_positive 
CHECK (usage_count >= 0);

-- Asegurar que usage_limit sea positivo
ALTER TABLE subscriptions 
DROP CONSTRAINT IF EXISTS check_usage_limit_positive;

ALTER TABLE subscriptions
ADD CONSTRAINT check_usage_limit_positive 
CHECK (usage_limit > 0);

-- ============================================
-- DATOS DE EJEMPLO (OPCIONAL - COMENTAR EN PRODUCCIÓN)
-- ============================================

-- Descomentar para crear usuarios de prueba automáticamente

/*
-- Usuario de prueba (password: Test123456!)
INSERT INTO users (email, password_hash, role, machine_id)
VALUES (
    'test@example.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'user',
    'TEST-MACHINE-001'
) ON CONFLICT (email) DO NOTHING;

-- Suscripción PRO para usuario test
INSERT INTO subscriptions (user_id, plan, status, expires_at, usage_limit)
SELECT id, 'PRO', 'active', NOW() + INTERVAL '30 days', 1000
FROM users WHERE email = 'test@example.com'
ON CONFLICT (user_id) DO NOTHING;

-- Usuario admin (password: Admin123!)
INSERT INTO users (email, password_hash, role)
VALUES (
    'admin@procurador.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'admin'
) ON CONFLICT (email) DO NOTHING;

-- Suscripción ENTERPRISE para admin
INSERT INTO subscriptions (user_id, plan, status, expires_at, usage_limit)
SELECT id, 'ENTERPRISE', 'active', NOW() + INTERVAL '365 days', 999999
FROM users WHERE email = 'admin@procurador.com'
ON CONFLICT (user_id) DO NOTHING;
*/

-- ============================================
-- INFORMACIÓN DEL SCHEMA
-- ============================================

COMMENT ON TABLE users IS 'Usuarios del sistema con autenticación y hardware binding';
COMMENT ON TABLE subscriptions IS 'Suscripciones y límites de uso por usuario';
COMMENT ON TABLE encrypted_scripts IS 'Scripts encriptados con AES-256';
COMMENT ON TABLE usage_logs IS 'Registro de ejecuciones de scripts';

COMMENT ON COLUMN users.machine_id IS 'ID único del dispositivo para hardware binding';
COMMENT ON COLUMN users.last_login IS 'Timestamp del último login exitoso';
COMMENT ON COLUMN subscriptions.usage_count IS 'Contador de ejecuciones en el periodo actual';
COMMENT ON COLUMN subscriptions.usage_limit IS 'Límite de ejecuciones según el plan';
COMMENT ON COLUMN encrypted_scripts.iv IS 'Vector de inicialización para AES-256-CBC';
COMMENT ON COLUMN encrypted_scripts.hash IS 'SHA-256 hash del código para verificación de integridad';