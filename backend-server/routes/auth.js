const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter');
const authenticateToken = require('../middleware/authenticateToken');
const { blacklistToken } = require('../middleware/tokenBlacklist');
const mailer = require('../utils/mailer');
const logger = require('../utils/logger');

// ─── Validación de CUIT/CUIL ─────────────────────────────────────────────────
function validarCuit(cuit) {
    // Acepta formato XX-XXXXXXXX-X o XXXXXXXXXXX (11 dígitos)
    const clean = cuit.replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(clean)) return false;

    const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * mult[i];
    const rem = sum % 11;
    const check = rem === 0 ? 0 : rem === 1 ? 9 : 11 - rem;
    return check === parseInt(clean[10]);
}

// ─── Helper: verificar disponibilidad de promo de un plan ────────────────────
function isPromoAvailable(plan) {
    if (!plan.active) return false;
    if (plan.promo_type === 'date') {
        return plan.promo_end_date && new Date(plan.promo_end_date) > new Date();
    }
    if (plan.promo_type === 'quota') {
        return plan.promo_max_users && plan.promo_used_count < plan.promo_max_users;
    }
    // promo_type = NULL → disponible indefinidamente mientras esté active
    return true;
}

// ─── GET /auth/plan-availability ─────────────────────────────────────────────
// Devuelve disponibilidad de cada plan para registro (público, sin auth)
router.get('/plan-availability', async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            SELECT name, display_name, plan_type, price_usd, active,
                   promo_type, promo_end_date, promo_max_users, promo_used_count,
                   proc_executions_limit, informe_limit, monitor_novedades_limit,
                   batch_executions_limit, extension_flows
            FROM plans
            ORDER BY id
        `);

        const plans = result.rows.map(p => {
            const available = isPromoAvailable(p);
            let reason = null;
            if (!p.active) reason = 'plan_inactive';
            else if (p.promo_type === 'date' && !available) reason = 'promo_expired';
            else if (p.promo_type === 'quota' && !available) reason = 'quota_full';

            return {
                name: p.name,
                display_name: p.display_name,
                plan_type: p.plan_type,
                price_usd: p.price_usd,
                available,
                reason,
                promo_type: p.promo_type,
                promo_end_date: p.promo_end_date,
                promo_remaining: p.promo_type === 'quota'
                    ? Math.max(0, p.promo_max_users - p.promo_used_count)
                    : null,
                limits: {
                    proc: p.proc_executions_limit,
                    informe: p.informe_limit,
                    monitor: p.monitor_novedades_limit,
                    batch: p.batch_executions_limit,
                },
                extension_flows: p.extension_flows,
            };
        });

        res.json({ success: true, plans });
    } catch (error) {
        logger.error('Error en plan-availability:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /auth/register-status ───────────────────────────────────────────────
// Público — indica si el registro está abierto (Gap 5)
router.get('/register-status', async (req, res) => {
    const db = req.app.get('db');
    try {
        const r = await db.query(`SELECT value FROM app_settings WHERE key = 'allow_public_register'`);
        const open = r.rows.length > 0 ? r.rows[0].value === 'true' : process.env.ALLOW_PUBLIC_REGISTER === 'true';
        res.json({ open });
    } catch {
        const open = process.env.ALLOW_PUBLIC_REGISTER === 'true';
        res.json({ open });
    }
});

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
    // Leer configuración desde DB (con fallback a env var) — Gap 5
    let registroHabilitado = process.env.ALLOW_PUBLIC_REGISTER === 'true';
    try {
        const r = await db.query(`SELECT value FROM app_settings WHERE key = 'allow_public_register'`);
        if (r.rows.length > 0) registroHabilitado = r.rows[0].value === 'true';
    } catch { /* usa fallback */ }
    if (!registroHabilitado) {
        return res.status(403).json({ error: 'El registro de nuevos usuarios está temporalmente cerrado.' });
    }

    const {
        nombre, apellido, email, password, cuit,
        domicilio, plan_name, toc_accepted
    } = req.body;
    const db = req.app.get('db');

    try {
        // Validaciones básicas
        const required = { nombre, apellido, email, password, cuit, plan_name };
        for (const [key, val] of Object.entries(required)) {
            if (!val || String(val).trim() === '') {
                return res.status(400).json({ error: `El campo '${key}' es requerido` });
            }
        }

        if (!domicilio || !domicilio.calle || !domicilio.numero || !domicilio.localidad || !domicilio.provincia) {
            return res.status(400).json({ error: 'El domicilio debe incluir calle, numeración, localidad y provincia' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }

        if (!validarCuit(cuit)) {
            return res.status(400).json({ error: 'CUIT/CUIL inválido. Verificá el formato y dígito verificador.' });
        }

        if (!toc_accepted) {
            return res.status(400).json({ error: 'Debes aceptar los Términos y Condiciones' });
        }

        // Verificar plan
        const planResult = await db.query(`
            SELECT * FROM plans WHERE name = $1
        `, [plan_name]);

        if (planResult.rows.length === 0) {
            return res.status(400).json({ error: 'Plan no encontrado' });
        }

        const plan = planResult.rows[0];
        if (!isPromoAvailable(plan)) {
            return res.status(400).json({ error: 'El plan seleccionado ya no está disponible. Por favor recargá la página.' });
        }

        // Registrar dentro de una transacción
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const hashedPassword = await bcrypt.hash(password, 10);
            const token = crypto.randomBytes(32).toString('hex');
            const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hs

            const userResult = await client.query(`
                INSERT INTO users (
                    nombre, apellido, email, password_hash, cuit, domicilio,
                    registration_status, toc_accepted_at,
                    email_verified, email_verify_token, email_verify_expires
                ) VALUES ($1,$2,$3,$4,$5,$6,'pending_email',NOW(),false,$7,$8)
                RETURNING id, email, nombre, apellido
            `, [
                nombre.trim(), apellido.trim(), email.trim().toLowerCase(),
                hashedPassword, cuit.replace(/[-\s]/g, ''),
                JSON.stringify(domicilio),
                token, tokenExpires
            ]);

            const newUser = userResult.rows[0];

            // Suscripción en estado suspended con trial de 20 ejecuciones
            await client.query(`
                INSERT INTO subscriptions (
                    user_id, plan, plan_id, status,
                    usage_limit, usage_count,
                    expires_at
                ) VALUES ($1, $2, $3, 'suspended', 20, 0, NOW() + INTERVAL '365 days')
            `, [newUser.id, plan.name, plan.id]);

            // Incrementar contador de promo si aplica
            if (plan.promo_type === 'date' || plan.promo_type === 'quota') {
                await client.query(`
                    UPDATE plans SET promo_used_count = promo_used_count + 1 WHERE id = $1
                `, [plan.id]);
            }

            await client.query('COMMIT');

            // Enviar emails (no bloquean la respuesta)
            mailer.sendEmailVerification(email, nombre, token).catch(() => {});
            mailer.sendAdminNewUserAlert({
                nombre, apellido, email, cuit, plan_name: plan.display_name
            }).catch(() => {});

            logger.info(`✅ Nuevo registro: ${email} (plan: ${plan_name})`);

            res.status(201).json({
                success: true,
                message: 'Registro exitoso. Revisá tu email para confirmar tu cuenta.',
            });

        } catch (txError) {
            await client.query('ROLLBACK');
            throw txError;
        } finally {
            client.release();
        }

    } catch (error) {
        if (error.code === '23505') {
            if (error.detail && error.detail.includes('cuit')) {
                return res.status(400).json({ error: 'Este CUIT ya tiene una cuenta registrada. Contactá al soporte si creés que es un error.' });
            }
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        logger.error('Error en registro:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /auth/verify-email ───────────────────────────────────────────────────
router.get('/verify-email', async (req, res) => {
    const { token } = req.query;
    const db = req.app.get('db');

    if (!token) {
        return res.status(400).send(renderVerifyPage('error', 'Token inválido.'));
    }

    try {
        const result = await db.query(`
            SELECT u.id, u.email, u.nombre, u.apellido, p.display_name AS plan_name
            FROM users u
            JOIN subscriptions s ON u.id = s.user_id
            JOIN plans p ON s.plan_id = p.id
            WHERE u.email_verify_token = $1
              AND u.email_verify_expires > NOW()
              AND u.email_verified = false
        `, [token]);

        if (result.rows.length === 0) {
            // Verificar si el token ya fue usado (email ya verificado con este token)
            const alreadyVerified = await db.query(
                'SELECT id, nombre FROM users WHERE email_verify_token = $1 AND email_verified = true',
                [token]
            );
            if (alreadyVerified.rows.length > 0) {
                return res.send(renderVerifyPage('success',
                    `Tu email ya fue verificado anteriormente. El administrador activará tu cuenta en breve. Tenés 20 ejecuciones de prueba disponibles en la app.`));
            }
            return res.status(400).send(renderVerifyPage('error',
                'El enlace de verificación es inválido o expiró. Contactá al administrador para que te reenvíe el email de verificación.'));
        }

        const user = result.rows[0];

        await db.query(`
            UPDATE users
            SET email_verified = true,
                registration_status = 'pending_activation',
                email_verify_token = NULL,
                email_verify_expires = NULL
            WHERE id = $1
        `, [user.id]);

        // La suscripción se mantiene 'suspended' con usage_limit=20.
        // El usuario puede usar la app hasta agotar ese cupo compartido entre todos
        // los subsistemas. El admin activa formalmente para asignar los límites del plan.

        mailer.sendWelcomeEmail(user.email, user.nombre, user.plan_name).catch(() => {});

        logger.info(`✅ Email verificado y suscripción trial activada: ${user.email}`);

        res.send(renderVerifyPage('success',
            `¡Hola ${user.nombre}! Tu email fue confirmado. Ya podés ingresar a la app y usar tus 20 ejecuciones de prueba. El administrador gestionará tu plan completo.`));

    } catch (error) {
        logger.error('Error en verify-email:', error.message);
        res.status(500).send(renderVerifyPage('error', 'Error del servidor. Intentá nuevamente más tarde.'));
    }
});

// ─── Helper: construir promoStatus para respuesta de login ────────────────────
function buildPromoStatus(subscription) {
    const { promo_type, promo_end_date, promo_max_users, promo_used_count, promo_alert_days, plan_type } = subscription;

    // Solo aplica a planes promo
    if (!plan_type || plan_type === 'electron') return null;
    if (!promo_type && !promo_end_date) return null;

    const alertDays = promo_alert_days || 15;
    let alert = null;
    let daysLeft = null;

    if (promo_type === 'date' && promo_end_date) {
        const msLeft = new Date(promo_end_date) - new Date();
        daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
        if (daysLeft <= alertDays) alert = 'expiring_soon';
    } else if (promo_type === 'quota' && promo_max_users) {
        const used = promo_used_count || 0;
        const pct = used / promo_max_users;
        if (pct >= 0.85) alert = 'quota_almost_full';
    }

    return {
        isPromo: true,
        promoType: promo_type,
        promoEndDate: promo_end_date || null,
        daysLeft,
        alert,
    };
}

function renderVerifyPage(type, message) {
    const color = type === 'success' ? '#16a34a' : '#dc2626';
    const icon = type === 'success' ? '✅' : '❌';
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Verificación — Procurador SCW</title>
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9}
.card{background:#fff;border-radius:12px;padding:40px;max-width:480px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}
h2{color:${color}} p{color:#374151;line-height:1.6} .icon{font-size:48px;margin-bottom:12px}
a{color:#1e40af;text-decoration:none}</style></head>
<body><div class="card">
<div class="icon">${icon}</div>
<h2>Procurador SCW</h2>
<p>${message}</p>
<p style="margin-top:24px"><a href="https://api.procuradortool.com/usuarios/">Ingresar al portal →</a></p>
</div></body></html>`;
}

