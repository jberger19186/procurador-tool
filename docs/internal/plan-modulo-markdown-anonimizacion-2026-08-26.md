# Plan de implementación — Módulo Markdown / Anonimización judicial (2026-08-26)

> **Origen:** `brief_modulo_anonimizacion_electron.md` (operador, 2026-08-26).
> **Lugar en el proyecto:** **Etapa 1.2** de `docs/internal/roadmap-salida-a-mercado-2026-08.md`.
> **Estado:** ✅ **APROBADO POR EL OPERADOR (2026-08-26)** — ya no espera ningún go/no-go de negocio.
> **No se escribió código.** El módulo no existe todavía.
>
> **Lo que su aprobación arrastra hacia las etapas siguientes:** este módulo **va a existir cuando
> corran la Etapa 2 y la Etapa 3**, y las dos tienen que cubrirlo. La Etapa 2 ya lo contemplaba —
> fase **F5** del [plan de code-review](plan-code-review-integral-2026-08-26.md), con el motor de
> anonimización en Opus. La Etapa 3 **no lo contemplaba**, porque el plan SEC-2 se escribió el 24/08
> cuando este módulo todavía era una decisión sin resolver → se le agregó el bloque **S10** el
> 2026-08-26. **F5 y S10 no se solapan:** F5 pregunta *"¿el motor está bien escrito?"*, S10 pregunta
> *"¿qué pasa si el PDF de entrada es hostil?"* — y este módulo descarga archivos desde URLs que salen
> del **documento**, no de nuestro código.
>
> ✅ **M0 EJECUTADO Y CERRADO el 2026-08-26 — ESCENARIO A, el más barato.** Informe con evidencia:
> **[`spike-markdown-M0-2026-08-26.md`](spike-markdown-M0-2026-08-26.md)**. Los adjuntos del SCW se
> descargan **sin sesión** (12/12 `HTTP 200`), así que **M3 es `fetch` en Node: no se toca ningún
> script encriptado, no entra el candado de ejecución, y el módulo SÍ procesa informes viejos**. La
> capa de texto resultó mucho mejor de lo previsto (**0 %** de páginas sin texto en el informe,
> **14,6 %** en los adjuntos). **El alcance se mantiene en 6–10 sesiones; la horquilla alta de 9–13
> queda descartada.** El arranque ahora es **M1**.
>
> 🚨 **Y el spike encontró algo que este plan no contemplaba y que amplía M4:** como los documentos
> del SCW se abren **sin autenticación** y sus tokens **no expiran** (≥27 días medidos), un `.md` con
> los nombres enmascarados pero **los enlaces intactos entrega acceso directo a los originales sin
> anonimizar**. **La anonimización tiene que alcanzar a las URLs, no solo al texto.** Las 3 opciones
> y la recomendación, en §4 del spike.

---

## 0. Resumen ejecutivo

| | |
|---|---|
| **Qué es** | Un módulo nuevo en la app Electron que toma un informe PDF ya generado por la propia app, descarga los PDF vinculados, extrae todo a Markdown, y produce además una versión **anonimizada** con un diccionario de reemplazos editable |
| **Dónde vive** | Botón propio en el topbar de la app, **al lado de 📔 Bitácora** — mismo patrón que F2.7 |
| **Gating** | Por plan (`plans.markdown_enabled`), igual que Bitácora. Nace apagado en los 6 planes |
| **Salidas** | `.md` completo · `.md` anonimizado · `mapping.txt` — en la carpeta de descargas **del usuario** (`PROCURADOR_DATA_DIR`), con prefijo propio |
| **Bloques** | 7 (M0 gate + M1–M6) |
| **Modelo dominante** | Sonnet. **Opus solo en M4** (motor de anonimización) |
| **Sesiones estimadas** | **6–10**, más 1 release de Electron. ~~M0 puede subir el rango a 9–13~~ → **descartado: M0 cerró en escenario A** (ver nota de encabezado y §2) |
| **Despliegue** | M1 es backend puro (sin release). M2–M5 son cliente → **un solo release al final** |
| **Migración de DB** | 1 columna aditiva. Nada más |

---

## 1. Principio de diseño no negociable: todo local

**Ningún byte del contenido procesado sale de la máquina del usuario.** Ni el PDF, ni el
Markdown, ni el `mapping.txt`, ni un resumen, ni telemetría del contenido.

No es una preferencia estética: es la misma promesa que ya sostiene el producto y que está
escrita en la landing — *"las contraseñas del PJN nunca pasan por nuestros servidores"*. Este
módulo procesa **expedientes judiciales completos con datos de terceros**; si algo de eso
tocara el servidor, el argumento de venta central del producto se cae y además abriría un
problema de Ley 25.326 que hoy no existe.

**Lo único que viaja al servidor** es el flag del plan (`markdownEnabled`, un booleano en
`/client/account`, que ya se consulta al arrancar) y, si se decide, el conteo de ejecuciones
para cupo. **Nunca el contenido.**

---

## 2. M0 — Spike de viabilidad ✅ **EJECUTADO Y CERRADO (2026-08-26)**

> **📄 Resultado con evidencia: [`spike-markdown-M0-2026-08-26.md`](spike-markdown-M0-2026-08-26.md).**
> Lo de abajo queda como **registro del diseño del gate** — las preguntas que se hicieron y por qué.
> **Las respuestas están en el spike, no acá.** Resumen: **P1** el informe extrae 100 % del texto y
> los adjuntos el 85,4 % → sin OCR en v1 · **P2 → ESCENARIO A**, descarga sin sesión, `fetch` en Node
> · **P3** drag & drop + lista de recientes **agrupada por expediente** (en la carpeta real hay 30
> informes de solo 4 expedientes).

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** — *ejecutado con Opus 5* |
| **Duración** | 1 sesión — *cumplida* |
| **Entregable** | ✅ [`spike-markdown-M0-2026-08-26.md`](spike-markdown-M0-2026-08-26.md) |
| **Riesgo si se saltea** | Alto. Las dos primeras preguntas podían convertir M3 de "descargar URLs" en "conducir una sesión de Puppeteer autenticada", 3× el trabajo y **tocando un script encriptado**. **Ese riesgo quedó descartado** |

### Pregunta 1 — ¿Los PDF tienen capa de texto?

Hay **dos** clases de PDF en juego y hay que responder por separado:

