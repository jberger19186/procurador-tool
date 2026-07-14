// SEC-2·B.2 — Verificación diaria real contra el PJN (procuración + informe).
//
// Módulo OCULTO deliberadamente: no tiene UI (ni panel de configuración ni botón visible).
// Está pensado para correr solo en la PC del operador, logueado con la cuenta de prueba
// dedicada (CUIT 27320694359) — no es una feature para usuarios reales. Se activa/edita
// a mano tocando el archivo de config en userData (ver getConfigPath()).
//
// Reusa exactamente los mismos flujos que un usuario real dispara desde la UI
// (runProcessLogic / runInformeLogic en main.js) — no hay un camino de ejecución paralelo.
// No maneja credenciales: corre bajo la sesión ya autenticada de la app (authManager),
// igual que cualquier ejecución manual. Solo reporta al backend estado/tiempos, nunca
// contenido de expedientes ni credenciales.

const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

const CONFIG_FILENAME = 'verificacion_config.json';

const DEFAULTS = {
    habilitado: false,
    modo: 'encendido',          // 'encendido' | 'horario' | 'manual'
    horaUmbral: '09:00',
    correrProcuracion: true,
    correrInforme: true,
    informeExpediente: 'FCR 018745/2017',
    requerirConfirmacion: true,
    ultimaEjecucion: null        // { fecha:'YYYY-MM-DD', hora:ISO, estado:'ok'|'parcial'|'error', detalle:{...} }
};

const HORARIO_CHECK_MS = 10 * 60 * 1000; // 10 min — barato, evita instalar un cron real

let deps = null;           // { getMainWindow, authManager, runProcessLogic, runInformeLogic }
let horarioInterval = null;

function getConfigPath() {
    return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

function readConfig() {
    try {
        const raw = fs.readFileSync(getConfigPath(), 'utf8');
        return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) {
        return { ...DEFAULTS };
    }
}

function writeConfig(config) {
    try {
        fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error('[verification] No se pudo guardar la config:', e.message);
    }
}

// Crea el archivo con los defaults si todavía no existe, para que el operador lo
// encuentre y lo edite a mano (habilitado:false por defecto — no corre solo).
function ensureConfigFile() {
    if (!fs.existsSync(getConfigPath())) {
        writeConfig(DEFAULTS);
    }
}

function todayStr() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function hoyDDMMYYYY() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// El botón real "Procurar hoy" de la sidebar autocompleta la fecha límite con la de
// hoy si el campo está vacío (renderer.js, acción 'procurar-hoy') antes de invocar
// run-process-custom-date. runProcessLogic (de donde viene este módulo) es el handler
// 'run-process' PLANO — hoy inalcanzable desde ningún botón real de la UI actual — que
// NO tiene ese guard: confía ciegamente en lo que haya persistido en config_proceso.json.
// Como este módulo invoca runProcessLogic directo (sin pasar por la UI), replica acá el
// mismo guard para no heredar un config_proceso.json con fechaLimite vacía/stale.
function ensureFechaLimite() {
    const configPath = path.join(app.getPath('userData'), 'config_proceso.json');
    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(raw);
        if (!config.general) config.general = {};
        if (!config.general.fechaLimite || !String(config.general.fechaLimite).trim()) {
            config.general.fechaLimite = hoyDDMMYYYY();
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        }
    } catch (e) {
        console.error('[verification] No se pudo verificar/reparar fechaLimite:', e.message);
    }
}

function isDueNow(config) {
    if (!config.habilitado) return false;
    if (config.modo === 'manual') return false;
    if (config.ultimaEjecucion?.fecha === todayStr()) return false; // ya corrió hoy

    if (config.modo === 'horario' || config.modo === 'encendido') {
        const [h, m] = String(config.horaUmbral || '09:00').split(':').map(Number);
        const umbral = new Date();
        umbral.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
        return new Date() >= umbral;
    }
    return false;
}

function init({ getMainWindow, authManager, runProcessLogic, runInformeLogic }) {
    deps = { getMainWindow, authManager, runProcessLogic, runInformeLogic };
    ensureConfigFile();
}

// Se invoca una vez tras cada login exitoso (cubre el modo 'encendido').
function checkAndMaybeRun() {
    const config = readConfig();
    if (!isDueNow(config)) return;
    runVerification(config, {}).catch(e => console.error('[verification] Error inesperado:', e.message));
}

