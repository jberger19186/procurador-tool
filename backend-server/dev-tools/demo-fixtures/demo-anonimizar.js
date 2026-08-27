// demo-fixtures/demo-anonimizar.js
//
// D2 Parte B (demo Etapa 1.6) — capa de sustitución por DOM: funciones puras
// pensadas para correr DENTRO de la página capturada (Electron o portal), no
// en Node — D3 las inyecta con `page.evaluate(fn, datos)` (Playwright JS) o
// `page.evaluate(f"({fuente})({json.dumps(datos)})")` (Playwright Python, ya
// que `tests/daily/electron_driver.py` es el driver que D3 reusa para la
// app). Por eso cada función referencia `document`/`window` directamente y
// no importa nada de Node.
//
// 🚨 Cada punto de entrada (`aplicarSustitucion*`) es DELIBERADAMENTE
// autocontenido — no llama a otras funciones nombradas de este archivo. Un
// primer intento las componía llamándose entre sí, y se descartó al
// verificar el mecanismo de inyección real: `page.evaluate(fn, args)`
// (Playwright JS) y el `.toString()` que consume Python serializan SOLO el
// texto de esa función — nunca arrastran funciones hermanas del mismo
// módulo. Una función compuesta se rompe con un `ReferenceError` en cuanto
// se la inyecta sola. Las funciones más chicas (`cerrarBannersElectron`,
// etc.) quedan igual como referencia legible y para pruebas puntuales, pero
// el entry point real duplica su lógica inline a propósito.
//
// 🚨 Regla de oro (plan D2, demo-guion.md §0.6): sustituir DESPUÉS de llegar
// a la pantalla, nunca antes de una acción que dependa del valor real (ej.
// sustituir el email de login ANTES de apretar "Iniciar Sesión" rompe el
// login — ya se vio en un spike anterior). Estas funciones no navegan ni
// disparan ninguna acción — solo leen y reescriben texto/atributos de
// elementos que YA están en pantalla.
//
// Selectores confirmados por grep contra el código real, no supuestos — ver
// demo-guion.md §0.6/§10 para la traza completa de cada uno:
//   Electron (electron-app/renderer/login.js, renderer.js):
//     #email                  → input de email en la pantalla de login
//     #machineIdDisplay       → <code> con el ID de dispositivo truncado (title = completo)
//     #userNameDisplay        → nombre en el chip de usuario del topbar
//     #userPlanDisplay        → plan en el chip de usuario
//     #userAvatarInitials     → iniciales del avatar
//     #subscription-status-banner / #quota-banner / #promo-banner → los 3
//       banners informativos del topbar (solo #quota-banner tiene un botón
//       de cierre confirmado, #quota-dismiss-btn — los otros 2 se ocultan a
//       la fuerza, no se confía en que todos tengan un botón visible)
//   Portal (backend-server/public/usuarios/index.html):
//     #status-banner          → banner único de estado de cuenta (a diferencia
//       de Electron, el portal usa un solo div para los 3 tipos de aviso)

// ─────────────────────────────────────────────────────────────────────────
// Electron — piezas sueltas (referencia / pruebas puntuales)
// ─────────────────────────────────────────────────────────────────────────

var BANNER_IDS_ELECTRON = ['subscription-status-banner', 'quota-banner', 'promo-banner'];

function cerrarBannersElectron() {
  BANNER_IDS_ELECTRON.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function sustituirLoginElectron(cuenta) {
  var email = document.getElementById('email');
  if (email) {
    email.value = cuenta.loginEmail;
    email.dispatchEvent(new Event('input', { bubbles: true }));
  }
  var deviceEl = document.getElementById('machineIdDisplay');
  if (deviceEl) {
    var id = cuenta.deviceIdDemo;
    var corto = id.substring(0, 8) + '...' + id.substring(id.length - 8);
    deviceEl.textContent = corto;
    deviceEl.title = id;
  }
}

function sustituirChipUsuarioElectron(cuenta) {
  var nombreEl = document.getElementById('userNameDisplay');
  if (nombreEl) nombreEl.textContent = cuenta.nombre;
  var planEl = document.getElementById('userPlanDisplay');
  if (planEl) planEl.textContent = (cuenta.plan && cuenta.plan.displayName) || '';
  var inicialesEl = document.getElementById('userAvatarInitials');
  if (inicialesEl) {
    var letra = (cuenta.nombre || '').trim().charAt(0).toUpperCase();
    inicialesEl.textContent = letra || '?';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Electron — entry points AUTOCONTENIDOS (los que D3 realmente inyecta)
// ─────────────────────────────────────────────────────────────────────────

// Pantalla de login: cierra banners (por si el estado previo dejó alguno
// visible) + sustituye email y device ID.
function aplicarSustitucionLoginElectron(cuenta) {
  ['subscription-status-banner', 'quota-banner', 'promo-banner'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  var email = document.getElementById('email');
  if (email) {
    email.value = cuenta.loginEmail;
    email.dispatchEvent(new Event('input', { bubbles: true }));
  }
  var deviceEl = document.getElementById('machineIdDisplay');
  if (deviceEl) {
    var id = cuenta.deviceIdDemo;
    var corto = id.substring(0, 8) + '...' + id.substring(id.length - 8);
    deviceEl.textContent = corto;
    deviceEl.title = id;
  }
}

// Pantalla principal / cualquier pantalla con el topbar visible: cierra
// banners + sustituye el chip de usuario.
function aplicarSustitucionPrincipalElectron(cuenta) {
  ['subscription-status-banner', 'quota-banner', 'promo-banner'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  var nombreEl = document.getElementById('userNameDisplay');
  if (nombreEl) nombreEl.textContent = cuenta.nombre;
  var planEl = document.getElementById('userPlanDisplay');
  if (planEl) planEl.textContent = (cuenta.plan && cuenta.plan.displayName) || '';
  var inicialesEl = document.getElementById('userAvatarInitials');
  if (inicialesEl) {
    var letra = (cuenta.nombre || '').trim().charAt(0).toUpperCase();
    inicialesEl.textContent = letra || '?';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Portal (backend-server/public/usuarios/)
// ─────────────────────────────────────────────────────────────────────────

function cerrarBannerPortal() {
  var el = document.getElementById('status-banner');
  if (el) el.style.display = 'none';
}

// Autocontenida por el mismo motivo que las de Electron — hoy es idéntica a
// cerrarBannerPortal() porque el portal no tiene más DOM que sustituir (los
// datos de cuenta del portal los sirve directo la extensión de
// stub-portal.js, no el DOM), pero queda como su propio entry point para que
// el día que haga falta agregar algo (ej. un nombre en el sidebar) no rompa
// el patrón ya establecido.
function aplicarSustitucionPortal() {
  var el = document.getElementById('status-banner');
  if (el) el.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
  BANNER_IDS_ELECTRON,
  // piezas sueltas
  cerrarBannersElectron,
  sustituirLoginElectron,
  sustituirChipUsuarioElectron,
  cerrarBannerPortal,
  // entry points autocontenidos — usar estos desde D3
  aplicarSustitucionLoginElectron,
  aplicarSustitucionPrincipalElectron,
  aplicarSustitucionPortal,
  // fuente lista para inyectar desde Python:
  // page.evaluate(f"({fuenteAplicarSustitucionLoginElectron})({json.dumps(cuenta)})")
  fuenteAplicarSustitucionLoginElectron: aplicarSustitucionLoginElectron.toString(),
  fuenteAplicarSustitucionPrincipalElectron: aplicarSustitucionPrincipalElectron.toString(),
  fuenteAplicarSustitucionPortal: aplicarSustitucionPortal.toString(),
};
