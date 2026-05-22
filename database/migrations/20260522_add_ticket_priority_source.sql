-- ============================================================================
-- Migración: 20260522_add_ticket_priority_source
-- Fase 4 Ítem 2 — Prioridad IA en tickets
--
-- Agrega trazabilidad del origen de la prioridad (manual, ai, ai_overridden)
-- y campos auxiliares para razonamiento y auditoría.
--
-- El campo `priority` ya existía con valores: 'low' | 'medium' | 'high' | 'urgent'
-- (default 'medium', check constraint vigente).
-- ============================================================================

BEGIN;

-- Nuevos campos
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS priority_source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS priority_notes  TEXT,
  ADD COLUMN IF NOT EXISTS priority_set_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS priority_set_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Constraint check para priority_source (NULL = nunca seteado explícitamente)
ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_priority_source_check;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_priority_source_check
  CHECK (priority_source IS NULL OR priority_source IN ('manual', 'ai', 'ai_overridden'));

-- Índice para filtrar rápido los tickets que necesitan priorización IA
CREATE INDEX IF NOT EXISTS idx_tickets_priority_source
  ON support_tickets(priority_source)
  WHERE priority_source IS NULL OR priority_source = 'ai';

COMMIT;

-- ─── ROLLBACK (DOWN) ──────────────────────────────────────────────────────────
-- En caso de necesidad de revertir:
-- BEGIN;
-- ALTER TABLE support_tickets
--   DROP CONSTRAINT IF EXISTS support_tickets_priority_source_check,
--   DROP COLUMN IF EXISTS priority_source,
--   DROP COLUMN IF EXISTS priority_notes,
--   DROP COLUMN IF EXISTS priority_set_at,
--   DROP COLUMN IF EXISTS priority_set_by;
-- DROP INDEX IF EXISTS idx_tickets_priority_source;
-- COMMIT;
