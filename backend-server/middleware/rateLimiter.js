const rateLimit = require('express-rate-limit');

// Rate limiter para login (prevenir fuerza bruta)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20, // 20 intentos por ventana de 15 minutos
    message: {
        error: 'Demasiados intentos de login. Por favor intenta de nuevo en 15 minutos.',
        action: 'wait'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ Rate limit excedido - Login: ${req.ip} ${req.body.email || ''}`);
        res.status(429).json({
            error: 'Demasiados intentos de login',
            action: 'wait',
            retryAfter: '15 minutos'
        });
    }
});

// Rate limiter para registro
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 3, // Máximo 3 registros por hora
    message: {
        error: 'Demasiados intentos de registro. Por favor intenta de nuevo más tarde.',
        action: 'wait'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ Rate limit excedido - Registro: ${req.ip}`);
        res.status(429).json({
            error: 'Demasiados intentos de registro',
            action: 'wait',
            retryAfter: '1 hora'
        });
    }
});

// Rate limiter general para API (prevenir spam)
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 100, // Máximo 100 requests por minuto
    message: {
        error: 'Demasiadas peticiones. Por favor reduce la velocidad.',
        action: 'slow_down'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ Rate limit excedido - API: ${req.ip} ${req.path}`);
        res.status(429).json({
            error: 'Demasiadas peticiones',
            action: 'slow_down',
            retryAfter: '1 minuto'
        });
    }
});

// Rate limiter para ejecución de scripts (prevenir abuso del servicio)
const scriptExecutionLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // Máximo 30 ejecuciones por minuto
    message: {
        error: 'Demasiadas ejecuciones de scripts. Por favor espera un momento.',
        action: 'slow_down'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Usar skip en lugar de keyGenerator personalizado
    skip: (req) => !req.user,
    handler: (req, res) => {
        const identifier = req.user ? `Usuario ${req.user.id}` : `IP ${req.ip}`;
        console.warn(`⚠️ Rate limit excedido - Script execution: ${identifier}`);
        res.status(429).json({
            error: 'Demasiadas ejecuciones de scripts',
            action: 'slow_down',
            retryAfter: '1 minuto'
        });
    }
});

// Rate limiter para descarga de scripts
const scriptDownloadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 50, // Máximo 50 descargas cada 5 minutos
    message: {
        error: 'Demasiadas descargas de scripts. Por favor espera un momento.',
        action: 'slow_down'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const identifier = req.user ? `Usuario ${req.user.id}` : `IP ${req.ip}`;
        console.warn(`⚠️ Rate limit excedido - Script download: ${identifier}`);
        res.status(429).json({
            error: 'Demasiadas descargas de scripts',
            action: 'slow_down',
            retryAfter: '5 minutos'
        });
    }
});

// Rate limiter para endpoints de admin (más restrictivo)
const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 200, // Máximo 200 requests por minuto
    message: {
        error: 'Demasiadas peticiones a endpoints administrativos.',
        action: 'slow_down'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ Rate limit excedido - Admin: ${req.ip}`);
        res.status(429).json({
            error: 'Demasiadas peticiones administrativas',
            action: 'slow_down'
        });
    }
});

module.exports = {
    loginLimiter,
    registerLimiter,
    apiLimiter,
    scriptExecutionLimiter,
    scriptDownloadLimiter,
    adminLimiter
};