// Chequeo periódico liviano para el modo 'horario' (por si la app queda abierta
// todo el día y la hora umbral llega después del login).
function startHorarioWatcher() {
    if (horarioInterval) return;
    horarioInterval = setInterval(checkAndMaybeRun, HORARIO_CHECK_MS);
}

async function runVerification(config, { manual = false } = {}) {
    if (!deps) return { success: false, error: 'Módulo no inicializado' };
    const { getMainWindow, authManager, runProcessLogic, runInformeLogic } = deps;

    if (!authManager.isAuthenticated()) {
        console.log('[verification] Omitida: no hay sesión activa');
        return { success: false, error: 'no autenticado' };
    }

    if (config.requerirConfirmacion && !manual) {
        const win = getMainWindow();
        const choice = await dialog.showMessageBox(win || undefined, {
            type: 'question',
            buttons: ['Ejecutar ahora', 'Posponer'],
            defaultId: 0,
            cancelId: 1,
            title: 'Verificación diaria (PJN real)',
            message: 'Se va a ejecutar la verificación diaria (procuración + informe de prueba contra el PJN real).\n\n¿Ejecutar ahora?'
        });
        if (choice.response !== 0) {
            console.log('[verification] Pospuesta por el operador');
            return { success: false, error: 'pospuesta' };
        }
    }

    const startedAt = Date.now();
    const detalle = { procuracion: null, informe: null };
    let estado = 'ok';

    if (config.correrProcuracion) {
        const t0 = Date.now();
        try {
            ensureFechaLimite();
            const r = await runProcessLogic({});
            detalle.procuracion = { ok: !!r.success, tiempoMs: Date.now() - t0, error: r.success ? null : (r.error || 'error desconocido') };
        } catch (e) {
            detalle.procuracion = { ok: false, tiempoMs: Date.now() - t0, error: e.message };
        }
        if (!detalle.procuracion.ok) estado = 'error';
    }

    if (config.correrInforme && config.informeExpediente) {
        const t0 = Date.now();
        try {
            const r = await runInformeLogic({ expediente: config.informeExpediente, configInforme: {} });
            detalle.informe = { ok: !!r.success, tiempoMs: Date.now() - t0, error: r.success ? null : (r.error || 'error desconocido') };
        } catch (e) {
            detalle.informe = { ok: false, tiempoMs: Date.now() - t0, error: e.message };
        }
        if (!detalle.informe.ok) {
            estado = (detalle.procuracion && !detalle.procuracion.ok) ? 'error' : (estado === 'ok' ? 'parcial' : estado);
        }
    }

    // Contención: si lo único que falló fue el lock global ("Ya hay un proceso en
    // ejecución"), no es una ruptura real del PJN/script — un usuario real estaba
    // usando la app. No consumir el día: se reintenta en el próximo chequeo.
    const attempted = [detalle.procuracion, detalle.informe].filter(Boolean);
    const soloContencion = attempted.length > 0 &&
        attempted.every(d => !d.ok && d.error === 'Ya hay un proceso en ejecución');
    if (soloContencion) {
        console.log('[verification] Omitida: la app ya estaba ejecutando otro proceso (se reintenta más tarde)');
        return { success: false, error: 'contención' };
    }

    const nowIso = new Date().toISOString();
    config.ultimaEjecucion = { fecha: todayStr(), hora: nowIso, estado, detalle };
    writeConfig(config); // guardar local primero: no se pierde el resultado si el POST falla

    try {
        await authManager.backendClient.reportVerification({
            timestamp: nowIso,
            estado,
            tiempoTotalMs: Date.now() - startedAt,
            procuracion: detalle.procuracion,
            informe: detalle.informe
        });
    } catch (e) {
        console.error('[verification] No se pudo reportar al backend:', e.message);
    }

    console.log(`[verification] Verificación diaria completada: ${estado}`);
    return { success: true, estado, detalle };
}

module.exports = {
    init,
    checkAndMaybeRun,
    startHorarioWatcher,
    // Disparo manual (sin UI): invocable vía IPC 'run-verification-now' desde DevTools,
    // o llamando directamente a este módulo. Salta la confirmación (manual:true).
    runNow: () => runVerification(readConfig(), { manual: true })
};
