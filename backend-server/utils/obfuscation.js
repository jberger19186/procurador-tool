/**
 * Ofuscación de scripts compatible con Puppeteer — C.1 capa 1.
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * --------------------------
 * El intento anterior de ofuscar los scripts rompió su ejecución. La causa no es el
 * ofuscador: es que page.evaluate(fn) NO ejecuta fn en Node. Puppeteer la serializa con
 * Function.prototype.toString() y la inyecta en el navegador. Con stringArray: true el
 * ofuscador reemplaza cada literal por una llamada al decodificador del array
 * (_0x41bb17(0x1df)), que vive en el ámbito del módulo Node. En el navegador ese
 * identificador no existe:
 *
 *     ReferenceError: _0x556449 is not defined
 *
 * La regla, entonces: toda función que viaja al navegador tiene que quedar cerrada sobre
 * sí misma. Ninguna transformación puede introducirle una referencia externa.
 *
 * CÓMO LO RESUELVE
 * ----------------
 *  1. marcar()    — encuentra por AST los callbacks que viajan al navegador y los envuelve
 *                   en las directivas javascript-obfuscator:disable/enable. Automático: los
 *                   scripts fuente NO se tocan, así que nadie puede olvidarse de marcar uno
 *                   nuevo, ni dejar un bloque sin cerrar (falla silenciosa hacia "menos
 *                   protección", que es la peor de todas porque no se nota).
 *  2. ofuscar     — configuración FUERTE (stringArray al 100 %, control flow flattening,
 *                   dead code injection) sobre todo lo demás.
 *  3. verificar() — fail-closed. Sobre el código ya ofuscado busca toda función que use
 *                   document/window en su propio cuerpo y comprueba que no le quedaron
 *                   identificadores libres fuera de los globales del navegador. Si aparece
 *                   un _0x…, ese script rompería: se aborta antes de escribir en la base.
 *
 * MEDIDO SOBRE LOS 13 SCRIPTS DISTRIBUIBLES (copia del 2026-09-02, HEAD f81f202):
 *   - 95 callbacks marcados; 485 de 7925 líneas quedan sin ofuscar = 6 %.
 *   - Con marcado: 0/13 archivos con funciones de página rotas.
 *   - Sin marcar (control negativo): 6/13 rotos, y el verificador los detecta a los 6.
 *   - Los 6 scripts sin un solo page.evaluate (consultarscwpjn, procesarCustomExpedientes,
 *     procesarMonitoreo, sessionManager, errorHandler, cerrarNavegador) se ofuscan enteros.
 *
 * Lo que queda legible es lógica de DOM del sitio del PJN (selectores CSS, XPath): lo mismo
 * que cualquiera ve abriendo las devtools en scw.pjn.gov.ar. Lo que se oculta es la
 * orquestación: sesión, reintentos, endpoints, parsing, flujo.
 *
 * Probado también dentro de vm.runInNewContext con el contexto limitado que arma
 * fileEncryption.createWrapperScript (fileEncryption.js:120-133): el vm no es el problema,
 * las tres configuraciones probadas cargan bien ahí. El único punto de rotura es evaluate.
 */

const acorn = require('acorn');
const JavaScriptObfuscator = require('javascript-obfuscator');

// Métodos de Puppeteer cuyo argumento función se serializa y corre en el navegador.
const METODOS_DE_PAGINA = new Set([
    'evaluate', 'evaluateHandle', 'evaluateOnNewDocument',
    'waitForFunction', '$$eval', '$eval'
]);

// Configuración fuerte. Verificada contra los 13 scripts distribuibles.
// NO agregar selfDefending ni debugProtection: el primero es frágil bajo el wrapper de
// vm.runInNewContext, el segundo inutiliza la consola de diagnóstico del operador.
const CONFIG = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    identifierNamesGenerator: 'hexadecimal',
    numbersToExpressions: false,
    renameGlobals: false,          // los scripts se require()n entre sí
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 1,
    target: 'node',
    // Seed fijo por versión: el mismo fuente produce el mismo ofuscado, y por lo tanto el
    // mismo hash en encrypted_scripts. Sin esto, cada reencrypt invalidaría la caché de
    // todos los clientes aunque no haya cambiado una línea.
    seed: 20260903
};

