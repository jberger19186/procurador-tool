// demo-fixtures/cuenta.js
//
// D2 — cuenta sintética para la demo: la usan tanto la capa de sustitución de
// Electron (Parte B, chip de usuario) como la extensión de los stubs V0
// (Mi Plan / Facturación / Soporte del portal, capítulo 7).
//
// 🚨 Números de cupo elegidos a propósito LEJOS de cualquier umbral de aviso
// (demo-guion.md §0.6): las 3 barras de progreso quedan en verde. Un cupo
// "realista pero casi agotado" dispararía el banner ámbar en medio de la
// demo — exactamente lo que la regla de higiene de captura existe para
// evitar. Si en algún capítulo se necesita mostrar el banner a propósito
// (para explicarlo, no para que aparezca sin querer), usar un fixture
// aparte, nunca este.

const CUENTA_DEMO = {
  nombre: 'Estudio Demo',
  apellido: '',
  email: 'demo@procuradortool.com',
  cuit: '20111111112', // CUIT sintético, no corresponde a ninguna persona real
  registrationStatus: 'active',
  paymentProvider: 'mercadopago',
  plan: {
    name: 'COMBO_PROMO',
    displayName: 'Combo Beta',
  },
  bitacoraEnabled: true,
  markdownEnabled: true,
  usage: {
    proc: { usado: 6, limite: 50 },
    batch: { usado: 2, limite: 20 },
    informe: { usado: 4, limite: 50 },
    monitor_novedades: { usado: 5, limite: 50 },
    monitor_partes: { usado: 2, limite: 20 },
  },
  // Para la capa de sustitución de Electron (login + chip) — ver
  // demo-anonimizar.js. deviceId es un valor cualquiera con la FORMA de un
  // machineId real (hash hex), nunca uno real de una máquina del operador.
  loginEmail: 'demo@procuradortool.com',
  deviceIdDemo: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
};

module.exports = { CUENTA_DEMO };
