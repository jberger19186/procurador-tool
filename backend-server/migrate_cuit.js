require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT)
});

async function migrate() {
    try {
        // Agregar columna cuit
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS cuit VARCHAR(20)');
        console.log('✅ Columna cuit agregada (o ya existía)');

        // Eliminar constraint previo si existe
        await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS check_cuit_format');
        console.log('✅ Constraint previo eliminado');

        // Agregar constraint de formato
        await pool.query(`ALTER TABLE users ADD CONSTRAINT check_cuit_format CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$')`);
        console.log('✅ Constraint de formato agregado');

        // Verificar columnas actuales
        const result = await pool.query(
            `SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_name = 'users'
             ORDER BY ordinal_position`
        );
        console.log('\n📋 Columnas de tabla users:');
        result.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));

    } catch (err) {
        console.error('❌ ERROR:', err.message);
    } finally {
        await pool.end();
    }
}

migrate();
