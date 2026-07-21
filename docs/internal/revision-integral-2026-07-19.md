# Revisión integral del proyecto — 2026-07-19

> **Alcance:** revisión en vivo de bugs y brechas de seguridad **posterior** a SEC-1 (auditoría del 13/07) y a los 4 lotes de bugs (2A–2D, todos cerrados). Análisis de solo lectura — **no se implementó nada**. Cada hallazgo trae una solución autosuficiente, autocontenida, que **no altera el funcionamiento de ningún otro componente**, con fases de ejecución, modelo (Sonnet/Opus) y nivel de esfuerzo.
> **Contexto:** el código está maduro y ya endurecido. No se encontró ningún hallazgo **crítico ni alto** — la auditoría y los lotes previos hicieron su trabajo. Los 4 hallazgos de abajo son de severidad **Baja**, de tipo corrección/robustez/UX, ninguno es un hueco de seguridad explotable.

---

## Resumen de hallazgos

| # | Severidad | Tipo | Componente | Título |
|---|---|---|---|---|
| RI-1 | Baja | Correctness/UX | backend (`admin.js` + `server.js`) | Errores de subida de PDF (multer) devuelven HTTP 500 genérico en vez de 400 con el motivo |
| RI-2 | Baja | Costo/abuso | backend (`usuarios.js`, `client.js`) | El bot IA no acota la longitud del `content` de cada mensaje (solo la cantidad) |
| RI-3 | Baja (observación) | Robustez/abuso | backend (routers autenticados) | Sin rate-limit de red en `/license`, `/monitor`, `/tickets`, `/users`, `/usuarios/api` (solo limiters por-ruta puntuales) |
| RI-4 | Baja | Superficie/deuda | backend (`routes/extension.js`) | Código muerto de la distribución CRX sigue montado — es lo que arrastraba la dependencia vulnerable `adm-zip` |

> **Lo verificado que está SANO (no genera hallazgo):** sin inyección SQL (la única interpolación, `${col}` en `admin.js:1989`, viene de un whitelist `colMap`); candado de ejecución atómico con TTL de 5 min y auto-limpieza (`license.js`); AUTH-1 device-binding server-side; CORS restringido por lista (rechaza sin lanzar 500); firma HMAC de webhooks con `timingSafeEqual`; `/api/extension/electron-download` protegido por token de un solo uso con expiración; `ufw` con solo 22/80/443.

---

## RI-1 — Errores de subida de PDF devuelven 500 en vez de 400

**Severidad:** Baja · **Tipo:** correctness / UX · **Archivos:** `backend-server/routes/admin.js` (multer `uploadInvoice`, líneas 40–47 y rutas 3275/3303/3338), `backend-server/server.js` (error handler global, línea 406).

**Descripción.** El middleware `uploadInvoice` valida bien: rechaza no-PDF (`fileFilter` → `cb(new Error('Solo se aceptan archivos PDF'))`) y limita a 5 MB (`limits.fileSize`). **El rechazo funciona — no hay hueco de seguridad.** Pero cuando multer llama `cb(new Error(...))` o se supera el límite, el error no se maneja en la ruta y cae al **error handler global** (`server.js:406`), que responde **500 "Error interno del servidor"** con `message` solo visible en `NODE_ENV=development`. En producción el admin ve un 500 opaco (parece que "se rompió el server") en vez de un 400 claro ("Solo se aceptan archivos PDF" / "El archivo supera los 5 MB").

**Impacto de cara al Bloque R:** los casos **R10.1** (upload no-PDF) y **R10.2** (PDF gigante) esperan "rechazado con error claro (no 502/timeout)". Con el código actual el rechazo ocurre pero como 500 — la prueba pasaría en seguridad (se rechaza) pero anotaría la observación del código de estado engañoso.

**Solución autosuficiente (no altera otros componentes).** Envolver el middleware `uploadInvoice.single('pdf')` de las 3 rutas de facturación en un wrapper que capture el error de multer y lo traduzca a 400. No toca el error handler global, ni las otras rutas, ni el flujo de facturación exitoso.

```js
// Helper local en admin.js (patrón autocontenido, solo afecta las 3 rutas de invoice):
function uploadPdfOr400(req, res, next) {
  uploadInvoice.single('pdf')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo supera el máximo de 5 MB.'
        : (err.message || 'Archivo inválido.');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}
// Y reemplazar `uploadInvoice.single('pdf')` por `uploadPdfOr400` en las 3 rutas.
```

**Cómo ejecutarla (1 fase):** editar `admin.js` (helper + 3 reemplazos) → probar en staging (subir un `.txt` renombrado → 400 con mensaje; subir >5 MB → 400; subir un PDF válido → sigue 200) → deploy a prod (`scp` + `pm2 restart`). Sin release de Electron, sin migración.

