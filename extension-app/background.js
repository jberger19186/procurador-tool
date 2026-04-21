// background.js — router unificado para todos los flujos PJN
// Carga config.js y auth.js antes de ejecutar cualquier lógica.
// Nota: la verificación de integridad SHA-256 no aplica en esta versión
// (los archivos son código fuente plain; la integridad la garantiza el repositorio).
importScripts('config.js', 'auth.js');

function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// ── Chequeo de versión de la extensión ──────────────────────────────────────
async function checkExtensionVersion() {
  try {
    const session = await PJNAuth.loadSession();
    if (!session?.token) return;

    const res = await fetch(`${EXT_CONFIG.BACKEND_URL}/api/extension/version`, {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    if (!res.ok) return;

    const { version: serverVersion } = await res.json();
    if (!serverVersion) return;

    const localVersion = chrome.runtime.getManifest().version;

    if (semverGt(serverVersion, localVersion)) {
      // Hay versión nueva — badge rojo y guardar en storage
      chrome.action.setBadgeText({ text: '↑' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
      await chrome.storage.local.set({
        pjn_update_available: { serverVersion, localVersion, detectedAt: Date.now() }
      });
      console.log(`[PJN] Nueva versión disponible: ${serverVersion} (instalada: ${localVersion})`);
    } else {
      // Versión actualizada — limpiar badge y flag
      chrome.action.setBadgeText({ text: '' });
      await chrome.storage.local.remove('pjn_update_available');
    }
  } catch (e) {
    console.warn('[PJN-version] No se pudo verificar versión:', e.message);
  }
}

checkExtensionVersion();

// ── Alarm: refresh automático del token ─────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pjn-version-check') checkExtensionVersion();
  PJNAuth.handleRefreshAlarm(alarm);
});

// Verificar versión cada 4 horas
chrome.alarms.create('pjn-version-check', { periodInMinutes: 240 });

// ── Menú contextual ────────────────────────────────────────────────────────
// El menú se muestra siempre que hay texto seleccionado (contexts: ["selection"]).
// La validación del formato de expediente se hace al hacer click, no antes.
// Esto elimina la necesidad de cs-selection.js en content_scripts y con ello
// el permiso "*://*/*" que generaba el badge "lee datos en todos los sitios".
const EXP_REGEX = /^([A-Z]{2,3})\s+(\d{1,10})\/(\d{4})$/i;

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "pjn-send-expediente",
      title: "Enviar expediente a PJN",
      contexts: ["selection"],
      visible: true,
    });
  });
}
chrome.runtime.onInstalled.addListener(setupContextMenu);
setupContextMenu();

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "pjn-send-expediente") return;
  const texto = (info.selectionText || "").trim().toUpperCase();
  // Validar formato SIGLA NNNNN/AAAA antes de abrir el popup
  if (!EXP_REGEX.test(texto)) {
    console.log("[PJN] Selección no es un expediente válido:", texto);
    return;
  }
  await chrome.storage.local.set({ contextExpediente: texto });
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 420,
    height: 480,
  });
});

const JURISDICCIONES_LABEL = {
  "0":  "CSJ - Corte Suprema de Justicia de la Nación",
  "1":  "CIV - Cámara Nacional de Apelaciones en lo Civil",
  "2":  "CAF - Cámara Nacional de Apelaciones en lo Contencioso Administrativo Federal",
  "3":  "CCF - Cámara Nacional de Apelaciones en lo Civil y Comercial Federal",
  "4":  "CNE - Cámara Nacional Electoral",
  "5":  "CSS - Camara Federal de la Seguridad Social",
  "6":  "CPE - Cámara Nacional de Apelaciones en lo Penal Económico",
  "7":  "CNT - Cámara Nacional de Apelaciones del Trabajo",
  "8":  "CFP - Camara Criminal y Correccional Federal",
  "9":  "CCC - Camara Nacional de Apelaciones en lo Criminal y Correccional",
  "10": "COM - Camara Nacional de Apelaciones en lo Comercial",
  "11": "CPF - Camara Federal de Casación Penal",
  "12": "CPN - Camara Nacional Casacion Penal",
  "13": "FBB - Justicia Federal de Bahia Blanca",
  "14": "FCR - Justicia Federal de Comodoro Rivadavia",
  "15": "FCB - Justicia Federal de Córdoba",
  "16": "FCT - Justicia Federal de Corrientes",
  "17": "FGR - Justicia Federal de General Roca",
  "18": "FLP - Justicia Federal de La Plata",
  "19": "FMP - Justicia Federal de Mar del Plata",
  "20": "FMZ - Justicia Federal de Mendoza",
  "21": "FPO - Justicia Federal de Posadas",
  "22": "FPA - Justicia Federal de Paraná",
  "23": "FRE - Justicia Federal de Resistencia",
  "24": "FSA - Justicia Federal de Salta",
  "25": "FRO - Justicia Federal de Rosario",
  "26": "FSM - Justicia Federal de San Martin",
  "27": "FTU - Justicia Federal de Tucuman",
};

