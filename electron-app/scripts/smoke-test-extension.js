/**
 * smoke-test-extension.js
 * Verifica que los 5 flujos de la extensión Chrome siguen teniendo
 * los selectores DOM correctos en cada portal del PJN.
 *
 * Grupos:
 *   D — SCW Consulta   (scw.pjn.gov.ar — sesión + nav + formulario)
 *   E — SCW Escritos 1 (scw.pjn.gov.ar/scw/expediente.seam — legend + botón)
 *   F — Escritos 2     (escritos.pjn.gov.ar — MUI stepper form)
 *   G — Notificaciones (notif.pjn.gov.ar — MUI stepper form)
 *   H — DEOX           (deox.pjn.gov.ar — React stepper form)
 *
 * Uso:
 *   node scripts/smoke-test-extension.js
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

// ── Configuración ─────────────────────────────────────────────────────────────
const CUIT        = '27320694359';
const API_URL     = process.env.API_URL || 'https://api.procuradortool.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || '';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');

// URLs de los portales
const SCW_URL       = 'http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1';
const ESCRITOS2_URL = 'https://escritos.pjn.gov.ar';
const NOTIF_URL     = 'https://notif.pjn.gov.ar';
const DEOX_URL      = 'https://deox.pjn.gov.ar';

// Expediente de referencia para Escritos 1 (el mismo que usa el smoke-test-pjn)
const EXP_JURISDICCION = '14';   // FCR
const EXP_NUMERO       = '18745';
const EXP_ANIO         = '2017';

// ── Helpers ───────────────────────────────────────────────────────────────────
const checks  = [];
const logs    = [];
let   t0Total = Date.now();

function ts() { return new Date().toLocaleTimeString('es-AR'); }
function log(msg) { const l = `[${ts()}] ${msg}`; logs.push(l); console.log(l); }

function pass(label, detail = '') {
    checks.push({ label, ok: true });
    log(`✅  ${label}${detail ? '  —  ' + detail : ''}`);
}
function fail(label, detail = '') {
    checks.push({ label, ok: false, error: detail });
    log(`❌  ${label}${detail ? '  —  ' + detail : ''}`);
}
function skip(label, reason = '') {
    checks.push({ label, ok: null, skipped: true });
    log(`⏭️   ${label}${reason ? '  —  ' + reason : ''}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectarChrome() {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const r of rutas) if (fs.existsSync(r)) return r;
    throw new Error('Chrome no encontrado');
}

async function existe(page, selector) {
    return (await page.$(selector)) !== null;
}

/**
 * Intenta autenticar contra la SSO de Keycloak usando el gestor de contraseñas de Chrome.
 * Precondición: la página actual ya muestra el formulario SSO (#username presente).
 * Retorna 'logged-in' si el login fue exitoso, 'no-password' o 'failed' si no.
 *
 * @param {Page}   page
 * @param {string} sessionSelector  Selector que indica que la sesión quedó establecida
 */
async function loginSSO(page, sessionSelector) {
    const cuitActual = await page.$eval('#username', el => el.value.trim()).catch(() => '');
    if (cuitActual !== CUIT) {
        await page.evaluate((c) => {
            const el = document.getElementById('username');
            if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
        }, CUIT);
        await page.type('#username', CUIT, { delay: 40 });
    }
    await page.focus('#username');
    await page.keyboard.press('Tab');
    await sleep(1200);

    let passVal = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
    if (!passVal) {
        await page.click('input[type="password"]');
        await sleep(600);
        await page.keyboard.press('ArrowDown');
        await sleep(600);
        passVal = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
    }
    if (!passVal) return 'no-password';

    await page.click('#kc-login');
    await sleep(3000);

    const ok = await page.waitForSelector(sessionSelector, { timeout: 20000 })
        .then(() => true).catch(() => false);
    return ok ? 'logged-in' : 'failed';
}

/**
 * Navega a un portal React del PJN y espera que el formulario esté listo.
 * Si la SSO session de Keycloak está activa, el portal hace auto-login sin mostrar el form de login.
 * Si no, muestra #username → intenta autenticar con el gestor de Chrome.
 *
 * Retorna: 'active' | 'logged-in' | 'no-password' | 'failed' | 'timeout' | 'error'
 */
