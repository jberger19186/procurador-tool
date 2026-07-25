/**
 * utils/invoiceStorage.js
 * Resolución del directorio de PDFs de facturas.
 *
 * C1 (revisión 2026-07-25): los PDF vivían en `public/invoices/` y se servían con
 * `express.static` SIN autenticación — cualquiera con la URL (o adivinando el nombre
 * `factura_<id>_<timestamp>.pdf`, donde el id es secuencial) descargaba la factura de otro
 * usuario, que incluye nombre, CUIT, domicilio e importes. Verificado en producción.
 *
 * Ahora viven FUERA de `public/` (para que ningún `express.static` los alcance por
 * descuido) y se sirven solo por rutas autenticadas que validan la propiedad:
 *   - GET /usuarios/api/invoices/:id/pdf  (el usuario dueño)
 *   - GET /admin/invoices/:id/pdf         (admin)
 */

const path = require('path');
const fs   = require('fs');

// backend-server/storage/invoices — fuera de public/
const INVOICES_DIR = path.join(__dirname, '..', 'storage', 'invoices');

function ensureInvoicesDir() {
    if (!fs.existsSync(INVOICES_DIR)) fs.mkdirSync(INVOICES_DIR, { recursive: true });
    return INVOICES_DIR;
}

/**
 * resolveInvoiceFile — devuelve la ruta absoluta del PDF a partir del `pdf_url` guardado
 * en la DB (histórico: "/invoices/factura_33_1782524511845.pdf").
 *
 * Usa SOLO el basename: si el valor de la columna se corrompiera o llevara un path
 * relativo ("../../.env"), path.basename lo neutraliza → imposible salir del directorio.
 * Devuelve null si no hay archivo o si no existe en disco.
 *
 * @param {string|null} pdfUrl  valor de invoices.pdf_url
 * @returns {string|null} ruta absoluta existente, o null
 */
function resolveInvoiceFile(pdfUrl) {
    if (!pdfUrl || typeof pdfUrl !== 'string') return null;
    const base = path.basename(pdfUrl.trim());
    if (!base || !base.toLowerCase().endsWith('.pdf')) return null;
    const full = path.join(INVOICES_DIR, base);
    // Defensa extra: el resultado DEBE quedar dentro del directorio de facturas.
    if (path.dirname(full) !== INVOICES_DIR) return null;
    if (!fs.existsSync(full)) return null;
    return full;
}

module.exports = { INVOICES_DIR, ensureInvoicesDir, resolveInvoiceFile };
