/**
 * list_users.js — Lista todos los usuarios con su CUIT asignado
 * Uso: node list_users.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT)
});

async function run() {
    try {
        const result = await pool.query(`
            SELECT u.id, u.email, u.role, u.cuit,
                   s.plan, s.status, s.expires_at
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            ORDER BY u.id
        `);

        console.log('\n📋 Usuarios registrados:\n');
        console.log('ID  | EMAIL                          | ROL    | CUIT        | PLAN       | ESTADO');
        console.log('----+--------------------------------+--------+-------------+------------+--------');
        result.rows.forEach(u => {
            const id    = String(u.id).padEnd(3);
            const email = (u.email || '').padEnd(30).substring(0, 30);
            const role  = (u.role || '').padEnd(6);
            const cuit  = (u.cuit || '(sin CUIT)').padEnd(11);
            const plan  = (u.plan || '(sin sub)').padEnd(10);
            const status = u.status || '-';
            console.log(`${id} | ${email} | ${role} | ${cuit} | ${plan} | ${status}`);
        });
        console.log('');
    } catch (err) {
        console.error('❌ ERROR:', err.message);
    } finally {
        await pool.end();
    }
}

run();
