const { app, BrowserWindow, Menu, ipcMain, clipboard, safeStorage } = require('electron');

// Ignorar EPIPE (broken pipe) al correr desde terminal — no es un error real
process.stdout.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const AuthManager = require('./src/auth/authManager');

let mainWindow;
let loginWindow;
let onboardingWindow = null;
let currentProcess = null;
let stopRequested  = false;  // flag para cortar loops batch
let authManager;
let executionLockTimer = null; // Heartbeat interval para lock multi-dispositivo
let shouldShowTour = false;   // true cuando el usuario completó el wizard con tour
let shouldSkipTour = false;   // true cuando el usuario eligió "Entrar a la app" (sin tour)

// ✅ DETECTAR SI ESTAMOS EN PRODUCCIÓN O DESARROLLO
const isDev = !app.isPackaged;
const appPath = isDev ? __dirname : path.join(process.resourcesPath, 'app.asar');

// ============ AUTO-UPDATER ============
// Solo activo en la app instalada (no en desarrollo con "npm start")
if (!isDev) {
    const log = require('electron-log');
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';

    autoUpdater.autoDownload = true;         // descarga en background automáticamente
    autoUpdater.autoInstallOnAppQuit = true; // instala al cerrar si ya descargó

    // Nueva versión detectada → empieza a descargar en background
    autoUpdater.on('update-available', (info) => {
        console.log(`🔄 Actualización disponible: v${info.version}`);
        mainWindow?.webContents.send('update-available', { version: info.version });
    });

    // Progreso de la descarga en background
    autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent);
        mainWindow?.webContents.send('update-progress', { percent });
    });

    // Descarga completa → avisar al usuario para que elija cuándo instalar
    autoUpdater.on('update-downloaded', (info) => {
        console.log(`✅ Actualización v${info.version} descargada. Lista para instalar.`);
        mainWindow?.webContents.send('update-downloaded', { version: info.version });
    });

    // Sin novedades
    autoUpdater.on('update-not-available', () => {
        console.log('✅ La app está actualizada.');
        mainWindow?.webContents.send('update-not-available');
    });

    // Error al verificar/descargar (no interrumpe el funcionamiento de la app)
    autoUpdater.on('error', (err) => {
        console.warn('⚠️ autoUpdater error (no crítico):', err.message);
    });
}

// URL del backend (cambiar según ambiente)
const BACKEND_URL = process.env.BACKEND_URL || 'https://api.procuradortool.com';

// ============ ONBOARDING — FIRST RUN ============
function getOnboardingFlagPath() {
    return path.join(app.getPath('userData'), 'onboarding_complete.json');
}
function isOnboardingComplete() {
    return fs.existsSync(getOnboardingFlagPath());
}

function createOnboardingWindow() {
    onboardingWindow = new BrowserWindow({
        width: 680,
        height: 580,
        resizable: false,
        center: true,
        frame: true,
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, 'onboarding', 'preload-onboarding.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        },
        icon: path.join(__dirname, 'build', 'icon.ico'),
        show: false,
        title: 'Configuración inicial — Procurador SCW'
    });

    onboardingWindow.loadFile(path.join(__dirname, 'onboarding', 'onboarding.html'));

    onboardingWindow.once('ready-to-show', () => {
        onboardingWindow.show();
    });

    if (isDev) {
        onboardingWindow.webContents.openDevTools();
    }

    onboardingWindow.on('closed', () => {
        onboardingWindow = null;
        if (!mainWindow && !loginWindow) {
            app.quit();
        }
    });
}

// ============ INICIALIZAR AUTH MANAGER ============
function initAuthManager() {
    authManager = new AuthManager(BACKEND_URL);
    console.log('🔐 AuthManager inicializado');
}

// ============ CREAR VENTANA DE LOGIN ============
function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 500,
        height: 700,
        resizable: false,
        movable: true,
        center: true,
        frame: false,
        backgroundColor: '#f7f7f5',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false  // false permite que el preload cargue correctamente desde asar.unpacked
        },
        show: false
    });

    loginWindow.loadFile('renderer/login.html');

    loginWindow.once('ready-to-show', () => {
        loginWindow.show();
    });

    console.log('isDev:', isDev, 'isPackaged:', app.isPackaged);
    if (isDev) {
        loginWindow.webContents.openDevTools();
    }

    loginWindow.on('closed', () => {
        loginWindow = null;
        if (!mainWindow) {
            app.quit();
        }
    });
}

// ============ CREAR VENTANA PRINCIPAL ============
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        minWidth: 800,
        minHeight: 400,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        },
        icon: path.join(__dirname, 'build', 'icon.ico'),
        backgroundColor: '#f7f7f5',
        show: false,
        center: true,
        resizable: true
    });

    // Cargar tu index.html actual (ahora en renderer/app.html)
    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.setSize(1200, 700);
        mainWindow.center();
        mainWindow.show();

        // Tour post-wizard
        if (shouldShowTour) {
            shouldShowTour = false;
            setTimeout(() => {
                mainWindow?.webContents.send('show-tour');
            }, 2000);
        } else if (shouldSkipTour) {
            shouldSkipTour = false;
            mainWindow?.webContents.send('skip-tour');
        }

        // Cerrar ventana de login si existe
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }

        // Verificar actualizaciones 5s después de mostrar la ventana principal
        // (delay para no interferir con la carga inicial)
        if (!isDev) {
            setTimeout(() => {
                autoUpdater.checkForUpdates().catch(err => {
                    console.warn('⚠️ No se pudo verificar actualizaciones:', err.message);
                });
            }, 5000);
        }
    });

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (currentProcess) {
            currentProcess.kill();
        }

        // Logout y limpiar caché al cerrar
        if (authManager) {
            authManager.logout();
        }
    });
}

// ============ APP READY ============
app.whenReady().then(() => {
    // Eliminar el menú nativo de Electron (File/Edit/View/Window/Help)
    // El menú propio se abre con el botón hamburger vía menu.popup()
    Menu.setApplicationMenu(null);

    initAuthManager();
    if (!isOnboardingComplete()) {
        createOnboardingWindow();
    } else {
        createLoginWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createLoginWindow();
    }
});

// Limpiar al cerrar la app
app.on('before-quit', () => {
    if (authManager) {
        authManager.logout();
    }
});

// ============ IPC HANDLERS - ONBOARDING ============

