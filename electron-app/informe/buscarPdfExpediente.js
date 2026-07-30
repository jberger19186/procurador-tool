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
const PREFIJO = /^(informe|expediente)_/;

/**
 * Descompone un identificador de expediente en sus componentes (jurisdicción,
 * número, año), normalizando los separadores. Se aplica igual al expediente
 * pedido y al nombre del archivo, para poder compararlos por igualdad.
 *
 * Los componentes puramente numéricos se normalizan quitando los ceros a la
 * izquierda: el usuario escribe "FCR 18745/2017" pero el PJN devuelve el número
 * con padding, y el script nombra el PDF con la forma normalizada del PJN
 * (`informe_FCR 018745_2017_...`). Son el MISMO expediente — el cero a la
 * izquierda es formato de presentación, no parte del identificador.
 */
function tokenizar(texto) {
    return texto
        .toLowerCase()
        .replace(/[\/:"*?<>|_]/g, ' ')
        .split(/\s+/)
        .filter(p => p.length > 0)
        // `|| '0'` evita que un token que sea todo ceros quede vacío.
        .map(p => /^\d+$/.test(p) ? (p.replace(/^0+/, '') || '0') : p);
}

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

        const partes = tokenizar(expediente);
        if (partes.length === 0) return null;
        const buscado = partes.join('|');

        const coincidencias = candidatos.filter(archivo => {
            // Se recorta el timestamp ANTES de comparar: si no, el año de la corrida
            // matchea el año del expediente (un expediente 2026 daría por bueno el PDF
            // de otro año generado en 2026) y se devuelve el archivo equivocado.
            const base = archivo
                .toLowerCase()
                .replace(SUFIJO_TIMESTAMP, '')
                .replace(/\.pdf$/, '')
                .replace(PREFIJO, '');

            // Comparación por componente, NO por subcadena: la versión original pedía
            // que el nombre "contuviera" cada parte, y así el expediente 18745/2017
            // podía dar por bueno el PDF de, por ejemplo, 118745/2017 — enlazar el
            // informe de otro expediente es peor que no enlazar ninguno. La comparación
            // es entre componentes ya normalizados (ver tokenizar), así que la
            // diferencia de ceros a la izquierda entre lo que tipea el usuario y lo
            // que devuelve el PJN NO cuenta como expediente distinto.
            return tokenizar(base).join('|') === buscado;
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
