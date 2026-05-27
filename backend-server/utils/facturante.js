/**
 * utils/facturante.js
 * Wrapper para el servicio SOAP de Facturante (Factura C — Monotributista)
 *
 * Pre-requisito: contratar Pack 50 en https://www.facturante.com
 * y cargar en .env: FACTURANTE_WSDL_URL, FACTURANTE_EMPRESA,
 *                   FACTURANTE_USUARIO, FACTURANTE_HASH, FACTURANTE_PUNTO_VENTA
 *
 * Documentación interna: docs/internal/plan-fase5-cobranza.md § 5.3
 */

const soap = require('soap');
const logger = require('./logger');

// Errores de datos inválidos — no reintentar (falla permanente)
const PERMANENT_ERROR_CODES = [1, 5, 6, 8, 9, 11, 15, 18];

let _soapClient = null;

/**
 * getSoapClient — obtiene/reutiliza el cliente SOAP (lazy init)
 */
async function getSoapClient() {
  if (_soapClient) return _soapClient;

  const wsdlUrl = process.env.NODE_ENV === 'production'
    ? process.env.FACTURANTE_WSDL_URL_PROD
    : process.env.FACTURANTE_WSDL_URL;

  if (!wsdlUrl) {
    throw new Error('FACTURANTE_WSDL_URL no configurado');
  }

  _soapClient = await soap.createClientAsync(wsdlUrl);
  logger.info('[Facturante] Cliente SOAP inicializado');
  return _soapClient;
}

/**
 * crearFacturaC — emite una Factura C para un pago dado
 *
 * @param {Object} params
 * @param {string} params.cuit         CUIT del cliente (sin guiones)
 * @param {string} params.razonSocial  Nombre completo del cliente
 * @param {number} params.importe      Monto en ARS (ej: 1500.00)
 * @param {string} params.concepto     Descripción (ej: "Suscripción Procurador SCW — Plan COMBO_PROMO")
 * @param {string} params.email        Email del cliente para envío del PDF
 * @returns {Promise<{cae, numero, pdfUrl, facturanteId}>}
 */
async function crearFacturaC({ cuit, razonSocial, importe, concepto, email }) {
  const client = await getSoapClient();

  const args = {
    Empresa:     process.env.FACTURANTE_EMPRESA,
    Usuario:     process.env.FACTURANTE_USUARIO,
    Hash:        process.env.FACTURANTE_HASH,
    PuntoVenta:  process.env.FACTURANTE_PUNTO_VENTA || '0001',
    TipoComprobante: 'C',
    CUIT:        cuit || '00000000000',   // si no tiene CUIT, usar cero (factura anónima)
    RazonSocial: razonSocial || 'Consumidor Final',
    Importe:     importe.toFixed(2),
    Concepto:    concepto,
    Email:       email
  };

  logger.info('[Facturante] Emitiendo factura C', { cuit, importe });

  // Llamada SOAP — el método exacto se confirma al obtener el WSDL de Facturante
  const [result] = await client.CrearComprobanteSinImpuestosAsync(args);

  // Parse de respuesta (nombres de campos según WSDL — verificar al integrar)
  const estado     = result?.Estado     || result?.estado;
  const mensaje    = result?.Mensaje    || result?.mensaje;
  const cae        = result?.CAE        || result?.Cae        || result?.cae;
  const numero     = result?.Numero     || result?.numero;
  const pdfUrl     = result?.URLPDF     || result?.UrlPdf     || result?.urlpdf;
  const idComprobante = result?.IdComprobante || result?.idComprobante;

  if (estado !== 'OK' && estado !== '1') {
    // Determinar si el error es permanente o transitorio
    const errorCode = parseInt(result?.CodigoError || result?.codigoError || '0', 10);
    const isPermanent = PERMANENT_ERROR_CODES.includes(errorCode);
    const err = new Error(`Facturante error: ${mensaje} (código: ${errorCode})`);
    err.facturanteCode = errorCode;
    err.isPermanent = isPermanent;
    throw err;
  }

  logger.info('[Facturante] Factura emitida OK', { cae, numero });

  return { cae, numero, pdfUrl, facturanteId: idComprobante };
}

/**
 * crearFacturaCConRetry — reintenta hasta 3 veces con backoff exponencial
 * Lanza el error directamente si es un error permanente (datos inválidos)
 *
 * @param {Object} params  Los mismos parámetros de crearFacturaC
 * @param {number} [maxRetries=3]
 */
async function crearFacturaCConRetry(params, maxRetries = 3) {
  const delays = [60_000, 300_000, 1_800_000]; // 1m → 5m → 30m

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await crearFacturaC(params);
    } catch (err) {
      // Error de datos inválidos → no reintentar
      if (err.isPermanent) {
        logger.error('[Facturante] Error permanente — no se reintenta', { code: err.facturanteCode, msg: err.message });
        throw err;
      }

      if (attempt === maxRetries) {
        logger.error('[Facturante] Agotados reintentos', { attempts: maxRetries, msg: err.message });
        throw err;
      }

      const delay = delays[attempt] || delays[delays.length - 1];
      logger.warn(`[Facturante] Intento ${attempt + 1} fallido — reintentando en ${delay / 1000}s`, { msg: err.message });
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

module.exports = { crearFacturaC, crearFacturaCConRetry, getSoapClient };
