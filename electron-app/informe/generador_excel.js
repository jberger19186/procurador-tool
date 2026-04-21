// generador_excel.js
/**
 * Generador de reportes Excel para batch de informes SCW
 * Crea archivo Excel con 3 hojas: Resumen, Expedientes, Detalle Errores
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * Genera archivo Excel con resultados del batch
 * @param {string} rutaResumenJSON - Ruta al archivo resumen_orquestador_{timestamp}.json
 * @param {Object} config - Objeto config_proceso_informe.json
 * @returns {Promise<string>} Ruta del archivo Excel generado
 */
async function generarExcelBatch(rutaResumenJSON, config) {
    try {
        console.log('\n📊 Iniciando generación de Excel...');

        // 1. Validar que existe el JSON de resumen
        if (!fs.existsSync(rutaResumenJSON)) {
            throw new Error(`No se encontró el archivo de resumen: ${rutaResumenJSON}`);
        }

        // 2. Leer y parsear el JSON
        const contenidoJSON = fs.readFileSync(rutaResumenJSON, 'utf-8');
        const expedientes = JSON.parse(contenidoJSON);

        if (!Array.isArray(expedientes) || expedientes.length === 0) {
            throw new Error('El archivo de resumen está vacío o tiene formato inválido');
        }

        console.log(`   ✓ Leídos ${expedientes.length} expedientes del resumen`);

        // 3. Calcular estadísticas
        const estadisticas = calcularEstadisticas(expedientes);
        console.log(`   ✓ Procesados: ${estadisticas.exitosos} exitosos, ${estadisticas.fallidos} fallidos`);

        // 4. Crear workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema de Informes SCW';
        workbook.created = new Date();

        // 5. Generar hojas
        await crearHojaResumen(workbook, estadisticas);
        await crearHojaExpedientes(workbook, expedientes, config);

        // Solo crear hoja de errores si hay fallidos
        if (estadisticas.fallidos > 0) {
            const expedientesFallidos = expedientes.filter(e => !e.ok);
            await crearHojaErrores(workbook, expedientesFallidos);
        }

        // 6. Guardar archivo
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const nombreArchivo = `informe_batch_${timestamp}.xlsx`;
        const rutaExcel = path.join(config.rutas?.descargas || 'descargas', nombreArchivo);

        await workbook.xlsx.writeFile(rutaExcel);
        console.log(`   ✅ Excel generado: ${rutaExcel}\n`);

        return rutaExcel;

    } catch (error) {
        console.error('❌ Error al generar Excel:', error.message);
        throw error;
    }
}

/**
 * Calcula estadísticas del batch
 * @param {Array} expedientes - Array de objetos {expediente, ok, exitCode}
 * @returns {Object} Estadísticas calculadas
 */
function calcularEstadisticas(expedientes) {
    const total = expedientes.length;
    const exitosos = expedientes.filter(e => e.ok === true).length;
    const fallidos = total - exitosos;
    const porcentajeExito = total > 0 ? ((exitosos / total) * 100).toFixed(1) : 0;

    return {
        fechaEjecucion: new Date(),
        total,
        exitosos,
        fallidos,
        porcentajeExito
    };
}

/**
 * Crea la hoja "Resumen" con estadísticas generales
 * @param {ExcelJS.Workbook} workbook 
 * @param {Object} stats - Estadísticas calculadas
 */
