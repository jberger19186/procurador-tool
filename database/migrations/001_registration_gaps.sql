-- =============================================================================
-- Migración 001 — Registration Gaps
-- Fecha: 2026-04-27
-- Descripción: Crea tabla app_settings, renombra pending_payment → pending_activation
-- =============================================================================

BEGIN;

-- 1. Tabla de configuración dinámica de la app (Gap 5)
CREATE TABLE IF NOT EXISTS app_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT         NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Valor inicial: registro habilitado (igual que ALLOW_PUBLIC_REGISTER=true)
INSERT INTO app_settings (key, value, updated_at)
VALUES ('allow_public_register', 'true', NOW())
ON CONFLICT (key) DO NOTHING;

-- 2. Renombrar pending_payment → pending_activation en datos existentes (Gap 3)
UPDATE users
SET registration_status = 'pending_activation'
WHERE registration_status = 'pending_payment';

-- 3. Actualizar el CHECK constraint para aceptar el nuevo nombre
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_registration_status_check;

ALTER TABLE users
    ADD CONSTRAINT users_registration_status_check
    CHECK (registration_status IN ('pending_email', 'pending_activation', 'active', 'trial'));

COMMIT;
