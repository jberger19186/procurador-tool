// config.js — Configuración central de la extensión PJN
// Cargado vía importScripts() en background.js y via <script> en popup.html

// IMPORTANTE: reemplazar BACKEND_URL con la URL de producción antes de empaquetar el CRX.
// eslint-disable-next-line no-var
var EXT_CONFIG = {
  // URL del backend (sin barra final)
  BACKEND_URL: 'https://api.procuradortool.com',

  // Intervalo de refresh del token en ms (2 h - 10 min = 110 min)
  TOKEN_REFRESH_INTERVAL: 110 * 60 * 1000,

  // Todos los flujos disponibles en la extensión
  ALL_FLOWS: ['consulta', 'escritos1', 'escritos2', 'notificaciones', 'deox'],
};
