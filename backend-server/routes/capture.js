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
 *   · Parser de body propio y acotado (1 MB desde H-BE-02) — ver el montaje en
 *     server.js (P2).
 *   · Borradores con id de 32 bytes aleatorios, TTL de 10 min, uso único y topes
 *     de simultáneos Y de bytes retenidos (utils/captureDrafts.js, H-BE-02).
 *   · NADA se persiste acá. El payload es entrada no confiable: se valida y se
 *     acota, pero vive solo en un buffer hasta que un usuario autenticado lo reclama.
 *   · El redirect se arma ÍNTEGRAMENTE del lado del servidor. El campo `goto` que
 *     manda el visor NO se refleja en el Location — si se reflejara, este endpoint
 *     sería un open redirect abierto a internet.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { crearDraft } = require('../utils/captureDrafts');
const { isBlacklisted } = require('../middleware/tokenBlacklist');

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
//
// 🔧 CORREGIDO 2026-09-04 (hallazgo preexistente, no causado por las secciones
// extra de abajo): esta constante decía 200 pero el comentario que la
// justificaba ("un lote real de 200 casos × 15 movimientos mide menos de
// 200 KB") estaba mal medido — con datos reales (`normalizarCaso()` sobre 15
// movimientos reales de un informe: expediente/caratula/fecha/movimientos/pdf,
// sin las secciones extra, que un lote de más de 50 nunca lleva) un caso pesa
// **2.093 B**, así que 200 casos pesan 381 KB — MÁS que el tope de 256 KB de
// `captureDrafts.js` — y una captura de más de 125 casos YA se rechazaba hoy,
// pese a que este número decía aceptar 200. Corregido a un valor que sí entra:
// floor(256 KB / 2.093 B) = 125; se deja **120**, con margen, no el techo
// exacto — un caso con caratula o movimientos más largos que el fixture medido
// no debe quedar al borde del límite.
const MAX_CASOS_LOTE = 120;
const MAX_MOVS_CASO  = 500;   // cota defensiva (el tope real de la app es maxMovimientos=15)
// Igual cota que MAX_MOVS_CASO, para las 5 secciones extra del informe (2026-09-04):
// el tope real de la app también es 15 por sección (movimientosInforme.js), esto es
// solo la defensa contra un payload manipulado a mano.
// (Nombres distintos a propósito, MAX_FILAS_SECCION / MAX_LARGO_ITEM_SECCION en
// vez de un plural/singular casi idéntico: dos constantes con nombres parecidos
// que solo se distinguen por una 's' es la clase de error que un cambio rápido
// intercambia sin darse cuenta.)
const MAX_FILAS_SECCION = 500;

// Longitudes alineadas con las columnas reales de expedientes_seguidos
const MAX_EXPEDIENTE  = 60;
const MAX_TEXTO_CORTO = 200;
const MAX_CARATULA    = 300;
// Cada entrada de intervinientes/vinculados/recursos/notas es una fila completa
// de la tabla del PJN (nombre + tomo/folio + CUIT, o un párrafo de nota) — más
// larga que jurisdicción/dependencia pero no un texto libre sin cota como
// `detalle` de movimiento (2000).
const MAX_LARGO_ITEM_SECCION = 600;

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

/**
 * Secciones extra (2026-09-04): históricos/intervinientes/vinculados/recursos/
 * notas, cada una un campo de form con un JSON serializado — mismo transporte
 * que `movs`. Dos formas posibles:
 *   · históricos: objetos {fecha,tipo,detalle}, igual que un movimiento → se
 *     reusa `parseMovs` tal cual, es la misma forma.
 *   · las otras 4: `string[]` — cada elemento es una fila de texto ya limpia
 *     del lado de Electron (`movimientosInforme.js`), acá solo se sanea largo
 *     y tipo, no se reprocesa el contenido (esa limpieza es responsabilidad
 *     del cliente, que es quien conoce el formato real de la tabla del PJN).
 */
function parseSeccionTexto(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_FILAS_SECCION)
        .map(item => texto(item, MAX_LARGO_ITEM_SECCION))
        .filter(item => item.length > 0);
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
        // Solo el visor de informe lo manda: nombre del PDF que produjo esa corrida.
        // Es un nombre de archivo, nunca una ruta ni una URL — el portal lo muestra
        // como texto para que el usuario sepa qué archivo mirar en su carpeta.
        pdf:              texto(src?.pdf, MAX_TEXTO_CORTO),
        // Secciones extra del informe (2026-09-04) — mismo criterio que `pdf`:
        // solo el visor de informe las manda (`hist`/`interv`/`vinc`/`rec`/`notas`,
        // ver campoDeCaso() en visor_informes_template.html), y solo cuando el
        // lote entra en el umbral de tamaño. Ausentes → `[]`, no `undefined`, así
        // bitacora.js no tiene que distinguir "no vino" de "vino vacío".
        historicos:       parseMovs(src?.hist),
        intervinientes:   parseSeccionTexto(src?.interv),
        vinculados:       parseSeccionTexto(src?.vinc),
        recursos:         parseSeccionTexto(src?.rec),
        notas:            parseSeccionTexto(src?.notas),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
