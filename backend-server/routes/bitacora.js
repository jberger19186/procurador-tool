/**
 * bitacora.js — endpoints del módulo Bitácora (F1.2).
 *
 * Cubre: CRUD de entradas, banner de avisos, CRUD de fichas de expediente y
 * lectura de feriados. NO incluye exportación (F1.6), importación (F1.7), el ABM
 * de feriados del admin (F1.8) ni los endpoints de captura desde los visores (F2.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  🚨 CÓMO SE MONTA — punto crítico P1 del plan (§11.0). NO cambiar sin leer.
 * ═══════════════════════════════════════════════════════════════════════════
 * Este archivo exporta UN router que se monta en `/usuarios/api`, el mismo prefijo
 * que `routes/usuarios.js`. Eso es seguro **solo** por cómo está armado adentro:
 *
 *   router.use('/bitacora',    auth, gate, entradas);
 *   router.use('/expedientes', auth, gate, expedientes);
 *   router.use('/feriados',    auth, gate, feriados);
 *
 * El gate cuelga de **sub-paths**, no del router. Una petición a
 * `/usuarios/api/profile` entra a este router, no matchea ningún sub-path, y cae
 * limpiamente al router de `usuarios.js` **sin haber tocado el gate**.
 *
 * ⛔ Lo que NO hay que hacer nunca:
 *      router.use(gate);            ← alcanzaría a /profile, /payments, /invoices…
 *      router.use('/', gate);       ← lo mismo
 * `routes/usuarios.js` tiene 8 rutas vivas en producción; si el gate las alcanza,
 * todo usuario sin el flag pierde el acceso a sus facturas y a su contraseña.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  AISLAMIENTO DE DATOS ENTRE USUARIOS
 * ═══════════════════════════════════════════════════════════════════════════
 * Toda consulta filtra por `user_id = req.user.id`, y todo id que venga de la URL
 * se valida contra el usuario autenticado antes de usarse. Un id ajeno devuelve
 * 404 (no 403): no se confirma que el recurso exista.
 */

const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const authenticateToken = require('../middleware/authenticateToken');
const { checkBitacoraPlan } = require('../middleware/checkBitacoraPlan');
const { expedienteKey, esExpedienteValido } = require('../utils/expedienteKey');
const { reclamarDraft } = require('../utils/captureDrafts');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
//  Constantes de validación
// ═══════════════════════════════════════════════════════════════════════════

const KINDS_ENTRADA = ['vencimiento', 'audiencia', 'tarea', 'gestion', 'nota'];
const REPEAT_RULES  = ['weekly', 'monthly', 'yearly'];
// Valores exactos de los CHECK de la migración F1.1 — un backup editado a mano con
// otro valor debe rechazarse ANTES de abrir la transacción, no romperla a mitad.
const SOURCES_ENTRADA = ['manual', 'visor_procuracion', 'visor_informe'];
const KINDS_SNAPSHOT  = ['procuracion', 'informe'];
const MAX_SNAPSHOTS_POR_KIND = 2;   // tope estructural 2+2 por caso (§7 del plan)
const MAX_CASOS_CAPTURE_LOTE = 200; // tope de filas por captura en lote (hallazgo H3)

const MAX_TITLE       = 300;    // = VARCHAR(300) de la columna
const MAX_DESCRIPTION = 5000;   // mismo criterio que el cap de tickets (hallazgo C5)
const MAX_EXPEDIENTE  = 60;     // = VARCHAR(60)
const MAX_TEXTO_CORTO = 200;    // jurisdicción / dependencia / situación
const MAX_CARATULA    = 300;
const MAX_NOTAS       = 5000;

const LIMITE_LISTADO  = 500;    // techo duro de filas por respuesta
const VENTANA_MAX_DIAS = 365;   // techo del rango del banner de avisos

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Texto saneado y acotado, o null si no vino (para columnas opcionales). */
function texto(valor, max) {
    if (typeof valor !== 'string') return null;
    const limpio = valor.trim();
    if (limpio.length === 0) return null;
    return limpio.slice(0, max);
}

