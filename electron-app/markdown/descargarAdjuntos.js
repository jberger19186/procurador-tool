// descargarAdjuntos.js — Módulo Markdown/Anonimización, bloque M3.
/**
 * Descarga y unifica los documentos vinculados al informe (despachos, cédulas,
 * DEOs, sentencias) — los enlaces `-> Ver documento` que `extraerPdfAMarkdown.js`
 * (M2) deja marcados en la tabla de "Movimientos", sin resolver.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ESCENARIO A, CONFIRMADO POR M0 — por eso este módulo es tan simple
 * ═══════════════════════════════════════════════════════════════════════════
 * Los documentos del SCW se descargan con un `fetch` sin cookies ni sesión
 * (`spike-markdown-M0-2026-08-26.md`, P2): NO se abre Chrome, NO se usa
 * Puppeteer, y el candado de ejecución (`active_executions`) nunca entra en
 * juego. Si esto cambiara en el futuro (el SCW empieza a exigir sesión), este
 * módulo dejaría de funcionar tal cual está — no intentar "arreglarlo" con un
 * fallback silencioso a Puppeteer, es una decisión de producto (ver R1 del
 * plan), no un detalle de implementación.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  🚨 ALLOWLIST DE HOST — no es opcional (adelanto de S10 de SEC-2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Los enlaces salen de anotaciones `Link` del PDF, es decir, del DOCUMENTO,
 * no de nuestro código. Un informe corrupto o manipulado podría llevar un
 * enlace a `http://127.0.0.1:3443/`, a `169.254.169.254` (metadata de nube) o
 * a un `file://` — sin la allowlist, este módulo sería un SSRF que corre en
 * la máquina del abogado, con su red local detrás. Las 706 URLs que M0 midió
 * en producción real tienen TODAS la misma forma exacta, así que la allowlist
 * es una constante fija, no una heurística: esquema `https:`, host
 * `scw.pjn.gov.ar`, path que empieza con `/scw/viewer.seam`. Cualquier otra
 * cosa se descarta ANTES de la primera petición de red.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { extraerTextoPdf, renderizarGenericoMarkdown } = require('./extraerPdfAMarkdown');

// ─── Límites — dimensionados sobre el volumen REAL medido por M0 ───────────
// (1 a 37 adjuntos por informe, ~86 KB típico), no sobre una estimación.
const MAX_ADJUNTOS_POR_INFORME = 100;      // generoso frente al máximo medido (37)
const MAX_BYTES_POR_ADJUNTO = 20 * 1024 * 1024;   // 20 MB — un escaneo pesado cabe holgado
const MAX_BYTES_TOTAL = 200 * 1024 * 1024;        // 200 MB por corrida completa
const TIMEOUT_POR_ADJUNTO_MS = 30000;
// H-EL-12 (fase E8): el timeout de arriba es POR ADJUNTO, así que con 100 enlaces
// un servidor que responde justo por debajo del corte deja el módulo colgado hasta
// 100 × 30 s = 50 minutos, con el modal bloqueado por el guard de concurrencia
// (`isProcesandoMarkdown`) y sin forma de cancelar. El tope total corta la corrida.
// 10 min es holgado frente a lo medido por M0 (1 a 37 adjuntos de ~86 KB).
const TIMEOUT_TOTAL_MS = 10 * 60 * 1000;

const ESQUEMA_PERMITIDO = 'https:';
const HOST_PERMITIDO = 'scw.pjn.gov.ar';
const PATH_PREFIJO_PERMITIDO = '/scw/viewer.seam';

function esUrlPermitida(urlStr) {
    let u;
    try { u = new URL(urlStr); } catch (_) { return false; }
    // F7 cadena AG (2026-09-01, hallazgo H-A1-05, confirmado con Node real):
    // `u.hostname` (WHATWG URL) NO incluye el puerto — `new
    // URL('https://scw.pjn.gov.ar:9443/...').hostname` sigue dando
    // 'scw.pjn.gov.ar', así que un enlace con un puerto no estándar pasaba
    // la allowlist. El destino real sigue atado al mismo hostname (esto no
    // habilita apuntar a una IP distinta), pero la allowlist decía "host
    // scw.pjn.gov.ar" sin más — se cierra el gap exigiendo además el puerto
    // por defecto de https (`u.port===''`) o el 443 explícito.
    return u.protocol === ESQUEMA_PERMITIDO &&
           u.hostname === HOST_PERMITIDO &&
           (u.port === '' || u.port === '443') &&
           u.pathname.startsWith(PATH_PREFIJO_PERMITIDO);
}

// ─── 1. Extracción de enlaces del PDF principal ────────────────────────────
/**
 * Recorre las anotaciones `Link` del PDF en orden de aparición (página
 * ascendente, posición vertical descendente dentro de la página — mismo
 * criterio que el orden de lectura de M2) y devuelve solo las que pasan la
 * allowlist. Un enlace fuera de la allowlist se **descarta en silencio a
 * nivel de log** (se cuenta en `descartados`, no interrumpe el resto).
 *
 * @param {string} pdfPath
 * @returns {Promise<{ links: Array<{url:string, tipoDoc:string|null, pagina:number}>, descartados: number }>}
 */
