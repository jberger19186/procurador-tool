const path = require('path');
const BackendClient = require('../api/backendClient');
const ScriptCache = require('../scripts/scriptCache');
const ScriptExecutor = require('../scripts/scriptExecutor');
const CodeObfuscator = require('../security/codeObfuscator');
const SecureTempFolder = require('../security/secureTempFolder');
const ScriptAutoDestruct = require('../security/scriptAutoDestruct');
const FileEncryption = require('../security/fileEncryption');
const NotificationManager = require('../notifications/notificationManager');
const SecurityMetrics = require('../telemetry/securityMetrics');
const { ScriptVerifier, SignatureVerificationError, ChecksumMismatchError } = require('../security/scriptVerifier');
const SecurityAudit = require('../telemetry/securityAudit');

/**
 * Determina el subsistema al que pertenece un script para el tracking granular
 * @param {string} scriptName
 * @returns {string|null} 'proc', 'informe', o null
 */
function getSubsystemForScript(scriptName) {
    const name = (scriptName || '').toLowerCase();
    // Procurar Batch tiene subsistema independiente
    if (name.includes('procesarcustomexpedientes')) {
        return 'batch';
    }
    if (name.includes('testm1') || name.includes('procesarnovedades') ||
        name.includes('listarsscwpjn') || name.includes('consultarscwpjn')) {
        return 'proc';
    }
    if (name.includes('informe') || name.includes('quickscwpjn')) {
        return 'informe';
    }
    // procesarMonitoreo se trackea desde monitor.js directamente (bulk expedientes)
    return null;
}

/**
 * AuthManager
 * Gestiona autenticación, sesión y ciclo de vida de la app
 */
class AuthManager {
    constructor(backendURL) {
        this.backendClient = new BackendClient(backendURL);
        this.scriptCache = new ScriptCache();
        this.scriptExecutor = new ScriptExecutor(this.scriptCache);

        // ✅ MÓDULOS DE SEGURIDAD
        this.obfuscator = new CodeObfuscator();
        this.obfuscator.disable(); 
        this.secureTempFolder = new SecureTempFolder();
        this.autoDestruct = new ScriptAutoDestruct();
        this.notificationManager = new NotificationManager();
        this.securityMetrics = new SecurityMetrics();
        this.fileEncryption = new FileEncryption();
        this.scriptVerifier = new ScriptVerifier();      // ← NUEVO: Verificador RSA
        this.securityAudit = new SecurityAudit();         // ← NUEVO: Audit log

        // Iniciar auto-limpieza de carpetas temporales
        this.secureTempFolder.startAutoCleanup();

        this.heartbeatInterval = null;
        this.sessionVerified = false;

        console.log('🔐 AuthManager inicializado con módulos de seguridad');
    }

