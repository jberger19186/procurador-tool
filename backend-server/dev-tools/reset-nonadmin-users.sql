-- reset-nonadmin-users.sql
-- Elimina TODOS los usuarios no administradores y sus datos asociados.
-- Conserva los usuarios con role = 'admin'. Transaccional (todo o nada).

BEGIN;

-- Comentarios de tickets de usuarios no-admin + comentarios escritos por no-admin
DELETE FROM ticket_comments WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin'));
DELETE FROM ticket_comments WHERE author_id IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM support_tickets  WHERE user_id   IN (SELECT id FROM users WHERE role <> 'admin');

-- Pagos / facturas / webhooks (datos de prueba)
DELETE FROM invoices       WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM payments       WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM webhook_events;

-- Uso / logs / eventos
DELETE FROM usage_logs        WHERE user_id      IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM usage_adjustments WHERE user_id      IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM usage_extras      WHERE user_id      IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM user_events       WHERE user_id      IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM user_events       WHERE performed_by IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM admin_events      WHERE user_id      IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM analytics_events  WHERE user_id      IN (SELECT id FROM users WHERE role <> 'admin');

-- Notificaciones
DELETE FROM notifications      WHERE user_id    IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM user_notifications WHERE user_id    IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM user_notifications WHERE created_by IN (SELECT id FROM users WHERE role <> 'admin');

-- Monitor
DELETE FROM monitor_consultas_log WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM monitor_partes        WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin');

-- Ejecuciones, legales, suscripciones
DELETE FROM active_executions      WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM user_legal_acceptances WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin');
DELETE FROM subscriptions          WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin');

-- Finalmente, los usuarios no-admin
DELETE FROM users WHERE role <> 'admin';

COMMIT;

-- Verificación
SELECT id, email, role FROM users ORDER BY id;
