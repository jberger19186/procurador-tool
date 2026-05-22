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

/**
 * Función base para enviar emails.
 * Si SMTP no está configurado, loguea y no falla.
 */
async function sendEmail(to, subject, html) {
    const t = getTransporter();
    if (!t) return;

    // Envolver con <!DOCTYPE> + meta charset para asegurar UTF-8 en todos los clientes (Gmail, Outlook, etc.)
    const fullHtml = html.trim().startsWith('<!DOCTYPE') ? html : `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject.replace(/<[^>]+>/g, '')}</title>
</head>
<body>${html}</body>
</html>`;

    try {
        const info = await t.sendMail({
            from: process.env.SMTP_FROM || '"Procurador SCW" <noreply@procuradortool.com>',
            to,
            subject,
            html: fullHtml,
            textEncoding: 'base64',  // Asegura que caracteres no-ASCII en el subject viajen bien
        });
        logger.info(`📧 Email enviado a ${to}: ${subject} (id: ${info.messageId})`);
    } catch (err) {
        logger.error(`❌ Error enviando email a ${to}: ${err.message}`);
    }
}

/**
 * Email de verificación de cuenta.
 * @param {string} email
 * @param {string} nombre
 * @param {string} token
 */
async function sendEmailVerification(email, nombre, token) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link = `${baseUrl}/auth/verify-email?token=${token}`;

    await sendEmail(
        email,
        'Verificá tu cuenta — Procurador SCW',
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#1e40af">Procurador SCW</h2>
          <p>Hola <strong>${nombre}</strong>,</p>
          <p>Gracias por registrarte. Para activar tu cuenta hacé clic en el siguiente botón:</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${link}"
               style="background:#1e40af;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-size:16px">
              Verificar mi email
            </a>
          </div>
          <p style="color:#6b7280;font-size:13px">
            Este enlace vence en 24 horas. Si no te registraste en Procurador SCW, ignorá este mensaje.
          </p>
          <p style="color:#6b7280;font-size:12px">
            Si el botón no funciona, copiá este enlace en tu navegador:<br>
            <a href="${link}">${link}</a>
          </p>
        </div>
        `
    );
}

/**
 * Email de bienvenida post-verificación.
 * @param {string} email
 * @param {string} nombre
 * @param {string} planName
 */
async function sendWelcomeEmail(email, nombre, planName) {
    await sendEmail(
        email,
        '¡Bienvenido a Procurador SCW!',
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#1e40af">Procurador SCW</h2>
          <p>Hola <strong>${nombre}</strong>,</p>
          <p>Tu email fue verificado correctamente. Tu cuenta con el plan <strong>${planName}</strong> está pendiente de activación por el administrador.</p>
          <p>Mientras tanto, podés usar la aplicación con <strong>20 ejecuciones de prueba</strong> gratuitas.</p>
          <p>Te notificaremos cuando tu suscripción sea activada.</p>
          <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
        </div>
        `
    );
}

/**
 * Alerta al administrador cuando se registra un nuevo usuario.
 * @param {{ nombre: string, apellido: string, email: string, cuit: string, plan_name: string }} userData
 */
async function sendAdminNewUserAlert(userData) {
    const to = process.env.ALERT_EMAIL_TO;
    if (!to) return;

    await sendEmail(
        to,
        `Nuevo registro pendiente — ${userData.nombre} ${userData.apellido}`,
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#1e40af">Nuevo usuario pendiente de activación</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;color:#6b7280">Nombre</td><td style="padding:8px"><strong>${userData.nombre} ${userData.apellido}</strong></td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Email</td><td style="padding:8px">${userData.email}</td></tr>
            <tr><td style="padding:8px;color:#6b7280">CUIT</td><td style="padding:8px">${userData.cuit}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Plan</td><td style="padding:8px">${userData.plan_name}</td></tr>
          </table>
          <p style="margin-top:20px">
            Ingresá al <a href="${process.env.BASE_URL || 'http://localhost:3000'}/dashboard">dashboard</a> para activar la cuenta.
          </p>
        </div>
        `
    );
}

/**
 * Aviso de vencimiento próximo de promo.
 * @param {string} email
 * @param {string} nombre
 * @param {string} planName
 * @param {number} daysLeft
 * @param {string|null} promoEndDate - ISO string de fecha de vencimiento (null si es por cupo)
 */
async function sendPromoExpirationWarning(email, nombre, planName, daysLeft, promoEndDate) {
    const fechaMsg = promoEndDate
        ? `el ${new Date(promoEndDate).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}`
        : 'pronto';

    await sendEmail(
        email,
        `Tu promo vence en ${daysLeft} días — Procurador SCW`,
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#d97706">⚠️ Tu promo está por vencer</h2>
          <p>Hola <strong>${nombre}</strong>,</p>
          <p>Tu plan <strong>${planName}</strong> tiene un precio promocional que vence <strong>${fechaMsg}</strong> (en ${daysLeft} días).</p>
          <p>Para continuar usando Procurador SCW sin interrupciones, te recomendamos elegir uno de los planes disponibles antes del vencimiento.</p>
          <p>Abrí la aplicación para ver las opciones de renovación.</p>
          <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
        </div>
        `
    );
}

