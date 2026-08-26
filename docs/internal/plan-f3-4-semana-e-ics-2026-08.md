# Plan de implementación — F3.4 parcial: vista "Semana" + export `.ics`

> **Estado:** ✅ **APROBADO POR EL OPERADOR (2026-08-26)** — es el ítem **1.1 de la Etapa 1** del
> [roadmap de salida a mercado](roadmap-salida-a-mercado-2026-08.md), el primero de todo el camino.
> Ya no espera ningún go/no-go. **No hay código escrito todavía.**
> **Fecha:** 2026-08-16 · **Diseñado con:** Opus 5 (solo diseño, no se tocó código)
> **Lo que su ejecución arrastra:** el export `.ics` agrega un formato al endpoint de exportación de
> Bitácora, así que **se audita dentro del bloque S2 de SEC-2** (Etapa 3) — sin bloque propio, pero
> con dos casos que el `.ics` introduce y el Excel/JSON no: una entrada sin `due_at` y una descripción
> con saltos de línea sin escapar. Y `routes/bitacora.js` es el target de la fase **F1** del
> code-review (Etapa 2), que por eso declara depender de que esta etapa esté cerrada.
> **Documento padre:** `propuesta-bitacora-agenda-2026-07.md` §11 (F3.4) y §11.2 (pendientes)
> **Alcance:** 2 de los 3 ítems de F3.4. **El tercero (tipos de entrada personalizados) queda
> explícitamente afuera** — es el único de los tres que toca el modelo de datos (`kind` tiene un
> CHECK en la tabla) y no tiene ningún pedido concreto detrás.

---

## 0. Antes de arrancar — leer esto

**Estado del módulo Bitácora al escribir este plan:** Fases 1, 2 y 3 (F3.0–F3.3) completas y en
producción, incluido el release `electron-v2.7.49`. El flag `bitacora_enabled` está **encendido en
`COMBO_PROMO`**, que hoy tiene exactamente **1 usuario** (la cuenta de prueba 250). Nada de lo que
está acá es visible para un cliente real, porque no hay clientes reales todavía (verificado por SQL
en F3.0: 3 usuarios, 2 admins + la cuenta de prueba, ninguno con `payment_provider`).

**Sobre la demanda:** el plan original marca F3.4 como *"solo si hay demanda real"*, y al 2026-08-16
no hubo ningún pedido concreto de usuario. El operador decidió avanzar igual con estos 2 ítems. Eso
está bien y es su decisión — se anota acá solo para que quien lea el documento en 6 meses entienda
por qué se construyó sin un caso de uso reportado, y no lo interprete como que hubo uno.

**Los dos bloques son independientes.** Se pueden hacer en sesiones distintas, en cualquier orden.
Recomendado: **Bloque A primero** (es el barato y sin riesgo; deja un triunfo rápido y no bloquea
nada del B).

| Bloque | Modelo / esfuerzo | Toca | Deploy | Riesgo |
|---|---|---|---|---|
| **A — Vista "Semana"** | Sonnet, **bajo** | Solo portal (`index.html`, `app.js`, `app.css`) | `scp` + `pm2 restart` | 🟢 Bajo — aditivo, reversible en segundos |
| **B — Export `.ics`** | Sonnet, **medio** | Backend (`routes/bitacora.js`) + portal | `scp` + `pm2 restart` | 🟡 Medio — **es 100% serialización de fechas**, ver §B.0 |

**Ninguno de los dos requiere:** migración de base de datos · release de Electron · tocar scripts
encriptados · tocar nada de cobro.

---

# BLOQUE A — Vista "Semana" del calendario

> Cierra el pendiente **P-F1.3-a**. F1.3 mencionaba un toggle `[Mes][Semana][Lista]` pero solo
> construyó Mes y Lista, porque Semana no tenía mockup propio y se juzgó redundante para el volumen
> de una agenda de un abogado individual.

## A.1 Qué se construye

Un tercer botón en el toggle que ya existe, que muestra **7 columnas (lunes a domingo)** con las
entradas de cada día apiladas — el mismo nivel de detalle que el panel lateral de la vista Mes, pero
para toda la semana a la vez.

