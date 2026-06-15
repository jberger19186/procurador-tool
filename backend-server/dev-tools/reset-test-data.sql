-- reset-test-data.sql
-- Reset de datos para pruebas. Conserva usuarios 6, 7 (admins) y 19 (procuradortool).
-- Borra usuarios de prueba 5, 81, 93, 94, 95, 96, 97, 162, 214 y TODOS los datos transaccionales.
-- Ejecutar dentro de una transacción.

BEGIN;

-- ── 1. Wipe completo de datos transaccionales ──────────────────────────────
DELETE FROM ticket_comments;
DELETE FROM support_tickets;

DELETE FROM invoices;
DELETE FROM payments;
DELETE FROM webhook_events;

DELETE FROM usage_logs;
DELETE FROM usage_adjustments;
DELETE FROM usage_extras;

DELETE FROM user_events;
DELETE FROM admin_events;
DELETE FROM ai_assistance_logs;
DELETE FROM analytics_events;

DELETE FROM notifications;
DELETE FROM user_notifications;

DELETE FROM monitor_consultas_log;
DELETE FROM monitor_partes;

DELETE FROM active_executions;

-- ── 2. Borrar dependencias de los 9 usuarios de prueba ──────────────────────
DELETE FROM user_legal_acceptances WHERE user_id IN (5,81,93,94,95,96,97,162,214);
DELETE FROM subscriptions          WHERE user_id IN (5,81,93,94,95,96,97,162,214);

-- ── 3. Borrar los usuarios de prueba ────────────────────────────────────────
DELETE FROM users WHERE id IN (5,81,93,94,95,96,97,162,214);

-- ── 4. Resetear suscripciones de los usuarios conservados (6,7,19) ──────────
UPDATE subscriptions
SET payment_provider          = NULL,
    external_subscription_id  = NULL,
    payment_method_id         = NULL,
    cancel_at                 = NULL,
    auto_renewal              = TRUE,
    trial_bonus_until         = NULL,
    last_payment_at           = NULL,
    payment_grace_ends_at     = NULL,
    suspension_cause          = NULL,
    suspended_at              = NULL,
    suspended_by              = NULL,
    usage_count               = 0,
    proc_usage                = 0,
    informe_usage             = 0,
    batch_usage               = 0,
    monitor_novedades_usage   = 0,
    scheduled_plan            = NULL,
    plan_changes_this_cycle   = 0,
    plan_expiry_date          = NULL,
    next_billing_date         = NULL,
    checkout_initiated_at     = NULL,
    updated_at                = NOW()
WHERE user_id IN (6,7,19);

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
SELECT 'users' AS tabla, COUNT(*) FROM users
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL SELECT 'payments', COUNT(*) FROM payments
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'support_tickets', COUNT(*) FROM support_tickets
UNION ALL SELECT 'usage_logs', COUNT(*) FROM usage_logs
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'webhook_events', COUNT(*) FROM webhook_events
ORDER BY tabla;
