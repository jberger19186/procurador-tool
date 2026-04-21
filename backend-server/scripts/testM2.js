/**
* testM2.js
*/

// =============================================================================
// Módulos y constantes iniciales
// =============================================================================
const { PDFDocument, rgb, StandardFonts, PDFName, PDFString } = require('pdf-lib');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
// Otros módulos requeridos (errorHandler, monitoreo, etc.)
const setupErrorHandlers = require('./errorHandler');
const setupMonitoring = require('./monitoreo');

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

// ============ OBTENER RUTA DE DATOS ============
function getDataPath() {
    // PRIORIDAD 1: Si viene de Electron, usar directamente APPDATA
    // (Electron ya pasa app.getPath('userData') que incluye 'procurador-electron')
    if (process.env.APPDATA && process.env.APPDATA.includes('procurador-electron')) {
        console.log('📂 Usando APPDATA de Electron:', process.env.APPDATA);
        return process.env.APPDATA;
    }

    // PRIORIDAD 2: Detectar si estamos empaquetado
    const isPackaged = process.resourcesPath && process.resourcesPath !== __dirname;

    if (!isPackaged) {
        // DESARROLLO: usar carpeta del script
        return __dirname;
    }

    // PRIORIDAD 3: Fallback para ejecución standalone
    const appDataPath = process.env.APPDATA || process.env.HOME;
    return path.join(appDataPath, 'procurador-electron');
}

// =============================================================================
// Helper de Reintentos: reintentarOperacion
// =============================================================================
/**
 * Helper para reintentar una operación que pueda fallar.
 * @param {Function} operacion - Función asíncrona que representa la operación a intentar.
 * @param {number} maxReintentos - Número máximo de reintentos (por defecto 3).
 * @param {number} intervalo - Tiempo de espera entre reintentos en milisegundos (por defecto 5000 ms).
 * @returns {Promise<any>} - Resultado de la operación si se completa con éxito.
 * @throws {Error} - Si la operación falla tras el máximo de reintentos.
 */
async function reintentarOperacion(operacion, maxReintentos = 3, intervalo = 5000) {
    let intento = 0;
    while (intento < maxReintentos) {
        try {
            return await operacion();
        } catch (error) {
            intento++;
            console.warn(`Intento ${intento} fallido. Error: ${error.message}`);
            if (intento >= maxReintentos) {
                throw new Error(`Operación fallida tras ${maxReintentos} reintentos: ${error.message}`);
            }
            // Espera antes de reintentar
            await new Promise(resolve => setTimeout(resolve, intervalo));
        }
    }
}

// =============================================================================
// Gestión de ventana: modo headless simulado
// =============================================================================

const HEADLESS_MODE = process.env.HEADLESS_MODE === 'true';
let _savedWindowBounds = null;
let _currentPage = null;

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

// =============================================================================
// Funciones Básicas de Configuración e Inicio de Sesión
// =============================================================================

// CONFIGURACIONES GENERALES
async function configuracionesGenerales(profilePath) {
    if (!fs.existsSync(profilePath)) {
        console.error(`Perfil no encontrado: ${profilePath}`);
        process.exit(1);
    }
    console.log("Perfil encontrado. Configurando navegador...");

    // ✅ OBTENER DIMENSIONES DESDE VARIABLES DE ENTORNO
    const screenWidth = parseInt(process.env.SCREEN_WIDTH) || 1920;
    const screenHeight = parseInt(process.env.SCREEN_HEIGHT) || 1080;
    const halfWidth = Math.floor(screenWidth / 2);

    const chromePath = detectarChrome();
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath,
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

    setupMonitoring(page, { logResponses: true, monitorDOM: true });
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

// =============================================================================
// Helpers de login (replicados de testM1 para comportamiento uniforme)
// =============================================================================

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        ['click','mousedown','mouseup','keydown','keyup','keypress','touchstart'].forEach(ev => {
            overlay.addEventListener(ev, e => { e.stopPropagation(); e.preventDefault(); }, true);
        });
        document.body.appendChild(overlay);
    });
    console.log('🔒 Overlay activo: interacción con página bloqueada');
}

async function _desactivarOverlay(page) {
    await page.evaluate(() => {
        const el = document.getElementById('__psc_overlay');
        if (el) el.remove();
    });
    console.log('🔓 Overlay removido: página interactuable');
}

async function hasErrorMessage(page) {
    return await page.evaluate(() => {
        const errorElement = document.querySelector('.alert-error .kc-feedback-text');
        return errorElement && errorElement.innerText.trim().includes('CUIT/CUIL o contraseña incorrectos');
    });
}

