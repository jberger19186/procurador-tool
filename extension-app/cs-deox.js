// cs-deox.js — content script para deox.pjn.gov.ar y sso.pjn.gov.ar
// Todo el código está dentro de un IIFE con guard para evitar errores de
// re-declaración cuando el script se inyecta más de una vez (SSO + deox).

// Capa 3: ID binding — solo ejecutar dentro de la extensión legítima
if (typeof chrome === 'undefined' || !chrome?.runtime?.id) throw new Error('[PJN] Contexto de extensión requerido');

(function () {
  if (window.__PJN_DEOX_DEFINED__) return;
  window.__PJN_DEOX_DEFINED__ = true;

  console.log("✅ cs-deox inyectado en", location.href);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function waitFor(sel, timeout) {
    if (timeout === undefined) timeout = 15000;
    return new Promise(function (res, rej) {
      var start = Date.now();
      (function check() {
        var el = document.querySelector(sel);
        if (el) return res(el);
        if (Date.now() - start > timeout) return rej(new Error("Timeout: " + sel));
        setTimeout(check, 200);
      })();
    });
  }

  function showToast(msg) {
    var d = document.createElement("div");
    d.textContent = msg;
    Object.assign(d.style, {
      position: "fixed", bottom: "24px", right: "24px", zIndex: "2147483647",
      background: "#1a73e8", color: "#fff", padding: "12px 20px",
      borderRadius: "8px", fontSize: "14px", fontFamily: "system-ui,sans-serif",
      boxShadow: "0 4px 16px rgba(0,0,0,0.25)", maxWidth: "360px",
      lineHeight: "1.4", opacity: "0", transition: "opacity 0.3s",
    });
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.style.opacity = "1"; });
    setTimeout(function () {
      d.style.opacity = "0";
      setTimeout(function () { d.remove(); }, 400);
    }, 6000);
  }

  function setReactVal(input, value) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function waitForStepTransition(btn, maxMs) {
    if (maxMs === undefined) maxMs = 8000;
    var prevForm = btn.getAttribute("form") || "";
    btn.click();
    return new Promise(function (resolve) {
      var deadline = setTimeout(resolve, maxMs);
      var iv = setInterval(function () {
        var current = document.querySelector("button#StepperNextBtn");
        if (!current || current.getAttribute("form") !== prevForm) {
          clearTimeout(deadline);
          clearInterval(iv);
          resolve();
        }
      }, 150);
    });
  }

  function siglaFromLabel(label) {
    var m = (label || "").match(/^([A-Z]{2,3})\s*-/);
    return m ? m[1] : (label || "").split(" ")[0];
  }

  var JURISDICCIONES_LABEL = {
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

  // ── LOGIN SSO ─────────────────────────────────────────────────────────────
  (async () => {
    if (!location.href.includes("sso.pjn.gov.ar") && !document.querySelector("input#username")) return;
    console.log("PJN deox: página SSO detectada");
    try {
      const userInput = await waitFor("#username");
      userInput.value = "27320694359";
      const passInput = await waitFor('input[type="password"]');
      passInput.focus();
      passInput.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      alert("⚠️ Ingrese su contraseña y presione el botón de ingreso para continuar con el flujo DEOX.");
    } catch (err) {
      console.error("PJN deox SSO error:", err);
    }
  })();

  // ── FLUJO DEOX — lee desde storage y espera a que React cargue el formulario ─
  (async () => {
    if (!location.href.includes("deox.pjn.gov.ar")) return;
    if (window.__PJN_DEOX_RUNNING__) return;
    window.__PJN_DEOX_RUNNING__ = true;

    try {
      const stored = await chrome.storage.local.get(["expedienteData", "selectedFlow"]);
      if (!stored.expedienteData || stored.selectedFlow !== "deox") {
        console.log("PJN deox: sin datos en storage para flujo deox, saliendo.");
        return;
      }

      const exp = stored.expedienteData;
      const jurisdiccion = JURISDICCIONES_LABEL[exp.jurisdiccion] || exp.sigla;
      const sigla = exp.sigla || siglaFromLabel(jurisdiccion);
      const { numero, anio } = exp;

      console.log(`PJN deox: Iniciando → ${sigla} ${numero}/${anio} (${jurisdiccion})`);

      // ── STEP 0: jurisdicción + número + año ──────────────────────────────
      const camaraInput = await waitFor('input[name="camara"]', 20000);
      await new Promise(r => setTimeout(r, 200));

      camaraInput.focus();
      camaraInput.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));

      setReactVal(camaraInput, sigla);

      // Esperar listbox y luego esperar que los li se rendericen (dos fases de MUI)
      const listbox = await waitFor('ul[role="listbox"]', 3000).catch(() => null);
      if (listbox) {
        await waitFor('ul[role="listbox"] li[role="option"]', 2000).catch(() => null);
        const items = listbox.querySelectorAll('li[role="option"]');
        console.log(`PJN deox: ${items.length} opciones en dropdown de jurisdicción`);
        if (items.length > 0) {
          items[0].click();
          console.log(`PJN deox: jurisdicción seleccionada → "${items[0].textContent.trim().slice(0, 50)}"`);
        } else {
          camaraInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
      } else {
        console.warn("PJN deox: listbox no apareció, usando Enter como fallback");
        setReactVal(camaraInput, jurisdiccion);
        await new Promise(r => setTimeout(r, 400));
        camaraInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }

      await new Promise(r => setTimeout(r, 150));

      const numeroInput = await waitFor('input[name="numeroExpediente"]');
      numeroInput.focus();
      setReactVal(numeroInput, numero);

      const anioInput = await waitFor('input[name="anioExpediente"]');
      anioInput.focus();
      setReactVal(anioInput, anio);
      await new Promise(r => setTimeout(r, 100));

      const nextBtn0 = await waitFor("button#StepperNextBtn");
      await waitForStepTransition(nextBtn0);
      console.log("PJN deox: Step 0 completado, esperando step 1...");

      // Cerrar alert "Se han encontrado N resultados" si aparece
      const alertBtn0 = await waitFor('div[role="alert"] .MuiAlert-action button', 2000).catch(() => null);
      if (alertBtn0 && /cerrar/i.test(alertBtn0.textContent.trim())) {
        alertBtn0.click();
        console.log("PJN deox: Alert cerrado.");
        await new Promise(r => setTimeout(r, 400));
      }

      // ── STEP 1: seleccionar expediente del listado ────────────────────────
      // Esperar que el step 1 esté visible
      await waitFor("h5#simple-form-title", 12000);
      await new Promise(r => setTimeout(r, 200));

      // Si hay input de autocomplete → hay múltiples resultados con listbox abierto
      // Si no hay input → expediente único, avanzar directo a Siguiente
      const expedienteInput = await waitFor('input[name="expediente"]', 800).catch(() => null);

      if (expedienteInput) {
        // El listbox ya está abierto con todos los resultados (el site lo abre automáticamente)
        // Esperar que los li se rendericen (MUI puede renderizar ul antes que los li)
        const expListbox = await waitFor('ul[role="listbox"]', 5000).catch(() => null);
        if (expListbox) {
          await waitFor('ul[role="listbox"] li[role="option"]', 3000).catch(() => null);
          const options = expListbox.querySelectorAll('li[role="option"]');
          // Normalizar número (018745 → 18745) y excluir sub-expedientes con (?!\/)
          const numeroNorm = String(numero).replace(/^0+/, "") || "0";
          const patron = new RegExp(`${sigla}\\s+${numeroNorm}\\/${anio}(?!\\/)`, "i");
          console.log(`PJN deox: ${options.length} expedientes en listbox, buscando "${sigla} ${numeroNorm}/${anio}"`);

          let seleccionado = false;
          for (const opt of options) {
            if (patron.test(opt.innerText.trim())) {
              opt.click();
              seleccionado = true;
              console.log(`PJN deox: expediente seleccionado → "${opt.innerText.trim().slice(0, 60)}"`);
              break;
            }
          }
          if (!seleccionado) {
            console.warn("PJN deox: sin match en listbox, Enter como fallback");
            expedienteInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
          }
        } else {
          console.warn("PJN deox: listbox no apareció, Enter como fallback");
          expedienteInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 300));
      } else {
        // Expediente único: sin autocomplete, avanzar directamente
        console.log("PJN deox: expediente único (sin autocomplete), avanzando directamente.");
      }

      const nextBtn1 = await waitFor("button#StepperNextBtn");
      await waitForStepTransition(nextBtn1);

      await chrome.storage.local.remove(["expedienteData", "selectedFlow"]);
      console.log("PJN deox: flujo completado ✅");
      showToast("✅ Flujo DEOX completado. Continúe con la interacción en la página.");

    } catch (err) {
      console.error("PJN cs-deox error:", err);
    }
  })();

})(); // fin del guard IIFE
