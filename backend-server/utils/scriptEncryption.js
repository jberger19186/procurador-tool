const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CacheManager = require('./cacheManager');
// C.1 capa 1 (fase E9): ofuscación en el SERVIDOR, antes de cifrar y guardar.
// Ofuscar en el cliente es inútil (el usuario ya tiene el código); por eso
// electron-app/src/security/codeObfuscator.js está desactivado a propósito.
const { ofuscarScript } = require('./obfuscation');
const { SCRIPTS_DISTRIBUIBLES } = require('./scriptsDistribuibles');

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
        const fuente = fs.readFileSync(filePath, 'utf8');

        // C.1 capa 1: ofuscar ENTRE leer y cifrar. Todo lo que sigue —hash, cifrado,
        // firma RSA en la entrega, verificación del cliente— opera sobre el ofuscado.
        //
        // SOLO los scripts que se ENTREGAN al cliente. Los de operación del servidor
        // (backup-db, health-check, data-retention, canary-test, test_registro,
        // validarCampoParteScwpjn y reset-admin-password) nunca salen de acá —E1 los
        // devuelve 404— así que ofuscarlos no protege nada y sí agrega superficie de
        // falla. Y no es hipotético: `scripts/reset-admin-password.js` existe en staging
        // y en producción (no está en el repo), empieza con `#!/usr/bin/env node`, y
        // acorn no parsea un shebang → `Unexpected character '!' (1:1)`. Con la
        // ofuscación aplicada a todo el directorio, el primer `pm2 restart` habría
        // abortado el arranque y dejado el servidor caído. Medido en staging antes de
        // reiniciar, no deducido.
        //
        // `ofuscarScript` LANZA si el resultado rompería dentro del navegador (una
        // función que viaja por page.evaluate a la que el ofuscador le dejó una
        // referencia externa al string array). Esa excepción sube hasta init() en
        // server.js:583, que hace process.exit(1): el servidor NO arranca y la fila de
        // encrypted_scripts queda con el contenido anterior, sano. Es deliberado —
        // fail-closed. La alternativa (loguear y guardar igual) publicaría un script que
        // falla con "ReferenceError: _0x… is not defined" en medio de una ejecución
        // real contra el PJN, que es exactamente el incidente que dejó la ofuscación
        // desactivada la primera vez.
        //
        // El seed de CONFIG es fijo, así que el mismo fuente da el mismo ofuscado byte
        // a byte: el `hash` no cambia entre reinicios y la caché de los clientes no se
        // invalida sola en cada restart (medido: 2 pasadas, 0 archivos distintos).
        // Fail-closed donde importa: si un script DISTRIBUIBLE no se puede ofuscar sin
        // romperlo, `ofuscarScript` lanza, la excepción sube a init() (server.js:583) y
        // el servidor no arranca, dejando la fila anterior intacta en encrypted_scripts.
        // Preferimos eso a publicar un script que falle con "ReferenceError: _0x… is not
        // defined" en medio de una ejecución real contra el PJN.
        const code = SCRIPTS_DISTRIBUIBLES.has(file)
            ? ofuscarScript(fuente, file).codigo
            : fuente;

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
    const plain = decryptCode(encrypted_content, key, iv, scriptName, hash);

    // H-BE-20 (E6): la columna `hash` viaja con el script hasta el cliente y es lo que
    // el verificador de Electron coteja — pero hasta acá el servidor NUNCA la
    // comprobaba contra lo que él mismo acababa de descifrar: la usaba solo como parte
    // de la clave de caché. Consecuencia: si `encrypted_content` quedaba desalineado de
    // `hash` (una fila editada a mano, una escritura a medias, un reencrypt cortado), el
    // servidor firmaba con RSA un contenido distinto del que dice ser — y esa firma es
    // válida, así que el cliente la acepta. La firma solo garantiza "esto lo emitió el
    // servidor", no "esto es el script correcto"; el cotejo del hash es lo que cierra
    // esa distancia, y tiene que hacerse ANTES de firmar.
    // Ante desajuste: se invalida la entrada de caché (para que un valor sucio no quede
    // servido durante la hora de TTL) y se lanza — fail-closed, sin devolver el script.
    const realHash = calculateHash(plain);
    if (realHash !== hash) {
        scriptCache.invalidate(scriptName);
        console.error(`[SEGURIDAD] Hash desalineado para ${scriptName}: la base dice ${hash}, el contenido descifrado da ${realHash}. No se firma ni se entrega.`);
        throw new Error(`Integridad del script ${scriptName} comprometida: el hash almacenado no coincide con el contenido descifrado.`);
    }

    return plain;
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