/**
 * listarscwpjn.js
 * Proceso principal de extracción de expedientes. Este script:
 *  - Configura el lock y elimina backups antiguos.
 *  - Lee la configuración y el estado de secciones.
 *  - Inicia la sesión mediante sessionManager para tener reintentos “limpios”.
 *  - Procesa cada sección (LETRADO, PARTE, AUTORIZADO NE y FAVORITOS) con reintentos independientes
 *    (según el modo configurado) y espera 3 segundos entre secciones.
 *  - Unifica los resultados y realiza la limpieza final.
 */

const testM1 = require('./testM1');
const fs = require('fs');
const path = require('path');
const sessionManager = require('./sessionManager'); // Módulo que reinicia la sesión (navegador y página)
const cerrarNavegador = require('./cerrarNavegador');
const delay = testM1.delay;

// Configuración global y de reintentos
process.on('uncaughtException', error => {
    console.error("❌ Excepción no capturada (inesperada):", error.message, error.stack);
    // NO llamar process.exit(1) — dejar que el sistema de reintentos en ejecutarProceso
    // maneje la recuperación. Si se sale aquí, el proceso muere sin reintentar.
});
process.on('unhandledRejection', (reason, promise) => {
    console.error("❌ Rechazo de promesa no manejado:", reason);
    // NO llamar process.exit(1) — misma razón: el sistema de reintentos necesita seguir vivo.
});

const profilePath = path.join(process.env.LOCALAPPDATA, 'ProcuradorSCW', 'ChromeProfile');
const _config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config_proceso.json'), 'utf8'));
const identificador = _config.general.identificador;
const fechaLimite = process.argv.length > 2 ? process.argv[2] : null;
console.log(`Fecha límite recibida: ${fechaLimite}`);

const modoReintento = "seccion"; // "seccion" para reintentos independientes
const maxReintentosGlobal = 10;
const maxReintentoLetrado = 5;
const maxReintentoParte = 5;
const maxReintentoAutorizado = 5;
const maxReintentoFavoritos = 5;

const paginasConErrorGlobal = {
    "LETRADO": [],
    "PARTE": [],
    "AUTORIZADO NE": [],
    "FAVORITOS": []
};

/* Función para navegar directamente a una página en el paginador */
function navegarDirectamenteAPagina(page, targetPage, maxIteraciones = 5) {
    return new Promise(async (resolve, reject) => {
        for (let i = 0; i < maxIteraciones; i++) {
            const paginasVisibles = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('ul.pagination li a'))
                    .map(el => parseInt(el.textContent.trim(), 10))
                    .filter(num => !isNaN(num));
            });
            console.log(`Páginas visibles: ${paginasVisibles.join(', ')}`);
            if (paginasVisibles.includes(targetPage)) {
                await page.evaluate((target) => {
                    const links = Array.from(document.querySelectorAll('ul.pagination li a'));
                    const link = links.find(el => el.textContent.trim() === target.toString());
                    if (link) { link.click(); }
                }, targetPage);

                try {
                    await page.waitForFunction(
                        (selector, expected) => {
                            const el = document.querySelector(selector);
                            return el && el.textContent.trim() === expected.toString();
                        },
                        { timeout: 30000 },
                        'ul.pagination li.active span',
                        targetPage
                    );
                } catch (error) {
                    console.error(`❌ Timeout al esperar que se active la página ${targetPage}: ${error.message}`);
                    return reject(error); // Rechaza explícitamente la promesa
                }

                console.log(`✅ Navegación directa a la página ${targetPage} exitosa.`);
                return resolve(true);
            } else {
                const maxVisible = Math.max(...paginasVisibles);
                if (maxVisible < targetPage) {
                    console.log(`⚠️ Enlace para la página ${targetPage} no visible. Haciendo clic en la página ${maxVisible} para actualizar el paginador.`);
                    await page.evaluate((target) => {
                        const links = Array.from(document.querySelectorAll('ul.pagination li a'));
                        const link = links.find(el => el.textContent.trim() === target.toString());
                        if (link) { link.click(); }
                    }, maxVisible);
                    await delay(2000);
                } else {
                    break;
                }
            }
        }
        return resolve(false);
    });
}

