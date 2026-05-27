// ============ ESTADO GLOBAL ============
let isProcessRunning = false;
let currentConfig = null;
let consoleExpanded = false;
let isWindowPositioned = false;

// Helper: aplica/quita el modo ventana-posicionada
// - Auto-colapsa el sidebar INSTANTÁNEAMENTE antes de que la ventana se redimensione
//   para que content-area ya tenga el ancho completo cuando el resize llega
// - Al restaurar, recupera el estado previo del sidebar
function setPositioned(on) {
    const ml      = document.querySelector('.main-layout');
    const sidebar = document.querySelector('.sidebar');
    if (on) {
        // Colapsar sidebar sin animación (transición desactivada temporalmente)
        if (sidebar) sidebar.style.transition = 'none';
        ml?.classList.add('sidebar-collapsed');
        document.body.classList.add('window-positioned');
        requestAnimationFrame(() => { if (sidebar) sidebar.style.transition = ''; });
    } else {
        document.body.classList.remove('window-positioned');
        const wasCollapsed = localStorage.getItem('sidebar-collapsed') === '1';
        ml?.classList.toggle('sidebar-collapsed', wasCollapsed);
    }
    isWindowPositioned = on;
}

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
    loadNotifications().catch(() => {}); // Badge de notificaciones no leídas
    checkSubscriptionStatusBanner(); // Banner de estado de suscripción (v2.1)
    checkQuotaAlert();  // Mostrar banner si cuota >= 80%
    window.electronAPI.getPromoStatus().then(ps => { if (ps) checkPromoAlert(ps); }).catch(() => {});
    initChatWidget();   // Chat widget del asistente IA
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
    const modal = document.getElementById('update-modal');
    const text  = document.getElementById('update-banner-text');
    if (!modal || !text) return;

    text.textContent = `v${version} descargada y lista para instalar`;
    modal.style.display = 'flex';

    // Instalar ahora: cierra la app, instala y reabre
    document.getElementById('update-install-btn').addEventListener('click', async () => {
        addLog('info', '🔄 Instalando actualización y reiniciando la aplicación...');
        modal.style.display = 'none';
        await window.electronAPI.installUpdate();
    }, { once: true });

    // Más tarde: se instala automáticamente la próxima vez que el usuario cierre la app
    document.getElementById('update-later-btn').addEventListener('click', () => {
        modal.style.display = 'none';
        addLog('info', 'ℹ️ La actualización se instalará automáticamente al cerrar la app.');
    }, { once: true });
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

    // Estadísticas — botón cerrar
    bind('btnCloseStats', () => closeModal('modalStats'));

    // Seguridad — botones dentro del modal de configuración
    bind('btnAbrirNavegador',    abrirNavegadorPJN);
    bind('btnAgregarPasswordSCW', agregarPasswordSCW);
    // Extensión — abre Chrome directamente en la Chrome Web Store (no usa navegador por defecto)
    bind('btnInstalarExtension', () => {
        window.electronAPI.openUrlInChrome(
            'https://chromewebstore.google.com/detail/pjn-%E2%80%93-automatizaci%C3%B3n/aodnfemklhciagaglpggnclmbdhnhbme'
        );
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
        'procurar-hoy':   () => {
            const fecha = document.getElementById('sidebarFechaLimite')?.value?.trim() || '';
            if (fecha) runProcessFromSidebarFecha(fecha);
            else       runProcess();
        },
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
        'procurar-hoy':   '▶ Procurar',
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

    // Campo fecha límite en sidebar → guardar en config al cambiar
    document.getElementById('sidebarFechaLimite')?.addEventListener('change', async function () {
        const fecha = this.value.trim();
        if (!currentConfig) return;
        currentConfig.general.fechaLimite = fecha;
        // Sincronizar con el campo del modal de configuración
        const cfgField = document.getElementById('fechaLimite');
        if (cfgField) cfgField.value = fecha;
        // Persistir inmediatamente
        try { await window.electronAPI.saveConfig(currentConfig); } catch (_) { /* silencioso */ }
    });

    // ===== VER TOUR =====
    document.getElementById('btnSidebarTour')?.addEventListener('click', () => {
        if (typeof window.startAppTour === 'function') window.startAppTour();
        else addLog('info', '🗺️ Abriendo tour...');
    });

    // ===== ASISTENTE IA =====
    document.getElementById('btnSidebarAsistente')?.addEventListener('click', () => {
        openAsistente();
    });

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

// ============ ASISTENTE IA ============
const FAQ_ITEMS = [
    // --- PROCURACIÓN ---
    { cat: 'procuracion', q: '¿Cómo procuro mis expedientes?', a: 'Hacé click en "Procurar" en el sidebar o en el botón ▶ Procurar. El sistema accede automáticamente al SCW del PJN con tus credenciales guardadas en Chrome.' },
    { cat: 'procuracion', q: '¿Puedo procurar solo algunos expedientes?', a: 'Sí. En la sección Procuración podés seleccionar expedientes individuales antes de ejecutar, o usar "Procurar seleccionados" para procurar un subconjunto.' },
    { cat: 'procuracion', q: '¿Cuánto tarda la procuración?', a: 'Depende de la cantidad de expedientes y la velocidad del PJN. Con conexión normal, cada expediente tarda entre 5 y 15 segundos.' },
    { cat: 'procuracion', q: '¿Puedo usar la computadora mientras procura?', a: 'Sí, pero evitá usar Chrome durante la ejecución. El sistema opera Chrome en segundo plano; interrupirlo puede causar errores.' },
    { cat: 'procuracion', q: '¿Puedo procurar con fecha personalizada?', a: 'Sí. Usá el botón "Procurar con fecha…" para seleccionar un rango de fechas distinto al predeterminado.' },
    // --- INFORME ---
    { cat: 'informe', q: '¿Cómo genero un informe?', a: 'Click en "Informe" en el sidebar. Podés procesar un expediente individual ingresando el número o un lote cargando un archivo Excel con la lista.' },
    { cat: 'informe', q: '¿Qué formato debe tener el Excel para informe en lote?', a: 'Una columna con encabezado "expediente" y los números en el formato estándar del PJN (ej: 12345/2023). Descargá la plantilla desde la sección Informe.' },
    { cat: 'informe', q: '¿El informe genera un PDF?', a: 'El informe genera un archivo Excel con el estado de cada expediente. El PDF de cada movimiento se descarga por separado si el sistema lo detecta disponible.' },
    { cat: 'informe', q: '¿Puedo detener un informe a mitad?', a: 'Sí, con el botón "Detener". Los expedientes ya procesados se guardan; el informe quedará parcial hasta ese punto.' },
    // --- MONITOR ---
    { cat: 'monitor', q: '¿Qué es el Monitor de partes?', a: 'Controlá automáticamente si aparecen nuevos expedientes vinculados a determinadas partes (personas o empresas). Configurá las partes en la sección Monitor.' },
    { cat: 'monitor', q: '¿Cómo agrego una parte al monitor?', a: 'En la sección Monitor, hacé click en "+ Agregar parte", ingresá el nombre o CUIT/CUIL y guardá. El sistema buscará expedientes vinculados en cada ejecución.' },
    { cat: 'monitor', q: '¿Con qué frecuencia se actualiza el monitor?', a: 'El monitor se actualiza cada vez que ejecutás la sección Monitor manualmente, o si configuraste una frecuencia automática en Configuración.' },
    { cat: 'monitor', q: '¿Cuántas partes puedo monitorear?', a: 'Depende de tu plan: COMBO_PROMO permite 3 partes activas, PRO permite 10, ENTERPRISE ilimitadas.' },
    // --- EXTENSIÓN ---
    { cat: 'extension', q: '¿Cómo instalo la extensión de Chrome?', a: 'Buscá "Procurador SCW" en la Chrome Web Store (chromewebstore.google.com/detail/aodnfemklhciagaglpggnclmbdhnhbme) o desde la sección Descargas del portal web. Hacé click en "Agregar a Chrome" y aceptá los permisos.' },
    { cat: 'extension', q: '¿Cómo actualizo la extensión?', a: 'La extensión se actualiza automáticamente desde la Chrome Web Store. También podés ir a chrome://extensions y hacer click en el ícono de actualizar.' },
    { cat: 'extension', q: '¿Para qué sirve la extensión?', a: 'La extensión autocompleta el número de expediente (jurisdicción, número y año) en los módulos del PJN: SCW, Escritos, Notificaciones y DEOX, evitando la escritura manual.' },
    { cat: 'extension', q: '¿La extensión funciona sin la app Electron?', a: 'Sí. Con el plan EXTENSION_PROMO tenés acceso solo a la extensión sin necesitar instalar la app de escritorio.' },
    { cat: 'extension', q: '¿Chrome muestra un aviso al instalar la extensión?', a: 'Es normal para extensiones nuevas. Hacé click en "Continuar a la instalación". No indica ningún riesgo — la extensión está aprobada por Google.' },
    // --- CUENTA Y PLAN ---
    { cat: 'cuenta', q: '¿Cómo cambio de plan?', a: 'Abrí el portal web en api.procuradortool.com/usuarios/, ingresá a "Mi Plan" y hacé click en "Ver planes disponibles". Los cambios se aplican de inmediato o al inicio del próximo ciclo.' },
    { cat: 'cuenta', q: '¿Puedo usar la app en más de una computadora?', a: 'No. La licencia está vinculada a un dispositivo. Para cambiar de equipo, contactá al soporte.' },
    { cat: 'cuenta', q: '¿Cómo cancelo mi suscripción?', a: 'Ingresá al portal web en api.procuradortool.com/usuarios/, sección "Facturación", y hacé click en "Cancelar suscripción". Conservás el acceso hasta fin del período pago.' },
    { cat: 'cuenta', q: '¿Dónde veo cuántas ejecuciones me quedan?', a: 'En la sección "Mi Cuenta" de la app (ícono de usuario en la barra lateral) o en el portal web, sección "Mi Plan".' },
    { cat: 'cuenta', q: '¿Qué es el período de prueba?', a: 'Al verificar tu email recibís 20 ejecuciones gratuitas válidas por 365 días. Podés usar toda la funcionalidad sin restricciones. El contador aparece en la sección Mi Cuenta (arriba a la derecha) y en el portal web → Mi Plan.' },
    { cat: 'cuenta', q: '¿Qué pasa cuando se agotan los usos de prueba?', a: 'Al llegar a 20 ejecuciones, la cuenta queda en espera de activación. El administrador revisa y activa manualmente. Si necesitás continuar antes, abrí un ticket de soporte.' },
    // --- ERRORES FRECUENTES ---
    { cat: 'errores', q: '¿Por qué dice "Verificá tu email para usar la aplicación"?', a: 'Tu cuenta requiere verificación de email antes de poder ejecutar procesos. Revisá tu casilla (incluyendo spam) y hacé click en el enlace del email que te enviamos al registrarte. Si no lo encontrás, podés reenviarlo desde el portal web.' },
    { cat: 'errores', q: '¿Qué significa que el login al PJN falló?', a: 'El sistema no pudo ingresar al SCW. Verificá que Chrome tenga guardada la contraseña (botón "Agregar contraseña SCW" en la app). Si la contraseña del PJN cambió, actualizala en Chrome primero.' },
    { cat: 'errores', q: '¿Por qué se colgó el proceso?', a: 'Podés detenerlo con el botón "Detener". Si se repite, revisá que Chrome no tenga otras pestañas abiertas del PJN bloqueando el acceso y que tu sesión PJN esté vigente.' },
    { cat: 'errores', q: '¿Por qué dice "proceso activo en otro dispositivo"?', a: 'El sistema tiene un candado anti-concurrencia. Asegurate de no tener otra instancia de la app abierta. Si el error persiste después de cerrar todo, esperá 2 minutos y reintentá.' },
    { cat: 'errores', q: '¿Dónde están los archivos descargados?', a: 'En la carpeta configurada en Configuración > General > Carpeta de descargas. También podés acceder desde "Abrir descargas" en el sidebar.' },
    { cat: 'errores', q: '¿Necesito dejar Chrome abierto?', a: 'No. El sistema abre y cierra Chrome automáticamente en segundo plano. No interferís con el proceso salvo que abras ventanas del PJN manualmente.' },
    { cat: 'errores', q: '¿Qué hago si la app no arranca?', a: 'Cerrá Chrome completamente si estaba abierto, esperá 10 segundos y volvé a abrir la app. Si el problema persiste, usá el botón de soporte para abrir un ticket.' },
    // --- PRIVACIDAD Y SEGURIDAD ---
    { cat: 'privacidad', q: '¿Mis credenciales del PJN pasan por sus servidores?', a: 'No. Las contraseñas del PJN se almacenan exclusivamente en el gestor de contraseñas de tu Chrome y nunca salen de tu equipo. Procurador solo coordina la automatización.' },
    { cat: 'privacidad', q: '¿Cómo se protegen mis datos?', a: 'Los scripts de automatización están cifrados con AES-256 y se firman digitalmente. La comunicación con el servidor usa HTTPS/TLS. Tu sesión se valida con token JWT de corta duración.' },
    { cat: 'privacidad', q: '¿Procurador guarda mis expedientes?', a: 'No se almacena el contenido de los expedientes en los servidores. Los archivos de resultado (Excel, PDF) quedan únicamente en tu equipo.' },
    { cat: 'privacidad', q: '¿Puedo eliminar mi cuenta?', a: 'Sí. Cancelá tu suscripción desde el portal web y luego contactá al soporte solicitando la eliminación completa de datos. Cumplimos con las normativas de protección de datos.' },
];

const FAQ_CATS = [
    { id: 'todas',      label: 'Todas' },
    { id: 'procuracion', label: 'Procuración' },
    { id: 'informe',    label: 'Informe' },
    { id: 'monitor',    label: 'Monitor' },
    { id: 'extension',  label: 'Extensión' },
    { id: 'cuenta',     label: 'Cuenta' },
    { id: 'errores',    label: 'Errores' },
    { id: 'privacidad', label: 'Privacidad' },
];

let asistenteMsgs = [];

function openAsistente() {
    setupAsistente();
    openModal('modalAsistente');
}

function setupAsistente() {
    const faqList    = document.getElementById('faqList');
    const faqSearch  = document.getElementById('faqSearch');
    const faqPills   = document.getElementById('faqPills');
    const btnSop     = document.getElementById('btnAsistenteSoporte');

    if (!faqList) return;

    let activeCat = 'todas';

    // Renderizar pills de categoría
    if (faqPills) {
        faqPills.innerHTML = FAQ_CATS.map(c => `
            <button class="faq-pill${c.id === 'todas' ? ' active' : ''}" data-cat="${c.id}">
                ${escHtml(c.label)}
            </button>`
        ).join('');

        faqPills.querySelectorAll('.faq-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                activeCat = btn.dataset.cat;
                faqPills.querySelectorAll('.faq-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderFaq(document.getElementById('faqSearch')?.value || '');
            });
        });
    }

    function renderFaq(filter = '') {
        const q = filter.toLowerCase().trim();
        let items = activeCat === 'todas' ? FAQ_ITEMS : FAQ_ITEMS.filter(f => f.cat === activeCat);
        if (q) items = items.filter(f => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));

        faqList.innerHTML = items.length === 0
            ? '<p style="padding:16px;color:var(--text-3);font-size:12.5px;text-align:center">Sin resultados. Intentá con otras palabras.</p>'
            : items.map((f, i) => `
                <div class="faq-item" data-idx="${i}">
                    <div class="faq-question">
                        <span>${escHtml(f.q)}</span>
                        <span class="faq-question-arrow">▸</span>
                    </div>
                    <div class="faq-answer">${escHtml(f.a)}</div>
                </div>`
            ).join('');

        // Toggle expand — usa clase CSS .open en .faq-item
        faqList.querySelectorAll('.faq-question').forEach(div => {
            div.addEventListener('click', () => {
                const item = div.closest('.faq-item');
                const isOpen = item.classList.contains('open');
                faqList.querySelectorAll('.faq-item').forEach(it => it.classList.remove('open'));
                if (!isOpen) item.classList.add('open');
            });
        });
    }

    // Init
    renderFaq();

    // Search — replace handler to avoid stacking listeners
    const newSearch = faqSearch?.cloneNode(true);
    faqSearch?.parentNode?.replaceChild(newSearch, faqSearch);
    newSearch?.addEventListener('input', e => renderFaq(e.target.value));

    // "Abrir chat" → abre el portal web en la sección Asistente IA (con auto-login)
    const newBtn = btnSop?.cloneNode(true);
    btnSop?.parentNode?.replaceChild(newBtn, btnSop);
    newBtn?.addEventListener('click', () => {
        closeModal('modalAsistente');
        openPortalSection('ia');
    });
}

