# Revisión de bugs — 2026-07-25 (tercera pasada)

> Tercera revisión, otra vez **sobre terreno nuevo**. Las dos anteriores
> (`revision-bugs-2026-07-24.md` → B1-B10, `revision-bugs-2026-07-25.md` → C1-C5, todos
> cerrados) cubrieron cobranza, cuotas, licencia, monitor, `client.js`, `auth.js`,
> `admin.js`, `tickets.js`, estáticos y los handlers de lote de Electron.
>
> Esta pasada cubre lo que quedaba sin mirar: **la extensión Chrome** (nunca revisada en
> ninguna pasada, y es un componente que se distribuye por la Chrome Web Store),
> **`utils/mailer.js`**, los routers **`legal.js` / `analytics.js` / `scripts.js` /
> `extension.js`**, y una **verificación de regresiones sobre mis propios cambios de hoy**
> (10+ archivos tocados entre las dos revisiones anteriores y el release v2.7.43).
>
> **No se modificó código en esta pasada.**

## ✅ Estado: LOS 6 HALLAZGOS CORREGIDOS (D1-D6)

**D1, D2, D3, D4, D6 corregidos, verificados y en producción.** **D5 corregido en código**
(commit `d208fe0`) — el ZIP (`pjn-extension-1.3.6.zip`) fue subido por el operador al
dashboard de Chrome Web Store el 2026-07-25 y está **⏳ en revisión de Google**; el store
todavía sirve 1.3.5 hasta que se apruebe.

**Decisiones del operador (2026-07-25):** la cortesía SÍ debe incluir la extensión (D1) ·
la telemetría de la landing SÍ importa, se activa correctamente en vez de borrarse (D4).

| # | Verificación |
|---|---|
| **D1** | `UPDATE plans SET extension_flows=... WHERE name='CORTESIA'` en prod (backup previo), verificado por SQL que copia exacto el valor de `COMBO_PROMO`. |
| **D2** | Payload malicioso real (`<img onerror>`, `<script>`, links falsos) contra las 3 plantillas más expuestas, interceptando `nodemailer.createTransport` (sin enviar emails reales): ninguna versión cruda llegó al HTML generado. De paso se encontró y corrigió un caso más grave que el reportado originalmente: `ticketTitle` en `sendTicketReplyEmail` nunca estuvo escapado (el `commentPreview` sí, con un escape ad-hoc). |
| **D3** | Ciclo real en staging: token admin válido → `GET /legal/admin/documents` 200 → logout real vía `/auth/logout` → mismo token → **403 "Token invalidado"** (antes habría seguido dando 200). |
| **D4** | End-to-end en staging: `POST /analytics/event` público inserta en DB → `GET /analytics/data` (admin) lo refleja en el funnel real → preflight CORS real desde `Origin: https://procuradortool.com` devuelve `Access-Control-Allow-Origin` correcto. En producción: smoke test del endpoint público (200, limpiado después). |
| **D5** | Código corregido y sintaxis verificada. `getMinPlanForFlow`/`requiredPlan` eliminados (0 consumidores confirmados por grep — apuntaban a planes `inactive=true`). `flow_not_in_plan` ahora abre el popup igual que `no_session`/`token_expired`. ZIP subido al dashboard de Chrome Web Store — **verificación en vivo pendiente de que Google apruebe la revisión** (el store aún sirve 1.3.5). |
| **D6** | Verificado con un PDF de prueba real en `storage/invoices/`: `git status --untracked-files=all` no lo lista. |

**Hallazgo incidental (no corregido, fuera del alcance acordado):** `checkExtensionVersion()`
en `background.js` sigue llamando a `GET /api/extension/version`, que **ya no existe**
(eliminado en RI-4, 2026-07-22) — falla en silencio (`if (!res.ok) return`), sin romper nada,
pero es otro resto de código muerto de la migración a la Chrome Web Store. Candidato a
limpieza cuando se toque la extensión de nuevo (para D5 o cualquier otro motivo).

**Regresión propia detectada y corregida en el camino:** al extraer `authenticateAdmin` de
`admin.js` a un middleware compartido, quedó el `require('jsonwebtoken')` huérfano (ya no se
usaba en ese archivo) — se eliminó el import antes de commitear, confirmado con
`grep "jwt\."` sin resultados.

