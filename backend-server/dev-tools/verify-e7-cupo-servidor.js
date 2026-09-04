/**
 * verify-e7-cupo-servidor.js — Harness de la fase E7 del plan de remediación
 * (PLAN-EJECUCION-PROCURADORTOOL.md, "E7 — Cupo contado por el servidor (B.8)").
 *
 * CORRE 100% LOCAL. No abre conexión a ninguna base, no hace ninguna petición de red
 * y no escribe fuera de la memoria del proceso. Se corre con
 * `node dev-tools/verify-e7-cupo-servidor.js` desde `backend-server/`.
 *
 * A diferencia del harness de E6, acá casi todo es [EJEC]: en vez de leer el fuente,
 * se construye un POOL DE POSTGRES FALSO que interpreta las consultas reales de los
 * handlers (guardas `AND col < $2` incluidas, y BEGIN/ROLLBACK/COMMIT con snapshot),
 * y se invocan los handlers REALES sacados del router de Express. Eso permite probar
 * de verdad lo que más importa de esta fase y no se puede probar leyendo código:
 *
 *   · que `start` descuenta y `log-execution` NO vuelve a descontar (doble conteo);
 *   · que un cliente VIEJO (sin `executionId`) consume UNA sola unidad;
 *   · que un 409 por candado ajeno DEVUELVE el cupo (ROLLBACK real);
 *   · que el 403 mantiene el shape que parsea el cliente ya instalado;
 *   · que informe y monitoreo —que hoy no piden permiso— siguen contando.
 *
 * El pool falso no es PostgreSQL: emula las consultas concretas de estos tres
 * archivos. Los puntos que dependen del motor real (aislamiento de transacciones
 * bajo concurrencia real, el índice único, la migración aplicada) quedan en el
 * criterio de cierre de staging, que este harness imprime al final con los comandos.
 */

const path = require('path');
const fs   = require('fs');

const ROOT = path.join(__dirname, '..');
const rd   = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let ok = 0, fail = 0;
function check(nombre, cond, detalle = '') {
    if (cond) { ok++; console.log(`  OK   ${nombre}`); }
    else { fail++; console.log(`  FALLA ${nombre}${detalle ? ` -- ${detalle}` : ''}`); }
}
function seccion(t) { console.log(`\n${t}`); }

// ═══════════════════════════════════════════════════════════════════════════════
//  Pool de PostgreSQL falso
// ═══════════════════════════════════════════════════════════════════════════════
const LIMITES_PLAN = {
    proc_executions_limit:   50,
    batch_executions_limit:  20,
    informe_limit:           50,
    monitor_novedades_limit: 50,
    proc_expedientes_limit:  null,
    batch_expedientes_limit: null,
};

function estadoInicial(over = {}) {
    return {
        sub: Object.assign({
            user_id: 1, status: 'active', expirada: false, plan_id: 7,
            payment_provider: 'mercadopago',
            usage_count: 0, usage_limit: 999999,
            proc_usage: 0, batch_usage: 0, informe_usage: 0, monitor_novedades_usage: 0,
            proc_bonus: 0, batch_bonus: 0, informe_bonus: 0, monitor_novedades_bonus: 0,
        }, over.sub || {}),
        plan: Object.assign({ id: 7 }, LIMITES_PLAN, over.plan || {}),
        user: Object.assign({ machine_id: 'MAQ-A', registration_status: 'active' }, over.user || {}),
        locks: [], usage_logs: [], monitor_logs: [], partes: [{ id: 55, user_id: 1 }],
        nextLockId: 1000,
    };
}

const clonar = (o) => JSON.parse(JSON.stringify(o));

