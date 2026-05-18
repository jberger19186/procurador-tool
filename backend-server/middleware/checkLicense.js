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

        // Verificar límite de uso (aplica a trial y a planes con límite)
        if (subscription.usage_count >= subscription.usage_limit) {
            return res.status(403).json({
                error: 'Límite de uso alcanzado',
                action: 'upgrade'
            });
        }

        req.subscription = subscription;
        next();
    } catch (error) {
        console.error('Error verificando licencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
}

module.exports = checkLicense;