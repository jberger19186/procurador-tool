// cs-notif.js — content script para notif.pjn.gov.ar y sso.pjn.gov.ar

// Capa 3: ID binding — solo ejecutar dentro de la extensión legítima
if (typeof chrome === 'undefined' || !chrome?.runtime?.id) throw new Error('[PJN] Contexto de extensión requerido');

console.log("✅ cs-notif inyectado en", location.href);

// ── Helper para setear valores en inputs React/MUI ─────────────────────────
const _nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

function reactSet(input, value) {
  _nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── LOGIN SSO ──────────────────────────────────────────────────────────────
(async () => {
  const url = location.href;
  if (!url.includes("sso.pjn.gov.ar") && !document.querySelector("input#username")) return;

  console.log("PJN notif: Contexto LOGIN detectado");

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
    console.log("PJN notif: Login enviado");
    alert(
      "⚠️ Para completar el acceso es necesario realizar una interacción manual.\n\n" +
      "Por favor, haga clic en el campo de contraseña o presione el botón de ingreso manualmente."
    );
  } catch (err) {
    console.error("PJN notif: Error en login:", err);
  }
})();

// ── LLENADO DE FORMULARIO en notif.pjn.gov.ar ─────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== "fillFields" || !msg.payload) return;
  // Guard: solo ejecutar en notif.pjn.gov.ar, no en SSO
  if (!location.href.includes("notif.pjn.gov.ar")) return;
  const { jurisdiccion, numero, anio } = msg.payload;
  console.log("PJN notif: fillFields recibido →", { jurisdiccion, numero, anio });

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

  const waitForAnyText = (sel, texts, t = 8000) =>
    new Promise((res, rej) => {
      const start = Date.now();
      (function check() {
        const el = document.querySelector(sel);
        if (el && texts.some(txt => el.innerText.includes(txt))) return res(el.innerText);
        if (Date.now() - start > t) return rej(new Error(`Timeout esperando texto en: ${sel}`));
        setTimeout(check, 200);
      })();
    });

  (async () => {
    try {
      // 1) Esperar que el formulario esté listo
      const jurisdiccionInput = await waitFor('input[role="combobox"][aria-autocomplete="list"]');
      await new Promise(r => setTimeout(r, 500));

      // 2) Rellenar jurisdicción — native setter para React, espera fija 800ms
      jurisdiccionInput.focus();
      jurisdiccionInput.click();
      await new Promise(r => setTimeout(r, 200));
      reactSet(jurisdiccionInput, jurisdiccion);
      await new Promise(r => setTimeout(r, 800));

      // 3) Query síncrono del listbox (ya pasaron 800ms, si no está no va a aparecer)
      //    + esperar que los li se rendericen (dos fases de MUI)
      let optionClicked = false;
      const listboxJuris = document.querySelector('ul[role="listbox"]');
      if (listboxJuris) {
        await waitFor('ul[role="listbox"] li[role="option"]', 1500).catch(() => null);
        const options = listboxJuris.querySelectorAll('li[role="option"]');
        console.log(`PJN notif: ${options.length} opciones en dropdown`);
        const siglaJuris = SIGLA_FROM_LABEL(jurisdiccion);
        for (const opt of options) {
          if (opt.innerText.includes(jurisdiccion) || opt.innerText.includes(siglaJuris)) {
            opt.click();
            optionClicked = true;
            console.log("PJN notif: Opción clickeada →", opt.innerText.trim());
            break;
          }
        }
        if (!optionClicked && options.length > 0) {
          options[0].click();
          optionClicked = true;
          console.log("PJN notif: Usando primera opción del dropdown");
        }
      } else {
        // Fallback: Enter si no apareció listbox
        console.warn("PJN notif: Sin dropdown, intentando Enter");
        jurisdiccionInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 300));

      // 4) Número de expediente
      const numeroInput = await waitFor('input[name="numeroExpediente"]');
      numeroInput.focus();
      reactSet(numeroInput, numero);
      await new Promise(r => setTimeout(r, 200));

      // 5) Año de expediente
      const anioInput = await waitFor('input[name="anioExpediente"]');
      anioInput.focus();
      reactSet(anioInput, anio);
      await new Promise(r => setTimeout(r, 300));

      // 6) Botón Siguiente
      const nextBtn = await waitFor("button#StepperNextBtn");
      nextBtn.click();
      console.log("PJN notif: Siguiente clickeado");

      // 7) Cerrar alert de resultados si aparece
      await new Promise(r => setTimeout(r, 1000));
      const alertBtn = document.querySelector('div[role="alert"] .MuiAlert-action button');
      if (alertBtn && /cerrar/i.test(alertBtn.textContent.trim())) {
        alertBtn.click();
        console.log("PJN notif: Alert de resultados cerrado");
        await new Promise(r => setTimeout(r, 400));
      }

      // 8) Detectar resultado: expediente único o listado múltiple
      try {
        const textoDetectado = await waitForAnyText('h5#simple-form-title', [
          'Se ha encontrado el siguiente expediente',
          'Por favor seleccione un expediente del listado',
        ], 8000);

        if (textoDetectado.includes('Se ha encontrado el siguiente expediente')) {
          console.log("PJN notif: Expediente único encontrado, avanzando.");
          const nextBtn2 = await waitFor("button#StepperNextBtn");
          await waitForStepTransition(nextBtn2);
          showToast("✅ Flujo Notificaciones completado. Continúe con la interacción en la página.");
          return;
        }

        if (textoDetectado.includes('Por favor seleccione un expediente del listado')) {
          console.log("PJN notif: Múltiples resultados, seleccionando expediente.");
          // El listbox ya está abierto automáticamente con todos los resultados
          // Esperar que los li se rendericen (dos fases MUI)
          const resultListbox = await waitFor('ul[role="listbox"]', 5000);
          await waitFor('ul[role="listbox"] li[role="option"]', 3000).catch(() => null);
          const resultItems = resultListbox.querySelectorAll('li[role="option"]');
          // Normalizar número y excluir sub-expedientes con lookahead negativo (?!\/)
          const numeroNorm = numero.replace(/^0+/, "") || "0";
          const sigla = SIGLA_FROM_LABEL(jurisdiccion);
          const patron = new RegExp(`${sigla}\\s+${numeroNorm}\\/${anio}(?!\\/)`, "i");
          console.log(`PJN notif: ${resultItems.length} expedientes en listbox, buscando "${sigla} ${numeroNorm}/${anio}"`);

          let seleccionado = false;
          for (const item of resultItems) {
            if (patron.test(item.innerText.trim())) {
              item.click();
              seleccionado = true;
              console.log("PJN notif: Expediente seleccionado →", item.innerText.trim().slice(0, 60));
              break;
            }
          }
          if (!seleccionado) {
            console.warn("⚠️ PJN notif: No se encontró el expediente en el listado.");
          }

          await new Promise(r => setTimeout(r, 400));
          const nextBtn2 = await waitFor("button#StepperNextBtn");
          await waitForStepTransition(nextBtn2);
          showToast("✅ Flujo Notificaciones completado. Continúe con la interacción en la página.");
        }

      } catch {
        console.warn("PJN notif: Sin h5 de resultado, avanzando por fallback.");
        try {
          const nextBtn2 = await waitFor("button#StepperNextBtn", 5000);
          await waitForStepTransition(nextBtn2);
          showToast("✅ Flujo Notificaciones completado. Continúe con la interacción en la página.");
        } catch {
          showToast("⚠️ No se pudo avanzar automáticamente. Por favor continúe manualmente.");
        }
      }

    } catch (err) {
      console.error("PJN cs-notif error:", err);
      showToast("❌ Error en el flujo de notificaciones: " + err.message);
    }
  })();
});

// Hace click y espera que el stepper avance (form attr cambia o botón desaparece)
function waitForStepTransition(btn, maxMs = 10000) {
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
