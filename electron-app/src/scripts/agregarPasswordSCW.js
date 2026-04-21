/**
 * agregarPasswordSCW.js
 * Abre Chrome con el perfil de automatizaciones, navega al gestor de contraseñas
 * y pre-completa el formulario de alta (sitio: sso.pjn.gov.ar, usuario: CUIT).
 *
 * Muestra un overlay con spinner mientras trabaja para que el usuario no interfiera,
 * y lo retira cuando todo está cargado, dejando solo el campo contraseña para completar.
 *
 * Uso: node agregarPasswordSCW.js <cuit>
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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

// ── Shadow DOM helpers ──────────────────────────────────────────────────────

async function clickEnShadowDOM(page, selector) {
    return page.evaluate((sel) => {
        function shadowSearch(root, s) {
            const direct = root.querySelector(s);
            if (direct) return direct;
            for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) {
                    const found = shadowSearch(el.shadowRoot, s);
                    if (found) return found;
                }
            }
            return null;
        }
        const el = shadowSearch(document, sel);
        if (!el) return false;
        el.click();
        return true;
    }, selector);
}

async function focusEnShadowDOM(page, selector) {
    return page.evaluate((sel) => {
        function shadowSearch(root, s) {
            const direct = root.querySelector(s);
            if (direct) return direct;
            for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) {
                    const found = shadowSearch(el.shadowRoot, s);
                    if (found) return found;
                }
            }
            return null;
        }
        const el = shadowSearch(document, sel);
        if (!el) return false;
        el.value = '';
        el.focus();
        return true;
    }, selector);
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
        args: [
            `--user-data-dir=${profilePath}`,
            '--no-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-default-apps',
            '--disable-session-crashed-bubble',
            '--ignore-certificate-errors',
        ],
        defaultViewport: null,
        timeout: 60000,
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    await centrarVentana(page);

    console.log('🔑 Navegando al gestor de contraseñas...');
    await page.goto('chrome://password-manager/passwords', { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    // Mostrar overlay: el usuario no debe tocar nada mientras se prepara el formulario
    await mostrarOverlay(page, 'Abriendo formulario de nueva contraseña...');
    await sleep(300);

    // ── 1. Clic en "Agregar" ────────────────────────────────────────────────
    console.log('🖱️  Haciendo clic en "Agregar"...');
    const MSG_CIERRE = 'Completá la contraseña y presioná Guardar — luego cerrá esta ventana para continuar en Procurador SCW';

    const clickedAdd = await clickEnShadowDOM(page, '#addPasswordButton');
    if (!clickedAdd) {
        console.warn('⚠️  No se encontró el botón Agregar.');
        await ocultarOverlay(page);
        await mostrarBannerCierre(page, MSG_CIERRE);
        browser.disconnect();
        return;
    }
    await sleep(1000);

    // ── 2. Campo Sitio ──────────────────────────────────────────────────────
    const sitio = 'sso.pjn.gov.ar';
    console.log(`📝 Completando sitio: ${sitio}`);
    await actualizarOverlay(page, `Completando sitio: ${sitio}...`);

    const focusedSite = await focusEnShadowDOM(page, 'input[aria-label="Sitio"]');
    if (focusedSite) {
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.type(sitio, { delay: 40 });
    } else {
        console.warn('⚠️  No se encontró el campo Sitio.');
    }

    // ── 3. Campo Usuario (CUIT) ─────────────────────────────────────────────
    if (cuit) {
        console.log(`👤 Completando usuario: ${cuit}`);
        await actualizarOverlay(page, `Completando usuario: ${cuit}...`);

        await page.keyboard.press('Tab');
        await sleep(300);

        const focusedUser = await page.evaluate(() => {
            return document.activeElement?.getAttribute('aria-label') === 'Nombre de usuario';
        });
        if (!focusedUser) {
            await focusEnShadowDOM(page, 'input[aria-label="Nombre de usuario"]');
        }
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.type(cuit, { delay: 40 });
    }

    // ── Overlay terminado: todo cargado, le toca al usuario la contraseña ───
    await ocultarOverlay(page);
    await mostrarBannerCierre(page, MSG_CIERRE);
    browser.disconnect();

    console.log('✅ Listo. Completá la contraseña manualmente y presioná Guardar en Chrome.');
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
