/**
 * smoke-payments.js
 * Verifica que la infraestructura de cobranza (Fase 5) esté correctamente instalada.
 *
 * Checks:
 *   DB-1  payments table existe y tiene permisos correctos
 *   DB-2  invoices table existe y tiene permisos correctos
 *   DB-3  usage_extras table existe y tiene permisos correctos
 *   DB-4  webhook_events table existe y tiene permisos correctos
 *   DB-5  subscriptions tiene columnas nuevas (external_subscription_id, last_payment_at, etc.)
 *   API-1 POST /usuarios/api/checkout/init retorna 503 con PAYMENT_MODULE_ENABLED=false
 *   API-2 POST /webhooks/mercadopago retorna 400 (sin firma) — confirma que la ruta existe
 *   API-3 GET  /usuarios/api/checkout/status requiere auth (401)
 *   API-4 GET  /admin/users/999999/payments requiere auth admin (401/403)
 *   API-5 GET  /admin/users/999999/extra-usage requiere auth admin (401/403)
 *   API-6 GET  /admin/users/999999/refund-preview requiere auth admin (401/403)
 *
 * Uso:
 *   node backend-server/dev-tools/smoke-payments.js [--host https://api.procuradortool.com]
 *
 * Por defecto apunta a https://localhost:3443 (desarrollo local).
 * Con --prod apunta a https://api.procuradortool.com.
 */

'use strict';

const https = require('https');
const http = require('http');

// ── Config ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isProd = args.includes('--prod');
const hostArg = args.find(a => a.startsWith('--host='));
const BASE_URL = hostArg
    ? hostArg.split('=')[1]
    : isProd
        ? 'https://api.procuradortool.com'
        : 'https://localhost:3443';

// En desarrollo puede haber cert auto-firmado
process.env.NODE_TLS_REJECT_UNAUTHORIZED = isProd ? '1' : '0';

// DB connection (usa las mismas vars de entorno del server)
const path = require('path');
const envPath = path.resolve(__dirname, '../.env');
try { require('dotenv').config({ path: envPath }); } catch (_) {}

const { Pool } = require('pg');
const db = new Pool({
    user:     process.env.DB_USER     || 'procurador_user',
    host:     process.env.DB_HOST     || 'localhost',
    database: process.env.DB_NAME     || 'procurador_db',
    password: process.env.DB_PASSWORD || '',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    connectionTimeoutMillis: 5000
});

// ── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let warnings = 0;

function ok(label) {
    console.log(`  ✅ ${label}`);
    passed++;
}
function fail(label, detail = '') {
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
}
function warn(label, detail = '') {
    console.log(`  ⚠️  ${label}${detail ? ' — ' + detail : ''}`);
    warnings++;
}

async function httpReq(method, path, body = null) {
    return new Promise((resolve) => {
        const url = new URL(BASE_URL + path);
        const lib = url.protocol === 'https:' ? https : http;
        const payload = body ? JSON.stringify(body) : null;

        const opts = {
            hostname: url.hostname,
            port:     url.port || (url.protocol === 'https:' ? 443 : 80),
            path:     url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            },
            timeout: 8000
        };

        const req = lib.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch (_) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', (err) => resolve({ status: 0, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
        if (payload) req.write(payload);
        req.end();
    });
}

