/**
 * testm1.js
 * Módulo que contiene funciones para configurar el navegador, iniciar sesión,
 * ordenar y extraer expedientes, controlar duplicados, buscar la última fecha y
 * guardar la lista de expedientes.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const setupErrorHandlers = require('./errorHandler');
//const setupMonitoring = require('./monitoreo');

/**
 * Detecta la ruta de Chrome instalado en el sistema
 */
function detectarChrome() {
    const posiblesRutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
    ];

    for (const ruta of posiblesRutas) {
        if (fs.existsSync(ruta)) {
            console.log(`✅ Chrome encontrado en: ${ruta}`);
            return ruta;
        }
    }

    throw new Error('❌ No se encontró Google Chrome instalado. Por favor instálelo desde https://www.google.com/chrome/');
}

const URL = "http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1";

/**
 * Configura el navegador usando el perfil indicado y aplica monitoreo y manejo de errores.
 * @param {string} profilePath - Ruta del perfil de usuario.
 * @returns {Promise<{browser: Object, page: Object}>} Objeto con el navegador y la página.
 */
async function configuracionesGenerales(profilePath) {
    if (!fs.existsSync(profilePath)) {
        throw new Error(`Perfil no encontrado: ${profilePath}`);
    }

    console.log("Perfil encontrado. Configurando navegador...");

    // ✅ OBTENER DIMENSIONES DESDE VARIABLES DE ENTORNO
    const screenWidth = parseInt(process.env.SCREEN_WIDTH) || 1920;
    const screenHeight = parseInt(process.env.SCREEN_HEIGHT) || 1080;
    const halfWidth = Math.floor(screenWidth / 2);

    const chromePath = detectarChrome(); // ← AÑADIR ESTA LÍNEA

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath, // ← AÑADIR ESTA LÍNEA
        args: [
            `--user-data-dir=${profilePath}`,
            `--window-position=0,0`,
            `--window-size=${halfWidth},${screenHeight}`,
            '--no-sandbox',
            '--ignore-certificate-errors',
        ],
        defaultViewport: null,
    });

    const page = (await browser.pages())[0] || await browser.newPage();

    setupErrorHandlers(page, {
        check404: true,
        checkTimeout: true,
        checkInvalidCert: true,
        checkConnectionRefused: true,
        checkNetworkError: true,
        checkElementNotFound: true
    });

    // Ocultar la ventana si el modo headless simulado está activo
    await hideBrowser(page);

    _currentPage = page;
    return { browser, page };
}

/**
 * Inyecta un overlay transparente sobre el contenido de la página para bloquear
 * toda interacción del usuario con el DOM (clics, teclado).
 * La barra de título nativa de Chrome (mover, min, max, cerrar) NO se ve afectada.
 */
async function _activarOverlay(page) {
    await page.evaluate(() => {
        if (document.getElementById('__psc_overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = '__psc_overlay';
        overlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0',
            'width:100%', 'height:100%',
            'z-index:2147483647',
            'background:rgba(0,0,0,0.04)',
            'cursor:not-allowed'
        ].join(';');
        // Bloquear clics y teclado sobre el contenido
        ['click','mousedown','mouseup','keydown','keyup','keypress','touchstart'].forEach(ev => {
            overlay.addEventListener(ev, e => { e.stopPropagation(); e.preventDefault(); }, true);
        });
        document.body.appendChild(overlay);
    });
    console.log('🔒 Overlay activo: interacción con página bloqueada');
}

/**
 * Elimina el overlay de bloqueo, restaurando la interacción normal con la página.
 */
async function _desactivarOverlay(page) {
    await page.evaluate(() => {
        const el = document.getElementById('__psc_overlay');
        if (el) el.remove();
    });
    console.log('🔓 Overlay removido: página interactuable');
}

// ── Gestión de ventana: modo headless simulado ──────────────────────────────
// En lugar de usar --headless (que bloquea el autofill de Chrome), la ventana
// se lanza visible y se mueve fuera del área de pantalla. Solo activo cuando
// process.env.HEADLESS_MODE === 'true'.

const HEADLESS_MODE = process.env.HEADLESS_MODE === 'true';
let _savedWindowBounds = null; // { windowId, bounds } para restaurar posición
let _currentPage = null;       // referencia a la página activa para toggle remoto

/**
 * Mueve la ventana del navegador fuera del área visible de la pantalla.
 * Guarda la posición actual para poder restaurarla.
 */
async function hideBrowser(page, force = false) {
    if (!HEADLESS_MODE && !force) return;
    try {
        const session = await page.target().createCDPSession();
        const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
        // Solo guardar posición si la ventana está realmente visible (no ya oculta)
        if (bounds.left > -1000) {
            _savedWindowBounds = { windowId, bounds };
        }
        await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { left: -10000, top: -10000, width: bounds.width, height: bounds.height }
        });
        await session.detach();
        console.log('🫥 Navegador ocultado (movido fuera de pantalla)');
    } catch (err) {
        console.warn('⚠️ hideBrowser: no se pudo mover la ventana:', err.message);
    }
}

