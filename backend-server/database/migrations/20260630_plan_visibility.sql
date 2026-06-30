-- 20260630_plan_visibility.sql
-- Planes públicos / privados.
-- public  → elegible por el usuario (form de registro + selector del portal)
-- private → solo asignable por el administrador (no aparece en las listas del usuario)
-- Additiva: todos los planes existentes quedan 'public' (incluidos los desactivados),
-- por lo que no cambia el comportamiento actual hasta que un admin marque un plan como private.

ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private'));
