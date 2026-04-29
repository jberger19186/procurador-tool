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

    try {
        const info = await t.sendMail({
            from: process.env.SMTP_FROM || '"Procurador SCW" <noreply@procuradortool.com>',
            to,
            subject,
            html,
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

/**
 * Email al usuario cuando su solicitud es rechazada y bloqueada por el admin.
 */
async function sendAccountRejectedEmail(email, nombre, reason) {
    await sendEmail(
        email,
        'Información sobre tu solicitud — Procurador SCW',
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#d97706">Procurador SCW</h2>
          <p>Hola <strong>${nombre}</strong>,</p>
          <p>Tu solicitud de acceso a Procurador SCW no pudo ser aprobada en este momento.</p>
          ${reason ? `<p><strong>Motivo:</strong> ${reason}</p>` : ''}
          <p>Si tenés alguna consulta, podés contactarnos a través del soporte en la aplicación o escribirnos a <a href="mailto:soporte@procuradortool.com">soporte@procuradortool.com</a>.</p>
          <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
        </div>
        `
    );
}

/**
 * Email al usuario cuando su cuenta activa es suspendida por el admin.
 */
async function sendAccountSuspendedEmail(email, nombre, reason) {
    await sendEmail(
        email,
        'Tu cuenta fue suspendida — Procurador SCW',
        `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#d97706">Procurador SCW</h2>
          <p>Hola <strong>${nombre}</strong>,</p>
          <p>Tu cuenta en Procurador SCW ha sido suspendida por el administrador.</p>
          ${reason ? `<p><strong>Motivo:</strong> ${reason}</p>` : ''}
          <p>Si creés que se trata de un error o querés más información, contactanos a través del soporte en la aplicación o escribirnos a <a href="mailto:soporte@procuradortool.com">soporte@procuradortool.com</a>.</p>
          <p style="color:#6b7280;font-size:13px">Procurador SCW — soporte@procuradortool.com</p>
        </div>
        `
    );
}

module.exports = {
    sendEmail,
    sendEmailVerification,
    sendWelcomeEmail,
    sendAdminNewUserAlert,
    sendPromoExpirationWarning,
    sendAccountRejectedEmail,
    sendAccountSuspendedEmail,
};