function ejecutar(st, text, params = []) {
    const q = text.replace(/\s+/g, ' ').trim();
    const p = params;
    const subValida = () =>
        !st.sub.expirada &&
        (st.sub.status === 'active' ||
         (st.sub.status === 'suspended' && st.user.registration_status === 'pending_activation'));

    // ── lecturas ──────────────────────────────────────────────────────────────
    if (q.includes('FROM subscriptions s JOIN users u')) {
        return { rows: [{
            payment_provider: st.sub.payment_provider,
            usage_count: st.sub.usage_count, usage_limit: st.sub.usage_limit,
            machine_id: st.user.machine_id,
        }] };
    }
    if (q.includes('LEFT JOIN plans p') && q.includes('FROM subscriptions s')) {
        if (!subValida()) return { rows: [] };
        return { rows: [Object.assign({}, st.sub, st.plan,
            { registration_status: st.user.registration_status })] };
    }
    if (q.startsWith('SELECT usage_count, usage_limit, proc_usage')) {
        return { rows: [clonar(st.sub)] };
    }
    if (q.includes('FROM monitor_partes')) {
        return { rows: st.partes.filter(x => x.id === p[0] && x.user_id === p[1]).map(() => ({ '?column?': 1 })) };
    }
    if (q.includes('SELECT 1 FROM active_executions')) {
        // ⚠️ `WHERE id = $1` y no `id = $1` a secas: `user_id = $1` CONTIENE esa
        // subcadena, y el matcher laxo mandaba las tres consultas a la rama por id
        // (falso negativo que hacía aparecer un doble conteo inexistente).
        let f;
        if (q.includes('WHERE id = $1')) {
            f = st.locks.filter(l => l.id === p[0] && l.user_id === p[1] && l.quota_counted);
        } else if (q.includes("subsystem = 'monitor_novedades'")) {
            f = st.locks.filter(l => l.user_id === p[0] && l.quota_counted && l.subsystem === 'monitor_novedades');
        } else {
            f = st.locks.filter(l => l.user_id === p[0] && l.script_name === p[1] && l.quota_counted);
        }
        return { rows: f.map(() => ({ '?column?': 1 })) };
    }

    if (q.startsWith('UPDATE active_executions SET last_heartbeat')) {
        const f = st.locks.filter(l => l.user_id === p[0] && l.machine_id === p[1]);
        return { rows: f.map(l => ({ id: l.id })) };
    }

    // ── escrituras ────────────────────────────────────────────────────────────
    if (q.startsWith('UPDATE users SET machine_id')) {
        st.user.machine_id = p[0]; return { rows: [] };
    }

    if (q.startsWith('UPDATE subscriptions') && q.includes('monitor_novedades_usage = COALESCE') && q.includes('NULLIF')) {
        // /monitor/log — guarda de límite con subconsulta (plan_id NULL ⇒ sin límite)
        if (st.sub.status !== 'active') return { rows: [] };
        const base = (st.plan && st.plan.id === st.sub.plan_id) ? st.plan.monitor_novedades_limit : null;
        const tope = (base === null || base === -1 || st.sub.plan_id == null)
            ? 1000000000
            : base + (st.sub.monitor_novedades_bonus || 0);
        if ((st.sub.monitor_novedades_usage || 0) < tope) {
            st.sub.monitor_novedades_usage = (st.sub.monitor_novedades_usage || 0) + 1;
            return { rows: [{}] };
        }
        return { rows: [] };
    }

    if (q.startsWith('UPDATE subscriptions')) {
        const mCol = q.match(/SET (\w+_usage) =/);
        const col  = mCol ? mCol[1] : null;
        const conTrialGuard = q.includes('payment_provider IS NOT NULL');
        const conLimite     = /< \$2/.test(q);
        const tope          = conLimite ? p[1] : null;

        if (st.sub.expirada) return { rows: [] };
        if (conTrialGuard && !st.sub.payment_provider && st.sub.usage_count >= st.sub.usage_limit) return { rows: [] };
        // Rama global de compatibilidad de log-execution: `AND usage_count < usage_limit`
        if (!col && !conTrialGuard && q.includes('usage_count < usage_limit')
            && st.sub.usage_count >= st.sub.usage_limit) return { rows: [] };
        if (col && tope !== null && (st.sub[col] || 0) >= tope) return { rows: [] };

        if (col) st.sub[col] = (st.sub[col] || 0) + 1;
        if (q.includes('usage_count = s.usage_count + 1') || q.includes('usage_count = usage_count + 1')) {
            st.sub.usage_count += 1;
        }
        const row = { usage_count: st.sub.usage_count, usage_limit: st.sub.usage_limit };
        if (col) { row.nuevo_uso = st.sub[col]; row[col] = st.sub[col]; }
        return { rows: [row] };
    }

    if (q.startsWith('DELETE FROM active_executions WHERE expires_at')) return { rows: [] };

    if (q.startsWith('DELETE FROM active_executions WHERE user_id')) {
        const antes = st.locks.length;
        const borradas = st.locks.filter(l =>
            l.user_id === p[0] && l.machine_id === p[1] && (p[2] == null || l.id === p[2]));
        st.locks = st.locks.filter(l => !borradas.includes(l));
        void antes;
        return { rows: borradas.map(l => ({ id: l.id, subsystem: l.subsystem, quota_counted: l.quota_counted })) };
    }

    if (q.startsWith('INSERT INTO active_executions')) {
        const [userId, machineId, scriptName, subsystem] = p;
        const vivo = st.locks.find(l => l.user_id === userId);
        if (vivo) {
            if (vivo.machine_id !== machineId) return { rows: [] };   // ON CONFLICT ... WHERE
            Object.assign(vivo, { script_name: scriptName, subsystem, quota_counted: true, outcome: null });
            return { rows: [{ id: vivo.id }] };
        }
        const nueva = { id: st.nextLockId++, user_id: userId, machine_id: machineId,
                        script_name: scriptName, subsystem, quota_counted: true, outcome: null };
        st.locks.push(nueva);
        return { rows: [{ id: nueva.id }] };
    }

    if (q.startsWith('INSERT INTO usage_logs')) {
        st.usage_logs.push({ user_id: p[0], script_name: p[1], success: p[2],
                             error_message: p[3], subsystem: p[4], expedientes_count: p[5], execution_id: p[6] });
        return { rows: [] };
    }
    if (q.startsWith('INSERT INTO monitor_consultas_log')) {
        st.monitor_logs.push({ parte_id: p[0], user_id: p[1], modo: p[2] });
        return { rows: [] };
    }

    throw new Error('El pool falso no conoce esta consulta:\n' + q.slice(0, 220));
}

