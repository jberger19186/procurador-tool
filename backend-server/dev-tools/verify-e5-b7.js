/**
 * verify-e5-b7.js — harness de la fase E5 (B.7: suspensión real por términos).
 *
 * Dos bloques independientes:
 *   (A) SQL del job diario, contra un Postgres REAL, en una base descartable que el
 *       propio script crea y borra. Nunca toca `procurador_db` (ni local ni remota):
 *       aborta si el nombre de la base de trabajo no es el descartable.
 *   (B) middleware `requireLegalOk` + montaje de la página, con Express real y una
 *       base falsa (no hace falta Postgres para eso).
 *
 * Uso:  node dev-tools/verify-e5-b7.js            (A + B)
 *       node dev-tools/verify-e5-b7.js --solo-b   (solo B, sin Postgres)
 */
'use strict';
require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const DB_HARNESS = 'e5_b7_harness';   // base descartable — ver guarda en bloqueA()

let ok = 0, fail = 0;
const T = (nombre, cond, extra) => {
    if (cond) { ok++; console.log('  PASS  ' + nombre); }
    else      { fail++; console.log('  FAIL  ' + nombre + (extra ? '  <- ' + extra : '')); }
};
const H = (t) => console.log('\n-- ' + t + ' ' + '-'.repeat(Math.max(0, 64 - t.length)));

// ═══════════════════════════════════════════════════════════════════════════
//  El SQL bajo prueba se EXTRAE de server.js, no se copia.
//  Copiarlo haría que el harness siguiera en verde si alguien cambia el cron.
// ═══════════════════════════════════════════════════════════════════════════
const SERVER_JS = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Las aserciones de abajo miran CODIGO, no prosa: los comentarios de esta fase citan
// a proposito el SQL que reemplazan (`legal_pending_since = COALESCE(...)`), y sin
// esto una asercion daria FAIL por su propia documentacion.
const soloCodigo = (src) => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

function extraerSql(marcador, debeContener) {
    const i = SERVER_JS.indexOf(marcador);
    if (i < 0) throw new Error('no se encontro el marcador: ' + marcador);
    const desde = SERVER_JS.indexOf('`', i) + 1;
    const hasta = SERVER_JS.indexOf('`', desde);
    const sql = SERVER_JS.slice(desde, hasta);
    if (!sql.includes(debeContener)) throw new Error('el SQL extraido no contiene "' + debeContener + '"');
    return sql;
}
const SQL_RECORDATORIO = extraerSql('const aviso = await pool.query(', 'legal_pending_since');
const SQL_SUSPENSION   = extraerSql('const susp = await pool.query(',  'legal_suspended = TRUE');

