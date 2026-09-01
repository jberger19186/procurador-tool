const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getCacheStats, clearCache } = require('../utils/scriptEncryption');
const { adminLimiter } = require('../middleware/rateLimiter');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendTicketReplyEmail, sendAdminCreatedUserEmail } = require('../utils/mailer');
const { validatePassword } = require('../utils/passwordPolicy');
const { updatePreapprovalAmount, cancelSubscription, reactivateSubscription, pausePreapproval, resumePreapproval } = require('../services/subscriptionService');

// Validación de CUIT/CUIL (mismo algoritmo que routes/auth.js)
function validarCuitAdmin(cuit) {
    const clean = String(cuit || '').replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(clean)) return false;
    const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * mult[i];
    const rem = sum % 11;
    const check = rem === 0 ? 0 : rem === 1 ? 9 : 11 - rem;
    return check === parseInt(clean[10]);
}

// F10 (2026-08-31): payments.status no tiene CHECK constraint en el schema (character
// varying(30) sin enum) — mismos 4 valores que ofrece el <select> del dashboard.
const PAYMENT_STATUSES = ['approved', 'pending', 'rejected', 'refunded'];

// ── Multer: almacenamiento de PDFs de facturas ────────────────────────────────
// C1 (revisión 2026-07-25): el directorio se movió FUERA de public/ — antes se servía
// con express.static sin autenticación (ver utils/invoiceStorage.js).
const { ensureInvoicesDir, resolveInvoiceFile } = require('../utils/invoiceStorage');
const invoicesDir = ensureInvoicesDir();

const invoiceStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, invoicesDir),
    filename: (req, file, cb) => {
        // F10 (2026-08-31): req.params.invoiceId no se sanitizaba antes de interpolarlo
        // en el nombre de archivo. Express decodifica el segmento de ruta DESPUÉS de
        // matchear el patrón (un `%2F` no tiene `/` literal, así que matchea igual), y
        // multer arma la ruta final con `path.join(destino, filename)` sin sanear `..`
        // (verificado en node_modules/multer/storage/disk.js) — un invoiceId armado con
        // `..%2F..%2F` podía escribir el PDF fuera de storage/invoices/. Los ids reales
        // son siempre numéricos (PK de invoices); cualquier otra cosa cae a 'new'.
        const rawId = req.params.invoiceId;
        const invoiceId = (rawId && /^\d+$/.test(rawId)) ? rawId : 'new';
        const ts = Date.now();
        cb(null, `factura_${invoiceId}_${ts}.pdf`);
    }
});
const uploadInvoice = multer({
    storage: invoiceStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máx
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') return cb(new Error('Solo se aceptan archivos PDF'));
        cb(null, true);
    }
});

// RI-1 (revisión 2026-07-19): sin este wrapper, un rechazo de multer (no-PDF o >5MB)
// caía al error handler global de server.js como 500 genérico en vez de un 400 claro.
function uploadPdfOr400(req, res, next) {
    uploadInvoice.single('pdf')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'El archivo supera el máximo de 5 MB.'
                : (err.message || 'Archivo inválido.');
            return res.status(400).json({ error: msg });
        }
        // F10 (2026-08-31): fileFilter (arriba) solo valida el header Content-Type del
        // multipart, que el cliente controla libremente — no prueba nada del contenido
        // real del archivo. Chequeo de magic bytes sobre el archivo YA ESCRITO en disco;
        // si no empieza con la firma real de un PDF, se borra y se rechaza con 400 en vez
        // de quedar persistido con extensión .pdf sin serlo.
        if (req.file) {
            try {
                const fd = fs.openSync(req.file.path, 'r');
                const head = Buffer.alloc(5);
                fs.readSync(fd, head, 0, 5, 0);
                fs.closeSync(fd);
                if (head.toString('latin1') !== '%PDF-') {
                    fs.unlinkSync(req.file.path);
                    return res.status(400).json({ error: 'El archivo no es un PDF válido.' });
                }
            } catch (checkErr) {
                try { fs.unlinkSync(req.file.path); } catch (_) {}
                return res.status(400).json({ error: 'No se pudo validar el archivo.' });
            }
        }
        next();
    });
}

// Aplicar rate limiter a todas las rutas de admin
router.use(adminLimiter);

// D3 (revisión 2026-07-25): authenticateAdmin se extrajo a middleware/authenticateAdmin.js
// (era una función local acá, y otros routers la duplicaban sin el chequeo de blacklist —
// ver el comentario en el middleware compartido).

// ==================== CACHÉ ====================

// Obtener estadísticas del caché
router.get('/cache/stats', authenticateAdmin, (req, res) => {
    try {
        const stats = getCacheStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
});

// Limpiar caché completo
router.post('/cache/clear', authenticateAdmin, (req, res) => {
    try {
        clearCache();
        console.log(`🗑️ Caché limpiado por admin: ${req.user.id}`);
        res.json({
            success: true,
            message: 'Caché limpiado correctamente'
        });
    } catch (error) {
        console.error('Error limpiando caché:', error);
        res.status(500).json({ error: 'Error limpiando caché' });
    }
});

// Precalentar caché (warmup)
router.post('/cache/warmup', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const { getDecryptedScript } = require('../utils/scriptEncryption');

        // Obtener todos los scripts activos
        const scriptsResult = await db.query(`
            SELECT script_name FROM encrypted_scripts WHERE active = true
        `);

        const warmedUp = [];
        for (const row of scriptsResult.rows) {
            try {
                await getDecryptedScript(db, row.script_name);
                warmedUp.push(row.script_name);
            } catch (error) {
                console.error(`Error precalentando ${row.script_name}:`, error.message);
            }
        }

        console.log(`🔥 Caché precalentado: ${warmedUp.length} scripts por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Caché precalentado correctamente',
            scriptsLoaded: warmedUp.length,
            scripts: warmedUp
        });
    } catch (error) {
        console.error('Error precalentando caché:', error);
        res.status(500).json({ error: 'Error precalentando caché' });
    }
});

// ==================== SCRIPTS ====================

// Reencriptar scripts (útil cuando cambias la clave)
router.post('/scripts/reencrypt', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const { processScripts } = require('../utils/scriptEncryption');
        clearCache(); // Limpiar caché antes de reencriptar
        await processScripts(db);

        console.log(`🔐 Scripts reencriptados por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Scripts reencriptados correctamente'
        });
    } catch (error) {
        console.error('Error reencriptando scripts:', error);
        res.status(500).json({ error: 'Error reencriptando scripts' });
    }
});

// Listar todos los scripts
router.get('/scripts', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const result = await db.query(`
            SELECT script_name, version, hash, active, created_at, updated_at
            FROM encrypted_scripts
            ORDER BY script_name
        `);

        res.json({
            success: true,
            scripts: result.rows
        });
    } catch (error) {
        console.error('Error listando scripts:', error);
        res.status(500).json({ error: 'Error listando scripts' });
    }
});

// Activar/desactivar script
router.put('/scripts/:scriptName/toggle', authenticateAdmin, async (req, res) => {
    const { scriptName } = req.params;
    const { active } = req.body;
    const db = req.app.get('db');

    try {
        await db.query(
            'UPDATE encrypted_scripts SET active = $1 WHERE script_name = $2',
            [active, scriptName]
        );

        console.log(`🔄 Script ${scriptName} ${active ? 'activado' : 'desactivado'} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: `Script ${scriptName} ${active ? 'activado' : 'desactivado'}`
        });
    } catch (error) {
        console.error('Error actualizando script:', error);
        res.status(500).json({ error: 'Error actualizando script' });
    }
});

// ==================== USUARIOS ====================

// Alta de usuario por el administrador (suple el registro público). Crea la cuenta con la
// contraseña que fija el admin, le asigna un plan, y envía un email con las credenciales +
// recomendación de cambiar la contraseña + enlace de verificación de email. El usuario queda
// en pending_email hasta que verifica; al verificar → pending_activation (trial), salvo que el
// plan sea de $0 (cortesía) → queda activo con ese plan y su vigencia (ver /auth/verify-email).
router.post('/users', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const {
        nombre, apellido, email, password, cuit,
        domicilio, telefono, planId, plan, durationDays
    } = req.body;

    // Validaciones
    const required = { nombre, apellido, email, password, cuit };
    for (const [k, v] of Object.entries(required)) {
        if (!v || String(v).trim() === '') return res.status(400).json({ error: `El campo '${k}' es requerido` });
    }
    const pwdCheck = validatePassword(password, email);
    if (!pwdCheck.valid) return res.status(400).json({ error: pwdCheck.error });
    if (!validarCuitAdmin(cuit)) return res.status(400).json({ error: 'CUIT/CUIL inválido. Verificá el formato y dígito verificador.' });

    try {
        // Resolver el plan (por id o por nombre). El admin puede asignar planes privados también.
        let planData;
        if (planId) {
            const r = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
            if (r.rows.length === 0) return res.status(400).json({ error: 'Plan no encontrado' });
            planData = r.rows[0];
        } else if (plan) {
            const r = await db.query('SELECT * FROM plans WHERE name = $1', [plan.toUpperCase()]);
            if (r.rows.length === 0) return res.status(400).json({ error: 'Plan no encontrado' });
            planData = r.rows[0];
        } else {
            return res.status(400).json({ error: 'Se requiere plan o planId' });
        }

        const cleanCuit = String(cuit).replace(/[-\s]/g, '');
        const cleanEmail = email.trim().toLowerCase();

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Unicidad de email y CUIT
            const dup = await client.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
            if (dup.rows.length > 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El email ya está registrado' }); }
            const cuitDup = await client.query('SELECT id FROM users WHERE cuit = $1', [cleanCuit]);
            if (cuitDup.rows.length > 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El CUIT ya está registrado en el sistema' }); }

            const hashed = await bcrypt.hash(password, 12);
            const token = crypto.randomBytes(32).toString('hex');
            const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const ins = await client.query(`
                INSERT INTO users (
                    nombre, apellido, email, telefono, password_hash, cuit, domicilio,
                    registration_status, toc_accepted_at, admin_created,
                    email_verified, email_verify_token, email_verify_expires
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_email',NOW(),true,false,$8,$9)
                RETURNING id
            `, [
                nombre.trim(), apellido.trim(), cleanEmail,
                (telefono || '').trim() || null, hashed, cleanCuit,
                domicilio ? JSON.stringify(domicilio) : null,
                token, tokenExpires
            ]);
            const newUserId = ins.rows[0].id;

            // Vigencia (plan_expiry_date): si es un plan de cortesía ($0) y el admin fijó días,
            // se guarda para que al verificar el email la cuenta arranque con esa fecha de corte.
            const priceKnown = planData.price_ars != null || planData.price_usd != null;
            const price = Number(planData.price_ars ?? planData.price_usd ?? 0);
            let planExpiry = planData.plan_expiry_date || null;
            if (priceKnown && price === 0 && durationDays) {
                planExpiry = new Date();
                planExpiry.setDate(planExpiry.getDate() + (parseInt(durationDays) || 30));
            }

            await client.query(`
                INSERT INTO subscriptions (
                    user_id, plan, plan_id, status, usage_limit, usage_count, expires_at, plan_expiry_date
                ) VALUES ($1, $2, $3, 'suspended', 20, 0, NOW() + INTERVAL '365 days', $4)
            `, [newUserId, planData.name, planData.id, planExpiry]);

            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'user_created_by_admin', $2)`,
                [newUserId, JSON.stringify({ plan: planData.name, admin_id: req.user.id })]
            );

            await client.query('COMMIT');

            // Email con credenciales + recomendación de cambio + enlace de verificación.
            sendAdminCreatedUserEmail(cleanEmail, nombre.trim(), password, token).catch(() => {});

            console.log(`👤 Usuario ${cleanEmail} creado por admin ${req.user.id} (plan ${planData.name})`);
            res.status(201).json({ success: true, userId: newUserId, message: 'Usuario creado. Se le envió un email con sus credenciales y el enlace de verificación.' });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'El email o CUIT ya está registrado' });
        console.error('Error creando usuario (admin):', error.message);
        res.status(500).json({ error: 'Error creando el usuario' });
    }
});

// Listar todos los usuarios
router.get('/users', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        const result = await db.query(`
            SELECT u.id, u.email, u.role, u.created_at, u.last_login, u.machine_id,
                   s.plan, s.status, s.expires_at, s.usage_count, s.usage_limit
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            ORDER BY u.created_at DESC
        `);

        res.json({
            success: true,
            count: result.rows.length,
            users: result.rows
        });
    } catch (error) {
        console.error('Error listando usuarios:', error);
        res.status(500).json({ error: 'Error listando usuarios' });
    }
});

// ─── Búsqueda rápida de usuarios (para autocomplete en facturas manuales) ────
router.get('/users/search', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { q = '', limit = 10 } = req.query;
    // q vacío → lista todos (para el selector de usuario); q de 1 char → vacío (evita ruido en autocomplete)
    if (q.length === 1) return res.json({ users: [] });
    try {
        const { rows } = await db.query(
            `SELECT id, email, nombre, apellido, cuit, domicilio
             FROM users
             WHERE ($1 = '' OR email ILIKE $2 OR nombre ILIKE $2 OR apellido ILIKE $2 OR cuit ILIKE $2)
             ORDER BY nombre, apellido
             LIMIT $3`,
            [q, `%${q}%`, Math.min(parseInt(limit, 10) || 10, 500)]
        );
        res.json({ users: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Usuarios pendientes de activación ───────────────────────────────────────
router.get('/users/pending', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.email, u.cuit,
                   u.registration_status, u.email_verified, u.toc_accepted_at,
                   u.created_at,
                   p.name AS plan_name, p.display_name AS plan_display
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE u.registration_status IN ('pending_email','pending_activation')
            ORDER BY u.created_at DESC
        `);
        res.json({ success: true, users: result.rows });
    } catch (error) {
        console.error('Error listando usuarios pendientes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Activar usuario ──────────────────────────────────────────────────────────
// Activación de una cuenta (lógica reutilizable). Corre DENTRO de una transacción
// (recibe el client ya en BEGIN). Devuelve el usuario para mandar el email afuera.
// La usan: el botón "Activar" (panel de pendientes) y el selector "Activo" de
// Datos de Registro → ambos hacen exactamente lo mismo.
async function performActivation(client, userId, expiresDays, adminId) {
    const userResult = await client.query(`
        SELECT u.id, u.email, u.nombre, u.registration_status, u.email_verified,
               s.id AS sub_id, s.plan_id, s.plan AS plan_name,
               p.proc_executions_limit
        FROM users u
        JOIN subscriptions s ON u.id = s.user_id
        JOIN plans p ON s.plan_id = p.id
        WHERE u.id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
        const e = new Error('No se puede activar: el usuario no tiene una suscripción con plan asignado.');
        e.statusCode = 400;
        throw e;
    }
    const u = userResult.rows[0];

    // F10 (2026-08-31): sin este guard, activar una cuenta que nunca verificó su email
    // producía el mismo "estado imposible" (registration_status='active' con
    // email_verified=false) que el proyecto ya corrigió el 2026-06-24 para el camino
    // inverso (bloquear 'pending_email' como destino manual del selector). El camino de
    // cortesía (más abajo en este archivo) ya excluye explícitamente a los no
    // verificados — acá faltaba el mismo chequeo.
    if (!u.email_verified) {
        const e = new Error('No se puede activar: el usuario todavía no verificó su email.');
        e.statusCode = 400;
        throw e;
    }

    // Modelo trial-hasta-pago: la activación SOLO APRUEBA la cuenta. El usuario sigue en
    // el TRIAL hasta configurar el pago (ahí el webhook aplica los límites del plan).
    // Por eso NO se resetea usage_count y se CONSERVA usage_limit (20 + cortesías).
    // Solo en modo legacy sin cobro se sube directo al límite del plan.
    const paymentEnabled = process.env.PAYMENT_MODULE_ENABLED === 'true';
    const planLimit = u.proc_executions_limit > 0 ? u.proc_executions_limit : 9999;
    const usageLimit = paymentEnabled ? null : planLimit;   // null = conservar usage_limit actual

    await client.query(`UPDATE users SET registration_status = 'active', updated_at = NOW() WHERE id = $1`, [userId]);
    await client.query(`
        UPDATE subscriptions
        SET status = 'active',
            usage_count = ${paymentEnabled ? 'usage_count' : '0'},
            usage_limit = COALESCE($1, usage_limit),
            expires_at = NOW() + ($2 || ' days')::INTERVAL,
            period_start = NOW(),
            updated_at = NOW()
        WHERE user_id = $3
    `, [usageLimit, expiresDays, userId]);

    await client.query(
        `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'activated', $2)`,
        [userId, JSON.stringify({ admin_id: adminId, plan: u.plan_name || '' })]
    );
    await client.query(
        `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'activate', $3)`,
        [adminId, userId, JSON.stringify({ plan: u.plan_name || '' })]
    );
    await client.query(
        `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_activated', $2)`,
        [userId, 'Tu cuenta fue aprobada. Seguís con tus usos de prueba; configurá tu método de pago para acceder a los límites de tu plan.']
    );

    return u;
}

router.post('/users/:userId/activate', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    // F10 (2026-08-31): `x || 30` deja pasar un negativo (es truthy) — expires_at
    // terminaba en el pasado, "activando" una cuenta que ya nace vencida.
    const rawExpiresDays = req.body && req.body.expires_days;
    const expires_days = (Number.isFinite(rawExpiresDays) && rawExpiresDays > 0) ? rawExpiresDays : 30;

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const u = await performActivation(client, userId, expires_days, req.user.id);
        await client.query('COMMIT');

        const mailer = require('../utils/mailer');
        mailer.sendActivationEmail(u.email, u.nombre).catch(() => {});
        // F10 (2026-08-31): si esta cuenta había sido suspendida con billing_paused
        // (/suspend, ahora también corregido en esta misma revisión), el preapproval
        // real en MP quedaba pausado — sin esto, "Activar" le devolvía acceso pleno al
        // usuario mientras MP seguía sin cobrarle. Inofensivo si nunca hubo preapproval
        // (trial): resuelve a `false` sin tocar nada.
        resumePreapproval(userId).catch(() => {});

        console.log(`✅ Usuario ${userId} (${u.email}) activado por admin ${req.user.id}`);
        res.json({ success: true, message: `Usuario ${u.email} activado correctamente` });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        console.error('Error activando usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Reenviar email de verificación (admin) ──────────────────────────────────
// F10 (2026-08-31, code-review): esta ruta estaba definida DOS VECES en el archivo —
// Express solo corre la primera, así que una versión más completa (UPDATE atómico +
// reset de registration_status a 'pending_email', agregada el 2026-06-24 justo para
// resolver un "estado imposible") quedó como código muerto desde el día en que se
// escribió. Fusionadas acá: el UPDATE atómico con guard `WHERE email_verified=false`
// (evita la carrera SELECT-luego-UPDATE de la versión vieja) + el reset de
// registration_status de la versión muerta + la auditoría en admin_events que esa
// versión muerta nunca tuvo.
router.post('/users/:userId/resend-verification', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const result = await db.query(`
            UPDATE users
            SET email_verify_token   = $1,
                email_verify_expires = $2,
                email_verified       = false,
                registration_status  = 'pending_email',
                updated_at           = NOW()
            WHERE id = $3 AND email_verified = false
            RETURNING email, nombre
        `, [token, expires, userId]);

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'El email ya fue verificado o el usuario no existe' });
        }
        const u = result.rows[0];

        const mailer = require('../utils/mailer');
        await mailer.sendEmailVerification(u.email, u.nombre || 'Usuario', token);
        await db.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'resend_verification', '{}')`,
            [req.user.id, userId]
        );
        console.log(`📧 Verificación reenviada a ${u.email} por admin ${req.user.id}`);
        res.json({ success: true, message: `Email de verificación reenviado a ${u.email}.` });
    } catch (error) {
        console.error('Error reenviando verificación:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Rechazar usuario (Opción B: bloquear / Opción C: mantener trial) ─────────
router.post('/users/:userId/reject', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { mode, reason } = req.body || {}; // mode: 'block' | 'keep_trial'
    const db = req.app.get('db');

    if (!['block', 'keep_trial'].includes(mode)) {
        return res.status(400).json({ error: "mode debe ser 'block' o 'keep_trial'" });
    }
    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'El motivo es obligatorio' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            `SELECT u.id, u.email, u.nombre, u.registration_status
             FROM users u WHERE u.id = $1`,
            [userId]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];

        const mailer = require('../utils/mailer');

        if (mode === 'block') {
            await client.query(
                `UPDATE users SET registration_status = 'rejected', updated_at = NOW() WHERE id = $1`,
                [userId]
            );
            await client.query(
                `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1`,
                [userId]
            );
            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'rejected_blocked', $2)`,
                [userId, JSON.stringify({ reason, admin_id: req.user.id })]
            );
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reject_block', $3)`,
                [req.user.id, userId, JSON.stringify({ reason })]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_rejected', $2)`,
                [userId, `Tu solicitud fue rechazada. Motivo: ${reason}`]
            );
            await client.query('COMMIT');
            mailer.sendRejectionEmail(u.email, u.nombre, reason, 'block').catch(() => {});
            // F10 (2026-08-31): esta ruta no tiene guard de estado previo — se puede
            // rechazar/bloquear a un usuario que YA está activo y pagando, no solo a un
            // trial pendiente. Sin esto, el preapproval real en MP seguía cobrando pese
            // al bloqueo local. Inofensivo si nunca hubo preapproval (el caso común, un
            // trial recién registrado): no encuentra nada y no toca MP.
            pausePreapproval(userId).catch(() => {});
        } else {
            // keep_trial: no cambia registration_status, solo notifica
            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'rejected_keep_trial', $2)`,
                [userId, JSON.stringify({ reason, admin_id: req.user.id })]
            );
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reject_keep_trial', $3)`,
                [req.user.id, userId, JSON.stringify({ reason })]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'trial_review_pending', $2)`,
                [userId, `Tu solicitud está en espera. Motivo: ${reason}. Podés seguir usando tus usos de prueba.`]
            );
            await client.query('COMMIT');
            mailer.sendRejectionEmail(u.email, u.nombre, reason, 'keep_trial').catch(() => {});
        }

        console.log(`🚫 Usuario ${userId} rechazado (${mode}) por admin ${req.user.id}`);
        res.json({ success: true, mode });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error rechazando usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Suspender usuario por admin ──────────────────────────────────────────────
router.post('/users/:userId/suspend', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { reason, billing_paused = true } = req.body || {};
    const db = req.app.get('db');

    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'El motivo de suspensión es obligatorio' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            `SELECT u.id, u.email, u.nombre, u.registration_status
             FROM users u WHERE u.id = $1`,
            [userId]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];
        if (u.registration_status !== 'active') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Solo se puede suspender una cuenta activa' });
        }

        await client.query(
            `UPDATE users SET registration_status = 'suspended_admin', updated_at = NOW() WHERE id = $1`,
            [userId]
        );
        await client.query(`
            UPDATE subscriptions SET
                status = 'suspended_admin',
                suspension_cause = 'admin',
                suspended_at = NOW(),
                suspended_by = $1,
                billing_paused = $2,
                suspension_reason = $3,
                -- A.3 (E3-2): se cancela el downgrade programado. Si la cuenta se reactiva más
                -- adelante, el cron 5g no debe aplicar una decisión previa a la suspensión y ya
                -- vencida; el admin la re-programa si la sigue queriendo.
                scheduled_plan = NULL,
                updated_at = NOW()
            WHERE user_id = $4
        `, [req.user.id, billing_paused, reason.trim(), userId]);

        await client.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'admin_suspended', $2)`,
            [userId, JSON.stringify({ reason, admin_id: req.user.id, billing_paused })]
        );
        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'suspend', $3)`,
            [req.user.id, userId, JSON.stringify({ reason, billing_paused })]
        );
        await client.query(
            `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_suspended', $2)`,
            [userId, `Tu cuenta fue suspendida. Motivo: ${reason}. Podés solicitar revisión en el portal.`]
        );

        await client.query('COMMIT');

        const mailer = require('../utils/mailer');
        mailer.sendAdminSuspendedEmail(u.email, u.nombre, reason).catch(() => {});
        // F10 (2026-08-31): billing_paused se guardaba como flag local (leído solo para
        // decidir next_billing_date al reactivar) pero nunca pausaba el preapproval REAL
        // en MercadoPago — confirmado que pausePreapproval nunca se llamaba desde acá.
        // Un usuario pago suspendido seguía siendo cobrado mes a mes sin acceso alguno.
        if (billing_paused) pausePreapproval(userId).catch(() => {});

        console.log(`⏸️ Usuario ${userId} suspendido por admin ${req.user.id}. billing_paused=${billing_paused}`);
        res.json({ success: true });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error suspendiendo usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Listar solicitudes de reactivación pendientes ────────────────────────────
