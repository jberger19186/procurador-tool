/* =============================================
   Portal de Usuario — Procurador SCW
   app.js — SPA principal
   ============================================= */

'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'psc_user_token';
const BASE_URL = '';  // Misma origin

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
    token: null,
    account: null,
    currentSection: 'plan',
    tickets: [],
    currentTicket: null,
    chatMessages: [],
    chatLoading: false,
    plans: [],
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function saveToken(t) {
    localStorage.setItem(TOKEN_KEY, t);
    state.token = t;
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    state.token = null;
}

async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    };

    const res = await fetch(BASE_URL + path, {
        ...options,
        headers,
        body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
    });

    if (res.status === 401 || res.status === 403) {
        // Token expirado o inválido
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || (data.error && (data.error.includes('Token') || data.error.includes('token')))) {
            doLogout();
            return null;
        }
    }

    return res;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showAlert(el, type, msg) {
    el.className = `alert alert-${type} visible`;
    el.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> ${escapeHtml(msg)}`;
    if (type === 'success') {
        setTimeout(() => { el.classList.remove('visible'); }, 4000);
    }
}

// ─── Toast / confirm no bloqueantes ───────────────────────────────────────────
// Reemplazan alert()/confirm() en el flujo de checkout: los diálogos nativos del
// navegador BLOQUEAN el hilo del renderer hasta que el usuario hace click en
// "Aceptar" — esto causaba que herramientas de automatización (que no manejan
// diálogos nativos) reportaran la página como "congelada" (ver U9.3 en
// plan-pruebas-integral-2026-07.md). No cambia ninguna lógica del flujo, solo la UI.
function ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;max-width:380px';
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, type = 'info') {
    const colors = {
        success: { bg: '#ecfdf5', border: '#10b981', text: '#065f46', icon: '✅' },
        error:   { bg: '#fef2f2', border: '#ef4444', text: '#991b1b', icon: '❌' },
        info:    { bg: '#eff6ff', border: '#1e40af', text: '#1e3a8a', icon: 'ℹ️' },
    };
    const c = colors[type] || colors.info;
    const container = ensureToastContainer();
    const el = document.createElement('div');
    el.style.cssText = `background:${c.bg};border:1px solid ${c.border};color:${c.text};padding:12px 16px;border-radius:10px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.1);display:flex;align-items:flex-start;gap:10px;animation:toastIn .2s ease-out`;
    el.innerHTML = `<span style="flex-shrink:0">${c.icon}</span><span style="flex:1;line-height:1.4">${escapeHtml(message)}</span><span style="cursor:pointer;opacity:.6;flex-shrink:0" onclick="this.parentElement.remove()">✕</span>`;
    container.appendChild(el);
    const autoDismissMs = type === 'error' ? 7000 : 5000;
    setTimeout(() => { el.style.animation = 'toastOut .2s ease-in'; setTimeout(() => el.remove(), 200); }, autoDismissMs);
}

// Modal de confirmación no bloqueante. Devuelve una Promise<boolean> — se usa con
// await en vez de la llamada síncrona bloqueante de confirm().
function showConfirm(message, { confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
        overlay.innerHTML = `
            <div style="background:var(--card-bg,#fff);border-radius:12px;padding:24px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.25)">
                <p style="font-size:14px;color:var(--text,#1f2937);line-height:1.5;white-space:pre-line;margin:0 0 20px">${escapeHtml(message)}</p>
                <div style="display:flex;justify-content:flex-end;gap:8px">
                    <button class="btn btn-outline btn-sm" data-role="cancel">${escapeHtml(cancelLabel)}</button>
                    <button class="btn btn-primary btn-sm" data-role="confirm">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>`;
        const close = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('[data-role="confirm"]').onclick = () => close(true);
        overlay.querySelector('[data-role="cancel"]').onclick = () => close(false);
        overlay.onclick = (e) => { if (e.target === overlay) close(false); };
        document.body.appendChild(overlay);
    });
}

function limitDisplay(val) {
    if (val === null || val === undefined) return '∞';
    if (val === -1) return '∞';
    return val;
}

// ─── REMEMBER ME ─────────────────────────────────────────────────────────────
const REMEMBERED_KEY = 'psc_remembered_users';

function getRememberedUsers() {
    try { return JSON.parse(localStorage.getItem(REMEMBERED_KEY) || '[]'); } catch { return []; }
}

function saveRememberedUser(email, password) {
    const users = getRememberedUsers().filter(u => u.email !== email);
    users.unshift({ email, pw: btoa(password) }); // mover al frente si ya existía
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(users.slice(0, 5)));
}

function removeRememberedUser(email) {
    const users = getRememberedUsers().filter(u => u.email !== email);
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(users));
    renderRememberedUsers();
}

function fillLoginForm(email, pw) {
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = pw ? atob(pw) : '';
    document.getElementById('remember-me').checked = true;
}

function renderRememberedUsers() {
    const users = getRememberedUsers();
    const panel = document.getElementById('remembered-users-panel');
    const list  = document.getElementById('remembered-users-list');
    const form  = document.getElementById('login-form');

    if (!users.length) {
        panel.style.display = 'none';
        form.style.display = 'block';
        return;
    }

    panel.style.display = 'block';
    // Si hay un solo usuario, pre-cargar el form y ocultarlo
    if (users.length === 1) {
        fillLoginForm(users[0].email, users[0].pw);
        form.style.display = 'block';
    }

    list.innerHTML = users.map(u => `
        <button type="button" class="remembered-user-btn" onclick="selectRememberedUser('${escapeHtml(u.email)}', '${u.pw}')">
            <div class="remembered-user-avatar">${escapeHtml(u.email[0].toUpperCase())}</div>
            <div class="remembered-user-info">
                <div class="remembered-user-email">${escapeHtml(u.email)}</div>
                <div class="remembered-user-hint">Toca para ingresar</div>
            </div>
            <button type="button" class="remembered-user-remove" onclick="event.stopPropagation(); removeRememberedUser('${escapeHtml(u.email)}')" title="Olvidar cuenta">✕</button>
        </button>
    `).join('');
}

function selectRememberedUser(email, pw) {
    fillLoginForm(email, pw);
    // Scroll al formulario y hacer submit automático
    document.getElementById('login-form').dispatchEvent(new Event('submit'));
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function doLogin(email, password) {
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Ingresando...';

    try {
        const res = await fetch(BASE_URL + '/auth/portal-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok || !data.token) {
            errEl.textContent = data.error || 'Credenciales incorrectas. Verificá tu email y contraseña.';
            errEl.style.display = 'block';
            return;
        }

        if (document.getElementById('remember-me').checked) {
            saveRememberedUser(email, password);
        }
        saveToken(data.token);
        await initDashboard();
    } catch (e) {
        errEl.textContent = 'Error de conexión. Verificá tu internet e intentá de nuevo.';
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
    }
}

function doLogout() {
    // RI-5 (revisión 2026-07-19): blacklistear el token server-side al desloguear.
    // Fire-and-forget con el token capturado ANTES de limpiarlo — usa fetch directo
    // (no apiFetch, que llamaría a doLogout() de nuevo ante un 401/403 y recursaría).
    const _t = getToken();
    if (_t) fetch(BASE_URL + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${_t}` } }).catch(() => {});
    clearToken();
    state.account = null;
    state.currentSection = 'perfil';
    state.tickets = [];
    state.chatMessages = [];
    document.getElementById('app').classList.remove('visible');
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('login-form').reset();
    document.getElementById('login-error').style.display = 'none';
    renderRememberedUsers();
}

// ─── INIT DASHBOARD ───────────────────────────────────────────────────────────
async function initDashboard() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app').classList.add('visible');

    await loadAccount();

    // Si la cuenta no se pudo cargar (token de un usuario borrado/sesión inválida),
    // loadAccount ya cerró sesión y mostró el login. No seguimos inicializando para
    // no dejar un dashboard vacío ni disparar llamadas con una sesión inexistente.
    if (!state.account) return;

    // Gap 1+2 — Mostrar banner si email no verificado
    if (state.account && !state.account.emailVerified) {
        showEmailVerificationBanner();
    }

    // Cargar contador de notificaciones no leídas (badge sidebar)
    refreshNotifBadge();
    setInterval(refreshNotifBadge, 120000); // cada 2 min

    // Retorno desde checkout MercadoPago → vincular preapproval y navegar a facturación
    const pagoOkData = sessionStorage.getItem('show_pago_ok');
    if (pagoOkData) {
        sessionStorage.removeItem('show_pago_ok');
        // Llamamos a /confirm vía JWT. El backend VERIFICA contra MercadoPago que
        // exista una suscripción autorizada antes de marcar el método de pago
        // (configured=true/false). Si el usuario volvió del checkout sin pagar,
        // configured=false y el banner lo refleja (no se muestra el éxito).
        let confirmed = false;
        try {
            const { preapprovalId } = JSON.parse(pagoOkData);
            const res = await apiFetch('/usuarios/api/checkout/confirm', {
                method: 'POST',
                body: JSON.stringify({ preapproval_id: preapprovalId || undefined })
            });
            if (res && res.ok) {
                const d = await res.json();
                confirmed = d.configured !== false; // backward compat si no viene el campo
            }
        } catch (_) {}
        // Recargar cuenta para que renderFact() vea el payment_provider actualizado
        await loadAccount();
        navigateTo('facturacion');
        setTimeout(() => {
            const banner = document.createElement('div');
            if (confirmed) {
                banner.style.cssText = 'background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-weight:600;';
                banner.textContent = '✅ ¡Método de pago configurado correctamente! Tu suscripción mensual está activa.';
            } else {
                banner.style.cssText = 'background:#fffbeb;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-weight:600;';
                banner.textContent = 'ℹ️ No detectamos un pago confirmado en MercadoPago. Si completaste la suscripción, se acreditará automáticamente en unos minutos.';
            }
            const container = document.getElementById('facturacion-content')
                           || document.getElementById('section-facturacion');
            if (container) container.prepend(banner);
            setTimeout(() => banner.remove(), 8000);
        }, 500);
        return;
    }

    // Consumir pending_goto (de SSO o de ?goto= persistido en sessionStorage)
    const pendingGoto = sessionStorage.getItem('pending_goto');
    if (pendingGoto) {
        sessionStorage.removeItem('pending_goto');
        if (pendingGoto === 'nuevo-ticket') {
            navigateTo('soporte');
            setTimeout(() => openNewTicketModal(), 300);
            return;
        }
        navigateTo(pendingGoto);
        return;
    }

    navigateTo('plan');
}

function showEmailVerificationBanner() {
    let banner = document.getElementById('email-verify-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'email-verify-banner';
        banner.style.cssText = `
            background:#fffbeb;border-bottom:1px solid #fde68a;padding:10px 20px;
            display:flex;align-items:center;justify-content:space-between;
            flex-wrap:wrap;gap:8px;font-size:13px;color:#78350f;
        `;
        banner.innerHTML = `
            <span>⚠️ <strong>Tu email no está verificado.</strong> Revisá tu casilla o solicitá un nuevo enlace para acceder a las descargas.</span>
            <button id="btn-resend-verify" style="background:#d97706;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600">
                Reenviar email de verificación
            </button>
        `;
        const topbar = document.getElementById('topbar') || document.querySelector('.topbar');
        if (topbar && topbar.parentNode) {
            topbar.parentNode.insertBefore(banner, topbar.nextSibling);
        } else {
            document.getElementById('app').prepend(banner);
        }
        document.getElementById('btn-resend-verify').addEventListener('click', resendVerification);
    }
    banner.style.display = 'flex';
}

async function resendVerification() {
    const btn = document.getElementById('btn-resend-verify');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
        const res = await fetch('/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: state.account?.email }),
        });
        const data = await res.json();
        btn.textContent = '✅ Email enviado';
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'Reenviar email de verificación';
        }, 5000);
        if (data.message) alert(data.message);
    } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Reenviar email de verificación';
        alert('Error de conexión. Intentá de nuevo.');
    }
}

async function loadAccount() {
    try {
        const res = await apiFetch('/client/account');
        if (!res) return;                      // apiFetch ya cerró sesión (401) y mostró el login
        // Si la cuenta no se pudo cargar (404 usuario inexistente/borrado, u otro
        // error), no dejamos un dashboard vacío: cerramos sesión y mostramos el login.
        if (!res.ok) { doLogout(); return; }
        const data = await res.json();
        if (!data.success) { doLogout(); return; }

        state.account = data.account;
        renderTopbar();
        renderStatusBanner();
        updateSidebarForStatus();
    } catch (e) {
        console.error('Error cargando cuenta:', e);
    }
}

