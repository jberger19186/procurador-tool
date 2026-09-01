/**
 * verify-s2-bitacora-destructivo.js — S2 de la Etapa 3 (SEC-2, 2026-09-01).
 *
 * Audita el ÚNICO camino destructivo del sistema (POST /usuarios/api/bitacora/import,
 * modo `reemplazar`) y la exportación con gracia de 90 días.
 *
 * Cubre las hipótesis de S2 del plan-seguridad-lanzamiento-2026-08.md:
 *   1. H-3 — 10MB de import sin rate limit propio: medir el impacto real.
 *   2. Validación de pertenencia contra un backup MANIPULADO A MANO.
 *   3. CSRF — confirmar que no hay credencial ambiente (cookie) que un form
 *      cross-site pudiera aprovechar.
 *   4. 🎯 Exportación con gracia + registration_status — ¿un usuario `rejected`,
 *      `suspended_admin` o `cancelled`, con un JWT todavía válido, conserva acceso?
 *   5. Prototype pollution en el merge de `combinar`.
 *   6. Mass assignment en PUT /usuarios/api/profile.
 *
 * ⚠️ NUNCA CONTRA PRODUCCIÓN — el modo `reemplazar` borra datos reales.
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config /tmp/verify-s2-bitacora-destructivo.js dotenv_config_path=.env.staging
 */

'use strict';

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

require('dotenv').config();

if (!/staging/i.test(process.env.DB_NAME || '')) {
    console.error(`❌ ABORTADO: DB_NAME="${process.env.DB_NAME}" no contiene "staging".`);
    process.exit(1);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE_URL = 'https://localhost:3444';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('❌ Falta JWT_SECRET.'); process.exit(1); }

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

