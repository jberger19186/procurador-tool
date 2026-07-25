# Revisión de bugs — 2026-07-25 (segunda pasada)

> Segunda revisión de código, **sobre terreno distinto** al de la primera
> (`revision-bugs-2026-07-24.md`, cuyos 10 hallazgos ya están cerrados). Aquella cubrió
> cobranza, cuotas, licencia, monitor y `client.js`; ésta va por lo que había quedado sin
> mirar: **`auth.js`, `admin.js`, `tickets.js`, `invoiceService.js`, el rate limiting, el
> montaje de estáticos de `server.js`, la app Electron (handlers de lote) y los frontends.**
>
> Método: lectura del código real + verificación empírica contra producción/staging cuando
> el hallazgo lo permitía.

## ✅ Estado: LOS 5 HALLAZGOS CORREGIDOS Y DESPLEGADOS (2026-07-25)

**C1, C3 y C5** corregidos, verificados y **en producción**. **C2** corregido y verificado por
código — queda **pendiente de release de Electron** (no llega al usuario hasta publicar la
v2.7.43). **C4** se dejó **deliberadamente sin aplicar**: requiere medir antes el tráfico real de
`/client` (heartbeat cada 30 s durante cada ejecución) y un umbral mal elegido cortaría a un
usuario legítimo a mitad de una corrida — el riesgo del fix supera hoy al del hallazgo.

**Decisión del operador (2026-07-25) sobre C2:** cuando un lote excede la cuota, **se procesan
los que entran avisando al usuario**, en vez de bloquear el lote completo.

| # | Verificación |
|---|---|
| **C1** | **Producción:** la URL que antes devolvía el PDF entero (`/invoices/factura_33_…pdf`) ahora da **404** (antes: 200 · 13.197 bytes). **Staging (API):** dueño → 200 `application/pdf` · otro usuario → 404 · sin token → 401 · admin → 200. **Traversal:** `../../.env`, `/etc/passwd`, `…/passwd.pdf`, absolutos y no-PDF → todos bloqueados por `resolveInvoiceFile`. **UI en producción (dashboard real, sesión admin):** el botón renderiza `openInvoicePdf(46, this)`, el PDF real de 13.197 bytes baja con token y da 401 sin token, y quedan **0 links directos** a `/invoices/`. |
| **C2** | Verificado por código + sintaxis. `checkSubsystemLimit` acepta `needed` y devuelve `allowed`/`partial`; el informe por lote recorta a los que entran y avisa; `run-process-custom` gana el pre-chequeo de `batch` y un cap defensivo de expedientes leído del plan. **Sin release aún.** |
| **C3** | **Staging, ciclo real de reset:** el hash pasó de `$2b$10$` a `$2b$12$` y la página respondió "restablecida correctamente". |
| **C5** | **Staging:** descripción de 5.100 chars → **400** con el mensaje nuevo; ticket normal → **201**. |
| **C4** | No aplicado (ver arriba). |

**Migración de datos:** los PDF se copiaron a `storage/invoices/` en ambos entornos (14 en prod,
1 en staging), se verificó con `diff -rq` que las copias fueran idénticas y recién entonces se
retiró `public/invoices/` (renombrado a `public/_invoices_legacy_20260725/`, también inaccesible
por HTTP — verificado 404). Sin migración de la columna `pdf_url`: `resolveInvoiceFile` usa solo
el `basename`, así que los valores históricos (`/invoices/archivo.pdf`) siguen resolviendo.

**Limpieza:** la factura temporal creada en producción para la verificación de UI (asociada al
admin id 6, nunca a un usuario real) fue borrada — `invoices` en prod vuelve a 0 filas.

---

## Resumen

| # | Severidad | Título | Área | Verificado |
|---|---|---|---|---|
| **C1** | 🟠 **Alto** | Los PDF de facturas se descargan **sin autenticación** desde internet | Privacidad / datos fiscales | ✅ **Confirmado en producción** |
| **C2** | 🟡 Medio | Los límites del **modo lote** no se enforzan fuera de la UI | Cuotas / Electron | ✅ Confirmado por código |
| **C3** | 🔵 Bajo-Medio | El reset de contraseña público hashea con **bcrypt cost 10** (el resto usa 12) | Seguridad | ✅ Confirmado por código |
| **C4** | 🔵 Bajo | `/client` es el único router autenticado sin rate-limit general | Robustez | ✅ Confirmado por código |
| **C5** | 🔵 Bajo | `description` de tickets sin tope de longitud | Robustez | ✅ Confirmado por código |

