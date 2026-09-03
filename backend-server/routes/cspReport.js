/**
 * routes/cspReport.js — receptor de reportes de la CSP en modo "solo avisar".
 *
 * C.2 paso 0 (fase E2). El objetivo de esta fase es MEDIR, no bloquear: el middleware
 * `helmet.contentSecurityPolicy({ reportOnly: true, ... })` de server.js manda acá lo que
 * la CSP estricta bloquearía SI estuviera activa. La CSP enforced no cambió, así que nada
 * se rompe; este endpoint solo escribe una línea de log por violación.
 *
 * Lo que E12 (paso 3) necesita del log es el conteo POR DIRECTIVA:
 *     grep CSP-REPORT /var/log/procurador/combined.log | grep -o '"directive":"[^"]*"' | sort | uniq -c
 * La directiva que se reporta es la EFECTIVA: `script-src-attr`, `script-src-elem`,
 * `style-src-elem`… — filtrar por el prefijo `script-src` agarra las tres formas.
 *
 * ⚠️ Medido en Chromium el 2026-09-03: los handlers inline se compilan DIFERIDO. Cargar
 * /dashboard/ (16 `onclick` en el HTML) y /usuarios/ (38) dio CERO reportes; el primero
 * apareció recién al DISPARAR un handler. O sea: el log mide handlers USADOS, no handlers
 * EXISTENTES — un `onclick` de una pantalla que nadie abrió nunca no va a aparecer. Por
 * eso el criterio del paso 3 exige, ADEMÁS de los 7 días sin reportes, que el conteo de
 * atributos `on…=` por archivo dé cero. Son dos condiciones, no una.
 *
 * ⚠️ El log NO va a estar en cero desde el minuto uno, y no por los `onclick`:
 * /terminos/ y /privacidad/ cargan Google Fonts y ya violan `style-src`/`font-src` con la
 * CSP de hoy (defecto cosmético preexistente, ver spec C.2 paso 3). Esos reportes son
 * esperados y NO deben "limpiarse" relajando styleSrc. El arreglo (bajar las fuentes a
 * /assets y servirlas locales) queda para E12: toca el <head> de dos páginas legales, que
 * está fuera del alcance de esta fase, y el ruido no molesta porque el conteo se hace por
 * directiva. Verificado en Chromium: /terminos/ reporta `style-src-elem` con blocked-uri
 * `https://fonts.googleapis.com/css2` y NINGÚN `script-src`, así que no ensucia el conteo
 * que a E12 le importa.
 *
 * Decisiones de este archivo, todas en la dirección de no romper nada:
 *  - Es un endpoint PÚBLICO sin auth (el navegador manda el reporte sin credenciales).
 *  - Nunca toca la base de datos.
 *  - Nunca loguea `script-sample` ni el body crudo: un reporte puede arrastrar contenido
 *    de la página. Solo directiva, URI bloqueada, documento y línea.
 *  - A `document-uri` / `blocked-uri` se les saca el query string antes de loguear: hay
 *    páginas servidas por este mismo Express con secretos en la query
 *    (/auth/reset-password?token=…, /auth/verify-email?token=…) y los logs van a archivo
 *    y a Logtail (un tercero). El fragmento ya lo quita el navegador por spec.
 *  - Todo campo se limpia de caracteres de control y se trunca: el body lo escribe un
 *    tercero y termina en una línea de log.
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');
const logger    = require('../utils/logger');

const router = express.Router();

// Límite de red. Deliberadamente holgado: una sola pantalla del dashboard puede emitir
// decenas de reportes de golpe (hay ~189 handlers inline en dashboard.js y el navegador
// reporta uno por handler compilado), así que un límite estrecho perdería justo los datos
// que esta fase existe para juntar. 300/min por IP acota un flood a 300 líneas cortas por
// minuto, y el 429 no loguea (un flood no se convierte en flood de log).
// ⚠️ Mismo caveat que los 9 limiters de middleware/rateLimiter.js (S7): MemoryStore por
// proceso — no subir `instances` de PM2 sin mover el estado a un store compartido.
// Vive acá y no en middleware/rateLimiter.js a propósito: la ficha de E2 acota el cambio
// a server.js + este archivo, y E12 puede retirar el endpoint entero sin tocar nada más.
const cspReportLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).end()
});

// El navegador manda `application/csp-report` con `report-uri`. Se acepta también
// `application/json` porque es lo que usa cualquier verificación manual (curl).
const parseCspReport = express.json({
    type: ['application/csp-report', 'application/json'],
    limit: '16kb'
});

// RI-1 (revisión 2026-07-19): sin este wrapper, un body demasiado grande o mal formado
// cae al handler de errores global de server.js y sale como un 500 genérico. Acá se
// responde corto y sin cuerpo — al navegador el status le da igual (los reportes son
// fire-and-forget), pero deja el rechazo observable para quien verifica.
function parseCspReportOr4xx(req, res, next) {
    parseCspReport(req, res, (err) => {
        if (!err) return next();
        const status = err.type === 'entity.too.large' ? 413 : 400;
        return res.status(status).end();
    });
}

const MAX_URI       = 200;
const MAX_DIRECTIVE = 100;

/** Quita caracteres de control (incluidos saltos de línea) y trunca. */
function clean(value, max) {
    if (typeof value !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const stripped = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return stripped ? stripped.slice(0, max) : null;
}

/**
 * Deja la URI en origen + path. Si no es una URL (los reportes usan palabras como
 * `inline`, `eval` o `self` en blocked-uri), se devuelve el valor limpio tal cual.
 */
function safeUri(value) {
    const raw = clean(value, MAX_URI * 4);
    if (!raw) return null;
    try {
        const u = new URL(raw);
        u.search = '';
        u.hash = '';
        u.username = '';
        u.password = '';
        return clean(u.origin + u.pathname, MAX_URI);
    } catch (_) {
        return clean(raw, MAX_URI);
    }
}

/**
 * Normaliza los dos formatos posibles a un objeto plano.
 *  - `report-uri` (el que emitimos): { "csp-report": { "violated-directive": … } }
 *  - Reporting API: [ { "type": "csp-violation", "body": { "effectiveDirective": … } } ]
 * El segundo no debería llegar (no emitimos `report-to`), pero normalizarlo cuesta
 * cuatro líneas y evita un log con todos los campos en null si algún navegador lo manda.
 */
function normalize(body) {
    if (!body || typeof body !== 'object') return null;
    const entry = Array.isArray(body) ? body[0] : body;
    if (!entry || typeof entry !== 'object') return null;
    const r = entry['csp-report'] || entry.body || entry;
    if (!r || typeof r !== 'object') return null;

    // `violated-directive` puede venir con el valor pegado ("script-src-attr 'none'") y
    // `effective-directive` solo con el nombre. Se queda con el nombre en los dos casos,
    // para que el conteo por directiva de E12 no dependa de qué campo mandó el navegador.
    // Un nombre que no tenga forma de directiva se descarta: el endpoint es público y el
    // log no debería poder llenarse de etiquetas inventadas.
    const rawDirective = clean(r['effective-directive'] || r['violated-directive']
                            || r.effectiveDirective    || r.violatedDirective, MAX_DIRECTIVE);
    const directive = rawDirective ? rawDirective.split(/\s+/)[0].toLowerCase() : null;
    if (!directive || !/^[a-z0-9-]{1,50}$/.test(directive)) return null;

    const lineRaw = r['line-number'] !== undefined ? r['line-number'] : r.lineNumber;
    const hasLine = typeof lineRaw === 'number'
                 || (typeof lineRaw === 'string' && lineRaw.trim() !== '');
    const line    = hasLine && Number.isFinite(Number(lineRaw)) ? Number(lineRaw) : null;

    return {
        directive,
        blockedUri:  safeUri(r['blocked-uri']  !== undefined ? r['blocked-uri']  : r.blockedURL),
        documentUri: safeUri(r['document-uri'] !== undefined ? r['document-uri'] : r.documentURL),
        line
    };
}

// ── POST /csp-report ─────────────────────────────────────────────────────────
// Siempre 204 en el camino feliz, con o sin reporte reconocible. Nunca devuelve cuerpo.
router.post('/', cspReportLimiter, parseCspReportOr4xx, (req, res) => {
    try {
        const report = normalize(req.body);
        if (report) {
            logger.warn('🛡️ [CSP-REPORT] violación (report-only, no se bloqueó nada)', report);
        }
    } catch (e) {
        // Un reporte que no se puede loguear no puede tumbar nada.
        logger.warn('🛡️ [CSP-REPORT] reporte descartado', { err: e.message });
    }
    res.status(204).end();
});

module.exports = router;
