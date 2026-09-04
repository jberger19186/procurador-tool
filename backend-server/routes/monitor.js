const express = require('express');
const router  = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const { expedienteKey } = require('../utils/expedienteKey');

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// ─── Bitácora F3.3 — sugerencias a partir de novedades del Monitor ───────────
/**
 * Crea una sugerencia de Bitácora por cada novedad recién detectada.
 *
 * Se llama desde POST /monitor/expedientes/bulk, en el único instante en que el
 * evento "esto es una novedad" existe: apenas después de insertarla. No se puede
 * derivar después, porque el estado es transitorio — confirmar la novedad la
 * funde con la línea base (`es_linea_base=true`) y rechazarla borra la fila.
 * Ver el encabezado de database/migrations/20260815_bitacora_f3_3.sql.
 *
 * Nunca lanza hacia el llamador con algo que deba abortar el monitoreo: el
 * try/catch del call site lo garantiza, y acá se falla en silencio por caso.
 */
async function crearSugerenciasBitacora(db, userId, parteId, novedades) {
    // Gate de plan. Mismo criterio que checkBitacoraPlan (LEFT JOIN → NULL = sin
    // acceso), aplicado inline porque esto NO es un endpoint de Bitácora: no puede
    // devolver 403, solo decidir si genera o no la sugerencia.
    const { rows: planRows } = await db.query(
        `SELECT p.bitacora_enabled
           FROM users u
           LEFT JOIN subscriptions s ON s.user_id = u.id
           LEFT JOIN plans p         ON p.id      = s.plan_id
          WHERE u.id = $1`,
        [userId]
    );
    if (!(planRows.length > 0 && planRows[0].bitacora_enabled === true)) return;

    const { rows: parteRows } = await db.query(
        `SELECT nombre_parte, jurisdiccion_sigla FROM monitor_partes WHERE id = $1`,
        [parteId]
    );
    const parte = parteRows[0] || {};

    for (const { id: monitorExpId, exp } of novedades) {
        try {
            const numero = exp.numero_expediente || '';
            const key    = expedienteKey(numero);
            // Un expediente cuyo número no se puede normalizar no sirve para nada
            // aguas abajo (no se podría deduplicar ni vincular a una ficha).
            if (!key) continue;

            // No sugerir un caso que el usuario YA sigue. El anti-join usa la misma
            // clave canónica de ambos lados, que es lo que hace que "FCR 034000485/2010"
            // del Monitor matchee con "FCR 34000485/2010" tipeado a mano.
            const { rows: yaEs } = await db.query(
                `SELECT 1 FROM expedientes_seguidos WHERE user_id = $1 AND expediente_key = $2`,
                [userId, key]
            );
            if (yaEs.length > 0) continue;

            // ON CONFLICT sobre el índice parcial: si ya hay una sugerencia PENDIENTE
            // del mismo caso, no se duplica. Una descartada no bloquea: si el Monitor
            // vuelve a detectarlo más adelante, se vuelve a ofrecer.
            await db.query(
                `INSERT INTO bitacora_sugerencias
                     (user_id, origen, monitor_expediente_id, expediente, expediente_key,
                      caratula, dependencia, situacion, nombre_parte, jurisdiccion_sigla)
                 VALUES ($1, 'monitor', $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (user_id, expediente_key) WHERE status = 'pendiente' DO NOTHING`,
                [
                    userId, monitorExpId, numero, key,
                    exp.caratula || null, exp.dependencia || null, exp.situacion || null,
                    parte.nombre_parte || null, parte.jurisdiccion_sigla || null,
                ]
            );
        } catch (e) {
            // Una novedad problemática no debe frenar a las demás (misma lección que
            // el hallazgo E3-1: aislar cada iteración del batch).
            console.error(`[Bitácora F3.3] Sugerencia omitida para "${exp?.numero_expediente}":`, e.message);
        }
    }
}

// ─── Límites por plan (fallback hardcodeado para retrocompatibilidad) ─────────
const LIMITES_PLAN_FALLBACK = {
    BASIC:      { maxPartes: 3,  maxConsultasMes: 30  },
    PRO:        { maxPartes: 10, maxConsultasMes: 100 },
    ENTERPRISE: { maxPartes: 50, maxConsultasMes: 999 },
};

