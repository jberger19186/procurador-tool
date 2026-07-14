const express = require('express');
const router  = express.Router();
const authenticateToken = require('../middleware/authenticateToken');

const TTL_MINUTES = 5;
const HEARTBEAT_INTERVAL_S = 30;

// ─── POST /license/execution/start ────────────────────────────────────────────
// Adquiere el lock de ejecución para el dispositivo actual.
// Rechaza si hay una ejecución activa en otro dispositivo.
router.post('/execution/start', authenticateToken, async (req, res) => {
    const db       = req.app.get('db');
    const userId   = req.user.id;
    const { machineId, scriptName } = req.body;

    if (!machineId) {
        return res.status(400).json({ success: false, error: 'machineId requerido' });
    }

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

        // 1. Limpiar locks expirados de todos los usuarios
        await db.query(`DELETE FROM active_executions WHERE expires_at < NOW()`);

        // 2. M3: adquisición ATÓMICA del lock. Antes el SELECT y el upsert eran pasos
        //    separados (TOCTOU): dos dispositivos podían pasar el SELECT y ambos upsertear,
        //    corriendo a la vez. Ahora el INSERT ... ON CONFLICT DO UPDATE solo renueva si
        //    el lock vivo es del MISMO dispositivo (WHERE machine_id = EXCLUDED.machine_id);
        //    si otro dispositivo lo tiene, 0 filas → 409. Es una sola sentencia atómica.
        const lock = await db.query(`
            INSERT INTO active_executions
                (user_id, machine_id, script_name, started_at, last_heartbeat, expires_at)
            VALUES
                ($1, $2, $3, NOW(), NOW(), NOW() + INTERVAL '${TTL_MINUTES} minutes')
            ON CONFLICT (user_id) DO UPDATE SET
                machine_id     = EXCLUDED.machine_id,
                script_name    = EXCLUDED.script_name,
                started_at     = NOW(),
                last_heartbeat = NOW(),
                expires_at     = NOW() + INTERVAL '${TTL_MINUTES} minutes'
            WHERE active_executions.machine_id = EXCLUDED.machine_id
            RETURNING id
        `, [userId, machineId, scriptName || null]);

        if (lock.rows.length === 0) {
            return res.status(409).json({
                success: false,
                code:    'DEVICE_LOCKED',
                error:   `Hay una ejecución en curso en otro dispositivo. Esperá a que finalice o aguardá ${TTL_MINUTES} minutos.`
            });
        }

        return res.json({
            success:            true,
            heartbeatIntervalS: HEARTBEAT_INTERVAL_S,
            ttlMinutes:         TTL_MINUTES
        });

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
router.post('/execution/end', authenticateToken, async (req, res) => {
    const db      = req.app.get('db');
    const userId  = req.user.id;
    const { machineId } = req.body;

    if (!machineId) {
        return res.status(400).json({ success: false, error: 'machineId requerido' });
    }

    try {
        await db.query(
            `DELETE FROM active_executions WHERE user_id = $1 AND machine_id = $2`,
            [userId, machineId]
        );
        return res.json({ success: true });

    } catch (err) {
        console.error('[License] Error liberando lock:', err);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;
