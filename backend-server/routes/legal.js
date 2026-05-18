'use strict';
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const logger  = require('../utils/logger');
const { sendEmail } = require('../utils/mailer');

// ── Auth helpers ──────────────────────────────────────────────────────────────
function authenticateAdmin(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
        if (user.role !== 'admin') return res.status(403).json({ error: 'Se requiere rol administrador' });
        req.user = user;
        next();
    });
}
function authenticateUser(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
        req.user = user;
        next();
    });
}

// ── PUBLIC — contenido actual para /terminos/ y /privacidad/ ─────────────────
// GET /legal/page?type=tyc|pyp
router.get('/page', async (req, res) => {
    const { type } = req.query;
    if (!type || !['tyc','pyp'].includes(type)) return res.status(400).send('<p>Tipo inválido.</p>');
    try {
        const db = req.app.get('db');
        const result = await db.query(
            'SELECT html_content FROM legal_documents WHERE type=$1 AND is_current=true LIMIT 1', [type]
        );
        if (!result.rows.length) return res.status(404).send(null); // caerá al estático
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(result.rows[0].html_content);
    } catch (e) {
        res.status(500).send(null);
    }
});

// ── USER — documentos pendientes ──────────────────────────────────────────────
// GET /legal/pending
router.get('/pending', authenticateUser, async (req, res) => {
    try {
        const db = req.app.get('db');
        const userId = req.user.id;
        const [pendingDocs, userRow] = await Promise.all([
            db.query(`
                SELECT ld.id, ld.type, ld.version, ld.title, ld.requires_acceptance
                FROM legal_documents ld
                WHERE ld.is_current = true AND ld.requires_acceptance = true
                  AND NOT EXISTS (
                      SELECT 1 FROM user_legal_acceptances ula
                      WHERE ula.user_id = $1 AND ula.document_id = ld.id
                  )
                ORDER BY ld.type
            `, [userId]),
            db.query('SELECT legal_pending_since FROM users WHERE id=$1', [userId])
        ]);
        const pendingSince = userRow.rows[0]?.legal_pending_since;
        const deadline = pendingSince
            ? new Date(new Date(pendingSince).getTime() + 15 * 24 * 60 * 60 * 1000)
            : null;
        res.json({ pending: pendingDocs.rows, deadline: deadline?.toISOString() || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /legal/accept — acepta todos los documentos pendientes
router.post('/accept', authenticateUser, async (req, res) => {
    try {
        const db  = req.app.get('db');
        const userId = req.user.id;
        const rawIp  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
        const ip_hash = crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 16);

        const pending = await db.query(`
            SELECT ld.id FROM legal_documents ld
            WHERE ld.is_current = true AND ld.requires_acceptance = true
              AND NOT EXISTS (
                  SELECT 1 FROM user_legal_acceptances ula
                  WHERE ula.user_id = $1 AND ula.document_id = ld.id
              )
        `, [userId]);

        if (!pending.rows.length)
            return res.json({ success: true, accepted: 0, message: 'Sin documentos pendientes' });

        for (const doc of pending.rows) {
            await db.query(
                `INSERT INTO user_legal_acceptances (user_id, document_id, ip_hash)
                 VALUES ($1, $2, $3) ON CONFLICT (user_id, document_id) DO NOTHING`,
                [userId, doc.id, ip_hash]
            );
        }

        await db.query(
            'UPDATE users SET legal_pending_since = NULL, legal_suspended = FALSE WHERE id = $1',
            [userId]
        );

        logger.info(`✅ [Legal] Usuario ${userId} aceptó ${pending.rowCount} documento(s)`);
        res.json({ success: true, accepted: pending.rowCount });
    } catch (e) {
        logger.error('[Legal] Error en accept:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── ADMIN — listado ───────────────────────────────────────────────────────────
// GET /legal/admin/documents
router.get('/admin/documents', authenticateAdmin, async (req, res) => {
    try {
        const db = req.app.get('db');
        const result = await db.query(`
            SELECT ld.*,
                   u.email AS created_by_email,
                   (SELECT COUNT(*) FROM user_legal_acceptances ula WHERE ula.document_id = ld.id)::int AS acceptance_count
            FROM legal_documents ld
            LEFT JOIN users u ON ld.created_by = u.id
            ORDER BY ld.type, ld.created_at DESC
        `);
        res.json({ documents: result.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /legal/admin/documents/:id
router.get('/admin/documents/:id', authenticateAdmin, async (req, res) => {
    try {
        const db = req.app.get('db');
        const result = await db.query('SELECT * FROM legal_documents WHERE id=$1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json({ document: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /legal/admin/documents/:id/stats
router.get('/admin/documents/:id/stats', authenticateAdmin, async (req, res) => {
    try {
        const db = req.app.get('db');
        const [docResult, acceptances, totalUsers] = await Promise.all([
            db.query('SELECT * FROM legal_documents WHERE id=$1', [req.params.id]),
            db.query(`
                SELECT ula.accepted_at, u.email, u.nombre, u.apellido
                FROM user_legal_acceptances ula
                JOIN users u ON ula.user_id = u.id
                WHERE ula.document_id = $1
                ORDER BY ula.accepted_at DESC LIMIT 200
            `, [req.params.id]),
            db.query(`
                SELECT COUNT(*)::int AS total FROM users u
                JOIN subscriptions s ON u.id = s.user_id
                WHERE s.status IN ('active','suspended') AND u.email_verified = true
            `)
        ]);
        if (!docResult.rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json({
            document: docResult.rows[0],
            acceptances: acceptances.rows,
            total_users: totalUsers.rows[0].total,
            accepted_count: acceptances.rowCount
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── ADMIN — CRUD ──────────────────────────────────────────────────────────────
// POST /legal/admin/documents — crear borrador
router.post('/admin/documents', authenticateAdmin, async (req, res) => {
    try {
        const db = req.app.get('db');
        const { type, version, title, html_content, summary_of_changes, requires_acceptance, effective_date } = req.body;
        if (!type || !['tyc','pyp'].includes(type)) return res.status(400).json({ error: 'Tipo inválido (tyc o pyp)' });
        if (!version?.trim() || !title?.trim() || !html_content?.trim())
            return res.status(400).json({ error: 'Faltan campos: version, title, html_content' });

        const result = await db.query(`
            INSERT INTO legal_documents
                (type, version, title, html_content, summary_of_changes,
                 requires_acceptance, effective_date, is_current, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8) RETURNING id
        `, [
            type, version.trim(), title.trim(), html_content,
            summary_of_changes || null,
            requires_acceptance !== false,
            effective_date || null,
            req.user.id
        ]);
        logger.info(`📄 [Legal] Borrador creado: ${type} v${version} por admin ${req.user.id}`);
        res.json({ success: true, id: result.rows[0].id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /legal/admin/documents/:id — actualizar borrador
router.put('/admin/documents/:id', authenticateAdmin, async (req, res) => {
    try {
        const db = req.app.get('db');
        const existing = await db.query('SELECT is_current FROM legal_documents WHERE id=$1', [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ error: 'No encontrado' });
        if (existing.rows[0].is_current)
            return res.status(400).json({ error: 'No se puede editar un documento publicado. Creá una nueva versión.' });

        const { version, title, html_content, summary_of_changes, requires_acceptance, effective_date } = req.body;
        await db.query(`
            UPDATE legal_documents
            SET version=$1, title=$2, html_content=$3, summary_of_changes=$4,
                requires_acceptance=$5, effective_date=$6
            WHERE id=$7
        `, [version, title, html_content, summary_of_changes||null, requires_acceptance!==false, effective_date||null, req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /legal/admin/documents/:id — eliminar borrador
router.delete('/admin/documents/:id', authenticateAdmin, async (req, res) => {
    try {
        const db = req.app.get('db');
        const existing = await db.query('SELECT is_current FROM legal_documents WHERE id=$1', [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ error: 'No encontrado' });
        if (existing.rows[0].is_current)
            return res.status(400).json({ error: 'No se puede eliminar un documento publicado' });
        await db.query('DELETE FROM legal_documents WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /legal/admin/documents/:id/publish — publicar y notificar
router.put('/admin/documents/:id/publish', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const docResult = await db.query('SELECT * FROM legal_documents WHERE id=$1', [req.params.id]);
        if (!docResult.rows.length) return res.status(404).json({ error: 'No encontrado' });
        const doc = docResult.rows[0];
        if (doc.is_current) return res.status(400).json({ error: 'Ya está publicado' });

        // Transacción: marcar como actual, desmarcar anterior
        await db.query('BEGIN');
        await db.query('UPDATE legal_documents SET is_current=false WHERE type=$1 AND is_current=true', [doc.type]);
        await db.query('UPDATE legal_documents SET is_current=true WHERE id=$1', [doc.id]);
        await db.query('COMMIT');

        // Usuarios activos que no aceptaron este documento
        const usersResult = await db.query(`
            SELECT u.id, u.email, u.nombre
            FROM users u
            JOIN subscriptions s ON u.id = s.user_id
            WHERE s.status IN ('active','suspended') AND u.email_verified = true
              AND NOT EXISTS (
                  SELECT 1 FROM user_legal_acceptances ula
                  WHERE ula.user_id = u.id AND ula.document_id = $1
              )
        `, [doc.id]);

        const baseUrl   = process.env.BASE_URL || 'https://api.procuradortool.com';
        const acceptUrl = `${baseUrl}/legal/accept/`;
        const deadline  = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
        const deadlineStr = deadline.toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });
        const typeLabel = doc.type === 'tyc' ? 'Términos y Condiciones' : 'Política de Privacidad';

        let notified = 0;
        for (const user of usersResult.rows) {
            // Notificación in-app
            await db.query(`
                INSERT INTO user_notifications
                    (user_id, title, message, type, action_url, created_by, expires_at)
                VALUES ($1,$2,$3,'legal_update',$4,$5, NOW() + INTERVAL '20 days')
            `, [
                user.id,
                `Actualizamos nuestros ${typeLabel}`,
                `Tenés hasta el ${deadlineStr} para aceptar la versión ${doc.version}. Tu cuenta puede ser suspendida si no lo hacés.`,
                acceptUrl,
                req.user.id
            ]);
            // Setear legal_pending_since solo si no tiene uno
            await db.query(`
                UPDATE users SET legal_pending_since = COALESCE(legal_pending_since, NOW())
                WHERE id = $1
            `, [user.id]);
            // Email (fire-and-forget)
            sendEmail(
                user.email,
                `Actualizamos nuestros ${typeLabel} — Procurador SCW`,
                `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
                  <h2 style="color:#d97706;margin-bottom:8px">⚖ Procurador SCW</h2>
                  <p>Hola <strong>${user.nombre}</strong>,</p>
                  <p>Actualizamos nuestros <strong>${typeLabel}</strong> (versión ${doc.version}).</p>
                  <p>Tenés <strong>15 días</strong> para revisarlos y aceptarlos.<br>
                     Fecha límite: <strong>${deadlineStr}</strong>.</p>
                  <div style="text-align:center;margin:32px 0">
                    <a href="${acceptUrl}"
                       style="background:#d97706;color:#fff;padding:14px 32px;border-radius:8px;
                              text-decoration:none;font-size:16px;font-weight:600">
                      Revisar y aceptar →
                    </a>
                  </div>
                  <p style="color:#6b7280;font-size:13px">
                    Si no aceptás antes del ${deadlineStr}, tu acceso quedará suspendido hasta que lo hagas.
                  </p>
                  <p style="color:#9ca3af;font-size:12px">Procurador SCW — soporte@procuradortool.com</p>
                </div>`
            ).catch(() => {});
            notified++;
        }

        logger.info(`📢 [Legal] Publicado ${doc.type} v${doc.version} — ${notified} usuarios notificados`);
        res.json({ success: true, notified });
    } catch (e) {
        await db.query('ROLLBACK').catch(() => {});
        logger.error('[Legal] Error al publicar:', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
