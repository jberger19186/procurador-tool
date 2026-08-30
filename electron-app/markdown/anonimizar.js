// anonimizar.js — Módulo Markdown/Anonimización, bloque M4.
/**
 * Motor de anonimización + generación del `mapping.txt` editable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  🚨 ESTE ARCHIVO TIENE UN MODO DE FALLA SILENCIOSO
 * ═══════════════════════════════════════════════════════════════════════════
 * Un nombre que el motor NO detecta no produce ningún error: produce un
 * archivo que *parece* anonimizado y no lo está, que el usuario va a
 * compartir. Por eso:
 *
 *   · Toda entidad detectada se escribe en el `mapping.txt`, visible y
 *     editable — lo que ves en el mapping es EXACTAMENTE lo que se
 *     reemplaza, sin magia oculta.
 *   · El mapping se aplica SIEMPRE sobre el Markdown ORIGINAL, nunca sobre
 *     uno ya anonimizado (ver `anonimizar()` — reprocesar es idempotente).
 *   · La UI y los TyC deben decir que es una AYUDA, NO UNA GARANTÍA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DE DÓNDE SALEN LAS ENTIDADES (4 fuentes, por orden de confiabilidad)
 * ═══════════════════════════════════════════════════════════════════════════
 * Las 4 se diseñaron mirando informes REALES del operador, no en abstracto:
 *
 *   1. CARÁTULA (`ACTOR c/ DEMANDADO s/TIPO`) — siempre presente. Da las
 *      partes. Ojo: en el `.md` puede venir partida en 2 líneas de cita
 *      porque el PDF la envuelve — se unen antes de parsear (medido: el
 *      nombre "SHIRLEY LICET" quedaba cortado justo al medio).
 *   2. MARCADORES DE ROL (`DR.`, `LETRADO APODERADO`, `DESTINATARIO:`…) —
 *      terceros. Alta precisión, cobertura parcial por diseño.
 *   3. CUIT/CUIL sueltos — patrón fuerte (11 dígitos con prefijo válido).
 *      Aparecen SIN guiones y SIN etiqueta en la sección "Intervinientes"
 *      (`…ISLA MATA|Tomo: 111 Folio: 678 - Federal|20223670785`), así que
 *      buscar la palabra "CUIT" no alcanza.
 *   4. VARIANTES de las anteriores que REALMENTE aparecen en el texto — ver
 *      `variantesPresentes()`. Resuelve el caso real medido: el letrado
 *      figura como `DAMIAN HORACIO ISLA MATA` en Intervinientes y como
 *      `DR. ISLA MATA` en un movimiento.
 *
 * ⚠️ LO QUE ESTE MOTOR **NO** HACE (y no debe fingir que hace):
 * no barre "toda secuencia de mayúsculas" buscando nombres. En un documento
 * del PJN casi TODO está en mayúsculas — un barrido genérico enmascararía
 * `JUZGADO FEDERAL DE RIO GALLEGOS` y volvería el archivo ilegible, que es
 * peor que un falso negativo: el usuario perdería la confianza y dejaría de
 * revisar. El sesgo al falso positivo (§M4 del plan) se aplica DENTRO de lo
 * que es plausiblemente un nombre de persona, no sobre el documento entero.
 * Los terceros que el motor no encuentra los agrega el usuario en el mapping.
 */

'use strict';

// ─── Reemplazos fijos de las partes (regla 1 y 2 del plan) ────────────────
const REEMPLAZO_EXPEDIENTE = 'Expediente';
const REEMPLAZO_ACTOR = 'Actor';
const REEMPLAZO_DEMANDADO = 'Demandado';

