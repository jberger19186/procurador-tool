/**
 * smoke-sesion.js — Verificación rápida de los cambios de la sesión 2026-06-01.
 * Comprueba que cada fix funciona Y que no se rompió el funcionamiento existente.
 * Uso: node dev-tools/smoke-sesion.js   (desde /var/www/procurador/backend-server)
 */
require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const MP_SECRET  = process.env.MP_WEBHOOK_SECRET;
let pass = 0, fail = 0;
const ok  = (n) => { console.log('  ✅', n); pass++; };
const bad = (n) => { console.log('  ❌', n); fail++; };

function req(port, opts, body) {
  return new Promise((res) => {
    const r = https.request({ hostname: 'localhost', port, rejectUnauthorized: false, ...opts },
      (x) => { let d=''; x.on('data',c=>d+=c); x.on('end',()=>res({ status:x.statusCode, headers:x.headers, body:d })); });
    r.on('error', () => res({ status: 0 }));
    if (body) r.write(body); r.end();
  });
}
const PROD = 3443, STG = 3444;

(async () => {
  console.log('\n── SALUD DE LOS ENTORNOS ──');
  let r = await req(PROD, { method:'GET', path:'/health' });
  r.status === 200 ? ok('Producción responde (health 200)') : bad('Producción health = ' + r.status);
  r = await req(STG, { method:'GET', path:'/health' });
  r.status === 200 ? ok('Staging responde (health 200)') : bad('Staging health = ' + r.status);

  console.log('\n── B-5: CSP ──');
  r = await req(PROD, { method:'GET', path:'/dashboard/' });
  (r.headers['content-security-policy'] || '').includes("object-src 'none'") ? ok('CSP presente en prod (object-src none)') : bad('CSP ausente/incompleta en prod');
  (r.headers['content-security-policy'] || '').includes("script-src-attr 'unsafe-inline'") ? ok('CSP permite onclick (script-src-attr unsafe-inline)') : bad('CSP bloquearía onclick');

  console.log('\n── M-2: firma de webhook timing-safe ──');
  const dataId='123', ts=Date.now().toString(), reqId='smoke-1';
  const payload=JSON.stringify({type:'payment',data:{id:dataId}});
  const v1=crypto.createHmac('sha256',MP_SECRET).update(`id:${dataId};request-id:${reqId};ts:${ts};`).digest('hex');
  r = await req(PROD,{method:'POST',path:'/webhooks/mercadopago',headers:{'Content-Type':'application/json','x-request-id':reqId,'x-signature':`ts=${ts},v1=${v1}`,'Content-Length':Buffer.byteLength(payload)}},payload);
  r.status === 200 ? ok('Webhook firma VÁLIDA → 200') : bad('Webhook firma válida → ' + r.status);
  r = await req(PROD,{method:'POST',path:'/webhooks/mercadopago',headers:{'Content-Type':'application/json','x-request-id':reqId,'x-signature':`ts=${ts},v1=ff`,'Content-Length':Buffer.byteLength(payload)}},payload);
  r.status === 401 ? ok('Webhook firma INVÁLIDA → 401') : bad('Webhook firma inválida → ' + r.status);

  console.log('\n── M-1: logout de admin invalida el token ──');
  const adminTok = jwt.sign({ id:6, email:'admin@procurador.com', role:'admin' }, JWT_SECRET, { expiresIn:'5m' });
  const auth = { Authorization:'Bearer ' + adminTok };
  r = await req(PROD,{method:'GET',path:'/admin/cache/stats',headers:auth});
  const adminWorks = r.status === 200;
  adminWorks ? ok('Admin con token válido → 200 (funciona)') : bad('Admin válido → ' + r.status);
  await req(PROD,{method:'POST',path:'/auth/logout',headers:{...auth,'Content-Type':'application/json'}});
  r = await req(PROD,{method:'GET',path:'/admin/cache/stats',headers:auth});
  r.status === 403 ? ok('Admin tras logout → 403 (token revocado)') : bad('Admin tras logout → ' + r.status + ' (esperado 403)');

  console.log('\n── B-2: política de contraseñas (sin romper login) ──');
  // change-password valida la política ANTES de la contraseña actual.
  // jti único para no colisionar con el token deslogueado en M-1 (mismo payload/segundo).
  const tok2 = jwt.sign({ id:6, email:'admin@procurador.com', role:'admin', jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn:'5m' });
  const a2 = { Authorization:'Bearer ' + tok2, 'Content-Type':'application/json' };
  r = await req(PROD,{method:'POST',path:'/auth/change-password',headers:a2}, JSON.stringify({currentPassword:'x',newPassword:'debil'}));
  (r.status===400 && /8 caracteres/.test(r.body)) ? ok('Contraseña débil rechazada con mensaje específico') : bad('Débil → ' + r.status + ' ' + r.body.slice(0,40));
  r = await req(PROD,{method:'POST',path:'/auth/change-password',headers:a2}, JSON.stringify({currentPassword:'x',newPassword:'sololetras'}));
  (r.status===400 && /letra y un n/.test(r.body)) ? ok('Contraseña sin número rechazada con mensaje específico') : bad('Sin número → ' + r.status);
  r = await req(PROD,{method:'POST',path:'/auth/change-password',headers:a2}, JSON.stringify({currentPassword:'incorrecta',newPassword:'ClaveValida2024'}));
  (r.status===401) ? ok('Contraseña fuerte PASA la política (falla recién en "actual incorrecta")') : bad('Fuerte → ' + r.status + ' (esperado 401)');

  console.log('\n── FUNCIONAMIENTO NO ALTERADO ──');
  // Login rechaza credenciales inválidas con 401 (no 500) → endpoint sano
  r = await req(PROD,{method:'POST',path:'/auth/login',headers:{'Content-Type':'application/json'}}, JSON.stringify({email:'noexiste@test.com',password:'x',machineId:'smoke'}));
  [400,401].includes(r.status) ? ok('Login rechaza credenciales inválidas (' + r.status + ', no 500)') : bad('Login → ' + r.status);
  // Endpoints publicos/protegidos responden coherente (no 500)
  r = await req(PROD,{method:'GET',path:'/auth/plan-availability'});
  r.status === 200 ? ok('Endpoint público /auth/plan-availability → 200') : bad('plan-availability → ' + r.status);
  r = await req(PROD,{method:'GET',path:'/client/account'});
  [401,403].includes(r.status) ? ok('Endpoint protegido sin token → ' + r.status + ' (auth funciona)') : bad('/client/account sin token → ' + r.status);
  r = await req(PROD,{method:'GET',path:'/usuarios/api/checkout/status',headers:auth});
  [200,401,403].includes(r.status) ? ok('Endpoint de cobranza responde (' + r.status + ')') : bad('checkout/status → ' + r.status);

  console.log('\n── AISLAMIENTO STAGING ──');
  r = await req(STG, { method:'GET', path:'/dashboard/' });
  (r.headers['content-security-policy']||'').length > 0 ? ok('Staging también tiene CSP') : bad('Staging sin CSP');

  console.log(`\n═══ RESULTADO: ${pass} ✅  ${fail} ❌ ═══\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
