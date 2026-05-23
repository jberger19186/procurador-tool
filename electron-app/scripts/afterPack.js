/**
 * afterPack.js — Hook de electron-builder ejecutado después de empaquetar.
 * Embebe el ícono correcto en el ejecutable usando rcedit.
 * Necesario porque electron-builder a veces no aplica el ícono en el .exe.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');

module.exports = async ({ appOutDir, packager }) => {
    if (packager.platform.name !== 'windows') return;

    const exePath = path.join(appOutDir, `${packager.appInfo.productName}.exe`);
    const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');
    const rcedit = path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');

    if (!fs.existsSync(exePath)) {
        console.warn(`[afterPack] No se encontró el exe: ${exePath}`);
        return;
    }
    if (!fs.existsSync(icoPath)) {
        console.warn(`[afterPack] No se encontró el ícono: ${icoPath}`);
        return;
    }

    try {
        execFileSync(rcedit, [exePath, '--set-icon', icoPath]);
        console.log(`[afterPack] ✅ Ícono embebido en ${path.basename(exePath)}`);
    } catch (e) {
        console.error(`[afterPack] ❌ Error al embeber ícono: ${e.message}`);
    }
};