async function extraerLinksInforme(pdfPath) {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

    const data = fs.readFileSync(pdfPath);
    const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(data),
        disableWorker: true,
        isEvalSupported: false,
        standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts') + path.sep,
        cMapUrl: path.join(pdfjsRoot, 'cmaps') + path.sep,
        cMapPacked: true,
    }).promise;

    const links = [];
    let descartados = 0;

    for (let numero = 1; numero <= doc.numPages; numero++) {
        const page = await doc.getPage(numero);
        const annots = await page.getAnnotations();
        const enPagina = annots
            .filter(a => a.subtype === 'Link' && typeof a.url === 'string' && a.url.length > 0)
            // rect = [x1, y1, x2, y2] — y2 (rect[3]) es el borde superior del
            // recuadro del link; orden descendente = arriba primero.
            .sort((a, b) => (b.rect?.[3] ?? 0) - (a.rect?.[3] ?? 0));

        for (const a of enPagina) {
            if (!esUrlPermitida(a.url)) { descartados++; continue; }
            let tipoDoc = null;
            try { tipoDoc = new URL(a.url).searchParams.get('tipoDoc'); } catch (_) {}
            links.push({ url: a.url, tipoDoc, pagina: numero });
        }
        page.cleanup();
    }

    await doc.destroy();
    return { links, descartados };
}

// ─── 2. Deduplicación por URL (dentro de este informe) ─────────────────────
// Hallazgo de M0: el mismo documento puede aparecer más de una vez en el
// mismo informe con la MISMA url (no es lo típico, pero no está prohibido
// por el formato) — deduplicar por URL antes de descargar evita bajar el
// mismo archivo dos veces en la misma corrida.
function deduplicarPorUrl(links) {
    const vistos = new Set();
    const unicos = [];
    for (const l of links) {
        if (vistos.has(l.url)) continue;
        vistos.add(l.url);
        unicos.push(l);
    }
    return unicos;
}

// ─── 3. Registro de deduplicación POR FILENAME (entre informes) ────────────
// Hallazgo de M0: el SCW genera un token nuevo en cada corrida del informe
// (0 de 35 URLs coinciden entre dos informes del mismo expediente, medido),
// pero el `filename` del `Content-Disposition` (`docNNNNNNNNN.pdf`) SÍ es
// estable y su contenido es byte-idéntico. Sin este registro, procesar dos
// informes del mismo expediente en una misma sesión (el caso de uso que
// M0/P3 dejó previsto: "agrupar por expediente") re-descargaría cada
// documento una vez por informe.
//
// El registro vive en memoria, por sesión de procesamiento — no hay
// necesidad de persistirlo en disco: cada corrida de M5 arranca un registro
// nuevo, y dentro de esa corrida es donde importa no duplicar descargas.
function crearRegistroAdjuntos() {
    return new Map(); // filename -> { localPath, markdown, tipoDoc }
}

