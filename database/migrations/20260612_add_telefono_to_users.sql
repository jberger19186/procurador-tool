-- 2026-06-12 — Mi Perfil del portal: la UI y PUT /usuarios/api/profile manejan
-- "telefono" pero la columna nunca existió en users → guardar el perfil fallaba 500.

ALTER TABLE users ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);

-- Rollback:
-- ALTER TABLE users DROP COLUMN IF EXISTS telefono;
