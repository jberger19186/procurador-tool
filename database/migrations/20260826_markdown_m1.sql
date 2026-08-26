-- 20260826_markdown_m1.sql — Módulo Markdown / Anonimización, bloque M1 (habilitación por plan)
--
-- Copia exacta del patrón ya probado de Bitácora F1.1: un interruptor maestro
-- por plan, FALSE por defecto. 100% aditiva — no toca datos ni columnas
-- existentes. Reaplicable sin error (IF NOT EXISTS).
--
-- ⚠️ NADA queda visible para ningún usuario al aplicarla: `plans.markdown_enabled`
--    nace en `false` en los 6 planes. El módulo se enciende plan por plan desde
--    el dashboard admin, cuando el resto de los bloques (M2–M5) esté listo.
--
-- Ver: docs/internal/plan-modulo-markdown-anonimizacion-2026-08-26.md §3 (M1)

ALTER TABLE plans ADD COLUMN IF NOT EXISTS markdown_enabled BOOLEAN DEFAULT false;

COMMENT ON COLUMN plans.markdown_enabled IS 'Gate por plan del módulo Markdown/Anonimización. FALSE por defecto — se enciende plan por plan desde el dashboard admin. No consume cupo (decisión del operador, 2026-08-26): procesamiento 100% local, no toca el PJN ni gasta recursos del servidor.';

-- Rollback (por si hiciera falta revertir):
--    ALTER TABLE plans DROP COLUMN IF EXISTS markdown_enabled;
