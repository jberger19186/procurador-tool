async function checkLicense(req, res, next) {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const result = await db.query(`
            SELECT * FROM subscriptions
            WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(403).json({
                error: 'Suscripción inactiva o vencida',
                action: 'renew'
            });
        }

        const subscription = result.rows[0];

        // Verificar límite de uso
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