**Controles verificados sin hallazgos:** los 81 endpoints de `/admin` tienen `authenticateAdmin`
(0 excepciones) · no hay SQL dinámico inyectable (los 3 sitios con interpolación usan whitelists
de columnas) · `tickets.js` valida propiedad en todos los endpoints y filtra los comentarios
internos · el escapado XSS del dashboard (fix XSS-1) está bien aplicado en los campos de riesgo ·
`users.email` es UNIQUE (sin ambigüedad en la resolución por email) · sin referencias huérfanas
tras los fixes de la revisión anterior.

---

## C1 🟠 ALTO — Los PDF de facturas son descargables por cualquiera, sin autenticación

**Dónde**
- `backend-server/server.js:138` — `app.use('/invoices', express.static(path.join(__dirname, 'public', 'invoices')))`,
  con el comentario *"acceso directo por URL opaca (nombre de archivo con timestamp)"*.
- `backend-server/routes/admin.js:32-39` — el nombre del archivo lo genera multer:
  ```js
  cb(null, `factura_${invoiceId}_${ts}.pdf`);   // invoiceId secuencial · ts = Date.now()
  ```

**Verificación empírica (producción, 2026-07-25)**
```
GET https://api.procuradortool.com/invoices/factura_33_1782524511845.pdf
→ HTTP 200 · content-type: application/pdf · 13.197 bytes
```
Sin token, sin cookie, sin sesión. El PDF entero se descarga anónimamente desde internet.

**Por qué la "URL opaca" no alcanza**
El nombre no es opaco, es **estructurado y parcialmente predecible**:
- `invoiceId` es un entero **secuencial** de la tabla `invoices` → enumerable (1, 2, 3…).
- El único componente "secreto" es el `Date.now()` en milisegundos del momento de la subida.
- Cualquier usuario legítimo ve la URL de **su propia** factura en el portal
  (`public/usuarios/app.js:1654` la enlaza directo) → obtiene el formato exacto **y un ancla
  temporal real**.
- Las facturas se suben en tandas por el admin: en el propio directorio de producción hay
  archivos a las 01:41, 02:45, 02:46 y 02:50 del mismo día. Con un ancla conocida, barrer
  ±10 minutos son ~1,2 M de requests por id — automatizable, y **`/invoices` no está detrás de
  ningún rate limiter** (`apiLimiter` solo cubre `/api`; los estáticos se montan antes).
- El camino `from-payment` / `manual` genera `factura_new_<ts>.pdf` (literalmente el string
  `new`), donde **lo único variable es el timestamp**.

**Impacto**
Una factura expone **nombre y apellido, CUIT, domicilio e importes** del cliente — datos
personales y fiscales de un profesional del derecho. Es el tipo de hallazgo que un pentest
externo (SEC-1, recomendado antes del lanzamiento masivo) reportaría de inmediato.

**Nota:** la auditoría SEC-1 (2026-07-13) miró el **lado de la subida** (UPL-1: mimetype
spoofeable) y de hecho cita el formato del filename *como mitigación*, pero **no evaluó el lado
del servido**. Este hallazgo es distinto y no estaba reportado.

**Solución propuesta**
1. **Sacar el directorio de `public/`** (p. ej. `backend-server/storage/invoices/`) y eliminar el
   `express.static('/invoices')` — mientras viva bajo `public/` cualquier fix es reversible por
   descuido.
2. Nueva ruta autenticada con chequeo de propiedad:
   ```js
   GET /usuarios/api/invoices/:id/pdf   → 403 si invoices.user_id !== req.user.id && role !== 'admin'
                                        → res.sendFile(path.join(INVOICES_DIR, basename(pdf_url)))
   ```
   (usar `path.basename()` sobre el valor guardado, nunca concatenar el `pdf_url` crudo → evita
   path traversal si el campo se corrompiera).