router.get('/users/reactivation-requests', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            SELECT u.id, u.nombre, u.apellido, u.email,
                   s.suspension_reason, s.suspended_at, s.reactivation_request
            FROM users u
            JOIN subscriptions s ON u.id = s.user_id
            WHERE u.registration_status = 'suspended_admin'
              AND s.reactivation_request IS NOT NULL
              AND s.reactivation_request->>'status' = 'pending'
            ORDER BY (s.reactivation_request->>'sent_at') ASC
        `);
        res.json({ success: true, requests: result.rows });
    } catch (error) {
        console.error('Error listando solicitudes de reactivación:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Procesar solicitud de reactivación ──────────────────────────────────────
router.post('/users/:userId/reactivation-request/:action', authenticateAdmin, async (req, res) => {
    const { userId, action } = req.params;
    const { reason } = req.body || {}; // solo para 'reject'
    const db = req.app.get('db');

    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: "action debe ser 'approve' o 'reject'" });
    }
    if (action === 'reject' && (!reason || !reason.trim())) {
        return res.status(400).json({ error: 'El motivo es obligatorio para rechazar' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            `SELECT u.id, u.email, u.nombre, s.billing_paused, s.reactivation_request
             FROM users u JOIN subscriptions s ON u.id = s.user_id WHERE u.id = $1`,
            [userId]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = userResult.rows[0];
        const mailer = require('../utils/mailer');

        if (action === 'approve') {
            // Recalcular next_billing_date si billing estaba pausado
            const nextBilling = new Date();
            nextBilling.setDate(nextBilling.getDate() + 30);

            await client.query(
                `UPDATE users SET registration_status = 'active', updated_at = NOW() WHERE id = $1`,
                [userId]
            );
            await client.query(`
                UPDATE subscriptions SET
                    status = 'active',
                    suspension_cause = NULL,
                    suspended_at = NULL,
                    suspended_by = NULL,
                    billing_paused = false,
                    suspension_reason = NULL,
                    reactivation_request = jsonb_set(reactivation_request, '{status}', '"approved"'),
                    next_billing_date = CASE WHEN billing_paused = true THEN $1 ELSE next_billing_date END,
                    updated_at = NOW()
                WHERE user_id = $2
            `, [nextBilling, userId]);

            await client.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'admin_reactivated', $2)`,
                [userId, JSON.stringify({ admin_id: req.user.id })]
            );
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reactivate_approve', '{}')`,
                [req.user.id, userId]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'account_reactivated', $2)`,
                [userId, 'Tu acceso fue restaurado. Ya podés usar la aplicación nuevamente.']
            );
            await client.query('COMMIT');
            mailer.sendReactivationResultEmail(u.email, u.nombre, true).catch(() => {});
            // F10 (2026-08-31): reanuda el preapproval real en MP si había quedado
            // pausado — este flujo ya reseteaba billing_paused=false a nivel local, pero
            // nunca tocaba MercadoPago.
            resumePreapproval(userId).catch(() => {});

        } else {
            await client.query(`
                UPDATE subscriptions SET
                    reactivation_request = jsonb_set(reactivation_request, '{status}', '"rejected"'),
                    updated_at = NOW()
                WHERE user_id = $1
            `, [userId]);
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'reactivate_reject', $3)`,
                [req.user.id, userId, JSON.stringify({ reason })]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'reactivation_rejected', $2)`,
                [userId, `Tu solicitud fue revisada. La suspensión se mantiene. Motivo: ${reason}`]
            );
            await client.query('COMMIT');
            mailer.sendReactivationResultEmail(u.email, u.nombre, false, reason).catch(() => {});
        }

        console.log(`🔄 Solicitud de reactivación de usuario ${userId}: ${action} por admin ${req.user.id}`);
        res.json({ success: true, action });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error procesando solicitud de reactivación:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Configurar vencimiento de plan ──────────────────────────────────────────
router.put('/plans/:planId/expiry', authenticateAdmin, async (req, res) => {
    const { planId } = req.params;
    const { plan_expiry_date } = req.body; // ISO string o null
    const db = req.app.get('db');

    const expiryValue = plan_expiry_date ? new Date(plan_expiry_date) : null;
    if (plan_expiry_date && isNaN(expiryValue)) {
        return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE plans SET plan_expiry_date = $1 WHERE id = $2`,
            [expiryValue, planId]
        );
        // Propagar a todos los usuarios activos en este plan
        await client.query(`
            UPDATE subscriptions SET plan_expiry_date = $1, updated_at = NOW()
            WHERE plan_id = $2 AND status = 'active'
        `, [expiryValue, planId]);

        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, NULL, 'set_plan_expiry', $2)`,
            [req.user.id, JSON.stringify({ plan_id: planId, plan_expiry_date: expiryValue })]
        );

        await client.query('COMMIT');
        console.log(`📅 Vencimiento del plan ${planId} configurado a ${expiryValue} por admin ${req.user.id}`);
        res.json({ success: true, plan_expiry_date: expiryValue });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error configurando vencimiento de plan:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// Obtener detalle de un usuario
router.get('/users/:userId', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        const userResult = await db.query(`
            SELECT u.*, s.*,
                   p.display_name AS plan_display_name,
                   p.proc_executions_limit, p.proc_expedientes_limit,
                   p.batch_executions_limit, p.batch_expedientes_limit,
                   p.informe_limit, p.monitor_partes_limit, p.monitor_novedades_limit,
                   p.period_days,
                   u.id AS id
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE u.id = $1
        `, [userId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Obtener logs recientes del usuario
        const logsResult = await db.query(`
            SELECT * FROM usage_logs
            WHERE user_id = $1
            ORDER BY execution_date DESC
            LIMIT 20
        `, [userId]);

        // Historial de eventos de la cuenta (incluye cambios de plan: plan_upgraded,
        // plan_downgrade_scheduled, plan_downgrade_cancelled, activated, etc.)
        const eventsResult = await db.query(`
            SELECT event_type, payload, created_at
            FROM user_events
            WHERE user_id = $1
            ORDER BY id DESC
            LIMIT 30
        `, [userId]);

        // Usos extra de cortesía vigentes (ya incluidos en usage_limit del trial)
        const ceResult = await db.query(
            `SELECT COALESCE(SUM(extra_uses), 0) AS total FROM usage_extras
             WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
            [userId]
        );
        const userRow = userResult.rows[0];
        userRow.courtesy_extras = parseInt(ceResult.rows[0]?.total || '0', 10);

        res.json({
            success: true,
            user: userRow,
            recentLogs: logsResult.rows,
            events: eventsResult.rows
        });
    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({ error: 'Error obteniendo usuario' });
    }
});

// Actualizar datos de registro de un usuario
router.put('/users/:userId/registro', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { nombre, apellido, cuit, telefono, domicilio, registration_status } = req.body;
    const db = req.app.get('db');

    const validStatuses = ['pending_email', 'pending_activation', 'active', 'rejected', 'suspended', 'suspended_admin', 'suspended_plan_expired', 'cancelled'];
    if (registration_status && !validStatuses.includes(registration_status)) {
        return res.status(400).json({ error: 'Estado de registro inválido' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const cur = await client.query('SELECT registration_status FROM users WHERE id = $1', [userId]);
        if (cur.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const prevStatus = cur.rows[0].registration_status;

        // pending_email es un estado administrado por el sistema (registro / cambio de
        // email, junto con email_verified=false). Ponerlo a mano crea estados imposibles
        // (ej. email_verified=true + pending_email). Para forzar re-verificación está
        // "Editar email". Solo se permite si ya estaba en pending_email (no es transición).
        if (registration_status === 'pending_email' && prevStatus !== 'pending_email') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No se puede poner "Email sin verificar" manualmente. Usá "Editar email" para forzar la re-verificación.' });
        }

        // F10 (2026-08-31): estos 5 estados no tenían NINGÚN efecto secundario acá — a
        // diferencia de 'active'/'pending_activation' (manejados abajo), un flip crudo
        // no tocaba subscriptions.status, no pausaba el cobro en MercadoPago, no mandaba
        // email ni notificación, y no dejaba rastro en user_events/admin_events. El
        // propio frontend solo pedía confirmación para 'active'/'pending_activation' —
        // el riesgo ya estaba identificado en el cliente, sin cubrir en el servidor. Se
        // bloquean (mismo criterio que 'pending_email' arriba) en vez de replicar acá la
        // lógica de cada botón dedicado, para no arriesgar reproducirla mal.
        const EFFECTFUL_STATUSES = ['rejected', 'suspended', 'suspended_admin', 'suspended_plan_expired', 'cancelled'];
        if (EFFECTFUL_STATUSES.includes(registration_status) && prevStatus !== registration_status) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Ese estado tiene efectos que este formulario no aplica (cobro, email, auditoría). Usá el botón dedicado (Suspender / Rechazar / Cancelar) en vez del selector de estado.' });
        }

        // Datos de perfil (siempre). El registration_status se aplica acá salvo que sea
        // 'active' viniendo de otro estado: en ese caso lo maneja performActivation abajo
        // (activación real, no flip crudo).
        await client.query(`
            UPDATE users SET
                nombre             = COALESCE($1, nombre),
                apellido           = COALESCE($2, apellido),
                cuit               = COALESCE($3, cuit),
                telefono           = COALESCE($4, telefono),
                domicilio          = COALESCE($5, domicilio),
                registration_status = COALESCE($6, registration_status),
                updated_at         = NOW()
            WHERE id = $7
        `, [
            nombre   || null,
            apellido || null,
            cuit     || null,
            telefono || null,
            domicilio ? JSON.stringify(domicilio) : null,
            registration_status || null,
            userId
        ]);

        let activatedUser = null;
        if (registration_status === 'active' && prevStatus !== 'active') {
            // "Activo" desde el selector = activación REAL (igual que el botón Activar):
            // suscripción active, expiry, notificación, email, eventos.
            activatedUser = await performActivation(client, userId, 30, req.user.id);
        } else if (registration_status === 'pending_activation' && prevStatus !== 'pending_activation') {
            // "Trial" = reiniciar el cupo a un trial fresco: 20 usos, suscripción suspendida.
            await client.query(`
                UPDATE subscriptions
                SET status = 'suspended', usage_count = 0, usage_limit = 20,
                    proc_usage = 0, batch_usage = 0, informe_usage = 0, monitor_novedades_usage = 0,
                    -- A.3 (E3-2): volver a trial descarta cualquier downgrade programado
                    -- (el plan al que apuntaba ya no tiene sentido con el cupo reseteado).
                    scheduled_plan = NULL,
                    updated_at = NOW()
                WHERE user_id = $1
            `, [userId]);
            await client.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'trial_reset', $3)`,
                [req.user.id, userId, JSON.stringify({ usage_limit: 20 })]
            );
        }

        await client.query('COMMIT');

        if (activatedUser) {
            const mailer = require('../utils/mailer');
            mailer.sendActivationEmail(activatedUser.email, activatedUser.nombre).catch(() => {});
            // F10 (2026-08-31): mismo fix que /activate — reanuda el preapproval real si
            // había quedado pausado por una suspensión previa.
            resumePreapproval(userId).catch(() => {});
        }
        res.json({ success: true, activated: !!activatedUser });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        console.error('Error actualizando datos de registro:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── Cambiar email del usuario (solo admin) ────────────────────────────────────
// Flujo: cambia el email → SUSPENDE la cuenta (pending_email) → envía verificación al
// NUEVO correo + notifica al usuario. Al verificar (GET /auth/verify-email) se restaura
// el registration_status previo (guardado en email_change_prev_status) → "continúa como
// venía" sin re-activación del admin.
router.post('/users/:userId/change-email', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { email } = req.body;
    const db = req.app.get('db');
    const crypto = require('crypto');
    const mailer = require('../utils/mailer');
    const logger = require('../utils/logger');

    const newEmail = (email || '').trim().toLowerCase();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ error: 'Email inválido' });
    }

    try {
        const { rows } = await db.query(
            'SELECT id, email, nombre, registration_status FROM users WHERE id = $1', [userId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const user = rows[0];

        if ((user.email || '').toLowerCase() === newEmail) {
            return res.status(400).json({ error: 'El email nuevo es igual al actual' });
        }
        const taken = await db.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2', [newEmail, userId]);
        if (taken.rows.length > 0) {
            return res.status(400).json({ error: 'Ese email ya está en uso por otra cuenta' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // COALESCE en email_change_prev_status: si ya había un cambio pendiente, no pisamos
        // el estado previo guardado (sigue siendo el "real" anterior al primer cambio).
        await db.query(`
            UPDATE users
            SET email                    = $1,
                email_verified           = false,
                email_verify_token       = $2,
                email_verify_expires     = $3,
                email_change_prev_status = COALESCE(email_change_prev_status, registration_status),
                registration_status      = 'pending_email',
                updated_at               = NOW()
            WHERE id = $4
        `, [newEmail, token, tokenExpires, userId]);

        // Verificación al NUEVO correo
        mailer.sendEmailVerification(newEmail, user.nombre || 'Usuario', token).catch(err =>
            logger.error('[Admin] Error enviando verificación de cambio de email', { err: err.message }));

        // Notificación in-app + evento en el historial
        await db.query(
            `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'email_changed_admin', $2)`,
            [userId, `El administrador actualizó tu email a ${newEmail}. Revisá ese correo y hacé clic en el enlace para verificarlo y reactivar tu cuenta.`]
        ).catch(() => {});
        await db.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'email_changed_by_admin', $2)`,
            [userId, JSON.stringify({ old_email: user.email, new_email: newEmail, by: req.user.id })]
        ).catch(() => {});

        logger.info(`✉️ Email cambiado por admin: ${user.email} → ${newEmail} (user ${userId})`);
        res.json({ success: true, email: newEmail, prevStatus: user.registration_status });
    } catch (error) {
        console.error('Error cambiando email:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── Marcar email como verificado manualmente ─────────────────────────────────
router.post('/users/:userId/verify-email', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            UPDATE users
            SET email_verified       = true,
                registration_status  = CASE
                    WHEN registration_status = 'pending_email' THEN 'pending_activation'
                    ELSE registration_status
                END,
                email_verify_token   = NULL,
                email_verify_expires = NULL,
                updated_at           = NOW()
            WHERE id = $1
            RETURNING email, nombre, registration_status
        `, [userId]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const u = result.rows[0];
        require('../utils/logger').info(`✅ Email verificado manualmente por admin: ${u.email}`);
        res.json({ success: true, registration_status: u.registration_status });
    } catch (error) {
        console.error('Error verificando email:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Actualizar rol de usuario
router.put('/users/:userId/role', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { role } = req.body;
    const db = req.app.get('db');

    if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rol inválido' });
    }

    try {
        await db.query(
            'UPDATE users SET role = $1 WHERE id = $2',
            [role, userId]
        );

        console.log(`👤 Usuario ${userId} actualizado a rol ${role} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: `Usuario ${userId} actualizado a rol ${role}`
        });
    } catch (error) {
        console.error('Error actualizando rol:', error);
        res.status(500).json({ error: 'Error actualizando rol' });
    }
});

// Desvincular hardware de un usuario
router.post('/users/:userId/unbind-hardware', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            'UPDATE users SET machine_id = NULL WHERE id = $1',
            [userId]
        );

        console.log(`🔓 Hardware desvinculado para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Hardware desvinculado correctamente'
        });
    } catch (error) {
        console.error('Error desvinculando hardware:', error);
        res.status(500).json({ error: 'Error desvinculando hardware' });
    }
});

// Asignar/actualizar CUIT de un usuario
router.put('/users/:userId/cuit', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { cuit } = req.body;
    const db = req.app.get('db');

    if (!cuit || !/^\d{11}$/.test(cuit)) {
        return res.status(400).json({ error: 'CUIT inválido. Debe tener 11 dígitos numéricos.' });
    }

    try {
        await db.query('UPDATE users SET cuit = $1 WHERE id = $2', [cuit, userId]);
        console.log(`🆔 CUIT ${cuit} asignado al usuario ${userId} por admin: ${req.user.id}`);
        res.json({ success: true, message: `CUIT ${cuit} asignado correctamente` });
    } catch (error) {
        console.error('Error asignando CUIT:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// F6 cadena AG (2026-09-01), decisión 3.1 del informe de cierre de la Etapa 3 (S3):
// el cron de liberación de CUIT solo anula ESE campo a los 90 días — nombre, apellido,
// domicilio, teléfono y email nunca se borraban de ninguna forma automatizada, pese a
// que la Política de Privacidad promete "supresión". Este endpoint es el mecanismo
// inmediato que faltaba (decisión del operador: opción A, endpoint admin de borrado
// completo), separado a propósito del ciclo de vida de la suscripción — cancelar y
// borrar PII son 2 decisiones distintas, este endpoint solo hace la segunda.
router.post('/users/:userId/delete-pii', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { reason, confirmActiveAccount } = req.body || {};
    const db = req.app.get('db');

    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'El motivo es obligatorio' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT u.id, u.email, u.nombre, u.role, u.registration_status, s.payment_provider
               FROM users u
               LEFT JOIN subscriptions s ON s.user_id = u.id
              WHERE u.id = $1`,
            [userId]
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const u = rows[0];

        // Nunca borrar la identidad de una cuenta admin por este camino — no hay
        // override posible, a diferencia del chequeo de abajo.
        if (u.role === 'admin') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No se puede borrar la PII de una cuenta admin' });
        }

        // El email queda reemplazado por un placeholder → la cuenta deja de poder
        // loguearse con su email real. Sobre una cuenta activa y pagando, eso corta
        // el servicio en el acto sin pasar por el flujo de cancelación (que además
        // pausa MercadoPago) — requiere confirmación explícita para no hacerlo sin
        // querer sobre un cliente que sigue operando.
        if (u.registration_status === 'active' && u.payment_provider && !confirmActiveAccount) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'La cuenta está activa y con pago configurado. Si igual querés borrar su PII, ' +
                       'reenviá con confirmActiveAccount:true (considerá cancelar la suscripción primero).'
            });
        }

        const emailAnonimizado = `borrado-${userId}@procuradortool.invalid`;

        await client.query(
            `UPDATE users
                SET nombre = NULL, apellido = NULL, domicilio = NULL, telefono = NULL,
                    cuit = NULL, cuit_deleted_at = COALESCE(cuit_deleted_at, NOW()),
                    email = $2, updated_at = NOW()
              WHERE id = $1`,
            [userId, emailAnonimizado]
        );
        await client.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'pii_deleted_by_admin', $2)`,
            [userId, JSON.stringify({ reason, admin_id: req.user.id })]
        );
        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'delete_pii', $3)`,
            [req.user.id, userId, JSON.stringify({ reason })]
        );

        await client.query('COMMIT');
        console.log(`🗑️ PII del usuario ${userId} borrada por admin ${req.user.id}. Motivo: ${reason}`);
        res.json({ success: true, email: emailAnonimizado });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error borrando PII:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ==================== SUSCRIPCIONES ====================

