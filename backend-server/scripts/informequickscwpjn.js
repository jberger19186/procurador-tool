// informequickscwpjn.js
// node informequickscwpjn.js "FCR 018745/2017" 27320694359
// node informequickscwpjn.js "CAF 068920/2018" 27320694359

const path = require('path');
// directorio 'descargas' dentro de este proyecto
const DOWNLOADS_DIR = path.join(__dirname, 'descargas');
const fs = require('fs');
const testM2 = require('./testM2');
const {
    configuracionesGenerales,
    iniciarSesion,
    nuevaConsultaPublica,
    extraerDatosGenerales,
    extraerTablaActuaciones,
    extraerTablaActuacionesHistoricas,
    clickEnVerActuales,
    manejarCheckboxes,
    clickEnVerVarios,
    extraerTablaNotas,
    generarPDFExpediente,
} = testM2;

// Constantes
const PROFILE_PATH = path.join(process.env.LOCALAPPDATA, 'ProcuradorSCW', 'ChromeProfile');
const PID_FILE_PATH = path.join(__dirname, 'pid_quickscw.txt');

// Evitar límite de listeners para no generar memory leaks
process.setMaxListeners(0);

// Capturar SIGTERM (en Windows equivale a terminate) y salir al instante
process.on('SIGTERM', () => {
    console.log('🔔 SIGTERM recibido: solicitando fin inmediato');
    if (fs.existsSync(PID_FILE_PATH)) fs.unlinkSync(PID_FILE_PATH);
    console.log('RESULT: {"navegador_cerrado":true}');
    process.exit(0);
});

/**
 * Cierra el navegador de forma segura:
 *  1) intenta browser.close()
 *  2) si falla, intenta process.kill() sin hacer throw
 */
async function cerrarNavegadorSeguro(browser) {
    if (!browser) return;
    try {
        await browser.close();
    } catch (err) {
        console.warn(`⚠️ browser.close() falló: ${err.message}`);
    }
    const proc = browser.process && browser.process();
    if (proc && proc.pid) {
        try {
            process.kill(proc.pid);
        } catch (err) {
            console.warn(`⚠️ No se pudo matar PID ${proc.pid}: ${err.message}`);
        }
    }
}

const DEFAULT_IDENTIFICADOR = "27320694359";

// Configuración de tipos de movimientos
const EQUIVALENCIAS_MOVIMIENTOS = {
    "man": { maxPages: 0, maxRowsPerPage: 0, maxDownloadsPerPage: 0, mode: null },
    "mam": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: 0, mode: "movimientos" },
    "mamhref": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: 0, mode: "movimientos_href" },
    "maa": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: 0, mode: "archivos" },
    "mama": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null, mode: "movimientos_archivos" },
    "mamasc": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null, mode: "movimientos_archivos_sc", downloadFilter: 'sc' },
    "mhn": { maxPages: 0, maxRowsPerPage: 0, maxDownloadsPerPage: 0, mode: null },
    "mhm": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: 0, mode: "movimientos" },
    "mhmhref": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: 0, mode: "movimientos_href" },
    "mha": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: 0, mode: "archivos" },
    "mhma": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null, mode: "movimientos_archivos" },
    "mhmasc": { maxPages: null, maxRowsPerPage: null, maxDownloadsPerPage: null, mode: "movimientos_archivos_sc", downloadFilter: 'sc' }
};

// Variable global para evitar ejecuciones duplicadas
let procesoEjecutado = false;

// Control de cierres manuales vs. programáticos
let cierreProgramatico = false;

// Manejo global de errores para asegurar respuesta JSON en caso de fallos inesperados
process.on('uncaughtException', function (err) {
    console.log('RESULT: {"error": "Error inesperado: ' + (err && err.message ? err.message : err) + '"}');
    process.exit(1);
});
process.on('unhandledRejection', function (err) {
    console.log('RESULT: {"error": "Error inesperado: ' + (err && err.message ? err.message : err) + '"}');
    process.exit(1);
});

/**
 * Obtiene y valida los argumentos de entrada
 * @returns {Object} Objeto con identificador y expedientes
 */
function obtenerArgumentos() {
    // Mapa de códigos de jurisdicción
    const jurisdiccionMap = {
        CSJ: "0", CIV: "1", CAF: "2", CCF: "3", CNE: "4",
        CSS: "5", CPE: "6", CNT: "7", CFP: "8", CCC: "9",
        COM: "10", CPF: "11", CPN: "12", FBB: "13", FCR: "14",
        FCB: "15", FCT: "16", FGR: "17", FLP: "18", FMP: "19",
        FMZ: "20", FPO: "21", FPA: "22", FRE: "23", FSA: "24",
        FRO: "25", FSM: "26", FTU: "27"
    };

    // Obtener identificador (tercer argumento o valor por defecto)
    let identificador = process.argv[3] || DEFAULT_IDENTIFICADOR;
    if (identificador === "default") {
        identificador = DEFAULT_IDENTIFICADOR;
    }
    process.env.IDENTIFICADOR = identificador;

    // Obtener y validar expediente
    const rawExp = process.argv.length > 2 ? process.argv[2] : null;
    if (!rawExp) {
        throw new Error("No se recibió ningún expediente.");
    }

    let expedientesInput;
    
    // Intentar procesar como JSON
    if (rawExp.trim().startsWith("[")) {
        try {
            expedientesInput = JSON.parse(rawExp);
        } catch (e) {
            throw new Error("El JSON de expedientes es inválido.");
        }
    } 
    // Procesar como formato "JUR NUMERO/ANIO"
    else {
        const regex = /^(\w+)\s+(\d+)\/(\d{4})$/;
        const match = rawExp.trim().match(regex);
        
        if (!match) {
            throw new Error("Formato de expediente no válido. Use 'JUR NUMERO/ANIO'");
        }
        
        const jurSigla = match[1].toUpperCase();
        const jurCodigo = jurisdiccionMap[jurSigla];
        
        if (!jurCodigo) {
            throw new Error(`Jurisdicción desconocida "${jurSigla}".`);
        }
        
        expedientesInput = [{
            jurisdiccion: jurCodigo,
            numero: match[2],
            anio: match[3],
            expediente: rawExp.trim()
        }];
    }

    console.log(`PROGRESS: Expedientes recibidos: ${expedientesInput.length}`);
    return { identificador, expedientesInput };
}

