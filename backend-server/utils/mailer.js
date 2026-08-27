const nodemailer = require('nodemailer');
const logger = require('./logger');

// D2 (revisión 2026-07-25): ningún template de este archivo escapaba los datos de
// usuario antes de interpolarlos en HTML — mismo bug que XSS-1 (corregido en el
// dashboard el 2026-07-13), pero por el canal de email. El registro público (nombre,
// apellido, CUIT) está abierto ahora mismo (allow_public_register=true), así que
// cualquier persona podía inyectar HTML (ej. un link falso "Activar cuenta") en el
// email que le llega al ADMINISTRADOR — un canal interno de confianza. Se aplica a
// todo valor de origen humano interpolado en el cuerpo de los emails de este archivo.
function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

// Aclaración de que el portal pide login manual (los emails no abren sesión solos).
// redirectText (opcional): a dónde lo lleva el ?goto= después de ingresar.
function loginNote(redirectText) {
    return `<p style="font-size:12px;color:#6b7280;margin:14px 0 0">
      El botón te lleva al portal web — ingresá con tu email y contraseña${redirectText ? `, y ${redirectText}` : ''}.
    </p>`;
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
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
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
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
          ${p(`Tu email fue verificado correctamente. Tu cuenta con el plan <strong>${escapeHtml(planName)}</strong> está pendiente de activación por el administrador.`)}
          ${infoBox(`<strong>Ya podés empezar.</strong> Desde tu <strong>panel de usuario</strong> (sección <em>Mi Plan → Descargas</em>) podés instalar la <strong>extensión de Chrome</strong> y descargar la <strong>app de escritorio</strong>. La app incluye <strong>20 ejecuciones de prueba</strong> gratuitas durante el período de prueba.`)}
          ${btnPrimary(`${PORTAL_URL}?goto=plan`, 'Ir a mi panel de usuario →')}
          ${loginNote('llegarás directo a la sección de descargas')}
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
            <tr><td style="padding:8px 0;color:#6b7280;width:120px">Nombre</td><td style="padding:8px 0"><strong>${escapeHtml(userData.nombre)} ${escapeHtml(userData.apellido)}</strong></td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Email</td><td style="padding:8px 0">${escapeHtml(userData.email)}</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">CUIT</td><td style="padding:8px 0">${escapeHtml(userData.cuit)}</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Plan</td><td style="padding:8px 0">${escapeHtml(userData.plan_name)}</td></tr>
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
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
          ${infoBox(`Tu plan <strong>${escapeHtml(planName)}</strong> tiene un precio promocional que vence <strong>${fechaMsg}</strong> (en ${daysLeft} días).`)}
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
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
          ${infoBox('<strong>✅ ¡Tu cuenta está activa!</strong> Ya podés usar todas las funciones de tu plan sin límite de usos de prueba.', '#16a34a')}
          ${btnPrimary(`${PORTAL_URL}?goto=plan`, 'Ver mi plan en el portal →')}
          ${loginNote('verás el estado de tu plan')}
        `, '#16a34a')
    );
}

async function sendRejectionEmail(email, nombre, reason, mode) {
    const isBlock = mode === 'block';
    const subject = isBlock ? 'Tu solicitud fue rechazada — Procurador SCW' : 'Tu solicitud está en espera — Procurador SCW';
    const safeReason = escapeHtml(reason);
    const body = isBlock
        ? `${p(`Lamentablemente tu acceso fue <strong>denegado</strong>.`)}${infoBox(`Motivo: <em>${safeReason}</em>`, '#dc2626')}${p('Si creés que es un error, contactanos en <a href="mailto:soporte@procuradortool.com" style="color:#d97706">soporte@procuradortool.com</a>.')}`
        : `${p('Tu solicitud está <strong>en espera</strong>.')}${infoBox(`Motivo: <em>${safeReason}</em><br>Podés seguir usando tus usos de prueba.`, '#f59e0b')}`;

    await sendEmail(email, subject, emailLayout(`${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}${body}`, '#dc2626'));
}

async function sendTrialExhaustedEmail(email, nombre, opts = {}) {
    const { notActivated = false, usageLimit = 20 } = opts;
    // Dos variantes: antes de activación el usuario todavía no puede configurar
    // el pago (depende del admin); después de activación ya puede.
    if (notActivated) {
        await sendEmail(
            email,
            'Tus usos de prueba se agotaron — Procurador SCW',
            emailLayout(`
              ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
              ${infoBox(`Utilizaste todos tus <strong>${usageLimit} usos de prueba</strong>. Tu cuenta está pendiente de activación por el equipo — te avisaremos por email en cuanto esté lista para que puedas continuar.`, '#d97706')}
              ${p('Si tenés dudas, escribinos a <a href="mailto:soporte@procuradortool.com" style="color:#d97706">soporte@procuradortool.com</a>.')}
            `, '#d97706')
        );
    } else {
        await sendEmail(
            email,
            'Tus usos de prueba se agotaron — Procurador SCW',
            emailLayout(`
              ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
              ${infoBox(`Utilizaste todos tus <strong>${usageLimit} usos de prueba</strong>. Configurá tu método de pago desde el portal para acceder a los límites de tu plan y seguir usando la app y la extensión.`, '#d97706')}
              ${btnPrimary(PORTAL_URL, 'Ir al portal →')}
            `, '#d97706')
        );
    }
}

async function sendPlanExpiryWarningEmail(email, nombre, planExpiryDate) {
    const fecha = dateAR(planExpiryDate);
    await sendEmail(
        email,
        `Tu plan vence el ${fecha} — Procurador SCW`,
        emailLayout(`
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
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
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
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
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
          ${infoBox(`Tu cuenta fue suspendida por el administrador.<br>Motivo: <em>${escapeHtml(reason)}</em>`, '#dc2626')}
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
        : `${infoBox(`Tu solicitud de reactivación fue revisada. La suspensión se mantiene${reason ? `.<br>Motivo: <em>${escapeHtml(reason)}</em>` : '.'} `, '#dc2626')}${p('Contactanos en <a href="mailto:soporte@procuradortool.com" style="color:#d97706">soporte@procuradortool.com</a> si tenés dudas.')}`;

    await sendEmail(email, subject, emailLayout(`${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}${body}`, accent));
}

