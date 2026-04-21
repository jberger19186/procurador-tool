const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDecryptedScript } = require('../utils/scriptEncryption');
const vm = require('vm');
const { scriptExecutionLimiter } = require('../middleware/rateLimiter');

// Middleware de autenticación
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado' });
        }
        req.user = user;
        next();
    });
}

// Ejecutar script
router.post('/execute', authenticateToken, scriptExecutionLimiter, async (req, res) => {
    const { scriptName, params } = req.body;
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        // Verificar suscripción
        const subResult = await db.query(`
            SELECT * FROM subscriptions
            WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
        `, [userId]);

        if (subResult.rows.length === 0) {
            return res.status(403).json({
                error: 'No tienes una suscripción activa',
                action: 'subscribe'
            });
        }

        const subscription = subResult.rows[0];

        // Verificar límite de uso
        if (subscription.usage_count >= subscription.usage_limit) {
            return res.status(403).json({
                error: 'Has alcanzado el límite de ejecuciones',
                action: 'upgrade'
            });
        }

        // Obtener script desencriptado (con caché)
        console.log(`🔓 Obteniendo script ${scriptName} (con caché)`);
        const startTime = Date.now();
        const code = await getDecryptedScript(db, scriptName);
        const decryptTime = Date.now() - startTime;
        console.log(`⏱️ Tiempo de desencriptación: ${decryptTime}ms`);

        // Ejecutar script en sandbox con soporte para module.exports
        const sandbox = {
            console,
            params,
            require,
            Buffer,
            setTimeout,
            setInterval,
            clearTimeout,
            clearInterval,
            Promise,
            module: { exports: {} },  // Soporte para module.exports
            exports: {}                // Soporte para exports
        };

        const context = vm.createContext(sandbox);
        const script = new vm.Script(code);

        // Ejecutar script
        const scriptStartTime = Date.now();
        let scriptResult = script.runInContext(context, {
            timeout: 30000, // 30 segundos timeout
            displayErrors: true
        });
        const scriptExecutionTime = Date.now() - scriptStartTime;

        // Manejar diferentes formatos de script
        let result;

        // Si el script retorna una Promise (función async autoejecutable)
        if (scriptResult && typeof scriptResult.then === 'function') {
            result = await scriptResult;
        }
        // Si el script exportó una función con module.exports
        else if (typeof sandbox.module.exports === 'function') {
            result = await sandbox.module.exports(params);
        }
        // Si el script exportó un objeto directamente
        else if (sandbox.module.exports && typeof sandbox.module.exports === 'object') {
            result = sandbox.module.exports;
        }
        // Si el script retornó un valor directamente
        else {
            result = scriptResult;
        }

        // Incrementar contador de uso
        await db.query(`
            UPDATE subscriptions
            SET usage_count = usage_count + 1
            WHERE user_id = $1
        `, [userId]);

        // Registrar ejecución exitosa
        await db.query(`
            INSERT INTO usage_logs (user_id, script_name, success)
            VALUES ($1, $2, true)
        `, [userId, scriptName]);

        res.json({
            success: true,
            result,
            metrics: {
                decryptTime: `${decryptTime}ms`,
                executionTime: `${scriptExecutionTime}ms`,
                totalTime: `${Date.now() - startTime}ms`,
                usageCount: subscription.usage_count + 1,
                usageLimit: subscription.usage_limit
            }
        });

    } catch (error) {
        console.error('Error ejecutando script:', error);

        // Registrar error
        try {
            await db.query(`
                INSERT INTO usage_logs (user_id, script_name, success, error_message)
                VALUES ($1, $2, false, $3)
            `, [userId, scriptName, error.message]);
        } catch (logError) {
            console.error('Error registrando log:', logError);
        }

        res.status(500).json({
            error: 'Error ejecutando script',
            details: error.message
        });
    }
});

// Listar scripts disponibles
router.get('/list', authenticateToken, async (req, res) => {
    const db = req.app.get('db');

    try {
        const result = await db.query(`
            SELECT script_name, version, created_at, updated_at
            FROM encrypted_scripts
            WHERE active = true
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

module.exports = router;