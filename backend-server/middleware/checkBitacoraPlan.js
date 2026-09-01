/**
 * checkBitacoraPlan.js — gate de plan del módulo Bitácora (F1.2).
 *
 * Es **el freno real** del módulo: el portal puede ocultar el menú y la app puede
 * no mostrar la botonera, pero lo que efectivamente impide el acceso es este 403.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ DÓNDE SE MONTA — leer antes de usarlo (punto crítico P1 del plan)
 * ═══════════════════════════════════════════════════════════════════════════
 * Este middleware **NUNCA** debe montarse a nivel de `routes/usuarios.js` ni de
 * ninguna ruta que no sea de Bitácora. Ese archivo tiene 8 rutas vivas del portal
 * (`/profile`, `/password`, `/plans`, `/ai-chat`, `/payments`, `/invoices`,
 * `/invoices/:id/pdf`, `/subscription/current`): si el gate las alcanzara, todo
 * usuario cuyo plan no incluya la Bitácora se quedaría sin poder ver sus facturas
 * ni cambiar su contraseña, con un mensaje que además confunde.
 *
 * Por eso `routes/bitacora.js` lo aplica sobre **sub-paths específicos**
 * (`/bitacora`, `/expedientes`, `/feriados`) y no sobre el router entero.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA VENTANA DE GRACIA (decisión D2 / Q6)
 * ═══════════════════════════════════════════════════════════════════════════
 * Al bajar a un plan sin Bitácora, el usuario conserva **90 días** para exportar
 * sus datos. Es la diferencia entre "perdí una feature" y "perdí mis datos".
 *
 * La ventana se apoya en `users.bitacora_lost_access_at`, que estampa el proceso
 * que cambia de plan. **Solo la exportación** usa la variante con gracia:
 *
 *     router.use('/bitacora',        checkBitacoraPlan());                        // 403 duro
 *     router.get('/bitacora/export', checkBitacoraPlan({ conGracia: true }), ...) // + 90 días
 *
 * El endpoint de exportación se construye en F1.6; la opción existe desde ahora
 * para que el gate no haya que rediseñarlo entonces.
 */

const DIAS_GRACIA_EXPORT = 90;

const MSG_SIN_PLAN =
    'Tu plan no incluye el módulo Bitácora. Consultá los planes disponibles en tu portal.';
const MSG_GRACIA_VENCIDA =
    `El período de ${DIAS_GRACIA_EXPORT} días para exportar tu Bitácora ya venció. ` +
    'Contactá a soporte si necesitás recuperar tus datos.';
const MSG_CUENTA_NO_ELEGIBLE =
    'Tu cuenta no tiene acceso al módulo Bitácora en este momento.';

// S2 (Etapa 3, 2026-09-01): estados que NUNCA deben tener acceso al módulo, sin
// importar lo que diga plans.bitacora_enabled — MISMA lista que `blockedStatuses`
// de /auth/login (routes/auth.js), reutilizada acá tal cual en vez de inventar una
// política nueva. Antes de este fix, este gate solo miraba plans.bitacora_enabled
// vía el JOIN con subscriptions/plans y NUNCA leía users.registration_status ni
// subscriptions.status — así que una cuenta `rejected`/`suspended_admin`/
// `suspended_plan_expired`/`cancelled` conservaba acceso COMPLETO (lectura Y
// escritura, no solo exportación) mientras el JWT siguiera vivo. Y no era un caso
// de "token viejo que todavía no venció": `/auth/portal-login` bloquea SOLO
// `rejected` al loguearse (a propósito — `cancelled`/`suspended_admin` pueden
// entrar al portal para ver facturas o volver a suscribirse), así que una cuenta
// suspendida por el admin podía loguearse de nuevo en cualquier momento, sacar un
// token de 8h fresco, y usarlo íntegro contra Bitácora — sin relación con cuánto
// hacía que fue suspendida. `pending_email` se incluye porque nunca verificó el
// correo: no hay ninguna razón para que toque datos reales.
// Deliberadamente AFUERA de esta lista: `suspended` (gracia de pago, service
// continúa por diseño) y `pending_activation` (trial — algunos planes de prueba
// pueden traer el flag encendido, y bloquearlo ahí sería un cambio de alcance no
// pedido por este hallazgo).
const ESTADOS_BLOQUEADOS = ['pending_email', 'rejected', 'suspended_admin', 'suspended_plan_expired', 'cancelled'];

/**
 * @param {Object}  [opciones]
 * @param {boolean} [opciones.conGracia=false] - Si true, además de habilitar el
 *        acceso con el plan vigente, lo permite durante los 90 días posteriores
 *        a haber perdido el flag. Usar SOLO en exportación.
 * @returns {Function} middleware de Express (requiere `authenticateToken` antes)
 */
function checkBitacoraPlan(opciones = {}) {
    const { conGracia = false } = opciones;

    return async function gateBitacora(req, res, next) {
        const db = req.app.get('db');
        const userId = req.user?.id;

        if (!userId) {
            // No debería pasar (authenticateToken corre antes), pero si el orden de
            // middlewares se rompiera, fallar cerrado y no abierto.
            return res.status(401).json({ error: 'No autenticado' });
        }

        try {
            const { rows } = await db.query(
                `SELECT u.registration_status, p.bitacora_enabled, u.bitacora_lost_access_at
                   FROM users u
                   LEFT JOIN subscriptions s ON s.user_id = u.id
                   LEFT JOIN plans p         ON p.id      = s.plan_id
                  WHERE u.id = $1`,
                [userId]
            );

            // S2: fail-closed también contra un estado bloqueado, ANTES de mirar el flag
            // del plan y ANTES de la ventana de gracia — una cuenta rechazada/suspendida
            // por el admin/cancelada no debe recibir ni el acceso normal ni la gracia de
            // exportación (esa gracia es para "perdí el plan", no para "me expulsaron").
            if (rows.length > 0 && ESTADOS_BLOQUEADOS.includes(rows[0].registration_status)) {
                return res.status(403).json({ error: MSG_CUENTA_NO_ELEGIBLE, code: 'BITACORA_CUENTA_NO_ELEGIBLE' });
            }

            // Sin fila = usuario inexistente; sin suscripción o sin plan, el LEFT JOIN
            // deja `bitacora_enabled` en NULL → falsy → sin acceso. Correcto.
            const habilitado = rows.length > 0 && rows[0].bitacora_enabled === true;

            if (habilitado) {
                return next();
            }

            if (conGracia && rows.length > 0 && rows[0].bitacora_lost_access_at) {
                const perdidoEl = new Date(rows[0].bitacora_lost_access_at);
                const diasTranscurridos = (Date.now() - perdidoEl.getTime()) / 86400000;

                if (diasTranscurridos <= DIAS_GRACIA_EXPORT) {
                    req.bitacoraEnGracia = true;   // por si el handler quiere avisarlo en la respuesta
                    return next();
                }
                return res.status(403).json({ error: MSG_GRACIA_VENCIDA, code: 'BITACORA_GRACIA_VENCIDA' });
            }

            return res.status(403).json({ error: MSG_SIN_PLAN, code: 'BITACORA_NO_INCLUIDA' });

        } catch (error) {
            console.error('Error verificando plan de Bitácora:', error);
            // Fail-closed: si no se puede determinar el plan, no se concede acceso.
            return res.status(500).json({ error: 'Error del servidor' });
        }
    };
}

module.exports = { checkBitacoraPlan, DIAS_GRACIA_EXPORT };
