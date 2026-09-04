/**
 * verify-f6-cadena-cifrado.js — Harness de verificación de la fase F6 del
 * plan de code-review integral (docs/internal/plan-code-review-integral-2026-08-26.md).
 *
 * SOLO LECTURA. No escribe una sola fila en ninguna tabla, no toca archivos del
 * proyecto, no invalida cachés. Se corre contra STAGING y aborta si la base no lo es.
 *
 * Cubre los 6 puntos que el plan exige verificar de forma ejecutable, más 4
 * comprobaciones extra que salieron de la lectura del código.
 */

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// ─────────────────────────────────────────────────────────────────────────────
// GUARD DURO: nunca contra producción.
// ─────────────────────────────────────────────────────────────────────────────
if (!String(process.env.DB_NAME || '').includes('staging')) {
    console.error(`\n⛔ ABORTADO: DB_NAME="${process.env.DB_NAME}" no es de staging.`);
    console.error('   Este harness solo corre contra procurador_db_staging.\n');
    process.exit(2);
}

const BASE = `https://localhost:${process.env.HTTPS_PORT || 3444}`;
const agent = new https.Agent({ rejectUnauthorized: false });

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT),
});

// Espeja SCRIPTS_DISTRIBUIBLES de routes/client.js
const WHITELIST = [
    'testM1.js', 'testM2.js',
    'consultarscwpjn.js', 'listarSCWPJN.js',
    'procesarNovedadesCompleto.js', 'procesarCustomExpedientes.js',
    'informequickscwpjn.js', 'procesarMonitoreo.js',
    'sessionManager.js', 'errorHandler.js', 'cerrarNavegador.js', 'monitoreo.js',
    'buscarPorParteScwpjn.js',
];

// Los 6 que la whitelist debe filtrar (hallazgo P-1 de E5)
const FILTRADOS = [
    'backup-db.js', 'reset-admin-password.js', 'data-retention.js',
    'canary-test.js', 'test_registro.js', 'validarCampoParteScwpjn.js',
];

let pass = 0, fail = 0;
const fails = [];
function check(ok, label, detalle = '') {
    if (ok) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; fails.push(label + (detalle ? ` — ${detalle}` : '')); console.log(`  ❌ ${label}${detalle ? ` — ${detalle}` : ''}`); }
    return ok;
}

function req(pathname, token) {
    return new Promise((resolve) => {
        const url = new URL(pathname, BASE);
        https.get({
            hostname: url.hostname, port: url.port, path: url.pathname + url.search,
            agent, headers: token ? { Authorization: `Bearer ${token}` } : {},
        }, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(body); } catch (_) {}
                resolve({ status: res.statusCode, json, raw: body });
            });
        }).on('error', (e) => resolve({ status: 0, json: null, raw: String(e.message) }));
    });
}

function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

