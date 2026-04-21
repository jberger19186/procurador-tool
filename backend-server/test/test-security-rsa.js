/**
 * test-security-rsa.js
 * Tests de verificación para Firma Digital RSA + Checksums Multi-Etapa
 * 
 * USO:
 *   cd backend-server
 *   node generate-keys.js          (primero, generar claves)
 *   node test/test-security-rsa.js (ejecutar tests)
 * 
 * EJECUTAR DESDE: backend-server/
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════
// CONFIGURACIÓN DE PATHS
// ═══════════════════════════════════════
const BACKEND_DIR = path.join(__dirname, '..');
const ELECTRON_DIR = path.join(__dirname, '..', '..', 'electron-app');

// ═══════════════════════════════════════
// UTILIDADES DE TEST
// ═══════════════════════════════════════
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    testsRun++;
    try {
        fn();
        testsPassed++;
        console.log(`  ✅ PASS: ${name}`);
    } catch (error) {
        testsFailed++;
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     ${error.message}`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected "${expected}" but got "${actual}"`);
    }
}

// ═══════════════════════════════════════
// TEST 1: Generación y carga de claves RSA
// ═══════════════════════════════════════
function testRSAKeys() {
    console.log('\n🔑 TEST 1: Claves RSA');
    console.log('─────────────────────────────────');

    const keysDir = path.join(BACKEND_DIR, 'keys');

    test('Directorio keys/ existe', () => {
        assert(fs.existsSync(keysDir), `Directorio no encontrado: ${keysDir}. Ejecuta: node generate-keys.js`);
    });

    test('private.pem existe', () => {
        const keyPath = path.join(keysDir, 'private.pem');
        assert(fs.existsSync(keyPath), `Clave privada no encontrada: ${keyPath}`);
    });

    test('public.pem existe', () => {
        const keyPath = path.join(keysDir, 'public.pem');
        assert(fs.existsSync(keyPath), `Clave pública no encontrada: ${keyPath}`);
    });

    test('Claves RSA son válidas para firma/verificación', () => {
        const privateKey = fs.readFileSync(path.join(keysDir, 'private.pem'), 'utf8');
        const publicKey = fs.readFileSync(path.join(keysDir, 'public.pem'), 'utf8');

        const testData = 'test-data-for-rsa-verification';
        const signature = crypto.sign('sha256', Buffer.from(testData), privateKey);
        const isValid = crypto.verify('sha256', Buffer.from(testData), publicKey, signature);

        assert(isValid, 'La firma RSA no pudo ser verificada');
    });

    test('Clave pública está copiada en electron-app', () => {
        const electronKeyPath = path.join(ELECTRON_DIR, 'src', 'security', 'public.pem');
        if (!fs.existsSync(electronKeyPath)) {
            // Copiar automáticamente si no existe
            const sourceKey = path.join(keysDir, 'public.pem');
            const destDir = path.join(ELECTRON_DIR, 'src', 'security');
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(sourceKey, electronKeyPath);
            console.log(`     ℹ️  Clave pública copiada automáticamente a ${electronKeyPath}`);
        }
        assert(fs.existsSync(electronKeyPath), 'Clave pública no encontrada en electron-app');
    });
}

// ═══════════════════════════════════════
// TEST 2: ScriptSigner (Backend)
// ═══════════════════════════════════════
function testScriptSigner() {
    console.log('\n🔏 TEST 2: ScriptSigner (Backend)');
    console.log('─────────────────────────────────');

    const { ScriptSigner, getScriptSigner } = require(path.join(BACKEND_DIR, 'src', 'security', 'scriptSigner'));

    test('ScriptSigner se inicializa correctamente', () => {
        const signer = getScriptSigner();
        assert(signer.isReady(), 'ScriptSigner no está listo');
    });

    test('calculateChecksum retorna SHA-256 válido', () => {
        const signer = getScriptSigner();
        const checksum = signer.calculateChecksum('console.log("hello");');
        assert(checksum.length === 64, `Checksum debe tener 64 chars, tiene ${checksum.length}`);
        assert(/^[a-f0-9]+$/.test(checksum), 'Checksum debe ser hex');
    });

    test('signScript retorna estructura correcta', () => {
        const signer = getScriptSigner();
        const result = signer.signScript('console.log("test");');

        assert(result.checksum, 'Falta checksum');
        assert(result.signature, 'Falta signature');
        assert(result.signedAt, 'Falta signedAt');
        assert(result.checksum.length === 64, 'Checksum debe tener 64 chars');
        assert(result.signature.length > 0, 'Signature no debe estar vacía');
    });

    test('Firma es verificable con clave pública', () => {
        const signer = getScriptSigner();
        const content = 'const x = 42; module.exports = x;';
        const result = signer.signScript(content);
        const isValid = signer.verifySignature(result.checksum, result.signature);
        assert(isValid, 'La firma generada no pudo ser verificada');
    });

    test('Firma rechaza contenido alterado', () => {
        const signer = getScriptSigner();
        const result = signer.signScript('original content');
        
        // Intentar verificar con un checksum diferente
        const fakeChecksum = signer.calculateChecksum('modified content');
        const isValid = signer.verifySignature(fakeChecksum, result.signature);
        assert(!isValid, 'La firma debería fallar con contenido alterado');
    });
}

// ═══════════════════════════════════════
// TEST 3: SignatureCache (Backend)
// ═══════════════════════════════════════
function testSignatureCache() {
    console.log('\n📦 TEST 3: SignatureCache (Backend)');
    console.log('─────────────────────────────────');

    const { SignatureCache } = require(path.join(BACKEND_DIR, 'src', 'security', 'signatureCache'));

    test('SignatureCache se inicializa', () => {
        const cache = new SignatureCache({ ttl: 60000, maxSize: 10 });
        assert(cache, 'Cache no se inicializó');
        cache.destroy();
    });

    test('getOrCalculate retorna firma y la cachea', () => {
        const cache = new SignatureCache({ ttl: 60000, maxSize: 10 });
        const content = 'console.log("cached test");';

        const result1 = cache.getOrCalculate('test.js', content);
        assert(result1.checksum, 'Primer resultado debe tener checksum');
        assert(result1.fromCache === false, 'Primer resultado NO debe ser de caché');

        const result2 = cache.getOrCalculate('test.js', content);
        assert(result2.fromCache === true, 'Segundo resultado debe ser de caché');
        assertEqual(result1.checksum, result2.checksum, 'Checksums deben coincidir');

        cache.destroy();
    });

    test('Cache se invalida cuando cambia el contenido', () => {
        const cache = new SignatureCache({ ttl: 60000, maxSize: 10 });

        const result1 = cache.getOrCalculate('mutable.js', 'version 1');
        const result2 = cache.getOrCalculate('mutable.js', 'version 2');

        assert(result2.fromCache === false, 'Contenido modificado no debe usar caché');
        assert(result1.checksum !== result2.checksum, 'Checksums deben ser diferentes');

        cache.destroy();
    });

    test('Stats se actualizan correctamente', () => {
        const cache = new SignatureCache({ ttl: 60000, maxSize: 10 });

        cache.getOrCalculate('s1.js', 'a');
        cache.getOrCalculate('s1.js', 'a'); // hit
        cache.getOrCalculate('s2.js', 'b');
        cache.getOrCalculate('s2.js', 'c'); // invalidación

        const stats = cache.getStats();
        assertEqual(stats.hits, 1, `Hits esperados: 1, obtenidos: ${stats.hits}`);
        assertEqual(stats.misses, 3, `Misses esperados: 3, obtenidos: ${stats.misses}`);

        cache.destroy();
    });
}

// ═══════════════════════════════════════
// TEST 4: ScriptVerifier (Electron)
// ═══════════════════════════════════════
function testScriptVerifier() {
    console.log('\n🔍 TEST 4: ScriptVerifier (Electron)');
    console.log('─────────────────────────────────');

    const { ScriptVerifier, SignatureVerificationError, ChecksumMismatchError } = 
        require(path.join(ELECTRON_DIR, 'src', 'security', 'scriptVerifier'));

    const verifier = new ScriptVerifier();

    test('ScriptVerifier se inicializa con clave pública', () => {
        assert(verifier.isReady(), 'ScriptVerifier debe estar listo si la clave pública existe');
    });

    test('calculateChecksum es consistente con backend', () => {
        const { getScriptSigner } = require(path.join(BACKEND_DIR, 'src', 'security', 'scriptSigner'));
        const signer = getScriptSigner();

        const content = 'shared content for checksum test';
        const backendChecksum = signer.calculateChecksum(content);
        const electronChecksum = verifier.calculateChecksum(content);

        assertEqual(backendChecksum, electronChecksum, 
            'Checksums deben coincidir entre backend y electron');
    });

    test('verifySignature acepta firma válida del backend', () => {
        const { getScriptSigner } = require(path.join(BACKEND_DIR, 'src', 'security', 'scriptSigner'));
        const signer = getScriptSigner();

        const content = 'valid script content here';
        const signResult = signer.signScript(content);

        const isValid = verifier.verifySignature(
            signResult.checksum,
            signResult.signature,
            'test-valid.js'
        );

        assert(isValid, 'Firma válida debe ser aceptada');
    });

    test('verifySignature rechaza firma manipulada', () => {
        const { getScriptSigner } = require(path.join(BACKEND_DIR, 'src', 'security', 'scriptSigner'));
        const signer = getScriptSigner();

        const signResult = signer.signScript('original content');

        try {
            // Usar checksum de contenido diferente con la firma original
            const fakeChecksum = verifier.calculateChecksum('tampered content');
            verifier.verifySignature(fakeChecksum, signResult.signature, 'tampered.js');
            assert(false, 'Debería haber lanzado SignatureVerificationError');
        } catch (error) {
            assert(error instanceof SignatureVerificationError, 
                `Error debe ser SignatureVerificationError, es: ${error.constructor.name}`);
        }
    });

    test('verifyMultiStage funciona en 3 etapas', () => {
        const content = 'multi-stage verified script';
        const checksum = verifier.calculateChecksum(content);

        // Etapa 1: Post-desencripción
        const stage1 = verifier.verifyMultiStage('multi.js', 1, content, checksum);
        assert(stage1.valid, 'Etapa 1 debe ser válida');

        // Etapa 2: Pre-escritura
        const stage2 = verifier.verifyMultiStage('multi.js', 2, content);
        assert(stage2.valid, 'Etapa 2 debe ser válida');

        // Etapa 3: Pre-ejecución
        const stage3 = verifier.verifyMultiStage('multi.js', 3, content);
        assert(stage3.valid, 'Etapa 3 debe ser válida');
    });

    test('verifyMultiStage detecta modificación entre etapas', () => {
        const content = 'stage test content';
        const checksum = verifier.calculateChecksum(content);

        // Etapa 1 OK
        verifier.verifyMultiStage('tamper-test.js', 1, content, checksum);

        // Etapa 2 con contenido diferente → debe fallar
        try {
            verifier.verifyMultiStage('tamper-test.js', 2, 'tampered content');
            assert(false, 'Debería haber lanzado ChecksumMismatchError');
        } catch (error) {
            assert(error instanceof ChecksumMismatchError,
                `Error debe ser ChecksumMismatchError, es: ${error.constructor.name}`);
            assertEqual(error.stage, 2, `Stage debe ser 2, es: ${error.stage}`);
        }
    });

    test('verifyFull combina firma + checksum correctamente', () => {
        const { getScriptSigner } = require(path.join(BACKEND_DIR, 'src', 'security', 'scriptSigner'));
        const signer = getScriptSigner();

        const content = 'fully verified script content';
        const metadata = signer.signScript(content);

        const result = verifier.verifyFull('full-test.js', content, metadata);
        assert(result.signatureValid, 'Firma debe ser válida');
        assert(result.checksumValid, 'Checksum debe ser válido');
    });
}

// ═══════════════════════════════════════
// TEST 5: SecurityAudit (Electron)
// ═══════════════════════════════════════
function testSecurityAudit() {
    console.log('\n📋 TEST 5: SecurityAudit (Electron)');
    console.log('─────────────────────────────────');

    const SecurityAudit = require(path.join(ELECTRON_DIR, 'src', 'telemetry', 'securityAudit'));

    const tempLogDir = path.join(__dirname, 'temp-audit-logs');
    const audit = new SecurityAudit({ logDir: tempLogDir });

    test('SecurityAudit se inicializa', () => {
        assert(audit, 'Audit debe inicializarse');
        assert(audit.sessionId, 'Debe tener sessionId');
    });

    test('logScriptVerified registra evento', () => {
        const event = audit.logScriptVerified('test.js', { checksum: 'abc123' });
        assert(event.type === 'script_verified', 'Tipo debe ser script_verified');
        assert(event.scriptName === 'test.js', 'scriptName debe coincidir');
    });

    test('logSignatureFailed registra evento crítico', () => {
        const event = audit.logSignatureFailed('bad.js', { error: 'Firma inválida' });
        assert(event.type === 'signature_failed', 'Tipo debe ser signature_failed');
        assert(event.severity === 'CRITICAL', 'Severity debe ser CRITICAL');
    });

    test('logChecksumMismatch registra etapa', () => {
        const event = audit.logChecksumMismatch('mismatch.js', 2, {
            expected: 'aaa',
            actual: 'bbb'
        });
        assert(event.stage === 2, 'Stage debe ser 2');
        assert(event.severity === 'CRITICAL', 'Severity debe ser CRITICAL');
    });

    test('Contadores se actualizan correctamente', () => {
        const counters = audit.getCounters();
        assertEqual(counters.script_verified, 1, `script_verified esperado: 1, obtenido: ${counters.script_verified}`);
        assertEqual(counters.signature_failed, 1, `signature_failed esperado: 1, obtenido: ${counters.signature_failed}`);
        assertEqual(counters.checksum_mismatch, 1, `checksum_mismatch esperado: 1, obtenido: ${counters.checksum_mismatch}`);
    });

    test('getSummary retorna resumen correcto', () => {
        const summary = audit.getSummary();
        assert(summary.totalEvents >= 3, `Debe haber al menos 3 eventos, hay: ${summary.totalEvents}`);
        assert(summary.criticalCount >= 2, `Debe haber al menos 2 críticos, hay: ${summary.criticalCount}`);
    });

    test('Eventos se persisten en disco', () => {
        const logFiles = fs.existsSync(tempLogDir) 
            ? fs.readdirSync(tempLogDir).filter(f => f.endsWith('.jsonl'))
            : [];
        assert(logFiles.length > 0, 'Debe existir al menos un archivo de log');
        
        const logContent = fs.readFileSync(path.join(tempLogDir, logFiles[0]), 'utf8');
        assert(logContent.length > 0, 'Archivo de log no debe estar vacío');
    });

    // Limpiar logs temporales
    try {
        fs.rmSync(tempLogDir, { recursive: true, force: true });
    } catch (e) {}
}

// ═══════════════════════════════════════
// EJECUTAR TODOS LOS TESTS
// ═══════════════════════════════════════
console.log('═══════════════════════════════════════════════');
console.log('🧪 TESTS DE SEGURIDAD: RSA + Checksums Multi-Etapa');
console.log('═══════════════════════════════════════════════');

try {
    testRSAKeys();
    testScriptSigner();
    testSignatureCache();
    testScriptVerifier();
    testSecurityAudit();
} catch (error) {
    console.error('\n💥 Error fatal en tests:', error);
}

console.log('\n═══════════════════════════════════════════════');
console.log(`📊 RESULTADOS: ${testsPassed}/${testsRun} pasaron | ${testsFailed} fallaron`);
console.log('═══════════════════════════════════════════════');

if (testsFailed > 0) {
    console.log('\n❌ Hay tests fallidos. Revisa los errores arriba.');
    process.exit(1);
} else {
    console.log('\n✅ Todos los tests pasaron correctamente.');
    process.exit(0);
}