## A.2 Puntos de enganche exactos

Todo en `backend-server/public/usuarios/`. Números de línea al 2026-08-16 (verificar, pueden correrse):

| Archivo | Qué hay hoy | Qué agregar |
|---|---|---|
| `index.html:355-356` | 2 botones `.bitacora-view-btn` con `data-view="mes"` / `="lista"` | Un tercero, `data-view="semana"`, **entre** los dos (orden natural: Mes · Semana · Lista) |
| `index.html:380` | `<div id="bitacora-vista-mes" class="bitacora-mes-layout">` | Un `<div id="bitacora-vista-semana" style="display:none">` hermano |
| `app.js:23` | `view: 'mes',  // 'mes' \| 'lista'` | Actualizar el comentario a incluir `'semana'` |
| `app.js:2867` `bitacoraApplyViewToggle()` | Muestra/oculta los 2 contenedores | Agregar el tercero — ⚠️ ver A.3 |
| `app.js:2877` `bitacoraLoadAndRenderView()` | `if (view==='mes') loadBitacoraMonth(); else loadBitacoraLista();` | Convertir a 3 ramas (un `if/else if/else`, no un ternario anidado) |
| `app.js:2897` `bitacoraMonthNav(delta)` | Navega ±1 mes sobre `state.bitacora.monthCursor` | Necesita su equivalente semanal (±7 días) — ver A.4 |
| `app.css` | `.bitacora-mes-layout`, `.bitacora-calendar-*` | Clases nuevas con prefijo `bitacora-semana-*` |

## A.3 ⚠️ La única trampa real del bloque

`bitacoraApplyViewToggle()` **hardcodea un `display` distinto por vista**:

```js
if (mes)   mes.style.display   = state.bitacora.view === 'mes'   ? 'grid'  : 'none';
if (lista) lista.style.display = state.bitacora.view === 'lista' ? 'block' : 'none';
```

Mes usa `grid` porque `.bitacora-mes-layout` es un CSS grid de 2 columnas (calendario + panel del
día). **La vista Semana necesita su propio valor explícito** — copiar el de Mes por inercia
funcionaría o no según cómo se maquete la grilla de 7 columnas, y es el tipo de bug que se ve raro
en pantalla sin dar ningún error en consola. Decidir el `display` a partir del CSS que se escriba,
no por analogía.

## A.4 Qué reusar (no reescribir)

El bloque es barato **porque casi todo ya existe**. Reusar sin modificar:

| Función | Línea | Para qué |
|---|---|---|
| `bitacoraBuildQuery(desde, hasta)` | `app.js:3126` | Arma los query params respetando los filtros activos (tipo, estado, expediente) |
| `bitacoraApplyClientFilters(rows)` | `app.js:3113` | Aplica búsqueda de texto y filtro "hechos" client-side |
| `bitEntryRowHtml(e)` | `app.js:3086` | **El item visual de una entrada** — el mismo que usan el panel del día y la vista Lista |
| `bitCacheEntries(rows)` | — | Cachea por id para que los `onclick` pasen solo un número |
| `bitLocalYmd(due_at)` | `app.js:2749` | Día calendario de una entrada — **ver A.5** |

**Modelo a copiar:** `loadBitacoraMonth()` (`app.js:3136`) hace exactamente el ciclo que necesita
Semana — calcula rango → arma query → `apiFetch` → filtra client-side → cachea → renderiza. La
versión semanal es la misma función con otro rango y otro render.

## A.5 Fechas — usar `bitLocalYmd()`, NO `bitUtcYmd()`

Esto importa y tiene historia: F3.0 encontró **3 bugs reales de timezone** en este módulo
(pendiente P-F3.0-a). La regla, ya documentada en el comentario de `app.js:2758`:

- **`due_at`** es un `timestamptz` guardado a **mediodía local** (`bitToIsoMidday`) → se lee con
  **`bitLocalYmd()`**. ✅ Es lo que necesita la vista Semana.
