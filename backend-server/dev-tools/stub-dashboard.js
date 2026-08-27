// dev-tools/stub-dashboard.js — Servidor mínimo para verificar el dashboard admin
// (public/dashboard/) en un navegador real, SIN backend ni DB reales.
//
// Sirve los archivos REALES del repo y falsea la API con un almacén EN MEMORIA
// para Usuarios + Tickets + Planes (V2a del plan de verificación) — lo suficiente
// para ejercitar CRUD real (crear/suspender/activar usuario, ajustar uso, aplicar
// beneficios, responder tickets, crear/editar planes) sin depender de staging.
// El resto de /admin/* (Pagos, Facturación, Feriados, Monitor, Legal, Métricas,
// Diagnóstico, Scripts — V2b) sigue con el catch-all genérico de listas vacías.
//
// Uso: node backend-server/dev-tools/stub-dashboard.js [puerto]
//   → abrir http://localhost:<puerto>/dashboard/
//
// Ver .claude/skills/verify/SKILL.md para el recetario completo.
//
// El estado vive solo en memoria — se pierde al reiniciar el proceso. Arranca
// con datos de seed (2 usuarios + 1 ticket + 2 planes) para no empezar cada
// verificación desde una pantalla vacía.

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PUBLIC_DIR    = path.join(__dirname, '..', 'public');
const DASHBOARD_DIR = path.join(PUBLIC_DIR, 'dashboard');
const PORT = parseInt(process.argv[2], 10) || 5189;

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// JWT falso: header+payload reales en base64url, firma de relleno (nunca se
// verifica del lado del stub, y el cliente tampoco la valida).
const FAKE_TOKEN = [
    b64url({ alg: 'none', typ: 'JWT' }),
    b64url({ id: 1, role: 'admin', email: 'admin@stub.local', exp: Math.floor(Date.now() / 1000) + 8 * 3600 }),
    'stub-signature',
].join('.');

// ─── Almacén en memoria ─────────────────────────────────────────────────────
let nextUserId = 3;
let nextTicketId = 2;
let nextCommentId = 2;
let nextPlanId = 3;
let nextExtraId = 1;
let nextBenefitId = 1;
let nextAdjId = 1;

// Etapa 1.5 (F1/F2) — seed que refleja el estado REAL medido en producción el 2026-08-26:
// informe en 46/50 (alcanza para 1 prueba pero no para la reserva de 2), 3 partes activas.
const VERIF_STATE = {
    latest: {
        timestamp: new Date(Date.now() - 3 * 86400000).toISOString(),
        origen: 'computer-use', cuenta: '27320694359', estado: 'parcial', tiempoTotalMs: 640000,
        flujos: [
            { clave: 'proc', nombre: 'Procuración', estado: 'ok', tiempoMs: 38000, detalle: '2/2 exitosos, 0 fallidos (FCR 9078/2021, FCR 2429/2025)' },
            { clave: 'batch', nombre: 'Procuración por lote', estado: 'ok', tiempoMs: 21000, detalle: '2/2 exitosos, 0 fallidos (fixture batch-verificacion.txt)' },
            { clave: 'informe', nombre: 'Informe individual', estado: 'ok', tiempoMs: 71300, detalle: 'PDF generado y abierto - FCR 18745/2017, proceso completado con exito' },
            { clave: 'informe_lote', nombre: 'Informe por lote', estado: 'omitido', tiempoMs: null, detalle: 'sin cupo de informes' },
            { clave: 'monitor', nombre: 'Monitor — novedades', estado: 'ok', tiempoMs: 18500, detalle: '3/3 partes exitosas, 0 novedades (DON COCHO 115 exp., LA TOSTADORA MODERNA, ALVAREZ MARTA FABIANA)' },
        ],
        notas: 'Corrida de seed del stub-dashboard.',
        reportedBy: 'admin@stub.local',
    },
    history: [],
};
VERIF_STATE.history = [VERIF_STATE.latest];

const VERIF_CUPO = {
    userId: 250, email: 'procuradortool@gmail.com', cuit: '27320694359', esTrial: true,
    partesActivas: 3,
    submodulos: {
        proc: { used: 24, limit: 50, bonus: 0, ilimitado: false, remaining: 26, costoPorPrueba: 1 },
        batch: { used: 10, limit: 20, bonus: 0, ilimitado: false, remaining: 10, costoPorPrueba: 1 },
        informe: { used: 46, limit: 50, bonus: 0, ilimitado: false, remaining: 4, costoPorPrueba: 3 },
        monitor_novedades: { used: 26, limit: 50, bonus: 0, ilimitado: false, remaining: 24, costoPorPrueba: 3 },
    },
    global: { used: 97, limit: 110, ilimitado: false, remaining: 13, costoPorPrueba: 6 },
    alcanzaParaUnaPrueba: true, alcanzaParaReserva: false, reservaObjetivo: 2,
};

const PLANS = [
    { id: 1, name: 'COMBO_PROMO', display_name: 'Combo Beta', description: 'Plan combo de seed.',
      plan_type: 'combo', price_usd: null, price_ars: 15000, visibility: 'public', bitacora_enabled: true,
      active: true, proc_executions_limit: 50, batch_executions_limit: 20, batch_expedientes_limit: 10,
      informe_limit: 50, monitor_partes_limit: 20, monitor_novedades_limit: 50, period_days: 30,
      extension_flows: ['consulta', 'escritos1', 'escritos2', 'notif', 'deox'],
      promo_type: null, promo_end_date: null, promo_max_users: null, promo_used_count: 0, promo_alert_days: 15,
      plan_expiry_date: null },
    { id: 2, name: 'EXTENSION_PROMO', display_name: 'Extensión', description: 'Plan de seed solo extensión.',
      plan_type: 'extension', price_usd: null, price_ars: 1500, visibility: 'public', bitacora_enabled: false,
      active: true, proc_executions_limit: 0, batch_executions_limit: 0, batch_expedientes_limit: 0,
      informe_limit: 0, monitor_partes_limit: 0, monitor_novedades_limit: 0, period_days: 30,
      extension_flows: ['consulta'], promo_type: null, promo_end_date: null, promo_max_users: null,
      promo_used_count: 0, promo_alert_days: 15, plan_expiry_date: null },
];