/**
 * Restaura la ventana del navegador a su posición original guardada,
 * o a (0, 0) si no hay posición guardada.
 */
async function showBrowser(page, force = false) {
    if (!HEADLESS_MODE && !force) return;
    try {
        const session = await page.target().createCDPSession();
        if (_savedWindowBounds) {
            const { windowId, bounds } = _savedWindowBounds;
            await session.send('Browser.setWindowBounds', { windowId, bounds });
        } else {
            const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
            await session.send('Browser.setWindowBounds', {
                windowId,
                bounds: { left: 0, top: 0, width: bounds.width, height: bounds.height }
            });
        }
        await session.detach();
        console.log('👁️ Navegador restaurado a pantalla');
    } catch (err) {
        console.warn('⚠️ showBrowser: no se pudo restaurar la ventana:', err.message);
    }
}

/**
 * Fuerza el cierre de sesión cuando hay una sesión activa con CUIT incorrecto.
 * Abre el dropdown de usuario y hace clic en "Cerrar sesión".
 */
async function _forzarLogout(page) {
    console.log('🔓 Cerrando sesión del CUIT incorrecto...');
    try {
        // 1. Abrir el dropdown de usuario
        const toggleSel = 'a.dropdown-toggle.menu-btn-border-right';
        await page.waitForSelector(toggleSel, { timeout: 5000 });
        await page.click(toggleSel);
        await delay(500);

        // 2. Hacer clic en "Cerrar sesión"
        const logoutSel = 'a[href*="identity.logout"]';
        await page.waitForSelector(logoutSel, { timeout: 5000 });
        const logoutHref = await page.$eval(logoutSel, el => el.href);
        console.log(`🔓 Navegando a logout: ${logoutHref}`);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            page.click(logoutSel)
        ]);
        console.log('✅ Sesión cerrada correctamente');
    } catch (err) {
        // Fallback: eliminar cookies de sesión si la UI falla
        console.warn(`⚠️ Error en logout por UI: ${err.message}. Eliminando cookies...`);
        try {
            const cookies = await page.cookies();
            if (cookies.length > 0) await page.deleteCookie(...cookies);
            console.log(`✅ ${cookies.length} cookies eliminadas`);
        } catch (e2) {
            console.warn('⚠️ Error eliminando cookies:', e2.message);
        }
    }
}

/**
 * Función auxiliar para verificar si existe un mensaje de error en el login.
 * @param {Object} page - Instancia de la página.
 * @returns {Promise<boolean>}
 */
async function hasErrorMessage(page) {
    return await page.evaluate(() => {
        const errorElement = document.querySelector('.alert-error .kc-feedback-text');
        return errorElement && errorElement.innerText.trim().includes('CUIT/CUIL o contraseña incorrectos');
    });
}

/**
 * Inicia sesión en la aplicación y verifica la autenticación.
 * 
 * IMPORTANTE: Si ocurre algún error, se intenta cerrar el navegador para evitar procesos zombie.
 * El llamador de esta función debe envolver la invocación en un bloque try/finally para
 * garantizar la limpieza del navegador.
 * 
 * @param {Object} page - Instancia de la página.
 * @param {string} URL - URL de la aplicación.
 * @param {string} identificador - Identificador para validar la sesión.
 * @param {Object} browser - Instancia del navegador.
 */
