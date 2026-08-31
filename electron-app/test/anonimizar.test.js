/**
 * Verifica el motor de anonimización (bloque M4),
 * plan `docs/internal/plan-modulo-markdown-anonimizacion-2026-08-26.md`.
 *
 *   node electron-app/test/anonimizar.test.js
 *
 * Tres capas:
 *   1. Unidades de cada pieza (carátula, marcadores, variantes, mapping).
 *   2. 🚨 CORPUS ADVERSARIAL con **tasa de falsos negativos MEDIDA** — lo
 *      que exige §M4 del plan y el bloque S10 de SEC-2: el resultado se
 *      reporta como un número, no como una impresión. Incluye tanto fugas
 *      (un dato personal que sobrevive) como sobre-enmascarado (una
 *      institución que se rompe), porque las dos rompen el producto: la
 *      primera expone datos, la segunda hace que el usuario deje de confiar.
 *   3. Integración contra los informes REALES del operador.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    anonimizar,
    detectarEntidades,
    aplicarMapping,
    serializarMapping,
    parsearMapping,
    parsearCaratula,
    detectarTercerosPorMarcador,
    variantesPresentes,
    enmascararNombre,
} = require('../markdown/anonimizar');
const { procesarInformeAMarkdown } = require('../markdown/extraerPdfAMarkdown');

let ok = 0, fail = 0;
function check(nombre, cond, detalle) {
    if (cond) { ok++; console.log(`✅ ${nombre}`); }
    else { fail++; console.log(`❌ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. UNIDADES
// ═══════════════════════════════════════════════════════════════════════════

(function testCaratula() {
    // Caso REAL: la carátula viene partida en 2 líneas de cita porque el PDF
    // la envuelve — el nombre "SHIRLEY LICET" queda cortado justo al medio.
    const md = [
        '# FCR 018745/2017',
        '',
        '> AFIP-DGI (BD 7570/10/2017) c/ PARDO MONTOYA, SHIRLEY',
        '> LICET s/EJECUCION FISCAL - A.F.I.P.',
        '> Justicia Federal de Comodoro Rivadavia | JUZGADO FEDERAL DE RIO GALLEGOS',
        '',
        '**Situación:** ARCHÍVESE',
    ].join('\n');
    const { actor, demandado } = parsearCaratula(md);
    check('parsearCaratula: une la carátula partida en 2 líneas y recupera el nombre completo',
        demandado === 'PARDO MONTOYA, SHIRLEY LICET', `demandado=${JSON.stringify(demandado)}`);
    check('parsearCaratula: quita el nº de boleta de deuda del actor',
        actor === 'AFIP-DGI', `actor=${JSON.stringify(actor)}`);
    check('parsearCaratula: NO se lleva la jurisdicción dentro del demandado',
        !/Justicia|JUZGADO/i.test(demandado || ''));

    // Las otras 3 formas reales medidas en los informes del operador.
    const casos = [
        ['> AFIP c/ ADRIAN BOYADJIAN Y OTRO S.R.L. s/EJECUCION FISCAL', 'AFIP', 'ADRIAN BOYADJIAN Y OTRO S.R.L.'],
        ['> ARCA c/ AGUA DEL CAMPO SOCIEDAD DE RESPONSABILIDAD LIMITADA s/EJECUCION FISCAL', 'ARCA', 'AGUA DEL CAMPO SOCIEDAD DE RESPONSABILIDAD LIMITADA'],
        ['> AFIP (BD 05999/05/2018) c/ AUSTRAL AGRO S.A s/EJECUCION FISCAL', 'AFIP', 'AUSTRAL AGRO S.A'],
    ];
    let okCasos = 0;
    for (const [linea, actorEsp, demEsp] of casos) {
        const r = parsearCaratula(`# EXP 1/2020\n\n${linea}\n`);
        if (r.actor === actorEsp && r.demandado === demEsp) okCasos++;
        else console.log(`     ↳ esperado {${actorEsp} | ${demEsp}}, obtenido {${r.actor} | ${r.demandado}}`);
    }
    check('parsearCaratula: las otras 3 carátulas reales del operador se parsean bien', okCasos === 3, `${okCasos}/3`);
})();

(function testEnmascarar() {
    check('enmascararNombre: formato del brief (3 letras + ###)',
        enmascararNombre('Jonathan Andrés Berger') === 'Jon### And### Ber###',
        enmascararNombre('Jonathan Andrés Berger'));
    check('enmascararNombre: token corto no se rompe',
        enmascararNombre('LI PO') === 'LI### PO###', enmascararNombre('LI PO'));
})();

(function testMarcadores() {
    // Caso REAL: el marcador está seguido de texto procesal que NO es nombre.
    const md = '| 8/04/2026 | FIRMA DESPACHO: TENGASE AL DR. ISLA MATA POR PRESENTADO - POR SECRETARIA LIBRESE DEOX |';
    const terceros = detectarTercerosPorMarcador(md);
    check('detectarTercerosPorMarcador: corta ante palabra procesal ("ISLA MATA", no "ISLA MATA POR PRESENTADO")',
        terceros.includes('ISLA MATA'), JSON.stringify(terceros));

    // Caso REAL de la sección "Intervinientes" (los pipes vienen escapados
    // como `\|` porque M2 los escapa al renderizar la tabla).
    const md2 = 'LETRADO APODERADO\\|DAMIAN HORACIO ISLA MATA\\|Tomo: 111 Folio: 678 - Federal\\|20223670785';
    const t2 = detectarTercerosPorMarcador(md2);
    check('detectarTercerosPorMarcador: captura el nombre completo tras un pipe escapado',
        t2.includes('DAMIAN HORACIO ISLA MATA'), JSON.stringify(t2));

    const md3 = 'FISCALIA\\|FISCAL\\|I.E.J. UNIDAD FISCAL RIO GALLEGOS\\|DR. PABLO FERNANDO MANSILLA\\|20263242034';
    const t3 = detectarTercerosPorMarcador(md3);
    check('detectarTercerosPorMarcador: captura el fiscal con "DR."',
        t3.includes('PABLO FERNANDO MANSILLA'), JSON.stringify(t3));
})();

(function testVariantes() {
    // El caso real: nombre completo en Intervinientes, abreviado en un movimiento.
    const md = 'LETRADO APODERADO DAMIAN HORACIO ISLA MATA ... TENGASE AL DR. ISLA MATA POR PRESENTADO';
    const v = variantesPresentes('DAMIAN HORACIO ISLA MATA', md);
    check('variantesPresentes: encuentra "ISLA MATA" porque aparece de verdad en el texto',
        v.includes('ISLA MATA'), JSON.stringify(v));
    const v2 = variantesPresentes('DAMIAN HORACIO ISLA MATA', 'texto sin ninguna mención parcial');
    check('variantesPresentes: NO inventa variantes que no están en el texto',
        v2.length === 0, JSON.stringify(v2));
})();

(function testOrdenPorLongitud() {
    // 🚨 Si se aplicara el término corto primero, el largo ya no matchearía y
    // quedaría medio nombre expuesto.
    const md = 'Compareció DAMIAN HORACIO ISLA MATA, luego el DR. ISLA MATA firmó.';
    const entradas = [
        { original: 'ISLA MATA', reemplazo: 'Isl### Mat###' },
        { original: 'DAMIAN HORACIO ISLA MATA', reemplazo: 'Dam### Hor### Isl### Mat###' },
    ];
    const out = aplicarMapping(md, entradas);
    check('aplicarMapping: el término MÁS LARGO gana (no queda "DAMIAN HORACIO Isl### Mat###")',
        out.includes('Dam### Hor### Isl### Mat###') && !out.includes('DAMIAN HORACIO'), out);
})();

(function testMappingRoundTrip() {
    const entradas = [{ original: 'JUAN PEREZ', reemplazo: 'Jua### Per###', tipo: 'tercero' }];
    const texto = serializarMapping(entradas);
    const vuelta = parsearMapping(texto);
    check('mapping: serializar → parsear conserva la entrada',
        vuelta.length === 1 && vuelta[0].original === 'JUAN PEREZ' && vuelta[0].reemplazo === 'Jua### Per###',
        JSON.stringify(vuelta));
    check('mapping: el encabezado lleva la advertencia de "no es una garantía"',
        /NO es una garant[ií]a/i.test(texto) && /Revis[aá] siempre/i.test(texto));
    check('parsearMapping: ignora comentarios y líneas vacías',
        parsearMapping('# comentario\n\nA = B\n').length === 1);
    check('parsearMapping: un reemplazo con "=" adentro se parte solo en el primero',
        parsearMapping('A = B = C')[0].reemplazo === 'B = C');
})();

(function testReemplazoLiteralF5() {
    // 🚨 F5 (2026-08-31): el reemplazo lo escribe el USUARIO en el mapping.txt,
    // y `String.replace` con un STRING interpreta `$&`, `$'`, `` $` `` y `$$`.
    // Verificado antes del fix: `JUAN PEREZ = [$&]` devolvía `[JUAN PEREZ]`, o
    // sea el nombre DE VUELTA, con el usuario convencido de haberlo
    // enmascarado — el modo de falla silencioso que el encabezado del motor
    // advierte. Ahora el reemplazo va como función y `$` no significa nada.
    const md = 'El deudor JUAN PEREZ debe algo. Sigue el resto del documento.';
    const conAmp = aplicarMapping(md, [{ original: 'JUAN PEREZ', reemplazo: '[$&]', tipo: 'manual' }]);
    check('F5 — "$&" en el reemplazo NO reinserta el original',
        !conAmp.includes('JUAN PEREZ') && conAmp.includes('[$&]'), conAmp);

    const conResto = aplicarMapping(md, [{ original: 'JUAN PEREZ', reemplazo: "X$'X", tipo: 'manual' }]);
    check("F5 — \"$'\" en el reemplazo NO inserta el resto del documento",
        !conResto.includes('debe algo. Sigue el resto del documento. Sigue'), conResto);

    const conPesos = aplicarMapping(md, [{ original: 'JUAN PEREZ', reemplazo: '$$$', tipo: 'manual' }]);
    check('F5 — un reemplazo con "$" queda literal, sin colapsar "$$" a "$"',
        conPesos.includes('$$$'), conPesos);
})();

(function testIdempotencia() {
    // Decisión de diseño 2 del plan: reprocesar debe partir SIEMPRE del
    // original. Aplicar dos veces sobre el resultado daría `Ter######`.
    const md = '# EXP 1/2020\n\n> AFIP c/ JUAN CARLOS PEREZ s/EJECUCION FISCAL\n\nEl DR. JUAN CARLOS PEREZ compareció.';
    const r1 = anonimizar(md);
    const r2 = anonimizar(md, r1.mappingTexto);
    check('anonimizar: reprocesar con el mismo mapping da el MISMO resultado (idempotente)',
        r1.markdownAnonimizado === r2.markdownAnonimizado);
    check('anonimizar: no aparece doble enmascarado (###\\s*###)',
        !/###\s*###/.test(r2.markdownAnonimizado), r2.markdownAnonimizado);
})();

(function testReglaEnlaces() {
    // REGLA 4 (opción A del operador): el enlace al SCW abre el documento
    // original SIN login y su token no expira → en la versión anonimizada NO
    // puede sobrevivir, o la anonimización es teatral.
    const md = [
        '# EXP 1/2020',
        '',
        '| 1/01/2020 | DESPACHO: algo [Ver documento](https://scw.pjn.gov.ar/scw/viewer.seam?id=TOKEN%3D&tipoDoc=despacho) |',
        '',
        'Suelto: https://scw.pjn.gov.ar/scw/viewer.seam?id=OTRO%3D&tipoDoc=cedula',
    ].join('\n');
    const { markdownAnonimizado } = anonimizar(md);
    check('REGLA 4: el .md anonimizado NO contiene ninguna URL de viewer.seam',
        !/viewer\.seam/i.test(markdownAnonimizado), markdownAnonimizado);
    check('REGLA 4: se conserva el texto visible del enlace (no se pierde información)',
        markdownAnonimizado.includes('Ver documento'));
})();

// ═══════════════════════════════════════════════════════════════════════════
//  2. 🚨 CORPUS ADVERSARIAL — con tasa de falsos negativos MEDIDA
// ═══════════════════════════════════════════════════════════════════════════
// Cada caso declara qué DEBE desaparecer del resultado (`fugas`) y qué DEBE
// sobrevivir intacto (`preservar`). El resultado se reporta como número.

const CORPUS = [
    {
        // Las partículas ("DE", "LA") están en PALABRAS_NO_NOMBRE, así que el
        // candidato solo sobrevive porque `pareceNombrePersona` exige que UN
        // token sea propio, no todos — acá lo son "MARIA" y "FUENTE".
        // Nota: NO se pide preservar "AFIP" aunque sea un organismo — es la
        // parte ACTORA, y la regla del brief dice partes → `Actor`. Que se
        // reemplace es el comportamiento correcto por diseño; el usuario que
        // prefiera conservarlo borra esa línea del mapping (el encabezado del
        // mapping.txt lo sugiere explícitamente).
        nombre: 'Nombre con partícula ("DE LA FUENTE")',
        md: '# EXP 10/2020\n\n> AFIP c/ MARIA DE LA FUENTE s/EJECUCION FISCAL\n\nSe notificó a MARIA DE LA FUENTE.',
        fugas: ['MARIA DE LA FUENTE'],
        preservar: [],
    },
    {
        nombre: 'Coma en la carátula pero SIN coma en el cuerpo (caso real medido)',
        md: '# EXP 11/2020\n\n> AFIP c/ PARDO MONTOYA, SHIRLEY LICET s/EJECUCION FISCAL\n\n| 1/01/2020 | RETORNO CEDULA: DESTINATARIO: PARDO MONTOYA SHIRLEY LICET |',
        fugas: ['PARDO MONTOYA SHIRLEY LICET', 'PARDO MONTOYA, SHIRLEY LICET'],
        preservar: [],
    },
    {
        nombre: 'Mención parcial de un tercero (completo + abreviado)',
        md: '# EXP 12/2020\n\n> ARCA c/ EMPRESA X S.A. s/EJECUCION FISCAL\n\nLETRADO APODERADO\\|DAMIAN HORACIO ISLA MATA\\|Tomo 1\n\n| 2/02/2021 | TENGASE AL DR. ISLA MATA POR PRESENTADO |',
        fugas: ['DAMIAN HORACIO ISLA MATA', 'ISLA MATA'],
        preservar: [],
    },
    {
        nombre: 'CUIT pelado sin guiones ni etiqueta (caso real medido)',
        md: '# EXP 13/2020\n\n> ARCA c/ EMPRESA X S.A. s/EJECUCION FISCAL\n\nLETRADO\\|JUAN PEREZ\\|Tomo: 111 Folio: 678 - Federal\\|20223670785',
        fugas: ['20223670785'],
        preservar: [],
    },
    {
        nombre: 'CUIT con guiones',
        md: '# EXP 14/2020\n\n> ARCA c/ EMPRESA X S.A. s/EJECUCION FISCAL\n\nCUIT del deudor: 27-32069435-9',
        fugas: ['27-32069435-9'],
        preservar: [],
    },
    {
        nombre: 'DNI etiquetado',
        md: '# EXP 15/2020\n\n> ARCA c/ EMPRESA X S.A. s/EJECUCION FISCAL\n\nDNI: 32.069.435 del demandado',
        fugas: ['32.069.435'],
        preservar: [],
    },
    {
        nombre: '🚨 NO sobre-enmascarar instituciones (falso positivo que rompe el documento)',
        md: '# EXP 16/2020\n\n> AFIP c/ JUAN PEREZ s/EJECUCION FISCAL\n> Justicia Federal de Comodoro Rivadavia | JUZGADO FEDERAL DE RIO GALLEGOS - SECRETARIA EJECUCION FISCAL\n\n| 1/01/2020 | PASE: CAMARA FEDERAL DE COMODORO RIVADAVIA - MESA ENTRADAS CIVIL |',
        fugas: ['JUAN PEREZ'],
        preservar: ['JUZGADO FEDERAL DE RIO GALLEGOS', 'CAMARA FEDERAL DE COMODORO RIVADAVIA', 'MESA ENTRADAS CIVIL', 'SECRETARIA EJECUCION FISCAL'],
    },
    {
        nombre: '🚨 NO enmascarar el nº de cédula de 14 dígitos (no es CUIT)',
        md: '# EXP 17/2020\n\n> ARCA c/ EMPRESA X S.A. s/EJECUCION FISCAL\n\n| 1/01/2020 | CEDULA ELECTRONICA TRIBUNAL: CEDULA N° 23000062608263 - NOTIFICADO |',
        fugas: [],
        preservar: ['23000062608263'],
    },
    {
        nombre: 'Razón social con y sin punto final (variación real medida)',
        md: '# EXP 18/2020\n\n> AFIP c/ AUSTRAL AGRO S.A s/EJECUCION FISCAL\n\n| 1/01/2020 | DESTINATARIO: AUSTRAL AGRO S.A. - FECHA |',
        fugas: ['AUSTRAL AGRO S.A'],
        preservar: [],
    },
    {
        nombre: 'Enlace al SCW dentro de una tabla',
        md: '# EXP 19/2020\n\n> AFIP c/ JUAN PEREZ s/EJECUCION FISCAL\n\n| 1/01/2020 | FIRMA [Ver documento](https://scw.pjn.gov.ar/scw/viewer.seam?id=AB%3D&tipoDoc=despacho) |',
        fugas: ['viewer.seam', 'JUAN PEREZ'],
        preservar: [],
    },
    {
        nombre: 'Expediente con y sin padding de ceros en el mismo documento',
        md: '# FCR 018745/2017\n\n> AFIP c/ JUAN PEREZ s/EJECUCION FISCAL\n\nEn los autos FCR 018745/2017 se resolvió.',
        fugas: ['FCR 018745/2017'],
        preservar: [],
    },
    {
        nombre: 'Nombre compuesto largo (4 tokens)',
        md: '# EXP 20/2020\n\n> AFIP c/ MARIA JOSE GARCIA LOPEZ s/EJECUCION FISCAL\n\nNotificada MARIA JOSE GARCIA LOPEZ en su domicilio.',
        fugas: ['MARIA JOSE GARCIA LOPEZ'],
        preservar: [],
    },
    {
        // 🚨 Caso encontrado inspeccionando A MANO la salida real (no lo cazó
        // ningún test): las variantes de una razón social larga generaban
        // fragmentos como "DE RESPONSABILIDAD", que reemplazarían esa frase en
        // CUALQUIER otro contexto del documento. Acá la frase aparece también
        // en una oración ajena al demandado y debe sobrevivir intacta.
        nombre: '🚨 Un fragmento de la razón social NO debe reemplazarse fuera del nombre',
        md: '# EXP 21/2020\n\n> ARCA c/ AGUA DEL CAMPO SOCIEDAD DE RESPONSABILIDAD LIMITADA s/EJECUCION FISCAL\n\n| 1/01/2020 | DESPACHO: se analiza el límite DE RESPONSABILIDAD del fiador |',
        fugas: ['AGUA DEL CAMPO SOCIEDAD DE RESPONSABILIDAD LIMITADA'],
        preservar: ['el límite DE RESPONSABILIDAD del fiador'],
    },
    {
        // 🚨 Caso encontrado leyendo A MANO la salida real: el PDF envuelve la
        // carátula por ancho, así que en el .md el nombre queda partido por un
        // "\n> ". Sin tolerar ese separador, el término completo no matchea y
        // el segundo nombre de la persona sobrevive EXPUESTO en la carátula.
        // El test de integración tampoco lo detectaba: comparaba con el mismo
        // criterio ciego que tenía el motor.
        nombre: '🚨 Nombre PARTIDO por el salto de línea de la cita (carátula envuelta)',
        md: '# FCR 018745/2017\n\n> AFIP-DGI (BD 7570/10/2017) c/ PARDO MONTOYA, SHIRLEY\n> LICET s/EJECUCION FISCAL - A.F.I.P.\n\n| 1/01/2020 | DESTINATARIO: PARDO MONTOYA SHIRLEY LICET |',
        fugas: ['PARDO MONTOYA, SHIRLEY\n> LICET', 'PARDO MONTOYA SHIRLEY LICET'],
        preservar: [],
    },
    {
        // El fix del caso anterior agrega ">" a los separadores tolerados.
        // Este caso vigila que eso NO habilite un match a través de la
        // frontera de una celda de tabla (donde el separador es "|").
        nombre: 'El separador ">" no debe unir tokens a través de celdas de tabla',
        md: '# EXP 22/2020\n\n> AFIP c/ JUAN PEREZ s/EJECUCION FISCAL\n\n| 1/01/2020 | algo PEREZ |\n| 2/01/2020 | JUAN otra cosa |',
        fugas: ['JUAN PEREZ'],
        preservar: ['algo PEREZ', 'JUAN otra cosa'],
    },

    // ─────────────────────────────────────────────────────────────────────
    //  Los 4 defectos que encontró la auditoría independiente A0 con
    //  Antigravity/Gemini (2026-08-30). Comparten una misma dirección de
    //  falla, y era la peor posible: el motor enmascaraba los NOMBRES DE PILA
    //  y dejaba pasar el APELLIDO, que es la parte que identifica.
    // ─────────────────────────────────────────────────────────────────────
    {
        // 🚨 EL HALLAZGO QUE JUSTIFICÓ LA AUDITORÍA. El corpus original SÍ
        // probaba una partícula ("DE LA FUENTE", más arriba) — pero solo por
        // el camino de la CARÁTULA, que la toma entera y funciona bien. Por el
        // camino del MARCADOR DE ROL el conector `DE` cortaba la captura y
        // salía `MAR### DE LA FUENTE`. Mismo nombre, dos caminos, resultados
        // opuestos: el autor probó su regla donde su regla anda.
        nombre: '🚨 Partícula en un TERCERO (no en la carátula) — asimetría parte/tercero',
        md: '# EXP 30/2020\n\n> AFIP c/ SOSA s/EJECUCION FISCAL\n\nDESTINATARIO: MARIA DE LA FUENTE.',
        fugas: ['DE LA FUENTE'],
        preservar: [],
    },
    {
        // El honorífico se comía uno de los 4 lugares del presupuesto: el
        // marcador que matchea es `LETRADO`, así que la captura arrancaba en
        // `DR` y el apellido quedaba afuera. Sin el `DR.` el mismo nombre se
        // enmascaraba entero — un token de cortesía decidía si había fuga.
        nombre: 'El honorífico no debe consumir presupuesto de tokens',
        md: '# EXP 31/2020\n\n> AFIP c/ SOSA s/EJECUCION\n\nLETRADO: DR. JUAN PABLO GARCIA CUERVA',
        fugas: ['CUERVA'],
        preservar: [],
    },
    {
        // El PJN a veces escribe sin tildes. Acá no se filtra un tercero: se
        // filtra LA PARTE, entera. El encabezado del motor ya advertía el
        // riesgo; lo que faltaba era manejarlo.
        nombre: '🚨 Parte con tilde en la carátula y SIN tilde en el cuerpo',
        md: '# EXP 32/2020\n\n> GÓMEZ ÁLVAREZ c/ PEREZ s/EJECUTIVO\n\nEl Sr. GOMEZ ALVAREZ declaró.',
        fugas: ['GOMEZ ALVAREZ'],
        preservar: [],
    },
    {
        // Nombre partido por el guión de corte del PDF. El `preservar` es la
        // mitad que importa: al dejar que los conectores no corten la captura
        // se quitó un freno que accidentalmente impedía la captura desbocada
        // en prosa, y el motor pasó a enmascarar también "dijo algo". Lo cazó
        // la inspección manual de la salida, no un test.
        nombre: 'Nombre partido por guión de corte, sin arrastrar la prosa que sigue',
        md: '# EXP 33/2020\n\n> AFIP c/ SOSA s/EJECUCION\n\nEl DR. FERNANDEZ DE LA VE-\nGA dijo algo.',
        fugas: ['VE-\nGA'],
        preservar: ['dijo algo'],
    },
    {
        // Encontrado inspeccionando la salida real, no por un test: sin
        // límite de palabra, `DR` matchea DENTRO de `ADRIAN` y genera el
        // tercero fantasma `IAN BOYADJIAN`, que nunca reemplaza nada pero
        // ensucia el mapping.txt que el usuario lee.
        nombre: 'Un marcador de rol no matchea dentro de otra palabra (ADRIAN ≠ DR)',
        md: '# EXP 34/2020\n\n> AFIP c/ ADRIAN BOYADJIAN Y OTRO S.R.L. s/EJECUCION\n\nSe notificó.',
        fugas: [],
        preservar: [],
        sinTerceros: true,
    },

    // ─────────────────────────────────────────────────────────────────────
    //  F5 (2026-08-31) — fase de code-review del módulo. Los 6 defectos de
    //  abajo comparten el origen de los de A0 (todos salieron de MIRAR la
    //  salida real sobre entradas que el corpus no cubría, no de un test que
    //  fallara) y 4 de ellos comparten también su dirección de falla: se
    //  enmascara una parte del nombre y sobrevive la que identifica.
    // ─────────────────────────────────────────────────────────────────────
    {
        // 🚨 El mismo defecto que A0 arregló para el honorífico, por la vía
        // general: el presupuesto se gasta de izquierda a derecha, así que lo
        // que queda afuera es la COLA — el apellido. Con 4 nombres de pila
        // (nada exótico en Argentina) el tope de 4 tokens se agotaba antes de
        // llegar a él. A0 atacó el síntoma (`DR.` comiéndose un lugar), no la
        // causa. Salida real antes del fix: `JUA### CAR### MAR### JOS### FERNANDEZ`.
        nombre: '🚨 F5 — el presupuesto de tokens no puede dejar afuera el apellido',
        md: '# EXP 40/2020\n\n> AFIP c/ SOSA s/EJECUCION\n\nDESTINATARIO: JUAN CARLOS MARIA JOSE FERNANDEZ',
        fugas: ['FERNANDEZ'],
        preservar: [],
    },
    {
        // 🚨 La clase de captura tras un marcador de rol no incluía el guion,
        // así que un apellido compuesto se cortaba al medio y el segundo
        // sobrevivía. Salida real antes del fix: `MAR### GAR###-LOPEZ`.
        nombre: '🚨 F5 — apellido compuesto con guion, sin que sobreviva la mitad',
        md: '# EXP 41/2020\n\n> AFIP c/ SOSA s/EJECUCION\n\nDESTINATARIO: MARIA GARCIA-LOPEZ',
        fugas: ['LOPEZ'],
        preservar: [],
    },
    {
        // 🚨 `parsearCaratula` quita los paréntesis para sacar el nº de boleta
        // de deuda del actor — correcto cuando van al final, pero cuando caen
        // en el MEDIO del nombre el término limpio ya no matchea el original y
        // la parte sobrevivía ENTERA, carátula incluida.
        nombre: '🚨 F5 — paréntesis en el medio del nombre de la parte',
        md: '# EXP 42/2020\n\n> AFIP c/ JUAN (JOSE) PEREZ s/EJECUCION\n\nSe notifica a JUAN (JOSE) PEREZ y a JUAN PEREZ.',
        fugas: ['JUAN (JOSE) PEREZ', 'JUAN PEREZ'],
        preservar: [],
    },
    {
        // El patrón de DNI exigía la sigla pelada + a lo sumo un `:`. De las 17
        // formas reales de escribir un documento en un escrito judicial
        // argentino, detectaba 2. `D.N.I.` y `DNI Nº` son de las más comunes.
        nombre: '🚨 F5 — el DNI se escribe de muchas formas (D.N.I., DNI Nº, L.E.)',
        md: '# EXP 43/2020\n\n> ARCA c/ EMPRESA X S.A. s/EJECUCION\n\nD.N.I. Nº 32.069.435 del demandado, y su cónyuge L.E. 4.567.890.',
        fugas: ['32.069.435', '4.567.890'],
        preservar: [],
    },
    {
        // Contrapeso del caso anterior: el número sigue exigiendo una sigla de
        // documento adelante. Enmascarar 8 dígitos sueltos rompería importes y
        // números de actuación — el otro modo de falla del módulo.
        nombre: '🚨 F5 — NO enmascarar cifras sin sigla de documento (leyes, importes)',
        md: '# EXP 44/2020\n\n> ARCA c/ EMPRESA X S.A. s/EJECUCION\n\n| 1/01/2020 | LEY 24.522 - MONTO DE PESOS 22.367.078 EN CONCEPTO DE CAPITAL |',
        fugas: [],
        preservar: ['LEY 24.522', '22.367.078'],
    },
    {
        // La captura desbocada en prosa EN MAYÚSCULAS: ni los conectores (desde
        // A0) ni el presupuesto (desde F5) la cortan, así que el único freno es
        // la lista de palabras procesales — que no tenía ninguno de estos
        // verbos, todos corrientes en un despacho. Salida real antes del fix:
        // `FER### SOL### MED### CAU###` y `GOM### HAG### SAB### LO###`.
        nombre: '🚨 F5 — NO enmascarar prosa procesal en mayúsculas tras un marcador',
        md: '# EXP 45/2020\n\n> AFIP c/ SOSA s/EJECUCION\n\n| 1/01/2020 | DR. FERNANDEZ SOLICITA MEDIDA CAUTELAR URGENTE |\n| 2/01/2020 | AL DR. GOMEZ HAGASE SABER LO RESUELTO |',
        fugas: ['FERNANDEZ', 'GOMEZ'],
        preservar: ['SOLICITA MEDIDA CAUTELAR URGENTE', 'HAGASE SABER LO RESUELTO'],
    },
];

function correrCorpus() {
    console.log('\n▶ CORPUS ADVERSARIAL — tasa de falsos negativos medida\n');
    let totalFugas = 0, fugasNoDetectadas = 0;
    let totalPreservar = 0, preservarRotos = 0;
    const detalleFugas = [];
    const detalleRotos = [];

    for (const caso of CORPUS) {
        const { markdownAnonimizado, entradas } = anonimizar(caso.md);
        let casoOk = true;

        // Algunos casos no vigilan una fuga sino lo contrario: que NO se
        // invente un tercero. Un tercero fantasma no filtra nada, pero
        // ensucia el mapping.txt que el usuario lee y decide.
        if (caso.sinTerceros) {
            const fantasmas = entradas.filter(e => e.tipo.startsWith('tercero'));
            if (fantasmas.length > 0) {
                casoOk = false;
                detalleRotos.push(`${caso.nombre} -> tercero inventado: ${JSON.stringify(fantasmas.map(f => f.original))}`);
                preservarRotos++;
            }
            totalPreservar++;
        }

        for (const fuga of caso.fugas) {
            totalFugas++;
            // Comparación tolerante a espacios/comas, igual que el motor.
            const escapado = fuga.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s,]+/g, '[\\s,>]+');
            if (new RegExp(escapado, 'i').test(markdownAnonimizado)) {
                fugasNoDetectadas++;
                casoOk = false;
                detalleFugas.push(`${caso.nombre} → sobrevivió: "${fuga}"`);
            }
        }
        for (const preservar of caso.preservar) {
            totalPreservar++;
            if (!markdownAnonimizado.includes(preservar)) {
                preservarRotos++;
                casoOk = false;
                detalleRotos.push(`${caso.nombre} → se rompió: "${preservar}"`);
            }
        }
        console.log(`   ${casoOk ? '✅' : '❌'} ${caso.nombre}`);
    }

    const tasaFN = totalFugas === 0 ? 0 : (fugasNoDetectadas / totalFugas) * 100;
    const tasaFP = totalPreservar === 0 ? 0 : (preservarRotos / totalPreservar) * 100;

    console.log('');
    console.log(`   📊 Datos que DEBÍAN desaparecer:      ${totalFugas - fugasNoDetectadas}/${totalFugas} · tasa de FALSOS NEGATIVOS: ${tasaFN.toFixed(1)}%`);
    console.log(`   📊 Texto que DEBÍA sobrevivir intacto: ${totalPreservar - preservarRotos}/${totalPreservar} · tasa de SOBRE-ENMASCARADO: ${tasaFP.toFixed(1)}%`);
    if (detalleFugas.length) { console.log('\n   🚨 FUGAS:'); detalleFugas.forEach(d => console.log(`      · ${d}`)); }
    if (detalleRotos.length) { console.log('\n   ⚠️  SOBRE-ENMASCARADO:'); detalleRotos.forEach(d => console.log(`      · ${d}`)); }
    console.log('');

    check(`CORPUS: tasa de falsos negativos = 0% (${totalFugas - fugasNoDetectadas}/${totalFugas} datos ocultados)`, fugasNoDetectadas === 0);
    check(`CORPUS: tasa de sobre-enmascarado = 0% (${totalPreservar - preservarRotos}/${totalPreservar} preservados)`, preservarRotos === 0);
    return { tasaFN, tasaFP };
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. INTEGRACIÓN — contra los informes REALES del operador
// ═══════════════════════════════════════════════════════════════════════════

function informesReales() {
    const base = path.join(os.homedir(), 'AppData', 'Roaming', 'procurador-electron', 'usuarios');
    if (!fs.existsSync(base)) return [];
    const porExp = new Map();
    for (const cuit of fs.readdirSync(base)) {
        const descargas = path.join(base, cuit, 'descargas');
        if (!fs.existsSync(descargas)) continue;
        for (const f of fs.readdirSync(descargas)) {
            if (!/^informe_.*\.pdf$/i.test(f)) continue;
            const exp = f.replace(/_\d{4}-\d{2}-\d{2}T.*$/, '');
            const full = path.join(descargas, f);
            const mtime = fs.statSync(full).mtimeMs;
            if (!porExp.has(exp) || porExp.get(exp).mtime < mtime) porExp.set(exp, { full, mtime });
        }
    }
    return [...porExp.values()].map(v => v.full);
}

async function testIntegracionReal() {
    const pdfs = informesReales();
    if (pdfs.length === 0) {
        console.log('⚠️  Sin informes reales disponibles — se omite la integración de M4.');
        return;
    }
    console.log(`\n▶ Integración M4 contra ${pdfs.length} informes REALES del operador\n`);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-m4-'));
    try {
        let conPartes = 0;
        for (const pdf of pdfs) {
            const { mdPath } = await procesarInformeAMarkdown(pdf, tmp);
            const md = fs.readFileSync(mdPath, 'utf8');
            const { markdownAnonimizado, entradas } = anonimizar(md);

            const { demandado } = parsearCaratula(md);
            const nombreExp = path.basename(pdf).replace(/^informe_/, '').replace(/_\d{4}-\d{2}-\d{2}T.*$/, '');

            if (demandado) conPartes++;

            // El demandado real NO puede sobrevivir en el anonimizado.
            const escapado = demandado
                ? demandado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s,]+/g, '[\\s,>]+')
                : null;
            const sobrevive = escapado ? new RegExp(escapado, 'i').test(markdownAnonimizado) : false;

            check(`  [${nombreExp}] el demandado real no sobrevive en el anonimizado`, !sobrevive,
                `demandado=${JSON.stringify(demandado)}`);
            check(`  [${nombreExp}] el .md anonimizado no contiene URLs de viewer.seam`,
                !/viewer\.seam/i.test(markdownAnonimizado));
            check(`  [${nombreExp}] se detectó al menos el expediente y una parte`,
                entradas.length >= 2, `entradas=${entradas.length}`);
            // No debe destruir la estructura del documento.
            check(`  [${nombreExp}] conserva la estructura (título y sección Movimientos)`,
                /^# /m.test(markdownAnonimizado) && markdownAnonimizado.includes('## Movimientos'));
        }
        check('Integración: los 4 informes reales tienen carátula parseable', conPartes === pdfs.length,
            `${conPartes}/${pdfs.length}`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

const resultadoCorpus = correrCorpus();

testIntegracionReal().then(() => {
    console.log(`\n${ok}/${ok + fail} PASS`);
    console.log(`Tasa de falsos negativos del corpus adversarial: ${resultadoCorpus.tasaFN.toFixed(1)}%`);
    if (fail > 0) process.exit(1);
}).catch(e => {
    console.error('❌ Error inesperado:', e);
    process.exit(1);
});