const USERS = [
    {
        id: 1, email: 'usuario.seed@test.local', role: 'user', plan: 'COMBO_PROMO', plan_id: 1,
        plan_display_name: 'Combo Beta', status: 'active', registration_status: 'active',
        usage_count: 12, usage_limit: 999999, courtesy_extras: 0, expires_at: '2027-01-01T00:00:00.000Z',
        last_login: '2026-08-23T10:00:00.000Z', created_at: '2026-06-01T10:00:00.000Z',
        cuit: '27320694359', telefono: '', machine_id: 'STUB-HW-1', domicilio: {},
        email_verified: true, toc_accepted_at: '2026-06-01T10:00:00.000Z', payment_provider: 'mercadopago',
        cancel_at: null, proc_usage: 12, proc_executions_limit: 50, proc_bonus: 0,
        batch_usage: 2, batch_executions_limit: 20, batch_bonus: 0,
        informe_usage: 5, informe_limit: 50, informe_bonus: 0,
        monitor_novedades_usage: 3, monitor_novedades_limit: 50, monitor_novedades_bonus: 0,
        monitor_partes_limit: 20, monitor_partes_bonus: 0,
    },
    {
        id: 2, email: 'pendiente.seed@test.local', role: 'user', plan: null, plan_id: null,
        plan_display_name: null, status: 'suspended', registration_status: 'pending_activation',
        usage_count: 18, usage_limit: 20, courtesy_extras: 0, expires_at: null,
        last_login: null, created_at: '2026-08-20T10:00:00.000Z',
        cuit: '20300000029', telefono: '', machine_id: null, domicilio: {},
        email_verified: true, toc_accepted_at: '2026-08-20T10:00:00.000Z', payment_provider: null,
        cancel_at: null, proc_usage: 0, proc_executions_limit: 0, proc_bonus: 0,
        batch_usage: 0, batch_executions_limit: 0, batch_bonus: 0,
        informe_usage: 0, informe_limit: 0, informe_bonus: 0,
        monitor_novedades_usage: 0, monitor_novedades_limit: 0, monitor_novedades_bonus: 0,
        monitor_partes_limit: 0, monitor_partes_bonus: 0,
    },
];

const TICKETS = [
    { id: 1, user_id: 1, user_email: 'usuario.seed@test.local', category: 'technical', status: 'open',
      priority: 'medium', priority_source: null, priority_notes: null, benefit_applied: false,
      title: 'Ticket admin de seed', description: 'Descripcion de seed para V2a.',
      created_at: '2026-08-22T12:00:00.000Z',
      comments: [{ id: 1, author_role: 'user', author_email: 'usuario.seed@test.local',
                   message: 'Mensaje inicial del usuario.', visibility: 'external',
                   created_at: '2026-08-22T12:00:00.000Z', edited_at: null }] },
];

const EXTRAS = {};      // userId -> [{id, extra_uses, reason, created_at, assigned_by_email}]
const BENEFITS = {};    // userId -> [{id, benefit_type, benefit_value, ticket_id, created_at, applied_by_email}]
const ADJUSTMENTS = {}; // userId -> [{id, subsystem, amount, reason, admin_email, created_at}]

// ─── V2b: Pagos, Facturación, Feriados, Monitor, Legal, Métricas, Scripts ──────
let nextPaymentId = 1;
let nextInvoiceId = 1;
let nextFeriadoId = 1;
let nextLegalId = 1;

const PAYMENTS = [
    { id: nextPaymentId++, user_id: 1, email: 'usuario.seed@test.local', nombre: 'Usuario', apellido: 'Seed',
      created_at: '2026-08-01T10:00:00.000Z', amount: 15000, currency: 'ARS', status: 'approved',
      payment_method: 'mercadopago', plan: 'COMBO_PROMO', external_payment_id: 'MP-SEED-001',
      invoice_id: null, invoice_pdf: null, invoice_numero: null },
];

const INVOICES = [];

const FERIADOS = [
    { id: nextFeriadoId++, fecha: '2026-12-08T00:00:00.000Z', motivo: 'Inmaculada Concepción (seed)' },
    { id: nextFeriadoId++, fecha: '2027-01-01T00:00:00.000Z', motivo: 'Año Nuevo (seed)' },
];

const MONITOR_PARTES = [
    { user_email: 'usuario.seed@test.local', jurisdiccion_sigla: 'FCR', nombre_parte: 'DON COCHO',
      tiene_linea_base: true, exp_confirmados: 12, novedades_pendientes: 2, fecha_creacion: '2026-08-01T10:00:00.000Z' },
    { user_email: 'usuario.seed@test.local', jurisdiccion_sigla: 'FCR', nombre_parte: 'LA TOSTADORA MODERNA',
      tiene_linea_base: false, exp_confirmados: 0, novedades_pendientes: 0, fecha_creacion: '2026-08-20T10:00:00.000Z' },
];

const LEGAL_DOCS = [
    { id: nextLegalId++, type: 'tyc', version: '1.0', title: 'Términos y Condiciones',
      html_content: '<p>Contenido de seed de T&amp;C.</p>', summary_of_changes: '', effective_date: '2026-06-01',
      requires_acceptance: true, is_current: true, acceptance_count: 3, created_at: '2026-06-01T10:00:00.000Z' },
    { id: nextLegalId++, type: 'pyp', version: '1.0', title: 'Política de Privacidad',
      html_content: '<p>Contenido de seed de PyP.</p>', summary_of_changes: '', effective_date: '2026-06-01',
      requires_acceptance: true, is_current: true, acceptance_count: 3, created_at: '2026-06-01T10:00:00.000Z' },
];

const SCRIPTS = [
    { script_name: 'consultarscwpjn.js', version: 3, active: true, hash: 'abc123def456abc123def456abc123def456abc1', updated_at: '2026-08-01T10:00:00.000Z' },
    { script_name: 'informequickscwpjn.js', version: 5, active: true, hash: 'def456abc123def456abc123def456abc123def4', updated_at: '2026-08-01T10:00:00.000Z' },
    { script_name: 'procesarMonitoreo.js', version: 2, active: true, hash: '123abc456def123abc456def123abc456def123a', updated_at: '2026-08-01T10:00:00.000Z' },
];