/**
 * Guarda el PID del navegador en un archivo
 * @param {Object} browser Instancia del navegador
 */
function guardarPID(browser) {
    const browserProcess = browser.process();
    const browserPid = browserProcess.pid;

    // Eliminar archivo anterior si existe
    if (fs.existsSync(PID_FILE_PATH)) {
        console.log("🗑️ Eliminando PID anterior...");
        fs.unlinkSync(PID_FILE_PATH);
    }
    
    // Guardar nuevo PID
    fs.writeFileSync(PID_FILE_PATH, browserPid.toString(), 'utf-8');
    console.log(`✅ Nuevo PID del navegador guardado en ${PID_FILE_PATH}: ${browserPid}`);
}

/**
 * Configura los manejadores de eventos para el navegador
 * @param {Object} browser Instancia del navegador
 */
function configurarEventos(browser) {
    // Indicador de desconexión inesperada
    browser.disconnectedFlag = false;
    browser.on('disconnected', () => {
        console.error('🔔 Conexión al navegador perdida inesperadamente');
        browser.disconnectedFlag = true;
    });
}

/**
 * Carga la configuración del informe desde un archivo
 * @returns {Object} Configuración del informe
 */
function cargarConfiguracionInforme() {
    // Definir valores por defecto
    let configInforme = {
        movimientosActuales: "mam",
        movimientosHistoricos: "mhn",
        intervinientes: false,
        vinculados: false,
        recursos: false,
        notas: false
    };

    try {
        // Leer la configuración desde el archivo
        const configPath = path.join(__dirname, "config_informe.json");
        if (fs.existsSync(configPath)) {
            configInforme = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        }
    } catch (error) {
        console.error("Error al leer la configuración del informe:", error);
    }

    return configInforme;
}

/**
 * Procesa un expediente y extrae toda su información
 * @param {Object} page Página del navegador
 * @param {Object} expediente Datos del expediente
 * @param {Object} configInforme Configuración del informe
 * @param {string} identificador Identificador del usuario
 * @returns {Object} Datos extraídos del expediente
 */
