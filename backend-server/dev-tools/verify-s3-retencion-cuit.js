/**
 * verify-s3-retencion-cuit.js — S3 de la Etapa 3 (SEC-2, 2026-09-01).
 *
 * Verifica el fix del cron 5e (liberación de CUIT a 90 días post-cancelación,
 * server.js) contra un escenario real que el propio bloque de seguridad
 * encontró por inspección directa (nunca ejercitado en producción: 0 usuarios
 * cancelled con más de 90 días de antigüedad existieron nunca):
 *
 *   1. La condición original medía `users.updated_at`, que un login de un usuario
 *      `cancelled` (permitido a propósito por /auth/portal-login) resetea en cada
 *      entrada — el mecanismo nunca dispararía para la cuenta que más se espera
 *      que use el portal después de cancelar (para ver facturas / re-suscribirse).
 *   2. `users.cuit_deleted_at` (existe desde la migración 005_fase5_payments.sql)
 *      nunca se escribía — columna muerta.
 *
 * Reproduce EXACTAMENTE la query del cron (copiada literal de server.js) contra
 * fixtures aislados, sin usar la app real ni el propio cron (que corre 1 vez/día
 * y no se puede disparar bajo demanda sin tocar el crontab del servidor).
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 * ⚠️ Escribe y borra únicamente filas con email 'test-s3-retencion-%@test.local'
 *    y cuit 'TEST-S3-%' (excluidos del índice único parcial de users.cuit).
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config /tmp/verify-s3-retencion-cuit.js dotenv_config_path=.env.staging
 */

'use strict';

const { Pool } = require('pg');

require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`❌ ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging".`);
    process.exit(1);
}