3. Actualizar los 2 consumidores: portal (`public/usuarios/app.js:1654`) y dashboard admin.
4. `pdf_url` en DB puede quedar como está (se usa solo el basename) → **sin migración de datos**.
5. Verificación: con el token del usuario A, pedir la factura del usuario B → 403; la propia → 200;
   anónimo → 401.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **medio** (toca 4 archivos + mover el directorio en el server; el riesgo está en no romper los links existentes del portal/dashboard, así que conviene probarlo en staging con una factura real) |

---

## C2 🟡 MEDIO — Los límites del modo lote no se enforzan fuera de la interfaz

Tres huecos del mismo flujo (el que más recursos consume contra el PJN):

**(a) `Procurar por Lote` no tiene pre-chequeo de cuota en el proceso principal**
`electron-app/main.js:1322` (`run-process-custom`) valida `planType==='extension'` y el cupo
**global** (`remaining<=0`), pero **nunca llama a `checkSubsystemLimit('batch', …)`**. Para una
cuenta paga el global es 999999 → no frena nunca. Es exactamente el patrón del **Hallazgo #3**
(corregido en v2.7.36 para `proc`, `informe` y `monitor_novedades` — ver `main.js:1160, 1252,
1923, 2387`): la única rama que quedó sin cubrir es `batch`. Irónicamente, el comentario del
propio helper (`main.js:1089`) dice *"Equivale al pre-chequeo que ya existe para batch"* — ese
pre-chequeo **solo existe en el renderer**, no en el proceso principal.

**(b) El tope de expedientes por corrida solo vive en la UI**
`renderer.js:2953` trunca la lista a `batch_expedientes_limit` con `.slice(0, maxExp)` y
`main.js` acepta el array `lines` **sin cap**. El servidor recibe `expedientesCount` en
`log-execution` pero **solo lo registra, no lo enforza** (`routes/client.js:395`). Es decir: el
límite de "hasta N expedientes por ejecución" del plan **no se aplica en ninguna capa
confiable**.

**(c) El pre-chequeo del informe por lote valida ≥1, no N**
`main.js:1923` corre `checkSubsystemLimit('informe', …)` **una sola vez antes del bucle**, y
después el bucle ejecuta **una llamada por expediente** (`main.js:2001`), cada una contabilizada
como un informe (`authManager.js:29` mapea `informequickscwpjn` → subsistema `informe`). Un
usuario con **1 informe restante** que lanza un lote de 30 corre los 30 contra el PJN; el
servidor cuenta 1 y devuelve 403 en los 29 restantes — **403 que la app ignora**. El trabajo ya
se hizo: sesión del PJN consumida, tiempo del usuario, y la cuota no cuadra con lo ejecutado.

**Atenuante (verificado):** los caminos de error del renderer **fallan de forma segura** — el
botón de confirmación nace deshabilitado en `showProcurarCustomModal()` y solo se habilita si
`getBatchLimits()` respondió OK, así que un corte de red no abre el bypass. El riesgo real es
(c), que es alcanzable con la app **sin modificar**, y (a)/(b) ante un cliente adulterado — el
mismo modelo de amenaza que motivó SEC-4.

**Solución propuesta**
- (a) Agregar `checkSubsystemLimit('batch', …)` en `run-process-custom`, idéntico a los otros 3.
- (c) Cambiar la firma a `checkSubsystemLimit(subsystem, plan, { needed })` y pasar
  `needed = validLines.length`; bloquear si `remaining < needed` con un mensaje explícito
  ("te quedan 1 de 30 informes necesarios"). Alternativa más amable: procesar solo los primeros
  `remaining` avisando al usuario.
- (b) Cap server-side: que `log-execution` rechace (o recorte) cuando
  `expedientesCount > batch_expedientes_limit`, y cap defensivo en `main.js` con
  `lines.slice(0, limit)` en vez de confiar en el renderer.
- Requiere **release de Electron** (a, b-parcial, c) + cambio de backend (b).

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **medio** ((a) es trivial; (c) cambia la semántica del pre-chequeo y hay que decidir "bloquear todo" vs "procesar los que entran" — conviene confirmar con el operador; implica release de Electron) |

---

## C3 🔵 BAJO-MEDIO — El reset de contraseña público hashea con bcrypt cost 10

**Dónde:** `backend-server/routes/auth.js:1132`
```js
const hash = await require('bcrypt').hash(password, 10);
```

