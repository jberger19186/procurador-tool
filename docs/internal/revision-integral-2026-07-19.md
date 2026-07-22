# Revisión integral del proyecto — 2026-07-19

> **Alcance:** revisión en vivo de bugs y brechas de seguridad **posterior** a SEC-1 (auditoría del 13/07) y a los 4 lotes de bugs (2A–2D, todos cerrados). Análisis de solo lectura — **no se implementó nada**. Cada hallazgo trae una solución autosuficiente, autocontenida, que **no altera el funcionamiento de ningún otro componente**, con fases de ejecución, modelo (Sonnet/Opus) y nivel de esfuerzo.
> **2ª pasada de verificación pre-ejecución (mismo día):** se re-verificó cada solución contra el código real antes de habilitar su ejecución. **2 correcciones a este propio documento** — RI-2 (los 2 endpoints IA tienen shapes distintos: `messages[]` en portal vs `message` string en Electron; el snippet único habría fallado en `client.js`) y RI-4 (la app actual **TODAVÍA llama** a `/api/extension` desde `main.js:508/528/575`; el plan pasó de "desmontar backend" a "primero release Electron que limpie los handlers, después desmontar" — 4 fases). **+1 hallazgo nuevo:** RI-5 (el logout del portal es solo client-side, nunca blacklistea — el endpoint existe pero `doLogout()` no lo llama). Total: **5 hallazgos, todos Baja severidad**.
> **Contexto:** el código está maduro y ya endurecido. No se encontró ningún hallazgo **crítico ni alto** — la auditoría y los lotes previos hicieron su trabajo. Los 4 hallazgos de abajo son de severidad **Baja**, de tipo corrección/robustez/UX, ninguno es un hueco de seguridad explotable.
> **✅ EJECUTADAS las 5 correcciones (2026-07-22, Sonnet).** Backup DB previo, probadas en staging antes de prod (curl real contra cada fix), health 200 en portal/dashboard/API sin errores nuevos tras cada deploy, fixture 250 verificado intacto. **3ª pasada sobre RI-4** (la 2ª pasada seguía sobre-estimando el alcance): confirmado que `install-extension`/`check-extension-version` eran código **realmente muerto** — ninguna UI real los invoca (`renderer.js:287` usa `openUrlInChrome` directo al store, no esos handlers) y 0 hits reales en 2+ semanas de logs de prod a `version`/`download`/`hashes` — solo se conserva `electron-token`/`electron-download` (flujo vivo de descarga del instalador). Esto **eliminó la necesidad de las 4 fases con ventana de espera**: se limpió todo en un solo commit + release `electron-v2.7.40`, publicado y verificado (SHA512 de `latest.yml` coincide con el `.exe`, único release sin duplicados tras corregir el mismo bug de `electron-builder` ya documentado en v2.7.38/39). Detalle de cada fix, con comandos y resultados reales, en cada sección de abajo. **Hallazgo nuevo detectado durante la ejecución (no corregido, fuera de alcance):** `npm audit` en el backend volvió a mostrar 2 vulnerabilidades (`axios` alta, `body-parser` baja) — aparecieron independientemente entre el 19 y el 22/07, sin relación con estos 5 fixes; requiere su propia revisión antes de aplicar `npm audit fix` (podría cambiar versiones sin probar).

---

## Resumen de hallazgos

| # | Severidad | Tipo | Componente | Título |
|---|---|---|---|---|
| RI-1 | Baja | Correctness/UX | backend (`admin.js` + `server.js`) | ✅ **CORREGIDO (commit `59baf20`)** — Errores de subida de PDF devolvían 500 genérico; ahora 400 con el motivo |
| RI-2 | Baja | Costo/abuso | backend (`usuarios.js`) | ✅ **CORREGIDO (commit `59baf20`)** — Cap de 4.000 chars en el portal; `client.js` ya tenía el suyo (no requería cambio) |
| RI-3 | Baja (observación) | Robustez/abuso | backend (routers autenticados) | ✅ **CORREGIDO (commit `59baf20`)** — `generalAuthLimiter` (300/5min) en `/license`, `/monitor`, `/tickets`, `/users`, `/usuarios/api` |
| RI-4 | Baja | Superficie/deuda | backend (`routes/extension.js`) + Electron (`main.js`) | ✅ **CORREGIDO (commits `88ef26b`/`acbca0a`, release `electron-v2.7.40`)** — código muerto eliminado por completo (backend + cliente), no solo desmontado |
| RI-5 | Baja | Higiene de sesión | portal (`public/usuarios/app.js`) | ✅ **CORREGIDO (commit `59baf20`)** — `doLogout()` ahora blacklistea el token server-side |

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

