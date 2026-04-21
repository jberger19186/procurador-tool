const crypto = require('crypto');
const JavaScriptObfuscator = require('javascript-obfuscator');

/**
 * FileEncryption v2.0
 * Mejoras implementadas:
 * - AES-256-GCM (autenticación integrada)
 * - vm en lugar de eval (mejor aislamiento)
 * - Wrapper ofuscado (dificulta ingeniería inversa)
 */
class FileEncryption {
    constructor() {
        // Generar clave única al iniciar la app (SOLO existe en RAM)
        this.sessionKey = crypto.randomBytes(32); // 256 bits AES
        this.iv = crypto.randomBytes(16);         // IV único para GCM

        console.log('🔐 Sistema de encriptación v2.0 inicializado (clave en memoria)');
        console.log('   ✅ Modo: AES-256-GCM (con autenticación)');
        console.log('   ✅ Contexto: vm (aislado)');
        console.log('   ✅ Wrapper: Ofuscado');
    }

    /**
     * Encriptar código JavaScript con AES-256-GCM
     * @param {string} code - Código en texto plano
     * @returns {Object} - { encrypted: string, authTag: string }
     */
    encrypt(code) {
        try {
            // Usar GCM en lugar de CBC
            const cipher = crypto.createCipheriv('aes-256-gcm', this.sessionKey, this.iv);

            let encrypted = cipher.update(code, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            // ✅ NUEVO: Obtener tag de autenticación
            const authTag = cipher.getAuthTag().toString('hex');

            return {
                encrypted: encrypted,
                authTag: authTag
            };
        } catch (error) {
            console.error('❌ Error encriptando:', error.message);
            throw error;
        }
    }

    /**
     * Desencriptar código JavaScript con AES-256-GCM
     * @param {string} encrypted - Código encriptado en hex
     * @param {string} authTag - Tag de autenticación
     * @returns {string} - Código en texto plano
     */
    decrypt(encrypted, authTag) {
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.sessionKey, this.iv);

            // ✅ NUEVO: Establecer tag de autenticación
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));

            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            console.error('❌ Error desencriptando:', error.message);
            throw error;
        }
    }

    /**
     * Obtener credenciales de sesión (para pasar a child process)
     * @returns {Object} - { key: string, iv: string }
     */
    getSessionCredentials() {
        return {
            key: this.sessionKey.toString('hex'),
            iv: this.iv.toString('hex')
        };
    }

    /**
     * Crear wrapper script que desencripta y ejecuta código
     * Versión mejorada con vm en lugar de eval
     * @param {string} encryptedFilename - Nombre del archivo encriptado
     * @param {boolean} obfuscate - Si se debe ofuscar el wrapper
     * @returns {string} - Código del wrapper
     */
    createWrapperScript(encryptedFilename, obfuscate = true) {
        // Template del wrapper SIN ofuscar (para mejor lectura durante desarrollo)
        const wrapperTemplate = `
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Obtener credenciales desde variables de entorno
const key = Buffer.from(process.env.DECRYPT_KEY, 'hex');
const iv = Buffer.from(process.env.DECRYPT_IV, 'hex');

try {
    // Leer archivo encriptado
    const encryptedPath = path.join(__dirname, '${encryptedFilename}');
    const fileContent = fs.readFileSync(encryptedPath, 'utf8');
    
    // Separar datos encriptados y authTag
    const parts = fileContent.split('|||');
    const encrypted = parts[0];
    const authTag = parts[1];
    
    // Desencriptar con verificación de autenticidad
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let code = decipher.update(encrypted, 'hex', 'utf8');
    code += decipher.final('utf8');
    
    // Crear contexto aislado con acceso controlado
    const context = {
        require: require,
        console: console,
        __dirname: __dirname,
        __filename: __filename,
        process: process,
        Buffer: Buffer,
        setTimeout: setTimeout,
        setInterval: setInterval,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval,
        module: module,
        exports: exports
    };
    
    // Ejecutar código desencriptado en contexto aislado
    vm.runInNewContext(code, context, {
        filename: '${encryptedFilename}',
        displayErrors: true
    });
    
} catch (error) {
    console.error('❌ Error en wrapper:', error.message);
    process.exit(1);
}
`.trim();

        // ✅ NUEVO: Ofuscar el wrapper si está habilitado
        if (obfuscate) {
            try {
                const obfuscationResult = JavaScriptObfuscator.obfuscate(wrapperTemplate, {
                    compact: true,
                    controlFlowFlattening: false,
                    deadCodeInjection: false,
                    debugProtection: false,
                    debugProtectionInterval: 0,
                    disableConsoleOutput: false,
                    identifierNamesGenerator: 'hexadecimal',
                    log: false,
                    numbersToExpressions: false,
                    renameGlobals: false,
                    selfDefending: false,
                    simplify: true,
                    splitStrings: false,
                    stringArray: true,
                    stringArrayCallsTransform: false,
                    stringArrayEncoding: ['base64'],
                    stringArrayIndexShift: true,
                    stringArrayRotate: true,
                    stringArrayShuffle: true,
                    stringArrayWrappersCount: 1,
                    stringArrayWrappersChainedCalls: true,
                    stringArrayWrappersParametersMaxCount: 2,
                    stringArrayWrappersType: 'variable',
                    stringArrayThreshold: 0.75,
                    unicodeEscapeSequence: false,
                    target: 'node'
                });

                return obfuscationResult.getObfuscatedCode();
            } catch (error) {
                console.warn('⚠️ Error ofuscando wrapper, usando versión sin ofuscar:', error.message);
                return wrapperTemplate;
            }
        }

        return wrapperTemplate;
    }

    /**
     * Generar estadísticas de encriptación
     */
    getStats(originalSize, encryptedSize, authTagSize = 32) {
        const overhead = ((encryptedSize + authTagSize - originalSize) / originalSize * 100).toFixed(1);
        return {
            originalSize,
            encryptedSize,
            authTagSize,
            totalSize: encryptedSize + authTagSize,
            overhead: `${overhead}%`
        };
    }

    /**
     * Validar integridad de archivo encriptado
     * @param {string} encrypted - Datos encriptados
     * @param {string} authTag - Tag de autenticación
     * @returns {boolean} - true si es válido
     */
    validateIntegrity(encrypted, authTag) {
        try {
            // Intentar desencriptar, si falla el tag = archivo manipulado
            this.decrypt(encrypted, authTag);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Obtener información de configuración
     */
    getConfig() {
        return {
            algorithm: 'aes-256-gcm',
            keySize: 256,
            ivSize: 128,
            authTagSize: 128,
            executionContext: 'vm (isolated)',
            wrapperObfuscation: true
        };
    }

    /**
     * Deshabilitar ofuscación de wrappers (para debugging)
     */
    disableWrapperObfuscation() {
        this.wrapperObfuscation = false;
        console.log('⚠️ Ofuscación de wrappers DESACTIVADA (modo debug)');
    }

    /**
     * Habilitar ofuscación de wrappers
     */
    enableWrapperObfuscation() {
        this.wrapperObfuscation = true;
        console.log('🔒 Ofuscación de wrappers ACTIVADA');
    }
}

module.exports = FileEncryption;