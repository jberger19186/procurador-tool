/**
 * Cadena completa del snapshot de informe hacia Bitácora, contra STAGING.
 *
 *   visor → POST /usuarios/capture (anónimo) → 303 con ?draft=…
 *         → GET  /usuarios/api/capture-draft/:id (autenticado)
 *         → POST /usuarios/api/expedientes/capture-lote   (snapshot-lote)
 *         → fila real en expediente_snapshots con `data` NO vacío
 *
 * El bug que verifica: el visor de informe mandaba `movs: '[]'` fijo, así que todo
 * snapshot de informe quedaba en `{"movimientos": []}` y el modal del portal decía
 * "Sin movimientos registrados" sobre un informe que sí los tenía (2 de 2 en prod).
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'. Nunca contra producción.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-snapshot-informe.js dotenv_config_path=.env.staging
 *
 * Crea su propio usuario efímero y lo borra al terminar (pase lo que pase).
 */

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// .env.staging (preload) solo sobreescribe DB_NAME/etc — JWT_SECRET y el resto de
// las credenciales viven en el .env base, y dotenv no pisa vars ya seteadas.
require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging".`);
    process.exit(1);
}

const BASE = 'https://localhost:3444';
const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

let ok = 0, fail = 0;
function check(nombre, fn) {
    try { fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}
const assert = require('assert');

/** Request contra el proceso local de staging (sin nginx, sin basic-auth). */
function req(metodo, ruta, { token, form, json, seguirRedirect = false } = {}) {
    return new Promise((resolve, reject) => {
        let body = null, headers = {};
        if (form) { body = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
        if (json) { body = JSON.stringify(json); headers['Content-Type'] = 'application/json'; }
        if (body) headers['Content-Length'] = Buffer.byteLength(body);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const r = https.request(BASE + ruta, { method: metodo, headers, rejectUnauthorized: false }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

// Movimientos con la misma forma que deja una corrida real de informe.
const MOVS = [
    { fecha: '26/11/2025', tipo: 'INFORMACION', detalle: 'Agregado al Paquete Nro. 2647202526' },
    { fecha: '20/11/2025', tipo: 'CAMBIO DE ESTADO DE EXPEDIENTE', detalle: 'ARCHIVESE' },
    { fecha: '20/11/2025', tipo: 'MOVIMIENTO', detalle: 'TERMINADOS PARA ARCHIVAR' },
];
const EXP = 'FCR 018745/2017';
const PDF = 'informe_FCR 018745_2017_2026-09-04T15-02-56.pdf';

let userId = null, planId = null;

async function main() {
    console.log('\nSnapshot de informe -> Bitacora (cadena completa, staging)\n');

    // ── fixture: usuario con Bitácora habilitada ─────────────────────────────
    const email = `qa-snapinf-${Date.now()}@test.com`;
    const p = await pool.query(`SELECT id FROM plans WHERE bitacora_enabled = true AND active = true LIMIT 1`);
    if (p.rows.length) planId = p.rows[0].id;
    else {
        const np = await pool.query(
            `INSERT INTO plans (name, display_name, active, visibility, bitacora_enabled)
             VALUES ($1,$1,true,'private',true) RETURNING id`, [`QA_SNAPINF_${Date.now()}`]);
        planId = np.rows[0].id;
    }
    const u = await pool.query(
        `INSERT INTO users (email, password_hash, nombre, registration_status, email_verified, role)
         VALUES ($1,'x','QA Snapshot','active',true,'user') RETURNING id`, [email]);
    userId = u.rows[0].id;
    await pool.query(
        `INSERT INTO subscriptions (user_id, plan_id, plan, status, usage_count, usage_limit, expires_at)
         SELECT $1,$2,name,'active',0,999999,NOW()+INTERVAL '30 days' FROM plans WHERE id=$2`,
        [userId, planId]);
    const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log(`   fixture: usuario ${userId} (${email}), plan ${planId}\n`);

    // ── 1. POST anónimo, tal como lo manda el <form> del visor ───────────────
    const lote = JSON.stringify([{
        exp: EXP, jur: '', dep: '', car: 'AFIP-DGI c/ PRUEBA s/EJECUCION FISCAL', sit: '',
        fproc: '4/9/2026, 12:22:59', movs: JSON.stringify(MOVS), pdf: PDF
    }]);
    const post = await req('POST', '/usuarios/capture', {
        form: { accion: 'snapshot-lote', origen: 'informe', lote }
    });

    let draftId = null;
    check('1 . el POST del visor devuelve 303 con ?draft=', () => {
        assert.strictEqual(post.status, 303, 'status ' + post.status);
        const loc = post.headers.location || '';
        assert.ok(!/captura=(error|lote_grande)/.test(loc), 'la captura fue rechazada: ' + loc);
        draftId = new URLSearchParams(loc.split('?')[1] || '').get('draft');
        assert.ok(draftId, 'no vino draft en ' + loc);
    });
    if (!draftId) throw new Error('sin draft no se puede seguir la cadena');

    // ── 2. reclamo del borrador ──────────────────────────────────────────────
    const draft = await req('GET', `/usuarios/api/capture-draft/${draftId}`, { token });
    let casos = null;
    check('2 . el borrador conserva los movimientos y el nombre del PDF', () => {
        assert.strictEqual(draft.status, 200, 'status ' + draft.status + ' body ' + draft.body.slice(0, 200));
        const d = JSON.parse(draft.body);
        casos = d.casos || d.draft?.casos;
        assert.ok(Array.isArray(casos) && casos.length === 1, 'casos: ' + JSON.stringify(d).slice(0, 200));
        assert.strictEqual(casos[0].movimientos.length, MOVS.length, 'movimientos perdidos en el borrador');
        assert.strictEqual(casos[0].movimientos[0].detalle, MOVS[0].detalle);
        assert.strictEqual(casos[0].pdf, PDF, 'el nombre del PDF no sobrevivio al borrador');
    });

    // ── 3. confirmación desde el portal ──────────────────────────────────────
    const guardar = await req('POST', '/usuarios/api/expedientes/capture-lote', {
        token, json: { accion: 'snapshot-lote', casos: casos.map(c => Object.assign({}, c, { origen: 'informe' })) }
    });
    check('3 . capture-lote crea la ficha y el snapshot', () => {
        assert.strictEqual(guardar.status, 200, 'status ' + guardar.status + ' body ' + guardar.body.slice(0, 300));
        const r = JSON.parse(guardar.body).resumen || {};
        assert.strictEqual(r.snapshots, 1, 'snapshots creados: ' + r.snapshots);
    });

    // ── 4. la fila real en la base ───────────────────────────────────────────
    const fila = await pool.query(
        `SELECT s.kind, s.data FROM expediente_snapshots s
           JOIN expedientes_seguidos e ON e.id = s.expediente_id
          WHERE e.user_id = $1 ORDER BY s.id DESC LIMIT 1`, [userId]);

    check('4 . el snapshot quedo con kind=informe', () => {
        assert.strictEqual(fila.rows.length, 1, 'no se creo ninguna fila');
        assert.strictEqual(fila.rows[0].kind, 'informe');
    });

    check('5 . [EL BUG] data.movimientos ya NO viene vacio', () => {
        const data = fila.rows[0].data;
        assert.ok(Array.isArray(data.movimientos), 'data.movimientos no es array');
        assert.notStrictEqual(data.movimientos.length, 0,
            'sigue vacio: es exactamente el bug que este fix corrige');
        assert.strictEqual(data.movimientos.length, MOVS.length);
        assert.strictEqual(data.movimientos[0].detalle, MOVS[0].detalle);
        assert.strictEqual(data.movimientos[2].tipo, MOVS[2].tipo);
    });

    check('6 . [parte D] data.pdf lleva el nombre del informe generado', () => {
        assert.strictEqual(fila.rows[0].data.pdf, PDF);
    });

    // ── 7. NO-REGRESION: procuración se comporta igual que antes ─────────────
    const loteProc = JSON.stringify([{
        exp: 'CNT 049614/2024', jur: 'CNT', dep: 'JUZGADO X', car: 'PRUEBA c/ PRUEBA', sit: 'EN LETRA',
        fproc: '4/9/2026', movs: JSON.stringify(MOVS)      // sin `pdf`, como manda el visor de procuracion
    }]);
    const postP = await req('POST', '/usuarios/capture', {
        form: { accion: 'snapshot-lote', origen: 'procuracion', lote: loteProc }
    });
    const draftP = new URLSearchParams((postP.headers.location || '').split('?')[1] || '').get('draft');
    const dP = JSON.parse((await req('GET', `/usuarios/api/capture-draft/${draftP}`, { token })).body);
    const casosP = dP.casos || dP.draft?.casos;
    await req('POST', '/usuarios/api/expedientes/capture-lote', {
        token, json: { accion: 'snapshot-lote', casos: casosP.map(c => Object.assign({}, c, { origen: 'procuracion' })) }
    });
    const filaP = await pool.query(
        `SELECT s.kind, s.data FROM expediente_snapshots s
           JOIN expedientes_seguidos e ON e.id = s.expediente_id
          WHERE e.user_id = $1 AND e.expediente = 'CNT 049614/2024' ORDER BY s.id DESC LIMIT 1`, [userId]);

    check('7 . [no-regresion] procuracion sigue guardando sus movimientos', () => {
        assert.strictEqual(filaP.rows.length, 1);
        assert.strictEqual(filaP.rows[0].kind, 'procuracion');
        assert.strictEqual(filaP.rows[0].data.movimientos.length, MOVS.length);
    });

    check('8 . [no-regresion] procuracion NO gana una clave `pdf` de la nada', () => {
        assert.ok(!('pdf' in filaP.rows[0].data),
            'el snapshot de procuracion trae pdf: ' + JSON.stringify(filaP.rows[0].data).slice(0, 120));
    });
}

async function limpiar() {
    if (!userId) return;
    try {
        await pool.query(
            `DELETE FROM expediente_snapshots WHERE expediente_id IN
             (SELECT id FROM expedientes_seguidos WHERE user_id=$1)`, [userId]);
        await pool.query('DELETE FROM bitacora_entries WHERE user_id=$1', [userId]);
        await pool.query('DELETE FROM expedientes_seguidos WHERE user_id=$1', [userId]);
        await pool.query('DELETE FROM subscriptions WHERE user_id=$1', [userId]);
        await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        console.log('\n   limpieza: fixture borrado (usuario ' + userId + ')');
    } catch (e) { console.error('\n   AVISO: limpieza incompleta: ' + e.message); }
}

main()
    .catch(e => { console.error('\nERROR: ' + e.stack); fail++; })
    .then(limpiar)
    .then(async () => {
        await pool.end();
        console.log('\n' + ok + ' PASS, ' + fail + ' FAIL\n');
        process.exit(fail > 0 ? 1 : 0);
    });
