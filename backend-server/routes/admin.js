const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getCacheStats, clearCache } = require('../utils/scriptEncryption');
const { adminLimiter } = require('../middleware/rateLimiter');
const { isBlacklisted } = require('../middleware/tokenBlacklist');
const { sendTicketReplyEmail } = require('../utils/mailer');

// ── Multer: almacenamiento de PDFs de facturas ────────────────────────────────
const invoicesDir = path.join(__dirname, '../public/invoices');
if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir, { recursive: true });

const invoiceStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, invoicesDir),
    filename: (req, file, cb) => {
        const invoiceId = req.params.invoiceId || 'new';
        const ts = Date.now();
        cb(null, `factura_${invoiceId}_${ts}.pdf`);
    }
});
const uploadInvoice = multer({
    storage: invoiceStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máx
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') return cb(new Error('Solo se aceptan archivos PDF'));
        cb(null, true);
    }
});

// Aplicar rate limiter a todas las rutas de admin
router.use(adminLimiter);

// Middleware para verificar rol de admin
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    // M-1: invalidar tokens en blacklist (logout). Antes el logout de admin
    // no surtía efecto hasta el vencimiento natural del token.
    if (isBlacklisted(token)) {
        return res.status(403).json({ error: 'Token invalidado' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Se requiere rol de administrador' });
        }

        req.user = user;
        next();
    });
}

// ==================== CACHÉ ====================

// Obtener estadísticas del caché
router.get('/cache/stats', authenticateAdmin, (req, res) => {
    try {
        const stats = getCacheStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
});

// Limpiar caché completo
router.post('/cache/clear', authenticateAdmin, (req, res) => {
    try {
        clearCache();
        console.log(`🗑️ Caché limpiado por admin: ${req.user.id}`);
        res.json({
            success: true,
            message: 'Caché limpiado correctamente'
        });
    } catch (error) {
        console.error('Error limpiando caché:', error);
        res.status(500).json({ error: 'Error limpiando caché' });
    }
});

// Precalentar caché (warmup)
router.post('/cache/warmup', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const { getDecryptedScript } = require('../utils/scriptEncryption');

        // Obtener todos los scripts activos
        const scriptsResult = await db.query(`
            SELECT script_name FROM encrypted_scripts WHERE active = true
        `);

        const warmedUp = [];
        for (const row of scriptsResult.rows) {
            try {
                await getDecryptedScript(db, row.script_name);
                warmedUp.push(row.script_name);
            } catch (error) {
                console.error(`Error precalentando ${row.script_name}:`, error.message);
            }
        }

        console.log(`🔥 Caché precalentado: ${warmedUp.length} scripts por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Caché precalentado correctamente',
            scriptsLoaded: warmedUp.length,
            scripts: warmedUp
        });
    } catch (error) {
        console.error('Error precalentando caché:', error);
        res.status(500).json({ error: 'Error precalentando caché' });
    }
});

// ==================== SCRIPTS ====================

// Reencriptar scripts (útil cuando cambias la clave)
router.post('/scripts/reencrypt', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const { processScripts } = require('../utils/scriptEncryption');
        clearCache(); // Limpiar caché antes de reencriptar
        await processScripts(db);

        console.log(`🔐 Scripts reencriptados por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Scripts reencriptados correctamente'
        });
    } catch (error) {
        console.error('Error reencriptando scripts:', error);
        res.status(500).json({ error: 'Error reencriptando scripts' });
    }
});

// Listar todos los scripts
router.get('/scripts', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const result = await db.query(`
            SELECT script_name, version, hash, active, created_at, updated_at
            FROM encrypted_scripts
            ORDER BY script_name
        `);

        res.json({
            success: true,
            scripts: result.rows
        });
    } catch (error) {
        console.error('Error listando scripts:', error);
        res.status(500).json({ error: 'Error listando scripts' });
    }
});

// Activar/desactivar script
router.put('/scripts/:scriptName/toggle', authenticateAdmin, async (req, res) => {
    const { scriptName } = req.params;
    const { active } = req.body;
    const db = req.app.get('db');

    try {
        await db.query(
            'UPDATE encrypted_scripts SET active = $1 WHERE script_name = $2',
            [active, scriptName]
        );

        console.log(`🔄 Script ${scriptName} ${active ? 'activado' : 'desactivado'} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: `Script ${scriptName} ${active ? 'activado' : 'desactivado'}`
        });
    } catch (error) {
        console.error('Error actualizando script:', error);
        res.status(500).json({ error: 'Error actualizando script' });
    }
});

// ==================== USUARIOS ====================

// Listar todos los usuarios
router.get('/users', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const result = await db.query(`
            SELECT u.id, u.email, u.role, u.created_at, u.last_login, u.machine_id,
                   s.plan, s.status, s.expires_at, s.usage_count, s.usage_limit
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            ORDER BY u.created_at DESC
        `);

        res.json({
            success: true,
            count: result.rows.length,
            users: result.rows
        });
    } catch (error) {
        console.error('Error listando usuarios:', error);
        res.status(500).json({ error: 'Error listando usuarios' });
    }
});

// ─── Búsqueda rápida de usuarios (para autocomplete en facturas manuales) ────
router.get('/users/search', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { q = '', limit = 10 } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });
    try {
        const { rows } = await db.query(
            `SELECT id, email, nombre, apellido, cuit, domicilio
             FROM users
             WHERE email ILIKE $1 OR nombre ILIKE $1 OR apellido ILIKE $1 OR cuit ILIKE $1
             ORDER BY nombre, apellido
             LIMIT $2`,
            [`%${q}%`, parseInt(limit, 10)]
        );
        res.json({ users: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Usuarios pendientes de activación ───────────────────────────────────────
router.get('/users/pending', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.email, u.cuit,
                   u.registration_status, u.email_verified, u.toc_accepted_at,
                   u.created_at,
                   p.name AS plan_name, p.display_name AS plan_display
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE u.registration_status IN ('pending_email','pending_activation')
            ORDER BY u.created_at DESC
        `);
        res.json({ success: true, users: result.rows });
    } catch (error) {
        console.error('Error listando usuarios pendientes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Activar usuario ──────────────────────────────────────────────────────────
router.post('/users/:userId/activate', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    const expires_days = (req.body && req.body.expires_days) || 30;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(`
            SELECT u.id, u.email, u.nombre, u.registration_status,
                   s.id AS sub_id, s.plan_id,
                   p.proc_executions_limit
            FROM users u
            JOIN subscriptions s ON u.id = s.user_id
            JOIN plans p ON s.plan_id = p.id
            WHERE u.id = $1
        `, [userId]);

        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const u = userResult.rows[0];

        // FASE 5: Al activar, usage_limit se mantiene en 20 (trial).
        // El límite real del plan se aplica recién con el primer pago aprobado
        // (webhook payment.approved → applyTrialBonus en subscriptionService.js).
        // Solo si PAYMENT_MODULE_ENABLED=false (modo legacy sin cobro) se sube al límite del plan.
        const paymentEnabled = process.env.PAYMENT_MODULE_ENABLED === 'true';
        const planLimit = u.proc_executions_limit > 0 ? u.proc_executions_limit : 9999;
        const usageLimit = paymentEnabled ? 20 : planLimit;

        await client.query(`
            UPDATE users
            SET registration_status = 'active', updated_at = NOW()
            WHERE id = $1
        `, [userId]);

        await client.query(`
            UPDATE subscriptions
            SET status = 'active',
                usage_count = 0,
                usage_limit = $1,
                expires_at = NOW() + ($2 || ' days')::INTERVAL,
                period_start = NOW(),
                updated_at = NOW()
            WHERE user_id = $3
        `, [usageLimit, expires_days, userId]);

        // Eventos, notificación y email
        await client.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'activated', $2)`,
            [userId, JSON.stringify({ admin_id: req.user.id, plan: u.plan_name || '' })]
        );
        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'activate', $3)`,
            [req.user.id, userId, JSON.stringify({ plan: u.plan_name || '' })]
        );
        await client.query(
            `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_activated', $2)`,
            [userId, 'Tu cuenta fue activada. Ya podés usar todas las funciones de tu plan.']
        );

        await client.query('COMMIT');

        // Email fuera de transacción (no bloquea)
        const mailer = require('../utils/mailer');
        mailer.sendActivationEmail(u.email, u.email).catch(() => {});

        console.log(`✅ Usuario ${userId} (${u.email}) activado por admin ${req.user.id}`);
        res.json({ success: true, message: `Usuario ${u.email} activado correctamente` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error activando usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Rechazar usuario (Opción B: bloquear / Opción C: mantener trial) ─────────
router.post('/users/:userId/reject', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { mode, reason } = req.body || {}; // mode: 'block' | 'keep_trial'
    const db = req.app.get('db');

    if (!['block', 'keep_trial'].includes(mode)) {
        return res.status(400).json({ error: "mode debe ser 'block' o 'keep_trial'" });
    }
    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'El motivo es obligatorio' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            `SELECT u.id, u.email, u.nombre, u.registration_status
             FROM users u WHERE u.id = $1`,
            [userId]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];

        const mailer = require('../utils/mailer');

        if (mode === 'block') {
            await client.query(
                `UPDATE users SET registration_status = 'rejected', updated_at = NOW() WHERE id = $1`,
                [userId]
            );
            await client.query(
                `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1`,
                [userId]
            );
            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'rejected_blocked', $2)`,
                [userId, JSON.stringify({ reason, admin_id: req.user.id })]
            );
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reject_block', $3)`,
                [req.user.id, userId, JSON.stringify({ reason })]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_rejected', $2)`,
                [userId, `Tu solicitud fue rechazada. Motivo: ${reason}`]
            );
            await client.query('COMMIT');
            mailer.sendRejectionEmail(u.email, u.nombre, reason, 'block').catch(() => {});
        } else {
            // keep_trial: no cambia registration_status, solo notifica
            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'rejected_keep_trial', $2)`,
                [userId, JSON.stringify({ reason, admin_id: req.user.id })]
            );
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reject_keep_trial', $3)`,
                [req.user.id, userId, JSON.stringify({ reason })]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'trial_review_pending', $2)`,
                [userId, `Tu solicitud está en espera. Motivo: ${reason}. Podés seguir usando tus usos de prueba.`]
            );
            await client.query('COMMIT');
            mailer.sendRejectionEmail(u.email, u.nombre, reason, 'keep_trial').catch(() => {});
        }

        console.log(`🚫 Usuario ${userId} rechazado (${mode}) por admin ${req.user.id}`);
        res.json({ success: true, mode });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error rechazando usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Suspender usuario por admin ──────────────────────────────────────────────
router.post('/users/:userId/suspend', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { reason, billing_paused = true } = req.body || {};
    const db = req.app.get('db');

    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'El motivo de suspensión es obligatorio' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            `SELECT u.id, u.email, u.nombre, u.registration_status
             FROM users u WHERE u.id = $1`,
            [userId]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];
        if (u.registration_status !== 'active') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Solo se puede suspender una cuenta activa' });
        }

        await client.query(
            `UPDATE users SET registration_status = 'suspended_admin', updated_at = NOW() WHERE id = $1`,
            [userId]
        );
        await client.query(`
            UPDATE subscriptions SET
                status = 'suspended_admin',
                suspension_cause = 'admin',
                suspended_at = NOW(),
                suspended_by = $1,
                billing_paused = $2,
                suspension_reason = $3,
                updated_at = NOW()
            WHERE user_id = $4
        `, [req.user.id, billing_paused, reason.trim(), userId]);

        await client.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'admin_suspended', $2)`,
            [userId, JSON.stringify({ reason, admin_id: req.user.id, billing_paused })]
        );
        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'suspend', $3)`,
            [req.user.id, userId, JSON.stringify({ reason, billing_paused })]
        );
        await client.query(
            `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_suspended', $2)`,
            [userId, `Tu cuenta fue suspendida. Motivo: ${reason}. Podés solicitar revisión en el portal.`]
        );

        await client.query('COMMIT');

        const mailer = require('../utils/mailer');
        mailer.sendAdminSuspendedEmail(u.email, u.nombre, reason).catch(() => {});

        console.log(`⏸️ Usuario ${userId} suspendido por admin ${req.user.id}. billing_paused=${billing_paused}`);
        res.json({ success: true });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error suspendiendo usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Listar solicitudes de reactivación pendientes ────────────────────────────