function cargarClavePublica() {
    if (process.env.RSA_PUBLIC_KEY) {
        const BS_N = String.fromCharCode(92) + 'n';
        return process.env.RSA_PUBLIC_KEY.split(BS_N).join('\n');
    }
    const p = path.join(__dirname, 'keys', 'public.pem');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

async function main() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log(' F6 — Verificación de la cadena de cifrado y distribución');
    console.log(`  base    : ${BASE}`);
    console.log(`  DB      : ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    // ── Preparación: usuario real de staging con suscripción viva ────────────
    const u = await pool.query(`
        SELECT u.id, u.email FROM users u
        JOIN subscriptions s ON s.user_id = u.id
        WHERE s.expires_at > NOW()
          AND (s.status = 'active' OR (s.status='suspended' AND u.registration_status='pending_activation'))
        ORDER BY u.id LIMIT 1
    `);
    if (u.rows.length === 0) {
        console.error('⛔ No hay usuario con suscripción viva en staging. Abortado sin tocar nada.');
        process.exit(3);
    }
    const user = u.rows[0];
    const token = jwt.sign({ id: user.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    console.log(`👤 Usuario de prueba: id=${user.id} <${user.email}> (token efímero 15m)\n`);

    const pub = cargarClavePublica();
    const encKey = process.env.ENCRYPTION_KEY;

    const hashesServidos = {};   // para el punto 4 (drift vs repo), se emite al final

    // ═════════════════════════════════════════════════════════════════════════
    console.log('── PUNTO 1 + 6 — Los 13 de la whitelist se descargan y TODOS traen bloque `security`');
    // ═════════════════════════════════════════════════════════════════════════
    const descargas = {};
    for (const name of WHITELIST) {
        const r = await req(`/client/scripts/download/${name}`, token);
        const ok = r.status === 200 && r.json && r.json.success && r.json.script && r.json.script.content;
        if (!check(ok, `download ${name} → 200 con contenido`, ok ? '' : `status=${r.status}`)) continue;
        descargas[name] = r.json;
        const s = r.json.security;
        check(!!(s && s.checksum && s.signature && s.signedAt),
            `  └ ${name} trae security{checksum,signature,signedAt}`,
            s ? `checksum=${!!s.checksum} signature=${!!s.signature} signedAt=${!!s.signedAt}` : 'security ausente');
    }
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('── PUNTO 2 — Firma RSA válida sobre el contenido realmente servido');
    // ═════════════════════════════════════════════════════════════════════════
    if (!pub) {
        check(false, 'clave pública RSA disponible para verificar', 'ni RSA_PUBLIC_KEY ni keys/public.pem');
    } else {
        for (const [name, d] of Object.entries(descargas)) {
            const contenido = d.script.content;
            const checksumReal = sha256(contenido);
            // (a) el checksum que declara el servidor corresponde al contenido servido
            const coincide = checksumReal === d.security.checksum;
            check(coincide, `${name}: checksum del servidor == SHA-256 del contenido servido`,
                coincide ? '' : `srv=${d.security.checksum.slice(0,12)} real=${checksumReal.slice(0,12)}`);
            // (b) la firma RSA verifica contra ese checksum con la clave pública real
            let firmaOk = false;
            try {
                firmaOk = crypto.verify('sha256', Buffer.from(d.security.checksum, 'utf8'),
                    { key: pub, padding: crypto.constants.RSA_PKCS1_V1_5 },
                    Buffer.from(d.security.signature, 'base64'));
            } catch (e) { firmaOk = false; }
            check(firmaOk, `  └ ${name}: firma RSA-2048 verifica con la clave pública`);
            hashesServidos[name] = checksumReal;
        }
        // (c) prueba negativa: una firma manipulada NO debe verificar
        const primero = Object.values(descargas)[0];
        if (primero) {
            const sigMala = Buffer.from(primero.security.signature, 'base64');
            sigMala[0] ^= 0xff;
            let verificaMala = true;
            try {
                verificaMala = crypto.verify('sha256', Buffer.from(primero.security.checksum, 'utf8'),
                    { key: pub, padding: crypto.constants.RSA_PKCS1_V1_5 }, sigMala);
            } catch (e) { verificaMala = false; }
            check(verificaMala === false, 'prueba negativa: una firma con 1 byte alterado NO verifica');
        }
    }
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('── PUNTO 3 — Hash del descifrado == encrypted_scripts.hash (y AES round-trip)');
    // ═════════════════════════════════════════════════════════════════════════
    const filas = await pool.query(
        `SELECT script_name, encrypted_content, iv, hash, active FROM encrypted_scripts`
    );
    const porNombre = Object.fromEntries(filas.rows.map(r => [r.script_name, r]));

    for (const [name, d] of Object.entries(descargas)) {
        const fila = porNombre[name];
        if (!check(!!fila, `${name}: existe fila en encrypted_scripts`)) continue;

        // (a) descifrar directo de la DB con la clave real reproduce lo servido
        let claro = null;
        try {
            const dec = crypto.createDecipheriv('aes-256-cbc',
                Buffer.from(encKey, 'hex'), Buffer.from(fila.iv, 'hex'));
            claro = dec.update(fila.encrypted_content, 'hex', 'utf8') + dec.final('utf8');
        } catch (e) {
            check(false, `${name}: descifrado AES-256-CBC desde la DB`, e.message);
            continue;
        }
        check(claro === d.script.content, `${name}: descifrado de la DB == contenido servido`);

        // (b) el hash guardado en DB es el del texto plano
        check(sha256(claro) === fila.hash, `  └ ${name}: SHA-256(descifrado) == encrypted_scripts.hash`,
            `db=${String(fila.hash).slice(0,12)} calc=${sha256(claro).slice(0,12)}`);

        // (c) el hash que viaja al cliente es el mismo de la DB
        check(d.script.hash === fila.hash, `  └ ${name}: hash servido == hash en DB`);
    }
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('── PUNTO 4 — Drift entre lo desplegado (DB) y el fuente en el servidor');
    // ═════════════════════════════════════════════════════════════════════════
    const scriptsDir = path.join(__dirname, '..', 'scripts');   // el harness vive en dev-tools/, los scripts cuelgan de backend-server/
    for (const name of WHITELIST) {
        const fp = path.join(scriptsDir, name);
        if (!fs.existsSync(fp)) { check(false, `${name}: existe en scripts/ del servidor`); continue; }
        const fuente = fs.readFileSync(fp, 'utf8');
        const hFuente = sha256(fuente);
        const fila = porNombre[name];
        check(fila && hFuente === fila.hash,
            `${name}: DB coincide con scripts/${name} del servidor`,
            fila ? `disco=${hFuente.slice(0,12)} db=${String(fila.hash).slice(0,12)}` : 'sin fila');
    }
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('── PUNTO 5 — Los 6 filtrados dan 404 (y en los TRES endpoints, no solo download)');
    // ═════════════════════════════════════════════════════════════════════════
    for (const name of FILTRADOS) {
        const existeEnDb = !!porNombre[name];
        const r = await req(`/client/scripts/download/${name}`, token);
        check(r.status === 404, `download ${name} → 404${existeEnDb ? ' (existe en DB, la whitelist lo tapa)' : ' (no está en DB)'}`,
            `status=${r.status}`);
        check(!(r.json && r.json.script), `  └ ${name}: la respuesta no incluye contenido`);
    }
    const av = await req('/client/scripts/available', token);
    if (check(av.status === 200 && av.json && Array.isArray(av.json.scripts), 'available → 200 con lista')) {
        const nombres = av.json.scripts.map(s => s.name);
        const filtrado = FILTRADOS.filter(n => nombres.includes(n));
        check(filtrado.length === 0, 'available NO lista ninguno de los 6 filtrados',
            filtrado.join(', '));
        check(nombres.every(n => WHITELIST.includes(n)),
            'available solo lista scripts de la whitelist',
            nombres.filter(n => !WHITELIST.includes(n)).join(', '));
    }
    // /scripts/check — el tercer endpoint del trío
    for (const name of FILTRADOS) {
        const existeEnDb = !!porNombre[name];
        const r = await req(`/client/scripts/check/${name}`, token);
        const filtra = r.status === 404;
        check(filtra, `check ${name} → 404`,
            `status=${r.status}${r.json && r.json.hash ? ` — EXPONE hash=${String(r.json.hash).slice(0,16)}…` : ''}${existeEnDb ? ' (está activo en DB)' : ''}`);
    }
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('── EXTRA — Comprobaciones que salieron de la lectura del código');
    // ═════════════════════════════════════════════════════════════════════════
    // E1: sin token → 401 (no hay descarga anónima)
    const anon = await req(`/client/scripts/download/testM2.js`, null);
    check(anon.status === 401 || anon.status === 403, 'download sin token → 401/403', `status=${anon.status}`);

    // E2: la normalización sin .js no permite saltar la whitelist con un filtrado
    const sinExt = await req(`/client/scripts/download/backup-db`, token);
    check(sinExt.status === 404, 'download backup-db (sin .js) → 404 (normalización no evade la whitelist)',
        `status=${sinExt.status}`);

    // E3: un script legítimo pedido sin .js sigue funcionando (retrocompatibilidad del cliente)
    const legSinExt = await req(`/client/scripts/download/testM2`, token);
    check(legSinExt.status === 200 && legSinExt.json?.script?.name === 'testM2.js',
        'download testM2 (sin .js) → 200 y resuelve a testM2.js');
    if (legSinExt.status === 200) {
        check(!!legSinExt.json.security?.signature, '  └ y también trae firma');
    }

    // E4: nombre con path traversal no rompe ni filtra
    const trav = await req(`/client/scripts/download/${encodeURIComponent('../../.env')}`, token);
    check(trav.status === 404, 'download con ../../.env → 404 (sin lectura de FS)', `status=${trav.status}`);

    // E5: ¿queda algún script activo en DB fuera de la whitelist? (superficie de processScripts)
    const activosFuera = filas.rows.filter(r => r.active && !WHITELIST.includes(r.script_name)).map(r => r.script_name);
    console.log(`  ℹ️  scripts activos en DB fuera de la whitelist: ${activosFuera.length}` +
        (activosFuera.length ? ` → ${activosFuera.join(', ')}` : ''));

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(` RESULTADO: ${pass} PASS · ${fail} FAIL`);
    if (fail) { console.log('\n Fallidos:'); fails.forEach(f => console.log(`   • ${f}`)); }
    console.log('══════════════════════════════════════════════════════════════');
    console.log('\n<<<HASHES_JSON>>>');
    console.log(JSON.stringify(hashesServidos));
    console.log('<<<END_HASHES>>>');

    await pool.end();
    process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
    console.error('\n💥 Error del harness:', e);
    try { await pool.end(); } catch (_) {}
    process.exit(4);
});