async function iniciarSesion(page, URL, identificador, browser, _reloginAttempt = false) {
    try {
        console.log(`Navegando a ${URL}`);
        await page.goto(URL, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Verificar que la navegación se realizó correctamente
        if (page.url() === 'about:blank') {
            throw new Error("La página quedó en 'about:blank' tras navegar a la URL.");
        }

        const loginButtonSelector = 'input#kc-login';

        if (await page.$('#username')) {
            console.log("Página de inicio de sesión detectada.");

            // [1.4] Bloquear interacción con la página mientras se verifica automáticamente
            await _activarOverlay(page);

            // [1.1] Esperar a que el gestor de contraseñas de Chrome auto-complete los campos
            await delay(900);

            // [1.2] Leer el campo usuario y comparar con el CUIT del usuario de la app
            const usernameActual = await page.$eval('#username', el => el.value.trim());
            console.log(`👤 Campo usuario detectado: "${usernameActual}"`);

            if (usernameActual !== identificador) {
                console.log(`⚠️ No coincide con CUIT esperado "${identificador}". Forzando campo...`);

                // Limpiar y tipear el CUIT correcto para que Chrome reaccione con la contraseña
                await page.focus('#username');
                await page.evaluate(() => {
                    const el = document.getElementById('username');
                    if (el) {
                        el.removeAttribute('readonly');
                        el.value = '';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });
                await page.type('#username', identificador, { delay: 40 });

                // Limpiar la contraseña que quedó del CUIT anterior para evitar
                // credenciales cruzadas (username nuevo + password del anterior).
                await page.evaluate(() => {
                    const el = document.getElementById('password');
                    if (el) {
                        el.value = '';
                        el.dispatchEvent(new Event('input',  { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });

                // Intentar disparar el autofill de Chrome para el nuevo CUIT.
                // Chrome solo auto-rellena al cargar la página, no al cambiar el username
                // por código. Estrategia multicapa:
                //
                // Nivel 1: Tab desde el campo usuario → Chrome lo interpreta como
                //   navegación natural de formulario y puede auto-rellenar el password
                //   para el CUIT recién escrito.
                //
                // Nivel 2 (fallback): Clic en #password + ArrowDown + Enter para
                //   forzar la selección del dropdown de credenciales de Chrome.
                //
                await _desactivarOverlay(page);

                // Nivel 1: Escape primero (cierra cualquier dropdown de username abierto),
                // luego Tab para moverse al campo contraseña
                await page.keyboard.press('Escape');
                await delay(200);
                await page.keyboard.press('Tab');
                await delay(1000); // Chrome necesita tiempo para reaccionar al Tab

                const passNivel1 = await page.$eval('#password', el => el.value.trim());
                if (!passNivel1) {
                    // Nivel 2: clic en el campo + ArrowDown + Enter
                    console.log('ℹ️ Tab no disparó autofill. Intentando clic + ArrowDown...');
                    await page.click('#password');
                    await delay(800);
                    await page.keyboard.press('ArrowDown');
                    await delay(600);
                    // Verificar si ArrowDown cargó algo antes de presionar Enter
                    const passTrasDl = await page.$eval('#password', el => el.value.trim());
                    if (passTrasDl) {
                        // ArrowDown ya rellenó el campo, confirmar con Enter
                        await page.keyboard.press('Enter');
                        await delay(300);
                    }
                    // Si sigue vacío, Enter en campo vacío podría enviar el form —
                    // lo omitimos y dejamos que el flujo manual lo maneje.
                }
            } else {
                console.log(`✅ Campo usuario coincide con CUIT: "${identificador}"`);
            }

            // Bloquear campo usuario con el CUIT correcto ya escrito
            await page.evaluate(() => {
                const el = document.getElementById('username');
                if (el) {
                    el.setAttribute('readonly', 'readonly');
                    el.style.backgroundColor = '#e9ecef';
                    el.style.cursor = 'not-allowed';
                }
            });

            // [1.3] Verificar si la contraseña fue auto-completada por Chrome
            const passwordActual = await page.$eval('#password', el => el.value.trim());

            if (!passwordActual) {
                // [1.3a] Contraseña vacía: notificar al usuario y esperar entrada manual.
                // Puede ser porque: (a) no hay credencial guardada para este CUIT, o
                // (b) el autofill por ArrowDown no funcionó → el usuario hace clic en el
                // campo contraseña y selecciona del gestor de Chrome manualmente.
                console.log('⚠️ Contraseña no disponible. Requiere acción manual en Chrome.');

                if (process.send) {
                    process.send({
                        type: 'LOGIN_MANUAL_REQUIRED',
                        cuit: identificador,
                        message: `Hacé clic en el campo <b>Contraseña</b> de la ventana del navegador, seleccioná tu clave del gestor de Chrome y presioná <b>Ingresar</b>.`
                    });
                }

                // El overlay ya fue removido en el bloque de mismatch (o se salta si coincidía).
                // Si llegamos aquí sin haber pasado por el mismatch (CUIT coincidía pero no hay pass),
                // removemos el overlay ahora.
                await _desactivarOverlay(page);

                // Mostrar la ventana para que el usuario pueda interactuar con Chrome
                await showBrowser(page);

                console.log('⏳ Esperando acción manual del usuario en Chrome (máx. 5 min)...');

                // Esperar a que el usuario presione "Ingresar" (detectado por navegación)
                await page.waitForNavigation({
                    waitUntil: 'networkidle2',
                    timeout: 300000
                });
                console.log('✅ Ingreso manual completado. Verificando sesión...');

                // Login completado: volver a ocultar la ventana para continuar la automatización
                await hideBrowser(page);

            } else {
                // [1.3b] Contraseña disponible: clic automático en "Ingresar"
                const isButtonEnabled = await page.$eval(loginButtonSelector, btn => !btn.disabled);
                if (!isButtonEnabled) {
                    throw new Error("El botón 'Ingresar' no está habilitado.");
                }

                // Remover overlay ANTES del clic: el overlay tiene z-index máximo y está
                // encima del botón, por lo que page.click() dispara en el overlay y no en
                // el botón. Al navegar, el DOM del overlay desaparece de todas formas.
                await _desactivarOverlay(page);

                console.log("✅ Contraseña detectada. Realizando clic automático en 'Ingresar'...");
                await Promise.all([
                    page.waitForNavigation({
                        waitUntil: 'networkidle2',
                        timeout: 60000
                    }),
                    page.click(loginButtonSelector)
                ]);
            }

            if (await hasErrorMessage(page)) {
                throw new Error("Credenciales incorrectas detectadas.");
            }
        } else {
            // Ya hay sesión activa — verificar que pertenece al CUIT esperado
            const cuitAutenticado = await page.$eval(
                'a.dropdown-toggle.menu-btn-border-right',
                el => el.textContent.trim().replace(/\s+/g, '')
            );
            console.log(`👤 Sesión activa detectada. CUIT en sesión: "${cuitAutenticado}"`);

            if (cuitAutenticado.includes(identificador)) {
                console.log(`✅ Sesión válida con CUIT correcto: ${identificador}`);
            } else if (!_reloginAttempt) {
                console.log(`⚠️ CUIT "${cuitAutenticado}" no coincide con "${identificador}". Forzando cierre de sesión...`);
                await _forzarLogout(page);
                console.log(`🔄 Re-iniciando sesión para CUIT correcto: ${identificador}`);
                // Llamada recursiva con _reloginAttempt=true para evitar bucle infinito.
                // La función navegará a URL de nuevo y ejecutará el bloque de login.
                return await iniciarSesion(page, URL, identificador, browser, true);
            } else {
                throw new Error(`Imposible autenticar con CUIT "${identificador}" tras forzar el cierre de sesión previo.`);
            }
        }

        // Simulación de interacción humana
        await page.mouse.move(100, 200, { steps: 20 });
        await delay(1000);

        // Verificar carga de lista de expedientes
        const selectorLista = 'h2.form_title';
        await page.waitForSelector(selectorLista, { timeout: 30000 });
        const listaTitulo = await page.$eval(selectorLista, el => el.textContent.trim());

        if (!listaTitulo.includes("Lista de Expedientes Relacionados")) {
            throw new Error("El texto de la lista de expedientes no coincide. Verifique la página.");
        } else {
            console.log("Lista de Expedientes Relacionados cargada.");
        }

        // Verificar el identificador en la página
        const selectorIdentificador = '.dropdown-toggle.menu-btn-border-right > i + b.caret';
        const identificadorCorrecto = await page.evaluate((selector, id) => {
            const elemento = document.querySelector(selector);
            if (!elemento) return false;
            const textoElemento = elemento.parentElement.textContent.trim().replace(/\s+/g, '');
            return textoElemento.includes(id);
        }, selectorIdentificador, identificador);

        if (!identificadorCorrecto) {
            throw new Error("El identificador no coincide.");
        } else {
            console.log("El identificador coincide. Continuando...");
        }
    } catch (error) {
        // En caso de error restaurar la ventana antes de cerrar para que el usuario
        // pueda ver qué ocurrió (solo relevante si el modo headless simulado está activo).
        try { await showBrowser(page); } catch (_) { /* ignorar */ }

        // En caso de error, se intenta cerrar el navegador para evitar procesos zombie.
        // Solo cerramos si el navegador sigue conectado: en el escenario de _reloginAttempt
        // la llamada recursiva ya puede haber cerrado el browser desde su propio catch.
        try {
            if (browser && typeof browser.isConnected === 'function' && browser.isConnected()) {
                await browser.close();
            }
        } catch (closeError) {
            console.error("Error al cerrar el navegador:", closeError.message);
        }
        throw error;
    }
}

/**
 * Función de delay (espera) que retorna una promesa.
 * @param {number} ms - Milisegundos a esperar.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ordena y cuenta los expedientes, navegando a la última y regresando a la primera página.
 * @param {Object} page - Instancia de la página.
 * @returns {Promise<{totalPaginas: number, totalExpedientes: number}>}
 */
async function ordenarYContarExpedientes(page) {
    const lastPageButtonSelector = 'a.last-page';
    const firstPageButtonSelector = 'a.first-page';
    const paginaActivaSelector = 'ul.pagination li.active span';
    const totalExpedientesSelector = 'div[class*="well"] strong';
    const orderBySelector = '[id^="j_idt"][id$=":order_by_form:camara"]';
    const tablaSelector = '[id*="tablaConsulta"][id$=":dataTable"]';

    let totalPaginas = 1;
    let totalExpedientes = 0;

    try {
        console.log("Ordenando expedientes y contando páginas...");

        const lastPageButton = await page.$(lastPageButtonSelector);
        if (lastPageButton) {
            console.log("Clic en 'Última página'...");
            await Promise.all([
                page.click(lastPageButtonSelector),
                page.waitForFunction(
                    (selector, currentPage) => {
                        const el = document.querySelector(selector);
                        return el && el.textContent.trim() !== currentPage;
                    },
                    { timeout: 30000 },
                    paginaActivaSelector,
                    "1"
                )
            ]);

            console.log("Obteniendo número de la última página...");
            totalPaginas = await page.$eval(paginaActivaSelector, el => parseInt(el.textContent.trim(), 10));
            console.log(`Total de páginas detectadas: ${totalPaginas}`);

            console.log("Clic en 'Primera página'...");
            await Promise.all([
                page.click(firstPageButtonSelector),
                page.waitForFunction(
                    selector => {
                        const el = document.querySelector(selector);
                        return el && el.textContent.trim() === "1";
                    },
                    { timeout: 30000 },
                    paginaActivaSelector
                )
            ]);
        } else {
            console.log("Botón 'Última página' no detectado, se asume que hay una sola página.");
            totalPaginas = 1;
        }

        console.log("Obteniendo la cantidad total de expedientes...");
        totalExpedientes = await page.$eval(totalExpedientesSelector, el => {
            const match = el.textContent.match(/(\d+)\s+expediente/);
            return match ? parseInt(match[1], 10) : 0;
        });
        console.log(`Total de expedientes: ${totalExpedientes}`);

        if (totalExpedientes === 0) {
            return { totalExpedientes: 0, totalPaginas: 0 };
        }

        console.log("Ordenando por 'FECHA'...");
        await page.waitForSelector(orderBySelector, { timeout: 10000 });
        await page.select(orderBySelector, 'FECHA');

        const linkOrdenar = await page.$('td.no-padding-left a');
        if (linkOrdenar) {
            console.log("Clic en 'Ordenar'...");
            const contenidoTablaAntes = await page.$eval(tablaSelector, el => el.innerHTML);
            await Promise.all([
                linkOrdenar.click(),
                page.waitForFunction(
                    (selector, contenidoAnterior) => {
                        const el = document.querySelector(selector);
                        return el && el.innerHTML !== contenidoAnterior;
                    },
                    { timeout: 30000 },
                    tablaSelector,
                    contenidoTablaAntes
                )
            ]);
            console.log("Tabla recargada después de ordenar por fecha.");
        } else {
            console.error("No se encontró el enlace 'Ordenar'.");
        }

        console.log(`Resultados finales: Total de páginas = ${totalPaginas}, Total de expedientes = ${totalExpedientes}`);
        return { totalPaginas, totalExpedientes };

    } catch (error) {
        console.error("Error durante la ejecución:", error.message);
        throw error;
    }
}

/**
 * Itera sobre la lista de expedientes extraídos de cada página.
 * @param {Object} page - Instancia de la página.
 * @param {number} totalPaginas - Número total de páginas a procesar.
 * @param {string} fechaLimite - Fecha límite para detener la extracción.
 * @returns {Promise<Array>} Lista de expedientes extraídos.
 */
async function iterarListaExpedientes(page, totalPaginas, fechaLimite) {
    const tablaSelector = 'table.table-striped tbody';
    const filaSelector = `${tablaSelector} tr`;
    const activePageSelector = 'ul.pagination li.active span';

    let todasLasFilas = [];
    let totalFilas = 0;
    let stopExtraction = false;
    let fechaLimiteDate = null;

    if (fechaLimite) {
        const partes = fechaLimite.split('/');
        if (partes.length === 3) {
            fechaLimiteDate = new Date(partes[2], partes[1] - 1, partes[0]);
        } else {
            console.warn(`Fecha límite inválida: ${fechaLimite}`);
        }
    }

    const normalizarFecha = (fecha) => {
        return fecha.replace(/\b(\d)\b/g, '0$1').replace(/\/(\d)\b/g, '/0$1');
    };

    for (let paginaActual = 1; paginaActual <= totalPaginas; paginaActual++) {
        try {
            await page.waitForFunction(
                (selector, expected) => {
                    const el = document.querySelector(selector);
                    return el && el.textContent.trim() === expected.toString();
                },
                { timeout: 30000 },
                activePageSelector,
                paginaActual
            );

            await page.waitForSelector(filaSelector, { timeout: 10000 });
            const filas = await page.$$eval(filaSelector, rows =>
                rows
                    .filter(row => row.cells.length > 0 && row.cells[0].textContent.trim() !== '')
                    .map(row => {
                        const celdas = Array.from(row.cells).map(cell => cell.textContent.trim());
                        return {
                            expediente: celdas[0],
                            dependencia: celdas[1],
                            caratula: celdas[2],
                            situacion: celdas[3],
                            ultimaAct: celdas[4]
                        };
                    })
            );

            for (let index = 0; index < filas.length; index++) {
                const fila = filas[index];
                console.log(`Página ${paginaActual}, Fila ${index + 1}: ${fila.expediente} | ${fila.dependencia} | ${fila.caratula} | ${fila.situacion} | ${fila.ultimaAct}`);

                if (fechaLimiteDate) {
                    const fechaNormalizada = normalizarFecha(fila.ultimaAct);
                    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaNormalizada)) {
                        const [dia, mes, anio] = fechaNormalizada.split('/').map(Number);
                        const fechaRegistro = new Date(anio, mes - 1, dia);
                        if (fechaRegistro < fechaLimiteDate) {
                            todasLasFilas.push(fila);
                            totalFilas++;
                            console.log(`Se encontró registro con fecha ${fila.ultimaAct} < fecha límite ${fechaLimite}. Deteniendo la extracción.`);
                            stopExtraction = true;
                            break;
                        } else {
                            todasLasFilas.push(fila);
                            totalFilas++;
                        }
                    } else {
                        console.warn(`Fecha inválida encontrada en registro: ${fila.ultimaAct}. Se continúa con la extracción.`);
                        todasLasFilas.push(fila);
                        totalFilas++;
                    }
                } else {
                    todasLasFilas.push(fila);
                    totalFilas++;
                }
            }

            if (stopExtraction) {
                console.log(`Detención de la extracción debido a la condición de fecha límite en la página ${paginaActual}.`);
                break;
            }

            if (paginaActual < totalPaginas) {
                console.log(`Navegando a la página ${paginaActual + 1} mediante clic en 'Siguiente'...`);
                const contenidoActual = await page.$eval(tablaSelector, el => el.innerHTML);
                const botonSiguienteHandle = await page.evaluateHandle(() => {
                    const links = document.querySelectorAll('a');
                    for (const link of links) {
                        const span = link.querySelector('span[title="Siguiente"]');
                        if (span) {
                            return link;
                        }
                    }
                    return null;
                });
                const botonSiguiente = botonSiguienteHandle.asElement();
                if (botonSiguiente) {
                    await Promise.all([
                        botonSiguiente.click(),
                        page.waitForFunction(
                            (selector, contenidoAnterior) => {
                                const el = document.querySelector(selector);
                                return el && el.innerHTML !== contenidoAnterior;
                            },
                            { timeout: 30000 },
                            tablaSelector,
                            contenidoActual
                        )
                    ]);
                    console.log(`Página ${paginaActual + 1} cargada correctamente.`);
                } else {
                    console.error("No se encontró el botón 'Siguiente'.");
                    break;
                }
            }
        } catch (error) {
            console.error(`Error al procesar la página ${paginaActual}:`, error.message);
        }
    }

    console.log(`Total de filas procesadas (sin títulos): ${totalFilas}`);
    return todasLasFilas;
}

/**
 * Controla y muestra duplicados en la lista de expedientes.
 * @param {Array} todasLasFilas - Lista de expedientes.
 * @returns {Object} Objeto con cantidad y lista de duplicados.
 */
function controlarDuplicados(todasLasFilas) {
    const expedientesUnicos = new Set();
    const expedientesDuplicados = new Set();

    todasLasFilas.forEach(fila => {
        const expedienteNormalizado = fila.expediente.replace(/[\s\W_]+/g, '').toLowerCase();
        if (expedientesUnicos.has(expedienteNormalizado)) {
            expedientesDuplicados.add(fila.expediente);
        } else {
            expedientesUnicos.add(expedienteNormalizado);
        }
    });

    if (expedientesDuplicados.size > 0) {
        console.log(`Se encontraron duplicados en la columna "Expediente". Total de duplicados: ${expedientesDuplicados.size}`);
        console.log("Duplicados detectados (originales):", Array.from(expedientesDuplicados));
    } else {
        console.log("No se encontraron duplicados en la columna 'Expediente'.");
    }

    return {
        totalDuplicados: expedientesDuplicados.size,
        duplicados: Array.from(expedientesDuplicados)
    };
}

/**
 * Busca la última fecha de actuación entre los expedientes.
 * @param {Array} filas - Lista de expedientes.
 * @returns {string|null} Última fecha en formato DD/MM/YYYY o null.
 */
function buscarUltimaFechaExpedientes(filas) {
    const normalizarFecha = (fecha) => {
        return fecha.replace(/\b(\d)\b/g, '0$1').replace(/\/(\d)\b/g, '/0$1');
    };

    const fechas = filas
        .map(fila => fila.ultimaAct)
        .map(fecha => {
            const fechaNormalizada = normalizarFecha(fecha);
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fechaNormalizada)) {
                console.warn(`Fecha inválida encontrada: ${fecha}`);
            }
            return fechaNormalizada;
        })
        .filter(fecha => /^\d{2}\/\d{2}\/\d{4}$/.test(fecha))
        .map(fecha => {
            const [dia, mes, anio] = fecha.split('/').map(Number);
            const fechaObj = new Date(anio, mes - 1, dia);
            if (isNaN(fechaObj.getTime())) {
                console.error(`Error al convertir la fecha: ${fecha}`);
            }
            return fechaObj;
        })
        .filter(fechaObj => !isNaN(fechaObj.getTime()));

    if (fechas.length === 0) {
        console.log("No se encontraron fechas válidas en la columna 'Últ. Act.'");
        return null;
    }

    const fechaMasReciente = new Date(Math.max(...fechas));
    const dia = String(fechaMasReciente.getDate()).padStart(2, '0');
    const mes = String(fechaMasReciente.getMonth() + 1).padStart(2, '0');
    const anio = fechaMasReciente.getFullYear();

    return `${dia}/${mes}/${anio}`;
}

/**
 * Guarda la lista de expedientes en un archivo de texto.
 * @param {Array} todasLasFilas - Lista de expedientes.
 * @param {string} identificador - Identificador usado en el nombre del archivo.
 * @param {string} [tipo=""] - (Opcional) Tipo de sección para agregar al nombre del archivo.
 * @returns {string} Ruta del archivo guardado.
 */
function guardarListaExpedientes(todasLasFilas, identificador, tipo = "") {
    const filePath = path.join(__dirname, `${identificador}${tipo ? "_" + tipo : ""}.txt`);
    const fileContent = todasLasFilas.map(fila =>
        `${fila.expediente} | ${fila.dependencia} | ${fila.caratula} | ${fila.situacion} | ${fila.ultimaAct}`
    ).join('\n');

    try {
        fs.writeFileSync(filePath, fileContent, 'utf8');
        console.log(`Archivo guardado con éxito: ${filePath}`);
    } catch (error) {
        console.error(`Error al guardar el archivo: ${error.message}`);
    }

    return filePath;
}

/**
 * Consulta expedientes por tipo con reintentos y maneja la navegación según la opción.
 * @param {Object} page - Instancia de la página.
 * @param {number} opcion - Opción a consultar (1: LETRADO, 2: PARTE, 3: AUTORIZADO NE, 4: FAVORITOS).
 * @param {number} [intentos=3] - Cantidad de reintentos permitidos.
 */
async function consultarExpedientes(page, opcion, intentos = 3) {
    const opciones = {
        1: { tipo: "LETRADO", selector: 'input[value="LETRADO"]' },
        2: { tipo: "PARTE", selector: 'input[value="PARTE"]' },
        3: { tipo: "AUTORIZADO NE", selector: 'input[value="AUTORIZADO NE"]' },
        4: { tipo: "FAVORITOS", selector: 'a[id*="btn-lista-favoritos"]' },
    };

    const info = opciones[opcion];
    if (!info) {
        console.error("Opción inválida.");
        return;
    }
    const { tipo, selector } = info;
    const expectedLabel = opcion === 4 ? "Lista de Expedientes Favoritos" : "Lista de Expedientes Relacionados";

    const totalExpedientesSelector = 'div[class*="well"] strong';
    const dropdownToggleSelector = 'a.dropdown-toggle.menu-btn-border';
    const submenuRelacionadosSelector = 'a[id*="btn-lista-relacionados"]';
    const submenuFavoritosSelector = 'a[id*="btn-lista-favoritos"]';

    for (let intento = 1; intento <= intentos; intento++) {
        try {
            console.log(`Consultando expedientes para ${tipo} (intento ${intento})...`);

            if (opcion === 4) {
                console.log(`Navegando directamente a ${tipo}...`);
                // SCW puede hacer una redirección server-side que Puppeteer interpreta
                // como "Navigating frame was detached". Capturamos ese error específico
                // y esperamos a que la navegación se estabilice antes de continuar.
                try {
                    await page.goto('http://scw.pjn.gov.ar/scw/consultaListaFavoritos.seam', {
                        waitUntil: 'networkidle2',
                        timeout: 30000
                    });
                } catch (navErr) {
                    if (navErr.message.includes('detached') || navErr.message.includes('Navigating frame')) {
                        console.warn(`⚠️ Redirección del servidor durante navegación a FAVORITOS. Esperando estabilización...`);
                        await delay(3000);
                        // Volver a navegar con criterio menos estricto por si la redirección
                        // ya completó pero Puppeteer perdió el track del frame original.
                        await page.goto('http://scw.pjn.gov.ar/scw/consultaListaFavoritos.seam', {
                            waitUntil: 'domcontentloaded',
                            timeout: 30000
                        });
                    } else {
                        throw navErr;
                    }
                }
                console.log(`Navegación a ${tipo} completada.`);
            } else {
                let targetVisible = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        el.offsetHeight > 0;
                }, selector);

                if (!targetVisible) {
                    console.log(`El elemento para ${tipo} no es visible. Se intenta desplegar el menú "Mis Expedientes"...`);
                    await page.waitForSelector(dropdownToggleSelector, { timeout: 30000 });
                    await page.click(dropdownToggleSelector);
                    await page.waitForSelector(submenuRelacionadosSelector, { timeout: 30000 });
                    await page.click(submenuRelacionadosSelector);
                    await page.waitForFunction(
                        (sel) => {
                            const el = document.querySelector(sel);
                            if (!el) return false;
                            const style = window.getComputedStyle(el);
                            return style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                el.offsetHeight > 0;
                        },
                        { timeout: 30000 },
                        selector
                    );
                }

                await page.waitForSelector(selector, { timeout: 30000 });
                await page.click(selector);
                console.log(`Clic realizado en el elemento para ${tipo}.`);

                await page.waitForFunction(
                    (sel) => {
                        const el = document.querySelector(sel);
                        return el && el.classList.contains("active");
                    },
                    { timeout: 30000 },
                    selector
                );
                console.log(`El botón para ${tipo} está activo.`);
            }

            await page.waitForFunction(
                (expected) => {
                    const span = document.querySelector("span.colorTextGrey");
                    return span && span.textContent.trim().includes(expected);
                },
                { timeout: 30000 },
                expectedLabel
            );
            console.log(`Se visualiza el título: "${expectedLabel}".`);

            await page.waitForSelector(totalExpedientesSelector, { timeout: 30000 });
            const totalExpedientes = await page.$eval(totalExpedientesSelector, el => {
                const match = el.textContent.match(/(\d+)\s+expediente/);
                return match ? parseInt(match[1], 10) : 0;
            });
            console.log(`Total de expedientes en ${tipo}: ${totalExpedientes}`);

            console.log(`Consulta para ${tipo} exitosa. No se requieren más reintentos.`);
            return; // Salir si la consulta fue exitosa.
        } catch (error) {
            console.error(`Error en el intento ${intento} para ${tipo}:`, error.message);
            if (intento === intentos) {
                console.error(`Falló después de ${intentos} intentos para ${tipo}`);
                // Propagar el error: el caller debe manejar la recuperación
                // (ej: restaurar el navegador antes de continuar con otras operaciones).
                throw error;
            } else {
                console.log(`Reintentando para ${tipo}...`);
                await delay(2000);
            }
        }
    }
}

// Listener para toggle remoto del navegador desde el proceso padre (Electron)
if (process.send !== undefined) {
    process.on('message', async (msg) => {
        if (!msg || msg.type !== 'TOGGLE_BROWSER') return;
        if (!_currentPage) return;
        try {
            if (msg.show) {
                await showBrowser(_currentPage, true);
            } else {
                await hideBrowser(_currentPage, true);
            }
        } catch (err) {
            console.warn('⚠️ toggle browser error:', err.message);
        }
    });
}

module.exports = {
    configuracionesGenerales,
    iniciarSesion,
    ordenarYContarExpedientes,
    iterarListaExpedientes,
    controlarDuplicados,
    buscarUltimaFechaExpedientes,
    guardarListaExpedientes,
    consultarExpedientes,
    hideBrowser,
    showBrowser,
    URL,
    delay
};
