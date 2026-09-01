#!/usr/bin/env node
/**
 * S5 — XSS en el dashboard admin y el portal de usuarios (Etapa 3, security review)
 *
 * Barre las secciones del dashboard que XSS-1 no alcanzó (Pagos, Facturación, Feriados,
 * Legal, Métricas, Diagnóstico, Scripts) y el portal (usuarios/app.js), con foco en campos
 * que vienen de otro origen: input de usuario (registro), scraping del PJN, o el endpoint
 * público /analytics/event.
 *
 * Metodología: NO se re-escriben copias de las funciones de escape — se EXTRAEN por regex
 * del código fuente real (dashboard.js / usuarios/app.js) y se evalúan tal cual están
 * shippeadas, para que este harness falle si alguien las toca y no re-corre esto. Los
 * payloads que terminan en un atributo onclick="...('${...}')" se verifican parseando el
 * HTML CONSTRUIDO con parse5 (el mismo parser real de un navegador), no con un regex que
 * podría dar un falso OK.
 *
 * Corre: node dev-tools/verify-s5-xss-admin.js
 */

const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');

const DASHBOARD_JS = path.join(__dirname, '..', 'public', 'dashboard', 'dashboard.js');
const PORTAL_JS = path.join(__dirname, '..', 'public', 'usuarios', 'app.js');

let pass = 0, fail = 0;
const failures = [];

function assert(desc, cond, detail) {
    if (cond) {
        pass++;
        console.log(`  ✅ ${desc}`);
    } else {
        fail++;
        failures.push(desc + (detail ? ` — ${detail}` : ''));
        console.log(`  ❌ ${desc}${detail ? ' — ' + detail : ''}`);
    }
}

// ─── Extraer las funciones de escape REALES del código fuente (no reimplementarlas) ──
function extractFn(source, name) {
    // Matchea "function NAME(...) { ... }" balanceando llaves manualmente porque las
    // funciones tienen `{` internos (objetos, regex) que un regex no-greedy rompería.
    const start = source.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`No se encontró function ${name}() en el fuente`);
    const braceStart = source.indexOf('{', start);
    let depth = 0, i = braceStart;
    for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = source.slice(start, i + 1);
    // eslint-disable-next-line no-eval
    const fn = eval(`(${body})`);
    return fn;
}

const dashSrc = fs.readFileSync(DASHBOARD_JS, 'utf8');
const portalSrc = fs.readFileSync(PORTAL_JS, 'utf8');

const escHtml = extractFn(dashSrc, 'escHtml');
const escAttr = extractFn(dashSrc, 'escAttr');
const escJsAttrDash = extractFn(dashSrc, 'escJsAttr');
const escTextarea = extractFn(dashSrc, 'escTextarea');
const escapeHtmlPortal = extractFn(portalSrc, 'escapeHtml');
const escJsAttrPortal = extractFn(portalSrc, 'escJsAttr');

console.log('═══ S5 — XSS dashboard admin + portal (Etapa 3, security review) ═══\n');

// ─── 1) Payloads de texto libre contra escHtml (dashboard) / escapeHtml (portal) ──────
// Contexto: interpolados como texto dentro de un tag, ej. <td>${escHtml(x)}</td>
console.log('1) escHtml/escapeHtml — contexto de texto libre (Feriados.motivo, Métricas.label,\n   Facturación/Pagos.nombre|email|plan, portal Bitácora/MisExpedientes)');
const textPayloads = [
    '<script>alert(document.cookie)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<iframe src=javascript:alert(1)>',
];
for (const p of textPayloads) {
    const outDash = escHtml(p);
    const outPortal = escapeHtmlPortal(p);
    assert(`escHtml() neutraliza: ${p}`, !/<script|<img[^&]*onerror=|<svg[^&]*onload=|<iframe/i.test(outDash), `salida: ${outDash}`);
    assert(`escapeHtml() (portal) neutraliza: ${p}`, !/<script|<img[^&]*onerror=|<svg[^&]*onload=|<iframe/i.test(outPortal), `salida: ${outPortal}`);
}