// Crear/actualizar suscripción
router.post('/subscriptions', authenticateAdmin, async (req, res) => {
    const { userId, plan, planId, durationDays } = req.body;
    const db = req.app.get('db');

    try {
        let planData;

        if (planId) {
            // Usar plan de BD
            const planResult = await db.query(`SELECT * FROM plans WHERE id = $1 AND active = true`, [planId]);
            if (planResult.rows.length === 0) return res.status(400).json({ error: 'Plan no encontrado o inactivo' });
            planData = planResult.rows[0];
        } else if (plan) {
            // Backward compat: buscar por nombre
            const planResult = await db.query(`SELECT * FROM plans WHERE name = $1 AND active = true`, [plan.toUpperCase()]);
            if (planResult.rows.length === 0) {
                // Fallback a valores hardcodeados si no existe en plans
                const hardcoded = { 'BASIC': 100, 'PRO': 1000, 'ENTERPRISE': 999999 };
                if (!hardcoded[plan]) return res.status(400).json({ error: 'Plan inválido' });
                planData = { name: plan, id: null, proc_executions_limit: hardcoded[plan], informe_limit: -1, monitor_partes_limit: -1, monitor_novedades_limit: -1, period_days: 30 };
            } else {
                planData = planResult.rows[0];
            }
        } else {
            return res.status(400).json({ error: 'Se requiere plan o planId' });
        }

        // Estado previo: para el historial y para decidir trial vs pago.
        const { rows: [prev] } = await db.query(
            'SELECT plan AS current_plan, payment_provider FROM subscriptions WHERE user_id = $1', [userId]
        );
        // TRIAL (sin método de pago): el cambio de plan NO debe romper el trial.
        // Se cambia SOLO el plan asociado; se conservan el cupo (usage_limit=20),
        // los usos consumidos (usage_count) y el estado trial. El salto a 999999 +
        // enforcement por submódulo recién aplica cuando hay pago real.
        const isTrial = prev && !prev.payment_provider;
        const planPrice = (p) => Number(p?.price_ars ?? p?.price_usd ?? 0);

        // CORTESÍA: asignar un plan de $0 (gratuito) con vigencia. Aplica de inmediato, fija la
        // vigencia (plan_expiry_date = hoy + días del campo al lado del selector) y, si el usuario
        // venía pagando, PAUSA el cobro en MercadoPago para no seguir cobrando. Al vencer la fecha,
        // el cron de vigencia (5 11) pasa la cuenta a suspended_plan_expired y el portal ofrece
        // reactivar eligiendo un plan público + método de pago.
        // Solo un precio EXPLÍCITO de 0 es cortesía. Un plan sin precio (null, ej. BASIC/PRO/
        // ENTERPRISE "próximamente") NO se trata como cortesía → sigue la lógica normal.
        const priceKnown = planData.price_ars != null || planData.price_usd != null;
        const isCourtesy = priceKnown && planPrice(planData) === 0 && planData.id;
        if (isCourtesy) {
            // F10 (2026-08-31): `|| 30` deja pasar un negativo (expiry en el pasado, la
            // cuenta de cortesía "nace" ya vencida) y de paso no permite un 0 explícito.
            const parsedDias = parseInt(durationDays);
            const dias = (Number.isFinite(parsedDias) && parsedDias > 0) ? parsedDias : 30;
            const expiry = new Date();
            expiry.setDate(expiry.getDate() + dias);

            await db.query(`
                INSERT INTO subscriptions (user_id, plan, plan_id, status, expires_at, plan_expiry_date, usage_limit, period_start)
                VALUES ($1, $2, $3, 'active', $4, $4, 999999, NOW())
                ON CONFLICT (user_id) DO UPDATE
                SET plan = $2, plan_id = $3, status = 'active', expires_at = $4, plan_expiry_date = $4,
                    usage_limit = 999999, period_start = NOW(),
                    proc_usage = 0, batch_usage = 0, informe_usage = 0, monitor_novedades_usage = 0,
                    proc_bonus = 0, batch_bonus = 0, informe_bonus = 0, monitor_novedades_bonus = 0, monitor_partes_bonus = 0,
                    scheduled_plan = NULL, cancel_at = NULL, updated_at = NOW()
            `, [userId, planData.name, planData.id, expiry]);

            // Activar la cuenta (salvo que aún no verificó el email → sigue pending_email).
            await db.query(
                `UPDATE users SET registration_status = 'active', updated_at = NOW() WHERE id = $1 AND registration_status <> 'pending_email'`,
                [userId]
            );

            // Si venía pagando por MP, pausar el preapproval para cortar los cobros sucesivos.
            if (prev?.payment_provider) {
                pausePreapproval(userId).catch(() => {});
            }

            const fechaStr = expiry.toLocaleDateString('es-AR');
            await db.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'courtesy_plan_assigned_by_admin', $2)`,
                [userId, JSON.stringify({ plan: planData.name, expiry, dias, was_paying: !!prev?.payment_provider, admin_id: req.user.id })]
            );
            await db.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'courtesy_plan', $2)`,
                [userId, `Se te asignó el plan ${planData.display_name || planData.name} de cortesía con acceso hasta el ${fechaStr}.`]
            );
            console.log(`🎁 Plan de cortesía "${planData.name}" asignado a usuario ${userId} hasta ${fechaStr} por admin: ${req.user.id}`);
            return res.json({
                success: true, type: 'courtesy', expiry,
                message: `Plan de cortesía "${planData.name}" asignado con acceso hasta el ${fechaStr}.${prev?.payment_provider ? ' Se pausó el cobro en MercadoPago.' : ''}`
            });
        }

        // ¿Es un DOWNGRADE de una cuenta PAGA? (precio nuevo < precio actual, ambos conocidos)
        // Solo aplica si ya hay suscripción con plan actual y el plan nuevo proviene de la
        // tabla (tiene id/precio). Un downgrade se programa para el fin del ciclo (justo:
        // el usuario conserva los límites altos que pagó hasta entonces).
        let isDowngrade = false;
        if (!isTrial && prev?.current_plan && planData.id) {
            const { rows: [cur] } = await db.query(
                'SELECT price_ars, price_usd FROM plans WHERE name = $1', [prev.current_plan]
            );
            isDowngrade = planPrice(cur) > 0 && planPrice(planData) < planPrice(cur);
        }

        if (isDowngrade) {
            // Downgrade JUSTO: no se tocan límites ni contadores ahora. Se programa en
            // scheduled_plan; el cron diario (25 11 * * *) lo aplica en apply_at y ajusta
            // el monto en MercadoPago al plan rebajado.
            const { rows: [s] } = await db.query(
                'SELECT next_billing_date, expires_at FROM subscriptions WHERE user_id = $1', [userId]
            );
            let applyAt = s?.next_billing_date || s?.expires_at;
            if (!applyAt) { applyAt = new Date(); applyAt.setDate(applyAt.getDate() + (planData.period_days || 30)); }
            const scheduled = { plan: planData.name, plan_id: planData.id, apply_at: applyAt };

            await db.query(
                `UPDATE subscriptions SET scheduled_plan = $2, updated_at = NOW() WHERE user_id = $1`,
                [userId, JSON.stringify(scheduled)]
            );
            await db.query(
                `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_downgrade_scheduled_by_admin', $2)`,
                [userId, JSON.stringify({ from: prev.current_plan, to: planData.name, apply_at: applyAt, admin_id: req.user.id })]
            );
            const fechaStr = new Date(applyAt).toLocaleDateString('es-AR');
            await db.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'plan_downgrade_scheduled', $2)`,
                [userId, `Tu plan cambiará a ${planData.display_name || planData.name} el ${fechaStr}. Conservás tus límites actuales hasta esa fecha.`]
            );
            console.log(`📉 Downgrade a "${planData.name}" PROGRAMADO para ${fechaStr} (usuario ${userId}) por admin: ${req.user.id}`);
            return res.json({
                success: true, type: 'downgrade_scheduled', applyAt,
                message: `Downgrade a ${planData.name} programado para el ${fechaStr}. El usuario conserva sus límites actuales hasta entonces y el monto en MercadoPago se ajusta en esa fecha.`
            });
        }

        let expiresAt = null;
        if (isTrial) {
            await db.query(`
                UPDATE subscriptions
                SET plan = $2, plan_id = $3, scheduled_plan = NULL, updated_at = NOW()
                WHERE user_id = $1
            `, [userId, planData.name, planData.id]);
        } else {
            // Upgrade / mismo precio / activación de cuenta paga → INMEDIATO. Plan activo con
            // enforcement por submódulo; el tope global no debe cortar al mezclar módulos →
            // usage_limit=999999.
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + (durationDays || planData.period_days || 30));
            await db.query(`
                INSERT INTO subscriptions (user_id, plan, plan_id, status, expires_at, usage_limit, period_start)
                VALUES ($1, $2, $3, 'active', $4, 999999, NOW())
                ON CONFLICT (user_id) DO UPDATE
                SET plan = $2, plan_id = $3, status = 'active', expires_at = $4,
                    usage_limit = 999999, period_start = NOW(),
                    proc_usage = 0, batch_usage = 0, informe_usage = 0, monitor_novedades_usage = 0,
                    proc_bonus = 0, batch_bonus = 0, informe_bonus = 0, monitor_novedades_bonus = 0, monitor_partes_bonus = 0,
                    scheduled_plan = NULL,
                    updated_at = NOW()
            `, [userId, planData.name, planData.id, expiresAt]);

            // Ajustar el monto que cobra MercadoPago al plan nuevo (best-effort). MP no
            // prorratea: el período actual ya pagado queda como está; el nuevo monto rige
            // desde el próximo cobro. Solo si la cuenta paga por MP.
            if (prev?.payment_provider) {
                updatePreapprovalAmount(userId, planData.name).catch(() => {});
            }
        }

        // Registrar el cambio de plan en el historial de la cuenta (visible en la ficha)
        await db.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'plan_changed_by_admin', $2)`,
            [userId, JSON.stringify({ from: prev?.current_plan || null, to: planData.name, admin_id: req.user.id, trial: !!isTrial })]
        );

        console.log(`💳 Suscripción "${planData.name}" ${isTrial ? '(trial, plan cambiado sin romper cupo)' : 'creada/actualizada'} para usuario ${userId} por admin: ${req.user.id}`);
        res.json({ success: true, message: isTrial ? 'Plan del trial actualizado (se conservan los usos de prueba)' : 'Suscripción creada/actualizada correctamente', subscription: { userId, plan: planData.name, expiresAt } });
    } catch (error) {
        console.error('Error gestionando suscripción:', error);
        res.status(500).json({ error: 'Error gestionando suscripción' });
    }
});

// Suspender suscripción
router.post('/subscriptions/:userId/suspend', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            // A.3 (E3-2): la suspensión cancela el downgrade programado (ver nota en /users/:id/suspend).
            `UPDATE subscriptions SET status = 'suspended', scheduled_plan = NULL WHERE user_id = $1`,
            [userId]
        );

        console.log(`⏸️ Suscripción suspendida para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Suscripción suspendida'
        });
    } catch (error) {
        console.error('Error suspendiendo suscripción:', error);
        res.status(500).json({ error: 'Error suspendiendo suscripción' });
    }
});

// Reactivar suscripción
router.post('/subscriptions/:userId/reactivate', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            `UPDATE subscriptions SET status = 'active' WHERE user_id = $1`,
            [userId]
        );

        console.log(`▶️ Suscripción reactivada para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Suscripción reactivada'
        });
    } catch (error) {
        console.error('Error reactivando suscripción:', error);
        res.status(500).json({ error: 'Error reactivando suscripción' });
    }
});

// Cancelar la suscripción al FIN DEL CICLO (pausa el cobro en MP, acceso hasta cancel_at).
// Reutiliza el mismo mecanismo que la cancelación del portal del usuario:
// pausa el preapproval (reversible), setea cancel_at = next_billing_date, registra el
// evento en el historial y el cron de vencimiento cierra la cuenta en esa fecha.
router.post('/subscriptions/:userId/cancel', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const { rows: [sub] } = await db.query(
            'SELECT payment_provider, cancel_at FROM subscriptions WHERE user_id = $1', [userId]
        );
        if (!sub) return res.status(404).json({ error: 'El usuario no tiene suscripción' });
        if (sub.cancel_at) return res.status(400).json({ error: 'La suscripción ya tiene una cancelación programada' });

        const { cancelAt } = await cancelSubscription(userId);
        // Rastro adicional de que la acción la hizo el admin (cancelSubscription ya inserta
        // subscription_cancel_scheduled; este evento deja constancia del autor).
        await db.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'subscription_cancelled_by_admin', $2)`,
            [userId, JSON.stringify({ cancel_at: cancelAt, admin_id: req.user.id })]
        );
        console.log(`🚫 Cancelación al fin de ciclo programada para usuario ${userId} por admin: ${req.user.id} (cancel_at=${cancelAt})`);
        res.json({ success: true, cancel_at: cancelAt, message: 'La suscripción se cancelará al finalizar el período actual. Es reversible hasta esa fecha.' });
    } catch (error) {
        console.error('Error cancelando suscripción (admin):', error.message);
        res.status(500).json({ error: error.message || 'Error cancelando suscripción' });
    }
});

// Revertir una cancelación programada (deshacer si se hizo por error). Reanuda el
// preapproval en MP (paused → authorized) sin generar un cobro nuevo; el cobro sigue en
// la fecha original. Solo válido mientras cancel_at no venció.
router.post('/subscriptions/:userId/reactivate-cancel', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        await reactivateSubscription(userId);
        await db.query(
            `INSERT INTO user_events (user_id, event_type, payload) VALUES ($1, 'subscription_cancel_reverted_by_admin', $2)`,
            [userId, JSON.stringify({ admin_id: req.user.id })]
        );
        console.log(`↩️ Cancelación revertida para usuario ${userId} por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Cancelación revertida. La suscripción sigue activa y se renueva en la fecha original.' });
    } catch (error) {
        console.error('Error revirtiendo cancelación (admin):', error.message);
        res.status(400).json({ error: error.message || 'Error revirtiendo la cancelación' });
    }
});

// Resetear contador de uso
router.post('/subscriptions/:userId/reset-usage', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');

    try {
        await db.query(
            `UPDATE subscriptions SET usage_count = 0 WHERE user_id = $1`,
            [userId]
        );

        console.log(`🔄 Contador de uso reseteado para usuario ${userId} por admin: ${req.user.id}`);

        res.json({
            success: true,
            message: 'Contador de uso reseteado'
        });
    } catch (error) {
        console.error('Error reseteando contador:', error);
        res.status(500).json({ error: 'Error reseteando contador' });
    }
});

// ==================== LOGS Y AUDITORÍA ====================

// Ver logs de uso
router.get('/logs', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { limit = 100, userId, scriptName, success } = req.query;

    try {
        let query = `
            SELECT l.*, u.email
            FROM usage_logs l
            JOIN users u ON l.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (userId) {
            params.push(userId);
            query += ` AND l.user_id = $${params.length}`;
        }

        if (scriptName) {
            params.push(scriptName);
            query += ` AND l.script_name = $${params.length}`;
        }

        if (success !== undefined) {
            params.push(success === 'true');
            query += ` AND l.success = $${params.length}`;
        }

        query += ` ORDER BY l.execution_date DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const result = await db.query(query, params);

        res.json({
            success: true,
            count: result.rows.length,
            logs: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo logs:', error);
        res.status(500).json({ error: 'Error obteniendo logs' });
    }
});

// Estadísticas generales del sistema
router.get('/stats/overview', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');

    try {
        // Total usuarios
        const usersResult = await db.query('SELECT COUNT(*) as total FROM users');

        // Suscripciones activas
        const activeSubsResult = await db.query(
            `SELECT COUNT(*) as total FROM subscriptions WHERE status = 'active' AND expires_at > NOW()`
        );

        // Total ejecuciones hoy
        const execsTodayResult = await db.query(
            `SELECT COUNT(*) as total FROM usage_logs WHERE DATE(execution_date) = CURRENT_DATE`
        );

        // Ejecuciones exitosas vs fallidas hoy
        const successRateResult = await db.query(`
            SELECT 
                SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failed
            FROM usage_logs 
            WHERE DATE(execution_date) = CURRENT_DATE
        `);

        // Scripts más usados (últimos 7 días)
        const topScriptsResult = await db.query(`
            SELECT script_name, COUNT(*) as executions
            FROM usage_logs
            WHERE execution_date > NOW() - INTERVAL '7 days'
            GROUP BY script_name
            ORDER BY executions DESC
            LIMIT 5
        `);

        // Usuarios por plan
        const planStatsResult = await db.query(`
            SELECT s.plan, p.display_name, COUNT(*) as user_count
            FROM subscriptions s
            LEFT JOIN plans p ON s.plan_id = p.id
            WHERE s.status = 'active' AND s.expires_at > NOW()
            GROUP BY s.plan, p.display_name
            ORDER BY user_count DESC
        `);

        // Usuarios pendientes de activación (email verificado, esperando que el admin los active).
        // Antes contaba 'pending_email' (no verificados) y 'pending_payment' (estado inexistente),
        // por lo que un usuario que verificaba su email dejaba de contarse → la card mostraba 0.
        const pendingResult = await db.query(`
            SELECT COUNT(*) as total FROM users
            WHERE registration_status = 'pending_activation'
        `);

        res.json({
            success: true,
            stats: {
                totalUsers: parseInt(usersResult.rows[0].total),
                activeSubscriptions: parseInt(activeSubsResult.rows[0].total),
                executionsToday: parseInt(execsTodayResult.rows[0].total),
                successRate: {
                    successful: parseInt(successRateResult.rows[0].successful || 0),
                    failed: parseInt(successRateResult.rows[0].failed || 0)
                },
                topScripts: topScriptsResult.rows,
                planStats: planStatsResult.rows,
                pendingUsers: parseInt(pendingResult.rows[0].total),
                cache: getCacheStats()
            }
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
});

// ==================== TICKETS DE SOPORTE ====================

// Listar todos los tickets (con filtros)
router.get('/tickets', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { status, category, priority, userId, limit = 100 } = req.query;

    try {
        let query = `
            SELECT t.id, t.category, t.title, t.status, t.priority,
                   t.priority_source, t.priority_notes, t.priority_set_at, t.priority_set_by,
                   t.benefit_type, t.benefit_applied, t.benefit_value,
                   t.created_at, t.updated_at, t.resolved_at,
                   u.email AS user_email, u.id AS user_id
            FROM support_tickets t
            JOIN users u ON t.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            params.push(status);
            query += ` AND t.status = $${params.length}`;
        }
        if (category) {
            params.push(category);
            query += ` AND t.category = $${params.length}`;
        }
        if (priority) {
            params.push(priority);
            query += ` AND t.priority = $${params.length}`;
        }
        if (userId) {
            params.push(userId);
            query += ` AND t.user_id = $${params.length}`;
        }

        query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));

        const result = await db.query(query, params);

        res.json({
            success: true,
            count: result.rows.length,
            tickets: result.rows
        });
    } catch (error) {
        console.error('Error listando tickets:', error);
        res.status(500).json({ error: 'Error listando tickets' });
    }
});

// Detalle de un ticket
router.get('/tickets/:id', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const ticketResult = await db.query(`
            SELECT t.*, u.email AS user_email, u.id AS user_id,
                   u.registration_status,
                   s.payment_provider, s.usage_count, s.usage_limit
            FROM support_tickets t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN subscriptions s ON s.user_id = u.id
            WHERE t.id = $1
        `, [id]);

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        const commentsResult = await db.query(`
            SELECT tc.id, tc.author_role, tc.message, tc.visibility, tc.created_at, tc.edited_at,
                   u.email AS author_email
            FROM ticket_comments tc
            JOIN users u ON tc.author_id = u.id
            WHERE tc.ticket_id = $1
            ORDER BY tc.created_at ASC
        `, [id]);

        res.json({
            success: true,
            ticket: ticketResult.rows[0],
            comments: commentsResult.rows
        });
    } catch (error) {
        console.error('Error obteniendo ticket:', error);
        res.status(500).json({ error: 'Error obteniendo ticket' });
    }
});

// Cambiar estado del ticket
router.put('/tickets/:id/status', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const db = req.app.get('db');

    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }

    try {
        const resolvedAt = status === 'resolved' ? 'NOW()' : 'NULL';
        await db.query(`
            UPDATE support_tickets
            SET status = $1, resolved_at = ${resolvedAt}
            WHERE id = $2
        `, [status, id]);

        console.log(`🎫 Ticket #${id} → estado '${status}' por admin: ${req.user.id}`);
        res.json({ success: true, message: `Ticket actualizado a estado '${status}'` });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: 'Error actualizando estado' });
    }
});

// Cambiar prioridad del ticket — modelo con toggle ai_managed
// Body: { priority, ai_managed?: boolean }
//
// Lógica:
//   - ai_managed=true  + prioridad cambió      → source=NULL (próximo IA-run la procesa)
//   - ai_managed=true  + prioridad no cambió   → source NO se toca (NULL o 'ai')
//   - ai_managed=false                         → source='manual' (locked, IA nunca toca)
//
// Backward compat:
//   - Si ai_managed no se envía, usa lógica vieja:
//     source previo 'ai' → 'ai_overridden'; otro → 'manual'
router.put('/tickets/:id/priority', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { priority, ai_managed } = req.body;
    const db = req.app.get('db');

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
        return res.status(400).json({ error: 'Prioridad inválida' });
    }

    try {
        const cur = await db.query(
            'SELECT priority, priority_source FROM support_tickets WHERE id = $1',
            [id]
        );
        if (cur.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        const prevPriority = cur.rows[0].priority;
        const prevSource   = cur.rows[0].priority_source;
        const priorityChanged = priority !== prevPriority;

        let newSource;
        if (typeof ai_managed === 'boolean') {
            // Modo nuevo (toggle explícito)
            if (ai_managed) {
                // IA gestiona:
                //   - Si prevSource era 'manual' o 'ai_overridden' → reset a NULL (transición de locked a unlocked)
                //   - Si prioridad cambió → reset a NULL (próximo IA-run lo procesa con nuevo punto de partida)
                //   - Si ya era 'ai' o NULL y no cambió → preservar
                if (prevSource === 'manual' || prevSource === 'ai_overridden' || priorityChanged) {
                    newSource = null;
                } else {
                    newSource = prevSource; // 'ai' o NULL → preservar
                }
            } else {
                // Admin gestiona: fijo manual
                newSource = 'manual';
            }
        } else {
            // Modo legacy (sin ai_managed)
            newSource = prevSource === 'ai' ? 'ai_overridden' : 'manual';
        }

        // Si source no cambia Y prioridad no cambia → no hagas nada (idempotente)
        if (newSource === prevSource && !priorityChanged) {
            return res.json({
                success: true,
                message: 'Sin cambios',
                priority_source: prevSource,
                noop: true
            });
        }

        // Limpiar notes/set_by si pasamos de 'ai' a otro source (ya no aplica el razonamiento)
        const clearNotes = (prevSource === 'ai' && newSource !== 'ai');
        await db.query(`
            UPDATE support_tickets
            SET priority = $1,
                priority_source = $2,
                priority_set_at = NOW(),
                priority_set_by = $3
                ${clearNotes ? ', priority_notes = NULL' : ''}
            WHERE id = $4
        `, [priority, newSource, req.user.id, id]);

        console.log(`🎫 Ticket #${id} → prioridad '${priority}' (source=${newSource ?? 'NULL'}) por admin: ${req.user.id}`);
        res.json({
            success: true,
            message: 'Prioridad actualizada',
            priority,
            priority_source: newSource
        });
    } catch (error) {
        console.error('Error actualizando prioridad:', error);
        res.status(500).json({ error: 'Error actualizando prioridad' });
    }
});