router.get('/users/reactivation-requests', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.email,
                   s.suspension_reason, s.suspended_at, s.reactivation_request
            FROM users u
            JOIN subscriptions s ON u.id = s.user_id
            WHERE u.registration_status = 'suspended_admin'
              AND s.reactivation_request IS NOT NULL
              AND s.reactivation_request->>'status' = 'pending'
            ORDER BY (s.reactivation_request->>'sent_at') ASC
        `);
        res.json({ success: true, requests: result.rows });
    } catch (error) {
        console.error('Error listando solicitudes de reactivación:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Procesar solicitud de reactivación ──────────────────────────────────────
router.post('/users/:userId/reactivation-request/:action', authenticateAdmin, async (req, res) => {
    const { userId, action } = req.params;
    const { reason } = req.body || {}; // solo para 'reject'
    const db = req.app.get('db');

    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: "action debe ser 'approve' o 'reject'" });
    }
    if (action === 'reject' && (!reason || !reason.trim())) {
        return res.status(400).json({ error: 'El motivo es obligatorio para rechazar' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            `SELECT u.id, u.email, u.nombre, s.billing_paused, s.reactivation_request
             FROM users u JOIN subscriptions s ON u.id = s.user_id WHERE u.id = $1`,
            [userId]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];
        const mailer = require('../utils/mailer');

        if (action === 'approve') {
            // Recalcular next_billing_date si billing estaba pausado
            const nextBilling = new Date();
            nextBilling.setDate(nextBilling.getDate() + 30);

            await client.query(
                `UPDATE users SET registration_status = 'active', updated_at = NOW() WHERE id = $1`,
                [userId]
            );
            await client.query(`
                UPDATE subscriptions SET
                    status = 'active',
                    suspension_cause = NULL,
                    suspended_at = NULL,
                    suspended_by = NULL,
                    billing_paused = false,
                    suspension_reason = NULL,
                    reactivation_request = jsonb_set(reactivation_request, '{status}', '"approved"'),
                    next_billing_date = CASE WHEN billing_paused = true THEN $1 ELSE next_billing_date END,
                    updated_at = NOW()
                WHERE user_id = $2
            `, [nextBilling, userId]);

            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'admin_reactivated', $2)`,
                [userId, JSON.stringify({ admin_id: req.user.id })]
            );
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reactivate_approve', '{}')`,
                [req.user.id, userId]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_reactivated', $2)`,
                [userId, 'Tu acceso fue restaurado. Ya podés usar la aplicación nuevamente.']
            );
            await client.query('COMMIT');
            mailer.sendReactivationResultEmail(u.email, u.nombre, true).catch(() => {});

        } else {
            await client.query(`
                UPDATE subscriptions SET
                    reactivation_request = jsonb_set(reactivation_request, '{status}', '"rejected"'),
                    updated_at = NOW()
                WHERE user_id = $1
            `, [userId]);
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reactivate_reject', $3)`,
                [req.user.id, userId, JSON.stringify({ reason })]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'reactivation_rejected', $2)`,
                [userId, `Tu solicitud fue revisada. La suspensión se mantiene. Motivo: ${reason}`]
            );
            await client.query('COMMIT');
            mailer.sendReactivationResultEmail(u.email, u.nombre, false, reason).catch(() => {});
        }

        console.log(`🔄 Solicitud de reactivación de usuario ${userId}: ${action} por admin ${req.user.id}`);
        res.json({ success: true, action });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error procesando solicitud de reactivación:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Configurar vencimiento de plan ──────────────────────────────────────────
router.put('/plans/:planId/expiry', authenticateAdmin, async (req, res) => {
    const { planId } = req.params;
    const { plan_expiry_date } = req.body; // ISO string o null
    const db = req.app.get('db');

    const expiryValue = plan_expiry_date ? new Date(plan_expiry_date) : null;
    if (plan_expiry_date && isNaN(expiryValue)) {
        return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE plans SET plan_expiry_date = $1 WHERE id = $2`,
            [expiryValue, planId]
        );
        // Propagar a todos los usuarios activos en este plan
        await client.query(`
            UPDATE subscriptions SET plan_expiry_date = $1, updated_at = NOW()
            WHERE plan_id = $2 AND status = 'active'
        `, [expiryValue, planId]);

        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, NULL, 'set_plan_expiry', $2)`,
            [req.user.id, JSON.stringify({ plan_id: planId, plan_expiry_date: expiryValue })]
        );

        await client.query('COMMIT');
        console.log(`📅 Vencimiento del plan ${planId} configurado a ${expiryValue} por admin ${req.user.id}`);
        res.json({ success: true, plan_expiry_date: expiryValue });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error configurando vencimiento de plan:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// Obtener detalle de un usuario
router.get('/users/:userId', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        const userResult = await db.query(`
            SELECT u.*, s.*,
                   p.display_name AS plan_display_name,
                   p.proc_executions_limit, p.proc_expedientes_limit,
                   p.batch_executions_limit, p.batch_expedientes_limit,
                   p.informe_limit, p.monitor_partes_limit, p.monitor_novedades_limit,
                   p.period_days,
                   u.id AS id
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE u.id = $1
        `, [userId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Obtener logs recientes del usuario
        const logsResult = await db.query(`
            SELECT * FROM usage_logs
            WHERE user_id = $1
            ORDER BY execution_date DESC
            LIMIT 20
        `, [userId]);

        res.json({
            success: true,
            user: userResult.rows[0],
            recentLogs: logsResult.rows
        });
    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({ error: 'Error obteniendo usuario' });
    }
});

// Actualizar datos de registro de un usuario
router.put('/users/:userId/registro', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { nombre, apellido, cuit, domicilio, registration_status } = req.body;
    const db = req.app.get('db');

    const validStatuses = ['pending_email', 'pending_activation', 'active', 'rejected', 'suspended', 'suspended_admin', 'suspended_plan_expired', 'cancelled'];
    if (registration_status && !validStatuses.includes(registration_status)) {
        return res.status(400).json({ error: 'Estado de registro inválido' });
    }

    try {
        await db.query(`
            UPDATE users SET
                nombre             = COALESCE($1, nombre),
                apellido           = COALESCE($2, apellido),
                cuit               = COALESCE($3, cuit),
                domicilio          = COALESCE($4, domicilio),
                registration_status = COALESCE($5, registration_status),
                updated_at         = NOW()
            WHERE id = $6
        `, [
            nombre   || null,
            apellido || null,
            cuit     || null,
            domicilio ? JSON.stringify(domicilio) : null,
            registration_status || null,
            userId
        ]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error actualizando datos de registro:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Marcar email como verificado manualmente ─────────────────────────────────
router.post('/users/:userId/verify-email', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            UPDATE users
            SET email_verified       = true,
                registration_status  = CASE
                    WHEN registration_status = 'pending_email' THEN 'pending_activation'
                    ELSE registration_status
                END,
                email_verify_token   = NULL,
                email_verify_expires = NULL,
                updated_at           = NOW()
            WHERE id = $1
            RETURNING email, nombre, registration_status
        `, [userId]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const u = result.rows[0];
        require('../utils/logger').info(`✅ Email verificado manualmente por admin: ${u.email}`);
        res.json({ success: true, registration_status: u.registration_status });
    } catch (error) {
        console.error('Error verificando email:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Reenviar email de verificación ───────────────────────────────────────────
router.post('/users/:userId/resend-verification', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    const crypto = require('crypto');
    const mailer = require('../utils/mailer');
    try {
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hs

        const result = await db.query(`
            UPDATE users
            SET email_verify_token   = $1,
                email_verify_expires = $2,
                email_verified       = false,
                registration_status  = 'pending_email',
                updated_at           = NOW()
            WHERE id = $3 AND email_verified = false
            RETURNING email, nombre
        `, [token, expires, userId]);

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'El email ya fue verificado o el usuario no existe' });
        }
        const u = result.rows[0];
        await mailer.sendEmailVerification(u.email, u.nombre, token);
        require('../utils/logger').info(`✉️ Verificación reenviada a ${u.email} por admin`);
        res.json({ success: true, message: `Email de verificación reenviado a ${u.email}` });
    } catch (error) {
        console.error('Error reenviando verificación:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Actualizar rol de usuario
router.put('/users/:userId/role', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { role } = req.body;
    const db = req.app.get('db');

    if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rol inválido' });
    }

    try {
        await db.query(
            'UPDATE users SET role = $1 WHERE id = $2',
            [role, userId]
        );

        console.log(`👤 Usuario ${userId} actualizado a rol ${role} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: `Usuario ${userId} actualizado a rol ${role}`
        });
    } catch (error) {
        console.error('Error actualizando rol:', error);
        res.status(500).json({ error: 'Error actualizando rol' });
    }
});

// Desvincular hardware de un usuario
router.post('/users/:userId/unbind-hardware', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            'UPDATE users SET machine_id = NULL WHERE id = $1',
            [userId]
        );

        console.log(`🔓 Hardware desvinculado para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Hardware desvinculado correctamente'
        });
    } catch (error) {
        console.error('Error desvinculando hardware:', error);
        res.status(500).json({ error: 'Error desvinculando hardware' });
    }
});

