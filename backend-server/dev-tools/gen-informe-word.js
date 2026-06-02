/* Genera el informe de evaluación del proyecto en formato Word (.docx) */
const path = require('path');
const fs = require('fs');
const GLOBAL = require('child_process').execSync('npm root -g').toString().trim();
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, Header, Footer, ImageRun, PageBreak
} = require(path.join(GLOBAL, 'docx'));

// ── Paleta de marca ───────────────────────────────────────────────────────────
const AMBER   = 'D97706';
const AMBER_D = 'B45309';
const DARK    = '1A1A1A';
const GRAY    = '4A4A4A';
const GREEN   = '059669';
const GREEN_BG= 'D1FAE5';
const YELLOW_BG='FEF3C7';
const RED      ='DC2626';
const RED_BG   ='FEE2E2';
const HEAD_BG  ='1E3A5F';
const ALT_BG   ='F7F7F5';

const CONTENT_W = 9360; // US Letter, márgenes 1"

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

// Helpers ----------------------------------------------------------------------
function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    children: [new TextRun({ text, size: opts.size || 22, color: opts.color || GRAY, bold: opts.bold, italics: opts.italics })]
  });
}
function bullet(text, bold) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 80 },
    children: bold
      ? [new TextRun({ text: bold, bold: true, color: DARK, size: 22 }), new TextRun({ text: text, size: 22, color: GRAY })]
      : [new TextRun({ text, size: 22, color: GRAY })]
  });
}
function cell(content, { w, fill, bold, color, align, header } = {}) {
  const runs = Array.isArray(content) ? content : [new TextRun({
    text: content, bold: bold || header, size: header ? 21 : 21,
    color: header ? 'FFFFFF' : (color || DARK)
  })];
  return new TableCell({
    borders,
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: align || AlignmentType.LEFT, children: runs })]
  });
}
function table(columns, rows, headerFill = HEAD_BG) {
  const widths = columns.map(c => c.w);
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map(c => cell(c.label, { w: c.w, fill: headerFill, header: true, align: c.align }))
  });
  const bodyRows = rows.map((r, i) =>
    new TableRow({
      children: r.map((val, j) => {
        const colDef = columns[j];
        // val puede ser string o {text, fill, color, bold, align, runs}
        if (val && typeof val === 'object' && (val.runs || val.text !== undefined)) {
          return cell(val.runs || val.text, {
            w: colDef.w, fill: val.fill || (i % 2 ? ALT_BG : undefined),
            color: val.color, bold: val.bold, align: val.align || colDef.align
          });
        }
        return cell(String(val), { w: colDef.w, fill: i % 2 ? ALT_BG : undefined, align: colDef.align });
      })
    })
  );
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows: [headerRow, ...bodyRows] });
}
function spacer(after = 160) { return new Paragraph({ spacing: { after } }); }
function rule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: AMBER, space: 1 } },
    spacing: { after: 200 }
  });
}

// Estados con color
const ST = {
  ok:    t => ({ text: t, fill: GREEN_BG,  color: '064E3B' }),
  warn:  t => ({ text: t, fill: YELLOW_BG, color: '78350F' }),
  err:   t => ({ text: t, fill: RED_BG,    color: '7F1D1D' }),
};

// ── Contenido ─────────────────────────────────────────────────────────────────
const logoPath = path.join(__dirname, '../public/assets/brand-icon.png');
const children = [];

