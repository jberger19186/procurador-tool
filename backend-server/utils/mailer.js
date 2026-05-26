const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        logger.warn('⚠️ SMTP no configurado — los emails no se enviarán. Define SMTP_HOST, SMTP_USER, SMTP_PASS en .env');
        return null;
    }

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    return transporter;
}

// ─────────────────────────────────────────────
//  BRANDING — header y footer unificados
// ─────────────────────────────────────────────

/**
 * Header de email con branding Procurador TOOL / SCW.
 * @param {string} [accentColor='#d97706']  Color del borde y acentos (amber por defecto)
 */
function emailHeader(accentColor = '#d97706') {
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
      <tr>
        <td style="background:${accentColor};padding:0;border-radius:8px 8px 0 0;height:5px"></td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:24px 32px 16px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:42px;vertical-align:middle">
                <img src="https://api.procuradortool.com/assets/icon128.png"
                     alt="Procurador SCW"
                     width="38" height="38"
                     style="display:block;border-radius:9px;width:38px;height:38px">
              </td>
              <td style="padding-left:12px;vertical-align:middle">
                <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;color:#1a1a1a;line-height:1.1">
                  Procurador <span style="color:${accentColor}">TOOL</span>
                </div>
                <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#8a8a8a;letter-spacing:0.03em;margin-top:2px">
                  Procurador SCW
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:0 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
          <hr style="border:none;border-top:1px solid #f3f4f6;margin:0">
        </td>
      </tr>
    </table>`;
}

/**
 * Footer de email con branding y contacto.
 */
function emailFooter() {
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
      <tr>
        <td style="background:#ffffff;padding:0 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
          <hr style="border:none;border-top:1px solid #f3f4f6;margin:0">
        </td>
      </tr>
      <tr>
        <td style="background:#f9fafb;padding:18px 32px 22px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;text-align:center">
          <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#6b7280;margin:0 0 4px">
            <strong style="color:#4a4a4a">Procurador SCW</strong> · parte de <strong style="color:#4a4a4a">Procurador TOOL</strong>
          </p>
          <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#9ca3af;margin:0">
            <a href="mailto:soporte@procuradortool.com" style="color:#d97706;text-decoration:none">soporte@procuradortool.com</a>
            &nbsp;·&nbsp;
            <a href="https://procuradortool.com" style="color:#9ca3af;text-decoration:none">procuradortool.com</a>
          </p>
        </td>
      </tr>
    </table>`;
}

/**
 * Envuelve el contenido en el layout completo del email.
 * @param {string} content   HTML del cuerpo (entre header y footer)
 * @param {string} [accent]  Color de acento (opcional)
 */
