/* =============================================
   Portal de Usuario — Procurador SCW
   app.js — SPA principal
   ============================================= */

'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'psc_user_token';
const BASE_URL = '';  // Misma origin

// ─── STATE ────────────────────────────────────────────────────────────────────
// F2 (2026-08-31): extraído a una función (no un objeto literal suelto) para que
// doLogout() pueda pedir una copia nueva y completa en vez de tener una segunda
// lista incompleta de qué resetear — ver el comentario en doLogout().
function freshState() {
    return {
        token: null,
        account: null,
        currentSection: 'plan',
        tickets: [],
        currentTicket: null,
        chatMessages: [],
        chatLoading: false,
        plans: [],
        bitacora: {
            view: 'mes',            // 'mes' | 'semana' | 'lista'
            monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            selectedDay: null,      // 'YYYY-MM-DD'
            tipo: '',                // filtro por chip ('' = todos)
            estado: '',
            expedienteId: '',
            search: '',
            entries: [],            // último listado cargado (según filtros/rango vigente)
            expedientes: [],        // fichas del usuario, para el <select> de vínculo/filtro
            feriados: new Set(),    // 'YYYY-MM-DD' del año(s) cargado(s), para el cálculo de plazos
            _cache: new Map(),       // id → entrada, alimentado por cada fetch (avisos/mes/lista)
            _feriadosYears: new Set(),
            _lastDoneAction: null,   // { id, done } — el último toggle, para deshacer con Ctrl+Z
        },
        miExp: {
            loaded: false,
            list: [],           // último listado de expedientes seguidos
            search: '',
            fichaId: null,       // id de la ficha abierta (null = vista listado)
            ficha: null,         // { expediente, entradas, snapshots } de la ficha abierta
            selected: new Set(), // ids tildados en el listado, para borrado múltiple
            _visibleIds: [],      // ids que pasan el filtro vigente (para "seleccionar todo")
            _eliminarIds: null,   // ids objetivo del modal de eliminar abierto (1 o varios)
            _exportMultiIds: null, // ids objetivo del modal de exportar, cuando viene de "Exportar seleccionados" (varios)
        },
        captureLote: null,      // { casos, origen, tipo } — pantalla de revisión del lote (F2.3)
    };
}
const state = freshState();

// ─── UTILS ────────────────────────────────────────────────────────────────────
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function saveToken(t) {
    localStorage.setItem(TOKEN_KEY, t);
    state.token = t;
}

// H-COV-Z2-01 (auditoría 2026-09) — lee el payload de un JWT SIN verificar la firma.
// Es para ENRUTAR del lado del cliente (¿este token es mío? ¿está vencido?), nunca
// para autorizar: la verificación real la hace el servidor en cada request. Devuelve
// null si no es un JWT bien formado.
// El `replace` de base64url (`-`→`+`, `_`→`/`) es necesario: atob() no lo entiende.
function parseJwtPayload(t) {
    try {
        const b64 = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(b64));
    } catch (_) {
        return null;
    }
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
        // F2 (2026-08-31): clonar ANTES de leer el body. El body de un Response solo se
        // puede leer UNA vez — sin clonar, cualquier 403 que NO fuera por token (ej. el
        // checkout bloqueado por cuenta sin activar, un guard de plan) dejaba el body de
        // `res` ya consumido acá adentro, y el caller (el patrón de TODO este archivo es
        // `const res = await apiFetch(...); ...; await res.json()`) reventaba con "Body
        // is unusable: Body has already been read" — capturado por su propio try/catch,
        // mostrando "Error de conexión" en vez del mensaje real que el backend ya había
        // devuelto correctamente. Verificado con Response reales (no mocks): sin clone(),
        // la 2da lectura lanza; con clone(), ambas lecturas devuelven el mismo JSON.
        const data = await res.clone().json().catch(() => ({}));
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

// F2 (2026-08-31, code-review): escapeHtml() NO alcanza para un valor interpolado dentro
// de un string-literal JS embebido en un atributo onclick="...('${valor}')" — no escapa
// comillas simples en absoluto, así que un email/nombre con un apóstrofe (válido por RFC
// 5322 para emails, y de tipeo libre para el nombre de una parte en Monitor) rompe el
// string y ejecuta JS arbitrario con la sesión del usuario al hacer un solo clic.
// Verificado con parse5 + compilación real del atributo decodificado: escapeHtml() deja
// pasar el ataque intacto. Un intento previo de tapar esto en un solo sitio
// (escapeHtml(x).replace(/'/g,"\\'")) también resultó bypasseable: un backslash puesto a
// propósito justo antes del apóstrofe original hace que el \\' resultante se lea como
// "backslash escapado" + comilla SUELTA, cerrando el string igual — confirmado con el
// mismo harness. La única forma correcta es escapar PRIMERO para sintaxis de
// string-literal JS (\ y ' con backslash) y RECIÉN DESPUÉS para el atributo HTML que lo
// envuelve, en ese orden — mismo fix ya aplicado en dashboard.js (escJsAttr) por el mismo
// motivo. Usar SIEMPRE que un valor de texto libre se interpole dentro de un
// string-literal JS en un onclick (no para texto visible o value="", donde escapeHtml()
// sigue siendo correcto).
function escJsAttr(str) {
    return String(str ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
        // F2 (2026-08-31): la clase `modal-overlay` es lo que initPortalTabDedup()
        // busca (`.modal-overlay:not(.hidden)`) para no cerrar una pestaña con "algo
        // a medio escribir" — sin ella, este overlay (creado dinámicamente, sin la
        // clase de los 9 modales estáticos del HTML) era invisible para ese guard:
        // una confirmación pendiente (ej. "¿Eliminar la parte X? No se puede
        // deshacer.") se descartaba en silencio si se abría una pestaña nueva del
        // portal mientras estaba abierta. El z-index/background inline siguen
        // ganando sobre la regla de la clase (más específicos); lo único que suma
        // es el blur de fondo, ya consistente con el resto de los modales.
        overlay.className = 'modal-overlay';
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
    // F2 (2026-08-31): btoa() lanza InvalidCharacterError para cualquier char
    // fuera de Latin-1 (emoji, comillas tipográficas, alfabetos no latinos) — la
    // política de contraseñas del proyecto no restringe el juego de caracteres,
    // así que una contraseña legítima con uno de esos caracteres es perfectamente
    // posible. Esta función se llama DENTRO del try de doLogin(), antes de
    // guardar el token — sin este try/catch, el login entero fallaba con "Error
    // de conexión" pese a que el backend ya había autenticado bien, solo porque
    // "Recordar cuenta" estaba tildado. Es una comodidad, no puede bloquear el
    // login: si no se puede codificar, se omite en silencio.
    let encoded;
    try { encoded = btoa(password); } catch (_) { return; }
    const users = getRememberedUsers().filter(u => u.email !== email);
    users.unshift({ email, pw: encoded }); // mover al frente si ya existía
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(users.slice(0, 5)));
}

function removeRememberedUser(email) {
    const users = getRememberedUsers().filter(u => u.email !== email);
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(users));
    renderRememberedUsers();
}

function fillLoginForm(email, pw) {
    document.getElementById('login-email').value = email;
    // F2 (2026-08-31): atob() puede lanzar si `psc_remembered_users` quedó con una
    // entrada corrupta (edición manual del storage, formato viejo) — sin este
    // try/catch rompía el render de todo el panel de "cuentas recordadas".
    let decoded = '';
    if (pw) { try { decoded = atob(pw); } catch (_) { decoded = ''; } }
    document.getElementById('login-password').value = decoded;
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

    // `<button>` no puede contener otro `<button>` (contenido interactivo dentro
    // de contenido interactivo, inválido por spec) — con eso, el navegador
    // "arreglaba" el HTML cerrando el <button> exterior antes del interior, y la
    // ✕ terminaba como hermano suelto DESPUÉS de la card en el DOM real, no como
    // hijo del flex row → por eso aparecía debajo en vez de alineada a la derecha
    // adentro. El exterior pasa a ser un <div role="button"> (mismo onclick,
    // + manejo de Enter/Espacio para no perder accesibilidad de teclado).
    //
    // El `event.target === this` del onkeydown NO es opcional: el keydown de la ✕
    // burbujea hasta acá, y sin ese filtro un Enter/Espacio sobre "Olvidar cuenta"
    // hacía dos cosas mal a la vez — el preventDefault() anulaba la activación
    // nativa del <button> (no borraba la cuenta) y el this.click() disparaba el
    // onclick de la card (logueaba al usuario en la cuenta que quería olvidar).
    // Con el filtro, el keydown de la ✕ sigue de largo y el navegador le da su
    // click nativo, que es lo que ejecuta removeRememberedUser().
    list.innerHTML = users.map(u => `
        <div class="remembered-user-btn" role="button" tabindex="0"
             onclick="selectRememberedUser('${escJsAttr(u.email)}')"
             onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();this.click();}">
            <div class="remembered-user-avatar">${escapeHtml(u.email[0].toUpperCase())}</div>
            <div class="remembered-user-info">
                <div class="remembered-user-email">${escapeHtml(u.email)}</div>
                <div class="remembered-user-hint">Toca para ingresar</div>
            </div>
            <button type="button" class="remembered-user-remove" onclick="event.stopPropagation(); removeRememberedUser('${escJsAttr(u.email)}')" title="Olvidar cuenta">✕</button>
        </div>
    `).join('');
}

// B.2 (E6, decisión del operador del 2026-09-02): la función recibía la contraseña
// codificada como SEGUNDO ARGUMENTO del `onclick`, o sea escrita dentro del HTML de la
// página de login — visible en el inspector del navegador y al alcance de cualquier
// texto que llegue a inyectarse en ese documento. La decisión fue MANTENER la
// funcionalidad "recordar contraseña" (el riesgo del `localStorage` codificado en
// base64 queda aceptado y documentado, H-FE-04), y sacar solo esta exposición extra:
// el botón pasa únicamente el email y la contraseña se lee del storage recién en el
// momento del clic. Para el usuario no cambia nada.
//
// El markup de la tarjeta NO se tocó: la estructura `<div role="button">` + `<button>`
// interior de la ✕ es la que resolvió el bug de anidamiento de `651e58c` (un `<button>`
// dentro de otro `<button>` es inválido y el navegador lo "reparaba" sacando la ✕ de la
// tarjeta), y el `event.target === this` del `onkeydown` es lo que impide que el Enter
// sobre "Olvidar cuenta" loguee en la cuenta que se quiere olvidar. Cambia un argumento
// del `onclick`, nada más.
function selectRememberedUser(email) {
    const guardado = getRememberedUsers().find(u => u.email === email);
    fillLoginForm(email, guardado ? guardado.pw : '');
    // Scroll al formulario y hacer submit automático
    document.getElementById('login-form').dispatchEvent(new Event('submit'));
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function doLogin(email, password) {
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    const btn = document.getElementById('btn-login');
    // Mismo guard que saveBitacoraEntrada (354fbcc) — ver el comentario ahí.
    if (btn.disabled) return;
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
    // F2 (2026-08-31): antes solo se reseteaban 4 campos — state.bitacora,
    // state.miExp (con la ficha completa de un expediente y sus litigantes, si
    // había una abierta), state.plans, state.captureLote y state.currentTicket
    // seguían con los datos de la cuenta anterior EN MEMORIA. Es una SPA sin
    // recarga de página entre logout y login (acá abajo solo se cambia qué se
    // ve, el JS del módulo sigue vivo) — en una PC/pestaña compartida entre 2
    // cuentas de un mismo estudio, si la cuenta B se loguea justo después de A
    // en la misma pestaña, había una ventana en la que datos de casos
    // judiciales de A podían seguir accesibles hasta que el primer fetch fresco
    // de B los pisara. `state` es `const` (no se puede reasignar) y otras
    // funciones lo referencian por identidad, así que se copian las claves de
    // una instancia nueva encima de la existente — cada Set/Map anidado de
    // bitacora/miExp queda reemplazado, no mutado.
    Object.assign(state, freshState());
    state.currentSection = 'perfil'; // decisión ya existente: la pantalla de login no aterriza en 'plan'
    document.getElementById('app').classList.remove('visible');
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('login-form').reset();
    document.getElementById('login-error').style.display = 'none';
    renderRememberedUsers();
}

// ─── INIT DASHBOARD ───────────────────────────────────────────────────────────
// B.4 (E6, decisión del operador del 2026-09-02, opción (C)): esto ponía el JWT DE
// SESIÓN del usuario — el mismo del portal, 8 h de vida, acceso completo a
// `/usuarios/api/*` — dentro del `href` de dos enlaces permanentes, y la demo lo
// guardaba en el `localStorage` de `procuradortool.com`, un origen sin ningún header de
// seguridad, del que nunca se borraba (el "cerrar sesión" del portal no lo alcanza: son
// orígenes distintos). Eso es el hallazgo H-FE-06 y la mitad de S11.
//
// La puerta de la demo es de EXPERIENCIA, no de seguridad: detrás no hay nada sensible,
// solo capturas ya públicas. Una puerta así no necesita una llave real. Ahora se pasa
// una MARCA con vencimiento (`#demo=1&exp=<epoch>`), sin ninguna credencial: lo peor que
// puede hacer alguien que la copie es ver dos capítulos más de capturas.
//
// El vencimiento se toma del `exp` del propio token del portal, así que la marca no
// sobrevive a la sesión que la originó. Si el token no se puede leer, 8 h (la duración
// que emite `/auth/portal-login`).
//
// Y se arma EN EL CLIC, no al cargar el dashboard: el `href` deja de tener un valor
// vencido pegado durante toda la sesión, y cada apertura lleva su propio vencimiento.
function demoUrlActual() {
    let exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    const token = getToken();
    if (token) {
        try {
            const partes = String(token).split('.');
            if (partes.length === 3) {
                let b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
                while (b64.length % 4) b64 += '=';
                const claims = JSON.parse(atob(b64));
                if (typeof claims.exp === 'number' && claims.exp > 0) exp = claims.exp;
            }
        } catch (_) { /* token ilegible: queda el default de 8 h */ }
    }
    return 'https://procuradortool.com/demo/#demo=1&exp=' + exp;
}

function wireVerDemoLinks() {
    for (const id of ['nav-ver-demo', 'topbar-ver-demo']) {
        const el = document.getElementById(id);
        if (!el || el.dataset.demoWired === '1') continue;
        el.dataset.demoWired = '1';
        el.addEventListener('click', (e) => {
            // Sin sesión no se agrega marca: la demo muestra su gate, como a cualquier
            // visitante. El enlace sigue funcionando (lleva a /demo/ igual).
            if (!getToken()) return;
            e.preventDefault();
            window.open(demoUrlActual(), '_blank', 'noopener');
        });
    }
}

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

    // "Ver demo" — /demo/ vive en un origen distinto (procuradortool.com, no
    // api.procuradortool.com), así que su gate de sesión no puede leer el
    // localStorage del portal directo. Se le pasa por el hash una MARCA con
    // vencimiento (`#demo=1&exp=`), NO el token de sesión — ver `wireVerDemoLinks`
    // y `demoUrlActual` (B.4 / H-FE-06).
    wireVerDemoLinks();

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

    // Deep-link de captura desde un visor (F2.2/F2.3) — prioridad sobre pending_goto
    // (que en este caso también valdría 'bitacora', pero el draft dice además qué
    // modal/pantalla abrir). Sin SSO en el form (eso es F2.6): si no había sesión, el
    // usuario ya pasó por el login normal y esto se consume recién acá.
    const pendingDraftId = sessionStorage.getItem('pending_capture_draft');
    const pendingCapturaError = sessionStorage.getItem('pending_capture_error');
    sessionStorage.removeItem('pending_capture_draft');
    sessionStorage.removeItem('pending_capture_error');

    // B.3-A (fase E11): borrador ya rescatado con la llave de captura antes del
    // login (ver `preReclamarDraftConLlave`). Va primero porque ese id ya se
    // consumió del lado del servidor — reclamarlo de nuevo daría 404.
    //
    // Observación del revisor (fix-reviewer, 2026-09-04): el rescate ocurre ANTES
    // de que exista sesión, así que no sabe todavía quién se va a terminar
    // logueando en esta misma pestaña. En una máquina compartida, si la cuenta A
    // abre el visor sin sesión (rescata su borrador) y quien completa el login es
    // la cuenta B, sin este chequeo B vería el diálogo "¿Confirmás guardar N
    // casos?" sobre contenido que en realidad es de A — el borrador ya no tiene
    // forma de reclamarse de nuevo (server-side quedó consumido), así que la
    // única defensa posible es del lado del cliente: comparar contra quién
    // terminó logueado. Mismo helper (`parseJwtPayload`) que ya usa el branch de
    // SSO normal (línea ~3249) para la misma comparación de identidad.
    if (captureDraftPreReclamado) {
        const draft = captureDraftPreReclamado;
        const draftOwnerId = captureDraftPreReclamadoOwnerId;
        captureDraftPreReclamado = null;
        captureDraftPreReclamadoOwnerId = null;
        const cuentaActualId = parseJwtPayload(getToken() || '').id;
        if (draftOwnerId != null && cuentaActualId != null && String(draftOwnerId) !== String(cuentaActualId)) {
            // Falla cerrado: se descarta en silencio, no se ofrece guardar nada.
            // El borrador ya está consumido del lado del servidor (uso único), así
            // que no hay un "reintentar" — la captura original se pierde, que es
            // preferible a aplicarla a la cuenta equivocada.
        } else {
            sessionStorage.removeItem('pending_goto');
            navigateTo('bitacora');
            await aplicarCaptureDraft(draft);
            return;
        }
    }

    if (pendingDraftId) {
        sessionStorage.removeItem('pending_goto');
        navigateTo('bitacora');
        procesarCaptureDraft(pendingDraftId);
        return;
    }
    if (pendingCapturaError) {
        sessionStorage.removeItem('pending_goto');
        navigateTo('bitacora');
        showToast(mensajeCapturaError(pendingCapturaError), 'error');
        return;
    }

    // Consumir pending_goto (de SSO o de ?goto= persistido en sessionStorage)
    const pendingGoto = sessionStorage.getItem('pending_goto');
    const pendingGotoExp = sessionStorage.getItem('pending_goto_exp');
    const pendingGotoCat = sessionStorage.getItem('pending_goto_cat');
    sessionStorage.removeItem('pending_goto_exp');
    sessionStorage.removeItem('pending_goto_cat');
    if (pendingGoto) {
        sessionStorage.removeItem('pending_goto');
        if (pendingGoto === 'nuevo-ticket') {
            navigateTo('soporte');
            // openNewTicketModal ignora una categoría que no exista en el <select>
            // (busca la option y solo asigna si la encuentra), así que un `cat`
            // inválido en la URL abre el modal sin preselección en vez de romper.
            setTimeout(() => openNewTicketModal(pendingGotoCat || null), 300);
            return;
        }
        // `expediente` NO es una sección del portal — es el pedido "abrime la ficha de
        // este caso", que vive dentro de Mis Expedientes. Sin esta rama, navigateTo()
        // no matchea ningún `section-expediente`, deja TODAS las secciones ocultas y el
        // usuario ve una pantalla en blanco (los links 📁 de los 3 visores caían acá).
        if (pendingGoto === 'expediente') {
            await abrirFichaPorNumero(pendingGotoExp);
            return;
        }
        navigateTo(pendingGoto);
        return;
    }

    // Aterrizaje por defecto: la preferencia home_section del usuario, validada
    // en este mismo punto de uso contra bitacoraEnabled (hallazgo A4) — si el
    // usuario dejó marcada Bitácora como principal y después perdió el plan,
    // sin esta guarda quedaría entrando a una sección con candado en cada login.
    const home = (state.account?.homeSection === 'bitacora' && state.account?.bitacoraEnabled)
        ? 'bitacora' : 'plan';
    navigateTo(home);
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
        if (data.message) showToast(data.message, 'success');
    } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Reenviar email de verificación';
        showToast('Error de conexión. Intentá de nuevo.', 'error');
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
        renderHomePills();
    } catch (e) {
        console.error('Error cargando cuenta:', e);
    }
}

