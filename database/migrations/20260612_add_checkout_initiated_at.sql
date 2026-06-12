-- 2026-06-12 — Atribución del checkout de MercadoPago por ventana de tiempo.
-- El checkout plan-based de MP no persiste external_reference ni payer_email en el
-- preapproval (quedan vacíos), por lo que ni el webhook ni /checkout/confirm pueden
-- atribuir la suscripción al usuario. Se registra cuándo el usuario inició el checkout
-- (/checkout/init) para poder reclamar de forma verificada el preapproval autorizado
-- creado dentro de esa ventana (ver subscriptionService.markPaymentConfigured).

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS checkout_initiated_at TIMESTAMP WITH TIME ZONE;

-- Rollback:
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS checkout_initiated_at;
