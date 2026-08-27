// demo-fixtures/portal.js
//
// D2 — fixtures del portal para el capítulo 7 (Dashboard y Gestión) de la
// demo: Facturación y Soporte. Mi Plan/Descargas/Ayuda no necesitan fixture
// propio — Mi Plan lee directo de cuenta.js, Descargas y Ayuda son contenido
// estático del portal (no dependen de datos de cuenta).

function isoDaysAgo(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString();
}

// Facturación (§7.3): 2 facturas ya emitidas, ninguna pendiente — la demo
// muestra el estado normal de una cuenta al día, no un caso de error.
const PORTAL_FACTURAS = [
  {
    id: 501,
    invoice_type: 'C',
    numero: '0001-00000501',
    amount: 15000,
    issued_at: isoDaysAgo(32),
    status: 'issued',
    pdf_url: null, // el placeholder lo crea generar-visores.js si el capítulo lo necesita
  },
  {
    id: 502,
    invoice_type: 'C',
    numero: '0001-00000502',
    amount: 15000,
    issued_at: isoDaysAgo(2),
    status: 'issued',
    pdf_url: null,
  },
];

// Soporte (§7.4): 1 ticket ya resuelto, con una respuesta del equipo — para
// que la vista de detalle tenga un hilo real que mostrar en vez de un ticket
// vacío recién creado.
const PORTAL_TICKETS = [
  {
    id: 77,
    subject: 'Consulta sobre el módulo Markdown',
    category: 'consulta',
    status: 'resolved',
    priority: 'low',
    priority_source: 'ai',
    created_at: isoDaysAgo(9),
    comments: [
      {
        author_role: 'user',
        body: 'Hola, ¿el Markdown anonimizado se puede compartir con un colega sin riesgo?',
        visibility: 'external',
        created_at: isoDaysAgo(9),
      },
      {
        author_role: 'admin',
        body: 'Sí — el anonimizador reemplaza nombres, CUIT y domicilios antes de generar el archivo. Igual te recomendamos revisarlo una vez antes de enviarlo, por las dudas.',
        visibility: 'external',
        created_at: isoDaysAgo(8),
      },
    ],
  },
];

module.exports = { PORTAL_FACTURAS, PORTAL_TICKETS };
