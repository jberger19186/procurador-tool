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
     * @param {number} options.maxSize - Máximo de entradas (default: 500)
     */
    constructor(options = {}) {
        this.ttl = options.ttl || 3600000; // 1 hora
        // C.1 capa 2 (fase E9): la clave del caché pasó de `scriptName` a
        // `scriptName:userId` porque el contenido entregado lleva marca de agua por
        // cuenta. Eso multiplica el espacio de claves por la cantidad de usuarios
        // activos: con 13 scripts distribuibles, 100 entradas se llenaban con 7
        // usuarios y a partir de ahí la evicción FIFO hacía que todos fallaran el
        // caché y se firmara con RSA en cada descarga. 500 cubre ~38 usuarios
        // concurrentes; cada entrada son ~400 bytes (checksum + firma base64), o sea
        // ~200 KB en el peor caso.
        this.maxSize = options.maxSize || 500;
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
     *
     * C.1 capa 2 (fase E9): `userId` compone la clave del caché. El contenido que se
     * firma lleva una marca de agua por cuenta, así que dos usuarios que piden el mismo
     * script reciben contenidos DISTINTOS y necesitan firmas distintas. Cachear solo por
     * `scriptName` mezclaba las dos entregas en una entrada.
     *
     * Sobre el modo de falla real, para que no se sobreestime lo que arregla este cambio:
     * el guard `cached.checksum === currentChecksum` de abajo ya impedía devolver la
     * firma de otro usuario — ante contenido distinto el caché invalidaba y volvía a
     * firmar. O sea que la clave por nombre NO entregaba firmas equivocadas; lo que hacía
     * era garantizar 0 % de aciertos y una firma RSA por descarga, más una invalidación
     * espuria por cada usuario que pasara. La clave compuesta restaura el caché y deja de
     * depender de ese guard como única defensa (defensa en profundidad).
     *
     * @param {string} scriptName - Nombre del script (ya normalizado, con .js)
     * @param {string} scriptContent - Contenido exacto que se va a entregar (CON marca)
     * @param {number|string} [userId] - Dueño de la entrega; compone la clave del caché
     * @returns {Object} - { checksum, signature, signedAt, fromCache }
     */
    getOrCalculate(scriptName, scriptContent, userId) {
        const signer = getScriptSigner();

        if (!signer.isReady()) {
            throw new Error('[SignatureCache] ScriptSigner no está listo');
        }

        const cacheKey = (userId === undefined || userId === null)
            ? scriptName
            : `${scriptName}:${userId}`;

        // Calcular checksum actual para comparar
        const currentChecksum = signer.calculateChecksum(scriptContent);

        // Buscar en caché
        const cached = this.cache.get(cacheKey);

        if (cached) {
            // Verificar que el contenido no cambió Y que no expiró
            const isExpired = (Date.now() - cached.cachedAt) > this.ttl;
            const checksumMatch = cached.checksum === currentChecksum;

            if (checksumMatch && !isExpired) {
                this.stats.hits++;
                console.log(`📦 [SignatureCache] HIT: ${cacheKey} (checksum: ${currentChecksum.substring(0, 12)}...)`);
                
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
                console.log(`🔄 [SignatureCache] INVALIDADO: ${cacheKey} (checksum cambió)`);
            }

            // Si expiró
            if (isExpired) {
                console.log(`⏰ [SignatureCache] EXPIRADO: ${cacheKey}`);
            }
        }

        // Cache MISS - firmar de nuevo
        this.stats.misses++;
        this.stats.totalSignings++;

        console.log(`🔏 [SignatureCache] MISS: ${cacheKey} - firmando...`);

        const signResult = signer.signScript(scriptContent);

        // Guardar en caché — OJO: con `scriptName` acá y `cacheKey` en el get, el caché
        // escribiría en una clave y leería de otra: 0 % de aciertos para siempre.
        this._set(cacheKey, {
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
    _set(cacheKey, data) {
        // Si se alcanzó el límite, eliminar la entrada más antigua
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            console.log(`🗑️ [SignatureCache] Eliminada entrada antigua: ${oldestKey}`);
        }

        this.cache.set(cacheKey, data);
    }

    /**
     * Invalidar las firmas de un script, para TODOS los usuarios.
     *
     * C.1 capa 2 (fase E9): las claves ahora son `scriptName:userId`, así que un
     * `cache.delete(scriptName)` a secas ya no encuentra nada. Sin este barrido por
     * prefijo el método quedaba convertido en un no-op silencioso — hoy no tiene
     * consumidores (verificado por grep: solo `destroy()` se llama, desde server.js),
     * pero un no-op silencioso en una función de invalidación de firmas es la clase de
     * cosa que se descubre tarde y mal.
     *
     * @param {string} scriptName
     */
    invalidate(scriptName) {
        const prefijo = `${scriptName}:`;
        let borradas = 0;
        for (const key of [...this.cache.keys()]) {
            if (key === scriptName || key.startsWith(prefijo)) {
                this.cache.delete(key);
                borradas++;
            }
        }
        if (borradas > 0) {
            this.stats.invalidations += borradas;
            console.log(`🗑️ [SignatureCache] Invalidado: ${scriptName} (${borradas} entrada(s))`);
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