// ─── 4. Descarga con límites ────────────────────────────────────────────────
/**
 * Descarga un adjunto a `destDir`, respetando el timeout y el tope de bytes
 * (aplicado DURANTE la descarga — el SCW no manda `Content-Length`, medido
 * en M0, así que no hay forma de rechazar por tamaño antes de empezar).
 *
 * @returns {Promise<{ localPath: string, filename: string, bytes: number }>}
 * @throws si excede el tope de bytes, el timeout, o la respuesta no es PDF
 */
async function descargarAUnArchivo(url, destDir) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_POR_ADJUNTO_MS);

    // S10 (2026-09-01): 🚨 EL `clearTimeout` VIVÍA EN EL `finally` DEL `fetch()`
    // DE ARRIBA — así que el timer de 30 s solo protegía el tiempo hasta que
    // LLEGARAN LOS HEADERS, no la descarga completa. Un servidor que responde
    // 200 al instante y después gotea el cuerpo (`res.write()` sin cerrar nunca
    // la respuesta — el caso "1 byte por segundo" del bloque) hace que `fetch()`
    // resuelva enseguida, el timer se cancele ahí mismo, y el bucle de
    // `reader.read()` de más abajo quede esperando bytes que nunca llegan **sin
    // ningún límite de tiempo**. Confirmado con un servidor local real: colgado
    // más de 40 s sin que el módulo abortara solo — el propio comentario de
    // `TIMEOUT_POR_ADJUNTO_MS` prometía cubrir justo este caso y no lo cubría.
    // Fix: el `AbortController` es el MISMO para el fetch inicial y para el
    // streaming del cuerpo (`res.body`), así que basta con NO cancelar el timer
    // hasta que la descarga completa termine (éxito o error) — todo el bloque
    // que sigue queda envuelto en un try/finally externo con ese único
    // `clearTimeout`. Verificado: con el fix, el mismo servidor colgado aborta
    // a los ~30 s en vez de nunca.
    try {
        let res;
        // S10: `redirect: 'manual'` — sin esto, `fetch()` sigue redirects por
        // default y el destino REAL termina siendo el que devuelva el
        // `Location` del servidor, que la allowlist de arriba NUNCA valida (esa
        // solo mira `link.url`, la URL original extraída del PDF, en
        // `extraerLinksInforme`). Confirmado con 2 servidores locales: un
        // `fetch()` por default siguió un 302 de un host a otro sin ninguna
        // advertencia — si `scw.pjn.gov.ar` alguna vez respondiera con un
        // redirect (servidor comprometido, DNS envenenado, MITM sin pinning),
        // este `fetch` lo seguía ciegamente hacia CUALQUIER host, incluida una
        // IP interna. M0 midió que el endpoint real siempre responde 200
        // directo, nunca redirect — así que rechazar cualquier 3xx no rompe el
        // camino feliz. Con `redirect:'manual'` una respuesta 3xx llega con
        // `res.ok=false` (status real, ej. 302), así que el chequeo `!res.ok`
        // de abajo ya la rechaza sin cambios adicionales.
        res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
        return await procesarRespuestaAdjunto(res, url, destDir);
    } finally {
        clearTimeout(timer);
    }
}

