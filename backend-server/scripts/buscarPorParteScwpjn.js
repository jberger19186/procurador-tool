/**
 * buscarPorParteScwpjn.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo de scraping para la pestaña "Por Parte" del SCW (pjn.gov.ar).
 * Recorre automáticamente todas las páginas del paginador y retorna la lista
 * completa de expedientes asociados a la parte buscada.
 *
 * Exporta:
 *   buscarPorParte(page, jurisdiccionCodigo, nombreParte) → Array<Expediente>
 *
 * Flujo confirmado en pruebas:
 *   1. Click menuNuevaConsulta + waitForNavigation
 *   2. Click tab "Por Parte" (<td>, no <a>) + pausa
 *   3. Seleccionar jurisdicción en select[name="formPublica:camaraPartes"]
 *   4. Escribir nombre en input[name="formPublica:nomIntervParte"]
 *   5. Click input[id$="buscarPorParteButton"]
 *   6. waitForFunction ignorando .alert.alert-info con "espere"
 *   7. Extraer filas con td.column (índices 0-4)
 *   8. Paginar via ul.pagination a[text~="Siguiente"] + verificación de cambio
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Selectores del SCW (pestaña Por Parte, confirmados en pruebas) ───────────
const SEL = {
    menuNuevaConsulta:   'a[id$="menuNuevaConsulta"]',
    tabPorParteInactivo: 'td[id$="porParte:header:inactive"]',
    tabPorParteActivo:   'td[id$="porParte:header:active"]',
    selectJurisdiccion:  'select[name="formPublica:camaraPartes"]',
    inputNombreParte:    'input[name="formPublica:nomIntervParte"]',
    btnConsultar:        'input[id$="buscarPorParteButton"]',
    tablaResultados:     'table[id*="dataTable"]',
    // Celdas de datos: td.column (excluye la columna de botones)
    celdaColumna:        'td.column',
};

// ─── Helper: leer primer número de expediente visible ────────────────────────
// Usado para verificar que la página cambió antes de extraer datos.
async function leerPrimerExpediente(page) {
    return page.$eval(
        `${SEL.tablaResultados} tbody tr:first-child td.column:first-child`,
        el => el ? el.textContent.trim() : ''
    ).catch(() => '');
}

// ─── Helper: waitForFunction que ignora el estado "Por favor espere" ──────────
async function esperarResultado(page, timeout = 30000) {
    await page.waitForFunction(
        () => {
            // Ignorar mientras SCW muestra "Por favor espere"
            const cargando = document.querySelector('.alert.alert-info');
            if (cargando && cargando.innerText && cargando.innerText.includes('espere')) {
                return false;
            }

            // Resultado positivo: tabla presente
            if (document.querySelector('table[id*="dataTable"]')) return true;

            // Sin resultados (texto real del SCW)
            const body = document.body ? document.body.innerText : '';
            if (body.includes('No se han encontrado') ||
                body.includes('lista se encuentra vacia')) return true;

            return false;
        },
        { timeout }
    );
}

/**
 * Navega a la pestaña "Por Parte", ingresa los criterios y retorna todos los
 * expedientes encontrados recorriendo todas las páginas del paginador.
 *
 * @param {Object} page               - Instancia de página Puppeteer
 * @param {string} jurisdiccionCodigo - Código numérico SCW ('0'-'27')
 * @param {string} nombreParte        - Nombre o parte del nombre a buscar
 * @returns {Promise<Array>}          - Array de { numero_expediente, dependencia, caratula, situacion, ultima_actuacion }
 */
