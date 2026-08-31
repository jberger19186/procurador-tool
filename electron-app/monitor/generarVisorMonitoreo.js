// generarVisorMonitoreo.js
/**
 * Generador de visor HTML del Monitor de Partes (consulta inicial / novedades).
 *
 * Extraído de `main.js` (D2, demo Etapa 1.6 — 2026-08-27): era una función privada
 * ahí adentro, no exportada, y `main.js` requiere `electron` en su primera línea
 * (`app.setAppUserModelId(...)` corre al cargar el módulo), así que no era invocable
 * desde un script Node plano. El plan de la demo pedía reusar `generarVisorMonitoreo()`
 * real para el fixture del capítulo 4 — esta extracción es lo que lo habilita, sin
 * duplicar ~300 líneas de HTML (el mismo error que ya costó bugs reales dos veces en
 * este proyecto: la búsqueda de PDF duplicada entre `generador_visor.js` y
 * `generador_excel.js`, y `VERIF_FLUJOS_ORDEN` duplicado entre backend y dashboard).
 *
 * La función es pura (sin `fs`/`path`/Electron adentro) — recibe datos, devuelve un
 * string HTML. `main.js` sigue siendo el único que la llama en producción; este
 * módulo no cambia su comportamiento, solo lo mueve a un lugar requerible.
 */

