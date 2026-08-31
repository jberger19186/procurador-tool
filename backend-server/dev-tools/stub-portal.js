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
// Normalización canónica del backend real, no una reimplementación: si el stub
// dedupe distinto que producción, el bloque de verificación pasa en verde por una
// razón equivocada.
const { expedienteKey, esExpedienteValido } = require('../utils/expedienteKey');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORTAL_DIR = path.join(PUBLIC_DIR, 'usuarios');
const PORT = parseInt(process.argv[2], 10) || 5188;

// ─── Cuenta devuelta por /client/account — MUTABLE ─────────────────────────
// A diferencia de V1a (una cuenta fija alcanzaba), V1b necesita probar varios
// estados de cuenta (trial sin activar, suspendida, en gracia, etc.) sin
// reiniciar el proceso. `POST /debug/account` mergea un patch acá — es un
// endpoint de SOLO este stub, no existe en el backend real.
const ACCOUNT_STATE = {
    email: 'verify@test.local',
    nombre: 'Test',
    apellido: 'Verify',
    cuit: '27320694359',
    telefono: '',
    domicilio: {},
    plan: { name: 'COMBO_PROMO', displayName: 'Combo Beta' },
    planType: 'combo',
    status: 'active',
    registrationStatus: 'active',
    emailVerified: true,
    paymentProvider: 'mercadopago',
    bitacoraEnabled: true,
    homeSection: 'plan',
    usageLimit: 999999,
    usageCount: 3,
    courtesyExtras: 0,
    period: { daysRemaining: 18 },
    usage: {
        proc:              { used: 12, limit: 50, unlimited: false },
        batch:             { used: 2,  limit: 20, unlimited: false },
        informe:           { used: 5,  limit: 50, unlimited: false },
        monitor_novedades: { used: 3,  limit: 50, unlimited: false },
        monitor_partes:    { used: 2,  limit: 20, unlimited: false },
    },
    subsystems: {},
    expiresAt: '2027-01-01T00:00:00.000Z',
    planExpiryDate: null,
    nextBillingDate: '2026-09-20T00:00:00.000Z',
    cancelAt: null,
    planChangesThisCycle: 0,
    // Campos de la sección Reactivación (solo relevantes con registrationStatus='suspended_admin')
    suspensionReason: null,
    suspendedAt: null,
    reactivationRequest: null,
};

// ─── Planes (para el modal "Ver planes disponibles") ───────────────────────
const PLANS = [
    { name: 'COMBO_PROMO', displayName: 'Combo Beta', priceArs: 15000, active: true },
    { name: 'EXTENSION_PROMO', displayName: 'Extensión', priceArs: 1500, active: true },
];

// ─── Tickets ────────────────────────────────────────────────────────────────
let nextTicketId = 2;
let nextCommentId = 2;
const TICKETS = [
    { id: 1, title: 'Ticket de seed para V1b', category: 'technical', status: 'open',
      description: 'Descripción de seed, para probar el detalle y los comentarios.',
      created_at: '2026-08-20T12:00:00.000Z',
      comments: [
          { id: 1, author_role: 'user', message: 'Mensaje inicial del usuario.', created_at: '2026-08-20T12:00:00.000Z' },
      ] },
];

// ─── Notificaciones ─────────────────────────────────────────────────────────
const NOTIFICATIONS = [
    { id: 1, title: 'Notificación de seed (no leída)', message: 'Mensaje de prueba para V1b.', type: 'info',
      created_at: '2026-08-23T12:00:00.000Z', read_at: null },
    { id: 2, title: 'Notificación de seed (ya leída)', message: 'Esta ya estaba leída.', type: 'success',
      created_at: '2026-08-20T12:00:00.000Z', read_at: '2026-08-21T09:00:00.000Z' },
];