---

## Resumen

| # | Severidad | Título | Área | Verificado |
|---|---|---|---|---|
| **D1** | 🟡 Medio | El plan de cortesía deja la extensión **completamente bloqueada** | Config de producto | ✅ SQL en prod |
| **D2** | 🟡 Medio | `mailer.js` no escapa datos de usuario → inyección HTML en la casilla del admin | Emails / seguridad | ✅ Código + registro abierto |
| **D3** | 🟡 Medio | M-1 (blacklist de logout) no se aplicó en `legal.js` → token deslogueado sigue editando T&C | Seguridad | ✅ Código |
| **D4** | 🔵 Bajo | `analytics.js` es código 100% muerto (nunca montado, sin consumidores) | Limpieza | ✅ Código + prod |
| **D5** | 🔵 Bajo | Extensión: mensaje de upsell apunta a planes que no se pueden comprar, y nunca se muestra | Extensión / UX | ✅ Código + SQL |
| **D6** | 🔵 Bajo | `backend-server/storage/` (PDF de facturas) no está en `.gitignore` | Higiene / PII | ✅ Código |

**Regresiones sobre mis cambios de hoy: ninguna encontrada.** Revisé el diff completo
(`db5d7c4..HEAD`). Dos observaciones menores, sin impacto: (a) el `return` temprano de
`checkSubsystemLimit` cuando falla `getAccount()` omite `allowed` — inofensivo porque en
ese caso tampoco viene `partial`, que es lo que dispara el recorte; (b) `run-process-custom`
hace **dos** llamadas a `getAccount()` (una dentro de `checkSubsystemLimit('batch')` y otra
para leer `expedientesPerRun`) — un round-trip de red redundante antes de cada lote, se
podría unificar. Ninguna de las dos amerita un fix por sí sola.

**Controles verificados sin hallazgos:** el manifest de la extensión no pide permisos de
más (sin `tabs`, sin `content_scripts` globales, CSP propia declarada) · el menú contextual
no puede disparar un flujo salteando el control de plan (solo abre el popup) · el popup
deshabilita y marca con candado los flujos no habilitados · `POST /analytics/event` (aunque
muerto) parametriza el SQL, capa longitudes y hashea la IP · `scripts.js` y `extension.js`
tienen auth en todas sus rutas.

---

## D1 🟡 MEDIO — El plan de cortesía deja la extensión completamente bloqueada

**Dónde:** configuración de la fila `CORTESIA` en la tabla `plans` (producción).

```
name            | CORTESIA
display_name    | Plan de Cortesía
plan_type       | combo          ← "combo" = app Electron + extensión Chrome
active          | t
visibility      | private
price_ars       | 0.00
extension_flows | []             ← NINGÚN flujo de la extensión
proc_executions_limit | 50       ← límites de app idénticos a COMBO_PROMO
informe_limit         | 50
```

**Falla concreta**
El plan está declarado `plan_type = 'combo'` y tiene los mismos límites de app que
`COMBO_PROMO` (50 procuraciones / 50 informes), pero con `extension_flows` **vacío**. Para
un usuario de cortesía:

1. `GET /client/extension-auth` devuelve `enabledFlows: []`.
2. `renderFlows([])` en el popup deshabilita **los 5 botones** y les pone el candado.
3. `canUseFlow(...)` deniega cualquier flujo con `reason: 'flow_not_in_plan'`.

Resultado: la extensión queda **inutilizable por completo** para el usuario de cortesía,
mientras la app Electron le funciona con límites de plan pago.

**Por qué importa:** el plan de cortesía es justamente el que se le asigna a prospectos,
cuentas de demostración y usuarios VIP (CLAUDE.md lo describe como "listo para uso real" y
ya se usó con el usuario 237). Es la peor cuenta posible para tener media suite muerta. Los
dos planes comerciales reales (`EXTENSION_PROMO`, `COMBO_PROMO`) sí traen los 5 flujos, así
que el problema es exclusivo de cortesía.