/** Fecha ISO válida, o null. Devuelve `undefined` si el campo no vino. */
function fecha(valor) {
    if (valor === undefined) return undefined;
    if (valor === null || valor === '') return null;
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Entero dentro de un rango, con default. */
function entero(valor, def, min, max) {
    const n = parseInt(valor, 10);
    if (Number.isNaN(n)) return def;
    return Math.min(Math.max(n, min), max);
}

/**
 * Verifica que una ficha pertenezca al usuario. Devuelve el id o null.
 * Es la defensa contra IDOR de todos los endpoints que reciben `expediente_id`.
 */
async function fichaDelUsuario(db, userId, expedienteId) {
    if (expedienteId === undefined || expedienteId === null || expedienteId === '') return null;
    const id = parseInt(expedienteId, 10);
    if (Number.isNaN(id)) return null;
    const { rows } = await db.query(
        'SELECT id FROM expedientes_seguidos WHERE id = $1 AND user_id = $2',
        [id, userId]
    );
    return rows.length > 0 ? rows[0].id : null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXPORTACIÓN  →  GET /usuarios/api/bitacora/export  (F1.6)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ Gate DISTINTO al resto de `/bitacora/*` — a propósito. El resto usa
// `checkBitacoraPlan()` (estricto); este endpoint usa `checkBitacoraPlan({ conGracia:
// true })` porque el usuario nunca debe quedar sin poder llevarse sus propios datos:
// si perdió el flag hace menos de 90 días (`users.bitacora_lost_access_at`, decisión
// D2/Q6, §8 del plan), igual puede exportar. Por eso esta ruta se registra ACÁ, en el
// router raíz, ANTES del `router.use('/bitacora', ..., entradas)` de más abajo —
// Express matchea rutas específicas por orden de registro, así que esta gana la
// carrera para `/bitacora/export` sin que el `.use()` genérico (con el gate estricto)
// llegue a tocarla. El resto de `/bitacora/*` no se ve afectado.

const KIND_LABELS_ENTRADA = { vencimiento: 'Vencimiento', audiencia: 'Audiencia', tarea: 'Tarea', gestion: 'Gestión', nota: 'Nota' };

// Sin el LIMITE_LISTADO de las rutas de listado normales: acá se exporta el
// backup completo del usuario, y truncarlo silenciosamente rompería la promesa
// de "es tu copia íntegra" (más grave en el JSON, pensado para F1.7). Los
// volúmenes son chicos por diseño (tope 2+2 snapshots por caso, §7 del plan).
async function recolectarDatosExport(db, userId, { alcance, expedienteId, desde, hasta }) {
    const datos = { expedientes: [], entradas: [], snapshots: [] };

    if (alcance === 'todo') {
        const [exps, ents, snaps] = await Promise.all([
            db.query('SELECT * FROM expedientes_seguidos WHERE user_id = $1 ORDER BY id', [userId]),
            db.query('SELECT * FROM bitacora_entries WHERE user_id = $1 ORDER BY due_at ASC NULLS LAST, id', [userId]),
            db.query(
                `SELECT s.* FROM expediente_snapshots s
                   JOIN expedientes_seguidos x ON x.id = s.expediente_id
                  WHERE x.user_id = $1
                  ORDER BY s.expediente_id, s.kind, s.created_at DESC`,
                [userId]
            ),
        ]);
        datos.expedientes = exps.rows;
        datos.entradas = ents.rows;
        datos.snapshots = snaps.rows;
    } else if (alcance === 'entradas') {
        const cond = ['e.user_id = $1'];
        const vals = [userId];
        let i = 2;
        if (desde) { cond.push(`e.due_at >= $${i++}`); vals.push(desde); }
        if (hasta) { cond.push(`e.due_at <= $${i++}`); vals.push(hasta); }
        const { rows } = await db.query(
            `SELECT e.*, x.expediente
               FROM bitacora_entries e
               LEFT JOIN expedientes_seguidos x ON x.id = e.expediente_id
              WHERE ${cond.join(' AND ')}
              ORDER BY e.due_at ASC NULLS LAST, e.id`,
            vals
        );
        datos.entradas = rows;
    } else if (alcance === 'expediente') {
        const [exp, ents, snaps] = await Promise.all([
            db.query('SELECT * FROM expedientes_seguidos WHERE id = $1', [expedienteId]),
            db.query(
                'SELECT * FROM bitacora_entries WHERE expediente_id = $1 AND user_id = $2 ORDER BY due_at ASC NULLS LAST, id',
                [expedienteId, userId]
            ),
            db.query(
                'SELECT * FROM expediente_snapshots WHERE expediente_id = $1 ORDER BY kind, created_at DESC',
                [expedienteId]
            ),
        ]);
        datos.expedientes = exp.rows;
        datos.entradas = ents.rows;
        datos.snapshots = snaps.rows;
    }

    return datos;
}

// JSON: volcado fiel con `backup_version` — es el formato que F1.7 sabrá leer.
function enviarExportJson(res, datos, alcance) {
    const payload = {
        backup_version: 1,
        exported_at: new Date().toISOString(),
        scope: alcance,
        expedientes: datos.expedientes,
        entradas: datos.entradas,
        snapshots: datos.snapshots,
    };
    const filename = `bitacora-backup-${alcance}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(payload);
}

// Excel: hojas separadas, para leer/imprimir/archivar — NO es restaurable (eso es el JSON).
async function enviarExportXlsx(res, datos, alcance) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Procurador SCW';
    wb.created = new Date();

    // Hoja "Expedientes": solo tiene sentido con el caso completo (alcance=todo);
    // en "expediente" ya se sabe de qué caso se trata (es la ficha entera del export),
    // y en "entradas" no hay fichas involucradas.
    if (alcance === 'todo') {
        const wsExp = wb.addWorksheet('Expedientes');
        wsExp.columns = [
            { header: 'Expediente', key: 'expediente', width: 22 },
            { header: 'Carátula', key: 'caratula', width: 40 },
            { header: 'Jurisdicción', key: 'jurisdiccion', width: 30 },
            { header: 'Dependencia', key: 'dependencia', width: 25 },
            { header: 'Situación actual', key: 'situacion_actual', width: 25 },
            { header: 'Fecha de situación', key: 'situacion_fecha', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
            { header: 'Notas', key: 'notas', width: 40 },
            { header: 'Creado', key: 'created_at', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
        ];
        wsExp.getRow(1).font = { bold: true };
        datos.expedientes.forEach(x => wsExp.addRow({
            expediente: x.expediente,
            caratula: x.caratula || '',
            jurisdiccion: x.jurisdiccion || '',
            dependencia: x.dependencia || '',
            situacion_actual: x.situacion_actual || '',
            situacion_fecha: x.situacion_fecha ? new Date(x.situacion_fecha) : null,
            notas: x.notas || '',
            created_at: x.created_at ? new Date(x.created_at) : null,
        }));
    }

    // Resuelve el nombre del expediente por id — necesario en "todo" (la consulta de
    // `bitacora_entries` ahí no hace JOIN, a diferencia de "entradas") y en "Historial"
    // (que nunca trae `expediente` propio). En "entradas", `e.expediente` ya viene del
    // JOIN de `recolectarDatosExport` y tiene prioridad.
    const expPorId = new Map(datos.expedientes.map(x => [x.id, x.expediente]));

    const wsEnt = wb.addWorksheet('Entradas');
    wsEnt.columns = [
        { header: 'Fecha', key: 'due_at', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
        { header: 'Tipo', key: 'kind', width: 14 },
        { header: 'Título', key: 'title', width: 40 },
        { header: 'Descripción', key: 'description', width: 40 },
        { header: 'Estado', key: 'estado', width: 12 },
        { header: 'Expediente vinculado', key: 'expediente', width: 22 },
    ];
    wsEnt.getRow(1).font = { bold: true };
    datos.entradas.forEach(e => wsEnt.addRow({
        due_at: e.due_at ? new Date(e.due_at) : null,
        kind: KIND_LABELS_ENTRADA[e.kind] || e.kind,
        title: e.title,
        description: e.description || '',
        estado: e.done_at ? 'Hecha' : 'Pendiente',
        expediente: e.expediente || expPorId.get(e.expediente_id) || '',
    }));

    // Hoja "Historial": junto con Entradas en "todo" y "expediente"; ausente en
    // "entradas" (no tiene sentido sin el contexto de un caso).
    if (alcance !== 'entradas') {
        const wsHist = wb.addWorksheet('Historial');
        wsHist.columns = [
            { header: 'Expediente', key: 'expediente', width: 22 },
            { header: 'Tipo', key: 'kind', width: 14 },
            { header: 'Fecha de corrida', key: 'run_date', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
            { header: 'Situación registrada', key: 'situacion', width: 30 },
        ];
        wsHist.getRow(1).font = { bold: true };
        datos.snapshots.forEach(s => wsHist.addRow({
            expediente: expPorId.get(s.expediente_id) || '',
            kind: s.kind === 'procuracion' ? 'Procuración' : 'Informe',
            run_date: s.run_date ? new Date(s.run_date) : null,
            situacion: s.situacion || '',
        }));
    }

    const filename = `bitacora-${alcance}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
}

router.get('/bitacora/export', authenticateToken, checkBitacoraPlan({ conGracia: true }), async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    const alcance = ['todo', 'entradas', 'expediente'].includes(req.query.alcance) ? req.query.alcance : 'todo';
    const formato = req.query.formato === 'json' ? 'json' : 'xlsx';

    let expedienteId = null;
    if (alcance === 'expediente') {
        expedienteId = await fichaDelUsuario(db, userId, req.query.expediente_id);
        if (!expedienteId) return res.status(404).json({ error: 'Expediente no encontrado' });
    }

    // Mismo criterio permisivo que GET /bitacora (arriba): `fecha()` devuelve
    // undefined tanto si el query param no vino como si vino con un valor
    // ilegible — en ambos casos, sin filtro (no hay nada "incorrecto" que
    // rechazar con 400, es simplemente "no acotar por fecha").
    const desde = fecha(req.query.desde) || null;
    const hasta = fecha(req.query.hasta) || null;

    try {
        const datos = await recolectarDatosExport(db, userId, { alcance, expedienteId, desde, hasta });
        if (formato === 'json') {
            enviarExportJson(res, datos, alcance);
        } else {
            await enviarExportXlsx(res, datos, alcance);
        }
    } catch (error) {
        console.error('Error generando export de bitácora:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Error del servidor' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  IMPORTACIÓN / RESTAURACIÓN  →  POST /usuarios/api/bitacora/import  (F1.7)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ES EL ÚNICO ENDPOINT DE TODO EL MÓDULO QUE PUEDE DESTRUIR DATOS DEL USUARIO.
// Tres salvaguardas, en este orden:
//   1. Validación completa del archivo ANTES de abrir la transacción (versión,
//      estructura, pertenencia a la cuenta, y cada fila contra los CHECK reales
//      del esquema). Nada se toca si algo no cierra.
//   2. Dry-run obligatorio desde el portal (`dry_run=1`): devuelve los números
//      concretos del impacto sin escribir una sola fila.
//   3. Todo o nada: la aplicación corre en una transacción única.
// El respaldo automático previo (§5.3, salvaguarda 2) lo dispara el portal
// descargando el export de F1.6 antes de confirmar — por eso F1.6 era
// dependencia dura de este sub-bloque.
//
// 🚨 TRANSPORTE — por qué multipart y no JSON (punto crítico P2 del plan):
// el parser `express.json()` global (`server.js:110`) tiene el límite default de
// 100 KB —insuficiente para un backup— y, mucho más importante, lleva el hook
// `verify` que captura el `rawBody` con el que se valida la firma HMAC de los
// webhooks de MercadoPago. Subir el backup como multipart lo esquiva por
// completo: multer parsea SOLO esta ruta, sin agregar ni reordenar nada en la
// cadena de parsers global. NO cambiar esto por un `express.json({limit})`.

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;   // 10 MB
const MAX_FILAS_IMPORT = 20000;              // techo de filas totales del archivo

const uploadBackup = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BACKUP_BYTES },
    fileFilter: (req, file, cb) => {
        // El navegador manda application/json; algunos clientes, octet-stream.
        const ok = ['application/json', 'text/json', 'application/octet-stream'].includes(file.mimetype);
        if (!ok) return cb(new Error('El backup debe ser el archivo .json que descargaste desde "Exportar".'));
        cb(null, true);
    }
});

// Mismo patrón que `uploadPdfOr400` de admin.js (lección RI-1): sin este wrapper,
// un rechazo de multer cae al error handler global como 500 genérico en vez de un
// 400 con el motivo real.
function uploadBackupOr400(req, res, next) {
    uploadBackup.single('backup')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? `El archivo supera el máximo de ${MAX_BACKUP_BYTES / (1024 * 1024)} MB.`
                : (err.message || 'Archivo inválido.');
            return res.status(400).json({ error: msg });
        }
        next();
    });
}