const FLOW_URLS = {
  consulta:  "https://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=225541",
  escritos1: "https://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=225541",
  escritos2: "https://escritos.pjn.gov.ar/nuevo",
  notif:     "https://notif.pjn.gov.ar/nueva",
  deox:      "https://deox.pjn.gov.ar/nuevo",
};

const FLOW_URL_PATTERN = {
  consulta:  /^https?:\/\/(scw\.pjn\.gov\.ar|sso\.pjn\.gov\.ar)\//,
  escritos1: /^https?:\/\/(scw\.pjn\.gov\.ar|sso\.pjn\.gov\.ar)\//,
  escritos2: /^https?:\/\/(escritos\.pjn\.gov\.ar|sso\.pjn\.gov\.ar)\//,
  notif:     /^https?:\/\/(notif\.pjn\.gov\.ar|sso\.pjn\.gov\.ar)\//,
  deox:      /^https?:\/\/(sso\.pjn\.gov\.ar\/|deox\.pjn\.gov\.ar\/)/,
};

const FLOW_CONTENT_SCRIPT = {
  consulta:  "cs-scw.js",
  escritos1: "cs-scw.js",
  escritos2: "cs-escritos2.js",
  notif:     "cs-notif.js",
  deox:      "cs-deox.js",
};

const FLOW_NEEDS_FILL = new Set(["escritos2", "notif"]);

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "START_FLOW") return;

  try {
    const flow = msg.flow;
    const authCheck = await PJNAuth.canUseFlow(flow);

    if (!authCheck.allowed) {
      console.warn(`[PJN-ext] Flujo bloqueado: ${flow} — razón: ${authCheck.reason}`);
      // Abrir popup para mostrar error / forzar login si sesión venció
      if (authCheck.reason === 'no_session' || authCheck.reason === 'token_expired') {
        chrome.windows.create({
          url: chrome.runtime.getURL("popup.html"),
          type: "popup",
          width: 420,
          height: 480,
        });
      }
      return;
    }

    const stored = await chrome.storage.local.get(["expedienteData", "selectedFlow"]);
    const exp = stored.expedienteData;

    if (!exp || !exp.sigla || !exp.numero || !exp.anio || !exp.jurisdiccion) {
      console.error("START_FLOW: expedienteData faltante en storage");
      return;
    }
    if (!FLOW_URLS[flow]) {
      console.error("START_FLOW: flujo desconocido →", flow);
      return;
    }

    let payload;
    if (flow === "consulta" || flow === "escritos1") {
      payload = null;
    } else if (flow === "escritos2" || flow === "notif") {
      payload = {
        jurisdiccion: JURISDICCIONES_LABEL[exp.jurisdiccion],
        numero: exp.numero,
        anio:   exp.anio,
      };
    } else if (flow === "deox") {
      payload = {
        jurisdiccion: JURISDICCIONES_LABEL[exp.jurisdiccion],
        numero: exp.numero,
        anio:   exp.anio,
      };
    }

    const startUrl      = FLOW_URLS[flow];
    const urlPattern    = FLOW_URL_PATTERN[flow];
    const contentScript = FLOW_CONTENT_SCRIPT[flow];
    const needsFill     = FLOW_NEEDS_FILL.has(flow);

    chrome.tabs.create({ url: startUrl }, (tab) => {
      if (!tab?.id) return;

      // Sin permiso 'tabs' no podemos leer la URL del tab.
      // Intentamos inyectar en cada carga completa del tab; executeScript
      // rechaza automáticamente páginas fuera de host_permissions (non-PJN).
      // Los content scripts tienen guards propios contra doble ejecución.
      const onUpd = async (tabId, changeInfo) => {
        if (tabId !== tab.id || changeInfo.status !== "complete") return;
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: [contentScript],
          });
          if (needsFill && payload) {
            chrome.tabs.sendMessage(tabId, { action: "fillFields", payload });
          }
        } catch (_) {
          // Página no permitida por host_permissions o error de inyección — ignorar
        }
      };

      const onRemoved = (closedTabId) => {
        if (closedTabId === tab.id) {
          chrome.tabs.onUpdated.removeListener(onUpd);
          chrome.tabs.onRemoved.removeListener(onRemoved);
        }
      };

      chrome.tabs.onUpdated.addListener(onUpd);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });

  } catch (e) {
    console.error("START_FLOW error:", e);
  }
});
