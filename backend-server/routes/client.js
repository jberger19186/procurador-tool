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
                   u.registration_status,
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

        // Verificar suscripción. Alineado con el login (auth.js): se bloquean los
        // estados terminales/administrativos y se permite tanto la suscripción
        // activa como el TRIAL (suspended + pending_activation), SIN importar si quedan
        // usos. La verificación de sesión es capa de SESIÓN, no de cuota: un trial
        // agotado (20/20) mantiene la sesión viva para ver el estado de la cuenta; el
        // bloqueo de ejecuciones lo aplican run-process/checkLicense/log-execution con
        // un mensaje claro. Si acá se gateara por usos, al agotarse el token deja de
        // verificarse → la app muestra "No autenticado" (confuso) y queda trabada.
        const blockedStatuses = ['rejected', 'suspended_admin', 'suspended_plan_expired', 'cancelled'];
        const isBlocked   = blockedStatuses.includes(user.registration_status);
        const isActiveSub = user.status === 'active';
        const isTrialSub  = user.status === 'suspended' && user.registration_status === 'pending_activation';
        if (!user.plan || isBlocked || (!isActiveSub && !isTrialSub)) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa',
                action: 'subscribe'
            });
        }

        // B4: expires_at NULL = sin vencimiento (no expirada). Antes new Date(null) daba
        // epoch 1970 → cualquier suscripción activa sin expires_at (ej. admins/cuentas
        // reseteadas) recibía 403 "expirada" con mensaje engañoso.
        const now = new Date();
        const expiresAt = user.expires_at ? new Date(user.expires_at) : null;

        if (expiresAt && expiresAt < now) {
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
        // Verificar suscripción activa (mismo criterio que el download)
        const subResult = await db.query(`
            SELECT 1 FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1 AND s.expires_at > NOW()
              AND (s.status = 'active' OR (s.status = 'suspended' AND u.registration_status = 'pending_activation'))
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
        // Verificar suscripción activa
        const subResult = await db.query(`
            SELECT s.* FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1 AND s.expires_at > NOW()
              AND (s.status = 'active' OR (s.status = 'suspended' AND u.registration_status = 'pending_activation'))
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
        // Verificar suscripción
        const subResult = await db.query(`
            SELECT s.plan FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1 AND s.expires_at > NOW()
              AND (s.status = 'active' OR (s.status = 'suspended' AND u.registration_status = 'pending_activation'))
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
        // Verificar suscripción. Permite el TRIAL (suspended + pending_activation):
        // las ejecuciones de prueba SÍ deben contar contra los 20 usos.
        const subResult = await db.query(`
            SELECT s.*, p.proc_executions_limit, p.informe_limit, p.monitor_novedades_limit,
                   p.proc_expedientes_limit, p.batch_executions_limit, p.batch_expedientes_limit,
                   u.registration_status
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1 AND s.expires_at > NOW()
              AND (
                s.status = 'active'
                OR (s.status = 'suspended' AND u.registration_status = 'pending_activation')
              )
        `, [userId]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({ error: 'No tienes una suscripción activa' });
        }

        const sub = subResult.rows[0];

        // Verificar límite por subsistema si aplica
        if (usageCol && success) {
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

            // Incrementar contador específico de forma atómica.
            // effectiveLimit ya incluye el bonus (limitVal + bonusVal), así que
            // se compara el uso CRUDO contra él. Antes se sumaba el bonus también
            // del lado izquierdo (usage + bonus < limit + bonus), lo que cancelaba
            // el bonus algebraicamente y bloqueaba en el límite base (bug C1).
            let updateQuery;
            let updateParams;
            if (effectiveLimit !== null) {
                updateQuery = `
                    UPDATE subscriptions
                    SET ${usageCol} = ${usageCol} + 1,
                        usage_count = usage_count + 1
                    WHERE user_id = $1
                      AND expires_at > NOW()
                      AND ${usageCol} < $2
                    RETURNING ${usageCol}, usage_count
                `;
                updateParams = [userId, effectiveLimit];
            } else {
                updateQuery = `
                    UPDATE subscriptions
                    SET ${usageCol} = ${usageCol} + 1,
                        usage_count = usage_count + 1
                    WHERE user_id = $1
                      AND expires_at > NOW()
                    RETURNING ${usageCol}, usage_count
                `;
                updateParams = [userId];
            }

            const updateResult = await db.query(updateQuery, updateParams);

            if (updateResult.rows.length === 0 && effectiveLimit !== null) {
                return res.status(403).json({ error: 'Límite alcanzado', action: 'upgrade' });
            }
        } else if (success) {
            // Backward compat: solo incrementar usage_count global.
            // Solo cuentan las ejecuciones EXITOSAS — errores y detenciones del usuario
            // no consumen usos (quedan registradas en usage_logs igualmente).
            await db.query(`
                UPDATE subscriptions SET usage_count = usage_count + 1
                WHERE user_id = $1 AND expires_at > NOW()
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
            SELECT u.email, u.cuit, u.machine_id, u.last_login,
                   u.email_verified,
                   u.nombre, u.apellido, u.telefono, u.domicilio,
                   u.registration_status,
                   s.plan, s.status, s.expires_at, s.usage_count, s.usage_limit,
                   s.period_start,
                   s.proc_usage, s.batch_usage, s.informe_usage, s.monitor_novedades_usage,
                   s.proc_bonus, s.batch_bonus, s.informe_bonus, s.monitor_novedades_bonus, s.monitor_partes_bonus,
                   s.suspension_cause, s.suspended_at, s.suspension_reason,
                   s.billing_paused, s.plan_expiry_date, s.plan_changes_this_cycle,
                   s.next_billing_date, s.payment_provider, s.cancel_at,
                   s.payment_grace_ends_at,
                   s.scheduled_plan, s.reactivation_request, s.trial_bonus_until,
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

        // Usos extra de cortesía vigentes asignados por el admin (ya incluidos en
        // usage_limit del trial; se devuelven aparte para mostrar el "+N" en la UI).
        let courtesyExtras = 0;
        try {
            const ce = await db.query(
                `SELECT COALESCE(SUM(extra_uses), 0) AS total FROM usage_extras
                 WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
                [userId]
            );
            courtesyExtras = parseInt(ce.rows[0]?.total || '0', 10);
        } catch (_) {}

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
                emailVerified: u.email_verified === true,
                cuit: u.cuit || null,
                nombre: u.nombre || null,
                apellido: u.apellido || null,
                telefono: u.telefono || null,
                domicilio: u.domicilio || null,
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
                remaining: u.usage_limit ? u.usage_limit - (u.usage_count ?? 0) : 0,
                courtesyExtras,   // usos extra de cortesía vigentes (ya incluidos en usageLimit)
                // Flujo v2.1 — estado y suscripción extendida
                registrationStatus: u.registration_status || null,
                suspensionCause: u.suspension_cause || null,
                suspendedAt: u.suspended_at || null,
                suspensionReason: u.suspension_reason || null,
                billingPaused: u.billing_paused || false,
                planExpiryDate: u.plan_expiry_date || null,
                planChangesThisCycle: u.plan_changes_this_cycle || 0,
                nextBillingDate: u.next_billing_date || null,
                paymentProvider: u.payment_provider || null,
                cancelAt: u.cancel_at || null,
                paymentGraceEndsAt: u.payment_grace_ends_at || null,
                scheduledPlan: u.scheduled_plan || null,
                reactivationRequest: u.reactivation_request || null,
                trialBonusUntil: u.trial_bonus_until || null
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
            JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1 AND s.expires_at > NOW()
              AND (s.status = 'active' OR (s.status = 'suspended' AND u.registration_status = 'pending_activation'))
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
        // Permite la extensión durante el trial: active OR (suspended + pending_activation).
        // Mismo criterio que /auth/extension-login y /auth/refresh.
        const result = await db.query(`
            SELECT s.plan, s.status, s.expires_at,
                   s.usage_count, s.usage_limit, s.payment_provider,
                   u.registration_status,
                   COALESCE(p.extension_flows, '[]'::jsonb) AS extension_flows,
                   p.plan_type, p.promo_type, p.promo_end_date,
                   p.promo_max_users, p.promo_used_count, p.promo_alert_days
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            JOIN users u ON u.id = s.user_id
            WHERE s.user_id = $1 AND s.expires_at > NOW()
              AND (
                s.status = 'active'
                OR (s.status = 'suspended' AND u.registration_status = 'pending_activation')
              )
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(403).json({
                error: 'No tenés una suscripción activa. Ingresá al portal de usuarios para ver el estado de tu cuenta.',
                action: 'subscribe'
            });
        }

        const sub = result.rows[0];

        // Trial-hasta-pago: sin método de pago, la extensión sólo sirve mientras
        // queden usos del trial (mismo cupo que la app). Al agotarse, se bloquea.
        if (!sub.payment_provider && ((sub.usage_count || 0) >= (sub.usage_limit || 0))) {
            const _msg = sub.registration_status === 'pending_activation'
                ? `Agotaste tus ${sub.usage_limit} usos de prueba. Tu cuenta está pendiente de activación por el equipo — te avisaremos por email cuando esté lista.`
                : `Agotaste tus ${sub.usage_limit} usos de prueba. Configurá tu método de pago desde el portal para seguir usando la extensión.`;
            return res.status(403).json({ error: _msg, action: 'subscribe' });
        }
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

// ─── GET /client/notifications ───────────────────────────────────────────────
// Retorna las últimas notificaciones del usuario autenticado (para la app Electron)
router.get('/notifications', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(
            `SELECT id, type, message, read, created_at
             FROM notifications
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [req.user.id]
        );
        res.json({ success: true, notifications: result.rows });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, error: 'Error al obtener notificaciones' });
    }
});

// ─── POST /client/notifications/:id/read ─────────────────────────────────────
// id = número → marca esa notificación; id = 'all' → marca todas las del usuario
router.post('/notifications/:id/read', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    try {
        const paramId = req.params.id;
        if (paramId === 'all') {
            await db.query('UPDATE notifications SET read = true WHERE user_id = $1', [req.user.id]);
            return res.json({ success: true });
        }
        const notifId = parseInt(paramId, 10);
        if (isNaN(notifId)) return res.status(400).json({ success: false, error: 'ID inválido' });
        await db.query(
            'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
            [notifId, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification read:', error);
        res.status(500).json({ success: false, error: 'Error al marcar notificación' });
    }
});

// ─── POST /client/ai/chat ─────────────────────────────────────────────────────
// Chat híbrido: llama a Claude Haiku como fallback cuando el FAQ local no matchea.
// Rate limit: 20 mensajes por usuario por hora (en memoria).
// Nota: al reiniciar el proceso (PM2 max_memory_restart) el contador se reinicia — límite
// inherente al rate-limit en memoria; aceptable por el bajo costo de Haiku. Persistir en DB
// sería la mejora futura si el abuso escala.
const aiChatRateLimits = new Map(); // userId → { count, resetAt }
// B8: podar entradas vencidas periódicamente para que el Map no crezca sin límite.
let aiChatLastSweep = 0;
function sweepAiChatRateLimits(now) {
    if (now - aiChatLastSweep < 600000) return;   // como mucho cada 10 min
    aiChatLastSweep = now;
    for (const [uid, rl] of aiChatRateLimits) {
        if (now > rl.resetAt) aiChatRateLimits.delete(uid);
    }
}

const { AI_SUPPORT_SYSTEM_PROMPT } = require('../utils/aiSupportPrompt');

router.post('/ai/chat', authenticateToken, async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Mensaje vacío' });
    }
    if (message.length > 500) {
        return res.status(400).json({ success: false, error: 'Mensaje demasiado largo (máx. 500 caracteres)' });
    }

    // Rate limit por usuario: 20 mensajes/hora
    const userId = req.user.id;
    const now = Date.now();
    sweepAiChatRateLimits(now);
    const rl = aiChatRateLimits.get(userId) || { count: 0, resetAt: now + 3600000 };
    if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + 3600000; }
    if (rl.count >= 20) {
        return res.status(429).json({ success: false, error: 'Límite de consultas alcanzado. Intentá de nuevo en una hora.' });
    }
    rl.count++;
    aiChatRateLimits.set(userId, rl);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ success: false, error: 'Servicio de IA no disponible en este momento.' });
    }

    try {
        const https = require('https');
        const payload = JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 500,
            system: AI_SUPPORT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: message.trim() }]
        });

        const response = await new Promise((resolve, reject) => {
            const req2 = https.request({
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }, (r) => {
                let data = '';
                r.on('data', chunk => data += chunk);
                r.on('end', () => {
                    try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
                    catch (e) { reject(new Error('Invalid JSON from Anthropic')); }
                });
            });
            req2.on('error', reject);
            req2.write(payload);
            req2.end();
        });

        if (response.status !== 200 || !response.body.content?.[0]?.text) {
            console.error('Anthropic API error:', response.body);
            return res.status(502).json({ success: false, error: 'Error al consultar el servicio de IA.' });
        }

        return res.json({ success: true, reply: response.body.content[0].text });
    } catch (error) {
        console.error('AI chat error:', error);
        return res.status(500).json({ success: false, error: 'Error interno al procesar la consulta.' });
    }
});

// ─── GET /client/download/electron ───────────────────────────────────────────
// Redirige siempre al instalador más reciente en GitHub Releases.
// El portal usa esta URL fija — no necesita actualizarse con cada versión.
router.get('/download/electron', authenticateToken, async (req, res) => {
    try {
        const https = require('https');
        const data = await new Promise((resolve, reject) => {
            const req2 = https.get(
                'https://api.github.com/repos/jberger19186/procurador-tool/releases/latest',
                { headers: { 'User-Agent': 'procurador-api', 'Accept': 'application/vnd.github+json' } },
                (r) => {
                    let body = '';
                    r.on('data', c => body += c);
                    r.on('end', () => resolve(JSON.parse(body)));
                }
            );
            req2.on('error', reject);
        });

        const asset = data.assets?.find(a => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap'));
        if (!asset) return res.status(404).json({ error: 'Instalador no disponible.' });

        res.redirect(asset.browser_download_url);
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener el instalador.' });
    }
});

module.exports = router;