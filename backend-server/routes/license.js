const express = require('express');
const router  = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
// B.7 (fase E5): gate de suspensión por términos no aceptados. Va sobre `start`
// porque es el candado por el que pasa TODA ejecución. Es fail-open a propósito:
// ver el encabezado del middleware.
const requireLegalOk = require('../middleware/requireLegalOk');
// B.8 (fase E7): mapa único script → subsistema. El subsistema lo decide el
// SERVIDOR a partir del nombre del script; nunca llega del cuerpo del request.
const { isKnownScript, subsystemForScript, usageColumnFor, subsystemLabel } = require('../utils/subsystems');

const TTL_MINUTES = 5;
const HEARTBEAT_INTERVAL_S = 30;

// ─── POST /license/execution/start ────────────────────────────────────────────
// Adquiere el lock de ejecución para el dispositivo actual Y descuenta el cupo.
// Rechaza si hay una ejecución activa en otro dispositivo o si no queda cupo.
//
// ═══════════════════════════════════════════════════════════════════════════════
//  B.8 (fase E7) — ACÁ SE DESCUENTA EL CUPO, no en log-execution
// ═══════════════════════════════════════════════════════════════════════════════
// Antes de E7 el cupo por subsistema lo descontaba `POST /client/scripts/log-
// execution`, a partir de dos campos que manda la aplicación instalada en la
// máquina del usuario: `success` y `subsystem`. Un cliente modificado que no
// reporta —o que reporta `success:false`— no consumía nada. Ahora el cupo se
// cobra al ENTREGAR EL PERMISO: si el servidor no descuenta, no hay permiso, y
// sin permiso el flujo del cliente ya cortaba antes de ejecutar (`main.js`
// vuelve temprano cuando `acquireExecutionLock` falla — vale también para los
// clientes ya instalados, que no necesitan cambio alguno para respetar esto).
//
// Sin reembolso: una ejecución que falla a los 2 segundos consume igual. Es la
// única forma de que "fallar" no sea una manera gratis de no gastar cupo. El
// reembolso, si hace falta, es una acción de admin (`apply-benefit`).
//
// ⚠️ ALCANCE REAL, medido en `electron-app/main.js` el 2026-09-04: hoy pasan por
// acá `procesarNovedadesCompleto.js` (proc), `procesarCustomExpedientes.js`
// (batch) y `listarSCWPJN.js` (sin cupo por subsistema). `run-informe` y
// `run-monitoreo` NO piden permiso: llaman a `executeRemoteScriptAsLocal`
// directo. Por eso `log-execution` y `/monitor/log` CONSERVAN su camino de
// conteo — quitarlo dejaría informes y monitoreo sin cupo, gratis e ilimitados,
// hasta el release de cliente de E8. `quota_counted` es lo que garantiza que,
// cuando E8 haga pasar esos dos flujos por acá, no se cuente dos veces.
router.post('/execution/start', authenticateToken, requireLegalOk(), async (req, res) => {
    const db       = req.app.get('db');
    const userId   = req.user.id;
    // ⚠️ `scriptName` en camelCase: es el campo del cuerpo del request.
    // `script_name` es la COLUMNA de la base. Confundirlos deja al producto
    // entero sin poder ejecutar (el mapa no resuelve → 400 en todo).
    const { machineId, scriptName } = req.body;

    if (!machineId) {
        return res.status(400).json({ success: false, error: 'machineId requerido' });
    }

    // B.8: el permiso solo se entrega para scripts que el servidor conoce. Un
    // nombre arbitrario no puede pedir ejecución (y no podría resolver a ningún
    // subsistema, con lo cual el cupo quedaría sin cobrar).
    if (!isKnownScript(scriptName)) {
        return res.status(400).json({
            success: false,
            code:    'UNKNOWN_SCRIPT',
            error:   'Script no reconocido por el servidor.'
        });
    }
    const subsystem = subsystemForScript(scriptName);
    const usageCol  = usageColumnFor(subsystem);

    try {
        // SEC-4/M2: enforcement del trial ANTES de ejecutar. El trial (payment_provider
        // IS NULL) tiene 20 usos globales compartidos. El pre-check del cliente no es
        // confiable (un cliente adulterado podría saltearlo) y log-execution corre DESPUÉS
        // de la ejecución. Este gate —por el que pasa TODA ejecución— frena antes de correr.
        const subRes = await db.query(
            `SELECT s.payment_provider, s.usage_count, s.usage_limit, u.machine_id
             FROM subscriptions s JOIN users u ON u.id = s.user_id
             WHERE s.user_id = $1`,
            [userId]
        );
        const sub = subRes.rows[0];
        if (sub && !sub.payment_provider && sub.usage_count >= sub.usage_limit) {
            return res.status(403).json({
                success: false,
                code:    'TRIAL_EXHAUSTED',
                error:   'Agotaste tus usos de prueba. Contactá al administrador para activar tu cuenta.'
            });
        }

        // AUTH-1: verificar el binding de dispositivo. El login guarda users.machine_id
        // (server-side, no en el token) al iniciar sesión. Acá se exige que el machineId
        // del request coincida → un token robado no sirve desde otro equipo (el atacante
        // no conoce el machineId vinculado, que no viaja en el token). Si machine_id es
        // NULL (sesión legada previa a este cambio, o desvinculado por el admin), se
        // vincula al primer uso. Si difiere → 403. El cliente legítimo siempre manda el
        // machineId de su hardware, que coincide con el vinculado en su login.
        //
        // Va FUERA de la transacción de abajo a propósito: el binding al primer uso debe
        // persistir aunque el permiso termine rechazado por candado ajeno.
        if (sub) {
            if (!sub.machine_id) {
                await db.query('UPDATE users SET machine_id = $1 WHERE id = $2', [machineId, userId]);
            } else if (sub.machine_id !== machineId) {
                // T1 (plan-pruebas-post-v2.7.38.md): sin este log, un DEVICE_MISMATCH
                // real no deja rastro (no hay logger de acceso HTTP en server.js) —
                // imposible auditar reportes de usuarios bloqueados sin él.
                require('../utils/logger').warn(
                    `[AUTH-1] DEVICE_MISMATCH user=${userId} bound=${sub.machine_id} request=${machineId}`
                );
                return res.status(403).json({
                    success: false,
                    code:    'DEVICE_MISMATCH',
                    error:   'Esta sesión no corresponde a tu dispositivo registrado. Iniciá sesión de nuevo desde este equipo.'
                });
            }
        }

        // ── Cupo + candado, en UNA transacción ────────────────────────────────
        // El descuento va ANTES del candado (spec § B.8), pero dentro de la misma
        // transacción: si el candado lo tiene otro dispositivo (409), el ROLLBACK
        // devuelve el cupo. Sin la transacción, un usuario que aprieta "Procurar"
        // mientras otra máquina suya está corriendo perdería una unidad sin haber
        // ejecutado nada — y B.8 prohíbe los reembolsos automáticos, así que esa
        // unidad no se recuperaría nunca.
        //
        // Orden de bloqueo dentro de la transacción: primero la fila de
        // `subscriptions` del usuario, después la de `active_executions` del mismo
        // usuario. Es el mismo orden en todas las ejecuciones concurrentes, así que
        // dos `start` simultáneos se serializan (el segundo espera al COMMIT del
        // primero) sin posibilidad de deadlock.
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Límites del plan + bonus. Es config estática: esta lectura NO es la
            // protección contra carreras — la protección es la guarda `AND col < $2`
            // del UPDATE de más abajo, que PostgreSQL reevalúa sobre la última
            // versión commiteada de la fila. Misma consulta que usaba log-execution,
            // para no cambiar qué cuentas se consideran habilitadas.
            const planRes = await client.query(`
                SELECT s.*, p.proc_executions_limit, p.informe_limit, p.monitor_novedades_limit,
                       p.batch_executions_limit,
                       u.registration_status
                FROM subscriptions s
                LEFT JOIN plans p ON s.plan_id = p.id
                JOIN users u ON u.id = s.user_id
                WHERE s.user_id = $1 AND s.expires_at > NOW()
                  AND (
                    s.status = 'active'
                    OR (s.status = 'suspended' AND u.registration_status = 'pending_activation')
                  )
            `, [userId]);

            if (planRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    code:    'NO_SUBSCRIPTION',
                    error:   'No tienes una suscripción activa'
                });
            }
            const plan = planRes.rows[0];

            // Guarda del trial dentro del UPDATE. El límite real de una cuenta de
            // prueba es el contador GLOBAL (20 usos compartidos), no el del
            // subsistema: sin este trozo, un trial en 20/20 pasaría la guarda de
            // subsistema (proc < 50) y ejecutaría igual.
            const trialGuard = 'AND (s.payment_provider IS NOT NULL OR s.usage_count < s.usage_limit)';

            let updRes;
            let effectiveLimit = null;

            if (usageCol) {
                const limitVal = {
                    'proc_usage':              plan.proc_executions_limit,
                    'batch_usage':             plan.batch_executions_limit,
                    'informe_usage':           plan.informe_limit,
                    'monitor_novedades_usage': plan.monitor_novedades_limit
                }[usageCol];
                const bonusVal = {
                    'proc_usage':              plan.proc_bonus || 0,
                    'batch_usage':             plan.batch_bonus || 0,
                    'informe_usage':           plan.informe_bonus || 0,
                    'monitor_novedades_usage': plan.monitor_novedades_bonus || 0
                }[usageCol];
                // -1, NULL y undefined significan "sin límite" (mismo criterio que
                // log-execution; undefined aparece si la suscripción no tiene plan_id
                // y el LEFT JOIN no trajo fila de `plans`).
                effectiveLimit = (limitVal === -1 || limitVal === null || limitVal === undefined)
                    ? null
                    : (limitVal + bonusVal);

                // effectiveLimit YA incluye el bonus, así que se compara el uso CRUDO
                // contra él. Sumar el bonus también del lado izquierdo lo cancelaba
                // algebraicamente y bloqueaba en el límite base (bug C1, ya corregido
                // en log-execution: se conserva el criterio bueno).
                const limitClause = effectiveLimit !== null ? `AND COALESCE(s.${usageCol}, 0) < $2` : '';
                updRes = await client.query(`
                    UPDATE subscriptions s
                    SET ${usageCol} = COALESCE(s.${usageCol}, 0) + 1,
                        usage_count = s.usage_count + 1
                    WHERE s.user_id = $1
                      AND s.expires_at > NOW()
                      ${limitClause}
                      ${trialGuard}
                    RETURNING s.${usageCol} AS nuevo_uso, s.usage_count, s.usage_limit
                `, effectiveLimit !== null ? [userId, effectiveLimit] : [userId]);
            } else {
                // Scripts sin subsistema de cupo (listarSCWPJN.js y las librerías):
                // solo suben el contador global, igual que hacía la rama de
                // compatibilidad de log-execution.
                updRes = await client.query(`
                    UPDATE subscriptions s
                    SET usage_count = s.usage_count + 1
                    WHERE s.user_id = $1
                      AND s.expires_at > NOW()
                      ${trialGuard}
                    RETURNING s.usage_count, s.usage_limit
                `, [userId]);
            }

            if (updRes.rows.length === 0) {
                await client.query('ROLLBACK');
                // Distinguir el motivo real para no mostrar "límite de procuraciones"
                // a alguien que en verdad agotó su prueba gratuita.
                const trialAgotado = !plan.payment_provider && plan.usage_count >= plan.usage_limit;
                if (trialAgotado) {
                    return res.status(403).json({
                        success: false,
                        code:    'TRIAL_EXHAUSTED',
                        error:   'Agotaste tus usos de prueba. Contactá al administrador para activar tu cuenta.'
                    });
                }
                // Mismo shape que el 403 histórico de log-execution (`error` +
                // `action:'upgrade'`): el cliente ya instalado lo entiende sin cambios.
                return res.status(403).json({
                    success:   false,
                    code:      'QUOTA_EXCEEDED',
                    error:     `Has alcanzado el límite de ${subsystemLabel(subsystem)}`,
                    action:    'upgrade',
                    subsystem: subsystem || null
                });
            }

            // 1. Limpiar locks expirados de todos los usuarios
            await client.query('DELETE FROM active_executions WHERE expires_at < NOW()');

            // 2. M3: adquisición ATÓMICA del lock. Antes el SELECT y el upsert eran pasos
            //    separados (TOCTOU): dos dispositivos podían pasar el SELECT y ambos upsertear,
            //    corriendo a la vez. Ahora el INSERT ... ON CONFLICT DO UPDATE solo renueva si
            //    el lock vivo es del MISMO dispositivo (WHERE machine_id = EXCLUDED.machine_id);
            //    si otro dispositivo lo tiene, 0 filas → 409. Es una sola sentencia atómica.
            const lock = await client.query(`
                INSERT INTO active_executions
                    (user_id, machine_id, script_name, subsystem, quota_counted, started_at, last_heartbeat, expires_at)
                VALUES
                    ($1, $2, $3, $4, true, NOW(), NOW(), NOW() + INTERVAL '${TTL_MINUTES} minutes')
                ON CONFLICT (user_id) DO UPDATE SET
                    machine_id     = EXCLUDED.machine_id,
                    script_name    = EXCLUDED.script_name,
                    subsystem      = EXCLUDED.subsystem,
                    quota_counted  = true,
                    outcome        = NULL,
                    started_at     = NOW(),
                    last_heartbeat = NOW(),
                    expires_at     = NOW() + INTERVAL '${TTL_MINUTES} minutes'
                WHERE active_executions.machine_id = EXCLUDED.machine_id
                RETURNING id
            `, [userId, machineId, scriptName, subsystem]);

            if (lock.rows.length === 0) {
                // Candado en otro dispositivo: se devuelve el cupo descontado arriba.
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    code:    'DEVICE_LOCKED',
                    error:   `Hay una ejecución en curso en otro dispositivo. Esperá a que finalice o aguardá ${TTL_MINUTES} minutos.`
                });
            }

            await client.query('COMMIT');

            const row = updRes.rows[0];
            const remaining = usageCol
                ? (effectiveLimit !== null ? Math.max(0, effectiveLimit - Number(row.nuevo_uso || 0)) : null)
                : Math.max(0, Number(row.usage_limit || 0) - Number(row.usage_count || 0));

            return res.json({
                success:            true,
                executionId:        lock.rows[0].id,
                subsystem:          subsystem || null,
                remaining,
                heartbeatIntervalS: HEARTBEAT_INTERVAL_S,
                ttlMinutes:         TTL_MINUTES
            });

        } catch (txErr) {
            try { await client.query('ROLLBACK'); } catch (_) { /* la conexión ya puede estar rota */ }
            throw txErr;
        } finally {
            client.release();
        }

    } catch (err) {
        console.error('[License] Error adquiriendo lock:', err);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// ─── POST /license/execution/heartbeat ────────────────────────────────────────
// Renueva el TTL del lock mientras la ejecución está en curso.
// El cliente debe llamar a este endpoint cada ~30 segundos.
router.post('/execution/heartbeat', authenticateToken, async (req, res) => {
    const db      = req.app.get('db');
    const userId  = req.user.id;
    const { machineId } = req.body;

    if (!machineId) {
        return res.status(400).json({ success: false, error: 'machineId requerido' });
    }

    try {
        const result = await db.query(`
            UPDATE active_executions
            SET last_heartbeat = NOW(),
                expires_at     = NOW() + INTERVAL '${TTL_MINUTES} minutes'
            WHERE user_id = $1 AND machine_id = $2
            RETURNING id
        `, [userId, machineId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error:   'Lock no encontrado. Es posible que haya expirado.'
            });
        }

        return res.json({ success: true });

    } catch (err) {
        console.error('[License] Error en heartbeat:', err);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// ─── POST /license/execution/end ──────────────────────────────────────────────
// Libera el lock al finalizar la ejecución (normal o por detención manual).
//
// B.8: acepta `executionId` y `outcome` opcionales (los manda el cliente nuevo
// de E8; los ya instalados no los mandan y siguen funcionando igual). NO
// devuelven cupo: el permiso ya se cobró en `start`, y un `outcome:'error'` que
// reembolsara reabriría exactamente el agujero que B.8 cierra.
router.post('/execution/end', authenticateToken, async (req, res) => {
    const db      = req.app.get('db');
    const userId  = req.user.id;
    const { machineId, executionId, outcome } = req.body;

    if (!machineId) {
        return res.status(400).json({ success: false, error: 'machineId requerido' });
    }

    const execId = Number.isInteger(executionId)
        ? executionId
        : (/^\d{1,12}$/.test(String(executionId ?? '')) ? Number(executionId) : null);

    try {
        // Se borra la fila, como antes: el historial de la ejecución vive en
        // `usage_logs` (por eso la columna `active_executions.outcome` queda
        // reservada y sin escribir — ver el encabezado de la migración).
        // Si viene `executionId` se acota el DELETE a esa fila, para que un `end`
        // tardío de una ejecución vieja no libere el candado de una nueva.
        const del = await db.query(
            `DELETE FROM active_executions
             WHERE user_id = $1 AND machine_id = $2
               AND ($3::int IS NULL OR id = $3)
             RETURNING id, subsystem, quota_counted`,
            [userId, machineId, execId]
        );

        if (outcome && del.rows.length > 0) {
            const safeOutcome = String(outcome).slice(0, 20);
            require('../utils/logger').info(
                `[B.8] execution/end user=${userId} exec=${del.rows[0].id} ` +
                `subsystem=${del.rows[0].subsystem || '-'} outcome=${safeOutcome} (sin reembolso, por diseño)`
            );
        }

        return res.json({ success: true });

    } catch (err) {
        console.error('[License] Error liberando lock:', err);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;
