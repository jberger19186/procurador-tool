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
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const SSL_KEY = process.env.SSL_KEY_PATH || path.join(__dirname, 'certs', 'key.pem');
const SSL_CERT = process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'cert.pem');

// Seguridad HTTP headers
app.use(helmet({ contentSecurityPolicy: false }));

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
            return callback(new Error('Origen no permitido por CORS'));
        },
        credentials: true
    })(req, res, next);
});

app.use(express.json());
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

// Servir dashboard web admin como archivos estáticos
app.use('/dashboard', express.static(path.join(__dirname, 'public', 'dashboard')));

// Servir página de registro público
app.use('/register', express.static(path.join(__dirname, 'public', 'register')));

// ── Distribución de la extensión de Chrome ──────────────────────────────────
// Chrome consulta /extension/updates.xml para instalar y actualizar la extensión.
// El CRX se sirve desde /extension/latest.crx (archivo en public/extension/).
// Ver docs/extension-distribution.md para instrucciones de empaquetado.
const EXTENSION_DIR  = path.join(__dirname, 'public', 'extension');
const EXTENSION_META = path.join(EXTENSION_DIR, 'meta.json'); // { id, version, crxFile }

app.get('/extension/updates.xml', (req, res) => {
    try {
        if (!fs.existsSync(EXTENSION_META)) {
            return res.status(503).send('<!-- Extension not yet published -->');
        }
        const meta = JSON.parse(fs.readFileSync(EXTENSION_META, 'utf8'));
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const crxUrl  = `${baseUrl}/extension/latest.crx`;

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.send(`<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${meta.id}'>
    <updatecheck codebase='${crxUrl}' version='${meta.version}' />
  </app>
</gupdate>`);
    } catch (e) {
        console.error('Error sirviendo updates.xml:', e.message);
        res.status(500).send('');
    }
});

app.get('/extension/latest.crx', (req, res) => {
    try {
        if (!fs.existsSync(EXTENSION_META)) {
            return res.status(404).json({ error: 'CRX no disponible' });
        }
        const meta    = JSON.parse(fs.readFileSync(EXTENSION_META, 'utf8'));
        const crxPath = path.join(EXTENSION_DIR, meta.crxFile);
        if (!fs.existsSync(crxPath)) {
            return res.status(404).json({ error: 'Archivo CRX no encontrado' });
        }
        res.setHeader('Content-Type', 'application/x-chrome-extension');
        res.setHeader('Content-Disposition', `attachment; filename="extension-${meta.version}.crx"`);
        res.sendFile(crxPath);
    } catch (e) {
        console.error('Error sirviendo CRX:', e.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Rutas
app.use('/auth', require('./routes/auth'));
app.use('/api/extension', require('./routes/extension'));
app.use('/scripts', require('./routes/scripts'));
app.use('/admin', require('./routes/admin'));
app.use('/client', require('./routes/client'));
app.use('/tickets', require('./routes/tickets'));
app.use('/monitor', require('./routes/monitor'));
app.use('/license', require('./routes/license'));

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
                    cert: fs.readFileSync(SSL_CERT)
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
            RETURNING user_id
        `);
        logger.info(`✅ [CRON] Reset mensual completado: ${result.rowCount} suscripciones reseteadas`);
    } catch (err) {
        logger.error('❌ [CRON] Error en reset mensual de uso:', err.message);
    }
}, { timezone: 'America/Argentina/Buenos_Aires' });

// Manejo de shutdown graceful
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servidor...');
    clearCache();
    try { const { getSignatureCache } = require('./src/security/signatureCache'); getSignatureCache().destroy(); } catch (e) { }
});

init();