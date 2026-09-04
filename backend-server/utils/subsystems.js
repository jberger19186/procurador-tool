/**
 * subsystems.js — mapa único script → subsistema de cupo (B.8, fase E7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta E7 el subsistema contra el que se descontaba cupo lo elegía el CLIENTE:
 * llegaba en `req.body.subsystem` de `log-execution`. Un cliente modificado
 * podía informar el subsistema más barato, o ninguno. Acá el servidor lo
 * resuelve solo, a partir del nombre del script, y el cuerpo del request deja
 * de tener voz en el asunto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ ESTE MAPA REPRODUCE EXACTAMENTE getSubsystemForScript() DEL CLIENTE
 * ═══════════════════════════════════════════════════════════════════════════
 * `electron-app/src/auth/authManager.js:27-42`. Se copió verificando script por
 * script contra la whitelist `SCRIPTS_DISTRIBUIBLES` de `routes/client.js:24`,
 * para que mover la decisión al servidor NO cambie qué contador sube en ningún
 * flujo real. Dos coincidencias que parecen errores y no lo son:
 *
 *   · `listarSCWPJN.js` → null. El cliente pretende mapearlo a 'proc', pero su
 *     condición tiene una errata (`'listarsscwpjn'`, con doble s) que nunca
 *     matchea, así que hoy ese flujo solo suma al contador global. Mapearlo a
 *     'proc' acá empezaría a cobrarle cupo de procuración a "Listado de
 *     expedientes", que hoy es gratis: es un cambio de producto, no parte de
 *     B.8. Se preserva el comportamiento vigente.
 *
 *   · `procesarMonitoreo.js` → null. El monitoreo NO se cuenta por este camino:
 *     lo cuenta `POST /monitor/log`, que llama el propio script una vez por
 *     parte consultada. Ver la nota de `routes/monitor.js`.
 *
 * Si alguna vez se corrige la errata del cliente, hay que decidir acá primero.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ EL CAMPO DEL REQUEST ES `scriptName`, EN camelCase
 * ═══════════════════════════════════════════════════════════════════════════
 * `script_name` en snake_case es la COLUMNA de `active_executions` y de
 * `usage_logs`, no el campo del cuerpo. Verificado el 2026-09-04:
 *   routes/license.js:18  → const { machineId, scriptName } = req.body
 *   routes/client.js:326  → const { scriptName, ... } = req.body
 *   electron-app/src/api/backendClient.js:351 → { machineId, scriptName }
 * Leer `req.body.script_name` devuelve undefined, el mapa no resuelve y TODA
 * ejecución del producto pasa a fallar con 400. No es una pantalla rota: es la
 * aplicación entera, para todos los clientes.
 */

// Claves = nombre EXACTO del archivo tal como lo manda el cliente y como figura
// en SCRIPTS_DISTRIBUIBLES. Valor = subsistema de cupo, o null si el script no
// consume cupo por subsistema (solo el contador global `usage_count`).
//
// Estar en este mapa es lo que autoriza a pedir un permiso de ejecución: un
// nombre que no figure acá se rechaza con 400 en `execution/start`. Por eso el
// mapa cubre los 13 scripts distribuibles, no solo los 3 que hoy piden permiso
// — así el release de cliente de E8, que hará pasar informe y monitoreo por
// `start`, no necesita tocar el servidor.
const SCRIPT_SUBSYSTEM = Object.freeze({
    // Puntos de entrada que HOY piden permiso en execution/start
    'procesarNovedadesCompleto.js': 'proc',
    'procesarCustomExpedientes.js': 'batch',
    'listarSCWPJN.js':              null,   // ver nota de la errata, arriba

    // Puntos de entrada que todavía NO piden permiso (lo harán en E8)
    'informequickscwpjn.js':        'informe',
    'procesarMonitoreo.js':         null,   // lo cuenta POST /monitor/log

    // Resto de la whitelist: librerías y utilidades, sin cupo propio
    'testM1.js':                    'proc',
    'testM2.js':                    null,
    'consultarscwpjn.js':           'proc',
    'sessionManager.js':            null,
    'errorHandler.js':              null,
    'cerrarNavegador.js':           null,
    'monitoreo.js':                 null,
    'buscarPorParteScwpjn.js':      null,
});

// Columna de `subscriptions` que cuenta cada subsistema.
const USAGE_COLUMN = Object.freeze({
    'proc':              'proc_usage',
    'batch':             'batch_usage',
    'informe':           'informe_usage',
    'monitor_novedades': 'monitor_novedades_usage',
});

const VALID_SUBSYSTEMS = Object.freeze(Object.keys(USAGE_COLUMN));

/** ¿El servidor conoce este script? Solo los conocidos pueden pedir permiso. */
function isKnownScript(scriptName) {
    return typeof scriptName === 'string'
        && Object.prototype.hasOwnProperty.call(SCRIPT_SUBSYSTEM, scriptName);
}

/**
 * Subsistema de un script, decidido por el servidor.
 * @returns {string|null} subsistema, o null si no consume cupo por subsistema.
 *                        Para un script desconocido también devuelve null: el
 *                        rechazo lo hace `isKnownScript()`, no esta función.
 */
function subsystemForScript(scriptName) {
    return isKnownScript(scriptName) ? SCRIPT_SUBSYSTEM[scriptName] : null;
}

/** Columna de `subscriptions` para un subsistema, o null si no aplica. */
function usageColumnFor(subsystem) {
    return (subsystem && USAGE_COLUMN[subsystem]) || null;
}

/** Texto que ve el usuario cuando se le agotó ese subsistema. */
function subsystemLabel(subsystem) {
    return {
        'proc':              'procuraciones',
        'batch':             'ejecuciones de batch',
        'informe':           'informes',
        'monitor_novedades': 'consultas de monitoreo',
    }[subsystem] || 'ejecuciones';
}

module.exports = {
    SCRIPT_SUBSYSTEM,
    USAGE_COLUMN,
    VALID_SUBSYSTEMS,
    isKnownScript,
    subsystemForScript,
    usageColumnFor,
    subsystemLabel,
};
