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
            SELECT id, name, display_name, description, price_usd, plan_type,
                   proc_executions_limit, informe_limit, monitor_novedades_limit,
                   batch_executions_limit, monitor_partes_limit, extension_flows,
                   promo_type, promo_end_date, promo_max_users, promo_used_count
            FROM plans
            WHERE active = true
            ORDER BY price_usd ASC NULLS FIRST, id ASC
        `);

        res.json({
            success: true,
            plans: result.rows.map(p => ({
                id: p.id,
                name: p.name,
                displayName: p.display_name,
                description: p.description,
                priceUsd: p.price_usd,
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
// Chat con IA usando Anthropic API. Recibe { messages: [{role, content}] }
router.post('/ai-chat', authenticateToken, async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'El campo messages es requerido y debe ser un array' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
        return res.json({
            reply: 'El asistente IA no está configurado aún. Para consultas contactá a soporte en la sección Soporte.'
        });
    }

    const SYSTEM_PROMPT = 'Sos el asistente virtual de Procurador SCW, una herramienta de automatización legal para el Poder Judicial de la Nación de Argentina. Ayudás a los usuarios con dudas sobre el sistema, planes, facturación y soporte técnico. Respondé siempre en español, de forma concisa y amable.';

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                system: SYSTEM_PROMPT,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                }))
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Error Anthropic API:', response.status, errText);
            return res.status(502).json({ error: 'Error al contactar el servicio de IA. Intentá nuevamente.' });
        }

        const data = await response.json();
        const reply = data.content?.[0]?.text || 'No se pudo obtener una respuesta.';

        res.json({ success: true, reply });
    } catch (error) {
        console.error('Error en ai-chat:', error);
        res.status(500).json({ error: 'Error del servidor al procesar la solicitud de IA.' });
    }
});

module.exports = router;
