/**
 * verificationAlertCheck.test.js — Etapa 1.5 (F4): decisión de alerta + disparo real
 * del email (con nodemailer interceptado, sin enviar nada real).
 *
 *   node backend-server/test/verificationAlertCheck.test.js
 */

'use strict';

let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`✅ ${nombre}`); }
    else { fail++; console.log(`❌ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Parte 1 — decideVerificationAlert: decisión pura, sin I/O
// ═══════════════════════════════════════════════════════════════════════════
function testDecision() {
    const { decideVerificationAlert } = require('../utils/verificationAlertCheck');

    // 1. Nunca hubo un reporte → cuenta como "stale" (silencio total) → alerta.
    {
        const raw = { latest: null, history: [] };
        const r = decideVerificationAlert(raw, new Date());
        check('1. Sin ningún reporte → tipo=stale', r.tipo === 'stale', `tipo=${r.tipo}`);
        check('2. Se marca cambio=true y queda el flag de dedup', r.cambio === true && !!raw._lastStaleAlertAt);
    }

    // 2. Reporte reciente y OK → nada que alertar, sin tocar el archivo.
    {
        const raw = { latest: { timestamp: new Date().toISOString(), estado: 'ok' } };
        const r = decideVerificationAlert(raw, new Date());
        check('3. Reporte reciente OK → tipo=null, cambio=false', r.tipo === null && r.cambio === false);
    }

    // 3. Reporte con estado='error' → alerta de error.
    {
        const ts = new Date().toISOString();
        const raw = { latest: { timestamp: ts, estado: 'error' } };
        const r = decideVerificationAlert(raw, new Date());
        check('4. Reporte en error → tipo=error', r.tipo === 'error');
        check('5. Queda el dedup con el timestamp de ESE reporte', raw._lastErrorAlertFor === ts);
    }

    // 4. El MISMO reporte de error, llamado 2 veces seguidas → la 2ª no vuelve a alertar.
    {
        const ts = new Date().toISOString();
        const raw = { latest: { timestamp: ts, estado: 'error' } };
        decideVerificationAlert(raw, new Date());
        const r2 = decideVerificationAlert(raw, new Date());
        check('6. 🔁 Mismo reporte de error 2 veces → la 2ª NO alerta de nuevo (dedup)', r2.tipo === null && r2.cambio === false);
    }

    // 5. Un reporte de error NUEVO (timestamp distinto) → sí vuelve a alertar.
    {
        const raw = { latest: { timestamp: '2026-08-01T00:00:00.000Z', estado: 'error' } };
        decideVerificationAlert(raw, new Date());
        raw.latest = { timestamp: '2026-08-02T00:00:00.000Z', estado: 'error' };
        const r2 = decideVerificationAlert(raw, new Date());
        check('7. Un reporte de error DISTINTO sí dispara una alerta nueva', r2.tipo === 'error');
    }

    // 6. Reporte OK pero de hace 10 días → stale.
    {
        const hace10dias = new Date(Date.now() - 10 * 86400000).toISOString();
        const raw = { latest: { timestamp: hace10dias, estado: 'ok' } };
        const r = decideVerificationAlert(raw, new Date());
        check('8. Último reporte OK pero de hace 10 días → tipo=stale', r.tipo === 'stale', `daysSince=${r.daysSince.toFixed(1)}`);
    }

    // 7. Stale, llamado 2 veces (simulando 2 corridas del cron en días distintos sin
    //    que nadie corrija nada) → la 2ª NO reenvía (mismo episodio).
    {
        const hace10dias = new Date(Date.now() - 10 * 86400000).toISOString();
        const raw = { latest: { timestamp: hace10dias, estado: 'ok' } };
        decideVerificationAlert(raw, new Date());
        const r2 = decideVerificationAlert(raw, new Date(Date.now() + 86400000)); // 1 día después
        check('9. 🔁 Stale 2 días seguidos → el 2º NO reenvía (mismo episodio, sin spam)', r2.tipo === null && r2.cambio === false);
    }

    // 8. Estaba en stale, y llega un reporte NUEVO al día (aunque siga siendo viejo el
    //    check inmediato) → se resetea el flag para el próximo episodio.
    {
        const hace10dias = new Date(Date.now() - 10 * 86400000).toISOString();
        const raw = { latest: { timestamp: hace10dias, estado: 'ok' } };
        decideVerificationAlert(raw, new Date());
        check('10. Tras la alerta de stale, queda _lastStaleAlertAt seteado', !!raw._lastStaleAlertAt);

        // Llega un reporte fresco y OK — ya no es stale.
        raw.latest = { timestamp: new Date().toISOString(), estado: 'ok' };
        const r2 = decideVerificationAlert(raw, new Date());
        check('11. Con un reporte fresco, el flag de stale se resetea (cambio=true, tipo=null)',
            r2.tipo === null && r2.cambio === true && raw._lastStaleAlertAt === null);

        // Si vuelve a quedar viejo más adelante, tiene que poder alertar de nuevo.
        raw.latest = { timestamp: new Date(Date.now() - 9 * 86400000).toISOString(), estado: 'ok' };
        const r3 = decideVerificationAlert(raw, new Date());
        check('12. Un NUEVO episodio de stale (tras haberse resuelto) vuelve a alertar', r3.tipo === 'stale');
    }

    // 9. estado='parcial' (no 'error') con reporte reciente → no alerta (parcial no es error).
    {
        const raw = { latest: { timestamp: new Date().toISOString(), estado: 'parcial' } };
        const r = decideVerificationAlert(raw, new Date());
        check('13. estado=parcial reciente → NO alerta (parcial no es error ni stale)', r.tipo === null);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Parte 2 — sendVerificationAlert: confirma que el email REALMENTE se dispara,
//  interceptando nodemailer.createTransport (mismo patrón que D2, sin enviar nada real)
// ═══════════════════════════════════════════════════════════════════════════
async function testEnvioReal() {
    const enviados = [];
    const nodemailer = require('nodemailer');
    const originalCreateTransport = nodemailer.createTransport;
    nodemailer.createTransport = () => ({
        sendMail: async (opts) => { enviados.push(opts); return { messageId: 'fake-' + enviados.length }; },
    });

    process.env.SMTP_HOST = 'smtp.stub.local';
    process.env.SMTP_USER = 'stub@stub.local';
    process.env.SMTP_PASS = 'x';
    process.env.SMTP_FROM = 'soporte@procuradortool.com';
    process.env.ALERT_EMAIL_TO = 'alertas@stub.local';

    delete require.cache[require.resolve('../utils/mailer')];
    const mailer = require('../utils/mailer');

    await mailer.sendVerificationAlert('error', {
        latest: {
            timestamp: '2026-08-27T00:00:00.000Z', origen: 'computer-use',
            flujos: [
                { clave: 'informe', nombre: 'Informe individual', estado: 'error', detalle: 'timeout PJN' },
                { clave: 'proc', nombre: 'Procuración', estado: 'ok' },
            ],
        },
    });
    check('14. sendVerificationAlert("error") SÍ dispara un envío real (interceptado)', enviados.length === 1);
    check('15. Va al ALERT_EMAIL_TO configurado', enviados[0]?.to === 'alertas@stub.local');
    check('16. El asunto menciona el error', /error/i.test(enviados[0]?.subject || ''));
    check('17. Solo lista los flujos que fallaron (no el que dio ok)',
        /informe/i.test(enviados[0]?.html || '') && !/Procuraci[oó]n<\/td>/i.test(enviados[0]?.html || ''));

    await mailer.sendVerificationAlert('stale', {
        latest: { timestamp: '2026-08-10T00:00:00.000Z' },
        daysSince: 17,
    });
    check('18. sendVerificationAlert("stale") también dispara un envío', enviados.length === 2);
    check('19. El asunto/cuerpo de "stale" menciona los días', /17/.test(enviados[1]?.html || '') || /d[ií]as/i.test(enviados[1]?.subject || ''));

    // Sin ALERT_EMAIL_TO configurado → no debe intentar enviar nada (mismo guard que
    // ya usan sendAdminNewUserAlert/sendAdminReactivationRequest).
    delete process.env.ALERT_EMAIL_TO;
    delete require.cache[require.resolve('../utils/mailer')];
    const mailerSinAlert = require('../utils/mailer');
    await mailerSinAlert.sendVerificationAlert('error', { latest: { timestamp: 'x', estado: 'error', flujos: [] } });
    check('20. Sin ALERT_EMAIL_TO configurado, no intenta enviar nada', enviados.length === 2);

    nodemailer.createTransport = originalCreateTransport;
}

(async () => {
    testDecision();
    await testEnvioReal();

    console.log(`\n${ok}/${ok + fail} PASS`);
    if (fail > 0) process.exit(1);
})();
