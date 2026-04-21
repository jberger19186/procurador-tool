// popup.js — selección de flujo, autenticación y arranque del flow
// Depende de: config.js, auth.js (cargados antes en popup.html)

const JURIS_MAP = {
  CSJ: "0",  CIV: "1",  CAF: "2",  CCF: "3",  CNE: "4",  CSS: "5",  CPE: "6",
  CNT: "7",  CFP: "8",  CCC: "9",  COM: "10", CPF: "11", CPN: "12", FBB: "13",
  FCR: "14", FCB: "15", FCT: "16", FGR: "17", FLP: "18", FMP: "19", FMZ: "20",
  FPO: "21", FPA: "22", FRE: "23", FSA: "24", FRO: "25", FSM: "26", FTU: "27",
};

const FLOW_LABELS = {
  consulta:       "Consulta SCW",
  escritos1:      "Escritos 1 (SCW → escrito)",
  escritos2:      "Escritos 2 (escritos.pjn.gov.ar)",
  notificaciones: "Notificaciones (notif.pjn.gov.ar)",
  deox:           "DEOX (deox.pjn.gov.ar)",
};

// Mapeo de data-flow en el HTML → nombre interno de flujo (notif en bg.js = "notif")
const FLOW_KEY_MAP = {
  consulta:       'consulta',
  escritos1:      'escritos1',
  escritos2:      'escritos2',
  notificaciones: 'notif',
  deox:           'deox',
};

let selectedFlow = null;
let currentEnabledFlows = [];

// ── Saved users (multi-account) ───────────────────────────────────────────────
const SAVED_USERS_KEY = 'pjn_saved_users';

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function getSavedUsers() {
  const data = await chrome.storage.local.get([SAVED_USERS_KEY, 'pjn_saved_credentials']);
  if (data[SAVED_USERS_KEY]) return data[SAVED_USERS_KEY];
  // Migrar formato antiguo (un solo usuario)
  const old = data.pjn_saved_credentials;
  if (old?.email && old?.password) {
    const users = [{ email: old.email, pw: btoa(old.password) }];
    await chrome.storage.local.set({ [SAVED_USERS_KEY]: users });
    await chrome.storage.local.remove('pjn_saved_credentials');
    return users;
  }
  return [];
}

async function saveSavedUser(email, password) {
  const users = (await getSavedUsers()).filter(u => u.email !== email);
  users.unshift({ email, pw: btoa(password) });
  await chrome.storage.local.set({ [SAVED_USERS_KEY]: users.slice(0, 5) });
}

async function removeSavedUser(email) {
  const users = (await getSavedUsers()).filter(u => u.email !== email);
  await chrome.storage.local.set({ [SAVED_USERS_KEY]: users });
  renderSavedUsers(users);
}

function renderSavedUsers(users) {
  const panel = document.getElementById('saved-users-panel');
  const list  = document.getElementById('saved-users-list');

  if (!users || users.length < 2) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  list.innerHTML = users.map(u => `
    <div class="saved-user-item" data-email="${escHtml(u.email)}" data-pw="${escHtml(u.pw)}">
      <div class="saved-user-avatar">${escHtml(u.email[0].toUpperCase())}</div>
      <span class="saved-user-email">${escHtml(u.email)}</span>
      <button class="saved-user-remove" data-email="${escHtml(u.email)}" title="Olvidar cuenta">✕</button>
    </div>
  `).join('');
}

// Event delegation para el selector de cuentas
document.getElementById('saved-users-list').addEventListener('click', async e => {
  const removeBtn = e.target.closest('.saved-user-remove');
  if (removeBtn) {
    e.stopPropagation();
    await removeSavedUser(removeBtn.dataset.email);
    return;
  }
  const item = e.target.closest('.saved-user-item');
  if (item) {
    document.getElementById('login-email').value = item.dataset.email;
    document.getElementById('login-password').value = atob(item.dataset.pw);
    document.getElementById('chk-remember').checked = true;
    document.getElementById('btn-login-submit').click();
  }
});

document.getElementById('btn-use-other').addEventListener('click', () => {
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('chk-remember').checked = false;
  document.getElementById('saved-users-panel').style.display = 'none';
  document.getElementById('login-email').focus();
});

function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// Mostrar versión en el header
document.getElementById('ext-version').textContent = `v${chrome.runtime.getManifest().version}`;

// ── Vistas ──────────────────────────────────────────────────────────────────
function showView(viewId) {
  ['view-loading', 'view-login', 'view-main'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === viewId);
  });
}

