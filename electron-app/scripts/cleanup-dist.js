/**
 * cleanup-dist.js
 * Retiene los 2 instaladores más recientes en dist/ y elimina los anteriores.
 * Se ejecuta automáticamente antes de cada build (predist / prerelease).
 */

const fs   = require('fs');
const path = require('path');

const DIST_DIR   = path.join(__dirname, '..', 'dist');
const KEEP_COUNT = 2;

if (!fs.existsSync(DIST_DIR)) process.exit(0);

const exes = fs.readdirSync(DIST_DIR)
  .filter(f => f.endsWith('.exe'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);   // más reciente primero

const toDelete = exes.slice(KEEP_COUNT);

if (toDelete.length === 0) {
  console.log('[cleanup-dist] Nada que limpiar.');
  process.exit(0);
}

for (const { name } of toDelete) {
  const base = path.join(DIST_DIR, name);
  fs.rmSync(base, { force: true });
  fs.rmSync(base + '.blockmap', { force: true });
  console.log('[cleanup-dist] Eliminado:', name);
}

console.log(`[cleanup-dist] Retenidos: ${Math.min(exes.length, KEEP_COUNT)} instalador(es).`);
