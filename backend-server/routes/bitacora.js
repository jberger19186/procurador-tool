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
const authenticateToken = require('../middleware/authenticateToken');
const { checkBitacoraPlan } = require('../middleware/checkBitacoraPlan');
const { expedienteKey, esExpedienteValido } = require('../utils/expedienteKey');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
//  Constantes de validación
// ═══════════════════════════════════════════════════════════════════════════

const KINDS_ENTRADA = ['vencimiento', 'audiencia', 'tarea', 'gestion', 'nota'];
const REPEAT_RULES  = ['weekly', 'monthly', 'yearly'];

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
//  ENTRADAS DE BITÁCORA  →  /usuarios/api/bitacora
// ═══════════════════════════════════════════════════════════════════════════

const entradas = express.Router();

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
//  MONTAJE — ver el recuadro P1 del encabezado antes de tocar esto
// ═══════════════════════════════════════════════════════════════════════════
// El gate va acá, sobre cada sub-path. NUNCA sobre el router.
router.use('/bitacora',    authenticateToken, checkBitacoraPlan(), entradas);
router.use('/expedientes', authenticateToken, checkBitacoraPlan(), expedientes);
router.use('/feriados',    authenticateToken, checkBitacoraPlan(), feriados);

module.exports = router;
