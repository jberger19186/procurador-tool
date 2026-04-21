// generador_visor.js
/**
 * Generador de visor HTML interactivo para resultados de batch
 */

const fs = require('fs');
const path = require('path');

/**
 * Genera visor HTML con resultados del batch
 * @param {string} rutaResumenJSON - Ruta al resumen_orquestador_{timestamp}.json
 * @param {Object} config - Configuración del sistema
 * @param {string} rutaExcel - Ruta al Excel generado (opcional)
 * @returns {Promise<string>} Ruta del HTML generado
 */
async function generarVisorHTML(rutaResumenJSON, config, rutaExcel = null) {
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
        const datosParaInyectar = prepararDatos(expedientes, config, rutaExcel);

        // 5. CORRECCIÓN: Inyectar datos en el template
        // Buscar el bloque exacto y reemplazarlo completamente
        const placeholder = `const DATOS_BATCH = {
            fechaEjecucion: '2025-12-02 03:00:00',
            expedientes: [],
            rutaExcel: ''
        };`;

        const datosInyectados = `const DATOS_BATCH = ${JSON.stringify(datosParaInyectar, null, 12)};`;

        // Verificar que el placeholder existe
        if (!htmlTemplate.includes('const DATOS_BATCH = {')) {
            throw new Error('El template no contiene el marcador de datos esperado');
        }

        // Reemplazar usando un patrón más robusto
        htmlTemplate = htmlTemplate.replace(
            /const DATOS_BATCH = \{[^}]*\};/s,
            datosInyectados
        );

        // 6. Guardar HTML generado
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const nombreArchivo = `visor_batch_${timestamp}.html`;
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
 * @returns {Object} Objeto con datos formateados
 */
function prepararDatos(expedientes, config, rutaExcel) {
    const carpetaDescargas = config.rutas?.descargas || 'descargas';
    // Soportar rutas absolutas además de relativas
    const rutaBase = path.isAbsolute(carpetaDescargas)
        ? carpetaDescargas
        : path.join(process.cwd(), carpetaDescargas);

    // Enriquecer expedientes con ruta relativa al PDF
    const expedientesEnriquecidos = expedientes.map(exp => {
        let rutaPDF = null;

        if (exp.ok) {
            try {
                const archivos = fs.readdirSync(rutaBase);
                const pdfsExpedientes = archivos.filter(f =>
                    f.startsWith('expediente_') && f.endsWith('.pdf')
                );

                // Búsqueda flexible por partes del nombre
                const partes = exp.expediente
                    .toLowerCase()
                    .replace(/[\/:"*?<>|]/g, ' ')
                    .split(/\s+/)
                    .filter(p => p.length > 0);

                const archivoEncontrado = pdfsExpedientes.find(archivo => {
                    const archivoLower = archivo.toLowerCase();
                    return partes.every(parte => archivoLower.includes(parte));
                });

                if (archivoEncontrado && fs.existsSync(path.join(rutaBase, archivoEncontrado))) {
                    // Ruta relativa: funciona al copiar la carpeta con el HTML y los PDFs
                    rutaPDF = `./${archivoEncontrado}`;
                }
            } catch (error) {
                console.warn(`   ⚠️ Error al buscar PDF para ${exp.expediente}`);
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
        rutaExcel: rutaExcelRelativa
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