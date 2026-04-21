/**
 * consultarscwpjn.js
 * Proceso de consulta pública de expedientes judiciales con manejo robusto de errores. Este script:
 *  - Recibe como argumentos un JSON con expedientes y un identificador (CUIL).
 *  - Carga y mantiene un backup incremental para continuar desde la última página procesada.
 *  - Utiliza `sessionManager` (`testM2`) para iniciar sesión y configurar el entorno.
 *  - Verifica la consistencia del backup antes de retomar la extracción.
 *  - Procesa cada expediente con reintentos “soft” (sin reiniciar el navegador).
 *  - Si los intentos soft fallan, aplica reintentos “hard” reiniciando el navegador y la sesión.
 *  - Simula errores configurables para testing (soft/hard por página).
 *  - Si el expediente no puede procesarse, agrega un movimiento informativo como fallback.
 *  - Guarda resultados intermedios y finales, y elimina el backup si todo se procesa correctamente.
 */

const testM2 = require('./testM2');
const fs = require('fs');
const path = require('path');
const cerrarNavegador = require('./cerrarNavegador');

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

// Configuración para simular errores
const SIMULAR_ERRORES = false;
const configuracionErroresSimulados = {
    "FCR 18660/2019": {
        soft: [1],
        hard: [1]
    },
    "FCR 018745/2017": {
        soft: [1],
        hard: [1]
    },
    // Puedes agregar otros expedientes de la misma forma.
};

const profilePath = path.join(process.env.LOCALAPPDATA, 'ProcuradorSCW', 'ChromeProfile');

// --- Inicio integración backup ---
const backupFilePath = path.join(getDataPath(), 'backup_expedientes.json');
let backupData = {};
if (fs.existsSync(backupFilePath)) {
    try {
        backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
        console.log("✅ Backup cargado correctamente.");
    } catch (error) {
        console.error("❌ ERROR al leer backup_expedientes.json, se iniciará con backup vacío:", error.message);
        backupData = {};
    }
} else {
    console.log("⚠️ No se encontró backup_expedientes.json, se iniciará con backup vacío.");
}

// --- Configuración del Lock y Eliminación de Backups Antiguos ---
const lockFilePath = path.join(__dirname, 'execution.lock');
// Se crea el lock (solo para indicar el inicio de esta ejecución)
fs.writeFileSync(lockFilePath, JSON.stringify({ start: Date.now() }));

// Se define el listado de archivos a verificar. En este caso, al usar solo "backup_expedientes.json"
// puedes ampliar el array si agregas más archivos en el futuro.
const filesToCheck = [
    'backup_expedientes.json'
];

filesToCheck.forEach(fileName => {
    const filePath = path.join(getDataPath(), fileName);
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const lockStats = fs.statSync(lockFilePath);
        if (stats.mtime < lockStats.mtime) {
            console.log(`🗑️ El archivo ${fileName} es de una ejecución anterior y será eliminado.`);
            fs.unlinkSync(filePath);
        }
    }
});

function guardarBackup() {
    try {
        fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2));
        console.log("💾 Backup actualizado.");
    } catch (error) {
        console.error("❌ ERROR al guardar backup_expedientes.json:", error.message);
    }
}
// --- Fin integración backup ---

// Función para eliminar etiquetas HTML de una cadena
function stripHTML(htmlString) {
    // Se usa una expresión regular para quitar todas las etiquetas HTML
    // y se remueve espacios en blanco al inicio y al final
    return htmlString ? htmlString.replace(/<[^>]+>/g, '').trim() : '';
}

