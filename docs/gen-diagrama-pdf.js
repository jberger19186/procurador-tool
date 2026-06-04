// gen-diagrama-pdf.js — Renderiza el diagrama de flujo de usuario (Mermaid) a PDF.
// Uso: node gen-diagrama-pdf.js
// Requiere: puppeteer (de electron-app) + Chrome del sistema + acceso a internet (CDN mermaid).
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'electron-app', 'node_modules', 'puppeteer'));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'diagrama-flujo-usuario.pdf');

// Código Mermaid de los dos diagramas (sincronizado con diagrama-flujo-usuario.md)
const happyPath = `flowchart TD
    A([🌐 Usuario visita<br/>procuradortool.com]) --> B[📝 Completa formulario<br/>de registro]
    B --> C[📧 Recibe email<br/>de verificación]
    C --> D{Verifica<br/>email?}
    D -- Sí --> E["⏳ Trial: <b>20 usos</b><br/>app + extensión<br/>hasta configurar el pago"]
    D -- No --> X1[❌ Cuenta sin verificar<br/>no puede operar]
    E --> F{Admin<br/>aprueba?}
    F -- Sí --> G[✅ Cuenta aprobada<br/>sigue con el trial de 20 usos]
    F -- No --> X2[❌ Cuenta rechazada]
    G --> H[💳 Usuario configura<br/>método de pago<br/>en MercadoPago]
    H --> I[💰 Pago configurado / cobro aprobado]
    I --> J[🧹 Se asignan límites del plan<br/>contador a 0 · se elimina el trial]
    J --> K[🚀 Operación normal:<br/>procuración · informes · monitor]
    K --> L[🔄 Renovación automática<br/>mes a mes]
    L --> K
    classDef inicio  fill:#1e3a5f,stroke:#0c2547,color:#fff,stroke-width:2px
    classDef accion  fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px
    classDef sistema fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
    classDef admin   fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:2px
    classDef ok      fill:#d1fae5,stroke:#059669,color:#064e3b,stroke-width:2px
    classDef error   fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
    classDef decision fill:#fff,stroke:#6b7280,color:#1f2937,stroke-width:2px
    class A inicio
    class B,C,H accion
    class D,F decision
    class E,I,J,L sistema
    class G,K ok
    class X1,X2 error`;

const altPath = `flowchart LR
    A[✅ Cuenta activa<br/>con suscripción] --> B{Evento}
    B -- Usuario<br/>cancela --> C1[📅 Cancelación programada<br/>al fin del período pago]
    C1 --> C2[Acceso continúa hasta<br/>fin del período]
    C2 --> C3[🔒 Cuenta cancelada]
    C1 -. Usuario<br/>reactiva .-> A
    B -- Pago<br/>rechazado --> D1[⏰ 3 días de gracia<br/>MP reintenta cada 6h]
    D1 -- Pago<br/>recuperado --> A
    D1 -- Sin pago --> D2[🚫 Suspendida por pago]
    D2 -- Usuario actualiza<br/>método de pago --> A
    B -- Plan vence --> E1[⏳ Suspendida por<br/>vencimiento de plan]
    E1 -- Renueva plan --> A
    B -- Admin<br/>suspende --> F1[⛔ Suspendida<br/>por administrador]
    F1 -- Admin revisa<br/>y reactiva --> A
    classDef ok      fill:#d1fae5,stroke:#059669,color:#064e3b,stroke-width:2px
    classDef warning fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px
    classDef error   fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
    classDef decision fill:#fff,stroke:#6b7280,color:#1f2937,stroke-width:2px
    class A ok
    class B decision
    class C1,D1,E1 warning
    class C2 ok
    class C3,D2,F1 error`;