//  B.3-A / B.5 (fase E11) — LLAVE DE CAPTURA: cómo se interpreta acá
// ═══════════════════════════════════════════════════════════════════════════
// El visor generado a partir de esta fase manda, además del payload, un campo
// oculto `capture_token`: un JWT de 30 minutos con `scope: 'capture'` que la app
// pidió a `POST /client/bitacora/capture-token` al generar el visor. Sirve para
// UNA cosa: que el borrador nazca ATADO A SU DUEÑO (B.5), y que ese mismo dueño
// —y nadie más— pueda reclamarlo después.
//
// ⚠️ Va en un campo del FORMULARIO, no solo en el fragmento `#sso=`. El fragmento
// no se transmite en el request HTTP: el servidor nunca lo ve. Sin el campo
// oculto, este endpoint no tendría forma de saber de quién es la captura y B.5
// sería imposible.
//
// Los tres desenlaces, y por qué son tres y no dos:
//
//   1. Llave AUSENTE → borrador anónimo, comportamiento previo.
//      Obligatorio: los visores generados antes del release de esta fase no la
//      tienen y tienen que seguir funcionando (transición, § 5 de la spec).
//
//   2. Llave FORJADA o AJENA AL PROPÓSITO (firma inválida, no es un JWT, o es un
//      token de sesión colado en este campo) → 401, sin crear NADA.
//      Es el control anti-degradación: un atacante no puede manipular la llave
//      para que el servidor "caiga" al flujo anónimo. Y un JWT de sesión acá
//      sería justamente lo que esta fase vino a eliminar del visor.
//
//   3. Llave AUTÉNTICA pero VENCIDA o YA GASTADA → borrador anónimo (caso 1).
//      Esto NO es un agujero, y el razonamiento importa porque parece uno:
//      · No hay nada que ganar. Degradar a anónimo da exactamente lo mismo que
//        no mandar llave, que es un camino que DEBE quedar abierto por (1). El
//        atacante que quiere un borrador anónimo simplemente no manda el campo.
//      · Y hay algo que perder si se rechaza: un 401 acá rompería al usuario
//        legítimo. Su visor vale por días; la llave, 30 minutos y un solo uso.
//        Con un 401, la segunda captura del mismo visor dejaría de funcionar
//        para siempre — una regresión de producto sobre el comportamiento
//        actual. Los dos criterios de aceptación de la spec lo piden explícito:
//        "visor de hace 31 minutos → pide login, importa tras el login (vence
//        sin romper)" y "segundo intento con el mismo visor → pide login".
//      El usuario termina en el flujo manual: login en el portal + la
//      confirmación "¿importar N casos?" de B.5 parte 1, que sigue vigente.

/** @returns {{user_id: number, jti: (string|null)}|null|'INVALIDA'} */
function resolverDueñoDeCaptura(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return null;   // caso 1
    const token = raw.trim();

    // Gastada: se blacklistea al ENTREGAR el borrador (no acá — la llave tiene que
    // llegar viva desde este POST hasta el reclamo, son dos requests distintos).
    if (isBlacklisted(token)) return null;                            // caso 3

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        if (e && e.name === 'TokenExpiredError') return null;         // caso 3
        return 'INVALIDA';                                            // caso 2
    }

    // `scope` distinto de 'capture' = token de sesión (o cualquier otra cosa) en un
    // campo que no le corresponde. No se acepta ni se degrada: 401.
    if (!payload || payload.scope !== 'capture') return 'INVALIDA';   // caso 2
    const userId = Number(payload.id);
    if (!Number.isInteger(userId) || userId <= 0) return 'INVALIDA';  // caso 2

    return { user_id: userId, jti: typeof payload.jti === 'string' ? payload.jti : null };
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

        // B.3-A: se resuelve ANTES de validar nada más y antes de tocar memoria —
        // una llave forjada no debe llegar siquiera a crear un borrador anónimo.
        const dueño = resolverDueñoDeCaptura(body.capture_token);
        if (dueño === 'INVALIDA') {
            return res.status(401).json({
                error: 'La credencial de captura no es válida. Volvé a generar el visor desde la app.',
                code: 'CAPTURE_TOKEN_INVALIDO'
            });
        }

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

        // H-BE-02: el tope de BYTES vive en captureDrafts.js (no acá) porque es el
        // módulo que retiene la memoria. Un payload que lo excede se rechaza ANTES de
        // guardar nada — se avisa con el mismo código que el lote de más de 200 filas,
        // que es el mismo mensaje útil para el usuario: "achicá la selección".
        let draftId;
        try {
            // El dueño va como METADATO del borrador, fuera del payload: el payload es
            // lo único que se le devuelve al portal y no tiene por qué llevar el `jti`
            // ni el id de usuario del control de acceso.
            draftId = crearDraft(
                { accion, tipo, origen, casos, creado: new Date().toISOString() },
                dueño || {}
            );
        } catch (e) {
            if (e && e.code === 'DRAFT_TOO_LARGE') {
                console.warn(`⚠️ Captura rechazada por tamaño: ${e.bytes} bytes (máx ${e.max})`);
                return redirigir(res, { captura: 'lote_grande', max: String(MAX_CASOS_LOTE) });
            }
            throw e;
        }
        return redirigir(res, { draft: draftId });
    } catch (error) {
        console.error('Error recibiendo captura de bitácora:', error);
        return redirigir(res, { captura: 'error' });
    }
});

module.exports = router;