// Asignar/actualizar CUIT de un usuario
router.put('/users/:userId/cuit', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { cuit } = req.body;
    const db = req.app.get('db');

    if (!cuit || !/^\d{11}$/.test(cuit)) {
        return res.status(400).json({ error: 'CUIT inválido. Debe tener 11 dígitos numéricos.' });
    }

    try {
        await db.query('UPDATE users SET cuit = $1 WHERE id = $2', [cuit, userId]);
        console.log(`🆔 CUIT ${cuit} asignado al usuario ${userId} por admin: ${req.user.id}`);
        res.json({ success: true, message: `CUIT ${cuit} asignado correctamente` });
    } catch (error) {
        console.error('Error asignando CUIT:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==================== SUSCRIPCIONES ====================

// Crear/actualizar suscripción
router.post('/subscriptions', authenticateAdmin, async (req, res) => {
    const { userId, plan, planId, durationDays } = req.body;
    const db = req.app.get('db');

    try {
        let planData;

        if (planId) {
            // Usar plan de BD
            const planResult = await db.query(`SELECT * FROM plans WHERE id = $1 AND active = true`, [planId]);
            if (planResult.rows.length === 0) return res.status(400).json({ error: 'Plan no encontrado o inactivo' });
            planData = planResult.rows[0];
        } else if (plan) {
            // Backward compat: buscar por nombre
            const planResult = await db.query(`SELECT * FROM plans WHERE name = $1 AND active = true`, [plan.toUpperCase()]);
            if (planResult.rows.length === 0) {
                // Fallback a valores hardcodeados si no existe en plans
                const hardcoded = { 'BASIC': 100, 'PRO': 1000, 'ENTERPRISE': 999999 };
                if (!hardcoded[plan]) return res.status(400).json({ error: 'Plan inválido' });
                planData = { name: plan, id: null, proc_executions_limit: hardcoded[plan], informe_limit: -1, monitor_partes_limit: -1, monitor_novedades_limit: -1, period_days: 30 };
            } else {
                planData = planResult.rows[0];
            }
        } else {
            return res.status(400).json({ error: 'Se requiere plan o planId' });
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (durationDays || planData.period_days || 30));
        const usageLimit = planData.proc_executions_limit === -1 ? 999999 : planData.proc_executions_limit;

        await db.query(`
            INSERT INTO subscriptions (user_id, plan, plan_id, status, expires_at, usage_limit, period_start)
            VALUES ($1, $2, $3, 'active', $4, $5, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET plan = $2, plan_id = $3, status = 'active', expires_at = $4,
                usage_limit = $5, period_start = NOW(),
                proc_usage = 0, batch_usage = 0, informe_usage = 0, monitor_novedades_usage = 0,
                proc_bonus = 0, batch_bonus = 0, informe_bonus = 0, monitor_novedades_bonus = 0, monitor_partes_bonus = 0,
                updated_at = NOW()
        `, [userId, planData.name, planData.id, expiresAt, usageLimit]);

        console.log(`💳 Suscripción "${planData.name}" creada/actualizada para usuario ${userId} por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Suscripción creada/actualizada correctamente', subscription: { userId, plan: planData.name, expiresAt } });
    } catch (error) {
        console.error('Error gestionando suscripción:', error);
        res.status(500).json({ error: 'Error gestionando suscripción' });
    }
});

// Suspender suscripción
router.post('/subscriptions/:userId/suspend', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            `UPDATE subscriptions SET status = 'suspended' WHERE user_id = $1`,
            [userId]
        );

        console.log(`⏸️ Suscripción suspendida para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Suscripción suspendida'
        });
    } catch (error) {
        console.error('Error suspendiendo suscripción:', error);
        res.status(500).json({ error: 'Error suspendiendo suscripción' });
    }
});

// Reactivar suscripción
router.post('/subscriptions/:userId/reactivate', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            `UPDATE subscriptions SET status = 'active' WHERE user_id = $1`,
            [userId]
        );

        console.log(`▶️ Suscripción reactivada para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Suscripción reactivada'
        });
    } catch (error) {
        console.error('Error reactivando suscripción:', error);
        res.status(500).json({ error: 'Error reactivando suscripción' });
    }
});

// Resetear contador de uso
router.post('/subscriptions/:userId/reset-usage', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            `UPDATE subscriptions SET usage_count = 0 WHERE user_id = $1`,
            [userId]
        );

        console.log(`🔄 Contador de uso reseteado para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Contador de uso reseteado'
        });
    } catch (error) {
        console.error('Error reseteando contador:', error);
        res.status(500).json({ error: 'Error reseteando contador' });
    }
});

// ==================== LOGS Y AUDITORÍA ====================

// Ver logs de uso
router.get('/logs', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { limit = 100, userId, scriptName, success } = req.query;

    try {
        let query = `
            SELECT l.*, u.email
            FROM usage_logs l
            JOIN users u ON l.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (userId) {
            params.push(userId);
            query += ` AND l.user_id = $${params.length}`;
        }

        if (scriptName) {
            params.push(scriptName);
            query += ` AND l.script_name = $${params.length}`;
        }

        if (success !== undefined) {
            params.push(success === 'true');
            query += ` AND l.success = $${params.length}`;
        }

        query += ` ORDER BY l.execution_date DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const result = await db.query(query, params);

        res.json({
            success: true,
            count: result.rows.length,
            logs: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo logs:', error);
        res.status(500).json({ error: 'Error obteniendo logs' });
    }
});

// Estadísticas generales del sistema
router.get('/stats/overview', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        // Total usuarios
        const usersResult = await db.query('SELECT COUNT(*) as total FROM users');

        // Suscripciones activas
        const activeSubsResult = await db.query(
            `SELECT COUNT(*) as total FROM subscriptions WHERE status = 'active' AND expires_at > NOW()`
        );

        // Total ejecuciones hoy
        const execsTodayResult = await db.query(
            `SELECT COUNT(*) as total FROM usage_logs WHERE DATE(execution_date) = CURRENT_DATE`
        );

        // Ejecuciones exitosas vs fallidas hoy
        const successRateResult = await db.query(`
            SELECT 
                SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failed
            FROM usage_logs 
            WHERE DATE(execution_date) = CURRENT_DATE
        `);

        // Scripts más usados (últimos 7 días)
        const topScriptsResult = await db.query(`
            SELECT script_name, COUNT(*) as executions
            FROM usage_logs
            WHERE execution_date > NOW() - INTERVAL '7 days'
            GROUP BY script_name
            ORDER BY executions DESC
            LIMIT 5
        `);

        // Usuarios por plan
        const planStatsResult = await db.query(`
            SELECT s.plan, p.display_name, COUNT(*) as user_count
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE s.status = 'active' AND s.expires_at > NOW()
            GROUP BY s.plan, p.display_name
            ORDER BY user_count DESC
        `);

        // Usuarios pendientes de activación
        const pendingResult = await db.query(`
            SELECT COUNT(*) as total FROM users
            WHERE registration_status IN ('pending_email','pending_payment')
        `);

        res.json({
            success: true,
            stats: {
                totalUsers: parseInt(usersResult.rows[0].total),
                activeSubscriptions: parseInt(activeSubsResult.rows[0].total),
                executionsToday: parseInt(execsTodayResult.rows[0].total),
                successRate: {
                    successful: parseInt(successRateResult.rows[0].successful || 0),
                    failed: parseInt(successRateResult.rows[0].failed || 0)
                },
                topScripts: topScriptsResult.rows,
                planStats: planStatsResult.rows,
                pendingUsers: parseInt(pendingResult.rows[0].total),
                cache: getCacheStats()
            }
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
});

// ==================== TICKETS DE SOPORTE ====================

// Listar todos los tickets (con filtros)
router.get('/tickets', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { status, category, priority, userId, limit = 100 } = req.query;

    try {
        let query = `
            SELECT t.id, t.category, t.title, t.status, t.priority,
                   t.priority_source, t.priority_notes, t.priority_set_at, t.priority_set_by,
                   t.benefit_type, t.benefit_applied,
                   t.created_at, t.updated_at, t.resolved_at,
                   u.email AS user_email, u.id AS user_id
            FROM support_tickets t
            JOIN users u ON t.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            params.push(status);
            query += ` AND t.status = $${params.length}`;
        }
        if (category) {
            params.push(category);
            query += ` AND t.category = $${params.length}`;
        }
        if (priority) {
            params.push(priority);
            query += ` AND t.priority = $${params.length}`;
        }
        if (userId) {
            params.push(userId);
            query += ` AND t.user_id = $${params.length}`;
        }

        query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));

        const result = await db.query(query, params);

        res.json({
            success: true,
            count: result.rows.length,
            tickets: result.rows
        });
    } catch (error) {
        console.error('Error listando tickets:', error);
        res.status(500).json({ error: 'Error listando tickets' });
    }
});

// Detalle de un ticket
router.get('/tickets/:id', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const ticketResult = await db.query(`
            SELECT t.*, u.email AS user_email, u.id AS user_id
            FROM support_tickets t
            JOIN users u ON t.user_id = u.id
            WHERE t.id = $1
        `, [id]);

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        const commentsResult = await db.query(`
            SELECT tc.id, tc.author_role, tc.message, tc.visibility, tc.created_at,
                   u.email AS author_email
            FROM ticket_comments tc
            JOIN users u ON tc.author_id = u.id
            WHERE tc.ticket_id = $1
            ORDER BY tc.created_at ASC
        `, [id]);

        res.json({
            success: true,
            ticket: ticketResult.rows[0],
            comments: commentsResult.rows
        });
    } catch (error) {
        console.error('Error obteniendo ticket:', error);
        res.status(500).json({ error: 'Error obteniendo ticket' });
    }
});

// Cambiar estado del ticket
router.put('/tickets/:id/status', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const db = req.app.get('db');

    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }

    try {
        const resolvedAt = status === 'resolved' ? 'NOW()' : 'NULL';
        await db.query(`
            UPDATE support_tickets
            SET status = $1, resolved_at = ${resolvedAt}
            WHERE id = $2
        `, [status, id]);

        console.log(`🎫 Ticket #${id} → estado '${status}' por admin: ${req.user.id}`);
        res.json({ success: true, message: `Ticket actualizado a estado '${status}'` });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: 'Error actualizando estado' });
    }
});

