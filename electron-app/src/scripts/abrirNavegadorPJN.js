/**
 * abrirNavegadorPJN.js
 * Abre Chrome con el perfil de automatizaciones y navega a portalpjn.pjn.gov.ar.
 * Si detecta el formulario de login (SSO Keycloak):
 *   - Muestra un overlay con mensaje mientras trabaja (evita interferencia del usuario).
 *   - Verifica que el campo usuario tenga el CUIT correcto; si no, lo fuerza.
 *   - Intenta disparar el autofill de Chrome para la contraseña (Tab + ArrowDown).
 *   - Retira el overlay cuando terminó; si falta la contraseña deja al usuario libre.
 * Si ya hay sesión activa, abre el navegador sin overlay.
 *
 * Uso: node abrirNavegadorPJN.js <cuit>
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PORTAL_URL = 'https://portalpjn.pjn.gov.ar';

function detectarChrome() {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const r of rutas) {
        if (fs.existsSync(r)) return r;
    }
    throw new Error('Chrome no encontrado en rutas estándar');
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Overlay visual ──────────────────────────────────────────────────────────

async function mostrarOverlay(page, mensaje) {
    await page.evaluate((msg) => {
        if (document.getElementById('__psc_overlay')) return;

        // Animación de spinner
        const style = document.createElement('style');
        style.id = '__psc_overlay_style';
        style.textContent = `
            @keyframes __psc_spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = '__psc_overlay';
        overlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0',
            'width:100%', 'height:100%',
            'z-index:2147483647',
            'background:rgba(0,0,0,0.50)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'cursor:not-allowed'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'background:#ffffff',
            'border-radius:14px',
            'padding:28px 36px',
            'text-align:center',
            'box-shadow:0 8px 32px rgba(0,0,0,0.28)',
            'max-width:380px',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'
        ].join(';');

        const spinner = document.createElement('div');
        spinner.style.cssText = [
            'width:36px', 'height:36px',
            'border:3px solid #e0e0e0',
            'border-top-color:#1a73e8',
            'border-radius:50%',
            'animation:__psc_spin 0.75s linear infinite',
            'margin:0 auto 18px'
        ].join(';');

        const title = document.createElement('p');
        title.style.cssText = 'margin:0 0 6px; font-size:15px; font-weight:600; color:#1a1a1a;';
        title.textContent = 'Procurador SCW';

        const text = document.createElement('p');
        text.id = '__psc_overlay_msg';
        text.style.cssText = 'margin:0; font-size:13px; color:#555;';
        text.textContent = msg;

        card.appendChild(spinner);
        card.appendChild(title);
        card.appendChild(text);
        overlay.appendChild(card);

        // Bloquear toda interacción con el contenido mientras el overlay está activo
        ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'touchstart'].forEach(ev => {
            overlay.addEventListener(ev, e => { e.stopPropagation(); e.preventDefault(); }, true);
        });

        document.body.appendChild(overlay);
    }, mensaje);
}

async function actualizarOverlay(page, mensaje) {
    await page.evaluate((msg) => {
        const el = document.getElementById('__psc_overlay_msg');
        if (el) el.textContent = msg;
    }, mensaje);
}

async function ocultarOverlay(page) {
    await page.evaluate(() => {
        const overlay = document.getElementById('__psc_overlay');
        if (overlay) overlay.remove();
        const style = document.getElementById('__psc_overlay_style');
        if (style) style.remove();
    });
}

async function mostrarBannerCierre(page, mensaje) {
    await page.evaluate((msg) => {
        if (document.getElementById('__psc_banner')) return;
        const banner = document.createElement('div');
        banner.id = '__psc_banner';
        banner.style.cssText = [
            'position:fixed', 'bottom:0', 'left:0', 'right:0',
            'z-index:2147483647',
            'background:#1a73e8',
            'color:#fff',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
            'font-size:13px',
            'display:flex', 'align-items:center', 'justify-content:center', 'gap:10px',
            'padding:10px 16px',
            'box-shadow:0 -2px 12px rgba(0,0,0,0.25)',
        ].join(';');

        const icon = document.createElement('span');
        icon.textContent = '✓';
        icon.style.cssText = 'font-size:16px;font-weight:700;flex-shrink:0;';

        const text = document.createElement('span');
        text.textContent = msg;
        text.style.cssText = 'flex:1;text-align:center;';

        const close = document.createElement('button');
        close.textContent = '✕';
        close.title = 'Cerrar aviso';
        close.style.cssText = [
            'background:rgba(255,255,255,0.2)', 'border:none', 'color:#fff',
            'border-radius:4px', 'padding:2px 8px', 'cursor:pointer',
            'font-size:13px', 'flex-shrink:0'
        ].join(';');
        close.addEventListener('click', () => banner.remove());

        banner.appendChild(icon);
        banner.appendChild(text);
        banner.appendChild(close);
        document.body.appendChild(banner);
    }, mensaje);
}

// ── Centrar ventana con CDP ─────────────────────────────────────────────────

async function centrarVentana(page) {
    const sw = parseInt(process.env.SCREEN_WIDTH)  || 1920;
    const sh = parseInt(process.env.SCREEN_HEIGHT) || 1080;
    const w  = Math.min(1280, sw - 80);
    const h  = Math.min(900,  sh - 80);
    try {
        const session = await page.target().createCDPSession();
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { left: Math.floor((sw - w) / 2), top: Math.floor((sh - h) / 2), width: w, height: h }
        });
        await session.detach();
    } catch (_) {}
}

// ── Lógica principal ────────────────────────────────────────────────────────

async function main() {
    const cuit = process.argv[2] || '';

    const chromePath = detectarChrome();
    const profilePath = path.join(process.env.LOCALAPPDATA, 'ProcuradorSCW', 'ChromeProfile');

    console.log('🚀 Iniciando Chrome con perfil de automatizaciones...');

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            `--user-data-dir=${profilePath}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-default-apps',
            '--disable-session-crashed-bubble',
            PORTAL_URL,  // abrir directamente al portal — evita flash de about:blank
        ],
        defaultViewport: null,
        timeout: 60000,
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    await centrarVentana(page);

    // Navegar al portal (page.goto maneja correctamente la cadena completa de redirects SSO).
    // El flag PORTAL_URL en args ya inició la carga → evita flash de about:blank,
    // pero igual llamamos goto() para esperar el networkidle2 final (incluye redirect a sso).
    console.log(`🌐 Navegando a ${PORTAL_URL}...`);
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Detectar estado: formulario de login o sesión activa
    const tieneLogin = await Promise.race([
        page.waitForSelector('#username', { timeout: 15000 }).then(() => true),
        page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 }).then(() => false),
    ]).catch(() => null);

    const MSG_CIERRE = 'Verificación lista — cuando termines, cerrá esta ventana para continuar en Procurador SCW';

    if (tieneLogin === null) {
        console.log('ℹ️ No se detectó formulario de login ni sesión activa. Navegador listo.');
        await mostrarBannerCierre(page, MSG_CIERRE);
        browser.disconnect();
        return;
    }

    if (tieneLogin === false) {
        const cuitSesion = await page.$eval(
            'a.dropdown-toggle.menu-btn-border-right',
            el => el.textContent.trim().replace(/\s+/g, '')
        ).catch(() => '');
        console.log(`✅ Sesión activa detectada. Usuario en sesión: "${cuitSesion}"`);
        await mostrarBannerCierre(page, MSG_CIERRE);
        browser.disconnect();
        return;
    }

    // ── Formulario de login ─────────────────────────────────────────────────

    if (!cuit) {
        console.log('ℹ️ No se recibió CUIT. Navegador listo para login manual.');
        await mostrarBannerCierre(page, MSG_CIERRE);
        browser.disconnect();
        return;
    }

    // Mostrar overlay: el usuario no debe tocar nada mientras la app verifica
    await mostrarOverlay(page, 'Verificando credenciales guardadas...');

    // Dar tiempo al autofill de Chrome
    await sleep(900);

    const usernameActual = await page.$eval('#username', el => el.value.trim()).catch(() => '');
    console.log(`👤 Campo usuario detectado: "${usernameActual}"`);

    if (usernameActual !== cuit) {
        console.log(`⚠️ No coincide con CUIT esperado "${cuit}". Forzando campo...`);
        await actualizarOverlay(page, `Configurando usuario ${cuit}...`);

        await page.focus('#username');
        await page.evaluate(() => {
            const el = document.getElementById('username');
            if (el) {
                el.removeAttribute('readonly');
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await page.type('#username', cuit, { delay: 40 });

        // Limpiar contraseña del CUIT anterior
        await page.evaluate(() => {
            const el = document.getElementById('password');
            if (el) {
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        await actualizarOverlay(page, 'Buscando contraseña guardada...');

        // Nivel 1: Tab → puede disparar autofill de Chrome
        await page.keyboard.press('Escape');
        await sleep(200);
        await page.keyboard.press('Tab');
        await sleep(1000);

        const passNivel1 = await page.$eval('#password', el => el.value.trim()).catch(() => '');
        if (!passNivel1) {
            // Nivel 2: clic + ArrowDown
            console.log('ℹ️ Tab no disparó autofill. Intentando clic + ArrowDown...');
            await actualizarOverlay(page, 'Intentando autocompletar contraseña...');
            await page.click('#password');
            await sleep(800);
            await page.keyboard.press('ArrowDown');
            await sleep(600);
        }
    } else {
        console.log(`✅ Campo usuario coincide con CUIT: "${cuit}"`);
    }

    // Marcar campo usuario como readonly
    await page.evaluate(() => {
        const el = document.getElementById('username');
        if (el) {
            el.setAttribute('readonly', 'readonly');
            el.style.backgroundColor = '#e9ecef';
            el.style.cursor = 'not-allowed';
        }
    });

    const passwordFinal = await page.$eval('#password', el => el.value.trim()).catch(() => '');

    // Quitar overlay: la app terminó, el usuario puede interactuar
    await ocultarOverlay(page);
    await mostrarBannerCierre(page, MSG_CIERRE);

    if (!passwordFinal) {
        console.log('⚠️ Contraseña no disponible. Requiere acción manual en Chrome.');
        console.log(`🔐 Login manual requerido para CUIT ${cuit}`);
        console.log('⏳ Navegador listo — ingresá la contraseña manualmente.');
    } else {
        console.log('✅ Contraseña detectada. Navegador listo — podés presionar Ingresar.');
    }

    browser.disconnect();
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