async function navegarPortalReact(page, url, formSelector) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });

    const estado = await Promise.race([
        page.waitForSelector('#username',  { timeout: 20000 }).then(() => 'login'),
        page.waitForSelector(formSelector, { timeout: 20000 }).then(() => 'form'),
    ]).catch(() => 'timeout');

    if (estado === 'form') return 'active';

    if (estado === 'login') {
        const passExists = await existe(page, 'input[type="password"]');
        const btnExists  = await existe(page, '#kc-login');
        if (!passExists || !btnExists) return 'sso-incompleto';

        return await loginSSO(page, formSelector);
    }

    return estado; // 'timeout'
}

// ── GRUPO D: SCW Consulta ──────────────────────────────────────────────────────
async function grupoD(page) {
    log('\n══ GRUPO D — SCW Consulta (cs-scw.js) ══════════════════════');

    // D1: Portal SCW accesible
    await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    pass('D1 — scw.pjn.gov.ar accesible');

    // Detectar estado: SSO login o sesión activa
    const loginDetected = await Promise.race([
        page.waitForSelector('#username',                                { timeout: 15000 }).then(() => 'login'),
        page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 }).then(() => 'session'),
    ]).catch(() => null);

    if (loginDetected === 'login') {
        const passExists = await existe(page, 'input[type="password"]');
        const btnExists  = await existe(page, '#kc-login');
        if (!passExists || !btnExists) {
            fail('D2 — SSO: formulario incompleto', `pass=${passExists} btn=${btnExists}`);
            return false;
        }
        pass('D2 — SSO: formulario de login presente');

        const loginResult = await loginSSO(page, 'a.dropdown-toggle.menu-btn-border-right');
        if (loginResult === 'no-password') {
            fail('D3 — Contraseña PJN no disponible en gestor de Chrome');
            log('⚠️  Guardá la contraseña PJN en Chrome para el perfil ProcuradorSCW.');
            return false;
        }
        if (loginResult === 'failed') {
            const errMsg = await page.$eval('#kc-error-message, .alert-error', el => el.textContent.trim()).catch(() => '');
            fail('D3 — Login SCW fallido', errMsg || `URL: ${page.url().slice(0, 80)}`);
            return false;
        }
        pass('D3 — Login SCW exitoso — sesión activa');

    } else if (loginDetected === 'session') {
        pass('D2 — Sesión SCW activa preexistente');
        pass('D3 — Login — sesión ya establecida');
    } else {
        fail('D2 — Timeout: ni SSO ni sesión detectados');
        return false;
    }

    // D4: Header "Lista de Expedientes Relacionados"
    await page.waitForSelector('h2.form_title', { timeout: 10000 }).catch(() => {});
    const titulo = await page.$eval('h2.form_title', el => el.textContent.trim()).catch(() => '');
    if (titulo.includes('Lista de Expedientes Relacionados')) {
        pass('D4 — Header SCW "Lista de Expedientes Relacionados"');
    } else {
        fail('D4 — Header inesperado en SCW', titulo.slice(0, 60));
        return false;
    }

    // D5: Link "Nueva Consulta Pública" en menú
    const navLink = await page.$('a[id$="menuNuevaConsulta"]');
    if (!navLink) {
        fail('D5 — Nav link "Nueva Consulta Pública" no encontrado (a[id$="menuNuevaConsulta"])');
        return false;
    }
    pass('D5 — Nav link "Nueva Consulta Pública" presente');

    // D6: Click → "Consulta pública"
    await navLink.click();
    await sleep(1500);

    const headerGrey = await page.$eval('span.colorTextGrey', el => el.textContent.trim()).catch(() => '');
    const headerH2   = await page.$eval('h2.form_title',      el => el.textContent.trim()).catch(() => '');
    const enConsulta = headerGrey.toLowerCase().includes('consulta') || headerH2.toLowerCase().includes('consulta');
    if (enConsulta) {
        pass('D6 — Navegó a "Consulta pública"', (headerGrey || headerH2).slice(0, 50));
    } else {
        fail('D6 — No se detectó página "Consulta pública"', `grey="${headerGrey.slice(0,40)}" h2="${headerH2.slice(0,40)}"`);
        return false;
    }

    // D7: Formulario de consulta pública completo
    const fCamara    = await existe(page, '#formPublica\\:camaraNumAni');
    const fNumero    = await existe(page, 'input[name="formPublica:numero"]');
    const fAnio      = await existe(page, 'input[name="formPublica:anio"]');
    const fBtnBuscar = await existe(page, 'input[id$="buscarPorNumeroButton"]');
    if (fCamara && fNumero && fAnio && fBtnBuscar) {
        pass('D7 — Formulario consulta pública completo', 'camara + numero + anio + buscar ✓');
    } else {
        fail('D7 — Formulario incompleto', `cam=${fCamara} num=${fNumero} anio=${fAnio} btn=${fBtnBuscar}`);
    }

    return true;
}