async function procesarExpediente(page, expediente, configInforme, identificador, browser) {

    // 1️ Normalizar expediente a clave de archivo
    // expediente.expediente es la cadena "JUR NUMERO/ANIO"
    const expedienteStr = expediente.expediente
        ? expediente.expediente.replace(/[^a-zA-Z0-9]/g, '_')
        : 'Expediente_Desconocido';

    // 2️ Cargar estado actual de secciones
    const estado = leerEstadoSecciones(identificador, expedienteStr);

    // Hoist de datosGenerales para uso global en la función
    let datosGenerales;
    let listaMovimientos;
    let listaMovimientosHistoricos;
    let seccionesOpcionales; 
    let intervinientes;
    let vinculados;
    let recursos;
    let notas;
    
    if (!expediente.jurisdiccion || !expediente.numero || !expediente.anio) {
        throw new Error(`Expediente ${expediente.expediente} omitido por datos faltantes.`);
    }

    process.stdout.write(`PROGRESS: Procesando expediente ${expediente.expediente}...\n`);
    await nuevaConsultaPublica(page, expediente.jurisdiccion, expediente.numero, expediente.anio);
    process.stdout.write(`PROGRESS: Consulta pública enviada para expediente ${expediente.expediente}...\n`);

    await new Promise(resolve => setTimeout(resolve, 5000));

    // ✅ Detección de "Expediente inexistente..." y abortar flujo
    try {
        const alertaSelector = '#divAlerta1 #messages .ui-messages-info-summary';
        // Espera corta por si la alerta tarda un instante en pintarse
        const alertaHandle = await page.$(alertaSelector);

        if (alertaHandle) {
            const textoAlerta = await page.$eval(alertaSelector, el => el.textContent.trim());
            if (textoAlerta && textoAlerta.includes('Expediente inexistente o no disponible para su consulta pública')) {
                console.warn(`⚠ ${textoAlerta}`);

                // Cierre seguro del navegador (ya definido en este mismo archivo)
                await cerrarNavegadorSeguro(browser);

                // Resultado estructurado para el caller
                const payload = {
                    codigo: "EXPEDIENTE_INEXISTENTE",
                    mensaje: textoAlerta,
                    expediente: expediente.expediente || null
                };
                console.log('RESULT: ' + JSON.stringify(payload));

                // Fin inmediato del proceso: no se puede continuar con el informe
                process.exit(0);
            }
        }
    } catch (e) {
        console.error('Error al verificar alerta de inexistencia:', e && e.message ? e.message : e);
    }

    // Extraer configuraciones específicas para movimientos
    const movimientosActualesConfig = EQUIVALENCIAS_MOVIMIENTOS[configInforme.movimientosActuales] || EQUIVALENCIAS_MOVIMIENTOS["mam"];
    const movimientosHistoricosConfig = EQUIVALENCIAS_MOVIMIENTOS[configInforme.movimientosHistoricos] || EQUIVALENCIAS_MOVIMIENTOS["mhn"];

    console.log("Configuración de Movimientos Actuales:", movimientosActualesConfig);
    console.log("Configuración de Movimientos Históricos:", movimientosHistoricosConfig);

    // ——————————————————————————————
    // Sección: datosGenerales
    // ——————————————————————————————
    if (!estado.datosGenerales.processed) {
        try {
            datosGenerales = await extraerDatosGenerales(page);
            if (browser && browser.disconnectedFlag) throw new Error('Navegador desconectado durante extracción de datos generales');

            // Validar que el objeto no esté vacío ni nulo
            if (
                !datosGenerales ||
                (typeof datosGenerales === 'object' && Object.keys(datosGenerales).length === 0)
            ) {
                throw new Error("La extracción de datos generales resultó vacía o nula.");
            }

            await actualizarEstadoSeccion(identificador, expedienteStr, "datosGenerales", true);
            await guardarBackupSeccion(identificador, expedienteStr, "datosGenerales", datosGenerales);
            console.log("→ datosGenerales marcado como processed y backup guardado");
        } catch (err) {
            console.error("Error en la extracción de datos generales:", err.message);
            throw err; // No marcar processed, el ciclo global reintentará
        }
    } else {
        console.log("→ Datos Generales ya procesados. Cargando backup...");
        datosGenerales = leerBackupSeccion(identificador, expedienteStr, "datosGenerales");
    }

    // ——————————————————————————————
    // Sección: listaMovimientos (Movimientos Actuales)
    // ——————————————————————————————
    if (estado.listaMovimientos === "nn") {
        console.log("→ Movimientos Actuales no solicitados. Omitiendo sección.");
        listaMovimientos = [];
    }
    else if (!estado.listaMovimientos.processed) {
        listaMovimientos = [];
        if (movimientosActualesConfig.mode !== null) {
            try {
                // Extraer movimientos de todas las páginas. Si falla algo, lanza error y no marca processed
                const movimientos = await extraerTablaActuaciones(page, {
                    maxPages: movimientosActualesConfig.maxPages,
                    maxRowsPerPage: movimientosActualesConfig.maxRowsPerPage,
                    maxDownloadsPerPage: movimientosActualesConfig.maxDownloadsPerPage,
                    mode: movimientosActualesConfig.mode,
                    downloadFilter: movimientosActualesConfig.downloadFilter
                });

                if (browser.disconnectedFlag) throw new Error('Navegador desconectado durante extracción de movimientos actuales');
                listaMovimientos = movimientos.movimientos || [];

                // Si tu función de extracción retorna una propiedad para saber si terminó TODAS las páginas, validalo así:
                if (!movimientos.completo) throw new Error("No se extrajeron todas las páginas de movimientos actuales.");

                // Si querés ser ultra estricto con datos vacíos:
                if (listaMovimientos.length === 0) throw new Error("Movimientos actuales vacío cuando se esperaba info.");

                // Solo si no hubo error, desconexión ni extracción incompleta:
                await actualizarEstadoSeccion(identificador, expedienteStr, "listaMovimientos", true);
                await guardarBackupSeccion(identificador, expedienteStr, "listaMovimientos", listaMovimientos);

                console.log("→ listaMovimientos marcado como processed y backup guardado");
            } catch (err) {
                console.error("Error en la extracción de movimientos actuales:", err.message);
                throw err; // No marcar como processed, no backup, que reintente el ciclo global
            }
        } else {
            console.log("Opción 'Ninguno' seleccionada para Movimientos Actuales. No extraigo datos ni marco processed.");
            // dejamos el estado en "nn", no lo convertimos a processed
        }
        console.log("Lista de Movimientos:", listaMovimientos);
    }
    else {
        console.log("→ Movimientos Actuales ya procesados. Cargando backup…");
        listaMovimientos = leerBackupSeccion(
            identificador,
            expedienteStr,
            "listaMovimientos"
        );
    }

    // ——————————————————————————————
    // Sección: listaMovimientosHistoricos (Movimientos Históricos)
    // ——————————————————————————————
    if (estado.listaMovimientosHistoricos === "nn") {
        console.log("→ Movimientos Históricos no solicitados. Omitiendo sección.");
        listaMovimientosHistoricos = [];
    }
    else if (!estado.listaMovimientosHistoricos.processed) {
        listaMovimientosHistoricos = [];

        if (movimientosHistoricosConfig.mode !== null) {
            try {
                const movimientosHistoricosRaw = await extraerTablaActuacionesHistoricas(page, {
                    maxPages: movimientosHistoricosConfig.maxPages,
                    maxRowsPerPage: movimientosHistoricosConfig.maxRowsPerPage,
                    maxDownloadsPerPage: movimientosHistoricosConfig.maxDownloadsPerPage,
                    mode: movimientosHistoricosConfig.mode,
                    downloadFilter: movimientosHistoricosConfig.downloadFilter
                });

                if (browser.disconnectedFlag) throw new Error('Navegador desconectado durante extracción de movimientos históricos');

                listaMovimientosHistoricos = procesarMovimientosHistoricos(movimientosHistoricosRaw.movimientosHistoricos);

                // Si tu función de extracción devuelve una señal de extracción completa:
                if (!movimientosHistoricosRaw.completo) throw new Error("No se extrajeron todas las páginas de movimientos históricos.");

                // SOLO marca error si la lista está vacía Y NO se detectó la leyenda oficial:
                if (
                    movimientosHistoricosRaw.movimientosHistoricos.length === 0
                    && !movimientosHistoricosRaw.sinHistoricas
                ) {
                    throw new Error("Movimientos históricos vacío cuando se esperaba info.");
                }

                // Solo si la extracción terminó bien, se guarda y marca como processed
                await actualizarEstadoSeccion(
                    identificador,
                    expedienteStr,
                    "listaMovimientosHistoricos",
                    true
                );
                if (
                    listaMovimientosHistoricos.length === 0
                    && movimientosHistoricosRaw.sinHistoricas
                ) {
                    // 1) Creamos el objeto informativo…
                    const info = { tipo: "info", detalle: "El expediente no posee actuaciones históricas." };
                    // 2) **Asignamos** esa leyenda al array que luego se pasará al PDF
                    listaMovimientosHistoricos = [info];
                    // 3) Guardamos el backup con la misma estructura
                    await guardarBackupSeccion(
                        identificador,
                        expedienteStr,
                        "listaMovimientosHistoricos",
                        [info]
                    );
                } else {
                    // Guarda los movimientos históricos normalmente
                    await guardarBackupSeccion(
                        identificador,
                        expedienteStr,
                        "listaMovimientosHistoricos",
                        listaMovimientosHistoricos
                    );
                }
                console.log("→ listaMovimientosHistoricos marcado como processed y backup guardado");

                // Si extraje datos reales, vinculo archivos y vuelvo a actuales
                if (listaMovimientosHistoricos.length > 0) {
                    listaMovimientosHistoricos = vincularArchivosDescargados(
                        listaMovimientosHistoricos,
                        datosGenerales,
                        identificador
                    );
                    
                }
                // Hacer click en “Ver actuales” SIEMPRE luego de procesar históricas:
                await clickEnVerActuales(page);
            } catch (err) {
                console.error("Error en la extracción de movimientos históricos:", err.message);
                throw err; // El ciclo global reintentará sin marcar ni guardar nada
            }
        } else {
            console.log("Opción 'Ninguno' seleccionada para Movimientos Históricos. No extraigo datos.");
        }

        console.log("Lista de Movimientos Históricos:", listaMovimientosHistoricos);

    }
    else {
        console.log("→ Movimientos Históricos ya procesados. Cargando backup…");
        listaMovimientosHistoricos = leerBackupSeccion(
            identificador,
            expedienteStr,
            "listaMovimientosHistoricos"
        );
    }


    // ——————————————————————————————
    // Secciones Opcionales: intervinientes, vinculados y recursos
    // ——————————————————————————————
    {
        const esNN = campo => estado[campo] === "nn";
        const procOK = campo => !esNN(campo) && estado[campo].processed;

        // 1) Si ninguna está solicitada, salimos de una
        if (esNN("intervinientes") && esNN("vinculados") && esNN("recursos")) {
            console.log("→ Ninguna sección opcional solicitada. Omitiendo todas.");
            intervinientes = [];
            vinculados = [];
            recursos = [];
        } else {
            // — Intervinientes —
            if (esNN("intervinientes")) {
                console.log("→ Intervinientes no solicitados. Omitiendo sección.");
                intervinientes = [];
            }
            else if (!estado.intervinientes.processed) {
                console.log("Buscando el botón 'intervinientes'…");
                try {
                    const resInt = await clickEnVerVarios(page, ['intervinientes']);
                    if (browser.disconnectedFlag) throw new Error('Navegador desconectado durante intervinientes');
                    intervinientes = Array.isArray(resInt.intervinientes)
                        ? resInt.intervinientes
                        : [];
                    console.log("Intervinientes extraídos:", intervinientes.length);

                    // Si necesitás que NUNCA marque processed si está vacío, descomenta:
                    if (intervinientes.length === 0) throw new Error("Intervinientes vacío cuando se esperaba info.");

                    // Solo si no hubo error ni desconexión ni frame detach:
                    await actualizarEstadoSeccion(identificador, expedienteStr, "intervinientes", true);
                    await guardarBackupSeccion(identificador, expedienteStr, "intervinientes", intervinientes);
                    console.log("→ intervinientes marcado como processed y backup guardado");

                    
                } catch (err) {
                    console.error("Error en sección 'intervinientes':", err.message);
                    throw err; // No marcar processed, se reintentará en el ciclo global
                }
            }
            else {
                console.log("→ Intervinientes ya procesados. Cargando backup…");
                intervinientes = leerBackupSeccion(identificador, expedienteStr, "intervinientes");
            }

            // — Vinculados —
            if (esNN("vinculados")) {
                console.log("→ Vinculados no solicitados. Omitiendo sección.");
                vinculados = [];
            }
            else if (!estado.vinculados.processed) {
                console.log("Buscando el botón 'vinculados'…");
                try {
                    const resVinc = await clickEnVerVarios(page, ['vinculados']);
                    if (browser.disconnectedFlag) throw new Error('Navegador desconectado durante vinculados');
                    vinculados = Array.isArray(resVinc.vinculados)
                        ? resVinc.vinculados
                        : [];
                    console.log("Vinculados extraídos:", vinculados.length);

                    if (vinculados.length === 0) throw new Error("Vinculados vacío cuando se esperaba info.");

                    await actualizarEstadoSeccion(identificador, expedienteStr, "vinculados", true);
                    await guardarBackupSeccion(identificador, expedienteStr, "vinculados", vinculados);
                    console.log("→ vinculados marcado como processed y backup guardado");

                    
                } catch (err) {
                    console.error("Error en sección 'vinculados':", err.message);
                    throw err;
                }
            }
            else {
                console.log("→ Vinculados ya procesados. Cargando backup…");
                vinculados = leerBackupSeccion(identificador, expedienteStr, "vinculados");
            }

            // — Recursos —
            if (esNN("recursos")) {
                console.log("→ Recursos no solicitados. Omitiendo sección.");
                recursos = [];
            }
            else if (!estado.recursos.processed) {
                console.log("Buscando el botón 'recursos'…");
                try {
                    const resRec = await clickEnVerVarios(page, ['recursos']);
                    if (browser.disconnectedFlag) throw new Error('Navegador desconectado durante recursos');
                    recursos = Array.isArray(resRec.recursos)
                        ? resRec.recursos
                        : [];
                    console.log("Recursos extraídos:", recursos.length);

                    if (recursos.length === 0) throw new Error("Recursos vacío cuando se esperaba info.");

                    await actualizarEstadoSeccion(identificador, expedienteStr, "recursos", true);
                    await guardarBackupSeccion(identificador, expedienteStr, "recursos", recursos);
                    console.log("→ recursos marcado como processed y backup guardado");

                    
                } catch (err) {
                    console.error("Error en sección 'recursos':", err.message);
                    throw err;
                }
            }
            else {
                console.log("→ Recursos ya procesados. Cargando backup…");
                recursos = leerBackupSeccion(identificador, expedienteStr, "recursos");
            }
        }
    }

    // ——————————————————————————————
    // Sección: notas
    // ——————————————————————————————
    if (estado.notas === "nn") {
        console.log("→ Notas no solicitadas. Omitiendo sección.");
        notas = [];
    }
    else if (!estado.notas.processed) {
        notas = [];
        if (configInforme.notas) {
            try {
                notas = (await extraerTablaNotas(page, '1')) || [];
                if (browser.disconnectedFlag) throw new Error('Navegador desconectado durante extracción de notas');
                console.log(`Extracción completada. Total de notas extraídas: ${notas.length}`);

                // Si NO querés aceptar notas vacías como correctas, descomentá la línea siguiente:
                if (notas.length === 0) throw new Error("Notas vacío cuando se esperaba info.");

                // Solo backup y marcado si no hubo error ni desconexión
                const backupDir = path.join(
                    DOWNLOADS_DIR,
                    `${identificador}_temp`,
                    `${expedienteStr}_backup`
                );
                if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
                const backupPath = path.join(backupDir, `notas.json`);
                fs.writeFileSync(backupPath, JSON.stringify(notas, null, 2), 'utf-8');
                console.log("Backup de notas guardado en:", backupPath);

                await actualizarEstadoSeccion(identificador, expedienteStr, "notas", true);
                console.log("→ notas marcado como processed");

                console.log("Notas extraídas:", notas);

            } catch (err) {
                console.error("Error al extraer la tabla de notas:", err.message);
                throw err;  // No marcar processed ni guardar backup; se reintentará globalmente
            }
        } else {
            console.log("Sección 'Notas' no configurada. Omitiendo extracción.");
        }
    }
    else {
        console.log("→ Notas ya procesadas. Cargando backup...");
        notas = leerBackupSeccion(identificador, expedienteStr, "notas");
        console.log("Notas recuperadas del backup:", notas);
    }

    return {
        datosGenerales,
        listaMovimientos,
        listaMovimientosHistoricos,
        intervinientes,
        vinculados,
        recursos,
        notas
    };
}