async function crearHojaResumen(workbook, stats) {
    const hoja = workbook.addWorksheet('Resumen', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });

    // Encabezado principal
    hoja.mergeCells('A1:B1');
    const tituloCell = hoja.getCell('A1');
    tituloCell.value = 'RESUMEN DE EJECUCIÓN - BATCH INFORMES SCW';
    tituloCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    tituloCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2196F3' }
    };
    tituloCell.alignment = { horizontal: 'center', vertical: 'middle' };
    hoja.getRow(1).height = 25;

    // Datos del resumen
    const datos = [
        ['Fecha de Ejecución', stats.fechaEjecucion.toLocaleString('es-AR')],
        ['Total Procesados', stats.total],
        ['Exitosos', stats.exitosos],
        ['Fallidos', stats.fallidos],
        ['Porcentaje de Éxito', `${stats.porcentajeExito}%`]
    ];

    let filaActual = 3;
    datos.forEach(([etiqueta, valor]) => {
        const cellEtiqueta = hoja.getCell(`A${filaActual}`);
        const cellValor = hoja.getCell(`B${filaActual}`);

        cellEtiqueta.value = etiqueta;
        cellEtiqueta.font = { bold: true };
        cellEtiqueta.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE3F2FD' }
        };

        cellValor.value = valor;

        // Colorear según tipo de dato
        if (etiqueta === 'Exitosos' && valor > 0) {
            cellValor.font = { color: { argb: 'FF4CAF50' }, bold: true };
        } else if (etiqueta === 'Fallidos' && valor > 0) {
            cellValor.font = { color: { argb: 'FFF44336' }, bold: true };
        }

        filaActual++;
    });

    // Ajustar anchos de columna
    hoja.getColumn('A').width = 25;
    hoja.getColumn('B').width = 30;

    // Bordes
    hoja.eachRow((row, rowNumber) => {
        if (rowNumber >= 3) {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        }
    });
}

/**
 * Crea la hoja "Expedientes" con detalle de todos los procesados
 * @param {ExcelJS.Workbook} workbook 
 * @param {Array} expedientes - Array de expedientes procesados
 * @param {Object} config - Configuración del sistema
 */
async function crearHojaExpedientes(workbook, expedientes, config) {
    const hoja = workbook.addWorksheet('Expedientes', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });

    // Encabezados
    const encabezados = ['N°', 'Expediente', 'Estado', 'Código Salida', 'Ruta PDF'];
    hoja.addRow(encabezados);

    const headerRow = hoja.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2196F3' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 20;

    // Datos
    expedientes.forEach((exp, index) => {
        const fila = hoja.addRow([
            index + 1,
            exp.expediente,
            exp.ok ? '✅ OK' : '❌ ERROR',
            exp.exitCode || 0,
            '' // Se llenará con hipervínculo
        ]);

        // Colorear fila según estado
        const color = exp.ok ? 'FFC8E6C9' : 'FFFFCDD2';
        fila.eachCell((cell, colNumber) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: color }
            };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };

            // Centrar columnas específicas
            if ([1, 3, 4].includes(colNumber)) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
        });

        // Agregar hipervínculo al PDF si existe
        if (exp.ok) {
            const carpetaDescargas = config.rutas?.descargas || 'descargas';
            // Soportar rutas absolutas además de relativas
            const rutaBase = path.isAbsolute(carpetaDescargas)
                ? carpetaDescargas
                : path.join(process.cwd(), carpetaDescargas);

            let archivoEncontrado = null;

            try {
                const archivos = fs.readdirSync(rutaBase);
                const pdfsExpedientes = archivos.filter(f =>
                    f.startsWith('expediente_') && f.endsWith('.pdf')
                );

                // Búsqueda flexible por partes del nombre del expediente
                const partes = exp.expediente
                    .toLowerCase()
                    .replace(/[\/:"*?<>|]/g, ' ')
                    .split(/\s+/)
                    .filter(p => p.length > 0);

                archivoEncontrado = pdfsExpedientes.find(archivo => {
                    const archivoLower = archivo.toLowerCase();
                    return partes.every(parte => archivoLower.includes(parte));
                });
            } catch (error) {
                console.error(`   ⚠️ Error al buscar PDF: ${error.message}`);
            }

            if (archivoEncontrado && fs.existsSync(path.join(rutaBase, archivoEncontrado))) {
                const cellPDF = fila.getCell(5);
                // Hipervínculo relativo al nombre del archivo: funciona al copiar la carpeta
                cellPDF.value = {
                    text: 'Abrir PDF',
                    hyperlink: archivoEncontrado
                };
                cellPDF.font = { color: { argb: 'FF0000FF' }, underline: true };
            } else {
                fila.getCell(5).value = 'PDF no encontrado';
                fila.getCell(5).font = { color: { argb: 'FFFF9800' }, italic: true };
            }
        } else {
            fila.getCell(5).value = 'N/A';
        }
    });

    // Ajustar anchos automáticamente
    hoja.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: false }, cell => {
            const cellValue = cell.value ? cell.value.toString() : '';
            maxLength = Math.max(maxLength, cellValue.length);
        });
        column.width = Math.min(maxLength + 2, 50); // Máximo 50 caracteres
    });

    // Aplicar filtros automáticos
    hoja.autoFilter = {
        from: 'A1',
        to: `E${expedientes.length + 1}`
    };
}

