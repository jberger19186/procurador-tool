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
