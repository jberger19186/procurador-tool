-- Permite registrar cuándo se editó una respuesta de admin en un ticket.
-- Additiva: NULL = nunca editada. No afecta comentarios existentes.
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS edited_at timestamp without time zone;
