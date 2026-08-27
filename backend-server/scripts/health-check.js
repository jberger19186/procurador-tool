/**
 * health-check.js — Salud automática de producción (mejora del smoke backend, Fase 1)
 *
 * Por qué existe: hoy NADA vigila el backend en producción de forma automática — la
 * tarjeta "Backend API" del dashboard es manual (llevaba 29 días sin correrse cuando se
 * escribió esto) y el smoke de CI corre contra STAGING, no contra prod. Este script
 * corre por su cuenta, fuera del proceso de Express, precisamente para poder avisar
 * aunque el backend esté caído — el punto ciego que un chequeo "adentro" del backend
 * nunca puede cubrir.
 *
 * 7 checks, todos de solo lectura:
 *   1. Heartbeat de crons — el cron de cobranza-retry (cada 6h, loguea SIEMPRE, con o
 *      sin trabajo) tuvo que aparecer en combined.log en las últimas 8h. Los otros 10
 *      crons de server.js solo loguean si tuvieron trabajo (`if (rowCount > 0)`) — no
 *      se puede usar su silencio como señal de fallo sin generar falsos positivos en
 *      un día tranquilo, así que se usa el único cron incondicional como proxy de "el
 *      scheduler de node-cron está vivo".
 *   2. Backup de anoche existe y pesa más que el umbral (backup-db.js corre a las 03:00).
 *   3. Certificado SSL de api.procuradortool.com con más de 20 días de vigencia.
 *   4. Disco < 80% usado y RAM libre por encima del umbral.
 *   5. Restarts de PM2 desde el último chequeo — un salto grande (>=3) es la firma de
 *      un crash-loop; 1 restart aislado es un deploy normal, no se alerta por eso.
 *   6. Integridad referencial en 4 relaciones críticas (LEFT JOIN, no `information_schema`:
 *      esto prueba el estado real de los datos, no solo que la constraint exista).
 *   7. error.log sin entradas nuevas desde el último chequeo.
 *
 * De paso (mismo commit, mismo motivo): agrega data-retention.js al crontab — cierra
 * H-1 de SEC-2, confirmado el 2026-08-27 que seguía sin ejecutarse nunca.
 *
 * Uso manual:   node health-check.js
 * Cron diario:  0 8 * * * node /ruta/health-check.js >> /var/log/procurador/health-check.log 2>&1
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { Pool } = require('pg');
const mailer = require('../utils/mailer');
const { decideHealthAlerts } = require('../utils/healthAlertCheck');
const { checkIntegridadReferencial: checkIntegridadDb } = require('../utils/dbIntegrityChecks');

const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    connectionTimeoutMillis: 5000,
});

const STATE_FILE = path.join(__dirname, '..', 'data', 'health-check-state.json');
const RESULTS_FILE = path.join(__dirname, '..', 'data', 'health-check-results.json');
const BACKUP_DIR = '/var/backups/procurador';
const CERT_NAME = 'api.procuradortool.com';
const CERT_MIN_DAYS = 20;
const DISK_MAX_PERCENT = 80;
const RAM_MIN_FREE_MB = 200;
const PM2_APP_NAME = 'procurador-api';
const RESTART_CRASHLOOP_THRESHOLD = 3;
const BACKUP_MIN_BYTES = 100 * 1024; // 100 KB — un dump vacío/corrupto pesa mucho menos
const CRON_HEARTBEAT_MAX_HOURS = 8; // cobranza-retry corre cada 6h
const HISTORY_MAX = 30;

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadJson(file, fallback) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    return fallback;
}

function saveJson(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Lee las últimas `maxLines` líneas de un archivo de log JSON-por-línea (formato de
// utils/logger.js) sin cargar el archivo entero — combined.log ya pesa varios MB.
function tailJsonLines(file, maxLines = 4000) {
    try {
        if (!fs.existsSync(file)) return [];
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const tail = lines.slice(-maxLines);
        const out = [];
        for (const line of tail) {
            try { out.push(JSON.parse(line)); } catch (_) { /* línea no-JSON, se ignora */ }
        }
        return out;
    } catch (_) {
        return [];
    }
}

// ── Checks ───────────────────────────────────────────────────────────────────

