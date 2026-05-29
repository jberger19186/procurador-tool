async function checkLicense(req, res, next) {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Permite acceso si está activo, o en trial (suspended + pending_activation con usos restantes)
        const result = await db.query(`
            SELECT s.* FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1
              AND s.expires_at > NOW()
              AND (
                (s.status = 'active')
                OR
                (s.status = 'suspended'
                 AND u.registration_status = 'pending_activation'
                 AND s.usage_count < s.usage_limit)
              )
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(403).json({
                error: 'Suscripción inactiva o vencida',
                action: 'renew'
            });
        }

        const subscription = result.rows[0];

        // Fase 5: Sumar usos extra asignados por admin (cortesía o comprados)
        // effective_limit = usage_limit + SUM(remaining_uses de usage_extras vigentes)
        let extraUsesBalance = 0;
        try {
            const extrasResult = await db.query(`
                SELECT COALESCE(SUM(remaining_uses), 0) AS total_extra
                FROM usage_extras
                WHERE user_id = $1
                  AND remaining_uses > 0
                  AND (expires_at IS NULL OR expires_at > NOW())
            `, [userId]);
            extraUsesBalance = parseInt(extrasResult.rows[0]?.total_extra || '0', 10);
        } catch (_) {
            // Si la tabla no existe aún (entorno de dev), ignorar silenciosamente
        }

        const effectiveLimit = subscription.usage_limit + extraUsesBalance;

        // Verificar límite de uso efectivo
        if (subscription.usage_count >= effectiveLimit) {
            return res.status(403).json({
                error: 'Límite de uso alcanzado',
                action: 'upgrade'
            });
        }

        req.subscription = subscription;
        req.subscription.effectiveLimit = effectiveLimit;   // disponible para los handlers
        req.subscription.extraUsesBalance = extraUsesBalance;
        next();
    } catch (error) {
        console.error('Error verificando licencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
}

module.exports = checkLicense;