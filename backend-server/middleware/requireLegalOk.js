/**
 * requireLegalOk.js — gate de suspensión por términos no aceptados (B.7, fase E5).
 *
 * Cierra la mitad que faltaba de la política legal: hasta ahora el email de
 * publicación decía "tu acceso quedará suspendido" y NADA suspendía a nadie
 * (`users.legal_suspended` existía y nunca se ponía en true). El job diario de
 * `server.js` la pone; este middleware es lo que la hace valer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ REGLA CENTRAL — el suspendido puede LOGUEARSE, no puede OPERAR
 * ═══════════════════════════════════════════════════════════════════════════
 * La pantalla de aceptación (`/legal/accept/`) necesita el token del usuario para
 * llamar a `/legal/pending` y `/legal/accept`. Si el login lo bloqueara, el
 * suspendido no tendría NINGUNA forma de dejar de estarlo: la suspensión sería
 * permanente y solo destrabable a mano por un admin.
 *
 * Por eso este middleware va SOLO sobre lo que es "operar":
 *   · POST /license/execution/start
 *   · GET  /client/scripts/download/:name  ·  GET /client/scripts/check/:name
 *   · escrituras de Bitácora (POST/PUT/DELETE de los sub-routers)
 *
 * ⛔ Lo que NUNCA debe alcanzar: `/auth/*`, `/legal/*`, `/client/account`,
 * `/client/verify-session` y los GET de lectura del portal. Montarlo global
 * junto a `authenticateToken` bloquearía la propia página de aceptación.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  FAIL-OPEN A PROPÓSITO
 * ═══════════════════════════════════════════════════════════════════════════
 * Esto NO es un control de seguridad: es un mecanismo de negocio (cobrar el
 * cumplimiento de una política contractual). El costo de los dos errores es
 * asimétrico y por goleada:
 *   · falso negativo → un usuario opera un día más sin haber aceptado. Nadie se
 *     entera, se corrige al día siguiente.
 *   · falso positivo → `/license/execution/start` es el candado por el que pasa
 *     TODA ejecución del producto. Un 403 de más ahí no degrada nada: apaga el
 *     producto entero, para todos, hasta el próximo deploy.
 *
 * Por eso, ante CUALQUIER duda se deja pasar y se loguea:
 *   · error de base            → next()   (no 500, no 403)
 *   · usuario inexistente      → next()
 *   · `legal_suspended` NULL   → next()   (la columna no es NOT NULL; NULL ≠ true)
 * Solo el valor `true` explícito bloquea.
 *
 * Nótese el contraste deliberado con `checkBitacoraPlan`, que ante la ausencia de
 * `req.user` falla CERRADO (401): ese gate protege datos de un módulo; este
 * solo aplica un plazo administrativo.
 */

const logger = require('../utils/logger');

const MSG_SUSPENDIDO =
    'Tenés términos y condiciones pendientes de aceptar. ' +
    'Tu acceso está suspendido hasta que los aceptes.';

// Métodos que se consideran "lectura" y nunca se bloquean cuando el middleware se
// monta con { soloEscrituras: true }. Se usa así en Bitácora: el suspendido puede
// seguir leyendo y exportando lo suyo (sus datos no dejan de ser suyos), pero no
// puede agregar nada nuevo.
const METODOS_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @param {Object}  [opciones]
 * @param {boolean} [opciones.soloEscrituras=false] - Si true, deja pasar
 *        GET/HEAD/OPTIONS sin siquiera consultar la base. Pensado para montarlo
 *        sobre un `router.use()` que mezcla lectura y escritura (Bitácora) sin
 *        tener que tocar las 12 definiciones de ruta una por una, que es
 *        justamente donde se escondería un olvido.
 * @returns {Function} middleware de Express (requiere `authenticateToken` antes)
 */
function requireLegalOk(opciones = {}) {
    const { soloEscrituras = false } = opciones;

    return async function gateLegal(req, res, next) {
        if (soloEscrituras && METODOS_LECTURA.has(req.method)) return next();

        const userId = req.user?.id;
        // Sin usuario no hay a quién consultar. authenticateToken corre antes, así
        // que esto no debería pasar; si el orden se rompiera, dejar pasar (el gate
        // de autenticación real es el otro middleware, no éste).
        if (!userId) return next();

        try {
            const db = req.app.get('db');
            const { rows } = await db.query(
                'SELECT legal_suspended FROM users WHERE id = $1',
                [userId]
            );

            if (rows[0]?.legal_suspended === true) {
                return res.status(403).json({
                    success: false,
                    error:  MSG_SUSPENDIDO,
                    action: 'accept_terms',
                    url:    '/legal/accept/'
                });
            }

            return next();
        } catch (e) {
            // Ver "FAIL-OPEN A PROPÓSITO" arriba: si la base falla, el producto sigue
            // funcionando. Se loguea con nivel warn para que quede rastro sin
            // ensuciar el log de errores con algo que no rompió nada.
            logger.warn(`[B.7] requireLegalOk: no se pudo verificar user=${userId}, se deja pasar: ${e.message}`);
            return next();
        }
    };
}

module.exports = requireLegalOk;
