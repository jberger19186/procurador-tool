/**
 * verify-f34-bloqueB-ics.js — Bloque B del plan F3.4 (export .ics de Bitácora).
 *
 * Ejercita GET /usuarios/api/bitacora/export?formato=ics con HTTP real contra
 * localhost:3444 (bypassa nginx/basic-auth, corre EN el servidor de staging),
 * y PARSEA el .ics devuelto (unfolding + unescaping manual según RFC 5545,
 * sin librerías externas) — no alcanza con "el archivo se descarga" (§B.5
 * del plan `docs/internal/plan-f3-4-semana-e-ics-2026-08.md`).
 *
 * ⚠️ REGLA DURA: aborta si DB_NAME no contiene 'staging'. Nunca correr esto
 * sin ese guard — ver el incidente del 2026-07-24 documentado en CLAUDE.md.
 *
 * Uso (en el servidor, dentro de /var/www/procurador-staging/backend-server):
 *   node -r dotenv/config dev-tools/verify-f34-bloqueB-ics.js dotenv_config_path=.env.staging
 */

'use strict';

const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

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

function requestRaw(method, path, { token } = {}) {
    return new Promise((resolve, reject) => {
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const req = https.request(BASE_URL + path, { method, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                raw: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        req.on('error', reject);
        req.end();
    });
}

function tokenFor(userId, extra = {}) {
    return jwt.sign({ id: userId, role: 'user', ...extra }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Parser mínimo de iCalendar (RFC 5545), sin librerías ────────────────────
// 1) Unfold: una línea de continuación empieza con un espacio y se pega a la
//    anterior SIN el espacio inicial (§3.1).
// 2) Split en VEVENT.
// 3) Cada línea NAME[;params]:VALUE — solo nos interesa NAME y VALUE.
// 4) Unescape de VALUE: \\ → \ , \; → ; , \, → , , \n o \N → salto de línea
//    (orden inverso al de icsEscapeText en el backend).
function unfoldIcs(raw) {
    const lineasCrudas = raw.split('\r\n');
    const lineas = [];
    for (const l of lineasCrudas) {
        if (l.startsWith(' ') && lineas.length > 0) {
            lineas[lineas.length - 1] += l.slice(1);
        } else if (l.length > 0) {
            lineas.push(l);
        }
    }
    return lineas;
}

function unescapeIcsValue(v) {
    let out = '';
    for (let i = 0; i < v.length; i++) {
        if (v[i] === '\\' && i + 1 < v.length) {
            const next = v[i + 1];
            if (next === 'n' || next === 'N') { out += '\n'; i++; continue; }
            if (next === ';' || next === ',' || next === '\\') { out += next; i++; continue; }
        }
        out += v[i];
    }
    return out;
}

function parseVevents(raw) {
    const lineas = unfoldIcs(raw);
    const vevents = [];
    let actual = null;
    for (const linea of lineas) {
        if (linea === 'BEGIN:VEVENT') { actual = {}; continue; }
        if (linea === 'END:VEVENT') { if (actual) vevents.push(actual); actual = null; continue; }
        if (!actual) continue;
        const idx = linea.indexOf(':');
        if (idx === -1) continue;
        const propRaw = linea.slice(0, idx);   // ej "DTSTART;VALUE=DATE"
        const value = linea.slice(idx + 1);
        const nombre = propRaw.split(';')[0];
        const params = propRaw.includes(';') ? propRaw.slice(propRaw.indexOf(';') + 1) : '';
        actual[nombre] = { value: unescapeIcsValue(value), rawValue: value, params };
    }
    return vevents;
}

// "Hoy" en horario argentino (ART, UTC-3) — el mismo cálculo que hace el
// backend leyendo `due_at` con getters UTC (ver icsDiaCalendarioUtc).
function artTodayYmd8() {
    const now = new Date(Date.now() - 3 * 60 * 60 * 1000); // corrimiento a ART
    const p = n => String(n).padStart(2, '0');
    return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
}
function artTodayIsoMidday() {
    const ymd8 = artTodayYmd8();
    const y = ymd8.slice(0, 4), m = ymd8.slice(4, 6), d = ymd8.slice(6, 8);
    return new Date(`${y}-${m}-${d}T12:00:00-03:00`).toISOString();
}

async function main() {
    console.log(`▶ F3.4 Bloque B — export .ics de Bitácora contra ${BASE_URL} (DB_NAME=${process.env.DB_NAME})\n`);

    const USER_A = 215;
    let comboId = null, flagOriginal = null;
    const idsCreados = [];

    try {
        const { rows: planRows } = await db.query(
            "SELECT id, bitacora_enabled FROM plans WHERE name = 'COMBO_PROMO'"
        );
        comboId = planRows[0].id;
        flagOriginal = planRows[0].bitacora_enabled;

        // ── 1. Gate sin flag → 403 ──────────────────────────────────────────
        await db.query('UPDATE plans SET bitacora_enabled = false WHERE id = $1', [comboId]);
        const tokenA = tokenFor(USER_A);
        let r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=ics&alcance=todo', { token: tokenA });
        check('1. Sin bitacora_enabled → 403', r.status === 403, `status=${r.status}`);

        await db.query('UPDATE plans SET bitacora_enabled = true WHERE id = $1', [comboId]);

        // ── Fixtures de entradas ─────────────────────────────────────────────
        const hoyIso = artTodayIsoMidday();
        const hoyYmd8 = artTodayYmd8();

        const tituloEspecial = 'Contestar demanda; "ARCA C/ NIETOS", s.a.s. \\ fin';
        const descEspecial = 'Primera línea\nSegunda línea con, coma y; punto y coma';

        const insertar = async (campos) => {
            const { rows } = await db.query(
                `INSERT INTO bitacora_entries (user_id, kind, title, description, due_at, all_day, repeat_rule, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING id`,
                [USER_A, campos.kind || 'vencimiento', campos.title, campos.description || null,
                 campos.due_at || null, campos.all_day, campos.repeat_rule || null]
            );
            idsCreados.push(rows[0].id);
            return rows[0].id;
        };

        const idAllDay = await insertar({ title: tituloEspecial, description: descEspecial, due_at: hoyIso, all_day: true });
        const idConHora = await insertar({ title: 'Audiencia con hora', kind: 'audiencia', due_at: hoyIso, all_day: false });
        const idMensual = await insertar({ title: 'Tarea mensual', kind: 'tarea', due_at: hoyIso, all_day: true, repeat_rule: 'monthly' });
        const idSinFecha = await insertar({ title: 'Nota sin fecha', kind: 'nota', due_at: null, all_day: true });

        // ── 2. Los 3 alcances devuelven Content-Type text/calendar ──────────
        for (const alcance of ['todo', 'entradas', 'expediente']) {
            const qs = alcance === 'expediente' ? '' : ''; // 'expediente' sin expediente_id cae a 404, se prueba aparte
            if (alcance === 'expediente') continue;
            r = await requestRaw('GET', `/usuarios/api/bitacora/export?formato=ics&alcance=${alcance}`, { token: tokenA });
            check(`2. alcance=${alcance} → Content-Type text/calendar`,
                r.status === 200 && /text\/calendar/.test(r.headers['content-type'] || ''),
                `status=${r.status} ct=${r.headers['content-type']}`);
        }

        // ── El export completo (alcance=todo) es el que usamos para el resto ──
        r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=ics&alcance=todo', { token: tokenA });
        check('3. Cabecera VCALENDAR/VERSION/PRODID presentes',
            /BEGIN:VCALENDAR/.test(r.raw) && /VERSION:2\.0/.test(r.raw) && /PRODID:-\/\/Procurador SCW/.test(r.raw));

        const vevents = parseVevents(r.raw);
        const porId = new Map();
        for (const v of vevents) {
            const uidMatch = (v.UID?.value || '').match(/^bitacora-(\d+)@/);
            if (uidMatch) porId.set(Number(uidMatch[1]), v);
        }

        check('4. Cantidad de VEVENT = cantidad de entradas CON due_at (3, no 4)',
            vevents.length === 3, `vevents=${vevents.length}`);

        check('5. La entrada sin due_at NO aparece en el .ics',
            !porId.has(idSinFecha), `presente=${porId.has(idSinFecha)}`);

        // ── 6. all_day=true → DTSTART;VALUE=DATE + DTEND al día siguiente ───
        const vAllDay = porId.get(idAllDay);
        const diaSiguienteEsperado = (() => {
            const y = Number(hoyYmd8.slice(0, 4)), m = Number(hoyYmd8.slice(4, 6)), d = Number(hoyYmd8.slice(6, 8));
            const dt = new Date(Date.UTC(y, m - 1, d + 1));
            const p = n => String(n).padStart(2, '0');
            return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
        })();
        check('6. all_day=true → DTSTART;VALUE=DATE es el día calendario correcto (hoy, no ayer)',
            !!vAllDay && vAllDay.DTSTART?.params === 'VALUE=DATE' && vAllDay.DTSTART.value === hoyYmd8,
            `DTSTART=${vAllDay?.DTSTART?.rawValue} esperado=${hoyYmd8}`);
        check('7. all_day=true → DTEND;VALUE=DATE es el día SIGUIENTE (exclusivo, RFC 5545)',
            !!vAllDay && vAllDay.DTEND?.params === 'VALUE=DATE' && vAllDay.DTEND.value === diaSiguienteEsperado,
            `DTEND=${vAllDay?.DTEND?.rawValue} esperado=${diaSiguienteEsperado}`);

        // ── 8. all_day=false → DTSTART con hora (sin VALUE=DATE) ────────────
        const vConHora = porId.get(idConHora);
        check('8. all_day=false → DTSTART con hora (formato AAAAMMDDTHHMMSSZ, sin VALUE=DATE)',
            !!vConHora && !vConHora.DTSTART?.params && /^\d{8}T\d{6}Z$/.test(vConHora.DTSTART?.rawValue || ''),
            `DTSTART=${vConHora?.DTSTART?.rawValue}`);

        // ── 9. Escapado: el título con ; , y \ sale ESCAPADO — se busca sobre
        //     el texto ya DESPLEGADO (unfold), no sobre el raw con CRLF: el
        //     plegado a 75 octetos puede partir la secuencia de escape justo
        //     entre el backslash y el carácter siguiente, y buscar en el raw
        //     tal cual daría un falso negativo sobre un escapado correcto.
        const lineasSummary = unfoldIcs(r.raw).find(l => l.startsWith('SUMMARY:')) || '';
        check('9. SUMMARY con ; , y \\ escapados (verificado sobre el texto ya desplegado)',
            /\\;/.test(lineasSummary) && /\\,/.test(lineasSummary) && new RegExp(String.raw`\\\\`).test(lineasSummary),
            `SUMMARY desplegado=${lineasSummary}`);
        check('10. El parser recupera el título original tras des-escapar',
            !!vAllDay && vAllDay.SUMMARY?.value.includes(tituloEspecial),
            `SUMMARY=${vAllDay?.SUMMARY?.value}`);
        check('11. DESCRIPTION con salto de línea real tras des-escapar (\\n → newline)',
            !!vAllDay && vAllDay.DESCRIPTION?.value.includes(descEspecial.split('\n')[0]) &&
            vAllDay.DESCRIPTION?.value.includes('\n'),
            `DESCRIPTION=${JSON.stringify(vAllDay?.DESCRIPTION?.value)}`);

        // ── 12. repeat_rule='monthly' → RRULE:FREQ=MONTHLY ──────────────────
        const vMensual = porId.get(idMensual);
        check('12. repeat_rule=monthly → RRULE:FREQ=MONTHLY',
            !!vMensual && vMensual.RRULE?.value === 'FREQ=MONTHLY',
            `RRULE=${vMensual?.RRULE?.value}`);

        // ── 13. UID estable (mismo id → mismo UID en 2 pedidos distintos) ───
        const r2 = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=ics&alcance=todo', { token: tokenA });
        const vevents2 = parseVevents(r2.raw);
        const uidsPrimeraCorrida = vevents.map(v => v.UID?.value).sort();
        const uidsSegundaCorrida = vevents2.map(v => v.UID?.value).sort();
        check('13. UID estable entre 2 exports consecutivos (no cambia, evita duplicar al reimportar)',
            JSON.stringify(uidsPrimeraCorrida) === JSON.stringify(uidsSegundaCorrida));

        // ── 14. DTSTAMP presente en cada VEVENT (obligatorio por RFC) ───────
        check('14. Los 3 VEVENT tienen DTSTAMP', vevents.every(v => !!v.DTSTAMP));

        // ── 15. alcance=expediente sin expediente_id → 404 (no-regresión) ───
        r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=ics&alcance=expediente', { token: tokenA });
        check('15. alcance=expediente sin expediente_id → 404', r.status === 404, `status=${r.status}`);

        // ── 16-17. No-regresión: xlsx y json siguen funcionando igual ───────
        r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=xlsx&alcance=todo', { token: tokenA });
        check('16. formato=xlsx sigue devolviendo el content-type de siempre (no-regresión)',
            r.status === 200 && /spreadsheetml/.test(r.headers['content-type'] || ''));
        r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=json&alcance=todo', { token: tokenA });
        check('17. formato=json sigue devolviendo application/json (no-regresión)',
            r.status === 200 && /application\/json/.test(r.headers['content-type'] || ''));

        // ── 18. formato desconocido cae al whitelist (xlsx), no rompe ───────
        r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=csv-inventado&alcance=todo', { token: tokenA });
        check('18. formato inválido cae al default xlsx (whitelist, no ternario roto)',
            r.status === 200 && /spreadsheetml/.test(r.headers['content-type'] || ''));

        // ── 19. Ventana de gracia (90 días) sigue funcionando con .ics ──────
        await db.query('UPDATE plans SET bitacora_enabled = false WHERE id = $1', [comboId]);
        await db.query("UPDATE users SET bitacora_lost_access_at = NOW() - INTERVAL '10 days' WHERE id = $1", [USER_A]);
        r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=ics&alcance=todo', { token: tokenA });
        check('19. .ics respeta la gracia de 90 días: perdido hace 10 días → 200', r.status === 200, `status=${r.status}`);
        await db.query("UPDATE users SET bitacora_lost_access_at = NOW() - INTERVAL '100 days' WHERE id = $1", [USER_A]);
        r = await requestRaw('GET', '/usuarios/api/bitacora/export?formato=ics&alcance=todo', { token: tokenA });
        check('20. .ics respeta la gracia de 90 días: perdido hace 100 días → 403 (gracia vencida)', r.status === 403, `status=${r.status}`);

    } catch (e) {
        console.error('❌ Error inesperado en el harness:', e);
        failed++;
    } finally {
        console.log('\n🧹 Limpiando fixtures...');
        if (idsCreados.length > 0) await db.query('DELETE FROM bitacora_entries WHERE id = ANY($1)', [idsCreados]);
        if (comboId !== null) await db.query('UPDATE plans SET bitacora_enabled = $1 WHERE id = $2', [flagOriginal, comboId]);
        await db.query('UPDATE users SET bitacora_lost_access_at = NULL WHERE id = $1', [USER_A]);
        await db.end();
        console.log(`   ${idsCreados.length} entradas de fixture borradas`);
        console.log(`   plans.bitacora_enabled restaurado a ${flagOriginal}`);
        console.log('   users.bitacora_lost_access_at → NULL');
    }

    console.log(`\n${passed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.log('Fallidas:', fails.join(' | '));
        process.exit(1);
    }
}

main();
