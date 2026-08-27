// demo-fixtures/bitacora.js
//
// D2 — fixtures para el capítulo 5 (Bitácora) de la demo: fichas de
// "Expedientes seguidos" + entradas de agenda (vencimiento/audiencia/nota),
// shape alineado a lo que devuelven `GET /usuarios/api/expedientes` y
// `GET /usuarios/api/bitacora` (routes/bitacora.js) — así stub-portal.js
// puede servirlas sin traducción.
//
// Fechas CALCULADAS relativas a "hoy" (no hardcodeadas): la demo se puede
// regenerar cualquier día y la vista Mes/Semana sigue mostrando la entrada
// vencida, la de hoy y la próxima en el lugar correcto del calendario — sin
// esto, un guion grabado hace 2 semanas mostraría "vencido" en una fecha que
// ya no es la de hoy.

const { EXPEDIENTES } = require('./expedientes');

function isoAt(diasOffset, hora = 12, minuto = 0) {
  const d = new Date();
  d.setDate(d.getDate() + diasOffset);
  d.setHours(hora, minuto, 0, 0);
  return d.toISOString();
}

// El portal espera `situacion_fecha` como fecha ISO parseable (bitFormatUtcDate()
// en app.js) — pasarle el string de display "DD/MM/AAAA" tal cual da una fecha
// inválida que el portal renderiza como "()" vacío (hallazgo real de D3, visto
// en la propia captura de la ficha de Mis Expedientes antes de este fix).
function ddmmaaaaAIsoMediodia(ddmmaaaa) {
  const [dd, mm, aaaa] = ddmmaaaa.split('/');
  return new Date(`${aaaa}-${mm}-${dd}T12:00:00.000Z`).toISOString();
}

// Fichas de "Expedientes seguidos" — 3 de los 4 expedientes del set (el 4to,
// FCR 00004/2024, se deja sin seguir a propósito para que en el capítulo 4
// del Monitor se vea la diferencia entre "ya seguido" y "sin seguir").
const BITACORA_FICHAS = [
  {
    id: 9001,
    expediente: EXPEDIENTES[0].expediente,
    expediente_key: 'fcr|1|2024',
    caratula: EXPEDIENTES[0].caratula,
    dependencia: EXPEDIENTES[0].dependencia,
    situacion: EXPEDIENTES[0].situacion,
    situacion_fecha: ddmmaaaaAIsoMediodia(EXPEDIENTES[0].ultima_actuacion),
    creado_en: isoAt(-30),
  },
  {
    id: 9002,
    expediente: EXPEDIENTES[1].expediente,
    expediente_key: 'civ|2|2024',
    caratula: EXPEDIENTES[1].caratula,
    dependencia: EXPEDIENTES[1].dependencia,
    situacion: EXPEDIENTES[1].situacion,
    situacion_fecha: ddmmaaaaAIsoMediodia(EXPEDIENTES[1].ultima_actuacion),
    creado_en: isoAt(-18),
  },
  {
    id: 9003,
    expediente: EXPEDIENTES[2].expediente,
    expediente_key: 'fcr|3|2023',
    caratula: EXPEDIENTES[2].caratula,
    dependencia: EXPEDIENTES[2].dependencia,
    situacion: EXPEDIENTES[2].situacion,
    situacion_fecha: ddmmaaaaAIsoMediodia(EXPEDIENTES[2].ultima_actuacion),
    creado_en: isoAt(-60),
  },
];

// Entradas de agenda — mezcla de vencimiento/audiencia/nota/tarea, con una
// vencida (para que el banner de avisos de Bitácora tenga algo real que
// mostrar — distinto del banner de cupo, ver demo-guion.md §0.6), una hoy y
// una próxima, para que la vista Mes/Semana no se vea vacía.
const BITACORA_ENTRADAS = [
  {
    id: 8001,
    kind: 'vencimiento',
    title: 'Vence plazo para contestar demanda',
    description: 'Contestación de demanda — 15 días hábiles desde la cédula.',
    due_at: isoAt(-3),
    all_day: false,
    done_at: null,
    expediente_id: 9001,
    source: 'manual',
  },
  {
    id: 8002,
    kind: 'audiencia',
    title: 'Audiencia de conciliación',
    description: 'Sala 4, planta baja.',
    due_at: isoAt(0, 10, 30),
    all_day: false,
    done_at: null,
    expediente_id: 9002,
    source: 'manual',
  },
  {
    id: 8003,
    kind: 'tarea',
    title: 'Revisar contestación antes de presentarla',
    description: null,
    due_at: isoAt(2, 9, 0),
    all_day: false,
    done_at: null,
    expediente_id: 9001,
    source: 'manual',
  },
  {
    id: 8004,
    kind: 'nota',
    title: 'Cliente pidió actualización de estado',
    description: 'Llamó preguntando por el trámite. Responder cuando salga el despacho.',
    due_at: null,
    all_day: false,
    done_at: null,
    expediente_id: 9002,
    source: 'manual',
  },
  {
    id: 8005,
    kind: 'vencimiento',
    title: 'Vencimiento de plazo probatorio',
    description: null,
    due_at: isoAt(7, 12, 0),
    all_day: true,
    done_at: null,
    expediente_id: 9003,
    source: 'manual',
  },
];

module.exports = { BITACORA_FICHAS, BITACORA_ENTRADAS };
