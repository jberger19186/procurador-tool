// dev-tools/stub-dashboard.js — Servidor mínimo para verificar el dashboard admin
// (public/dashboard/) en un navegador real, SIN backend ni DB reales.
//
// Sirve los archivos REALES del repo y falsea la API con lo mínimo que el SPA
// necesita: login admin + un catch-all genérico para /admin/* que devuelve listas
// vacías (el dashboard tiene ~30 endpoints distintos por sección; no vale la pena
// mantener uno por uno acá — si un bloque de verificación necesita un shape
// específico para una sección puntual, agregar el `if` antes del catch-all).
//
// El token de login es un JWT SINTÁCTICAMENTE VÁLIDO (header.payload.firma, sin
// verificar la firma en ningún lado): dashboard.js decodifica el payload en el
// cliente para el auto-restore de sesión (`JSON.parse(atob(token.split('.')[1]))`,
// exige `exp` futuro y `role==='admin'`) — sin eso, recargar la página con la
// sesión ya iniciada vuelve al login.
//
// Uso: node backend-server/dev-tools/stub-dashboard.js [puerto]
//   → abrir http://localhost:<puerto>/dashboard/
//
// Ver .claude/skills/verify/SKILL.md para el recetario completo.

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

http.createServer((req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname;
    console.log(req.method, p);

    if (req.method === 'POST' && p === '/auth/admin-login') {
        return req.on('data', () => {}).on('end', () =>
            json(res, { success: true, token: FAKE_TOKEN, user: { id: 1, email: 'admin@stub.local', role: 'admin' } }));
    }

    if (p === '/admin/stats/overview')
        return json(res, { success: true, users: 0, activeSubscriptions: 0, openTickets: 0 });

    // Catch-all: cualquier otro /admin/* (y /legal/admin/*, que la sección Legal
    // llama directo sin el prefijo /admin) devuelve un shape "vacío pero completo"
    // para las formas más comunes que las secciones esperan (arrays y contadores).
    // Confirmado conduciendo las 12 secciones con Playwright (2026-08-24).
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        return req.on('data', () => {}).on('end', () => json(res, { success: true }));
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
}).listen(PORT, () => console.log(`stub-dashboard en http://localhost:${PORT}/dashboard/`));