// ============ CHAT WIDGET — ASISTENTE IA ============

function initChatWidget() {
    const chatBubbleBtn  = document.getElementById('chatBubbleBtn');
    const chatMinimizeBtn = document.getElementById('chatMinimizeBtn');
    const chatCloseBtn   = document.getElementById('chatCloseBtn');
    const chatTicketBtn  = document.getElementById('chatTicketBtn');
    const chatSendBtn    = document.getElementById('chatSendBtn');
    const chatInput      = document.getElementById('chatInput');

    if (!chatBubbleBtn) return;

    chatBubbleBtn.addEventListener('click', openChatWindow);

    chatMinimizeBtn?.addEventListener('click', () => {
        document.getElementById('chatWindow').style.display = 'none';
        chatBubbleBtn.style.display = 'flex';
    });

    chatCloseBtn?.addEventListener('click', closeChatWidget);

    // Ticket 🎫 → abre el portal web en la sección nuevo-ticket
    chatTicketBtn?.addEventListener('click', () => {
        closeChatWidget();
        openPortalSection('nuevo-ticket');
    });

    chatSendBtn?.addEventListener('click', sendChatMessage);
    chatInput?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
}

function openChatWindow() {
    const chatWidget    = document.getElementById('chatWidget');
    const chatBubbleBtn = document.getElementById('chatBubbleBtn');
    const chatWindow    = document.getElementById('chatWindow');
    const chatMessages  = document.getElementById('chatMessages');

    if (!chatWidget) return;
    chatWidget.classList.remove('chat-widget--hidden');
    chatBubbleBtn.style.display = 'none';
    chatWindow.style.display    = 'flex';

    // Saludo inicial la primera vez
    if (chatMessages && chatMessages.children.length === 0) {
        addChatMsg('bot', '¡Hola! Soy el asistente de Procurador SCW 🤖\n\n¿En qué puedo ayudarte? Podés escribir tu consulta o buscarla en las preguntas frecuentes.');
    }
    document.getElementById('chatInput')?.focus();
}

