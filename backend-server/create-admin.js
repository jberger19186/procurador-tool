// Uso: node create-admin.js <email> <password>
// No lleva credenciales hardcodeadas — ver CLAUDE.md § Regla de secretos.
const bcrypt = require('bcrypt');

const EMAIL = process.argv[2];
const PASSWORD = process.argv[3];

if (!EMAIL || !PASSWORD) {
    console.error('Uso: node create-admin.js <email> <password>');
    process.exit(1);
}

bcrypt.hash(PASSWORD, 12).then(hash => {
    console.log('\n=== EJECUTA ESTE SQL EN PGADMIN ===\n');
    console.log(`INSERT INTO users (email, password_hash, role)`);
    console.log(`VALUES ('${EMAIL}', '${hash}', 'admin')`);
    console.log(`ON CONFLICT (email) DO UPDATE`);
    console.log(`  SET password_hash = EXCLUDED.password_hash,`);
    console.log(`      role = 'admin';`);
    console.log('\n===================================');
    console.log(`Email:      ${EMAIL}`);
    console.log(`Contraseña: ${PASSWORD}`);
    console.log('===================================\n');
});