function claveLigeraBit(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function generarVisorMonitoreo(modo, resultados, bitacoraInfo = null) {
    const bit = bitacoraInfo || { enabled: false, seguidos: [], ssoToken: null };
    const bitSeguidosSet = new Set((bit.seguidos || []).map(claveLigeraBit));
    const ahora  = new Date();
    const fecha  = ahora.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
                 + ' ' + ahora.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    const titulo = modo === 'inicial' ? 'Monitor — Consulta Inicial' : 'Monitor — Novedades';

    const totalExps = resultados.reduce((sum, r) => sum + (r.expedientes || []).length, 0);
    const okCount   = resultados.filter(r => r.ok).length;

    const statsHTML = `
    <div class="stats-row">
        <div class="stat-card">
            <div class="stat-icon" style="background:var(--accent-muted)">👥</div>
            <div><div class="stat-val" style="color:var(--accent-dark)">${resultados.length}</div><div class="stat-label">Partes procesadas</div></div>
        </div>
        <div class="stat-card">
            <div class="stat-icon" style="background:var(--success-bg)">✅</div>
            <div><div class="stat-val" style="color:var(--success)">${okCount}</div><div class="stat-label">Exitosas</div></div>
        </div>
        <div class="stat-card">
            <div class="stat-icon" style="background:${modo === 'novedades' ? 'var(--warning-bg)' : 'var(--info-bg)'}">📋</div>
            <div><div class="stat-val" style="color:${modo === 'novedades' ? 'var(--warning)' : 'var(--accent-dark)'}">${totalExps}</div><div class="stat-label">${modo === 'inicial' ? 'Expedientes en base' : 'Novedades detectadas'}</div></div>
        </div>
    </div>`;

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function escAttr(s) { return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    const seccionesHTML = resultados.map((r, idx) => {
        const exps  = r.expedientes || [];
        const emptyMsg = r.error
            ? 'Error: ' + esc(r.error)
            : (modo === 'novedades' ? 'Sin novedades para esta parte' : 'Sin expedientes encontrados');

        const bitColspan = bit.enabled ? 6 : 5;
        const bitTh = bit.enabled ? '<th class="bit-sel-cell"></th>' : '';
        const bitTd = (e) => {
            if (!bit.enabled) return '';
            if (bitSeguidosSet.has(claveLigeraBit(e.numero_expediente))) {
                // Punto 9/B1: el link lleva el número real — antes `?goto=expediente` sin
                // `exp=` no resolvía a ninguna sección (pantalla en blanco, mismo bug que
                // en los visores de procuración/informe, corregido acá por consistencia).
                return '<td class="bit-sel-cell"><a class="bit-ficha-link" href="https://api.procuradortool.com/usuarios/?goto=expediente&exp=' + encodeURIComponent(e.numero_expediente || '') + '" target="procurador_portal" title="Ya seguido en tu Bitácora">📁</a></td>';
            }
            return `<td class="bit-sel-cell"><input type="checkbox" class="bit-checkbox"
                data-bit-exp="${escAttr(e.numero_expediente)}" data-bit-jur="${escAttr(r.jurisdiccion_sigla)}"
                data-bit-dep="${escAttr(e.dependencia)}" data-bit-car="${escAttr(e.caratula)}"
                data-bit-sit="${escAttr(e.situacion)}"></td>`;
        };

        const filas = exps.length === 0
            ? `<tr><td colspan="${bitColspan}" class="empty-row">${emptyMsg}</td></tr>`
            : exps.map(e => `
                <tr>
                    ${bitTd(e)}
                    <td class="exp-num">${esc(e.numero_expediente)}</td>
                    <td>${esc(e.dependencia)}</td>
                    <td class="caratula" title="${escAttr(e.caratula)}">${esc(e.caratula)}</td>
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
                            ${bitTh}
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
    * { box-sizing:border-box; margin:0; padding:0; }
    :root {
        --bg-base:#f7f7f5; --bg-surface:#ffffff; --bg-elevated:#fafaf9; --bg-hover:#f0f0ee;
        --border:rgba(0,0,0,0.08); --border-strong:rgba(0,0,0,0.13);
        --accent:#d97706; --accent-dark:#b45309; --accent-muted:rgba(217,119,6,0.10); --accent-glow:rgba(217,119,6,0.18);
        --text-1:#1a1a1a; --text-2:#5c5c5c; --text-3:#a8a8a8;
        --success:#059669; --success-bg:rgba(5,150,105,0.09);
        --error:#dc2626; --error-bg:rgba(220,38,38,0.09);
        --warning:#d97706; --warning-bg:rgba(217,119,6,0.09);
        --font:"Inter","Segoe UI",system-ui,sans-serif; --font-mono:"Cascadia Code","Consolas",monospace;
        --radius-sm:6px; --radius:10px; --radius-lg:14px;
    }
    body { font-family:var(--font); background:var(--bg-base); color:var(--text-1); font-size:13px; min-height:100vh; -webkit-font-smoothing:antialiased; }
    .ob-header { background:var(--bg-surface); border-bottom:1px solid var(--border); padding:12px 22px; display:flex; align-items:center; gap:14px; box-shadow:0 1px 4px rgba(0,0,0,0.05); }
    .logo-mark { width:30px; height:30px; background:linear-gradient(135deg,var(--accent),#f59e0b); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0; box-shadow:0 2px 8px var(--accent-glow); }
    .header-title { font-size:14px; font-weight:700; color:var(--text-1); letter-spacing:-0.01em; }
    .header-meta  { font-size:11px; color:var(--text-3); margin-top:1px; }
    .stats-row { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:14px 22px; background:var(--bg-surface); border-bottom:1px solid var(--border); }
    .stat-card { background:var(--bg-base); border:1px solid var(--border); border-radius:var(--radius); padding:12px 14px; display:flex; align-items:center; gap:12px; transition:0.13s; }
    .stat-card:hover { border-color:var(--border-strong); }
    .stat-icon { width:36px; height:36px; border-radius:var(--radius-sm); display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
    .stat-val   { font-size:22px; font-weight:700; letter-spacing:-0.03em; line-height:1; }
    .stat-label { font-size:11px; color:var(--text-3); margin-top:3px; font-weight:500; }
    .cards-wrapper { padding:16px 22px; display:flex; flex-direction:column; gap:10px; }
    .expediente-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; transition:box-shadow 0.15s; }
    .expediente-card:hover { box-shadow:0 2px 10px rgba(0,0,0,0.07); }
    .card-header { padding:12px 16px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; cursor:pointer; user-select:none; transition:background 0.13s; }
    .card-header:hover { background:var(--bg-hover); }
    .card-header.open { border-bottom:1px solid var(--border); background:var(--bg-elevated); }
    .toggle-arrow { font-size:10px; color:var(--text-3); width:14px; flex-shrink:0; transition:transform 0.2s; }
    .toggle-arrow.open { transform:rotate(90deg); }
    .jurisdiccion-tag { background:var(--accent-muted); color:var(--accent-dark); font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:4px; font-family:var(--font-mono); }
    .nombre-parte { font-size:13px; font-weight:600; color:var(--text-1); flex:1; }
    .status-badge { font-size:11px; font-weight:600; padding:3px 10px; border-radius:20px; display:inline-flex; align-items:center; gap:4px; }
    .badge-dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
    .status-ok    { background:var(--success-bg); color:var(--success); }
    .status-err   { background:var(--error-bg);   color:var(--error); }
    .status-nueva { background:var(--warning-bg); color:var(--warning); }
    .table-container { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font-size:12.5px; }
    th { background:var(--bg-base); color:var(--text-3); padding:8px 12px; text-align:left; white-space:nowrap; font-weight:700; font-size:10.5px; text-transform:uppercase; letter-spacing:0.06em; border-bottom:1px solid var(--border); }
    td { padding:8px 12px; border-bottom:1px solid var(--border); vertical-align:top; color:var(--text-2); }
    tbody tr:last-child td { border-bottom:none; }
    tbody tr:hover td { background:var(--bg-hover); }
    .exp-num { font-weight:600; color:var(--accent-dark); white-space:nowrap; font-family:var(--font-mono); font-size:12px; }
    .caratula { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-1); font-weight:500; }
    .situacion-badge { font-size:11px; background:var(--bg-elevated); border:1px solid var(--border); padding:1px 7px; border-radius:4px; white-space:nowrap; }
    .fecha-col { white-space:nowrap; color:var(--text-3); font-size:11.5px; font-family:var(--font-mono); }
    .empty-row { text-align:center; color:var(--text-3); padding:20px; font-style:italic; }

    /* ── Bitácora (F3.2) ── */
    .bit-sel-cell { width:30px; text-align:center; }
    .bit-checkbox { width:15px; height:15px; cursor:pointer; accent-color:var(--accent); }
    .bit-bar {
        display:none; align-items:center; gap:8px;
        padding:9px 22px; background:var(--accent-muted);
        border-bottom:1px solid var(--border);
    }
    .bit-bar.active { display:flex; }
    .bit-bar-count { font-size:12px; font-weight:700; color:var(--accent-dark); white-space:nowrap; }
    .bit-btn {
        height:27px; padding:0 11px; border-radius:var(--radius-sm);
        border:1px solid var(--border-strong); background:var(--bg-surface);
        color:var(--text-2); font-size:11.5px; font-family:var(--font); font-weight:500;
        cursor:pointer; white-space:nowrap; transition:0.12s;
    }
    .bit-btn:hover { background:var(--accent); color:#fff; border-color:var(--accent); }
    .bit-btn-ghost { background:transparent; border:none; color:var(--text-3); font-size:11px; cursor:pointer; }
    .bit-btn-ghost:hover { color:var(--error); }
    .bit-ficha-link {
        display:inline-flex; align-items:center; gap:3px;
        font-size:10.5px; color:var(--accent-dark); text-decoration:none; font-weight:600;
        padding:3px 7px; border-radius:6px; background:var(--accent-muted);
    }
    .bit-ficha-link:hover { text-decoration:underline; }
    .bit-footer {
        text-align:center; padding:14px 22px; font-size:11.5px; color:var(--text-3);
        border-top:1px solid var(--border); background:var(--bg-surface);
    }
    .bit-footer a { color:var(--accent-dark); text-decoration:none; font-weight:600; }
    .bit-footer a:hover { text-decoration:underline; }
</style>
</head>
<body>
    <div class="ob-header">
        <div class="logo-mark">⚖️</div>
        <div>
            <div class="header-title">${titulo}</div>
            <div class="header-meta">Generado el ${fecha} &mdash; ${resultados.length} parte(s) procesada(s)</div>
        </div>
    </div>
    ${statsHTML}
    <div id="bit-bar" class="bit-bar"></div>
    <div class="cards-wrapper">${seccionesHTML}</div>
    <div id="bit-footer"></div>
<script>
    // F3 (2026-08-31, code-review): reemplazo de '<' por su escape Unicode — mismo
    // fix que generador_visor.js, mismo motivo. bit.seguidos trae números de
    // expediente/nombres de parte (texto libre); sin esto, un valor con la secuencia
    // literal '</script>' termina el <script> ahí mismo. Confirmado con la función
    // real + parse5. JSON.parse() del lado del cliente no lo necesita — nunca llega
    // a existir uno, el objeto se lee directo como literal, no se re-parsea.
    window.BITACORA_RUNTIME = ${JSON.stringify(bit).replace(/</g, '\\u003c')};

    function toggleCard(idx) {
        var tabla  = document.getElementById('tabla-'  + idx);
        var arrow  = document.getElementById('arrow-'  + idx);
        var header = arrow.closest('.card-header');
        var open   = tabla.style.display === 'none';
        tabla.style.display  = open ? '' : 'none';
        arrow.classList.toggle('open',  open);
        header.classList.toggle('open', open);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BITÁCORA (F3.2) — botonera de captura desde el visor del Monitor.
    // window.BITACORA_RUNTIME lo embebe main.js directamente al generar este
    // HTML (mecanismo "fácil": main.js controla el payload, sin post-procesado
    // ni marcador — a diferencia de los 3 visores de procuración de F2.1).
    // La columna de checkbox/badge "ya seguido" ya viene renderizada del lado
    // servidor (main.js conoce la lista de seguidos de forma síncrona); acá
    // solo se cablean los clicks y el envío del formulario.
    // ═══════════════════════════════════════════════════════════════════════
    if (window.BITACORA_RUNTIME && window.BITACORA_RUNTIME.enabled) {
        (function () {
            var seleccionados = new Map(); // "exp|jur" -> campos del caso

            function enviarCaptura(campos) {
                var form = document.createElement('form');
                form.method = 'POST';
                var ssoToken = window.BITACORA_RUNTIME.ssoToken || null;
                form.action = 'https://api.procuradortool.com/usuarios/capture' + (ssoToken ? ('#sso=' + encodeURIComponent(ssoToken)) : '');
                form.target = 'procurador_portal';
                form.style.display = 'none';
                var todos = Object.assign({ goto: 'bitacora-nueva', origen: 'monitor' }, campos);
                Object.keys(todos).forEach(function (k) {
                    if (todos[k] === undefined || todos[k] === null) return;
                    var input = document.createElement('input');
                    input.name = k;
                    input.value = String(todos[k]);
                    form.appendChild(input);
                });
                document.body.appendChild(form);
                form.submit();
                setTimeout(function () { form.remove(); }, 500);
            }

            function campoDeCasoEl(chk) {
                var d = chk.dataset;
                return {
                    exp: d.bitExp || '', jur: d.bitJur || '', dep: d.bitDep || '',
                    car: d.bitCar || '', sit: d.bitSit || '',
                    fproc: ${JSON.stringify(fecha)}, movs: '[]'
                };
            }

            function loteSeleccionado() { return Array.from(seleccionados.values()); }
            function accionLote(accion, tipo) {
                if (seleccionados.size === 0) return;
                enviarCaptura({ accion: accion, tipo: tipo, lote: JSON.stringify(loteSeleccionado()) });
            }

            document.querySelectorAll('.bit-checkbox').forEach(function (chk) {
                chk.addEventListener('change', function () {
                    var campos = campoDeCasoEl(chk);
                    var key = campos.exp + '|' + campos.jur;
                    if (chk.checked) seleccionados.set(key, campos); else seleccionados.delete(key);
                    renderBarra();
                });
            });

            function renderBarra() {
                var bar = document.getElementById('bit-bar');
                if (!bar) return;
                if (seleccionados.size === 0) { bar.classList.remove('active'); bar.innerHTML = ''; return; }
                bar.classList.add('active');
                bar.innerHTML =
                    '<span class="bit-bar-count">☑ ' + seleccionados.size + ' seleccionado' + (seleccionados.size !== 1 ? 's' : '') + '</span>' +
                    '<button class="bit-btn" id="bit-bar-casos">📌 Guardar casos</button>' +
                    '<button class="bit-btn" id="bit-bar-entradas">＋ Crear entradas…</button>' +
                    '<button class="bit-btn-ghost" id="bit-bar-limpiar" style="margin-left:auto">✕ limpiar</button>';
                document.getElementById('bit-bar-casos').onclick = function () { accionLote('ficha-lote'); };
                // Punto 14/B2: el selector de tipo por botones vive del lado autenticado
                // del portal — el prompt() nativo queda eliminado, no reemplazado acá.
                document.getElementById('bit-bar-entradas').onclick = function () { accionLote('entrada-lote', null); };
                document.getElementById('bit-bar-limpiar').onclick = function () {
                    seleccionados.clear();
                    document.querySelectorAll('.bit-checkbox').forEach(function (c) { c.checked = false; });
                    renderBarra();
                };
            }

            var pie = document.getElementById('bit-footer');
            if (pie) {
                pie.innerHTML = '<div class="bit-footer">📔 <a href="https://api.procuradortool.com/usuarios/?goto=bitacora" target="procurador_portal">Bitácora</a> — tus vencimientos y casos seguidos, en el portal</div>';
            }
        })();
    }
</script>
</body>
</html>`;
}

module.exports = { generarVisorMonitoreo, claveLigeraBit };