// Resetear prioridad — vuelve a permitir que la IA la gestione
router.post('/tickets/:id/reset-priority', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');
    try {
        const result = await db.query(`
            UPDATE support_tickets
            SET priority_source = NULL, priority_notes = NULL, priority_set_at = NULL, priority_set_by = NULL
            WHERE id = $1 RETURNING id
        `, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket no encontrado' });
        console.log(`🔄 Ticket #${id} → prioridad reseteada por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Prioridad reseteada — próxima ejecución de IA la actualizará' });
    } catch (error) {
        console.error('Error reseteando prioridad:', error);
        res.status(500).json({ error: 'Error reseteando prioridad' });
    }
});

// Responder como admin (agregar comentario)
router.post('/tickets/:id/comment', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { message, visibility = 'external' } = req.body;
    const db = req.app.get('db');

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    if (!['external', 'internal'].includes(visibility)) {
        return res.status(400).json({ error: "visibility debe ser 'external' o 'internal'" });
    }

    try {
        // Traer ticket + datos del usuario para envío de email
        const ticketCheck = await db.query(`
            SELECT t.id, t.title, t.user_id, t.status AS ticket_status,
                   u.email, u.nombre, u.role
            FROM support_tickets t
            JOIN users u ON u.id = t.user_id
            WHERE t.id = $1
        `, [id]);
        if (ticketCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        const ticket = ticketCheck.rows[0];

        const result = await db.query(`
            INSERT INTO ticket_comments (ticket_id, author_id, author_role, message, visibility)
            VALUES ($1, $2, 'admin', $3, $4)
            RETURNING id, author_role, message, visibility, created_at
        `, [id, req.user.id, message.trim(), visibility]);

        // Cambia estado a in_progress si estaba abierto Y la respuesta es externa
        // (las notas internas no cambian el estado del ticket — son solo para admin)
        if (visibility === 'external' && ticket.ticket_status === 'open') {
            await db.query(`UPDATE support_tickets SET status = 'in_progress' WHERE id = $1`, [id]);
        }

        console.log(`💬 Admin ${req.user.id} respondió ticket #${id} [visibility=${visibility}]`);

        // Notificación por email al usuario SOLO si la respuesta es externa
        // Feature flag EMAIL_TICKET_REPLY_ENABLED en .env controla activación
        if (visibility === 'external') {
            try {
                sendTicketReplyEmail(
                    ticket.email,
                    ticket.nombre,
                    ticket.id,
                    ticket.title,
                    message.trim()
                ).catch(err => {
                    console.error(`⚠️ Error enviando email de respuesta a ticket #${id}:`, err.message);
                });
            } catch (mailErr) {
                console.error(`⚠️ Error preparando email de respuesta:`, mailErr.message);
                // No interrumpe la respuesta — el comentario ya se guardó OK
            }
        } else {
            console.log(`📝 Nota interna en ticket #${id} — no se envía email al usuario`);
        }

        res.status(201).json({ success: true, comment: result.rows[0] });
    } catch (error) {
        console.error('Error respondiendo ticket:', error);
        res.status(500).json({ error: 'Error respondiendo ticket' });
    }
});

// Editar el texto de una respuesta de admin ya enviada
// Solo permite editar comentarios cuyo author_role = 'admin' (no las del usuario).
// No re-envía email ni cambia el estado del ticket — solo corrige el texto.
router.put('/tickets/:ticketId/comment/:commentId', authenticateAdmin, async (req, res) => {
    const { ticketId, commentId } = req.params;
    const { message } = req.body;
    const db = req.app.get('db');

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }

    try {
        const check = await db.query(
            `SELECT id, author_role FROM ticket_comments WHERE id = $1 AND ticket_id = $2`,
            [commentId, ticketId]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Comentario no encontrado' });
        }
        if (check.rows[0].author_role !== 'admin') {
            return res.status(403).json({ error: 'Solo se pueden editar respuestas de administradores' });
        }

        const result = await db.query(`
            UPDATE ticket_comments
               SET message = $1, edited_at = NOW()
             WHERE id = $2
            RETURNING id, author_role, message, visibility, created_at, edited_at
        `, [message.trim(), commentId]);

        console.log(`✏️ Admin ${req.user.id} editó el comentario #${commentId} del ticket #${ticketId}`);
        res.json({ success: true, comment: result.rows[0] });
    } catch (error) {
        console.error('Error editando comentario:', error);
        res.status(500).json({ error: 'Error editando comentario' });
    }
});

// Aplicar beneficio comercial a un ticket
// Helper: aplica el efecto del beneficio y lo registra en commercial_benefits.
// ticketId puede ser null (beneficio aplicado desde la ficha del usuario, sin ticket).
// F10 (2026-08-31): esta función hace 2-3 escrituras dependientes (UPDATE del efecto +
// INSERT en commercial_benefits + INSERT en admin_events) sin ninguna transacción, a
// diferencia del resto de este archivo (líneas 247-972 ya usan BEGIN/COMMIT/ROLLBACK
// para este mismo patrón). Si el INSERT de historial fallaba DESPUÉS de que el efecto
// ya se aplicó, el 500 resultante invitaba al admin a reintentar — aplicando el
// beneficio una 2da vez sin dejar rastro del primer intento (commercial_benefits es
// aditivo, sin idempotency-key). Envuelto en una transacción propia: no soluciona el
// doble-submit por completo (dos requests genuinamente distintas siguen sumando dos
// veces, eso requeriría una clave de idempotencia — fuera de alcance de esta fase),
// pero elimina el estado a medias que lo agravaba.
async function applyBenefitToUser(db, { userId, benefitType, benefitValue, ticketId, adminId }) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        if (benefitType === 'discount') {
            // `|| 30` dejaba pasar un negativo (es truthy) — un "descuento" podía en
            // realidad ACORTAR la suscripción del cliente en vez de extenderla.
            const parsedDays = parseInt(benefitValue);
            const days = (Number.isFinite(parsedDays) && parsedDays > 0) ? parsedDays : 30;
            await client.query(
                `UPDATE subscriptions SET expires_at = COALESCE(expires_at, NOW()) + ($2 || ' days')::interval WHERE user_id = $1`,
                [userId, days]
            );
            console.log(`🎁 Descuento: suscripción de usuario ${userId} extendida ${days} días por admin ${adminId}`);
        } else if (benefitType === 'plan_upgrade') {
            // El plan debe ser uno VIGENTE (active=true) de la tabla plans.
            const newPlan = String(benefitValue || '').toUpperCase();
            const planRes = await client.query(`SELECT id, name FROM plans WHERE name = $1 AND active = true`, [newPlan]);
            if (planRes.rows.length === 0) {
                const err = new Error('Plan inválido o no vigente');
                err.statusCode = 400;
                throw err;
            }
            const pd = planRes.rows[0];
            // Plan activo → enforcement por submódulo (límites se leen del plan);
            // el tope global no debe cortar al mezclar módulos → usage_limit=999999.
            await client.query(
                `UPDATE subscriptions SET plan = $1, plan_id = $2, usage_limit = 999999, updated_at = NOW() WHERE user_id = $3`,
                [pd.name, pd.id, userId]
            );
            console.log(`⬆️ Plan upgrade: usuario ${userId} → ${pd.name} por admin ${adminId}`);
        } else if (benefitType === 'usage_reset') {
            // benefitValue indica QUÉ resetear: global (trial) o un subsistema.
            const colMap = {
                global: 'usage_count',
                proc: 'proc_usage', batch: 'batch_usage', informe: 'informe_usage',
                monitor_novedades: 'monitor_novedades_usage'
            };
            // `|| 'usage_count'` caía en silencio al reset GLOBAL/trial ante cualquier
            // valor no reconocido (typo, valor inesperado de UI) — resetear el cupo del
            // trial cuando el admin quiso resetear otro subsistema es el peor caso
            // posible, no un default razonable.
            if (!Object.prototype.hasOwnProperty.call(colMap, benefitValue)) {
                const e = new Error(`Subsistema inválido para usage_reset: '${benefitValue}'. Válidos: ${Object.keys(colMap).join(', ')}`);
                e.statusCode = 400;
                throw e;
            }
            const col = colMap[benefitValue];
            await client.query(`UPDATE subscriptions SET ${col} = 0, updated_at = NOW() WHERE user_id = $1`, [userId]);
            console.log(`🔄 Usage reset (${col}): usuario ${userId} por admin ${adminId}`);
        }

        // Registrar el beneficio (historial). NO se auto-resuelve el ticket.
        await client.query(
            `INSERT INTO commercial_benefits (user_id, ticket_id, benefit_type, benefit_value, applied_by_admin_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, ticketId || null, benefitType, benefitValue != null ? String(benefitValue) : null, adminId]
        );
        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'benefit_applied', $3)`,
            [adminId, userId, JSON.stringify({ benefit_type: benefitType, benefit_value: benefitValue, ticket_id: ticketId || null })]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

const VALID_BENEFITS = ['discount', 'plan_upgrade', 'usage_reset'];

// Aplicar beneficio desde un TICKET (permite múltiples; ya no auto-resuelve)
router.post('/tickets/:id/apply-benefit', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { benefit_type, benefit_value } = req.body;
    const db = req.app.get('db');

    if (!VALID_BENEFITS.includes(benefit_type)) {
        return res.status(400).json({ error: 'Tipo de beneficio inválido' });
    }
    try {
        const ticketResult = await db.query(`SELECT id, user_id FROM support_tickets WHERE id = $1`, [id]);
        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        await applyBenefitToUser(db, {
            userId: ticketResult.rows[0].user_id,
            benefitType: benefit_type, benefitValue: benefit_value,
            ticketId: parseInt(id, 10), adminId: req.user.id
        });
        res.json({ success: true, message: `Beneficio '${benefit_type}' aplicado correctamente` });
    } catch (error) {
        console.error('Error aplicando beneficio:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error aplicando beneficio' });
    }
});

// Aplicar beneficio desde la FICHA del usuario (sin ticket)
router.post('/users/:userId/apply-benefit', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { benefit_type, benefit_value, ticket_id } = req.body;
    const db = req.app.get('db');

    if (!VALID_BENEFITS.includes(benefit_type)) {
        return res.status(400).json({ error: 'Tipo de beneficio inválido' });
    }
    try {
        const u = await db.query(`SELECT id FROM users WHERE id = $1`, [userId]);
        if (u.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        await applyBenefitToUser(db, {
            userId: parseInt(userId, 10),
            benefitType: benefit_type, benefitValue: benefit_value,
            ticketId: ticket_id ? parseInt(ticket_id, 10) || null : null, adminId: req.user.id
        });
        res.json({ success: true, message: `Beneficio '${benefit_type}' aplicado correctamente` });
    } catch (error) {
        console.error('Error aplicando beneficio:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error aplicando beneficio' });
    }
});

// Historial de beneficios comerciales de un usuario
router.get('/users/:userId/benefits', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const result = await db.query(
            `SELECT cb.id, cb.ticket_id, cb.benefit_type, cb.benefit_value, cb.created_at,
                    a.email AS applied_by_email
             FROM commercial_benefits cb
             LEFT JOIN users a ON a.id = cb.applied_by_admin_id
             WHERE cb.user_id = $1
             ORDER BY cb.created_at DESC`,
            [userId]
        );
        res.json({ success: true, benefits: result.rows });
    } catch (error) {
        console.error('Error listando beneficios:', error.message);
        res.status(500).json({ error: 'Error listando beneficios' });
    }
});

// ==================== PLANES ====================

// Listar todos los planes
router.get('/plans', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`SELECT * FROM plans ORDER BY id ASC`);
        res.json({ success: true, plans: result.rows });
    } catch (error) {
        console.error('Error obteniendo planes:', error);
        res.status(500).json({ error: 'Error obteniendo planes' });
    }
});

// Crear plan
router.post('/plans', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const {
        name, display_name, description,
        proc_executions_limit, proc_expedientes_limit,
        batch_executions_limit, batch_expedientes_limit,
        informe_limit,
        monitor_partes_limit, monitor_novedades_limit,
        period_days, extension_flows, visibility,
        price_usd, price_ars, plan_type, bitacora_enabled, markdown_enabled
    } = req.body;

    if (!name || !display_name) {
        return res.status(400).json({ error: 'name y display_name son obligatorios' });
    }
    const vis = visibility === 'private' ? 'private' : 'public';

    try {
        // El precio se persiste desde el alta (antes solo lo guardaba la edición → un plan de
        // cortesía creado con precio 0 quedaba con precio null, que NO cuenta como cortesía).
        const result = await db.query(`
            INSERT INTO plans (name, display_name, description,
                proc_executions_limit, proc_expedientes_limit,
                batch_executions_limit, batch_expedientes_limit,
                informe_limit, monitor_partes_limit, monitor_novedades_limit, period_days,
                extension_flows, visibility, price_usd, price_ars, plan_type, bitacora_enabled,
                markdown_enabled)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING *
        `, [
            name.toUpperCase(), display_name, description || null,
            proc_executions_limit ?? 50, proc_expedientes_limit ?? -1,
            batch_executions_limit ?? 20, batch_expedientes_limit ?? 10,
            informe_limit ?? 10,
            monitor_partes_limit ?? 3, monitor_novedades_limit ?? 10,
            period_days ?? 30,
            JSON.stringify(extension_flows ?? []), vis,
            price_usd ?? null, price_ars ?? null, plan_type ?? null,
            bitacora_enabled === true,
            markdown_enabled === true
        ]);
        console.log(`Plan "${name}" creado por admin: ${req.user.id}`);
        res.json({ success: true, plan: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'Ya existe un plan con ese nombre' });
        console.error('Error creando plan:', error);
        res.status(500).json({ error: 'Error creando plan' });
    }
});

// Actualizar plan
router.put('/plans/:planId', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { planId } = req.params;
    const {
        display_name, description,
        proc_executions_limit, proc_expedientes_limit,
        batch_executions_limit, batch_expedientes_limit,
        informe_limit, monitor_partes_limit, monitor_novedades_limit,
        period_days, active, extension_flows, visibility,
        // Campos de promo
        price_usd, price_ars, plan_type,
        promo_type, promo_end_date, promo_max_users, promo_alert_days,
        bitacora_enabled, markdown_enabled
    } = req.body;

    // F10 (2026-08-31): promo_type/promo_end_date eran los ÚNICOS 2 campos de este UPDATE
    // sin COALESCE — `promo_type !== undefined ? promo_type : undefined` es un no-op (si
    // el campo no viene, el parámetro queda `undefined`, y `pg` lo convierte a SQL NULL
    // antes de mandarlo — verificado contra node_modules/pg/lib/utils.js::prepareValue).
    // Cualquier PUT parcial que no incluya estos 2 campos los borraba en silencio. Pero
    // tampoco alcanza con envolverlos en COALESCE como el resto: "borrar la promo" es una
    // acción real del form (mandar null a propósito), y COALESCE no puede distinguir
    // "no vino" de "vino null" — ambos colapsan al mismo SQL NULL. Se resuelve con un
    // flag de presencia real de la clave en el body (no de su valor).
    const promoTypeProvided = Object.prototype.hasOwnProperty.call(req.body, 'promo_type');
    const promoEndDateProvided = Object.prototype.hasOwnProperty.call(req.body, 'promo_end_date');

    try {
        const result = await db.query(`
            UPDATE plans SET
                display_name = COALESCE($1, display_name),
                description = COALESCE($2, description),
                proc_executions_limit = COALESCE($3, proc_executions_limit),
                proc_expedientes_limit = COALESCE($4, proc_expedientes_limit),
                batch_executions_limit = COALESCE($5, batch_executions_limit),
                batch_expedientes_limit = COALESCE($6, batch_expedientes_limit),
                informe_limit = COALESCE($7, informe_limit),
                monitor_partes_limit = COALESCE($8, monitor_partes_limit),
                monitor_novedades_limit = COALESCE($9, monitor_novedades_limit),
                period_days = COALESCE($10, period_days),
                active = COALESCE($11, active),
                extension_flows = COALESCE($12, extension_flows),
                price_usd = COALESCE($13, price_usd),
                price_ars = COALESCE($14, price_ars),
                plan_type = COALESCE($15, plan_type),
                promo_type = CASE WHEN $24 THEN $16 ELSE promo_type END,
                promo_end_date = CASE WHEN $25 THEN $17 ELSE promo_end_date END,
                promo_max_users = COALESCE($18, promo_max_users),
                promo_alert_days = COALESCE($19, promo_alert_days),
                visibility = COALESCE($20, visibility),
                bitacora_enabled = COALESCE($21, bitacora_enabled),
                markdown_enabled = COALESCE($22, markdown_enabled),
                updated_at = NOW()
            WHERE id = $23
            RETURNING *
        `, [
            display_name, description,
            proc_executions_limit, proc_expedientes_limit,
            batch_executions_limit, batch_expedientes_limit,
            informe_limit, monitor_partes_limit, monitor_novedades_limit,
            period_days, active,
            extension_flows !== undefined ? JSON.stringify(extension_flows) : null,
            price_usd ?? null, price_ars ?? null, plan_type ?? null,
            promo_type ?? null,
            promo_end_date ?? null,
            promo_max_users ?? null,
            promo_alert_days ?? null,
            (visibility === 'public' || visibility === 'private') ? visibility : null,
            bitacora_enabled ?? null,
            markdown_enabled ?? null,
            planId,
            promoTypeProvided,
            promoEndDateProvided
        ]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Plan no encontrado' });
        console.log(`Plan ${planId} actualizado por admin: ${req.user.id}`);
        res.json({ success: true, plan: result.rows[0] });
    } catch (error) {
        console.error('Error actualizando plan:', error);
        res.status(500).json({ error: 'Error actualizando plan' });
    }
});

// Desactivar plan (soft delete)
router.delete('/plans/:planId', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { planId } = req.params;
    try {
        await db.query(`UPDATE plans SET active = false WHERE id = $1`, [planId]);
        console.log(`Plan ${planId} desactivado por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Plan desactivado' });
    } catch (error) {
        console.error('Error desactivando plan:', error);
        res.status(500).json({ error: 'Error desactivando plan' });
    }
});

// Activar plan
router.patch('/plans/:planId/activate', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { planId } = req.params;
    try {
        await db.query(`UPDATE plans SET active = true WHERE id = $1`, [planId]);
        console.log(`Plan ${planId} activado por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Plan activado' });
    } catch (error) {
        console.error('Error activando plan:', error);
        res.status(500).json({ error: 'Error activando plan' });
    }
});

// ==================== AJUSTES DE USO ====================

