/**
 * Legal system integration tests — runs DB-level checks + HTTP checks
 * Run from: /var/www/procurador/backend-server
 */
const { Pool } = require('pg');
require('dotenv').config();
const https = require('https');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT
});

let passed = 0; let failed = 0;

function ok(label) { console.log('  ✅', label); passed++; }
function fail(label, detail) { console.log('  ❌', label, detail||''); failed++; }

function httpGet(path) {
    return new Promise((res, rej) => {
        const req = https.get({ host: 'localhost', port: 3443, path, rejectUnauthorized: false }, r => {
            let body = '';
            r.on('data', d => body += d);
            r.on('end', () => res({ status: r.statusCode, body, headers: r.headers }));
        });
        req.on('error', rej);
        req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    });
}

function httpPost(path, payload, token) {
    return new Promise((res, rej) => {
        const data = JSON.stringify(payload);
        const opts = {
            host: 'localhost', port: 3443, path, method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...(token ? { 'Authorization': 'Bearer ' + token } : {})
            }
        };
        const req = https.request(opts, r => {
            let body = '';
            r.on('data', d => body += d);
            r.on('end', () => res({ status: r.statusCode, body: JSON.parse(body||'{}'), headers: r.headers }));
        });
        req.on('error', rej);
        req.write(data);
        req.end();
    });
}

