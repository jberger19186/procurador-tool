// dev-tools/test-user.js — Herramienta de TESTING (NO producción).
// Borra un usuario de prueba (libera email + CUIT) y ajusta usos/contadores en la DB.
// Corre en el server contra la DB. Uso (vía SSH):
//   cd /var/www/procurador/backend-server && node dev-tools/test-user.js <comando> ...
//
// Comandos:
//   show   <email>
//   delete <email>
//   trial  <email> <usados> [limite=20]
//   usage  <email> <proc|batch|informe|monitor_novedades> <usados>
//   bonus  <email> <proc|batch|informe|monitor_novedades|monitor_partes> <n>
//   reset  <email>
require('dotenv').config();
const db = require('../db');

const USAGE_COL = {
  proc: 'proc_usage', batch: 'batch_usage', informe: 'informe_usage',
  monitor_novedades: 'monitor_novedades_usage',
};
const BONUS_COL = {
  proc: 'proc_bonus', batch: 'batch_bonus', informe: 'informe_bonus',
  monitor_novedades: 'monitor_novedades_bonus', monitor_partes: 'monitor_partes_bonus',
};

async function getUserId(email) {
  const { rows } = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return rows[0] ? rows[0].id : null;
}

async function list() {
  const { rows } = await db.query(`
    SELECT u.id, u.email, u.registration_status, u.cuit, u.role, s.payment_provider
    FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
    ORDER BY u.id`);
  console.log(`\n=== Usuarios (${rows.length}) ===`);
  for (const r of rows) {
    const tipo = r.role === 'admin' ? 'ADMIN' : (r.payment_provider ? 'pago' : 'trial/—');
    console.log(`id ${r.id} | ${r.email} | ${r.registration_status || '—'} | cuit ${r.cuit || '—'} | ${tipo}`);
  }
}

async function show(email) {
  const { rows } = await db.query(`
    SELECT u.id, u.email, u.cuit, u.telefono, u.registration_status, u.email_verified,
           s.status, s.payment_provider,
           s.usage_count, s.usage_limit,
           s.proc_usage, s.batch_usage, s.informe_usage, s.monitor_novedades_usage,
           s.proc_bonus, s.batch_bonus, s.informe_bonus, s.monitor_novedades_bonus, s.monitor_partes_bonus,
           p.proc_executions_limit, p.batch_executions_limit, p.informe_limit,
           p.monitor_novedades_limit, p.monitor_partes_limit
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    LEFT JOIN plans p ON p.id = s.plan_id
    WHERE LOWER(u.email) = LOWER($1)`, [email]);
  if (!rows[0]) return console.log('❌ Usuario no encontrado:', email);
  const r = rows[0];
  console.log(`\n=== ${r.email} (id ${r.id}) ===`);
  console.log(`registration_status: ${r.registration_status} | sub.status: ${r.status} | pago: ${r.payment_provider || '—'} | cuit: ${r.cuit || '—'}`);
  console.log(`TRIAL  → usados ${r.usage_count}/${r.usage_limit}`);
  console.log(`proc            ${r.proc_usage}/${(r.proc_executions_limit ?? 0) + (r.proc_bonus || 0)}  (plan ${r.proc_executions_limit} + bonus ${r.proc_bonus || 0})`);
  console.log(`batch           ${r.batch_usage}/${(r.batch_executions_limit ?? 0) + (r.batch_bonus || 0)}  (plan ${r.batch_executions_limit} + bonus ${r.batch_bonus || 0})`);
  console.log(`informe         ${r.informe_usage}/${(r.informe_limit ?? 0) + (r.informe_bonus || 0)}  (plan ${r.informe_limit} + bonus ${r.informe_bonus || 0})`);
  console.log(`monitor_novedades ${r.monitor_novedades_usage}/${(r.monitor_novedades_limit ?? 0) + (r.monitor_novedades_bonus || 0)}  (plan ${r.monitor_novedades_limit} + bonus ${r.monitor_novedades_bonus || 0})`);
  console.log(`monitor_partes (bonus ${r.monitor_partes_bonus || 0}, límite plan ${r.monitor_partes_limit})`);
}