- **El informe que genera la app** (`informequickscwpjn.js`) — se produce con Puppeteer, así que
  lo esperable es que tenga capa de texto real. **Confirmarlo abriendo uno real** con
  `pdfjs-dist` y contando caracteres extraídos por página.
- **Los documentos vinculados del SCW** (escritos, cédulas, sentencias, resoluciones) — acá lo
  esperable es lo contrario: **buena parte son escaneos sin capa de texto**. El brief ya lo
  contempla ("marcadores descriptivos en páginas o secciones que contengan imágenes"), y esa es
  la decisión correcta: **no meter OCR en la v1**. Un marcador honesto (`> [Página 4 — imagen sin
  texto extraíble]`) es mejor producto que un OCR mediocre que inventa texto en un documento
  judicial.

**Salida esperada:** el % aproximado de páginas sin texto en una muestra real de 3–5 informes del
operador. Si resultara que casi todo es imagen, el módulo pierde gran parte de su valor y hay que
volver a hablarlo antes de invertir 6 sesiones.

### Pregunta 2 — ¿Los enlaces son anotaciones URI, y sus destinos requieren sesión? 🚨 **la que define el tamaño del módulo**

El brief dice *"detección y descarga automática de enlaces a PDFs externos vinculados"* y propone
`app.getPath('temp')` + descargas asíncronas en Node. Eso funciona **solo si** los destinos son
públicos. Y el SCW **no lo es**: las descargas de documentos de un expediente exigen la sesión del
PJN.

Los tres escenarios posibles, con su costo real:

| Escenario | Qué implica M3 | Costo |
|---|---|---|
| **A** — Los enlaces son URI públicas descargables sin sesión | `fetch` en Node, como propone el brief | 🟢 bajo — 1 sesión |
| **B** — Requieren sesión, pero sirve el **perfil de Chrome ya logueado** que la app mantiene | Descargar con Puppeteer usando `ChromeProfile`, reusando el patrón de `abrirNavegadorPJN.js` | 🟡 medio — 2 sesiones + manejo del candado de ejecución |
| **C** — Solo se pueden obtener **durante la corrida del informe**, con la sesión viva | Habría que capturarlos en `informequickscwpjn.js` → **editar un script encriptado + `reencrypt_scripts.js` + redeploy**, y el módulo pasa a depender de informes generados *después* del cambio | 🔴 alto — cambia el alcance del proyecto |

**El escenario C tiene una consecuencia de producto que hay que decir en voz alta:** si se elige,
el módulo **no puede procesar informes viejos**, solo los generados desde la versión nueva. Eso hay
que decidirlo antes de construir, no descubrirlo después.

**Cómo se responde:** abrir un informe real del operador con `pdfjs-dist`, listar las anotaciones
de tipo `Link`, y probar un `GET` sin cookies contra uno de esos destinos. Tres comandos, media hora.

### Pregunta 3 — ¿Cuál es el input real del módulo?

El brief dice "informes de expedientes judiciales en PDF (producidos por la app electron)". Hay que
fijar si el usuario:

- **(a)** elige un PDF con el explorador / drag & drop (lo que dice el brief — más flexible, permite
  informes viejos), o
- **(b)** el módulo lista los informes ya presentes en su carpeta de descargas y elige de ahí
  (menos fricción, y garantiza que el formato es el esperado).

**Recomendación: (a) como camino principal + (b) como atajo.** El drag & drop es lo que pide el
brief y no cierra la puerta a nada; la lista de informes recientes se resuelve leyendo
`PROCURADOR_DATA_DIR/descargas/informe_*.pdf`, que ya existe y es barato.

---

## 3. Los bloques

### M1 — Habilitación por plan (backend) 🟢 ✅ **EJECUTADO Y EN PRODUCCIÓN (2026-08-26)**

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **bajo** |
| **Despliegue** | backend, sin release de Electron |
| **Depende de** | nada (puede hacerse en paralelo con M0) |

Copia exacta del patrón de Bitácora F1.1 + F1.5, que ya está probado y en producción:

- Migración **aditiva**: `plans.markdown_enabled BOOLEAN DEFAULT false`. **Nace apagada en los 6
  planes** — nadie ve nada hasta que un admin la encienda.
- `GET /client/account` expone `markdownEnabled` (un campo más en una respuesta que la app ya
  consume al arrancar).
- `POST/PUT /admin/plans` aceptan el campo con el mismo `COALESCE` que protege `visibility` /
  `bitacora_enabled` — **importante**: sin el `COALESCE`, un `PUT` que solo cambia el nombre del
  plan apagaría el flag.
- Checkbox "📝 Incluye Markdown" en el form de planes del dashboard admin, al lado del de Bitácora.

**Por qué va primero (o en paralelo a M0):** es barato, es invisible, no rompe nada, y deja el
interruptor listo para cuando el cliente lo necesite. Igual que Bitácora, el flag existiendo antes
que la feature permite desplegar el resto sin que nadie lo vea.

**✅ Decisión del operador (2026-08-26): NO consume cupo.** Mismo criterio que Bitácora — es
procesamiento 100% local, no toca el PJN ni gasta recursos del servidor. Documentado en el
`COMMENT` de la columna `markdown_enabled` para que quede escrito en el propio schema.

> ✅ **Verificado 2026-08-26** con `dev-tools/verify-markdown-m1.js` contra staging (mismo patrón
> `pg`+`jwt`+`https` con guard `DB_NAME`) — **11/11 PASS**: la columna existe y nace en `false` en
> todos los planes reales · `GET /client/account` expone `markdownEnabled` reflejando el flag en
> ambos sentidos (encendido/apagado) · `PUT /admin/plans/:id` persiste el flag · **el `COALESCE`
> protege el flag** — un `PUT` que solo cambia `display_name` NO lo apaga (mismo antecedente que
> motivó el `COALESCE` de `bitacora_enabled`/`visibility`) · no-regresión de `bitacora_enabled` (no
> se ve afectado por tocar `markdown_enabled`) · alta de plan (`POST /admin/plans`) persiste el
> campo desde el alta · `GET /admin/plans` (`SELECT *`) lo expone sin cambios de código ·
> no-regresión de `GET /usuarios/api/plans`. **Desplegado a staging→prod**: backup de DB previo en
> ambos entornos, migración aplicada (los 6 planes reales de prod quedaron en `false`), backup de
> los 3 archivos de código, md5 servido = md5 local exacto, health/landing/portal/dashboard 200,
> `pm2-error.log` sin entradas nuevas (la más reciente sigue del 15/08). **Checkbox "📝 Incluye
> Markdown" agregado al dashboard admin**, al lado del de Bitácora — el módulo queda listo para
> encenderse plan por plan cuando M2-M5 estén construidos, sin que nadie lo note hoy.

