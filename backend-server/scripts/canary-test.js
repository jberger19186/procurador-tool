/**
 * canary-test.js — Test diario del portal PJN
 *
 * Qué hace:
 *   1. Hace GET a la página de login del portal PJN
 *   2. Verifica que los selectores críticos existen en el HTML
 *   3. Si algo falla → envía alerta por email
 *   4. Loggea el resultado (éxito o fallo)
 *
 * Uso manual:   node canary-test.js
 * Cron diario:  0 7 * * * node /ruta/canary-test.js >> /var/log/procurador/canary.log 2>&1
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios     = require('axios');
const cheerio   = require('cheerio');
const nodemailer = require('nodemailer');

// ── URLs y selectores críticos del portal PJN ───────────────
const PJN_LOGIN_URL = 'https://sso.pjn.gov.ar/auth/realms/pjn/protocol/openid-connect/auth?client_id=pjn-portal&redirect_uri=https%3A%2F%2Fportalpjn.pjn.gov.ar%2Fauth%2Fcallback&response_type=code&scope=openid';

const SELECTORS_CRITICOS = [
    { nombre: 'Campo usuario',    selector: '#username'  },
    { nombre: 'Campo contraseña', selector: '#password'  },
    { nombre: 'Botón login',      selector: '#kc-login'  }
];

// ── Config email ────────────────────────────────────────────
const ALERT_TO   = process.env.ALERT_EMAIL_TO;
const SMTP_HOST  = process.env.SMTP_HOST  || 'smtp.gmail.com';
const SMTP_PORT  = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER  = process.env.SMTP_USER;
const SMTP_PASS  = process.env.SMTP_PASS;

// ── Helpers ─────────────────────────────────────────────────
function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function enviarAlerta(fallos) {
    if (!SMTP_USER || !SMTP_PASS || !ALERT_TO) {
        log('⚠️  Email no configurado — alerta no enviada (configurar SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO)');
        return;
    }

    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: false,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const listaFallos = fallos.map(f => `  • ${f.nombre}: selector "${f.selector}" no encontrado`).join('\n');

    await transporter.sendMail({
        from: `"Procurador SCW Monitor" <${SMTP_USER}>`,
        to: ALERT_TO,
        subject: `⚠️ [Procurador SCW] Canary FAIL — ${new Date().toLocaleDateString('es-AR')}`,
        text: [
            `El canary test detectó cambios en el portal PJN que pueden romper las automatizaciones.`,
            ``,
            `Selectores no encontrados:`,
            listaFallos,
            ``,
            `URL verificada: ${PJN_LOGIN_URL}`,
            `Hora: ${new Date().toISOString()}`,
            ``,
            `Revisá antes de que los usuarios reporten el problema.`
        ].join('\n')
    });

    log(`📧 Alerta enviada a ${ALERT_TO}`);
}

// ── Main ─────────────────────────────────────────────────────
async function runCanary() {
    log(`🐤 Iniciando canary test del portal PJN...`);

    let html;
    try {
        const response = await axios.get(PJN_LOGIN_URL, {
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProcuradorSCW-Monitor/1.0)' },
            maxRedirects: 5
        });
        html = response.data;
        log(`✅ Portal PJN respondió (HTTP ${response.status})`);
    } catch (err) {
        const msg = `❌ No se pudo acceder al portal PJN: ${err.message}`;
        log(msg);
        await enviarAlerta([{ nombre: 'Acceso al portal', selector: PJN_LOGIN_URL, error: err.message }]);
        process.exit(1);
    }

    // Verificar selectores
    const $ = cheerio.load(html);
    const fallos = [];

    for (const { nombre, selector } of SELECTORS_CRITICOS) {
        const encontrado = $(selector).length > 0;
        if (encontrado) {
            log(`  ✅ ${nombre} (${selector})`);
        } else {
            log(`  ❌ ${nombre} (${selector}) — NO ENCONTRADO`);
            fallos.push({ nombre, selector });
        }
    }

    if (fallos.length > 0) {
        log(`\n⚠️  Canary FAIL — ${fallos.length} selector(es) no encontrado(s)`);
        await enviarAlerta(fallos);
        process.exit(1);
    } else {
        log(`\n✅ Canary OK — todos los selectores presentes`);
        process.exit(0);
    }
}

runCanary().catch(err => {
    log(`❌ Error fatal en canary test: ${err.message}`);
    process.exit(1);
});