- Las columnas **`DATE` puras** (`feriados.fecha`, `situacion_fecha`, `run_date`) el backend las
  serializa como medianoche UTC → se leen con **`bitUtcYmd()`**.

La vista Semana solo toca `due_at`, así que va con `bitLocalYmd()` — igual que la vista Mes
(`app.js:3168`, `3216`). **No inventar un helper nuevo ni "mejorar" los existentes.**

## A.6 Decisiones ya tomadas (no re-abrir)

- **Lunes como primer día.** `bitacoraMonthRange()` ya usa `(first.getDay() + 6) % 7` para eso —
  mantener la misma convención, no arrancar en domingo.
- **Sin grilla horaria.** Nada en el modelo lo justifica: `all_day` tiene default `true` y `due_at`
  se guarda a mediodía, así que la hora es artificial en la enorme mayoría de las entradas.
  Semana = 7 columnas de listas apiladas, no una agenda por hora tipo Outlook.
- **La navegación es ±7 días**, y conviene que **comparta `state.bitacora.monthCursor`** en vez de
  agregar un cursor nuevo: al cambiar de Mes a Semana el usuario espera seguir parado en la misma
  fecha, no saltar a "hoy".

## A.7 Verificación (sin necesitar el PJN)

1. `node --check public/usuarios/app.js`
2. Servir el portal localmente y comprobar, con el mismo patrón de stub que se usó en F3.3
   (servidor Node mínimo + `preview_start`, ver el commit de F3.3 si hace falta el molde):
   - El toggle muestra los 3 botones y `active` se mueve correctamente.
   - Cambiar Mes → Semana → Lista → Mes no deja dos contenedores visibles a la vez.
   - Una entrada en el día de hoy aparece en la columna correcta (**el caso que caza el bug de
     timezone si alguien usó el helper equivocado**).
   - Navegar ±1 semana cruza correctamente el borde de mes (probar en una semana que abarque fin de
     mes, ej. 30/09 → 01/10).
   - Los filtros de tipo/estado/búsqueda siguen aplicando en la vista nueva.
3. No-regresión: las vistas Mes y Lista siguen funcionando igual.

**Sin backup de base necesario** — el bloque no escribe una sola fila.

---

# BLOQUE B — Export `.ics`

> **Este bloque es 100% serialización de fechas y horas, en el único módulo del proyecto que produjo
> 3 bugs reales de timezone en producción, tres semanas antes de escribir este plan** (P-F3.0-a,
> corregidos en el commit `a95d0c8`). El formato `.ics` en sí es simple y está bien documentado; el
> riesgo no está ahí. Está en las 6 trampas de §B.2, que son específicas de **este** modelo de datos.

## B.0 Por qué no es "un export más"

Los dos formatos que ya existen (`xlsx`, `json`) vuelcan las fechas **tal como vienen de la base**,
sin interpretarlas. `.ics` no puede: tiene que decidir, por cada entrada, **si es un evento de día
completo o con hora**, y **en qué día calendario cae**. Esa decisión es exactamente donde estuvieron
los 3 bugs de F3.0.

## B.1 Dónde vive — como tercer `formato`, no como endpoint nuevo

El endpoint ya existe y ya resuelve todo lo difícil:

```
GET /usuarios/api/bitacora/export?alcance=<todo|entradas|expediente>&formato=<xlsx|json>
                                  routes/bitacora.js:284
```

Agregar `formato=ics` como tercera opción. **Ventajas de no crear un endpoint nuevo:**

- Hereda el gate con **ventana de gracia de 90 días** (`checkBitacoraPlan({ conGracia: true })`) —
  un usuario que perdió el plan puede seguir sacando su agenda, que es exactamente el espíritu de la
  decisión D2/Q6.
- Reusa `recolectarDatosExport()` (`routes/bitacora.js:130`), que ya maneja los 3 alcances y el
  filtro por rango de fechas.
- Reusa el modal del portal, el manejo de blob y el spinner, ya construidos en F1.6.

**Patrón a seguir:** el `if/else` de `routes/bitacora.js:307-311` pasa a tener una tercera rama que
llama a una función `enviarExportIcs(res, datos, alcance)`, hermana de `enviarExportJson` (línea
**184**) y `enviarExportXlsx` (línea **200**).

