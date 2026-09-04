/**
 * Cadena completa de las 5 secciones extra del snapshot de informe, contra el
 * PROCESO REAL de staging y su Postgres real.
 *
 * Cierra el único gap que la verificación local no podía cubrir: los harnesses
 * de `backend-server/test/` corren `datosSnapshot()` en aislamiento (función
 * pura, sin DB) y `capture.js` sobre un Express in-process sin Postgres. Acá se
 * ejercita lo que ninguno de los dos toca — que el JSONB con las 6 secciones
 * SE PERSISTA de verdad y se lea igual de vuelta.
 *
 *   visor → POST /usuarios/capture (anónimo, 5 secciones en el form)
 *         → GET  /usuarios/api/capture-draft/:id  (autenticado)
 *         → POST /usuarios/api/expedientes/capture-lote
 *         → fila real en expediente_snapshots con las 6 secciones en `data`
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'. Nunca contra producción.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-secciones-snapshot-live.js dotenv_config_path=.env.staging
 *
 * Crea su propio usuario/plan efímero y lo borra al terminar (pase lo que pase).
 */

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

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

const assert = require('assert');
let ok = 0, fail = 0;
function check(nombre, fn) {
    try { fn(); console.log('  OK   ' + nombre); ok++; }
    catch (e) { console.error('  FAIL ' + nombre + '\n       ' + e.message); fail++; }
}

