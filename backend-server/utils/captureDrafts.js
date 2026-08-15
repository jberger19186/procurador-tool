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
 *   · Tope de borradores simultáneos — sin él, esto sería un sumidero de memoria
 *     alimentable desde internet (el rate-limit acota la frecuencia, no el total).
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

const drafts = new Map();        // id → { payload, expiresAt }

/** Descarta los vencidos. Se llama en cada operación (evita un timer que mantenga vivo el proceso). */
function purgarVencidos() {
    const ahora = Date.now();
    for (const [id, d] of drafts.entries()) {
        if (d.expiresAt <= ahora) drafts.delete(id);
    }
}

/**
 * Guarda un borrador y devuelve su id opaco.
 * Si se llegó al tope, descarta el más viejo (FIFO por vencimiento) — preferible
 * a rechazar la captura del usuario legítimo que llega último.
 */
function crearDraft(payload) {
    purgarVencidos();
    if (drafts.size >= MAX_DRAFTS) {
        let masViejo = null;
        for (const [id, d] of drafts.entries()) {
            if (!masViejo || d.expiresAt < masViejo[1].expiresAt) masViejo = [id, d];
        }
        if (masViejo) drafts.delete(masViejo[0]);
    }
    const id = crypto.randomBytes(32).toString('hex');
    drafts.set(id, { payload, expiresAt: Date.now() + TTL_MS });
    return id;
}

/**
 * Devuelve el payload y BORRA el borrador (uso único). `null` si no existe o venció.
 */
function reclamarDraft(id) {
    purgarVencidos();
    if (typeof id !== 'string' || id.length === 0) return null;
    const d = drafts.get(id);
    if (!d) return null;
    drafts.delete(id);                       // uso único, incluso si estaba vencido
    if (d.expiresAt <= Date.now()) return null;
    return d.payload;
}

/** Solo para tests/diagnóstico. */
function _stats() {
    purgarVencidos();
    return { vivos: drafts.size, max: MAX_DRAFTS, ttlMs: TTL_MS };
}

module.exports = { crearDraft, reclamarDraft, _stats, TTL_MS, MAX_DRAFTS };