// ── Mensajes ─────────────────────────────────────────────────────────────────
function showMsg(elId, txt, type = 'err') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = txt;
  el.className = `msg ${type}`;
}
function clearMsg(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = '';
  el.className = 'msg';
}

// ── Render de flujos según plan ───────────────────────────────────────────────
function renderFlows(enabledFlows) {
  currentEnabledFlows = enabledFlows || [];
  let firstEnabled = null;

  document.querySelectorAll('.flow-btn').forEach(btn => {
    const dataFlow = btn.dataset.flow;                    // valor del HTML (ej: "notificaciones")
    const internalFlow = FLOW_KEY_MAP[dataFlow] ?? dataFlow;
    const enabled = currentEnabledFlows.includes(internalFlow)
                 || currentEnabledFlows.includes(dataFlow);
    const lockBadge = btn.querySelector('.flow-lock');

    btn.classList.remove('locked', 'active');

    if (enabled) {
      btn.disabled = false;
      if (lockBadge) lockBadge.style.display = 'none';
      if (!firstEnabled) firstEnabled = dataFlow;
    } else {
      btn.classList.add('locked');
      btn.disabled = true;
      if (lockBadge) lockBadge.style.display = '';
    }
  });

  // Seleccionar primer flujo disponible
  if (firstEnabled) selectFlow(firstEnabled);
}

function selectFlow(dataFlow) {
  selectedFlow = dataFlow;
  document.querySelectorAll('.flow-btn').forEach(b => b.classList.remove('active'));
  const active = document.querySelector(`.flow-btn[data-flow="${dataFlow}"]`);
  if (active && !active.classList.contains('locked')) active.classList.add('active');
}

// ── Init: verificar sesión al abrir el popup ──────────────────────────────────
(async () => {
  showView('view-loading');

  // Pre-rellenar desde menú contextual (click derecho)
  const stored = await chrome.storage.local.get(['contextExpediente']);
  if (stored.contextExpediente) {
    document.getElementById('exp').value = stored.contextExpediente;
    await chrome.storage.local.remove(['contextExpediente']);
  }

  const session = await PJNAuth.verifySession();

  if (session.valid) {
    showMainView(session.enabledFlows, session.plan);
  } else {
    const users = await getSavedUsers();

    if (users.length === 1) {
      // Un solo usuario guardado: auto-login silencioso
      const result = await PJNAuth.login(users[0].email, atob(users[0].pw));
      if (result.success) {
        const session2 = await PJNAuth.verifySession();
        showMainView(session2.valid ? session2.enabledFlows : result.enabledFlows, session2.plan);
        return;
      }
      // Auto-login falló — pre-cargar form con aviso
      document.getElementById('login-email').value = users[0].email;
      document.getElementById('login-password').value = atob(users[0].pw);
      document.getElementById('chk-remember').checked = true;
      showMsg('login-msg', 'Sesión expirada. Verificá tus credenciales.', 'err');
    } else if (users.length > 1) {
      // Múltiples usuarios: mostrar selector, pre-cargar el primero en el form
      renderSavedUsers(users);
      document.getElementById('login-email').value = users[0].email;
      document.getElementById('login-password').value = atob(users[0].pw);
      document.getElementById('chk-remember').checked = true;
    } else {
      // Sin credenciales guardadas: solo pre-cargar email de sesión si existe
      const cached = await PJNAuth.loadSession();
      if (cached?.email) {
        document.getElementById('login-email').value = cached.email;
        document.getElementById('login-password').focus();
      }
    }
    showView('view-login');
  }
})();

function showMainView(enabledFlows, plan) {
  PJNAuth.loadSession().then(session => {
    if (session?.email) {
      document.getElementById('user-email-label').textContent = session.email;
    }
    if (plan) {
      const badge = document.getElementById('plan-badge-label');
      badge.textContent = plan;
      badge.className = `plan-badge ${plan}`;
    }
  });

  // Mostrar banner solo si la versión en storage sigue siendo mayor a la instalada
  chrome.storage.local.get('pjn_update_available').then(data => {
    const info = data.pjn_update_available;
    if (!info) return;
    const localNow = chrome.runtime.getManifest().version;
    const isStillPending = semverGt(info.serverVersion, localNow);
    if (!isStillPending) {
      chrome.storage.local.remove('pjn_update_available');
      return;
    }
    document.getElementById('upd-msg').textContent =
      `v${localNow} → v${info.serverVersion}`;
    document.getElementById('update-banner').classList.add('visible');
  });

  renderFlows(enabledFlows);
  showView('view-main');
  document.getElementById('exp').focus();
}

