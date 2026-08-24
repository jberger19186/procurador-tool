// dev-tools/stub-portal.js — Servidor mínimo para verificar el portal de usuarios
// (public/usuarios/) en un navegador real, SIN backend ni DB reales.
//
// Sirve los archivos REALES del repo (index.html/app.js/app.css tal como están en
// el working tree, no una copia) y falsea la API con un almacén EN MEMORIA para
// Bitácora + Mis Expedientes + Feriados + Sugerencias (F3.3) — lo suficiente para
// ejercitar CRUD real (crear, editar, marcar hecho, deshacer, borrar, exportar,
// preview de importación) sin depender de staging. No usar para probar el
// BACKEND real (gates de plan, IDOR, etc.) — eso es el bloque V3 del plan
// (docs/internal/plan-verificacion-runtime-2026-08-23.md), que va contra
// staging por HTTP real.
//
// Uso: node backend-server/dev-tools/stub-portal.js [puerto]
//   → abrir http://localhost:<puerto>/usuarios/ (cualquier email/password entra)
//
// Ver .claude/skills/verify/SKILL.md para el recetario completo (por qué usar
// Playwright y no el Browser pane para teclado/capturas, etc).
//
// El estado vive solo en memoria — se pierde al reiniciar el proceso. Se
// reinicia con datos de seed (1 ficha + 1 entrada + 1 snapshot + 1 sugerencia +
// 1 feriado) para no arrancar cada verificación desde una pantalla vacía.

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORTAL_DIR = path.join(PUBLIC_DIR, 'usuarios');
const PORT = parseInt(process.argv[2], 10) || 5188;

// ─── Cuenta fija devuelta por /client/account ──────────────────────────────
const ACCOUNT = {
    success: true,
    account: {
        email: 'verify@test.local',
        nombre: 'Test',
        apellido: 'Verify',
        cuit: '27320694359',
        plan: 'COMBO_PROMO',
        planDisplayName: 'Combo Beta',
        status: 'active',
        registrationStatus: 'active',
        emailVerified: true,
        paymentProvider: 'mercadopago',
        bitacoraEnabled: true,
        homeSection: 'plan',
        usage: { count: 3, limit: 999999 },
        subsystems: {},
        expiresAt: '2027-01-01T00:00:00.000Z',
    },
};

// ─── Almacén en memoria ─────────────────────────────────────────────────────
let nextExpId = 2;
let nextBitId = 2;
let nextSugId = 2;

const EXPEDIENTES = [
    {
        id: 1, expediente: 'FCR 18745/2017', jurisdiccion: 'Justicia Federal de Comodoro Rivadavia',
        dependencia: 'Juzgado Federal 2', caratula: 'PEREZ c/ GOMEZ s/ DAÑOS Y PERJUICIOS',
        situacion_actual: 'EN DESPACHO', situacion_fecha: '2026-08-10T12:00:00.000Z', notas: 'Caso de seed para V1a.',
        updated_at: '2026-08-20T12:00:00.000Z',
        snapshots: [
            { id: 1, kind: 'procuracion', run_date: '2026-08-15T12:00:00.000Z', situacion: 'EN DESPACHO',
              data: { movimientos: [{ fecha: '14/08/2026', tipo: 'DESPACHO', detalle: 'Pasan los autos a resolver.' }] } },
        ],
    },
];

// Toda entrada de Bitácora tiene `due_at` (el campo es `required` en el form).
const BITACORA = [
    {
        id: 1, kind: 'vencimiento', title: 'Contestar demanda — caso de seed',
        description: 'Entrada de seed para V1a.', expediente_id: 1,
        due_at: '2026-08-22T12:00:00.000Z',   // vencida sin confirmar → alimenta el banner de avisos
        done_at: null,
    },
];

// Feriado de seed para el probe "plazo que cruza un feriado": desde el
// 2026-08-24 (lunes) + 3 días hábiles da 27/08 sin feriado; con el feriado del
// 26/08 seedeado acá, el resultado correcto pasa a ser 28/08.
const FERIADOS = { 2026: [{ fecha: '2026-08-26' }] };

const SUGERENCIAS = [
    { id: 1, expediente: 'FCR 99999/2026', caratula: 'DEMO c/ TEST s/ VERIFY',
      dependencia: 'Juzgado Federal 1', situacion: 'EN TRAMITE', nombre_parte: 'DEMO PARTE SA' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.png':  'image/png',
};

function json(res, obj, code = 200) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

function serveFile(res, file) {
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
    });
    res.end(fs.readFileSync(file));
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

