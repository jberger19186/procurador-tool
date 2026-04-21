/**
 * securityAudit.js
 * Logging de eventos de seguridad con persistencia en JSON
 * 
 * Ubicación: electron-app/src/telemetry/securityAudit.js
 * 
 * Eventos que registra:
 * - script_verified: script pasó verificación de firma + checksum
 * - signature_failed: firma RSA inválida
 * - checksum_mismatch: checksum no coincide en alguna etapa
 * - verification_skipped: verificación omitida (sin clave pública)
 * - security_error: error genérico de seguridad
 */

const fs = require('fs');
const path = require('path');

class SecurityAudit {
    /**
     * @param {Object} options
     * @param {string} options.logDir - Directorio para archivos de log
     * @param {number} options.maxLogSize - Tamaño máximo del archivo de log en bytes (default: 5MB)
     * @param {number} options.maxEntries - Máximo de entradas en memoria (default: 1000)
     */
    constructor(options = {}) {
        this.logDir = options.logDir || this._getDefaultLogDir();
        this.maxLogSize = options.maxLogSize || 5 * 1024 * 1024; // 5MB
        this.maxEntries = options.maxEntries || 1000;
        
        this.events = [];
        this.sessionId = this._generateSessionId();
        this.sessionStart = new Date().toISOString();

        // Contadores rápidos
        this.counters = {
            script_verified: 0,
            signature_failed: 0,
            checksum_mismatch: 0,
            verification_skipped: 0,
            security_error: 0
        };

        this._ensureLogDir();

        console.log(`📋 [SecurityAudit] Inicializado (sesión: ${this.sessionId.substring(0, 8)}...)`);
    }

    /**
     * Obtener directorio de logs por defecto
     */
    _getDefaultLogDir() {
        try {
            const { app } = require('electron');
            return path.join(app.getPath('userData'), 'security-logs');
        } catch (e) {
            return path.join(process.cwd(), 'security-logs');
        }
    }

    /**
     * Generar ID de sesión único
     */
    _generateSessionId() {
        const crypto = require('crypto');
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Crear directorio de logs si no existe
     */
    _ensureLogDir() {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        } catch (error) {
            console.warn(`⚠️ [SecurityAudit] No se pudo crear directorio de logs: ${error.message}`);
        }
    }

    /**
     * Registrar evento genérico
     * @param {string} eventType - Tipo de evento
     * @param {Object} data - Datos adicionales del evento
     */
    _logEvent(eventType, data = {}) {
        const event = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            type: eventType,
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            ...data
        };

        // Agregar a memoria
        this.events.push(event);

        // Control de tamaño en memoria
        if (this.events.length > this.maxEntries) {
            this.events = this.events.slice(-Math.floor(this.maxEntries * 0.8));
        }

        // Actualizar contador
        if (this.counters.hasOwnProperty(eventType)) {
            this.counters[eventType]++;
        }

        // Persistir a disco (async, no bloquea)
        this._persistEvent(event);