⚠️ **Validación del query param:** hoy es `req.query.formato === 'json' ? 'json' : 'xlsx'`
(`routes/bitacora.js:289`) — un ternario que colapsa todo lo desconocido a `xlsx`. Al agregar el
tercero, **convertirlo a un whitelist explícito** (`['xlsx','json','ics'].includes(...)`), no
encadenar otro ternario.

## B.2 🚨 Las 6 trampas — checklist obligatorio

Cada una de estas produce un bug que **parece funcionar** al mirar el archivo por encima.

### B.2.1 `due_at` NO es una fecha — es un `timestamptz` a mediodía local

El portal guarda las fechas con `bitToIsoMidday(ymd)` = `new Date('2026-08-20T12:00:00').toISOString()`.
Eso es **mediodía en el huso del navegador**. Para Argentina (UTC-3) queda `2026-08-20T15:00:00Z`.

El `.ics` se genera en el **servidor**, que **no conoce el huso del usuario**. Hacer
`due_at.toISOString().slice(0,10)` da `2026-08-20` — correcto, **pero por coincidencia aritmética**:
funciona solo porque mediodía en UTC-3 no cruza el borde del día en UTC. Es el mismo razonamiento
que produjo los 3 bugs de F3.0.

**Qué hacer:** documentar la suposición explícitamente en un comentario (*"el proyecto es para
abogados argentinos, `due_at` se guarda a mediodía ART; leer el día en UTC es correcto mientras el
huso del cliente esté entre UTC-11 y UTC+11"*) y **derivar el día con los getters UTC**
(`getUTCFullYear/Month/Date`), no con los locales del servidor —
que además corre en UTC y daría el mismo resultado hoy, pero por otra razón, y eso es justamente lo
frágil.

### B.2.2 `all_day` existe, su default es `true`, y cambia el formato del campo

Columna `bitacora_entries.all_day boolean DEFAULT true`.

| Caso | Línea `.ics` correcta |
|---|---|
| `all_day = true` | `DTSTART;VALUE=DATE:20260820` (y `DTEND;VALUE=DATE:20260821` — **exclusivo**, el día siguiente) |
| `all_day = false` | `DTSTART:20260820T150000Z` |

**Si se ignora `all_day`**, todos los vencimientos aparecen en Google Calendar "a las 15:00" en vez
de como eventos de día completo. Se ve prolijo, está mal, y es el error más probable del bloque.

⚠️ El `DTEND` de un evento de día completo es **exclusivo** (el día siguiente). Poner el mismo día
que `DTSTART` produce un evento de duración cero que algunos clientes no muestran.

### B.2.3 Las entradas sin `due_at` deben excluirse — no es opcional

`due_at` es nullable y **hay entradas reales sin fecha**: las notas, y las tareas de revisión que
genera F3.3 (que se crean deliberadamente **sin** `due_at`, para no inventar un plazo).

Un `VEVENT` sin `DTSTART` es **inválido por RFC 5545**. Algunos clientes descartan el evento; otros
**rechazan el archivo entero**. Filtrar con `WHERE due_at IS NOT NULL` — o en JS antes de generar,
si se usa `recolectarDatosExport()` tal cual.

**Consecuencia de producto a tener presente:** un export `.ics` de alcance "todo" va a traer *menos*
entradas que el `.xlsx` del mismo alcance. Eso es correcto, no un bug — pero conviene que el modal
lo diga (ver B.4).

### B.2.4 Escapado de texto y plegado de líneas

RFC 5545 exige escapar, **en este orden**: `\` → `\\`, luego `;` → `\;`, `,` → `\,`, y saltos de
línea → `\n` literal.

**No es cosmético.** Las carátulas del PJN están llenas de comas y comillas
(`ARCA C/ NIETOS DE DON COCHO S. A. S. S/EJECUCION FISCAL`, `RUIZ c/ "LA CAJA" S.A. s/ DAÑOS`). Una
coma sin escapar en un `SUMMARY` hace que el parser lea el resto como otro campo → el evento sale
truncado o el archivo no importa.

Además: **las líneas se pliegan a 75 octetos** (no caracteres — importa con acentos y `ñ`, que en
UTF-8 ocupan 2 bytes), continuando con un espacio al inicio de la línea siguiente. Las carátulas
superan los 75 octetos con frecuencia.

**Terminadores de línea: CRLF (`\r\n`)**, no `\n`.

### B.2.5 `UID` estable por entrada

Sin `UID`, o con uno aleatorio por generación, un usuario que exporta dos veces e importa las dos
**duplica toda su agenda**. Con un UID estable, el segundo import actualiza en vez de duplicar.

Formato sugerido: `UID:bitacora-<entrada.id>@procuradortool.com`.

Incluir también `DTSTAMP` (obligatorio por RFC) con el momento de generación, en UTC.

### B.2.6 `repeat_rule` → `RRULE`

Columna con CHECK: `'weekly' | 'monthly' | 'yearly'` o `NULL`. El mapeo es directo
(`RRULE:FREQ=WEEKLY` / `MONTHLY` / `YEARLY`).

**Decisión a tomar antes de codear:** exportarlo o ignorarlo en v1. **Recomendado: exportarlo** — es
una línea, el mapeo es 1:1 sin ambigüedad, y una entrada recurrente exportada como evento único es
un dato incorrecto en el calendario del usuario, no una simplificación inocente.

## B.3 Qué poner en cada `VEVENT` (mapeo sugerido)

| Campo `.ics` | Origen | Nota |
|---|---|---|
| `UID` | `bitacora-<id>@procuradortool.com` | B.2.5 |
| `DTSTAMP` | momento de generación, UTC | Obligatorio |
| `DTSTART` / `DTEND` | `due_at` + `all_day` | B.2.1, B.2.2 |
| `SUMMARY` | `<icono/label del kind> — <title>` | Escapado (B.2.4). El label sale del map `BIT_TIPOS`, que hoy vive **solo en el portal** (`app.js:2740`) — si se quiere en el servidor, duplicarlo ahí con un comentario, **no** importar del front |
| `DESCRIPTION` | `description` + el expediente vinculado si existe | Escapado. `recolectarDatosExport` ya trae `x.expediente` por LEFT JOIN en el alcance `entradas` |
| `RRULE` | `repeat_rule` | B.2.6 |
| `STATUS` | `done_at ? 'COMPLETED' : 'CONFIRMED'` | Opcional pero barato y útil |
| `CATEGORIES` | `kind` | Opcional; permite filtrar en algunos clientes |

**Cabecera del archivo:** `BEGIN:VCALENDAR` / `VERSION:2.0` / `PRODID:-//Procurador SCW//Bitacora//ES`
/ `CALSCALE:GREGORIAN`.

**Headers HTTP:** `Content-Type: text/calendar; charset=utf-8` y
`Content-Disposition: attachment; filename="bitacora-<alcance>-<fecha>.ics"` — mismo patrón que
`enviarExportJson` (`routes/bitacora.js:194-195`).

## B.4 Cambios en el portal

Mínimos, 3 lugares:

1. **`index.html:731-742`** — un tercer radio en el grupo `export-formato`:
   `iCalendar (.ics) — para Google Calendar / Outlook`. Conviene un texto chico aclarando que
   **solo incluye entradas con fecha** (B.2.3).
2. **`app.js:4065`** (dentro de `descargarExportBitacora`, que arranca en la 4028) — la línea
   `const ext = formato === 'json' ? 'json' : 'xlsx';` necesita la tercera opción. **Mismo criterio
   que en el backend: whitelist, no otro ternario encadenado.**
3. **`app.js:3796`** (`openExportModal`) — no requiere cambio (resetea a `xlsx`, que sigue siendo el
   default correcto), pero verificar que el reset no rompa con el radio nuevo.

## B.5 Verificación

**No alcanza con "el archivo se descarga".** El criterio es que un cliente de calendario real lo
importe correctamente.

1. `node --check` en los archivos tocados.
2. **Harness en staging** (mismo patrón que F3.1/F3.2/F3.3 — script Node con `pg` + `jwt` + `fetch`
   y **guard que aborta si `DB_NAME !== 'procurador_db_staging'`**), con estos casos:
   - Gate de plan: sin `bitacora_enabled` → 403.
   - **Ventana de gracia:** con el plan perdido hace 10 días → **200** (es la razón de vivir en este
     endpoint y no en uno nuevo). Con 100 días → 403.
   - Los 3 alcances (`todo` / `entradas` / `expediente`) devuelven `Content-Type: text/calendar`.
   - Una entrada `all_day=true` produce `DTSTART;VALUE=DATE:` y `DTEND` **del día siguiente**.
   - Una entrada `all_day=false` produce `DTSTART:` con hora.
   - Una entrada **sin `due_at` no aparece** en la salida.
   - Una carátula con coma, punto y coma y comillas sale escapada.
   - Una entrada con `repeat_rule='monthly'` produce `RRULE:FREQ=MONTHLY`.
   - No-regresión: `formato=xlsx` y `formato=json` siguen devolviendo lo mismo que antes.
3. **Parseo real del archivo generado** — no inspección visual. Correr la salida contra un parser
   de iCalendar (p. ej. `node-ical` o `ical.js` como dependencia **de desarrollo, no del backend**,
   o un validador online si se prefiere no agregar nada) y verificar que devuelve la cantidad de
   eventos esperada con las fechas correctas. **Este paso es el que caza las trampas B.2.2 y B.2.4**,
   que a ojo se ven bien.
4. **Prueba de día calendario:** crear una entrada con `due_at` en el **día de hoy**, exportar, y
   confirmar que el `.ics` dice hoy y no ayer. Es el test de una línea que habría cazado los 3 bugs
   de F3.0.
5. Prod: backup previo **no hace falta** (el endpoint es de solo lectura), pero sí repetir el smoke
   de no-regresión de los otros 2 formatos después del deploy.

## B.6 Qué NO hacer

- ❌ **No tocar `bitToIsoMidday()`, `bitLocalYmd()`, `bitUtcYmd()` ni `formatDate()`.** Los cuatro
  son correctos para su caso de uso y están documentados con el porqué. Si algo del `.ics` no
  cuadra, el error está en el código nuevo.
- ❌ **No cambiar cómo se guarda `due_at`.** Migrar a una columna `DATE` "para simplificar el .ics"
  sería tocar el modelo de datos de todo el módulo por un formato de exportación.
- ❌ **No agregar `express.json({limit})` ni ningún parser nuevo.** No hace falta (es un `GET`), y la
  cadena de parsers de `server.js` está adyacente al hook del que depende la firma HMAC de los
  webhooks de MercadoPago (punto crítico P2).
- ❌ **No crear un endpoint nuevo.** Ver B.1.
- ❌ **No importar código del portal en el backend.** Si hace falta el map de tipos, duplicarlo con
  un comentario que lo diga.

---

## Prompt sugerido para arrancar la sesión

> **Bloque A:** *"Ejecutá el Bloque A del plan `docs/internal/plan-f3-4-semana-e-ics-2026-08.md`
> (vista Semana de la Bitácora)."* — Sonnet, esfuerzo bajo.
>
> **Bloque B:** *"Ejecutá el Bloque B del plan `docs/internal/plan-f3-4-semana-e-ics-2026-08.md`
> (export .ics). Leé §B.2 completo antes de escribir código."* — Sonnet, esfuerzo medio.

## Al terminar cada bloque

Siguiendo la convención del proyecto:

1. Commit con archivos **explícitos por nombre** (nunca `git add -A` / `git add .`).
2. Entrada de sesión al tope de `## 🔄 Estado actual` en `CLAUDE.md`.
3. Marcar el ítem en `propuesta-bitacora-agenda-2026-07.md`: la fila **F3.4** de §11.1 y el resumen
   de **§11.2** (el Bloque A además **cierra P-F1.3-a** — actualizar su fila a 🟢).
4. Si quedan cabos sueltos, agregarlos como `P-F3.4-x` en la tabla de §11.2.