function renderStatusBanner() {
    const acc = state.account;
    const banner = document.getElementById('status-banner');
    const bannerText = document.getElementById('status-banner-text');
    if (!banner || !bannerText || !acc) return;

    const rs = acc.registrationStatus;
    const PORTAL = window.location.origin + window.location.pathname;

    const configs = {
        pending_activation: {
            color: '#1d4ed8',
            msg: () => {
                const used = acc.usageCount ?? 0;
                const limit = acc.usageLimit ?? 20;   // incluye los usos de cortesía del admin
                if (limit >= 100000) {
                    return 'Tu cuenta tiene acceso asignado por el equipo. Está pendiente de activación final por el administrador.';
                }
                const courtesy = acc.courtesyExtras || 0;
                const rem = limit - used;
                const alerta = rem <= 5 ? ' 🔴' : '';
                const cortesiaTxt = courtesy > 0 ? ` (incluye +${courtesy} de cortesía)` : '';
                return `Cuenta pendiente de activación — ${used} de ${limit} usos de prueba utilizados${cortesiaTxt}. El administrador activará tu cuenta en breve.${alerta}`;
            }
        },
        suspended: {
            color: '#991b1b',
            msg: () => 'Pago fallido. Actualizá tu método de pago en Facturación para reactivar tu cuenta.'
        },
        suspended_admin: {
            color: '#991b1b',
            msg: () => `Tu cuenta fue suspendida. Motivo: ${acc.suspensionReason || 'sin motivo indicado'}. Podés solicitar revisión abajo.`
        },
        suspended_plan_expired: {
            color: '#991b1b',
            msg: () => 'Tu plan venció. Seleccioná un nuevo plan en Mi Plan para reactivar.'
        },
        cancelled: {
            color: '#374151',
            msg: () => 'Tu suscripción fue cancelada. Podés volver a suscribirte configurando un método de pago en Facturación.'
        },
    };

    // Pago rechazado, en período de gracia (active, con método, gracia aún vigente).
    // Tiene prioridad: avisar a tiempo para que actualice el pago antes de la suspensión.
    if (rs === 'active' && acc.paymentGraceEndsAt && new Date(acc.paymentGraceEndsAt) > new Date()) {
        banner.style.background = '#b45309';
        bannerText.textContent = `⚠️ Tu último pago fue rechazado. Actualizá tu método de pago en Facturación antes del ${formatDate(acc.paymentGraceEndsAt)} o tu cuenta se suspenderá. Seguís teniendo acceso hasta esa fecha.`;
        banner.style.display = 'flex';
        return;
    }

    // Plan vence pronto (active)
    if (rs === 'active' && acc.planExpiryDate) {
        const days = Math.ceil((new Date(acc.planExpiryDate) - Date.now()) / 86400000);
        if (days <= 30) {
            banner.style.background = '#c2410c';
            bannerText.textContent = `Tu plan vence el ${formatDate(acc.planExpiryDate)}. Seleccioná un nuevo plan en Mi Plan.`;
            banner.style.display = 'flex';
            return;
        }
    }

    // Método de pago faltante (active) — sigue en período de prueba (20 usos compartidos)
    if (rs === 'active' && !acc.paymentProvider) {
        const used  = acc.usageCount ?? 0;
        const limit = acc.usageLimit ?? 20;
        // Acceso asignado por el equipo (cortesía): usage_limit en el centinela ilimitado.
        // No es un trial → no mostrar "X/999999 usos de prueba".
        if (limit >= 100000) {
            const planNm = (acc.plan && typeof acc.plan === 'object') ? (acc.plan.displayName || acc.plan.name) : acc.plan;
            banner.style.background = '#15803d';
            bannerText.textContent = `Tenés acceso asignado por el equipo${planNm ? ` (plan ${planNm})` : ''} — sin método de pago configurado.`;
            banner.style.display = 'flex';
            return;
        }
        const courtesy = acc.courtesyExtras || 0;
        const rem   = limit - used;
        const alerta = rem <= 5 ? ' 🔴' : '';
        const cortesiaTxt = courtesy > 0 ? ` (incluye +${courtesy} de cortesía)` : '';
        banner.style.background = '#b45309';
        bannerText.textContent = `Usás tus usos de prueba: ${used}/${limit}${cortesiaTxt} — configurá tu método de pago para acceder a los límites de tu plan${alerta}`;
        banner.style.display = 'flex';
        return;
    }

    // Cancelación programada (active, con cancel_at futuro): el usuario canceló pero sigue
    // con acceso hasta el fin del período pago. Se avisa en el banner superior (Mi Plan).
    if (rs === 'active' && acc.cancelAt && new Date(acc.cancelAt) > new Date()) {
        banner.style.background = '#b45309';
        bannerText.textContent = `Cancelación programada: tu suscripción se cancela el ${formatDate(acc.cancelAt)}. Seguís teniendo acceso hasta esa fecha. Podés reactivarla sin costo antes, en Facturación.`;
        banner.style.display = 'flex';
        return;
    }

    const cfg = configs[rs];
    if (cfg) {
        banner.style.background = cfg.color;
        bannerText.textContent = cfg.msg();
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

function updateSidebarForStatus() {
    const rs = state.account?.registrationStatus;
    // Mostrar sección reactivación solo si suspended_admin
    const reactivBtn = document.getElementById('nav-reactivacion');
    if (reactivBtn) {
        reactivBtn.style.display = rs === 'suspended_admin' ? '' : 'none';
    }
}

function renderTopbar() {
    const acc = state.account;
    if (!acc) return;

    document.getElementById('topbar-email').textContent = acc.email || '';
    document.getElementById('topbar-plan').textContent = acc.plan?.displayName || acc.plan?.name || 'Sin plan';
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function navigateTo(section, fromHistory) {
    state.currentSection = section;

    // Sidebar nav active
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.section === section);
    });

    // Sections visibility
    document.querySelectorAll('.section').forEach(el => {
        el.classList.toggle('active', el.id === `section-${section}`);
    });

    // Cerrar sidebar en mobile
    closeSidebarMobile();

    // Load section data
    switch (section) {
        case 'perfil': renderPerfil(); break;
        case 'plan': renderPlan(); break;
        case 'facturacion': renderFact(); break;
        case 'soporte': renderSoporte(); break;
        case 'notificaciones': renderNotificaciones(); break;
        case 'ia': renderIA(); break;
        case 'ayuda': renderAyuda(); break;
        case 'reactivacion': renderReactivacion(); break;
    }

    // Historial del navegador: que el botón Atrás vuelva a la sección anterior del
    // portal en vez de salir. NO se toca la URL (pushState con '' = misma URL) → sin
    // riesgo para el SSO (#sso=), que de todos modos ya se limpió antes de navegar.
    if (!fromHistory) {
        const navState = { _sec: section };
        if (history.state && history.state._sec) history.pushState(navState, '');
        else history.replaceState(navState, '');
    }
}

// Botón Atrás/Adelante del navegador → navegar entre secciones del portal (no salir)
window.addEventListener('popstate', (e) => {
    if (!state.token) return; // sin sesión: comportamiento normal del navegador
    const st = e.state;
    navigateTo((st && st._sec) || 'plan', true);
});

// ─── SIDEBAR MOBILE ───────────────────────────────────────────────────────────
function toggleSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
}

function closeSidebarMobile() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ─── SECTION: PERFIL ──────────────────────────────────────────────────────────
async function renderPerfil() {
    const acc = state.account;
    if (!acc) return;

    // Datos del usuario - intentar cargar datos extendidos
    try {
        const res = await apiFetch('/client/account');
        if (res && res.ok) {
            const data = await res.json();
            if (data.success) state.account = data.account;
        }
    } catch (_) {}

    const a = state.account;

    // Domicilio estructurado (mismo formato que el registro y el admin). Compat: si quedó
    // guardado como string de una versión vieja, lo ponemos en "calle".
    let dom = a.domicilio || {};
    if (typeof dom === 'string') { try { dom = JSON.parse(dom); } catch (_) { dom = {}; } }
    if (typeof dom === 'string') dom = { calle: dom };

    const fields = {
        'profile-email': a.email || '',
        'profile-nombre': a.nombre || '',
        'profile-apellido': a.apellido || '',
        'profile-cuit': a.cuit || '',
        'profile-telefono': a.telefono || '',
        'dom-calle': dom.calle || '',
        'dom-numero': dom.numero || '',
        'dom-piso': dom.piso || '',
        'dom-depto': dom.depto || '',
        'dom-localidad': dom.localidad || '',
        'dom-provincia': dom.provincia || '',
    };

    Object.entries(fields).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    });
}

