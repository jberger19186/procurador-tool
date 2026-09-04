// movimientosInforme.js
/**
 * Movimientos y secciones del informe, para el snapshot de Bitácora.
 *
 * EL PROBLEMA QUE RESUELVE (fix original, 2026-09-04)
 * -----------------------------------------------------
 * El visor del informe mandaba `movs: '[]'` fijo al capturar hacia Bitácora, así
 * que todo snapshot de informe quedaba con `{"movimientos": []}` y el modal del
 * portal mostraba "Sin movimientos registrados" sobre un informe que sí los
 * tenía. Medido en producción: los 2 de 2 snapshots `kind='informe'` que existen
 * están vacíos, mientras los de procuración traen 1.400-1.700 caracteres.
 *
 * DE DÓNDE SALE EL DATO, Y POR QUÉ DE ACÁ Y NO DEL STDOUT
 * -------------------------------------------------------
 * `informequickscwpjn.js` ya persiste cada sección tildada como JSON estructurado,
 * en `<PROCURADOR_DATA_DIR>/descargas/<identificador>_temp/<expediente>_backup/` —
 * es su propio mecanismo de backup/resume, no algo que se agregue acá. Son los
 * MISMOS objetos con los que arma el PDF.
 *
 * La alternativa evaluada para los movimientos actuales era raspar el stdout,
 * como hacen `motivoInformeSinPDF` y `caratulaInformeExitoso` en el módulo
 * hermano. Se descartó por medición, no por preferencia — esos dos parsean el
 * payload `RESULT: {...}` (una línea JSON emitida a propósito), mientras que los
 * movimientos solo salen como texto libre de log, y ese texto es ambiguo:
 *
 *   · Al menos 3 emisores comparten el prefijo `Página N | Fila N`
 *     (testM2.js:682 actuales, :1020 históricos, :1596 notas), y lo único que
 *     separa actuales de históricos es `Tipo:` vs `Tipo actuación:`.
 *   · `Detalle` es texto libre del PJN y puede contener el separador `|`.
 *   · El script reintenta hasta 10 veces; una extracción parcial que falla ya
 *     dejó sus líneas en el stdout, así que puede haber duplicados.
 *
 * El JSON no tiene ninguno de esos problemas: cada sección vive en su propio
 * archivo, con los campos ya separados.
 *
 * CICLO DE VIDA DE LA CARPETA DE BACKUP (por qué está ahí cuando la leemos)
 * ---------------------------------------------------------------------------
 * `inicializarEstadoSecciones()` borra la carpeta de backup al INICIO de cada
 * corrida y nada la borra al final (verificado: el único `rmSync` del script es
 * ese). O sea que al terminar el fork la carpeta es de ESA corrida y sigue en
 * disco — que es justo cuando main.js la lee. Aun así se exige `mtime >= desdeMs`
 * sobre el archivo ancla (`listaMovimientos.json`) como red: si la corrida murió
 * antes de escribir sus backups, se prefiere devolver todo vacío antes que
 * arrastrar los de una corrida vieja. Los 7 archivos de una misma carpeta
 * (`datosGenerales`, `listaMovimientos`, `listaMovimientosHistoricos`,
 * `intervinientes`, `vinculados`, `recursos`, `notas`) los escribe la MISMA
 * corrida, así que basta con anclar por el mtime de uno solo.
 *
 * SOLO LOS MOVIMIENTOS ACTUALES SON "EL SNAPSHOT DE ESTA CORRIDA"
 * -------------------------------------------------------------------
 * El análogo del snapshot de procuración —"qué vio esta corrida"— son los
 * movimientos ACTUALES. Las demás secciones (históricos, intervinientes,
 * vinculados, recursos, notas) son contenido adicional del informe, no "lo que
 * pasó desde la última vez" — se guardan igual (a pedido explícito del
 * operador, 2026-09-04), pero cada una en su propia clave, nunca mezcladas con
 * `movimientos`.
 *
 * SECCIONES EXTRA (2026-09-04) — CADA BACKUP EXISTE SOLO SI SE TILDÓ LA SECCIÓN
 * ---------------------------------------------------------------------------
 * `informequickscwpjn.js` persiste hasta 7 archivos de backup, uno por sección
 * que el usuario tildó al generar el informe (`datosGenerales.json` queda afuera
 * a propósito — carátula y situación ya viajan por otros campos del snapshot):
 *
 *   listaMovimientos.json            → movimientos actuales (cubierto arriba)
 *   listaMovimientosHistoricos.json  → MISMA forma que los actuales
 *   intervinientes.json              → string[], tabla del PJN sin parsear
 *   vinculados.json                  → string[] ídem
 *   recursos.json                    → string[] ídem
 *   notas.json                       → string[] ídem
 *
 * La ausencia de un archivo es NORMAL (la sección no se tildó), no un error —
 * mismo criterio que ya se aplicaba a `listaMovimientos.json` ausente: lista
 * vacía, nunca una excepción.
 *
 * 🚨 LAS SECCIONES DE TEXTO NO SON HOMOGÉNEAS
 * ---------------------------------------------
 * `intervinientes`/`vinculados`/`recursos`/`notas` son `string[]` con el texto
 * crudo de la tabla del PJN — separador `|` y saltos de línea embebidos, con
 * filas de encabezado, filas vacías y (medido en un fixture real de
 * `FCR 751/2025`) el contenido completo DUPLICADO: 26 entradas crudas de
 * intervinientes, 5 reales.
 *
 * La limpieza de intervinientes YA EXISTE, en `backend-server/scripts/testM2.js`
 * líneas 2156-2177 (`intervinientesProcesados` + `[...new Set(...)]`): descarta
 * vacíos, la fila de encabezado `TIPO|NOMBRE|TOMO/FOLIO :`, el prefijo `TIPO :`,
 * y deduplica. Ese código vive en un script CIFRADO — no se puede importar acá,
 * así que `limpiarIntervinientes()` de abajo lo REPLICA a propósito, línea por
 * línea (ver el comentario en esa función).
 *
 * ⚠️ `vinculados`/`recursos`/`notas` NO reciben esa misma limpieza. `testM2.js`
 * los pasa CRUDOS a `agregarSeccion()` (sin el procesamiento de intervinientes),
 * así que no hay evidencia de que compartan el formato de tabla de intervinientes
 * — tratarlas con la MISMA lógica sería inventado, no medido, y es exactamente
 * el error que hay que evitar acá: un normalizador genérico que "arregla" una
 * sección de más (o rompe intervinientes de menos). Reciben solo un recorte de
 * espacios y filtro de vacíos.
 *
 * 🚨 LAS SECCIONES VACÍAS TRAEN UN MENSAJE, NO UN ARRAY VACÍO
 * ---------------------------------------------------------------
 * Medido en fixtures reales:
 *   vinculados.json  vacío → ["El expediente no posee vinculados posibles de ser visualizados."]
 *   recursos.json    vacío → ["El expediente no posee recursos"]
 *   notas.json       vacío → ["El expediente no posee notas"]
 *   historicos vacío       → [{ "tipo": "info", "detalle": "El expediente no posee actuaciones históricas." }]
 * Sin detectarlos, el modal mostraría "Recursos (1): El expediente no posee
 * recursos" — peor que no mostrar nada, porque parece contenido real. El de
 * históricos usa el MISMO criterio que `testM2.js:2135` ya usa para armar el PDF
 * (`length===1 && tipo==='info'`, no el texto del mensaje — más robusto si el
 * PJN cambia la redacción exacta). Los 3 de texto comparten el prefijo literal
 * "El expediente no posee", así que un solo patrón (`RE_SECCION_VACIA`) cubre
 * los 3 — y de paso protege a intervinientes si algún día trajera el mismo
 * mensaje, aunque eso no se haya observado en ningún fixture real.
 *
 * TOPE POR SECCIÓN — el mismo para las 6
 * -----------------------------------------
 * Igual que el `maxMovimientos` de la config de procuración (15 por default), y
 * no por casualidad: `captureDrafts.js` rechaza entero cualquier borrador de más
 * de 256 KB (`DRAFT_TOO_LARGE` → el usuario ve `captura=lote_grande`), y ese
 * presupuesto está dimensionado con esta cota en mente. El tope se aplica DESPUÉS
 * de limpiar/deduplicar cada sección — "hasta 15" quiere decir 15 entradas
 * reales, no 15 filas crudas de las que la mitad son basura.
 *
 * GARANTÍA: nunca lanza. Ante cualquier problema (carpeta ausente, JSON
 * corrupto, sección con forma inesperada) cada función devuelve `[]` para esa
 * sección puntual, sin afectar a las demás — el peor caso es no mejorar nada,
 * nunca romper la captura.
 */