function getLimitePlanFallback(plan) {
    return LIMITES_PLAN_FALLBACK[plan] || LIMITES_PLAN_FALLBACK['BASIC'];
}

// Obtener límites del plan desde la BD (con fallback a hardcoded)
async function getLimitesFromDB(db, userId) {
    try {
        // Incluye el trial (suspended + pending_activation) — mismo criterio que
        // extension-login / extension-auth: el usuario en prueba usa los límites
        // reales de su plan, no el fallback BASIC.
        const result = await db.query(`
            SELECT s.plan, s.monitor_partes_bonus, s.monitor_novedades_bonus,
                   p.monitor_partes_limit, p.monitor_novedades_limit
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1
              AND (
                s.status = 'active'
                OR (s.status = 'suspended' AND u.registration_status = 'pending_activation')
              )
            ORDER BY s.id DESC LIMIT 1
        `, [userId]);

        if (result.rows.length === 0) {
            return { maxPartes: 3, maxConsultasMes: 10, plan: 'BASIC' };
        }

        const row = result.rows[0];
        const plan = row.plan || 'BASIC';

        // Si tenemos datos del plan de la BD, usarlos
        if (row.monitor_partes_limit !== null && row.monitor_partes_limit !== undefined) {
            const partesBonus = row.monitor_partes_bonus || 0;
            const novBonus    = row.monitor_novedades_bonus || 0;
            const maxPartes   = row.monitor_partes_limit === -1 ? 9999 : (row.monitor_partes_limit + partesBonus);
            const maxNov      = row.monitor_novedades_limit === -1 ? 9999 : (row.monitor_novedades_limit + novBonus);
            return { maxPartes, maxConsultasMes: maxNov, plan };
        }

        // Fallback a hardcoded
        const fallback = getLimitePlanFallback(plan);
        return { ...fallback, plan };
    } catch (_) {
        return { maxPartes: 3, maxConsultasMes: 10, plan: 'BASIC' };
    }
}