// Función de verificación de página
async function verificarPaginaExpediente(page, pagina, backupMovimientos) {
    try {
        // Extrae los movimientos actuales de la página en modo 'quick5'
        const resultadoActual = await testM2.iterarTablaActuaciones(page, { mode: 'quick5mam', paginaInicial: pagina });
        if (
            !resultadoActual ||
            !resultadoActual.movimientos ||
            !Array.isArray(resultadoActual.movimientos) ||
            resultadoActual.movimientos.length === 0
        ) {
            console.error(`❌ No se extrajeron movimientos válidos en la página ${pagina} durante la verificación.`);
            return false;
        }

        // Extraer el primer y último detalle tanto del backup como del resultado actual
        // aplicando stripHTML para eliminar etiquetas HTML si las hubiera
        const backupFirst = backupMovimientos[0] ? stripHTML(backupMovimientos[0].detalle) : null;
        const backupLast = backupMovimientos[backupMovimientos.length - 1] ? stripHTML(backupMovimientos[backupMovimientos.length - 1].detalle) : null;
        const actualFirst = resultadoActual.movimientos[0] ? stripHTML(resultadoActual.movimientos[0].detalle) : null;
        const actualLast = resultadoActual.movimientos[resultadoActual.movimientos.length - 1] ? stripHTML(resultadoActual.movimientos[resultadoActual.movimientos.length - 1].detalle) : null;

        console.log(`🔍 Verificación página ${pagina} - Backup: [${backupFirst}, ${backupLast}], Actual: [${actualFirst}, ${actualLast}]`);

        // Compara solo el contenido de texto de la primera y última posición
        return backupFirst === actualFirst && backupLast === actualLast;
    } catch (error) {
        console.error(`❌ Error en la verificación de la página ${pagina}: ${error.message}`);
        return false;
    }
}

let identificador = process.argv[3] || "27320694359";
if (identificador === "default") {
    identificador = "27320694359";
}
process.env.IDENTIFICADOR = identificador;

let expedientesJSON = process.argv.length > 2 ? process.argv[2] : null;
if (!expedientesJSON) {
    console.error("❌ ERROR: No se recibió el JSON de expedientes.");
    process.stdout.write("❌ ERROR: No se recibió el JSON de expedientes.\n");
    process.exit(1);
}

let expedientesInput;
try {
    expedientesInput = JSON.parse(expedientesJSON);
} catch (e) {
    console.error("❌ ERROR: El JSON de expedientes es inválido.");
    process.stdout.write("❌ ERROR: El JSON de expedientes es inválido.\n");
    process.exit(1);
}

console.log(`📄 PROGRESS: Expedientes recibidos: ${expedientesInput.length}`);

