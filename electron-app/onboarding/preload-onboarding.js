const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('onboardingAPI', {
    getAppVersion:      () => ipcRenderer.invoke('get-app-version'),
    checkConnection:    () => ipcRenderer.invoke('onboarding-check-connection'),
    login:              (email, password) => ipcRenderer.invoke('onboarding-login', email, password),
    checkChrome:        () => ipcRenderer.invoke('onboarding-check-chrome'),
    checkProfile:       () => ipcRenderer.invoke('onboarding-check-profile'),
    setupProfile:       () => ipcRenderer.invoke('onboarding-setup-profile'),
    recreateProfile:    () => ipcRenderer.invoke('onboarding-recreate-profile'),
    abrirNavegadorPJN:  () => ipcRenderer.invoke('onboarding-abrir-pjn'),
    agregarPassword:    () => ipcRenderer.invoke('onboarding-agregar-password'),
    installExtension:      () => ipcRenderer.invoke('install-extension'),
    checkExtensionVersion: () => ipcRenderer.invoke('check-extension-version'),
    generateExtensionPdf:  (data) => ipcRenderer.invoke('generate-extension-pdf', data),
    getExtensionEnabled:   () => ipcRenderer.invoke('get-extension-enabled'),
    setExtensionEnabled:   (v) => ipcRenderer.invoke('set-extension-enabled', v),
    openChromeExtensions:  () => ipcRenderer.invoke('open-chrome-extensions'),
    safeStorageSet:     (key, value) => ipcRenderer.invoke('safe-storage-set', key, value),
    safeStorageGet:     (key) => ipcRenderer.invoke('safe-storage-get', key),
    safeStorageDelete:  (key) => ipcRenderer.invoke('safe-storage-delete', key),
    complete:           (opts) => ipcRenderer.invoke('onboarding-complete', opts),
    relaunch:           () => ipcRenderer.invoke('relaunch-onboarding'),
});