// Otorgar/deducir usos adicionales por subsistema
router.post('/subscriptions/:userId/adjust', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    const { subsystem, amount, reason, ticket_id } = req.body;

    const validSubsystems = ['proc', 'batch', 'informe', 'monitor_novedades', 'monitor_partes'];
    if (!validSubsystems.includes(subsystem)) {
        return res.status(400).json({ error: `Subsistema inválido. Válidos: ${validSubsystems.join(', ')}` });
    }
    if (!amount || isNaN(amount)) {
        return res.status(400).json({ error: 'amount debe ser un número entero' });
    }

    const bonusCol = {
        'proc':                  'proc_bonus',
        'batch':                 'batch_bonus',
        'informe':               'informe_bonus',
        'monitor_novedades':     'monitor_novedades_bonus',
        'monitor_partes':        'monitor_partes_bonus'
    }[subsystem];

    try {
        // Verificar usuario
        const userCheck = await db.query(`SELECT email FROM users WHERE id = $1`, [userId]);
        if (userCheck.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Aplicar bonificación en subscriptions
        const updateResult = await db.query(`
            UPDATE subscriptions
            SET ${bonusCol} = GREATEST(0, ${bonusCol} + $1)
            WHERE user_id = $2
            RETURNING ${bonusCol}
        `, [parseInt(amount), userId]);

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'El usuario no tiene suscripción' });
        }

        // Registrar ajuste en historial
        // F10 (2026-08-31): admin_email es varchar — llevaba req.user.id (un entero), no
        // el email; el JWT admin tampoco lo tenía hasta este mismo fix (ver auth.js).
        // Confirmado que dashboard.js:3168 renderiza esta columna en "Historial de Ajustes".
        await db.query(`
            INSERT INTO usage_adjustments (user_id, admin_email, subsystem, amount, reason, ticket_id)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [userId, req.user.email, subsystem, parseInt(amount), reason || null, ticket_id || null]);

        const action = parseInt(amount) > 0 ? `+${amount}` : `${amount}`;
        console.log(`Ajuste ${action} usos de "${subsystem}" para usuario ${userId} por admin: ${req.user.id}. Motivo: ${reason}`);

        res.json({
            success: true,
            message: `Ajuste aplicado: ${action} usos de ${subsystem}`,
            newBonus: updateResult.rows[0][bonusCol]
        });
    } catch (error) {
        console.error('Error aplicando ajuste:', error);
        res.status(500).json({ error: 'Error aplicando ajuste' });
    }
});

// Historial de ajustes de un usuario
router.get('/subscriptions/:userId/adjustments', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    try {
        const result = await db.query(`
            SELECT ua.*, t.title as ticket_title
            FROM usage_adjustments ua
            LEFT JOIN support_tickets t ON ua.ticket_id = t.id
            WHERE ua.user_id = $1
            ORDER BY ua.created_at DESC
            LIMIT 50
        `, [userId]);
        res.json({ success: true, adjustments: result.rows });
    } catch (error) {
        console.error('Error obteniendo ajustes:', error);
        res.status(500).json({ error: 'Error obteniendo ajustes' });
    }
});

// Reset de uso por subsistema (separado del reset general)
router.post('/subscriptions/:userId/reset-subsystem', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.params;
    const { subsystem } = req.body; // 'proc', 'informe', 'monitor_novedades', o 'all'

    try {
        let setClauses = [];
        if (subsystem === 'proc' || subsystem === 'all')               setClauses.push('proc_usage = 0');
        if (subsystem === 'batch' || subsystem === 'all')               setClauses.push('batch_usage = 0');
        if (subsystem === 'informe' || subsystem === 'all')             setClauses.push('informe_usage = 0');
        if (subsystem === 'monitor_novedades' || subsystem === 'all')   setClauses.push('monitor_novedades_usage = 0');
        if (subsystem === 'all') {
            setClauses.push('usage_count = 0');
            setClauses.push('proc_bonus = 0');
            setClauses.push('batch_bonus = 0');
            setClauses.push('informe_bonus = 0');
            setClauses.push('monitor_novedades_bonus = 0');
            setClauses.push('monitor_partes_bonus = 0');
        }

        if (setClauses.length === 0) return res.status(400).json({ error: 'Subsistema inválido' });

        await db.query(
            `UPDATE subscriptions SET ${setClauses.join(', ')} WHERE user_id = $1`,
            [userId]
        );

        console.log(`Reset de uso "${subsystem}" para usuario ${userId} por admin: ${req.user.id}`);
        res.json({ success: true, message: `Uso de "${subsystem}" reseteado` });
    } catch (error) {
        console.error('Error reseteando uso:', error);
        res.status(500).json({ error: 'Error reseteando uso' });
    }
});

// ─── MONITOREO (solo lectura para admin) ──────────────────────────────────────

// GET /admin/monitor/partes — partes activas (opcionalmente filtradas por ?userId=)
router.get('/monitor/partes', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { userId } = req.query;
    try {
        const params = [];
        const extraWhere = userId ? `AND mp.user_id = $1` : '';
        if (userId) params.push(userId);

        const result = await db.query(`
            SELECT mp.id, mp.nombre_parte, mp.jurisdiccion_sigla, mp.jurisdiccion_codigo,
                   mp.tiene_linea_base, mp.activo,
                   mp.fecha_creacion, mp.fecha_ultima_modificacion,
                   u.email AS usuario_email,
                   COUNT(DISTINCT me.id) FILTER (WHERE me.confirmado = true)  AS exp_confirmados,
                   COUNT(DISTINCT me.id) FILTER (WHERE me.confirmado = false AND me.es_linea_base = false) AS novedades_pendientes
            FROM monitor_partes mp
            JOIN users u ON u.id = mp.user_id
            LEFT JOIN monitor_expedientes me ON me.parte_id = mp.id
            WHERE mp.activo = true ${extraWhere}
            GROUP BY mp.id, u.email
            ORDER BY mp.fecha_creacion DESC
        `, params);
        res.json({ success: true, partes: result.rows, total: result.rows.length });
    } catch (error) {
        console.error('Error en GET /admin/monitor/partes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// DELETE /admin/monitor/partes/:parteId — eliminar parte y sus expedientes
router.delete('/monitor/partes/:parteId', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { parteId } = req.params;
    try {
        const check = await db.query(`SELECT id, nombre_parte, user_id FROM monitor_partes WHERE id = $1`, [parteId]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Parte no encontrada' });

        await db.query(`DELETE FROM monitor_expedientes WHERE parte_id = $1`, [parteId]);
        await db.query(`DELETE FROM monitor_partes WHERE id = $1`, [parteId]);

        console.log(`🗑️ Parte ${parteId} (${check.rows[0].nombre_parte}) eliminada por admin: ${req.user.id}`);
        res.json({ success: true, message: 'Parte eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando parte:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// GET /admin/monitor/stats — estadísticas globales de monitoreo
router.get('/monitor/stats', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [partesR, expR, novedadesR, consultasR] = await Promise.all([
            db.query(`SELECT COUNT(*) FROM monitor_partes WHERE activo = true`),
            db.query(`SELECT COUNT(*) FROM monitor_expedientes WHERE confirmado = true`),
            db.query(`SELECT COUNT(*) FROM monitor_expedientes WHERE confirmado = false AND es_linea_base = false`),
            db.query(`SELECT COUNT(*) FROM monitor_consultas_log WHERE date_trunc('month', fecha_ejecucion) = date_trunc('month', NOW())`),
        ]);
        res.json({
            success: true,
            partes_activas:       parseInt(partesR.rows[0].count),
            expedientes_confirmados: parseInt(expR.rows[0].count),
            novedades_pendientes: parseInt(novedadesR.rows[0].count),
            consultas_este_mes:   parseInt(consultasR.rows[0].count),
        });
    } catch (error) {
        console.error('Error en GET /admin/monitor/stats:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ============================================================================
// IA: priorización masiva de tickets (Fase 4 Ítem 2)
// ============================================================================

const https = require('https');

// Rate limiter en memoria: máximo 100 tickets procesados/hora por admin
const aiPriorityRateLimits = new Map(); // adminId → { count, resetAt }

function checkAiPriorityRateLimit(adminId, count) {
    const now = Date.now();
    const entry = aiPriorityRateLimits.get(adminId);
    if (!entry || now > entry.resetAt) {
        aiPriorityRateLimits.set(adminId, { count, resetAt: now + 3600000 });
        return { ok: true, remaining: 100 - count };
    }
    if (entry.count + count > 100) {
        return { ok: false, remaining: Math.max(0, 100 - entry.count), resetIn: Math.ceil((entry.resetAt - now) / 60000) };
    }
    entry.count += count;
    return { ok: true, remaining: 100 - entry.count };
}

const AI_PRIORITY_SYSTEM_PROMPT = `Sos un asistente que clasifica tickets de soporte de Procurador SCW por prioridad.

CONTEXTO DEL SISTEMA:
Procurador SCW es una herramienta de automatización judicial para abogados argentinos. Automatiza tres operaciones en el sistema PJN: (1) procuración de expedientes, (2) generación de informes, (3) monitor de partes. Usa Puppeteer con el Chrome del usuario. Las credenciales del PJN viven solo en Chrome (no en servidor). Sistema de planes: EXTENSION_PROMO (USD 1/mes), COMBO_PROMO (USD 9.99/mes), BASIC, PRO, ENTERPRISE.

CRITERIOS DE PRIORIDAD:

🟢 low (Baja):
- Consultas comerciales (cambio de plan, precios, planes futuros)
- Preguntas de "cómo usar X" sin bloqueo
- Sugerencias o feedback
- Dudas sobre facturación general (no urgente)

🟡 medium (Media):
- Funcionalidad parcial: algo funciona mal pero no bloquea el trabajo
- Errores intermitentes no críticos
- Consultas sobre límites del plan
- Pedidos de mejora con cierta urgencia

🔴 high (Alta):
- Login al PJN falla sistemáticamente
- Proceso no arranca o se cuelga
- Pérdida parcial de datos / resultados incorrectos
- Plan PRO o ENTERPRISE con problemas operativos
- Problema bloqueante reproducible

🚨 urgent (Urgente):
- Servicio completamente caído desde la perspectiva del usuario
- Pérdida total de datos o resultados corruptos
- Error de cobro / pago duplicado / cargo no autorizado
- Suspensión incorrecta de cuenta
- Cualquier issue de seguridad reportado por el usuario

FORMATO DE RESPUESTA (JSON estricto, sin texto adicional):
{
  "priority": "low" | "medium" | "high" | "urgent",
  "notes": "breve razonamiento en 1-2 frases (máx 200 chars)"
}

Sé conservador: ante duda entre dos niveles, elegí el menor. La sobre-priorización satura al equipo de soporte.`;

async function classifyTicketWithHaiku(ticket) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return reject(new Error('ANTHROPIC_API_KEY no configurada'));

        const userPrompt = `Clasificá este ticket:

CATEGORÍA: ${ticket.category}
PLAN DEL USUARIO: ${ticket.plan_name || 'desconocido'}
TÍTULO: ${ticket.title}
DESCRIPCIÓN:
${ticket.description}`;

        const body = JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 300,
            system: AI_PRIORITY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
        });

        const req = https.request({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 30000,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Anthropic API ${res.statusCode}: ${data.substring(0, 200)}`));
                }
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.content?.[0]?.text || '';
                    // El modelo a veces envuelve en ```json...```
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) return reject(new Error('Respuesta IA sin JSON válido'));
                    const result = JSON.parse(jsonMatch[0]);
                    if (!['low','medium','high','urgent'].includes(result.priority)) {
                        return reject(new Error(`Priority inválido: ${result.priority}`));
                    }
                    resolve({ priority: result.priority, notes: String(result.notes || '').substring(0, 500) });
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout llamando a Anthropic')); });
        req.write(body);
        req.end();
    });
}

// POST /admin/tickets/ai-prioritize
// Body: { ticket_ids?: [int] } — si vacío, procesa tickets sin priority_source o con source='ai'
router.post('/tickets/ai-prioritize', authenticateAdmin, async (req, res) => {
    if (process.env.ANTHROPIC_API_KEY === undefined) {
        return res.status(503).json({ error: 'Servicio de IA no disponible — ANTHROPIC_API_KEY no configurada' });
    }
    const db = req.app.get('db');
    const { ticket_ids } = req.body || {};

    try {
        // Seleccionar tickets a procesar (excluye siempre 'ai_overridden' y 'manual')
        let tickets;
        if (Array.isArray(ticket_ids) && ticket_ids.length > 0) {
            const ids = ticket_ids.map(Number).filter(n => Number.isInteger(n));
            if (ids.length === 0) return res.status(400).json({ error: 'ticket_ids inválido' });
            const result = await db.query(`
                SELECT t.id, t.category, t.title, t.description, t.priority_source,
                       p.name AS plan_name
                FROM support_tickets t
                JOIN users u ON u.id = t.user_id
                LEFT JOIN subscriptions s ON s.user_id = u.id
                LEFT JOIN plans p ON p.id = s.plan_id
                WHERE t.id = ANY($1::int[])
                  AND (t.priority_source IS NULL OR t.priority_source = 'ai')
            `, [ids]);
            tickets = result.rows;
        } else {
            // Default: todos los sin source o con 'ai' (status != 'closed' para no procesar cerrados)
            const result = await db.query(`
                SELECT t.id, t.category, t.title, t.description, t.priority_source,
                       p.name AS plan_name
                FROM support_tickets t
                JOIN users u ON u.id = t.user_id
                LEFT JOIN subscriptions s ON s.user_id = u.id
                LEFT JOIN plans p ON p.id = s.plan_id
                WHERE (t.priority_source IS NULL OR t.priority_source = 'ai')
                  AND t.status != 'closed'
                LIMIT 100
            `);
            tickets = result.rows;
        }

        if (tickets.length === 0) {
            return res.json({ success: true, message: 'No hay tickets para procesar', processed: 0, failed: 0 });
        }

        // Rate limit check
        const rateCheck = checkAiPriorityRateLimit(req.user.id, tickets.length);
        if (!rateCheck.ok) {
            return res.status(429).json({
                error: `Rate limit alcanzado (100 tickets/hora). Restantes: ${rateCheck.remaining}. Reintentar en ~${rateCheck.resetIn} min.`,
                remaining: rateCheck.remaining,
            });
        }

        // Procesar en paralelo (max 5 concurrent para no saturar Anthropic ni la DB)
        const results = { processed: 0, failed: 0, errors: [] };
        const CONCURRENCY = 5;
        for (let i = 0; i < tickets.length; i += CONCURRENCY) {
            const batch = tickets.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (ticket) => {
                try {
                    const cls = await classifyTicketWithHaiku(ticket);
                    await db.query(`
                        UPDATE support_tickets
                        SET priority = $1,
                            priority_source = 'ai',
                            priority_notes = $2,
                            priority_set_at = NOW(),
                            priority_set_by = NULL
                        WHERE id = $3
                    `, [cls.priority, cls.notes, ticket.id]);
                    results.processed++;
                } catch (err) {
                    results.failed++;
                    results.errors.push({ ticket_id: ticket.id, error: err.message });
                    console.error(`❌ AI priority falló ticket #${ticket.id}:`, err.message);
                }
            }));
        }

        console.log(`🤖 AI prioritize: ${results.processed} OK, ${results.failed} fallaron (admin ${req.user.id})`);
        res.json({
            success: true,
            processed: results.processed,
            failed: results.failed,
            errors: results.errors.slice(0, 10), // máximo 10 errores en la respuesta
        });
    } catch (error) {
        console.error('Error en ai-prioritize:', error);
        res.status(500).json({ error: 'Error procesando tickets', detail: error.message });
    }
});

// ============================================================================
// IA: sugerir respuesta para un ticket (Fase 4 Ítem 3)
// ============================================================================

// Rate limit: 30 sugerencias/hora por admin
const aiSuggestRateLimits = new Map();
function checkAiSuggestRateLimit(adminId) {
    const now = Date.now();
    const entry = aiSuggestRateLimits.get(adminId);
    if (!entry || now > entry.resetAt) {
        aiSuggestRateLimits.set(adminId, { count: 1, resetAt: now + 3600000 });
        return { ok: true, remaining: 29 };
    }
    if (entry.count >= 30) {
        return { ok: false, remaining: 0, resetIn: Math.ceil((entry.resetAt - now) / 60000) };
    }
    entry.count++;
    return { ok: true, remaining: 30 - entry.count };
}

const AI_REPLY_SYSTEM_PROMPT = `Sos el asistente del equipo de soporte de Procurador SCW.
Tu rol es PROYECTAR (sugerir) una respuesta que el admin revisará, editará y enviará al usuario.

CONTEXTO DEL SISTEMA:
Procurador SCW es una herramienta de automatización judicial para abogados argentinos. Automatiza tres operaciones en el PJN: (1) procuración de expedientes, (2) generación de informes, (3) monitor de partes. Usa Puppeteer con el Chrome del usuario; las credenciales del PJN viven solo en Chrome. Sistema de planes: EXTENSION_PROMO (USD 1/mes), COMBO_PROMO (USD 9.99/mes), BASIC, PRO, ENTERPRISE.

REGLAS DE LA RESPUESTA:
1. Tono cercano pero profesional. Español rioplatense ("vos", "tenés", "podés", "configurá").
2. Concisa: 2-4 párrafos máximo, sin saludos largos.
3. Si la solución es clara → dala paso a paso, numerada.
4. Si necesitás info adicional del usuario → pedila específica (qué dato, dónde lo encuentra).
5. Si no podés resolverlo → reconocelo y derivá a soporte técnico humano sin disculpas excesivas.
6. NUNCA inventes funcionalidades. Si no estás seguro → sugerí escalada a un ticket técnico.
7. NUNCA exageres ofreciendo reembolsos o cambios de plan sin razón concreta.
8. SI hay notas internas en la conversación → tomalas en cuenta como contexto privado del equipo (no las menciones al usuario).

FORMATO:
Devolvé SOLO el texto de la respuesta (sin saludo "Hola [nombre]" si ya hay historial — el admin lo agrega). Sin marcadores markdown que no se renderizan en email plano.`;

router.post('/tickets/:id/ai-suggest-reply', authenticateAdmin, async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ error: 'Servicio de IA no disponible — ANTHROPIC_API_KEY no configurada' });
    }
    const { id } = req.params;
    const db = req.app.get('db');

    const rate = checkAiSuggestRateLimit(req.user.id);
    if (!rate.ok) {
        return res.status(429).json({ error: `Rate limit alcanzado (30/hora). Reintentar en ~${rate.resetIn} min` });
    }

    try {
        // Contexto completo del ticket
        const ticketResult = await db.query(`
            SELECT t.id, t.category, t.title, t.description, t.priority,
                   u.email, u.nombre,
                   p.name AS plan_name, p.display_name AS plan_display
            FROM support_tickets t
            JOIN users u ON u.id = t.user_id
            LEFT JOIN subscriptions s ON s.user_id = u.id
            LEFT JOIN plans p ON p.id = s.plan_id
            WHERE t.id = $1
        `, [id]);
        if (ticketResult.rows.length === 0) return res.status(404).json({ error: 'Ticket no encontrado' });
        const t = ticketResult.rows[0];

        // Historial COMPLETO (internas + externas) — la IA usa el todo como contexto
        const commentsResult = await db.query(`
            SELECT author_role, message, visibility, created_at
            FROM ticket_comments
            WHERE ticket_id = $1
            ORDER BY created_at ASC
        `, [id]);

        // Armar el prompt user con contexto
        const conversationText = commentsResult.rows.map(c => {
            const role = c.author_role === 'admin' ? 'SOPORTE' : 'USUARIO';
            const visMark = c.visibility === 'internal' ? ' [NOTA INTERNA — no fue al usuario]' : '';
            return `[${role}${visMark}]: ${c.message}`;
        }).join('\n\n');

        const userPrompt = `TICKET #${t.id} (categoría: ${t.category}, prioridad: ${t.priority})
USUARIO: ${t.nombre || t.email} · Plan: ${t.plan_display || t.plan_name || 'desconocido'}

TÍTULO: ${t.title}

DESCRIPCIÓN INICIAL:
${t.description}

${conversationText ? `HISTORIAL DE CONVERSACIÓN:\n${conversationText}\n` : ''}
Generá una respuesta concisa que el admin enviará al usuario.`;

        // Llamada a Anthropic
        const body = JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 600,
            system: AI_REPLY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
        });

        const suggestion = await new Promise((resolve, reject) => {
            const reqAI = https.request({
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Length': Buffer.byteLength(body),
                },
                timeout: 30000,
            }, (rAI) => {
                let data = '';
                rAI.on('data', chunk => data += chunk);
                rAI.on('end', () => {
                    if (rAI.statusCode !== 200) return reject(new Error(`Anthropic ${rAI.statusCode}: ${data.substring(0, 200)}`));
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.content?.[0]?.text?.trim() || '');
                    } catch (e) { reject(e); }
                });
            });
            reqAI.on('error', reject);
            reqAI.on('timeout', () => { reqAI.destroy(); reject(new Error('Timeout')); });
            reqAI.write(body);
            reqAI.end();
        });

        if (!suggestion) {
            return res.status(502).json({ error: 'IA devolvió respuesta vacía' });
        }

        // Telemetría: registrar la sugerencia (action='suggested', se actualiza después si se envía/descarta)
        const logResult = await db.query(`
            INSERT INTO ai_assistance_logs (ticket_id, admin_id, suggested_text, action)
            VALUES ($1, $2, $3, 'suggested')
            RETURNING id
        `, [id, req.user.id, suggestion]);

        console.log(`🤖 AI sugirió respuesta para ticket #${id} (log_id=${logResult.rows[0].id}, ${suggestion.length} chars)`);

        res.json({
            success: true,
            suggestion,
            log_id: logResult.rows[0].id,
        });
    } catch (error) {
        console.error('Error en ai-suggest-reply:', error);
        res.status(500).json({ error: 'Error generando sugerencia', detail: error.message });
    }
});