/**
 * Procesa los movimientos históricos para extraer sus componentes
 * @param {Array} movimientosHistoricos Lista de movimientos históricos en formato texto
 * @returns {Array} Lista de movimientos históricos procesados
 */
function procesarMovimientosHistoricos(movimientosHistoricos) {
    // Si devolvieron sólo la leyenda (un arreglo de strings), la convertimos en un objeto
    if (
        Array.isArray(movimientosHistoricos) &&
        movimientosHistoricos.length === 1 &&
        typeof movimientosHistoricos[0] === 'string'
    ) {
        return [{
            fecha:    "",
            tipo:     movimientosHistoricos[0],  // aquí queda "El expediente no posee actuaciones históricas."
            detalle:  "",
            aFs:      "",
            archivo:  "",
            viewHref: null
        }];
    }
    // Caso normal: mapeo de objetos
    return movimientosHistoricos.map(mov => ({
        fecha:    mov.fecha,
        tipo:     mov.tipo,
        detalle:  mov.detalle,
        aFs:      mov.aFs || "",
        archivo:  mov.archivo || "",
        viewHref: mov.viewHref || null
    }));
}


/**
 * Vincula los archivos descargados con los movimientos históricos
 * @param {Array} listaMovimientosHistoricos Lista de movimientos históricos
 * @param {Object} datosGenerales Datos generales del expediente
 * @param {string} identificador Identificador del usuario
 * @returns {Array} Lista actualizada de movimientos históricos
 */

