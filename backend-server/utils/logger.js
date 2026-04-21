/**
 * logger.js — Winston centralizado con soporte Logtail (Better Stack)
 * Transportes:
 *   - Consola (siempre, con colores en desarrollo)
 *   - Archivo error.log + combined.log (solo producción)
 *   - Logtail HTTP (solo producción, si LOGTAIL_TOKEN está definido)
 */

const winston = require('winston');

let LogtailTransport, Logtail;
try {
    ({ Logtail }          = require('@logtail/node'));
    ({ LogtailTransport } = require('@logtail/winston'));
} catch (_) {
    // Paquetes opcionales — si no están instalados, se omite el transport de Logtail
}

const isProd = process.env.NODE_ENV === 'production';

// ── Formatos ────────────────────────────────────────────────
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        return `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
);

const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// ── Transportes base ────────────────────────────────────────
const transports = [
    new winston.transports.Console({ format: consoleFormat })
];

if (isProd) {
    transports.push(
        new winston.transports.File({
            filename: '/var/log/procurador/error.log',
            level: 'error',
            format: fileFormat
        }),
        new winston.transports.File({
            filename: '/var/log/procurador/combined.log',
            format: fileFormat
        })
    );

    // Logtail (Better Stack) — opcional
    if (process.env.LOGTAIL_TOKEN && Logtail && LogtailTransport) {
        try {
            const logtail = new Logtail(process.env.LOGTAIL_TOKEN);
            transports.push(new LogtailTransport(logtail));
        } catch (e) {
            console.warn('⚠️ No se pudo inicializar Logtail:', e.message);
        }
    }
}

// ── Logger principal ────────────────────────────────────────
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports,
    exitOnError: false
});

module.exports = logger;