/**
 * Crea la hoja "Errores" con detalle de expedientes fallidos
 * @param {ExcelJS.Workbook} workbook 
 * @param {Array} expedientesFallidos - Array de expedientes con error
 */
async function crearHojaErrores(workbook, expedientesFallidos) {
    const hoja = workbook.addWorksheet('Detalle Errores', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });

    // Encabezados
    const encabezados = ['N°', 'Expediente', 'Código Error', 'Mensaje de Error'];
    hoja.addRow(encabezados);

    const headerRow = hoja.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF44336' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 20;

    // Datos
    expedientesFallidos.forEach((exp, index) => {
        const mensajeError = extraerMensajeError(exp);

        const fila = hoja.addRow([
            index + 1,
            exp.expediente,
            exp.exitCode || 'N/A',
            mensajeError
        ]);

        // Estilo
        fila.eachCell((cell, colNumber) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };

            if ([1, 3].includes(colNumber)) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else {
                cell.alignment = { vertical: 'top', wrapText: true };
            }
        });

        // Colorear mensaje de error
        fila.getCell(4).font = { color: { argb: 'FFD32F2F' } };
    });

    // Ajustar anchos
    hoja.getColumn(1).width = 5;   // N°
    hoja.getColumn(2).width = 25;  // Expediente
    hoja.getColumn(3).width = 15;  // Código
    hoja.getColumn(4).width = 60;  // Mensaje (más ancho)
}

/**
 * Extrae mensaje de error limpio desde stderr o detalle del expediente
 * @param {Object} expediente - Objeto con datos del expediente fallido
 * @returns {string} Mensaje de error formateado
 */
function extraerMensajeError(expediente) {
    // Si el expediente tiene stderr completo
    if (expediente.stderr && expediente.stderr.trim()) {
        const lineas = expediente.stderr.split('\n').filter(l => l.trim());

        // Buscar líneas que empiecen con "Error:" o "❌"
        const lineaError = lineas.find(l =>
            l.includes('Error:') ||
            l.includes('❌') ||
            l.includes('failed') ||
            l.includes('ENOENT') ||
            l.includes('EPERM')
        );

        if (lineaError) {
            return lineaError.trim().substring(0, 500); // Máximo 500 caracteres
        }

        // Si no encuentra línea específica, retornar últimas 3 líneas
        return lineas.slice(-3).join(' | ').substring(0, 500);
    }

    // Fallback genérico
    return `Error con código de salida ${expediente.exitCode || 'desconocido'}. Revisar logs del proceso.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIONES
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    generarExcelBatch
};

// ═══════════════════════════════════════════════════════════════════════════
// TESTING STANDALONE (ejecutar: node generador_excel.js)
// ═══════════════════════════════════════════════════════════════════════════

if (require.main === module) {
    console.log('🧪 Modo testing: Generando Excel de prueba...\n');

    // Datos de prueba
    const expedientesPrueba = [
        { expediente: 'FCR 018745/2017', ok: true, exitCode: 0 },
        { expediente: 'CAF 068920/2018', ok: false, exitCode: 1, stderr: 'Error: Expediente inexistente o no disponible' },
        { expediente: 'CIV 123456/2020', ok: true, exitCode: 0 },
        { expediente: 'CNE 999999/2021', ok: false, exitCode: 1, stderr: 'Error: Timeout navegando página' }
    ];

    const configPrueba = {
        rutas: {
            descargas: 'descargas'
        }
    };

    // Crear JSON temporal
    const testPath = path.join(__dirname, 'test_resumen_excel.json');
    fs.writeFileSync(testPath, JSON.stringify(expedientesPrueba, null, 2));

    // Generar Excel
    generarExcelBatch(testPath, configPrueba)
        .then(rutaExcel => {
            console.log('✅ Test completado exitosamente');
            console.log(`📂 Archivo generado: ${rutaExcel}`);

            // Limpiar archivo temporal
            fs.unlinkSync(testPath);
        })
        .catch(error => {
            console.error('❌ Test falló:', error);
            process.exit(1);
        });
}