-- Migración 2026-06-27 (D1): GRANTs faltantes + default privileges para procurador_user
-- Motivo: tablas/secuencias creadas por el superusuario `postgres` (en migraciones corridas
-- como postgres) no otorgaban privilegios al rol de la app `procurador_user`. Caso concreto:
-- al aplicar un beneficio comercial el INSERT fallaba con
--   "permission denied for sequence commercial_benefits_id_seq"
-- (la tabla tenía grants, pero la SECUENCIA del id no).
--
-- Fix comprensivo: otorga sobre TODAS las tablas/secuencias actuales + ALTER DEFAULT
-- PRIVILEGES para que las FUTURAS creadas por postgres ya queden accesibles (pendiente D1).
-- Idempotente. Aplicada en prod.

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO procurador_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO procurador_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO procurador_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO procurador_user;
