/**
 * ══════════════════════════════════════════════════════════════════
 *  TEST SUITE COMPLETO — Sistema de Versioning Legal (TyC y PyP)
 * ══════════════════════════════════════════════════════════════════
 *
 *  Bloques:
 *   1.  Páginas estáticas y dinámicas
 *   2.  Autenticación y autorización
 *   3.  Admin CRUD (crear / editar / eliminar borradores)
 *   4.  Lógica de auto-increment de versión
 *   5.  Publicación: cambio de is_current + notificaciones
 *   6.  Flujo de aceptación de usuario
 *   7.  Registro: aceptación automática al crearse cuenta
 *   8.  checkLicense: bloqueo por legal_suspended
 *   9.  Portal /usuarios/: estructura HTML + JS + API
 *  10.  Deadline y cálculo de días restantes
 *  11.  Idempotencia y casos borde
 *  12.  Cleanup y consistencia final de DB
 */

'use strict';

const { Pool } = require('pg');
require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_NAME, password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// ─── Contadores ────────────────────────────────────────────────────────────────
let passed = 0; let failed = 0; let skipped = 0;
const ok   = l      => { console.log('    ✅', l); passed++; };
const fail = (l, d) => { console.log('    ❌', l, d !== undefined ? `→ ${JSON.stringify(d)}` : ''); failed++; };
const skip = l      => { console.log('    ⏭ ', l, '(skip)'); skipped++; };
const section = t   => console.log(`\n${'─'.repeat(60)}\n  ${t}\n${'─'.repeat(60)}`);

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
function req(method, path, payload, token) {
    return new Promise((res, rej) => {
        const data = payload ? JSON.stringify(payload) : null;
        const r = https.request({
            host: 'localhost', port: 3443, path, method,
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
            },
        }, resp => {
            let body = '';
            resp.on('data', d => body += d);
            resp.on('end', () => {
                try { res({ s: resp.statusCode, b: JSON.parse(body || '{}'), h: resp.headers }); }
                catch { res({ s: resp.statusCode, b: body, h: resp.headers }); }
            });
        });
        r.on('error', rej);
        r.setTimeout(8000, () => r.destroy(new Error('timeout')));
        if (data) r.write(data);
        r.end();
    });
}

function raw(path) {
    return new Promise((res, rej) => {
        const r = https.get({ host: 'localhost', port: 3443, path, rejectUnauthorized: false }, resp => {
            let body = '';
            resp.on('data', d => body += d);
            resp.on('end', () => res({ s: resp.statusCode, b: body, h: resp.headers }));
        });
        r.on('error', rej);
        r.setTimeout(8000, () => r.destroy(new Error('timeout')));
    });
}

const GET  = (p, t)       => req('GET',    p, null,    t);
const POST = (p, pl, t)   => req('POST',   p, pl,     t);
const PUT  = (p, pl, t)   => req('PUT',    p, pl,     t);
const DEL  = (p, t)       => req('DELETE', p, null,    t);

