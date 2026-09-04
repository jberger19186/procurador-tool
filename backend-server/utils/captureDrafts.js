/**
 * captureDrafts.js — almacén efímero de borradores de captura (F2.2).
 *
 * Sostiene el patrón Post/Redirect/Get del deep-link desde los visores (§4.1.1
 * del plan de Bitácora):
 *   1. El visor (archivo local, SIN sesión) hace POST a /usuarios/capture.
 *   2. Ese POST guarda el payload ACÁ y responde 303 al portal con un id opaco.
 *   3. La SPA —ya autenticada— reclama el borrador con ese id y abre el modal.
 *
 * ⚠️ El payload que entra acá es ANÓNIMO y NO CONFIABLE: llega sin token (un
 * <form> HTML no puede mandar el header Authorization, y por diseño no se
 * embebe ninguna credencial en el visor, que es un archivo compartible). Por eso
 * esto es un BUFFER, no una escritura: nada toca las tablas reales hasta que un
 * usuario autenticado confirma desde el portal.
 *
 * Las 3 protecciones que hacen que un endpoint anónimo no sea un agujero:
 *   · id de 32 bytes aleatorios (crypto.randomBytes) — no adivinable, mismo
 *     patrón que los tokens de verificación de email de auth.js.
 *   · TTL corto (10 min) + USO ÚNICO: reclamar un borrador lo borra.
 *   · Tope de borradores simultáneos Y de bytes retenidos (H-BE-02) — sin ellos,
 *     esto sería un sumidero de memoria alimentable desde internet (el rate-limit
 *     acota la frecuencia, no el volumen).
 *
 * ⚠️ VIVE EN MEMORIA DEL PROCESO — igual que la blacklist de tokens, y con la
 * misma condición: `ecosystem.config.js` corre `procurador-api` con
 * **instances: 1**, y ahí ya hay una advertencia escrita de NO escalarlo sin
 * resolver antes el estado en memoria. Este módulo suma un segundo motivo: con
 * varias instancias, el POST podría aterrizar en una y el reclamo en otra → el
 * borrador "no existe" y la captura se pierde en silencio.
 */

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;   // 10 minutos
const MAX_DRAFTS = 100;          // tope de borradores vivos simultáneos

// H-BE-02 (auditoría 2026-09) — topes de BYTES, no solo de cantidad.
// El tope de 100 borradores no acota la memoria: con el parser de captura
// aceptando cuerpos grandes, 100 borradores al tope daban cientos de MB
// retenidos, y `ecosystem.config.js` reinicia el proceso en `max_memory_restart:
// 400M`. O sea: un endpoint anónimo podía reiniciar la API. Ahora hay dos cotas:
//   · MAX_DRAFT_BYTES — por borrador. Un lote real (200 casos × 15 movimientos)
//     mide menos de 200 KB, así que 256 KB deja margen y rechaza lo patológico.
//   · MAX_TOTAL_BYTES — presupuesto global de todo lo retenido. Al superarlo se
//     desaloja el más viejo hasta que entre, igual que con MAX_DRAFTS.
// El techo real de memoria de este módulo pasa a ser MAX_TOTAL_BYTES + overhead.
const MAX_DRAFT_BYTES = 256 * 1024;        // 256 KB por borrador
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;  // 16 MB retenidos entre todos

// B.5 (fase E11): además del payload, cada borrador guarda a QUIÉN pertenece.
// `user_id` sale de la llave de captura que el visor manda en el POST (nunca de
// un campo del formulario, que es entrada no confiable). `jti` es el
// identificador de esa llave, guardado para trazabilidad. Los dos van FUERA de
// `payload` a propósito: `payload` es lo único que se le devuelve al portal, y
// no tiene por qué llevar metadatos del control de acceso.
// Un borrador sin `user_id` (visor viejo, anterior al release de esta fase, o
// llave vencida/gastada) mantiene el comportamiento previo — ver la compatibilidad
// documentada en routes/capture.js.
const drafts = new Map();        // id → { payload, bytes, expiresAt, user_id, jti }
let totalBytes = 0;              // suma de `bytes` de los vivos (invariante del Map)

/** Baja del presupuesto y borra. Único punto que toca `totalBytes` al eliminar. */
function borrar(id) {
    const d = drafts.get(id);
    if (!d) return;
    totalBytes -= d.bytes;
    drafts.delete(id);
}

/** Descarta los vencidos. Se llama en cada operación y también por timer (ver abajo). */
function purgarVencidos() {
    const ahora = Date.now();
    for (const [id, d] of drafts.entries()) {
        if (d.expiresAt <= ahora) borrar(id);
    }
}

