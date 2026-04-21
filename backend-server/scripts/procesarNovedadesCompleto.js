/**
 * procesarNovedadesCompleto.js
 * Sistema automatizado de consulta de expedientes SCW PJN
 * Versión 1.0.0
 */

const testM1 = require('./testM1');
const testM2 = require('./testM2');
const sessionManager = require('./sessionManager');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ============ MÓDULOS EXTRA (OPCIONALES) ============
let notifier, nodemailer, ExcelJS;

// Referencia al browser activo accesible por el handler de SIGTERM
let _activeBrowser = null;

try { notifier   = require('node-notifier'); } catch (e) {}
try { nodemailer = require('nodemailer');    } catch (e) {}

try {
    ExcelJS = require('exceljs');
} catch (e) {
    console.warn('⚠️  exceljs no instalado. Exportación a Excel desactivada.');
}

const profilePath = path.join(process.env.LOCALAPPDATA, 'ProcuradorSCW', 'ChromeProfile');

// ============ OBTENER RUTA DE DATOS ============
function getDataPath() {
    // PRIORIDAD 1: Si viene de Electron, usar directamente APPDATA
    // (Electron ya pasa app.getPath('userData') que incluye 'procurador-electron')
    if (process.env.APPDATA && process.env.APPDATA.includes('procurador-electron')) {
        console.log('📂 Usando APPDATA de Electron:', process.env.APPDATA);
        return process.env.APPDATA;
    }

    // PRIORIDAD 2: Detectar si estamos empaquetado
    const isDev = !process.resourcesPath || process.resourcesPath === __dirname;

    if (isDev) {
        // DESARROLLO: usar carpeta del script
        return __dirname;
    }

    // PRIORIDAD 3: Fallback para ejecución standalone
    const appDataPath = process.env.APPDATA || process.env.HOME;
    return path.join(appDataPath, 'procurador-electron');
}

// ============ CARGAR CONFIGURACIÓN ============
function cargarConfiguracion() {
    // Detectar si estamos en producción
    const isDev = !process.resourcesPath || process.resourcesPath === __dirname;

    // Definir rutas posibles para config_proceso.json
    const posiblesRutas = isDev
        ? [
            path.join(__dirname, 'config_proceso.json'),  // Desarrollo: raíz del proyecto
        ]
        : [
            path.join(process.resourcesPath, 'app.asar.unpacked', 'config_proceso.json'),  // Producción: asarUnpack
            path.join(__dirname, 'config_proceso.json'),                                    // Fallback
            path.join(process.resourcesPath, 'config_proceso.json')                        // Otro fallback
        ];

    let configPath = null;

    // Buscar el archivo en las rutas posibles
    for (const ruta of posiblesRutas) {
        if (fs.existsSync(ruta)) {
            configPath = ruta;
            console.log(`📄 Configuración encontrada en: ${ruta}`);
            break;
        }
    }

    if (!configPath) {
        console.error('❌ ERROR: No se encontró config_proceso.json');
        console.error('   Rutas buscadas:');
        posiblesRutas.forEach(ruta => console.error(`   - ${ruta}`));
        console.error('   Ejecute instalador.bat para crearlo');
        process.exit(1);
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config;
    } catch (error) {
        console.error('❌ ERROR: config_proceso.json inválido:', error.message);
        process.exit(1);
    }
}

// ============ VALIDAR FECHA ============
function validarFecha(fecha) {
    const regex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!regex.test(fecha)) return false;

    const [dia, mes, anio] = fecha.split('/').map(Number);
    const fechaObj = new Date(anio, mes - 1, dia);

    return fechaObj.getDate() === dia &&
        fechaObj.getMonth() === mes - 1 &&
        fechaObj.getFullYear() === anio;
}

