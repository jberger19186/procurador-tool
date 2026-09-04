const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');   // C.1 capa 2 (E9): HMAC de la marca de agua
const { scriptDownloadLimiter } = require('../middleware/rateLimiter');
const { getSignatureCache } = require('../src/security/signatureCache');
const { getDecryptedScript } = require('../utils/scriptEncryption');
const authenticateToken = require('../middleware/authenticateToken');
const { getLatestAsset } = require('../utils/githubRelease');   // H-BE-08
const { checkBitacoraPlan } = require('../middleware/checkBitacoraPlan');
// B.7 (fase E5): gate de suspensión por términos no aceptados. Va sobre
// scripts/check y scripts/download —sin script no hay ejecución posible—, NO sobre
// verify-session ni account: el suspendido tiene que poder mantener la sesión viva
// y ver su estado para llegar a /legal/accept/.
const requireLegalOk = require('../middleware/requireLegalOk');
// B.8 (fase E7): mapa único script → subsistema, compartido con routes/license.js
// y routes/monitor.js. El subsistema lo decide el SERVIDOR desde el nombre del
// script; el campo `subsystem` del cuerpo del request ya no lo elige.
const { isKnownScript, subsystemForScript, usageColumnFor, subsystemLabel, VALID_SUBSYSTEMS } = require('../utils/subsystems');

