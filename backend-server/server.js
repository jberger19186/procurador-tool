require('dotenv').config();
const logger = require('./utils/logger');
const cron = require('node-cron');
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const { processScripts, getCacheStats, clearCache } = require('./utils/scriptEncryption');
const { apiLimiter } = require('./middleware/rateLimiter');
const tokenBlacklist = require('./middleware/tokenBlacklist');

const helmet = require('helmet');
const app = express();

// B-1: validar que JWT_SECRET exista y sea suficientemente fuerte antes de arrancar.
// Sin esto, si la variable falta el servidor arrancaba y fallaba recién al primer login.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('❌ FATAL: JWT_SECRET no configurado o demasiado corto (mínimo 32 caracteres).');
    console.error('   Definí un JWT_SECRET robusto en el archivo .env antes de iniciar el servidor.');
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const SSL_KEY = process.env.SSL_KEY_PATH || path.join(__dirname, 'certs', 'key.pem');
const SSL_CERT = process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'cert.pem');

// Seguridad HTTP headers
// B-5: Content Security Policy (defensa en profundidad contra XSS).
// Las páginas usan estilos y event handlers (onclick) inline → se permite
// 'unsafe-inline' para style/script (incl. script-src-attr, que por defecto Helmet
// pone en 'none' y bloquearía los onclick). El resto se restringe.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc:    ["'self'"],
            scriptSrc:     ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],        // event handlers inline (onclick, etc.)
            styleSrc:      ["'self'", "'unsafe-inline'"],
            imgSrc:        ["'self'", "data:"],
            fontSrc:       ["'self'", "data:"],
            connectSrc:    ["'self'"],
            objectSrc:     ["'none'"],
            baseUri:       ["'self'"],
            frameAncestors: ["'self'"],
            formAction:    ["'self'"]
        }
    }
}));

// CORS — rutas públicas HTML (navegador) no tienen restricción de origen
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'];

const PUBLIC_HTML_PATHS = ['/auth/reset-password', '/auth/forgot-password', '/auth/verify-email', '/register'];

app.use((req, res, next) => {
    const isPublicHtml = PUBLIC_HTML_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'));
    if (isPublicHtml) {
        // Páginas de navegador: permitir cualquier origen sin credenciales
        return cors({ origin: true, credentials: false })(req, res, next);
    }
    // API: solo orígenes permitidos
    return cors({
        origin: function (origin, callback) {
            if (!origin) return callback(null, true);
            if (origin.startsWith('chrome-extension://') || origin.startsWith('extension://')) {
                return callback(null, true);
            }
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(null, false); // Rechaza sin lanzar error (el browser bloqueará; no expone 500)
        },
        credentials: true
    })(req, res, next);
});

// Capturar rawBody para verificar firma de webhooks MercadoPago (HMAC-SHA256)
app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: false })); // Para formularios HTML (reset-password, etc.)

// Trust proxy (importante para rate limiting con reverse proxy)
app.set('trust proxy', 1);

// Rate limiting global para toda la API
app.use('/api', apiLimiter);

// PostgreSQL Pool
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Hacer pool accesible en toda la app
app.set('db', pool);

// Test de conexión
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Error conectando a PostgreSQL:', err);
    } else {
        console.log('✅ Conectado a PostgreSQL');
    }
});

// Servir assets estáticos globales (íconos, imágenes de marca)
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
// PDFs de facturas — acceso directo por URL opaca (nombre de archivo con timestamp)
app.use('/invoices', express.static(path.join(__dirname, 'public', 'invoices')));

// Servir dashboard web admin como archivos estáticos
app.use('/dashboard', express.static(path.join(__dirname, 'public', 'dashboard')));

// Servir página de registro público
app.use('/register', express.static(path.join(__dirname, 'public', 'register')));

// Servir páginas legales
app.use('/terminos', express.static(path.join(__dirname, 'public', 'terminos')));
app.use('/privacidad', express.static(path.join(__dirname, 'public', 'privacidad')));

// ── Distribución de extensión Chrome: eliminada (migrado a Chrome Web Store v1.3.2)
// Las rutas /extension/updates.xml y /extension/latest.crx fueron removidas.
// La extensión se distribuye exclusivamente desde:
// https://chromewebstore.google.com/detail/aodnfemklhciagaglpggnclmbdhnhbme

// Rutas
app.use('/auth', require('./routes/auth'));
app.use('/api/extension', require('./routes/extension'));
app.use('/scripts', require('./routes/scripts'));
app.use('/admin', require('./routes/admin'));
app.use('/client', require('./routes/client'));
app.use('/tickets', require('./routes/tickets'));
app.use('/monitor', require('./routes/monitor'));
app.use('/license', require('./routes/license'));
app.use('/users', require('./routes/users'));
app.use('/legal', require('./routes/legal'));