async function saveProfile(e) {
    e.preventDefault();
    const alertEl = document.getElementById('profile-alert');
    const btn = document.getElementById('btn-save-profile');

    const nombre = document.getElementById('profile-nombre').value.trim();
    const apellido = document.getElementById('profile-apellido').value.trim();
    // El CUIT no es editable por el usuario (solo el admin) → no se envía.
    const telefono = document.getElementById('profile-telefono').value.trim();
    const domicilio = {
        calle:     document.getElementById('dom-calle').value.trim(),
        numero:    document.getElementById('dom-numero').value.trim(),
        piso:      document.getElementById('dom-piso').value.trim()  || undefined,
        depto:     document.getElementById('dom-depto').value.trim() || undefined,
        localidad: document.getElementById('dom-localidad').value.trim(),
        provincia: document.getElementById('dom-provincia').value.trim(),
    };

    if (!nombre || !apellido) {
        showAlert(alertEl, 'error', 'El nombre y apellido son obligatorios.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';

    try {
        const res = await apiFetch('/usuarios/api/profile', {
            method: 'PUT',
            body: { nombre, apellido, telefono, domicilio },
        });

        if (!res) return;
        const data = await res.json();

        if (!res.ok) {
            showAlert(alertEl, 'error', data.error || 'Error al guardar los datos.');
        } else {
            showAlert(alertEl, 'success', 'Datos actualizados correctamente.');
            if (data.user) {
                state.account = { ...state.account, ...data.user };
            }
        }
    } catch (e) {
        showAlert(alertEl, 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar cambios';
    }
}

// Indicador en vivo de coincidencia de contraseñas (igual que el formulario de registro)
function updatePwMatch() {
    const pwd  = document.getElementById('new-password').value;
    const conf = document.getElementById('confirm-password').value;
    const el   = document.getElementById('pw-match');
    if (!el) return;
    if (!conf) { el.style.display = 'none'; el.textContent = ''; el.className = 'pw-match'; return; }
    el.style.display = 'block';
    if (pwd === conf) { el.textContent = '✓ Las contraseñas coinciden';    el.className = 'pw-match ok'; }
    else              { el.textContent = '✗ Las contraseñas no coinciden'; el.className = 'pw-match bad'; }
}

async function savePassword(e) {
    e.preventDefault();
    const alertEl = document.getElementById('password-alert');
    const btn = document.getElementById('btn-save-password');

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showAlert(alertEl, 'error', 'Todos los campos de contraseña son obligatorios.');
        return;
    }

    if (newPassword.length < 8) {
        showAlert(alertEl, 'error', 'La nueva contraseña debe tener al menos 8 caracteres.');
        return;
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        showAlert(alertEl, 'error', 'La contraseña debe incluir al menos una letra y un número.');
        return;
    }

    if (newPassword !== confirmPassword) {
        showAlert(alertEl, 'error', 'Las contraseñas no coinciden.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Cambiando...';

    try {
        const res = await apiFetch('/usuarios/api/password', {
            method: 'PUT',
            body: { currentPassword, newPassword },
        });

        if (!res) return;
        const data = await res.json();

        if (!res.ok) {
            showAlert(alertEl, 'error', data.error || 'Error al cambiar la contraseña.');
        } else {
            showAlert(alertEl, 'success', 'Contraseña actualizada correctamente.');
            document.getElementById('password-form').reset();
            updatePwMatch();
        }
    } catch (e) {
        showAlert(alertEl, 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Cambiar contraseña';
    }
}

// ─── SECTION: PLAN ────────────────────────────────────────────────────────────
async function loadMonitorPartes() {
    try {
        const res = await apiFetch('/monitor/partes');
        if (!res || !res.ok) throw new Error('Error al cargar');
        const data = await res.json();
        renderMonitorPartes(data.partes || [], data.limite, data.usadas);
    } catch (e) {
        document.getElementById('monitor-partes-list').innerHTML =
            '<p style="color:var(--text-muted);font-size:13px">No se pudieron cargar las partes.</p>';
    }
}

function renderMonitorPartes(partes, limite, usadas) {
    const container = document.getElementById('monitor-partes-list');
    const countEl   = document.getElementById('monitor-partes-count');
    const lim       = limite === -1 ? '∞' : (limite ?? '-');
    if (countEl) countEl.textContent = `${usadas ?? partes.length} / ${lim}`;

    if (!partes.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">No hay partes monitoreadas.</p>';
        return;
    }
    container.innerHTML = partes.map(p => `
        <div class="parte-row" id="parte-row-${p.id}">
            <div class="parte-info">
                <span class="parte-nombre">${escapeHtml(p.nombre_parte)}</span>
                ${p.jurisdiccion_sigla ? `<span class="parte-juris">${escapeHtml(p.jurisdiccion_sigla)}</span>` : ''}
            </div>
            <button class="btn-icon-danger" onclick="deleteMonitorParte(${p.id}, '${escapeHtml(p.nombre_parte).replace(/'/g,"\\'")}')">🗑</button>
        </div>
    `).join('');
}

async function deleteMonitorParte(id, nombre) {
    if (!confirm(`¿Eliminar la parte "${nombre}" y todos sus expedientes asociados? Esta acción no se puede deshacer.`)) return;
    try {
        await apiFetch(`/monitor/partes/${id}`, { method: 'DELETE' });
        const row = document.getElementById(`parte-row-${id}`);
        if (row) row.remove();
        // Actualizar contador
        await loadMonitorPartes();
    } catch (e) {
        alert('Error al eliminar la parte. Intentá de nuevo.');
    }
}

function renderPlan() {
    const acc = state.account;
    if (!acc) return;

    const plan = acc.plan || {};
    const period = acc.period || {};
    const usage = acc.usage || {};
    const rs = acc.registrationStatus;

    // Status badge — use registrationStatus for v2.1 states
    const statusLabels = {
        pending_email: 'Email sin verificar',
        pending_activation: 'Período de prueba',
        active: 'Activo',
        suspended: 'Suspendido (pago)',
        suspended_admin: 'Suspendido por admin',
        suspended_plan_expired: 'Plan vencido',
        cancelled: 'Cancelado',
        rejected: 'Rechazado',
    };
    const statusBadgeMap = {
        active: 'badge-active',
        pending_email: 'badge-pending',
        pending_activation: 'badge-pending',
        suspended: 'badge-suspended',
        suspended_admin: 'badge-suspended',
        suspended_plan_expired: 'badge-suspended',
        cancelled: 'badge-cancelled',
        rejected: 'badge-cancelled',
    };

    // Info boxes
    document.getElementById('plan-name-display').textContent = plan.displayName || plan.name || 'Sin plan';
    document.getElementById('plan-status-badge').className = `badge ${statusBadgeMap[rs] || 'badge-suspended'}`;
    document.getElementById('plan-status-badge').textContent = statusLabels[rs] || rs || '-';

    // Plan expiry date (from subscriptions.plan_expiry_date, v2.1)
    if (acc.planExpiryDate) {
        const days = Math.ceil((new Date(acc.planExpiryDate) - Date.now()) / 86400000);
        const urgency = days <= 7 ? ' ⚠️' : days <= 30 ? ' ⏳' : '';
        document.getElementById('plan-expiry-display').textContent = `Plan vence: ${formatDate(acc.planExpiryDate)} (${days > 0 ? days + ' días' : 'vencido'})${urgency}`;
    } else {
        document.getElementById('plan-expiry-display').textContent = acc.expiresAt ? `Período: vence ${formatDate(acc.expiresAt)}` : 'Sin fecha de vencimiento de plan';
    }

    // Alert for suspended_plan_expired
    const planSection = document.getElementById('section-plan');
    let expiredAlert = document.getElementById('plan-expired-alert');
    if (rs === 'suspended_plan_expired') {
        if (!expiredAlert) {
            expiredAlert = document.createElement('div');
            expiredAlert.id = 'plan-expired-alert';
            expiredAlert.style.cssText = 'background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:14px 18px;margin-bottom:16px;color:#991b1b;font-size:14px';
            planSection.insertBefore(expiredAlert, planSection.querySelector('.plan-card-main'));
        }
        expiredAlert.innerHTML = `<strong>Tu plan venció.</strong> Seleccioná un nuevo plan para reactivar tu cuenta.
            <br><button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="openChangePlanModal()">Seleccionar plan</button>`;
    } else if (expiredAlert) {
        expiredAlert.remove();
    }

    // Trial info box — período de prueba (20 usos) mientras no haya método de pago.
    // Aplica a pending_activation (recién verificado el email) y a active sin pago (activado por admin).
    let trialBox = document.getElementById('trial-info-box');
    // Acceso ilimitado asignado por el equipo (usage_limit en el centinela) NO es trial.
    const inTrial = !acc.paymentProvider && (rs === 'pending_activation' || rs === 'active') && (acc.usageLimit ?? 20) < 100000;
    if (inTrial) {
        const trialUsed  = acc.usageCount ?? 0;
        const trialLimit = acc.usageLimit ?? 20;
        const trialRem   = Math.max(0, trialLimit - trialUsed);
        const pctTrial   = Math.min(100, Math.round((trialUsed / trialLimit) * 100));
        const barColor   = trialRem <= 5 ? '#dc2626' : trialRem <= 10 ? '#d97706' : '#16a34a';
        const subLabel   = rs === 'pending_activation'
            ? 'Tu cuenta está pendiente de activación por el administrador'
            : 'Configurá tu método de pago para acceder a los límites de tu plan';
        const exhausted  = trialRem <= 0;
        const courtesy   = acc.courtesyExtras || 0;
        const courtesyTag = courtesy > 0 ? ` <span style="font-size:12px;font-weight:700;color:#16a34a">(+${courtesy} de cortesía)</span>` : '';
        const lowMsg     = rs === 'pending_activation'
            ? (exhausted
                ? '🔴 Ya consumiste tus usos. Contactá al administrador para activar tu cuenta.'
                : '🔴 Quedan pocos usos. Contactá al administrador para activar tu cuenta.')
            : (exhausted
                ? '🔴 Ya consumiste tus usos. Configurá tu método de pago para seguir usando la app y la extensión.'
                : '🔴 Quedan pocos usos. Configurá tu método de pago para seguir usando la app y la extensión.');

        if (!trialBox) {
            trialBox = document.createElement('div');
            trialBox.id = 'trial-info-box';
            const planCard = planSection.querySelector('.plan-card-main') || planSection.firstElementChild;
            planSection.insertBefore(trialBox, planCard);
        }
        trialBox.innerHTML = `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin-bottom:16px">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
                    <div>
                        <span style="font-size:13px;font-weight:700;color:#92400e">⏳ Período de prueba</span>
                        <span style="font-size:12px;color:#78350f;margin-left:8px">${subLabel}</span>
                    </div>
                    <span style="font-size:20px;font-weight:800;color:${barColor}">${trialUsed} <span style="font-size:13px;font-weight:500;color:#92400e">/ ${trialLimit} usos utilizados</span>${courtesyTag}</span>
                </div>
                <div style="background:#fde68a;border-radius:4px;height:8px;overflow:hidden">
                    <div style="height:100%;width:${pctTrial}%;background:${barColor};border-radius:4px;transition:width .3s"></div>
                </div>
                ${trialRem <= 5 ? `<p style="margin:8px 0 0;font-size:12px;color:#991b1b;font-weight:600">${lowMsg}</p>` : ''}
            </div>`;
    } else if (trialBox) {
        trialBox.remove();
    }

    const daysRemaining = period.daysRemaining ?? 0;
    document.getElementById('plan-days-number').textContent = daysRemaining;

    // Progress bar (días restantes sobre 30)
    const periodDays = 30;
    const pct = Math.max(0, Math.min(100, (daysRemaining / periodDays) * 100));
    const fillEl = document.getElementById('plan-days-fill');
    fillEl.style.width = pct + '%';
    if (pct < 20) fillEl.style.background = 'var(--red)';
    else if (pct < 40) fillEl.style.background = 'var(--yellow)';
    else fillEl.style.background = '';

    // Usage table
    const rows = [
        { label: 'Procuración', key: 'proc' },
        { label: 'Procurar Batch', key: 'batch' },
        { label: 'Informes', key: 'informe' },
        { label: 'Monitor Novedades', key: 'monitor_novedades' },
        { label: 'Monitor Partes', key: 'monitor_partes' },
    ];

    const tbody = document.getElementById('usage-tbody');
    tbody.innerHTML = rows.map(({ label, key }) => {
        const u = usage[key] || {};
        const used = u.used ?? 0;
        const limit = u.limit;
        const unlimited = u.unlimited;
        const pct = unlimited || !limit ? (used > 0 ? 50 : 0) : Math.min(100, Math.round((used / limit) * 100));
        const fillClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : '';
        const limitTxt = unlimited ? '∞' : (limit !== null && limit !== undefined ? limit : '-');

        return `<tr>
            <td>${escapeHtml(label)}</td>
            <td><strong>${used}</strong> / ${limitTxt}</td>
            <td class="usage-bar-cell">
                <div class="usage-mini-bar">
                    <div class="usage-mini-fill ${fillClass}" style="width:${unlimited ? 0 : pct}%"></div>
                </div>
            </td>
        </tr>`;
    }).join('');

    loadMonitorPartes();
    renderDownloads();
}

function renderDownloads() {
    const acc = state.account;
    if (!acc) return;
    const container = document.getElementById('downloads-body');

    // Gap 1 — Ocultar descargas hasta verificar email
    if (!acc.emailVerified) {
        container.innerHTML = `
            <div style="padding:20px;text-align:center;color:#78350f;background:#fffbeb;border-radius:8px;border:1px solid #fde68a">
                <div style="font-size:28px;margin-bottom:8px">📧</div>
                <strong>Verificá tu email para acceder a las descargas</strong>
                <p style="margin:8px 0 0;font-size:13px;color:#92400e">
                    La extensión Chrome y la app Electron estarán disponibles una vez que confirmes tu dirección de email.
                </p>
            </div>`;
        return;
    }

    const planType = (acc.planType || '').toLowerCase();
    const planName = (acc.plan?.displayName || acc.plan?.name || '').toLowerCase();
    // La app de escritorio aplica a los planes que la incluyen: electron (BASIC/PRO/
    // ENTERPRISE) y combo (COMBO_PROMO). EXTENSION_PROMO (extension) no la incluye.
    const hasElectron = ['electron', 'combo'].includes(planType)
        || planType.includes('electron') || planName.includes('electron') || planName.includes('combo');

    const extensionItem = `
        <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#f9fafb">
            <div class="download-item" style="border:none;border-radius:0;margin:0">
                <div class="download-item-icon"><img src="/assets/brand-icon.png" alt="" style="width:38px;height:38px;border-radius:8px;display:block"></div>
                <div class="download-item-info">
                    <div class="download-item-title">Extensión Chrome — Procurador SCW</div>
                    <div class="download-item-desc">Completado automático de expedientes en SCW, Escritos, Notificaciones y DEOX</div>
                </div>
                <div class="download-item-actions">
                    <a class="btn btn-primary btn-sm"
                       href="https://chromewebstore.google.com/detail/procurador-scw-%E2%80%93-automati/aodnfemklhciagaglpggnclmbdhnhbme"
                       target="_blank" rel="noopener">🧩 Instalar desde Chrome Web Store</a>
                </div>
            </div>
            <div style="padding:8px 16px 10px;border-top:1px solid #fde68a;background:#fffbeb;font-size:11px;color:#92400e;line-height:1.5;">
                ⚠️ Al instalar, Chrome puede mostrar un aviso de precaución. Es normal para extensiones nuevas y no indica ningún riesgo. Hacé click en <strong>"Continuar a la instalación"</strong> para proceder.
            </div>
        </div>`;

    const electronItem = hasElectron ? `
        <div class="download-item">
            <div class="download-item-icon">⚖️</div>
            <div class="download-item-info">
                <div class="download-item-title">App de escritorio — Procurador SCW <span style="font-size:11px;color:#9ca3af;font-weight:400">Windows</span></div>
                <div class="download-item-desc">Procuración automática, informes y monitor de partes · v2.7.40</div>
            </div>
            <div class="download-item-actions">
                <button class="btn btn-primary btn-sm" onclick="downloadElectron(this)">⬇ Descargar instalador</button>
            </div>
        </div>` : '';

    container.innerHTML = `<div class="download-items">${extensionItem}${electronItem}</div>`;
}


async function downloadElectron(btn) {
    btn = btn || (typeof event !== 'undefined' ? event.currentTarget : null);
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Preparando...'; }
    try {
        // Pide un token de 1 solo uso (autenticado) y luego navega a la descarga
        // con el token en la query: la navegación del navegador no envía el header
        // Authorization, por eso no se puede linkear directo al endpoint protegido.
        const res = await apiFetch('/api/extension/electron-token');
        if (!res || !res.ok) throw new Error('No disponible');
        const { token } = await res.json();
        // Descarga directa — el navegador muestra su barra de progreso nativa
        window.location.href = `/api/extension/electron-download?token=${token}`;
        if (btn) { btn.textContent = original; setTimeout(() => { btn.disabled = false; }, 3000); }
    } catch (e) {
        alert(e.message || 'Error al descargar. Intentá de nuevo.');
        if (btn) { btn.disabled = false; btn.textContent = original; }
    }
}

async function openChangePlanModal() {
    const modal = document.getElementById('modal-plan');
    modal.classList.remove('hidden');

    // Cargar planes si no están
    if (state.plans.length === 0) {
        try {
            const res = await apiFetch('/usuarios/api/plans');
            if (res && res.ok) {
                const data = await res.json();
                state.plans = data.plans || [];
            }
        } catch (e) {
            console.error('Error cargando planes:', e);
        }
    }

    renderPlansModal();
}

function renderPlansModal() {
    const container = document.getElementById('plans-list');
    const acc = state.account;
    const currentPlan = acc?.plan?.name;
    const changesLeft = 2 - (acc?.planChangesThisCycle ?? 0);
    const rs = acc?.registrationStatus;
    const canChange = changesLeft > 0 || rs === 'suspended_plan_expired';

    if (!state.plans.length) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0">No hay planes disponibles en este momento.</p>';
        return;
    }

    // Cancelación programada: cambiar de plan es contradictorio. Primero hay que reactivar.
    if (acc?.cancelAt && new Date(acc.cancelAt) > new Date()) {
        container.innerHTML = `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;font-size:13px;color:#78350f;line-height:1.5">
            <strong>Tenés una cancelación programada</strong> — tu suscripción se da de baja el ${formatDate(acc.cancelAt)}.<br>
            Para cambiar de plan, primero <strong>reactivá tu suscripción</strong> en la sección <strong>Facturación</strong>.
        </div>`;
        return;
    }

    if (!canChange) {
        container.innerHTML = `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#78350f">
            <strong>Límite de cambios alcanzado</strong><br>
            Ya realizaste 2 cambios de plan en este ciclo. Podrás cambiar nuevamente en el próximo período.
        </div>`;
    } else if (changesLeft <= 1 && rs !== 'suspended_plan_expired') {
        container.innerHTML = `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#92400e">
            Te queda <strong>${changesLeft}</strong> cambio de plan en este ciclo.
        </div>`;
    } else {
        container.innerHTML = '';
    }

    // Aviso de cambio de plan (downgrade) programado para el próximo ciclo
    let scheduled = acc?.scheduledPlan;
    if (scheduled && typeof scheduled === 'string') { try { scheduled = JSON.parse(scheduled); } catch (_) { scheduled = null; } }
    if (scheduled && scheduled.plan) {
        const schedPlanObj = state.plans.find(p => p.name === scheduled.plan);
        const schedName = schedPlanObj?.displayName || scheduled.plan;
        const schedDate = scheduled.apply_at ? formatDate(scheduled.apply_at) : 'el próximo ciclo';
        container.innerHTML += `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1e40af;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <span>📅 <strong>Cambio de plan programado:</strong> tu plan pasará a <strong>${escapeHtml(schedName)}</strong> el ${schedDate}. Hasta entonces conservás tu plan actual.</span>
            <button class="btn btn-outline btn-sm" onclick="cancelScheduledPlan()" style="white-space:nowrap">Cancelar cambio</button>
        </div>`;
    }

    container.innerHTML += state.plans.map(p => {
        const isCurrent = p.name === currentPlan;
        const procLim = p.limits?.proc === -1 ? '∞' : (p.limits?.proc ?? '-');
        const infLim = p.limits?.informe === -1 ? '∞' : (p.limits?.informe ?? '-');
        const monLim = p.limits?.monitorNovedades === -1 ? '∞' : (p.limits?.monitorNovedades ?? '-');
        const batchLim = p.limits?.batch === -1 ? '∞' : (p.limits?.batch ?? '-');
        let price;
        if (p.priceArs) {
            price = `$${Number(p.priceArs).toLocaleString('es-AR')}/mes`;
        } else if (p.priceUsd) {
            price = `USD ${p.priceUsd}/mes`;
        } else {
            price = 'Gratis';
        }

        return `<div class="plan-option" style="${isCurrent ? 'border-color:var(--accent);background:var(--accent-light)' : ''}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                <div class="plan-option-name">${escapeHtml(p.displayName || p.name)}</div>
                ${isCurrent ? '<span class="badge badge-active">Plan actual</span>' : ''}
            </div>
            <div class="plan-option-price">${escapeHtml(price)}</div>
            <div class="plan-option-limits">
                <span>Procuración: ${procLim}</span>
                <span>Informes: ${infLim}</span>
                <span>Monitor: ${monLim}</span>
                <span>Batch: ${batchLim}</span>
            </div>
            ${!isCurrent && canChange ? `<div style="margin-top:10px">
                <button class="btn btn-primary btn-sm" onclick="changePlan('${escapeHtml(p.name)}')">Seleccionar este plan</button>
            </div>` : ''}
        </div>`;
    }).join('');
}

function closePlanModal() {
    document.getElementById('modal-plan').classList.add('hidden');
}

function openTicketForPlanUpgrade() {
    closePlanModal();
    navigateTo('soporte');
    setTimeout(() => openNewTicketModal('commercial'), 300);
}

// ─── SECTION: SOPORTE ─────────────────────────────────────────────────────────
async function renderSoporte() {
    // Reset ticket detail
    document.getElementById('ticket-detail-view').style.display = 'none';
    document.getElementById('ticket-list-view').style.display = 'block';

    await loadTickets();
}

async function loadTickets() {
    const container = document.getElementById('tickets-list-container');
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><span class="spinner" style="width:32px;height:32px;border-width:3px;color:var(--text-muted)"></span></div><p>Cargando tickets...</p></div>';

    try {
        const res = await apiFetch('/tickets');
        if (!res || !res.ok) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error al cargar los tickets.</p></div>';
            return;
        }

        const data = await res.json();
        state.tickets = data.tickets || [];
        renderTicketsList();
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error de conexión.</p></div>';
    }
}

function renderTicketsList() {
    const container = document.getElementById('tickets-list-container');

    if (!state.tickets.length) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-icon">🎫</div>
            <p>No tenés tickets de soporte aún.<br>Si tenés algún problema, abrí un ticket y te ayudamos.</p>
        </div>`;
        return;
    }

    const categoryLabels = {
        technical: 'Técnico',
        billing: 'Facturación',
        commercial: 'Comercial',
    };

    container.innerHTML = `<div class="tickets-list">
        ${state.tickets.map(t => {
            const statusClass = `badge badge-${t.status}`;
            const statusLabel = { open: 'Abierto', closed: 'Cerrado', in_progress: 'En progreso', resolved: 'Resuelto' }[t.status] || t.status;
            const catIcon = { technical: '🔧', billing: '💳', commercial: '📋' }[t.category] || '🎫';

            return `<div class="ticket-item" onclick="openTicketDetail(${t.id})">
                <div class="ticket-item-icon">${catIcon}</div>
                <div class="ticket-item-body">
                    <div class="ticket-item-title">${escapeHtml(t.title)}</div>
                    <div class="ticket-item-meta">
                        <span class="ticket-id-badge">#${t.id}</span>
                        <span>${categoryLabels[t.category] || t.category}</span>
                        <span>📅 ${formatDate(t.created_at)}</span>
                    </div>
                </div>
                <div class="ticket-item-status">
                    <span class="${statusClass}">${statusLabel}</span>
                </div>
            </div>`;
        }).join('')}
    </div>`;
}

async function openTicketDetail(ticketId) {
    document.getElementById('ticket-list-view').style.display = 'none';
    const detailView = document.getElementById('ticket-detail-view');
    detailView.style.display = 'block';

    document.getElementById('ticket-detail-content').innerHTML = '<div class="empty-state"><span class="spinner" style="width:32px;height:32px;border-width:3px;color:var(--text-muted)"></span></div>';

    try {
        const res = await apiFetch(`/tickets/${ticketId}`);
        if (!res || !res.ok) {
            document.getElementById('ticket-detail-content').innerHTML = '<div class="empty-state"><p>Error al cargar el ticket.</p></div>';
            return;
        }

        const data = await res.json();
        // API returns { ticket, comments } at top level
        const ticket = { ...data.ticket, comments: data.comments || [] };
        state.currentTicket = ticket;

        renderTicketDetail(ticket);
    } catch (e) {
        document.getElementById('ticket-detail-content').innerHTML = '<div class="empty-state"><p>Error de conexión.</p></div>';
    }
}

function renderTicketDetail(ticket) {
    const statusClass = `badge badge-${ticket.status}`;
    const statusLabel = { open: 'Abierto', closed: 'Cerrado', in_progress: 'En progreso', resolved: 'Resuelto' }[ticket.status] || ticket.status;
    const categoryLabels = { technical: 'Técnico', billing: 'Facturación', commercial: 'Comercial' };

    const comments = ticket.comments || [];

    const commentsHtml = comments.length
        ? comments.map(c => {
            const isUser = c.author_role === 'user';
            return `<div class="comment-item ${isUser ? 'user-comment' : 'agent-comment'}">
                <div class="comment-meta">${isUser ? '👤 Vos' : '🛠️ Soporte'} — ${formatDateTime(c.created_at)}</div>
                <div>${escapeHtml(c.message)}</div>
            </div>`;
        }).join('')
        : '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px 0">Sin comentarios aún.</p>';

    const canComment = ticket.status !== 'closed';

    document.getElementById('ticket-detail-content').innerHTML = `
        <div class="card" style="margin-bottom:20px">
            <div class="card-header">
                <div>
                    <h3><span class="ticket-id-badge" style="margin-right:8px;font-size:13px;vertical-align:middle">#${ticket.id}</span>${escapeHtml(ticket.title)}</h3>
                    <div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                        <span class="${statusClass}">${statusLabel}</span>
                        <span style="font-size:12px;color:var(--text-muted)">${categoryLabels[ticket.category] || ticket.category}</span>
                        <span style="font-size:12px;color:var(--text-muted)">📅 ${formatDate(ticket.created_at)}</span>
                    </div>
                </div>
            </div>
            <div class="card-body">
                <p style="font-size:14px;color:var(--text);white-space:pre-wrap;line-height:1.6">${escapeHtml(ticket.description)}</p>
            </div>
        </div>

        <div class="card">
            <div class="card-header"><h3>Historial de comentarios</h3></div>
            <div class="card-body">
                <div class="comments-list" id="comments-list">${commentsHtml}</div>
                ${canComment ? `
                <div style="border-top:1px solid var(--border);padding-top:16px">
                    <div id="comment-alert"></div>
                    <div class="form-group">
                        <label>Agregar comentario</label>
                        <textarea id="new-comment" placeholder="Escribí tu consulta o actualización..."></textarea>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="submitComment(${ticket.id})">Enviar comentario</button>
                </div>` : `<p style="font-size:13px;color:var(--text-muted);margin-top:8px">Este ticket está cerrado.</p>`}
            </div>
        </div>
    `;
}

async function submitComment(ticketId) {
    const alertEl = document.getElementById('comment-alert');
    const textarea = document.getElementById('new-comment');
    const content = textarea.value.trim();

    if (!content) {
        showAlert(alertEl, 'error', 'El comentario no puede estar vacío.');
        return;
    }

    try {
        const res = await apiFetch(`/tickets/${ticketId}/comment`, {
            method: 'POST',
            body: { message: content },
        });

        if (!res) return;
        const data = await res.json();

        if (!res.ok) {
            showAlert(alertEl, 'error', data.error || 'Error al enviar el comentario.');
        } else {
            textarea.value = '';
            // Reload ticket detail
            await openTicketDetail(ticketId);
        }
    } catch (e) {
        showAlert(alertEl, 'error', 'Error de conexión.');
    }
}

function backToTicketList() {
    document.getElementById('ticket-detail-view').style.display = 'none';
    document.getElementById('ticket-list-view').style.display = 'block';
    state.currentTicket = null;
}

function openNewTicketModal(presetCategory = null) {
    const modal = document.getElementById('modal-ticket');
    modal.classList.remove('hidden');
    document.getElementById('new-ticket-form').reset();
    document.getElementById('ticket-alert').className = 'alert';
    document.getElementById('ticket-alert').classList.remove('visible');

    if (presetCategory) {
        const catSelect = document.getElementById('ticket-category');
        // Try to set the value if option exists
        const options = Array.from(catSelect.options);
        const match = options.find(o => o.value === presetCategory);
        if (match) catSelect.value = presetCategory;
    }
}

function closeNewTicketModal() {
    document.getElementById('modal-ticket').classList.add('hidden');
}

async function submitNewTicket(e) {
    e.preventDefault();
    const alertEl = document.getElementById('ticket-alert');
    const btn = document.getElementById('btn-submit-ticket');

    const category = document.getElementById('ticket-category').value;
    const title = document.getElementById('ticket-title').value.trim();
    const description = document.getElementById('ticket-description').value.trim();

    if (!category || !title || !description) {
        showAlert(alertEl, 'error', 'Todos los campos son obligatorios.');
        return;
    }

    if (title.length > 200) {
        showAlert(alertEl, 'error', 'El título no puede superar 200 caracteres.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Enviando...';

    try {
        const res = await apiFetch('/tickets', {
            method: 'POST',
            body: { category, title, description },
        });

        if (!res) return;
        const data = await res.json();

        if (!res.ok) {
            showAlert(alertEl, 'error', data.error || 'Error al crear el ticket.');
        } else {
            closeNewTicketModal();
            await loadTickets();
        }
    } catch (e) {
        showAlert(alertEl, 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar ticket';
    }
}

// ─── CHANGE PLAN ─────────────────────────────────────────────────────────────
async function changePlan(planName) {
    // Plan vencido (suspended_plan_expired): reactivación por PAGO REAL del plan elegido,
    // no el cambio-stub gratis. Va al checkout de MercadoPago.
    if (state.account?.registrationStatus === 'suspended_plan_expired') {
        if (!(await showConfirm(`Vas a reactivar tu cuenta con el plan "${planName}". Te llevamos a MercadoPago para completar el pago.`))) return;
        closePlanModal();
        return initCheckout(planName);
    }
    if (!(await showConfirm(`¿Confirmar cambio al plan "${planName}"?`))) return;
    closePlanModal();
    try {
        const res = await apiFetch('/users/change-plan', {
            method: 'POST',
            body: { plan_name: planName },
        });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Error al cambiar el plan.', 'error');
        } else {
            showToast(data.message || 'Plan actualizado correctamente.', 'success');
            await loadAccount();
            renderPlan();
        }
    } catch (e) {
        showToast('Error de conexión. Intentá de nuevo.', 'error');
    }
}

async function cancelScheduledPlan() {
    if (!(await showConfirm('¿Cancelar el cambio de plan programado y seguir con tu plan actual?'))) return;
    try {
        const res = await apiFetch('/users/cancel-scheduled-plan', { method: 'POST' });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'No se pudo cancelar el cambio programado.', 'error');
        } else {
            showToast(data.message || 'Cambio de plan programado cancelado.', 'success');
            await loadAccount();
            renderPlan();
        }
    } catch (e) {
        showToast('Error de conexión. Intentá de nuevo.', 'error');
    }
}

// ─── SECTION: FACTURACIÓN ────────────────────────────────────────────────────
async function renderFact() {
    const acc = state.account;
    const container = document.getElementById('facturacion-content');
    if (!acc) return;

    const rs = acc.registrationStatus;

    // Skeleton mientras carga
    container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:32px;color:var(--text-muted)">Cargando...</div></div>`;

    // Cargar datos en paralelo
    let subData = null, payments = [], invoices = [];
    try {
        const [subRes, paymentsRes, invoicesRes] = await Promise.all([
            apiFetch('/usuarios/api/subscription/current'),
            apiFetch('/usuarios/api/payments?limit=12'),
            apiFetch('/usuarios/api/invoices?limit=12'),
        ]);
        if (subRes && subRes.ok) subData = await subRes.json();
        if (paymentsRes && paymentsRes.ok) { const d = await paymentsRes.json(); payments = d.payments || []; }
        if (invoicesRes && invoicesRes.ok) { const d = await invoicesRes.json(); invoices = d.invoices || []; }
    } catch (e) { /* continua con datos del state */ }

    const provider    = subData?.paymentProvider  || acc.paymentProvider;
    const hasMethod   = subData?.hasPaymentMethod || !!acc.paymentProvider;
    const nextBilling = subData?.nextBillingDate  || acc.nextBillingDate;
    const cancelAt    = subData?.cancelAt         || acc.cancelAt;
    const planRaw     = (acc.plan && typeof acc.plan === 'object') ? (acc.plan.displayName || acc.plan.name) : acc.plan;
    const planName    = subData?.planDisplayName  || planRaw || '';
    const planChanges = acc.planChangesThisCycle ?? 0;

    // Card: Método de pago
    // El trial todavía SIN activar por el admin tiene PRIORIDAD: aunque haya quedado
    // un payment_provider (p. ej. de pruebas), mientras la cuenta no esté activada no
    // se muestra "método configurado" ni se permite configurar/cambiar el pago.
    const isTrialNotActivated = (rs === 'pending_activation' || rs === 'pending_email');
    const isCancelledExpired = rs === 'cancelled';
    const isSuspendedPayment = rs === 'suspended' || (subData?.status === 'suspended' && subData?.paymentGraceEndsAt);
    // Período de gracia: el último pago fue rechazado pero la cuenta sigue activa hasta
    // que venza la gracia. Hay que avisar AHORA (no recién al suspender) para que el
    // usuario actualice el método de pago a tiempo.
    const graceEndsAt = subData?.paymentGraceEndsAt;
    const isInGrace = !isSuspendedPayment && graceEndsAt && new Date(graceEndsAt) > new Date();

    let paymentBody = '';

    if (isTrialNotActivated) {
        // Período de prueba sin activar — mensaje + botón deshabilitado (flujo oficial §4)
        paymentBody = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <p style="font-size:13px;color:var(--text-muted);margin:0">Tu cuenta está en período de prueba (<strong>${acc.usageCount ?? 0}/${acc.usageLimit ?? 20}</strong> usos). Vas a poder configurar tu método de pago una vez que el administrador active tu cuenta.</p>
                </div>
                <button class="btn btn-primary btn-sm" disabled style="white-space:nowrap;opacity:.5;cursor:not-allowed" title="Disponible cuando el administrador active tu cuenta">💳 Configurar método de pago</button>
            </div>`;
    } else if (isCancelledExpired) {
        // Suscripción vencida — permitir re-suscribirse desde cero
        paymentBody = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <p style="font-size:13px;color:var(--text-muted);margin:0">Tu suscripción expiró. Podés iniciar una nueva suscripción configurando un método de pago.</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="initCheckout()" style="white-space:nowrap">💳 Nueva suscripción</button>
            </div>`;
    } else if (isSuspendedPayment) {
        // Suspendido por pago fallido — pedir actualización de medio de pago
        paymentBody = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <p style="font-size:13px;color:#991b1b;margin:0;font-weight:500">⚠️ Pago rechazado. Actualizá tu método de pago para reactivar el acceso.</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="initCheckout()" style="white-space:nowrap;background:#991b1b;border-color:#991b1b">Actualizar método de pago</button>
            </div>`;
    } else if (isInGrace) {
        // Pago rechazado pero todavía en período de gracia — sigue activo, avisar a tiempo
        paymentBody = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <p style="font-size:13px;color:#b45309;margin:0;font-weight:500">⚠️ Tu último pago fue rechazado. Actualizá tu método de pago antes del <strong>${formatDate(graceEndsAt)}</strong> o tu cuenta se suspenderá. Seguís teniendo acceso hasta esa fecha.</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="initCheckout()" style="white-space:nowrap;background:#b45309;border-color:#b45309">Actualizar método de pago</button>
            </div>`;
    } else if (!hasMethod && (acc.usageLimit ?? 20) >= 100000) {
        // Acceso ilimitado asignado por el equipo (cortesía), sin método de pago — no es trial.
        paymentBody = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <p style="font-size:13px;color:var(--text-muted);margin:0">Tenés acceso asignado por el equipo${planName ? ` (plan <strong>${escapeHtml(planName)}</strong>)` : ''}, sin método de pago configurado. Podés configurar un método de pago cuando quieras.</p>
                </div>
                <button class="btn btn-outline btn-sm" onclick="initCheckout()" style="white-space:nowrap">💳 Configurar método de pago</button>
            </div>`;
    } else if (!hasMethod) {
        // Activado por el admin (rs='active'), sin método configurado — habilitar pago
        // (los estados de trial sin activar ya se capturaron arriba en isTrialNotActivated)
        paymentBody = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <p style="font-size:13px;color:var(--text-muted);margin:0">No tenés un método de pago configurado. Estás usando tus usos de prueba: <strong>${acc.usageCount ?? 0}/${acc.usageLimit ?? 20}</strong>. Al configurar el pago se te asignan los límites de tu plan y el contador arranca limpio.</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="initCheckout()" style="white-space:nowrap">💳 Configurar método de pago</button>
            </div>`;
    } else {
        // Método configurado
        paymentBody = `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
                <div>
                    <span class="badge badge-active" style="font-size:12px">${escapeHtml(provider || 'MercadoPago')}</span>
                    <span style="font-size:12px;color:var(--text-muted);margin-left:8px">
                        ${cancelAt ? 'Sin renovación automática' : 'Cobro automático activo'}
                    </span>
                </div>
                <button class="btn btn-outline btn-sm" onclick="initCheckout()">Cambiar método</button>
            </div>`;
    }

    // (El cartel "Bonus de bienvenida +20 usos" se eliminó: era del modelo viejo.
    //  Hoy el primer pago asigna los límites del plan por submódulo, sin usos extra;
    //  trial_bonus_until solo marca que el primer pago ya se aplicó.)

    // Cancelación programada + botón reactivar.
    // Reactivar = reanudar el preapproval pausado en MP (sin nuevo cobro; el próximo
    // débito cae en la fecha original). Si MP no lo puede reanudar, el backend responde
    // action:'checkout' y se ofrece re-suscribirse con un método de pago nuevo.
    if (cancelAt) {
        paymentBody += `
            <div style="margin-top:14px;padding:12px 14px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;font-size:13px;color:#991b1b;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                <span><strong>Cancelación programada:</strong> tu suscripción se cancela el ${formatDate(cancelAt)}. Seguís teniendo acceso hasta esa fecha. Podés reactivarla sin costo adicional antes de esa fecha.</span>
                <button class="btn btn-outline btn-sm" onclick="confirmReactivateSubscription()" style="white-space:nowrap;border-color:#991b1b;color:#991b1b;background:#fff">↩ Reactivar suscripción</button>
            </div>`;
    }

    const paymentMethodCard = `
        <div class="card">
            <div class="card-header"><h3>Método de pago</h3></div>
            <div class="card-body">${paymentBody}</div>
        </div>`;

    // Card: Resumen de suscripción
    const subscriptionCard = `
        <div class="card">
            <div class="card-header"><h3>Suscripción</h3></div>
            <div class="card-body">
                <div style="display:grid;gap:0">
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
                        <span style="font-size:13px;color:var(--text-muted)">Plan actual</span>
                        <span style="font-size:13px;font-weight:600">${escapeHtml(planName || '—')}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
                        <span style="font-size:13px;color:var(--text-muted)">Próxima renovación</span>
                        <span style="font-size:13px;font-weight:500">${nextBilling ? formatDate(nextBilling) : '<span style="color:var(--text-muted)">No disponible</span>'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
                        <span style="font-size:13px;color:var(--text-muted)">Cambios de plan este ciclo</span>
                        <span style="font-size:13px;font-weight:500">${planChanges} / 2</span>
                    </div>
                </div>
                ${rs === 'active' && !cancelAt && hasMethod ? `
                    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
                        <button class="btn btn-outline btn-sm" style="color:#991b1b;border-color:#fca5a5" onclick="confirmCancelSubscription()">Cancelar suscripción</button>
                        <p style="font-size:11px;color:var(--text-muted);margin-top:6px">La cancelación es efectiva al finalizar el período actual.</p>
                    </div>` : ''}
            </div>
        </div>`;

    // Card: Historial de pagos
    const statusBadge = s => ({ approved:'<span class="badge badge-active" style="font-size:11px">Aprobado</span>', rejected:'<span class="badge badge-error" style="font-size:11px">Rechazado</span>', refunded:'<span class="badge badge-warning" style="font-size:11px">Reembolsado</span>', pending:'<span class="badge badge-warning" style="font-size:11px">Pendiente</span>' }[s] || '—');

    const paymentsRows = payments.length === 0
        ? `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">Sin pagos registrados aún</td></tr>`
        : payments.map(p => `<tr>
            <td style="font-size:13px;padding:8px 6px 8px 20px">${formatDate(p.created_at)}</td>
            <td style="font-size:13px;padding:8px 6px;font-weight:500">$${Number(p.amount).toLocaleString('es-AR')} ${p.currency||'ARS'}</td>
            <td style="padding:8px 6px">${statusBadge(p.status)}</td>
            <td style="font-size:12px;padding:8px 20px 8px 6px;color:var(--text-muted)">${escapeHtml(p.plan||'—')}</td>
          </tr>`).join('');

    const paymentsCard = `
        <div class="card">
            <div class="card-header"><h3>Historial de pagos</h3></div>
            <div class="card-body" style="padding:0">
                <table style="width:100%;border-collapse:collapse">
                    <thead><tr style="border-bottom:1px solid var(--border)">
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px 10px 20px;font-weight:500">Fecha</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px;font-weight:500">Monto</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px;font-weight:500">Estado</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 20px 10px 6px;font-weight:500">Plan</th>
                    </tr></thead>
                    <tbody>${paymentsRows}</tbody>
                </table>
            </div>
        </div>`;

    // Card: Historial de facturas
    const invoicesRows = invoices.length === 0
        ? `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">Sin facturas emitidas aún</td></tr>`
        : invoices.map(inv => {
            const tipo = inv.invoice_type ? `Factura ${escapeHtml(inv.invoice_type)}` : '—';
            return `<tr>
                <td style="font-size:13px;padding:8px 6px 8px 20px">${inv.issued_at ? formatDate(inv.issued_at) : formatDate(inv.created_at)}</td>
                <td style="font-size:13px;padding:8px 6px">${tipo}</td>
                <td style="font-size:13px;padding:8px 6px;font-weight:500">${inv.numero ? escapeHtml(inv.numero) : '—'}</td>
                <td style="font-size:13px;padding:8px 6px">$${inv.amount ? Number(inv.amount).toLocaleString('es-AR') : '—'}</td>
                <td style="font-size:11px;padding:8px 6px;color:var(--text-muted);font-family:monospace">${inv.cae ? escapeHtml(inv.cae) : '—'}</td>
                <td style="padding:8px 20px 8px 6px">${inv.pdf_url
                    ? `<a href="${escapeHtml(inv.pdf_url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 10px">Ver PDF</a>`
                    : `<span style="font-size:12px;color:var(--text-muted)">${inv.status==='pending'?'Emitiendo…':inv.status==='failed'?'Error':'—'}</span>`}</td>
            </tr>`;
        }).join('');

    const invoicesCard = `
        <div class="card">
            <div class="card-header"><h3>Facturas</h3></div>
            <div class="card-body" style="padding:0">
                <table style="width:100%;border-collapse:collapse">
                    <thead><tr style="border-bottom:1px solid var(--border)">
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px 10px 20px;font-weight:500">Fecha</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px;font-weight:500">Tipo</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px;font-weight:500">Número</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px;font-weight:500">Monto</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 6px;font-weight:500">CAE</th>
                        <th style="text-align:left;font-size:12px;color:var(--text-muted);padding:10px 20px 10px 6px;font-weight:500">PDF</th>
                    </tr></thead>
                    <tbody>${invoicesRows}</tbody>
                </table>
            </div>
        </div>`;

    container.innerHTML = paymentMethodCard + subscriptionCard + paymentsCard + invoicesCard;
}

// Inicia el checkout MP para configurar tarjeta
async function initCheckout(planName) {
    const acc = state.account;
    if (!acc) return;
    // planName opcional: en la reactivación de un plan vencido el usuario elige un plan
    // nuevo; en el resto se usa el plan actual de la cuenta.
    const targetPlan = planName || acc.plan?.name || acc.plan;

    try {
        const res = await apiFetch('/usuarios/api/checkout/init', {
            method: 'POST',
            body: JSON.stringify({ plan_name: targetPlan }),
        });
        if (!res) return;
        if (res.status === 503) {
            showToast('El módulo de pagos estará disponible muy pronto. Por ahora podés contactar soporte para gestionar tu suscripción.', 'info');
            return;
        }
        if (!res.ok) {
            const d = await res.json();
            showToast(d.error || 'Error al iniciar el proceso de pago.', 'error');
            return;
        }
        const data = await res.json();
        if (data.init_point) {
            // Guardar flag ANTES de navegar para que al volver (con o sin ?pago=ok)
            // el portal sepa que el usuario pasó por el checkout de MP.
            // Válido 30 minutos — cubre el tiempo normal de completar una suscripción.
            localStorage.setItem('psc_checkout_pending', JSON.stringify({
                plan: targetPlan,
                initiated: Date.now()
            }));
            window.location.href = data.init_point;
        }
    } catch (e) {
        showToast('Error de conexión. Intentá de nuevo más tarde.', 'error');
    }
}

async function confirmCancelSubscription() {
    if (!(await showConfirm('¿Cancelar tu suscripción? La cancelación será efectiva al finalizar el período actual y no se te cobrará más.'))) return;
    try {
        const res = await apiFetch('/usuarios/api/checkout/cancel', { method: 'POST' });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Error al cancelar la suscripción.', 'error');
        } else {
            showToast('Suscripción cancelada. Seguirás teniendo acceso hasta el fin del período.', 'success');
            await loadAccount();
            renderFact();
        }
    } catch (e) {
        showToast('Error de conexión. Intentá de nuevo.', 'error');
    }
}

// Reactivar = reanudar el preapproval pausado en MP (sin nuevo cobro). Si MP no lo
// puede reanudar (caso de borde), el backend responde action:'checkout' y se ofrece
// re-suscribirse con un método de pago nuevo.
async function confirmReactivateSubscription() {
    if (!(await showConfirm('¿Reactivar tu suscripción? Se reanuda el cobro automático en la fecha de renovación habitual. No se genera un cobro nuevo ahora.'))) return;
    try {
        const res = await apiFetch('/usuarios/api/checkout/reactivate', { method: 'POST' });
        if (!res) return;
        const data = await res.json();
        if (res.ok) {
            showToast('✅ Suscripción reactivada. No se generó ningún cobro nuevo; el próximo débito será en tu fecha de renovación habitual.', 'success');
            await loadAccount();
            renderFact();
        } else if (data.action === 'checkout') {
            // No se pudo reanudar (cancelación terminal, ej. hecha desde MercadoPago) →
            // nueva suscripción con free_trial = días ya pagados (el primer cobro cae en
            // el vencimiento original, sin doble cobro).
            const proceed = await showConfirm((data.error || 'No se pudo reanudar automáticamente.') + '\n\nVamos a generar un método de pago nuevo. MercadoPago mostrará unos "días gratis": corresponden a los días que ya tenías pagados de tu período actual. No se te cobrará ahora; el primer débito será recién en tu fecha de vencimiento actual. ¿Continuar?');
            if (proceed) {
                try {
                    const r2 = await apiFetch('/usuarios/api/checkout/reactivate-init', { method: 'POST' });
                    const d2 = r2 ? await r2.json() : null;
                    if (r2 && r2.ok && d2.init_point) {
                        localStorage.setItem('psc_checkout_pending', JSON.stringify({ initiated: Date.now() }));
                        window.location.href = d2.init_point;
                    } else {
                        showToast((d2 && d2.error) || 'No se pudo iniciar la reactivación.', 'error');
                    }
                } catch (_) {
                    showToast('Error de conexión. Intentá de nuevo.', 'error');
                }
            }
        } else {
            showToast(data.error || 'No se pudo reactivar la suscripción.', 'error');
        }
    } catch (e) {
        showToast('Error de conexión. Intentá de nuevo.', 'error');
    }
}

// ─── SECTION: REACTIVACIÓN ───────────────────────────────────────────────────
async function renderReactivacion() {
    const acc = state.account;
    const container = document.getElementById('reactivacion-content');
    if (!acc) return;

    const rs = acc.registrationStatus;
    if (rs !== 'suspended_admin') {
        container.innerHTML = `<div class="card"><div class="card-body">
            <p style="color:var(--text-muted);text-align:center;padding:20px 0">Esta sección no está disponible para tu estado de cuenta actual.</p>
        </div></div>`;
        return;
    }

    const req = acc.reactivationRequest;
    const suspensionReason = acc.suspensionReason || 'No se indicó un motivo específico.';
    const suspendedAt = acc.suspendedAt ? formatDate(acc.suspendedAt) : '-';

    let reqHtml = '';
    if (!req || req.status === 'rejected') {
        const prevRejected = req && req.status === 'rejected';
        reqHtml = `
            <div id="react-form-wrap">
                ${prevRejected ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#991b1b">
                    Tu solicitud anterior fue rechazada. Podés enviar una nueva.
                </div>` : ''}
                <div class="form-group">
                    <label for="react-message">Mensaje para el administrador <span style="color:var(--text-muted);font-size:12px">(opcional)</span></label>
                    <textarea id="react-message" rows="4" placeholder="Explicá brevemente por qué creés que tu cuenta debería ser reactivada..."></textarea>
                </div>
                <div id="react-alert"></div>
                <button class="btn btn-primary" id="btn-send-react" onclick="submitReactivacionRequest()">Enviar solicitud de reactivación</button>
            </div>`;
    } else if (req.status === 'pending') {
        reqHtml = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 18px;color:#166534">
            <strong>✅ Solicitud enviada</strong><br>
            Tu solicitud fue enviada el ${formatDateTime(req.sent_at)}. El equipo de soporte la revisará a la brevedad.<br>
            <span style="font-size:12px;color:#15803d;margin-top:4px;display:block">Solo podés enviar una solicitud por suspensión.</span>
        </div>`;
    } else if (req.status === 'approved') {
        reqHtml = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 18px;color:#166534">
            <strong>✅ Solicitud aprobada</strong> — Tu cuenta fue reactivada.
        </div>`;
    }

    container.innerHTML = `
        <div class="card">
            <div class="card-header"><h3>Motivo de suspensión</h3></div>
            <div class="card-body">
                <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap">
                    <div><span style="font-size:12px;color:var(--text-muted)">Fecha</span><br><strong>${suspendedAt}</strong></div>
                </div>
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px;font-size:14px;color:#7c2d12">
                    ${escapeHtml(suspensionReason)}
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Solicitud de revisión</h3></div>
            <div class="card-body">${reqHtml}</div>
        </div>`;
}

async function submitReactivacionRequest() {
    const btn = document.getElementById('btn-send-react');
    const alertEl = document.getElementById('react-alert');
    const message = document.getElementById('react-message')?.value?.trim() || '';

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Enviando...';

    try {
        const res = await apiFetch('/users/reactivation-request', {
            method: 'POST',
            body: { message },
        });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            alertEl.className = 'alert alert-error visible';
            alertEl.innerHTML = `<span>❌</span> ${escapeHtml(data.error || 'Error al enviar la solicitud.')}`;
            btn.disabled = false;
            btn.textContent = 'Enviar solicitud de reactivación';
        } else {
            await loadAccount();
            renderReactivacion();
        }
    } catch (e) {
        alertEl.className = 'alert alert-error visible';
        alertEl.innerHTML = '<span>❌</span> Error de conexión. Intentá de nuevo.';
        btn.disabled = false;
        btn.textContent = 'Enviar solicitud de reactivación';
    }
}

// ─── SECTION: AYUDA ──────────────────────────────────────────────────────────

const AYUDA_FAQ_ITEMS = [
    // --- PROCURACIÓN ---
    { cat: 'procuracion', q: '¿Cómo procuro mis expedientes?', a: 'Hacé click en "Procurar" en el sidebar o en el botón ▶ Procurar. El sistema accede automáticamente al SCW del PJN con tus credenciales guardadas en Chrome.' },
    { cat: 'procuracion', q: '¿Puedo procurar solo algunos expedientes?', a: 'Sí. En la sección Procuración podés seleccionar expedientes individuales antes de ejecutar, o usar "Procurar seleccionados" para procurar un subconjunto.' },
    { cat: 'procuracion', q: '¿Cuánto tarda la procuración?', a: 'Depende de la cantidad de expedientes y la velocidad del PJN. Con conexión normal, cada expediente tarda entre 5 y 15 segundos.' },
    { cat: 'procuracion', q: '¿Puedo usar la computadora mientras procura?', a: 'Sí, pero evitá usar Chrome durante la ejecución. El sistema opera Chrome en segundo plano; interrumpirlo puede causar errores.' },
    { cat: 'procuracion', q: '¿Puedo procurar con fecha personalizada?', a: 'Sí. Usá el botón "Procurar con fecha…" para seleccionar un rango de fechas distinto al predeterminado.' },
    { cat: 'procuracion', q: '¿Qué significa la fecha límite de procuración?', a: 'Es la fecha hasta la cual se buscan expedientes para agregar al informe de procuración. Para confirmar que se consultó hasta el límite, por cada sección incluida en la procuración (letrado, parte, autorizado, favoritos) vas a ver al menos 1 expediente con fecha anterior a la fecha límite: eso indica que se revisó hasta el último expediente que cumple la condición de la fecha y se verificó el expediente inmediato anterior a esa fecha para la sección consultada.' },
    // --- INFORME ---
    { cat: 'informe', q: '¿Cómo genero un informe?', a: 'Click en "Informe" en el sidebar. Podés procesar un expediente individual ingresando el número o un lote cargando un archivo Excel con la lista.' },
    { cat: 'informe', q: '¿Qué formato debe tener el Excel para informe en lote?', a: 'Una columna con encabezado "expediente" y los números en el formato estándar del PJN (ej: 12345/2023). Descargá la plantilla desde la sección Informe.' },
    { cat: 'informe', q: '¿El informe genera un PDF?', a: 'El informe genera un archivo Excel con el estado de cada expediente. El PDF de cada movimiento se descarga por separado si el sistema lo detecta disponible.' },
    { cat: 'informe', q: '¿Puedo detener un informe a mitad?', a: 'Sí, con el botón "Detener". Los expedientes ya procesados se guardan; el informe quedará parcial hasta ese punto.' },
    // --- MONITOR ---
    { cat: 'monitor', q: '¿Qué es el Monitor de partes?', a: 'Controlá automáticamente si aparecen nuevos expedientes vinculados a determinadas partes (personas o empresas). Configurá las partes en la sección Monitor.' },
    { cat: 'monitor', q: '¿Cómo agrego una parte al monitor?', a: 'En la sección Monitor, hacé click en "+ Agregar parte", ingresá el nombre o CUIT/CUIL y guardá. El sistema buscará expedientes vinculados en cada ejecución.' },
    { cat: 'monitor', q: '¿Con qué frecuencia se actualiza el monitor?', a: 'El monitor se actualiza cada vez que ejecutás la sección Monitor manualmente, o si configuraste una frecuencia automática en Configuración.' },
    { cat: 'monitor', q: '¿Cuántas partes puedo monitorear?', a: 'Depende de tu plan: COMBO_PROMO permite 3 partes activas, PRO permite 10, ENTERPRISE ilimitadas.' },
    // --- EXTENSIÓN ---
    { cat: 'extension', q: '¿Cómo instalo la extensión de Chrome?', a: 'Buscá "Procurador SCW" en la Chrome Web Store o pedile el enlace directo al soporte. Hacé click en "Agregar a Chrome" y aceptá los permisos.' },
    { cat: 'extension', q: '¿Cómo actualizo la extensión?', a: 'La extensión se actualiza automáticamente desde la Chrome Web Store. También podés ir a chrome://extensions y hacer click en el ícono de actualizar.' },
    { cat: 'extension', q: '¿Para qué sirve la extensión?', a: 'La extensión autocompleta el número de expediente (jurisdicción, número y año) en los módulos del PJN: SCW, Escritos, Notificaciones y DEOX, evitando la escritura manual.' },
    { cat: 'extension', q: '¿La extensión funciona sin la app Electron?', a: 'Sí. Con el plan EXTENSION_PROMO tenés acceso solo a la extensión sin necesitar instalar la app de escritorio.' },
    { cat: 'extension', q: '¿Chrome muestra un aviso al instalar la extensión?', a: 'Es normal para extensiones nuevas. Hacé click en "Continuar a la instalación". No indica ningún riesgo — la extensión está aprobada por Google.' },
    { cat: 'extension', q: 'En el flujo de Escritos 1, ¿por qué Chrome me pide permiso para abrir ventanas o pestañas?', a: 'En Escritos 1 el sitio del PJN abre una ventana/pestaña nueva para continuar con la presentación. Es probable que Chrome muestre un aviso de "ventanas emergentes bloqueadas" o pida permiso. Hacé click en "Permitir" (o tocá el ícono que aparece en la barra de direcciones y elegí "Permitir siempre" para sso/escritos.pjn.gov.ar) para que la extensión pueda completar el expediente y abrir la pestaña correctamente.' },
    // --- CUENTA Y PLAN ---
    { cat: 'cuenta', q: '¿Cómo cambio de plan?', a: 'Ingresá a "Mi Plan" en el panel lateral y hacé click en "Ver planes disponibles". Los cambios se aplican de inmediato o al inicio del próximo ciclo.' },
    { cat: 'cuenta', q: '¿Puedo usar la app en más de una computadora?', a: 'No. La licencia está vinculada a un dispositivo. Para cambiar de equipo, contactá al soporte.' },
    { cat: 'cuenta', q: '¿Cómo cancelo mi suscripción?', a: 'En la sección "Facturación" de este portal, hacé click en "Cancelar suscripción". Conservás el acceso hasta fin del período pago.' },
    { cat: 'cuenta', q: '¿Dónde veo cuántas ejecuciones me quedan?', a: 'En la sección "Mi Plan" de este portal o en la sección "Mi Cuenta" de la app Electron.' },
    { cat: 'cuenta', q: '¿Qué es el período de prueba y qué pasa cuando se agota?', a: 'Al verificar tu email recibís 20 usos de prueba para la app y la extensión de Chrome habilitada. Esos 20 usos rigen hasta que configures tu método de pago. Al agotarlos, la app deja de ejecutar y la extensión también se bloquea (la extensión funciona mientras te queden usos de prueba). Para continuar, configurá tu método de pago: se te asignan los límites de tu plan y el contador arranca limpio (se eliminan los 20 del trial).' },
    // --- ERRORES FRECUENTES ---
    { cat: 'errores', q: '¿Qué significa que el login al PJN falló?', a: 'El sistema no pudo ingresar al SCW. Verificá que Chrome tenga guardada la contraseña (botón "Agregar contraseña SCW" en la app). Si la contraseña del PJN cambió, actualizala en Chrome primero.' },
    { cat: 'errores', q: '¿Por qué se colgó el proceso?', a: 'Podés detenerlo con el botón "Detener". Si se repite, revisá que Chrome no tenga otras pestañas abiertas del PJN bloqueando el acceso y que tu sesión PJN esté vigente.' },
    { cat: 'errores', q: '¿Por qué dice "proceso activo en otro dispositivo"?', a: 'El sistema tiene un candado anti-concurrencia. Asegurate de no tener otra instancia de la app abierta. Si el error persiste después de cerrar todo, esperá 2 minutos y reintentá.' },
    { cat: 'errores', q: '¿Dónde están los archivos descargados?', a: 'En la carpeta configurada en Configuración > General > Carpeta de descargas. También podés acceder desde "Abrir descargas" en el sidebar.' },
    { cat: 'errores', q: '¿Necesito dejar Chrome abierto?', a: 'No. El sistema abre y cierra Chrome automáticamente en segundo plano. No interferís con el proceso salvo que abras ventanas del PJN manualmente.' },
    { cat: 'errores', q: '¿Qué hago si la app no arranca?', a: 'Cerrá Chrome completamente si estaba abierto, esperá 10 segundos y volvé a abrir la app. Si el problema persiste, usá el botón de soporte para abrir un ticket.' },
    // --- PRIVACIDAD Y SEGURIDAD ---
    { cat: 'privacidad', q: '¿Mis credenciales del PJN pasan por sus servidores?', a: 'No. Las contraseñas del PJN se almacenan exclusivamente en el gestor de contraseñas de tu Chrome y nunca salen de tu equipo. Procurador solo coordina la automatización.' },
    { cat: 'privacidad', q: '¿Cómo se protegen mis datos?', a: 'Los scripts de automatización están cifrados con AES-256 y se firman digitalmente. La comunicación con el servidor usa HTTPS/TLS. Tu sesión se valida con token JWT de corta duración.' },
    { cat: 'privacidad', q: '¿Procurador guarda mis expedientes?', a: 'No se almacena el contenido de los expedientes en los servidores. Los archivos de resultado (Excel, PDF) quedan únicamente en tu equipo.' },
    { cat: 'privacidad', q: '¿Puedo eliminar mi cuenta?', a: 'Sí. Cancelá tu suscripción desde el portal web y luego contactá al soporte solicitando la eliminación completa de datos. Cumplimos con las normativas de protección de datos.' },
];

const AYUDA_FAQ_CATS = [
    { id: 'todas',       label: 'Todas' },
    { id: 'procuracion', label: 'Procuración' },
    { id: 'informe',     label: 'Informe' },
    { id: 'monitor',     label: 'Monitor' },
    { id: 'extension',   label: 'Extensión' },
    { id: 'cuenta',      label: 'Cuenta' },
    { id: 'errores',     label: 'Errores' },
    { id: 'privacidad',  label: 'Privacidad' },
];

let ayudaActiveCat = 'todas';
let ayudaManualOpen = false;

function renderAyuda() {
    // --- Pills ---
    const pillsEl = document.getElementById('ayuda-pills');
    if (pillsEl && !pillsEl.dataset.initialized) {
        pillsEl.dataset.initialized = '1';
        pillsEl.innerHTML = AYUDA_FAQ_CATS.map(c =>
            `<button class="ayuda-pill${c.id === 'todas' ? ' active' : ''}" data-cat="${c.id}">${escapeHtml(c.label)}</button>`
        ).join('');
        pillsEl.querySelectorAll('.ayuda-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                ayudaActiveCat = btn.dataset.cat;
                pillsEl.querySelectorAll('.ayuda-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderAyudaFaq(document.getElementById('ayuda-search')?.value || '');
            });
        });
    }

    // --- Search ---
    const searchEl = document.getElementById('ayuda-search');
    if (searchEl && !searchEl.dataset.initialized) {
        searchEl.dataset.initialized = '1';
        searchEl.addEventListener('input', () => renderAyudaFaq(searchEl.value));
    }

    // --- Manual toggle ---
    const toggleEl = document.getElementById('ayuda-manual-toggle');
    const manualBody = document.getElementById('ayuda-manual-body');
    const manualBtn = document.getElementById('ayuda-manual-btn');
    if (toggleEl && !toggleEl.dataset.initialized) {
        toggleEl.dataset.initialized = '1';
        toggleEl.addEventListener('click', () => {
            ayudaManualOpen = !ayudaManualOpen;
            manualBody.style.display = ayudaManualOpen ? 'block' : 'none';
            manualBtn.textContent = ayudaManualOpen ? 'Ocultar manual' : 'Ver manual';
            if (ayudaManualOpen) {
                document.getElementById('ayuda-manual-content').innerHTML = getManualHTML();
            }
        });
    }

    // Render FAQ with current state
    renderAyudaFaq(searchEl?.value || '');

    // Restore manual state
    if (manualBody) {
        manualBody.style.display = ayudaManualOpen ? 'block' : 'none';
        if (manualBtn) manualBtn.textContent = ayudaManualOpen ? 'Ocultar manual' : 'Ver manual';
        if (ayudaManualOpen) {
            document.getElementById('ayuda-manual-content').innerHTML = getManualHTML();
        }
    }
}

function renderAyudaFaq(filter) {
    const faqEl = document.getElementById('ayuda-faq-list');
    if (!faqEl) return;
    const q = (filter || '').toLowerCase().trim();
    let items = ayudaActiveCat === 'todas' ? AYUDA_FAQ_ITEMS : AYUDA_FAQ_ITEMS.filter(f => f.cat === ayudaActiveCat);
    if (q) items = items.filter(f => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));

    if (!items.length) {
        faqEl.innerHTML = '<p class="ayuda-empty">Sin resultados. Intentá con otras palabras.</p>';
        return;
    }

    faqEl.innerHTML = items.map((f, i) => `
        <div class="ayuda-faq-item" data-idx="${i}">
            <div class="ayuda-faq-q">
                <span>${escapeHtml(f.q)}</span>
                <span class="ayuda-faq-arrow">▸</span>
            </div>
            <div class="ayuda-faq-a">${escapeHtml(f.a)}</div>
        </div>`
    ).join('');

    faqEl.querySelectorAll('.ayuda-faq-q').forEach(div => {
        div.addEventListener('click', () => {
            const item = div.closest('.ayuda-faq-item');
            const isOpen = item.classList.contains('open');
            faqEl.querySelectorAll('.ayuda-faq-item').forEach(it => it.classList.remove('open'));
            if (!isOpen) item.classList.add('open');
        });
    });
}

function getManualHTML() {
    return `
    <div class="manual-section">
        <h2>¿Qué es Procurador SCW?</h2>
        <p>Procurador SCW es una herramienta de automatización judicial que te permite procurar expedientes, generar informes y monitorear partes en el Sistema de Consulta Web del Poder Judicial de la Nación (PJN), sin escribir nada a mano.</p>
        <p><strong>Requisito fundamental:</strong> necesitás tener credenciales propias en el SCW del PJN. La herramienta trabaja con tu sesión — nunca modifica ni accede a datos que vos no puedas ver.</p>
    </div>

    <div class="manual-section">
        <h2>Componentes del sistema</h2>
        <table class="manual-table">
            <thead><tr><th>Componente</th><th>Qué hace</th><th>Cómo se accede</th></tr></thead>
            <tbody>
                <tr><td><strong>App de escritorio</strong></td><td>Procuración automática, informes, monitor de partes</td><td>Instalador .exe</td></tr>
                <tr><td><strong>Extensión de Chrome</strong></td><td>Autocompleta número de expediente en portales PJN</td><td>Chrome Web Store</td></tr>
                <tr><td><strong>Portal web</strong></td><td>Gestión de cuenta, plan y soporte</td><td>Este portal</td></tr>
            </tbody>
        </table>
    </div>

    <div class="manual-section">
        <h2>Instalación de la app de escritorio</h2>
        <ol>
            <li><strong>Descargá el instalador</strong> — Bajá el archivo <code>Procurador-SCW-Setup-X.X.X.exe</code> desde el enlace que te enviamos al activar tu cuenta (sección Mi Plan &gt; Descargas).</li>
            <li><strong>Instalá</strong> — Ejecutá el instalador y aceptá las opciones predeterminadas. Si Windows muestra un aviso de seguridad, hacé click en "Más información" → "Ejecutar de todas formas".</li>
            <li><strong>Primer inicio de sesión</strong> — Ingresá tu email y contraseña de Procurador (no las del PJN). La app te guiará por la configuración inicial.</li>
        </ol>
    </div>

    <div class="manual-section">
        <h2>Configuración inicial (Onboarding)</h2>
        <ol>
            <li><strong>Verificar conexión al servidor</strong> — La app verifica conectividad. Si falla, revisá tu internet.</li>
            <li><strong>Login</strong> — Ingresá tu email y contraseña de Procurador.</li>
            <li><strong>Configurar Chrome con perfil dedicado</strong> — El sistema lo configura automáticamente para no interferir con tu navegación habitual.</li>
            <li><strong>Conectar al SCW del PJN</strong> — La app abre Chrome y te lleva al portal del PJN. Iniciá sesión con tus credenciales del PJN manualmente, una única vez. Chrome las recordará.</li>
            <li><strong>Verificar contraseña guardada</strong> — El sistema confirma que Chrome tiene las credenciales. Si no las recuerda, usá el botón "Agregar contraseña SCW" en Configuración.</li>
        </ol>
    </div>

    <div class="manual-section">
        <h2>Procuración</h2>
        <p>Accede automáticamente al SCW del PJN y procura todos tus expedientes.</p>
        <ol>
            <li>Hacé click en <strong>▶ Procurar</strong> en el sidebar.</li>
            <li>El sistema abre Chrome en segundo plano e inicia el proceso.</li>
            <li>Ves el progreso en tiempo real en el panel de logs.</li>
            <li>Al finalizar, los resultados quedan en la carpeta de descargas.</li>
        </ol>
        <p><strong>Opciones disponibles:</strong> Procurar todos · Procurar seleccionados · Procurar con fecha personalizada.</p>
        <p class="manual-note">⚠️ No uses Chrome manualmente mientras el sistema está ejecutando.</p>
    </div>

    <div class="manual-section">
        <h2>Informe</h2>
        <p>Genera un informe detallado del estado de uno o varios expedientes.</p>
        <h4>Informe individual:</h4>
        <ol>
            <li>Ingresá el número de expediente en el campo de búsqueda.</li>
            <li>Hacé click en <strong>Generar informe</strong>.</li>
            <li>El resultado se descarga como archivo Excel.</li>
        </ol>
        <h4>Informe en lote:</h4>
        <ol>
            <li>Preparar un Excel con una columna llamada <code>expediente</code> y los números en cada fila.</li>
            <li>Hacé click en <strong>Cargar archivo</strong> y seleccioná tu Excel.</li>
            <li>Hacé click en <strong>Procesar lote</strong> — el sistema genera un Excel con el estado de todos.</li>
        </ol>
        <p>Podés descargar una <strong>plantilla de ejemplo</strong> desde el botón correspondiente en la sección Informe.</p>
    </div>

    <div class="manual-section">
        <h2>Monitor de partes</h2>
        <p>Vigila automáticamente si aparecen nuevos expedientes vinculados a personas o empresas.</p>
        <h4>Agregar una parte:</h4>
        <ol>
            <li>Hacé click en <strong>+ Agregar parte</strong>.</li>
            <li>Ingresá el nombre o CUIT/CUIL de la parte.</li>
            <li>Hacé click en <strong>Guardar</strong>.</li>
        </ol>
        <h4>Ejecutar el monitor:</h4>
        <ol>
            <li>Hacé click en <strong>▶ Ejecutar monitor</strong>.</li>
            <li>Las novedades aparecen en el panel de resultados.</li>
        </ol>
        <p><strong>Límite de partes según plan:</strong> COMBO_PROMO: 3 · PRO: 10 · ENTERPRISE: ilimitadas.</p>
    </div>

    <div class="manual-section">
        <h2>Extensión de Chrome</h2>
        <p>Instalación: buscá <strong>"Procurador SCW"</strong> en la <a href="https://chromewebstore.google.com/detail/aodnfemklhciagaglpggnclmbdhnhbme" target="_blank" rel="noopener">Chrome Web Store</a> y hacé click en "Agregar a Chrome".</p>
        <p>La extensión se activa automáticamente al navegar a los portales del PJN y autocompleta el número de expediente.</p>
        <p><strong>Portales compatibles:</strong> scw.pjn.gov.ar · escritos.pjn.gov.ar · notif.pjn.gov.ar · deox.pjn.gov.ar</p>
    </div>

    <div class="manual-section">
        <h2>Errores frecuentes</h2>
        <table class="manual-table">
            <thead><tr><th>Error</th><th>Causa</th><th>Solución</th></tr></thead>
            <tbody>
                <tr><td>Login al PJN falló</td><td>Chrome sin contraseña PJN guardada</td><td>Botón "Agregar contraseña SCW" en Configuración</td></tr>
                <tr><td>Proceso colgado / timeout</td><td>PJN lento o caído</td><td>Reintentar en 5 min; verificar el portal PJN</td></tr>
                <tr><td>Proceso activo en otro dispositivo</td><td>Otra instancia activa</td><td>Cerrar otras ventanas; esperar 2 min</td></tr>
                <tr><td>La app no arranca</td><td>Chrome bloqueado</td><td>Cerrar Chrome completamente y volver a abrir la app</td></tr>
            </tbody>
        </table>
    </div>

    <div class="manual-section">
        <h2>Privacidad y seguridad</h2>
        <ul>
            <li><strong>Credenciales PJN:</strong> se almacenan solo en tu Chrome, nunca en servidores de Procurador.</li>
            <li><strong>Scripts de automatización:</strong> cifrados con AES-256 y firmados digitalmente.</li>
            <li><strong>Comunicaciones:</strong> todas usan HTTPS/TLS.</li>
            <li><strong>Datos de expedientes:</strong> los resultados quedan únicamente en tu equipo.</li>
            <li><strong>Sesión:</strong> duración de 2 horas, se renueva automáticamente mientras estés activo.</li>
        </ul>
    </div>

    <div class="manual-section">
        <h2>Si tu cuenta la creó el equipo</h2>
        <p>Si no te registraste vos sino que el equipo te dio de alta, recibís un email con tus <strong>datos de acceso</strong> (usuario y una <strong>contraseña temporal</strong>) más el <strong>enlace de verificación</strong>. Hacé clic en el enlace para verificar tu email, ingresá con esa contraseña y, por seguridad, <strong>cambiala</strong> desde <em>Mi Perfil</em>. Si te asignaron un plan de cortesía, tu cuenta queda activa al verificar el email, con acceso hasta la fecha de vencimiento indicada.</p>
    </div>

    <div class="manual-section">
        <h2>Si tu plan vence o se discontinúa</h2>
        <p>Si tu plan tiene fecha de vencimiento (por ejemplo un acceso de cortesía o un plan con vigencia limitada), al llegar esa fecha tu cuenta pasa a <strong>suspendida por plan vencido</strong>:</p>
        <ul>
            <li>Antes del vencimiento recibís un aviso (in-app y por email).</li>
            <li>Si venías pagando, <strong>el cobro automático se pausa</strong> — no se cobra la renovación del plan discontinuado.</li>
            <li>Mientras tengas período pago en curso, <strong>conservás el acceso</strong> hasta el fin de ese período.</li>
            <li>Una vez suspendida, seguís pudiendo <strong>ingresar al portal web</strong> (no a la app/extensión) y ahí elegir un <strong>plan disponible</strong> y <strong>configurar el pago</strong> para reactivar. Al pagar, el acceso se restablece.</li>
        </ul>
    </div>

    <div class="manual-section">
        <h2>Soporte</h2>
        <p>Si tenés algún problema no cubierto acá:</p>
        <ul>
            <li><strong>Asistente IA:</strong> consultá en la sección "Asistente IA" del panel lateral.</li>
            <li><strong>Ticket de soporte:</strong> abrí un ticket en la sección "Soporte" — respondemos en menos de 24 horas hábiles.</li>
            <li><strong>Email:</strong> soporte@procuradortool.com</li>
        </ul>
    </div>`;
}

// ─── SECTION: IA CHAT ─────────────────────────────────────────────────────────
function renderIA() {
    // Render existing messages if any
    renderChatMessages();
    scrollChatToBottom();
}

// ─── SECCIÓN: NOTIFICACIONES ──────────────────────────────────────────────────

function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function refreshNotifBadge() {
    try {
        const res = await apiFetch('/client/notifications');
        if (!res || !res.ok) return;
        const data = await res.json();
        const unread = (data.notifications || []).filter(n => !n.read_at);
        const badge = document.getElementById('nav-notif-badge');
        if (!badge) return;
        if (unread.length > 0) {
            badge.textContent = unread.length > 9 ? '9+' : String(unread.length);
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) { /* silencioso */ }
}

async function renderNotificaciones() {
    const container = document.getElementById('notifications-list-container');
    container.innerHTML = '<div class="empty-state"><p>Cargando notificaciones...</p></div>';

    try {
        const res = await apiFetch('/client/notifications');
        if (!res || !res.ok) {
            container.innerHTML = '<div class="empty-state"><p>Error al cargar notificaciones.</p></div>';
            return;
        }
        const data = await res.json();
        const notifications = data.notifications || [];

        if (notifications.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No tenés notificaciones todavía.</p></div>';
            return;
        }

        const TYPE_ICON  = { info: 'ℹ️', warning: '⚠️', error: '🚫', success: '✅' };
        const TYPE_COLOR = { info: '#3b82f6', warning: '#d97706', error: '#ef4444', success: '#10b981' };

        container.innerHTML = notifications.map(n => {
            const icon  = TYPE_ICON[n.type]  || 'ℹ️';
            const color = TYPE_COLOR[n.type] || '#3b82f6';
            const date  = new Date(n.created_at).toLocaleString('es-AR', {
                day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
            });
            const unread = !n.read_at;
            return `
            <div class="notif-row" data-id="${n.id}"
                 style="display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid #e5e7eb;
                        background:${unread ? 'rgba(59,130,246,0.05)' : 'transparent'};
                        border-left:3px solid ${unread ? color : 'transparent'}">
                <div style="font-size:22px;flex-shrink:0;line-height:1.2">${icon}</div>
                <div style="flex:1;min-width:0">
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
                        <div style="font-weight:${unread ? 700 : 500};font-size:14px;color:#111827">${escHtml(n.title)}
                            ${unread ? '<span style="background:'+color+';color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;margin-left:6px;font-weight:600;letter-spacing:0.3px">NUEVA</span>' : ''}
                        </div>
                        <div style="font-size:11px;color:#6b7280;white-space:nowrap">${date}</div>
                    </div>
                    <div style="font-size:13px;color:#374151;line-height:1.5;margin-top:4px;white-space:pre-wrap">${escHtml(n.message)}</div>
                    ${unread ? `<button class="btn btn-sm btn-secondary notif-mark-btn" data-id="${n.id}" style="margin-top:8px;font-size:12px">✓ Marcar como leída</button>` : ''}
                </div>
            </div>`;
        }).join('');

        // Marcar como leída individual
        container.querySelectorAll('.notif-mark-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                btn.disabled = true;
                try {
                    await apiFetch(`/client/notifications/${id}/read`, { method: 'POST' });
                    await renderNotificaciones();
                    refreshNotifBadge();
                } catch (e) {
                    btn.disabled = false;
                }
            });
        });
    } catch (e) {
        container.innerHTML = `<div class="alert alert-error">Error al cargar notificaciones: ${escHtml(e.message)}</div>`;
    }
}

async function markAllNotificationsRead() {
    const btn = document.getElementById('btn-mark-all-notifs');
    if (!btn) return;
    btn.disabled = true;
    try {
        const res = await apiFetch('/client/notifications');
        if (!res || !res.ok) return;
        const data = await res.json();
        const unread = (data.notifications || []).filter(n => !n.read_at);
        for (const n of unread) {
            await apiFetch(`/client/notifications/${n.id}/read`, { method: 'POST' });
        }
        await renderNotificaciones();
        refreshNotifBadge();
    } finally {
        btn.disabled = false;
    }
}

function renderChatMessages() {
    const container = document.getElementById('chat-messages');
    if (!state.chatMessages.length) {
        container.innerHTML = `<div class="chat-message assistant">
            <div class="chat-avatar">🤖</div>
            <div class="chat-bubble">
                ¡Hola! Soy el asistente virtual de <strong>Procurador SCW</strong>. ¿En qué puedo ayudarte hoy?
            </div>
        </div>`;
        return;
    }

    container.innerHTML = state.chatMessages.map(m => {
        const isUser = m.role === 'user';
        return `<div class="chat-message ${m.role}">
            ${!isUser ? '<div class="chat-avatar">🤖</div>' : ''}
            <div class="chat-bubble">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
            ${isUser ? '<div class="chat-avatar" style="background:var(--accent);color:#fff;font-size:13px">Vos</div>' : ''}
        </div>`;
    }).join('');
}

function scrollChatToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

function appendChatMessage(role, content) {
    state.chatMessages.push({ role, content });
    renderChatMessages();
    scrollChatToBottom();
}

function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-message assistant';
    el.id = 'typing-indicator';
    el.innerHTML = `<div class="chat-avatar">🤖</div>
        <div class="chat-bubble" style="padding:10px 16px">
            <div class="chat-typing"><span></span><span></span><span></span></div>
        </div>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
}

async function sendChatMessage() {
    if (state.chatLoading) return;

    const textarea = document.getElementById('chat-input');
    const content = textarea.value.trim();
    if (!content) return;

    textarea.value = '';
    textarea.style.height = '44px';

    appendChatMessage('user', content);
    state.chatLoading = true;
    document.getElementById('btn-chat-send').disabled = true;
    showTypingIndicator();

    try {
        const res = await apiFetch('/usuarios/api/ai-chat', {
            method: 'POST',
            body: { messages: state.chatMessages },
        });

        removeTypingIndicator();

        if (!res) {
            appendChatMessage('assistant', 'Ocurrió un error. Por favor intentá de nuevo o contactá a soporte.');
            return;
        }

        const data = await res.json();

        if (!res.ok || data.error) {
            appendChatMessage('assistant', data.error || 'Error al contactar el asistente.');
        } else {
            appendChatMessage('assistant', data.reply || 'Sin respuesta.');
        }
    } catch (e) {
        removeTypingIndicator();
        appendChatMessage('assistant', 'Error de conexión. Verificá tu internet e intentá de nuevo.');
    } finally {
        state.chatLoading = false;
        document.getElementById('btn-chat-send').disabled = false;
        scrollChatToBottom();
    }
}

function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function autoResizeTextarea(el) {
    el.style.height = '44px';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Login form
    document.getElementById('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        doLogin(email, password);
    });

    // Profile form
    document.getElementById('profile-form').addEventListener('submit', saveProfile);

    // Password form
    document.getElementById('password-form').addEventListener('submit', savePassword);

    // Indicador en vivo de coincidencia de contraseñas (verde/rojo)
    document.getElementById('new-password').addEventListener('input', updatePwMatch);
    document.getElementById('confirm-password').addEventListener('input', updatePwMatch);

    // New ticket form
    document.getElementById('new-ticket-form').addEventListener('submit', submitNewTicket);

    // Chat input
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', handleChatKeydown);
    chatInput.addEventListener('input', () => autoResizeTextarea(chatInput));

    // Chat send button
    document.getElementById('btn-chat-send').addEventListener('click', sendChatMessage);

    // Hamburger
    document.getElementById('btn-hamburger').addEventListener('click', toggleSidebarMobile);

    // Sidebar overlay
    document.getElementById('sidebar-overlay').addEventListener('click', closeSidebarMobile);

    // Nav items
    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
        el.addEventListener('click', () => navigateTo(el.dataset.section));
    });

    // Marcar todas las notificaciones como leídas
    document.getElementById('btn-mark-all-notifs')?.addEventListener('click', markAllNotificationsRead);

    // Logout button
    document.getElementById('btn-logout').addEventListener('click', doLogout);

    // Ojito mostrar/ocultar contraseña (campos de Cambiar contraseña en Mi Perfil)
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.textContent = show ? '🙈' : '👁';
        });
    });

    // Botón "Usar otra cuenta"
    document.getElementById('btn-other-account').addEventListener('click', () => {
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('remember-me').checked = false;
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('login-email').focus();
    });

    // Capturar ?goto= de la URL (de links externos como emails) antes de cualquier flujo
    // Se persiste en sessionStorage para sobrevivir al ciclo de login normal
    const urlParams = new URLSearchParams(window.location.search);
    const incomingGoto = urlParams.get('goto');
    if (incomingGoto) {
        sessionStorage.setItem('pending_goto', incomingGoto);
    }

    // Detectar retorno desde checkout de MercadoPago
    // Caso 1: MP redirigió con ?pago=ok (flujo ideal)
    if (urlParams.get('pago') === 'ok') {
        const preapprovalId = urlParams.get('preapproval_id') || null;
        sessionStorage.setItem('show_pago_ok', JSON.stringify({ preapprovalId }));
        localStorage.removeItem('psc_checkout_pending'); // ya no necesitamos el flag
        history.replaceState(null, '', window.location.pathname);
    }

    // Caso 2: usuario volvió manualmente sin ?pago=ok (cerró la pestaña, presionó back,
    // copió la URL, etc.) — flag en localStorage detecta que inició el checkout
    if (!sessionStorage.getItem('show_pago_ok')) {
        const pendingRaw = localStorage.getItem('psc_checkout_pending');
        if (pendingRaw) {
            try {
                const { initiated } = JSON.parse(pendingRaw);
                const age = Date.now() - initiated;
                // Válido entre 10s (tiempo mínimo en la página de MP) y 30 minutos
                if (age > 10000 && age < 30 * 60 * 1000) {
                    sessionStorage.setItem('show_pago_ok', JSON.stringify({ preapprovalId: null }));
                }
            } catch (_) {}
            localStorage.removeItem('psc_checkout_pending');
        }
    }

    // Auto-login desde Electron (token en hash #sso=..., sección ya capturada arriba)
    const hash = window.location.hash;
    if (hash && hash.startsWith('#sso=')) {
        const ssoToken = hash.slice(5);
        if (ssoToken) {
            saveToken(ssoToken);
            // Limpiar hash y query para no exponerlos en el historial del navegador
            history.replaceState(null, '', window.location.pathname);
            state.token = ssoToken;
            await initDashboard();
            // initDashboard() ya consume pending_goto y navega
            return;
        }
    }

    // Si solo había ?goto= sin SSO, limpiar la URL (el pending_goto ya está en sessionStorage)
    if (incomingGoto && !hash.startsWith('#sso=')) {
        history.replaceState(null, '', window.location.pathname);
    }

    // Check if already logged in
    const token = getToken();
    if (token) {
        state.token = token;
        initDashboard();
    } else {
        document.getElementById('login-page').style.display = 'flex';
        renderRememberedUsers();
    }
});