// ─── Píldora "Establecer como principal" (Mi Plan ↔ Bitácora, F1.5) ────────
// Las dos píldoras viven siempre en el DOM (dentro de cada sección) — no hace
// falta re-renderizarlas al navegar, solo cuando cambia state.account (login,
// SSO, o tras guardar la preferencia).
function renderHomePills() {
    const acc = state.account;
    if (!acc) return;

    const home = acc.homeSection === 'bitacora' && acc.bitacoraEnabled ? 'bitacora' : 'plan';

    const pillPlan = document.getElementById('home-pill-plan');
    if (pillPlan) {
        const activo = home === 'plan';
        pillPlan.classList.toggle('active', activo);
        pillPlan.textContent = activo ? '★ Es tu pantalla principal' : '☆ Establecer como principal';
        pillPlan.disabled = activo;
    }

    const pillBit = document.getElementById('home-pill-bitacora');
    if (pillBit) {
        if (!acc.bitacoraEnabled) {
            pillBit.style.display = 'none';
        } else {
            pillBit.style.display = '';
            const activo = home === 'bitacora';
            pillBit.classList.toggle('active', activo);
            pillBit.textContent = activo ? '★ Es tu pantalla principal' : '☆ Establecer como principal';
            pillBit.disabled = activo;
        }
    }
}