function req(metodo, ruta, { token, form, json } = {}) {
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

// ── Datos con la MISMA forma que deja una corrida real (ver los backups de
//    FCR 751/2025 y FCR 9391/2018 en la máquina del operador).
const MOVS = [
    { fecha: '26/11/2025', tipo: 'INFORMACION', detalle: 'Agregado al Paquete Nro. 2647202526' },
    { fecha: '20/11/2025', tipo: 'CAMBIO DE ESTADO DE EXPEDIENTE', detalle: 'ARCHIVESE' },
];
const HIST = [
    { fecha: '30/11/2018', tipo: 'CAMBIO DE ESTADO DE EXPEDIENTE', detalle: 'CONFRONTE OFICIO' },
];
// Intervinientes YA limpios (con el `\n` interno que el PJN mete de verdad —
// es lo que ejercita el `white-space:pre-wrap` del modal).
const INTERV = [
    'DEMANDADO|NOMBRE :\nAGUA DEL CAMPO SOCIEDAD DE RESPONSABILIDAD LIMITADA||',
    'LETRADO APODERADO|DAMIAN HORACIO ISLA MATA|Tomo: 111 Folio: 678 - Federal|20223670785',
];
const VINC  = ['EXPTE VINCULADO FCR 123/2020'];
const RECUR = ['RECURSO DE APELACION - 01/02/2026'];
const NOTAS = ['Nota interna de prueba'];
const EXP = 'FCR 018745/2017';
const PDF = 'informe_FCR 018745_2017_2026-09-04T17-27-53.pdf';

let userId = null, planId = null;

async function main() {
    console.log('\n5 secciones del snapshot de informe — contra el proceso REAL de staging\n');

    const stamp = Date.now();
    const p = await pool.query(
        `INSERT INTO plans (name, display_name, active, visibility, plan_type, bitacora_enabled)
         VALUES ($1,$1,true,'private','combo',true) RETURNING id`, [`QA_SECC_${stamp}`]);
    planId = p.rows[0].id;
    const u = await pool.query(
        `INSERT INTO users (email, password_hash, nombre, registration_status, email_verified, role)
         VALUES ($1,'x','QA Secciones','active',true,'user') RETURNING id`, [`qa-secc-${stamp}@test.com`]);
    userId = u.rows[0].id;
    await pool.query(
        `INSERT INTO subscriptions (user_id, plan_id, plan, status, usage_count, usage_limit, expires_at)
         SELECT $1,$2,name,'active',0,999999,NOW()+INTERVAL '30 days' FROM plans WHERE id=$2`,
        [userId, planId]);
    const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log(`   fixture: usuario ${userId}, plan ${planId}\n`);

    // ── 1. POST anónimo, tal como lo manda el <form> del visor ────────────────
    const lote = JSON.stringify([{
        exp: EXP, jur: '', dep: '', car: 'AFIP-DGI c/ PRUEBA s/EJECUCION FISCAL', sit: '',
        fproc: '4/9/2026, 19:20:00',
        movs:   JSON.stringify(MOVS),
        hist:   JSON.stringify(HIST),
        interv: JSON.stringify(INTERV),
        vinc:   JSON.stringify(VINC),
        rec:    JSON.stringify(RECUR),
        notas:  JSON.stringify(NOTAS),
        pdf: PDF,
    }]);
    const post = await req('POST', '/usuarios/capture', {
        form: { accion: 'snapshot-lote', origen: 'informe', lote }
    });

    let draftId = null;
    check('1 . el POST con las 6 secciones devuelve 303 con ?draft=', () => {
        assert.strictEqual(post.status, 303, 'status ' + post.status);
        const loc = post.headers.location || '';
        assert.ok(!/captura=(error|lote_grande)/.test(loc), 'rechazada: ' + loc);
        draftId = new URLSearchParams(loc.split('?')[1] || '').get('draft');
        assert.ok(draftId, 'sin draft en ' + loc);
    });
    if (!draftId) throw new Error('sin draft no se puede seguir la cadena');

    // ── 2. el borrador conserva las 6 secciones ──────────────────────────────
    const draft = await req('GET', `/usuarios/api/capture-draft/${draftId}`, { token });
    let casos = null;
    check('2 . el borrador conserva las 6 secciones y el PDF', () => {
        assert.strictEqual(draft.status, 200, 'status ' + draft.status + ' ' + draft.body.slice(0, 200));
        const d = JSON.parse(draft.body);
        casos = d.casos || d.draft?.casos;
        assert.ok(Array.isArray(casos) && casos.length === 1, 'casos: ' + JSON.stringify(d).slice(0, 200));
        const c = casos[0];
        assert.strictEqual(c.movimientos.length, MOVS.length, 'movimientos');
        assert.strictEqual(c.historicos.length, HIST.length, 'historicos');
        assert.strictEqual(c.intervinientes.length, INTERV.length, 'intervinientes');
        assert.strictEqual(c.vinculados.length, VINC.length, 'vinculados');
        assert.strictEqual(c.recursos.length, RECUR.length, 'recursos');
        assert.strictEqual(c.notas.length, NOTAS.length, 'notas');
        assert.strictEqual(c.pdf, PDF, 'pdf');
    });

    // ── 3. confirmación desde el portal ──────────────────────────────────────
    const guardar = await req('POST', '/usuarios/api/expedientes/capture-lote', {
        token, json: { accion: 'snapshot-lote', casos: casos.map(c => Object.assign({}, c, { origen: 'informe' })) }
    });
    check('3 . capture-lote crea la ficha y el snapshot', () => {
        assert.strictEqual(guardar.status, 200, 'status ' + guardar.status + ' ' + guardar.body.slice(0, 300));
        const r = JSON.parse(guardar.body).resumen || {};
        assert.strictEqual(r.snapshots, 1, 'snapshots creados: ' + r.snapshots);
    });

    // ── 4. 🎯 LO QUE NINGÚN TEST LOCAL PUEDE PROBAR: la fila REAL en Postgres ─
    const fila = await pool.query(
        `SELECT s.kind, s.data FROM expediente_snapshots s
           JOIN expedientes_seguidos e ON e.id = s.expediente_id
          WHERE e.user_id = $1 ORDER BY s.id DESC LIMIT 1`, [userId]);

    check('4 . el JSONB persistido trae las 6 secciones (round-trip por Postgres real)', () => {
        assert.strictEqual(fila.rows.length, 1, 'no se creo ninguna fila');
        assert.strictEqual(fila.rows[0].kind, 'informe');
        const d = fila.rows[0].data;
        assert.strictEqual(d.movimientos.length, MOVS.length, 'movimientos');
        assert.strictEqual(d.historicos.length, HIST.length, 'historicos');
        assert.strictEqual(d.intervinientes.length, INTERV.length, 'intervinientes');
        assert.strictEqual(d.vinculados.length, VINC.length, 'vinculados');
        assert.strictEqual(d.recursos.length, RECUR.length, 'recursos');
        assert.strictEqual(d.notas.length, NOTAS.length, 'notas');
        assert.strictEqual(d.pdf, PDF, 'pdf');
    });

    check('5 . el contenido sobrevive intacto, incluido el salto de linea interno de intervinientes', () => {
        const d = fila.rows[0].data;
        assert.strictEqual(d.movimientos[0].detalle, MOVS[0].detalle);
        assert.strictEqual(d.historicos[0].detalle, HIST[0].detalle);
        assert.strictEqual(d.intervinientes[0], INTERV[0]);
        assert.ok(d.intervinientes[0].includes('\n'), 'se perdio el salto de linea interno');
        assert.strictEqual(d.notas[0], NOTAS[0]);
    });

    // ── 6. NO-REGRESION: procuración NO gana las secciones nuevas ────────────
    const loteProc = JSON.stringify([{
        exp: 'CNT 049614/2024', jur: 'CNT', dep: 'JUZGADO X', car: 'PRUEBA c/ PRUEBA', sit: 'EN LETRA',
        fproc: '4/9/2026',
        movs: JSON.stringify(MOVS),
        // Un visor de procuración NO manda estas claves, pero se mandan a propósito
        // para confirmar que el backend las IGNORA cuando kind != 'informe'.
        hist: JSON.stringify(HIST), interv: JSON.stringify(INTERV),
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

    check('6 . [no-regresion] un snapshot de PROCURACION sigue teniendo SOLO movimientos', () => {
        assert.strictEqual(filaP.rows.length, 1);
        assert.strictEqual(filaP.rows[0].kind, 'procuracion');
        const d = filaP.rows[0].data;
        assert.strictEqual(d.movimientos.length, MOVS.length, 'perdio los movimientos');
        for (const k of ['historicos', 'intervinientes', 'vinculados', 'recursos', 'notas', 'pdf']) {
            assert.ok(!(k in d), `procuracion gano la clave "${k}": ` + JSON.stringify(d).slice(0, 160));
        }
    });
}

async function limpiar() {
    try {
        if (userId) {
            await pool.query(
                `DELETE FROM expediente_snapshots WHERE expediente_id IN
                 (SELECT id FROM expedientes_seguidos WHERE user_id=$1)`, [userId]);
            await pool.query('DELETE FROM bitacora_entries WHERE user_id=$1', [userId]);
            await pool.query('DELETE FROM expedientes_seguidos WHERE user_id=$1', [userId]);
            await pool.query('DELETE FROM subscriptions WHERE user_id=$1', [userId]);
            await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        }
        if (planId) {
            await pool.query('DELETE FROM plans WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_id=$1)', [planId]);
        }
        console.log('\n   limpieza: fixture borrado (usuario ' + userId + ', plan ' + planId + ')');
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