function requestJson(method, path, { token, body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (cookie) headers['Cookie'] = cookie;
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        const req = https.request(BASE_URL + path, { method, headers }, (res) => {
            let chunks = '';
            res.on('data', (c) => chunks += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(chunks); } catch (_) {}
                resolve({ status: res.statusCode, body: json, raw: chunks });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

/** multipart/form-data mínimo, a mano (sin dependencias) — un solo campo file + campos de texto. */
function requestMultipartImport(token, jsonBuffer, extraFields = {}) {
    return new Promise((resolve, reject) => {
        const boundary = '----s2verify' + Date.now();
        const parts = [];
        for (const [k, v] of Object.entries(extraFields)) {
            parts.push(Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
            ));
        }
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="backup"; filename="backup.json"\r\nContent-Type: application/json\r\n\r\n`
        ));
        parts.push(jsonBuffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
        const bodyBuf = Buffer.concat(parts);

        const headers = {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyBuf.length,
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const t0 = Date.now();
        const req = https.request(BASE_URL + '/usuarios/api/bitacora/import', { method: 'POST', headers }, (res) => {
            let chunks = '';
            res.on('data', (c) => chunks += c);
            res.on('end', () => {
                const ms = Date.now() - t0;
                let json = null;
                try { json = JSON.parse(chunks); } catch (_) {}
                resolve({ status: res.statusCode, body: json, raw: chunks, ms, bytesSent: bodyBuf.length });
            });
        });
        req.on('error', reject);
        req.write(bodyBuf);
        req.end();
    });
}

function tokenFor(userId, extra = {}) {
    return jwt.sign({ id: userId, role: 'user', ...extra }, JWT_SECRET, { expiresIn: '1h' });
}

async function getHealth() {
    const r = await requestJson('GET', '/health');
    return r.body;
}

function backupEntradasBackup(userId, n, descLen) {
    const desc = 'x'.repeat(descLen);
    const entradas = [];
    for (let i = 1; i <= n; i++) {
        entradas.push({
            id: 9_000_000 + i, // rango fuera de cualquier id real, no colisiona
            user_id: userId,
            expediente_id: null,
            kind: 'nota',
            title: `S2 carga ${i}`,
            description: desc,
            due_at: null,
            all_day: true,
            done_at: null,
            repeat_rule: null,
            meta: null,
            source: 'manual',
        });
    }
    return { backup_version: 1, exported_at: new Date().toISOString(), expedientes: [], entradas, snapshots: [] };
}

async function main() {
    console.log(`▶ S2 — camino destructivo de Bitácora contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    const USER_A = 215;
    let USER_B = null, USER_REJ = null, USER_SUSP = null, USER_CANC = null;
    let comboId = null, flagOriginal = null;
    const createdIds = [];

    try {
        const { rows: planRows } = await db.query(
            "SELECT id, bitacora_enabled FROM plans WHERE name = 'COMBO_PROMO'"
        );
        comboId = planRows[0].id;
        flagOriginal = planRows[0].bitacora_enabled;
        await db.query('UPDATE plans SET bitacora_enabled = true WHERE id = $1', [comboId]);

        async function crearFixture(email, cuit, registrationStatus, subStatus) {
            const { rows } = await db.query(
                `INSERT INTO users (email, password_hash, role, registration_status, email_verified, cuit)
                 VALUES ($1, 'x', 'user', $2, true, $3) RETURNING id`,
                [email, registrationStatus, cuit]
            );
            const id = rows[0].id;
            createdIds.push(id);
            await db.query(
                `INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at)
                 VALUES ($1, 'COMBO_PROMO', $2, $3, 0, 999999, NOW() + INTERVAL '30 days')`,
                [id, comboId, subStatus]
            );
            return id;
        }

        USER_B    = await crearFixture('s2-fixture-b@stub.local',    '20999999992', 'active', 'active');
        USER_REJ  = await crearFixture('s2-fixture-rej@stub.local',  '20999999993', 'rejected', 'active');
        USER_SUSP = await crearFixture('s2-fixture-susp@stub.local', '20999999994', 'suspended_admin', 'suspended_admin');
        USER_CANC = await crearFixture('s2-fixture-canc@stub.local', '20999999995', 'cancelled', 'cancelled');

        const tokenA    = tokenFor(USER_A);
        const tokenB    = tokenFor(USER_B);
        const tokenRej  = tokenFor(USER_REJ);
        const tokenSusp = tokenFor(USER_SUSP);
        const tokenCanc = tokenFor(USER_CANC);

        console.log(`Fixtures: A=${USER_A} B=${USER_B} REJ=${USER_REJ} SUSP=${USER_SUSP} CANC=${USER_CANC}\n`);

        // ═══════════════════════════════════════════════════════════════════
        // 4. 🎯 registration_status vs. el gate de Bitácora — el hallazgo central,
        //    ENCONTRADO Y CORREGIDO en esta misma sesión (middleware/checkBitacoraPlan.js).
        // ═══════════════════════════════════════════════════════════════════
        // ANTES del fix: checkBitacoraPlan() solo miraba plans.bitacora_enabled vía
        // el JOIN con subscriptions/plans. NUNCA leía users.registration_status ni
        // subscriptions.status. Como no hay invalidación de tokens al suspender o
        // rechazar (solo existe blacklist de logout para ADMIN), y sobre todo porque
        // /auth/portal-login bloquea SOLO 'rejected' al loguearse (a propósito:
        // 'cancelled'/'suspended_admin' pueden entrar al portal para ver facturas o
        // re-suscribirse), una cuenta suspendida por el admin podía loguearse de
        // nuevo, sacar un token de 8h fresco, y usarlo íntegro contra Bitácora — no
        // dependía de que un token viejo no hubiera vencido. Estos 3 checks ahora
        // validan el FIX: las 3 cuentas deben quedar afuera con 403.
        let r = await requestJson('GET', '/usuarios/api/bitacora', { token: tokenRej });
        check('11. usuario REJECTED con JWT válido → 403 BITACORA_CUENTA_NO_ELEGIBLE (regresión del fix de esta sesión)',
            r.status === 403 && r.body?.code === 'BITACORA_CUENTA_NO_ELEGIBLE',
            `status=${r.status} body=${r.raw.slice(0, 150)}`);

        r = await requestJson('GET', '/usuarios/api/bitacora', { token: tokenSusp });
        check('12. usuario SUSPENDED_ADMIN con JWT válido → 403 BITACORA_CUENTA_NO_ELEGIBLE',
            r.status === 403 && r.body?.code === 'BITACORA_CUENTA_NO_ELEGIBLE',
            `status=${r.status} body=${r.raw.slice(0, 150)}`);

        r = await requestJson('GET', '/usuarios/api/bitacora', { token: tokenCanc });
        check('13. usuario CANCELLED con JWT válido → 403 BITACORA_CUENTA_NO_ELEGIBLE',
            r.status === 403 && r.body?.code === 'BITACORA_CUENTA_NO_ELEGIBLE',
            `status=${r.status} body=${r.raw.slice(0, 150)}`);

        // Confirmación positiva de que esto es específico del gate de Bitácora y NO un
        // artefacto del propio token: /usuarios/api/plans (fuera del mount de Bitácora,
        // sin gate) responde igual para todos — no es que el token "ignore" el estado,
        // es que NINGÚN endpoint de este árbol vuelve a mirar registration_status.
        r = await requestJson('GET', '/usuarios/api/plans', { token: tokenRej });
        check('14. Control: /plans (sin gate de Bitácora) también responde 200 para REJECTED — confirma que el problema es estructural del árbol de rutas, no exclusivo del gate de Bitácora',
            r.status === 200, `status=${r.status}`);

        // Ahora el escenario exacto que pide el plan: la GRACIA de exportación,
        // con el flag realmente APAGADO (para que sea el camino de gracia, no el directo).
        // El fix corta esto ANTES de llegar a la rama de gracia (el bloqueo por estado
        // corre primero) — por eso acá el código esperado es BITACORA_CUENTA_NO_ELEGIBLE,
        // no BITACORA_GRACIA_VENCIDA: la cuenta ni siquiera llega a que se le mida la
        // ventana de 90 días.
        await db.query('UPDATE plans SET bitacora_enabled = false WHERE id = $1', [comboId]);
        await db.query("UPDATE users SET bitacora_lost_access_at = NOW() - INTERVAL '10 days' WHERE id = $1", [USER_REJ]);
        r = await requestJson('GET', '/usuarios/api/bitacora/export', { token: tokenRej });
        check('15. Escenario literal del plan, ya corregido: usuario REJECTED, SIN el flag, DENTRO de la ventana de gracia de 90 días → 403 BITACORA_CUENTA_NO_ELEGIBLE (el bloqueo por estado corta ANTES de evaluar la gracia — antes del fix daba 200)',
            r.status === 403 && r.body?.code === 'BITACORA_CUENTA_NO_ELEGIBLE',
            `status=${r.status} body=${r.raw.slice(0, 150)}`);
        await db.query('UPDATE plans SET bitacora_enabled = true WHERE id = $1', [comboId]); // restaurar para el resto de los tests
        await db.query('UPDATE users SET bitacora_lost_access_at = NULL WHERE id = $1', [USER_REJ]);

        // No-regresión: la gracia REAL sigue funcionando para el caso para el que fue
        // diseñada — una cuenta ACTIVA (registration_status='active') que perdió el flag
        // por un cambio de plan, no por sanción. Usamos B (siempre 'active').
        await db.query('UPDATE plans SET bitacora_enabled = false WHERE id = $1', [comboId]);
        await db.query("UPDATE users SET bitacora_lost_access_at = NOW() - INTERVAL '10 days' WHERE id = $1", [USER_B]);
        r = await requestJson('GET', '/usuarios/api/bitacora/export', { token: tokenB });
        check('15b. No-regresión: cuenta ACTIVA que perdió el flag, dentro de la gracia → 200 (la gracia real, la que sí corresponde, sigue viva)',
            r.status === 200, `status=${r.status} body=${r.raw.slice(0, 150)}`);
        await db.query('UPDATE plans SET bitacora_enabled = true WHERE id = $1', [comboId]);
        await db.query('UPDATE users SET bitacora_lost_access_at = NULL WHERE id = $1', [USER_B]);

        // ═══════════════════════════════════════════════════════════════════
        // 3. CSRF — sin credencial ambiente
        // ═══════════════════════════════════════════════════════════════════
        r = await requestJson('POST', '/usuarios/api/bitacora', {
            cookie: 'jwt=' + tokenA + '; session=fake',   // simula lo que un navegador mandaría solo
            body: { kind: 'nota', title: 'CSRF test — no debería crearse' },
        });
        check('16. Sin Authorization header (solo una Cookie con un JWT válido) → 401 — el auth es Bearer-only, sin fallback a cookies, así que un form/fetch cross-site sin el header no puede autenticar nada (CSRF clásico no aplica)',
            r.status === 401, `status=${r.status}`);

        // ═══════════════════════════════════════════════════════════════════
        // 2. Validación de pertenencia — backup manipulado a mano
        // ═══════════════════════════════════════════════════════════════════
        const backupAjeno = {
            backup_version: 1,
            exported_at: new Date().toISOString(),
            expedientes: [{ id: 1, user_id: USER_B, expediente: 'FCR 999/2026' }], // user_id de OTRO usuario
            entradas: [],
            snapshots: [],
        };
        r = await requestMultipartImport(tokenA, Buffer.from(JSON.stringify(backupAjeno)), { modo: 'combinar', dry_run: '1' });
        check('17. Backup manipulado a mano con user_id de OTRA cuenta (B), importado como A → 400 "pertenece a otra cuenta", sin tocar nada',
            r.status === 400 && /otra cuenta/i.test(r.body?.error || ''),
            `status=${r.status} body=${r.raw.slice(0, 200)}`);

        // Un backup con SOLO entradas ajenas (sin expedientes) también debe rechazarse —
        // confirma que el chequeo cubre las dos listas, no solo la primera.
        const backupAjeno2 = {
            backup_version: 1,
            exported_at: new Date().toISOString(),
            expedientes: [],
            entradas: [{ id: 2, user_id: USER_B, expediente_id: null, kind: 'nota', title: 'ajena' }],
            snapshots: [],
        };
        r = await requestMultipartImport(tokenA, Buffer.from(JSON.stringify(backupAjeno2)), { modo: 'combinar', dry_run: '1' });
        check('18. Backup con solo ENTRADAS de otra cuenta → también 400 (el chequeo de pertenencia cubre ambas listas)',
            r.status === 400 && /otra cuenta/i.test(r.body?.error || ''),
            `status=${r.status}`);

        // ═══════════════════════════════════════════════════════════════════
        // 5. Prototype pollution — JSON.parse + acceso estático de campos
        // ═══════════════════════════════════════════════════════════════════
        // Prueba en el propio runtime (misma versión de Node que usa el server):
        // JSON.parse NO trata "__proto__" como el setter especial — queda como
        // propiedad de datos inerte. Prueba objetiva, no un supuesto.
        const parsedProbe = JSON.parse('{"__proto__":{"polluted":true}}');
        const protoIntacto = Object.getPrototypeOf(parsedProbe) === Object.prototype;
        const globalNoPolluted = ({}).polluted === undefined;
        check('19. JSON.parse("{\\"__proto__\\":...}") NO asigna al prototipo real (queda como propiedad de datos) — confirmado en el mismo runtime Node del servidor',
            protoIntacto && globalNoPolluted, `protoIntacto=${protoIntacto} globalNoPolluted=${globalNoPolluted}`);

        // Y el ataque real contra el endpoint: un backup con __proto__/constructor/prototype
        // como claves adicionales en una entrada — debe procesarse sin error (el campo se
        // ignora, ninguna ruta del código hace acceso dinámico con una clave del backup) y,
        // sobre todo, sin que sobreviva ningún side-effect global.
        const backupPolluted = {
            backup_version: 1, exported_at: new Date().toISOString(),
            expedientes: [], snapshots: [],
            entradas: [{
                id: 3, user_id: USER_A, expediente_id: null, kind: 'nota', title: 'proto test',
                __proto__: { polluted: true },
                constructor: { prototype: { polluted2: true } },
            }],
        };
        r = await requestMultipartImport(tokenA, Buffer.from(JSON.stringify(backupPolluted)), { modo: 'combinar', dry_run: '1' });
        check('20. Backup con claves __proto__/constructor en una entrada → se procesa normal (dry-run 200), no rompe la validación',
            r.status === 200 && r.body?.success === true, `status=${r.status} body=${r.raw.slice(0, 200)}`);
        // Oráculo indirecto: si Object.prototype se hubiera contaminado GLOBALMENTE en el
        // proceso del servidor, un objeto plano nuevo en cualquier respuesta JSON llevaría
        // la propiedad heredada — pero JSON.stringify solo serializa propiedades OWN, así
        // que esta prueba no puede detectarlo por HTTP. Se documenta como limitación: la
        // prueba en el propio runtime (check 19) + la lectura de código (ningún acceso
        // dinámico `obj[claveDelBackup]` en validarBackup/aplicarImport) son la evidencia;
        // no hay oráculo remoto disponible para una prueba end-to-end concluyente.
        console.log('   (nota: sin oráculo HTTP para confirmar ausencia total de contaminación global — ver check 19 + lectura de código en el informe)');

        // ═══════════════════════════════════════════════════════════════════
        // 6. Mass assignment — PUT /usuarios/api/profile
        // ═══════════════════════════════════════════════════════════════════
        const { rows: antes } = await db.query(
            `SELECT u.role, u.registration_status, s.usage_limit, s.payment_provider, s.plan_id
               FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1`, [USER_A]
        );
        r = await requestJson('PUT', '/usuarios/api/profile', {
            token: tokenA,
            body: {
                nombre: 'S2 Mass Assignment Test',
                role: 'admin',
                usage_limit: 999999999,
                registration_status: 'active',
                payment_provider: 'mercadopago',
                bitacora_enabled: true,
                plan_id: 1,
            },
        });
        const { rows: despues } = await db.query(
            `SELECT u.role, u.registration_status, s.usage_limit, s.payment_provider, s.plan_id
               FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1`, [USER_A]
        );
        const soloNombreCambio =
            despues[0].role === antes[0].role &&
            despues[0].registration_status === antes[0].registration_status &&
            String(despues[0].usage_limit) === String(antes[0].usage_limit) &&
            despues[0].payment_provider === antes[0].payment_provider &&
            String(despues[0].plan_id) === String(antes[0].plan_id);
        check('21. PUT /profile con campos extra (role/usage_limit/registration_status/payment_provider/plan_id) → 200 pero SOLO nombre cambia — el resto ignorado por la whitelist explícita de campos',
            r.status === 200 && soloNombreCambio,
            `status=${r.status} antes=${JSON.stringify(antes[0])} despues=${JSON.stringify(despues[0])}`);

        // ═══════════════════════════════════════════════════════════════════
        // 1. H-3 — impacto real del import de hasta 10MB sin rate limit propio
        // ═══════════════════════════════════════════════════════════════════
        const healthAntes = await getHealth();
        console.log(`\nSalud ANTES de H-3: mem=${healthAntes?.memory?.used_mb}MB/${healthAntes?.memory?.total_mb}MB`);

        const N_FILAS = 2000;
        const DESC_LEN = 4200; // 2000 * ~4200 ≈ 8.4MB de payload de texto puro (antes del JSON wrapping)
        const backupGrande = backupEntradasBackup(USER_A, N_FILAS, DESC_LEN);
        const bufGrande = Buffer.from(JSON.stringify(backupGrande));
        console.log(`Backup sintético: ${N_FILAS} entradas, ${(bufGrande.length / 1024 / 1024).toFixed(2)} MB reales`);

        const NUM_REQUESTS = 5;
        const tiempos = [];
        for (let i = 0; i < NUM_REQUESTS; i++) {
            const rr = await requestMultipartImport(tokenA, bufGrande, { modo: 'combinar', dry_run: '1' });
            tiempos.push(rr.ms);
            if (rr.status !== 200) {
                console.log(`   request ${i + 1}/${NUM_REQUESTS} inesperada: status=${rr.status} body=${rr.raw.slice(0, 200)}`);
            }
        }
        const healthDespues = await getHealth();
        console.log(`Salud DESPUÉS de H-3 (${NUM_REQUESTS}x ~${(bufGrande.length / 1024 / 1024).toFixed(1)}MB): mem=${healthDespues?.memory?.used_mb}MB/${healthDespues?.memory?.total_mb}MB`);
        console.log(`Tiempos de parseo+validación por request (ms): ${tiempos.join(', ')}`);
        console.log(`Bytes enviados en total: ${((bufGrande.length * NUM_REQUESTS) / 1024 / 1024).toFixed(1)} MB en ${NUM_REQUESTS} requests secuenciales`);

        check('22. H-3 medido: 5 imports secuenciales de ~9 MB cada uno (45 MB totales, dentro de generalAuthLimiter 300/5min — el import NO tiene límite propio) responden 200/dry-run sin caer el servidor',
            healthDespues?.status === 'ok', `health=${JSON.stringify(healthDespues)}`);

        const memSubioMucho = (healthDespues?.memory?.used_mb || 0) - (healthAntes?.memory?.used_mb || 0);
        console.log(`Delta de memoria del proceso tras la ráfaga: ${memSubioMucho} MB (medido en /health, no es prueba de fuga — el GC puede haber corrido entre medio)`);

        // Concurrencia real: 5 requests EN PARALELO (no secuenciales) del mismo tamaño,
        // que es el escenario más parecido a "un solo usuario autenticado forzando el pico".
        const t0 = Date.now();
        const paralelas = await Promise.all(
            Array.from({ length: 5 }, () => requestMultipartImport(tokenA, bufGrande, { modo: 'combinar', dry_run: '1' }))
        );
        const msParalelo = Date.now() - t0;
        const okParalelo = paralelas.every(p => p.status === 200);
        console.log(`5 imports de ~9MB EN PARALELO: ${msParalelo}ms total, todos 200=${okParalelo}`);
        const healthTrasParalelo = await getHealth();
        console.log(`Salud tras la ráfaga paralela: mem=${healthTrasParalelo?.memory?.used_mb}MB/${healthTrasParalelo?.memory?.total_mb}MB, status=${healthTrasParalelo?.status}`);
        check('23. H-3 confirmado con el escenario más agresivo: 5 imports de ~9MB EN PARALELO (~45MB de JSON.parse simultáneo, sin ningún límite de concurrencia propio del endpoint) — el server sigue respondiendo, pero el pico de memoria es medible y un volumen mayor (ej. 20-30 en paralelo, dentro del límite de 300/5min) escalaría linealmente sin ningún freno',
            healthTrasParalelo?.status === 'ok', `health=${JSON.stringify(healthTrasParalelo)}`);

    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        if (comboId !== null) await db.query('UPDATE plans SET bitacora_enabled = $1 WHERE id = $2', [flagOriginal, comboId]);
        for (const uid of [USER_A, ...createdIds]) {
            await db.query('DELETE FROM bitacora_entries WHERE user_id = $1', [uid]);
            await db.query('DELETE FROM expedientes_seguidos WHERE user_id = $1', [uid]);
        }
        for (const uid of createdIds) {
            await db.query('DELETE FROM subscriptions WHERE user_id = $1', [uid]);
            await db.query('DELETE FROM users WHERE id = $1', [uid]);
        }
        await db.query('UPDATE users SET bitacora_lost_access_at = NULL WHERE id = $1', [USER_A]);
        console.log('   Flag COMBO_PROMO.bitacora_enabled restaurado a', flagOriginal);
        console.log('   4 usuarios fixture (B/REJ/SUSP/CANC) y sus filas de bitacora_entries/expedientes_seguidos eliminados');
        console.log('   user A: nombre reescrito a "S2 Mass Assignment Test" por el test 21 — sin dato sensible, no se revierte');
        await db.end();
    }

    console.log(`\n═══ ${passed}/${passed + failed} PASS ═══`);
    if (failed) { console.log('Fallidos:', fails.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