async function checkCronHeartbeat() {
    const id = 'cron_heartbeat';
    const entries = tailJsonLines('/var/log/procurador/combined.log');
    const cutoff = Date.now() - CRON_HEARTBEAT_MAX_HOURS * 3600 * 1000;
    const latimo = entries
        .filter(e => typeof e.message === 'string' && e.message.startsWith('[CRON] cobranza-retry:'))
        .map(e => new Date(e.timestamp).getTime())
        .filter(t => !isNaN(t))
        .sort((a, b) => b - a)[0];

    if (latimo && latimo >= cutoff) {
        return { id, ok: true, message: `último heartbeat hace ${((Date.now() - latimo) / 3600000).toFixed(1)}h` };
    }

    // Evitar falso positivo justo después de un restart: si el proceso lleva menos
    // que el intervalo del cron corriendo, todavía no tuvo chance de loguear.
    try {
        const { stdout } = await execFileAsync('pm2', ['jlist']);
        const list = JSON.parse(stdout);
        const app = list.find(p => p.name === PM2_APP_NAME);
        const uptimeH = app ? (Date.now() - app.pm2_env.pm_uptime) / 3600000 : null;
        if (uptimeH !== null && uptimeH < CRON_HEARTBEAT_MAX_HOURS) {
            return { id, ok: true, message: `proceso recién reiniciado (${uptimeH.toFixed(1)}h de uptime), sin heartbeat esperado aún` };
        }
    } catch (_) { /* si pm2 falla acá, seguimos al resultado de fallo por log */ }

    return { id, ok: false, message: `sin heartbeat de cron en las últimas ${CRON_HEARTBEAT_MAX_HOURS}h — el scheduler puede estar caído` };
}

function checkBackupReciente() {
    const id = 'backup_reciente';
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => /^procurador_db_\d{8}_\d{6}\.sql/.test(f))
            .map(f => ({ f, stat: fs.statSync(path.join(BACKUP_DIR, f)) }))
            .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

        if (files.length === 0) return { id, ok: false, message: `sin ningún backup en ${BACKUP_DIR}` };

        const latest = files[0];
        const ageH = (Date.now() - latest.stat.mtimeMs) / 3600000;
        if (ageH > 30) return { id, ok: false, message: `el backup más reciente (${latest.f}) tiene ${ageH.toFixed(0)}h — el cron de las 03:00 no corrió` };
        if (latest.stat.size < BACKUP_MIN_BYTES) return { id, ok: false, message: `el backup más reciente (${latest.f}) pesa ${latest.stat.size}B — sospechosamente chico` };

        return { id, ok: true, message: `${latest.f}, ${(latest.stat.size / 1024).toFixed(0)}KB, hace ${ageH.toFixed(1)}h` };
    } catch (err) {
        return { id, ok: false, message: `no se pudo leer ${BACKUP_DIR}: ${err.message}` };
    }
}

async function checkCertSsl() {
    const id = 'cert_ssl';
    try {
        const { stdout } = await execFileAsync('certbot', ['certificates']);
        const idx = stdout.indexOf(`Certificate Name: ${CERT_NAME}`);
        if (idx === -1) return { id, ok: false, message: `certbot no reporta ningún cert para ${CERT_NAME}` };
        const chunk = stdout.slice(idx, idx + 400);
        const m = chunk.match(/VALID:\s*(\d+)\s*days/);
        if (!m) return { id, ok: false, message: 'no se pudo parsear la vigencia del cert' };
        const days = parseInt(m[1], 10);
        if (days < CERT_MIN_DAYS) return { id, ok: false, message: `vence en ${days} días (umbral: ${CERT_MIN_DAYS})` };
        return { id, ok: true, message: `vence en ${days} días` };
    } catch (err) {
        return { id, ok: false, message: `certbot certificates falló: ${err.message}` };
    }
}

async function checkDiscoYRam() {
    const id = 'disco_ram';
    try {
        const { stdout: dfOut } = await execFileAsync('df', ['-h', '/']);
        const dfLine = dfOut.trim().split('\n')[1];
        const pctMatch = dfLine.match(/(\d+)%/);
        const discoPct = pctMatch ? parseInt(pctMatch[1], 10) : null;

        const { stdout: freeOut } = await execFileAsync('free', ['-m']);
        const memLine = freeOut.split('\n').find(l => l.startsWith('Mem:'));
        const cols = memLine.trim().split(/\s+/); // Mem: total used free shared buff/cache available
        const ramFreeMb = parseInt(cols[cols.length - 1], 10); // "available" es la última columna

        const problemas = [];
        if (discoPct !== null && discoPct > DISK_MAX_PERCENT) problemas.push(`disco al ${discoPct}%`);
        if (!isNaN(ramFreeMb) && ramFreeMb < RAM_MIN_FREE_MB) problemas.push(`RAM disponible ${ramFreeMb}MB`);

        if (problemas.length > 0) return { id, ok: false, message: problemas.join(' · ') };
        return { id, ok: true, message: `disco ${discoPct}%, RAM disponible ${ramFreeMb}MB` };
    } catch (err) {
        return { id, ok: false, message: `no se pudo medir disco/RAM: ${err.message}` };
    }
}