        return event;
    }

    // ══════════════════════════════════════════════════
    // MÉTODOS PÚBLICOS DE REGISTRO
    // ══════════════════════════════════════════════════

    /**
     * Script verificado exitosamente (firma + checksum)
     */
    logScriptVerified(scriptName, details = {}) {
        const event = this._logEvent('script_verified', {
            scriptName,
            checksum: details.checksum || null,
            signedAt: details.signedAt || null,
            verificationTime: details.verificationTime || null,
            stage: details.stage || null
        });

        console.log(`📋 [Audit] ✅ script_verified: ${scriptName}`);
        return event;
    }

    /**
     * Firma RSA inválida
     */
    logSignatureFailed(scriptName, details = {}) {
        const event = this._logEvent('signature_failed', {
            scriptName,
            expectedChecksum: details.expectedChecksum || null,
            actualChecksum: details.actualChecksum || null,
            error: details.error || null,
            severity: 'CRITICAL'
        });

        console.error(`📋 [Audit] ❌ signature_failed: ${scriptName} | CRITICAL`);
        return event;
    }

    /**
     * Checksum no coincide en alguna etapa
     */
    logChecksumMismatch(scriptName, stage, details = {}) {
        const event = this._logEvent('checksum_mismatch', {
            scriptName,
            stage,
            expectedChecksum: details.expected || null,
            actualChecksum: details.actual || null,
            severity: 'CRITICAL'
        });

        console.error(`📋 [Audit] ❌ checksum_mismatch: ${scriptName} | Etapa ${stage} | CRITICAL`);
        return event;
    }

    /**
     * Verificación omitida (sin clave pública, degradación elegante)
     */
    logVerificationSkipped(scriptName, reason = '') {
        const event = this._logEvent('verification_skipped', {
            scriptName,
            reason,
            severity: 'WARNING'
        });

        console.warn(`📋 [Audit] ⚠️ verification_skipped: ${scriptName} | ${reason}`);
        return event;
    }

    /**
     * Error genérico de seguridad
     */
    logSecurityError(scriptName, error, details = {}) {
        const event = this._logEvent('security_error', {
            scriptName,
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof Error ? error.name : 'Unknown',
            stack: error instanceof Error ? error.stack : null,
            severity: details.severity || 'HIGH',
            ...details
        });

        console.error(`📋 [Audit] ❌ security_error: ${scriptName} | ${error instanceof Error ? error.message : error}`);
        return event;
    }

    // ══════════════════════════════════════════════════
    // PERSISTENCIA
    // ══════════════════════════════════════════════════

    /**
     * Persistir evento a archivo JSON (append)
     */
    _persistEvent(event) {
        try {
            const logFile = this._getCurrentLogFile();
            
            // Verificar tamaño del archivo
            if (fs.existsSync(logFile)) {
                const stats = fs.statSync(logFile);
                if (stats.size >= this.maxLogSize) {
                    this._rotateLog(logFile);
                }
            }

            // Append como línea JSON (JSONL format)
            fs.appendFileSync(logFile, JSON.stringify(event) + '\n', 'utf8');

        } catch (error) {
            // No propagar errores de logging
            console.warn(`⚠️ [SecurityAudit] Error persistiendo evento: ${error.message}`);
        }
    }

    /**
     * Obtener ruta del archivo de log actual
     */
    _getCurrentLogFile() {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.logDir, `security-audit-${date}.jsonl`);
    }

    /**
     * Rotar archivo de log cuando excede el tamaño máximo
     */
    _rotateLog(logFile) {
        try {
            const timestamp = Date.now();
            const rotatedPath = logFile.replace('.jsonl', `-${timestamp}.jsonl`);
            fs.renameSync(logFile, rotatedPath);
            console.log(`📋 [SecurityAudit] Log rotado: ${path.basename(rotatedPath)}`);
        } catch (error) {
            console.warn(`⚠️ [SecurityAudit] Error rotando log: ${error.message}`);
        }
    }

    // ══════════════════════════════════════════════════
    // CONSULTAS Y REPORTES
    // ══════════════════════════════════════════════════

    /**
     * Obtener eventos de la sesión actual
     * @param {Object} filters - { type, scriptName, severity, limit }
     */
    getEvents(filters = {}) {
        let filtered = [...this.events];

        if (filters.type) {
            filtered = filtered.filter(e => e.type === filters.type);
        }
        if (filters.scriptName) {
            filtered = filtered.filter(e => e.scriptName === filters.scriptName);
        }
        if (filters.severity) {
            filtered = filtered.filter(e => e.severity === filters.severity);
        }
        if (filters.limit) {
            filtered = filtered.slice(-filters.limit);
        }

        return filtered;
    }

    /**
     * Obtener contadores rápidos
     */
    getCounters() {
        return { ...this.counters };
    }

    /**
     * Obtener resumen de seguridad
     */
    getSummary() {
        const criticalEvents = this.events.filter(e => e.severity === 'CRITICAL');

        return {
            sessionId: this.sessionId,
            sessionStart: this.sessionStart,
            totalEvents: this.events.length,
            counters: this.getCounters(),
            criticalCount: criticalEvents.length,
            lastCritical: criticalEvents.length > 0 ? criticalEvents[criticalEvents.length - 1] : null,
            logDirectory: this.logDir
        };
    }

    /**
     * Imprimir reporte de seguridad en consola
     */
    printReport() {
        const summary = this.getSummary();

        console.log('\n═══════════════════════════════════════════════');
        console.log('🔐 REPORTE DE AUDITORÍA DE SEGURIDAD');
        console.log('═══════════════════════════════════════════════');
        console.log(`Sesión:             ${summary.sessionId.substring(0, 16)}...`);
        console.log(`Inicio:             ${summary.sessionStart}`);
        console.log(`Total eventos:      ${summary.totalEvents}`);
        console.log('───────────────────────────────────────────────');
        console.log(`✅ Verificados:     ${summary.counters.script_verified}`);
        console.log(`❌ Firma inválida:  ${summary.counters.signature_failed}`);
        console.log(`❌ Checksum error:  ${summary.counters.checksum_mismatch}`);
        console.log(`⚠️ Omitidos:        ${summary.counters.verification_skipped}`);
        console.log(`❌ Errores:         ${summary.counters.security_error}`);
        console.log('───────────────────────────────────────────────');
        console.log(`🚨 CRÍTICOS:        ${summary.criticalCount}`);

        if (summary.lastCritical) {
            console.log(`   Último crítico:  ${summary.lastCritical.type} @ ${summary.lastCritical.timestamp}`);
        }

        console.log(`📁 Logs:            ${summary.logDirectory}`);
        console.log('═══════════════════════════════════════════════\n');
    }

    /**
     * Exportar todos los eventos de la sesión actual a un archivo JSON
     */
    exportSession() {
        try {
            const exportFile = path.join(this.logDir, `session-${this.sessionId.substring(0, 8)}.json`);
            const exportData = {
                sessionId: this.sessionId,
                sessionStart: this.sessionStart,
                exportedAt: new Date().toISOString(),
                counters: this.getCounters(),
                events: this.events
            };

            fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2), 'utf8');
            console.log(`📋 [SecurityAudit] Sesión exportada: ${exportFile}`);
            return exportFile;

        } catch (error) {
            console.error(`❌ [SecurityAudit] Error exportando sesión: ${error.message}`);
            return null;
        }
    }

    /**
     * Limpiar eventos en memoria
     */
    clear() {
        this.events = [];
        Object.keys(this.counters).forEach(k => this.counters[k] = 0);
    }
}

module.exports = SecurityAudit;