// ═══════════════════════════════════════════════════════════════════════════
//  BLOQUE A — el SQL del job contra Postgres real
// ═══════════════════════════════════════════════════════════════════════════
async function bloqueA() {
    const { Client } = require('pg');
    const conn = {
        host: process.env.DB_HOST, port: process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD
    };

    const admin = new Client(Object.assign({}, conn, { database: 'postgres', connectionTimeoutMillis: 4000 }));
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS ' + DB_HARNESS);
    await admin.query('CREATE DATABASE ' + DB_HARNESS);
    await admin.end();

    const db = new Client(Object.assign({}, conn, { database: DB_HARNESS }));
    await db.connect();

    // GUARDA DURA: si por lo que fuera estuvieramos conectados a otra base, no se
    // ejecuta ni una sentencia de escritura. Misma leccion que el incidente de
    // reencrypt_scripts.js apuntando a produccion (2026-08-31).
    const cual = (await db.query('SELECT current_database() d')).rows[0].d;
    if (cual !== DB_HARNESS) throw new Error('ABORTA: conectado a "' + cual + '", esperaba "' + DB_HARNESS + '"');
    console.log('  (base de trabajo: ' + cual + ' - descartable)');

    // Esquema minimo, copiado de database/schema.sql con sus CHECK y UNIQUE reales:
    // el CHECK de user_notifications.type es justamente lo que romperia el INSERT del
    // job en produccion si el tipo fuera inventado.
    await db.query(`
        CREATE TABLE users (
            id serial PRIMARY KEY,
            email varchar(255) NOT NULL,
            nombre varchar(100),
            role varchar(50) DEFAULT 'user',
            legal_pending_since timestamptz,
            legal_suspended boolean DEFAULT false,
            CONSTRAINT check_role_valid CHECK (role IN ('user','admin'))
        );
        CREATE TABLE legal_documents (
            id serial PRIMARY KEY,
            type varchar(10) NOT NULL,
            version varchar(20) NOT NULL,
            title varchar(255) NOT NULL,
            html_content text NOT NULL,
            is_current boolean DEFAULT false,
            requires_acceptance boolean DEFAULT true,
            CONSTRAINT legal_documents_type_check CHECK (type IN ('tyc','pyp'))
        );
        CREATE TABLE user_legal_acceptances (
            id serial PRIMARY KEY,
            user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            document_id int NOT NULL REFERENCES legal_documents(id),
            accepted_at timestamptz DEFAULT now(),
            ip_hash varchar(16),
            UNIQUE (user_id, document_id)
        );
        CREATE TABLE user_notifications (
            id serial PRIMARY KEY,
            user_id int,
            title varchar(200) NOT NULL,
            message text NOT NULL,
            type varchar(20) DEFAULT 'info' NOT NULL,
            action_url text,
            read_at timestamptz,
            created_by int,
            created_at timestamptz DEFAULT now(),
            expires_at timestamptz,
            CONSTRAINT user_notifications_type_check
                CHECK (type IN ('info','warning','error','success','legal_update'))
        );
    `);

    // Los 2 documentos vigentes que hay en produccion (medido 2026-09-03).
    await db.query(`INSERT INTO legal_documents (id,type,version,title,html_content,is_current,requires_acceptance)
                    VALUES (1,'tyc','1.0','TyC','<p>x</p>',TRUE,TRUE),
                           (2,'pyp','1.0','PyP','<p>y</p>',TRUE,TRUE)`);

    // Poblacion. Los 3 primeros REPRODUCEN EL ESTADO REAL DE PRODUCCION medido antes
    // de esta fase: 0 filas en user_legal_acceptances para todos, legal_pending_since
    // NULL, legal_suspended false. Los dos admins (6,7) y el usuario real (250).
    const filas = [
        [6,   'admin@procurador.com',    'Admin1',    'admin', null,                                              false],
        [7,   'admin@tudominio.com',     'Admin2',    'admin', null,                                              false],
        [250, 'procuradortool@gmail.com','Real',      'user',  null,                                              false],
        [301, 'vencido@x.io',            'Vencido',   'user',  "NOW() - INTERVAL '16 days'",                       false],
        [302, 'aceptado@x.io',           'Aceptado',  'user',  "NOW() - INTERVAL '16 days'",                       false],
        [303, 'admin16@x.io',            'AdminVenc', 'admin', "NOW() - INTERVAL '16 days'",                       false],
        [304, 'atiempo@x.io',            'ATiempo',   'user',  "NOW() - INTERVAL '5 days'",                        false],
        [305, 'yasusp@x.io',             'YaSusp',    'user',  "NOW() - INTERVAL '20 days'",                       true ],
        [306, 'nullsusp@x.io',           'NullSusp',  'user',  "NOW() - INTERVAL '16 days'",                       null ],
        [307, 'dia12@x.io',              'Dia12',     'user',  "NOW() - INTERVAL '12 days' - INTERVAL '1 hour'",   false],
        [308, 'dia14@x.io',              'Dia14',     'user',  "NOW() - INTERVAL '14 days'",                       false]
    ];
    for (const f of filas) {
        await db.query(
            'INSERT INTO users (id,email,nombre,role,legal_pending_since,legal_suspended) VALUES ($1,$2,$3,$4,' + (f[4] || 'NULL') + ',$5)',
            [f[0], f[1], f[2], f[3], f[5]]
        );
    }
    // 302 acepto los 2 documentos, pero quedo con legal_pending_since sucio.
    await db.query('INSERT INTO user_legal_acceptances (user_id,document_id) VALUES (302,1),(302,2)');

    H('A.1 - recordatorio a los 12 dias (solo lee, no escribe)');
    const antesRec = (await db.query('SELECT * FROM users ORDER BY id')).rows;
    const rec = await db.query(SQL_RECORDATORIO);
    const idsRec = rec.rows.map(r => r.id).sort((a, b) => a - b);
    T('avisa exactamente al que esta en el dia 12', JSON.stringify(idsRec) === '[307]', 'dio ' + JSON.stringify(idsRec));
    T('NO avisa al del dia 14 (fuera de la ventana de 1 dia)', !idsRec.includes(308));
    T('NO avisa a los 3 usuarios de produccion', !idsRec.some(i => [6, 7, 250].includes(i)));
    const despuesRec = (await db.query('SELECT * FROM users ORDER BY id')).rows;
    T('el recordatorio NO modifica ninguna fila', JSON.stringify(antesRec) === JSON.stringify(despuesRec));

    H('A.2 - suspension a los 15 dias');
    const susp = await db.query(SQL_SUSPENSION);
    const idsSusp = susp.rows.map(r => r.id).sort((a, b) => a - b);
    T('suspende al vencido (301)', idsSusp.includes(301), 'dio ' + JSON.stringify(idsSusp));
    T('suspende tambien al que tenia legal_suspended NULL (306)', idsSusp.includes(306), 'el COALESCE es lo que lo captura');
    T('NO suspende al que ya acepto, pese a fecha vencida (302)', !idsSusp.includes(302), 'esto es lo que hace el EXISTS');
    T('NO suspende al admin vencido (303)', !idsSusp.includes(303));
    T('NO suspende al que esta en plazo (304)', !idsSusp.includes(304));
    T('NO re-suspende al ya suspendido (305)', !idsSusp.includes(305), 'idempotencia');
    T('NO suspende al del dia 12 ni al del 14', !idsSusp.includes(307) && !idsSusp.includes(308));

    H('A.3 - LOS 3 USUARIOS DE PRODUCCION, tal como estan hoy');
    for (const id of [6, 7, 250]) T('user ' + id + ': NO suspendido por el job', !idsSusp.includes(id));
    const prod = (await db.query('SELECT id, legal_suspended FROM users WHERE id IN (6,7,250) ORDER BY id')).rows;
    T('los 3 quedan con legal_suspended = false tras correr el job',
        prod.every(r => r.legal_suspended === false), JSON.stringify(prod));

    // ── Contraste: el diseno que HABRIA roto produccion ─────────────────────
    // El riesgo real de esta fase no era suspender de menos, era suspender de mas.
    // Si el job (o el gate) decidiera "pendiente" mirando SOLO si falta la fila en
    // user_legal_acceptances —que es la lectura intuitiva de "no acepto los
    // terminos"— los 3 usuarios de produccion cumplen esa condicion HOY: los 2
    // admins y la unica cuenta real tienen CERO filas en esa tabla (el usuario 250
    // acepto por el mecanismo viejo, `users.toc_accepted_at`, que esta tabla no
    // conoce). Medido en produccion el 2026-09-03.
    //
    // Este test corre ese diseno alternativo a proposito y comprueba que se lleva
    // puestos a los 3, para dejar por escrito por que el job se apoya en
    // `legal_pending_since` (que hoy es NULL para todos) y el gate en
    // `legal_suspended` (que hoy es false para todos), y no en las aceptaciones.
    H('A.3b - contraste: el diseno alternativo SI habria roto produccion');
    const alternativo = await db.query(`
        SELECT u.id FROM users u
        WHERE EXISTS (
            SELECT 1 FROM legal_documents ld
            WHERE ld.is_current = TRUE AND ld.requires_acceptance = TRUE
              AND NOT EXISTS (SELECT 1 FROM user_legal_acceptances a
                              WHERE a.user_id = u.id AND a.document_id = ld.id))
        ORDER BY u.id
    `);
    const idsAlt = alternativo.rows.map(r => r.id);
    T('un gate por "falta la aceptacion" alcanzaria a los 3 usuarios de produccion',
        [6, 7, 250].every(i => idsAlt.includes(i)),
        'alcanzaria a ' + JSON.stringify(idsAlt));
    T('...y el job real, sobre los mismos datos, no toca a ninguno de los 3',
        ![6, 7, 250].some(i => idsSusp.includes(i)));

    H('A.4 - idempotencia: segunda corrida del mismo job');
    const susp2 = await db.query(SQL_SUSPENSION);
    T('la segunda corrida no suspende a nadie mas', susp2.rowCount === 0, 'devolvio ' + susp2.rowCount);

    H('A.5 - el INSERT de notificacion pasa el CHECK real de la tabla');
    let insertOk = true, msg = '';
    try {
        await db.query(`INSERT INTO user_notifications (user_id,title,message,type,action_url,expires_at)
                        VALUES ($1,$2,$3,'legal_update',$4, NOW() + INTERVAL '90 days')`,
            [301, 'Tu acceso quedo suspendido', 'mensaje', 'https://x/legal/accept/']);
    } catch (e) { insertOk = false; msg = e.message; }
    T("type='legal_update' es aceptado por user_notifications_type_check", insertOk, msg);
    let rechazado = false;
    try {
        await db.query("INSERT INTO user_notifications (user_id,title,message,type) VALUES (301,'t','m','legal_suspended')");
    } catch (e) { rechazado = true; }
    T('control negativo: un type inventado SI seria rechazado', rechazado);

    H('A.6 - aceptar revierte la suspension (el mismo UPDATE de /legal/accept)');
    await db.query('INSERT INTO user_legal_acceptances (user_id,document_id) VALUES (301,1),(301,2)');
    await db.query('UPDATE users SET legal_pending_since = NULL, legal_suspended = FALSE WHERE id = 301');
    const tras = (await db.query('SELECT legal_suspended, legal_pending_since FROM users WHERE id=301')).rows[0];
    T('301 deja de estar suspendido al aceptar', tras.legal_suspended === false && tras.legal_pending_since === null);
    const susp3 = await db.query(SQL_SUSPENSION);
    T('y el job ya no vuelve a agarrarlo', !susp3.rows.map(r => r.id).includes(301));

    H('A.7 - el job NO escribe legal_pending_since (no arranca ningun reloj)');
    const clausulaSet = (SQL_SUSPENSION.match(/SET[\s\S]*?WHERE/i) || [''])[0];
    T('la clausula SET del UPDATE solo toca legal_suspended',
        /legal_suspended/.test(clausulaSet) && !/legal_pending_since/.test(clausulaSet), clausulaSet.trim());
    T('el SQL del recordatorio es un SELECT puro',
        /^\s*SELECT/i.test(SQL_RECORDATORIO.trim()) && !/\b(UPDATE|INSERT|DELETE)\b/i.test(SQL_RECORDATORIO));
    const setters = (soloCodigo(SERVER_JS).match(/legal_pending_since\s*=[^=]/g) || []).length;
    T('el codigo de server.js no asigna legal_pending_since en ningun lado',
        setters === 0, 'encontradas ' + setters + ' asignaciones');

    await db.end();
}

