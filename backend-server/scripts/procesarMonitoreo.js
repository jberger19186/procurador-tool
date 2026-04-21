/**
 * procesarMonitoreo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestador del sistema de monitoreo de expedientes por parte.
 * Lee config_monitoreo.json y ejecuta:
 *   - modo 'inicial':   scraping completo → guarda todo como línea base
 *   - modo 'novedades': scraping + comparación → guarda solo los nuevos
 *
 * Config esperada en config_monitoreo.json:
 * {
 *   "modo": "inicial" | "novedades",
 *   "partes": [{ "id": N, "nombre_parte": "...", "jurisdiccion_codigo": "14" }],
 *   "token": "JWT...",
 *   "apiBase": "http://localhost:3000"
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const testM2            = require('./testM2');
const { buscarPorParte } = require('./buscarPorParteScwpjn');
const cerrarNavegador   = require('./cerrarNavegador');
const fs                = require('fs');
const path              = require('path');
const https             = require('https');
const http              = require('http');
const { URL }           = require('url');

// ─── Rutas y entorno ──────────────────────────────────────────────────────────
function getDataPath() {
    if (process.env.APPDATA && process.env.APPDATA.includes('procurador-electron')) {
        return process.env.APPDATA;
    }
    const isPackaged = process.resourcesPath && process.resourcesPath !== __dirname;
    if (!isPackaged) return __dirname;
    return path.join(process.env.APPDATA || process.env.HOME, 'procurador-electron');
}

// ─── Leer config ──────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config_monitoreo.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    process.stderr.write(`❌ ERROR: No se pudo leer config_monitoreo.json: ${e.message}\n`);
    process.exit(1);
}

const { modo, partes, token, apiBase } = config;

if (!modo || !['inicial', 'novedades'].includes(modo)) {
    process.stderr.write(`❌ ERROR: "modo" debe ser "inicial" o "novedades".\n`);
    process.exit(1);
}
if (!Array.isArray(partes) || partes.length === 0) {
    process.stderr.write(`❌ ERROR: No hay partes en config_monitoreo.json.\n`);
    process.exit(1);
}
if (!token || !apiBase) {
    process.stderr.write(`❌ ERROR: Faltan "token" o "apiBase" en config_monitoreo.json.\n`);
    process.exit(1);
}

// ─── Helper: llamada a la API del backend (sin fetch, usa https/http nativo) ──
async function apiCall(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const fullUrl = `${apiBase}${endpoint}`;
        const parsed  = new URL(fullUrl);
        const isHttps = parsed.protocol === 'https:';
        const mod     = isHttps ? https : http;
        const bodyStr = body ? JSON.stringify(body) : null;
        const headers = {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
        };
        if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

        const req = mod.request({
            hostname:           parsed.hostname,
            port:               parsed.port || (isHttps ? 443 : 80),
            path:               parsed.pathname + (parsed.search || ''),
            method,
            headers,
            rejectUnauthorized: false,   // acepta certs auto-firmados del backend local
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (_) { resolve({ raw: data }); }
                } else {
                    reject(new Error(`API ${method} ${endpoint} → ${res.statusCode}: ${data.slice(0, 120)}`));
                }
            });
        });

        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ─── Proceso principal ────────────────────────────────────────────────────────
const profilePath = path.join(process.env.LOCALAPPDATA, 'ProcuradorSCW', 'ChromeProfile');
const loginURL    = 'http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1';

let identificador = '27320694359';
try {
    const cp = JSON.parse(fs.readFileSync(path.join(__dirname, 'config_proceso.json'), 'utf8'));
    if (cp?.general?.identificador) identificador = cp.general.identificador;
} catch (_) {}
process.env.IDENTIFICADOR = identificador;

// ─── Reintentos por parte ─────────────────────────────────────────────────────
// Replica el patrón de reintentarOperacion de testM2.js pero con reset de
// estado del browser entre intentos para máxima resiliencia.
const MAX_REINTENTOS   = 3;    // 1 intento original + 2 reintentos
const DELAY_REINTENTO  = 8000; // ms entre reintentos

async function buscarConReintentos(ctx, parte) {
    // ctx = { browser, page } — objeto mutable; se actualiza in-place al reiniciar el navegador
    let ultimoError = null;
    // Mejor resultado parcial obtenido entre todos los intentos (para no perder datos)
    let mejorParcial = null;

    for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        try {
            if (intento > 1) {
                process.stdout.write(
                    `   🔄 PROGRESS: Reintento ${intento}/${MAX_REINTENTOS} para "${parte.nombre_parte}" — reiniciando navegador...\n`
                );

                // 1. Cerrar el navegador actual de forma segura
                await cerrarNavegador(ctx.browser).catch(() => {});
                await new Promise(r => setTimeout(r, 2000));

                // 2. Lanzar un proceso de Chrome limpio y autenticar
                const nuevo = await testM2.configuracionesGenerales(profilePath);
                ctx.browser = nuevo.browser;
                ctx.page    = nuevo.page;
                await testM2.iniciarSesion(ctx.page, loginURL, identificador);

                // 3. Notificar al proceso padre que el navegador se reinició (ocultado)
                //    para que el toggle del UI quede sincronizado con el estado real.
                if (process.send) {
                    process.send({ type: 'BROWSER_RESTARTED' });
                }
            }

            return await buscarPorParte(ctx.page, parte.jurisdiccion_codigo, parte.nombre_parte);

        } catch (err) {
            ultimoError = err;

            // Preservar datos parciales del intento si son más que los anteriores
            if (err.partialExpedientes && err.partialExpedientes.length > (mejorParcial?.length || 0)) {
                mejorParcial = err.partialExpedientes;
                process.stdout.write(
                    `   💾 PROGRESS: ${mejorParcial.length} expediente(s) parciales guardados del intento ${intento}\n`
                );
            }

            process.stdout.write(
                `   ⚠️ PROGRESS: Intento ${intento}/${MAX_REINTENTOS} fallido para "${parte.nombre_parte}": ${err.message}\n`
            );
            if (intento < MAX_REINTENTOS) {
                await new Promise(r => setTimeout(r, DELAY_REINTENTO));
            }
        }
    }

    // Todos los reintentos agotados
    if (mejorParcial && mejorParcial.length > 0) {
        // Usar el mejor resultado parcial disponible en lugar de fallar completamente
        process.stdout.write(
            `   ⚠️ PROGRESS: Usando ${mejorParcial.length} expediente(s) parciales tras ${MAX_REINTENTOS} intentos (resultado incompleto)\n`
        );
        return mejorParcial;
    }

    throw ultimoError;
}

// ─── Contexto del navegador (módulo-nivel para acceso desde signal handlers) ──
// ctx mutable: buscarConReintentos actualiza browser/page al reiniciar Chrome.
const ctx = { browser: null, page: null };

// ─── Cierre seguro ante señales de terminación ────────────────────────────────
async function shutdownGraceful(motivo) {
    process.stdout.write(`⚠️ PROGRESS: ${motivo} — cerrando navegador...\n`);
    await cerrarNavegador(ctx.browser).catch(() => {});
    process.exit(0);
}
process.on('SIGTERM', () => shutdownGraceful('Proceso detenido por el usuario'));
process.on('SIGINT',  () => shutdownGraceful('Proceso interrumpido (SIGINT)'));

process.stdout.write(`📁 PROGRESS: Monitor ${modo.toUpperCase()} — ${partes.length} parte(s)\n`);

(async () => {
    const tiempoInicio = Date.now();
    const resultados   = [];

    try {
        // ── Iniciar navegador con reintentos ────────────────────────────────────
        process.stdout.write('⚙️ PROGRESS: Iniciando navegador...\n');
        let setupOk = false;
        for (let setupIntento = 1; setupIntento <= MAX_REINTENTOS && !setupOk; setupIntento++) {
            try {
                if (setupIntento > 1) {
                    process.stdout.write(`⚙️ PROGRESS: Reintentando inicio de navegador (${setupIntento}/${MAX_REINTENTOS})...\n`);
                    await cerrarNavegador(ctx.browser).catch(() => {});
                    await new Promise(r => setTimeout(r, 3000));
                }
                ({ browser: ctx.browser, page: ctx.page } = await testM2.configuracionesGenerales(profilePath));
                await testM2.iniciarSesion(ctx.page, loginURL, identificador);
                setupOk = true;
            } catch (setupErr) {
                process.stdout.write(`⚠️ PROGRESS: Error al iniciar navegador (intento ${setupIntento}/${MAX_REINTENTOS}): ${setupErr.message}\n`);
                if (setupIntento === MAX_REINTENTOS) throw setupErr;
                await new Promise(r => setTimeout(r, DELAY_REINTENTO));
            }
        }

        for (let i = 0; i < partes.length; i++) {
            const parte = partes[i];
            const tiempoParteBeg = Date.now();

            process.stdout.write(
                `⚙️ PROGRESS: [${i + 1}/${partes.length}] Procesando: ${parte.jurisdiccion_sigla || ''} · ${parte.nombre_parte}\n`
            );

            let expedientesEncontrados = [];
            let nuevosDetectados       = 0;
            let expedientesVisor       = []; // los que se mostrarán en el visor HTML
            let errorParte             = null;

            try {
                // Scraping por parte (con reintentos y reinicio de navegador)
                expedientesEncontrados = await buscarConReintentos(ctx, parte);

                process.stdout.write(
                    `   ℹ️ PROGRESS: ${expedientesEncontrados.length} expediente(s) encontrado(s)\n`
                );

                if (modo === 'inicial') {
                    // ── Modo inicial: guardar TODOS como línea base ────────────
                    await apiCall('/monitor/expedientes/bulk', 'POST', {
                        parte_id:      parte.id,
                        expedientes:   expedientesEncontrados,
                        es_linea_base: true,
                    });
                    expedientesVisor = expedientesEncontrados;
                    if (expedientesEncontrados.length > 0) {
                        process.stdout.write(`   ✅ PROGRESS: Línea base guardada (${expedientesEncontrados.length} expediente(s))\n`);
                    } else {
                        process.stdout.write(`   ℹ️ PROGRESS: Sin expedientes — línea base vacía registrada\n`);
                    }

                } else {
                    // ── Modo novedades: comparar con línea base ───────────────
                    const baseData = await apiCall(`/monitor/partes/${parte.id}/expedientes`);
                    const baseSet  = new Set(
                        (baseData.expedientes || []).map(e => e.numero_expediente)
                    );

                    const nuevos = expedientesEncontrados.filter(
                        e => e.numero_expediente && !baseSet.has(e.numero_expediente)
                    );
                    nuevosDetectados  = nuevos.length;
                    expedientesVisor  = nuevos;

                    if (nuevos.length > 0) {
                        await apiCall('/monitor/expedientes/bulk', 'POST', {
                            parte_id:      parte.id,
                            expedientes:   nuevos,
                            es_linea_base: false,
                        });
                        process.stdout.write(`   🆕 PROGRESS: ${nuevos.length} novedad(es) detectada(s)\n`);
                    } else {
                        process.stdout.write(`   ✅ PROGRESS: Sin novedades para esta parte\n`);
                    }
                }

            } catch (err) {
                errorParte = err.message;
                process.stdout.write(`   ❌ PROGRESS: Error en parte "${parte.nombre_parte}": ${err.message}\n`);
            }

            // Registrar log de esta ejecución
            const tiempoMs = Date.now() - tiempoParteBeg;
            try {
                await apiCall('/monitor/log', 'POST', {
                    parte_id:             parte.id,
                    modo,
                    total_encontrados:    expedientesEncontrados.length,
                    nuevos_detectados:    nuevosDetectados,
                    tiempo_ejecucion_ms:  tiempoMs,
                    error:                errorParte,
                });
            } catch (_) { /* log no crítico */ }

            resultados.push({
                parte_id:           parte.id,
                nombre_parte:       parte.nombre_parte,
                jurisdiccion_sigla: parte.jurisdiccion_sigla || '',
                total_encontrados:  expedientesEncontrados.length,
                nuevos_detectados:  nuevosDetectados,
                expedientes:        expedientesVisor,
                error:              errorParte,
                ok:                 errorParte === null,
            });

            // Pausa entre partes para no saturar el SCW
            if (i < partes.length - 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }

    } catch (fatalError) {
        process.stderr.write(`❌ ERROR FATAL: ${fatalError.message}\n`);
        await cerrarNavegador(ctx.browser).catch(() => {});
        process.stdout.write(`RESULT:${JSON.stringify({ success: false, error: fatalError.message, resultados })}\n`);
        process.exit(1);
    }

    await cerrarNavegador(ctx.browser).catch(() => {});

    const tiempoTotal  = Date.now() - tiempoInicio;
    const exitosos     = resultados.filter(r => r.ok).length;
    const fallidos     = resultados.filter(r => !r.ok).length;
    const totalNuevos  = resultados.reduce((sum, r) => sum + r.nuevos_detectados, 0);

    process.stdout.write(`✅ PROGRESS: Monitoreo ${modo} completado — ${exitosos}/${partes.length} partes OK, ${totalNuevos} novedad(es) detectada(s)\n`);

    process.stdout.write(`RESULT:${JSON.stringify({
        success:     exitosos > 0 || fallidos === 0,
        modo,
        exitosos,
        fallidos,
        totalNuevos,
        tiempoMs:    tiempoTotal,
        resultados,
    })}\n`);
    process.exit(0);
})();
