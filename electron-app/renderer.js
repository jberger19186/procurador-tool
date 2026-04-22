// ============ ESTADO GLOBAL ============
let isProcessRunning = false;
let currentConfig = null;
let consoleExpanded = false;
let isWindowPositioned = false; // ✅ AÑADIR ESTA LÍNEA

// ============ INICIALIZACIÓN ============
// ── Tooltip portal (escapa overflow de modales) ──────────────────────────────
(function setupTooltipPortal() {
    const portal = document.getElementById('tooltip-portal');
    if (!portal) return;
    let hideTimer = null;

    document.addEventListener('mouseover', (e) => {
        const icon = e.target.closest('.tooltip-icon');
        if (!icon) return;
        const tip = icon.dataset.tip;
        if (!tip) return;

        clearTimeout(hideTimer);
        portal.textContent = tip;
        portal.style.display = 'block';

        const rect = icon.getBoundingClientRect();
        const pw = 260;
        let left = rect.left + rect.width / 2 - pw / 2;
        let top  = rect.top - 8; // arriba del ícono, se ajusta abajo

        // No salir por la derecha
        if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
        // No salir por la izquierda
        if (left < 8) left = 8;

        portal.style.maxWidth = pw + 'px';
        portal.style.left = left + 'px';

        // Calcular posición vertical tras conocer altura del portal
        requestAnimationFrame(() => {
            const ph = portal.offsetHeight;
            top = rect.top - ph - 7;
            if (top < 8) top = rect.bottom + 7; // si no cabe arriba, va abajo
            portal.style.top = top + 'px';
            portal.classList.add('visible');
        });
    });

    document.addEventListener('mouseout', (e) => {
        if (!e.target.closest('.tooltip-icon')) return;
        hideTimer = setTimeout(() => {
            portal.classList.remove('visible');
            setTimeout(() => { portal.style.display = 'none'; }, 150);
        }, 80);
    });
})();

document.addEventListener('DOMContentLoaded', () => {
    initializeButtons();
    setupSidebar();
    loadConfiguration();
    loadStatistics();
    setupProcessListeners();
    setupModalListeners();
    setupUpdateListeners();
    setupCuentaModal();
    window.electronAPI.getAppVersion().then(v => {
        const el = document.getElementById('appVersionBadge');
        if (el) el.textContent = `v${v}`;
    }).catch(() => {});
    setupInformeModal();
    setupProcurarCustomModal();
    setupMonitorModal();
    updateHeaderInfo(); // Actualizar info del header al inicio
    updateUserChip();   // Poblar user chip del sidebar
    checkQuotaAlert();  // Mostrar banner si cuota >= 80%
    window.electronAPI.getPromoStatus().then(ps => { if (ps) checkPromoAlert(ps); }).catch(() => {});
    addLog('info', 'Sistema iniciado correctamente ✅');
});

// ============ ACCIONES DEL MENÚ NATIVO ============
if (window.electronAPI?.onMenuAction) {
    window.electronAPI.onMenuAction((action) => {
        switch (action) {
            case 'run-process':       runProcess();           break;
            case 'open-downloads':    openDownloadsFolder();  break;
            case 'download-console':  downloadConsole();      break;
            case 'clear-console':     clearConsole();         break;
            case 'position-left':     positionWindowLeft();   break;
            case 'open-support':      openCuentaModal();      break;
            case 'open-stats':        openModal('modalStats');break;
        }
    });
}

// ============ TOUR POST-WIZARD ============
if (window.electronAPI?.onShowTour) {
    window.electronAPI.onShowTour(() => {
        if (typeof window.startAppTour === 'function') {
            window.startAppTour();
        }
    });
}

if (window.electronAPI?.onSkipTour) {
    window.electronAPI.onSkipTour(() => {
        localStorage.setItem('psc_tour_shown', '1');
    });
}

// ============ ACTUALIZACIONES ============
function setupUpdateListeners() {
    if (!window.electronAPI?.onUpdateAvailable) return;

    // Nueva versión detectada → informar en consola mientras descarga en background
    window.electronAPI.onUpdateAvailable(({ version }) => {
        removeUpdateLoadingIndicator();
        addLog('info', `🔄 Nueva versión v${version} disponible. Descargando en background...`);
        showUpdateLoadingIndicator(UPDATE_DOWNLOAD_STEPS);
    });

    // Descarga completa → mostrar banner para que el usuario elija cuándo instalar
    window.electronAPI.onUpdateDownloaded(({ version }) => {
        removeUpdateLoadingIndicator();
        addLog('success', `✅ Actualización v${version} descargada y lista para instalar.`);
        showUpdateBanner(version);
    });

    // Sin novedades → eliminar indicador silenciosamente
    if (window.electronAPI?.onUpdateNotAvailable) {
        window.electronAPI.onUpdateNotAvailable(() => {
            removeUpdateLoadingIndicator();
        });
    }
}

function showUpdateBanner(version) {
    const banner = document.getElementById('update-banner');
    const text   = document.getElementById('update-banner-text');
    if (!banner || !text) return;

    text.textContent = `🔄 Nueva versión v${version} descargada. ¿Instalamos ahora?`;
    banner.style.display = 'flex';

    // Instalar ahora: cierra la app, instala y reabre
    document.getElementById('update-install-btn').onclick = async () => {
        addLog('info', '🔄 Instalando actualización y reiniciando la aplicación...');
        await window.electronAPI.installUpdate();
    };

    // Más tarde: se instala automáticamente la próxima vez que el usuario cierre la app
    document.getElementById('update-later-btn').onclick = () => {
        banner.style.display = 'none';
        addLog('info', 'ℹ️ La actualización se instalará automáticamente al cerrar la app.');
    };

}

// ============ INICIALIZAR BOTONES ============
function initializeButtons() {
    // Helper para bindear un botón si existe en el DOM
    function bind(id, fn) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    // Controles de ventana (frameless)
    bind('btnWinMin',   () => window.electronAPI.minimizeWindow());
    bind('btnWinMax',   () => window.electronAPI.maximizeWindow());
    bind('btnWinClose', () => window.electronAPI.closeWindow());
    bind('btnHamburger',() => window.electronAPI.showAppMenu());

    // ── Sidebar toggle (colapsar / expandir) ──
    const mainLayout = document.querySelector('.main-layout');
    const sidebar    = document.querySelector('.sidebar');

    // Restaurar estado guardado
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
        mainLayout?.classList.add('sidebar-collapsed');
    }

    document.getElementById('btnSidebarToggle')?.addEventListener('click', () => {
        const collapsed = mainLayout?.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar-collapsed', collapsed);
        sidebar?.classList.remove('sidebar-peek');
    });

    // Hover-peek: al pasar el cursor por el botón toggle con sidebar colapsado
    let peekLeaveTimer = null;
    document.getElementById('btnSidebarToggle')?.addEventListener('mouseenter', () => {
        if (mainLayout?.classList.contains('sidebar-collapsed')) {
            clearTimeout(peekLeaveTimer);
            sidebar?.classList.add('sidebar-peek');
        }
    });
    sidebar?.addEventListener('mouseleave', () => {
        peekLeaveTimer = setTimeout(() => {
            sidebar?.classList.remove('sidebar-peek');
        }, 200);
    });
    sidebar?.addEventListener('mouseenter', () => {
        clearTimeout(peekLeaveTimer);
    });

    // Botón detener en consola (subtoolbar)
    bind('btnStopProcess', stopProcess);

    // Botón descargar consola
    bind('btnDownloadConsole', downloadConsole);

    // Toggle mostrar/ocultar navegador
    const browserToggle = document.getElementById('browserToggle');
    if (browserToggle) {
        browserToggle.addEventListener('change', () => {
            toggleBrowserVisibility(browserToggle.checked);
        });
    }

    // Botones topbar icon
    bind('btnOpenConfig',  () => { openModal('modalConfig'); iniciarToggleExtension(); });
    bind('btnOpenStats',   () => openModal('modalStats'));
    bind('btnOpenCuenta',  openCuentaModal);

    // Consola
    bind('btnClearConsole',   clearConsole);
    bind('btnExpandConsole',  toggleExpandConsole);
    bind('btnPositionLeft',   positionWindowLeft);

    // Configuración
    document.getElementById('configForm').addEventListener('submit', saveConfiguration);
    bind('btnCancelConfig',  () => closeModal('modalConfig'));

    // Config modal: tab switching
    document.querySelectorAll('.modal-cfg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.modal-cfg-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const name = tab.dataset.cfgTab;
            document.getElementById('cfgTabGeneral').style.display   = name === 'general'   ? '' : 'none';
            document.getElementById('cfgTabExtension').style.display = name === 'extension' ? '' : 'none';
            if (name === 'extension') iniciarToggleExtension();
        });
    });

    // Config modal: toggle click handlers
    document.querySelectorAll('.cfg-toggle-row').forEach(row => {
        row.addEventListener('click', () => {
            const tgl = row.querySelector('.cfg-toggle');
            if (tgl) tgl.classList.toggle('on');
        });
    });

    // Cancelar config (tab general y extensión)
    bind('btnCancelConfig2', () => closeModal('modalConfig'));
    bind('btnCancelConfig3', () => closeModal('modalConfig'));

    // Seguridad — botones dentro del modal de configuración
    bind('btnAbrirNavegador',    abrirNavegadorPJN);
    bind('btnAgregarPasswordSCW', agregarPasswordSCW);
    bind('btnInstalarExtension', descargarExtension);
    bind('btnGenerarPdfExt', () => generarPdfExtension());
    bind('btnAbrirChromeExt', async () => {
        await window.electronAPI.openChromeExtensions();
        const msg = document.getElementById('msgAbrirChromeExt');
        if (msg) msg.style.display = 'block';
    });
    document.getElementById('btnTooltipExtConfig')?.addEventListener('click', () => {
        const t = document.getElementById('tooltipExtConfig');
        if (t) t.style.display = t.style.display === 'none' ? 'block' : 'none';
    });

    // Copiar ruta al portapapeles al hacer clic en el box
    document.getElementById('extPathBox')?.addEventListener('click', () => copiarRutaExtension());

    // Copiar chrome://extensions al portapapeles
    document.getElementById('extChromeExtBox')?.addEventListener('click', () => {
        window.electronAPI.copyToClipboard('chrome://extensions');
        const m = document.getElementById('extChromeExtCopyMsg');
        if (m) { m.style.display = 'inline'; setTimeout(() => m.style.display = 'none', 2000); }
    });

    // Relanzar wizard de configuración inicial
    bind('btnRelanzarWizard', async () => {
        closeModal('modalConfig');
        await window.electronAPI.relaunchOnboarding();
    });

    // Estadísticas
    bind('btnRefreshStats', loadStatistics);

    // Modal fecha personalizada
    bind('btnConfirmCustomDate', runProcessCustomDate);
    bind('btnCancelCustomDate',  () => closeModal('modalCustomDate'));

    // Banner de cuota
    bind('quota-upgrade-btn', () => openCuentaModal());
    bind('quota-dismiss-btn', () => {
        document.getElementById('quota-banner').style.display = 'none';
        quotaBannerDismissed = true;
    });
}

function switchCfgTab(name) {
    document.querySelectorAll('.modal-cfg-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.cfgTab === name);
    });
    document.getElementById('cfgTabGeneral').style.display   = name === 'general'   ? '' : 'none';
    document.getElementById('cfgTabExtension').style.display = name === 'extension' ? '' : 'none';
}

// ============ SIDEBAR ============
function setupSidebar() {
    // Mapa data-action → función
    const actions = {
        'procurar-hoy':   () => runProcess(),
        'procurar-fecha': () => showCustomDateModal(),
        'procurar-lote':  () => showProcurarCustomModal(),
        'informe':        () => openInformeModal(),
        'monitor':        () => openMonitorModal(),
        'visor':          () => viewResults(),
        'excel':          () => viewExcel(),
        'descargas':      () => openDownloadsFolder(),
        'estadisticas':   () => openModal('modalStats'),
        'configuracion':  () => { openModal('modalConfig'); switchCfgTab('general'); iniciarToggleExtension(); },
        'extension':      () => { openModal('modalConfig'); switchCfgTab('extension'); iniciarToggleExtension(); },
        'limpiar-temp':   () => cleanFolder('temp'),
    };

    // Etiquetas del botón principal de la subtoolbar
    const mainLabels = {
        'procurar-hoy':   '▶ Procurar hoy',
        'procurar-fecha': '📅 Procurar fecha',
        'procurar-lote':  '📁 Procurar lote',
        'informe':        '📄 Generar informe',
        'monitor':        '🔍 Abrir monitor',
        'visor':          '👁 Ver resultados',
        'excel':          '📊 Ver Excel',
        'descargas':      '📁 Abrir descargas',
        'estadisticas':   '📈 Estadísticas',
        'configuracion':  '⚙️ Configuración',
        'extension':      '🧩 Extensión PJN',
        'limpiar-temp':   '🗂️ Limpiar temp',
    };

    const allItems = document.querySelectorAll('.sidebar-item[data-action]');
    const btnMain  = document.getElementById('btnMainAction');

    // Mapa acción → tab correspondiente
    const actionToTab = {
        'procurar-hoy':   'tabProcurar',
        'procurar-fecha': 'tabProcurar',
        'procurar-lote':  'tabProcurar',
        'informe':        'tabInforme',
        'monitor':        'tabMonitor',
        'descargas':      'tabDescargas',
    };
    const allTabs = document.querySelectorAll('.tab-btn');

    function activateTab(tabId) {
        allTabs.forEach(t => t.classList.remove('active'));
        if (tabId) document.getElementById(tabId)?.classList.add('active');
    }

    allItems.forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;

            // Marcar activo en sidebar
            allItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Sincronizar tab activo
            activateTab(actionToTab[action] ?? null);

            // Actualizar botón principal de subtoolbar
            if (btnMain && mainLabels[action]) {
                btnMain.textContent  = mainLabels[action];
                btnMain.dataset.fn   = action;
            }

            // Ejecutar acción
            actions[action]?.();
        });
    });

    // Botón principal de la subtoolbar ejecuta la acción del ítem activo
    if (btnMain) {
        btnMain.addEventListener('click', () => {
            const fn = btnMain.dataset.fn || 'procurar-hoy';
            actions[fn]?.();
        });
    }

    // User chip → abrir modal de cuenta
    document.getElementById('userChip')?.addEventListener('click', openCuentaModal);

    // ===== TAB BUTTONS → misma acción que sidebar =====
    const tabMap = {
        'tabProcurar':  'procurar-hoy',
        'tabInforme':   'informe',
        'tabMonitor':   'monitor',
        'tabDescargas': 'descargas',
    };
    Object.entries(tabMap).forEach(([tabId, action]) => {
        document.getElementById(tabId)?.addEventListener('click', () => {
            // Activar tab visualmente
            activateTab(tabId);

            // Sincronizar sidebar: marcar el item correspondiente
            allItems.forEach(i => i.classList.remove('active'));
            document.querySelector(`.sidebar-item[data-action="${action}"]`)?.classList.add('active');

            // Actualizar botón principal de subtoolbar
            if (btnMain && mainLabels[action]) {
                btnMain.textContent = mainLabels[action];
                btnMain.dataset.fn  = action;
            }

            // Ejecutar la misma acción que el sidebar
            actions[action]?.();
        });
    });
}

