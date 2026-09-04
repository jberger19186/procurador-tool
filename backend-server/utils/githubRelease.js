/**
 * githubRelease.js — consulta cacheada del último release publicado en GitHub.
 *
 * H-BE-08 (auditoría 2026-09). Existían DOS copias de esta consulta:
 *   · `routes/client.js` (GET /client/download/electron) — con el guard del
 *     JSON.parse y el timeout que puso el fix B7 del 2026-07-24, pero SIN caché.
 *   · `routes/extension.js` (GET /api/extension/electron-download) — con la caché
 *     que agregó S7 el 2026-09-01, pero SIN el guard ni el timeout: el
 *     `JSON.parse(b)` corría dentro del callback del evento 'end', fuera del
 *     alcance de cualquier try/catch, así que una respuesta de GitHub que no fuera
 *     JSON (5xx con HTML, corte de conexión) lanzaba una excepción no capturada, y
 *     `server.js` responde a `uncaughtException` con `process.exit(1)`. Es decir:
 *     un incidente de GitHub podía tirar abajo la API entera.
 *
 * Cada copia tenía la mitad buena de la otra. Este módulo las une en un solo lugar,
 * que además hace que la caché sea REALMENTE compartida: los dos endpoints golpean
 * la API anónima de GitHub (60 req/hora por IP, compartida con producción), así que
 * dos cachés separadas gastaban el doble de cupo.
 */

'use strict';

const https = require('https');

const RELEASE_URL = 'https://api.github.com/repos/jberger19186/procurador-tool/releases/latest';
const CACHE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;

let _cache = { asset: null, fetchedAt: 0 };

function fetchLatestAsset() {
    return new Promise((resolve, reject) => {
        const req = https.get(
            RELEASE_URL,
            { headers: { 'User-Agent': 'procurador-api', 'Accept': 'application/vnd.github+json' } },
            (r) => {
                let body = '';
                r.on('data', c => { body += c; });
                r.on('end', () => {
                    // El try va ACÁ adentro: un throw en este callback no lo atrapa
                    // ningún try/catch de arriba (es otro turno del event loop).
                    try { resolve(JSON.parse(body)); }
                    catch (_) { reject(new Error('Respuesta inválida de GitHub Releases')); }
                });
                r.on('error', reject);
            }
        );
        // Sin timeout, una request colgada deja al usuario esperando para siempre.
        req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Timeout consultando GitHub Releases')));
        req.on('error', reject);
    }).then(data =>
        data?.assets?.find(a => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap')) || null
    );
}

/**
 * Devuelve el asset `.exe` del último release, cacheado 5 minutos.
 * Si GitHub falla y hay una copia vieja en memoria, se sirve esa (aunque haya
 * vencido el TTL): mejor un instalador de hace un rato que una descarga rota.
 */
async function getLatestAsset() {
    if (_cache.asset && (Date.now() - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.asset;
    try {
        const asset = await fetchLatestAsset();
        if (asset) _cache = { asset, fetchedAt: Date.now() };
        return asset;
    } catch (e) {
        if (_cache.asset) return _cache.asset;
        throw e;
    }
}

/** Solo para tests. */
function _resetCache() { _cache = { asset: null, fetchedAt: 0 }; }

module.exports = { getLatestAsset, _resetCache, CACHE_TTL_MS, TIMEOUT_MS };