---

### M2 — Extracción del PDF principal a Markdown 🟡 ✅ **EJECUTADO (2026-08-26)**

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **alto** |
| **Depende de** | M0 pregunta 1 |
| **Dependencia nueva** | `pdfjs-dist` en `electron-app` |

- Extracción de la capa de texto página por página, **preservando el orden de lectura** (que en
  PDF no es trivial: los items vienen con coordenadas, no en orden semántico — hay que ordenar por
  `transform[5]` descendente y `transform[4]` ascendente, con tolerancia de línea).
- Reconstrucción de estructura mínima: encabezados de sección del informe → `##`, tablas de
  actuaciones → tablas Markdown, fechas y tipos preservados.
- **Marcador descriptivo** en toda página/sección sin texto extraíble, tal como pide el brief.
- Salida a `PROCURADOR_DATA_DIR/descargas/` — **la carpeta del usuario por CUIT** (D6), no la raíz.
  Nombre siguiendo la convención de v2.7.33: `markdown_<exp>_<ISO>.md`.

**⚠️ Nota de dependencias, con antecedente real:** agregar `pdfjs-dist` a `electron-app` debe
hacerse con `npm install pdfjs-dist` **quirúrgico y revisando el diff del lockfile**. El proyecto
ya tuvo un incidente exactamente acá: en la revisión de salud del 2026-07-25, un intento de usar
`overrides` disparó una re-resolución del árbol que dejó staging con versiones **más viejas** que
producción. Verificar que ninguna versión existente cambie.

> ✅ **Ejecutado y verificado 2026-08-26.** `npm install pdfjs-dist@^4.10.38` en `electron-app` —
> diff del lockfile confirmado: **0 versiones existentes cambiaron**, solo se agregaron `pdfjs-dist`
> y su dependencia opcional `@napi-rs/canvas` (usada por pdfjs solo para *renderizar* páginas a
> imagen, algo que este módulo nunca hace — extrae texto, no rasteriza). `npm audit` **antes y
> después dio exactamente el mismo resultado** (9 vulnerabilidades, 1 moderate + 8 high, todas
> preexistentes de `js-yaml`/`undici` en el árbol de `electron-builder`) — cero vulnerabilidades
> nuevas. `npm start` arrancó limpio después del install.
>
> **pdfjs-dist v4 es ESM puro** (sin build CJS) — se carga con `import()` dinámico desde el módulo
> CommonJS del proyecto (`electron-app/markdown/extraerPdfAMarkdown.js`), funciona sin problema
> desde el proceso principal de Electron. `disableWorker: true` evita depender de Web Workers (no
> existen tal como los usa el browser) y `standardFontDataUrl`/`cMapUrl` apuntan a los recursos que
> trae el propio paquete (sin esto, solo un warning informativo, sin fallar).
>
> **Motor implementado en 2 capas** (`electron-app/markdown/extraerPdfAMarkdown.js`): (1) genérica
> — reconstruye las líneas de una página en **orden de lectura real** (ordenando por `y`
> descendente/`x` ascendente con tolerancia de línea, no confiando en el orden de los items del PDF,
> que no está garantizado) — reutilizable por M3 para los adjuntos del SCW; (2) específica del
> informe — clasifica las líneas según la plantilla real de `informequickscwpjn.js` (título ·
> carátula/jurisdicción como cita · `**Situación:**` · tabla Markdown de "Movimientos" con
> continuaciones sin fecha fundidas en la fila anterior y marcador `📎` para las líneas
> `-> Ver documento`) y descarta el pie de página de cada hoja. Nombre del `.md` derivado del MISMO
> `<exp>` que ya trae el PDF de origen (`informe_<exp>_<ISO>.pdf` → `markdown_<exp>_<ISO>.md`), sin
> reinventar una tercera normalización de expediente.
>
> **Verificado con `electron-app/test/extraerPdfAMarkdown.test.js` — 22/22 PASS:** 15 unidades
> sintéticas (reordenamiento pese a items desordenados, tolerancia de línea/jitter, escapado de `|`
> en celdas, página sin texto que corta y reabre la tabla, continuación sin fila previa que no
> explota) + 7 de integración contra un PDF **real** de informe (`informe_FCR 018745_2017_...pdf`,
> el mismo tipo de archivo que midió M0), sin PDFs sintéticos de relleno. **Confirmado manualmente**
> sobre las 4 páginas del informe real: la tabla de movimientos se reconstruye completa y una
> continuación que cruza el límite entre la página 2 y la 3 se funde correctamente en una sola fila
> (`DEO: ENVIO DEO: 2664333 - REMISIÓN DE AUTOS PRINCIPALES - JUZGADO FEDERAL DE RIO GALLEGOS -
> SECRETARIA EJECUCION FISCAL`, partida en el PDF en 2 líneas por el salto de página) — 0 páginas
> sin texto, coincide con la medición de M0 (0% en el informe propio). **Sin residuos:** los PDFs de
> prueba se leyeron de la carpeta real del operador sin modificarlos, la salida de la integración se
> escribe en un directorio temporal del sistema y se borra al final del test.
>
> **Alcance de M2 cumplido** (extracción + estructura + marcador de página sin texto). **Fuera de
> alcance a propósito, por diseño** (le corresponde a M3/M5): la descarga de los adjuntos vinculados
> por las líneas `-> Ver documento`, y cualquier wiring a `main.js`/IPC/UI — este módulo es una
> función pura que M5 invocará con `PROCURADOR_DATA_DIR/descargas` cuando exista el botón.

---

### M3 — Descarga y unificación de adjuntos 🟢 **ESCENARIO A confirmado por M0** ✅ **EJECUTADO (2026-08-26)**

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** — *bajó de "alto" al descartarse los escenarios B y C* |
| **Depende de** | ✅ M0 cerrado. **`fetch` en Node, sin Puppeteer, sin sesión, sin candado de ejecución** |

- Detección de anotaciones `Link` en el PDF principal. **Formato único y uniforme, medido:**
  `https://scw.pjn.gov.ar/scw/viewer.seam?id=<token>&tipoDoc=<despacho|cedula|deo|sentencia>`.
