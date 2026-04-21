// cerrarNavegador.js
async function cerrarNavegador(browser) {
    try {
        if (!browser) {
            console.log("ℹ️ No se proporcionó ninguna instancia de navegador.");
            return;
        }

        // Intenta cerrar normalmente. browser.close() funciona aunque isConnected() sea false
        // porque termina el proceso subyacente de Chrome directamente.
        try {
            await browser.close();
            console.log("✅ Navegador cerrado correctamente.");
            return;
        } catch (closeError) {
            if (closeError.message && closeError.message.includes("Target closed")) {
                console.log("ℹ️ Navegador ya estaba cerrado (Target closed).");
                return;
            }
            // browser.close() falló por otra razón — intentar matar el proceso directamente
            console.warn("⚠️ browser.close() falló, intentando matar el proceso:", closeError.message);
        }

        // Fallback: matar el proceso de Chrome directamente
        const proc = typeof browser.process === 'function' ? browser.process() : null;
        if (proc && !proc.killed) {
            proc.kill('SIGKILL');
            console.log("🛑 Proceso del navegador terminado forzosamente.");
        } else {
            console.log("ℹ️ No se pudo obtener el proceso del navegador para terminar.");
        }
    } catch (error) {
        console.error("❌ Error al cerrar el navegador:", error.message);
    }
}

module.exports = cerrarNavegador;
