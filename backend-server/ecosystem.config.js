module.exports = {
    apps: [
        {
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
            cwd: '/var/www/procurador/backend-server',
            node_args: '-r dotenv/config',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            env: {
                DOTENV_CONFIG_PATH: '/var/www/procurador/backend-server/.env.staging'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: '/var/log/procurador/staging-error.log',
            out_file: '/var/log/procurador/staging-out.log',
            merge_logs: true
        }
    ]
};