- 🔑 **Deduplicación en dos niveles — hallazgo de M0, no es opcional.** Los tokens **cambian en cada
  corrida** del informe (0 de 35 coinciden entre dos informes del mismo expediente) pero el documento
  es el mismo. Entonces: **dentro** de un informe se deduplica por URL; **entre** informes hay que
  usar el `filename` del `Content-Disposition` (`docNNNNNNNNN.pdf`), que sí es estable y cuyo
  contenido es byte-idéntico. Deduplicar solo por URL descarga el mismo documento una vez por informe.
- Descarga a directorio temporal seguro, con **límite explícito de cantidad y tamaño total** y
  **timeout por archivo**. **Dimensionar sobre el volumen real medido: 1–37 adjuntos por informe**
  (no sobre los 200 que este plan suponía antes de M0).
- Extracción de cada adjunto con el mismo motor de M2 y **concatenación ordenada** con separadores
  legibles (`## Anexo 3 — <nombre del documento>`), respetando el orden en que aparecen en el
  original.
- **Progreso en consola**, como pide el brief: la app ya tiene el panel de consola y el streaming
  de eventos — se reusa, no se inventa nada.
- Limpieza del temporal al terminar, **incluso ante error** (el patrón `try/finally` que el
  proyecto ya aplica en los flujos de Puppeteer).

~~**Si M0 devuelve escenario B o C:**~~ ✅ **No aplica.** M0 devolvió **escenario A**, así que el
módulo **no abre Chrome** y el candado de ejecución (`active_executions`) **nunca entra en juego**.
Se puede procesar un informe mientras corre una procuración, sin el error "proceso activo en otro
dispositivo". *(Se conserva la nota tachada porque la restricción volvería a aplicar si alguna vez se
agregara OCR vía navegador o cualquier otro camino que necesite Puppeteer.)*

> ✅ **Ejecutado y verificado 2026-08-26.** Motor nuevo en `electron-app/markdown/descargarAdjuntos.js`,
> apoyado en la capa genérica de M2 (`extraerTextoPdf`/`renderizarGenericoMarkdown`, agregada a
> `extraerPdfAMarkdown.js` para este reuso exacto). **🚨 Allowlist de host implementada desde el
> arranque, no diferida a S10 de SEC-2** — `esUrlPermitida()` exige `https:` + host exacto
> `scw.pjn.gov.ar` + path que empiece con `/scw/viewer.seam`, verificada contra 706 URLs reales
> medidas por M0 (todas con esa forma exacta). Cualquier otra cosa (localhost, IP de metadata de
> nube, `file://`, un subdominio parecido tipo typosquatting) se descarta ANTES de la primera
> petición de red — mitiga en el código el riesgo R7/SSRF que el spike de M0 y el bloque S10 de
> SEC-2 ya tenían identificado, en vez de dejarlo pendiente de auditoría.
>
> **Deduplicación en los 2 niveles que pedía el hallazgo de M0, implementados por separado y
> verificados por separado:** (1) por **URL**, dentro de la lista de links de un mismo informe
> (`deduplicarPorUrl`) — cubre el caso, aunque no típico, de que el mismo link aparezca 2 veces en
> la misma tabla de Movimientos; (2) por **`filename`** del `Content-Disposition`, a través de un
> `registro` (`Map`) que se puede compartir entre varias llamadas de `descargarAdjuntos` — cubre el
> hallazgo real de M0: dos informes del mismo expediente traen tokens (URLs) distintos para el
> MISMO documento, pero el mismo `filename` estable. Un adjunto que ya está en el registro se
> **borra la copia recién bajada** y se reusa el Markdown ya extraído, sin descargar dos veces el
> mismo documento entre informes de una misma sesión de procesamiento (el caso de uso que M0/P3
> dejó previsto: "agrupar por expediente").
>
> **Límites dimensionados sobre el volumen REAL medido, no estimado:** tope de 100 adjuntos por
> informe (frente al máximo medido de 37), 20 MB por adjunto y 200 MB totales por corrida — el SCW
> **no manda `Content-Length`** (confirmado con una descarga real efímera antes de escribir código),
> así que el tope se aplica **durante** la descarga, leyendo el stream de a chunks, no antes de
> empezar. Timeout de 30s por adjunto con `AbortController`. Limpieza del directorio temporal en
> `finally`, incluso si algo falla a mitad de la descarga o la extracción.
>
> **Verificado con `electron-app/test/descargarAdjuntos.test.js` — 22/22 PASS:** 8 unidades de la
> allowlist (incluye SSRF a `127.0.0.1`/`169.254.169.254`, `file://` y typosquatting) · dedup por
> URL sintética · 5 unidades con `fetch` **mockeado** (sin red) para el registro por `filename`, el
> tope de tamaño, que un fallo puntual no aborta el lote, y los eventos de `onProgress` · **6 de
> integración real contra el SCW real** (extracción de links de un PDF real, 0 descartados por
> allowlist, descarga real de una muestra, magic bytes `%PDF-` confirmados, extracción a Markdown
> con encabezados `## Anexo N` numerados). **Hallazgo real, no un bug, que la muestra chica dejó
> ver:** uno de los adjuntos reales descargados es un documento **genuinamente escaneado de 30
> páginas** (1,2 MB, 0% de texto en las 30) — el primer caso real donde el marcador de "página sin
> texto" de M2 se ejerció sobre datos reales (el informe propio dio 0% de páginas sin texto, así que
> M2 solo nunca lo había visto en vivo). Confirma en producción real el 14,6% medido por M0 sobre
> los adjuntos del SCW.
>
> **Deliberadamente NO se probó la descarga real de los 35 adjuntos completos** en la corrida
> estándar del test (solo una muestra de 1-2) — no golpear el servidor real de más en cada corrida
> de este test. El test soporta `--full` para la corrida completa cuando haga falta (opt-in, no
> default). **Sin residuos:** los adjuntos descargados se leen a un directorio temporal del sistema
> y se borran al terminar cada test.

---

### M4 — Motor de anonimización + `mapping.txt` 🔴 **Opus** ✅ **EJECUTADO (2026-08-26)**

| | |
|---|---|
| **Modelo / esfuerzo** | **Opus · alto** |
| **Depende de** | M2 |

**Por qué Opus** (es la única parte del módulo que lo lleva): el usuario va a **confiar** en el
archivo anonimizado y lo va a compartir. Un nombre que el motor no detecta **no produce ningún
error visible** — produce una fuga que se descubre después de haber mandado el archivo. Es el perfil
exacto de "bug silencioso con alto radio de impacto".