// Cambiar prioridad del ticket — modelo con toggle ai_managed
// Body: { priority, ai_managed?: boolean }
//
// Lógica:
//   - ai_managed=true  + prioridad cambió      → source=NULL (próximo IA-run la procesa)
//   - ai_managed=true  + prioridad no cambió   → source NO se toca (NULL o 'ai')
//   - ai_managed=false                         → source='manual' (locked, IA nunca toca)
//
// Backward compat:
//   - Si ai_managed no se envía, usa lógica vieja:
//     source previo 'ai' → 'ai_overridden'; otro → 'manual'
router.put('/tickets/:id/priority', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { priority, ai_managed } = req.body;
    const db = req.app.get('db');

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
        return res.status(400).json({ error: 'Prioridad inválida' });
    }

    try {
        const cur = await db.query(
            'SELECT priority, priority_source FROM support_tickets WHERE id = $1',
            [id]
        );
        if (cur.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        const prevPriority = cur.rows[0].priority;
        const prevSource   = cur.rows[0].priority_source;
        const priorityChanged = priority !== prevPriority;

        let newSource;
        if (typeof ai_managed === 'boolean') {
            // Modo nuevo (toggle explícito)
            if (ai_managed) {
                // IA gestiona:
                //   - Si prevSource era 'manual' o 'ai_overridden' → reset a NULL (transición de locked a unlocked)
                //   - Si prioridad cambió → reset a NULL (próximo IA-run lo procesa con nuevo punto de partida)
                //   - Si ya era 'ai' o NULL y no cambió → preservar
                if (prevSource === 'manual' || prevSource === 'ai_overridden' || priorityChanged) {
                    newSource = null;
                } else {
                    newSource = prevSource; // 'ai' o NULL → preservar
                }
            } else {
                // Admin gestiona: fijo manual
                newSource = 'manual';
            }
        } else {
            // Modo legacy (sin ai_managed)
            newSource = prevSource === 'ai' ? 'ai_overridden' : 'manual';
        }

        // Si source no cambia Y prioridad no cambia → no hagas nada (idempotente)
        if (newSource === prevSource && !priorityChanged) {
            return res.json({
                success: true,
                message: 'Sin cambios',
                priority_source: prevSource,
                noop: true
            });
        }

        // Limpiar notes/set_by si pasamos de 'ai' a otro source (ya no aplica el razonamiento)
        const clearNotes = (prevSource === 'ai' && newSource !== 'ai');
        await db.query(`
            UPDATE support_tickets
            SET priority = $1,
                priority_source = $2,
                priority_set_at = NOW(),
                priority_set_by = $3
                ${clearNotes ? ', priority_notes = NULL' : ''}
            WHERE id = $4
        `, [priority, newSource, req.user.id, id]);

        console.log(`🎫 Ticket #${id} → prioridad '${priority}' (source=${newSource ?? 'NULL'}) por admin: ${req.user.id}`);
        res.json({
            success: true,
            message: 'Prioridad actualizada',
            priority,
            priority_source: newSource
        });
    } catch (error) {
        console.error('Error actualizando prioridad:', error);
        res.status(500).json({ error: 'Error actualizando prioridad' });
    }
});

// Resetear prioridad — vuelve a permitir que la IA la gestione
router.post('/tickets/:id/reset-priority', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            UPDATE support_tickets
            SET priority_source = NULL, priority_notes = NULL, priority_set_at = NULL, priority_set_by = NULL
            WHERE id = $1 RETURNING id
        `, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket no encontrado' });
        console.log(`🔄 Ticket #${id} → prioridad reseteada por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Prioridad reseteada — próxima ejecución de IA la actualizará' });
    } catch (error) {
        console.error('Error reseteando prioridad:', error);
        res.status(500).json({ error: 'Error reseteando prioridad' });
    }
});

// Responder como admin (agregar comentario)
router.post('/tickets/:id/comment', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { message, visibility = 'external' } = req.body;
    const db = req.app.get('db');

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    if (!['external', 'internal'].includes(visibility)) {
        return res.status(400).json({ error: "visibility debe ser 'external' o 'internal'" });
    }

    try {
        // Traer ticket + datos del usuario para envío de email
        const ticketCheck = await db.query(`
            SELECT t.id, t.title, t.user_id, t.status AS ticket_status,
                   u.email, u.nombre, u.role
            FROM support_tickets t
            JOIN users u ON u.id = t.user_id
            WHERE t.id = $1
        `, [id]);
        if (ticketCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        const ticket = ticketCheck.rows[0];

        const result = await db.query(`
            INSERT INTO ticket_comments (ticket_id, author_id, author_role, message, visibility)
            VALUES ($1, $2, 'admin', $3, $4)
            RETURNING id, author_role, message, visibility, created_at
        `, [id, req.user.id, message.trim(), visibility]);

        // Cambia estado a in_progress si estaba abierto Y la respuesta es externa
        // (las notas internas no cambian el estado del ticket — son solo para admin)
        if (visibility === 'external' && ticket.ticket_status === 'open') {
            await db.query(`UPDATE support_tickets SET status = 'in_progress' WHERE id = $1`, [id]);
        }

        console.log(`💬 Admin ${req.user.id} respondió ticket #${id} [visibility=${visibility}]`);

        // Notificación por email al usuario SOLO si la respuesta es externa
        // Feature flag EMAIL_TICKET_REPLY_ENABLED en .env controla activación
        if (visibility === 'external') {
            try {
                sendTicketReplyEmail(
                    ticket.email,
                    ticket.nombre,
                    ticket.id,
                    ticket.title,
                    message.trim()
                ).catch(err => {
                    console.error(`⚠️ Error enviando email de respuesta a ticket #${id}:`, err.message);
                });
            } catch (mailErr) {
                console.error(`⚠️ Error preparando email de respuesta:`, mailErr.message);
                // No interrumpe la respuesta — el comentario ya se guardó OK
            }
        } else {
            console.log(`📝 Nota interna en ticket #${id} — no se envía email al usuario`);
        }

        res.status(201).json({ success: true, comment: result.rows[0] });
    } catch (error) {
        console.error('Error respondiendo ticket:', error);
        res.status(500).json({ error: 'Error respondiendo ticket' });
    }
});

// Aplicar beneficio comercial a un ticket
router.post('/tickets/:id/apply-benefit', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { benefit_type, benefit_value } = req.body;
    const db = req.app.get('db');

    const validBenefits = ['discount', 'plan_upgrade', 'usage_reset'];
    if (!validBenefits.includes(benefit_type)) {
        return res.status(400).json({ error: 'Tipo de beneficio inválido' });
    }

    try {
        // Obtener el ticket y el user_id
        const ticketResult = await db.query(`
            SELECT t.id, t.user_id, t.benefit_applied
            FROM support_tickets t
            WHERE t.id = $1
        `, [id]);

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        const ticket = ticketResult.rows[0];

        if (ticket.benefit_applied) {
            return res.status(400).json({ error: 'Ya se aplicó un beneficio a este ticket' });
        }

        const planLimits = { BASIC: 100, PRO: 1000, ENTERPRISE: 999999 };

        // Aplicar beneficio según tipo
        if (benefit_type === 'discount') {
            // Extiende la suscripción N días
            const days = parseInt(benefit_value) || 30;
            await db.query(`
                UPDATE subscriptions
                SET expires_at = expires_at + INTERVAL '${days} days'
                WHERE user_id = $1
            `, [ticket.user_id]);
            console.log(`🎁 Descuento: suscripción de usuario ${ticket.user_id} extendida ${days} días por admin ${req.user.id}`);

        } else if (benefit_type === 'plan_upgrade') {
            // Actualiza el plan
            const newPlan = String(benefit_value).toUpperCase();
            if (!planLimits[newPlan]) {
                return res.status(400).json({ error: 'Plan inválido para upgrade' });
            }
            await db.query(`
                UPDATE subscriptions
                SET plan = $1, usage_limit = $2
                WHERE user_id = $3
            `, [newPlan, planLimits[newPlan], ticket.user_id]);
            console.log(`⬆️ Plan upgrade: usuario ${ticket.user_id} → ${newPlan} por admin ${req.user.id}`);

        } else if (benefit_type === 'usage_reset') {
            // Resetea el contador de uso
            await db.query(`
                UPDATE subscriptions SET usage_count = 0 WHERE user_id = $1
            `, [ticket.user_id]);
            console.log(`🔄 Usage reset: usuario ${ticket.user_id} por admin ${req.user.id}`);
        }

        // Marcar ticket como beneficio aplicado y resolverlo
        await db.query(`
            UPDATE support_tickets
            SET benefit_applied = TRUE, benefit_type = $1, benefit_value = $2,
                status = 'resolved', resolved_at = NOW()
            WHERE id = $3
        `, [benefit_type, benefit_value || null, id]);

        res.json({
            success: true,
            message: `Beneficio '${benefit_type}' aplicado correctamente`
        });
    } catch (error) {
        console.error('Error aplicando beneficio:', error);
        res.status(500).json({ error: 'Error aplicando beneficio' });
    }
});

// ==================== PLANES ====================

// Listar todos los planes
router.get('/plans', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`SELECT * FROM plans ORDER BY id ASC`);
        res.json({ success: true, plans: result.rows });
    } catch (error) {
        console.error('Error obteniendo planes:', error);
        res.status(500).json({ error: 'Error obteniendo planes' });
    }
});

// Crear plan
router.post('/plans', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const {
        name, display_name, description,
        proc_executions_limit, proc_expedientes_limit,
        batch_executions_limit, batch_expedientes_limit,
        informe_limit,
        monitor_partes_limit, monitor_novedades_limit,
        period_days, extension_flows
    } = req.body;

    if (!name || !display_name) {
        return res.status(400).json({ error: 'name y display_name son obligatorios' });
    }

    try {
        const result = await db.query(`
            INSERT INTO plans (name, display_name, description,
                proc_executions_limit, proc_expedientes_limit,
                batch_executions_limit, batch_expedientes_limit,
                informe_limit, monitor_partes_limit, monitor_novedades_limit, period_days,
                extension_flows)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING *
        `, [
            name.toUpperCase(), display_name, description || null,
            proc_executions_limit ?? 50, proc_expedientes_limit ?? -1,
            batch_executions_limit ?? 20, batch_expedientes_limit ?? 10,
            informe_limit ?? 10,
            monitor_partes_limit ?? 3, monitor_novedades_limit ?? 10,
            period_days ?? 30,
            JSON.stringify(extension_flows ?? [])
        ]);
        console.log(`Plan "${name}" creado por admin: ${req.user.id}`);
        res.json({ success: true, plan: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'Ya existe un plan con ese nombre' });
        console.error('Error creando plan:', error);
        res.status(500).json({ error: 'Error creando plan' });
    }
});

