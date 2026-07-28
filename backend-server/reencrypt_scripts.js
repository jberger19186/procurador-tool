require('dotenv').config();
const { Pool } = require('pg');
const { processScripts } = require('./utils/scriptEncryption');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT)
});

async function run() {
    try {
        // Hallazgo de la sesión 2026-07-28 (Bloque C): `require('dotenv').config()` sin
        // path carga el .env de process.cwd() — si este script se invoca a mano desde el
        // directorio de staging, carga la .env BASE de staging (que apunta a procurador_db,
        // la de PROD), no .env.staging. Esto ya causó que una corrida "de prueba en staging"
        // reencriptara producción sin querer. No se rediseña la resolución del entorno (el
        // cron real de prod y pm2+staging con -r dotenv/config ya funcionan bien) — se deja
        // BIEN VISIBLE contra qué base se va a escribir, para que un humano lo note antes de
        // que corra. Para apuntar a staging desde afuera de su propio directorio, usar:
        //   node -r dotenv/config reencrypt_scripts.js dotenv_config_path=.env.staging
        console.log(`⚠️  Base de datos objetivo: ${process.env.DB_NAME} @ ${process.env.DB_HOST} (verificar que sea la correcta antes de continuar)`);
        console.log('🔐 Re-encriptando scripts...');
        await processScripts(pool);
        console.log('✅ Scripts re-encriptados correctamente en la BD');
    } catch (err) {
        console.error('❌ ERROR:', err.message);
    } finally {
        await pool.end();
    }
}

run();