Las 3 reglas por defecto del brief, con lo que cada una esconde:

| Regla | Lo que parece | Lo que hay que resolver de verdad |
|---|---|---|
| **Expediente** → `Expediente` | Un regex sobre `FCR 18745/2017` | El mismo expediente aparece **con y sin padding de ceros** (`018745` vs `18745`) y con jurisdicción o sin ella. Ya existe la normalización canónica del proyecto — **reusar `expedienteKey()`/`tokenizar()`, no escribir una tercera implementación** (el fixture `tests/fixtures/expediente-key-cases.json` existe justamente para eso) |
| **Partes** → `Actor` / `Demandado` | Leer la carátula y reemplazar | Las carátulas tienen forma `X C/ Y S/TIPO DE PROCESO`, pero también `X Y C/ Z`, siglas (`A.F.I.P.`, con y sin puntos), y el nombre de la parte aparece después **abreviado o parcial** en el cuerpo. Un reemplazo literal de la carátula deja pasar la mitad de las menciones |
| **Terceros** → `Jon### And### Ber###` | Regex de nombres propios | Es el caso difícil: acentos, apellidos con partículas (`de la Fuente`), nombres compuestos, MAYÚSCULAS (el PJN escribe casi todo en mayúsculas), y **falsos positivos** — `JUZGADO FEDERAL DE CALETA OLIVIA` no es una persona |
| 🚨 **Enlaces al SCW** → *(ver abajo)* | *No estaba en el brief ni en este plan* | **Regla 4, agregada por M0.** Los `viewer.seam` del informe abren el documento original **sin autenticación** y sus tokens **no expiran** (≥27 días medidos). Un `.md` con los nombres enmascarados y los enlaces vivos **entrega el original sin anonimizar** |

**🚨 La regla 4, en detalle — ✅ DECIDIDO por el operador (2026-08-26): opción A.** Es el hallazgo de
M0 (§4 del spike) y es el que más barato sale de verificar y más caro sale de omitir: anonimizar el
texto y dejar el link vivo produce un archivo que *parece* anonimizado y no lo está.

| Opción | Qué hace con el enlace **en la versión anonimizada** | Costo |
|---|---|---|
| **A — eliminar** ✅ **elegida** | Queda el texto, se borra la URL: `[Despacho 12/03/2026]` | Trivial |
| ~~B — referencia local~~ | ~~Apunta al adjunto ya descargado y anonimizado~~ | *(no se implementa: no hace falta mantener la carpeta `anexos/` sincronizada con el `.md` al moverlo o compartirlo)* |
| ~~C — dejar la URL~~ | ~~Tal cual viene del informe~~ | *(descartada: rompe la promesa del módulo)* |

**M4 implementa la opción A: en la versión anonimizada, todo enlace `viewer.seam` se elimina y solo
queda el texto del anexo** (`[Despacho 12/03/2026]`, sin `[...](url)`). Se pierde la trazabilidad al
original desde el `.md` anonimizado — es aceptado, porque la versión **no anonimizada** sí conserva
las URLs intactas (es para uso propio del abogado, no para compartir) y ahí no hay problema.
La verificación es binaria y va en el bloque **S10** de SEC-2: *un `.md` anonimizado no debe contener
ninguna URL de `viewer.seam`*.

**Tres decisiones de diseño que hay que tomar antes de escribir el motor:**

1. **Orden de aplicación.** Expediente → Partes → Terceros, y **siempre partiendo del texto
   original**. Si Terceros corre primero, puede enmascarar el nombre de la parte antes de que la
   regla de Partes lo encuentre.
2. **Reprocesamiento idempotente.** El botón "reprocesar" de la Solapa 2 debe aplicar el mapping
   sobre el **Markdown original guardado en memoria**, nunca sobre el ya anonimizado. Aplicar dos
   veces produce `Jon###### ` y el usuario no entiende qué pasó.
3. **Sesgo hacia el falso positivo.** Ante la duda, enmascarar de más. Es corregible desde la
   Solapa 2 (el usuario edita el mapping y reprocesa); un falso **negativo** no se corrige porque
   nadie lo ve.

**Y una regla de producto que debe quedar escrita en la UI y en los TyC (Etapa 1.3):**

> La anonimización es una ayuda automática, **no una garantía**. El usuario es responsable de
> revisar el resultado antes de compartirlo.

Sin esa leyenda, el módulo promete algo que ningún motor de regex puede cumplir en documentos
judiciales reales.

