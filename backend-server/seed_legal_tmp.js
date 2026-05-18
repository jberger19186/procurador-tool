const { Pool } = require('pg');
require('dotenv').config();
const fs = require('fs');
const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT
});
(async () => {
    const tycHtml = fs.readFileSync('public/terminos/index.html','utf8');
    const pypHtml = fs.readFileSync('public/privacidad/index.html','utf8');
    const adminRes = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    const adminId = adminRes.rows[0]?.id || null;

    await pool.query(
        'INSERT INTO legal_documents (type,version,title,html_content,summary_of_changes,is_current,requires_acceptance,effective_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['tyc','1.0','Términos y Condiciones de Uso',tycHtml,'Versión inicial.',true,true,'2026-05-14',adminId]
    );
    console.log('TyC v1.0 insertado');

    await pool.query(
        'INSERT INTO legal_documents (type,version,title,html_content,summary_of_changes,is_current,requires_acceptance,effective_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['pyp','1.0','Política de Privacidad',pypHtml,'Versión inicial.',true,true,'2026-05-14',adminId]
    );
    console.log('PyP v1.0 insertado');

    await pool.end();
    console.log('Seed completado.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
