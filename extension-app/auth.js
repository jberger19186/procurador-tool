// auth.js — Módulo de autenticación de la extensión PJN
// Gestiona: login con backend, almacenamiento de JWT, heartbeat,
// y consulta de flujos habilitados según plan.
//
// Uso en background.js:  importScripts('config.js', 'auth.js')
// Uso en popup.html:     <script src="config.js"></script>
//                        <script src="auth.js"></script>

// ── Claves en chrome.storage.local ──────────────────────────────────────────
const AUTH_STORAGE_KEY     = 'pjn_ext_auth';      // { token, email, enabledFlows, expiresAt }
const AUTH_REFRESH_ALARM   = 'pjn_token_refresh'; // nombre del alarm para refresh automático

// ── Helpers HTTP ─────────────────────────────────────────────────────────────
function fetchWithTimeout(url, options, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

async function apiPost(path, body, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${EXT_CONFIG.BACKEND_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function apiGet(path, token) {
  const res = await fetchWithTimeout(`${EXT_CONFIG.BACKEND_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Almacenamiento de sesión ─────────────────────────────────────────────────
async function saveSession(token, email, enabledFlows, expiresAt) {
  await chrome.storage.local.set({
    [AUTH_STORAGE_KEY]: { token, email, enabledFlows, expiresAt }
  });
}

async function loadSession() {
  const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  return stored[AUTH_STORAGE_KEY] || null;
}

async function clearSession() {
  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
  // Cancelar alarm de refresh si existe
  try { await chrome.alarms.clear(AUTH_REFRESH_ALARM); } catch (_) {}
}

// ── Verificar si el token está vigente ───────────────────────────────────────
function isTokenExpired(session) {
  if (!session?.token) return true;
  try {
    // Decodificar payload (sin verificar firma — el backend lo verifica en cada request)
    const payload = JSON.parse(atob(session.token.split('.')[1]));
    return (payload.exp * 1000) < Date.now();
  } catch (_) {
    return true;
  }
}

// ── Login con el backend ─────────────────────────────────────────────────────
// Retorna: { success, email, enabledFlows } | { success: false, error }
async function extLogin(email, password) {
  try {
    const { ok, data } = await apiPost('/auth/extension-login', { email, password });
    if (ok && data.success) {
      const { token, extension } = data;
      const enabledFlows = extension?.enabledFlows ?? [];
      const expiresAt    = extension?.expiresAt ?? null;
      await saveSession(token, email, enabledFlows, expiresAt);
      scheduleTokenRefresh();
      return { success: true, email, enabledFlows };
    }
    return { success: false, error: data.error || 'Error de autenticación' };
  } catch (e) {
    console.error('[PJN-ext] extLogin error:', e);
    return { success: false, error: 'No se pudo conectar con el servidor' };
  }
}

// ── Logout ───────────────────────────────────────────────────────────────────
async function extLogout() {
  const session = await loadSession();
  if (session?.token) {
    // Notificar al backend (best-effort; no bloquear si falla)
    apiPost('/auth/logout', {}, session.token).catch(() => {});
  }
  await clearSession();
}

// ── Verificar sesión y obtener flujos actualizados ───────────────────────────
// Llama a /client/extension-auth para refrescar enabledFlows sin re-login.
// Retorna: { valid: true, enabledFlows } | { valid: false, reason }
async function verifySession() {
  const session = await loadSession();
  if (!session) return { valid: false, reason: 'no_session' };

  if (isTokenExpired(session)) {
    // Intentar refresh automático
    const refreshed = await refreshToken();
    if (!refreshed) {
      await clearSession();
      return { valid: false, reason: 'token_expired' };
    }
    // Volver a cargar la sesión actualizada
    return verifySession();
  }

  try {
    const { ok, status, data } = await apiGet('/client/extension-auth', session.token);
    if (ok && data.success) {
      // Actualizar flujos en storage (pueden haber cambiado si admin modificó el plan)
      const updated = { ...session, enabledFlows: data.enabledFlows };
      await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: updated });
      return { valid: true, enabledFlows: data.enabledFlows, plan: data.plan };
    }
    if (status === 403) {
      await clearSession();
      return { valid: false, reason: data.action || 'subscription_inactive' };
    }
    // Fallo de red u otro error — usar caché local
    return { valid: true, enabledFlows: session.enabledFlows ?? [] };
  } catch (_) {
    // Sin conexión — confiar en sesión local si el token no venció
    return { valid: true, enabledFlows: session.enabledFlows ?? [] };
  }
}

// ── Obtener flujos habilitados (versión rápida sin red) ───────────────────────
async function getEnabledFlowsCached() {
  const session = await loadSession();
  if (!session || isTokenExpired(session)) return null;
  return session.enabledFlows ?? [];
}

// Aliases entre nombres internos del background y nombres en la BD
const FLOW_ALIASES = {
  'notif': 'notificaciones',
};

// ── Verificar si un flujo específico está habilitado antes de ejecutarlo ──────
// Esta función realiza una verificación online para prevenir elusión de controles.
async function canUseFlow(flowName) {
  const result = await verifySession();
  if (!result.valid) return { allowed: false, reason: result.reason };
  // Chequear tanto el nombre interno como el alias de la BD
  const alias = FLOW_ALIASES[flowName] || flowName;
  const allowed = result.enabledFlows.includes(flowName) || result.enabledFlows.includes(alias);
  console.log(`[PJN-auth] canUseFlow("${flowName}") → enabledFlows=${JSON.stringify(result.enabledFlows)} → allowed=${allowed}`);
  return {
    allowed,
    reason: allowed ? null : 'flow_not_in_plan',
    requiredPlan: getMinPlanForFlow(flowName)
  };
}

function getMinPlanForFlow(flow) {
  const flowPlans = {
    consulta:       'BASIC',
    escritos2:      'BASIC',
    escritos1:      'PRO',
    notificaciones: 'ENTERPRISE',
    deox:           'ENTERPRISE',
  };
  return flowPlans[flow] ?? 'PRO';
}

// ── Refresh automático del token ─────────────────────────────────────────────
async function refreshToken() {
  const session = await loadSession();
  if (!session?.token) return false;
  try {
    const { ok, data } = await apiPost('/auth/refresh', {}, session.token);
    if (ok && data.success && data.token) {
      await chrome.storage.local.set({
        [AUTH_STORAGE_KEY]: { ...session, token: data.token }
      });
      scheduleTokenRefresh();
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

// Programa el alarm de refresh usando chrome.alarms (persiste aunque el SW duerma)
function scheduleTokenRefresh() {
  const intervalMin = Math.floor(EXT_CONFIG.TOKEN_REFRESH_INTERVAL / 60000);
  chrome.alarms.create(AUTH_REFRESH_ALARM, { delayInMinutes: intervalMin });
}

// Escuchar el alarm de refresh (registrar en background.js)
// Exportamos la función para que background.js la conecte al listener de alarms.
// eslint-disable-next-line no-unused-vars
async function handleRefreshAlarm(alarm) {
  if (alarm.name !== AUTH_REFRESH_ALARM) return;
  const ok = await refreshToken();
  if (!ok) {
    console.warn('[PJN-ext] Refresh falló — sesión puede expirar pronto');
  }
}

// ── Exports como objeto global (MV3 service worker / popup context) ───────────
// eslint-disable-next-line no-var
var PJNAuth = {
  login:               extLogin,
  logout:              extLogout,
  verifySession,
  getEnabledFlowsCached,
  canUseFlow,
  loadSession,
  clearSession,
  handleRefreshAlarm,
  isTokenExpired,
};
