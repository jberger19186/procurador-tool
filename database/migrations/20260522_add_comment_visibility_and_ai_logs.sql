-- ============================================================================
-- Migración: 20260522_add_comment_visibility_and_ai_logs
-- Fase 4 Ítem 3 — Visibilidad de comentarios + IA suggest reply
--
-- Cambios:
-- 1. ticket_comments: nueva columna visibility ('external' default | 'internal')
-- 2. ai_assistance_logs: tabla nueva para telemetría de sugerencias IA
--    (mide cuánto edita el admin las respuestas sugeridas → permite ajustar el prompt)
-- ============================================================================

BEGIN;

-- 1. Visibilidad de comentarios
ALTER TABLE ticket_comments
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'external';

ALTER TABLE ticket_comments
  DROP CONSTRAINT IF EXISTS ticket_comments_visibility_check;

ALTER TABLE ticket_comments
  ADD CONSTRAINT ticket_comments_visibility_check
  CHECK (visibility IN ('external', 'internal'));

CREATE INDEX IF NOT EXISTS idx_comments_visibility
  ON ticket_comments(ticket_id, visibility);

-- 2. Telemetría de asistencia IA
CREATE TABLE IF NOT EXISTS ai_assistance_logs (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE,
  admin_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  suggested_text  TEXT NOT NULL,                        -- lo que generó la IA
  final_text      TEXT,                                  -- lo que finalmente envió el admin (NULL si descartó)
  edit_distance   INTEGER,                               -- Levenshtein simple (0 = sin cambios)
  action          VARCHAR(20) NOT NULL,                  -- 'suggested' | 'sent_as_is' | 'sent_edited' | 'discarded'
  generated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_ticket ON ai_assistance_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_admin  ON ai_assistance_logs(admin_id, generated_at);

COMMIT;

-- ─── ROLLBACK ─────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS ai_assistance_logs;
-- ALTER TABLE ticket_comments
--   DROP CONSTRAINT IF EXISTS ticket_comments_visibility_check,
--   DROP COLUMN IF EXISTS visibility;
-- DROP INDEX IF EXISTS idx_comments_visibility;
-- COMMIT;