> **✅ Ejecutado 2026-07-22.** Wrapper `uploadPdfOr400` agregado, aplicado en las 3 rutas. Probado en staging: `.txt` renombrado a `.pdf` → `400 {"error":"Solo se aceptan archivos PDF"}`; PDF real → `200` (factura creada normal). Deployado a prod y verificado sano. Commit `59baf20`.

---

## RI-2 — El bot IA no acota la longitud del `content` por mensaje

**Severidad:** Baja · **Tipo:** costo / abuso · **Archivos:** `backend-server/routes/usuarios.js` (`POST /ai-chat`, líneas 152–188), `backend-server/routes/client.js` (endpoint espejo `/client/ai/chat`).

**Descripción.** El endpoint valida la **cantidad** de mensajes (`messages.length > 20 → 400`) y aplica rate-limit de 20/hora/usuario, pero **no valida la longitud del `content` de cada mensaje** antes de reenviarlo a la API de Anthropic (`messages.slice(-10).map(m => ({ role, content }))`). Un usuario autenticado podría mandar un único mensaje con cientos de KB de texto → un pico de tokens de entrada (costo real en la cuenta de Anthropic). El rate-limit de 20/hora acota la frecuencia, pero no el tamaño de cada llamada.

**Impacto:** puramente de costo/abuso, acotado a usuarios autenticados. No es un hueco de seguridad ni afecta datos. Con el volumen actual (beta, pocos usuarios) el riesgo real es mínimo — es un endurecimiento preventivo antes de escalar.

**Solución autosuficiente.** Agregar un tope de caracteres (ej. 4.000, coherente con una consulta de soporte legítima) en **ambos** endpoints, rechazando con 400 antes de llamar a la API. No cambia el rate-limit, ni el system prompt, ni el modelo, ni el comportamiento normal (una consulta real nunca se acerca a 4.000 chars).

> **⚠️ Corrección 2026-07-19 (2ª pasada, verificado contra el código): los dos endpoints tienen SHAPES DISTINTOS** — aplicar el mismo snippet en ambos haría fallar el fix. `usuarios.js` (portal) recibe `{ messages: [...] }` (array conversacional); `client.js:864` (Electron) recibe `{ message }` (**string único**, línea 865: `const { message } = req.body`). El cap se aplica distinto en cada uno:

```js
// usuarios.js (array):
const MAX_CONTENT = 4000;
if (messages.some(m => typeof m.content !== 'string' || m.content.length > MAX_CONTENT)) {
  return res.status(400).json({ error: 'Cada mensaje debe ser texto de hasta 4.000 caracteres.' });
}

// client.js (string único — agregar al if de la línea 866 existente):
if (message.length > 4000) {
  return res.status(400).json({ success: false, error: 'El mensaje supera los 4.000 caracteres.' });
}
```

**Cómo ejecutarla (1 fase):** editar los 2 endpoints **cada uno con su shape** → probar en staging (mensaje normal → OK; mensaje de 5.000 chars → 400 **en ambos**) → deploy. Sin release de Electron (el cliente ya maneja errores 400 del chat mostrándolos como respuesta).

**Modelo/esfuerzo:** **Sonnet, esfuerzo bajo.**

> **✅ Ejecutado 2026-07-22 — con una corrección de 3ª pasada.** Al implementar se confirmó que `client.js` (línea 869: `if (message.length > 500)`) **ya tenía** el cap desde antes — la premisa original de RI-2 (ambos endpoints sin tope) era parcialmente incorrecta. Solo se aplicó el fix a `usuarios.js` (portal). Probado en staging: mensaje de 5.000 chars → `400 {"error":"Cada mensaje debe ser texto de hasta 4.000 caracteres."}`; mensaje normal → `200` con respuesta real del bot. Deployado a prod. Commit `59baf20`.

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

