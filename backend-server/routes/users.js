// routes/users.js — Portal de usuario: cuenta, reactivación, cancelación, cambio de plan
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const mailer = require('../utils/mailer');
const logger = require('../utils/logger');
const { updatePreapprovalAmount } = require('../services/subscriptionService');

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// ─── GET /users/account ───────────────────────────────────────────────────────
// Estado completo de la cuenta del usuario autenticado
router.get('/account', async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            SELECT
                u.id, u.email, u.nombre, u.apellido, u.cuit,
                u.registration_status,
                s.plan, s.status AS subscription_status,
                s.usage_count, s.usage_limit,
                s.expires_at, s.period_start,
                s.proc_usage, s.informe_usage, s.monitor_novedades_usage, s.batch_usage,
                s.suspension_cause, s.suspended_at, s.suspension_reason,
                s.billing_paused,
                s.plan_expiry_date, s.plan_changes_this_cycle,
                s.next_billing_date, s.payment_provider,
                s.cancel_at, s.scheduled_plan,
                s.reactivation_request,
                p.display_name AS plan_display_name,
                p.price_usd, p.price_ars,
                p.proc_executions_limit, p.informe_limit,
                p.monitor_partes_limit, p.monitor_novedades_limit,
                p.batch_executions_limit, p.extension_flows
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE u.id = $1
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const row = result.rows[0];

        // Notificaciones no leídas
        const notifResult = await db.query(
            `SELECT id, type, message, created_at FROM notifications
             WHERE user_id = $1 AND read = false
             ORDER BY created_at DESC LIMIT 20`,
            [req.user.id]
        );

        res.json({
            success: true,
            user: {
                id: row.id,
                email: row.email,
                nombre: row.nombre,
                apellido: row.apellido,
                cuit: row.cuit,
                registrationStatus: row.registration_status,
            },
            subscription: {
                plan: row.plan,
                planDisplayName: row.plan_display_name,
                priceUsd: row.price_usd,
                priceArs: row.price_ars,
                status: row.subscription_status,
                usageCount: row.usage_count,
                usageLimit: row.usage_limit,
                expiresAt: row.expires_at,
                periodStart: row.period_start,
                procUsage: row.proc_usage,
                informeUsage: row.informe_usage,
                monitorNovedadesUsage: row.monitor_novedades_usage,
                batchUsage: row.batch_usage,
                suspensionCause: row.suspension_cause,
                suspendedAt: row.suspended_at,
                suspensionReason: row.suspension_reason,
                billingPaused: row.billing_paused,
                planExpiryDate: row.plan_expiry_date,
                planChangesThisCycle: row.plan_changes_this_cycle || 0,
                nextBillingDate: row.next_billing_date,
                paymentProvider: row.payment_provider,
                cancelAt: row.cancel_at,
                scheduledPlan: row.scheduled_plan,
                reactivationRequest: row.reactivation_request,
                limits: {
                    proc: row.proc_executions_limit,
                    informe: row.informe_limit,
                    monitorPartes: row.monitor_partes_limit,
                    monitorNovedades: row.monitor_novedades_limit,
                    batch: row.batch_executions_limit,
                },
                extensionFlows: row.extension_flows,
            },
            notifications: notifResult.rows,
        });
    } catch (error) {
        logger.error('Error en GET /users/account:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /users/reactivation-request ─────────────────────────────────────────
// El usuario suspendido_admin envía 1 solicitud de reactivación
router.post('/reactivation-request', async (req, res) => {
    const db = req.app.get('db');
    const { message } = req.body;

    try {
        // Verificar estado
        const userResult = await db.query(
            `SELECT u.id, u.nombre, u.apellido, u.email, u.registration_status,
                    s.suspension_reason, s.reactivation_request
             FROM users u JOIN subscriptions s ON u.id = s.user_id
             WHERE u.id = $1`,
            [req.user.id]
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];

        if (u.registration_status !== 'suspended_admin') {
            return res.status(400).json({ error: 'Solo podés solicitar reactivación si tu cuenta está suspendida por el administrador' });
        }
        if (u.reactivation_request && u.reactivation_request.status === 'pending') {
            return res.status(400).json({ error: 'Ya enviaste una solicitud de reactivación. El administrador la está revisando.' });
        }
        if (u.reactivation_request && ['approved', 'rejected'].includes(u.reactivation_request.status)) {
            return res.status(400).json({ error: 'Ya utilizaste tu solicitud de reactivación disponible.' });
        }

        const request = {
            sent_at: new Date().toISOString(),
            message: message ? message.trim().slice(0, 1000) : null,
            status: 'pending',
        };

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE subscriptions SET reactivation_request = $1, updated_at = NOW() WHERE user_id = $2`,
                [JSON.stringify(request), req.user.id]
            );
            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'reactivation_requested', $2)`,
                [req.user.id, JSON.stringify({ message: request.message })]
            );
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        // Notificar al admin por email
        mailer.sendAdminReactivationRequest(
            u.nombre, u.apellido, u.email, u.suspension_reason, request.message
        ).catch(() => {});

        logger.info(`🔄 Solicitud de reactivación enviada por usuario ${req.user.id}`);
        res.json({ success: true, message: 'Solicitud enviada. El administrador la revisará a la brevedad.' });

    } catch (error) {
        logger.error('Error en POST /users/reactivation-request:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /users/cancel ───────────────────────────────────────────────────────
// El usuario cancela su suscripción (acceso hasta fin del período pago)
router.post('/cancel', async (req, res) => {
    const db = req.app.get('db');

    try {
        const userResult = await db.query(
            `SELECT u.registration_status, s.expires_at, s.cancel_at
             FROM users u JOIN subscriptions s ON u.id = s.user_id
             WHERE u.id = $1`,
            [req.user.id]
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];

        if (u.registration_status !== 'active') {
            return res.status(400).json({ error: 'Solo podés cancelar una suscripción activa' });
        }
        if (u.cancel_at) {
            return res.status(400).json({ error: 'Tu suscripción ya está programada para cancelarse' });
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE subscriptions SET cancel_at = expires_at, updated_at = NOW() WHERE user_id = $1`,
                [req.user.id]
            );
            await client.query(
                `INSERT INTO user_events (user_id, event_type) VALUES ($1, 'cancellation_scheduled')`,
                [req.user.id]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'cancellation_scheduled', $2)`,
                [req.user.id, `Tu suscripción se cancelará al finalizar tu período actual (${new Date(u.expires_at).toLocaleDateString('es-AR')}).`]
            );
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        logger.info(`❌ Cancelación programada para usuario ${req.user.id}`);
        res.json({
            success: true,
            message: 'Cancelación programada. Tendrás acceso hasta el fin de tu período actual.',
            cancelAt: u.expires_at,
        });

    } catch (error) {
        logger.error('Error en POST /users/cancel:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /users/change-plan ──────────────────────────────────────────────────
// Upgrade (inmediato, stub) / Downgrade (programado) / Reactivación desde suspended_plan_expired
// Cancelar un cambio de plan (downgrade) programado para el próximo ciclo.
// Quita scheduled_plan y devuelve el cambio al contador (no "cuesta" si se deshace).
router.post('/cancel-scheduled-plan', async (req, res) => {
    const db = req.app.get('db');
    try {
        const { rows: [sub] } = await db.query(
            'SELECT scheduled_plan FROM subscriptions WHERE user_id = $1', [req.user.id]
        );
        if (!sub || !sub.scheduled_plan) {
            return res.status(400).json({ error: 'No hay un cambio de plan programado para cancelar.' });
        }
        await db.query(
            `UPDATE subscriptions
             SET scheduled_plan = NULL,
                 plan_changes_this_cycle = GREATEST(plan_changes_this_cycle - 1, 0),
                 updated_at = NOW()
             WHERE user_id = $1`,
            [req.user.id]
        );
        await db.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_downgrade_cancelled', $2)`,
            [req.user.id, JSON.stringify(sub.scheduled_plan)]
        );
        res.json({ success: true, message: 'Cambio de plan programado cancelado. Seguís con tu plan actual.' });
    } catch (err) {
        console.error('Error cancelando cambio de plan programado:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.post('/change-plan', async (req, res) => {
    const db = req.app.get('db');
    const { plan_name } = req.body;

    if (!plan_name) {
        return res.status(400).json({ error: 'plan_name es requerido' });
    }

    try {
        const userResult = await db.query(`
            SELECT u.id, u.email, u.nombre, u.registration_status,
                   s.plan AS current_plan, s.plan_id AS current_plan_id,
                   s.plan_changes_this_cycle, s.next_billing_date,
                   s.expires_at, s.scheduled_plan, s.payment_provider, s.cancel_at
            FROM users u JOIN subscriptions s ON u.id = s.user_id
            WHERE u.id = $1
        `, [req.user.id]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];

        // Cancelación programada pendiente: cambiar de plan es contradictorio (la cuenta se da
        // de baja al fin del período). Primero hay que reactivar la suscripción.
        if (u.cancel_at && new Date(u.cancel_at) > new Date()) {
            return res.status(400).json({ error: 'Tenés una cancelación programada. Reactivá tu suscripción antes de cambiar de plan.' });
        }

        // La reactivación de un vencido (suspended_plan_expired) ya NO pasa por acá (sería gratis,
        // stub): va por el checkout real de MercadoPago (POST /checkout/init alinea el plan elegido
        // y el webhook reactiva al cobrar). Acá solo upgrades/downgrades de cuentas activas.
        const allowedStatuses = ['active'];
        if (!allowedStatuses.includes(u.registration_status)) {
            return res.status(400).json({ error: 'El cambio de plan solo está disponible para cuentas activas. Para reactivar un plan vencido, configurá el pago en Facturación.' });
        }

        // Control de límite de cambios (solo en estado active)
        if (u.registration_status === 'active' && u.plan_changes_this_cycle >= 2) {
            const nextDate = u.next_billing_date
                ? new Date(u.next_billing_date).toLocaleDateString('es-AR')
                : new Date(u.expires_at).toLocaleDateString('es-AR');
            return res.status(400).json({
                error: `Ya realizaste 2 cambios en este período. Podrás cambiar tu plan a partir del ${nextDate}.`
            });
        }

        // Verificar que el plan nuevo existe, está activo y es público (un usuario no puede
        // auto-asignarse un plan privado; esos los asigna solo el administrador).
        const planResult = await db.query(
            `SELECT * FROM plans WHERE name = $1 AND active = true AND visibility = 'public'`,
            [plan_name.toUpperCase()]
        );
        if (planResult.rows.length === 0) {
            return res.status(400).json({ error: 'Plan no encontrado o no disponible' });
        }
        const newPlan = planResult.rows[0];

        // Obtener plan actual para determinar upgrade/downgrade
        const currentPlanResult = await db.query(
            `SELECT price_usd, price_ars FROM plans WHERE id = $1`,
            [u.current_plan_id]
        );
        const planPrice = (p) => Number(p?.price_ars ?? p?.price_usd ?? 0);
        const currentPrice = planPrice(currentPlanResult.rows[0]);
        const isUpgrade = planPrice(newPlan) > currentPrice;
        const isReactivation = u.registration_status === 'suspended_plan_expired';

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            // Tope global: para cuentas PAGAS rige el enforcement por submódulo, así que
            // usage_limit = 999999 (el global no debe cortar al mezclar módulos). Solo el
            // trial/legacy sin pago usa el límite de proc del plan como tope global — salvo
            // que el plan no limite proc (0, ej. EXTENSION_PROMO): ahí se conserva el cupo
            // actual (usage_limit=0 violaría check_usage_limit_positive).
            const newUsageLimit = (u.payment_provider || newPlan.proc_executions_limit === -1)
                ? 999999
                : (newPlan.proc_executions_limit > 0 ? newPlan.proc_executions_limit : null);

            if (isReactivation || isUpgrade) {
                // Aplica inmediatamente (stub: simula cobro OK)
                const newExpiry = new Date();
                newExpiry.setDate(newExpiry.getDate() + (newPlan.period_days || 30));

                await client.query(`
                    UPDATE subscriptions SET
                        plan = $1, plan_id = $2, status = 'active',
                        usage_limit = COALESCE($3, usage_limit),
                        expires_at = $4,
                        next_billing_date = $4,
                        period_start = NOW(),
                        plan_changes_this_cycle = plan_changes_this_cycle + 1,
                        suspension_cause = NULL, suspended_at = NULL,
                        suspended_by = NULL, billing_paused = false,
                        suspension_reason = NULL, plan_expiry_date = NULL,
                        scheduled_plan = NULL,
                        updated_at = NOW()
                    WHERE user_id = $5
                `, [newPlan.name, newPlan.id, newUsageLimit, newExpiry, req.user.id]);

                if (isReactivation) {
                    await client.query(
                        `UPDATE users SET registration_status = 'active', updated_at = NOW() WHERE id = $1`,
                        [req.user.id]
                    );
                    await client.query(
                        `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'reactivated_plan_selection', $2)`,
                        [req.user.id, JSON.stringify({ new_plan: newPlan.name })]
                    );
                } else {
                    await client.query(
                        `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_upgraded', $2)`,
                        [req.user.id, JSON.stringify({ from: u.current_plan, to: newPlan.name })]
                    );
                }

                await client.query(
                    `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_changed', $2)`,
                    [req.user.id, `Tu plan fue actualizado a ${newPlan.display_name}.`]
                );
                await client.query('COMMIT');

                // Ajustar el monto que cobra MercadoPago al nuevo plan (best-effort).
                // El upgrade aplica ya; el nuevo monto rige desde el próximo cobro.
                if (u.payment_provider) {
                    updatePreapprovalAmount(req.user.id, newPlan.name).catch(() => {});
                }

                res.json({
                    success: true,
                    type: isReactivation ? 'reactivation' : 'upgrade',
                    newPlan: newPlan.name,
                    message: isReactivation
                        ? `Tu cuenta fue reactivada con el plan ${newPlan.display_name}.`
                        : `Upgrade a ${newPlan.display_name} aplicado correctamente.`,
                });
            } else {
                // Downgrade — programa para el próximo ciclo
                const applyAt = u.next_billing_date || u.expires_at;
                const scheduled = { plan: newPlan.name, plan_id: newPlan.id, apply_at: applyAt };

                await client.query(`
                    UPDATE subscriptions SET
                        scheduled_plan = $1,
                        plan_changes_this_cycle = plan_changes_this_cycle + 1,
                        updated_at = NOW()
                    WHERE user_id = $2
                `, [JSON.stringify(scheduled), req.user.id]);

                await client.query(
                    `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_downgrade_scheduled', $2)`,
                    [req.user.id, JSON.stringify({ from: u.current_plan, to: newPlan.name, apply_at: applyAt })]
                );
                await client.query(
                    `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_downgrade_scheduled', $2)`,
                    [req.user.id, `Cambio a ${newPlan.display_name} programado para el ${new Date(applyAt).toLocaleDateString('es-AR')}.`]
                );
                await client.query('COMMIT');

                res.json({
                    success: true,
                    type: 'downgrade',
                    newPlan: newPlan.name,
                    applyAt,
                    message: `Downgrade a ${newPlan.display_name} programado para el ${new Date(applyAt).toLocaleDateString('es-AR')}.`,
                });
            }
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

    } catch (error) {
        logger.error('Error en POST /users/change-plan:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /users/notifications/read ───────────────────────────────────────────
// Marcar notificaciones como leídas
router.post('/notifications/read', async (req, res) => {
    const db = req.app.get('db');
    const { ids } = req.body || {}; // array de IDs o vacío para marcar todas

    try {
        if (ids && Array.isArray(ids) && ids.length > 0) {
            await db.query(
                `UPDATE notifications SET read = true WHERE user_id = $1 AND id = ANY($2)`,
                [req.user.id, ids]
            );
        } else {
            await db.query(
                `UPDATE notifications SET read = true WHERE user_id = $1`,
                [req.user.id]
            );
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('Error marcando notificaciones:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;