async function checkRestartsPm2(state) {
    const id = 'restarts_pm2';
    try {
        const { stdout } = await execFileAsync('pm2', ['jlist']);
        const list = JSON.parse(stdout);
        const app = list.find(p => p.name === PM2_APP_NAME);
        if (!app) return { id, ok: false, message: `PM2 no reporta el proceso "${PM2_APP_NAME}"` };

        const restarts = app.pm2_env.restart_time;
        const prev = state.lastRestartCount;
        state.lastRestartCount = restarts;

        if (app.pm2_env.status !== 'online') return { id, ok: false, message: `estado PM2: ${app.pm2_env.status}` };
        if (typeof prev === 'number') {
            const delta = restarts - prev;
            if (delta >= RESTART_CRASHLOOP_THRESHOLD) {
                return { id, ok: false, message: `+${delta} restarts desde el último chequeo — posible crash-loop (total: ${restarts})` };
            }
        }
        return { id, ok: true, message: `online, ${restarts} restarts acumulados` };
    } catch (err) {
        return { id, ok: false, message: `pm2 jlist falló: ${err.message}` };
    }
}

async function checkIntegridadReferencial() {
    const id = 'integridad_referencial';
    try {
        const r = await checkIntegridadDb(db);
        return { id, ...r };
    } catch (err) {
        return { id, ok: false, message: `error consultando la DB: ${err.message}` };
    }
}

function checkErrorLogReciente(state) {
    const id = 'error_log_reciente';
    const cutoff = state.lastCheckAt ? new Date(state.lastCheckAt).getTime() : Date.now() - 24 * 3600 * 1000;
    const entries = tailJsonLines('/var/log/procurador/error.log', 2000)
        .filter(e => {
            const t = new Date(e.timestamp).getTime();
            return !isNaN(t) && t > cutoff;
        });

    if (entries.length > 0) {
        const primero = entries[0].message || '(sin mensaje)';
        return { id, ok: false, message: `${entries.length} entrada(s) nueva(s) desde el último chequeo — primera: "${String(primero).slice(0, 120)}"` };
    }
    return { id, ok: true, message: 'sin entradas nuevas' };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    log('▶ Iniciando health-check...');

    const state = loadJson(STATE_FILE, { alerting: {}, lastRestartCount: null, lastCheckAt: null });

    const checks = [];
    checks.push(await checkCronHeartbeat());
    checks.push(checkBackupReciente());
    checks.push(await checkCertSsl());
    checks.push(await checkDiscoYRam());
    checks.push(await checkRestartsPm2(state));
    checks.push(await checkIntegridadReferencial());
    checks.push(checkErrorLogReciente(state));

    for (const c of checks) {
        log(`${c.ok ? '✅' : '❌'} ${c.id}: ${c.message}`);
    }

    const passed = checks.filter(c => c.ok).length;
    log(`RESULTADO: ${passed}/${checks.length}`);

    const { toAlert, changed } = decideHealthAlerts(checks, state);
    if (toAlert.length > 0) {
        log(`📧 Enviando alerta por ${toAlert.length} chequeo(s) nuevo(s) en rojo...`);
        try {
            await mailer.sendHealthAlert(toAlert);
        } catch (err) {
            log(`❌ Error enviando alerta: ${err.message}`);
        }
    }

    state.lastCheckAt = new Date().toISOString();
    saveJson(STATE_FILE, state);

    const results = loadJson(RESULTS_FILE, { latest: null, history: [] });
    const entry = { timestamp: new Date().toISOString(), ok: passed === checks.length, passed, total: checks.length, checks };
    results.latest = entry;
    results.history = [entry, ...(results.history || [])].slice(0, HISTORY_MAX);
    saveJson(RESULTS_FILE, results);

    await db.end();
    log('Fin.');
}

main().catch(err => {
    log(`❌ Error fatal en health-check.js: ${err.message}`);
    process.exit(0); // no queremos que un fallo del script rompa el exit code del cron
});
