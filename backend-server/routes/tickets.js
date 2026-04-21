const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');

// Todas las rutas requieren autenticación del usuario
router.use(authenticateToken);

// ==================== TICKETS DE USUARIO ====================

// Crear nuevo ticket
router.post('/', async (req, res) => {
    const { category, title, description } = req.body;
    const db = req.app.get('db');
    const userId = req.user.id;

    if (!category || !title || !description) {
        return res.status(400).json({ error: 'Categoría, título y descripción son obligatorios' });
    }

    if (!['technical', 'billing', 'commercial'].includes(category)) {
        return res.status(400).json({ error: 'Categoría inválida' });
    }

    if (title.length > 200) {
        return res.status(400).json({ error: 'El título no puede superar 200 caracteres' });
    }

    try {
        const result = await db.query(`
            INSERT INTO support_tickets (user_id, category, title, description)
            VALUES ($1, $2, $3, $4)
            RETURNING id, category, title, status, priority, created_at
        `, [userId, category, title, description]);

        console.log(`🎫 Ticket #${result.rows[0].id} creado por usuario ${userId}`);

        res.status(201).json({
            success: true,
            ticket: result.rows[0]
        });
    } catch (error) {
        console.error('Error creando ticket:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Listar tickets propios
router.get('/', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { status } = req.query;

    try {
        let query = `
            SELECT id, category, title, status, priority, benefit_applied,
                   created_at, updated_at, resolved_at
            FROM support_tickets
            WHERE user_id = $1
        `;
        const params = [userId];

        if (status) {
            params.push(status);
            query += ` AND status = $${params.length}`;
        }

        query += ' ORDER BY created_at DESC';

        const result = await db.query(query, params);

        res.json({
            success: true,
            count: result.rows.length,
            tickets: result.rows
        });
    } catch (error) {
        console.error('Error listando tickets:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Detalle de un ticket (solo el propio usuario)
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const ticketResult = await db.query(`
            SELECT id, category, title, description, status, priority,
                   benefit_type, benefit_applied, created_at, updated_at, resolved_at
            FROM support_tickets
            WHERE id = $1 AND user_id = $2
        `, [id, userId]);

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        const commentsResult = await db.query(`
            SELECT tc.id, tc.author_role, tc.message, tc.created_at,
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
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Agregar comentario a un ticket propio
router.post('/:id/comment', async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    const db = req.app.get('db');
    const userId = req.user.id;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }

    try {
        // Verificar que el ticket pertenece al usuario y no está cerrado
        const ticketResult = await db.query(`
            SELECT id, status FROM support_tickets
            WHERE id = $1 AND user_id = $2
        `, [id, userId]);

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        if (ticketResult.rows[0].status === 'closed') {
            return res.status(400).json({ error: 'No se puede comentar en un ticket cerrado' });
        }

        const result = await db.query(`
            INSERT INTO ticket_comments (ticket_id, author_id, author_role, message)
            VALUES ($1, $2, 'user', $3)
            RETURNING id, author_role, message, created_at
        `, [id, userId, message.trim()]);

        // Reabre el ticket si estaba resuelto (el usuario respondió)
        if (ticketResult.rows[0].status === 'resolved') {
            await db.query(`
                UPDATE support_tickets SET status = 'in_progress', resolved_at = NULL
                WHERE id = $1
            `, [id]);
        }

        res.status(201).json({
            success: true,
            comment: result.rows[0]
        });
    } catch (error) {
        console.error('Error agregando comentario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;
