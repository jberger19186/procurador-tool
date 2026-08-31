const path = require('path');
const BackendClient = require('../api/backendClient');
const ScriptCache = require('../scripts/scriptCache');
const CodeObfuscator = require('../security/codeObfuscator');
const SecureTempFolder = require('../security/secureTempFolder');
const ScriptAutoDestruct = require('../security/scriptAutoDestruct');
const FileEncryption = require('../security/fileEncryption');
const NotificationManager = require('../notifications/notificationManager');
const SecurityMetrics = require('../telemetry/securityMetrics');
const { ScriptVerifier, SignatureVerificationError, ChecksumMismatchError } = require('../security/scriptVerifier');
const SecurityAudit = require('../telemetry/securityAudit');
const { motivoInformeSinPDF } = require('../../informe/motivoInformeSinPDF');

// Q6 (2026-07-30, Fase 2 del plan de verificación de firmas): mensaje único para
// los 4 casos de rechazo por integridad (C2/F1, C3/F4, C4/F7, C5/F2-F3). El
// detalle técnico (qué script, qué etapa, qué excepción) va solo a console.error
// y a securityAudit — el usuario ve siempre el mismo texto, accionable y sin
// jerga, tal como decidió el operador en la decisión Q6.c del plan.
const ERROR_INTEGRIDAD = 'No se pudo verificar la integridad de los componentes de la aplicación. ' +
    'Cerrá y volvé a abrir; si el problema persiste, contactá a soporte.';

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
                } else {
                    // Auto-recuperación: si un fallo transitorio previo dejó la sesión
                    // marcada como no verificada, un refresh+heartbeat exitoso la
                    // restaura (evita que la app quede trabada en "No autenticado" hasta
                    // reiniciar tras un parpadeo de red o un 403 temporal).
                    this.sessionVerified = true;
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

            // Q6 (2026-07-30, C4/F7): si la clave pública no se pudo cargar,
            // verifySignature() devuelve true para CUALQUIER firma
            // (scriptVerifier.js — "degradación elegante"). Se exige acá que el
            // verificador esté operativo ANTES de confiar en su resultado, sin
            // modificar src/security/, que es zona protegida.
            if (!this.scriptVerifier.isReady()) {
                console.error(`🚨 Verificador de integridad no inicializado — no se puede validar ${scriptName}`);
                return { success: false, error: ERROR_INTEGRIDAD };
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

                    // Q6 (2026-07-30, C2/F1): fail-CLOSED. Si la verificación no se
                    // puede completar, no se puede afirmar que el script sea
                    // legítimo — antes se logueaba y el script se cacheaba igual.
                    this.securityAudit.logSecurityError(scriptName, verifyError);
                    console.error(`🚨 VERIFICACIÓN FALLIDA: ${scriptName} - ${verifyError.message}`);
                    return { success: false, error: ERROR_INTEGRIDAD };
                }
            } else {
                // Q6 (2026-07-30, C3/F4): el backend SIEMPRE firma (Fase 1 de este
                // mismo plan, ya en producción desde 2026-07-29). Un script sin
                // datos de firma indica un problema real del servidor, no un caso
                // normal a tolerar.
                this.securityAudit.logVerificationSkipped(scriptName, 'Sin datos de firma del servidor');
                console.error(`🚨 SCRIPT SIN FIRMA DIGITAL: ${scriptName} - rechazado`);
                return { success: false, error: ERROR_INTEGRIDAD };
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

    // E2-4 (revisión E2, Bloque D): eliminado el método executeScript() — corría scripts en
    // un vm.createContext sandboxeado (this.scriptExecutor), pero puppeteer.launch() no puede
    // correr funcionalmente dentro de ese sandbox. Ningún handler de main.js lo invocaba
    // (verificado por grep); todos los flujos reales usan executeRemoteScriptAsLocal() más
    // abajo, que hace fork() de un proceso hijo real. Vestigio de una arquitectura de
    // ejecución anterior — ver también la eliminación de ScriptExecutor en el constructor.

    /**
     * ✅ NUEVO: Ejecutar script con child_process (Puppeteer scripts)
     * CON TODAS LAS MEJORAS DE SEGURIDAD
     */
    async executeRemoteScriptAsLocal(scriptName, args = [], options = {}) {
        const { fork } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        const { cuitOverride, extraFiles, processLabel, silentStart, silentComplete } = options;

        return new Promise(async (resolve, reject) => {
            try {
                console.log(`\n🚀 Iniciando ejecución segura de: ${scriptName}`);

                // ✅ NOTIFICACIÓN: Proceso iniciado.
                // Muestra la etiqueta amigable del tipo de proceso (processLabel),
                // con respaldo al mapeo por nombre de script. silentStart la omite
                // (ej: lote de informes, que dispara una sola notificación global).
                if (!silentStart) {
                    this.notificationManager.notifyProcessStarted(processLabel || scriptName);
                    this.securityMetrics.recordNotification();
                }

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
                                // Q6 (2026-07-30, C6/F5): antes se descartaba el resultado — si
                                // la verificación fallaba, loadScript() ya rechazaba por efecto
                                // colateral (la caché quedaba vacía y el `if (!code)` de abajo
                                // rechazaba), pero con un mensaje genérico que perdía la causa real.
                                const loadResult = await this.loadScript(scriptName);
                                if (!loadResult.success) {
                                    return reject({ success: false, error: loadResult.error || ERROR_INTEGRIDAD });
                                }
                                code = this.scriptCache.get(scriptName);
                            }
                        } catch (e) {
                            // Si falla la verificación, usar caché (degradación elegante)
                            console.warn(`⚠️ No se pudo verificar versión de ${scriptName}, usando caché:`, e.message);
                        }
                    }
                } else {
                    // No está en caché: descargar
                    const loadResult = await this.loadScript(scriptName);
                    if (!loadResult.success) {
                        return reject({ success: false, error: loadResult.error || ERROR_INTEGRIDAD });
                    }
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
                            // F6 (2026-08-31): el tercer call site de loadScript() que
                            // C6/F5 de Q6 no alcanzó — descartaba el resultado. Si la
                            // firma de una dependencia era rechazada, la caché quedaba
                            // vacía, el `if (depCode)` de abajo la salteaba EN SILENCIO
                            // y el script principal se ejecutaba igual: abría Chrome,
                            // consumía el lock, y recién explotaba al hacer require()
                            // de un módulo inexistente, con un error que no decía nada
                            // de integridad. Y `testM2.js` —la librería núcleo de la que
                            // dependen los 6 scripts— entra por acá.
                            const depResult = await this.loadScript(dep);
                            if (!depResult.success) {
                                console.error(`🚨 DEPENDENCIA RECHAZADA: ${dep} (de ${scriptName}) - ${depResult.error}`);
                                return reject({ success: false, error: depResult.error || ERROR_INTEGRIDAD });
                            }
                            depCode = this.scriptCache.get(dep);
                        }
                        if (!depCode) {
                            // loadScript() dijo success pero la caché no tiene el código:
                            // estado incoherente, no se puede afirmar que la dependencia
                            // sea legítima. Mismo criterio fail-closed de las 3 etapas.
                            console.error(`🚨 DEPENDENCIA NO DISPONIBLE TRAS CARGA: ${dep} (de ${scriptName})`);
                            return reject({ success: false, error: ERROR_INTEGRIDAD });
                        }
                        {
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
                        return reject({ success: false, error: ERROR_INTEGRIDAD });
                    }
                    // Q6 (2026-07-30, C5/F2): fail-CLOSED, mismo criterio que la etapa 1.
                    console.error(`🚨 ERROR EN VERIFICACIÓN ETAPA 2: ${scriptName} - ${checksumError.message}`);
                    return reject({ success: false, error: ERROR_INTEGRIDAD });
                }

                // ✅ 6b. SEGURIDAD: Encriptar script principal con GCM
                console.log(`🔒 Encriptando ${scriptName}...`);
                const encryptionResult = this.fileEncryption.encrypt(code);

                // Guardar archivo encriptado con authTag
                const encScriptPath = path.join(tempDir, `${scriptName}.enc`);
                const encryptedContent = `${encryptionResult.encrypted}|||${encryptionResult.authTag}`;
                fs.writeFileSync(encScriptPath, encryptedContent, 'utf8');

                // Q6 (Fase 3, C7/F6): hash del contenido cifrado tal como quedó
                // escrito en disco, calculado en el momento de la escritura. La
                // ETAPA 3 (más abajo) relee este mismo archivo del disco y compara
                // contra este hash — antes comparaba la caché en RAM contra el
                // hash de esa misma RAM ("diskCode" nunca tocaba el disco), así
                // que siempre pasaba y no defendía la ventana que dice cubrir
                // (manipulación del .enc entre esta escritura y el fork() de abajo).
                const encDiskHash = this.scriptVerifier.calculateChecksum(encryptedContent);

                // Crear wrapper que desencripta
                const wrapperCode = this.fileEncryption.createWrapperScript(`${scriptName}.enc`);
                const tempScriptPath = path.join(tempDir, scriptName);
                fs.writeFileSync(tempScriptPath, wrapperCode, 'utf8');

                // F6 (2026-08-31): mismo hash-al-escribir que Q6/C7-F6 hizo para el .enc,
                // pero sobre el WRAPPER — que es el archivo que fork() ejecuta realmente.
                // La etapa 3 verificaba el .enc (datos) y dejaba sin verificar el .js
                // (código): un atacante capaz de reescribir el .enc en esa ventana —el
                // modelo de amenaza que la propia etapa 3 declara defender— puede reescribir
                // el wrapper, que además corre con DECRYPT_KEY/DECRYPT_IV en su env y con
                // NODE_PATH apuntando a los node_modules de la app. El .enc está autenticado
                // por GCM (manipularlo sin la clave de sesión hace fallar el descifrado);
                // el wrapper es texto plano y no lo protegía nada.
                const wrapperDiskHash = this.scriptVerifier.calculateChecksum(wrapperCode);

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
                // Q6 (Fase 3, C7/F6): relee el .enc DEL DISCO (no de scriptCache/RAM,
                // como hacía antes bajo el nombre engañoso "diskCode") y lo compara
                // contra encDiskHash, calculado al escribirlo unas líneas arriba.
                // Esto sí verifica lo que la etapa dice verificar: que el archivo
                // que va a ejecutar fork() no fue manipulado entre la escritura y
                // este punto.
                try {
                    const encOnDisk = fs.readFileSync(encScriptPath, 'utf8');
                    const diskChecksum = this.scriptVerifier.calculateChecksum(encOnDisk);

                    if (diskChecksum !== encDiskHash) {
                        this.securityAudit.logChecksumMismatch(scriptName, 3, {
                            expected: encDiskHash,
                            actual: diskChecksum
                        });
                        console.error(`🚨 CHECKSUM ETAPA 3 FALLIDO (archivo en disco manipulado): ${scriptName}`);
                        return reject({ success: false, error: ERROR_INTEGRIDAD });
                    }

                    // F6: y el wrapper, que es lo que fork() ejecuta. Sin esto la etapa 3
                    // verificaba el archivo de datos y dejaba pasar el de código.
                    const wrapperOnDisk = fs.readFileSync(tempScriptPath, 'utf8');
                    const wrapperChecksum = this.scriptVerifier.calculateChecksum(wrapperOnDisk);

                    if (wrapperChecksum !== wrapperDiskHash) {
                        this.securityAudit.logChecksumMismatch(scriptName, 3, {
                            expected: wrapperDiskHash,
                            actual: wrapperChecksum
                        });
                        console.error(`🚨 CHECKSUM ETAPA 3 FALLIDO (wrapper en disco manipulado): ${scriptName}`);
                        return reject({ success: false, error: ERROR_INTEGRIDAD });
                    }

                    this.securityAudit.logScriptVerified(scriptName, { stage: 3 });
                    console.log(`✅ [ScriptVerifier] Checksum Etapa 3 OK (disco: .enc + wrapper): ${scriptName}`);
                } catch (checksumError) {
                    // Q6 (2026-07-30, C5/F3): fail-CLOSED, mismo criterio que las etapas 1 y 2.
                    // Cubre también un fallo de fs.readFileSync (ej: el .enc no está
                    // donde debería) — no se puede afirmar que el script sea legítimo.
                    console.error(`🚨 ERROR EN VERIFICACIÓN ETAPA 3: ${scriptName} - ${checksumError.message}`);
                    return reject({ success: false, error: ERROR_INTEGRIDAD });
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

                child.on('close', async (code, signal) => {
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
                        // Los scripts escriben directo en la carpeta final del usuario vía
                        // getDataPath()/PROCURADOR_DATA_DIR, por lo que tempDir/descargas casi
                        // nunca existe. Solo copiamos si realmente hay algo, y al destino correcto
                        // (la carpeta del usuario por CUIT), SIN crear una carpeta raíz vacía.
                        const tempDescargasPath = path.join(tempDir, 'descargas');

                        if (fs.existsSync(tempDescargasPath)) {
                            const userBase = (options.extraEnv && options.extraEnv.PROCURADOR_DATA_DIR) || app.getPath('userData');
                            const finalDescargasPath = path.join(userBase, 'descargas');
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
                    // E2-6 (revisión E2, Bloque D): antes intentaba leer estadísticas
                    // detalladas desde tempDir/descargas/procesos_automaticos/*.json —
                    // esa subcarpeta se eliminó en la unificación de nombres de v2.7.33
                    // (los scripts escriben directo en 'descargas', sin subcarpeta
                    // intermedia), así que ese lookup siempre fallaba y caía en el catch.
                    // Desde acá no hay forma de conocer cuántos expedientes procesó el
                    // script, así que se informa solo lo que sí se sabe (qué proceso fue
                    // y cuánto tardó); notifyProcessComplete omite las cantidades cuando
                    // no se le pasan, en vez de imprimir ceros.
                    //
                    // silentComplete: el llamador se hace cargo de la notificación final.
                    // Lo usa el informe por lote, que invoca este método UNA VEZ POR
                    // EXPEDIENTE — sin esta guarda disparaba un toast de cierre por cada
                    // uno. Es la contraparte de silentStart, que en v2.7.34 resolvió el
                    // mismo spam del lado de la notificación de inicio.
                    if (!silentComplete) {
                        if (code === 0) {
                            this.notificationManager.notifyProcessComplete({
                                tiempo: totalTime,
                                label: this.notificationManager.friendlyLabel(processLabel || scriptName)
                            });
                        } else {
                            this.notificationManager.notifyError(`Proceso terminó con código ${code}`);
                        }
                        this.securityMetrics.recordNotification();
                    }

                    // ✅ 12. Limpieza de carpeta temporal (diferida)
                    setTimeout(async () => {
                        await this.secureTempFolder.deleteSecureFolder(tempDir);
                    }, 2000); // Esperar 2 segundos antes de eliminar

                    // 13. Reportar ejecución al backend (incrementa usage_count en BD)
                    try {
                        const subsystem = getSubsystemForScript(scriptName);

                        // El informe puede terminar con código 0 sin haber generado
                        // ningún PDF (expediente inexistente, navegador cerrado) — ese
                        // caso NO debe consumir cupo de informe_usage. El backend ya
                        // respeta el flag `success` que se le manda acá (no incrementa
                        // si es false); antes se mandaba siempre `code === 0`, así que
                        // consumía cupo igual. Mismo helper que usa main.js para el
                        // reporte visual (motivoInformeSinPDF.js), para no duplicar el
                        // parseo del RESULT.
                        const motivoSinInforme = (subsystem === 'informe' && code === 0)
                            ? motivoInformeSinPDF(output)
                            : null;
                        const exitosoReal = code === 0 && !motivoSinInforme;

                        await this.backendClient.logExecution(
                            scriptName,
                            exitosoReal,
                            motivoSinInforme || (code !== 0 ? `Proceso terminó con código ${code}` : null),
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

                        // F6 (2026-08-31): acá había un clearAllRegistries(). Borraba el
                        // ancla de la etapa 1 mientras scriptCache CONSERVABA el código
                        // (esa caché solo se limpia en logout), así que en la 2ª ejecución
                        // del mismo script en la misma sesión el código salía de caché sin
                        // volver a pasar por etapa 1 y la etapa 2 caía en su rama
                        // "No hay registro de etapa 1... Usando checksum actual": comparaba
                        // el contenido contra el hash de ese mismo contenido y devolvía
                        // valid:true SIEMPRE, incluso sobre código adulterado (verificado
                        // con el ScriptVerifier real, sin mocks). Es el mismo defecto que
                        // Q6/C7-F6 corrigió en la etapa 3, sobreviviendo en la etapa 2 por
                        // otra vía: no por el código de la etapa, sino por cuándo el
                        // llamador borraba el ancla.
                        // El registro se limpia ahora en logout(), junto con la caché, para
                        // que ancla y código vivan y mueran juntos — que es la invariante
                        // que la etapa 2 necesita para verificar algo. Cuando el servidor
                        // publica una versión nueva, scriptCache.delete() + loadScript()
                        // re-anclan solos con el checksum nuevo. Costo en memoria: 13
                        // entradas de metadata, unos pocos KB.

                        resolve({ success: true, output, executionTime: totalTime });
                    } else {
                        console.error(`❌ Proceso terminó con código ${code}${signal ? ` (señal ${signal})` : ''}`);
                        reject({
                            success: false,
                            // M10: si terminó por señal (ej. SIGTERM de una detención voluntaria),
                            // el mensaje la refleja para que isSigtermError la reconozca como
                            // "detenido" y no como fallo.
                            error: signal ? `Proceso terminado por señal ${signal}` : `Código ${code}`,
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

            // F6 (2026-08-31): el ancla de checksums se limpia JUNTO con la caché, no
            // al terminar cada ejecución. Mientras haya código cacheado tiene que haber
            // ancla contra la cual verificarlo — ver el comentario largo en el handler
            // de cierre de executeRemoteScriptAsLocal().
            this.scriptVerifier.clearAllRegistries();

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
            // E2-4: 'executor' (this.scriptExecutor.getStats()) eliminado junto con
            // ScriptExecutor — sin consumidor (verificado por grep en renderer.js/main.js).
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