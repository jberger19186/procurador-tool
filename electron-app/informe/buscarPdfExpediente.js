// buscarPdfExpediente.js
/**
 * Localiza el PDF generado para un expediente dentro de la carpeta de descargas.
 *
 * Vive en su propio módulo porque la misma búsqueda la necesitan el generador de
 * Excel y el del visor HTML. Estaba duplicada en los dos, y por eso la unificación
 * de nombres de v2.7.33 la rompió en ambos a la vez: el filtro seguía buscando el
 * prefijo viejo `expediente_` cuando los PDFs ya se escribían como
 * `informe_<exp>_<ISO>.pdf`. Nunca matcheaba nada → el visor dejaba el link en '#'
 * y el Excel escribía "PDF no encontrado", con los PDFs presentes en la carpeta.
 */

const fs = require('fs');
const path = require('path');

// Sufijo de timestamp que la unificación de nombres agrega a cada PDF:
// `_2026-07-29T13-01-31.pdf`
const SUFIJO_TIMESTAMP = /_\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}\.pdf$/;

/**
 * @param {string} rutaBase - Carpeta de descargas donde viven los PDFs
 * @param {string} expediente - Identificador del expediente (ej: "FCR 18745/2018")
 * @returns {string|null} Nombre del archivo encontrado, o null
 */
function buscarPdfExpediente(rutaBase, expediente) {
    try {
        const archivos = fs.readdirSync(rutaBase);

        // `informe_` es el prefijo vigente desde v2.7.33; `expediente_` se acepta
        // para que sigan resolviendo los PDFs de corridas anteriores a esa versión.
        const candidatos = archivos.filter(f => {
            const lower = f.toLowerCase();
            return lower.endsWith('.pdf') &&
                (lower.startsWith('informe_') || lower.startsWith('expediente_'));
        });

        // Búsqueda flexible por partes del nombre del expediente
        const partes = expediente
            .toLowerCase()
            .replace(/[\/:"*?<>|]/g, ' ')
            .split(/\s+/)
            .filter(p => p.length > 0);

        if (partes.length === 0) return null;

        const coincidencias = candidatos.filter(archivo => {
            // Se recorta el timestamp ANTES de comparar: si no, el año de la corrida
            // matchea el año del expediente (un expediente 2026 daría por bueno el PDF
            // de otro año generado en 2026) y se devuelve el archivo equivocado.
            const base = archivo.toLowerCase().replace(SUFIJO_TIMESTAMP, '');
            return partes.every(parte => base.includes(parte));
        });

        if (coincidencias.length === 0) return null;

        // Si un mismo expediente se informó varias veces, gana el PDF más reciente.
        // Se ordena por fecha de modificación real, no por nombre: ordenar por nombre
        // es exactamente lo que causó el bug del visor de v2.7.35.
        const masReciente = coincidencias
            .map(nombre => {
                let mtime = 0;
                try { mtime = fs.statSync(path.join(rutaBase, nombre)).mtimeMs; } catch (_) {}
                return { nombre, mtime };
            })
            .sort((a, b) => b.mtime - a.mtime)[0];

        return masReciente ? masReciente.nombre : null;

    } catch (error) {
        console.warn(`   ⚠️ Error al buscar PDF para ${expediente}: ${error.message}`);
        return null;
    }
}

module.exports = { buscarPdfExpediente };
