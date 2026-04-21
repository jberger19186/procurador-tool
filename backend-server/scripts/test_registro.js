require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

async function test() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const hash = await bcrypt.hash('Test1234!', 10);
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 86400000);

        const userResult = await client.query(`
            INSERT INTO users (
                nombre, apellido, email, password_hash, cuit, domicilio,
                registration_status, toc_accepted_at,
                email_verified, email_verify_token, email_verify_expires
            ) VALUES ($1,$2,$3,$4,$5,$6,'pending_email',NOW(),false,$7,$8)
            RETURNING id, email
        `, [
            'Juan', 'Perez', 'dryrun_test@test.com', hash,
            '20123456786',
            JSON.stringify({ calle: 'Corrientes', numero: '1234', localidad: 'CABA', provincia: 'CABA' }),
            token, expires
        ]);

        console.log('✅ Usuario insertado:', userResult.rows[0].id, userResult.rows[0].email);

        await client.query(`
            INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_limit, usage_count, expires_at)
            VALUES ($1, $2, $3, 'suspended', 20, 0, NOW() + INTERVAL '365 days')
        `, [userResult.rows[0].id, 'COMBO_PROMO', 5]);

        console.log('✅ Suscripción insertada');

        await client.query('ROLLBACK');
        console.log('✅ Todo OK — transacción revertida (dry run)');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR:', e.message);
        console.error('   code:', e.code);
        console.error('   detail:', e.detail);
        console.error('   stack:', e.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

test();
