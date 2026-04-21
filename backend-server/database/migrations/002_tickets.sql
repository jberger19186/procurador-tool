-- ============================================
-- MIGRACIÓN 002: Sistema de tickets de soporte
-- ============================================

-- Tabla principal de tickets
CREATE TABLE IF NOT EXISTS support_tickets (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    category        VARCHAR(20)  NOT NULL CHECK (category IN ('technical', 'billing', 'commercial')),
    title           VARCHAR(200) NOT NULL,
    description     TEXT         NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'open'   CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority        VARCHAR(20)  NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    benefit_type    VARCHAR(30),        -- 'discount' | 'plan_upgrade' | 'usage_reset'
    benefit_value   DECIMAL(10,2),     -- días de extensión, o valor referencial
    benefit_applied BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMP
);

-- Tabla de comentarios / hilo de conversación
CREATE TABLE IF NOT EXISTS ticket_comments (
    id          SERIAL PRIMARY KEY,
    ticket_id   INTEGER     NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id   INTEGER     NOT NULL REFERENCES users(id),
    author_role VARCHAR(10) NOT NULL CHECK (author_role IN ('user', 'admin')),
    message     TEXT        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_tickets_user     ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status   ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_comments_ticket  ON ticket_comments(ticket_id);

-- Trigger updated_at para tickets (reutiliza la función existente)
DROP TRIGGER IF EXISTS update_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER update_support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE support_tickets IS 'Tickets de soporte: técnico, facturación y beneficios comerciales';
COMMENT ON TABLE ticket_comments IS 'Hilo de comentarios por ticket (usuario y admin)';
COMMENT ON COLUMN support_tickets.benefit_type IS 'Tipo de beneficio comercial: discount | plan_upgrade | usage_reset';
COMMENT ON COLUMN support_tickets.benefit_value IS 'Valor del beneficio (ej: días de extensión)';
COMMENT ON COLUMN support_tickets.benefit_applied IS 'TRUE una vez que el admin aplicó el beneficio en la suscripción';
