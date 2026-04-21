/**
 * tour.js — Interactive tour overlay for Procurador SCW
 * Injected into index.html. Auto-triggers on first use (localStorage flag).
 * Can also be triggered manually via window.startAppTour().
 */
(function () {
    const TOUR_KEY = 'psc_tour_shown';

    const STEPS = [
        {
            target: 'nav.topbar-tabs-inline',
            title: 'Modos de operación',
            text: 'Desde acá controlás todo: <strong>Procurar</strong> busca novedades en tus expedientes, <strong>Informe</strong> genera reportes en Excel/PDF y <strong>Monitor</strong> rastrea cambios automáticamente.',
        },
        {
            target: '#btnRunProcess',
            title: 'Ejecutar Procuración',
            text: 'Presioná <strong>Procurar</strong> para iniciar la búsqueda de novedades. Usá la flecha ▾ para acceder a opciones como <em>Fecha Custom</em> o <em>Procurar Custom</em> con una lista de expedientes.',
        },
        {
            target: '#btnInforme',
            title: 'Generar Informe',
            text: 'Genera un informe detallado en <strong>Excel o PDF</strong> para uno o varios expedientes. Podés usar un archivo .txt con la lista de causas para el modo batch.',
        },
        {
            target: '#btnMonitor',
            title: 'Monitorear',
            text: 'El monitor rastrea cambios en tus expedientes y te avisa con <strong>notificaciones de Windows</strong> cuando hay novedades. Ideal para mantenerlo corriendo en segundo plano.',
        },
    ];

    let currentTourStep = 0;
    let overlay, spotlight, card;

    function init() {
        if (localStorage.getItem(TOUR_KEY)) return;
        // Wait until the UI is fully visible
        setTimeout(startTour, 1800);
    }

    function startTour() {
        currentTourStep = 0;
        buildDOM();
        showStep(0);
        document.addEventListener('keydown', onKeyDown);
    }

    window.startAppTour = function () {
        currentTourStep = 0;
        buildDOM();
        showStep(0);
        document.addEventListener('keydown', onKeyDown);
    };

    function buildDOM() {
        if (document.getElementById('__tour_overlay')) return;

        // Dim overlay
        overlay = document.createElement('div');
        overlay.id = '__tour_overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9990',
            'background:rgba(0,0,0,0.65)',
            'pointer-events:none',
            'transition:opacity 0.3s',
        ].join(';');
        document.body.appendChild(overlay);

        // Spotlight (cut-out effect via box-shadow)
        spotlight = document.createElement('div');
        spotlight.id = '__tour_spotlight';
        spotlight.style.cssText = [
            'position:fixed', 'z-index:9991',
            'border-radius:6px',
            'box-shadow:0 0 0 9999px rgba(0,0,0,0.65)',
            'transition:all 0.35s cubic-bezier(0.4,0,0.2,1)',
            'pointer-events:none',
        ].join(';');
        document.body.appendChild(spotlight);

        // Card
        card = document.createElement('div');
        card.id = '__tour_card';
        card.style.cssText = [
            'position:fixed', 'z-index:9992',
            'background:#1e293b',
            'border:1px solid #334155',
            'border-radius:12px',
            'padding:18px 20px',
            'width:300px',
            'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
            'color:#e2e8f0',
            'transition:all 0.3s',
        ].join(';');
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span id="__tour_title" style="font-size:14px;font-weight:700;color:#f1f5f9"></span>
                <button id="__tour_close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 0 0 12px;line-height:1">×</button>
            </div>
            <p id="__tour_text" style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0 0 14px"></p>
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span id="__tour_counter" style="font-size:11px;color:#475569"></span>
                <div style="display:flex;gap:8px">
                    <button id="__tour_skip" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:12px;padding:6px 10px">Omitir tour</button>
                    <button id="__tour_next" style="background:#3b82f6;border:none;color:#fff;cursor:pointer;font-size:12px;font-weight:600;padding:7px 14px;border-radius:6px">Siguiente →</button>
                </div>
            </div>
        `;
        document.body.appendChild(card);

        document.getElementById('__tour_close').onclick  = endTour;
        document.getElementById('__tour_skip').onclick   = endTour;
        document.getElementById('__tour_next').onclick   = nextStep;
    }

    function showStep(idx) {
        const step = STEPS[idx];
        const target = document.querySelector(step.target);

        document.getElementById('__tour_title').textContent = step.title;
        document.getElementById('__tour_text').innerHTML    = step.text;
        document.getElementById('__tour_counter').textContent = `${idx + 1} de ${STEPS.length}`;

        const nextBtn = document.getElementById('__tour_next');
        nextBtn.textContent = idx === STEPS.length - 1 ? '✓ Finalizar' : 'Siguiente →';

        if (!target) { nextStep(); return; }

        const rect = target.getBoundingClientRect();
        const PAD  = 8;

        // Position spotlight
        Object.assign(spotlight.style, {
            left:   (rect.left   - PAD) + 'px',
            top:    (rect.top    - PAD) + 'px',
            width:  (rect.width  + PAD * 2) + 'px',
            height: (rect.height + PAD * 2) + 'px',
        });

        // Position card — always prefer below, fallback to above if no space
        const CARD_W = 300;
        const CARD_H = card.offsetHeight || 170;
        const MARGIN = 14;
        const spaceBelow = window.innerHeight - (rect.bottom + PAD + MARGIN);
        const spaceAbove = rect.top - PAD - MARGIN;

        let cx = rect.left + rect.width / 2 - CARD_W / 2;
        let cy;
        if (spaceBelow >= CARD_H || spaceBelow >= spaceAbove) {
            cy = rect.bottom + PAD + MARGIN;
        } else {
            cy = rect.top - PAD - MARGIN - CARD_H;
        }
        cx = Math.max(8, Math.min(cx, window.innerWidth  - CARD_W - 8));
        cy = Math.max(8, Math.min(cy, window.innerHeight - CARD_H - 8));

        Object.assign(card.style, { left: cx + 'px', top: cy + 'px' });
    }

    function nextStep() {
        currentTourStep++;
        if (currentTourStep >= STEPS.length) { endTour(); return; }
        showStep(currentTourStep);
    }

    function endTour() {
        localStorage.setItem(TOUR_KEY, '1');
        if (overlay)    overlay.remove();
        if (spotlight)  spotlight.remove();
        if (card)       card.remove();
        document.removeEventListener('keydown', onKeyDown);
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') endTour();
        if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep();
    }

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