async function _forzarLogout(page) {
    console.log('🔓 Cerrando sesión del CUIT incorrecto...');
    try {
        const toggleSel = 'a.dropdown-toggle.menu-btn-border-right';
        await page.waitForSelector(toggleSel, { timeout: 5000 });
        await page.click(toggleSel);
        await delay(500);
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

// INICIAR SESIÓN
async function iniciarSesion(page, URL, identificador, browser, _reloginAttempt = false) {
    console.log(`Navegando a ${URL}`);
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

    if (page.url() === 'about:blank') {
        throw new Error("La página quedó en 'about:blank' tras navegar a la URL.");
    }

    const loginButtonSelector = 'input#kc-login';

    if (await page.$('#username')) {
        console.log("Página de inicio de sesión detectada.");

        // Bloquear interacción mientras se verifica el autofill
        await _activarOverlay(page);

        // Esperar a que el gestor de contraseñas de Chrome auto-complete los campos
        await delay(900);

        // Leer el campo usuario y comparar con el CUIT del usuario de la app
        const usernameActual = await page.$eval('#username', el => el.value.trim());
        console.log(`👤 Campo usuario detectado: "${usernameActual}"`);

        if (usernameActual !== identificador) {
            console.log(`⚠️ No coincide con CUIT esperado "${identificador}". Forzando campo...`);

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

            // Limpiar contraseña del CUIT anterior para evitar credenciales cruzadas
            await page.evaluate(() => {
                const el = document.getElementById('password');
                if (el) {
                    el.value = '';
                    el.dispatchEvent(new Event('input',  { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            await _desactivarOverlay(page);

            // Nivel 1: Tab para disparar autofill de Chrome
            await page.keyboard.press('Escape');
            await delay(200);
            await page.keyboard.press('Tab');
            await delay(1000);

            const passNivel1 = await page.$eval('#password', el => el.value.trim());
            if (!passNivel1) {
                // Nivel 2 (fallback): clic + ArrowDown
                console.log('ℹ️ Tab no disparó autofill. Intentando clic + ArrowDown...');
                await page.click('#password');
                await delay(800);
                await page.keyboard.press('ArrowDown');
                await delay(600);
                const passTrasDl = await page.$eval('#password', el => el.value.trim());
                if (passTrasDl) {
                    await page.keyboard.press('Enter');
                    await delay(300);
                }
            }
        } else {
            console.log(`✅ Campo usuario coincide con CUIT: "${identificador}"`);
        }

        // Bloquear campo usuario con el CUIT correcto
        await page.evaluate(() => {
            const el = document.getElementById('username');
            if (el) {
                el.setAttribute('readonly', 'readonly');
                el.style.backgroundColor = '#e9ecef';
                el.style.cursor = 'not-allowed';
            }
        });

        const passwordActual = await page.$eval('#password', el => el.value.trim());

        if (!passwordActual) {
            // Contraseña vacía: notificar al usuario y esperar entrada manual
            console.log('⚠️ Contraseña no disponible. Requiere acción manual en Chrome.');

            if (process.send) {
                process.send({
                    type: 'LOGIN_MANUAL_REQUIRED',
                    cuit: identificador,
                    message: `Hacé clic en el campo <b>Contraseña</b> de la ventana del navegador, seleccioná tu clave del gestor de Chrome y presioná <b>Ingresar</b>.`
                });
            }

            await _desactivarOverlay(page);
            await showBrowser(page);

            console.log('⏳ Esperando acción manual del usuario en Chrome (máx. 5 min)...');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 300000 });
            console.log('✅ Ingreso manual completado. Verificando sesión...');

            await hideBrowser(page);

        } else {
            // Contraseña disponible: clic automático en "Ingresar"
            const isButtonEnabled = await page.$eval(loginButtonSelector, btn => !btn.disabled);
            if (!isButtonEnabled) {
                throw new Error("El botón 'Ingresar' no está habilitado.");
            }

            await _desactivarOverlay(page);

            console.log("✅ Contraseña detectada. Realizando clic automático en 'Ingresar'...");
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
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
        ).catch(() => '');
        console.log(`👤 Sesión activa detectada. CUIT en sesión: "${cuitAutenticado}"`);

        if (!cuitAutenticado || cuitAutenticado.includes(identificador)) {
            console.log(`✅ Sesión válida con CUIT correcto: ${identificador}`);
        } else if (!_reloginAttempt) {
            console.log(`⚠️ CUIT "${cuitAutenticado}" no coincide con "${identificador}". Forzando cierre de sesión...`);
            await _forzarLogout(page);
            return await iniciarSesion(page, URL, identificador, browser, true);
        } else {
            throw new Error(`Imposible autenticar con CUIT "${identificador}" tras forzar el cierre de sesión previo.`);
        }
    }

    // Simulación de interacción humana
    await page.mouse.move(100, 200, { steps: 20 });
    await delay(1000);

    // Verificación de carga de página
    await page.waitForSelector('h2.form_title', { timeout: 30000 });
    console.log("Inicio de sesión completado.");
}
// =============================================================================
// Funciones para Consulta y Extracción de Datos
// =============================================================================

// REALIZAR NUEVA CONSULTA PÚBLICA
async function nuevaConsultaPublica(page, jurisdiccion, nroExpte, anoExpte) {
    console.log("Realizando nueva consulta pública...");
    await page.waitForSelector('a[id$="menuNuevaConsulta"]', { timeout: 10000 });
    await page.click('a[id$="menuNuevaConsulta"]');
    await page.waitForSelector('select[name="formPublica:camaraNumAni"]');
    await page.select('select[name="formPublica:camaraNumAni"]', jurisdiccion);
    await page.type('input[name="formPublica:numero"]', nroExpte);
    await page.type('input[name="formPublica:anio"]', anoExpte);
    await page.click('input[id$="buscarPorNumeroButton"]');
    console.log("Consulta pública enviada.");
}

// EXTRAER DATOS GENERALES DEL EXPEDIENTE
async function extraerDatosGenerales(page) {
    const SELECTOR_TIMEOUT = 10000;
    const SENTINEL = 'div.col-xs-10 span[style*="color:#000000"]';

    // Verificar primero que la página de detalle cargó correctamente.
    // Si el selector centinela no aparece, la página no está lista — lanzar error
    // para que el llamador active su mecanismo de reintento (en lugar de continuar
    // con todos los campos en null sin avisar).
    try {
        await page.waitForSelector(SENTINEL, { timeout: SELECTOR_TIMEOUT });
    } catch (e) {
        throw new Error(`Waiting for selector \`${SENTINEL}\` failed: página de detalle no disponible.`);
    }

    const datosGenerales = {};
    const campos = {
        expediente: SENTINEL,
        jurisdiccion: '[id$="detailCamera"]',
        dependencia: '[id$="detailDependencia"]',
        situacion_actual: '[id$="detailSituation"]',
        caratula: '[id$="detailCover"]'
    };

    for (const [campo, selector] of Object.entries(campos)) {
        try {
            await page.waitForSelector(selector, { timeout: SELECTOR_TIMEOUT });
            datosGenerales[campo] = await page.$eval(selector, el => el.textContent.trim());
        } catch (innerError) {
            console.warn(`No se pudo extraer el campo '${campo}': ${innerError.message}`);
            datosGenerales[campo] = null;
        }
    }

    console.log("Datos Generales del Expediente:", datosGenerales);
    return datosGenerales;
}

// =============================================================================
// Funciones de Extracción de Tablas (originales)
// =============================================================================

// ITERAR Y EXTRAER TABLAS DE ACTUACIONES
async function extraerTablaActuaciones(page, options = {}) {
    // Configuración por defecto
    // Añadir filtro de descargas: null | 'SC' | 'SD' | 'SCSD' 
    const defaults = {
        maxPages: null,           // Si es null, se procesan todas las páginas
        maxRowsPerPage: null,     // Si es null, se procesan todas las filas por página
        maxDownloadsPerPage: null,// Si es null, se descargan todos los archivos encontrados
        mode: 'full',             // Modo por defecto: 'full'. Otros ejemplos: 'quick', 'test'
        downloadFilter: null,       // Filtro de descargas: null | 'SC' | 'SD' | 'SCSD'
        startPage: 1         // ← página por defecto
    };


    // Se mezclan las opciones recibidas con las por defecto
    options = { ...defaults, ...options };

    // Definir presets según el modo, de forma que se puedan invocar "modos" preconfigurados
    const modos = {
        full: { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null },
        quick1: { maxPages: 1, maxRowsPerPage: 1, maxDownloadsPerPage: 1 },
        quick5: { maxPages: 1, maxRowsPerPage: 5, maxDownloadsPerPage: 5 },
        quick5mam: { maxPages: 1, maxRowsPerPage: 5, maxDownloadsPerPage: 0 },
        quick15: { maxPages: 1, maxRowsPerPage: null, maxDownloadsPerPage: null }
    };

    if (options.mode && modos[options.mode]) {
        // Se aplican las configuraciones específicas del modo, pero se pueden sobreescribir si se desean otros valores
        options = { ...options, ...modos[options.mode] };
    }

    // Definir los selectores y demás constantes (se mantienen iguales)
    const SELECTORS = {
        tabla: '#expediente\\:action-table',
        filas: '#expediente\\:action-table tbody tr',
        paginaActiva: '.pagination.no-margin.no-padding li.active span',
        ultimaPagina: 'li a span[title="Última página"]',
        primeraPagina: 'li a span[title="Primera página"]',
        siguiente: 'li a span[title="Siguiente"]'
    };

    const movimientos = [];
    // Arreglo para mapear las descargas: cada objeto contendrá { downloadNumber, downloadLabel, downloadedPath, finalPath }
    const mappingDescargas = [];

    // Función para esperar un tiempo determinado (ms)
    const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Función para esperar que la tabla se actualice (por cambio en su innerText)
    const esperarTablaActualizada = async (prevContent) => {
        await page.waitForFunction(
            (selector, prev) => {
                const currentContent = document.querySelector(selector)?.innerText || "";
                return currentContent && currentContent !== prev;
            },
            {},
            SELECTORS.tabla,
            prevContent
        );
    };

    // Obtener el número de la página activa
    const obtenerPaginaActiva = async () => {
        return await page.$eval(SELECTORS.paginaActiva, el => parseInt(el.textContent.trim()));
    };

    // Función para hacer clic en un botón si existe (por ejemplo, para navegar entre páginas)
    const navegarPagina = async (botonSelector) => {
        const boton = await page.$(botonSelector);
        if (boton) {
            await boton.click();
            console.log(`Haciendo clic en el botón: ${botonSelector}`);
            await esperar(2000); // Pausa para permitir la navegación
            await page.waitForSelector(SELECTORS.filas, { timeout: 15000 });
        } else {
            console.warn(`No se encontró el botón: ${botonSelector}`);
        }
    };

    let contadorGlobalArchivos = 0; // Contador global de descargas

    // Función que procesa la tabla de la página actual
    // Dentro de extraerTablaActuaciones, en la función procesarPaginaActualA:
    async function procesarPaginaActualA(pagina) {
        console.log(`\nExtrayendo datos de la página ${pagina}...`);

        const datosGenerales = await extraerDatosGenerales(page);
        const expediente = datosGenerales.expediente
            ? datosGenerales.expediente.replace(/[^a-zA-Z0-9]/g, "_")
            : "Expediente_Desconocido";
        const identificador = process.env.IDENTIFICADOR || "default";
        const carpetaDestino = path.join(
            getDataPath(),
            'descargas',
            `${identificador}_temp`,
            `${expediente}_actuales`
        );
        if (!fs.existsSync(carpetaDestino)) {
            fs.mkdirSync(carpetaDestino, { recursive: true });
        }
        await page._client().send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: carpetaDestino
        });

        let rows = await page.$$(SELECTORS.filas);
        if (options.maxRowsPerPage != null) {
            rows = rows.slice(0, options.maxRowsPerPage);
        }
        let localDownloadCount = 0;

        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const rowData = await page.evaluate(row => {
                const columnas = row.querySelectorAll('td span.font-color-black, td span.font-negrita');
                return {
                    oficina: columnas[0]?.textContent.trim() || "N/A",
                    fecha: columnas[1]?.textContent.trim() || "N/A",
                    tipo: columnas[2]?.textContent.trim() || "N/A",
                    detalle: columnas[3]?.textContent.trim() || "N/A",
                    aFs: columnas[4]?.textContent.trim() || ""
                };
            }, row);

            let archivoDescargadoStr = "";
            let downloadNumberForThisRow = null;
            const downloadButton = await row.$('td .fa.fa-download');

            // ─── NUEVO: capturar el href del icono “Ver” ───
            const viewButton = await row.$('td .fa.fa-eye');
            let viewHref = null;
            if (viewButton) {
            // .closest('a') porque el <i> está dentro del <a>
            viewHref = await page.evaluate(el => el.closest('a').href, viewButton);
            }

            // --- lógica de filtro según opción del usuario ---
            const filter = options.downloadFilter
                ? options.downloadFilter.toUpperCase()
                : null;
            const tipo = rowData.tipo.toUpperCase();
            const skipCedula = (filter === 'SC' || filter === 'SCSD') && tipo.includes('CEDULA');
            const skipDeo    = (filter === 'SD' || filter === 'SCSD') && tipo.includes('DEO');
            if (skipCedula || skipDeo) {
                console.log(`→ Omitida descarga de tipo '${rowData.tipo}' por filtro '${filter}'`);
            } else if (downloadButton && (options.maxDownloadsPerPage == null || localDownloadCount < options.maxDownloadsPerPage)) {
                const filesAntes = fs.readdirSync(carpetaDestino);
                await downloadButton.click();
                contadorGlobalArchivos++;      // Contador global
                localDownloadCount++;           // Contador local

                archivoDescargadoStr = `Archivo descargado ${contadorGlobalArchivos}`;
                downloadNumberForThisRow = contadorGlobalArchivos;
                // Esperar a que aparezca un nuevo archivo
                let newFileName = null;
                for (let i = 0; i < 10; i++) {
                    await esperar(1000);
                    const filesDespues = fs.readdirSync(carpetaDestino);
                    const nuevos = filesDespues.filter(f => !filesAntes.includes(f));
                    if (nuevos.length > 0) {
                        newFileName = nuevos[0];
                        break;
                    }
                }
                if (newFileName) {
                    mappingDescargas.push({
                        downloadNumber: downloadNumberForThisRow,
                        downloadLabel: archivoDescargadoStr,
                        finalPath: null
                    });
                } else {
                    console.warn("No se detectó nuevo archivo tras la descarga.");
                }
            }

            // Crear el objeto movimiento en lugar de un string
            const movimientoObj = {
                pagina: pagina,
                fila: index + 1,
                oficina: rowData.oficina,
                fecha: rowData.fecha,
                tipo: rowData.tipo,
                detalle: rowData.detalle,
                aFs: rowData.aFs,
                archivo: downloadNumberForThisRow ? "pending" : "nn", // Valor temporal
                downloadNumber: downloadNumberForThisRow, // Para asociar luego el mapping
                viewHref,    // ← aquí incluyes el enlace “Ver”
            };
            movimientos.push(movimientoObj);
            console.log(`Página ${pagina} | Fila ${index + 1} | Oficina: ${rowData.oficina} | Fecha: ${rowData.fecha} | Tipo: ${rowData.tipo} | Detalle: ${rowData.detalle}` +
                (rowData.aFs ? ` | A FS.: ${rowData.aFs}` : "") +
                (archivoDescargadoStr ? ` | Archivo: ${archivoDescargadoStr}` : ""));
        }
    }

    // Función para esperar a que finalicen las descargas (se mantiene sin modificaciones)
    async function esperarDescargasA(carpetaDestino, tiempoEspera = 5000) {
        return new Promise((resolve) => {
            let archivosPrevios = fs.readdirSync(carpetaDestino).length;
            let interval = setInterval(() => {
                let archivosActuales = fs.readdirSync(carpetaDestino).length;
                if (archivosActuales === archivosPrevios) {
                    clearInterval(interval);
                    resolve();
                } else {
                    archivosPrevios = archivosActuales;
                }
            }, tiempoEspera);
        });
    }

    // Función para ordenar y renombrar archivos, y actualizar el mapeo de descargas usando el número del label
    async function ordenarArchivosDescendentesA(carpetaDestino) {
        try {
            if (!fs.existsSync(carpetaDestino)) {
                console.warn(`La carpeta ${carpetaDestino} no existe. No hay archivos para ordenar.`);
                return;
            }
            console.log("Esperando que finalicen las descargas...");
            await esperarDescargasA(carpetaDestino);
            console.log("Descargas finalizadas. Procediendo con el ordenamiento.");
            let archivos = fs.readdirSync(carpetaDestino);
            let archivosFiltrados = archivos.filter(archivo => /^doc\d+/.test(archivo));
            archivosFiltrados.sort((a, b) => {
                let numA = parseInt(a.match(/doc(\d+)/)[1], 10);
                let numB = parseInt(b.match(/doc(\d+)/)[1], 10);
                return numB - numA;
            });
            archivosFiltrados.forEach((archivo, index) => {
                // Se renombra con el prefijo basado en el índice (por ejemplo: "1_doc1276714975.pdf")
                const nuevoNombre = `${index + 1}_${archivo}`;
                const rutaVieja = path.join(carpetaDestino, archivo);
                const rutaNueva = path.join(carpetaDestino, nuevoNombre);
                if (!/^[0-9]+_/.test(archivo)) {
                    fs.renameSync(rutaVieja, rutaNueva);
                    console.log(`Renombrado: ${archivo} -> ${nuevoNombre}`);
                    // Extraer el número del nuevo nombre (el número anterior al guión bajo)
                    const numeroRenombrado = parseInt(nuevoNombre.split('_')[0], 10);
                    // Buscar en mappingDescargas por downloadNumber y actualizar finalPath
                    mappingDescargas.forEach(mapping => {
                        if (mapping.downloadNumber === numeroRenombrado) {
                            mapping.finalPath = rutaNueva;
                        }
                    });
                }
            });
            console.log("Mapping de descargas:");
            console.log(mappingDescargas);
        } catch (error) {
            console.error("Error al ordenar y renombrar archivos:", error);
        }
    }

    try {
        // Se obtiene la información general para definir la carpeta de descargas
        const datosGenerales = await extraerDatosGenerales(page);
        const expediente = datosGenerales.expediente
            ? datosGenerales.expediente.replace(/[^a-zA-Z0-9]/g, "_")
            : "Expediente_Desconocido";
        const identificador = process.env.IDENTIFICADOR || "default";
        const carpetaDestino = path.join(
            getDataPath(),
            'descargas',
            `${identificador}_temp`,
            `${expediente}_actuales`
        );
        if (!fs.existsSync(carpetaDestino)) {
            fs.mkdirSync(carpetaDestino, { recursive: true });
        }

        // Si se van a procesar más de una página se consulta el total, de lo contrario solo se procesa la página 1
        if (options.maxPages !== 1) {
            console.log("\nDetectando el número total de páginas...");
            // Navegar a "Última página" para detectar el total de páginas
            await navegarPagina(SELECTORS.ultimaPagina);
            await page.waitForSelector(SELECTORS.paginaActiva, { timeout: 10000 });
            const totalPaginas = await obtenerPaginaActiva();
            console.log(`Total de páginas detectadas: ${totalPaginas}`);

            // Calcular cuántas páginas se procesarán, según el límite (maxPages)
            const paginasAProcesar = options.maxPages != null
                ? Math.min(totalPaginas, options.maxPages)
                : totalPaginas;
            console.log(`Se procesarán ${paginasAProcesar} páginas según la configuración.`);

            // Regresar a la primera página            
            console.log("Regresando a la página 1...");
            await navegarPagina(SELECTORS.primeraPagina);

            // —— Nuevo: salto hasta la página inicial definida por el usuario ——
            const start = Math.min(options.startPage, paginasAProcesar);
            if (start > 1) {
                for (let p = 1; p < start; p++) {
                    console.log(`Saltando de página ${p} a ${p + 1}…`);
                    await navegarPagina(SELECTORS.siguiente);
                }
            }

            // Arrancar la extracción desde la página correcta
            let paginaActual = start;
            await procesarPaginaActualA(paginaActual);

            // Iterar desde la siguiente hasta el límite
            for (let paginaEsperada = paginaActual + 1; paginaEsperada <= paginasAProcesar; paginaEsperada++) {
                console.log(`Navegando a la página ${paginaEsperada}…`);
                const prev = await page.$eval(SELECTORS.tabla, t => t.innerText);
                await navegarPagina(SELECTORS.siguiente);
                const activa = await obtenerPaginaActiva();
                if (activa !== paginaEsperada) {
                    console.warn(`Página activa (${activa}) ≠ esperada (${paginaEsperada}). Reintentando…`);
                    await esperar(2000);
                }
                await esperarTablaActualizada(prev);
                await procesarPaginaActualA(paginaEsperada);
            }
        } else {
            console.log("Procesando solo la página 1. No es necesaria la consulta al total de páginas.");
            await procesarPaginaActualA(1);
        }

        console.log("\nExtracción completada.");
        if (contadorGlobalArchivos > 0) {
            await ordenarArchivosDescendentesA(carpetaDestino);
        }
        console.log("Archivos ordenados y renombrados exitosamente.");

        // Actualizar cada movimiento que tenga downloadNumber para asignarle la ruta final
        movimientos.forEach(mov => {
            if (mov.downloadNumber) {
                const mapping = mappingDescargas.find(m => m.downloadNumber === mov.downloadNumber);
                mov.archivo = mapping && mapping.finalPath ? mapping.finalPath : "nn";
                // Opcional: eliminar la propiedad temporal
                delete mov.downloadNumber;
            }
        });
        // Se retorna tanto el array de movimientos como el mapping de descargas
        return { movimientos, mappingDescargas, completo: true };
    } catch (error) {
        console.error("Error al extraer la tabla de actuaciones:", error.message);
        return { movimientos, mappingDescargas, completo: false };
    }
}

// ITERAR Y EXTRAER TABLAS DE ACTUACIONES HISTORICAS
async function extraerTablaActuacionesHistoricas(page, options = {}) {
    // Configuración por defecto   
    const defaults = {
        maxPages: null,           // Si es null, se procesan todas las páginas
        maxRowsPerPage: null,     // Si es null, se procesan todas las filas por página
        maxDownloadsPerPage: null,// Si es null, se descargan todos los archivos encontrados
        mode: 'full',             // Modo por defecto: 'full'. Otros ejemplos: 'quick', 'test'
        downloadFilter: null,    // Filtro de descargas: null | 'SC' | 'SD' | 'SCSD'
        startPage: 1            // ← Página inicial por defecto
    };


    // Se mezclan las opciones recibidas con las por defecto
    options = { ...defaults, ...options };

    // Definir presets según el modo (se pueden agregar o modificar según se requiera)
    const modos = {
        full: { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null },
        quick1: { maxPages: 1, maxRowsPerPage: 1, maxDownloadsPerPage: 1 },
        quick5: { maxPages: 1, maxRowsPerPage: 5, maxDownloadsPerPage: 5 },
        quick15: { maxPages: 1, maxRowsPerPage: null, maxDownloadsPerPage: null }
    };

    if (options.mode && modos[options.mode]) {
        options = { ...options, ...modos[options.mode] };
    }

    // Selectores específicos para las actuaciones históricas
    const SELECTORS = {
        verHistoricas: '#expediente\\:btnActuacionesHistoricas a',
        alertaSinHistoricas: 'div.alert.white-panel.border-grey-sm',
        tabla: '#expediente\\:action-historic-table',
        filas: '#expediente\\:action-historic-table tbody tr'
    };

    const movimientosHistoricos = [];

    // Función para esperar un tiempo determinado (ms)
    const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Función para esperar que la tabla se actualice (por cambio en su innerText)
    const esperarTablaActualizada = async (prevContent) => {
        await page.waitForFunction(
            (selector, prev) => {
                const currentContent = document.querySelector(selector)?.innerText || "";
                return currentContent && currentContent !== prev;
            },
            {},
            SELECTORS.tabla,
            prevContent
        );
    };

    try {
        // Presionar el botón "Ver Históricas"
        console.log("\nPresionando botón 'Ver Históricas'...");
        const botonVerHistoricas = await page.$(SELECTORS.verHistoricas);
        if (botonVerHistoricas) {
            await botonVerHistoricas.click();
            await esperar(2000);
        } else {
            console.error("No se encontró el botón 'Ver Históricas'.");
            return [];
        }

        // Verificar si aparece la alerta de ausencia de actuaciones históricas
        const alertaSinHistoricas = await page.$(SELECTORS.alertaSinHistoricas);
        if (alertaSinHistoricas) {
            console.log("El expediente no posee actuaciones históricas.");
            return { movimientosHistoricos: [], completo: true, sinHistoricas: true };
        }

        // Verificar que la tabla histórica exista
        const tablaExiste = await page.$(SELECTORS.tabla);
        if (!tablaExiste) {
            console.error("No se encontró la tabla de actuaciones históricas.");
            return [];
        }

        // Obtener datos generales para definir la carpeta de descargas
        // (Se asume que la función extraerDatosGenerales está definida en otro módulo)
        const datosGenerales = await extraerDatosGenerales(page);
        const expediente = datosGenerales.expediente
            ? datosGenerales.expediente.replace(/[^a-zA-Z0-9]/g, "_")
            : "Expediente_Desconocido";
        const identificador = process.env.IDENTIFICADOR || "default";
        const carpetaDestino = path.join(
            getDataPath(),
            'descargas',
            `${identificador}_temp`,
            `${expediente}_historicas`
        );
        if (!fs.existsSync(carpetaDestino)) {
            fs.mkdirSync(carpetaDestino, { recursive: true });
        }
        await page._client().send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: carpetaDestino
        });

        let contadorGlobalArchivos = 0; // Contador global de descargas

        // Función que procesa la tabla de la página actual
        async function procesarPaginaActual(pagina) {
            console.log(`\nExtrayendo datos de la página ${pagina}...`);

            let nuevoContador = await page.$$eval(
                SELECTORS.filas,
                async (rows, paginaActual, contadorGlobal, maxRows, maxDownloads, downloadFilter) => {
                    // Convertir NodeList a Array
                    rows = Array.from(rows);
                    // Limitar el número de filas a procesar si se especifica
                    if (maxRows != null) {
                        rows = rows.slice(0, maxRows);
                    }
                    let localDownloadCount = 0; // Contador de descargas en esta página
                    let contadorArchivos = contadorGlobal; // Iniciar con el contador global
                    const resultados = [];
                    // Iterar secuencialmente sobre las filas seleccionadas
                    for (let index = 0; index < rows.length; index++) {
                        const row = rows[index];
                        const columnas = row.querySelectorAll('td span.font-color-black, td span.font-negrita');
                        const oficina = columnas[0]?.textContent.trim() || "N/A";
                        const fecha = columnas[1]?.textContent.trim() || "N/A";
                        const tipo = columnas[2]?.textContent.trim() || "N/A";
                        const detalle = columnas[3]?.textContent.trim() || "N/A";
                        const aFs = columnas[4]?.textContent.trim() || "";
                        const tieneArchivo = row.querySelector('td .fa.fa-download');
                        let archivoDescargado = null;
                        const viewBtn = row.querySelector('td .fa.fa-eye');
                        const viewHref = viewBtn
                            ? row.querySelector('td .fa.fa-eye').closest('a').href
                            : null;
                        // --- downloadFilter logic ---
                        const filter = downloadFilter ? downloadFilter.toUpperCase() : null;
                        const tipoUpper = tipo.toUpperCase();
                        const skipCedula = (filter === 'SC' || filter === 'SCSD') && tipoUpper.includes('CEDULA');
                        const skipDeo    = (filter === 'SD' || filter === 'SCSD') && tipoUpper.includes('DEO');
                        if (skipCedula || skipDeo) {
                            // Omitir descarga
                            // (No hay console.log en $$eval, pero puedes marcarlo en el resultado si quieres)
                        } else if (tieneArchivo && (maxDownloads == null || localDownloadCount < maxDownloads)) {
                            await tieneArchivo.click();
                            contadorArchivos++;      // Incrementa el contador global
                            localDownloadCount++;    // Incrementa el contador local de descargas
                            archivoDescargado = `Archivo descargado ${contadorArchivos}`;
                        }
                          // AÑADE ESTE console.log PARA IMPRIMIR EL FORMATO ORIGINAL:
                        console.log(
                            `Página ${paginaActual} | Fila ${index+1}` +
                            ` | Oficina: ${oficina}` +
                            ` | Fecha: ${fecha}` +
                            ` | Tipo actuación: ${tipo}` +
                            ` | Detalle: ${detalle}` +
                            (aFs ? ` | A FS.: ${aFs}` : '') +
                            (archivoDescargado ? ` | Archivo: ${archivoDescargado}` : '') +
                            ` | viewHref: ${viewHref}`
                        );
                        resultados.push({
                            pagina: paginaActual,
                            fila: index+1,
                            oficina,
                            fecha,
                            tipo,
                            detalle,
                            aFs,
                            archivo: archivoDescargado || "",
                            viewHref      // ← aquí tienes el enlace o null
                          });
                    }
                    return { resultados, nuevoContador: contadorArchivos };
                },
                pagina,
                contadorGlobalArchivos,
                options.maxRowsPerPage,
                options.maxDownloadsPerPage,
                options.downloadFilter
            );
            // Actualizar el contador global de descargas
            contadorGlobalArchivos = nuevoContador.nuevoContador;
            nuevoContador.resultados.forEach(fila => {
                movimientosHistoricos.push(fila);
                console.log(
                    `Página ${fila.pagina} | Fila ${fila.fila}` +
                    ` | Oficina: ${fila.oficina}` +
                    ` | Fecha: ${fila.fecha}` +
                    ` | Tipo actuación: ${fila.tipo}` +
                    ` | Detalle: ${fila.detalle}` +
                    (fila.aFs    ? ` | A FS.: ${fila.aFs}`    : '') +
                    (fila.archivo? ` | Archivo: ${fila.archivo}`: '') +
                    ` | viewHref: ${fila.viewHref}`
                  );
            });
        }

        // Función para esperar a que finalicen las descargas
        async function esperarDescargas(carpetaDestino, tiempoEspera = 5000) {
            return new Promise((resolve) => {
                let archivosPrevios = fs.readdirSync(carpetaDestino).length;
                let interval = setInterval(() => {
                    let archivosActuales = fs.readdirSync(carpetaDestino).length;
                    if (archivosActuales === archivosPrevios) {
                        clearInterval(interval);
                        resolve();
                    } else {
                        archivosPrevios = archivosActuales;
                    }
                }, tiempoEspera);
            });
        }

        // Función para ordenar y renombrar archivos descargados
        async function ordenarArchivosDescendentes(carpetaDestino) {
            try {
                if (!fs.existsSync(carpetaDestino)) {
                    console.warn(`La carpeta ${carpetaDestino} no existe. No hay archivos para ordenar.`);
                    return;
                }
                console.log("Esperando que finalicen las descargas...");
                await esperarDescargas(carpetaDestino);
                console.log("Descargas finalizadas. Procediendo con el ordenamiento.");
                let archivos = fs.readdirSync(carpetaDestino);
                let archivosFiltrados = archivos.filter(archivo => /^doc\d+/.test(archivo));
                archivosFiltrados.sort((a, b) => {
                    let numA = parseInt(a.match(/doc(\d+)/)[1], 10);
                    let numB = parseInt(b.match(/doc(\d+)/)[1], 10);
                    return numB - numA;
                });
                archivosFiltrados.forEach((archivo, index) => {
                    const nuevoNombre = `${index + 1}_${archivo}`;
                    const rutaVieja = path.join(carpetaDestino, archivo);
                    const rutaNueva = path.join(carpetaDestino, nuevoNombre);
                    if (!/^[0-9]+_/.test(archivo)) {
                        fs.renameSync(rutaVieja, rutaNueva);
                        console.log(`Renombrado: ${archivo} -> ${nuevoNombre}`);
                    }
                });
            } catch (error) {
                console.error("Error al ordenar y renombrar archivos:", error);
            }
        }

        // —— Nuevo: navegar hasta la página inicial definida por el usuario ——
        const start = Math.min(options.startPage, /* opcional: totalPages si lo detectas */);
        if (start > 1) {
            console.log(`Saltando de página 1 a página ${start} de históricas…`);
            for (let p = 1; p < start; p++) {
                // Capturamos el contenido actual para luego detectar el cambio
                const prev = await page.$eval(SELECTORS.tabla, t => t.innerText);
                // Hacemos click en “Siguiente”
                await page.evaluate(() => {
                    const xpath = "//a[.//span[contains(text(), 'Siguiente')]]";
                    const btn = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (btn) btn.click();
                });
                // Esperamos que la tabla se actualice
                await esperarTablaActualizada(prev);
            }
        }
        // Ahora inicializamos la página desde start en lugar de 1
        let pagina = start;

        // Iterar sobre las páginas utilizando el paginador propio de las actuaciones históricas
        
        let continuar = true;
        while (continuar) {
            await procesarPaginaActual(pagina);

            // Si se ha definido un límite de páginas, detener la iteración
            if (options.maxPages !== null && pagina >= options.maxPages) {
                break;
            }

            // Buscar el botón "Siguiente" mediante XPath
            const botonSiguienteExiste = await page.evaluate(() => {
                const xpath = "//a[.//span[contains(text(), 'Siguiente')]]";
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue !== null;
            });

            if (botonSiguienteExiste) {
                console.log("Navegando a la siguiente página...");
                const previousContent = await page.$eval(SELECTORS.tabla, table => table.innerText);
                await page.evaluate(() => {
                    const xpath = "//a[.//span[contains(text(), 'Siguiente')]]";
                    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    if (result.singleNodeValue) {
                        result.singleNodeValue.click();
                    }
                });
                await esperarTablaActualizada(previousContent);
                pagina++;
            } else {
                console.log("No se puede navegar más. Fin de las páginas.");
                continuar = false;
            }
        }

        console.log("\nExtracción completada de las actuaciones históricas.");
        console.log(`Total de movimientos históricos extraídos: ${movimientosHistoricos.length}`);
        if (contadorGlobalArchivos > 0) {
            await ordenarArchivosDescendentes(carpetaDestino);
        }
        console.log("Archivos ordenados y renombrados exitosamente.");
        return { movimientosHistoricos, completo: true, sinHistoricas: false };

    } catch (error) {
        console.error("Error al extraer las actuaciones históricas:", error.message);
        return { movimientosHistoricos: movimientosHistoricos || [], completo: false, sinHistoricas: false };
    }
}

// =============================================================================
// Wrappers con Reintentos (utilizando el helper reintentarOperacion)
// =============================================================================

async function extraerTablaActuacionesConReintentos(page, options = {}) {
    return await reintentarOperacion(() => extraerTablaActuaciones(page, options), 3, 5000);
}

async function extraerTablaActuacionesHistoricasConReintentos(page, options = {}) {
    return await reintentarOperacion(() => extraerTablaActuacionesHistoricas(page, options), 3, 5000);
}

// =============================================================================
// Funciones Iterativas para Recorrer Páginas del Paginador
// Se inspiran en la lógica de iterarListaExpedientes de testM1.js (véase :contentReference[oaicite:4]{index=4}&#8203;:contentReference[oaicite:5]{index=5})
// =============================================================================

async function iterarTablaActuaciones(page, options = {}) {
    // Fusionar defaults y presets para que se respete el modo (por ejemplo, quick5)
    const defaults = { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null, mode: 'full' };
    options = { ...defaults, ...options };
    const modos = {
        full: { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null },
        quick1: { maxPages: 1, maxRowsPerPage: 1, maxDownloadsPerPage: 1 },
        quick5: { maxPages: 1, maxRowsPerPage: 5, maxDownloadsPerPage: 5 },
        quick5mam: { maxPages: 1, maxRowsPerPage: 5, maxDownloadsPerPage: 0 },
        quick15: { maxPages: 1, maxRowsPerPage: null, maxDownloadsPerPage: null }
    };
    if (options.mode && modos[options.mode]) {
        options = { ...options, ...modos[options.mode] };
    }

    // Debug: verifica el valor final de maxPages
    console.log(`[DEBUG] iterarTablaActuaciones: options.maxPages = ${options.maxPages}`);

    const SELECTORS = {
        tabla: '#expediente\\:action-table',
        filas: '#expediente\\:action-table tbody tr',
        paginaActiva: '.pagination.no-margin.no-padding li.active span',
        siguiente: 'li a span[title="Siguiente"]'
    };
    const movimientos = [];
    let paginaActual = 1;
    let continuar = true;
    const maxPaginas = options.maxPages; // Ahora se respeta el preset (1 para 'quick5')

    while (continuar) {
        console.log(`Extrayendo datos en página ${paginaActual}...`);
        let resultado = await extraerTablaActuacionesConReintentos(page, options);
        if (resultado && resultado.movimientos) {
            const movs = Array.isArray(resultado.movimientos) ? resultado.movimientos : [resultado.movimientos];
            movimientos.push(...movs);
        } else {
            console.warn(`No se extrajeron datos en la página ${paginaActual}.`);
        }
        // Si se definió un límite de páginas y ya se alcanzó, salir
        if (maxPaginas !== null && paginaActual >= maxPaginas) {
            console.log(`Se alcanzó el límite de páginas definido (${maxPaginas}).`);
            break;
        }
        const botonSiguiente = await page.$(SELECTORS.siguiente);
        if (botonSiguiente) {
            const contenidoActual = await page.$eval(SELECTORS.tabla, el => el.innerText);
            await Promise.all([
                botonSiguiente.click(),
                page.waitForFunction(
                    (selector, previo) => {
                        const el = document.querySelector(selector);
                        return el && el.innerText && el.innerText !== previo;
                    },
                    { timeout: 30000 },
                    SELECTORS.tabla,
                    contenidoActual
                )
            ]);
            paginaActual++;
        } else {
            continuar = false;
        }
    }
    return { movimientos };
}

async function iterarTablaActuacionesHistoricas(page, options = {}) {
    // Fusionar opciones para respetar el modo (similar al anterior)
    const defaults = { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null, mode: 'full' };
    options = { ...defaults, ...options };
    const modos = {
        full: { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null },
        quick1: { maxPages: 1, maxRowsPerPage: 1, maxDownloadsPerPage: 1 },
        quick5: { maxPages: 1, maxRowsPerPage: 5, maxDownloadsPerPage: 5 },
        quick15: { maxPages: 1, maxRowsPerPage: null, maxDownloadsPerPage: null }
    };
    if (options.mode && modos[options.mode]) {
        options = { ...options, ...modos[options.mode] };
    }
    console.log(`[DEBUG] iterarTablaActuacionesHistoricas: options.maxPages = ${options.maxPages}`);

    const SELECTORS = {
        tabla: '#expediente\\:action-historic-table',
        filas: '#expediente\\:action-historic-table tbody tr',
        siguiente: 'li a span[title="Siguiente"]'
    };
    const movimientosHistoricos = [];
    let paginaActual = 1;
    let continuar = true;
    const maxPaginas = options.maxPages;

    while (continuar) {
        console.log(`Extrayendo datos históricos en página ${paginaActual}...`);
        let resultado = await extraerTablaActuacionesHistoricasConReintentos(page, options);
        if (resultado && resultado.movimientos) {
            const movs = Array.isArray(resultado.movimientos) ? resultado.movimientos : [resultado.movimientos];
            movimientosHistoricos.push(...movs);
        } else {
            console.warn(`No se extrajeron datos históricos en la página ${paginaActual}.`);
        }
        if (maxPaginas !== null && paginaActual >= maxPaginas) {
            console.log(`Se alcanzó el límite de páginas definido (${maxPaginas}) para históricas.`);
            break;
        }
        const botonSiguiente = await page.$(SELECTORS.siguiente);
        if (botonSiguiente) {
            const contenidoActual = await page.$eval(SELECTORS.tabla, el => el.innerText);
            await Promise.all([
                botonSiguiente.click(),
                page.waitForFunction(
                    (selector, previo) => {
                        const el = document.querySelector(selector);
                        return el && el.innerText && el.innerText !== previo;
                    },
                    { timeout: 30000 },
                    SELECTORS.tabla,
                    contenidoActual
                )
            ]);
            paginaActual++;
        } else {
            continuar = false;
        }
    }
    return { movimientosHistoricos };
}

// =============================================================================
// Otras Funciones de Interacción y Generación de Informes
// =============================================================================

// Ejemplo: CLICK EN VER ACTUALES
async function clickEnVerActuales(page) {
    const SELECTORS = {
        verActuales: 'a.btn.pull-right',
        primeraPagina: 'li a span[title="Primera página"]',
        tabla: '#expediente\\:action-table'
    };
    const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    try {
        console.log("Buscando el botón 'Ver actuales'...");
        const botonVerActuales = await page.$(SELECTORS.verActuales);
        if (botonVerActuales) {
            console.log("Botón 'Ver actuales' encontrado, haciendo clic...");
            await botonVerActuales.click();
            await esperar(5000);
        } else {
            console.error("No se encontró el botón 'Ver actuales'.");
            return;
        }
        console.log("Esperando que se cargue la tabla de actuales...");
        await page.waitForSelector(SELECTORS.tabla, { timeout: 10000 });
        console.log("Clic en 'Primera página' para reiniciar la navegación.");
        const botonPrimeraPagina = await page.$(SELECTORS.primeraPagina);
        if (botonPrimeraPagina) {
            await botonPrimeraPagina.click();
            await esperar(2000);
        }
    } catch (error) {
        console.error("Error en clickEnVerActuales:", error.message);
    }
}

// Ejemplo: MANEJAR CHECKBOXES
async function manejarCheckboxes(page, combinacion) {
    const CHECKBOX_SELECTORS = {
        DE: '#expediente\\:checkBoxDespachosYEscritosId',
        N: '#expediente\\:checkBoxnotaelEctronicasYPapelId',
        I: '#expediente\\:checkBoxInformacionesId',
        VT: '#expediente\\:checkBoxOtrasActuacionesId'
    };
    const APLICAR_SELECTOR = '#expediente\\:filtrarActuacionesBtn';
    const combinacionesValidas = ['DE', 'N', 'I', 'VT', 'DEN', 'DEI', 'NI', 'DENI'];
    if (!combinacionesValidas.includes(combinacion)) {
        throw new Error(`Combinación inválida: ${combinacion}`);
    }
    console.log(`Procesando la combinación: ${combinacion}`);
    try {
        await page.waitForSelector(APLICAR_SELECTOR, { timeout: 15000 });
        for (const clave in CHECKBOX_SELECTORS) {
            if (combinacion.includes(clave)) {
                const selectorClave = CHECKBOX_SELECTORS[clave];
                const checkbox = await page.$(selectorClave);
                if (!checkbox) {
                    console.error(`Checkbox no encontrado para clave: ${clave}`);
                    continue;
                }
                const isChecked = await page.evaluate(el => el.checked, checkbox);
                if (!isChecked) {
                    await checkbox.click();
                    console.log(`Checkbox '${clave}' seleccionado.`);
                } else {
                    console.log(`Checkbox '${clave}' ya estaba seleccionado.`);
                }
            }
        }
        console.log("Todos los checkboxes procesados. Aplicando cambios...");
        await page.click(APLICAR_SELECTOR);
        await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
        console.error("Error en manejarCheckboxes:", error.message);
        throw error;
    }
}

// ——— Utilitario para obtener un ElementHandle vía XPath ———
async function getElementByXPath(page, xpath, timeout = 5000) {
    // Esperamos brevemente por si el nodo tarda en renderizarse
    const handle = await page.waitForFunction(
      xp => {
        const result = document.evaluate(
          xp,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue;
      },
      { timeout },
      xpath
    ).catch(() => null);
  
    if (!handle) return null;
    // El valor devuelto por waitForFunction es un JSHandle; 
    // debemos extraer el nodo real con .asElement()
    const element = handle.asElement();
    return element;
  }
// Ejemplo: CLICK EN VER VARIOS
async function clickEnVerVarios(page, secciones) {
    const SELECTORS = {
        intervinientes:    "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Intervinientes']]",
        vinculados:        "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Vinculados']]",
        recursos:          "//td[contains(@class, 'rf-tab-hdr') and .//span[text()='Recursos']]",
        vinculadosContent: "[id^='expediente:'][id$=':content']",
        recursosContent:   "[id^='expediente:'][id$=':content']",
        tablaIntervinientes: "[id='expediente:intervinientesTab']",
        tablaPartes:         "[id='expediente:participantsTable']",
        tablaFiscales:       "[id='expediente:fiscalesTable']",
        tablaVinculados:     "[id='expediente:vinculadosTab']",
        tablaRecursos:       "[id='expediente:recursosTab']"
      };

      const esperar = ms => new Promise(res => setTimeout(res, ms));
      const resultados = { intervinientes: [], vinculados: [], recursos: [] };

  for (const seccion of secciones) {
    try {
        console.log(`Buscando el botón '${seccion}'...`);
        const selector = SELECTORS[seccion];
        let botonHandle = null;
  
        if (selector.trim().startsWith('//')) {
          // XPath
          botonHandle = await getElementByXPath(page, selector);
        } else {
          // CSS
          botonHandle = await page.$(selector);
        }
  
        if (!botonHandle) {
          console.error(`No se encontró el botón '${seccion}'.`);
          continue;
        }
  
        console.log(`Haciendo clic en '${seccion}'...`);
        await botonHandle.click();
        await esperar(3000);

            let tablas = [];
            if (seccion === 'intervinientes') {
                tablas = ['tablaIntervinientes', 'tablaPartes', 'tablaFiscales'];

            } else if (seccion === 'vinculados') {
                tablas = ['tablaVinculados'];

                // ——— Detección de alerta “no posee vinculados” ———
                const xpathV = `//*[starts-with(@id, 'expediente:') 
                and substring(@id, string-length(@id) -7) = ':content']
                //div[contains(@class,'alert') 
                and contains(., 'no posee vinculados')]`;

                // Usando tu helper getElementByXPath:
                const alertaV = await getElementByXPath(page, xpathV);

                if (alertaV) {
                const msgV = (await page.evaluate(el => el.textContent.trim(), alertaV));
                resultados.vinculados.push(msgV);
                console.log(`Alerta vinculados (XPath corregido): ${msgV}`);
                tablas = [];
                }


            } else if (seccion === 'recursos') {
                tablas = ['tablaRecursos'];

                // ——— Detección de alerta “no posee recursos” ———
                // ——— XPath CORREGIDO para “no posee recursos” ———
                const xpathR = `//*[starts-with(@id, 'expediente:')
                and substring(@id, string-length(@id) - 7) = ':content']
                //div[contains(@class,'alert') and contains(., 'no posee recursos')]`;

                const alertaR = await getElementByXPath(page, xpathR);

                if (alertaR) {
                const msgR = (await page.evaluate(el => el.textContent.trim(), alertaR));
                resultados.recursos.push(msgR);
                console.log(`Alerta recursos (XPath corregido): ${msgR}`);
                tablas = [];
                }

            }

            // Extracción estándar de tablas (si quedan tablas asignadas)
            for (const tabla of tablas) {
                console.log(`Verificando tabla '${tabla}'...`);
                const tablaVisible = await page
                    .waitForSelector(SELECTORS[tabla], { timeout: 5000 })
                    .catch(() => null);

                if (!tablaVisible) {
                    console.warn(`No se encontró '${tabla}'.`);
                    continue;
                }

                console.log(`Extrayendo datos de '${tabla}'...`);
                const tableHandle = await page.$(SELECTORS[tabla]);
                const tableData = await tableHandle.evaluate(table => {
                    return Array.from(table.querySelectorAll('tr'))
                        .map(row => Array.from(row.querySelectorAll('th, td'))
                            .map(cell => cell.innerText.trim())
                            .join('|')
                        );
                });

                resultados[seccion].push(...tableData);
            }

        } catch (error) {
            console.error(`Error en sección '${seccion}':`, error);
        }
    }

    return resultados;
}

// CLICK Y EXTRAER NOTAS - Versión mejorada con manejo de alerta de "no posee notas"
async function extraerTablaNotas(page, maxPaginas = 'T') {
    const selectorContenedor = '#expediente\\:tableNotas';
    const selectorAlerta = '#expediente\\:tableNotas .alert span strong';
    const selectorTabla = '#expediente\\:notas-table';
    const selectorFilas = '#expediente\\:notas-table tbody tr';
    const selectorTitulos = '#expediente\\:notas-table thead tr th';
    const selectorPaginas = 'div#expediente\\:tableNotas ul.pagination li a';
    const selectorPaginaActiva = 'div#expediente\\:tableNotas ul.pagination li.active span';

    const notas = [];
    const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

    try {
        // Esperar a que el contenedor de notas esté presente
        await page.waitForSelector(selectorContenedor, { timeout: 5000 });

        // Verificar si existe la alerta de "no posee notas"
        const mensajeAlerta = await page.$eval(selectorAlerta, el => el.textContent.trim()).catch(() => null);
        if (mensajeAlerta && mensajeAlerta.includes('El expediente no posee notas')) {
            return [mensajeAlerta];
        }

        // Si no hay alerta, intentar extraer la tabla normalmente
        await page.waitForSelector(selectorTabla, { timeout: 2000 });
        // Extraer los títulos de la tabla una sola vez
        const titulos = await page.$$eval(selectorTitulos, ths =>
            ths.map(th => th.textContent.trim())
        );
        if (!titulos.length) {
            throw new Error("No se encontraron títulos de columna en la tabla");
        }

        // Obtener las páginas disponibles desde el paginador
        const paginasDisponibles = await page.$$eval(selectorPaginas, enlaces =>
            enlaces.map(enlace => enlace.textContent.trim())
        );
        const totalPaginas = paginasDisponibles.length;
        const paginasALeer = maxPaginas === 'T' ? totalPaginas : Math.min(maxPaginas, totalPaginas);

        // Función para navegar a una página específica y confirmar la navegación
        const navegarPagina = async (numeroPagina) => {
            await page.evaluate((selector, numeroPagina) => {
                const enlaces = Array.from(document.querySelectorAll(selector));
                const enlace = enlaces.find(el => el.textContent.trim() === numeroPagina);
                if (enlace) {
                    enlace.click();
                }
            }, selectorPaginas, numeroPagina);
            await page.waitForFunction(
                (selector, numeroPagina) => {
                    const activo = document.querySelector(selector);
                    return activo && activo.textContent.trim() === numeroPagina;
                },
                { timeout: 3000 },
                selectorPaginaActiva,
                numeroPagina
            );
            await page.waitForSelector(selectorFilas, { timeout: 3000 });
        };

        for (let i = 0; i < paginasALeer; i++) {
            const paginaActual = paginasDisponibles[i];
            console.log(`Procesando página ${paginaActual} de ${paginasALeer}`);
            await navegarPagina(paginaActual);
            await esperar(500);
            const filas = await page.$$eval(selectorFilas, (rows, paginaActual, titulos) => {
                return rows.map((row, index) => {
                    const columnas = row.querySelectorAll('td');
                    const fecha = columnas[0]?.textContent.trim() || "N/A";
                    const interviniente = columnas[1]?.textContent.trim() || "N/A";
                    const descripcion = columnas[2]?.textContent.trim() || "N/A";
                    return `Página ${paginaActual} | Fila ${index + 1} | ${titulos[0]}: ${fecha} | ${titulos[1]}: ${interviniente} | ${titulos[2]}: ${descripcion}`;
                });
            }, paginaActual, titulos);
            filas.forEach(fila => {
                notas.push(fila);
                console.log(fila);
            });
        }
        console.log("Extracción completada. Total de notas extraídas:", notas.length);
        return notas;
    } catch (error) {
        if (error.message && error.message.includes('failed to find element matching selector')) {
            return ["El expediente no posee notas"];
        }
        console.error("Error al extraer la tabla de notas:", error.message);
        return notas;
    }
}

// GENERAR INFORME PDF

async function generarPDFExpediente(
    datosGenerales,
    movimientos,
    movimientosHistoricos,
    intervinientes,
    vinculados,
    recursos,
    notas,
    hrefma = false,    // <— mostrar enlaces en actuales
    hrefmh = false     // <— mostrar enlaces en históricos
  ) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    page.setSize(600, 800);
    const { width, height } = page.getSize();
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    page.setFont(font);

    // Paleta de colores (alineada con visores HTML)
    const C_BLUE       = rgb(0.129, 0.588, 0.953);  // #2196F3
    const C_BLUE_LIGHT = rgb(0.878, 0.933, 0.992);  // #E0EFFE
    const C_GREEN      = rgb(0.298, 0.686, 0.314);  // #4CAF50
    const C_GRAY       = rgb(0.459, 0.459, 0.459);  // #757575
    const C_LGRAY      = rgb(0.878, 0.878, 0.878);  // #E0E0E0
    const C_WHITE      = rgb(1, 1, 1);
    const C_BLACK      = rgb(0.129, 0.129, 0.129);  // #212121

    // Definir márgenes
    const marginLeft = 50;
    const marginRight = 50;
    const maxWidth = width - marginLeft - marginRight;
    const lineSpacing = 20;
    const sectionSpacing = 28;

    // ── Footer helper ────────────────────────────────────────────────────────
    function dibujarFooter(pg, pageNum) {
        try {
            const fechaStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const footerText = `Sistema Procurador SCW  |  Generado: ${fechaStr}  |  Pág. ${pageNum}`;
            pg.drawRectangle({ x: marginLeft, y: 42, width: maxWidth, height: 0.5, color: C_LGRAY });
            pg.drawText(footerText, { x: marginLeft, y: 28, size: 7, font, color: C_GRAY });
        } catch (_) {}
    }

    let pageCount = 1;
    let y = height - 50;

    // Función para verificar si se debe agregar una nueva página
    function checkPageBreak() {
        if (y < 60) {
            dibujarFooter(page, pageCount);
            pageCount++;
            page = pdfDoc.addPage();
            page.setSize(600, 800);
            y = height - 50;
            page.setFont(font);
        }
    }

    // Reemplazar caracteres no soportados por WinAnsi (Helvetica)
    function sanitize(text) {
        return String(text || '')
            .normalize('NFC')                          // descompuesto → precompuesto (ü en vez de u+̈)
            .replace(/[\u0096\u2013\u2014]/g, '-')     // guiones especiales
            .replace(/[\u0300-\u036F]/g, '');          // eliminar diacríticos combinantes residuales
    }

    // Función para agregar texto ajustado sin pasar "\n" directamente a drawText.
    // Primero separamos la cadena por saltos de línea y luego aplicamos el ajuste de palabra.
    function agregarTextoAjustado(texto, size = 12) {
        // Separa por saltos de línea para evitar caracteres "\n" y sanitiza los fragmentos
        const lineSegments = sanitize(texto).split("\n");
        lineSegments.forEach((segment) => {
            // Si el segmento parece una URL (http/https), usar la función especial
            if (/^https?:\/\//.test(segment)) {
                agregarTextoAjustadoURL(segment, size);
            } else {
                const words = segment.split(" ");
                let line = "";
                for (let word of words) {
                    let testLine = line ? line + " " + word : word;
                    const testWidth = font.widthOfTextAtSize(testLine, size);
                    if (testWidth > maxWidth) {
                        // Si la línea actual está vacía, significa que la palabra es demasiado larga
                        if (line === "") {
                            for (let char of word) {
                                let testCharLine = line + char;
                                if (font.widthOfTextAtSize(testCharLine, size) > maxWidth) {
                                    page.drawText(line, { x: marginLeft, y, size, font, color: C_BLACK });
                                    y -= lineSpacing;
                                    checkPageBreak();
                                    line = char;
                                } else {
                                    line = testCharLine;
                                }
                            }
                        } else {
                            // Dibuja la línea actual y reinicia
                            page.drawText(line, { x: marginLeft, y, size, font, color: C_BLACK });
                            y -= lineSpacing;
                            checkPageBreak();
                            line = word;
                        }
                    } else {
                        line = testLine;
                    }
                }
                if (line) {
                    page.drawText(line, { x: marginLeft, y, size, font, color: C_BLACK });
                    y -= lineSpacing;
                    checkPageBreak();
                }
            }
        });
    }

    // Función para dibujar un hipervínculo como "→ Ver documento" con anotación PDF clickeable
    function agregarTextoAjustadoURL(url, initialSize = 10) {
        const label = '-> Ver documento';
        const lblW  = font.widthOfTextAtSize(label, initialSize);
        const xPos  = marginLeft + 12;
        page.drawText(label, { x: xPos, y, size: initialSize, font, color: C_BLUE });
        try {
            const linkAnnot = pdfDoc.context.obj({
                Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
                Rect: [xPos, y, xPos + lblW, y + initialSize],
                Border: [0, 0, 0],
                A: pdfDoc.context.obj({ Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(url) }),
            });
            const annots = page.node.Annots();
            if (annots) { annots.push(linkAnnot); }
            else { page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnot])); }
        } catch (_) {}
        y -= lineSpacing;
        checkPageBreak();
    }

    // Función para agregar secciones con diseño visual (acento lateral + título bold azul)
    function agregarSeccion(titulo, datos) {
        if (datos.length > 0) {
            y -= sectionSpacing * 0.6;
            checkPageBreak();
            // Fondo de la fila del título
            page.drawRectangle({ x: marginLeft - 5, y: y - 4, width: maxWidth + 10, height: 20, color: C_BLUE_LIGHT });
            // Barra lateral azul
            page.drawRectangle({ x: marginLeft - 5, y: y - 4, width: 4, height: 20, color: C_BLUE });
            // Texto del título
            page.drawText(sanitize(titulo), { x: marginLeft + 6, y: y + 2, size: 11, font: fontBold, color: C_BLUE });
            y -= lineSpacing;
            // Línea separadora suave
            page.drawRectangle({ x: marginLeft, y, width: maxWidth, height: 0.5, color: C_LGRAY });
            y -= 6;
            datos.forEach((dato) => {
                agregarTextoAjustado(dato, 10);
            });
        }
    }

    // ── HEADER VISUAL ─────────────────────────────────────────────────────────
    // Banda azul superior
    page.drawRectangle({ x: 0, y: height - 85, width, height: 85, color: C_BLUE });
    // Título: número de expediente
    page.drawText(sanitize(datosGenerales.expediente || 'Expediente'), { x: marginLeft, y: height - 35, size: 16, font: fontBold, color: C_WHITE });
    // Subtítulo: jurisdicción | dependencia
    const subHeader = sanitize(`${datosGenerales.jurisdiccion || ''}  |  ${datosGenerales.dependencia || ''}`);
    page.drawText(subHeader, { x: marginLeft, y: height - 55, size: 9, font, color: C_BLUE_LIGHT });
    // Situación actual
    const sitLabel = sanitize(`Situacion: ${datosGenerales.situacion_actual || ''}`);
    page.drawText(sitLabel, { x: marginLeft, y: height - 70, size: 9, font, color: C_BLUE_LIGHT });
    // Línea inferior del header
    page.drawRectangle({ x: 0, y: height - 86, width: width, height: 1, color: C_GREEN });

    y = height - 105;

    // Carátula debajo del header (puede ser larga)
    agregarTextoAjustado(sanitize('Caratula: ' + (datosGenerales.caratula || '')), 10);

    // ==== Resumen: helpers de configuración y construcción ====
    function cargarConfigResumen() {
        try {
            const p = path.join(getDataPath(), 'config_informe_resumen.json');
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf-8');
                const json = JSON.parse(raw);
                if (json && Array.isArray(json.tipos)) return json;
            }
        } catch (e) {
            console.warn('[Resumen] No se pudo leer config_informe_resumen.json:', e.message);
        }
        return { tipos: [] };
    }

    /**
     * Normaliza strings para comparación case-insensitive
     */
    function norm(s) {
        return (s || '').toString().trim().toUpperCase();
    }

    /**
     * Construye líneas para el PDF del bloque "Resumen"
     * @param {Array} movs - listaMovimientos (actuales)
     * @param {Array} movsH - listaMovimientosHistoricos (históricos)
     * @param {Object} cfg - { tipos: [...] } del JSON
     * @returns {Array<string>}
     */
    function construirResumen(movs, movsH, cfg) {
        const out = [];
        if (!cfg || !Array.isArray(cfg.tipos) || cfg.tipos.length === 0) {
            return out; // sin config => no se imprime resumen
        }

        const seguros = (arr) => Array.isArray(arr) ? arr : [];
        const actuales = seguros(movs);
        const historicos = seguros(movsH);

        for (const regla of cfg.tipos) {
            const tipoBuscado = norm(regla.tipo);
            const fuente = (regla.fuente || 'ambos').toLowerCase();          // actuales | historicos | ambos
            const modo = (regla.mostrar || 'todas').toLowerCase();           // todas | primera | detalle
            const kw = Array.isArray(regla.detalle_includes) ? regla.detalle_includes.map(norm) : [];
            const leyendaVacio = regla.sinDatosLeyenda || `Sin información según el parámetro solicitado para ${regla.tipo}.`;

            let universo = [];
            if (fuente === 'actuales') universo = actuales;
            else if (fuente === 'historicos') universo = historicos;
            else universo = [...actuales, ...historicos];

            // Filtrar por tipo exacto (case-insensitive)
            let candidatos = universo.filter(m => norm(m.tipo) === tipoBuscado);

            // Ajuste por "detalle"
            if (modo === 'detalle' && kw.length > 0) {
                candidatos = candidatos.filter(m => {
                    const d = norm(m.detalle);
                    return kw.some(k => d.includes(k));
                });
            }

            // Ajuste por "primera" = tomar la última del array
            // (si tu listado viene de más reciente → más antiguo, esto devuelve la más antigua)
            if (modo === 'primera' && candidatos.length > 1) {
                candidatos = [candidatos[candidatos.length - 1]];
            }

            if (candidatos.length === 0) {
                out.push(`• ${regla.tipo}: ${leyendaVacio}`);
                continue;
            }

            // Formateo similar al de "Movimientos"
            for (const mov of candidatos) {
                let linea = `${mov.fecha || ''} - ${mov.tipo || ''}: ${mov.detalle || ''}`;
                if (mov.aFs) linea += ` | ${mov.aFs}`;
                if (mov.archivo && mov.archivo !== 'nn') {
                    const fileName = path.basename(mov.archivo);
                    linea += ` Archivo: ${fileName}`;
                }
                if (mov.viewHref) linea += `\n${mov.viewHref}`;
                out.push(linea);
            }
        }

        return out;
    }

    // ==== RESUMEN (antes de "Movimientos") ====
    const resumenCfg = cargarConfigResumen();
    const resumenParaPDF = construirResumen(movimientos, movimientosHistoricos, resumenCfg);
    agregarSeccion("Resumen", resumenParaPDF);

    //// === SI HAY RESUMEN, GENERAR PDF SOLO CON DATOS GENERALES + RESUMEN ===
    //if (Array.isArray(resumenParaPDF) && resumenParaPDF.length > 0) {
    //    // Asegurar nombre/paths aquí para reutilizar
    //    const expedienteNombreResumen = (datosGenerales.expediente || "Expediente_Desconocido").replace(/[\/:"*?<>|]/g, "_");
    //    const filePathCompleto = path.join(__dirname, 'descargas', `expediente_${expedienteNombreResumen}.pdf`);
    //    const filePathResumen = path.join(__dirname, 'descargas', `expediente_${expedienteNombreResumen}_resumen.pdf`);

    //    // Funciones locales para el PDF de resumen (reutilizan el mismo estilo)
    //    const crearPDFResumen = async () => {
    //        const pdfResumen = await PDFDocument.create();
    //        let pageR = pdfResumen.addPage([600, 800]);
    //        const { width: wR, height: hR } = pageR.getSize();
    //        const fontR = await pdfResumen.embedFont(StandardFonts.Helvetica);
    //        pageR.setFont(fontR);

    //        const marginLeftR = 50;
    //        const marginRightR = 50;
    //        const maxWidthR = wR - marginLeftR - marginRightR;
    //        let yR = hR - 50;
    //        const lineSpacingR = 20;
    //        const sectionSpacingR = 30;

    //        function checkPageBreakR() {
    //            if (yR < 50) {
    //                pageR = pdfResumen.addPage([600, 800]);
    //                yR = hR - 50;
    //                pageR.setFont(fontR);
    //            }
    //        }

    //        function sanitizeR(text) {
    //            return String(text || "").replace(/[\u0096\u2013\u2014]/g, '-');
    //        }
    //        function agregarTextoAjustadoR(texto, size = 12) {
    //            const lineSegments = sanitizeR(texto).split("\n");

    //            lineSegments.forEach((segment) => {
    //                const raw = String(segment || "").trim();
    //                if (!raw) return;

    //                // --- Normalización de enlaces ---
    //                // Objetivo: solo rutas locales -> file:///
    //                //           todo lo web -> https:// (nunca file:)
    //                const isHttp = /^https?:\/\//i.test(raw);
    //                const isWinPath = /^[A-Za-z]:\\/.test(raw);
    //                const isDomainLike = /^(www\.|[a-z0-9.-]+\.[a-z]{2,})(\/|$)/i.test(raw); // www.x o dominio.tld/...
    //                const isRelativeSCW = /^\/scw\//i.test(raw);

    //                let normalized = raw;
    //                if (isWinPath) {
    //                    // Rutas locales Windows -> file:///C:/... (convertir backslashes)
    //                    normalized = `file:///${raw.replace(/\\/g, "/")}`;
    //                } else if (isRelativeSCW) {
    //                    // Enlaces relativos de SCW -> absolutos
    //                    normalized = `https://scw.pjn.gov.ar${raw}`;
    //                } else if (!isHttp && isDomainLike) {
    //                    // "www..." o "dominio.tld/..." -> forzar https
    //                    normalized = `https://${raw}`;
    //                }

    //                // Si quedó en http/https o file:///, lo tratamos como URL clickeable
    //                if (/^(https?:\/\/|file:\/\/\/)/i.test(normalized)) {
    //                    // Ojo: agregarTextoAjustadoURLR debe crear la anotación PDF con PDFName/PDFString (no string crudo)
    //                    agregarTextoAjustadoURLR(normalized, size);
    //                    return;
    //                }

    //                // --- Caso general: texto normal con ajuste de línea ---
    //                const words = raw.split(" ");
    //                let line = "";

    //                for (let word of words) {
    //                    const testLine = line ? line + " " + word : word;
    //                    const testWidth = fontR.widthOfTextAtSize(testLine, size);

    //                    if (testWidth > maxWidthR) {
    //                        if (line === "") {
    //                            // Palabra más ancha que el renglón: partir por caracteres
    //                            for (let char of word) {
    //                                const testCharLine = line + char;
    //                                if (fontR.widthOfTextAtSize(testCharLine, size) > maxWidthR) {
    //                                    pageR.drawText(line, { x: marginLeftR, y: yR, size, color: rgb(0, 0, 0) });
    //                                    yR -= lineSpacingR; checkPageBreakR();
    //                                    line = char;
    //                                } else {
    //                                    line = testCharLine;
    //                                }
    //                            }
    //                        } else {
    //                            pageR.drawText(line, { x: marginLeftR, y: yR, size, color: rgb(0, 0, 0) });
    //                            yR -= lineSpacingR; checkPageBreakR();
    //                            line = word;
    //                        }
    //                    } else {
    //                        line = testLine;
    //                    }
    //                }

    //                if (line) {
    //                    pageR.drawText(line, { x: marginLeftR, y: yR, size, color: rgb(0, 0, 0) });
    //                    yR -= lineSpacingR; checkPageBreakR();
    //                }
    //            });
    //        }
    //        function agregarTextoAjustadoURLR(url, initialSize = 12) {
    //            // Ajuste de tamaño para que entre en la línea
    //            let fontSize = initialSize;
    //            let urlWidth = fontR.widthOfTextAtSize(url, fontSize);
    //            while (urlWidth > maxWidthR && fontSize > 4) {
    //                fontSize -= 1;
    //                urlWidth = fontR.widthOfTextAtSize(url, fontSize);
    //            }

    //            // Dibujar el texto (azul)
    //            pageR.drawText(url, {
    //                x: marginLeftR,
    //                y: yR,
    //                size: fontSize,
    //                font: fontR,
    //                color: rgb(0, 0, 1),
    //            });

    //            // Anotación de enlace correctamente tipificada como URI
    //            try {
    //                const { PDFName, PDFString } = require('pdf-lib');
    //                const x1 = marginLeftR;
    //                const y1 = yR;
    //                const x2 = marginLeftR + urlWidth;
    //                const y2 = yR + fontSize;

    //                const linkAnnot = pdfResumen.context.obj({
    //                    Type: PDFName.of('Annot'),
    //                    Subtype: PDFName.of('Link'),
    //                    Rect: [x1, y1, x2, y2],
    //                    Border: [0, 0, 0],
    //                    A: pdfResumen.context.obj({
    //                        Type: PDFName.of('Action'),
    //                        S: PDFName.of('URI'),
    //                        URI: PDFString.of(url), // 👈 clave: URI como PDFString, no string crudo
    //                    }),
    //                });

    //                const annots = pageR.node.Annots();
    //                if (annots) {
    //                    annots.push(linkAnnot);
    //                } else {
    //                    pageR.node.set(PDFName.of('Annots'), pdfResumen.context.obj([linkAnnot]));
    //                }
    //            } catch (e) {
    //                console.warn('No se pudo crear la anotación de link en el PDF de resumen:', e.message);
    //            }

    //            yR -= lineSpacingR;
    //            checkPageBreakR();
    //        }
    //        function agregarSeccionR(titulo, datos) {
    //            if (datos.length > 0) {
    //                yR -= sectionSpacingR;
    //                agregarTextoAjustadoR(titulo, 14);
    //                datos.forEach((dato) => agregarTextoAjustadoR(dato, 10));
    //            }
    //        }

    //        // —— Contenido del PDF Resumen ——
    //        agregarTextoAjustadoR("Expediente: " + (datosGenerales.expediente || ""), 14);
    //        agregarTextoAjustadoR("Jurisdicción: " + (datosGenerales.jurisdiccion || ""));
    //        agregarTextoAjustadoR("Dependencia: " + (datosGenerales.dependencia || ""));
    //        agregarTextoAjustadoR("Situación Actual: " + (datosGenerales.situacion_actual || ""));
    //        agregarTextoAjustadoR("Carátula: " + (datosGenerales.caratula || ""));

    //        agregarSeccionR("Resumen", resumenParaPDF);

    //        // — Última línea: “link” al PDF completo —
    //        // Tomamos la ruta del PDF completo y la forzamos a file:/// para maximizar la chance de click
    //        const rutaCompletaRaw = `file:///${filePathCompleto.replace(/\\/g, '/')}`;
    //        // Escapar espacios y caracteres especiales para que el visor no corte la URL
    //        const rutaCompleta = encodeURI(rutaCompletaRaw);

    //        agregarTextoAjustadoR("Informe completo:", 12);
    //        // Dibujamos el texto y además creamos una anotación de link clickeable
    //        agregarTextoAjustadoURLR(rutaCompleta, 10);


    //        const bytesR = await pdfResumen.save();
    //        fs.writeFileSync(filePathResumen, bytesR);
    //        console.log(`PDF RESUMEN generado: ${filePathResumen}`);
    //    };

    //    // Crear el PDF de resumen (no bloquea la generación del completo)
    //    await crearPDFResumen();
    //}


    // Secciones del informe
    const movimientosParaPDF = movimientos.map(mov => {
        let linea = `${mov.fecha} - ${mov.tipo}: ${mov.detalle}`;
        if (mov.archivo && mov.archivo !== "nn") {
          const fileName = path.basename(mov.archivo);
          linea += ` Archivo: ${fileName}`;
        }
        // Sólo si solicitamos href en actuales y existe:
        if (hrefma && mov.viewHref) {
          // Ajustar la URL para que ocupe el ancho máximo de la página en una sola línea
          // Se calculará el tamaño de fuente adecuado en la función agregarTextoAjustadoURL
          linea += `\n${mov.viewHref}`;
        }
        return linea;
      });
      agregarSeccion("Movimientos", movimientosParaPDF);

    // 1) Prepara el array que le vas a pasar a agregarSeccion:
    const historicosParaPDF =
        (movimientosHistoricos.length === 1 && movimientosHistoricos[0].tipo === 'info')
            ? [movimientosHistoricos[0].detalle]
            : movimientosHistoricos.map(mov => {
                let linea = `${mov.fecha} - ${mov.tipo}: ${mov.detalle}`;
                if (mov.aFs) linea += ` | ${mov.aFs}`;
                if (mov.archivo && mov.archivo !== "nn") {
                    const fileName = path.basename(mov.archivo);
                    linea += ` Archivo: ${fileName}`;
                }
                // Sólo si solicitamos href en históricos y existe:
                if (hrefmh && mov.viewHref) {
                    linea += `\n${mov.viewHref}`;
                }
                return linea;
            });

    agregarSeccion("Movimientos Históricos", historicosParaPDF);


    // Evitar duplicados en Intervinientes usando new Set
    // Procesar intervinientes antes de generar el PDF
    const intervinientesProcesados = intervinientes
        .map(item => item.trim())           // Quitar espacios extra
        .filter(item => item !== "")        // Eliminar elementos vacíos
        .map(item => {
            const lines = item.split("\n").map(line => line.trim());
            // Si es el grupo completo no deseado, descartar la cadena
            if (lines.length === 3 &&
                lines[0] === "TIPO|NOMBRE|TOMO/FOLIO :" &&
                lines[1] === "TOMO/FOLIO|I.E.J. :" &&
                lines[2] === "I.E.J.") {
                return "";
            }
            // Si la primera línea es "TIPO :", eliminarla
            if (lines[0] === "TIPO :") {
                lines.shift();
            }
            return lines.join("\n");
        })
        .filter(item => item !== "");       // Eliminar posibles vacíos tras el mapeo

    // Eliminar duplicados
    const intervinientesUnicos = [...new Set(intervinientesProcesados)];

    console.log("Intervinientes filtrados:", intervinientesUnicos);

    // Generar la sección en el PDF
    agregarSeccion("Intervinientes", intervinientesUnicos);

    agregarSeccion("Vinculados", vinculados);
    agregarSeccion("Recursos", recursos);
    agregarSeccion("Notas", notas);

    // Guardar el PDF
    let expedienteNombre = (datosGenerales.expediente || "Expediente_Desconocido").replace(/[\/:"*?<>|]/g, "_");
    let filePath = path.join(getDataPath(), 'descargas', `expediente_${expedienteNombre}.pdf`);

    // Footer en la última página
    dibujarFooter(page, pageCount);

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes);

    console.log(`PDF generado exitosamente: ${filePath}`);
    return filePath;
}

