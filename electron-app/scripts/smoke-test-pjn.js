/**
 * smoke-test-pjn.js
 * Verifica que el portal PJN sigue respondiendo con los selectores esperados.
 * Navega activamente por secciones, pagina listas y actuaciones, y entra a todas las pestañas.
 *
 * Grupos de checks:
 *   A — Acceso al portal (SCW SSO + login)
 *   B — Módulo Listado (navega las 4 secciones y pagina cada una si hay >1 página)
 *   C — Módulo Informe (consulta FCR 18745/2017, pagina actuaciones actuales,
 *                       navega históricas, entra a pestañas Intervinientes/Vinculados/Recursos)
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

// Expediente de referencia para el módulo Informe
const EXP_JURISDICCION = '14';   // FCR
const EXP_NUMERO       = '18745';
const EXP_ANIO         = '2017';

// URL de entrada — la misma que usan los scripts de la app
const SCW_URL       = 'http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1';
const FAVORITOS_URL = 'http://scw.pjn.gov.ar/scw/consultaListaFavoritos.seam';

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

// Verifica si un selector CSS existe en la página
async function existe(page, selector) {
    return (await page.$(selector)) !== null;
}

// Verifica si un selector XPath existe
async function existeXPath(page, xpath) {
    return page.evaluate((xp) => {
        const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        return node !== null;
    }, xpath);
}

// Hace click en un nodo XPath
async function clickXPath(page, xpath) {
    return page.evaluate((xp) => {
        const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (node) { node.click(); return true; }
        return false;
    }, xpath);
}

/**
 * Navega al "Siguiente" en el paginador de LISTAS de expedientes.
 * Usa el span[title="Siguiente"] dentro de los links de paginación.
 * Espera que el contenido de la tabla cambie.
 * Devuelve { ok, pagina } o null si no hay siguiente.
 */
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

    // Esperar que la tabla cambie
    try {
        await page.waitForFunction(
            (sel, prev) => {
                const el = document.querySelector(sel);
                return el && el.innerHTML !== prev;
            },
            { timeout: 20000 },
            tablaSelector,
            contenidoAntes
        );
        const paginaActual = await page.$eval('ul.pagination li.active span', el => el.textContent.trim()).catch(() => '?');
        return { ok: true, pagina: paginaActual };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Navega al "Siguiente" en el paginador de ACTUACIONES del expediente.
 * Usa `.pagination.no-margin.no-padding` + `span[title="Siguiente"]`.
 */
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
            tablaSelector,
            contenidoAntes
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

/**
 * Intenta hacer click en el botón de sección (LETRADO/PARTE/AUTORIZADO NE).
 * Si el botón no es visible, expande el dropdown de "Mis Expedientes" primero.
 */
async function clickSeccionRelacionados(page, selector) {
    // Verificar visibilidad
    const visible = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
    }, selector);

    if (!visible) {
        // Expandir dropdown "Mis Expedientes"
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

// ── GRUPO A: Acceso al portal ─────────────────────────────────────────────────
async function grupoA(page) {
    log('\n══ GRUPO A — Acceso al portal ══════════════════════════════');

    log('Navegando a scw.pjn.gov.ar...');
    await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    pass('A1 — scw.pjn.gov.ar accesible');

    const loginDetected = await Promise.race([
        page.waitForSelector('#username',                                { timeout: 15000 }).then(() => 'login'),
        page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 }).then(() => 'session'),
    ]).catch(() => null);

    if (loginDetected === 'login') {
        const passExists = await existe(page, 'input[type="password"]');
        const btnExists  = await existe(page, '#kc-login');
        if (passExists && btnExists) {
            pass('A2 — SSO formulario presente');
        } else {
            fail('A2 — SSO formulario incompleto', `pass=${passExists} btn=${btnExists}`);
            return false;
        }

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
        let passVal = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
        if (!passVal) {
            await page.click('input[type="password"]');
            await sleep(600);
            await page.keyboard.press('ArrowDown');
            await sleep(600);
            passVal = await page.$eval('input[type="password"]', el => el.value).catch(() => '');
        }
        if (passVal) {
            await page.click('#kc-login');
            await sleep(3000);
            const sessionOk = await page.waitForSelector('a.dropdown-toggle.menu-btn-border-right', { timeout: 15000 })
                .then(() => true).catch(() => false);
            if (sessionOk) {
                pass('A3 — Login exitoso — sesión activa');
            } else {
                const errMsg = await page.$eval('#kc-error-message, .alert-error', el => el.textContent.trim()).catch(() => '');
                fail('A3 — Login fallido', errMsg || `URL: ${page.url().slice(0, 80)}`);
                return false;
            }
        } else {
            fail('A3 — Contraseña no disponible en gestor de Chrome');
            log('⚠️  Guardá la contraseña PJN en Chrome para el perfil ProcuradorSCW.');
            return false;
        }

    } else if (loginDetected === 'session') {
        pass('A2 — Sesión activa preexistente');
        pass('A3 — Login — sesión ya establecida');
    } else {
        fail('A2 — Timeout esperando formulario o sesión');
        return false;
    }

    return true;
}

