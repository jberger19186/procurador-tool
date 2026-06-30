const { Notification } = require('electron');

/**
 * NotificationManager
 * Gestiona notificaciones de escritorio
 */
class NotificationManager {
    constructor() {
        this.enabled = true; // Por defecto activado
        this.soundEnabled = true;
    }

    /**
     * Verificar si las notificaciones están soportadas
     */
    isSupported() {
        return Notification.isSupported();
    }

    /**
     * Mostrar notificación de proceso completado
     */
    notifyProcessComplete(stats = {}) {
        if (!this.enabled) return;

        const {
            expedientes = 0,
            exitosos = 0,
            fallidos = 0,
            tiempo = 0
        } = stats;

        const tiempoMin = Math.floor(tiempo / 60000);
        const tiempoSeg = Math.floor((tiempo % 60000) / 1000);

        const title = '✅ Proceso Completado';
        const body = `Expedientes procesados: ${expedientes}\n` +
            `Exitosos: ${exitosos} | Fallidos: ${fallidos}\n` +
            `Tiempo: ${tiempoMin}m ${tiempoSeg}s`;

        this.show(title, body, 'success');
    }

    /**
     * Mostrar notificación de error
     */
    notifyError(errorMessage) {
        if (!this.enabled) return;

        const title = '❌ Error en Proceso';
        const body = errorMessage || 'Ocurrió un error durante la ejecución';

        this.show(title, body, 'error');
    }

    /**
     * Notificación de inicio de proceso.
     * Recibe una etiqueta amigable del tipo de proceso (ej: "Procurar",
     * "Informe Por Lote"). Si llega el nombre crudo del script (.js), lo
     * traduce con la tabla de respaldo para no mostrar el filename al usuario.
     */
    notifyProcessStarted(processLabel) {
        if (!this.enabled) return;

        const title = '🚀 Proceso Iniciado';
        const body = `Ejecutando: ${this.friendlyLabel(processLabel)}`;

        this.show(title, body, 'info');
    }

    /**
     * Traduce un identificador de proceso a una etiqueta para el usuario.
     * Si ya viene una etiqueta amigable (sin .js) la devuelve tal cual;
     * si viene un nombre de script lo mapea (respaldo defensivo).
     */
    friendlyLabel(value) {
        if (!value) return 'Proceso';
        if (!String(value).endsWith('.js')) return value; // ya es etiqueta amigable
        const map = {
            'procesarNovedadesCompleto.js': 'Procurar',
            'procesarCustomExpedientes.js': 'Procurar Por Lote',
            'informequickscwpjn.js': 'Informe',
            'procesarMonitoreo.js': 'Monitor',
            'listarSCWPJN.js': 'Listado de expedientes',
        };
        return map[value] || 'Proceso';
    }

    /**
     * Notificación genérica
     */
    show(title, body, type = 'info') {
        if (!this.enabled) return;

        try {
            // Usar notificación nativa de Electron
            if (this.isSupported()) {
                const notification = new Notification({
                    title: title,
                    body: body,
                    icon: this.getIcon(type),
                    silent: !this.soundEnabled
                });

                notification.show();

                // Click handler
                notification.on('click', () => {
                    console.log('Notificación clickeada');
                });

            } else {
                // Fallback a console si no están soportadas
                console.log(`🔔 [${type}] ${title}: ${body}`);
            }

        } catch (error) {
            console.error('Error mostrando notificación:', error);
        }
    }

    /**
     * Obtener ícono según tipo
     */
    getIcon(type) {
        // Retornar path a íconos personalizados si los tenés
        // Por ahora, null (usa ícono por defecto)
        return null;
    }

    /**
     * Configurar notificaciones
     */
    configure(settings = {}) {
        if (typeof settings.enabled === 'boolean') {
            this.enabled = settings.enabled;
        }
        if (typeof settings.sound === 'boolean') {
            this.soundEnabled = settings.sound;
        }

        console.log(`🔔 Notificaciones: ${this.enabled ? 'activadas' : 'desactivadas'}`);
    }

    /**
     * Activar notificaciones
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Desactivar notificaciones
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Toggle notificaciones
     */
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
}

module.exports = NotificationManager;