const GLOBALES_DEL_NAVEGADOR = new Set([
    'document', 'window', 'navigator', 'location', 'history', 'screen', 'console',
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp',
    'Promise', 'Map', 'Set', 'WeakMap', 'Symbol', 'Error', 'TypeError', 'Function',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'undefined', 'NaN', 'Infinity',
    'XPathResult', 'Node', 'NodeList', 'NodeFilter', 'Element', 'HTMLElement',
    'MutationObserver', 'getComputedStyle', 'encodeURIComponent', 'decodeURIComponent',
    'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'fetch', 'XMLHttpRequest', 'Event', 'CustomEvent', 'FormData', 'URL', 'URLSearchParams',
    'atob', 'btoa', 'requestAnimationFrame', 'arguments', 'globalThis', 'Intl',
    'TextDecoder', 'TextEncoder'
]);

function parsear(codigo) {
    return acorn.parse(codigo, { ecmaVersion: 2022, sourceType: 'script' });
}

function recorrer(nodo, visitar) {
    if (!nodo || typeof nodo !== 'object') return;
    if (visitar(nodo) === false) return;
    for (const clave of Object.keys(nodo)) {
        const valor = nodo[clave];
        if (Array.isArray(valor)) valor.forEach(v => recorrer(v, visitar));
        else if (valor && typeof valor === 'object' && valor.type) recorrer(valor, visitar);
    }
}

/** Callbacks que Puppeteer serializa hacia el navegador. */
function callbacksDePagina(codigo) {
    const encontrados = [];
    recorrer(parsear(codigo), nodo => {
        if (nodo.type === 'CallExpression' && nodo.callee
            && nodo.callee.type === 'MemberExpression' && nodo.callee.property
            && nodo.callee.property.type === 'Identifier'
            && METODOS_DE_PAGINA.has(nodo.callee.property.name)) {
            for (const arg of nodo.arguments) {
                if (arg && (arg.type === 'ArrowFunctionExpression'
                    || arg.type === 'FunctionExpression')) {
                    encontrados.push(arg);
                }
            }
        }
    });
    return encontrados;
}

/** Paso 1: envolver cada callback en las directivas (de atrás hacia adelante). */
function marcar(codigo) {
    const callbacks = callbacksDePagina(codigo).sort((a, b) => b.start - a.start);
    let salida = codigo;
    for (const cb of callbacks) {
        salida = salida.slice(0, cb.start)
            + '/* javascript-obfuscator:disable */'
            + salida.slice(cb.start, cb.end)
            + '/* javascript-obfuscator:enable */'
            + salida.slice(cb.end);
    }
    return { codigo: salida, marcados: callbacks.length };
}

/** Identificadores libres de un nodo función (incluye sus funciones anidadas). */
function identificadoresLibres(fn) {
    const declarados = new Set();
    const usados = new Set();
    (function w(nodo, esDeclaracion) {
        if (!nodo || typeof nodo !== 'object') return;
        switch (nodo.type) {
            case 'Identifier': (esDeclaracion ? declarados : usados).add(nodo.name); return;
            case 'MemberExpression':
                w(nodo.object, false); if (nodo.computed) w(nodo.property, false); return;
            case 'Property':
                if (nodo.computed) w(nodo.key, false); w(nodo.value, esDeclaracion); return;
            case 'VariableDeclarator': w(nodo.id, true); w(nodo.init, false); return;
            case 'CatchClause': w(nodo.param, true); w(nodo.body, false); return;
            case 'LabeledStatement': w(nodo.body, false); return;
            case 'ArrowFunctionExpression':
            case 'FunctionExpression':
            case 'FunctionDeclaration':
                if (nodo.id) declarados.add(nodo.id.name);
                nodo.params.forEach(p => w(p, true));
                w(nodo.body, false);
                return;
            case 'ClassDeclaration':
            case 'ClassExpression':
                if (nodo.id) declarados.add(nodo.id.name);
                w(nodo.body, false);
                return;
        }
        for (const clave of Object.keys(nodo)) {
            const valor = nodo[clave];
            if (Array.isArray(valor)) valor.forEach(v => w(v, esDeclaracion));
            else if (valor && typeof valor === 'object' && valor.type) w(valor, esDeclaracion);
        }
    })(fn, false);
    return [...usados].filter(u => !declarados.has(u));
}

