const { contextBridge, ipcRenderer } = require('electron');

console.log('🔄 Preload.js iniciando...');

try {
    // Exponer API segura al renderer
    contextBridge.exposeInMainWorld('electronAPI', {
        // ============ AUTENTICACIÓN ============
        getAppVersion: () => ipcRenderer.invoke('get-app-version'),
        getMachineId: () => ipcRenderer.invoke('get-machine-id'),
        checkConnection: () => ipcRenderer.invoke('check-connection'),
        login: (email, password) => ipcRenderer.invoke('login', email, password),
        logout: () => ipcRenderer.invoke('logout'),
        showConfirmDialog: (title, message) => ipcRenderer.invoke('show-confirm-dialog', title, message),
        verifySession: () => ipcRenderer.invoke('verify-session'),
        getUserInfo: () => ipcRenderer.invoke('get-user-info'),

        // ============ CONFIGURACIÓN ============
        loadConfig: () => ipcRenderer.invoke('load-config'),
        saveConfig: (config) => ipcRenderer.invoke('save-config', config),

        // ============ PROCESOS ============
        runProcess: (options) => ipcRenderer.invoke('run-process', options),
        runProcessCustomDate: (fecha) => ipcRenderer.invoke('run-process-custom-date', fecha),
        runProcessCustom: (opts) => ipcRenderer.invoke('run-process-custom', opts),
        stopProcess: () => ipcRenderer.invoke('stop-process'),
        listExpedientes: (fechaLimite) => ipcRenderer.invoke('list-expedientes', fechaLimite),

        // ============ ARCHIVOS ============
        openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
        openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
        cleanFolder: (folderType) => ipcRenderer.invoke('clean-folder', folderType),

        // ============ ESTADÍSTICAS ============
        getStats: () => ipcRenderer.invoke('get-stats'),

        // ============ VENTANA ============
        resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', width, height),
        positionLeft: () => ipcRenderer.invoke('position-left'),
        restoreWindow: () => ipcRenderer.invoke('restore-window'),

        // Controles de ventana sin marco nativo
        minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
        maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
        closeWindow:    () => ipcRenderer.invoke('window-close'),
        showAppMenu:    () => ipcRenderer.invoke('show-app-menu'),

        // Acciones del menú nativo recibidas por el renderer
        onMenuAction: (callback) => {
            ipcRenderer.on('menu-action', (_, action) => callback(action));
        },

        // ============ RUTAS DE ARCHIVOS ============
        getVisorPath: () => ipcRenderer.invoke('get-visor-path'),
        getLatestExcel: () => ipcRenderer.invoke('get-latest-excel'),

        // ============ LISTENERS PARA EVENTOS DEL PROCESO ============
        onProcessLog: (callback) => {
            ipcRenderer.on('process-log', (event, log) => callback(log));
        },

        onBatchProgress: (callback) => {
            ipcRenderer.on('batch-progress', (event, data) => callback(data));
        },

        onProcessMessage: (callback) => {
            ipcRenderer.on('process-message', (event, message) => callback(message));
        },

        onProcessFinished: (callback) => {
            ipcRenderer.on('process-finished', (event, result) => callback(result));
        },

        // Notificación cuando el script requiere que el usuario ingrese credenciales manualmente
        onLoginManualRequired: (callback) => {
            ipcRenderer.on('login-manual-required', (event, data) => callback(data));
        },

        // Notificación cuando el navegador se reinició durante un reintento (queda oculto)
        onBrowserRestarted: (callback) => {
            ipcRenderer.on('browser-restarted', () => callback());
        },

        // ============ ACTUALIZACIONES ============
        // Solicitar instalación inmediata de la actualización descargada
        installUpdate: () => ipcRenderer.invoke('install-update'),

        // Notificación: nueva versión detectada, descargando en background
        onUpdateAvailable: (callback) => {
            ipcRenderer.on('update-available', (_, info) => callback(info));
        },

        // Notificación: descarga completada, lista para instalar
        onUpdateDownloaded: (callback) => {
            ipcRenderer.on('update-downloaded', (_, info) => callback(info));
        },

        // Notificación: no hay actualización disponible
        onUpdateNotAvailable: (callback) => {
            ipcRenderer.on('update-not-available', callback);
        },

        // ============ INFORME ============
        runInforme: (opts) => ipcRenderer.invoke('run-informe', opts),
        selectBatchFile: () => ipcRenderer.invoke('select-batch-file'),
        onInformeBatchComplete: (callback) => {
            ipcRenderer.on('informe-batch-complete', (_, data) => callback(data));
        },

        // ============ CUENTA Y TICKETS ============
        getAccount: () => ipcRenderer.invoke('get-account'),
        getBatchLimits: () => ipcRenderer.invoke('get-batch-limits'),
        getTickets: () => ipcRenderer.invoke('get-tickets'),
        getTicketDetail: (id) => ipcRenderer.invoke('get-ticket-detail', id),
        createTicket: (category, title, description) => ipcRenderer.invoke('create-ticket', category, title, description),
        addTicketComment: (id, message) => ipcRenderer.invoke('add-ticket-comment', id, message),

        // ============ MONITOR DE PARTES ============
        runMonitoreo: (opts) => ipcRenderer.invoke('run-monitoreo', opts),
        monitorGetPartes: () => ipcRenderer.invoke('monitor-get-partes'),
        monitorGetStats: () => ipcRenderer.invoke('monitor-get-stats'),
        monitorAgregarParte: (data) => ipcRenderer.invoke('monitor-agregar-parte', data),
        monitorEditarParte: (data) => ipcRenderer.invoke('monitor-editar-parte', data),
        monitorEliminarParte: (id) => ipcRenderer.invoke('monitor-eliminar-parte', id),
        monitorGetExpedientes: (parteId) => ipcRenderer.invoke('monitor-get-expedientes', parteId),
        monitorGetAllExpedientes: () => ipcRenderer.invoke('monitor-get-all-expedientes'),
        monitorGetNovedades: () => ipcRenderer.invoke('monitor-get-novedades'),
        monitorConfirmarExp: (id) => ipcRenderer.invoke('monitor-confirmar-exp', id),
        monitorRechazarExp: (id) => ipcRenderer.invoke('monitor-rechazar-exp', id),
        monitorBulkConfirmar: (ids) => ipcRenderer.invoke('monitor-bulk-confirmar', ids),
        monitorDescartarTodos: () => ipcRenderer.invoke('monitor-descartar-todos'),
        monitorGenerarVisorGuardado: (tipo) => ipcRenderer.invoke('monitor-generar-visor-guardado', tipo),

        // ============ EXTENSIÓN CHROME ============
        installExtension:       () => ipcRenderer.invoke('install-extension'),
        checkExtensionVersion:  () => ipcRenderer.invoke('check-extension-version'),
        generateExtensionPdf:   (data) => ipcRenderer.invoke('generate-extension-pdf', data),
        getExtensionEnabled:    () => ipcRenderer.invoke('get-extension-enabled'),
        setExtensionEnabled:    (v) => ipcRenderer.invoke('set-extension-enabled', v),
        openChromeExtensions:   () => ipcRenderer.invoke('open-chrome-extensions'),
        openExternalUrl:        (url) => ipcRenderer.invoke('open-external-url', url),

        // ============ SEGURIDAD / NAVEGADOR ============
        abrirNavegadorPJN: () => ipcRenderer.invoke('abrir-navegador-pjn'),
        agregarPasswordSCW: () => ipcRenderer.invoke('agregar-password-scw'),

        // ============ CONSOLA ============
        saveConsole: (text) => ipcRenderer.invoke('save-console', text),
        toggleBrowserVisibility: (show) => ipcRenderer.invoke('toggle-browser-visibility', show),

        // ============ ONBOARDING ============
        relaunchOnboarding: () => ipcRenderer.invoke('relaunch-onboarding'),
        onShowTour: (callback) => {
            ipcRenderer.on('show-tour', () => callback());
        },
        onSkipTour: (callback) => {
            ipcRenderer.on('skip-tour', () => callback());
        },

        // ============ REMOVER LISTENERS ============
        removeListener: (channel) => {
            ipcRenderer.removeAllListeners(channel);
        },

        copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

        safeStorageSet: (key, value) => ipcRenderer.invoke('safe-storage-set', key, value),
        safeStorageGet: (key) => ipcRenderer.invoke('safe-storage-get', key),
        safeStorageDelete: (key) => ipcRenderer.invoke('safe-storage-delete', key),

        // ============ PROMO STATUS ============
        getPromoStatus: () => ipcRenderer.invoke('get-promo-status')
    });

    console.log('✅ Preload.js: contextBridge configurado correctamente');

} catch (error) {
    console.error('❌ Error en Preload.js:', error);
}

// Verificación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
    console.log('✅ DOM cargado');
    console.log('✅ electronAPI expuesto:', typeof window.electronAPI !== 'undefined' ? 'SÍ' : 'NO');

    if (typeof window.electronAPI !== 'undefined') {
        console.log('✅ Métodos disponibles:', Object.keys(window.electronAPI));
    }
});