// ============ USER CHIP (SIDEBAR) ============
async function updateUserChip() {
    try {
        const result = await window.electronAPI.getAccount();
        if (!result?.success || !result.account) return;

        const a = result.account;

        // Nombre: email antes del @, o CUIT si no hay email
        const nameRaw  = a.email ? a.email.split('@')[0] : (a.cuit || '?');
        const nameEl   = document.getElementById('userNameDisplay');
        const planEl   = document.getElementById('userPlanDisplay');
        const initEl   = document.getElementById('userAvatarInitials');

        if (nameEl) nameEl.textContent = nameRaw;
        if (planEl) {
            const planName = (typeof a.plan === 'object' ? a.plan?.displayName || a.plan?.name : a.plan) || '—';
            planEl.textContent = planName;
        }
        if (initEl) initEl.textContent = nameRaw.slice(0, 2).toUpperCase();
    } catch (_) {
        // Silencioso — el chip queda con los defaults del HTML
    }
}

// ============ MENÚ DROPDOWN EJECUTAR ============
function toggleEjecutarMenu() {
    document.getElementById('menuEjecutar').classList.toggle('active');
}
function toggleEjecutarMenu2() {
    const dd = document.getElementById('menuEjecutar2');
    if (dd) dd.classList.toggle('active');
}
function closeEjecutarMenus() {
    document.getElementById('menuEjecutar')?.classList.remove('active');
    document.getElementById('menuEjecutar2')?.classList.remove('active');
}

// ============ MENÚ DROPDOWN DESCARGAS ============
function toggleDescargasMenu() {
    document.getElementById('descargasDropdown').classList.toggle('active');
}
function closeDescargasMenu() {
    document.getElementById('descargasDropdown')?.classList.remove('active');
}

// Dropdown fila 2 (ventana angosta)
function toggleDescargasMenu2() {
    const dd = document.getElementById('descargasDropdown2');
    if (dd) dd.classList.toggle('active');
}
function closeDescargasMenu2() {
    const dd = document.getElementById('descargasDropdown2');
    if (dd) dd.classList.remove('active');
}

// ============ CONSOLA - EXPANDIR/CONTRAER ============
function toggleExpandConsole() {
    const btn = document.getElementById('btnExpandConsole');

    consoleExpanded = !consoleExpanded;

    if (consoleExpanded) {
        document.body.classList.add('console-expanded');
        btn.textContent = '⬆ Expandir';

        // Redimensionar ventana al 50% de altura
        window.electronAPI.resizeWindow(1200, 350);
    } else {
        document.body.classList.remove('console-expanded');
        btn.textContent = '⬇ Contraer';

        // Restaurar tamaño original
        window.electronAPI.resizeWindow(1200, 700);
    }
}

// ============ MODALES ============
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');

    // Cargar estadísticas si se abre el modal de stats
    if (modalId === 'modalStats') {
        loadStatistics();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ============ CONFIGURAR LISTENERS DE MODALES ============
function setupModalListeners() {
    // Obtener todos los modales
    const modals = document.querySelectorAll('.modal');

    modals.forEach(modal => {
        const modalId = modal.id;

        // Listener para el botón X (close)
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeModal(modalId);
            });
        }

        // Listener para click fuera del contenido del modal
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modalId);
            }
        });
    });

    // Listener global para tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Cerrar el modal activo
            const activeModal = document.querySelector('.modal.active');
            if (activeModal) {
                closeModal(activeModal.id);
            }
        }
    });
}