// ─── POST /auth/resend-verification ──────────────────────────────────────────
// Público — reenvía el email de verificación (Gap 2)
router.post('/resend-verification', async (req, res) => {
    const { email } = req.body || {};
    const db = req.app.get('db');

    if (!email) return res.status(400).json({ error: 'Email requerido' });

    try {
        const result = await db.query(
            `SELECT id, nombre FROM users WHERE email = $1 AND email_verified = false`,
            [email.trim().toLowerCase()]
        );

        // Respuesta genérica para no revelar si el email existe
        if (result.rows.length === 0) {
            return res.json({ success: true, message: 'Si el email está registrado y pendiente de verificación, recibirás el enlace en breve.' });
        }

        const user = result.rows[0];
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.query(
            `UPDATE users SET email_verify_token=$1, email_verify_expires=$2 WHERE id=$3`,
            [token, expires, user.id]
        );

        mailer.sendEmailVerification(email, user.nombre, token).catch(() => {});
        logger.info(`📧 Reenvío de verificación solicitado: ${email}`);

        res.json({ success: true, message: 'Email de verificación reenviado. Revisá tu casilla en los próximos minutos.' });

    } catch (error) {
        logger.error('Error en resend-verification:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Login admin (dashboard web — sin machineId ni suscripción requerida)
router.post('/admin-login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    const db = req.app.get('db');

    try {
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const userResult = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = userResult.rows[0];

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Acceso denegado: se requiere rol administrador' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        await db.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        console.log(`✅ Admin login: ${email}`);

        res.json({
            success: true,
            token,
            user: { id: user.id, email: user.email, role: user.role }
        });

    } catch (error) {
        console.error('Error en admin-login:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
    const { email, password, machineId } = req.body;
    const db = req.app.get('db');

    try {
        // Validaciones básicas
        if (!email || !password || !machineId) {
            return res.status(400).json({
                error: 'Email, contraseña y machineId son requeridos'
            });
        }

        // Buscar usuario
        const userResult = await db.query(`
            SELECT * FROM users WHERE email = $1
        `, [email]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = userResult.rows[0];

        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Gap 1 — Bloquear acceso hasta verificar email
        if (!user.email_verified) {
            return res.status(403).json({
                error: 'Debés verificar tu email antes de ingresar. Revisá tu casilla o solicitá un nuevo enlace desde el portal de usuarios.',
                code: 'EMAIL_NOT_VERIFIED'
            });
        }

        // Verificar suscripción (también permite suspended con usage_limit > 0 = trial)
        const subResult = await db.query(`
            SELECT s.*, p.promo_type, p.promo_end_date, p.promo_max_users,
                   p.promo_used_count, p.promo_alert_days, p.plan_type
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE s.user_id = $1
              AND (s.status = 'active' OR (s.status = 'suspended' AND s.usage_limit > 0))
              AND s.expires_at > NOW()
        `, [user.id]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa',
                action: 'subscribe'
            });
        }

        const subscription = subResult.rows[0];

        // Registrar último login
        await db.query(`
            UPDATE users 
            SET last_login = NOW() 
            WHERE id = $1
        `, [user.id]);

        // Generar JWT (válido por 1 hora, se renueva con /refresh)
        const token = jwt.sign(
            {
                id: user.id,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Generar session key temporal (válido por 24h)
        const sessionKey = jwt.sign(
            {
                userId: user.id,
                machineId: machineId,
                loginTime: Date.now()
            },
            process.env.SESSION_KEY_SECRET,
            { expiresIn: '24h' }
        );

        console.log(`✅ Login exitoso: ${email} (${user.role})`);

        // Calcular estado de promo para notificar al cliente Electron
        const promoStatus = buildPromoStatus(subscription);

        res.json({
            success: true,
            token,
            sessionKey,
            user: {
                id: user.id,
                role: user.role
            },
            subscription: {
                plan: subscription.plan,
                status: subscription.status,
                expiresAt: subscription.expires_at,
                usageCount: subscription.usage_count,
                usageLimit: subscription.usage_limit,
                remaining: subscription.usage_limit - subscription.usage_count
            },
            promoStatus
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Login desde extensión de Chrome (sin machineId — hardware binding no aplica a extensiones)
router.post('/extension-login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    const db = req.app.get('db');

    try {
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const userResult = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = userResult.rows[0];

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Gap 4 — Permitir trial (suspended + usage_limit > 0) además de active
        const subResult = await db.query(`
            SELECT s.plan, s.status, s.expires_at, s.usage_limit, s.usage_count,
                   COALESCE(p.extension_flows, '[]'::jsonb) AS extension_flows
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE s.user_id = $1
              AND (s.status = 'active' OR (s.status = 'suspended' AND s.usage_limit > 0))
              AND s.expires_at > NOW()
        `, [user.id]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa',
                action: 'subscribe'
            });
        }

        const sub = subResult.rows[0];

        await db.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

        // JWT de extensión (2 h, se renueva vía /auth/refresh)
        const token = jwt.sign(
            { id: user.id, role: user.role, client: 'extension' },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        console.log(`✅ Extension-login: ${email}`);

        res.json({
            success: true,
            token,
            user: { id: user.id, email: user.email, emailVerified: user.email_verified },
            extension: {
                enabledFlows: sub.extension_flows,
                plan: sub.plan,
                status: sub.status,
                expiresAt: sub.expires_at,
                isTrial: sub.status === 'suspended'
            }
        });

    } catch (error) {
        console.error('Error en extension-login:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Logout (invalidar sesión)
router.post('/logout', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Invalidar el token actual
        blacklistToken(req.token);
        console.log(`👋 Logout: usuario ${userId}`);

        res.json({
            success: true,
            message: 'Sesión cerrada correctamente'
        });

    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Verificar que el usuario aún existe y tiene suscripción activa
        const userResult = await db.query(`
            SELECT u.id, u.email, u.role, s.status, s.expires_at
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            WHERE u.id = $1
        `, [userId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const user = userResult.rows[0];

        // Verificar suscripción activa o trial con cuota disponible
        const isTrialSub = user.status === 'suspended' && (user.usage_limit || 0) > 0 && (user.usage_count || 0) < (user.usage_limit || 0);
        if (!user.status || (user.status !== 'active' && !isTrialSub)) {
            return res.status(403).json({
                error: 'Suscripción no activa',
                action: 'subscribe'
            });
        }

        const now = new Date();
        const expiresAt = new Date(user.expires_at);

        if (expiresAt < now) {
            return res.status(403).json({
                error: 'Suscripción expirada',
                action: 'renew'
            });
        }

        // Generar nuevo token (1 hora)
        const token = jwt.sign(
            {
                id: user.id,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        console.log(`🔄 Token renovado: ${user.email}`);

        res.json({
            success: true,
            token
        });

    } catch (error) {
        console.error('Error en refresh:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Cambiar contraseña
router.post('/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Validaciones
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Contraseña actual y nueva son requeridas'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                error: 'La nueva contraseña debe tener al menos 8 caracteres'
            });
        }

        // Obtener usuario
        const userResult = await db.query(`
            SELECT password_hash FROM users WHERE id = $1
        `, [userId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Verificar contraseña actual
        const validPassword = await bcrypt.compare(
            currentPassword,
            userResult.rows[0].password_hash
        );

        if (!validPassword) {
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }

        // Hash de nueva contraseña
        const newHashedPassword = await bcrypt.hash(newPassword, 10);

        // Actualizar contraseña
        await db.query(`
            UPDATE users 
            SET password_hash = $1 
            WHERE id = $2
        `, [newHashedPassword, userId]);

        console.log(`🔐 Contraseña cambiada: usuario ${userId}`);

        res.json({
            success: true,
            message: 'Contraseña actualizada correctamente'
        });

    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /auth/admin/send-password-reset  (llamado desde el dashboard admin) ──
router.post('/admin/send-password-reset', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });

    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requerido' });

    const db = req.app.get('db');
    try {
        const userResult = await db.query(
            'SELECT id, email, nombre FROM users WHERE id = $1', [userId]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const u     = userResult.rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        const exp   = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.query(
            'UPDATE users SET password_reset_token=$1, password_reset_expires=$2 WHERE id=$3',
            [token, exp, userId]
        );

        const baseUrl = process.env.BASE_URL || 'https://api.procuradortool.com';
        const link    = `${baseUrl}/auth/reset-password?token=${token}`;

        await mailer.sendEmail(
            u.email,
            'Restablecer tu contraseña — Procurador SCW',
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#1e40af">Procurador SCW</h2>
              <p>Hola <strong>${u.nombre || u.email}</strong>,</p>
              <p>El administrador ha solicitado el restablecimiento de tu contraseña. Hacé clic en el botón para crear una nueva:</p>
              <div style="text-align:center;margin:30px 0">
                <a href="${link}" style="background:#1e40af;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-size:16px">
                  Restablecer contraseña
                </a>
              </div>
              <p style="color:#6b7280;font-size:13px">Este enlace vence en 24 horas. Si no solicitaste este cambio, ignorá este mensaje.</p>
              <p style="color:#6b7280;font-size:12px">Si el botón no funciona, copiá este enlace:<br><a href="${link}">${link}</a></p>
            </div>`
        );

        logger.info(`🔑 Reset de contraseña enviado a ${u.email} por admin ${req.user.id}`);
        res.json({ success: true, message: `Email de reset enviado a ${u.email}` });

    } catch (error) {
        logger.error('Error enviando reset de contraseña:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /auth/forgot-password  (formulario público: ingresá tu email) ────────
router.get('/forgot-password', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Recuperar contraseña — Procurador SCW</title>
    <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9}
    .card{background:#fff;border-radius:12px;padding:40px;max-width:420px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.1)}
    h2{color:#1e40af;margin-top:0;font-size:20px} p{color:#374151;font-size:14px;line-height:1.6}
    label{font-size:13px;font-weight:600;display:block;margin-bottom:4px;color:#374151}
    input{width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:15px;box-sizing:border-box;margin-bottom:16px}
    button{width:100%;background:#1e40af;color:#fff;border:none;padding:12px;border-radius:6px;font-size:16px;cursor:pointer}
    button:hover{background:#1d4ed8}
    .note{font-size:12px;color:#6b7280;margin-top:12px;text-align:center}</style>
    </head><body><div class="card">
    <h2>Procurador SCW</h2>
    <p>Ingresá tu email y te enviaremos un enlace para restablecer tu contraseña.</p>
    <form method="POST" action="/auth/forgot-password">
        <label>Email</label>
        <input type="email" name="email" required placeholder="tu@email.com" autofocus>
        <button type="submit">Enviar enlace</button>
    </form>
    <p class="note">Si no recibís el email en unos minutos, revisá tu carpeta de spam.</p>
    </div></body></html>`);
});

// ─── POST /auth/forgot-password  (envía el reset email) ───────────────────────
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body || {};
    const db = req.app.get('db');

    const cardStyle = `body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9}
    .card{background:#fff;border-radius:12px;padding:40px;max-width:480px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}
    p{color:#374151;line-height:1.6;font-size:14px}
    a{color:#1e40af;text-decoration:none} a:hover{text-decoration:underline}`;

    const successPage = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Email enviado — Procurador SCW</title>
    <style>${cardStyle} h2{color:#16a34a}</style>
    </head><body><div class="card"><div style="font-size:48px;margin-bottom:12px">📬</div>
    <h2>Procurador SCW</h2>
    <p>Te enviamos un enlace para restablecer tu contraseña.<br>Revisá tu bandeja de entrada (y la carpeta de spam).</p>
    </div></body></html>`;

    const notFoundPage = (emailVal) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Email no encontrado — Procurador SCW</title>
    <style>${cardStyle} h2{color:#dc2626}</style>
    </head><body><div class="card"><div style="font-size:48px;margin-bottom:12px">⚠️</div>
    <h2>Procurador SCW</h2>
    <p>No encontramos ninguna cuenta asociada al email <strong>${emailVal}</strong>.</p>
    <p>Verificá que sea el email con el que te registraste, o <a href="/register">creá una cuenta nueva</a>.</p>
    <p style="margin-top:20px"><a href="/auth/forgot-password">← Volver</a></p>
    </div></body></html>`;

    if (!email) return res.redirect('/auth/forgot-password');

    try {
        const result = await db.query(
            'SELECT id, email, nombre FROM users WHERE email = $1 AND role != $2',
            [email.toLowerCase().trim(), 'admin']
        );
        if (result.rows.length === 0) {
            return res.send(notFoundPage(email));
        }
        const u = result.rows[0];
        const token   = require('crypto').randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.query(
            'UPDATE users SET password_reset_token=$1, password_reset_expires=$2 WHERE id=$3',
            [token, expires, u.id]
        );
        const resetLink = `${process.env.BACKEND_URL || 'https://api.procuradortool.com'}/auth/reset-password?token=${token}`;
        await mailer.sendEmail(
            u.email,
            'Restablecer tu contraseña — Procurador SCW',
            `<p>Hola${u.nombre ? ` ${u.nombre}` : ''},</p>
             <p>Recibimos una solicitud para restablecer tu contraseña.</p>
             <p><a href="${resetLink}" style="background:#1e40af;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Restablecer contraseña</a></p>
             <p style="color:#6b7280;font-size:12px">Este enlace vence en 24 horas. Si no solicitaste esto, ignorá este email.</p>`
        );
        logger.info(`📧 Reset solicitado por usuario: ${u.email}`);
    } catch (error) {
        logger.error('Error en forgot-password:', error.message);
        return res.status(500).send('Error interno. Intentá de nuevo más tarde.');
    }
    res.send(successPage);
});

// ─── GET /auth/reset-password  (página HTML pública) ──────────────────────────
router.get('/reset-password', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.send(renderResetPage('error', 'Token no proporcionado.'));

    const db = req.app.get('db');
    try {
        const result = await db.query(
            'SELECT id FROM users WHERE password_reset_token=$1 AND password_reset_expires > NOW()',
            [token]
        );
        if (result.rows.length === 0) return res.send(renderResetPage('error', 'El enlace es inválido o ya expiró.'));
        res.send(renderResetPage('form', token));
    } catch (error) {
        res.send(renderResetPage('error', 'Error del servidor.'));
    }
});

// ─── POST /auth/reset-password  (procesa el formulario) ───────────────────────
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) return res.send(renderResetPage('error', 'Datos incompletos.'));
    if (password.length < 8) return res.send(renderResetPage('error', 'La contraseña debe tener al menos 8 caracteres.'));

    const db = req.app.get('db');
    try {
        const result = await db.query(
            'SELECT id, email FROM users WHERE password_reset_token=$1 AND password_reset_expires > NOW()',
            [token]
        );
        if (result.rows.length === 0) return res.send(renderResetPage('error', 'El enlace es inválido o ya expiró.'));

        const u    = result.rows[0];
        const hash = await require('bcrypt').hash(password, 10);

        await db.query(
            'UPDATE users SET password_hash=$1, password_reset_token=NULL, password_reset_expires=NULL, updated_at=NOW() WHERE id=$2',
            [hash, u.id]
        );

        logger.info(`✅ Contraseña restablecida para ${u.email}`);
        res.send(renderResetPage('success', '¡Tu contraseña fue restablecida correctamente! Ya podés iniciar sesión en la aplicación.'));

    } catch (error) {
        logger.error('Error en reset de contraseña:', error.message);
        res.send(renderResetPage('error', 'Error del servidor.'));
    }
});

function renderResetPage(type, messageOrToken) {
    if (type === 'form') {
        const token = messageOrToken;
        return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Nueva contraseña — Procurador SCW</title>
        <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9}
        .card{background:#fff;border-radius:12px;padding:40px;max-width:420px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.1)}
        h2{color:#1e40af;margin-top:0} input{width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:15px;box-sizing:border-box;margin-bottom:12px}
        button{width:100%;background:#1e40af;color:#fff;border:none;padding:12px;border-radius:6px;font-size:16px;cursor:pointer}
        button:hover{background:#1d4ed8} label{font-size:13px;font-weight:600;display:block;margin-bottom:4px;color:#374151}</style>
        </head><body><div class="card">
        <h2>Procurador SCW</h2>
        <p style="color:#374151">Ingresá tu nueva contraseña:</p>
        <form method="POST" action="/auth/reset-password">
            <input type="hidden" name="token" value="${token}">
            <label>Nueva contraseña</label>
            <input type="password" name="password" id="pwd" minlength="8" required placeholder="Mínimo 8 caracteres">
            <label>Confirmar contraseña</label>
            <input type="password" id="confirm" placeholder="Repetí la contraseña">
            <button type="submit" onclick="if(document.getElementById('pwd').value!==document.getElementById('confirm').value){alert('Las contraseñas no coinciden');return false}">Guardar contraseña</button>
        </form>
        </div></body></html>`;
    }
    const isError = type === 'error';
    const icon    = isError ? '❌' : '✅';
    const color   = isError ? '#dc2626' : '#16a34a';
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Restablecer contraseña — Procurador SCW</title>
    <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9}
    .card{background:#fff;border-radius:12px;padding:40px;max-width:480px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}
    h2{color:${color}} p{color:#374151;line-height:1.6}</style></head>
    <body><div class="card"><div style="font-size:48px;margin-bottom:12px">${icon}</div>
    <h2>Procurador SCW</h2><p>${messageOrToken}</p></div></body></html>`;
}

module.exports = router;