async function sendBillingReminderEmail(email, nombre, nextBillingDate) {
    const fecha = dateAR(nextBillingDate);
    await sendEmail(
        email,
        `Tu suscripción se renueva el ${fecha} — Procurador SCW`,
        emailLayout(`
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
          ${p(`Tu suscripción se renueva automáticamente el <strong>${fecha}</strong>.`)}
          ${p('Si querés cambiar tu plan o método de pago, hacelo desde el portal antes de esa fecha.')}
          ${btnPrimary(`${PORTAL_URL}?goto=facturacion`, 'Ir a facturación →')}
          ${loginNote('podrás cambiar tu plan o método de pago')}
        `)
    );
}

async function sendTicketReplyEmail(email, nombre, ticketId, ticketTitle, commentPreview) {
    if (process.env.EMAIL_TICKET_REPLY_ENABLED !== 'true') {
        logger.info(`📧 [skip] EMAIL_TICKET_REPLY_ENABLED=false — no se envía reply a ${email}`);
        return;
    }

    const portalUrl = `${PORTAL_URL}?goto=soporte`;
    // D2 (revisión 2026-07-25): truncar el texto CRUDO primero y escapar después (si se
    // escapa antes de truncar, un corte a mitad de una entidad como "&amp;" la rompe).
    // ticketTitle NO estaba escapado — es texto libre que el usuario elige al crear el
    // ticket (tickets.js no lo escapa, cap de 200 chars en 'description' pero 'title' es
    // el que llega acá) y se renderizaba crudo en el email de respuesta.
    const rawTitle = ticketTitle.length > 60 ? ticketTitle.substring(0, 60) + '…' : ticketTitle;
    const truncatedTitle = escapeHtml(rawTitle);
    const rawPreview = String(commentPreview || '');
    const previewWithEllipsis = escapeHtml(rawPreview.substring(0, 200)) + (rawPreview.length > 200 ? '…' : '');

    await sendEmail(
        email,
        `Procurador SCW — Respuesta a tu ticket #${ticketId}`,
        emailLayout(`
          ${p(`Hola <strong>${escapeHtml(nombre) || 'usuario'}</strong>,`)}
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
            <tr><td style="padding:8px 0;color:#6b7280;width:140px">Usuario</td><td style="padding:8px 0"><strong>${escapeHtml(nombre)} ${escapeHtml(apellido)}</strong> (${escapeHtml(email)})</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Motivo suspensión</td><td style="padding:8px 0">${escapeHtml(suspensionReason) || '-'}</td></tr>
            <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Mensaje del usuario</td><td style="padding:8px 0">${escapeHtml(userMessage) || '(sin mensaje)'}</td></tr>
          </table>
          ${btnPrimary(`${process.env.BASE_URL || 'https://api.procuradortool.com'}/dashboard`, 'Revisar en el panel de admin →')}
        `)
    );
}