// ============ FUNCIÓN PRINCIPAL ============
async function procesarNovedadesCompleto(config) {
    const { fechaLimite, identificador, maxMovimientos, buscarEnTodos } = config.general;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🚀 PROCESO AUTOMÁTICO DE NOVEDADES`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  📅 Fecha límite:    ${fechaLimite}`);
    console.log(`  🆔 Identificador:   ${identificador}`);
    console.log(`  📊 Movimientos/exp: ${maxMovimientos}`);
    console.log(`  🔍 Buscar en:       ${buscarEnTodos ? 'TODOS' : 'Solo guardados'}`);
    console.log(`${'═'.repeat(60)}\n`);

    if (!validarFecha(fechaLimite)) {
        throw new Error(`Fecha límite inválida: ${fechaLimite}. Formato: DD/MM/YYYY`);
    }

    const resultados = {
        fechaEjecucion: new Date().toISOString(),
        fechaLimite,
        identificador,
        configuracion: {
            maxMovimientos,
            buscarEnTodos,
            incluirHistoricos: config.opciones.incluirHistoricos
        },
        expedientes: [],
        resumen: {
            totalListados: 0,
            totalConsultados: 0,
            exitosos: 0,
            fallidos: 0,
            tiempoListado: 0,
            tiempoConsulta: 0,
            tiempoTotal: 0
        }
    };

    let browser, page;
    const tiempoInicio = Date.now();

    try {
        // ============ FASE 1: INICIAR SESIÓN ============
        console.log("🔐 Iniciando sesión en SCW...");
        console.log("⏳ Abriendo navegador Chrome... por favor espere");
        ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));
        _activeBrowser = browser;
        console.log("✅ Navegador abierto y sesión iniciada correctamente\n");

        // ============ FASE 2: LISTAR EXPEDIENTES ============
        console.log("📋 FASE 1: Listando expedientes con novedades...\n");
        const tiempoListadoInicio = Date.now();

        let expedientesParaProcesar = [];

        if (buscarEnTodos) {
            console.log("🔍 Buscando en TODAS las secciones del SCW...\n");

            const secciones = [];
            if (config.secciones.letrado) secciones.push({ code: 1, type: "LETRADO" });
            if (config.secciones.parte) secciones.push({ code: 2, type: "PARTE" });
            if (config.secciones.autorizado) secciones.push({ code: 3, type: "AUTORIZADO NE" });
            if (config.secciones.favoritos) secciones.push({ code: 4, type: "FAVORITOS" });

            for (const sec of secciones) {
                console.log(`  📂 Procesando sección: ${sec.type}...`);

                try {
                    await testM1.consultarExpedientes(page, sec.code);
                    const { totalPaginas, totalExpedientes } = await testM1.ordenarYContarExpedientes(page);

                    if (totalPaginas === 0) {
                        console.log(`     ℹ️  No hay expedientes en ${sec.type}`);
                        continue;
                    }

                    console.log(`     🔢 ${totalExpedientes} expedientes encontrados`);
                    console.log(`     ⏳ Extrayendo datos...`);

                    const expedientes = await testM1.iterarListaExpedientes(page, totalPaginas, fechaLimite);
                    expedientesParaProcesar.push(...expedientes);

                    console.log(`     ✅ ${expedientes.length} expedientes con movimientos\n`);

                } catch (error) {
                    console.error(`     ❌ Error en sección ${sec.type}: ${error.message}\n`);
                    console.log(`\n${'─'.repeat(60)}`);
                    console.log(`  🔄 RECUPERACIÓN AUTOMÁTICA - Sección ${sec.type}`);
                    console.log(`${'─'.repeat(60)}`);
                    try {
                        await page.evaluate(() => document.readyState);
                        console.log(`  ⏳ Restaurando navegador...`);
                        await page.goto(testM1.URL, { waitUntil: 'networkidle2', timeout: 30000 });
                        console.log(`  ✅ Navegador restaurado. Continuando con siguiente sección.`);
                    } catch (_) {
                        console.log(`  ⚠️ Navegador cerrado o irrecuperable.`);
                        console.log(`  ⏳ Abriendo nueva instancia del navegador... (esto puede demorar unos segundos)`);
                        try { await require('./cerrarNavegador')(browser); } catch (_2) { /* ignorar */ }
                        try {
                            ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));
                            console.log(`  ✅ Nueva sesión iniciada. Continuando con siguiente sección.`);
                        } catch (sessionErr) {
                            console.error(`  ❌ No se pudo re-iniciar sesión: ${sessionErr.message}`);
                            throw sessionErr;
                        }
                    }
                    console.log(`${'─'.repeat(60)}\n`);
                }
            }

        } else {
            console.log("🔍 Cargando expedientes guardados...\n");

            const expedientesGuardadosPath = path.join(__dirname, `${identificador}.json`);

            if (!fs.existsSync(expedientesGuardadosPath)) {
                throw new Error(`No se encontró el archivo: ${expedientesGuardadosPath}`);
            }

            expedientesParaProcesar = JSON.parse(fs.readFileSync(expedientesGuardadosPath, 'utf8'));
            console.log(`  ✅ ${expedientesParaProcesar.length} expedientes cargados\n`);
        }

        // Eliminar duplicados
        const expedientesUnicos = Array.from(
            new Map(expedientesParaProcesar.map(exp => [exp.expediente, exp])).values()
        );

        resultados.resumen.totalListados = expedientesUnicos.length;
        resultados.resumen.tiempoListado = Math.round((Date.now() - tiempoListadoInicio) / 1000);

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`  ✅ FASE 1 COMPLETADA: ${expedientesUnicos.length} expedientes únicos`);
        console.log(`  ⏱️  Tiempo: ${resultados.resumen.tiempoListado}s`);
        console.log(`${'─'.repeat(60)}\n`);

        if (expedientesUnicos.length === 0) {
            console.log("⚠️  No hay expedientes para procesar.\n");

            if (config.notificaciones.activadas && notifier) {
                notifier.notify({
                    title: 'Procurar Expedientes',
                    message: '⚠️ No se encontraron expedientes para procesar',
                    sound: config.notificaciones.sonido
                });
            }

            return resultados;
        }

        // ============ RESTAURAR NAVEGADOR ANTES DE FASE 2 ============
        console.log("\n🔄 Verificando estado del navegador antes de FASE 2...");
        try {
            await page.evaluate(() => document.readyState);
            await page.goto(testM1.URL, { waitUntil: 'networkidle2', timeout: 30000 });
            console.log("✅ Navegador listo para FASE 2.");
        } catch (restoreError) {
            console.log(`\n${'─'.repeat(60)}`);
            console.log(`  🔄 RECUPERACIÓN AUTOMÁTICA - Pre FASE 2`);
            console.log(`${'─'.repeat(60)}`);
            console.log(`  ⚠️ Navegador cerrado o irrecuperable.`);
            console.log(`  ⏳ Abriendo nueva instancia del navegador... (esto puede demorar unos segundos)`);
            try { await require('./cerrarNavegador')(browser); } catch (_) { /* ignorar */ }
            try {
                ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));
                console.log(`  ✅ Nueva sesión iniciada. Listo para FASE 2.`);
            } catch (sessionErr) {
                console.error(`  ❌ No se pudo re-iniciar sesión: ${sessionErr.message}`);
                throw sessionErr;
            }
            console.log(`${'─'.repeat(60)}\n`);
        }

        // ============ FASE 3: CONSULTAR MOVIMIENTOS ============
        console.log("🔍 FASE 2: Consultando movimientos de expedientes...\n");
        const tiempoConsultaInicio = Date.now();
        const MAX_REINTENTOS_POR_EXPEDIENTE = 3;

        for (let i = 0; i < expedientesUnicos.length; i++) {
            const exp = expedientesUnicos[i];
            let expedienteCompletado = false;
            let reintentoExp = 0;

            while (!expedienteCompletado && reintentoExp < MAX_REINTENTOS_POR_EXPEDIENTE) {
                const progreso = `[${(i + 1).toString().padStart(3)}/${expedientesUnicos.length}]`;
                const sufReintento = reintentoExp > 0 ? ` (reintento ${reintentoExp}/${MAX_REINTENTOS_POR_EXPEDIENTE})` : '';

                console.log(`${progreso} 📋 ${exp.expediente}${sufReintento}`);

                const expedienteResultado = {
                    ...exp,
                    movimientos: [],
                    estado: 'pendiente',
                    error: null,
                    tiempoConsulta: 0
                };

                const tiempoExpInicio = Date.now();

                try {
                    // Health-check: verificar que la página esté viva antes de intentar
                    await page.evaluate(() => document.readyState);

                    const partes = exp.expediente.split(' ');
                    const codigo = partes[0].toUpperCase();
                    const [numero, anio] = partes[1].split('/');

                    const jurisdiccionMap = {
                        "CSJ": "0", "CIV": "1", "CAF": "2", "CCF": "3", "CNE": "4",
                        "CSS": "5", "CPE": "6", "CNT": "7", "CFP": "8", "CCC": "9",
                        "COM": "10", "CPF": "11", "CPN": "12", "FBB": "13", "FCR": "14",
                        "FCB": "15", "FCT": "16", "FGR": "17", "FLP": "18", "FMP": "19",
                        "FMZ": "20", "FPO": "21", "FPA": "22", "FRE": "23", "FSA": "24",
                        "FRO": "25", "FSM": "26", "FTU": "27"
                    };

                    const jurisdiccion = jurisdiccionMap[codigo];

                    if (!jurisdiccion) {
                        throw new Error(`Código de jurisdicción desconocido: ${codigo}`);
                    }

                    await testM2.nuevaConsultaPublica(page, jurisdiccion, numero, anio);
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const opciones = {
                        mode: 'custom',
                        maxPages: 1,
                        maxRowsPerPage: maxMovimientos,
                        maxDownloadsPerPage: config.opciones.descargarArchivos ? maxMovimientos : 0,
                        downloadFilter: null
                    };

                    const resultado = await testM2.iterarTablaActuaciones(page, opciones);

                    // Health-check post-extracción: si la página se rompió durante la extracción,
                    // los datos son corruptos (ej: frame detached silencioso, todos los campos null)
                    await page.evaluate(() => document.readyState);

                    expedienteResultado.movimientos = resultado.movimientos || [];
                    expedienteResultado.estado = 'exitoso';
                    expedienteResultado.tiempoConsulta = Math.round((Date.now() - tiempoExpInicio) / 1000);
                    resultados.resumen.exitosos++;

                    console.log(`         ✅ ${expedienteResultado.movimientos.length} movimientos | ${expedienteResultado.tiempoConsulta}s\n`);

                    resultados.expedientes.push(expedienteResultado);
                    resultados.resumen.totalConsultados++;
                    expedienteCompletado = true;

                } catch (error) {
                    expedienteResultado.tiempoConsulta = Math.round((Date.now() - tiempoExpInicio) / 1000);

                    console.log(`         ❌ Error: ${error.message}\n`);

                    // Determinar si es un error de página/browser roto (recuperable) o un error de datos (no recuperable).
                    // "Waiting for selector failed" ocurre cuando el frame se rompe DURANTE una operación
                    // (el frame se detacha y waitForSelector simplemente agota el timeout en vez de lanzar "detached").
                    const esErrorDePagina = error.message.includes('detached') ||
                        error.message.includes('Target closed') ||
                        error.message.includes('Session closed') ||
                        error.message.includes('Protocol error') ||
                        error.message.includes('Connection closed') ||
                        error.message.includes('Navigation failed') ||
                        error.message.includes('Waiting for selector') ||
                        error.message.includes('TimeoutError') ||
                        error.message.includes('timeout');

                    if (esErrorDePagina && reintentoExp + 1 < MAX_REINTENTOS_POR_EXPEDIENTE) {
                        // Error de página → recuperar e intentar de nuevo este expediente
                        console.log(`\n${'─'.repeat(60)}`);
                        console.log(`  🔄 RECUPERACIÓN AUTOMÁTICA - Expediente ${exp.expediente}`);
                        console.log(`${'─'.repeat(60)}`);
                        console.log(`  📌 El proceso NO se detuvo. Se reintentará este expediente.`);
                        try {
                            await page.evaluate(() => document.readyState);
                            console.log(`  ⏳ Restaurando navegador...`);
                            await page.goto(testM1.URL, { waitUntil: 'networkidle2', timeout: 30000 });
                            console.log(`  ✅ Navegador restaurado.`);
                        } catch (_) {
                            console.log(`  ⚠️ Navegador cerrado o irrecuperable.`);
                            console.log(`  ⏳ Abriendo nueva instancia del navegador... (esto puede demorar unos segundos)`);
                            try { await require('./cerrarNavegador')(browser); } catch (_2) { /* ignorar */ }
                            try {
                                ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));
                                console.log(`  ✅ Nueva sesión iniciada.`);
                            } catch (sessionErr) {
                                console.error(`  ❌ No se pudo re-iniciar sesión: ${sessionErr.message}`);
                                throw sessionErr;
                            }
                        }
                        reintentoExp++;
                        console.log(`  🔄 Reintentando expediente... (intento ${reintentoExp + 1}/${MAX_REINTENTOS_POR_EXPEDIENTE})`);
                        console.log(`${'─'.repeat(60)}\n`);
                        // NO marcar como completado → el while re-intenta
                    } else {
                        // Error de datos, o último reintento agotado → marcar como fallido y avanzar
                        expedienteResultado.estado = 'fallido';
                        expedienteResultado.error = error.message;
                        resultados.resumen.fallidos++;
                        resultados.expedientes.push(expedienteResultado);
                        resultados.resumen.totalConsultados++;
                        expedienteCompletado = true;

                        // Si fue error de página en el último reintento, igual recuperar para los siguientes
                        if (esErrorDePagina) {
                            console.log(`\n${'─'.repeat(60)}`);
                            console.log(`  🔄 RECUPERACIÓN AUTOMÁTICA`);
                            console.log(`${'─'.repeat(60)}`);
                            console.log(`  ⚠️ Reintentos agotados para ${exp.expediente}.`);
                            console.log(`  ⏳ Recuperando navegador para continuar con los demás expedientes...`);
                            try {
                                await page.evaluate(() => document.readyState);
                                await page.goto(testM1.URL, { waitUntil: 'networkidle2', timeout: 30000 });
                                console.log(`  ✅ Navegador restaurado.`);
                            } catch (_) {
                                console.log(`  ⏳ Abriendo nueva instancia del navegador...`);
                                try { await require('./cerrarNavegador')(browser); } catch (_2) { /* ignorar */ }
                                try {
                                    ({ browser, page } = await sessionManager.iniciarNuevaSesion(profilePath, identificador));
                                    console.log(`  ✅ Nueva sesión iniciada.`);
                                } catch (sessionErr) {
                                    throw sessionErr;
                                }
                            }
                            console.log(`${'─'.repeat(60)}\n`);
                        }
                    }
                }
            }
        }

        resultados.resumen.tiempoConsulta = Math.round((Date.now() - tiempoConsultaInicio) / 1000);

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`  ✅ FASE 2 COMPLETADA`);
        console.log(`     ✅ Exitosos: ${resultados.resumen.exitosos}`);
        console.log(`     ❌ Fallidos: ${resultados.resumen.fallidos}`);
        console.log(`     ⏱️  Tiempo: ${resultados.resumen.tiempoConsulta}s`);
        console.log(`${'─'.repeat(60)}\n`);

        // ============ GUARDAR RESULTADOS ============
        resultados.resumen.tiempoTotal = Math.round((Date.now() - tiempoInicio) / 1000);

        console.log("💾 Guardando resultados...\n");

        const timestamp = new Date().toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .substring(0, 19);

        const dirPath = path.join(getDataPath(), 'descargas', 'procesos_automaticos');

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        // JSON completo
        const jsonPath = path.join(dirPath, `proceso_${timestamp}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(resultados, null, 2));
        console.log(`   📄 JSON: proceso_${timestamp}.json`);

        // JSON con nombre fijo (para el visor)
        const jsonFijoPath = path.join(getDataPath(), 'descargas', 'ultimo_proceso.json');
        fs.writeFileSync(jsonFijoPath, JSON.stringify(resultados, null, 2));

        // TXT resumen
        //const txtPath = path.join(dirPath, `resumen_${timestamp}.txt`);
        //if (config.opciones.formatoSalida === 'ambos' || config.opciones.formatoSalida === 'txt') {
        //    const resumenTxt = generarResumenTexto(resultados);
        //    fs.writeFileSync(txtPath, resumenTxt);
        //    console.log(`   📄 TXT:  resumen_${timestamp}.txt`);
        //}

        // ============ GENERAR EXCEL ============
        if (config.excel.generar && ExcelJS) {
            console.log("\n📊 Generando archivo Excel...");
            const excelPath = await generarExcel(resultados, timestamp, config.excel.incluirMovimientos);
            if (excelPath) {
                console.log(`   ✅ Excel: proceso_${timestamp}.xlsx`);
            }
        }

        // ============ GENERAR VISOR CON DATOS EMBEBIDOS ============
        console.log("\n🌐 Generando visor HTML...");
        const visorPath = await generarVisorConDatos(resultados);
        console.log(`   ✅ Visor: visor_generado.html`);

        // ============ NOTIFICACIÓN ============
        if (config.notificaciones.activadas && notifier) {
            notifier.notify({
                title: 'Procurar Expedientes - Completado',
                message: `✅ ${resultados.resumen.exitosos} exitosos | ❌ ${resultados.resumen.fallidos} fallidos`,
                sound: config.notificaciones.sonido,
                icon: path.join(__dirname, 'icono.ico'),
                wait: false
            });
        }

        // ============ ENVIAR EMAIL ============
        if (config.email.activado && nodemailer) {
            console.log("\n📧 Enviando email...");
            try {
                await enviarEmail(config.email, resultados, jsonPath, txtPath);
                console.log("   ✅ Email enviado correctamente");
            } catch (emailError) {
                console.error(`   ❌ Error al enviar email: ${emailError.message}`);
            }
        }

        // ============ ABRIR VISOR ============
        if (config.visor.abrirAutomaticamente) {
            console.log("\n🌐 Abriendo visor en navegador...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            abrirEnNavegador(visorPath);
        }

        // ============ MOSTRAR RESUMEN FINAL ============
        mostrarResumenFinal(resultados);

        return resultados;

    } catch (error) {
        console.error(`\n❌ ERROR CRÍTICO: ${error.message}\n`);
        console.error(error.stack);

        // Restaurar ventana antes de cerrar (solo activo en modo headless simulado)
        if (page) { try { await testM1.showBrowser(page); } catch (_) {} }

        if (config.notificaciones.activadas && notifier) {
            notifier.notify({
                title: 'Procurar Expedientes - Error',
                message: `❌ Error: ${error.message}`,
                sound: config.notificaciones.sonido
            });
        }

        throw error;

    } finally {
        if (browser) {
            await require('./cerrarNavegador')(browser);
        }
    }
}

// ============ GENERAR RESUMEN TXT ============
function generarResumenTexto(resultados) {
    const ancho = 70;
    const linea = '═'.repeat(ancho);
    const lineaFina = '─'.repeat(ancho);

    let txt = `${linea}\n`;
    txt += `  RESUMEN DEL PROCESO AUTOMÁTICO - SCW PJN\n`;
    txt += `${linea}\n\n`;

    txt += `Ejecución:\n`;
    txt += `  Fecha/Hora:     ${new Date(resultados.fechaEjecucion).toLocaleString('es-AR')}\n`;
    txt += `  Fecha límite:   ${resultados.fechaLimite}\n`;
    txt += `  Identificador:  ${resultados.identificador}\n`;
    txt += `  Movimientos:    ${resultados.configuracion.maxMovimientos} por expediente\n\n`;

    txt += `${lineaFina}\n`;
    txt += `Resultados:\n`;
    txt += `  Expedientes listados:    ${resultados.resumen.totalListados}\n`;
    txt += `  Expedientes consultados: ${resultados.resumen.totalConsultados}\n`;
    txt += `  ✅ Exitosos:             ${resultados.resumen.exitosos}\n`;
    txt += `  ❌ Fallidos:             ${resultados.resumen.fallidos}\n\n`;

    txt += `${lineaFina}\n`;
    txt += `Tiempos:\n`;
    txt += `  Listado:   ${resultados.resumen.tiempoListado}s\n`;
    txt += `  Consulta:  ${resultados.resumen.tiempoConsulta}s\n`;
    txt += `  TOTAL:     ${resultados.resumen.tiempoTotal}s\n\n`;

    txt += `${linea}\n`;
    txt += `DETALLE DE EXPEDIENTES\n`;
    txt += `${linea}\n\n`;

    resultados.expedientes.forEach((exp, i) => {
        txt += `[${(i + 1).toString().padStart(3)}] ${exp.expediente}\n`;
        txt += `      Carátula:  ${exp.caratula}\n`;
        txt += `      Depend.:   ${exp.dependencia}\n`;
        txt += `      Situación: ${exp.situacion} | Última Act: ${exp.ultimaAct}\n`;
        txt += `      Estado:    ${exp.estado === 'exitoso' ? '✅' : '❌'} ${exp.estado.toUpperCase()}`;

        if (exp.estado === 'exitoso') {
            txt += ` | ${exp.movimientos.length} movimientos\n`;

            if (exp.movimientos.length > 0) {
                txt += `\n      Últimos 3 movimientos:\n`;
                exp.movimientos.slice(0, 3).forEach((mov, j) => {
                    txt += `        ${j + 1}. ${mov.fecha} - ${mov.tipo}\n`;
                    const detalleCorto = mov.detalle.substring(0, 60);
                    txt += `           ${detalleCorto}${mov.detalle.length > 60 ? '...' : ''}\n`;
                });
            }
        } else {
            txt += `\n      Error: ${exp.error}\n`;
        }

        txt += `\n`;
    });

    txt += `${linea}\n`;
    txt += `Fin del reporte - ${new Date().toLocaleString('es-AR')}\n`;
    txt += `${linea}\n`;

    return txt;
}

// ============ GENERAR EXCEL ============
async function generarExcel(resultados, timestamp, incluirMovimientos) {
    try {
        const workbook = new ExcelJS.Workbook();

        workbook.creator = 'Procurar Expedientes SCW';
        workbook.created = new Date();

        // Hoja 1: Resumen
        const sheetResumen = workbook.addWorksheet('Resumen');
        sheetResumen.columns = [
            { header: 'Concepto', key: 'concepto', width: 30 },
            { header: 'Valor', key: 'valor', width: 30 }
        ];

        sheetResumen.addRows([
            { concepto: 'Fecha de ejecución', valor: new Date(resultados.fechaEjecucion).toLocaleString('es-AR') },
            { concepto: 'Fecha límite', valor: resultados.fechaLimite },
            { concepto: 'Identificador', valor: resultados.identificador },
            { concepto: '', valor: '' },
            { concepto: 'Total listados', valor: resultados.resumen.totalListados },
            { concepto: 'Total consultados', valor: resultados.resumen.totalConsultados },
            { concepto: 'Exitosos', valor: resultados.resumen.exitosos },
            { concepto: 'Fallidos', valor: resultados.resumen.fallidos },
            { concepto: '', valor: '' },
            { concepto: 'Tiempo listado (s)', valor: resultados.resumen.tiempoListado },
            { concepto: 'Tiempo consulta (s)', valor: resultados.resumen.tiempoConsulta },
            { concepto: 'Tiempo total (s)', valor: resultados.resumen.tiempoTotal }
        ]);

        // Estilo del encabezado
        sheetResumen.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheetResumen.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF667eea' }
        };
        sheetResumen.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        // Hoja 2: Expedientes
        const sheetExpedientes = workbook.addWorksheet('Expedientes');
        sheetExpedientes.columns = [
            { header: 'Nº', key: 'numero', width: 5 },
            { header: 'Expediente', key: 'expediente', width: 20 },
            { header: 'Carátula', key: 'caratula', width: 50 },
            { header: 'Dependencia', key: 'dependencia', width: 30 },
            { header: 'Situación', key: 'situacion', width: 15 },
            { header: 'Última Act.', key: 'ultimaAct', width: 12 },
            { header: 'Estado', key: 'estado', width: 10 },
            { header: 'Movs.', key: 'cantMovimientos', width: 8 },
            { header: 'Tiempo (s)', key: 'tiempoConsulta', width: 10 }
        ];

        resultados.expedientes.forEach((exp, index) => {
            sheetExpedientes.addRow({
                numero: index + 1,
                expediente: exp.expediente,
                caratula: exp.caratula,
                dependencia: exp.dependencia,
                situacion: exp.situacion,
                ultimaAct: exp.ultimaAct,
                estado: exp.estado,
                cantMovimientos: exp.movimientos ? exp.movimientos.length : 0,
                tiempoConsulta: exp.tiempoConsulta
            });
        });

        sheetExpedientes.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheetExpedientes.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF667eea' }
        };
        sheetExpedientes.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        // Hoja 3: Movimientos (opcional)
        if (incluirMovimientos) {
            const sheetMovimientos = workbook.addWorksheet('Movimientos');
            sheetMovimientos.columns = [
                { header: 'Expediente', key: 'expediente', width: 20 },
                { header: 'Carátula', key: 'caratula', width: 50 },      // ← MOVIDO AQUÍ
                { header: 'Fecha', key: 'fecha', width: 12 },
                { header: 'Tipo', key: 'tipo', width: 18 },
                { header: 'Detalle', key: 'detalle', width: 57 },
                { header: 'Oficina', key: 'oficina', width: 15 },
                { header: 'hRef', key: 'href', width: 15 },
                { header: '', key: 'separador', width: 5 }
            ];

            resultados.expedientes.forEach(exp => {
                if (exp.movimientos && exp.movimientos.length > 0) {
                    exp.movimientos.forEach(mov => {
                        // Agregar la fila con los datos
                        const row = sheetMovimientos.addRow({
                            expediente: exp.expediente,
                            fecha: mov.fecha,
                            tipo: mov.tipo,
                            detalle: mov.detalle,
                            oficina: mov.oficina || '',
                            caratula: exp.caratula,              // ← Carátula del expediente
                            href: mov.viewHref || '',            // ← URL (se convertirá a hipervínculo)
                            separador: '-'                       // ← Siempre "-"
                        });

                        // Convertir la celda hRef en hipervínculo clickeable si existe
                        if (mov.viewHref) {
                            const hrefCell = row.getCell('href');
                            hrefCell.value = {
                                text: mov.viewHref,              // Texto que se muestra
                                hyperlink: mov.viewHref,         // URL clickeable
                                tooltip: 'Click para abrir'      // Tooltip al pasar el mouse
                            };
                            hrefCell.font = {
                                color: { argb: 'FF0000FF' },     // Azul
                                underline: true                   // Subrayado
                            };
                        }
                    });
                }
            });

            // Estilo del encabezado
            sheetMovimientos.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheetMovimientos.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF667eea' }
            };
            sheetMovimientos.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
        }

        const excelPath = path.join(getDataPath(), 'descargas', 'procesos_automaticos', `proceso_${timestamp}.xlsx`);
        await workbook.xlsx.writeFile(excelPath);

        return excelPath;
    } catch (error) {
        console.error('   ❌ Error al generar Excel:', error.message);
        return null;
    }
}

// ============ ENVIAR EMAIL ============
async function enviarEmail(configEmail, resultados, jsonPath, txtPath) {
    try {
        const transporter = nodemailer.createTransport({
            host: configEmail.smtp.host,
            port: configEmail.smtp.port,
            secure: configEmail.smtp.secure,
            auth: {
                user: configEmail.smtp.user,
                pass: configEmail.smtp.pass
            }
        });

        const adjuntos = [
            {
                filename: 'resultados.json',
                path: jsonPath
            }
        ];

        if (txtPath && fs.existsSync(txtPath)) {
            adjuntos.push({
                filename: 'resumen.txt',
                path: txtPath
            });
        }

        const mailOptions = {
            from: configEmail.smtp.user,
            to: configEmail.destinatario,
            subject: `Procurar Expedientes SCW - ${new Date().toLocaleDateString('es-AR')}`,
            text: `Proceso completado exitosamente:
      
✅ Expedientes exitosos: ${resultados.resumen.exitosos}
❌ Expedientes fallidos: ${resultados.resumen.fallidos}
⏱️ Tiempo total: ${resultados.resumen.tiempoTotal}s

Fecha de ejecución: ${new Date(resultados.fechaEjecucion).toLocaleString('es-AR')}

Ver archivos adjuntos para más detalles.`,
            attachments: adjuntos
        };

        await transporter.sendMail(mailOptions);
    } catch (error) {
        throw new Error(`Error al enviar email: ${error.message}`);
    }
}

// ============ GENERAR VISOR CON DATOS EMBEBIDOS ============
async function generarVisorConDatos(resultados) {
    // Detectar si estamos en producción sin usar electron.app
    // Si process.resourcesPath existe y es diferente de __dirname, estamos empaquetados
    const isDev = !process.resourcesPath || process.resourcesPath === __dirname;

    // Buscar el template en múltiples ubicaciones posibles
    const posiblesRutas = isDev
        ? [
            path.join(__dirname, 'visorModal_template.html'),  // Desarrollo: raíz del proyecto
        ]
        : [
            path.join(process.resourcesPath, 'visorModal_template.html'),  // Producción: extraResources
            path.join(__dirname, 'visorModal_template.html'),              // Fallback: asarUnpack
            path.join(process.resourcesPath, 'app.asar.unpacked', 'visorModal_template.html')  // Otro fallback
        ];

    let templatePath = null;

    for (const ruta of posiblesRutas) {
        if (fs.existsSync(ruta)) {
            templatePath = ruta;
            console.log(`   📄 Template encontrado en: ${ruta}`);
            break;
        }
    }

    if (!templatePath) {
        console.error('   ❌ Rutas buscadas:');
        posiblesRutas.forEach(ruta => console.error(`      - ${ruta}`));
        throw new Error('No se encontró visorModal_template.html en ninguna ubicación esperada.');
    }

    const template = fs.readFileSync(templatePath, 'utf8');

    const scriptEmbebido = `<script>
const datosEmbebidos = ${JSON.stringify(resultados, null, 2)};
window.addEventListener('DOMContentLoaded', function() {
  if (typeof cargarDatosEmbebidos === 'function') {
    cargarDatosEmbebidos(datosEmbebidos);
  }
});
</script>`;

    const htmlFinal = template.replace('<!-- DATOS_EMBEBIDOS -->', scriptEmbebido);

    const visorPath = path.join(getDataPath(), 'descargas', 'visor_generado.html');

    // Asegurar que existe el directorio
    const dirPath = path.dirname(visorPath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(visorPath, htmlFinal, 'utf8');

    return visorPath;
}

// ============ ABRIR EN NAVEGADOR ============
function abrirEnNavegador(filePath) {
    let comando;

    if (process.platform === 'win32') {
        comando = `start "" "${filePath}"`;
    } else if (process.platform === 'darwin') {
        comando = `open "${filePath}"`;
    } else {
        comando = `xdg-open "${filePath}"`;
    }

    exec(comando, (error) => {
        if (error) {
            console.error('   ⚠️  Error al abrir navegador:', error.message);
            console.log(`   💡 Abra manualmente: ${filePath}`);
        }
    });
}

// ============ MOSTRAR RESUMEN FINAL ============
function mostrarResumenFinal(resultados) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📊 RESUMEN FINAL`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  📋 Expedientes listados:    ${resultados.resumen.totalListados}`);
    console.log(`  🔍 Expedientes consultados: ${resultados.resumen.totalConsultados}`);
    console.log(`  ✅ Exitosos:                ${resultados.resumen.exitosos}`);
    console.log(`  ❌ Fallidos:                ${resultados.resumen.fallidos}`);
    console.log(`  ⏱️  Tiempo total:            ${resultados.resumen.tiempoTotal}s`);
    console.log(`${'═'.repeat(60)}\n`);
}

// ============ EXPORTACIÓN ============
module.exports = {
    procesarNovedadesCompleto,
    cargarConfiguracion
};

// ============ EJECUCIÓN DIRECTA CON REINTENTOS ============
if (require.main === module) {
    const MAX_REINTENTOS_GLOBAL = 10;

    process.on('uncaughtException', error => {
        console.error("❌ Excepción no capturada:", error.message, error.stack);
        // NO llamar process.exit(1) — dejar que el sistema de reintentos maneje la recuperación.
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error("❌ Rechazo de promesa no manejado:", reason);
        // NO llamar process.exit(1) — misma razón.
    });
    process.on('SIGTERM', async () => {
        console.log('🔔 SIGTERM recibido: cerrando navegador...');
        if (_activeBrowser) {
            try { await require('./cerrarNavegador')(_activeBrowser); } catch (_) {}
        }
        process.exit(0);
    });

    async function ejecutarConReintentos(reintento = 0) {
        try {
            console.log(`\n🚀 Iniciando Procurar Expedientes - SCW PJN${reintento > 0 ? ` (reintento ${reintento}/${MAX_REINTENTOS_GLOBAL})` : ''}\n`);

            const config = cargarConfiguracion();
            await procesarNovedadesCompleto(config);

            console.log('✅ Proceso completado exitosamente\n');
            process.exit(0);

        } catch (error) {
            console.error(`\n❌ Error en el proceso: ${error.message}`);

            if (reintento + 1 < MAX_REINTENTOS_GLOBAL) {
                const espera = Math.min(5000 * (reintento + 1), 30000);
                console.log(`\n${'═'.repeat(60)}`);
                console.log(`  🔄 REINTENTO GLOBAL DEL PROCESO`);
                console.log(`${'═'.repeat(60)}`);
                console.log(`  📌 El proceso NO se detuvo. Se reintentará automáticamente.`);
                console.log(`  ⏳ Esperando ${espera / 1000} segundos antes de reintentar...`);
                console.log(`  🔄 Intento ${reintento + 2} de ${MAX_REINTENTOS_GLOBAL}`);
                console.log(`${'═'.repeat(60)}\n`);
                await new Promise(resolve => setTimeout(resolve, espera));
                await ejecutarConReintentos(reintento + 1);
            } else {
                console.error('🚨 Máximo de reintentos alcanzado. Abortando ejecución.');

                if (notifier) {
                    try {
                        notifier.notify({
                            title: 'Procurar Expedientes - Error Fatal',
                            message: `❌ ${error.message}`,
                            sound: true
                        });
                    } catch (notifError) { /* ignorar */ }
                }

                console.log('\n💡 Revise el error y vuelva a intentar.\n');
                process.exit(1);
            }
        }
    }

    ejecutarConReintentos(0);
}