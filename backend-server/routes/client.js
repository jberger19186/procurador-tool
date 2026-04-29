const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { scriptDownloadLimiter } = require('../middleware/rateLimiter');
const { getSignatureCache } = require('../src/security/signatureCache');
const { getDecryptedScript } = require('../utils/scriptEncryption');
const authenticateToken = require('../middleware/authenticateToken');

function buildExtPromoStatus(sub) {
    const { plan_type, promo_type, promo_end_date, promo_max_users, promo_used_count, promo_alert_days } = sub;
    if (!plan_type || plan_type === 'electron') return null;
    if (!promo_type && !promo_end_date) return null;

    const alertDays = promo_alert_days || 15;
    let alert = null;
    let daysLeft = null;

    if (promo_type === 'date' && promo_end_date) {
        daysLeft = Math.ceil((new Date(promo_end_date) - new Date()) / 86400000);
        if (daysLeft <= alertDays) alert = 'expiring_soon';
    } else if (promo_type === 'quota' && promo_max_users) {
        if ((promo_used_count || 0) / promo_max_users >= 0.85) alert = 'quota_almost_full';
    }

    return { isPromo: true, promoType: promo_type, promoEndDate: promo_end_date || null, daysLeft, alert };
}

// Verificar sesión activa
router.post('/verify-session', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Verificar que el usuario aún existe y tiene suscripción activa
        const result = await db.query(`
            SELECT u.id, u.email, u.role, u.machine_id, u.cuit,
                   s.plan, s.status, s.expires_at, s.usage_count, s.usage_limit,
                   p.plan_type
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            LEFT JOIN plans p ON p.name = s.plan
            WHERE u.id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const user = result.rows[0];

        // Verificar suscripción activa o trial con cuota disponible
        const isTrial = user.status === 'suspended' && (user.usage_limit || 0) > 0 && (user.usage_count || 0) < (user.usage_limit || 0);
        if (!user.plan || (user.status !== 'active' && !isTrial)) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa',
                action: 'subscribe'
            });
        }

        const now = new Date();
        const expiresAt = new Date(user.expires_at);

        if (expiresAt < now) {
            return res.status(403).json({
                error: 'Tu suscripción ha expirado',
                action: 'renew'
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                cuit: user.cuit || null
            },
            subscription: {
                plan: user.plan,
                status: user.status,
                expiresAt: user.expires_at,
                usageCount: user.usage_count,
                usageLimit: user.usage_limit,
                remaining: user.usage_limit == null ? null : (user.usage_limit - user.usage_count),
                planType: user.plan_type || 'electron'
            }
        });

    } catch (error) {
        console.error('Error verificando sesión:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Verificar si el hash local del script coincide con el del servidor (version check liviano)
router.get('/scripts/check/:scriptName', authenticateToken, async (req, res) => {
    const { scriptName } = req.params;
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Verificar suscripción activa o trial con cuota disponible
        const subResult = await db.query(`
            SELECT 1 FROM subscriptions
            WHERE user_id = $1 AND expires_at > NOW()
              AND (status = 'active' OR (status = 'suspended' AND usage_limit > 0 AND usage_count < usage_limit))
        `, [userId]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({ error: 'No tienes una suscripción activa' });
        }

        const normalizedName = scriptName.endsWith('.js') ? scriptName : `${scriptName}.js`;

        const result = await db.query(`
            SELECT hash, version
            FROM encrypted_scripts
            WHERE script_name = $1 AND active = true
        `, [normalizedName]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

        res.json({
            success: true,
            scriptName: normalizedName,
            hash: result.rows[0].hash,
            version: result.rows[0].version
        });

    } catch (error) {
        console.error('Error verificando versión de script:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Descargar script encriptado para ejecutar en cliente
router.get('/scripts/download/:scriptName', authenticateToken, scriptDownloadLimiter, async (req, res) => {
    const { scriptName } = req.params;
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Verificar suscripción activa o trial con cuota disponible
        const subResult = await db.query(`
            SELECT * FROM subscriptions
            WHERE user_id = $1 AND expires_at > NOW()
              AND (status = 'active' OR (status = 'suspended' AND usage_limit > 0 AND usage_count < usage_limit))
        `, [userId]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa',
                action: 'subscribe'
            });
        }

        // Normalizar nombre: agregar .js si no tiene extensión
        const normalizedName = scriptName.endsWith('.js') ? scriptName : `${scriptName}.js`;

        // Obtener script de la BD
        const scriptResult = await db.query(`
            SELECT script_name, encrypted_content, iv, hash, version
            FROM encrypted_scripts
            WHERE script_name = $1 AND active = true
        `, [normalizedName]);

        if (scriptResult.rows.length === 0) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

        const script = scriptResult.rows[0];

        // Generar clave de sesión temporal (válida por 1 hora)
        const sessionKey = jwt.sign(
            {
                userId: userId,
                scriptName: normalizedName,
                hash: script.hash
            },
            process.env.SESSION_KEY_SECRET,
            { expiresIn: '1h' }
        );

        // Desencriptar script en el servidor (nunca enviar la clave al cliente)
        const decryptedCode = await getDecryptedScript(db, normalizedName);

        // Firmar script con RSA (usa caché para evitar re-firmar)
        let securityData = null;
        try {
            const signatureCache = getSignatureCache();
            const signResult = signatureCache.getOrCalculate(scriptName, decryptedCode);
            securityData = {
                checksum: signResult.checksum,
                signature: signResult.signature,
                signedAt: signResult.signedAt
            };
            console.log(`🔏 Script firmado: ${scriptName}`);
        } catch (signError) {
            console.warn(`⚠️ No se pudo firmar ${scriptName}:`, signError.message);
            // Continúa sin firma (degradación elegante)
        }

        res.json({
            success: true,
            script: {
                name: script.script_name,
                content: decryptedCode,
                hash: script.hash,
                version: script.version
            },
            sessionKey: sessionKey,
            security: securityData
        });

    } catch (error) {
        console.error('Error descargando script:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Listar todos los scripts disponibles para el usuario
router.get('/scripts/available', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Verificar suscripción activa o trial con cuota disponible
        const subResult = await db.query(`
            SELECT plan FROM subscriptions
            WHERE user_id = $1 AND expires_at > NOW()
              AND (status = 'active' OR (status = 'suspended' AND usage_limit > 0 AND usage_count < usage_limit))
        `, [userId]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa'
            });
        }

        const plan = subResult.rows[0].plan;

        // Obtener scripts (puedes filtrar por plan si quieres)
        const scriptsResult = await db.query(`
            SELECT script_name, version, hash
            FROM encrypted_scripts
            WHERE active = true
            ORDER BY script_name
        `);

        res.json({
            success: true,
            plan: plan,
            scripts: scriptsResult.rows.map(s => ({
                name: s.script_name,
                version: s.version,
                hash: s.hash
            }))
        });

    } catch (error) {
        console.error('Error listando scripts:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Registrar ejecución de script desde cliente
router.post('/scripts/log-execution', authenticateToken, async (req, res) => {
    const { scriptName, success, errorMessage, executionTime, subsystem, expedientesCount } = req.body;
    const db = req.app.get('db');
    const userId = req.user.id;

    // Determinar columna de uso según subsistema
    const usageCol = {
        'proc':               'proc_usage',
        'batch':              'batch_usage',
        'informe':            'informe_usage',
        'monitor_novedades':  'monitor_novedades_usage'
    }[subsystem] || null;

    try {
        // Verificar suscripción activa o trial (suspended con cuotas disponibles)
        const subResult = await db.query(`
            SELECT s.*, p.proc_executions_limit, p.informe_limit, p.monitor_novedades_limit,
                   p.proc_expedientes_limit, p.batch_executions_limit, p.batch_expedientes_limit
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE s.user_id = $1
              AND (
                (s.status = 'active' AND s.expires_at > NOW())
                OR
                (s.status = 'suspended' AND s.usage_limit > 0 AND s.usage_count < s.usage_limit)
              )
        `, [userId]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({ error: 'No tienes una suscripción activa' });
        }

        // Si el usuario está en modo trial (suspended), solo contar globalmente
        const isTrial = subResult.rows[0].status === 'suspended';

        const sub = subResult.rows[0];

        // Verificar límite por subsistema si aplica (no aplica en trial)
        if (usageCol && success && !isTrial) {
            const limitVal = {
                'proc_usage':               sub.proc_executions_limit,
                'batch_usage':              sub.batch_executions_limit,
                'informe_usage':            sub.informe_limit,
                'monitor_novedades_usage':  sub.monitor_novedades_limit
            }[usageCol];

            const bonusVal = {
                'proc_usage':               sub.proc_bonus || 0,
                'batch_usage':              sub.batch_bonus || 0,
                'informe_usage':            sub.informe_bonus || 0,
                'monitor_novedades_usage':  sub.monitor_novedades_bonus || 0
            }[usageCol];

            const effectiveLimit = (limitVal === -1 || limitVal === null) ? null : (limitVal + bonusVal);
            const currentUsage = sub[usageCol] || 0;

            if (effectiveLimit !== null && currentUsage >= effectiveLimit) {
                return res.status(403).json({
                    error: `Has alcanzado el límite de ${subsystem === 'proc' ? 'procuraciones' : subsystem === 'batch' ? 'ejecuciones de batch' : subsystem === 'informe' ? 'informes' : 'consultas de monitoreo'}`,
                    action: 'upgrade'
                });
            }

            // Incrementar contador específico de forma atómica
            const bonusColName = {
                'proc_usage':               'proc_bonus',
                'batch_usage':              'batch_bonus',
                'informe_usage':            'informe_bonus',
                'monitor_novedades_usage':  'monitor_novedades_bonus'
            }[usageCol];

            let updateQuery;
            let updateParams;
            if (effectiveLimit !== null) {
                updateQuery = `
                    UPDATE subscriptions
                    SET ${usageCol} = ${usageCol} + 1,
                        usage_count = usage_count + 1
                    WHERE user_id = $1
                      AND status = 'active'
                      AND expires_at > NOW()
                      AND (${usageCol} + COALESCE(${bonusColName}, 0)) < $2
                    RETURNING ${usageCol}, usage_count
                `;
                updateParams = [userId, effectiveLimit];
            } else {
                updateQuery = `
                    UPDATE subscriptions
                    SET ${usageCol} = ${usageCol} + 1,
                        usage_count = usage_count + 1
                    WHERE user_id = $1
                      AND status = 'active'
                      AND expires_at > NOW()
                    RETURNING ${usageCol}, usage_count
                `;
                updateParams = [userId];
            }

            const updateResult = await db.query(updateQuery, updateParams);

            if (updateResult.rows.length === 0 && effectiveLimit !== null) {
                return res.status(403).json({ error: 'Límite alcanzado', action: 'upgrade' });
            }
        } else {
            // Trial o backward compat: incrementar usage_count global
            await db.query(`
                UPDATE subscriptions SET usage_count = usage_count + 1
                WHERE user_id = $1
                  AND (
                    (status = 'active' AND expires_at > NOW())
                    OR
                    (status = 'suspended' AND usage_limit > 0 AND usage_count < usage_limit)
                  )
                  AND usage_count < usage_limit
            `, [userId]);
        }

        // Registrar log con subsistema
        await db.query(`
            INSERT INTO usage_logs (user_id, script_name, success, error_message, subsystem, expedientes_count)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [userId, scriptName, success, errorMessage || null, subsystem || null, expedientesCount || null]);

        // Obtener estado actualizado
        const updatedSub = await db.query(`
            SELECT usage_count, usage_limit, proc_usage, batch_usage, informe_usage, monitor_novedades_usage
            FROM subscriptions WHERE user_id = $1
        `, [userId]);

        const updated = updatedSub.rows[0] || {};

        res.json({
            success: true,
            usageCount: updated.usage_count,
            usageLimit: updated.usage_limit,
            remaining: (updated.usage_limit || 0) - (updated.usage_count || 0),
            subsystemUsage: {
                proc:               updated.proc_usage,
                batch:              updated.batch_usage,
                informe:            updated.informe_usage,
                monitor_novedades:  updated.monitor_novedades_usage
            }
        });

    } catch (error) {
        console.error('Error registrando ejecución:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener información de cuenta del usuario
router.get('/account', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const result = await db.query(`
            SELECT u.email, u.nombre, u.apellido, u.cuit, u.machine_id, u.last_login,
                   u.email_verified, u.registration_status,
                   s.plan, s.status, s.expires_at, s.usage_count, s.usage_limit,
                   s.period_start,
                   s.proc_usage, s.batch_usage, s.informe_usage, s.monitor_novedades_usage,
                   s.proc_bonus, s.batch_bonus, s.informe_bonus, s.monitor_novedades_bonus, s.monitor_partes_bonus,
                   p.id as plan_id, p.display_name as plan_display_name, p.description as plan_description,
                   p.proc_executions_limit, p.proc_expedientes_limit,
                   p.batch_executions_limit, p.batch_expedientes_limit,
                   p.informe_limit, p.monitor_partes_limit, p.monitor_novedades_limit,
                   p.period_days, p.plan_type
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE u.id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const u = result.rows[0];

        // Obtener partes activas de monitoreo
        let monitorPartesActivas = 0;
        try {
            const partesResult = await db.query(
                `SELECT COUNT(*) as total FROM monitor_partes WHERE user_id = $1 AND activo = true`,
                [userId]
            );
            monitorPartesActivas = parseInt(partesResult.rows[0]?.total || 0);
        } catch (_) {}

        const procLimit       = u.proc_executions_limit ?? 50;
        const batchExecLimit  = u.batch_executions_limit ?? 20;
        const batchExpLimit   = u.batch_expedientes_limit ?? 10;
        const informeLimit    = u.informe_limit ?? 10;
        const monParteLimit   = u.monitor_partes_limit ?? 3;
        const monNovLimit     = u.monitor_novedades_limit ?? 10;

        const procBonus       = u.proc_bonus || 0;
        const batchBonus      = u.batch_bonus || 0;
        const informeBonus    = u.informe_bonus || 0;
        const monNovBonus     = u.monitor_novedades_bonus || 0;
        const monPartesBonus  = u.monitor_partes_bonus || 0;

        const procUsed        = u.proc_usage || 0;
        const batchUsed       = u.batch_usage || 0;
        const informeUsed     = u.informe_usage || 0;
        const monNovUsed      = u.monitor_novedades_usage || 0;

        const procEffective       = procLimit === -1      ? null : procLimit + procBonus;
        const batchExecEffective  = batchExecLimit === -1 ? null : batchExecLimit + batchBonus;
        const informeEffective    = informeLimit === -1   ? null : informeLimit + informeBonus;
        const monParteEffective   = monParteLimit === -1  ? null : monParteLimit + monPartesBonus;
        const monNovEffective     = monNovLimit === -1    ? null : monNovLimit + monNovBonus;

        const periodStart = u.period_start ? new Date(u.period_start) : new Date();
        const periodEnd   = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + (u.period_days || 30));
        const daysRemaining = Math.max(0, Math.ceil((periodEnd - new Date()) / 86400000));

        res.json({
            success: true,
            account: {
                email: u.email,
                nombre: u.nombre || null,
                apellido: u.apellido || null,
                cuit: u.cuit || null,
                emailVerified: u.email_verified || false,
                registrationStatus: u.registration_status || null,
                machineBound: !!u.machine_id,
                lastLogin: u.last_login,
                plan: {
                    name: u.plan || null,
                    displayName: u.plan_display_name || u.plan || null,
                    description: u.plan_description || null
                },
                status: u.status || null,
                expiresAt: u.expires_at || null,
                period: {
                    start: periodStart.toISOString().split('T')[0],
                    end: periodEnd.toISOString().split('T')[0],
                    daysRemaining
                },
                usage: {
                    proc: {
                        used: procUsed,
                        limit: procEffective,
                        bonus: procBonus,
                        remaining: procEffective !== null ? Math.max(0, procEffective - procUsed) : null,
                        unlimited: procLimit === -1
                    },
                    batch: {
                        used: batchUsed,
                        limit: batchExecEffective,
                        bonus: batchBonus,
                        remaining: batchExecEffective !== null ? Math.max(0, batchExecEffective - batchUsed) : null,
                        unlimited: batchExecLimit === -1,
                        expedientesPerRun: batchExpLimit === -1 ? null : batchExpLimit,
                        expedientesUnlimited: batchExpLimit === -1
                    },
                    informe: {
                        used: informeUsed,
                        limit: informeEffective,
                        bonus: informeBonus,
                        remaining: informeEffective !== null ? Math.max(0, informeEffective - informeUsed) : null,
                        unlimited: informeLimit === -1
                    },
                    monitor_partes: {
                        used: monitorPartesActivas,
                        limit: monParteEffective,
                        bonus: monPartesBonus,
                        remaining: monParteEffective !== null ? Math.max(0, monParteEffective - monitorPartesActivas) : null,
                        unlimited: monParteLimit === -1
                    },
                    monitor_novedades: {
                        used: monNovUsed,
                        limit: monNovEffective,
                        bonus: monNovBonus,
                        remaining: monNovEffective !== null ? Math.max(0, monNovEffective - monNovUsed) : null,
                        unlimited: monNovLimit === -1
                    }
                },
                planType: u.plan_type || null,
                // backward compat
                usageCount: u.usage_count ?? 0,
                usageLimit: u.usage_limit ?? 0,
                remaining: u.usage_limit ? u.usage_limit - (u.usage_count ?? 0) : 0
            }
        });
    } catch (error) {
        console.error('Error obteniendo cuenta:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Consultar límites de batch antes de ejecutar (sin consumir uso)
router.get('/batch-limits', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const result = await db.query(`
            SELECT s.batch_usage, s.batch_bonus,
                   p.batch_executions_limit, p.batch_expedientes_limit
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE s.user_id = $1 AND s.status = 'active' AND s.expires_at > NOW()
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'No tienes una suscripción activa' });
        }

        const r = result.rows[0];
        const execLimit    = r.batch_executions_limit ?? 20;
        const expLimit     = r.batch_expedientes_limit ?? 10;
        const bonus        = r.batch_bonus || 0;
        const used         = r.batch_usage || 0;
        const effectiveExecLimit = execLimit === -1 ? null : execLimit + bonus;

        res.json({
            success: true,
            batch: {
                executions: {
                    used,
                    limit: effectiveExecLimit,
                    remaining: effectiveExecLimit !== null ? Math.max(0, effectiveExecLimit - used) : null,
                    unlimited: execLimit === -1
                },
                expedientesPerRun: expLimit === -1 ? null : expLimit,
                expedientesUnlimited: expLimit === -1
            }
        });
    } catch (error) {
        console.error('Error obteniendo límites de batch:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Verificar suscripción y obtener flujos habilitados para la extensión de Chrome
// La extensión llama a este endpoint al abrirse para refrescar su estado sin re-login
router.get('/extension-auth', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const result = await db.query(`
            SELECT s.plan, s.status, s.expires_at,
                   s.usage_count, s.usage_limit,
                   COALESCE(p.extension_flows, '[]'::jsonb) AS extension_flows,
                   p.plan_type, p.promo_type, p.promo_end_date,
                   p.promo_max_users, p.promo_used_count, p.promo_alert_days
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE s.user_id = $1 AND s.expires_at > NOW()
              AND (s.status = 'active' OR (s.status = 'suspended' AND s.usage_limit > 0 AND s.usage_count < s.usage_limit))
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa',
                action: 'subscribe'
            });
        }

        const sub = result.rows[0];
        const usageLimit = sub.usage_limit || 0;
        const usageCount = sub.usage_count || 0;
        const usagePercent = usageLimit > 0 ? Math.round((usageCount / usageLimit) * 100) : 0;

        // Calcular promoStatus (reutiliza misma lógica que auth.js)
        const promoStatus = buildExtPromoStatus(sub);

        res.json({
            success: true,
            enabledFlows: sub.extension_flows,
            plan: sub.plan,
            expiresAt: sub.expires_at,
            usage: {
                count: usageCount,
                limit: usageLimit,
                usagePercent,
            },
            promoStatus,
        });

    } catch (error) {
        console.error('Error en extension-auth:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Heartbeat - mantener sesión activa
router.post('/heartbeat', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Actualizar última actividad
        await db.query(`
            UPDATE users 
            SET updated_at = NOW() 
            WHERE id = $1
        `, [userId]);

        res.json({
            success: true,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en heartbeat:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==================== NOTIFICACIONES IN-APP ====================

// GET /client/notifications — traer notificaciones no leídas del usuario
router.get('/notifications', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    try {
        const result = await db.query(`
            SELECT id, title, message, type, read_at, created_at
            FROM user_notifications
            WHERE (user_id = $1 OR user_id IS NULL)
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY created_at DESC
            LIMIT 20
        `, [userId]);
        res.json({ success: true, notifications: result.rows });
    } catch (error) {
        console.error('Error obteniendo notificaciones:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// POST /client/notifications/:id/read — marcar notificación como leída
router.post('/notifications/:id/read', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { id } = req.params;
    try {
        await db.query(`
            UPDATE user_notifications
            SET read_at = NOW()
            WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND read_at IS NULL
        `, [id, userId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error marcando notificación:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;