// Botón "Abrir app" → página guiada con token en hash (no llega al servidor)
document.getElementById('upd-btn-electron').addEventListener('click', async () => {
  const session = await PJNAuth.loadSession();
  const hash = session?.token ? '#' + session.token : '';
  chrome.tabs.create({ url: `https://api.procuradortool.com/descargar${hash}` });
  window.close();
});

// Botón "Descargar ZIP" → abre página guiada con descarga + instrucciones paso a paso
document.getElementById('upd-btn-download').addEventListener('click', async () => {
  const session = await PJNAuth.loadSession();
  const hash = session?.token ? '#' + session.token : '';
  chrome.tabs.create({ url: `https://api.procuradortool.com/descargar${hash}` });
  window.close();
});

// ── Selector de flujo ─────────────────────────────────────────────────────────
document.querySelectorAll('.flow-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('locked')) return;
    selectFlow(btn.dataset.flow);
    clearMsg('msg');
    document.getElementById('exp').focus();
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById('login-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-password').focus();
});
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-login-submit').click();
});

document.getElementById('btn-login-cancel').addEventListener('click', () => window.close());

document.getElementById('link-register').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://api.procuradortool.com/register' });
  window.close();
});

document.getElementById('link-forgot').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://api.procuradortool.com/auth/forgot-password' });
  window.close();
});

document.getElementById('btn-login-submit').addEventListener('click', async () => {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  clearMsg('login-msg');

  if (!email || !password) {
    showMsg('login-msg', 'Completá email y contraseña', 'err');
    return;
  }

  const btn = document.getElementById('btn-login-submit');
  btn.disabled = true;
  btn.textContent = 'Ingresando…';

  const result = await PJNAuth.login(email, password);

  btn.disabled = false;
  btn.textContent = 'Ingresar';

  if (result.success) {
    if (document.getElementById('chk-remember').checked) {
      await saveSavedUser(email, password);
    }
  }

  if (result.success) {
    // Refrescar session para obtener plan
    const session2 = await PJNAuth.verifySession();
    showMainView(session2.valid ? session2.enabledFlows : result.enabledFlows, session2.plan);
  } else {
    showMsg('login-msg', result.error || 'Error de autenticación', 'err');
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  await PJNAuth.logout();
  // No borrar cuentas guardadas — solo limpiar el form y volver al login
  const users = await getSavedUsers();
  document.getElementById('login-email').value = users[0]?.email || '';
  document.getElementById('login-password').value = users[0]?.pw ? atob(users[0].pw) : '';
  document.getElementById('chk-remember').checked = users.length > 0;
  renderSavedUsers(users);
  clearMsg('login-msg');
  showView('view-login');
});

// ── Validación del expediente ─────────────────────────────────────────────────
function parseExpediente(raw) {
  const m = String(raw).trim().toUpperCase().match(/^([A-Z]{2,3})\s+(\d{1,10})\/(\d{4})$/);
  if (!m) throw new Error('Formato inválido. Use p.ej.: FCR 18745/2017');
  const [, sigla, numero, anio] = m;
  const jurisdiccion = JURIS_MAP[sigla];
  if (!jurisdiccion) throw new Error(`Sigla desconocida: ${sigla}`);
  return { sigla, numero, anio, jurisdiccion };
}

// ── Enter en input dispara Aceptar ────────────────────────────────────────────
document.getElementById('exp').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-ok').click();
});

// ── Cancelar ──────────────────────────────────────────────────────────────────
document.getElementById('btn-cancel').addEventListener('click', () => window.close());

// ── Aceptar ───────────────────────────────────────────────────────────────────
document.getElementById('btn-ok').addEventListener('click', async () => {
  clearMsg('msg');

  if (!selectedFlow) {
    showMsg('msg', 'Seleccioná un flujo primero', 'err');
    return;
  }

  try {
    const expedienteData = parseExpediente(document.getElementById('exp').value);

    // El flujo en background.js usa la clave corta ("notif", no "notificaciones")
    const internalFlow = FLOW_KEY_MAP[selectedFlow] ?? selectedFlow;

    await chrome.storage.local.set({ expedienteData, selectedFlow: internalFlow });
    await chrome.runtime.sendMessage({ type: 'START_FLOW', flow: internalFlow });

    showMsg('msg', `Abriendo ${FLOW_LABELS[selectedFlow] ?? internalFlow}…`, 'ok');
    setTimeout(() => window.close(), 600);
  } catch (e) {
    showMsg('msg', e.message || String(e), 'err');
  }
});
