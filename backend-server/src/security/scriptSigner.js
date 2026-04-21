/**
 * scriptSigner.js
 * Firma digital de scripts con RSA-2048 + SHA-256
 * 
 * Ubicación: backend-server/src/security/scriptSigner.js
 * 
 * Funcionalidad:
 * - Calcula SHA-256 checksum de cada script
 * - Firma el checksum con clave privada RSA-2048
 * - Retorna { checksum, signature, signedAt } para enviar al cliente
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ScriptSigner {
    constructor() {
        this.privateKey = null;
        this.publicKey = null;
        this.initialized = false;

        this._loadKeys();
    }

    /**
     * Cargar claves RSA desde archivos PEM
     */
    _loadKeys() {
        try {
            const keysDir = path.join(__dirname, '..', '..', 'keys');
            const privateKeyPath = path.join(keysDir, 'private.pem');
            const publicKeyPath = path.join(keysDir, 'public.pem');

            if (!fs.existsSync(privateKeyPath)) {
                console.error('❌ [ScriptSigner] Clave privada no encontrada en:', privateKeyPath);
                console.error('   Ejecuta: node generate-keys.js');
                return;
            }

            this.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
            
            if (fs.existsSync(publicKeyPath)) {
                this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
            }

            // Verificar que la clave es válida
            this._verifyKeyPair();

            this.initialized = true;
            console.log('✅ [ScriptSigner] Inicializado con RSA-2048');

        } catch (error) {
            console.error('❌ [ScriptSigner] Error cargando claves:', error.message);
        }
    }

    /**
     * Verificar que el par de claves funciona correctamente
     */
    _verifyKeyPair() {
        if (!this.privateKey) {
            throw new Error('Clave privada no disponible');
        }

        const testData = 'script-signer-key-verification-test';
        const signature = crypto.sign('sha256', Buffer.from(testData), this.privateKey);

        if (this.publicKey) {
            const isValid = crypto.verify(
                'sha256',
                Buffer.from(testData),
                this.publicKey,
                signature
            );

            if (!isValid) {
                throw new Error('El par de claves RSA no es válido');
            }
        }
    }

    /**
     * Calcular checksum SHA-256 de un script
     * @param {string} scriptContent - Contenido del script en texto plano
     * @returns {string} - Hash SHA-256 en hexadecimal
     */
    calculateChecksum(scriptContent) {
        return crypto.createHash('sha256')
            .update(scriptContent, 'utf8')
            .digest('hex');
    }

    /**
     * Firmar un script con clave privada RSA-2048
     * @param {string} scriptContent - Contenido del script en texto plano
     * @returns {Object} - { checksum, signature, signedAt }
     */
    signScript(scriptContent) {
        if (!this.initialized) {
            throw new Error('[ScriptSigner] No inicializado. Ejecuta generate-keys.js primero.');
        }

        if (!scriptContent || typeof scriptContent !== 'string') {
            throw new Error('[ScriptSigner] Contenido de script inválido');
        }

        try {
            // 1. Calcular checksum SHA-256
            const checksum = this.calculateChecksum(scriptContent);

            // 2. Firmar el checksum con RSA privada
            const signatureBuffer = crypto.sign(
                'sha256',
                Buffer.from(checksum, 'utf8'),
                {
                    key: this.privateKey,
                    padding: crypto.constants.RSA_PKCS1_V1_5
                }
            );

            const signature = signatureBuffer.toString('base64');

            // 3. Timestamp de firma
            const signedAt = new Date().toISOString();

            console.log(`🔏 [ScriptSigner] Script firmado | checksum: ${checksum.substring(0, 16)}... | ${signedAt}`);

            return {
                checksum,
                signature,
                signedAt
            };

        } catch (error) {
            console.error('❌ [ScriptSigner] Error firmando script:', error.message);
            throw new Error(`Error en firma digital: ${error.message}`);
        }
    }

    /**
     * Verificar firma (para testing en el backend)
     * @param {string} checksum - Checksum SHA-256 original
     * @param {string} signature - Firma RSA en base64
     * @returns {boolean}
     */
    verifySignature(checksum, signature) {
        if (!this.publicKey) {
            throw new Error('[ScriptSigner] Clave pública no disponible para verificación');
        }

        try {
            return crypto.verify(
                'sha256',
                Buffer.from(checksum, 'utf8'),
                {
                    key: this.publicKey,
                    padding: crypto.constants.RSA_PKCS1_V1_5
                },
                Buffer.from(signature, 'base64')
            );
        } catch (error) {
            console.error('❌ [ScriptSigner] Error verificando firma:', error.message);
            return false;
        }
    }

    /**
     * Verificar si el signer está operativo
     * @returns {boolean}
     */
    isReady() {
        return this.initialized;
    }

    /**
     * Obtener información de configuración
     */
    getConfig() {
        return {
            algorithm: 'RSA-2048',
            hashFunction: 'SHA-256',
            signaturePadding: 'PKCS1_V1_5',
            initialized: this.initialized,
            hasPrivateKey: !!this.privateKey,
            hasPublicKey: !!this.publicKey
        };
    }
}

// Singleton - una sola instancia para todo el backend
let instance = null;

function getScriptSigner() {
    if (!instance) {
        instance = new ScriptSigner();
    }
    return instance;
}

module.exports = {
    ScriptSigner,
    getScriptSigner
};