/* Verifica que los registros de la página actual coincidan con los datos de backup */
async function verificarPagina(page, pagina, backupPageData) {
    console.log(`🚀 Verificando la consistencia de la página ${pagina}...`);
    if (pagina > 1) {
        const exitoNavegacion = await navegarDirectamenteAPagina(page, pagina);
        if (!exitoNavegacion) {
            console.log("⚠️ No se pudo navegar directamente para verificación.");
            return false;
        }
    }

    try {
        await page.waitForFunction(
            (selector, expected) => {
                const el = document.querySelector(selector);
                return el && el.textContent.trim() === expected.toString();
            },
            { timeout: 30000 },
            'ul.pagination li.active span',
            pagina
        );
    } catch (error) {
        console.error(`❌ Timeout al esperar que se active la página ${pagina}: ${error.message}`);
        throw error; // Propagar el error para activar el mecanismo de reintento
    }
    await page.waitForSelector('table.table-striped tbody', { timeout: 10000 });
    const filas = await page.$$eval('table.table-striped tbody tr', rows => {
        return rows
            .filter(row => row.cells.length > 0 && row.cells[0].textContent.trim() !== '')
            .map(row => {
                const celdas = Array.from(row.cells).map(cell => cell.textContent.trim());
                return { expediente: celdas[0] };
            });
    });
    if (filas.length === 0) return false;
    const firstExpediente = filas[0].expediente;
    const lastExpediente = filas[filas.length - 1].expediente;
    const backupFirst = backupPageData[0] ? backupPageData[0].expediente : null;
    const backupLast = backupPageData[backupPageData.length - 1] ? backupPageData[backupPageData.length - 1].expediente : null;
    console.log(`Registros backup: ${JSON.stringify(backupPageData.map(r => r.expediente))}`);
    console.log(`Registros reintento: ${JSON.stringify(filas.map(r => r.expediente))}`);
    if (firstExpediente === backupFirst && lastExpediente === backupLast) {
        console.log(`✅ Verificación de la página ${pagina} exitosa: registros coinciden.`);
        return true;
    } else {
        console.error(`❌ Verificación de la página ${pagina} falló: registros no coinciden.`);
        return false;
    }
}

/* Itera sobre la lista de expedientes simulando errores y extrayendo datos de cada página */
async function iterarListaExpedientesConSimulacion(page, totalPaginas, fechaLimite, paginasConError = [], paginaInicial = 1) {
    const tablaSelector = 'table.table-striped tbody';
    const filaSelector = `${tablaSelector} tr`;
    const activePageSelector = 'ul.pagination li.active span';
    let datosExtraidos = [];
    let ultimaPaginaProcesada = paginaInicial - 1;
    let stopExtraction = false;
    let stoppedByLimit = false;
    let fechaLimiteDate = null;
    let paginasData = {};

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

    for (let paginaActual = paginaInicial; paginaActual <= totalPaginas; paginaActual++) {
        console.log(`📄 Procesando página ${paginaActual}...`);

        if (paginasConError.includes(paginaActual)) {
            console.error(`❌ Simulación de error en la página ${paginaActual}.`);
            const idx = paginasConError.indexOf(paginaActual);
            if (idx !== -1) paginasConError.splice(idx, 1);
            break;
        }

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
            paginasData[paginaActual] = filas;
            for (let i = 0; i < filas.length; i++) {
                const fila = filas[i];
                console.log(`Página ${paginaActual}, Fila ${i + 1}: ${fila.expediente}`);
                if (fechaLimiteDate) {
                    const fechaNormalizada = normalizarFecha(fila.ultimaAct);
                    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaNormalizada)) {
                        const [dia, mes, anio] = fechaNormalizada.split('/').map(Number);
                        const fechaRegistro = new Date(anio, mes - 1, dia);
                        if (fechaRegistro < fechaLimiteDate) {
                            datosExtraidos.push(fila);
                            console.log(`Registro con fecha ${fila.ultimaAct} menor a la fecha límite ${fechaLimite}. Se detiene la extracción.`);
                            stopExtraction = true;
                            stoppedByLimit = true;
                            break;
                        } else {
                            datosExtraidos.push(fila);
                        }
                    } else {
                        console.warn(`Fecha inválida en registro: ${fila.ultimaAct}. Se continúa.`);
                        datosExtraidos.push(fila);
                    }
                } else {
                    datosExtraidos.push(fila);
                }
            }
            ultimaPaginaProcesada = paginaActual;
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
                        if (span) return link;
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
                    console.error("No se encontró el botón 'Siguiente'. Se detiene la extracción.");
                    break;
                }
            }
        } catch (error) {
            console.error(`❌ Error en la página ${paginaActual}: ${error.message}\n${error.stack}`);
            throw error;
        }
    }

    console.log(`Total de filas procesadas en este intento: ${datosExtraidos.length}`);
    return { datosExtraidos, ultimaPaginaProcesada, stoppedByLimit, paginasData };
}

