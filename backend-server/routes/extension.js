/**
 * routes/extension.js
 * Descarga del instalador de la app Electron desde el portal web.
 *
 * Endpoints:
 *   GET /api/extension/electron-token    — genera un token temporal (60s) de descarga
 *   GET /api/extension/electron-download — redirige al .exe del último release (GitHub)
 *
 * RI-4 (revisión 2026-07-19, ejecutado 2026-07-22): se eliminaron los endpoints
 * `version`/`hashes`/`download` de la distribución CRX/ZIP de la extensión, deprecada
 * desde que la extensión pasó a la Chrome Web Store (v1.3.2+). Confirmado antes de
 * eliminar: (1) ninguna UI de la app Electron actual los invoca — `renderer.js` usa
 * `openUrlInChrome` directo al store, no `install-extension`/`check-extension-version`
 * (esos IPC handlers de `main.js` eran código muerto, también eliminados en esta misma
 * revisión); (2) cero hits reales en 2+ semanas de logs de prod a esas 3 rutas. Los
 * endpoints `electron-token`/`electron-download` de abajo son un flujo DISTINTO y SIGUEN
 * VIVOS (el botón de descarga de la app en el portal, `public/usuarios/app.js:1027`) —
 * no se tocan. Al desaparecer `buildZip()` (única consumidora), también se eliminaron
 * las dependencias `adm-zip` y `javascript-obfuscator` del backend.
 */

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const authenticateToken = require('../middleware/authenticateToken');

// ── Tokens temporales de descarga (Electron installer) ──────────────────────
const _dlTokens = new Map(); // token → { expiresAt }

setInterval(() => {
    const now = Date.now();
    for (const [t, d] of _dlTokens) if (d.expiresAt < now) _dlTokens.delete(t);
}, 5 * 60 * 1000);

// GET /api/extension/electron-token — genera token temporal (60s) para descarga directa
router.get('/electron-token', authenticateToken, (req, res) => {
    const token = crypto.randomUUID();
    _dlTokens.set(token, { expiresAt: Date.now() + 60_000 });
    res.json({ token });
});

// GET /api/extension/electron-download?token=xxx — descarga directa sin blob.
// El token (60s, un solo uso) reemplaza al header Authorization para que la
// navegación del navegador (que no envía Bearer) pueda descargar el instalador.
router.get('/electron-download', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    const entry = _dlTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
        _dlTokens.delete(token);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    _dlTokens.delete(token); // uso único

    // Siempre redirige al ÚLTIMO instalador publicado en GitHub Releases — misma
    // fuente que usa el auto-updater de la app. (No se sirven archivos locales:
    // un instalador viejo en downloads/ entregaría una versión desactualizada.)
    try {
        const https = require('https');
        const data = await new Promise((resolve, reject) => {
            const r2 = https.get(
                'https://api.github.com/repos/jberger19186/procurador-tool/releases/latest',
                { headers: { 'User-Agent': 'procurador-api', 'Accept': 'application/vnd.github+json' } },
                (r) => { let b = ''; r.on('data', c => b += c); r.on('end', () => resolve(JSON.parse(b))); }
            );
            r2.on('error', reject);
        });
        const asset = data.assets?.find(a => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap'));
        if (!asset) return res.status(404).json({ error: 'El instalador no está disponible aún. Contactá a soporte.' });
        return res.redirect(asset.browser_download_url);
    } catch (e) {
        return res.status(500).json({ error: 'Error al obtener el instalador.' });
    }
});

module.exports = router;
