const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CacheManager = require('./cacheManager');

// Inicializar caché global
const scriptCache = new CacheManager({
    ttl: 3600000, // 1 hora
    maxSize: 50
});

// Limpiar scripts expirados cada 10 minutos
setInterval(() => {
    scriptCache.cleanExpired();
}, 600000);

/**
 * Encripta código usando AES-256-CBC
 */
function encryptCode(code, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);

    let encrypted = cipher.update(code, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
        encrypted,
        iv: iv.toString('hex')
    };
}

/**
 * Desencripta código con caché
 */
function decryptCode(encryptedData, key, iv, scriptName, hash) {
    // Intentar obtener del caché primero
    const cached = scriptCache.get(scriptName, hash);
    if (cached) {
        return cached;
    }

    // Si no está en caché, desencriptar
    const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(key, 'hex'),
        Buffer.from(iv, 'hex')
    );

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // Guardar en caché
    scriptCache.set(scriptName, hash, decrypted);

    return decrypted;
}

/**
 * Calcula hash SHA-256 del código
 */
function calculateHash(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Procesa y encripta todos los scripts
 */
async function processScripts(db) {
    const scriptsDir = path.join(__dirname, '..', 'scripts');
    const key = process.env.ENCRYPTION_KEY;

    if (!fs.existsSync(scriptsDir)) {
        console.log('⚠️ Carpeta scripts/ no existe, creándola...');
        fs.mkdirSync(scriptsDir, { recursive: true });
        return;
    }

    const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
        const filePath = path.join(scriptsDir, file);
        const code = fs.readFileSync(filePath, 'utf8');
        const hash = calculateHash(code);
        const { encrypted, iv } = encryptCode(code, key);

        // Verificar si ya existe en BD
        const existing = await db.query(
            'SELECT hash FROM encrypted_scripts WHERE script_name = $1',
            [file]
        );

        if (existing.rows.length > 0) {
            // Si el hash cambió, actualizar y limpiar caché
            if (existing.rows[0].hash !== hash) {
                await db.query(`
                    UPDATE encrypted_scripts
                    SET encrypted_content = $1, iv = $2, hash = $3, updated_at = NOW()
                    WHERE script_name = $4
                `, [encrypted, iv, hash, file]);

                // Invalidar caché del script actualizado
                scriptCache.invalidate(file);
                console.log(`✅ Script ${file} actualizado y caché invalidado`);
            }
        } else {
            // Insertar nuevo script
            await db.query(`
                INSERT INTO encrypted_scripts (script_name, encrypted_content, iv, hash)
                VALUES ($1, $2, $3, $4)
            `, [file, encrypted, iv, hash]);
            console.log(`✅ Script ${file} encriptado y guardado`);
        }
    }
}

/**
 * Obtiene y desencripta un script (con caché)
 */
async function getDecryptedScript(db, scriptName) {
    const key = process.env.ENCRYPTION_KEY;

    const result = await db.query(
        'SELECT encrypted_content, iv, hash FROM encrypted_scripts WHERE script_name = $1 AND active = true',
        [scriptName]
    );

    if (result.rows.length === 0) {
        throw new Error(`Script ${scriptName} no encontrado`);
    }

    const { encrypted_content, iv, hash } = result.rows[0];
    return decryptCode(encrypted_content, key, iv, scriptName, hash);
}

/**
 * Obtiene estadísticas del caché
 */
function getCacheStats() {
    return scriptCache.getStats();
}

/**
 * Limpia el caché manualmente
 */
function clearCache() {
    scriptCache.clear();
}

module.exports = {
    processScripts,
    getDecryptedScript,
    getCacheStats,
    clearCache
};