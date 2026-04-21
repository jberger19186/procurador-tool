/**
 * SecurityMetrics
 * Monitorea efectividad de medidas de seguridad
 */
class SecurityMetrics {
    constructor() {
        this.metrics = {
            scriptsObfuscated: 0,
            secureFoldersCreated: 0,
            scriptsAutoDestructed: 0,
            averageObfuscationTime: 0,
            averageScriptLifetime: 0,
            notificationsSent: 0
        };

        this.obfuscationTimes = [];
        this.scriptLifetimes = [];
    }

    recordObfuscation(timeTaken) {
        this.metrics.scriptsObfuscated++;
        this.obfuscationTimes.push(timeTaken);
        this.metrics.averageObfuscationTime = this.calculateAverage(this.obfuscationTimes);
    }

    recordSecureFolder() {
        this.metrics.secureFoldersCreated++;
    }

    recordAutoDestruct(lifetime) {
        this.metrics.scriptsAutoDestructed++;
        this.scriptLifetimes.push(lifetime);
        this.metrics.averageScriptLifetime = this.calculateAverage(this.scriptLifetimes);
    }

    recordNotification() {
        this.metrics.notificationsSent++;
    }

    calculateAverage(array) {
        if (array.length === 0) return 0;
        const sum = array.reduce((a, b) => a + b, 0);
        return Math.round(sum / array.length);
    }

    getMetrics() {
        return {
            ...this.metrics
        };
    }

    printReport() {
        console.log('\n═══════════════════════════════════════');
        console.log('📊 REPORTE DE SEGURIDAD');
        console.log('═══════════════════════════════════════');
        console.log(`Scripts ofuscados: ${this.metrics.scriptsObfuscated}`);
        console.log(`Carpetas seguras creadas: ${this.metrics.secureFoldersCreated}`);
        console.log(`Scripts auto-destruidos: ${this.metrics.scriptsAutoDestructed}`);
        console.log(`Tiempo promedio ofuscación: ${this.metrics.averageObfuscationTime}ms`);
        console.log(`Lifetime promedio scripts: ${this.metrics.averageScriptLifetime}ms`);
        console.log(`Notificaciones enviadas: ${this.metrics.notificationsSent}`);
        console.log('═══════════════════════════════════════\n');
    }

    reset() {
        this.metrics = {
            scriptsObfuscated: 0,
            secureFoldersCreated: 0,
            scriptsAutoDestructed: 0,
            averageObfuscationTime: 0,
            averageScriptLifetime: 0,
            notificationsSent: 0
        };
        this.obfuscationTimes = [];
        this.scriptLifetimes = [];
    }
}

module.exports = SecurityMetrics;