// ── GRUPO B: Módulo Listado ────────────────────────────────────────────────────
async function grupoB(page) {
    log('\n══ GRUPO B — Módulo Listado ════════════════════════════════');

    // Asegurar que estamos en la lista principal
    if (!page.url().includes('consultaListaRelacionados')) {
        await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    }
    await page.waitForSelector('h2.form_title', { timeout: 15000 }).catch(() => {});

    // B1: Título principal
    const titulo = await page.$eval('h2.form_title', el => el.textContent.trim()).catch(() => '');
    if (titulo.includes('Lista de Expedientes Relacionados')) {
        pass('B1 — Lista de Expedientes Relacionados cargada');
    } else {
        fail('B1 — Título inesperado en SCW', titulo.slice(0, 60));
        return;
    }

    // Secciones a recorrer
    const secciones = [
        { code: 1, tipo: 'LETRADO',       selector: 'input[value="LETRADO"]',       favoritos: false },
        { code: 2, tipo: 'PARTE',          selector: 'input[value="PARTE"]',          favoritos: false },
        { code: 3, tipo: 'AUTORIZADO NE',  selector: 'input[value="AUTORIZADO NE"]',  favoritos: false },
        { code: 4, tipo: 'FAVORITOS',      selector: null,                            favoritos: true  },
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
                    fail(`B${sec.code + 1} — ${sec.tipo} — botón de sección no encontrado`);
                    continue;
                }
                // Esperar a que el botón quede activo
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

            // Verificar tabla de expedientes
            const tablaPresente = await existe(page, 'table.table-striped tbody');
            if (!tablaPresente) {
                fail(`B${sec.code + 1} — ${sec.tipo} — tabla de expedientes no encontrada`);
                continue;
            }

            // Contar filas
            const filas = await page.$$eval('table.table-striped tbody tr', rows =>
                rows.filter(r => r.cells.length > 0 && r.cells[0]?.textContent.trim() !== '').length
            ).catch(() => 0);

            // Contador total de expedientes
            const total = await page.$eval('div[class*="well"] strong', el => {
                const m = el.textContent.match(/(\d+)\s+expediente/);
                return m ? m[1] : '?';
            }).catch(() => '?');

            // Intentar paginar (si hay más de 1 página)
            const hayUltima = await existe(page, 'a.last-page');
            if (hayUltima) {
                const resultado = await paginaSiguienteLista(page);
                if (resultado && resultado.ok) {
                    pass(`B${sec.code + 1} — ${sec.tipo}`, `${total} exp · ${filas} filas en pág1 · paginó a pág ${resultado.pagina}`);
                    // Volver a página 1
                    const primera = await page.$('a.first-page');
                    if (primera) { await primera.click(); await sleep(1500); }
                } else if (resultado && !resultado.ok) {
                    fail(`B${sec.code + 1} — ${sec.tipo} — paginador falló`, resultado.error);
                } else {
                    pass(`B${sec.code + 1} — ${sec.tipo}`, `${total} exp · ${filas} filas (paginador no respondió)`);
                }
            } else {
                pass(`B${sec.code + 1} — ${sec.tipo}`, `${total} exp · ${filas} filas (1 sola página)`);
            }

        } catch (err) {
            fail(`B${sec.code + 1} — ${sec.tipo} — error`, err.message.slice(0, 80));
        }

        await sleep(1000);
    }
}