// Actualizar plan
router.put('/plans/:planId', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { planId } = req.params;
    const {
        display_name, description,
        proc_executions_limit, proc_expedientes_limit,
        batch_executions_limit, batch_expedientes_limit,
        informe_limit, monitor_partes_limit, monitor_novedades_limit,
        period_days, active, extension_flows,
        // Campos de promo
        price_usd, price_ars, plan_type,
        promo_type, promo_end_date, promo_max_users, promo_alert_days
    } = req.body;

    try {
        const result = await db.query(`
            UPDATE plans SET
                display_name = COALESCE($1, display_name),
                description = COALESCE($2, description),
                proc_executions_limit = COALESCE($3, proc_executions_limit),
                proc_expedientes_limit = COALESCE($4, proc_expedientes_limit),
                batch_executions_limit = COALESCE($5, batch_executions_limit),
                batch_expedientes_limit = COALESCE($6, batch_expedientes_limit),
                informe_limit = COALESCE($7, informe_limit),
                monitor_partes_limit = COALESCE($8, monitor_partes_limit),
                monitor_novedades_limit = COALESCE($9, monitor_novedades_limit),
                period_days = COALESCE($10, period_days),
                active = COALESCE($11, active),
                extension_flows = COALESCE($12, extension_flows),
                price_usd = COALESCE($13, price_usd),
                price_ars = COALESCE($14, price_ars),
                plan_type = COALESCE($15, plan_type),
                promo_type = $16,
                promo_end_date = $17,
                promo_max_users = COALESCE($18, promo_max_users),
                promo_alert_days = COALESCE($19, promo_alert_days),
                updated_at = NOW()
            WHERE id = $20
            RETURNING *
        `, [
            display_name, description,
            proc_executions_limit, proc_expedientes_limit,
            batch_executions_limit, batch_expedientes_limit,
            informe_limit, monitor_partes_limit, monitor_novedades_limit,
            period_days, active,
            extension_flows !== undefined ? JSON.stringify(extension_flows) : null,
            price_usd ?? null, price_ars ?? null, plan_type ?? null,
            promo_type !== undefined ? promo_type : undefined,
            promo_end_date !== undefined ? promo_end_date : undefined,
            promo_max_users ?? null,
            promo_alert_days ?? null,
            planId
        ]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Plan no encontrado' });
        console.log(`Plan ${planId} actualizado por admin: ${req.user.id}`);
        res.json({ success: true, plan: result.rows[0] });
    } catch (error) {
        console.error('Error actualizando plan:', error);
        res.status(500).json({ error: 'Error actualizando plan' });
    }
});

// Desactivar plan (soft delete)
router.delete('/plans/:planId', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { planId } = req.params;
    try {
        await db.query(`UPDATE plans SET active = false WHERE id = $1`, [planId]);
        console.log(`Plan ${planId} desactivado por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Plan desactivado' });
    } catch (error) {
        console.error('Error desactivando plan:', error);
        res.status(500).json({ error: 'Error desactivando plan' });
    }
});

// Activar plan
router.patch('/plans/:planId/activate', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { planId } = req.params;
    try {
        await db.query(`UPDATE plans SET active = true WHERE id = $1`, [planId]);
        console.log(`Plan ${planId} activado por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Plan activado' });
    } catch (error) {
        console.error('Error activando plan:', error);
        res.status(500).json({ error: 'Error activando plan' });
    }
});

// ==================== AJUSTES DE USO ====================

// Otorgar/deducir usos adicionales por subsistema
router.post('/subscriptions/:userId/adjust', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    const { subsystem, amount, reason, ticket_id } = req.body;

    const validSubsystems = ['proc', 'batch', 'informe', 'monitor_novedades', 'monitor_partes'];
    if (!validSubsystems.includes(subsystem)) {
        return res.status(400).json({ error: `Subsistema inválido. Válidos: ${validSubsystems.join(', ')}` });
    }
    if (!amount || isNaN(amount)) {
        return res.status(400).json({ error: 'amount debe ser un número entero' });
    }

    const bonusCol = {
        'proc':                  'proc_bonus',
        'batch':                 'batch_bonus',
        'informe':               'informe_bonus',
        'monitor_novedades':     'monitor_novedades_bonus',
        'monitor_partes':        'monitor_partes_bonus'
    }[subsystem];

    try {
        // Verificar usuario
        const userCheck = await db.query(`SELECT email FROM users WHERE id = $1`, [userId]);
        if (userCheck.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Aplicar bonificación en subscriptions
        const updateResult = await db.query(`
            UPDATE subscriptions
            SET ${bonusCol} = GREATEST(0, ${bonusCol} + $1)
            WHERE user_id = $2
            RETURNING ${bonusCol}
        `, [parseInt(amount), userId]);

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'El usuario no tiene suscripción' });
        }

        // Registrar ajuste en historial
        await db.query(`
            INSERT INTO usage_adjustments (user_id, admin_email, subsystem, amount, reason, ticket_id)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [userId, req.user.id, subsystem, parseInt(amount), reason || null, ticket_id || null]);

        const action = parseInt(amount) > 0 ? `+${amount}` : `${amount}`;
        console.log(`Ajuste ${action} usos de "${subsystem}" para usuario ${userId} por admin: ${req.user.id}. Motivo: ${reason}`);

        res.json({
            success: true,
            message: `Ajuste aplicado: ${action} usos de ${subsystem}`,
            newBonus: updateResult.rows[0][bonusCol]
        });
    } catch (error) {
        console.error('Error aplicando ajuste:', error);
        res.status(500).json({ error: 'Error aplicando ajuste' });
    }
});

// Historial de ajustes de un usuario
router.get('/subscriptions/:userId/adjustments', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    try {
        const result = await db.query(`
            SELECT ua.*, t.title as ticket_title
            FROM usage_adjustments ua
            LEFT JOIN support_tickets t ON ua.ticket_id = t.id
            WHERE ua.user_id = $1
            ORDER BY ua.created_at DESC
            LIMIT 50
        `, [userId]);
        res.json({ success: true, adjustments: result.rows });
    } catch (error) {
        console.error('Error obteniendo ajustes:', error);
        res.status(500).json({ error: 'Error obteniendo ajustes' });
    }
});

// Reset de uso por subsistema (separado del reset general)
router.post('/subscriptions/:userId/reset-subsystem', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    const { subsystem } = req.body; // 'proc', 'informe', 'monitor_novedades', o 'all'

    try {
        let setClauses = [];
        if (subsystem === 'proc' || subsystem === 'all')               setClauses.push('proc_usage = 0');
        if (subsystem === 'batch' || subsystem === 'all')               setClauses.push('batch_usage = 0');
        if (subsystem === 'informe' || subsystem === 'all')             setClauses.push('informe_usage = 0');
        if (subsystem === 'monitor_novedades' || subsystem === 'all')   setClauses.push('monitor_novedades_usage = 0');
        if (subsystem === 'all') {
            setClauses.push('usage_count = 0');
            setClauses.push('proc_bonus = 0');
            setClauses.push('batch_bonus = 0');
            setClauses.push('informe_bonus = 0');
            setClauses.push('monitor_novedades_bonus = 0');
            setClauses.push('monitor_partes_bonus = 0');
        }

        if (setClauses.length === 0) return res.status(400).json({ error: 'Subsistema inválido' });

        await db.query(
            `UPDATE subscriptions SET ${setClauses.join(', ')} WHERE user_id = $1`,
            [userId]
        );

        console.log(`Reset de uso "${subsystem}" para usuario ${userId} por admin: ${req.user.id}`);
        res.json({ success: true, message: `Uso de "${subsystem}" reseteado` });
    } catch (error) {
        console.error('Error reseteando uso:', error);
        res.status(500).json({ error: 'Error reseteando uso' });
    }
});

// ─── MONITOREO (solo lectura para admin) ──────────────────────────────────────

// GET /admin/monitor/partes — partes activas (opcionalmente filtradas por ?userId=)
router.get('/monitor/partes', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.query;
    try {
        const params = [];
        const extraWhere = userId ? `AND mp.user_id = $1` : '';
        if (userId) params.push(userId);

        const result = await db.query(`
            SELECT mp.id, mp.nombre_parte, mp.jurisdiccion_sigla, mp.jurisdiccion_codigo,
                   mp.tiene_linea_base, mp.activo,
                   mp.fecha_creacion, mp.fecha_ultima_modificacion,
                   u.email AS usuario_email,
                   COUNT(DISTINCT me.id) FILTER (WHERE me.confirmado = true)  AS exp_confirmados,
                   COUNT(DISTINCT me.id) FILTER (WHERE me.confirmado = false AND me.es_linea_base = false) AS novedades_pendientes
            FROM monitor_partes mp
            JOIN users u ON u.id = mp.user_id
            LEFT JOIN monitor_expedientes me ON me.parte_id = mp.id
            WHERE mp.activo = true ${extraWhere}
            GROUP BY mp.id, u.email
            ORDER BY mp.fecha_creacion DESC
        `, params);
        res.json({ success: true, partes: result.rows, total: result.rows.length });
    } catch (error) {
        console.error('Error en GET /admin/monitor/partes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// DELETE /admin/monitor/partes/:parteId — eliminar parte y sus expedientes
router.delete('/monitor/partes/:parteId', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { parteId } = req.params;
    try {
        const check = await db.query(`SELECT id, nombre_parte, user_id FROM monitor_partes WHERE id = $1`, [parteId]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Parte no encontrada' });

        await db.query(`DELETE FROM monitor_expedientes WHERE parte_id = $1`, [parteId]);
        await db.query(`DELETE FROM monitor_partes WHERE id = $1`, [parteId]);

        console.log(`🗑️ Parte ${parteId} (${check.rows[0].nombre_parte}) eliminada por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Parte eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando parte:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// GET /admin/monitor/stats — estadísticas globales de monitoreo
router.get('/monitor/stats', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [partesR, expR, novedadesR, consultasR] = await Promise.all([
            db.query(`SELECT COUNT(*) FROM monitor_partes WHERE activo = true`),
            db.query(`SELECT COUNT(*) FROM monitor_expedientes WHERE confirmado = true`),
            db.query(`SELECT COUNT(*) FROM monitor_expedientes WHERE confirmado = false AND es_linea_base = false`),
            db.query(`SELECT COUNT(*) FROM monitor_consultas_log WHERE date_trunc('month', fecha_ejecucion) = date_trunc('month', NOW())`),
        ]);
        res.json({
            success: true,
            partes_activas:       parseInt(partesR.rows[0].count),
            expedientes_confirmados: parseInt(expR.rows[0].count),
            novedades_pendientes: parseInt(novedadesR.rows[0].count),
            consultas_este_mes:   parseInt(consultasR.rows[0].count),
        });
    } catch (error) {
        console.error('Error en GET /admin/monitor/stats:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ============================================================================
// IA: priorización masiva de tickets (Fase 4 Ítem 2)
// ============================================================================

const https = require('https');

// Rate limiter en memoria: máximo 100 tickets procesados/hora por admin
const aiPriorityRateLimits = new Map(); // adminId → { count, resetAt }

function checkAiPriorityRateLimit(adminId, count) {
    const now = Date.now();
    const entry = aiPriorityRateLimits.get(adminId);
    if (!entry || now > entry.resetAt) {
        aiPriorityRateLimits.set(adminId, { count, resetAt: now + 3600000 });
        return { ok: true, remaining: 100 - count };
    }
    if (entry.count + count > 100) {
        return { ok: false, remaining: Math.max(0, 100 - entry.count), resetIn: Math.ceil((entry.resetAt - now) / 60000) };
    }
    entry.count += count;
    return { ok: true, remaining: 100 - entry.count };
}

const AI_PRIORITY_SYSTEM_PROMPT = `Sos un asistente que clasifica tickets de soporte de Procurador SCW por prioridad.

CONTEXTO DEL SISTEMA:
Procurador SCW es una herramienta de automatización judicial para abogados argentinos. Automatiza tres operaciones en el sistema PJN: (1) procuración de expedientes, (2) generación de informes, (3) monitor de partes. Usa Puppeteer con el Chrome del usuario. Las credenciales del PJN viven solo en Chrome (no en servidor). Sistema de planes: EXTENSION_PROMO (USD 1/mes), COMBO_PROMO (USD 9.99/mes), BASIC, PRO, ENTERPRISE.

CRITERIOS DE PRIORIDAD:

🟢 low (Baja):
- Consultas comerciales (cambio de plan, precios, planes futuros)
- Preguntas de "cómo usar X" sin bloqueo
- Sugerencias o feedback
- Dudas sobre facturación general (no urgente)

🟡 medium (Media):
- Funcionalidad parcial: algo funciona mal pero no bloquea el trabajo
- Errores intermitentes no críticos
- Consultas sobre límites del plan
- Pedidos de mejora con cierta urgencia

🔴 high (Alta):
- Login al PJN falla sistemáticamente
- Proceso no arranca o se cuelga
- Pérdida parcial de datos / resultados incorrectos
- Plan PRO o ENTERPRISE con problemas operativos
- Problema bloqueante reproducible

🚨 urgent (Urgente):
- Servicio completamente caído desde la perspectiva del usuario
- Pérdida total de datos o resultados corruptos
- Error de cobro / pago duplicado / cargo no autorizado
- Suspensión incorrecta de cuenta
- Cualquier issue de seguridad reportado por el usuario

FORMATO DE RESPUESTA (JSON estricto, sin texto adicional):
{
  "priority": "low" | "medium" | "high" | "urgent",
  "notes": "breve razonamiento en 1-2 frases (máx 200 chars)"
}

Sé conservador: ante duda entre dos niveles, elegí el menor. La sobre-priorización satura al equipo de soporte.`;

async function classifyTicketWithHaiku(ticket) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return reject(new Error('ANTHROPIC_API_KEY no configurada'));

        const userPrompt = `Clasificá este ticket:

CATEGORÍA: ${ticket.category}
PLAN DEL USUARIO: ${ticket.plan_name || 'desconocido'}
TÍTULO: ${ticket.title}
DESCRIPCIÓN:
${ticket.description}`;

        const body = JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 300,
            system: AI_PRIORITY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
        });

        const req = https.request({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 30000,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Anthropic API ${res.statusCode}: ${data.substring(0, 200)}`));
                }
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.content?.[0]?.text || '';
                    // El modelo a veces envuelve en ```json...```
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) return reject(new Error('Respuesta IA sin JSON válido'));
                    const result = JSON.parse(jsonMatch[0]);
                    if (!['low','medium','high','urgent'].includes(result.priority)) {
                        return reject(new Error(`Priority inválido: ${result.priority}`));
                    }
                    resolve({ priority: result.priority, notes: String(result.notes || '').substring(0, 500) });
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout llamando a Anthropic')); });
        req.write(body);
        req.end();
    });
}

// POST /admin/tickets/ai-prioritize
// Body: { ticket_ids?: [int] } — si vacío, procesa tickets sin priority_source o con source='ai'
router.post('/tickets/ai-prioritize', authenticateAdmin, async (req, res) => {
    if (process.env.ANTHROPIC_API_KEY === undefined) {
        return res.status(503).json({ error: 'Servicio de IA no disponible — ANTHROPIC_API_KEY no configurada' });
    }
    const db = req.app.get('db');
    const { ticket_ids } = req.body || {};

    try {
        // Seleccionar tickets a procesar (excluye siempre 'ai_overridden' y 'manual')
        let tickets;
        if (Array.isArray(ticket_ids) && ticket_ids.length > 0) {
            const ids = ticket_ids.map(Number).filter(n => Number.isInteger(n));
            if (ids.length === 0) return res.status(400).json({ error: 'ticket_ids inválido' });
            const result = await db.query(`
                SELECT t.id, t.category, t.title, t.description, t.priority_source,
                       p.name AS plan_name
                FROM support_tickets t
                JOIN users u ON u.id = t.user_id
                LEFT JOIN subscriptions s ON s.user_id = u.id
                LEFT JOIN plans p ON p.id = s.plan_id
                WHERE t.id = ANY($1::int[])
                  AND (t.priority_source IS NULL OR t.priority_source = 'ai')
            `, [ids]);
            tickets = result.rows;
        } else {
            // Default: todos los sin source o con 'ai' (status != 'closed' para no procesar cerrados)
            const result = await db.query(`
                SELECT t.id, t.category, t.title, t.description, t.priority_source,
                       p.name AS plan_name
                FROM support_tickets t
                JOIN users u ON u.id = t.user_id
                LEFT JOIN subscriptions s ON s.user_id = u.id
                LEFT JOIN plans p ON p.id = s.plan_id
                WHERE (t.priority_source IS NULL OR t.priority_source = 'ai')
                  AND t.status != 'closed'
                LIMIT 100
            `);
            tickets = result.rows;
        }

        if (tickets.length === 0) {
            return res.json({ success: true, message: 'No hay tickets para procesar', processed: 0, failed: 0 });
        }

        // Rate limit check
        const rateCheck = checkAiPriorityRateLimit(req.user.id, tickets.length);
        if (!rateCheck.ok) {
            return res.status(429).json({
                error: `Rate limit alcanzado (100 tickets/hora). Restantes: ${rateCheck.remaining}. Reintentar en ~${rateCheck.resetIn} min.`,
                remaining: rateCheck.remaining,
            });
        }

        // Procesar en paralelo (max 5 concurrent para no saturar Anthropic ni la DB)
        const results = { processed: 0, failed: 0, errors: [] };
        const CONCURRENCY = 5;
        for (let i = 0; i < tickets.length; i += CONCURRENCY) {
            const batch = tickets.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (ticket) => {
                try {
                    const cls = await classifyTicketWithHaiku(ticket);
                    await db.query(`
                        UPDATE support_tickets
                        SET priority = $1,
                            priority_source = 'ai',
                            priority_notes = $2,
                            priority_set_at = NOW(),
                            priority_set_by = NULL
                        WHERE id = $3
                    `, [cls.priority, cls.notes, ticket.id]);
                    results.processed++;
                } catch (err) {
                    results.failed++;
                    results.errors.push({ ticket_id: ticket.id, error: err.message });
                    console.error(`❌ AI priority falló ticket #${ticket.id}:`, err.message);
                }
            }));
        }

        console.log(`🤖 AI prioritize: ${results.processed} OK, ${results.failed} fallaron (admin ${req.user.id})`);
        res.json({
            success: true,
            processed: results.processed,
            failed: results.failed,
            errors: results.errors.slice(0, 10), // máximo 10 errores en la respuesta
        });
    } catch (error) {
        console.error('Error en ai-prioritize:', error);
        res.status(500).json({ error: 'Error procesando tickets', detail: error.message });
    }
});