const fs = require('fs');
const path = require('path');

/**
 * Tope por sección y por caso. Ver "TOPE POR SECCIÓN" arriba.
 */
const MAX_MOVS_DEFAULT = 15;

/** Misma normalización que usa el script para nombrar la carpeta de backup. */
function carpetaBackupDe(expediente) {
    const base = String(expediente || '').replace(/[^a-zA-Z0-9]/g, '_');
    return `${base || 'Expediente_Desconocido'}_backup`;
}

function normalizarMax(valor) {
    return Number.isInteger(valor) && valor > 0 ? valor : MAX_MOVS_DEFAULT;
}

function normalizarDesdeMs(valor) {
    return Number.isFinite(valor) ? valor : 0;
}

/**
 * Solo los 3 campos que el backend conserva (`parseMovs` en routes/capture.js
 * recorta a fecha/tipo/detalle). Mandar el resto solo engordaría el borrador
 * contra el tope de 256 KB sin que nada lo lea. Se reusa tal cual para
 * `listaMovimientos.json` y para `listaMovimientosHistoricos.json` — ambos
 * archivos comparten exactamente esta forma.
 */
function normalizarMovimiento(m) {
    return {
        fecha:   String(m?.fecha   ?? '').trim(),
        tipo:    String(m?.tipo    ?? '').trim(),
        detalle: String(m?.detalle ?? '').trim(),
    };
}