// ── Fase 5: Cobranza — rutas detrás de feature flag ──────────────────────────
// checkPaymentEnabled se aplica internamente en cada router
app.use('/usuarios/api/checkout', require('./routes/checkout'));
app.use('/webhooks',              require('./routes/webhooks'));

// Página guiada de actualización de extensión
app.get('/descargar', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Actualizar extensión — Procurador SCW</title>
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:system-ui,Arial,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
        .card{background:#fff;border-radius:16px;padding:36px 40px;max-width:560px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.1)}
        h2{color:#1e40af;font-size:20px;margin-bottom:6px}
        .subtitle{color:#6b7280;font-size:13px;margin-bottom:28px}
        .step{display:flex;gap:16px;margin-bottom:20px;align-items:flex-start}
        .step-num{background:#1e40af;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;margin-top:1px}
        .step-num.done{background:#16a34a}
        .step-body{flex:1}
        .step-title{font-size:14px;font-weight:600;color:#111;margin-bottom:4px}
        .step-desc{font-size:13px;color:#4b5563;line-height:1.5}
        .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:.15s}
        .btn-primary{background:#1e40af;color:#fff}
        .btn-primary:hover{background:#1d4ed8}
        .btn-primary:disabled{background:#93c5fd;cursor:default}
        .btn-secondary{background:#f1f5f9;color:#374151;border:1.5px solid #e2e8f0}
        .btn-secondary:hover{background:#e2e8f0}
        code{background:#e0f2fe;color:#0369a1;padding:2px 7px;border-radius:4px;font-size:12.5px}
        .copy-wrap{display:flex;align-items:center;gap:8px;margin-top:8px}
        .badge-ok{display:none;color:#16a34a;font-size:12px;font-weight:600}
        .divider{border:none;border-top:1px solid #e2e8f0;margin:24px 0}
        #status-msg{font-size:13px;color:#16a34a;margin-top:10px;display:none}
        #err-msg{font-size:13px;color:#dc2626;margin-top:10px;display:none}
    </style>
    </head><body><div class="card">
        <h2>⬆️ Actualización de extensión</h2>
        <p class="subtitle">Seguí estos pasos para instalar la nueva versión de Procurador SCW</p>

        <!-- Paso 1: Descargar -->
        <div class="step">
            <div class="step-num" id="n1">1</div>
            <div class="step-body">
                <div class="step-title">Descargá la nueva versión</div>
                <div class="step-desc" style="margin-bottom:10px">Hacé clic para descargar el archivo ZIP con la extensión actualizada.</div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
                    <button class="btn btn-primary" id="btn-dl" data-label="⬇ Descargar extensión" onclick="descargar()">⬇ Descargar extensión</button>
                    <button class="btn btn-secondary" id="btn-electron" data-label="⬇ Descargar App Electron" onclick="descargarElectron()">⬇ Descargar App Electron</button>
                </div>
                <div id="status-msg">✅ ZIP descargado en tu carpeta de Descargas</div>
                <div id="status-electron" style="font-size:13px;color:#16a34a;margin-top:8px;display:none">✅ Instalador descargado en tu carpeta de Descargas</div>
                <div id="err-msg"></div>
                <div id="err-electron"></div>
            </div>
        </div>

        <div class="step">
            <div class="step-num" id="n2">2</div>
            <div class="step-body">
                <div class="step-title">Encontrá la carpeta de la extensión</div>
                <div class="step-desc" style="margin-bottom:10px">
                    Abrí <strong>chrome://extensions</strong> en Chrome, buscá <strong>PJN – Automatización</strong> y hacé clic en el botón <strong>Detalles</strong>. Dentro de esa pantalla buscá la sección <em>Fuente</em>. Vas a ver algo así:
                </div>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-size:12px;color:#374151;margin-bottom:10px;line-height:1.8">
                    <span style="color:#6b7280">Fuente</span><br>
                    Extensión sin empaquetar<br>
                    <span style="color:#6b7280">Cargados desde:</span>
                    <span style="color:#1d4ed8;text-decoration:underline;cursor:pointer">...\AppData\Local\ProcuradorSCW\extension</span>
                </div>
                <div class="step-desc">Hacé clic en ese enlace azul — se abre directamente la carpeta donde está instalada la extensión.</div>
            </div>
        </div>

        <div class="step">
            <div class="step-num" id="n3">3</div>
            <div class="step-body">
                <div class="step-title">Extraé el ZIP en esa carpeta</div>
                <div class="step-desc">
                    Abrí la carpeta de <strong>Descargas</strong>, clic derecho sobre <code>procurador-extension.zip</code> → <strong>Extraer aquí</strong> (o "Extraer todo").<br><br>
                    Seleccioná todos los archivos extraídos y copialos a la carpeta que abriste en el paso anterior, reemplazando los existentes.
                </div>
            </div>
        </div>

        <div class="step">
            <div class="step-num" id="n4">4</div>
            <div class="step-body">
                <div class="step-title">Recargá la extensión en Chrome</div>
                <div class="step-desc">
                    En <strong>chrome://extensions</strong>, buscá <strong>PJN – Automatización</strong> y hacé clic en el ícono 🔄 de recarga. La extensión quedará actualizada a la nueva versión.
                </div>
                <div class="copy-wrap" style="margin-top:8px">
                    <code>chrome://extensions</code>
                    <button class="btn btn-secondary" style="padding:6px 12px;font-size:12px" onclick="copiar()">📋 Copiar dirección</button>
                    <span class="badge-ok" id="copied-ok">✅ Copiado</span>
                </div>
            </div>
        </div>

        <hr class="divider">
        <p style="font-size:12px;color:#9ca3af;text-align:center">¿Tenés la app de escritorio? Abrila e iniciá sesión — la actualización se aplica automáticamente.</p>
    </div>

    <script>
    // Token: primero del hash (extensión), luego de localStorage (portal de usuario)
    function getToken() {
        return window.location.hash.slice(1) || localStorage.getItem('psc_user_token') || '';
    }

    async function descargarConEndpoint(endpoint, filename, btnId, statusId, errId) {
        const btn = document.getElementById(btnId);
        const statusEl = document.getElementById(statusId);
        const errEl = document.getElementById(errId);
        btn.disabled = true;
        btn.textContent = 'Descargando…';

        const token = getToken();
        if (!token) {
            errEl.textContent = '❌ No hay sesión activa. Ingresá desde el portal de usuario o la extensión.';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = btn.dataset.label;
            return;
        }

        try {
            const res = await fetch(endpoint, {
                headers: { Authorization: 'Bearer ' + token }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Error ' + res.status);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            btn.textContent = '✅ Descargado';
            if (statusEl) statusEl.style.display = 'block';
        } catch(e) {
            errEl.textContent = '❌ ' + (e.message || 'Error al descargar. Intentá de nuevo.');
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = btn.dataset.label;
        }
    }

    function descargar() {
        descargarConEndpoint('/api/extension/download', 'procurador-extension.zip', 'btn-dl', 'status-msg', 'err-msg');
    }

    async function descargarElectron() {
        const btn = document.getElementById('btn-electron');
        const errEl = document.getElementById('err-electron');
        btn.disabled = true;
        btn.textContent = 'Preparando...';
        const token = getToken();
        if (!token) {
            errEl.textContent = '❌ No hay sesión activa.';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = btn.dataset.label;
            return;
        }
        try {
            const res = await fetch('/api/extension/electron-token', {
                headers: { Authorization: 'Bearer ' + token }
            });
            if (!res.ok) throw new Error('Error al generar enlace');
            const { token: dlToken } = await res.json();
            window.location.href = '/api/extension/electron-download?token=' + dlToken;
            btn.textContent = btn.dataset.label;
            setTimeout(() => { btn.disabled = false; }, 3000);
        } catch(e) {
            errEl.textContent = '❌ ' + (e.message || 'Error al descargar.');
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = btn.dataset.label;
        }
    }

    function copiar() {
        navigator.clipboard.writeText('chrome://extensions').then(() => {
            document.getElementById('copied-ok').style.display = 'inline';
            setTimeout(() => document.getElementById('copied-ok').style.display = 'none', 2000);
        });
    }
    </script>
    </body></html>`);
});

// Portal de usuario
app.use('/usuarios/api', require('./routes/usuarios'));
app.use('/usuarios', express.static(path.join(__dirname, 'public', 'usuarios')));
app.get('/usuarios', (req, res) => res.sendFile(path.join(__dirname, 'public', 'usuarios', 'index.html')));

// Health check sin rate limiting — valida DB y retorna 503 si cae
app.get('/health', async (req, res) => {
    const cacheStats = getCacheStats();
    const mem = process.memoryUsage();

    let dbStatus = { status: 'ok', latency_ms: null };
    try {
        const db = req.app.get('db');
        const t0 = Date.now();
        await db.query('SELECT 1');
        dbStatus.latency_ms = Date.now() - t0;
    } catch (err) {
        dbStatus = { status: 'error', message: err.message };
    }

    const httpStatus = dbStatus.status === 'error' ? 503 : 200;

    res.status(httpStatus).json({
        status: dbStatus.status === 'ok' ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        database: dbStatus,
        memory: {
            used_mb: Math.round(mem.heapUsed / 1024 / 1024),
            total_mb: Math.round(mem.heapTotal / 1024 / 1024)
        },
        cache: cacheStats
    });
});

// Endpoint para limpiar caché (requiere autenticación admin)
const authenticateToken = require('./middleware/authenticateToken');
app.post('/cache/clear', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado: se requiere rol admin' });
    }

    try {
        clearCache();
        res.json({
            success: true,
            message: 'Caché limpiado correctamente'
        });
    } catch (error) {
        console.error('Error al limpiar caché:', error);
        res.status(500).json({ error: 'Error al limpiar caché' });
    }
});

// Manejo de rutas no encontradas
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint no encontrado',
        path: req.path
    });
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Inicialización
async function init() {
    try {
        // Inicializar blacklist persistente (crea tabla si no existe + carga tokens vigentes)
        await tokenBlacklist.init(pool);

        console.log('🔐 Encriptando scripts...');
        await processScripts(pool);

        // Intentar levantar HTTPS si hay certificados
        let httpsStarted = false;
        if (fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) {
            try {
                const sslOptions = {
                    key: fs.readFileSync(SSL_KEY),
                    cert: fs.readFileSync(SSL_CERT),
                    // B-6: defensa en profundidad — rechazar versiones de TLS obsoletas (< 1.2)
                    minVersion: 'TLSv1.2'
                };
                https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
                    console.log(`🔒 HTTPS corriendo en puerto ${HTTPS_PORT}`);
                    console.log(`📊 Health check: https://localhost:${HTTPS_PORT}/health`);
                });
                httpsStarted = true;
            } catch (sslError) {
                console.warn('⚠️ Error cargando certificados SSL:', sslError.message);
                console.warn('⚠️ Continuando solo con HTTP...');
            }
        } else {
            console.warn('⚠️ Certificados SSL no encontrados en:', SSL_KEY);
            console.warn('⚠️ Para habilitar HTTPS, genera certificados o configura SSL_KEY_PATH y SSL_CERT_PATH');
        }

        // HTTP: en producción redirige a HTTPS, en desarrollo sirve normalmente
        if (httpsStarted && process.env.NODE_ENV === 'production') {
            // En producción con HTTPS activo: HTTP solo redirige
            const redirectApp = express();
            redirectApp.use((req, res) => {
                const host = req.headers.host?.split(':')[0] || 'localhost';
                res.redirect(301, `https://${host}:${HTTPS_PORT}${req.url}`);
            });
            redirectApp.listen(PORT, () => {
                console.log(`↪️  HTTP (puerto ${PORT}) redirigiendo a HTTPS (puerto ${HTTPS_PORT})`);
            });
        } else {
            // En desarrollo o si HTTPS no está disponible: HTTP normal
            app.listen(PORT, () => {
                console.log(`🚀 HTTP corriendo en puerto ${PORT}`);
                console.log(`📊 Health check: http://localhost:${PORT}/health`);
            });
        }

        console.log(`🔒 Rate limiting activado`);
    } catch (error) {
        console.error('❌ Error al iniciar servidor:', error);
        process.exit(1);
    }
}

// Inicializar sistema de firma digital RSA
const { getScriptSigner } = require('./src/security/scriptSigner');
const signer = getScriptSigner();
if (signer.isReady()) {
    console.log('🔐 Sistema de firma digital RSA-2048 activo');
} else {
    console.warn('⚠️ Firma digital NO disponible. Ejecuta: node generate-keys.js');
}

// ─── Reset mensual de uso — el día 1 de cada mes a las 00:00 (UTC-3 / hora Argentina) ───
// Cron: '0 3 1 * *' = 03:00 UTC = 00:00 ART
cron.schedule('0 3 1 * *', async () => {
    logger.info('🔄 [CRON] Iniciando reset mensual de uso...');
    try {
        // M1: el reset per-ciclo de las cuentas pagas lo hace applyRenewal en la fecha de
        // cobro real de cada usuario. Este cron mensual solo debe ser una RED DE SEGURIDAD,
        // no la vía principal. Antes reseteaba TODAS las activas el día 1, con dos efectos
        // malos: (a) un trial activado sin pago (payment_provider IS NULL) recibía 20 usos
        // nuevos cada mes → trial renovable para siempre; (b) un pago facturado (ej.) el 20
        // recibía un SEGUNDO reset el día 1 → hasta ~2× cuota por ciclo. Ahora: se excluyen
        // los trials (solo pagas) y no se re-resetea dentro del ciclo (period_start reciente).
        const result = await pool.query(`
            UPDATE subscriptions
            SET proc_usage              = 0,
                batch_usage             = 0,
                informe_usage           = 0,
                monitor_novedades_usage = 0,
                usage_count             = 0,
                period_start            = NOW(),
                updated_at              = NOW()
            WHERE status = 'active'
              AND payment_provider IS NOT NULL
              AND period_start < NOW() - INTERVAL '27 days'
            RETURNING user_id
        `);
        logger.info(`✅ [CRON] Reset mensual completado: ${result.rowCount} suscripciones reseteadas`);
    } catch (err) {
        logger.error('❌ [CRON] Error en reset mensual de uso:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// ─── CRON: Flujo de usuario v2.1 ──────────────────────────────────────────────

const mailerCron = require('./utils/mailer');

// 5a. Aviso al agotar el trial — cada hora.
// Modelo trial-hasta-pago: al agotar los 20 usos NO se rechaza la cuenta (el
// usuario puede configurar el pago para continuar). Solo se notifica UNA vez
// (guardado por el user_event 'trial_exhausted_blocked'). Los runtime gates
// (run-process / extensión) ya bloquean la ejecución mientras no haya pago.
cron.schedule('0 * * * *', async () => {
    try {
        const exhausted = await pool.query(`
            SELECT u.id, u.email, u.nombre, u.registration_status, s.usage_limit
            FROM users u
            JOIN subscriptions s ON u.id = s.user_id
            WHERE s.payment_provider IS NULL
              AND s.usage_count >= s.usage_limit
              AND u.registration_status NOT IN ('pending_email','rejected','cancelled')
              AND NOT EXISTS (
                SELECT 1 FROM user_events e
                WHERE e.user_id = u.id AND e.event_type = 'trial_exhausted_blocked'
              )
        `);
        for (const u of exhausted.rows) {
            // Dos mensajes distintos: antes de activación el usuario NO puede
            // configurar el pago (depende del admin); después de activación sí.
            const lim = u.usage_limit ?? 20;
            const notActivated = u.registration_status === 'pending_activation';
            const message = notActivated
                ? `Agotaste tus ${lim} usos de prueba. Tu cuenta está pendiente de activación por el equipo — te avisaremos por email cuando puedas continuar.`
                : `Agotaste tus ${lim} usos de prueba. Configurá tu método de pago desde el portal para acceder a los límites de tu plan y seguir usando la app y la extensión.`;
            await pool.query(`INSERT INTO user_events (user_id, event_type) VALUES ($1, 'trial_exhausted_blocked')`, [u.id]);
            await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'trial_exhausted', $2)`,
                [u.id, message]);
            mailerCron.sendTrialExhaustedEmail(u.email, u.nombre, { notActivated, usageLimit: lim }).catch(() => {});
        }
        if (exhausted.rowCount > 0) logger.info(`[CRON] trial_exhausted: ${exhausted.rowCount} usuarios notificados (sin rechazo)`);
    } catch (err) {
        logger.error('[CRON] Error en aviso de trial agotado:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// 5b. Aviso de discontinuación de plan — 7 días antes (diario 08:00 ART = 11:00 UTC)
cron.schedule('0 11 * * *', async () => {
    try {
        const expiring = await pool.query(`
            SELECT u.id, u.email, u.nombre, s.plan_expiry_date
            FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.plan_expiry_date BETWEEN NOW() AND NOW() + INTERVAL '8 days'
              AND s.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM notifications n
                WHERE n.user_id = s.user_id AND n.type = 'plan_expiry_warning'
                  AND n.created_at > NOW() - INTERVAL '6 days'
              )
        `);
        for (const u of expiring.rows) {
            await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_expiry_warning', $2)`,
                [u.id, `Tu plan se discontinúa el ${new Date(u.plan_expiry_date).toLocaleDateString('es-AR')}. Vas a tener que elegir un nuevo plan.`]);
            await pool.query(`INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_expiry_warning', $2)`,
                [u.id, JSON.stringify({ plan_expiry_date: u.plan_expiry_date })]);
            mailerCron.sendPlanExpiryWarningEmail(u.email, u.nombre, u.plan_expiry_date).catch(() => {});
        }
        if (expiring.rowCount > 0) logger.info(`[CRON] plan_expiry_warning: ${expiring.rowCount} avisos enviados`);
    } catch (err) {
        logger.error('[CRON] Error en aviso vencimiento plan:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// 5c. Retiro de plan por fecha (diario 08:05 ART)
// Cuando plan_expiry_date pasó: RESPETA el período pago en curso. Pausa el cobro en MP
// (no se cobra el próximo período del plan retirado) y programa el corte al fin del período.
// Si el período ya terminó, suspende ahora con ventana de gracia de 7 días. El paso a
// suspended_plan_expired al vencer cancel_at lo hace 5f (rama plan_expired).
cron.schedule('5 11 * * *', async () => {
    try {
        const subSvc = require('./services/subscriptionService');
        const due = await pool.query(`
            SELECT u.id, u.email, u.nombre,
                   s.external_subscription_id,
                   COALESCE(s.next_billing_date, s.expires_at) AS period_end
            FROM users u JOIN subscriptions s ON u.id = s.user_id
            WHERE u.registration_status = 'active'
              AND s.plan_expiry_date IS NOT NULL
              AND s.plan_expiry_date < NOW()
              AND s.cancel_at IS NULL
        `);
        for (const u of due.rows) {
            const periodEnd = u.period_end ? new Date(u.period_end) : null;
            // Pausar el cobro en MP cuanto antes (no cobrar el próximo período del plan retirado)
            await subSvc.pausePreapproval(u.id, u.external_subscription_id).catch(() => {});
            if (!periodEnd || periodEnd <= new Date()) {
                // Período ya terminado → suspender ahora + ventana de gracia 7 días
                await pool.query(`UPDATE users SET registration_status = 'suspended_plan_expired', updated_at = NOW() WHERE id = $1`, [u.id]);
                await pool.query(`UPDATE subscriptions SET status = 'suspended_plan_expired', suspension_cause = 'plan_expired', suspended_at = NOW(), auto_renewal = FALSE, payment_grace_ends_at = NOW() + INTERVAL '7 days', updated_at = NOW() WHERE user_id = $1`, [u.id]);
                await pool.query(`INSERT INTO user_events (user_id, event_type) VALUES ($1, 'plan_expired_suspended')`, [u.id]);
                await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_expired', $2)`,
                    [u.id, 'Tu plan se discontinuó. Elegí un nuevo plan en el portal para reactivar tu acceso.']);
                mailerCron.sendPlanExpiredSuspendedEmail(u.email, u.nombre).catch(() => {});
            } else {
                // Respetar el período pago: programar el corte al fin del período (el cobro ya
                // quedó pausado). Al vencer cancel_at, 5f lo pasa a suspended_plan_expired.
                await pool.query(`UPDATE subscriptions SET cancel_at = $2, auto_renewal = FALSE, updated_at = NOW() WHERE user_id = $1`, [u.id, periodEnd]);
                await pool.query(`INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_retirement_scheduled', $2)`,
                    [u.id, JSON.stringify({ period_end: periodEnd })]);
                await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_discontinued', $2)`,
                    [u.id, `Tu plan se discontinúa. Mantenés el acceso hasta el ${periodEnd.toLocaleDateString('es-AR')}; después vas a poder elegir un nuevo plan.`]);
            }
        }
        if (due.rowCount > 0) logger.info(`[CRON] plan_retirement: ${due.rowCount} cuentas procesadas`);
    } catch (err) {
        logger.error('[CRON] Error en retiro de plan:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// 5d. Aviso de renovación 7 días antes (diario 08:10 ART)
cron.schedule('10 11 * * *', async () => {
    try {
        const renewing = await pool.query(`
            SELECT u.id, u.email, u.nombre, s.next_billing_date
            FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.next_billing_date BETWEEN NOW() AND NOW() + INTERVAL '8 days'
              AND s.status = 'active'
              AND s.next_billing_date IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM notifications n
                WHERE n.user_id = s.user_id AND n.type = 'billing_reminder'
                  AND n.created_at > NOW() - INTERVAL '6 days'
              )
        `);
        for (const u of renewing.rows) {
            await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'billing_reminder', $2)`,
                [u.id, `Tu suscripción se renueva el ${new Date(u.next_billing_date).toLocaleDateString('es-AR')}.`]);
            mailerCron.sendBillingReminderEmail(u.email, u.nombre, u.next_billing_date).catch(() => {});
        }
    } catch (err) {
        logger.error('[CRON] Error en aviso renovación:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// 5e. Liberación de CUIT a 90 días post-cancelación (diario 08:15 ART)
cron.schedule('15 11 * * *', async () => {
    try {
        const result = await pool.query(`
            UPDATE users SET cuit = NULL, updated_at = NOW()
            WHERE registration_status = 'cancelled'
              AND updated_at < NOW() - INTERVAL '90 days'
              AND cuit IS NOT NULL
            RETURNING id
        `);
        if (result.rowCount > 0) logger.info(`[CRON] cuit_released: ${result.rowCount} CUITs liberados`);
    } catch (err) {
        logger.error('[CRON] Error liberando CUITs:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// 5f. Cancelaciones vencidas → registration_status: cancelled (diario 08:20 ART)
cron.schedule('20 11 * * *', async () => {
    try {
        const cancelled = await pool.query(`
            SELECT u.id, u.email, u.nombre, s.external_subscription_id, s.plan_expiry_date FROM users u
            JOIN subscriptions s ON u.id = s.user_id
            WHERE u.registration_status = 'active'
              AND s.cancel_at IS NOT NULL
              AND s.cancel_at < NOW() - INTERVAL '2 hours'
              AND s.auto_renewal = FALSE
              -- Verificación de seguridad: si llegó un pago aprobado después de cancel_at
              -- (MP cobró aunque el preapproval no se canceló correctamente), applyRenewal
              -- ya limpió cancel_at y restauró auto_renewal = TRUE, por lo que este registro
              -- no aparecería acá. Doble protección: no cancelar si hubo cobro reciente.
              AND NOT EXISTS (
                SELECT 1 FROM payments p
                WHERE p.user_id = u.id
                  AND p.status = 'approved'
                  AND p.created_at > s.cancel_at - INTERVAL '1 hour'
              )
        `);
        for (const u of cancelled.rows) {
            // RETIRO DE PLAN (plan_expiry_date pasado): el corte se programó por discontinuación
            // del plan, NO por baja voluntaria. El preapproval ya está pausado (no cobra). Pasa a
            // un estado RECUPERABLE (suspended_plan_expired): app bloqueada, portal abierto para
            // elegir un nuevo plan. NO se marca cancelled (que es terminal sin retorno propio).
            if (u.plan_expiry_date && new Date(u.plan_expiry_date) < new Date()) {
                await pool.query(`UPDATE users SET registration_status = 'suspended_plan_expired', updated_at = NOW() WHERE id = $1`, [u.id]);
                await pool.query(`UPDATE subscriptions SET status = 'suspended_plan_expired', suspension_cause = 'plan_expired', suspended_at = NOW(), payment_grace_ends_at = NOW() + INTERVAL '7 days', updated_at = NOW() WHERE user_id = $1`, [u.id]);
                await pool.query(`INSERT INTO user_events (user_id, event_type) VALUES ($1, 'plan_expired_suspended')`, [u.id]);
                await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_expired', $2)`,
                    [u.id, 'Tu plan se discontinuó. Elegí un nuevo plan en el portal para reactivar tu acceso.']);
                mailerCron.sendPlanExpiredSuspendedEmail(u.email, u.nombre).catch(() => {});
                continue;
            }
            // CANCELACIÓN VOLUNTARIA: el preapproval quedó PAUSADO al cancelar (reversible). Como
            // el usuario no reactivó y venció el período, ahora se cancela DEFINITIVAMENTE en MP.
            const extId = u.external_subscription_id;
            if (extId && !extId.startsWith('pay-') && process.env.MP_ACCESS_TOKEN) {
                try {
                    await fetch(`https://api.mercadopago.com/preapproval/${extId}`, {
                        method: 'PUT',
                        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'cancelled' })
                    });
                } catch (e) {
                    logger.warn(`[CRON] No se pudo cancelar preapproval ${extId} en MP: ${e.message}`);
                }
            }
            await pool.query(`UPDATE users SET registration_status = 'cancelled', updated_at = NOW() WHERE id = $1`, [u.id]);
            await pool.query(`UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1`, [u.id]);
            await pool.query(`INSERT INTO user_events (user_id, event_type) VALUES ($1, 'subscription_cancelled_expired')`, [u.id]);
        }
        if (cancelled.rowCount > 0) logger.info(`[CRON] subscriptions_cancelled: ${cancelled.rowCount} cuentas canceladas`);
    } catch (err) {
        logger.error('[CRON] Error en cancelaciones vencidas:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// 5g. Aplicar downgrade programado al vencer ciclo (diario 08:25 ART)
cron.schedule('25 11 * * *', async () => {
    try {
        const downgrades = await pool.query(`
            SELECT u.id, u.email, u.nombre, s.scheduled_plan, s.id AS sub_id, s.payment_provider
            FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.scheduled_plan IS NOT NULL
              AND (s.scheduled_plan->>'apply_at')::timestamp < NOW()
              AND s.status = 'active'
        `);
        const subSvc = require('./services/subscriptionService');
        for (const u of downgrades.rows) {
            const sp = u.scheduled_plan;
            const newPlanResult = await pool.query(`SELECT * FROM plans WHERE id = $1`, [sp.plan_id]);
            if (newPlanResult.rows.length === 0) continue;
            const np = newPlanResult.rows[0];
            // Pago → enforcement por submódulo (usage_limit=999999). SIN pago (trial/activado
            // sin método) → conservar el cupo actual (mismo criterio que el cambio de plan del
            // admin): recalcularlo del plan podía dar 0 (ej. EXTENSION_PROMO, proc=0) y violar
            // check_usage_limit_positive → el UPDATE fallaba y el scheduled_plan quedaba
            // reintentando a diario sin aplicarse.
            const newUsageLimit = (u.payment_provider || np.proc_executions_limit === -1) ? 999999 : null;
            const newExpiry = new Date();
            newExpiry.setDate(newExpiry.getDate() + (np.period_days || 30));

            await pool.query(`
                UPDATE subscriptions SET
                    plan = $1, plan_id = $2, usage_limit = COALESCE($3, usage_limit),
                    expires_at = $4, next_billing_date = $4,
                    period_start = NOW(),
                    plan_changes_this_cycle = 0,
                    scheduled_plan = NULL,
                    updated_at = NOW()
                WHERE user_id = $5
            `, [np.name, np.id, newUsageLimit, newExpiry, u.id]);

            // Ajustar el monto que cobra MercadoPago al plan ya rebajado (best-effort)
            if (u.payment_provider) {
                subSvc.updatePreapprovalAmount(u.id, np.name).catch(() => {});
            }

            await pool.query(`INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_downgrade_applied', $2)`,
                [u.id, JSON.stringify({ to: np.name })]);
            await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_downgrade_applied', $2)`,
                [u.id, `Tu plan fue actualizado a ${np.display_name}.`]);
        }
        if (downgrades.rowCount > 0) logger.info(`[CRON] downgrades_applied: ${downgrades.rowCount}`);
    } catch (err) {
        logger.error('[CRON] Error aplicando downgrades:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// 5h. Suspensión por gracia de pago vencida — stub (diario 08:30 ART)
cron.schedule('30 11 * * *', async () => {
    try {
        const grace = await pool.query(`
            SELECT u.id, u.email, u.nombre
            FROM users u JOIN subscriptions s ON u.id = s.user_id
            WHERE u.registration_status = 'active'
              AND s.payment_grace_ends_at IS NOT NULL
              AND s.payment_grace_ends_at < NOW()
        `);
        for (const u of grace.rows) {
            await pool.query(`UPDATE users SET registration_status = 'suspended', updated_at = NOW() WHERE id = $1`, [u.id]);
            await pool.query(`UPDATE subscriptions SET status = 'suspended', suspension_cause = 'payment', suspended_at = NOW(), payment_grace_ends_at = NULL, updated_at = NOW() WHERE user_id = $1`, [u.id]);
            await pool.query(`INSERT INTO user_events (user_id, event_type) VALUES ($1, 'payment_failed_suspended')`, [u.id]);
            await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, 'payment_suspended', $2)`,
                [u.id, 'Pago fallido. Actualizá tu método de pago en el portal para reactivar.']);
        }
        if (grace.rowCount > 0) logger.info(`[CRON] payment_failed_suspended: ${grace.rowCount} usuarios suspendidos`);
    } catch (err) {
        logger.error('[CRON] Error en suspensión por pago:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// ─── Crons de Fase 5 — solo si PAYMENT_MODULE_ENABLED=true ──────────────────
if (process.env.PAYMENT_MODULE_ENABLED === 'true') {

    // Cobranza retry — cada 6 horas: reintenta suscripciones MP con pago fallido
    cron.schedule('0 */6 * * *', async () => {
        logger.info('[CRON] cobranza-retry: buscando suscripciones con pago fallido...');
        try {
            // Suscripciones con gracia activa (el preapproval MP reintenta automáticamente,
            // aquí solo logueamos para tener visibilidad)
            const { rows } = await pool.query(`
                SELECT u.id, u.email, s.plan, s.payment_grace_ends_at
                FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE s.payment_grace_ends_at > NOW()
                  AND s.suspension_cause = 'payment'
            `);
            if (rows.length > 0) {
                logger.warn(`[CRON] cobranza-retry: ${rows.length} suscripciones con pago pendiente`, {
                    users: rows.map(r => r.email)
                });
            } else {
                logger.info('[CRON] cobranza-retry: sin suscripciones pendientes');
            }
        } catch (err) {
            logger.error('[CRON] cobranza-retry error:', err.message);
        }
    }, { timezone: 'America/Argentina/Buenos_Aires' });

    // Invoice retry via Facturante — DESACTIVADO hasta contratar Facturante
    // Para reactivar: descomentar cuando FACTURANTE_WSDL_URL esté configurado
    // const { retryPendingInvoices } = require('./services/invoiceService');
    // cron.schedule('0 * * * *', async () => {
    //     if (!process.env.FACTURANTE_WSDL_URL) return; // no-op si no está configurado
    //     logger.info('[CRON] invoice-retry: procesando facturas pendientes...');
    //     try { await retryPendingInvoices(); }
    //     catch (err) { logger.error('[CRON] invoice-retry error:', err.message); }
    // }, { timezone: 'America/Argentina/Buenos_Aires' });

    logger.info('💳 Módulo de pagos ACTIVO — cron de cobranza habilitado (Facturante: manual)');
} else {
    logger.info('💳 Módulo de pagos DESHABILITADO (PAYMENT_MODULE_ENABLED=false)');
}

// Manejo de shutdown graceful
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servidor...');
    clearCache();
    try { const { getSignatureCache } = require('./src/security/signatureCache'); getSignatureCache().destroy(); } catch (e) { }
});

init();