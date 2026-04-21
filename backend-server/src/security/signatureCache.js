/**
 * signatureCache.js
 * Caché en memoria para firmas digitales de scripts
 * 
 * Ubicación: backend-server/src/security/signatureCache.js
 * 
 * Funcionalidad:
 * - Cachea firmas para evitar re-firmar scripts sin cambios
 * - Invalida automáticamente cuando el contenido cambia
 * - TTL configurable para refrescar firmas periódicamente
 */

const { getScriptSigner } = require('./scriptSigner');

class SignatureCache {
    /**
     * @param {Object} options
     * @param {number} options.ttl - Tiempo de vida en ms (default: 1 hora)
     * @param {number} options.maxSize - Máximo de entradas (default: 100)
     */
    constructor(options = {}) {
        this.ttl = options.ttl || 3600000; // 1 hora
        this.maxSize = options.maxSize || 100;
        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            invalidations: 0,
            totalSignings: 0
        };

        // Auto-limpieza cada 10 minutos
        this._cleanupInterval = setInterval(() => {
            this._cleanExpired();
        }, 600000);

        console.log(`✅ [SignatureCache] Inicializado (TTL: ${this.ttl / 1000}s, maxSize: ${this.maxSize})`);
    }

    /**
     * Obtener firma del caché o calcular una nueva
     * @param {string} scriptName - Nombre del script
     * @param {string} scriptContent - Contenido del script en texto plano
     * @returns {Object} - { checksum, signature, signedAt, fromCache }
     */
    getOrCalculate(scriptName, scriptContent) {
        const signer = getScriptSigner();

        if (!signer.isReady()) {
            throw new Error('[SignatureCache] ScriptSigner no está listo');
        }

        // Calcular checksum actual para comparar
        const currentChecksum = signer.calculateChecksum(scriptContent);

        // Buscar en caché
        const cached = this.cache.get(scriptName);

        if (cached) {
            // Verificar que el contenido no cambió Y que no expiró
            const isExpired = (Date.now() - cached.cachedAt) > this.ttl;
            const checksumMatch = cached.checksum === currentChecksum;

            if (checksumMatch && !isExpired) {
                this.stats.hits++;
                console.log(`📦 [SignatureCache] HIT: ${scriptName} (checksum: ${currentChecksum.substring(0, 12)}...)`);
                
                return {
                    checksum: cached.checksum,
                    signature: cached.signature,
                    signedAt: cached.signedAt,
                    fromCache: true
                };
            }

            // Si cambió el checksum, invalidar
            if (!checksumMatch) {
                this.stats.invalidations++;
                console.log(`🔄 [SignatureCache] INVALIDADO: ${scriptName} (checksum cambió)`);
            }

            // Si expiró
            if (isExpired) {
                console.log(`⏰ [SignatureCache] EXPIRADO: ${scriptName}`);
            }
        }

        // Cache MISS - firmar de nuevo
        this.stats.misses++;
        this.stats.totalSignings++;

        console.log(`🔏 [SignatureCache] MISS: ${scriptName} - firmando...`);

        const signResult = signer.signScript(scriptContent);

        // Guardar en caché
        this._set(scriptName, {
            checksum: signResult.checksum,
            signature: signResult.signature,
            signedAt: signResult.signedAt,
            cachedAt: Date.now()
        });

        return {
            ...signResult,
            fromCache: false
        };
    }

    /**
     * Guardar entrada en caché con control de tamaño
     */
    _set(scriptName, data) {
        // Si se alcanzó el límite, eliminar la entrada más antigua
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            console.log(`🗑️ [SignatureCache] Eliminada entrada antigua: ${oldestKey}`);
        }

        this.cache.set(scriptName, data);
    }

    /**
     * Invalidar firma de un script específico
     * @param {string} scriptName
     */
    invalidate(scriptName) {
        if (this.cache.has(scriptName)) {
            this.cache.delete(scriptName);
            this.stats.invalidations++;
            console.log(`🗑️ [SignatureCache] Invalidado: ${scriptName}`);
        }
    }

    /**
     * Invalidar todas las firmas
     */
    invalidateAll() {
        const count = this.cache.size;
        this.cache.clear();
        console.log(`🧹 [SignatureCache] Todas las firmas invalidadas (${count} entradas)`);
    }

    /**
     * Limpiar entradas expiradas
     */
    _cleanExpired() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, value] of this.cache.entries()) {
            if ((now - value.cachedAt) > this.ttl) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 [SignatureCache] Limpiadas ${cleaned} entradas expiradas`);
        }
    }

    /**
     * Obtener estadísticas del caché
     */
    getStats() {
        const hitRate = (this.stats.hits + this.stats.misses) > 0
            ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(2)
            : 0;

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.stats.hits,
            misses: this.stats.misses,
            invalidations: this.stats.invalidations,
            totalSignings: this.stats.totalSignings,
            hitRate: `${hitRate}%`,
            ttl: `${this.ttl / 1000}s`
        };
    }

    /**
     * Detener auto-limpieza (para shutdown)
     */
    destroy() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        this.cache.clear();
        console.log('🛑 [SignatureCache] Destruido');
    }
}

// Singleton
let instance = null;

function getSignatureCache(options) {
    if (!instance) {
        instance = new SignatureCache(options);
    }
    return instance;
}

module.exports = {
    SignatureCache,
    getSignatureCache
};