// Listener para toggle remoto del navegador desde el proceso padre (Electron)
if (process.send !== undefined) {
    process.on('message', async (msg) => {
        if (!msg || msg.type !== 'TOGGLE_BROWSER') return;
        if (!_currentPage) {
            console.error('⚠️ toggle: _currentPage no está disponible aún');
            return;
        }
        try {
            console.log(`🔄 toggle: ${msg.show ? 'mostrando' : 'ocultando'} navegador`);
            if (msg.show) {
                await showBrowser(_currentPage, true);
            } else {
                await hideBrowser(_currentPage, true);
            }
        } catch (err) {
            console.error('⚠️ toggle browser error:', err.message);
        }
    });
}

// =============================================================================
// Exportación de Funciones
// =============================================================================

module.exports = {
    configuracionesGenerales,
    iniciarSesion,
    hideBrowser,
    showBrowser,
    nuevaConsultaPublica,
    extraerDatosGenerales,
    extraerTablaActuaciones,
    extraerTablaActuacionesHistoricas,
    extraerTablaActuacionesConReintentos,
    extraerTablaActuacionesHistoricasConReintentos,
    iterarTablaActuaciones,
    iterarTablaActuacionesHistoricas,
    clickEnVerActuales,
    manejarCheckboxes,
    clickEnVerVarios,
    extraerTablaNotas,
    generarPDFExpediente
};
