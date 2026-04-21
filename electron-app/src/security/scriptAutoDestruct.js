const fs = require('fs');
const path = require('path');

/**
 * ScriptAutoDestruct
 * Elimina scripts .js del disco apenas se cargan en memoria
 */
class ScriptAutoDestruct {
    constructor() {
        this.scheduledDeletions = new Map(); // scriptPath -> timeoutId
    }

    /**
     * Programar auto-destrucción de script
     * @param {string} scriptPath - Path del script a eliminar
     * @param {number} delay - Delay en ms (default: 100ms)
     */
    scheduleDestruction(scriptPath, delay = 100) {
        console.log(`💣 Auto-destrucción programada: ${path.basename(scriptPath)} en ${delay}ms`);

        const timeoutId = setTimeout(() => {
            this.destroyScript(scriptPath);
        }, delay);

        this.scheduledDeletions.set(scriptPath, timeoutId);
    }

    /**
     * Destruir script inmediatamente
     */
    destroyScript(scriptPath) {
        try {
            if (fs.existsSync(scriptPath)) {
                // Sobrescribir con datos aleatorios antes de eliminar
                this.secureDelete(scriptPath);

                console.log(`💥 Script destruido: ${path.basename(scriptPath)}`);
                this.scheduledDeletions.delete(scriptPath);
            }
        } catch (error) {
            console.error(`⚠️ Error destruyendo script:`, error.message);
            // Reintentar en 500ms
            setTimeout(() => this.destroyScript(scriptPath), 500);
        }
    }

    /**
     * Eliminación segura: sobrescribir + eliminar
     */
    secureDelete(filePath) {
        try {
            const stats = fs.statSync(filePath);
            const fileSize = stats.size;

            // Sobrescribir con datos aleatorios
            const randomData = Buffer.alloc(fileSize);
            for (let i = 0; i < fileSize; i++) {
                randomData[i] = Math.floor(Math.random() * 256);
            }

            fs.writeFileSync(filePath, randomData);

            // Eliminar archivo
            fs.unlinkSync(filePath);

        } catch (error) {
            // Si falla sobrescritura, al menos intentar eliminar
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                throw error;
            }
        }
    }

    /**
     * Cancelar destrucción programada
     */
    cancelDestruction(scriptPath) {
        const timeoutId = this.scheduledDeletions.get(scriptPath);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.scheduledDeletions.delete(scriptPath);
            console.log(`🛑 Auto-destrucción cancelada: ${path.basename(scriptPath)}`);
        }
    }

    /**
     * Destruir múltiples scripts
     */
    scheduleMultiple(scriptPaths, delay = 100) {
        for (const scriptPath of scriptPaths) {
            this.scheduleDestruction(scriptPath, delay);
        }
    }

    /**
     * Limpiar todas las destrucciones pendientes
     */
    cleanup() {
        for (const [scriptPath, timeoutId] of this.scheduledDeletions) {
            clearTimeout(timeoutId);
            // Ejecutar destrucción inmediatamente
            this.destroyScript(scriptPath);
        }
        this.scheduledDeletions.clear();
    }
}

module.exports = ScriptAutoDestruct;