function emailLayout(content, accent = '#d97706') {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:20px 0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
  ${emailHeader(accent)}
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr>
      <td style="background:#ffffff;padding:24px 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
        ${content}
      </td>
    </tr>
  </table>
  ${emailFooter()}
</body>
</html>`;
}

// ─────────────────────────────────────────────
//  FUNCIÓN BASE
// ─────────────────────────────────────────────

async function sendEmail(to, subject, html) {
    const t = getTransporter();
    if (!t) return;

    const fullHtml = html.trim().startsWith('<!DOCTYPE') ? html : emailLayout(html);

    try {
        const info = await t.sendMail({
            from: process.env.SMTP_FROM || '"Procurador SCW" <noreply@procuradortool.com>',
            to,
            subject,
            html: fullHtml,
            textEncoding: 'base64',
        });
        logger.info(`📧 Email enviado a ${to}: ${subject} (id: ${info.messageId})`);
    } catch (err) {
        logger.error(`❌ Error enviando email a ${to}: ${err.message}`);
    }
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

const PORTAL_URL = 'https://api.procuradortool.com/usuarios/';

function dateAR(d) {
    return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function btnPrimary(href, text) {
    return `<div style="text-align:center;margin:28px 0">
      <a href="${href}" style="background:#d97706;color:#fff;padding:13px 28px;border-radius:6px;
         text-decoration:none;font-size:14px;font-weight:600;display:inline-block">${text}</a>
    </div>`;
}

function infoBox(content, accent = '#d97706') {
    return `<div style="background:#fffbeb;border-left:3px solid ${accent};border-radius:6px;
              padding:14px 18px;margin:18px 0;font-size:13.5px;color:#4a4a4a;line-height:1.55">
      ${content}
    </div>`;
}

function p(text) {
    return `<p style="font-size:15px;color:#1a1a1a;line-height:1.6;margin:0 0 14px">${text}</p>`;
}

// ─────────────────────────────────────────────
//  EMAILS
// ─────────────────────────────────────────────

async function sendEmailVerification(email, nombre, token) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link = `${baseUrl}/auth/verify-email?token=${token}`;

    await sendEmail(
        email,
        'Verificá tu cuenta — Procurador SCW',
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${p('Gracias por registrarte. Para activar tu cuenta hacé clic en el siguiente botón:')}
          ${btnPrimary(link, 'Verificar mi email')}
          <p style="font-size:12px;color:#6b7280;margin:0 0 8px">
            Este enlace vence en 24 horas. Si no te registraste en Procurador SCW, ignorá este mensaje.
          </p>
          <p style="font-size:12px;color:#9ca3af;margin:0">
            Si el botón no funciona, copiá este enlace:<br>
            <a href="${link}" style="color:#d97706;word-break:break-all">${link}</a>
          </p>
        `)
    );
}

async function sendWelcomeEmail(email, nombre, planName) {
    await sendEmail(
        email,
        '¡Bienvenido a Procurador SCW!',
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${p(`Tu email fue verificado correctamente. Tu cuenta con el plan <strong>${planName}</strong> está pendiente de activación por el administrador.`)}
          ${infoBox(`<strong>Mientras tanto</strong>, podés usar la aplicación con <strong>20 ejecuciones de prueba</strong> gratuitas.`)}
          ${p('Te notificaremos por email cuando tu suscripción sea activada.')}
        `)
    );
}

async function sendAdminNewUserAlert(userData) {
    const to = process.env.ALERT_EMAIL_TO;
    if (!to) return;

    await sendEmail(
        to,
        `Nuevo registro pendiente — ${userData.nombre} ${userData.apellido}`,
        emailLayout(`
          <h3 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 18px">
            Nuevo usuario pendiente de activación
          </h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#6b7280;width:120px">Nombre</td><td style="padding:8px 0"><strong>${userData.nombre} ${userData.apellido}</strong></td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Email</td><td style="padding:8px 0">${userData.email}</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">CUIT</td><td style="padding:8px 0">${userData.cuit}</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Plan</td><td style="padding:8px 0">${userData.plan_name}</td></tr>
          </table>
          ${btnPrimary(`${process.env.BASE_URL || 'https://api.procuradortool.com'}/dashboard`, 'Activar en el dashboard →')}
        `)
    );
}

async function sendPromoExpirationWarning(email, nombre, planName, daysLeft, promoEndDate) {
    const fechaMsg = promoEndDate
        ? `el ${dateAR(promoEndDate)}`
        : 'pronto';

    await sendEmail(
        email,
        `Tu promo vence en ${daysLeft} días — Procurador SCW`,
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${infoBox(`Tu plan <strong>${planName}</strong> tiene un precio promocional que vence <strong>${fechaMsg}</strong> (en ${daysLeft} días).`)}
          ${p('Para continuar usando Procurador SCW sin interrupciones, te recomendamos elegir uno de los planes disponibles antes del vencimiento.')}
          ${p('Abrí la aplicación para ver las opciones de renovación.')}
        `, '#f59e0b')
    );
}