// ─── Palabras que NUNCA forman parte de un nombre de persona ──────────────
// Sirven para dos cosas: descartar un candidato entero (si TODOS sus tokens
// son institucionales) y cortar la captura tras un marcador de rol — el caso
// real `DR. ISLA MATA POR PRESENTADO - POR SECRETARIA…`, donde sin este corte
// el "nombre" capturado sería `ISLA MATA POR PRESENTADO`.
const PALABRAS_NO_NOMBRE = new Set([
    // Instituciones y dependencias
    'JUZGADO', 'JUZGADOS', 'CAMARA', 'CÁMARA', 'FEDERAL', 'NACIONAL', 'PROVINCIAL',
    'SECRETARIA', 'SECRETARÍA', 'FISCALIA', 'FISCALÍA', 'FISCAL', 'DEFENSORIA', 'DEFENSORÍA',
    'TRIBUNAL', 'CORTE', 'SUPREMA', 'JUSTICIA', 'PODER', 'JUDICIAL', 'MINISTERIO',
    'MESA', 'ENTRADAS', 'CIVIL', 'COMERCIAL', 'LABORAL', 'PENAL', 'CONTENCIOSO',
    'ADMINISTRATIVO', 'UNIDAD', 'DEPENDENCIA', 'ORGANISMO', 'DIRECCION', 'DIRECCIÓN',
    'GENERAL', 'REGIONAL', 'DISTRITO', 'CIRCUNSCRIPCION', 'CIRCUNSCRIPCIÓN',
    // Organismos fiscales frecuentes como actor
    'AFIP', 'ARCA', 'DGI', 'ANSES', 'BNA', 'BANCO', 'NACION', 'NACIÓN',
    // Vocabulario procesal que suele seguir a un marcador de rol
    'POR', 'PRESENTADO', 'PRESENTADA', 'LIBRESE', 'LÍBRESE', 'TENGASE', 'TÉNGASE',
    'NOTIFIQUESE', 'NOTIFÍQUESE', 'CUMPLASE', 'CÚMPLASE', 'AUTOS', 'EXPEDIENTE',
    'DEMANDA', 'DEMANDADO', 'DEMANDADA', 'ACTOR', 'ACTORA', 'PARTE', 'PARTES',
    'ESCRITO', 'CEDULA', 'CÉDULA', 'DESPACHO', 'SENTENCIA', 'RESOLUCION', 'RESOLUCIÓN',
    'MOVIMIENTO', 'ESTADO', 'FECHA', 'NOTIFICACION', 'NOTIFICACIÓN', 'INFORME',
    'EJECUCION', 'EJECUCIÓN', 'TOMO', 'FOLIO', 'NOMBRE', 'LETRADO', 'APODERADO',
    // Conectores
    'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'AL', 'EN', 'CON', 'SIN', 'SOBRE',
    'PARA', 'SU', 'SUS', 'OTRO', 'OTROS', 'OTRA', 'OTRAS',
]);

// Conectores que viven ADENTRO de un nombre ("MARIA DEL VALLE", "FERNANDEZ
// DE LA VEGA"). Estan tambien en PALABRAS_NO_NOMBRE porque no aportan
// identidad por si solos, pero NO deben cortar la captura: hasta la auditoria
// A0 (2026-08-30) `DESTINATARIO: MARIA DEL VALLE` daba `MAR### DEL VALLE`,
// enmascarando el nombre de pila y dejando el apellido -- que es justo la
// parte que identifica. Un conector se acepta solo si detras viene un token
// real, y nunca puede abrir ni cerrar el nombre.
const CONECTORES_NOMBRE = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y']);

// Titulos de cortesia. No son parte del nombre y, sobre todo, no deben
// consumir presupuesto de tokens -- ver `detectarTercerosPorMarcador`.
const HONORIFICOS = new Set(['DR', 'DRA', 'SR', 'SRA', 'SRTA', 'LIC', 'ING']);

// Sufijos societarios — un candidato que los tenga es una empresa, no una
// persona física. Se anonimiza igual si es una PARTE (viene de la carátula),
// pero NO se toma como "tercero" por heurística de nombre propio.
const SUFIJOS_SOCIETARIOS = /\b(S\.?A\.?|S\.?R\.?L\.?|S\.?A\.?S\.?|S\.?C\.?A\.?|SOCIEDAD|LIMITADA|ANONIMA|ANÓNIMA|COOPERATIVA|MUTUAL|FUNDACION|FUNDACIÓN|ASOCIACION|ASOCIACIÓN)\b/i;

// ─── Marcadores de rol que anteceden a un nombre de persona ───────────────
// Ordenados de más específico a más genérico (el alternador de regex es
// ordenado, y `LETRADO APODERADO` debe ganarle a un eventual `LETRADO`).
const MARCADORES_ROL = [
    'LETRADO APODERADO', 'LETRADO PATROCINANTE', 'APODERADO', 'LETRADO',
    'PERITO', 'MARTILLERO', 'DEFENSOR', 'DEFENSORA', 'SINDICO', 'SÍNDICO',
    'DESTINATARIO', 'DR', 'DRA', 'SR', 'SRA', 'SRTA',
];

