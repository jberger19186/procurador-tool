/**
 * smoke-test-pjn.js
 * Test integral del PJN: verifica el portal SCW (app Electron) y los 5 flujos
 * de la extensión Chrome. Un solo script alimenta las dos solapas del dashboard.
 *
 * Grupos:
 *   D — SCW Consulta + Secciones  ─── reporta a → "Portal PJN"
 *       Login SCW · recorre las 4 secciones del listado (LETRADO/PARTE/AUTORIZADO NE/FAVORITOS)
 *       con paginación real · verifica nav link "Nueva Consulta Pública" y formulario consulta
 *       → cubre todos los selectores de cs-scw.js para el flujo "consulta"
 *
 *   E — SCW Escritos 1 + Informe completo  ─── reporta a → "Portal PJN"
 *       Busca FCR 18745/2017 · datos generales · tabla actuaciones · paginación · históricas
 *       · tabs Intervinientes/Vinculados/Recursos · verifica botón "Presentar escrito"
 *       → cubre cs-scw.js flujo "escritos1" + todos los selectores del módulo informe
 *
 *   F — Escritos 2  → escritos.pjn.gov.ar/nuevo  (cs-escritos2.js) ─── reporta a → "Extensión Chrome"
 *       F1–F6: acceso + selectores MUI · F7–F9: rellena FCR 18745/2017 y verifica resultado
 *   G — Notificaciones → notif.pjn.gov.ar/nueva   (cs-notif.js)    ─── reporta a → "Extensión Chrome"
 *       G1–G6: acceso + selectores MUI · G7–G9: rellena FCR 18745/2017 y verifica resultado
 *   H — DEOX        → deox.pjn.gov.ar/nuevo       (cs-deox.js)     ─── reporta a → "Extensión Chrome"
 *       H1–H6: acceso + selectores · H7–H9: rellena FCR 18745/2017 (setReactVal) y verifica resultado
 *
 * URLs reales de la extensión (background.js FLOW_URLS):
 *   consulta/escritos1: https://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=225541
 *   escritos2:          https://escritos.pjn.gov.ar/nuevo
 *   notif:              https://notif.pjn.gov.ar/nueva
 *   deox:               https://deox.pjn.gov.ar/nuevo
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

// ── Configuración ──────────────────────────────────────────────────────────────
const CUIT        = '27320694359';
const API_URL     = process.env.API_URL || 'https://api.procuradortool.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || '';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');

// URLs exactas que usa la extensión (FLOW_URLS en background.js)
const SCW_URL       = 'https://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=225541';
const FAVORITOS_URL = 'http://scw.pjn.gov.ar/scw/consultaListaFavoritos.seam';
const ESCRITOS2_URL = 'https://escritos.pjn.gov.ar/nuevo';
const NOTIF_URL     = 'https://notif.pjn.gov.ar/nueva';
const DEOX_URL      = 'https://deox.pjn.gov.ar/nuevo';

// Expediente de referencia para la informe (módulo E)
const EXP_JURISDICCION = '14';   // FCR
const EXP_NUMERO       = '18745';
const EXP_ANIO         = '2017';

// ── Helpers ────────────────────────────────────────────────────────────────────
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

async function existeXPath(page, xpath) {
    return page.evaluate((xp) => {
        const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        return node !== null;
    }, xpath);
}

async function clickXPath(page, xpath) {
    return page.evaluate((xp) => {
        const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (node) { node.click(); return true; }
        return false;
    }, xpath);
}

/**
 * Navega a través de TODAS las páginas del paginador de LISTAS hasta la última.
 * Retorna el total de páginas recorridas.
 */
async function navegarTodasLasPaginasLista(page) {
    const tablaSelector = 'table.table-striped tbody';
    let paginas = 1;

    while (true) {
        const contenidoAntes = await page.$eval(tablaSelector, el => el.innerHTML).catch(() => null);
        if (!contenidoAntes) break;

        const haySiguiente = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.some(l => l.querySelector('span[title="Siguiente"]'));
        });
        if (!haySiguiente) break;

        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const link = links.find(l => l.querySelector('span[title="Siguiente"]'));
            if (link) link.click();
        });

        try {
            await page.waitForFunction(
                (sel, prev) => {
                    const el = document.querySelector(sel);
                    return el && el.innerHTML !== prev;
                },
                { timeout: 20000 },
                tablaSelector, contenidoAntes
            );
            paginas++;
        } catch {
            break;
        }
    }
    return paginas;
}