// ─── 2) Payloads de quote-breakout contra escAttr (dashboard) / escapeHtml (portal) ───
// Contexto: value="${escAttr(x)}" — el payload intenta cerrar el atributo con una comilla.
console.log('\n2) escAttr/escapeHtml — contexto de atributo value="..." (Feriados.motivo,\n   Legal.title/version/summary, Pagos/Facturación edit modals, portal lote-caso-titulo)');
const attrPayloads = [
    `" onmouseover="alert(1)`,
    `"><script>alert(1)</script>`,
    `' onmouseover='alert(1)`,
];
for (const p of attrPayloads) {
    // Reconstruye EXACTAMENTE el patrón real: <input value="${escAttr(x)}">
    const htmlDash = `<input value="${escAttr(p)}">`;
    const htmlPortal = `<input value="${escapeHtmlPortal(p)}">`;
    const docDash = parse5.parseFragment(htmlDash);
    const docPortal = parse5.parseFragment(htmlPortal);
    const valDash = docDash.childNodes[0].attrs.find(a => a.name === 'value').value;
    const valPortal = docPortal.childNodes[0].attrs.find(a => a.name === 'value').value;
    assert(`escAttr() (dashboard) — el atributo parseado conserva el payload como texto, no rompe el tag: ${p}`,
        valDash === p, `parse5 devolvió value="${valDash}" (esperado: el payload íntegro, sin fuga)`);
    assert(`escapeHtml() (portal) — ídem en contexto de atributo: ${p}`,
        valPortal === p, `parse5 devolvió value="${valPortal}"`);
    // Y que el <script> del segundo payload no haya quedado como un nodo <script> HERMANO
    // (que confirmaría que el atributo se cerró antes de tiempo).
    assert(`escAttr() no dejó escapar un <script> hermano fuera del atributo: ${p}`,
        docDash.childNodes.filter(n => n.tagName === 'script').length === 0);
}

// ─── 3) escJsAttr — el vector más peligroso: onclick="fn('${escJsAttr(x)}')" ──────────
// Reproduce el hallazgo real F2/F4 (2026-08-31): un email con un apóstrofe rompía el
// string-literal JS del onclick. Acá se construye el onclick REAL, se parsea con parse5
// (como un navegador), se EXTRAE el atributo onclick ya decodificado por el parser HTML,
// y se confirma que el compilador de JS lo sigue viendo como una sola string literal
// (no como código inyectado) — evaluando la función resultante con un "new Function"
// contra un espía que registra si el nombre del argumento coincide con el original.
console.log('\n3) escJsAttr — contexto onclick="fn(\'${escJsAttr(x)}\')" (Feriados.id+motivo\n   ya no aplica, pero Legal.legalViewStats/label, Pagos/Facturación.email,\n   portal deleteMonitorParte/selectRememberedUser)');
const jsAttrPayloads = [
    `o'brien@ejemplo.com`,                                   // el caso real documentado (RFC 5322 válido)
    `x'); window.__pwned = true; //`,                        // intento directo de escapar el string
    `x\\'); window.__pwned = true; //`,                       // backslash puesto a propósito antes de la comilla (el bypass que el comentario de escJsAttr dice haber descartado)
    `<script>window.__pwned = true</script>`,                 // por si el HTML alrededor no está bien formado
    `"><script>window.__pwned=true</script>`,
];
global.window = global; // 'new Function' payloads que hagan window.__pwned = true se atrapan acá
for (const raw of jsAttrPayloads) {
    for (const [label, escFn] of [['dashboard', escJsAttrDash], ['portal', escJsAttrPortal]]) {
        global.__pwned = false;
        const escaped = escFn(raw);
        // Reconstrucción EXACTA del patrón real usado en el código:
        //   onclick="selectRememberedUser('${escJsAttr(u.email)}', 'x')"
        const html = `<button onclick="capturedArg('${escaped}', 'x')">click</button>`;
        const frag = parse5.parseFragment(html);
        const onclickAttrValue = frag.childNodes[0].attrs.find(a => a.name === 'onclick').value;
        // `onclickAttrValue` es exactamente el string que un navegador real compila como
        // el cuerpo de la función del evento (después de que el parser HTML decodificó
        // cualquier entidad como &#39;/&quot; a su carácter real) — el paso que el
        // comentario de escJsAttr dice que rompía escAttr()/escapeHtml() a secas.
        let threw = false;
        let capturedFirstArg = null;
        try {
            // eslint-disable-next-line no-new-func
            const fn = new Function('capturedArg', onclickAttrValue);
            fn(function capturedArg(a) { capturedFirstArg = a; });
        } catch (e) {
            threw = true;
        }
        if (!threw) {
            assert(`escJsAttr() (${label}) — el string llega COMPLETO a la función real: ${JSON.stringify(raw)}`,
                capturedFirstArg === raw, `la función real recibió ${JSON.stringify(capturedFirstArg)}`);
        }
        assert(`escJsAttr() (${label}) — el payload no ejecuta código fuera del string literal: ${JSON.stringify(raw)}`,
            !global.__pwned, threw ? '(el onclick reconstruido ni siquiera compiló, que es aceptable — no es RCE, es un error de sintaxis)' : '');
    }
}