// Portada -----------------------------------------------------------------------
if (fs.existsSync(logoPath)) {
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 200 },
    children: [new ImageRun({ type: 'png', data: fs.readFileSync(logoPath),
      transformation: { width: 90, height: 90 },
      altText: { title: 'Procurador SCW', description: 'Logo', name: 'logo' } })]
  }));
}
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 60 },
  children: [new TextRun({ text: 'Procurador ', bold: true, size: 40, color: DARK }),
             new TextRun({ text: 'TOOL', bold: true, size: 40, color: AMBER })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 360 },
  children: [new TextRun({ text: 'Procurador SCW', size: 22, color: GRAY, allCaps: true, characterSpacing: 40 })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: 'Informe de Evaluación del Proyecto', bold: true, size: 34, color: HEAD_BG })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 400 },
  children: [new TextRun({ text: 'Preparación para lanzamiento de prueba (Beta) con usuarios reales', size: 24, italics: true, color: GRAY })]
}));
// Caja de metadatos
children.push(new Table({
  width: { size: 6400, type: WidthType.DXA }, columnWidths: [2000, 4400],
  alignment: AlignmentType.CENTER,
  rows: [
    ['Fecha', '30 de mayo de 2026 · actualizado 02 de junio de 2026'],
    ['Destinatarios', 'Socios y dirección'],
    ['Propósito', 'Evaluar el estado del proyecto y la viabilidad de iniciar una Beta'],
  ].map(([k, v]) => new TableRow({ children: [
    cell(k, { w: 2000, fill: AMBER, header: true }),
    cell(v, { w: 4400, fill: ALT_BG })
  ]}))
}));
// Nota de actualización (02/06)
children.push(spacer(160));
children.push(new Paragraph({
  shading: { fill: GREEN_BG, type: ShadingType.CLEAR },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 8 } },
  spacing: { before: 80, after: 120, line: 276 }, indent: { left: 160, right: 160 },
  children: [
    new TextRun({ text: 'Actualización (02/06/2026) — avances desde la versión original: ', bold: true, size: 22, color: '064E3B' }),
    new TextRun({ text: 'dos puntos que figuraban como preparación post-Beta ya fueron completados anticipadamente, lo que refuerza la posición del proyecto:', size: 22, color: '064E3B' }),
  ]
}));
children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80 }, indent: { left: 540, hanging: 260 },
  children: [
    new TextRun({ text: 'Endurecimiento de seguridad completo', bold: true, color: DARK, size: 22 }),
    new TextRun({ text: ' — se revisó y corrigió la totalidad de los puntos de seguridad detectados. Solo resta una auditoría externa opcional antes de la escala masiva.', size: 22, color: GRAY }),
  ] }));
children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80 }, indent: { left: 540, hanging: 260 },
  children: [
    new TextRun({ text: 'Ambiente de pruebas (staging) + recuperación ante fallas', bold: true, color: DARK, size: 22 }),
    new TextRun({ text: ' — entorno gemelo aislado para probar cambios sin riesgo, con respaldos automáticos y un procedimiento de “vuelta atrás” probado. Reduce significativamente el riesgo operativo de la Beta.', size: 22, color: GRAY }),
  ] }));
children.push(new Paragraph({ spacing: { before: 40, after: 80, line: 276 }, indent: { left: 160 },
  children: [new TextRun({ text: 'Con esto, los únicos pendientes para abrir la Beta son trámites externos (activar cobros reales y firmar digitalmente el instalador).', italics: true, size: 22, color: GRAY })] }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1. Resumen ejecutivo ----------------------------------------------------------
children.push(h1('1. Resumen ejecutivo'));
children.push(p('Procurador SCW es una plataforma de software que automatiza tareas judiciales repetitivas para abogados y procuradores en Argentina. Su desarrollo está muy avanzado: el producto funciona, se vende solo a profesionales con credenciales válidas del Poder Judicial, y ya tiene resueltos los tres pilares de un negocio digital: el producto, el cobro automático y la facturación.'));
children.push(new Paragraph({
  shading: { fill: GREEN_BG, type: ShadingType.CLEAR },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 8 } },
  spacing: { before: 120, after: 200, line: 276 },
  indent: { left: 160 },
  children: [
    new TextRun({ text: 'Conclusión principal: ', bold: true, size: 22, color: '064E3B' }),
    new TextRun({ text: 'el proyecto está listo para iniciar una Beta con un grupo reducido de usuarios reales, con la salvedad de completar tres tareas de bajo esfuerzo antes de abrir las puertas (ver sección 6).', size: 22, color: '064E3B' }),
  ]
}));

