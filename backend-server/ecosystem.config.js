module.exports = {
    apps: [
        {
            // B9 (revisión 2026-07-24): la blacklist de tokens JWT (middleware/tokenBlacklist.js)
            // solo consulta un Map EN MEMORIA del propio worker — la tabla token_blacklist en
            // Postgres se lee una única vez al arrancar (init) y las escrituras posteriores son
            // fire-and-forget. Con instances:1 esto es inocuo (un solo Map, siempre consistente;
            // no importa si el exec_mode es fork o cluster). Si algún día se escala este proceso
            // (pm2 scale / instances:'max' / instances > 1 en cualquier modo), un token
            // invalidado en el worker A seguiría siendo válido en el worker B hasta su
            // expiración natural — rompe el logout de admin (M-1) y del portal (RI-5) en
            // silencio, sin ningún error visible. NO subir `instances` de este proceso sin
            // antes resolver la blacklist compartida (read-through a la tabla, o mover a Redis).
            name: 'procurador-api',
            script: 'server.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '400M',
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: '/var/log/procurador/pm2-error.log',
            out_file: '/var/log/procurador/pm2-out.log',
            merge_logs: true
        },
        {
            // ── STAGING (entorno de pruebas, aislado de producción) ──────────────
            // Carga .env.staging por preload (gana sobre .env): DB procurador_db_staging,
            // puerto 3444, MercadoPago en SANDBOX. El resto se hereda de .env.
            // Sin secretos acá — solo la ruta al archivo de entorno de staging.
            name: 'procurador-staging',
            script: 'server.js',
            // Directorio de código PROPIO de staging (aislado de producción):
            // permite probar cambios de código sin afectar /var/www/procurador.
            cwd: '/var/www/procurador-staging/backend-server',
            node_args: '-r dotenv/config',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            env: {
                DOTENV_CONFIG_PATH: '/var/www/procurador-staging/backend-server/.env.staging'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: '/var/log/procurador/staging-error.log',
            out_file: '/var/log/procurador/staging-out.log',
            merge_logs: true
        }
    ]
};