// PATCH /admin/ai-suggest-logs/:id — actualiza el log cuando admin envía/descarta
// Body: { action: 'sent_as_is'|'sent_edited'|'discarded', final_text?: string }
router.patch('/ai-suggest-logs/:id', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { action, final_text } = req.body;
    const db = req.app.get('db');

    if (!['sent_as_is', 'sent_edited', 'discarded'].includes(action)) {
        return res.status(400).json({ error: 'action inválido' });
    }

    try {
        // Calcular edit_distance simple (cantidad de chars distintos, no Levenshtein real)
        let editDistance = null;
        if (final_text !== undefined) {
            const cur = await db.query(`SELECT suggested_text FROM ai_assistance_logs WHERE id = $1`, [id]);
            if (cur.rows[0]) {
                const orig = cur.rows[0].suggested_text || '';
                // Distancia aproximada: diferencia de length + chars distintos en posiciones comunes
                editDistance = Math.abs(orig.length - (final_text || '').length);
                const minLen = Math.min(orig.length, (final_text || '').length);
                for (let i = 0; i < minLen; i++) {
                    if (orig[i] !== (final_text || '')[i]) editDistance++;
                }
            }
        }

        await db.query(`
            UPDATE ai_assistance_logs
            SET action = $1, final_text = $2, edit_distance = $3, resolved_at = NOW()
            WHERE id = $4
        `, [action, final_text || null, editDistance, id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error actualizando ai_log:', error);
        res.status(500).json({ error: 'Error actualizando log' });
    }
});

// ==================== SMOKE TESTS ====================

const _fs   = require('fs');
const _path = require('path');
const SMOKE_FILE = _path.join(__dirname, '..', 'data', 'smoke-test-results.json');

function _loadSmoke() {
    try { if (_fs.existsSync(SMOKE_FILE)) return JSON.parse(_fs.readFileSync(SMOKE_FILE, 'utf8')); } catch (_) {}
    // F8 (2026-08-31): `canary` agregado al default — canary-test.js (crontab,
    // sin token de admin) escribe esa clave directo por fs desde el 2026-08-27
    // (`guardarResultadoCanary()`). Sin ella acá, si este fallback se dispara
    // (archivo ausente o corrupto) justo cuando un admin corre `run-api`/
    // `report-pjn`/`report-extension`, el `_saveSmoke()` subsiguiente escribe
    // el archivo SIN `canary` — no perdía el dato en el caso normal (el objeto
    // cargado del disco ya lo trae), pero sí en este caso borde.
    return { api: null, pjn: null, extension: null, canary: null };
}

function _saveSmoke(data) {
    const dir = _path.dirname(SMOKE_FILE);
    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
    _fs.writeFileSync(SMOKE_FILE, JSON.stringify(data, null, 2));
}

// GET /admin/smoke-tests/latest
router.get('/smoke-tests/latest', authenticateAdmin, (req, res) => {
    res.json({ success: true, results: _loadSmoke() });
});

// POST /admin/smoke-tests/run-api
router.post('/smoke-tests/run-api', authenticateAdmin, async (req, res) => {
    const axios = require('axios');
    const https = require('https');
    const jwt   = require('jsonwebtoken');
    const { checkIntegridadReferencial } = require('../utils/dbIntegrityChecks');

    const t0Total = Date.now();
    const checks  = [];
    const logs    = [];
    const db      = req.app.get('db');

    const BASE    = process.env.API_INTERNAL_URL || 'https://localhost:3443';
    const agent   = new https.Agent({ rejectUnauthorized: false });
    const ax      = axios.create({ baseURL: BASE, httpsAgent: agent, timeout: 8000, validateStatus: () => true });

    function ts() { return new Date().toLocaleTimeString('es-AR'); }

    async function runCheck(method, path, body, expectedStatus, label) {
        const t = Date.now();
        try {
            const cfg = { method, url: path };
            if (body !== null) cfg.data = body;
            const r = await ax(cfg);
            const ok = r.status === expectedStatus;
            const ms = Date.now() - t;
            checks.push({ label, method, path, expectedStatus, actualStatus: r.status, ok, duration: ms });
            logs.push(`[${ts()}] ${ok ? '✅' : '❌'}  ${method.padEnd(4)} ${path.padEnd(36)} ${r.status}  (${ms}ms)`);
        } catch (err) {
            const ms = Date.now() - t;
            checks.push({ label, method, path, expectedStatus, actualStatus: null, ok: false, duration: ms, error: err.message });
            logs.push(`[${ts()}] ❌  ${method.padEnd(4)} ${path.padEnd(36)} ERROR: ${err.message}`);
        }
    }

    // Checks de contenido (no solo status code) — Fase 2 de la mejora del smoke.
    // Mismo array `checks`/`logs`, formato uniforme: `label` + `ok` + `detalle` en el log.
    function pushContentCheck(label, ok, detalle) {
        checks.push({ label, ok, detalle });
        logs.push(`[${ts()}] ${ok ? '✅' : '❌'}  ${label.padEnd(42)} ${detalle}`);
    }

    logs.push(`[${ts()}] ▶ Iniciando smoke tests API...`);

    await runCheck('GET',  '/health',                   null,                                200, '/health');
    await runCheck('POST', '/auth/login',               {},                                  400, 'POST /auth/login sin body');
    await runCheck('POST', '/auth/login',               { email: 'x@x.com', password: 'wrong', machineId: 'smoke-test' }, 401, 'POST /auth/login creds inválidas');
    await runCheck('GET',  '/auth/register-status',     null,                                200, 'GET /auth/register-status');
    await runCheck('GET',  '/client/scripts/available', null,                                401, 'GET /client/scripts/available sin token');
    await runCheck('POST', '/license/execution/start',  {},                                  401, 'POST /license/execution/start sin token');
    await runCheck('POST', '/auth/portal-login',        {},                                  400, 'POST /auth/portal-login sin body');

    // DB check
    const tDB = Date.now();
    try {
        await db.query('SELECT 1');
        const ms = Date.now() - tDB;
        checks.push({ label: 'PostgreSQL', ok: true, duration: ms });
        logs.push(`[${ts()}] ✅  PostgreSQL                               conectado  (${ms}ms)`);
    } catch (err) {
        const ms = Date.now() - tDB;
        checks.push({ label: 'PostgreSQL', ok: false, duration: ms, error: err.message });
        logs.push(`[${ts()}] ❌  PostgreSQL                               ERROR: ${err.message}`);
    }

    // ── Fase 2 — checks de CONTENIDO, no solo status code ───────────────────
    // Válidos en cualquier entorno (staging o prod) donde corra este endpoint — el CI
    // los corre contra staging en cada push y debe poder fallar el build con ellos.

    // 1. Camino feliz autenticado: firmar un token real para la cuenta de verificación
    // (mismo CUIT que usa la Etapa 1.5, resuelto server-side — nunca hardcodear el id)
    // y confirmar que /client/account responde con la FORMA esperada, no solo 200.
    try {
        const { rows } = await db.query(
            'SELECT id, email, cuit FROM users WHERE cuit = $1',
            [VERIFICATION_TEST_CUIT]
        );
        if (rows.length === 0) {
            // La cuenta de verificación solo existe en producción — en staging (donde
            // corre el CI en cada push) es un estado esperado, no un fallo: no puede
            // romper el build por algo que nunca va a existir ahí.
            pushContentCheck('Camino feliz: GET /client/account', true, `cuenta de verificación (CUIT ${VERIFICATION_TEST_CUIT}) no existe en este entorno — esperado fuera de producción`);
        } else {
            const testUser = rows[0];
            const token = jwt.sign({ id: testUser.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '2m' });
            const r = await ax({ method: 'GET', url: '/client/account', headers: { Authorization: `Bearer ${token}` } });
            const acc = (r.data && r.data.account) || {};
            const formaOk = r.status === 200
                && r.data.success === true
                && acc.email === testUser.email
                && acc.cuit === testUser.cuit
                && acc.plan && typeof acc.plan === 'object'
                && acc.usage && typeof acc.usage === 'object';
            pushContentCheck(
                'Camino feliz: GET /client/account',
                formaOk,
                formaOk ? `200, email/cuit coinciden, forma correcta` : `status=${r.status}, body no tiene la forma esperada`
            );
        }
    } catch (err) {
        pushContentCheck('Camino feliz: GET /client/account', false, `error: ${err.message}`);
    }

    // 2. Contenido de /health — un 200 con el cuerpo roto (ej. database.status='error'
    // pero el status HTTP quedó mal seteado) pasaría el check de status code igual.
    try {
        const r = await ax({ method: 'GET', url: '/health' });
        const body = r.data || {};
        const ok = body.status === 'ok' && body.database?.status === 'ok';
        pushContentCheck('/health — contenido', ok, ok ? `status=ok, db=ok` : `status=${body.status}, db=${body.database?.status}`);
    } catch (err) {
        pushContentCheck('/health — contenido', false, `error: ${err.message}`);
    }

    // 3. Headers de seguridad (B-5): CSP tiene que seguir activa.
    try {
        const r = await ax({ method: 'GET', url: '/health' });
        const csp = r.headers['content-security-policy'];
        const ok = !!csp && csp.includes("default-src 'self'");
        pushContentCheck('Headers de seguridad (CSP)', ok, ok ? 'Content-Security-Policy presente' : `CSP ausente o incompleta: "${csp || ''}"`);
    } catch (err) {
        pushContentCheck('Headers de seguridad (CSP)', false, `error: ${err.message}`);
    }

    // 4. Rate limiter (RI-3): el limiter corre ANTES del auth en /license, así que un
    // request sin token igual debe traer los headers RateLimit-* (standardHeaders:true).
    try {
        const r = await ax({ method: 'GET', url: '/license/execution/start' });
        const hasHeader = !!r.headers['ratelimit-limit'];
        pushContentCheck('Rate limiter activo (/license)', hasHeader, hasHeader ? `RateLimit-Limit: ${r.headers['ratelimit-limit']}` : 'sin header RateLimit-Limit');
    } catch (err) {
        pushContentCheck('Rate limiter activo (/license)', false, `error: ${err.message}`);
    }

    // 5. Tablas críticas de Bitácora/Monitor responden (mismo patrón que
    // dev-tools/smoke-payments.js, extendido a los módulos que ese script no cubre).
    try {
        const tablas = ['expedientes_seguidos', 'bitacora_entries', 'monitor_partes', 'monitor_expedientes'];
        const fallidas = [];
        for (const t of tablas) {
            try { await db.query(`SELECT count(*) FROM ${t}`); }
            catch (e) { fallidas.push(`${t} (${e.message})`); }
        }
        pushContentCheck('Tablas Bitácora/Monitor accesibles', fallidas.length === 0, fallidas.length === 0 ? `${tablas.length} tablas OK` : fallidas.join(' · '));
    } catch (err) {
        pushContentCheck('Tablas Bitácora/Monitor accesibles', false, `error: ${err.message}`);
    }

    // 6. Integridad referencial — mismas 4 relaciones que health-check.js (Fase 1),
    // acá contra el entorno donde corre este endpoint (staging vía CI, prod vía tarjeta).
    try {
        const r = await checkIntegridadReferencial(db);
        pushContentCheck('Integridad referencial (4 relaciones)', r.ok, r.message);
    } catch (err) {
        pushContentCheck('Integridad referencial (4 relaciones)', false, `error: ${err.message}`);
    }

    const totalMs = Date.now() - t0Total;
    const passed  = checks.filter(c => c.ok).length;
    const total   = checks.length;

    logs.push(`[${ts()}] ─────────────────────────────────────────────────────`);
    logs.push(`[${ts()}] RESULTADO: ${passed}/${total} ${passed === total ? '✅' : '❌'}  —  duración: ${(totalMs / 1000).toFixed(1)}s`);

    const apiResult = { timestamp: new Date().toISOString(), passed, total, ok: passed === total, duration: totalMs, checks, logs };

    const saved = _loadSmoke();
    saved.api = apiResult;
    _saveSmoke(saved);

    console.log(`[smoke-tests] API ejecutado por admin ${req.user.id}: ${passed}/${total}`);
    res.json({ success: true, result: apiResult });
});

// POST /admin/smoke-tests/report-pjn  (llamado por el script local)
router.post('/smoke-tests/report-pjn', authenticateAdmin, (req, res) => {
    const { result } = req.body;
    if (!result || typeof result !== 'object') {
        return res.status(400).json({ error: 'Se requiere result' });
    }
    const saved = _loadSmoke();
    saved.pjn = { ...result, timestamp: new Date().toISOString(), reportedBy: req.user.email };
    _saveSmoke(saved);
    console.log(`[smoke-tests] PJN reportado por admin ${req.user.id}: ${result.passed}/${result.total}`);
    res.json({ success: true });
});

// POST /admin/smoke-tests/report-extension  (llamado por smoke-test-extension.js local)
router.post('/smoke-tests/report-extension', authenticateAdmin, (req, res) => {
    const { result } = req.body;
    if (!result || typeof result !== 'object') {
        return res.status(400).json({ error: 'Se requiere result' });
    }
    const saved = _loadSmoke();
    saved.extension = { ...result, timestamp: new Date().toISOString(), reportedBy: req.user.email };
    _saveSmoke(saved);
    console.log(`[smoke-tests] Extensión reportada por admin ${req.user.id}: ${result.passed}/${result.total}`);
    res.json({ success: true });
});

// ==================== SEC-2·B.2 + Etapa 1.5: verificación funcional (PJN) ====================
// Dos escritores del MISMO archivo: POST /client/verification-report (routes/client.js,
// restringido por CUIT, lo llama dailyVerification.js — hoy apagado, 0 reportes desde el
// 2026-07-14) y el nuevo POST .../verification/report de acá abajo (admin-only, pensado para
// reportar la prueba diaria real que SÍ se corre — vía computer-use, plan Etapa 1.5).
//
// Modelo viejo (2 campos fijos: procuracion/informe) → modelo nuevo (flujos[], N elementos,
// con un 3er estado 'omitido' para no confundir "sin cupo" con "el PJN se rompió" — §6.1 del
// plan). _normalizarEntry() convierte al vuelo el registro viejo en la LECTURA, sin migrar
// el archivo ni tocar el endpoint de client.js que sigue escribiendo el formato viejo.
const VERIFICATION_FILE = _path.join(__dirname, '..', 'data', 'verification-results.json');
// La ÚNICA cuenta con la que puede correrse la verificación: sus expedientes de batch,
// sus partes de Monitor y su cupo pertenecen a este CUIT. Se declara acá (y no en el
// bloque F2 de más abajo) porque la usan los DOS bloques — el de reporte y el de cupo.
const VERIFICATION_TEST_CUIT = process.env.VERIFICATION_TEST_CUIT || '27320694359';
const VERIFICATION_HISTORY_MAX = 30;
// 'monitor_inicial' se agregó el 2026-08-27 (propuesta del script de la prueba
// diaria, §6.6) — la consulta inicial del Monitor no se ejercitaba desde el
// 2026-07-23 pese a ser el camino de onboarding de un cliente nuevo. Aditivo:
// no rompe reportes viejos, que nunca mandaron esta clave.
const VERIFICATION_FLUJOS_VALIDOS = ['proc', 'batch', 'informe', 'informe_lote', 'monitor', 'monitor_inicial'];
const VERIFICATION_FLUJO_NOMBRES = {
    proc: 'Procuración', batch: 'Procuración por lote',
    informe: 'Informe individual', informe_lote: 'Informe por lote',
    monitor: 'Monitor — novedades', monitor_inicial: 'Monitor — consulta inicial'
};
const VERIFICATION_ESTADOS_FLUJO = ['ok', 'error', 'omitido'];

function _loadVerificationRaw() {
    try { if (_fs.existsSync(VERIFICATION_FILE)) return JSON.parse(_fs.readFileSync(VERIFICATION_FILE, 'utf8')); } catch (_) {}
    return { latest: null, history: [] };
}

function _saveVerificationRaw(data) {
    const dir = _path.dirname(VERIFICATION_FILE);
    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
    _fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(data, null, 2));
}

// Convierte un registro del formato viejo (procuracion/informe sueltos, sin `flujos`) al
// nuevo — de solo lectura, el archivo en disco no se toca. El fallback de `cuenta` es exacto:
// el guard por CUIT de client.js (VERIFICATION_TEST_CUIT) hacía imposible que cualquier otra
// cuenta escribiera ahí, así que TODO registro viejo es, con certeza, de esa cuenta.
function _normalizarEntry(entry) {
    if (!entry) return entry;
    if (Array.isArray(entry.flujos)) return entry; // ya está en formato nuevo

    const flujos = [];
    if (entry.procuracion) {
        flujos.push({ clave: 'proc', nombre: VERIFICATION_FLUJO_NOMBRES.proc, estado: entry.procuracion.ok ? 'ok' : 'error', tiempoMs: entry.procuracion.tiempoMs ?? null, detalle: entry.procuracion.error || null });
    }
    if (entry.informe) {
        flujos.push({ clave: 'informe', nombre: VERIFICATION_FLUJO_NOMBRES.informe, estado: entry.informe.ok ? 'ok' : 'error', tiempoMs: entry.informe.tiempoMs ?? null, detalle: entry.informe.error || null });
    }
    return {
        timestamp: entry.timestamp,
        origen: 'app-automatica',
        cuenta: VERIFICATION_TEST_CUIT, // única cuenta que el guard de client.js permitía reportar
        estado: entry.estado,
        tiempoTotalMs: entry.tiempoTotalMs ?? null,
        flujos,
        notas: null,
        reportedBy: null,
    };
}

function _loadVerificationReport() {
    const raw = _loadVerificationRaw();
    return {
        latest: _normalizarEntry(raw.latest),
        history: (raw.history || []).map(_normalizarEntry),
    };
}

// GET /admin/diagnostics/verification/latest
// Además del último reporte y el historial, calcula por cada flujo conocido cuándo fue la
// última vez que estuvo 'ok' — así un flujo que hace tiempo no se verifica queda visible en
// la tarjeta sin obligar a correr la prueba todos los días (§7 F1 del plan).
router.get('/diagnostics/verification/latest', authenticateAdmin, (req, res) => {
    const { latest, history } = _loadVerificationReport();

    const ultimaVezOk = {};
    for (const entry of history) {
        for (const f of (entry.flujos || [])) {
            if (f.estado === 'ok' && !ultimaVezOk[f.clave]) ultimaVezOk[f.clave] = entry.timestamp;
        }
    }

    res.json({ success: true, latest, history, ultimaVezOk });
});

// GET /admin/diagnostics/health-check/latest — Fase 3 de la mejora del smoke backend.
// Puro consumo: health-check.js (Fase 1) escribe este archivo solo, vía crontab; acá
// nada más se lee. Mismo formato { latest, history } que verification-results.json.
const HEALTH_CHECK_RESULTS_FILE = _path.join(__dirname, '..', 'data', 'health-check-results.json');
router.get('/diagnostics/health-check/latest', authenticateAdmin, (req, res) => {
    let data = { latest: null, history: [] };
    try {
        if (_fs.existsSync(HEALTH_CHECK_RESULTS_FILE)) {
            data = JSON.parse(_fs.readFileSync(HEALTH_CHECK_RESULTS_FILE, 'utf8'));
        }
    } catch (_) {}
    res.json({ success: true, latest: data.latest || null, history: data.history || [] });
});

// POST /admin/diagnostics/verification/report
// Reporta el resultado de la prueba diaria real (hoy: corrida vía computer-use desde un chat
// con Claude — ver el procedimiento en CLAUDE.md). Admin-only y NO otorga cupo ni toca
// `subscriptions` de ninguna cuenta: es pura escritura de diagnóstico (la recarga de cupo,
// que sí necesita estar atada a la cuenta de prueba, es un endpoint aparte — F2 del plan).
router.post('/diagnostics/verification/report', authenticateAdmin, (req, res) => {
    const { estado, flujos, cuenta, origen, notas, tiempoTotalMs } = req.body || {};

    if (!estado || !['ok', 'parcial', 'error'].includes(estado)) {
        return res.status(400).json({ success: false, error: 'estado inválido (ok|parcial|error)' });
    }
    if (!Array.isArray(flujos) || flujos.length === 0) {
        return res.status(400).json({ success: false, error: 'flujos debe ser un array no vacío' });
    }
    for (const f of flujos) {
        if (!f || !VERIFICATION_FLUJOS_VALIDOS.includes(f.clave)) {
            return res.status(400).json({ success: false, error: `clave de flujo inválida: ${f?.clave}. Válidas: ${VERIFICATION_FLUJOS_VALIDOS.join(', ')}` });
        }
        if (!VERIFICATION_ESTADOS_FLUJO.includes(f.estado)) {
            return res.status(400).json({ success: false, error: `estado de flujo inválido en '${f.clave}': ${f.estado}. Válidos: ${VERIFICATION_ESTADOS_FLUJO.join(', ')}` });
        }
    }

    // La prueba SOLO puede correrse con la cuenta de verificación: sus expedientes de
    // batch, sus partes de Monitor y su cupo (el que recarga F2) pertenecen a ese CUIT.
    // Aceptar un `cuenta` distinto guardaría un reporte que no corresponde a ninguna
    // corrida posible — se rechaza en vez de persistir algo engañoso.
    if (typeof cuenta === 'string' && cuenta.trim() && cuenta.trim() !== VERIFICATION_TEST_CUIT) {
        return res.status(400).json({
            success: false,
            error: `La verificación solo se reporta para la cuenta de prueba (CUIT ${VERIFICATION_TEST_CUIT}). Recibido: ${cuenta.trim()}`,
        });
    }

    const entry = {
        timestamp: new Date().toISOString(),
        origen: origen === 'app-automatica' ? 'app-automatica' : 'computer-use',
        cuenta: VERIFICATION_TEST_CUIT,
        estado,
        tiempoTotalMs: Number.isFinite(tiempoTotalMs) ? tiempoTotalMs : null,
        flujos: flujos.map(f => ({
            clave: f.clave,
            nombre: VERIFICATION_FLUJO_NOMBRES[f.clave],
            estado: f.estado,
            tiempoMs: Number.isFinite(f.tiempoMs) ? f.tiempoMs : null,
            detalle: (typeof f.detalle === 'string' ? f.detalle.slice(0, 500) : null),
        })),
        notas: (typeof notas === 'string' ? notas.slice(0, 2000) : null),
        reportedBy: req.user.email,
    };

    const raw = _loadVerificationRaw();
    raw.latest = entry;
    raw.history = [entry, ...(raw.history || [])].slice(0, VERIFICATION_HISTORY_MAX);
    _saveVerificationRaw(raw);

    console.log(`[verification] Reporte manual recibido de ${req.user.email}: ${estado} (${flujos.length} flujos)`);
    res.json({ success: true, entry });
});

// ==================== Etapa 1.5 F2: cupo de la cuenta de verificación ====================
// 🔴 La ÚNICA parte de este bloque que otorga cupo. Todo lo de arriba solo escribe
// diagnóstico. Las 7 protecciones del plan (§7 F2) están numeradas en el código.
//
// PROTECCIÓN 2 — la central: el user_id se resuelve SERVER-SIDE por CUIT y el endpoint
// NUNCA acepta un user_id del cliente. Así ni un admin puede usar esto como atajo genérico
// para recargarle cupo a un cliente cualquiera: para eso ya existen /users/:id/extra-usage
// y /subscriptions/:userId/adjust, ambos con motivo obligatorio y su propia auditoría.

// Presupuesto de UNA prueba diaria completa — medido por SQL sobre usage_logs (2026-06-20,
// reconfirmado el 12/08), no estimado:
//   proc +1 · batch +1 · informe +3 (1 individual + 2 del lote) · monitor +1 POR PARTE
//   global +6 (el monitor suma por parte en su contador pero +1 en el global por ejecución)
// `monitor_novedades` es el único dinámico: depende de cuántas partes activas haya.
const VERIF_COSTO_PRUEBA = { proc: 1, batch: 1, informe: 3, global: 6 };
const VERIF_RESERVA_PRUEBAS = 2;      // objetivo: dejar cupo para 2 corridas, no 1
const VERIF_UMBRAL_ILIMITADO = 100000; // mismo umbral que ya usa el portal para "X/999999"

