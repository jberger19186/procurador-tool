// demo-fixtures/monitor.js
//
// D2 — fixtures para el capítulo 4 (Monitor de partes) de la demo. Shape
// exacto de `resultados`, el parámetro que consume
// `generarVisorMonitoreo(modo, resultados, bitacoraInfo)` — extraída a
// electron-app/monitor/generarVisorMonitoreo.js en este mismo bloque D2 (ver
// demo-guion.md §10). `modo` distingue 'inicial' (consulta de línea base,
// §4.2-4.4 del guion) de 'novedades' (§4.6, "Buscar Novedades" — la narrativa
// de "apareció un expediente nuevo de tu cliente").

const { EXPEDIENTES, EXPEDIENTE_NOVEDAD } = require('./expedientes');

const PARTE_DEMO = { jurisdiccion_sigla: 'FCR', nombre_parte: 'LÓPEZ CARLOS' };

function aMonitorExpediente(exp) {
  return {
    numero_expediente: exp.expediente,
    dependencia: exp.dependencia,
    caratula: exp.caratula,
    situacion: exp.situacion,
    ultima_actuacion: exp.ultima_actuacion,
  };
}

// Consulta Inicial (§4.2-4.4): línea base con los 4 expedientes del set —
// "Expedientes en base" en vez de "Novedades detectadas" (el 3er label que
// cambia según el modo, hallazgo real de la sesión 2026-08-27 cont. 21).
const MONITOR_RESULTADOS_INICIAL = [
  {
    jurisdiccion_sigla: PARTE_DEMO.jurisdiccion_sigla,
    nombre_parte: PARTE_DEMO.nombre_parte,
    ok: true,
    error: null,
    expedientes: EXPEDIENTES.map(aMonitorExpediente),
  },
];

// Buscar Novedades (§4.6): 1 expediente nuevo detectado, el que no estaba en
// la línea base de arriba.
const MONITOR_RESULTADOS_NOVEDADES = [
  {
    jurisdiccion_sigla: PARTE_DEMO.jurisdiccion_sigla,
    nombre_parte: PARTE_DEMO.nombre_parte,
    ok: true,
    error: null,
    expedientes: [aMonitorExpediente(EXPEDIENTE_NOVEDAD)],
  },
];

// bitacoraInfo (§4.3-4.4, tab "Expedientes" del modal + botonera 📌/➕): la
// demo muestra el módulo habilitado y con FCR 00001/2024 ya seguido, para que
// se vea el badge "📁 ya seguido" junto al resto sin seguir.
const BITACORA_INFO_MONITOR = {
  enabled: true,
  seguidos: [EXPEDIENTES[0].expediente],
  ssoToken: null, // la demo no navega al portal desde acá — no hace falta un token real
};

module.exports = {
  PARTE_DEMO,
  MONITOR_RESULTADOS_INICIAL,
  MONITOR_RESULTADOS_NOVEDADES,
  BITACORA_INFO_MONITOR,
};
