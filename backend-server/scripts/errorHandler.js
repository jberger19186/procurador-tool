// errorHandler.js

module.exports = function setupErrorHandlers(page, config = {}) {
    // Configuración: habilitar o deshabilitar errores específicos
    const {
        check404 = true,
        checkConnectionRefused = true,
        checkTimeout = true,
        checkElementNotFound = true,
        checkNetworkError = true,
        checkInvalidCert = true
    } = config;

    // Manejador de errores genéricos en el navegador
    page.on('error', (err) => {
        console.error('❌ Error en el navegador:', err.message);
    });

    // Manejador de errores en la página
    page.on('pageerror', (pageErr) => {
        console.error('❌ Error en la página:', pageErr.message);
    });

    // Manejar solicitudes fallidas
    page.on('requestfailed', (request) => {
        const failure = request.failure();
        const errorText = failure?.errorText || 'Error desconocido';

        if (checkConnectionRefused && errorText.includes('ERR_CONNECTION_REFUSED')) {
            console.error('❌ Error: El servidor rechazó la conexión.');
            throw new Error('ERR_CONNECTION_REFUSED');
        }

        if (
            checkInvalidCert &&
            (
                errorText.includes('ERR_CERT_AUTHORITY_INVALID') ||
                errorText.includes('ERR_SSL_PROTOCOL_ERROR') ||
                errorText.includes('ERR_CERT_DATE_INVALID') ||
                errorText.includes('ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN')
            )
        ) {
            console.error('❌ Error SSL: Certificado inválido o protocolo inseguro.');
            throw new Error('SSL_ERROR');
        }

        if (checkNetworkError && errorText.includes('ERR_NETWORK_CHANGED')) {
            console.error('❌ Error: La red cambió o se interrumpió.');
            throw new Error('ERR_NETWORK_CHANGED');
        }
    });

    // Manejar respuestas HTTP
    page.on('response', (response) => {
        if (check404 && response.status() === 404) {
            console.error('❌ Error 404: Página no encontrada.');
            throw new Error('HTTP_404');
        }
    });

    // Función que verifica si en el contenido HTML se detecta una advertencia SSL
    async function verificarAdvertenciaSSL(page) {
        const content = await page.content();
        return (
            content.includes("no admite una conexión segura") ||
            content.includes("chrome-error://chromewebdata") ||
            content.includes("ERR_CERT") ||
            content.includes("protocolo inseguro") ||
            content.includes("No se puede acceder a este sitio") ||
            content.includes("Continuar al sitio")
        );
    }

    // Verificar visualmente si estamos ante una pantalla de error SSL (incluyendo "Continuar al sitio")
    page.on('load', async () => {
        if (checkInvalidCert) {
            try {
                if (await verificarAdvertenciaSSL(page)) {
                    console.error('❌ Pantalla de error SSL detectada en el contenido HTML.');
                    throw new Error('SSL_BLOCK_SCREEN_DETECTED');
                }
            } catch (e) {
                console.warn("⚠️ No se pudo analizar el contenido de la página:", e.message);
            }
        }
    });

    // (opcional) verificación del body si querés mantenerla
    //if (checkElementNotFound) {
    //    page.on('load', async () => {
    //        try {
    //            await page.waitForSelector('body', { timeout: 10000 });
    //        } catch {
    //            console.error('❌ Error: No se pudo encontrar el selector "body".');
    //            throw new Error('BODY_NOT_FOUND');
    //        }
    //    });
    //}
};
