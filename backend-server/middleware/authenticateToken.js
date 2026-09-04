const jwt = require('jsonwebtoken');
const { isBlacklisted } = require('./tokenBlacklist');
// B.3-A (E11): la bandera que habilita la llave de captura es un símbolo, no un
// nombre de propiedad — ver el porqué en el propio middleware.
const { CAPTURE_ALLOWED } = require('./allowCaptureToken');

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

        // ── B.3-A (fase E11): rechazo global de la LLAVE DE CAPTURA ──────────
        // La llave de captura (`scope: 'capture'`, 30 min, un solo uso) se firma
        // con el mismo JWT_SECRET que las sesiones — a propósito: sin eso, este
        // `jwt.verify` la rechazaría y el reclamo del borrador, que es lo único
        // para lo que existe, nunca funcionaría (ver la nota extensa en
        // `POST /client/bitacora/capture-token`).
        //
        // Entonces lo que la mantiene chica NO es el secreto, es este bloque:
        // sin él, un JWT de 30 minutos con acceso completo a la API es una
        // sesión con otro nombre, y el archivo del visor —que el producto invita
        // a compartir— vuelve a ser una credencial.
        //
        // Fail-closed por diseño: se rechaza SALVO que la ruta lo haya habilitado
        // explícitamente con `middleware/allowCaptureToken.js`, montado antes que
        // este middleware. Un endpoint nuevo que se olvide del tema simplemente
        // no acepta llaves de captura.
        //
        // 401 y no 403: el cliente debe leerlo como "esto no es una sesión válida
        // acá", no como "tu sesión fue invalidada".
        if (user && user.scope === 'capture') {
            req.isCaptureToken = true;
            if (req[CAPTURE_ALLOWED] !== true) {
                return res.status(401).json({
                    error: 'Esta credencial solo sirve para reclamar su propio borrador de captura.',
                    code: 'CAPTURE_TOKEN_SCOPE'
                });
            }
        }

        next();
    });
}

module.exports = authenticateToken;