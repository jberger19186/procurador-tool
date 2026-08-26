// motivoInformeSinPDF.js
/**
 * informequickscwpjn.js termina con código de salida 0 en varios caminos que NO
 * generan ningún PDF: expediente inexistente en el PJN, o navegador cerrado por
 * el usuario antes de completar. El script ya distingue esos casos y emite un
 * payload `RESULT: {...}`.
 *
 * Vive en su propio módulo porque lo necesitan dos consumidores distintos:
 * main.js (para que el visor/Excel no reporten "Exitoso" sin PDF) y
 * authManager.js (para que ese caso no consuma cupo de informe_usage). Duplicar
 * el parseo entre los dos es exactamente el patrón que rompió la búsqueda de
 * PDF en v2.7.33 — un solo lugar, dos consumidores.
 *
 * Se apoya en los campos estructurados del payload, no en el texto del mensaje.
 * Si no hay payload legible no se asume nada (devuelve null) — ante la duda, se
 * respeta el código de salida del proceso.
 *
 * @param {string} output - stdout completo de la ejecución
 * @returns {string|null} Motivo legible si terminó sin informe, o null si fue OK
 */
/** Extrae y parsea el último `RESULT: {...}` del stdout. `null` si no hay ninguno o no es JSON legible. */
function ultimoResultado(output) {
    const lineas = String(output || '')
        .split('\n')
        .filter(l => l.trim().startsWith('RESULT:'));
    if (lineas.length === 0) return null;
    try {
        // El último RESULT es el desenlace: cada uno va seguido de un exit inmediato,
        // pero si en el futuro se emitiera más de uno, el que vale es el final.
        return JSON.parse(lineas[lineas.length - 1].trim().substring(7));
    } catch (_) {
        return null;
    }
}

function motivoInformeSinPDF(output) {
    const payload = ultimoResultado(output);
    if (payload?.codigo === 'EXPEDIENTE_INEXISTENTE') {
        return payload.mensaje || 'Expediente inexistente o no disponible para su consulta pública';
    }
    if (payload?.navegador_cerrado === true) {
        return 'Proceso interrumpido: se cerró el navegador antes de generar el informe';
    }
    return null;
}

/**
 * B4 (puntos 19/20 del plan de arreglos de Bitácora): la carátula que el script ya
 * scrapea para el PDF, ahora también en el payload de éxito — ver el comentario en
 * informequickscwpjn.js. `null` ante cualquier resultado que no sea el de éxito (un
 * expediente inexistente, un navegador cerrado, etc. no tienen carátula que ofrecer).
 * @param {string} output - stdout completo de la ejecución
 * @returns {string|null}
 */
function caratulaInformeExitoso(output) {
    const payload = ultimoResultado(output);
    return (payload && typeof payload.caratula === 'string' && payload.caratula) || null;
}

module.exports = { motivoInformeSinPDF, caratulaInformeExitoso };