**Solución propuesta**
Decisión de producto, no de código — hay que confirmar la intención:
- **Si la cortesía debe incluir la extensión** (lo que sugiere `plan_type='combo'`):
  `UPDATE plans SET extension_flows = '["consulta","escritos1","escritos2","notificaciones","deox"]'::jsonb WHERE name = 'CORTESIA';`
  (copiar exactamente el valor de `COMBO_PROMO`, con `notificaciones` — no `notif`, ver D5).
- **Si NO debe incluirla:** cambiar `plan_type` a `'electron'` para que sea coherente, y así
  la app muestra el mensaje correcto ("tu plan no incluye la extensión") en vez de dejar
  botones con candado sin explicación.
- Chequeo de consistencia recomendado para el futuro: ningún plan `plan_type='combo'`
  debería tener `extension_flows = '[]'`.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (1 UPDATE), pero **requiere decisión previa del operador** sobre qué debe incluir la cortesía |

---

## D2 🟡 MEDIO — `mailer.js` no escapa datos de usuario → inyección HTML en la casilla del admin

**Dónde:** `backend-server/utils/mailer.js` — **cero** helpers de escapado en todo el
archivo (`grep escapeHtml|escHtml|sanitiz` → sin resultados). Ejemplo en
`sendAdminNewUserAlert` (líneas 230-239):

```js
`Nuevo registro pendiente — ${userData.nombre} ${userData.apellido}`
...
<td ...><strong>${userData.nombre} ${userData.apellido}</strong></td>
<td ...>${userData.email}</td>
<td ...>${userData.cuit}</td>
```

**Falla concreta**
Esos valores vienen **directo del formulario de registro público** (`POST /auth/register`).
Verificado en producción: **`allow_public_register = true`** — el registro está abierto
ahora mismo, así que cualquier persona en internet puede disparar este email.

Un registrante que ponga en el campo *nombre* algo como
`<a href="http://sitio-falso">Activar cuenta</a>` consigue que ese HTML se **renderice en el
email que le llega al administrador** — el mismo email cuyo propósito es que el admin haga
clic en "Activar en el dashboard". Los clientes de correo bloquean `<script>`, pero enlaces,
botones falsos y ruptura de layout renderizan sin problema: es un vector de phishing hacia
un canal interno y de confianza.

Es exactamente la misma clase de bug que **XSS-1** (campos de usuario sin escapar en el
dashboard, corregido el 2026-07-13 con `escHtml`/`escAttr`) — pero por el canal de email,
que aquella corrección no cubrió.

**Solución propuesta**
- Agregar un `escapeHtml()` local en `mailer.js` (mismo patrón que `dashboard.js`) y
  aplicarlo a **todo** valor de origen humano que entre a un template HTML: `nombre`,
  `apellido`, `email`, `cuit`, `plan_name`, títulos/mensajes de tickets, motivos de
  suspensión/rechazo, etc.
- Revisar todo el archivo, no solo `sendAdminNewUserAlert`: hay varias funciones que
  interpolan datos de usuario (emails de tickets, suspensión, rechazo, credenciales).
- Prueba: registrar un usuario con `nombre = <b>x</b><a href="#">y</a>` y confirmar que el
  email al admin muestra el texto literal, no el HTML renderizado.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **medio** (el fix por función es trivial, pero hay que barrer las ~15 plantillas del archivo sin romper el HTML de marca ya existente; conviene verificar con un envío real por template tocado) |

---

## D3 🟡 MEDIO — M-1 (blacklist de logout) no se aplicó en `legal.js`

**Dónde**
- `backend-server/middleware/tokenBlacklist.js` — `isBlacklisted()` se consulta en
  **exactamente 2 lugares**: `routes/admin.js:79` (el fix M-1) y
  `middleware/authenticateToken.js:13`.
- `backend-server/routes/legal.js:10-30` — define **sus propias copias** de
  `authenticateAdmin` y `authenticateUser` que hacen `jwt.verify` **sin consultar la
  blacklist**. Y el router **está montado** (`server.js:176`).

**Falla concreta**
El fix M-1 (2026-06-01) existe para que el logout de un admin invalide su token de
inmediato, en vez de esperar el vencimiento natural (8 h). Como `legal.js` duplicó el
middleware en vez de reutilizarlo, **un token ya deslogueado sigue siendo válido** en todas
sus rutas:

