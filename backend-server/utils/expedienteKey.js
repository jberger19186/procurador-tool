// expedienteKey.js
/**
 * Normalización canónica del identificador de expediente — Bitácora (F1.1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ PROBLEMA RESUELVE
 * ═══════════════════════════════════════════════════════════════════════════
 * El mismo expediente llega escrito de dos formas según el camino de entrada:
 *
 *   · Capturado desde un visor  → como lo devuelve el PJN, CON padding de ceros:
 *                                 "FCR 018745/2017"
 *   · Cargado a mano por el usuario → normalmente SIN padding:
 *                                 "FCR 18745/2017"
 *
 * Son el MISMO expediente — el cero a la izquierda es formato de presentación
 * del PJN, no parte del identificador. Sin normalizar, la constraint
 * UNIQUE (user_id, expediente_key) no deduplica y el usuario termina con DOS
 * fichas del mismo caso, con el historial partido entre las dos.
 *
 * No es hipotético: es el mismo bug que rompió el enlace de los PDFs de informe
 * en producción (commit debb503, 2026-07-30).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ ESTE ARCHIVO ES LA VERSIÓN CANÓNICA
 * ═══════════════════════════════════════════════════════════════════════════
 * La lógica nació en electron-app/informe/buscarPdfExpediente.js (donde se usa
 * para otro fin: localizar el PDF de un expediente en la carpeta de descargas).
 * El backend la necesita también, porque es quien ESCRIBE las fichas — y por lo
 * tanto quien define qué cuenta como "el mismo expediente".
 *
 * El proyecto no es un monorepo (backend-server/ y electron-app/ tienen sus
 * propios package.json y node_modules), así que la función vive duplicada a
 * propósito, con esta división:
 *
 *   · CANÓNICA:  backend-server/utils/expedienteKey.js   ← este archivo
 *   · COPIA:     electron-app/informe/buscarPdfExpediente.js  (tokenizar)
 *
 * ⚠️ SI TOCÁS LA LÓGICA DE NORMALIZACIÓN, TOCÁ LAS DOS.
 * La red de contención contra la deriva es el fixture compartido
 * `tests/fixtures/expediente-key-cases.json`, que los tests de AMBOS lados
 * ejercitan. Si las implementaciones divergen, esos tests fallan.
 *
 * Por qué importa que no deriven: si el backend y la app normalizan distinto,
 * la app diría "este caso ya está en tu Bitácora" y el backend crearía una
 * ficha nueva (o al revés) — un error silencioso y molesto de diagnosticar.
 *
 * (Se descartó un paquete npm local vía `file:../shared`: agregaría complejidad
 * de packaging a una app que se empaqueta con electron-builder (asar +
 * extraResources) para compartir una función de 8 líneas sin dependencias.)
 */

/**
 * Descompone un identificador de expediente en sus componentes normalizados.
 *
 * Los componentes puramente numéricos pierden los ceros a la izquierda; el
 * resto (la sigla de jurisdicción) sólo baja a minúsculas.
 *
 *   "FCR 018745/2017"  →  ['fcr', '18745', '2017']
 *
 * Nota sobre la sigla: el primer token ES la jurisdicción, ya normalizada. Por
 * eso `jurisdiccion` NO forma parte de la clave única de expedientes_seguidos
 * (sería redundante, y al llegar como texto libre —"Justicia Federal de
 * Comodoro Rivadavia" desde el PJN vs. "FCR" tipeado— rompería la deduplicación).
 *
 * @param {string} texto - Identificador tal como lo escribió el usuario o el PJN
 * @returns {string[]} Componentes normalizados (array vacío si no hay ninguno)
 */
function tokenizar(texto) {
    // `String(texto ?? '')` es el único punto donde esta implementación difiere
    // de la de Electron: acá la entrada llega por HTTP y puede ser null/undefined,
    // así que se degrada a '' en vez de lanzar. Para cualquier entrada de tipo
    // string el comportamiento es idéntico — que es lo que el fixture verifica.
    return String(texto ?? '')
        .toLowerCase()
        .replace(/[\/:"*?<>|_]/g, ' ')
        .split(/\s+/)
        .filter(p => p.length > 0)
        // `|| '0'` evita que un token que sea todo ceros quede vacío.
        .map(p => /^\d+$/.test(p) ? (p.replace(/^0+/, '') || '0') : p);
}

/**
 * Clave de deduplicación que se persiste en expedientes_seguidos.expediente_key.
 *
 *   "FCR 018745/2017"  →  "fcr|18745|2017"
 *   "fcr 18745/2017"   →  "fcr|18745|2017"   (mismo caso, distinta escritura)
 *
 * El separador `|` no puede aparecer en un token porque `tokenizar` lo convierte
 * en espacio, así que no hay ambigüedad al unir.
 *
 * @param {string} expediente
 * @returns {string} Clave normalizada. Cadena vacía si la entrada no tiene
 *                   ningún componente aprovechable — el llamador DEBE rechazar
 *                   ese caso antes de insertar (la columna es NOT NULL y una
 *                   clave vacía colisionaría entre expedientes distintos).
 */
function expedienteKey(expediente) {
    return tokenizar(expediente).join('|');
}

/**
 * ¿La entrada produce una clave utilizable? Azúcar para validar en los endpoints
 * antes de tocar la base.
 *
 * @param {string} expediente
 * @returns {boolean}
 */
function esExpedienteValido(expediente) {
    return expedienteKey(expediente).length > 0;
}

module.exports = { tokenizar, expedienteKey, esExpedienteValido };
