/**
 * Test de seguridad - Validar implementación
 */

const CodeObfuscator = require('../src/security/codeObfuscator');
const SecureTempFolder = require('../src/security/secureTempFolder');
const ScriptAutoDestruct = require('../src/security/scriptAutoDestruct');

async function testOfuscacion() {
    console.log('🧪 TEST 1: Ofuscación de código');

    const obfuscator = new CodeObfuscator();
    const sampleCode = `
        function processData(data) {
            const result = [];
            for (let i = 0; i < data.length; i++) {
                result.push(data[i] * 2);
            }
            return result;
        }
        console.log(processData([1, 2, 3, 4, 5]));
    `;

    const obfuscated = obfuscator.obfuscate(sampleCode, 'test.js');

    console.log('✅ Código original:', sampleCode.length, 'chars');
    console.log('✅ Código ofuscado:', obfuscated.length, 'chars');
    console.log('✅ Reducción:', ((sampleCode.length - obfuscated.length) / sampleCode.length * 100).toFixed(1) + '%');

    // Verificar que el código ofuscado es ejecutable
    try {
        eval(obfuscated);
        console.log('✅ Código ofuscado es ejecutable');
    } catch (error) {
        console.error('❌ Error ejecutando código ofuscado:', error);
    }

    console.log('');
}

async function testSecureTempFolder() {
    console.log('🧪 TEST 2: Carpeta temporal segura');

    const stf = new SecureTempFolder();
    const folder1 = await stf.createSecureFolder();
    const folder2 = await stf.createSecureFolder();

    console.log('✅ Carpeta 1:', folder1);
    console.log('✅ Carpeta 2:', folder2);
    console.log('✅ Carpetas activas:', stf.activeFolders.size);

    // Esperar 2 segundos
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Limpiar
    await stf.cleanupAll();
    console.log('✅ Carpetas limpiadas');
    console.log('');
}

async function testAutoDestruct() {
    console.log('🧪 TEST 3: Auto-destrucción');

    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const autoDestruct = new ScriptAutoDestruct();

    // Crear archivo temporal
    const testFile = path.join(os.tmpdir(), 'test-script.js');
    fs.writeFileSync(testFile, 'console.log("test");');

    console.log('✅ Archivo creado:', testFile);
    console.log('✅ Existe:', fs.existsSync(testFile));

    // Programar destrucción
    autoDestruct.scheduleDestruction(testFile, 1000);

    console.log('✅ Destrucción programada para 1 segundo');

    // Esperar 1.5 segundos
    await new Promise(resolve => setTimeout(resolve, 1500));

    console.log('✅ Archivo existe después de destrucción:', fs.existsSync(testFile));
    console.log('');
}

async function runTests() {
    console.log('═══════════════════════════════════════');
    console.log('🧪 INICIANDO TESTS DE SEGURIDAD');
    console.log('═══════════════════════════════════════\n');

    await testOfuscacion();
    await testSecureTempFolder();
    await testAutoDestruct();

    console.log('═══════════════════════════════════════');
    console.log('✅ TESTS COMPLETADOS');
    console.log('═══════════════════════════════════════');
}

runTests().catch(console.error);