async function procesarRespuestaAdjunto(res, url, destDir) {
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar el adjunto`);

    // F5 (2026-08-31): el JSDoc de arriba prometía `@throws … o la respuesta no
    // es PDF`, pero NO había ninguna validación de tipo — la promesa era falsa.
    // Importa por lo que dice el encabezado de este módulo: si el SCW algún día
    // empieza a exigir sesión, va a responder 200 con una página HTML de login,
    // y sin este chequeo esa página se guardaba como `.pdf`, fallaba al
    // extraerse, y aparecía en el Markdown como un anexo ilegible cualquiera —
    // "un fallback silencioso", justo lo que ese comentario pide no hacer.
    // Con el chequeo, el error nombra la causa real.
    const tipo = (res.headers.get('content-type') || '').toLowerCase();
    if (tipo && !tipo.includes('pdf') && !tipo.includes('octet-stream')) {
        throw new Error(`El SCW respondió "${tipo.split(';')[0]}" en vez de un PDF (¿cambió el acceso al visor?)`);
    }
    // `res.body` puede ser null (ej. un 204) — sin esto, `getReader()` tiraba un
    // TypeError críptico en vez de un motivo legible.
    if (!res.body) throw new Error('El SCW devolvió una respuesta vacía');

    const disposition = res.headers.get('content-disposition') || '';
    const mFilename = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
    // El SCW siempre manda un filename estable (medido por M0); si algún día
    // no lo manda, se sintetiza uno a partir del token para no perder el
    // documento — nunca se asume un nombre fijo genérico que colisionaría
    // entre adjuntos distintos.
    //
    // S10 (2026-09-01): `path.basename()` neutraliza un traversal normal
    // (`../../evil.pdf` → `evil.pdf`), pero un `filename` que es LITERALMENTE
    // `.` o `..` sobrevive intacto — ninguno de los dos tiene separador que
    // `basename()` pueda recortar, y el replace de símbolos no toca los
    // puntos. `path.join(destDir, '..')` resuelve al PADRE de `destDir` (que
    // existe, es `os.tmpdir()`), y como `os.tmpdir()` existe como directorio,
    // `fs.createWriteStream()` sobre esa ruta falla con EISDIR — confirmado en
    // este mismo cambio que, SIN el listener de error agregado más abajo, ese
    // fallo tira una excepción no capturada que mata el proceso entero de
    // Electron (no solo el módulo Markdown). Se cierra la clase completa:
    // cualquier nombre saneado que quede en `.`/`..`/vacío cae al nombre
    // sintético, igual que la rama "sin Content-Disposition".
    let filename = mFilename
        ? path.basename(mFilename[1]).replace(/[\\/:"*?<>|]/g, '_')
        : null;
    if (!filename || filename === '.' || filename === '..') {
        filename = `adjunto_${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.pdf`;
    }

    const localPath = path.join(destDir, filename);
    // S10: confinamiento de defensa en profundidad — aun con el filtro de
    // arriba, si `localPath` resolviera fuera de `destDir` por cualquier vía
    // no anticipada, se rechaza antes de tocar el disco en vez de confiar en
    // que el saneo de más arriba sea exhaustivo.
    const destDirResuelto = path.resolve(destDir);
    if (path.resolve(localPath) !== path.join(destDirResuelto, filename)) {
        throw new Error('Nombre de archivo de adjunto no permitido');
    }
    const writeStream = fs.createWriteStream(localPath);
    // S10: sin este listener, cualquier error de escritura (EISDIR, ENOSPC,
    // permisos) queda como 'error' sin oyente — Node lo re-lanza como
    // excepción NO capturada y tira abajo el proceso completo de Electron.
    // Confirmado reproduciendo el caso `filename===".."` de arriba antes del
    // fix: crasheaba el proceso entero, no solo esta descarga.
    let errorEscritura = null;
    writeStream.on('error', (e) => { errorEscritura = e; });

    let bytes = 0;
    const reader = res.body.getReader();
    try {
        while (true) {
            if (errorEscritura) throw errorEscritura;
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > MAX_BYTES_POR_ADJUNTO) {
                throw new Error(`El adjunto supera el máximo de ${MAX_BYTES_POR_ADJUNTO / (1024 * 1024)} MB`);
            }
            await new Promise((resolve, reject) => {
                writeStream.write(Buffer.from(value), (err) => err ? reject(err) : resolve());
            });
        }
    } finally {
        writeStream.end();
        // Sin esto, un error a mitad de escritura deja el archivo abierto en
        // el proceso y `fs.rmSync` del temporal puede fallar en Windows.
        await new Promise((resolve) => writeStream.on('close', resolve));
    }

    return { localPath, filename, bytes };
}

// ─── 5. Orquestación: descargar todos los links de un informe ─────────────
/**
 * @param {Array<{url:string, tipoDoc:string|null, pagina:number}>} links - ya deduplicados por URL
 * @param {object} opts
 * @param {string} opts.tempDir - directorio temporal de descarga (ver crearDirTemporalSeguro)
 * @param {Map} [opts.registro] - registro compartido para dedup por filename ENTRE
 *   INFORMES DEL MISMO EXPEDIENTE. F7 cadena AG (2026-09-01, hallazgo H-A1-01): el
 *   filename del SCW (`docNNNNNNNNN.pdf`) es estable entre corridas del MISMO
 *   expediente (M0 lo confirmó con md5 byte-idéntico), pero NO es único entre
 *   expedientes DISTINTOS — nada impide que dos causas tengan un adjunto con nombre
 *   coincidente. Compartir este `Map` entre expedientes distintos hace que el
 *   segundo pise el resultado del primero en silencio (fuga de contenido de una
 *   causa a otra). Hoy el único llamador real (`main.js:procesar-markdown-pdf`) NO
 *   pasa este parámetro — cada llamada crea su propio registro vacío, así que la
 *   condición no es alcanzable en el código que se distribuye. Si en el futuro se
 *   agrega un modo batch que SÍ comparta un registro, tiene que namespacearlo por
 *   expediente (ver `expedienteKey()`), nunca pasar uno global.
 * @param {(evento: object) => void} [opts.onProgress] - callback opcional para UI (M5)
 * @returns {Promise<{ adjuntos: Array, errores: Array }>}
 *   adjuntos: [{ url, tipoDoc, pagina, filename, localPath, reusado, bytes }]
 *   errores:  [{ url, motivo }]
 */
async function descargarAdjuntos(links, opts) {
    const { tempDir, registro = crearRegistroAdjuntos(), onProgress = () => {} } = opts;

    if (links.length > MAX_ADJUNTOS_POR_INFORME) {
        throw new Error(
            `El informe tiene ${links.length} adjuntos, por encima del máximo soportado ` +
            `(${MAX_ADJUNTOS_POR_INFORME}). No se descarga ninguno — revisar el PDF de origen.`
        );
    }

    const adjuntos = [];
    const errores = [];
    let bytesTotales = 0;
    let topeTotalAlcanzado = false;
    // H-EL-12: reloj de pared de toda la corrida. Se mide desde acá y se chequea
    // ANTES de cada petición, con el mismo patrón que `topeTotalAlcanzado` (afuera
    // del try, para que el corte no se confunda con el error de un adjunto).
    const iniciadoEn = Date.now();
    let timeoutTotalAlcanzado = false;

    for (let i = 0; i < links.length; i++) {
        const link = links[i];

        if (!timeoutTotalAlcanzado && (Date.now() - iniciadoEn) > TIMEOUT_TOTAL_MS) {
            timeoutTotalAlcanzado = true;
        }
        if (timeoutTotalAlcanzado) {
            errores.push({
                url: link.url,
                motivo: `Se alcanzó el tope de ${TIMEOUT_TOTAL_MS / 60000} min de descarga — no se descargó`
            });
            continue;
        }

        // 🚨 F5 (2026-08-31): el chequeo del tope TOTAL estaba DENTRO del
        // try/catch de abajo, así que su `throw` se capturaba como un error más
        // del adjunto y el bucle seguía — y `bytesTotales` ya había quedado por
        // encima del tope, de modo que cada adjunto siguiente se descargaba
        // ENTERO a disco y recién después se borraba. O sea: el tope limitaba
        // los bytes CONSERVADOS, no los descargados. Con los otros dos límites
        // vigentes (100 adjuntos × 20 MB) el peor caso eran ~2 GB bajados por la
        // conexión del abogado bajo un tope declarado de 200 MB. Ahora corta de
        // verdad, ANTES de la petición de red.
        if (topeTotalAlcanzado) {
            errores.push({ url: link.url, motivo: `Se alcanzó el tope de ${MAX_BYTES_TOTAL / (1024 * 1024)} MB totales — no se descargó` });
            continue;
        }

        onProgress({ tipo: 'descarga-inicio', index: i, total: links.length, url: link.url });

        try {
            const { localPath, filename, bytes } = await descargarAUnArchivo(link.url, tempDir);

            if (registro.has(filename)) {
                // Ya se bajó (y ya se extrajo a Markdown) en un informe anterior
                // de esta misma corrida — se descarta la copia recién bajada y
                // se reusa el resultado guardado.
                fs.unlinkSync(localPath);
                const previo = registro.get(filename);
                // F5: `localPath: null` — el del informe anterior apuntaba a un
                // temporal ya borrado. Nadie lo lee en la rama `reusado` (el
                // contenido viene de `markdown`), pero devolver una ruta muerta
                // invita a que alguien la use más adelante.
                adjuntos.push({ ...link, filename, localPath: null, reusado: true, bytes: 0, markdown: previo.markdown });
                onProgress({ tipo: 'descarga-fin', index: i, total: links.length, filename, reusado: true });
                continue;
            }

            bytesTotales += bytes;
            if (bytesTotales > MAX_BYTES_TOTAL) {
                fs.unlinkSync(localPath);
                topeTotalAlcanzado = true;   // F5 — corta los siguientes, ver arriba
                throw new Error(`Tope de ${MAX_BYTES_TOTAL / (1024 * 1024)} MB totales alcanzado`);
            }

            adjuntos.push({ ...link, filename, localPath, reusado: false, bytes });
            onProgress({ tipo: 'descarga-fin', index: i, total: links.length, filename, reusado: false });
        } catch (error) {
            errores.push({ url: link.url, motivo: error.message });
            onProgress({ tipo: 'descarga-error', index: i, total: links.length, url: link.url, error: error.message });
        }
    }

    return { adjuntos, errores };
}

// ─── 6. Extracción de cada adjunto a Markdown + concatenación ordenada ─────
/**
 * @param {Array} adjuntos - salida de `descargarAdjuntos`
 * @param {Map} registro - el mismo registro pasado a `descargarAdjuntos`
 * @param {(evento: object) => void} [onProgress]
 * @returns {Promise<{ markdown: string, paginasSinTexto: Array<{filename:string, pagina:number}> }>}
 */
async function extraerAdjuntosAMarkdown(adjuntos, registro, onProgress = () => {}) {
    const bloques = [];
    const paginasSinTextoTotal = [];
    let numeroAnexo = 0;

    for (const adj of adjuntos) {
        numeroAnexo++;
        const titulo = `## Anexo ${numeroAnexo} — ${adj.tipoDoc || 'documento'} (${adj.filename})`;

        if (adj.reusado) {
            // El contenido ya se extrajo antes en esta misma corrida — se
            // reusa tal cual, solo se renumera el título del anexo.
            bloques.push(`${titulo}\n\n${adj.markdown}`);
            // F5 (2026-08-31): también hay que reponer sus páginas sin texto.
            // Antes esta rama no acumulaba nada, así que el resumen que ve el
            // usuario ("N páginas sin texto extraíble") salía bajo justamente
            // en los documentos escaneados, que son los que más importan —
            // M0 midió 14,6% de páginas sin texto en los adjuntos del SCW.
            (registro.get(adj.filename)?.paginasSinTexto || [])
                .forEach(p => paginasSinTextoTotal.push({ filename: adj.filename, pagina: p }));
            continue;
        }

        onProgress({ tipo: 'extraccion-inicio', filename: adj.filename });
        try {
            const { paginas } = await extraerTextoPdf(adj.localPath);
            const { markdown, paginasSinTexto } = renderizarGenericoMarkdown(paginas);
            bloques.push(`${titulo}\n\n${markdown}`);
            // F5: se guarda `paginasSinTexto` (lo consume la rama `reusado` de
            // arriba) y NO se guarda `localPath`: apuntaba dentro del `tempDir`
            // que `procesarAdjuntosDeInforme` borra en su `finally`, así que era
            // una ruta muerta apenas terminaba la corrida — y el registro está
            // pensado para compartirse ENTRE corridas.
            registro.set(adj.filename, { markdown, tipoDoc: adj.tipoDoc, paginasSinTexto });
            paginasSinTexto.forEach(p => paginasSinTextoTotal.push({ filename: adj.filename, pagina: p }));
            onProgress({ tipo: 'extraccion-fin', filename: adj.filename });
        } catch (error) {
            bloques.push(`${titulo}\n\n> [No se pudo extraer el texto de este documento: ${error.message}]`);
            onProgress({ tipo: 'extraccion-error', filename: adj.filename, error: error.message });
        }
    }

    return { markdown: bloques.join('\n\n'), paginasSinTexto: paginasSinTextoTotal };
}

// ─── 7. Directorio temporal seguro (efímero, propio de este módulo) ───────
// No es el mismo temporal protegido de `src/security/secureTempFolder.js`
// (ese es para scripts de automatización descifrados, con su propio
// contrato de seguridad) — este es un directorio de trabajo genérico bajo
// el temp del sistema, con nombre aleatorio, que se borra al terminar.
function crearDirTemporalSeguro() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'procurador-markdown-'));
}