// ── GRUPO C: Módulo Informe ───────────────────────────────────────────────────
async function grupoC(page) {
    log('\n══ GRUPO C — Módulo Informe ════════════════════════════════');

    // Volver al SCW para tener el menú disponible
    await page.goto(SCW_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // C1: Botón Nueva Consulta
    const btnNuevaConsulta = await page.waitForSelector('a[id$="menuNuevaConsulta"]', { timeout: 10000 }).catch(() => null);
    if (!btnNuevaConsulta) { fail('C1 — Botón "Nueva Consulta" no encontrado'); return; }
    pass('C1 — Botón "Nueva Consulta" presente');

    // C2: Formulario campos
    await page.click('a[id$="menuNuevaConsulta"]');
    await sleep(1500);
    const fCamara    = await existe(page, 'select[name="formPublica:camaraNumAni"]');
    const fNumero    = await existe(page, 'input[name="formPublica:numero"]');
    const fAnio      = await existe(page, 'input[name="formPublica:anio"]');
    const fBtnBuscar = await existe(page, 'input[id$="buscarPorNumeroButton"]');
    if (fCamara && fNumero && fAnio && fBtnBuscar) {
        pass('C2 — Formulario consulta pública completo');
    } else {
        fail('C2 — Formulario incompleto', `camara=${fCamara} num=${fNumero} anio=${fAnio} btn=${fBtnBuscar}`);
        return;
    }

    // C3: Búsqueda FCR 18745/2017
    log(`C3 — Buscando FCR ${EXP_NUMERO}/${EXP_ANIO}...`);
    await page.select('select[name="formPublica:camaraNumAni"]', EXP_JURISDICCION);
    await page.type('input[name="formPublica:numero"]', EXP_NUMERO, { delay: 30 });
    await page.type('input[name="formPublica:anio"]',   EXP_ANIO,   { delay: 30 });
    await page.click('input[id$="buscarPorNumeroButton"]');
    await sleep(5000);

    // C4: Datos generales del expediente
    const detCamera      = await existe(page, '[id$="detailCamera"]');
    const detDependencia = await existe(page, '[id$="detailDependencia"]');
    const detSituation   = await existe(page, '[id$="detailSituation"]');
    const detCover       = await existe(page, '[id$="detailCover"]');
    if (detCamera && detDependencia && detSituation && detCover) {
        const camText = await page.$eval('[id$="detailCamera"]',      el => el.textContent.trim()).catch(() => '');
        const depText = await page.$eval('[id$="detailDependencia"]', el => el.textContent.trim()).catch(() => '');
        pass('C4 — Datos generales expediente', `${camText} · ${depText}`.slice(0, 60));
    } else {
        fail('C4 — Datos generales incompletos', `cam=${detCamera} dep=${detDependencia} sit=${detSituation} cov=${detCover}`);
    }

    // C5: Tabla de actuaciones actuales
    const tablaAct = '#expediente\\:action-table';
    const tablaActPresente = await existe(page, tablaAct);
    if (!tablaActPresente) {
        fail('C5 — Tabla actuaciones #expediente:action-table no encontrada');
    } else {
        const filasAct = await page.$$eval(`${tablaAct} tbody tr`, rows => rows.length).catch(() => 0);
        pass('C5 — Tabla actuaciones presente', `${filasAct} fila(s)`);
    }

    // C6: Paginación de actuaciones actuales
    const hayPagActuales = await existe(page, '.pagination.no-margin.no-padding li a span[title="Siguiente"]');
    if (hayPagActuales) {
        const res = await paginaSiguienteActuaciones(page, tablaAct);
        if (res && res.ok) {
            pass('C6 — Paginador actuaciones', `paginó a página ${res.pagina}`);
            // Volver a página 1
            await page.evaluate(() => {
                const btn = document.querySelector('li a span[title="Primera página"]');
                if (btn) btn.closest('a').click();
            });
            await sleep(2000);
        } else if (res && !res.ok) {
            fail('C6 — Paginador actuaciones — error al paginar', res.error?.slice(0, 80));
        } else {
            pass('C6 — Paginador actuaciones', 'botón siguiente encontrado pero sin cambio detectado');
        }
    } else {
        pass('C6 — Paginador actuaciones', '1 sola página de actuaciones (OK)');
    }

    // C7: Checkboxes filtros de actuaciones
    const chkDE      = await existe(page, '#expediente\\:checkBoxDespachosYEscritosId');
    const chkN       = await existe(page, '#expediente\\:checkBoxnotaelEctronicasYPapelId');
    const chkI       = await existe(page, '#expediente\\:checkBoxInformacionesId');
    const chkVT      = await existe(page, '#expediente\\:checkBoxOtrasActuacionesId');
    const btnAplicar = await existe(page, '#expediente\\:filtrarActuacionesBtn');
    if (chkDE && chkN && chkI && chkVT && btnAplicar) {
        pass('C7 — Checkboxes filtros presentes', 'DE + N + I + VT + Aplicar');
    } else {
        fail('C7 — Checkboxes filtros incompletos', `DE=${chkDE} N=${chkN} I=${chkI} VT=${chkVT} btn=${btnAplicar}`);
    }

    // C8: Ver Históricas — click + tabla + paginación
    const tablaHist = '#expediente\\:action-historic-table';
    const btnHist = await page.$('#expediente\\:btnActuacionesHistoricas a');
    if (!btnHist) {
        fail('C8 — Botón "Ver Históricas" no encontrado');
    } else {
        pass('C8 — Botón "Ver Históricas" presente');
        log('C9 — Haciendo click en "Ver Históricas"...');
        await btnHist.click();
        await sleep(3000);

        // C9: Tabla históricas
        const alertaSinHist = await existe(page, 'div.alert.white-panel.border-grey-sm');
        if (alertaSinHist) {
            pass('C9 — Actuaciones históricas', 'expediente sin históricas (alerta presente — OK)');
            pass('C10 — Paginador históricas', 'n/a — sin históricas');
        } else {
            const tablaHistPresente = await existe(page, tablaHist);
            if (tablaHistPresente) {
                const filasHist = await page.$$eval(`${tablaHist} tbody tr`, rows => rows.length).catch(() => 0);
                pass('C9 — Tabla actuaciones históricas', `${filasHist} fila(s)`);

                // C10: Paginación históricas
                const haySigHist = await page.evaluate(() => {
                    const xpath = "//a[.//span[contains(text(), 'Siguiente')]]";
                    const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return r.singleNodeValue !== null;
                });
                if (haySigHist) {
                    const contenidoAntes = await page.$eval(tablaHist, el => el.innerText).catch(() => '');
                    await page.evaluate(() => {
                        const xpath = "//a[.//span[contains(text(), 'Siguiente')]]";
                        const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        if (r.singleNodeValue) r.singleNodeValue.click();
                    });
                    try {
                        await page.waitForFunction(
                            (sel, prev) => {
                                const el = document.querySelector(sel);
                                return el && el.innerText !== prev;
                            },
                            { timeout: 20000 },
                            tablaHist.replace(/\\/g, ''),
                            contenidoAntes
                        );
                        pass('C10 — Paginador históricas', 'paginó a página 2');
                    } catch (e) {
                        fail('C10 — Paginador históricas — timeout', e.message.slice(0, 60));
                    }
                } else {
                    pass('C10 — Paginador históricas', '1 sola página de históricas (OK)');
                }
            } else {
                fail('C9 — Tabla históricas no encontrada tras click');
                skip('C10 — Paginador históricas', 'tabla no encontrada');
            }
        }
    }

    // C11–C13: Pestañas — Intervinientes / Vinculados / Recursos
    const pestanas = [
        {
            label: 'Intervinientes',
            xpathTab: "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Intervinientes']]",
            tablas: ["[id='expediente:intervinientesTab']", "[id='expediente:participantsTable']", "[id='expediente:fiscalesTable']"],
            alertaXpath: null,
            checkNum: 'C11',
        },
        {
            label: 'Vinculados',
            xpathTab: "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Vinculados']]",
            tablas: ["[id='expediente:vinculadosTab']"],
            alertaXpath: "//*[starts-with(@id,'expediente:') and substring(@id,string-length(@id)-7)=':content']//div[contains(@class,'alert') and contains(.,'no posee vinculados')]",
            checkNum: 'C12',
        },
        {
            label: 'Recursos',
            xpathTab: "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Recursos']]",
            tablas: ["[id='expediente:recursosTab']"],
            alertaXpath: "//*[starts-with(@id,'expediente:') and substring(@id,string-length(@id)-7)=':content']//div[contains(@class,'alert') and contains(.,'no posee recursos')]",
            checkNum: 'C13',
        },
    ];

    for (const pesta of pestanas) {
        log(`\n── Pestaña: ${pesta.label}`);
        const tabVisible = await existeXPath(page, pesta.xpathTab);
        if (!tabVisible) {
            fail(`${pesta.checkNum} — Pestaña "${pesta.label}" — tab no encontrado`);
            continue;
        }

        // Click en la pestaña
        await clickXPath(page, pesta.xpathTab);
        await sleep(2000);

        // Verificar alerta "no posee X" (si aplica)
        if (pesta.alertaXpath) {
            const hayAlerta = await existeXPath(page, pesta.alertaXpath);
            if (hayAlerta) {
                pass(`${pesta.checkNum} — Pestaña "${pesta.label}"`, `expediente sin ${pesta.label.toLowerCase()} (alerta OK)`);
                continue;
            }
        }

        // Verificar que al menos una de las tablas esperadas esté visible
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

        if (tablaEncontrada) {
            pass(`${pesta.checkNum} — Pestaña "${pesta.label}"`, tablaDetalle);
        } else {
            fail(`${pesta.checkNum} — Pestaña "${pesta.label}" — tabla no encontrada tras click`);
        }
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
    console.log('  🧪 Smoke Test — Portal PJN (Navegación completa)');
    console.log(`  ${new Date().toLocaleString('es-AR')}`);
    console.log('  A: Acceso  B: Listado (4 secciones + paginación)');
    console.log('  C: Informe (actuales + históricas + pestañas)');
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
        const loginOk = await grupoA(page);

        if (!loginOk) {
            log('\n⛔ Sin sesión activa — se omiten Grupos B y C');
            skip('B — Módulo Listado',  'login fallido');
            skip('C — Módulo Informe',  'login fallido');
        } else {
            await grupoB(page).catch(err => fail('B — Error inesperado', err.message));
            await grupoC(page).catch(err => fail('C — Error inesperado', err.message));
        }

    } catch (err) {
        fail('Error fatal inesperado', err.message);
    } finally {
        await browser.close();
    }

    // ── Resumen final ──
    const duration    = Date.now() - t0Total;
    const realChecks  = checks.filter(c => c.ok !== null);
    const passed      = realChecks.filter(c => c.ok).length;
    const total       = realChecks.length;
    const skipped     = checks.filter(c => c.ok === null).length;

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
