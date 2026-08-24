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

        if (p === '/admin/stats/overview')
            return json(res, { success: true, users: USERS.length, activeSubscriptions: USERS.filter((x) => x.status === 'active').length, openTickets: TICKETS.filter((t) => t.status === 'open').length });

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

        // ── Pagos / facturas del usuario (listas — V2b las expande) ──
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/payments$/);
            if (m && req.method === 'GET') return json(res, { success: true, payments: [] });
        }
        {
            const m = p.match(/^\/admin\/users\/(\d+)\/invoices$/);
            if (m && req.method === 'GET') return json(res, { success: true, invoices: [] });
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
            return json(res, { success: true, tickets: rows });
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

        // ── Catch-all: cualquier otro /admin/* (y /legal/admin/*) devuelve un
        //    shape "vacío pero completo" — V2b (Pagos, Facturación, Feriados,
        //    Monitor, Legal, Métricas, Diagnóstico, Scripts) todavía no tiene
        //    estado propio acá. ──
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
