/**
 * CodeObfuscator - VERSIÓN MINIMALISTA (DESACTIVADO)
 * Solo devuelve código sin modificar
 */
class CodeObfuscator {
    constructor() {
        this.enabled = false;
        console.log('🔓 Ofuscación desactivada (modo minimalista)');
    }

    /**
     * Ofuscar código (devuelve código original sin cambios)
     */
    obfuscate(code, scriptName = 'script.js') {
        return code;
    }

    /**
     * Ofuscación ligera (devuelve código original sin cambios)
     */
    obfuscateLight(code, scriptName = 'script.js') {
        return code;
    }

    /**
     * Deshabilitar ofuscación (ya desactivado por defecto)
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Habilitar ofuscación (no implementado en versión minimalista)
     */
    enable() {
        console.warn('⚠️ Ofuscación no disponible en versión minimalista');
    }
}

module.exports = CodeObfuscator;