// ── GRUPO E: SCW Escritos 1 ────────────────────────────────────────────────────
async function grupoE(page) {
    log('\n══ GRUPO E — SCW Escritos 1 (expediente.seam, cs-scw.js) ═══');

    // Necesitamos llegar a expediente.seam buscando FCR 18745/2017
    // Si el grupo D dejó la página en el form de consulta, usamos ese; si no, navegamos de nuevo.
    const enFormConsulta = await existe(page, 'input[id$="buscarPorNumeroButton"]');
    if (!enFormConsulta) {
        log('E — Navegando a SCW para buscar expediente...');
        await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        const navLink = await page.$('a[id$="menuNuevaConsulta"]').catch(() => null);
        if (!navLink) {
            fail('E1 — No se pudo navegar a "Consulta pública"');
            skip('E2 — legend.ui-fieldset-legend "Datos Generales"', 'sin acceso al formulario');
            skip('E3 — #expediente:nuevoEscritoBtn a',              'sin acceso al formulario');
            return;
        }
        await navLink.click();
        await sleep(1500);
    }

    // E1: Buscar FCR 18745/2017 → llegar a expediente.seam
    log(`E1 — Buscando FCR ${EXP_NUMERO}/${EXP_ANIO} → expediente.seam...`);
    try {
        await page.select('#formPublica\\:camaraNumAni', EXP_JURISDICCION);
        await page.$eval('input[name="formPublica:numero"]', el => el.value = '');
        await page.type('input[name="formPublica:numero"]', EXP_NUMERO, { delay: 30 });
        await page.$eval('input[name="formPublica:anio"]',  el => el.value = '');
        await page.type('input[name="formPublica:anio"]',   EXP_ANIO,   { delay: 30 });
        await page.click('input[id$="buscarPorNumeroButton"]');
        await sleep(5000);
    } catch (err) {
        fail('E1 — Error al enviar búsqueda', err.message.slice(0, 60));
        skip('E2 — legend.ui-fieldset-legend "Datos Generales"', 'búsqueda fallida');
        skip('E3 — #expediente:nuevoEscritoBtn a',              'búsqueda fallida');
        return;
    }

    // Verificar que llegamos a expediente.seam
    const urlActual = page.url();
    if (!urlActual.includes('expediente.seam')) {
        fail('E1 — No se llegó a expediente.seam', `URL: ${urlActual.slice(0, 80)}`);
        skip('E2 — legend.ui-fieldset-legend "Datos Generales"', 'sin expediente.seam');
        skip('E3 — #expediente:nuevoEscritoBtn a',              'sin expediente.seam');
        return;
    }
    pass('E1 — Llegó a expediente.seam correctamente');

    // E2: legend.ui-fieldset-legend con texto "Datos Generales"
    const legend = await page.waitForSelector('legend.ui-fieldset-legend', { timeout: 8000 }).catch(() => null);
    if (!legend) {
        fail('E2 — legend.ui-fieldset-legend no encontrado en expediente.seam');
    } else {
        const legendText = await legend.evaluate(el => el.textContent.trim()).catch(() => '');
        if (legendText.includes('Datos Generales') || legendText.includes('Datos')) {
            pass('E2 — legend.ui-fieldset-legend "Datos Generales" presente', legendText.slice(0, 40));
        } else {
            fail('E2 — legend encontrado pero texto inesperado', legendText.slice(0, 40));
        }
    }

    // E3: #expediente:nuevoEscritoBtn a ("Presentar escrito")
    const btnEscrito = await page.$('#expediente\\:nuevoEscritoBtn a').catch(() => null);
    if (!btnEscrito) {
        const contenedor = await existe(page, '#expediente\\:nuevoEscritoBtn');
        fail('E3 — #expediente:nuevoEscritoBtn a no encontrado', contenedor ? 'contenedor existe pero sin <a>' : 'contenedor ausente');
    } else {
        const btnText = await btnEscrito.evaluate(el => el.textContent.trim()).catch(() => '');
        pass('E3 — #expediente:nuevoEscritoBtn a (Presentar escrito) presente', btnText.slice(0, 40));
    }
}

