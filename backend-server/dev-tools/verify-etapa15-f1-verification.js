/**
 * verify-etapa15-f1-verification.js — Etapa 1.5, F1 (modelo flujos[] + endpoint de reporte).
 *
 * Ejercita POST /admin/diagnostics/verification/report y GET .../latest con HTTP real
 * contra localhost:3444 (bypassa nginx/basic-auth, corre EN el servidor de staging).
 * Cubre: validaciones del POST, el modelo flujos[] con sus 3 estados, el default de
 * `cuenta`/`origen`, "última vez OK" por flujo, y la conversión al vuelo del formato
 * viejo (procuracion/informe sueltos) al nuevo — la parte más delicada de F1, porque
 * si se rompe se pierde la lectura del único reporte histórico real (14/07/2026).
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-etapa15-f1-verification.js dotenv_config_path=.env.staging
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`❌ ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging". ` +
        'Este script solo debe correr contra la base de staging.');
    process.exit(1);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE_URL = 'https://localhost:3444';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('❌ Falta JWT_SECRET en el entorno.'); process.exit(1); }

// El archivo real que tocan ambos endpoints — se maneja directo para el caso de
// backward-compat (sembrar un registro viejo) y para dejar staging exactamente
// como estaba al terminar (staging no tenía este archivo antes de esta corrida).
const VERIFICATION_FILE = path.join(__dirname, '..', 'data', 'verification-results.json');
const existiaAntes = fs.existsSync(VERIFICATION_FILE);
const contenidoOriginal = existiaAntes ? fs.readFileSync(VERIFICATION_FILE, 'utf8') : null;

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`✅ ${name}`); }
    else { failed++; fails.push(name); console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function request(method, urlPath, { token, body } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const payload = body ? JSON.stringify(body) : null;
        if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
        const req = https.request(BASE_URL + urlPath, { method, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
                resolve({ status: res.statusCode, body: json });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function tokenAdmin() {
    return jwt.sign({ id: 6, email: 'admin@procurador.com', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}

async function main() {
    console.log(`▶ Etapa 1.5 F1 — verificación funcional PJN, contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);
    const tokenA = tokenAdmin();

    try {
        // ── 1. Sin token → 401 en ambos endpoints ───────────────────────────
        let r = await request('GET', '/admin/diagnostics/verification/latest');
        check('1. GET /latest sin token → 401', r.status === 401, `status=${r.status}`);

        r = await request('POST', '/admin/diagnostics/verification/report', { body: { estado: 'ok', flujos: [] } });
        check('2. POST /report sin token → 401', r.status === 401, `status=${r.status}`);

        // ── 3-6. Validaciones del POST ───────────────────────────────────────
        r = await request('POST', '/admin/diagnostics/verification/report', { token: tokenA, body: { estado: 'inventado', flujos: [{ clave: 'proc', estado: 'ok' }] } });
        check('3. estado inválido → 400', r.status === 400, `status=${r.status}`);

        r = await request('POST', '/admin/diagnostics/verification/report', { token: tokenA, body: { estado: 'ok', flujos: [] } });
        check('4. flujos vacío → 400', r.status === 400, `status=${r.status}`);

        r = await request('POST', '/admin/diagnostics/verification/report', { token: tokenA, body: { estado: 'ok', flujos: [{ clave: 'flujo_inventado', estado: 'ok' }] } });
        check('5. clave de flujo inválida → 400', r.status === 400, `status=${r.status}`);

        r = await request('POST', '/admin/diagnostics/verification/report', { token: tokenA, body: { estado: 'ok', flujos: [{ clave: 'proc', estado: 'estado_inventado' }] } });
        check('6. estado de flujo inválido → 400', r.status === 400, `status=${r.status}`);

        // ── 7-9. Reporte real, los 5 flujos + un 'omitido' ──────────────────
        r = await request('POST', '/admin/diagnostics/verification/report', {
            token: tokenA,
            body: {
                estado: 'parcial',
                tiempoTotalMs: 640000,
                flujos: [
                    { clave: 'proc', estado: 'ok', tiempoMs: 41200, detalle: '2/2 exitosos' },
                    { clave: 'batch', estado: 'ok', detalle: '2/2 exitosos' },
                    { clave: 'informe', estado: 'ok', detalle: 'PDF 4 páginas' },
                    { clave: 'informe_lote', estado: 'omitido', detalle: 'sin cupo de informes' },
                    { clave: 'monitor', estado: 'ok', detalle: '3/3 partes, 0 novedades' },
                ],
                notas: 'Corrida de prueba del harness F1.',
            }
        });
        check('7. Reporte válido con 5 flujos → 200', r.status === 200, `status=${r.status}`);
        check('8. El flujo "omitido" se guarda tal cual (no se confunde con error)',
            r.body?.entry?.flujos?.find(f => f.clave === 'informe_lote')?.estado === 'omitido');
        check('9. Defaults aplicados: cuenta=27320694359, origen=computer-use',
            r.body?.entry?.cuenta === '27320694359' && r.body?.entry?.origen === 'computer-use',
            JSON.stringify({ cuenta: r.body?.entry?.cuenta, origen: r.body?.entry?.origen }));

        const nombreEsperado = r.body?.entry?.flujos?.find(f => f.clave === 'monitor')?.nombre;
        check('10. El nombre del flujo se resuelve server-side (no lo manda el cliente)',
            nombreEsperado === 'Monitor — novedades', `nombre="${nombreEsperado}"`);

        // ── 11. GET /latest refleja el reporte recién posteado ──────────────
        r = await request('GET', '/admin/diagnostics/verification/latest', { token: tokenA });
        check('11. GET /latest → 200 y refleja el último reporte', r.status === 200 && r.body?.latest?.estado === 'parcial');
        check('12. GET /latest → ultimaVezOk trae "monitor" con timestamp',
            !!r.body?.ultimaVezOk?.monitor, JSON.stringify(r.body?.ultimaVezOk));
        check('13. GET /latest → ultimaVezOk NO trae "informe_lote" (el único reporte lo tuvo en omitido, nunca en ok)',
            !r.body?.ultimaVezOk?.informe_lote);

        // ── 14. Cuenta/origen explícitos se respetan cuando SÍ vienen ───────
        r = await request('POST', '/admin/diagnostics/verification/report', {
            token: tokenA,
            body: { estado: 'ok', origen: 'app-automatica', cuenta: '20999999999', flujos: [{ clave: 'proc', estado: 'ok' }] }
        });
        check('14. cuenta/origen explícitos se respetan', r.body?.entry?.cuenta === '20999999999' && r.body?.entry?.origen === 'app-automatica');

        // ── 15-17. Backward-compat: registro viejo (procuracion/informe sueltos) ──
        const rawAntes = JSON.parse(fs.readFileSync(VERIFICATION_FILE, 'utf8'));
        const registroViejo = {
            timestamp: '2026-07-14T14:49:05.804Z',
            estado: 'ok',
            tiempoTotalMs: 112531,
            procuracion: { ok: true, tiempoMs: 41188, error: null },
            informe: { ok: true, tiempoMs: 71342, error: null },
        };
        const rawConViejo = { latest: registroViejo, history: [registroViejo, ...rawAntes.history] };
        fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(rawConViejo, null, 2));

        r = await request('GET', '/admin/diagnostics/verification/latest', { token: tokenA });
        const latestNorm = r.body?.latest;
        check('15. Registro viejo se normaliza: trae flujos[] con clave "proc" y "informe"',
            Array.isArray(latestNorm?.flujos) && latestNorm.flujos.some(f => f.clave === 'proc') && latestNorm.flujos.some(f => f.clave === 'informe'),
            JSON.stringify(latestNorm?.flujos));
        check('16. Registro viejo normalizado: origen="app-automatica" (nunca pudo venir de otro lado)',
            latestNorm?.origen === 'app-automatica');
        check('17. Registro viejo normalizado: cuenta="27320694359" (única que el guard de client.js permitía)',
            latestNorm?.cuenta === '27320694359');

    } catch (e) {
        console.error('❌ Error inesperado en el harness:', e);
        failed++;
    } finally {
        console.log('\n🧹 Restaurando estado original del archivo...');
        if (existiaAntes) {
            fs.writeFileSync(VERIFICATION_FILE, contenidoOriginal);
            console.log('   verification-results.json restaurado a su contenido previo');
        } else {
            if (fs.existsSync(VERIFICATION_FILE)) fs.unlinkSync(VERIFICATION_FILE);
            console.log('   verification-results.json eliminado (no existía antes de esta corrida)');
        }
    }

    console.log(`\n${passed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.log('Fallidas:', fails.join(' | '));
        process.exit(1);
    }
}

main();