async function del(email) {
  const id = await getUserId(email);
  if (!id) return console.log('❌ Usuario no encontrado:', email);
  await db.query('BEGIN');
  try {
    await db.query(`DELETE FROM ticket_comments WHERE author_id = $1 OR ticket_id IN (SELECT id FROM support_tickets WHERE user_id = $1)`, [id]);
    await db.query('DELETE FROM support_tickets        WHERE user_id = $1', [id]);
    await db.query('DELETE FROM invoices               WHERE user_id = $1', [id]);
    await db.query('DELETE FROM payments               WHERE user_id = $1', [id]);
    await db.query('DELETE FROM usage_logs             WHERE user_id = $1', [id]);
    await db.query('DELETE FROM usage_adjustments      WHERE user_id = $1', [id]);
    await db.query('DELETE FROM usage_extras           WHERE user_id = $1', [id]);
    await db.query('DELETE FROM user_events            WHERE user_id = $1 OR performed_by = $1', [id]);
    await db.query('DELETE FROM admin_events           WHERE user_id = $1 OR admin_id = $1', [id]);
    await db.query('DELETE FROM ai_assistance_logs     WHERE admin_id = $1', [id]);
    await db.query('DELETE FROM analytics_events       WHERE user_id = $1', [id]);
    await db.query('DELETE FROM notifications          WHERE user_id = $1', [id]);
    await db.query('DELETE FROM user_notifications     WHERE user_id = $1 OR created_by = $1', [id]);
    await db.query('DELETE FROM monitor_consultas_log  WHERE user_id = $1', [id]);
    await db.query('DELETE FROM monitor_partes         WHERE user_id = $1', [id]);
    await db.query('DELETE FROM active_executions      WHERE user_id = $1', [id]);
    await db.query('DELETE FROM user_legal_acceptances WHERE user_id = $1', [id]);
    await db.query('DELETE FROM subscriptions          WHERE user_id = $1 OR suspended_by = $1', [id]);
    await db.query('DELETE FROM users                  WHERE id = $1', [id]);
    await db.query('COMMIT');
    console.log(`✅ Usuario ${email} (id ${id}) borrado. Email y CUIT liberados para re-registrar.`);
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('❌ Error borrando (rollback):', e.message);
  }
}

async function setTrial(email, used, limit) {
  const id = await getUserId(email);
  if (!id) return console.log('❌ Usuario no encontrado:', email);
  const u = parseInt(used, 10), l = parseInt(limit || 20, 10);
  await db.query('UPDATE subscriptions SET usage_count = $2, usage_limit = $3, updated_at = NOW() WHERE user_id = $1', [id, u, l]);
  console.log(`✅ Trial seteado: ${u}/${l} (usage_count/usage_limit)`);
}

async function setUsage(email, sub, used) {
  const col = USAGE_COL[sub];
  if (!col) return console.log('❌ Submódulo inválido. Usar:', Object.keys(USAGE_COL).join(', '));
  const id = await getUserId(email);
  if (!id) return console.log('❌ Usuario no encontrado:', email);
  await db.query(`UPDATE subscriptions SET ${col} = $2, updated_at = NOW() WHERE user_id = $1`, [id, parseInt(used, 10)]);
  console.log(`✅ ${col} = ${used}`);
}

async function setBonus(email, sub, n) {
  const col = BONUS_COL[sub];
  if (!col) return console.log('❌ Submódulo inválido. Usar:', Object.keys(BONUS_COL).join(', '));
  const id = await getUserId(email);
  if (!id) return console.log('❌ Usuario no encontrado:', email);
  await db.query(`UPDATE subscriptions SET ${col} = $2, updated_at = NOW() WHERE user_id = $1`, [id, parseInt(n, 10)]);
  console.log(`✅ ${col} = ${n}`);
}

async function reset(email) {
  const id = await getUserId(email);
  if (!id) return console.log('❌ Usuario no encontrado:', email);
  await db.query(`UPDATE subscriptions SET usage_count = 0, proc_usage = 0, batch_usage = 0,
    informe_usage = 0, monitor_novedades_usage = 0, updated_at = NOW() WHERE user_id = $1`, [id]);
  console.log('✅ Contadores reseteados a 0 (trial + submódulos)');
}

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'list':   await list(); break;
      case 'show':   await show(a[0]); break;
      case 'delete': await del(a[0]); break;
      case 'trial':  await setTrial(a[0], a[1], a[2]); break;
      case 'usage':  await setUsage(a[0], a[1], a[2]); break;
      case 'bonus':  await setBonus(a[0], a[1], a[2]); break;
      case 'reset':  await reset(a[0]); break;
      default:
        console.log(`Herramienta de testing de usuarios. Comandos:
  list                                                     lista todos los usuarios (para elegir cuál borrar)
  show   <email>                                           estado actual (usos por submódulo + trial)
  delete <email>                                           borra el usuario (libera email + CUIT)
  trial  <email> <usados> [limite=20]                      setea el trial (usage_count/usage_limit)
  usage  <email> <proc|batch|informe|monitor_novedades> <usados>   setea el uso de un submódulo (ej: proc 20)
  bonus  <email> <submódulo> <n>                           setea *_bonus (extiende el límite del submódulo)
  reset  <email>                                           resetea todos los contadores a 0`);
    }
  } catch (e) { console.error('❌', e.message); }
  process.exit(0);
})();
