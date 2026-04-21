// cs-scw.js — content script para scw.pjn.gov.ar y sso.pjn.gov.ar
// Maneja: Login SSO → Lista de Expedientes → Consulta Pública → (Escritos 1: expediente.seam)

// Capa 3: ID binding — solo ejecutar dentro de la extensión legítima
if (typeof chrome === 'undefined' || !chrome?.runtime?.id) throw new Error('[PJN] Contexto de extensión requerido');

console.log("✅ cs-scw inyectado en", location.href);

(async () => {
  if (window.__PJN_AUTOFLOW_RUNNING__) return;
  window.__PJN_AUTOFLOW_RUNNING__ = true;

  const waitFor = (sel, t = 15000) =>
    new Promise((res, rej) => {
      const start = Date.now();
      (function check() {
        const el = document.querySelector(sel);
        if (el) return res(el);
        if (Date.now() - start > t) return rej(new Error(`Timeout esperando: ${sel}`));
        setTimeout(check, 200);
      })();
    });

  const JURIS_MAP = {
    CSJ: "0",  CIV: "1",  CAF: "2",  CCF: "3",  CNE: "4",  CSS: "5",  CPE: "6",
    CNT: "7",  CFP: "8",  CCC: "9",  COM: "10", CPF: "11", CPN: "12", FBB: "13",
    FCR: "14", FCB: "15", FCT: "16", FGR: "17", FLP: "18", FMP: "19", FMZ: "20",
    FPO: "21", FPA: "22", FRE: "23", FSA: "24", FRO: "25", FSM: "26", FTU: "27",
  };

  // ── Helpers de storage con fallback en memoria ───────────────────────────
  let _memExp = null;
  let _memFlow = null;

  async function storageGet(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      return { expedienteData: _memExp, selectedFlow: _memFlow };
    }
  }
  async function storageRemove(keys) {
    try { await chrome.storage.local.remove(keys); } catch {}
    _memExp = null;
    _memFlow = null;
  }

  // ── Obtener expediente (storage o fallback prompt) ───────────────────────
  async function getExpediente() {
    const stored = await storageGet(["expedienteData", "selectedFlow"]);
    if (stored.expedienteData?.sigla) {
      _memExp  = stored.expedienteData;
      _memFlow = stored.selectedFlow;
      return stored;
    }
    // Fallback: prompt manual
    const input = prompt("Ingrese el expediente (SIGLA NNNNN/AAAA). Ej.: FCR 18745/2017");
    if (!input) throw new Error("Ingreso cancelado.");
    const m = input.trim().toUpperCase().match(/^([A-Z]{2,3})\s+(\d{1,10})\/(\d{4})$/);
    if (!m) throw new Error("Formato inválido. Use p.ej.: FCR 18745/2017");
    const [, sigla, numero, anio] = m;
    const jurisdiccion = JURIS_MAP[sigla];
    if (!jurisdiccion) throw new Error(`Sigla desconocida: ${sigla}`);
    const expedienteData = { sigla, numero, anio, jurisdiccion };
    try { await chrome.storage.local.set({ expedienteData }); } catch {}
    _memExp = expedienteData;
    return { expedienteData, selectedFlow: "consulta" };
  }

  try {
    // ── 0) Toast pendiente de la página anterior (p.ej. tras navegar a destino) ─
    const { pjnToast } = await storageGet(["pjnToast"]);
    if (pjnToast) {
      await storageRemove(["pjnToast"]);
      await new Promise(r => setTimeout(r, 700)); // esperar que la página se asiente
      showToast(pjnToast);
    }

    const url = location.href;

    // ── 1) LOGIN SSO ─────────────────────────────────────────────────────────
    if (url.includes("sso.pjn.gov.ar") || document.querySelector("input#username")) {
      console.log("PJN: Contexto LOGIN detectado");
      try { await getExpediente(); } catch {}

      const userInput = await waitFor("#username");
      userInput.value = "27320694359";

      const passInput = await waitFor('input[type="password"]');
      passInput.focus();
      passInput.dispatchEvent(new Event("input",  { bubbles: true }));
      passInput.dispatchEvent(new Event("focus",  { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));

      const btn = await waitFor("#kc-login");
      btn.click();
      console.log("PJN: Login enviado");

      alert(
        "⚠️ Para completar el acceso es necesario realizar una interacción manual.\n\n" +
        "Por favor, haga clic en el campo de contraseña o presione el botón de ingreso manualmente.\n" +
        "Esta medida es una restricción de seguridad del sitio."
      );
      return;
    }

    // ── 2) expediente.seam → solo para flujo escritos1 (antes del header check) ─
    if (url.includes("/scw/expediente.seam")) {
      const stored = await storageGet(["selectedFlow"]);
      const flow = stored.selectedFlow || _memFlow;
      if (flow !== "escritos1") return;

      console.log("PJN: Contexto EXPEDIENTE (escritos1)");
      try {
        const legend = await waitFor("legend.ui-fieldset-legend", 10000);
        if (legend.textContent.trim() === "Datos Generales") {
          await new Promise(r => setTimeout(r, 500));
          const presentarLink = await waitFor("#expediente\\:nuevoEscritoBtn a", 5000);
          // Guardar toast para mostrarlo en la página de destino (navegación)
          try { await chrome.storage.local.set({ pjnToast: "✅ Flujo Escritos 1 completado. Continúe con la interacción en la página." }); } catch {}
          presentarLink.click();
          console.log("PJN: Click en 'Presentar escrito' realizado.");
          await storageRemove(["expedienteData", "selectedFlow"]);
        }
      } catch (err) {
        console.error("PJN: Error en expediente.seam:", err);
      }
      return;
    }

    // ── 3) Encabezado principal (páginas SCW estándar) ───────────────────────
    let headerElem;
    try {
      headerElem = await waitFor("span.colorTextGrey", 7000);
    } catch {
      console.log("PJN: Sin encabezado reconocido, saliendo.");
      return;
    }
    const headerText = headerElem.textContent.trim();
    console.log(`PJN: Encabezado → "${headerText}"`);

    // ── 4) Lista → click "Nueva Consulta Pública" ────────────────────────────
    if (headerText === "Lista de Expedientes Relacionados") {
      const link = await waitFor("#j_idt24\\:menuNavigation\\:j_idt36\\:menuNuevaConsulta");
      link.click();
      return;
    }

    // ── 5) Consulta pública → rellenar y enviar ──────────────────────────────
    if (headerText === "Consulta pública") {
      const { expedienteData } = await getExpediente();
      const { jurisdiccion, numero, anio } = expedienteData;

      const camEl  = await waitFor("#formPublica\\:camaraNumAni");
      const numEl  = await waitFor("#formPublica\\:numero");
      const aniEl  = await waitFor("#formPublica\\:anio");

      camEl.value = String(jurisdiccion);
      camEl.dispatchEvent(new Event("change", { bubbles: true }));
      numEl.value = String(numero);
      numEl.dispatchEvent(new Event("input",  { bubbles: true }));
      aniEl.value = String(anio);
      aniEl.dispatchEvent(new Event("input",  { bubbles: true }));

      const consultarBtn = await waitFor("#formPublica\\:buscarPorNumeroButton");
      const storedFlow = await storageGet(["selectedFlow"]);
      const esEscritos1 = (storedFlow.selectedFlow || _memFlow) === "escritos1";

      // Solo guardar toast si es flujo consulta; escritos1 tiene su propio
      // toast al final (al presionar "Presentar escrito") y la página del expediente
      // es solo un paso intermedio, no el destino
      if (!esEscritos1) {
        try { await chrome.storage.local.set({ pjnToast: "✅ Consulta completada. Continúe con la interacción en la página." }); } catch {}
      }
      consultarBtn.click();
      console.log("PJN: Consulta enviada.");

      if (!esEscritos1) {
        await storageRemove(["expedienteData", "selectedFlow"]);
      }
      return;
    }

    console.log("PJN: Página no gestionada por cs-scw.");
  } catch (err) {
    console.error("PJN cs-scw error:", err);
  }
})();

function showToast(msg) {
  const d = document.createElement("div");
  d.textContent = msg;
  Object.assign(d.style, {
    position: "fixed", bottom: "24px", right: "24px", zIndex: "2147483647",
    background: "#1a73e8", color: "#fff", padding: "12px 20px",
    borderRadius: "8px", fontSize: "14px", fontFamily: "system-ui,sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)", maxWidth: "360px",
    lineHeight: "1.4", opacity: "0", transition: "opacity 0.3s",
  });
  document.body.appendChild(d);
  requestAnimationFrame(() => { d.style.opacity = "1"; });
  setTimeout(() => {
    d.style.opacity = "0";
    setTimeout(() => d.remove(), 400);
  }, 6000);
}
