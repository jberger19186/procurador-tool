/**
 * verify-e11-capture-token.js — criterio de aceptación de la fase E11
 * (B.3-A "llave de captura de 30 min" + B.5 "borrador con dueño").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ ES ESTO Y CONTRA QUÉ CORRE
 * ═══════════════════════════════════════════════════════════════════════════
 * Levanta un Express LOCAL montando los routers REALES del producto
 * (`routes/capture.js`, `routes/bitacora.js`, `routes/client.js`) con los mismos
 * middlewares y el mismo orden de parsers que `server.js`, y les habla por HTTP
 * de verdad. Lo único falso es el pool de PostgreSQL, reemplazado por un stub
 * que responde exactamente la fila que consulta `checkBitacoraPlan`.
 *
 * Por qué no un mock del código: los 6 puntos del criterio son sobre el
 * COMPORTAMIENTO de la cadena (parser → rate-limit → allowCaptureToken →
 * authenticateToken → gate de plan → handler). Un mock de cualquiera de esos
 * eslabones probaría el mock. Acá el único eslabón sustituido es la base.
 *
 * ⚠️ NUNCA toca producción ni staging: no abre sockets salientes, no lee `.env`
 * del servidor y usa un `JWT_SECRET` propio de la corrida.
 *
 *   node dev-tools/verify-e11-capture-token.js
 */

process.env.JWT_SECRET = 'e11-harness-secret-' + require('crypto').randomBytes(16).toString('hex');
process.env.NODE_ENV = 'test';

const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');

const tokenBlacklist = require('../middleware/tokenBlacklist');
const captureDrafts = require('../utils/captureDrafts');

// ─── Usuarios de prueba ────────────────────────────────────────────────────
const USER_A = 101;
const USER_B = 202;
const USER_SIN_PLAN = 303;

// Stub del pool: responde la fila de `checkBitacoraPlan` según el usuario.
const dbStub = {
    query: async (sql, params) => {
        if (/FROM users u/.test(sql)) {
            const id = Number(params[0]);
            if (id === USER_SIN_PLAN) {
                return { rows: [{ registration_status: 'active', bitacora_enabled: false, bitacora_lost_access_at: null }] };
            }
            return { rows: [{ registration_status: 'active', bitacora_enabled: true, bitacora_lost_access_at: null }] };
        }
        // `/client/bitacora/seguidos` y demás: no se usan en este harness.
        return { rows: [] };
    },
};

// ─── App: mismo montaje que server.js ──────────────────────────────────────
const app = express();
app.set('db', dbStub);
// server.js:198 — parser propio y acotado, ANTES del json global.
app.use('/usuarios/capture', express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json());
app.use('/client', require('../routes/client'));
app.use('/usuarios/api', require('../routes/bitacora'));
app.use('/usuarios/capture', require('../routes/capture'));
// Sonda con el middleware REAL de admin: `authenticateAdmin` hace su propio
// `jwt.verify` (no pasa por `authenticateToken`), así que hay que comprobar por
// separado que la llave de captura tampoco entra por ahí.
app.get('/sonda-admin', require('../middleware/authenticateAdmin'), (_req, res) => res.json({ ok: true }));

let base = null;

