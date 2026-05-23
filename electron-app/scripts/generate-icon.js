/**
 * generate-icon.js
 * Genera build/icon.png (512x512) y build/icon.ico (multi-resolución) a partir del emoji ⚖️
 * Uso: node scripts/generate-icon.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SIZES = [16, 32, 48, 256, 512];

async function renderSize(page, size) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const fontSize = Math.round(size * 0.82);
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin:0;padding:0;box-sizing:border-box; }
body { width:${size}px;height:${size}px;display:flex;align-items:center;
       justify-content:center;background:transparent; }
.icon { font-size:${fontSize}px;line-height:1; }
</style></head><body><span class="icon">⚖️</span></body></html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));
    return page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: size, height: size },
        omitBackground: true
    });
}

(async () => {
    const buildDir = path.join(__dirname, '..', 'build');
    fs.mkdirSync(buildDir, { recursive: true });

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    const pngs = {};
    for (const size of SIZES) {
        const p = await browser.newPage();
        pngs[size] = await renderSize(p, size);
        await p.close();
        console.log(`  rendered ${size}x${size}`);
    }
    await browser.close();

    // Guardar PNG principal (512x512)
    const pngPath = path.join(buildDir, 'icon.png');
    fs.writeFileSync(pngPath, pngs[512]);
    console.log(`✅ PNG generado: ${pngPath}`);

    // Guardar PNGs temporales para ICO
    const tmpFiles = [];
    for (const size of [16, 32, 48, 256]) {
        const tmp = path.join(buildDir, `icon_${size}.png`);
        fs.writeFileSync(tmp, pngs[size]);
        tmpFiles.push(tmp);
    }

    // Generar ICO multi-resolución
    const { default: pngToIco } = await import('png-to-ico');
    const icoBuf = await pngToIco(tmpFiles);
    const icoPath = path.join(buildDir, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuf);
    console.log(`✅ ICO multi-resolución generado: ${icoPath}`);

    // Limpiar temporales
    tmpFiles.forEach(f => fs.unlinkSync(f));

    console.log('\n→ Próximo paso: npm run release');
})();