    /**
     * Cargar todos los scripts disponibles al inicio de sesión
     */
    async loadAllScripts() {
        try {
            console.log('📦 Cargando todos los scripts disponibles...');

            const result = await this.backendClient.listScripts();

            if (!result.success) {
                console.error('❌ Error listando scripts:', result.error);
                return { success: false, error: result.error };
            }

            const scripts = result.scripts;

            const results = await Promise.all(
                scripts.map(scriptInfo => this.loadScript(scriptInfo.name))
            );

            const loaded = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;
            results.forEach((r, i) => {
                if (!r.success) console.warn(`⚠️ No se pudo cargar ${scripts[i].name}`);
            });

            console.log(`✅ Scripts cargados: ${loaded}, Fallidos: ${failed}`);

            return {
                success: true,
                loaded,
                failed,
                total: scripts.length
            };

        } catch (error) {
            console.error('❌ Error cargando scripts:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Login (MODIFICADO)
     */
    async login(email, password) {
        try {
            const result = await this.backendClient.login(email, password);

            if (result.success) {
                this.sessionVerified = true;
                this.startHeartbeat();

                // Cargar scripts en paralelo (Promise.all) antes de abrir la ventana principal
                await this.loadAllScripts();

                console.log('✅ Sesión iniciada correctamente');
            }

            return result;
        } catch (error) {
            console.error('❌ Error en login:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verificar sesión
     */
    async verifySession() {
        try {
            const result = await this.backendClient.verifySession();
            this.sessionVerified = result.success;
            return result;
        } catch (error) {
            console.error('❌ Error verificando sesión:', error);
            this.sessionVerified = false;
            return { success: false, error: error.message };
        }
    }

    /**
     * Iniciar heartbeat (cada 5 minutos)
     */
    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(async () => {
            try {
                // Renovar token antes de que expire (1h)
                const refreshResult = await this.backendClient.refreshToken();
                if (!refreshResult.success) {
                    console.warn('⚠️ Token refresh fallido');
                    this.sessionVerified = false;
                    return;
                }

                const result = await this.backendClient.heartbeat();
                if (!result.success) {
                    console.warn('⚠️ Heartbeat fallido');
                    this.sessionVerified = false;
                }
            } catch (error) {
                console.error('❌ Error en heartbeat:', error);
                this.sessionVerified = false;
            }
        }, 5 * 60 * 1000); // 5 minutos

        console.log('💓 Heartbeat + token refresh iniciado (cada 5 min)');
    }

    /**
     * Descargar y cachear script
     */
    async loadScript(scriptName) {
        try {
            // Verificar si ya está en caché
            if (this.scriptCache.has(scriptName)) {
                console.log(`📦 Script ya en caché: ${scriptName}`);
                return { success: true, fromCache: true };
            }

            // Descargar del backend
            console.log(`📥 Descargando: ${scriptName}`);
            const downloadResult = await this.backendClient.downloadScript(scriptName);

            if (!downloadResult.success) {
                return { success: false, error: downloadResult.error };
            }

            const { script, security } = downloadResult;

            // El backend ya envía el código desencriptado
            const code = script.content;

            if (!code) {
                return { success: false, error: 'Script vacío o no recibido' };
            }

            // ═══════════════════════════════════════════
            // Verificación RSA + Checksum Etapa 1
            // ═══════════════════════════════════════════
            if (security && security.checksum && security.signature) {
                try {
                    const verifyStart = Date.now();

                    // Verificar firma RSA + checksum
                    const verifyResult = this.scriptVerifier.verifyFull(
                        scriptName,
                        code,
                        security
                    );

                    const verifyTime = Date.now() - verifyStart;

                    this.securityAudit.logScriptVerified(scriptName, {
                        checksum: security.checksum,
                        signedAt: security.signedAt,
                        verificationTime: verifyTime,
                        stage: 1
                    });

                    console.log(`🔐 Verificación RSA OK: ${scriptName} (${verifyTime}ms)`);

                } catch (verifyError) {
                    if (verifyError instanceof SignatureVerificationError) {
                        this.securityAudit.logSignatureFailed(scriptName, {
                            expectedChecksum: security.checksum,
                            error: verifyError.message
                        });
                        console.error(`🚨 FIRMA INVÁLIDA: ${scriptName} - Script rechazado`);
                        return { success: false, error: `Firma digital inválida: ${scriptName}` };
                    }

                    if (verifyError instanceof ChecksumMismatchError) {
                        this.securityAudit.logChecksumMismatch(scriptName, verifyError.stage, {
                            expected: verifyError.expected,
                            actual: verifyError.actual
                        });
                        console.error(`🚨 CHECKSUM MISMATCH: ${scriptName} - Script rechazado`);
                        return { success: false, error: `Integridad comprometida: ${scriptName}` };
                    }

                    // Error genérico de verificación - log pero no bloquear
                    this.securityAudit.logSecurityError(scriptName, verifyError);
                    console.warn(`⚠️ Error verificando ${scriptName}:`, verifyError.message);
                }
            } else {
                // Sin datos de firma (backend sin RSA configurado)
                this.securityAudit.logVerificationSkipped(scriptName, 'Sin datos de firma del servidor');
                console.warn(`⚠️ Script sin firma digital: ${scriptName}`);
            }

            // Guardar en caché (solo RAM) con metadata de seguridad
            this.scriptCache.set(scriptName, code, {
                version: script.version,
                hash: script.hash,
                security: security || null
            });

            this.scriptCache.incrementDownloads();

            return { success: true, fromCache: false };

        } catch (error) {
            console.error(`❌ Error cargando script ${scriptName}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Ejecutar script en VM (pequeños scripts sin Puppeteer)
     */
    async executeScript(scriptName, params = {}) {
        try {
            const startTime = Date.now();

            // ✅ Lista de scripts dependientes
            const dependencies = {
                'procesarNovedadesCompleto.js': [
                    'testM1.js',
                    'testM2.js',
                    'consultarscwpjn.js',
                    'listarSCWPJN.js'
                ],
                'listarSCWPJN.js': [
                    'consultarscwpjn.js'
                ]
            };

            // ✅ Cargar script principal
            const loadResult = await this.loadScript(scriptName);
            if (!loadResult.success) {
                return {
                    success: false,
                    error: `No se pudo cargar el script: ${loadResult.error}`
                };
            }

            // ✅ Cargar dependencias si existen
            if (dependencies[scriptName]) {
                console.log(`📦 Cargando dependencias de ${scriptName}...`);

                for (const dep of dependencies[scriptName]) {
                    const depResult = await this.loadScript(dep);
                    if (!depResult.success) {
                        console.warn(`⚠️ No se pudo cargar dependencia ${dep}: ${depResult.error}`);
                    }
                }
            }

            // Obtener código del caché
            const code = this.scriptCache.get(scriptName);
            if (!code) {
                return {
                    success: false,
                    error: 'Script no encontrado en caché'
                };
            }

            // Ejecutar
            const execResult = await this.scriptExecutor.executeScript(
                code,
                scriptName,
                params
            );

            const totalTime = Date.now() - startTime;

            // Determinar subsistema según nombre del script
            const subsystem = getSubsystemForScript(scriptName);

            // Reportar ejecución al backend
            await this.backendClient.logExecution(
                scriptName,
                execResult.success,
                execResult.error || null,
                totalTime,
                subsystem
            );

            return {
                ...execResult,
                totalTime: totalTime
            };

        } catch (error) {
            console.error(`❌ Error ejecutando ${scriptName}:`, error);

            const subsystem = getSubsystemForScript(scriptName);

            // Reportar error al backend
            await this.backendClient.logExecution(
                scriptName,
                false,
                error.message,
                0,
                subsystem
            );

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * ✅ NUEVO: Ejecutar script con child_process (Puppeteer scripts)
     * CON TODAS LAS MEJORAS DE SEGURIDAD
     */
    async executeRemoteScriptAsLocal(scriptName, args = [], options = {}) {
        const { fork } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        const { cuitOverride, extraFiles } = options;

        return new Promise(async (resolve, reject) => {
            try {
                console.log(`\n🚀 Iniciando ejecución segura de: ${scriptName}`);

                // ✅ NOTIFICACIÓN: Proceso iniciado
                this.notificationManager.notifyProcessStarted(scriptName);
                this.securityMetrics.recordNotification();

                // 1. Obtener código del caché, verificando si el servidor tiene una versión más reciente
                let code = this.scriptCache.get(scriptName);
                if (code) {
                    // Script en caché: comparar hash con el servidor (1 request liviano ~50ms)
                    const cachedHash = this.scriptCache.getServerHash(scriptName);
                    if (cachedHash) {
                        try {
                            const versionCheck = await this.backendClient.checkScriptVersion(scriptName);
                            if (versionCheck.success && versionCheck.hash !== cachedHash) {
                                console.log(`🔄 Script actualizado en servidor: ${scriptName}. Re-descargando...`);
                                this.scriptCache.delete(scriptName);
                                await this.loadScript(scriptName);
                                code = this.scriptCache.get(scriptName);
                            }
                        } catch (e) {
                            // Si falla la verificación, usar caché (degradación elegante)
                            console.warn(`⚠️ No se pudo verificar versión de ${scriptName}, usando caché:`, e.message);
                        }
                    }
                } else {
                    // No está en caché: descargar
                    await this.loadScript(scriptName);
                    code = this.scriptCache.get(scriptName);
                }

                if (!code) {
                    this.notificationManager.notifyError('Script no disponible en caché');
                    return reject({ success: false, error: 'Script no disponible' });
                }

                // ✅ 2. SEGURIDAD: Crear carpeta temporal aleatoria y oculta
                const tempDir = await this.secureTempFolder.createSecureFolder();
                this.securityMetrics.recordSecureFolder();
                console.log(`🔐 Carpeta segura creada: ${path.basename(tempDir)}`);

                // 3. Copiar config_proceso.json
                const { app } = require('electron');
                const configSourcePath = path.join(app.getPath('userData'), 'config_proceso.json');
                const configDestPath = path.join(tempDir, 'config_proceso.json');

                if (fs.existsSync(configSourcePath)) {
                    if (cuitOverride) {
                        const configData = JSON.parse(fs.readFileSync(configSourcePath, 'utf8'));
                        if (!configData.general) configData.general = {};
                        configData.general.identificador = cuitOverride;
                        fs.writeFileSync(configDestPath, JSON.stringify(configData, null, 2));
                        console.log(`📋 Config copiado con CUIT inyectado: ${cuitOverride}`);
                    } else {
                        fs.copyFileSync(configSourcePath, configDestPath);
                        console.log(`📋 Config copiado`);
                    }
                } else {
                    console.warn(`⚠️ No se encontró config en: ${configSourcePath}`);
                }

                // 3b. Copiar archivos extra (ej: config_informe.json dinámico)
                if (extraFiles && typeof extraFiles === 'object') {
                    for (const [filename, content] of Object.entries(extraFiles)) {
                        const destPath = path.join(tempDir, filename);
                        const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                        fs.writeFileSync(destPath, data, 'utf8');
                        console.log(`📋 Extra file copiado: ${filename}`);
                    }
                }

                // 4. Copiar visorModal_template.html
                const visorTemplatePaths = [
                    path.join(app.getAppPath(), 'visorModal_template.html'),
                    path.join(__dirname, '..', '..', 'visorModal_template.html'),
                    path.join(process.resourcesPath, 'visorModal_template.html'),
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'visorModal_template.html')
                ];

                let visorSourcePath = null;
                for (const testPath of visorTemplatePaths) {
                    if (fs.existsSync(testPath)) {
                        visorSourcePath = testPath;
                        break;
                    }
                }

                if (visorSourcePath) {
                    const visorDestPath = path.join(tempDir, 'visorModal_template.html');
                    fs.copyFileSync(visorSourcePath, visorDestPath);
                    console.log(`📄 Template copiado`);
                } else {
                    console.warn(`⚠️ No se encontró visorModal_template.html`);
                }

                // 5. Cargar y guardar dependencias
                const dependencies = {
                    'procesarNovedadesCompleto.js': [
                        'testM1.js',
                        'testM2.js',
                        'sessionManager.js',
                        'errorHandler.js',
                        'cerrarNavegador.js',
                        'monitoreo.js'
                    ],
                    'listarSCWPJN.js': [
                        'testM1.js',
                        'sessionManager.js',
                        'errorHandler.js',
                        'cerrarNavegador.js'
                    ],
                    'consultarscwpjn.js': [
                        'testM2.js',
                        'sessionManager.js',
                        'errorHandler.js',
                        'cerrarNavegador.js'
                    ],
                    'informequickscwpjn.js': [
                        'testM2.js',
                        'sessionManager.js',
                        'errorHandler.js',
                        'cerrarNavegador.js',
                        'monitoreo.js'
                    ],
                    'procesarCustomExpedientes.js': [
                        'testM2.js',
                        'sessionManager.js',
                        'errorHandler.js',
                        'cerrarNavegador.js',
                        'monitoreo.js'
                    ],
                    'procesarMonitoreo.js': [
                        'testM2.js',
                        'sessionManager.js',
                        'errorHandler.js',
                        'cerrarNavegador.js',
                        'monitoreo.js',
                        'buscarPorParteScwpjn.js'
                    ]
                };

                // Lista de rutas de dependencias para auto-destrucción DIFERIDA
                const dependencyPaths = [];

                if (dependencies[scriptName]) {
                    console.log(`📦 Preparando dependencias para ${scriptName}...`);
                    for (const dep of dependencies[scriptName]) {
                        let depCode = this.scriptCache.get(dep);
                        if (!depCode) {
                            await this.loadScript(dep);
                            depCode = this.scriptCache.get(dep);
                        }
                        if (depCode) {
                            // ✅ SEGURIDAD: Encriptar dependencia con GCM
                            const encryptionResult = this.fileEncryption.encrypt(depCode);

                            // Guardar archivo encriptado con authTag
                            const encPath = path.join(tempDir, `${dep}.enc`);
                            const encryptedContent = `${encryptionResult.encrypted}|||${encryptionResult.authTag}`;
                            fs.writeFileSync(encPath, encryptedContent, 'utf8');

                            // Crear wrapper que desencripta (ofuscado)
                            const wrapperCode = this.fileEncryption.createWrapperScript(`${dep}.enc`, true);
                            const wrapperPath = path.join(tempDir, dep);
                            fs.writeFileSync(wrapperPath, wrapperCode, 'utf8');

                            dependencyPaths.push(wrapperPath);
                            dependencyPaths.push(encPath);

                            console.log(`  ✅ ${dep} (encriptado)`);
                        }
                    }
                }

                // ✅ 6. CHECKSUM ETAPA 2: Verificar antes de escribir a disco
                try {
                    this.scriptVerifier.verifyMultiStage(scriptName, 2, code);
                    this.securityAudit.logScriptVerified(scriptName, { stage: 2 });
                } catch (checksumError) {
                    if (checksumError instanceof ChecksumMismatchError) {
                        this.securityAudit.logChecksumMismatch(scriptName, 2, {
                            expected: checksumError.expected,
                            actual: checksumError.actual
                        });
                        console.error(`🚨 CHECKSUM ETAPA 2 FALLIDO: ${scriptName}`);
                        return reject({ success: false, error: 'Integridad comprometida en etapa 2' });
                    }
                    console.warn(`⚠️ Error checksum etapa 2:`, checksumError.message);
                }

                // ✅ 6b. SEGURIDAD: Encriptar script principal con GCM
                console.log(`🔒 Encriptando ${scriptName}...`);
                const encryptionResult = this.fileEncryption.encrypt(code);

                // Guardar archivo encriptado con authTag
                const encScriptPath = path.join(tempDir, `${scriptName}.enc`);
                const encryptedContent = `${encryptionResult.encrypted}|||${encryptionResult.authTag}`;
                fs.writeFileSync(encScriptPath, encryptedContent, 'utf8');

                // Crear wrapper que desencripta
                const wrapperCode = this.fileEncryption.createWrapperScript(`${scriptName}.enc`);
                const tempScriptPath = path.join(tempDir, scriptName);
                fs.writeFileSync(tempScriptPath, wrapperCode, 'utf8');

                console.log(`✅ Script principal encriptado y guardado`);

                // 7. Obtener ruta a node_modules
                const nodeModulesPath = path.join(app.getAppPath(), 'node_modules');

                // 8. Ejecutar con fork
                const startTime = Date.now();

                console.log('═══════════════════════════════════════');
                console.log('📂 Variables de entorno:');
                console.log('   APPDATA:', app.getPath('userData'));
                console.log('   Carpeta temp:', path.basename(tempDir));
                console.log('═══════════════════════════════════════');

                // Obtener credenciales de encriptación
                const credentials = this.fileEncryption.getSessionCredentials();

                // ✅ CHECKSUM ETAPA 3: Verificar antes de ejecutar
                try {
                    const diskCode = this.scriptCache.get(scriptName);
                    if (diskCode) {
                        this.scriptVerifier.verifyMultiStage(scriptName, 3, diskCode);
                        this.securityAudit.logScriptVerified(scriptName, { stage: 3 });
                    }
                } catch (checksumError) {
                    if (checksumError instanceof ChecksumMismatchError) {
                        this.securityAudit.logChecksumMismatch(scriptName, 3, {
                            expected: checksumError.expected,
                            actual: checksumError.actual
                        });
                        console.error(`🚨 CHECKSUM ETAPA 3 FALLIDO: ${scriptName}`);
                        return reject({ success: false, error: 'Integridad comprometida en etapa 3' });
                    }
                    console.warn(`⚠️ Error checksum etapa 3:`, checksumError.message);
                }

                const child = fork(tempScriptPath, args, {
                    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                    cwd: tempDir,
                    env: {
                        ...process.env,
                        SCREEN_WIDTH: process.env.SCREEN_WIDTH || '1920',
                        SCREEN_HEIGHT: process.env.SCREEN_HEIGHT || '1080',
                        NODE_PATH: nodeModulesPath,
                        APPDATA: app.getPath('userData'),
                        LOCALAPPDATA: process.env.LOCALAPPDATA,
                        DECRYPT_KEY: credentials.key,
                        DECRYPT_IV: credentials.iv,
                        ...(options.extraEnv || {})
                    }
                });

                // Guardar referencia al child activo para poder detenerlo desde stop-process
                this.activeChild = child;

                // ✅ 9. LOGGING de spawn
                child.on('spawn', () => {
                    console.log('🚀 Proceso spawneado correctamente');
                });

                // ✅ 10. MENSAJES IPC del child (ej: LOGIN_MANUAL_REQUIRED)
                child.on('message', (msg) => {
                    try {
                        if (!msg || !msg.type) return;
                        console.log(`📨 Mensaje del child: ${msg.type}`);

                        if (msg.type === 'LOGIN_MANUAL_REQUIRED') {
                            const { BrowserWindow } = require('electron');
                            const mainWindow = BrowserWindow.getAllWindows()[0];
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('login-manual-required', {
                                    cuit: msg.cuit,
                                    message: msg.message
                                });
                            }
                        }

                        if (msg.type === 'BROWSER_RESTARTED') {
                            // El navegador se reinició durante un reintento — está oculto.
                            // Notificar al renderer para sincronizar el estado del toggle.
                            const { BrowserWindow } = require('electron');
                            const mainWindow = BrowserWindow.getAllWindows()[0];
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('browser-restarted');
                            }
                        }
                    } catch (e) {
                        console.warn('⚠️ Error procesando mensaje del child:', e.message);
                    }
                });

                let output = '';
                let errorOutput = '';

                // Capturar stdout Y enviar a renderer
                child.stdout.on('data', (data) => {
                    const text = data.toString();
                    output += text;
                    console.log(text);

                    try {
                        const { BrowserWindow } = require('electron');
                        const mainWindow = BrowserWindow.getAllWindows()[0];
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('process-log', {
                                type: 'info',
                                text: text.trim()
                            });
                        }
                    } catch (e) {
                        // Ignorar
                    }
                });

                // Capturar stderr Y enviar a renderer
                child.stderr.on('data', (data) => {
                    const text = data.toString();
                    errorOutput += text;
                    console.error(text);

                    try {
                        const { BrowserWindow } = require('electron');
                        const mainWindow = BrowserWindow.getAllWindows()[0];
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('process-log', {
                                type: 'error',
                                text: text.trim()
                            });
                        }
                    } catch (e) {
                        // Ignorar
                    }
                });

                child.on('close', async (code) => {
                    // Limpiar referencia al child activo
                    this.activeChild = null;

                    const totalTime = Date.now() - startTime;

                    // ✅ SEGURIDAD: Eliminar scripts (wrapper + encriptados)
                    try {
                        console.log('🔒 Eliminando scripts (proceso finalizado)...');

                        // Eliminar wrapper del script principal
                        if (fs.existsSync(tempScriptPath)) {
                            this.autoDestruct.destroyScript(tempScriptPath);
                        }

                        // Eliminar archivo encriptado del script principal
                        const encScriptPath = path.join(tempDir, `${scriptName}.enc`);
                        if (fs.existsSync(encScriptPath)) {
                            this.autoDestruct.destroyScript(encScriptPath);
                        }

                        // Eliminar dependencias (wrapper + encriptados)
                        for (const depPath of dependencyPaths) {
                            if (fs.existsSync(depPath)) {
                                this.autoDestruct.destroyScript(depPath);
                            }
                        }

                        this.securityMetrics.recordAutoDestruct(totalTime);
                        console.log('✅ Scripts eliminados correctamente');
                    } catch (cleanupError) {
                        console.error('⚠️ Error eliminando scripts:', cleanupError.message);
                    }

                    // 10. COPIAR archivos generados desde carpeta temporal a userData
                    try {
                        const tempDescargasPath = path.join(tempDir, 'descargas');
                        const finalDescargasPath = path.join(app.getPath('userData'), 'descargas');

                        if (!fs.existsSync(finalDescargasPath)) {
                            fs.mkdirSync(finalDescargasPath, { recursive: true });
                        }

                        if (fs.existsSync(tempDescargasPath)) {
                            console.log('📦 Copiando archivos generados...');

                            const copyRecursive = (src, dest) => {
                                if (!fs.existsSync(dest)) {
                                    fs.mkdirSync(dest, { recursive: true });
                                }

                                const entries = fs.readdirSync(src, { withFileTypes: true });

                                for (const entry of entries) {
                                    const srcPath = path.join(src, entry.name);
                                    const destPath = path.join(dest, entry.name);

                                    if (entry.isDirectory()) {
                                        copyRecursive(srcPath, destPath);
                                    } else {
                                        fs.copyFileSync(srcPath, destPath);
                                        console.log(`  ✅ ${entry.name}`);
                                    }
                                }
                            };

                            copyRecursive(tempDescargasPath, finalDescargasPath);
                            console.log('✅ Archivos copiados exitosamente');
                        }
                    } catch (copyError) {
                        console.error('❌ Error copiando archivos:', copyError);
                    }

                    // ✅ 11. NOTIFICACIONES según resultado
                    if (code === 0) {
                        // Intentar leer estadísticas del resultado
                        try {
                            const procesosPath = path.join(tempDir, 'descargas', 'procesos_automaticos');

                            if (fs.existsSync(procesosPath)) {
                                const outputFiles = fs.readdirSync(procesosPath);
                                const jsonFile = outputFiles.find(f => f.endsWith('.json'));

                                if (jsonFile) {
                                    const resultData = JSON.parse(
                                        fs.readFileSync(path.join(procesosPath, jsonFile), 'utf8')
                                    );

                                    const stats = {
                                        expedientes: resultData.expedientes?.length || 0,
                                        exitosos: resultData.expedientes?.filter(e => e.estado === 'exitoso').length || 0,
                                        fallidos: resultData.expedientes?.filter(e => e.estado === 'fallido').length || 0,
                                        tiempo: totalTime
                                    };

                                    this.notificationManager.notifyProcessComplete(stats);
                                    this.securityMetrics.recordNotification();
                                }
                            }
                        } catch (e) {
                            // Si no se puede leer stats, notificar sin detalles
                            this.notificationManager.notifyProcessComplete({ tiempo: totalTime });
                            this.securityMetrics.recordNotification();
                        }
                    } else {
                        this.notificationManager.notifyError(`Proceso terminó con código ${code}`);
                        this.securityMetrics.recordNotification();
                    }

                    // ✅ 12. Limpieza de carpeta temporal (diferida)
                    setTimeout(async () => {
                        await this.secureTempFolder.deleteSecureFolder(tempDir);
                    }, 2000); // Esperar 2 segundos antes de eliminar

                    // 13. Reportar ejecución al backend (incrementa usage_count en BD)
                    try {
                        const subsystem = getSubsystemForScript(scriptName);
                        await this.backendClient.logExecution(
                            scriptName,
                            code === 0,
                            code !== 0 ? `Proceso terminó con código ${code}` : null,
                            totalTime,
                            subsystem
                        );
                    } catch (logError) {
                        console.warn('⚠️ No se pudo registrar ejecución en backend:', logError.message);
                        // No bloquear el resultado — el logging es no-crítico
                    }

                    // 14. Resolver o rechazar
                    if (code === 0) {
                        console.log(`✅ Ejecución completada en ${totalTime}ms`);

                        // Imprimir reportes finales
                        this.securityMetrics.printReport();
                        this.securityAudit.printReport();        // ← NUEVO
                        this.securityAudit.exportSession();       // ← NUEVO: Guardar sesión
                        this.scriptVerifier.clearAllRegistries(); // ← NUEVO: Limpiar checksums

                        resolve({ success: true, output, executionTime: totalTime });
                    } else {
                        console.error(`❌ Proceso terminó con código ${code}`);
                        reject({
                            success: false,
                            error: `Código ${code}`,
                            output: errorOutput
                        });
                    }

                });

                child.on('error', (error) => {
                    console.error(`❌ Error en proceso hijo:`, error);
                    this.notificationManager.notifyError(error.message);
                    reject({ success: false, error: error.message });
                });

            } catch (error) {
                console.error('❌ Error en executeRemoteScriptAsLocal:', error);
                this.notificationManager.notifyError(error.message);
                reject({ success: false, error: error.message });
            }
        });
    }

    /**
     * Logout y limpieza
     */
    async logout() {
        try {
            // Detener heartbeat
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }

            // Limpiar caché (eliminar scripts de RAM)
            this.scriptCache.clear();

            // Logout del backend
            this.backendClient.logout();

            this.sessionVerified = false;

            console.log('👋 Sesión cerrada y caché limpiado');
            return { success: true };

        } catch (error) {
            console.error('❌ Error en logout:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Detener el proceso hijo activo (si existe).
     * Llamado desde el handler stop-process de main.js.
     */
    stopCurrentProcess() {
        if (this.activeChild) {
            try {
                this.activeChild.kill('SIGTERM');
                console.log('🛑 Proceso hijo detenido por solicitud del usuario');
            } catch (e) {
                console.warn('⚠️ Error al detener proceso hijo:', e.message);
            }
            this.activeChild = null;
            return true;
        }
        return false;
    }

    /**
     * Verificar si está autenticado
     */
    isAuthenticated() {
        return this.backendClient.isAuthenticated() && this.sessionVerified;
    }

    /**
     * Obtener información del usuario
     */
    getUser() {
        return this.backendClient.getUser();
    }

    /**
     * Obtener estadísticas completas
     */
    getStats() {
        return {
            cache: this.scriptCache.getStats(),
            executor: this.scriptExecutor.getStats(),
            security: this.securityMetrics.getMetrics(),
            audit: this.securityAudit.getSummary(),         // ← NUEVO
            verifier: this.scriptVerifier.getConfig(),      // ← NUEVO
            authenticated: this.isAuthenticated(),
            user: this.getUser()
        };
    }

    /**
     * ✅ Obtener reporte de seguridad
     */
    getSecurityReport() {
        return this.securityMetrics.getMetrics();
    }

    /**
     * ✅ Shutdown completo con limpieza
     */
    shutdown() {
        console.log('🛑 Iniciando shutdown de AuthManager...');

        // Detener auto-limpieza
        this.secureTempFolder.stopAutoCleanup();

        // Limpiar todas las carpetas temporales
        this.secureTempFolder.cleanupAll();

        // Ejecutar destrucción pendiente
        this.autoDestruct.cleanup();

        // Imprimir reporte final
        this.securityMetrics.printReport();

        console.log('✅ AuthManager shutdown completo');
    }

}

module.exports = AuthManager;