/** Lee un JSON y devuelve el array, o `[]` ante cualquier problema (archivo
 *  ausente, JSON corrupto, o JSON válido pero no-array). Nunca lanza — es el
 *  punto donde se aísla el fallo de UNA sección para que no arrastre a las
 *  demás (una `intervinientes.json` corrupta no debe vaciar `movimientos`). */
function leerArraySeguro(archivo) {
    try {
        const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
        return Array.isArray(datos) ? datos : [];
    } catch (_) {
        return [];
    }
}

/** `true` si el array son movimientos históricos "vacíos" — mismo criterio que
 *  usa `testM2.js:2135` para el PDF: no se mira el texto del mensaje (frágil
 *  ante un cambio de redacción del PJN), se mira la FORMA (1 solo elemento,
 *  `tipo:'info'`). */
function esHistoricoVacio(arr) {
    return arr.length === 1 && arr[0] && arr[0].tipo === 'info';
}

/** Mismo mensaje de "sección vacía" que comparten vinculados/recursos/notas
 *  (y, defensivamente, intervinientes). Medido en fixtures reales: las 3
 *  arrancan literal con "El expediente no posee...". */
const RE_SECCION_VACIA = /^el expediente no posee\b/i;

function esMensajeSeccionVacia(s) {
    return typeof s === 'string' && RE_SECCION_VACIA.test(s.trim());
}