// ============================================================================
// IA: sugerir respuesta para un ticket (Fase 4 Ítem 3)
// ============================================================================

// Rate limit: 30 sugerencias/hora por admin
const aiSuggestRateLimits = new Map();
function checkAiSuggestRateLimit(adminId) {
    const now = Date.now();
    const entry = aiSuggestRateLimits.get(adminId);
    if (!entry || now > entry.resetAt) {
        aiSuggestRateLimits.set(adminId, { count: 1, resetAt: now + 3600000 });
        return { ok: true, remaining: 29 };
    }
    if (entry.count >= 30) {
        return { ok: false, remaining: 0, resetIn: Math.ceil((entry.resetAt - now) / 60000) };
    }
    entry.count++;
    return { ok: true, remaining: 30 - entry.count };
}

const AI_REPLY_SYSTEM_PROMPT = `Sos el asistente del equipo de soporte de Procurador SCW.
Tu rol es PROYECTAR (sugerir) una respuesta que el admin revisará, editará y enviará al usuario.

CONTEXTO DEL SISTEMA:
Procurador SCW es una herramienta de automatización judicial para abogados argentinos. Automatiza tres operaciones en el PJN: (1) procuración de expedientes, (2) generación de informes, (3) monitor de partes. Usa Puppeteer con el Chrome del usuario; las credenciales del PJN viven solo en Chrome. Sistema de planes: EXTENSION_PROMO (USD 1/mes), COMBO_PROMO (USD 9.99/mes), BASIC, PRO, ENTERPRISE.

REGLAS DE LA RESPUESTA:
1. Tono cercano pero profesional. Español rioplatense ("vos", "tenés", "podés", "configurá").
2. Concisa: 2-4 párrafos máximo, sin saludos largos.
3. Si la solución es clara → dala paso a paso, numerada.
4. Si necesitás info adicional del usuario → pedila específica (qué dato, dónde lo encuentra).
5. Si no podés resolverlo → reconocelo y derivá a soporte técnico humano sin disculpas excesivas.
6. NUNCA inventes funcionalidades. Si no estás seguro → sugerí escalada a un ticket técnico.
7. NUNCA exageres ofreciendo reembolsos o cambios de plan sin razón concreta.
8. SI hay notas internas en la conversación → tomalas en cuenta como contexto privado del equipo (no las menciones al usuario).

FORMATO:
Devolvé SOLO el texto de la respuesta (sin saludo "Hola [nombre]" si ya hay historial — el admin lo agrega). Sin marcadores markdown que no se renderizan en email plano.`;

