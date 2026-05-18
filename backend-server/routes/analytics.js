const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { adminLimiter } = require('../middleware/rateLimiter');

// ── Auth admin (misma lógica que admin.js) ────────────────────────────────────
function authenticateAdmin(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
        if (user.role !== 'admin') return res.status(403).json({ error: 'Se requiere rol de administrador' });
        req.user = user;
        next();
    });
}

// ── POST /analytics/event — público, recibe eventos de la landing ─────────────
router.post('/event', async (req, res) => {
    try {
        const { event, label, session_id, referrer } = req.body;
        if (!event || typeof event !== 'string' || event.length > 100) {
            return res.status(400).json({ error: 'evento inválido' });
        }

        const db      = req.app.get('db');
        const rawIp   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
        const ip_hash = crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 16);

        await db.query(
            `INSERT INTO analytics_events (event, label, session_id, ip_hash, referrer, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                event.trim(),
                label   ? String(label).slice(0, 200)   : null,
                session_id ? String(session_id).slice(0, 64) : null,
                ip_hash,
                referrer   ? String(referrer).slice(0, 500)  : null,
                req.headers['user-agent']?.slice(0, 300) || null
            ]
        );
        res.json({ ok: true });
    } catch (e) {
        // silencioso: no romper la landing si algo falla
        res.json({ ok: false });
    }
});

// ── GET /admin/analytics/data — protegido, devuelve datos para el dashboard ───
router.get('/data', adminLimiter, authenticateAdmin, async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
        const db   = req.app.get('db');
        const interval = `${days} days`;

        const [summary, funnel, byLabel, byDay, referrers] = await Promise.all([

            // Resumen general
            db.query(`
                SELECT
                    COUNT(DISTINCT session_id)                                              AS sessions,
                    COUNT(*)                                                                AS events,
                    COUNT(*)          FILTER (WHERE event = 'cta_click')                   AS total_cta_clicks,
                    COUNT(*)          FILTER (WHERE event = 'register_success')             AS registros
                FROM analytics_events
                WHERE created_at > NOW() - INTERVAL '${interval}'
            `),

            // Funnel de conversión
            db.query(`
                SELECT
                    COUNT(DISTINCT session_id)                                                                               AS total_sessions,
                    COUNT(DISTINCT session_id) FILTER (WHERE event = 'section_view' AND label = 'planes')                   AS vio_planes,
                    COUNT(DISTINCT session_id) FILTER (WHERE event = 'cta_click' AND label IN ('plan_combo','plan_extension')) AS click_plan,
                    COUNT(*)                   FILTER (WHERE event = 'register_success')                                    AS registros
                FROM analytics_events
                WHERE created_at > NOW() - INTERVAL '${interval}'
            `),

            // Clicks por botón
            db.query(`
                SELECT label, COUNT(*) AS total
                FROM analytics_events
                WHERE event = 'cta_click'
                  AND label IS NOT NULL
                  AND created_at > NOW() - INTERVAL '${interval}'
                GROUP BY label
                ORDER BY total DESC
                LIMIT 12
            `),

            // Sesiones por día
            db.query(`
                SELECT
                    TO_CHAR(DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'DD/MM') AS dia,
                    COUNT(DISTINCT session_id) AS sessions,
                    COUNT(*) AS events
                FROM analytics_events
                WHERE created_at > NOW() - INTERVAL '${interval}'
                GROUP BY DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
                ORDER BY DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
            `),

            // Referrers (limpiar URL completa → solo dominio)
            db.query(`
                SELECT
                    CASE
                        WHEN referrer IS NULL OR referrer = '' THEN '(directo)'
                        WHEN referrer LIKE '%google.%'   THEN 'google'
                        WHEN referrer LIKE '%linkedin.%' THEN 'linkedin'
                        WHEN referrer LIKE '%facebook.%' THEN 'facebook'
                        WHEN referrer LIKE '%twitter.%'  THEN 'twitter'
                        WHEN referrer LIKE '%instagram.%'THEN 'instagram'
                        ELSE REGEXP_REPLACE(referrer, '^https?://([^/]+).*', '\\1')
                    END AS fuente,
                    COUNT(DISTINCT session_id) AS sessions
                FROM analytics_events
                WHERE created_at > NOW() - INTERVAL '${interval}'
                GROUP BY fuente
                ORDER BY sessions DESC
                LIMIT 8
            `)
        ]);

        const payload = {
            days,
            summary:   summary.rows[0],
            funnel:    funnel.rows[0],
            byLabel:   byLabel.rows,
            byDay:     byDay.rows,
            referrers: referrers.rows
        };
        console.log(`📊 [Analytics] /data days=${days} → sessions=${payload.summary?.sessions} events=${payload.summary?.events} byLabel=${payload.byLabel?.length} byDay=${payload.byDay?.length}`);
        res.set('Cache-Control', 'no-store');
        res.json(payload);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── DELETE /analytics/events — borra todos los eventos (admin only) ───────────
router.delete('/events', authenticateAdmin, async (req, res) => {
    try {
        const db = req.app.get('db');
        const result = await db.query('DELETE FROM analytics_events');
        console.log(`🗑️ [Analytics] Todos los eventos eliminados por admin: ${result.rowCount} filas`);
        res.json({ ok: true, deleted: result.rowCount });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