function vincularArchivosDescargados(listaMovimientosHistoricos, datosGenerales, identificador) {
    const expedienteStr = datosGenerales.expediente
        ? datosGenerales.expediente.replace(/[^a-zA-Z0-9]/g, '_')
        : 'Expediente_Desconocido';

    // Ruta dinámica al subdirectorio de descargas históricas
    const carpetaDescargas = path.join(
        DOWNLOADS_DIR,
        `${identificador}_temp`,
        `${expedienteStr}_historicas`
    );

    if (fs.existsSync(carpetaDescargas)) {
        // Obtener y ordenar archivos renombrados
        const archivosRenombrados = fs.readdirSync(carpetaDescargas)
            .filter(file => /^[0-9]+_doc/.test(file))
            .sort();

        let contadorArchivo = 0;
        return listaMovimientosHistoricos.map(mov => {
            if (mov.archivo && mov.archivo.startsWith('Archivo descargado')) {
                mov.archivo = archivosRenombrados[contadorArchivo] || mov.archivo;
                contadorArchivo++;
            }
            return mov;
        });
    }

    return listaMovimientosHistoricos;
}


/**
 * Extrae las secciones opcionales según la configuración
 * @param {Object} page Página del navegador
 * @param {Object} configInforme Configuración del informe
 * @returns {Object} Datos de las secciones opcionales
 */
