// utils/verificationAlertCheck.js — Etapa 1.5 (F4).
//
// Decisión pura de si corresponde alertar por email sobre la verificación funcional
// contra el PJN real, extraída del cron de server.js para que sea testeable sin fs
// ni un tick real de node-cron. Muta `raw` in-place con los flags de dedup (mismo
// objeto que el cron persiste después) — sin esto, un silencio de 3 semanas
// mandaría 21 emails idénticos y el aviso se volvería ruido que se ignora.

const STALE_DAYS = 7;

/**
 * @param {object} raw   El contenido de data/verification-results.json (o
 *                       { latest: null, history: [] } si el archivo no existe todavía).
 * @param {Date}   [now] Inyectable para tests — default new Date().
 * @returns {{ tipo: 'error'|'stale'|null, cambio: boolean, daysSince: number }}
 *          `tipo` es qué alerta hay que enviar (o null si no corresponde ninguna).
 *          `cambio` indica si `raw` se modificó y hay que persistirlo.
 */
function decideVerificationAlert(raw, now = new Date()) {
    const latest = raw.latest;
    const daysSince = latest ? (now.getTime() - new Date(latest.timestamp).getTime()) / 86400000 : Infinity;
    const esError = !!latest && latest.estado === 'error';
    const esStale = daysSince > STALE_DAYS;

    if (esError) {
        // 1 alerta por reporte puntual (identificado por su timestamp) — un
        // reporte nuevo, aunque también sea error, dispara una alerta nueva.
        if (raw._lastErrorAlertFor !== latest.timestamp) {
            raw._lastErrorAlertFor = latest.timestamp;
            return { tipo: 'error', cambio: true, daysSince };
        }
        return { tipo: null, cambio: false, daysSince };
    }

    if (esStale) {
        // 1 alerta por "episodio" de desactualización — no se reenvía todos los
        // días mientras nadie corra la prueba.
        if (!raw._lastStaleAlertAt) {
            raw._lastStaleAlertAt = now.toISOString();
            return { tipo: 'stale', cambio: true, daysSince };
        }
        return { tipo: null, cambio: false, daysSince };
    }

    // Al día: si venía de un episodio de stale, se resetea el flag para el próximo.
    if (raw._lastStaleAlertAt) {
        raw._lastStaleAlertAt = null;
        return { tipo: null, cambio: true, daysSince };
    }

    return { tipo: null, cambio: false, daysSince };
}

module.exports = { decideVerificationAlert, STALE_DAYS };
