/**
 * validarCampoParteScwpjn.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de prueba: busca "PARDO MONTOYA" en FCR, extrae TODOS los expedientes
 * navegando por todas las páginas del paginador, y muestra cada fila en consola.
 *
 * Verificación de cambio de página: antes de extraer datos de una nueva página,
 * se comprueba que el primer expediente visible sea distinto al de la página anterior.
 *
 * USO:
 *   node validarCampoParteScwpjn.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

const HOME_URL      = 'http://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam?cid=1';
const NOMBRE_PARTE  = 'PARDO MONTOYA';
const JURISDICCION  = '14'; // FCR — Justicia Federal de Comodoro Rivadavia

// ─── Detección de Chrome ──────────────────────────────────────────────────────
function detectarChrome() {
    const rutas = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    for (const r of rutas) {
        if (fs.existsSync(r)) { console.log(`✅ Chrome: ${r}`); return r; }
    }
    throw new Error('❌ Chrome no encontrado.');
}

// ─── Leer primer expediente visible en la tabla (para detectar cambio de pág.) ─
async function leerPrimerExpediente(page) {
    return page.$eval(
        'table[id*="dataTable"] tbody tr:first-child td.column:first-child',
        el => el ? el.textContent.trim() : ''
    ).catch(() => '');
}

// ─── Extraer todas las filas de la página actual ──────────────────────────────
async function extraerFilasPaginaActual(page) {
    return page.evaluate(() => {
        const rows = Array.from(
            document.querySelectorAll('table[id*="dataTable"] tbody tr')
        ).filter(r => r.textContent.trim());

        return rows.map(row => {
            const celdas = row.querySelectorAll('td.column');
            return {
                expediente:       (celdas[0] || {}).textContent?.trim() ?? '',
                dependencia:      (celdas[1] || {}).textContent?.trim() ?? '',
                caratula:         (celdas[2] || {}).textContent?.trim() ?? '',
                situacion:        (celdas[3] || {}).textContent?.trim() ?? '',
                ultima_actuacion: (celdas[4] || {}).textContent?.trim() ?? '',
            };
        });
    });
}

// ─── Función principal ────────────────────────────────────────────────────────
async function ejecutar() {
    const profilePath = path.join(process.env.LOCALAPPDATA || '', 'ProcuradorSCW', 'ChromeProfile');
    const chromePath  = detectarChrome();

    console.log(`\n🔍 Buscando "${NOMBRE_PARTE}" en FCR (jurisdicción ${JURISDICCION})...\n`);

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath,
        args: [`--user-data-dir=${profilePath}`, '--no-sandbox', '--ignore-certificate-errors'],
        defaultViewport: null,
    });

    const page = (await browser.pages())[0] || await browser.newPage();

    // ─── 1. Sesión ────────────────────────────────────────────────────────────
    console.log('🌐 Navegando al SCW...');
    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('⏳ Esperando sesión activa...');
    await page.waitForSelector('a[id$="menuNuevaConsulta"]', { timeout: 60000 });
    console.log('✅ Sesión activa.\n');

    // ─── 2. Nueva Consulta Pública ────────────────────────────────────────────
    console.log('📂 Abriendo "Nueva Consulta Pública"...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
        page.click('a[id$="menuNuevaConsulta"]'),
    ]);
    await new Promise(r => setTimeout(r, 2000));

    // ─── 3. Tab "Por Parte" ───────────────────────────────────────────────────
    console.log('🗂️  Seleccionando tab "Por Parte"...');
    await page.waitForSelector(
        'td[id$="porParte:header:inactive"], td[id$="porParte:header:active"]',
        { timeout: 10000 }
    );
    const tabInact = await page.$('td[id$="porParte:header:inactive"]');
    if (tabInact) {
        await tabInact.click();
        await new Promise(r => setTimeout(r, 1500));
    }
    await page.waitForSelector('input[name="formPublica:nomIntervParte"]', { timeout: 15000 });
    await page.waitForSelector('input[id$="buscarPorParteButton"]',        { timeout: 10000 });

    // ─── 4. Cargar jurisdicción y nombre ──────────────────────────────────────
    console.log(`📋 Jurisdicción: FCR (${JURISDICCION})`);
    await page.select('select[name="formPublica:camaraPartes"]', JURISDICCION);

    console.log(`✍️  Ingresando nombre: "${NOMBRE_PARTE}"`);
    await page.$eval('input[name="formPublica:nomIntervParte"]', el => { el.value = ''; });
    await page.type('input[name="formPublica:nomIntervParte"]', NOMBRE_PARTE, { delay: 40 });
    await new Promise(r => setTimeout(r, 400));

    const valorFinal = await page.$eval('input[name="formPublica:nomIntervParte"]', el => el.value);
    console.log(`   → Valor en campo: "${valorFinal}"`);

    // ─── 5. Consultar ─────────────────────────────────────────────────────────
    console.log('\n🔎 Presionando "Consultar"...');
    await page.click('input[id$="buscarPorParteButton"]');

    // Esperar resultado (ignorar mientras muestra "Por favor espere")
    console.log('⏳ Esperando resultado...');
    await page.waitForFunction(
        () => {
            const cargando = document.querySelector('.alert.alert-info');
            if (cargando && cargando.innerText && cargando.innerText.includes('espere')) return false;

            if (document.querySelector('table[id*="dataTable"]')) return true;

            const body = document.body ? document.body.innerText : '';
            if (body.includes('No se han encontrado') ||
                body.includes('lista se encuentra vacia')) return true;

            return false;
        },
        { timeout: 60000 }
    );

    // ─── 6. Verificar si hay tabla ─────────────────────────────────────────────
    const hayTabla = await page.$('table[id*="dataTable"]') !== null;
    if (!hayTabla) {
        console.log('\n⚠️  Sin resultados — la búsqueda no devolvió expedientes.');
        await browser.close();
        return;
    }

    // ─── 7. Extraer todas las páginas ─────────────────────────────────────────
    const todosLosExpedientes = [];
    let numeroPagina = 1;
    let primerExpAnterior = '';

    while (true) {
        console.log(`\n─── Página ${numeroPagina} ────────────────────────────────────`);

        // Verificar que la página cambió (primer expediente distinto al anterior)
        if (numeroPagina > 1) {
            const primerExpActual = await leerPrimerExpediente(page);
            if (primerExpActual === primerExpAnterior) {
                console.log(`⚠️  El primer expediente no cambió ("${primerExpActual}") — deteniendo para evitar duplicados.`);
                break;
            }
            console.log(`✅ Página nueva confirmada (primer exp: "${primerExpActual}")`);
        }

        primerExpAnterior = await leerPrimerExpediente(page);

        // Extraer filas de esta página
        const filas = await extraerFilasPaginaActual(page);
        console.log(`   ${filas.length} expediente(s) en esta página:`);
        filas.forEach((f, idx) => {
            console.log(`   [${todosLosExpedientes.length + idx + 1}] ${f.expediente}`);
            console.log(`        Dependencia:      ${f.dependencia}`);
            console.log(`        Carátula:         ${f.caratula}`);
            console.log(`        Situación:        ${f.situacion}`);
            console.log(`        Últ. actuación:   ${f.ultima_actuacion}`);
        });
        todosLosExpedientes.push(...filas);

        // Verificar si hay botón "Siguiente"
        const haySiguiente = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('ul.pagination li a'));
            return links.some(a => a.innerText && a.innerText.includes('Siguiente'));
        });

        if (!haySiguiente) {
            console.log('\n   ✅ No hay más páginas.');
            break;
        }

        // Click en "Siguiente"
        console.log('\n   ⏭️  Navegando a página siguiente...');
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('ul.pagination li a'));
            const btn   = links.find(a => a.innerText && a.innerText.includes('Siguiente'));
            if (btn) btn.click();
        });

        // Esperar nueva tabla (ignorar "Por favor espere")
        await page.waitForFunction(
            () => {
                const cargando = document.querySelector('.alert.alert-info');
                if (cargando && cargando.innerText && cargando.innerText.includes('espere')) return false;
                return document.querySelector('table[id*="dataTable"]') !== null;
            },
            { timeout: 30000 }
        );
        await new Promise(r => setTimeout(r, 1000));
        numeroPagina++;
    }

    // ─── 8. Resumen y guardado ────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════');
    console.log(`📊 TOTAL: ${todosLosExpedientes.length} expediente(s) extraído(s) en ${numeroPagina} página(s)`);
    console.log('══════════════════════════════════════════════════\n');

    const reportPath = path.join(__dirname, 'validacion_campo_parte.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        busqueda: { nombre: NOMBRE_PARTE, jurisdiccion: JURISDICCION },
        totalExpedientes: todosLosExpedientes.length,
        totalPaginas: numeroPagina,
        expedientes: todosLosExpedientes,
    }, null, 2), 'utf8');
    console.log(`📁 Datos guardados en: ${reportPath}\n`);

    await browser.close();
}

// ─── Arranque ─────────────────────────────────────────────────────────────────
ejecutar().catch(err => {
    console.error('\n❌ Error fatal:', err.message);
    process.exit(1);
});