router.post('/tickets/:id/ai-suggest-reply', authenticateAdmin, async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ error: 'Servicio de IA no disponible — ANTHROPIC_API_KEY no configurada' });
    }
    const { id } = req.params;
    const db = req.app.get('db');

    const rate = checkAiSuggestRateLimit(req.user.id);
    if (!rate.ok) {
        return res.status(429).json({ error: `Rate limit alcanzado (30/hora). Reintentar en ~${rate.resetIn} min` });
    }

    try {
        // Contexto completo del ticket
        const ticketResult = await db.query(`
            SELECT t.id, t.category, t.title, t.description, t.priority,
                   u.email, u.nombre,
                   p.name AS plan_name, p.display_name AS plan_display
            FROM support_tickets t
            JOIN users u ON u.id = t.user_id
            LEFT JOIN subscriptions s ON s.user_id = u.id
            LEFT JOIN plans p ON p.id = s.plan_id
            WHERE t.id = $1
        `, [id]);
        if (ticketResult.rows.length === 0) return res.status(404).json({ error: 'Ticket no encontrado' });
        const t = ticketResult.rows[0];

        // Historial COMPLETO (internas + externas) — la IA usa el todo como contexto
        const commentsResult = await db.query(`
            SELECT author_role, message, visibility, created_at
            FROM ticket_comments
            WHERE ticket_id = $1
            ORDER BY created_at ASC
        `, [id]);

        // Armar el prompt user con contexto
        const conversationText = commentsResult.rows.map(c => {
            const role = c.author_role === 'admin' ? 'SOPORTE' : 'USUARIO';
            const visMark = c.visibility === 'internal' ? ' [NOTA INTERNA — no fue al usuario]' : '';
            return `[${role}${visMark}]: ${c.message}`;
        }).join('\n\n');

        const userPrompt = `TICKET #${t.id} (categoría: ${t.category}, prioridad: ${t.priority})
USUARIO: ${t.nombre || t.email} · Plan: ${t.plan_display || t.plan_name || 'desconocido'}

TÍTULO: ${t.title}

DESCRIPCIÓN INICIAL:
${t.description}

${conversationText ? `HISTORIAL DE CONVERSACIÓN:\n${conversationText}\n` : ''}
Generá una respuesta concisa que el admin enviará al usuario.`;

        // Llamada a Anthropic
        const body = JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 600,
            system: AI_REPLY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
        });

        const suggestion = await new Promise((resolve, reject) => {
            const reqAI = https.request({
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Length': Buffer.byteLength(body),
                },
                timeout: 30000,
            }, (rAI) => {
                let data = '';
                rAI.on('data', chunk => data += chunk);
                rAI.on('end', () => {
                    if (rAI.statusCode !== 200) return reject(new Error(`Anthropic ${rAI.statusCode}: ${data.substring(0, 200)}`));
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.content?.[0]?.text?.trim() || '');
                    } catch (e) { reject(e); }
                });
            });
            reqAI.on('error', reject);
            reqAI.on('timeout', () => { reqAI.destroy(); reject(new Error('Timeout')); });
            reqAI.write(body);
            reqAI.end();
        });

        if (!suggestion) {
            return res.status(502).json({ error: 'IA devolvió respuesta vacía' });
        }

        // Telemetría: registrar la sugerencia (action='suggested', se actualiza después si se envía/descarta)
        const logResult = await db.query(`
            INSERT INTO ai_assistance_logs (ticket_id, admin_id, suggested_text, action)
            VALUES ($1, $2, $3, 'suggested')
            RETURNING id
        `, [id, req.user.id, suggestion]);

        console.log(`🤖 AI sugirió respuesta para ticket #${id} (log_id=${logResult.rows[0].id}, ${suggestion.length} chars)`);

        res.json({
            success: true,
            suggestion,
            log_id: logResult.rows[0].id,
        });
    } catch (error) {
        console.error('Error en ai-suggest-reply:', error);
        res.status(500).json({ error: 'Error generando sugerencia', detail: error.message });
    }
});

