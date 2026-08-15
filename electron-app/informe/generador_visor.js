// generador_visor.js
/**
 * Generador de visor HTML interactivo para resultados de batch
 */

const fs = require('fs');
const path = require('path');
const { buscarPdfExpediente } = require('./buscarPdfExpediente');

/**
 * Genera visor HTML con resultados del batch
 * @param {string} rutaResumenJSON - Ruta al resumen_orquestador_{timestamp}.json
 * @param {Object} config - Configuración del sistema
 * @param {string} rutaExcel - Ruta al Excel generado (opcional)
 * @param {{enabled: boolean, seguidos: string[]}} [bitacoraInfo] - F2.1: gating + casos ya
 *   seguidos para la botonera de captura. `main.js` la controla directamente acá (a
 *   diferencia de los visores de procuración, que van por post-procesado — ver H1 del
 *   plan de Bitácora). Si no viene (o falló su obtención), se inyecta deshabilitada —
 *   nunca bloquea la generación del visor (mismo espíritu del punto crítico P3).
 * @returns {Promise<string>} Ruta del HTML generado
 */
async function generarVisorHTML(rutaResumenJSON, config, rutaExcel = null, bitacoraInfo = null) {
    try {
        console.log('\n🌐 Iniciando generación de visor HTML...');

        // 1. Validar que existe el JSON de resumen
        if (!fs.existsSync(rutaResumenJSON)) {
            throw new Error(`No se encontró el archivo de resumen: ${rutaResumenJSON}`);
        }

        // 2. Leer expedientes del JSON
        const contenidoJSON = fs.readFileSync(rutaResumenJSON, 'utf-8');
        const expedientes = JSON.parse(contenidoJSON);

        if (!Array.isArray(expedientes) || expedientes.length === 0) {
            throw new Error('El archivo de resumen está vacío o tiene formato inválido');
        }

        console.log(`   ✓ Leídos ${expedientes.length} expedientes`);

        // 3. Leer template HTML
        const templatePath = path.join(__dirname, 'visor_informes_template.html');
        if (!fs.existsSync(templatePath)) {
            throw new Error(`No se encontró el template: ${templatePath}`);
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf-8');

        // 4. Preparar datos para inyectar
        const datosParaInyectar = prepararDatos(expedientes, config, rutaExcel, bitacoraInfo);

        // 5. CORRECCIÓN: Inyectar datos en el template
        // Buscar el bloque exacto y reemplazarlo completamente
        const datosInyectados = `const DATOS_BATCH = ${JSON.stringify(datosParaInyectar, null, 12)};`;

        // Verificar que el placeholder existe
        if (!htmlTemplate.includes('const DATOS_BATCH = {')) {
            throw new Error('El template no contiene el marcador de datos esperado');
        }

        // F2.1: el placeholder ahora incluye un objeto anidado (`bitacora: {...}`), así que
        // el patrón original ([^}]*) —que no tolera llaves internas— cortaba en la primera
        // '}' que encontraba (la del objeto anidado) y dejaba basura sintáctica detrás.
        // Este patrón tolera UN nivel de anidamiento, que es lo único que el placeholder usa.
        htmlTemplate = htmlTemplate.replace(
            /const DATOS_BATCH = \{(?:[^{}]|\{[^{}]*\})*\};/s,
            datosInyectados
        );

        // 6. Guardar HTML generado
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const nombreArchivo = `informe-lote_visor_${timestamp}.html`;
        const carpetaDescargas = config.rutas?.descargas || 'descargas';
        const rutaHTML = path.join(carpetaDescargas, nombreArchivo);

        fs.writeFileSync(rutaHTML, htmlTemplate, 'utf-8');
        console.log(`   ✅ Visor HTML generado: ${rutaHTML}\n`);

        return rutaHTML;

    } catch (error) {
        console.error('❌ Error al generar visor HTML:', error.message);
        throw error;
    }
}

/**
 * Convierte una ruta a formato file:/// absoluto
 * @param {string} ruta - Ruta del archivo (relativa o absoluta)
 * @returns {string} Ruta en formato file:/// compatible con navegadores
 */
function convertirARutaAbsoluta(ruta) {
    if (!ruta) return '';

    // Limpiar posibles duplicaciones de file:///
    let rutaLimpia = ruta.replace(/^file:\/\/\/+/g, '');

    // Si ya es una URL HTTP/HTTPS, devolverla tal cual
    if (rutaLimpia.startsWith('http://') || rutaLimpia.startsWith('https://')) {
        return rutaLimpia;
    }

    // Convertir ruta relativa a absoluta
    let rutaAbsoluta = rutaLimpia;
    if (!path.isAbsolute(rutaLimpia)) {
        rutaAbsoluta = path.join(process.cwd(), rutaLimpia);
    }

    // Normalizar separadores y agregar protocolo file:/// (una sola vez)
    return `file:///${rutaAbsoluta.replace(/\\/g, '/')}`;
}

/**
 * Prepara los datos para inyectar en el template
 * @param {Array} expedientes - Array de expedientes procesados
 * @param {Object} config - Configuración del sistema
 * @param {string} rutaExcel - Ruta al Excel (opcional)
 * @param {{enabled: boolean, seguidos: string[]}} [bitacoraInfo] - F2.1
 * @returns {Object} Objeto con datos formateados
 */
function prepararDatos(expedientes, config, rutaExcel, bitacoraInfo) {
    const carpetaDescargas = config.rutas?.descargas || 'descargas';
    // Soportar rutas absolutas además de relativas
    const rutaBase = path.isAbsolute(carpetaDescargas)
        ? carpetaDescargas
        : path.join(process.cwd(), carpetaDescargas);

    // Enriquecer expedientes con ruta relativa al PDF
    const expedientesEnriquecidos = expedientes.map(exp => {
        let rutaPDF = null;

        if (exp.ok) {
            const archivoEncontrado = buscarPdfExpediente(rutaBase, exp.expediente);
            if (archivoEncontrado && fs.existsSync(path.join(rutaBase, archivoEncontrado))) {
                // Ruta relativa: funciona al copiar la carpeta con el HTML y los PDFs
                rutaPDF = `./${encodeURIComponent(archivoEncontrado)}`;
            }
        }

        return {
            expediente: exp.expediente,
            ok: exp.ok,
            exitCode: exp.exitCode || 0,
            rutaPDF: rutaPDF
        };
    });

    // Ruta relativa al Excel: solo el nombre del archivo
    const rutaExcelRelativa = rutaExcel ? `./${path.basename(rutaExcel)}` : '';

    return {
        fechaEjecucion: new Date().toLocaleString('es-AR'),
        expedientes: expedientesEnriquecidos,
        rutaExcel: rutaExcelRelativa,
        bitacora: {
            enabled: bitacoraInfo?.enabled === true,
            seguidos: Array.isArray(bitacoraInfo?.seguidos) ? bitacoraInfo.seguidos : []
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIONES
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    generarVisorHTML
};

// ═══════════════════════════════════════════════════════════════════════════
// TESTING STANDALONE
// ═══════════════════════════════════════════════════════════════════════════

if (require.main === module) {
    console.log('🧪 Modo testing: Generando visor HTML de prueba...\n');

    const expedientesPrueba = [
        { expediente: 'FCR 018745/2017', ok: true, exitCode: 0 },
        { expediente: 'CAF 068920/2018', ok: false, exitCode: 1 },
        { expediente: 'CIV 123456/2020', ok: true, exitCode: 0 }
    ];

    const configPrueba = {
        rutas: {
            descargas: 'descargas'
        }
    };

    // Crear JSON temporal
    const testPath = path.join(__dirname, 'test_resumen_visor.json');
    fs.writeFileSync(testPath, JSON.stringify(expedientesPrueba, null, 2));

    // Generar visor
    generarVisorHTML(testPath, configPrueba)
        .then(rutaHTML => {
            console.log('✅ Test completado exitosamente');
            console.log(`📂 Archivo generado: ${rutaHTML}`);

            // Limpiar archivo temporal
            fs.unlinkSync(testPath);
        })
        .catch(error => {
            console.error('❌ Test falló:', error);
            process.exit(1);
        });
}