function paymentById(id) { return PAYMENTS.find((x) => x.id === Number(id)); }
function invoiceById(id) { return INVOICES.find((x) => x.id === Number(id)); }
function feriadoById(id) { return FERIADOS.find((x) => x.id === Number(id)); }
function legalById(id) { return LEGAL_DOCS.find((x) => x.id === Number(id)); }

// Parser multipart mínimo: alcanza para leer campos de texto + saber si vino un
// archivo "pdf" (nombre y tamaño), sin necesitar procesar el binario real.
function parseMultipart(buf, contentType) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    const boundary = m ? (m[1] || m[2]) : null;
    const fields = {}; let file = null;
    if (!boundary) return { fields, file };
    const parts = buf.toString('binary').split(`--${boundary}`);
    for (const part of parts) {
        if (!part || part === '--\r\n' || part === '--') continue;
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const header = part.slice(0, headerEnd);
        let body = part.slice(headerEnd + 4);
        if (body.endsWith('\r\n')) body = body.slice(0, -2);
        const nameMatch = /name="([^"]+)"/.exec(header);
        if (!nameMatch) continue;
        const name = nameMatch[1];
        const fileMatch = /filename="([^"]*)"/.exec(header);
        if (fileMatch && fileMatch[1]) {
            file = { fieldname: name, filename: fileMatch[1], size: Buffer.byteLength(body, 'binary') };
        } else {
            fields[name] = body;
        }
    }
    return { fields, file };
}
async function readMultipart(req) {
    const buf = await readBody(req);
    return parseMultipart(buf, req.headers['content-type']);
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

function userById(id) { return USERS.find((u) => u.id === Number(id)); }
function planById(id) { return PLANS.find((p) => p.id === Number(id)); }
function ticketById(id) { return TICKETS.find((t) => t.id === Number(id)); }

// ─── Servidor ───────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const q = u.searchParams;
    console.log(req.method, p);

    try {
        if (req.method === 'POST' && p === '/auth/admin-login') {
            await readBody(req);
            return json(res, { success: true, token: FAKE_TOKEN, user: { id: 1, email: 'admin@stub.local', role: 'admin' } });
        }

        // ── Usuarios pendientes (VF-3: para ejercitar rejectUserBlock/rejectUserKeepTrial/
        //    approveReactivation/rejectReactivation, que usan showPrompt) ──
        if (p === '/admin/users/pending' && req.method === 'GET') {
            return json(res, { success: true, users: USERS.filter((x) => ['pending_activation', 'pending_email'].includes(x.registration_status)) });
        }
        if (p === '/admin/users/reactivation-requests' && req.method === 'GET') {
            return json(res, { success: true, requests: USERS.filter((x) => x.reactivation_requested).map((x) => ({ id: x.id, nombre: x.nombre || '', email: x.email, suspension_reason: x.suspension_reason || '', suspended_at: x.updated_at || x.created_at, user_message: x.reactivation_message || '' })) });
        }

        if (p === '/admin/stats/overview') {
            const st = {
                totalUsers: USERS.length,
                activeUsers: USERS.filter((x) => x.registration_status === 'active').length,
                pendingUsers: USERS.filter((x) => x.registration_status === 'pending_activation').length,
                suspendedUsers: USERS.filter((x) => x.registration_status === 'suspended_admin').length,
                expiredUsers: USERS.filter((x) => x.registration_status === 'suspended_plan_expired').length,
                cancelledUsers: USERS.filter((x) => x.registration_status === 'cancelled').length,
                rejectedUsers: USERS.filter((x) => x.registration_status === 'rejected').length,
                pendingEmailUsers: USERS.filter((x) => x.registration_status === 'pending_email').length,
                activeSubscriptions: USERS.filter((x) => x.status === 'active').length,
                openTickets: TICKETS.filter((t) => t.status === 'open').length,
                activeScripts: SCRIPTS.filter((s) => s.active).length,
                executionsToday: 7,
                successRate: { successful: 6, failed: 1 },
                topScripts: [{ script_name: 'consultarscwpjn.js', executions: 5 }, { script_name: 'informequickscwpjn.js', executions: 2 }],
            };
            return json(res, { success: true, stats: st });
        }

        // ── Usuarios: búsqueda (para el selector de Pagos/Facturas y el picker) ──
        if (p === '/admin/users/search') {
            const qv = (q.get('q') || '').toLowerCase();
            const limit = parseInt(q.get('limit'), 10) || 8;
            const rows = USERS.filter((x) => !qv || x.email.toLowerCase().includes(qv)).slice(0, limit);
            return json(res, { success: true, users: rows });
        }

        // ── Usuarios: lista + alta ──
        if (p === '/admin/users' && req.method === 'GET') return json(res, { success: true, users: USERS });
        if (p === '/admin/users' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const plan = body.planId ? planById(body.planId) : null;
            const gratis = plan && (plan.price_ars === 0 || plan.price_usd === 0);
            const nuevo = {
                id: nextUserId++, email: body.email, role: 'user',
                plan: plan ? plan.name : null, plan_id: plan ? plan.id : null,
                plan_display_name: plan ? plan.display_name : null,
                status: gratis ? 'active' : 'suspended',
                registration_status: gratis ? 'active' : 'pending_email',
                usage_count: 0, usage_limit: gratis ? 999999 : 20, courtesy_extras: 0,
                expires_at: gratis ? new Date(Date.now() + (body.durationDays || 30) * 86400000).toISOString() : null,
                last_login: null, created_at: new Date().toISOString(),
                cuit: body.cuit, telefono: body.telefono || '', machine_id: null, domicilio: {},
                email_verified: false, toc_accepted_at: null, payment_provider: null, cancel_at: null,
                proc_usage: 0, proc_executions_limit: plan?.proc_executions_limit || 0, proc_bonus: 0,
                batch_usage: 0, batch_executions_limit: plan?.batch_executions_limit || 0, batch_bonus: 0,
                informe_usage: 0, informe_limit: plan?.informe_limit || 0, informe_bonus: 0,
                monitor_novedades_usage: 0, monitor_novedades_limit: plan?.monitor_novedades_limit || 0, monitor_novedades_bonus: 0,
                monitor_partes_limit: plan?.monitor_partes_limit || 0, monitor_partes_bonus: 0,
            };
            USERS.push(nuevo);
            return json(res, { success: true, message: `Usuario ${nuevo.email} creado correctamente.`, user: nuevo });
        }

        // ── Usuarios: detalle ──
        {
            const m = p.match(/^\/admin\/users\/(\d+)$/);
            if (m && req.method === 'GET') {
                const user = userById(m[1]);
                if (!user) return json(res, { success: false, error: 'No encontrado' }, 404);
                return json(res, { success: true, user, recentLogs: [], events: [] });
            }
        }

        // ── Usuarios: acciones puntuales ──
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/unbind-hardware$/);
            if (m && req.method === 'POST') { const x = userById(m[1]); if (x) x.machine_id = null; return json(res, { success: true }); }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/role$/);
            if (m && req.method === 'PUT') { const body = await readJsonBody(req); const x = userById(m[1]); if (x) x.role = body.role; return json(res, { success: true }); }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/cuit$/);
            if (m && req.method === 'PUT') { const body = await readJsonBody(req); const x = userById(m[1]); if (x) x.cuit = body.cuit; return json(res, { success: true }); }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/refund-preview$/);
            if (m && req.method === 'GET') {
                const x = userById(m[1]);
                if (!x || !x.payment_provider) return json(res, { success: true, hasPayment: false });
                return json(res, { success: true, hasPayment: true, currency: 'ARS', refundAmount: 7500.5, daysRemaining: 15, totalDays: 30 });
            }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/suspend$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const x = userById(m[1]);
                if (x) { x.registration_status = 'suspended_admin'; x.status = 'suspended'; x.suspension_reason = body.reason; }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/reactivation-request\/approve$/);
            if (m && req.method === 'POST') {
                const x = userById(m[1]);
                if (x) { x.registration_status = 'active'; x.status = 'active'; }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/verify-email$/);
            if (m && req.method === 'POST') { const x = userById(m[1]); if (x) x.email_verified = true; return json(res, { success: true }); }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/resend-verification$/);
            if (m && req.method === 'POST') return json(res, { success: true, message: 'Email de verificación reenviado.' });
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/registro$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const x = userById(m[1]);
                if (!x) return json(res, { success: false, error: 'No encontrado' }, 404);
                const activando = body.registration_status === 'active' && x.registration_status !== 'active';
                Object.assign(x, {
                    nombre: body.nombre, apellido: body.apellido, cuit: body.cuit ?? x.cuit,
                    telefono: body.telefono, domicilio: body.domicilio || x.domicilio,
                });
                if (body.registration_status) {
                    x.registration_status = body.registration_status;
                    x.status = body.registration_status === 'active' ? 'active'
                        : body.registration_status.startsWith('suspended') ? 'suspended'
                        : x.status;
                    if (body.registration_status === 'pending_activation') { x.usage_count = 0; x.usage_limit = 20; }
                }
                return json(res, { success: true, activated: activando });
            }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/change-email$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const x = userById(m[1]);
                if (x) { x.email = body.email; x.registration_status = 'pending_email'; x.status = 'suspended'; x.email_verified = false; }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/activate$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const x = userById(m[1]);
                if (x) {
                    x.registration_status = 'active'; x.status = 'active';
                    x.expires_at = new Date(Date.now() + (body.expires_days || 30) * 86400000).toISOString();
                }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/reject$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const x = userById(m[1]);
                if (x) { x.registration_status = body.mode === 'block' ? 'rejected' : 'pending_activation'; x.status = 'suspended'; }
                return json(res, { success: true });
            }
        }

        // ── Usos extra (cortesía) ──
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/extra-usage$/);
            if (m && req.method === 'GET') return json(res, { success: true, extras: EXTRAS[m[1]] || [] });
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const uid = m[1]; const x = userById(uid);
                const row = { id: nextExtraId++, extra_uses: body.extra_uses, reason: body.reason,
                    created_at: new Date().toISOString(), assigned_by_email: 'admin@stub.local' };
                (EXTRAS[uid] = EXTRAS[uid] || []).unshift(row);
                if (x) x.courtesy_extras = (x.courtesy_extras || 0) + body.extra_uses;
                if (x) x.usage_limit = Math.max(0, (x.usage_limit || 0) + body.extra_uses);
                return json(res, { success: true });
            }
        }

        // ── Beneficios comerciales ──
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/benefits$/);
            if (m && req.method === 'GET') return json(res, { success: true, benefits: BENEFITS[m[1]] || [] });
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/apply-benefit$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const uid = m[1]; const x = userById(uid);
                const row = { id: nextBenefitId++, benefit_type: body.benefit_type, benefit_value: body.benefit_value,
                    ticket_id: null, created_at: new Date().toISOString(), applied_by_email: 'admin@stub.local' };
                (BENEFITS[uid] = BENEFITS[uid] || []).unshift(row);
                if (x && body.benefit_type === 'discount') {
                    const dias = parseInt(body.benefit_value, 10) || 0;
                    const base = x.expires_at ? new Date(x.expires_at) : new Date();
                    x.expires_at = new Date(base.getTime() + dias * 86400000).toISOString();
                }
                return json(res, { success: true });
            }
        }

        // ── Pagos / facturas del usuario (desde la ficha) ──
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/payments$/);
            if (m && req.method === 'GET') return json(res, { success: true, payments: PAYMENTS.filter((x) => x.user_id === Number(m[1])) });
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/invoices$/);
            if (m && req.method === 'GET') return json(res, { success: true, invoices: INVOICES.filter((x) => x.user_id === Number(m[1])) });
        }

        // ── Suscripciones ──
        if (p === '/admin/subscriptions' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const x = userById(body.userId); const plan = planById(body.planId);
            if (x && plan) {
                x.plan = plan.name; x.plan_id = plan.id; x.plan_display_name = plan.display_name;
                x.expires_at = new Date(Date.now() + (body.durationDays || 30) * 86400000).toISOString();
            }
            return json(res, { success: true, message: `Plan actualizado a "${plan ? plan.display_name : ''}".` });
        }
        {
            const m = p.match(/^\/admin\/subscriptions\/(\d+)\/reset-usage$/);
            if (m && req.method === 'POST') {
                const x = userById(m[1]);
                if (x) { x.usage_count = 0; x.proc_usage = 0; x.batch_usage = 0; x.informe_usage = 0; x.monitor_novedades_usage = 0; }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/subscriptions\/(\d+)\/cancel$/);
            if (m && req.method === 'POST') {
                const x = userById(m[1]);
                if (x) x.cancel_at = new Date(Date.now() + 30 * 86400000).toISOString();
                return json(res, { success: true, message: 'Cancelación programada para el fin del período.' });
            }
        }
        {
            const m = p.match(/^\/admin\/subscriptions\/(\d+)\/reactivate-cancel$/);
            if (m && req.method === 'POST') {
                const x = userById(m[1]);
                if (x) x.cancel_at = null;
                return json(res, { success: true, message: 'Cancelación revertida.' });
            }
        }
        {
            const m = p.match(/^\/admin\/subscriptions\/(\d+)\/adjust$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const uid = m[1]; const x = userById(uid);
                const bonusKey = body.subsystem + '_bonus';
                if (x && bonusKey in x) x[bonusKey] = (x[bonusKey] || 0) + body.amount;
                const row = { id: nextAdjId++, subsystem: body.subsystem, amount: body.amount, reason: body.reason,
                    admin_email: 'admin@stub.local', created_at: new Date().toISOString() };
                (ADJUSTMENTS[uid] = ADJUSTMENTS[uid] || []).unshift(row);
                return json(res, { success: true, newBonus: x ? x[bonusKey] : body.amount });
            }
        }
        {
            const m = p.match(/^\/admin\/subscriptions\/(\d+)\/adjustments$/);
            if (m && req.method === 'GET') return json(res, { success: true, adjustments: ADJUSTMENTS[m[1]] || [] });
        }

        // ── Tickets ──
        if (p === '/admin/tickets' && req.method === 'GET') {
            const userId = q.get('userId');
            let rows = TICKETS.slice();
            if (userId) rows = rows.filter((t) => t.user_id === Number(userId));
            const status = q.get('status');
            if (status) rows = rows.filter((t) => t.status === status);
            return json(res, { success: true, tickets: rows, count: rows.length });
        }
        {
            const m = p.match(/^\/admin\/tickets\/(\d+)$/);
            if (m && req.method === 'GET') {
                const t = ticketById(m[1]);
                if (!t) return json(res, { success: false, error: 'No encontrado' }, 404);
                return json(res, { success: true, ticket: t, comments: t.comments });
            }
        }
        {
            const m = p.match(/^\/admin\/tickets\/(\d+)\/comment$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const t = ticketById(m[1]);
                const c = { id: nextCommentId++, author_role: 'admin', author_email: 'admin@stub.local',
                    message: body.message, visibility: body.visibility || 'external',
                    created_at: new Date().toISOString(), edited_at: null };
                if (t) t.comments.push(c);
                return json(res, { success: true, comment: c });
            }
        }
        {
            const m = p.match(/^\/admin\/tickets\/(\d+)\/comment\/(\d+)$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const t = ticketById(m[1]);
                const c = t && t.comments.find((x) => x.id === Number(m[2]));
                if (c) { c.message = body.message; c.edited_at = new Date().toISOString(); }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/tickets\/(\d+)\/status$/);
            if (m && req.method === 'PUT') { const body = await readJsonBody(req); const t = ticketById(m[1]); if (t) t.status = body.status; return json(res, { success: true }); }
        }
        {
            const m = p.match(/^\/admin\/tickets\/(\d+)\/priority$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const t = ticketById(m[1]);
                if (t) { t.priority = body.priority; t.priority_source = body.ai_managed ? null : 'manual'; }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/tickets\/(\d+)\/apply-benefit$/);
            if (m && req.method === 'POST') { const t = ticketById(m[1]); if (t) t.benefit_applied = true; return json(res, { success: true }); }
        }
        {
            const m = p.match(/^\/admin\/tickets\/(\d+)\/ai-suggest-reply$/);
            if (m && req.method === 'POST') return json(res, { success: true, suggestion: 'Sugerencia de prueba del stub (sin IA real).', log_id: 1 });
        }
        if (p === '/admin/tickets/ai-prioritize' && req.method === 'POST') {
            TICKETS.forEach((t) => { if (!t.priority_source || t.priority_source === 'ai') { t.priority = 'medium'; t.priority_source = 'ai'; t.priority_notes = 'Clasificado por el stub.'; } });
            return json(res, { success: true, updated: TICKETS.length });
        }
        if (p.match(/^\/admin\/ai-suggest-logs\/\d+$/)) return json(res, { success: true });

        // ── Planes ──
        if (p === '/admin/plans' && req.method === 'GET') return json(res, { success: true, plans: PLANS });
        if (p === '/admin/plans' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const nuevo = { id: nextPlanId++, active: true, promo_used_count: 0, ...body };
            PLANS.push(nuevo);
            return json(res, { success: true, plan: nuevo });
        }
        {
            const m = p.match(/^\/admin\/plans\/(\d+)$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const pl = planById(m[1]);
                if (pl) Object.assign(pl, body);
                return json(res, { success: true, plan: pl });
            }
            if (m && req.method === 'DELETE') {
                const pl = planById(m[1]); if (pl) pl.active = false;
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/plans\/(\d+)\/activate$/);
            if (m && req.method === 'PATCH') { const pl = planById(m[1]); if (pl) pl.active = true; return json(res, { success: true }); }
        }
        {
            const m = p.match(/^\/admin\/plans\/(\d+)\/expiry$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const pl = planById(m[1]);
                if (pl) pl.plan_expiry_date = body.plan_expiry_date;
                return json(res, { success: true });
            }
        }

        // ── Pagos ──
        if (p === '/admin/payments' && req.method === 'GET') {
            const search = (q.get('search') || '').toLowerCase();
            const status = q.get('status') || '';
            let rows = PAYMENTS.slice();
            if (search) rows = rows.filter((x) => (x.email || '').toLowerCase().includes(search) || (x.nombre || '').toLowerCase().includes(search) || (x.apellido || '').toLowerCase().includes(search) || (x.cuit || '').includes(search));
            if (status) rows = rows.filter((x) => x.status === status);
            return json(res, { success: true, payments: rows });
        }
        if (p === '/admin/payments/manual' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const user = userById(body.user_id);
            const row = {
                id: nextPaymentId++, user_id: Number(body.user_id), email: user ? user.email : '',
                nombre: user ? (user.nombre || '') : '', apellido: user ? (user.apellido || '') : '',
                created_at: body.created_at ? new Date(body.created_at).toISOString() : new Date().toISOString(),
                amount: Number(body.amount), currency: body.currency || 'ARS', status: body.status || 'approved',
                payment_method: body.payment_method || 'manual', plan: body.plan || null,
                external_payment_id: body.external_payment_id || null, invoice_id: null, invoice_pdf: null, invoice_numero: null,
            };
            PAYMENTS.unshift(row);
            return json(res, { success: true, payment: row });
        }
        {
            const m = p.match(/^\/admin\/payments\/(\d+)$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const pay = paymentById(m[1]);
                if (!pay) return json(res, { success: false, error: 'No encontrado' }, 404);
                if (pay.payment_method !== 'manual' && body.payment_method === undefined) {
                    // no-op, el pago real ya trae payment_method
                }
                Object.assign(pay, {
                    amount: Number(body.amount), currency: body.currency || 'ARS', status: body.status || pay.status,
                    payment_method: body.payment_method || pay.payment_method, plan: body.plan ?? pay.plan,
                    external_payment_id: body.external_payment_id ?? pay.external_payment_id,
                    created_at: body.created_at ? new Date(body.created_at).toISOString() : pay.created_at,
                });
                return json(res, { success: true, payment: pay });
            }
        }
        {
            const m = p.match(/^\/admin\/payments\/(\d+)\/link-invoice$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const pay = paymentById(m[1]); const inv = invoiceById(body.invoice_id);
                if (!inv) return json(res, { success: false, error: 'Factura no encontrada' }, 404);
                if (inv.payment_id) return json(res, { success: false, error: 'Esa factura ya está asociada a otro pago' }, 400);
                inv.payment_id = pay.id;
                pay.invoice_id = inv.id; pay.invoice_pdf = inv.pdf_url; pay.invoice_numero = inv.numero;
                return json(res, { success: true });
            }
        }

        // ── Facturas ──
        if (p === '/admin/invoices/pending' && req.method === 'GET') {
            const search = (q.get('search') || '').toLowerCase();
            let rows = PAYMENTS.filter((x) => !x.invoice_id && x.status === 'approved');
            if (search) rows = rows.filter((x) => (x.email || '').toLowerCase().includes(search) || (x.nombre || '').toLowerCase().includes(search));
            const pending = rows.map((x) => {
                const user = userById(x.user_id) || {};
                return { payment_id: x.id, invoice_id: null, payment_date: x.created_at, amount: x.amount, plan: x.plan,
                    nombre: x.nombre, apellido: x.apellido, email: x.email, cuit: user.cuit || null, domicilio: user.domicilio || {} };
            });
            return json(res, { success: true, pending });
        }
        if (p === '/admin/invoices' && req.method === 'GET') {
            const search = (q.get('search') || '').toLowerCase();
            const includeNoPdf = q.get('include_no_pdf') === '1';
            let rows = INVOICES.slice();
            if (!includeNoPdf) rows = rows; // el listado de Emitidas ya solo contiene lo creado (con o sin PDF, el include_no_pdf es para el selector de asociar)
            if (search) rows = rows.filter((x) => (x.email || '').toLowerCase().includes(search) || (x.nombre || '').toLowerCase().includes(search) || (x.cuit || '').includes(search));
            return json(res, { success: true, invoices: rows });
        }
        if (p === '/admin/invoices/manual' && req.method === 'POST') {
            const { fields, file } = await readMultipart(req);
            const user = userById(fields.user_id);
            if (!file) return json(res, { success: false, error: 'Falta el PDF' }, 400);
            const row = {
                id: nextInvoiceId++, payment_id: null, user_id: Number(fields.user_id),
                email: user ? user.email : '', nombre: user ? (user.nombre || '') : '', apellido: user ? (user.apellido || '') : '',
                cuit: user ? user.cuit : null, amount: Number(fields.amount), invoice_type: fields.invoice_type || 'C',
                numero: fields.numero || null, cae: fields.cae || null,
                issued_at: fields.issued_at ? new Date(fields.issued_at).toISOString() : new Date().toISOString(),
                created_at: new Date().toISOString(), pdf_url: `/stub-invoices/${file.filename}`, plan: fields.plan || null,
            };
            INVOICES.unshift(row);
            return json(res, { success: true, invoice: row });
        }
        {
            const m = p.match(/^\/admin\/invoices\/from-payment\/(\d+)$/);
            if (m && req.method === 'POST') {
                const { fields, file } = await readMultipart(req); const pay = paymentById(m[1]);
                if (!pay) return json(res, { success: false, error: 'Pago no encontrado' }, 404);
                if (!file) return json(res, { success: false, error: 'Falta el PDF' }, 400);
                const user = userById(pay.user_id);
                const row = {
                    id: nextInvoiceId++, payment_id: pay.id, user_id: pay.user_id, email: pay.email,
                    nombre: pay.nombre, apellido: pay.apellido, cuit: user ? user.cuit : null, amount: pay.amount,
                    invoice_type: fields.invoice_type || 'C', numero: fields.numero || null, cae: fields.cae || null,
                    issued_at: new Date().toISOString(), created_at: new Date().toISOString(),
                    pdf_url: `/stub-invoices/${file.filename}`, plan: pay.plan,
                };
                INVOICES.unshift(row);
                pay.invoice_id = row.id; pay.invoice_pdf = row.pdf_url; pay.invoice_numero = row.numero;
                return json(res, { success: true, invoice: row });
            }
        }
        {
            const m = p.match(/^\/admin\/invoices\/(\d+)\/upload$/);
            if (m && req.method === 'POST') {
                const { fields, file } = await readMultipart(req); const inv = invoiceById(m[1]);
                if (!inv) return json(res, { success: false, error: 'Factura no encontrada' }, 404);
                if (!file) return json(res, { success: false, error: 'Falta el PDF' }, 400);
                Object.assign(inv, {
                    numero: fields.numero || inv.numero, invoice_type: fields.invoice_type || inv.invoice_type,
                    cae: fields.cae || inv.cae, pdf_url: `/stub-invoices/${file.filename}`,
                });
                const pay = PAYMENTS.find((x) => x.invoice_id === inv.id);
                if (pay) { pay.invoice_pdf = inv.pdf_url; pay.invoice_numero = inv.numero; }
                return json(res, { success: true, invoice: inv });
            }
        }
        {
            const m = p.match(/^\/admin\/invoices\/(\d+)\/meta$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const inv = invoiceById(m[1]);
                if (!inv) return json(res, { success: false, error: 'No encontrada' }, 404);
                Object.assign(inv, {
                    amount: body.amount != null ? Number(body.amount) : inv.amount,
                    numero: body.numero ?? inv.numero, invoice_type: body.invoice_type ?? inv.invoice_type,
                    cae: body.cae ?? inv.cae, issued_at: body.issued_at ? new Date(body.issued_at).toISOString() : inv.issued_at,
                });
                return json(res, { success: true, invoice: inv });
            }
        }
        {
            const m = p.match(/^\/admin\/invoices\/(\d+)\/link-payment$/);
            if (m && req.method === 'POST') {
                const body = await readJsonBody(req); const inv = invoiceById(m[1]); const pay = paymentById(body.payment_id);
                if (!pay) return json(res, { success: false, error: 'Pago no encontrado' }, 404);
                if (pay.invoice_id) return json(res, { success: false, error: 'Ese pago ya tiene una factura asociada' }, 400);
                inv.payment_id = pay.id; pay.invoice_id = inv.id; pay.invoice_pdf = inv.pdf_url; pay.invoice_numero = inv.numero;
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/invoices\/(\d+)\/unlink-payment$/);
            if (m && req.method === 'POST') {
                const inv = invoiceById(m[1]);
                if (inv) { const pay = paymentById(inv.payment_id); inv.payment_id = null; if (pay) { pay.invoice_id = null; pay.invoice_pdf = null; pay.invoice_numero = null; } }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/admin\/invoices\/(\d+)\/pdf$/);
            if (m && req.method === 'GET') {
                const inv = invoiceById(m[1]);
                if (!inv || !inv.pdf_url) return json(res, { success: false, error: 'Sin PDF' }, 404);
                const fakePdf = Buffer.from('%PDF-1.4 stub invoice pdf\n%%EOF');
                res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': fakePdf.length });
                return res.end(fakePdf);
            }
        }

        // ── Feriados ──
        if (p === '/admin/feriados' && req.method === 'GET') {
            const year = q.get('year');
            let rows = FERIADOS.slice();
            if (year) rows = rows.filter((f) => new Date(f.fecha).getUTCFullYear() === Number(year));
            rows.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
            return json(res, { success: true, feriados: rows });
        }
        if (p === '/admin/feriados' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const dup = FERIADOS.find((f) => f.fecha.slice(0, 10) === body.fecha);
            if (dup) return json(res, { success: false, error: 'Ya existe un feriado en esa fecha' }, 409);
            const row = { id: nextFeriadoId++, fecha: new Date(body.fecha).toISOString(), motivo: body.motivo || null };
            FERIADOS.push(row);
            return json(res, { success: true, feriado: row });
        }
        {
            const m = p.match(/^\/admin\/feriados\/(\d+)$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const f = feriadoById(m[1]);
                if (!f) return json(res, { success: false, error: 'No encontrado' }, 404);
                const dup = FERIADOS.find((x) => x.id !== f.id && x.fecha.slice(0, 10) === body.fecha);
                if (dup) return json(res, { success: false, error: 'Ya existe un feriado en esa fecha' }, 409);
                f.fecha = new Date(body.fecha).toISOString(); f.motivo = body.motivo || null;
                return json(res, { success: true, feriado: f });
            }
            if (m && req.method === 'DELETE') {
                const idx = FERIADOS.findIndex((x) => x.id === Number(m[1]));
                if (idx >= 0) FERIADOS.splice(idx, 1);
                return json(res, { success: true });
            }
        }

        // ── Monitor ──
        if (p === '/admin/monitor/stats' && req.method === 'GET') {
            return json(res, { success: true, stats: {
                partes_activas: MONITOR_PARTES.length,
                expedientes_confirmados: MONITOR_PARTES.reduce((a, x) => a + x.exp_confirmados, 0),
                novedades_pendientes: MONITOR_PARTES.reduce((a, x) => a + x.novedades_pendientes, 0),
                consultas_este_mes: 34,
            } });
        }
        if (p === '/admin/monitor/partes' && req.method === 'GET') return json(res, { success: true, partes: MONITOR_PARTES });

        // ── Legal ──
        if (p === '/legal/admin/documents' && req.method === 'GET') return json(res, { success: true, documents: LEGAL_DOCS });
        if (p === '/legal/admin/documents' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const row = { id: nextLegalId++, type: body.type, version: body.version, title: body.title,
                html_content: body.html_content || '', summary_of_changes: body.summary_of_changes || '',
                effective_date: body.effective_date || null, requires_acceptance: !!body.requires_acceptance,
                is_current: false, acceptance_count: 0, created_at: new Date().toISOString() };
            LEGAL_DOCS.push(row);
            return json(res, { success: true, document: row });
        }
        {
            const m = p.match(/^\/legal\/admin\/documents\/(\d+)$/);
            if (m && req.method === 'GET') {
                const d = legalById(m[1]);
                if (!d) return json(res, { success: false, error: 'No encontrado' }, 404);
                return json(res, { success: true, document: d });
            }
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const d = legalById(m[1]);
                if (!d) return json(res, { success: false, error: 'No encontrado' }, 404);
                Object.assign(d, { version: body.version, title: body.title, html_content: body.html_content,
                    summary_of_changes: body.summary_of_changes, effective_date: body.effective_date,
                    requires_acceptance: !!body.requires_acceptance });
                return json(res, { success: true, document: d });
            }
            if (m && req.method === 'DELETE') {
                const idx = LEGAL_DOCS.findIndex((x) => x.id === Number(m[1]));
                if (idx >= 0) {
                    if (LEGAL_DOCS[idx].is_current) return json(res, { success: false, error: 'No se puede eliminar un documento publicado' }, 400);
                    LEGAL_DOCS.splice(idx, 1);
                }
                return json(res, { success: true });
            }
        }
        {
            const m = p.match(/^\/legal\/admin\/documents\/(\d+)\/publish$/);
            if (m && req.method === 'PUT') {
                const d = legalById(m[1]);
                if (!d) return json(res, { success: false, error: 'No encontrado' }, 404);
                LEGAL_DOCS.filter((x) => x.type === d.type && x.id !== d.id).forEach((x) => { x.is_current = false; });
                d.is_current = true;
                return json(res, { success: true, notified: USERS.filter((u) => u.registration_status === 'active').length });
            }
        }
        {
            const m = p.match(/^\/legal\/admin\/documents\/(\d+)\/stats$/);
            if (m && req.method === 'GET') {
                const d = legalById(m[1]);
                const total = d ? d.acceptance_count : 0;
                return json(res, { success: true, total_users: total + 1, accepted_count: total,
                    acceptances: USERS.slice(0, total).map((u) => ({ email: u.email, nombre: u.nombre || '', accepted_at: d ? d.effective_date : null })) });
            }
        }

        // ── Métricas / Analytics ──
        if (p === '/analytics/data' && req.method === 'GET') {
            return json(res, { success: true,
                summary: { sessions: 120, events: 340, total_cta_clicks: 28, registros: 6 },
                funnel: { total_sessions: 120, vio_planes: 80, click_plan: 28, registros: 6 },
                byLabel: [{ label: 'COMBO_PROMO', total: 18 }, { label: 'EXTENSION_PROMO', total: 10 }],
                referrers: [{ fuente: 'directo', sessions: 70 }, { fuente: 'instagram', sessions: 50 }],
            });
        }

        // ── Diagnóstico ──
        if (p === '/admin/smoke-tests/latest' && req.method === 'GET') return json(res, { success: true, results: { api: null, pjn: null, extension: null } });
        if (p === '/admin/smoke-tests/run-api' && req.method === 'POST') {
            await readBody(req);
            const result = { ok: true, passed: 8, total: 8, timestamp: new Date().toISOString(), duration: 1200,
                logs: ['[stub] ▶ Corriendo checks...', '✅ health', '✅ landing', '✅ portal', '[stub] RESULTADO: 8/8'] };
            return json(res, { success: true, result });
        }
        if (p === '/admin/diagnostics/verification/latest' && req.method === 'GET') {
            const ultimaVezOk = {};
            for (const entry of VERIF_STATE.history) {
                for (const f of (entry.flujos || [])) {
                    if (f.estado === 'ok' && !ultimaVezOk[f.clave]) ultimaVezOk[f.clave] = entry.timestamp;
                }
            }
            return json(res, { success: true, latest: VERIF_STATE.latest, history: VERIF_STATE.history, ultimaVezOk });
        }
        if (p === '/admin/diagnostics/verification/quota' && req.method === 'GET') {
            return json(res, { success: true, cupo: VERIF_CUPO });
        }
        if (p === '/admin/diagnostics/verification/quota/top-up' && req.method === 'POST') {
            await readBody(req);
            if (VERIF_CUPO.alcanzaParaReserva) return json(res, { success: true, aplicado: false, motivo: 'ya_alcanza', cupo: VERIF_CUPO });
            const aplicados = [];
            const s = VERIF_CUPO.submodulos.informe;
            const faltanteS = Math.max(0, s.costoPorPrueba * VERIF_CUPO.reservaObjetivo - s.remaining);
            if (faltanteS > 0) { s.bonus += faltanteS; s.remaining += faltanteS; aplicados.push({ subsistema: 'informe', sumado: faltanteS }); }
            const g = VERIF_CUPO.global;
            const faltanteG = Math.max(0, g.costoPorPrueba * VERIF_CUPO.reservaObjetivo - g.remaining);
            if (faltanteG > 0) { g.limit += faltanteG; g.remaining += faltanteG; aplicados.push({ subsistema: 'global', sumado: faltanteG }); }
            VERIF_CUPO.alcanzaParaReserva = true;
            return json(res, { success: true, aplicado: true, aplicados, recortados: [], cupo: VERIF_CUPO });
        }

        // ── Scripts ──
        if (p === '/admin/scripts' && req.method === 'GET') return json(res, { success: true, scripts: SCRIPTS });
        {
            const m = p.match(/^\/admin\/scripts\/([\w.-]+)\/toggle$/);
            if (m && req.method === 'PUT') {
                const body = await readJsonBody(req); const s = SCRIPTS.find((x) => x.script_name === m[1]);
                if (s) s.active = !!body.active;
                return json(res, { success: true });
            }
        }
        if (p === '/admin/cache/warmup' && req.method === 'POST') { await readBody(req); return json(res, { success: true }); }
        if (p === '/admin/cache/clear' && req.method === 'POST') { await readBody(req); return json(res, { success: true }); }
        if (p === '/admin/scripts/reencrypt' && req.method === 'POST') {
            await readBody(req);
            SCRIPTS.forEach((s) => { s.updated_at = new Date().toISOString(); });
            return json(res, { success: true });
        }

        // ── Catch-all: cualquier otro /admin/* (y /legal/admin/*) devuelve un
        //    shape "vacío pero completo" — cualquier ruta que no haya sido
        //    mapeada arriba (por ejemplo /admin/users/:id/payments|invoices,
        //    que V2a dejó sin estado propio a propósito). ──
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
            await readBody(req);
            return json(res, { success: true });
        }
        if (p.startsWith('/admin/') || p.startsWith('/legal/')) {
            return json(res, {
                success: true, data: [], users: [], tickets: [], payments: [], invoices: [],
                plans: [], feriados: [], results: [], items: [], documents: [], total: 0, count: 0,
            });
        }

        if (p === '/assets/brand-icon.png') return serveFile(res, path.join(PUBLIC_DIR, 'assets', 'brand-icon.png'));

        if (p === '/' || p === '/dashboard/' || p === '/dashboard')
            return serveFile(res, path.join(DASHBOARD_DIR, 'index.html'));

        return serveFile(res, path.join(DASHBOARD_DIR, path.basename(p)));
    } catch (e) {
        console.error('stub-dashboard error:', e);
        return json(res, { success: false, error: String(e) }, 500);
    }
}).listen(PORT, () => console.log(`stub-dashboard en http://localhost:${PORT}/dashboard/`));
