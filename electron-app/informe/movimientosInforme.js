// movimientosInforme.js
/**
 * Movimientos del informe, para el snapshot de Bitácora.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * El visor del informe mandaba `movs: '[]'` fijo al capturar hacia Bitácora, así
 * que todo snapshot de informe quedaba con `{"movimientos": []}` y el modal del
 * portal mostraba "Sin movimientos registrados" sobre un informe que sí los
 * tenía. Medido en producción: los 2 de 2 snapshots `kind='informe'` que existen
 * están vacíos, mientras los de procuración traen 1.400-1.700 caracteres.
 *
 * DE DÓNDE SALE EL DATO, Y POR QUÉ DE ACÁ Y NO DEL STDOUT
 * -------------------------------------------------------
 * `informequickscwpjn.js` ya persiste los movimientos como JSON estructurado, en
 * `<PROCURADOR_DATA_DIR>/descargas/<identificador>_temp/<expediente>_backup/
 * listaMovimientos.json` — es su propio mecanismo de backup/resume, no algo que
 * se agregue acá. Son los MISMOS objetos con los que arma el PDF.
 *
 * La alternativa evaluada era raspar el stdout, como hacen `motivoInformeSinPDF`
 * y `caratulaInformeExitoso` en el módulo hermano. Se descartó por medición, no
 * por preferencia — esos dos parsean el payload `RESULT: {...}` (una línea JSON
 * emitida a propósito), mientras que los movimientos solo salen como texto libre
 * de log, y ese texto es ambiguo:
 *
 *   · Al menos 3 emisores comparten el prefijo `Página N | Fila N`
 *     (testM2.js:682 actuales, :1020 históricos, :1596 notas), y lo único que
 *     separa actuales de históricos es `Tipo:` vs `Tipo actuación:`.
 *   · `Detalle` es texto libre del PJN y puede contener el separador `|`.
 *   · El script reintenta hasta 10 veces; una extracción parcial que falla ya
 *     dejó sus líneas en el stdout, así que puede haber duplicados.
 *
 * El JSON no tiene ninguno de esos problemas: los actuales viven en su propio
 * archivo, con los campos ya separados.
 *
 * CICLO DE VIDA DEL ARCHIVO (por qué está ahí cuando lo leemos)
 * ------------------------------------------------------------
 * `inicializarEstadoSecciones()` borra la carpeta de backup al INICIO de cada
 * corrida y nada la borra al final (verificado: el único `rmSync` del script es
 * ese). O sea que al terminar el fork el archivo es de ESA corrida y sigue en
 * disco — que es justo cuando main.js lo lee. Aun así se exige `mtime >= desdeMs`
 * como red: si la corrida murió antes de escribirlo, se prefiere devolver `[]`
 * antes que arrastrar el de una corrida vieja.
 *
 * SOLO LOS MOVIMIENTOS ACTUALES, A PROPÓSITO
 * ------------------------------------------
 * El informe extrae dos tablas distintas (`listaMovimientos` y
 * `listaMovimientosHistoricos`). El análogo del snapshot de procuración —"qué vio
 * esta corrida"— son los ACTUALES; los históricos son otra sección del informe y
 * mezclarlos daría un listado que no corresponde a ninguna pantalla del producto.
 *
 * Nunca lanza: ante cualquier problema devuelve `[]`, que es exactamente el
 * comportamiento actual (un snapshot sin movimientos). Es decir, el peor caso de
 * este módulo es no mejorar nada — nunca romper el flujo de captura.
 */
const fs = require('fs');
const path = require('path');

/**
 * Tope por caso. Igual que el `maxMovimientos` de la config de procuración (15),
 * y no por casualidad: `captureDrafts.js` rechaza entero cualquier borrador de
 * más de 256 KB (`DRAFT_TOO_LARGE` → el usuario ve `captura=lote_grande`), y ese
 * presupuesto está dimensionado sobre "200 casos × 15 movimientos". Un informe
 * real trae ~95 movimientos, así que mandarlos todos en un lote convertiría una
 * captura que hoy funciona en una que se rechaza.
 */
const MAX_MOVS_DEFAULT = 15;

/** Misma normalización que usa el script para nombrar la carpeta de backup. */
function carpetaBackupDe(expediente) {
    const base = String(expediente || '').replace(/[^a-zA-Z0-9]/g, '_');
    return `${base || 'Expediente_Desconocido'}_backup`;
}

/**
 * Solo los 3 campos que el backend conserva (`parseMovs` en routes/capture.js
 * recorta a fecha/tipo/detalle). Mandar el resto solo engordaría el borrador
 * contra el tope de 256 KB sin que nada lo lea.
 */
function normalizarMovimiento(m) {
    return {
        fecha:   String(m?.fecha   ?? '').trim(),
        tipo:    String(m?.tipo    ?? '').trim(),
        detalle: String(m?.detalle ?? '').trim(),
    };
}

/**
 * Lee los movimientos actuales que dejó la corrida del informe.
 *
 * El nombre de la carpeta `<identificador>_temp` no se reconstruye: el script
 * resuelve `identificador` con un default propio (`process.argv[3] || <CUIT
 * hardcodeado>`, más el caso `'default'`), y en la carpeta real conviven
 * `27320694359_temp` y `default_temp`. Duplicar esa constante acá sería el mismo
 * error que ya rompió la búsqueda de PDF en v2.7.33 — así que se buscan todos los
 * `*_temp` y gana el más reciente por mtime, el mismo criterio que `latestFileBy()`
 * usa en main.js desde v2.7.35.
 *
 * @param {string} descargasDir Carpeta `descargas` del usuario.
 * @param {string} expediente   Expediente tal como se le pasó al script.
 * @param {{max?:number, desdeMs?:number}} [opciones]
 * @returns {Array<{fecha:string,tipo:string,detalle:string}>} `[]` si no hay nada legible.
 */
function leerMovimientosInforme(descargasDir, expediente, opciones = {}) {
    const max = Number.isInteger(opciones.max) && opciones.max > 0 ? opciones.max : MAX_MOVS_DEFAULT;
    const desdeMs = Number.isFinite(opciones.desdeMs) ? opciones.desdeMs : 0;
    try {
        const carpeta = carpetaBackupDe(expediente);
        let mejor = null;
        for (const dir of fs.readdirSync(descargasDir, { withFileTypes: true })) {
            if (!dir.isDirectory() || !dir.name.endsWith('_temp')) continue;
            const archivo = path.join(descargasDir, dir.name, carpeta, 'listaMovimientos.json');
            let st;
            try { st = fs.statSync(archivo); } catch (_) { continue; }
            if (!st.isFile() || st.mtimeMs < desdeMs) continue;
            if (!mejor || st.mtimeMs > mejor.mtimeMs) mejor = { archivo, mtimeMs: st.mtimeMs };
        }
        if (!mejor) return [];
        const datos = JSON.parse(fs.readFileSync(mejor.archivo, 'utf8'));
        if (!Array.isArray(datos)) return [];
        // El script escribe en orden de lectura del PJN (página 1 / fila 1 = el más
        // reciente), el mismo con el que arma el PDF: recortar por el principio deja
        // los N últimos movimientos, que es lo que muestra el snapshot de procuración.
        return datos.slice(0, max).map(normalizarMovimiento);
    } catch (_) {
        return [];
    }
}

module.exports = { leerMovimientosInforme, MAX_MOVS_DEFAULT };
