const fs = require('fs');
const path = require('path');

function setupMonitoring(page, options = {}) {
    const logFilePath = path.join(__dirname, 'monitoring.log');
    const errorSummary = { networkErrors: {}, responseErrors: {}, redirections: 0 };

    function log(message) {
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
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
