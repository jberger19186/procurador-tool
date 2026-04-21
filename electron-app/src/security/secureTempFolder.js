const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

/**
 * SecureTempFolder
 * Gestiona carpetas temporales con nombres aleatorios y atributos ocultos
 */
class SecureTempFolder {
    constructor() {
        this.activeFolders = new Set(); // Tracking de carpetas activas
        this.cleanupInterval = null;
    }

    /**
     * Generar hash único para nombre de carpeta
     */
    generateFolderHash() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        const combined = `${timestamp}-${random}`;

        // Hash SHA-256 del combined
        const hash = crypto.createHash('sha256').update(combined).digest('hex');

        // Usar solo primeros 16 caracteres para nombre más corto
        return hash.substring(0, 16);
    }

    /**
     * Crear carpeta temporal segura
     * @returns {string} - Path a la carpeta creada
     */
    async createSecureFolder() {
        const folderHash = this.generateFolderHash();
        const baseTempDir = os.tmpdir();

        // Usar subcarpeta con nombre genérico + hash
        const folderName = `tmp_${folderHash}`;
        const folderPath = path.join(baseTempDir, folderName);

        try {
            // Crear carpeta
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
            }

            // Ocultar carpeta (solo Windows)
            if (process.platform === 'win32') {
                await this.hideFolderWindows(folderPath);
            }

            // Agregar a tracking
            this.activeFolders.add(folderPath);

            console.log(`🔐 Carpeta segura creada: ${folderName}`);
            return folderPath;

        } catch (error) {
            console.error('❌ Error creando carpeta segura:', error);
            throw error;
        }
    }

    /**
     * Ocultar carpeta en Windows
     */
    hideFolderWindows(folderPath) {
        return new Promise((resolve, reject) => {
            const command = `attrib +h "${folderPath}"`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.warn('⚠️ No se pudo ocultar carpeta:', error.message);
                    // No rechazar - carpeta sigue siendo usable
                    resolve(false);
                } else {
                    console.log('👻 Carpeta marcada como oculta');
                    resolve(true);
                }
            });
        });
    }

    /**
     * Eliminar carpeta segura
     * @param {string} folderPath - Path de la carpeta a eliminar
     * @param {number} delay - Delay en ms antes de eliminar (default: 0)
     */
    async deleteSecureFolder(folderPath, delay = 0) {
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            if (fs.existsSync(folderPath)) {
                // Eliminar recursivamente
                fs.rmSync(folderPath, { recursive: true, force: true });
                console.log(`🗑️ Carpeta segura eliminada: ${path.basename(folderPath)}`);
            }

            // Remover de tracking
            this.activeFolders.delete(folderPath);

        } catch (error) {
            console.error('⚠️ Error eliminando carpeta segura:', error.message);
            // Agregar a lista de limpieza posterior
            this.scheduleCleanup(folderPath);
        }
    }

    /**
     * Programar limpieza de carpeta para después
     */
    scheduleCleanup(folderPath) {
        setTimeout(() => {
            try {
                if (fs.existsSync(folderPath)) {
                    fs.rmSync(folderPath, { recursive: true, force: true });
                    console.log(`🧹 Limpieza diferida exitosa: ${path.basename(folderPath)}`);
                }
            } catch (error) {
                console.error('⚠️ Limpieza diferida falló:', error.message);
            }
        }, 60000); // Reintentar en 1 minuto
    }

    /**
     * Limpiar todas las carpetas activas
     */
    async cleanupAll() {
        console.log(`🧹 Limpiando ${this.activeFolders.size} carpetas activas...`);

        const promises = Array.from(this.activeFolders).map(folderPath =>
            this.deleteSecureFolder(folderPath, 0)
        );

        await Promise.allSettled(promises);
        this.activeFolders.clear();
    }

    /**
     * Iniciar limpieza automática de carpetas huérfanas
     */
    startAutoCleanup() {
        // Limpiar carpetas tmp_* huérfanas cada 5 minutos
        this.cleanupInterval = setInterval(() => {
            this.cleanupOrphanedFolders();
        }, 300000); // 5 minutos

        console.log('🔄 Auto-limpieza de carpetas iniciada');
    }

    /**
     * Detener limpieza automática
     */
    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('🛑 Auto-limpieza detenida');
        }
    }

    /**
     * Limpiar carpetas tmp_* antiguas (>1 hora)
     */
    cleanupOrphanedFolders() {
        try {
            const baseTempDir = os.tmpdir();
            const folders = fs.readdirSync(baseTempDir);
            const now = Date.now();
            let cleaned = 0;

            for (const folder of folders) {
                if (folder.startsWith('tmp_')) {
                    const folderPath = path.join(baseTempDir, folder);

                    try {
                        const stats = fs.statSync(folderPath);
                        const age = now - stats.mtimeMs;

                        // Eliminar si tiene más de 1 hora
                        if (age > 3600000) {
                            fs.rmSync(folderPath, { recursive: true, force: true });
                            cleaned++;
                        }
                    } catch (err) {
                        // Ignorar errores en carpetas individuales
                    }
                }
            }

            if (cleaned > 0) {
                console.log(`🧹 Limpieza automática: ${cleaned} carpetas huérfanas eliminadas`);
            }

        } catch (error) {
            console.error('⚠️ Error en limpieza automática:', error.message);
        }
    }
}

module.exports = SecureTempFolder;