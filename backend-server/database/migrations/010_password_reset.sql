-- Migración 010: columnas para reset de contraseña
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_token   VARCHAR(128),
    ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;