async function extraerSeccionesOpcionales(page, configInforme) {
    // Se arma un arreglo con las claves activas en la configuración
    let keysOpcionales = [];
    if (configInforme.intervinientes) keysOpcionales.push('intervinientes');
    if (configInforme.vinculados) keysOpcionales.push('vinculados');
    if (configInforme.recursos) keysOpcionales.push('recursos');

    let resultadosVarios = {};
    if (keysOpcionales.length > 0) {
        resultadosVarios = await clickEnVerVarios(page, keysOpcionales);
    }

    return {
        intervinientes: configInforme.intervinientes ? (resultadosVarios.intervinientes || []) : [],
        vinculados: configInforme.vinculados ? (resultadosVarios.vinculados || []) : [],
        recursos: configInforme.recursos ? (resultadosVarios.recursos || []) : []
    };
}

/**
 * Función principal con bucle de reintentos
 */
async function main() {

    // 1. Obtener argumentos y preparar estado
    const { identificador, expedientesInput } = obtenerArgumentos();
    const expedienteStr = expedientesInput[0]?.expediente
        .replace(/[^a-zA-Z0-9]/g, '_') || 'Expediente_Desconocido';

    // 2. Cargar configuración y definir tope de reintentos
    const configInforme = cargarConfiguracionInforme();
    const MAX_REINTENTOS = Number.isInteger(configInforme.maxReintentos)
        ? configInforme.maxReintentos
        : 10;

    // 3. Crear el estado inicial de secciones
    inicializarEstadoSecciones(identificador, expedienteStr, configInforme);

    let browser;

    // Evitar ejecución concurrente de main()

    if (procesoEjecutado) {
        console.log("⚠ El proceso ya se ejecutó, evitando ejecución concurrente.");
        process.exit(0);
    }
    procesoEjecutado = true;

    const FLAG_PATH = path.join(__dirname, 'stop_quickscw.flag');

    // 2. Bucle de reintentos: mientras queden disponibles
    while (puedeReintentar(identificador, expedienteStr)) {

        // ◼︎ Si el usuario pulsó Cerrar, salimos de inmediato
        if (fs.existsSync(FLAG_PATH)) {
            // limpiamos PID y flag
            if (fs.existsSync(PID_FILE_PATH)) fs.unlinkSync(PID_FILE_PATH);
            fs.unlinkSync(FLAG_PATH);
            console.log('RESULT: {"navegador_cerrado":true}');
            process.exit(0);
        }

        // 🔄 4️⃣ Resetear flag: cualquier cierre posterior se considera manual
        cierreProgramatico = false;

        // 1️⃣ Inicializar navegador
        const result = await configuracionesGenerales(PROFILE_PATH);
        browser = result.browser;
        const page = result.page;
        guardarPID(browser);
        configurarEventos(browser);

        // — Detectar desconexión antes de arrancar la sesión —
        if (browser.disconnectedFlag) {
            throw new Error('Navegador desconectado al iniciar sesión');
        }


        try {
            // === CONTENIDO ORIGINAL DE LA IIFE ===

            // Iniciar sesión
            process.stdout.write("PROGRESS: Inicio de Sesión...\n");
            const loginURL = "http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1";
            await Promise.race([
                iniciarSesion(page, loginURL, identificador),
                new Promise((_, reject) => browser.once('disconnected', () => reject(new Error('Desconexión durante iniciarSesion'))))
            ]);
            console.log("PROGRESS: Sesión iniciada.");


            // Procesar el primer expediente
            const exp = expedientesInput[0];
            if (!exp) {
                throw new Error("No hay expedientes para procesar.");
            }

            // Procesar expediente y extraer datos
            // === INICIALIZAR ESTADO DE SECCIONES ===
            const expedienteStr = exp.expediente ? exp.expediente.replace(/[^a-zA-Z0-9]/g, '_') : 'Expediente_Desconocido';
            
            const datosExpediente = await Promise.race([
                procesarExpediente(page, exp, configInforme, identificador, browser),
                new Promise((_, reject) => browser.once('disconnected', () => reject(new Error('Desconexión durante procesarExpediente'))))
            ]);


            // Determinar si debe incluir enlaces en actuales/históricos
            const incluirHrefActuales = configInforme.movimientosActuales === 'mamhref';
            const incluirHrefHistoricos = configInforme.movimientosHistoricos === 'mhmhref';

            // 🔹 Cargar el estado persistido de secciones
            const estado = leerEstadoSecciones(identificador, expedienteStr);

            // ——————————————————————————————
            // Sección: pdfGenerado (Generación de PDF)
            // ——————————————————————————————
            if (!estado.pdfGenerado.processed) {
                try {
                    // Generar PDF con los datos recopilados
                    const pdfPath = await Promise.race([
                        generarPDFExpediente(
                            datosExpediente.datosGenerales,
                            datosExpediente.listaMovimientos,
                            datosExpediente.listaMovimientosHistoricos,
                            datosExpediente.intervinientes,
                            datosExpediente.vinculados,
                            datosExpediente.recursos,
                            datosExpediente.notas,
                            incluirHrefActuales,
                            incluirHrefHistoricos
                        ),
                        new Promise((_, reject) => browser.once('disconnected', () => reject(new Error('Desconexión durante generarPDF'))))
                    ]);

                    console.log(`Archivo PDF generado en: ${pdfPath}`);

                    // Marcar PDF como generado en estado_secciones.json
                    await actualizarEstadoSeccion(
                        identificador,
                        expedienteStr,
                        "pdfGenerado",
                        true
                    );
                } catch (error) {
                    console.error("Error al generar el PDF:", error);
                    // No marcamos como procesado para permitir reintentos sobre esta sección
                    throw error;
                }
            } else {
                console.log("→ PDF ya generado. Saltando sección.");
            }

            // Finalmente, notificamos éxito y salimos

            // ——————————————————————————————
            // Éxito: cerrar navegador y terminar proceso
            // ——————————————————————————————

            // 1️⃣ Quitamos el listener de 'disconnected' para no confundir con cierre manual
            browser.removeAllListeners('disconnected');

            // 2️⃣ Cerramos el navegador            
            cierreProgramatico = true;
            await browser.close();

            // 3️⃣ Emitimos resultado de éxito
            console.log('RESULT: {"mensaje":"Proceso completado con éxito."}');

            // 4️⃣ Salimos del proceso con código 0
            process.exit(0);

        } catch (error) {
            // 1. Loguear el error con número de intento
            const intentoActual = leerEstadoSecciones(identificador, expedienteStr)
                .contadorReintentos.attempts + 1;
            console.error(`Error en intento #${intentoActual}:`, error.message);

            // Restaurar ventana antes de cerrar (solo activo en modo headless simulado)
            if (page) { try { await testM2.showBrowser(page); } catch (_) {} }

            // 2. Registrar y comprobar contador
            incrementarContadorReintentos(identificador, expedienteStr);
            if (!puedeReintentar(identificador, expedienteStr)) {
                console.error(`Máximo de ${MAX_REINTENTOS} reintentos alcanzado. Abortando.`);
                process.exit(1);
            }

            // 3. Reiniciar entorno antes del siguiente intento
            if (browser) {
                cierreProgramatico = true;

                // Cierre seguro del navegador (evita kill EPERM)
                await cerrarNavegadorSeguro(browser);
                console.log("Navegador cerrado de forma segura. Reiniciando entorno...");

                // Pausa breve para liberar recursos y evitar lanzamientos demasiado rápidos
                await new Promise(res => setTimeout(res, 1000));
            }
        }

    }
}