- `GET /legal/pending`, `POST /legal/accept` (usuario)
- `GET|POST|PUT|DELETE /legal/admin/documents*` y `/publish` (admin) — es decir, **crear,
  editar, borrar y publicar los Términos y Condiciones y la Política de Privacidad** de la
  plataforma, que son documentos con efecto legal.

Mismo patrón que C3 de la revisión anterior (el fix de bcrypt aplicado a 3 de 4 call sites):
una corrección que no alcanzó a una copia duplicada.

**Solución propuesta**
- Reemplazar los middlewares locales de `legal.js` por los compartidos: usar
  `middleware/authenticateToken.js` para el de usuario y, para el de admin, extraer el
  `authenticateAdmin` de `admin.js` a `middleware/` y reutilizarlo en ambos (elimina el
  duplicado en vez de parchearlo dos veces).
- Aprovechar y hacer lo mismo con `analytics.js` (ver D4) si se decide conservarlo.
- Prueba: login admin → editar un documento legal (200) → logout → reintentar con el mismo
  token → debe dar 403.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo-medio** (unificar el middleware es más limpio que parchear, pero toca 2-3 archivos y conviene verificar que no se rompa ninguna ruta legal) |

---

## D4 🔵 BAJO — `analytics.js` es código 100% muerto

**Dónde:** `backend-server/routes/analytics.js` (154 líneas) — **nunca se monta** en
`server.js` (no existe ningún `app.use(...analytics...)`; verificado sobre la lista completa
de montajes).

**Falla concreta**
Sus 3 endpoints (`POST /event`, `GET /data`, `DELETE /events`) son **inalcanzables**.
Además:
- Ningún frontend los llama (`grep analytics` en `dashboard.js` y en la landing → 0 hits).
- La sección **📈 Métricas** del dashboard usa `/admin/stats/overview` (endpoint real de
  `admin.js`), no este router — o sea que la funcionalidad visible no depende de él.
- La tabla `analytics_events` **sí existe** en producción y la referencian los scripts de
  reset (`reset-test-data.sql`, `test-user.js`, etc.), pero **nadie escribe ni lee** de ella.

No causa daño; es superficie muerta que aparenta ser una feature viva (y su
`authenticateAdmin` duplicado tampoco chequea la blacklist, igual que D3 — aunque es
irrelevante mientras el router no esté montado).

**Solución propuesta**
Mismo criterio que se usó con la limpieza del CRX (RI-4, que se resolvió eliminando en vez
de mantener): decidir explícitamente.
- **Si la telemetría de la landing no se va a usar:** borrar `routes/analytics.js`, dropear
  `analytics_events` y limpiar las referencias en los scripts de `dev-tools/`.
- **Si se quiere activar:** montarla en `server.js`, **agregarle un rate limiter** (hoy
  `POST /event` es público y sin techo → escrituras ilimitadas y anónimas a la DB), corregir
  el `authenticateAdmin` duplicado, y conectar la landing.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (borrar) / **medio** (activar bien) — **requiere decisión del operador** sobre si la telemetría de la landing interesa |

---

## D5 🔵 BAJO — Extensión: el upsell apunta a planes que no se pueden comprar, y nunca se muestra

**Dónde:** `extension-app/auth.js:167-176` y `extension-app/background.js:163-175`.

```js
function getMinPlanForFlow(flow) {
  const flowPlans = {
    consulta: 'BASIC', escritos2: 'BASIC', escritos1: 'PRO',
    notificaciones: 'ENTERPRISE', deox: 'ENTERPRISE',
  };
  return flowPlans[flow] ?? 'PRO';
}
```

**Dos problemas encadenados**

1. **Los planes que devuelve no existen comercialmente.** Verificado por SQL: `BASIC`, `PRO`
   y `ENTERPRISE` están los tres en `active = false` ("Próximamente"). Los únicos planes
   comprables son `EXTENSION_PROMO` y `COMBO_PROMO`. O sea que, si el mensaje llegara a
   mostrarse, le pediría al usuario contratar algo que no está a la venta.

