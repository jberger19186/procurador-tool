-- Elimina un usuario y todas sus dependencias por email. Transaccional.
-- Cambiar el email del :target_email según necesidad.
\set target_email 'procuradortool@gmail.com'

BEGIN;
DELETE FROM ticket_comments WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email'));
DELETE FROM ticket_comments WHERE author_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM support_tickets  WHERE user_id   IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM invoices WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM usage_logs        WHERE user_id      IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM usage_adjustments WHERE user_id      IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM usage_extras      WHERE user_id      IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM user_events       WHERE user_id      IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM user_events       WHERE performed_by IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM admin_events      WHERE user_id      IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM analytics_events  WHERE user_id      IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM notifications      WHERE user_id    IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM user_notifications WHERE user_id    IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM user_notifications WHERE created_by IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM monitor_consultas_log WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM monitor_partes        WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM active_executions      WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM user_legal_acceptances WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM subscriptions          WHERE user_id IN (SELECT id FROM users WHERE email = :'target_email');
DELETE FROM users WHERE email = :'target_email';
COMMIT;

SELECT id, email FROM users WHERE email = :'target_email';
