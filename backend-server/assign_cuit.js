/**
 * assign_cuit.js
 * Uso: node assign_cuit.js <email> <cuit>
 * Ejemplo: node assign_cuit.js usuario@email.com 27320694359
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

async function assignCuit() {
    const email = process.argv[2];
    const cuit  = process.argv[3];

    if (!email || !cuit) {
        console.error('❌ Uso: node assign_cuit.js <email> <cuit>');
        console.error('   Ejemplo: node assign_cuit.js usuario@mail.com 27320694359');
        process.exit(1);
    }

    if (!/^\d{11}$/.test(cuit)) {
        console.error('❌ El CUIT debe tener exactamente 11 dígitos numéricos');
        process.exit(1);
    }

    try {
        // Verificar que el usuario existe
        const check = await pool.query('SELECT id, email, cuit FROM users WHERE email = $1', [email]);
        if (check.rows.length === 0) {
            console.error(`❌ No se encontró ningún usuario con email: ${email}`);
            process.exit(1);
        }

        const user = check.rows[0];
        console.log(`👤 Usuario encontrado: ID=${user.id}, email=${user.email}`);
        if (user.cuit) {
            console.log(`   CUIT anterior: ${user.cuit}`);
        }

        // Asignar el CUIT
        await pool.query('UPDATE users SET cuit = $1 WHERE id = $2', [cuit, user.id]);
        console.log(`✅ CUIT ${cuit} asignado correctamente al usuario ${email}`);

        // Verificar resultado
        const verify = await pool.query('SELECT cuit FROM users WHERE id = $1', [user.id]);
        console.log(`✅ Verificación: cuit en BD = ${verify.rows[0].cuit}`);

    } catch (err) {
        console.error('❌ ERROR:', err.message);
    } finally {
        await pool.end();
    }
}

assignCuit();
