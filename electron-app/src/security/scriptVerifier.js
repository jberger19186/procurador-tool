/**
 * scriptVerifier.js
 * Verificación de firmas RSA y checksums multi-etapa en Electron
 * 
 * Ubicación: electron-app/src/security/scriptVerifier.js
 * 
 * Funcionalidad:
 * - Verificar firmas RSA-2048 con clave pública embebida
 * - Checksums en 3 etapas del ciclo de vida del script
 * - Clases de error específicas para cada tipo de fallo
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ ZONA PROTEGIDA · FAIL-CLOSED desde el 2026-09-02 (decisión B.6 del operador)
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta la fase E8 este módulo tenía tres ramas que DEJABAN PASAR cuando no podía
 * verificar (`verifySignature` sin clave pública, etapa 2 sin ancla de etapa 1,
 * etapa 3 sin referencia). El plan Q6 las había tapado desde el llamador
 * (`authManager.isReady()`) por ser zona protegida; el operador decidió el
 * 2026-09-02 corregirlas también acá — "una pieza que verifica no debería ser más
 * permisiva que aquello que está protegiendo".
 *
 * A partir de acá, si la verificación NO SE PUEDE COMPLETAR, este módulo LANZA.
 * Todos los llamadores (`authManager.loadScript` y las etapas 2/3 de
 * `executeRemoteScriptAsLocal`) ya tratan cualquier excepción como rechazo, así
 * que lanzar equivale a no ejecutar el script. NO reintroducir "degradación
 * elegante" acá sin una decisión explícita del operador.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════
// CLASES DE ERROR PERSONALIZADAS
// ══════════════════════════════════════════════════

class SignatureVerificationError extends Error {
    constructor(scriptName, details = '') {
        super(`Firma digital inválida para script: ${scriptName}. ${details}`);
        this.name = 'SignatureVerificationError';
        this.scriptName = scriptName;
        this.details = details;
        this.code = 'SIGNATURE_INVALID';
    }
}

class ChecksumMismatchError extends Error {
    constructor(scriptName, stage, expected, actual) {
        super(`Checksum mismatch en etapa ${stage} para script: ${scriptName}`);
        this.name = 'ChecksumMismatchError';
        this.scriptName = scriptName;
        this.stage = stage;
        this.expected = expected;
        this.actual = actual;
        this.code = 'CHECKSUM_MISMATCH';
    }
}

// ══════════════════════════════════════════════════
// CLASE PRINCIPAL
// ══════════════════════════════════════════════════

class ScriptVerifier {
    constructor() {
        this.publicKey = null;
        this.initialized = false;
        this.checksumRegistry = new Map(); // scriptName -> { stage1, stage2, stage3 }

        this._loadPublicKey();
    }

    /**
     * Cargar clave pública RSA embebida
     */
    _loadPublicKey() {
        try {
            // Intentar múltiples ubicaciones para la clave pública
            const possiblePaths = [
                path.join(__dirname, 'public.pem'),
                path.join(__dirname, '..', '..', 'public.pem'),
                path.join(process.resourcesPath || '', 'public.pem'),
                path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'security', 'public.pem')
            ];

            for (const keyPath of possiblePaths) {
                try {
                    if (fs.existsSync(keyPath)) {
                        this.publicKey = fs.readFileSync(keyPath, 'utf8');
                        this.initialized = true;
                        console.log(`✅ [ScriptVerifier] Clave pública cargada desde: ${keyPath}`);
                        return;
                    }
                } catch (e) {
                    // Continuar buscando
                }
            }

            console.warn('⚠️ [ScriptVerifier] Clave pública no encontrada. Verificación de firma deshabilitada.');
            console.warn('   Ubicaciones intentadas:', possiblePaths.filter(p => !p.includes('undefined')));

        } catch (error) {
            console.error('❌ [ScriptVerifier] Error cargando clave pública:', error.message);
        }
    }

    /**
     * Calcular checksum SHA-256
     * @param {string} content - Contenido a hashear
     * @returns {string} - Hash SHA-256 en hexadecimal
     */
    calculateChecksum(content) {
        return crypto.createHash('sha256')
            .update(content, 'utf8')
            .digest('hex');
    }

    /**
     * Verificar firma RSA de un script
     * @param {string} checksum - Checksum SHA-256 del script
     * @param {string} signature - Firma RSA en base64
     * @param {string} scriptName - Nombre del script (para logging/errores)
     * @returns {boolean} - true si la firma es válida
     * @throws {SignatureVerificationError} - si la firma es inválida
     */
    verifySignature(checksum, signature, scriptName = 'unknown') {
        if (!this.initialized || !this.publicKey) {
            // B.6 (decisión del operador, 2026-09-02) — FAIL-CLOSED.
            // Acá había una "degradación elegante" que devolvía `true` para
            // CUALQUIER firma cuando la clave pública no se había podido cargar:
            // un verificador que aprueba todo cuando no puede verificar nada.
            // El plan Q6 (C4/F7) lo tapó desde el llamador (`authManager.isReady()`),
            // sin tocar esta zona protegida; ahora se cierra también acá, para que
            // el módulo no sea más permisivo que lo que protege.
            console.error(`🚨 [ScriptVerifier] Verificador no inicializado — no se puede validar: ${scriptName}`);
            throw new SignatureVerificationError(
                scriptName,
                'El verificador de firmas no está inicializado (clave pública ausente o ilegible).'
            );
        }

        try {
            const isValid = crypto.verify(
                'sha256',
                Buffer.from(checksum, 'utf8'),
                {
                    key: this.publicKey,
                    padding: crypto.constants.RSA_PKCS1_V1_5
                },
                Buffer.from(signature, 'base64')
            );

            if (!isValid) {
                console.error(`❌ [ScriptVerifier] FIRMA INVÁLIDA: ${scriptName}`);
                throw new SignatureVerificationError(
                    scriptName,
                    'La firma RSA no corresponde al checksum del script. Posible manipulación.'
                );
            }

            console.log(`✅ [ScriptVerifier] Firma verificada: ${scriptName}`);
            return true;

        } catch (error) {
            if (error instanceof SignatureVerificationError) {
                throw error;
            }
            console.error(`❌ [ScriptVerifier] Error verificando firma de ${scriptName}:`, error.message);
            throw new SignatureVerificationError(scriptName, error.message);
        }
    }

    /**
     * Verificación multi-etapa de checksums
     * 
     * ETAPA 1: Después de desencriptar en RAM
     *   - Verifica que el contenido desencriptado coincide con el checksum del servidor
     * 
     * ETAPA 2: Antes de escribir a disco temporal
     *   - Verifica que el contenido no fue modificado entre desencriptar y escribir
     * 
     * ETAPA 3: Antes de ejecutar en VM/fork
     *   - Verifica que el archivo en disco no fue manipulado externamente
     * 
     * @param {string} scriptName - Nombre del script
     * @param {number} stage - Etapa (1, 2 o 3)
     * @param {string} content - Contenido del script a verificar
     * @param {string} [expectedChecksum] - Checksum esperado (obligatorio en etapa 1)
     * @returns {Object} - { valid: boolean, checksum: string, stage: number }
     * @throws {ChecksumMismatchError}
     */
    verifyMultiStage(scriptName, stage, content, expectedChecksum = null) {
        const currentChecksum = this.calculateChecksum(content);

        switch (stage) {
            case 1: {
                // ETAPA 1: Post-desencripción
                // Compara con el checksum que envió el servidor
                if (!expectedChecksum) {
                    throw new Error('[ScriptVerifier] Etapa 1 requiere expectedChecksum del servidor');
                }

                if (currentChecksum !== expectedChecksum) {
                    console.error(`❌ [ScriptVerifier] CHECKSUM ETAPA 1 FALLIDO: ${scriptName}`);
                    console.error(`   Esperado:  ${expectedChecksum}`);
                    console.error(`   Obtenido:  ${currentChecksum}`);
                    throw new ChecksumMismatchError(scriptName, 1, expectedChecksum, currentChecksum);
                }

                // Registrar checksum para etapas siguientes
                this.checksumRegistry.set(scriptName, {
                    stage1: currentChecksum,
                    stage1At: Date.now()
                });

                console.log(`✅ [ScriptVerifier] Checksum Etapa 1 OK: ${scriptName} (${currentChecksum.substring(0, 16)}...)`);
                break;
            }

            case 2: {
                // ETAPA 2: Pre-escritura a disco
                // Compara con el checksum de etapa 1
                const registry = this.checksumRegistry.get(scriptName);

                if (!registry || !registry.stage1) {
                    // B.6 (2026-09-02) — FAIL-CLOSED. Antes esta rama adoptaba el
                    // checksum ACTUAL como si fuera el de referencia: sin ancla de
                    // etapa 1, la etapa 2 se comparaba contra sí misma y siempre
                    // pasaba. Sin ese ancla no se puede afirmar que el contenido sea
                    // el que el servidor firmó, así que se frena.
                    console.error(`🚨 [ScriptVerifier] Sin registro de etapa 1 para: ${scriptName} — no se puede verificar la etapa 2`);
                    throw new Error(
                        `[ScriptVerifier] Falta el checksum de etapa 1 de "${scriptName}": no hay contra qué verificar la etapa 2.`
                    );
                }

                if (currentChecksum !== registry.stage1) {
                    console.error(`❌ [ScriptVerifier] CHECKSUM ETAPA 2 FALLIDO: ${scriptName}`);
                    console.error(`   Etapa 1:   ${registry.stage1}`);
                    console.error(`   Actual:    ${currentChecksum}`);
                    throw new ChecksumMismatchError(scriptName, 2, registry.stage1, currentChecksum);
                }

                // Actualizar registro
                this.checksumRegistry.set(scriptName, {
                    ...registry,
                    stage2: currentChecksum,
                    stage2At: Date.now()
                });

                console.log(`✅ [ScriptVerifier] Checksum Etapa 2 OK: ${scriptName}`);
                break;
            }

            case 3: {
                // ETAPA 3: Pre-ejecución
                // Compara con checksums anteriores
                const registry = this.checksumRegistry.get(scriptName);
                const referenceChecksum = registry?.stage2 || registry?.stage1 || expectedChecksum;

                if (!referenceChecksum) {
                    // B.6 (2026-09-02) — FAIL-CLOSED. La etapa 3 es la última antes
                    // de ejecutar; "solo registrando" significaba ejecutar sin haber
                    // verificado nada.
                    console.error(`🚨 [ScriptVerifier] Sin referencia de etapas previas para: ${scriptName} — no se puede verificar la etapa 3`);
                    throw new Error(
                        `[ScriptVerifier] Falta el checksum de referencia de "${scriptName}": no hay contra qué verificar la etapa 3.`
                    );
                }

                if (currentChecksum !== referenceChecksum) {
                    console.error(`❌ [ScriptVerifier] CHECKSUM ETAPA 3 FALLIDO: ${scriptName}`);
                    console.error(`   Referencia: ${referenceChecksum}`);
                    console.error(`   Actual:     ${currentChecksum}`);
                    throw new ChecksumMismatchError(scriptName, 3, referenceChecksum, currentChecksum);
                }

                // Actualizar registro
                if (registry) {
                    this.checksumRegistry.set(scriptName, {
                        ...registry,
                        stage3: currentChecksum,
                        stage3At: Date.now()
                    });
                }

                console.log(`✅ [ScriptVerifier] Checksum Etapa 3 OK: ${scriptName}`);
                break;
            }

            default:
                throw new Error(`[ScriptVerifier] Etapa inválida: ${stage}. Usar 1, 2 o 3.`);
        }

        return {
            valid: true,
            checksum: currentChecksum,
            stage
        };
    }

    /**
     * Verificación completa de un script (firma + checksum etapa 1)
     * Combina verifySignature y verifyMultiStage etapa 1 en una sola llamada
     * 
     * @param {string} scriptName - Nombre del script
     * @param {string} decryptedContent - Contenido desencriptado
     * @param {Object} metadata - { checksum, signature, signedAt } del servidor
     * @returns {Object} - { signatureValid, checksumValid, checksum }
     */
    verifyFull(scriptName, decryptedContent, metadata) {
        const { checksum, signature, signedAt } = metadata;

        console.log(`🔍 [ScriptVerifier] Verificación completa: ${scriptName} (firmado: ${signedAt})`);

        // 1. Verificar firma RSA
        const signatureValid = this.verifySignature(checksum, signature, scriptName);

        // 2. Verificar checksum etapa 1 (post-desencripción)
        const checksumResult = this.verifyMultiStage(scriptName, 1, decryptedContent, checksum);

        return {
            signatureValid,
            checksumValid: checksumResult.valid,
            checksum: checksumResult.checksum
        };
    }

    /**
     * Limpiar registro de checksums para un script
     */
    clearRegistry(scriptName) {
        this.checksumRegistry.delete(scriptName);
    }

    /**
     * Limpiar todos los registros
     */
    clearAllRegistries() {
        this.checksumRegistry.clear();
    }

    /**
     * Obtener estado de verificación de un script
     */
    getVerificationStatus(scriptName) {
        const registry = this.checksumRegistry.get(scriptName);
        if (!registry) {
            return { verified: false, stages: {} };
        }

        return {
            verified: true,
            stages: {
                stage1: registry.stage1 ? { checksum: registry.stage1, at: registry.stage1At } : null,
                stage2: registry.stage2 ? { checksum: registry.stage2, at: registry.stage2At } : null,
                stage3: registry.stage3 ? { checksum: registry.stage3, at: registry.stage3At } : null
            }
        };
    }

    /**
     * Verificar si el módulo está operativo
     */
    isReady() {
        return this.initialized;
    }

    /**
     * Obtener configuración del verificador
     */
    getConfig() {
        return {
            algorithm: 'RSA-2048',
            hashFunction: 'SHA-256',
            signaturePadding: 'PKCS1_V1_5',
            initialized: this.initialized,
            hasPublicKey: !!this.publicKey,
            registeredScripts: this.checksumRegistry.size
        };
    }
}

module.exports = {
    ScriptVerifier,
    SignatureVerificationError,
    ChecksumMismatchError
};
