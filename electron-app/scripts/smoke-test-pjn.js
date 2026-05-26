/**
 * smoke-test-pjn.js
 * Verifica que el portal PJN sigue respondiendo con los selectores esperados.
 *
 * Uso:
 *   node scripts/smoke-test-pjn.js
 *
 * Variables de entorno (opcional, para subir resultados al dashboard):
 *   ADMIN_EMAIL=admin@procuradortool.com
 *   ADMIN_PASSWORD=tu_password
 *   API_URL=https://api.procuradortool.com   (default)
 *
 * Desde: electron-app/
 */

'use strict';

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const https     = require('https');

// ── Configuración ─────────────────────────────────────────────────────────────
const CUIT        = '27320694359';
const API_URL     = process.env.API_URL || 'https://api.procuradortool.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || '';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');

// ── Helpers ───────────────────────────────────────────────────────────────────
const checks  = [];
const logs    = [];
let   t0Total = Date.now();

function ts() {
    return new Date().toLocaleTimeString('es-AR');
}

function log(msg) {
    const line = `[${ts()}] ${msg}`;
    logs.push(line);
    console.log(line);
}

function pass(label, detail = '') {
    checks.push({ label, ok: true });
    log(`✅  ${label}${detail ? '  —  ' + detail : ''}`);
}