// Un nombre de persona: 1 a 4 tokens en mayúsculas (el PJN escribe casi todo
// en mayúsculas), con acentos y la Ñ. El tope de 4 evita arrastrar media
// oración cuando el marcador está seguido de texto procesal.
const MAX_TOKENS_NOMBRE = 4;
const MIN_LARGO_TOKEN = 2;

// CUIT/CUIL: 11 dígitos con prefijo de persona/empresa válido. Los `\b`
// importan — sin ellos, un número de cédula de 14 dígitos como
// `23000062608263` daría un falso positivo por su prefijo.
const RE_CUIT = /\b(?:20|23|24|27|30|33|34)\d{9}\b/g;
// Con separadores (menos frecuente en estos PDF, pero válido).
const RE_CUIT_SEP = /\b(?:20|23|24|27|30|33|34)[-\s]?\d{8}[-\s]?\d\b/g;
const RE_DNI = /\bDNI\s*:?\s*(\d{1,3}\.?\d{3}\.?\d{3})\b/gi;

// Enlaces al visor del SCW — REGLA 4 (decisión del operador: opción A,
// eliminar). Ver §M4 del plan y §4 del spike de M0: esos enlaces abren el
// documento original SIN autenticación y sus tokens no expiran, así que un
// `.md` con los nombres enmascarados y los enlaces vivos entrega el
// expediente sin anonimizar. Es anonimización teatral.
const RE_ENLACE_SCW = /\[([^\]]*)\]\(\s*https?:\/\/[^)\s]*viewer\.seam[^)\s]*\s*\)/gi;
const RE_URL_SCW_SUELTA = /https?:\/\/[^\s)<>\]]*viewer\.seam[^\s)<>\]]*/gi;

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers de texto
// ═══════════════════════════════════════════════════════════════════════════

function escaparRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Enmascara un nombre propio dejando las 3 primeras letras de cada token:
 * `Jonathan Andrés Berger` → `Jon### And### Ber###` (formato del brief).
 */
function enmascararNombre(nombre) {
    return nombre
        .split(/\s+/)
        .filter(Boolean)
        .map(token => {
            const letras = token.replace(/[^\p{L}]/gu, '');
            if (letras.length === 0) return token;
            // Un conector no identifica a nadie: enmascararlo solo ensucia la
            // lectura (`MAR### DE### LA### FUE###`). Se deja tal cual.
            if (CONECTORES_NOMBRE.has(letras.toUpperCase())) return token;
            return letras.slice(0, 3) + '###';
        })
        .join(' ');
}

function tokensDe(texto) {
    return texto.split(/[\s,]+/).filter(t => t.length > 0);
}

/** Un candidato sirve como nombre de persona si aporta algo propio. */
function pareceNombrePersona(candidato) {
    const tokens = tokensDe(candidato);
    if (tokens.length === 0) return false;
    // El tope cuenta los tokens REALES: `JUAN PABLO DE LA TORRE` son 5
    // palabras pero 3 partes de nombre, y rechazarlo por largo dejaria pasar
    // el apellido entero.
    const reales = tokens.filter(t =>
        !CONECTORES_NOMBRE.has(t.replace(/[^\p{L}]/gu, '').toUpperCase()));
    if (reales.length === 0 || reales.length > MAX_TOKENS_NOMBRE) return false;
    if (SUFIJOS_SOCIETARIOS.test(candidato)) return false;
    // Al menos un token que no sea institucional/procesal y tenga largo real.
    return reales.some(t => {
        const limpio = t.replace(/[^\p{L}]/gu, '');
        return limpio.length >= MIN_LARGO_TOKEN && !PALABRAS_NO_NOMBRE.has(limpio.toUpperCase());
    });
}