// PROTECCIÓN 4 — topes duros. Si el cálculo pide más que esto, algo se descontroló:
// se recorta y se deja constancia, en vez de inflar la cuenta en silencio.
const VERIF_MAX_SUMA_POR_LLAMADA = { proc: 20, batch: 20, informe: 30, monitor_novedades: 30, global: 60 };
const VERIF_TECHO_BONUS = 200;         // techo absoluto acumulado por submódulo

// PROTECCIÓN 5 — cuántas recargas EFECTIVAS se admiten por ventana móvil de 24 h.
// Era 1 y se subió a 5 el 2026-08-27: con 1 sola, correr 2 pruebas en el mismo día
// (que es lo normal cuando se está verificando un cambio) agotaba la reserva y dejaba
// el botón bloqueado hasta la hora exacta del día siguiente. No afloja el techo real:
// VERIF_TECHO_BONUS (200 acumulado por submódulo) sigue igual y NO se resetea, y cada
// recarga suma solo lo que falta para la reserva de VERIF_RESERVA_PRUEBAS corridas.
const VERIF_TOPUP_MAX_POR_DIA = 5;

const VERIF_BONUS_COL = {
    proc: 'proc_bonus', batch: 'batch_bonus',
    informe: 'informe_bonus', monitor_novedades: 'monitor_novedades_bonus',
};
const VERIF_LIMIT_COL = {
    proc: 'proc_executions_limit', batch: 'batch_executions_limit',
    informe: 'informe_limit', monitor_novedades: 'monitor_novedades_limit',
};
const VERIF_USAGE_COL = {
    proc: 'proc_usage', batch: 'batch_usage',
    informe: 'informe_usage', monitor_novedades: 'monitor_novedades_usage',
};

/**
 * Lee el estado real de cupo de la cuenta de verificación.
 * F10 (2026-08-31): el comentario decía que esto replica EXACTAMENTE GET /client/account
 * — es falso, verificado leyendo ambos: /client/account (routes/client.js) trata un límite
 * NULL como "usar el default del subsistema" (`?? 50`/`20`/`10`/`3`/`10`), display-only.
 * Lo que este cálculo replica de verdad es el ENFORCEMENT real — log-execution
 * (routes/client.js, `effectiveLimit = (limitVal===-1||limitVal===null) ? null : ...`),
 * que trata NULL como ilimitado. Es lo correcto (esto decide si alcanza para correr, no
 * qué mostrar), pero el comentario apuntaba a la comparación equivocada. Hoy es inofensivo:
 * los 6 planes reales de producción no tienen NULL en ninguna de estas columnas (verificado
 * por SQL) — documentado por si algún día alguna sí lo tiene.
 */
async function _verifLeerCupo(db) {
    const { rows } = await db.query(
        `SELECT u.id AS user_id, u.email, u.cuit,
                s.payment_provider, s.usage_count, s.usage_limit,
                s.proc_usage, s.batch_usage, s.informe_usage, s.monitor_novedades_usage,
                s.proc_bonus, s.batch_bonus, s.informe_bonus, s.monitor_novedades_bonus,
                p.proc_executions_limit, p.batch_executions_limit,
                p.informe_limit, p.monitor_novedades_limit
           FROM users u
           JOIN subscriptions s ON s.user_id = u.id
           LEFT JOIN plans p ON p.id = s.plan_id
          WHERE u.cuit = $1`,
        [VERIFICATION_TEST_CUIT]
    );
    if (rows.length === 0) return null;
    const u = rows[0];

    // Partes activas: define cuánto consume el flujo de Monitor en una prueba.
    const { rows: pr } = await db.query(
        'SELECT COUNT(*)::int AS total FROM monitor_partes WHERE user_id = $1 AND activo = true',
        [u.user_id]
    );
    const partesActivas = pr[0]?.total || 0;

    const costo = { ...VERIF_COSTO_PRUEBA, monitor_novedades: partesActivas };

    const submodulos = {};
    for (const k of Object.keys(VERIF_BONUS_COL)) {
        const limit = u[VERIF_LIMIT_COL[k]];
        const bonus = u[VERIF_BONUS_COL[k]] || 0;
        const used  = u[VERIF_USAGE_COL[k]] || 0;
        const ilimitado = limit === -1 || limit === null || limit === undefined;
        const efectivo  = ilimitado ? null : limit + bonus;
        submodulos[k] = {
            used, limit, bonus, ilimitado,
            remaining: ilimitado ? null : Math.max(0, efectivo - used),
            costoPorPrueba: costo[k],
        };
    }

    const globalIlimitado = (u.usage_limit || 0) >= VERIF_UMBRAL_ILIMITADO;
    const global = {
        used: u.usage_count || 0,
        limit: u.usage_limit || 0,
        ilimitado: globalIlimitado,
        remaining: globalIlimitado ? null : Math.max(0, (u.usage_limit || 0) - (u.usage_count || 0)),
        costoPorPrueba: costo.global,
    };

    // ¿Alcanza para N pruebas? Un contador ilimitado nunca frena.
    const alcanzaPara = (n) => {
        const okSub = Object.values(submodulos).every(s => s.ilimitado || s.remaining >= s.costoPorPrueba * n);
        const okGlobal = global.ilimitado || global.remaining >= global.costoPorPrueba * n;
        return okSub && okGlobal;
    };

    return {
        userId: u.user_id, email: u.email, cuit: u.cuit,
        esTrial: u.payment_provider === null,   // define qué mecanismo frena (§4.1 del plan)
        partesActivas, submodulos, global,
        alcanzaParaUnaPrueba: alcanzaPara(1),
        alcanzaParaReserva: alcanzaPara(VERIF_RESERVA_PRUEBAS),
        reservaObjetivo: VERIF_RESERVA_PRUEBAS,
    };
}