function formatFecha(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── GET /monitor/stats ───────────────────────────────────────────────────────
// Retorna: partes usadas, límite, consultas del mes, límite mensual
router.get('/stats', async (req, res) => {
    const db     = req.app.get('db');
    const userId = req.user.id;

    try {
        // Obtener límites desde BD (con fallback)
        const limite = await getLimitesFromDB(db, userId);
        const plan   = limite.plan;

        // Contar partes activas
        const partesResult = await db.query(
            `SELECT COUNT(*) FROM monitor_partes WHERE user_id = $1 AND activo = true`,
            [userId]
        );
        const partesUsadas = parseInt(partesResult.rows[0].count);

        // Contar consultas novedades del período (desde subscriptions)
        let novedadesUsadas = 0;
        try {
            const novResult = await db.query(
                `SELECT COALESCE(monitor_novedades_usage, 0) as total
                 FROM subscriptions WHERE user_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`,
                [userId]
            );
            novedadesUsadas = parseInt(novResult.rows[0]?.total || 0);
        } catch (_) {}

        // También contar consultas del mes corriente del log (para compatibilidad)
        const consultasResult = await db.query(
            `SELECT COUNT(*) FROM monitor_consultas_log
             WHERE user_id = $1
               AND date_trunc('month', fecha_ejecucion) = date_trunc('month', NOW())`,
            [userId]
        );
        const consultasMes = parseInt(consultasResult.rows[0].count);

        res.json({
            success: true,
            plan,
            partes: { usadas: partesUsadas, limite: limite.maxPartes },
            consultas: { mes: consultasMes, limite: limite.maxConsultasMes },
            novedades: { usadas: novedadesUsadas, limite: limite.maxConsultasMes },
        });
    } catch (error) {
        console.error('Error en GET /monitor/stats:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /monitor/partes ──────────────────────────────────────────────────────
// Lista partes activas del usuario con su estado de línea base
router.get('/partes', async (req, res) => {
    const db     = req.app.get('db');
    const userId = req.user.id;

    try {
        const limite = await getLimitesFromDB(db, userId);

        const result = await db.query(
            `SELECT id, nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla,
                    tiene_linea_base, activo,
                    fecha_creacion, fecha_ultima_modificacion, fecha_proxima_modificacion
             FROM monitor_partes
             WHERE user_id = $1 AND activo = true
             ORDER BY fecha_creacion ASC`,
            [userId]
        );

        res.json({
            success: true,
            partes: result.rows,
            limite: limite.maxPartes,
            usadas: result.rows.length,
        });
    } catch (error) {
        console.error('Error en GET /monitor/partes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /monitor/partes ─────────────────────────────────────────────────────
// Agrega nueva parte (valida límite por plan)
router.post('/partes', async (req, res) => {
    const { nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla } = req.body;
    const db     = req.app.get('db');
    const userId = req.user.id;

    if (!nombre_parte || !jurisdiccion_codigo || !jurisdiccion_sigla) {
        return res.status(400).json({ error: 'nombre_parte, jurisdiccion_codigo y jurisdiccion_sigla son obligatorios' });
    }
    if (nombre_parte.trim().length < 2) {
        return res.status(400).json({ error: 'El nombre de la parte debe tener al menos 2 caracteres' });
    }

    try {
        const nombreNorm  = nombre_parte.trim().toUpperCase();
        const siglaUpper  = jurisdiccion_sigla.toUpperCase();

        // Verificar si ya existe una parte ACTIVA con el mismo nombre+jurisdicción
        const activaResult = await db.query(
            `SELECT id FROM monitor_partes
             WHERE user_id = $1 AND nombre_parte = $2 AND jurisdiccion_codigo = $3 AND activo = true`,
            [userId, nombreNorm, jurisdiccion_codigo]
        );
        if (activaResult.rows.length > 0) {
            return res.status(409).json({ error: 'Ya existe una parte activa con ese nombre en esa jurisdicción' });
        }

        // B5 (revisión 2026-07-24): el límite del plan se chequea ACÁ, antes de decidir si
        // se reactiva una parte inactiva o se crea una nueva. Antes la rama de reactivación
        // (abajo) hacía return sin pasar por este chequeo — un usuario en el tope podía
        // reactivar partes viejas desactivadas una por una y superar el límite del plan
        // indefinidamente.
        const limite = await getLimitesFromDB(db, userId);
        const plan   = limite.plan;

        const countResult = await db.query(
            `SELECT COUNT(*) FROM monitor_partes WHERE user_id = $1 AND activo = true`,
            [userId]
        );
        const usadas = parseInt(countResult.rows[0].count);

        if (usadas >= limite.maxPartes) {
            return res.status(403).json({
                error: `Límite de ${limite.maxPartes} partes alcanzado para el plan ${plan}. Actualizá tu plan para agregar más.`
            });
        }

        // Verificar si existe una parte INACTIVA (eliminada previamente) — reactivarla
        const inactivaResult = await db.query(
            `SELECT id FROM monitor_partes
             WHERE user_id = $1 AND nombre_parte = $2 AND jurisdiccion_codigo = $3 AND activo = false`,
            [userId, nombreNorm, jurisdiccion_codigo]
        );

        if (inactivaResult.rows.length > 0) {
            // Reactivar: limpiar expedientes viejos y resetear la parte
            const parteId = inactivaResult.rows[0].id;
            await db.query(`DELETE FROM monitor_expedientes WHERE parte_id = $1`, [parteId]);
            const reactivada = await db.query(
                `UPDATE monitor_partes
                 SET activo = true, tiene_linea_base = false, fecha_creacion = NOW(), jurisdiccion_sigla = $1
                 WHERE id = $2
                 RETURNING id, nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla, tiene_linea_base, fecha_creacion`,
                [siglaUpper, parteId]
            );
            console.log(`♻️ Monitor: parte reactivada — usuario ${userId}: ${siglaUpper} · ${nombreNorm}`);
            return res.status(201).json({ success: true, parte: reactivada.rows[0] });
        }

        const result = await db.query(
            `INSERT INTO monitor_partes (user_id, nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla)
             VALUES ($1, $2, $3, $4)
             RETURNING id, nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla, tiene_linea_base, fecha_creacion`,
            [userId, nombreNorm, jurisdiccion_codigo, siglaUpper]
        );

        console.log(`📌 Monitor: parte agregada — usuario ${userId}: ${siglaUpper} · ${nombreNorm}`);
        res.status(201).json({ success: true, parte: result.rows[0] });

    } catch (error) {
        console.error('Error en POST /monitor/partes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── PUT /monitor/partes/:id ──────────────────────────────────────────────────
// Edita parte — solo permitido dentro de los 30 días desde la creación
router.put('/partes/:id', async (req, res) => {
    const { nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla } = req.body;
    const { id } = req.params;
    const db      = req.app.get('db');
    const userId  = req.user.id;

    if (!nombre_parte || !jurisdiccion_codigo || !jurisdiccion_sigla) {
        return res.status(400).json({ error: 'nombre_parte, jurisdiccion_codigo y jurisdiccion_sigla son obligatorios' });
    }

    try {
        const parteResult = await db.query(
            `SELECT * FROM monitor_partes WHERE id = $1 AND user_id = $2 AND activo = true`,
            [id, userId]
        );
        if (parteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Parte no encontrada' });
        }

        const parte = parteResult.rows[0];

        // Regla: se puede editar si han pasado menos de 1 hora desde la creación (gracia)
        //        O si han pasado más de 30 días (edición libre post-establecimiento).
        //        Está bloqueado en el período intermedio (1h – 30 días).
        const creacion      = new Date(parte.fecha_creacion);
        const ahora         = new Date();
        const msDesde       = ahora - creacion;
        const unaHoraMs     = 60 * 60 * 1000;
        const treintaDiasMs = 30 * 24 * 60 * 60 * 1000;
        const limite30      = new Date(creacion.getTime() + treintaDiasMs);

        if (msDesde > unaHoraMs && msDesde < treintaDiasMs) {
            return res.status(403).json({
                error: `No se puede modificar esta parte en este momento. Podrá editarla a partir del ${formatFecha(limite30)} (30 días desde la creación).`
            });
        }

        const result = await db.query(
            `UPDATE monitor_partes
             SET nombre_parte = $1,
                 jurisdiccion_codigo = $2,
                 jurisdiccion_sigla = $3,
                 tiene_linea_base = false,
                 fecha_ultima_modificacion = NOW()
             WHERE id = $4 AND user_id = $5
             RETURNING id, nombre_parte, jurisdiccion_codigo, jurisdiccion_sigla, tiene_linea_base`,
            [nombre_parte.trim().toUpperCase(), jurisdiccion_codigo, jurisdiccion_sigla.toUpperCase(), id, userId]
        );

        // Al editar se resetea la línea base — borrar expedientes anteriores
        await db.query(`DELETE FROM monitor_expedientes WHERE parte_id = $1`, [id]);

        console.log(`✏️ Monitor: parte editada — usuario ${userId}, parte ${id}`);
        res.json({ success: true, parte: result.rows[0] });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Ya existe una parte con ese nombre en esa jurisdicción' });
        }
        console.error('Error en PUT /monitor/partes/:id:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── DELETE /monitor/partes/:id ───────────────────────────────────────────────
// Elimina una parte y sus expedientes — solo permitido dentro de los 30 días desde la creación
router.delete('/partes/:id', async (req, res) => {
    const { id }  = req.params;
    const db      = req.app.get('db');
    const userId  = req.user.id;

    try {
        const parteResult = await db.query(
            `SELECT id, fecha_creacion FROM monitor_partes WHERE id = $1 AND user_id = $2 AND activo = true`,
            [id, userId]
        );
        if (parteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Parte no encontrada' });
        }

        const parte = parteResult.rows[0];

        // Regla: se puede eliminar si han pasado menos de 24 horas desde la creación (gracia)
        //        O si han pasado más de 30 días.
        //        Está bloqueado en el período intermedio (24h – 30 días).
        const creacion         = new Date(parte.fecha_creacion);
        const ahora            = new Date();
        const msDesde          = ahora - creacion;
        const veinticuatroHMs  = 24 * 60 * 60 * 1000;
        const treintaDiasMs    = 30 * 24 * 60 * 60 * 1000;
        const limite30         = new Date(creacion.getTime() + treintaDiasMs);

        if (msDesde > veinticuatroHMs && msDesde < treintaDiasMs) {
            return res.status(403).json({
                error: `No se puede eliminar esta parte en este momento. Podrá eliminarla a partir del ${formatFecha(limite30)} (30 días desde la creación).`
            });
        }

        // Borrar expedientes asociados y desactivar la parte
        await db.query(`DELETE FROM monitor_expedientes WHERE parte_id = $1`, [id]);
        await db.query(`UPDATE monitor_partes SET activo = false WHERE id = $1`, [id]);

        console.log(`🗑️ Monitor: parte eliminada — usuario ${userId}, parte ${id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error en DELETE /monitor/partes/:id:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /monitor/partes/:id/expedientes ─────────────────────────────────────
// Lista expedientes confirmados (línea base) de una parte
router.get('/partes/:id/expedientes', async (req, res) => {
    const { id }  = req.params;
    const db      = req.app.get('db');
    const userId  = req.user.id;

    try {
        // Verificar que la parte pertenece al usuario
        const parteResult = await db.query(
            `SELECT id FROM monitor_partes WHERE id = $1 AND user_id = $2 AND activo = true`,
            [id, userId]
        );
        if (parteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Parte no encontrada' });
        }

        const result = await db.query(
            `SELECT id, numero_expediente, caratula, dependencia, situacion, ultima_actuacion,
                    es_linea_base, fecha_primera_deteccion, fecha_confirmacion
             FROM monitor_expedientes
             WHERE parte_id = $1 AND confirmado = true
             ORDER BY fecha_primera_deteccion DESC`,
            [id]
        );

        res.json({ success: true, expedientes: result.rows, total: result.rows.length });
    } catch (error) {
        console.error('Error en GET /monitor/partes/:id/expedientes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /monitor/partes/:id/novedades ────────────────────────────────────────
// Lista expedientes nuevos pendientes de confirmación de una parte
router.get('/partes/:id/novedades', async (req, res) => {
    const { id }  = req.params;
    const db      = req.app.get('db');
    const userId  = req.user.id;

    try {
        const parteResult = await db.query(
            `SELECT id FROM monitor_partes WHERE id = $1 AND user_id = $2 AND activo = true`,
            [id, userId]
        );
        if (parteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Parte no encontrada' });
        }

        const result = await db.query(
            `SELECT id, numero_expediente, caratula, dependencia, situacion, ultima_actuacion,
                    fecha_primera_deteccion
             FROM monitor_expedientes
             WHERE parte_id = $1 AND confirmado = false AND es_linea_base = false
             ORDER BY fecha_primera_deteccion DESC`,
            [id]
        );

        res.json({ success: true, novedades: result.rows, total: result.rows.length });
    } catch (error) {
        console.error('Error en GET /monitor/partes/:id/novedades:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /monitor/novedades ───────────────────────────────────────────────────
// Lista TODAS las novedades pendientes del usuario (todas las partes)
router.get('/novedades', async (req, res) => {
    const db     = req.app.get('db');
    const userId = req.user.id;

    try {
        const result = await db.query(
            `SELECT me.id, me.numero_expediente, me.caratula, me.dependencia,
                    me.situacion, me.ultima_actuacion, me.fecha_primera_deteccion,
                    mp.id AS parte_id, mp.nombre_parte, mp.jurisdiccion_sigla
             FROM monitor_expedientes me
             JOIN monitor_partes mp ON mp.id = me.parte_id
             WHERE mp.user_id = $1
               AND me.confirmado = false
               AND me.es_linea_base = false
             ORDER BY me.fecha_primera_deteccion DESC`,
            [userId]
        );

        res.json({ success: true, novedades: result.rows, total: result.rows.length });
    } catch (error) {
        console.error('Error en GET /monitor/novedades:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /monitor/expedientes/all ────────────────────────────────────────────
// Todos los expedientes confirmados del usuario (todas las partes)
router.get('/expedientes/all', async (req, res) => {
    const db     = req.app.get('db');
    const userId = req.user.id;

    try {
        const result = await db.query(
            `SELECT me.id, me.numero_expediente, me.caratula, me.dependencia,
                    me.situacion, me.ultima_actuacion, me.fecha_primera_deteccion, me.fecha_confirmacion,
                    mp.id AS parte_id, mp.nombre_parte, mp.jurisdiccion_sigla
             FROM monitor_expedientes me
             JOIN monitor_partes mp ON mp.id = me.parte_id
             WHERE mp.user_id = $1
               AND mp.activo = true
               AND me.confirmado = true
             ORDER BY mp.nombre_parte ASC, me.fecha_primera_deteccion DESC`,
            [userId]
        );

        res.json({ success: true, expedientes: result.rows, total: result.rows.length });
    } catch (error) {
        console.error('Error en GET /monitor/expedientes/all:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /monitor/expedientes/bulk ──────────────────────────────────────────
// Guarda un lote de expedientes (usado por el script procesarMonitoreo.js)
router.post('/expedientes/bulk', async (req, res) => {
    const { parte_id, expedientes, es_linea_base } = req.body;
    const db     = req.app.get('db');
    const userId = req.user.id;

    if (!parte_id || !Array.isArray(expedientes)) {
        return res.status(400).json({ error: 'parte_id y expedientes[] son requeridos' });
    }

    try {
        // Verificar que la parte pertenece al usuario
        const parteResult = await db.query(
            `SELECT id FROM monitor_partes WHERE id = $1 AND user_id = $2 AND activo = true`,
            [parte_id, userId]
        );
        if (parteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Parte no encontrada o no autorizada' });
        }

        let insertados = 0;
        let duplicados = 0;
        // F3.3: filas realmente NUEVAS y que son novedad (no línea base). Solo estas
        // generan sugerencia de Bitácora. Se junta acá y se procesa DESPUÉS del loop,
        // fuera del camino crítico del Monitor.
        const novedadesInsertadas = [];

        for (const exp of expedientes) {
            try {
                // `RETURNING id` distingue un INSERT real de un ON CONFLICT DO NOTHING.
                // Sin esto no hay forma de saber si la fila se creó (el DO NOTHING no
                // lanza), que es exactamente lo que F3.3 necesita para no sugerir dos
                // veces el mismo caso en corridas sucesivas.
                const ins = await db.query(
                    `INSERT INTO monitor_expedientes
                         (parte_id, numero_expediente, caratula, dependencia, situacion,
                          ultima_actuacion, es_linea_base, confirmado, fecha_confirmacion)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (parte_id, numero_expediente) DO NOTHING
                     RETURNING id`,
                    [
                        parte_id,
                        exp.numero_expediente,
                        exp.caratula   || null,
                        exp.dependencia || null,
                        exp.situacion  || null,
                        exp.ultima_actuacion || null,
                        es_linea_base ? true : false,
                        es_linea_base ? true : false,        // si es línea base, ya queda confirmado
                        es_linea_base ? new Date() : null,
                    ]
                );
                if (ins.rows.length > 0) {
                    insertados++;
                    if (!es_linea_base) {
                        novedadesInsertadas.push({ id: ins.rows[0].id, exp });
                    }
                } else {
                    // El expediente ya estaba: ON CONFLICT DO NOTHING. Antes esto se
                    // contaba como "insertado" (el contador subía igual porque el
                    // DO NOTHING no lanza) — ahora `insertados`/`duplicados` reflejan
                    // lo que realmente pasó.
                    duplicados++;
                }
            } catch (e) {
                if (e.code === '23505') { duplicados++; } else { throw e; }
            }
        }

        // F3.3 — sugerencias de Bitácora a partir de las novedades recién detectadas.
        // ⚠️ Envuelto entero en try/catch que NUNCA propaga: el Monitor es un
        // subsistema que el usuario paga y que ya hizo su trabajo cuando llega acá.
        // Un fallo del módulo Bitácora (tabla ausente, plan no resoluble, lo que sea)
        // no puede hacer fracasar una corrida de monitoreo real contra el PJN.
        if (novedadesInsertadas.length > 0) {
            try {
                await crearSugerenciasBitacora(db, userId, parte_id, novedadesInsertadas);
            } catch (e) {
                console.error('[Bitácora F3.3] No se pudieron crear sugerencias (no crítico):', e.message);
            }
        }

        // Si es línea base, marcar la parte como que ya tiene línea base
        if (es_linea_base) {
            await db.query(
                `UPDATE monitor_partes
                 SET tiene_linea_base = true,
                     fecha_ultima_modificacion = NOW(),
                     fecha_proxima_modificacion = NOW() + INTERVAL '30 days'
                 WHERE id = $1`,
                [parte_id]
            );
        }
        // El consumo de monitor_novedades_usage se cuenta por CONSULTA ejecutada
        // (no por novedad encontrada) en POST /monitor/log — ver nota allí.

        res.json({ success: true, insertados, duplicados });

    } catch (error) {
        console.error('Error en POST /monitor/expedientes/bulk:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /monitor/expedientes/:id/confirmar ─────────────────────────────────
// Confirma un expediente nuevo (pasa a línea base)
router.post('/expedientes/:id/confirmar', async (req, res) => {
    const { id }  = req.params;
    const db      = req.app.get('db');
    const userId  = req.user.id;

    try {
        // Verificar pertenencia via join
        const result = await db.query(
            `UPDATE monitor_expedientes me
             SET confirmado = true, fecha_confirmacion = NOW(), es_linea_base = true
             FROM monitor_partes mp
             WHERE me.id = $1
               AND me.parte_id = mp.id
               AND mp.user_id = $2
             RETURNING me.id`,
            [id, userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Expediente no encontrado' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error en POST /monitor/expedientes/:id/confirmar:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /monitor/expedientes/:id/rechazar ───────────────────────────────────
// Rechaza un expediente nuevo (se elimina de la lista de novedades)
router.post('/expedientes/:id/rechazar', async (req, res) => {
    const { id }  = req.params;
    const db      = req.app.get('db');
    const userId  = req.user.id;

    try {
        const result = await db.query(
            `DELETE FROM monitor_expedientes me
             USING monitor_partes mp
             WHERE me.id = $1
               AND me.parte_id = mp.id
               AND mp.user_id = $2
               AND me.confirmado = false
             RETURNING me.id`,
            [id, userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Expediente no encontrado o ya confirmado' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error en POST /monitor/expedientes/:id/rechazar:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /monitor/novedades/bulk-confirmar ───────────────────────────────────
// Confirma (agrega a línea base) un conjunto de expedientes seleccionados
router.post('/novedades/bulk-confirmar', async (req, res) => {
    const { ids } = req.body;
    const db      = req.app.get('db');
    const userId  = req.user.id;

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids[] es requerido' });
    }

    try {
        const result = await db.query(
            `UPDATE monitor_expedientes me
             SET confirmado = true, fecha_confirmacion = NOW(), es_linea_base = true
             FROM monitor_partes mp
             WHERE me.id = ANY($1::int[])
               AND me.parte_id = mp.id
               AND mp.user_id = $2
             RETURNING me.id`,
            [ids, userId]
        );
        res.json({ success: true, confirmados: result.rows.length });
    } catch (error) {
        console.error('Error en POST /monitor/novedades/bulk-confirmar:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /monitor/novedades/descartar-todos ──────────────────────────────────
// Descarta (elimina) todas las novedades no confirmadas del usuario
router.post('/novedades/descartar-todos', async (req, res) => {
    const db     = req.app.get('db');
    const userId = req.user.id;

    try {
        const result = await db.query(
            `DELETE FROM monitor_expedientes me
             USING monitor_partes mp
             WHERE me.parte_id = mp.id
               AND mp.user_id = $1
               AND me.confirmado = false
               AND me.es_linea_base = false
             RETURNING me.id`,
            [userId]
        );
        res.json({ success: true, descartados: result.rows.length });
    } catch (error) {
        console.error('Error en POST /monitor/novedades/descartar-todos:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /monitor/log ────────────────────────────────────────────────────────
// Registra el resultado de una ejecución de monitoreo (llamado por el script)
router.post('/log', async (req, res) => {
    const { parte_id, modo, total_encontrados, nuevos_detectados, tiempo_ejecucion_ms, error } = req.body;
    const db     = req.app.get('db');
    const userId = req.user.id;

    try {
        // B5: usar parte_id solo si la parte es del usuario. Antes se insertaba el parte_id
        // del body sin validar dueño → un usuario podía loguear contra partes ajenas y
        // contaminar el historial por parte que ve el admin (IDOR de escritura).
        let validParteId = null;
        if (parte_id) {
            const { rows } = await db.query(
                'SELECT 1 FROM monitor_partes WHERE id = $1 AND user_id = $2',
                [parte_id, userId]
            );
            if (rows.length > 0) validParteId = parte_id;
        }

        await db.query(
            `INSERT INTO monitor_consultas_log
                 (parte_id, user_id, modo, total_encontrados, nuevos_detectados, tiempo_ejecucion_ms, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [validParteId, userId, modo || null, total_encontrados || 0,
             nuevos_detectados || 0, tiempo_ejecucion_ms || null, error || null]
        );

        // Consumo del límite monitor_novedades: se cuenta UNA por consulta de
        // novedades EJECUTADA (encuentre o no novedades), no por novedad detectada.
        // La consulta inicial (línea base) NO consume. Solo cuentan las exitosas.
        //
        // ── B.8 (fase E7) ────────────────────────────────────────────────────
        // Este es el OTRO canal de conteo del producto: lo llama el propio script
        // `procesarMonitoreo.js`, una vez por parte consultada. Hoy `run-monitoreo`
        // de `electron-app/main.js` NO pide permiso en `execution/start` (llama a
        // `executeRemoteScriptAsLocal` directo), así que este camino tiene que
        // seguir contando: quitarlo dejaría el monitoreo gratis e ilimitado hasta
        // el release de cliente de E8.
        //
        // Se le aplica la misma regla que a `log-execution`: si el permiso de la
        // ejecución ya descontó ESTE cupo, acá no se cuenta.
        //
        // ⚠️ La condición es `subsystem = 'monitor_novedades'`, NO "existe un permiso
        // para procesarMonitoreo.js". La diferencia no es cosmética: hoy ese script
        // resuelve a subsistema NULL en `utils/subsystems.js` —el monitoreo se cobra
        // por PARTE consultada, no por corrida, y `start` entrega un permiso por
        // corrida—, así que un permiso suyo NO descuenta `monitor_novedades_usage`.
        // Suprimir el conteo por la sola existencia del permiso dejaría el monitoreo
        // gratis en cuanto E8 lo haga pasar por `start`. Preguntando por el subsistema
        // realmente cobrado, la supresión ocurre exactamente cuando corresponde: hoy
        // nunca (ningún permiso lleva ese subsistema) y el comportamiento queda
        // idéntico al anterior; y el día que se decida cobrar el monitoreo en `start`,
        // deja de contar acá solo, sin tocar el servidor.
        //
        // Que el monitoreo pase o no por `start` —y con qué unidad de cobro, corrida
        // o parte— es una decisión de producto de E8, no de esta fase.
        if (modo === 'novedades' && !error) {
            try {
                const { rows: permiso } = await db.query(
                    `SELECT 1 FROM active_executions
                     WHERE user_id = $1
                       AND quota_counted = true
                       AND subsystem = 'monitor_novedades'
                       AND started_at > NOW() - INTERVAL '35 minutes'
                     LIMIT 1`,
                    [userId]
                );
                if (permiso.length === 0) {
                    // La guarda `AND ... < limite` es nueva: hasta E7 este UPDATE no
                    // tenía tope, así que `monitor_novedades_usage` podía superar el
                    // límite del plan (el único freno era el pre-chequeo del cliente,
                    // que es justamente lo que B.8 dejó de considerar confiable). Es
                    // la misma forma de guarda atómica que usa el resto del cupo.
                    // -1 / NULL siguen significando "sin límite".
                    //
                    // El límite se resuelve con una SUBCONSULTA, no con `FROM plans p`:
                    // un `UPDATE ... FROM` es un INNER JOIN, así que una suscripción con
                    // `plan_id` NULL dejaría de contar por completo. Con la subconsulta,
                    // los tres casos de "sin límite" (plan inexistente, límite NULL y
                    // límite -1) colapsan al mismo centinela y el UPDATE sigue corriendo.
                    // El bonus va DENTRO del COALESCE para que NULL + bonus no desarme
                    // el centinela ni desborde el entero.
                    await db.query(`
                        UPDATE subscriptions s
                        SET monitor_novedades_usage = COALESCE(s.monitor_novedades_usage, 0) + 1
                        WHERE s.user_id = $1
                          AND s.status = 'active'
                          AND COALESCE(s.monitor_novedades_usage, 0) < COALESCE(
                                (SELECT NULLIF(p.monitor_novedades_limit, -1)
                                   FROM plans p WHERE p.id = s.plan_id)
                                + COALESCE(s.monitor_novedades_bonus, 0),
                                1000000000
                              )
                    `, [userId]);
                }
            } catch (_) {}
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error en POST /monitor/log:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;
