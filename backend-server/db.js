/**
 * db.js
 * Pool PostgreSQL compartido para módulos que no tienen acceso a req.app
 * (services, utils). Las rutas siguen usando req.app.get('db').
 */

const { Pool } = require('pg');

const pool = new Pool({
    user:     process.env.DB_USER,
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port:     parseInt(process.env.DB_PORT || '5432', 10)
});

module.exports = pool;