> **✅ Ejecutado 2026-07-22.** Fase A (medición): pico real medido en la sesión de testing más intensa (14/07) fue **10 req/min desde una sola IP** — 300/5min deja 6× de margen. Fase B: `generalAuthLimiter` agregado a los 5 routers en `server.js`. Probado en staging: 5 requests normales → todas `200`; 305 requests seguidas → mezcla de `200`/`429` confirmando que el límite dispara pasado el umbral sin afectar el uso normal. Deployado a prod. Commit `59baf20`.

---

## RI-4 — Código muerto de la distribución CRX sigue montado

**Severidad:** Baja · **Tipo:** superficie de ataque / deuda técnica · **Archivos:** `backend-server/routes/extension.js` (montado en `server.js:138` como `/api/extension`).

**Descripción.** La distribución vía CRX/ZIP quedó deprecada cuando la extensión pasó a la Chrome Web Store (v1.3.2+), pero `routes/extension.js` sigue montado y sirviendo `/api/extension/version|hashes|download|electron-token|electron-download`. Es el **único** consumidor de `adm-zip` en el backend — la dependencia que el 2026-07-19 volvió a aparecer como vulnerabilidad `high` (ya mitigada con el bump a 0.6.0). Los endpoints están autenticados (salvo `electron-download`, que usa token de un solo uso), así que **no es un hueco explotable**, pero es superficie innecesaria y deuda que reintroduce riesgo de dependencias.

> **⚠️ Corrección 2026-07-19 (2ª pasada — la verificación de la fase A YA SE HIZO y cambió el plan):** el grep confirmó que **la app Electron ACTUAL (v2.7.39 incluida) TODAVÍA llama a `/api/extension/version` y `/api/extension/download`** — `electron-app/main.js` líneas **508, 528 y 575** (handlers `install-extension` / `check-extension-version`, invocables desde Configuración → Extensión). La versión previa de este documento asumía que "el cliente actual ya no los invoca" — **falso**. Desmontar el router hoy rompería esos botones en TODAS las apps instaladas. El plan correcto invierte el orden: primero se limpia el cliente (release Electron), recién después el backend.

**Solución autosuficiente (corregida).**

**Cómo ejecutarla (4 fases):**
1. **Fase A (cliente):** en `electron-app/main.js`, migrar/eliminar los handlers `install-extension` y `check-extension-version` (y sus botones en Configuración → Extensión del renderer) para que apunten a la Chrome Web Store (link estático, como ya hace el onboarding) en vez del flujo CRX. **Requiere un release de Electron** (vX.Y.Z, checklist del proyecto). Se puede bundlear con cualquier otro release pendiente — no amerita uno propio.
2. **Fase B (ventana de adopción):** esperar la adopción del auto-updater (días/semanas) y verificar en los logs de acceso de prod que `/api/extension/version|download` ya no reciben hits reales.
3. **Fase C (backend):** recién entonces, quitar `app.use('/api/extension', ...)` de `server.js`, borrar `routes/extension.js`, quitar `adm-zip` de `package.json` + `npm install`. Probar en staging (arranque limpio, endpoints 404, resto intacto).
4. **Fase D (deploy):** a prod, `pm2 restart`, `npm audit` → confirmar 0 vulnerabilidades con la dependencia fuera del árbol.

**⚠️ No alterar otros componentes:** la extensión de la store y su auth (`/auth/extension-login`) son **independientes** de este router — no se tocan. Mientras tanto, el bump de `adm-zip` a 0.6.0 (ya deployado el 19/07) mantiene el audit en 0 — no hay urgencia; este plan es la limpieza definitiva.

**Modelo/esfuerzo:** **Sonnet, esfuerzo medio** (subió respecto de la estimación previa: ahora incluye tocar `main.js`/renderer y un release de Electron con su checklist — ya no es solo un borrado de backend). La fase B es tiempo calendario, no esfuerzo.

