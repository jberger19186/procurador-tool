require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
let authToken = null;

// Colores para consola
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// 1. Registrar usuario de prueba
async function registerUser() {
    try {
        log('\n📝 1. Registrando usuario de prueba...', 'cyan');
        const response = await axios.post(`${BASE_URL}/auth/register`, {
            email: 'test@example.com',
            password: 'Test123456!'
        });
        log('✅ Usuario registrado', 'green');
        return response.data;
    } catch (error) {
        if (error.response?.data?.error === 'Email ya registrado') {
            log('⚠️ Usuario ya existe, continuando...', 'yellow');
            return null;
        }
        throw error;
    }
}

// 2. Login
async function login() {
    try {
        log('\n🔐 2. Haciendo login...', 'cyan');
        const response = await axios.post(`${BASE_URL}/auth/login`, {
            email: 'test@example.com',
            password: 'Test123456!',
            machineId: 'TEST-MACHINE-001'
        });
        authToken = response.data.token;
        log('✅ Login exitoso', 'green');
        log(`Token: ${authToken.substring(0, 20)}...`, 'blue');
        return response.data;
    } catch (error) {
        log(`❌ Error en login: ${error.response?.data?.error}`, 'red');
        throw error;
    }
}

// 3. Crear suscripción (requiere usuario admin)
async function createSubscription(userId) {
    try {
        log('\n💳 3. Creando suscripción PRO...', 'cyan');
        // Nota: Este endpoint requiere token de admin
        // Por ahora, crear manualmente en BD:
        log('⚠️ Ejecuta manualmente en PostgreSQL:', 'yellow');
        log(`
INSERT INTO subscriptions (user_id, plan, status, expires_at, usage_limit)
VALUES (${userId}, 'PRO', 'active', NOW() + INTERVAL '30 days', 1000)
ON CONFLICT (user_id) DO UPDATE
SET plan = 'PRO', status = 'active', expires_at = NOW() + INTERVAL '30 days', usage_limit = 1000;
        `, 'blue');
    } catch (error) {
        log(`❌ Error: ${error.message}`, 'red');
    }
}

// 4. Ejecutar script (primera vez - MISS)
async function executeScript(scriptName, params = {}) {
    try {
        const startTime = Date.now();
        const response = await axios.post(
            `${BASE_URL}/scripts/execute`,
            { scriptName, params },
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        const duration = Date.now() - startTime;

        log(`✅ Script ejecutado en ${duration}ms`, 'green');
        log(`Decrypt time: ${response.data.metrics.decryptTime}`, 'blue');
        return { response: response.data, duration };
    } catch (error) {
        log(`❌ Error: ${error.response?.data?.error}`, 'red');
        throw error;
    }
}

// 5. Test de caché
async function testCache() {
    log('\n🧪 4. Testing sistema de caché...', 'cyan');
    log('═'.repeat(60), 'cyan');

    const scriptsToTest = [
        { name: 'testM1.js', params: { test: 'cache-test-1' } },
        { name: 'testM2.js', params: { iterations: 5 } },
        { name: 'procesarNovedadesCompleto.js', params: { expediente: 'EXP-TEST/2026' } }
    ];

    for (const script of scriptsToTest) {
        log(`\n📄 Testeando: ${script.name}`, 'yellow');

        // Primera ejecución (CACHE MISS)
        log('  🔸 Primera ejecución (CACHE MISS esperado)...', 'blue');
        const result1 = await executeScript(script.name, script.params);

        // Segunda ejecución (CACHE HIT)
        log('  🔸 Segunda ejecución (CACHE HIT esperado)...', 'blue');
        const result2 = await executeScript(script.name, script.params);

        // Tercera ejecución (CACHE HIT)
        log('  🔸 Tercera ejecución (CACHE HIT esperado)...', 'blue');
        const result3 = await executeScript(script.name, script.params);

        // Comparar tiempos
        const improvement = ((result1.duration - result2.duration) / result1.duration * 100).toFixed(2);
        log(`\n  📊 Mejora de rendimiento: ${improvement}%`, 'green');
        log(`     1ra ejecución: ${result1.duration}ms`, 'blue');
        log(`     2da ejecución: ${result2.duration}ms`, 'blue');
        log(`     3ra ejecución: ${result3.duration}ms`, 'blue');
    }
}

// 6. Ver estadísticas de caché
async function getCacheStats() {
    try {
        log('\n📊 5. Obteniendo estadísticas de caché...', 'cyan');
        const response = await axios.get(`${BASE_URL}/health`);

        const { cache } = response.data;
        log('\n' + '═'.repeat(60), 'cyan');
        log('ESTADÍSTICAS DEL CACHÉ', 'cyan');
        log('═'.repeat(60), 'cyan');
        log(`Scripts en caché: ${cache.size}/${cache.maxSize}`, 'blue');
        log(`Memoria usada: ${cache.totalMB} MB`, 'blue');
        log(`Cache Hits: ${cache.hits}`, 'green');
        log(`Cache Misses: ${cache.misses}`, 'yellow');
        log(`Hit Rate: ${cache.hitRate}`, 'green');
        log('═'.repeat(60), 'cyan');

        if (cache.scripts.length > 0) {
            log('\nScripts cacheados:', 'yellow');
            cache.scripts.forEach(script => {
                const ageSec = (script.age / 1000).toFixed(1);
                const ttlMin = (script.ttl / 1000 / 60).toFixed(1);
                log(`  • ${script.key}`, 'blue');
                log(`    Edad: ${ageSec}s | TTL restante: ${ttlMin}min | Tamaño: ${script.size} bytes`, 'blue');
            });
        }

        return response.data;
    } catch (error) {
        log(`❌ Error obteniendo stats: ${error.message}`, 'red');
    }
}

// 7. Test de carga
async function loadTest(iterations = 20) {
    log(`\n🔥 6. Test de carga (${iterations} ejecuciones)...`, 'cyan');
    log('═'.repeat(60), 'cyan');

    const results = [];
    const scriptName = 'testM1.js';

    for (let i = 1; i <= iterations; i++) {
        process.stdout.write(`\rEjecutando ${i}/${iterations}...`);
        const result = await executeScript(scriptName, { iteration: i });
        results.push(result.duration);
    }

    console.log(''); // Nueva línea

    const avg = (results.reduce((a, b) => a + b, 0) / results.length).toFixed(2);
    const min = Math.min(...results);
    const max = Math.max(...results);

    log(`\n📊 Resultados del test de carga:`, 'green');
    log(`   Promedio: ${avg}ms`, 'blue');
    log(`   Mínimo: ${min}ms`, 'blue');
    log(`   Máximo: ${max}ms`, 'blue');
}

// Main
async function runTests() {
    try {
        log('🚀 INICIANDO TESTS DEL SISTEMA DE CACHÉ', 'cyan');
        log('═'.repeat(60), 'cyan');

        await registerUser();
        const loginData = await login();

        if (loginData.user) {
            await createSubscription(loginData.user.id);
        }

        log('\n⏳ Esperando que configures la suscripción en BD...', 'yellow');
        log('Presiona ENTER cuando esté lista...', 'yellow');

        await new Promise(resolve => {
            process.stdin.once('data', resolve);
        });

        await testCache();
        await getCacheStats();
        await loadTest(20);

        log('\n✅ TESTS COMPLETADOS', 'green');
        log('═'.repeat(60), 'cyan');

    } catch (error) {
        log(`\n❌ Error en tests: ${error.message}`, 'red');
        if (error.response) {
            log(`Respuesta: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
        }
    }
}

// Ejecutar
runTests();