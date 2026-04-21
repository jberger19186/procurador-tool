const jwt = require('jsonwebtoken');
const { isBlacklisted } = require('./tokenBlacklist');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    // Verificar si el token fue invalidado (logout)
    if (isBlacklisted(token)) {
        return res.status(403).json({ error: 'Token invalidado' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado' });
        }
        req.user = user;
        req.token = token; // Guardar referencia para logout
        next();
    });
}

module.exports = authenticateToken;