/** Desaloja el más viejo por vencimiento (FIFO). Devuelve false si no quedaba ninguno. */
function desalojarMasViejo() {
    let masViejo = null;
    for (const [id, d] of drafts.entries()) {
        if (!masViejo || d.expiresAt < masViejo[1].expiresAt) masViejo = [id, d];
    }
    if (!masViejo) return false;
    borrar(masViejo[0]);
    return true;
}

// H-BE-02 — purga por timer, además de la purga oportunista de cada operación.
// Sin esto, un pico de borradores sube la memoria y ahí se queda hasta la próxima
// captura: si nadie vuelve a capturar, nada libera. `unref()` es lo que impide que
// este intervalo mantenga vivo el proceso (la razón por la que el diseño original
// no tenía timer).
const purgaTimer = setInterval(purgarVencidos, 60 * 1000);
if (typeof purgaTimer.unref === 'function') purgaTimer.unref();

/**
 * Guarda un borrador y devuelve su id opaco.
 * Si se llegó a algún tope (cantidad o bytes), descarta los más viejos (FIFO por
 * vencimiento) — preferible a rechazar la captura del usuario legítimo que llega último.
 * Si el borrador por sí solo excede MAX_DRAFT_BYTES, lanza `DRAFT_TOO_LARGE`: no se
 * desaloja a nadie ni se retiene nada (el llamador responde `captura=lote_grande`).
 */
function crearDraft(payload, meta = {}) {
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (bytes > MAX_DRAFT_BYTES) {
        const err = new Error('Borrador de captura demasiado grande');
        err.code = 'DRAFT_TOO_LARGE';
        err.bytes = bytes;
        err.max = MAX_DRAFT_BYTES;
        throw err;   // NADA queda en memoria: el rechazo es antes del `set`.
    }

    purgarVencidos();
    while ((drafts.size >= MAX_DRAFTS || totalBytes + bytes > MAX_TOTAL_BYTES) && desalojarMasViejo()) {
        // desalojarMasViejo() devuelve false con el Map vacío, así que el bucle
        // siempre termina: un borrador de <= MAX_DRAFT_BYTES entra en MAX_TOTAL_BYTES.
    }

    const id = crypto.randomBytes(32).toString('hex');
    drafts.set(id, {
        payload,
        bytes,
        expiresAt: Date.now() + TTL_MS,
        // Normalizados acá para que el resto del sistema no tenga que distinguir
        // entre "no vino" y "vino vacío": o hay un entero, o es null.
        user_id: Number.isInteger(meta.user_id) ? meta.user_id : null,
        jti: typeof meta.jti === 'string' && meta.jti ? meta.jti : null,
    });
    totalBytes += bytes;
    return id;
}

/**
 * B.5 — mira el dueño de un borrador SIN consumirlo.
 *
 * Es un `peek` deliberado, no un `reclamar`: el chequeo de pertenencia tiene que
 * ocurrir ANTES de borrar. Si se resolviera con `reclamarDraft` y después se
 * comparara el dueño, cualquiera que adivinara (o robara del `Location` de su
 * propio POST) el id de un borrador ajeno podría DESTRUIRLO con un 403 — un 403
 * que además destruye el recurso no es un control, es una negación de servicio.
 *
 * @returns {{user_id: (number|null), jti: (string|null)}|null} `null` si no existe o venció.
 */
function inspeccionarDraft(id) {
    purgarVencidos();
    if (typeof id !== 'string' || id.length === 0) return null;
    const d = drafts.get(id);
    if (!d) return null;
    return { user_id: d.user_id, jti: d.jti };
}

/**
 * Devuelve el payload y BORRA el borrador (uso único). `null` si no existe o venció.
 */
function reclamarDraft(id) {
    purgarVencidos();
    if (typeof id !== 'string' || id.length === 0) return null;
    const d = drafts.get(id);
    if (!d) return null;
    borrar(id);                              // uso único, incluso si estaba vencido
    if (d.expiresAt <= Date.now()) return null;
    return d.payload;
}

/** Solo para tests/diagnóstico. */
function _stats() {
    purgarVencidos();
    return {
        vivos: drafts.size,
        max: MAX_DRAFTS,
        ttlMs: TTL_MS,
        bytes: totalBytes,
        maxDraftBytes: MAX_DRAFT_BYTES,
        maxTotalBytes: MAX_TOTAL_BYTES,
    };
}

module.exports = {
    crearDraft, reclamarDraft, inspeccionarDraft, _stats,
    TTL_MS, MAX_DRAFTS, MAX_DRAFT_BYTES, MAX_TOTAL_BYTES,
};
