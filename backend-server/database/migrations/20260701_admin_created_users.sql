-- 20260701_admin_created_users.sql
-- Marca los usuarios creados por el administrador desde el dashboard (alta manual),
-- para distinguirlos del registro público. Se usa en la verificación de email:
-- un usuario creado por admin con un plan de $0 (cortesía) queda ACTIVO al verificar;
-- el resto sigue el flujo normal (pending_activation / trial).
-- Additiva, default false → no cambia el comportamiento de los usuarios existentes.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS admin_created BOOLEAN NOT NULL DEFAULT false;