/**
 * ¿Usa document/window en su PROPIO cuerpo? (sin contar funciones anidadas)
 * Sin esta distinción, la función de Node que envuelve al callback se confunde con el
 * callback mismo y el verificador da falsos positivos.
 */
function usaDocumentDirecto(fn) {
    let encontrado = false;
    (function w(nodo, esRaiz) {
        if (!nodo || typeof nodo !== 'object' || encontrado) return;
        if (!esRaiz && (nodo.type === 'ArrowFunctionExpression'
            || nodo.type === 'FunctionExpression' || nodo.type === 'FunctionDeclaration')) return;
        if (nodo.type === 'Identifier' && (nodo.name === 'document' || nodo.name === 'window')) {
            encontrado = true; return;
        }
        if (nodo.type === 'MemberExpression') {
            w(nodo.object, false); if (nodo.computed) w(nodo.property, false); return;
        }
        for (const clave of Object.keys(nodo)) {
            const valor = nodo[clave];
            if (Array.isArray(valor)) valor.forEach(v => w(v, false));
            else if (valor && typeof valor === 'object' && valor.type) w(valor, false);
        }
    })(fn.body, true);
    return encontrado;
}

/**
 * Paso 3: verificación fail-closed sobre el código YA ofuscado.
 * Devuelve [] si está sano; si no, la lista de referencias externas que romperían.
 *
 * No busca page.evaluate en el ofuscado a propósito: con stringArrayThreshold en 1 la
 * llamada queda como page[_0x41bb17(0x1df)](…) y el nombre del método desaparece del árbol
 * — un verificador que lo buscara ahí daría "todo OK" siempre. Por eso el criterio es
 * semántico: toda función que use document/window ES, en Node, código de página.
 */
function verificar(codigoOfuscado) {
    const problemas = [];
    recorrer(parsear(codigoOfuscado), nodo => {
        if (nodo.type !== 'ArrowFunctionExpression' && nodo.type !== 'FunctionExpression') return;
        if (!usaDocumentDirecto(nodo)) return;
        const libres = identificadoresLibres(nodo);
        if (!libres.includes('document') && !libres.includes('window')) return;
        const externas = libres.filter(id => !GLOBALES_DEL_NAVEGADOR.has(id));
        if (externas.length) problemas.push(externas);
        return false; // no bajar más: los anidados ya quedaron contemplados
    });
    return problemas;
}

/**
 * Punto de entrada. Lanza si el resultado rompería en el navegador, para que el reencrypt
 * aborte ANTES de escribir nada en encrypted_scripts.
 */
function ofuscarScript(codigo, nombreArchivo = 'script.js') {
    const { codigo: marcado, marcados } = marcar(codigo);
    const ofuscado = JavaScriptObfuscator.obfuscate(marcado, CONFIG).getObfuscatedCode();
    const problemas = verificar(ofuscado);
    if (problemas.length) {
        throw new Error(
            `Ofuscación abortada en ${nombreArchivo}: ${problemas.length} función(es) de `
            + `página quedaron con referencias externas (${problemas[0].slice(0, 4).join(', ')}). `
            + `Ese script rompería con "ReferenceError: … is not defined" dentro del navegador.`
        );
    }
    return { codigo: ofuscado, callbacksPreservados: marcados };
}

module.exports = {
    ofuscarScript,
    // exportados para las pruebas y para el control negativo
    marcar, verificar, callbacksDePagina, CONFIG
};