// 2. Qué hace -------------------------------------------------------------------
children.push(h1('2. ¿Qué hace el producto?'));
children.push(p('El profesional del derecho pierde muchas horas en tareas mecánicas dentro del sistema del Poder Judicial. Procurador SCW automatiza esas tareas con dos herramientas:'));
children.push(spacer(60));
children.push(table(
  [{ label: 'Herramienta', w: 2400 }, { label: 'Qué hace', w: 4760 }, { label: 'Dónde corre', w: 2200 }],
  [
    ['Aplicación de escritorio', 'Procura expedientes, genera informes de estado y monitorea si aparecen causas nuevas — todo automático', 'PC del usuario (Windows)'],
    ['Extensión de Chrome', 'Acelera la carga de números de expediente en 5 sistemas del Poder Judicial', 'Navegador del usuario'],
  ]
));
children.push(spacer(120));
children.push(new Paragraph({
  shading: { fill: YELLOW_BG, type: ShadingType.CLEAR },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: AMBER, space: 8 } },
  spacing: { before: 60, after: 200, line: 276 }, indent: { left: 160 },
  children: [
    new TextRun({ text: 'Dato clave de confianza: ', bold: true, size: 22, color: '78350F' }),
    new TextRun({ text: 'las contraseñas del Poder Judicial del usuario nunca pasan por nuestros servidores. Se manejan localmente en su propia computadora. Es un diferenciador fuerte en seguridad y privacidad.', size: 22, color: '78350F' }),
  ]
}));

// 3. Estado por fases -----------------------------------------------------------
children.push(h1('3. Estado del proyecto por etapas'));
children.push(p('El proyecto se organizó en 5 fases. Este es el estado real de cada una:'));
children.push(spacer(60));
children.push(table(
  [{ label: 'Fase', w: 2600 }, { label: 'Qué abarca', w: 4360 }, { label: 'Estado', w: 2400, align: AlignmentType.CENTER }],
  [
    ['1 — Producto', 'La aplicación y la extensión funcionando y pulidas', ST.ok('Operativa')],
    ['2 — Infraestructura', 'Servidores, base de datos, copias de seguridad', ST.ok('Operativa')],
    ['3 — Comercial', 'Página web, planes, identidad de marca', ST.ok('Operativa')],
    ['4 — Soporte', 'Sistema de tickets y asistente con IA', ST.ok('Cerrada')],
    ['5 — Cobranza', 'Cobro automático mensual + facturación', ST.ok('Validada en pruebas')],
  ]
));
children.push(spacer(120));
children.push(p('En síntesis: las 5 fases están construidas. Lo que resta no es desarrollo, sino activación de servicios externos y validación final.', { bold: true, color: DARK }));

// 4. Lo que funciona ------------------------------------------------------------
children.push(h1('4. Lo que ya funciona (verificado)'));
children.push(h2('El producto completo'));
children.push(bullet('Aplicación de escritorio publicada, con actualización automática (los usuarios reciben mejoras sin reinstalar)'));
children.push(bullet('Extensión de Chrome aprobada y publicada por Google en la Chrome Web Store'));
children.push(bullet('Página web pública con planes, precios y explicación del producto'));
children.push(h2('El recorrido completo del usuario'));
children.push(p('Desde que una persona se registra hasta que opera mes a mes, todo el circuito está implementado y probado: registro con verificación por email, período de prueba de 20 usos gratuitos, activación con control administrativo, configuración del medio de pago, cobro automático mensual, cancelación y reactivación, y manejo de pagos rechazados con período de gracia.'));
children.push(h2('El cobro automático'));
children.push(bullet('Integrado con MercadoPago (la pasarela más usada en Argentina)'));
children.push(bullet('Probado de punta a punta: alta, cobro, cancelación, reactivación y recuperación de pagos fallidos'));
children.push(bullet('Los datos de tarjeta nunca tocan nuestros servidores — se manejan en la plataforma segura de MercadoPago'));
children.push(h2('La facturación y el soporte'));
children.push(bullet('Panel de administración con sección de facturación operativa (la factura llega al instante al portal del usuario)'));
children.push(bullet('Sistema de tickets y asistente con inteligencia artificial para consultas frecuentes'));