/** Navega a la siguiente página (mantener compatibilidad para actuaciones). */
async function paginaSiguienteLista(page) {
    const tablaSelector = 'table.table-striped tbody';
    const contenidoAntes = await page.$eval(tablaSelector, el => el.innerHTML).catch(() => null);
    if (!contenidoAntes) return null;

    const haySiguiente = await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
            if (link.querySelector('span[title="Siguiente"]')) return true;
        }
        return false;
    });
    if (!haySiguiente) return null;

    await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
            if (link.querySelector('span[title="Siguiente"]')) { link.click(); break; }
        }
    });

    try {
        await page.waitForFunction(
            (sel, prev) => {
                const el = document.querySelector(sel);
                return el && el.innerHTML !== prev;
            },
            { timeout: 20000 },
            tablaSelector, contenidoAntes
        );
        const paginaActual = await page.$eval('ul.pagination li.active span', el => el.textContent.trim()).catch(() => '?');
        return { ok: true, pagina: paginaActual };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/** Navega a la siguiente página en el paginador de ACTUACIONES del expediente. */
async function paginaSiguienteActuaciones(page, tablaSelector) {
    const contenidoAntes = await page.$eval(tablaSelector, el => el.innerText).catch(() => null);
    if (!contenidoAntes) return null;

    const boton = await page.$('li a span[title="Siguiente"]');
    if (!boton) return null;

    await page.evaluate(() => {
        const btn = document.querySelector('li a span[title="Siguiente"]');
        if (btn) btn.closest('a').click();
    });

    try {
        await page.waitForFunction(
            (sel, prev) => {
                const el = document.querySelector(sel);
                return el && el.innerText !== prev;
            },
            { timeout: 20000 },
            tablaSelector, contenidoAntes
        );
        const paginaActual = await page.$eval(
            '.pagination.no-margin.no-padding li.active span',
            el => el.textContent.trim()
        ).catch(() => '?');
        return { ok: true, pagina: paginaActual };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/** Hace click en el botón de sección (LETRADO/PARTE/AUTORIZADO NE), expandiendo el dropdown si es necesario. */
async function clickSeccionRelacionados(page, selector) {
    const visible = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
    }, selector);

    if (!visible) {
        const dropdown = await page.$('a.dropdown-toggle.menu-btn-border');
        if (dropdown) {
            await dropdown.click();
            await sleep(800);
            const submenu = await page.$('a[id*="btn-lista-relacionados"]');
            if (submenu) { await submenu.click(); await sleep(800); }
        }
    }

    const el = await page.$(selector);
    if (!el) return false;
    await el.click();
    return true;
}

/** Login SSO con el gestor de contraseñas de Chrome. */
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
 * Rellena el formulario MUI stepper de expediente (escritos2 y notif).
 * Replica exactamente lo que hace la extensión (cs-escritos2.js / cs-notif.js).
 * Retorna: { jurisdiccionOk, numOk, anioOk, resultadoTxt }
 *
 * IMPORTANTE — MUI Autocomplete renderiza en 2 fases:
 *   Fase 1: el <ul role="listbox"> aparece en el DOM
 *   Fase 2: los <li role="option"> se renderizan dentro del ul
 * Hay que usar waitForSelector para ambas fases en lugar de un sleep fijo.
 */
async function rellenarFormularioMUI(page, jurisdiccionLabel, numero, anio) {
    // 1) Focus + .value + input event (exactamente como cs-escritos2.js)
    await page.evaluate((label) => {
        const input = document.querySelector('input[role="combobox"][aria-autocomplete="list"]');
        if (!input) return;
        input.focus();
        input.value = label;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, jurisdiccionLabel);

    // 2) Esperar las 2 fases de render del dropdown MUI
    const listboxEl = await page.waitForSelector('ul[role="listbox"]', { timeout: 6000 }).catch(() => null);
    let jurisdiccionOk = false;
    if (listboxEl) {
        // Fase 2: esperar que los <li> aparezcan dentro del <ul>
        await page.waitForSelector('ul[role="listbox"] li[role="option"]', { timeout: 3000 }).catch(() => null);
        jurisdiccionOk = await page.evaluate((texto) => {
            const listbox = document.querySelector('ul[role="listbox"]');
            if (!listbox) return false;
            const items = listbox.querySelectorAll('li[role="option"]');
            const textoBuscar = texto.trim().toLowerCase();
            for (const item of items) {
                const t = item.innerText.trim().toLowerCase();
                // Mismo criterio que cs-escritos2.js: si alguno contiene el texto buscado
                if (t.includes(textoBuscar) || textoBuscar.includes(t.slice(0, 3))) {
                    item.click();
                    return true;
                }
            }
            if (items.length > 0) { items[0].click(); return true; }
            return false;
        }, jurisdiccionLabel);
    }
    await sleep(400);

    // 3) Rellenar número y año (.value + input, como cs-escritos2.js)
    await page.evaluate((num, yr) => {
        const numEl  = document.querySelector('input[name="numeroExpediente"]');
        const anioEl = document.querySelector('input[name="anioExpediente"]');
        if (numEl)  { numEl.value  = num;  numEl.dispatchEvent(new Event('input', { bubbles: true })); }
        if (anioEl) { anioEl.value = yr;   anioEl.dispatchEvent(new Event('input', { bubbles: true })); }
    }, numero, anio);
    await sleep(200);

    const numOk  = await page.$eval('input[name="numeroExpediente"]', el => el.value).catch(() => '') === numero;
    const anioOk = await page.$eval('input[name="anioExpediente"]',   el => el.value).catch(() => '') === anio;

    // 4) Click StepperNextBtn
    await page.evaluate(() => {
        const btn = document.querySelector('button#StepperNextBtn');
        if (btn) btn.click();
    });

    // 5) Cerrar alert "Se han encontrado N resultados" si aparece (cs-escritos2.js lo hace también)
    await page.waitForSelector('div[role="alert"] .MuiAlert-action button', { timeout: 2000 })
        .then(btn => btn.evaluate(el => { if (/cerrar/i.test(el.textContent)) el.click(); }))
        .catch(() => null);

    // 6) Esperar resultado (h5#simple-form-title)
    const resultEl = await page.waitForSelector('h5#simple-form-title', { timeout: 12000 }).catch(() => null);
    const resultadoTxt = resultEl
        ? await resultEl.evaluate(el => el.textContent.trim()).catch(() => '')
        : null;

    return { jurisdiccionOk, numOk, anioOk, resultadoTxt };
}

/**
 * Guarda un archivo de log local en electron-app/logs/
 */
function saveLogFile(logs, result) {
    try {
        const logDir = path.join(__dirname, '..', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const logFile = path.join(logDir, `smoke-pjn-${ts}.log`);
        const header = [
            '🧪 Smoke Test — Extensión Chrome',
            `Fecha:     ${new Date().toLocaleString('es-AR')}`,
            `Resultado: ${result.passed}/${result.total} ${result.ok ? '✅ PASS' : '❌ FAIL'}  —  ${(result.duration / 1000).toFixed(1)}s`,
            '',
        ];
        const fallidos = result.checks.filter(c => c.ok === false);
        if (fallidos.length > 0) {
            header.push('Checks fallidos:');
            fallidos.forEach(c => header.push(`  ❌ ${c.label}${c.error ? ': ' + c.error : ''}`));
            header.push('');
        }
        fs.writeFileSync(logFile, [...header, ...logs].join('\n'), 'utf8');
        console.log(`📄 Log guardado: ${logFile}`);
    } catch (err) {
        console.warn('⚠️  No se pudo guardar el log:', err.message);
    }
}

/**
 * Navega a un portal React del PJN y espera que el formulario esté listo.
 * Maneja SSO automáticamente (auto-login si la sesión Keycloak está activa).
 * Retorna: 'active' | 'logged-in' | 'no-password' | 'failed' | 'timeout'
 */
async function navegarPortalReact(page, url, formSelector) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });

    const estado = await Promise.race([
        page.waitForSelector('#username',  { timeout: 25000 }).then(() => 'login'),
        page.waitForSelector(formSelector, { timeout: 25000 }).then(() => 'form'),
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

// ── GRUPO D: SCW Consulta + Secciones ─────────────────────────────────────────
// Replica la navegación completa de cs-scw.js:
//   D1–D3: login SCW
//   D4:    header "Lista de Expedientes Relacionados"
//   D5–D8: recorre LETRADO / PARTE / AUTORIZADO NE / FAVORITOS con paginación real
//   D9:    nav link "Nueva Consulta Pública" presente
//   D10:   formulario consulta pública completo (camara + numero + anio + buscar)
async function grupoD(page) {
    log('\n══ GRUPO D — SCW Consulta + Secciones (cs-scw.js) ══════════');

    // D1: Portal SCW accesible
    await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    pass('D1 — scw.pjn.gov.ar accesible');

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
        pass('D4 — Header "Lista de Expedientes Relacionados" presente');
    } else {
        fail('D4 — Header inesperado', titulo.slice(0, 60));
        return false;
    }

    // D5–D8: Recorrer las 4 secciones con paginación
    const secciones = [
        { code: 5, tipo: 'LETRADO',      selector: 'input[value="LETRADO"]',      favoritos: false },
        { code: 6, tipo: 'PARTE',         selector: 'input[value="PARTE"]',         favoritos: false },
        { code: 7, tipo: 'AUTORIZADO NE', selector: 'input[value="AUTORIZADO NE"]', favoritos: false },
        { code: 8, tipo: 'FAVORITOS',     selector: null,                           favoritos: true  },
    ];

    for (const sec of secciones) {
        log(`\n── Sección: ${sec.tipo}`);
        try {
            if (sec.favoritos) {
                await page.goto(FAVORITOS_URL, { waitUntil: 'networkidle2', timeout: 30000 });
                await page.waitForFunction(
                    () => {
                        const sp = document.querySelector('span.colorTextGrey');
                        return sp && sp.textContent.includes('Favoritos');
                    },
                    { timeout: 10000 }
                ).catch(() => {});
            } else {
                const clickOk = await clickSeccionRelacionados(page, sec.selector);
                if (!clickOk) {
                    fail(`D${sec.code} — ${sec.tipo} — botón de sección no encontrado`);
                    continue;
                }
                await page.waitForFunction(
                    (sel) => {
                        const el = document.querySelector(sel);
                        return el && el.classList.contains('active');
                    },
                    { timeout: 15000 },
                    sec.selector
                ).catch(() => {});
                await sleep(1000);
            }

            // Contar expedientes totales (el contador existe aunque la tabla esté vacía)
            await sleep(800); // dar tiempo al AJAX de la sección
            const total = await page.$eval('div[class*="well"] strong', el => {
                const m = el.textContent.match(/(\d+)\s+expediente/);
                return m ? parseInt(m[1]) : -1;
            }).catch(() => -1);

            if (total === 0) {
                // Sección válida pero sin expedientes — no hay tabla y es esperado
                pass(`D${sec.code} — ${sec.tipo}`, '0 expedientes (sección vacía — OK)');
                continue;
            }

            const tablaPresente = await existe(page, 'table.table-striped tbody');
            if (!tablaPresente) {
                // Puede haber expedientes pero la tabla tardó — intentar esperar
                const tablaEl = await page.waitForSelector('table.table-striped tbody', { timeout: 8000 }).catch(() => null);
                if (!tablaEl) {
                    fail(`D${sec.code} — ${sec.tipo} — tabla no encontrada`, total >= 0 ? `contador=${total}` : '');
                    continue;
                }
            }

            const filas = await page.$$eval('table.table-striped tbody tr', rows =>
                rows.filter(r => r.cells.length > 0 && r.cells[0]?.textContent.trim() !== '').length
            ).catch(() => 0);

            // Paginar a través de TODAS las páginas numeradas hasta la última
            const hayUltima = await existe(page, 'a.last-page');
            if (hayUltima) {
                const totalPaginas = await navegarTodasLasPaginasLista(page);
                pass(`D${sec.code} — ${sec.tipo}`, `${total >= 0 ? total : '?'} exp · ${filas} filas/pág · ${totalPaginas} páginas recorridas`);
                // Volver a página 1
                const primera = await page.$('a.first-page');
                if (primera) { await primera.click(); await sleep(1500); }
            } else {
                pass(`D${sec.code} — ${sec.tipo}`, `${total >= 0 ? total : '?'} exp · ${filas} filas (1 sola página)`);
            }

        } catch (err) {
            fail(`D${sec.code} — ${sec.tipo} — error`, err.message.slice(0, 80));
        }
        await sleep(800);
    }

    // Volver a la lista principal para verificar el nav de consulta
    if (!page.url().includes('consultaListaRelacionados')) {
        await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector('h2.form_title', { timeout: 10000 }).catch(() => {});
    }

    // D9: Nav link "Nueva Consulta Pública"
    const navLink = await page.$('a[id$="menuNuevaConsulta"]');
    navLink
        ? pass('D9 — Nav link "Nueva Consulta Pública" presente')
        : fail('D9 — Nav link "Nueva Consulta Pública" no encontrado');

    // D10: Formulario consulta pública completo
    if (navLink) {
        await navLink.click();
        await sleep(1500);

        const fCamara    = await existe(page, '#formPublica\\:camaraNumAni');
        const fNumero    = await existe(page, 'input[name="formPublica:numero"]');
        const fAnio      = await existe(page, 'input[name="formPublica:anio"]');
        const fBtnBuscar = await existe(page, 'input[id$="buscarPorNumeroButton"]');
        if (fCamara && fNumero && fAnio && fBtnBuscar) {
            pass('D10 — Formulario consulta pública completo', 'camara + numero + anio + buscar ✓');
        } else {
            fail('D10 — Formulario incompleto', `cam=${fCamara} num=${fNumero} anio=${fAnio} btn=${fBtnBuscar}`);
        }
    } else {
        skip('D10 — Formulario consulta pública', 'nav link no encontrado');
    }

    return true;
}

// ── GRUPO E: SCW Escritos 1 + Informe completo ──────────────────────────────
// Replica los selectores de cs-scw.js flujo "escritos1" + todos los del módulo informe:
//   E1:    busca FCR 18745/2017 → aterriza en expediente.seam
//   E2:    legend.ui-fieldset-legend "Datos Generales"
//   E3:    #expediente:nuevoEscritoBtn a (Presentar escrito) → selector clave de escritos1
//   E4:    datos generales (detailCamera, detailDependencia, detailSituation, detailCover)
//   E5:    tabla actuaciones #expediente:action-table
//   E6:    paginador actuaciones
//   E7:    checkboxes filtros (DE / N / I / VT + btn Aplicar)
//   E8:    botón "Ver Históricas"
//   E9:    tabla históricas (o alerta "sin históricas")
//   E10:   paginador históricas
//   E11:   pestaña Intervinientes
//   E12:   pestaña Vinculados
//   E13:   pestaña Recursos
async function grupoE(page) {
    log('\n══ GRUPO E — SCW Escritos 1 + Informe completo (cs-scw.js) ═');

    // Si D dejó la página en el form de consulta, lo usamos; si no, volvemos al SCW
    const enFormConsulta = await existe(page, 'input[id$="buscarPorNumeroButton"]');
    if (!enFormConsulta) {
        await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        const navLink = await page.$('a[id$="menuNuevaConsulta"]').catch(() => null);
        if (!navLink) {
            fail('E1 — No se pudo navegar a "Consulta pública"');
            for (let i = 2; i <= 13; i++) skip(`E${i}`, 'sin acceso a formulario');
            return;
        }
        await navLink.click();
        await sleep(1500);
    }

    // E1: Buscar FCR 18745/2017 → expediente.seam
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
        for (let i = 2; i <= 13; i++) skip(`E${i}`, 'búsqueda fallida');
        return;
    }

    const urlActual = page.url();
    if (!urlActual.includes('expediente.seam')) {
        fail('E1 — No se llegó a expediente.seam', `URL: ${urlActual.slice(0, 80)}`);
        for (let i = 2; i <= 13; i++) skip(`E${i}`, 'sin expediente.seam');
        return;
    }
    pass('E1 — Llegó a expediente.seam correctamente');

    // E2: legend.ui-fieldset-legend "Datos Generales" (cs-scw.js escritos1 lo verifica)
    const legend = await page.waitForSelector('legend.ui-fieldset-legend', { timeout: 8000 }).catch(() => null);
    if (!legend) {
        fail('E2 — legend.ui-fieldset-legend no encontrado');
    } else {
        const legendText = await legend.evaluate(el => el.textContent.trim()).catch(() => '');
        legendText.includes('Datos')
            ? pass('E2 — legend.ui-fieldset-legend "Datos Generales"', legendText.slice(0, 40))
            : fail('E2 — legend texto inesperado', legendText.slice(0, 40));
    }

    // E3: #expediente:nuevoEscritoBtn a → selector crítico de cs-scw.js flujo escritos1
    const btnEscrito = await page.$('#expediente\\:nuevoEscritoBtn a').catch(() => null);
    if (!btnEscrito) {
        const contenedor = await existe(page, '#expediente\\:nuevoEscritoBtn');
        fail('E3 — #expediente:nuevoEscritoBtn a no encontrado', contenedor ? 'contenedor sin <a>' : 'contenedor ausente');
    } else {
        const btnText = await btnEscrito.evaluate(el => el.textContent.trim()).catch(() => '');
        pass('E3 — #expediente:nuevoEscritoBtn a (Presentar escrito)', btnText.slice(0, 40));
    }

    // E4: Datos generales
    const detCamera      = await existe(page, '[id$="detailCamera"]');
    const detDependencia = await existe(page, '[id$="detailDependencia"]');
    const detSituation   = await existe(page, '[id$="detailSituation"]');
    const detCover       = await existe(page, '[id$="detailCover"]');
    if (detCamera && detDependencia && detSituation && detCover) {
        const camText = await page.$eval('[id$="detailCamera"]',      el => el.textContent.trim()).catch(() => '');
        const depText = await page.$eval('[id$="detailDependencia"]', el => el.textContent.trim()).catch(() => '');
        pass('E4 — Datos generales expediente', `${camText} · ${depText}`.slice(0, 60));
    } else {
        fail('E4 — Datos generales incompletos', `cam=${detCamera} dep=${detDependencia} sit=${detSituation} cov=${detCover}`);
    }

    // E5: Tabla actuaciones actuales
    const tablaAct = '#expediente\\:action-table';
    const tablaActPresente = await existe(page, tablaAct);
    if (!tablaActPresente) {
        fail('E5 — Tabla actuaciones #expediente:action-table no encontrada');
    } else {
        const filasAct = await page.$$eval(`${tablaAct} tbody tr`, rows => rows.length).catch(() => 0);
        pass('E5 — Tabla actuaciones presente', `${filasAct} fila(s)`);
    }

    // E6: Paginador actuaciones
    const hayPagActuales = await existe(page, '.pagination.no-margin.no-padding li a span[title="Siguiente"]');
    if (hayPagActuales) {
        const res = await paginaSiguienteActuaciones(page, tablaAct);
        if (res && res.ok) {
            pass('E6 — Paginador actuaciones', `paginó a página ${res.pagina}`);
            await page.evaluate(() => {
                const btn = document.querySelector('li a span[title="Primera página"]');
                if (btn) btn.closest('a').click();
            });
            await sleep(2000);
        } else if (res && !res.ok) {
            fail('E6 — Paginador actuaciones — error', res.error?.slice(0, 80));
        } else {
            pass('E6 — Paginador actuaciones', 'botón Siguiente encontrado');
        }
    } else {
        pass('E6 — Paginador actuaciones', '1 sola página (OK)');
    }

    // E7: Checkboxes filtros
    const chkDE      = await existe(page, '#expediente\\:checkBoxDespachosYEscritosId');
    const chkN       = await existe(page, '#expediente\\:checkBoxnotaelEctronicasYPapelId');
    const chkI       = await existe(page, '#expediente\\:checkBoxInformacionesId');
    const chkVT      = await existe(page, '#expediente\\:checkBoxOtrasActuacionesId');
    const btnAplicar = await existe(page, '#expediente\\:filtrarActuacionesBtn');
    (chkDE && chkN && chkI && chkVT && btnAplicar)
        ? pass('E7 — Checkboxes filtros (DE + N + I + VT + Aplicar)')
        : fail('E7 — Checkboxes filtros incompletos', `DE=${chkDE} N=${chkN} I=${chkI} VT=${chkVT} btn=${btnAplicar}`);

    // E8: Botón "Ver Históricas"
    const tablaHist = '#expediente\\:action-historic-table';
    const btnHist = await page.$('#expediente\\:btnActuacionesHistoricas a');
    if (!btnHist) {
        fail('E8 — Botón "Ver Históricas" no encontrado');
        skip('E9 — Tabla históricas', 'botón no encontrado');
        skip('E10 — Paginador históricas', 'botón no encontrado');
    } else {
        pass('E8 — Botón "Ver Históricas" presente');
        await btnHist.click();
        await sleep(3000);

        // E9: Tabla históricas (o alerta "sin históricas")
        const alertaSinHist = await existe(page, 'div.alert.white-panel.border-grey-sm');
        if (alertaSinHist) {
            pass('E9 — Actuaciones históricas', 'sin históricas (alerta OK)');
            pass('E10 — Paginador históricas', 'n/a — sin históricas');
        } else {
            const tablaHistPresente = await existe(page, tablaHist);
            if (tablaHistPresente) {
                const filasHist = await page.$$eval(`${tablaHist} tbody tr`, rows => rows.length).catch(() => 0);
                pass('E9 — Tabla actuaciones históricas', `${filasHist} fila(s)`);

                // E10: Paginador históricas — usa getElementById (evita selector CSS inválido con ":")
                const haySigHist = await page.evaluate(() => {
                    const xpath = "//a[.//span[contains(text(), 'Siguiente')]]";
                    const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return r.singleNodeValue !== null;
                });
                if (haySigHist) {
                    // getElementById evita el problema de `:` en querySelector dentro de waitForFunction
                    const contenidoAntes = await page.evaluate(
                        () => (document.getElementById('expediente:action-historic-table') || {}).innerText || ''
                    );
                    await page.evaluate(() => {
                        const xpath = "//a[.//span[contains(text(), 'Siguiente')]]";
                        const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        if (r.singleNodeValue) r.singleNodeValue.click();
                    });
                    try {
                        await page.waitForFunction(
                            (prev) => {
                                const el = document.getElementById('expediente:action-historic-table');
                                return el && el.innerText !== prev;
                            },
                            { timeout: 20000 },
                            contenidoAntes
                        );
                        pass('E10 — Paginador históricas', 'paginó a página 2');
                    } catch (e) {
                        fail('E10 — Paginador históricas — timeout', e.message.slice(0, 60));
                    }
                } else {
                    pass('E10 — Paginador históricas', '1 sola página (OK)');
                }
            } else {
                fail('E9 — Tabla históricas no encontrada tras click');
                skip('E10 — Paginador históricas', 'tabla no encontrada');
            }
        }
    }

    // Volver a "Ver Actuales" antes de chequear las pestañas
    // (las pestañas rf-tab-hdr solo son visibles en la vista de actuaciones, no en históricas)
    const btnVerActuales = await page.$('a.btn.pull-right').catch(() => null);
    if (btnVerActuales) {
        const btnText = await btnVerActuales.evaluate(el => el.textContent.trim()).catch(() => '');
        if (btnText.toLowerCase().includes('actual')) {
            await btnVerActuales.click();
            await sleep(2000);
            log('E — Volvió a "Ver Actuales" para verificar pestañas');
        }
    }

    // E11–E13: Pestañas Intervinientes / Vinculados / Recursos
    const pestanas = [
        {
            label: 'Intervinientes',
            xpathTab: "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Intervinientes']]",
            tablas: ["[id='expediente:intervinientesTab']", "[id='expediente:participantsTable']", "[id='expediente:fiscalesTable']"],
            alertaXpath: null,
            checkNum: 'E11',
        },
        {
            label: 'Vinculados',
            xpathTab: "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Vinculados']]",
            tablas: ["[id='expediente:vinculadosTab']"],
            alertaXpath: "//*[starts-with(@id,'expediente:') and substring(@id,string-length(@id)-7)=':content']//div[contains(@class,'alert') and contains(.,'no posee vinculados')]",
            checkNum: 'E12',
        },
        {
            label: 'Recursos',
            xpathTab: "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Recursos']]",
            tablas: ["[id='expediente:recursosTab']"],
            alertaXpath: "//*[starts-with(@id,'expediente:') and substring(@id,string-length(@id)-7)=':content']//div[contains(@class,'alert') and contains(.,'no posee recursos')]",
            checkNum: 'E13',
        },
    ];

    for (const pesta of pestanas) {
        log(`\n── Pestaña: ${pesta.label}`);
        const tabVisible = await existeXPath(page, pesta.xpathTab);
        if (!tabVisible) {
            fail(`${pesta.checkNum} — Pestaña "${pesta.label}" — tab no encontrado`);
            continue;
        }
        await clickXPath(page, pesta.xpathTab);
        await sleep(2000);

        if (pesta.alertaXpath) {
            const hayAlerta = await existeXPath(page, pesta.alertaXpath);
            if (hayAlerta) {
                pass(`${pesta.checkNum} — Pestaña "${pesta.label}"`, `sin ${pesta.label.toLowerCase()} (alerta OK)`);
                continue;
            }
        }

        let tablaEncontrada = false;
        let tablaDetalle = '';
        for (const sel of pesta.tablas) {
            const tablaEl = await page.waitForSelector(sel, { timeout: 5000 }).catch(() => null);
            if (tablaEl) {
                const filas = await page.$$eval(`${sel} tbody tr`, rows => rows.length).catch(() => 0);
                tablaDetalle = `${sel.replace(/[\[\]']/g, '')} · ${filas} fila(s)`;
                tablaEncontrada = true;
                break;
            }
        }
        tablaEncontrada
            ? pass(`${pesta.checkNum} — Pestaña "${pesta.label}"`, tablaDetalle)
            : fail(`${pesta.checkNum} — Pestaña "${pesta.label}" — tabla no encontrada`);
    }
}

// ── GRUPO F: Escritos 2 ────────────────────────────────────────────────────────
// URL real de la extensión: https://escritos.pjn.gov.ar/nuevo
// cs-escritos2.js espera: combobox jurisdicción · input número · input año · StepperNextBtn
async function grupoF(page) {
    log('\n══ GRUPO F — Escritos 2 (escritos.pjn.gov.ar/nuevo, cs-escritos2.js) ══');

    log('F1 — Navegando a escritos.pjn.gov.ar/nuevo...');
    let estado;
    try {
        // La sesión SSO de Keycloak establecida en D debería permitir auto-login
        estado = await navegarPortalReact(
            page,
            ESCRITOS2_URL,   // https://escritos.pjn.gov.ar/nuevo
            'input[role="combobox"][aria-autocomplete="list"]'
        );
    } catch (err) {
        fail('F1 — Error al navegar', err.message.slice(0, 60));
        ['F2 — SSO/Sesión', 'F3 — Combobox jurisdicción', 'F4 — input número',
         'F5 — input año', 'F6 — button#StepperNextBtn'].forEach(l => skip(l, 'navegación fallida'));
        return;
    }

    pass('F1 — escritos.pjn.gov.ar/nuevo accesible');

    if (estado === 'no-password') {
        fail('F2 — Contraseña PJN no disponible');
        ['F3 — Combobox jurisdicción', 'F4 — input número', 'F5 — input año', 'F6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    if (estado === 'failed' || estado === 'timeout') {
        fail('F2 — SSO fallido o timeout esperando formulario', estado);
        ['F3 — Combobox jurisdicción', 'F4 — input número', 'F5 — input año', 'F6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    estado === 'active'
        ? pass('F2 — Sesión SSO activa (auto-login)')
        : pass('F2 — Login SSO exitoso');

    // F3–F6: Selectores del formulario MUI stepper
    const fJuris  = await existe(page, 'input[role="combobox"][aria-autocomplete="list"]');
    fJuris
        ? pass('F3 — Combobox jurisdicción presente', 'input[role="combobox"][aria-autocomplete="list"] ✓')
        : fail('F3 — Combobox jurisdicción no encontrado');

    // Breve pausa para que React termine de renderizar los demás campos
    await sleep(600);

    const fNumero = await existe(page, 'input[name="numeroExpediente"]');
    fNumero
        ? pass('F4 — input[name="numeroExpediente"] presente')
        : fail('F4 — input[name="numeroExpediente"] no encontrado');

    const fAnio = await existe(page, 'input[name="anioExpediente"]');
    fAnio
        ? pass('F5 — input[name="anioExpediente"] presente')
        : fail('F5 — input[name="anioExpediente"] no encontrado');

    const fBtn = await existe(page, 'button#StepperNextBtn');
    fBtn
        ? pass('F6 — button#StepperNextBtn presente')
        : fail('F6 — button#StepperNextBtn no encontrado');

    // F7–F9: Rellenar FCR 18745/2017 y verificar resultado end-to-end
    if (fJuris && fNumero && fAnio && fBtn) {
        log(`F7 — Rellenando FCR ${EXP_NUMERO}/${EXP_ANIO}...`);
        try {
            const res = await rellenarFormularioMUI(page, 'FCR', EXP_NUMERO, EXP_ANIO);
            res.jurisdiccionOk
                ? pass('F7 — Jurisdicción FCR seleccionada del dropdown')
                : fail('F7 — No se pudo seleccionar FCR del dropdown');
            (res.numOk && res.anioOk)
                ? pass('F8 — Campos número/año llenados', `${EXP_NUMERO}/${EXP_ANIO}`)
                : fail('F8 — Campos número/año incorrectos', `num=${res.numOk} anio=${res.anioOk}`);
            if (res.resultadoTxt !== null) {
                const encontrado = res.resultadoTxt.toLowerCase().includes('encontrado')
                                || res.resultadoTxt.toLowerCase().includes('seleccione');
                encontrado
                    ? pass('F9 — Resultado búsqueda expediente', res.resultadoTxt.slice(0, 60))
                    : fail('F9 — Resultado inesperado', res.resultadoTxt.slice(0, 60));
            } else {
                fail('F9 — h5#simple-form-title no apareció tras búsqueda');
            }
        } catch (err) {
            fail('F7 — Error al rellenar formulario', err.message.slice(0, 60));
            skip('F8 — Campos número/año', 'error en F7');
            skip('F9 — Resultado búsqueda', 'error en F7');
        }
    } else {
        skip('F7 — Rellenar FCR 18745/2017', 'formulario incompleto (F3-F6 fallidos)');
        skip('F8 — Campos número/año', 'formulario incompleto');
        skip('F9 — Resultado búsqueda', 'formulario incompleto');
    }
}

// ── GRUPO G: Notificaciones ────────────────────────────────────────────────────
// URL real de la extensión: https://notif.pjn.gov.ar/nueva
// cs-notif.js espera: combobox jurisdicción · input número · input año · StepperNextBtn
async function grupoG(page) {
    log('\n══ GRUPO G — Notificaciones (notif.pjn.gov.ar/nueva, cs-notif.js) ═══');

    log('G1 — Navegando a notif.pjn.gov.ar/nueva...');
    let estado;
    try {
        estado = await navegarPortalReact(
            page,
            NOTIF_URL,   // https://notif.pjn.gov.ar/nueva
            'input[role="combobox"][aria-autocomplete="list"]'
        );
    } catch (err) {
        fail('G1 — Error al navegar', err.message.slice(0, 60));
        ['G2 — SSO/Sesión', 'G3 — Combobox jurisdicción', 'G4 — input número',
         'G5 — input año', 'G6 — button#StepperNextBtn'].forEach(l => skip(l, 'navegación fallida'));
        return;
    }

    pass('G1 — notif.pjn.gov.ar/nueva accesible');

    if (estado === 'no-password') {
        fail('G2 — Contraseña PJN no disponible');
        ['G3 — Combobox jurisdicción', 'G4 — input número', 'G5 — input año', 'G6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    if (estado === 'failed' || estado === 'timeout') {
        fail('G2 — SSO fallido o timeout esperando formulario', estado);
        ['G3 — Combobox jurisdicción', 'G4 — input número', 'G5 — input año', 'G6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    estado === 'active'
        ? pass('G2 — Sesión SSO activa (auto-login)')
        : pass('G2 — Login SSO exitoso');

    // G3–G6: Mismos selectores que Escritos 2 (mismo componente React)
    const fJuris = await existe(page, 'input[role="combobox"][aria-autocomplete="list"]');
    fJuris
        ? pass('G3 — Combobox jurisdicción presente', 'input[role="combobox"][aria-autocomplete="list"] ✓')
        : fail('G3 — Combobox jurisdicción no encontrado');

    await sleep(600);

    const fNumero = await existe(page, 'input[name="numeroExpediente"]');
    fNumero
        ? pass('G4 — input[name="numeroExpediente"] presente')
        : fail('G4 — input[name="numeroExpediente"] no encontrado');

    const fAnio = await existe(page, 'input[name="anioExpediente"]');
    fAnio
        ? pass('G5 — input[name="anioExpediente"] presente')
        : fail('G5 — input[name="anioExpediente"] no encontrado');

    const fBtn = await existe(page, 'button#StepperNextBtn');
    fBtn
        ? pass('G6 — button#StepperNextBtn presente')
        : fail('G6 — button#StepperNextBtn no encontrado');

    // G7–G9: Rellenar FCR 18745/2017 y verificar resultado end-to-end
    if (fJuris && fNumero && fAnio && fBtn) {
        log(`G7 — Rellenando FCR ${EXP_NUMERO}/${EXP_ANIO}...`);
        try {
            const res = await rellenarFormularioMUI(page, 'FCR', EXP_NUMERO, EXP_ANIO);
            res.jurisdiccionOk
                ? pass('G7 — Jurisdicción FCR seleccionada del dropdown')
                : fail('G7 — No se pudo seleccionar FCR del dropdown');
            (res.numOk && res.anioOk)
                ? pass('G8 — Campos número/año llenados', `${EXP_NUMERO}/${EXP_ANIO}`)
                : fail('G8 — Campos número/año incorrectos', `num=${res.numOk} anio=${res.anioOk}`);
            if (res.resultadoTxt !== null) {
                const encontrado = res.resultadoTxt.toLowerCase().includes('encontrado')
                                || res.resultadoTxt.toLowerCase().includes('seleccione');
                encontrado
                    ? pass('G9 — Resultado búsqueda expediente', res.resultadoTxt.slice(0, 60))
                    : fail('G9 — Resultado inesperado', res.resultadoTxt.slice(0, 60));
            } else {
                fail('G9 — h5#simple-form-title no apareció tras búsqueda');
            }
        } catch (err) {
            fail('G7 — Error al rellenar formulario', err.message.slice(0, 60));
            skip('G8 — Campos número/año', 'error en G7');
            skip('G9 — Resultado búsqueda', 'error en G7');
        }
    } else {
        skip('G7 — Rellenar FCR 18745/2017', 'formulario incompleto (G3-G6 fallidos)');
        skip('G8 — Campos número/año', 'formulario incompleto');
        skip('G9 — Resultado búsqueda', 'formulario incompleto');
    }
}

// ── GRUPO H: DEOX ──────────────────────────────────────────────────────────────
// URL real de la extensión: https://deox.pjn.gov.ar/nuevo
// cs-deox.js espera: input[name="camara"] · input número · input año · StepperNextBtn
async function grupoH(page) {
    log('\n══ GRUPO H — DEOX (deox.pjn.gov.ar/nuevo, cs-deox.js) ═════');

    log('H1 — Navegando a deox.pjn.gov.ar/nuevo...');
    let estado;
    try {
        estado = await navegarPortalReact(
            page,
            DEOX_URL,    // https://deox.pjn.gov.ar/nuevo
            'input[name="camara"]'
        );
    } catch (err) {
        fail('H1 — Error al navegar', err.message.slice(0, 60));
        ['H2 — SSO/Sesión', 'H3 — input[name="camara"]', 'H4 — input número',
         'H5 — input año', 'H6 — button#StepperNextBtn'].forEach(l => skip(l, 'navegación fallida'));
        return;
    }

    pass('H1 — deox.pjn.gov.ar/nuevo accesible');

    if (estado === 'no-password') {
        fail('H2 — Contraseña PJN no disponible');
        ['H3 — input[name="camara"]', 'H4 — input número', 'H5 — input año', 'H6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    if (estado === 'failed' || estado === 'timeout') {
        fail('H2 — SSO fallido o timeout esperando formulario', estado);
        ['H3 — input[name="camara"]', 'H4 — input número', 'H5 — input año', 'H6 — button#StepperNextBtn']
            .forEach(l => skip(l, 'sin sesión'));
        return;
    }
    estado === 'active'
        ? pass('H2 — Sesión SSO activa (auto-login)')
        : pass('H2 — Login SSO exitoso');

    // H3: input[name="camara"] — selector diferenciador del DEOX vs escritos/notif
    const fCamara = await existe(page, 'input[name="camara"]');
    fCamara
        ? pass('H3 — input[name="camara"] (jurisdicción) presente')
        : fail('H3 — input[name="camara"] no encontrado');

    await sleep(600);

    const fNumero = await existe(page, 'input[name="numeroExpediente"]');
    fNumero
        ? pass('H4 — input[name="numeroExpediente"] presente')
        : fail('H4 — input[name="numeroExpediente"] no encontrado');

    const fAnio = await existe(page, 'input[name="anioExpediente"]');
    fAnio
        ? pass('H5 — input[name="anioExpediente"] presente')
        : fail('H5 — input[name="anioExpediente"] no encontrado');

    const fBtn = await existe(page, 'button#StepperNextBtn');
    fBtn
        ? pass('H6 — button#StepperNextBtn presente')
        : fail('H6 — button#StepperNextBtn no encontrado');

    // H7–H9: Rellenar FCR 18745/2017 y verificar resultado end-to-end
    // DEOX: input[name="camara"] es un Autocomplete MUI que acepta la SIGLA ("FCR"),
    // necesita focus + mousedown + setReactVal (native setter) y luego esperar listbox.
    // Replica exactamente cs-deox.js líneas 143-169.
    const EXP_SIGLA = 'FCR'; // sigla corta, NO el código numérico "14"
    if (fCamara && fNumero && fAnio && fBtn) {
        log(`H7 — Rellenando FCR ${EXP_NUMERO}/${EXP_ANIO} en DEOX...`);
        try {
            // Focus + mousedown + setReactVal con la sigla (como cs-deox.js)
            await page.evaluate(() => {
                const camaraEl = document.querySelector('input[name="camara"]');
                if (!camaraEl) return;
                camaraEl.focus();
                camaraEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            });
            await sleep(150);
            await page.evaluate((sigla) => {
                const setter   = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                const camaraEl = document.querySelector('input[name="camara"]');
                if (!camaraEl) return;
                setter.call(camaraEl, sigla);
                camaraEl.dispatchEvent(new Event('input', { bubbles: true }));
            }, EXP_SIGLA);

            // Esperar las 2 fases de render del listbox MUI (igual que rellenarFormularioMUI)
            const listboxH = await page.waitForSelector('ul[role="listbox"]', { timeout: 4000 }).catch(() => null);
            let camaraOk = false;
            if (listboxH) {
                await page.waitForSelector('ul[role="listbox"] li[role="option"]', { timeout: 2000 }).catch(() => null);
                camaraOk = await page.evaluate(() => {
                    const listbox = document.querySelector('ul[role="listbox"]');
                    if (!listbox) return false;
                    const items = listbox.querySelectorAll('li[role="option"]');
                    if (items.length > 0) { items[0].click(); return true; }
                    return false;
                });
            }
            await sleep(300);

            // Verificar que camara tiene algún valor (después de la selección tendrá el texto del item)
            const camaraVal = await page.$eval('input[name="camara"]', el => el.value).catch(() => '');
            camaraOk && camaraVal
                ? pass('H7 — input[name="camara"] seleccionado del dropdown', `"${camaraVal.slice(0, 30)}"`)
                : fail('H7 — No se pudo seleccionar jurisdicción en DEOX', camaraVal ? `val="${camaraVal}"` : 'listbox no apareció');

            // Rellenar número y año
            await page.evaluate((num, yr) => {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                const numEl  = document.querySelector('input[name="numeroExpediente"]');
                const anioEl = document.querySelector('input[name="anioExpediente"]');
                if (numEl)  { numEl.focus();  setter.call(numEl,  num); numEl.dispatchEvent(new Event('input', { bubbles: true })); }
                if (anioEl) { anioEl.focus(); setter.call(anioEl, yr);  anioEl.dispatchEvent(new Event('input', { bubbles: true })); }
            }, EXP_NUMERO, EXP_ANIO);
            await sleep(200);

            const numVal  = await page.$eval('input[name="numeroExpediente"]', el => el.value).catch(() => '');
            const anioVal = await page.$eval('input[name="anioExpediente"]',   el => el.value).catch(() => '');
            (numVal === EXP_NUMERO && anioVal === EXP_ANIO)
                ? pass('H8 — Campos número/año llenados', `${EXP_NUMERO}/${EXP_ANIO}`)
                : fail('H8 — Campos número/año incorrectos', `num="${numVal}" anio="${anioVal}"`);

            // Click StepperNextBtn + cerrar alert + esperar resultado
            await page.evaluate(() => {
                const btn = document.querySelector('button#StepperNextBtn');
                if (btn) btn.click();
            });
            await page.waitForSelector('div[role="alert"] .MuiAlert-action button', { timeout: 2000 })
                .then(btn => btn.evaluate(el => { if (/cerrar/i.test(el.textContent)) el.click(); }))
                .catch(() => null);

            const resultEl = await page.waitForSelector('h5#simple-form-title', { timeout: 12000 }).catch(() => null);
            const resultadoTxt = resultEl
                ? await resultEl.evaluate(el => el.textContent.trim()).catch(() => '')
                : null;

            if (resultadoTxt !== null) {
                const encontrado = resultadoTxt.toLowerCase().includes('encontrado')
                                || resultadoTxt.toLowerCase().includes('seleccione');
                encontrado
                    ? pass('H9 — Resultado búsqueda expediente', resultadoTxt.slice(0, 60))
                    : fail('H9 — Resultado inesperado', resultadoTxt.slice(0, 60));
            } else {
                fail('H9 — h5#simple-form-title no apareció tras búsqueda');
            }
        } catch (err) {
            fail('H7 — Error al rellenar formulario DEOX', err.message.slice(0, 60));
            skip('H8 — Campos número/año', 'error en H7');
            skip('H9 — Resultado búsqueda', 'error en H7');
        }
    } else {
        skip('H7 — Rellenar FCR 18745/2017', 'formulario incompleto (H3-H6 fallidos)');
        skip('H8 — Campos número/año', 'formulario incompleto');
        skip('H9 — Resultado búsqueda', 'formulario incompleto');
    }
}

// ── Subir resultados al dashboard ──────────────────────────────────────────────
// D+E → report-pjn  (solapa "Portal PJN")
// F+G+H → report-extension  (solapa "Extensión Chrome")
async function uploadResults(allChecks, logs, duration) {
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

        // Separar checks: D+E → PJN,  F+G+H → Extensión
        const pjnChecks = allChecks.filter(c => /^[DE]\d/.test(c.label));
        const extChecks = allChecks.filter(c => /^[FGH]\d/.test(c.label));

        const makeResult = (subset) => {
            const real   = subset.filter(c => c.ok !== null);
            const passed = real.filter(c => c.ok).length;
            return { passed, total: real.length, ok: passed === real.length, duration, checks: subset, logs };
        };

        const endpoints = [
            { url: `${API_URL}/admin/smoke-tests/report-pjn`,      result: makeResult(pjnChecks), name: 'Portal PJN' },
            { url: `${API_URL}/admin/smoke-tests/report-extension`, result: makeResult(extChecks), name: 'Extensión Chrome' },
        ];

        for (const ep of endpoints) {
            const res  = await fetch(ep.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.token}` },
                body: JSON.stringify({ result: ep.result }),
            });
            const data = await res.json();
            data.success
                ? console.log(`✅ ${ep.name}: resultados subidos al dashboard.`)
                : console.log(`⚠️  ${ep.name}: no se pudieron subir:`, data.error);
        }
    } catch (err) {
        console.log('⚠️  Error al subir resultados:', err.message);
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🧪 Smoke Test PJN — Portal SCW + 5 flujos Extensión Chrome');
    console.log(`  ${new Date().toLocaleString('es-AR')}`);
    console.log('  D+E → Portal PJN:      SCW login · 4 secciones · informe FCR 18745/2017');
    console.log('  F+G+H → Extensión:     escritos · notif · DEOX  (relleno FCR 18745/2017)');
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

    // ── Handler de diálogos del navegador ─────────────────────────────────────
    // Los portales React (escritos/notif/deox) muestran "¿Deseas abandonar el sitio?"
    // al navegar entre ellos. Aceptamos automáticamente para permitir la navegación.
    page.on('dialog', async (dialog) => {
        if (dialog.type() === 'beforeunload') {
            await dialog.accept();
        } else {
            // alert/confirm/prompt del PJN: aceptar para no bloquear el script
            await dialog.accept();
        }
    });

    try {
        // D: Login SCW + recorre 4 secciones + formulario consulta
        const ssoOk = await grupoD(page).catch(err => { fail('D — Error inesperado', err.message); return false; });

        if (!ssoOk) {
            skip('E — SCW Escritos 1 + Informe', 'sin sesión SCW');
        } else {
            // E: Informe completo + verificación de escritos1
            await grupoE(page).catch(err => fail('E — Error inesperado', err.message));
        }

        // F/G/H: Portales React independientes
        // La sesión Keycloak de D/E debería permitir auto-login en estos portales
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
    await uploadResults(checks, logs, duration);
    saveLogFile(logs, result);

    process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
    console.error('❌ Error fatal:', err.message);
    process.exit(1);
});
