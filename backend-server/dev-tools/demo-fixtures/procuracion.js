// demo-fixtures/procuracion.js
//
// D2 — fixture para el capítulo 2 (Procuración) de la demo. Shape exacto de
// `datosEmbebidos`, el objeto que `visorModal_template.html` lee de
// `window.datosEmbebidos` (confirmado por grep de todos los `exp.`/`mov.`
// del template — ver demo-guion.md §2 y §10 para el detalle de la
// verificación). Ningún generador plano produce esto en producción: lo arma
// un script de backend ENCRIPTADO (zona protegida, no reusable) — por eso acá
// se escribe el JSON final a mano en vez de "llamar a la función real" como
// en informe.js/monitor.js.

const { EXPEDIENTES } = require('./expedientes');

function aVisorExpediente(exp) {
  return {
    expediente: exp.expediente,
    caratula: exp.caratula,
    dependencia: exp.dependencia,
    situacion: exp.situacion,
    ultimaAct: exp.ultima_actuacion,
    estado: 'exitoso',
    movimientos: exp.movimientos.map((m) => ({
      fecha: m.fecha,
      tipo: m.tipo,
      detalle: m.detalle,
      viewHref: m.viewHref,
    })),
  };
}

// `resumen` es el bloque de stats que lee `mostrarResumen()` del template
// (totalListados/exitosos/fallidos/tiempoTotal) — sin esto el header del
// visor queda con NaN en las 4 tarjetas.
function resumenPara(expedientesVisor, tiempoTotal) {
  const exitosos = expedientesVisor.filter((e) => e.estado === 'exitoso').length;
  return {
    totalListados: expedientesVisor.length,
    exitosos,
    fallidos: expedientesVisor.length - exitosos,
    tiempoTotal,
  };
}

// Procuración individual (§2.1 del guion): FCR 00001/2024 solo.
const expedientesIndividual = [aVisorExpediente(EXPEDIENTES[0])];
const PROCURACION_INDIVIDUAL = {
  fechaEjecucion: new Date().toISOString(),
  resumen: resumenPara(expedientesIndividual, 22),
  expedientes: expedientesIndividual,
};

// Procuración por lote (§2.2): FCR 00001/2024 + CIV 00002/2024 — los mismos 2
// casos que va a repetir el Informe por lote en el capítulo 3.
const expedientesLote = [aVisorExpediente(EXPEDIENTES[0]), aVisorExpediente(EXPEDIENTES[1])];
const PROCURACION_LOTE = {
  fechaEjecucion: new Date().toISOString(),
  resumen: resumenPara(expedientesLote, 38),
  expedientes: expedientesLote,
};

module.exports = { PROCURACION_INDIVIDUAL, PROCURACION_LOTE };
