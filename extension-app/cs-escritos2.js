// cs-escritos2.js — content script para escritos.pjn.gov.ar y sso.pjn.gov.ar

// Capa 3: ID binding — solo ejecutar dentro de la extensión legítima
if (typeof chrome === 'undefined' || !chrome?.runtime?.id) throw new Error('[PJN] Contexto de extensión requerido');

console.log("✅ cs-escritos2 inyectado en", location.href);

// ── LOGIN SSO ──────────────────────────────────────────────────────────────
(async () => {
  const url = location.href;
  if (!url.includes("sso.pjn.gov.ar") && !document.querySelector("input#username")) return;

  console.log("PJN escritos2: Contexto LOGIN detectado");

  const waitFor = (sel, t = 15000) =>
    new Promise((res, rej) => {
      const start = Date.now();
      (function check() {
        const el = document.querySelector(sel);
        if (el) return res(el);
        if (Date.now() - start > t) return rej(new Error(`Timeout: ${sel}`));
        setTimeout(check, 200);
      })();
    });

  try {
    const userInput = await waitFor("#username");
    userInput.value = "27320694359";
    const passInput = await waitFor('input[type="password"]');
    passInput.focus();
    passInput.dispatchEvent(new Event("input", { bubbles: true }));
    passInput.dispatchEvent(new Event("focus", { bubbles: true }));
    await new Promise(r => setTimeout(r, 1000));
    const btn = await waitFor("#kc-login");
    btn.click();
    console.log("PJN escritos2: Login enviado");
    alert(
      "⚠️ Para completar el acceso es necesario realizar una interacción manual.\n\n" +
      "Por favor, haga clic en el campo de contraseña o presione el botón de ingreso manualmente."
    );
  } catch (err) {
    console.error("PJN escritos2: Error en login:", err);
  }
})();

