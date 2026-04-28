/* =============================================
   Dashboard Admin — Procurador SCW
   SPA con hash routing, vanilla JS
   ============================================= */

const API = '';   // mismo origen que el backend
let token = null;
let currentAdmin = null;
let currentPage = null;
let prevPage    = null;

// ───── AUTH ─────
async function doLogin() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember').checked;
    const errEl    = document.getElementById('login-error');
    const btn      = document.querySelector('#login-page .btn-primary');

    errEl.style.display = 'none';

    if (!email || !password) {
        errEl.textContent   = 'Completá email y contraseña.';
        errEl.style.display = 'block';
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Ingresando...';

    try {
        const res = await apiFetch('/auth/admin-login', 'POST', { email, password }, false);
        if (!res.success) throw new Error(res.error || 'Error de autenticación');

        token        = res.token;
        currentAdmin = res.user;

        localStorage.setItem('admin_token', token);
        localStorage.setItem('admin_email', email);

        // Recordar credenciales
        if (remember) {
            localStorage.setItem('admin_remember', '1');
            localStorage.setItem('admin_saved_email', email);
            localStorage.setItem('admin_saved_pass',  btoa(password));  // ofuscación básica
        } else {
            localStorage.removeItem('admin_remember');
            localStorage.removeItem('admin_saved_email');
            localStorage.removeItem('admin_saved_pass');
        }

        showApp();
        navigate(location.hash.slice(1).split('/')[0] || 'overview');

    } catch (e) {
        errEl.textContent   = e.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Ingresar';
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.getElementById('login-page').style.display !== 'none') {
        doLogin();
    }
});

function doLogout(expired = false) {
    token        = null;
    currentAdmin = null;
    localStorage.removeItem('admin_token');

    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('sidebar').style.display    = 'none';
    document.getElementById('main').style.display       = 'none';

    if (expired) {
        const errEl = document.getElementById('login-error');
        errEl.textContent   = 'Tu sesión expiró. Volvé a iniciar sesión.';
        errEl.style.display = 'block';
    }
}

function showApp() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('sidebar').style.display    = 'flex';
    document.getElementById('main').style.display       = 'flex';
    document.getElementById('admin-email').textContent  = localStorage.getItem('admin_email') || 'Admin';
}

// Pre-llenar credenciales recordadas
window.addEventListener('load', () => {
    if (localStorage.getItem('admin_remember') === '1') {
        const savedEmail = localStorage.getItem('admin_saved_email') || '';
        const savedPass  = localStorage.getItem('admin_saved_pass')  || '';
        document.getElementById('login-email').value    = savedEmail;
        document.getElementById('login-password').value = savedPass ? atob(savedPass) : '';
        document.getElementById('login-remember').checked = true;
    }
});