// A.1 (revisión 2026-07-27, hallazgo E5-1/P-1): whitelist de scripts que el cliente
// (Electron) realmente descarga y ejecuta. Antes /scripts/download y /scripts/available
// no filtraban por nombre ni por plan, así que cualquier suscripción viva podía bajar
// también los scripts de operación del servidor (backup-db.js, data-retention.js, etc.)
// y los de testing que reencrypt_scripts.js barre indiscriminadamente del directorio.
// Esta lista espeja exactamente el mapa `dependencies` de electron-app/src/auth/authManager.js
// (los scripts principales + sus dependencias) — no es una lista nueva, es la que ya existe
// del lado del cliente.
// E9: se mudó a utils/scriptsDistribuibles.js porque `processScripts` también la necesita
// (decide qué ofuscar). Una copia en cada lado se desincroniza; el módulo es la fuente única.
const { SCRIPTS_DISTRIBUIBLES } = require('../utils/scriptsDistribuibles');

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
router.get('/scripts/check/:scriptName', authenticateToken, requireLegalOk(), async (req, res) => {
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

        // F6 (2026-08-31): la whitelist de A.1 (E5-1/P-1) se había aplicado en
        // /download y /available pero NO acá — el tercero del trío quedó afuera.
        // Verificado contra staging: `GET /client/scripts/check/backup-db` devolvía
        // 200 con el hash SHA-256 del texto plano de los 7 scripts NO distribuibles
        // (los 6 del hallazgo P-1 más health-check.js, que processScripts sumó solo
        // al crearse en agosto). No entrega contenido, pero confirma qué scripts de
        // operación corren en el servidor y da un oráculo para verificar byte a byte
        // una copia sospechada — justo lo que P-1 quiso cerrar.
        if (!SCRIPTS_DISTRIBUIBLES.has(normalizedName)) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

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
router.get('/scripts/download/:scriptName', authenticateToken, scriptDownloadLimiter, requireLegalOk(), async (req, res) => {
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

        // A.1 (E5-1/P-1): solo los scripts que el cliente realmente ejecuta son descargables
        if (!SCRIPTS_DISTRIBUIBLES.has(normalizedName)) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

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

        // H-BE-11 (E6): acá se firmaba un `sessionKey` por descarga de script que el
        // cliente nunca lee (`authManager.loadScript` desestructura solo `script` y
        // `security`) y que ningún endpoint verifica. Retirado junto con su gemelo del
        // login: con estos dos, `SESSION_KEY_SECRET` queda sin uso en todo el backend.
        // Desencriptar script en el servidor (nunca enviar la clave al cliente)
        const decryptedCode = await getDecryptedScript(db, normalizedName);

        // ── C.1 capa 2 (fase E9): marca de agua por cuenta ────────────────────────
        // Un comentario de una línea al final del archivo, con el HMAC de
        // (userId | script | hash). Va DESPUÉS de descifrar y ANTES de firmar, para que
        // `security.checksum` y `security.signature` correspondan exactamente al
        // contenido que se entrega.
        //
        // Por qué un comentario y no una variable: no altera la ejecución, no lo toca el
        // ofuscador (ya corrió en processScripts, esto es la entrega) y sobrevive al
        // vm.runInNewContext del wrapper del cliente sin cambiar una sola semántica.
        //
        // No se persiste nada: el HMAC es determinista, así que ante una copia filtrada
        // se recalcula para cada usuario y se compara. No hace falta tabla de trazas.
        //
        // Fail-CLOSED si falta WM_SECRET. La alternativa —entregar el script sin marca y
        // seguir— es un fail-open silencioso: la trazabilidad quedaría rota justo cuando
        // hace falta y nadie se enteraría hasta que apareciera una copia sin identificar.
        // Preferimos un 500 ruidoso, que se ve en el primer arranque de staging.
        const wmSecret = process.env.WM_SECRET;
        if (!wmSecret || wmSecret.length < 32) {
            console.error('[SEGURIDAD] WM_SECRET no configurado (o menor a 32 caracteres): no se entrega el script sin marca de agua.');
            return res.status(500).json({
                success: false,
                error: 'No se pudo preparar el script. Intentá de nuevo en unos minutos.'
            });
        }
        const wm = crypto.createHmac('sha256', wmSecret)
            .update(`${userId}|${normalizedName}|${script.hash}`)
            .digest('hex')
            .slice(0, 32);
        const codigoEntregado = `${decryptedCode}\n// wm:${wm}\n`;

        // Firmar script con RSA (usa caché para evitar re-firmar)
        let securityData = null;
        try {
            const signatureCache = getSignatureCache();
            // F6: la clave del caché de firmas usa el nombre NORMALIZADO. Con el
            // nombre crudo, `testM2` y `testM2.js` (el cliente puede pedir cualquiera
            // de los dos) creaban 2 entradas para el mismo script, cada una con su
            // firma RSA propia, en un caché de maxSize 100 con evicción FIFO.
            //
            // E9: la clave suma el `userId`. Con la marca de agua, dos usuarios reciben
            // contenidos distintos del mismo script: una entrada por nombre servía para
            // uno solo y obligaba a firmar de nuevo en cada descarga del resto.
            // Se firma `codigoEntregado` (CON marca), no `decryptedCode`.
            const signResult = signatureCache.getOrCalculate(normalizedName, codigoEntregado, userId);
            securityData = {
                checksum: signResult.checksum,
                signature: signResult.signature,
                signedAt: signResult.signedAt
            };
            console.log(`🔏 Script firmado: ${normalizedName}`);
        } catch (signError) {
            console.error(`[SEGURIDAD] No se pudo firmar ${scriptName}: ${signError.message}`);
            return res.status(500).json({
                success: false,
                error: 'No se pudo firmar el script. Intentá de nuevo en unos minutos.'
            });
        }

        res.json({
            success: true,
            script: {
                name: script.script_name,
                // Con marca de agua: es lo que se firmó y lo que el cliente va a
                // cotejar contra `security.checksum`.
                content: codigoEntregado,
                // SIN marca, a propósito: `hash` es la identidad de VERSIÓN, no la
                // integridad del contenido. `authManager.js:365` lo compara contra el
                // hash cacheado para decidir si re-descargar; si acá viajara el checksum
                // con marca, cambiaría en cada entrega y el cliente re-descargaría los 13
                // scripts en cada arranque. Los dos hashes tienen roles distintos:
                //   script.hash        → ¿cambió la versión del script?   (base, sin marca)
                //   security.checksum  → ¿llegó íntegro lo que se firmó?  (con marca)
                hash: script.hash,
                version: script.version
            },
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

        // A.1 (E5-1/P-1): listar solo los scripts distribuibles al cliente
        const scriptsResult = await db.query(`
            SELECT script_name, version, hash
            FROM encrypted_scripts
            WHERE active = true
            ORDER BY script_name
        `);

        res.json({
            success: true,
            plan: plan,
            scripts: scriptsResult.rows
                .filter(s => SCRIPTS_DISTRIBUIBLES.has(s.script_name))
                .map(s => ({
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
//
// ═══════════════════════════════════════════════════════════════════════════════
//  B.8 (fase E7) — ESTE ENDPOINT YA NO ES LA FUENTE DE VERDAD DEL CUPO
// ═══════════════════════════════════════════════════════════════════════════════
// El cupo se cobra al entregar el permiso, en `POST /license/execution/start`.
// Acá quedan dos cosas:
//
//   1. La BITÁCORA (`usage_logs`), que es lo que este endpoint siempre debió ser.
//   2. Un camino de conteo RESIDUAL, para las ejecuciones que hoy NO piden
//      permiso: `run-informe` y `run-monitoreo` de `electron-app/main.js` llaman
//      a `executeRemoteScriptAsLocal` sin pasar por `execution/start`. Si se
//      quitara el conteo de acá, informes y monitoreo quedarían gratis e
//      ilimitados.
//
//      ⚠️ NO alcanza con que E8 esté desplegado. Verificado el 2026-09-04 sobre
//      el commit `90021c0` (E8, cliente 2.7.55): `runInformeLogic` y
//      `run-monitoreo` de `electron-app/main.js` SIGUEN sin llamar a
//      `acquireExecutionLock` — los únicos 4 call sites son los de procuración.
//      La condición real para retirar este camino es que ESOS DOS FLUJOS pasen
//      por `execution/start`, lo que exige otro release de cliente y, para el
//      monitoreo, decidir antes con qué unidad se cobra (hoy es por parte
//      consultada; `start` entrega un permiso por corrida).
//      Antes de tocar esto: `grep -n acquireExecutionLock electron-app/main.js`
//      y confirmar que informe y monitor están entre los llamadores.
//
// `quota_counted` de `active_executions` es lo que decide: si el permiso de esta
// ejecución YA descontó, acá no se descuenta nada. Es la única fuente de verdad
// y es lo que impide el doble conteo en los dos sentidos de la transición.
router.post('/scripts/log-execution', authenticateToken, async (req, res) => {
    const { scriptName, success, errorMessage, executionTime, subsystem, expedientesCount, executionId } = req.body;
    const db = req.app.get('db');
    const userId = req.user.id;

    // H-FE-01 (fase E1): `scriptName`, `errorMessage` y `subsystem` llegan del cuerpo del
    // request y terminan en `usage_logs`, que el dashboard admin renderiza con innerHTML.
    // Se validan acá, en el escritor, además del escape del lado del dashboard (defensa en
    // profundidad). El cliente Electron manda siempre nombres de archivo de script
    // (`testM2.js`, `procesarNovedadesCompleto.js`, …), que cumplen el patrón.
    if (typeof scriptName !== 'string' || !/^[\w.-]{1,80}$/.test(scriptName)) {
        return res.status(400).json({ error: 'scriptName inválido' });
    }
    // Mismas 4 claves que el mapa `usageCol` de abajo. `null`/ausente sigue siendo válido
    // (backendClient.js:140 manda null cuando el script no mapea a ningún subsistema).
    // La validación se conserva para no aceptar basura en `usage_logs.subsystem`, aunque
    // el valor que efectivamente se use ya no salga de acá (ver justo abajo).
    if (subsystem != null && !VALID_SUBSYSTEMS.includes(subsystem)) {
        return res.status(400).json({ error: 'subsystem inválido' });
    }
    // Diagnóstico: se acota, no se rechaza (un mensaje largo legítimo no debe perder el log).
    const safeErrorMessage = String(errorMessage || '').slice(0, 500) || null;

    // B.8: el subsistema lo resuelve el SERVIDOR desde el nombre del script. Antes se
    // tomaba `req.body.subsystem` tal cual, así que un cliente modificado podía cobrarse
    // la ejecución contra el contador más barato (o contra ninguno). El mapa compartido
    // reproduce exactamente `getSubsystemForScript()` del cliente para los 13 scripts
    // distribuibles, así que ningún flujo real cambia de contador.
    // Un script fuera del mapa NO se rechaza acá (a diferencia de `execution/start`):
    // este endpoint es la bitácora, y perder el registro de una ejecución rara es peor
    // que registrarla sin subsistema. Cae a null → solo contador global.
    const effSubsystem = isKnownScript(scriptName) ? subsystemForScript(scriptName) : null;
    const usageCol     = usageColumnFor(effSubsystem);

    // Id del permiso, si el cliente lo manda (lo hace a partir de E8).
    const execId = Number.isInteger(executionId)
        ? executionId
        : (/^\d{1,12}$/.test(String(executionId ?? '')) ? Number(executionId) : null);

    try {
        // ── ¿El cupo de esta ejecución ya lo cobró `execution/start`? ─────────
        // Dos caminos, según qué versión de cliente esté hablando:
        //
        //  (1) Cliente NUEVO (E8+): manda `executionId`. Su sola presencia significa
        //      que `start` entregó un permiso, y `start` solo entrega permisos que ya
        //      descontó. Se confirma contra la fila cuando todavía existe; si ya no
        //      existe (un `end` que se adelantó), igual NO se cuenta. Que un cliente
        //      pueda inventar un `executionId` para evitar el conteo no agrega ningún
        //      riesgo: un cliente modificado ya puede, hoy y siempre, no llamar a este
        //      endpoint. Por eso el cobro se movió a `start`.
        //
        //  (2) Cliente VIEJO (los instalados hoy): no manda nada. Se busca un permiso
        //      reciente del mismo usuario para el mismo script que YA descontó
        //      (transición opción (a) de la spec). Funciona porque el orden real de
        //      llamadas del cliente instalado es start → … → log-execution → end
        //      (verificado en main.js: `executeRemoteScriptAsLocal`, que hace el
        //      log-execution, resuelve ANTES del `releaseExecutionLock()` del
        //      `finally`), así que la fila del permiso sigue viva cuando llega acá.
        //      La ventana de 35 min es holgada respecto del TTL de 5 min del candado,
        //      que el heartbeat renueva mientras la ejecución dura.
        let yaContado = false;
        if (execId !== null) {
            yaContado = true;
            try {
                const { rows } = await db.query(
                    `SELECT 1 FROM active_executions
                     WHERE id = $1 AND user_id = $2 AND quota_counted = true`,
                    [execId, userId]
                );
                if (rows.length === 0) {
                    console.warn(`[B.8] log-execution con executionId=${execId} sin permiso vivo (user=${userId}); no se cuenta igual`);
                }
            } catch (_) { /* la confirmación es informativa: no cambia la decisión */ }
        } else {
            const { rows } = await db.query(
                // La ventana se mide contra `last_heartbeat`, NO contra `started_at`.
                // `started_at` queda fijo al crear el permiso, así que una corrida larga
                // (un lote de 20 expedientes con reintentos de 180 s pasa los 35 min sin
                // esfuerzo; el proyecto ya registró una de 1658 s) llegaba acá con la fila
                // viva pero fuera de la ventana → se descontaba DOS veces, y B.8 prohíbe
                // reembolsar. `last_heartbeat` lo refresca `execution/heartbeat` cada 30 s
                // mientras la ejecución dura, así que la ventana pasa a significar lo que
                // realmente importa: "este permiso estuvo vivo recién". Un permiso cuyo
                // cliente murió hace más de 35 min no lo protege, que es lo correcto.
                `SELECT 1 FROM active_executions
                 WHERE user_id = $1 AND script_name = $2 AND quota_counted = true
                   AND last_heartbeat > NOW() - INTERVAL '35 minutes'
                 LIMIT 1`,
                [userId, scriptName]
            );
            yaContado = rows.length > 0;
        }
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

        // Verificar límite por subsistema si aplica.
        // B.8: `!yaContado` es lo que evita el doble descuento. Si el permiso de esta
        // ejecución ya cobró en `execution/start`, acá no se toca ningún contador y el
        // request queda como pura bitácora.
        if (!yaContado && usageCol && success) {
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
                    error: `Has alcanzado el límite de ${subsystemLabel(effSubsystem)}`,
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
        } else if (!yaContado && success) {
            // Backward compat: solo incrementar usage_count global.
            // Solo cuentan las ejecuciones EXITOSAS — errores y detenciones del usuario
            // no consumen usos (quedan registradas en usage_logs igualmente).
            await db.query(`
                UPDATE subscriptions SET usage_count = usage_count + 1
                WHERE user_id = $1 AND expires_at > NOW()
                  AND usage_count < usage_limit
            `, [userId]);
        }

        // Registrar log con subsistema. B.8: se guarda el subsistema RESUELTO POR EL
        // SERVIDOR (no el del cuerpo) y el id del permiso que habilitó la ejecución,
        // para poder correlacionar bitácora ↔ cupo cobrado en una auditoría.
        await db.query(`
            INSERT INTO usage_logs (user_id, script_name, success, error_message, subsystem, expedientes_count, execution_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [userId, scriptName, success, safeErrorMessage, effSubsystem || null, expedientesCount || null, execId]);

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

// ==================== SEC-2·B.2: verificación diaria real (PJN) ====================
// Reportado por la app Electron logueada con la cuenta de prueba dedicada (CUIT
// configurado en VERIFICATION_TEST_CUIT). No lleva credenciales ni contenido de
// expedientes reales, solo resultado (ok/error + tiempos). Restringido por CUIT para
// que solo esa cuenta pueda escribir el reporte que ve el dashboard admin.
const _vfs   = require('fs');
const _vpath = require('path');
const VERIFICATION_FILE = _vpath.join(__dirname, '..', 'data', 'verification-results.json');
const VERIFICATION_TEST_CUIT = process.env.VERIFICATION_TEST_CUIT || '27320694359';
const VERIFICATION_HISTORY_MAX = 30;

function _loadVerification() {
    try { if (_vfs.existsSync(VERIFICATION_FILE)) return JSON.parse(_vfs.readFileSync(VERIFICATION_FILE, 'utf8')); } catch (_) {}
    return { latest: null, history: [] };
}

function _saveVerification(data) {
    const dir = _vpath.dirname(VERIFICATION_FILE);
    if (!_vfs.existsSync(dir)) _vfs.mkdirSync(dir, { recursive: true });
    _vfs.writeFileSync(VERIFICATION_FILE, JSON.stringify(data, null, 2));
}

router.post('/verification-report', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { timestamp, estado, tiempoTotalMs, procuracion, informe } = req.body;

    if (!estado || !['ok', 'parcial', 'error'].includes(estado)) {
        return res.status(400).json({ success: false, error: 'estado inválido' });
    }

    try {
        const u = await db.query('SELECT cuit FROM users WHERE id = $1', [userId]);
        const cuit = u.rows[0]?.cuit;
        if (cuit !== VERIFICATION_TEST_CUIT) {
            return res.status(403).json({ success: false, error: 'Cuenta no autorizada a reportar verificaciones' });
        }

        const entry = {
            timestamp: timestamp || new Date().toISOString(),
            estado,
            tiempoTotalMs: tiempoTotalMs || null,
            procuracion: procuracion || null,
            informe: informe || null
        };

        const saved = _loadVerification();
        saved.latest = entry;
        saved.history = [entry, ...(saved.history || [])].slice(0, VERIFICATION_HISTORY_MAX);
        _saveVerification(saved);

        console.log(`[verification] Reporte recibido: ${estado} (${timestamp})`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error guardando reporte de verificación:', error);
        res.status(500).json({ success: false, error: 'Error del servidor' });
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
                   u.registration_status, u.home_section,
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
                   p.period_days, p.plan_type, p.bitacora_enabled, p.markdown_enabled
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
                bitacoraEnabled: u.bitacora_enabled === true,
                // M1 del módulo Markdown/Anonimización — mismo patrón que bitacoraEnabled.
                // No consume cupo (decisión del operador, 2026-08-26): es procesamiento
                // 100% local, no toca el PJN ni gasta recursos del servidor.
                markdownEnabled: u.markdown_enabled === true,
                // 'plan'|'bitacora' — la validación contra bitacoraEnabled (hallazgo A4: no aterrizar
                // en una sección gateada si el usuario perdió el plan) se hace en el punto de uso
                // (app.js), no acá — ver initDashboard().
                homeSection: u.home_section || 'plan',
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

// ═══════════════════════════════════════════════════════════════════════════
//  BITÁCORA (F2.4) — GET /client/bitacora/seguidos
// ═══════════════════════════════════════════════════════════════════════════
// Consumida por `fetchBitacoraRuntimeInfo()` en main.js (F2.1, post-procesado
// de visores): devuelve la lista de expedientes que el usuario ya tiene en su
// Bitácora, para pintar el badge "📁 ya seguido" sin depender del backend en
// cada render — el visor la trae embebida (`window.BITACORA_RUNTIME.seguidos`)
// y compara client-side con `claveLigera()` (aproximación cosmética, no
// autoritativa — la deduplicación real la hace POST /usuarios/capture con
// `expedienteKey()`, decisión ya documentada en F2.1/P-F2.1-b).
//
// Contrato exacto que espera el visor (visorModal_template.html /
// visor_informes_template.html): un ARRAY PLANO de strings — el campo
// `expediente` tal cual está guardado, sin envolver en objetos — porque el
// cliente hace `.map(claveLigera)` directo sobre cada elemento.
//
// Gate de plan estricto (mismo `checkBitacoraPlan()` que el resto del módulo,
// sin la variante `conGracia`): main.js llama este endpoint en paralelo con
// `/client/account` vía `Promise.allSettled` y trata CUALQUIER rechazo (403
// incluido) como "seguidos: []" — un usuario sin el flag ya no ve la botonera
// en absoluto (por `enabled:false` de la otra llamada), así que este 403 nunca
// llega a importar en la práctica; se aplica igual por consistencia con el
// resto de `/bitacora/*` y para no filtrar la lista de expedientes de un
// usuario a un plan que no debería verla.
router.get('/bitacora/seguidos', authenticateToken, checkBitacoraPlan(), async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const { rows } = await db.query(
            'SELECT expediente FROM expedientes_seguidos WHERE user_id = $1',
            [userId]
        );
        res.json({ success: true, seguidos: rows.map(r => r.expediente) });
    } catch (error) {
        console.error('Error obteniendo expedientes seguidos (Bitácora):', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  BITÁCORA (B.3-A, fase E11) — POST /client/bitacora/capture-token
// ═══════════════════════════════════════════════════════════════════════════
// Emite la LLAVE DE CAPTURA que la app embebe en el visor al generarlo.
//
// De dónde viene: hasta la fase E8, el visor llevaba embebido
// `authManager.backendClient.token` — el JWT de LOGIN, 8 horas, acceso completo a
// la API — dentro de un archivo .html que queda en la carpeta de descargas y que
// el producto invita a compartir. E8 lo sacó (paso previo D de la spec: el visor
// dejó de llevar cualquier llave). Esta fase repone una llave, pero chica:
//
//     30 minutos · scope 'capture' · un solo uso · sirve para UN endpoint
//
// ⚠️ Se firma con `JWT_SECRET`, NO con un secreto propio. No es una comodidad:
// `authenticateToken` hace un ÚNICO `jwt.verify(token, JWT_SECRET)`, así que una
// llave firmada con otro secreto sale por el `catch` con 403 y el reclamo del
// borrador —lo único para lo que la llave existe— nunca funcionaría. Quien lo
// intente se va a topar con un 403 inexplicable y con la tentación de "arreglarlo"
// aflojando el middleware por el que pasa toda la autenticación del producto.
// El aislamiento no lo da el secreto: lo da el `scope` más el rechazo global de
// `authenticateToken` (ver ahí) más el habilitador único de
// `middleware/allowCaptureToken.js`.
//
// Gate estricto de plan, igual que el resto de `/bitacora/*`: sin Bitácora no hay
// captura que hacer. Y `authenticateToken` ya impide que una llave de captura
// fabrique otra (este endpoint no está en la allowlist), así que no se puede
// encadenar para extender su vida.
const CAPTURE_TOKEN_TTL_S = 30 * 60;   // 30 min — decisión (A) del operador, 2026-09-02

router.post('/bitacora/capture-token', authenticateToken, checkBitacoraPlan(), (req, res) => {
    try {
        const token = jwt.sign(
            {
                id: req.user.id,       // lo que lee todo el backend (`req.user.id`)
                sub: String(req.user.id),
                scope: 'capture',
                jti: crypto.randomUUID(),
            },
            process.env.JWT_SECRET,
            { expiresIn: CAPTURE_TOKEN_TTL_S }
        );
        res.json({ success: true, captureToken: token, expiresIn: CAPTURE_TOKEN_TTL_S });
    } catch (error) {
        console.error('Error emitiendo llave de captura (Bitácora):', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  BITÁCORA (F3.1) — GET /client/bitacora/pendientes
// ═══════════════════════════════════════════════════════════════════════════
// Cuenta rápida para el badge del botón "📔 Bitácora" del topbar de la app —
// consultada UNA vez al abrir, no en cada render. Deliberadamente NO reusa
// `/usuarios/api/bitacora/avisos` (F1.2): ese endpoint trae las filas completas
// de vencidos+próximos con JOIN a `expedientes_seguidos`, pensado para el
// banner del portal — acá solo hace falta un número, así que es una query
// mínima propia. Mismo criterio que "vencidos sin confirmar" del banner: sin
// límite de ventana hacia atrás, para que el badge refleje el total real
// pendiente de confirmar, no solo los últimos 7 días.
//
// Mismo gate estricto que el resto de `/bitacora/*`. Igual que F2.4, el 403
// nunca importa en la práctica: `cargarBitacoraPendientesCount()` en el
// renderer solo la llama si `account.bitacoraEnabled` ya vino `true`.
router.get('/bitacora/pendientes', authenticateToken, checkBitacoraPlan(), async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const { rows: [{ total }] } = await db.query(
            `SELECT count(*)::int AS total FROM bitacora_entries
              WHERE user_id = $1 AND done_at IS NULL
                AND due_at IS NOT NULL AND due_at < NOW()`,
            [userId]
        );
        res.json({ success: true, count: total });
    } catch (error) {
        console.error('Error obteniendo pendientes de Bitácora:', error);
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
        //
        // F9a (2026-08-31, V6-b): la rama `s.status = 'active'` NO exigía
        // `u.registration_status = 'active'` — a diferencia de /auth/extension-login, que
        // bloquea por registration_status ANTES de llegar a esta misma query (blockedExtStatuses).
        // Verificado con harness real: forzando registration_status='rejected' por SQL directo
        // (bypaseando la API — F10 ya cerró el único camino admin que producía esa combinación),
        // extension-auth seguía devolviendo 200 con un token todavía vigente. Se agrega el
        // chequeo explícito para no depender solo del invariante entre las 2 tablas.
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
                (s.status = 'active' AND u.registration_status = 'active')
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
    // H-BE-08 (auditoría 2026-09): antes esto tenía su propia copia del fetch a
    // GitHub —con el guard del JSON.parse y el timeout del fix B7 (2026-07-24), pero
    // SIN caché—, mientras routes/extension.js tenía la caché y no el guard. Las dos
    // mitades se unificaron en utils/githubRelease.js. La caché ahora es compartida
    // entre los dos endpoints, que es lo que importa: la API anónima de GitHub da 60
    // req/hora POR IP y esa IP es la misma que la de producción.
    try {
        const asset = await getLatestAsset();
        if (!asset) return res.status(404).json({ error: 'Instalador no disponible.' });
        res.redirect(asset.browser_download_url);
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener el instalador.' });
    }
});

module.exports = router;