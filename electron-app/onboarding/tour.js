/**
 * tour.js — Interactive tour overlay for Procurador SCW
 * Injected into index.html. Auto-triggers on first use (localStorage flag).
 * Can also be triggered manually via window.startAppTour().
 *
 * Supports:
 *  - Multi-element spotlight via `targets: []` array (union bounding box).
 *  - `preferRight: true` para posicionar el card a la derecha del spotlight
 *    (ideal para elementos del sidebar izquierdo).
 */
(function () {
    const TOUR_KEY  = 'psc_tour_shown_v4';
    const STORE_URL = 'https://chromewebstore.google.com/detail/pjn-%E2%80%93-automatizaci%C3%B3n/aodnfemklhciagaglpggnclmbdhnhbme';

    // ─── Pasos del tour (14 pasos) ────────────────────────────────────────────
    const STEPS = [
        // ── 1 ──────────────────────────────────────────────────────────────
        {
            target: null,
            title: '👋 Bienvenido a Procurador SCW',
            text:  'Esta guía rápida te muestra las funciones principales. Podés navegar con <strong>← →</strong> del teclado o con los botones de abajo.',
        },
        // ── 2 ──────────────────────────────────────────────────────────────
        {
            target: '.tab-nav',
            title: 'Navegación — tabs principales',
            text:  'Los tabs <strong>Procurar / Informe / Monitor / Descargas</strong> en la barra superior cambian la acción activa. También podés usar el menú lateral — ambos están sincronizados.',
            setup: expandSidebar,
        },
        // ── 3 (NUEVO) ───────────────────────────────────────────────────────
        {
            target: '#btnSidebarToggle',
            title: 'Panel lateral — expandir y colapsar',
            text:  'Este botón oculta o muestra el panel de navegación lateral. Al colapsarlo ganás espacio en la consola; pasando el cursor por encima se muestra temporalmente (<em>hover-peek</em>).',
        },
        // ── 4 ──────────────────────────────────────────────────────────────
        {
            targets: [
                '[data-action="procurar-hoy"]',
                '#sidebarFechaLimite',
                '[data-action="procurar-lote"]',
            ],
            title: 'Procurar — novedades en tus expedientes',
            text:  'Busca automáticamente <strong>novedades en el PJN</strong> para todos tus expedientes.<br><br>'
                 + '• <strong>Sin fecha</strong> — trae solo movimientos del día<br>'
                 + '• <strong>Con fecha límite</strong> — completá el campo de fecha para procurar desde ese día hasta hoy<br>'
                 + '• <strong>Por lote</strong> — con un archivo .txt de causas',
            setup: expandSidebar,
            preferRight: true,
        },
        // ── 5 ──────────────────────────────────────────────────────────────
        {
            target: '[data-action="informe"]',
            title: 'Informe — reporte de una causa',
            text:  'Genera un <strong>informe detallado</strong> de uno o varios expedientes: movimientos actuales e históricos, intervinientes, vinculados y recursos. Soporta modo batch con lista .txt.',
            setup: expandSidebar,
            preferRight: true,
        },
        // ── 6 ──────────────────────────────────────────────────────────────
        {
            target: '[data-action="monitor"]',
            title: 'Monitor — seguimiento automático',
            text:  'Rastrea <strong>partes o expedientes específicos</strong> y te notifica cuando aparecen novedades. Ideal para mantenerlo en segundo plano mientras trabajás en otra cosa.',
            setup: expandSidebar,
            preferRight: true,
        },
        // ── 7 ──────────────────────────────────────────────────────────────
        {
            target: '#btnMainAction',
            title: 'Botón de acción principal',
            text:  'Muestra la <strong>acción seleccionada</strong> desde el menú. Al ejecutar, el botón queda visible en la barra de herramientas para que puedas <strong>repetir la misma acción</strong> sin volver al menú lateral.',
        },
        // ── 8 ──────────────────────────────────────────────────────────────
        {
            target: '.subtoolbar',
            title: 'Controles de la consola',
            text:  '• <strong>Detener</strong> — interrumpe el proceso en curso<br>'
                 + '• <strong>Guardar</strong> — exporta el log de consola como .txt<br>'
                 + '• <strong>Limpiar</strong> — borra el contenido visible de la consola',
        },
        // ── 9 ──────────────────────────────────────────────────────────────
        {
            // Usar el label wrapper visible; #browserToggle es el checkbox oculto
            target: '#browserToggleWrap',
            title: 'Toggle de navegador',
            text:  'Controlá si Chrome es <strong>visible o invisible</strong> durante la automatización. Ocultarlo acelera la ejecución; mostrarlo te permite ver qué hace la app en tiempo real.',
        },
        // ── 10 ─────────────────────────────────────────────────────────────
        {
            targets: [
                '[data-action="visor"]',
                '[data-action="excel"]',
                '[data-action="descargas"]',
                '[data-action="limpiar-temp"]',
                '[data-action="estadisticas"]',
            ],
            title: 'Historial — resultados y archivos',
            text:  '• <strong>Ver resultados</strong> — abre el visor HTML con los últimos resultados<br>'
                 + '• <strong>Ver Excel</strong> — abre la planilla generada<br>'
                 + '• <strong>Abrir descargas</strong> — carpeta con PDFs y archivos descargados<br>'
                 + '• <strong>Limpiar archivos temp</strong> — libera espacio en disco<br>'
                 + '• <strong>Estadísticas</strong> — resumen de uso del período',
            setup: expandSidebar,
            preferRight: true,
        },
        // ── 11 ─────────────────────────────────────────────────────────────
        {
            target: '[data-action="configuracion"]',
            title: 'Configuración',
            text:  '• <strong>Secciones a procurar</strong> — elegí qué partes del expediente consultar<br>'
                 + '• <strong>Fecha límite</strong> — también configurable desde el campo en la barra lateral<br>'
                 + '• <strong>Reportes y seguridad</strong> — opciones de exportación y credenciales<br>'
                 + '• <strong>Extensión PJN</strong> — gestión de la extensión de Chrome',
            setup: expandSidebar,
            preferRight: true,
        },
        // ── 12 ─────────────────────────────────────────────────────────────
        {
            target: '[data-action="extension"]',
            title: 'Extensión PJN para Chrome',
            text:  'Conecta la app con el portal del PJN. Instalala en un clic desde la Chrome Web Store:<br><br>'
                 + `<button onclick="window.electronAPI?.openUrlInChrome('${STORE_URL}')"
                        style="display:inline-flex;align-items:center;gap:6px;background:#e65c00;border:none;color:#fff;padding:7px 13px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:10px">
                        🧩 Instalar extensión
                    </button><br>`
                 + '<span style="font-size:11px;color:#94a3b8">Chrome puede mostrar <em>"Procede con cuidado"</em> — es normal en extensiones del store oficial con pocos usuarios. Hacé clic en <strong style="color:#e2e8f0">Continuar a la instalación</strong>.</span>',
            setup: expandSidebar,
            preferRight: true,
        },
        // ── 13 (NUEVO) ──────────────────────────────────────────────────────
        {
            targets: ['#btnSidebarTour', '#btnSidebarAsistente'],
            title: 'Ayuda — tour y asistente IA',
            text:  '• <strong>Ver tour</strong> — volvé a recorrer esta guía cuando quieras<br>'
                 + '• <strong>Asistente IA</strong> — resolvé dudas sobre la app, tu plan o el PJN con ayuda automática',
            setup: expandSidebar,
            preferRight: true,
        },
        // ── 14 ──────────────────────────────────────────────────────────────
        {
            target: '#userChip',
            title: 'Tu cuenta — plan y soporte',
            text:  'El <strong>chip de usuario</strong> al pie del panel muestra tu cuenta activa, el plan contratado, el uso del período y acceso directo a soporte técnico.',
            setup: expandSidebar,
            preferRight: true,
        },
    ];

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function expandSidebar() {
        const ml = document.querySelector('.main-layout');
        if (ml?.classList.contains('sidebar-collapsed')) {
            ml.classList.remove('sidebar-collapsed');
        }
    }

    /**
     * Calcula el bounding box que envuelve todos los elementos de la lista de selectores.
     * Retorna null si ninguno fue encontrado.
     */
    function getBoundingBox(selectors) {
        let minLeft = Infinity, minTop = Infinity;
        let maxRight = -Infinity, maxBottom = -Infinity;
        let found = false;

        selectors.forEach(sel => {
            const el = document.querySelector(sel);
            if (!el) return;
            const r = el.getBoundingClientRect();
            // Ignorar elementos sin tamaño (ocultos o sin layout aún): distorsionan
            // el bounding box (ej. items del sidebar colapsado / en transición).
            if (r.width === 0 && r.height === 0) return;
            minLeft   = Math.min(minLeft,   r.left);
            minTop    = Math.min(minTop,     r.top);
            maxRight  = Math.max(maxRight,  r.right);
            maxBottom = Math.max(maxBottom, r.bottom);
            found = true;
        });

        if (!found) return null;
        return {
            left:   minLeft,
            top:    minTop,
            width:  maxRight  - minLeft,
            height: maxBottom - minTop,
        };
    }

    // ─── Estado ───────────────────────────────────────────────────────────────
    let currentStep = 0;
    let overlay, spotlight, card;

    // Transiciones (deben coincidir con las de buildDOM). Se usan para restaurar la
    // animación luego de aplicar correcciones instantáneas (snap) sin vaivén visible.
    const SPOT_TRANSITION = 'all 0.32s cubic-bezier(0.4,0,0.2,1)';
    const CARD_TRANSITION = 'left 0.3s cubic-bezier(0.4,0,0.2,1),top 0.3s cubic-bezier(0.4,0,0.2,1)';

    // ─── Init ─────────────────────────────────────────────────────────────────
    // El tour NO se auto-inicia. Se dispara únicamente cuando el usuario lo pide:
    //  • eligió "Mostrar tour" al terminar el onboarding → evento 'show-tour' → startAppTour()
    //  • clic en "Ver tour" del panel lateral → startAppTour()
    // (Antes un setTimeout lo lanzaba siempre, ignorando la elección del usuario.)
    function init() { /* sin auto-inicio */ }

    // Banners globales que se superponen con el tour (se ocultan mientras dura).
    const BANNER_IDS = ['quota-banner', 'subscription-status-banner', 'promo-banner'];
    const _bannerPrevDisplay = {};

    function hideBanners() {
        BANNER_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) { _bannerPrevDisplay[id] = el.style.display; el.style.display = 'none'; }
        });
    }
    function restoreBanners() {
        BANNER_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && _bannerPrevDisplay[id] !== undefined) el.style.display = _bannerPrevDisplay[id];
        });
    }

    function startTour() {
        currentStep = 0;
        destroyDOM();
        hideBanners();   // cerrar banners de usos/estado para que el tour se vea bien
        buildDOM();
        showStep(0);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onResize);
    }

    window.startAppTour = startTour;

    // Si la ventana cambia de tamaño mientras el tour está activo, reubicar la card
    // del paso actual (evita que quede mal posicionada si la ventana se redimensiona).
    let _resizeTimer = null;
    function onResize() {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            if (document.getElementById('__tour_card')) showStep(currentStep);
        }, 80);
    }

    // ─── DOM ──────────────────────────────────────────────────────────────────
    function destroyDOM() {
        document.getElementById('__tour_overlay')?.remove();
        document.getElementById('__tour_spotlight')?.remove();
        document.getElementById('__tour_card')?.remove();
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
    }

    function buildDOM() {
        overlay = document.createElement('div');
        overlay.id = '__tour_overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,0.62);pointer-events:none;';
        document.body.appendChild(overlay);

        spotlight = document.createElement('div');
        spotlight.id = '__tour_spotlight';
        spotlight.style.cssText = [
            'position:fixed', 'z-index:9991', 'border-radius:8px',
            'box-shadow:0 0 0 9999px rgba(0,0,0,0.62),0 0 0 2px rgba(234,179,8,0.8)',
            'transition:all 0.32s cubic-bezier(0.4,0,0.2,1)',
            'pointer-events:none',
        ].join(';');
        document.body.appendChild(spotlight);

        card = document.createElement('div');
        card.id = '__tour_card';
        card.style.cssText = [
            'position:fixed', 'z-index:9992',
            'background:#0f172a',
            'border:1px solid rgba(234,179,8,0.28)',
            'border-radius:12px',
            'padding:18px 20px 14px',
            'width:318px',
            'box-shadow:0 16px 48px rgba(0,0,0,0.7)',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            'color:#e2e8f0',
            'transition:left 0.3s cubic-bezier(0.4,0,0.2,1),top 0.3s cubic-bezier(0.4,0,0.2,1)',
        ].join(';');
        card.innerHTML = `
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
                <div style="flex:1;min-width:0">
                    <div style="font-size:10px;font-weight:700;letter-spacing:0.07em;color:#eab308;text-transform:uppercase;margin-bottom:3px">
                        <span id="__tour_counter"></span>
                    </div>
                    <div id="__tour_title" style="font-size:14px;font-weight:700;color:#f8fafc;line-height:1.3"></div>
                </div>
                <button id="__tour_close"
                        style="background:none;border:none;color:#475569;cursor:pointer;font-size:20px;line-height:1;padding:0;flex-shrink:0;margin-top:1px"
                        title="Cerrar tour">×</button>
            </div>
            <div id="__tour_text"
                 style="font-size:12.5px;color:#94a3b8;line-height:1.7;margin:0 0 16px"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #1e293b;padding-top:12px">
                <button id="__tour_skip"
                        style="background:none;border:none;color:#475569;cursor:pointer;font-size:12px;padding:5px 8px;border-radius:5px">
                    Omitir
                </button>
                <div style="display:flex;gap:6px">
                    <button id="__tour_prev"
                            style="background:#1e293b;border:1px solid #334155;color:#94a3b8;cursor:pointer;font-size:12px;font-weight:500;padding:6px 12px;border-radius:7px">
                        ← Atrás
                    </button>
                    <button id="__tour_next"
                            style="background:#eab308;border:none;color:#0f172a;cursor:pointer;font-size:12px;font-weight:700;padding:6px 14px;border-radius:7px">
                        Siguiente →
                    </button>
                </div>
            </div>`;
        document.body.appendChild(card);

        card.querySelector('#__tour_close').onclick = endTour;
        card.querySelector('#__tour_skip').onclick  = endTour;
        card.querySelector('#__tour_next').onclick  = nextStep;
        card.querySelector('#__tour_prev').onclick  = prevStep;
    }

    // ─── Mostrar paso ─────────────────────────────────────────────────────────
    function showStep(idx) {
        const step = STEPS[idx];

        if (step.setup) step.setup();

        card.querySelector('#__tour_counter').textContent = `Paso ${idx + 1} de ${STEPS.length}`;
        card.querySelector('#__tour_title').textContent   = step.title;
        card.querySelector('#__tour_text').innerHTML      = step.text;

        const nextBtn = card.querySelector('#__tour_next');
        const prevBtn = card.querySelector('#__tour_prev');
        nextBtn.textContent   = idx === STEPS.length - 1 ? '✓ Finalizar' : 'Siguiente →';
        prevBtn.style.display = idx === 0 ? 'none' : '';

        // ── Si hay target pero no se encuentra, saltar el paso ──────────────
        const hasTarget = !!(step.targets || step.target);
        const firstRect = step.targets
            ? getBoundingBox(step.targets)
            : (step.target ? (document.querySelector(step.target)?.getBoundingClientRect() || null) : null);
        if (hasTarget && !firstRect) { nextStep(); return; }

        const PAD = 8;
        // La 1ra pasada anima la entrada (movimiento suave desde el paso anterior);
        // las correcciones posteriores se aplican SIN transición (snap) para que no
        // se vea el "vaivén" mientras el layout termina de asentarse.
        let firstPass = true;

        function reposition() {
            const rect = step.targets
                ? getBoundingBox(step.targets)
                : (step.target ? (document.querySelector(step.target)?.getBoundingClientRect() || null) : null);

            const CARD_W = 318;
            const CARD_H = card.offsetHeight || 220;
            const GAP    = 14;

            // Calcular estilos destino del spotlight y de la card
            let spot, cardLeft, cardTop;
            if (!rect) {
                spot = { left: '0px', top: '0px', width: '0px', height: '0px' };
                cardLeft = `${Math.round((window.innerWidth  - CARD_W) / 2)}px`;
                cardTop  = `${Math.round((window.innerHeight - CARD_H) / 2)}px`;
            } else {
                spot = {
                    left:   `${rect.left   - PAD}px`,
                    top:    `${rect.top    - PAD}px`,
                    width:  `${rect.width  + PAD * 2}px`,
                    height: `${rect.height + PAD * 2}px`,
                };
                const spaceBelow = window.innerHeight - rect.top - rect.height - PAD - GAP;
                const spaceAbove = rect.top           - PAD - GAP;
                let cx, cy;
                if (step.preferRight) {
                    // Pasos del sidebar (izquierda): card SIEMPRE a la derecha, centrada
                    // verticalmente. Anclada al borde derecho del SIDEBAR (ancho estable
                    // por CSS), no al bounding box de los items (que en el primer render
                    // puede medirse mal y mandar la card al borde de la pantalla).
                    const sb = document.querySelector('.sidebar');
                    const sbRect = sb && sb.getBoundingClientRect();
                    const anchorRight = (sbRect && sbRect.width > 0) ? sbRect.right : rect.right;
                    cx = anchorRight + PAD + GAP;
                    cy = rect.top + rect.height / 2 - CARD_H / 2;
                } else if (spaceBelow >= CARD_H || spaceBelow >= spaceAbove) {
                    cx = rect.left + rect.width / 2 - CARD_W / 2;
                    cy = rect.top + rect.height + PAD + GAP;
                } else {
                    cx = rect.left + rect.width / 2 - CARD_W / 2;
                    cy = rect.top - PAD - GAP - CARD_H;
                }
                cx = Math.max(8, Math.min(cx, window.innerWidth  - CARD_W - 8));
                cy = Math.max(8, Math.min(cy, window.innerHeight - CARD_H - 8));
                cardLeft = `${cx}px`;
                cardTop  = `${cy}px`;
            }

            const snap = !firstPass;
            firstPass = false;
            if (snap) { spotlight.style.transition = 'none'; card.style.transition = 'none'; }
            Object.assign(spotlight.style, spot);
            Object.assign(card.style, { left: cardLeft, top: cardTop });
            if (snap) {
                void card.offsetWidth;   // reflow: el snap toma efecto sin animar
                spotlight.style.transition = SPOT_TRANSITION;
                card.style.transition = CARD_TRANSITION;
            }
        }

        // 1ra pasada (rAF): anima la entrada. Las siguientes corrigen con snap una vez
        // que el layout se asentó (la animación del sidebar dura 0.22s y, en la 1ra
        // apertura del tour, el layout tarda algo más en estabilizarse).
        requestAnimationFrame(reposition);
        [160, 380, 700].forEach(ms => setTimeout(reposition, ms));
    }

    // ─── Navegación ───────────────────────────────────────────────────────────
    function nextStep() {
        currentStep++;
        if (currentStep >= STEPS.length) { endTour(); return; }
        showStep(currentStep);
    }

    function prevStep() {
        if (currentStep > 0) { currentStep--; showStep(currentStep); }
    }

    function endTour() {
        localStorage.setItem(TOUR_KEY, '1');
        destroyDOM();
        restoreBanners();   // volver a mostrar los banners ocultados al iniciar
    }

    function onKeyDown(e) {
        if (e.key === 'Escape')                           endTour();
        if (e.key === 'ArrowRight' || e.key === 'Enter')  nextStep();
        if (e.key === 'ArrowLeft')                        prevStep();
    }

    // ─── Bootstrap ────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