// ─── Etapa 1.5 (F4) — alerta de la verificación funcional contra el PJN real ──
// Llamada por el cron nuevo de server.js (no por el módulo apagado dailyVerification.js).
// `tipo` distingue las 2 causas que justifican avisar aunque nadie mire el dashboard:
// un reporte que vino en error, o silencio prolongado (nadie corrió la prueba en +7 días).
async function sendVerificationAlert(tipo, { latest, daysSince } = {}) {
    const to = process.env.ALERT_EMAIL_TO;
    if (!to) return;

    const dashboardUrl = `${process.env.BASE_URL || 'https://api.procuradortool.com'}/dashboard`;

    if (tipo === 'error') {
        const flujosFallidos = (latest?.flujos || []).filter(f => f.estado === 'error');
        const filas = flujosFallidos.map(f =>
            `<tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">${escapeHtml(f.nombre || f.clave)}</td><td style="padding:8px 0">${escapeHtml(f.detalle || 'sin detalle')}</td></tr>`
        ).join('');
        await sendEmail(
            to,
            '⚠️ Verificación contra el PJN real reportó un error',
            emailLayout(`
              <h3 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 18px">La última verificación funcional falló</h3>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:8px 0;color:#6b7280;width:140px">Fecha</td><td style="padding:8px 0"><strong>${escapeHtml(latest?.timestamp || '-')}</strong></td></tr>
                <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280">Origen</td><td style="padding:8px 0">${escapeHtml(latest?.origen || '-')}</td></tr>
                ${filas}
              </table>
              ${infoBox('Para volver a verificar, pedile a Claude: <strong>"corré la prueba diaria de la app"</strong> — el comando también está siempre visible en la tarjeta de Diagnóstico.', '#dc2626')}
              ${btnPrimary(dashboardUrl, 'Ver en el dashboard →')}
            `, '#dc2626')
        );
        return;
    }

    // tipo === 'stale'
    await sendEmail(
        to,
        '⚠️ Hace más de 7 días que no se verifica contra el PJN real',
        emailLayout(`
          <h3 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 18px">Verificación funcional desactualizada</h3>
          <p>${latest
              ? `La última verificación fue hace <strong>${daysSince ?? '7+'} días</strong> (${escapeHtml(latest.timestamp)}).`
              : 'Todavía no se reportó ninguna verificación.'
          }</p>
          ${infoBox('Para verificar ahora, pedile a Claude: <strong>"corré la prueba diaria de la app"</strong> — el comando también está siempre visible en la tarjeta de Diagnóstico.')}
          ${btnPrimary(dashboardUrl, 'Ver en el dashboard →')}
        `)
    );
}

// ─── Fase 5 — Emails de cobranza ──────────────────────────────────────────────

async function sendInvoiceEmail(email, pdfUrl, numero) {
    const safeNumero = escapeHtml(numero);
    const html = `
        <h2>Tu factura de Procurador SCW</h2>
        <p>Tu factura <strong>#${safeNumero}</strong> ya está disponible.</p>
        <p><a href="${pdfUrl}" style="display:inline-block;background:#d97706;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Ver factura en PDF</a></p>
        <p style="color:#8a8a8a;font-size:13px;">Si el botón no funciona, copiá este link: <a href="${pdfUrl}">${pdfUrl}</a></p>
    `;
    return sendEmail(email, `Factura #${numero} — Procurador SCW`, html);
}