function closeChatWidget() {
    const chatWidget = document.getElementById('chatWidget');
    chatWidget?.classList.add('chat-widget--hidden');
    document.getElementById('chatWindow').style.display    = 'none';
    document.getElementById('chatBubbleBtn').style.display = 'none';
    // Limpiar historial al cerrar completamente
    const msgs = document.getElementById('chatMessages');
    if (msgs) msgs.innerHTML = '';
}

function addChatMsg(from, text) {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = `chat-message chat-message--${from}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
}

function getBotResponse(input) {
    const q = input.toLowerCase().trim();

    // Buscar match semántico en FAQ (palabras largas de la pregunta)
    for (const f of FAQ_ITEMS) {
        const words = f.q.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        if (words.some(w => q.includes(w))) return f.a;
    }

    // Helper: devuelve la respuesta del primer FAQ que matchea la categoría dada
    const byCat = cat => FAQ_ITEMS.find(f => f.cat === cat)?.a || '';

    // Intents por keyword → categoría o respuesta directa
    if (/procur|expedi|scw|jurisdicci/.test(q))                return byCat('procuracion');
    if (/login|clave|contrase|password|credencial/.test(q))    return FAQ_ITEMS.find(f => f.cat === 'errores' && /login/.test(f.q.toLowerCase()))?.a || byCat('errores');
    if (/colg|trabó|bloqueó|detuvo|cuelg|tarda/.test(q))      return FAQ_ITEMS.find(f => /colgó/.test(f.q))?.a || byCat('errores');
    if (/plan|cambiar|upgrade|precio|suscri/.test(q))          return FAQ_ITEMS.find(f => f.cat === 'cuenta' && /plan/.test(f.q.toLowerCase()))?.a || byCat('cuenta');
    if (/descarg|archivo|excel|carpeta/.test(q))               return FAQ_ITEMS.find(f => /descargados/.test(f.q))?.a || '';
    if (/monitor|parte|novel/.test(q))                         return byCat('monitor');
    if (/informe|report|lote/.test(q))                         return byCat('informe');
    if (/candado|concurrencia|activo.*otro|otro.*activo/.test(q)) return FAQ_ITEMS.find(f => /activo.*dispositivo|dispositivo.*activo/.test(f.q.toLowerCase()))?.a || byCat('errores');
    if (/extensi[oó]n|store|chrome web/.test(q))               return byCat('extension');
    if (/navegador|browser|cerrar chrome/.test(q))             return FAQ_ITEMS.find(f => /dejar.*abierto|navegador/i.test(f.q))?.a || byCat('errores');
    if (/privacidad|contraseña.*pjn|pjn.*contrase|seguridad|cifr/.test(q)) return byCat('privacidad');
    if (/ejecuci|cuántas|cuotas|restante/.test(q))            return FAQ_ITEMS.find(f => /cuántas ejecuciones/i.test(f.q))?.a || byCat('cuenta');

    return null; // null = sin match local → llamar a la API
}

// Llama al endpoint de IA del backend como fallback
async function getAIResponse(message) {
    try {
        const resp = await window.electronAPI.aiChat(message);
        if (resp?.success && resp.reply) return resp.reply;
        return resp?.error || 'No pude obtener una respuesta del asistente. Abrí un ticket con el botón 🎫.';
    } catch (e) {
        return 'No pude obtener una respuesta del asistente. Abrí un ticket con el botón 🎫.';
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text  = input?.value?.trim();
    if (!text) return;

    input.value = '';
    addChatMsg('user', text);

    // Indicador "escribiendo..."
    const typing = addChatMsg('typing', '⋯ escribiendo');

    // Intentar match local primero
    const localAnswer = getBotResponse(text);

    if (localAnswer) {
        setTimeout(() => {
            typing?.remove();
            addChatMsg('bot', localAnswer);
        }, 500);
    } else {
        // Fallback a Claude Haiku via backend
        const aiReply = await getAIResponse(text);
        typing?.remove();
        addChatMsg('bot', aiReply);
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
function _updateBannerVisibility() {
    const anyModalOpen = document.querySelector('.modal.active') !== null;
    ['subscription-status-banner', 'quota-banner', 'promo-banner'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (anyModalOpen) {
            el.dataset.hiddenByModal = el.style.display !== 'none' ? '1' : '0';
            el.style.display = 'none';
        } else if (el.dataset.hiddenByModal === '1') {
            el.style.display = 'flex';
            delete el.dataset.hiddenByModal;
        }
    });
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
    _updateBannerVisibility();

    // Cargar estadísticas si se abre el modal de stats
    if (modalId === 'modalStats') {
        loadStatistics();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    _updateBannerVisibility();
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
    const sidebarFecha = document.getElementById('sidebarFechaLimite');
    if (sidebarFecha) sidebarFecha.value = config.general.fechaLimite || '';
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
            // Sincronizar campo de fecha en sidebar
            const sidebarFecha = document.getElementById('sidebarFechaLimite');
            if (sidebarFecha) sidebarFecha.value = config.general.fechaLimite || '';
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
            setPositioned(true);                              // colapsar sidebar ANTES del resize
            await window.electronAPI.positionLeft();
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
            setPositioned(true);
            await window.electronAPI.positionLeft();
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

// Procurar desde fecha límite configurada en la sidebar (sin modal)
async function runProcessFromSidebarFecha(fecha) {
    const regex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!regex.test(fecha)) {
        showNotification('Formato de fecha inválido (use DD/MM/YYYY)', 'error');
        return;
    }

    if (isProcessRunning) {
        showNotification('Ya hay un proceso en ejecución', 'warning');
        return;
    }

    try {
        if (!currentConfig?.seguridad?.modoHeadless && !isWindowPositioned) {
            addLog('info', '📐 Posicionando ventana a la derecha...');
            setPositioned(true);
            await window.electronAPI.positionLeft();
            const btn = document.getElementById('btnPositionLeft');
            if (btn) { btn.textContent = '◨ Restaurar'; btn.title = 'Restaurar ventana al centro'; }
        }

        addLog('info', `📅 Procurando desde fecha: ${fecha}...`);
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

            // Valores principales
            const elProc = document.getElementById('statProcuracion');
            const elInf  = document.getElementById('statInformes');
            const elMon  = document.getElementById('statMonitoreo');
            const elTasa = document.getElementById('statTasaExito');
            if (elProc) elProc.textContent = (stats.procuracion ?? 0).toLocaleString('es-AR');
            if (elInf)  elInf.textContent  = (stats.informes    ?? 0).toLocaleString('es-AR');
            if (elMon)  elMon.textContent  = (stats.monitoreo   ?? 0).toLocaleString('es-AR');
            if (elTasa) elTasa.textContent = stats.tasaExito != null ? `${stats.tasaExito}%` : '—';

            // Deltas (opcionales según API)
            setStatDelta('statProcuracionDelta', stats.deltaProcuracion);
            setStatDelta('statInformesDelta',    stats.deltaInformes);
            setStatDelta('statMonitoreoDelta',   stats.deltaMonitoreo);
            setStatDelta('statTasaExitoDelta',   stats.deltaTasaExito);

            // Última ejecución
            const elUltimo = document.getElementById('statUltimoProceso');
            if (elUltimo) {
                if (stats.ultimoProcesoTimestamp) {
                    const fecha = new Date(stats.ultimoProcesoTimestamp);
                    elUltimo.textContent = fecha.toLocaleString('es-AR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    });
                } else {
                    elUltimo.textContent = '—';
                }
            }

            addLog('info', '📊 Estadísticas actualizadas');
        }
    } catch (error) {
        addLog('error', `❌ Error al cargar estadísticas: ${error.message}`);
    }
}

function setStatDelta(elId, value) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (value == null) { el.textContent = '—'; el.className = 'stat-delta'; return; }
    const isNeg = value < 0;
    el.textContent = (isNeg ? '↓ ' : '↑ ') + Math.abs(value) + (typeof value === 'string' ? '' : '');
    el.className   = 'stat-delta' + (isNeg ? ' neg' : '');
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

        // (progreso de header eliminado)

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


        // Verificar si se alcanzó el 80% de cuota después de la ejecución
        checkQuotaAlert();
    });
}

// ============ ACTUALIZAR HEADER ============
async function updateHeaderInfo() {
    const headerSession = document.getElementById('headerSession');
    if (headerSession) {
        headerSession.textContent = 'Sesión: Activa';
    }
}

// ============ ESTADO DEL PROCESO ============
function setProcessRunning(running) {
    isProcessRunning = running;

    const toggleInput = document.getElementById('browserToggle');

    if (running) {
        if (toggleInput) toggleInput.checked = false;
    } else {
        updateStatusBar('Inactivo', '');
        // Si el toggle estaba ON al terminar, restaurar ventana Electron
        if (toggleInput?.checked) {
            toggleInput.checked = false;
            window.electronAPI.restoreWindow().catch(() => {});
            setPositioned(false);
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
                setPositioned(true);
                await window.electronAPI.positionLeft();
                if (btn) { btn.textContent = '◨ Restaurar'; btn.title = 'Restaurar ventana al centro'; }
            }
        } else {
            // Chrome oculto → Electron vuelve a posición normal
            if (isWindowPositioned) {
                await window.electronAPI.restoreWindow();
                setPositioned(false);
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
 * Usa un modal centrado (no una barra fija) para mejor visibilidad y accesibilidad.
 */
function showLoginManualAlert(cuit, message) {
    // Log en consola de la app
    addLog('warning', `🔐 Login manual requerido para CUIT ${cuit}`);

    // Remover alerta previa si existe
    const prev = document.getElementById('__psc_manual_alert');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = '__psc_manual_alert';
    overlay.style.cssText = [
        'position:fixed', 'inset:0',
        'z-index:99999',
        'background:rgba(0,0,0,0.6)',
        'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    overlay.innerHTML = `
        <div style="
            background:#0f172a;
            border:1px solid rgba(245,158,11,0.4);
            border-radius:14px;
            padding:26px 24px 20px;
            width:400px;
            max-width:90vw;
            box-shadow:0 24px 60px rgba(0,0,0,0.8);
            font-family:var(--font,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);
        ">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                <div style="width:44px;height:44px;background:#422006;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🔐</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:15px;font-weight:700;color:#fef3c7;">Acción requerida</div>
                    <div style="font-size:12px;color:#92400e;margin-top:2px;">CUIT ${escapeHtml(String(cuit))}</div>
                </div>
            </div>
            <p style="font-size:13px;color:#fcd34d;line-height:1.65;margin:0 0 20px;">
                ${escapeHtml(message)}
            </p>
            <div style="display:flex;justify-content:flex-end;">
                <button id="__psc_manual_alert_btn"
                        style="background:#f59e0b;border:none;color:#0f172a;padding:9px 20px;
                               border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;
                               font-family:var(--font,sans-serif);">
                    Entendido
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('__psc_manual_alert_btn')
        .addEventListener('click', () => overlay.remove());

    // También cerrar al hacer click en el fondo oscuro
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
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
            document.getElementById('cuenta-notif').style.display   = tabName === 'notif'   ? '' : 'none';
            if (tabName === 'plan')  loadAccountData();
            if (tabName === 'notif') loadNotifications();
            // soporte: no carga tickets — redirige al portal web
        });
    });

    // Tab Soporte → portal web (tickets y nuevo ticket se gestionan desde el portal)
    document.getElementById('btnNuevoTicket')?.addEventListener('click', () => {
        closeModal('modalCuenta');
        openPortalSection('nuevo-ticket');
    });
    document.getElementById('btnIrPortalSoporte')?.addEventListener('click', () => {
        closeModal('modalCuenta');
        openPortalSection('soporte');
    });
    document.getElementById('btnVerWebMiCuenta')?.addEventListener('click', () => {
        closeModal('modalCuenta');
        openPortalSection('plan');
    });
    // Listeners legacy (vistas internas — mantenidas pero no accesibles desde la UI)
    document.getElementById('btnBackTickets')?.addEventListener('click', () => showSoporteView('lista'));
    document.getElementById('btnBackTicketsDetalle')?.addEventListener('click', () => showSoporteView('lista'));
    document.getElementById('btnEnviarTicket')?.addEventListener('click', submitNewTicket);
    document.getElementById('btnEnviarReply')?.addEventListener('click', submitTicketReply);

    document.getElementById('btnMarkAllReadCuenta')?.addEventListener('click', async () => {
        try {
            await window.electronAPI.markNotificationRead(null); // null = marcar todas
            await loadNotifications();
        } catch (_) {}
    });

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

        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        setTxt('ci-email',  a.email || '—');
        setTxt('ci-cuit',   a.cuit  || '(sin CUIT)');

        // Plan display name (new format from API) or backward compat
        const planName = (typeof a.plan === 'object' ? a.plan?.displayName || a.plan?.name : a.plan) || '—';
        setTxt('ci-plan', planName);

        const statusMap = {
            active:    '🟢 Activo',
            cancelled: '🔴 Cancelado',
            expired:   '🟠 Vencido',
            suspended: '⚫ Suspendido'
        };
        setTxt('ci-status', statusMap[a.status] || a.status || '—');

        setTxt('ci-expira', a.expiresAt
            ? new Date(a.expiresAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—');

        setTxt('ci-device', a.machineBound ? 'Vinculado ✅' : 'No vinculado');

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

        // Aviso de método de pago faltante en sección Cuenta
        const trialBannerEl = document.getElementById('cuenta-trial-banner');
        if (trialBannerEl) {
            if (a.registrationStatus === 'pending_email') {
                trialBannerEl.style.display = '';
                trialBannerEl.innerHTML = `
                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
                        <span style="font-size:22px;flex-shrink:0">📧</span>
                        <div>
                            <div style="font-weight:700;color:#92400e;font-size:13px;margin-bottom:4px">Email pendiente de verificación</div>
                            <div style="color:#78350f;font-size:12px;line-height:1.5">Revisá tu casilla de correo y hacé click en el enlace de verificación para activar el período de prueba. Mientras tanto la aplicación está bloqueada.</div>
                        </div>
                    </div>`;
            } else if (a.registrationStatus === 'pending_activation') {
                const used  = a.usageCount ?? 0;
                const limit = a.usageLimit ?? 20;
                const rem   = Math.max(0, limit - used);
                const pct   = Math.min(100, Math.round((used / limit) * 100));
                const barColor = rem <= 5 ? '#dc2626' : rem <= 10 ? '#d97706' : '#16a34a';
                trialBannerEl.style.display = '';
                trialBannerEl.innerHTML = `
                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:16px">
                        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                            <div>
                                <span style="font-weight:700;color:#92400e;font-size:13px">⏳ Período de prueba</span>
                                <span style="color:#78350f;font-size:12px;margin-left:8px">El administrador activará tu cuenta en breve</span>
                            </div>
                            <span style="font-size:18px;font-weight:800;color:${barColor}">${used}<span style="font-size:12px;font-weight:500;color:#92400e"> / ${limit} usos utilizados</span></span>
                        </div>
                        <div style="background:#fde68a;border-radius:4px;height:7px;overflow:hidden">
                            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width .3s"></div>
                        </div>
                        ${rem <= 5 ? `<div style="margin-top:7px;font-size:12px;color:#991b1b;font-weight:600">🔴 Quedan pocos usos. Contactá al administrador para activar tu cuenta.</div>` : ''}
                    </div>`;
            } else if (!a.paymentProvider && a.registrationStatus === 'active') {
                // Banner: sin método de pago
                trialBannerEl.style.display = '';
                trialBannerEl.innerHTML = `
                    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;margin-bottom:16px">
                        <span style="font-size:20px">⚠️</span>
                        <div style="flex:1">
                            <div style="font-weight:600;color:#856404;font-size:13px">Sin método de pago configurado</div>
                            <div style="color:#6c5700;font-size:12px;margin-top:2px">Configurá tu método de pago para continuar usando el servicio sin interrupciones.</div>
                        </div>
                        <button id="btn-ir-portal-cuenta"
                            style="background:#ffc107;border:none;color:#333;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
                            Configurar pago
                        </button>
                    </div>`;
                document.getElementById('btn-ir-portal-cuenta')?.addEventListener('click', () => openPortalSection('facturacion'));
            } else if (a.paymentProvider && a.trialBonusUntil && new Date(a.trialBonusUntil) > new Date()) {
                // Banner: bonus de bienvenida activo
                const bonusDate = new Date(a.trialBonusUntil).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                trialBannerEl.style.display = '';
                trialBannerEl.innerHTML = `
                    <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;margin-bottom:16px">
                        <span style="font-size:20px">🎁</span>
                        <div style="flex:1">
                            <div style="font-weight:600;color:#065f46;font-size:13px">Bonus de bienvenida activo</div>
                            <div style="color:#047857;font-size:12px;margin-top:2px">Tenés +20 usos de prueba sumados a tu plan, válidos hasta el ${bonusDate}.</div>
                        </div>
                    </div>`;
            } else {
                trialBannerEl.style.display = 'none';
                trialBannerEl.innerHTML = '';
            }
        }

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

// ============ NOTIFICACIONES IN-APP ============
async function loadNotifications() {
    try {
        const result = await window.electronAPI.getNotifications();
        if (!result.success) return;

        const notifs  = result.notifications || [];
        const unread  = notifs.filter(n => !n.read);
        const count   = unread.length;

        // Badge en sidebar
        const badge = document.getElementById('notif-badge');
        if (badge) {
            badge.textContent    = count;
            badge.style.display  = count > 0 ? '' : 'none';
        }

        // Badge en la pestaña del modal
        const tabBadge = document.getElementById('cuenta-notif-badge');
        if (tabBadge) {
            tabBadge.textContent   = count;
            tabBadge.style.display = count > 0 ? '' : 'none';
        }

        // Texto de pestaña en el botón (solo si visible el panel de notif)
        const tabBtn = document.getElementById('tab-notif-btn');
        if (tabBtn) {
            tabBtn.childNodes[0].textContent = `🔔 Notificaciones `;
        }

        // Panel de notificaciones (si está visible)
        const countEl     = document.getElementById('notif-tab-count');
        const listEl      = document.getElementById('notif-tab-list');
        const markAllBtn  = document.getElementById('btnMarkAllReadCuenta');

        if (countEl) countEl.textContent = notifs.length > 0 ? `${notifs.length} notificación${notifs.length !== 1 ? 'es' : ''}` : 'Sin notificaciones';
        if (markAllBtn) markAllBtn.style.display = unread.length > 0 ? '' : 'none';

        if (listEl) {
            if (notifs.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:24px;font-size:13px">No tenés notificaciones</div>';
            } else {
                const typeIcon = { account_activated:'✅', account_suspended:'🚫', account_reactivated:'🔓', account_rejected:'❌', plan_changed:'📦', plan_downgrade_scheduled:'⏳', cancellation_scheduled:'🗓️', email_verified:'📧', trial_review_pending:'🔍', reactivation_rejected:'❌', test_badge:'🔔' };
                listEl.innerHTML = notifs.map(n => {
                    const icon = typeIcon[n.type] || '🔔';
                    const date = new Date(n.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
                    const readStyle = n.read ? 'opacity:0.6' : 'font-weight:600';
                    return `<div style="padding:10px 0;border-bottom:1px solid var(--border);${readStyle}">
                        <div style="display:flex;gap:8px;align-items:flex-start">
                            <span style="font-size:16px;flex-shrink:0">${icon}</span>
                            <div style="flex:1;min-width:0">
                                <div style="font-size:13px;color:var(--text-1);line-height:1.4">${n.message}</div>
                                <div style="font-size:11px;color:var(--text-3);margin-top:3px">${date}</div>
                            </div>
                            ${!n.read ? `<button onclick="markNotifRead(${n.id})" style="background:none;border:none;cursor:pointer;color:var(--text-3);font-size:11px;white-space:nowrap;padding:2px 6px;border-radius:4px;hover:background:#f3f4f6" title="Marcar como leída">✓ Leída</button>` : ''}
                        </div>
                    </div>`;
                }).join('');
            }
        }
    } catch (_) {}
}

window.markNotifRead = async function(id) {
    await window.electronAPI.markNotificationRead(id);
    await loadNotifications();
};

// ============ ALERTA PROACTIVA DE CUOTA ============
// ─── Banner de promo (vencimiento / extensión) ───────────────────────────────
const PROMO_STORAGE_KEY = 'psc_promo_dismissed_until';
const PROMO_END_DATE_KEY = 'psc_promo_last_end_date';

// Prioridad de banners: subscription-status > quota > promo
// Solo uno visible a la vez para evitar solapamiento
const BANNER_IDS = ['subscription-status-banner', 'quota-banner', 'promo-banner'];
function showSingleBanner(winnerId) {
    BANNER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id !== winnerId) el.style.display = 'none';
    });
}
function hideBanner(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

// Abre el portal web con auto-login (token en hash para no exponerlo en logs del servidor)
// Oculta el banner de suscripción al abrir el portal
async function openPortal() {
    await openPortalSection(null);
    hideBanner('subscription-status-banner');
}

// Abre el portal web en una sección específica con auto-login.
// Secciones válidas: 'ia', 'soporte', 'nuevo-ticket', 'perfil', 'plan', 'facturacion', null (home)
// URL generada: /usuarios/?goto=<section>#sso=<token>
async function openPortalSection(section) {
    const PORTAL_BASE = 'https://api.procuradortool.com/usuarios/';
    try {
        const token = await window.electronAPI.getAuthToken();
        const query = section ? `?goto=${encodeURIComponent(section)}` : '';
        const url   = token ? `${PORTAL_BASE}${query}#sso=${token}` : PORTAL_BASE;
        await window.electronAPI.openExternalUrl(url);
    } catch (_) {
        window.electronAPI.openExternalUrl(PORTAL_BASE);
    }
}

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
    // Solo mostrar promo si no hay un banner de mayor prioridad activo
    const subBanner = document.getElementById('subscription-status-banner');
    const quotaBanner = document.getElementById('quota-banner');
    if ((subBanner && subBanner.style.display !== 'none') ||
        (quotaBanner && quotaBanner.style.display !== 'none')) return;

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

// ============ BANNER ESTADO DE SUSCRIPCIÓN (Flujo v2.1) ============
async function checkSubscriptionStatusBanner() {
    const banner  = document.getElementById('subscription-status-banner');
    const textEl  = document.getElementById('subscription-status-text');
    const btn     = document.getElementById('subscription-status-btn');
    const closeBtn = document.getElementById('subscription-status-close');
    if (!banner || !textEl) return;

    // × para cerrar — solo aplica una vez (evita duplicar listeners con múltiples llamadas)
    if (closeBtn && !closeBtn.dataset.wired) {
        closeBtn.dataset.wired = '1';
        closeBtn.addEventListener('click', () => { banner.style.display = 'none'; });
    }

    const PORTAL = 'https://api.procuradortool.com/usuarios/';

    try {
        const result = await window.electronAPI.getAccount();
        if (!result?.success || !result.account) return;

        const a    = result.account;
        const rs   = a.registrationStatus || a.registration_status;
        const sub  = a.subscription || {};

        let msg    = null;
        let color  = null;
        let showBtn = true;

        const daysUntil = (dateStr) => {
            if (!dateStr) return null;
            return Math.ceil((new Date(dateStr) - Date.now()) / 86400000);
        };

        if (rs === 'pending_email') {
            msg     = '📧 Verificá tu email para usar la aplicación. Revisá tu casilla de correo y hacé click en el enlace de verificación.';
            color   = '#b45309'; // ámbar
            showBtn = false;
            // Bloquear el botón principal de acción
            const btnMain = document.getElementById('btnMain');
            if (btnMain) {
                btnMain.disabled = true;
                btnMain.title    = 'Verificá tu email para continuar';
            }
        } else if (rs === 'pending_activation') {
            const used      = sub.usageCount ?? 0;
            const limit     = sub.usageLimit ?? 20;
            const remaining = limit - used;
            const lowIcon   = remaining <= 5 ? ' 🔴' : '';
            msg   = `${used}/${limit} usos de prueba utilizados — El administrador activará tu cuenta en breve${lowIcon}`;
            color = '#1d4ed8'; // azul
        } else if (rs === 'active') {
            const expiryDays = daysUntil(sub.planExpiryDate);
            const billingDays = daysUntil(sub.nextBillingDate);

            if (!sub.paymentProvider) {
                msg   = 'Configurá tu método de pago para evitar interrupciones';
                color = '#b45309'; // amarillo
            } else if (expiryDays !== null && expiryDays <= 30) {
                const fecha = sub.planExpiryDate ? new Date(sub.planExpiryDate).toLocaleDateString('es-AR') : '?';
                msg   = `Tu plan vence el ${fecha}. Seleccioná un nuevo plan`;
                color = '#c2410c'; // naranja
                showBtn = true;
            } else if (billingDays !== null && billingDays <= 7) {
                const fecha = new Date(sub.nextBillingDate).toLocaleDateString('es-AR');
                msg   = `Tu suscripción se renueva el ${fecha}`;
                color = '#1e3a5f'; // informativo oscuro
                showBtn = false;
            }
        } else if (rs === 'suspended') {
            msg   = 'Pago fallido. Actualizá tu método de pago en el portal';
            color = '#991b1b'; // rojo
        } else if (rs === 'suspended_admin') {
            const reason = sub.suspensionReason ? `. Motivo: ${sub.suspensionReason}` : '';
            msg   = `Tu cuenta fue suspendida${reason}. Podés solicitar revisión en el portal`;
            color = '#991b1b';
        } else if (rs === 'suspended_plan_expired') {
            msg   = 'Tu plan venció. Seleccioná un nuevo plan en el portal';
            color = '#991b1b';
        } else if (rs === 'cancelled') {
            msg   = 'Tu suscripción fue cancelada';
            color = '#374151'; // gris
            showBtn = false;
        }

        if (!msg) {
            banner.style.display = 'none';
            return;
        }

        // Suscripción tiene prioridad máxima — ocultar otros banners
        showSingleBanner('subscription-status-banner');
        banner.style.background = color;
        textEl.textContent = msg;
        if (showBtn && btn) {
            btn.style.display = 'inline-block';
            btn.onclick = () => openPortal();
        } else if (btn) {
            btn.style.display = 'none';
        }
        banner.style.display = 'flex';

    } catch (_) {
        // Falla silenciosamente
    }
}

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
        // Solo mostrar quota si no hay banner de suscripción activo
        const subBannerEl = document.getElementById('subscription-status-banner');
        if (subBannerEl && subBannerEl.style.display !== 'none') return;
        showSingleBanner('quota-banner');
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
            setPositioned(false);
            addLog('info', '📐 Ventana restaurada a posición original');
            showNotification('Ventana restaurada', 'success');
            btn.textContent = '◧ Posicionar';
            btn.title = 'Posicionar ventana a la derecha';
        } else {
            // Posicionar
            setPositioned(true);
            await window.electronAPI.positionLeft();
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
            setPositioned(true);
            await window.electronAPI.positionLeft();
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
            setPositioned(true);
            await window.electronAPI.positionLeft();
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
    const chk = document.getElementById('toggleExtConfig');
    if (chk && !chk._extListenerAdded) {
        chk._extListenerAdded = true;
        chk.addEventListener('change', async () => {
            const val = chk.checked;
            _aplicarEstadoToggleExt(val);
            await window.electronAPI.setExtensionEnabled(val);
        });
    }
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