// 5. Lo que falta ---------------------------------------------------------------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('5. Lo que falta (y por qué no es desarrollo)'));
children.push(p('Es importante entender que lo pendiente NO es construir cosas nuevas, sino activar y validar. Se divide en tres grupos:'));
children.push(h2('Grupo 1 — Activación de cuentas externas (gestión, no programación)'));
children.push(table(
  [{ label: 'Pendiente', w: 2800 }, { label: 'Qué implica', w: 4360 }, { label: 'Quién lo resuelve', w: 2200 }],
  [
    ['MercadoPago producción', 'Pasar de la cuenta de prueba a la real para cobrar dinero de verdad', 'Gestión administrativa'],
    ['Firma digital del instalador', 'Certificado que elimina advertencias de Windows al instalar', 'Trámite Microsoft (1-3 días)'],
    ['Facturación automática', 'Opcional — hoy la facturación es manual y funciona', 'Contrato con proveedor'],
  ]
));
children.push(h2('Grupo 2 — Verificaciones técnicas rápidas'));
children.push(bullet('Confirmar la renovación automática del certificado de seguridad del sitio (vence el 29 de junio)'));
children.push(bullet('Un ajuste menor de permisos en la base de datos'));
children.push(h2('Grupo 3 — Preparación para escala (post-Beta)'));
children.push(p('Ambiente de pruebas separado del de producción y auditoría de seguridad profunda. Son recomendables antes de un lanzamiento masivo, pero no bloquean una Beta controlada con pocos usuarios.'));

// 6. Requisitos Beta ------------------------------------------------------------
children.push(h1('6. Requisitos mínimos para iniciar la Beta'));
children.push(p('Para abrir el producto a un grupo reducido de usuarios reales, recomendamos completar estos tres puntos, todos de bajo esfuerzo:'));
children.push(spacer(60));
children.push(table(
  [{ label: '#', w: 600, align: AlignmentType.CENTER }, { label: 'Tarea', w: 3400 }, { label: 'Esfuerzo', w: 2000, align: AlignmentType.CENTER }, { label: 'Por qué', w: 3360 }],
  [
    ['1', 'Activar MercadoPago real', 'Bajo (gestión)', 'Para poder cobrar de verdad durante la Beta'],
    ['2', 'Verificar certificado de seguridad', 'Muy bajo', 'Evitar advertencias en el sitio'],
    ['3', 'Firmar digitalmente el instalador', 'Bajo (trámite)', 'Mejora la confianza al instalar la app'],
  ]
));
children.push(spacer(120));
children.push(new Paragraph({
  shading: { fill: ALT_BG, type: ShadingType.CLEAR },
  spacing: { before: 60, after: 160, line: 276 }, indent: { left: 160, right: 160 },
  children: [
    new TextRun({ text: 'Nota: ', bold: true, size: 22, color: DARK }),
    new TextRun({ text: 'si la Beta se hace con cobro simbólico o sin cobro inicial, incluso el punto 1 podría posponerse, permitiendo arrancar la prueba de inmediato.', size: 22, color: GRAY, italics: true }),
  ]
}));

// 7. Riesgos --------------------------------------------------------------------
children.push(h1('7. Evaluación de riesgos para la Beta'));
children.push(spacer(40));
children.push(table(
  [{ label: 'Riesgo', w: 3600 }, { label: 'Nivel', w: 1760, align: AlignmentType.CENTER }, { label: 'Mitigación', w: 4000 }],
  [
    ['Falla en el cobro automático', ST.ok('Bajo'), 'Ya validado; MercadoPago reintenta automáticamente'],
    ['Pérdida de datos de usuarios', ST.ok('Bajo'), 'Copias de seguridad activas; servidor profesional'],
    ['Filtración de credenciales judiciales', ST.ok('Muy bajo'), 'Por diseño, nunca pasan por nuestros servidores'],
    ['Sobrecarga del servidor', ST.warn('Medio'), 'Adecuado para Beta reducida; escalar antes del masivo'],
    ['Advertencia de Windows al instalar', ST.warn('Medio'), 'Se resuelve con la firma digital (punto 3)'],
  ]
));
children.push(spacer(120));
children.push(p('El perfil de riesgo para una Beta controlada es bajo.', { bold: true, color: DARK }));