/* Función que encapsula el procesamiento de cada sección */
async function procesarSeccion(sec, page, fechaLimiteParam) {
    console.log(`\n🔄 Procesando sección: ${sec.type}`);
    // Navegar a la vista de la sección
    await testM1.consultarExpedientes(page, sec.code);
    // Espera explícita de 3 segundos antes de continuar
    await delay(3000);
    console.log("📂 Ordenando y contando expedientes...");
    const { totalPaginas } = await testM1.ordenarYContarExpedientes(page);
    if (totalPaginas === 0) {
        console.log(`No hay expedientes disponibles para ${sec.type}.`);
        return { datos: [], ultimaPagina: 0 };
    }
    console.log(`🔢 Se detectaron ${totalPaginas} páginas en total para ${sec.type}.`);

    const backupFilePathSec = path.join(__dirname, `backup_exp_${sec.type.replace(/ /g, '_')}.json`);
    let backupData = { paginas: {}, ultimaPaginaProcesada: 0 };
    let paginaInicial = 1;
    if (fs.existsSync(backupFilePathSec)) {
        console.log(`📂 Recuperando datos previos del backup para ${sec.type}...`);
        backupData = JSON.parse(fs.readFileSync(backupFilePathSec, 'utf8'));
        const registrosBackup = Object.values(backupData.paginas).flat();
        console.log(`✅ Se recuperaron ${registrosBackup.length} registros para ${sec.type}, última página procesada: ${backupData.ultimaPaginaProcesada}.`);
        paginaInicial = backupData.ultimaPaginaProcesada + 1;
        console.log(`🔄 Se continuará desde la página ${paginaInicial} para ${sec.type}.`);
    }

    if (backupData.ultimaPaginaProcesada > 0) {
        console.log(`🔍 Verificando consistencia de la última página procesada (${backupData.ultimaPaginaProcesada}) para ${sec.type}...`);
        const backupPageData = backupData.paginas[backupData.ultimaPaginaProcesada] || [];
        const ok = await verificarPagina(page, backupData.ultimaPaginaProcesada, backupPageData);
        if (!ok) {
            console.error(`❌ La verificación falló para ${sec.type}. Se descartará el backup y se reiniciará la extracción desde la página 1.`);
            backupData = { paginas: {}, ultimaPaginaProcesada: 0 };
            paginaInicial = 1;
        }
    }

    if (paginaInicial > 1) {
        console.log(`🚀 Intentando navegación directa a la página ${paginaInicial} para ${sec.type}...`);
        const exitoNavegacion = await navegarDirectamenteAPagina(page, paginaInicial);
        if (!exitoNavegacion) {
            console.log(`⚠️ No se pudo realizar navegación directa para ${sec.type}; se usará navegación secuencial.`);
        }
    }

    let paginasConError = paginasConErrorGlobal[sec.type] || [];
    const resultadoExtraccion = await iterarListaExpedientesConSimulacion(page, totalPaginas, fechaLimiteParam, paginasConError, paginaInicial);
    const nuevasFilas = resultadoExtraccion.datosExtraidos;
    const ultimaPaginaProcesada = resultadoExtraccion.ultimaPaginaProcesada;
    const stoppedByLimit = resultadoExtraccion.stoppedByLimit;
    const paginasData = resultadoExtraccion.paginasData;

    backupData.paginas = { ...backupData.paginas, ...paginasData };
    backupData.ultimaPaginaProcesada = ultimaPaginaProcesada;
    let datosCompletos = Object.keys(backupData.paginas)
        .sort((a, b) => Number(a) - Number(b))
        .reduce((acc, key) => acc.concat(backupData.paginas[key]), []);

    const tipoAbreviado = {
        "LETRADO": "L",
        "PARTE": "P",
        "AUTORIZADO NE": "A",
        "FAVORITOS": "F"
    };

    datosCompletos = datosCompletos.map(item => ({
        ...item,
        caratula: `${item.caratula} |${tipoAbreviado[sec.type]}`,
        tipo: sec.type
    }));

    fs.writeFileSync(backupFilePathSec, JSON.stringify(backupData, null, 2));
    console.log(`💾 Backup actualizado para ${sec.type}: ${datosCompletos.length} registros, última página procesada: ${ultimaPaginaProcesada}.`);

    const duplicados = testM1.controlarDuplicados(datosCompletos);
    if (duplicados.totalDuplicados > 0) {
        throw new Error(`Se encontraron ${duplicados.totalDuplicados} duplicados en ${sec.type}: ${JSON.stringify(duplicados.duplicados)}`);
    }

    if (stoppedByLimit) {
        console.log(`✅ Extracción detenida por condición de fecha límite para ${sec.type}. Se considera completa la extracción.`);
    } else if (ultimaPaginaProcesada < totalPaginas) {
        throw new Error(`Extracción incompleta para ${sec.type}, error en la página ${ultimaPaginaProcesada + 1}`);
    }

    console.log(`💾 Guardando lista de expedientes final para ${sec.type}...`);
    const filePathSec = testM1.guardarListaExpedientes(datosCompletos, identificador, sec.type);
    console.log(`📌 Lista guardada en: ${filePathSec}`);

    return { datosCompletos, backupData, ultimaPaginaProcesada };
}

