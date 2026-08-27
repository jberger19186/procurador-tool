/**
 * healthAlertCheck.test.js — Mejora del smoke backend, Fase 1: decisión de alerta
 * (dedup por episodio, genérica a N checks) + disparo real del email interceptado.
 *
 *   node backend-server/test/healthAlertCheck.test.js
 */

'use strict';

let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`✅ ${nombre}`); }
    else { fail++; console.log(`❌ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Parte 1 — decideHealthAlerts: decisión pura, sin I/O
// ═══════════════════════════════════════════════════════════════════════════
function testDecision() {
    const { decideHealthAlerts } = require('../utils/healthAlertCheck');

    // 1. Todo OK → nada que alertar, state sin cambios.
    {
        const state = {};
        const checks = [{ id: 'a', ok: true, message: 'bien' }, { id: 'b', ok: true, message: 'bien' }];
        const r = decideHealthAlerts(checks, state);
        check('1. Todo OK → toAlert vacío, changed=false', r.toAlert.length === 0 && r.changed === false);
    }

    // 2. Un check falla por primera vez → alerta, y queda marcado como "alerting".
    {
        const state = {};
        const checks = [{ id: 'disco', ok: false, message: 'lleno' }];
        const r = decideHealthAlerts(checks, state);
        check('2. Check nuevo en rojo → se alerta', r.toAlert.length === 1 && r.toAlert[0].id === 'disco');
        check('3. Queda marcado en state.alerting', state.alerting.disco === true);
        check('4. changed=true', r.changed === true);
    }

    // 3. 🔁 El MISMO check sigue en rojo en la corrida siguiente → NO se repite el email.
    {
        const state = { alerting: { disco: true } };
        const checks = [{ id: 'disco', ok: false, message: 'sigue lleno' }];
        const r = decideHealthAlerts(checks, state);
        check('5. 🔁 Mismo check en rojo, mismo episodio → silencio (no se repite)', r.toAlert.length === 0 && r.changed === false);
    }

    // 4. El check se recupera → se resetea el flag, SIN mandar email de "resuelto".
    {
        const state = { alerting: { disco: true } };
        const checks = [{ id: 'disco', ok: true, message: 'liberado' }];
        const r = decideHealthAlerts(checks, state);
        check('6. Recuperación → toAlert vacío (sin email de "resuelto")', r.toAlert.length === 0);
        check('7. El flag se resetea a false', state.alerting.disco === false);
        check('8. changed=true (hay que persistir el reset)', r.changed === true);
    }

    // 5. Tras recuperarse, si vuelve a fallar es un episodio NUEVO → alerta de nuevo.
    {
        const state = { alerting: { disco: false } };
        const checks = [{ id: 'disco', ok: false, message: 'lleno otra vez' }];
        const r = decideHealthAlerts(checks, state);
        check('9. Nuevo episodio tras recuperación → alerta de nuevo', r.toAlert.length === 1);
    }

    // 6. Varios checks independientes: cada uno tiene su propio episodio.
    {
        const state = { alerting: { cron_heartbeat: true } }; // ya venía alertado
        const checks = [
            { id: 'cron_heartbeat', ok: false, message: 'sigue caído' },       // mismo episodio → silencio
            { id: 'disco_ram', ok: false, message: 'disco lleno' },            // nuevo → alerta
            { id: 'backup_reciente', ok: true, message: 'ok' },                // ok, nunca alertado → nada
        ];
        const r = decideHealthAlerts(checks, state);
        check('10. Independencia entre checks: solo el nuevo en rojo entra en toAlert',
            r.toAlert.length === 1 && r.toAlert[0].id === 'disco_ram');
        check('11. El que ya estaba alertado sigue marcado, no se toca', state.alerting.cron_heartbeat === true);
    }

    // 7. state.alerting ausente (primera corrida del script) no rompe nada.
    {
        const state = {};
        const checks = [{ id: 'x', ok: false, message: 'falla' }];
        const r = decideHealthAlerts(checks, state);
        check('12. Primera corrida sin state.alerting previo no explota', r.toAlert.length === 1 && typeof state.alerting === 'object');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Parte 2 — sendHealthAlert: confirma que el email REALMENTE se dispara,
//  interceptando nodemailer.createTransport (mismo patrón que verificationAlertCheck).
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

    await mailer.sendHealthAlert([
        { id: 'disco_ram', ok: false, message: 'disco al 95%' },
        { id: 'backup_reciente', ok: false, message: 'sin backup en 40h' },
    ]);
    check('13. sendHealthAlert SÍ dispara un envío real (interceptado)', enviados.length === 1);
    check('14. Va al ALERT_EMAIL_TO configurado', enviados[0]?.to === 'alertas@stub.local');
    check('15. El asunto menciona la cantidad de chequeos', /2 chequeos/i.test(enviados[0]?.subject || ''));
    check('16. Lista los 2 checks fallidos por id', /disco_ram/.test(enviados[0]?.html || '') && /backup_reciente/.test(enviados[0]?.html || ''));
    check('17. Incluye el detalle de cada uno', /disco al 95%/.test(enviados[0]?.html || '') && /sin backup en 40h/.test(enviados[0]?.html || ''));

    // Un solo check fallido → singular en el asunto.
    await mailer.sendHealthAlert([{ id: 'cert_ssl', ok: false, message: 'vence en 5 días' }]);
    check('18. Un solo check → "1 chequeo" (singular)', /1 chequeo\b/i.test(enviados[1]?.subject || '') && !/1 chequeos/i.test(enviados[1]?.subject || ''));

    // Sin ALERT_EMAIL_TO configurado → no debe intentar enviar nada.
    delete process.env.ALERT_EMAIL_TO;
    delete require.cache[require.resolve('../utils/mailer')];
    const mailerSinAlert = require('../utils/mailer');
    await mailerSinAlert.sendHealthAlert([{ id: 'x', ok: false, message: 'x' }]);
    check('19. Sin ALERT_EMAIL_TO configurado, no intenta enviar nada', enviados.length === 2);

    nodemailer.createTransport = originalCreateTransport;
}

(async () => {
    testDecision();
    await testEnvioReal();

    console.log(`\n${ok}/${ok + fail} PASS`);
    if (fail > 0) process.exit(1);
})();
