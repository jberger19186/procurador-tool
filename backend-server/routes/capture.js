/**
 * capture.js — recepción del deep-link de captura desde los visores (F2.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  🚨 ESTE ES EL ÚNICO ENDPOINT ANÓNIMO (SIN AUTENTICACIÓN) DE TODO EL SISTEMA
 * ═══════════════════════════════════════════════════════════════════════════
 * No es un descuido, es el diseño (§4.1.1 del plan): el visor es un archivo HTML
 * local abierto con file://, sin sesión, y un <form> no puede mandar el header
 * Authorization. La alternativa —embeber un token en el HTML— se descartó
 * explícitamente porque el visor es un archivo que el usuario puede compartir o
 * mandar por mail sin darse cuenta de que lleva su credencial adentro.
 *
 * La autenticación ocurre un paso después, en el patrón Post/Redirect/Get:
 *   1. [ACÁ, anónimo]  el visor postea el payload  → se guarda en un buffer en
 *                      memoria y se responde 303 al portal con un id opaco.
 *   2. [autenticado]   la SPA reclama el borrador con ese id
 *                      (GET /usuarios/api/capture-draft/:id, con JWT + gate de plan).
 *   3. [autenticado]   recién cuando el usuario confirma en el portal, algo se
 *                      escribe en las tablas reales.
 *
 * Lo que sostiene que eso no sea un agujero:
 *   · Rate-limit dedicado (captureLimiter, 30/5min por IP).
 *   · Parser de body propio y acotado (5 MB) — ver el montaje en server.js (P2).
 *   · Borradores con id de 32 bytes aleatorios, TTL de 10 min, uso único y tope
 *     de simultáneos (utils/captureDrafts.js).
 *   · NADA se persiste acá. El payload es entrada no confiable: se valida y se
 *     acota, pero vive solo en un buffer hasta que un usuario autenticado lo reclama.
 *   · El redirect se arma ÍNTEGRAMENTE del lado del servidor. El campo `goto` que
 *     manda el visor NO se refleja en el Location — si se reflejara, este endpoint
 *     sería un open redirect abierto a internet.
 */

const express = require('express');
const { crearDraft } = require('../utils/captureDrafts');

const router = express.Router();

const ACCIONES = ['ficha', 'snapshot', 'entrada', 'ficha-lote', 'snapshot-lote', 'entrada-lote'];
const TIPOS_ENTRADA = ['vencimiento', 'audiencia', 'tarea', 'nota'];
const ORIGENES = ['procuracion', 'informe', 'monitor'];

// hallazgo H3 del plan — tope de FILAS, independiente del de bytes.
// ⚠️ F1 (2026-08-31, code-review): tiene que ser <= MAX_CASOS_CAPTURE_LOTE de
// routes/bitacora.js (mismo valor hoy, sin ningún mecanismo que los sincronice).
// Si este quedara MAYOR que aquel, un lote que pasa el chequeo de acá (se crea
// el draft) fallaría al confirmarse en POST /expedientes/capture-lote — el
// usuario ve el draft creado pero no puede confirmarlo. Subir este valor exige
// subir el de bitacora.js primero o a la vez.
const MAX_CASOS_LOTE = 200;
const MAX_MOVS_CASO  = 500;   // cota defensiva (el tope real de la app es maxMovimientos=15)

// Longitudes alineadas con las columnas reales de expedientes_seguidos
const MAX_EXPEDIENTE  = 60;
const MAX_TEXTO_CORTO = 200;
const MAX_CARATULA    = 300;

const PORTAL = '/usuarios/';

function texto(valor, max) {
    if (typeof valor !== 'string') return '';
    return valor.trim().slice(0, max);
}

/** Movimientos del snapshot: llegan como JSON serializado en un campo del form. */
function parseMovs(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (_) { return []; }   // ilegible → snapshot sin movimientos
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_MOVS_CASO).map(m => ({
        fecha:   texto(m?.fecha, 40),
        tipo:    texto(m?.tipo, MAX_TEXTO_CORTO),
        detalle: texto(m?.detalle, 2000),
    }));
}

function normalizarCaso(src) {
    return {
        expediente:       texto(src?.exp, MAX_EXPEDIENTE),
        jurisdiccion:     texto(src?.jur, MAX_TEXTO_CORTO),
        dependencia:      texto(src?.dep, MAX_TEXTO_CORTO),
        caratula:         texto(src?.car, MAX_CARATULA),
        situacion_actual: texto(src?.sit, MAX_TEXTO_CORTO),
        fecha_corrida:    texto(src?.fproc, 40),
        movimientos:      parseMovs(src?.movs),
    };
}

/** Redirect siempre construido acá — nunca con datos del cliente (anti open-redirect). */
function redirigir(res, params) {
    const qs = new URLSearchParams(Object.assign({ goto: 'bitacora' }, params)).toString();
    res.redirect(303, `${PORTAL}?${qs}`);
}

// ─── POST /usuarios/capture ────────────────────────────────────────────────
router.post('/', (req, res) => {
    try {
        const body = req.body || {};

        const accion = ACCIONES.includes(body.accion) ? body.accion : null;
        if (!accion) return redirigir(res, { captura: 'error' });

        const esLote = accion.endsWith('-lote');
        const tipo   = TIPOS_ENTRADA.includes(body.tipo) ? body.tipo : null;
        const origen = ORIGENES.includes(body.origen) ? body.origen : 'procuracion';

        // `entrada` (mini-menú "+ vencimiento/tarea/nota" de UN caso) SIEMPRE trae un
        // tipo — nace de un botón que ya lo sabe, no hay con qué precargar el modal
        // sin él. `entrada-lote` (selección múltiple) es distinto desde B2: el tipo
        // se puede elegir DESPUÉS, del lado autenticado, con botones en vez del
        // prompt() que usa el visor hoy — así que acá viaja opcional.
        if (accion === 'entrada' && !tipo) return redirigir(res, { captura: 'error' });

        let casos;
        if (esLote) {
            let lote;
            try { lote = JSON.parse(body.lote || '[]'); } catch (_) { return redirigir(res, { captura: 'error' }); }
            if (!Array.isArray(lote) || lote.length === 0) return redirigir(res, { captura: 'error' });
            if (lote.length > MAX_CASOS_LOTE) {
                // El cap se aplica también en capture-lote (defensa en profundidad): acá
                // se avisa temprano en vez de truncar en silencio la selección del usuario.
                return redirigir(res, { captura: 'lote_grande', max: String(MAX_CASOS_LOTE) });
            }
            casos = lote.map(normalizarCaso);
        } else {
            casos = [normalizarCaso(body)];
        }

        // Un caso sin número de expediente no sirve para nada aguas abajo.
        casos = casos.filter(c => c.expediente.length > 0);
        if (casos.length === 0) return redirigir(res, { captura: 'error' });

        const draftId = crearDraft({ accion, tipo, origen, casos, creado: new Date().toISOString() });
        return redirigir(res, { draft: draftId });
    } catch (error) {
        console.error('Error recibiendo captura de bitácora:', error);
        return redirigir(res, { captura: 'error' });
    }
});

module.exports = router;