/* Función principal que ejecuta el proceso completo */
async function ejecutarProceso(reintento = 0, fechaLimiteParam = '01/01/2017') {
    let browser, page;  // Declaración de browser en el ámbito de la función
    const lockFilePath = path.join(__dirname, 'execution.lock');
    if (reintento === 0) {
        fs.writeFileSync(lockFilePath, JSON.stringify({ start: Date.now() }));
        const filesToCheck = [
            'acumulador_resultados.json',
            'estado_secciones.json',
            'backup_exp_LETRADO.json',
            'backup_exp_PARTE.json',
            'backup_exp_AUTORIZADO_NE.json',
            'backup_exp_FAVORITOS.json'
        ];
        filesToCheck.forEach(fileName => {
            const filePath = path.join(__dirname, fileName);
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                const lockStats = fs.statSync(lockFilePath);
                if (stats.mtime < lockStats.mtime) {
                    console.log(`El archivo ${fileName} es de una ejecución anterior y será eliminado.`);
                    fs.unlinkSync(filePath);
                }
            }
        });
    }

    const acumuladorPath = path.join(__dirname, 'acumulador_resultados.json');
    if (reintento === 0 && fs.existsSync(acumuladorPath)) {
        fs.unlinkSync(acumuladorPath);
    }
    let finalResultados = [];
    if (fs.existsSync(acumuladorPath)) {
        finalResultados = JSON.parse(fs.readFileSync(acumuladorPath, 'utf8'));
    }

    const configPath = path.join(__dirname, 'config_listar.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const estadoPath = path.join(__dirname, 'estado_secciones.json');
    let estadoSecciones = {};
    if (fs.existsSync(estadoPath)) {
        estadoSecciones = JSON.parse(fs.readFileSync(estadoPath, 'utf8'));
    }

    let secciones = [];
    if (config.letrado) secciones.push({ code: 1, type: "LETRADO", configKey: "letrado" });
    if (config.parte) secciones.push({ code: 2, type: "PARTE", configKey: "parte" });
    if (config.autorizado) secciones.push({ code: 3, type: "AUTORIZADO NE", configKey: "autorizado" });
    if (config.favoritos) secciones.push({ code: 4, type: "FAVORITOS", configKey: "favoritos" });

    if (secciones.length === 0) {
        throw new Error("🚫 No hay opciones seleccionadas en config_listar.json. Habilitá al menos una opción (letrado, parte, autorizado o favoritos) para ejecutar la extracción.");
    }

    try {
        console.log(`\n🔄 Iniciando proceso general (Intento ${reintento + 1}/${maxReintentosGlobal})...`);

        // Inicia una sesión limpia mediante sessionManager
        ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));

        await page.goto(testM1.URL, { waitUntil: 'networkidle2', timeout: 60000 });

        if (page.url() === 'about:blank') {
            console.warn("⚠️ Detectado about:blank. Esperando hasta 5 segundos para ver si carga correctamente...");
            const tiempoInicio = Date.now();
            while (page.url() === 'about:blank' && (Date.now() - tiempoInicio) < 5000) {
                await delay(500); // usa tu función delay
            }
            if (page.url() === 'about:blank') {
                throw new Error('❌ El navegador permaneció en about:blank más de 5 segundos.');
            } else {
                console.log('✅ La página cargó correctamente después del retraso.');
            }
        }

        page.on('console', msg => {
            console.log(`BROWSER LOG: ${msg.text()}`);
        });
        page.on('pageerror', error => {
            console.error(`BROWSER ERROR: ${error.message}`);
        });
        page.on('close', () => {
            console.log("La página se ha cerrado inesperadamente.");
        });
        browser.on('disconnected', () => {
            console.log("El navegador se ha desconectado.");
        });

        console.log("🔑 Sesión iniciada.");

        // Procesa cada sección
        for (const sec of secciones) {
            if (estadoSecciones[sec.type] === "completo") {
                console.log(`⏩ Sección ${sec.type} ya completada previamente. Se saltea.`);
                await delay(3000); // Espera de 3 segundos entre secciones
                continue;
            }

            if (modoReintento === "seccion") {
                let maxReintentosSeccion;
                switch (sec.type) {
                    case "LETRADO": maxReintentosSeccion = maxReintentoLetrado; break;
                    case "PARTE": maxReintentosSeccion = maxReintentoParte; break;
                    case "AUTORIZADO NE": maxReintentosSeccion = maxReintentoAutorizado; break;
                    case "FAVORITOS": maxReintentosSeccion = maxReintentoFavoritos; break;
                    default: maxReintentosSeccion = 3; break;
                }
                let reintentoSeccion = 0;
                let seccionProcesada = false;
                while (!seccionProcesada && reintentoSeccion < maxReintentosSeccion) {
                    try {
                        console.log(`\n🔄 Procesando sección: ${sec.type} (Intento ${reintentoSeccion + 1}/${maxReintentosSeccion})`);
                        if (reintentoSeccion > 0) {
                            console.log("🔄 Reiniciando sesión para la sección...");
                            // Si browser es null, ya se cerró en el catch, así que se inicia la sesión directamente.
                            if (!browser) {
                                ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));
                            } else {
                                // Por si por alguna razón no es null, lo cerramos y luego iniciamos.
                                await cerrarNavegador(browser);
                                ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));
                            }
                            await page.goto(testM1.URL, { waitUntil: 'networkidle2', timeout: 60000 });
                            if (page.url() === 'about:blank') {
                                console.warn("⚠️ Detectado about:blank. Esperando hasta 5 segundos para ver si carga correctamente...");
                                const tiempoInicio = Date.now();
                                while (page.url() === 'about:blank' && (Date.now() - tiempoInicio) < 5000) {
                                    await delay(500);
                                }
                                if (page.url() === 'about:blank') {
                                    throw new Error('❌ El navegador permaneció en about:blank más de 5 segundos.');
                                } else {
                                    console.log('✅ La página cargó correctamente después del retraso.');
                                }
                            }
                        }
                        const { datosCompletos } = await procesarSeccion(sec, page, fechaLimite);
                        // Espera 3 segundos después de procesar la sección
                        await delay(3000);
                        // Verificación post-sección: confirma que la sesión sigue activa.
                        // Si falla (ej: frame detached), los datos ya están guardados en backup
                        // → solo logueamos y continuamos, sin reiniciar Chrome.
                        console.log(`🔍 Consultando expedientes para ${sec.type}...`);
                        try {
                            await testM1.consultarExpedientes(page, sec.code);
                        } catch (verifyErr) {
                            console.warn(`⚠️ Verificación post-sección ${sec.type} falló: ${verifyErr.message}. Los datos ya fueron guardados en backup.`);
                        }
                        const backupFilePathSec = path.join(__dirname, `backup_exp_${sec.type.replace(/ /g, '_')}.json`);
                        if (fs.existsSync(backupFilePathSec)) {
                            fs.unlinkSync(backupFilePathSec);
                            console.log(`🗑️ Backup eliminado para ${sec.type} tras la extracción exitosa.`);
                        }
                        finalResultados = finalResultados.concat(datosCompletos);
                        fs.writeFileSync(acumuladorPath, JSON.stringify(finalResultados, null, 2));
                        estadoSecciones[sec.type] = "completo";
                        fs.writeFileSync(estadoPath, JSON.stringify(estadoSecciones, null, 2));
                        seccionProcesada = true;
                    } catch (error) {
                        // Verificar si se detectó el error SSL crítico
                        if (error.message === 'SSL_BLOCK_SCREEN_DETECTED') {
                            process.stdout.write(`ERROR: Se detectó un error SSL crítico en la sección ${sec.type}. Abortando reintentos de sección...\n`);
                            // Nota: backupData vive en procesarSeccion() y no es accesible aquí.
                            // El backup ya fue guardado dentro de procesarSeccion() antes de lanzar el error.
                            await cerrarNavegador(browser);  // Cierra inmediatamente el navegador
                            browser = null; // Se fuerza la reinicialización en el siguiente intento o se aborta el proceso
                            // Se aborta el ciclo, lanzando el error para que no se intente nuevamente la sección
                            throw error;
                        }

                        console.error(`❌ Error en la sección ${sec.type} en intento ${reintentoSeccion + 1}: ${error.message}\n${error.stack}`);

                        // Cerrar el navegador de la sesión fallida, si está activo
                        if (browser) {
                            console.log("🔄 Cerrando navegador de la sesión fallida...");
                            try {
                                await cerrarNavegador(browser);

                            } catch (e) {
                                console.error("Error al cerrar el navegador en el catch:", e.message);
                            }
                            browser = null; // Se asigna null para forzar la reinicialización en el siguiente intento
                        }

                        if (reintentoSeccion + 1 < maxReintentosSeccion) {
                            reintentoSeccion++;
                            // En esta iteración el reinicio se hará en el bloque inicial del while
                        } else {
                            throw error;
                        }
                    }
                }
            } else {
                console.log(`\n🔄 Procesando sección: ${sec.type}`);
                await testM1.consultarExpedientes(page, sec.code);
                console.log("📂 Ordenando y contando expedientes...");
                const { totalPaginas } = await testM1.ordenarYContarExpedientes(page);
                if (totalPaginas === 0) {
                    console.log(`No hay expedientes disponibles para ${sec.type}. Se continúa con la siguiente sección.`);
                    await delay(3000);
                    continue;
                }
                const backupFilePathSec = path.join(__dirname, `backup_exp_${sec.type.replace(/ /g, '_')}.json`);
                let backupData = { paginas: {}, ultimaPaginaProcesada: 0 };
                let paginaInicial = 1;
                if (fs.existsSync(backupFilePathSec)) {
                    console.log(`📂 Recuperando datos previos del backup para ${sec.type}...`);
                    backupData = JSON.parse(fs.readFileSync(backupFilePathSec, 'utf8'));
                    const registrosBackup = Object.values(backupData.paginas).flat();
                    console.log(`✅ Se recuperaron ${registrosBackup.length} registros para ${sec.type}, última página procesada: ${backupData.ultimaPaginaProcesada}.`);
                    paginaInicial = backupData.ultimaPaginaProcesada + 1;
                    console.log(`🔄 Se continuará desde la página ${paginaInicial} para ${sec.type}.`);
                }
                if (backupData.ultimaPaginaProcesada > 0) {
                    console.log(`🔍 Verificando consistencia de la última página procesada (${backupData.ultimaPaginaProcesada}) para ${sec.type}...`);
                    const backupPageData = backupData.paginas[backupData.ultimaPaginaProcesada] || [];
                    const ok = await verificarPagina(page, backupData.ultimaPaginaProcesada, backupPageData);
                    if (!ok) {
                        console.error(`❌ La verificación falló para ${sec.type}. Se descartará el backup y se reiniciará la extracción desde la página 1.`);
                        backupData = { paginas: {}, ultimaPaginaProcesada: 0 };
                        paginaInicial = 1;
                    }
                }
                if (paginaInicial > 1) {
                    console.log(`🚀 Intentando navegación directa a la página ${paginaInicial} para ${sec.type}...`);
                    const exitoNavegacion = await navegarDirectamenteAPagina(page, paginaInicial);
                    if (!exitoNavegacion) {
                        console.log(`⚠️ No se pudo realizar navegación directa para ${sec.type}; se usará navegación secuencial.`);
                    }
                }
                let paginasConError = paginasConErrorGlobal[sec.type] || [];
                const resultadoExtraccion = await iterarListaExpedientesConSimulacion(page, totalPaginas, fechaLimite, paginasConError, paginaInicial);
                const nuevasFilas = resultadoExtraccion.datosExtraidos;
                const ultimaPaginaProcesada = resultadoExtraccion.ultimaPaginaProcesada;
                const stoppedByLimit = resultadoExtraccion.stoppedByLimit;
                const paginasData = resultadoExtraccion.paginasData;

                backupData.paginas = { ...backupData.paginas, ...paginasData };
                backupData.ultimaPaginaProcesada = ultimaPaginaProcesada;
                let datosCompletos = Object.keys(backupData.paginas)
                    .sort((a, b) => Number(a) - Number(b))
                    .reduce((acc, key) => acc.concat(backupData.paginas[key]), []);

                const tipoAbreviado = {
                    "LETRADO": "L",
                    "PARTE": "P",
                    "AUTORIZADO NE": "A",
                    "FAVORITOS": "F"
                };

                datosCompletos = datosCompletos.map(item => ({
                    ...item,
                    caratula: `${item.caratula} |${tipoAbreviado[sec.type]}`,
                    tipo: sec.type
                }));

                fs.writeFileSync(backupFilePathSec, JSON.stringify(backupData, null, 2));
                console.log(`💾 Backup actualizado para ${sec.type}: ${datosCompletos.length} registros, última página procesada: ${ultimaPaginaProcesada}.`);

                const duplicados = testM1.controlarDuplicados(datosCompletos);
                if (duplicados.totalDuplicados > 0) {
                    throw new Error(`Se encontraron ${duplicados.totalDuplicados} duplicados en ${sec.type}: ${JSON.stringify(duplicados.duplicados)}`);
                }

                if (stoppedByLimit) {
                    console.log(`✅ Extracción detenida por condición de fecha límite para ${sec.type}. Se considera completa la extracción.`);
                } else if (ultimaPaginaProcesada < totalPaginas) {
                    throw new Error(`Extracción incompleta para ${sec.type}, error en la página ${ultimaPaginaProcesada + 1}`);
                }

                console.log(`💾 Guardando lista de expedientes final para ${sec.type}...`);
                const filePathSec = testM1.guardarListaExpedientes(datosCompletos, identificador, sec.type);
                console.log(`📌 Lista guardada en: ${filePathSec}`);

                estadoSecciones[sec.type] = "completo";
                fs.writeFileSync(estadoPath, JSON.stringify(estadoSecciones, null, 2));
                console.log(`🔍 Consultando expedientes para ${sec.type}...`);
                try {
                    await testM1.consultarExpedientes(page, sec.code);
                } catch (verifyErr) {
                    console.warn(`⚠️ Verificación post-sección ${sec.type} falló: ${verifyErr.message}. Los datos ya fueron guardados.`);
                }
                if (fs.existsSync(backupFilePathSec)) {
                    fs.unlinkSync(backupFilePathSec);
                    console.log(`🗑️ Backup eliminado para ${sec.type} tras la extracción exitosa.`);
                }
                finalResultados = finalResultados.concat(datosCompletos);
                fs.writeFileSync(acumuladorPath, JSON.stringify(finalResultados, null, 2));
            }
            // Espera 3 segundos entre cada sección procesada
            await delay(3000);
        }

        // Unificar y ordenar todos los expedientes por fecha descendente
        finalResultados.sort((a, b) => {
            const partesA = a.ultimaAct.split("/");
            const partesB = b.ultimaAct.split("/");
            const fechaA = new Date(`${partesA[2]}-${partesA[1]}-${partesA[0]}`);
            const fechaB = new Date(`${partesB[2]}-${partesB[1]}-${partesB[0]}`);
            return fechaB - fechaA;
        });

        const filePathTotal = testM1.guardarListaExpedientes(finalResultados, identificador, "COMBINADO");
        console.log(`📌 Lista unificada guardada en: ${filePathTotal}`);

        console.log("🔍 Consultando expedientes para LETRADO final...");
        try {
            await testM1.consultarExpedientes(page, 1);
        } catch (verifyErr) {
            console.warn(`⚠️ Verificación final LETRADO falló: ${verifyErr.message}. Los resultados ya están guardados.`);
        }

        // Si todas las secciones están completas, se eliminan los backups y el archivo de estado.
        const todasCompletas = secciones.every(sec => estadoSecciones[sec.type] === "completo");
        if (todasCompletas) {
            secciones.forEach(sec => {
                const backupPath = path.join(__dirname, `backup_exp_${sec.type.replace(/ /g, '_')}.json`);
                if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
            });
            if (fs.existsSync(estadoPath)) fs.unlinkSync(estadoPath);
            console.log("🧹 Todos los backups eliminados. Proceso 100% completo.");
            if (fs.existsSync(acumuladorPath)) fs.unlinkSync(acumuladorPath);
        }

        console.log("✅ Proceso completado exitosamente para todas las secciones.");
        process.stdout.write("RESULT:" + JSON.stringify(finalResultados) + "\n");
    } catch (error) {
        console.error(`❌ Error en el proceso general: ${error.message}\n${error.stack}`);
        if (reintento + 1 < maxReintentosGlobal) {
            console.log("🔄 Cerrando sesión y reintentando el proceso completo...");
            try {
                if (browser) await cerrarNavegador(browser);
            } catch (e) { console.error("Error al cerrar el navegador:", e.message, e.stack); }
            browser = null; // evitar que finally intente cerrarlo de nuevo
            await ejecutarProceso(reintento + 1, fechaLimiteParam);
        } else {
            console.error("🚨 Máximo de reintentos alcanzado. Abortando ejecución.");
            process.stdout.write("ERROR:" + error.message + "\n");
            throw error;
        }
    } finally {
        try {
            if (browser) await cerrarNavegador(browser);
        } catch (e) {
            console.error("Error al cerrar el navegador en finally:", e.message, e.stack);
        }
        if (reintento === 0 && fs.existsSync(lockFilePath)) {
            fs.unlinkSync(lockFilePath);
        }
    }
}

(async () => {
    try {
        await ejecutarProceso(0, fechaLimite);
    } catch (error) {
        console.error("Proceso finalizado con errores:", error);
        process.exit(1);
    }
})();