/**
 * Réplica de `backend-server/scripts/testM2.js:2156-2177` (script CIFRADO, no
 * importable desde acá) — línea por línea, a propósito, para no reintroducir el
 * bug que ya documentó el propio proyecto dos veces (duplicar código diverge en
 * silencio). Hace exactamente lo mismo que el script real:
 *   1. Recorta espacios de cada entrada.
 *   2. Descarta las vacías.
 *   3. Si la entrada es EXACTAMENTE la fila de encabezado de 3 líneas
 *      (`TIPO|NOMBRE|TOMO/FOLIO :` / `TOMO/FOLIO|I.E.J. :` / `I.E.J.`), la
 *      descarta.
 *   4. Si la primera línea es `TIPO :`, la saca (deja el resto: nombre y datos).
 *   5. Deduplica con `Set` — el fixture real trae el bloque completo repetido.
 * Después de esa limpieza (idéntica a la del script) se aplica el mismo
 * centinela de "sección vacía" que las otras 3 — no observado en ningún fixture
 * real de intervinientes, pero cubrirlo no cuesta nada.
 */
function limpiarIntervinientes(raw) {
    const procesados = raw
        .map(item => String(item ?? '').trim())          // 1
        .filter(item => item !== '')                       // 2
        .map(item => {
            const lines = item.split('\n').map(line => line.trim());
            if (lines.length === 3 &&
                lines[0] === 'TIPO|NOMBRE|TOMO/FOLIO :' &&
                lines[1] === 'TOMO/FOLIO|I.E.J. :' &&
                lines[2] === 'I.E.J.') {
                return '';                                  // 3
            }
            if (lines[0] === 'TIPO :') lines.shift();      // 4
            return lines.join('\n');
        })
        .filter(item => item !== '');

    const unicos = [...new Set(procesados)];                // 5
    if (unicos.length === 1 && esMensajeSeccionVacia(unicos[0])) return [];
    return unicos;
}

/**
 * `vinculados`/`recursos`/`notas`: SIN la limpieza de intervinientes (ver la
 * nota grande de arriba, "LAS SECCIONES DE TEXTO NO SON HOMOGÉNEAS") — solo
 * recorte de espacios, filtro de vacíos, y el mismo centinela de sección vacía.
 *
 * `descartarEncabezado` (2026-09-04, tras la corrida real): `vinculados` y
 * `recursos` traen la fila de ENCABEZADO de la tabla del PJN como un item más
 * (`"EXPEDIENTE|DEPENDENCIA|SITUACION|CARATULA|ULT. ACT.|"`), así que el modal
 * mostraba "Vinculados (2)" cuando había 1 solo real, y el encabezado gastaba
 * uno de los 15 lugares.
 *
 * NO se detecta por el texto: es ESTRUCTURAL y por eso se descarta por posición.
 * El extractor de `testM2.js:1504-1510` hace
 * `table.querySelectorAll('tr')` sobre la tabla ENTERA y `querySelectorAll('th, td')`
 * por fila — o sea recorre también el `<thead>` y captura celdas `<th>`. Como el
 * `<thead>` va primero en el DOM, el encabezado es SIEMPRE la primera fila, en
 * cualquier expediente y cualquier fuero. Y a diferencia de `intervinientes`
 * —que concatena 3 tablas (`tablaIntervinientes`+`tablaPartes`+`tablaFiscales`)
 * y por eso repite su encabezado 3 veces, motivo por el cual `testM2.js` sí lo
 * limpia allá— estas dos secciones tienen UNA tabla, así que aparece una vez.
 *
 * `notas` queda afuera a propósito: la extrae `extraerTablaNotas()`, otro
 * camino con sus propios selectores, y su salida real NO trae encabezado
 * (verificado en el backup de la corrida del 2026-09-04).
 *
 * ⚠️ El orden importa: el centinela de sección vacía se evalúa ANTES. Si no,
 * un `["El expediente no posee recursos"]` perdería su único elemento por
 * "encabezado" y la sección quedaría vacía por el motivo equivocado.
 *
 * ⚠️ Y solo se descarta si hay MÁS DE UNA fila. Con una sola, "encabezado" y
 * "único registro real" son indistinguibles desde el texto, y equivocarse ahí
 * borra el dato entero en vez de una fila de más. La asimetría está elegida a
 * propósito: una tabla con N registros trae N+1 filas (thead + N), así que el
 * caso "solo encabezado" no se da — cuando no hay nada que listar, el script
 * ni llega a la tabla: detecta la alerta del PJN y devuelve el centinela
 * (`testM2.js:1463-1468`, `tablas = []`). O sea que una sección de una sola
 * fila que no es el centinela es un caso anómalo, y ante la duda se conserva.
 *
 * Riesgo residual asumido: si el PJN sirviera una de estas tablas sin `<thead>`
 * Y con 2+ registros, se perdería el primero. Poco probable (el HTML sale del
 * mismo componente) y acotado a 1 fila, pero no es cero.
 */
