/**
 * generate-keys.js
 * Genera par de claves RSA-2048 para firma digital de scripts
 * 
 * USO:
 *   node generate-keys.js
 * 
 * GENERA:
 *   - backend-server/keys/private.pem  (clave privada - NUNCA compartir)
 *   - backend-server/keys/public.pem   (clave pública - embebir en Electron)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

function generateKeys() {
    console.log('═══════════════════════════════════════════════');
    console.log('🔐 GENERADOR DE CLAVES RSA-2048');
    console.log('═══════════════════════════════════════════════\n');

    // Crear directorio si no existe
    if (!fs.existsSync(KEYS_DIR)) {
        fs.mkdirSync(KEYS_DIR, { recursive: true });
        console.log(`📁 Directorio creado: ${KEYS_DIR}`);
    }

    // Verificar si ya existen claves
    if (fs.existsSync(PRIVATE_KEY_PATH) || fs.existsSync(PUBLIC_KEY_PATH)) {
        console.log('⚠️  Ya existen claves en el directorio keys/');
        console.log('   Si deseas regenerar, elimina los archivos existentes primero.');
        console.log(`   - ${PRIVATE_KEY_PATH}`);
        console.log(`   - ${PUBLIC_KEY_PATH}`);
        
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('\n¿Deseas sobrescribir las claves existentes? (s/N): ', (answer) => {
                rl.close();
                if (answer.toLowerCase() === 's') {
                    doGenerate();
                } else {
                    console.log('❌ Operación cancelada');
                }
                resolve();
            });
        });
    } else {
        doGenerate();
        return Promise.resolve();
    }
}

function doGenerate() {
    console.log('\n🔄 Generando par de claves RSA-2048...\n');

    const startTime = Date.now();

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    const genTime = Date.now() - startTime;

    // Guardar claves
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, 'utf8');
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf8');

    // Verificar que las claves funcionan correctamente
    const testData = 'test-signature-verification';
    const testSignature = crypto.sign('sha256', Buffer.from(testData), privateKey);
    const isValid = crypto.verify('sha256', Buffer.from(testData), publicKey, testSignature);

    console.log('✅ Claves generadas exitosamente');
    console.log(`   ⏱️  Tiempo de generación: ${genTime}ms`);
    console.log(`   📄 Clave privada: ${PRIVATE_KEY_PATH}`);
    console.log(`   📄 Clave pública: ${PUBLIC_KEY_PATH}`);
    console.log(`   🔍 Verificación: ${isValid ? '✅ PASS' : '❌ FAIL'}`);

    console.log('\n═══════════════════════════════════════════════');
    console.log('📋 PRÓXIMOS PASOS:');
    console.log('═══════════════════════════════════════════════');
    console.log('1. La clave PRIVADA se queda en el backend (keys/private.pem)');
    console.log('2. Copiar la clave PÚBLICA al proyecto Electron:');
    console.log(`   cp ${PUBLIC_KEY_PATH} ../electron-app/src/security/public.pem`);
    console.log('3. NUNCA incluir la clave privada en el repositorio');
    console.log('4. Agregar "keys/private.pem" a .gitignore');
    console.log('═══════════════════════════════════════════════\n');

    // Mostrar la clave pública para copiar fácilmente
    console.log('🔑 CLAVE PÚBLICA (para embebir en Electron):');
    console.log('─────────────────────────────────────────────');
    console.log(publicKey);

    // Copiar automáticamente al directorio de Electron si existe
    const electronSecurityDir = path.join(__dirname, '..', 'electron-app', 'src', 'security');
    if (fs.existsSync(electronSecurityDir)) {
        const electronPublicKeyPath = path.join(electronSecurityDir, 'public.pem');
        fs.copyFileSync(PUBLIC_KEY_PATH, electronPublicKeyPath);
        console.log(`✅ Clave pública copiada automáticamente a: ${electronPublicKeyPath}`);
    } else {
        console.log(`⚠️  Directorio Electron no encontrado en: ${electronSecurityDir}`);
        console.log('   Copia manualmente la clave pública al proyecto Electron.');
    }
}

generateKeys().catch(console.error);
