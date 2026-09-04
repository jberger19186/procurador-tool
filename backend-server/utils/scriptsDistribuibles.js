/**
 * Lista canónica de los scripts que se entregan al cliente Electron.
 *
 * POR QUÉ EXISTE ESTE MÓDULO (fase E9)
 * ------------------------------------
 * La lista nació dentro de `routes/client.js` (A.1, hallazgo E5-1/P-1) para que el
 * endpoint de descarga no sirviera los scripts de operación del servidor. Con C.1 capa 1
 * la necesita también `utils/scriptEncryption.js`, que decide qué ofuscar al procesar el
 * directorio `scripts/`.
 *
 * Se extrajo a un módulo propio en vez de copiarla: `routes/client.js` ya hace
 * `require('../utils/scriptEncryption')`, así que la dependencia inversa habría sido un
 * ciclo. Y una segunda copia se desincroniza — el proyecto tiene el antecedente de
 * `VERIF_FLUJOS_ORDEN` duplicado entre backend y dashboard, y el de la búsqueda de PDF
 * duplicada entre `generador_visor.js` y `generador_excel.js`; las dos produjeron bugs
 * reales.
 *
 * La lista espeja el mapa `dependencies` de electron-app/src/auth/authManager.js
 * (scripts principales + sus dependencias). No es una lista nueva.
 *
 * NOTA PARA E14 (C.1 capa 3): acá es donde va a vivir `scriptsPermitidos(sub)`, que
 * reemplaza esta lista global por una por plan (`combo`/`electron` → los 13,
 * `extension` → ninguno, más los helpers que siempre viajan). Hoy sigue siendo global.
 */

const SCRIPTS_DISTRIBUIBLES = new Set([
    'testM1.js', 'testM2.js',
    'consultarscwpjn.js', 'listarSCWPJN.js',
    'procesarNovedadesCompleto.js', 'procesarCustomExpedientes.js',
    'informequickscwpjn.js', 'procesarMonitoreo.js',
    'sessionManager.js', 'errorHandler.js', 'cerrarNavegador.js', 'monitoreo.js',
    'buscarPorParteScwpjn.js',
]);

module.exports = { SCRIPTS_DISTRIBUIBLES };