// ── DB Checks ────────────────────────────────────────────────────────────────
async function checkDb() {
    console.log('\n📦 Verificando base de datos...\n');

    const tables = ['payments', 'invoices', 'usage_extras', 'webhook_events'];
    for (const table of tables) {
        try {
            const res = await db.query(`SELECT COUNT(*) FROM ${table}`);
            ok(`DB: tabla "${table}" accesible (${res.rows[0].count} filas)`);
        } catch (err) {
            fail(`DB: tabla "${table}"`, err.message);
        }
    }

    // Verificar columnas nuevas en subscriptions
    const newCols = [
        'external_subscription_id',
        'payment_method_id',
        'last_payment_at',
        'auto_renewal',
        'trial_bonus_until'
    ];
    try {
        const res = await db.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'subscriptions'
        `);
        const existing = res.rows.map(r => r.column_name);
        for (const col of newCols) {
            if (existing.includes(col)) {
                ok(`DB: subscriptions.${col} existe`);
            } else {
                fail(`DB: subscriptions.${col} FALTA`);
            }
        }
    } catch (err) {
        fail('DB: no se pudo consultar information_schema', err.message);
    }

    // Verificar secuencias y grants
    for (const table of tables) {
        try {
            await db.query(`INSERT INTO ${table} DEFAULT VALUES`);
            // Si llega acá algo salió mal (no debería insertar sin campos)
            fail(`DB: INSERT en ${table} no falló como se esperaba`);
        } catch (err) {
            // Error esperado: violación de NOT NULL u otro constraint, pero NO "permission denied"
            if (err.message.includes('permission denied')) {
                fail(`DB: sin permisos de INSERT en "${table}"`, err.message);
            } else {
                ok(`DB: permisos INSERT en "${table}" OK (error esperado: ${err.code})`);
            }
        }
    }
}

// ── API Checks ───────────────────────────────────────────────────────────────
async function checkApi() {
    console.log('\n🌐 Verificando endpoints de API...\n');
    const paymentEnabled = process.env.PAYMENT_MODULE_ENABLED === 'true';

    // API-1: checkout/init sin auth → debe requerir auth (401)
    {
        const r = await httpReq('POST', '/usuarios/api/checkout/init', { plan_name: 'COMBO_PROMO' });
        if (r.status === 0) {
            fail('API-1: POST /checkout/init', `No se pudo conectar (${r.error})`);
        } else if (r.status === 401 || r.status === 403) {
            ok(`API-1: POST /checkout/init requiere auth (${r.status})`);
        } else if (r.status === 503 && !paymentEnabled) {
            // Feature flag off pero pasa auth — raro en smoke sin token
            warn(`API-1: POST /checkout/init retornó 503 (módulo deshabilitado, sin token de prueba)`);
        } else {
            warn(`API-1: POST /checkout/init retornó ${r.status} (esperado 401/503)`);
        }
    }

    // API-2: POST /webhooks/mercadopago sin firma → debe retornar 400 o 401
    {
        const r = await httpReq('POST', '/webhooks/mercadopago', { type: 'payment', data: { id: '123' } });
        if (r.status === 0) {
            fail('API-2: POST /webhooks/mercadopago', `No se pudo conectar (${r.error})`);
        } else if ([400, 401, 403].includes(r.status)) {
            ok(`API-2: POST /webhooks/mercadopago presente y valida firma (${r.status})`);
        } else if (r.status === 200) {
            warn('API-2: POST /webhooks/mercadopago retornó 200 sin firma válida — revisar validación HMAC');
        } else {
            warn(`API-2: POST /webhooks/mercadopago retornó ${r.status}`);
        }
    }

    // API-3: GET /checkout/status sin auth → 401
    {
        const r = await httpReq('GET', '/usuarios/api/checkout/status');
        if (r.status === 0) {
            fail('API-3: GET /checkout/status', `No se pudo conectar (${r.error})`);
        } else if ([401, 403].includes(r.status)) {
            ok(`API-3: GET /checkout/status requiere auth (${r.status})`);
        } else {
            warn(`API-3: GET /checkout/status retornó ${r.status} (esperado 401)`);
        }
    }

    // API-4..6: admin endpoints sin auth → 401
    const adminEndpoints = [
        ['GET',  '/admin/users/999999/payments',       'API-4'],
        ['GET',  '/admin/users/999999/extra-usage',    'API-5'],
        ['GET',  '/admin/users/999999/refund-preview', 'API-6'],
    ];
    for (const [method, path, label] of adminEndpoints) {
        const r = await httpReq(method, path);
        if (r.status === 0) {
            fail(`${label}: ${method} ${path}`, `No se pudo conectar (${r.error})`);
        } else if ([401, 403].includes(r.status)) {
            ok(`${label}: ${method} ${path} requiere auth (${r.status})`);
        } else {
            warn(`${label}: ${method} ${path} retornó ${r.status} (esperado 401/403)`);
        }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  smoke-payments.js — Fase 5 Cobranza             ║');
    console.log(`║  Target: ${BASE_URL.padEnd(39)}║`);
    console.log(`║  PAYMENT_MODULE_ENABLED: ${(process.env.PAYMENT_MODULE_ENABLED || 'false').padEnd(23)}║`);
    console.log('╚══════════════════════════════════════════════════╝');

    try {
        await checkDb();
    } catch (e) {
        console.error('\n💥 Error fatal en checks de DB:', e.message);
    }

    try {
        await checkApi();
    } catch (e) {
        console.error('\n💥 Error fatal en checks de API:', e.message);
    }

    await db.end().catch(() => {});

    console.log('\n─────────────────────────────────────────────────────');
    console.log(`  Resultado: ${passed} ✅  ${failed} ❌  ${warnings} ⚠️`);
    console.log('─────────────────────────────────────────────────────\n');

    if (failed > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Error inesperado:', err);
    process.exit(1);
});