// ─── Pagos / facturas ───────────────────────────────────────────────────────
const PAYMENTS = [
    { id: 1, amount: 15000, status: 'approved', created_at: '2026-08-01T12:00:00.000Z', payment_method: 'mercadopago' },
];
const INVOICES = [
    { id: 1, amount: 15000, status: 'emitida', issued_at: '2026-08-02T12:00:00.000Z', pdf_url: null },
    // F2 (2026-08-31): fixture de una factura de $0 real (plan de cortesía) —
    // para verificar que ya no se muestra como "—" (ver el fix en app.js).
    { id: 2, amount: 0, invoice_type: 'C', numero: '0001-00000002', status: 'emitida', issued_at: '2026-08-15T12:00:00.000Z', pdf_url: null },
];

// ─── Monitor de partes ──────────────────────────────────────────────────────
let nextParteId = 3;
const PARTES = [
    { id: 1, nombre_parte: 'DON COCHO', jurisdiccion_sigla: 'FCR' },
    { id: 2, nombre_parte: 'LA TOSTADORA MODERNA', jurisdiccion_sigla: 'FCR' },
];

// ─── Almacén en memoria ─────────────────────────────────────────────────────
let nextExpId = 4;
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
    // Los 2 de acá abajo son solo para probar multi-selección (Mis Expedientes,
    // Bloque A) — sin snapshots ni entradas, no hacía falta más para ese caso.
    {
        id: 2, expediente: 'CAF 018685/2024', jurisdiccion: 'Cámara Federal',
        dependencia: 'Sala II', caratula: 'RODRIGUEZ c/ ANSES s/ REAJUSTES',
        situacion_actual: 'A DESPACHO', situacion_fecha: null, notas: null,
        updated_at: '2026-08-18T12:00:00.000Z', snapshots: [],
    },
    {
        id: 3, expediente: 'FCR 118745/2017', jurisdiccion: 'Justicia Federal de Comodoro Rivadavia',
        dependencia: 'Juzgado Federal 1', caratula: 'LOPEZ c/ MARTINEZ s/ COBRO DE PESOS',
        situacion_actual: null, situacion_fecha: null, notas: null,
        updated_at: '2026-08-15T12:00:00.000Z', snapshots: [],
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
// F2 (2026-08-31): 2028 agregado para probar el fix de calcularPlazoBitacora
// (cargar feriados del año real de vencimiento, no fijo [anioBase, anioBase+1]).
const FERIADOS = { 2026: [{ fecha: '2026-08-26' }], 2028: [{ fecha: '2028-01-03' }] };

const SUGERENCIAS = [
    { id: 1, expediente: 'FCR 99999/2026', caratula: 'DEMO c/ TEST s/ VERIFY',
      dependencia: 'Juzgado Federal 1', situacion: 'EN TRAMITE', nombre_parte: 'DEMO PARTE SA' },
];

// ─── D2 (demo Etapa 1.6, 2026-08-27): modo demo opcional ───────────────────
// Reemplaza el seed de /verify de arriba por el dataset coherente de la demo
// (backend-server/dev-tools/demo-fixtures/) — SOLO si se corre con --demo.
// Sin el flag, este archivo queda exactamente como estaba: 0 regresión para
// la campaña /verify, que sigue usando su propio seed sin tocar.
// Uso: node backend-server/dev-tools/stub-portal.js [puerto] --demo
const DEMO_MODE = process.argv.includes('--demo');
if (DEMO_MODE) {
    const { CUENTA_DEMO } = require('./demo-fixtures/cuenta');
    const { BITACORA_FICHAS, BITACORA_ENTRADAS } = require('./demo-fixtures/bitacora');
    const { PORTAL_FACTURAS, PORTAL_TICKETS } = require('./demo-fixtures/portal');

    Object.assign(ACCOUNT_STATE, {
        email: CUENTA_DEMO.email,
        nombre: CUENTA_DEMO.nombre,
        apellido: CUENTA_DEMO.apellido,
        cuit: CUENTA_DEMO.cuit,
        plan: CUENTA_DEMO.plan,
        planType: 'combo',
        registrationStatus: CUENTA_DEMO.registrationStatus,
        paymentProvider: CUENTA_DEMO.paymentProvider,
        bitacoraEnabled: CUENTA_DEMO.bitacoraEnabled,
        markdownEnabled: CUENTA_DEMO.markdownEnabled,
        usage: {
            proc:              { used: CUENTA_DEMO.usage.proc.usado,              limit: CUENTA_DEMO.usage.proc.limite,              unlimited: false },
            batch:             { used: CUENTA_DEMO.usage.batch.usado,             limit: CUENTA_DEMO.usage.batch.limite,             unlimited: false },
            informe:           { used: CUENTA_DEMO.usage.informe.usado,           limit: CUENTA_DEMO.usage.informe.limite,           unlimited: false },
            monitor_novedades: { used: CUENTA_DEMO.usage.monitor_novedades.usado, limit: CUENTA_DEMO.usage.monitor_novedades.limite, unlimited: false },
            monitor_partes:    { used: CUENTA_DEMO.usage.monitor_partes.usado,    limit: CUENTA_DEMO.usage.monitor_partes.limite,    unlimited: false },
        },
    });

    // Fichas de "Mis expedientes" / Bitácora — mismo shape que ya arma el
    // resto de este archivo (situacion_actual, no situacion; snapshots:[]).
    EXPEDIENTES.length = 0;
    BITACORA_FICHAS.forEach((f) => EXPEDIENTES.push({
        id: f.id,
        expediente: f.expediente,
        jurisdiccion: null,
        dependencia: f.dependencia,
        caratula: f.caratula,
        situacion_actual: f.situacion,
        situacion_fecha: f.situacion_fecha,
        notas: null,
        updated_at: f.creado_en,
        snapshots: [],
    }));

    BITACORA.length = 0;
    BITACORA_ENTRADAS.forEach((e) => BITACORA.push({ ...e }));

    // Facturación — el capítulo 7 solo necesita "Facturas emitidas", no un
    // historial de pagos crudo por separado.
    PAYMENTS.length = 0;
    INVOICES.length = 0;
    PORTAL_FACTURAS.forEach((f) => INVOICES.push({
        id: f.id,
        amount: f.amount,
        status: f.status === 'issued' ? 'emitida' : f.status,
        issued_at: f.issued_at,
        pdf_url: f.pdf_url,
    }));

    // Soporte — un ticket ya resuelto con hilo real (ver demo-fixtures/portal.js).
    TICKETS.length = 0;
    PORTAL_TICKETS.forEach((t) => TICKETS.push({
        id: t.id,
        title: t.subject,
        category: t.category,
        status: t.status,
        description: t.comments[0] ? t.comments[0].body : '',
        created_at: t.created_at,
        comments: t.comments.map((c, i) => ({
            id: i + 1,
            author_role: c.author_role,
            message: c.body,
            created_at: c.created_at,
        })),
    }));

    // Sugerencias y Partes de Monitor — sin fixture propio para D3, pero
    // TIENEN que vaciarse igual: el seed de /verify (`FCR 99999/2026 DEMO
    // c/ TEST s/ VERIFY`, `DON COCHO`, `LA TOSTADORA MODERNA`) se coló en
    // la primera captura real de D3 (el panel de "El Monitor encontró 1
    // caso nuevo" de Bitácora lo mostraba sin querer) — hallazgo real de
    // esa verificación, no anticipado al escribir el resto de este bloque.
    SUGERENCIAS.length = 0;
    PARTES.length = 0;

    console.log('⚠ Modo DEMO activo — sirviendo el dataset de la demo (Etapa 1.6), no el seed de /verify.');
}

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

        // ── Debug: mutar el estado de cuenta sin reiniciar el proceso ──
        // NO existe en el backend real — es exclusivo de este stub, para poder
        // probar trial/suspendida/en-gracia/etc. en la misma sesión de navegador.
        if (req.method === 'POST' && p === '/debug/account') {
            const body = await readJsonBody(req);
            Object.assign(ACCOUNT_STATE, body);
            return json(res, { success: true, account: ACCOUNT_STATE });
        }

        // ── Cuenta ──
        if (p === '/client/account') return json(res, { success: true, account: ACCOUNT_STATE });

        // ── Notificaciones ──
        if (p === '/client/notifications' && req.method === 'GET')
            return json(res, { success: true, notifications: NOTIFICATIONS });
        {
            // F2 (2026-08-31): 'all' además de \d+ — el shortcut real del backend
            // (routes/client.js) que markAllNotificationsRead() pasó a usar.
            const m = p.match(/^\/client\/notifications\/(all|\d+)\/read$/);
            if (req.method === 'POST' && m) {
                if (m[1] === 'all') {
                    NOTIFICATIONS.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); });
                } else {
                    const n = NOTIFICATIONS.find((x) => x.id === Number(m[1]));
                    if (n) n.read_at = new Date().toISOString();
                }
                return json(res, { success: true });
            }
        }

        // ── Planes / checkout / suscripción ──
        if (p === '/usuarios/api/plans') return json(res, { success: true, plans: PLANS });
        if (p === '/usuarios/api/subscription/current')
            return json(res, {
                success: true,
                paymentProvider: ACCOUNT_STATE.paymentProvider,
                hasPaymentMethod: !!ACCOUNT_STATE.paymentProvider,
                nextBillingDate: ACCOUNT_STATE.nextBillingDate,
                cancelAt: ACCOUNT_STATE.cancelAt,
                planDisplayName: ACCOUNT_STATE.plan.displayName,
                paymentGraceEndsAt: ACCOUNT_STATE.paymentGraceEndsAt || null,
            });
        if (p === '/usuarios/api/payments') return json(res, { success: true, payments: PAYMENTS });
        if (p === '/usuarios/api/invoices') return json(res, { success: true, invoices: INVOICES });
        if (req.method === 'POST' && p === '/usuarios/api/checkout/cancel') {
            const en30dias = new Date(Date.now() + 30 * 86400000).toISOString();
            ACCOUNT_STATE.cancelAt = en30dias;
            return json(res, { success: true, cancelAt: en30dias });
        }
        if (req.method === 'POST' && p === '/usuarios/api/checkout/reactivate') {
            ACCOUNT_STATE.cancelAt = null;
            return json(res, { success: true });
        }

        // ── Reactivación (sección "reactivacion", solo con registrationStatus=suspended_admin) ──
        if (req.method === 'POST' && p === '/users/reactivation-request') {
            const body = await readJsonBody(req);
            ACCOUNT_STATE.reactivationRequest = { status: 'pending', sent_at: new Date().toISOString(), message: body.message || '' };
            return json(res, { success: true });
        }

        // ── Asistente IA ──
        if (req.method === 'POST' && p === '/usuarios/api/ai-chat') {
            await readJsonBody(req);
            return json(res, { success: true, reply: 'Respuesta de prueba del stub (sin IA real).' });
        }

        // ── Descarga del instalador Electron ──
        if (p === '/api/extension/electron-token') return json(res, { success: true, token: 'STUB.DL.TOKEN' });

        // ── Tickets ──
        if (p === '/tickets' && req.method === 'GET') return json(res, { success: true, tickets: TICKETS });
        if (p === '/tickets' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const t = { id: nextTicketId++, status: 'open', created_at: new Date().toISOString(), comments: [], ...body };
            TICKETS.push(t);
            return json(res, { success: true, ticket: t });
        }
        {
            const m = p.match(/^\/tickets\/(\d+)$/);
            if (m && req.method === 'GET') {
                const t = TICKETS.find((x) => x.id === Number(m[1]));
                if (!t) return json(res, { success: false, error: 'No encontrado' }, 404);
                return json(res, { success: true, ticket: t, comments: t.comments });
            }
        }
        {
            const m = p.match(/^\/tickets\/(\d+)\/comment$/);
            if (m && req.method === 'POST') {
                const t = TICKETS.find((x) => x.id === Number(m[1]));
                const body = await readJsonBody(req);
                const c = { id: nextCommentId++, author_role: 'user', message: body.message, created_at: new Date().toISOString() };
                if (t) t.comments.push(c);
                return json(res, { success: true, comment: c });
            }
        }

        // ── Monitor de partes ──
        if (p === '/monitor/partes' && req.method === 'GET')
            return json(res, { success: true, partes: PARTES, limite: 20, usadas: PARTES.length });
        if (p === '/monitor/partes' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const parte = { id: nextParteId++, ...body };
            PARTES.push(parte);
            return json(res, { success: true, parte });
        }
        {
            const m = p.match(/^\/monitor\/partes\/(\d+)$/);
            if (m && req.method === 'DELETE') {
                const idx = PARTES.findIndex((x) => x.id === Number(m[1]));
                if (idx >= 0) PARTES.splice(idx, 1);
                return json(res, { success: true });
            }
        }

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

        // ── Resolución por número de expediente (deep-link ?goto=expediente&exp=) ──
        // Usa la normalización REAL del backend (no una copia), para que el stub no
        // pueda "pasar" con una lógica que producción no tiene.
        if (p === '/usuarios/api/expedientes/by-key' && req.method === 'GET') {
            const exp = (q.get('exp') || '').trim();
            if (!exp || !esExpedienteValido(exp)) {
                return json(res, { error: 'Falta el número de expediente o no es reconocible.' }, 400);
            }
            const clave = expedienteKey(exp);
            const x = EXPEDIENTES.find((e) => expedienteKey(e.expediente) === clave);
            if (!x) return json(res, { error: 'Ese expediente no está en tu Bitácora.', code: 'NO_SEGUIDO' }, 404);
            return json(res, { success: true, expediente: { id: x.id, expediente: x.expediente, caratula: x.caratula } });
        }

        // ── Captura por lote desde un visor ──
        // Devuelve `perCaso` como el backend real: el portal lo necesita para saber a
        // qué ficha navegar después de guardar. Sin esto caía al catch-all genérico,
        // que responde `{success:true}` sin perCaso — y el camino quedaba sin probar.
        if (p === '/usuarios/api/expedientes/capture-lote' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const casos = Array.isArray(body.casos) ? body.casos : [];
            const conSnapshot = body.accion === 'snapshot-lote';
            const perCaso = [];
            const resumen = { creados: 0, actualizados: 0, snapshots: 0, omitidos: 0 };
            for (const c of casos) {
                if (!c || !esExpedienteValido(c.expediente || '')) { resumen.omitidos++; continue; }
                const clave = expedienteKey(c.expediente);
                let x = EXPEDIENTES.find((e) => expedienteKey(e.expediente) === clave);
                const creado = !x;
                if (creado) {
                    x = { id: nextExpId++, expediente: c.expediente, jurisdiccion: c.jurisdiccion || null,
                          dependencia: c.dependencia || null, caratula: c.caratula || null,
                          situacion_actual: c.situacion_actual || null, situacion_fecha: new Date().toISOString(),
                          notas: null, updated_at: new Date().toISOString(), snapshots: [] };
                    EXPEDIENTES.push(x);
                    resumen.creados++;
                } else {
                    Object.assign(x, { updated_at: new Date().toISOString() });
                    resumen.actualizados++;
                }
                if (conSnapshot) {
                    x.snapshots.unshift({ id: Date.now() + x.snapshots.length,
                        kind: c.origen === 'informe' ? 'informe' : 'procuracion',
                        run_date: new Date().toISOString(), situacion: c.situacion_actual || null,
                        data: { movimientos: c.movimientos || [] } });
                    resumen.snapshots++;
                }
                perCaso.push({ expediente: x.expediente, expediente_id: x.id, creado });
            }
            return json(res, { success: true, accion: body.accion, resumen, perCaso });
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
