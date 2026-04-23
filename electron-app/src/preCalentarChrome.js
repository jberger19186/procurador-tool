/**
 * preCalentarChrome.js
 * Script de pre-calentamiento de Chrome.
 * Se ejecuta como proceso hijo (fork con IPC) inmediatamente después del login.
 * Lanza Chrome off-screen y envía el wsEndpoint al padre cuando está listo.
 * Al recibir 'handoff': desconecta sin cerrar Chrome (Chrome sigue vivo).
 * Al recibir 'shutdown': cierra Chrome completamente.
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

function detectarChrome() {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const r of rutas) {
        if (fs.existsSync(r)) return r;
    }
    throw new Error('Chrome no encontrado');
}

async function main() {
    try {
        const chromePath = detectarChrome();
        const profilePath = process.env.APPDATA;

        const browser = await puppeteer.launch({
            headless: false,
            executablePath: chromePath,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                `--user-data-dir=${profilePath}`,
                '--window-position=-32000,-32000', // off-screen — invisible al usuario
                '--window-size=1,1',               // ventana mínima
                '--no-sandbox',
                '--ignore-certificate-errors',
                '--no-first-run',                  // evita diálogos de bienvenida
                '--no-default-browser-check',      // evita diálogo "hacer Chrome predeterminado"
                '--disable-default-apps',          // evita instalación de apps por defecto
                '--disable-session-crashed-bubble',// evita diálogo de restaurar sesión
                '--disable-blink-features=AutomationControlled',
            ],
            defaultViewport: null,
            timeout: 60000,                        // 60s en lugar de 30s por las dudas
        });

        // Forzar ventana off-screen via CDP (el flag solo no es confiable con perfil vacío)
        try {
            const pages = await browser.pages();
            const p = pages[0] || await browser.newPage();
            const session = await p.target().createCDPSession();
            const { windowId } = await session.send('Browser.getWindowForTarget');
            await session.send('Browser.setWindowBounds', { windowId, bounds: { left: -32000, top: -32000, width: 1, height: 1 } });
            await session.detach();
        } catch (_) {}

        process.send({ type: 'prewarm_ready', wsEndpoint: browser.wsEndpoint() });

        process.on('message', async (msg) => {
            if (msg.type === 'handoff') {
                browser.disconnect();   // desconecta sin cerrar Chrome
                process.exit(0);
            }
            if (msg.type === 'shutdown') {
                await browser.close();  // cierra Chrome completamente
                process.exit(0);
            }
        });

    } catch (err) {
        process.send({ type: 'prewarm_error', error: err.message });
        process.exit(1);
    }
}

main();
