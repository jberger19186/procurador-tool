const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const authenticateToken = require('../middleware/authenticateToken');

// ─── PUT /usuarios/api/profile ─────────────────────────────────────────────────
// Actualizar datos personales del usuario autenticado
router.put('/profile', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { nombre, apellido, cuit, telefono, domicilio } = req.body;

    if (!nombre && !apellido && !cuit && !telefono && !domicilio) {
        return res.status(400).json({ error: 'Al menos un campo debe ser proporcionado' });
    }

    try {
        // Construir query dinámico
        const fields = [];
        const values = [];
        let idx = 1;

        if (nombre !== undefined) { fields.push(`nombre = $${idx++}`); values.push(nombre.trim()); }
        if (apellido !== undefined) { fields.push(`apellido = $${idx++}`); values.push(apellido.trim()); }
        if (cuit !== undefined) { fields.push(`cuit = $${idx++}`); values.push(cuit.replace(/[-\s]/g, '')); }
        if (telefono !== undefined) { fields.push(`telefono = $${idx++}`); values.push(telefono.trim()); }
        if (domicilio !== undefined) { fields.push(`domicilio = $${idx++}`); values.push(typeof domicilio === 'string' ? domicilio : JSON.stringify(domicilio)); }

        fields.push(`updated_at = NOW()`);
        values.push(userId);

        const result = await db.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, nombre, apellido, email, cuit, telefono, domicilio`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Error actualizando perfil:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── PUT /usuarios/api/password ────────────────────────────────────────────────
// Cambiar contraseña del usuario autenticado
router.put('/password', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'La contraseña actual y la nueva son requeridas' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    }

    try {
        const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);

        res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /usuarios/api/plans ───────────────────────────────────────────────────
// Listar planes activos disponibles (sin auth requerida)
router.get('/plans', async (req, res) => {
    const db = req.app.get('db');

    try {
        const result = await db.query(`
            SELECT id, name, display_name, description, price_usd, price_ars, plan_type,
                   proc_executions_limit, informe_limit, monitor_novedades_limit,
                   batch_executions_limit, monitor_partes_limit, extension_flows,
                   promo_type, promo_end_date, promo_max_users, promo_used_count
            FROM plans
            WHERE active = true
            ORDER BY COALESCE(price_ars, price_usd) ASC NULLS FIRST, id ASC
        `);

        res.json({
            success: true,
            plans: result.rows.map(p => ({
                id: p.id,
                name: p.name,
                displayName: p.display_name,
                description: p.description,
                priceUsd: p.price_usd,
                priceArs: p.price_ars,
                planType: p.plan_type,
                promoType: p.promo_type,
                promoEndDate: p.promo_end_date,
                promoRemaining: p.promo_type === 'quota'
                    ? Math.max(0, (p.promo_max_users || 0) - (p.promo_used_count || 0))
                    : null,
                limits: {
                    proc: p.proc_executions_limit,
                    informe: p.informe_limit,
                    monitorNovedades: p.monitor_novedades_limit,
                    batch: p.batch_executions_limit,
                    monitorPartes: p.monitor_partes_limit,
                }
            }))
        });
    } catch (error) {
        console.error('Error listando planes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /usuarios/api/ai-chat ────────────────────────────────────────────────
// Chat con IA usando Anthropic Claude Haiku. Recibe { messages: [{role, content}] }
// Rate limit: 20 mensajes por usuario por hora (en memoria compartida con /client/ai/chat)
const webChatRateLimits = new Map(); // userId → { count, resetAt }

const WEB_SYSTEM_PROMPT = `Sos el asistente de soporte de Procurador SCW, una plataforma SaaS de automatización judicial para abogados y procuradores argentinos.

Tu rol es ayudar a los usuarios con dudas sobre:
- Procuración de expedientes en el SCW del PJN
- Generación de informes de estado de expedientes
- Monitor de partes (seguimiento automático de partes en el PJN)
- Extensión de Chrome para autocompletar datos en portales del PJN
- Gestión de cuenta, plan y suscripción

Reglas de comportamiento:
- Respondé siempre en español rioplatense (vos, hacé, ingresá).
- Sé conciso y directo. Máximo 3 párrafos cortos por respuesta.
- Si la consulta excede tu conocimiento o requiere acceso a datos del usuario, indicá que abra un ticket de soporte.
- Nunca inventes funcionalidades que no existan. Si no sabés algo, decilo.
- No respondas sobre temas ajenos al producto (política, finanzas, etc.).
- Las credenciales del PJN nunca pasan por los servidores de Procurador; se guardan solo en Chrome del usuario.`;

router.post('/ai-chat', authenticateToken, async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'El campo messages es requerido y debe ser un array' });
    }
    if (messages.length > 20) {
        return res.status(400).json({ error: 'Demasiados mensajes en el historial.' });
    }

    // Rate limit por usuario: 20 mensajes/hora
    const userId = req.user.id;
    const now = Date.now();
    const rl = webChatRateLimits.get(userId) || { count: 0, resetAt: now + 3600000 };
    if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + 3600000; }
    if (rl.count >= 20) {
        return res.status(429).json({ error: 'Límite de consultas alcanzado. Intentá de nuevo en una hora.' });
    }
    rl.count++;
    webChatRateLimits.set(userId, rl);

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
        return res.json({
            reply: 'El asistente IA no está disponible en este momento. Para consultas, usá la sección Soporte.'
        });
    }

    try {
        const https = require('https');
        const payload = JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 400,
            system: WEB_SYSTEM_PROMPT,
            messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
        });

        const response = await new Promise((resolve, reject) => {
            const req2 = https.request({
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }, (r) => {
                let data = '';
                r.on('data', chunk => data += chunk);
                r.on('end', () => {
                    try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
                    catch (e) { reject(new Error('Invalid JSON from Anthropic')); }
                });
            });
            req2.on('error', reject);
            req2.write(payload);
            req2.end();
        });

        if (response.status !== 200 || !response.body.content?.[0]?.text) {
            console.error('Error Anthropic API:', response.status, response.body);
            return res.status(502).json({ error: 'Error al contactar el servicio de IA. Intentá nuevamente.' });
        }

        res.json({ success: true, reply: response.body.content[0].text });
    } catch (error) {
        console.error('Error en ai-chat:', error);
        res.status(500).json({ error: 'Error del servidor al procesar la solicitud de IA.' });
    }
});

// ─── GET /usuarios/api/payments — historial de pagos del usuario ────────────
router.get('/payments', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit || '24', 10), 100);

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
        res.json({ payments: rows });
    } catch (err) {
        console.error('[GET /payments] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /usuarios/api/invoices — historial de facturas del usuario ─────────
router.get('/invoices', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit || '24', 10), 100);

    try {
        const { rows } = await db.query(
            `SELECT id, invoice_type, cae, numero, amount, pdf_url,
                    status, issued_at, created_at
             FROM invoices
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit]
        );
        res.json({ invoices: rows });
    } catch (err) {
        console.error('[GET /invoices] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /usuarios/api/subscription/current — estado enriquecido ────────────
router.get('/subscription/current', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const { rows: [sub] } = await db.query(
            `SELECT s.status, s.plan, s.next_billing_date, s.cancel_at,
                    s.trial_bonus_until, s.payment_provider,
                    s.external_subscription_id, s.last_payment_at,
                    s.usage_count, s.usage_limit, s.auto_renewal,
                    s.payment_grace_ends_at,
                    p.display_name AS plan_display_name
             FROM subscriptions s
             LEFT JOIN plans p ON s.plan_id = p.id
             WHERE s.user_id = $1`,
            [userId]
        );

        if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });

        const { rows: [lastPayment] } = await db.query(
            `SELECT amount, currency, status, created_at
             FROM payments WHERE user_id = $1 AND status = 'approved'
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );

        res.json({
            status:             sub.status,
            plan:               sub.plan,
            planDisplayName:    sub.plan_display_name,
            nextBillingDate:    sub.next_billing_date,
            cancelAt:           sub.cancel_at,
            trialBonusUntil:    sub.trial_bonus_until,
            paymentProvider:    sub.payment_provider,
            hasPaymentMethod:   !!sub.external_subscription_id,
            lastPaymentAt:      sub.last_payment_at,
            usageCount:         sub.usage_count,
            usageLimit:         sub.usage_limit,
            autoRenewal:        sub.auto_renewal,
            paymentGraceEndsAt: sub.payment_grace_ends_at,
            lastApprovedPayment: lastPayment || null
        });
    } catch (err) {
        console.error('[GET /subscription/current] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;