const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Inter, system-ui, sans-serif; color:#1a1a1a; margin:0; padding:32px 40px; background:#fff; }
  h1 { font-size:24px; color:#b45309; border-bottom:3px solid #d97706; padding-bottom:8px; margin:0 0 4px; }
  .sub { color:#8a8a8a; font-size:12px; margin-bottom:24px; }
  h2 { font-size:17px; color:#1e3a5f; margin:18px 0 8px; }
  section { page-break-inside: avoid; }
  .mermaid { display:flex; justify-content:center; }
  .mermaid svg { max-width:100% !important; max-height:160mm !important; height:auto !important; }
  .page-break { page-break-before: always; }
  table { border-collapse:collapse; width:100%; font-size:12px; margin-top:8px; }
  th,td { border:1px solid #e5e7eb; padding:6px 10px; text-align:left; }
  th { background:#fef3c7; color:#78350f; }
  .foot { margin-top:24px; font-size:11px; color:#8a8a8a; text-align:center; }
</style>
<script src="./_mermaid.min.js"></script>
</head><body>
  <h1>Procurador SCW — Ciclo de vida del usuario</h1>
  <div class="sub">Recorrido completo del usuario, del registro a la operación recurrente · Generado 2026-06-02</div>

  <section>
  <h2>🎯 Camino principal (happy path)</h2>
  <pre class="mermaid">${happyPath}</pre>
  </section>

  <div class="page-break"></div>
  <section>
  <h2>⚠️ Caminos alternativos (situaciones especiales)</h2>
  <pre class="mermaid">${altPath}</pre>
  </section>

  <div class="page-break"></div>
  <section>
  <h2>📊 Resumen de estados de la cuenta</h2>
  <table>
    <tr><th>Estado</th><th>Significado</th><th>Acceso</th></tr>
    <tr><td>📧 Pendiente verificación</td><td>Registrado pero no clickeó el email</td><td>❌</td></tr>
    <tr><td>⏳ Pendiente activación / trial</td><td>Email verificado · 20 usos de prueba compartidos por app + extensión, hasta configurar el pago</td><td>✅ limitado</td></tr>
    <tr><td>✅ Activa</td><td>Suscripción al día, cobro automático funcionando</td><td>✅</td></tr>
    <tr><td>📅 Cancelación programada</td><td>Canceló, sigue con acceso hasta fin del período</td><td>✅ hasta fecha</td></tr>
    <tr><td>⏰ En período de gracia</td><td>Pago rechazado, MP reintenta 3 días</td><td>✅</td></tr>
    <tr><td>🚫 Suspendida por pago</td><td>Pago no recuperado en 3 días</td><td>❌</td></tr>
    <tr><td>⏳ Plan vencido</td><td>Plan caducó</td><td>❌</td></tr>
    <tr><td>⛔ Suspendida por admin</td><td>Decisión administrativa</td><td>❌</td></tr>
    <tr><td>🔒 Cancelada</td><td>Período de la cancelación venció</td><td>❌</td></tr>
    <tr><td>❌ Rechazada</td><td>Trial agotado o rechazo administrativo</td><td>❌</td></tr>
  </table>
  </section>

  <div class="foot">Procurador SCW / Procurador TOOL · procuradortool.com</div>
  <script>
    (async () => {
      try {
        if (typeof mermaid === 'undefined') { window.__err = 'mermaid no cargó'; return; }
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: true } });
        await mermaid.run();
        window.__done = true;
      } catch (e) { window.__err = e.message; console.log('MERMAID ERROR: ' + e.message); }
    })();
  </script>
</body></html>`;

function ensureMermaid() {
  const dest = path.join(__dirname, '_mermaid.min.js');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) return Promise.resolve();
  console.log('Descargando mermaid.min.js (una sola vez)...');
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js', res => {
      if (res.statusCode !== 200) return reject(new Error('CDN status ' + res.statusCode));
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
    }).on('error', reject);
  });
}

(async () => {
  await ensureMermaid();
  const tmpHtml = path.join(__dirname, '_diagrama_tmp.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', m => console.log('  [page]', m.text()));
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto('file:///' + tmpHtml.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__done === true || window.__err', { timeout: 60000 });
  await new Promise(r => setTimeout(r, 800));
  await page.pdf({ path: OUT, format: 'A4', landscape: true, printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await browser.close();
  fs.unlinkSync(tmpHtml);
  console.log('PDF generado: ' + OUT);
})().catch(e => { console.error(e.message); process.exit(1); });