// Auto-restore session — validación en dos pasos sin pasar por apiFetch/doLogout
window.addEventListener('load', async () => {
    const savedToken = localStorage.getItem('admin_token');
    if (!savedToken) return;

    // Paso 1: verificar expiración y role localmente
    try {
        const payload = JSON.parse(atob(savedToken.split('.')[1]));
        if (!payload.exp || Date.now() >= payload.exp * 1000 || payload.role !== 'admin') {
            localStorage.removeItem('admin_token');
            return;
        }
    } catch {
        localStorage.removeItem('admin_token');
        return;
    }

    // Paso 2: confirmar con el servidor usando fetch directo (no apiFetch, no doLogout)
    try {
        const res = await fetch('/admin/stats/overview', {
            headers: {
                'Authorization': `Bearer ${savedToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!res.ok) {
            // Servidor rechazó el token — mostrar login limpiamente, sin mensaje de error
            localStorage.removeItem('admin_token');
            return;
        }
    } catch {
        // Error de red — no restaurar sesión
        localStorage.removeItem('admin_token');
        return;
    }

    // Token válido local y en servidor — restaurar
    token = savedToken;
    showApp();
    navigate(location.hash.slice(1).split('/')[0] || 'overview');
});

// ───── ROUTING ─────
function navigate(page, id) {
    if (currentPage && currentPage !== page) prevPage = currentPage;
    currentPage = page;
    document.querySelectorAll('#sidebar nav a').forEach(a => {
        a.classList.toggle('active', a.dataset.page === page);
    });

    const titles = {
        overview: 'Resumen del sistema',
        users: 'Usuarios',
        'user-detail': 'Detalle de usuario',
        'pending-users': 'Usuarios pendientes de activación',
        tickets: 'Tickets de soporte',
        'ticket-detail': 'Detalle de ticket',
        scripts: 'Scripts',
        plans: 'Planes de suscripción'
    };
    document.getElementById('topbar-title').textContent = titles[page] || page;

    const content = document.getElementById('content');
    content.innerHTML = '<div class="loading">Cargando...</div>';

    const pages = { overview: renderOverview, users: renderUsers, 'user-detail': () => renderUserDetail(id), 'pending-users': renderPendingUsers, tickets: renderTickets, 'ticket-detail': () => renderTicketDetail(id), scripts: renderScripts, monitor: renderMonitor, plans: renderPlans };
    if (pages[page]) pages[page]();
}

// ───── API HELPER ─────
async function apiFetch(path, method = 'GET', body = null, auth = true) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (auth && token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(API + path, opts);

    const data = await res.json();

    if (res.status === 401 || res.status === 403) {
        if (auth) {
            doLogout(true);
            throw new Error('Sesión expirada.');
        }
        throw new Error(data.error || `Acceso denegado`);
    }

    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
}

function showAlert(container, msg, type = 'error') {
    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    container.prepend(el);
    setTimeout(() => el.remove(), 4000);
}

// ───── OVERVIEW ─────
async function renderOverview() {
    try {
        const data = await apiFetch('/admin/stats/overview');
        const s = data.stats;
        const successPct = (s.successRate.successful + s.successRate.failed) > 0
            ? Math.round(s.successRate.successful / (s.successRate.successful + s.successRate.failed) * 100)
            : 0;

        // Count open tickets
        let openTickets = 0;
        try {
            const tData = await apiFetch('/admin/tickets?status=open&limit=200');
            openTickets = tData.count;
        } catch (_) {}

        document.getElementById('content').innerHTML = `
        <div class="page-header">
            <div><h2>Resumen del sistema</h2><p>Estado actual de la plataforma</p></div>
        </div>
        <div class="stats-grid">
            <div class="stat-card" onclick="navigate('users')" style="cursor:pointer" title="Ver lista de usuarios">
                <div class="stat-icon">👥</div>
                <div class="stat-body"><div class="stat-value">${s.totalUsers}</div><div class="stat-label">Usuarios registrados</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">✅</div>
                <div class="stat-body"><div class="stat-value">${s.activeSubscriptions}</div><div class="stat-label">Suscripciones activas</div></div>
            </div>
            <div class="stat-card ${s.pendingUsers > 0 ? 'stat-card-warning' : ''}" onclick="navigate('pending-users')" style="cursor:pointer" title="Ver usuarios pendientes">
                <div class="stat-icon">⏳</div>
                <div class="stat-body"><div class="stat-value">${s.pendingUsers || 0}</div><div class="stat-label">Pendientes de activación</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">⚡</div>
                <div class="stat-body"><div class="stat-value">${s.executionsToday}</div><div class="stat-label">Ejecuciones hoy</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📈</div>
                <div class="stat-body"><div class="stat-value">${successPct}%</div><div class="stat-label">Tasa de éxito (hoy)</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🎫</div>
                <div class="stat-body"><div class="stat-value">${openTickets}</div><div class="stat-label">Tickets abiertos</div></div>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h3>📜 Scripts más usados (últimos 7 días)</h3></div>
            <div class="card-body">
                ${s.topScripts.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">Sin datos aún.</p>' : `
                <table><thead><tr><th>Script</th><th>Ejecuciones</th></tr></thead>
                <tbody>${s.topScripts.map(r => `<tr><td>${r.script_name}</td><td>${r.executions}</td></tr>`).join('')}</tbody>
                </table>`}
            </div>
        </div>`;
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

// ───── USUARIOS ─────
async function renderUsers() {
    try {
        const data = await apiFetch('/admin/users');
        const users = data.users;

        document.getElementById('content').innerHTML = `
        <div class="page-header">
            <div><h2>Usuarios</h2><p>${users.length} usuarios registrados</p></div>
        </div>
        <div class="filter-bar">
            <input type="text" id="user-search" placeholder="Buscar por email..." oninput="filterUsers()" style="min-width:240px">
        </div>
        <div class="card">
            <div class="table-wrapper">
                <table id="users-table">
                    <thead><tr>
                        <th>Email</th><th>Rol</th><th>Plan</th><th>Estado</th>
                        <th>Uso</th><th>Expira</th><th>Último login</th><th></th>
                    </tr></thead>
                    <tbody>${users.map(u => `
                    <tr class="clickable-row" data-id="${u.id}">
                        <td>${u.email}</td>
                        <td>${roleBadge(u.role)}</td>
                        <td>${u.plan ? `<span class="badge badge-blue">${u.plan}</span>` : '—'}</td>
                        <td>${registrationStatusBadge(u.registration_status, u.status)}</td>
                        <td>${u.usage_count ?? 0} / ${u.usage_limit ?? 0}</td>
                        <td>${u.expires_at ? fmtDate(u.expires_at) : '—'}</td>
                        <td>${u.last_login ? fmtDate(u.last_login) : '—'}</td>
                        <td><button class="btn btn-sm btn-secondary" onclick="navigate('user-detail','${u.id}')">Ver</button></td>
                    </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;

        document.querySelectorAll('.clickable-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                navigate('user-detail', row.dataset.id);
            });
        });
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

window.filterUsers = function() {
    const q = document.getElementById('user-search').value.toLowerCase();
    document.querySelectorAll('#users-table tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
};

// ───── DETALLE USUARIO ─────
async function renderUserDetail(userId) {
    try {
        const [uData, tData, mData, plansData] = await Promise.all([
            apiFetch(`/admin/users/${userId}`),
            apiFetch(`/admin/tickets?userId=${userId}&limit=20`),
            apiFetch(`/admin/monitor/partes?userId=${userId}`),
            apiFetch('/admin/plans')
        ]);
        const u = uData.user;
        const logs = uData.recentLogs;
        const tickets = tData.tickets;
        const partes = mData.partes || [];
        const allPlans = (plansData.plans || []).filter(p => p.active);

        document.getElementById('content').innerHTML = `
        <a class="back-btn" onclick="navigate(prevPage || 'users')">← Volver a ${prevPage === 'pending-users' ? 'Pendientes' : 'Usuarios'}</a>
        <div class="page-header">
            <div><h2>${u.email}</h2><p>ID: ${u.id} · Registrado: ${fmtDate(u.created_at)}</p></div>
        </div>
        <div id="ud-alert"></div>

        <!-- Info + acciones -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
            <div class="card">
                <div class="card-header"><h3>👤 Información</h3></div>
                <div class="card-body">
                    <div class="detail-grid">
                        <div class="detail-item"><label>Email</label><span>${u.email}</span></div>
                        <div class="detail-item"><label>Rol</label><span>${roleBadge(u.role)}</span></div>
                        <div class="detail-item"><label>CUIT</label><span>${u.cuit || '—'}</span></div>
                        <div class="detail-item"><label>Hardware vinculado</label><span>${u.machine_id ? '✅ Sí' : '❌ No'}</span></div>
                        <div class="detail-item"><label>Último login</label><span>${u.last_login ? fmtDate(u.last_login) : '—'}</span></div>
                    </div>
                    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
                        ${u.machine_id ? `<button class="btn btn-sm btn-secondary" onclick="unbindHardware(${u.id})">🔓 Desvincular hardware</button>` : ''}
                        <button class="btn btn-sm btn-secondary" onclick="toggleRole(${u.id},'${u.role}')">
                            ${u.role === 'admin' ? '👤 Quitar admin' : '🔐 Hacer admin'}
                        </button>
                        <button class="btn btn-sm btn-warning" onclick="sendPasswordReset(${u.id},'${escHtml(u.email)}')">🔑 Blanquear contraseña</button>
                    </div>
                    ${u.role !== 'admin' ? `
                    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
                        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id},'${escHtml(u.email)}')">🗑️ Eliminar cuenta</button>
                    </div>` : ''}
                    <div style="margin-top:12px">
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Asignar CUIT</label>
                        <div style="display:flex;gap:6px">
                            <input type="text" id="cuit-input" placeholder="27123456789" value="${u.cuit || ''}" maxlength="11" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
                            <button class="btn btn-sm btn-primary" onclick="assignCuit(${u.id})">Guardar</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card">
                <div class="card-header"><h3>💳 Suscripción</h3></div>
                <div class="card-body">
                    <div class="detail-grid">
                        <div class="detail-item"><label>Plan</label><span>${u.plan ? `<span class="badge badge-blue">${u.plan_display_name || u.plan}</span>` : '—'}</span></div>
                        <div class="detail-item"><label>Estado</label>
                            <div style="display:flex;flex-direction:column;gap:4px">
                                <span>${statusBadge(u.status)}</span>
                                ${u.registration_status === 'pending_email'
                                    ? '<span style="font-size:11px;color:#b45309;font-weight:600">📧 Pendiente de verificación de email</span>'
                                    : u.registration_status === 'pending_activation'
                                    ? '<span style="font-size:11px;color:#d97706;font-weight:600">⏳ Pendiente de activación</span>'
                                    : ''}
                            </div>
                        </div>
                        <div class="detail-item"><label>Uso global <span style="font-weight:400;color:var(--text-muted)">(extensión)</span></label><span>${u.usage_count ?? 0} / ${u.usage_limit ?? 0}</span></div>
                        <div class="detail-item"><label>Expira</label><span>${u.expires_at ? fmtDate(u.expires_at) : '—'}</span></div>
                    </div>
                    ${u.plan ? `<div style="margin-top:12px">
                        <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-muted)">Uso por subsistema</div>
                        ${renderSubsystemBar('Procuración', u.proc_usage || 0, u.proc_executions_limit, u.proc_bonus || 0)}
                        ${renderSubsystemBar('Procurar Batch', u.batch_usage || 0, u.batch_executions_limit, u.batch_bonus || 0)}
                        ${renderSubsystemBar('Informes', u.informe_usage || 0, u.informe_limit, u.informe_bonus || 0)}
                        ${renderSubsystemBar('Monitor Novedades', u.monitor_novedades_usage || 0, u.monitor_novedades_limit, u.monitor_novedades_bonus || 0)}
                        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Monitor Partes límite: ${u.monitor_partes_limit === -1 ? 'Ilimitado' : (u.monitor_partes_limit || 3) + (u.monitor_partes_bonus || 0)} (bonus: ${u.monitor_partes_bonus || 0})</div>
                    </div>` : ''}
                    <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
                        <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:2px">Cambiar plan</div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                            <select id="plan-select" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;min-width:180px">
                                ${allPlans.map(p => `<option value="${p.id}" ${u.plan_id === p.id ? 'selected' : ''}>${escHtml(p.display_name || p.name)}</option>`).join('')}
                            </select>
                            <div style="display:flex;align-items:center;gap:4px">
                                <input type="number" id="days-input" value="${u.expires_at ? Math.max(1, Math.ceil((new Date(u.expires_at) - Date.now()) / 86400000)) : 30}" min="1" max="3650" style="width:70px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
                                <span style="font-size:12px;color:var(--text-muted)">días</span>
                            </div>
                            <button class="btn btn-sm btn-primary" onclick="updateSub(${u.id})">Aplicar</button>
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                            ${u.status === 'active' ? `<button class="btn btn-sm btn-danger" onclick="suspendSub(${u.id})">⏸ Suspender</button>` : `<button class="btn btn-sm btn-success" onclick="reactivateSub(${u.id})">▶ Reactivar</button>`}
                            <button class="btn btn-sm btn-secondary" onclick="resetUsage(${u.id})">🔄 Resetear uso</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Datos de registro -->
        <div class="card section-gap">
            <div class="card-header">
                <h3>📋 Datos de Registro</h3>
                <div style="display:flex;gap:8px">
                    <button id="reg-edit-btn" class="btn btn-sm btn-secondary" onclick="toggleRegistroEdit(${u.id})">✏️ Editar</button>
                    <button id="reg-save-btn" class="btn btn-sm btn-primary" onclick="saveRegistroData(${u.id})" style="display:none">💾 Guardar</button>
                    <button id="reg-cancel-btn" class="btn btn-sm btn-secondary" onclick="cancelRegistroEdit()" style="display:none">✕ Cancelar</button>
                </div>
            </div>
            <div class="card-body">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div>
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Nombre</label>
                        <input type="text" id="reg-nombre" value="${escHtml(u.nombre || '')}" disabled style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Apellido</label>
                        <input type="text" id="reg-apellido" value="${escHtml(u.apellido || '')}" disabled style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">CUIT/CUIL</label>
                        <input type="text" id="reg-cuit" value="${escHtml(u.cuit || '')}" maxlength="11" disabled style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Estado de registro</label>
                        <select id="reg-status" disabled style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-secondary)">
                            <option value="pending_email"   ${u.registration_status === 'pending_email'   ? 'selected' : ''}>Email sin verificar</option>
                            <option value="pending_activation" ${u.registration_status === 'pending_activation' ? 'selected' : ''}>Pendiente de activación</option>
                            <option value="active"          ${u.registration_status === 'active'          ? 'selected' : ''}>Activo</option>
                            <option value="trial"           ${u.registration_status === 'trial'           ? 'selected' : ''}>Trial</option>
                        </select>
                    </div>
                </div>
                <div style="margin-top:12px">
                    <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-muted)">Domicilio</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 80px 80px;gap:8px;margin-bottom:8px">
                        <div>
                            <label style="font-size:11px;display:block;margin-bottom:3px">Calle</label>
                            <input type="text" id="reg-calle" value="${escHtml(u.domicilio?.calle || '')}" disabled style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                        </div>
                        <div>
                            <label style="font-size:11px;display:block;margin-bottom:3px">Número</label>
                            <input type="text" id="reg-numero" value="${escHtml(u.domicilio?.numero || '')}" disabled style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                        </div>
                        <div>
                            <label style="font-size:11px;display:block;margin-bottom:3px">Piso</label>
                            <input type="text" id="reg-piso" value="${escHtml(u.domicilio?.piso || '')}" disabled style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                        </div>
                        <div>
                            <label style="font-size:11px;display:block;margin-bottom:3px">Depto</label>
                            <input type="text" id="reg-depto" value="${escHtml(u.domicilio?.depto || '')}" disabled style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                        <div>
                            <label style="font-size:11px;display:block;margin-bottom:3px">Localidad</label>
                            <input type="text" id="reg-localidad" value="${escHtml(u.domicilio?.localidad || '')}" disabled style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                        </div>
                        <div>
                            <label style="font-size:11px;display:block;margin-bottom:3px">Provincia</label>
                            <input type="text" id="reg-provincia" value="${escHtml(u.domicilio?.provincia || '')}" disabled style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;background:var(--bg-secondary)">
                        </div>
                    </div>
                </div>
                <div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                    <span style="font-size:12px;color:var(--text-muted)">
                        Email verificado: ${u.email_verified ? '✅ Sí' : '❌ No'} &nbsp;·&nbsp; T&C aceptado: ${u.toc_accepted_at ? fmtDate(u.toc_accepted_at) : '—'}
                    </span>
                    ${!u.email_verified ? `
                    <button class="btn btn-sm btn-success" onclick="verifyEmailManual(${u.id})" style="font-size:12px;padding:4px 10px">✅ Verificar email</button>
                    <button class="btn btn-sm btn-secondary" onclick="resendVerification(${u.id},'${escHtml(u.email)}')" style="font-size:12px;padding:4px 10px">✉️ Reenviar verificación</button>
                    <button class="btn btn-sm btn-primary" onclick="verifyAndActivateUser(${u.id},'${escHtml(u.email)}')" style="font-size:12px;padding:4px 10px">⚡ Verificar y activar</button>
                    ` : u.registration_status === 'pending_activation' ? `
                    <button class="btn btn-sm btn-primary" onclick="activateUserFromDetail(${u.id},'${escHtml(u.email)}')" style="font-size:12px;padding:4px 10px">⚡ Activar cuenta</button>
                    ` : ''}
                </div>
            </div>
        </div>

        <!-- Ajustes de uso por subsistema -->
        <div class="card section-gap">
            <div class="card-header"><h3>🎁 Ajustes Manuales de Uso</h3></div>
            <div class="card-body">
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Subsistema</label>
                        <select id="adj-subsystem" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
                            <option value="global">── Global (uso_count) ──</option>
                            <option value="proc">Procuración</option>
                            <option value="batch">Procurar Batch</option>
                            <option value="informe">Informes</option>
                            <option value="monitor_novedades">Monitor Novedades</option>
                            <option value="monitor_partes">Monitor Partes</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Cantidad (+/-)</label>
                        <input type="number" id="adj-amount" value="10" style="width:80px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
                    </div>
                    <div style="flex:1;min-width:160px">
                        <label style="font-size:12px;display:block;margin-bottom:4px">Motivo</label>
                        <input type="text" id="adj-reason" placeholder="Motivo del ajuste..." style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Ticket ID (opcional)</label>
                        <input type="number" id="adj-ticket" placeholder="ID ticket" style="width:100px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
                    </div>
                    <button class="btn btn-sm btn-primary" onclick="applyUsageAdjustment(${u.id})">Aplicar ajuste</button>
                    <button class="btn btn-sm btn-secondary" onclick="applyUsageAdjustment(${u.id}, true)" title="Quita el límite para el subsistema seleccionado">🔓 Ilimitado</button>
                </div>
                <div style="margin-top:16px">
                    <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-muted)">Historial de ajustes</div>
                    <div id="adj-history-loading" style="font-size:13px;color:var(--text-muted)">Cargando...</div>
                    <div id="adj-history"></div>
                </div>
            </div>
        </div>

        <!-- Tickets del usuario -->
        <div class="card section-gap">
            <div class="card-header">
                <h3>🎫 Tickets (${tickets.length})</h3>
                <a class="btn btn-sm btn-secondary" onclick="navigate('tickets')">Ver todos</a>
            </div>
            <div class="card-body" style="padding:0">
                ${tickets.length === 0 ? '<div class="empty-state"><p>Sin tickets</p></div>' : `
                <div class="table-wrapper">
                    <table><thead><tr><th>#</th><th>Categoría</th><th>Título</th><th>Estado</th><th>Prioridad</th><th>Fecha</th><th></th></tr></thead>
                    <tbody>${tickets.map(t => `<tr>
                        <td>#${t.id}</td>
                        <td>${catBadge(t.category)}</td>
                        <td>${t.title}</td>
                        <td>${ticketStatusBadge(t.status)}</td>
                        <td>${priorityBadge(t.priority)}</td>
                        <td>${fmtDate(t.created_at)}</td>
                        <td><button class="btn btn-sm btn-secondary" onclick="navigate('ticket-detail','${t.id}')">Ver</button></td>
                    </tr>`).join('')}
                    </tbody></table>
                </div>`}
            </div>
        </div>

        <!-- Partes monitoreadas -->
        <div class="card section-gap">
            <div class="card-header">
                <h3>🔍 Partes en Monitoreo (${partes.length})</h3>
            </div>
            <div class="card-body" style="padding:0">
                ${partes.length === 0
                    ? '<div class="empty-state"><p>Sin partes monitoreadas</p></div>'
                    : `<div class="table-wrapper">
                        <table><thead><tr>
                            <th>Parte</th>
                            <th>Jurisdicción</th>
                            <th>Línea base</th>
                            <th>Exp. confirmados</th>
                            <th>Novedades pendientes</th>
                            <th>Creada</th>
                            <th></th>
                        </tr></thead>
                        <tbody>${partes.map(p => `<tr>
                            <td>${p.nombre_parte}</td>
                            <td><span class="badge badge-blue">${p.jurisdiccion_sigla || p.jurisdiccion_codigo || '—'}</span></td>
                            <td>${p.tiene_linea_base ? '<span class="badge badge-green">Con base</span>' : '<span class="badge badge-gray">Sin base</span>'}</td>
                            <td style="text-align:center">${p.exp_confirmados ?? 0}</td>
                            <td style="text-align:center">${p.novedades_pendientes > 0 ? `<span class="badge badge-orange">${p.novedades_pendientes}</span>` : '0'}</td>
                            <td>${fmtDate(p.fecha_creacion)}</td>
                            <td><button class="btn btn-sm btn-danger" onclick="deleteMonitorParte(${p.id},'${p.nombre_parte.replace(/'/g, "\\'")}',${userId})">✕</button></td>
                        </tr>`).join('')}
                        </tbody></table>
                    </div>`
                }
            </div>
        </div>

        <!-- Logs recientes -->
        <div class="card">
            <div class="card-header"><h3>📋 Últimas ejecuciones (${logs.length})</h3></div>
            <div class="card-body" style="padding:0">
                ${logs.length === 0 ? '<div class="empty-state"><p>Sin ejecuciones</p></div>' : `
                <div class="table-wrapper">
                    <table><thead><tr><th>Script</th><th>Subsistema</th><th>Resultado</th><th>Fecha</th><th>Error</th></tr></thead>
                    <tbody>${logs.map(l => `<tr>
                        <td>${l.script_name || '—'}</td>
                        <td style="font-size:11px;color:var(--text-muted)">${l.subsystem || '—'}</td>
                        <td>${l.success ? '<span class="badge badge-green">OK</span>' : '<span class="badge badge-red">Error</span>'}</td>
                        <td>${fmtDate(l.execution_date)}</td>
                        <td style="font-size:12px;color:var(--text-muted)">${l.error_message || ''}</td>
                    </tr>`).join('')}
                    </tbody></table>
                </div>`}
            </div>
        </div>`;

        // Cargar historial de ajustes
        loadAdjustmentHistory(userId);
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

// User detail actions
window.unbindHardware = async function(id) {
    if (!confirm('¿Desvincular hardware de este usuario?')) return;
    try {
        await apiFetch(`/admin/users/${id}/unbind-hardware`, 'POST');
        showAlert(document.getElementById('ud-alert'), 'Hardware desvinculado.', 'success');
        setTimeout(() => navigate('user-detail', id), 1200);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};
window.toggleRole = async function(id, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!confirm(`¿Cambiar rol a "${newRole}"?`)) return;
    try {
        await apiFetch(`/admin/users/${id}/role`, 'PUT', { role: newRole });
        showAlert(document.getElementById('ud-alert'), `Rol actualizado a ${newRole}.`, 'success');
        setTimeout(() => navigate('user-detail', id), 1200);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};
window.assignCuit = async function(id) {
    const cuit = document.getElementById('cuit-input').value.trim();
    try {
        await apiFetch(`/admin/users/${id}/cuit`, 'PUT', { cuit });
        showAlert(document.getElementById('ud-alert'), `CUIT ${cuit} asignado.`, 'success');
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};
window.updateSub = async function(id) {
    const sel = document.getElementById('plan-select');
    const planId = parseInt(sel.value);
    const planLabel = sel.options[sel.selectedIndex]?.text || '';
    const durationDays = parseInt(document.getElementById('days-input').value) || 30;
    if (!confirm(`¿Cambiar el plan a "${planLabel}" por ${durationDays} días? Se reseteará el uso actual.`)) return;
    try {
        await apiFetch('/admin/subscriptions', 'POST', { userId: id, planId, durationDays });
        showAlert(document.getElementById('ud-alert'), `Plan actualizado a "${planLabel}" por ${durationDays} días.`, 'success');
        setTimeout(() => navigate('user-detail', id), 1200);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};
window.suspendSub = async function(id) {
    if (!confirm('¿Suspender suscripción?')) return;
    try {
        await apiFetch(`/admin/subscriptions/${id}/suspend`, 'POST');
        showAlert(document.getElementById('ud-alert'), 'Suscripción suspendida.', 'success');
        setTimeout(() => navigate('user-detail', id), 1200);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};
window.reactivateSub = async function(id) {
    try {
        await apiFetch(`/admin/subscriptions/${id}/reactivate`, 'POST');
        showAlert(document.getElementById('ud-alert'), 'Suscripción reactivada.', 'success');
        setTimeout(() => navigate('user-detail', id), 1200);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};
window.resetUsage = async function(id) {
    if (!confirm('¿Resetear contador de uso?')) return;
    try {
        await apiFetch(`/admin/subscriptions/${id}/reset-usage`, 'POST');
        showAlert(document.getElementById('ud-alert'), 'Contador reseteado.', 'success');
        setTimeout(() => navigate('user-detail', id), 1200);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};

window.deleteMonitorParte = async function(parteId, nombre, userId) {
    if (!confirm(`¿Eliminar la parte "${nombre}" y todos sus expedientes asociados? Esta acción no se puede deshacer.`)) return;
    try {
        await apiFetch(`/admin/monitor/partes/${parteId}`, 'DELETE');
        showAlert(document.getElementById('ud-alert'), `Parte "${nombre}" eliminada correctamente.`, 'success');
        setTimeout(() => navigate('user-detail', userId), 1200);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};

// ───── TICKETS ─────
async function renderTickets() {
    try {
        let url = '/admin/tickets?limit=200';
        const params = new URLSearchParams(location.hash.split('?')[1] || '');
        if (params.get('status')) url += `&status=${params.get('status')}`;

        const data = await apiFetch(url);
        const tickets = data.tickets;

        document.getElementById('content').innerHTML = `
        <div class="page-header">
            <div><h2>Tickets de soporte</h2><p>${tickets.length} tickets encontrados</p></div>
        </div>
        <div class="filter-bar">
            <select id="f-status" onchange="applyTicketFilters()">
                <option value="">Todos los estados</option>
                <option value="open">Abierto</option>
                <option value="in_progress">En progreso</option>
                <option value="resolved">Resuelto</option>
                <option value="closed">Cerrado</option>
            </select>
            <select id="f-cat" onchange="applyTicketFilters()">
                <option value="">Todas las categorías</option>
                <option value="technical">Técnico</option>
                <option value="billing">Facturación</option>
                <option value="commercial">Comercial</option>
            </select>
            <select id="f-pri" onchange="applyTicketFilters()">
                <option value="">Todas las prioridades</option>
                <option value="urgent">Urgente</option>
                <option value="high">Alta</option>
                <option value="medium">Media</option>
                <option value="low">Baja</option>
            </select>
            <input type="text" id="f-search" placeholder="Buscar..." oninput="applyTicketFilters()" style="min-width:200px">
        </div>
        <div class="card">
            <div class="table-wrapper">
                <table id="tickets-table">
                    <thead><tr><th>#</th><th>Usuario</th><th>Categoría</th><th>Título</th><th>Estado</th><th>Prioridad</th><th>Beneficio</th><th>Fecha</th><th></th></tr></thead>
                    <tbody>${tickets.length === 0 ? '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:32px">Sin tickets</td></tr>' :
                    tickets.map(t => `<tr class="ticket-row"
                        data-status="${t.status}" data-cat="${t.category}" data-pri="${t.priority}"
                        data-text="${(t.title + t.user_email).toLowerCase()}">
                        <td>#${t.id}</td>
                        <td style="font-size:12px"><a onclick="navigate('user-detail','${t.user_id}')" style="cursor:pointer;color:var(--primary);text-decoration:underline">${t.user_email}</a></td>
                        <td>${catBadge(t.category)}</td>
                        <td>${t.title}</td>
                        <td>${ticketStatusBadge(t.status)}</td>
                        <td>${priorityBadge(t.priority)}</td>
                        <td>${t.benefit_applied ? '<span class="badge badge-green">✓</span>' : '—'}</td>
                        <td style="font-size:12px">${fmtDate(t.created_at)}</td>
                        <td><button class="btn btn-sm btn-secondary" onclick="navigate('ticket-detail','${t.id}')">Ver</button></td>
                    </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

window.applyTicketFilters = function() {
    const status = document.getElementById('f-status').value;
    const cat    = document.getElementById('f-cat').value;
    const pri    = document.getElementById('f-pri').value;
    const q      = document.getElementById('f-search').value.toLowerCase();

    document.querySelectorAll('.ticket-row').forEach(row => {
        const show = (!status || row.dataset.status === status) &&
                     (!cat    || row.dataset.cat    === cat) &&
                     (!pri    || row.dataset.pri    === pri) &&
                     (!q      || row.dataset.text.includes(q));
        row.style.display = show ? '' : 'none';
    });
};

// ───── DETALLE TICKET ─────
async function renderTicketDetail(ticketId) {
    try {
        const data = await apiFetch(`/admin/tickets/${ticketId}`);
        const t = data.ticket;
        const comments = data.comments;

        document.getElementById('content').innerHTML = `
        <a class="back-btn" onclick="navigate('tickets')">← Volver a Tickets</a>
        <div class="page-header">
            <div>
                <h2>Ticket #${t.id} — ${t.title}</h2>
                <p>
                    <a onclick="navigate('user-detail','${t.user_id}')" style="cursor:pointer;color:var(--primary);text-decoration:underline">${t.user_email}</a>
                    · ${catLabel(t.category)} · ${fmtDate(t.created_at)}
                </p>
            </div>
        </div>
        <div id="td-alert"></div>

        <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
            <!-- Columna principal: descripción + hilo -->
            <div>
                <div class="card section-gap">
                    <div class="card-header"><h3>📝 Descripción</h3></div>
                    <div class="card-body" style="font-size:14px;line-height:1.6">${escHtml(t.description)}</div>
                </div>

                <div class="card section-gap">
                    <div class="card-header"><h3>💬 Conversación</h3></div>
                    <div class="card-body">
                        <div class="comment-thread" id="comment-thread">
                            ${comments.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">Sin respuestas aún.</p>' :
                            comments.map(c => `
                            <div class="comment ${c.author_role}">
                                <div class="comment-avatar">${c.author_role === 'admin' ? '👑' : '👤'}</div>
                                <div class="comment-body">
                                    <div class="comment-meta">
                                        <strong>${c.author_email}</strong>
                                        <span class="badge badge-${c.author_role === 'admin' ? 'yellow' : 'blue'}" style="margin-left:6px">${c.author_role === 'admin' ? 'Admin' : 'Usuario'}</span>
                                        · ${fmtDate(c.created_at)}
                                    </div>
                                    <div class="comment-text">${escHtml(c.message)}</div>
                                </div>
                            </div>`).join('')}
                        </div>
                        ${t.status !== 'closed' ? `
                        <div style="margin-top:16px">
                            <textarea id="reply-msg" placeholder="Escribir respuesta..." rows="3" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"></textarea>
                            <div style="margin-top:8px;text-align:right">
                                <button class="btn btn-primary" onclick="replyTicket(${t.id})">Responder</button>
                            </div>
                        </div>` : '<p style="color:var(--text-muted);font-size:13px;margin-top:12px">Ticket cerrado — no se pueden agregar respuestas.</p>'}
                    </div>
                </div>
            </div>

            <!-- Columna lateral: estado + beneficio -->
            <div>
                <div class="card section-gap">
                    <div class="card-header"><h3>⚙️ Acciones</h3></div>
                    <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
                        <div>
                            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Estado</label>
                            <select id="ticket-status" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">
                                <option value="open" ${t.status === 'open' ? 'selected' : ''}>Abierto</option>
                                <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>En progreso</option>
                                <option value="resolved" ${t.status === 'resolved' ? 'selected' : ''}>Resuelto</option>
                                <option value="closed" ${t.status === 'closed' ? 'selected' : ''}>Cerrado</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Prioridad</label>
                            <select id="ticket-priority" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">
                                <option value="low"    ${t.priority === 'low'    ? 'selected' : ''}>Baja</option>
                                <option value="medium" ${t.priority === 'medium' ? 'selected' : ''}>Media</option>
                                <option value="high"   ${t.priority === 'high'   ? 'selected' : ''}>Alta</option>
                                <option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgente</option>
                            </select>
                        </div>
                        <button class="btn btn-primary" onclick="updateTicketMeta(${t.id})">Guardar cambios</button>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h3>🎁 Beneficio comercial</h3></div>
                    <div class="card-body">
                        ${t.benefit_applied ? `
                        <div class="alert alert-success" style="margin-bottom:0">
                            ✅ Beneficio aplicado: ${benefitLabel(t.benefit_type)}
                        </div>` : `
                        <div style="display:flex;flex-direction:column;gap:10px">
                            <div>
                                <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Tipo</label>
                                <select id="benefit-type" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px" onchange="updateBenefitValue()">
                                    <option value="discount">🗓 Extender suscripción (días)</option>
                                    <option value="plan_upgrade">⬆️ Cambiar plan</option>
                                    <option value="usage_reset">🔄 Resetear uso</option>
                                </select>
                            </div>
                            <div id="benefit-value-wrap">
                                <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Días a extender</label>
                                <input type="number" id="benefit-value" value="30" min="1" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">
                            </div>
                            <button class="btn btn-success" onclick="applyBenefit(${t.id})">Aplicar beneficio</button>
                        </div>`}
                    </div>
                </div>
            </div>
        </div>`;
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

window.updateBenefitValue = function() {
    const type = document.getElementById('benefit-type').value;
    const wrap = document.getElementById('benefit-value-wrap');
    if (type === 'discount') {
        wrap.innerHTML = '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Días a extender</label><input type="number" id="benefit-value" value="30" min="1" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">';
    } else if (type === 'plan_upgrade') {
        wrap.innerHTML = '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Nuevo plan</label><select id="benefit-value" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px"><option value="BASIC">BASIC</option><option value="PRO" selected>PRO</option><option value="ENTERPRISE">ENTERPRISE</option></select>';
    } else {
        wrap.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Resetea el contador de uso a 0.</p><input type="hidden" id="benefit-value" value="0">';
    }
};

window.replyTicket = async function(id) {
    const msg = document.getElementById('reply-msg').value.trim();
    if (!msg) return;
    try {
        await apiFetch(`/admin/tickets/${id}/comment`, 'POST', { message: msg });
        navigate('ticket-detail', id);
    } catch (e) { showAlert(document.getElementById('td-alert'), e.message); }
};

window.updateTicketMeta = async function(id) {
    const status   = document.getElementById('ticket-status').value;
    const priority = document.getElementById('ticket-priority').value;
    try {
        await Promise.all([
            apiFetch(`/admin/tickets/${id}/status`,   'PUT', { status }),
            apiFetch(`/admin/tickets/${id}/priority`, 'PUT', { priority })
        ]);
        showAlert(document.getElementById('td-alert'), 'Ticket actualizado.', 'success');
        setTimeout(() => navigate('ticket-detail', id), 1000);
    } catch (e) { showAlert(document.getElementById('td-alert'), e.message); }
};

window.applyBenefit = async function(id) {
    const benefit_type  = document.getElementById('benefit-type').value;
    const benefit_value = document.getElementById('benefit-value').value;
    if (!confirm(`¿Aplicar beneficio "${benefitLabel(benefit_type)}"? Esta acción es irreversible.`)) return;
    try {
        await apiFetch(`/admin/tickets/${id}/apply-benefit`, 'POST', { benefit_type, benefit_value });
        showAlert(document.getElementById('td-alert'), 'Beneficio aplicado correctamente.', 'success');
        setTimeout(() => navigate('ticket-detail', id), 1000);
    } catch (e) { showAlert(document.getElementById('td-alert'), e.message); }
};

// ───── SCRIPTS ─────
async function renderScripts() {
    try {
        const data = await apiFetch('/admin/scripts');
        const scripts = data.scripts;

        document.getElementById('content').innerHTML = `
        <div class="page-header">
            <div><h2>Scripts</h2><p>${scripts.length} scripts en el sistema</p></div>
            <div style="display:flex;gap:8px">
                <button class="btn btn-secondary" onclick="warmupCache()">🔥 Precalentar caché</button>
                <button class="btn btn-danger" onclick="clearCache()">🗑 Limpiar caché</button>
                <button class="btn btn-secondary" onclick="reencryptScripts()">🔐 Re-encriptar</button>
            </div>
        </div>
        <div class="card">
            <div class="table-wrapper">
                <table><thead><tr><th>Nombre</th><th>Versión</th><th>Estado</th><th>Hash</th><th>Actualizado</th><th></th></tr></thead>
                <tbody>${scripts.map(s => `<tr>
                    <td><strong>${s.script_name}</strong></td>
                    <td>${s.version}</td>
                    <td>${s.active ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}</td>
                    <td style="font-family:monospace;font-size:11px;color:var(--text-muted)">${s.hash.slice(0,16)}…</td>
                    <td style="font-size:12px">${fmtDate(s.updated_at)}</td>
                    <td><button class="btn btn-sm btn-secondary" onclick="toggleScript('${s.script_name}',${!s.active})">${s.active ? 'Desactivar' : 'Activar'}</button></td>
                </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

window.toggleScript = async function(name, active) {
    try {
        await apiFetch(`/admin/scripts/${name}/toggle`, 'PUT', { active });
        renderScripts();
    } catch (e) { alert(e.message); }
};
window.warmupCache = async function() {
    try { await apiFetch('/admin/cache/warmup', 'POST'); alert('Caché precalentado.'); } catch (e) { alert(e.message); }
};
window.clearCache = async function() {
    if (!confirm('¿Limpiar caché?')) return;
    try { await apiFetch('/admin/cache/clear', 'POST'); alert('Caché limpiado.'); } catch (e) { alert(e.message); }
};
window.reencryptScripts = async function() {
    if (!confirm('¿Re-encriptar todos los scripts? Tardará unos segundos.')) return;
    try { await apiFetch('/admin/scripts/reencrypt', 'POST'); alert('Scripts re-encriptados.'); } catch (e) { alert(e.message); }
};

// ───── MONITOR ─────
async function renderMonitor() {
    const content = document.getElementById('content');
    document.getElementById('topbar-title').textContent = 'Monitor de Partes';

    try {
        const [statsData, partesData] = await Promise.all([
            apiFetch('/admin/monitor/stats'),
            apiFetch('/admin/monitor/partes'),
        ]);

        const stats  = statsData.stats  || {};
        const partes = partesData.partes || [];

        content.innerHTML = `
        <div class="stats-row" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;">
            <div class="stat-card">
                <div class="stat-value">${stats.partes_activas || 0}</div>
                <div class="stat-label">Partes activas</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.expedientes_confirmados || 0}</div>
                <div class="stat-label">Expedientes en base</div>
            </div>
            <div class="stat-card" style="border-left:3px solid #f59e0b;">
                <div class="stat-value">${stats.novedades_pendientes || 0}</div>
                <div class="stat-label">Novedades pendientes</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.consultas_este_mes || 0}</div>
                <div class="stat-label">Consultas este mes</div>
            </div>
        </div>

        <div class="card">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
                <h3>Partes monitoreadas</h3>
                <span style="font-size:13px;color:#6b7280;">${partes.length} parte(s) activa(s)</span>
            </div>
            <div class="card-body" style="padding:0;">
                ${partes.length === 0 ? '<p style="padding:20px;color:#9ca3af;text-align:center;">No hay partes monitoreadas.</p>' : `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Usuario</th>
                            <th>Jurisdicción</th>
                            <th>Nombre de parte</th>
                            <th>Estado base</th>
                            <th>Expedientes</th>
                            <th>Novedades pend.</th>
                            <th>Creada</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${partes.map(p => `
                        <tr>
                            <td>${escHtml(p.user_email || '—')}</td>
                            <td><span class="badge badge-blue">${escHtml(p.jurisdiccion_sigla)}</span></td>
                            <td style="font-weight:500;">${escHtml(p.nombre_parte)}</td>
                            <td>${p.tiene_linea_base
                                ? '<span class="badge badge-green">Base lista</span>'
                                : '<span class="badge badge-yellow">Sin base</span>'}</td>
                            <td style="text-align:center;">${p.exp_confirmados || 0}</td>
                            <td style="text-align:center;">${p.novedades_pendientes > 0
                                ? '<span class="badge badge-red">' + p.novedades_pendientes + '</span>'
                                : '0'}</td>
                            <td>${fmtDate(p.fecha_creacion)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`}
            </div>
        </div>`;

    } catch (e) {
        content.innerHTML = `<div class="alert alert-error">${escHtml(e.message)}</div>`;
    }
}

// ───── HELPERS ─────
function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}
function roleBadge(r) {
    return r === 'admin' ? '<span class="badge badge-purple">Admin</span>' : '<span class="badge badge-gray">Usuario</span>';
}
function statusBadge(s) {
    const m = { active: 'badge-green', cancelled: 'badge-red', expired: 'badge-red', suspended: 'badge-yellow' };
    const l = { active: 'Activo', cancelled: 'Cancelado', expired: 'Expirado', suspended: 'Suspendido' };
    return s ? `<span class="badge ${m[s] || 'badge-gray'}">${l[s] || s}</span>` : '—';
}
// Muestra estado de registro cuando aplica (pendientes), o estado de suscripción para usuarios activos
function registrationStatusBadge(regStatus, subStatus) {
    if (regStatus === 'pending_email')      return '<span class="badge badge-gray">📧 Sin verificar</span>';
    if (regStatus === 'pending_activation') return '<span class="badge badge-warning">⏳ Pend. activación</span>';
    return statusBadge(subStatus);
}
function ticketStatusBadge(s) {
    const m = { open: 'badge-blue', in_progress: 'badge-yellow', resolved: 'badge-green', closed: 'badge-gray' };
    const l = { open: 'Abierto', in_progress: 'En progreso', resolved: 'Resuelto', closed: 'Cerrado' };
    return `<span class="badge ${m[s] || 'badge-gray'}">${l[s] || s}</span>`;
}
function priorityBadge(p) {
    const m = { low: 'badge-gray', medium: 'badge-blue', high: 'badge-yellow', urgent: 'badge-red' };
    const l = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };
    return `<span class="badge ${m[p] || 'badge-gray'}">${l[p] || p}</span>`;
}
function catBadge(c) {
    const m = { technical: 'badge-blue', billing: 'badge-purple', commercial: 'badge-green' };
    return `<span class="badge ${m[c] || 'badge-gray'}">${catLabel(c)}</span>`;
}
function catLabel(c) {
    return { technical: 'Técnico', billing: 'Facturación', commercial: 'Comercial' }[c] || c;
}
function benefitLabel(b) {
    return { discount: 'Extensión de suscripción', plan_upgrade: 'Upgrade de plan', usage_reset: 'Reset de uso' }[b] || b;
}

function renderSubsystemBar(label, used, limit, bonus) {
    if (limit === null || limit === undefined) return '';
    const effectiveLimit = limit === -1 ? null : (limit + (bonus || 0));
    const isUnlimited = limit === -1;
    const pct = isUnlimited ? 0 : (effectiveLimit > 0 ? Math.min(100, Math.round((used / effectiveLimit) * 100)) : 0);
    const barColor = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#3b82f6';
    const limitText = isUnlimited ? 'Ilimitado' : effectiveLimit;
    const bonusText = bonus > 0 ? ` (+${bonus} bonus)` : '';
    return `
        <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                <span style="color:var(--text-muted)">${label}</span>
                <span style="color:var(--text-muted)">${used} / ${limitText}${bonusText}</span>
            </div>
            ${!isUnlimited ? `<div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.3s"></div>
            </div>` : '<div style="font-size:11px;color:#6b7280">Sin límite</div>'}
        </div>
    `;
}

// ───── USUARIOS PENDIENTES ─────
async function renderPendingUsers() {
    try {
        const data = await apiFetch('/admin/users/pending');
        const users = data.users;

        const statusBadge = s => s === 'pending_email'
            ? '<span class="badge badge-gray">Email sin verificar</span>'
            : '<span class="badge badge-warning">Pendiente de activación</span>';

        // Cargar estado del registro para el toggle
        let registerOpen = true;
        try {
            const sr = await apiFetch('/admin/settings');
            registerOpen = sr.settings?.allow_public_register !== 'false';
        } catch { /* usa default */ }

        document.getElementById('content').innerHTML = `
        <div class="page-header">
            <div><h2>Usuarios pendientes de activación</h2><p>${users.length} usuario${users.length !== 1 ? 's' : ''} en espera</p></div>
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
                <span style="font-size:13px;font-weight:500">Registro público</span>
                <button id="btn-toggle-register"
                    onclick="togglePublicRegister()"
                    style="padding:5px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;
                           background:${registerOpen ? '#059669' : '#dc2626'};color:#fff">
                    ${registerOpen ? '✅ Habilitado' : '⛔ Deshabilitado'}
                </button>
            </div>
        </div>
        <div id="pending-alert"></div>
        ${users.length === 0
            ? '<div class="card"><div class="card-body" style="text-align:center;color:var(--text-muted);padding:40px">No hay usuarios pendientes.</div></div>'
            : `<div class="card">
            <div class="table-wrapper">
                <table>
                    <thead><tr>
                        <th>Nombre y Apellido</th><th>CUIT</th><th>Email</th>
                        <th>Plan</th><th>Estado</th><th>Fecha registro</th><th></th>
                    </tr></thead>
                    <tbody>${users.map(u => `
                    <tr>
                        <td>${escHtml(u.nombre || '—')} ${escHtml(u.apellido || '')}</td>
                        <td>${escHtml(u.cuit || '—')}</td>
                        <td>
                            <a href="#" onclick="navigate('user-detail','${u.id}');return false;"
                               style="color:var(--primary);text-decoration:none"
                               title="Ver ficha completa del usuario">
                                ${escHtml(u.email)}
                            </a>
                        </td>
                        <td>${escHtml(u.plan_display || u.plan_name || '—')}</td>
                        <td>${statusBadge(u.registration_status)}</td>
                        <td style="font-size:12px">${new Date(u.created_at).toLocaleDateString('es-AR')}</td>
                        <td>
                            ${u.registration_status === 'pending_activation'
                                ? `<button class="btn btn-sm btn-primary" onclick="activateUser(${u.id}, '${escHtml(u.email)}')">Activar</button>`
                                : '<span style="font-size:12px;color:var(--text-muted)">Esperando email</span>'}
                        </td>
                    </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`}`;
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

window.verifyEmailManual = async function(userId) {
    if (!confirm('¿Marcar el email de este usuario como verificado manualmente?')) return;
    const alertEl = document.getElementById('ud-alert');
    try {
        await apiFetch(`/admin/users/${userId}/verify-email`, 'POST', {});
        showAlert(alertEl, '✅ Email marcado como verificado. El usuario pasa a "Pendiente de activación".', 'success');
        // Recargar el detalle para reflejar el cambio
        setTimeout(() => navigate('user-detail', userId), 1200);
    } catch (e) {
        showAlert(alertEl, e.message, 'error');
    }
};

window.togglePublicRegister = async function() {
    const btn = document.getElementById('btn-toggle-register');
    if (!btn) return;
    const isOpen = btn.textContent.includes('Habilitado');
    const newValue = !isOpen;
    if (!confirm(`¿${newValue ? 'Habilitar' : 'Deshabilitar'} el registro público de nuevos usuarios?`)) return;
    btn.disabled = true;
    try {
        await apiFetch('/admin/settings', 'PUT', { key: 'allow_public_register', value: String(newValue) });
        btn.style.background = newValue ? '#059669' : '#dc2626';
        btn.textContent = newValue ? '✅ Habilitado' : '⛔ Deshabilitado';
    } catch (e) {
        alert('Error al actualizar la configuración: ' + e.message);
    } finally {
        btn.disabled = false;
    }
};

window.resendVerification = async function(userId, email) {
    if (!confirm(`¿Reenviar el email de verificación a ${email}?`)) return;
    const alertEl = document.getElementById('ud-alert');
    try {
        const data = await apiFetch(`/admin/users/${userId}/resend-verification`, 'POST', {});
        showAlert(alertEl, `✉️ ${data.message}`, 'success');
    } catch (e) {
        showAlert(alertEl, e.message, 'error');
    }
};

window.deleteUser = async function(id, email) {
    if (!confirm(`⚠️ ELIMINAR CUENTA\n\n¿Estás seguro que querés eliminar al usuario:\n${email}\n\nEsta acción eliminará permanentemente su cuenta, suscripción, historial de uso y tickets. No se puede deshacer.`)) return;
    if (!confirm(`Segunda confirmación:\n¿Eliminar definitivamente a ${email}?`)) return;
    const alertEl = document.getElementById('ud-alert');
    try {
        await apiFetch(`/admin/users/${id}`, 'DELETE');
        navigate('users');
    } catch (e) {
        showAlert(alertEl, e.message, 'error');
    }
};

window.sendPasswordReset = async function(userId, email) {
    if (!confirm(`¿Enviar email de restablecimiento de contraseña a ${email}?`)) return;
    const alertEl = document.getElementById('ud-alert');
    try {
        const data = await apiFetch('/auth/admin/send-password-reset', 'POST', { userId });
        showAlert(alertEl, `✅ ${data.message}`, 'success');
    } catch (e) {
        showAlert(alertEl, e.message, 'error');
    }
};

const REG_FIELDS = ['reg-nombre','reg-apellido','reg-cuit','reg-status','reg-calle','reg-numero','reg-piso','reg-depto','reg-localidad','reg-provincia'];

window.toggleRegistroEdit = function() {
    REG_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = false; el.style.background = ''; }
    });
    document.getElementById('reg-edit-btn').style.display   = 'none';
    document.getElementById('reg-save-btn').style.display   = '';
    document.getElementById('reg-cancel-btn').style.display = '';
};

window.cancelRegistroEdit = function() {
    REG_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = true; el.style.background = 'var(--bg-secondary)'; }
    });
    document.getElementById('reg-edit-btn').style.display   = '';
    document.getElementById('reg-save-btn').style.display   = 'none';
    document.getElementById('reg-cancel-btn').style.display = 'none';
};

window.saveRegistroData = async function(userId) {
    const alertEl = document.getElementById('ud-alert');
    try {
        await apiFetch(`/admin/users/${userId}/registro`, 'PUT', {
            nombre:              document.getElementById('reg-nombre').value.trim()    || null,
            apellido:            document.getElementById('reg-apellido').value.trim()  || null,
            cuit:                document.getElementById('reg-cuit').value.trim()      || null,
            registration_status: document.getElementById('reg-status').value          || null,
            domicilio: {
                calle:     document.getElementById('reg-calle').value.trim(),
                numero:    document.getElementById('reg-numero').value.trim(),
                piso:      document.getElementById('reg-piso').value.trim()    || undefined,
                depto:     document.getElementById('reg-depto').value.trim()   || undefined,
                localidad: document.getElementById('reg-localidad').value.trim(),
                provincia: document.getElementById('reg-provincia').value.trim(),
            }
        });
        showAlert(alertEl, '✅ Datos de registro actualizados', 'success');
        cancelRegistroEdit();
    } catch (e) {
        showAlert(alertEl, e.message, 'error');
    }
};

window.activateUser = async function(userId, email) {
    if (!confirm(`¿Activar la cuenta de ${email}? Se le asignarán 30 días con los límites de su plan.`)) return;
    try {
        await apiFetch(`/admin/users/${userId}/activate`, 'POST', { expires_days: 30 });
        const alertEl = document.getElementById('pending-alert');
        if (alertEl) showAlert(alertEl, `✅ Usuario ${email} activado correctamente`, 'success');
        setTimeout(() => renderPendingUsers(), 1200);
    } catch (e) {
        const alertEl = document.getElementById('pending-alert');
        if (alertEl) showAlert(alertEl, e.message, 'error');
    }
};

// Activar desde la ficha de usuario (no desde la lista de pendientes)
window.activateUserFromDetail = async function(userId, email) {
    if (!confirm(`¿Activar la cuenta de ${email}?\n\nSe le asignarán 30 días con los límites de su plan actual.`)) return;
    const alertEl = document.getElementById('ud-alert');
    try {
        await apiFetch(`/admin/users/${userId}/activate`, 'POST', { expires_days: 30 });
        showAlert(alertEl, `✅ Cuenta de ${email} activada correctamente.`, 'success');
        setTimeout(() => navigate('user-detail', userId), 1200);
    } catch (e) {
        showAlert(alertEl, e.message, 'error');
    }
};

// Verificar email + activar en un solo paso desde la ficha
window.verifyAndActivateUser = async function(userId, email) {
    if (!confirm(`¿Verificar el email y activar la cuenta de ${email} en un solo paso?\n\nSe le asignarán 30 días con los límites de su plan.`)) return;
    const alertEl = document.getElementById('ud-alert');
    try {
        await apiFetch(`/admin/users/${userId}/verify-email`, 'POST', {});
        await apiFetch(`/admin/users/${userId}/activate`, 'POST', { expires_days: 30 });
        showAlert(alertEl, `✅ Email verificado y cuenta activada para ${email}.`, 'success');
        setTimeout(() => navigate('user-detail', userId), 1200);
    } catch (e) {
        showAlert(alertEl, e.message, 'error');
    }
};

// ───── PLANES ─────
async function renderPlans() {
    try {
        const data = await apiFetch('/admin/plans');
        const plans = data.plans;

        document.getElementById('content').innerHTML = `
        <div class="page-header">
            <div><h2>Planes de suscripción</h2><p>${plans.length} planes configurados</p></div>
            <button class="btn btn-primary" onclick="showPlanForm()">+ Nuevo plan</button>
        </div>
        <div id="plan-alert"></div>
        <div id="plan-form-container" style="display:none"></div>
        <div class="card">
            <div class="table-wrapper">
                <table id="plans-table">
                    <thead><tr>
                        <th>Nombre</th><th>Tipo</th><th>Precio</th>
                        <th>Proc.</th><th>Batch</th><th>Informes</th>
                        <th>Mon. Partes</th><th>Mon. Nov.</th>
                        <th>Promo</th><th>Estado</th><th></th>
                    </tr></thead>
                    <tbody>${plans.map(p => {
                        const fmt = v => v === -1 ? '<span class="badge badge-green">∞</span>' : v;
                        const typeLabel = { electron: '💻 Electron', extension: '🧩 Extensión', combo: '🔗 Combo' };
                        const priceStr = p.price_usd != null ? `$${p.price_usd} USD` : '—';
                        let promoBadge = '—';
                        if (p.promo_type === 'date' && p.promo_end_date) {
                            const d = new Date(p.promo_end_date);
                            const past = d < new Date();
                            promoBadge = `<span class="badge ${past ? 'badge-gray' : 'badge-warning'}" title="Vence ${d.toLocaleDateString('es-AR')}">📅 ${d.toLocaleDateString('es-AR')}</span>`;
                        } else if (p.promo_type === 'quota') {
                            const full = p.promo_used_count >= p.promo_max_users;
                            promoBadge = `<span class="badge ${full ? 'badge-gray' : 'badge-warning'}">${p.promo_used_count}/${p.promo_max_users}</span>`;
                        } else if (!p.promo_type && (p.plan_type === 'extension' || p.plan_type === 'combo')) {
                            promoBadge = '<span class="badge badge-green">Indefinida</span>';
                        }
                        return `
                    <tr>
                        <td><strong>${p.name}</strong><br><small style="color:var(--text-muted)">${p.display_name}</small></td>
                        <td><span style="font-size:12px">${typeLabel[p.plan_type] || p.plan_type || '—'}</span></td>
                        <td style="font-size:13px;font-weight:600">${priceStr}</td>
                        <td>${fmt(p.proc_executions_limit)}</td>
                        <td>${fmt(p.batch_executions_limit ?? 20)}</td>
                        <td>${fmt(p.informe_limit)}</td>
                        <td>${fmt(p.monitor_partes_limit)}</td>
                        <td>${fmt(p.monitor_novedades_limit)}</td>
                        <td>${promoBadge}</td>
                        <td>${p.active ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}</td>
                        <td>
                            <button class="btn btn-sm btn-secondary" onclick="showPlanForm(${p.id})">Editar</button>
                            ${p.active
                                ? `<button class="btn btn-sm btn-danger" onclick="deactivatePlan(${p.id})" style="margin-left:4px">Desactivar</button>`
                                : `<button class="btn btn-sm btn-success" onclick="activatePlan(${p.id})" style="margin-left:4px">Activar</button>`}
                        </td>
                    </tr>`}).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    } catch (e) {
        document.getElementById('content').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
}

window.showPlanForm = async function(planId) {
    let plan = null;
    if (planId) {
        try {
            const data = await apiFetch('/admin/plans');
            plan = data.plans.find(p => p.id === planId);
        } catch (e) { alert(e.message); return; }
    }

    const formContainer = document.getElementById('plan-form-container');
    formContainer.style.display = '';
    formContainer.innerHTML = `
    <div class="card" style="margin-bottom:20px">
        <div class="card-header">
            <h3>${plan ? 'Editar plan' : 'Nuevo plan'}</h3>
            <button class="btn btn-sm btn-secondary" onclick="document.getElementById('plan-form-container').style.display='none'">Cancelar</button>
        </div>
        <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${!plan ? `<div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Nombre interno (MAYÚSCULAS)</label>
                    <input type="text" id="pf-name" placeholder="MI_PLAN" value="" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;text-transform:uppercase">
                </div>` : `<div><label style="font-size:12px;display:block;margin-bottom:4px">Nombre</label><span style="font-size:14px;font-weight:600">${plan.name}</span></div>`}
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Nombre a mostrar</label>
                    <input type="text" id="pf-display-name" placeholder="Plan Básico" value="${plan ? escHtml(plan.display_name) : ''}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div style="grid-column:1/-1">
                    <label style="font-size:12px;display:block;margin-bottom:4px">Descripción</label>
                    <input type="text" id="pf-description" placeholder="Descripción del plan..." value="${plan ? escHtml(plan.description || '') : ''}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Procuración — ejecuciones (-1=ilim.)</label>
                    <input type="number" id="pf-proc" value="${plan ? plan.proc_executions_limit : 50}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Procurar Batch — ejecuciones (-1=ilim.)</label>
                    <input type="number" id="pf-batch-exec" value="${plan ? (plan.batch_executions_limit ?? 20) : 20}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Procurar Batch — máx. expedientes/ejecución (-1=ilim.)</label>
                    <input type="number" id="pf-batch-exp" value="${plan ? (plan.batch_expedientes_limit ?? 10) : 10}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Informes (-1=ilimitado)</label>
                    <input type="number" id="pf-informe" value="${plan ? plan.informe_limit : 10}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Monitor Partes simultáneas</label>
                    <input type="number" id="pf-mon-partes" value="${plan ? plan.monitor_partes_limit : 3}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Monitor Novedades por período (-1=ilim.)</label>
                    <input type="number" id="pf-mon-nov" value="${plan ? plan.monitor_novedades_limit : 10}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:12px;display:block;margin-bottom:4px">Período (días)</label>
                    <input type="number" id="pf-period" value="${plan ? plan.period_days : 30}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                </div>
            </div>
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
                <label style="font-size:12px;display:block;margin-bottom:8px;font-weight:600">Flujos de extensión habilitados</label>
                <div style="display:flex;flex-wrap:wrap;gap:10px 20px">
                    ${[
                        { key: 'consulta',       label: 'Consulta' },
                        { key: 'escritos1',      label: 'Escritos 1' },
                        { key: 'escritos2',      label: 'Escritos 2' },
                        { key: 'notif',          label: 'Notificaciones' },
                        { key: 'deox',           label: 'DEOX' }
                    ].map(f => {
                        const checked = plan?.extension_flows?.includes(f.key) ? 'checked' : '';
                        return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                            <input type="checkbox" id="pf-flow-${f.key}" ${checked} style="accent-color:#1a73e8">
                            ${f.label}
                        </label>`;
                    }).join('')}
                </div>
            </div>

            <!-- PRECIO Y TIPO -->
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
                <label style="font-size:12px;display:block;margin-bottom:8px;font-weight:600">Precio y tipo de plan</label>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Precio USD</label>
                        <input type="number" step="0.01" id="pf-price-usd" value="${plan?.price_usd ?? ''}" placeholder="9.99" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Precio ARS</label>
                        <input type="number" step="0.01" id="pf-price-ars" value="${plan?.price_ars ?? ''}" placeholder="9999" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Tipo</label>
                        <select id="pf-plan-type" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                            <option value="electron" ${(plan?.plan_type || 'electron') === 'electron' ? 'selected' : ''}>Electron</option>
                            <option value="extension" ${plan?.plan_type === 'extension' ? 'selected' : ''}>Extensión</option>
                            <option value="combo" ${plan?.plan_type === 'combo' ? 'selected' : ''}>Combo</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- CONFIGURACIÓN DE PROMO -->
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
                <label style="font-size:12px;display:block;margin-bottom:8px;font-weight:600">Configuración de promoción</label>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:end">
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Tipo de límite</label>
                        <select id="pf-promo-type" onchange="togglePromoFields()" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                            <option value="" ${!plan?.promo_type ? 'selected' : ''}>Sin límite (indefinida)</option>
                            <option value="date" ${plan?.promo_type === 'date' ? 'selected' : ''}>Por fecha de vencimiento</option>
                            <option value="quota" ${plan?.promo_type === 'quota' ? 'selected' : ''}>Por cupo de usuarios</option>
                        </select>
                    </div>
                    <div id="pf-promo-date-wrap" style="display:${plan?.promo_type === 'date' ? 'block' : 'none'}">
                        <label style="font-size:12px;display:block;margin-bottom:4px">Fecha de vencimiento</label>
                        <input type="datetime-local" id="pf-promo-date" value="${plan?.promo_end_date ? plan.promo_end_date.slice(0,16) : ''}" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                    </div>
                    <div id="pf-promo-quota-wrap" style="display:${plan?.promo_type === 'quota' ? 'block' : 'none'}">
                        <label style="font-size:12px;display:block;margin-bottom:4px">Cupo máximo de usuarios</label>
                        <input type="number" id="pf-promo-quota" value="${plan?.promo_max_users ?? ''}" placeholder="50" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:12px;display:block;margin-bottom:4px">Avisar al usuario X días antes</label>
                        <input type="number" id="pf-promo-alert-days" value="${plan?.promo_alert_days ?? 15}" min="1" max="90" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                    </div>
                </div>
                ${plan?.promo_used_count > 0 ? `<p style="margin-top:8px;font-size:12px;color:var(--text-muted)">Registros usando esta promo: <strong>${plan.promo_used_count}</strong></p>` : ''}
            </div>

            <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
                <button class="btn btn-primary" onclick="savePlanForm(${plan ? plan.id : 'null'})">${plan ? 'Guardar cambios' : 'Crear plan'}</button>
            </div>
        </div>
    </div>`;
};

window.togglePromoFields = function() {
    const t = document.getElementById('pf-promo-type').value;
    document.getElementById('pf-promo-date-wrap').style.display  = t === 'date'  ? 'block' : 'none';
    document.getElementById('pf-promo-quota-wrap').style.display = t === 'quota' ? 'block' : 'none';
};

window.savePlanForm = async function(planId) {
    const alertEl = document.getElementById('plan-alert');
    const promoType = document.getElementById('pf-promo-type').value || null;
    const body = {
        display_name:            document.getElementById('pf-display-name').value.trim(),
        description:             document.getElementById('pf-description').value.trim() || null,
        proc_executions_limit:   parseInt(document.getElementById('pf-proc').value),
        batch_executions_limit:  parseInt(document.getElementById('pf-batch-exec').value),
        batch_expedientes_limit: parseInt(document.getElementById('pf-batch-exp').value),
        informe_limit:           parseInt(document.getElementById('pf-informe').value),
        monitor_partes_limit:    parseInt(document.getElementById('pf-mon-partes').value),
        monitor_novedades_limit: parseInt(document.getElementById('pf-mon-nov').value),
        period_days:             parseInt(document.getElementById('pf-period').value),
        extension_flows:         ['consulta','escritos1','escritos2','notif','deox']
                                     .filter(k => document.getElementById(`pf-flow-${k}`)?.checked),
        price_usd:    document.getElementById('pf-price-usd').value ? parseFloat(document.getElementById('pf-price-usd').value) : null,
        price_ars:    document.getElementById('pf-price-ars').value ? parseFloat(document.getElementById('pf-price-ars').value) : null,
        plan_type:    document.getElementById('pf-plan-type').value || null,
        promo_type:   promoType,
        promo_end_date:   promoType === 'date'  ? (document.getElementById('pf-promo-date').value || null) : null,
        promo_max_users:  promoType === 'quota' ? (parseInt(document.getElementById('pf-promo-quota').value) || null) : null,
        promo_alert_days: parseInt(document.getElementById('pf-promo-alert-days').value) || 15,
    };

    try {
        if (planId) {
            await apiFetch(`/admin/plans/${planId}`, 'PUT', body);
            showAlert(alertEl, 'Plan actualizado correctamente.', 'success');
        } else {
            const nameEl = document.getElementById('pf-name');
            body.name = nameEl ? nameEl.value.trim().toUpperCase() : '';
            if (!body.name) { showAlert(alertEl, 'El nombre es obligatorio.'); return; }
            await apiFetch('/admin/plans', 'POST', body);
            showAlert(alertEl, 'Plan creado correctamente.', 'success');
        }
        document.getElementById('plan-form-container').style.display = 'none';
        setTimeout(() => renderPlans(), 1200);
    } catch (e) { showAlert(alertEl, e.message); }
};

window.deactivatePlan = async function(planId) {
    if (!confirm('¿Desactivar este plan? Los usuarios con este plan no perderán su suscripción actual.')) return;
    try {
        await apiFetch(`/admin/plans/${planId}`, 'DELETE');
        showAlert(document.getElementById('plan-alert') || document.getElementById('content'), 'Plan desactivado.', 'success');
        setTimeout(() => renderPlans(), 1000);
    } catch (e) { alert(e.message); }
};

window.activatePlan = async function(planId) {
    if (!confirm('¿Activar este plan? Quedará disponible para asignarlo a usuarios.')) return;
    try {
        await apiFetch(`/admin/plans/${planId}/activate`, 'PATCH');
        showAlert(document.getElementById('plan-alert') || document.getElementById('content'), 'Plan activado.', 'success');
        setTimeout(() => renderPlans(), 1000);
    } catch (e) { alert(e.message); }
};

window.applyUsageAdjustment = async function(userId, unlimited = false) {
    const subsystem = document.getElementById('adj-subsystem').value;
    const reason    = document.getElementById('adj-reason').value.trim();
    const ticketId  = document.getElementById('adj-ticket').value || null;

    if (unlimited) {
        const label = subsystem === 'global' ? 'uso global' : subsystem;
        if (!confirm(`¿Establecer ${label} como ILIMITADO para este usuario?`)) return;
    }

    const amount = unlimited ? null : parseInt(document.getElementById('adj-amount').value);
    if (!unlimited && (!amount || isNaN(amount))) { alert('Cantidad inválida'); return; }

    try {
        const result = await apiFetch(`/admin/subscriptions/${userId}/adjust`, 'POST', {
            subsystem, amount, unlimited, reason: reason || null, ticket_id: ticketId ? parseInt(ticketId) : null
        });
        const msg = unlimited
            ? `🔓 ${subsystem === 'global' ? 'Uso global' : subsystem} establecido como ilimitado`
            : subsystem === 'global'
            ? `Ajuste aplicado: ${amount > 0 ? '+' : ''}${amount} al uso global. Nuevo valor: ${result.newUsageCount}`
            : `Ajuste aplicado: ${amount > 0 ? '+' : ''}${amount} de ${subsystem}. Nuevo bonus: ${result.newBonus}`;
        showAlert(document.getElementById('ud-alert'), msg, 'success');
        loadAdjustmentHistory(userId);
        setTimeout(() => navigate('user-detail', userId), 1500);
    } catch (e) { showAlert(document.getElementById('ud-alert'), e.message); }
};

async function loadAdjustmentHistory(userId) {
    const histEl    = document.getElementById('adj-history');
    const loadingEl = document.getElementById('adj-history-loading');
    if (!histEl) return;

    try {
        const data = await apiFetch(`/admin/subscriptions/${userId}/adjustments`);
        const adjs = data.adjustments || [];
        if (loadingEl) loadingEl.style.display = 'none';

        if (adjs.length === 0) {
            histEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted)">Sin ajustes previos.</div>';
            return;
        }

        const subsysLabel = { global: 'Global', proc: 'Procuración', batch: 'Batch', informe: 'Informes', monitor_novedades: 'Mon. Novedades', monitor_partes: 'Mon. Partes' };
        histEl.innerHTML = `
        <div class="table-wrapper" style="max-height:200px;overflow-y:auto">
            <table style="font-size:12px">
                <thead><tr><th>Subsistema</th><th>Cantidad</th><th>Motivo</th><th>Admin</th><th>Fecha</th></tr></thead>
                <tbody>${adjs.map(a => `<tr>
                    <td>${subsysLabel[a.subsystem] || a.subsystem}</td>
                    <td style="color:${a.amount > 0 ? '#16a34a' : '#dc2626'};font-weight:600">${a.amount > 0 ? '+' : ''}${a.amount}</td>
                    <td style="color:var(--text-muted)">${a.reason || '—'}</td>
                    <td style="font-size:11px">${a.admin_email || '—'}</td>
                    <td style="font-size:11px">${fmtDate(a.created_at)}</td>
                </tr>`).join('')}</tbody>
            </table>
        </div>`;
    } catch (e) {
        if (histEl) histEl.innerHTML = `<div style="font-size:12px;color:#ef4444">${e.message}</div>`;
    }
}
