module.exports = {
    apps: [{
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
    }]
};