/**
 * Pipeline completo de M3: PDF de informe → adjuntos descargados y
 * extraídos → un bloque de Markdown listo para concatenar con el resultado
 * de M2 (`renderizarInformeMarkdown`). Limpia el temporal SIEMPRE, incluso
 * si algo falla a mitad de camino — el contenido útil ya quedó en el
 * Markdown devuelto, no en los PDF descargados.
 *
 * @param {string} pdfPath
 * @param {object} [opts]
 * @param {Map} [opts.registro] - compartir entre varias llamadas para
 *   deduplicar adjuntos repetidos entre informes del mismo expediente
 * @param {(evento: object) => void} [opts.onProgress]
 * @returns {Promise<{ markdown: string, totalAdjuntos: number, descartadosPorAllowlist: number, errores: Array, paginasSinTexto: Array }>}
 */
async function procesarAdjuntosDeInforme(pdfPath, opts = {}) {
    const { registro = crearRegistroAdjuntos(), onProgress = () => {} } = opts;
    const tempDir = crearDirTemporalSeguro();

    try {
        const { links, descartados } = await extraerLinksInforme(pdfPath);
        const unicos = deduplicarPorUrl(links);

        const { adjuntos, errores } = await descargarAdjuntos(unicos, { tempDir, registro, onProgress });
        const { markdown, paginasSinTexto } = await extraerAdjuntosAMarkdown(adjuntos, registro, onProgress);

        return {
            markdown,
            totalAdjuntos: adjuntos.length,
            descartadosPorAllowlist: descartados,
            errores,
            paginasSinTexto,
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

module.exports = {
    esUrlPermitida,
    extraerLinksInforme,
    deduplicarPorUrl,
    crearRegistroAdjuntos,
    descargarAdjuntos,
    extraerAdjuntosAMarkdown,
    procesarAdjuntosDeInforme,
    MAX_ADJUNTOS_POR_INFORME,
    MAX_BYTES_POR_ADJUNTO,
    MAX_BYTES_TOTAL,
    TIMEOUT_TOTAL_MS,
};