> **✅ Ejecutado 2026-07-22 — 3ª pasada que simplificó drásticamente el plan.** Antes de tocar código se releyó el consumidor real: `renderer.js:287` (`bind('btnInstalarExtension', ...)`) llama a `window.electronAPI.openUrlInChrome(...)` directo a la Chrome Web Store — **nunca** a `installExtension`/`checkExtensionVersion`. Un `grep` en `renderer.js`/`onboarding.js`/`index.html`/`onboarding.html` confirmó **cero** llamadas a esos bridges en ningún archivo. Y en 2+ semanas de logs de prod (`procurador-access.log` + rotados), **cero hits** a `/api/extension/version`, `/hashes` o `/download` — los únicos 4 hits reales eran a `electron-token`/`electron-download` (el flujo de descarga del instalador, sin relación). Con esto confirmado, **no hacía falta la ventana de adopción de la Fase B**: se eliminó todo en un solo paso.
>
> **Lo que se eliminó:** backend — `routes/extension.js` reescrito a solo `electron-token`/`electron-download` (elimina `adm-zip` y `javascript-obfuscator`, únicos consumidores). Electron — `downloadExtension()`, los handlers `install-extension`/`check-extension-version` y el `require('adm-zip')` de `main.js`; bridges correspondientes de `preload.js` y `preload-onboarding.js`; `adm-zip` también fuera del `package.json` de `electron-app`. Se conservó intacto: `get-extension-enabled`/`set-extension-enabled` (el toggle real de la UI) y `EXT_META_PATH`.
>
> **Verificado:** `npm start` limpio + `npm run build:dir` (`.exe` empaquetado real, `isPackaged:true`, arranque limpio, ícono embebido) antes de bumpear versión. Backend probado en staging y prod: `version`/`download` → `404`; `electron-token`→`electron-download` → sigue `200`→`302` (flujo de descarga de la app intacto, confirmado en prod con un token real). `npm audit` del backend en 0 para estas 2 dependencias.
>
> **Release `electron-v2.7.40` publicado** (mismo bug de infraestructura ya documentado en v2.7.38/v2.7.39: `electron-builder` creó 2 releases duplicados con el mismo tag — uno solo con el `.blockmap`, otro con `.exe`+`latest.yml` sin blockmap — corregido subiendo el asset faltante al release completo vía API de GitHub y borrando el duplicado, sin rebuild). Verificado: 1 solo release con los 3 assets, SHA512 de `latest.yml` coincide byte a byte con el `.exe` local. Versión visible actualizada en portal y landing (5 lugares). Commits `88ef26b` (código) + `acbca0a` (versión visible), tag `electron-v2.7.40`.
>
> **⚠️ Regresión introducida en v2.7.40, corregida en v2.7.41 (2026-07-22 cont.).** Al re-verificar RI-4 buscando referencias huérfanas se encontró que la eliminación de `downloadExtension()` dejó una **llamada huérfana** a esa función en el handler de `login` de `main.js` — el bloque "auto-update silencioso de la extensión" que corría en **cada login exitoso**. El `try/catch` que lo rodea tragaba el `ReferenceError` (la ventana ya se crea antes del bloque, y la mayoría de usuarios no llega a esa línea sin el archivo de metadata del flujo viejo), así que **no crasheaba** — pero era código roto. Fix (commit `0c732dc`, release `electron-v2.7.41`): se eliminó el bloque completo (el auto-update del ZIP es obsoleto — la extensión se auto-actualiza en la Chrome Web Store); el toggle `get/set-extension-enabled` se conserva. Verificado: `grep` de referencias huérfanas limpio (solo comentarios), ningún renderer/onboarding llama a los bridges eliminados, `npm start` + `.exe` empaquetado con 0 `ReferenceError`. **Lección para el checklist:** al eliminar una función, hacer un `grep` de referencias huérfanas en todo el árbol — `npm start`/`build:dir` no lo caza si la ruta que la llama no corre en el boot (acá corría en login, no al arrancar). El release tuvo de nuevo el bug de infra (1 release con solo `.blockmap` + 422; corregido subiendo `.exe` + `latest.yml` **regenerado a mano** porque el local seguía stale apuntando a 2.7.40).

---

## RI-5 — El logout del portal no invalida el token server-side

**Severidad:** Baja · **Tipo:** higiene de sesión · **Archivos:** `backend-server/public/usuarios/app.js` (`doLogout()`, línea 248), `backend-server/routes/auth.js` (`POST /logout`, línea 838 — el endpoint EXISTE y funciona).

