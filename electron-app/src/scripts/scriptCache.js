const crypto = require('crypto');

/**
 * ScriptCache
 * Almacena scripts desencriptados SOLO en memoria RAM
 * Se limpia automáticamente al cerrar la aplicación
 */
class ScriptCache {
    constructor() {
        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            downloads: 0
        };

        console.log('🗄️ ScriptCache inicializado (solo RAM)');
    }

    /**
     * Guardar script desencriptado en caché
     */
    set(scriptName, decryptedCode, metadata = {}) {
        try {
            const hash = this._generateHash(decryptedCode);

            this.cache.set(scriptName, {
                code: decryptedCode,
                hash: hash,
                cachedAt: Date.now(),
                metadata: metadata,
                // NUEVO: Metadata de seguridad RSA
                security: metadata.security || null
            });

            console.log(`💾 Script cacheado: ${scriptName} (${this._formatSize(decryptedCode.length)})`);
            return true;
        } catch (error) {
            console.error(`❌ Error cacheando ${scriptName}:`, error.message);
            return false;
        }
    }

    /**
     * Obtener script del caché
     */
    get(scriptName) {
        if (this.cache.has(scriptName)) {
            this.stats.hits++;
            const cached = this.cache.get(scriptName);
            console.log(`✅ Cache HIT: ${scriptName}`);
            return cached.code;
        }

        this.stats.misses++;
        console.log(`❌ Cache MISS: ${scriptName}`);
        return null;
    }

    /**
     * Obtener el hash del servidor almacenado al momento de la descarga.
     * Se usa para comparar con el hash actual del servidor y detectar actualizaciones.
     * @returns {string|null} - SHA-256 hash del script según el servidor, o null si no disponible
     */
    getServerHash(scriptName) {
        if (this.cache.has(scriptName)) {
            const cached = this.cache.get(scriptName);
            return cached.metadata?.hash || null;
        }
        return null;
    }

    /**
     * Obtener metadata de seguridad de un script cacheado
     * @returns {Object|null} - { checksum, signature, signedAt }
     */
    getSecurity(scriptName) {
        if (this.cache.has(scriptName)) {
            const cached = this.cache.get(scriptName);
            return cached.security || null;
        }
        return null;
    }

    /**
     * Verificar si existe en caché
     */
    has(scriptName) {
        return this.cache.has(scriptName);
    }

    /**
     * Verificar integridad del script por hash
     */
    verifyIntegrity(scriptName, expectedHash) {
        if (!this.cache.has(scriptName)) {
            return false;
        }

        const cached = this.cache.get(scriptName);
        return cached.hash === expectedHash;
    }

    /**
     * Eliminar script del caché
     */
    delete(scriptName) {
        if (this.cache.has(scriptName)) {
            this.cache.delete(scriptName);
            console.log(`🗑️ Script eliminado del caché: ${scriptName}`);
            return true;
        }
        return false;
    }

    /**
     * Limpiar todo el caché
     */
    clear() {
        const count = this.cache.size;
        this.cache.clear();
        this.stats = {
            hits: 0,
            misses: 0,
            downloads: 0
        };
        console.log(`🧹 Caché limpiado (${count} scripts eliminados)`);
    }

    /**
     * Obtener estadísticas
     */
    getStats() {
        const totalSize = Array.from(this.cache.values())
            .reduce((sum, item) => sum + item.code.length, 0);

        const hitRate = this.stats.hits + this.stats.misses > 0
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : 0;

        return {
            scriptsCount: this.cache.size,
            totalSize: this._formatSize(totalSize),
            hits: this.stats.hits,
            misses: this.stats.misses,
            downloads: this.stats.downloads,
            hitRate: `${hitRate}%`
        };
    }

    /**
     * Incrementar contador de descargas
     */
    incrementDownloads() {
        this.stats.downloads++;
    }

    /**
     * Listar scripts en caché
     */
    list() {
        return Array.from(this.cache.entries()).map(([name, data]) => ({
            name,
            size: this._formatSize(data.code.length),
            cachedAt: new Date(data.cachedAt).toLocaleString(),
            hash: data.hash.substring(0, 16) + '...'
        }));
    }

    /**
     * Generar hash SHA-256 del código
     */
    _generateHash(code) {
        return crypto.createHash('sha256')
            .update(code)
            .digest('hex');
    }

    /**
     * Formatear tamaño en bytes
     */
    _formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }
}

module.exports = ScriptCache;