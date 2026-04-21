'use strict';

/**
 * windowManager.js
 *
 * Gestión de visibilidad del navegador Chrome sin usar --headless.
 * Mueve la ventana fuera del área de pantalla (off-screen) para "ocultarla"
 * y la restaura a su posición original para "mostrarla".
 *
 * Usa el protocolo CDP: Browser.setWindowBounds / Browser.getWindowForTarget.
 *
 * Uso en scripts de automatización:
 *
 *   const { hideBrowser, showBrowser } = require('./windowManager');
 *   const HEADLESS_MODE = process.env.HEADLESS_MODE === 'true';
 *
 *   const browser = await puppeteer.launch({ headless: false, ... });
 *   const page = (await browser.pages())[0];
 *
 *   if (HEADLESS_MODE) await hideBrowser(page);
 *
 *   try {
 *       // ...automatización...
 *
 *       // Si se necesita login manual:
 *       if (HEADLESS_MODE) await showBrowser(page);
 *       process.send({ type: 'LOGIN_MANUAL_REQUIRED', ... });
 *       await esperarLogin(page, { timeout: 5 * 60 * 1000 });
 *       if (HEADLESS_MODE) await hideBrowser(page);
 *
 *   } catch (err) {
 *       if (HEADLESS_MODE) await showBrowser(page);
 *       await new Promise(r => setTimeout(r, 3000)); // dar tiempo a ver el error
 *       throw err;
 *   } finally {
 *       await browser.close();
 *   }
 */

let _savedBounds = null;
let _windowId    = null;
let _cdpSession  = null;

/**
 * Obtiene (o reutiliza) una sesión CDP para la página dada.
 * @param {import('puppeteer').Page} page
 */
async function _getSession(page) {
    // Si la sesión ya existe y no está cerrada, la reutilizamos
    if (_cdpSession) return _cdpSession;
    _cdpSession = await page.target().createCDPSession();
    return _cdpSession;
}

/**
 * Mueve la ventana de Chrome fuera del área visible de la pantalla.
 * Guarda las coordenadas actuales para poder restaurarlas con showBrowser().
 *
 * @param {import('puppeteer').Page} page
 */
async function hideBrowser(page) {
    try {
        const session = await _getSession(page);
        const { windowId, bounds } = await session.send('Browser.getWindowForTarget');

        _windowId    = windowId;
        _savedBounds = { ...bounds };   // guardar para restaurar exactamente

        await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { left: -32000, top: -32000, windowState: 'normal' }
        });

        console.log('🙈 Navegador movido fuera de pantalla (headless simulado)');
    } catch (err) {
        // No lanzar — si falla simplemente el navegador queda visible, sin impacto funcional
        console.warn('⚠️ windowManager.hideBrowser:', err.message);
    }
}

/**
 * Restaura la ventana de Chrome a la posición guardada antes del ocultamiento.
 * Si no hay posición guardada, centra la ventana con tamaño razonable.
 *
 * @param {import('puppeteer').Page} page
 */
async function showBrowser(page) {
    try {
        const session = await _getSession(page);

        if (!_windowId) {
            const result = await session.send('Browser.getWindowForTarget');
            _windowId = result.windowId;
        }

        const bounds = _savedBounds
            ? { ..._savedBounds, windowState: 'normal' }
            : { left: 100, top: 100, width: 1280, height: 800, windowState: 'normal' };

        await session.send('Browser.setWindowBounds', { windowId: _windowId, bounds });

        console.log('👁️  Navegador restaurado a posición visible');
    } catch (err) {
        console.warn('⚠️ windowManager.showBrowser:', err.message);
    }
}

/**
 * Libera la sesión CDP (llamar al cerrar el browser si se reutiliza el módulo).
 */
function resetSession() {
    _cdpSession  = null;
    _windowId    = null;
    _savedBounds = null;
}

module.exports = { hideBrowser, showBrowser, resetSession };