/**
 * Arranca la ejecución y captura errores fatales
 */
main().catch(err => {
    console.error("❌ Error fatal en main():", err.stack || err.message);
    process.exit(1);
});


// === GESTIÓN DE ESTADO DE SECCIONES ===

/**
 * Devuelve la ruta al archivo estado_secciones.json para un expediente y usuario
 */
function getEstadoSeccionesPath(identificador, expedienteStr) {
    const backupDir = path.join(
        DOWNLOADS_DIR,
        `${identificador}_temp`,
        `${expedienteStr}_backup`
    );
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    return path.join(backupDir, "estado_secciones.json");
}

/**
 * Inicializa el archivo de estado si no existe
 */
function inicializarEstadoSecciones(identificador, expedienteStr, configInforme) {
    const estadoPath = getEstadoSeccionesPath(identificador, expedienteStr);

    // Calcular localmente el máximo de reintentos
    const maxReintentos = Number.isInteger(configInforme.maxReintentos)
        ? configInforme.maxReintentos
        : 10;

    const estadoInicial = {
        // Nuevo contador de reintentos:
        contadorReintentos: {
            attempts: 0,            // inicia en cero
            max: maxReintentos      // límite configurado arriba
        },


        // Sólo processed o "nn":
        datosGenerales: { processed: false },

        // Movimientos Actuales: si configInforme.movimientosActuales === "man" ⇒ "nn"
        listaMovimientos:
            configInforme.movimientosActuales === "man"
                ? "nn"
                : { processed: false },

        // Movimientos Históricos: si configInforme.movimientosHistoricos === "mhn" ⇒ "nn"
        listaMovimientosHistoricos:
            configInforme.movimientosHistoricos === "mhn"
                ? "nn"
                : { processed: false },

        // Secciones booleanas: si false ⇒ "nn", si true ⇒ processed:false
        intervinientes:
            configInforme.intervinientes === false
                ? "nn"
                : { processed: false },
        vinculados:
            configInforme.vinculados === false
                ? "nn"
                : { processed: false },
        recursos:
            configInforme.recursos === false
                ? "nn"
                : { processed: false },

        // Notas: si false ⇒ "nn", si true ⇒ processed:false
        notas:
            configInforme.notas === false
                ? "nn"
                : { processed: false },


        pdfGenerado: false
    };

    if (!fs.existsSync(estadoPath)) {
        fs.writeFileSync(estadoPath, JSON.stringify(estadoInicial, null, 2), "utf-8");
    }
}