/**
 * Valida el backup entero antes de tocar la base. Devuelve `{ error }` con un
 * mensaje accionable, o `{ data }` con los tres arrays ya normalizados.
 */
function validarBackup(buffer, userId) {
    let data;
    try {
        data = JSON.parse(buffer.toString('utf8'));
    } catch (_) {
        return { error: 'El archivo no es un JSON válido. Tiene que ser el backup que descargaste desde "Exportar".' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { error: 'El archivo no tiene la estructura de un backup de Bitácora.' };
    }
    if (data.backup_version !== 1) {
        return { error: `Versión de backup no soportada (${data.backup_version ?? 'ausente'}). Este portal restaura backups versión 1.` };
    }

    const arrays = {};
    for (const nombre of ['expedientes', 'entradas', 'snapshots']) {
        const v = data[nombre];
        if (v === undefined || v === null) { arrays[nombre] = []; continue; }
        if (!Array.isArray(v)) return { error: `El campo "${nombre}" del backup está corrupto (se esperaba una lista).` };
        arrays[nombre] = v;
    }
    const { expedientes, entradas: entradasBk, snapshots } = arrays;

    const total = expedientes.length + entradasBk.length + snapshots.length;
    if (total > MAX_FILAS_IMPORT) {
        return { error: `El backup tiene ${total} registros y el máximo por importación es ${MAX_FILAS_IMPORT}.` };
    }

    // Pertenencia — un backup de OTRA cuenta se rechaza acá, sin tocar nada.
    const ajeno = expedientes.some(x => Number(x?.user_id) !== userId)
               || entradasBk.some(e => Number(e?.user_id) !== userId);
    if (ajeno) {
        return { error: 'El backup pertenece a otra cuenta. Solo podés restaurar backups tuyos.' };
    }

    // Fila por fila, contra los CHECK reales del esquema.
    for (const x of expedientes) {
        if (!Number.isInteger(Number(x?.id))) return { error: 'Hay un expediente sin identificador válido en el backup.' };
        if (!esExpedienteValido(String(x?.expediente ?? ''))) {
            return { error: `El backup tiene un expediente con formato irreconocible: "${x?.expediente ?? ''}".` };
        }
    }
    for (const e of entradasBk) {
        if (!Number.isInteger(Number(e?.id))) return { error: 'Hay una entrada sin identificador válido en el backup.' };
        if (!KINDS_ENTRADA.includes(e?.kind)) return { error: `El backup tiene una entrada con tipo inválido: "${e?.kind}".` };
        if (typeof e?.title !== 'string' || e.title.trim().length === 0) return { error: 'El backup tiene una entrada sin título.' };
        if (e?.repeat_rule != null && !REPEAT_RULES.includes(e.repeat_rule)) {
            return { error: `El backup tiene una repetición inválida: "${e.repeat_rule}".` };
        }
        if (e?.source != null && !SOURCES_ENTRADA.includes(e.source)) {
            return { error: `El backup tiene un origen de entrada inválido: "${e.source}".` };
        }
    }
    for (const s of snapshots) {
        if (!KINDS_SNAPSHOT.includes(s?.kind)) return { error: `El backup tiene un historial con tipo inválido: "${s?.kind}".` };
        if (!Number.isInteger(Number(s?.expediente_id))) return { error: 'Hay un historial sin expediente asociado en el backup.' };
    }

    return { data: { expedientes, entradas: entradasBk, snapshots, exported_at: data.exported_at ?? null } };
}

/** Números concretos del impacto, sin escribir nada (la vista previa de §5.3). */
async function calcularPreviewImport(db, userId, backup, modo) {
    const { rows: [actual] } = await db.query(
        `SELECT (SELECT count(*)::int FROM expedientes_seguidos WHERE user_id = $1) AS expedientes,
                (SELECT count(*)::int FROM bitacora_entries    WHERE user_id = $1) AS entradas`,
        [userId]
    );

    const contenido = {
        expedientes: backup.expedientes.length,
        entradas: backup.entradas.length,
        snapshots: backup.snapshots.length,
    };

    if (modo === 'reemplazar') {
        return {
            actual,
            contenido,
            eliminar: { expedientes: actual.expedientes, entradas: actual.entradas },
            crear: { expedientes: contenido.expedientes, entradas: contenido.entradas },
            conservar: { expedientes: 0, entradas: 0 },
        };
    }

    // Combinar: los casos se identifican por expediente_key (la UNIQUE del esquema),
    // las entradas por su id interno (el backup salió de esta misma cuenta).
    const keys = [...new Set(backup.expedientes.map(x => expedienteKey(x.expediente)))];
    const { rows: expExistentes } = keys.length
        ? await db.query(
            'SELECT expediente_key FROM expedientes_seguidos WHERE user_id = $1 AND expediente_key = ANY($2)',
            [userId, keys])
        : { rows: [] };
    const keysExistentes = new Set(expExistentes.map(r => r.expediente_key));

    const idsEntradas = [...new Set(backup.entradas.map(e => Number(e.id)))];
    const { rows: entExistentes } = idsEntradas.length
        ? await db.query('SELECT id FROM bitacora_entries WHERE user_id = $1 AND id = ANY($2)', [userId, idsEntradas])
        : { rows: [] };
    const idsExistentes = new Set(entExistentes.map(r => r.id));

    const expSobrescribir = keys.filter(k => keysExistentes.has(k)).length;
    const entSobrescribir = backup.entradas.filter(e => idsExistentes.has(Number(e.id))).length;

    return {
        actual,
        contenido,
        eliminar: { expedientes: 0, entradas: 0 },   // combinar NUNCA borra
        crear: {
            expedientes: keys.length - expSobrescribir,
            entradas: backup.entradas.length - entSobrescribir,
        },
        sobrescribir: { expedientes: expSobrescribir, entradas: entSobrescribir },
        conservar: {
            expedientes: actual.expedientes - expSobrescribir,
            entradas: actual.entradas - entSobrescribir,
        },
    };
}

/** Aplica la restauración. Todo o nada: una sola transacción. */
async function aplicarImport(db, userId, backup, modo) {
    const client = await db.connect();
    const resumen = {
        expedientesCreados: 0, expedientesActualizados: 0,
        entradasCreadas: 0, entradasActualizadas: 0,
        snapshotsCreados: 0,
        expedientesEliminados: 0, entradasEliminadas: 0,
    };

    try {
        await client.query('BEGIN');

        if (modo === 'reemplazar') {
            // Orden importa: las entradas primero (su FK a expedientes es ON DELETE
            // SET NULL, así que borrar el caso las dejaría sueltas en vez de borrarlas).
            const delEnt = await client.query('DELETE FROM bitacora_entries WHERE user_id = $1', [userId]);
            const delExp = await client.query('DELETE FROM expedientes_seguidos WHERE user_id = $1', [userId]);
            resumen.entradasEliminadas   = delEnt.rowCount;
            resumen.expedientesEliminados = delExp.rowCount;
            // Los snapshots caen solos por el ON DELETE CASCADE de expedientes_seguidos.
        }

        // ── Fichas ────────────────────────────────────────────────────────────
        // Identidad = expediente_key (la UNIQUE del esquema), NO el id: así un caso
        // que hoy existe con otro id igual se reconoce y se pisa en vez de duplicarse.
        // El idMap traduce los ids del backup a los reales para entradas y snapshots.
        const idMap = new Map();
        for (const x of backup.expedientes) {
            // El backup es autoritativo: pisa TODOS los campos del caso. (A diferencia
            // del upsert de captura de F1.2, que hace COALESCE para no borrar lo que el
            // usuario cargó a mano — acá el usuario pidió explícitamente restaurar.)
            const { rows } = await client.query(
                `INSERT INTO expedientes_seguidos
                   (user_id, expediente, expediente_key, jurisdiccion, dependencia, caratula, situacion_actual, situacion_fecha, notas)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (user_id, expediente_key) DO UPDATE SET
                   expediente       = EXCLUDED.expediente,
                   jurisdiccion     = EXCLUDED.jurisdiccion,
                   dependencia      = EXCLUDED.dependencia,
                   caratula         = EXCLUDED.caratula,
                   situacion_actual = EXCLUDED.situacion_actual,
                   situacion_fecha  = EXCLUDED.situacion_fecha,
                   notas            = EXCLUDED.notas,
                   updated_at       = NOW()
                 RETURNING id, (xmax = 0) AS creado`,
                [
                    userId,
                    texto(x.expediente, MAX_EXPEDIENTE),
                    expedienteKey(x.expediente),          // siempre recalculada en el servidor
                    texto(x.jurisdiccion, MAX_TEXTO_CORTO),
                    texto(x.dependencia, MAX_TEXTO_CORTO),
                    texto(x.caratula, MAX_CARATULA),
                    texto(x.situacion_actual, MAX_TEXTO_CORTO),
                    fecha(x.situacion_fecha) ?? null,
                    texto(x.notas, MAX_NOTAS),
                ]
            );
            idMap.set(Number(x.id), rows[0].id);
            if (rows[0].creado) resumen.expedientesCreados++; else resumen.expedientesActualizados++;
        }

        // ── Entradas ──────────────────────────────────────────────────────────
        // Identidad = el id interno. Preservarlo hace la restauración idempotente:
        // importar el mismo archivo dos veces deja el mismo estado, en vez de duplicar
        // lo que se hubiera recreado. Los ids son GLOBALES (no por usuario), así que si
        // uno quedó ocupado por otra cuenta se inserta con id nuevo.
        const idsBackup = [...new Set(backup.entradas.map(e => Number(e.id)))];
        const { rows: ocupados } = idsBackup.length
            ? await client.query('SELECT id, user_id FROM bitacora_entries WHERE id = ANY($1)', [idsBackup])
            : { rows: [] };
        const idsMios   = new Set(ocupados.filter(r => r.user_id === userId).map(r => r.id));
        const idsAjenos = new Set(ocupados.filter(r => r.user_id !== userId).map(r => r.id));

        for (const e of backup.entradas) {
            const idBackup = Number(e.id);
            const expedienteReal = e.expediente_id != null
                ? (idMap.get(Number(e.expediente_id)) ?? null)   // caso no incluido en el backup → entrada suelta
                : null;

            const campos = [
                expedienteReal,
                e.kind,
                texto(e.title, MAX_TITLE),
                texto(e.description, MAX_DESCRIPTION),
                fecha(e.due_at) ?? null,
                e.all_day === undefined || e.all_day === null ? true : Boolean(e.all_day),
                fecha(e.done_at) ?? null,
                e.repeat_rule ?? null,
                e.meta != null ? JSON.stringify(e.meta) : null,
                SOURCES_ENTRADA.includes(e.source) ? e.source : 'manual',
            ];

            if (idsMios.has(idBackup)) {
                await client.query(
                    `UPDATE bitacora_entries SET
                       expediente_id=$1, kind=$2, title=$3, description=$4, due_at=$5,
                       all_day=$6, done_at=$7, repeat_rule=$8, meta=$9, source=$10, updated_at=NOW()
                     WHERE id=$11 AND user_id=$12`,
                    [...campos, idBackup, userId]
                );
                resumen.entradasActualizadas++;
            } else if (idsAjenos.has(idBackup)) {
                await client.query(
                    `INSERT INTO bitacora_entries
                       (user_id, expediente_id, kind, title, description, due_at, all_day, done_at, repeat_rule, meta, source)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                    [userId, ...campos]
                );
                resumen.entradasCreadas++;
            } else {
                await client.query(
                    `INSERT INTO bitacora_entries
                       (id, user_id, expediente_id, kind, title, description, due_at, all_day, done_at, repeat_rule, meta, source)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                    [idBackup, userId, ...campos]
                );
                resumen.entradasCreadas++;
            }
        }

        // ── Historial (snapshots) ─────────────────────────────────────────────
        // Hoy NADA escribe en expediente_snapshots (eso lo construye la captura desde
        // los visores, Fase 2), así que en la práctica este bloque restaura backups con
        // el array vacío. Se implementa completo igual para no volver acá cuando F2 exista.
        const porCasoKind = new Map();
        for (const s of backup.snapshots) {
            const real = idMap.get(Number(s.expediente_id));
            if (!real) continue;                      // historial de un caso que no vino en el backup
            const clave = `${real}|${s.kind}`;
            if (!porCasoKind.has(clave)) porCasoKind.set(clave, []);
            porCasoKind.get(clave).push(s);
        }
        for (const [clave, lista] of porCasoKind.entries()) {
            const [expIdStr, kind] = clave.split('|');
            const expId = Number(expIdStr);
            // El backup pisa el historial del caso (es la foto que el usuario eligió
            // restaurar) y se respeta el tope estructural: los 2 más nuevos.
            lista.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            await client.query(
                'DELETE FROM expediente_snapshots WHERE expediente_id = $1 AND kind = $2',
                [expId, kind]
            );
            for (const s of lista.slice(0, MAX_SNAPSHOTS_POR_KIND)) {
                await client.query(
                    `INSERT INTO expediente_snapshots (expediente_id, kind, run_date, situacion, data)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [expId, kind, fecha(s.run_date) ?? new Date().toISOString(),
                     texto(s.situacion, MAX_TEXTO_CORTO), JSON.stringify(s.data ?? {})]
                );
                resumen.snapshotsCreados++;
            }
        }

        // ⚠️ NO se toca la secuencia de `bitacora_entries` — y no hace falta.
        // Insertar ids explícitos normalmente deja la secuencia atrás y el próximo
        // INSERT chocaría... pero acá no puede pasar: TODO id de un backup fue emitido
        // en su momento por esta misma secuencia, así que es ≤ su valor actual (las
        // secuencias solo avanzan). El próximo nextval() devuelve last_value+1, mayor
        // que cualquier id del backup → nunca colisiona.
        // Además, un `setval` acá fallaría: `procurador_user` tiene USAGE+SELECT sobre
        // las secuencias (lo que concedió la migración de F1.1), y setval exige UPDATE.
        // Verificado en staging: sin esta llamada, crear una entrada nueva justo después
        // de un import con ids preservados funciona sin colisión.

        await client.query('COMMIT');
        return resumen;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RECLAMO DE BORRADOR DE CAPTURA  →  GET /usuarios/api/capture-draft/:id  (F2.2)
// ═══════════════════════════════════════════════════════════════════════════
// Paso 3 del Post/Redirect/Get: el visor posteó anónimo a /usuarios/capture, el
// servidor guardó el payload en un buffer y redirigió al portal con el id. Acá
// —y recién acá— hay un usuario autenticado: este endpoint SÍ lleva JWT y el gate
// de plan, a diferencia del POST anónimo que lo alimenta (ver routes/capture.js).
//
// USO ÚNICO: reclamar borra el borrador. Un refresh del portal no vuelve a traerlo,
// que es justamente lo que el patrón PRG busca evitar (reenvío de formulario).
router.get('/capture-draft/:id', authenticateToken, checkBitacoraPlan(), (req, res) => {
    const payload = reclamarDraft(req.params.id);
    if (!payload) {
        return res.status(404).json({
            error: 'El borrador de captura no existe o expiró. Volvé al visor y hacé clic de nuevo.',
            code: 'CAPTURE_DRAFT_NO_ENCONTRADO'
        });
    }
    res.json({ success: true, draft: payload });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ENTRADAS DE BITÁCORA  →  /usuarios/api/bitacora
// ═══════════════════════════════════════════════════════════════════════════

const entradas = express.Router();

// ─── POST /import — restaurar desde un backup JSON ─────────────────────────
// Va montado dentro de `entradas`, así que hereda el gate ESTRICTO del plan
// (`checkBitacoraPlan()` sin gracia): la ventana de 90 días de la decisión
// D2/Q6 es solo para SACAR los datos (export), nunca para escribir.
entradas.post('/import', uploadBackupOr400, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Subí el archivo .json del backup.' });
    }
    // Campos de texto del multipart: llegan siempre como string.
    const modo   = req.body?.modo === 'reemplazar' ? 'reemplazar' : 'combinar';
    const dryRun = req.body?.dry_run === '1' || req.body?.dry_run === 'true';

    const validado = validarBackup(req.file.buffer, userId);
    if (validado.error) return res.status(400).json({ error: validado.error });
    const backup = validado.data;

    try {
        if (dryRun) {
            const preview = await calcularPreviewImport(db, userId, backup, modo);
            return res.json({
                success: true, dry_run: true, modo,
                exportado_el: backup.exported_at,
                preview
            });
        }

        const resumen = await aplicarImport(db, userId, backup, modo);
        console.log(`📔 Bitácora: import ${modo} aplicado para user ${userId} —`, JSON.stringify(resumen));
        res.json({ success: true, dry_run: false, modo, resumen });
    } catch (error) {
        console.error('Error importando backup de bitácora:', error);
        res.status(500).json({
            error: 'Error del servidor al restaurar el backup. No se aplicó ningún cambio.'
        });
    }
});

// ─── GET / — listado con filtros ───────────────────────────────────────────
// Filtros: ?desde= &hasta= (rango de due_at) &kind= &pendientes=1 &expediente_id=
entradas.get('/', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const cond = ['e.user_id = $1'];
        const vals = [userId];
        let i = 2;

        const desde = fecha(req.query.desde);
        const hasta = fecha(req.query.hasta);
        if (desde) { cond.push(`e.due_at >= $${i++}`); vals.push(desde); }
        if (hasta) { cond.push(`e.due_at <= $${i++}`); vals.push(hasta); }

        if (typeof req.query.kind === 'string' && KINDS_ENTRADA.includes(req.query.kind)) {
            cond.push(`e.kind = $${i++}`); vals.push(req.query.kind);
        }
        if (req.query.pendientes === '1' || req.query.pendientes === 'true') {
            cond.push('e.done_at IS NULL');
        }
        if (req.query.expediente_id) {
            const fid = await fichaDelUsuario(db, userId, req.query.expediente_id);
            if (!fid) return res.status(404).json({ error: 'Expediente no encontrado' });
            cond.push(`e.expediente_id = $${i++}`); vals.push(fid);
        }

        vals.push(LIMITE_LISTADO);

        const { rows } = await db.query(
            `SELECT e.*, x.expediente, x.caratula
               FROM bitacora_entries e
               LEFT JOIN expedientes_seguidos x ON x.id = e.expediente_id
              WHERE ${cond.join(' AND ')}
              ORDER BY e.due_at ASC NULLS LAST, e.created_at DESC
              LIMIT $${i}`,
            vals
        );

        res.json({ success: true, entradas: rows, limite: LIMITE_LISTADO });
    } catch (error) {
        console.error('Error listando entradas de bitácora:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /avisos — el banner al entrar a la sección ────────────────────────
// Vencidos sin confirmar (hacia atrás) + próximos (hacia adelante).
// Ventanas por defecto de 7 días, expandibles (§3.3: "ver anteriores" / "ver más").
entradas.get('/avisos', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const diasAtras    = entero(req.query.dias_atras, 7, 1, VENTANA_MAX_DIAS);
        const diasAdelante = entero(req.query.dias_adelante, 7, 1, VENTANA_MAX_DIAS);

        const comun = `
             FROM bitacora_entries e
             LEFT JOIN expedientes_seguidos x ON x.id = e.expediente_id
            WHERE e.user_id = $1
              AND e.done_at IS NULL
              AND e.due_at IS NOT NULL`;

        const [vencidos, proximos] = await Promise.all([
            db.query(
                `SELECT e.*, x.expediente, x.caratula ${comun}
                   AND e.due_at <  NOW()
                   AND e.due_at >= NOW() - ($2 || ' days')::interval
                 ORDER BY e.due_at DESC LIMIT $3`,
                [userId, String(diasAtras), LIMITE_LISTADO]
            ),
            db.query(
                `SELECT e.*, x.expediente, x.caratula ${comun}
                   AND e.due_at >= NOW()
                   AND e.due_at <= NOW() + ($2 || ' days')::interval
                 ORDER BY e.due_at ASC LIMIT $3`,
                [userId, String(diasAdelante), LIMITE_LISTADO]
            )
        ]);

        // Total de vencidos sin confirmar SIN límite de ventana: es lo que permite
        // mostrar "hay N anteriores" sin traer todas las filas.
        const { rows: [{ total }] } = await db.query(
            `SELECT count(*)::int AS total FROM bitacora_entries
              WHERE user_id = $1 AND done_at IS NULL
                AND due_at IS NOT NULL AND due_at < NOW()`,
            [userId]
        );

        res.json({
            success: true,
            vencidos: vencidos.rows,
            proximos: proximos.rows,
            totalVencidosSinConfirmar: total,
            ventana: { diasAtras, diasAdelante }
        });
    } catch (error) {
        console.error('Error obteniendo avisos de bitácora:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST / — crear entrada ────────────────────────────────────────────────
entradas.post('/', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { kind, title, description, all_day, repeat_rule, meta, expediente_id } = req.body || {};

    if (!KINDS_ENTRADA.includes(kind)) {
        return res.status(400).json({ error: `Tipo inválido. Debe ser uno de: ${KINDS_ENTRADA.join(', ')}` });
    }
    const titulo = texto(title, MAX_TITLE);
    if (!titulo) {
        return res.status(400).json({ error: 'El título es obligatorio' });
    }
    if (repeat_rule !== undefined && repeat_rule !== null && !REPEAT_RULES.includes(repeat_rule)) {
        return res.status(400).json({ error: `Repetición inválida. Debe ser una de: ${REPEAT_RULES.join(', ')}` });
    }
    const vence = fecha(req.body?.due_at);
    if (vence === undefined && req.body?.due_at !== undefined) {
        return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
    }

    try {
        let fichaId = null;
        if (expediente_id) {
            fichaId = await fichaDelUsuario(db, userId, expediente_id);
            if (!fichaId) return res.status(404).json({ error: 'Expediente no encontrado' });
        }

        const { rows } = await db.query(
            `INSERT INTO bitacora_entries
               (user_id, expediente_id, kind, title, description, due_at, all_day, repeat_rule, meta, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual')
             RETURNING *`,
            [
                userId,
                fichaId,
                kind,
                titulo,
                texto(description, MAX_DESCRIPTION),
                vence ?? null,
                all_day === undefined ? true : Boolean(all_day),
                repeat_rule ?? null,
                meta ? JSON.stringify(meta) : null
            ]
        );

        res.status(201).json({ success: true, entrada: rows[0] });
    } catch (error) {
        console.error('Error creando entrada de bitácora:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── PUT /:id — actualizar entrada ─────────────────────────────────────────
entradas.put('/:id', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Id inválido' });

    const { kind, title, description, all_day, repeat_rule, meta, expediente_id } = req.body || {};
    const campos = [];
    const vals = [];
    let i = 1;

    if (kind !== undefined) {
        if (!KINDS_ENTRADA.includes(kind)) {
            return res.status(400).json({ error: `Tipo inválido. Debe ser uno de: ${KINDS_ENTRADA.join(', ')}` });
        }
        campos.push(`kind = $${i++}`); vals.push(kind);
    }
    if (title !== undefined) {
        const titulo = texto(title, MAX_TITLE);
        if (!titulo) return res.status(400).json({ error: 'El título no puede quedar vacío' });
        campos.push(`title = $${i++}`); vals.push(titulo);
    }
    if (description !== undefined) { campos.push(`description = $${i++}`); vals.push(texto(description, MAX_DESCRIPTION)); }
    if (all_day !== undefined)     { campos.push(`all_day = $${i++}`);     vals.push(Boolean(all_day)); }
    if (meta !== undefined)        { campos.push(`meta = $${i++}`);        vals.push(meta ? JSON.stringify(meta) : null); }

    if (repeat_rule !== undefined) {
        if (repeat_rule !== null && !REPEAT_RULES.includes(repeat_rule)) {
            return res.status(400).json({ error: `Repetición inválida. Debe ser una de: ${REPEAT_RULES.join(', ')}` });
        }
        campos.push(`repeat_rule = $${i++}`); vals.push(repeat_rule);
    }
    if (req.body?.due_at !== undefined) {
        const vence = fecha(req.body.due_at);
        if (vence === undefined) return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
        campos.push(`due_at = $${i++}`); vals.push(vence);
    }

    try {
        if (expediente_id !== undefined) {
            if (expediente_id === null) {
                campos.push(`expediente_id = $${i++}`); vals.push(null);
            } else {
                const fichaId = await fichaDelUsuario(db, userId, expediente_id);
                if (!fichaId) return res.status(404).json({ error: 'Expediente no encontrado' });
                campos.push(`expediente_id = $${i++}`); vals.push(fichaId);
            }
        }

        if (campos.length === 0) {
            return res.status(400).json({ error: 'Al menos un campo debe ser proporcionado' });
        }

        campos.push('updated_at = NOW()');
        vals.push(id, userId);

        const { rows } = await db.query(
            `UPDATE bitacora_entries SET ${campos.join(', ')}
              WHERE id = $${i++} AND user_id = $${i}
              RETURNING *`,
            vals
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada' });

        res.json({ success: true, entrada: rows[0] });
    } catch (error) {
        console.error('Error actualizando entrada de bitácora:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /:id/done — confirmar o desmarcar la realización ─────────────────
// El check del banner: un clic, sin abrir la entrada (§3.3).
entradas.post('/:id/done', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Id inválido' });

    // `done` ausente = marcar como hecha (el uso normal del check).
    const hecha = req.body?.done === undefined ? true : Boolean(req.body.done);

    try {
        const { rows } = await db.query(
            `UPDATE bitacora_entries
                SET done_at = ${hecha ? 'NOW()' : 'NULL'}, updated_at = NOW()
              WHERE id = $1 AND user_id = $2
              RETURNING *`,
            [id, userId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada' });

        res.json({ success: true, entrada: rows[0] });
    } catch (error) {
        console.error('Error cambiando estado de entrada:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────
entradas.delete('/:id', async (req, res) => {
    const db = req.app.get('db');
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Id inválido' });

    try {
        const { rowCount } = await db.query(
            'DELETE FROM bitacora_entries WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'Entrada no encontrada' });

        res.json({ success: true });
    } catch (error) {
        console.error('Error eliminando entrada de bitácora:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  FICHAS DE EXPEDIENTE  →  /usuarios/api/expedientes
// ═══════════════════════════════════════════════════════════════════════════

const expedientes = express.Router();

// ─── POST /capture-lote — alta masiva desde la selección del visor (F2.2) ──
// Consume lo que la SPA sacó del borrador de captura. Dos acciones:
//   · 'ficha-lote'    → solo crea/actualiza las fichas ("📌 Guardar casos")
//   · 'snapshot-lote' → además adjunta el snapshot de esta corrida al historial
//                       ("💾 Guardar procuración/informe de seleccionados")
//
// Va declarado ANTES de las rutas con `/:id` por claridad (hoy no hay POST /:id,
// así que no hay colisión real, pero el orden deja la intención explícita).
expedientes.post('/capture-lote', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { casos, accion } = req.body || {};

    if (!['ficha-lote', 'snapshot-lote'].includes(accion)) {
        return res.status(400).json({ error: "Acción inválida. Debe ser 'ficha-lote' o 'snapshot-lote'." });
    }
    if (!Array.isArray(casos) || casos.length === 0) {
        return res.status(400).json({ error: 'No se recibió ningún caso.' });
    }
    // Hallazgo H3: tope de FILAS por request, independiente del límite de bytes del
    // parser. El rate-limit acota la frecuencia, no el volumen — sin esto, un solo
    // POST bien armado podría intentar crear miles de fichas en una transacción.
    if (casos.length > MAX_CASOS_CAPTURE_LOTE) {
        return res.status(400).json({
            error: `Máximo ${MAX_CASOS_CAPTURE_LOTE} casos por lote; dividí la selección.`,
            code: 'LOTE_DEMASIADO_GRANDE'
        });
    }

    const conSnapshot = accion === 'snapshot-lote';
    const client = await db.connect();
    const resumen = { creados: 0, actualizados: 0, snapshots: 0, omitidos: 0 };
    // F2.3: además del resumen agregado, se devuelve el id resultante de CADA caso —
    // lo necesita el portal para vincular las entradas de bitácora que arma después
    // de esta llamada (accion='entrada'/'entrada-lote') a la ficha correcta, sin
    // depender de un segundo round-trip por caso.
    const perCaso = [];

    try {
        await client.query('BEGIN');

        for (const c of casos) {
            const exp = texto(c?.expediente, MAX_EXPEDIENTE);
            // Un expediente irreconocible se saltea en vez de abortar todo el lote:
            // viene del scraping del PJN y perder los otros 30 casos por uno raro
            // sería peor que informar cuántos quedaron afuera.
            if (!exp || !esExpedienteValido(exp)) { resumen.omitidos++; continue; }

            const { rows } = await client.query(
                `INSERT INTO expedientes_seguidos
                   (user_id, expediente, expediente_key, jurisdiccion, dependencia, caratula, situacion_actual, situacion_fecha)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                 ON CONFLICT (user_id, expediente_key) DO UPDATE SET
                   jurisdiccion     = COALESCE(EXCLUDED.jurisdiccion,     expedientes_seguidos.jurisdiccion),
                   dependencia      = COALESCE(EXCLUDED.dependencia,      expedientes_seguidos.dependencia),
                   caratula         = COALESCE(EXCLUDED.caratula,         expedientes_seguidos.caratula),
                   situacion_actual = COALESCE(EXCLUDED.situacion_actual, expedientes_seguidos.situacion_actual),
                   situacion_fecha  = EXCLUDED.situacion_fecha,
                   updated_at       = NOW()
                 RETURNING id, (xmax = 0) AS creado`,
                [
                    userId, exp, expedienteKey(exp),
                    texto(c?.jurisdiccion, MAX_TEXTO_CORTO),
                    texto(c?.dependencia, MAX_TEXTO_CORTO),
                    texto(c?.caratula, MAX_CARATULA),
                    texto(c?.situacion_actual, MAX_TEXTO_CORTO),
                ]
            );
            const fichaId = rows[0].id;
            if (rows[0].creado) resumen.creados++; else resumen.actualizados++;
            perCaso.push({ expediente: exp, expediente_id: fichaId, creado: rows[0].creado });

            if (conSnapshot) {
                const kind = c?.origen === 'informe' ? 'informe' : 'procuracion';
                await client.query(
                    `INSERT INTO expediente_snapshots (expediente_id, kind, run_date, situacion, data)
                     VALUES ($1,$2,NOW(),$3,$4)`,
                    [
                        fichaId, kind,
                        texto(c?.situacion_actual, MAX_TEXTO_CORTO),
                        JSON.stringify({ movimientos: Array.isArray(c?.movimientos) ? c.movimientos : [] })
                    ]
                );
                // Hallazgo H4: el recorte 2+2 va en la MISMA transacción que el insert.
                // Si fuera un paso aparte, dos capturas simultáneas del mismo caso podrían
                // dejar 3+ filas y romper la invariante de máx. 4 por caso sobre la que se
                // apoya el dimensionamiento del módulo (§10 del plan).
                await client.query(
                    `DELETE FROM expediente_snapshots
                      WHERE id IN (
                        SELECT id FROM expediente_snapshots
                         WHERE expediente_id = $1 AND kind = $2
                         ORDER BY created_at DESC
                         OFFSET $3
                      )`,
                    [fichaId, kind, MAX_SNAPSHOTS_POR_KIND]
                );
                resumen.snapshots++;
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, accion, resumen, perCaso });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error en captura por lote de expedientes:', error);
        res.status(500).json({ error: 'Error del servidor. No se guardó ningún caso.' });
    } finally {
        client.release();
    }
});

// ─── GET / — listado de casos seguidos ─────────────────────────────────────
expedientes.get('/', async (req, res) => {
    const db = req.app.get('db');
    try {
        const { rows } = await db.query(
            `SELECT x.*,
                    (SELECT count(*)::int FROM bitacora_entries e
                      WHERE e.expediente_id = x.id) AS total_entradas,
                    (SELECT count(*)::int FROM bitacora_entries e
                      WHERE e.expediente_id = x.id AND e.done_at IS NULL
                        AND e.due_at IS NOT NULL AND e.due_at < NOW()) AS vencidas
               FROM expedientes_seguidos x
              WHERE x.user_id = $1
              ORDER BY x.updated_at DESC
              LIMIT $2`,
            [req.user.id, LIMITE_LISTADO]
        );
        res.json({ success: true, expedientes: rows, limite: LIMITE_LISTADO });
    } catch (error) {
        console.error('Error listando expedientes seguidos:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST / — crear (o recuperar) la ficha de un caso ──────────────────────
// Upsert por (user_id, expediente_key): si el usuario intenta seguir un caso que
// ya sigue, se le devuelve el existente actualizado en vez de un error — es lo
// que espera al volver a capturarlo o a cargarlo a mano.
expedientes.post('/', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { expediente, jurisdiccion, dependencia, caratula, situacion_actual, situacion_fecha, notas } = req.body || {};

    const exp = texto(expediente, MAX_EXPEDIENTE);
    if (!exp) return res.status(400).json({ error: 'El expediente es obligatorio' });
    if (!esExpedienteValido(exp)) {
        return res.status(400).json({ error: 'El expediente no tiene un formato reconocible (ej: FCR 18745/2017)' });
    }

    // La clave SIEMPRE se calcula acá. Nunca se acepta del cliente: es lo que
    // sostiene la deduplicación (decisión D1).
    const key = expedienteKey(exp);
    const fSituacion = fecha(situacion_fecha);

    try {
        const { rows } = await db.query(
            `INSERT INTO expedientes_seguidos
               (user_id, expediente, expediente_key, jurisdiccion, dependencia, caratula, situacion_actual, situacion_fecha, notas)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (user_id, expediente_key) DO UPDATE SET
               jurisdiccion     = COALESCE(EXCLUDED.jurisdiccion,     expedientes_seguidos.jurisdiccion),
               dependencia      = COALESCE(EXCLUDED.dependencia,      expedientes_seguidos.dependencia),
               caratula         = COALESCE(EXCLUDED.caratula,         expedientes_seguidos.caratula),
               situacion_actual = COALESCE(EXCLUDED.situacion_actual, expedientes_seguidos.situacion_actual),
               situacion_fecha  = COALESCE(EXCLUDED.situacion_fecha,  expedientes_seguidos.situacion_fecha),
               notas            = COALESCE(EXCLUDED.notas,            expedientes_seguidos.notas),
               updated_at       = NOW()
             RETURNING *, (xmax = 0) AS creado`,
            [
                userId, exp, key,
                texto(jurisdiccion, MAX_TEXTO_CORTO),
                texto(dependencia, MAX_TEXTO_CORTO),
                texto(caratula, MAX_CARATULA),
                texto(situacion_actual, MAX_TEXTO_CORTO),
                fSituacion ?? null,
                texto(notas, MAX_NOTAS)
            ]
        );

        const ficha = rows[0];
        const creado = ficha.creado;
        delete ficha.creado;   // detalle interno de Postgres, no parte del contrato

        res.status(creado ? 201 : 200).json({ success: true, expediente: ficha, creado });
    } catch (error) {
        console.error('Error creando expediente seguido:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /:id — la ficha completa: datos + entradas + historial ────────────
expedientes.get('/:id', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Id inválido' });

    try {
        const { rows } = await db.query(
            'SELECT * FROM expedientes_seguidos WHERE id = $1 AND user_id = $2',
            [id, userId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Expediente no encontrado' });

        const [entradasRes, snapsRes] = await Promise.all([
            db.query(
                `SELECT * FROM bitacora_entries
                  WHERE expediente_id = $1 AND user_id = $2
                  ORDER BY due_at ASC NULLS LAST, created_at DESC`,
                [id, userId]
            ),
            // Sin JOIN a user_id: expediente_snapshots cuelga de la ficha, que ya
            // se verificó del usuario arriba.
            db.query(
                `SELECT id, kind, run_date, situacion, created_at
                   FROM expediente_snapshots
                  WHERE expediente_id = $1
                  ORDER BY created_at DESC`,
                [id]
            )
        ]);

        res.json({
            success: true,
            expediente: rows[0],
            entradas: entradasRes.rows,
            snapshots: snapsRes.rows
        });
    } catch (error) {
        console.error('Error obteniendo ficha de expediente:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /:id/snapshots/:snapshotId — contenido completo de un snapshot ────
// Separado de GET /:id a propósito: ese endpoint trae el listado resumido
// (sin `data`, el JSONB con los movimientos capturados) para no cargar la
// ficha con contenido que el usuario no pidió ver. Este endpoint es lo que
// alimenta el modal "👁 Ver" del historial (F1.4, §5.2). Hoy no hay forma de
// generar filas en `expediente_snapshots` (eso lo construye la captura desde
// los visores, Fase 2 / F2.2-F2.4, todavía sin implementar) — el endpoint
// existe desde ya para que la ficha no necesite tocarse otra vez cuando F2
// empiece a escribir snapshots reales.
expedientes.get('/:id/snapshots/:snapshotId', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    const snapshotId = parseInt(req.params.snapshotId, 10);
    if (Number.isNaN(id) || Number.isNaN(snapshotId)) return res.status(400).json({ error: 'Id inválido' });

    try {
        const fichaId = await fichaDelUsuario(db, userId, id);
        if (!fichaId) return res.status(404).json({ error: 'Expediente no encontrado' });

        const { rows } = await db.query(
            `SELECT id, kind, run_date, situacion, data, created_at
               FROM expediente_snapshots
              WHERE id = $1 AND expediente_id = $2`,
            [snapshotId, fichaId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Snapshot no encontrado' });

        res.json({ success: true, snapshot: rows[0] });
    } catch (error) {
        console.error('Error obteniendo snapshot de expediente:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── PUT /:id — actualizar la ficha ────────────────────────────────────────
expedientes.put('/:id', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Id inválido' });

    const { expediente, jurisdiccion, dependencia, caratula, situacion_actual, situacion_fecha, notas } = req.body || {};
    const campos = [];
    const vals = [];
    let i = 1;

    // Corregir el número de expediente recalcula la clave — puede chocar con otra
    // ficha del mismo usuario, que es el 409 de abajo.
    if (expediente !== undefined) {
        const exp = texto(expediente, MAX_EXPEDIENTE);
        if (!exp || !esExpedienteValido(exp)) {
            return res.status(400).json({ error: 'El expediente no tiene un formato reconocible (ej: FCR 18745/2017)' });
        }
        campos.push(`expediente = $${i++}`);     vals.push(exp);
        campos.push(`expediente_key = $${i++}`); vals.push(expedienteKey(exp));
    }
    if (jurisdiccion !== undefined)     { campos.push(`jurisdiccion = $${i++}`);     vals.push(texto(jurisdiccion, MAX_TEXTO_CORTO)); }
    if (dependencia !== undefined)      { campos.push(`dependencia = $${i++}`);      vals.push(texto(dependencia, MAX_TEXTO_CORTO)); }
    if (caratula !== undefined)         { campos.push(`caratula = $${i++}`);         vals.push(texto(caratula, MAX_CARATULA)); }
    if (situacion_actual !== undefined) { campos.push(`situacion_actual = $${i++}`); vals.push(texto(situacion_actual, MAX_TEXTO_CORTO)); }
    if (notas !== undefined)            { campos.push(`notas = $${i++}`);            vals.push(texto(notas, MAX_NOTAS)); }
    if (situacion_fecha !== undefined) {
        const f = fecha(situacion_fecha);
        if (f === undefined) return res.status(400).json({ error: 'Fecha de situación inválida' });
        campos.push(`situacion_fecha = $${i++}`); vals.push(f);
    }

    if (campos.length === 0) {
        return res.status(400).json({ error: 'Al menos un campo debe ser proporcionado' });
    }

    campos.push('updated_at = NOW()');
    vals.push(id, userId);

    try {
        const { rows } = await db.query(
            `UPDATE expedientes_seguidos SET ${campos.join(', ')}
              WHERE id = $${i++} AND user_id = $${i}
              RETURNING *`,
            vals
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Expediente no encontrado' });

        res.json({ success: true, expediente: rows[0] });
    } catch (error) {
        if (error.code === '23505') {   // unique_violation
            return res.status(409).json({
                error: 'Ya seguís otro caso con ese número de expediente.',
                code: 'EXPEDIENTE_DUPLICADO'
            });
        }
        console.error('Error actualizando expediente seguido:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── DELETE /:id?entries=keep|delete ───────────────────────────────────────
// keep (default): la ficha se borra y sus entradas quedan sueltas (la FK las
//   pone en expediente_id = NULL). Los snapshots sí se borran en cascada.
// delete: se borran también las entradas del caso.
expedientes.delete('/:id', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Id inválido' });

    const borrarEntradas = req.query.entries === 'delete';
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT id FROM expedientes_seguidos WHERE id = $1 AND user_id = $2 FOR UPDATE',
            [id, userId]
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Expediente no encontrado' });
        }

        let entradasBorradas = 0;
        if (borrarEntradas) {
            const del = await client.query(
                'DELETE FROM bitacora_entries WHERE expediente_id = $1 AND user_id = $2',
                [id, userId]
            );
            entradasBorradas = del.rowCount;
        }

        await client.query('DELETE FROM expedientes_seguidos WHERE id = $1 AND user_id = $2', [id, userId]);
        await client.query('COMMIT');

        res.json({ success: true, entradasBorradas, entradasConservadas: !borrarEntradas });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error eliminando expediente seguido:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  FERIADOS (lectura)  →  /usuarios/api/feriados
// ═══════════════════════════════════════════════════════════════════════════
// Config global del sistema, la mantiene el admin (F1.8). Acá solo se lee, para
// el date-picker y la calculadora de plazos del portal (F1.3).

const feriados = express.Router();

feriados.get('/', async (req, res) => {
    const db = req.app.get('db');
    try {
        const year = req.query.year ? entero(req.query.year, null, 2000, 2100) : null;

        const { rows } = year
            ? await db.query(
                'SELECT fecha, motivo FROM feriados WHERE EXTRACT(YEAR FROM fecha) = $1 ORDER BY fecha',
                [year])
            : await db.query('SELECT fecha, motivo FROM feriados ORDER BY fecha');

        res.json({ success: true, feriados: rows, year });
    } catch (error) {
        console.error('Error listando feriados:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUGERENCIAS (F3.3) — bandeja de aceptar/descartar
// ═══════════════════════════════════════════════════════════════════════════
// Las FILAS las escribe routes/monitor.js, en el momento en que el Monitor
// detecta una novedad (único instante en que ese evento existe — ver el
// encabezado de la migración 20260815_bitacora_f3_3.sql). Acá solo se leen y
// se resuelven.
//
// La bandeja NO duplica la de novedades del Monitor: aquella responde "¿este
// expediente es realmente de mi parte?" (mantenimiento de la línea base), esta
// responde "¿lo quiero en mi agenda?". El usuario puede querer una sin la otra.
const sugerencias = express.Router();

// ─── GET / — bandeja de pendientes ─────────────────────────────────────────
sugerencias.get('/', async (req, res) => {
    const db = req.app.get('db');
    try {
        const { rows } = await db.query(
            `SELECT id, expediente, caratula, dependencia, situacion,
                    nombre_parte, jurisdiccion_sigla, created_at
               FROM bitacora_sugerencias
              WHERE user_id = $1 AND status = 'pendiente'
              ORDER BY created_at DESC, id DESC
              LIMIT $2`,
            [req.user.id, LIMITE_LISTADO]
        );
        res.json({ success: true, sugerencias: rows, total: rows.length });
    } catch (error) {
        console.error('Error listando sugerencias:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /count — solo el número, para el badge ────────────────────────────
sugerencias.get('/count', async (req, res) => {
    const db = req.app.get('db');
    try {
        const { rows } = await db.query(
            `SELECT COUNT(*)::int AS count FROM bitacora_sugerencias
              WHERE user_id = $1 AND status = 'pendiente'`,
            [req.user.id]
        );
        res.json({ success: true, count: rows[0].count });
    } catch (error) {
        console.error('Error contando sugerencias:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /:id/aceptar — crea la ficha del caso ────────────────────────────
// Acepta opcionalmente `conEntrada: true` para dejar además una tarea de
// revisión. Todo en UNA transacción: si la entrada falla, la sugerencia no
// queda marcada como aceptada apuntando a una ficha a medias.
sugerencias.post('/:id/aceptar', async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const sugId = entero(req.params.id, null, 1, 2147483647);
    if (!sugId) return res.status(400).json({ error: 'Id inválido.' });

    const conEntrada = req.body?.conEntrada === true;
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // El WHERE lleva user_id: una sugerencia ajena da 404 sin confirmar que exista
        // (mismo criterio de IDOR que el resto del archivo). FOR UPDATE evita que dos
        // clicks simultáneos en "Aceptar" creen la ficha dos veces.
        const { rows: sugRows } = await client.query(
            `SELECT * FROM bitacora_sugerencias
              WHERE id = $1 AND user_id = $2 AND status = 'pendiente'
              FOR UPDATE`,
            [sugId, userId]
        );
        if (sugRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Sugerencia no encontrada o ya resuelta.' });
        }
        const s = sugRows[0];

        // Mismo upsert que la captura desde los visores (F2.2): si el caso ya
        // existe por otro camino, se enriquece en vez de duplicar.
        const { rows: fichaRows } = await client.query(
            `INSERT INTO expedientes_seguidos
               (user_id, expediente, expediente_key, jurisdiccion, dependencia, caratula, situacion_actual, situacion_fecha)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
             ON CONFLICT (user_id, expediente_key) DO UPDATE SET
               jurisdiccion     = COALESCE(EXCLUDED.jurisdiccion,     expedientes_seguidos.jurisdiccion),
               dependencia      = COALESCE(EXCLUDED.dependencia,      expedientes_seguidos.dependencia),
               caratula         = COALESCE(EXCLUDED.caratula,         expedientes_seguidos.caratula),
               situacion_actual = COALESCE(EXCLUDED.situacion_actual, expedientes_seguidos.situacion_actual),
               situacion_fecha  = EXCLUDED.situacion_fecha,
               updated_at       = NOW()
             RETURNING id, (xmax = 0) AS creado`,
            [
                userId, s.expediente, s.expediente_key,
                texto(s.jurisdiccion_sigla, MAX_TEXTO_CORTO),
                texto(s.dependencia, MAX_TEXTO_CORTO),
                texto(s.caratula, MAX_CARATULA),
                texto(s.situacion, MAX_TEXTO_CORTO),
            ]
        );
        const fichaId = fichaRows[0].id;

        let entradaId = null;
        if (conEntrada) {
            // Tarea SIN fecha de vencimiento a propósito: el Monitor informa que
            // apareció un caso nuevo, no cuándo vence nada. Inventar un plazo sería
            // exactamente la heurística legal que este módulo no debe adivinar.
            const titulo = texto(`Revisar caso nuevo — ${s.expediente}`, MAX_TITLE);
            const { rows: entRows } = await client.query(
                `INSERT INTO bitacora_entries
                   (user_id, expediente_id, kind, title, description, source)
                 VALUES ($1,$2,'tarea',$3,$4,'manual')
                 RETURNING id`,
                [
                    userId, fichaId, titulo,
                    texto(
                        `Detectado por el Monitor de Partes${s.nombre_parte ? ` (parte: ${s.nombre_parte})` : ''}.` +
                        `${s.caratula ? `\n${s.caratula}` : ''}`,
                        MAX_DESCRIPTION
                    ),
                ]
            );
            entradaId = entRows[0].id;
        }

        await client.query(
            `UPDATE bitacora_sugerencias
                SET status = 'aceptada', expediente_id = $1, resolved_at = NOW()
              WHERE id = $2`,
            [fichaId, sugId]
        );

        await client.query('COMMIT');
        res.json({
            success: true,
            expediente_id: fichaId,
            creado: fichaRows[0].creado,
            entrada_id: entradaId,
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error aceptando sugerencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── POST /:id/descartar ───────────────────────────────────────────────────
sugerencias.post('/:id/descartar', async (req, res) => {
    const db = req.app.get('db');
    const sugId = entero(req.params.id, null, 1, 2147483647);
    if (!sugId) return res.status(400).json({ error: 'Id inválido.' });

    try {
        const { rows } = await db.query(
            `UPDATE bitacora_sugerencias
                SET status = 'descartada', resolved_at = NOW()
              WHERE id = $1 AND user_id = $2 AND status = 'pendiente'
              RETURNING id`,
            [sugId, req.user.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Sugerencia no encontrada o ya resuelta.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error descartando sugerencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /descartar-todas ─────────────────────────────────────────────────
sugerencias.post('/descartar-todas', async (req, res) => {
    const db = req.app.get('db');
    try {
        const { rowCount } = await db.query(
            `UPDATE bitacora_sugerencias
                SET status = 'descartada', resolved_at = NOW()
              WHERE user_id = $1 AND status = 'pendiente'`,
            [req.user.id]
        );
        res.json({ success: true, descartadas: rowCount });
    } catch (error) {
        console.error('Error descartando todas las sugerencias:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  MONTAJE — ver el recuadro P1 del encabezado antes de tocar esto
// ═══════════════════════════════════════════════════════════════════════════
// El gate va acá, sobre cada sub-path. NUNCA sobre el router.
router.use('/bitacora',    authenticateToken, checkBitacoraPlan(), entradas);
router.use('/expedientes', authenticateToken, checkBitacoraPlan(), expedientes);
router.use('/feriados',    authenticateToken, checkBitacoraPlan(), feriados);
router.use('/sugerencias', authenticateToken, checkBitacoraPlan(), sugerencias);

module.exports = router;