async function setHomeSection(section) {
    if (!['plan', 'bitacora'].includes(section)) return;
    if (section === 'bitacora' && !state.account?.bitacoraEnabled) return; // defensa, el botón ni debería estar visible
    if (state.account?.homeSection === section) return; // ya es la actual, nada que hacer

    try {
        const res = await apiFetch('/usuarios/api/profile', { method: 'PUT', body: { home_section: section } });
        if (!res || !res.ok) { showToast('No se pudo guardar la preferencia.', 'error'); return; }
        state.account.homeSection = section;
        renderHomePills();
        showToast(
            section === 'bitacora' ? 'Bitácora establecida como tu pantalla principal.' : 'Mi Plan establecido como tu pantalla principal.',
            'success'
        );
    } catch (e) {
        showToast('Error de conexión.', 'error');
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
    // Bitácora + Mis expedientes: visibles solo si el plan de la cuenta las incluye
    // (plans.bitacora_enabled) — mismo flag para las dos secciones.
    const bitBtn = document.getElementById('nav-bitacora');
    if (bitBtn) {
        bitBtn.style.display = state.account?.bitacoraEnabled ? '' : 'none';
    }
    const mexpBtn = document.getElementById('nav-mis-expedientes');
    if (mexpBtn) {
        mexpBtn.style.display = state.account?.bitacoraEnabled ? '' : 'none';
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
        case 'bitacora': renderBitacora(); break;
        case 'mis-expedientes': renderMisExpedientes(); break;
    }

    // Historial del navegador: que el botón Atrás vuelva a la sección anterior del
    // portal en vez de salir. NO se toca la URL (pushState con '' = misma URL) → sin
    // riesgo para el SSO (#sso=), que de todos modos ya se limpió antes de navegar.
    if (!fromHistory) pushNavState({ _sec: section });
}

// Apila una pantalla en el historial del navegador. La primera de la sesión usa
// replaceState (no hay nada que apilar todavía); el resto empuja una entrada nueva.
// Una pantalla repetida se reemplaza en vez de apilarse, para que Atrás nunca
// parezca "no hacer nada" (pasa al reabrir la misma ficha dos veces seguidas).
function pushNavState(navState) {
    const actual = history.state;
    if (!actual || !actual._sec) { history.replaceState(navState, ''); return; }
    if (actual._sec === navState._sec && (actual._ficha || null) === (navState._ficha || null)) {
        history.replaceState(navState, '');
        return;
    }
    history.pushState(navState, '');
}

// ─── UNA SOLA PESTAÑA DEL PORTAL ──────────────────────────────────────────────
// El portal se abre por DOS caminos y ninguno reusa pestaña por su cuenta:
//   · Botones de la app Electron → `shell.openExternal()`, que entrega la URL al
//     navegador del sistema: SIEMPRE abre una pestaña nueva, no existe el concepto
//     de target al que apuntar.
//   · Links/forms de los visores → `target="procurador_portal"`, que solo reusa
//     dentro del mismo browsing context group; cada visor es un `file://` distinto,
//     así que tampoco encuentra la pestaña anterior.
// El único punto donde ambos caminos convergen es el portal mismo — por eso el
// arreglo vive acá y no en Electron ni en los visores.
//
// Mecanismo: cada pestaña se anuncia al cargar; las ANTERIORES se cierran solas.
// Gana la más nueva porque es la que el usuario está mirando (se acaba de abrir y
// tiene el foco), así que no hace falta traer ninguna al frente — cosa que además
// los navegadores bloquean desde una pestaña de fondo.
//
// ⚠️ Por qué no se pierde trabajo: Chrome solo permite `window.close()` si la
// pestaña la abrió un script O si su historial tiene UNA sola entrada (verificado
// en Chromium antes de escribir esto, no asumido). Una pestaña recién abierta e
// intacta cumple la segunda condición → se cierra. Una en la que el usuario ya
// navegó entre secciones acumuló entradas con pushState → el navegador la protege
// solo. El chequeo de modal abierto de abajo es la misma intención, explícita.
const TAB_BORN_AT = Date.now();

function initPortalTabDedup() {
    if (typeof BroadcastChannel === 'undefined') return; // navegador viejo: sin dedup, igual funciona
    let ch;
    try { ch = new BroadcastChannel('procurador_portal_tabs'); } catch (_) { return; }

    ch.onmessage = (e) => {
        const msg = e.data;
        if (!msg || msg.type !== 'hello') return;
        if (!(msg.bornAt > TAB_BORN_AT)) return;                          // solo cede ante una MÁS nueva
        if (document.querySelector('.modal-overlay:not(.hidden)')) return; // hay algo a medio escribir
        window.close();
    };
    ch.postMessage({ type: 'hello', bornAt: TAB_BORN_AT });
}

// Botón Atrás/Adelante del navegador → navegar entre pantallas del portal (no salir).
// "Pantalla" incluye la ficha de un expediente, no solo la sección: sin el tramo de
// `_ficha`, Atrás desde una ficha abierta salía de Mis Expedientes por completo en
// vez de volver al listado, que es de donde el usuario venía.
window.addEventListener('popstate', (e) => {
    if (!state.token) return; // sin sesión: comportamiento normal del navegador
    const st = e.state;
    const sec = (st && st._sec) || 'plan';
    navigateTo(sec, true);
    if (sec === 'mis-expedientes' && st && st._ficha) {
        openMexpFicha(st._ficha, true);
    }
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

// ─── SIDEBAR DESKTOP (colapsar a solo íconos, mismo patrón que el dashboard admin) ─
const _portalMobileMQ = window.matchMedia('(max-width: 768px)');

// Colapsado, los labels quedan en `font-size:0` y cada nav-item es solo un
// emoji — sin esto son 10 íconos sin nombre. Se usa el `title` nativo y no un
// tooltip por CSS porque `#sidebar` tiene `overflow-y:auto`, y eso fuerza
// `overflow-x` a `auto`: cualquier `::after` que saliera de los 64px de ancho
// quedaría recortado. El nativo se dibuja fuera del elemento, sin recorte.
function _applyNavTooltips() {
    // "Solo íconos" es colapsado Y desktop: bajo el breakpoint mobile el reset
    // del @media devuelve el sidebar a ancho completo con los labels visibles,
    // y ahí el title sobraría (duplicaría el texto que ya se lee).
    const soloIconos = document.body.classList.contains('sidebar-collapsed') && !_portalMobileMQ.matches;
    document.querySelectorAll('#sidebar .nav-item').forEach(item => {
        if (!soloIconos) { item.removeAttribute('title'); return; }
        // El label es texto suelto dentro del <button>: se toman solo los nodos
        // de texto para dejar afuera el <span> del ícono y el del badge.
        const label = [...item.childNodes]
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
        if (label) item.title = label;
    });
}
// Al cruzar el breakpoint el estado "solo íconos" cambia sin que nadie haga
// click (basta redimensionar la ventana), así que los títulos se recalculan.
_portalMobileMQ.addEventListener('change', _applyNavTooltips);

function toggleSidebarDesktop() {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem('portal_sidebar_collapsed', collapsed ? '1' : '0'); } catch (_) {}
    _applyNavTooltips();
}

function _applyPortalSidebarState() {
    // Default: expandido (a diferencia del admin, que arranca colapsado) —
    // preserva la primera impresión actual del portal para usuarios nuevos.
    let collapsed = false;
    try {
        const v = localStorage.getItem('portal_sidebar_collapsed');
        if (v !== null) collapsed = v === '1';
    } catch (_) {}
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    _applyNavTooltips();
}
if (document.readyState !== 'loading') _applyPortalSidebarState();
else document.addEventListener('DOMContentLoaded', _applyPortalSidebarState);

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
    // Mismo guard que saveBitacoraEntrada (354fbcc) — ver el comentario ahí.
    if (btn.disabled) return;

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
    // Mismo guard que saveBitacoraEntrada (354fbcc) — ver el comentario ahí.
    if (btn.disabled) return;

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
            <button class="btn-icon-danger" onclick="deleteMonitorParte(${p.id}, '${escJsAttr(p.nombre_parte)}')">🗑</button>
        </div>
    `).join('');
}

async function deleteMonitorParte(id, nombre) {
    const ok = await showConfirm(`¿Eliminar la parte "${nombre}" y todos sus expedientes asociados? Esta acción no se puede deshacer.`);
    if (!ok) return;
    try {
        const res = await apiFetch(`/monitor/partes/${id}`, { method: 'DELETE' });
        // F2 (2026-08-31): antes se removía la fila SIEMPRE, sin chequear si el DELETE
        // realmente tuvo éxito — apiFetch() no lanza para un error HTTP (solo para un
        // fallo de red), así que un 500/403 real quedaba indistinguible de un éxito: la
        // fila desaparecía de la UI aunque el backend no hubiera borrado nada, hasta que
        // la parte "eliminada" reaparecía sola en el próximo refresh, sin explicación.
        if (!res || !res.ok) {
            showToast('No se pudo eliminar la parte. Intentá de nuevo.', 'error');
            return;
        }
        const row = document.getElementById(`parte-row-${id}`);
        if (row) row.remove();
        // Actualizar contador
        await loadMonitorPartes();
    } catch (e) {
        showToast('Error al eliminar la parte. Intentá de nuevo.', 'error');
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
                <div class="download-item-desc">Procuración automática, informes y monitor de partes · v2.7.58</div>
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
        showToast(e.message || 'Error al descargar. Intentá de nuevo.', 'error');
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
                <button class="btn btn-primary btn-sm" onclick="changePlan('${escJsAttr(p.name)}')">Seleccionar este plan</button>
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
        feedback: 'Comentario',
    };

    container.innerHTML = `<div class="tickets-list">
        ${state.tickets.map(t => {
            const statusClass = `badge badge-${t.status}`;
            const statusLabel = { open: 'Abierto', closed: 'Cerrado', in_progress: 'En progreso', resolved: 'Resuelto' }[t.status] || t.status;
            const catIcon = { technical: '🔧', billing: '💳', commercial: '📋', feedback: '💬' }[t.category] || '🎫';

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
    const categoryLabels = { technical: 'Técnico', billing: 'Facturación', commercial: 'Comercial', feedback: 'Comentario' };

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
                    <button id="btn-submit-comment" class="btn btn-primary btn-sm" onclick="submitComment(${ticket.id})">Enviar comentario</button>
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

    // F2 (2026-08-31): mismo guard que saveBitacoraEntrada (354fbcc) y submitNewTicket
    // (línea ~1695, "Mismo guard que saveBitacoraEntrada") — sin esto, un doble clic
    // (común en conexión lenta) disparaba 2 POST concurrentes y duplicaba el
    // comentario en el ticket. Esta función hermana nunca había recibido el fix.
    const btn = document.getElementById('btn-submit-comment');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;

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
    } finally {
        if (btn) btn.disabled = false;
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
    // Mismo guard que saveBitacoraEntrada (354fbcc) — ver el comentario ahí.
    if (btn.disabled) return;

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
    // F2 (2026-08-31): Promise.allSettled, no Promise.all — con .all(), si CUALQUIERA
    // de las 3 llamadas rechaza (timeout, red inestable en una sola), la promesa
    // combinada rechazaba entera y el catch descartaba TAMBIÉN los resultados de
    // las otras 2 que sí habían tenido éxito: el usuario veía "Sin pagos
    // registrados aún"/"Sin facturas emitidas aún" aunque sí tuviera datos, solo
    // porque una petición no relacionada tuvo un hiccup transitorio. Mismo
    // criterio que F2.1 de Bitácora (documentado en CLAUDE.md): llamadas en
    // paralelo e independientes entre sí.
    let subData = null, payments = [], invoices = [];
    const [subOut, paymentsOut, invoicesOut] = await Promise.allSettled([
        apiFetch('/usuarios/api/subscription/current'),
        apiFetch('/usuarios/api/payments?limit=12'),
        apiFetch('/usuarios/api/invoices?limit=12'),
    ]);
    try {
        const subRes = subOut.status === 'fulfilled' ? subOut.value : null;
        if (subRes && subRes.ok) subData = await subRes.json();
    } catch (e) { /* continua con datos del state */ }
    try {
        const paymentsRes = paymentsOut.status === 'fulfilled' ? paymentsOut.value : null;
        if (paymentsRes && paymentsRes.ok) { const d = await paymentsRes.json(); payments = d.payments || []; }
    } catch (e) { /* continua con datos del state */ }
    try {
        const invoicesRes = invoicesOut.status === 'fulfilled' ? invoicesOut.value : null;
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
                <!-- F2 (2026-08-31): != null, no truthy — el proyecto tiene planes de precio
                     EXPLÍCITO $0 ("cortesía", ej. plan CORTESIA, documentado en CLAUDE.md) con
                     facturas manuales reales; con el chequeo truthy viejo, una factura de $0
                     legítima se mostraba como "—" (dato faltante) en vez de "$0" (monto
                     correcto) — el Historial de pagos, 2 líneas más abajo, nunca tuvo ese bug. -->
                <td style="font-size:13px;padding:8px 6px">$${inv.amount != null ? Number(inv.amount).toLocaleString('es-AR') : '—'}</td>
                <td style="font-size:11px;padding:8px 6px;color:var(--text-muted);font-family:monospace">${inv.cae ? escapeHtml(inv.cae) : '—'}</td>
                <td style="padding:8px 20px 8px 6px">${inv.pdf_url
                    ? `<button onclick="openInvoicePdf(${Number(inv.id)}, this)" class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 10px">Ver PDF</button>`
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

// C1 (revisión 2026-07-25): el PDF ya no es un link directo a /invoices/<archivo> (que se
// servía sin autenticación). Se pide por una ruta autenticada que valida propiedad y se
// abre como blob. La pestaña se abre ANTES del await: si se abriera después, el navegador
// la trata como popup no originado en el click y la bloquea.
async function openInvoicePdf(invoiceId, btn) {
    const win = window.open('', '_blank');
    const prevText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Abriendo…'; }
    try {
        const res = await fetch(`${BASE_URL}/usuarios/api/invoices/${invoiceId}/pdf`, {
            headers: { Authorization: `Bearer ${getToken()}` }
        });
        if (!res.ok) {
            if (win) win.close();
            showToast(res.status === 404 ? 'La factura no tiene PDF disponible.' : 'No se pudo abrir la factura.', 'error');
            return;
        }
        const blobUrl = URL.createObjectURL(await res.blob());
        if (win) {
            win.location = blobUrl;
        } else {
            // Popup bloqueado → descargar en vez de abrir
            const a = document.createElement('a');
            a.href = blobUrl; a.download = `factura-${invoiceId}.pdf`;
            document.body.appendChild(a); a.click(); a.remove();
        }
        // El blob queda vivo hasta que la pestaña lo cargó; liberarlo después.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (e) {
        if (win) win.close();
        showToast('Error de conexión al abrir la factura.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
}

// Inicia el checkout MP para configurar tarjeta
// F2 (2026-08-31): guard por flag de módulo, no por botón — a diferencia de
// changePlan/cancelScheduledPlan/confirmCancelSubscription/confirmReactivateSubscription
// (que van detrás de un showConfirm() cuyo overlay bloquea físicamente un segundo
// clic), initCheckout() se llama desde 6 botones onclick="initCheckout()" distintos
// (según el estado de la cuenta, en renderFact) directo al POST, sin `disabled` ni
// confirmación previa. Un doble clic disparaba 2 checkouts de MercadoPago
// concurrentes — el proyecto documenta haber tenido que limpiar preapprovals
// huérfanos/duplicados en MP manualmente más de una vez (sesiones jul-ago 2026).
let _checkoutInFlight = false;
async function initCheckout(planName) {
    const acc = state.account;
    if (!acc) return;
    if (_checkoutInFlight) return;
    _checkoutInFlight = true;
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
    } finally {
        _checkoutInFlight = false;
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
    // --- BITÁCORA (P-AYUDA-1: módulo en producción desde 2026-08-14, sin FAQ hasta ahora) ---
    { cat: 'bitacora', q: '¿Qué es la Bitácora?', a: 'Es tu agenda de vencimientos, audiencias, tareas y notas, con expedientes seguidos y su historial. La encontrás en el menú lateral de este portal si tu plan la incluye.' },
    { cat: 'bitacora', q: '¿Cómo sigo un expediente en la Bitácora?', a: 'Desde el visor de Procuración, Informe o Monitor en la app, marcá el checkbox del expediente y usá "📌 Guardar caso". También podés agregarlo a mano desde "Mis expedientes" acá en el portal.' },
    { cat: 'bitacora', q: '¿Cómo cargo un vencimiento o una audiencia?', a: 'Desde "＋ Nueva entrada" en la Bitácora. Podés usar la calculadora de días hábiles (excluye fines de semana y feriados judiciales) para completar la fecha automáticamente.' },
    { cat: 'bitacora', q: '¿Puedo exportar mi agenda a Google Calendar u Outlook?', a: 'Sí. Desde "Exportar" elegí el formato iCalendar (.ics) y se importa en cualquier app de calendario. Solo incluye entradas con fecha — las notas y tareas sin plazo quedan afuera.' },
    { cat: 'bitacora', q: '¿Cómo hago un backup de mi Bitácora?', a: 'Desde "Exportar" → formato JSON. Es un backup completo y restaurable desde "Restaurar": podés combinarlo con lo que ya tenés o reemplazar todo.' },
    { cat: 'bitacora', q: '¿Qué son las sugerencias del Monitor en la Bitácora?', a: 'Cuando el Monitor de partes detecta un expediente nuevo de una parte que seguís, la Bitácora te sugiere agregarlo a tu agenda — podés aceptarlo (con o sin una tarea de revisión) o descartarlo.' },
    { cat: 'bitacora', q: 'Si mi plan deja de incluir Bitácora, ¿pierdo mis datos?', a: 'No. Tenés 90 días para exportar tu información aunque tu plan actual no incluya el módulo. Pasado ese plazo se bloquea la exportación, pero los datos no se borran.' },
    // --- MARKDOWN / ANONIMIZACIÓN ---
    { cat: 'markdown', q: '¿Qué hace el módulo Markdown?', a: 'Convierte un informe PDF ya generado (desde la app de escritorio) en dos archivos .md (texto plano): uno completo y uno anonimizado (nombres de partes y terceros enmascarados), listo para pegar en el chat de tu IA preferida sin exponer datos de terceros.' },
    { cat: 'markdown', q: '¿El módulo lee escaneos o imágenes dentro del PDF?', a: 'No. Solo extrae texto que ya está en el PDF como texto (no como imagen). Las páginas escaneadas o los sellos de firma digital sobre una imagen quedan marcados como "[imagen sin texto extraíble]", no se transcriben — no hay OCR en esta versión.' },
    { cat: 'markdown', q: '¿La anonimización es 100% segura?', a: 'Es una ayuda automática, no una garantía. Revisá siempre el resultado antes de compartirlo — desde el Editor de mapeo (en la app) podés editar el diccionario de reemplazos y reprocesar.' },
    { cat: 'markdown', q: '¿El contenido del expediente sale de mi computadora?', a: 'No. Todo el procesamiento es local, dentro de la app de escritorio: ni el PDF, ni el Markdown, ni el diccionario de reemplazos se envían al servidor. Solo se consulta si tu plan incluye el módulo.' },
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
    { id: 'bitacora',    label: 'Bitácora' },
    { id: 'markdown',    label: 'Markdown' },
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

// F2 (2026-08-31): escHtml() era una copia casi idéntica de escapeHtml() (línea
// 110), con una diferencia sutil de manejo de falsy (`str ?? ''` vs `!str`) que
// nadie explota hoy (los 3 usos son siempre string: título/mensaje de
// notificación, Error.message) pero que es exactamente el patrón de "misma
// lógica duplicada, deriva silenciosa entre copias" que el proyecto ya
// identificó como causa raíz de bugs reales al menos 3 veces (ver CLAUDE.md:
// generador_visor/generador_excel, VERIF_FLUJOS_ORDEN, tokenizar()). Eliminada,
// los 3 call sites pasan a usar escapeHtml() directo.

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
                        <div style="font-weight:${unread ? 700 : 500};font-size:14px;color:#111827">${escapeHtml(n.title)}
                            ${unread ? '<span style="background:'+color+';color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;margin-left:6px;font-weight:600;letter-spacing:0.3px">NUEVA</span>' : ''}
                        </div>
                        <div style="font-size:11px;color:#6b7280;white-space:nowrap">${date}</div>
                    </div>
                    <div style="font-size:13px;color:#374151;line-height:1.5;margin-top:4px;white-space:pre-wrap">${escapeHtml(n.message)}</div>
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
        container.innerHTML = `<div class="alert alert-error">Error al cargar notificaciones: ${escapeHtml(e.message)}</div>`;
    }
}

async function markAllNotificationsRead() {
    const btn = document.getElementById('btn-mark-all-notifs');
    if (!btn) return;
    btn.disabled = true;
    // F2 (2026-08-31): antes hacía 1 GET + N POST secuenciales (uno por
    // notificación, `await` dentro del loop) sin ningún catch propio — un fallo
    // de red a mitad de un lote grande dejaba algunas marcadas y otras no, sin
    // aviso al usuario, y sin refrescar lista/badge. El backend YA expone el
    // atajo `id='all'` que hace todo en un solo UPDATE atómico (routes/client.js,
    // documentado en CLAUDE.md) — nunca se usó desde acá.
    try {
        const res = await apiFetch('/client/notifications/all/read', { method: 'POST' });
        if (!res || !res.ok) {
            showToast('No se pudieron marcar las notificaciones como leídas.', 'error');
            return;
        }
        await renderNotificaciones();
        refreshNotifBadge();
    } catch (e) {
        showToast('Error de conexión.', 'error');
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

    // Hamburger — un mismo botón para 2 comportamientos distintos según el
    // ancho de pantalla: en desktop colapsa/expande el menú a solo íconos
    // (mismo patrón que el dashboard de administración); en mobile abre/cierra
    // el panel superpuesto (comportamiento que ya existía).
    document.getElementById('btn-hamburger').addEventListener('click', () => {
        if (window.matchMedia('(max-width: 768px)').matches) toggleSidebarMobile();
        else toggleSidebarDesktop();
    });

    // Sidebar overlay
    document.getElementById('sidebar-overlay').addEventListener('click', closeSidebarMobile);

    // Nav items
    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
        el.addEventListener('click', () => navigateTo(el.dataset.section));
    });

    // Marcar todas las notificaciones como leídas
    document.getElementById('btn-mark-all-notifs')?.addEventListener('click', markAllNotificationsRead);

    // Botón de comentario del topbar — mismo destino que "Nuevo ticket" pero con la
    // categoría ya elegida. Va por navigateTo + openNewTicketModal (no por el
    // deep-link) porque acá ya estamos dentro del portal, con sesión activa.
    document.getElementById('btn-feedback')?.addEventListener('click', () => {
        navigateTo('soporte');
        setTimeout(() => openNewTicketModal('feedback'), 300);
    });

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

    // ─── Bitácora: wiring de la sección (F1.3) ─────────────────────────────
    // ⚠️ Este bloque (y los 2 que le siguen, Mis Expedientes y Exportación) TIENE
    // que ir acá — antes de cualquier branching de login/SSO — y no más abajo,
    // junto al resto de la lógica de arranque. El auto-login por SSO (más abajo)
    // hace `return` apenas termina `initDashboard()`, así que cualquier wiring
    // colocado DESPUÉS de ese punto nunca se ejecutaba al entrar desde la app
    // Electron (`openPortalSection('bitacora')`, token en `#sso=`) — los botones
    // de esta sección quedaban sin `addEventListener`, y solo empezaban a andar
    // tras un F5 manual (que recarga sin el hash `#sso=` y sí llega hasta acá).
    // Esta wiring no depende de si hay sesión — son elementos estáticos del HTML,
    // igual que el resto de los listeners de arriba — así que no hay razón para
    // que dependiera del resultado del branching de login.
    document.getElementById('btn-bitacora-nueva')?.addEventListener('click', () => openBitacoraModal());
    document.getElementById('bitacora-entrada-form')?.addEventListener('submit', saveBitacoraEntrada);
    document.getElementById('bit-kind')?.addEventListener('change', bitTogglePlazoBlock);
    // Nota: `calcularPlazoBitacora` toma un parámetro opcional `ids` — llamarla directo
    // como handler pasaría el objeto Event en ese lugar, así que va envuelta.
    document.getElementById('bit-plazo-calcular')?.addEventListener('click', () => calcularPlazoBitacora());
    // Elegir un caso del selector (no solo llegar con uno precargado) también actualiza
    // el header de contexto — generaliza el punto 12 más allá del flujo de captura.
    document.getElementById('bit-expediente')?.addEventListener('change', (e) => bitRenderCasoHeader(e.target.value));

    document.querySelectorAll('.bitacora-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.bitacora.view = btn.dataset.view;
            bitacoraApplyViewToggle();
            bitacoraLoadAndRenderView();
        });
    });
    document.querySelectorAll('.bitacora-chip').forEach(chip => {
        chip.addEventListener('click', () => bitacoraSetTipoFilter(chip.dataset.tipo || ''));
    });
    document.getElementById('bitacora-filtro-estado')?.addEventListener('change', (e) => {
        state.bitacora.estado = e.target.value;
        bitacoraLoadAndRenderView();
    });
    document.getElementById('bitacora-filtro-expediente')?.addEventListener('change', (e) => {
        state.bitacora.expedienteId = e.target.value;
        bitacoraLoadAndRenderView();
    });
    document.getElementById('bitacora-search')?.addEventListener('input', (e) => bitacoraOnSearchInput(e.target.value));
    document.getElementById('bitacora-mes-prev')?.addEventListener('click', () => bitacoraMonthNav(-1));
    document.getElementById('bitacora-mes-next')?.addEventListener('click', () => bitacoraMonthNav(1));
    document.getElementById('bitacora-semana-prev')?.addEventListener('click', () => bitacoraWeekNav(-1));
    document.getElementById('bitacora-semana-next')?.addEventListener('click', () => bitacoraWeekNav(1));

    // ─── Mis Expedientes: wiring de la sección (F1.4) ──────────────────────
    document.getElementById('btn-mexp-nueva')?.addEventListener('click', openMexpNuevaFicha);
    document.getElementById('mexp-ficha-form')?.addEventListener('submit', saveMexpFicha);
    document.getElementById('mexp-search')?.addEventListener('input', (e) => mexpOnSearchInput(e.target.value));
    document.getElementById('btn-mexp-volver')?.addEventListener('click', closeMexpFicha);

    // ─── Exportación: wiring del modal (F1.6 + .ics de F3.4 Bloque B) ──────
    document.querySelectorAll('input[name="export-alcance"]').forEach(r => {
        r.addEventListener('change', exportUpdateSubfields);
    });
    document.querySelectorAll('input[name="export-formato"]').forEach(r => {
        r.addEventListener('change', exportUpdateSubfields);
    });

    // ─── Restaurar: selector de archivo estilizado ─────────────────────────
    document.getElementById('import-file')?.addEventListener('change', (e) => {
        const nombre = e.target.files?.[0]?.name || 'Sin archivo seleccionado';
        document.getElementById('import-file-name').textContent = nombre;
    });

    // ─── Bitácora: deshacer con Ctrl+Z el último "marcar hecho/pendiente" ──
    // Se ignora si el foco está en un campo editable (input/textarea/select o
    // contenteditable) — ahí Ctrl+Z debe ser el undo nativo de edición de texto,
    // no el de la bitácora. Ctrl (Windows/Linux) o Cmd (Mac, e.metaKey).
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() !== 'z' || (!e.ctrlKey && !e.metaKey)) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
        if (!state.bitacora._lastDoneAction) return;
        e.preventDefault();
        bitacoraUndoLastDone();
    });

    // ─── Escape cierra el modal visible (VF-5, hallazgo de la campaña /verify) ──
    // Ninguna de las ~10 pantallas del portal lo tenía. Mapeo explícito id→close(),
    // no un `classList.add('hidden')` genérico: cada close() hace además su propia
    // limpieza de estado (closeMexpFichaModal, por ejemplo, no toca state.miExp —
    // esa es tarea de closeMexpFicha, una función distinta para la VISTA de ficha,
    // no para este modal) y usar el cierre real evita duplicar esa lógica acá.
    const ESCAPE_MODAL_CLOSERS = {
        'modal-plan':             closePlanModal,
        'modal-ticket':           closeNewTicketModal,
        'modal-bitacora-entrada': closeBitacoraModal,
        'modal-bitacora-export':  closeExportModal,
        'modal-bitacora-lote':    closeLoteModal,
        'modal-bitacora-import':  closeImportModal,
        'modal-mexp-ficha':       closeMexpFichaModal,
        'modal-mexp-eliminar':    closeMexpEliminarModal,
        'modal-mexp-snapshot':    closeMexpSnapshotModal,
    };
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        for (const [id, closer] of Object.entries(ESCAPE_MODAL_CLOSERS)) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) { closer(); return; }
        }
    });

    // Capturar ?goto= de la URL (de links externos como emails) antes de cualquier flujo
    // Se persiste en sessionStorage para sobrevivir al ciclo de login normal
    const urlParams = new URLSearchParams(window.location.search);
    const incomingGoto = urlParams.get('goto');
    if (incomingGoto) {
        sessionStorage.setItem('pending_goto', incomingGoto);
    }
    // `?goto=expediente&exp=<numero>`: el visor manda el NÚMERO del expediente (no el
    // id interno, que no conoce). Se persiste al lado de pending_goto para sobrevivir
    // el ciclo de login igual que él. Sin `exp` el goto sigue siendo válido — aterriza
    // en el listado de Mis Expedientes (es lo que mandan los clientes ya instalados).
    const incomingExp = urlParams.get('exp');
    if (incomingExp) {
        sessionStorage.setItem('pending_goto_exp', incomingExp);
    }
    // `?goto=nuevo-ticket&cat=<categoria>`: el botón de comentario de la app Electron
    // manda la categoría a preseleccionar. Se persiste igual que pending_goto_exp para
    // sobrevivir el ciclo de login. Sin `cat`, el goto sigue valiendo — abre el modal
    // sin categoría elegida (que es lo que mandan los clientes ya instalados).
    const incomingCat = urlParams.get('cat');
    if (incomingCat) {
        sessionStorage.setItem('pending_goto_cat', incomingCat);
    }

    // Deep-link de captura desde un visor (F2.2/F2.3): POST /usuarios/capture redirige
    // acá con ?goto=bitacora&draft=<id>. El id se persiste igual que pending_goto —
    // sobrevive al ciclo de login si el usuario no tenía sesión activa en la pestaña
    // "procurador_portal" (el visor no manda SSO, eso es F2.6, todavía no implementado).
    const incomingDraft = urlParams.get('draft');
    if (incomingDraft) {
        sessionStorage.setItem('pending_capture_draft', incomingDraft);
    }
    // Motivo de rechazo server-side sin draft (acción inválida, lote>200 filas) — solo
    // para mostrar un toast claro, no hay nada que reclamar.
    const incomingCapturaError = urlParams.get('captura');
    if (incomingCapturaError && incomingCapturaError !== 'ok') {
        sessionStorage.setItem('pending_capture_error', incomingCapturaError);
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
    //
    // H-COV-Z2-01 (auditoría 2026-09): antes esto guardaba CUALQUIER cosa que viniera
    // después de `#sso=` como sesión, sin mirarla. El fragmento no llega al servidor,
    // así que ningún control de `routes/` interviene: mandarle a alguien logueado un
    // link `…/usuarios/#sso=<jwt del atacante>` le reemplazaba la sesión en silencio
    // (y `history.replaceState` borraba el rastro). Todo lo que esa persona cargara
    // después —expedientes, entradas de Bitácora, importaciones de backup— quedaba en
    // la cuenta del atacante. Ahora: se exige que sea un JWT bien formado y vigente, y
    // si cambia de cuenta se pide confirmación.
    //
    // ⚠️ El `return` de abajo solo se ejecuta cuando el token se ACEPTA. Si se rechaza
    // se cae al flujo normal del final de este handler (`getToken()` → sesión existente
    // o pantalla de login), que es justamente lo que hace que "no pise". No mover
    // wiring detrás de ese return (lección del fix a71987b).
    const hash = window.location.hash;
    if (hash && hash.startsWith('#sso=')) {
        const ssoToken = hash.slice(5);
        // Limpiar hash y query para no exponerlos en el historial del navegador.
        // Se hace siempre, se acepte o no el token: no tiene por qué quedar a la vista.
        history.replaceState(null, '', window.location.pathname);

        const entrante = parseJwtPayload(ssoToken);

        // ── B.3-A (fase E11): LLAVE DE CAPTURA, NO SESIÓN ────────────────────
        // El visor generado a partir de esta fase manda por `#sso=` una llave de
        // 30 minutos con `scope: 'capture'`, no el JWT de login de 8 h que llevaba
        // hasta E8. Se decodifica el payload SIN verificar (esto es enrutamiento;
        // la verificación de verdad la hace el servidor en cada request).
        //
        // Lo que NUNCA hay que hacer con ella: `saveToken()` / `initDashboard()`.
        // Guardarla como sesión reabriría la fijación de sesión de H-COV-Z2-01
        // con una llave que además dura media hora, y dejaría en `localStorage`
        // una credencial que llegó dentro de un archivo compartible.
        //
        // Todo lo que hace la llave es reclamar SU PROPIO borrador, una vez. El
        // portal la usa para un único request y la descarta; nunca se persiste.
        if (entrante && entrante.scope === 'capture') {
            const draftPendiente = sessionStorage.getItem('pending_capture_draft');
            // Con sesión propia viva, la llave sobra: el reclamo va con la sesión
            // (que además es la única que puede escribir después).
            if (draftPendiente && !getToken()) {
                // Se reclama YA, antes del login. Motivo: el borrador vive 10
                // minutos y un login puede llevarse varios; si se esperara, la
                // captura se perdería. Reclamarlo acá la rescata y la deja lista
                // para aplicarse apenas haya sesión.
                await preReclamarDraftConLlave(draftPendiente, ssoToken, entrante.id);
            }
            // Cae al flujo normal del final del handler (sesión existente o login).
            // La llave queda fuera de `state` y de `localStorage`: muere con esta
            // variable local al terminar el handler.
        } else {
            const vigente  = !!entrante && typeof entrante.exp === 'number' && entrante.exp * 1000 > Date.now();
            const actual   = parseJwtPayload(getToken() || '');
            const cambiaDeCuenta = !!actual && !!entrante && actual.id !== entrante.id;

            let aceptar = !!ssoToken && vigente;
            if (aceptar && cambiaDeCuenta) {
                // El JWT de Electron trae { id, role } sin email — de ahí el fallback.
                aceptar = await showConfirm(
                    'Este enlace inicia sesión como ' + (entrante.email || 'otro usuario') +
                    ' y cierra tu sesión actual. ¿Continuar?',
                    { confirmLabel: 'Cambiar de cuenta' }
                );
            }

            if (aceptar) {
                saveToken(ssoToken);
                state.token = ssoToken;
                await initDashboard();
                // initDashboard() ya consume pending_goto y navega
                return;
            }
            // Token ausente, malformado, vencido, o el usuario canceló el cambio de cuenta:
            // sigue el flujo normal de abajo con la sesión que ya hubiera (o el login).
        }
    }

    // Si solo había ?goto=/draft=/captura= sin SSO, limpiar la URL (ya están en sessionStorage)
    if ((incomingGoto || incomingExp || incomingDraft || incomingCapturaError) && !hash.startsWith('#sso=')) {
        history.replaceState(null, '', window.location.pathname);
    }

    // Anunciarse recién acá: la URL ya quedó limpia (replaceState, sin agregar
    // entradas al historial), así que esta pestaña sigue siendo cerrable si otra
    // más nueva la reemplaza sin que el usuario haya navegado en ella.
    initPortalTabDedup();

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

// =============================================================================
//  SECCIÓN: BITÁCORA (F1.3)
// =============================================================================
// Consume los endpoints de F1.2 (`routes/bitacora.js`, montados en
// `/usuarios/api/bitacora|expedientes|feriados`). Contrato verificado línea por
// línea contra ese archivo antes de escribir esto (nombres de query params,
// columna `due_at` —no `due_date`—, forma de la respuesta de /avisos, etc.):
// no se adivina nada acá.
//
// Fecha local sin corrimiento de huso horario: los <input type="date"> del portal
// se envían al backend como mediodía local (`bitToIsoMidday`) — evita que una
// fecha guardada como '2026-08-20T00:00:00Z' se muestre como el día anterior en
// husos horarios negativos (Argentina, UTC-3). Al volver a leer un `due_at`,
// `bitLocalYmd()` extrae el día calendario en hora LOCAL del navegador, que para
// cualquier huso razonable cae en el mismo día que se guardó.

const BIT_TIPOS = {
    vencimiento: { icon: '⏰', label: 'Vencimiento', color: 'vencimiento' },
    audiencia:   { icon: '⚖️', label: 'Audiencia',   color: 'audiencia' },
    tarea:       { icon: '✅', label: 'Tarea',        color: 'tarea' },
    gestion:     { icon: '📋', label: 'Gestión',      color: 'gestion' },
    nota:        { icon: '📝', label: 'Nota',         color: 'nota' },
};

// ─── Fechas ────────────────────────────────────────────────────────────────
function bitLocalYmd(dateInput) {
    const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Bug real encontrado en F3.0 (2026-08-15): `bitLocalYmd()` está bien para `due_at`
// (timestamptz guardado a MEDIODÍA local vía `bitToIsoMidday` — leer en hora local
// recupera el día correcto). Pero las columnas DATE puras (`feriados.fecha`,
// `expedientes_seguidos.situacion_fecha`) el backend las serializa como medianoche
// UTC (`'2026-08-17T00:00:00.000Z'`), sin componente horario real — pasarlas por
// `bitLocalYmd()` las corre un día hacia atrás en husos negativos (Argentina, UTC-3):
// esa medianoche UTC es 2026-08-16 21:00 -03:00, y `bitLocalYmd()` lee el día LOCAL.
// Confirmado en vivo: el feriado real del 17/08 se cacheaba como 16/08, y la
// calculadora de plazos NUNCA excluía el feriado real. `bitUtcYmd()` lee los
// componentes UTC en vez de los locales — correcto para una fecha-sin-hora.
function bitUtcYmd(dateInput) {
    const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Segundo hallazgo de F3.0, mismo root cause: `formatDate()` (usado en TODO el
// portal, ~usos con timestamptz reales) también lee en hora LOCAL — mismo bug para
// una columna DATE. Confirmado en vivo: `situacion_fecha` guardado como 10/08 se
// mostraba como "09/08/2026" en la ficha del expediente. NO se toca `formatDate()`
// (es de uso general, correcto para timestamptz); este helper es específico para
// las columnas DATE de Bitácora (`situacion_fecha`, `run_date` de snapshots).
function bitFormatUtcDate(dateInput) {
    const ymd = bitUtcYmd(dateInput);
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
}

function bitParseLocalDate(ymd) {
    if (!ymd) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function bitToIsoMidday(ymd) {
    if (!ymd) return null;
    return new Date(`${ymd}T12:00:00`).toISOString();
}

// ─── Caché de entradas (para abrir el modal desde banner/calendario/lista
//     sin re-pedir al servidor ni pasar objetos por el atributo onclick) ───
function bitCacheEntries(list) {
    (list || []).forEach(e => state.bitacora._cache.set(Number(e.id), e));
}
function bitEntryById(id) {
    return state.bitacora._cache.get(Number(id)) || null;
}

// ─── Feriados + calculadora de plazo (días hábiles) ────────────────────────
async function bitEnsureFeriados(years) {
    const faltantes = years.filter(y => !state.bitacora._feriadosYears.has(y));
    for (const y of faltantes) {
        try {
            const res = await apiFetch(`/usuarios/api/feriados?year=${y}`);
            if (res && res.ok) {
                const data = await res.json();
                (data.feriados || []).forEach(f => state.bitacora.feriados.add(bitUtcYmd(f.fecha)));
            }
            state.bitacora._feriadosYears.add(y);
        } catch (e) {
            console.error('Error cargando feriados', y, e);
        }
    }
}

function bitAddBusinessDays(fromYmd, dias) {
    const cur = bitParseLocalDate(fromYmd);
    let restantes = dias;
    while (restantes > 0) {
        cur.setDate(cur.getDate() + 1);
        const dow = cur.getDay(); // 0=domingo, 6=sábado
        if (dow !== 0 && dow !== 6 && !state.bitacora.feriados.has(bitLocalYmd(cur))) {
            restantes--;
        }
    }
    return bitLocalYmd(cur);
}

// `ids`: permite reusar la misma calculadora en el wizard de lote (B2), que tiene sus
// propios ids de campo (`lote-plazo-*`) para no colisionar con el modal individual
// cuando ambos existen en el DOM a la vez.
async function calcularPlazoBitacora(ids) {
    const p = ids || { desde: 'bit-plazo-desde', dias: 'bit-plazo-dias', due: 'bit-due' };
    const desde = document.getElementById(p.desde).value;
    const dias = parseInt(document.getElementById(p.dias).value, 10);
    if (!desde || !dias || dias < 1) {
        showToast('Completá la fecha de notificación y la cantidad de días hábiles.', 'error');
        return;
    }
    // F2 (2026-08-31): el input tiene max="365" en el HTML, pero eso es puramente
    // decorativo — se lee con parseInt() crudo, sin checkValidity(). Sin este
    // guard, un typo (ej. "3650") no se rechazaba: bitAddBusinessDays() es un
    // `while` sincrónico sin yield, así que un valor absurdo cuelga la pestaña
    // un rato, y de paso agranda mucho el hueco de feriados sin cargar de abajo.
    if (dias > 365) {
        showToast('El plazo máximo es de 365 días hábiles.', 'error');
        return;
    }
    const anioBase = bitParseLocalDate(desde).getFullYear();
    // F2 (2026-08-31): antes cargaba fijo [anioBase, anioBase+1] — con `dias`
    // cerca de 365 (el propio tope de la UI) el vencimiento real puede caer en
    // anioBase+2 (365 días hábiles ≈ 511 días calendario; alcanza con un `desde`
    // a partir de agosto para que ya se reproduzca, no hace falta un caso
    // extremo). Los feriados de ese 3er año nunca se cargaban y se contaban
    // como día hábil, adelantando la fecha calculada — un error real de plazo
    // legal, no cosmético. Iterativo en vez de agrandar el número fijo: cubre
    // cualquier `dias` dentro del tope de arriba sin adivinar cuántos años
    // hacen falta, y se autocorrige si algún día cambia el tope.
    let anioTope = anioBase + 1;
    await bitEnsureFeriados([anioBase, anioTope]);
    let resultado = bitAddBusinessDays(desde, dias);
    let anioResultado = bitParseLocalDate(resultado).getFullYear();
    while (anioResultado > anioTope) {
        anioTope++;
        await bitEnsureFeriados([anioTope]);
        resultado = bitAddBusinessDays(desde, dias);
        anioResultado = bitParseLocalDate(resultado).getFullYear();
    }
    document.getElementById(p.due).value = resultado;
    showToast(`Vencimiento calculado: ${formatDate(resultado)}`, 'success');
}

// ─── Entrada del módulo (al navegar a la sección) ──────────────────────────
async function renderBitacora() {
    // Se releé en cada entrada a la sección (no se cachea con un flag "loaded"):
    // el listado de expedientes también lo edita Mis Expedientes, y ambas
    // secciones comparten esta misma llamada — más simple mantenerlo fresco que
    // invalidar la caché de una sección desde la otra.
    await loadBitacoraExpedientes();
    loadBitacoraAvisos();
    loadBitacoraSugerencias();   // F3.3 — casos nuevos detectados por el Monitor
    bitacoraApplyViewToggle();
    bitacoraLoadAndRenderView();
}

function bitacoraApplyViewToggle() {
    document.querySelectorAll('.bitacora-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === state.bitacora.view);
    });
    const mes = document.getElementById('bitacora-vista-mes');
    const semana = document.getElementById('bitacora-vista-semana');
    const lista = document.getElementById('bitacora-vista-lista');
    if (mes) mes.style.display = state.bitacora.view === 'mes' ? 'grid' : 'none';
    // A diferencia de #bitacora-vista-mes (CSS grid de 2 columnas aplicado al
    // propio contenedor), #bitacora-vista-semana es un .card simple — la grilla
    // de 7 columnas vive en el .bitacora-semana-grid interno, siempre
    // display:grid por su propia clase CSS. Por eso acá corresponde 'block',
    // no 'grid': copiarlo por analogía con Mes rompería el layout sin error
    // visible en consola (ver plan F3.4 §A.3).
    if (semana) semana.style.display = state.bitacora.view === 'semana' ? 'block' : 'none';
    if (lista) lista.style.display = state.bitacora.view === 'lista' ? 'block' : 'none';
}

function bitacoraLoadAndRenderView() {
    if (state.bitacora.view === 'mes') loadBitacoraMonth();
    else if (state.bitacora.view === 'semana') loadBitacoraWeek();
    else loadBitacoraLista();
}

function bitacoraSetTipoFilter(tipo) {
    state.bitacora.tipo = tipo;
    document.querySelectorAll('.bitacora-chip').forEach(el => {
        el.classList.toggle('active', (el.dataset.tipo || '') === tipo);
    });
    bitacoraLoadAndRenderView();
}

let bitSearchDebounce = null;
function bitacoraOnSearchInput(value) {
    state.bitacora.search = value.trim();
    clearTimeout(bitSearchDebounce);
    bitSearchDebounce = setTimeout(() => bitacoraLoadAndRenderView(), 300);
}

function bitacoraMonthNav(delta) {
    const c = state.bitacora.monthCursor;
    state.bitacora.monthCursor = new Date(c.getFullYear(), c.getMonth() + delta, 1);
    state.bitacora.selectedDay = null;
    loadBitacoraMonth();
}

// ─── Expedientes seguidos (para el filtro y el <select> del modal) ─────────
async function loadBitacoraExpedientes() {
    try {
        const res = await apiFetch('/usuarios/api/expedientes');
        if (!res || !res.ok) return;
        const data = await res.json();
        state.bitacora.expedientes = data.expedientes || [];
        const optsHtml = state.bitacora.expedientes.map(x =>
            `<option value="${x.id}">${escapeHtml(x.expediente)}${x.caratula ? ' — ' + escapeHtml(x.caratula) : ''}</option>`
        ).join('');
        const selFiltro = document.getElementById('bitacora-filtro-expediente');
        if (selFiltro) selFiltro.innerHTML = '<option value="">Todos los expedientes</option>' + optsHtml;
        const selModal = document.getElementById('bit-expediente');
        if (selModal) selModal.innerHTML = '<option value="">— Sin vincular —</option>' + optsHtml;
    } catch (e) {
        console.error('Error cargando expedientes seguidos:', e);
    }
}

// ─── Banner de avisos ───────────────────────────────────────────────────────
async function loadBitacoraAvisos() {
    const cont = document.getElementById('bitacora-avisos');
    if (!cont) return;
    try {
        const res = await apiFetch('/usuarios/api/bitacora/avisos');
        if (!res || !res.ok) { cont.style.display = 'none'; return; }
        const data = await res.json();
        renderBitacoraAvisos(data);
    } catch (e) {
        console.error('Error cargando avisos de bitácora:', e);
        cont.style.display = 'none';
    }
}

function renderBitacoraAvisos(data) {
    const cont = document.getElementById('bitacora-avisos');
    if (!cont) return;
    const vencidos = data.vencidos || [];
    const proximos = data.proximos || [];
    bitCacheEntries(vencidos);
    bitCacheEntries(proximos);

    if (vencidos.length === 0 && proximos.length === 0) {
        cont.style.display = 'none';
        cont.innerHTML = '';
        return;
    }

    const fila = (e) => {
        const tipo = BIT_TIPOS[e.kind] || BIT_TIPOS.nota;
        const exp = e.expediente
            ? ` <span style="color:var(--text-muted);font-weight:400">· ${escapeHtml(e.expediente)}</span>`
            : '';
        return `<div class="bitacora-aviso-row">
            <div class="bitacora-entry-check" style="margin-top:0" onclick="toggleBitacoraDone(${e.id}, true)" title="Marcar como hecho">✓</div>
            <span class="bitacora-aviso-fecha">${e.due_at ? formatDate(e.due_at) : ''}</span>
            <span class="bitacora-aviso-titulo" onclick="openBitacoraModalById(${e.id})" style="cursor:pointer">${tipo.icon} ${escapeHtml(e.title)}${exp}</span>
        </div>`;
    };

    let html = `<div class="bitacora-avisos-banner ${vencidos.length > 0 ? 'tiene-vencidos' : ''}">`;
    if (vencidos.length > 0) {
        const totalMsg = data.totalVencidosSinConfirmar > vencidos.length
            ? ` (${data.totalVencidosSinConfirmar} en total sin confirmar)` : '';
        html += `<div class="bitacora-avisos-header vencidos">🔴 Vencidos sin confirmar${totalMsg}</div>`;
        html += vencidos.map(fila).join('');
    }
    if (proximos.length > 0) {
        html += `<div class="bitacora-avisos-header proximos" style="${vencidos.length > 0 ? 'margin-top:10px' : ''}">🟡 Próximos 7 días</div>`;
        html += proximos.map(fila).join('');
    }
    html += '</div>';
    cont.innerHTML = html;
    cont.style.display = 'block';
}

// ─── Bandeja de sugerencias del Monitor (F3.3) ─────────────────────────────
// Las filas las genera el backend cuando el Monitor de Partes detecta un caso
// NUEVO en el que figura una parte del usuario. No duplica la bandeja de
// novedades que el Monitor ya tiene en la app: aquella decide "¿este expediente
// es de mi parte?", esta decide "¿lo quiero en mi agenda?".
async function loadBitacoraSugerencias() {
    const cont = document.getElementById('bitacora-sugerencias');
    if (!cont) return;
    try {
        const res = await apiFetch('/usuarios/api/sugerencias');
        if (!res || !res.ok) { cont.style.display = 'none'; return; }
        const data = await res.json();
        renderBitacoraSugerencias(data.sugerencias || []);
    } catch (e) {
        console.error('Error cargando sugerencias:', e);
        cont.style.display = 'none';
    }
}

function renderBitacoraSugerencias(sugerencias) {
    const cont = document.getElementById('bitacora-sugerencias');
    if (!cont) return;
    if (sugerencias.length === 0) {
        cont.style.display = 'none';
        cont.innerHTML = '';
        return;
    }

    const fila = (s) => {
        const parte = s.nombre_parte
            ? `Parte: ${escapeHtml(s.nombre_parte)}` : '';
        const dep = s.dependencia ? escapeHtml(s.dependencia) : '';
        const meta = [parte, dep, s.situacion ? escapeHtml(s.situacion) : '']
            .filter(Boolean).join(' · ');
        return `<div class="bitacora-sug-row">
            <div class="bitacora-sug-info">
                <div class="bitacora-sug-exp">${escapeHtml(s.expediente)}</div>
                ${s.caratula ? `<div class="bitacora-sug-caratula">${escapeHtml(s.caratula)}</div>` : ''}
                ${meta ? `<div class="bitacora-sug-meta">${meta}</div>` : ''}
            </div>
            <div class="bitacora-sug-actions">
                <button type="button" class="btn btn-primary btn-sm" onclick="aceptarSugerencia(${s.id}, false)">📌 Seguir</button>
                <button type="button" class="btn btn-outline btn-sm" onclick="aceptarSugerencia(${s.id}, true)" title="Crea la ficha y además una tarea de revisión">📌 Seguir + tarea</button>
                <button type="button" class="btn btn-outline btn-sm" onclick="descartarSugerencia(${s.id})">✕</button>
            </div>
        </div>`;
    };

    const plural = sugerencias.length !== 1;
    cont.innerHTML = `<div class="bitacora-sug-banner">
        <div class="bitacora-sug-header">
            <span>🔎 El Monitor encontró ${sugerencias.length} caso${plural ? 's' : ''} nuevo${plural ? 's' : ''} de tus partes</span>
            <button type="button" class="btn btn-outline btn-sm" onclick="descartarTodasSugerencias()">Descartar todas</button>
        </div>
        ${sugerencias.map(fila).join('')}
    </div>`;
    cont.style.display = 'block';
}

async function aceptarSugerencia(id, conEntrada) {
    try {
        const res = await apiFetch(`/usuarios/api/sugerencias/${id}/aceptar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conEntrada: !!conEntrada }),
        });
        if (!res || !res.ok) { showToast('No se pudo agregar el caso', 'error'); return; }
        const data = await res.json();
        showToast(conEntrada
            ? 'Caso agregado a tu Bitácora, con una tarea de revisión'
            : 'Caso agregado a tu Bitácora', 'success');
        // Repinta la bandeja y el resto de la sección: la ficha nueva tiene que
        // aparecer en el filtro de expedientes y (si se creó) la tarea en la vista.
        await loadBitacoraSugerencias();
        await loadBitacoraExpedientes();
        if (data.entrada_id) bitacoraRefreshCurrentContext();
    } catch (e) {
        console.error('Error aceptando sugerencia:', e);
        showToast('No se pudo agregar el caso', 'error');
    }
}

async function descartarSugerencia(id) {
    try {
        const res = await apiFetch(`/usuarios/api/sugerencias/${id}/descartar`, { method: 'POST' });
        if (!res || !res.ok) { showToast('No se pudo descartar', 'error'); return; }
        await loadBitacoraSugerencias();
    } catch (e) {
        console.error('Error descartando sugerencia:', e);
        showToast('No se pudo descartar', 'error');
    }
}

async function descartarTodasSugerencias() {
    if (!(await showConfirm('¿Descartar todas las sugerencias pendientes? Los casos no se van a agregar a tu Bitácora.'))) return;
    try {
        const res = await apiFetch('/usuarios/api/sugerencias/descartar-todas', { method: 'POST' });
        if (!res || !res.ok) { showToast('No se pudieron descartar', 'error'); return; }
        await loadBitacoraSugerencias();
    } catch (e) {
        console.error('Error descartando sugerencias:', e);
        showToast('No se pudieron descartar', 'error');
    }
}

// ─── Item de entrada (reutilizado por el panel del día y la vista Lista) ───
function bitEntryRowHtml(e) {
    const tipo = BIT_TIPOS[e.kind] || BIT_TIPOS.nota;
    const hecho = !!e.done_at;
    const exp = e.expediente ? `<span>📁 ${escapeHtml(e.expediente)}</span>` : '';
    return `<div class="bitacora-entry ${hecho ? 'hecho' : ''}" data-id="${e.id}">
        <div class="bitacora-entry-check" onclick="toggleBitacoraDone(${e.id}, ${!hecho})">${hecho ? '✓' : ''}</div>
        <div class="bitacora-entry-body" onclick="openBitacoraModalById(${e.id})" style="cursor:pointer">
            <div class="bitacora-entry-title"><span class="bit-color-${tipo.color}" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px"></span>${escapeHtml(e.title)}</div>
            <div class="bitacora-entry-meta">${exp}</div>
        </div>
        <div class="bitacora-entry-actions">
            <button type="button" onclick="deleteBitacoraEntrada(${e.id})" title="Eliminar">🗑</button>
        </div>
    </div>`;
}

// ─── Vista Mes ───────────────────────────────────────────────────────────────
function bitacoraMonthRange(cursor) {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDow = (first.getDay() + 6) % 7; // lunes = 0
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startDow);
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridStart.getDate() + 41); // 6 semanas
    return { gridStart, gridEnd };
}

function bitacoraApplyClientFilters(rows) {
    let out = rows;
    if (state.bitacora.estado === 'hecho') out = out.filter(e => e.done_at);
    if (state.bitacora.search) {
        const q = state.bitacora.search.toLowerCase();
        out = out.filter(e =>
            (e.title || '').toLowerCase().includes(q) ||
            (e.expediente || '').toLowerCase().includes(q)
        );
    }
    return out;
}

function bitacoraBuildQuery(desdeDate, hastaDate) {
    const params = new URLSearchParams();
    params.set('desde', bitToIsoMidday(bitLocalYmd(desdeDate)));
    params.set('hasta', bitToIsoMidday(bitLocalYmd(hastaDate)));
    if (state.bitacora.tipo) params.set('kind', state.bitacora.tipo);
    if (state.bitacora.estado === 'pendiente') params.set('pendientes', '1');
    if (state.bitacora.expedienteId) params.set('expediente_id', state.bitacora.expedienteId);
    return params;
}

async function loadBitacoraMonth() {
    const { gridStart, gridEnd } = bitacoraMonthRange(state.bitacora.monthCursor);
    const params = bitacoraBuildQuery(gridStart, gridEnd);
    try {
        const res = await apiFetch(`/usuarios/api/bitacora?${params.toString()}`);
        if (!res || !res.ok) { state.bitacora.entries = []; renderBitacoraCalendar(); return; }
        const data = await res.json();
        const rows = bitacoraApplyClientFilters(data.entradas || []);
        state.bitacora.entries = rows;
        bitCacheEntries(rows);
        renderBitacoraCalendar();
        if (state.bitacora.selectedDay) renderBitacoraDayPanel(state.bitacora.selectedDay);
    } catch (e) {
        console.error('Error cargando bitácora (mes):', e);
        state.bitacora.entries = [];
        renderBitacoraCalendar();
    }
}

function renderBitacoraCalendar() {
    const grid = document.getElementById('bitacora-calendar-grid');
    const label = document.getElementById('bitacora-mes-label');
    if (!grid || !label) return;

    const cursor = state.bitacora.monthCursor;
    label.textContent = cursor.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

    const { gridStart } = bitacoraMonthRange(cursor);
    const todayYmd = bitLocalYmd(new Date());
    const porDia = {};
    (state.bitacora.entries || []).forEach(e => {
        if (!e.due_at) return;
        const ymd = bitLocalYmd(e.due_at);
        (porDia[ymd] = porDia[ymd] || []).push(e);
    });

    let html = '';
    const cur = new Date(gridStart);
    for (let i = 0; i < 42; i++) {
        const ymd = bitLocalYmd(cur);
        const inMonth = cur.getMonth() === cursor.getMonth();
        const entradasDia = porDia[ymd] || [];
        const tieneVencidoPend = entradasDia.some(e => !e.done_at && ymd < todayYmd);

        const classes = ['bitacora-day'];
        if (!inMonth) classes.push('otro-mes');
        if (ymd === todayYmd) classes.push('hoy');
        if (ymd === state.bitacora.selectedDay) classes.push('selected');

        const dots = entradasDia.slice(0, 4).map(e => {
            const tipo = BIT_TIPOS[e.kind] || BIT_TIPOS.nota;
            return `<span class="bitacora-day-dot bit-color-${tipo.color}"></span>`;
        }).join('');

        html += `<div class="${classes.join(' ')}" data-ymd="${ymd}" onclick="bitacoraSelectDay('${ymd}')">
            <span class="bitacora-day-num">${cur.getDate()}</span>
            ${tieneVencidoPend ? '<span class="bitacora-day-vencido-badge">vencido</span>' : ''}
            <span class="bitacora-day-dots">${dots}</span>
        </div>`;
        cur.setDate(cur.getDate() + 1);
    }
    grid.innerHTML = html;
}

function bitacoraSelectDay(ymd) {
    state.bitacora.selectedDay = ymd;
    document.querySelectorAll('.bitacora-day').forEach(el => {
        el.classList.toggle('selected', el.dataset.ymd === ymd);
    });
    renderBitacoraDayPanel(ymd);
}

function renderBitacoraDayPanel(ymd) {
    const title = document.getElementById('bitacora-day-panel-title');
    const body = document.getElementById('bitacora-day-panel-body');
    if (!title || !body) return;

    const d = bitParseLocalDate(ymd);
    title.textContent = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

    const entradas = (state.bitacora.entries || []).filter(e => e.due_at && bitLocalYmd(e.due_at) === ymd);
    if (entradas.length === 0) {
        body.innerHTML = '<div class="empty-state"><p>Sin entradas este día</p></div>';
        return;
    }
    body.innerHTML = entradas.map(bitEntryRowHtml).join('');
}

// ─── Vista Semana (F3.4, Bloque A) ─────────────────────────────────────────
// Mismo ciclo que loadBitacoraMonth(): rango → query → apiFetch → filtrar
// client-side → cachear → renderizar. Comparte state.bitacora.monthCursor con
// la vista Mes a propósito (decisión A.6 del plan): al alternar entre vistas
// el usuario espera seguir parado en la misma fecha, no saltar a "hoy".
function bitacoraWeekRange(cursor) {
    const dow = (cursor.getDay() + 6) % 7; // lunes = 0, igual que bitacoraMonthRange
    const weekStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - dow);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { weekStart, weekEnd };
}

function bitacoraWeekNav(delta) {
    const c = state.bitacora.monthCursor;
    state.bitacora.monthCursor = new Date(c.getFullYear(), c.getMonth(), c.getDate() + delta * 7);
    state.bitacora.selectedDay = null;
    loadBitacoraWeek();
}

async function loadBitacoraWeek() {
    const { weekStart, weekEnd } = bitacoraWeekRange(state.bitacora.monthCursor);
    const params = bitacoraBuildQuery(weekStart, weekEnd);
    try {
        const res = await apiFetch(`/usuarios/api/bitacora?${params.toString()}`);
        if (!res || !res.ok) { state.bitacora.entries = []; renderBitacoraWeek(); return; }
        const data = await res.json();
        const rows = bitacoraApplyClientFilters(data.entradas || []);
        state.bitacora.entries = rows;
        bitCacheEntries(rows);
        renderBitacoraWeek();
    } catch (e) {
        console.error('Error cargando bitácora (semana):', e);
        state.bitacora.entries = [];
        renderBitacoraWeek();
    }
}

function renderBitacoraWeek() {
    const grid = document.getElementById('bitacora-semana-grid');
    const label = document.getElementById('bitacora-semana-label');
    if (!grid || !label) return;

    const { weekStart, weekEnd } = bitacoraWeekRange(state.bitacora.monthCursor);
    const fmtCorto = { day: 'numeric', month: 'short' };
    const fmtLargo = { day: 'numeric', month: 'short', year: 'numeric' };
    label.textContent = `${weekStart.toLocaleDateString('es-AR', fmtCorto)} – ${weekEnd.toLocaleDateString('es-AR', fmtLargo)}`;

    // due_at es timestamptz a mediodía local (bitToIsoMidday) → bitLocalYmd(),
    // NUNCA bitUtcYmd() acá — ver §A.5 del plan y el comentario de bitLocalYmd().
    const todayYmd = bitLocalYmd(new Date());
    const porDia = {};
    (state.bitacora.entries || []).forEach(e => {
        if (!e.due_at) return;
        const ymd = bitLocalYmd(e.due_at);
        (porDia[ymd] = porDia[ymd] || []).push(e);
    });

    const nombresDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    let html = '';
    const cur = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
        const ymd = bitLocalYmd(cur);
        const entradasDia = (porDia[ymd] || []).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
        const esHoy = ymd === todayYmd;
        const cuerpo = entradasDia.length
            ? entradasDia.map(bitEntryRowHtml).join('')
            : '<div class="bitacora-semana-col-empty">Sin entradas</div>';
        html += `<div class="bitacora-semana-col ${esHoy ? 'hoy' : ''}">
            <div class="bitacora-semana-col-header">
                <span>${nombresDia[i]}</span>
                <span class="num">${cur.getDate()}</span>
            </div>
            <div class="bitacora-semana-col-body">${cuerpo}</div>
        </div>`;
        cur.setDate(cur.getDate() + 1);
    }
    grid.innerHTML = html;
}

// ─── Vista Lista ─────────────────────────────────────────────────────────────
async function loadBitacoraLista() {
    const hoy = new Date();
    const desde = new Date(hoy); desde.setDate(desde.getDate() - 60);
    const hasta = new Date(hoy); hasta.setDate(hasta.getDate() + 180);
    const params = bitacoraBuildQuery(desde, hasta);
    try {
        const res = await apiFetch(`/usuarios/api/bitacora?${params.toString()}`);
        if (!res || !res.ok) { state.bitacora.entries = []; renderBitacoraLista(); return; }
        const data = await res.json();
        const rows = bitacoraApplyClientFilters(data.entradas || []);
        state.bitacora.entries = rows;
        bitCacheEntries(rows);
        renderBitacoraLista();
    } catch (e) {
        console.error('Error cargando bitácora (lista):', e);
        state.bitacora.entries = [];
        renderBitacoraLista();
    }
}

function renderBitacoraLista() {
    const body = document.getElementById('bitacora-lista-body');
    if (!body) return;

    const rows = state.bitacora.entries || [];
    if (rows.length === 0) {
        body.innerHTML = '<div class="empty-state"><p>No hay entradas para los filtros seleccionados</p></div>';
        return;
    }

    const conFecha = rows.filter(e => e.due_at).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const sinFecha = rows.filter(e => !e.due_at);

    const grupos = new Map();
    conFecha.forEach(e => {
        const ymd = bitLocalYmd(e.due_at);
        if (!grupos.has(ymd)) grupos.set(ymd, []);
        grupos.get(ymd).push(e);
    });

    let html = '';
    for (const [ymd, entradas] of grupos.entries()) {
        const d = bitParseLocalDate(ymd);
        const label = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        html += `<div class="bitacora-lista-grupo">
            <div class="bitacora-lista-grupo-titulo">${escapeHtml(label)}</div>
            ${entradas.map(bitEntryRowHtml).join('')}
        </div>`;
    }
    if (sinFecha.length > 0) {
        html += `<div class="bitacora-lista-grupo">
            <div class="bitacora-lista-grupo-titulo">Sin fecha</div>
            ${sinFecha.map(bitEntryRowHtml).join('')}
        </div>`;
    }
    body.innerHTML = html;
}

// ─── Modal nueva/editar entrada ─────────────────────────────────────────────
function bitTogglePlazoBlock() {
    const kind = document.getElementById('bit-kind').value;
    const block = document.getElementById('bit-plazo-block');
    if (block) block.style.display = kind === 'vencimiento' ? 'block' : 'none';
}

// Header de contexto (B2, puntos 12/21 de la lista de arreglos del visor): busca la
// ficha en `state.bitacora.expedientes` (ya poblado por loadBitacoraExpedientes, que
// corre antes de cualquiera de los 3 call sites de openBitacoraModal) y muestra
// expediente/carátula/dependencia/situación/última actividad. Sin ficha vinculada
// (el "＋ Nueva entrada" global de la sección Bitácora) el bloque queda oculto — no
// hay nada que mostrar todavía.
function bitRenderCasoHeader(expedienteId) {
    const el = document.getElementById('bit-caso-header');
    if (!el) return;
    const ficha = expedienteId
        ? (state.bitacora.expedientes || []).find(x => String(x.id) === String(expedienteId))
        : null;
    if (!ficha) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="bit-caso-header-exp">${escapeHtml(ficha.expediente)}</div>
        ${ficha.caratula ? `<div class="bit-caso-header-car">${escapeHtml(ficha.caratula)}</div>` : ''}
        <div class="bit-caso-header-meta">
            ${ficha.dependencia ? `<span>${escapeHtml(ficha.dependencia)}</span>` : ''}
            ${ficha.situacion_actual ? `<span>${escapeHtml(ficha.situacion_actual)}</span>` : ''}
            ${ficha.situacion_fecha ? `<span>Últ. actividad: ${formatDate(ficha.situacion_fecha)}</span>` : ''}
        </div>`;
    el.style.display = 'block';
}

// `overrides` (F2.3): {kind, title, description} — precarga adicional para cuando la
// entrada nace de una captura desde el visor (kind=tipo elegido en el mini-menú,
// title/description sugeridos a partir del movimiento). Opcional; sin overrides se
// comporta exactamente igual que antes (F1.3/F1.4).
function openBitacoraModal(presetExpedienteId, overrides) {
    document.getElementById('bitacora-entrada-form').reset();
    document.getElementById('bit-id').value = '';
    document.getElementById('bitacora-modal-title').textContent = 'Nueva entrada';
    document.getElementById('bitacora-modal-alert').classList.remove('visible');
    document.getElementById('bit-due').value = state.bitacora.selectedDay || bitLocalYmd(new Date());
    if (presetExpedienteId) document.getElementById('bit-expediente').value = presetExpedienteId;
    if (overrides?.kind) document.getElementById('bit-kind').value = overrides.kind;
    if (overrides?.title) document.getElementById('bit-title').value = overrides.title;
    if (overrides?.description) document.getElementById('bit-description').value = overrides.description;
    bitRenderCasoHeader(document.getElementById('bit-expediente').value);
    bitTogglePlazoBlock();
    document.getElementById('modal-bitacora-entrada').classList.remove('hidden');
}

function openBitacoraModalById(id) {
    const e = bitEntryById(id);
    if (!e) { showToast('No se pudo abrir la entrada.', 'error'); return; }

    document.getElementById('bitacora-entrada-form').reset();
    document.getElementById('bit-id').value = e.id;
    document.getElementById('bitacora-modal-title').textContent = 'Editar entrada';
    document.getElementById('bitacora-modal-alert').classList.remove('visible');
    document.getElementById('bit-kind').value = e.kind;
    document.getElementById('bit-title').value = e.title || '';
    document.getElementById('bit-description').value = e.description || '';
    document.getElementById('bit-due').value = e.due_at ? bitLocalYmd(e.due_at) : '';
    document.getElementById('bit-expediente').value = e.expediente_id || '';
    document.getElementById('bit-repeat').value = e.repeat_rule || '';
    bitRenderCasoHeader(e.expediente_id);
    bitTogglePlazoBlock();
    document.getElementById('modal-bitacora-entrada').classList.remove('hidden');
}

function closeBitacoraModal() {
    document.getElementById('modal-bitacora-entrada').classList.add('hidden');
}

async function saveBitacoraEntrada(e) {
    e.preventDefault();
    const alertEl = document.getElementById('bitacora-modal-alert');
    const btn = document.getElementById('btn-guardar-bitacora');
    // Guard contra doble submit: `btn.disabled` bloquea un segundo CLICK de mouse
    // (un <button disabled> no dispara click), pero no bloquea un segundo evento
    // `submit` disparado por otra vía (Enter rebotado, un requestSubmit() repetido)
    // mientras el primer POST/PUT todavía está en vuelo — sin este chequeo, ese
    // segundo submit vuelve a entrar acá y crea una entrada duplicada en el servidor.
    if (btn.disabled) return;

    const id = document.getElementById('bit-id').value;
    const kind = document.getElementById('bit-kind').value;
    const title = document.getElementById('bit-title').value.trim();
    const description = document.getElementById('bit-description').value.trim();
    const dueYmd = document.getElementById('bit-due').value;
    const expedienteId = document.getElementById('bit-expediente').value;
    const repeatRule = document.getElementById('bit-repeat').value;

    if (!title) {
        showAlert(alertEl, 'error', 'El título es obligatorio.');
        return;
    }

    const body = {
        kind,
        title,
        description: description || null,
        due_at: dueYmd ? bitToIsoMidday(dueYmd) : null,
        expediente_id: expedienteId || null,
        // '' (opción "No se repite") → null. El backend rechaza cualquier valor que no
        // sea undefined/null/uno de REPEAT_RULES — un string vacío no pasa ese chequeo.
        repeat_rule: repeatRule || null,
    };

    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';

    try {
        const res = id
            ? await apiFetch(`/usuarios/api/bitacora/${id}`, { method: 'PUT', body })
            : await apiFetch('/usuarios/api/bitacora', { method: 'POST', body });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            showAlert(alertEl, 'error', data.error || 'Error al guardar.');
            return;
        }
        closeBitacoraModal();
        showToast(id ? 'Entrada actualizada.' : 'Entrada creada.', 'success');
        bitacoraRefreshCurrentContext();
    } catch (err) {
        showAlert(alertEl, 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// Refresca la vista activa tras crear/editar/tildar/borrar una entrada — la
// misma entrada puede tocarse desde el banner/calendario/lista de Bitácora O
// desde el bloque "Entradas de este caso" de una ficha en Mis Expedientes; el
// llamador (bitEntryRowHtml, el banner de avisos) es el mismo en los dos
// contextos, así que quien decide qué repintar es esta función, no cada botón.
function bitacoraRefreshCurrentContext() {
    if (state.currentSection === 'mis-expedientes' && state.miExp.fichaId) {
        openMexpFicha(state.miExp.fichaId, true); // repintado, no navegación
        return;
    }
    loadBitacoraAvisos();
    bitacoraLoadAndRenderView();
}

// `sinToast` lo usa bitacoraUndoLastDone() — deshacer no debe mostrar a su vez
// "podés deshacer con Ctrl+Z", porque eso re-armaría _lastDoneAction con la
// acción inversa y el usuario podría rebotar entre los dos estados sin darse
// cuenta de que ya deshizo lo que quería.
async function toggleBitacoraDone(id, done, sinToast) {
    try {
        const res = await apiFetch(`/usuarios/api/bitacora/${id}/done`, { method: 'POST', body: { done } });
        if (!res || !res.ok) { showToast('No se pudo actualizar la entrada.', 'error'); return; }
        state.bitacora._lastDoneAction = sinToast ? null : { id, done };
        if (!sinToast) {
            showToast(done ? 'Marcada como hecha — Ctrl+Z para deshacer' : 'Marcada como pendiente — Ctrl+Z para deshacer', 'success');
        }
        bitacoraRefreshCurrentContext();
    } catch (e) {
        showToast('Error de conexión.', 'error');
    }
}

// Deshace el último toggle (marcar hecho/pendiente), disparado por Ctrl+Z.
// Un solo nivel de historial a propósito: es un atajo de "me equivoqué recién",
// no un historial de cambios — encadenar niveles agregaría complejidad sin un
// caso de uso real detrás.
function bitacoraUndoLastDone() {
    const last = state.bitacora._lastDoneAction;
    if (!last) return;
    state.bitacora._lastDoneAction = null;
    toggleBitacoraDone(last.id, !last.done, true);
    showToast('Deshecho', 'success');
}

async function deleteBitacoraEntrada(id) {
    if (!(await showConfirm('¿Eliminar esta entrada de la bitácora? Esta acción no se puede deshacer.'))) return;
    try {
        const res = await apiFetch(`/usuarios/api/bitacora/${id}`, { method: 'DELETE' });
        if (!res || !res.ok) { showToast('No se pudo eliminar la entrada.', 'error'); return; }
        showToast('Entrada eliminada.', 'success');
        bitacoraRefreshCurrentContext();
    } catch (e) {
        showToast('Error de conexión.', 'error');
    }
}

// =============================================================================
//  SECCIÓN: MIS EXPEDIENTES (F1.4)
// =============================================================================
// Listado + ficha completa de los casos que el usuario sigue en la Bitácora.
// Comparte el listado de fichas con el módulo Bitácora (`state.bitacora.expedientes`,
// poblado por `loadBitacoraExpedientes()` de ese módulo) para no duplicar la
// llamada de red ni el <select> de vínculo. También reusa `bitEntryRowHtml()` y
// `bitCacheEntries()` de Bitácora para el bloque "Entradas de este caso" — es el
// mismo tipo de registro, mostrado en otro contexto.

// ─── Navegación listado ↔ ficha ─────────────────────────────────────────────
async function renderMisExpedientes() {
    state.miExp.fichaId = null;
    state.miExp.ficha = null;
    mexpShowLista();
    await loadMexpList();
}

function mexpShowLista() {
    document.getElementById('mexp-vista-lista').style.display = 'block';
    document.getElementById('mexp-vista-ficha').style.display = 'none';
}

function mexpShowFicha() {
    document.getElementById('mexp-vista-lista').style.display = 'none';
    document.getElementById('mexp-vista-ficha').style.display = 'block';
}

// ─── Listado ─────────────────────────────────────────────────────────────────
async function loadMexpList() {
    await loadBitacoraExpedientes(); // hace el fetch real y llena los <select> compartidos
    state.miExp.list = state.bitacora.expedientes || [];
    renderMexpLista();
}

function mexpOnSearchInput(value) {
    state.miExp.search = value.trim().toLowerCase();
    renderMexpLista();
}

// ─── Multi-selección (borrado en lote) ──────────────────────────────────────
// La selección vive en `state.miExp.selected` (Set de ids), no en el DOM: si
// viviera en checkboxes sueltos, filtrar por búsqueda la perdería sola. Se
// mantiene entre búsquedas a propósito (elegís algunos, buscás otro, sumás
// más) — lo único acotado al filtro vigente es el checkbox "seleccionar todo".
function mexpToggleSelect(id, checked) {
    if (checked) state.miExp.selected.add(id);
    else state.miExp.selected.delete(id);
    mexpRenderSelectionBar();
    mexpUpdateSelectAllCheckbox();
}

function mexpToggleSelectAll(checked) {
    const visibles = state.miExp._visibleIds || [];
    if (checked) visibles.forEach(id => state.miExp.selected.add(id));
    else visibles.forEach(id => state.miExp.selected.delete(id));
    renderMexpLista();
}

function mexpUpdateSelectAllCheckbox() {
    const master = document.getElementById('mexp-check-all');
    if (!master) return;
    const visibles = state.miExp._visibleIds || [];
    const seleccionadosVisibles = visibles.filter(id => state.miExp.selected.has(id));
    master.checked = visibles.length > 0 && seleccionadosVisibles.length === visibles.length;
    master.indeterminate = seleccionadosVisibles.length > 0 && seleccionadosVisibles.length < visibles.length;
}

function mexpRenderSelectionBar() {
    const bar = document.getElementById('mexp-selection-bar');
    const countEl = document.getElementById('mexp-selection-count');
    if (!bar || !countEl) return;
    const n = state.miExp.selected.size;
    if (n === 0) {
        bar.classList.add('hidden');
        return;
    }
    bar.classList.remove('hidden');
    countEl.textContent = n === 1 ? '1 seleccionado' : `${n} seleccionados`;
}

function mexpClearSelection() {
    state.miExp.selected.clear();
    renderMexpLista();
}

function mexpExportarSeleccionados() {
    const ids = [...state.miExp.selected];
    if (ids.length === 0) return;
    openExportModal('expediente', ids);
}

function renderMexpLista() {
    const body = document.getElementById('mexp-lista-body');
    if (!body) return;

    let rows = state.miExp.list || [];
    if (state.miExp.search) {
        const q = state.miExp.search;
        rows = rows.filter(x =>
            (x.expediente || '').toLowerCase().includes(q) ||
            (x.caratula || '').toLowerCase().includes(q)
        );
    }
    state.miExp._visibleIds = rows.map(x => x.id);

    if (rows.length === 0) {
        const msg = state.miExp.search ? 'Sin resultados para tu búsqueda' : 'Todavía no seguís ningún expediente';
        body.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
        mexpRenderSelectionBar();
        return;
    }

    const trs = rows.map(x => {
        const checked = state.miExp.selected.has(x.id) ? 'checked' : '';
        return `
        <tr onclick="openMexpFicha(${x.id})">
            <td class="mexp-td-check" onclick="event.stopPropagation()">
                <input type="checkbox" class="mexp-checkbox" ${checked} onchange="mexpToggleSelect(${x.id}, this.checked)">
            </td>
            <td><strong>${escapeHtml(x.expediente)}</strong></td>
            <td>${escapeHtml(x.caratula || '—')}</td>
            <td>${escapeHtml(x.situacion_actual || '—')}</td>
            <td>${x.vencidas > 0 ? `<span class="mexp-pend-badge">🔴 ${x.vencidas}</span>` : '—'}</td>
            <td>${formatDate(x.updated_at)}</td>
        </tr>
    `;
    }).join('');

    body.innerHTML = `<table class="mexp-table">
        <thead><tr>
            <th class="mexp-th-check" onclick="event.stopPropagation()"><input type="checkbox" class="mexp-checkbox" id="mexp-check-all" onchange="mexpToggleSelectAll(this.checked)"></th>
            <th>Expediente</th><th>Carátula</th><th>Situación</th><th>Pendien.</th><th>Últ. act.</th>
        </tr></thead>
        <tbody>${trs}</tbody>
    </table>`;

    mexpUpdateSelectAllCheckbox();
    mexpRenderSelectionBar();
}

// ─── Ficha ───────────────────────────────────────────────────────────────────
// `sinPush`: no apilar una entrada de historial. Se usa cuando esto NO es una
// navegación real sino un repintado de la ficha que ya estaba abierta (tildar una
// entrada, editarla) — sin esa distinción, cada refresh dejaría una entrada más en
// el historial y el botón Atrás tendría que apretarse N veces para salir de la ficha.
async function openMexpFicha(id, sinPush) {
    mexpShowFicha();
    if (!sinPush) pushNavState({ _sec: 'mis-expedientes', _ficha: id });
    state.miExp.fichaId = id;
    document.getElementById('mexp-ficha-body').innerHTML = '<div class="empty-state"><p>Cargando...</p></div>';

    try {
        const res = await apiFetch(`/usuarios/api/expedientes/${id}`);
        if (!res || !res.ok) {
            showToast('No se pudo abrir el expediente.', 'error');
            mexpShowLista();
            return;
        }
        const data = await res.json();
        state.miExp.ficha = data;
        bitCacheEntries(data.entradas || []); // para que el check/editar/borrar de cada entrada funcione acá también
        renderMexpFicha();
    } catch (e) {
        console.error('Error abriendo ficha de expediente:', e);
        showToast('Error de conexión.', 'error');
        mexpShowLista();
    }
}

function closeMexpFicha() {
    state.miExp.fichaId = null;
    state.miExp.ficha = null;
    mexpShowLista();
    loadMexpList(); // por si hubo cambios (editar/agregar entrada) mientras se veía la ficha
}

// Entrada desde un deep-link `?goto=expediente&exp=<numero>` (los links 📁 de los
// visores). El visor conoce el número tal como lo devolvió el PJN, no el id de la
// ficha, así que la resolución la hace el servidor con la normalización canónica
// (GET /expedientes/by-key) — ver el comentario de ese endpoint.
//
// Sin `exp` (los clientes ya instalados, ≤ v2.7.49, mandan el link sin él) igual
// aterriza en el listado: destino útil, no la pantalla en blanco de antes.
async function abrirFichaPorNumero(exp) {
    if (!state.account?.bitacoraEnabled) {
        navigateTo('plan');
        showToast('Tu plan no incluye el módulo Bitácora.', 'error');
        return;
    }

    navigateTo('mis-expedientes');
    if (!exp) return;

    try {
        const res = await apiFetch(`/usuarios/api/expedientes/by-key?exp=${encodeURIComponent(exp)}`);
        if (!res) return;
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast(
                data.code === 'NO_SEGUIDO'
                    ? `${exp} todavía no está en tu Bitácora. Guardalo desde el visor para verlo acá.`
                    : (data.error || 'No se pudo abrir ese expediente.'),
                'error'
            );
            return;
        }
        const data = await res.json();
        await openMexpFicha(data.expediente.id);
    } catch (e) {
        showToast('Error de conexión al abrir el expediente.', 'error');
    }
}

function mexpProximoVencimiento(entradas) {
    const pendientes = (entradas || [])
        .filter(e => e.due_at && !e.done_at)
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    return pendientes.length > 0 ? pendientes[0] : null;
}

// Pendientes primero (por fecha, las sin fecha al final), después lo hecho —
// criterio del mockup de §5.2: "vencimientos y audiencias arriba".
function mexpEntradasOrdenadas(entradas) {
    const list = entradas || [];
    const pendientes = list.filter(e => !e.done_at).sort((a, b) => {
        if (!a.due_at && !b.due_at) return 0;
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return new Date(a.due_at) - new Date(b.due_at);
    });
    const hechas = list.filter(e => e.done_at).sort((a, b) =>
        new Date(b.due_at || b.updated_at) - new Date(a.due_at || a.updated_at)
    );
    return [...pendientes, ...hechas];
}

// Bloque "Última / Anteúltima" de un tipo de snapshot (procuracion|informe).
// Hoy siempre muestra "No hay X guardados" — nada escribe en expediente_snapshots
// todavía (eso lo construye la captura desde los visores, Fase 2, sin implementar).
function mexpHistorialBloqueHtml(snapshots, kind, label) {
    const deEsteKind = (snapshots || []).filter(s => s.kind === kind); // ya viene ordenado DESC por created_at
    if (deEsteKind.length === 0) {
        return `<div class="mexp-historial-kind">
            <div class="mexp-historial-kind-titulo">${escapeHtml(label)}</div>
            <div style="font-size:13px;color:var(--text-muted)">No hay ${label.toLowerCase()} guardados</div>
        </div>`;
    }
    const filas = deEsteKind.slice(0, 2).map((s, i) => `
        <div class="mexp-historial-item">
            <span>${i === 0 ? 'Última' : 'Anteúltima'} — ${bitFormatUtcDate(s.run_date)}${s.situacion ? ` · ${escapeHtml(s.situacion)}` : ''}</span>
            <button type="button" class="btn btn-outline btn-sm" onclick="verMexpSnapshot(${s.id})">👁 Ver</button>
        </div>
    `).join('');
    return `<div class="mexp-historial-kind">
        <div class="mexp-historial-kind-titulo">${escapeHtml(label)}</div>
        ${filas}
    </div>`;
}

function renderMexpFicha() {
    const wrap = document.getElementById('mexp-ficha-body');
    if (!wrap || !state.miExp.ficha) return;

    const { expediente: x, entradas, snapshots } = state.miExp.ficha;

    const subPartes = [x.jurisdiccion, x.dependencia].filter(Boolean).join(' · ');
    const situacionTxt = x.situacion_actual
        ? `Situación actual: ${escapeHtml(x.situacion_actual)}${x.situacion_fecha ? ` (${bitFormatUtcDate(x.situacion_fecha)})` : ''}`
        : '';
    const proximo = mexpProximoVencimiento(entradas);
    const proximoHtml = proximo
        ? `<div class="mexp-proximo-venc">⏰ Próximo vencimiento: ${formatDate(proximo.due_at)} — ${escapeHtml(proximo.title)}</div>`
        : '';

    const entradasOrdenadas = mexpEntradasOrdenadas(entradas);
    const entradasHtml = entradasOrdenadas.length > 0
        ? entradasOrdenadas.map(bitEntryRowHtml).join('')
        : '<div class="empty-state"><p>Sin entradas vinculadas a este caso</p></div>';

    const historialHtml = mexpHistorialBloqueHtml(snapshots, 'procuracion', 'Procuraciones guardadas')
        + mexpHistorialBloqueHtml(snapshots, 'informe', 'Informes guardados');

    wrap.innerHTML = `
        <div class="card">
            <div class="card-body">
                <div class="mexp-ficha-header">
                    <div class="mexp-ficha-titulo">${escapeHtml(x.expediente)}${x.caratula ? ' — ' + escapeHtml(x.caratula) : ''}</div>
                    ${subPartes ? `<div class="mexp-ficha-sub">${escapeHtml(subPartes)}</div>` : ''}
                    ${situacionTxt ? `<div class="mexp-ficha-sub">${situacionTxt}</div>` : ''}
                    ${proximoHtml}
                    <div class="mexp-ficha-actions">
                        <button class="btn btn-outline btn-sm" onclick="openMexpEditarFicha()">✏ Editar</button>
                        <button class="btn btn-outline btn-sm" onclick="openExportModal('expediente', ${x.id})">⬇ Exportar este caso</button>
                        <button class="btn btn-outline btn-sm" style="color:#ef4444;border-color:#fecaca" onclick="askMexpEliminar()">🗑 Eliminar seguimiento</button>
                    </div>
                    ${x.notas ? `<div class="mexp-ficha-sub" style="margin-top:10px;white-space:pre-line">${escapeHtml(x.notas)}</div>` : ''}
                </div>
            </div>
        </div>
        <div class="card mexp-bloque">
            <div class="card-header mexp-bloque-header">
                <h3>📔 Entradas de este caso (${entradas.length})</h3>
                <button class="btn btn-primary btn-sm" onclick="openBitacoraModal(${x.id})">＋ Nueva entrada</button>
            </div>
            <div class="card-body">${entradasHtml}</div>
        </div>
        <div class="card mexp-bloque">
            <div class="card-header"><h3>📜 Historial del caso</h3></div>
            <div class="card-body">${historialHtml}</div>
        </div>`;
}

// ─── Modal: agregar/editar la ficha ─────────────────────────────────────────
function openMexpNuevaFicha() {
    document.getElementById('mexp-ficha-form').reset();
    document.getElementById('mexp-id').value = '';
    document.getElementById('mexp-modal-title').textContent = 'Agregar expediente';
    document.getElementById('mexp-modal-alert').classList.remove('visible');
    document.getElementById('modal-mexp-ficha').classList.remove('hidden');
}

function openMexpEditarFicha() {
    const x = state.miExp.ficha?.expediente;
    if (!x) return;
    document.getElementById('mexp-ficha-form').reset();
    document.getElementById('mexp-id').value = x.id;
    document.getElementById('mexp-modal-title').textContent = 'Editar expediente';
    document.getElementById('mexp-modal-alert').classList.remove('visible');
    document.getElementById('mexp-expediente').value = x.expediente || '';
    document.getElementById('mexp-jurisdiccion').value = x.jurisdiccion || '';
    document.getElementById('mexp-dependencia').value = x.dependencia || '';
    document.getElementById('mexp-caratula').value = x.caratula || '';
    document.getElementById('mexp-situacion').value = x.situacion_actual || '';
    document.getElementById('mexp-situacion-fecha').value = x.situacion_fecha ? bitUtcYmd(x.situacion_fecha) : '';
    document.getElementById('mexp-notas').value = x.notas || '';
    document.getElementById('modal-mexp-ficha').classList.remove('hidden');
}

function closeMexpFichaModal() {
    document.getElementById('modal-mexp-ficha').classList.add('hidden');
}

async function saveMexpFicha(e) {
    e.preventDefault();
    const alertEl = document.getElementById('mexp-modal-alert');
    const btn = document.getElementById('btn-guardar-mexp');
    // Mismo guard que saveBitacoraEntrada — ver el comentario ahí para el porqué.
    if (btn.disabled) return;

    const id = document.getElementById('mexp-id').value;
    const expediente = document.getElementById('mexp-expediente').value.trim();
    if (!expediente) {
        showAlert(alertEl, 'error', 'El expediente es obligatorio.');
        return;
    }

    const situacionFechaYmd = document.getElementById('mexp-situacion-fecha').value;
    const body = {
        expediente,
        jurisdiccion: document.getElementById('mexp-jurisdiccion').value.trim() || null,
        dependencia: document.getElementById('mexp-dependencia').value.trim() || null,
        caratula: document.getElementById('mexp-caratula').value.trim() || null,
        situacion_actual: document.getElementById('mexp-situacion').value.trim() || null,
        situacion_fecha: situacionFechaYmd ? bitToIsoMidday(situacionFechaYmd) : null,
        notas: document.getElementById('mexp-notas').value.trim() || null,
    };

    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';

    try {
        const res = id
            ? await apiFetch(`/usuarios/api/expedientes/${id}`, { method: 'PUT', body })
            : await apiFetch('/usuarios/api/expedientes', { method: 'POST', body });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            showAlert(alertEl, 'error', data.error || 'Error al guardar.');
            return;
        }
        closeMexpFichaModal();
        if (!id && data.creado === false) {
            showToast('Ya seguías ese expediente — se actualizó la ficha existente.', 'info');
        } else {
            showToast(id ? 'Expediente actualizado.' : 'Expediente agregado.', 'success');
        }
        await loadMexpList();
        // Editar (id presente) = la ficha ya estaba abierta → repintado, no apila.
        // Crear (sin id) = venías del listado → sí es una navegación nueva.
        openMexpFicha(data.expediente.id, !!id);
    } catch (err) {
        showAlert(alertEl, 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ─── Eliminar seguimiento (con elección sobre las entradas) ─────────────────
// El modal es el mismo para 1 caso (desde la ficha) o varios (desde el
// listado, borrado múltiple) — `_eliminarIds` guarda el objetivo y el texto
// se ajusta al plural. `mexpEliminarFicha(modo)` recorre los ids de a uno,
// SECUENCIAL (mismo criterio que el guardado de un lote en F2.3): con pocas
// decenas de casos como mucho, y así un fallo puntual no aborta el resto.
function askMexpEliminar() {
    const id = state.miExp.fichaId;
    if (!id) return;
    state.miExp._eliminarIds = [id];
    document.getElementById('mexp-eliminar-texto').textContent =
        'Vas a dejar de seguir este expediente. ¿Qué querés hacer con sus entradas de bitácora vinculadas?';
    document.getElementById('modal-mexp-eliminar').classList.remove('hidden');
}

function mexpAskEliminarSeleccionados() {
    const ids = [...state.miExp.selected];
    if (ids.length === 0) return;
    state.miExp._eliminarIds = ids;
    const plural = ids.length === 1 ? 'este expediente' : `estos ${ids.length} expedientes`;
    document.getElementById('mexp-eliminar-texto').textContent =
        `Vas a dejar de seguir ${plural}. ¿Qué querés hacer con sus entradas de bitácora vinculadas?`;
    document.getElementById('modal-mexp-eliminar').classList.remove('hidden');
}

function closeMexpEliminarModal() {
    document.getElementById('modal-mexp-eliminar').classList.add('hidden');
}

async function mexpEliminarFicha(modo) {
    const ids = state.miExp._eliminarIds;
    if (!ids || ids.length === 0) return;
    closeMexpEliminarModal();

    let ok = 0, fail = 0, entradasBorradas = 0;
    for (const id of ids) {
        try {
            const res = await apiFetch(`/usuarios/api/expedientes/${id}?entries=${modo}`, { method: 'DELETE' });
            if (!res || !res.ok) { fail++; continue; }
            const data = await res.json();
            ok++;
            entradasBorradas += data.entradasBorradas || 0;
        } catch (e) {
            fail++;
        }
    }

    state.miExp._eliminarIds = null;
    state.miExp.selected.clear();

    if (fail === 0) {
        showToast(
            ids.length === 1
                ? (modo === 'delete' ? `Expediente eliminado junto con ${entradasBorradas} entrada(s).` : 'Expediente eliminado. Sus entradas quedaron sueltas, sin vínculo.')
                : `${ok} expedientes eliminados.`,
            'success'
        );
    } else if (ok === 0) {
        showToast('No se pudo eliminar ningún expediente.', 'error');
    } else {
        showToast(`${ok} eliminados, ${fail} no se pudieron eliminar.`, 'error');
    }

    // Si la ficha abierta era uno de los eliminados, volvés al listado.
    if (state.miExp.fichaId && ids.includes(state.miExp.fichaId)) {
        state.miExp.fichaId = null;
        state.miExp.ficha = null;
        mexpShowLista();
    }
    await loadMexpList();
}

// ─── Modal: ver un snapshot del historial ───────────────────────────────────
async function verMexpSnapshot(snapshotId) {
    const modal = document.getElementById('modal-mexp-snapshot');
    const body = document.getElementById('mexp-snapshot-body');
    const titleEl = document.getElementById('mexp-snapshot-title');
    modal.classList.remove('hidden');
    body.innerHTML = '<div class="empty-state"><p>Cargando...</p></div>';

    const fichaId = state.miExp.fichaId;
    if (!fichaId) return;

    try {
        const res = await apiFetch(`/usuarios/api/expedientes/${fichaId}/snapshots/${snapshotId}`);
        if (!res || !res.ok) {
            body.innerHTML = '<div class="empty-state"><p>No se pudo cargar el historial.</p></div>';
            return;
        }
        const data = await res.json();
        renderMexpSnapshot(data.snapshot, titleEl, body);
    } catch (e) {
        body.innerHTML = '<div class="empty-state"><p>Error de conexión.</p></div>';
    }
}

/** Un movimiento (fecha/tipo/detalle) — misma tarjeta que ya usaba el modal
 *  antes de esta extensión (2026-09-04). Reusada por la sección principal
 *  ("Movimientos") y por la única sección extra con esta misma forma
 *  ("Movimientos históricos"). */
function mexpSnapshotMovHtml(m) {
    return `
        <div class="mexp-snapshot-mov">
            <strong>${escapeHtml(m?.fecha || '')}</strong> ${escapeHtml(m?.tipo || '')}<br>
            <span style="color:var(--text-muted)">${escapeHtml(m?.detalle || '')}</span>
        </div>
    `;
}

/** Sección principal de movimientos ACTUALES — SIN encabezado propio (así
 *  estaba antes de esta extensión) y con el mismo "Sin movimientos
 *  registrados" de siempre si viene vacía. No-regresión a propósito: ni
 *  procuración ni un snapshot viejo (solo `movimientos`+`pdf`) deben verse
 *  distintos a como se veían antes de agregar las 5 secciones extra. */
function mexpSnapshotMovimientosHtml(movimientos) {
    if (movimientos.length === 0) {
        return '<div class="empty-state"><p>Sin movimientos registrados en esta corrida</p></div>';
    }
    return movimientos.map(mexpSnapshotMovHtml).join('');
}

/**
 * Sección extra opcional (2026-09-04) con la MISMA forma que los movimientos
 * (fecha/tipo/detalle) — hoy solo "Movimientos históricos". Se omite POR
 * COMPLETO (título incluido) si no hay datos: "Movimientos históricos (0)"
 * parece contenido real y no lo es — mismo criterio que ya aplicó el
 * extractor del lado de Electron al descartar el mensaje del PJN "El
 * expediente no posee actuaciones históricas" en vez de guardarlo como si
 * fuera una entrada real (ver `electron-app/informe/movimientosInforme.js`).
 */
function mexpSnapshotSeccionMovsHtml(titulo, lista) {
    if (!Array.isArray(lista) || lista.length === 0) return '';
    return `
        <div class="mexp-historial-kind-titulo" style="margin-top:16px">${escapeHtml(titulo)} (${lista.length})</div>
        ${lista.map(mexpSnapshotMovHtml).join('')}
    `;
}

/**
 * Sección extra de texto libre (intervinientes/vinculados/recursos/notas,
 * 2026-09-04) — `string[]` ya limpio del lado de Electron (sin fila de
 * encabezado, sin duplicados, sin el mensaje "El expediente no posee..." de
 * una sección vacía). Cada entrada puede traer saltos de línea internos (ej.
 * "LETRADO APODERADO\nNOMBRE APELLIDO"), por eso `white-space:pre-wrap` en vez
 * de reemplazar `\n` a mano. Se omite POR COMPLETO si no hay datos, mismo
 * criterio que `mexpSnapshotSeccionMovsHtml`.
 */
function mexpSnapshotSeccionTextoHtml(titulo, lista) {
    if (!Array.isArray(lista) || lista.length === 0) return '';
    const items = lista.map(item => `
        <div class="mexp-snapshot-mov" style="white-space:pre-wrap">${escapeHtml(item)}</div>
    `).join('');
    return `
        <div class="mexp-historial-kind-titulo" style="margin-top:16px">${escapeHtml(titulo)} (${lista.length})</div>
        ${items}
    `;
}

function renderMexpSnapshot(s, titleEl, body) {
    titleEl.textContent = (s.kind === 'procuracion' ? 'Procuración' : 'Informe') + ' — ' + bitFormatUtcDate(s.run_date);

    const movimientos = Array.isArray(s.data?.movimientos) ? s.data.movimientos : [];
    let html = `<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        Corrida del ${bitFormatUtcDate(s.run_date)}${s.situacion ? ` · Situación registrada: ${escapeHtml(s.situacion)}` : ''}
    </p>`;

    // Lo único que el informe tiene y la procuración no: el PDF que produjo esa
    // corrida. Va como texto (nombre de archivo), no como link: el PDF vive en el
    // disco del usuario y el navegador bloquea un file:// abierto desde https.
    const pdf = typeof s.data?.pdf === 'string' ? s.data.pdf : '';
    if (pdf) {
        html += `<p style="font-size:13px;margin-bottom:12px">
            📄 Informe generado: <strong>${escapeHtml(pdf)}</strong><br>
            <span style="color:var(--text-muted)">Está en tu carpeta de descargas de la app.</span>
        </p>`;
    }

    html += mexpSnapshotMovimientosHtml(movimientos);
    // Las 5 secciones extra del informe (2026-09-04): agrupadas con su propio
    // título, cada una oculta por completo si el usuario no la tildó al generar
    // el informe (o si el snapshot es de una corrida anterior a esta extensión).
    html += mexpSnapshotSeccionMovsHtml('Movimientos históricos', s.data?.historicos);
    html += mexpSnapshotSeccionTextoHtml('Intervinientes', s.data?.intervinientes);
    html += mexpSnapshotSeccionTextoHtml('Vinculados', s.data?.vinculados);
    html += mexpSnapshotSeccionTextoHtml('Recursos', s.data?.recursos);
    html += mexpSnapshotSeccionTextoHtml('Notas', s.data?.notas);

    body.innerHTML = html;
}

function closeMexpSnapshotModal() {
    document.getElementById('modal-mexp-snapshot').classList.add('hidden');
}

// =============================================================================
//  EXPORTACIÓN — backup del usuario (F1.6)
// =============================================================================
// Modal compartido entre Bitácora, Mis Expedientes (listado) y la ficha de un
// expediente ("⬇ Exportar este caso"). El único endpoint (GET, no JSON) se
// descarga con fetch + blob porque necesita el header Authorization — un
// <a href> plano no puede mandarlo (mismo patrón que openInvoicePdf()).

function openExportModal(presetAlcance, presetExpedienteId) {
    document.getElementById('export-modal-alert').classList.remove('visible');
    document.getElementById('export-alcance-todo').checked = true;
    document.getElementById('export-formato-json').checked = true;
    document.getElementById('export-desde').value = '';
    document.getElementById('export-hasta').value = '';
    state.miExp._exportMultiIds = null; // reset — por default manda el <select> de siempre

    // Reusa el listado ya cargado por Bitácora/Mis Expedientes (loadBitacoraExpedientes) —
    // sin pedirlo de nuevo.
    const sel = document.getElementById('export-expediente-id');
    const opts = (state.bitacora.expedientes || []).map(x =>
        `<option value="${x.id}">${escapeHtml(x.expediente)}${x.caratula ? ' — ' + escapeHtml(x.caratula) : ''}</option>`
    ).join('');
    sel.innerHTML = '<option value="">— Elegí un expediente —</option>' + opts;

    // "Exportar seleccionados" (Mis Expedientes, Bloque B) manda un ARRAY de
    // ids — se guarda en state y el <select> queda oculto a favor del resumen
    // de exportUpdateSubfields(). "Exportar este caso" sigue mandando un id
    // suelto, como siempre.
    if (presetAlcance === 'expediente' && Array.isArray(presetExpedienteId)) {
        document.getElementById('export-alcance-expediente').checked = true;
        state.miExp._exportMultiIds = presetExpedienteId;
    } else if (presetAlcance === 'expediente' && presetExpedienteId) {
        document.getElementById('export-alcance-expediente').checked = true;
        sel.value = presetExpedienteId;
    } else if (presetAlcance) {
        const radio = document.getElementById(`export-alcance-${presetAlcance}`);
        if (radio) radio.checked = true;
    }

    exportUpdateSubfields();
    document.getElementById('modal-bitacora-export').classList.remove('hidden');
}

function exportUpdateSubfields() {
    const alcance = document.querySelector('input[name="export-alcance"]:checked')?.value || 'todo';
    document.getElementById('export-rango-wrap').style.display = alcance === 'entradas' ? 'flex' : 'none';
    document.getElementById('export-expediente-wrap').style.display = alcance === 'expediente' ? 'block' : 'none';

    // Con una selección múltiple (`_exportMultiIds`), el <select> de "elegí un
    // expediente" no tiene sentido — ya está elegido desde la lista. Se oculta
    // y se muestra un resumen de solo lectura con los expedientes incluidos.
    const sel = document.getElementById('export-expediente-id');
    const resumen = document.getElementById('export-expediente-resumen');
    const multiIds = state.miExp._exportMultiIds;
    if (alcance === 'expediente' && multiIds && multiIds.length > 0) {
        sel.style.display = 'none';
        resumen.style.display = 'block';
        const expPorId = new Map((state.bitacora.expedientes || []).map(x => [x.id, x.expediente]));
        const nombres = multiIds.map(id => expPorId.get(id) || `#${id}`);
        resumen.innerHTML = `<strong>${multiIds.length}</strong> expediente(s) seleccionado(s): ${escapeHtml(nombres.join(', '))}`;
    } else {
        sel.style.display = '';
        resumen.style.display = 'none';
    }

    // .ics excluye las entradas sin fecha (notas, tareas de revisión de F3.3
    // sin plazo) — un VEVENT sin DTSTART es inválido por RFC 5545. El modal
    // lo aclara para que "menos entradas que el Excel del mismo alcance" no
    // se lea como un bug (§B.2.3 del plan).
    const formato = document.querySelector('input[name="export-formato"]:checked')?.value || 'json';
    const notaIcs = document.getElementById('export-ics-nota');
    if (notaIcs) notaIcs.style.display = formato === 'ics' ? 'block' : 'none';
}

function closeExportModal() {
    document.getElementById('modal-bitacora-export').classList.add('hidden');
}

// ─── Restaurar backup (F1.7) ────────────────────────────────────────────────
// Flujo de dos pasos, deliberadamente incómodo de saltear: elegir archivo+modo →
// vista previa con números concretos → confirmar. Antes de aplicar, el portal
// descarga un respaldo del estado actual; si ese respaldo falla, la restauración
// se ABORTA (sin respaldo, la operación dejaría de ser reversible, que es la
// garantía que sostiene toda esta pantalla).

function openImportModal() {
    document.getElementById('import-modal-alert').classList.remove('visible');
    document.getElementById('import-file').value = '';
    document.getElementById('import-file-name').textContent = 'Sin archivo seleccionado';
    const combinar = document.querySelector('input[name="import-modo"][value="combinar"]');
    if (combinar) combinar.checked = true;
    volverPasoArchivoImport();
    document.getElementById('modal-bitacora-import').classList.remove('hidden');
}

function closeImportModal() {
    document.getElementById('modal-bitacora-import').classList.add('hidden');
}

function volverPasoArchivoImport() {
    document.getElementById('import-paso-archivo').style.display = 'block';
    document.getElementById('import-paso-preview').style.display = 'none';
    document.getElementById('btn-import-preview').style.display = '';
    document.getElementById('btn-import-confirmar').style.display = 'none';
    document.getElementById('btn-import-volver').style.display = 'none';
}

function importArchivoYModo() {
    const file = document.getElementById('import-file').files[0] || null;
    const modo = document.querySelector('input[name="import-modo"]:checked')?.value || 'combinar';
    return { file, modo };
}

async function pedirPreviewImport() {
    const alertEl = document.getElementById('import-modal-alert');
    const { file, modo } = importArchivoYModo();
    if (!file) { showAlert(alertEl, 'error', 'Elegí el archivo .json del backup.'); return; }

    const btn = document.getElementById('btn-import-preview');
    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Analizando...';

    try {
        const fd = new FormData();
        fd.append('backup', file);
        fd.append('modo', modo);
        fd.append('dry_run', '1');
        // Sin Content-Type a mano: el browser arma el boundary del multipart.
        const res = await fetch(`${BASE_URL}/usuarios/api/bitacora/import`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getToken()}` },
            body: fd
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showAlert(alertEl, 'error', data.error || 'No se pudo leer el backup.'); return; }

        alertEl.classList.remove('visible');
        renderImportPreview(data);
        document.getElementById('import-paso-archivo').style.display = 'none';
        document.getElementById('import-paso-preview').style.display = 'block';
        document.getElementById('btn-import-preview').style.display = 'none';
        document.getElementById('btn-import-volver').style.display = '';
        document.getElementById('btn-import-confirmar').style.display = '';
    } catch (e) {
        showAlert(alertEl, 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

function renderImportPreview(data) {
    const p = data.preview || {};
    const c = p.contenido || { expedientes: 0, entradas: 0, snapshots: 0 };
    const esReemplazo = data.modo === 'reemplazar';
    const fila = (label, num) =>
        `<div class="import-preview-row"><span>${escapeHtml(label)}</span><span class="import-preview-num">${Number(num) || 0}</span></div>`;

    let html = `<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        Backup válido${data.exportado_el ? ` · exportado el ${formatDate(data.exportado_el)}` : ''} ·
        ${c.expedientes} casos · ${c.entradas} entradas${c.snapshots ? ` · ${c.snapshots} de historial` : ''}
    </p>`;

    if (esReemplazo) {
        html += `<div class="import-preview-box import-preview-destruye">
            <div class="import-preview-titulo">⚠️ Se va a eliminar</div>
            ${fila('Casos que seguís hoy', p.eliminar?.expedientes)}
            ${fila('Entradas de tu Bitácora', p.eliminar?.entradas)}
        </div>`;
    }

    html += `<div class="import-preview-box">
        <div class="import-preview-titulo">Se va a crear</div>
        ${fila('Casos', p.crear?.expedientes)}
        ${fila('Entradas', p.crear?.entradas)}
    </div>`;

    if (!esReemplazo) {
        html += `<div class="import-preview-box">
            <div class="import-preview-titulo">Se va a sobrescribir con lo del backup</div>
            ${fila('Casos que ya seguís', p.sobrescribir?.expedientes)}
            ${fila('Entradas ya existentes', p.sobrescribir?.entradas)}
        </div>
        <div class="import-preview-box">
            <div class="import-preview-titulo">Se conserva intacto</div>
            ${fila('Casos que no están en el backup', p.conservar?.expedientes)}
            ${fila('Entradas que no están en el backup', p.conservar?.entradas)}
        </div>`;
    }

    html += `<p style="font-size:12.5px;color:var(--text-muted);margin-top:4px;line-height:1.5">
        Al confirmar se descarga primero un <strong>respaldo automático</strong> de tu estado actual,
        para que puedas volver atrás si el resultado no era el esperado.
    </p>`;

    document.getElementById('import-paso-preview').innerHTML = html;
}

/** Respaldo del estado actual (salvaguarda 2 de §5.3). Devuelve true si se descargó. */
async function descargarRespaldoAutomatico() {
    const res = await fetch(`${BASE_URL}/usuarios/api/bitacora/export?alcance=todo&formato=json`, {
        headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    // F2 (2026-08-31): antes solo importaba res.ok — un 200 con body vacío o
    // truncado (conexión cortada a mitad de la respuesta) igual devolvía true, y
    // confirmarImport() procedía con `reemplazar` (el único modo destructivo de
    // todo el portal) creyendo que había un respaldo válido. Esto NO confirma que
    // el navegador terminó de escribir el archivo a disco — ninguna API de JS lo
    // garantiza para una descarga por <a download>, es una limitación real del
    // browser — pero sí descarta el caso más barato y más probable de detectar:
    // un export corrupto que ni siquiera es JSON válido.
    if (!blob || blob.size < 20) return false;
    try { JSON.parse(await blob.text()); } catch (_) { return false; }
    const blobUrl = URL.createObjectURL(blob);
    const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `bitacora-respaldo-antes-de-restaurar-${sello}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    return true;
}

async function confirmarImport() {
    const alertEl = document.getElementById('import-modal-alert');
    const { file, modo } = importArchivoYModo();
    if (!file) { showAlert(alertEl, 'error', 'Elegí el archivo .json del backup.'); return; }

    const btn = document.getElementById('btn-import-confirmar');
    const original = btn.textContent;
    btn.disabled = true;

    // Salvaguarda 2: respaldo previo. Si falla, no se toca nada.
    btn.innerHTML = '<span class="spinner"></span> Descargando respaldo...';
    let respaldoOk = false;
    try { respaldoOk = await descargarRespaldoAutomatico(); } catch (_) { respaldoOk = false; }
    if (!respaldoOk) {
        showAlert(alertEl, 'error', 'No se pudo generar el respaldo previo de tu estado actual. La restauración se canceló — no se modificó nada.');
        btn.disabled = false;
        btn.textContent = original;
        return;
    }

    btn.innerHTML = '<span class="spinner"></span> Restaurando...';
    try {
        const fd = new FormData();
        fd.append('backup', file);
        fd.append('modo', modo);
        const res = await fetch(`${BASE_URL}/usuarios/api/bitacora/import`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getToken()}` },
            body: fd
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showAlert(alertEl, 'error', data.error || 'No se pudo restaurar el backup.'); return; }

        const r = data.resumen || {};
        closeImportModal();
        showToast(
            `Backup restaurado: ${r.expedientesCreados || 0} casos nuevos · ${r.expedientesActualizados || 0} actualizados · ` +
            `${(r.entradasCreadas || 0) + (r.entradasActualizadas || 0)} entradas.`,
            'success'
        );

        // Repintar todo lo que quedó desactualizado (la ficha abierta puede ya no existir).
        state.miExp.fichaId = null;
        state.miExp.ficha = null;
        await loadBitacoraExpedientes();
        if (state.currentSection === 'mis-expedientes') {
            mexpShowLista();
            await loadMexpList();
        } else {
            loadBitacoraAvisos();
            bitacoraLoadAndRenderView();
        }
    } catch (e) {
        showAlert(alertEl, 'error', 'Error de conexión durante la restauración.');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

async function descargarExportBitacora() {
    const alertEl = document.getElementById('export-modal-alert');
    const alcance = document.querySelector('input[name="export-alcance"]:checked')?.value || 'todo';
    const formato = document.querySelector('input[name="export-formato"]:checked')?.value || 'xlsx';

    const params = new URLSearchParams();
    params.set('alcance', alcance);
    params.set('formato', formato);

    if (alcance === 'expediente') {
        const multiIds = state.miExp._exportMultiIds;
        if (multiIds && multiIds.length > 0) {
            params.set('expediente_id', multiIds.join(','));
        } else {
            const expId = document.getElementById('export-expediente-id').value;
            if (!expId) { showAlert(alertEl, 'error', 'Elegí un expediente.'); return; }
            params.set('expediente_id', expId);
        }
    }
    if (alcance === 'entradas') {
        const desde = document.getElementById('export-desde').value;
        const hasta = document.getElementById('export-hasta').value;
        if (desde) params.set('desde', bitToIsoMidday(desde));
        if (hasta) params.set('hasta', bitToIsoMidday(hasta));
    }

    const btn = document.getElementById('btn-export-descargar');
    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Generando...';

    try {
        const res = await fetch(`${BASE_URL}/usuarios/api/bitacora/export?${params.toString()}`, {
            headers: { Authorization: `Bearer ${getToken()}` }
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showAlert(alertEl, 'error', data.error || 'No se pudo generar la exportación.');
            return;
        }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        // Whitelist explícito, mismo criterio que el backend (routes/bitacora.js) —
        // no encadenar otro ternario para el 3er formato.
        const EXT_POR_FORMATO = { xlsx: 'xlsx', json: 'json', ics: 'ics' };
        const ext = EXT_POR_FORMATO[formato] || 'xlsx';
        const fechaHoy = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `bitacora-${alcance}-${fechaHoy}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        closeExportModal();
        showToast('Exportación descargada.', 'success');
    } catch (e) {
        showAlert(alertEl, 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// =============================================================================
//  CAPTURA DESDE LOS VISORES — reclamo del borrador y aplicación (F2.3)
// =============================================================================
// Consume lo que F2.2 dejó armado: el visor posteó anónimo a /usuarios/capture,
// el borrador quedó en un buffer efímero, y acá —ya autenticados, con el gate de
// plan del endpoint— se reclama y se decide qué hacer según `accion`.

function mensajeCapturaError(code) {
    if (code === 'lote_grande') return 'La selección era demasiado grande para capturar de una vez (máximo 200 casos, y hasta 256 KB de datos). Probá con una selección más chica.';
    return 'No se pudo procesar la captura desde el visor. Volvé al visor y probá de nuevo.';
}

// B.3-A (fase E11) — borrador ya reclamado con la llave de captura, esperando que
// haya sesión para poder aplicarse. Vive SOLO en memoria de la página: nunca en
// `localStorage` ni en `sessionStorage`. El login del portal no recarga la página
// (es una SPA: `doLogin` esconde el login y llama a `initDashboard`), así que esta
// variable sobrevive el ciclo de login sin necesidad de persistirla.
let captureDraftPreReclamado = null;
// Id de la cuenta dueña de la llave que rescató el borrador de arriba — no
// necesariamente la que termina logueada (ver el chequeo en `initDashboard`,
// observación del revisor de E11, 2026-09-04).
let captureDraftPreReclamadoOwnerId = null;

/**
 * Reclama el borrador con la LLAVE DE CAPTURA (30 min, un solo uso) antes de que
 * haya sesión, y guarda el resultado en memoria.
 *
 * Por qué acá y no después del login: el borrador vive 10 minutos. Si se esperara
 * a que el usuario se loguee, una demora normal lo dejaría vencido y la captura se
 * perdería sin explicación. Reclamarlo primero la rescata.
 *
 * Por qué NO usa `apiFetch`: `apiFetch` toma el token de `localStorage` (que acá
 * justamente no existe) y, ante un 401, llama a `doLogout()`. La llave se manda
 * a mano en `Authorization` de este único request y se descarta al salir.
 *
 * Nunca lanza: cualquier fallo (llave gastada, vencida, borrador de otro, red)
 * deja `captureDraftPreReclamado` en null y el usuario cae al flujo manual —
 * login + `?draft=` reclamado con la sesión, que es el camino de compatibilidad
 * que sigue vivo para los visores viejos.
 *
 * @param {string} ownerId - id de la cuenta dueña de `captureKey` (`entrante.id`
 *   del JWT de captura ya decodificado por el llamador). Se guarda junto al
 *   borrador para poder comparar contra quién termine logueado.
 */
async function preReclamarDraftConLlave(draftId, captureKey, ownerId) {
    try {
        const res = await fetch(BASE_URL + `/usuarios/api/capture-draft/${encodeURIComponent(draftId)}`, {
            headers: { Authorization: `Bearer ${captureKey}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.draft) {
            captureDraftPreReclamado = data.draft;
            captureDraftPreReclamadoOwnerId = ownerId != null ? ownerId : null;
            // El id ya se consumió del lado del servidor (uso único): sacarlo de
            // sessionStorage evita que `initDashboard` intente reclamarlo otra vez
            // y muestre un 404 confuso encima de una captura que sí funcionó.
            sessionStorage.removeItem('pending_capture_draft');
        }
    } catch (_) {
        // silencio deliberado: el flujo manual sigue disponible
    }
}

async function procesarCaptureDraft(draftId) {
    try {
        // F2 (2026-08-31): encodeURIComponent — draftId viene sin sanear de un
        // parámetro de URL (?draft=..., vía sessionStorage). Mismo criterio que
        // abrirFichaPorNumero() (más abajo) aplica a su `exp`; acá faltaba.
        const res = await apiFetch(`/usuarios/api/capture-draft/${encodeURIComponent(draftId)}`);
        if (!res) return;
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast(data.error || 'El borrador de captura no existe o expiró. Volvé al visor y probá de nuevo.', 'error');
            return;
        }
        const data = await res.json();
        await aplicarCaptureDraft(data.draft);
    } catch (e) {
        showToast('Error de conexión al procesar la captura.', 'error');
    }
}

async function aplicarCaptureDraft(draft) {
    const { accion, tipo, origen, casos } = draft || {};
    if (!Array.isArray(casos) || casos.length === 0) {
        showToast('El borrador de captura llegó vacío.', 'error');
        return;
    }
    // H-COV-Z2-02 parte 1 / decisión B.5 (auditoría 2026-09): confirmación antes de
    // escribir. El borrador de captura es anónimo por diseño y HOY no tiene dueño:
    // `reclamarDraft(id)` se lo entrega a cualquier usuario autenticado que presente
    // el id, y el id se lo lleva el atacante del `Location` de su propio POST. Sin
    // este diálogo, abrir un link `?draft=…` ajeno escribía hasta 200 expedientes
    // elegidos por otro en "Mis Expedientes" del que lo abriera, sin preguntar nada
    // — justo lo contrario de lo que declara routes/capture.js ("recién cuando el
    // usuario confirma en el portal, algo se escribe").
    // `entrada-lote` ya tenía su pantalla de revisión; `entrada` abre un modal que el
    // usuario tiene que guardar. Las que escribían solas son estas dos.
    // La otra mitad (que el borrador nazca atado a su dueño) necesita la llave de
    // captura y va en la fase de B.3/B.5.
    if (accion === 'ficha' || accion === 'ficha-lote' || accion === 'snapshot' || accion === 'snapshot-lote') {
        const lista = casos.slice(0, 5)
            .map(c => '• ' + c.expediente + ' — ' + String(c.caratula || '').slice(0, 60))
            .join('\n');
        const ok = await showConfirm(
            'Se van a guardar ' + casos.length + ' caso(s) en Mis Expedientes:\n' +
            lista + (casos.length > 5 ? '\n…' : '') + '\n\n¿Confirmás?',
            { confirmLabel: 'Guardar' }
        );
        if (!ok) { showToast('Captura descartada.', 'info'); return; }
        await guardarFichasDesdeDraft(casos, origen, accion.startsWith('snapshot') ? 'snapshot-lote' : 'ficha-lote');
    } else if (accion === 'entrada') {
        await abrirEntradaIndividualDesdeDraft(casos[0], origen, tipo);
    } else if (accion === 'entrada-lote') {
        abrirRevisionLoteDesdeDraft(casos, origen, tipo);
    } else {
        showToast('Acción de captura desconocida.', 'error');
    }
}

async function refrescarTrasCaptura() {
    if (state.currentSection === 'mis-expedientes') {
        mexpShowLista();
        await loadMexpList();
    } else {
        await loadBitacoraExpedientes();
        loadBitacoraAvisos();
        bitacoraLoadAndRenderView();
    }
}

function tituloSugeridoDesdeCaso(caso, tipo) {
    const mov = (caso?.movimientos || [])[0];
    if (mov?.detalle) {
        return mov.detalle.length > 80 ? mov.detalle.slice(0, 80) + '…' : mov.detalle;
    }
    const etiquetas = { vencimiento: 'Vencimiento', audiencia: 'Audiencia', tarea: 'Tarea', nota: 'Nota' };
    return `${etiquetas[tipo] || 'Entrada'} — ${caso?.expediente || ''}`;
}

// "📌 Guardar caso(s)" / "💾 Guardar procuración/informe (de seleccionados)": no hay
// nada que revisar, se aplica directo contra el endpoint de F2.2 y se avisa por toast.
async function guardarFichasDesdeDraft(casos, origen, accionBackend) {
    try {
        const res = await apiFetch('/usuarios/api/expedientes/capture-lote', {
            method: 'POST',
            body: { accion: accionBackend, casos: casos.map(c => Object.assign({}, c, { origen })) }
        });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'No se pudo guardar la captura.', 'error'); return; }
        const r = data.resumen || {};
        const total = (r.creados || 0) + (r.actualizados || 0);
        showToast(
            accionBackend === 'snapshot-lote'
                ? `Guardado: ${total} caso(s), ${r.snapshots || 0} con historial adjunto.`
                : `Guardado: ${total} caso(s).`,
            'success'
        );

        // Aterrizaje después de guardar: hasta acá el usuario quedaba en Bitácora
        // viendo el listado general, sin ver el caso que acababa de guardar. El
        // destino NO se puede pedir desde el visor —`/usuarios/capture` construye el
        // redirect íntegramente del lado del servidor a propósito, para no ser un
        // open redirect (ver cabecera de routes/capture.js)—, así que se decide acá,
        // del lado autenticado, con el `expediente_id` real que ya devuelve perCaso.
        const perCaso = Array.isArray(data.perCaso) ? data.perCaso : [];
        if (perCaso.length === 1 && perCaso[0].expediente_id) {
            navigateTo('mis-expedientes');
            await openMexpFicha(perCaso[0].expediente_id);
        } else if (perCaso.length > 1) {
            // Varios casos: no hay una ficha "la" correcta → el listado es el destino
            // útil, y ahí se ven todos los que se acaban de guardar.
            navigateTo('mis-expedientes');
        } else {
            await refrescarTrasCaptura();
        }
    } catch (e) {
        showToast('Error de conexión al guardar la captura.', 'error');
    }
}

// "＋ Vencimiento/Tarea/Nota" desde el mini-menú de UN caso: primero se asegura la
// ficha (+ snapshot, "capturar una entrada ya implica guardar la procuración/informe
// de ese momento" — §4.2 del plan), y con el id real ya resuelto se abre el modal de
// F1.3/F1.4 pre-cargado — el usuario todavía puede editar todo antes de confirmar.
async function abrirEntradaIndividualDesdeDraft(caso, origen, tipo) {
    try {
        const res = await apiFetch('/usuarios/api/expedientes/capture-lote', {
            method: 'POST',
            body: { accion: 'snapshot-lote', casos: [Object.assign({}, caso, { origen })] }
        });
        if (!res) return;
        const data = await res.json();
        if (!res.ok || !data.perCaso?.[0]) {
            showToast(data.error || 'No se pudo preparar la captura.', 'error');
            return;
        }
        const fichaId = data.perCaso[0].expediente_id;
        await loadBitacoraExpedientes(); // para que el <select> del modal ya tenga esta ficha
        openBitacoraModal(fichaId, {
            kind: tipo,
            title: tituloSugeridoDesdeCaso(caso, tipo),
            // F2 (2026-08-31): caso?. — casos viene de aplicarCaptureDraft(), que solo
            // valida Array.isArray(casos) && casos.length>0, no que cada elemento sea
            // un objeto (el origen último es /usuarios/capture, un endpoint anónimo).
            // Un elemento malformado tiraba un TypeError sin escape claro, atrapado
            // varios frames más arriba por un catch no relacionado — "Error de
            // conexión" para lo que en realidad era un dato malformado. Mismo patrón
            // ya usado en tituloSugeridoDesdeCaso().
            description: (caso?.movimientos || [])[0]?.detalle || '',
        });
    } catch (e) {
        showToast('Error de conexión al procesar la captura.', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// "＋ Crear entradas…" sobre una selección múltiple (B2, puntos 12/14/15 de la
// lista de arreglos del visor). Wizard de 2 pantallas:
//   1. Elegir el TIPO de entrada — una sola vez para todo el lote (antes era un
//      prompt() nativo con "1=Vencimiento/2=Tarea/3=Nota"; ahora son botones).
//      Se saltea si `tipo` ya viene resuelto en el draft (el visor de HOY sigue
//      preguntando por prompt antes de capturar — ver la nota en capture.js).
//   2. Recorrer los casos uno por uno (Anterior/Siguiente), con Guardar/Descartar
//      como una decisión explícita por caso, no atada a la navegación — el
//      usuario puede ir y volver sin que eso cree ni borre nada.
// ═══════════════════════════════════════════════════════════════════════════

const BIT_TIPO_ENTRADA_LABELS = {
    vencimiento: '⏰ Vencimiento',
    audiencia:   '⚖️ Audiencia',
    tarea:       '✅ Tarea',
    nota:        '📝 Nota',
};

function abrirRevisionLoteDesdeDraft(casos, origen, tipo) {
    state.captureLote = {
        casos, origen,
        tipo: tipo || null,
        idx: 0,
        // Un valor por caso, independiente del formulario en pantalla — así ir y
        // volver con Anterior/Siguiente no pierde lo que el usuario ya tipeó.
        filas: casos.map(c => ({
            title: '', // se completa perezoso en el primer render (recién ahí se conoce `tipo` si vino del selector)
            due: bitLocalYmd(new Date()),
            repeat: '',
            description: (c?.movimientos || [])[0]?.detalle || '', // F2 (2026-08-31): ver comentario en abrirEntradaIndividualDesdeDraft
        })),
        fichaMap: null, // expediente → expediente_id, resuelto una sola vez para TODO el lote
        estado: casos.map(() => ({ status: 'pendiente', entryId: null })), // 'pendiente'|'guardado'|'descartado'
    };
    document.getElementById('lote-modal-title').textContent = `Crear entradas — ${casos.length} caso${casos.length !== 1 ? 's' : ''}`;
    document.getElementById('lote-modal-alert').classList.remove('visible');
    document.getElementById('modal-bitacora-lote').classList.remove('hidden');
    loteAsegurarFichas();
}

function closeLoteModal() {
    document.getElementById('modal-bitacora-lote').classList.add('hidden');
    state.captureLote = null;
}

function loteSetFooter(html) {
    document.getElementById('lote-modal-footer-extra').innerHTML = html;
}

// Paso previo a las 2 pantallas del wizard: upsert de fichas + snapshot de TODOS los
// casos de la selección en un solo POST — "capturar una entrada ya implica guardar
// la procuración/informe de ese momento" (§4.2 del plan). Se hace una sola vez al
// abrir, no por caso, para no repetir el mismo insert/upsert en cada paso.
async function loteAsegurarFichas() {
    const { casos, origen } = state.captureLote;
    document.getElementById('lote-modal-content').innerHTML = '<div class="empty-state"><p>Guardando los casos seleccionados…</p></div>';
    loteSetFooter('');
    try {
        const res = await apiFetch('/usuarios/api/expedientes/capture-lote', {
            method: 'POST',
            body: { accion: 'snapshot-lote', casos: casos.map(c => Object.assign({}, c, { origen })) }
        });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            showAlert(document.getElementById('lote-modal-alert'), 'error', data.error || 'No se pudieron guardar los casos.');
            loteSetFooter('');
            return;
        }
        state.captureLote.fichaMap = new Map((data.perCaso || []).map(p => [p.expediente, p.expediente_id]));
        if (state.captureLote.tipo) loteRenderPasoCaso();
        else loteRenderSelectorTipo();
    } catch (e) {
        showAlert(document.getElementById('lote-modal-alert'), 'error', 'Error de conexión al guardar los casos.');
    }
}

function loteRenderSelectorTipo() {
    const n = state.captureLote.casos.length;
    document.getElementById('lote-modal-content').innerHTML = `
        <p class="bit-lote-intro">¿Qué tipo de entrada querés crear para ${n === 1 ? 'el caso seleccionado' : `los ${n} casos seleccionados`}?</p>
        <div class="bit-tipo-picker">
            ${Object.entries(BIT_TIPO_ENTRADA_LABELS).map(([k, label]) =>
                `<button type="button" class="bit-tipo-btn" onclick="loteElegirTipo('${k}')">${label}</button>`
            ).join('')}
        </div>`;
    loteSetFooter('');
}

function loteElegirTipo(tipo) {
    state.captureLote.tipo = tipo;
    loteRenderPasoCaso();
}

// Persiste en `filas[idx]` lo que el usuario tenga tipeado en el paso actual —
// se llama ANTES de navegar (Anterior/Siguiente) o de guardar/descartar, para que
// nada se pierda al moverse entre casos.
function loteLeerCamposActuales() {
    const { idx, filas } = state.captureLote;
    const fila = filas[idx];
    const titleEl = document.getElementById('lote-caso-titulo');
    if (!titleEl) return; // paso 1 (selector de tipo) o transición en curso
    fila.title = titleEl.value;
    fila.due = document.getElementById('lote-caso-fecha').value;
    fila.repeat = document.getElementById('lote-caso-repeat').value;
    fila.description = document.getElementById('lote-caso-desc').value;
}

function loteRenderPasoCaso() {
    const { casos, idx, tipo, filas, estado } = state.captureLote;
    const caso = casos[idx];
    const fila = filas[idx];
    if (!fila.title) fila.title = tituloSugeridoDesdeCaso(caso, tipo); // default una sola vez, no pisa una edición
    const est = estado[idx];
    const esVencimiento = tipo === 'vencimiento';
    const ultimaActividad = (caso?.movimientos || [])[0]?.fecha || (caso?.fecha_corrida ? formatDate(caso.fecha_corrida) : ''); // F2 (2026-08-31): ver comentario en abrirEntradaIndividualDesdeDraft

    document.getElementById('lote-modal-content').innerHTML = `
        <div class="bit-lote-progress">Caso ${idx + 1} de ${casos.length} — ${BIT_TIPO_ENTRADA_LABELS[tipo] || tipo}</div>
        <div class="bit-caso-header">
            <div class="bit-caso-header-exp">${escapeHtml(caso.expediente)}</div>
            ${caso.caratula ? `<div class="bit-caso-header-car">${escapeHtml(caso.caratula)}</div>` : ''}
            <div class="bit-caso-header-meta">
                ${caso.dependencia ? `<span>${escapeHtml(caso.dependencia)}</span>` : ''}
                ${caso.situacion_actual ? `<span>${escapeHtml(caso.situacion_actual)}</span>` : ''}
                ${ultimaActividad ? `<span>Últ. actividad: ${escapeHtml(ultimaActividad)}</span>` : ''}
            </div>
        </div>
        ${est.status !== 'pendiente' ? `
            <div class="alert visible ${est.status === 'guardado' ? 'alert-success' : 'alert-info'}">
                ${est.status === 'guardado' ? '✓ Se creó una entrada para este caso.' : 'Descartado — no se creó ninguna entrada para este caso.'}
            </div>` : ''}
        <div class="form-group">
            <label for="lote-caso-titulo">Título</label>
            <input type="text" id="lote-caso-titulo" maxlength="300" value="${escapeHtml(fila.title)}">
        </div>
        ${esVencimiento ? `
        <div class="form-row" style="display:flex;gap:10px">
            <div class="form-group" style="flex:1">
                <label for="lote-plazo-desde">Notificado/inicia el</label>
                <input type="date" id="lote-plazo-desde">
            </div>
            <div class="form-group" style="flex:1">
                <label for="lote-plazo-dias">Días hábiles</label>
                <input type="number" id="lote-plazo-dias" min="1" max="365" placeholder="Ej: 15">
            </div>
            <div class="form-group" style="flex:0 0 auto;display:flex;align-items:flex-end;padding-bottom:14px">
                <button type="button" class="btn btn-outline btn-sm" onclick="calcularPlazoBitacora({desde:'lote-plazo-desde',dias:'lote-plazo-dias',due:'lote-caso-fecha'})">Calcular</button>
            </div>
        </div>` : ''}
        <div class="form-group">
            <label for="lote-caso-fecha">Fecha</label>
            <input type="date" id="lote-caso-fecha" value="${fila.due}">
        </div>
        <div class="form-group">
            <label for="lote-caso-repeat">Repetir</label>
            <select id="lote-caso-repeat">
                <option value="" ${!fila.repeat ? 'selected' : ''}>No se repite</option>
                <option value="weekly" ${fila.repeat === 'weekly' ? 'selected' : ''}>Semanal</option>
                <option value="monthly" ${fila.repeat === 'monthly' ? 'selected' : ''}>Mensual</option>
                <option value="yearly" ${fila.repeat === 'yearly' ? 'selected' : ''}>Anual</option>
            </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
            <label for="lote-caso-desc">Descripción / notas</label>
            <textarea id="lote-caso-desc" rows="3" maxlength="5000">${escapeHtml(fila.description)}</textarea>
        </div>`;

    loteSetFooter(`
        <button type="button" class="btn btn-outline" ${idx === 0 ? 'disabled' : ''} onclick="loteIrAnterior()">&#8249; Anterior</button>
        <button type="button" class="btn btn-outline" ${est.status === 'guardado' ? 'disabled' : ''} onclick="loteDescartarCasoActual()">Descartar</button>
        <button type="button" class="btn btn-primary" id="btn-lote-guardar-caso" onclick="loteGuardarCasoActual()">${est.status === 'guardado' ? 'Actualizar' : 'Guardar'}</button>
        ${idx < casos.length - 1
            ? `<button type="button" class="btn btn-outline" onclick="loteIrSiguiente()">Siguiente &#8250;</button>`
            : `<button type="button" class="btn btn-primary" onclick="loteFinalizar()">Finalizar</button>`
        }
    `);
}

function loteIrAnterior() {
    loteLeerCamposActuales();
    state.captureLote.idx--;
    loteRenderPasoCaso();
}

function loteIrSiguiente() {
    loteLeerCamposActuales();
    state.captureLote.idx++;
    loteRenderPasoCaso();
}

async function loteGuardarCasoActual() {
    loteLeerCamposActuales();
    const { casos, idx, tipo, filas, estado, fichaMap } = state.captureLote;
    const caso = casos[idx];
    const fila = filas[idx];
    const est = estado[idx];

    if (!fila.title.trim()) {
        showAlert(document.getElementById('lote-modal-alert'), 'error', 'El título es obligatorio.');
        return;
    }

    const btn = document.getElementById('btn-lote-guardar-caso');
    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';

    const body = {
        kind: tipo,
        title: fila.title.trim(),
        description: fila.description.trim() || null,
        due_at: fila.due ? bitToIsoMidday(fila.due) : null,
        expediente_id: fichaMap.get(caso.expediente) || null,
        repeat_rule: fila.repeat || null,
    };

    try {
        const res = est.entryId
            ? await apiFetch(`/usuarios/api/bitacora/${est.entryId}`, { method: 'PUT', body })
            : await apiFetch('/usuarios/api/bitacora', { method: 'POST', body });
        if (!res) return;
        const data = await res.json();
        if (!res.ok) {
            showAlert(document.getElementById('lote-modal-alert'), 'error', data.error || 'No se pudo guardar.');
            return;
        }
        est.status = 'guardado';
        est.entryId = est.entryId || data.entrada?.id || null;
        loteRenderPasoCaso();
    } catch (e) {
        showAlert(document.getElementById('lote-modal-alert'), 'error', 'Error de conexión. Intentá de nuevo.');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

function loteDescartarCasoActual() {
    const est = state.captureLote.estado[state.captureLote.idx];
    if (est.status === 'guardado') return; // ya no aplica: "Descartar" queda deshabilitado en ese estado
    est.status = 'descartado';
    loteRenderPasoCaso();
}

async function loteFinalizar() {
    loteLeerCamposActuales();
    const resumen = state.captureLote.estado.reduce((acc, e) => {
        acc[e.status] = (acc[e.status] || 0) + 1;
        return acc;
    }, {});
    const partes = [];
    if (resumen.guardado) partes.push(`${resumen.guardado} entrada(s) creada(s)`);
    if (resumen.descartado) partes.push(`${resumen.descartado} descartada(s)`);
    if (resumen.pendiente) partes.push(`${resumen.pendiente} sin decidir`);
    closeLoteModal();
    showToast(partes.length ? partes.join(', ') + '.' : 'No se creó ninguna entrada.', resumen.guardado ? 'success' : 'info');
    await refrescarTrasCaptura();
}