function limpiarSeccionTexto(raw, descartarEncabezado = false) {
    const limpio = raw.map(item => String(item ?? '').trim()).filter(item => item !== '');
    if (limpio.length === 1 && esMensajeSeccionVacia(limpio[0])) return [];
    if (descartarEncabezado && limpio.length > 1) return limpio.slice(1);
    return limpio;
}

/** Históricos: misma forma que los movimientos actuales, con el centinela de
 *  "sin actuaciones históricas" resuelto antes de normalizar. */
function normalizarHistoricos(raw, max) {
    if (esHistoricoVacio(raw)) return [];
    return raw.slice(0, max).map(normalizarMovimiento);
}

/**
 * Encuentra la carpeta de backup (`<*_temp>/<expediente>_backup/`) de la
 * corrida más reciente, ancladas por el mtime de `listaMovimientos.json` (el
 * único archivo que SIEMPRE existe en un informe exitoso — el resto son
 * opcionales según qué tildó el usuario, así que no sirven de ancla).
 *
 * El nombre de la carpeta `<identificador>_temp` no se reconstruye: el script
 * resuelve `identificador` con un default propio (`process.argv[3] || <CUIT
 * hardcodeado>`, más el caso `'default'`), y en la carpeta real conviven
 * `27320694359_temp` y `default_temp`. Duplicar esa constante acá sería el mismo
 * error que ya rompió la búsqueda de PDF en v2.7.33 — así que se buscan todos
 * los `*_temp` y gana el más reciente por mtime, el mismo criterio que
 * `latestFileBy()` usa en main.js desde v2.7.35.
 *
 * @returns {string|null} la carpeta de backup, o `null` si no hay ninguna
 *   corrida elegible (ausente, o más vieja que `desdeMs`).
 */
function encontrarCarpetaBackup(descargasDir, expediente, desdeMs) {
    try {
        const carpeta = carpetaBackupDe(expediente);
        let mejor = null;
        for (const dir of fs.readdirSync(descargasDir, { withFileTypes: true })) {
            if (!dir.isDirectory() || !dir.name.endsWith('_temp')) continue;
            const backupDir = path.join(descargasDir, dir.name, carpeta);
            const ancla = path.join(backupDir, 'listaMovimientos.json');
            let st;
            try { st = fs.statSync(ancla); } catch (_) { continue; }
            if (!st.isFile() || st.mtimeMs < desdeMs) continue;
            if (!mejor || st.mtimeMs > mejor.mtimeMs) mejor = { backupDir, mtimeMs: st.mtimeMs };
        }
        return mejor ? mejor.backupDir : null;
    } catch (_) {
        return null;
    }
}