(async () => {
    let browser = null, page = null;
    try {
        process.stdout.write("⚙️ PROGRESS: Configuraciones Generales...\n");
        ({ browser, page } = await testM2.configuracionesGenerales(profilePath));

        process.stdout.write("🔑 PROGRESS: Inicio de Sesion...\n");
        const loginURL = "http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1";
        await testM2.iniciarSesion(page, loginURL, identificador);
        console.log("✅ PROGRESS: Sesión iniciada.");

        // Configurar la ruta de descargas en Puppeteer
        const downloadDir = path.join(getDataPath(), 'descargas', `${identificador}_temp`);
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }
        await page._client().send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
        console.log("📥 PROGRESS: Configuración de descargas establecida en:", downloadDir);

        const resultados = [];
        const maxSoftReintentos = 1;  // Reintentos sin reiniciar el navegador
        const maxHardReintentos = 2;  // Reintentos reiniciando el navegador

        for (const exp of expedientesInput) {
            // Validar campos obligatorios
            if (!exp.jurisdiccion || !exp.numero || !exp.anio) {
                process.stdout.write(`⚠️ PROGRESS: Expediente ${exp.expediente} omitido por campos faltantes.\n`);
                continue;
            }

            process.stdout.write(`🔎 PROGRESS: Procesando expediente ${exp.expediente}...\n`);

            let procesado = false;
            let softIntentos = 0;
            let resultadoExpediente = null;

            // Determinar la página inicial según el backup
            let paginaInicial = 1;
            if (backupData[exp.expediente] && backupData[exp.expediente].ultimaPaginaProcesada) {
                paginaInicial = backupData[exp.expediente].ultimaPaginaProcesada + 1;
                console.log(`♻️ Se reanudará la extracción del expediente ${exp.expediente} desde la página ${paginaInicial}.`);
            }

            // Verificar consistencia de la última página procesada, si existe
            if (
                paginaInicial > 1 &&
                backupData[exp.expediente]?.paginas?.[String(paginaInicial - 1)] &&
                Array.isArray(backupData[exp.expediente].paginas[String(paginaInicial - 1)]) &&
                backupData[exp.expediente].paginas[String(paginaInicial - 1)].length > 0
            ) {
                const ultimaPaginaProcesada = paginaInicial - 1;
                const backupMovimientos = backupData[exp.expediente].paginas[String(ultimaPaginaProcesada)];

                console.log(`🔍 Verificando consistencia de la última página procesada (${ultimaPaginaProcesada}) para el expediente ${exp.expediente}...`);

                await testM2.nuevaConsultaPublica(page, exp.jurisdiccion, exp.numero, exp.anio);
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Obtenemos el contenido HTML de la página
                const htmlContent = await page.content();

                // Verificamos si el HTML contiene la cadena que indica el error SSL
                if (htmlContent.includes("Pantalla de error SSL detectada en el contenido HTML")) {
                    console.error("❌ Pantalla de error SSL detectada en el contenido HTML.");
                    // Cierra el navegador antes de cambiar de estrategia a hard reintentos
                    await cerrarNavegador(browser);
                    // Lanza un error para que el bloque catch capture esta condición y se proceda con los hard reintentos
                    throw new Error("SSL_BLOCK_SCREEN_DETECTED");
                }

                const verificacion = await verificarPaginaExpediente(page, ultimaPaginaProcesada, backupMovimientos);

                if (!verificacion) {
                    console.error(`❌ Verificación fallida para la página ${ultimaPaginaProcesada} en el expediente ${exp.expediente}. Se reiniciará la extracción desde la página 1.`);
                    backupData[exp.expediente] = { ultimaPaginaProcesada: 0, paginas: {}, completo: false };
                    guardarBackup();
                    paginaInicial = 1;
                } else {
                    console.log(`✅ Verificación exitosa para la página ${ultimaPaginaProcesada} en el expediente ${exp.expediente}.`);
                    // Aquí forzamos que, si la verificación es exitosa, se use la información respaldada sin reintento
                    resultadoExpediente = { movimientos: backupMovimientos };
                    procesado = true;
                }
            }

            // --- Modo Soft Reintentos ---
            while (!procesado && softIntentos < maxSoftReintentos) {
                try {
                    await testM2.nuevaConsultaPublica(page, exp.jurisdiccion, exp.numero, exp.anio);

                    // Agregamos una pausa breve para asegurarnos de que se cargue todo el contenido
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Obtenemos el contenido HTML de la página
                    const htmlContent = await page.content();

                    // Verificamos si el HTML contiene el mensaje de error SSL
                    if (htmlContent.includes("Pantalla de error SSL detectada en el contenido HTML")) {
                        console.error("❌ Pantalla de error SSL detectada en el contenido HTML.");
                        // En lugar de cerrar el navegador, salimos del ciclo para pasar a hard reintentos.
                        throw new Error("SSL_BLOCK_SCREEN_DETECTED");
                    }

                    // Continuar con el resto del procesamiento...
                    process.stdout.write(`📡 PROGRESS: Consulta pública enviada para expediente ${exp.expediente}...\n`);
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    // Simulación de errores en modo soft
                    if (SIMULAR_ERRORES && configuracionErroresSimulados[exp.expediente]?.soft?.includes(paginaInicial)) {
                        configuracionErroresSimulados[exp.expediente].soft = configuracionErroresSimulados[exp.expediente].soft.filter(p => p !== paginaInicial);
                        throw new Error(`Error simulado (soft) en expediente ${exp.expediente}, página ${paginaInicial}`);
                    }

                    resultadoExpediente = await testM2.iterarTablaActuaciones(page, { mode: 'quick5mam', paginaInicial });
                    if (
                        !resultadoExpediente ||
                        !resultadoExpediente.movimientos ||
                        !Array.isArray(resultadoExpediente.movimientos) ||
                        resultadoExpediente.movimientos.length === 0
                    ) {
                        throw new Error("No se detectaron movimientos válidos en la página actual.");
                    }
                    procesado = true;
                } catch (error) {
                    if (error.message === 'SSL_BLOCK_SCREEN_DETECTED') {
                        process.stdout.write(`❌ ERROR: Se detectó un error SSL crítico en el expediente ${exp.expediente}. Abortando reintentos soft...\n`);
                        guardarBackup();
                        // Aquí NO se cierra el navegador en soft reintentos; se pasa directamente a hard reintentos.
                        break;
                    }
                    softIntentos++;
                    process.stdout.write(`❌ ERROR: Fallo procesamiento expediente ${exp.expediente} en soft attempt ${softIntentos}: ${error.message}\n`);
                    if (softIntentos < maxSoftReintentos) {
                        process.stdout.write(`🔄 PROGRESS: Reintentando expediente ${exp.expediente} en 5 segundos (soft reintento)...\n`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            }

            // Si se agotaron los soft reintentos sin éxito...
            if (!procesado && softIntentos >= maxSoftReintentos) {
                // Registra que se han agotado los soft reintentos.
                process.stdout.write(`⚠️ PROGRESS: Soft reintentos agotados para el expediente ${exp.expediente}. Se procederá con hard reintentos...\n`);
                // Guarda el estado.
                guardarBackup();
                // Continuar con los hard reintentos...
            }

            // --- Modo Hard Reintentos ---
            if (!procesado) {
                let hardIntentos = 0;
                while (!procesado && hardIntentos < maxHardReintentos) {
                    try {
                        process.stdout.write(`🔄 PROGRESS: Reiniciando navegador para expediente ${exp.expediente} (hard attempt ${hardIntentos + 1})...\n`);

                        // 1. Cierra la instancia actual del navegador si existe.
                        // Se llama siempre sin importar el estado de isConnected() o browser.process,
                        // ya que browser.close() termina el proceso de Chrome aunque el protocolo
                        // DevTools esté desconectado (evita instancias huérfanas de Chrome).
                        if (browser) {
                            await cerrarNavegador(browser);
                            browser = null;
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }

                        // 2. Reinicia el navegador y la página
                        //process.stdout.write("Perfil encontrado. Configurando navegador...\n");
                        const conf = await testM2.configuracionesGenerales(profilePath);
                        browser = conf.browser;
                        page = conf.page;

                        // Verifica si el navegador está conectado
                        if (!browser || (typeof browser.isConnected === 'function' && !browser.isConnected())) {
                            throw new Error("Browser disconnected");
                        }

                        // 3. Realiza el proceso de login con reintentos hard
                        let loginReintentos = 0;
                        const maxLoginHard = 2;
                        let loginExitoso = false;

                        while (!loginExitoso && loginReintentos < maxLoginHard) {
                            try {
                                await page.goto(loginURL, { waitUntil: 'networkidle2', timeout: 60000 });
                                try {
                                    await page.waitForSelector('body', { timeout: 10000 });
                                } catch {
                                    throw new Error("BODY_NOT_FOUND");
                                }
                                await testM2.iniciarSesion(page, loginURL, identificador);
                                loginExitoso = true;
                            } catch (error) {
                                loginReintentos++;
                                console.error(`❌ ERROR en inicio de sesión, intento hard ${loginReintentos}: ${error.message}`);
                                if (loginReintentos < maxLoginHard) {
                                    process.stdout.write(`🔄 PROGRESS: Reintentando inicio de sesión con reinicio de navegador en 5 segundos...\n`);
                                    await new Promise(resolve => setTimeout(resolve, 5000));
                                } else {
                                    throw new Error(`Fallo el inicio de sesión tras ${maxLoginHard} hard attempts: ${error.message}`);
                                }
                            }
                        }

                        // 4. Envía la consulta pública y espera a que se estabilice la página
                        await testM2.nuevaConsultaPublica(page, exp.jurisdiccion, exp.numero, exp.anio);
                        process.stdout.write(`📡 PROGRESS: Consulta pública enviada para expediente ${exp.expediente} tras reinicio...\n`);
                        await new Promise(resolve => setTimeout(resolve, 5000));

                        // 5. Simulación de errores en modo hard
                        if (SIMULAR_ERRORES && configuracionErroresSimulados[exp.expediente]?.hard?.includes(paginaInicial)) {
                            configuracionErroresSimulados[exp.expediente].hard = configuracionErroresSimulados[exp.expediente].hard.filter(p => p !== paginaInicial);
                            throw new Error(`Error simulado (hard) en expediente ${exp.expediente}, página ${paginaInicial}`);
                        }

                        // 6. Ejecuta la iteración para extraer movimientos
                        resultadoExpediente = await testM2.iterarTablaActuaciones(page, { mode: 'quick5mam', paginaInicial });
                        if (
                            !resultadoExpediente ||
                            !resultadoExpediente.movimientos ||
                            !Array.isArray(resultadoExpediente.movimientos) ||
                            resultadoExpediente.movimientos.length === 0
                        ) {
                            throw new Error("No se detectaron movimientos válidos en la página actual.");
                        }
                        procesado = true;
                    } catch (error) {
                        // Si se detecta un error SSL crítico, aborta los reintentos hard
                        if (error.message === 'SSL_BLOCK_SCREEN_DETECTED') {
                            process.stdout.write(`❌ ERROR: Se detectó un error SSL crítico en el expediente ${exp.expediente} durante hard attempt. Abortando hard reintentos...\n`);
                            guardarBackup();
                            if (browser) {
                                await cerrarNavegador(browser);
                                browser = null;
                            }
                            break;
                        }
                        // Incrementa el contador y maneja los errores en los reintentos
                        hardIntentos++;
                        process.stdout.write(`❌ ERROR: Fallo procesamiento expediente ${exp.expediente} en hard attempt ${hardIntentos}: ${error.message}\n`);
                        if (hardIntentos < maxHardReintentos) {
                            guardarBackup();
                            process.stdout.write(`🔄 PROGRESS: Reintentando expediente ${exp.expediente} con reinicio de navegador en 5 segundos...\n`);
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        } else {
                            guardarBackup();
                            if (browser) {
                                await cerrarNavegador(browser);
                                browser = null;
                            }
                            process.stdout.write(`❌ ERROR: Fallo procesamiento expediente ${exp.expediente} tras ${maxHardReintentos} hard attempts: ${error.message}\n`);
                        }
                    }
                }
            }


            // --- Si agotó todos los reintentos, se genera un movimiento informativo ---
            if (!procesado) {
                process.stdout.write(`❌ ERROR: Fallo procesamiento expediente ${exp.expediente} tras agotar todos los reintentos.\n`);
                const movimientoInformativo = {
                    fecha: "-",
                    organismo: "-",
                    detalle: `No se pudo procesar el expediente ${exp.expediente}: error persistente en la extracción tras múltiples intentos.`,
                    archivo: "nn"
                };
                resultados.push({
                    expediente: exp.expediente,
                    movimientos: [movimientoInformativo]
                });
            }

            // --- Si se procesó correctamente, agregar el resultado y actualizar el backup ---
            if (procesado && resultadoExpediente) {
                let movimientos = resultadoExpediente.movimientos || [];
                if (!Array.isArray(movimientos)) {
                    movimientos = [movimientos];
                }
                const modoSeleccionado = 'quick5mam'; // modo usado en iterarTablaActuaciones (maxDownloadsPerPage: 0)
                // En la función que renderiza los movimientos:
                movimientos.map(mov => {
                    // Comprobar si, además de existir archivo, el modo activo prevé descarga
                    if (mov.archivo && mov.archivo !== "nn" && modoSeleccionado === 'quick5') {
                        // 1. Calcula la carpeta base 'descargas' de tu proyecto:
                        const baseDir = path.join(getDataPath(), 'descargas');
                        // 2. Obtén la ruta relativa desde 'baseDir' hasta el archivo:
                        let relativePath = path.relative(baseDir, mov.archivo);
                        // 3. Normaliza separadores a '/' para URLs:
                        relativePath = relativePath.split(path.sep).join('/');
                        // 4. Genera el enlace de descarga:
                        mov.detalle = `<a href="/descargas/${relativePath}" target="_blank">${mov.detalle}</a>`;
                    } else if (mov.viewHref) {
                        // Solo si hay URL válida
                        mov.detalle = `<a href="${mov.viewHref}" target="_blank">${mov.detalle}</a>`;
                    } else {
                        // sin link: se queda el texto tal cual
                        mov.detalle = mov.detalle;
                    }

                    return mov;
                });
                resultados.push({
                    expediente: exp.expediente,
                    movimientos: movimientos
                });
                backupData[exp.expediente] = {
                    ultimaPaginaProcesada: 1,
                    paginas: { "1": movimientos },
                    completo: false
                };
                guardarBackup();
            }
        }

        if (browser) {
            await cerrarNavegador(browser);
        }
        browser = null; // Opcional, para forzar que se cree una nueva instancia después.

        if (fs.existsSync(backupFilePath)) {
            try {
                fs.unlinkSync(backupFilePath);
                console.log("🗑️ Backup eliminado tras extracción exitosa.");
            } catch (error) {
                console.error("❌ ERROR al eliminar backup_expedientes.json:", error.message);
            }
        }

        process.stdout.write("RESULT:" + JSON.stringify(resultados) + "\n");
    } catch (error) {
        console.error(`❌ ERROR en consultarscwpjn.js: ${error.message}`);
        process.stdout.write("ERROR:" + error.message + "\n");
        process.exit(1);
    } finally {
        if (browser) {
            await cerrarNavegador(browser);
        }
        browser = null;
        if (fs.existsSync(lockFilePath)) {
            fs.unlinkSync(lockFilePath);
            console.log("🔒 Lock eliminado tras la finalización de la ejecución.");
        }
    }
})();
