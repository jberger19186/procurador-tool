require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function createTestUser() {
    try {
        console.log('👤 Creando usuarios de prueba...');

        // Hash de contraseñas
        const testPassword = await bcrypt.hash('Test123456!', 10);
        const adminPassword = await bcrypt.hash('Admin123!', 10);

        console.log('🔐 Contraseñas hasheadas');

        // Eliminar registros relacionados PRIMERO (en orden correcto por foreign keys)
        console.log('🗑️ Limpiando registros anteriores...');

        // 1. Eliminar logs de uso
        await pool.query(`
            DELETE FROM usage_logs 
            WHERE user_id IN (
                SELECT id FROM users 
                WHERE email IN ('test@example.com', 'admin@procurador.com')
            )
        `);

        // 2. Eliminar suscripciones
        await pool.query(`
            DELETE FROM subscriptions 
            WHERE user_id IN (
                SELECT id FROM users 
                WHERE email IN ('test@example.com', 'admin@procurador.com')
            )
        `);

        // 3. Ahora sí eliminar usuarios
        await pool.query(`
            DELETE FROM users 
            WHERE email IN ('test@example.com', 'admin@procurador.com')
        `);

        console.log('✅ Registros anteriores eliminados');

        // Crear usuario de prueba
        const userResult = await pool.query(`
            INSERT INTO users (email, password_hash, role, machine_id)
            VALUES ($1, $2, 'user', 'TEST-MACHINE-001')
            RETURNING id, email
        `, ['test@example.com', testPassword]);

        const userId = userResult.rows[0].id;
        console.log(`✅ Usuario creado: ${userResult.rows[0].email} (ID: ${userId})`);

        // Crear suscripción PRO para usuario test
        await pool.query(`
            INSERT INTO subscriptions (user_id, plan, status, expires_at, usage_limit)
            VALUES ($1, 'PRO', 'active', NOW() + INTERVAL '30 days', 1000)
        `, [userId]);

        console.log('✅ Suscripción PRO creada (1000 ejecuciones, 30 días)');

        // Crear usuario admin
        const adminResult = await pool.query(`
            INSERT INTO users (email, password_hash, role)
            VALUES ($1, $2, 'admin')
            RETURNING id, email
        `, ['admin@procurador.com', adminPassword]);

        const adminId = adminResult.rows[0].id;
        console.log(`✅ Admin creado: ${adminResult.rows[0].email} (ID: ${adminId})`);

        // Crear suscripción ENTERPRISE para admin
        await pool.query(`
            INSERT INTO subscriptions (user_id, plan, status, expires_at, usage_limit)
            VALUES ($1, 'ENTERPRISE', 'active', NOW() + INTERVAL '365 days', 999999)
        `, [adminId]);

        console.log('✅ Suscripción ENTERPRISE creada para admin (999999 ejecuciones, 365 días)');

        console.log('\n📋 Credenciales de prueba:');
        console.log('━'.repeat(50));
        console.log('Usuario de prueba:');
        console.log('  Email: test@example.com');
        console.log('  Password: Test123456!');
        console.log('  Machine ID: TEST-MACHINE-001');
        console.log('  Plan: PRO (1000 ejecuciones/mes)');
        console.log('\nUsuario admin:');
        console.log('  Email: admin@procurador.com');
        console.log('  Password: Admin123!');
        console.log('  Plan: ENTERPRISE (999999 ejecuciones/año)');
        console.log('━'.repeat(50));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

createTestUser();