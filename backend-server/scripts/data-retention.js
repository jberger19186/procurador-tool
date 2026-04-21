/**
 * data-retention.js — Política de retención de datos
 *
 * Ejecutar manualmente o vía cron:
 *   node backend-server/scripts/data-retention.js
 *
 * Política:
 *   - usage_logs:                  eliminar registros > 90 días
 *   - email_verify tokens:         eliminar usuarios pending_email con token expirado > 48hs
 *   - token_blacklist:             limpieza ya automatizada por el sistema; este script también la hace
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');

const pool = new Pool({
    user:     process.env.DB_USER,
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port:     process.env.DB_PORT
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('🧹 Iniciando limpieza de datos...\n');

        // 1. Logs de ejecución > 90 días
        const logsResult = await client.query(`
            DELETE FROM usage_logs
            WHERE created_at < NOW() - INTERVAL '90 days'
        `);
        console.log(`✅ usage_logs eliminados: ${logsResult.rowCount}`);

        // 2. Usuarios con email sin verificar cuyo token expiró hace más de 48hs
        //    (registered pero nunca verificaron → se eliminan junto con su suscripción por CASCADE)
        const expiredTokensResult = await client.query(`
            DELETE FROM users
            WHERE registration_status = 'pending_email'
              AND email_verify_expires < NOW() - INTERVAL '48 hours'
        `);
        console.log(`✅ Usuarios con token vencido eliminados: ${expiredTokensResult.rowCount}`);

        // 3. Token blacklist vencida
        const blacklistResult = await client.query(`
            DELETE FROM token_blacklist
            WHERE expires_at < NOW()
        `);
        console.log(`✅ token_blacklist expirados eliminados: ${blacklistResult.rowCount}`);

        console.log('\n✅ Limpieza completada.');
    } catch (err) {
        console.error('❌ Error durante la limpieza:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
