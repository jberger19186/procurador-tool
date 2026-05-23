/**
 * generate-icon.js
 * Genera build/icon.png (512x512) y build/icon.ico a partir del emoji ⚖️
 * Uso: node scripts/generate-icon.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
    const pngPath = path.join(__dirname, '..', 'build', 'icon.png');
    const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 512px; height: 512px;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(145deg, #f5a623 0%, #e8820c 55%, #d97706 100%);
    border-radius: 112px;
    overflow: hidden;
  }
  .icon {
    font-size: 290px;
    line-height: 1;
    filter: brightness(0) invert(1) drop-shadow(0 6px 16px rgba(0,0,0,0.25));
  }
</style>
</head>
<body>
  <span class="icon">⚖️</span>
</body>
</html>`;

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    const screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: 512, height: 512 },
        omitBackground: false
    });

    await browser.close();

    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, screenshot);
    console.log(`✅ PNG generado: ${pngPath}`);

    // Generar .ico con múltiples tamaños (requerido por electron-builder en Windows)
    const { default: pngToIco } = await import('png-to-ico');
    const icoBuf = await pngToIco(pngPath);
    fs.writeFileSync(icoPath, icoBuf);
    console.log(`✅ ICO generado: ${icoPath}`);
})();
