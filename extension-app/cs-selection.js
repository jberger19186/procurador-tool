// cs-selection.js — valida el texto seleccionado antes de mostrar el menú contextual
// Patrón válido: 2-3 letras mayúsculas + espacio + hasta 10 dígitos + / + 4 dígitos año
// Ejemplo: FCR 18745/2017  |  CSJ 0001234567/2023

const EXP_REGEX = /^[A-Z]{2,3}\s+\d{1,10}\/\d{4}$/;

document.addEventListener("contextmenu", () => {
  const text = (window.getSelection()?.toString() || "").trim();
  const valid = EXP_REGEX.test(text);
  // Notificar al background para mostrar/ocultar el ítem del menú
  chrome.runtime.sendMessage({ type: "SELECTION_CHECK", valid }).catch(() => {
    // SW puede estar durmiendo; ignorar el error silenciosamente
  });
}, true); // captura en fase capture para ejecutar antes que el menú nativo