// ── LLENADO DE FORMULARIO en escritos.pjn.gov.ar ──────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== "fillFields" || !msg.payload) return;
  const { jurisdiccion, numero, anio } = msg.payload;

  const waitFor = (sel, t = 15000) =>
    new Promise((res, rej) => {
      const start = Date.now();
      (function check() {
        const el = document.querySelector(sel);
        if (el) return res(el);
        if (Date.now() - start > t) return rej(new Error(`Timeout: ${sel}`));
        setTimeout(check, 200);
      })();
    });

  const waitForAnyText = (sel, texts, t = 5000) =>
    new Promise((res, rej) => {
      const start = Date.now();
      (function check() {
        const el = document.querySelector(sel);
        if (el && texts.some(txt => el.innerText.includes(txt))) return res(el.innerText);
        if (Date.now() - start > t) return rej(new Error(`Timeout esperando texto en: ${sel}`));
        setTimeout(check, 200);
      })();
    });

  // Guard: solo ejecutar en escritos.pjn.gov.ar, no en SSO
  if (!location.href.includes("escritos.pjn.gov.ar")) return;

  (async () => {
    try {
      // 1) Rellenar jurisdicción (combobox con dropdown)
      const jurisdiccionInput = await waitFor('input[role="combobox"][aria-autocomplete="list"]');
      jurisdiccionInput.focus();
      jurisdiccionInput.value = jurisdiccion;
      jurisdiccionInput.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));

      const listbox = document.querySelector('ul[role="listbox"]');
      if (listbox) {
        const items = listbox.querySelectorAll('li[role="option"]');
        let seleccionada = false;
        for (const item of items) {
          const textoItem    = item.innerText.trim().toLowerCase();
          const textoBuscado = jurisdiccion.trim().toLowerCase();
          if (textoItem.includes(textoBuscado) || textoBuscado.includes(textoItem)) {
            item.click();
            seleccionada = true;
            break;
          }
        }
        if (!seleccionada) console.warn("⚠️ Jurisdicción no encontrada en lista:", jurisdiccion);
      } else {
        console.warn("⚠️ Dropdown de jurisdicciones no apareció.");
      }

      // 2) Rellenar número y año
      const numeroInput = await waitFor('input[name="numeroExpediente"]');
      numeroInput.value = numero;
      numeroInput.dispatchEvent(new Event("input", { bubbles: true }));

      const anioInput = await waitFor('input[name="anioExpediente"]');
      anioInput.value = anio;
      anioInput.dispatchEvent(new Event("input", { bubbles: true }));

      // 3) Siguiente paso
      const nextBtn = await waitFor("button#StepperNextBtn");
      nextBtn.click();

      // Cerrar el alert "Se han encontrado N resultados" si aparece
      const alertBtn = await waitFor('div[role="alert"] .MuiAlert-action button', 2000).catch(() => null);
      if (alertBtn && /cerrar/i.test(alertBtn.textContent.trim())) {
        alertBtn.click();
        console.log("PJN escritos2: Alert cerrado.");
        await new Promise(r => setTimeout(r, 400));
      }

      // 4) Detección de resultado: expediente único o listado
      try {
        const textoDetectado = await waitForAnyText('h5#simple-form-title', [
          'Se ha encontrado el siguiente expediente',
          'Por favor seleccione un expediente del listado',
        ], 5000);

        if (textoDetectado.includes('Se ha encontrado el siguiente expediente')) {
          console.log("PJN escritos2: Expediente único, avanzando.");
          const nextBtn2 = await waitFor("button#StepperNextBtn");
          await waitForStepTransition(nextBtn2);
          showToast("✅ Flujo Escritos 2 completado. Continúe con la interacción en la página.");
          return;
        }

        // Múltiples resultados: seleccionar por número/año
        if (textoDetectado.includes('Por favor seleccione un expediente del listado')) {
          console.log("PJN escritos2: Múltiples expedientes, seleccionando.");
        }

        const resultListbox = await waitFor('ul[role="listbox"]', 5000);
        const resultItems = resultListbox.querySelectorAll('li[role="option"]');
        const numeroNorm = numero.replace(/^0+/, "");
        // (?!\/) → lookahead negativo: el año NO debe estar seguido de otra barra (excluye /1, /2…)
        const patron = new RegExp(`${SIGLA_FROM_LABEL(jurisdiccion)}\\s+${numeroNorm}\\/${anio}(?!\\/)`, "i");

        let seleccionado = false;
        for (const item of resultItems) {
          if (patron.test(item.innerText.trim())) {
            item.click();
            seleccionado = true;
            break;
          }
        }
        if (!seleccionado) console.warn(`⚠️ No se encontró expediente en listado.`);

        const nextBtn2 = await waitFor("button#StepperNextBtn");
        await waitForStepTransition(nextBtn2);
        showToast("✅ Flujo Escritos 2 completado. Continúe con la interacción en la página.");
      } catch {
        console.warn("PJN escritos2: Sin mensaje de resultado, avanzando por fallback.");
        const nextBtn2 = await waitFor("button#StepperNextBtn");
        await waitForStepTransition(nextBtn2);
        showToast("✅ Flujo Escritos 2 completado. Continúe con la interacción en la página.");
      }

    } catch (err) {
      console.error("PJN cs-escritos2 error:", err);
    }
  })();
});

// Hace click y espera que el stepper avance (el form attr del botón cambia o desaparece)
function waitForStepTransition(btn, maxMs = 8000) {
  const prevForm = btn.getAttribute("form") || "";
  btn.click();
  return new Promise(resolve => {
    const deadline = setTimeout(resolve, maxMs);
    const iv = setInterval(() => {
      const current = document.querySelector("button#StepperNextBtn");
      if (!current || current.getAttribute("form") !== prevForm) {
        clearTimeout(deadline);
        clearInterval(iv);
        resolve();
      }
    }, 150);
  });
}

// Extrae la sigla corta desde el label completo "FCR - Justicia Federal..."
function SIGLA_FROM_LABEL(label) {
  const m = label.match(/^([A-Z]{2,3})\s*-/);
  return m ? m[1] : label.split(" ")[0];
}

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
