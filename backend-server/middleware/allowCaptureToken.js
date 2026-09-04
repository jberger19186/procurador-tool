/**
 * allowCaptureToken.js — habilitador explícito de la llave de captura (B.3-A).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ ES Y POR QUÉ EXISTE COMO MIDDLEWARE APARTE
 * ═══════════════════════════════════════════════════════════════════════════
 * La llave de captura es un JWT de 30 minutos con `scope: 'capture'` que emite
 * `POST /client/bitacora/capture-token` y que viaja embebida en el visor. Está
 * firmada con el MISMO `JWT_SECRET` que las sesiones normales (ver la nota en
 * ese endpoint: un secreto propio la volvería irreconocible para
 * `authenticateToken`, que hace un único `jwt.verify`). Entonces, lo único que
 * impide que sea "una sesión de 30 minutos con otro nombre" es que
 * `authenticateToken` la RECHACE en todos los endpoints salvo donde se la
 * habilite explícitamente.
 *
 * El control está invertido a propósito: `authenticateToken` rechaza por
 * defecto, y este middleware —que se monta ANTES que él, solo en
 * `GET /usuarios/api/capture-draft/:id`— es lo único que levanta el permiso.
 *
 *   ✅ router.get('/capture-draft/:id', allowCaptureToken, authenticateToken, ...)
 *
 * ⛔ Lo que NO hay que hacer nunca: resolver esto comparando `req.path` dentro
 * de `authenticateToken`. Dentro de un router montado, `req.path` es RELATIVO
 * al montaje (`bitacora.js` cuelga de `/usuarios/api`), así que la misma
 * subruta puede existir bajo dos montajes distintos y la comparación se vuelve
 * ambigua. Peor: si mañana alguien agrega un endpoint nuevo, una allowlist por
 * path falla del lado INSEGURO solo si el path coincide por casualidad, pero
 * una allowlist por bandera falla siempre del lado seguro (el endpoint nuevo
 * simplemente no acepta la llave, que es lo correcto).
 */

// La bandera es un SÍMBOLO, no una propiedad con nombre. Motivo: `req` es un
// objeto que atraviesa parsers de body y de query; una propiedad llamada
// `allowCaptureToken` sería alcanzable por polución de prototipo (`Object.
// prototype.allowCaptureToken = true`) y eso convertiría el rechazo global en un
// permiso global. Un símbolo no se puede fijar desde una cadena de entrada.
const CAPTURE_ALLOWED = Symbol('capture.token.allowed');

function allowCaptureToken(req, _res, next) {
    req[CAPTURE_ALLOWED] = true;
    next();
}

module.exports = allowCaptureToken;
module.exports.CAPTURE_ALLOWED = CAPTURE_ALLOWED;