// ============ CONFIGURACIÓN ============
async function loadConfiguration() {
    try {
        addLog('info', '📥 Cargando configuración...');
        const result = await window.electronAPI.loadConfig();

        if (result.success) {
            currentConfig = result.config;
            populateConfigForm(result.config);

            // Cargar CUIT desde la sesión (no desde config local)
            try {
                const sessionInfo = await window.electronAPI.verifySession();
                const cuitField = document.getElementById('identificador');
                if (cuitField) {
                    cuitField.value = sessionInfo?.user?.cuit || '(sin CUIT registrado)';
                }
            } catch (_) { /* no bloquear si falla */ }

            addLog('success', '✅ Configuración cargada correctamente');
            showUpdateLoadingIndicator(UPDATE_CHECK_STEPS);
        } else {
            addLog('error', `❌ Error al cargar configuración: ${result.error}`);
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
    }
}

function populateConfigForm(config) {
    document.getElementById('fechaLimite').value = config.general.fechaLimite || '';
    // identificador es readonly y se carga desde la sesión (ver loadConfiguration)
    // maxMovimientos y buscarEnTodos ya no tienen campo en el formulario; se preservan desde config

    function setTgl(id, val) {
        document.getElementById(id)?.querySelector('.cfg-toggle')?.classList.toggle('on', !!val);
    }
    setTgl('tgl-seccionLetrado',          config.secciones.letrado || false);
    setTgl('tgl-seccionParte',            config.secciones.parte || false);
    setTgl('tgl-seccionAutorizado',       config.secciones.autorizado || false);
    setTgl('tgl-seccionFavoritos',        config.secciones.favoritos || false);
    setTgl('tgl-notificacionesActivadas', config.notificaciones.activadas || false);
    setTgl('tgl-generarExcel',            config.excel.generar || false);
    setTgl('tgl-abrirVisor',              config.visor.abrirAutomaticamente || false);
    setTgl('tgl-modoHeadless',            config.seguridad?.modoHeadless || false);
}

function getTgl(id) {
    return document.getElementById(id)?.querySelector('.cfg-toggle')?.classList.contains('on') ?? false;
}

async function saveConfiguration(e) {
    e.preventDefault();

    try {
        const config = {
            general: {
                fechaLimite: document.getElementById('fechaLimite').value,
                // identificador no se guarda desde la UI (viene de la BD, asignado por admin)
                identificador: currentConfig?.general?.identificador || '',
                maxMovimientos: currentConfig?.general?.maxMovimientos || 15,
                buscarEnTodos: currentConfig?.general?.buscarEnTodos || false
            },
            opciones: {
                descargarArchivos: currentConfig?.opciones?.descargarArchivos || false,
                incluirHistoricos: currentConfig?.opciones?.incluirHistoricos || false,
                incluirHrefs: currentConfig?.opciones?.incluirHrefs || false,
                formatoSalida: currentConfig?.opciones?.formatoSalida || 'ambos'
            },
            secciones: {
                letrado:    getTgl('tgl-seccionLetrado'),
                parte:      getTgl('tgl-seccionParte'),
                autorizado: getTgl('tgl-seccionAutorizado'),
                favoritos:  getTgl('tgl-seccionFavoritos'),
            },
            visor: {
                abrirAutomaticamente: getTgl('tgl-abrirVisor'),
                navegadorPredeterminado: currentConfig?.visor?.navegadorPredeterminado || true
            },
            notificaciones: {
                activadas: getTgl('tgl-notificacionesActivadas'),
                sonido: currentConfig?.notificaciones?.sonido || true
            },
            email: currentConfig?.email || {
                activado: false,
                destinatario: '',
                smtp: {}
            },
            excel: {
                generar: getTgl('tgl-generarExcel'),
                incluirMovimientos: currentConfig?.excel?.incluirMovimientos || true
            },
            programacion: currentConfig?.programacion || {
                activada: false,
                hora: '08:00',
                dias: []
            },
            seguridad: {
                modoHeadless: getTgl('tgl-modoHeadless'),
            }
        };

        addLog('info', '💾 Guardando configuración...');
        const result = await window.electronAPI.saveConfig(config);

        if (result.success) {
            currentConfig = config;
            addLog('success', '✅ Configuración guardada correctamente');
            showNotification('Configuración guardada', 'success');
            closeModal('modalConfig');
        } else {
            addLog('error', `❌ Error al guardar: ${result.error}`);
            showNotification('Error al guardar configuración', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        showNotification('Error inesperado', 'error');
    }
}

// ============ PROCESOS ============
async function runProcess() {
    if (isProcessRunning) {
        showNotification('Ya hay un proceso en ejecución', 'warning');
        return;
    }

    try {
        // Auto-posicionar solo cuando headless está OFF (con headless ON lo maneja el toggle)
        if (!currentConfig?.seguridad?.modoHeadless && !isWindowPositioned) {
            addLog('info', '📐 Posicionando ventana a la derecha...');
            await window.electronAPI.positionLeft();
            isWindowPositioned = true;
            document.body.classList.add('window-positioned');
            const btn = document.getElementById('btnPositionLeft');
            if (btn) { btn.textContent = '◨ Restaurar'; btn.title = 'Restaurar ventana al centro'; }
        }

        addLog('info', '🚀 Iniciando proceso automático...');
        addLog('info', '⏳ Preparando navegador Chrome... esto puede demorar unos segundos');
        showChromeLoadingIndicator();
        setProcessRunning(true);

        const result = await window.electronAPI.runProcess();

        if (!result.success) {
            addLog('error', `❌ Error: ${result.error}`);
            setProcessRunning(false);
            showNotification('Error al iniciar proceso', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        setProcessRunning(false);
        showNotification('Error inesperado', 'error');
    }
}

function showCustomDateModal() {
    openModal('modalCustomDate');
    document.getElementById('inputCustomDate').value = '';
    document.getElementById('inputCustomDate').focus();
}

async function runProcessCustomDate() {
    const fecha = document.getElementById('inputCustomDate').value.trim();

    const regex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!regex.test(fecha)) {
        showNotification('Formato de fecha inválido (use DD/MM/YYYY)', 'error');
        return;
    }

    closeModal('modalCustomDate');

    if (isProcessRunning) {
        showNotification('Ya hay un proceso en ejecución', 'warning');
        return;
    }

    try {
        if (!currentConfig?.seguridad?.modoHeadless && !isWindowPositioned) {
            addLog('info', '📐 Posicionando ventana a la derecha...');
            await window.electronAPI.positionLeft();
            isWindowPositioned = true;
            document.body.classList.add('window-positioned');
            const btn = document.getElementById('btnPositionLeft');
            if (btn) { btn.textContent = '◨ Restaurar'; btn.title = 'Restaurar ventana al centro'; }
        }

        addLog('info', `📅 Iniciando proceso con fecha personalizada: ${fecha}...`);
        addLog('info', '⏳ Preparando navegador Chrome... esto puede demorar unos segundos');
        showChromeLoadingIndicator();
        setProcessRunning(true);

        const result = await window.electronAPI.runProcessCustomDate(fecha);

        if (!result.success) {
            addLog('error', `❌ Error: ${result.error}`);
            setProcessRunning(false);
            showNotification('Error al iniciar proceso', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        setProcessRunning(false);
        showNotification('Error inesperado', 'error');
    }
}

async function listExpedientes() {
    if (isProcessRunning) {
        showNotification('Ya hay un proceso en ejecución', 'warning');
        return;
    }

    if (!currentConfig) {
        showNotification('Cargue la configuración primero', 'warning');
        return;
    }

    try {
        const fechaLimite = currentConfig.general.fechaLimite;
        addLog('info', `📋 Listando expedientes desde ${fechaLimite}...`);
        setProcessRunning(true);

        const result = await window.electronAPI.listExpedientes(fechaLimite);

        if (!result.success) {
            addLog('error', `❌ Error: ${result.error}`);
            setProcessRunning(false);
            showNotification('Error al listar expedientes', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        setProcessRunning(false);
        showNotification('Error inesperado', 'error');
    }
}

async function stopProcess() {
    if (!isProcessRunning) {
        showNotification('No hay ningún proceso en ejecución', 'warning');
        return;
    }

    try {
        addLog('warning', '🛑 Deteniendo proceso...');
        const result = await window.electronAPI.stopProcess();

        if (result.success) {
            addLog('info', '✅ Proceso detenido');
            setProcessRunning(false);
            showNotification('Proceso detenido', 'info');
            hideProgressBar();
        } else {
            addLog('error', `❌ Error: ${result.error}`);
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
    }
}

// ============ ARCHIVOS ============
async function viewResults() {
    try {
        addLog('info', '📄 Buscando visor HTML...');

        const result = await window.electronAPI.getVisorPath();

        if (result.success) {
            const openResult = await window.electronAPI.openFile(result.path);

            if (openResult.success) {
                addLog('success', '✅ Visor HTML abierto correctamente');
                showNotification('Visor abierto', 'success');
            } else {
                addLog('error', `❌ Error al abrir: ${openResult.error}`);
                showNotification('Error al abrir visor', 'error');
            }
        } else {
            addLog('error', `❌ ${result.error}`);
            showNotification('Archivo no encontrado', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        showNotification('Error inesperado', 'error');
    }
}

async function viewExcel() {
    try {
        addLog('info', '📊 Buscando archivo Excel...');

        const result = await window.electronAPI.getLatestExcel();

        if (result.success) {
            const openResult = await window.electronAPI.openFile(result.path);

            if (openResult.success) {
                addLog('success', `✅ Excel abierto: ${result.filename}`);
                showNotification('Excel abierto', 'success');
            } else {
                addLog('error', `❌ Error al abrir: ${openResult.error}`);
                showNotification('Error al abrir Excel', 'error');
            }
        } else {
            addLog('error', `❌ ${result.error}`);
            showNotification('No hay archivos Excel', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        showNotification('Error inesperado', 'error');
    }
}

async function openDownloadsFolder() {
    try {
        addLog('info', '📁 Abriendo carpeta de descargas...');

        const result = await window.electronAPI.openDownloadsFolder();

        if (result.success) {
            addLog('success', '✅ Carpeta de descargas abierta');
            showNotification('Carpeta abierta', 'success');
        } else {
            addLog('error', `❌ Error: ${result.error}`);
            showNotification('Error al abrir carpeta', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        showNotification('Error inesperado', 'error');
    }
}

async function cleanFolder(type) {
    const messages = {
        temp: '¿Eliminar todas las carpetas *_temp?',
        procesos: '¿Eliminar carpeta procesos_automaticos completa?',
        all: '¿Eliminar TODO el contenido de descargas?'
    };

    if (!confirm(messages[type])) {
        return;
    }

    try {
        addLog('info', `🗑️ Limpiando (${type})...`);
        const result = await window.electronAPI.cleanFolder(type);

        if (result.success) {
            addLog('success', '✅ Limpieza completada');
            showNotification('Carpeta limpiada correctamente', 'success');

            // Actualizar estadísticas si limpiamos procesos
            if (type === 'procesos' || type === 'all') {
                await loadStatistics();
            }
        } else {
            addLog('error', `❌ Error: ${result.error}`);
            showNotification('Error al limpiar', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
    }
}

// ============ ESTADÍSTICAS ============
async function loadStatistics() {
    try {
        const result = await window.electronAPI.getStats();

        if (result.success) {
            const stats = result.stats;

            document.getElementById('statProcuracion').textContent = stats.procuracion ?? 0;
            document.getElementById('statInformes').textContent    = stats.informes    ?? 0;
            document.getElementById('statMonitoreo').textContent   = stats.monitoreo   ?? 0;
            document.getElementById('statTasaExito').textContent   = `${stats.tasaExito}%`;

            if (stats.ultimoProcesoTimestamp) {
                const fecha = new Date(stats.ultimoProcesoTimestamp);
                document.getElementById('statUltimoProceso').textContent =
                    fecha.toLocaleString('es-AR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    });
            } else {
                document.getElementById('statUltimoProceso').textContent = '-';
            }

            addLog('info', '📊 Estadísticas actualizadas');
        }
    } catch (error) {
        addLog('error', `❌ Error al cargar estadísticas: ${error.message}`);
    }
}

function hideProgressBar(reason) {
    const wrap  = document.getElementById('batch-progress-wrap');
    const bar   = document.getElementById('batch-progress-bar');
    const label = document.getElementById('batch-progress-label');
    const eta   = document.getElementById('batch-progress-eta');
    if (!wrap) return;
    bar.classList.remove('indeterminate');
    if (reason === 'stopped') {
        wrap.style.display = 'none';
        bar.style.width = '0%';
    } else {
        bar.style.width = '100%';
        if (label) label.textContent = '¡Completado!';
        if (eta) eta.textContent = '';
        setTimeout(() => { wrap.style.display = 'none'; bar.style.width = '0%'; }, 2500);
    }
}

// ============ LISTENERS DE PROCESOS ============
function setupProcessListeners() {
    window.electronAPI.onProcessLog((log) => {
        addLog(log.type, log.text);
    });

    window.electronAPI.onBatchProgress((data) => {
        const wrap  = document.getElementById('batch-progress-wrap');
        const bar   = document.getElementById('batch-progress-bar');
        const label = document.getElementById('batch-progress-label');
        const eta   = document.getElementById('batch-progress-eta');
        if (!wrap) return;

        // Modo: finalizado (normal o detenido)
        if (data.done) {
            hideProgressBar(data.stopped ? 'stopped' : 'done');
            return;
        }

        wrap.style.display = 'block';

        // Modo: indeterminado (Procurar / Monitor)
        if (data.indeterminate) {
            bar.style.width = '';  // limpiar inline width para que CSS tome control
            bar.classList.add('indeterminate');
            label.textContent = data.label || 'Procesando...';
            eta.textContent = '';
            return;
        }

        // Modo: progreso exacto (batch Informe) — barra animada + texto de progreso
        const { current, total, startTime } = data;
        if (!total) { wrap.style.display = 'none'; return; }

        bar.style.width = '';
        bar.classList.add('indeterminate');
        label.textContent = `Procesando ${current} de ${total} expedientes`;
        eta.textContent = '';
    });

    window.electronAPI.onProcessMessage((message) => {
        console.log('Process message:', message);

        // Actualizar header info si hay progreso
        if (message.progress) {
            updateHeaderProgress(message.progress);
        }

        // Actualizar info de sesión si viene en el mensaje
        if (message.session) {
            const headerSession = document.getElementById('headerSession');
            headerSession.textContent = `Sesión: ${message.session}`;
        }
    });

    // Notificación cuando el script requiere ingreso manual de contraseña en Chrome
    window.electronAPI.onLoginManualRequired((data) => {
        showLoginManualAlert(data.cuit, data.message);
    });

    // El navegador se reinició durante un reintento → queda oculto → sincronizar toggle
    window.electronAPI.onBrowserRestarted(() => {
        const toggleInput = document.getElementById('browserToggle');
        if (toggleInput && toggleInput.checked) {
            toggleInput.checked = false;
            // Restaurar ventana Electron al centro (ya no hay Chrome al lado)
            toggleBrowserVisibility(false);
            addLog('info', '🔄 Navegador reiniciado — toggle reseteado');
        }
    });

    // Notificación cuando termina la generación de reportes batch de informe
    window.electronAPI.onInformeBatchComplete(async (data) => {
        const { rutaExcel, rutaHTML, total, exitosos } = data;
        addLog('success', `✅ Reportes batch generados (${exitosos}/${total} expedientes)`);
        if (rutaExcel) addLog('info', `📊 Excel generado: ${rutaExcel}`);
        if (rutaHTML)  addLog('info', `🌐 Visor HTML generado: ${rutaHTML}`);
        showNotification(`Reportes batch generados: ${exitosos}/${total} expedientes`, 'success');
    });

    window.electronAPI.onProcessFinished((result) => {
        // Remover alerta de login manual si quedó visible
        const manualAlert = document.getElementById('__psc_manual_alert');
        if (manualAlert) manualAlert.remove();

        setProcessRunning(false);

        // isInformeBatch viene directamente del evento (sin depender de flag de módulo)
        const isInformeBatch = !!result.isInformeBatch;
        const isInforme      = !!result.isInforme;
        const isMonitor      = !!result.isMonitor;

        if (result.success) {
            // Para batch informe, el mensaje de éxito ya lo muestra onInformeBatchComplete
            if (!isInformeBatch) {
                addLog('success', '✅ Proceso completado exitosamente');
                showNotification('Proceso completado', 'success');
            }
            loadStatistics();

            if (isMonitor) {
                // Reabrir modal con estado actualizado
                const esInicial = result.monitorModo === 'inicial';
                openMonitorModal(esInicial);  // pasa flag para auto-abrir expedientes si es inicial
                if (result.monitorModo === 'novedades') {
                    setTimeout(() => switchMonitorTab('monitor-novedades'), 300);
                }
            } else if (!isInforme) {
                // Abrir visor de procuración (solo para Ejecutar/Procurar, nunca para Informe)
                const abrirVisorCheck = document.getElementById('abrirVisor');
                if (abrirVisorCheck && abrirVisorCheck.checked) {
                    setTimeout(async () => {
                        try {
                            const visorResult = await window.electronAPI.getVisorPath();
                            if (visorResult.success) {
                                await window.electronAPI.openFile(visorResult.path);
                                addLog('info', '🌐 Visor abierto automáticamente');
                            } else {
                                addLog('warning', `⚠️ Visor no encontrado: ${visorResult.error}`);
                            }
                        } catch (e) {
                            addLog('warning', `⚠️ Error al abrir visor: ${e.message}`);
                        }
                    }, 2000);
                }
            }
        } else if (!isInformeBatch && !result.stopped) {
            addLog('error', `❌ Proceso terminado con código ${result.code}`);
            showNotification('Proceso terminado con errores', 'error');
        }

        // Actualizar contador de ejecuciones en el header (el backend ya lo incrementó)
        updateHeaderUsage();

        // Verificar si se alcanzó el 80% de cuota después de la ejecución
        checkQuotaAlert();
    });
}

// ============ ACTUALIZAR HEADER ============
async function updateHeaderInfo() {
    // Actualizar info de sesión
    const headerSession = document.getElementById('headerSession');
    if (headerSession) {
        headerSession.textContent = 'Sesión: Activa';
    }

    // Obtener datos reales de uso desde el backend
    await updateHeaderUsage();
}

async function updateHeaderUsage() {
    try {
        const textEl  = document.getElementById('topbarProgressText');
        const trackEl = document.getElementById('topbarProgressTrack');
        const fillEl  = document.getElementById('topbarProgressFill');
        const pctEl   = document.getElementById('topbarProgressPct');
        if (!textEl) return;

        function setUsageBar(used, limit) {
            if (limit !== null && limit > 0) {
                const pct = Math.min(100, Math.round((used / limit) * 100));
                textEl.textContent = `${used} / ${limit} ejecuciones`;
                if (trackEl) { trackEl.style.display = ''; }
                if (fillEl)  { fillEl.style.width = `${pct}%`; }
                if (pctEl)   { pctEl.style.display = ''; pctEl.textContent = `${pct}%`; }
            } else {
                // Sin límite: solo texto, sin barra
                textEl.textContent = `${used} ejecuciones`;
                if (trackEl) trackEl.style.display = 'none';
                if (pctEl)   pctEl.style.display   = 'none';
            }
        }

        const result = await window.electronAPI.getAccount();
        if (result && result.success && result.account?.usage) {
            const u = result.account.usage;
            const totalUsed = (u.proc?.used ?? 0) + (u.batch?.used ?? 0)
                            + (u.informe?.used ?? 0) + (u.monitor_novedades?.used ?? 0)
                            + (u.monitor_partes?.used ?? 0);
            const limits = [u.proc?.limit, u.batch?.limit, u.informe?.limit,
                            u.monitor_novedades?.limit, u.monitor_partes?.limit];
            const hasAnyLimit = limits.some(l => l !== null && l !== undefined);
            const totalLimit  = hasAnyLimit ? limits.reduce((a, l) => a + (l ?? 0), 0) : null;
            setUsageBar(totalUsed, totalLimit);
        } else {
            const session = await window.electronAPI.verifySession();
            if (session?.success && session?.subscription) {
                const { usageCount, usageLimit } = session.subscription;
                setUsageBar(usageCount, usageLimit ?? null);
            } else {
                textEl.textContent = '- ejecuciones';
                if (trackEl) trackEl.style.display = 'none';
                if (pctEl)   pctEl.style.display   = 'none';
            }
        }
    } catch (_) {}
}

function updateHeaderProgress(progress) {
    const textEl  = document.getElementById('topbarProgressText');
    const trackEl = document.getElementById('topbarProgressTrack');
    const fillEl  = document.getElementById('topbarProgressFill');
    const pctEl   = document.getElementById('topbarProgressPct');
    if (!textEl) return;

    if (progress.current !== undefined && progress.total !== undefined && progress.total > 0) {
        const pct = Math.round((progress.current / progress.total) * 100);
        textEl.textContent  = `${progress.current} / ${progress.total} expedientes`;
        if (trackEl) { trackEl.style.display = ''; }
        if (fillEl)  { fillEl.style.width = `${pct}%`; }
        if (pctEl)   { pctEl.style.display = ''; pctEl.textContent = `${pct}%`; }
    }
}

// ============ ESTADO DEL PROCESO ============
function setProcessRunning(running) {
    isProcessRunning = running;

    const statusIndicator = document.getElementById('statusIndicator');

    const toggleInput  = document.getElementById('browserToggle');

    if (running) {
        statusIndicator.classList.add('running');
        statusIndicator.querySelector('.status-text').textContent = 'Ejecutando';
        if (toggleInput) toggleInput.checked = false;
    } else {
        statusIndicator.classList.remove('running');
        statusIndicator.querySelector('.status-text').textContent = 'Inactivo';
        updateStatusBar('Inactivo', '');
        // Si el toggle estaba ON al terminar, restaurar ventana Electron
        if (toggleInput?.checked) {
            toggleInput.checked = false;
            window.electronAPI.restoreWindow().catch(() => {});
            isWindowPositioned = false;
            document.body.classList.remove('window-positioned');
            const btn = document.getElementById('btnPositionLeft');
            if (btn) { btn.textContent = '◧ Posicionar'; btn.title = 'Posicionar ventana a la derecha'; }
        }
    }
}

// ── Barra de estado de la consola ───────────────────────────────────────────

/**
 * Actualiza la barra de estado inferior de la consola.
 * @param {string} text  Mensaje a mostrar
 * @param {string} state 'active' | 'warning' | 'success' | 'error' | '' (inactivo)
 */
function updateStatusBar(text, state) {
    const dot  = document.getElementById('csbDot');
    const txt  = document.getElementById('csbText');
    const time = document.getElementById('csbTime');
    if (!dot || !txt || !time) return;

    dot.className = 'csb-dot' + (state ? ` csb-${state}` : '');
    txt.textContent = text;
    time.textContent = state ? new Date().toLocaleTimeString() : '';
}

/**
 * Detecta frases clave en los mensajes de la consola y actualiza la barra de estado.
 * Solo se activa cuando hay un proceso en ejecución.
 */
function detectarEstadoDesdeLog(type, text) {
    if (type === 'error') {
        // Ignorar errores de JS del sitio scrapeado — no son errores del proceso
        if (/Error en la página|Uncaught|TypeError|ReferenceError|SyntaxError/.test(text)) return;
        updateStatusBar('❌ ' + text.slice(0, 80), 'error');
        return;
    }

    // Frases → estado
    const reglas = [
        [/Configurando navegador|Perfil encontrado/,            '🌐 Iniciando navegador Chrome...',              'active'],
        [/Navegando a /,                                         '🌐 ' + text.slice(0, 70),                      'active'],
        [/Página de inicio de sesión|inicio de sesión detectada/,'🔐 Verificando credenciales...',               'active'],
        [/Overlay activo/,                                       '🔒 Navegador bloqueado para automatización...','active'],
        [/Navegador ocultado|movido fuera de pantalla/,          '🫥 Ejecutando en segundo plano...',            'active'],
        [/Contraseña detectada.*Ingresar|clic automático/,       '🔐 Iniciando sesión automáticamente...',       'active'],
        [/Ingreso manual completado|sesión iniciada/i,           '✅ Sesión iniciada correctamente',             'active'],
        [/Login manual requerido|Esperando acción manual/,       '⏳ Esperando contraseña manual en Chrome...',  'warning'],
        [/Navegador restaurado a pantalla/,                      '👁️ Navegador visible',                        'active'],
        [/Sesión válida|identificador coincide/,                 '✅ Sesión activa verificada',                  'active'],
        [/Ordenando expedientes/,                                '📋 Ordenando y contando expedientes...',       'active'],
        [/Total de páginas|páginas detectadas/,                  '📋 ' + text.slice(0, 70),                     'active'],
        [/Iterando|Procesando expediente|procesando página/i,    '⚙️ ' + text.slice(0, 70),                     'active'],
        [/Guardando lista|Guardando resultados|guardando/i,      '💾 Guardando resultados...',                   'active'],
        [/Generando Excel|Generando PDF|Generando visor/i,       '📊 ' + text.slice(0, 70),                     'active'],
        [/completado con éxito|completado exitosamente/i,        '✅ Proceso completado',                        'success'],
        [/PROGRESS:\s*(\d+)\/(\d+)/,                             null,                                          'active'],
    ];

    for (const [patron, mensaje, estado] of reglas) {
        if (patron.test(text)) {
            // Caso especial: extraer progreso numérico
            if (patron.source.includes('PROGRESS')) {
                const m = text.match(/(\d+)\/(\d+)/);
                if (m) updateStatusBar(`⚙️ Procesando expediente ${m[1]} de ${m[2]}...`, 'active');
            } else {
                updateStatusBar(mensaje, estado);
            }
            return;
        }
    }
}

// ============ CONSOLA ============
const UPDATE_CHECK_STEPS = [
    'Verificando actualizaciones disponibles...',
    'Conectando con el servidor de actualizaciones...',
    'Comprobando versión actual...',
    'Validando integridad del paquete...',
];
const UPDATE_DOWNLOAD_STEPS = [
    'Preparando descarga de la actualización...',
    'Descargando archivos del paquete...',
    'Verificando integridad de la descarga...',
    'Finalizando descarga en background...',
];
let _updateLoadingInterval = null;
let _updateLoadingStepIdx  = 0;
let _updateLoadingTimeout  = null;

function showUpdateLoadingIndicator(steps) {
    removeUpdateLoadingIndicator();
    const out = document.getElementById('consoleOutput');
    if (!out) return;
    const el = document.createElement('div');
    el.id = 'updateLoadingIndicator';
    el.className = 'chrome-loading-indicator';
    el.innerHTML = `
        <div class="chrome-loading-steps">
            <div class="chrome-loading-dots"><span></span><span></span><span></span></div>
            <span class="chrome-loading-step-text" id="updateLoadingStepText">${steps[0]}</span>
        </div>
        <div class="chrome-loading-bar"></div>`;
    out.appendChild(el);
    out.scrollTop = out.scrollHeight;
    _updateLoadingStepIdx = 0;
    _updateLoadingInterval = setInterval(() => {
        _updateLoadingStepIdx = (_updateLoadingStepIdx + 1) % steps.length;
        const txt = document.getElementById('updateLoadingStepText');
        if (!txt) return;
        txt.style.opacity = '0';
        setTimeout(() => { if (txt) { txt.textContent = steps[_updateLoadingStepIdx]; txt.style.opacity = '1'; } }, 300);
    }, 2500);
    _updateLoadingTimeout = setTimeout(removeUpdateLoadingIndicator, 60000);
}

function removeUpdateLoadingIndicator() {
    if (_updateLoadingInterval) { clearInterval(_updateLoadingInterval); _updateLoadingInterval = null; }
    if (_updateLoadingTimeout)  { clearTimeout(_updateLoadingTimeout);   _updateLoadingTimeout  = null; }
    const el = document.getElementById('updateLoadingIndicator');
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

const CHROME_LOADING_STEPS = [
    'Verificando dependencias del sistema...',
    'Configurando entorno de ejecución...',
    'Cargando módulos de automatización...',
    'Iniciando navegador Chrome...',
    'Preparando perfil de usuario...',
    'Estableciendo conexión con el SCW...',
];
let _chromeLoadingInterval = null;
let _chromeLoadingStepIdx  = 0;

function showChromeLoadingIndicator() {
    removeChromeLoadingIndicator();
    const out = document.getElementById('consoleOutput');
    if (!out) return;
    const el = document.createElement('div');
    el.id = 'chromeLoadingIndicator';
    el.className = 'chrome-loading-indicator';
    el.innerHTML = `
        <div class="chrome-loading-steps">
            <div class="chrome-loading-dots"><span></span><span></span><span></span></div>
            <span class="chrome-loading-step-text" id="chromeLoadingStepText">${CHROME_LOADING_STEPS[0]}</span>
        </div>
        <div class="chrome-loading-bar"></div>`;
    out.appendChild(el);
    out.scrollTop = out.scrollHeight;
    _chromeLoadingStepIdx = 0;
    _chromeLoadingInterval = setInterval(() => {
        _chromeLoadingStepIdx = (_chromeLoadingStepIdx + 1) % CHROME_LOADING_STEPS.length;
        const txt = document.getElementById('chromeLoadingStepText');
        if (!txt) return;
        txt.style.opacity = '0';
        setTimeout(() => { if (txt) { txt.textContent = CHROME_LOADING_STEPS[_chromeLoadingStepIdx]; txt.style.opacity = '1'; } }, 300);
    }, 2500);
}

function removeChromeLoadingIndicator() {
    if (_chromeLoadingInterval) { clearInterval(_chromeLoadingInterval); _chromeLoadingInterval = null; }
    const el = document.getElementById('chromeLoadingIndicator');
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

function addLog(type, text) {
    // Filtrar errores de JS del sitio scrapeado — no son errores de la aplicación
    if (type === 'error' && /Error en la página|Uncaught|TypeError|ReferenceError|SyntaxError/.test(text)) return;

    removeChromeLoadingIndicator();
    const consoleOutput = document.getElementById('consoleOutput');
    const timestamp = new Date().toLocaleTimeString();

    const line = document.createElement('div');
    line.className = `console-line console-${type}`;
    line.innerHTML = `
        <span class="console-time">[${timestamp}]</span>
        <span>${escapeHtml(text)}</span>
    `;

    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    while (consoleOutput.children.length > 1000) {
        consoleOutput.removeChild(consoleOutput.firstChild);
    }

    // Actualizar barra de estado solo mientras hay un proceso activo
    if (isProcessRunning) {
        detectarEstadoDesdeLog(type, text);
    }
}

function clearConsole() {
    removeChromeLoadingIndicator();
    removeUpdateLoadingIndicator();
    const consoleOutput = document.getElementById('consoleOutput');
    consoleOutput.innerHTML = '';
    addLog('info', 'Consola limpiada');
}

async function downloadConsole() {
    const consoleOutput = document.getElementById('consoleOutput');
    const lines = Array.from(consoleOutput.querySelectorAll('.console-line'));
    const text = lines.map(line => {
        const time = line.querySelector('.console-time')?.textContent || '';
        const msg  = Array.from(line.childNodes)
            .filter(n => !n.classList?.contains('console-time'))
            .map(n => n.textContent)
            .join('');
        return `${time} ${msg}`.trim();
    }).join('\n');

    try {
        const result = await window.electronAPI.saveConsole(text);
        if (result?.success) {
            addLog('success', `✅ Consola guardada en ${result.filePath}`);
        }
    } catch (err) {
        addLog('error', `❌ Error al guardar consola: ${err.message}`);
    }
}

async function toggleBrowserVisibility(show) {
    const btn = document.getElementById('btnPositionLeft');

    // 1. Control de Chrome (solo si hay proceso activo)
    if (isProcessRunning) {
        try {
            const toggleResult = await window.electronAPI.toggleBrowserVisibility(show);
            if (toggleResult && !toggleResult.success) {
                addLog('warning', `⚠️ Toggle navegador: ${toggleResult.error}`);
            }
        } catch (err) {
            addLog('error', `❌ Error al cambiar visibilidad del navegador: ${err.message}`);
        }
    }

    // 2. Posicionamiento de ventana Electron (siempre)
    try {
        if (show) {
            // Chrome visible → Electron a la derecha (mitad)
            if (!isWindowPositioned) {
                await window.electronAPI.positionLeft();
                isWindowPositioned = true;
                document.body.classList.add('window-positioned');
                if (btn) { btn.textContent = '◨ Restaurar'; btn.title = 'Restaurar ventana al centro'; }
            }
        } else {
            // Chrome oculto → Electron vuelve a posición normal
            if (isWindowPositioned) {
                await window.electronAPI.restoreWindow();
                isWindowPositioned = false;
                document.body.classList.remove('window-positioned');
                if (btn) { btn.textContent = '◧ Posicionar'; btn.title = 'Posicionar ventana a la derecha'; }
            }
        }
    } catch (err) {
        addLog('error', `❌ Error al posicionar ventana: ${err.message}`);
    }
}

// ============ NOTIFICACIONES ============
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);

    const colors = {
        info:    { bg: '#1e3a5f', border: '#3b82f6', icon: 'ℹ️' },
        success: { bg: '#14532d', border: '#22c55e', icon: '✅' },
        warning: { bg: '#78350f', border: '#f59e0b', icon: '⚠️' },
        error:   { bg: '#450a0a', border: '#ef4444', icon: '❌' }
    };
    const style = colors[type] || colors.info;

    // Remover notificación previa si existe
    const prev = document.getElementById('__psc_toast');
    if (prev) prev.remove();

    const toast = document.createElement('div');
    toast.id = '__psc_toast';
    toast.style.cssText = [
        'position:fixed', 'bottom:24px', 'right:24px',
        'max-width:380px', 'z-index:99999',
        `background:${style.bg}`, `border-left:4px solid ${style.border}`,
        'border-radius:6px', 'padding:14px 18px',
        'color:#f1f5f9', 'font-size:13px', 'line-height:1.5',
        'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
        'cursor:pointer', 'transition:opacity 0.3s'
    ].join(';');
    toast.innerHTML = `<strong>${style.icon} ${type.toUpperCase()}</strong><br>${message}`;
    toast.title = 'Clic para cerrar';
    toast.addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);

    // Auto-eliminar después de 8 segundos (excepto warning, que dura hasta que el usuario cierra)
    if (type !== 'warning') {
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
    }
}

/**
 * Muestra una alerta prominente cuando el script necesita que el usuario
 * ingrese la contraseña manualmente en la ventana de Chrome.
 */
function showLoginManualAlert(cuit, message) {
    // Log en consola de la app
    addLog('warning', `🔐 Login manual requerido para CUIT ${cuit}`);

    // Remover alerta previa si existe
    const prev = document.getElementById('__psc_manual_alert');
    if (prev) prev.remove();

    const alert = document.createElement('div');
    alert.id = '__psc_manual_alert';
    alert.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0',
        'z-index:99999', 'background:#78350f',
        'border-bottom:3px solid #f59e0b',
        'padding:14px 20px', 'color:#fef3c7',
        'font-size:13px', 'line-height:1.6',
        'display:flex', 'align-items:center', 'gap:12px',
        'box-shadow:0 2px 12px rgba(0,0,0,0.4)'
    ].join(';');
    alert.innerHTML = `
        <span style="font-size:22px">🔐</span>
        <div style="flex:1">
            <strong>Acción requerida — CUIT ${cuit}</strong><br>
            ${message}
        </div>
        <button id="__psc_manual_alert_btn"
                style="background:transparent;border:1px solid #f59e0b;color:#fef3c7;
                       padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;
                       flex-shrink:0">
            Entendido
        </button>
    `;
    document.body.prepend(alert);
    // Usar addEventListener (el onclick inline no funciona en el contexto seguro de Electron)
    document.getElementById('__psc_manual_alert_btn')
        .addEventListener('click', () => alert.remove());
}

// ============ UTILIDADES ============
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTimestamp(filename) {
    const match = filename.match(/proceso_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);

    if (match) {
        const [, year, month, day, hour, min] = match;
        return `${day}/${month}/${year} ${hour}:${min}`;
    }

    return 'Hace poco';
}

// ============ MI CUENTA MODAL ============
let currentTicketId = null;

function setupCuentaModal() {
    // Tab switching — scoped to #modalCuenta to avoid conflicts with other modals
    const modalCuenta = document.getElementById('modalCuenta');
    modalCuenta.querySelectorAll('.cuenta-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            modalCuenta.querySelectorAll('.cuenta-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('cuenta-plan').style.display    = tabName === 'plan'    ? '' : 'none';
            document.getElementById('cuenta-soporte').style.display = tabName === 'soporte' ? '' : 'none';
            if (tabName === 'plan')    loadAccountData();
            if (tabName === 'soporte') loadTicketList();
        });
    });

    document.getElementById('btnNuevoTicket').addEventListener('click', () => showSoporteView('nuevo'));
    document.getElementById('btnBackTickets').addEventListener('click', () => showSoporteView('lista'));
    document.getElementById('btnBackTicketsDetalle').addEventListener('click', () => showSoporteView('lista'));
    document.getElementById('btnEnviarTicket').addEventListener('click', submitNewTicket);
    document.getElementById('btnEnviarReply').addEventListener('click', submitTicketReply);

    document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
        const confirmar = await window.electronAPI.showConfirmDialog(
            'Cerrar sesión',
            '¿Estás seguro que querés cerrar sesión?'
        );
        if (!confirmar) return;
        await window.electronAPI.logout();
    });
}

function openCuentaModal() {
    // Reset to plan tab — scoped to #modalCuenta
    const modalCuenta = document.getElementById('modalCuenta');
    modalCuenta.querySelectorAll('.cuenta-tab').forEach(t => t.classList.remove('active'));
    modalCuenta.querySelector('.cuenta-tab[data-tab="plan"]').classList.add('active');
    document.getElementById('cuenta-plan').style.display    = '';
    document.getElementById('cuenta-soporte').style.display = 'none';
    openModal('modalCuenta');
    loadAccountData();
}

async function loadAccountData() {
    const loadingEl = document.getElementById('cuenta-loading');
    const infoEl    = document.getElementById('cuenta-info');
    const errorEl   = document.getElementById('cuenta-error');

    loadingEl.style.display = '';
    infoEl.style.display    = 'none';
    errorEl.style.display   = 'none';

    try {
        const result = await window.electronAPI.getAccount();
        if (!result.success) throw new Error(result.error || 'Error al cargar cuenta');

        const a = result.account;

        document.getElementById('ci-email').textContent = a.email || '—';
        document.getElementById('ci-cuit').textContent  = a.cuit  || '(sin CUIT)';

        // Plan display name (new format from API) or backward compat
        const planName = (typeof a.plan === 'object' ? a.plan?.displayName || a.plan?.name : a.plan) || '—';
        document.getElementById('ci-plan').textContent = planName;

        const statusMap = {
            active:    '🟢 Activo',
            cancelled: '🔴 Cancelado',
            expired:   '🟠 Vencido',
            suspended: '⚫ Suspendido'
        };
        document.getElementById('ci-status').textContent = statusMap[a.status] || a.status || '—';

        document.getElementById('ci-expira').textContent = a.expiresAt
            ? new Date(a.expiresAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';

        document.getElementById('ci-device').textContent = a.machineBound ? 'Vinculado ✅' : 'No vinculado';

        // Período (new field)
        const periodoEl = document.getElementById('ci-periodo');
        if (periodoEl && a.period) {
            periodoEl.textContent = `${a.period.start} — ${a.period.end} (${a.period.daysRemaining} días restantes)`;
        }

        // Descripción del plan
        const planDescEl = document.getElementById('ci-plan-desc');
        if (planDescEl) {
            planDescEl.textContent = (typeof a.plan === 'object' ? a.plan?.description : null) || '';
        }

        // Per-subsystem usage bars (new fields)
        const subsysEl = document.getElementById('ci-subsystem-usage');
        if (subsysEl && a.usage) {
            subsysEl.innerHTML = renderSubsystemUsageBars(a.usage);
        }

        loadingEl.style.display = 'none';
        infoEl.style.display    = '';

        // Verificar cuota después de cargar datos de cuenta
        checkQuotaAlert();

    } catch (err) {
        loadingEl.style.display = 'none';
        errorEl.style.display   = '';
        errorEl.textContent     = `❌ ${err.message}`;
    }
}

function renderSubsystemUsageBars(usage) {
    const subsystems = [
        { key: 'proc',              label: 'Procuración' },
        { key: 'batch',             label: 'Procurar Batch' },
        { key: 'informe',           label: 'Informes' },
        { key: 'monitor_partes',    label: 'Monitor Partes' },
        { key: 'monitor_novedades', label: 'Monitor Novedades' }
    ];

    return subsystems.map(({ key, label }) => {
        const s = usage[key];
        if (!s) return '';
        const used      = s.used ?? 0;
        const limit     = s.limit;
        const unlimited = s.unlimited || limit === null;
        const pct       = unlimited ? 0 : Math.min(100, Math.round((used / (limit || 1)) * 100));
        const color     = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#3b82f6';
        const remaining = s.remaining !== null && s.remaining !== undefined ? s.remaining : '∞';
        const limitText = unlimited ? '∞' : (limit ?? '—');
        const bonusText = s.bonus > 0 ? ` <span style="color:#16a34a">(+${s.bonus} extra)</span>` : '';
        // Línea extra para batch: expedientes por ejecución
        const extraInfo = key === 'batch' && s.expedientesPerRun != null
            ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">Máx. <strong>${s.expedientesPerRun}</strong> expedientes por ejecución</div>`
            : key === 'batch' && s.expedientesUnlimited
            ? `<div style="font-size:11px;color:#16a34a;margin-top:2px">Sin límite de expedientes por ejecución</div>`
            : '';

        return `
        <div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-bottom:3px">
                <span style="font-weight:600;color:#374151">${label}</span>
                <span style="color:#6b7280">${used} / ${limitText}${bonusText} — <strong style="color:${color}">${remaining} restantes</strong></span>
            </div>
            ${!unlimited
                ? `<div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
                       <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 0.3s"></div>
                   </div>`
                : '<div style="font-size:11px;color:#16a34a">✓ Sin límite de ejecuciones</div>'}
            ${extraInfo}
        </div>`;
    }).join('');
}

// ============ ALERTA PROACTIVA DE CUOTA ============
// ─── Banner de promo (vencimiento / extensión) ───────────────────────────────
const PROMO_STORAGE_KEY = 'psc_promo_dismissed_until';
const PROMO_END_DATE_KEY = 'psc_promo_last_end_date';

function checkPromoAlert(promoStatus) {
    if (!promoStatus || !promoStatus.isPromo) return;

    const banner  = document.getElementById('promo-banner');
    const textEl  = document.getElementById('promo-banner-text');
    const dismiss = document.getElementById('promo-banner-dismiss');
    if (!banner || !textEl) return;

    // Si el admin extendió la fecha → forzar mostrar (ignorar dismissed)
    const lastKnownEndDate = localStorage.getItem(PROMO_END_DATE_KEY);
    const isExtended = promoStatus.promoEndDate && lastKnownEndDate
        && new Date(promoStatus.promoEndDate) > new Date(lastKnownEndDate);

    if (promoStatus.promoEndDate) {
        localStorage.setItem(PROMO_END_DATE_KEY, promoStatus.promoEndDate);
    }

    // Verificar si el usuario pidió no ver el banner por 24hs
    if (!isExtended) {
        const dismissedUntil = localStorage.getItem(PROMO_STORAGE_KEY);
        if (dismissedUntil && new Date() < new Date(dismissedUntil)) return;
    }

    let msg = null;
    let bgColor = '#78350f'; // amarillo oscuro por defecto

    if (isExtended && promoStatus.promoEndDate) {
        const fecha = new Date(promoStatus.promoEndDate).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
        msg = `🎉 ¡Tu promo fue extendida! Ahora vence el ${fecha}.`;
        bgColor = '#14532d'; // verde
    } else if (promoStatus.alert === 'expiring_soon' && promoStatus.daysLeft != null) {
        msg = `⚠️ Tu promo vence en ${promoStatus.daysLeft} día${promoStatus.daysLeft !== 1 ? 's' : ''}. Abrí la sección Mi Cuenta para ver opciones.`;
        bgColor = promoStatus.daysLeft <= 3 ? '#7f1d1d' : '#78350f';
    } else if (promoStatus.alert === 'quota_almost_full') {
        msg = '⚠️ El cupo de la promo está por agotarse. Revisá las opciones de renovación.';
        bgColor = '#78350f';
    }

    if (!msg) return;

    banner.style.background = bgColor;
    textEl.textContent = msg;
    banner.style.display = 'flex';

    dismiss.onclick = () => {
        banner.style.display = 'none';
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        localStorage.setItem(PROMO_STORAGE_KEY, until);
    };
}

let quotaBannerDismissed = false;

async function checkQuotaAlert() {
    if (quotaBannerDismissed) return;
    const banner  = document.getElementById('quota-banner');
    const textEl  = document.getElementById('quota-banner-text');
    if (!banner || !textEl) return;

    try {
        const result = await window.electronAPI.getAccount();
        if (!result?.success || !result.account?.usage) return;

        const labels = {
            proc:              'Procurar',
            batch:             'Batch',
            informe:           'Informe',
            monitor_novedades: 'Monitor Novedades',
            monitor_partes:    'Monitor Partes'
        };

        // Encontrar el subsistema con mayor porcentaje de uso
        let worstKey = null, worstPct = 0;
        for (const [key, s] of Object.entries(result.account.usage)) {
            if (!s || s.limit === null || s.limit === undefined) continue; // ilimitado → skip
            const pct = Math.round(((s.used ?? 0) / (s.limit || 1)) * 100);
            if (pct > worstPct) { worstPct = pct; worstKey = key; }
        }

        if (worstPct < 80 || !worstKey) {
            banner.style.display = 'none';
            return;
        }

        const label        = labels[worstKey] || worstKey;
        const isExhausted  = worstPct >= 100;
        banner.style.background = isExhausted ? '#7f1d1d' : '#78350f';
        textEl.textContent = isExhausted
            ? `⛔ Agotaste tus ejecuciones de ${label} para este período. Contactá soporte o actualizá tu plan.`
            : `⚠️ Usaste el ${worstPct}% de tus ejecuciones de ${label}. Considerá actualizar tu plan.`;
        banner.style.display = 'flex';
    } catch (_) {
        // Falla silenciosamente
    }
}

function showSoporteView(view) {
    document.getElementById('soporte-lista').style.display   = view === 'lista'   ? '' : 'none';
    document.getElementById('soporte-nuevo').style.display   = view === 'nuevo'   ? '' : 'none';
    document.getElementById('soporte-detalle').style.display = view === 'detalle' ? '' : 'none';
    if (view === 'lista') loadTicketList();
}

async function loadTicketList() {
    const listEl  = document.getElementById('tickets-list');
    const countEl = document.getElementById('soporte-count');

    listEl.innerHTML    = '<div style="color:#9ca3af;font-size:13px;padding:20px 0;text-align:center">Cargando tickets...</div>';
    countEl.textContent = '';

    try {
        const result = await window.electronAPI.getTickets();
        if (!result.success) throw new Error(result.error || 'Error al cargar tickets');

        const tickets = result.tickets || [];
        countEl.textContent = `${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}`;

        if (tickets.length === 0) {
            listEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:20px 0;text-align:center">No hay tickets de soporte aún</div>';
            return;
        }

        const statusBadgeMap = {
            open:        '<span class="ticket-badge badge-open">Abierto</span>',
            in_progress: '<span class="ticket-badge badge-progress">En progreso</span>',
            resolved:    '<span class="ticket-badge badge-resolved">Resuelto</span>',
            closed:      '<span class="ticket-badge badge-closed">Cerrado</span>'
        };
        const catLabelMap = { technical: 'Técnico', billing: 'Pagos', commercial: 'Beneficio' };

        listEl.innerHTML = tickets.map(t => {
            const badge   = statusBadgeMap[t.status] || `<span class="ticket-badge">${t.status}</span>`;
            const catText = catLabelMap[t.category] || t.category;
            const date    = new Date(t.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `
                <div class="ticket-item" data-ticket-id="${t.id}">
                    <div class="ticket-item-header">
                        <span class="ticket-item-title">${escapeHtml(t.title)}</span>
                        ${badge}
                    </div>
                    <div class="ticket-item-meta">
                        <span>${catText}</span>
                        <span>${date}</span>
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.ticket-item').forEach(item => {
            item.addEventListener('click', () => showTicketDetail(parseInt(item.dataset.ticketId, 10)));
        });

    } catch (err) {
        listEl.innerHTML    = `<div style="color:#ef4444;font-size:13px;padding:20px 0">❌ ${escapeHtml(err.message)}</div>`;
        countEl.textContent = '';
    }
}

async function showTicketDetail(ticketId) {
    currentTicketId = ticketId;
    showSoporteView('detalle');

    const headerEl   = document.getElementById('detalle-header');
    const commentsEl = document.getElementById('detalle-comments');
    const replyArea  = document.getElementById('reply-text');
    const replyBtn   = document.getElementById('btnEnviarReply');

    headerEl.innerHTML   = '<span style="color:#9ca3af;font-size:13px">Cargando...</span>';
    commentsEl.innerHTML = '';
    replyArea.value      = '';

    try {
        const result = await window.electronAPI.getTicketDetail(ticketId);
        if (!result.success) throw new Error(result.error || 'Error al cargar ticket');

        const { ticket, comments } = result;

        const statusLabel = { open: 'Abierto', in_progress: 'En progreso', resolved: 'Resuelto', closed: 'Cerrado' }[ticket.status] || ticket.status;
        const catLabel    = { technical: 'Técnico', billing: 'Pagos', commercial: 'Beneficio comercial' }[ticket.category] || ticket.category;
        const date        = new Date(ticket.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

        headerEl.innerHTML = `
            <div style="font-size:14px;font-weight:600;margin-bottom:6px">${escapeHtml(ticket.title)}</div>
            <div style="font-size:12px;color:#6b7280">${catLabel} · ${statusLabel} · ${date}</div>
            <div style="margin-top:10px;font-size:13px;color:#374151;background:#f9fafb;border-radius:8px;padding:12px;line-height:1.6">${escapeHtml(ticket.description)}</div>
        `;

        if (comments.length === 0) {
            commentsEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:14px 0;text-align:center">Sin respuestas aún</div>';
        } else {
            commentsEl.innerHTML = comments.map(c => {
                const isAdmin = c.author_role === 'admin';
                const cDate   = new Date(c.created_at).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
                return `
                    <div class="detalle-comment ${isAdmin ? 'comment-admin' : 'comment-user'}">
                        <div class="detalle-bubble">
                            <div class="bubble-meta">
                                <span class="bubble-author">${isAdmin ? '🛠 Soporte' : '👤 Tú'}</span>
                                <span class="bubble-date">${cDate}</span>
                            </div>
                            <div class="bubble-text">${escapeHtml(c.message)}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const isClosed = ticket.status === 'closed';
        replyArea.disabled    = isClosed;
        replyArea.placeholder = isClosed ? 'Este ticket está cerrado' : 'Escribir respuesta...';
        replyBtn.disabled     = isClosed;

    } catch (err) {
        headerEl.innerHTML = `<div style="color:#ef4444;font-size:13px">❌ ${escapeHtml(err.message)}</div>`;
    }
}

async function submitNewTicket() {
    const cat   = document.getElementById('ticket-cat').value.trim();
    const title = document.getElementById('ticket-titulo').value.trim();
    const desc  = document.getElementById('ticket-desc').value.trim();
    const errEl = document.getElementById('nuevo-ticket-error');

    errEl.style.display = 'none';

    if (!cat || !title || !desc) {
        errEl.style.display = '';
        errEl.textContent   = 'Por favor completá todos los campos.';
        return;
    }

    const btn = document.getElementById('btnEnviarTicket');
    btn.disabled    = true;
    btn.textContent = 'Enviando...';

    try {
        const result = await window.electronAPI.createTicket(cat, title, desc);
        if (!result.success) throw new Error(result.error || 'Error al crear ticket');

        document.getElementById('ticket-cat').value    = 'technical';
        document.getElementById('ticket-titulo').value = '';
        document.getElementById('ticket-desc').value   = '';

        showNotification('Ticket enviado correctamente', 'success');
        showSoporteView('lista');

    } catch (err) {
        errEl.style.display = '';
        errEl.textContent   = `❌ ${err.message}`;
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Enviar ticket';
    }
}

async function submitTicketReply() {
    if (!currentTicketId) return;

    const text = document.getElementById('reply-text').value.trim();
    const btn  = document.getElementById('btnEnviarReply');

    if (!text) {
        showNotification('Escribí un mensaje antes de responder', 'warning');
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Enviando...';

    try {
        const result = await window.electronAPI.addTicketComment(currentTicketId, text);
        if (!result.success) throw new Error(result.error || 'Error al enviar respuesta');

        document.getElementById('reply-text').value = '';
        await showTicketDetail(currentTicketId);
        showNotification('Respuesta enviada', 'success');

    } catch (err) {
        showNotification(`❌ ${err.message}`, 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Responder';
    }
}

// ============ MANEJO DE ERRORES GLOBALES ============
window.addEventListener('error', (event) => {
    addLog('error', `❌ Error no manejado: ${event.error.message}`);
});

window.addEventListener('unhandledrejection', (event) => {
    addLog('error', `❌ Promise rechazada: ${event.reason}`);
});

// ============ POSICIONAR VENTANA - VERSIÓN TOGGLE ============
async function positionWindowLeft() {
    try {
        const btn = document.getElementById('btnPositionLeft');

        if (isWindowPositioned) {
            // Restaurar
            await window.electronAPI.restoreWindow();
            isWindowPositioned = false;
            document.body.classList.remove('window-positioned');
            addLog('info', '📐 Ventana restaurada a posición original');
            showNotification('Ventana restaurada', 'success');
            btn.textContent = '◧ Posicionar';
            btn.title = 'Posicionar ventana a la derecha';
        } else {
            // Posicionar
            await window.electronAPI.positionLeft();
            isWindowPositioned = true;
            document.body.classList.add('window-positioned');
            addLog('info', '📐 Ventana posicionada a la derecha');
            showNotification('Ventana posicionada correctamente', 'success');
            btn.textContent = '◨ Restaurar';
            btn.title = 'Restaurar ventana al centro';
        }
    } catch (error) {
        addLog('error', `❌ Error al manipular ventana: ${error.message}`);
        showNotification('Error al manipular ventana', 'error');
    }
}

// ============ INFORME ============

let informeBatchLines = null;

function setupInformeModal() {
    // Tabs Individual / Batch
    document.querySelectorAll('[data-informe-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('[data-informe-tab]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const name = tab.dataset.informeTab;
            document.getElementById('informe-panel-individual').style.display = name === 'individual' ? '' : 'none';
            document.getElementById('informe-panel-batch').style.display     = name === 'batch'      ? '' : 'none';
        });
    });

    // Seleccionar archivo batch
    document.getElementById('btnSelectBatchFile').addEventListener('click', async () => {
        const result = await window.electronAPI.selectBatchFile();
        if (result.canceled || !result.success) return;
        informeBatchLines = result.lines;
        document.getElementById('informe-batch-filename').textContent = result.path.split(/[\\/]/).pop();
        const preview = document.getElementById('informe-batch-preview');
        preview.style.display = '';
        preview.textContent = `${result.lines.length} expediente(s) encontrado(s)`;
    });

    // Botones del modal
    document.getElementById('btnCancelInforme').addEventListener('click', () => closeModal('modalInforme'));
    document.getElementById('btnConfirmInforme').addEventListener('click', ejecutarInforme);
}

function openInformeModal() {
    // Resetear estado
    informeBatchLines = null;
    document.getElementById('informe-expediente').value = '';
    document.getElementById('informe-batch-filename').textContent = 'Sin archivo seleccionado';
    document.getElementById('informe-batch-preview').style.display = 'none';
    document.getElementById('informe-error').style.display = 'none';
    // Asegurar tab Individual activo
    document.querySelectorAll('[data-informe-tab]').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-informe-tab="individual"]').classList.add('active');
    document.getElementById('informe-panel-individual').style.display = '';
    document.getElementById('informe-panel-batch').style.display = 'none';
    openModal('modalInforme');
}

async function ejecutarInforme() {
    if (isProcessRunning) {
        showNotification('Ya hay un proceso en ejecución', 'warning');
        return;
    }

    const errDiv = document.getElementById('informe-error');
    errDiv.style.display = 'none';

    const activeTab = document.querySelector('[data-informe-tab].active')?.dataset.informeTab;

    // Construir configInforme desde el modal
    const configInforme = {
        movimientosActuales: document.getElementById('informe-movact').value,
        movimientosHistoricos: document.getElementById('informe-movhist').value,
        intervinientes: document.getElementById('informe-intervinientes').checked,
        vinculados: document.getElementById('informe-vinculados').checked,
        recursos: document.getElementById('informe-recursos').checked,
        notas: document.getElementById('informe-notas').checked
    };

    let opts;
    if (activeTab === 'batch') {
        if (!informeBatchLines || informeBatchLines.length === 0) {
            errDiv.textContent = 'Seleccioná un archivo .txt con expedientes.';
            errDiv.style.display = '';
            return;
        }
        opts = { batchLines: informeBatchLines, configInforme };
    } else {
        const exp = document.getElementById('informe-expediente').value.trim();
        if (!exp) {
            errDiv.textContent = 'Ingresá el número de expediente.';
            errDiv.style.display = '';
            return;
        }
        opts = { expediente: exp, configInforme };
    }

    closeModal('modalInforme');
    addLog('info', `📄 Iniciando informe... (${activeTab})`);
    addLog('info', '⏳ Preparando navegador Chrome... esto puede demorar unos segundos');
    showChromeLoadingIndicator();
    setProcessRunning(true);

    try {
        const result = await window.electronAPI.runInforme(opts);
        if (!result.success) {
            addLog('error', `❌ Informe falló: ${result.error}`);
            showNotification(result.error || 'Error al generar informe', 'error');
        } else if (activeTab !== 'batch') {
            // Solo para modo individual (batch ya muestra su propio mensaje en onInformeBatchComplete)
            addLog('info', '✅ Informe individual generado correctamente');
            showNotification('Informe generado correctamente', 'success');
        }
    } catch (error) {
        addLog('error', `❌ Error en informe: ${error.message}`);
        showNotification('Error al generar informe', 'error');
    } finally {
        setProcessRunning(false);
    }
}

// ============ PROCURAR CUSTOM ============

let _procurarCustomLines = null;

function setupProcurarCustomModal() {
    document.getElementById('btnSeleccionarTxtCustom').addEventListener('click', async () => {
        const res = await window.electronAPI.selectBatchFile();
        if (res.success && res.lines && res.lines.length > 0) {
            _procurarCustomLines = res.lines;
            document.getElementById('lblArchivoCustom').textContent = res.path.split(/[\\/]/).pop();
            const resumenEl = document.getElementById('resumenCustom');
            resumenEl.textContent = `${res.lines.length} expediente${res.lines.length !== 1 ? 's' : ''} cargado${res.lines.length !== 1 ? 's' : ''}`;
            resumenEl.style.display = 'block';
            document.getElementById('btnConfirmProcurarCustom').disabled = false;
            // Verificar límites de batch al cargar el archivo
            await _actualizarAvisoBatchLimits(res.lines.length);
        }
    });

    document.getElementById('btnCancelProcurarCustom').addEventListener('click', () => closeModal('modalProcurarCustom'));

    document.getElementById('btnConfirmProcurarCustom').addEventListener('click', async () => {
        if (!_procurarCustomLines) return;
        const fecha = document.getElementById('inputFechaCustomProcurar').value.trim();
        if (fecha && !/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
            showNotification('Formato de fecha inválido (use DD/MM/YYYY)', 'error');
            return;
        }
        // Si hay truncación, el botón ya muestra "Confirmar de todas formas" — ejecutar con líneas truncadas
        const lineasAEjecutar = _procurarCustomLinesTruncated || _procurarCustomLines;
        closeModal('modalProcurarCustom');
        await runProcurarCustom(lineasAEjecutar, fecha || null);
    });
}

let _procurarCustomLinesTruncated = null;

async function _actualizarAvisoBatchLimits(totalCargados) {
    const avisoEl = document.getElementById('batchLimitAviso');
    if (!avisoEl) return;
    _procurarCustomLinesTruncated = null;

    try {
        const limitsRes = await window.electronAPI.getBatchLimits();
        if (!limitsRes.success) {
            avisoEl.style.display = 'none';
            return;
        }
        const b = limitsRes.batch;

        // Verificar si quedan ejecuciones
        if (b.executions.remaining !== null && b.executions.remaining <= 0) {
            avisoEl.className = 'batch-limit-aviso batch-limit-error';
            avisoEl.innerHTML = `⛔ <strong>Sin ejecuciones de batch disponibles.</strong> Has utilizado ${b.executions.used}/${b.executions.limit} ejecuciones del período. Contactá soporte para un ajuste.`;
            avisoEl.style.display = '';
            document.getElementById('btnConfirmProcurarCustom').disabled = true;
            return;
        }

        // Verificar si hay expedientes a truncar
        const maxExp = b.expedientesPerRun;
        if (maxExp !== null && totalCargados > maxExp) {
            _procurarCustomLinesTruncated = _procurarCustomLines.slice(0, maxExp);
            avisoEl.className = 'batch-limit-aviso batch-limit-warning';
            avisoEl.innerHTML = `⚠️ Tu plan permite procesar hasta <strong>${maxExp} expedientes</strong> por ejecución. Se cargarán <strong>${totalCargados}</strong> pero solo se procesarán los primeros <strong>${maxExp}</strong>.<br>
                <span style="font-size:11px;color:#92400e">Expedientes a procesar: ${maxExp} de ${totalCargados} — los restantes ${totalCargados - maxExp} serán ignorados en esta ejecución.</span>`;
            avisoEl.style.display = '';
            const btn = document.getElementById('btnConfirmProcurarCustom');
            btn.disabled = false;
            btn.textContent = `▶ Procesar primeros ${maxExp}`;
        } else if (maxExp !== null) {
            // Dentro del límite, mostrar info positiva
            avisoEl.className = 'batch-limit-aviso batch-limit-ok';
            avisoEl.innerHTML = `✅ ${totalCargados} expediente${totalCargados !== 1 ? 's' : ''} — dentro del límite por ejecución (máx. ${maxExp}).<br><span style="font-size:11px;color:#6b7280">Ejecuciones restantes en el período: <strong>${b.executions.remaining ?? '∞'}</strong> de ${b.executions.limit ?? '∞'}</span>`;
            avisoEl.style.display = '';
            const btn = document.getElementById('btnConfirmProcurarCustom');
            btn.disabled = false;
            btn.textContent = '▶ Procesar';
        } else {
            // Sin límite de expedientes
            avisoEl.className = 'batch-limit-aviso batch-limit-ok';
            avisoEl.innerHTML = `✅ ${totalCargados} expediente${totalCargados !== 1 ? 's' : ''} listos.<br><span style="font-size:11px;color:#6b7280">Ejecuciones restantes en el período: <strong>${b.executions.remaining ?? '∞'}</strong> de ${b.executions.limit ?? '∞'}</span>`;
            avisoEl.style.display = '';
        }
    } catch (_) {
        avisoEl.style.display = 'none';
    }
}

function showProcurarCustomModal() {
    _procurarCustomLines = null;
    _procurarCustomLinesTruncated = null;
    document.getElementById('lblArchivoCustom').textContent = 'Sin archivo';
    document.getElementById('resumenCustom').style.display = 'none';
    document.getElementById('inputFechaCustomProcurar').value = '';
    const btn = document.getElementById('btnConfirmProcurarCustom');
    btn.disabled = true;
    btn.textContent = '▶ Procesar';
    const avisoEl = document.getElementById('batchLimitAviso');
    if (avisoEl) avisoEl.style.display = 'none';
    openModal('modalProcurarCustom');
}

async function runProcurarCustom(lines, fechaLimite) {
    if (isProcessRunning) {
        showNotification('Ya hay un proceso en ejecución', 'warning');
        return;
    }

    try {
        if (!currentConfig?.seguridad?.modoHeadless && !isWindowPositioned) {
            addLog('info', '📐 Posicionando ventana a la derecha...');
            await window.electronAPI.positionLeft();
            isWindowPositioned = true;
            document.body.classList.add('window-positioned');
            const btn = document.getElementById('btnPositionLeft');
            if (btn) { btn.textContent = '◨ Restaurar'; btn.title = 'Restaurar ventana al centro'; }
        }

        const fechaMsg = fechaLimite ? ` — fecha límite: ${fechaLimite}` : '';
        addLog('info', `📁 Iniciando Procurar Custom (${lines.length} expediente${lines.length !== 1 ? 's' : ''})${fechaMsg}...`);
        addLog('info', '⏳ Preparando navegador Chrome... esto puede demorar unos segundos');
        showChromeLoadingIndicator();
        setProcessRunning(true);

        const result = await window.electronAPI.runProcessCustom({ lines, fechaLimite });

        if (!result.success) {
            addLog('error', `❌ Error: ${result.error}`);
            setProcessRunning(false);
            showNotification('Error al iniciar Procurar Custom', 'error');
        }
    } catch (error) {
        addLog('error', `❌ Error inesperado: ${error.message}`);
        setProcessRunning(false);
        showNotification('Error inesperado', 'error');
    }
}

// ============ MONITOR DE PARTES ============

// Estado del monitor
let _monitorPartes = [];          // cache de partes cargadas
let _monitorEditandoId = null;    // null = agregar, número = editar

function setupMonitorModal() {
    const modal = document.getElementById('modalMonitor');

    // Tab switching — scoped to #modalMonitor
    modal.querySelectorAll('.cuenta-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.cuenta-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('monitor-partes').style.display       = tabName === 'monitor-partes'       ? '' : 'none';
            document.getElementById('monitor-expedientes').style.display  = tabName === 'monitor-expedientes'  ? '' : 'none';
            document.getElementById('monitor-novedades').style.display    = tabName === 'monitor-novedades'    ? '' : 'none';
            if (tabName === 'monitor-novedades') loadMonitorNovedades();
        });
    });

    // Cerrar modal
    document.getElementById('btnMonitorCerrar').addEventListener('click', () => closeModal('modalMonitor'));
    modal.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal('modalMonitor'));
    });

    // Volver a partes desde expedientes
    document.getElementById('btnMonitorVolverPartes').addEventListener('click', () => {
        switchMonitorTab('monitor-partes');
    });

    // Ver todos los expedientes (todas las partes)
    document.getElementById('btnMonitorVerTodos').addEventListener('click', () => {
        verExpedientesMonitor(null, 'Todos los expedientes guardados');
    });

    // Generar visor desde expedientes guardados
    document.getElementById('btnMonitorVisorExp').addEventListener('click', async () => {
        const res = await window.electronAPI.monitorGenerarVisorGuardado('expedientes');
        if (!res.success) showNotification(res.error || 'Error al generar visor', 'error');
    });

    // Generar visor desde novedades pendientes
    document.getElementById('btnMonitorVisorNov').addEventListener('click', async () => {
        const res = await window.electronAPI.monitorGenerarVisorGuardado('novedades');
        if (!res.success) showNotification(res.error || 'Sin novedades para generar visor', 'warning');
    });

    // Botón agregar parte
    document.getElementById('btnMonitorAgregarParte').addEventListener('click', () => {
        _monitorEditandoId = null;
        resetMonitorForm('Agregar parte');
        document.getElementById('monitor-form-parte').style.display = '';
        document.getElementById('btnMonitorAgregarParte').style.display = 'none';
        // Scroll automático para mostrar los botones Cancelar/Guardar
        setTimeout(() => {
            const form = document.getElementById('monitor-form-parte');
            form.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 50);
    });

    // Cancelar formulario
    document.getElementById('btnMonitorCancelarParte').addEventListener('click', () => {
        document.getElementById('monitor-form-parte').style.display = 'none';
        document.getElementById('btnMonitorAgregarParte').style.display = '';
    });

    // Guardar parte (agregar o editar)
    document.getElementById('btnMonitorGuardarParte').addEventListener('click', guardarParte);

    // Checkbox seleccionar todas
    document.getElementById('monitor-check-all').addEventListener('change', (e) => {
        document.querySelectorAll('.monitor-check-parte').forEach(cb => { cb.checked = e.target.checked; });
        actualizarBotonesMonitor();
    });

    // Botones de ejecución
    document.getElementById('btnMonitorConsultaInicial').addEventListener('click', handleConsultaInicial);
    document.getElementById('btnMonitorBuscarNovedades').addEventListener('click', handleBuscarNovedades);

    // Novedades — check-all
    document.getElementById('monitor-nov-check-all').addEventListener('change', (e) => {
        document.querySelectorAll('.monitor-nov-check').forEach(cb => { cb.checked = e.target.checked; });
    });

    // Novedades — agregar seleccionadas
    document.getElementById('btnMonitorAgregarNovedades').addEventListener('click', async () => {
        const ids = Array.from(document.querySelectorAll('.monitor-nov-check:checked'))
            .map(cb => parseInt(cb.dataset.id)).filter(Boolean);
        if (ids.length === 0) { showNotification('No hay novedades seleccionadas', 'warning'); return; }
        const btn = document.getElementById('btnMonitorAgregarNovedades');
        btn.disabled = true; btn.textContent = 'Agregando...';
        try {
            const res = await window.electronAPI.monitorBulkConfirmar(ids);
            if (!res.success) { showNotification(res.error || 'Error al agregar', 'error'); return; }
            showNotification(res.confirmados + ' expediente(s) agregado(s) a la base', 'success');
            await loadMonitorNovedades();
            cargarNovedadesCount();
        } catch (err) { showNotification(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = '✅ Agregar seleccionadas'; }
    });

    // Novedades — descartar todo
    document.getElementById('btnMonitorDescartarTodos').addEventListener('click', async () => {
        if (!confirm('¿Descartás todas las novedades pendientes? Esta acción no se puede deshacer.')) return;
        try {
            const res = await window.electronAPI.monitorDescartarTodos();
            if (!res.success) { showNotification(res.error || 'Error al descartar', 'error'); return; }
            showNotification(res.descartados + ' novedad(es) descartada(s)', 'success');
            await loadMonitorNovedades();
            cargarNovedadesCount();
        } catch (err) { showNotification(err.message, 'error'); }
    });

}

function openMonitorModal(autoAbrirExpedientes) {
    // Resetear al tab de partes
    switchMonitorTab('monitor-partes');
    // Ocultar formulario
    document.getElementById('monitor-form-parte').style.display = 'none';
    document.getElementById('btnMonitorAgregarParte').style.display = '';
    openModal('modalMonitor');
    cargarPartesMonitor(autoAbrirExpedientes);
    cargarNovedadesCount();
}

function switchMonitorTab(tabName) {
    const modal = document.getElementById('modalMonitor');
    modal.querySelectorAll('.cuenta-tab').forEach(t => t.classList.remove('active'));
    const activeTab = modal.querySelector('.cuenta-tab[data-tab="' + tabName + '"]');
    if (activeTab) activeTab.classList.add('active');
    document.getElementById('monitor-partes').style.display       = tabName === 'monitor-partes'       ? '' : 'none';
    document.getElementById('monitor-expedientes').style.display  = tabName === 'monitor-expedientes'  ? '' : 'none';
    document.getElementById('monitor-novedades').style.display    = tabName === 'monitor-novedades'    ? '' : 'none';
    // Cargar datos al cambiar de tab (tanto por click como programáticamente)
    if (tabName === 'monitor-novedades') loadMonitorNovedades();
}

// ── Cargar partes ──────────────────────────────────────────────────────────────
// autoAbrirExpedientes: si es true y hay exactamente 1 parte con línea base, abre sus expedientes automáticamente
async function cargarPartesMonitor(autoAbrirExpedientes) {
    document.getElementById('monitor-partes-lista').innerHTML =
        '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px;">Cargando partes...</div>';
    document.getElementById('monitor-partes-error').style.display = 'none';

    try {
        const res = await window.electronAPI.monitorGetPartes();
        if (!res.success) {
            mostrarErrorPartes(res.error || 'Error al cargar partes');
            return;
        }

        _monitorPartes = res.partes || [];
        renderizarListaPartes();
        actualizarBotonesMonitor();

        // Si viene de consulta inicial, abrir automáticamente los expedientes de la única parte con base
        if (autoAbrirExpedientes) {
            const conBase = _monitorPartes.filter(p => p.tiene_linea_base);
            if (conBase.length === 1) {
                const p = conBase[0];
                setTimeout(() => verExpedientesMonitor(p.id, p.jurisdiccion_sigla + ' \u00b7 ' + p.nombre_parte), 300);
            }
        }

        // Stats
        const statsRes = await window.electronAPI.monitorGetStats().catch(() => null);
        if (statsRes && statsRes.success) {
            const limitePartes = (statsRes.partes && statsRes.partes.limite) ? statsRes.partes.limite : '?';
            const consultasMes = (statsRes.consultas && statsRes.consultas.mes !== undefined) ? statsRes.consultas.mes : 0;
            document.getElementById('monitor-partes-count').textContent =
                _monitorPartes.length + ' de ' + limitePartes + ' parte(s) — ' + consultasMes + ' consulta(s) este mes';
        } else {
            document.getElementById('monitor-partes-count').textContent = _monitorPartes.length + ' parte(s)';
        }

    } catch (err) {
        mostrarErrorPartes(err.message || 'Error inesperado');
    }
}

function renderizarListaPartes() {
    const lista = document.getElementById('monitor-partes-lista');
    if (_monitorPartes.length === 0) {
        lista.innerHTML = '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px;">No hay partes configuradas. Hac\u00e9 clic en "+ Agregar parte" para comenzar.</div>';
        return;
    }

    const ahora = new Date();
    lista.innerHTML = _monitorPartes.map(function(p) {
        const estado = p.tiene_linea_base
            ? '<span style="color:#16a34a;font-size:11px;">\u2705 Base lista</span>'
            : '<span style="color:#f59e0b;font-size:11px;">\u23f3 Sin consulta inicial</span>';
        const sigla  = escHtml(p.jurisdiccion_sigla);
        const nombre = escHtml(p.nombre_parte);
        const titulo = escHtml(p.jurisdiccion_sigla + ' \u00b7 ' + p.nombre_parte);

        // Restricciones temporales:
        //   Editar:   permitido si edad < 1h  O  edad > 30 días  (bloqueado entre 1h y 30 días)
        //   Eliminar: permitido si edad < 24h O  edad > 30 días  (bloqueado entre 24h y 30 días)
        const msDesde     = p.fecha_creacion ? (ahora - new Date(p.fecha_creacion)) : 0;
        const unaHMs      = 3600000;
        const veintCuatHMs = 86400000;
        const treintaDMs  = 30 * 86400000;
        const limite30str = p.fecha_creacion
            ? new Date(new Date(p.fecha_creacion).getTime() + treintaDMs).toLocaleDateString('es-AR')
            : '';

        const puedeEditar   = msDesde < unaHMs   || msDesde > treintaDMs;
        const puedeEliminar = msDesde < veintCuatHMs || msDesde > treintaDMs;

        const titleEditar   = puedeEditar   ? 'Editar'
            : 'Edici\u00f3n bloqueada hasta ' + limite30str;
        const titleEliminar = puedeEliminar ? 'Eliminar'
            : 'Eliminaci\u00f3n bloqueada hasta ' + limite30str;
        const disabledEditar   = puedeEditar   ? '' : ' disabled';
        const disabledEliminar = puedeEliminar ? '' : ' disabled';
        const opacityEditar    = puedeEditar   ? '' : 'opacity:0.4;cursor:not-allowed;';
        const opacityEliminar  = puedeEliminar ? '' : 'opacity:0.4;cursor:not-allowed;';

        return '<div class="monitor-parte-item" data-id="' + p.id + '" style="display:flex;align-items:flex-start;gap:8px;padding:10px 4px;border-bottom:1px solid #f3f4f6;">' +
            '<input type="checkbox" class="monitor-check-parte" data-id="' + p.id + '" data-base="' + (p.tiene_linea_base ? '1' : '0') + '" checked style="margin-top:3px;flex-shrink:0;">' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
                    '<span style="font-size:11px;font-weight:600;background:#e0e7ff;color:#4338ca;padding:1px 6px;border-radius:4px;">' + sigla + '</span>' +
                    '<span style="font-size:13px;font-weight:500;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + nombre + '</span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:10px;">' + estado + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:4px;flex-shrink:0;">' +
                '<button class="btn-monitor-accion btn-monitor-ver" data-id="' + p.id + '" data-titulo="' + titulo + '" style="font-size:11px;padding:3px 7px;" title="Ver expedientes">\ud83d\udcd1</button>' +
                '<button class="btn-monitor-accion btn-monitor-editar" data-id="' + p.id + '" style="font-size:11px;padding:3px 7px;' + opacityEditar + '" title="' + escHtml(titleEditar) + '"' + disabledEditar + '>\u270f\ufe0f</button>' +
                '<button class="btn-monitor-accion btn-monitor-danger btn-monitor-eliminar" data-id="' + p.id + '" style="font-size:11px;padding:3px 7px;' + opacityEliminar + '" title="' + escHtml(titleEliminar) + '"' + disabledEliminar + '>\ud83d\uddd1\ufe0f</button>' +
            '</div>' +
        '</div>';
    }).join('');

    // Escuchar botones (CSP no permite onclick inline)
    lista.querySelectorAll('.btn-monitor-ver').forEach(btn => {
        btn.addEventListener('click', function() {
            verExpedientesMonitor(parseInt(this.dataset.id), this.dataset.titulo || '');
        });
    });
    lista.querySelectorAll('.btn-monitor-editar').forEach(btn => {
        btn.addEventListener('click', function() { editarParteMonitor(parseInt(this.dataset.id)); });
    });
    lista.querySelectorAll('.btn-monitor-eliminar').forEach(btn => {
        btn.addEventListener('click', function() { eliminarParteMonitor(parseInt(this.dataset.id)); });
    });

    // Escuchar cambios en checkboxes
    lista.querySelectorAll('.monitor-check-parte').forEach(cb => {
        cb.addEventListener('change', () => {
            actualizarCheckAll();
            actualizarBotonesMonitor();
        });
    });
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function actualizarCheckAll() {
    const checks = document.querySelectorAll('.monitor-check-parte');
    const all = Array.from(checks).every(c => c.checked);
    document.getElementById('monitor-check-all').checked = all;
}

function actualizarBotonesMonitor() {
    const seleccionadas = getPartesSeleccionadas();
    const sinBase  = seleccionadas.filter(p => !p.tiene_linea_base);
    const conBase  = seleccionadas.filter(p =>  p.tiene_linea_base);

    const btnInicial   = document.getElementById('btnMonitorConsultaInicial');
    const btnNovedades = document.getElementById('btnMonitorBuscarNovedades');

    btnInicial.disabled   = sinBase.length  === 0;
    btnNovedades.disabled = conBase.length === 0;
}

function getPartesSeleccionadas() {
    const checks = document.querySelectorAll('.monitor-check-parte:checked');
    return Array.from(checks).map(cb => {
        const id   = parseInt(cb.dataset.id);
        return _monitorPartes.find(p => p.id === id) || { id, tiene_linea_base: cb.dataset.base === '1' };
    }).filter(Boolean);
}

function mostrarErrorPartes(msg) {
    const el = document.getElementById('monitor-partes-error');
    el.textContent = msg;
    el.style.display = '';
    document.getElementById('monitor-partes-lista').innerHTML = '';
}

// ── Agregar / Editar parte ─────────────────────────────────────────────────────
function resetMonitorForm(titulo) {
    document.getElementById('monitor-form-title').textContent = titulo;
    document.getElementById('monitor-form-jurisdiccion').value = '';
    document.getElementById('monitor-form-nombre').value = '';
    document.getElementById('monitor-form-parte-id').value = '';
    document.getElementById('monitor-form-error').style.display = 'none';
    _monitorEditandoId = null;
}

function editarParteMonitor(id) {
    const parte = _monitorPartes.find(p => p.id === id);
    if (!parte) return;

    _monitorEditandoId = id;
    document.getElementById('monitor-form-title').textContent = 'Editar parte';
    document.getElementById('monitor-form-jurisdiccion').value = parte.jurisdiccion_codigo;
    document.getElementById('monitor-form-nombre').value = parte.nombre_parte;
    document.getElementById('monitor-form-parte-id').value = id;
    document.getElementById('monitor-form-error').style.display = 'none';
    document.getElementById('monitor-form-parte').style.display = '';
    document.getElementById('btnMonitorAgregarParte').style.display = 'none';
}

async function guardarParte() {
    const jurisdiccionSelect = document.getElementById('monitor-form-jurisdiccion');
    const jurisdiccionCodigo = jurisdiccionSelect.value;
    const selectedOpt = jurisdiccionSelect.options[jurisdiccionSelect.selectedIndex];
    const jurisdiccionSigla = (selectedOpt && selectedOpt.dataset && selectedOpt.dataset.sigla) ? selectedOpt.dataset.sigla : '';
    const nombre = document.getElementById('monitor-form-nombre').value.trim().toUpperCase();
    const errEl  = document.getElementById('monitor-form-error');
    errEl.style.display = 'none';

    if (!jurisdiccionCodigo) { errEl.textContent = 'Seleccion\u00e1 una jurisdicci\u00f3n.'; errEl.style.display = ''; return; }
    if (!nombre)             { errEl.textContent = 'Ingres\u00e1 el nombre de la parte.';    errEl.style.display = ''; return; }
    if (nombre.length < 6)   { errEl.textContent = 'El nombre debe tener al menos 6 caracteres (requerido por el SCW).'; errEl.style.display = ''; return; }
    if (!/^[A-Z0-9 \-\.\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC,]+$/.test(nombre)) {
        errEl.textContent = 'El nombre contiene caracteres no permitidos. Solo se admiten letras (sin \u00d1), n\u00fameros, espacios, guiones y puntos.';
        errEl.style.display = '';
        return;
    }

    const btn = document.getElementById('btnMonitorGuardarParte');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        let res;
        if (_monitorEditandoId) {
            res = await window.electronAPI.monitorEditarParte({
                id: _monitorEditandoId, nombre, jurisdiccionCodigo, jurisdiccionSigla
            });
        } else {
            res = await window.electronAPI.monitorAgregarParte({
                nombre, jurisdiccionCodigo, jurisdiccionSigla
            });
        }

        if (!res.success) {
            errEl.textContent = res.error || 'Error al guardar';
            errEl.style.display = '';
            return;
        }

        // Exito: ocultar formulario y recargar lista
        document.getElementById('monitor-form-parte').style.display = 'none';
        document.getElementById('btnMonitorAgregarParte').style.display = '';
        await cargarPartesMonitor();
        showNotification(_monitorEditandoId ? 'Parte actualizada' : 'Parte agregada', 'success');

    } catch (err) {
        errEl.textContent = err.message || 'Error inesperado';
        errEl.style.display = '';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
}

async function eliminarParteMonitor(id) {
    const parte = _monitorPartes.find(p => p.id === id);
    if (!confirm('Eliminar la parte "' + (parte ? parte.nombre_parte : id) + '"? Esta acci\u00f3n eliminar\u00e1 tambi\u00e9n sus expedientes.')) return;

    try {
        const res = await window.electronAPI.monitorEliminarParte(id);
        if (!res.success) {
            showNotification(res.error || 'Error al eliminar', 'error');
            return;
        }
        await cargarPartesMonitor();
        showNotification('Parte eliminada', 'success');
    } catch (err) {
        showNotification(err.message || 'Error inesperado', 'error');
    }
}

// ── Ver expedientes — una parte (parteId) o todas (null) ─────────────────────
async function verExpedientesMonitor(parteId, titulo) {
    document.getElementById('monitor-exp-titulo').textContent = titulo || '';
    document.getElementById('monitor-exp-loading').style.display = '';
    document.getElementById('monitor-exp-tabla-wrap').style.display = 'none';
    document.getElementById('monitor-exp-empty').style.display = 'none';
    switchMonitorTab('monitor-expedientes');

    try {
        // parteId=null → traer todos los expedientes de todas las partes
        const res = parteId === null
            ? await window.electronAPI.monitorGetAllExpedientes()
            : await window.electronAPI.monitorGetExpedientes(parteId);

        document.getElementById('monitor-exp-loading').style.display = 'none';

        if (!res.success) {
            document.getElementById('monitor-exp-empty').textContent = res.error || 'Error al cargar expedientes';
            document.getElementById('monitor-exp-empty').style.display = '';
            return;
        }

        const expedientes = res.expedientes || [];
        if (expedientes.length === 0) {
            document.getElementById('monitor-exp-empty').textContent = 'Sin expedientes en la línea base.';
            document.getElementById('monitor-exp-empty').style.display = '';
            return;
        }

        const mostrarParte = parteId === null; // columna extra cuando se muestran todas
        const thead = document.querySelector('#monitor-exp-tabla-wrap table thead tr');
        // Agregar / quitar columna "Parte" dinámicamente
        const thParte = thead.querySelector('.th-parte');
        if (mostrarParte && !thParte) {
            const th = document.createElement('th');
            th.className = 'th-parte';
            th.style.cssText = 'padding:8px 6px;text-align:left;border-bottom:1px solid #e5e7eb;';
            th.textContent = 'Parte';
            thead.insertBefore(th, thead.firstChild);
        } else if (!mostrarParte && thParte) {
            thParte.remove();
        }

        const tbody = document.getElementById('monitor-exp-tbody');
        tbody.innerHTML = expedientes.map(function(e) {
            const parteCell = mostrarParte
                ? '<td style="padding:7px 6px;font-size:11px;color:#6b7280;white-space:nowrap;">' +
                  escHtml((e.jurisdiccion_sigla || '') + ' · ' + (e.nombre_parte || '')) + '</td>'
                : '';
            return '<tr style="border-bottom:1px solid #f3f4f6;">' +
                parteCell +
                '<td style="padding:7px 6px;font-weight:500;color:#1d4ed8;white-space:nowrap;">' + escHtml(e.numero_expediente) + '</td>' +
                '<td style="padding:7px 6px;">' + escHtml(e.dependencia) + '</td>' +
                '<td style="padding:7px 6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(e.caratula) + '">' + escHtml(e.caratula) + '</td>' +
                '<td style="padding:7px 6px;">' + escHtml(e.situacion) + '</td>' +
                '<td style="padding:7px 6px;color:#6b7280;">' + escHtml(e.ultima_actuacion) + '</td>' +
            '</tr>';
        }).join('');

        document.getElementById('monitor-exp-tabla-wrap').style.display = '';

    } catch (err) {
        document.getElementById('monitor-exp-loading').style.display = 'none';
        document.getElementById('monitor-exp-empty').textContent = err.message || 'Error inesperado';
        document.getElementById('monitor-exp-empty').style.display = '';
    }
}

// ── Novedades ──────────────────────────────────────────────────────────────────
async function cargarNovedadesCount() {
    try {
        const res = await window.electronAPI.monitorGetNovedades();
        if (!res.success) return;
        const count = (res.novedades || []).length;
        const badge = document.getElementById('badge-novedades');
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    } catch (_) {}
}

async function loadMonitorNovedades() {
    document.getElementById('monitor-nov-loading').style.display = '';
    document.getElementById('monitor-nov-lista').style.display = 'none';
    document.getElementById('monitor-nov-empty').style.display = 'none';
    document.getElementById('monitor-nov-acciones').style.display = 'none';
    document.getElementById('monitor-nov-count').textContent = 'Cargando novedades...';

    try {
        const res = await window.electronAPI.monitorGetNovedades();
        document.getElementById('monitor-nov-loading').style.display = 'none';

        if (!res.success) {
            document.getElementById('monitor-nov-count').textContent = res.error || 'Error al cargar';
            return;
        }

        const novedades = res.novedades || [];
        document.getElementById('monitor-nov-count').textContent =
            novedades.length === 0 ? 'Sin novedades pendientes' : (novedades.length + ' novedad(es) pendiente(s)');

        // Actualizar badge
        const badge = document.getElementById('badge-novedades');
        if (novedades.length > 0) { badge.textContent = novedades.length; badge.style.display = ''; }
        else { badge.style.display = 'none'; }

        if (novedades.length === 0) {
            document.getElementById('monitor-nov-empty').style.display = '';
            return;
        }

        // Mostrar barra de acciones bulk y resetear check-all
        document.getElementById('monitor-nov-acciones').style.display = 'flex';
        document.getElementById('monitor-nov-check-all').checked = true;

        const lista = document.getElementById('monitor-nov-lista');
        lista.innerHTML = novedades.map(function(n) {
            const fecha = n.fecha_primera_deteccion
                ? new Date(n.fecha_primera_deteccion).toLocaleDateString('es-AR')
                : '\u2014';
            return '<div style="display:flex;align-items:flex-start;gap:8px;padding:10px 4px;border-bottom:1px solid #f3f4f6;">' +
                '<input type="checkbox" class="monitor-nov-check" data-id="' + n.id + '" checked style="margin-top:4px;flex-shrink:0;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">' +
                        '<span style="font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;">NUEVO</span>' +
                        '<span style="font-size:13px;font-weight:500;color:#1d4ed8;">' + escHtml(n.numero_expediente) + '</span>' +
                    '</div>' +
                    '<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">' + escHtml(n.nombre_parte || '') + ' &bull; ' + escHtml(n.jurisdiccion_sigla || '') + '</div>' +
                    '<div style="font-size:12px;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(n.caratula) + '">' + escHtml(n.caratula || '\u2014') + '</div>' +
                    '<div style="font-size:11px;color:#9ca3af;">Detectado: ' + fecha + '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        lista.style.display = '';

    } catch (err) {
        document.getElementById('monitor-nov-loading').style.display = 'none';
        document.getElementById('monitor-nov-count').textContent = err.message || 'Error inesperado';
    }
}

async function confirmarNovedad(id) {
    try {
        const res = await window.electronAPI.monitorConfirmarExp(id);
        if (!res.success) { showNotification(res.error || 'Error al confirmar', 'error'); return; }
        showNotification('Expediente confirmado y agregado a la base', 'success');
        await loadMonitorNovedades();
    } catch (err) { showNotification(err.message, 'error'); }
}

async function rechazarNovedad(id) {
    if (!confirm('Descartar esta novedad? Se eliminar\u00e1 del sistema.')) return;
    try {
        const res = await window.electronAPI.monitorRechazarExp(id);
        if (!res.success) { showNotification(res.error || 'Error al rechazar', 'error'); return; }
        showNotification('Novedad descartada', 'success');
        await loadMonitorNovedades();
    } catch (err) { showNotification(err.message, 'error'); }
}

// ── Ejecucion ──────────────────────────────────────────────────────────────────
async function handleConsultaInicial() {
    const seleccionadas = getPartesSeleccionadas().filter(p => !p.tiene_linea_base);
    if (seleccionadas.length === 0) {
        showNotification('No hay partes seleccionadas sin l\u00ednea base', 'warning');
        return;
    }
    closeModal('modalMonitor');
    await runMonitoreo('inicial', seleccionadas);
}

async function handleBuscarNovedades() {
    const seleccionadas = getPartesSeleccionadas().filter(p => p.tiene_linea_base);
    if (seleccionadas.length === 0) {
        showNotification('No hay partes seleccionadas con l\u00ednea base', 'warning');
        return;
    }
    closeModal('modalMonitor');
    await runMonitoreo('novedades', seleccionadas);
}

async function runMonitoreo(modo, partes) {
    if (isProcessRunning) {
        showNotification('Ya hay un proceso en ejecuci\u00f3n', 'warning');
        return;
    }

    try {
        if (!currentConfig?.seguridad?.modoHeadless && !isWindowPositioned) {
            addLog('info', 'Posicionando ventana a la derecha...');
            await window.electronAPI.positionLeft();
            isWindowPositioned = true;
            document.body.classList.add('window-positioned');
            const btn = document.getElementById('btnPositionLeft');
            if (btn) { btn.textContent = 'Restaurar'; btn.title = 'Restaurar ventana al centro'; }
        }

        addLog('info', 'Monitor ' + modo.toUpperCase() + ': ' + partes.length + ' parte(s)...');
        addLog('info', 'Preparando navegador Chrome... esto puede demorar unos segundos');
        showChromeLoadingIndicator();
        setProcessRunning(true);

        const result = await window.electronAPI.runMonitoreo({ modo, partes });

        if (!result.success) {
            addLog('error', 'Error: ' + result.error);
            setProcessRunning(false);
            showNotification('Error al iniciar el monitoreo', 'error');
        } else if (result.totalNuevos > 0) {
            showNotification(result.totalNuevos + ' novedad(es) detectada(s)', 'success');
        }
    } catch (error) {
        addLog('error', 'Error inesperado: ' + error.message);
        setProcessRunning(false);
        showNotification('Error inesperado en Monitor', 'error');
    }
}

// ============ SEGURIDAD — GESTOR DE CONTRASEÑAS ============

async function abrirNavegadorPJN() {
    try {
        addLog('info', '🌐 Abriendo navegador con perfil de automatizaciones...');
        const result = await window.electronAPI.abrirNavegadorPJN();
        if (result.success) {
            addLog('success', '✅ Navegador abierto en portalpjn.pjn.gov.ar');
        } else {
            addLog('error', '❌ Error al abrir navegador: ' + result.error);
        }
    } catch (error) {
        addLog('error', '❌ Error inesperado: ' + error.message);
    }
}

async function agregarPasswordSCW() {
    try {
        addLog('info', '🔑 Abriendo gestor de contraseñas de Chrome...');
        const result = await window.electronAPI.agregarPasswordSCW();
        if (result.success) {
            addLog('info', '✅ Chrome abierto. Completá la contraseña manualmente y presioná Guardar.');
        } else {
            addLog('error', '❌ Error al abrir gestor de contraseñas: ' + result.error);
        }
    } catch (error) {
        addLog('error', '❌ Error inesperado: ' + error.message);
    }
}

// ============ EXTENSIÓN CHROME ============

let _extDownloadData = null; // { path, version } guardados tras la última descarga

function _aplicarEstadoToggleExt(habilitada) {
    const track  = document.getElementById('extToggleTrack');
    const thumb  = document.getElementById('extToggleThumb');
    const label  = document.getElementById('extToggleLabel');
    const body   = document.getElementById('extConfigBody');
    const chk    = document.getElementById('toggleExtConfig');
    if (!track) return;
    chk.checked       = habilitada;
    track.style.background = habilitada ? '#3b82f6' : '#cbd5e1';
    thumb.style.left       = habilitada ? '20px' : '2px';
    label.textContent      = habilitada ? 'Extensión habilitada' : 'Extensión deshabilitada';
    body.style.display     = habilitada ? '' : 'none';
}

async function iniciarToggleExtension() {
    const habilitada = await window.electronAPI.getExtensionEnabled();
    _aplicarEstadoToggleExt(habilitada);
    if (habilitada) verificarVersionExtension();

    const chk = document.getElementById('toggleExtConfig');
    if (chk && !chk._extListenerAdded) {
        chk._extListenerAdded = true;
        chk.addEventListener('change', async () => {
            const val = chk.checked;
            _aplicarEstadoToggleExt(val);
            await window.electronAPI.setExtensionEnabled(val);
            if (val) verificarVersionExtension();
        });
    }
}

async function verificarVersionExtension() {
    const statusEl = document.getElementById('extVersionStatus');
    const btnEl    = document.getElementById('btnInstalarExtension');
    if (!statusEl) return;
    statusEl.textContent = 'Verificando versión...';
    statusEl.style.color = '#94a3b8';
    try {
        const r = await window.electronAPI.checkExtensionVersion();
        if (!r.localVersion) {
            statusEl.innerHTML = '❌ Extensión no descargada';
            statusEl.style.color = '#dc2626';
            btnEl.textContent = '🧩 Descargar extensión';
        } else if (r.needsUpdate) {
            statusEl.innerHTML = `⚠️ Nueva versión disponible: <strong>v${r.serverVersion}</strong> (instalada: v${r.localVersion})`;
            statusEl.style.color = '#d97706';
            btnEl.textContent = '⬇️ Actualizar extensión';
        } else {
            statusEl.innerHTML = `✅ Extensión v${r.localVersion} — Instalada y actualizada`;
            statusEl.style.color = '#16a34a';
            btnEl.textContent = '🧩 Descargar extensión';
        }
        // Restaurar ruta si la extensión ya está instalada
        if (r.localPath) {
            const pathEl = document.getElementById('extPathText');
            const result = document.getElementById('extDownloadResult');
            if (pathEl) pathEl.textContent = r.localPath;
            if (result) result.style.display = 'block';
        }
    } catch (_) {
        statusEl.textContent = 'No se pudo verificar la versión';
        statusEl.style.color = '#94a3b8';
    }
}

async function descargarExtension() {
    const btn    = document.getElementById('btnInstalarExtension');
    const result = document.getElementById('extDownloadResult');
    const pathEl = document.getElementById('extPathText');
    btn.disabled = true;
    btn.textContent = '⏳ Descargando...';
    document.getElementById('extDownloadResult').style.display = 'none';
    try {
        const r = await window.electronAPI.installExtension();
        if (!r.success) {
            btn.textContent = '🧩 Descargar extensión';
            btn.disabled = false;
            addLog('error', '❌ Error al descargar extensión: ' + (r.error || 'Error desconocido'));
            return;
        }
        _extDownloadData = { path: r.path, version: r.version };
        pathEl.textContent = r.path;
        result.style.display = 'block';
        // Auto-copiar al portapapeles
        try { await navigator.clipboard.writeText(r.path); mostrarMsgCopia(); } catch (_) {}
        btn.textContent = r.isNew ? '✅ Extensión descargada' : '✅ Ya actualizada';
        // Mostrar nota de actualización si había update pendiente
        if (r.isNew) {
            addLog('info', `✅ Extensión v${r.version} descargada en ${r.path}`);
        }
        verificarVersionExtension();
        setTimeout(() => {
            btn.textContent = '🧩 Descargar extensión';
            btn.disabled = false;
        }, 10000);
    } catch (err) {
        btn.textContent = '🧩 Descargar extensión';
        btn.disabled = false;
        addLog('error', '❌ Error: ' + err.message);
    }
}

function copiarRutaExtension() {
    const text = document.getElementById('extPathText')?.textContent;
    if (text) {
        navigator.clipboard.writeText(text).then(() => mostrarMsgCopia()).catch(() => {});
    }
}

function mostrarMsgCopia() {
    const msg = document.getElementById('extCopyMsg');
    if (!msg) return;
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2500);
}

async function generarPdfExtension() {
    if (!_extDownloadData) {
        // Intentar leer de la versión local
        const r = await window.electronAPI.checkExtensionVersion().catch(() => null);
        if (r?.localVersion && r?.localPath) {
            _extDownloadData = { path: r.localPath, version: r.localVersion };
        } else {
            addLog('warn', '⚠️ Primero descargá la extensión para generar el PDF');
            return;
        }
    }
    const btn = document.getElementById('btnGenerarPdfExt');
    btn.disabled = true;
    btn.textContent = '⏳ Generando PDF...';
    try {
        const r = await window.electronAPI.generateExtensionPdf(_extDownloadData);
        if (r.success) {
            btn.textContent = '✅ PDF generado — carpeta Descargas abierta';
        } else {
            btn.textContent = '📄 Descargar instrucciones en PDF';
            addLog('error', '❌ Error generando PDF: ' + r.error);
        }
    } catch (err) {
        btn.textContent = '📄 Descargar instrucciones en PDF';
    }
    btn.disabled = false;
    setTimeout(() => { btn.textContent = '📄 Descargar instrucciones en PDF'; }, 5000);
}

// ============ HELPERS DE TEST (solo para DevTools) ============
// Uso desde consola de DevTools:
//   __testQuota(85)   → muestra banner de advertencia (85%)
//   __testQuota(100)  → muestra banner de cuota agotada
//   __testQuota(0)    → oculta el banner
window.__testQuota = function(pct, subsystem = 'proc') {
    const banner = document.getElementById('quota-banner');
    const textEl = document.getElementById('quota-banner-text');
    if (!banner || !textEl) { console.error('Banner no encontrado'); return; }

    quotaBannerDismissed = false;

    if (pct < 80) {
        banner.style.display = 'none';
        console.log('Banner oculto (pct < 80)');
        return;
    }

    const labels = {
        proc: 'Procurar', batch: 'Batch', informe: 'Informe',
        monitor_novedades: 'Monitor Novedades', monitor_partes: 'Monitor Partes'
    };
    const label       = labels[subsystem] || subsystem;
    const isExhausted = pct >= 100;
    banner.style.background = isExhausted ? '#7f1d1d' : '#78350f';
    textEl.textContent = isExhausted
        ? `⛔ Agotaste tus ejecuciones de ${label} para este período. Contactá soporte o actualizá tu plan.`
        : `⚠️ Usaste el ${pct}% de tus ejecuciones de ${label}. Considerá actualizar tu plan.`;
    banner.style.display = 'flex';
    console.log(`Banner mostrado: ${pct}% en ${label}`);
};