// GET /admin/diagnostics/verification/quota
// Solo lectura: el estado de cupo de la cuenta de prueba y si alcanza para correr.
router.get('/diagnostics/verification/quota', authenticateAdmin, async (req, res) => {
    try {
        const cupo = await _verifLeerCupo(req.app.get('db'));
        if (!cupo) return res.status(404).json({ success: false, error: `No existe una cuenta con CUIT ${VERIFICATION_TEST_CUIT}` });
        res.json({ success: true, cupo });
    } catch (error) {
        console.error('Error leyendo cupo de verificación:', error);
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

// POST /admin/diagnostics/verification/quota/top-up
// Suma SOLO lo faltante para dejar reserva de VERIF_RESERVA_PRUEBAS corridas.
// PROTECCIÓN 7: nunca resta ni resetea contadores — solo sube `*_bonus` y `usage_limit`.
router.post('/diagnostics/verification/quota/top-up', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const cupo = await _verifLeerCupo(db);
        if (!cupo) return res.status(404).json({ success: false, error: `No existe una cuenta con CUIT ${VERIFICATION_TEST_CUIT}` });

        // PROTECCIÓN 3 — idempotencia: si ya alcanza, no toca nada y lo dice.
        if (cupo.alcanzaParaReserva) {
            return res.json({ success: true, aplicado: false, motivo: 'ya_alcanza', cupo });
        }

        // PROTECCIÓN 5 — cooldown: hasta VERIF_TOPUP_MAX_POR_DIA recargas EFECTIVAS por
        // ventana móvil de 24 h. Si se agota, el admin no queda sin salida:
        // /users/:id/extra-usage y /subscriptions/:id/adjust siguen disponibles (con
        // motivo obligatorio), este endpoint solo se auto-limita.
        // Nota: las llamadas que no aplican nada (PROTECCIÓN 3, `ya_alcanza`) retornan
        // ANTES de este punto y no se auditan, así que no consumen ningún lugar.
        const { rows: prev } = await db.query(
            `SELECT created_at FROM admin_events
              WHERE action = 'verification_quota_topup' AND created_at > NOW() - INTERVAL '1 day'
              ORDER BY created_at ASC`
        );
        if (prev.length >= VERIF_TOPUP_MAX_POR_DIA) {
            // Ventana móvil: el próximo lugar se libera cuando la recarga más vieja que
            // todavía cuenta sale de las 24 h. Con prev.length === MAX es la primera.
            const libera = new Date(prev[prev.length - VERIF_TOPUP_MAX_POR_DIA].created_at);
            libera.setTime(libera.getTime() + 24 * 60 * 60 * 1000);
            return res.status(429).json({
                success: false, aplicado: false, motivo: 'cooldown',
                usadas: prev.length, maximo: VERIF_TOPUP_MAX_POR_DIA,
                disponibleDesde: libera.toISOString(),
                error: `Se agotaron las ${VERIF_TOPUP_MAX_POR_DIA} recargas permitidas en las últimas 24 h. La próxima se libera el ${libera.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}. Para un ajuste inmediato, usar Usos Extra o Ajustes Manuales en la ficha del usuario.`,
                cupo,
            });
        }

        const aplicados = [];
        const recortados = [];

        // ── Submódulos (`*_bonus`) — funcionan SIEMPRE, con o sin payment_provider ──
        for (const k of Object.keys(VERIF_BONUS_COL)) {
            const s = cupo.submodulos[k];
            if (s.ilimitado) continue;
            const necesario = s.costoPorPrueba * VERIF_RESERVA_PRUEBAS;
            let faltante = Math.max(0, necesario - s.remaining);
            if (faltante === 0) continue;

            // PROTECCIÓN 4 — topes duros
            const tope = VERIF_MAX_SUMA_POR_LLAMADA[k];
            if (faltante > tope) { recortados.push({ subsistema: k, pedido: faltante, aplicado: tope, motivo: 'tope_por_llamada' }); faltante = tope; }
            if (s.bonus + faltante > VERIF_TECHO_BONUS) {
                const permitido = Math.max(0, VERIF_TECHO_BONUS - s.bonus);
                recortados.push({ subsistema: k, pedido: faltante, aplicado: permitido, motivo: 'techo_bonus_acumulado' });
                faltante = permitido;
            }
            if (faltante === 0) continue;

            const col = VERIF_BONUS_COL[k];
            const upd = await db.query(
                `UPDATE subscriptions SET ${col} = GREATEST(0, ${col} + $1) WHERE user_id = $2 RETURNING ${col}`,
                [faltante, cupo.userId]
            );
            // §4.1.3 — nunca reportar éxito si el UPDATE no matcheó ninguna fila.
            if (upd.rowCount === 0) {
                aplicados.push({ subsistema: k, sumado: 0, error: 'el UPDATE no afectó ninguna fila' });
                continue;
            }
            aplicados.push({ subsistema: k, sumado: faltante, nuevoBonus: upd.rows[0][col] });
            await db.query(
                `INSERT INTO usage_adjustments (user_id, admin_email, subsystem, amount, reason)
                 VALUES ($1, $2, $3, $4, $5)`,
                [cupo.userId, req.user.email, k, faltante, 'Recarga automática para la verificación funcional contra el PJN (Etapa 1.5 F2)']
            );
        }

        // ── Cupo global (`usage_limit`) ──
        // §4.1.1/§4.1.2: solo se toca si REALMENTE frena. Si ya es ilimitado (≥100.000,
        // que es lo que deja applyTrialBonus en una cuenta paga), no hay nada que hacer —
        // en esa cuenta el enforcement pasa a ser 100% por submódulo.
        if (!cupo.global.ilimitado) {
            const necesario = cupo.global.costoPorPrueba * VERIF_RESERVA_PRUEBAS;
            let faltante = Math.max(0, necesario - cupo.global.remaining);
            if (faltante > VERIF_MAX_SUMA_POR_LLAMADA.global) {
                recortados.push({ subsistema: 'global', pedido: faltante, aplicado: VERIF_MAX_SUMA_POR_LLAMADA.global, motivo: 'tope_por_llamada' });
                faltante = VERIF_MAX_SUMA_POR_LLAMADA.global;
            }
            if (faltante > 0) {
                // A diferencia de /users/:id/extra-usage, este UPDATE NO lleva
                // `WHERE payment_provider IS NULL`: esto no es una cortesía comercial del
                // trial, es garantizar cupo para una prueba interna. Con esa condición, en
                // una cuenta que pasara a paga el UPDATE sería un no-op silencioso (§4.1).
                const upd = await db.query(
                    'UPDATE subscriptions SET usage_limit = usage_limit + $1, updated_at = NOW() WHERE user_id = $2 RETURNING usage_limit',
                    [faltante, cupo.userId]
                );
                if (upd.rowCount === 0) {
                    aplicados.push({ subsistema: 'global', sumado: 0, error: 'el UPDATE no afectó ninguna fila' });
                } else {
                    aplicados.push({ subsistema: 'global', sumado: faltante, nuevoLimite: upd.rows[0].usage_limit });
                    await db.query(
                        `INSERT INTO usage_adjustments (user_id, admin_email, subsystem, amount, reason)
                         VALUES ($1, $2, 'global', $3, $4)`,
                        [cupo.userId, req.user.email, faltante, 'Recarga automática para la verificación funcional contra el PJN (Etapa 1.5 F2)']
                    );
                }
            }
        }

        const sumoAlgo = aplicados.some(a => a.sumado > 0);

        // PROTECCIÓN 6 — auditoría. Solo se registra si realmente se aplicó algo: así el
        // cooldown de arriba no se dispara por una llamada que no cambió nada.
        if (sumoAlgo) {
            await db.query(
                `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'verification_quota_topup', $3)`,
                [req.user.id, cupo.userId, JSON.stringify({ aplicados, recortados, cuit: VERIFICATION_TEST_CUIT })]
            );
            console.log(`[verification] Cupo recargado por ${req.user.email}: ${JSON.stringify(aplicados)}`);
        }

        const cupoFinal = await _verifLeerCupo(db);
        res.json({
            success: true,
            aplicado: sumoAlgo,
            motivo: sumoAlgo ? 'recargado' : 'nada_para_aplicar',
            aplicados, recortados,
            // Cuántas recargas quedan en la ventana de 24 h. `prev` se leyó antes de
            // aplicar, así que esta suma cuenta la de recién solo si realmente aplicó.
            recargasRestantes: Math.max(0, VERIF_TOPUP_MAX_POR_DIA - (prev.length + (sumoAlgo ? 1 : 0))),
            recargasMaximo: VERIF_TOPUP_MAX_POR_DIA,
            cupo: cupoFinal,
        });
    } catch (error) {
        console.error('Error recargando cupo de verificación:', error);
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

// ─── GET /admin/users/:userId/refund-preview ─────────────────────────────────
// Calcula el monto de reembolso proporcional por días restantes en el período actual
router.get('/users/:userId/refund-preview', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const { rows: [sub] } = await db.query(
            `SELECT period_start, next_billing_date, payment_provider, external_subscription_id
             FROM subscriptions WHERE user_id = $1`,
            [userId]
        );
        if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });

        const { rows: [lastPayment] } = await db.query(
            `SELECT amount, currency, created_at FROM payments
             WHERE user_id = $1 AND status = 'approved'
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );

        if (!lastPayment || !sub.period_start || !sub.next_billing_date) {
            return res.json({ hasPayment: false, refundAmount: 0, currency: null, daysRemaining: 0, totalDays: 0 });
        }

        const now = new Date();
        const periodStart = new Date(sub.period_start);
        const periodEnd = new Date(sub.next_billing_date);
        const totalDays = Math.max(1, Math.round((periodEnd - periodStart) / 86400000));
        const daysRemaining = Math.max(0, Math.round((periodEnd - now) / 86400000));
        const refundAmount = Math.round((daysRemaining / totalDays) * parseFloat(lastPayment.amount) * 100) / 100;

        res.json({
            hasPayment: true,
            refundAmount,
            currency: lastPayment.currency || 'ARS',
            daysRemaining,
            totalDays,
            lastPaymentAmount: parseFloat(lastPayment.amount),
            periodEnd: sub.next_billing_date
        });
    } catch (err) {
        console.error('[refund-preview] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── POST /admin/users/:userId/extra-usage ────────────────────────────────────
// Asigna usos extra de cortesía (price_total=0); descuenta de remaining_uses al usar
router.post('/users/:userId/extra-usage', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const { extra_uses, reason, ticket_id } = req.body || {};
    const db = req.app.get('db');

    // Permite sumar (+) o restar (-) usos de cortesía. No se permite 0.
    const qty = parseInt(extra_uses, 10);
    if (!Number.isInteger(qty) || qty === 0 || qty < -1000 || qty > 1000) {
        return res.status(400).json({ error: 'extra_uses debe ser un entero entre -1000 y 1000 (distinto de 0)' });
    }
    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'El motivo es obligatorio' });
    }

    // F10 (2026-08-31): sin este chequeo, un userId inexistente disparaba la FK de
    // usage_extras.user_id y caía al catch genérico (500 con el mensaje crudo de
    // Postgres) en vez de un 404 claro — a diferencia de payments/manual, que sí
    // verifica existencia antes de escribir.
    const client = await db.connect();
    try {
        const { rows: [usr] } = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (!usr) return res.status(404).json({ error: 'Usuario no encontrado' });

        // F10: 4 escrituras dependientes sin transacción — si el UPDATE de subscriptions
        // fallaba DESPUÉS de que el INSERT en usage_extras ya commiteó, quedaba un
        // registro de "se otorgaron N usos de cortesía" sin que el cupo real
        // (usage_limit) se hubiera movido: el ledger dice una cosa, subscriptions otra.
        await client.query('BEGIN');

        // Cortesía = ±N usos permanentes (sin vencimiento). expires_at queda NULL.
        await client.query(
            `INSERT INTO usage_extras (user_id, extra_uses, remaining_uses, reason, created_by_admin_id, expires_at, created_at)
             VALUES ($1, $2, $2, $3, $4, NULL, NOW())`,
            [userId, qty, reason.trim(), req.user.id]
        );
        // Hacerlos EFECTIVOS: los usos extra de cortesía son un concepto del TRIAL
        // (sin método de pago) → suman/restan al cupo global. GREATEST(0,...) evita negativo.
        // Para cuentas PAGAS el enforcement es por submódulo y se gestiona con "ajustar
        // usos manuales" (columnas *_bonus); ahí la cortesía no aplica.
        const bumpResult = await client.query(
            `UPDATE subscriptions
             SET usage_limit = GREATEST(0, usage_limit + $2), updated_at = NOW()
             WHERE user_id = $1 AND payment_provider IS NULL
             RETURNING usage_limit`,
            [userId, qty]
        );
        const aplicado = bumpResult.rowCount > 0;
        const ticketRef = ticket_id ? parseInt(ticket_id, 10) || null : null;
        await client.query(
            `INSERT INTO admin_events (admin_id, user_id, action, payload) VALUES ($1, $2, 'extra_usage_assigned', $3)`,
            [req.user.id, userId, JSON.stringify({ extra_uses: qty, reason, aplicado_al_trial: aplicado, ticket_id: ticketRef })]
        );
        // Notificación in-app SOLO al sumar (restar es una corrección interna del admin).
        if (qty > 0) {
            await client.query(
                `INSERT INTO notifications (user_id, type, message) VALUES ($1, 'extra_usage_assigned', $2)`,
                [userId, `Se te asignaron ${qty} usos adicionales de cortesía.`]
            );
        }
        await client.query('COMMIT');
        console.log(`🎁 ${qty > 0 ? '+' : ''}${qty} usos de cortesía a usuario ${userId} por admin ${req.user.id}: ${reason}`);
        res.json({ success: true, extra_uses: qty });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[extra-usage POST] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ─── GET /admin/users/:userId/extra-usage ─────────────────────────────────────
router.get('/users/:userId/extra-usage', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    try {
        const { rows } = await db.query(
            `SELECT ue.id, ue.extra_uses, ue.remaining_uses, ue.reason,
                    ue.expires_at, ue.created_at, u.email AS assigned_by_email
             FROM usage_extras ue
             LEFT JOIN users u ON ue.created_by_admin_id = u.id
             WHERE ue.user_id = $1
             ORDER BY ue.created_at DESC`,
            [userId]
        );
        res.json({ success: true, extras: rows });
    } catch (err) {
        console.error('[extra-usage GET] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /admin/users/:userId/payments ────────────────────────────────────────
router.get('/users/:userId/payments', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    try {
        const { rows } = await db.query(
            `SELECT id, external_payment_id, amount, currency, status,
                    payment_method, plan, period_start, period_end,
                    refund_amount, refunded_at, created_at
             FROM payments
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit]
        );
        res.json({ success: true, payments: rows });
    } catch (err) {
        console.error('[admin payments GET] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /admin/users/:userId/invoices ────────────────────────────────────────
router.get('/users/:userId/invoices', authenticateAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    try {
        const { rows } = await db.query(
            `SELECT id, invoice_type, cae, numero, amount, pdf_url,
                    status, retry_count, last_error AS error_message, issued_at, created_at
             FROM invoices
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit]
        );
        res.json({ success: true, invoices: rows });
    } catch (err) {
        console.error('[admin invoices GET] Error:', err.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── GET /admin/settings ─────────────────────────────────────────────────────
// Devuelve todos los valores de app_settings
router.get('/settings', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const result = await db.query(`SELECT key, value, updated_at FROM app_settings ORDER BY key`);
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = { value: r.value, updated_at: r.updated_at }; });
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Error obteniendo settings:', error);
        res.status(500).json({ error: 'Error obteniendo configuración' });
    }
});

// ─── PUT /admin/settings/:key ─────────────────────────────────────────────────
// Actualiza (o inserta) un valor en app_settings
router.put('/settings/:key', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { key } = req.params;
    const { value } = req.body;

    const ALLOWED_KEYS = ['allow_public_register'];
    if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ error: `Clave '${key}' no permitida` });
    }
    if (value === undefined || value === null) {
        return res.status(400).json({ error: 'Se requiere el campo value' });
    }

    try {
        await db.query(`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [key, String(value)]);
        console.log(`[admin] setting actualizado: ${key} = ${value}`);
        res.json({ success: true, key, value: String(value) });
    } catch (error) {
        console.error('Error actualizando setting:', error);
        res.status(500).json({ error: 'Error actualizando configuración' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN: FACTURACIÓN MANUAL
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /admin/invoices/pending ───────────────────────────────────────────────
// Pagos aprobados que aún no tienen factura PDF emitida
router.get('/invoices/pending', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { search = '' } = req.query;
    try {
        const { rows } = await db.query(`
            SELECT
                p.id          AS payment_id,
                p.created_at  AS payment_date,
                p.amount,
                p.currency,
                p.plan,
                i.id          AS invoice_id,
                u.id          AS user_id,
                u.email,
                u.nombre,
                u.apellido,
                u.cuit,
                u.domicilio,
                CONCAT_WS(' ',
                    u.nombre, u.apellido,
                    '·', u.email,
                    '·', u.cuit,
                    '·', (u.domicilio->>'calle'), (u.domicilio->>'numero') || ',',
                    (u.domicilio->>'localidad') || ',', (u.domicilio->>'provincia')
                ) AS datos_facturacion
            FROM payments p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN invoices i ON i.payment_id = p.id
            WHERE p.status = 'approved'
              AND (i.id IS NULL OR (i.pdf_url IS NULL OR i.pdf_url = ''))
              AND ($1 = '' OR u.email ILIKE $2 OR u.nombre ILIKE $2 OR u.apellido ILIKE $2 OR u.cuit ILIKE $2)
            ORDER BY p.created_at DESC
            LIMIT 100
        `, [search, `%${search}%`]);
        res.json({ pending: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /admin/invoices ───────────────────────────────────────────────────────
// Facturas emitidas (con PDF) por defecto. Con ?include_no_pdf=1 incluye también los
// registros de factura sin PDF (status pending) — usado por el selector "Asociar factura".
router.get('/invoices', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { search = '', status = '', include_no_pdf = '' } = req.query;
    const pdfCond = include_no_pdf ? 'TRUE' : "(i.pdf_url IS NOT NULL AND i.pdf_url <> '')";
    try {
        const { rows } = await db.query(`
            SELECT
                i.id,
                i.numero,
                i.invoice_type,
                i.cae,
                i.amount,
                i.pdf_url,
                i.status,
                i.issued_at,
                i.created_at,
                p.id          AS payment_id,
                p.created_at  AS payment_date,
                p.plan,
                u.id          AS user_id,
                u.email,
                u.nombre,
                u.apellido,
                u.cuit,
                u.domicilio
            FROM invoices i
            LEFT JOIN payments p ON p.id = i.payment_id
            LEFT JOIN users u ON u.id = i.user_id
            WHERE ${pdfCond}
              AND ($1 = '' OR u.email ILIKE $2 OR u.nombre ILIKE $2 OR u.apellido ILIKE $2 OR u.cuit ILIKE $2)
              AND ($3 = '' OR i.status = $3)
            ORDER BY COALESCE(i.issued_at, i.created_at) DESC
            LIMIT 200
        `, [search, `%${search}%`, status]);
        res.json({ invoices: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /admin/invoices/:id/pdf ───────────────────────────────────────────────
// C1: sirve el PDF de una factura con auth de admin. Antes los PDF colgaban de
// express.static('/invoices') sin ninguna autenticación (ver utils/invoiceStorage.js).
router.get('/invoices/:id/pdf', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
    try {
        const { rows: [inv] } = await db.query('SELECT pdf_url FROM invoices WHERE id = $1', [id]);
        if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
        const file = resolveInvoiceFile(inv.pdf_url);
        if (!file) return res.status(404).json({ error: 'La factura no tiene PDF disponible' });
        res.type('application/pdf');
        res.sendFile(file);
    } catch (err) {
        console.error('Error sirviendo PDF de factura (admin):', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ── POST /admin/invoices/:invoiceId/upload ────────────────────────────────────
// Subir PDF a una factura existente (invoiceId = id de la tabla invoices)
router.post('/invoices/:invoiceId/upload', authenticateAdmin, uploadPdfOr400, async (req, res) => {
    const db = req.app.get('db');
    const { invoiceId } = req.params;
    const { numero, invoice_type, cae } = req.body;
    if (!req.file) return res.status(400).json({ error: 'PDF requerido' });

    const pdfUrl = `/invoices/${req.file.filename}`;
    try {
        const upd = await db.query(
            `UPDATE invoices
             SET pdf_url      = $1,
                 numero       = COALESCE($2, numero),
                 invoice_type = COALESCE($3, invoice_type),
                 cae          = COALESCE($4, cae),
                 status       = 'issued',
                 issued_at    = NOW(),
                 updated_at   = NOW()
             WHERE id = $5`,
            [pdfUrl, numero || null, invoice_type || null, cae || null, invoiceId]
        );
        // F10 (2026-08-31): sin este chequeo, un invoiceId inexistente respondía éxito
        // igual — falso positivo — y el PDF recién subido quedaba huérfano sin ningún
        // registro en la DB que lo referencie.
        if (upd.rowCount === 0) {
            try { fs.unlinkSync(req.file.path); } catch (_) {}
            return res.status(404).json({ error: 'Factura no encontrada' });
        }
        res.json({ ok: true, pdf_url: pdfUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /admin/invoices/manual ──────────────────────────────────────────────
// Crea una factura manual no asociada a un pago del sistema
router.post('/invoices/manual', authenticateAdmin, uploadPdfOr400, async (req, res) => {
    const db = req.app.get('db');
    const { user_id, amount, issued_at, numero, invoice_type, cae, plan, notes } = req.body;
    // F10 (2026-08-31): uploadPdfOr400 ya escribió el PDF a disco ANTES de que esta
    // validación corra — si se rechaza sin borrarlo, queda huérfano en storage/invoices/.
    const cleanupOrphanFile = () => { if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} } };

    if (!req.file) return res.status(400).json({ error: 'PDF requerido' });
    // F10: antes solo chequeaba truthiness (!amount) — "-500" es truthy y pasaba, a
    // diferencia de payments/manual (su hermano), que sí exige un monto positivo.
    if (!user_id || amount == null || isNaN(Number(amount)) || Number(amount) <= 0 || !issued_at) {
        cleanupOrphanFile();
        return res.status(400).json({ error: 'user_id, un amount positivo e issued_at son obligatorios' });
    }

    const pdfUrl = `/invoices/${req.file.filename}`;
    let invoiceCreated = false; // solo limpiar el PDF huérfano si el error fue ANTES del
                                 // INSERT — después, el archivo ya tiene una fila que lo referencia.
    try {
        const { rows: [usr] } = await db.query('SELECT id FROM users WHERE id = $1', [user_id]);
        if (!usr) {
            cleanupOrphanFile();
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const { rows: [inv] } = await db.query(
            `INSERT INTO invoices
               (user_id, amount, pdf_url, numero, invoice_type, cae, status, issued_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'issued', $7, NOW())
             RETURNING id`,
            [user_id, amount, pdfUrl, numero || null, invoice_type || 'C', cae || null, issued_at]
        );
        invoiceCreated = true;

        // Registrar plan en el campo invoice_type si aplica (como referencia adicional)
        if (plan) {
            await db.query(
                `UPDATE invoices SET facturante_id = $1 WHERE id = $2`,
                [`concepto:${plan}${notes ? '|notas:' + notes : ''}`, inv.id]
            );
        }

        res.json({ ok: true, invoice_id: inv.id, pdf_url: pdfUrl });
    } catch (err) {
        if (!invoiceCreated) cleanupOrphanFile();
        res.status(500).json({ error: err.message });
    }
});

// ── POST /admin/invoices/from-payment/:paymentId ──────────────────────────────
// Crear registro de factura + subir PDF para un pago que no tiene invoice aún
router.post('/invoices/from-payment/:paymentId', authenticateAdmin, uploadPdfOr400, async (req, res) => {
    const db = req.app.get('db');
    const { paymentId } = req.params;
    const { numero } = req.body;
    if (!req.file) return res.status(400).json({ error: 'PDF requerido' });

    const pdfUrl = `/invoices/${req.file.filename}`;
    try {
        // Obtener datos del pago para crear la factura
        const { rows: [pmt] } = await db.query(
            'SELECT user_id, amount, plan FROM payments WHERE id = $1 AND status = $2',
            [paymentId, 'approved']
        );
        if (!pmt) return res.status(404).json({ error: 'Pago no encontrado o no aprobado' });

        // Crear registro de factura
        const { invoice_type: invType, cae } = req.body;
        const { rows: [inv] } = await db.query(
            `INSERT INTO invoices (payment_id, user_id, amount, pdf_url, numero, invoice_type, cae, status, issued_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'issued', NOW(), NOW())
             ON CONFLICT (payment_id) DO UPDATE
               SET pdf_url       = EXCLUDED.pdf_url,
                   numero        = COALESCE(EXCLUDED.numero,       invoices.numero),
                   invoice_type  = COALESCE(EXCLUDED.invoice_type, invoices.invoice_type),
                   cae           = COALESCE(EXCLUDED.cae,          invoices.cae),
                   status        = 'issued',
                   issued_at     = NOW()
             RETURNING id`,
            [paymentId, pmt.user_id, pmt.amount, pdfUrl, numero || null, invType || 'C', cae || null]
        );
        res.json({ ok: true, invoice_id: inv.id, pdf_url: pdfUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN: PAGOS (listado global, alta manual y asociación pago↔factura)
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /admin/payments ───────────────────────────────────────────────────────
// Listado global de pagos con filtros (search por email/nombre/cuit, status).
// Incluye invoice_id si el pago tiene una factura asociada.
router.get('/payments', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { search = '', status = '' } = req.query;
    try {
        const { rows } = await db.query(`
            SELECT
                p.id, p.external_payment_id, p.amount, p.currency, p.status,
                p.payment_method, p.plan, p.period_start, p.period_end,
                p.refund_amount, p.created_at,
                i.id      AS invoice_id,
                i.numero  AS invoice_numero,
                i.pdf_url AS invoice_pdf,
                i.status  AS invoice_status,
                u.id      AS user_id,
                u.email, u.nombre, u.apellido, u.cuit
            FROM payments p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN invoices i ON i.payment_id = p.id
            WHERE ($1 = '' OR u.email ILIKE $2 OR u.nombre ILIKE $2 OR u.apellido ILIKE $2 OR u.cuit ILIKE $2)
              AND ($3 = '' OR p.status = $3)
            ORDER BY p.created_at DESC
            LIMIT 300
        `, [search, `%${search}%`, status]);
        res.json({ payments: rows });
    } catch (err) {
        console.error('[admin payments list] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /admin/payments/manual ───────────────────────────────────────────────
// Alta manual de un pago (sin PDF). Útil para registrar cobros fuera de MercadoPago.
router.post('/payments/manual', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const {
        user_id, amount, currency = 'ARS', status = 'approved',
        payment_method = 'manual', plan, external_payment_id,
        period_start, period_end, created_at
    } = req.body;

    if (!user_id || amount == null || isNaN(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({ error: 'user_id y un monto válido (> 0) son obligatorios' });
    }
    // F10 (2026-08-31): payments.status no tiene CHECK constraint en el schema — sin
    // esta whitelist, un typo vía API directa (no vía UI, que sí usa un <select> fijo)
    // podía dejar un pago con un status arbitrario que las queries de negocio
    // (`WHERE status='approved'` en invoices/pending, refund-preview, etc.) simplemente
    // no encuentran, sin ningún error visible. Mismos 4 valores que ofrece el <select>.
    if (!PAYMENT_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status inválido. Válidos: ${PAYMENT_STATUSES.join(', ')}` });
    }
    try {
        // Validar que el usuario exista
        const { rows: [usr] } = await db.query('SELECT id FROM users WHERE id = $1', [user_id]);
        if (!usr) return res.status(404).json({ error: 'Usuario no encontrado' });

        // subscription_id del usuario (si tiene), para mantener la relación
        const { rows: [sub] } = await db.query('SELECT id FROM subscriptions WHERE user_id = $1', [user_id]);

        const { rows: [pmt] } = await db.query(
            `INSERT INTO payments
               (user_id, subscription_id, external_payment_id, amount, currency, status,
                payment_method, plan, period_start, period_end, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()))
             RETURNING id`,
            [
                user_id, sub?.id || null, external_payment_id || null, amount, currency, status,
                payment_method || 'manual', plan || null,
                period_start || null, period_end || null, created_at || null
            ]
        );
        res.json({ ok: true, payment_id: pmt.id });
    } catch (err) {
        console.error('[admin payments manual] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /admin/payments/:paymentId/link-invoice ──────────────────────────────
// Asocia un pago a una factura existente (setea invoices.payment_id).
router.post('/payments/:paymentId/link-invoice', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { paymentId } = req.params;
    const { invoice_id } = req.body;
    if (!invoice_id) return res.status(400).json({ error: 'invoice_id es obligatorio' });
    try {
        await linkInvoiceToPayment(db, invoice_id, paymentId);
        res.json({ ok: true });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// ── POST /admin/invoices/:invoiceId/link-payment ──────────────────────────────
// Asocia una factura a un pago existente (setea invoices.payment_id).
router.post('/invoices/:invoiceId/link-payment', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { invoiceId } = req.params;
    const { payment_id } = req.body;
    if (!payment_id) return res.status(400).json({ error: 'payment_id es obligatorio' });
    try {
        await linkInvoiceToPayment(db, invoiceId, payment_id);
        res.json({ ok: true });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// ── POST /admin/invoices/:invoiceId/unlink-payment ────────────────────────────
// Quita la asociación pago↔factura.
router.post('/invoices/:invoiceId/unlink-payment', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { invoiceId } = req.params;
    try {
        const upd = await db.query('UPDATE invoices SET payment_id = NULL, updated_at = NOW() WHERE id = $1', [invoiceId]);
        if (upd.rowCount === 0) return res.status(404).json({ error: 'Factura no encontrada' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: vincula una factura a un pago validando coherencia y unicidad.
// invoices.payment_id es UNIQUE → un pago no puede tener dos facturas.
async function linkInvoiceToPayment(db, invoiceId, paymentId) {
    const { rows: [inv] } = await db.query('SELECT id, user_id, payment_id FROM invoices WHERE id = $1', [invoiceId]);
    if (!inv) { const e = new Error('Factura no encontrada'); e.statusCode = 404; throw e; }
    const { rows: [pmt] } = await db.query('SELECT id, user_id FROM payments WHERE id = $1', [paymentId]);
    if (!pmt) { const e = new Error('Pago no encontrado'); e.statusCode = 404; throw e; }
    if (inv.user_id && pmt.user_id && inv.user_id !== pmt.user_id) {
        const e = new Error('El pago y la factura pertenecen a usuarios distintos'); e.statusCode = 400; throw e;
    }
    // F10 (2026-08-31): el chequeo de abajo solo mira el lado del PAGO (¿ya tiene otra
    // factura?) — nunca chequeaba el lado de la FACTURA (¿ya está vinculada a OTRO
    // pago?). invoices.payment_id es UNIQUE y nullable, sin trigger que lo proteja: el
    // UPDATE final reasignaba en silencio, dejando el pago viejo huérfano sin factura y
    // sin ningún aviso. La única defensa era client-side (un <select> deshabilitado en
    // dashboard.js), trivial de saltear llamando el endpoint directo.
    if (inv.payment_id && inv.payment_id !== paymentId) {
        const e = new Error(`Esa factura ya está asociada al pago #${inv.payment_id}. Desvinculala primero.`);
        e.statusCode = 409; throw e;
    }
    // ¿Ya hay otra factura asociada a este pago?
    const { rows: [other] } = await db.query(
        'SELECT id FROM invoices WHERE payment_id = $1 AND id <> $2', [paymentId, invoiceId]
    );
    if (other) {
        const e = new Error(`Ese pago ya está asociado a la factura #${other.id}. Desvinculala primero.`);
        e.statusCode = 409; throw e;
    }
    await db.query('UPDATE invoices SET payment_id = $1, updated_at = NOW() WHERE id = $2', [paymentId, invoiceId]);
}

// ── PUT /admin/payments/:id — editar un pago cargado MANUALMENTE ──────────────
// Solo pagos con payment_method='manual' (no se editan los pagos reales de MercadoPago,
// que reflejan transacciones efectivas).
router.put('/payments/:id', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { id } = req.params;
    const { amount, currency, status, payment_method, plan, external_payment_id, created_at } = req.body;
    try {
        const { rows: [p] } = await db.query('SELECT payment_method FROM payments WHERE id = $1', [id]);
        if (!p) return res.status(404).json({ error: 'Pago no encontrado' });
        if (p.payment_method !== 'manual') {
            return res.status(400).json({ error: 'Solo se pueden editar pagos cargados manualmente (no los de MercadoPago).' });
        }
        if (amount != null && (isNaN(Number(amount)) || Number(amount) <= 0)) {
            return res.status(400).json({ error: 'Monto inválido' });
        }
        // F10 (2026-08-31): mismo problema que en payments/manual — sin CHECK constraint
        // en el schema, un status fuera de los 4 que ofrece el <select> queda persistido
        // sin error, y las queries de negocio que filtran por status no lo encuentran.
        if (status && !PAYMENT_STATUSES.includes(status)) {
            return res.status(400).json({ error: `status inválido. Válidos: ${PAYMENT_STATUSES.join(', ')}` });
        }
        await db.query(
            `UPDATE payments SET
                amount              = COALESCE($1, amount),
                currency            = COALESCE($2, currency),
                status              = COALESCE($3, status),
                payment_method      = COALESCE($4, payment_method),
                plan                = $5,
                external_payment_id = $6,
                created_at          = COALESCE($7, created_at)
             WHERE id = $8`,
            [
                amount ?? null, currency || null, status || null, payment_method || null,
                plan || null, external_payment_id || null, created_at || null, id
            ]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('[admin payments edit] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── PUT /admin/invoices/:id/meta — editar metadata de una factura ─────────────
// Campos que carga el admin a mano (tipo, número, CAE, monto, fecha). No toca el PDF
// (eso se reemplaza con /upload) ni la vinculación al pago.
router.put('/invoices/:id/meta', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { id } = req.params;
    const { amount, numero, invoice_type, cae, issued_at } = req.body;
    try {
        const { rows: [inv] } = await db.query('SELECT id FROM invoices WHERE id = $1', [id]);
        if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
        if (amount != null && amount !== '' && (isNaN(Number(amount)) || Number(amount) < 0)) {
            return res.status(400).json({ error: 'Monto inválido' });
        }
        await db.query(
            `UPDATE invoices SET
                amount       = COALESCE($1, amount),
                numero       = $2,
                invoice_type = COALESCE($3, invoice_type),
                cae          = $4,
                issued_at    = COALESCE($5, issued_at),
                updated_at   = NOW()
             WHERE id = $6`,
            [
                (amount === '' || amount == null) ? null : amount,
                numero || null, invoice_type || null, cae || null, issued_at || null, id
            ]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('[admin invoices edit] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  FERIADOS (ABM)  →  /admin/feriados  (F1.8, hallazgo H2 de la propuesta Bitácora)
// ═══════════════════════════════════════════════════════════════════════════
// Config GLOBAL del sistema (una sola tabla `feriados`, sin `user_id`) — por
// eso va acá y no en routes/bitacora.js: auth de admin, SIN el gate de plan
// (`checkBitacoraPlan`), que es por-usuario y no aplica a config del sistema.
// Es lo que le da mantenimiento año a año a la calculadora de plazos de F1.3 —
// el seed de F1.1 cargó el resto de 2026 + todo 2027, salvo la feria de
// invierno (su fecha la fija la CSJN por acordada cada año, impredecible).

router.get('/feriados', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const year = req.query.year ? parseInt(req.query.year, 10) : null;
        const { rows } = (year && !Number.isNaN(year))
            ? await db.query('SELECT id, fecha, motivo FROM feriados WHERE EXTRACT(YEAR FROM fecha) = $1 ORDER BY fecha', [year])
            : await db.query('SELECT id, fecha, motivo FROM feriados ORDER BY fecha');
        res.json({ success: true, feriados: rows });
    } catch (error) {
        console.error('Error listando feriados (admin):', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.post('/feriados', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { fecha, motivo } = req.body || {};
    if (!fecha || Number.isNaN(new Date(fecha).getTime())) {
        return res.status(400).json({ error: 'Fecha inválida' });
    }
    const motivoTxt = typeof motivo === 'string' ? motivo.trim().slice(0, 200) : null;
    try {
        const { rows } = await db.query(
            'INSERT INTO feriados (fecha, motivo) VALUES ($1, $2) RETURNING id, fecha, motivo',
            [fecha, motivoTxt || null]
        );
        console.log(`Feriado creado por admin ${req.user.id}: ${fecha}`);
        res.status(201).json({ success: true, feriado: rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un feriado en esa fecha' });
        console.error('Error creando feriado:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.put('/feriados/:id', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { id } = req.params;
    const { fecha, motivo } = req.body || {};

    const campos = [];
    const vals = [];
    let i = 1;
    if (fecha !== undefined) {
        if (!fecha || Number.isNaN(new Date(fecha).getTime())) return res.status(400).json({ error: 'Fecha inválida' });
        campos.push(`fecha = $${i++}`); vals.push(fecha);
    }
    if (motivo !== undefined) {
        campos.push(`motivo = $${i++}`);
        vals.push(typeof motivo === 'string' ? motivo.trim().slice(0, 200) || null : null);
    }
    if (campos.length === 0) return res.status(400).json({ error: 'Nada para actualizar' });

    vals.push(id);
    try {
        const { rows } = await db.query(
            `UPDATE feriados SET ${campos.join(', ')} WHERE id = $${i} RETURNING id, fecha, motivo`,
            vals
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Feriado no encontrado' });
        res.json({ success: true, feriado: rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un feriado en esa fecha' });
        console.error('Error actualizando feriado:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.delete('/feriados/:id', authenticateAdmin, async (req, res) => {
    const db = req.app.get('db');
    const { id } = req.params;
    try {
        const { rowCount } = await db.query('DELETE FROM feriados WHERE id = $1', [id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Feriado no encontrado' });
        console.log(`Feriado ${id} eliminado por admin ${req.user.id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error eliminando feriado:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;