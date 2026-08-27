#!/usr/bin/env node
// demo-fixtures/generar-visores.js
//
// D2 (demo Etapa 1.6) — genera los visores REALES de la demo invocando las
// funciones reales del producto sobre los fixtures sintéticos de este
// directorio, en vez de maquetar el HTML a mano:
//   - Informe (individual + lote)  → generarVisorHTML() real, sin tocar.
//   - Monitor (inicial + novedades) → generarVisorMonitoreo() real, recién
//     extraída a su propio módulo en este mismo bloque D2 (ver el comentario
//     de cabecera de electron-app/monitor/generarVisorMonitoreo.js).
//   - Procuración (individual + lote) → NO tiene generador reusable: el motor
//     real vive en un script de backend ENCRIPTADO (zona protegida, no
//     legible ni requerible). Acá se reproduce a mano el MISMO mecanismo de
//     reemplazo de marcador que usa el resto del proyecto (ver
//     visorModal_template.html línea 345, `<!-- DATOS_EMBEBIDOS -->`), con la
//     forma de datos confirmada por lectura directa del template.
//
// Uso:
//   node backend-server/dev-tools/demo-fixtures/generar-visores.js
//
// Salida: backend-server/dev-tools/demo-fixtures/output/ (gitignored — se
// regenera en cada corrida, nunca versionar nada de ahí).

const fs = require('fs');
const path = require('path');

const { generarVisorHTML } = require('../../../electron-app/informe/generador_visor');
const { generarVisorMonitoreo } = require('../../../electron-app/monitor/generarVisorMonitoreo');

const { EXPEDIENTES } = require('./expedientes');
const { INFORME_INDIVIDUAL_RESUMEN, INFORME_LOTE_RESUMEN } = require('./informe');
const { PROCURACION_INDIVIDUAL, PROCURACION_LOTE } = require('./procuracion');
const { CUENTA_DEMO } = require('./cuenta');
const {
  PARTE_DEMO,
  MONITOR_RESULTADOS_INICIAL,
  MONITOR_RESULTADOS_NOVEDADES,
  BITACORA_INFO_MONITOR,
} = require('./monitor');

const OUTPUT_DIR = path.join(__dirname, 'output');
const config = { rutas: { descargas: OUTPUT_DIR } };

function asegurarDirectorio() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ───────────────────────────────────────────────────────────────────────────
// PDFs de placeholder — el motor real (informequickscwpjn.js) los genera con
// Puppeteer sobre el contenido real del PJN; acá basta un PDF MÍNIMO pero
// VÁLIDO (que un visor de PDF cualquiera pueda abrir sin error), con el
// nombre exacto que `buscarPdfExpediente()` necesita para resolver el link
// "Abrir PDF" — el mismo mecanismo cuya rotura en producción costó 2
// regresiones reales (822bf0d, debb503 — ver demo-guion.md §3, la razón por
// la que el guion exige mostrar ese botón activo y no un placeholder muerto).
// Ningún generador de PDFs está disponible acá (backend-server no depende de
// pdfkit/puppeteer para esto) — se arma el PDF a mano con sintaxis mínima.
// ───────────────────────────────────────────────────────────────────────────
// El archivo se escribe con `fs.writeFileSync(..., 'latin1')`, que trunca a
// 1 byte cualquier carácter fuera de Latin-1 (U+0000-U+00FF) — un em dash
// (U+2014, fuera de rango) se convertía en basura silenciosa, confirmado
// visualmente contra el PDF generado. Se normaliza ANTES de escapar.
const NORMALIZAR_FUERA_DE_LATIN1 = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"' };
function normalizarParaLatin1(s) {
  return String(s).replace(/[—–‘’“”]/g, (c) => NORMALIZAR_FUERA_DE_LATIN1[c]);
}

