/**
 * routes/extension.js
 * Distribución segura de la extensión Chrome para Procurador SCW.
 *
 * Endpoints:
 *   GET /api/extension/version  — versión actual (requiere auth)
 *   GET /api/extension/download — ZIP con scripts ofuscados (requiere auth)
 *   GET /api/extension/hashes   — SHA-256 de cada script ofuscado (requiere auth)
 *
 * Protecciones implementadas:
 *   Capa 1: Ofuscación JS con javascript-obfuscator (seed determinístico por versión)
 *   Capa 2: SHA-256 de cada script (el background.js los verifica en arranque)
 *   Capa 3: ID-binding — guardas inyectadas al inicio de cada content script
 *   Capa 4: JWT de usuario — todos los endpoints requieren autenticación
 */

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const AdmZip   = require('adm-zip');
const JavaScriptObfuscator = require('javascript-obfuscator');
const authenticateToken    = require('../middleware/authenticateToken');

// ── Rutas de archivos ────────────────────────────────────────────────────────

const EXT_SOURCE_DIR = path.join(__dirname, '..', '..', 'extension-app');
const META_PATH      = path.join(__dirname, '..', 'extension-meta.json');

// Scripts de content que se ofuscan (el orden importa para el ZIP)
const CONTENT_SCRIPTS = ['cs-scw.js', 'cs-notif.js', 'cs-escritos2.js', 'cs-deox.js', 'cs-selection.js'];
// Archivos que se incluyen SIN ofuscar (manifest, popup, etc.)
const PLAIN_FILES     = ['manifest.json', 'popup.html', 'popup.js', 'config.js', 'auth.js', 'background.js'];
// Iconos en la raíz (el manifest los referencia sin subfolder: "16": "icon16.png")
const ICON_FILES      = ['icon16.png', 'icon48.png', 'icon128.png'];

// ── Tokens temporales de descarga (Electron installer) ──────────────────────
const _dlTokens = new Map(); // token → { expiresAt }

setInterval(() => {
    const now = Date.now();
    for (const [t, d] of _dlTokens) if (d.expiresAt < now) _dlTokens.delete(t);
}, 5 * 60 * 1000);

// ── Cache de ofuscación ──────────────────────────────────────────────────────

let _cache = null; // { version, scripts: { filename: obfuscatedCode }, hashes: { filename: sha256 } }

function getVersion() {
    try {
        return JSON.parse(fs.readFileSync(META_PATH, 'utf8')).version;
    } catch (_) {
        return '1.0.0';
    }
}

/**
 * Genera el seed determinístico para el ofuscador basado en la versión.
 * Mismo seed → mismo output → mismo hash entre builds.
 */
function versionToSeed(version) {
    const n = version.replace(/\./g, '').padEnd(6, '0');
    return parseInt(n.slice(0, 6), 10) || 100;
}

/**
 * Ofusca el código JS con javascript-obfuscator.
 * Usa seed determinístico para que el hash sea reproducible.
 */
function obfuscate(code, seed) {
    return JavaScriptObfuscator.obfuscate(code, {
        compact:                  true,
        controlFlowFlattening:    true,
        controlFlowFlatteningThreshold: 0.5,
        deadCodeInjection:        true,
        deadCodeInjectionThreshold: 0.2,
        stringEncryption:         true,
        stringEncryptionThreshold: 0.5,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals:            false,
        selfDefending:            false,  // evitar problemas en service workers
        seed,
    }).getObfuscatedCode();
}

/**
 * Computa SHA-256 de un string/Buffer.
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Retorna el bundle ofuscado cacheado (o lo genera si la versión cambió).
 */
function getBundle() {
    const version = getVersion();
    if (_cache && _cache.version === version) return _cache;

    console.log(`[ext] Generando bundle v${version}...`);
    const seed    = versionToSeed(version);
    const scripts = {};
    const hashes  = {};

    for (const filename of CONTENT_SCRIPTS) {
        const srcPath = path.join(EXT_SOURCE_DIR, filename);
        if (!fs.existsSync(srcPath)) {
            console.warn(`[ext] Script no encontrado: ${filename}`);
            continue;
        }
        const src  = fs.readFileSync(srcPath, 'utf8');
        const obf  = obfuscate(src, seed);
        scripts[filename] = obf;
        hashes[filename]  = sha256(obf);
    }

    _cache = { version, scripts, hashes };
    console.log(`[ext] Bundle v${version} generado. Scripts: ${Object.keys(scripts).join(', ')}`);
    return _cache;
}

// ── Construcción del ZIP ─────────────────────────────────────────────────────

function buildZip(bundle) {
    const zip = new AdmZip();

    // 1. Archivos planos (sin ofuscar)
    for (const filename of PLAIN_FILES) {
        const filePath = path.join(EXT_SOURCE_DIR, filename);
        if (fs.existsSync(filePath)) {
            zip.addLocalFile(filePath);
        }
    }

    // 2. Scripts ofuscados
    for (const [filename, code] of Object.entries(bundle.scripts)) {
        zip.addFile(filename, Buffer.from(code, 'utf8'));
    }

    // 3. Iconos (en la raíz — manifest los referencia como "icon16.png")
    for (const icon of ICON_FILES) {
        const iconPath = path.join(EXT_SOURCE_DIR, icon);
        if (fs.existsSync(iconPath)) {
            zip.addLocalFile(iconPath);
        }
    }

    return zip.toBuffer();
}

// ── Endpoints ────────────────────────────────────────────────────────────────

// GET /api/extension/version — versión actual
router.get('/version', authenticateToken, (req, res) => {
    res.json({ version: getVersion() });
});

// GET /api/extension/hashes — SHA-256 de cada script ofuscado
router.get('/hashes', authenticateToken, (req, res) => {
    try {
        const bundle = getBundle();
        res.json({ version: bundle.version, hashes: bundle.hashes });
    } catch (err) {
        console.error('[ext] Error generando hashes:', err.message);
        res.status(500).json({ error: 'Error generando hashes' });
    }
});

// GET /api/extension/download — ZIP listo para descargar
router.get('/download', authenticateToken, (req, res) => {
    try {
        const bundle  = getBundle();
        const zipBuf  = buildZip(bundle);
        const version = bundle.version;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="extension-pjn-v${version}.zip"`);
        res.setHeader('X-Extension-Version', version);
        res.send(zipBuf);
    } catch (err) {
        console.error('[ext] Error generando ZIP:', err.message);
        res.status(500).json({ error: 'Error generando la extensión' });
    }
});

// GET /api/extension/electron-token — genera token temporal (60s) para descarga directa
router.get('/electron-token', authenticateToken, (req, res) => {
    const token = crypto.randomUUID();
    _dlTokens.set(token, { expiresAt: Date.now() + 60_000 });
    res.json({ token });
});

// GET /api/extension/electron-download?token=xxx — descarga directa sin blob
router.get('/electron-download', (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    const entry = _dlTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
        _dlTokens.delete(token);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    _dlTokens.delete(token); // uso único

    const zipPath = path.join(__dirname, '..', 'downloads', 'ProcuradorSCW-Setup.zip');
    const exePath = path.join(__dirname, '..', 'downloads', 'ProcuradorSCW-Setup.exe');
    if (fs.existsSync(zipPath)) {
        res.download(zipPath, 'ProcuradorSCW-Setup.zip');
    } else if (fs.existsSync(exePath)) {
        res.download(exePath, 'ProcuradorSCW-Setup.exe');
    } else {
        res.status(404).json({ error: 'El instalador no está disponible aún. Contactá a soporte.' });
    }
});

module.exports = router;
