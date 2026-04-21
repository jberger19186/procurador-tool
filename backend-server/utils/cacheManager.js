const crypto = require('crypto');

class CacheManager {
    constructor(options = {}) {
        this.cache = new Map();
        this.ttl = options.ttl || 3600000; // 1 hora por defecto
        this.maxSize = options.maxSize || 50; // Máximo 50 scripts en caché
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Genera una clave de caché única basada en nombre y hash
     */
    _generateKey(scriptName, hash) {
        return `${scriptName}:${hash}`;
    }

    /**
     * Obtiene un script del caché
     */
    get(scriptName, hash) {
        const key = this._generateKey(scriptName, hash);
        const cached = this.cache.get(key);

        if (!cached) {
            this.misses++;
            return null;
        }

        // Verificar si expiró
        if (Date.now() > cached.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }

        // Actualizar último acceso
        cached.lastAccess = Date.now();
        this.hits++;

        console.log(`✅ Cache HIT para ${scriptName} (hits: ${this.hits}, misses: ${this.misses})`);
        return cached.code;
    }

    /**
     * Guarda un script en el caché
     */
    set(scriptName, hash, code) {
        // Si el caché está lleno, eliminar el más antiguo
        if (this.cache.size >= this.maxSize) {
            this._evictOldest();
        }

        const key = this._generateKey(scriptName, hash);
        const now = Date.now();

        this.cache.set(key, {
            code,
            hash,
            createdAt: now,
            lastAccess: now,
            expiresAt: now + this.ttl,
            size: Buffer.byteLength(code, 'utf8')
        });

        console.log(`💾 Script ${scriptName} guardado en caché`);
    }

    /**
     * Elimina el script más antiguo (LRU - Least Recently Used)
     */
    _evictOldest() {
        let oldestKey = null;
        let oldestAccess = Infinity;

        for (const [key, value] of this.cache.entries()) {
            if (value.lastAccess < oldestAccess) {
                oldestAccess = value.lastAccess;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
            console.log(`🗑️ Script eliminado del caché por límite de tamaño`);
        }
    }

    /**
     * Invalida un script específico del caché
     */
    invalidate(scriptName) {
        let deleted = 0;
        for (const key of this.cache.keys()) {
            if (key.startsWith(`${scriptName}:`)) {
                this.cache.delete(key);
                deleted++;
            }
        }
        if (deleted > 0) {
            console.log(`🗑️ ${deleted} versión(es) de ${scriptName} eliminadas del caché`);
        }
        return deleted;
    }

    /**
     * Limpia todo el caché
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        console.log(`🗑️ Caché limpiado (${size} scripts eliminados)`);
    }

    /**
     * Limpia scripts expirados
     */
    cleanExpired() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, value] of this.cache.entries()) {
            if (now > value.expiresAt) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 ${cleaned} script(s) expirado(s) eliminados del caché`);
        }
        return cleaned;
    }

    /**
     * Obtiene estadísticas del caché
     */
    getStats() {
        let totalSize = 0;
        const scripts = [];

        for (const [key, value] of this.cache.entries()) {
            totalSize += value.size;
            scripts.push({
                key,
                size: value.size,
                age: Date.now() - value.createdAt,
                ttl: value.expiresAt - Date.now()
            });
        }

        const hitRate = this.hits + this.misses > 0
            ? (this.hits / (this.hits + this.misses) * 100).toFixed(2)
            : 0;

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            totalBytes: totalSize,
            totalMB: (totalSize / 1024 / 1024).toFixed(2),
            hits: this.hits,
            misses: this.misses,
            hitRate: `${hitRate}%`,
            scripts
        };
    }
}

module.exports = CacheManager;