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
 *
 * H-BE-07 (E6): el rol venía SOLO del claim del JWT, congelado en el momento del login.
 * Un token de 8 h emitido para un admin seguía siendo un token de admin durante esas 8 h
 * aunque en el ínterin se le hubiera quitado el rol en la base — quitar el rol no quitaba
 * el acceso, y la única forma de cortarlo era que el propio afectado hiciera logout (que
 * es lo que alimenta la blacklist). Ahora el rol se relee de `users.role` en cada request
 * admin: la revocación surte efecto en la siguiente request, sin esperar el vencimiento.
 *
 * Fail-CLOSED a propósito, y en contraste explícito con `requireLegalOk` (que es
 * fail-open): esto es un control de autorización, no una regla de negocio. Si la base no
 * responde no se puede afirmar que quien pide sea admin, así que no se deja pasar.
 * El costo es una consulta por request al panel de administración — un panel que usan
 * 2 personas, no el camino caliente del producto.
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

    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Se requiere rol de administrador' });
        }

        // H-BE-07: el claim ya dijo "admin"; ahora se confirma contra la base.
        const db = req.app.get('db');
        if (!db) {
            console.error('[SEGURIDAD] authenticateAdmin: no hay pool de base en app.get("db")');
            return res.status(503).json({ error: 'Servicio no disponible' });
        }
        try {
            const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [user.id]);
            if (rows.length === 0 || rows[0].role !== 'admin') {
                console.warn(`[SEGURIDAD] Token de admin con rol revocado o usuario inexistente (id=${user.id})`);
                return res.status(403).json({ error: 'Se requiere rol de administrador' });
            }
        } catch (e) {
            console.error('[SEGURIDAD] authenticateAdmin: no se pudo releer el rol —', e.message);
            return res.status(503).json({ error: 'Servicio no disponible' });
        }

        req.user = user;
        next();
    });
}

module.exports = authenticateAdmin;