**Modelo/esfuerzo:** **Sonnet, esfuerzo bajo.** Cambio mecánico y acotado, patrón conocido.

---

## RI-2 — El bot IA no acota la longitud del `content` por mensaje

**Severidad:** Baja · **Tipo:** costo / abuso · **Archivos:** `backend-server/routes/usuarios.js` (`POST /ai-chat`, líneas 152–188), `backend-server/routes/client.js` (endpoint espejo `/client/ai/chat`).

**Descripción.** El endpoint valida la **cantidad** de mensajes (`messages.length > 20 → 400`) y aplica rate-limit de 20/hora/usuario, pero **no valida la longitud del `content` de cada mensaje** antes de reenviarlo a la API de Anthropic (`messages.slice(-10).map(m => ({ role, content }))`). Un usuario autenticado podría mandar un único mensaje con cientos de KB de texto → un pico de tokens de entrada (costo real en la cuenta de Anthropic). El rate-limit de 20/hora acota la frecuencia, pero no el tamaño de cada llamada.

**Impacto:** puramente de costo/abuso, acotado a usuarios autenticados. No es un hueco de seguridad ni afecta datos. Con el volumen actual (beta, pocos usuarios) el riesgo real es mínimo — es un endurecimiento preventivo antes de escalar.

**Solución autosuficiente.** Agregar un tope de caracteres por `content` (ej. 4.000 caracteres, coherente con una consulta de soporte legítima) en **ambos** endpoints, rechazando con 400 antes de llamar a la API. No cambia el rate-limit, ni el system prompt, ni el modelo, ni el comportamiento normal (una consulta real nunca se acerca a 4.000 chars).

```js
const MAX_CONTENT = 4000;
if (messages.some(m => typeof m.content !== 'string' || m.content.length > MAX_CONTENT)) {
  return res.status(400).json({ error: 'Cada mensaje debe ser texto de hasta 4.000 caracteres.' });
}
```

**Cómo ejecutarla (1 fase):** editar los 2 endpoints (`usuarios.js` y `client.js`) → probar en staging (mensaje normal → OK; mensaje de 5.000 chars → 400) → deploy. Sin release de Electron.

**Modelo/esfuerzo:** **Sonnet, esfuerzo bajo.**

---

## RI-3 — Sin rate-limit de red en varios routers autenticados (observación)

**Severidad:** Baja (observación) · **Tipo:** robustez / abuso · **Archivos:** `backend-server/server.js` (montaje de routers, líneas 137–151), `backend-server/middleware/rateLimiter.js`.

**Descripción.** El limiter global `apiLimiter` (server.js:93) solo cubre el prefijo `/api` (que sirve solo `/api/extension`). Los demás routers dependen de limiters **por-ruta puntuales**: `/auth` tiene `loginLimiter`/`registerLimiter`, `/admin` tiene `adminLimiter` (router-wide), `/client` tiene los de scripts. Pero **`/license`, `/monitor`, `/tickets`, `/users` y `/usuarios/api` no tienen ningún rate-limit de red** (0 coincidencias de limiter en esos archivos; el bot IA tiene su propio limit en memoria, que sí cuenta). Todos esos endpoints exigen JWT, así que el abuso está acotado a usuarios autenticados — no es un vector de brute-force anónimo. Es una **observación de defensa en profundidad**, no un hueco.

**Solución autosuficiente.** Aplicar un limiter "general autenticado" holgado (ej. 300 req / 5 min por IP, suficiente para el uso legítimo más intenso) montado sobre esos routers, **sin tocar los limiters específicos ya existentes** (que son más estrictos y siguen rigiendo sus rutas). Reusa el patrón de `rateLimiter.js`.

```js
// En rateLimiter.js: nuevo limiter holgado
const generalAuthLimiter = rateLimit({ windowMs: 5*60*1000, max: 300, standardHeaders: true, legacyHeaders: false });
// En server.js, ANTES de montar cada router sin limiter:
app.use('/license', generalAuthLimiter, require('./routes/license'));
app.use('/monitor', generalAuthLimiter, require('./routes/monitor'));
// ...ídem tickets, users, usuarios/api
```

**⚠️ Cuidado de no alterar otros componentes:** el límite debe ser **holgado** para no cortar la operación real (la app hace polling de sesión, el monitor consulta partes en lote, etc.). Validar con una corrida real de la app antes de deploy. El `trust proxy` ya está seteado (server.js:90), así que la IP se resuelve bien tras Nginx.