ipcMain.handle('onboarding-check-connection', async () => {
    try {
        const result = await authManager.backendClient.client.get('/health');
        return { success: result.status === 200 };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('onboarding-login', async (event, email, password) => {
    try {
        // Login without opening the main window (wizard handles window lifecycle)
        return await authManager.login(email, password);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('onboarding-check-chrome', () => {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const r of rutas) {
        if (fs.existsSync(r)) return { found: true, path: r };
    }
    return { found: false };
});

ipcMain.handle('onboarding-check-profile', () => {
    const profilePath = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');
    return { exists: fs.existsSync(profilePath), path: profilePath };
});

/**
 * Cierra todas las instancias de Chrome que estén usando el perfil ProcuradorSCW.
 * Necesario porque Puppeteer no puede controlar Chrome si ya hay una instancia
 * corriendo con el mismo --user-data-dir (Chrome abre ventana nueva en la instancia
 * existente en lugar de una nueva controlable por Puppeteer).
 */
async function closeChromeProfile() {
    const { execSync } = require('child_process');
    try {
        const result = execSync(
            "wmic process where \"name='chrome.exe' and commandline like '%ProcuradorSCW%'\" get processid",
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }
        );
        const pids = result.match(/\d+/g) || [];
        for (const pid of pids) {
            try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (_) {}
        }
        if (pids.length > 0) {
            await new Promise(r => setTimeout(r, 1500)); // esperar a que Chrome libere el perfil
        }
    } catch (_) {
        // Chrome con perfil ProcuradorSCW no está corriendo — normal
    }
}

function launchChromeWithProfile(profilePath) {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    let chromePath = null;
    for (const r of rutas) {
        if (fs.existsSync(r)) { chromePath = r; break; }
    }
    if (!chromePath) throw new Error('Chrome no encontrado');
    const { spawn } = require('child_process');
    spawn(chromePath, [
        `--user-data-dir=${profilePath}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        'http://scw.pjn.gov.ar'
    ], { detached: true, stdio: 'ignore' }).unref();
}

ipcMain.handle('onboarding-setup-profile', () => {
    const profilePath = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');
    try {
        fs.mkdirSync(profilePath, { recursive: true });
        launchChromeWithProfile(profilePath);
        return { success: true, profilePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('onboarding-recreate-profile', () => {
    const profilePath = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');
    try {
        if (fs.existsSync(profilePath)) {
            fs.rmSync(profilePath, { recursive: true, force: true });
        }
        fs.mkdirSync(profilePath, { recursive: true });
        launchChromeWithProfile(profilePath);
        return { success: true, profilePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('onboarding-abrir-pjn', async () => {
    try {
        await closeChromeProfile();
        const scriptPath = path.join(__dirname, 'src', 'scripts', 'abrirNavegadorPJN.js');
        if (!fs.existsSync(scriptPath)) return { success: false, error: 'Script no encontrado' };
        let cuit = '';
        try {
            const s = await authManager.verifySession();
            cuit = s?.user?.cuit || '';
        } catch (_) {}
        const { screen } = require('electron');
        const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
        fork(scriptPath, [cuit], {
            detached: true, stdio: 'ignore',
            env: { ...process.env, LOCALAPPDATA: process.env.LOCALAPPDATA,
                   SCREEN_WIDTH: String(sw), SCREEN_HEIGHT: String(sh) }
        }).unref();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('onboarding-agregar-password', async () => {
    try {
        await closeChromeProfile();
        const scriptPath = path.join(__dirname, 'src', 'scripts', 'agregarPasswordSCW.js');
        if (!fs.existsSync(scriptPath)) return { success: false, error: 'Script no encontrado' };
        let cuit = '';
        try {
            const s = await authManager.verifySession();
            cuit = s?.user?.cuit || '';
        } catch (_) {}
        const { screen } = require('electron');
        const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
        fork(scriptPath, [cuit], {
            detached: true, stdio: 'ignore',
            env: { ...process.env, LOCALAPPDATA: process.env.LOCALAPPDATA,
                   SCREEN_WIDTH: String(sw), SCREEN_HEIGHT: String(sh) }
        }).unref();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ============ IPC HANDLERS - EXTENSIÓN CHROME ============

const AdmZip       = require('adm-zip');
const crypto       = require('crypto');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const EXT_META_PATH = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'ProcuradorSCW', 'extension_meta.json');

/**
 * Descarga la extensión del backend si hay una versión nueva.
 * La extrae en %LOCALAPPDATA%\ProcuradorSCW\ext-vX-Y-Z (nombre fijo por versión).
 * Retorna { path, version, isNew }
 */
async function downloadExtension(token) {
    const extBaseDir = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'ProcuradorSCW');
    fs.mkdirSync(extBaseDir, { recursive: true });

    // 1. Versión del servidor
    const verRes = await authManager.backendClient.client.get('/api/extension/version', {
        headers: { Authorization: `Bearer ${token}` }
    });
    const serverVersion = verRes.data?.version;
    if (!serverVersion) throw new Error('No se pudo obtener la versión de la extensión');

    // 2. Comparar con versión local
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(EXT_META_PATH, 'utf8')); } catch (_) {}

    // Carpeta FIJA — Chrome siempre apunta al mismo path; las actualizaciones sobreescriben los archivos
    const extPath = path.join(extBaseDir, 'extension');

    if (meta.version === serverVersion && fs.existsSync(extPath)) {
        console.log(`[ext] Extensión v${serverVersion} ya actualizada en ${extPath}`);
        return { path: extPath, version: serverVersion, isNew: false };
    }

    // 3. Descargar ZIP
    console.log(`[ext] Descargando extensión v${serverVersion}…`);
    const dlRes = await authManager.backendClient.client.get('/api/extension/download', {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer'
    });
    const zipBuffer = Buffer.from(dlRes.data);

    // 4. Extraer en carpeta fija (sobreescribe archivos existentes)
    fs.mkdirSync(extPath, { recursive: true });
    new AdmZip(zipBuffer).extractAllTo(extPath, true);

    // 5. Guardar metadatos locales
    fs.writeFileSync(EXT_META_PATH, JSON.stringify({
        version: serverVersion,
        path: extPath,
        downloadedAt: new Date().toISOString()
    }));
    console.log(`[ext] Extensión v${serverVersion} extraída en ${extPath}`);
    return { path: extPath, version: serverVersion, isNew: true };
}

// Descargar extensión (onboarding y configuración)
ipcMain.handle('install-extension', async () => {
    try {
        const token = authManager.backendClient.token;
        if (!token) return { success: false, error: 'No hay sesión activa' };
        const result = await downloadExtension(token);
        return { success: true, ...result };
    } catch (err) {
        console.error('[ext] Error en install-extension:', err.message);
        return { success: false, error: err.message };
    }
});

// Comparar versión local vs servidor
ipcMain.handle('check-extension-version', async () => {
    try {
        let localVersion = null;
        let localPath    = null;
        try {
            const meta = JSON.parse(fs.readFileSync(EXT_META_PATH, 'utf8'));
            localVersion = meta.version || null;
            localPath    = meta.path    || null;
        } catch (_) {}

        const token = authManager.backendClient.token;
        if (!token) return { localVersion, localPath, serverVersion: null, needsUpdate: false };

        const verRes = await authManager.backendClient.client.get('/api/extension/version', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const serverVersion = verRes.data?.version || null;
        const needsUpdate   = !!serverVersion && serverVersion !== localVersion;
        return { localVersion, localPath, serverVersion, needsUpdate };
    } catch (err) {
        return { localVersion: null, localPath: null, serverVersion: null, needsUpdate: false, error: err.message };
    }
});

// Leer preferencia: extensión habilitada/deshabilitada
ipcMain.handle('get-extension-enabled', () => {
    try {
        const meta = JSON.parse(fs.readFileSync(EXT_META_PATH, 'utf8'));
        return meta.habilitada !== false; // default true si no existe
    } catch (_) {
        return true;
    }
});

// Guardar preferencia y actuar en consecuencia
ipcMain.handle('set-extension-enabled', async (_event, habilitada) => {
    try {
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(EXT_META_PATH, 'utf8')); } catch (_) {}

        if (!habilitada) {
            // Eliminar carpeta de extensión si existe
            const extBaseDir = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'ProcuradorSCW');
            try {
                const entries = fs.readdirSync(extBaseDir);
                for (const entry of entries) {
                    if (entry.startsWith('ext-')) {
                        const p = path.join(extBaseDir, entry);
                        if (fs.statSync(p).isDirectory()) {
                            fs.rmSync(p, { recursive: true, force: true });
                            console.log(`[ext] Carpeta eliminada por toggle off: ${p}`);
                        }
                    }
                }
            } catch (e) {
                console.warn('[ext] No se pudo eliminar carpeta al deshabilitar:', e.message);
            }
            meta.habilitada = false;
            meta.version    = null;
            meta.path       = null;
        } else {
            meta.habilitada = true;
        }

        fs.mkdirSync(path.dirname(EXT_META_PATH), { recursive: true });
        fs.writeFileSync(EXT_META_PATH, JSON.stringify(meta, null, 2));
        return { success: true };
    } catch (err) {
        console.error('[ext] Error en set-extension-enabled:', err.message);
        return { success: false, error: err.message };
    }
});

// Abrir Chrome del usuario (perfil personal) y copiar chrome://extensions al portapapeles
ipcMain.handle('open-chrome-extensions', () => {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    let chromePath = null;
    for (const r of rutas) {
        if (fs.existsSync(r)) { chromePath = r; break; }
    }
    if (!chromePath) return { success: false, error: 'Chrome no encontrado' };
    const { spawn, clipboard } = require('electron');
    const { spawn: spawnChild } = require('child_process');
    require('electron').clipboard.writeText('chrome://extensions');
    spawnChild(chromePath, [], { detached: true, stdio: 'ignore' }).unref();
    return { success: true };
});

// Generar PDF de instrucciones
ipcMain.handle('generate-extension-pdf', async (_event, { path: extPath, version }) => {
    try {
        const { shell, dialog } = require('electron');
        const pdfName = `instrucciones-extension-v${version || '1-0-0'}.pdf`;

        // Preguntar al usuario dónde guardar el PDF
        const { canceled, filePath: pdfPath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Guardar instrucciones de instalación',
            defaultPath: path.join(app.getPath('downloads'), pdfName),
            filters: [{ name: 'PDF', extensions: ['pdf'] }]
        });
        if (canceled || !pdfPath) return { success: false, canceled: true };

        // Crear PDF con pdf-lib
        const pdfDoc  = await PDFDocument.create();
        const page    = pdfDoc.addPage([595, 842]); // A4
        const { width, height } = page.getSize();
        const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontMono   = await pdfDoc.embedFont(StandardFonts.Courier);

        let y = height - 50;
        const margin = 50;
        const lineH  = 20;

        // Encabezado
        page.drawText('Procurador SCW', { x: margin, y, font: fontBold, size: 20, color: rgb(0.1, 0.3, 0.6) });
        y -= 30;
        page.drawText('Instrucciones de instalación — Extensión PJN para Chrome', {
            x: margin, y, font: fontBold, size: 13, color: rgb(0.15, 0.15, 0.15)
        });
        y -= 15;
        // Línea separadora
        page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
        y -= 20;

        // Info de versión y fecha
        const now = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        page.drawText(`Versión: ${version}   |   Descargado el: ${now}`, {
            x: margin, y, font: fontNormal, size: 10, color: rgb(0.4, 0.4, 0.4)
        });
        y -= 30;

        // Ruta de descarga — recuadro destacado
        page.drawText('Ruta de la extensión:', { x: margin, y, font: fontBold, size: 12, color: rgb(0.1, 0.3, 0.6) });
        y -= 18;
        page.drawRectangle({
            x: margin, y: y - 8, width: width - margin * 2, height: 24,
            color: rgb(0.94, 0.97, 1.0), borderColor: rgb(0.4, 0.6, 0.9), borderWidth: 1
        });
        page.drawText(extPath, { x: margin + 8, y: y, font: fontMono, size: 9, color: rgb(0.1, 0.1, 0.5) });
        y -= 35;

        // Instrucciones
        page.drawText('Pasos para instalar la extensión:', { x: margin, y, font: fontBold, size: 12, color: rgb(0.15, 0.15, 0.15) });
        y -= 25;

        const pasos = [
            ['1.', 'Abrí Google Chrome.'],
            ['2.', 'En la barra de direcciones escribí:  chrome://extensions  y presioná Enter.'],
            ['3.', 'Activá el "Modo desarrollador" (interruptor en la esquina superior derecha).'],
            ['4.', 'Hacé clic en el botón "Cargar extensión sin empaquetar".'],
            ['5.', 'En el cuadro de diálogo que se abre, en el campo "Nombre de carpeta", pegá'],
            ['',   'la ruta de arriba y presioná Aceptar.'],
            ['6.', 'La extensión "PJN – Automatización" aparecerá en la lista. ¡Listo!'],
        ];

        for (const [num, texto] of pasos) {
            if (num) {
                page.drawText(num, { x: margin, y, font: fontBold, size: 11, color: rgb(0.1, 0.3, 0.6) });
            }
            page.drawText(texto, { x: margin + (num ? 20 : 20), y, font: fontNormal, size: 11, color: rgb(0.15, 0.15, 0.15) });
            y -= lineH;
        }

        y -= 15;
        // Nota de actualización
        page.drawRectangle({
            x: margin, y: y - 10, width: width - margin * 2, height: 42,
            color: rgb(1.0, 0.98, 0.9), borderColor: rgb(0.9, 0.7, 0.2), borderWidth: 1
        });
        page.drawText('Nota:', { x: margin + 8, y: y + 12, font: fontBold, size: 10, color: rgb(0.5, 0.35, 0) });
        page.drawText('Si descargás una nueva versión, deberás repetir este proceso con la nueva ruta.', {
            x: margin + 8, y: y - 2, font: fontNormal, size: 10, color: rgb(0.3, 0.2, 0)
        });

        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(pdfPath, pdfBytes);
        await shell.openPath(pdfPath); // Abrir el PDF directamente
        return { success: true, pdfPath };
    } catch (err) {
        console.error('[ext] Error generando PDF:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('onboarding-complete', async (event, opts = {}) => {
    try {
        fs.writeFileSync(getOnboardingFlagPath(), JSON.stringify({
            completedAt: new Date().toISOString(),
            appVersion: app.getVersion(),
            tourShown: !opts.showTour
        }));
        shouldShowTour = !!opts.showTour;
        shouldSkipTour = !opts.showTour;
        if (opts.loggedIn) {
            createMainWindow();
        } else {
            createLoginWindow();
        }
        if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.close();
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('copy-to-clipboard', (_, text) => {
    clipboard.writeText(text);
});

ipcMain.handle('safe-storage-set', (_, key, value) => {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            return { success: false, error: 'safeStorage no disponible' };
        }
        const encrypted = safeStorage.encryptString(value);
        const userData = app.getPath('userData');
        fs.writeFileSync(path.join(userData, `${key}.enc`), encrypted);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('safe-storage-get', (_, key) => {
    try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        const userData = app.getPath('userData');
        const filePath = path.join(userData, `${key}.enc`);
        if (!fs.existsSync(filePath)) return null;
        const encrypted = fs.readFileSync(filePath);
        return safeStorage.decryptString(encrypted);
    } catch (e) {
        return null;
    }
});

ipcMain.handle('safe-storage-delete', (_, key) => {
    try {
        const userData = app.getPath('userData');
        const filePath = path.join(userData, `${key}.enc`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('relaunch-onboarding', () => {
    try {
        const flagPath = getOnboardingFlagPath();
        if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
        createOnboardingWindow();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ============ IPC HANDLERS - ACTUALIZACIONES ============

// El usuario eligió "Instalar ahora" en el banner
ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall(false, true); // false=no silent, true=forzar restart
});

// ============ IPC HANDLERS - AUTENTICACIÓN ============

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-machine-id', async () => {
    try {
        const { getMachineId } = require('./src/auth/machineId');
        return getMachineId();
    } catch (error) {
        console.error('Error obteniendo machine ID:', error);
        return null;
    }
});

ipcMain.handle('check-connection', async () => {
    try {
        // Intenta hacer ping al backend
        const result = await authManager.backendClient.client.get('/health');
        return { success: result.status === 200 };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

let lastPromoStatus = null;

ipcMain.handle('get-promo-status', () => lastPromoStatus);

ipcMain.handle('login', async (event, email, password) => {
    try {
        const result = await authManager.login(email, password);

        if (result.success) {
            lastPromoStatus = result.promoStatus || null;
            // Crear ventana principal
            createMainWindow();

            // Auto-update silencioso de la extensión (solo si está habilitada)
            try {
                const extMeta = JSON.parse(fs.readFileSync(EXT_META_PATH, 'utf8'));
                if (extMeta.habilitada === false) {
                    console.log('[ext] Auto-update omitido: extensión deshabilitada');
                } else {
                    const token = authManager.backendClient.token;
                    if (token) {
                        downloadExtension(token).then(r => {
                            if (r.isNew) console.log(`[ext] Auto-update: extensión actualizada a v${r.version}`);
                        }).catch(e => {
                            console.warn('[ext] Auto-update silencioso falló:', e.message);
                        });
                    }
                }
            } catch (_) {
                // Si no hay meta (primer uso), no hay nada que actualizar aún
            }
        }

        return result;
    } catch (error) {
        console.error('Error en login:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('show-confirm-dialog', async (_, title, message) => {
    const { dialog } = require('electron');
    const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Cancelar', 'Confirmar'],
        defaultId: 1,
        cancelId: 0,
        title,
        message
    });
    return response === 1;
});

ipcMain.handle('logout', async () => {
    try {
        const result = await authManager.logout();

        // Cerrar ventana principal y mostrar login
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close();
        }

        createLoginWindow();

        return result;
    } catch (error) {
        console.error('Error en logout:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('verify-session', async () => {
    try {
        return await authManager.verifySession();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-user-info', async () => {
    try {
        return {
            success: true,
            user: authManager.getUser(),
            stats: authManager.getStats()
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============ HELPER - MODO HEADLESS SIMULADO ============

/**
 * Lee el flag seguridad.modoHeadless del config y devuelve el objeto extraEnv
 * correspondiente para pasarlo a executeRemoteScriptAsLocal().
 * Solo aplica a los scripts de automatización (Procurar, Informe, Monitoreo).
 * Los botones de Seguridad (abrirNavegadorPJN, agregarPasswordSCW) NO usan esto.
 */
function leerExtraEnvHeadless() {
    try {
        const config = cargarConfiguracion();
        const activo = config?.seguridad?.modoHeadless === true;
        return activo ? { HEADLESS_MODE: 'true' } : {};
    } catch {
        return {};
    }
}

// ============ IPC HANDLERS - CONFIGURACIÓN (SIN CAMBIOS) ============

ipcMain.handle('load-config', async () => {
    try {
        const config = cargarConfiguracion();
        return { success: true, config };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-config', async (event, config) => {
    try {
        const configPath = getConfigPath();
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============ IPC HANDLERS - PROCESOS (MODIFICADO) ============

// ─── Contador persistente de ejecuciones ──────────────────────────────────────
function getRunStatsPath() {
    return path.join(app.getPath('userData'), 'procurador_run_stats.json');
}

function readRunStats() {
    const defaults = {
        procuracion: { total: 0, exitosos: 0 },
        batch:       { total: 0, exitosos: 0 },
        informes:    { total: 0, exitosos: 0 },
        monitoreo:   { total: 0, exitosos: 0 },
        ultimaEjecucion: null
    };
    try {
        const raw = fs.readFileSync(getRunStatsPath(), 'utf8');
        return Object.assign(defaults, JSON.parse(raw));
    } catch (_) {
        return defaults;
    }
}

function updateRunStats(tipo, exitoso) {
    try {
        const stats = readRunStats();
        if (stats[tipo]) {
            stats[tipo].total++;
            if (exitoso) stats[tipo].exitosos++;
        }
        stats.ultimaEjecucion = new Date().toISOString();
        fs.writeFileSync(getRunStatsPath(), JSON.stringify(stats, null, 2), 'utf8');
    } catch (e) {
        console.warn('⚠️ No se pudieron actualizar las estadísticas:', e.message);
    }
}

// ─── Helpers de lock multi-dispositivo ───────────────────────────────────────

async function acquireExecutionLock(scriptName) {
    const result = await authManager.backendClient.startExecution(scriptName);
    if (!result.success) return result;

    // Iniciar heartbeat cada 30 s para mantener el lock activo
    executionLockTimer = setInterval(async () => {
        try {
            await authManager.backendClient.executionHeartbeat();
        } catch (_) { /* no bloquear si falla un heartbeat puntual */ }
    }, 30000);

    return { success: true };
}

async function releaseExecutionLock() {
    if (executionLockTimer) {
        clearInterval(executionLockTimer);
        executionLockTimer = null;
    }
    try {
        await authManager.backendClient.endExecution();
    } catch (_) { /* best-effort */ }
}

// ─── Handler run-process ─────────────────────────────────────────────────────

// Handler: run-process
ipcMain.handle('run-process', async (event, options = {}) => {
    if (currentProcess) {
        return { success: false, error: 'Ya hay un proceso en ejecución' };
    }

    try {
        if (!authManager.isAuthenticated()) {
            return { success: false, error: 'No autenticado' };
        }

        // Verificar límite de ejecuciones antes de iniciar
        const sessionInfo = await authManager.verifySession();
        const sub = sessionInfo.subscription;
        if (sub?.planType === 'extension') {
            return {
                success: false,
                error: `Tu plan (${sub.plan}) solo incluye la extensión Chrome y no permite ejecuciones en la aplicación de escritorio. Por favor, actualizá tu suscripción.`,
                action: 'upgrade'
            };
        }
        if (sessionInfo.success && sub?.remaining !== null && sub?.remaining <= 0) {
            return {
                success: false,
                error: `Has alcanzado el límite de ejecuciones de tu plan (${sub.plan}). Actualiza tu suscripción para continuar.`,
                action: 'upgrade'
            };
        }

        // Verificar CUIT registrado en BD
        const cuit = sessionInfo?.user?.cuit;
        if (!cuit) {
            return {
                success: false,
                error: 'No tenés un CUIT registrado en el sistema. Contactá al administrador.',
                action: 'contact_support'
            };
        }

        const scriptName = 'procesarNovedadesCompleto.js';
        mainWindow.webContents.send('batch-progress', { indeterminate: true, label: 'Procurando expedientes...' });

        // Adquirir lock multi-dispositivo
        const lockResult = await acquireExecutionLock(scriptName);
        if (!lockResult.success) {
            mainWindow.webContents.send('batch-progress', { done: true });
            return {
                success: false,
                error: lockResult.error,
                code:  lockResult.code
            };
        }

        console.log('🚀 Ejecutando proceso automático...');
        let result;
        try {
            result = await authManager.executeRemoteScriptAsLocal(scriptName, [], { cuitOverride: cuit, extraEnv: leerExtraEnvHeadless() });
        } finally {
            await releaseExecutionLock();
        }
        mainWindow.webContents.send('batch-progress', { done: true });

        updateRunStats('procuracion', result.success);
        mainWindow.webContents.send('process-finished', {
            code: result.success ? 0 : 1,
            success: result.success
        });

        return result;

    } catch (error) {
        const stopped = isSigtermError(error);
        console.error('Error ejecutando proceso:', error);
        await releaseExecutionLock();
        mainWindow.webContents.send('batch-progress', { done: true, stopped });
        if (!stopped) updateRunStats('procuracion', false);
        mainWindow.webContents.send('process-finished', { code: 1, success: false, stopped });
        return { success: false, error: error.message || error.error };
    }
});

// Handler: run-process-custom-date
ipcMain.handle('run-process-custom-date', async (event, fecha) => {
    if (currentProcess) {
        return { success: false, error: 'Ya hay un proceso en ejecución' };
    }

    try {
        if (!authManager.isAuthenticated()) {
            return { success: false, error: 'No autenticado' };
        }

        // Verificar límite de ejecuciones antes de iniciar
        const sessionInfo = await authManager.verifySession();
        const sub = sessionInfo.subscription;
        if (sub?.planType === 'extension') {
            return {
                success: false,
                error: `Tu plan (${sub.plan}) solo incluye la extensión Chrome y no permite ejecuciones en la aplicación de escritorio. Por favor, actualizá tu suscripción.`,
                action: 'upgrade'
            };
        }
        if (sessionInfo.success && sub?.remaining !== null && sub?.remaining <= 0) {
            return {
                success: false,
                error: `Has alcanzado el límite de ejecuciones de tu plan (${sub.plan}). Actualiza tu suscripción para continuar.`,
                action: 'upgrade'
            };
        }

        // Verificar CUIT registrado en BD
        const cuit = sessionInfo?.user?.cuit;
        if (!cuit) {
            return {
                success: false,
                error: 'No tenés un CUIT registrado en el sistema. Contactá al administrador.',
                action: 'contact_support'
            };
        }

        // Modificar config temporalmente
        const configPath = getConfigPath();
        const backupPath = configPath + '.backup';

        const originalConfig = fs.readFileSync(configPath, 'utf8');
        fs.writeFileSync(backupPath, originalConfig);

        const config = JSON.parse(originalConfig);
        config.general.fechaLimite = fecha;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        const scriptName = 'procesarNovedadesCompleto.js';
        mainWindow.webContents.send('batch-progress', { indeterminate: true, label: 'Procurando expedientes (fecha personalizada)...' });

        // Adquirir lock multi-dispositivo
        const lockResult = await acquireExecutionLock(scriptName);
        if (!lockResult.success) {
            mainWindow.webContents.send('batch-progress', { done: true });
            fs.writeFileSync(configPath, originalConfig);
            return { success: false, error: lockResult.error, code: lockResult.code };
        }
        let result;
        try {
            result = await authManager.executeRemoteScriptAsLocal(scriptName, [], { cuitOverride: cuit, extraEnv: leerExtraEnvHeadless() });
        } finally {
            await releaseExecutionLock();
            fs.writeFileSync(configPath, originalConfig);
            if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        }

        mainWindow.webContents.send('batch-progress', { done: true });
        updateRunStats('procuracion', result.success);
        mainWindow.webContents.send('process-finished', { code: result.success ? 0 : 1, success: result.success });
        return result;

    } catch (error) {
        const stopped = isSigtermError(error);
        console.error('Error:', error);
        await releaseExecutionLock();
        mainWindow.webContents.send('batch-progress', { done: true, stopped });
        if (!stopped) updateRunStats('procuracion', false);
        mainWindow.webContents.send('process-finished', { code: 1, success: false, stopped });
        return { success: false, error: error.message || error.error };
    }
});

// ── PROCURAR CUSTOM ──────────────────────────────────────────────────────────
// Ejecuta un script de "consulta pública directa" pasándole la lista de
// expedientes vía config_proceso_custom.json (extraFiles), sin recorrer
// las listas de relacionados del proceso normal.
// TODO: reemplazar 'procesarCustomExpedientes.js' con el nombre real del script
//       cuando esté disponible en el backend.
ipcMain.handle('run-process-custom', async (event, { lines, fechaLimite }) => {
    if (authManager.activeChild) {
        return { success: false, error: 'Ya hay un proceso en ejecución' };
    }

    try {
        if (!authManager.isAuthenticated()) {
            return { success: false, error: 'No autenticado' };
        }

        const sessionInfo = await authManager.verifySession();
        const sub = sessionInfo.subscription;
        if (sub?.planType === 'extension') {
            return {
                success: false,
                error: `Tu plan (${sub.plan}) solo incluye la extensión Chrome y no permite ejecuciones en la aplicación de escritorio. Por favor, actualizá tu suscripción.`,
                action: 'upgrade'
            };
        }
        if (sessionInfo.success && sub?.remaining !== null && sub?.remaining <= 0) {
            return {
                success: false,
                error: `Has alcanzado el límite de ejecuciones de tu plan (${sub.plan}). Actualiza tu suscripción para continuar.`,
                action: 'upgrade'
            };
        }

        const cuit = sessionInfo?.user?.cuit;
        if (!cuit) {
            return {
                success: false,
                error: 'No tenés un CUIT registrado en el sistema. Contactá al administrador.',
                action: 'contact_support'
            };
        }

        const configCustom = JSON.stringify({ expedientes: lines, fechaLimite: fechaLimite || null });
        const scriptName = 'procesarCustomExpedientes.js';

        mainWindow.webContents.send('batch-progress', { indeterminate: true, label: `Procurando ${lines.length} expediente${lines.length !== 1 ? 's' : ''} custom...` });

        const lockResult = await acquireExecutionLock(scriptName);
        if (!lockResult.success) {
            mainWindow.webContents.send('batch-progress', { done: true });
            return { success: false, error: lockResult.error, code: lockResult.code };
        }
        let result;
        try {
            result = await authManager.executeRemoteScriptAsLocal(
                scriptName, [],
                { cuitOverride: cuit, extraFiles: { 'config_proceso_custom.json': configCustom }, extraEnv: leerExtraEnvHeadless() }
            );
        } finally {
            await releaseExecutionLock();
        }

        mainWindow.webContents.send('batch-progress', { done: true });
        updateRunStats('batch', result.success);
        mainWindow.webContents.send('process-finished', { code: result.success ? 0 : 1, success: result.success, isInformeBatch: false });
        return result;

    } catch (error) {
        const stopped = isSigtermError(error);
        console.error('Error en run-process-custom:', error);
        await releaseExecutionLock();
        mainWindow.webContents.send('batch-progress', { done: true, stopped });
        if (!stopped) updateRunStats('batch', false);
        mainWindow.webContents.send('process-finished', { code: 1, success: false, isInformeBatch: false, stopped });
        return { success: false, error: error.message || error.error };
    }
});

function isSigtermError(error) {
    const msg = (error?.message || error?.error || String(error) || '').toLowerCase();
    return msg.includes('killed') || msg.includes('sigterm') || msg.includes('terminado') || msg.includes('signal');
}

ipcMain.handle('stop-process', async () => {
    // El proceso hijo vive dentro de authManager.executeRemoteScriptAsLocal.
    // currentProcess (variable local) nunca se asigna; usamos authManager.activeChild.
    if (!authManager || !authManager.activeChild) {
        return { success: false, error: 'No hay ningún proceso en ejecución' };
    }

    try {
        stopRequested = true;
        const stopped = authManager.stopCurrentProcess();
        await releaseExecutionLock();
        return { success: stopped };
    } catch (error) {
        await releaseExecutionLock();
        return { success: false, error: error.message };
    }
});

// Handler: list-expedientes
ipcMain.handle('list-expedientes', async (event, fechaLimite) => {
    if (currentProcess) {
        return { success: false, error: 'Ya hay un proceso en ejecución' };
    }

    try {
        if (!authManager.isAuthenticated()) {
            return { success: false, error: 'No autenticado' };
        }

        const scriptName = 'listarSCWPJN.js';
        const result = await authManager.executeRemoteScriptAsLocal(scriptName, [fechaLimite]);

        mainWindow.webContents.send('process-finished', {
            code: result.success ? 0 : 1,
            success: result.success
        });

        return result;

    } catch (error) {
        console.error('Error:', error);
        mainWindow.webContents.send('process-finished', {
            code: 1,
            success: false
        });
        return { success: false, error: error.message || error.error };
    }
});


// ============ IPC HANDLERS - ARCHIVOS Y OTROS (SIN CAMBIOS) ============

ipcMain.handle('open-file', async (event, filePath) => {
    try {
        const { shell } = require('electron');

        if (!fs.existsSync(filePath)) {
            return { success: false, error: 'Archivo no encontrado' };
        }

        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-downloads-folder', async () => {
    try {
        const { shell } = require('electron');
        const descargasPath = path.join(app.getPath('userData'), 'descargas');

        if (!fs.existsSync(descargasPath)) {
            fs.mkdirSync(descargasPath, { recursive: true });
        }

        await shell.openPath(descargasPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clean-folder', async (event, folderType) => {
    try {
        const fs = require('fs-extra');
        let targetPath;

        switch (folderType) {
            case 'temp':
                targetPath = path.join(app.getPath('userData'), 'descargas');

                if (!fs.existsSync(targetPath)) {
                    return { success: false, error: 'Carpeta de descargas no existe' };
                }

                const files = fs.readdirSync(targetPath);
                for (const file of files) {
                    if (file.includes('_temp')) {
                        fs.removeSync(path.join(targetPath, file));
                    }
                }
                break;

            case 'procesos':
                targetPath = path.join(app.getPath('userData'), 'descargas', 'procesos_automaticos');

                if (!fs.existsSync(targetPath)) {
                    return { success: false, error: 'Carpeta de procesos no existe' };
                }

                fs.removeSync(targetPath);
                break;

            case 'all':
                targetPath = path.join(app.getPath('userData'), 'descargas');

                if (!fs.existsSync(targetPath)) {
                    return { success: false, error: 'Carpeta de descargas no existe' };
                }

                fs.emptyDirSync(targetPath);
                break;

            default:
                return { success: false, error: 'Tipo de limpieza inválido' };
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-stats', async () => {
    try {
        // Datos locales: solo para última ejecución y tasa de éxito (el JSON rastrea fallos, la DB no)
        const data = readRunStats();
        const batchData = data.batch || { total: 0, exitosos: 0 };
        const totalExitososLocal    = data.procuracion.exitosos + batchData.exitosos + data.informes.exitosos + data.monitoreo.exitosos;
        const totalEjecucionesLocal = data.procuracion.total    + batchData.total    + data.informes.total    + data.monitoreo.total;
        const tasaExito = totalEjecucionesLocal > 0
            ? (totalExitososLocal / totalEjecucionesLocal * 100).toFixed(0)
            : 100;

        // Datos de cuenta desde la DB (fuente de verdad para conteos sincronizados)
        let procuracionDB = null, informesDB = null, monitoreoDBNov = null, monitoreoDBPartes = null;
        try {
            const accountResult = await authManager.backendClient.getAccount();
            if (accountResult.success && accountResult.account?.usage) {
                const u = accountResult.account.usage;
                procuracionDB   = (u.proc?.used   ?? 0) + (u.batch?.used ?? 0);
                informesDB      =  u.informe?.used ?? 0;
                monitoreoDBNov    =  u.monitor_novedades?.used ?? 0;
                monitoreoDBPartes =  u.monitor_partes?.used    ?? 0;
            }
        } catch (_) { /* sin conexión: fallback a local */ }

        // Si la DB respondió, usar esos valores; si no, usar el JSON local como fallback
        const procuracion = procuracionDB !== null
            ? procuracionDB
            : (data.procuracion.total + batchData.total);
        const informes = informesDB !== null
            ? informesDB
            : data.informes.total;
        const monitoreo = (monitoreoDBNov !== null && monitoreoDBPartes !== null)
            ? (monitoreoDBNov + monitoreoDBPartes)
            : data.monitoreo.total;

        return {
            success: true,
            stats: {
                procuracion,
                informes,
                monitoreo,
                ultimoProcesoTimestamp: data.ultimaEjecucion ? new Date(data.ultimaEjecucion).getTime() : null,
                tasaExito
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============ WINDOW CONTROLS (frame: false) ============
// Actúan sobre la ventana que envía el IPC (funciona para login y main)
ipcMain.handle('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.handle('window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('show-app-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const template = [
        {
            label: 'Archivo',
            submenu: [
                { label: 'Nueva procuración',  click: () => win?.webContents.send('menu-action', 'run-process') },
                { type: 'separator' },
                { label: 'Abrir descargas',    click: () => win?.webContents.send('menu-action', 'open-downloads') },
                { label: 'Exportar consola',   click: () => win?.webContents.send('menu-action', 'download-console') },
                { type: 'separator' },
                { label: 'Salir',              role: 'quit' }
            ]
        },
        {
            label: 'Editar',
            submenu: [
                { role: 'copy',      label: 'Copiar' },
                { role: 'selectAll', label: 'Seleccionar todo' },
                { type: 'separator' },
                { label: 'Limpiar consola', click: () => win?.webContents.send('menu-action', 'clear-console') }
            ]
        },
        {
            label: 'Ver',
            submenu: [
                { role: 'reload',         label: 'Recargar' },
                { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
                { type: 'separator' },
                { role: 'resetZoom',   label: 'Zoom normal' },
                { role: 'zoomIn',      label: 'Acercar' },
                { role: 'zoomOut',     label: 'Alejar' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Pantalla completa' }
            ]
        },
        {
            label: 'Ventana',
            submenu: [
                { label: 'Minimizar',           click: () => mainWindow?.minimize() },
                { label: 'Maximizar/Restaurar', click: () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize() },
                { type: 'separator' },
                { label: 'Posicionar a la derecha', click: () => win?.webContents.send('menu-action', 'position-left') }
            ]
        },
        {
            label: 'Ayuda',
            submenu: [
                { label: 'Mi cuenta / Soporte', click: () => win?.webContents.send('menu-action', 'open-support') },
                { label: 'Estadísticas',        click: () => win?.webContents.send('menu-action', 'open-stats') },
                { type: 'separator' },
                { label: 'Acerca de Procurador SCW', role: 'about' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
});

ipcMain.handle('resize-window', async (event, width, height) => {
    try {
        if (mainWindow) {
            mainWindow.setSize(width, height);
            mainWindow.center();
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('restore-window', async () => {
    try {
        if (mainWindow) {
            mainWindow.setSize(1200, 700);
            mainWindow.center();
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('position-left', async () => {
    try {
        if (mainWindow) {
            const { screen } = require('electron');
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

            const halfWidth = Math.floor(screenWidth / 2);

            mainWindow.setSize(halfWidth, screenHeight);
            mainWindow.setPosition(halfWidth, 0);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-visor-path', async () => {
    try {
        const visorPath = path.join(app.getPath('userData'), 'descargas', 'visor_generado.html');

        if (!fs.existsSync(visorPath)) {
            return { success: false, error: 'No se encontró el archivo visor_generado.html' };
        }

        return { success: true, path: visorPath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-latest-excel', async () => {
    try {
        const procesosPath = path.join(app.getPath('userData'), 'descargas', 'procesos_automaticos');

        if (!fs.existsSync(procesosPath)) {
            return { success: false, error: 'No se encontró la carpeta de procesos' };
        }

        const files = fs.readdirSync(procesosPath);
        const excelFiles = files.filter(f => f.endsWith('.xlsx')).sort().reverse();

        if (excelFiles.length === 0) {
            return { success: false, error: 'No se encontraron archivos Excel' };
        }

        const latestExcel = path.join(procesosPath, excelFiles[0]);
        return {
            success: true,
            path: latestExcel,
            filename: excelFiles[0]
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Agregar handler para configurar notificaciones:

ipcMain.handle('configure-notifications', async (event, settings) => {
    try {
        authManager.notificationManager.configure(settings);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-notifications', async () => {
    try {
        const newState = authManager.notificationManager.toggle();
        return { success: true, enabled: newState };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============ INFORME ============

const JURISDICCION_MAP = {
    CSJ: '0', CIV: '1', CAF: '2', CCF: '3', CNE: '4',
    CSS: '5', CPE: '6', CNT: '7', CFP: '8', CCC: '9',
    COM: '10', CPF: '11', CPN: '12', FBB: '13', FCR: '14',
    FCB: '15', FCT: '16', FGR: '17', FLP: '18', FMP: '19',
    FMZ: '20', FPO: '21', FPA: '22', FRE: '23', FSA: '24',
    FRO: '25', FSM: '26', FTU: '27'
};

function parseExpedienteStr(str) {
    const match = str.trim().match(/^(\w+)\s+(\d+)\/(\d{4})$/);
    if (!match) return null;
    const jurSigla = match[1].toUpperCase();
    const jurCodigo = JURISDICCION_MAP[jurSigla];
    if (!jurCodigo) return null;
    return { jurisdiccion: jurCodigo, numero: match[2], anio: match[3], expediente: str.trim() };
}

ipcMain.handle('select-batch-file', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Seleccionar archivo de expedientes',
        filters: [{ name: 'Texto (.txt)', extensions: ['txt'] }],
        properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
    }
    try {
        const content = fs.readFileSync(result.filePaths[0], 'utf8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        return { success: true, path: result.filePaths[0], lines };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('run-informe', async (event, { expediente, batchLines, configInforme }) => {
    if (authManager.activeChild) {
        return { success: false, error: 'Ya hay un proceso en ejecución' };
    }
    // Declarar antes del try para que el catch también pueda usarla
    const isBatch = !!(batchLines && Array.isArray(batchLines) && batchLines.length > 0);
    try {
        if (!authManager.isAuthenticated()) {
            return { success: false, error: 'No autenticado' };
        }
        const sessionInfo = await authManager.verifySession();
        const cuit = sessionInfo?.user?.cuit;
        if (!cuit) {
            return { success: false, error: 'No tenés un CUIT registrado en el sistema.' };
        }

        // ── MODO INDIVIDUAL ──────────────────────────────────────────
        if (!isBatch) {
            if (!expediente) {
                return { success: false, error: 'Debe indicar un expediente o archivo batch.' };
            }
            mainWindow.webContents.send('batch-progress', { indeterminate: true, label: `Generando informe: ${expediente}` });
            const result = await authManager.executeRemoteScriptAsLocal(
                'informequickscwpjn.js',
                [expediente, cuit],
                { extraFiles: { 'config_informe.json': configInforme }, extraEnv: leerExtraEnvHeadless() }
            );

            // Abrir el PDF generado automáticamente
            if (result.success && result.output) {
                const pdfLine = result.output.split('\n').find(l =>
                    l.includes('Archivo PDF generado en:') || l.includes('PDF generado exitosamente:')
                );
                if (pdfLine) {
                    const pdfPath = pdfLine.split(/Archivo PDF generado en:|PDF generado exitosamente:/)[1]?.trim();
                    if (pdfPath && fs.existsSync(pdfPath)) {
                        const { shell } = require('electron');
                        await shell.openPath(pdfPath);
                        mainWindow.webContents.send('process-log', { type: 'info', text: `📄 PDF abierto: ${pdfPath}` });
                    }
                }
            }

            mainWindow.webContents.send('batch-progress', { done: true });
            updateRunStats('informes', result.success);
            mainWindow.webContents.send('process-finished', { code: result.success ? 0 : 1, success: result.success, isInformeBatch: false, isInforme: true });
            return result;
        }

        // ── MODO BATCH: una llamada por expediente (igual que el orquestador) ──
        const validLines = batchLines.map(parseExpedienteStr).filter(Boolean);
        const invalidCount = batchLines.length - validLines.length;

        // Log diagnóstico: cuántas líneas se pudieron parsear
        mainWindow.webContents.send('process-log', {
            type: 'info',
            text: `📋 Batch: ${batchLines.length} líneas en el archivo, ${validLines.length} expedientes válidos${invalidCount > 0 ? ` (${invalidCount} omitidas por formato inválido)` : ''}`
        });

        if (validLines.length === 0) {
            return { success: false, error: 'Ningún expediente válido en el archivo. Formato esperado: "JUR NUMERO/ANIO" (ej: FCR 018745/2017)' };
        }

        const batchResults = [];
        let abortado = false;
        const batchStartTime = Date.now();
        stopRequested = false;  // resetear flag al inicio del batch

        // Mostrar barra indeterminada al inicio mientras procesa el primer ítem
        mainWindow.webContents.send('batch-progress', { indeterminate: true, label: `Iniciando batch (${validLines.length} expedientes)...` });

        for (let i = 0; i < validLines.length; i++) {
            const expStr = validLines[i].expediente;

            // Actualizar progreso al INICIO de cada ítem (muestra qué ítem se está procesando)
            mainWindow.webContents.send('batch-progress', { current: i + 1, total: validLines.length, startTime: batchStartTime });

            mainWindow.webContents.send('process-log', {
                type: 'info',
                text: `📄 [${i + 1}/${validLines.length}] Procesando: ${expStr}`
            });

            let expSuccess = false;
            try {
                const expResult = await authManager.executeRemoteScriptAsLocal(
                    'informequickscwpjn.js',
                    [expStr, cuit],
                    { extraFiles: { 'config_informe.json': configInforme }, extraEnv: leerExtraEnvHeadless() }
                );
                expSuccess = expResult.success;
                mainWindow.webContents.send('process-log', {
                    type: expSuccess ? 'success' : 'error',
                    text: `  ${expSuccess ? '✅' : '❌'} [${i + 1}/${validLines.length}] ${expStr}: ${expSuccess ? 'OK' : 'falló (exit code ≠ 0)'}`
                });
            } catch (err) {
                const errMsg = err?.error || err?.message || String(err) || '';
                console.error(`❌ Batch error en [${i + 1}] ${expStr}:`, errMsg);

                if (isSigtermError(err) || stopRequested) {
                    mainWindow.webContents.send('process-log', {
                        type: 'warning',
                        text: `⚠️ Proceso detenido manualmente en: ${expStr}`
                    });
                    mainWindow.webContents.send('batch-progress', { done: true, stopped: true });
                    batchResults.push({ expediente: expStr, ok: false, exitCode: -1 });
                    abortado = true;
                    break;
                }
                mainWindow.webContents.send('process-log', {
                    type: 'error',
                    text: `  ❌ [${i + 1}/${validLines.length}] ${expStr}: ${errMsg || 'error desconocido'}`
                });
                expSuccess = false;
            }

            // Verificar si se solicitó detener entre ítems (cuando executeRemoteScriptAsLocal no lanza)
            if (stopRequested) {
                mainWindow.webContents.send('process-log', { type: 'warning', text: `⚠️ Batch detenido manualmente después de: ${expStr}` });
                mainWindow.webContents.send('batch-progress', { done: true, stopped: true });
                abortado = true;
                break;
            }

            if (!abortado) {
                batchResults.push({ expediente: expStr, ok: expSuccess, exitCode: expSuccess ? 0 : 1 });
                // Pausa entre expedientes (excepto el último) para que Chrome libere el perfil
                if (i < validLines.length - 1) {
                    mainWindow.webContents.send('process-log', {
                        type: 'info',
                        text: `  ⏳ Aguardando 5s antes del siguiente expediente...`
                    });
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }

        // ── POST-BATCH: generar Excel y Visor HTML ────────────────────
        if (batchResults.length > 0) {
            try {
                // __dirname apunta al root del asar en packaged, y a electron-app/ en dev
                const informeDir = path.join(__dirname, 'informe');
                const descargasPath = path.join(app.getPath('userData'), 'descargas');

                if (!fs.existsSync(descargasPath)) {
                    fs.mkdirSync(descargasPath, { recursive: true });
                }

                const timestamp = Date.now();
                const resumenPath = path.join(descargasPath, `resumen_orquestador_${timestamp}.json`);
                fs.writeFileSync(resumenPath, JSON.stringify(batchResults, null, 2), 'utf8');

                const configProceso = { rutas: { descargas: descargasPath } };

                mainWindow.webContents.send('process-log', { type: 'info', text: '📊 Generando reporte Excel...' });
                const { generarExcelBatch } = require(path.join(informeDir, 'generador_excel.js'));
                const rutaExcel = await generarExcelBatch(resumenPath, configProceso);

                mainWindow.webContents.send('process-log', { type: 'info', text: '🌐 Generando visor HTML...' });
                const { generarVisorHTML } = require(path.join(informeDir, 'generador_visor.js'));
                const rutaHTML = await generarVisorHTML(resumenPath, configProceso, rutaExcel);

                const exitosos = batchResults.filter(r => r.ok).length;
                mainWindow.webContents.send('informe-batch-complete', {
                    rutaExcel,
                    rutaHTML,
                    total: batchResults.length,
                    exitosos
                });
            } catch (genError) {
                console.error('❌ Error generando reportes batch:', genError.message);
                mainWindow.webContents.send('process-log', {
                    type: 'error',
                    text: `❌ Error al generar reportes: ${genError.message}`
                });
            }
        }

        const overallSuccess = batchResults.some(r => r.ok);
        updateRunStats('informes', overallSuccess);
        mainWindow.webContents.send('batch-progress', { done: true });
        mainWindow.webContents.send('process-finished', { code: overallSuccess ? 0 : 1, success: overallSuccess, isInformeBatch: true, isInforme: true });
        return { success: overallSuccess };

    } catch (error) {
        const stopped = isSigtermError(error);
        mainWindow.webContents.send('batch-progress', { done: true, stopped });
        if (!stopped) updateRunStats('informes', false);
        mainWindow.webContents.send('process-finished', { code: 1, success: false, isInformeBatch: isBatch, isInforme: true, stopped });
        return { success: false, error: error.message || error.error };
    }
});

// ============ CUENTA Y TICKETS ============

ipcMain.handle('get-account', async () => {
    try {
        return await authManager.backendClient.getAccount();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-batch-limits', async () => {
    try {
        return await authManager.backendClient.getBatchLimits();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-tickets', async () => {
    try {
        return await authManager.backendClient.getTickets();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-ticket-detail', async (event, id) => {
    try {
        return await authManager.backendClient.getTicketDetail(id);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('create-ticket', async (event, category, title, description) => {
    try {
        return await authManager.backendClient.createTicket(category, title, description);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('add-ticket-comment', async (event, id, message) => {
    try {
        return await authManager.backendClient.addTicketComment(id, message);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============ MONITOR DE PARTES ============

// ─── Generador de visor HTML para resultados del monitor ──────────────────────
function generarVisorMonitoreo(modo, resultados) {
    const ahora  = new Date();
    const fecha  = ahora.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
                 + ' ' + ahora.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    const titulo = modo === 'inicial' ? 'Monitor — Consulta Inicial' : 'Monitor — Novedades';

    const totalExps = resultados.reduce((sum, r) => sum + (r.expedientes || []).length, 0);
    const okCount   = resultados.filter(r => r.ok).length;

    const statsHTML = `
    <div class="stats-container">
        <div class="stat-card"><div class="label">Partes procesadas</div><div class="value">${resultados.length}</div></div>
        <div class="stat-card success"><div class="label">Exitosas</div><div class="value">${okCount}</div></div>
        <div class="stat-card"><div class="label">${modo === 'inicial' ? 'Expedientes en base' : 'Novedades detectadas'}</div><div class="value">${totalExps}</div></div>
    </div>`;

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    const seccionesHTML = resultados.map((r, idx) => {
        const exps  = r.expedientes || [];
        const emptyMsg = r.error
            ? 'Error: ' + esc(r.error)
            : (modo === 'novedades' ? 'Sin novedades para esta parte' : 'Sin expedientes encontrados');

        const filas = exps.length === 0
            ? `<tr><td colspan="5" class="empty-row">${emptyMsg}</td></tr>`
            : exps.map(e => `
                <tr>
                    <td class="exp-num">${esc(e.numero_expediente)}</td>
                    <td>${esc(e.dependencia)}</td>
                    <td class="caratula" title="${esc(e.caratula)}">${esc(e.caratula)}</td>
                    <td><span class="situacion-badge">${esc(e.situacion)}</span></td>
                    <td class="fecha-col">${esc(e.ultima_actuacion)}</td>
                </tr>`).join('');

        const estadoBadge = !r.ok
            ? `<span class="status-badge status-err">Error</span>`
            : modo === 'novedades' && exps.length > 0
                ? `<span class="status-badge status-nueva">🆕 ${exps.length} novedad(es)</span>`
                : modo === 'novedades'
                    ? `<span class="status-badge status-ok">✅ Sin novedades</span>`
                    : `<span class="status-badge status-ok">${exps.length} expediente(s)</span>`;

        return `
        <div class="expediente-card">
            <div class="card-header" onclick="toggleCard(${idx})" data-idx="${idx}">
                <span class="toggle-arrow" id="arrow-${idx}">▶</span>
                <span class="jurisdiccion-tag">${esc(r.jurisdiccion_sigla)}</span>
                <span class="nombre-parte">${esc(r.nombre_parte)}</span>
                ${estadoBadge}
            </div>
            <div class="table-container" id="tabla-${idx}" style="display:none;">
                <table>
                    <thead>
                        <tr>
                            <th>Expediente</th>
                            <th>Dependencia</th>
                            <th>Car&aacute;tula</th>
                            <th>Situaci&oacute;n</th>
                            <th>&Uacute;lt. actuaci&oacute;n</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titulo}</title>
<style>
    *  { margin:0; padding:0; box-sizing:border-box; }
    :root {
        --primary: #2196F3; --success: #4CAF50; --error: #F44336;
        --background: #f5f5f5; --card-bg: #ffffff;
        --text-primary: #212121; --text-secondary: #757575; --border: #e0e0e0;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: var(--background); color: var(--text-primary); line-height: 1.6; padding: 20px; }
    .header { background: var(--card-bg); padding: 24px 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.1); margin-bottom: 24px; }
    .header h1 { color: var(--primary); font-size: 24px; margin-bottom: 6px; }
    .header .subtitle { color: var(--text-secondary); font-size: 13px; }
    .stats-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--card-bg); padding: 18px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.1); text-align: center; border-top: 4px solid var(--primary); }
    .stat-card.success { border-top-color: var(--success); }
    .stat-card .label { color: var(--text-secondary); font-size: 12px; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
    .stat-card .value { font-size: 32px; font-weight: bold; }
    .expediente-card { background: var(--card-bg); border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.1); margin-bottom: 16px; overflow: hidden; }
    .card-header { padding: 14px 18px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #fafafa; cursor: pointer; user-select: none; transition: background .15s; }
    .card-header:hover { background: #e8f4fd; }
    .card-header.open { border-bottom: 1px solid var(--border); background: #e3f2fd; }
    .toggle-arrow { font-size: 11px; color: #1565c0; width: 14px; flex-shrink: 0; transition: transform .2s; }
    .toggle-arrow.open { transform: rotate(90deg); }
    .jurisdiccion-tag { background: #e3f2fd; color: #1565c0; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
    .nombre-parte { font-size: 14px; font-weight: 600; color: var(--text-primary); flex: 1; }
    .status-badge { font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 12px; }
    .status-ok   { background: #e8f5e9; color: #2e7d32; }
    .status-err  { background: #ffebee; color: #c62828; }
    .status-nueva { background: #fff3e0; color: #e65100; }
    .table-container { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #2196F3; color: #fff; padding: 9px 12px; text-align: left; white-space: nowrap; font-weight: 500; }
    td { padding: 7px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    tr:hover td { background: #e3f2fd; }
    .exp-num { font-weight: 600; color: #1565c0; white-space: nowrap; }
    .caratula { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .situacion-badge { font-size: 11px; background: #f5f5f5; padding: 1px 7px; border-radius: 4px; white-space: nowrap; }
    .fecha-col { white-space: nowrap; color: var(--text-secondary); font-size: 12px; }
    .empty-row { text-align: center; color: var(--text-secondary); padding: 20px; font-style: italic; }
</style>
</head>
<body>
    <div class="header">
        <h1>${titulo}</h1>
        <div class="subtitle">Generado el ${fecha} &mdash; ${resultados.length} parte(s) procesada(s)</div>
    </div>
    ${statsHTML}
    ${seccionesHTML}
<script>
    function toggleCard(idx) {
        var tabla  = document.getElementById('tabla-'  + idx);
        var arrow  = document.getElementById('arrow-'  + idx);
        var header = arrow.closest('.card-header');
        var open   = tabla.style.display === 'none';
        tabla.style.display  = open ? '' : 'none';
        arrow.classList.toggle('open',  open);
        header.classList.toggle('open', open);
    }
</script>
</body>
</html>`;
}

ipcMain.handle('run-monitoreo', async (event, { modo, partes }) => {
    if (authManager.activeChild) {
        return { success: false, error: 'Ya hay un proceso en ejecución' };
    }
    try {
        if (!authManager.isAuthenticated()) {
            return { success: false, error: 'No autenticado' };
        }

        const token   = authManager.backendClient.token;
        const apiBase = authManager.backendClient.baseURL;

        const configMonitoreo = JSON.stringify({ modo, partes, token, apiBase });

        mainWindow.webContents.send('batch-progress', { indeterminate: true, label: `Monitoreando ${partes.length} parte${partes.length !== 1 ? 's' : ''}...` });
        const result = await authManager.executeRemoteScriptAsLocal(
            'procesarMonitoreo.js',
            [],
            { extraFiles: { 'config_monitoreo.json': configMonitoreo }, extraEnv: leerExtraEnvHeadless() }
        );

        // Parsear RESULT del output (executeRemoteScriptAsLocal retorna { success, output, executionTime })
        let parsedResult = null;
        const rawOutput = result.output || '';
        const resultLine = rawOutput.split('\n').find(l => l.trim().startsWith('RESULT:'));
        if (resultLine) {
            try {
                parsedResult = JSON.parse(resultLine.trim().substring(7));
            } catch (e) {
                console.error('Error parseando RESULT del monitor:', e.message);
            }
        }

        // Generar y abrir visor HTML con los expedientes del monitor
        const resultados = parsedResult?.resultados || [];
        if (resultados.length > 0) {
            try {
                const visorHtml = generarVisorMonitoreo(modo, resultados);
                const descDir   = path.join(app.getPath('userData'), 'descargas');
                if (!fs.existsSync(descDir)) fs.mkdirSync(descDir, { recursive: true });
                const visorPath = path.join(descDir, 'visor_monitoreo.html');
                fs.writeFileSync(visorPath, visorHtml, 'utf8');
                const { shell } = require('electron');
                await shell.openPath(visorPath);
                mainWindow.webContents.send('process-log', { type: 'info', text: '🌐 Visor Monitor abierto' });
            } catch (e) {
                console.error('Error generando visor monitoreo:', e.message);
            }
        }

        mainWindow.webContents.send('batch-progress', { done: true });
        updateRunStats('monitoreo', result.success);
        mainWindow.webContents.send('process-finished', {
            code: result.success ? 0 : 1,
            success: result.success,
            isInformeBatch: false,
            isMonitor: true,
            monitorModo: modo,
        });

        return result;

    } catch (error) {
        const stopped = isSigtermError(error);
        console.error('Error en run-monitoreo:', error);
        mainWindow.webContents.send('batch-progress', { done: true, stopped });
        if (!stopped) updateRunStats('monitoreo', false);
        mainWindow.webContents.send('process-finished', { code: 1, success: false, isInformeBatch: false, stopped });
        return { success: false, error: error.message || error.error };
    }
});

// — Monitor CRUD (proxies al backend) —

ipcMain.handle('monitor-get-partes', async () => {
    try {
        return await authManager.backendClient.request('GET', '/monitor/partes');
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-get-stats', async () => {
    try {
        return await authManager.backendClient.request('GET', '/monitor/stats');
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-agregar-parte', async (event, { nombre, jurisdiccionCodigo, jurisdiccionSigla }) => {
    try {
        return await authManager.backendClient.request('POST', '/monitor/partes', {
            nombre_parte:        nombre,
            jurisdiccion_codigo: jurisdiccionCodigo,
            jurisdiccion_sigla:  jurisdiccionSigla,
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-editar-parte', async (event, { id, nombre, jurisdiccionCodigo, jurisdiccionSigla }) => {
    try {
        return await authManager.backendClient.request('PUT', `/monitor/partes/${id}`, {
            nombre_parte:        nombre,
            jurisdiccion_codigo: jurisdiccionCodigo,
            jurisdiccion_sigla:  jurisdiccionSigla,
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-eliminar-parte', async (event, id) => {
    try {
        return await authManager.backendClient.request('DELETE', `/monitor/partes/${id}`);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-get-expedientes', async (event, parteId) => {
    try {
        return await authManager.backendClient.request('GET', `/monitor/partes/${parteId}/expedientes`);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-get-novedades', async () => {
    try {
        return await authManager.backendClient.request('GET', '/monitor/novedades');
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-confirmar-exp', async (event, id) => {
    try {
        return await authManager.backendClient.request('POST', `/monitor/expedientes/${id}/confirmar`);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-rechazar-exp', async (event, id) => {
    try {
        return await authManager.backendClient.request('POST', `/monitor/expedientes/${id}/rechazar`);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-bulk-confirmar', async (event, ids) => {
    try {
        return await authManager.backendClient.request('POST', '/monitor/novedades/bulk-confirmar', { ids });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-descartar-todos', async () => {
    try {
        return await authManager.backendClient.request('POST', '/monitor/novedades/descartar-todos');
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-get-all-expedientes', async () => {
    try {
        return await authManager.backendClient.request('GET', '/monitor/expedientes/all');
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('monitor-generar-visor-guardado', async (event, tipo) => {
    // tipo: 'expedientes' | 'novedades'
    try {
        let resultados;
        if (tipo === 'novedades') {
            const res = await authManager.backendClient.request('GET', '/monitor/novedades');
            if (!res.success || !res.novedades?.length) {
                return { success: false, error: 'Sin novedades para generar visor' };
            }
            // Agrupar por parte
            const byParte = {};
            for (const n of res.novedades) {
                const key = n.parte_id;
                if (!byParte[key]) byParte[key] = {
                    parte_id: key,
                    nombre_parte: n.nombre_parte,
                    jurisdiccion_sigla: n.jurisdiccion_sigla,
                    expedientes: [], ok: true, error: null,
                };
                byParte[key].expedientes.push(n);
            }
            resultados = Object.values(byParte).map(g => ({
                ...g,
                total_encontrados: g.expedientes.length,
                nuevos_detectados: g.expedientes.length,
            }));
        } else {
            const res = await authManager.backendClient.request('GET', '/monitor/expedientes/all');
            if (!res.success || !res.expedientes?.length) {
                return { success: false, error: 'Sin expedientes guardados para generar visor' };
            }
            const byParte = {};
            for (const e of res.expedientes) {
                const key = e.parte_id;
                if (!byParte[key]) byParte[key] = {
                    parte_id: key,
                    nombre_parte: e.nombre_parte,
                    jurisdiccion_sigla: e.jurisdiccion_sigla,
                    expedientes: [], ok: true, error: null,
                };
                byParte[key].expedientes.push(e);
            }
            resultados = Object.values(byParte).map(g => ({
                ...g,
                total_encontrados: g.expedientes.length,
                nuevos_detectados: 0,
            }));
        }

        const visorHtml = generarVisorMonitoreo(tipo === 'novedades' ? 'novedades' : 'inicial', resultados);
        const descDir   = path.join(app.getPath('userData'), 'descargas');
        if (!fs.existsSync(descDir)) fs.mkdirSync(descDir, { recursive: true });
        const fname     = tipo === 'novedades' ? 'visor_novedades_guardado.html' : 'visor_expedientes_guardado.html';
        const visorPath = path.join(descDir, fname);
        fs.writeFileSync(visorPath, visorHtml, 'utf8');
        const { shell } = require('electron');
        await shell.openPath(visorPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============ IPC HANDLERS - SEGURIDAD / NAVEGADOR ============

ipcMain.handle('abrir-navegador-pjn', async () => {
    try {
        await closeChromeProfile();
        const scriptPath = path.join(__dirname, 'src', 'scripts', 'abrirNavegadorPJN.js');

        if (!fs.existsSync(scriptPath)) {
            return { success: false, error: 'Script abrirNavegadorPJN.js no encontrado' };
        }

        // Obtener CUIT del usuario autenticado
        let cuit = '';
        try {
            const sessionInfo = await authManager.verifySession();
            cuit = sessionInfo?.user?.cuit || '';
        } catch (_) { /* continuar sin cuit */ }

        const { screen } = require('electron');
        const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

        fork(scriptPath, [cuit], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                LOCALAPPDATA: process.env.LOCALAPPDATA,
                SCREEN_WIDTH:  String(sw),
                SCREEN_HEIGHT: String(sh),
            }
        }).unref();

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agregar-password-scw', async () => {
    try {
        await closeChromeProfile();
        const { fork } = require('child_process');
        const scriptPath = path.join(__dirname, 'src', 'scripts', 'agregarPasswordSCW.js');

        if (!fs.existsSync(scriptPath)) {
            return { success: false, error: 'Script agregarPasswordSCW.js no encontrado' };
        }

        // Obtener CUIT del usuario autenticado
        let cuit = '';
        try {
            const sessionInfo = await authManager.verifySession();
            cuit = sessionInfo?.user?.cuit || '';
        } catch (_) { /* continuar sin cuit */ }

        const { screen } = require('electron');
        const { width: sw2, height: sh2 } = screen.getPrimaryDisplay().workAreaSize;

        fork(scriptPath, [cuit], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                LOCALAPPDATA: process.env.LOCALAPPDATA,
                SCREEN_WIDTH:  String(sw2),
                SCREEN_HEIGHT: String(sh2),
            }
        }).unref();

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-console', async (event, text) => {
    const { dialog } = require('electron');
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `consola-${stamp}.txt`;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar consola',
        defaultPath: path.join(app.getPath('downloads'), defaultName),
        filters: [{ name: 'Texto', extensions: ['txt'] }]
    });

    if (canceled || !filePath) return { success: false };

    try {
        fs.writeFileSync(filePath, text, 'utf8');
        return { success: true, filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('toggle-browser-visibility', async (event, show) => {
    if (!authManager || !authManager.activeChild) {
        console.warn('⚠️ toggle-browser-visibility: no hay proceso activo (activeChild es null)');
        return { success: false, error: 'No hay proceso activo' };
    }
    try {
        console.log(`🔄 toggle-browser-visibility: enviando TOGGLE_BROWSER show=${show}`);
        authManager.activeChild.send({ type: 'TOGGLE_BROWSER', show });
        return { success: true };
    } catch (err) {
        console.error('❌ toggle-browser-visibility error:', err.message);
        return { success: false, error: err.message };
    }
});

// ============ FUNCIONES AUXILIARES (SIN CAMBIOS) ============

function cargarConfiguracion() {
    const isProduction = !isDev;

    const posiblesRutas = isDev
        ? [
            path.join(__dirname, 'config_proceso.json'),
            path.join(app.getPath('userData'), 'config_proceso.json')
          ]
        : [
            path.join(app.getPath('userData'), 'config_proceso.json'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'config_proceso.json'),
            path.join(__dirname, 'config_proceso.json'),
            path.join(process.resourcesPath, 'config_proceso.json')
        ];

    let configPath = null;

    for (const ruta of posiblesRutas) {
        if (fs.existsSync(ruta)) {
            configPath = ruta;
            console.log(`📄 Configuración encontrada en: ${ruta}`);
            break;
        }
    }

    if (!configPath) {
        console.error('❌ ERROR: No se encontró config_proceso.json');
        console.error('   Rutas buscadas:');
        posiblesRutas.forEach(ruta => console.error(`   - ${ruta}`));

        const defaultConfigPath = path.join(app.getPath('userData'), 'config_proceso.json');
        const configDefault = {
            "general": {
                "fechaLimite": "01/11/2025",
                "identificador": "27320694359",
                "maxMovimientos": 15,
                "buscarEnTodos": true
            },
            "opciones": {
                "descargarArchivos": false,
                "incluirHistoricos": false,
                "incluirHrefs": true,
                "formatoSalida": "ambos"
            },
            "secciones": {
                "letrado": true,
                "parte": true,
                "autorizado": true,
                "favoritos": true
            },
            "visor": {
                "abrirAutomaticamente": true,
                "navegadorPredeterminado": true
            },
            "notificaciones": {
                "activadas": true,
                "sonido": true
            },
            "email": {
                "activado": false,
                "destinatario": "tu_email@ejemplo.com",
                "smtp": {
                    "host": "smtp.gmail.com",
                    "port": 587,
                    "secure": false,
                    "user": "tu_email@gmail.com",
                    "pass": "tu_contraseña_app"
                }
            },
            "excel": {
                "generar": true,
                "incluirMovimientos": true
            },
            "programacion": {
                "activada": false,
                "hora": "08:00",
                "dias": ["lunes", "martes", "miercoles", "jueves", "viernes"]
            }
        };

        fs.writeFileSync(defaultConfigPath, JSON.stringify(configDefault, null, 2));
        console.log(`✅ Configuración por defecto creada en: ${defaultConfigPath}`);
        return configDefault;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config;
    } catch (error) {
        console.error('❌ ERROR: config_proceso.json inválido:', error.message);
        throw error;
    }
}

function getConfigPath() {
    const isDev = !app.isPackaged;

    const posiblesRutas = isDev
        ? [path.join(__dirname, 'config_proceso.json')]
        : [
            path.join(app.getPath('userData'), 'config_proceso.json'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'config_proceso.json')
        ];

    for (const ruta of posiblesRutas) {
        if (fs.existsSync(ruta)) {
            return ruta;
        }
    }

    return path.join(app.getPath('userData'), 'config_proceso.json');
}