(async () => {
    console.log('\n🔍 Legal Versioning System — Integration Tests\n');

    // ── TEST 1: DB — legal_documents has 2 current rows
    console.log('1. DB: legal_documents seeded correctly');
    try {
        const r = await pool.query('SELECT type,version,is_current,requires_acceptance FROM legal_documents WHERE is_current=true ORDER BY type');
        if (r.rows.length === 2) ok(`2 current documents (tyc + pyp)`);
        else fail(`Expected 2 current docs, got ${r.rows.length}`);
        const types = r.rows.map(x => x.type).sort();
        if (JSON.stringify(types) === '["pyp","tyc"]') ok('Both types present (tyc, pyp)');
        else fail('Missing types', JSON.stringify(types));
        if (r.rows.every(x => x.requires_acceptance)) ok('Both require acceptance');
        else fail('requires_acceptance not set correctly');
    } catch(e) { fail('DB query failed', e.message); }

    // ── TEST 2: HTTP — GET /legal/page?type=tyc
    console.log('\n2. HTTP: GET /legal/page?type=tyc');
    try {
        const r = await httpGet('/legal/page?type=tyc');
        if (r.status === 200) ok('HTTP 200');
        else fail(`Expected 200, got ${r.status}`);
        if (r.body.includes('Términos y Condiciones')) ok('Contains expected title text');
        else fail('Expected title not found in response');
        if (r.headers['cache-control'] === 'no-store') ok('Cache-Control: no-store set');
        else fail('Cache-Control header missing', r.headers['cache-control']);
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 3: HTTP — GET /legal/page?type=pyp
    console.log('\n3. HTTP: GET /legal/page?type=pyp');
    try {
        const r = await httpGet('/legal/page?type=pyp');
        if (r.status === 200) ok('HTTP 200');
        else fail(`Expected 200, got ${r.status}`);
        if (r.body.includes('Política de Privacidad')) ok('Contains expected title text');
        else fail('Title not found');
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 4: HTTP — Invalid type returns 400
    console.log('\n4. HTTP: GET /legal/page?type=invalid → 400');
    try {
        const r = await httpGet('/legal/page?type=hacker');
        if (r.status === 400) ok('HTTP 400 for invalid type');
        else fail(`Expected 400, got ${r.status}`);
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 5: HTTP — /terminos/ served dynamically (from DB)
    console.log('\n5. HTTP: GET /terminos/ dynamic');
    try {
        const r = await httpGet('/terminos/');
        if (r.status === 200) ok('HTTP 200');
        else fail(`Expected 200, got ${r.status}`);
        if (r.headers['cache-control'] === 'no-store') ok('Cache-Control: no-store');
        else fail('Cache-Control missing', r.headers['cache-control']);
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 6: HTTP — /privacidad/ served dynamically
    console.log('\n6. HTTP: GET /privacidad/ dynamic');
    try {
        const r = await httpGet('/privacidad/');
        if (r.status === 200) ok('HTTP 200');
        else fail(`Expected 200, got ${r.status}`);
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 7: HTTP — /legal/accept/ page loads
    console.log('\n7. HTTP: GET /legal/accept/');
    try {
        const r = await httpGet('/legal/accept/');
        if (r.status === 200) ok('HTTP 200');
        else fail(`Expected 200, got ${r.status}`);
        if (r.body.includes('Aceptar Documentos Legales')) ok('Accept page title found');
        else fail('Page title not found');
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 8: HTTP — /legal/pending without token → 401
    console.log('\n8. HTTP: GET /legal/pending without token → 401');
    try {
        const r = await httpGet('/legal/pending');
        if (r.status === 401) ok('HTTP 401 (unauthenticated)');
        else fail(`Expected 401, got ${r.status}`);
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 9: HTTP — /legal/admin/documents without token → 401
    console.log('\n9. HTTP: GET /legal/admin/documents without token → 401');
    try {
        const r = await httpGet('/legal/admin/documents');
        if (r.status === 401) ok('HTTP 401 (unauthenticated)');
        else fail(`Expected 401, got ${r.status}`);
    } catch(e) { fail('HTTP request failed', e.message); }

    // ── TEST 10: DB — Admin login + /legal/pending flow
    console.log('\n10. Login + /legal/pending check for test user');
    try {
        // Login as test user
        const loginRes = await httpPost('/auth/login', { email: 'test@example.com', password: 'test1234', machineId: 'test-machine' });
        if (loginRes.status !== 200) {
            fail('Login failed (test@example.com)', `HTTP ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
        } else {
            ok('Login successful');
            const token = loginRes.body.token || loginRes.body.access_token;
            if (!token) { fail('No token in response'); }
            else {
                // Check pending
                const pendOpts = {
                    host: 'localhost', port: 3443, path: '/legal/pending',
                    rejectUnauthorized: false,
                    headers: { 'Authorization': 'Bearer ' + token }
                };
                const pendRes = await new Promise((res, rej) => {
                    const req = https.get(pendOpts, r => {
                        let body = '';
                        r.on('data', d => body += d);
                        r.on('end', () => res({ status: r.statusCode, body: JSON.parse(body||'{}') }));
                    });
                    req.on('error', rej);
                });
                if (pendRes.status === 200) ok('GET /legal/pending → 200');
                else fail('GET /legal/pending failed', `${pendRes.status}`);

                const pending = pendRes.body.pending || [];
                if (pending.length === 2) ok(`2 pending docs returned (tyc + pyp)`);
                else fail(`Expected 2 pending, got ${pending.length}`, JSON.stringify(pending));

                // Accept all
                const acceptRes = await httpPost('/legal/accept', {}, token);
                if (acceptRes.status === 200 && acceptRes.body.success) ok('POST /legal/accept → success');
                else fail('POST /legal/accept failed', JSON.stringify(acceptRes.body));
                if (acceptRes.body.accepted === 2) ok('Accepted count = 2');
                else fail(`Expected accepted=2, got ${acceptRes.body.accepted}`);

                // Check DB
                const dbCheck = await pool.query(
                    'SELECT COUNT(*) FROM user_legal_acceptances WHERE user_id=(SELECT id FROM users WHERE email=$1)',
                    ['test@example.com']
                );
                if (parseInt(dbCheck.rows[0].count) === 2) ok('2 acceptance rows in DB');
                else fail(`Expected 2 DB rows, got ${dbCheck.rows[0].count}`);

                // legal_pending_since should be NULL
                const userCheck = await pool.query(
                    'SELECT legal_pending_since,legal_suspended FROM users WHERE email=$1',
                    ['test@example.com']
                );
                if (!userCheck.rows[0].legal_pending_since) ok('legal_pending_since cleared');
                else fail('legal_pending_since not cleared');
                if (!userCheck.rows[0].legal_suspended) ok('legal_suspended = false');
                else fail('legal_suspended should be false');

                // Second call to pending should return 0
                const pend2 = await new Promise((res, rej) => {
                    const req = https.get({ ...pendOpts }, r => {
                        let body = '';
                        r.on('data', d => body += d);
                        r.on('end', () => res({ status: r.statusCode, body: JSON.parse(body||'{}') }));
                    });
                    req.on('error', rej);
                });
                if ((pend2.body.pending||[]).length === 0) ok('No more pending after acceptance');
                else fail('Still pending after acceptance');

                // Idempotence: accept again → accepted=0
                const accept2 = await httpPost('/legal/accept', {}, token);
                if (accept2.body.accepted === 0) ok('Accept idempotent (second call = 0 accepted)');
                else fail(`Expected 0 on second call, got ${accept2.body.accepted}`);
            }
        }
    } catch(e) { fail('Flow test error', e.message); }

    // ── TEST 11: DB — Cleanup test acceptances
    console.log('\n11. Cleanup: remove test acceptances');
    try {
        await pool.query(
            'DELETE FROM user_legal_acceptances WHERE user_id=(SELECT id FROM users WHERE email=$1)',
            ['test@example.com']
        );
        ok('Test acceptances cleaned up');
    } catch(e) { fail('Cleanup failed', e.message); }

    await pool.end();
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
})();
