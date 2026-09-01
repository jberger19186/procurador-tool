const rateLimit = require('express-rate-limit');

// S7 (revisión 2026-09-01, Etapa 3/SEC-2): ninguno de los 9 limiters de este archivo pasa
// una opción `store` — los 9 usan el `MemoryStore` default de express-rate-limit, es decir
// un contador EN MEMORIA del proceso, igual que la blacklist de tokens
// (middleware/tokenBlacklist.js) y el almacén de borradores de captura
// (utils/captureDrafts.js), ambos ya documentados en `ecosystem.config.js` como
// bloqueantes para escalar `instances` sin resolver antes el estado compartido. Este es
// un TERCER mecanismo con la misma dependencia, no mencionado hasta ahora: con
// `instances > 1` cada worker llevaría su PROPIO contador — un limiter de "300/5min" se
// volvería efectivamente "300×N/5min" repartido al azar entre los workers (según a cuál
// enrute el balanceador cada request), degradando en silencio el propio control de
// disponibilidad que este archivo implementa. NO subir `instances` de `procurador-api`
// sin mover estos 9 limiters a un store compartido (ej. `rate-limit-redis`) primero.

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
    // 150: cada login descarga ~12 scripts y el limiter cuenta por IP — varios
    // usuarios tras el mismo router (estudio jurídico) comparten el cupo.
    max: 150, // Máximo 150 descargas cada 5 minutos
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

// RI-3 (revisión 2026-07-19): defensa en profundidad para routers autenticados que no
// tenían ningún rate-limit de red (/license, /monitor, /tickets, /users, /usuarios/api).
// Umbral fijado con datos reales: el pico medido en la sesión de testing más intensa
// (14/07) fue 10 req/min desde una sola IP — 300/5min (60/min prom.) deja 6x de margen.
const generalAuthLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const identifier = req.user ? `Usuario ${req.user.id}` : `IP ${req.ip}`;
        console.warn(`⚠️ Rate limit excedido - General autenticado: ${identifier} ${req.path}`);
        res.status(429).json({
            error: 'Demasiadas peticiones. Por favor esperá un momento.',
            action: 'slow_down'
        });
    }
});

// D4 (revisión 2026-07-25): POST /analytics/event es público y sin auth (beacon de la
// landing) — sin este límite, cualquiera podía escribir filas ilimitadas y anónimas a
// analytics_events. 60/min por IP alcanza de sobra para una sesión real de navegación
// (section_view + cta_click son unos pocos eventos) y frena un abuso automatizado.
const analyticsEventLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({ ok: false });
    }
});

// F2.2 (Bitácora): POST /usuarios/capture es el ÚNICO endpoint anónimo que agrega la
// Bitácora — recibe el deep-link de los visores, que son archivos locales sin sesión (un
// <form> HTML no puede mandar Authorization, y por diseño no se embebe ninguna credencial
// en un archivo compartible). Sin este límite, cualquiera podría llenar el almacén de
// borradores en memoria desde internet. 30/5min por IP es el valor del plan (§4.1.1) y
// alcanza de sobra para el uso real: capturar caso por caso desde un visor son unos pocos
// clics, y el trabajo en lote va en UN request con todos los seleccionados.
// ⚠️ El límite de FRECUENCIA no reemplaza al tope de VOLUMEN: los borradores tienen su
// propio máximo simultáneo y TTL en utils/captureDrafts.js, y el lote su cap de 200 filas.
const captureLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ Rate limit excedido - Captura Bitácora: IP ${req.ip}`);
        res.status(429).send('Demasiadas capturas seguidas. Esperá unos minutos e intentá de nuevo.');
    }
});

module.exports = {
    loginLimiter,
    registerLimiter,
    apiLimiter,
    scriptExecutionLimiter,
    scriptDownloadLimiter,
    adminLimiter,
    generalAuthLimiter,
    analyticsEventLimiter,
    captureLimiter
};