-- 20260701_drop_check_plan_valid.sql
-- Elimina la constraint check_plan_valid de subscriptions, que restringía subscriptions.plan
-- a una lista HARDCODEADA de nombres (BASIC/PRO/ENTERPRISE/EXTENSION_PROMO/COMBO_PROMO).
-- Con el modelo de planes dinámicos (el admin crea planes públicos/privados/cortesía con
-- nombres nuevos), esa lista quedó obsoleta y bloqueaba asignar cualquier plan nuevo. La
-- integridad real la da subscriptions.plan_id (FK a plans); la columna de texto es legado.
-- Additiva/segura: solo remueve una restricción; no modifica datos.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS check_plan_valid;