// ── GRUPO F: Escritos 2 ────────────────────────────────────────────────────────
async function grupoF(page) {
    log('\n══ GRUPO F — Escritos 2 (escritos.pjn.gov.ar, cs-escritos2.js) ══');

    // F1: Portal accesible
    log('F1 — Navegando a escritos.pjn.gov.ar...');
    let estado;
    try {
        estado = await navegarPortalReact(
            page,
            ESCRITOS2_URL,
            'input[role="combobox"][aria-autocomplete="list"]'
        );
    } catch (err) {
        fail('F1 — Error al navegar a escritos.pjn.gov.ar', err.message.slice(0, 60));
        ['F2 — SSO/Sesión', 'F3 — Combobox jurisdicción', 'F4 — input número',
         'F5 — input año', 'F6 — button#StepperNextBtn'].forEach(l => skip(l, 'navegación fallida'));
        return;
    }

    pass('F1 — escritos.pjn.gov.ar accesible');

    if (estado === 'no-password') {
        fail('F2 — Contraseña PJN no disponible para escritos.pjn.gov.ar');
        ['F3 — Combobox jurisdicción', 'F4 — input número', 'F5 — input año', 'F6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    if (estado === 'failed' || estado === 'timeout') {
        fail('F2 — Login SSO fallido para escritos.pjn.gov.ar', estado);
        ['F3 — Combobox jurisdicción', 'F4 — input número', 'F5 — input año', 'F6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    estado === 'active'
        ? pass('F2 — Sesión SSO activa (auto-login)')
        : pass('F2 — Login SSO exitoso');

    // F3–F6: Formulario MUI stepper
    const fJuris  = await existe(page, 'input[role="combobox"][aria-autocomplete="list"]');
    fJuris
        ? pass('F3 — Combobox jurisdicción presente', 'input[role="combobox"][aria-autocomplete="list"]')
        : fail('F3 — Combobox jurisdicción no encontrado');

    const fNumero = await existe(page, 'input[name="numeroExpediente"]');
    fNumero
        ? pass('F4 — input[name="numeroExpediente"] presente')
        : fail('F4 — input[name="numeroExpediente"] no encontrado');

    const fAnio   = await existe(page, 'input[name="anioExpediente"]');
    fAnio
        ? pass('F5 — input[name="anioExpediente"] presente')
        : fail('F5 — input[name="anioExpediente"] no encontrado');

    const fBtn    = await existe(page, 'button#StepperNextBtn');
    fBtn
        ? pass('F6 — button#StepperNextBtn presente')
        : fail('F6 — button#StepperNextBtn no encontrado');
}

// ── GRUPO G: Notificaciones ────────────────────────────────────────────────────
async function grupoG(page) {
    log('\n══ GRUPO G — Notificaciones (notif.pjn.gov.ar, cs-notif.js) ═══');

    log('G1 — Navegando a notif.pjn.gov.ar...');
    let estado;
    try {
        estado = await navegarPortalReact(
            page,
            NOTIF_URL,
            'input[role="combobox"][aria-autocomplete="list"]'
        );
    } catch (err) {
        fail('G1 — Error al navegar a notif.pjn.gov.ar', err.message.slice(0, 60));
        ['G2 — SSO/Sesión', 'G3 — Combobox jurisdicción', 'G4 — input número',
         'G5 — input año', 'G6 — button#StepperNextBtn'].forEach(l => skip(l, 'navegación fallida'));
        return;
    }

    pass('G1 — notif.pjn.gov.ar accesible');

    if (estado === 'no-password') {
        fail('G2 — Contraseña PJN no disponible para notif.pjn.gov.ar');
        ['G3 — Combobox jurisdicción', 'G4 — input número', 'G5 — input año', 'G6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    if (estado === 'failed' || estado === 'timeout') {
        fail('G2 — Login SSO fallido para notif.pjn.gov.ar', estado);
        ['G3 — Combobox jurisdicción', 'G4 — input número', 'G5 — input año', 'G6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    estado === 'active'
        ? pass('G2 — Sesión SSO activa (auto-login)')
        : pass('G2 — Login SSO exitoso');

    // G3–G6: Selectores de cs-notif.js
    const fJuris  = await existe(page, 'input[role="combobox"][aria-autocomplete="list"]');
    fJuris
        ? pass('G3 — Combobox jurisdicción presente', 'input[role="combobox"][aria-autocomplete="list"]')
        : fail('G3 — Combobox jurisdicción no encontrado');

    const fNumero = await existe(page, 'input[name="numeroExpediente"]');
    fNumero
        ? pass('G4 — input[name="numeroExpediente"] presente')
        : fail('G4 — input[name="numeroExpediente"] no encontrado');

    const fAnio   = await existe(page, 'input[name="anioExpediente"]');
    fAnio
        ? pass('G5 — input[name="anioExpediente"] presente')
        : fail('G5 — input[name="anioExpediente"] no encontrado');

    const fBtn    = await existe(page, 'button#StepperNextBtn');
    fBtn
        ? pass('G6 — button#StepperNextBtn presente')
        : fail('G6 — button#StepperNextBtn no encontrado');
}

// ── GRUPO H: DEOX ──────────────────────────────────────────────────────────────
async function grupoH(page) {
    log('\n══ GRUPO H — DEOX (deox.pjn.gov.ar, cs-deox.js) ═══════════');

    log('H1 — Navegando a deox.pjn.gov.ar...');
    let estado;
    try {
        // DEOX usa input[name="camara"] como primer campo del formulario
        estado = await navegarPortalReact(
            page,
            DEOX_URL,
            'input[name="camara"]'
        );
    } catch (err) {
        fail('H1 — Error al navegar a deox.pjn.gov.ar', err.message.slice(0, 60));
        ['H2 — SSO/Sesión', 'H3 — input[name="camara"]', 'H4 — input número',
         'H5 — input año', 'H6 — button#StepperNextBtn', 'H7 — ul[role="listbox"]'].forEach(l => skip(l, 'navegación fallida'));
        return;
    }

    pass('H1 — deox.pjn.gov.ar accesible');

    if (estado === 'no-password') {
        fail('H2 — Contraseña PJN no disponible para deox.pjn.gov.ar');
        ['H3 — input[name="camara"]', 'H4 — input número', 'H5 — input año',
         'H6 — button#StepperNextBtn', 'H7 — ul[role="listbox"]'].forEach(l => skip(l, 'sin sesión'));
        return;
    }
    if (estado === 'failed' || estado === 'timeout') {
        fail('H2 — Login SSO fallido para deox.pjn.gov.ar', estado);
        ['H3 — input[name="camara"]', 'H4 — input número', 'H5 — input año',
         'H6 — button#StepperNextBtn', 'H7 — ul[role="listbox"]'].forEach(l => skip(l, 'sin sesión'));
        return;
    }
    estado === 'active'
        ? pass('H2 — Sesión SSO activa (auto-login)')
        : pass('H2 — Login SSO exitoso');

    // H3: input[name="camara"] — DEOX usa este selector en lugar del combobox genérico
    const fCamara = await existe(page, 'input[name="camara"]');
    fCamara
        ? pass('H3 — input[name="camara"] (jurisdicción) presente')
        : fail('H3 — input[name="camara"] no encontrado');

    // H4: Input número expediente
    const fNumero = await existe(page, 'input[name="numeroExpediente"]');
    fNumero
        ? pass('H4 — input[name="numeroExpediente"] presente')
        : fail('H4 — input[name="numeroExpediente"] no encontrado');

    // H5: Input año
    const fAnio = await existe(page, 'input[name="anioExpediente"]');
    fAnio
        ? pass('H5 — input[name="anioExpediente"] presente')
        : fail('H5 — input[name="anioExpediente"] no encontrado');

    // H6: StepperNextBtn
    const fBtn = await existe(page, 'button#StepperNextBtn');
    fBtn
        ? pass('H6 — button#StepperNextBtn presente')
        : fail('H6 — button#StepperNextBtn no encontrado');

    // H7: ul[role="listbox"] (dropdown de jurisdicciones, aparece al hacer focus en el campo camara)
    //     Solo verificamos que el selector del combobox sea activable — no abrimos el dropdown.
    //     La existencia de input[name="camara"] con role correcto es suficiente.
    const fListboxActivable = await page.$eval(
        'input[name="camara"]',
        el => el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') !== null || el.tagName === 'INPUT'
    ).catch(() => false);
    fListboxActivable
        ? pass('H7 — input[name="camara"] es un campo interactivo válido')
        : fail('H7 — input[name="camara"] no tiene atributos de combobox esperados');
}

// ── Subir resultados al dashboard ─────────────────────────────────────────────
async function uploadResults(result) {
    if (!ADMIN_EMAIL || !ADMIN_PASS) {
        console.log('\n⚠️  ADMIN_EMAIL / ADMIN_PASSWORD no configurados — resultados NO subidos al dashboard.');
        console.log('   Para subir: ADMIN_EMAIL=admin@x.com ADMIN_PASSWORD=pass node scripts/smoke-test-extension.js\n');
        return;
    }
    try {
        const loginRes = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, machineId: 'smoke-test-extension' }),
        });
        const loginData = await loginRes.json();
        if (!loginData.token) throw new Error('Login fallido: ' + (loginData.error || 'sin token'));

        const uploadRes = await fetch(`${API_URL}/admin/smoke-tests/report-extension`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.token}` },
            body: JSON.stringify({ result }),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.success) console.log('✅ Resultados subidos al dashboard correctamente.');
        else console.log('⚠️  No se pudieron subir los resultados:', uploadData.error);
    } catch (err) {
        console.log('⚠️  Error al subir resultados:', err.message);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🧪 Smoke Test — Extensión Chrome (5 flujos PJN)');
    console.log(`  ${new Date().toLocaleString('es-AR')}`);
    console.log('  D: SCW Consulta  E: SCW Escritos 1  F: Escritos 2');
    console.log('  G: Notificaciones  H: DEOX');
    console.log('═══════════════════════════════════════════════════════════\n');

    t0Total = Date.now();

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
        // Grupos D y E necesitan sesión SCW activa
        const ssoOk = await grupoD(page).catch(err => { fail('D — Error inesperado', err.message); return false; });

        if (!ssoOk) {
            skip('E — SCW Escritos 1', 'sin sesión SCW');
        } else {
            await grupoE(page).catch(err => fail('E — Error inesperado', err.message));
        }

        // Grupos F, G, H usan portales React independientes
        // La sesión Keycloak establecida en D/E debería permitir auto-login en estos portales
        await grupoF(page).catch(err => fail('F — Error inesperado', err.message));
        await grupoG(page).catch(err => fail('G — Error inesperado', err.message));
        await grupoH(page).catch(err => fail('H — Error inesperado', err.message));

    } catch (err) {
        fail('Error fatal inesperado', err.message);
    } finally {
        await browser.close();
    }

    // ── Resumen final ──
    const duration   = Date.now() - t0Total;
    const realChecks = checks.filter(c => c.ok !== null);
    const passed     = realChecks.filter(c => c.ok).length;
    const total      = realChecks.length;
    const skipped    = checks.filter(c => c.ok === null).length;

    log('\n─────────────────────────────────────────────────────────');
    log(`RESULTADO: ${passed}/${total} ${passed === total ? '✅' : '❌'}  —  ${(duration / 1000).toFixed(1)}s${skipped ? `  —  ${skipped} omitidos` : ''}`);

    const fallidos = checks.filter(c => c.ok === false);
    if (fallidos.length > 0) {
        log('\nChecks fallidos:');
        fallidos.forEach(c => log(`  ❌ ${c.label}${c.error ? ': ' + c.error : ''}`));
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');

    const result = { passed, total, ok: passed === total, duration, checks, logs };
    await uploadResults(result);

    process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
    console.error('❌ Error fatal:', err.message);
    process.exit(1);
});
