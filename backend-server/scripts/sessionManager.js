const testM1 = require('./testM1');
const delay = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Inicia una nueva sesión "limpia" creando un navegador y una página,
 * e inicia sesión en la aplicación usando las configuraciones definidas en testM1.
 *
 * @param {string} profilePath - Ruta del perfil del navegador.
 * @param {string} identificador - Identificador usado para la validación de sesión.
 * @returns {Promise<{browser: Object, page: Object}>} Objeto con el navegador y la página.
 */
async function iniciarNuevaSesion(profilePath, identificador) {
    const { browser, page } = await testM1.configuracionesGenerales(profilePath);
    await testM1.iniciarSesion(page, testM1.URL, identificador, browser);

    // 🔒 Validación extra por si la sesión quedó en about:blank
    if (page.url() === 'about:blank') {
        console.warn("⚠️ sessionManager: Detectado 'about:blank'. Esperando hasta 5 segundos...");
        const inicio = Date.now();
        while (page.url() === 'about:blank' && Date.now() - inicio < 5000) {
            await delay(500);
        }

        if (page.url() === 'about:blank') {
            console.error("❌ sessionManager: Página sigue en 'about:blank'. Cerrando navegador...");
            await browser.close();
            throw new Error("Navegador quedó en 'about:blank' tras iniciar sesión");
        } else {
            console.log("✅ sessionManager: La página cargó correctamente tras la espera.");
        }
    }

    return { browser, page };
}

module.exports = {
    iniciarNuevaSesion
};