// Borra la base descartable. La llama el cierre, despues de A y C.
async function tirarBase() {
    const { Client } = require('pg');
    const admin = new Client({
        host: process.env.DB_HOST, port: process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'postgres'
    });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS ' + DB_HARNESS);
    await admin.end();
    console.log('\n  (base ' + DB_HARNESS + ' eliminada)');
}

// ═══════════════════════════════════════════════════════════════════════════
//  BLOQUE B — middleware y montaje, con Express real
// ═══════════════════════════════════════════════════════════════════════════
async function bloqueB() {
    const express = require('express');
    const requireLegalOk = require('../middleware/requireLegalOk');

    // Base falsa: devuelve lo que le digamos, o explota si `romper` esta en true.
    const fakeDb = (valor, romper) => ({
        query: async () => {
            if (romper) throw new Error('conexion caida (simulada)');
            return { rows: valor === undefined ? [] : [{ legal_suspended: valor }] };
        }
    });
    const authFake = (req, _res, next) => { req.user = { id: 42 }; next(); };

    const app = (db, opts) => {
        const a = express();
        a.set('db', db);
        a.use('/x', authFake, requireLegalOk(opts), (_req, res) => res.json({ llego: true }));
        return a;
    };

    const pedir = (a, metodo, ruta) => new Promise((resolve) => {
        const srv = a.listen(0, async () => {
            const r = await fetch('http://127.0.0.1:' + srv.address().port + (ruta || '/x'),
                { method: (metodo || 'get').toUpperCase() });
            let body = null; try { body = await r.json(); } catch (e) { }
            srv.close(() => resolve({ status: r.status, body: body }));
        });
    });

    H('B.1 - el gate bloquea solo cuando legal_suspended es true');
    let r = await pedir(app(fakeDb(true)));
    T('suspendido -> 403', r.status === 403, 'dio ' + r.status);
    T('403 trae action=accept_terms', r.body && r.body.action === 'accept_terms', JSON.stringify(r.body));
    T('403 trae la url de la pagina de aceptacion', r.body && r.body.url === '/legal/accept/', JSON.stringify(r.body));
    T('403 trae un mensaje para el usuario', r.body && typeof r.body.error === 'string' && r.body.error.length > 20);

    r = await pedir(app(fakeDb(false)));
    T('no suspendido -> pasa (200)', r.status === 200 && r.body.llego === true, 'dio ' + r.status);

    H('B.2 - FAIL-OPEN: ante la duda, deja pasar');
    r = await pedir(app(fakeDb(null)));
    T('legal_suspended NULL -> pasa', r.status === 200, 'dio ' + r.status);
    r = await pedir(app(fakeDb(undefined)));
    T('usuario inexistente (0 filas) -> pasa', r.status === 200, 'dio ' + r.status);
    r = await pedir(app(fakeDb(true, true)));
    T('la base falla -> PASA, no 500 ni 403', r.status === 200, 'dio ' + r.status);

    H('B.3 - soloEscrituras (Bitacora)');
    r = await pedir(app(fakeDb(true), { soloEscrituras: true }), 'get');
    T('suspendido + GET -> pasa (puede leer/exportar lo suyo)', r.status === 200, 'dio ' + r.status);
    r = await pedir(app(fakeDb(true), { soloEscrituras: true }), 'post');
    T('suspendido + POST -> 403', r.status === 403, 'dio ' + r.status);
    r = await pedir(app(fakeDb(true), { soloEscrituras: true }), 'delete');
    T('suspendido + DELETE -> 403', r.status === 403, 'dio ' + r.status);
    r = await pedir(app(fakeDb(false), { soloEscrituras: true }), 'post');
    T('no suspendido + POST -> pasa', r.status === 200, 'dio ' + r.status);

    H('B.4 - sin authenticateToken delante, no rompe (deja pasar)');
    const sinAuth = express();
    sinAuth.set('db', fakeDb(true));
    sinAuth.use('/x', requireLegalOk(), (_req, res) => res.json({ llego: true }));
    r = await pedir(sinAuth);
    T('sin req.user -> pasa (el gate de auth es otro middleware)', r.status === 200, 'dio ' + r.status);

    H('B.5 - montaje de la pagina: el estatico gana sobre el router');
    const real = express();
    real.use('/legal/accept', express.static(path.join(__dirname, '..', 'public', 'legal', 'accept')));
    const rLegal = express.Router();
    rLegal.post('/accept', (_req, res) => res.json({ post: true }));
    real.use('/legal', rLegal);
    r = await pedir(real, 'get', '/legal/accept/');
    T('GET /legal/accept/ -> 200 (hoy en produccion es 404)', r.status === 200, 'dio ' + r.status);
    r = await pedir(real, 'post', '/legal/accept');
    T('POST /legal/accept sigue llegando al router (no lo tapa el estatico)',
        r.status === 200 && r.body && r.body.post === true, 'dio ' + r.status + ' ' + JSON.stringify(r.body));

    // Control: el router de legal.js NO define GET /accept, asi que hoy ese GET cae en 404.
    const soloRouter = express();
    const rLegal3 = express.Router();
    rLegal3.post('/accept', (_req, res) => res.json({ post: true }));
    soloRouter.use('/legal', rLegal3);
    r = await pedir(soloRouter, 'get', '/legal/accept/');
    T('control: SIN el estatico, GET /legal/accept/ da 404 (el bug que se corrige)', r.status === 404, 'dio ' + r.status);

    H('B.6 - la pagina servida cumple el criterio de la spec');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'legal', 'accept', 'index.html'), 'utf8');
    T('0 usos de insercion de HTML crudo', !html.includes('insertAdjacent' + 'HTML'));
    const asignacionesInner = (soloCodigo(html).match(/\.innerHTML\s*=[^\n]*/g) || []);
    T('ningun innerHTML del codigo toca el documento legal (solo los 2 spinners preexistentes)',
        asignacionesInner.every(a => /spinner/.test(a)), JSON.stringify(asignacionesInner));
    T('el documento va en un iframe con sandbox', html.includes("setAttribute('sandbox', 'allow-same-origin')"));
    T('el iframe apunta a /legal/page (texto de la base)', html.includes("'/legal/page?type='"));
    T('ya no linkea al estatico /terminos/ ni /privacidad/',
        !html.includes("'/terminos/'") && !html.includes("'/privacidad/'"));
    T("const API = '' (relativo) sigue intacto", html.includes("const API = '';"));
    T('los botones de salida van al portal, no al panel admin', !html.includes('href="/dashboard"'));
    const htmlCodigo = soloCodigo(html);
    T('la funcion checkSuspended() ya no existe', !/function\s+checkSuspended/.test(htmlCodigo));
    T('ya no hay ningun fetch a verify-session en la pagina', !/verify-session/.test(htmlCodigo));
    T('el estado de suspension sale de /legal/pending', /if \(data\.suspended\)/.test(htmlCodigo));

    H('B.7 - wiring: el gate esta donde tiene que estar y no donde no');
    const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const lic = rd('routes/license.js'), cli = rd('routes/client.js'), bit = rd('routes/bitacora.js');
    T('license: execution/start tiene el gate',
        /execution\/start',\s*authenticateToken,\s*requireLegalOk\(\)/.test(lic));
    T('client: scripts/check tiene el gate',    /scripts\/check\/:scriptName',[^\n]*requireLegalOk\(\)/.test(cli));
    T('client: scripts/download tiene el gate', /scripts\/download\/:scriptName',[^\n]*requireLegalOk\(\)/.test(cli));
    T('client: verify-session NO tiene el gate', !/verify-session',[^\n]*requireLegalOk/.test(cli));
    T('client: /account NO tiene el gate',       !/'\/account',[^\n]*requireLegalOk/.test(cli));
    const montajes = soloCodigo(bit).split('\n').filter(l => /^router\.use\(/.test(l.trim()));
    T('bitacora: hay exactamente 4 montajes de sub-router', montajes.length === 4, 'hay ' + montajes.length);
    T('bitacora: los 4 montan el gate como soloEscrituras',
        montajes.every(l => l.includes('requireLegalOk({ soloEscrituras: true })')), JSON.stringify(montajes));
    T('bitacora: los 4 conservan authenticateToken y checkBitacoraPlan (no-regresion)',
        montajes.every(l => l.includes('authenticateToken') && l.includes('checkBitacoraPlan()')));
    T('bitacora: el gate NO se monta sobre el router raiz (regla P1)',
        !/router\.use\(\s*requireLegalOk/.test(bit) && !/router\.use\('\/',\s*[^)]*requireLegalOk/.test(bit));
    T('auth: login devuelve legalSuspended', /legalSuspended:\s*user\.legal_suspended === true/.test(rd('routes/auth.js')));
    T('auth: login NO agrega legal_suspended a blockedStatuses',
        !/blockedStatuses\s*=\s*\{[\s\S]{0,600}legal_suspended/.test(rd('routes/auth.js')));
    T('legal: /pending devuelve suspended',
        /suspended:\s*userRow\.rows\[0\]\?\.legal_suspended === true/.test(rd('routes/legal.js')));
    T('server: el estatico de /legal/accept va ANTES del router de /legal',
        SERVER_JS.indexOf("app.use('/legal/accept'") < SERVER_JS.indexOf("app.use('/legal', require"));
}


// ===========================================================================
//  BLOQUE C - end-to-end: routers REALES + JWT real + Postgres real
//  Es el criterio de cierre de la ficha, corrido local contra la base
//  descartable en vez de staging. Reusa la base que dejo el bloque A.
// ===========================================================================
async function bloqueC() {
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { Pool } = require('pg');

    if (!process.env.JWT_SECRET) { console.log('  (sin JWT_SECRET en .env - bloque C omitido)'); return; }

    const pool = new Pool({
        host: process.env.DB_HOST, port: process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB_HARNESS
    });
    const cual = (await pool.query('SELECT current_database() d')).rows[0].d;
    if (cual !== DB_HARNESS) throw new Error('ABORTA: bloque C conectado a "' + cual + '"');

    // Tablas que tocan los handlers reales despues del gate.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id serial PRIMARY KEY, user_id int, plan varchar(50), status varchar(20),
            payment_provider varchar(20), usage_count int DEFAULT 0, usage_limit int DEFAULT 20,
            expires_at timestamptz);
        CREATE TABLE IF NOT EXISTS active_executions (
            id serial PRIMARY KEY, user_id int UNIQUE, machine_id varchar(255),
            script_name varchar(120), started_at timestamptz DEFAULT now(),
            last_heartbeat timestamptz DEFAULT now(), expires_at timestamptz);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS machine_id varchar(255);
    `);
    await pool.query("INSERT INTO subscriptions (user_id,plan,status,usage_count,usage_limit) VALUES (250,'COMBO_PROMO','active',0,999999)");

    const app = express();
    app.use(express.json());
    app.set('db', pool);
    require('../middleware/tokenBlacklist').init(pool);
    app.use('/legal/accept', express.static(path.join(__dirname, '..', 'public', 'legal', 'accept')));
    app.use('/legal', require('../routes/legal'));
    app.use('/license', require('../routes/license'));

    const token = jwt.sign({ id: 250, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const srv = await new Promise(r => { const x = app.listen(0, () => r(x)); });
    const base = 'http://127.0.0.1:' + srv.address().port;
    const pedir = async (metodo, ruta, conToken) => {
        const r = await fetch(base + ruta, {
            method: metodo,
            headers: Object.assign({ 'Content-Type': 'application/json' },
                conToken ? { Authorization: 'Bearer ' + token } : {}),
            body: metodo === 'POST' ? JSON.stringify({ machineId: 'harness', scriptName: 'testM1.js' }) : undefined
        });
        let b = null; try { b = await r.json(); } catch (e) { }
        return { status: r.status, body: b };
    };
    const esTerminos = (r) => r.status === 403 && r.body && r.body.action === 'accept_terms';

    // Estado de partida: usuario 250 tal cual produccion (no suspendido).
    await pool.query('UPDATE users SET legal_suspended = FALSE, legal_pending_since = NULL WHERE id = 250');

    H('C.1 - usuario NO suspendido (el estado real de produccion hoy)');
    let r = await pedir('POST', '/license/execution/start', true);
    T('execution/start responde 200 (el gate lo deja pasar y el handler corre entero)',
        r.status === 200 && r.body && r.body.success === true, 'dio ' + r.status + ' ' + JSON.stringify(r.body));
    r = await pedir('GET', '/legal/pending', true);
    T('/legal/pending responde 200', r.status === 200, 'dio ' + r.status);
    T('/legal/pending dice suspended=false', r.body && r.body.suspended === false, JSON.stringify(r.body));
    T('/legal/pending lista los 2 documentos vigentes sin aceptar',
        r.body && Array.isArray(r.body.pending) && r.body.pending.length === 2, JSON.stringify(r.body && r.body.pending));

    H('C.2 - el job lo suspende (16 dias) y el gate empieza a cortar');
    await pool.query("UPDATE users SET legal_pending_since = NOW() - INTERVAL '16 days' WHERE id = 250");
    const susp = await pool.query(SQL_SUSPENSION);
    T('el job suspende al 250 con el plazo vencido', susp.rows.map(x => x.id).includes(250));

    r = await pedir('POST', '/license/execution/start', true);
    T('execution/start -> 403', r.status === 403, 'dio ' + r.status);
    T('403 con action=accept_terms', r.body && r.body.action === 'accept_terms', JSON.stringify(r.body));
    T('403 con url a /legal/accept/', r.body && r.body.url === '/legal/accept/', JSON.stringify(r.body));

    H('C.3 - pero SIGUE pudiendo llegar a la pantalla de aceptacion');
    r = await pedir('GET', '/legal/pending', true);
    T('/legal/pending sigue en 200 estando suspendido', r.status === 200, 'dio ' + r.status);
    T('/legal/pending ahora dice suspended=true', r.body && r.body.suspended === true, JSON.stringify(r.body));
    const pag = await fetch(base + '/legal/accept/');
    T('GET /legal/accept/ -> 200 (sin token, es estatico)', pag.status === 200, 'dio ' + pag.status);

    H('C.4 - acepta y el acceso vuelve, en el acto');
    r = await pedir('POST', '/legal/accept', true);
    T('POST /legal/accept -> 200', r.status === 200, 'dio ' + r.status + ' ' + JSON.stringify(r.body));
    T('acepto los 2 documentos', r.body && r.body.accepted === 2, JSON.stringify(r.body));
    const fila = (await pool.query('SELECT legal_suspended, legal_pending_since FROM users WHERE id=250')).rows[0];
    T('legal_suspended vuelve a false', fila.legal_suspended === false);
    T('legal_pending_since vuelve a NULL', fila.legal_pending_since === null);

    r = await pedir('POST', '/license/execution/start', true);
    T('execution/start vuelve a 200 en el acto', r.status === 200 && r.body && r.body.success === true,
        'dio ' + r.status + ' ' + JSON.stringify(r.body));
    const susp2 = await pool.query(SQL_SUSPENSION);
    T('y el job ya no lo vuelve a agarrar', !susp2.rows.map(x => x.id).includes(250));

    await new Promise(res => srv.close(res));
    await pool.end();
}

(async () => {
    const soloB = process.argv.includes('--solo-b');
    console.log('\n== E5 / B.7 - suspension real por terminos no aceptados ==');
    try {
        if (!soloB) { console.log('\n### BLOQUE A - SQL del job contra Postgres real ###'); await bloqueA(); }
        console.log('\n### BLOQUE B - middleware, montaje y pagina ###');
        await bloqueB();
        if (!soloB) {
            console.log('\n### BLOQUE C - end-to-end con routers reales ###');
            await bloqueC();
            await tirarBase();
        }
    } catch (e) {
        fail++; console.log('\n  ERROR DEL HARNESS:', e.message, '\n', e.stack);
        if (!soloB) { try { await tirarBase(); } catch (e2) { } }
    }
    console.log('\n' + '='.repeat(70) + '\n  RESULTADO: ' + ok + ' PASS - ' + fail + ' FAIL\n' + '='.repeat(70) + '\n');
    process.exit(fail ? 1 : 0);
})();