async function sendPaymentFailedEmail(email, graceEndDate) {
    const fecha = new Date(graceEndDate).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const html = `
        <h2>⚠️ Tu pago no pudo procesarse</h2>
        <p>Hubo un problema al cobrar tu suscripción de Procurador SCW.</p>
        <p>Tenés tiempo hasta el <strong>${fecha}</strong> para actualizar tu método de pago antes de que se suspenda el acceso.</p>
        <p><a href="${PORTAL_URL}?goto=facturacion" style="display:inline-block;background:#d97706;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Actualizar método de pago</a></p>
        <p style="color:#8a8a8a;font-size:12px;">El botón te lleva al portal web — ingresá con tu email y contraseña para actualizar tu método de pago.</p>
    `;
    return sendEmail(email, 'Acción requerida: actualizá tu método de pago — Procurador SCW', html);
}

// Email para un usuario dado de alta por el administrador: incluye las credenciales
// (email + contraseña temporal que fijó el admin), la recomendación de cambiarla, y el
// enlace de verificación de email (mismo flujo que el registro público).
async function sendAdminCreatedUserEmail(email, nombre, password, token) {
    const baseUrl = process.env.BASE_URL || 'https://api.procuradortool.com';
    const link = `${baseUrl}/auth/verify-email?token=${token}`;
    await sendEmail(
        email,
        'Tu cuenta en Procurador SCW — datos de acceso',
        emailLayout(`
          ${p(`Hola <strong>${escapeHtml(nombre)}</strong>,`)}
          ${p('El equipo de Procurador SCW te dio de alta una cuenta. Estos son tus datos de acceso:')}
          ${infoBox(`<strong>Usuario (email):</strong> ${escapeHtml(email)}<br><strong>Contraseña temporal:</strong> ${escapeHtml(password)}`)}
          ${p('<strong>Importante:</strong> por seguridad, te recomendamos cambiar esta contraseña la primera vez que ingreses, desde el portal de usuarios (sección Mi Perfil).')}
          ${p('Primero, verificá tu email haciendo clic en el botón:')}
          ${btnPrimary(link, 'Verificar mi email')}
          <p style="font-size:12px;color:#6b7280;margin:0 0 8px">
            Este enlace vence en 24 horas.
          </p>
          <p style="font-size:12px;color:#9ca3af;margin:0">
            Si el botón no funciona, copiá este enlace:<br>
            <a href="${link}" style="color:#d97706;word-break:break-all">${link}</a>
          </p>
        `)
    );
}

// Email de reset de contraseña (usado tanto por el reset público como por el reset
// disparado por un admin desde la ficha de usuario). Centralizado acá para usar los
// mismos helpers de marca que el resto de los emails (antes cada call site armaba
// su propio HTML a mano, con un <h2> redundante y un botón azul inconsistente).
async function sendPasswordResetEmail(email, nombre, resetLink, { byAdmin = false } = {}) {
    const intro = byAdmin
        ? 'El administrador solicitó el restablecimiento de tu contraseña. Hacé clic en el botón para crear una nueva:'
        : 'Recibimos una solicitud para restablecer tu contraseña. Hacé clic en el botón para crear una nueva:';
    await sendEmail(
        email,
        'Restablecer tu contraseña — Procurador SCW',
        emailLayout(`
          ${p(`Hola <strong>${escapeHtml(nombre) || 'usuario'}</strong>,`)}
          ${p(intro)}
          ${btnPrimary(resetLink, 'Restablecer contraseña')}
          <p style="font-size:12px;color:#6b7280;margin:0 0 8px">
            Este enlace vence en 24 horas. Si no solicitaste este cambio, ignorá este mensaje.
          </p>
          <p style="font-size:12px;color:#9ca3af;margin:0">
            Si el botón no funciona, copiá este enlace:<br>
            <a href="${resetLink}" style="color:#d97706;word-break:break-all">${resetLink}</a>
          </p>
        `)
    );
}

async function sendMail({ to, subject, text, html }) {
    return sendEmail(to, subject, html || `<p>${text}</p>`);
}

module.exports = {
    sendEmail,
    sendMail,
    sendEmailVerification,
    sendAdminCreatedUserEmail,
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
    sendPasswordResetEmail,
    sendVerificationAlert,
    // Fase 5
    sendInvoiceEmail,
    sendPaymentFailedEmail,
};