// ─── Utilidades HTTP mínimas (sin dependencias nuevas) ─────────────────────
function pedir(metodo, ruta, { token, body, form } = {}) {
    return new Promise((resolve, reject) => {
        const headers = {};
        let data = null;
        if (form) {
            data = new URLSearchParams(form).toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (body !== undefined) {
            data = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
        }
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const req = http.request(base + ruta, { method: metodo, headers }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(raw); } catch (_) {}
                resolve({ status: res.statusCode, headers: res.headers, raw, json });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

const sesion = (id) => jwt.sign({ id, role: 'user', email: `u${id}@test.local` }, process.env.JWT_SECRET, { expiresIn: '8h' });

function draftIdDeLocation(loc) {
    const m = /[?&]draft=([a-f0-9]+)/.exec(loc || '');
    return m ? m[1] : null;
}

const CASO = { accion: 'ficha', exp: 'FCR 18745/2017', jur: 'FCR', car: 'PRUEBA c/ E11 s/ CAPTURA' };

// ─── Aserciones ────────────────────────────────────────────────────────────
let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`  OK   ${nombre}`); }
    else { fail++; console.log(`  FAIL ${nombre}${detalle ? '  → ' + detalle : ''}`); }
}
function seccion(t) { console.log('\n' + t); }

(async () => {
    await new Promise((r) => {
        const srv = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; r(); });
        srv.unref();
    });
    console.log('Harness E11 — llave de captura + borrador con dueño');
    console.log('Servidor local:', base, '\n');

    // ═══════════════════════════════════════════════════════════════════════
    seccion('0. La llave se emite con el gate de plan puesto');
    // ═══════════════════════════════════════════════════════════════════════
    const sinPlan = await pedir('POST', '/client/bitacora/capture-token', { token: sesion(USER_SIN_PLAN) });
    check('sin Bitácora en el plan → 403, no se emite llave', sinPlan.status === 403, `status ${sinPlan.status}`);

    const sinToken = await pedir('POST', '/client/bitacora/capture-token');
    check('sin autenticación → 401', sinToken.status === 401, `status ${sinToken.status}`);

    const emision = await pedir('POST', '/client/bitacora/capture-token', { token: sesion(USER_A) });
    check('con plan → 200 y devuelve la llave', emision.status === 200 && typeof emision.json?.captureToken === 'string');
    const llaveA = emision.json?.captureToken;
    const payloadA = llaveA ? jwt.decode(llaveA) : null;
    check('la llave es scope="capture" y del usuario que la pidió',
        payloadA?.scope === 'capture' && payloadA?.id === USER_A);
    check('la llave dura 30 minutos exactos',
        payloadA && (payloadA.exp - payloadA.iat) === 30 * 60, `ttl ${payloadA && (payloadA.exp - payloadA.iat)}s`);
    check('la llave trae jti propio', typeof payloadA?.jti === 'string' && payloadA.jti.length > 0);

    // ═══════════════════════════════════════════════════════════════════════
    seccion('1. Visor recién generado: captura con llave → borrador CON DUEÑO, y la llave se gasta');
    // ═══════════════════════════════════════════════════════════════════════
    const post1 = await pedir('POST', '/usuarios/capture', { form: { ...CASO, capture_token: llaveA } });
    check('POST con llave válida → 303 al portal', post1.status === 303, `status ${post1.status}`);
    const draft1 = draftIdDeLocation(post1.headers.location);
    check('el 303 trae ?draft=<id>', !!draft1);
    check('el Location NO refleja nada del cliente (anti open-redirect)',
        (post1.headers.location || '').startsWith('/usuarios/?goto=bitacora'));
    check('el borrador nació con dueño = el de la llave (B.5)',
        captureDrafts.inspeccionarDraft(draft1)?.user_id === USER_A);
    check('el borrador guarda el jti de la llave',
        captureDrafts.inspeccionarDraft(draft1)?.jti === payloadA.jti);

    // Reclamo CON LA LLAVE (el caso que evita el login cuando el borrador está por vencer)
    const claim1 = await pedir('GET', `/usuarios/api/capture-draft/${draft1}`, { token: llaveA });
    check('la llave reclama SU PROPIO borrador → 200', claim1.status === 200, `status ${claim1.status}`);
    check('el borrador entregado es el que se capturó',
        claim1.json?.draft?.casos?.[0]?.expediente === CASO.exp);
    check('el payload entregado NO lleva metadatos de control de acceso',
        claim1.json?.draft && !('user_id' in claim1.json.draft) && !('jti' in claim1.json.draft));

    // ═══════════════════════════════════════════════════════════════════════
    seccion('2. UN SOLO USO: la llave queda muerta después de entregar el borrador');
    // ═══════════════════════════════════════════════════════════════════════
    check('la llave quedó en la blacklist tras el reclamo', tokenBlacklist.isBlacklisted(llaveA));

    const reReclamo = await pedir('GET', `/usuarios/api/capture-draft/${draft1}`, { token: llaveA });
    check('reusar la llave en el mismo endpoint → 403 (invalidada)', reReclamo.status === 403, `status ${reReclamo.status}`);

    // Segundo intento de captura desde el MISMO visor (misma llave, ya gastada):
    // debe seguir funcionando, pero como borrador ANÓNIMO → flujo manual con login.
    const post2 = await pedir('POST', '/usuarios/capture', { form: { ...CASO, capture_token: llaveA } });
    check('segunda captura del mismo visor → 303, no rompe', post2.status === 303, `status ${post2.status}`);
    const draft2 = draftIdDeLocation(post2.headers.location);
    check('ese segundo borrador queda SIN dueño (→ el portal pedirá login)',
        !!draft2 && captureDrafts.inspeccionarDraft(draft2)?.user_id === null);
    const claim2 = await pedir('GET', `/usuarios/api/capture-draft/${draft2}`, { token: llaveA });
    check('la llave gastada NO puede reclamar ese borrador → 403', claim2.status === 403, `status ${claim2.status}`);
    const claim2sesion = await pedir('GET', `/usuarios/api/capture-draft/${draft2}`, { token: sesion(USER_A) });
    check('con sesión normal sí se reclama (flujo manual intacto)', claim2sesion.status === 200, `status ${claim2sesion.status}`);

    // ═══════════════════════════════════════════════════════════════════════
    seccion('3. Llave VENCIDA (visor de hace 31 minutos): vence sin romper');
    // ═══════════════════════════════════════════════════════════════════════
    const llaveVencida = jwt.sign(
        { id: USER_A, sub: String(USER_A), scope: 'capture', jti: 'vencida-1', iat: Math.floor(Date.now() / 1000) - 3600 },
        process.env.JWT_SECRET, { expiresIn: '-31m' }
    );
    const post3 = await pedir('POST', '/usuarios/capture', { form: { ...CASO, capture_token: llaveVencida } });
    check('captura con llave vencida → 303 (no 401): el visor sigue sirviendo', post3.status === 303, `status ${post3.status}`);
    const draft3 = draftIdDeLocation(post3.headers.location);
    check('el borrador queda anónimo → el portal pide login', captureDrafts.inspeccionarDraft(draft3)?.user_id === null);
    const claim3 = await pedir('GET', `/usuarios/api/capture-draft/${draft3}`, { token: llaveVencida });
    check('la llave vencida no reclama nada → 403', claim3.status === 403, `status ${claim3.status}`);
    const claim3sesion = await pedir('GET', `/usuarios/api/capture-draft/${draft3}`, { token: sesion(USER_A) });
    check('tras el login, la captura se importa igual', claim3sesion.status === 200, `status ${claim3sesion.status}`);

    // ═══════════════════════════════════════════════════════════════════════
    seccion('4. Aislamiento entre cuentas (H-COV-Z2-02)');
    // ═══════════════════════════════════════════════════════════════════════
    const llaveA2 = (await pedir('POST', '/client/bitacora/capture-token', { token: sesion(USER_A) })).json.captureToken;
    const postA = await pedir('POST', '/usuarios/capture', { form: { ...CASO, capture_token: llaveA2 } });
    const draftA = draftIdDeLocation(postA.headers.location);

    const claimB = await pedir('GET', `/usuarios/api/capture-draft/${draftA}`, { token: sesion(USER_B) });
    check('usuario B con sesión propia NO reclama el borrador de A → 403', claimB.status === 403, `status ${claimB.status}`);
    check('…y el intento fallido NO destruye el borrador de A (no es un DoS)',
        captureDrafts.inspeccionarDraft(draftA)?.user_id === USER_A);

    const llaveB = (await pedir('POST', '/client/bitacora/capture-token', { token: sesion(USER_B) })).json.captureToken;
    const claimBllave = await pedir('GET', `/usuarios/api/capture-draft/${draftA}`, { token: llaveB });
    check('la llave de captura de B tampoco alcanza el borrador de A → 403', claimBllave.status === 403, `status ${claimBllave.status}`);
    check('…y sigue sin destruirlo', captureDrafts.inspeccionarDraft(draftA)?.user_id === USER_A);

    const claimA = await pedir('GET', `/usuarios/api/capture-draft/${draftA}`, { token: sesion(USER_A) });
    check('el dueño sí lo reclama con su sesión normal', claimA.status === 200, `status ${claimA.status}`);

    // ═══════════════════════════════════════════════════════════════════════
    seccion('5. La llave NO es una sesión: rechazo por scope en todos los endpoints');
    // ═══════════════════════════════════════════════════════════════════════
    const llaveC = (await pedir('POST', '/client/bitacora/capture-token', { token: sesion(USER_A) })).json.captureToken;

    const rutasProhibidas = [
        ['GET',  '/client/account'],
        ['GET',  '/client/bitacora/seguidos'],
        ['GET',  '/client/bitacora/pendientes'],
        ['GET',  '/client/batch-limits'],
        ['POST', '/client/bitacora/capture-token'],   // no puede fabricar otra llave
        ['GET',  '/usuarios/api/bitacora'],
        ['GET',  '/usuarios/api/bitacora/avisos'],
        ['GET',  '/usuarios/api/expedientes'],
        ['GET',  '/usuarios/api/feriados'],
        ['GET',  '/usuarios/api/bitacora/export'],
        ['POST', '/usuarios/api/expedientes'],
        ['POST', '/usuarios/api/bitacora'],
        ['POST', '/usuarios/api/expedientes/capture-lote'],
    ];
    for (const [metodo, ruta] of rutasProhibidas) {
        const r = await pedir(metodo, ruta, { token: llaveC, body: metodo === 'POST' ? {} : undefined });
        check(`${metodo} ${ruta} con la llave → 401`,
            r.status === 401 && r.json?.code === 'CAPTURE_TOKEN_SCOPE',
            `status ${r.status} code ${r.json?.code}`);
    }
    // `authenticateAdmin` no pasa por `authenticateToken`: verifica el JWT por su
    // cuenta. La llave no lleva `role`, así que cae en el chequeo de rol.
    const admin = await pedir('GET', '/sonda-admin', { token: llaveC });
    check('la llave contra una ruta de ADMIN → rechazada', admin.status === 403, `status ${admin.status}`);

    // La habilitación es un SÍMBOLO, no una propiedad con nombre: polucionar el
    // prototipo con `allowCaptureToken` no debe convertir el rechazo en permiso.
    // eslint-disable-next-line no-proto
    Object.prototype.allowCaptureToken = true;
    const conPolucion = await pedir('GET', '/client/account', { token: llaveC });
    delete Object.prototype.allowCaptureToken;
    check('polución de prototipo NO habilita la llave (la bandera es un Symbol)',
        conPolucion.status === 401, `status ${conPolucion.status}`);

    // Control positivo: esas mismas rutas NO devuelven 401 con una sesión normal
    // (si devolvieran 401 igual, los checks de arriba no probarían nada).
    const controlPositivo = await pedir('GET', '/client/bitacora/seguidos', { token: sesion(USER_A) });
    check('control positivo: la sesión normal SÍ entra a /client/bitacora/seguidos',
        controlPositivo.status !== 401, `status ${controlPositivo.status}`);
    check('la llave sigue viva (los 401 de arriba no la gastaron)', !tokenBlacklist.isBlacklisted(llaveC));

    // ═══════════════════════════════════════════════════════════════════════
    seccion('6. Llave inválida en el POST → 401 y NINGÚN borrador en memoria');
    // ═══════════════════════════════════════════════════════════════════════
    const antes = captureDrafts._stats().vivos;

    const forjada = jwt.sign({ id: USER_B, scope: 'capture', jti: 'x' }, 'otro-secreto-cualquiera', { expiresIn: '30m' });
    const rForjada = await pedir('POST', '/usuarios/capture', { form: { ...CASO, capture_token: forjada } });
    check('firma inválida → 401', rForjada.status === 401 && rForjada.json?.code === 'CAPTURE_TOKEN_INVALIDO',
        `status ${rForjada.status}`);

    const rBasura = await pedir('POST', '/usuarios/capture', { form: { ...CASO, capture_token: 'esto-no-es-un-jwt' } });
    check('token ilegible → 401', rBasura.status === 401, `status ${rBasura.status}`);

    const rSesion = await pedir('POST', '/usuarios/capture', { form: { ...CASO, capture_token: sesion(USER_A) } });
    check('un JWT de SESIÓN colado en capture_token → 401 (no se acepta ni se degrada)',
        rSesion.status === 401, `status ${rSesion.status}`);

    check('ninguno de los 3 creó un borrador', captureDrafts._stats().vivos === antes,
        `vivos ${antes} → ${captureDrafts._stats().vivos}`);

    // ═══════════════════════════════════════════════════════════════════════
    seccion('7. Compatibilidad: visor viejo (sin llave) sigue funcionando igual');
    // ═══════════════════════════════════════════════════════════════════════
    const postViejo = await pedir('POST', '/usuarios/capture', { form: CASO });
    check('captura sin capture_token → 303 (comportamiento previo)', postViejo.status === 303, `status ${postViejo.status}`);
    const draftViejo = draftIdDeLocation(postViejo.headers.location);
    check('el borrador queda sin dueño', captureDrafts.inspeccionarDraft(draftViejo)?.user_id === null);
    const claimViejoB = await pedir('GET', `/usuarios/api/capture-draft/${draftViejo}`, { token: sesion(USER_B) });
    check('⚠️ un borrador SIN dueño lo sigue reclamando cualquier sesión con plan (compatibilidad; ' +
          'la defensa es la confirmación del portal, B.5 parte 1)', claimViejoB.status === 200, `status ${claimViejoB.status}`);

    const postViejo2 = await pedir('POST', '/usuarios/capture', { form: CASO });
    const draftViejo2 = draftIdDeLocation(postViejo2.headers.location);
    const claimViejoLlave = await pedir('GET', `/usuarios/api/capture-draft/${draftViejo2}`, { token: llaveC });
    check('una llave de captura NO puede reclamar un borrador anónimo → 403',
        claimViejoLlave.status === 403 && claimViejoLlave.json?.code === 'CAPTURE_DRAFT_SIN_DUENO',
        `status ${claimViejoLlave.status}`);

    // ═══════════════════════════════════════════════════════════════════════
    seccion('8. No-regresión del endpoint de captura');
    // ═══════════════════════════════════════════════════════════════════════
    const rSinAccion = await pedir('POST', '/usuarios/capture', { form: { exp: 'FCR 1/2020' } });
    check('acción inválida → 303 con captura=error (sin cambios)',
        rSinAccion.status === 303 && /captura=error/.test(rSinAccion.headers.location || ''));
    const rLoteGrande = await pedir('POST', '/usuarios/capture', {
        form: { accion: 'ficha-lote', lote: JSON.stringify(Array.from({ length: 201 }, () => ({ exp: 'FCR 1/2020' }))) }
    });
    check('lote > 200 → 303 con captura=lote_grande (sin cambios)',
        rLoteGrande.status === 303 && /captura=lote_grande/.test(rLoteGrande.headers.location || ''));
    const claimInexistente = await pedir('GET', '/usuarios/api/capture-draft/deadbeef', { token: sesion(USER_A) });
    check('borrador inexistente → 404 (sin cambios)', claimInexistente.status === 404, `status ${claimInexistente.status}`);

    console.log(`\n${ok} PASS, ${fail} FAIL\n`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('Harness roto:', e); process.exit(2); });