async function readJsonBody(req) {
    const buf = await readBody(req);
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch { return {}; }
}

// Parser de multipart mínimo — solo extrae campos de TEXTO simples (sin
// buscar el archivo en sí). Alcanza para reflejar `modo`/`dry_run` en la
// respuesta de /usuarios/api/bitacora/import sin escribir un parser real.
function parseMultipartField(buf, fieldName) {
    const str = buf.toString('latin1');
    const re = new RegExp(`name="${fieldName}"\\r\\n\\r\\n([^\\r\\n]*)\\r\\n`);
    const m = str.match(re);
    return m ? m[1] : null;
}

function expedienteById(id) { return EXPEDIENTES.find((x) => x.id === Number(id)); }

function conVencidas(x) {
    const vencidas = BITACORA.filter((e) => e.expediente_id === x.id && !e.done_at &&
        e.due_at && new Date(e.due_at) < new Date()).length;
    return { ...x, vencidas };
}

function conNombreExpediente(e) {
    const x = e.expediente_id ? expedienteById(e.expediente_id) : null;
    return { ...e, expediente: x ? x.expediente : null };
}

// ─── Servidor ───────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const q = u.searchParams;
    console.log(req.method, p);

    try {
        // ── Auth ──
        if (req.method === 'POST' && p === '/auth/portal-login') {
            await readBody(req);
            return json(res, { success: true, token: 'STUB.TOKEN.' + Date.now() });
        }

        // ── Cuenta / notificaciones / planes ──
        if (p === '/client/account')                    return json(res, ACCOUNT);
        if (p === '/client/notifications')               return json(res, { success: true, notifications: [], unread: 0 });
        if (p === '/usuarios/api/plans')                 return json(res, { success: true, plans: [] });
        if (p === '/usuarios/api/subscription/current')  return json(res, { success: true, subscription: {} });
        if (p.startsWith('/monitor/') || p.startsWith('/tickets'))
            return json(res, { success: true, data: [], partes: [], tickets: [] });

        // ── Feriados ──
        if (p === '/usuarios/api/feriados') {
            const year = parseInt(q.get('year'), 10);
            return json(res, { success: true, feriados: FERIADOS[year] || [] });
        }

        // ── Bitácora: avisos ──
        if (p === '/usuarios/api/bitacora/avisos') {
            const ahora = new Date();
            const en7dias = new Date(ahora.getTime() + 7 * 86400000);
            const pendientes = BITACORA.filter((e) => !e.done_at && e.due_at);
            const vencidos = pendientes.filter((e) => new Date(e.due_at) < ahora).map(conNombreExpediente);
            const proximos = pendientes.filter((e) => {
                const d = new Date(e.due_at);
                return d >= ahora && d <= en7dias;
            }).map(conNombreExpediente);
            return json(res, { success: true, vencidos, proximos, totalVencidosSinConfirmar: vencidos.length });
        }

        // ── Bitácora: exportar (usada por el botón "⬇ Exportar" y por el
        //    respaldo automático previo a confirmar una importación) ──
        if (p === '/usuarios/api/bitacora/export') {
            const alcance = q.get('alcance'), formato = q.get('formato');
            const payload = { alcance, formato, exportado_el: new Date().toISOString(),
                expedientes: EXPEDIENTES, entradas: BITACORA };
            res.writeHead(200, {
                'Content-Type': formato === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json',
                'Content-Disposition': `attachment; filename="stub-export.${formato === 'xlsx' ? 'xlsx' : 'json'}"`,
            });
            return res.end(formato === 'xlsx' ? Buffer.from('stub-xlsx') : JSON.stringify(payload));
        }

        // ── Bitácora: import (dry_run — NUNCA implementar el modo=reemplazar
        //    de verdad acá; el plan prohíbe confirmarlo, así que ni hace falta) ──
        if (req.method === 'POST' && p === '/usuarios/api/bitacora/import') {
            const buf = await readBody(req);
            const modo = parseMultipartField(buf, 'modo') || 'combinar';
            const dryRun = parseMultipartField(buf, 'dry_run');
            const preview = modo === 'reemplazar'
                ? { contenido: { expedientes: 1, entradas: 1 }, eliminar: { expedientes: EXPEDIENTES.length, entradas: BITACORA.length }, crear: { expedientes: 1, entradas: 1 } }
                : { contenido: { expedientes: 1, entradas: 1 }, crear: { expedientes: 0, entradas: 0 }, sobrescribir: { expedientes: 1, entradas: 1 }, conservar: { expedientes: Math.max(0, EXPEDIENTES.length - 1), entradas: Math.max(0, BITACORA.length - 1) } };
            if (dryRun) return json(res, { success: true, modo, exportado_el: new Date().toISOString(), preview });
            // Confirmación real: no debería llegar acá en una verificación (el
            // plan prohíbe confirmar reemplazar) — devuelve algo inocuo si igual llega.
            return json(res, { success: true, resumen: { expedientesCreados: 0, expedientesActualizados: 0, entradasCreadas: 0, entradasActualizadas: 0 } });
        }

        // ── Bitácora: marcar hecho/pendiente (Ctrl+Z re-llama esto invertido) ──
        {
            const m = p.match(/^\/usuarios\/api\/bitacora\/(\d+)\/done$/);
            if (req.method === 'POST' && m) {
                const entry = BITACORA.find((e) => e.id === Number(m[1]));
                const body = await readJsonBody(req);
                if (entry) entry.done_at = body.done ? new Date().toISOString() : null;
                return json(res, { success: true, entrada: entry || null });
            }
        }

        // ── Bitácora: CRUD de entradas ──
        if (p === '/usuarios/api/bitacora') {
            if (req.method === 'GET') {
                const desde = q.get('desde'), hasta = q.get('hasta');
                const kind = q.get('kind'), expedienteId = q.get('expediente_id');
                const soloPendientes = q.get('pendientes') === '1';
                let rows = BITACORA.slice();
                if (desde) rows = rows.filter((e) => new Date(e.due_at) >= new Date(desde));
                if (hasta) rows = rows.filter((e) => new Date(e.due_at) <= new Date(hasta));
                if (kind) rows = rows.filter((e) => e.kind === kind);
                if (expedienteId) rows = rows.filter((e) => String(e.expediente_id) === expedienteId);
                if (soloPendientes) rows = rows.filter((e) => !e.done_at);
                return json(res, { success: true, entradas: rows.map(conNombreExpediente) });
            }
            if (req.method === 'POST') {
                const body = await readJsonBody(req);
                const entry = { id: nextBitId++, done_at: null, ...body };
                BITACORA.push(entry);
                return json(res, { success: true, entrada: entry });
            }
        }
        {
            const m = p.match(/^\/usuarios\/api\/bitacora\/(\d+)$/);
            if (m) {
                const id = Number(m[1]);
                if (req.method === 'PUT') {
                    const body = await readJsonBody(req);
                    const entry = BITACORA.find((e) => e.id === id);
                    if (!entry) return json(res, { success: false, error: 'No encontrada' }, 404);
                    Object.assign(entry, body);
                    return json(res, { success: true, entrada: entry });
                }
                if (req.method === 'DELETE') {
                    const idx = BITACORA.findIndex((e) => e.id === id);
                    if (idx >= 0) BITACORA.splice(idx, 1);
                    return json(res, { success: true });
                }
            }
        }

        // ── Sugerencias (F3.3) ──
        if (p === '/usuarios/api/sugerencias' && req.method === 'GET')
            return json(res, { success: true, sugerencias: SUGERENCIAS });
        {
            const m = p.match(/^\/usuarios\/api\/sugerencias\/(\d+)\/(aceptar|descartar)$/);
            if (req.method === 'POST' && m) {
                const id = Number(m[1]), accion = m[2];
                const idx = SUGERENCIAS.findIndex((s) => s.id === id);
                const sug = idx >= 0 ? SUGERENCIAS[idx] : null;
                if (idx >= 0) SUGERENCIAS.splice(idx, 1);
                if (accion === 'descartar' || !sug) return json(res, { success: true });
                const body = await readJsonBody(req);
                const nuevaFicha = { id: nextExpId++, expediente: sug.expediente, jurisdiccion: null,
                    dependencia: sug.dependencia, caratula: sug.caratula, situacion_actual: sug.situacion,
                    situacion_fecha: null, notas: null, updated_at: new Date().toISOString(), snapshots: [] };
                EXPEDIENTES.push(nuevaFicha);
                let entradaId = null;
                if (body.conEntrada) {
                    const tarea = { id: nextBitId++, kind: 'tarea', title: `Revisar caso nuevo: ${sug.expediente}`,
                        description: null, expediente_id: nuevaFicha.id, due_at: new Date().toISOString(), done_at: null };
                    BITACORA.push(tarea);
                    entradaId = tarea.id;
                }
                return json(res, { success: true, expediente_id: nuevaFicha.id, entrada_id: entradaId });
            }
        }
        if (p === '/usuarios/api/sugerencias/descartar-todas' && req.method === 'POST') {
            SUGERENCIAS.length = 0;
            return json(res, { success: true });
        }

        // ── Expedientes (Mis Expedientes) ──
        if (p === '/usuarios/api/expedientes') {
            if (req.method === 'GET') return json(res, { success: true, expedientes: EXPEDIENTES.map(conVencidas) });
            if (req.method === 'POST') {
                const body = await readJsonBody(req);
                const existente = EXPEDIENTES.find((x) => x.expediente.trim().toLowerCase() === body.expediente.trim().toLowerCase());
                if (existente) { Object.assign(existente, body); return json(res, { success: true, expediente: existente, creado: false }); }
                const nuevo = { id: nextExpId++, updated_at: new Date().toISOString(), snapshots: [], ...body };
                EXPEDIENTES.push(nuevo);
                return json(res, { success: true, expediente: nuevo, creado: true });
            }
        }
        {
            const m = p.match(/^\/usuarios\/api\/expedientes\/(\d+)\/snapshots\/(\d+)$/);
            if (m) {
                const x = expedienteById(m[1]);
                const snap = x && x.snapshots.find((s) => s.id === Number(m[2]));
                if (!snap) return json(res, { success: false, error: 'No encontrado' }, 404);
                return json(res, { success: true, snapshot: snap });
            }
        }
        {
            const m = p.match(/^\/usuarios\/api\/expedientes\/(\d+)$/);
            if (m) {
                const id = Number(m[1]);
                if (req.method === 'GET') {
                    const x = expedienteById(id);
                    if (!x) return json(res, { success: false, error: 'No encontrado' }, 404);
                    return json(res, { success: true, expediente: x, entradas: BITACORA.filter((e) => e.expediente_id === id), snapshots: x.snapshots });
                }
                if (req.method === 'PUT') {
                    const x = expedienteById(id);
                    if (!x) return json(res, { success: false, error: 'No encontrado' }, 404);
                    const body = await readJsonBody(req);
                    Object.assign(x, body, { updated_at: new Date().toISOString() });
                    return json(res, { success: true, expediente: x, creado: false });
                }
                if (req.method === 'DELETE') {
                    const modo = q.get('entries'); // 'keep' | 'delete'
                    const idx = EXPEDIENTES.findIndex((x) => x.id === id);
                    if (idx >= 0) EXPEDIENTES.splice(idx, 1);
                    let entradasBorradas = 0;
                    if (modo === 'delete') {
                        for (let i = BITACORA.length - 1; i >= 0; i--) {
                            if (BITACORA[i].expediente_id === id) { BITACORA.splice(i, 1); entradasBorradas++; }
                        }
                    } else {
                        BITACORA.forEach((e) => { if (e.expediente_id === id) e.expediente_id = null; });
                    }
                    return json(res, { success: true, entradasBorradas });
                }
            }
        }

        // ── Catch-all: cualquier otro POST/PUT/DELETE dentro de /usuarios/api
        //    o /client responde 200 genérico ──
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
            await readBody(req);
            return json(res, { success: true });
        }
        if (p.startsWith('/usuarios/api/') || p.startsWith('/client/'))
            return json(res, { success: true, data: [], entradas: [], expedientes: [], avisos: [], sugerencias: [] });

        // ── Estáticos ──
        if (p === '/assets/brand-icon.png') return serveFile(res, path.join(PUBLIC_DIR, 'assets', 'brand-icon.png'));

        if (p === '/' || p === '/usuarios/' || p === '/usuarios')
            return serveFile(res, path.join(PORTAL_DIR, 'index.html'));

        return serveFile(res, path.join(PORTAL_DIR, path.basename(p)));
    } catch (e) {
        console.error('stub-portal error:', e);
        return json(res, { success: false, error: String(e) }, 500);
    }
}).listen(PORT, () => console.log(`stub-portal en http://localhost:${PORT}/usuarios/`));