// PATCH /admin/ai-suggest-logs/:id — actualiza el log cuando admin envía/descarta
// Body: { action: 'sent_as_is'|'sent_edited'|'discarded', final_text?: string }
router.patch('/ai-suggest-logs/:id', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { action, final_text } = req.body;
    const db = req.app.get('db');

    if (!['sent_as_is', 'sent_edited', 'discarded'].includes(action)) {
        return res.status(400).json({ error: 'action inválido' });
    }

    try {
        // Calcular edit_distance simple (cantidad de chars distintos, no Levenshtein real)
        let editDistance = null;
        if (final_text !== undefined) {
            const cur = await db.query(`SELECT suggested_text FROM ai_assistance_logs WHERE id = $1`, [id]);
            if (cur.rows[0]) {
                const orig = cur.rows[0].suggested_text || '';
                // Distancia aproximada: diferencia de length + chars distintos en posiciones comunes
                editDistance = Math.abs(orig.length - (final_text || '').length);
                const minLen = Math.min(orig.length, (final_text || '').length);
                for (let i = 0; i < minLen; i++) {
                    if (orig[i] !== (final_text || '')[i]) editDistance++;
                }
            }
        }

        await db.query(`
            UPDATE ai_assistance_logs
            SET action = $1, final_text = $2, edit_distance = $3, resolved_at = NOW()
            WHERE id = $4
        `, [action, final_text || null, editDistance, id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error actualizando ai_log:', error);
        res.status(500).json({ error: 'Error actualizando log' });
    }
});

// ==================== SMOKE TESTS ====================

const _fs   = require('fs');
const _path = require('path');
const SMOKE_FILE = _path.join(__dirname, '..', 'data', 'smoke-test-results.json');

function _loadSmoke() {
    try { if (_fs.existsSync(SMOKE_FILE)) return JSON.parse(_fs.readFileSync(SMOKE_FILE, 'utf8')); } catch (_) {}
    return { api: null, pjn: null, extension: null };
}

function _saveSmoke(data) {
    const dir = _path.dirname(SMOKE_FILE);
    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
    _fs.writeFileSync(SMOKE_FILE, JSON.stringify(data, null, 2));
}

// GET /admin/smoke-tests/latest
router.get('/smoke-tests/latest', authenticateAdmin, (req, res) => {
    res.json({ success: true, results: _loadSmoke() });
});

// POST /admin/smoke-tests/run-api
router.post('/smoke-tests/run-api', authenticateAdmin, async (req, res) => {
    const axios = require('axios');
    const https = require('https');

    const t0Total = Date.now();
    const checks  = [];
    const logs    = [];

    const BASE    = process.env.API_INTERNAL_URL || 'https://localhost:3443';
    const agent   = new https.Agent({ rejectUnauthorized: false });
    const ax      = axios.create({ baseURL: BASE, httpsAgent: agent, timeout: 8000, validateStatus: () => true });

    function ts() { return new Date().toLocaleTimeString('es-AR'); }

    async function runCheck(method, path, body, expectedStatus, label) {
        const t = Date.now();
        try {
            const cfg = { method, url: path };
            if (body !== null) cfg.data = body;
            const r = await ax(cfg);
            const ok = r.status === expectedStatus;
            const ms = Date.now() - t;
            checks.push({ label, method, path, expectedStatus, actualStatus: r.status, ok, duration: ms });
            logs.push(`[${ts()}] ${ok ? '✅' : '❌'}  ${method.padEnd(4)} ${path.padEnd(36)} ${r.status}  (${ms}ms)`);
        } catch (err) {
            const ms = Date.now() - t;
            checks.push({ label, method, path, expectedStatus, actualStatus: null, ok: false, duration: ms, error: err.message });
            logs.push(`[${ts()}] ❌  ${method.padEnd(4)} ${path.padEnd(36)} ERROR: ${err.message}`);
        }
    }

    logs.push(`[${ts()}] ▶ Iniciando smoke tests API...`);

    await runCheck('GET',  '/health',                   null,                                200, '/health');
    await runCheck('POST', '/auth/login',               {},                                  400, 'POST /auth/login sin body');
    await runCheck('POST', '/auth/login',               { email: 'x@x.com', password: 'wrong', machineId: 'smoke-test' }, 401, 'POST /auth/login creds inválidas');
    await runCheck('GET',  '/auth/register-status',     null,                                200, 'GET /auth/register-status');
    await runCheck('GET',  '/client/scripts/available', null,                                401, 'GET /client/scripts/available sin token');
    await runCheck('POST', '/license/execution/start',  {},                                  401, 'POST /license/execution/start sin token');
    await runCheck('POST', '/auth/portal-login',        {},                                  400, 'POST /auth/portal-login sin body');

    // DB check
    const tDB = Date.now();
    try {
        await req.app.get('db').query('SELECT 1');
        const ms = Date.now() - tDB;
        checks.push({ label: 'PostgreSQL', ok: true, duration: ms });
        logs.push(`[${ts()}] ✅  PostgreSQL                               conectado  (${ms}ms)`);
    } catch (err) {
        const ms = Date.now() - tDB;
        checks.push({ label: 'PostgreSQL', ok: false, duration: ms, error: err.message });
        logs.push(`[${ts()}] ❌  PostgreSQL                               ERROR: ${err.message}`);
    }

    const totalMs = Date.now() - t0Total;
    const passed  = checks.filter(c => c.ok).length;
    const total   = checks.length;

    logs.push(`[${ts()}] ─────────────────────────────────────────────────────`);
    logs.push(`[${ts()}] RESULTADO: ${passed}/${total} ${passed === total ? '✅' : '❌'}  —  duración: ${(totalMs / 1000).toFixed(1)}s`);

    const apiResult = { timestamp: new Date().toISOString(), passed, total, ok: passed === total, duration: totalMs, checks, logs };

    const saved = _loadSmoke();
    saved.api = apiResult;
    _saveSmoke(saved);

    console.log(`[smoke-tests] API ejecutado por admin ${req.user.id}: ${passed}/${total}`);
    res.json({ success: true, result: apiResult });
});

// POST /admin/smoke-tests/report-pjn  (llamado por el script local)
router.post('/smoke-tests/report-pjn', authenticateAdmin, (req, res) => {
    const { result } = req.body;
    if (!result || typeof result !== 'object') {
        return res.status(400).json({ error: 'Se requiere result' });
    }
    const saved = _loadSmoke();
    saved.pjn = { ...result, timestamp: new Date().toISOString(), reportedBy: req.user.email };
    _saveSmoke(saved);
    console.log(`[smoke-tests] PJN reportado por admin ${req.user.id}: ${result.passed}/${result.total}`);
    res.json({ success: true });
});

// POST /admin/smoke-tests/report-extension  (llamado por smoke-test-extension.js local)
router.post('/smoke-tests/report-extension', authenticateAdmin, (req, res) => {
    const { result } = req.body;
    if (!result || typeof result !== 'object') {
        return res.status(400).json({ error: 'Se requiere result' });
    }
    const saved = _loadSmoke();
    saved.extension = { ...result, timestamp: new Date().toISOString(), reportedBy: req.user.email };
    _saveSmoke(saved);
    console.log(`[smoke-tests] Extensión reportada por admin ${req.user.id}: ${result.passed}/${result.total}`);
    res.json({ success: true });
});

// ─── GET /admin/users/:userId/refund-preview ─────────────────────────────────
// Calcula el monto de reembolso proporcional por días restantes en el período actual
router.get('/users/:userId/refund-preview', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const { rows: [sub] } = await db.query(
            `SELECT period_start, next_billing_date, payment_provider, external_subscription_id
             FROM subscriptions WHERE user_id = $1`,
            [userId]
        );
        if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });

        const { rows: [lastPayment] } = await db.query(
            `SELECT amount, currency, created_at FROM payments
             WHERE user_id = $1 AND status = 'approved'
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );

        if (!lastPayment || !sub.period_start || !sub.next_billing_date) {
            return res.json({ hasPayment: false, refundAmount: 0, currency: null, daysRemaining: 0, totalDays: 0 });
        }

        const now = new Date();
        const periodStart = new Date(sub.period_start);
        const periodEnd = new Date(sub.next_billing_date);
        const totalDays = Math.max(1, Math.round((periodEnd - periodStart) / 86400000));
        const daysRemaining = Math.max(0, Math.round((periodEnd - now) / 86400000));
        const refundAmount = Math.round((daysRemaining / totalDays) * parseFloat(lastPayment.amount) * 100) / 100;

        res.json({
            hasPayment: true,
            refundAmount,
            currency: lastPayment.currency || 'ARS',
            daysRemaining,
            totalDays,
            lastPaymentAmount: parseFloat(lastPayment.amount),
            periodEnd: sub.next_billing_date
        });
    } catch (err) {
        console.error('[refund-preview] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /admin/users/:userId/extra-usage ────────────────────────────────────
// Asigna usos extra de cortesía (price_total=0); descuenta de remaining_uses al usar
router.post('/users/:userId/extra-usage', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { extra_uses, reason, expires_at } = req.body || {};
    const db = req.app.get('db');

    const qty = parseInt(extra_uses, 10);
    if (!qty || qty < 1 || qty > 1000) {
        return res.status(400).json({ error: 'extra_uses debe ser un entero entre 1 y 1000' });
    }
    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'El motivo es obligatorio' });
    }

    try {
        const expiry = expires_at ? new Date(expires_at) : null;
        if (expires_at && isNaN(expiry)) {
            return res.status(400).json({ error: 'expires_at inválido' });
        }

        await db.query(
            `INSERT INTO usage_extras (user_id, extra_uses, remaining_uses, reason, created_by_admin_id, expires_at, created_at)
             VALUES ($1, $2, $2, $3, $4, $5, NOW())`,
            [userId, qty, reason.trim(), req.user.id, expiry]
        );
        await db.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'extra_usage_assigned', $3)`,
            [req.user.id, userId, JSON.stringify({ extra_uses: qty, reason })]
        );
        // Notificación in-app
        await db.query(
            `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'extra_usage_assigned', $2)`,
            [userId, `Se te asignaron ${qty} usos adicionales de cortesía.`]
        );
        console.log(`🎁 ${qty} usos extra asignados a usuario ${userId} por admin ${req.user.id}: ${reason}`);
        res.json({ success: true, extra_uses: qty });
    } catch (err) {
        console.error('[extra-usage POST] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /admin/users/:userId/extra-usage ─────────────────────────────────────
router.get('/users/:userId/extra-usage', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const { rows } = await db.query(
            `SELECT ue.id, ue.extra_uses, ue.remaining_uses, ue.reason,
                    ue.expires_at, ue.created_at, u.email AS assigned_by_email
             FROM usage_extras ue
             LEFT JOIN users u ON ue.created_by_admin_id = u.id
             WHERE ue.user_id = $1
             ORDER BY ue.created_at DESC`,
            [userId]
        );
        res.json({ success: true, extras: rows });
    } catch (err) {
        console.error('[extra-usage GET] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /admin/users/:userId/payments ────────────────────────────────────────
router.get('/users/:userId/payments', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    try {
        const { rows } = await db.query(
            `SELECT id, external_payment_id, amount, currency, status,
                    payment_method, plan, period_start, period_end,
                    refund_amount, refunded_at, created_at
             FROM payments
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit]
        );
        res.json({ success: true, payments: rows });
    } catch (err) {
        console.error('[admin payments GET] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /admin/users/:userId/invoices ────────────────────────────────────────
router.get('/users/:userId/invoices', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    try {
        const { rows } = await db.query(
            `SELECT id, invoice_type, cae, numero, amount, pdf_url,
                    status, retry_count, error_message, issued_at, created_at
             FROM invoices
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit]
        );
        res.json({ success: true, invoices: rows });
    } catch (err) {
        console.error('[admin invoices GET] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /admin/settings ─────────────────────────────────────────────────────
// Devuelve todos los valores de app_settings
router.get('/settings', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`SELECT key, value, updated_at FROM app_settings ORDER BY key`);
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = { value: r.value, updated_at: r.updated_at }; });
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Error obteniendo settings:', error);
        res.status(500).json({ error: 'Error obteniendo configuración' });
    }
});

// ─── PUT /admin/settings/:key ─────────────────────────────────────────────────
// Actualiza (o inserta) un valor en app_settings
router.put('/settings/:key', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { key } = req.params;
    const { value } = req.body;

    const ALLOWED_KEYS = ['allow_public_register'];
    if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ error: `Clave '${key}' no permitida` });
    }
    if (value === undefined || value === null) {
        return res.status(400).json({ error: 'Se requiere el campo value' });
    }

    try {
        await db.query(`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [key, String(value)]);
        console.log(`[admin] setting actualizado: ${key} = ${value}`);
        res.json({ success: true, key, value: String(value) });
    } catch (error) {
        console.error('Error actualizando setting:', error);
        res.status(500).json({ error: 'Error actualizando configuración' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN: FACTURACIÓN MANUAL
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /admin/invoices/pending ───────────────────────────────────────────────
// Pagos aprobados que aún no tienen factura PDF emitida
router.get('/invoices/pending', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { search = '' } = req.query;
    try {
        const { rows } = await db.query(`
            SELECT
                p.id          AS payment_id,
                p.created_at  AS payment_date,
                p.amount,
                p.currency,
                p.plan,
                i.id          AS invoice_id,
                u.id          AS user_id,
                u.email,
                u.nombre,
                u.apellido,
                u.cuit,
                u.domicilio,
                CONCAT_WS(' ',
                    u.nombre, u.apellido,
                    '·', u.email,
                    '·', u.cuit,
                    '·', (u.domicilio->>'calle'), (u.domicilio->>'numero') || ',',
                    (u.domicilio->>'localidad') || ',', (u.domicilio->>'provincia')
                ) AS datos_facturacion
            FROM payments p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN invoices i ON i.payment_id = p.id
            WHERE p.status = 'approved'
              AND (i.id IS NULL OR (i.pdf_url IS NULL OR i.pdf_url = ''))
              AND ($1 = '' OR u.email ILIKE $2 OR u.nombre ILIKE $2 OR u.apellido ILIKE $2 OR u.cuit ILIKE $2)
            ORDER BY p.created_at DESC
            LIMIT 100
        `, [search, `%${search}%`]);
        res.json({ pending: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /admin/invoices ───────────────────────────────────────────────────────
// Facturas ya emitidas con PDF, con filtros opcionales
router.get('/invoices', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { search = '', status = '' } = req.query;
    try {
        const { rows } = await db.query(`
            SELECT
                i.id,
                i.numero,
                i.amount,
                i.pdf_url,
                i.status,
                i.issued_at,
                i.created_at,
                p.id          AS payment_id,
                p.created_at  AS payment_date,
                p.plan,
                u.id          AS user_id,
                u.email,
                u.nombre,
                u.apellido,
                u.cuit,
                u.domicilio
            FROM invoices i
            LEFT JOIN payments p ON p.id = i.payment_id
            LEFT JOIN users u ON u.id = i.user_id
            WHERE i.pdf_url IS NOT NULL AND i.pdf_url <> ''
              AND ($1 = '' OR u.email ILIKE $2 OR u.nombre ILIKE $2 OR u.apellido ILIKE $2 OR u.cuit ILIKE $2)
              AND ($3 = '' OR i.status = $3)
            ORDER BY COALESCE(i.issued_at, i.created_at) DESC
            LIMIT 200
        `, [search, `%${search}%`, status]);
        res.json({ invoices: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /admin/invoices/:invoiceId/upload ────────────────────────────────────
// Subir PDF a una factura existente (invoiceId = id de la tabla invoices)
router.post('/invoices/:invoiceId/upload', authenticateAdmin, uploadInvoice.single('pdf'), async (req, res) => {
    const db = req.app.get('db');
    const { invoiceId } = req.params;
    const { numero, invoice_type, cae } = req.body;
    if (!req.file) return res.status(400).json({ error: 'PDF requerido' });

    const pdfUrl = `/invoices/${req.file.filename}`;
    try {
        await db.query(
            `UPDATE invoices
             SET pdf_url      = $1,
                 numero       = COALESCE($2, numero),
                 invoice_type = COALESCE($3, invoice_type),
                 cae          = COALESCE($4, cae),
                 status       = 'issued',
                 issued_at    = NOW(),
                 updated_at   = NOW()
             WHERE id = $5`,
            [pdfUrl, numero || null, invoice_type || null, cae || null, invoiceId]
        );
        res.json({ ok: true, pdf_url: pdfUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /admin/invoices/manual ──────────────────────────────────────────────
// Crea una factura manual no asociada a un pago del sistema
router.post('/invoices/manual', authenticateAdmin, uploadInvoice.single('pdf'), async (req, res) => {
    const db = req.app.get('db');
    const { user_id, amount, issued_at, numero, invoice_type, cae, plan, notes } = req.body;

    if (!user_id || !amount || !issued_at) {
        return res.status(400).json({ error: 'user_id, amount e issued_at son obligatorios' });
    }
    if (!req.file) return res.status(400).json({ error: 'PDF requerido' });

    const pdfUrl = `/invoices/${req.file.filename}`;
    try {
        const { rows: [inv] } = await db.query(
            `INSERT INTO invoices
               (user_id, amount, pdf_url, numero, invoice_type, cae, status, issued_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'issued', $7, NOW())
             RETURNING id`,
            [user_id, amount, pdfUrl, numero || null, invoice_type || 'C', cae || null, issued_at]
        );

        // Registrar plan en el campo invoice_type si aplica (como referencia adicional)
        if (plan) {
            await db.query(
                `UPDATE invoices SET facturante_id = $1 WHERE id = $2`,
                [`concepto:${plan}${notes ? '|notas:' + notes : ''}`, inv.id]
            );
        }

        res.json({ ok: true, invoice_id: inv.id, pdf_url: pdfUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /admin/invoices/from-payment/:paymentId ──────────────────────────────
// Crear registro de factura + subir PDF para un pago que no tiene invoice aún
router.post('/invoices/from-payment/:paymentId', authenticateAdmin, uploadInvoice.single('pdf'), async (req, res) => {
    const db = req.app.get('db');
    const { paymentId } = req.params;
    const { numero } = req.body;
    if (!req.file) return res.status(400).json({ error: 'PDF requerido' });

    const pdfUrl = `/invoices/${req.file.filename}`;
    try {
        // Obtener datos del pago para crear la factura
        const { rows: [pmt] } = await db.query(
            'SELECT user_id, amount, plan FROM payments WHERE id = $1 AND status = $2',
            [paymentId, 'approved']
        );
        if (!pmt) return res.status(404).json({ error: 'Pago no encontrado o no aprobado' });

        // Crear registro de factura
        const { invoice_type: invType, cae } = req.body;
        const { rows: [inv] } = await db.query(
            `INSERT INTO invoices (payment_id, user_id, amount, pdf_url, numero, invoice_type, cae, status, issued_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'issued', NOW(), NOW())
             ON CONFLICT (payment_id) DO UPDATE
               SET pdf_url       = EXCLUDED.pdf_url,
                   numero        = COALESCE(EXCLUDED.numero,       invoices.numero),
                   invoice_type  = COALESCE(EXCLUDED.invoice_type, invoices.invoice_type),
                   cae           = COALESCE(EXCLUDED.cae,          invoices.cae),
                   status        = 'issued',
                   issued_at     = NOW()
             RETURNING id`,
            [paymentId, pmt.user_id, pmt.amount, pdfUrl, numero || null, invType || 'C', cae || null]
        );
        res.json({ ok: true, invoice_id: inv.id, pdf_url: pdfUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;