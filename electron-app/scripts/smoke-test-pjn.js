/**
 * smoke-test-pjn.js
 * Verifica que el portal PJN sigue respondiendo con los selectores esperados.
 *
 * Grupos de checks:
 *   A — Acceso al portal (portalpjn + SSO + login)
 *   B — Módulo Listado (menú Mis Expedientes, secciones, tabla de expedientes)
 *   C — Módulo Informe (consulta pública, detalle expediente, actuaciones,
 *                       checkboxes filtros, pestañas intervinientes/vinculados/recursos)
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

// ── Configuración ─────────────────────────────────────────────────────────────
const CUIT        = '27320694359';
const API_URL     = process.env.API_URL || 'https://api.procuradortool.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || '';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');

// Expediente de referencia para checks del módulo Informe
const EXP_JURISDICCION = '14';   // FCR
const EXP_NUMERO       = '18745';
const EXP_ANIO         = '2017';

// ── Helpers ───────────────────────────────────────────────────────────────────
const checks  = [];
const logs    = [];
let   t0Total = Date.now();

function ts() { return new Date().toLocaleTimeString('es-AR'); }

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

// Verifica si un selector CSS existe en la página (no lanza excepción)
async function existe(page, selector) {
    return (await page.$(selector)) !== null;
}

// Verifica si un selector XPath existe en la página
async function existeXPath(page, xpath) {
    const result = await page.evaluate((xp) => {
        const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        return node !== null;
    }, xpath);
    return result;
}

// ── GRUPO A: Acceso al portal ─────────────────────────────────────────────────
async function grupoA(page) {
    log('\n══ GRUPO A — Acceso al portal ══════════════════════════');

    // A1: Portal PJN accesible
    log('Navegando a portalpjn.pjn.gov.ar...');
    await page.goto('https://portalpjn.pjn.gov.ar', { waitUntil: 'networkidle2', timeout: 30000 });
    pass('A1 — portalpjn.pjn.gov.ar accesible');

    // A2: Detectar formulario SSO o sesión activa
    const loginDetected = await Promise.race([
        page.waitForSelector('#username',                                { timeout: 15000 }).then(() => 'login'),
        page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 }).then(() => 'session'),
    ]).catch(() => null);

    if (loginDetected === 'login') {
        const passExists = await existe(page, 'input[type="password"]');
        const btnExists  = await existe(page, '#kc-login');
        if (passExists && btnExists) {
            pass('A2 — SSO formulario presente', '#username + password + #kc-login');
        } else {
            fail('A2 — SSO formulario incompleto', `password=${passExists} btn=${btnExists}`);
            return false;
        }

        // A3: Login con gestor de contraseñas
        log(`A3 — Autofill CUIT ${CUIT}...`);
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
        const passValue = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
        if (!passValue) {
            await page.click('input[type="password"]');
            await sleep(600);
            await page.keyboard.press('ArrowDown');
            await sleep(600);
        }
        const passValueFinal = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
        if (passValueFinal) {
            await page.click('#kc-login');
            await sleep(3000);
            const sessionOk = await page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 })
                .then(() => true).catch(() => false);
            if (sessionOk) {
                pass('A3 — Login exitoso — sesión activa');
            } else {
                const errMsg = await page.$eval('#kc-error-message, .alert-error, [class*="error"]', el => el.textContent.trim())
                    .catch(() => '');
                const detail = errMsg
                    ? `Error SSO: "${errMsg.slice(0, 80)}"`
                    : `URL: ${page.url().slice(0, 80)}`;
                fail('A3 — Login — no se detectó sesión tras submit', detail);
                return false;
            }
        } else {
            fail('A3 — Login — contraseña no disponible en gestor de Chrome');
            log('⚠️  Guardá la contraseña PJN en Chrome para este perfil y volvé a correr.');
            return false;
        }

    } else if (loginDetected === 'session') {
        pass('A2 — Sesión activa preexistente');
        pass('A3 — Login — sesión ya establecida');
    } else {
        fail('A2 — Timeout esperando formulario o sesión');
        return false;
    }

    return true; // Grupo A OK
}

// ── GRUPO B: Módulo Listado ────────────────────────────────────────────────────
async function grupoB(page) {
    log('\n══ GRUPO B — Módulo Listado ════════════════════════════');

    // Navegar al SCW
    log('Navegando a scw.pjn.gov.ar/scw/consultaListaRelacionados...');
    await page.goto('http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1',
        { waitUntil: 'networkidle2', timeout: 30000 });

    // B1: Título principal de la lista
    const headerSCW = await page.waitForSelector('h2.form_title', { timeout: 15000 }).catch(() => null);
    if (!headerSCW) { fail('B1 — h2.form_title no encontrado'); return; }
    const headerText = await page.$eval('h2.form_title', el => el.textContent.trim());
    if (headerText.includes('Lista de Expedientes Relacionados')) {
        pass('B1 — "Lista de Expedientes Relacionados" visible');
    } else {
        fail('B1 — Título inesperado', headerText.slice(0, 60));
        return;
    }

    // B2: Dropdown "Mis Expedientes"
    const dropdownMisExp = await existe(page, 'a.dropdown-toggle.menu-btn-border');
    if (dropdownMisExp) pass('B2 — Dropdown "Mis Expedientes" presente');
    else fail('B2 — Dropdown "Mis Expedientes" no encontrado');

    // B3: Secciones (LETRADO / PARTE / AUTORIZADO NE)
    const secLetrado   = await existe(page, 'input[value="LETRADO"]');
    const secParte     = await existe(page, 'input[value="PARTE"]');
    const secAutorizado = await existe(page, 'input[value="AUTORIZADO NE"]');
    if (secLetrado && secParte && secAutorizado) {
        pass('B3 — Secciones presentes', 'LETRADO + PARTE + AUTORIZADO NE');
    } else {
        fail('B3 — Secciones incompletas', `LETRADO=${secLetrado} PARTE=${secParte} AUTORIZADO=${secAutorizado}`);
    }

    // B4: Link favoritos (accesible desde menú dropdown)
    const submenuFav = await existe(page, 'a[id*="btn-lista-favoritos"]');
    if (submenuFav) pass('B4 — Enlace "Lista Favoritos" presente');
    else {
        // Intentar abrir el dropdown para que aparezca
        await page.click('a.dropdown-toggle.menu-btn-border').catch(() => {});
        await sleep(800);
        const favDesplegado = await existe(page, 'a[id*="btn-lista-favoritos"]');
        if (favDesplegado) pass('B4 — Enlace "Lista Favoritos" presente (dentro del dropdown)');
        else fail('B4 — Enlace "Lista Favoritos" no encontrado');
    }

    // B5: Contador de expedientes
    const counterExp = await existe(page, 'div[class*="well"] strong');
    if (counterExp) {
        const txt = await page.$eval('div[class*="well"] strong', el => el.textContent.trim()).catch(() => '');
        pass('B5 — Contador expedientes presente', txt.slice(0, 50));
    } else {
        fail('B5 — Contador expedientes no encontrado');
    }

    // B6: Tabla de expedientes (cuerpo)
    const tablaExp = await existe(page, 'table.table-striped tbody');
    if (tablaExp) pass('B6 — Tabla expedientes presente (table.table-striped tbody)');
    else fail('B6 — Tabla expedientes no encontrada');

    // B7: Selector de ordenamiento
    const orderBy = await existe(page, '[id^="j_idt"][id$=":order_by_form:camara"]');
    if (orderBy) pass('B7 — Selector "order_by_form:camara" presente');
    else fail('B7 — Selector de ordenamiento no encontrado');

    // B8: Paginación (puede no existir si hay 1 página)
    const lastPage = await existe(page, 'a.last-page');
    const firstPage = await existe(page, 'a.first-page');
    if (lastPage || firstPage) pass('B8 — Paginación presente (primera/última página)');
    else pass('B8 — Paginación ausente (1 sola página — OK)');
}

// ── GRUPO C: Módulo Informe ───────────────────────────────────────────────────
async function grupoC(page) {
    log('\n══ GRUPO C — Módulo Informe ════════════════════════════');

    // Volver a la lista para tener el menú disponible
    await page.goto('http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1',
        { waitUntil: 'networkidle2', timeout: 30000 });

    // C1: Botón "Nueva Consulta Pública"
    const btnNuevaConsulta = await page.waitForSelector('a[id$="menuNuevaConsulta"]', { timeout: 10000 }).catch(() => null);
    if (btnNuevaConsulta) pass('C1 — Botón "Nueva Consulta Pública" presente');
    else { fail('C1 — Botón "Nueva Consulta Pública" no encontrado'); return; }

    // C2: Formulario de consulta pública
    await page.click('a[id$="menuNuevaConsulta"]');
    await sleep(1500);
    const fCamara   = await existe(page, 'select[name="formPublica:camaraNumAni"]');
    const fNumero   = await existe(page, 'input[name="formPublica:numero"]');
    const fAnio     = await existe(page, 'input[name="formPublica:anio"]');
    const fBtnBuscar = await existe(page, 'input[id$="buscarPorNumeroButton"]');
    if (fCamara && fNumero && fAnio && fBtnBuscar) {
        pass('C2 — Formulario consulta pública completo', 'camaraNumAni + numero + anio + buscarPorNumeroButton');
    } else {
        fail('C2 — Formulario consulta pública incompleto',
            `camara=${fCamara} numero=${fNumero} anio=${fAnio} btn=${fBtnBuscar}`);
        return;
    }

    // C3: Búsqueda FCR 18745/2017
    log(`C3 — Buscando FCR ${EXP_NUMERO}/${EXP_ANIO}...`);
    await page.select('select[name="formPublica:camaraNumAni"]', EXP_JURISDICCION);
    await page.type('input[name="formPublica:numero"]', EXP_NUMERO, { delay: 30 });
    await page.type('input[name="formPublica:anio"]', EXP_ANIO, { delay: 30 });
    await page.click('input[id$="buscarPorNumeroButton"]');
    await sleep(4000);

    // C4: Detalle expediente — datos generales
    const detCamera     = await existe(page, '[id$="detailCamera"]');
    const detDependencia = await existe(page, '[id$="detailDependencia"]');
    const detSituation  = await existe(page, '[id$="detailSituation"]');
    const detCover      = await existe(page, '[id$="detailCover"]');
    if (detCamera && detDependencia && detSituation && detCover) {
        pass('C4 — Datos generales expediente presentes', 'detailCamera + detailDependencia + detailSituation + detailCover');
    } else {
        fail('C4 — Datos generales incompletos',
            `camera=${detCamera} dep=${detDependencia} sit=${detSituation} cover=${detCover}`);
        // No retornar — seguir verificando lo que se pueda
    }

    // C5: Tabla de actuaciones actuales
    const tablaActuaciones = await existe(page, '#expediente\\:action-table');
    if (tablaActuaciones) {
        const filas = await page.$$eval('#expediente\\:action-table tbody tr', rows => rows.length).catch(() => 0);
        pass('C5 — Tabla actuaciones presente', `${filas} fila(s) encontradas`);
    } else {
        fail('C5 — Tabla #expediente:action-table no encontrada');
    }

    // C6: Paginación de actuaciones
    const paginaActiva = await existe(page, '.pagination.no-margin.no-padding li.active span');
    if (paginaActiva) pass('C6 — Paginación actuaciones presente');
    else pass('C6 — Paginación actuaciones ausente (1 página — OK)');

    // C7: Botón "Ver Históricas"
    const btnHistoricas = await existe(page, '#expediente\\:btnActuacionesHistoricas a');
    if (btnHistoricas) pass('C7 — Botón "Ver Históricas" presente');
    else fail('C7 — Botón #expediente:btnActuacionesHistoricas no encontrado');

    // C8: Checkboxes de filtros de actuaciones
    const chkDE  = await existe(page, '#expediente\\:checkBoxDespachosYEscritosId');
    const chkN   = await existe(page, '#expediente\\:checkBoxnotaelEctronicasYPapelId');
    const chkI   = await existe(page, '#expediente\\:checkBoxInformacionesId');
    const chkVT  = await existe(page, '#expediente\\:checkBoxOtrasActuacionesId');
    const btnAplicar = await existe(page, '#expediente\\:filtrarActuacionesBtn');
    if (chkDE && chkN && chkI && chkVT && btnAplicar) {
        pass('C8 — Checkboxes filtros presentes', 'DE + N + I + VT + btn Aplicar');
    } else {
        fail('C8 — Checkboxes filtros incompletos',
            `DE=${chkDE} N=${chkN} I=${chkI} VT=${chkVT} btn=${btnAplicar}`);
    }

    // C9: Pestaña "Intervinientes" (XPath)
    const tabIntervinientes = await existeXPath(page,
        "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Intervinientes']]");
    if (tabIntervinientes) pass('C9 — Pestaña "Intervinientes" presente');
    else fail('C9 — Pestaña "Intervinientes" no encontrada (XPath)');

    // C10: Pestaña "Vinculados" (XPath)
    const tabVinculados = await existeXPath(page,
        "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Vinculados']]");
    if (tabVinculados) pass('C10 — Pestaña "Vinculados" presente');
    else fail('C10 — Pestaña "Vinculados" no encontrada (XPath)');

    // C11: Pestaña "Recursos" (XPath)
    const tabRecursos = await existeXPath(page,
        "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Recursos']]");
    if (tabRecursos) pass('C11 — Pestaña "Recursos" presente');
    else fail('C11 — Pestaña "Recursos" no encontrada (XPath)');

    // C12: Tabla Intervinientes (clic + verificar)
    if (tabIntervinientes) {
        try {
            await page.evaluate(() => {
                const node = document.evaluate(
                    "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Intervinientes']]",
                    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (node) node.click();
            });
            await sleep(1500);
            const tablaInterv = await existe(page, "[id='expediente:intervinientesTab']");
            const tablaPartes = await existe(page, "[id='expediente:participantsTable']");
            if (tablaInterv || tablaPartes) {
                pass('C12 — Tabla Intervinientes/Partes presente');
            } else {
                fail('C12 — Tabla Intervinientes/Partes no encontrada tras click');
            }
        } catch (e) {
            fail('C12 — Error al verificar tabla Intervinientes', e.message);
        }
    } else {
        skip('C12 — Tabla Intervinientes', 'pestaña no encontrada (C9 fallido)');
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
        const loginRes = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, machineId: 'smoke-test-pjn' }),
        });
        const loginData = await loginRes.json();
        if (!loginData.token) throw new Error('Login fallido: ' + (loginData.error || 'sin token'));

        const uploadRes = await fetch(`${API_URL}/admin/smoke-tests/report-pjn`, {
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
    console.log('  🧪 Smoke Test — Portal PJN (Completo)');
    console.log(`  ${new Date().toLocaleString('es-AR')}`);
    console.log('  Grupos: A (Acceso)  B (Listado)  C (Informe/Consulta)');
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
        // Grupo A
        const loginOk = await grupoA(page);

        if (!loginOk) {
            log('\n⛔ Sin sesión activa — se omiten Grupos B y C');
            skip('B — Módulo Listado (completo)', 'login fallido');
            skip('C — Módulo Informe (completo)', 'login fallido');
        } else {
            // Grupo B
            await grupoB(page).catch(err => fail('B — Error inesperado en Grupo B', err.message));

            // Grupo C
            await grupoC(page).catch(err => fail('C — Error inesperado en Grupo C', err.message));
        }

    } catch (err) {
        fail('Error inesperado', err.message);
    } finally {
        await browser.close();
    }

    // Resumen
    const duration = Date.now() - t0Total;
    const realChecks = checks.filter(c => c.ok !== null);
    const passed = realChecks.filter(c => c.ok).length;
    const total  = realChecks.length;
    const skipped = checks.filter(c => c.ok === null).length;

    log('\n─────────────────────────────────────────────────────────');
    log(`RESULTADO: ${passed}/${total} ${passed === total ? '✅' : '❌'}  —  duración: ${(duration / 1000).toFixed(1)}s${skipped ? `  —  ${skipped} omitidos` : ''}`);

    // Detalle de los que fallaron
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
