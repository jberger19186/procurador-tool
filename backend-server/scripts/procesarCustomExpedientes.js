/**
 * procesarCustomExpedientes.js
 * Consulta expedientes provistos manualmente (desde config_proceso_custom.json).
 * No recorre listas de relacionados: va directo a consulta pública para cada expediente.
 * Soporta filtro opcional por fechaLimite (DD/MM/YYYY).
 */

const testM2 = require('./testM2');
const fs = require('fs');
const path = require('path');
const cerrarNavegador = require('./cerrarNavegador');

// ============ RUTA DE DATOS ============
function getDataPath() {
    if (process.env.APPDATA && process.env.APPDATA.includes('procurador-electron')) {
        console.log('📂 Usando APPDATA de Electron:', process.env.APPDATA);
        return process.env.APPDATA;
    }
    const isPackaged = process.resourcesPath && process.resourcesPath !== __dirname;
    if (!isPackaged) return __dirname;
    const appDataPath = process.env.APPDATA || process.env.HOME;
    return path.join(appDataPath, 'procurador-electron');
}

// ============ MAPA DE JURISDICCIONES ============
const JURISDICCION_MAP = {
    CSJ: '0', CIV: '1', CAF: '2', CCF: '3', CNE: '4',
    CSS: '5', CPE: '6', CNT: '7', CFP: '8', CCC: '9',
    COM: '10', CPF: '11', CPN: '12', FBB: '13', FCR: '14',
    FCB: '15', FCT: '16', FGR: '17', FLP: '18', FMP: '19',
    FMZ: '20', FPO: '21', FPA: '22', FRE: '23', FSA: '24',
    FRO: '25', FSM: '26', FTU: '27'
};

function parseExpedienteStr(str) {
    const match = str.trim().match(/^(\w+)\s+(\d+)\/(\d{4})$/);
    if (!match) return null;
    const jurSigla = match[1].toUpperCase();
    const jurCodigo = JURISDICCION_MAP[jurSigla];
    if (!jurCodigo) return null;
    return { jurisdiccion: jurCodigo, numero: match[2], anio: match[3], expediente: str.trim() };
}

// ============ FILTRO DE FECHA ============
function parseFecha(str) {
    if (!str || str === '-') return null;
    const parts = str.split('/');
    if (parts.length !== 3) return null;
    const d = parseInt(parts[0]), m = parseInt(parts[1]) - 1, y = parseInt(parts[2]);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
    return new Date(y, m, d);
}

function expedientePasaFiltro(movimientos, fechaLimite) {
    if (!fechaLimite) return true;
    const limite = parseFecha(fechaLimite);
    if (!limite) return true;
    let maxFecha = null;
    for (const mov of movimientos) {
        const f = parseFecha(mov.fecha);
        if (f && (!maxFecha || f > maxFecha)) maxFecha = f;
    }
    return maxFecha ? maxFecha >= limite : false;
}