/**
 * Construye un regex que matchea `termino` tolerando diferencias de
 * separador. Dos casos REALES, los dos medidos sobre informes del operador:
 *
 *   1. COMA: la carátula dice `PARDO MONTOYA, SHIRLEY LICET` y el cuerpo dice
 *      `PARDO MONTOYA SHIRLEY LICET`. Un reemplazo literal deja pasar la
 *      mitad de las menciones.
 *
 *   2. 🚨 SALTO DE LÍNEA DE CITA: el PDF envuelve la carátula por ancho, así
 *      que en el `.md` el nombre queda partido con un `\n> ` en el medio:
 *
 *          > AFIP-DGI (BD 7570/10/2017) c/ PARDO MONTOYA, SHIRLEY
 *          > LICET s/EJECUCION FISCAL - A.F.I.P.
 *
 *      Sin tolerar el `>`, el término completo NO matchea la carátula y el
 *      resultado queda `> Actor c/ Demandado` / `> LICET s/…` — con el segundo
 *      nombre de la persona EXPUESTO. Encontrado leyendo a mano la salida
 *      real; el test de integración no lo cazó porque comparaba con el mismo
 *      criterio ciego que el motor.
 *
 * Se agrega `>` a la clase de separadores y NADA más: el guion sigue afuera,
 * así que la flecha `->` de `-> Ver documento` no puede unir dos tokens que
 * en el original están separados por otra cosa.
 */
const SEP_TOKENS = '[\\s,>]+';


// --- Tolerancia a tildes (defecto 3 de A0) -------------------------------
// El PJN escribe casi todo en mayusculas y a veces SIN tildes: la caratula
// dice `GOMEZ ALVAREZ` con tilde y el cuerpo sin ella. Con un reemplazo
// literal la segunda mencion sobrevive, y ahi no se filtra un tercero: se
// filtra LA PARTE, entera. El encabezado de este archivo ya advertia el
// riesgo; lo que faltaba era manejarlo. Medido en la auditoria A0.
const MAPA_ACENTOS = {
    A: 'A\u00c1\u00c0\u00c4\u00c2\u00c3', E: 'E\u00c9\u00c8\u00cb\u00ca',
    I: 'I\u00cd\u00cc\u00cf\u00ce', O: 'O\u00d3\u00d2\u00d6\u00d4\u00d5',
    U: 'U\u00da\u00d9\u00dc\u00db', N: 'N\u00d1', C: 'C\u00c7',
};

const CLASE_POR_LETRA = (() => {
    const mapa = new Map();
    for (const variantes of Object.values(MAPA_ACENTOS)) {
        const clase = `[${variantes}${variantes.toLowerCase()}]`;
        for (const ch of variantes) {
            mapa.set(ch, clase);
            mapa.set(ch.toLowerCase(), clase);
        }
    }
    return mapa;
})();

// --- Tolerancia al corte de guion (defecto 4 de A0) ----------------------
// El PDF envuelve por ancho y parte la palabra: "VE-" al final de una linea y
// "GA" al principio de la siguiente. A diferencia de SEP_TOKENS, esto va
// ENTRE CARACTERES de un mismo token -- es un corte adentro de la palabra, no
// entre palabras. Es opcional, asi que un token sin cortar matchea igual.
const CORTE_DE_GUION = '(?:-\\s*\\n\\s*>?\\s*)?';

function claseDeCaracter(ch) {
    return CLASE_POR_LETRA.get(ch) || escaparRegex(ch);
}

function patronDeToken(token) {
    return [...token].map(claseDeCaracter).join(CORTE_DE_GUION);
}

/**
 * Une las palabras partidas por un guion de corte. Se usa SOLO para detectar:
 * el reemplazo sigue corriendo sobre el Markdown ORIGINAL (con el regex que
 * tolera el corte), asi que el documento del usuario nunca se altera.
 */
function unirCortesDeGuion(texto) {
    return texto.replace(/(\p{L})-\s*\n\s*>?\s*(\p{L})/gu, '$1$2');
}