// 8. Recomendación --------------------------------------------------------------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('8. Recomendación final'));
children.push(new Paragraph({
  shading: { fill: HEAD_BG, type: ShadingType.CLEAR },
  spacing: { before: 80, after: 200, line: 300 }, indent: { left: 200, right: 200 },
  children: [new TextRun({ text: 'El proyecto está en condiciones de iniciar una Beta con usuarios reales.', bold: true, size: 26, color: 'FFFFFF' })]
}));
children.push(p('Las 5 fases de desarrollo están construidas y el circuito completo —desde el registro hasta el cobro recurrente— fue probado exitosamente en entorno de pruebas. Lo que separa al proyecto de la Beta no es desarrollo de software, sino trámites de activación que se resuelven en días.'));
children.push(h2('Camino sugerido'));
children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80 },
  children: [new TextRun({ text: 'Semana 1: ', bold: true, color: DARK, size: 22 }), new TextRun({ text: 'activar MercadoPago real + verificar certificado + iniciar trámite de firma digital', size: 22, color: GRAY })] }));
children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80 },
  children: [new TextRun({ text: 'Semana 1-2: ', bold: true, color: DARK, size: 22 }), new TextRun({ text: 'seleccionar entre 5 y 15 usuarios de confianza (abogados/procuradores conocidos)', size: 22, color: GRAY })] }));
children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80 },
  children: [new TextRun({ text: 'Beta: ', bold: true, color: DARK, size: 22 }), new TextRun({ text: 'acompañamiento cercano, recolección de feedback y métricas de uso real', size: 22, color: GRAY })] }));
children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80 },
  children: [new TextRun({ text: 'Post-Beta: ', bold: true, color: DARK, size: 22 }), new TextRun({ text: 'auditoría de seguridad y preparación de infraestructura para apertura masiva', size: 22, color: GRAY })] }));

// 9. Conclusión inversores ------------------------------------------------------
children.push(h1('9. Conclusión para inversores'));
children.push(p('Procurador SCW no es un prototipo ni una idea: es un producto terminado, en producción, con monetización resuelta. La inversión de desarrollo ya rindió sus frutos principales. La etapa actual es de validación de mercado, que es exactamente lo que una Beta busca: confirmar que usuarios reales pagan por el producto y lo usan de forma recurrente.'));
children.push(new Paragraph({
  shading: { fill: YELLOW_BG, type: ShadingType.CLEAR },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: AMBER, space: 8 } },
  spacing: { before: 120, after: 200, line: 300 }, indent: { left: 160 },
  children: [
    new TextRun({ text: 'El próximo hito —pasar de “producto listo” a “primeros clientes pagando”— está a días de distancia, no meses.', bold: true, size: 24, color: '78350F' }),
  ]
}));
children.push(spacer(200));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'Documento preparado para evaluación interna. Para detalle técnico, consultar la documentación del proyecto.', italics: true, size: 18, color: '8A8A8A' })]
}));

// ── Documento ─────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22, color: GRAY } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: AMBER_D },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E5E5', space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: HEAD_BG },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ]
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: AMBER, space: 4 } },
      children: [new TextRun({ text: 'Procurador TOOL · Informe de Evaluación', size: 16, color: '8A8A8A' })]
    })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Confidencial — uso interno   |   Página ', size: 16, color: '8A8A8A' }),
                 new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '8A8A8A' })]
    })] }) },
    children
  }]
});

const out = path.join(__dirname, '../../docs/Informe-Evaluacion-Procurador-SCW.docx');
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(out, buf); console.log('OK:', out); });
