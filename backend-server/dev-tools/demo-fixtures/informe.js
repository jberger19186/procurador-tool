// demo-fixtures/informe.js
//
// D2 — fixtures para el capítulo 3 (Informe) de la demo.
//
// Dos shapes distintos, porque `generarVisorHTML()` (electron-app/informe/
// generador_visor.js) espera el resumen del INFORME (ok/exitCode/caratula),
// no el detalle de movimientos del expediente — eso lo resuelve por su cuenta
// leyendo `buscarPdfExpediente()` contra el PDF real en disco (ver
// generar-visores.js, que crea los placeholders antes de llamar a esta función).

const { EXPEDIENTES } = require('./expedientes');

// Informe individual (§3.1 del guion): FCR 00001/2024 solo.
const INFORME_INDIVIDUAL_RESUMEN = [
  {
    expediente: EXPEDIENTES[0].expediente,
    ok: true,
    exitCode: 0,
    caratula: EXPEDIENTES[0].caratula,
  },
];

// Informe por lote (§3.2): FCR 00001/2024 + CIV 00002/2024, los mismos 2 casos
// que ya aparecieron en la Procuración por lote del capítulo 2 — la
// continuidad narrativa es la que hace que la demo lea como un caso de uso
// real, no una galería de pantallas sueltas.
const INFORME_LOTE_RESUMEN = [
  {
    expediente: EXPEDIENTES[0].expediente,
    ok: true,
    exitCode: 0,
    caratula: EXPEDIENTES[0].caratula,
  },
  {
    expediente: EXPEDIENTES[1].expediente,
    ok: true,
    exitCode: 0,
    caratula: EXPEDIENTES[1].caratula,
  },
];

module.exports = { INFORME_INDIVIDUAL_RESUMEN, INFORME_LOTE_RESUMEN };
