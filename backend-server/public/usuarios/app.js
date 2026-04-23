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
        const res = await fetch(BASE_URL + '/auth/extension-login', {
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
    navigateTo('plan');
}

async function loadAccount() {
    try {
        const res = await apiFetch('/client/account');
        if (!res || !res.ok) return;
        const data = await res.json();
        if (!data.success) return;

        state.account = data.account;
        renderTopbar();
    } catch (e) {
        console.error('Error cargando cuenta:', e);
    }
}

function renderTopbar() {
    const acc = state.account;
    if (!acc) return;

    document.getElementById('topbar-email').textContent = acc.email || '';
    document.getElementById('topbar-plan').textContent = acc.plan?.displayName || acc.plan?.name || 'Sin plan';
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function navigateTo(section) {
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
        case 'facturacion': /* static placeholder */ break;
        case 'soporte': renderSoporte(); break;
        case 'ia': renderIA(); break;
    }
}

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

    // Rellenar form con datos existentes
    const fields = {
        'profile-email': a.email || '',
        'profile-nombre': a.nombre || '',
        'profile-apellido': a.apellido || '',
        'profile-cuit': a.cuit || '',
        'profile-telefono': a.telefono || '',
        'profile-domicilio': a.domicilio ? (typeof a.domicilio === 'string' ? a.domicilio : JSON.stringify(a.domicilio)) : '',
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
    const cuit = document.getElementById('profile-cuit').value.trim();
    const telefono = document.getElementById('profile-telefono').value.trim();
    const domicilio = document.getElementById('profile-domicilio').value.trim();

    if (!nombre || !apellido) {
        showAlert(alertEl, 'error', 'El nombre y apellido son obligatorios.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';

    try {
        const res = await apiFetch('/usuarios/api/profile', {
            method: 'PUT',
            body: { nombre, apellido, cuit, telefono, domicilio },
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
    const statusBadgeClass = `badge badge-${acc.status || 'suspended'}`;

    // Info boxes
    document.getElementById('plan-name-display').textContent = plan.displayName || plan.name || 'Sin plan';
    document.getElementById('plan-status-badge').className = statusBadgeClass;
    document.getElementById('plan-status-badge').textContent = acc.status === 'active' ? 'Activo' : acc.status || '-';
    document.getElementById('plan-expiry-display').textContent = `Vence: ${formatDate(acc.expiresAt)}`;

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
        { label: 'Informes', key: 'informe' },
        { label: 'Monitor Novedades', key: 'monitor_novedades' },
        { label: 'Monitor Partes', key: 'monitor_partes' },
        { label: 'Batch', key: 'batch' },
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
    const planType = (acc.planType || '').toLowerCase();
    const planName = (acc.plan?.displayName || acc.plan?.name || '').toLowerCase();
    const hasElectron = planType.includes('electron') || planName.includes('electron');
    const container = document.getElementById('downloads-body');

    const extensionItem = `
        <div class="download-item">
            <div class="download-item-icon">🧩</div>
            <div class="download-item-info">
                <div class="download-item-title">Extensión Chrome</div>
                <div class="download-item-desc">Disponible en la Chrome Web Store — instalación directa desde el navegador</div>
            </div>
            <div class="download-item-actions">
                <a class="btn btn-primary btn-sm"
                   href="https://chromewebstore.google.com/detail/pjn-%E2%80%93-automatizaci%C3%B3n/aodnfemklhciagaglpggnclmbdhnhbme"
                   target="_blank" rel="noopener">🧩 Instalar desde Chrome Web Store</a>
            </div>
        </div>
        <div style="margin:4px 0 8px;padding:9px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;font-size:12px;color:#78350f;line-height:1.55">
            <strong>⚠️ Chrome puede mostrar "Procede con cuidado":</strong>
            es una advertencia estándar para extensiones del store oficial con pocos usuarios.
            La extensión es segura — hacé clic en <strong>"Continuar a la instalación"</strong>.
        </div>`;

    const electronItem = hasElectron ? `
        <div class="download-item">
            <div class="download-item-icon">🖥️</div>
            <div class="download-item-info">
                <div class="download-item-title">App Electron (Windows)</div>
                <div class="download-item-desc">Instalador de escritorio — gestiona la extensión automáticamente</div>
            </div>
            <div class="download-item-actions">
                <button class="btn btn-primary btn-sm" onclick="downloadElectron()">⬇ Descargar</button>
            </div>
        </div>` : '';

    container.innerHTML = `<div class="download-items">${extensionItem}${electronItem}</div>`;
}


async function downloadElectron() {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Preparando...';
    try {
        const res = await apiFetch('/api/extension/electron-token');
        if (!res || !res.ok) throw new Error('No disponible');
        const { token } = await res.json();
        // Descarga directa — el navegador muestra su barra de progreso nativa
        window.location.href = `/api/extension/electron-download?token=${token}`;
        btn.textContent = '⬇ Descargar';
        setTimeout(() => { btn.disabled = false; }, 3000);
    } catch (e) {
        alert(e.message || 'Error al descargar. Intentá de nuevo.');
        btn.disabled = false;
        btn.textContent = '⬇ Descargar';
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

    if (!state.plans.length) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0">No hay planes disponibles en este momento.</p>';
        return;
    }

    container.innerHTML = state.plans.map(p => {
        const isCurrent = p.name === currentPlan;
        const procLim = p.limits?.proc === -1 ? '∞' : (p.limits?.proc ?? '-');
        const infLim = p.limits?.informe === -1 ? '∞' : (p.limits?.informe ?? '-');
        const monLim = p.limits?.monitorNovedades === -1 ? '∞' : (p.limits?.monitorNovedades ?? '-');
        const batchLim = p.limits?.batch === -1 ? '∞' : (p.limits?.batch ?? '-');
        const price = p.priceUsd ? `USD ${p.priceUsd}/mes` : 'Gratis';

        return `<div class="plan-option${isCurrent ? ' ' : ''}" style="${isCurrent ? 'border-color:var(--accent);background:var(--accent-light)' : ''}">
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
        </div>`;
    }).join('');

    // CTA para cambio de plan
    container.innerHTML += `<div class="plan-upgrade-cta">
        <strong>Para cambiar tu plan, contactá a soporte</strong>
        Nuestro equipo te ayudará con el cambio o actualización de plan de forma personalizada.
        <br><br>
        <button class="btn btn-primary btn-sm" onclick="openTicketForPlanUpgrade()">Abrir ticket de cambio de plan</button>
    </div>`;
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
            const statusLabel = { open: 'Abierto', closed: 'Cerrado', in_progress: 'En progreso' }[t.status] || t.status;
            const catIcon = { technical: '🔧', billing: '💳', commercial: '📋' }[t.category] || '🎫';

            return `<div class="ticket-item" onclick="openTicketDetail(${t.id})">
                <div class="ticket-item-icon">${catIcon}</div>
                <div class="ticket-item-body">
                    <div class="ticket-item-title">${escapeHtml(t.title)}</div>
                    <div class="ticket-item-meta">
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
    const statusLabel = { open: 'Abierto', closed: 'Cerrado', in_progress: 'En progreso' }[ticket.status] || ticket.status;
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
                    <h3>${escapeHtml(ticket.title)}</h3>
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

// ─── SECTION: IA CHAT ─────────────────────────────────────────────────────────
function renderIA() {
    // Render existing messages if any
    renderChatMessages();
    scrollChatToBottom();
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
document.addEventListener('DOMContentLoaded', () => {
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

    // Logout button
    document.getElementById('btn-logout').addEventListener('click', doLogout);

    // Botón "Usar otra cuenta"
    document.getElementById('btn-other-account').addEventListener('click', () => {
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('remember-me').checked = false;
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('login-email').focus();
    });

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