**Descripción (detectado en la 2ª pasada, 2026-07-19).** `doLogout()` del portal solo hace `clearToken()` + limpieza de estado local — **nunca llama** a `POST /auth/logout`, que existe, acepta tokens de usuario (usa `authenticateToken`) y los mete en la blacklist. Resultado: un token de portal "deslogueado" sigue siendo válido server-side hasta su vencimiento natural (8h). El impacto real es bajo (el token vive solo en el `localStorage` del navegador del usuario y no queda expuesto al desloguear), pero es inconsistente con M-1 (el logout de admin SÍ blacklistea desde 2026-06-01) y falla la expectativa razonable de "cerré sesión = el token murió". Es exactamente lo que el caso **R10.5(b)** del Bloque R va a confirmar y documentar como hallazgo.

**Solución autosuficiente.** En `doLogout()`, disparar el `POST /auth/logout` **fire-and-forget antes de limpiar el token** (con el token aún disponible), sin bloquear la UX del logout (si la red falla, el logout local procede igual — el comportamiento visible no cambia en absoluto):

```js
function doLogout() {
    const t = getToken();
    if (t) fetch(API + '/auth/logout', { method:'POST', headers:{ Authorization:'Bearer '+t } }).catch(()=>{});
    clearToken();
    // ... resto idéntico
}
```

**Cómo ejecutarla (1 fase):** editar `doLogout()` en `app.js` → probar en staging (logout → el mismo token da 403 en `/usuarios/api/*`; la UX del logout no cambia) → deploy del archivo estático (`scp` + sin `pm2 restart` para estáticos servidos por Express sí requiere restart — verificar: `public/usuarios` lo sirve Express, así que `pm2 restart`). Sin release de Electron, sin migración.

**Modelo/esfuerzo:** **Sonnet, esfuerzo bajo.** Tres líneas en un solo archivo, comportamiento visible idéntico.

> **✅ Ejecutado 2026-07-22.** `doLogout()` ahora dispara `fetch` directo (no `apiFetch`, para evitar recursión ya que `apiFetch` llama a `doLogout()` en 401/403) con el token capturado antes de limpiarlo. Probado en staging directamente contra `/auth/logout`: login→200, logout→200, mismo token reutilizado→`403 {"error":"Token invalidado"}`. La verificación visual del click real en el portal quedó pendiente (staging protegido por basic-auth sin credenciales a mano) — la lógica del lado cliente es de 3 líneas, sintaxis verificada, y el contrato del endpoint ya está probado end-to-end. Deployado a prod. Commit `59baf20`.

---

## ✅ Orden de ejecución — completado 2026-07-22

Las 5 correcciones se ejecutaron en una sola sesión (Sonnet, esfuerzo bajo-medio según el caso), en el orden originalmente sugerido: RI-1 → RI-5 → RI-2 → RI-4 → RI-3. Todas probadas en staging antes de prod, con backup de DB previo y verificación de salud (portal/dashboard/API en 200, fixture 250 intacto) después de cada deploy. Detalle real de cada una en su sección arriba.

**Commits:** `59baf20` (RI-1, RI-2, RI-3, RI-5) · `88ef26b` + `acbca0a` (RI-4, release `electron-v2.7.40`).

**Regla transversal aplicada:** cada fix se probó en **staging** con una corrida real antes de prod, y se verificó que el resto del sistema (login, cobro, automatización PJN, extensión) siguió intacto — coherente con la disciplina del proyecto.

### Hallazgo nuevo detectado durante la ejecución (no corregido)

`npm audit` en el backend, tras limpiar `adm-zip`/`javascript-obfuscator` (RI-4), mostró **2 vulnerabilidades nuevas e independientes**: `axios` (alta — varias CVEs de DoS/prototype pollution/proxy bypass) y `body-parser` (baja — DoS con `limit` inválido). Aparecieron entre el 19 y el 22/07 (no estaban en el audit de la revisión original). **Fuera de alcance de esta revisión** — requiere su propio análisis antes de aplicar `npm audit fix` (podría bajar versiones de `axios`, usado en varios puntos del backend, sin haber probado el impacto). Candidato a una próxima revisión de salud.

---

## Nota de método

Esta revisión fue de solo lectura y se apoya en que el proyecto ya pasó SEC-1 y los 4 lotes de bugs. No sustituye la auditoría externa profesional (SEC-1 la sigue recomendando antes del público). La ausencia de hallazgos altos/críticos es una señal positiva del estado del código, no de una revisión superficial: se verificaron activamente inyección SQL, CORS, rate-limiting, manejo de errores, el candado de concurrencia, AUTH-1 y la firma de webhooks.
