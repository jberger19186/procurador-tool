const jwt = require('jsonwebtoken');
const { isBlacklisted } = require('./tokenBlacklist');

/**
 * middleware/authenticateAdmin.js
 *
 * D3 (revisión 2026-07-25): extraído de routes/admin.js (donde vivía como función local
 * desde el fix M-1) porque otros routers habían empezado a DUPLICAR esta lógica sin el
 * chequeo de blacklist — legal.js tenía su propia copia sin `isBlacklisted()`, así que un
 * admin deslogueado seguía pudiendo editar/borrar los Términos y Condiciones y la Política
 * de Privacidad hasta el vencimiento natural del token (8h). Un solo lugar evita que un
 * futuro fix de auth vuelva a quedar aplicado a medias.
 */
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

module.exports = authenticateAdmin;