async function sendActivationEmail(email, nombre) {
    await sendEmail(
        email,
        'Tu cuenta fue activada — Procurador SCW',
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${infoBox('<strong>✅ ¡Tu cuenta está activa!</strong> Ya podés usar todas las funciones de tu plan sin límite de usos de prueba.', '#16a34a')}
          ${btnPrimary(PORTAL_URL, 'Ver mi plan en el portal →')}
        `, '#16a34a')
    );
}

async function sendRejectionEmail(email, nombre, reason, mode) {
    const isBlock = mode === 'block';
    const subject = isBlock ? 'Tu solicitud fue rechazada — Procurador SCW' : 'Tu solicitud está en espera — Procurador SCW';
    const body = isBlock
        ? `${p(`Lamentablemente tu acceso fue <strong>denegado</strong>.`)}${infoBox(`Motivo: <em>${reason}</em>`, '#dc2626')}${p('Si creés que es un error, contactanos en <a href="mailto:soporte@procuradortool.com" style="color:#d97706">soporte@procuradortool.com</a>.')}`
        : `${p('Tu solicitud está <strong>en espera</strong>.')}${infoBox(`Motivo: <em>${reason}</em><br>Podés seguir usando tus usos de prueba.`, '#f59e0b')}`;

    await sendEmail(email, subject, emailLayout(`${p(`Hola <strong>${nombre}</strong>,`)}${body}`, '#dc2626'));
}

async function sendTrialExhaustedEmail(email, nombre) {
    await sendEmail(
        email,
        'Tus usos de prueba se agotaron — Procurador SCW',
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${infoBox('Utilizaste todos tus <strong>20 usos de prueba</strong>. Tu acceso fue bloqueado automáticamente.', '#dc2626')}
          ${p('Contactanos en <a href="mailto:soporte@procuradortool.com" style="color:#d97706">soporte@procuradortool.com</a> si querés activar una suscripción.')}
        `, '#dc2626')
    );
}

async function sendPlanExpiryWarningEmail(email, nombre, planExpiryDate) {
    const fecha = dateAR(planExpiryDate);
    await sendEmail(
        email,
        `Tu plan vence el ${fecha} — Procurador SCW`,
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${infoBox(`Tu plan actual vence el <strong>${fecha}</strong>. Para continuar sin interrupciones, seleccioná un nuevo plan.`, '#f59e0b')}
          ${btnPrimary(PORTAL_URL, 'Seleccionar nuevo plan →')}
        `, '#f59e0b')
    );
}

async function sendPlanExpiredSuspendedEmail(email, nombre) {
    await sendEmail(
        email,
        'Tu plan venció — Procurador SCW',
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${infoBox('Tu plan venció y tu acceso fue <strong>suspendido</strong>. Podés reactivarlo eligiendo un nuevo plan desde el portal.', '#dc2626')}
          ${btnPrimary(PORTAL_URL, 'Seleccionar nuevo plan')}
        `, '#dc2626')
    );
}

