// demo-fixtures/expedientes.js
//
// D2 (demo Etapa 1.6) — el set coherente de expedientes ficticios que atraviesa
// toda la demo: Procuración → Informe → Monitor → Bitácora → Markdown. La
// coherencia (mismos 4 casos en todos los capítulos) es lo que hace que la demo
// se vea real en vez de una galería de pantallas sueltas.
//
// Nombres de partes deliberadamente inventados para material público — NO
// reusan `DON COCHO` / `LA TOSTADORA MODERNA` / `ALVAREZ MARTA FABIANA`, que son
// fixtures del propio proyecto (tests/daily/, prueba diaria), no pensados para
// exhibición pública. Ver demo-guion.md §9.
//
// Carátulas con la FORMA real del PJN (JUR NNNNN/AAAA, "PARTE C/ PARTE S/TIPO"),
// con partes obviamente ficticias — nunca datos de terceros reales.

const EXPEDIENTES = [
  {
    expediente: 'FCR 00001/2024',
    jurisdiccion_sigla: 'FCR',
    caratula: 'GONZÁLEZ MARÍA C/ ASEGURADORA DEMO S.A. S/DAÑOS Y PERJUICIOS',
    dependencia: 'JUZGADO FEDERAL DE COMODORO RIVADAVIA - SECRETARIA CIVIL',
    situacion: 'EN LETRA',
    ultima_actuacion: '20/08/2026',
    movimientos: [
      { fecha: '20/08/2026', tipo: 'MOVIMIENTO', detalle: 'EN LETRA', viewHref: null },
      { fecha: '15/08/2026', tipo: 'FIRMA DESPACHO', detalle: 'PROVEE ESCRITO', viewHref: null },
      { fecha: '15/08/2026', tipo: 'ESCRITO AGREGADO', detalle: 'CONTESTA DEMANDA [Presentado 14/08/2026 11:40]', viewHref: null },
      { fecha: '02/08/2026', tipo: 'CEDULA ELECTRONICA', detalle: 'CEDULA N° 26000123456 - NOTIFICADO EL DIA: 02/08/2026 09:15', viewHref: null },
    ],
  },
  {
    expediente: 'CIV 00002/2024',
    jurisdiccion_sigla: 'CIV',
    caratula: 'PÉREZ JUAN C/ ESTUDIO EJEMPLO S/COBRO DE PESOS',
    dependencia: 'JUZGADO NACIONAL EN LO CIVIL NRO. 45 - SECRETARIA UNICA',
    situacion: 'EN DESPACHO',
    ultima_actuacion: '18/08/2026',
    movimientos: [
      { fecha: '18/08/2026', tipo: 'MOVIMIENTO', detalle: 'EN DESPACHO', viewHref: null },
      { fecha: '10/08/2026', tipo: 'ESCRITO AGREGADO', detalle: 'OFRECE PRUEBA [Presentado 09/08/2026 16:02]', viewHref: null },
      { fecha: '28/07/2026', tipo: 'MOVIMIENTO', detalle: 'EN LETRA', viewHref: null },
    ],
  },
  {
    expediente: 'FCR 00003/2023',
    jurisdiccion_sigla: 'FCR',
    caratula: 'RODRÍGUEZ SOCIEDAD ANÓNIMA C/ FISCO NACIONAL S/EJECUCIÓN FISCAL',
    dependencia: 'JUZGADO FEDERAL DE RIO GALLEGOS - SECRETARIA EJECUCION FISCAL',
    situacion: 'ARCHÍVESE',
    ultima_actuacion: '30/06/2026',
    movimientos: [
      { fecha: '30/06/2026', tipo: 'FIRMA DESPACHO', detalle: 'ARCHIVO', viewHref: null },
      { fecha: '25/06/2026', tipo: 'MOVIMIENTO', detalle: 'PARA ARCHIVAR', viewHref: null },
      { fecha: '02/05/2026', tipo: 'PUBLICACION SENTENCIA', detalle: 'SENT. INTERLOCUTORIA - 30/04/2026', viewHref: null },
    ],
  },
  {
    expediente: 'FCR 00004/2024',
    jurisdiccion_sigla: 'FCR',
    caratula: 'LÓPEZ CARLOS C/ COMPAÑÍA DE SEGUROS DEMO S/ACCIDENTE DE TRABAJO',
    dependencia: 'JUZGADO FEDERAL DE COMODORO RIVADAVIA - SECRETARIA LABORAL',
    situacion: 'EN LETRA',
    ultima_actuacion: '25/08/2026',
    movimientos: [
      { fecha: '25/08/2026', tipo: 'MOVIMIENTO', detalle: 'EN LETRA', viewHref: null },
      { fecha: '25/08/2026', tipo: 'ESCRITO AGREGADO', detalle: 'PRESENTA APODERAMIENTO [Presentado 25/08/2026 08:50]', viewHref: null },
    ],
  },
];

// El caso "recién detectado" para el capítulo de Monitor (§4.6, "Buscar Novedades") —
// distinto de los 4 de arriba a propósito: la narrativa es "apareció un expediente
// nuevo de tu cliente", no uno que ya conocías.
const EXPEDIENTE_NOVEDAD = {
  expediente: 'FCR 00005/2026',
  jurisdiccion_sigla: 'FCR',
  caratula: 'LÓPEZ CARLOS C/ ART DEMO S/ACCIDENTE DE TRABAJO',
  dependencia: 'JUZGADO FEDERAL DE COMODORO RIVADAVIA - SECRETARIA LABORAL',
  situacion: 'EN LETRA',
  ultima_actuacion: '26/08/2026',
};

module.exports = { EXPEDIENTES, EXPEDIENTE_NOVEDAD };
