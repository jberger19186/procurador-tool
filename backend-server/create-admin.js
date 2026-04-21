const bcrypt = require('bcrypt');

const EMAIL = 'admin@procurador.com';
const PASSWORD = 'Admin2024!';

bcrypt.hash(PASSWORD, 10).then(hash => {
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