> ✅ **Ejecutado y verificado 2026-08-26** — `electron-app/markdown/anonimizar.js` + corpus
> adversarial en `electron-app/test/anonimizar.test.js`. **39/39 PASS · tasa de falsos negativos
> 0,0% (18/18) · tasa de sobre-enmascarado 0,0% (8/8)**, medidas y reportadas como número, que es
> lo que pedían §M4 y el bloque S10 de SEC-2.
>
> **Antes de escribir una sola regla se miraron los 4 expedientes reales del operador**, y eso
> cambió el diseño respecto de lo que este plan anticipaba. Lo que apareció en los datos:
> · las 4 carátulas tienen formas distintas (persona física con coma, empresa con nombre de
> persona adentro, razón social escrita completa, `S.A` sin punto) · la parte figura **con coma en
> la carátula y sin coma en el cuerpo** (`PARDO MONTOYA, SHIRLEY LICET` vs `PARDO MONTOYA SHIRLEY
> LICET`) · hay una sección **"Intervinientes"** con roles explícitos que el plan no mencionaba,
> con **CUIT pelados de 11 dígitos sin guiones ni etiqueta** (`20223670785` — buscar la palabra
> "CUIT" no alcanza) · y el mismo letrado aparece completo en Intervinientes (`DAMIAN HORACIO ISLA
> MATA`) y abreviado en un movimiento (`DR. ISLA MATA`).
>
> **4 decisiones de diseño que la evidencia impuso, además de las 3 que el plan ya listaba:**
> **(a) el orden de aplicación es por LONGITUD DESCENDENTE** — si el término corto se aplicara
> primero, `DAMIAN HORACIO ISLA MATA` quedaría `DAMIAN HORACIO Isl### Mat###`: mitad enmascarado,
> mitad expuesto. **(b) Las variantes de un nombre se generan pero se VERIFICAN contra el texto**,
> y solo sobreviven si aparecen **más veces que el nombre completo** (o sea, tienen menciones
> independientes). **(c) El motor NO barre "toda secuencia de mayúsculas"** — en un documento del
> PJN casi todo está en mayúsculas y ese barrido enmascararía `JUZGADO FEDERAL DE RIO GALLEGOS`,
> volviendo el archivo ilegible; el sesgo al falso positivo se aplica *dentro* de lo que es
> plausiblemente un nombre de persona, no sobre el documento entero. **(d) La detección de terceros
> es por marcador de rol** (`DR.`, `LETRADO APODERADO`, `DESTINATARIO:`…) con corte ante la primera
> palabra procesal — sin ese corte, el caso real `DR. ISLA MATA POR PRESENTADO` daba el "nombre"
> `ISLA MATA POR PRESENTADO`.
>
> **🚨 2 defectos reales encontrados LEYENDO A MANO la salida, que ningún test había cazado** — y
> son la razón por la que este bloque llevaba Opus:
>
> 1. **Variantes basura con riesgo de sobre-enmascarado.** El criterio inicial ("la variante sirve
>    si aparece en el texto") generaba `AGUA DEL`, `DEL CAMPO` y **`DE RESPONSABILIDAD`** a partir
>    de una razón social larga — todo sub-fragmento de un nombre aparece siempre, porque el nombre
>    completo está ahí. `DE RESPONSABILIDAD = Demandado` habría reemplazado esa frase en **cualquier
>    otro contexto** del documento. Corregido con la regla de menciones independientes (b).
> 2. **🚨 FUGA REAL: un nombre partido por el salto de línea de la cita.** El PDF envuelve la
>    carátula por ancho, así que en el `.md` el nombre queda cortado con un `\n> ` en el medio. El
>    término completo no matcheaba y el resultado era `> Actor c/ Demandado` / `> LICET s/…` — **con
>    el segundo nombre de la demandada expuesto en el archivo "anonimizado"**. Lo más instructivo:
>    **el test de integración tampoco lo detectaba, porque comparaba con el mismo criterio ciego que
>    tenía el motor**. Se corrigieron los dos (se agregó `>` a los separadores tolerados, dejando el
>    guion afuera para que `-> Ver documento` no pueda unir tokens) y se sumaron 2 casos al corpus:
>    el del nombre partido y uno que vigila que el `>` no habilite matches a través de celdas de
>    tabla.
>
> **Verificado además sobre los 4 informes reales completos:** 0 ocurrencias de cualquier nombre,
> razón social o CUIT real en los `.md` anonimizados, con la estructura del documento intacta y las
> instituciones (`JUZGADO FEDERAL DE RIO GALLEGOS`, `I.E.J. UNIDAD FISCAL RIO GALLEGOS`) sin tocar.
> La **regla 4** (enlaces al SCW) está implementada como defensa en profundidad: hoy M2 no emite
> URLs, pero si M5 decidiera incluirlas en la versión completa, la anonimizada ya las elimina.
>
> **⚠️ Limitación conocida, documentada y NO corregida a propósito:** el número de boleta de deuda
> del actor (`(BD 7570/10/2017)`) sobrevive en la carátula anonimizada. Se quita del *nombre* del
> actor al parsear, pero no se enmascara en el texto. No es un dato personal directo (no identifica
> a una persona sin acceso al sistema de ARCA) y agregar una regla especulativa es justamente lo
> que produce sobre-enmascarado — el usuario que lo quiera oculto agrega una línea al `mapping.txt`.
> Candidato a revisar en **S10 de SEC-2**, con criterio de privacidad, no de implementación.

---

### M5 — UI: modal de 2 solapas + botón en el topbar 🟡 ✅ **EJECUTADO (2026-08-26)**

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **alto** |
| **Depende de** | M1 (para el gating), M2–M4 (para tener qué mostrar) |

- **Botón en el topbar**, al lado de 📔 Bitácora. **Arranca oculto en el HTML** y lo muestra
  `updateUserChip()` leyendo `account.markdownEnabled` — copia literal de lo que hizo F2.7.
- **Solapa 1 — Procesamiento:** drag & drop / explorador, progreso de descarga y parsing,
  resultado con los 3 archivos y botón para abrir la carpeta.
- **Solapa 2 — Editor de mapeo:** `<textarea>` con las equivalencias, botón de reprocesar en
  memoria (sin releer disco, como pide el brief).
- **Sistema de diseño de la app** — ámbar/Inter, primitivas existentes. No inventar componentes:
  el hallazgo #11 del plan de fixes de Bitácora fue exactamente "el modal no respeta el sistema de
  diseño", y no conviene repetirlo en un módulo nuevo.

**⚠️ Trampa conocida del tour de onboarding, ya pagada una vez:** si se agrega un paso al tour para
este botón, **extender el paso existente con `targets: [...]`, no crear un paso nuevo con `target:`
singular**. El motor del tour ignora elementos de tamaño cero dentro de un `targets` array, pero un
`target` singular oculto devuelve un rect `{0,0}` en vez de `null` → el spotlight apunta a la
esquina superior izquierda para el 100% de los usuarios que no tengan el flag. Está documentado en
la sesión de F2.7.

> ✅ **Ejecutado y verificado 2026-08-26.** Botón `#btnTopbarMarkdown` junto a Bitácora, mismo
> patrón (oculto en el HTML, `updateUserChip()` lo muestra con `account.markdownEnabled`). Modal
> `#modalMarkdown` con 2 solapas (`cuenta-tabs`, mismo componente que ya usa el modal de Informe) —
> **Procesar** (drag&drop vía `webUtils.getPathForFile()` + selector nativo, log de progreso,
> resultado con botones para abrir cada uno de los 3 archivos y la carpeta) y **Editor de mapeo**
> (`<textarea>` precargado con el `mapping.txt`, botón "Reprocesar"). **3 IPC handlers nuevos en
> `main.js`** (`select-markdown-pdf`, `procesar-markdown-pdf`, `reprocesar-markdown-mapping`), con
> **defensa en profundidad**: el handler vuelve a consultar `account.markdownEnabled` server-side
> antes de procesar, no confía en que el botón esté oculto (mismo criterio que el gate de checkout
> de Bitácora). **Reusa sin tocar** `resolveUserDescargasDir()` (carpeta por CUIT, D6) y los
> handlers `open-file`/`open-downloads-folder` que ya existían — cero código nuevo para esas dos
> cosas. Los 3 archivos de salida comparten el mismo "stem" (`markdown_<exp>_<ISO>` /
> `.anonimizado.md` / `.mapping.txt`) para quedar agrupados al ordenar la carpeta. **El
> reprocesamiento es realmente en memoria**: `markdownCompleto` viaja desde el renderer (guardado
> ahí tras el primer procesamiento) en cada llamada a `reprocesar-markdown-mapping`, sin releer el
> PDF ni volver a descargar adjuntos — un fallo de M3 (adjuntos) tampoco aborta el flujo completo,
> el informe principal de M2 sigue siendo un resultado útil por sí solo.
>
> **Verificado con un test nuevo** (`electron-app/test/procesarMarkdownPipeline.test.js`, 11/11)
> que reproduce la MISMA orquestación que hace el handler de `main.js` — la combinación M2+M3+M4
> que ningún test de los bloques individuales había ejercitado: los 3 archivos comparten el stem
> correcto, el completo y el anonimizado difieren, el anonimizado no lleva URLs del SCW, el
> reprocesamiento sin cambios da el mismo resultado (idempotente), y el caso sin adjuntos (sin
> links en el PDF) no rompe nada. **Suite completa del módulo: 94/94 PASS** (22+22+39+11). `npm
> start` arranca limpio con los 3 módulos de `markdown/` requeridos top-level en `main.js` y
> `webUtils` agregado a `preload.js`. Balance de tags del HTML y llaves del CSS verificado
> programáticamente (24/24 divs del modal, 0 de diferencia en `styles.css`).
>
> **Sin verificación visual en pantalla** (este entorno no tiene handle de escritorio para Electron
> — mismo bloqueo documentado en la campaña `/verify`, ver `plan-verificacion-runtime-2026-08-23.md`
> §0) — pendiente la primera vez que se abra la app real, antes o junto con el release.
>
> **Con esto, el módulo Markdown queda completo (M1-M5). Falta M6** (tarjeta en la landing + TyC,
> se ejecuta dentro de la Etapa 1.3) y **un release de Electron** para que llegue a producción.

**📋 Tarea concreta de M5, agregada 2026-08-26 (antes de cortar el release de Electron):**
extender el **paso 2 de 14** de `electron-app/onboarding/tour.js` — el mismo paso que ya agrupa
`.tab-nav` + `#btnTopbarBitacora` — sumando el botón de Markdown al array `targets`:

```js
targets: ['.tab-nav', '#btnTopbarBitacora', '#btnTopbarMarkdown'],  // (o el id real que use M5)
```

Y un tercer párrafo en el `text` del paso, con el mismo patrón condicional que ya usa Bitácora
("Si tu plan incluye..."). **El texto tiene que decir explícitamente 3 cosas** — es la aclaración
que pidió el operador y que ningún otro lugar del producto dice todavía:

1. Que el módulo genera **archivos `.md`** (no un visor ni un PDF).
2. Que produce **dos versiones**: una completa y una **anonimizada**.
3. Que el `.md` anonimizado está pensado para **pegarlo en el chat de la IA que el usuario ya usa**
   (ChatGPT, Claude, Gemini, etc.) — sin exponer nombres de partes ni datos de terceros.

Borrador de texto (ajustar tono al del resto del tour):

> Si tu plan incluye el módulo **📝 Markdown**, vas a ver otro botón ahí mismo que convierte un
> informe en dos archivos `.md`: uno completo para vos, y uno **anonimizado** — listo para pegar en
> el chat de tu IA preferida (ChatGPT, Claude, etc.) sin exponer los datos de las partes.

Sin esto, un usuario nuevo con el flag encendido ve el botón pero no entiende **para qué sirve el
archivo que le entrega** — el tour es el único lugar del producto que explica flujos, y hoy
terminaría de construirse (M2-M4) sin que el tour lo mencione en absoluto.

**📋 Segunda tarea concreta de M5, agregada 2026-08-26 (mismo pedido del operador):** la **Ayuda**
de la app (`electron-app/renderer.js`, array `FAQ_ITEMS`/`FAQ_CATS`) y del portal
(`backend-server/public/usuarios/app.js`, `AYUDA_FAQ_ITEMS`/`AYUDA_FAQ_CATS`) tienen que sumar una
categoría **`markdown`** — y el **system prompt único del asistente de IA**
(`backend-server/utils/aiSupportPrompt.js`, compartido por el chat de Electron y el del portal) debe
incorporar el módulo en su sección "Qué hace el producto" y sus resoluciones comunes.

🚨 **Aclaración obligatoria en las 3 superficies, la que pidió explícitamente el operador:** el
motor **NO procesa imágenes, solo texto extraíble**. Las páginas escaneadas (sin capa de texto)
quedan marcadas con un aviso (`> [Página N — imagen sin texto extraíble]`), **no se transcriben**
— sin OCR en esta versión (decisión de diseño de M2, confirmada por M0: el 14,6% de páginas de los
adjuntos reales no tienen texto). Sin esta aclaración, un usuario que suba un expediente con
escaneos va a creer que el módulo "se comió" contenido, cuando en realidad nunca prometió leerlo.

Borrador de entradas de FAQ (categoría `markdown`, mismo tono que las existentes):

- *"¿Qué hace el módulo Markdown?"* → "Convierte un informe PDF ya generado en dos archivos `.md`
  (texto plano): uno completo y uno **anonimizado** (nombres de partes y terceros enmascarados),
  listo para pegar en el chat de tu IA preferida sin exponer datos de terceros."
- *"¿El módulo lee escaneos o imágenes dentro del PDF?"* → "No. Solo extrae texto que ya está en el
  PDF como texto (no como imagen). Las páginas escaneadas o los sellos de firma digital sobre una
  imagen quedan marcados como '[imagen sin texto extraíble]', no se transcriben — no hay OCR en
  esta versión."
- *"¿La anonimización es 100% segura?"* → "Es una ayuda automática, no una garantía. Revisá siempre
  el resultado antes de compartirlo — podés editar el diccionario de reemplazos y reprocesar."
- *"¿El contenido del expediente sale de mi computadora?"* → "No. Todo el procesamiento es local:
  ni el PDF, ni el Markdown, ni el mapping se envían al servidor. Solo se consulta si tu plan
  incluye el módulo."

Y para `aiSupportPrompt.js`, un bullet nuevo en "Qué hace el producto" (mismo formato que los
existentes de Procuración/Informe/Monitor) más una entrada en "Cómo resolver los problemas más
comunes" cubriendo exactamente la misma aclaración de "no lee imágenes, sin OCR".

**Nota aparte, y más urgente que Markdown porque ya está en producción:** Bitácora (F1-F3.4)
**tampoco tiene ninguna entrada** en las 3 superficies de ayuda de hoy — ver el pendiente agregado
en `propuesta-bitacora-agenda-2026-07.md` §11.2. Documentar los dos módulos juntos en la misma
sesión de M5 evita 2 pasadas separadas sobre los mismos 3 archivos.

> ✅ **Ejecutado 2026-08-26** — las 2 tareas de documentación se resolvieron junto con el resto de
> M5. **Tour:** paso 2/14 extendido con `targets: [..., '#btnTopbarMarkdown']` + tercer párrafo con
> el texto acordado. **Ayuda/FAQ, las 3 superficies, para los 2 módulos a la vez** (P-AYUDA-1 de
> Bitácora + Markdown, mismo pase): `electron-app/renderer.js` (`FAQ_ITEMS`/`FAQ_CATS`, +11
> preguntas, 2 categorías nuevas) · `backend-server/public/usuarios/app.js`
> (`AYUDA_FAQ_ITEMS`/`AYUDA_FAQ_CATS`, mismo contenido) · `backend-server/utils/aiSupportPrompt.js`
> (bullets en "Qué hace el producto" y 3 entradas nuevas en "Cómo resolver los problemas más
> comunes", incluida la aclaración explícita de "no hace OCR, solo texto"). **P-AYUDA-1 queda
> cerrado.**

---

### M6 — Landing + TyC 🟢

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **bajo** |
| **Depende de** | alcance final de M2–M4 congelado |

El brief lo pide explícitamente: *"esta funcionalidad deberá informarse en la landing page"*.
**Se ejecuta como parte de la Etapa 1.3 del roadmap** (actualización de landing + TyC), no como una
tarea suelta — porque el mismo cambio de TyC tiene que cubrir Bitácora, extensión y el aviso de
beta. Ver el roadmap.

Lo mínimo que este módulo aporta a ese cambio:
- Tarjeta nueva en la sección "Funciones" de la landing.
- Línea en el plan que lo incluya.
- **Cláusula de TyC** con la leyenda de "no es garantía" de arriba + responsabilidad del usuario
  sobre el resultado.

---

## 4. Orden y dependencias

```
   M0 ✅ CERRADO ─┬──► M2 ──┬──► M4 (Opus) ──┐
   (escenario A)  │         │                │
                  └──► M3 ──┘                ├──► M5 ──► M6 ──► release Electron
                     (fetch)                 │
   M1 (backend, en paralelo) ────────────────┘
```

- ✅ **M0 está cerrado** ([spike](spike-markdown-M0-2026-08-26.md)). **El arranque es M1**, que además
  se puede desplegar de inmediato sin release y en paralelo con todo lo demás.
- **M1 puede desplegarse solo**, sin release y sin que nadie lo note.
- **M2, M3 y M4 no tienen UI**: se desarrollan y prueban con harness de línea de comandos contra
  PDFs reales del operador. Eso es deliberado — el proyecto ya aprendió (F3.0 de Bitácora) que
  construir 15 sub-bloques sin ejercitarlos deja bugs latentes; acá cada motor se prueba contra un
  archivo real desde el primer día.
- **Un solo release de Electron al final**, cuando M5 esté cerrado. Igual que la Fase 2 de Bitácora.

---

## 5. Riesgos, ordenados por lo que cuestan

| # | Riesgo | Probabilidad | Mitigación |
|---|---|---|---|
| ~~**R1**~~ | ~~Los adjuntos requieren sesión autenticada (escenario B/C)~~ | ✅ **DESCARTADO por M0** | Escenario **A**: 12/12 descargas sin cookies con `HTTP 200`. `fetch` en Node y listo |
| **R2** | El motor de anonimización deja pasar nombres | **Alta** (es inherente) | Sesgo al falso positivo + Solapa 2 editable + leyenda de "no es garantía" + **F5 del code-review en Opus** + **S10 de SEC-2** (corpus adversarial con tasa de falsos negativos medida) |
| **R3** | ~~Buena parte de los adjuntos son escaneos sin texto~~ → **medido: 14,6 %** | ✅ **Baja** (era "Media") | M0 midió **0 %** de páginas sin texto en el informe y **14,6 %** en los adjuntos (la mayoría son híbridos: imagen de sello + capa de texto). Marcador descriptivo, **sin OCR en v1** |
| **R7** 🆕 | **El `.md` anonimizado conserva enlaces que abren el original sin login** | **Alta si no se trata** | Hallazgo de M0. Regla 4 del motor (M4) + verificación binaria en S10. **Es el riesgo que convierte la anonimización en teatro** |
| **R4** | `pdfjs-dist` altera el árbol de dependencias de Electron | Baja | Install quirúrgico + diff del lockfile. Antecedente real del 2026-07-25 |
| **R5** | Un informe con muchos adjuntos cuelga la app | Media | Límite de cantidad/tamaño + timeout por archivo + progreso en consola cancelable |
| **R6** | El usuario cree que el `.md` anonimizado es seguro para publicar | **Alta** | Leyenda en UI **y** en TyC. Es un riesgo legal, no técnico |

---

## 6. Lo que este módulo NO hace (v1)

- **No hace OCR.** Las páginas-imagen se marcan, no se transcriben.
- **No reconoce entidades con IA.** El motor es determinístico (regex + carátula). Un modelo daría
  mejor detección de nombres, pero implicaría **mandar el expediente a un servidor** — y eso está
  descartado por §1. Si alguna vez se quiere, tendría que ser un modelo local y es otro proyecto.
- **No firma ni certifica** el documento anonimizado.
- **No procesa PDFs que no vengan del flujo de informe** de la app (puede intentarlo, pero no es el
  caso de uso soportado ni el que se prueba).

---

## 7. Prompt de arranque

> Ejecutá el bloque **M0** de `docs/internal/plan-modulo-markdown-anonimizacion-2026-08-26.md` —
> spike de viabilidad. **Sonnet, esfuerzo medio.** Es solo investigación: no escribas código de
> producto. Necesitás un informe PDF real generado por la app (pedíselo al operador o buscalo en
> `%APPDATA%\procurador-electron\usuarios\<CUIT>\descargas\informe_*.pdf`). Respondé las 3 preguntas
> con evidencia ejecutada, no con lectura de código, y dejá el resultado en
> `docs/internal/spike-markdown-M0-<fecha>.md`. **La pregunta 2 es la que define el tamaño del
> módulo** — no la despaches por lectura.
