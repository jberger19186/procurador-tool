// utils/healthAlertCheck.js — Etapa "mejora del smoke backend", Fase 1.
//
// Decisión pura de qué checks de salud ameritan un email, extraída de health-check.js
// para que sea testeable sin fs ni un cron real. Mismo espíritu que
// verificationAlertCheck.js (dedup por episodio, para no mandar el mismo aviso todos
// los días) pero generalizado a N checks independientes en vez de un único estado.
//
// Contrato de "episodio": un check que falla dispara UN email; mientras siga fallando,
// silencio; si se recupera y vuelve a fallar, es un episodio nuevo y alerta de nuevo.
// La recuperación en sí NO manda email (mismo criterio que decideVerificationAlert).

/**
 * @param {Array<{id: string, ok: boolean, message: string}>} checks  Resultado de la corrida actual.
 * @param {{ alerting?: Record<string, boolean> }} state  Persistido entre corridas — se muta in-place.
 * @returns {{ toAlert: Array<{id, ok, message}>, changed: boolean }}
 *   toAlert: los checks en rojo que todavía no dispararon aviso en este episodio.
 *   changed: si `state.alerting` se modificó y hay que persistirlo.
 */
function decideHealthAlerts(checks, state) {
    if (!state.alerting) state.alerting = {};
    const toAlert = [];
    let changed = false;

    for (const c of checks) {
        const wasAlerting = !!state.alerting[c.id];
        if (!c.ok) {
            if (!wasAlerting) {
                state.alerting[c.id] = true;
                changed = true;
                toAlert.push(c);
            }
            // ya en rojo y ya avisado en este episodio → silencio, no repetir.
        } else if (wasAlerting) {
            state.alerting[c.id] = false;
            changed = true;
            // se recuperó → se resetea el flag para el próximo episodio, sin email.
        }
    }

    return { toAlert, changed };
}

module.exports = { decideHealthAlerts };