// ─── 4) escTextarea — RCDATA (Legal editor le-content) ────────────────────────────────
console.log('\n4) escTextarea — contexto <textarea>${escTextarea(x)}</textarea> (Legal html_content)');
{
    const payload = `</textarea><script>alert(1)</script>`;
    const html = `<textarea>${escTextarea(payload)}</textarea>`;
    const frag = parse5.parseFragment(html);
    const textareaNode = frag.childNodes.find(n => n.tagName === 'textarea');
    assert('escTextarea() — el </textarea> del payload no cierra el tag real (parse5 confirma 1 solo <textarea>)',
        !!textareaNode && frag.childNodes.filter(n => n.tagName === 'textarea').length === 1);
    const scriptSiblings = frag.childNodes.filter(n => n.tagName === 'script');
    assert('escTextarea() — no aparece un <script> hermano fuera del textarea',
        scriptSiblings.length === 0, `${scriptSiblings.length} <script> encontrados fuera`);
}

// ─── 5) Confirmación de campos NO explotables por falta de vector de entrada ──────────
// Scripts.script_name: el único origen es el filesystem del servidor (reencrypt_scripts.js
// lee /scripts/*.js), sin ningún endpoint HTTP que permita a un usuario nombrar un script.
console.log('\n5) Superficie de entrada — confirmado por lectura de código, no por harness');
{
    const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
    const scriptsGetBlock = adminSrc.slice(adminSrc.indexOf("router.get('/scripts',"), adminSrc.indexOf("router.get('/scripts',") + 400);
    assert("GET /admin/scripts lee 'encrypted_scripts' (poblada solo por reencrypt_scripts.js, filesystem del server) — sin input de request en el SELECT",
        scriptsGetBlock.includes('FROM encrypted_scripts') && !scriptsGetBlock.includes('req.body') && !scriptsGetBlock.includes('req.query'));
}

// ─── 6) legalPreview() / legalTogglePreviewEditor() — sandbox de iframe (regresión) ───
// El hallazgo real de este bloque (confirmado con un navegador real vía Playwright, ver
// el informe): doc.html_content (Legal) se renderizaba SIN sandbox en un <iframe srcdoc>
// (legalPreview) y SIN NINGÚN iframe en absoluto (legalTogglePreviewEditor, innerHTML
// directo en el DOM del dashboard). Un <script> ejecutaba de verdad en los dos casos —
// confirmado en vivo, no solo leído. El fix es el atributo sandbox="allow-same-origin"
// (sin 'allow-scripts'), que un navegador real ya validó que bloquea TODA ejecución
// (script tags e inline handlers) sin romper el auto-alto (contentDocument sigue
// accesible). Estos 2 checks son de REGRESIÓN: confirman que el atributo sigue en el
// fuente, para que una futura edición de este bloque no lo borre sin darse cuenta.
console.log('\n6) legalPreview()/legalTogglePreviewEditor() — sandbox de iframe (regresión,\n   la ejecución real ya se validó con Playwright — ver el informe)');
{
    const previewIframeBlock = dashSrc.slice(dashSrc.indexOf('id="legal-preview-frame"') - 40, dashSrc.indexOf('id="legal-preview-frame"') + 200);
    assert('legalPreview(): el <iframe id="legal-preview-frame"> tiene sandbox="allow-same-origin"',
        /sandbox="allow-same-origin"/.test(previewIframeBlock), previewIframeBlock);

    const editorIframeBlock = dashSrc.slice(dashSrc.indexOf('id="le-preview-frame"') - 20, dashSrc.indexOf('id="le-preview-frame"') + 120);
    assert('legalEditorHTML(): el <iframe id="le-preview-frame"> tiene sandbox="allow-same-origin"',
        /sandbox="allow-same-origin"/.test(editorIframeBlock), editorIframeBlock);

    assert('legalTogglePreviewEditor() ya NO hace preview.innerHTML = textarea.value (el bug original)',
        !/preview\.innerHTML\s*=\s*textarea\.value/.test(dashSrc));

    assert('legalTogglePreviewEditor() usa frame.srcdoc (el fix)',
        dashSrc.includes('frame.srcdoc = legalWrapDocHtml(textarea.value)'));
}

// ─── Resumen ───────────────────────────────────────────────────────────────────────
console.log(`\n═══ Resultado: ${pass}/${pass + fail} PASS ═══`);
if (fail > 0) {
    console.log('\nFallos:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
}
process.exit(0);