async function sendAdminSuspendedEmail(email, nombre, reason) {
    await sendEmail(
        email,
        'Tu cuenta fue suspendida — Procurador SCW',
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${infoBox(`Tu cuenta fue suspendida por el administrador.<br>Motivo: <em>${reason}</em>`, '#dc2626')}
          ${p('Podés solicitar una revisión desde el portal (una sola solicitud disponible).')}
          ${btnPrimary(PORTAL_URL, 'Solicitar revisión →')}
        `, '#dc2626')
    );
}

async function sendReactivationResultEmail(email, nombre, approved, reason) {
    const subject = approved ? 'Tu acceso fue restaurado — Procurador SCW' : 'Tu solicitud fue revisada — Procurador SCW';
    const accent = approved ? '#16a34a' : '#dc2626';
    const body = approved
        ? infoBox('✅ ¡Tu cuenta fue reactivada! Ya podés volver a usar la aplicación.', '#16a34a')
        : `${infoBox(`Tu solicitud de reactivación fue revisada. La suspensión se mantiene${reason ? `.<br>Motivo: <em>${reason}</em>` : '.'} `, '#dc2626')}${p('Contactanos en <a href="mailto:soporte@procuradortool.com" style="color:#d97706">soporte@procuradortool.com</a> si tenés dudas.')}`;

    await sendEmail(email, subject, emailLayout(`${p(`Hola <strong>${nombre}</strong>,`)}${body}`, accent));
}

async function sendBillingReminderEmail(email, nombre, nextBillingDate) {
    const fecha = dateAR(nextBillingDate);
    await sendEmail(
        email,
        `Tu suscripción se renueva el ${fecha} — Procurador SCW`,
        emailLayout(`
          ${p(`Hola <strong>${nombre}</strong>,`)}
          ${p(`Tu suscripción se renueva automáticamente el <strong>${fecha}</strong>.`)}
          ${p('Si querés cambiar tu plan o método de pago, hacelo desde el portal antes de esa fecha.')}
          ${btnPrimary(PORTAL_URL, 'Ir al portal →')}
        `)
    );
}

async function sendTicketReplyEmail(email, nombre, ticketId, ticketTitle, commentPreview) {
    if (process.env.EMAIL_TICKET_REPLY_ENABLED !== 'true') {
        logger.info(`📧 [skip] EMAIL_TICKET_REPLY_ENABLED=false — no se envía reply a ${email}`);
        return;
    }

    const portalUrl = `${PORTAL_URL}?goto=soporte`;
    const truncatedTitle = ticketTitle.length > 60 ? ticketTitle.substring(0, 60) + '…' : ticketTitle;
    const escapedPreview = String(commentPreview || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .substring(0, 200);
    const previewWithEllipsis = (commentPreview && commentPreview.length > 200) ? escapedPreview + '…' : escapedPreview;

    await sendEmail(
        email,
        `Procurador SCW — Respuesta a tu ticket #${ticketId}`,
        emailLayout(`
          ${p(`Hola <strong>${nombre || 'usuario'}</strong>,`)}
          ${p('El equipo de soporte respondió tu ticket:')}
          ${infoBox(`
            <div style="font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;
                        letter-spacing:0.05em;margin-bottom:6px">Ticket #${ticketId}</div>
            <div style="font-size:14px;color:#1a1a1a;font-weight:500;margin-bottom:10px">${truncatedTitle}</div>
            <div style="border-top:1px solid #fde68a;padding-top:10px;font-style:italic;white-space:pre-wrap">${previewWithEllipsis}</div>
          `)}
          ${btnPrimary(portalUrl, 'Ver respuesta completa →')}
          <p style="font-size:12px;color:#6b7280;margin:0">
            El botón te lleva al portal web — ingresá con tu email y contraseña, y serás redirigido directamente a tu ticket.
          </p>
        `)
    );
}

async function sendAdminReactivationRequest(nombre, apellido, email, suspensionReason, userMessage) {
    const to = process.env.ALERT_EMAIL_TO;
    if (!to) return;

    await sendEmail(
        to,
        `Solicitud de reactivación — ${nombre} ${apellido}`,
        emailLayout(`
          <h3 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 18px">Pedido de reactivación</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#6b7280;width:140px">Usuario</td><td style="padding:8px 0"><strong>${nombre} ${apellido}</strong> (${email})</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Motivo suspensión</td><td style="padding:8px 0">${suspensionReason || '-'}</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Mensaje del usuario</td><td style="padding:8px 0">${userMessage || '(sin mensaje)'}</td></tr>
          </table>
          ${btnPrimary(`${process.env.BASE_URL || 'https://api.procuradortool.com'}/dashboard`, 'Revisar en el panel de admin →')}
        `)
    );
}

module.exports = {
    sendEmail,
    sendEmailVerification,
    sendWelcomeEmail,
    sendAdminNewUserAlert,
    sendPromoExpirationWarning,
    sendActivationEmail,
    sendRejectionEmail,
    sendTrialExhaustedEmail,
    sendPlanExpiryWarningEmail,
    sendPlanExpiredSuspendedEmail,
    sendAdminSuspendedEmail,
    sendReactivationResultEmail,
    sendBillingReminderEmail,
    sendAdminReactivationRequest,
    sendTicketReplyEmail,
};