const PORTAL_URL = 'https://api.procuradortool.com/usuarios/';

function dateAR(d) {
    return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function sendActivationEmail(email, nombre) {
    await sendEmail(email, 'Tu cuenta fue activada — Procurador SCW', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#16a34a">✅ ¡Tu cuenta está activa!</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>El administrador activó tu cuenta. Ya podés usar todas las funciones de tu plan sin límite de usos de prueba.</p>
      <p><a href="${PORTAL_URL}" style="color:#1e40af">Ver mi plan en el portal →</a></p>
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

async function sendRejectionEmail(email, nombre, reason, mode) {
    const isBlock = mode === 'block';
    const subject = isBlock ? 'Tu solicitud fue rechazada — Procurador SCW' : 'Tu solicitud está en espera — Procurador SCW';
    const body = isBlock
        ? `<p>Lamentablemente tu acceso fue <strong>denegado</strong>. Motivo: <em>${reason}</em>.</p><p>Si creés que es un error, contactanos en soporte@procuradortool.com.</p>`
        : `<p>Tu solicitud está <strong>en espera</strong>. Motivo: <em>${reason}</em>. Podés seguir usando tus usos de prueba.</p>`;
    await sendEmail(email, subject, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">Procurador SCW</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      ${body}
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

async function sendTrialExhaustedEmail(email, nombre) {
    await sendEmail(email, 'Tus usos de prueba se agotaron — Procurador SCW', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">Procurador SCW</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Utilizaste todos tus <strong>20 usos de prueba</strong>. Tu acceso fue bloqueado automáticamente.</p>
      <p>Contactanos en soporte@procuradortool.com si querés activar una suscripción.</p>
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

async function sendPlanExpiryWarningEmail(email, nombre, planExpiryDate) {
    const fecha = dateAR(planExpiryDate);
    await sendEmail(email, `Tu plan vence el ${fecha} — Procurador SCW`, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#d97706">⚠️ Tu plan está por vencer</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Tu plan actual vence el <strong>${fecha}</strong>. Para continuar sin interrupciones, seleccioná un nuevo plan.</p>
      <p><a href="${PORTAL_URL}" style="color:#1e40af">Seleccionar nuevo plan →</a></p>
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

async function sendPlanExpiredSuspendedEmail(email, nombre) {
    await sendEmail(email, 'Tu plan venció — Procurador SCW', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">Tu plan venció</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Tu plan venció y tu acceso fue suspendido. Podés reactivarlo eligiendo un nuevo plan desde el portal.</p>
      <p><a href="${PORTAL_URL}" style="background:#d97706;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Seleccionar nuevo plan</a></p>
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

async function sendAdminSuspendedEmail(email, nombre, reason) {
    await sendEmail(email, 'Tu cuenta fue suspendida — Procurador SCW', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">Cuenta suspendida</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Tu cuenta fue suspendida por el administrador. Motivo: <em>${reason}</em>.</p>
      <p>Podés solicitar una revisión desde el portal (una sola solicitud disponible).</p>
      <p><a href="${PORTAL_URL}" style="color:#1e40af">Solicitar revisión →</a></p>
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

async function sendReactivationResultEmail(email, nombre, approved, reason) {
    const subject = approved ? 'Tu acceso fue restaurado — Procurador SCW' : 'Tu solicitud fue revisada — Procurador SCW';
    const body = approved
        ? '<p>¡Tu cuenta fue reactivada! Ya podés volver a usar la aplicación.</p>'
        : `<p>Tu solicitud de reactivación fue revisada. La suspensión se mantiene${reason ? `. Motivo: <em>${reason}</em>` : ''}.</p><p>Contactanos en soporte@procuradortool.com si tenés dudas.</p>`;
    await sendEmail(email, subject, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${approved ? '#16a34a' : '#dc2626'}">Procurador SCW</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      ${body}
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

async function sendBillingReminderEmail(email, nombre, nextBillingDate) {
    const fecha = dateAR(nextBillingDate);
    await sendEmail(email, `Tu suscripción se renueva el ${fecha} — Procurador SCW`, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e40af">Procurador SCW</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Tu suscripción se renueva automáticamente el <strong>${fecha}</strong>.</p>
      <p>Si querés cambiar tu plan o método de pago, hacelo desde el portal antes de esa fecha.</p>
      <p><a href="${PORTAL_URL}" style="color:#1e40af">Ir al portal →</a></p>
      <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
    </div>`);
}

/**
 * Email al usuario cuando soporte (admin) responde un ticket.
 * @param {string} email — email del usuario
 * @param {string} nombre — nombre del usuario
 * @param {number} ticketId — ID del ticket
 * @param {string} ticketTitle — título del ticket
 * @param {string} commentPreview — preview de la respuesta (max 200 chars)
 */
async function sendTicketReplyEmail(email, nombre, ticketId, ticketTitle, commentPreview) {
    if (process.env.EMAIL_TICKET_REPLY_ENABLED !== 'true') {
        logger.info(`📧 [skip] EMAIL_TICKET_REPLY_ENABLED=false — no se envía reply a ${email}`);
        return;
    }

    // Link al portal con goto=soporte — el usuario hace login normal y luego es redirigido a Soporte
    const portalUrl = `${PORTAL_URL}?goto=soporte`;
    const truncatedTitle = ticketTitle.length > 60 ? ticketTitle.substring(0, 60) + '…' : ticketTitle;
    const escapedPreview = String(commentPreview || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .substring(0, 200);
    const previewWithEllipsis = (commentPreview && commentPreview.length > 200) ? escapedPreview + '…' : escapedPreview;

    await sendEmail(
        email,
        `Procurador SCW — Respuesta a tu ticket #${ticketId}`,
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <h2 style="color:#d97706;margin-bottom:8px">🎫 Procurador SCW</h2>
          <p style="color:#1a1a1a;font-size:15px">Hola <strong>${nombre || 'usuario'}</strong>,</p>
          <p style="color:#1a1a1a;font-size:15px">El equipo de soporte respondió tu ticket:</p>

          <div style="background:#fffbeb;border-left:3px solid #d97706;border-radius:6px;padding:14px 18px;margin:18px 0">
            <div style="font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">
              Ticket #${ticketId}
            </div>
            <div style="font-size:14px;color:#1a1a1a;font-weight:500;margin-bottom:10px">
              ${truncatedTitle}
            </div>
            <div style="font-size:13.5px;color:#4a4a4a;line-height:1.55;font-style:italic;border-top:1px solid #fde68a;padding-top:10px;white-space:pre-wrap">
              ${previewWithEllipsis}
            </div>
          </div>

          <div style="text-align:center;margin:28px 0">
            <a href="${portalUrl}"
               style="background:#d97706;color:#fff;padding:13px 28px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block">
              Ver respuesta completa →
            </a>
          </div>

          <p style="color:#6b7280;font-size:12px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:14px">
            El botón te lleva al portal web — ingresá con tu email y contraseña, y serás redirigido directamente a tu ticket.
          </p>
          <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:8px">
            Procurador SCW — soporte@procuradortool.com
          </p>
        </div>
        `
    );
}

async function sendAdminReactivationRequest(nombre, apellido, email, suspensionReason, userMessage) {
    const to = process.env.ALERT_EMAIL_TO;
    if (!to) return;
    await sendEmail(to, `Solicitud de reactivación — ${nombre} ${apellido}`, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#d97706">Pedido de reactivación</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;color:#6b7280">Usuario</td><td style="padding:8px"><strong>${nombre} ${apellido}</strong> (${email})</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Motivo suspensión</td><td style="padding:8px">${suspensionReason || '-'}</td></tr>
        <tr><td style="padding:8px;color:#6b7280">Mensaje del usuario</td><td style="padding:8px">${userMessage || '(sin mensaje)'}</td></tr>
      </table>
      <p style="margin-top:20px">
        <a href="${process.env.BASE_URL || 'https://api.procuradortool.com'}/dashboard">Revisar en el panel de admin →</a>
      </p>
    </div>`);
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