2. **El valor nunca se muestra.** `canUseFlow` devuelve `requiredPlan`, pero `grep` confirma
   que **ningún archivo lo consume** — es un valor muerto. Y en `background.js`, cuando la
   denegación es por plan (`flow_not_in_plan`), el handler hace `console.warn` + `return`
   **silencioso**: sin toast, sin popup, sin nada.

**Atenuante (verificado):** el popup **sí** deshabilita y marca con candado los flujos no
habilitados (`popup.js:144-170`), así que por la vía normal el usuario no puede llegar a
clickear un flujo denegado. El `return` silencioso solo se alcanza si el estado del popup
quedó viejo (p. ej. el admin cambia el plan con el popup abierto). Por eso queda en Bajo y
no en Medio.

**Solución propuesta**
- Corregir el mapa para que apunte a los planes reales (`EXTENSION_PROMO`/`COMBO_PROMO`), o
  —mejor— eliminar `getMinPlanForFlow` y `requiredPlan` si se confirma que no se van a usar
  (es código muerto que solo puede envejecer mal, como pasó acá).
- En `background.js`, ante `flow_not_in_plan` mostrar algo al usuario (abrir el popup con el
  motivo, igual que ya se hace con `no_session`/`token_expired`) en vez de retornar en
  silencio.
- **Requiere republicar la extensión en la Chrome Web Store** (con la espera de revisión de
  Google), así que conviene agruparlo con otros cambios de extensión, no publicar solo por
  esto.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** el código; el costo real es el ciclo de publicación en la Web Store |

---

## D6 🔵 BAJO — `backend-server/storage/` no está en `.gitignore`

**Dónde:** `.gitignore` (raíz) — no contempla `storage/` ni `invoices/`.

**Falla concreta**
El fix **C1** de la revisión anterior (hoy) movió los PDF de facturas a
`backend-server/storage/invoices/`. Ese directorio lo crea `ensureInvoicesDir()` en runtime,
así que aparece en cualquier entorno donde se levante el backend. Como no está ignorado, los
PDF quedan como archivos *untracked* visibles — y las facturas contienen **nombre, CUIT,
domicilio e importes** de clientes reales.

El riesgo concreto está documentado en el propio CLAUDE.md: *"Nunca uses `git add -A` /
`git add .` desde la raíz"* precisamente porque arrastra cosas no deseadas. Hoy ese descuido
mandaría datos fiscales al repositorio. (El directorio viejo `public/invoices/` tampoco
estaba ignorado, así que la exposición no es nueva — pero al introducir la ruta nueva
conviene cerrarla.)

**Solución propuesta**
Agregar a `.gitignore`:
```
backend-server/storage/
backend-server/public/invoices/
backend-server/public/_invoices_legacy_*/
```
Verificación: crear un PDF de prueba en `storage/invoices/` y confirmar que
`git status --untracked-files=all` no lo lista.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (3 líneas) |

---

## Orden de ejecución sugerido

1. **D1** — decisión de producto primero (¿la cortesía incluye extensión?); el fix es un
   `UPDATE`. Impacta a las cuentas que el operador más cuida.
2. **D2** — es el único con un vector de abuso activo hoy (registro público abierto).
3. **D3** — cierra un agujero real del logout sobre documentos con efecto legal.
4. **D6** — 3 líneas, evita un accidente con datos fiscales.
5. **D4** y **D5** — limpieza; D5 conviene agruparlo con el próximo release de la extensión.

**Agrupación sugerida:** un lote *backend* con **D2 + D3 + D6** (se prueban juntos en
staging, sin release de Electron ni de extensión), **D1** como cambio de datos aparte previa
confirmación, y **D4/D5** cuando se decida el destino de la telemetría y haya otro motivo
para republicar la extensión.

**Modelo/esfuerzo global:** Sonnet 5, esfuerzo **medio**. Lo más laborioso es D2 (barrer
todas las plantillas de `mailer.js` sin romper el HTML de marca), y hay **dos decisiones del
operador pendientes** antes de tocar código: el alcance del plan de cortesía (D1) y si la
telemetría de la landing se activa o se elimina (D4).
