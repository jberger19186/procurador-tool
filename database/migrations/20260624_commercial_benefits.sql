-- Beneficios comerciales como tabla de eventos (modelo cortesía / usage_extras).
-- Antes el beneficio se guardaba en un único slot en support_tickets
-- (benefit_applied/benefit_type/benefit_value) → 1 por ticket, no historial, no
-- aplicable sin ticket. Esta tabla permite N beneficios por usuario, con o sin
-- ticket asociado, y un historial real.

CREATE TABLE IF NOT EXISTS commercial_benefits (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id           INTEGER REFERENCES support_tickets(id) ON DELETE SET NULL,
    benefit_type        VARCHAR(30) NOT NULL,   -- discount | plan_upgrade | usage_reset
    benefit_value       VARCHAR(100),
    applied_by_admin_id INTEGER REFERENCES users(id),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_benefits_user   ON commercial_benefits(user_id);
CREATE INDEX IF NOT EXISTS idx_commercial_benefits_ticket ON commercial_benefits(ticket_id);

-- Backfill: no perder los beneficios ya aplicados en tickets.
INSERT INTO commercial_benefits (user_id, ticket_id, benefit_type, benefit_value, created_at)
SELECT user_id, id, benefit_type, benefit_value, COALESCE(resolved_at, updated_at, created_at)
FROM support_tickets
WHERE benefit_applied = TRUE
  AND benefit_type IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM commercial_benefits cb WHERE cb.ticket_id = support_tickets.id
  );
