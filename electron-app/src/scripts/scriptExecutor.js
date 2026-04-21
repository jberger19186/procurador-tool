const vm = require('vm');
const Module = require('module');

/**
 * ScriptExecutor
 * Ejecuta scripts en un sandbox aislado usando vm module
 * Soporta require() de módulos desde caché
 */
class ScriptExecutor {
    constructor(scriptCache) {
        this.executionCount = 0;
        this.scriptCache = scriptCache; // Referencia al caché
        console.log('⚙️ ScriptExecutor inicializado');
    }

    /**
     * Crear función require personalizada que busca en caché
     */
    createCustomRequire(scriptName) {
        const self = this;

        return function customRequire(moduleName) {
            // Si es un módulo nativo de Node.js, usar require normal
            if (Module.builtinModules.includes(moduleName)) {
                return require(moduleName);
            }

            // Si es un módulo de node_modules, usar require normal
            if (!moduleName.startsWith('.')) {
                return require(moduleName);
            }

            // Si es un módulo local (./algo), buscar en caché
            const moduleNameClean = moduleName
                .replace(/^\.\//, '')  // Remover ./
                .replace(/^\.\.\//, '') // Remover ../
                .replace(/\.js$/, '');  // Remover .js si existe

            const possibleNames = [
                `${moduleNameClean}.js`,
                moduleNameClean
            ];

            // Buscar el script en caché
            for (const name of possibleNames) {
                if (self.scriptCache.has(name)) {
                    const code = self.scriptCache.get(name);

                    // Crear un mini-sandbox para el módulo
                    const moduleExports = {};
                    const moduleSandbox = {
                        exports: moduleExports,
                        module: { exports: moduleExports },
                        require: customRequire, // Recursivo
                        console: console,
                        Buffer: Buffer,
                        setTimeout: setTimeout,
                        setInterval: setInterval,
                        clearTimeout: clearTimeout,
                        clearInterval: clearInterval,
                        Promise: Promise,
                        process: {
                            env: process.env,
                            cwd: process.cwd,
                            argv: process.argv
                        },
                        __dirname: __dirname,
                        __filename: name
                    };

                    const script = new vm.Script(code, { filename: name });
                    const context = vm.createContext(moduleSandbox);
                    script.runInContext(context);

                    return moduleSandbox.module.exports;
                }
            }

            // Si no está en caché, intentar require normal como fallback
            console.warn(`⚠️ Módulo ${moduleName} no encontrado en caché, intentando require normal`);
            return require(moduleName);
        };
    }

    /**
     * Ejecutar script en sandbox
     */
    async executeScript(code, scriptName, params = {}) {
        const startTime = Date.now();
        this.executionCount++;

        console.log(`🚀 Ejecutando: ${scriptName}`);

        try {
            // Crear require personalizado
            const customRequire = this.createCustomRequire(scriptName);

            // Crear sandbox con contexto limitado
            const sandbox = {
                console: console,
                params: params,
                require: customRequire, // ✅ Usar require personalizado
                Buffer: Buffer,
                setTimeout: setTimeout,
                setInterval: setInterval,
                clearTimeout: clearTimeout,
                clearInterval: clearInterval,
                Promise: Promise,
                process: {
                    env: process.env,
                    cwd: process.cwd,
                    argv: process.argv,
                    exit: (code) => {
                        console.log(`⚠️ Script intentó llamar process.exit(${code})`);
                    }
                },
                __dirname: __dirname,
                __filename: scriptName,
                module: { exports: {} },
                exports: {}
            };

            const context = vm.createContext(sandbox);
            const script = new vm.Script(code, { filename: scriptName });

            // Ejecutar script con timeout de 10 minutos
            let scriptResult = script.runInContext(context, {
                timeout: 600000, // 10 minutos
                displayErrors: true
            });

            // Manejar diferentes formatos de script
            let result;

            // Si retorna una Promise (async)
            if (scriptResult && typeof scriptResult.then === 'function') {
                result = await scriptResult;
            }
            // Si exportó una función
            else if (typeof sandbox.module.exports === 'function') {
                result = await sandbox.module.exports(params);
            }
            // Si exportó un objeto
            else if (sandbox.module.exports && typeof sandbox.module.exports === 'object') {
                result = sandbox.module.exports;
            }
            // Resultado directo
            else {
                result = scriptResult;
            }

            const executionTime = Date.now() - startTime;
            console.log(`✅ ${scriptName} completado en ${executionTime}ms`);

            return {
                success: true,
                result: result,
                executionTime: executionTime,
                scriptName: scriptName
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            console.error(`❌ Error ejecutando ${scriptName}:`, error.message);

            return {
                success: false,
                error: error.message,
                stack: error.stack,
                executionTime: executionTime,
                scriptName: scriptName
            };
        }
    }

    /**
     * Obtener estadísticas
     */
    getStats() {
        return {
            totalExecutions: this.executionCount
        };
    }
}

module.exports = ScriptExecutor;