// ============ GENERAR VISOR HTML ============
async function generarVisorConDatos(resultados) {
    const isDev = !process.resourcesPath || process.resourcesPath === __dirname;
    const posiblesRutas = isDev
        ? [path.join(__dirname, 'visorModal_template.html')]
        : [
            path.join(process.resourcesPath, 'visorModal_template.html'),
            path.join(__dirname, 'visorModal_template.html'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'visorModal_template.html')
        ];

    let templatePath = null;
    for (const ruta of posiblesRutas) {
        if (fs.existsSync(ruta)) { templatePath = ruta; break; }
    }

    if (!templatePath) {
        posiblesRutas.forEach(r => console.error(`   - ${r}`));
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
    const dirPath = path.dirname(visorPath);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(visorPath, htmlFinal, 'utf8');
    return visorPath;
}

// ============ LEER CONFIG CUSTOM ============
const configCustomPath = path.join(__dirname, 'config_proceso_custom.json');
let configCustom;
try {
    configCustom = JSON.parse(fs.readFileSync(configCustomPath, 'utf8'));
} catch (e) {
    process.stderr.write(`❌ ERROR: No se pudo leer config_proceso_custom.json: ${e.message}\n`);
    process.exit(1);
}

const { expedientes: expedienteStrings, fechaLimite } = configCustom;

if (!Array.isArray(expedienteStrings) || expedienteStrings.length === 0) {
    process.stderr.write('❌ ERROR: No hay expedientes en config_proceso_custom.json.\n');
    process.exit(1);
}

// Parsear strings a objetos
const expedientesInput = [];
for (const str of expedienteStrings) {
    const parsed = parseExpedienteStr(str);
    if (!parsed) {
        process.stdout.write(`⚠️ PROGRESS: Expediente inválido o jurisdicción desconocida: "${str}" — omitido.\n`);
    } else {
        expedientesInput.push(parsed);
    }
}

if (expedientesInput.length === 0) {
    process.stderr.write('❌ ERROR: Ningún expediente válido para procesar.\n');
    process.exit(1);
}

// ============ LEER IDENTIFICADOR DESDE config_proceso.json ============
let identificador = "27320694359"; // fallback
try {
    const configProceso = JSON.parse(fs.readFileSync(path.join(__dirname, 'config_proceso.json'), 'utf8'));
    if (configProceso?.general?.identificador) {
        identificador = configProceso.general.identificador;
    }
} catch (e) {
    console.warn('⚠️ No se pudo leer config_proceso.json, usando identificador por defecto.');
}
process.env.IDENTIFICADOR = identificador;

const profilePath = path.join(process.env.LOCALAPPDATA, 'ProcuradorSCW', 'ChromeProfile');
const loginURL = "http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1";

process.stdout.write(`📁 PROGRESS: Procurar Custom — ${expedientesInput.length} expediente${expedientesInput.length !== 1 ? 's' : ''}${fechaLimite ? ` — fecha límite: ${fechaLimite}` : ''}\n`);

// Referencia al browser activo accesible por el handler de SIGTERM
let _activeBrowser = null;

process.on('SIGTERM', async () => {
    console.log('🔔 SIGTERM recibido: cerrando navegador...');
    if (_activeBrowser) {
        try { await cerrarNavegador(_activeBrowser); } catch (_) {}
    }
    process.exit(0);
});

// ============ PROCESO PRINCIPAL ============
(async () => {
    let browser = null, page = null;
    try {
        process.stdout.write("⚙️ PROGRESS: Configuraciones Generales...\n");
        ({ browser, page } = await testM2.configuracionesGenerales(profilePath));
        _activeBrowser = browser;

        process.stdout.write("🔑 PROGRESS: Inicio de Sesion...\n");
        await testM2.iniciarSesion(page, loginURL, identificador);
        process.stdout.write("✅ PROGRESS: Sesión iniciada.\n");

        const tiempoInicio = Date.now();
        const resultados = [];
        const maxSoftReintentos = 1;
        const maxHardReintentos = 2;

        for (const exp of expedientesInput) {
            process.stdout.write(`🔎 PROGRESS: Procesando expediente ${exp.expediente}...\n`);

            let procesado = false;
            let softIntentos = 0;
            let resultadoExpediente = null;
            let datosExp = null;

            // --- Soft reintentos ---
            while (!procesado && softIntentos < maxSoftReintentos) {
                try {
                    await testM2.nuevaConsultaPublica(page, exp.jurisdiccion, exp.numero, exp.anio);
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    const htmlContent = await page.content();
                    if (htmlContent.includes("Pantalla de error SSL detectada en el contenido HTML")) {
                        throw new Error("SSL_BLOCK_SCREEN_DETECTED");
                    }

                    process.stdout.write(`📡 PROGRESS: Consulta pública enviada para ${exp.expediente}...\n`);
                    datosExp = await testM2.extraerDatosGenerales(page);
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    resultadoExpediente = await testM2.iterarTablaActuaciones(page, { mode: 'quick5mam' });
                    if (!resultadoExpediente?.movimientos?.length) {
                        throw new Error("No se detectaron movimientos válidos.");
                    }
                    procesado = true;
                } catch (error) {
                    if (error.message === 'SSL_BLOCK_SCREEN_DETECTED') {
                        process.stdout.write(`❌ ERROR: Error SSL en ${exp.expediente}. Pasando a hard reintentos...\n`);
                        break;
                    }
                    softIntentos++;
                    process.stdout.write(`❌ ERROR: Fallo ${exp.expediente} soft attempt ${softIntentos}: ${error.message}\n`);
                    if (softIntentos < maxSoftReintentos) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            }

            // --- Hard reintentos ---
            if (!procesado) {
                let hardIntentos = 0;
                while (!procesado && hardIntentos < maxHardReintentos) {
                    try {
                        process.stdout.write(`🔄 PROGRESS: Reiniciando navegador para ${exp.expediente} (hard ${hardIntentos + 1})...\n`);

                        if (browser) {
                            await cerrarNavegador(browser);
                            browser = null;
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }

                        const conf = await testM2.configuracionesGenerales(profilePath);
                        browser = conf.browser;
                        page = conf.page;

                        let loginOk = false, loginTries = 0;
                        while (!loginOk && loginTries < 2) {
                            try {
                                await page.goto(loginURL, { waitUntil: 'networkidle2', timeout: 60000 });
                                await testM2.iniciarSesion(page, loginURL, identificador);
                                loginOk = true;
                            } catch (e) {
                                loginTries++;
                                if (loginTries >= 2) throw new Error(`Login falló tras 2 intentos: ${e.message}`);
                                await new Promise(resolve => setTimeout(resolve, 5000));
                            }
                        }

                        await testM2.nuevaConsultaPublica(page, exp.jurisdiccion, exp.numero, exp.anio);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        datosExp = await testM2.extraerDatosGenerales(page);
                        await new Promise(resolve => setTimeout(resolve, 5000));

                        resultadoExpediente = await testM2.iterarTablaActuaciones(page, { mode: 'quick5mam' });
                        if (!resultadoExpediente?.movimientos?.length) {
                            throw new Error("No se detectaron movimientos válidos.");
                        }
                        procesado = true;
                    } catch (error) {
                        if (error.message === 'SSL_BLOCK_SCREEN_DETECTED') {
                            process.stdout.write(`❌ ERROR: Error SSL en hard attempt de ${exp.expediente}. Abortando.\n`);
                            if (browser) { await cerrarNavegador(browser); browser = null; }
                            break;
                        }
                        hardIntentos++;
                        process.stdout.write(`❌ ERROR: Hard attempt ${hardIntentos} para ${exp.expediente}: ${error.message}\n`);
                        if (hardIntentos < maxHardReintentos) {
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        } else {
                            if (browser) { await cerrarNavegador(browser); browser = null; }
                        }
                    }
                }
            }

            // --- Fallback o resultado ---
            if (!procesado) {
                process.stdout.write(`❌ ERROR: No se pudo procesar ${exp.expediente} tras todos los reintentos.\n`);
                resultados.push({
                    expediente: datosExp?.expediente || exp.expediente,
                    caratula: datosExp?.caratula || '-',
                    dependencia: datosExp?.dependencia || '-',
                    situacion: datosExp?.situacion_actual || '-',
                    ultimaAct: '-',
                    estado: 'fallido',
                    error: `Error persistente al procesar ${exp.expediente} tras múltiples reintentos.`,
                    movimientos: []
                });
            } else if (resultadoExpediente) {
                const movimientos = (Array.isArray(resultadoExpediente.movimientos)
                    ? resultadoExpediente.movimientos
                    : [resultadoExpediente.movimientos])
                    .map(mov => ({
                        ...mov,
                        tipo: mov.tipo || mov.organismo || '-'
                    }));

                resultados.push({
                    expediente: datosExp?.expediente || exp.expediente,
                    caratula: datosExp?.caratula || '-',
                    dependencia: datosExp?.dependencia || '-',
                    situacion: datosExp?.situacion_actual || '-',
                    ultimaAct: movimientos.length > 0 ? movimientos[0].fecha : '-',
                    estado: 'exitoso',
                    movimientos
                });
            }
        }

        if (browser) { await cerrarNavegador(browser); browser = null; }

        // ============ APLICAR FILTRO DE FECHA ============
        let resultadosFiltrados = resultados;
        if (fechaLimite) {
            const antes = resultados.length;
            resultadosFiltrados = resultados.filter(r => expedientePasaFiltro(r.movimientos, fechaLimite));
            process.stdout.write(`📅 PROGRESS: Filtro fecha ${fechaLimite} — ${resultadosFiltrados.length} de ${antes} expedientes pasan el filtro.\n`);
        }

        // ============ ARMAR ESTRUCTURA PARA EL VISOR ============
        const tiempoTotal = Math.round((Date.now() - tiempoInicio) / 1000);
        const exitosos = resultadosFiltrados.filter(r => r.estado === 'exitoso').length;
        const fallidos = resultadosFiltrados.filter(r => r.estado === 'fallido').length;

        const datosVisor = {
            fechaEjecucion: new Date().toISOString(),
            fechaLimite: fechaLimite || 'Sin filtro',
            identificador,
            configuracion: { maxMovimientos: 0, buscarEnTodos: true, incluirHistoricos: false },
            expedientes: resultadosFiltrados,
            resumen: {
                totalListados: expedientesInput.length,
                totalConsultados: resultadosFiltrados.length,
                exitosos,
                fallidos,
                tiempoListado: 0,
                tiempoConsulta: tiempoTotal,
                tiempoTotal
            }
        };

        // ============ GENERAR VISOR ============
        if (resultadosFiltrados.length > 0) {
            process.stdout.write("🌐 PROGRESS: Generando visor HTML...\n");
            await generarVisorConDatos(datosVisor);
            process.stdout.write("✅ PROGRESS: Visor generado.\n");
        } else {
            process.stdout.write("⚠️ PROGRESS: Ningún expediente pasó el filtro de fecha. No se generó visor.\n");
        }

        process.stdout.write("RESULT:" + JSON.stringify(datosVisor) + "\n");
        process.exit(0);

    } catch (error) {
        console.error(`❌ ERROR en procesarCustomExpedientes.js: ${error.message}`);
        process.stdout.write("ERROR:" + error.message + "\n");
        if (browser) { try { await cerrarNavegador(browser); } catch (_) {} }
        process.exit(1);
    } finally {
        if (browser) { try { await cerrarNavegador(browser); } catch (_) {} }
    }
})();
