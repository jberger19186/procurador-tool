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

const { INFORME_INDIVIDUAL_RESUMEN, INFORME_LOTE_RESUMEN } = require('./informe');
const { PROCURACION_INDIVIDUAL, PROCURACION_LOTE } = require('./procuracion');
const {
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
function crearPdfPlaceholder(rutaDestino, tituloTexto) {
  const textoEscapado = tituloTexto.replace(/[\\()]/g, (c) => `\\${c}`);
  const contenidoStream = `BT /F1 18 Tf 50 700 Td (${textoEscapado}) Tj ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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
    crearPdfPlaceholder(
      path.join(OUTPUT_DIR, nombre),
      `Informe (demo) - ${item.expediente}`
    );
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
    // propio marcador, deshabilitada acá porque este capítulo no la necesita
    // (Bitácora tiene su propio capítulo 5, con fixtures propios).
    html = html.replace(
      '<!-- BITACORA_RUNTIME -->',
      '<script>window.BITACORA_RUNTIME = { enabled: false, seguidos: [] };</script>'
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
async function main() {
  asegurarDirectorio();
  console.log('Generando visores de la demo (fixtures sintéticos, funciones reales)…\n');

  console.log('Procuración:');
  generarProcuracion();

  console.log('\nInforme:');
  await generarInforme();

  console.log('\nMonitor de partes:');
  generarMonitor();

  console.log(`\nListo. Salida en: ${OUTPUT_DIR}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Falló la generación:', err);
    process.exitCode = 1;
  });
}

module.exports = { main };