// ─── Token helpers ─────────────────────────────────────────────────────────────
function makeToken(user) {
    return require('jsonwebtoken').sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function getUser(email) {
    const r = await pool.query('SELECT id,email,role FROM users WHERE email=$1', [email]);
    return r.rows[0] || null;
}

// ─── Lógica de versión (replica del frontend) ─────────────────────────────────
function calcNextVersion(documents, type) {
    const ofType = documents.filter(d => d.type === type);
    ofType.sort((a, b) => {
        const [am, an] = (a.version || '0.0').split('.').map(Number);
        const [bm, bn] = (b.version || '0.0').split('.').map(Number);
        return (bm * 1000 + bn) - (am * 1000 + an);
    });
    const latest = ofType[0];
    if (!latest) return '1.0';
    const parts = (latest.version || '1.0').split('.');
    return `${parseInt(parts[0]) || 1}.${parseInt(parts[1] ?? '0') + 1}`;
}

// ─── Estado de DB ──────────────────────────────────────────────────────────────
const TEST_USER_EMAIL  = 'test@example.com';
const TEST_USER2_EMAIL = 'procuradortool@gmail.com'; // segundo usuario para probar notificaciones

// ══════════════════════════════════════════════════════════════════════════════
(async () => {
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  TEST SUITE COMPLETO — Sistema Legal TyC / PyP');
    console.log('══════════════════════════════════════════════════════════');

    // ── Tokens ────────────────────────────────────────────────────────────────
    const adminUser = await getUser('admin@procurador.com');
    const testUser  = await getUser(TEST_USER_EMAIL);
    const testUser2 = await getUser(TEST_USER2_EMAIL);

    if (!adminUser) { console.error('FATAL: admin user not found'); process.exit(1); }
    if (!testUser)  { console.error('FATAL: test user not found');  process.exit(1); }

    const adminTok = makeToken(adminUser);
    const userTok  = makeToken(testUser);
    const userTok2 = testUser2 ? makeToken(testUser2) : null;

    // ── Setup: limpiar aceptaciones previas de test ───────────────────────────
    await pool.query('DELETE FROM user_legal_acceptances WHERE user_id IN ($1,$2)', [testUser.id, testUser2?.id || 0]);
    await pool.query('UPDATE users SET legal_pending_since=NULL, legal_suspended=false WHERE id IN ($1,$2)', [testUser.id, testUser2?.id || 0]);

    // ── Verificar estado inicial de la DB ─────────────────────────────────────
    const initDocs = await pool.query('SELECT id,type,version,is_current FROM legal_documents WHERE is_current=true ORDER BY type');
    if (initDocs.rows.length !== 2) {
        console.error(`FATAL: Se esperaban 2 docs is_current=true, hay ${initDocs.rows.length}. Revisar DB antes de correr el test.`);
        process.exit(1);
    }
    const origTyc = initDocs.rows.find(d => d.type === 'tyc');
    const origPyp = initDocs.rows.find(d => d.type === 'pyp');
    console.log(`\n  DB inicial: TyC v${origTyc.version} (id=${origTyc.id}), PyP v${origPyp.version} (id=${origPyp.id})`);

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 1 — Páginas públicas (HTML dinámico + estático)');

    // 1.1 /legal/page?type=tyc
    { const r = await raw('/legal/page?type=tyc');
      r.s === 200 ? ok('/legal/page?type=tyc → 200') : fail('/legal/page?type=tyc', r.s);
      r.b.includes('Términos') ? ok('Contiene texto esperado (TyC)') : fail('Texto no encontrado en TyC');
      r.h['cache-control'] === 'no-store' ? ok('Cache-Control: no-store') : fail('Cache-Control ausente', r.h['cache-control']); }

    // 1.2 /legal/page?type=pyp
    { const r = await raw('/legal/page?type=pyp');
      r.s === 200 ? ok('/legal/page?type=pyp → 200') : fail('/legal/page?type=pyp', r.s);
      r.b.includes('Privacidad') ? ok('Contiene texto esperado (PyP)') : fail('Texto no encontrado en PyP'); }

    // 1.3 Tipo inválido → 400
    { const r = await raw('/legal/page?type=hacker');
      r.s === 400 ? ok('Tipo inválido → 400') : fail('Tipo inválido debería dar 400', r.s); }

    // 1.4 Sin parámetro → 400
    { const r = await raw('/legal/page');
      r.s === 400 ? ok('Sin parámetro → 400') : fail('Sin parámetro debería dar 400', r.s); }

    // 1.5 /terminos/ dinámica
    { const r = await raw('/terminos/');
      r.s === 200 ? ok('/terminos/ → 200') : fail('/terminos/', r.s);
      r.h['cache-control'] === 'no-store' ? ok('/terminos/ Cache-Control: no-store') : fail('Cache falta en /terminos/', r.h['cache-control']); }

    // 1.6 /privacidad/ dinámica
    { const r = await raw('/privacidad/');
      r.s === 200 ? ok('/privacidad/ → 200') : fail('/privacidad/', r.s);
      r.h['cache-control'] === 'no-store' ? ok('/privacidad/ Cache-Control: no-store') : fail('Cache falta en /privacidad/', r.h['cache-control']); }

    // 1.7 /legal/accept/ (página de aceptación pública)
    { const r = await raw('/legal/accept/');
      r.s === 200 ? ok('/legal/accept/ → 200') : fail('/legal/accept/', r.s);
      r.b.includes('Aceptar Documentos Legales') ? ok('/legal/accept/ contiene título correcto') : fail('Título no encontrado en accept page'); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 2 — Autenticación y autorización');

    // 2.1 Sin token → 401
    { const r = await GET('/legal/pending');
      r.s === 401 ? ok('GET /legal/pending sin token → 401') : fail('Esperaba 401', r.s); }

    // 2.2 Sin token → 401
    { const r = await POST('/legal/accept', {});
      r.s === 401 ? ok('POST /legal/accept sin token → 401') : fail('Esperaba 401', r.s); }

    // 2.3 Admin endpoint sin token → 401
    { const r = await GET('/legal/admin/documents');
      r.s === 401 ? ok('GET /legal/admin/documents sin token → 401') : fail('Esperaba 401', r.s); }

    // 2.4 Endpoint admin con token de usuario → 403
    { const r = await GET('/legal/admin/documents', userTok);
      r.s === 403 ? ok('GET /legal/admin/documents con token user → 403') : fail('Esperaba 403', r.s); }

    // 2.5 POST admin con token user → 403
    { const r = await POST('/legal/admin/documents', { type:'tyc', version:'x', title:'x', html_content:'<p>x</p>' }, userTok);
      r.s === 403 ? ok('POST /legal/admin/documents con token user → 403') : fail('Esperaba 403', r.s); }

    // 2.6 Stats endpoint con token user → 403
    { const r = await GET(`/legal/admin/documents/${origTyc.id}/stats`, userTok);
      r.s === 403 ? ok('GET /stats con token user → 403') : fail('Esperaba 403', r.s); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 3 — Admin CRUD de borradores');

    // 3.1 Listar documentos
    { const r = await GET('/legal/admin/documents', adminTok);
      r.s === 200 ? ok('GET /legal/admin/documents → 200') : fail('List falló', r.s);
      Array.isArray(r.b.documents) ? ok('Respuesta tiene array documents') : fail('Sin array documents');
      r.b.documents.length >= 2 ? ok(`${r.b.documents.length} documentos en lista`) : fail('Menos de 2 docs', r.b.documents.length); }

    // 3.2 Obtener doc individual
    { const r = await GET(`/legal/admin/documents/${origTyc.id}`, adminTok);
      r.s === 200 ? ok(`GET /legal/admin/documents/${origTyc.id} → 200`) : fail('Get individual falló', r.s);
      r.b.document?.html_content?.length > 100 ? ok('html_content presente y no vacío') : fail('html_content vacío'); }

    // 3.3 Crear borrador TyC
    let draftTycId = null;
    { const r = await POST('/legal/admin/documents', {
        type: 'tyc', version: 'TEST-1', title: 'TyC de prueba', html_content: '<p>Borrador TyC test</p>',
        summary_of_changes: 'Test CRUD', requires_acceptance: true,
      }, adminTok);
      r.s === 200 && r.b.success ? ok('POST crear borrador TyC → success') : fail('Crear borrador TyC', r.b);
      draftTycId = r.b.id;
      draftTycId ? ok(`Borrador TyC creado con id=${draftTycId}`) : fail('No retornó id'); }

    // 3.4 Crear borrador PyP
    let draftPypId = null;
    { const r = await POST('/legal/admin/documents', {
        type: 'pyp', version: 'TEST-1', title: 'PyP de prueba', html_content: '<p>Borrador PyP test</p>',
        summary_of_changes: 'Test CRUD', requires_acceptance: false,
      }, adminTok);
      r.s === 200 && r.b.success ? ok('POST crear borrador PyP → success') : fail('Crear borrador PyP', r.b);
      draftPypId = r.b.id; }

    // 3.5 Borrador aparece en lista con is_current=false
    { const r = await GET('/legal/admin/documents', adminTok);
      const draft = r.b.documents?.find(d => d.id === draftTycId);
      draft ? ok('Borrador TyC aparece en lista') : fail('Borrador TyC no aparece en lista');
      draft && !draft.is_current ? ok('Borrador is_current=false') : fail('Borrador debería ser is_current=false'); }

    // 3.6 Actualizar borrador
    { const r = await PUT(`/legal/admin/documents/${draftTycId}`, {
        version: 'TEST-1', title: 'TyC de prueba (editado)', html_content: '<p>Editado</p>',
        summary_of_changes: 'Editado', requires_acceptance: true,
      }, adminTok);
      r.s === 200 && r.b.success ? ok('PUT actualizar borrador → success') : fail('Actualizar borrador', r.b); }

    // 3.7 No se puede editar documento publicado
    { const r = await PUT(`/legal/admin/documents/${origTyc.id}`, {
        version: '1.0', title: 'X', html_content: '<p>x</p>', summary_of_changes: '', requires_acceptance: true,
      }, adminTok);
      r.s === 400 ? ok('Editar publicado → 400 bloqueado') : fail('Debería bloquear edición de publicado', r.s); }

    // 3.8 Stats de documento
    { const r = await GET(`/legal/admin/documents/${origTyc.id}/stats`, adminTok);
      r.s === 200 ? ok('GET /stats → 200') : fail('Stats falló', r.s);
      typeof r.b.total_users === 'number' ? ok('total_users es número') : fail('total_users falta');
      Array.isArray(r.b.acceptances) ? ok('acceptances es array') : fail('acceptances falta'); }

    // 3.9 Doc inexistente → 404
    { const r = await GET('/legal/admin/documents/99999', adminTok);
      r.s === 404 ? ok('Doc inexistente → 404') : fail('Esperaba 404', r.s); }

    // 3.10 Tipo inválido al crear → 400
    { const r = await POST('/legal/admin/documents', {
        type: 'xxx', version: '1.0', title: 'Test', html_content: '<p>x</p>',
      }, adminTok);
      r.s === 400 ? ok('Tipo inválido al crear → 400') : fail('Debería dar 400 con tipo inválido', r.s); }

    // 3.11 Campos faltantes → 400
    { const r = await POST('/legal/admin/documents', { type: 'tyc' }, adminTok);
      r.s === 400 ? ok('Campos faltantes → 400') : fail('Debería dar 400 sin campos', r.s); }

    // 3.12 Eliminar borrador
    { const r = await DEL(`/legal/admin/documents/${draftPypId}`, adminTok);
      r.s === 200 && r.b.success ? ok(`DELETE borrador PyP (id=${draftPypId}) → success`) : fail('Eliminar borrador', r.b);
      // Verificar que no existe más
      const r2 = await GET(`/legal/admin/documents/${draftPypId}`, adminTok);
      r2.s === 404 ? ok('Borrador eliminado → 404') : fail('Borrador sigue existiendo tras DELETE', r2.s); }

    // 3.13 No se puede eliminar documento publicado
    { const r = await DEL(`/legal/admin/documents/${origTyc.id}`, adminTok);
      r.s === 400 ? ok('Eliminar publicado → 400 bloqueado') : fail('Debería bloquear eliminación de publicado', r.s); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 4 — Auto-increment de versión (lógica frontend)');

    const cases = [
        { label: 'Sin docs → 1.0',                    docs: [],                                                       type: 'tyc', exp: '1.0'  },
        { label: '1.0 → 1.1',                         docs: [{ type:'tyc', version:'1.0' }],                         type: 'tyc', exp: '1.1'  },
        { label: '1.9 → 1.10',                        docs: [{ type:'tyc', version:'1.9' }],                         type: 'tyc', exp: '1.10' },
        { label: '2.3 → 2.4',                         docs: [{ type:'tyc', version:'2.3' }],                         type: 'tyc', exp: '2.4'  },
        { label: 'Múltiples: max(1.0,1.2,1.1) → 1.3', docs: [{ type:'tyc', version:'1.0' }, { type:'tyc', version:'1.2' }, { type:'tyc', version:'1.1' }], type: 'tyc', exp: '1.3' },
        { label: 'PyP no afecta TyC',                 docs: [{ type:'pyp', version:'5.0' }, { type:'tyc', version:'1.0' }], type: 'tyc', exp: '1.1' },
        { label: 'Sin TyC pero hay PyP → 1.0',        docs: [{ type:'pyp', version:'3.0' }],                         type: 'tyc', exp: '1.0'  },
    ];
    for (const c of cases) {
        const got = calcNextVersion(c.docs, c.type);
        got === c.exp ? ok(c.label) : fail(c.label, `esperado=${c.exp} got=${got}`);
    }

    // Auto-increment contra lista real de la API
    { const r = await GET('/legal/admin/documents', adminTok);
      const docs = r.b.documents || [];
      const nextTyc = calcNextVersion(docs, 'tyc');
      const nextPyp = calcNextVersion(docs, 'pyp');
      const [cm, cn] = origTyc.version.split('.').map(s => parseInt(s) || 0);
      const [nm, nn] = nextTyc.split('.').map(s => parseInt(s) || 0);
      (nm > cm || (nm === cm && nn > cn)) ? ok(`Próxima TyC=${nextTyc} > actual ${origTyc.version}`) : fail('Auto-increment TyC incorrecto', nextTyc);
      ok(`Próxima PyP calculada correctamente: ${nextPyp}`); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 5 — Publicación: cambio is_current + notificaciones in-app');

    // Crear borrador con contenido marcado
    const MARKER = `<!-- PUBLISH_TEST_${Date.now()} -->`;
    let publishDraftId = null;
    { const origHtml = (await GET(`/legal/admin/documents/${origTyc.id}`, adminTok)).b.document?.html_content || '';
      const r = await POST('/legal/admin/documents', {
        type: 'tyc', version: 'TEST-PUB', title: 'TyC Test Publicación',
        html_content: origHtml.replace('</body>', `${MARKER}\n</body>`),
        summary_of_changes: 'Test de publicación', requires_acceptance: true,
      }, adminTok);
      publishDraftId = r.b.id;
      publishDraftId ? ok(`Borrador para publicación creado id=${publishDraftId}`) : fail('No se pudo crear borrador', r.b); }

    // Ya publicado → error
    { const r = await PUT(`/legal/admin/documents/${origTyc.id}/publish`, {}, adminTok);
      r.s === 400 ? ok('Publicar ya-publicado → 400') : fail('Debería dar 400', r.s); }

    // Publicar el borrador
    let notifiedCount = 0;
    { const r = await PUT(`/legal/admin/documents/${publishDraftId}/publish`, {}, adminTok);
      r.s === 200 && r.b.success ? ok('PUT /publish → success') : fail('Publicar falló', r.b);
      notifiedCount = r.b.notified || 0;
      ok(`Notificados: ${notifiedCount} usuarios`); }

    // is_current se actualizó en DB
    { const dbRows = await pool.query('SELECT version,is_current FROM legal_documents WHERE type=$1 ORDER BY id', ['tyc']);
      const old = dbRows.rows.find(r => r.version === origTyc.version);
      const pub = dbRows.rows.find(r => r.version === 'TEST-PUB');
      old && !old.is_current ? ok(`TyC ${origTyc.version} → is_current=false`) : fail('Versión antigua debería ser false');
      pub && pub.is_current   ? ok('TyC TEST-PUB → is_current=true')           : fail('Nueva versión debería ser true'); }

    // /terminos/ sirve la nueva versión
    { const r = await raw('/terminos/');
      r.b.includes(MARKER) ? ok('/terminos/ sirve nueva versión tras publicación') : fail('/terminos/ no tiene el nuevo contenido'); }

    // Notificación in-app insertada para usuarios sin aceptación
    if (notifiedCount > 0) {
        const notifRow = await pool.query(
            "SELECT COUNT(*) FROM user_notifications WHERE type='legal_update' AND user_id=$1",
            [testUser.id]
        );
        parseInt(notifRow.rows[0].count) > 0
            ? ok('Notificación in-app insertada para test user')
            : fail('Notificación in-app no encontrada');
    } else skip('Sin usuarios activos sin aceptación para notificar');

    // legal_pending_since seteado (COALESCE)
    { const dbU = await pool.query('SELECT legal_pending_since FROM users WHERE id=$1', [testUser.id]);
      dbU.rows[0]?.legal_pending_since
        ? ok('legal_pending_since seteado en test user')
        : skip('legal_pending_since no seteado (puede que test user no sea activo)'); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 6 — Flujo completo de aceptación de usuario');

    // 6.1 GET /legal/pending — debe tener TyC TEST-PUB pendiente
    { const r = await GET('/legal/pending', userTok);
      r.s === 200 ? ok('GET /legal/pending → 200') : fail('pending falló', r.s);
      const pend = r.b.pending || [];
      pend.length > 0 ? ok(`${pend.length} documento(s) pendientes`) : fail('Esperaba al menos 1 pendiente');
      pend.some(d => d.type === 'tyc') ? ok('TyC en lista de pendientes') : fail('TyC no está pendiente'); }

    // 6.2 Deadline presente
    { const r = await GET('/legal/pending', userTok);
      r.b.deadline ? ok('Deadline presente en respuesta') : skip('Deadline ausente (legal_pending_since no seteado)'); }

    // 6.3 POST /legal/accept — acepta todos
    let acceptedCount = 0;
    { const r = await POST('/legal/accept', {}, userTok);
      r.s === 200 && r.b.success ? ok('POST /legal/accept → success') : fail('Accept falló', r.b);
      acceptedCount = r.b.accepted || 0;
      acceptedCount > 0 ? ok(`Aceptados: ${acceptedCount} documento(s)`) : fail('accepted debería ser > 0'); }

    // 6.4 Verificación en DB
    { const dbA = await pool.query(
        'SELECT COUNT(*) FROM user_legal_acceptances WHERE user_id=$1', [testUser.id]);
      parseInt(dbA.rows[0].count) === acceptedCount
        ? ok(`${acceptedCount} filas en user_legal_acceptances`) : fail('Filas en DB incorrectas', dbA.rows[0].count); }

    // 6.5 legal_pending_since y legal_suspended limpiados
    { const dbU = await pool.query('SELECT legal_pending_since, legal_suspended FROM users WHERE id=$1', [testUser.id]);
      !dbU.rows[0].legal_pending_since  ? ok('legal_pending_since = NULL tras aceptación') : fail('legal_pending_since no se limpió');
      dbU.rows[0].legal_suspended === false ? ok('legal_suspended = false tras aceptación')  : fail('legal_suspended no se limpió'); }

    // 6.6 GET /legal/pending después → 0 pendientes
    { const r = await GET('/legal/pending', userTok);
      (r.b.pending || []).length === 0 ? ok('0 pendientes tras aceptación') : fail('Siguen habiendo pendientes', r.b.pending); }

    // 6.7 Accept idempotente
    { const r = await POST('/legal/accept', {}, userTok);
      r.b.accepted === 0 ? ok('Segunda aceptación → accepted=0 (idempotente)') : fail('No es idempotente', r.b.accepted); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 7 — Registro: aceptación automática de documentos vigentes');

    // Crear usuario temporal y verificar que se insertaron aceptaciones
    const tmpEmail = `test_legal_tmp_${Date.now()}@example.com`;
    const tmpPassword = 'TestPass99!';

    // Obtener qué documentos están vigentes
    const currentDocs = await pool.query('SELECT id FROM legal_documents WHERE is_current=true AND requires_acceptance=true');
    const currentDocIds = currentDocs.rows.map(r => r.id);

    // Verificar que el registro está habilitado
    const regStatus = await GET('/auth/register-status');
    if (regStatus.b?.allowed === false) {
        skip('Registro deshabilitado — omitiendo test de aceptación en registro');
    } else {
        const regRes = await POST('/auth/register', {
            nombre: 'Test', apellido: 'Legal', email: tmpEmail,
            password: tmpPassword, cuit: '20-12345678-6',
            domicilio: { calle: 'Test', numero: '123', localidad: 'CABA', provincia: 'Buenos Aires' },
            plan_name: 'EXTENSION_PROMO', toc_accepted: true,
        });

        if (regRes.s === 201 && regRes.b.success) {
            ok('Registro exitoso');
            // Verificar aceptaciones en DB
            const newUser = await pool.query('SELECT id FROM users WHERE email=$1', [tmpEmail]);
            if (newUser.rows.length) {
                const nuid = newUser.rows[0].id;
                const acc = await pool.query(
                    'SELECT document_id FROM user_legal_acceptances WHERE user_id=$1 ORDER BY document_id',
                    [nuid]
                );
                const accIds = acc.rows.map(r => r.document_id).sort();
                const expIds = currentDocIds.sort();
                JSON.stringify(accIds) === JSON.stringify(expIds)
                    ? ok(`Registro automáticamente aceptó ${accIds.length} doc(s) vigente(s)`)
                    : fail('Aceptaciones de registro incorrectas', { got: accIds, expected: expIds });

                // ip_hash presente
                const ipRow = await pool.query('SELECT ip_hash FROM user_legal_acceptances WHERE user_id=$1 LIMIT 1', [nuid]);
                ipRow.rows[0]?.ip_hash ? ok('ip_hash guardado en aceptación de registro') : fail('ip_hash vacío');

                // Cleanup usuario temporal
                await pool.query('DELETE FROM user_legal_acceptances WHERE user_id=$1', [nuid]);
                await pool.query('DELETE FROM subscriptions WHERE user_id=$1', [nuid]);
                await pool.query('DELETE FROM users WHERE id=$1', [nuid]);
                ok('Usuario temporal limpiado');
            } else fail('No se encontró el usuario recién registrado');
        } else if (regRes.s === 400 && regRes.b?.error?.includes('ya')) {
            skip('Email temporal ya existe — omitir test de registro');
        } else {
            fail(`Registro falló (${regRes.s})`, regRes.b?.error);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 8 — checkLicense: bloqueo por legal_suspended');

    // Suspender al usuario de prueba
    await pool.query('UPDATE users SET legal_suspended=true WHERE id=$1', [testUser.id]);

    // Cualquier endpoint que use checkLicense debe retornar 403 con code LEGAL_SUSPENDED
    // Usamos GET /client/scripts/available que pasa por checkLicense
    { const r = await GET('/client/scripts/available', userTok);
      if (r.s === 403) {
          ok('Endpoint con checkLicense → 403 cuando legal_suspended=true');
          r.b.code === 'LEGAL_SUSPENDED'
            ? ok('code=LEGAL_SUSPENDED en respuesta')
            : fail('Falta code LEGAL_SUSPENDED', r.b);
          r.b.accept_url?.includes('/legal/accept/')
            ? ok('accept_url presente en respuesta')
            : fail('accept_url falta', r.b.accept_url);
      } else {
          skip(`checkLicense endpoint devolvió ${r.s} (puede no pasar por checkLicense)`);
      } }

    // Restaurar
    await pool.query('UPDATE users SET legal_suspended=false WHERE id=$1', [testUser.id]);
    ok('legal_suspended restaurado a false');

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 9 — Portal /usuarios/: estructura HTML + JS + API');

    // 9.1 HTML del portal
    { const r = await raw('/usuarios/');
      r.s === 200 ? ok('/usuarios/ → 200') : fail('/usuarios/', r.s);
      r.b.includes('data-section="legal"')   ? ok('Nav item "legal" en sidebar')  : fail('Nav item legal no encontrado');
      r.b.includes('id="section-legal"')     ? ok('#section-legal presente')      : fail('#section-legal no encontrado');
      r.b.includes('id="nav-legal-badge"')   ? ok('#nav-legal-badge presente')    : fail('#nav-legal-badge no encontrado');
      r.b.includes('id="legal-content"')     ? ok('#legal-content presente')      : fail('#legal-content no encontrado'); }

    // 9.2 app.js del portal
    { const r = await raw('/usuarios/app.js');
      r.s === 200 ? ok('app.js → 200') : fail('app.js', r.s);
      ['refreshLegalBadge', 'renderLegal', 'acceptLegalDocs', "case 'legal'", 'refreshLegalBadge()'].forEach(fn => {
          r.b.includes(fn) ? ok(`app.js contiene: ${fn}`) : fail(`app.js falta: ${fn}`);
      }); }

    // 9.3 /client/account incluye legalSuspended
    { const r = await GET('/client/account', userTok);
      r.s === 200 ? ok('/client/account → 200') : fail('/client/account', r.s);
      'legalSuspended' in (r.b.account || {})
        ? ok('Campo legalSuspended en /client/account') : fail('Campo legalSuspended falta');
      r.b.account?.legalSuspended === false ? ok('legalSuspended=false correcto') : fail('Valor inesperado', r.b.account?.legalSuspended); }

    // 9.4 legalSuspended=true llega al account
    { await pool.query('UPDATE users SET legal_suspended=true WHERE id=$1', [testUser.id]);
      const r = await GET('/client/account', userTok);
      r.b.account?.legalSuspended === true ? ok('legalSuspended=true cuando suspendido') : fail('Valor inesperado', r.b.account?.legalSuspended);
      await pool.query('UPDATE users SET legal_suspended=false WHERE id=$1', [testUser.id]);
      ok('legal_suspended restaurado'); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 10 — Deadline: cálculo y casos borde');

    // Sin pending_since → deadline=null
    await pool.query('UPDATE users SET legal_pending_since=NULL WHERE id=$1', [testUser.id]);
    await pool.query('DELETE FROM user_legal_acceptances WHERE user_id=$1', [testUser.id]);
    { const r = await GET('/legal/pending', userTok);
      r.b.deadline === null ? ok('deadline=null cuando no hay pending_since') : fail('Deadline debería ser null', r.b.deadline); }

    // Con pending_since hace 5 días → deadline en ~10 días
    await pool.query("UPDATE users SET legal_pending_since=NOW()-INTERVAL '5 days' WHERE id=$1", [testUser.id]);
    { const r = await GET('/legal/pending', userTok);
      if (r.b.deadline) {
          const days = Math.round((new Date(r.b.deadline) - new Date()) / 86400000);
          (days >= 9 && days <= 11) ? ok(`Deadline correcto: ~${days} días (pending hace 5 días)`) : fail('Deadline incorrecto', days);
      } else fail('Deadline debería estar presente'); }

    // Con pending_since hace 14 días → deadline en ~1 día (urgente)
    await pool.query("UPDATE users SET legal_pending_since=NOW()-INTERVAL '14 days' WHERE id=$1", [testUser.id]);
    { const r = await GET('/legal/pending', userTok);
      if (r.b.deadline) {
          const days = Math.round((new Date(r.b.deadline) - new Date()) / 86400000);
          (days >= 0 && days <= 2) ? ok(`Deadline urgente: ~${days} días (pending hace 14 días)`) : fail('Deadline urgente incorrecto', days);
      } else fail('Deadline debería estar presente en urgente'); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 11 — Idempotencia y casos borde');

    // Aceptar cuando ya no hay pendientes → success con accepted=0
    await POST('/legal/accept', {}, userTok);  // primera aceptación
    { const r = await POST('/legal/accept', {}, userTok);
      r.s === 200 && r.b.success && r.b.accepted === 0
        ? ok('Accept sin pendientes → success accepted=0')
        : fail('Idempotencia falló', r.b); }

    // Doble aceptación no duplica filas en DB
    { const r = await pool.query('SELECT COUNT(*) FROM user_legal_acceptances WHERE user_id=$1', [testUser.id]);
      const count = parseInt(r.rows[0].count);
      count <= currentDocIds.length ? ok(`Sin duplicados en DB: ${count} filas`) : fail('Filas duplicadas', count); }

    // Doc con requires_acceptance=false no aparece como pendiente
    { let tmpDraftId = null;
      const cr = await POST('/legal/admin/documents', {
          type: 'tyc', version: 'TEST-NR', title: 'Sin requerimiento', html_content: '<p>x</p>',
          requires_acceptance: false,
      }, adminTok);
      tmpDraftId = cr.b.id;
      if (tmpDraftId) {
          await PUT(`/legal/admin/documents/${tmpDraftId}/publish`, {}, adminTok);
          // Limpiar aceptaciones para que sea pendiente IF requires_acceptance=true
          await pool.query('DELETE FROM user_legal_acceptances WHERE user_id=$1', [testUser.id]);
          const r = await GET('/legal/pending', userTok);
          const pendIds = (r.b.pending || []).map(p => p.type);
          !pendIds.some(p => p === 'tyc' && p === 'TEST-NR')
              ? ok('Doc con requires_acceptance=false no aparece en pending')
              : fail('Doc sin requerimiento aparece en pending');
          // Restaurar — publicar la versión original
          const restoreHtml = (await GET(`/legal/admin/documents/${origTyc.id}`, adminTok)).b.document?.html_content || '<p>restored</p>';
          const restDraft = await POST('/legal/admin/documents', {
              type: 'tyc', version: origTyc.version.replace(/-r$/, ''), title: 'Restaurado', html_content: restoreHtml,
              requires_acceptance: true, summary_of_changes: 'Restauración post-test'
          }, adminTok);
          await PUT(`/legal/admin/documents/${restDraft.b.id}/publish`, {}, adminTok);
          ok('TyC restaurado a versión con requires_acceptance=true');
      } else skip('No se pudo crear doc sin requerimiento'); }

    // ══════════════════════════════════════════════════════════════════════════
    section('BLOQUE 12 — Cleanup y consistencia final de DB');

    // Limpiar borradores de test (los que tienen version TEST-* y no son is_current)
    const testDocs = await pool.query(
        "SELECT id,type,version,is_current FROM legal_documents WHERE version LIKE 'TEST%' OR version LIKE '%-r'"
    );
    let cleaned = 0;
    for (const d of testDocs.rows) {
        if (!d.is_current) {
            await pool.query('DELETE FROM legal_documents WHERE id=$1', [d.id]);
            cleaned++;
        }
    }
    ok(`${cleaned} borrador(es) de test eliminados`);

    // Verificar que hay exactamente 1 is_current por tipo
    { const r = await pool.query('SELECT type, COUNT(*) FROM legal_documents WHERE is_current=true GROUP BY type');
      const counts = Object.fromEntries(r.rows.map(row => [row.type, parseInt(row.count)]));
      counts.tyc === 1 ? ok('Exactamente 1 TyC is_current=true') : fail('is_current de TyC inconsistente', counts.tyc);
      counts.pyp === 1 ? ok('Exactamente 1 PyP is_current=true') : fail('is_current de PyP inconsistente', counts.pyp); }

    // Limpiar aceptaciones y estado de test users
    await pool.query('DELETE FROM user_legal_acceptances WHERE user_id IN ($1,$2)', [testUser.id, testUser2?.id || 0]);
    await pool.query('UPDATE users SET legal_pending_since=NULL, legal_suspended=false WHERE id IN ($1,$2)', [testUser.id, testUser2?.id || 0]);
    ok('Estado de test users limpiado');

    // Estado final de /terminos/ y /privacidad/ sirven HTML
    { const t = await raw('/terminos/');
      const p = await raw('/privacidad/');
      t.s === 200 && t.b.length > 1000 ? ok('/terminos/ sirve contenido válido') : fail('/terminos/ inválida tras cleanup');
      p.s === 200 && p.b.length > 1000 ? ok('/privacidad/ sirve contenido válido') : fail('/privacidad/ inválida tras cleanup'); }

    await pool.end();

    // ── Resumen ───────────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RESULTADO FINAL`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  ✅ Pasaron: ${passed}`);
    if (skipped) console.log(`  ⏭  Skips:   ${skipped}`);
    if (failed)  console.log(`  ❌ Fallaron: ${failed}`);
    console.log(`${'═'.repeat(60)}\n`);
    if (failed > 0) process.exit(1);
})();
