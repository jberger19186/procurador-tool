/**
 * Prueba del prototipo contra los 13 scripts distribuibles reales.
 *
 * Corre dos veces: con marcado (debe dar 0 rotos) y sin marcar (control negativo: debe
 * detectar los archivos que romperían). El control negativo NO es decorativo — la primera
 * versión del verificador daba "OK" siempre, y solo se descubrió al exigirle que fallara.
 *
 * Uso (desde esta carpeta), con NODE_PATH apuntando a un node_modules que tenga
 * acorn y javascript-obfuscator:
 *
 *   NODE_PATH=/ruta/a/electron-app/node_modules node probar.js
 */

const fs = require('fs');
const path = require('path');
const { marcar, verificar, callbacksDePagina, CONFIG } = require('../utils/obfuscation');
const JavaScriptObfuscator = require('javascript-obfuscator');

const DIR = process.env.SCRIPTS_DIR
    || path.join(__dirname, '..', 'scripts');

const DISTRIBUIBLES = [
    'testM1.js', 'testM2.js', 'consultarscwpjn.js', 'listarSCWPJN.js',
    'procesarNovedadesCompleto.js', 'procesarCustomExpedientes.js', 'informequickscwpjn.js',
    'procesarMonitoreo.js', 'sessionManager.js', 'errorHandler.js', 'cerrarNavegador.js',
    'monitoreo.js', 'buscarPorParteScwpjn.js'
];

let fallaLaPrueba = false;

for (const [titulo, conMarcado, esperado] of [
    ['CON MARCADO AUTOMATICO', true, 0],
    ['SIN MARCAR (control negativo)', false, 6]
]) {
    console.log('===== ' + titulo + ' =====');
    let rotos = 0;
    for (const archivo of DISTRIBUIBLES) {
        const fuente = fs.readFileSync(path.join(DIR, archivo), 'utf8');
        const entrada = conMarcado ? marcar(fuente).codigo : fuente;
        const ofuscado = JavaScriptObfuscator.obfuscate(entrada, CONFIG).getObfuscatedCode();
        const problemas = verificar(ofuscado);
        if (problemas.length) rotos++;
        console.log((problemas.length ? '  ROTO ' : '  OK   ') + archivo.padEnd(30)
            + 'callbacks:' + String(callbacksDePagina(fuente).length).padStart(3)
            + '  funciones de pagina rotas:' + String(problemas.length).padStart(3)
            + (problemas.length ? ('  ej: ' + problemas[0].slice(0, 3).join(', ')) : ''));
    }
    const ok = rotos === esperado;
    if (!ok) fallaLaPrueba = true;
    console.log('  --> ' + rotos + '/' + DISTRIBUIBLES.length + ' archivos rotos'
        + ' (esperado ' + esperado + ') ' + (ok ? 'OK' : 'LA PRUEBA FALLA') + '\n');
}

process.exit(fallaLaPrueba ? 1 : 0);