const db = new Pool({
    user: process.env.DB_USER || 'procurador_user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    connectionTimeoutMillis: 5000,
});

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`✅ ${name}`); }
    else { failed++; fails.push(name); console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// Query EXACTA del cron 5e (server.js), copiada literal para no probar una
// reimplementación distinta de lo que realmente corre.
const CRON_5E_QUERY = `
    UPDATE users u SET cuit = NULL, cuit_deleted_at = NOW(), updated_at = NOW()
    WHERE u.registration_status = 'cancelled'
      AND u.cuit IS NOT NULL
      AND (
        SELECT MAX(ev.created_at) FROM user_events ev
        WHERE ev.user_id = u.id
          AND ev.event_type = 'subscription_cancelled_expired'
      ) < NOW() - INTERVAL '90 days'
    RETURNING id
`;

async function crearFixture({ email, cuit, diasCancelado }) {
    const u = await db.query(`
        INSERT INTO users (email, password_hash, registration_status, cuit, nombre, apellido, updated_at)
        VALUES ($1, 'x', 'cancelled', $2, 'Fixture', 'S3', NOW())
        RETURNING id
    `, [email, cuit]);
    const userId = u.rows[0].id;
    await db.query(`
        INSERT INTO user_events (user_id, event_type, created_at)
        VALUES ($1, 'subscription_cancelled_expired', NOW() - ($2 || ' days')::interval)
    `, [userId, diasCancelado]);
    return userId;
}

async function borrarFixture(userId) {
    await db.query(`DELETE FROM user_events WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function run() {
    console.log('🔍 S3 — verificación del fix de liberación de CUIT (cron 5e)\n');
    const fixtureIds = [];

    try {
        // ── Caso 1: cancelado hace 100 días, SIN ningún login/UPDATE posterior ──
        // (el caso feliz que la query original YA cubría — no-regresión)
        const id1 = await crearFixture({ email: 'test-s3-retencion-1@test.local', cuit: 'TEST-S3-0001', diasCancelado: 100 });
        fixtureIds.push(id1);

        // ── Caso 2: cancelado hace 100 días, pero CON un login/UPDATE reciente ──
        // (el escenario del bug real: portal-login hace UPDATE users SET last_login=NOW()
        //  en cada entrada de una cuenta `cancelled`, lo que el trigger update_users_updated_at
        //  traduce en updated_at=NOW() SIN condición de columna)
        const id2 = await crearFixture({ email: 'test-s3-retencion-2@test.local', cuit: 'TEST-S3-0002', diasCancelado: 100 });
        fixtureIds.push(id2);
        // Simula exactamente lo que hace /auth/portal-login al loguear una cuenta cancelled
        await db.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [id2]);
        const rowAfterLogin = await db.query(`SELECT updated_at FROM users WHERE id = $1`, [id2]);
        const updatedAtEsReciente = (Date.now() - new Date(rowAfterLogin.rows[0].updated_at).getTime()) < 60000;
        check('Fixture 2: el login simulado SÍ bumpeó updated_at (confirma el mecanismo del bug)', updatedAtEsReciente);

        // ── Caso 3: cancelado hace SOLO 10 días — no debe liberarse todavía ──
        const id3 = await crearFixture({ email: 'test-s3-retencion-3@test.local', cuit: 'TEST-S3-0003', diasCancelado: 10 });
        fixtureIds.push(id3);

        // ── Caso 4: re-cancelación — cancelado hace 200 días, REACTIVADO, y
        //    cancelado de nuevo hace solo 5 días. El evento de 200 días NO debe
        //    disparar la liberación (se usa MAX, no el primer evento) ──
        const id4 = await crearFixture({ email: 'test-s3-retencion-4@test.local', cuit: 'TEST-S3-0004', diasCancelado: 200 });
        fixtureIds.push(id4);
        await db.query(`
            INSERT INTO user_events (user_id, event_type, created_at)
            VALUES ($1, 'subscription_cancelled_expired', NOW() - INTERVAL '5 days')
        `, [id4]);

        // ── Corrida 1 de la query real del cron ──
        const antes = await db.query(`SELECT id, cuit, cuit_deleted_at FROM users WHERE id = ANY($1) ORDER BY id`, [fixtureIds]);
        console.log('\nEstado ANTES de correr el cron:');
        antes.rows.forEach(r => console.log(`  id=${r.id} cuit=${r.cuit} cuit_deleted_at=${r.cuit_deleted_at}`));

        const result = await db.query(CRON_5E_QUERY);
        const liberados = result.rows.map(r => r.id);
        console.log(`\nCron ejecutado — ${result.rowCount} fila(s) afectada(s): [${liberados.join(', ')}]`);

        check('Caso 1 (100 días, sin login posterior) → SE LIBERA', liberados.includes(id1));
        check('Caso 2 (100 días de cancelación real, PERO con un login/UPDATE reciente) → SE LIBERA IGUAL (el fix)', liberados.includes(id2));
        check('Caso 3 (10 días) → NO se libera todavía', !liberados.includes(id3));
        check('Caso 4 (re-cancelado hace 5 días, el evento viejo de 200 días no cuenta) → NO se libera', !liberados.includes(id4));

        const despues = await db.query(`SELECT id, cuit, cuit_deleted_at FROM users WHERE id = ANY($1) ORDER BY id`, [fixtureIds]);
        const map = Object.fromEntries(despues.rows.map(r => [r.id, r]));
        check('Caso 1: cuit quedó NULL', map[id1].cuit === null);
        check('Caso 1: cuit_deleted_at quedó seteado (el 2do bug, la columna muerta)', map[id1].cuit_deleted_at !== null);
        check('Caso 2: cuit quedó NULL', map[id2].cuit === null);
        check('Caso 2: cuit_deleted_at quedó seteado', map[id2].cuit_deleted_at !== null);
        check('Caso 3: cuit SIGUE con su valor (no tocado)', map[id3].cuit === 'TEST-S3-0003');
        check('Caso 3: cuit_deleted_at sigue NULL', map[id3].cuit_deleted_at === null);
        check('Caso 4: cuit SIGUE con su valor (no tocado)', map[id4].cuit === 'TEST-S3-0004');

        // ── Idempotencia: correr de nuevo, no debe re-tocar los ya liberados ──
        const result2 = await db.query(CRON_5E_QUERY);
        check('Segunda corrida: 0 filas nuevas (idempotente, cuit ya NULL en los liberados)', result2.rowCount === 0, `rowCount=${result2.rowCount}`);

    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        for (const id of fixtureIds) {
            try { await borrarFixture(id); } catch (e) { console.error(`  ⚠️ error borrando fixture ${id}: ${e.message}`); }
        }
        const residuo = await db.query(`SELECT count(*) FROM users WHERE email LIKE 'test-s3-retencion-%@test.local'`);
        check('Sin residuo de fixtures al cerrar', residuo.rows[0].count === '0', `quedaron ${residuo.rows[0].count}`);
        await db.end();
    }

    console.log(`\n${'='.repeat(60)}\n${passed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.log('Fallos:', fails.join(', '));
        process.exit(1);
    }
}

run().catch(err => { console.error('❌ Error fatal:', err); process.exit(1); });