function regexDeTermino(termino) {
    const partes = tokensDe(termino).map(patronDeToken);
    if (partes.length === 0) return null;
    // Los límites: al inicio, que no venga pegado a una letra o dígito; al
    // final, ídem — sin usar `\b`, que se comporta mal con acentos y con
    // términos que terminan en punto (`S.A`).
    const cuerpo = partes.join(SEP_TOKENS);
    return new RegExp(`(?<![\\p{L}\\p{N}])${cuerpo}(?![\\p{L}\\p{N}])`, 'giu');
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Carátula → partes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El bloque de cita que sigue al `# título` trae la carátula y, en otra
 * línea, la jurisdicción. La carátula puede venir PARTIDA en 2 líneas
 * (el PDF la envuelve por ancho). Se unen todas las líneas de cita del
 * encabezado en un solo texto y se busca `… c/ … s/…` sobre el resultado:
 * el `s/` no-greedy corta antes de la jurisdicción, así que da igual que
 * ésta quede incluida en el texto unido.
 */
function parsearCaratula(markdown) {
    const lineas = markdown.split('\n');
    const cita = [];
    let vistoTitulo = false;
    for (const linea of lineas) {
        if (/^#\s/.test(linea)) { vistoTitulo = true; continue; }
        if (!vistoTitulo) continue;
        if (/^##\s/.test(linea)) break;           // llegó "## Movimientos"
        if (/^\*\*Situaci/i.test(linea)) break;   // llegó la situación
        if (/^>\s?/.test(linea)) cita.push(linea.replace(/^>\s?/, '').trim());
    }
    const texto = cita.join(' ').replace(/\s+/g, ' ').trim();
    if (!texto) return { actor: null, demandado: null };

    // `c/` y `s/` con o sin espacios alrededor (el PJN escribe `s/EJECUCION`
    // pegado y `c/ NOMBRE` con espacio).
    const m = texto.match(/^(.+?)\s+c\/\s*(.+?)\s+s\//i);
    if (!m) return { actor: null, demandado: null };

    // El actor suele arrastrar el nº de boleta de deuda entre paréntesis
    // (`AFIP-DGI (BD 7570/10/2017)`) — no es parte del nombre.
    const actor = m[1].replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const demandado = m[2].replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return { actor: actor || null, demandado: demandado || null };
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. Título → expediente
// ═══════════════════════════════════════════════════════════════════════════

function parsearExpediente(markdown) {
    const m = markdown.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. Marcadores de rol → terceros
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Captura el nombre que sigue a un marcador de rol, cortando ante la primera
 * palabra que no puede formar parte de un nombre. Sin ese corte, el caso real
 * `DR. ISLA MATA POR PRESENTADO - POR SECRETARIA LIBRESE DEOX` daría el
 * "nombre" `ISLA MATA POR PRESENTADO`.
 */
function detectarTercerosPorMarcador(markdown) {
    const encontrados = new Set();
    const alternador = MARCADORES_ROL.map(escaparRegex).join('|');
    // Los limites de palabra NO son cosmeticos: sin ellos `DR` matchea DENTRO
    // de `ADRIAN`, y de `AFIP c/ ADRIAN BOYADJIAN` sale el falso tercero
    // `IAN BOYADJIAN` -- que ademas nunca matchea al reemplazar (el lookbehind
    // lo impide), asi que queda como una linea fantasma en el mapping.txt que
    // el usuario lee. Encontrado inspeccionando la salida real, no por un test.
    // Tras el marcador puede venir `.`, `:`, un pipe (escapado como `\|` por
    // el render de tablas de M2) o simplemente espacios.
    const re = new RegExp(
        `(?<![\\p{L}])(?:${alternador})(?![\\p{L}])\\s*[.:]?\\s*(?:\\\\?\\|)?\\s*([\\p{Lu}][\\p{L}'’.\\s]{2,80})`,
        'gu'
    );

    let m;
    while ((m = re.exec(markdown)) !== null) {
        const crudo = m[1];
        // Cortar en el primer separador estructural.
        const hastaSeparador = crudo.split(/\\?\||,| - |\s{2,}|\n/)[0];
        // Cortar ante la primera palabra que no puede ser parte de un nombre.
        const brutos = tokensDe(hastaSeparador);

        // Los honorificos no son parte del nombre y, sobre todo, no deben
        // gastar presupuesto de tokens (defecto 2 de A0): en
        // `LETRADO: DR. JUAN PABLO GARCIA CUERVA` el marcador que matchea es
        // `LETRADO`, asi que la captura arranca en `DR` -- que se comia uno de
        // los 4 lugares y dejaba `CUERVA`, el apellido, afuera. Sin el `DR.`
        // el mismo nombre se enmascaraba entero.
        let inicio = 0;
        while (inicio < brutos.length &&
               HONORIFICOS.has(brutos[inicio].replace(/[^\p{L}]/gu, '').toUpperCase())) {
            inicio++;
        }

        const tokens = [];
        let pendientes = [];   // conectores esperando un token real detras
        let reales = 0;        // solo cuentan los tokens que no son conectores
        for (const token of brutos.slice(inicio)) {
            const limpio = token.replace(/[^\p{L}]/gu, '').toUpperCase();
            if (limpio.length === 0) break;
            // Un conector NO corta el nombre (defecto 1 de A0): `MARIA DEL
            // VALLE` es un apellido con particula, no "MARIA" seguido de texto
            // procesal. Queda en espera y solo se incorpora si despues viene un
            // token real; si el nombre termina ahi, se descarta -- un nombre no
            // puede abrir ni cerrar con un conector. Este chequeo va ANTES del
            // de PALABRAS_NO_NOMBRE, que tambien contiene DE/DEL/LA.
            if (CONECTORES_NOMBRE.has(limpio)) {
                if (reales === 0) break;
                pendientes.push(token);
                continue;
            }
            // Un token que ARRANCA EN MINUSCULA cierra el nombre. En el PJN los
            // nombres van en mayusculas y la prosa que los rodea no, asi que
            // esta es la senal de fin de nombre mas confiable que da el propio
            // documento. Hace falta desde que los conectores dejaron de cortar:
            // sin ella, `El DR. FERNANDEZ DE LA VEGA dijo algo` capturaba
            // tambien `dijo algo` y lo enmascaraba -- sobre-enmascarar vuelve
            // el archivo ilegible, que este modulo considera PEOR que un falso
            // negativo (ver el encabezado). Va DESPUES del chequeo de conector
            // para no romper `Juan de la Torre`, donde la particula es
            // legitimamente minuscula.
            if (/^\p{Ll}/u.test(token)) break;
            if (PALABRAS_NO_NOMBRE.has(limpio)) break;
            tokens.push(...pendientes, token.replace(/[.,;:]+$/, ''));
            pendientes = [];
            if (++reales >= MAX_TOKENS_NOMBRE) break;
        }
        if (tokens.length === 0) continue;
        const candidato = tokens.join(' ').trim();
        if (candidato.length < 4) continue;
        if (!pareceNombrePersona(candidato)) continue;
        encontrados.add(candidato);
    }
    return [...encontrados];
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. Variantes realmente presentes en el texto
// ═══════════════════════════════════════════════════════════════════════════

// Conectores que no pueden abrir ni cerrar una variante: `AGUA DEL` o
// `DE RESPONSABILIDAD` son fragmentos, no formas alternativas de un nombre.
const CONECTORES_BORDE = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'A', 'EN', 'CON']);

function contarOcurrencias(termino, texto) {
    const re = regexDeTermino(termino);
    if (!re) return 0;
    const m = texto.match(re);
    return m ? m.length : 0;
}

/**
 * Dado un nombre completo, devuelve los sub-nombres contiguos de ≥2 tokens
 * que aparecen en el texto **de forma independiente**. Resuelve el caso real
 * medido: el letrado figura como `DAMIAN HORACIO ISLA MATA` en la sección
 * Intervinientes y como `DR. ISLA MATA` en un movimiento posterior.
 *
 * 🚨 EL FILTRO QUE IMPORTA — `count(variante) > count(completo)`.
 * No alcanza con que la variante "aparezca en el texto": todo sub-fragmento
 * de un nombre aparece siempre, porque el nombre completo está ahí. Ese
 * criterio ingenuo generaba basura real, encontrada inspeccionando a mano la
 * salida de un expediente del operador:
 *
 *     AGUA DEL = Demandado          ← fragmento de la razón social
 *     DE RESPONSABILIDAD = Demandado ← ídem, y PELIGROSO: reemplazaría esa
 *                                      frase en cualquier otro contexto
 *
 * Exigir que la variante aparezca MÁS veces que el completo deja pasar solo
 * las que tienen menciones propias (`ISLA MATA`: 2 apariciones vs 1 del
 * completo) y descarta las que viven únicamente dentro de él (`AGUA DEL`:
 * mismas apariciones que el completo). Sin este filtro, el motor produce
 * falsos positivos que rompen el documento — el modo de falla que hace que
 * el usuario deje de confiar en la herramienta.
 */
function variantesPresentes(nombreCompleto, markdown) {
    const tokens = tokensDe(nombreCompleto);
    if (tokens.length < 3) return [];   // con 2 tokens no hay sub-variante útil

    const ocurrenciasCompleto = contarOcurrencias(nombreCompleto, markdown);
    const variantes = new Set();

    for (let largo = tokens.length - 1; largo >= 2; largo--) {
        for (let i = 0; i + largo <= tokens.length; i++) {
            const partes = tokens.slice(i, i + largo);
            const sub = partes.join(' ');
            if (sub === nombreCompleto) continue;

            // Un fragmento que abre o cierra con un conector no es un nombre.
            const primero = partes[0].replace(/[^\p{L}]/gu, '').toUpperCase();
            const ultimo = partes[partes.length - 1].replace(/[^\p{L}]/gu, '').toUpperCase();
            if (CONECTORES_BORDE.has(primero) || CONECTORES_BORDE.has(ultimo)) continue;

            if (!pareceNombrePersona(sub)) continue;

            // El filtro central: solo si tiene menciones INDEPENDIENTES.
            if (contarOcurrencias(sub, markdown) > ocurrenciasCompleto) variantes.add(sub);
        }
    }
    return [...variantes];
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. Construcción del mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @returns {Array<{original: string, reemplazo: string, tipo: string}>}
 */
function detectarEntidades(markdown) {
    // La deteccion corre sobre una copia con los cortes de guion ya unidos
    // (`VE-` + salto de linea + `GA` -> `VEGA`). El reemplazo, en cambio,
    // sigue corriendo sobre el ORIGINAL con un regex que tolera el corte:
    // asi el nombre se detecta entero sin alterar el documento del usuario.
    const texto = unirCortesDeGuion(markdown);
    const entradas = [];
    const yaVisto = new Set();

    const agregar = (original, reemplazo, tipo) => {
        const clave = original.toUpperCase();
        if (!original || yaVisto.has(clave)) return;
        yaVisto.add(clave);
        entradas.push({ original, reemplazo, tipo });
    };

    // — Expediente —
    const expediente = parsearExpediente(texto);
    if (expediente) agregar(expediente, REEMPLAZO_EXPEDIENTE, 'expediente');

    // — Partes (carátula) —
    const { actor, demandado } = parsearCaratula(texto);
    if (actor) {
        agregar(actor, REEMPLAZO_ACTOR, 'parte');
        variantesPresentes(actor, texto).forEach(v => agregar(v, REEMPLAZO_ACTOR, 'parte-variante'));
    }
    if (demandado) {
        agregar(demandado, REEMPLAZO_DEMANDADO, 'parte');
        variantesPresentes(demandado, texto).forEach(v => agregar(v, REEMPLAZO_DEMANDADO, 'parte-variante'));
    }

    // — Terceros (marcadores de rol) —
    for (const tercero of detectarTercerosPorMarcador(texto)) {
        agregar(tercero, enmascararNombre(tercero), 'tercero');
        for (const v of variantesPresentes(tercero, texto)) {
            agregar(v, enmascararNombre(v), 'tercero-variante');
        }
    }

    // — Identificadores (CUIT/CUIL/DNI) —
    for (const re of [RE_CUIT, RE_CUIT_SEP]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(texto)) !== null) agregar(m[0], '(CUIT oculto)', 'identificador');
    }
    RE_DNI.lastIndex = 0;
    let mDni;
    while ((mDni = RE_DNI.exec(texto)) !== null) agregar(mDni[1], '(DNI oculto)', 'identificador');

    return entradas;
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. Serialización del mapping.txt (editable a mano)
// ═══════════════════════════════════════════════════════════════════════════

const ENCABEZADO_MAPPING = `# Diccionario de reemplazos — Procurador SCW
#
# Editá la columna de la derecha (después del "=") y volvé a procesar desde
# la app para regenerar el archivo anonimizado.
#
#   · Una línea por reemplazo, con el formato:   ORIGINAL = REEMPLAZO
#   · Las líneas que empiezan con "#" son comentarios y se ignoran.
#   · Podés AGREGAR líneas propias para enmascarar algo que no se detectó.
#   · Podés BORRAR una línea si no querés que ese texto se reemplace.
#
# SUGERENCIA: si la parte actora es un organismo público (AFIP, ARCA, ANSES…),
# saber que es el actor no identifica a nadie — borrar esa línea te deja un
# archivo más legible sin perder privacidad.
#
# ATENCIÓN: la anonimización es una ayuda automática, NO es una garantía.
# Revisá siempre el archivo anonimizado antes de compartirlo.
`;

function serializarMapping(entradas) {
    const porTipo = new Map();
    for (const e of entradas) {
        if (!porTipo.has(e.tipo)) porTipo.set(e.tipo, []);
        porTipo.get(e.tipo).push(e);
    }
    const titulos = {
        'expediente': 'Expediente',
        'parte': 'Partes (de la carátula)',
        'parte-variante': 'Partes — otras formas en que aparecen en el texto',
        'tercero': 'Terceros detectados (letrados, peritos, destinatarios…)',
        'tercero-variante': 'Terceros — otras formas en que aparecen en el texto',
        'identificador': 'Identificadores (CUIT / CUIL / DNI)',
    };

    let salida = ENCABEZADO_MAPPING;
    for (const [tipo, titulo] of Object.entries(titulos)) {
        const items = porTipo.get(tipo);
        if (!items || items.length === 0) continue;
        salida += `\n# ── ${titulo} ──\n`;
        for (const e of items) salida += `${e.original} = ${e.reemplazo}\n`;
    }
    if (entradas.length === 0) {
        salida += '\n# (No se detectó ninguna entidad para reemplazar.)\n';
    }
    return salida;
}

/** Lee un mapping.txt editado por el usuario. Tolera espacios y comentarios. */
function parsearMapping(texto) {
    const entradas = [];
    for (const linea of String(texto || '').split(/\r?\n/)) {
        const limpia = linea.trim();
        if (!limpia || limpia.startsWith('#')) continue;
        const idx = limpia.indexOf('=');
        if (idx === -1) continue;
        const original = limpia.slice(0, idx).trim();
        const reemplazo = limpia.slice(idx + 1).trim();
        if (!original) continue;
        entradas.push({ original, reemplazo, tipo: 'manual' });
    }
    return entradas;
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. Aplicación
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica el mapping sobre el Markdown.
 *
 * 🚨 ORDEN POR LONGITUD DESCENDENTE — no es cosmético. Si se reemplazara
 * `ISLA MATA` antes que `DAMIAN HORACIO ISLA MATA`, el nombre completo ya no
 * matchearía y quedaría `DAMIAN HORACIO Isl### Mat###`: mitad enmascarado,
 * mitad expuesto. Del más largo al más corto, el completo gana primero y las
 * variantes cubren lo que queda.
 */
function aplicarMapping(markdown, entradas) {
    let salida = markdown;

    const ordenadas = [...entradas].sort((a, b) => b.original.length - a.original.length);
    for (const { original, reemplazo } of ordenadas) {
        const re = regexDeTermino(original);
        if (!re) continue;
        salida = salida.replace(re, reemplazo);
    }

    // REGLA 4 — enlaces al SCW (opción A: eliminar la URL, conservar el texto).
    // Va DESPUÉS de los reemplazos de texto: si un enlace llevara el nombre de
    // una parte como texto visible, primero se enmascara y después se le quita
    // la URL, no al revés.
    salida = salida.replace(RE_ENLACE_SCW, (_m, textoVisible) => textoVisible || '');
    salida = salida.replace(RE_URL_SCW_SUELTA, '(enlace al expediente omitido)');

    return salida;
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. API principal
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string} markdownOriginal - salida de M2 (+ M3 si hay adjuntos)
 * @param {string} [mappingTextoEditado] - `mapping.txt` que editó el usuario.
 *   Si se pasa, se usa TAL CUAL y no se re-detecta nada — así el botón
 *   "reprocesar" de la Solapa 2 respeta exactamente lo que el usuario escribió.
 * @returns {{ markdownAnonimizado: string, mappingTexto: string, entradas: Array }}
 */
function anonimizar(markdownOriginal, mappingTextoEditado) {
    // Siempre se parte del ORIGINAL. Aplicar el mapping sobre un Markdown ya
    // anonimizado produciría `Ter######` en el segundo pase (decisión de
    // diseño 2 del plan: el reprocesamiento tiene que ser idempotente).
    const entradas = mappingTextoEditado
        ? parsearMapping(mappingTextoEditado)
        : detectarEntidades(markdownOriginal);

    const markdownAnonimizado = aplicarMapping(markdownOriginal, entradas);
    const mappingTexto = mappingTextoEditado || serializarMapping(entradas);

    return { markdownAnonimizado, mappingTexto, entradas };
}

module.exports = {
    anonimizar,
    detectarEntidades,
    aplicarMapping,
    serializarMapping,
    parsearMapping,
    parsearCaratula,
    parsearExpediente,
    detectarTercerosPorMarcador,
    variantesPresentes,
    enmascararNombre,
    pareceNombrePersona,
    regexDeTermino,
};