/**
 * Lee los movimientos ACTUALES que dejó la corrida del informe.
 *
 * Se mantiene como función independiente (en vez de solo un campo de
 * `leerSeccionesInforme`) por compatibilidad — es la única de las dos funciones
 * públicas que ya tenía consumidores antes de esta extensión (2026-09-04):
 * ambos test suites la importan directo, y sigue siendo la forma más liviana de
 * pedir solo esta sección.
 *
 * @param {string} descargasDir Carpeta `descargas` del usuario.
 * @param {string} expediente   Expediente tal como se le pasó al script.
 * @param {{max?:number, desdeMs?:number}} [opciones]
 * @returns {Array<{fecha:string,tipo:string,detalle:string}>} `[]` si no hay nada legible.
 */
function leerMovimientosInforme(descargasDir, expediente, opciones = {}) {
    try {
        const max = normalizarMax(opciones.max);
        const desdeMs = normalizarDesdeMs(opciones.desdeMs);
        const backupDir = encontrarCarpetaBackup(descargasDir, expediente, desdeMs);
        if (!backupDir) return [];
        // El script escribe en orden de lectura del PJN (página 1 / fila 1 = el más
        // reciente), el mismo con el que arma el PDF: recortar por el principio deja
        // los N últimos movimientos, que es lo que muestra el snapshot de procuración.
        return leerArraySeguro(path.join(backupDir, 'listaMovimientos.json'))
            .slice(0, max)
            .map(normalizarMovimiento);
    } catch (_) {
        return [];
    }
}

/**
 * Lee las 6 secciones del informe (movimientos + las 5 extra), para el snapshot
 * completo de Bitácora. Resuelve la carpeta de backup UNA sola vez (no una por
 * sección) y lee cada archivo con su propio aislamiento de fallos — un
 * `intervinientes.json` corrupto no vacía `movimientos`, y viceversa.
 *
 * @param {string} descargasDir Carpeta `descargas` del usuario.
 * @param {string} expediente   Expediente tal como se le pasó al script.
 * @param {{max?:number, desdeMs?:number}} [opciones]
 * @returns {{
 *   movimientos: Array<{fecha:string,tipo:string,detalle:string}>,
 *   historicos: Array<{fecha:string,tipo:string,detalle:string}>,
 *   intervinientes: string[],
 *   vinculados: string[],
 *   recursos: string[],
 *   notas: string[]
 * }} Cada clave es `[]` si esa sección no se tildó, no existe, o no se pudo leer.
 */
function leerSeccionesInforme(descargasDir, expediente, opciones = {}) {
    const vacio = () => ({
        movimientos: [], historicos: [], intervinientes: [],
        vinculados: [], recursos: [], notas: [],
    });
    try {
        const max = normalizarMax(opciones.max);
        const desdeMs = normalizarDesdeMs(opciones.desdeMs);
        const backupDir = encontrarCarpetaBackup(descargasDir, expediente, desdeMs);
        if (!backupDir) return vacio();

        const archivo = (nombre) => path.join(backupDir, nombre);
        return {
            movimientos: leerArraySeguro(archivo('listaMovimientos.json'))
                .slice(0, max).map(normalizarMovimiento),
            historicos: normalizarHistoricos(
                leerArraySeguro(archivo('listaMovimientosHistoricos.json')), max
            ),
            intervinientes: limpiarIntervinientes(
                leerArraySeguro(archivo('intervinientes.json'))
            ).slice(0, max),
            // `true` = descartar la fila de encabezado (ver `limpiarSeccionTexto`).
            vinculados: limpiarSeccionTexto(
                leerArraySeguro(archivo('vinculados.json')), true
            ).slice(0, max),
            recursos: limpiarSeccionTexto(
                leerArraySeguro(archivo('recursos.json')), true
            ).slice(0, max),
            // `notas` NO: otro extractor, su salida real no trae encabezado.
            notas: limpiarSeccionTexto(
                leerArraySeguro(archivo('notas.json'))
            ).slice(0, max),
        };
    } catch (_) {
        return vacio();
    }
}

module.exports = {
    leerMovimientosInforme,
    leerSeccionesInforme,
    MAX_MOVS_DEFAULT,
};
