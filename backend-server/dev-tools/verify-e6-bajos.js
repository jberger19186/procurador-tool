/**
 * verify-e6-bajos.js — Harness de la fase E6 del plan de remediación
 * (PLAN-EJECUCION-PROCURADORTOOL.md, sección "E6 — Bajos de backend + ajustes de B.2 y B.4").
 *
 * CORRE 100% LOCAL. No abre conexión a ninguna base, no hace ninguna petición de red y no
 * escribe fuera de la memoria del proceso. Se corre con `node dev-tools/verify-e6-bajos.js`
 * desde `backend-server/`.
 *
 * Dos clases de comprobación, y la distinción importa al leer el resultado:
 *
 *   [EJEC]  ejercita el código REAL (módulos requeridos de verdad, o funciones extraídas
 *           del archivo y evaluadas en un sandbox con shims mínimos). Prueba comportamiento.
 *
 *   [SRC]   asserts sobre el texto fuente. Es lo único posible para los cambios que viven
 *           dentro de un handler de Express que necesita PostgreSQL: sin base no se pueden
 *           ejercitar acá. Esos quedan cubiertos por el criterio de cierre en staging, que
 *           el propio harness imprime al final con los comandos exactos.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const existe = (rel) => fs.existsSync(path.join(ROOT, rel));

let ok = 0, fail = 0;
function check(nombre, cond, detalle = '') {
    if (cond) { ok++; console.log(`  OK   ${nombre}`); }
    else { fail++; console.log(`  FALLA ${nombre}${detalle ? ` -- ${detalle}` : ''}`); }
}
function seccion(t) { console.log(`\n${t}`); }

// Extrae funciones por nombre del fuente y las evalúa en un sandbox con los shims dados.
function cargarFns(rel, nombres, sandbox = {}) {
    const src = rel.endsWith('.html')
        ? (rd(rel).match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [, ''])[1]
        : rd(rel);
    let codigo = '';
    for (const n of nombres) {
        const i = src.indexOf(`function ${n}(`);
        if (i < 0) throw new Error(`No se encontró function ${n}( en ${rel}`);
        let j = src.indexOf('{', i), prof = 0, k = j;
        for (; k < src.length; k++) {
            if (src[k] === '{') prof++;
            else if (src[k] === '}') { prof--; if (prof === 0) { k++; break; } }
        }
        codigo += src.slice(i, k) + '\n';
    }
    const base = {
        console, JSON, Number, String, Date, Math, Object, Array, URLSearchParams,
        atob: (b) => Buffer.from(b, 'base64').toString('binary')
    };
    const ctx = vm.createContext(Object.assign(base, sandbox));
    vm.runInContext(codigo, ctx);
    return vm.runInContext('({' + nombres.join(',') + '})', ctx);
}

function storageShim() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _mapa: m
    };
}

(async () => {
console.log('='.repeat(78));
console.log(' E6 - Bajos de backend + B.2 (contrasena fuera del DOM) + B.4 (marca de demo)');
console.log('='.repeat(78));

// ============================================================================
seccion('SUB-DEPLOY (a) -- codigo muerto + guard de arranque + /health');
// ============================================================================

check('[SRC] a1. middleware/checkLicense.js borrado', !existe('middleware/checkLicense.js'));
check('[SRC] a2. src/security/scriptVerifier.js (copia backend) borrado', !existe('src/security/scriptVerifier.js'));
check('[SRC] a3. setup/createTestUser.js borrado (recreaba admin@procurador.com con Admin123!)', !existe('setup/createTestUser.js'));

{
    const dirs = ['routes', 'middleware', 'utils', 'services', 'src/security'];
    const refs = [];
    for (const d of dirs) {
        const dir = path.join(ROOT, d);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
            const t = fs.readFileSync(path.join(dir, f), 'utf8');
            if (/require\([^)]*checkLicense[^)]*\)/.test(t)) refs.push(`${d}/${f} -> checkLicense`);
            if (/require\([^)]*['"][^'"]*security\/scriptVerifier['"]\)/.test(t)) refs.push(`${d}/${f} -> scriptVerifier`);
        }
    }
    if (/require\([^)]*checkLicense[^)]*\)/.test(rd('server.js'))) refs.push('server.js -> checkLicense');
    check('[EJEC] a4. Ningun modulo vivo hace require() de los archivos borrados', refs.length === 0, refs.join(', '));
}

{
    let err = null;
    try { require(path.join(ROOT, 'routes', 'admin.js')); } catch (e) { err = e.message; }
    check('[EJEC] a5. routes/admin.js se carga sin errores tras los borrados y los cambios', err === null, err || '');
}

{
    const sv = rd('server.js');
    const i = sv.indexOf("app.get('/health'");
    const health = sv.slice(i, i + 1400);
    check('[SRC] a6. /health ya no devuelve "cache" (era el inventario nombre:sha256 de los scripts)',
        !/^\s*cache:/m.test(health) && !/cacheStats/.test(health));
    const imports = sv.split('\n').filter(l => l.includes('require(')).join('\n');
    check('[SRC] a7. server.js dejo de importar getCacheStats (solo se usa en /admin/cache/stats)',
        !/getCacheStats/.test(imports));
    check('[SRC] a8. Las estadisticas siguen disponibles, detras de auth, en GET /admin/cache/stats',
        /router\.get\('\/cache\/stats',\s*authenticateAdmin/.test(rd('routes/admin.js')));
}

{
    const sv = rd('server.js');
    check('[SRC] a9. server.js valida ENCRYPTION_KEY antes de arrancar y sale con exit(1)',
        /Buffer\.from\(String\(process\.env\.ENCRYPTION_KEY[\s\S]{0,600}process\.exit\(1\)/.test(sv));
    const valida = (k) => Buffer.from(String(k || ''), 'hex').length === 32;
    check('[EJEC] a10. El criterio del guard rechaza vacio / corto / no-hex y acepta 64 hex',
        !valida('') && !valida(undefined) && !valida('abc') && !valida('z'.repeat(64)) && valida('a'.repeat(64)));
    check('[EJEC] a11. La ENCRYPTION_KEY real de este entorno pasa el guard (no rompe el arranque)',
        valida(process.env.ENCRYPTION_KEY));
}

{
    const { getDecryptedScript } = require(path.join(ROOT, 'utils', 'scriptEncryption'));
    const KEY = process.env.ENCRYPTION_KEY;
    const plano = 'console.log("script de prueba E6 " + Date.now());';
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY, 'hex'), iv);
    let enc = c.update(plano, 'utf8', 'hex'); enc += c.final('hex');
    const hashReal = crypto.createHash('sha256').update(plano).digest('hex');
    const dbFalso = (hash) => ({ query: async () => ({ rows: [{ encrypted_content: enc, iv: iv.toString('hex'), hash }] }) });

    let r1 = null, e1 = null;
    try { r1 = await getDecryptedScript(dbFalso(hashReal), '__e6_ok.js'); } catch (e) { e1 = e.message; }
    check('[EJEC] a12. Camino feliz: hash coincidente -> devuelve el script descifrado (no-regresion)',
        e1 === null && r1 === plano, e1 || `devolvio ${String(r1).slice(0, 40)}`);

    let r2 = null, e2 = null;
    try { r2 = await getDecryptedScript(dbFalso('0'.repeat(64)), '__e6_mal.js'); } catch (e) { e2 = e.message; }
    check('[EJEC] a13. Hash desalineado del contenido real -> LANZA y no entrega el script (fail-closed)',
        e2 !== null && r2 === null && /Integridad/i.test(e2), e2 || 'devolvio el script igual');
}

// ============================================================================
seccion('SUB-DEPLOY (b) -- admin / auth / legal / analytics / bitacora');
// ============================================================================

{
    const authenticateAdmin = require(path.join(ROOT, 'middleware', 'authenticateAdmin'));
    const token = jwt.sign({ id: 42, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const mkReq = (dbRole, tira = false) => ({
        headers: { authorization: `Bearer ${token}` },
        app: { get: () => ({ query: async () => {
            if (tira) throw new Error('db caida');
            return { rows: dbRole === null ? [] : [{ role: dbRole }] };
        } }) }
    });
    const correr = (req) => new Promise(res => {
        const r = { status(c) { this._c = c; return this; }, json(b) { res({ status: this._c, body: b }); } };
        authenticateAdmin(req, r, () => res({ status: 200, next: true }));
    });

    check('[EJEC] b1. Token admin + rol admin en la base -> deja pasar (no-regresion)',
        (await correr(mkReq('admin'))).next === true);
    const revocado = await correr(mkReq('user'));
    check('[EJEC] b2. Token admin valido pero rol REVOCADO en la base -> 403 (antes pasaba 8 h)',
        revocado.status === 403, JSON.stringify(revocado));
    const borrado = await correr(mkReq(null));
    check('[EJEC] b3. Token admin de un usuario que ya no existe -> 403',
        borrado.status === 403, JSON.stringify(borrado));
    const caida = await correr(mkReq('admin', true));
    check('[EJEC] b4. Base caida -> 503 fail-CLOSED (es autorizacion, no regla de negocio)',
        caida.status === 503, JSON.stringify(caida));
    const sinToken = await correr({ headers: {}, app: { get: () => null } });
    check('[EJEC] b5. Sin token -> 401 antes de tocar la base (no-regresion)', sinToken.status === 401);
}

{
    const a = rd('routes/admin.js');
    const i = a.indexOf("router.put('/users/:userId/role'");
    const bloque = a.slice(i, i + 3200);
    check('[SRC] b6. PUT /users/:id/role rechaza que un admin se degrade a si mismo',
        /targetId === req\.user\.id/.test(bloque) && /quitarte a vos mismo/.test(bloque));
    check('[SRC] b7. PUT /users/:id/role rechaza degradar al ULTIMO admin (contando en la base)',
        /COUNT\(\*\)::int AS n FROM users WHERE role = 'admin'/.test(bloque) && /n <= 1/.test(bloque));
    check('[SRC] b8. El cambio de rol queda auditado en admin_events (antes solo console.log)',
        /'role_changed'/.test(bloque));
}

{
    const a = rd('routes/admin.js');
    check('[SRC] b9. POST /admin/subscriptions/:userId/suspend (legado) eliminado',
        !/router\.post\('\/subscriptions\/:userId\/suspend'/.test(a));
    check('[SRC] b10. POST /admin/subscriptions/:userId/reactivate (legado) eliminado',
        !/router\.post\('\/subscriptions\/:userId\/reactivate'/.test(a));
    const dash = rd('public/dashboard/dashboard.js');
    check('[EJEC] b11. El dashboard NO llamaba a ninguno de los dos (verificado sobre el fuente servido)',
        !/subscriptions\/\$\{[^}]+\}\/suspend/.test(dash) && !/subscriptions\/\$\{[^}]+\}\/reactivate['`]/.test(dash));
    check('[SRC] b12. Siguen vivos los caminos vigentes (/users/:id/suspend, /cancel, /reactivate-cancel)',
        /router\.post\('\/users\/:userId\/suspend'/.test(a)
        && /router\.post\('\/subscriptions\/:userId\/cancel'/.test(a)
        && /router\.post\('\/subscriptions\/:userId\/reactivate-cancel'/.test(a));
    check('[SRC] b13. El beneficio plan_upgrade se rechaza si la cuenta no tiene metodo de pago',
        /payment_provider FROM subscriptions WHERE user_id[\s\S]{0,900}!subActual\.payment_provider/.test(a));
}

{
    const a = rd('routes/admin.js');
    const i = a.indexOf("router.put('/users/:userId/registro'");
    const reg = a.slice(i, i + 7000);
    check('[SRC] b14. PUT /users/:id/registro valida CUIT con digito verificador',
        /validarCuitAdmin\(cuit\)/.test(reg));
    check('[SRC] b15. PUT /users/:id/registro normaliza guiones y espacios del CUIT',
        /cleanCuit = String\(cuit\)\.replace/.test(reg));
    check('[SRC] b16. PUT /users/:id/registro rechaza un CUIT ya usado por otra cuenta (400, no 500)',
        /WHERE cuit = \$1 AND id <> \$2/.test(reg) && /ya est./.test(reg));
    check('[SRC] b17. PUT /users/:id/registro persiste el CUIT normalizado (no el crudo)',
        /cleanCuit,\s*\n\s*telefono \|\| null/.test(reg));

    const j = a.indexOf("router.put('/users/:userId/cuit'");
    const cuitEp = a.slice(j, j + 2000);
    check('[SRC] b18. PUT /users/:id/cuit usa validarCuitAdmin (antes: 11 digitos, sin digito verificador)',
        /validarCuitAdmin\(cuit\)/.test(cuitEp));
    check('[SRC] b19. PUT /users/:id/cuit rechaza duplicados antes del UPDATE', /id <> \$2/.test(cuitEp));

    const m = a.match(/function validarCuitAdmin\(cuit\)[\s\S]*?\n\}/);
    const { validarCuitAdmin } = vm.runInNewContext(m[0] + '\n;({validarCuitAdmin});', { String, parseInt });
    check('[EJEC] b20. validarCuitAdmin acepta un CUIT valido con y sin guiones',
        validarCuitAdmin('20123456786') === true && validarCuitAdmin('20-12345678-6') === true);
    check('[EJEC] b21. validarCuitAdmin rechaza digito verificador incorrecto y longitud incorrecta',
        validarCuitAdmin('27-99999999-0') === false && validarCuitAdmin('123456789') === false);

    check('[SRC] b22. nombre/apellido acotados a 100 en los 2 escritores de admin',
        (a.match(/nombreLargoOk\(nombre\)/g) || []).length === 2);
    check('[SRC] b23. nombre/apellido acotados a 100 tambien en el perfil del propio usuario',
        /nombre\.trim\(\)\.length > 100/.test(rd('routes/usuarios.js')));
}

{
    const a = rd('routes/admin.js');
    const m = a.match(/function validarCamposPlan\([\s\S]*?\n\}/);
    const { validarCamposPlan } = vm.runInNewContext(m[0] + '\n;({validarCamposPlan});', { String });
    check('[EJEC] b24. name fuera de A-Z 0-9 _ - se rechaza',
        !!validarCamposPlan({ name: 'plan malo', display_name: 'X' }, { exigeName: true }));
    check('[EJEC] b25. display_name con comilla doble se rechaza (el vector real: value="...")',
        !!validarCamposPlan({ name: 'OK', display_name: 'x" onfocus=alert(1) autofocus' }, { exigeName: true }));
    check('[EJEC] b26. Los planes REALES del proyecto siguen siendo validos (no rompe altas legitimas)',
        ['EXTENSION_PROMO', 'COMBO_PROMO', 'BASIC', 'PRO', 'ENTERPRISE', 'CORTESIA']
            .every(n => validarCamposPlan({ name: n, display_name: 'Plan Basico', description: 'Descripcion normal.' }, { exigeName: true }) === null));
    check('[EJEC] b27. El PUT no exige name (no se puede renombrar un plan) -> planes existentes intactos',
        validarCamposPlan({ display_name: 'Combo Beta' }, { exigeName: false }) === null);
}

{
    const a = rd('routes/admin.js');
    check('[SRC] b28. PUT /payments/:id conserva plan y external_payment_id si no vienen en el body',
        /planProvided[\s\S]{0,300}extIdProvided/.test(a)
        && /plan\s+= CASE WHEN \$5::boolean THEN \$6::text ELSE plan END/.test(a));
    check('[SRC] b29. PUT /invoices/:id/meta conserva numero y cae si no vienen en el body',
        /numero\s+= CASE WHEN \$2::boolean THEN \$3::text ELSE numero END/.test(a)
        && /cae\s+= CASE WHEN \$5::boolean THEN \$6::text ELSE cae END/.test(a));
    const dash = rd('public/dashboard/dashboard.js');
    check('[EJEC] b30. El dashboard sigue mandando las 4 claves -> poder VACIARLAS desde la UI no cambia',
        /plan: document\.getElementById\('_pe-plan'\)/.test(dash)
        && /external_payment_id: document\.getElementById\('_pe-extid'\)/.test(dash)
        && /numero: document\.getElementById\('_ie-numero'\)/.test(dash)
        && /cae: document\.getElementById\('_ie-cae'\)/.test(dash));
}

{
    const dirs = ['routes', 'middleware', 'utils', 'services', 'src/security'];
    const usos = [];
    for (const d of dirs) {
        const dir = path.join(ROOT, d);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
            const t = fs.readFileSync(path.join(dir, f), 'utf8');
            for (const l of t.split('\n')) {
                if (/SESSION_KEY_SECRET/.test(l) && !/^\s*(\/\/|\*)/.test(l)) usos.push(`${d}/${f}: ${l.trim().slice(0, 60)}`);
            }
        }
    }
    check('[EJEC] b31. SESSION_KEY_SECRET no se usa en ninguna linea de codigo viva del backend',
        usos.length === 0, usos.join(' | '));
    check('[SRC] b32. /auth/login ya no devuelve sessionKey', !/^\s*sessionKey,$/m.test(rd('routes/auth.js')));
    check('[SRC] b33. /client/scripts/download ya no devuelve sessionKey', !/sessionKey: sessionKey/.test(rd('routes/client.js')));
    const bc = fs.readFileSync(path.join(ROOT, '..', 'electron-app', 'src', 'api', 'backendClient.js'), 'utf8');
    const lineasSk = bc.split(String.fromCharCode(10)).filter(l => /sessionKey/.test(l));
    check('[EJEC] b34. El cliente Electron no lo usaba: 3 lineas (init, asignacion y logout), ningun lector',
        lineasSk.length === 3
        && lineasSk.every(l => /this\.sessionKey = (null|response\.data\.sessionKey);/.test(l.trim()))
        && !/headers[\s\S]{0,80}sessionKey/.test(bc), lineasSk.join(' | '));
}

{
    const mailer = require(path.join(ROOT, 'utils', 'mailer'));
    check('[EJEC] b35. utils/mailer exporta escapeHtml (un solo helper para los 3 canales)',
        typeof mailer.escapeHtml === 'function');
    check('[EJEC] b36. escapeHtml neutraliza < > " \' &',
        mailer.escapeHtml('<img src=x onerror=alert(1)>"\'&') === '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
    check('[SRC] b37. renderVerifyPage escapa el mensaje (lleva user.nombre, del registro publico)',
        /<p>\$\{mailer\.escapeHtml\(message\)\}<\/p>/.test(rd('routes/auth.js')));
    const lg = rd('routes/legal.js');
    check('[SRC] b38. El email de publicacion legal escapa user.nombre y doc.version',
        /escapeHtml\(user\.nombre\)/.test(lg) && /escapeHtml\(doc\.version\)/.test(lg));
}

{
    for (const f of ['routes/legal.js', 'routes/analytics.js']) {
        const t = rd(f);
        check(`[SRC] b39 (${f}). ip_hash sale de req.ip, no del X-Forwarded-For que manda el cliente`,
            !/x-forwarded-for/.test(t) && /const rawIp\s+= req\.ip \|\| ''/.test(t));
    }
    check('[SRC] b40. server.js sigue con trust proxy = 1 (es lo que hace correcto a req.ip)',
        /app\.set\('trust proxy', 1\)/.test(rd('server.js')));
}

{
    const t = rd('routes/auth.js');
    const n = (t.match(/String\(email\)\.trim\(\)\.toLowerCase\(\)/g) || []).length;
    check('[EJEC] b41. Los 3 logins que faltaban normalizan el email (admin-login, login, extension-login)',
        n === 3, `encontrados ${n}`);
    check('[SRC] b42. portal-login, resend-verification y forgot-password ya normalizaban (sin cambios)',
        (t.match(/email\.toLowerCase\(\)\.trim\(\)/g) || []).length === 3);
}

{
    const b = rd('routes/bitacora.js');
    check('[SRC] b43. El import consulta last_value de bitacora_entries_id_seq',
        /SELECT last_value FROM bitacora_entries_id_seq/.test(b));
    check('[SRC] b44. Rechaza con 400 una entrada con id fuera de rango',
        /Number\(e\.id\) > topeIds/.test(b) && /fuera de rango/.test(b));
    check('[SRC] b45. El chequeo corre ANTES del dry-run (la vista previa anticipa el rechazo)',
        b.indexOf('SELECT last_value FROM bitacora_entries_id_seq') < b.indexOf('if (dryRun) {'));
}

// ============================================================================
seccion('SUB-DEPLOY (c) -- front estatico: escapes, B.2 y B.4');
// ============================================================================

{
    const d = rd('public/dashboard/dashboard.js');
    check('[EJEC] c1. Los 15 ${e.message} quedaron escapados (grep del criterio del plan = 0)',
        (d.match(/\$\{e\.message\}/g) || []).length === 0);
    check('[SRC] c2. u.plan escapado en la tabla de usuarios', /badge-blue">\$\{escHtml\(u\.plan\)\}/.test(d));
    check('[SRC] c3. eventDetail(): las ramas sin escapar (from, to, new_plan, plan) usan escHtml',
        (d.match(/\$\{escHtml\(p\.(from|to|new_plan|plan)\)\}/g) || []).length === 4);
    check('[SRC] c4. data-status/data-cat/data-pri de tickets con escAttr',
        /data-status="\$\{escAttr\(t\.status\)\}"/.test(d));
    check('[SRC] c5. currency escapado en refund-preview y en la tabla de pagos',
        /escHtml\(data\.currency \|\| 'ARS'\)/.test(d) && /<strong>\$\{escHtml\(p\.currency \|\| 'ARS'\)\}/.test(d));
    check('[SRC] c6. pf-display-name y pf-description pasan de escHtml a escAttr (van dentro de value="")',
        /value="\$\{plan \? escAttr\(plan\.display_name\)/.test(d)
        && /value="\$\{plan \? escAttr\(plan\.description \|\| ''\)/.test(d));

    const { escHtml, escAttr } = cargarFns('public/dashboard/dashboard.js', ['escHtml', 'escAttr']);
    const payload = 'x" autofocus onfocus=alert(1)';
    check('[EJEC] c7. escHtml NO escapa la comilla doble -> habria cerrado el atributo value=""',
        escHtml(payload).includes('"'));
    check('[EJEC] c8. escAttr SI la escapa -> el payload queda inerte dentro del atributo',
        !escAttr(payload).includes('"') && escAttr(payload).includes('&quot;'));
}

{
    const d = rd('public/dashboard/dashboard.js');
    check('[SRC] c9. El auto-restore decodifica el JWT con base64UrlDecode, no con atob() crudo',
        /JSON\.parse\(base64UrlDecode\(savedToken\.split\('\.'\)\[1\]\)\)/.test(d));
    const { base64UrlDecode } = cargarFns('public/dashboard/dashboard.js', ['base64UrlDecode']);
    const claims = { id: 6, role: 'admin', exp: 4102444800, x: '???~~~>>>' };
    const b64url = Buffer.from(JSON.stringify(claims)).toString('base64url');
    check('[EJEC] c10. El payload de prueba usa efectivamente el alfabeto base64url (- o _)',
        /[-_]/.test(b64url), b64url);
    check('[EJEC] c11. base64UrlDecode devuelve el payload correcto para ese JWT',
        JSON.parse(base64UrlDecode(b64url)).role === 'admin', b64url);
    // Referencia: `atob` del navegador LANZA ante '-' o '_' (no son del alfabeto base64).
    // Node es tolerante, asi que hay que reproducir la semantica real para mostrar el bug.
    const atobReal = (str) => {
        if (/[^A-Za-z0-9+/=]/.test(str)) throw new Error('InvalidCharacterError');
        return Buffer.from(str, 'base64').toString('binary');
    };
    let rompio = false;
    try { atobReal(b64url); } catch (_) { rompio = true; }
    check('[EJEC] c12. Referencia: atob() crudo LANZA con ese mismo payload (era el bug: cerraba la sesion sola)',
        rompio === true);
}

{
    const r = rd('public/register/register.js');
    check('[SRC] c13. register.js escapa plan.display_name (pagina publica)',
        /<div class="plan-name">\$\{escHtml\(plan\.display_name\)\}<\/div>/.test(r));
    const { escHtml } = cargarFns('public/register/register.js', ['escHtml']);
    check('[EJEC] c14. El escHtml local de register.js neutraliza < > " \'',
        escHtml('<b>x</b>"\'') === '&lt;b&gt;x&lt;/b&gt;&quot;&#39;');
}

{
    const app = rd('public/usuarios/app.js');
    const enAtributos = app.split('\n').map((l, i) => [i + 1, l.trim()])
        .filter(([, l]) => /u\.pw/.test(l) && /(onclick|data-|value=|title=)/.test(l));
    check('[EJEC] c15. CRITERIO DE CIERRE: 0 apariciones de u.pw dentro de un atributo HTML',
        enAtributos.length === 0, JSON.stringify(enAtributos));
    check('[SRC] c16. El onclick de la tarjeta pasa solo el email',
        /onclick="selectRememberedUser\('\$\{escJsAttr\(u\.email\)\}'\)"/.test(app));
    check('[SRC] c17. selectRememberedUser lee la contrasena del storage en el momento del clic',
        /function selectRememberedUser\(email\) \{[\s\S]{0,300}getRememberedUsers\(\)\.find/.test(app));
    check('[EJEC] c18. El markup de la tarjeta sigue siendo <div role="button"> con la X como <button> interior',
        /<div class="remembered-user-btn" role="button" tabindex="0"/.test(app)
        && /<button type="button" class="remembered-user-remove"/.test(app));
    check('[EJEC] c19. Sigue el filtro event.target === this del onkeydown (Enter sobre la X no loguea)',
        /onkeydown="if\(event\.target===this&&/.test(app));

    const store = storageShim();
    const pwB64 = Buffer.from('Secreta123').toString('base64');
    store.setItem('psc_remembered_users', JSON.stringify([{ email: 'a@x.com', pw: pwB64 }]));
    let llenado = null, submits = 0;
    const fns = cargarFns('public/usuarios/app.js', ['getRememberedUsers', 'selectRememberedUser'], {
        localStorage: store,
        REMEMBERED_KEY: 'psc_remembered_users',
        fillLoginForm: (e, pw) => { llenado = { e, pw }; },
        document: { getElementById: () => ({ dispatchEvent: () => { submits++; } }) },
        Event: function () {}
    });
    fns.selectRememberedUser('a@x.com');
    check('[EJEC] c20. Con el email solo, recupera la contrasena guardada y dispara el submit (misma UX)',
        !!llenado && llenado.e === 'a@x.com' && llenado.pw === pwB64 && submits === 1, JSON.stringify(llenado));
    llenado = null;
    fns.selectRememberedUser('desconocido@x.com');
    check('[EJEC] c21. Un email que ya no esta guardado no rompe: llena con contrasena vacia',
        !!llenado && llenado.pw === '', JSON.stringify(llenado));
}

{
    const app = rd('public/usuarios/app.js');
    const ssoDemo = app.split('\n').map((l, i) => [i + 1, l.trim()])
        .filter(([, l]) => /sso=/.test(l) && /procuradortool\.com\/demo/.test(l));
    check('[EJEC] c22. CRITERIO DE CIERRE: ninguna linea construye la URL de la demo con sso=',
        ssoDemo.length === 0, JSON.stringify(ssoDemo));
    check('[SRC] c23. El portal arma la URL de la demo con #demo=1&exp=',
        /return 'https:\/\/procuradortool\.com\/demo\/#demo=1&exp=' \+ exp;/.test(app));
    check('[SRC] c24. La URL se arma EN EL CLIC, no al cargar el dashboard (no queda pegada en el href)',
        /addEventListener\('click'[\s\S]{0,400}demoUrlActual\(\)/.test(app));

    const tokenReal = jwt.sign({ id: 1 }, 'clave-de-prueba', { expiresIn: '8h' });
    const { demoUrlActual } = cargarFns('public/usuarios/app.js', ['demoUrlActual'], { getToken: () => tokenReal });
    const url = demoUrlActual();
    check('[EJEC] c25. La URL generada NO contiene ningun JWT',
        !url.includes(tokenReal) && !/eyJ[A-Za-z0-9_-]{4,}\./.test(url), url);
    check('[EJEC] c26. La URL lleva la marca y un exp numerico futuro',
        /#demo=1&exp=\d+$/.test(url) && Number(url.split('exp=')[1]) > Date.now() / 1000, url);
    const sinToken = cargarFns('public/usuarios/app.js', ['demoUrlActual'], { getToken: () => null }).demoUrlActual();
    check('[EJEC] c27. Sin token, el exp cae al default de 8 h (no rompe)', /#demo=1&exp=\d+$/.test(sinToken));

    const demo = rd('public/landing/demo/index.html');
    check('[SRC] c28. La demo ya no guarda ningun token en localStorage', !/localStorage\.setItem/.test(demo));
    check('[SRC] c29. La demo BORRA activamente el JWT que las versiones previas dejaron ahi (cierra S11)',
        /localStorage\.removeItem\(TOKEN_KEY_LEGADO\)/.test(demo));
    check('[SRC] c30. El pase vive en sessionStorage (muere al cerrar la pestana)',
        /sessionStorage\.setItem\(PASE_KEY/.test(demo));

    const mkCtx = (hash) => {
        const ss = storageShim(), ls = storageShim();
        ls.setItem('psc_user_token', 'jwt.viejo.persistido');
        const f = cargarFns('public/landing/demo/index.html',
            ['base64UrlDecode', 'guardarPase', 'expDesdeJwt', 'consumirPaseDesdeHash', 'haySesion'], {
                sessionStorage: ss, localStorage: ls,
                location: { hash, pathname: '/demo/', search: '' },
                history: { replaceState: () => {} },
                PASE_KEY: 'psc_demo_pase', TOKEN_KEY_LEGADO: 'psc_user_token'
            });
        return { f, ss, ls };
    };

    const futuro = Math.floor(Date.now() / 1000) + 3600;
    const c1 = mkCtx(`#demo=1&exp=${futuro}`);
    c1.f.consumirPaseDesdeHash();
    check('[EJEC] c31. Con #demo=1 y exp futuro -> la demo queda desbloqueada', c1.f.haySesion() === true);
    check('[EJEC] c32. Lo guardado es la marca, no un token: {"exp":N} y nada mas',
        c1.ss.getItem('psc_demo_pase') === JSON.stringify({ exp: futuro }), String(c1.ss.getItem('psc_demo_pase')));

    const c2 = mkCtx(`#demo=1&exp=${Math.floor(Date.now() / 1000) - 10}`);
    c2.f.consumirPaseDesdeHash();
    check('[EJEC] c33. Con exp vencido -> bloqueada, y la marca se descarta',
        c2.f.haySesion() === false && c2.ss.getItem('psc_demo_pase') === null);

    const c3 = mkCtx('#markdown');
    c3.f.consumirPaseDesdeHash();
    check('[EJEC] c34. Sin marca -> bloqueada (visitante anonimo, comportamiento de siempre)',
        c3.f.haySesion() === false);

    const c4 = mkCtx('#sso=' + encodeURIComponent(tokenReal));
    c4.f.consumirPaseDesdeHash();
    check('[EJEC] c35. Compat de transicion: un #sso= de un portal cacheado sigue desbloqueando...',
        c4.f.haySesion() === true);
    check('[EJEC] c36. ...pero el JWT NO se guarda en ningun storage de la demo',
        ![...c4.ss._mapa.values()].some(v => String(v).includes(tokenReal))
        && ![...c4.ls._mapa.values()].some(v => String(v).includes(tokenReal)));

    const sinExp = Buffer.from('{"alg":"none"}').toString('base64url') + '.'
        + Buffer.from('{"id":1}').toString('base64url') + '.x';
    const c5 = mkCtx('#sso=' + encodeURIComponent(sinExp));
    c5.f.consumirPaseDesdeHash();
    check('[EJEC] c37. Un JWT sin claim exp sigue siendo rechazado (H-A1-04, fail-closed)',
        c5.f.haySesion() === false);

    // El barrido es una sentencia de NIVEL SUPERIOR del script (corre en cada carga), no una
    // funcion: `cargarFns` extrae funciones, asi que no lo alcanza. Se comprueba de dos formas.
    check('[SRC] c38. El barrido del JWT legado esta a nivel superior (corre en cada carga, sin llamada)',
        /^try \{ localStorage\.removeItem\(TOKEN_KEY_LEGADO\); \} catch \(_\) \{\}$/m.test(demo));
    {
        const ls = storageShim();
        ls.setItem('psc_user_token', 'jwt.viejo.persistido');
        vm.runInNewContext('try { localStorage.removeItem(TOKEN_KEY_LEGADO); } catch (_) {}',
            { localStorage: ls, TOKEN_KEY_LEGADO: 'psc_user_token' });
        check('[EJEC] c39. Esa sentencia, ejecutada tal cual, borra el JWT que quedo en este origen',
            ls.getItem('psc_user_token') === null);
    }
}

console.log('\n' + '-'.repeat(78));
console.log(`RESULTADO: ${ok} OK / ${fail} FALLAS  (total ${ok + fail})`);
console.log('-'.repeat(78));

console.log(`
Lo que este harness NO cubre y hay que correr en staging (necesita PostgreSQL y el
proceso levantado). Comandos exactos, despues de subir cada sub-deploy:

  (a) pm2 restart procurador-staging && curl -sk https://localhost:3444/health
      -> el JSON no tiene la clave "cache"
      -> arranque con ENCRYPTION_KEY vacia: FATAL + exit (probar con un .env temporal)
      node dev-tools/verify-f6-cadena-cifrado.js   -> 13/13 (H-BE-20 no rompio la cadena)

  (b) ANTES de subir: SELECT name FROM plans;  todos deben cumplir ^[A-Z0-9_-]{1,50}$
      PUT /admin/users/<id>/registro {"cuit":"27-99999999-0"} -> 400 (digito verificador)
      PUT /admin/users/<id>/registro {"cuit":"20-12345678-6"} -> 200 y SELECT cuit = 20123456786
      PUT /admin/users/<id>/registro con el CUIT de otro      -> 400 "ya esta registrado"
      PUT /admin/users/<id>/cuit     {"cuit":"12345678901"}   -> 400
      POST /admin/users con nombre de 101 caracteres          -> 400 (no 500)
      POST /admin/plans {"display_name":"x\\" onfocus=alert(1)"} -> 400
      PUT /admin/users/<el propio>/role {"role":"user"}       -> 400
      import de Bitacora con una entrada {"id": 999999999}    -> 400
      /auth/verify-email de un usuario con nombre <b>x</b>    -> se ve literal

  (c) npm ls --omit=dev  -> sin conflictos, antes de subir a prod
      Portal: login con cuenta recordada; "Ver demo" abre la demo desbloqueada y el
      localStorage de procuradortool.com queda SIN psc_user_token.
`);

process.exit(fail === 0 ? 0 : 1);
})();