Todos los demás caminos que escriben una contraseña usan **cost 12** (fix B-3 de 2026-06-01):
`auth.js:193` (registro), `auth.js:968` (cambio de contraseña), `usuarios.js:89` (portal),
`admin.js:281` (alta por admin). Este quedó afuera: usa `require('bcrypt')` inline en vez del
import de arriba, que es probablemente por qué el barrido original ("3 ocurrencias") no lo vio.

**Impacto:** un usuario que **recupera su contraseña** — el flujo que más se usa justamente
después de una sospecha de compromiso — termina con un hash ~4× más barato de crackear que el
del resto de los usuarios, en silencio y para siempre. No es explotable de forma remota; importa
solo ante un volcado de la base.

**Solución propuesta:** cambiar `10` → `12` y usar el `bcrypt` ya importado arriba del archivo.
Los hashes viejos siguen validando (bcrypt lleva el coste embebido). Una línea.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (1 línea; probar un ciclo real de reset en staging) |

---

## C4 🔵 BAJO — `/client` es el único router autenticado sin rate-limit general

**Dónde:** `server.js:156-174`. RI-3 (2026-07-19) agregó `generalAuthLimiter` a `/tickets`,
`/monitor`, `/license`, `/users` y `/usuarios/api`, pero **`/client` quedó sin cubrir** (línea
160), y `apiLimiter` solo se aplica a `/api` (que hoy solo sirve el router deprecado de la
extensión).

`/client` incluye `verify-session`, `/account`, `log-execution`, `batch-limits`,
`extension-auth`, `notifications` y `download/electron`. Tiene defensas puntuales
(`scriptDownloadLimiter` en la descarga de scripts, límite propio de 20/hora en `ai/chat`), pero
el resto no tiene techo de red. Es el router **más caliente** de la app (heartbeat + pre-chequeos
de cuota en cada ejecución).

**Solución propuesta:** agregar `generalAuthLimiter` al montaje de `/client`, revisando primero
que el umbral (300/5min) tolere el heartbeat real de la app — el heartbeat corre cada 30 s
durante una ejecución, más `verify-session`/`account` por acción; conviene medir el pico real de
un usuario activo antes de fijarlo, o usar un umbral propio más alto.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo-medio** (1 línea, pero **medir antes** el tráfico real de la app para no cortar a un usuario legítimo a mitad de una corrida — un umbral mal puesto acá rompe producción) |

---

## C5 🔵 BAJO — `description` de tickets sin tope de longitud

**Dónde:** `backend-server/routes/tickets.js:24` — se valida `title.length > 200` pero
`description` entra sin límite. Hoy está acotado de hecho por el límite por defecto de
`express.json()` (~100 KB, `server.js:103`), así que el riesgo real es bajo.

**Por qué vale anotarlo igual:** la propuesta de la Bitácora (§4.1.1) contempla **subir el body
limit a 5 MB** para el POST de captura. Si eso se implementa de forma global, este endpoint pasa
a aceptar descripciones de 5 MB, que después se renderizan en el dashboard admin y viajan en los
emails de notificación.

**Solución propuesta:** cap explícito (p. ej. 5.000 caracteres, coherente con el tope de 4.000
del bot IA) con 400 claro. Si se sube el body limit, hacerlo **por ruta**, no global.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** |

---

## Orden de ejecución sugerido

1. **C1** — es el único con exposición real de datos personales y está **confirmado en vivo**.
   Debería cerrarse antes de sumar clientes reales (y sí o sí antes de un pentest externo).
2. **C3** — una línea, sin riesgo.
3. **C2** — agrupado en el próximo release de Electron (requiere decidir la semántica de (c)).
4. **C4** y **C5** — robustez, sin urgencia. C4 pide medición previa.

**Agrupación sugerida:** un lote *backend* con **C1 + C3 + C5** (se prueban juntos en staging,
sin release de Electron) y un lote *Electron* con **C2**, que sí necesita release. **C4** va con
el backend pero solo después de medir el tráfico real de `/client`.

**Modelo/esfuerzo global:** Sonnet 5, esfuerzo **medio**. El código de los fixes es simple; el
trabajo está en la verificación — sobre todo C1 (no romper los links de facturas ya emitidos) y
C4 (no estrangular la app en producción).
