-- Migración: paso de promos a ARS
-- Fecha: 2026-05-22
-- Motivo: estandarizar pricing a ARS (ver Bloque 1 — Branding & Pricing)
-- EXTENSION_PROMO: USD 1     → ARS 1.500
-- COMBO_PROMO   : USD 9,99   → ARS 15.000

BEGIN;

UPDATE plans
SET price_ars = 1500.00,
    price_usd = NULL,
    updated_at = NOW()
WHERE name = 'EXTENSION_PROMO';

UPDATE plans
SET price_ars = 15000.00,
    price_usd = NULL,
    updated_at = NOW()
WHERE name = 'COMBO_PROMO';

-- Verificación
SELECT id, name, price_usd, price_ars, plan_type, active FROM plans ORDER BY id;

COMMIT;
