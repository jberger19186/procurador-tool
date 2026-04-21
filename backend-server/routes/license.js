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
        // 1. Limpiar locks expirados de todos los usuarios
        await db.query(`DELETE FROM active_executions WHERE expires_at < NOW()`);

        // 2. Verificar si existe un lock activo para este usuario
        const existing = await db.query(
            `SELECT machine_id FROM active_executions WHERE user_id = $1`,
            [userId]
        );

        if (existing.rows.length > 0 && existing.rows[0].machine_id !== machineId) {
            return res.status(409).json({
                success: false,
                code:    'DEVICE_LOCKED',
                error:   'Hay una ejecución en curso en otro dispositivo. Esperá a que finalice o aguardá 30 minutos.'
            });
        }

        // 3. Upsert: adquirir o renovar lock para este dispositivo
        await db.query(`
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
        `, [userId, machineId, scriptName || null]);

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