**Cómo ejecutarla (2 fases):**
1. **Fase A (medición):** revisar los logs/uso real para fijar un `max` que no moleste al usuario más intenso (la app Electron + monitor pueden generar ráfagas legítimas). Definir el número con datos, no a ojo.
2. **Fase B (aplicación):** agregar el limiter, probar en staging con una corrida real de la app (procuración + monitor + portal), confirmar que no aparecen 429 espurios, deploy.

**Modelo/esfuerzo:** **Sonnet, esfuerzo medio.** El código es trivial; lo delicado es calibrar el umbral sin romper el uso legítimo — por eso la fase de medición.

---

## RI-4 — Código muerto de la distribución CRX sigue montado

**Severidad:** Baja · **Tipo:** superficie de ataque / deuda técnica · **Archivos:** `backend-server/routes/extension.js` (montado en `server.js:138` como `/api/extension`).

**Descripción.** La distribución vía CRX/ZIP quedó deprecada cuando la extensión pasó a la Chrome Web Store (v1.3.2+), pero `routes/extension.js` sigue montado y sirviendo `/api/extension/version|hashes|download|electron-token|electron-download`. Es el **único** consumidor de `adm-zip` en el backend — la dependencia que el 2026-07-19 volvió a aparecer como vulnerabilidad `high` (ya mitigada con el bump a 0.6.0). Los endpoints están autenticados (salvo `electron-download`, que usa token de un solo uso), así que **no es un hueco explotable**, pero es superficie innecesaria y deuda que reintroduce riesgo de dependencias.

**Solución autosuficiente.** Desmontar el router (comentar/quitar la línea `app.use('/api/extension', ...)` en `server.js`) y eliminar `routes/extension.js` + la dependencia `adm-zip` de `package.json`. **Antes de tocar nada**, verificar que ningún cliente vivo lo consume: el `main.js` de la app Electron histórica llamaba a `/api/extension/version` y `/api/extension/download` en el onboarding — hay que confirmar que la versión instalada actual (v2.7.39) **ya no** los invoca (el onboarding hoy apunta a la Chrome Web Store). Si algún build viejo instalado todavía los llama, desmontar rompería su onboarding.

**Cómo ejecutarla (3 fases):**
1. **Fase A (verificación de consumo):** `grep` en `electron-app/` de `api/extension` para confirmar que el cliente actual no lo usa + revisar logs de acceso de prod por hits recientes a esas rutas (si hay tráfico real, hay usuarios en builds viejos → no desmontar aún).
2. **Fase B (desmontaje):** quitar el `app.use` de `server.js`, borrar `routes/extension.js`, quitar `adm-zip` de `package.json` + `npm install`. Probar en staging (arranque limpio, endpoints devuelven 404, resto intacto).
3. **Fase C (deploy):** a prod, `pm2 restart`, `npm audit` → confirmar 0 vulnerabilidades **sin** el bump defensivo (la dep desaparece del árbol).

**⚠️ No alterar otros componentes:** la extensión de la store y su auth (`/auth/extension-login`) son **independientes** de este router — no se tocan. Verificar que el desmontaje no afecte ninguna ruta compartida.

**Modelo/esfuerzo:** **Sonnet, esfuerzo bajo-medio.** El borrado es simple; la fase A (confirmar que ningún build vivo lo consume) es la que exige cuidado — es una decisión de compatibilidad, no de código.

---

## Orden de ejecución sugerido (si se decide accionar)

Todos son de severidad baja y **opcionales**; ninguno bloquea B3 ni el Bloque R. Si se accionan, el orden por costo/beneficio:

1. **RI-1** (Sonnet bajo) — mejora visible para el admin, 1 fase, cierra la observación de R10.1/R10.2.
2. **RI-2** (Sonnet bajo) — endurecimiento preventivo de costo, 1 fase.
3. **RI-4** (Sonnet bajo-medio) — elimina deuda + la dependencia vulnerable de raíz; requiere la verificación de compatibilidad de la fase A.
4. **RI-3** (Sonnet medio) — el de mayor cuidado (calibrar umbral sin romper uso real); dejar para cuando haya datos de uso.

**Regla transversal:** cada fix se prueba en **staging** con una corrida real antes de prod, y se verifica que el resto del sistema (login, cobro, automatización PJN, extensión) sigue intacto — coherente con la disciplina del proyecto (backup previo + tag de recupero).

---

## Nota de método

Esta revisión fue de solo lectura y se apoya en que el proyecto ya pasó SEC-1 y los 4 lotes de bugs. No sustituye la auditoría externa profesional (SEC-1 la sigue recomendando antes del público). La ausencia de hallazgos altos/críticos es una señal positiva del estado del código, no de una revisión superficial: se verificaron activamente inyección SQL, CORS, rate-limiting, manejo de errores, el candado de concurrencia, AUTH-1 y la firma de webhooks.
