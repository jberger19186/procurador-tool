// dev-tools/stub-portal.js — Servidor mínimo para verificar el portal de usuarios
// (public/usuarios/) en un navegador real, SIN backend ni DB reales.
//
// Sirve los archivos REALES del repo (index.html/app.js/app.css tal como están en
// el working tree, no una copia) y falsea la API con lo mínimo que el SPA necesita
// para arrancar: login, /client/account y los endpoints de Bitácora/Mis Expedientes
// devolviendo listas vacías. No usar para probar el BACKEND — eso es el bloque V3
// del plan (docs/internal/plan-verificacion-runtime-2026-08-23.md), que va contra
// staging por HTTP real.
//
// Uso: node backend-server/dev-tools/stub-portal.js [puerto]
//   → abrir http://localhost:<puerto>/usuarios/
//
// Ver .claude/skills/verify/SKILL.md para el recetario completo (cómo sembrar
// localStorage, por qué usar Playwright y no el Browser pane para teclado/capturas).

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORTAL_DIR = path.join(PUBLIC_DIR, 'usuarios');
const PORT = parseInt(process.argv[2], 10) || 5188;

// Cuenta de prueba devuelta por /client/account. Editar acá si un bloque de
// verificación necesita otro plan/estado (ej. sin bitacoraEnabled, sin pago).
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

    if (req.method === 'POST' && p === '/auth/portal-login') {
        return req.on('data', () => {}).on('end', () =>
            json(res, { success: true, token: 'STUB.TOKEN.' + Date.now() }));
    }
    if (req.method === 'POST') return req.on('data', () => {}).on('end', () => json(res, { success: true }));

    if (p === '/client/account')                    return json(res, ACCOUNT);
    if (p === '/client/notifications')              return json(res, { success: true, notifications: [], unread: 0 });
    if (p === '/usuarios/api/plans')                return json(res, { success: true, plans: [] });
    if (p === '/usuarios/api/subscription/current') return json(res, { success: true, subscription: {} });
    // Bitácora/Mis Expedientes/Monitor/tickets: lo que el SPA lee al renderizar
    // cada sección son listas — devolver vacío alcanza para levantar la UI.
    // El portal no llama solo a /usuarios/api/* y /client/* — el Monitor de
    // Partes usa /monitor/* directo y Soporte usa /tickets directo. Confirmado
    // conduciendo las 9 secciones con Playwright (2026-08-24): sin estos 2
    // prefijos, esas 2 secciones tiran un 404 a la consola al abrirlas.
    if (p.startsWith('/usuarios/api/') || p.startsWith('/client/') || p.startsWith('/monitor/') || p.startsWith('/tickets'))
        return json(res, { success: true, data: [], entradas: [], expedientes: [], avisos: [], sugerencias: [], partes: [], tickets: [] });

    if (p === '/assets/brand-icon.png') return serveFile(res, path.join(PUBLIC_DIR, 'assets', 'brand-icon.png'));

    if (p === '/' || p === '/usuarios/' || p === '/usuarios')
        return serveFile(res, path.join(PORTAL_DIR, 'index.html'));

    return serveFile(res, path.join(PORTAL_DIR, path.basename(p)));
}).listen(PORT, () => console.log(`stub-portal en http://localhost:${PORT}/usuarios/`));