function crearPdfPlaceholder(rutaDestino, lineas) {
  const escapar = (s) => normalizarParaLatin1(s).replace(/[\\()]/g, (c) => `\\${c}`);
  // 1ra línea más grande (título), el resto en tamaño de cuerpo — para que
  // la captura 3.4 del guion se vea como un informe real y no un test de
  // "hola mundo" de una sola línea.
  // Recorte simple por cantidad de caracteres — a 12pt Helvetica, ~90
  // caracteres es lo máximo que entra en el ancho útil de la página
  // (612pt - 2×50pt de margen) sin desbordar el borde derecho.
  const recortar = (s) => (s.length > 82 ? `${s.slice(0, 79)}...` : s);
  const comandos = lineas.map((linea, i) => {
    const tam = i === 0 ? 18 : 12;
    const salto = i === 0 ? 0 : 22;
    return `/F1 ${tam} Tf 0 -${salto} Td (${escapar(recortar(linea))}) Tj`;
  });
  const contenidoStream = `BT 50 700 Td ${comandos.join(' ')} ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    // /Encoding explícito: sin esto, un visor de PDF usa la codificación
    // PROPIA de Helvetica (StandardEncoding), que no tiene tildes/Ñ — el
    // fixture tiene "GONZÁLEZ"/"JURÍDICO" reales y salían corrompidos
    // ("GONZ`LEZ") hasta agregar esto, confirmado visualmente contra el PDF
    // generado, no supuesto. WinAnsiEncoding sí cubre el rango acentuado
    // español y coincide con cómo Node escribe el archivo ('latin1').
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${contenidoStream.length} >>\nstream\n${contenidoStream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objetos.forEach((cuerpo, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objetos.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  fs.writeFileSync(rutaDestino, pdf, 'latin1');
}

// Mismo formato de nombre que produce la app real — ver
// electron-app/informe/buscarPdfExpediente.js (SUFIJO_TIMESTAMP/PREFIJO).
function nombrePdf(expediente) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const expLimpio = expediente.replace(/\//g, '_');
  return `informe_${expLimpio}_${ts}.pdf`;
}

function crearPdfsParaResumen(resumen) {
  resumen.forEach((item) => {
    if (!item.ok) return;
    const nombre = nombrePdf(item.expediente);
    const exp = EXPEDIENTES.find((e) => e.expediente === item.expediente);
    const lineas = [`Informe de expediente (demo) — ${item.expediente}`];
    if (item.caratula) lineas.push(item.caratula);
    if (exp) {
      lineas.push(`${exp.dependencia} · ${exp.situacion} · Últ. act.: ${exp.ultima_actuacion}`, '');
      lineas.push('MOVIMIENTOS:');
      exp.movimientos.forEach((m) => lineas.push(`${m.fecha}  ${m.tipo}  —  ${m.detalle}`));
    }
    lineas.push('', 'Generado por Procurador SCW — documento de demostración, sin validez procesal.');
    crearPdfPlaceholder(path.join(OUTPUT_DIR, nombre), lineas);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Capítulo 3 — Informe (motor REAL: generarVisorHTML)
// ───────────────────────────────────────────────────────────────────────────
async function generarInforme() {
  crearPdfsParaResumen(INFORME_INDIVIDUAL_RESUMEN);
  const resumenIndividualPath = path.join(OUTPUT_DIR, '_resumen-informe-individual.json');
  fs.writeFileSync(resumenIndividualPath, JSON.stringify(INFORME_INDIVIDUAL_RESUMEN, null, 2));
  const rutaIndividual = await generarVisorHTML(
    resumenIndividualPath,
    config,
    null,
    null,
    'informe-individual'
  );
  console.log(`  ✓ Informe individual → ${path.basename(rutaIndividual)}`);

  crearPdfsParaResumen(INFORME_LOTE_RESUMEN);
  const resumenLotePath = path.join(OUTPUT_DIR, '_resumen-informe-lote.json');
  fs.writeFileSync(resumenLotePath, JSON.stringify(INFORME_LOTE_RESUMEN, null, 2));
  // El Excel real no hace falta que sea válido para este capítulo — el visor
  // solo linkea a `path.basename(rutaExcel)`, nunca lo abre él mismo.
  const rutaExcelFake = path.join(OUTPUT_DIR, 'informe-lote_demo.xlsx');
  fs.writeFileSync(rutaExcelFake, '');
  const rutaLote = await generarVisorHTML(
    resumenLotePath,
    config,
    rutaExcelFake,
    null,
    'informe-lote'
  );
  console.log(`  ✓ Informe por lote → ${path.basename(rutaLote)}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Capítulo 4 — Monitor de partes (motor REAL: generarVisorMonitoreo,
// recién extraído en este mismo bloque D2)
// ───────────────────────────────────────────────────────────────────────────
function escribirVisor(nombreArchivo, html) {
  const ruta = path.join(OUTPUT_DIR, nombreArchivo);
  fs.writeFileSync(ruta, html, 'utf-8');
  return ruta;
}

function tsArchivo() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

function generarMonitor() {
  const htmlInicial = generarVisorMonitoreo('inicial', MONITOR_RESULTADOS_INICIAL, BITACORA_INFO_MONITOR);
  const rutaInicial = escribirVisor(`monitor-inicial_visor_${tsArchivo()}.html`, htmlInicial);
  console.log(`  ✓ Monitor — Consulta Inicial → ${path.basename(rutaInicial)}`);

  const htmlNovedades = generarVisorMonitoreo('novedades', MONITOR_RESULTADOS_NOVEDADES, BITACORA_INFO_MONITOR);
  const rutaNovedades = escribirVisor(`monitor-novedades_visor_${tsArchivo()}.html`, htmlNovedades);
  console.log(`  ✓ Monitor — Novedades → ${path.basename(rutaNovedades)}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Capítulo 2 — Procuración (SIN generador reusable — ver cabecera del
// archivo). Reproduce a mano el reemplazo de `<!-- DATOS_EMBEBIDOS -->` que
// en producción hace el script encriptado, con la MISMA forma de datos que
// `visorModal_template.html` espera (confirmada por lectura directa del
// template: `cargarDatosEmbebidos(datos)` con
// `datos.{fechaEjecucion,resumen,expedientes}` — ver procuracion.js).
// ───────────────────────────────────────────────────────────────────────────
function generarProcuracion() {
  const templatePath = path.join(__dirname, '../../../electron-app/visorModal_template.html');
  const templateOriginal = fs.readFileSync(templatePath, 'utf-8');

  function render(datos, nombrePrefijo) {
    if (!templateOriginal.includes('<!-- DATOS_EMBEBIDOS -->')) {
      throw new Error('El template no tiene el marcador <!-- DATOS_EMBEBIDOS --> esperado (¿cambió de nombre?)');
    }
    // 🐛→fix real, encontrado al verificar esta misma corrida: el marcador
    // <!-- DATOS_EMBEBIDOS --> queda ANTES del <script> del template que
    // define `cargarDatosEmbebidos()` (línea 345 vs. 348) — llamarla acá
    // mismo, en el momento en que este bloque se parsea, revienta con
    // "cargarDatosEmbebidos is not defined" (confirmado con Playwright real:
    // el error aparecía en consola). Como el template no tiene NINGÚN otro
    // call site (grep completo, cero coincidencias), la única forma de que
    // esto funcione — en la demo y presumiblemente en la app real, que
    // enfrenta el mismo orden de scripts — es diferir la llamada hasta que
    // el resto del documento (incluida la definición de la función) ya haya
    // corrido. DOMContentLoaded lo garantiza sin tocar el template.
    const bloqueDatos =
      `<script>\n` +
      `  window.datosEmbebidos = ${JSON.stringify(datos, null, 2)};\n` +
      `  document.addEventListener('DOMContentLoaded', function () {\n` +
      `    cargarDatosEmbebidos(window.datosEmbebidos);\n` +
      `  });\n` +
      `</script>`;
    let html = templateOriginal.replace('<!-- DATOS_EMBEBIDOS -->', bloqueDatos);
    // Mismo criterio que F2.1 en main.js: Bitácora se inyecta reemplazando su
    // propio marcador. HABILITADA (a diferencia del primer intento de D2):
    // D3 (demo-guion.md §5.1) necesita capturar la barra de 5 acciones del
    // modal de detalle DESDE este mismo visor — es donde vive de verdad, no
    // en el capítulo 5 (que solo cubre el lado portal de Bitácora). Un caso
    // ya "seguido" (CIV 00002/2024) para mostrar el badge 📁, el otro
    // (FCR 00001/2024) sin seguir para que su modal muestre la barra
    // completa de 5 botones, incluido "📌 Guardar caso".
    html = html.replace(
      '<!-- BITACORA_RUNTIME -->',
      `<script>window.BITACORA_RUNTIME = { enabled: true, seguidos: ${JSON.stringify(['CIV 00002/2024'])}, ssoToken: null };</script>`
    );
    const nombre = `${nombrePrefijo}_visor_${tsArchivo()}.html`;
    return escribirVisor(nombre, html);
  }

  const rutaIndividual = render(PROCURACION_INDIVIDUAL, 'procurar-individual');
  console.log(`  ✓ Procuración individual → ${path.basename(rutaIndividual)}`);

  const rutaLote = render(PROCURACION_LOTE, 'procurar-lote');
  console.log(`  ✓ Procuración por lote → ${path.basename(rutaLote)}`);
}

// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// Volcado a JSON para capture_electron.py (D3, pipeline 3): los fixtures
// están escritos en JS y ese script es Python — en vez de retipear los
// mismos datos en 2 lenguajes (la misma clase de duplicación que ya
// documentó 2 bugs reales en este proyecto — ver la cabecera de
// generarVisorMonitoreo.js), se vuelcan acá una sola vez a JSON, que Python
// lee tal cual. Va a `output/` (gitignored, se regenera en cada corrida).
// ───────────────────────────────────────────────────────────────────────────
function exportarFixturesParaElectron() {
  const datos = {
    cuenta: CUENTA_DEMO,
    parteDemo: PARTE_DEMO,
    expedientes: EXPEDIENTES,
    monitorExpedientesInicial: MONITOR_RESULTADOS_INICIAL[0].expedientes,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'fixtures-electron.json'), JSON.stringify(datos, null, 2));
}

async function main() {
  asegurarDirectorio();
  console.log('Generando visores de la demo (fixtures sintéticos, funciones reales)…\n');

  console.log('Procuración:');
  generarProcuracion();

  console.log('\nInforme:');
  await generarInforme();

  console.log('\nMonitor de partes:');
  generarMonitor();

  exportarFixturesParaElectron();

  console.log(`\nListo. Salida en: ${OUTPUT_DIR}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Falló la generación:', err);
    process.exitCode = 1;
  });
}

module.exports = { main };
