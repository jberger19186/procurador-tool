const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Blacklist de tokens JWT invalidados.
 * - Capa 1 (rápida): Map en memoria, consultada en cada request (sin latencia de BD).
 * - Capa 2 (persistente): tabla token_blacklist en PostgreSQL, sobrevive reinicios.
 *
 * Las claves del Map y de la BD son SHA-256 del token (no el token completo).
 */
const blacklistedTokens = new Map(); // hash → expiresAt (ms)
let db = null;

/**
 * Calcular hash del token para no almacenar el JWT completo
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Inicializar con el pool de BD.
 * Crea la tabla si no existe y carga en memoria los tokens aún vigentes.
 * Llamar una sola vez al arrancar el servidor.
 */
async function init(pool) {
    db = pool;

    // Crear tabla si no existe (idempotente)
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS token_blacklist (
                token_hash  VARCHAR(64) PRIMARY KEY,
                expires_at  TIMESTAMP   NOT NULL,
                created_at  TIMESTAMP   DEFAULT NOW()
            )
        `);
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires
            ON token_blacklist (expires_at)
        `);
    } catch (err) {
        console.warn('⚠️ Blacklist: no se pudo crear tabla en BD:', err.message);
        return;
    }

    // Cargar tokens no expirados en memoria
    try {
        const result = await db.query(`
            SELECT token_hash, expires_at
            FROM token_blacklist
            WHERE expires_at > NOW()
        `);
        for (const row of result.rows) {
            blacklistedTokens.set(row.token_hash, new Date(row.expires_at).getTime());
        }
        if (result.rows.length > 0) {
            console.log(`🔐 Blacklist: ${result.rows.length} tokens recuperados desde BD`);
        }
    } catch (err) {
        console.warn('⚠️ Blacklist: no se pudo cargar desde BD:', err.message);
    }
}

/**
 * Agregar token a la blacklist (memoria + BD).
 * La escritura en BD es fire-and-forget para no bloquear la respuesta de logout.
 */
function blacklistToken(token) {
    try {
        const decoded = jwt.decode(token);
        const expiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now() + 3600000;
        const hash = hashToken(token);

        // 1. Guardar en memoria inmediatamente
        blacklistedTokens.set(hash, expiresAt);
        console.log(`🚫 Token agregado a blacklist (usuario: ${decoded?.id})`);

        // 2. Persistir en BD de forma asíncrona (no bloquea el response)
        if (db) {
            db.query(`
                INSERT INTO token_blacklist (token_hash, expires_at)
                VALUES ($1, to_timestamp($2 / 1000.0))
                ON CONFLICT (token_hash) DO NOTHING
            `, [hash, expiresAt]).catch(err => {
                console.warn('⚠️ Blacklist: no se pudo persistir en BD:', err.message);
            });
        }
    } catch (error) {
        // Fallback si el token no se puede decodificar
        const hash = hashToken(token);
        blacklistedTokens.set(hash, Date.now() + 3600000);
    }
}

/**
 * Verificar si un token está en la blacklist.
 * Solo consulta memoria (O(1), sin latencia de BD).
 */
function isBlacklisted(token) {
    const hash = hashToken(token);
    return blacklistedTokens.has(hash);
}

/**
 * Limpiar tokens expirados de memoria y de la BD.
 * Se ejecuta automáticamente cada 10 minutos.
 */
function cleanExpired() {
    const now = Date.now();
    let cleaned = 0;
    for (const [hash, expiresAt] of blacklistedTokens.entries()) {
        if (expiresAt <= now) {
            blacklistedTokens.delete(hash);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`🧹 Blacklist: ${cleaned} tokens expirados eliminados de memoria (quedan: ${blacklistedTokens.size})`);
    }

    // Limpiar también en BD (fire-and-forget)
    if (db) {
        db.query(`DELETE FROM token_blacklist WHERE expires_at <= NOW()`)
            .catch(err => {
                console.warn('⚠️ Blacklist: no se pudo limpiar BD:', err.message);
            });
    }
}

// Limpiar tokens expirados cada 10 minutos
setInterval(cleanExpired, 600000);

module.exports = { init, blacklistToken, isBlacklisted, cleanExpired };