function fail(label, detail = '') {
    checks.push({ label, ok: false, error: detail });
    log(`❌  ${label}${detail ? '  —  ' + detail : ''}`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function detectarChrome() {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const r of rutas) if (fs.existsSync(r)) return r;
    throw new Error('Chrome no encontrado');
}

// ── Checks PJN ────────────────────────────────────────────────────────────────
async function runPjnChecks() {
    log('▶ Iniciando checks del Portal PJN...');

    const chromePath = detectarChrome();
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            `--user-data-dir=${PROFILE_DIR}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-default-apps',
        ],
        defaultViewport: null,
        timeout: 60000,
    });

    const pages = await browser.pages();
    const page  = pages.length > 0 ? pages[0] : await browser.newPage();

    try {
        // ── CHECK 1: scw.pjn.gov.ar accesible ─────────────────────────────────
        log('Navegando a portalpjn.pjn.gov.ar...');
        await page.goto('https://portalpjn.pjn.gov.ar', { waitUntil: 'networkidle2', timeout: 30000 });
        pass('scw.pjn.gov.ar accesible');

        // ── CHECK 2: Formulario SSO presente ──────────────────────────────────
        const loginDetected = await Promise.race([
            page.waitForSelector('#username',                           { timeout: 15000 }).then(() => 'login'),
            page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 }).then(() => 'session'),
        ]).catch(() => null);

        if (loginDetected === 'login') {
            // Verificar campos del formulario
            const passExists = await page.$('input[type="password"]') !== null;
            const btnExists  = await page.$('#kc-login') !== null;

            if (passExists && btnExists) {
                pass('SSO login — formulario presente', '#username + input[password] + #kc-login');
            } else {
                fail('SSO login — formulario incompleto', `password=${passExists} btn=${btnExists}`);
            }

            // ── CHECK 3: Login con gestor de contraseñas ───────────────────────
            log(`Intentando autofill de contraseña para CUIT ${CUIT}...`);

            // Asegurar que el campo CUIT tiene el valor correcto
            const cuitActual = await page.$eval('#username', el => el.value.trim()).catch(() => '');
            if (cuitActual !== CUIT) {
                await page.evaluate((c) => {
                    const el = document.getElementById('username');
                    if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
                }, CUIT);
                await page.type('#username', CUIT, { delay: 40 });
            }

            // Trigger autofill contraseña
            await page.focus('#username');
            await page.keyboard.press('Tab');
            await sleep(1200);

            const passValue = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
            if (!passValue) {
                await page.click('input[type="password"]');
                await sleep(600);
                await page.keyboard.press('ArrowDown');
                await sleep(600);
            }

            const passValueFinal = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
            if (passValueFinal) {
                // Click login
                await page.click('#kc-login');
                await sleep(3000);

                // Esperar sesión activa
                const sessionOk = await page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 })
                    .then(() => true).catch(() => false);

                if (sessionOk) {
                    pass('Login exitoso — sesión activa detectada');
                } else {
                    fail('Login — no se detectó sesión activa tras submit');
                    return; // Sin sesión no podemos continuar
                }
            } else {
                fail('Login — contraseña no disponible en gestor de Chrome');
                log('⚠️  Asegurate de tener guardada la contraseña PJN en Chrome para este perfil.');
                return;
            }

        } else if (loginDetected === 'session') {
            pass('SSO login — sesión activa preexistente');
        } else {
            fail('Acceso al portal PJN — timeout esperando formulario o sesión');
            return;
        }

        // ── CHECK 4: Consulta pública — campos presentes ───────────────────────
        log('Navegando al formulario de consulta pública...');

        // Esperar encabezado SCW
        const header = await page.waitForSelector('span.colorTextGrey', { timeout: 15000 }).catch(() => null);
        if (!header) {
            fail('Consulta pública — encabezado SCW no encontrado');
            return;
        }
        const headerText = await page.$eval('span.colorTextGrey', el => el.textContent.trim());

        if (headerText === 'Lista de Expedientes Relacionados') {
            const btnConsulta = await page.$('#j_idt24\\:menuNavigation\\:j_idt36\\:menuNuevaConsulta');
            if (!btnConsulta) {
                fail('Consulta pública — botón "Nueva Consulta Pública" no encontrado');
                return;
            }
            await btnConsulta.click();
            await sleep(2000);
        }

        // Verificar campos del formulario de consulta
        const camara = await page.$('#formPublica\\:camaraNumAni');
        const numero = await page.$('#formPublica\\:numero');
        const anio   = await page.$('#formPublica\\:anio');
        const btnBuscar = await page.$('#formPublica\\:buscarPorNumeroButton');

        const allPresent = camara && numero && anio && btnBuscar;
        if (allPresent) {
            pass('Consulta pública — campos presentes', 'camaraNumAni + numero + anio + buscarPorNumeroButton');
        } else {
            fail('Consulta pública — faltan campos', `camara=${!!camara} numero=${!!numero} anio=${!!anio} btn=${!!btnBuscar}`);
        }

    } catch (err) {
        fail('Error inesperado en checks PJN', err.message);
    } finally {
        await browser.close();
    }
}

// ── Subir resultados al dashboard ─────────────────────────────────────────────
async function uploadResults(result) {
    if (!ADMIN_EMAIL || !ADMIN_PASS) {
        console.log('\n⚠️  ADMIN_EMAIL / ADMIN_PASSWORD no configurados — resultados NO subidos al dashboard.');
        console.log('   Para subir: ADMIN_EMAIL=admin@x.com ADMIN_PASSWORD=pass node scripts/smoke-test-pjn.js\n');
        return;
    }

    try {
        // Login para obtener token
        const loginRes = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
        });
        const loginData = await loginRes.json();
        if (!loginData.token) throw new Error('Login fallido: ' + (loginData.error || 'sin token'));

        // Subir resultados
        const uploadRes = await fetch(`${API_URL}/admin/smoke-tests/report-pjn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.token}` },
            body: JSON.stringify({ result }),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.success) {
            console.log('✅ Resultados subidos al dashboard correctamente.');
        } else {
            console.log('⚠️  No se pudieron subir los resultados:', uploadData.error);
        }
    } catch (err) {
        console.log('⚠️  Error al subir resultados:', err.message);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  🧪 Smoke Test — Portal PJN');
    console.log(`  ${new Date().toLocaleString('es-AR')}`);
    console.log('═══════════════════════════════════════════════\n');

    t0Total = Date.now();

    await runPjnChecks();

    const duration = Date.now() - t0Total;
    const passed   = checks.filter(c => c.ok).length;
    const total    = checks.length;

    log('─────────────────────────────────────────────');
    log(`RESULTADO: ${passed}/${total} ${passed === total ? '✅' : '❌'}  —  duración: ${(duration / 1000).toFixed(1)}s`);

    console.log('\n═══════════════════════════════════════════════\n');

    const result = {
        passed,
        total,
        ok: passed === total,
        duration,
        checks,
        logs,
    };

    await uploadResults(result);

    process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
    console.error('❌ Error fatal:', err.message);
    process.exit(1);
});