async function buscarPorParte(page, jurisdiccionCodigo, nombreParte) {
    console.log(`🔍 Buscando por parte: jurisdicción=${jurisdiccionCodigo}, nombre="${nombreParte}"`);

    // 1. Click en "Nueva Consulta Pública" + esperar navegación
    await page.waitForSelector(SEL.menuNuevaConsulta, { timeout: 15000 });
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
        page.click(SEL.menuNuevaConsulta),
    ]);
    await new Promise(r => setTimeout(r, 2000)); // pausa para que JSF renderice los tabs

    // 2. Activar pestaña "Por Parte" (el tab es un <td>, no un <a>)
    await page.waitForSelector(
        `${SEL.tabPorParteInactivo}, ${SEL.tabPorParteActivo}`,
        { timeout: 10000 }
    );
    const tabInactivo = await page.$(SEL.tabPorParteInactivo);
    if (tabInactivo) {
        await tabInactivo.click();
        await new Promise(r => setTimeout(r, 1500));
    }

    // 3. Esperar formulario y botón
    await page.waitForSelector(SEL.inputNombreParte, { timeout: 15000 });
    await page.waitForSelector(SEL.btnConsultar,     { timeout: 10000 });

    // 4. Seleccionar jurisdicción
    await page.select(SEL.selectJurisdiccion, String(jurisdiccionCodigo));
    console.log(`   ✅ Jurisdicción seleccionada: ${jurisdiccionCodigo}`);

    // 5. Ingresar nombre de la parte
    await page.$eval(SEL.inputNombreParte, el => {
        el.value = '';
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.type(SEL.inputNombreParte, nombreParte, { delay: 30 });
    console.log(`   ✅ Nombre ingresado: "${nombreParte}"`);

    // 6. Click en "Consultar"
    await page.click(SEL.btnConsultar);
    console.log('   ⏳ Esperando resultados...');

    // 7. Esperar primera respuesta del SCW
    await esperarResultado(page, 60000);

    // 8. Verificar si hay tabla (puede no haber resultados)
    const hayTabla = await page.$(SEL.tablaResultados) !== null;
    if (!hayTabla) {
        console.log(`   ℹ️ Sin resultados para "${nombreParte}" en jurisdicción ${jurisdiccionCodigo}`);
        return [];
    }

    // 9. Recorrer todas las páginas y acumular expedientes
    const expedientes = [];
    let pagina          = 1;
    let primerExpAnterior = '';

    while (true) {
        // Verificar cambio de página (anti-duplicados)
        if (pagina > 1) {
            const MAX_ESPERA_PAGINA   = 5;   // reintentos
            const ESPERA_PAGINA_MS    = 5000; // ms entre reintento
            let primerExpActual = await leerPrimerExpediente(page);
            if (primerExpActual && primerExpActual === primerExpAnterior) {
                let cambioPagina = false;
                for (let intento = 1; intento <= MAX_ESPERA_PAGINA; intento++) {
                    console.warn(`   ⏳ Página aún no cambió (primer exp: "${primerExpActual}") — esperando ${ESPERA_PAGINA_MS / 1000}s (${intento}/${MAX_ESPERA_PAGINA})...`);
                    await new Promise(r => setTimeout(r, ESPERA_PAGINA_MS));
                    primerExpActual = await leerPrimerExpediente(page);
                    if (!primerExpActual || primerExpActual !== primerExpAnterior) {
                        cambioPagina = true;
                        break;
                    }
                }
                if (!cambioPagina) {
                    const err = new Error(`La página no cambió al navegar tras ${MAX_ESPERA_PAGINA} reintentos (primer exp: "${primerExpActual}") — posible error de navegación.`);
                    err.partialExpedientes = expedientes;
                    throw err;
                }
                console.log(`   ✅ Página cargó tras espera extra.`);
            }
        }
        primerExpAnterior = await leerPrimerExpediente(page);

        // Extraer filas de la página actual usando td.column (excluye columna de botones)
        const filasPagina = await page.evaluate((selTabla) => {
            const rows = Array.from(
                document.querySelectorAll(`${selTabla} tbody tr`)
            ).filter(r => r.textContent.trim());

            return rows.map(row => {
                const celdas = row.querySelectorAll('td.column');
                return {
                    numero_expediente: celdas[0] ? celdas[0].textContent.trim() : '',
                    dependencia:       celdas[1] ? celdas[1].textContent.trim() : '',
                    caratula:          celdas[2] ? celdas[2].textContent.trim() : '',
                    situacion:         celdas[3] ? celdas[3].textContent.trim() : '',
                    ultima_actuacion:  celdas[4] ? celdas[4].textContent.trim() : '',
                };
            }).filter(r => r.numero_expediente !== '');
        }, SEL.tablaResultados);

        if (filasPagina.length === 0) {
            console.log(`   📄 Página ${pagina}: tabla vacía — finalizando.`);
            break;
        }

        expedientes.push(...filasPagina);
        console.log(`   📄 Página ${pagina}: ${filasPagina.length} expediente(s) — acumulado: ${expedientes.length}`);

        // Verificar si hay botón "Siguiente"
        const haySiguiente = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('ul.pagination li a'));
            return links.some(a => a.innerText && a.innerText.includes('Siguiente'));
        });

        if (!haySiguiente) {
            console.log('   ✅ Última página alcanzada.');
            break;
        }

        // Click en "Siguiente" y esperar carga de nueva página
        console.log(`   ➡️ Navegando a página ${pagina + 1}...`);
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('ul.pagination li a'));
            const btn   = links.find(a => a.innerText && a.innerText.includes('Siguiente'));
            if (btn) btn.click();
        });
        await esperarResultado(page, 30000);
        await new Promise(r => setTimeout(r, 500));
        pagina++;
    }

    console.log(`   ✅ Búsqueda completada: ${expedientes.length} expediente(s) en ${pagina} página(s)`);
    return expedientes;
}

module.exports = { buscarPorParte };
