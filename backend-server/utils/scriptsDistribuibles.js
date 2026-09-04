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
 * E14 (C.1 capa 3): acá vive `scriptsPermitidos(sub)`, que decide por plan cuál de
 * estos 13 se entrega. `SCRIPTS_DISTRIBUIBLES` sigue siendo la lista maestra — es el
 * universo de lo entregable y lo que `processScripts` usa para decidir qué ofuscar —,
 * pero los tres endpoints de `routes/client.js` ya no la consultan directo.
 */

const SCRIPTS_DISTRIBUIBLES = new Set([
    'testM1.js', 'testM2.js',
    'consultarscwpjn.js', 'listarSCWPJN.js',
    'procesarNovedadesCompleto.js', 'procesarCustomExpedientes.js',
    'informequickscwpjn.js', 'procesarMonitoreo.js',
    'sessionManager.js', 'errorHandler.js', 'cerrarNavegador.js', 'monitoreo.js',
    'buscarPorParteScwpjn.js',
]);


// ─── E14 (C.1 capa 3): qué recibe cada plan ─────────────────────────────────────
//
// EL AGUJERO QUE CIERRA
// ---------------------
// Hasta E14 la whitelist era GLOBAL: cualquier suscripción viva bajaba los 13. Un
// usuario de EXTENSION_PROMO —que paga 1500 por los 5 flujos de la extensión Chrome y
// tiene los cinco límites de ejecución de la app en 0 (`scripts/insert_plans.sql`)—
// se llevaba el motor Puppeteer completo igual que un COMBO_PROMO de 15000.
//
// LA TABLA (spec C.1 capa 3, decidida por el operador el 2026-09-03)
// ------------------------------------------------------------------
//   Trial (`payment_provider IS NULL`)      → los 13   "el trial prueba el producto completo"
//   `plan_type` 'combo' / 'electron'        → los 13   es el producto que compraron
//   `plan_type` 'extension'                 → ninguno  compraron la extensión, no la app
//   Sin suscripción viva                    → ninguno  ya lo corta el chequeo de expires_at/status
//
// EL ORDEN DE LAS DOS PREGUNTAS IMPORTA, Y NO ES INTERCAMBIABLE
// -------------------------------------------------------------
// Se mira `payment_provider` ANTES que `plan_type`, porque la primera fila de la tabla
// está keyeada por trial, no por plan. Un trial que se registró eligiendo
// EXTENSION_PROMO tiene `plan_id` poblado (`routes/auth.js:238-243` lo inserta SIEMPRE,
// con el id del plan elegido) y por lo tanto `plan_type = 'extension'`. Si se preguntara
// primero por el plan, ese trial quedaría sin un solo script y su app de escritorio
// arrancaría rota — justo lo contrario de la decisión registrada. La exposición que
// esto deja (registrarse gratis y llevarse los 13) es la MISMA que la spec ya acepta
// por escrito para cualquier trial: "el cupo del servidor (B.8) limita el uso, no la
// extracción".
//
// SOBRE `HELPERS_SIEMPRE`
// -----------------------
// La regla de la spec es de CLAUSURA — "un script entregado arrastra sus helpers; nunca
// entregar un script sin sus dependencias"—, no un piso incondicional. Con la partición
// binaria de hoy (todos o ninguno) los tres helpers ya viven dentro de la lista maestra,
// así que la función es un no-op; existe para que una partición futura por módulo no se
// olvide de arrastrarlos. Aplicarla como piso incondicional entregaría 3 scripts del
// motor a una cuenta `extension`, que no puede ejecutar ninguno, y rompería el criterio
// de cierre de la ficha ("download de cualquiera de los 13 da 404").
const HELPERS_SIEMPRE = Object.freeze([
    'sessionManager.js', 'errorHandler.js', 'cerrarNavegador.js',
]);

// Congelado y compartido: `conHelpers` nunca lo muta (copia antes de agregar).
const SIN_SCRIPTS = Object.freeze(new Set());

/**
 * Clausura de dependencias. Devuelve un Set NUEVO cuando hay algo que entregar, para
 * que ningún llamador pueda mutar `SCRIPTS_DISTRIBUIBLES` por accidente.
 */
function conHelpers(base) {
    if (base.size === 0) return base;   // nada entregado → nada que arrastrar
    const out = new Set(base);
    for (const h of HELPERS_SIEMPRE) out.add(h);
    return out;
}

/**
 * @param {object|undefined} sub  fila de `subscriptions` con `payment_provider` y, del
 *                                LEFT JOIN a `plans`, `plan_type` (puede venir NULL).
 * @returns {Set<string>} nombres normalizados (con `.js`) que este usuario puede bajar.
 */
function scriptsPermitidos(sub) {
    // Sin fila de suscripción no hay nada que entregar. En los tres endpoints esto ya
    // se cortó antes con un 403; acá es fail-closed por si alguna vez se llama suelto.
    if (!sub) return SIN_SCRIPTS;

    // Fila 1 de la tabla: el trial prueba el producto completo, sea cual sea su plan.
    const estaPagando = Boolean(sub.payment_provider);
    if (!estaPagando) return conHelpers(SCRIPTS_DISTRIBUIBLES);

    // Filas 2 y 3: ya paga, decide el tipo de plan. Único valor que niega: 'extension'.
    // `plan_type` puede llegar NULL (LEFT JOIN sin plan, o dato viejo): eso NO niega —
    // el `CHECK` de `schema.sql:940` solo admite electron/extension/combo, y las otras
    // dos filas de la tabla entregan los 13.
    const planType = sub.plan_type == null ? null : String(sub.plan_type).trim().toLowerCase();
    if (planType === 'extension') return SIN_SCRIPTS;

    return conHelpers(SCRIPTS_DISTRIBUIBLES);
}

module.exports = { SCRIPTS_DISTRIBUIBLES, HELPERS_SIEMPRE, scriptsPermitidos };

