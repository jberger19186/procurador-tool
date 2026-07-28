const fs = require('fs');
const path = require('path');

// E1-5 (revisión E1, Bloque C.2): antes vivía en __dirname (compartido entre TODAS las
// cuentas/CUIT de la misma PC, violando el aislamiento que D6 estableció para las
// descargas), sin rotación (crecía indefinidamente con ejecuciones repetidas) y sin
// protección: fs.appendFileSync corría dentro de listeners de eventos de Puppeteer sin
// try/catch, con el mismo riesgo de crash no capturado que E1-1 corrige en otros scripts.
const DATA_DIR = process.env.PROCURADOR_DATA_DIR || __dirname;
const LOG_DIR = path.join(DATA_DIR, 'logs');
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function ensureLogDir() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (_) { /* si no se puede crear, log() más abajo falla en silencio igual */ }
}

// Rotación simple por tamaño: al iniciar una sesión de monitoreo, si el log previo ya
// pasó el umbral, se renombra a .old (pisando la rotación anterior) en vez de crecer
// indefinidamente. No se chequea en cada log() individual (correría en cada respuesta
// HTTP de la sesión) — alcanza con revisarlo una vez por sesión de monitoreo.
function rotateIfNeeded(logFilePath) {
    try {
        if (!fs.existsSync(logFilePath)) return;
        const { size } = fs.statSync(logFilePath);
        if (size > MAX_LOG_SIZE_BYTES) {
            fs.renameSync(logFilePath, `${logFilePath}.old`);
        }
    } catch (_) { /* no bloquear el monitoreo por un problema de rotación */ }
}

function setupMonitoring(page, options = {}) {
    ensureLogDir();
    const logFilePath = path.join(LOG_DIR, 'monitoring.log');
    rotateIfNeeded(logFilePath);
    const errorSummary = { networkErrors: {}, responseErrors: {}, redirections: 0 };

    function log(message) {
        const timestamp = new Date().toISOString();
        try {
            fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
        } catch (_) {
            // Silencioso a propósito: este log es de diagnóstico interno, no debe
            // interrumpir ni el monitoreo ni el proceso que lo invoca.
        }
    }

    function incrementErrorCount(url, errorType) {
        if (!errorSummary[errorType][url]) {
            errorSummary[errorType][url] = 1;
        } else {
            errorSummary[errorType][url]++;
        }
    }

    log('Monitoring started.');

    // Monitorear errores en la consola del navegador
    page.on('console', (msg) => {
        const type = msg.type().toUpperCase();
        log(`[BROWSER ${type}] ${msg.text()}`);
    });

    // Monitorear errores de página
    page.on('pageerror', (error) => {
        log(`[PAGE ERROR] ${error.message}`);
    });

    // Monitorear errores de red
    page.on('requestfailed', (request) => {
        const url = request.url();
        const errorText = request.failure()?.errorText || 'Unknown Error';
        log(`[NETWORK ERROR] ${url}: ${errorText}`);
        incrementErrorCount(url, 'networkErrors');
    });

    // Monitorear tiempos de respuesta de solicitudes y redirecciones
    page.on('response', (response) => {
        const url = response.url();
        const status = response.status();

        if (status >= 300 && status < 400) {
            log(`[REDIRECTION] ${url} - Status: ${status}`);
            errorSummary.redirections++;
        } else if (status >= 400) {
            log(`[RESPONSE ERROR] ${url} - Status: ${status}`);
            incrementErrorCount(url, 'responseErrors');
        } else {
            log(`[RESPONSE] ${url} - Status: ${status}`);
        }
    });

    // Detectar cambios en el DOM
    if (options.monitorDOM) {
        page.evaluate(() => {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    console.log(`[DOM CHANGE] ${mutation.type} on ${mutation.target.nodeName}`);
                });
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
            });
        });
        log('DOM monitoring initialized.');
    }

    // Capturar métricas de rendimiento
    if (options.performanceMetrics) {
        page.on('load', async () => {
            const metrics = await page.metrics();
            log(`[PERFORMANCE] DOM Nodes: ${metrics.Nodes}, JS Heap Size: ${metrics.JSHeapUsedSize}`);
        });
    }

    // Monitorear tiempos de carga
    page.on('load', async () => {
        const timing = await page.evaluate(() => performance.timing);
        const loadTime = timing.loadEventEnd - timing.navigationStart;
        log(`[LOAD TIME] ${loadTime} ms`);
    });

    // Generar un reporte consolidado al finalizar
    page.on('close', () => {
        log('--- Summary Report ---');
        log(`Total Redirections: ${errorSummary.redirections}`);
        log(`Network Errors: ${Object.keys(errorSummary.networkErrors).length}`);
        log(`Response Errors: ${Object.keys(errorSummary.responseErrors).length}`);

        if (Object.keys(errorSummary.networkErrors).length > 0) {
            log('Network Errors Breakdown:');
            for (const [url, count] of Object.entries(errorSummary.networkErrors)) {
                log(`  ${url}: ${count} times`);
            }
        }

        if (Object.keys(errorSummary.responseErrors).length > 0) {
            log('Response Errors Breakdown:');
            for (const [url, count] of Object.entries(errorSummary.responseErrors)) {
                log(`  ${url}: ${count} times`);
            }
        }
        log('Monitoring finished.');
    });

    log('Monitoring setup completed.');
}

module.exports = setupMonitoring;