/**
 * Lee el estado actual del archivo
 */
function leerEstadoSecciones(identificador, expedienteStr) {
    const estadoPath = getEstadoSeccionesPath(identificador, expedienteStr);
    if (fs.existsSync(estadoPath)) {
        return JSON.parse(fs.readFileSync(estadoPath, "utf-8"));
    }
    return null;
}

/**
 * Actualiza el estado de una sección (sólo processed)
 */
function actualizarEstadoSeccion(identificador, expedienteStr, seccion, processed) {
    const estadoPath = getEstadoSeccionesPath(identificador, expedienteStr);
    const estado = leerEstadoSecciones(identificador, expedienteStr) || {};

    // Reemplazamos directamente por el nuevo processed
    estado[seccion] = { processed };

    fs.writeFileSync(estadoPath, JSON.stringify(estado, null, 2), "utf-8");
}

/**
 * Incrementa en 1 el contador global de reintentos en estado_secciones.json
 */
function incrementarContadorReintentos(identificador, expedienteStr) {
    const estadoPath = getEstadoSeccionesPath(identificador, expedienteStr);
    const estado = leerEstadoSecciones(identificador, expedienteStr) || {};

    // Suma un intento
    estado.contadorReintentos.attempts += 1;

    // Guarda el estado actualizado
    fs.writeFileSync(
        estadoPath,
        JSON.stringify(estado, null, 2),
        "utf-8"
    );
}

/**
 * Comprueba si aún quedan reintentos disponibles según el máximo configurado
 */
function puedeReintentar(identificador, expedienteStr) {
    const estado = leerEstadoSecciones(identificador, expedienteStr) || {};

    // Devuelve true si intentos actuales < límite
    return estado.contadorReintentos.attempts < estado.contadorReintentos.max;
}

/**
 * Actualiza el estado del PDF generado
 */
function actualizarEstadoPDF(identificador, expedienteStr, generado) {
    const estadoPath = getEstadoSeccionesPath(identificador, expedienteStr);
    let estado = leerEstadoSecciones(identificador, expedienteStr);
    if (!estado) {
        inicializarEstadoSecciones(identificador, expedienteStr);
        estado = leerEstadoSecciones(identificador, expedienteStr);
    }
    estado.pdfGenerado = generado;
    fs.writeFileSync(estadoPath, JSON.stringify(estado, null, 2), "utf-8");
}


/**
 * Guarda un backup individual de la sección si los datos son válidos
 * @param {string} identificador
 * @param {string} expedienteStr
 * @param {string} nombreSeccion
 * @param {any} datos
 */
function guardarBackupSeccion(identificador, expedienteStr, nombreSeccion, datos) {
    // Validar datos: no guardar si es null, undefined, array vacío u objeto vacío
    if (
        datos === null ||
        datos === undefined ||
        (Array.isArray(datos) && datos.length === 0) ||
        (typeof datos === 'object' && !Array.isArray(datos) && Object.keys(datos).length === 0)
    ) {
        return;
    }
    const backupDir = path.join(
        DOWNLOADS_DIR,
        `${identificador}_temp`,
        `${expedienteStr}_backup`
    );
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupPath = path.join(backupDir, `${nombreSeccion}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(datos, null, 2), "utf-8");
}

/**
 * Lee el JSON de backup de una sección previamente guardada.
 * @returns {any} Datos parseados del backup
 */
function leerBackupSeccion(identificador, expedienteStr, nombreSeccion) {
    const backupPath = path.join(
        DOWNLOADS_DIR,
        `${identificador}_temp`,
        `${expedienteStr}_backup`,
        `${nombreSeccion}.json`
    );
    if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup de sección "${nombreSeccion}" no encontrado en ${backupPath}`);
    }
    return JSON.parse(fs.readFileSync(backupPath, "utf-8"));
}