function mkDb(st) {
    const db = {
        _st: st,
        query: async (t, p) => ejecutar(st, t, p),
        connect: async () => {
            let snapshot = null;
            return {
                query: async (t, p) => {
                    const q = String(t).trim().toUpperCase();
                    if (q === 'BEGIN')    { snapshot = clonar(st); return { rows: [] }; }
                    if (q === 'COMMIT')   { snapshot = null;       return { rows: [] }; }
                    if (q === 'ROLLBACK') {
                        if (snapshot) { st.sub = snapshot.sub; st.locks = snapshot.locks;
                                        st.usage_logs = snapshot.usage_logs; st.user = snapshot.user;
                                        st.nextLockId = snapshot.nextLockId; }
                        snapshot = null; return { rows: [] };
                    }
                    return ejecutar(st, t, p);
                },
                release: () => {},
            };
        },
    };
    return db;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Invocación de los handlers REALES
// ═══════════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);
const licenseRouter = require(path.join(ROOT, 'routes/license.js'));
const clientRouter  = require(path.join(ROOT, 'routes/client.js'));
const monitorRouter = require(path.join(ROOT, 'routes/monitor.js'));

function capaDe(router, metodo, ruta) {
    return router.stack.find(l => l.route && l.route.path === ruta && l.route.methods[metodo]);
}
function handlerFinal(router, metodo, ruta) {
    const capa = capaDe(router, metodo, ruta);
    if (!capa) throw new Error(`No se encontró ${metodo.toUpperCase()} ${ruta}`);
    return capa.route.stack[capa.route.stack.length - 1].handle;
}

function mkRes() {
    const r = { statusCode: 200, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json   = (b) => { r.body = b; return r; };
    return r;
}
async function invocar(handler, db, body, userId = 1) {
    const req = { app: { get: (k) => (k === 'db' ? db : undefined) }, user: { id: userId }, body };
    const res = mkRes();
    await handler(req, res);
    return res;
}

const START = handlerFinal(licenseRouter, 'post', '/execution/start');
const END   = handlerFinal(licenseRouter, 'post', '/execution/end');
const LOGEX = handlerFinal(clientRouter,  'post', '/scripts/log-execution');
const MONLOG = handlerFinal(monitorRouter, 'post', '/log');

// ═══════════════════════════════════════════════════════════════════════════════
(async function main() {

seccion('1. Guards que conserva `start` (los de fases anteriores, no se perdió ninguno)');
{
    const capa = capaDe(licenseRouter, 'post', '/execution/start');
    const nombres = capa.route.stack.map(s => s.handle.name || '(anon)');
    check('start tiene 3 capas (authenticateToken + requireLegalOk + handler)',
        capa.route.stack.length === 3, `capas=${nombres.join(', ')}`);
    check('conserva authenticateToken (E-previas)', nombres.includes('authenticateToken'), nombres.join(','));
    const src = rd('routes/license.js');
    check('conserva requireLegalOk() en el montaje (B.7/E5)',
        /requireLegalOk\(\)/.test(src) && /router\.post\('\/execution\/start', authenticateToken, requireLegalOk\(\)/.test(src));
    check('conserva el gate del trial SEC-4/M2 (TRIAL_EXHAUSTED)', src.includes("code:    'TRIAL_EXHAUSTED'"));
    check('conserva el binding de dispositivo AUTH-1 (DEVICE_MISMATCH)', src.includes("code:    'DEVICE_MISMATCH'"));
    check('conserva el log de auditoría de AUTH-1', src.includes('[AUTH-1] DEVICE_MISMATCH'));
    check('conserva el candado atómico M3 (ON CONFLICT ... WHERE machine_id)',
        src.includes('ON CONFLICT (user_id) DO UPDATE') && src.includes('active_executions.machine_id = EXCLUDED.machine_id'));
    check('conserva el 409 DEVICE_LOCKED', src.includes("code:    'DEVICE_LOCKED'"));
}

seccion('2. El campo del body es `scriptName` (el error más caro de la spec)');
{
    const src = rd('routes/license.js');
    check('start desestructura `scriptName` del body', /const \{ machineId, scriptName \} = req\.body/.test(src));
    check('start NO lee `req.body.script_name`', !/req\.body\.script_name/.test(src));
    check('client.js NO lee `req.body.script_name`', !/req\.body\.script_name/.test(rd('routes/client.js')));

    const st = estadoInicial(); const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('start con scriptName válido responde 200 (el mapa resuelve de verdad)',
        r.statusCode === 200 && r.body.success === true, JSON.stringify(r.body));
    check('start devuelve executionId', Number.isInteger(r.body && r.body.executionId));
    check('start devuelve el subsistema resuelto por el servidor', r.body && r.body.subsystem === 'proc');
}

seccion('3. El subsistema lo decide el SERVIDOR, no el body');
{
    // Un cliente modificado pide un script de informe pero declara el subsistema barato.
    const st = estadoInicial(); const db = mkDb(st);
    await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'informequickscwpjn.js', subsystem: 'batch' });
    check('start con script de informe descuenta informe_usage, no batch_usage',
        st.sub.informe_usage === 1 && st.sub.batch_usage === 0,
        `informe=${st.sub.informe_usage} batch=${st.sub.batch_usage}`);

    const st2 = estadoInicial(); const db2 = mkDb(st2);
    await invocar(LOGEX, db2, { scriptName: 'informequickscwpjn.js', success: true, subsystem: 'batch' });
    check('log-execution ignora el `subsystem` del body y usa el del script',
        st2.sub.informe_usage === 1 && st2.sub.batch_usage === 0,
        `informe=${st2.sub.informe_usage} batch=${st2.sub.batch_usage}`);
    check('usage_logs guarda el subsistema resuelto por el servidor',
        st2.usage_logs[0] && st2.usage_logs[0].subsystem === 'informe');
}

seccion('4. Script fuera del mapa → 400, y sin fila en active_executions');
{
    const st = estadoInicial(); const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'backup-db.js' });
    check('start con script desconocido → 400', r.statusCode === 400, String(r.statusCode));
    check('  ... con code UNKNOWN_SCRIPT', r.body && r.body.code === 'UNKNOWN_SCRIPT');
    check('  ... sin descontar cupo', st.sub.proc_usage === 0 && st.sub.usage_count === 0);
    check('  ... sin crear candado', st.locks.length === 0);

    const st2 = estadoInicial(); const db2 = mkDb(st2);
    const r2 = await invocar(START, db2, { scriptName: 'procesarNovedadesCompleto.js' });
    check('start sin machineId sigue dando 400 (no regresión)', r2.statusCode === 400);
}

seccion('5. DOBLE CONTEO — cliente NUEVO (manda executionId)');
{
    const st = estadoInicial(); const db = mkDb(st);
    const s = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('start descontó 1 procuración', st.sub.proc_usage === 1, String(st.sub.proc_usage));
    check('start marcó quota_counted en el candado', st.locks[0].quota_counted === true);

    await invocar(LOGEX, db, { scriptName: 'procesarNovedadesCompleto.js', success: true,
                               subsystem: 'proc', executionId: s.body.executionId });
    check('log-execution con executionId NO vuelve a descontar → 1 sola unidad',
        st.sub.proc_usage === 1, `proc_usage=${st.sub.proc_usage}`);
    check('  ... y usage_count tampoco se duplica', st.sub.usage_count === 1, String(st.sub.usage_count));
    check('  ... pero la bitácora SÍ se escribe', st.usage_logs.length === 1);
    check('  ... correlacionada por execution_id', st.usage_logs[0].execution_id === s.body.executionId);

    await invocar(END, db, { machineId: 'MAQ-A', executionId: s.body.executionId, outcome: 'ok' });
    check('end libera el candado', st.locks.length === 0);
    check('end NO devuelve cupo (sin reembolso, por diseño)', st.sub.proc_usage === 1);
}

seccion('6. DOBLE CONTEO — cliente VIEJO (los instalados HOY, sin executionId)');
{
    const st = estadoInicial(); const db = mkDb(st);
    await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('start descontó 1', st.sub.proc_usage === 1);

    // Orden real del cliente instalado: start → … → log-execution → end.
    await invocar(LOGEX, db, { scriptName: 'procesarNovedadesCompleto.js', success: true, subsystem: 'proc' });
    check('log-execution SIN executionId NO vuelve a descontar → 1 sola unidad',
        st.sub.proc_usage === 1, `proc_usage=${st.sub.proc_usage}`);
    check('  ... usage_count tampoco', st.sub.usage_count === 1, String(st.sub.usage_count));
    check('  ... la bitácora se escribe igual', st.usage_logs.length === 1);

    await invocar(END, db, { machineId: 'MAQ-A' });
    check('end sin executionId sigue liberando el candado (cliente viejo)', st.locks.length === 0);
}

seccion('7. DOBLE CONTEO — la otra dirección: sin permiso previo, SÍ se cuenta');
{
    // Es el caso de informe/monitor, que hoy no piden permiso. Si esto no contara,
    // los informes serían gratis e ilimitados hasta el release de cliente de E8.
    const st = estadoInicial(); const db = mkDb(st);
    await invocar(LOGEX, db, { scriptName: 'informequickscwpjn.js', success: true, subsystem: 'informe' });
    check('log-execution sin permiso previo SÍ descuenta (informe sigue contando)',
        st.sub.informe_usage === 1, String(st.sub.informe_usage));

    // Y un permiso de OTRO script no debe eximir a este.
    const st2 = estadoInicial(); const db2 = mkDb(st2);
    await invocar(START, db2, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    await invocar(LOGEX, db2, { scriptName: 'informequickscwpjn.js', success: true, subsystem: 'informe' });
    check('un permiso de `proc` no exime al informe de contar',
        st2.sub.informe_usage === 1 && st2.sub.proc_usage === 1,
        `informe=${st2.sub.informe_usage} proc=${st2.sub.proc_usage}`);
}

seccion('8. Cliente MODIFICADO que nunca reporta: el cupo baja igual');
{
    const st = estadoInicial(); const db = mkDb(st);
    for (let i = 0; i < 5; i++) {
        await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
        await invocar(END,   db, { machineId: 'MAQ-A' });
    }
    check('5 permisos sin un solo log-execution → proc_usage = 5',
        st.sub.proc_usage === 5, String(st.sub.proc_usage));
    check('  ... y usage_count = 5', st.sub.usage_count === 5, String(st.sub.usage_count));
    check('  ... y 0 filas de bitácora (el cliente nunca reportó)', st.usage_logs.length === 0);
}

seccion('9. Cupo agotado → 403, sin fila en active_executions, con el shape que el cliente parsea');
{
    const st = estadoInicial({ sub: { proc_usage: 50 } });   // límite del plan = 50
    const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('start con cupo agotado → 403', r.statusCode === 403, String(r.statusCode));
    check('  ... shape: trae `error` (lo que muestra el cliente instalado)',
        typeof (r.body && r.body.error) === 'string' && r.body.error.includes('límite'));
    check('  ... shape: trae `action: upgrade` (igual que el 403 de log-execution)',
        r.body && r.body.action === 'upgrade');
    check('  ... shape: trae `subsystem`', r.body && r.body.subsystem === 'proc');
    check('  ... shape: trae `code` (lo propaga backendClient.startExecution)',
        r.body && r.body.code === 'QUOTA_EXCEEDED');
    check('  ... shape: trae `success:false`', r.body && r.body.success === false);
    check('  ... NO se creó fila en active_executions', st.locks.length === 0);
    check('  ... NO se descontó nada de más', st.sub.proc_usage === 50 && st.sub.usage_count === 0);
}

seccion('10. Bonus: el límite efectivo incluye el bonus (no reintroduce el bug C1)');
{
    const st = estadoInicial({ sub: { proc_usage: 50, proc_bonus: 3 } });
    const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('con bonus 3 y uso 50 sobre límite 50 → permite (50 < 53)', r.statusCode === 200, String(r.statusCode));
    check('  ... descuenta al contador crudo', st.sub.proc_usage === 51);

    const st2 = estadoInicial({ sub: { proc_usage: 53, proc_bonus: 3 } });
    const r2 = await invocar(START, mkDb(st2), { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('agotado el bonus → 403', r2.statusCode === 403, String(r2.statusCode));
}

seccion('11. Trial: el límite real es el GLOBAL, no el del subsistema');
{
    const st = estadoInicial({ sub: { payment_provider: null, usage_limit: 20, usage_count: 20, proc_usage: 3 } });
    const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('trial en 20/20 → 403 aunque proc_usage (3) esté lejos del límite del plan (50)',
        r.statusCode === 403, String(r.statusCode));
    check('  ... con code TRIAL_EXHAUSTED, no QUOTA_EXCEEDED', r.body && r.body.code === 'TRIAL_EXHAUSTED');
    check('  ... sin descontar ni crear candado', st.sub.proc_usage === 3 && st.locks.length === 0);

    const st2 = estadoInicial({ sub: { payment_provider: null, usage_limit: 20, usage_count: 19 } });
    const r2 = await invocar(START, mkDb(st2), { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('trial con 1 uso restante → permite (el gate global no bloquea de más)',
        r2.statusCode === 200, String(r2.statusCode));
    check('  ... y lo consume', st2.sub.usage_count === 20);
}

seccion('12. Candado ajeno (409): el ROLLBACK devuelve el cupo');
{
    // Primero: un rechazo de AUTH-1 tampoco puede consumir cupo.
    const st = estadoInicial(); const db = mkDb(st);
    await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    const usoTrasA = st.sub.proc_usage;
    check('la máquina vinculada tomó el candado y consumió 1', usoTrasA === 1, String(usoTrasA));

    const r = await invocar(START, db, { machineId: 'OTRA', scriptName: 'procesarNovedadesCompleto.js' });
    check('otra máquina → 403 DEVICE_MISMATCH', r.statusCode === 403 && r.body.code === 'DEVICE_MISMATCH',
        `${r.statusCode} ${r.body && r.body.code}`);
    check('  ... y el cupo NO cambió (un permiso no entregado no se cobra)',
        st.sub.proc_usage === usoTrasA, `${st.sub.proc_usage} vs ${usoTrasA}`);
}
{
    // Aislar el 409 puro: mismo usuario, machine_id vinculado NULL, candado de otra máquina.
    const st = estadoInicial({ user: { machine_id: null } });
    st.locks.push({ id: 900, user_id: 1, machine_id: 'OTRA-MAQ', script_name: 'x.js',
                    subsystem: null, quota_counted: true });
    const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('409 DEVICE_LOCKED con candado de otro dispositivo', r.statusCode === 409, String(r.statusCode));
    check('  ... code DEVICE_LOCKED', r.body && r.body.code === 'DEVICE_LOCKED');
    check('  ... ROLLBACK: proc_usage volvió a 0 (no se pierde una unidad)',
        st.sub.proc_usage === 0, `proc_usage=${st.sub.proc_usage}`);
    check('  ... ROLLBACK: usage_count volvió a 0', st.sub.usage_count === 0, String(st.sub.usage_count));
    check('  ... el candado ajeno sigue intacto', st.locks.length === 1 && st.locks[0].machine_id === 'OTRA-MAQ');
}

seccion('13. Suscripción no vigente → 403 sin ejecutar');
{
    const st = estadoInicial({ sub: { expirada: true } }); const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    check('start con suscripción vencida → 403', r.statusCode === 403, String(r.statusCode));
    check('  ... code NO_SUBSCRIPTION', r.body && r.body.code === 'NO_SUBSCRIPTION');
    check('  ... sin candado', st.locks.length === 0);
}

seccion('14. Scripts sin subsistema: solo contador global (no cambia el producto)');
{
    const st = estadoInicial(); const db = mkDb(st);
    const r = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'listarSCWPJN.js' });
    check('listarSCWPJN.js obtiene permiso (no rompe "Listado de expedientes")', r.statusCode === 200);
    check('  ... subsistema null (sigue siendo gratis, como hoy)', r.body.subsystem === null);
    check('  ... sube usage_count', st.sub.usage_count === 1);
    check('  ... NO toca proc_usage', st.sub.proc_usage === 0);
}

seccion('15. El mapa del servidor reproduce el del cliente (los 13 distribuibles)');
{
    const subs = require(path.join(ROOT, 'utils/subsystems.js'));
    const clienteSrc = rd('../electron-app/src/auth/authManager.js');
    const i = clienteSrc.indexOf('function getSubsystemForScript(');
    const cuerpo = clienteSrc.slice(i, clienteSrc.indexOf('\n}', i));
    // Reimplementación literal de la función del cliente, para comparar sin adivinar.
    const delCliente = (s) => {
        const n = (s || '').toLowerCase();
        if (n.includes('procesarcustomexpedientes')) return 'batch';
        if (n.includes('testm1') || n.includes('procesarnovedades') ||
            n.includes('listarsscwpjn') || n.includes('consultarscwpjn')) return 'proc';
        if (n.includes('informe') || n.includes('quickscwpjn')) return 'informe';
        return null;
    };
    check('la reimplementación coincide con el fuente del cliente (errata `listarsscwpjn` incluida)',
        cuerpo.includes("'listarsscwpjn'") && cuerpo.includes("'procesarcustomexpedientes'"));

    const distribuibles = (rd('routes/client.js').match(/SCRIPTS_DISTRIBUIBLES = new Set\(\[([\s\S]*?)\]\)/) || [, ''])[1]
        .match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    check('la whitelist tiene 13 scripts', distribuibles.length === 13, String(distribuibles.length));
    let iguales = 0, distintos = [];
    for (const s of distribuibles) {
        check(`  ${s} está en el mapa del servidor`, subs.isKnownScript(s));
        if (subs.subsystemForScript(s) === delCliente(s)) iguales++;
        else distintos.push(`${s}: servidor=${subs.subsystemForScript(s)} cliente=${delCliente(s)}`);
    }
    check('el subsistema coincide con el del cliente en los 13 (cero cambio de contador)',
        iguales === distribuibles.length, distintos.join(' | '));
    check('un script de operación del servidor NO está en el mapa', !subs.isKnownScript('backup-db.js'));
}

seccion('16. /monitor/log — misma regla, y el monitoreo sigue contando hoy');
{
    const st = estadoInicial(); const db = mkDb(st);
    await invocar(MONLOG, db, { parte_id: 55, modo: 'novedades' });
    check('sin permiso previo (situación de hoy) SÍ cuenta', st.sub.monitor_novedades_usage === 1,
        String(st.sub.monitor_novedades_usage));

    await invocar(MONLOG, db, { parte_id: 55, modo: 'inicial' });
    check('la consulta inicial NO cuenta (no regresión)', st.sub.monitor_novedades_usage === 1);

    await invocar(MONLOG, db, { parte_id: 55, modo: 'novedades', error: 'x' });
    check('una consulta con error NO cuenta (no regresión)', st.sub.monitor_novedades_usage === 1);

    // Un permiso de `procesarMonitoreo.js` NO exime de contar: hoy ese script resuelve
    // a subsistema null, así que `start` no cobró monitor_novedades. Si esto no contara,
    // el monitoreo quedaría gratis en cuanto E8 lo haga pasar por `start`.
    const st2 = estadoInicial(); const db2 = mkDb(st2);
    await invocar(START, db2, { machineId: 'MAQ-A', scriptName: 'procesarMonitoreo.js' });
    check('start de procesarMonitoreo.js NO cobra monitor_novedades (subsistema null)',
        st2.sub.monitor_novedades_usage === 0, String(st2.sub.monitor_novedades_usage));
    await invocar(MONLOG, db2, { parte_id: 55, modo: 'novedades' });
    check('  ... por eso /monitor/log SÍ cuenta igual (el monitoreo no queda gratis)',
        st2.sub.monitor_novedades_usage === 1, String(st2.sub.monitor_novedades_usage));

    // El día que un permiso SÍ cobre monitor_novedades, /monitor/log deja de contar solo.
    const st2b = estadoInicial();
    st2b.locks.push({ id: 950, user_id: 1, machine_id: 'MAQ-A', script_name: 'procesarMonitoreo.js',
                      subsystem: 'monitor_novedades', quota_counted: true });
    st2b.sub.monitor_novedades_usage = 1;
    await invocar(MONLOG, mkDb(st2b), { parte_id: 55, modo: 'novedades' });
    check('con un permiso que SÍ cobró monitor_novedades, /monitor/log no vuelve a contar',
        st2b.sub.monitor_novedades_usage === 1, String(st2b.sub.monitor_novedades_usage));

    // Guarda de límite nueva
    const st3 = estadoInicial({ sub: { monitor_novedades_usage: 50 } });
    await invocar(MONLOG, mkDb(st3), { parte_id: 55, modo: 'novedades' });
    check('en el límite, /monitor/log ya no incrementa (guarda nueva de E7)',
        st3.sub.monitor_novedades_usage === 50, String(st3.sub.monitor_novedades_usage));

    // plan_id NULL: sin límite, tiene que seguir contando (regresión que casi introduce un JOIN)
    const st4 = estadoInicial({ sub: { plan_id: null, monitor_novedades_usage: 7 } });
    await invocar(MONLOG, mkDb(st4), { parte_id: 55, modo: 'novedades' });
    check('con plan_id NULL sigue contando (sin regresión por el JOIN)',
        st4.sub.monitor_novedades_usage === 8, String(st4.sub.monitor_novedades_usage));

    check('IDOR de /monitor/log sigue validado (parte ajena → parte_id NULL)',
        rd('routes/monitor.js').includes('SELECT 1 FROM monitor_partes WHERE id = $1 AND user_id = $2'));
}

seccion('17. Ejecución fallida: se cobró igual en start (sin reembolso)');
{
    const st = estadoInicial(); const db = mkDb(st);
    const s = await invocar(START, db, { machineId: 'MAQ-A', scriptName: 'procesarNovedadesCompleto.js' });
    await invocar(LOGEX, db, { scriptName: 'procesarNovedadesCompleto.js', success: false,
                               errorMessage: 'falló', executionId: s.body.executionId });
    check('el permiso ya cobrado no se devuelve al reportar success:false', st.sub.proc_usage === 1);
    await invocar(END, db, { machineId: 'MAQ-A', executionId: s.body.executionId, outcome: 'error' });
    check('end con outcome=error tampoco reembolsa', st.sub.proc_usage === 1);
}

seccion('18. Migración: idempotente, aditiva y en la carpeta viva');
{
    const rel = 'database/migrations/20260903_execution_quota_at_start.sql';
    const p = path.join(ROOT, '..', rel);
    check('existe en database/migrations/ de la RAÍZ (no en backend-server/)', fs.existsSync(p));
    check('NO se creó en backend-server/database/migrations/',
        !fs.existsSync(path.join(ROOT, 'database/migrations/20260903_execution_quota_at_start.sql')));
    const sqlRaw = fs.readFileSync(p, 'utf8');
    // Los comentarios del encabezado nombran "ADD COLUMN" en prosa: se descartan
    // antes de contar, si no el conteo mezcla documentación con sentencias.
    const sql  = sqlRaw.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    const adds = sql.match(/ADD COLUMN/g) || [];
    const ifn  = sql.match(/ADD COLUMN IF NOT EXISTS/g) || [];
    check('todos los ADD COLUMN llevan IF NOT EXISTS (idempotente)',
        adds.length === ifn.length && adds.length === 4, `${ifn.length}/${adds.length}`);
    check('el índice también es IF NOT EXISTS', /CREATE INDEX IF NOT EXISTS/.test(sql));
    check('crea las 3 columnas de active_executions',
        /subsystem/.test(sql) && /quota_counted/.test(sql) && /outcome/.test(sql));
    check('crea usage_logs.execution_id', /usage_logs[\s\S]*execution_id/.test(sql));
    check('quota_counted nace en false (filas vivas del deploy no quedan marcadas)',
        /quota_counted BOOLEAN NOT NULL DEFAULT false/.test(sql));
    check('subsystem SIN NOT NULL (no rompe filas vivas durante el deploy)',
        !/subsystem\s+VARCHAR\(30\)\s+NOT NULL/.test(sql));
    check('ADITIVA: no hay DROP/ALTER COLUMN/UPDATE/DELETE',
        !/\bDROP\b|\bALTER COLUMN\b|^\s*UPDATE\s|^\s*DELETE\s/im.test(sql));
    check('sigue la convención de nombre YYYYMMDD_descripcion.sql',
        /^\d{8}_[a-z0-9_]+\.sql$/.test(path.basename(p)));

    // Validación estructural del SQL. No reemplaza a correrlo contra PostgreSQL
    // (paso 0 del criterio de staging): esta máquina no tiene credenciales de la
    // instancia local y no corresponde adivinarlas. Cubre lo que sí se puede ver
    // sin motor: paréntesis balanceados, toda sentencia terminada en `;` y ningún
    // verbo fuera de los cuatro permitidos para una migración aditiva.
    const sinCadenas = sql.replace(/'[^']*'/g, "''");
    let prof = 0, negativo = false;
    for (const c of sinCadenas) {
        if (c === '(') prof++;
        else if (c === ')') { prof--; if (prof < 0) negativo = true; }
    }
    check('paréntesis balanceados', prof === 0 && !negativo, `profundidad final=${prof}`);
    const sents = sinCadenas.split(';').map(s => s.trim()).filter(Boolean);
    check('no queda una sentencia sin `;` al final', /;\s*$/.test(sql.trim()));
    const verbos = sents.map(s => s.split(/\s+/).slice(0, 2).join(' ').toUpperCase());
    const permitidos = ['ALTER TABLE', 'CREATE INDEX', 'COMMENT ON'];
    const raros = verbos.filter(v => !permitidos.some(x => v.startsWith(x)));
    check('todas las sentencias son ALTER TABLE / CREATE INDEX / COMMENT ON',
        raros.length === 0, raros.join(' | '));
    check('cantidad de sentencias esperada (2 ALTER + 1 INDEX + 4 COMMENT)',
        sents.length === 7, String(sents.length));
}

seccion('19. No-regresión de forma en los endpoints tocados');
{
    const st = estadoInicial(); const db = mkDb(st);
    const r = await invocar(LOGEX, db, { scriptName: 'procesarNovedadesCompleto.js', success: true, subsystem: 'proc' });
    check('log-execution sigue devolviendo usageCount/usageLimit/remaining/subsystemUsage',
        r.body && 'usageCount' in r.body && 'usageLimit' in r.body &&
        'remaining' in r.body && 'subsystemUsage' in r.body, JSON.stringify(r.body));

    const rBad = await invocar(LOGEX, mkDb(estadoInicial()), { scriptName: '../../etc/passwd', success: true });
    check('log-execution sigue rechazando scriptName inválido (H-FE-01)', rBad.statusCode === 400);
    const rBad2 = await invocar(LOGEX, mkDb(estadoInicial()), { scriptName: 'testM2.js', success: true, subsystem: 'inventado' });
    check('log-execution sigue rechazando subsystem inválido', rBad2.statusCode === 400);

    const stH = estadoInicial();
    stH.locks.push({ id: 901, user_id: 1, machine_id: 'MAQ-A', script_name: 'x', subsystem: null, quota_counted: true });
    const HB = handlerFinal(licenseRouter, 'post', '/execution/heartbeat');
    const rh = await invocar(HB, mkDb(stH), { machineId: 'MAQ-A' });
    check('heartbeat sin cambios (200 con candado propio)', rh.statusCode === 200, String(rh.statusCode));
    const rh2 = await invocar(HB, mkDb(estadoInicial()), { machineId: 'MAQ-A' });
    check('heartbeat sin candado sigue dando 404', rh2.statusCode === 404, String(rh2.statusCode));
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(78)}`);
console.log(`RESULTADO: ${ok} OK, ${fail} FALLA   (total ${ok + fail})`);
console.log('='.repeat(78));

console.log(`
LO QUE ESTE HARNESS NO PUEDE PROBAR — va en staging, con la migración aplicada:

  0) Aplicar la migración (idempotente):
     ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \\
       "sudo -u postgres psql -d procurador_db_staging \\
          -f /var/www/procurador-staging/database/migrations/20260903_execution_quota_at_start.sql"
     ssh ... "sudo -u postgres psql -d procurador_db_staging -c '\\\\d active_executions'"
     # esperar: subsystem, quota_counted (NOT NULL DEFAULT false), outcome
     ssh ... "sudo -u postgres psql -d procurador_db_staging -c '\\\\d usage_logs'"   # execution_id

  1) Cliente MODIFICADO (nunca reporta): N permisos, N unidades.
     for i in 1 2 3; do
       curl -sk -X POST https://localhost:3444/license/execution/start \\
         -H "Authorization: Bearer \$TOKEN" -H 'Content-Type: application/json' \\
         -d '{"machineId":"MAQ-TEST","scriptName":"procesarNovedadesCompleto.js"}'; echo
       curl -sk -X POST https://localhost:3444/license/execution/end \\
         -H "Authorization: Bearer \$TOKEN" -H 'Content-Type: application/json' \\
         -d '{"machineId":"MAQ-TEST"}' >/dev/null
     done
     sudo -u postgres psql -d procurador_db_staging \\
       -c "SELECT proc_usage, usage_count FROM subscriptions WHERE user_id=<ID>;"
     # esperar: proc_usage +3

  2) CLIENTE VIEJO — el caso crítico de la transición (una sola unidad):
     start (guardar proc_usage antes) → esperar 30 s → log-execution SIN executionId:
     curl -sk -X POST https://localhost:3444/client/scripts/log-execution \\
       -H "Authorization: Bearer \$TOKEN" -H 'Content-Type: application/json' \\
       -d '{"scriptName":"procesarNovedadesCompleto.js","success":true,"subsystem":"proc"}'
     # esperar: proc_usage +1 en total, NO +2

  3) Cliente NUEVO: start → log-execution CON el executionId devuelto → +1, no +2.

  4) start con script fuera del mapa → 400, y active_executions sin fila nueva:
     -d '{"machineId":"MAQ-TEST","scriptName":"backup-db.js"}'
     sudo -u postgres psql -d procurador_db_staging -c "SELECT count(*) FROM active_executions WHERE user_id=<ID>;"

  5) Cupo agotado → 403 y sin fila en active_executions:
     UPDATE subscriptions SET proc_usage = <limite del plan> WHERE user_id=<ID>;  → start → 403

  6) Trial (payment_provider NULL, usage_count = usage_limit) → 403 TRIAL_EXHAUSTED.

  7) Carrera real del UPDATE (lo que el pool falso no puede emular): dejar 1 unidad
     y lanzar 6 start simultáneos con el MISMO machineId:
     UPDATE subscriptions SET proc_usage = <limite>-1 WHERE user_id=<ID>;
     seq 6 | xargs -P6 -I{} curl -sk -X POST https://localhost:3444/license/execution/start \\
       -H "Authorization: Bearer \$TOKEN" -H 'Content-Type: application/json' \\
       -d '{"machineId":"MAQ-TEST","scriptName":"procesarNovedadesCompleto.js"}'
     # esperar: exactamente UN 200; el resto 403. proc_usage = <limite>, nunca por encima.

  8) Un flujo real desde la app instalada (Procurar) → 1 unidad, y el log del server
     sin '[License] Error adquiriendo lock'.
`);

process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error('\nHARNESS ROTO:', e); process.exit(2); });
