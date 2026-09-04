# Propuesta — el snapshot de informe guarda solo movimientos actuales

> ✅ **ESTADO: CERRADA — F1, F2, F3 y F4 hechas. En producción y verificada con datos reales.**
> Release `electron-v2.7.58` + backend en staging y producción. Corrida real del operador el
> 2026-09-04 23:05: snapshot **46** con las 6 secciones pobladas. Detalle en §10.
> Diagnóstico hecho el 2026-09-04 contra los backups reales de corridas del operador y el código real.
> Implementada por un agente independiente; el corte por tamaño lo corregí yo después (§9).
> Continuación de [`propuesta-fix-snapshot-informe-bitacora-2026-09-04.md`](propuesta-fix-snapshot-informe-bitacora-2026-09-04.md),
> que arregló el bug de fondo (el snapshot nacía vacío). Esto **extiende** esa función.

---

## 1. Lo que pidió el operador

Al guardar un informe en Bitácora hoy se conservan **hasta 15 movimientos actuales** y nada más.
Pedido: guardar **hasta 15 de cada sección** que el informe tenga —históricos, intervinientes,
vinculados, recursos, notas—; si hay menos, se guardan los que haya; si hay más, se recorta a 15.

---

## 2. Lo que hay hoy, medido

`campoDeCaso()` del visor manda exactamente 4 campos con contenido: `exp` · `car` · `movs` · `pdf`.
Las otras 5 secciones **nunca salen del disco del usuario**, aunque el script las haya extraído.

**Buena noticia, verificada en disco:** el script **ya persiste las 7 secciones** como backup, no solo
los movimientos. Confirmado en `<*_temp>/<expediente>_backup/` de corridas reales del operador:

| Corrida real | Archivos de backup presentes |
|---|---|
| `FCR 751/2025` (13/08) | `datosGenerales` · `listaMovimientos` · `listaMovimientosHistoricos` · `intervinientes` · `vinculados` · `recursos` · `notas` |
| `FCR 9391/2018` (12/08) | `datosGenerales` · `listaMovimientos` · `listaMovimientosHistoricos` |
| `FCR 18745/2017` (04/09, la de ayer) | `datosGenerales` · `listaMovimientos` |

**Lo que esa tabla dice, y condiciona todo el diseño:** el backup de cada sección existe **solo si el
usuario la tildó** al generar el informe. La corrida de ayer no tiene intervinientes porque no se
tildó, no porque el script falle. El módulo tiene que tratar la ausencia como normal y devolver
lista vacía, nunca como error — igual que ya hace `leerMovimientosInforme`.

---

## 3. Los 3 hallazgos que cambian el diseño

### 3.1 🚨 Las secciones NO son homogéneas — 2 de ellas son texto crudo

Solo **históricos** tiene la misma forma que los movimientos actuales, así que esa es trivial:

```jsonc
// listaMovimientosHistoricos.json — mismos campos que los actuales
{ "fecha": "30/11/2018", "tipo": "CAMBIO DE ESTADO DE EXPEDIENTE", "detalle": "CONFRONTE OFICIO", ... }
```

**`intervinientes`, `vinculados`, `recursos` y `notas` son `string[]`**, con el texto de la tabla del
PJN sin parsear — separador `|` y saltos de línea embebidos:

```jsonc
// intervinientes.json — real, de FCR 751/2025
[
  "TIPO|NOMBRE|TOMO/FOLIO :\nTOMO/FOLIO|I.E.J. :\nI.E.J.",   // ← fila de ENCABEZADO
  "TIPO :\nDEMANDADO|NOMBRE :\nAGUA DEL CAMPO SOCIEDAD ...",
  "", "", "",                                                  // ← filas VACÍAS
  "LETRADO APODERADO|DAMIAN HORACIO ISLA MATA|Tomo: 111 ...",
  ...                                                          // ← y TODO se repite una 2ª vez
]
```

Guardar los primeros 15 tal cual daría un listado donde la mayoría son encabezados, vacíos y
duplicados. **Medido: 26 entradas crudas → 5 reales.**

### 3.2 ✅ La limpieza ya existe y es reusable — no hay que diseñarla

`testM2.js:2156-2177` ya resuelve exactamente esto para armar el PDF: quita filas vacías, descarta
la fila de encabezado, saca el prefijo `TIPO :` y **deduplica con `new Set`**. Es JS puro, sin
Puppeteer ni dependencias — se puede replicar tal cual.

> ⚠️ **Esa función vive en un script encriptado**, así que el módulo de Electron no puede importarla:
> hay que **duplicar la lógica**. El proyecto ya documenta 2 veces que duplicar causó bugs reales
> (la búsqueda de PDF en `generador_visor`/`generador_excel`, y `VERIF_FLUJOS_ORDEN`). La alternativa
> —hacer que el script guarde los intervinientes ya limpios— exige tocar zona de scripts cifrados
> (`scp` + `reencrypt` + `pm2 restart`, con dry-run del ofuscador por E9), que es el riesgo operativo
> más alto del proyecto. **Recomendación: duplicar, con un comentario que apunte a `testM2.js:2156`
> como fuente**, y cubrirlo con un test que use el fixture real.

### 3.3 🚨 Las secciones vacías traen un mensaje, no un array vacío

```jsonc
"vinculados.json":  ["El expediente no posee vinculados posibles de ser visualizados."]
"recursos.json":    ["El expediente no posee recursos"]
"notas.json":       ["El expediente no posee notas"]
"listaMovimientosHistoricos.json": [{ "tipo": "info", "detalle": "El expediente no posee actuaciones históricas." }]
```

Sin detectarlos, el modal mostraría **"Recursos (1): El expediente no posee recursos"** — peor que no
mostrar nada, porque parece contenido. Hay que reconocer el centinela y guardar `[]`, para que el
modal diga "Sin recursos".

---

## 4. 🚨 El límite de tamaño — y un bug preexistente que este cambio destapa

El borrador de captura se rechaza entero si supera **256 KB** (`MAX_DRAFT_BYTES`, `captureDrafts.js`)
→ el usuario ve `captura=lote_grande` y **no se guarda nada**.

Medido con los fixtures reales (payload de captura, UTF-8, 15 items por sección):

| | bytes por caso | |
|---|---|---|
| Hoy (actuales + pdf) | **1.904 B** | |
| Propuesto (6 secciones) | **3.941 B** | **×2,1** |

Contra el cap de 256 KB:

| Lote | Hoy | Propuesto |
|---|---|---|
| 30 casos | 57 KB ✅ | 118 KB ✅ |
| 50 casos | 95 KB ✅ | 197 KB ✅ |
| 100 casos | 190 KB ✅ | 394 KB ❌ **rechaza** |
| 200 casos | **381 KB ❌ rechaza** | 788 KB ❌ rechaza |

> 🚨 **Hallazgo preexistente, no causado por este cambio:** `MAX_CASOS_LOTE = 200` (declarado en
> `capture.js` **y** `bitacora.js`), pero **hoy solo entran 137 casos**. El comentario del código
> afirma *"un lote real (200 casos × 15 movimientos) mide menos de 200 KB"* — **medido, mide 381 KB**.
> O sea: **una captura por lote de más de 137 casos ya se rechaza hoy**, pese a que el sistema declara
> aceptar 200. Con la propuesta, ese techo real baja a **66**.

**Esto hay que resolverlo sí o sí**, o la feature convierte un lote grande que hoy funciona en uno
que se rechaza. Opciones:

| | Qué hace | Riesgo |
|---|---|---|
| **A** | Mandar las secciones extra **solo si el lote es chico** (≤ 50 casos); con más, se manda como hoy | **Ninguno.** No toca caps ni memoria del servidor |
| **B** | Subir `MAX_DRAFT_BYTES` | Toca el presupuesto de memoria del servidor. `MAX_TOTAL_BYTES` es 16 MB para 100 borradores → subir el de a uno obliga a revisar el global y el desalojo FIFO |
| **C** | Bajar el tope de items por sección cuando el lote es grande | Silencioso: el usuario no sabe por qué un lote trae menos detalle |
| **D** | Corregir `MAX_CASOS_LOTE` 200 → el valor real | **Independiente y recomendable igual**: corrige el desajuste que ya existe hoy |

### Recomendación: **A + D**

**A** porque el caso de uso real es *"quiero el detalle completo de este expediente"*, no de 200 a la
vez — y el umbral se puede documentar en el visor. **D** porque el desajuste 200 vs 137 es un bug
vivo hoy, independiente de esta feature, y arreglarlo acá cuesta una constante.

---

## 5. La cadena a tocar — 7 eslabones, los mismos del fix original

```
backup en disco (7 archivos .json)        ← ya existe, no se toca
  ↓
electron-app/informe/movimientosInforme.js  ← lee 1 archivo → debe leer 6
  ↓
electron-app/main.js                        ← 2 call sites (individual y lote)
  ↓
electron-app/informe/generador_visor.js     ← prepararDatos() propaga a DATOS_BATCH
  ↓
electron-app/informe/visor_informes_template.html  ← campoDeCaso() arma el POST
  ↓
backend-server/routes/capture.js            ← normalizarCaso(): hoy solo `movs` y `pdf`
  ↓
backend-server/routes/bitacora.js           ← arma el JSON del snapshot
  ↓
backend-server/public/usuarios/app.js       ← renderMexpSnapshot(): hoy es plano
```

**El modal del portal es el eslabón con más trabajo de diseño.** Hoy renderiza una lista plana de
movimientos. Con 6 secciones necesita agrupar por título y colapsar las vacías, o se vuelve
ilegible. Es la única parte que no es mecánica.

---

## 6. Plan de ejecución (para el agente independiente)

### F0 — Confirmar antes de tocar nada
- Releer los backups reales citados acá (`FCR 751/2025` tiene las 7 secciones, `FCR 9391/2018` tiene
  históricos con contenido real). **Son el fixture: no fabricar datos sintéticos para lo que ya
  existe medido.**
- Confirmar que la limpieza de `testM2.js:2156-2177` produce 5 entradas sobre las 26 crudas.
- **Gate:** si alguna sección resulta tener una forma distinta a la documentada acá, **parar y
  reportar** en vez de improvisar un normalizador.

### F1 — Implementación
- `movimientosInforme.js`: leer las 6 secciones. Un normalizador por forma (objetos vs `string[]`),
  detección de centinelas de sección vacía, limpieza+dedup de intervinientes, tope de 15 por sección.
  **Mantener la garantía actual: nunca lanza, ante cualquier problema devuelve `[]`.**
- Propagar por los 7 eslabones. En `capture.js`, las secciones de texto necesitan un normalizador
  propio (`texto()` por elemento), no `parseMovs`.
- (A) Umbral de lote en el visor. (D) Corregir `MAX_CASOS_LOTE` en los **2** archivos.
- Modal del portal: agrupar por sección, ocultar las vacías.

### F2 — Verificación
- **Unitaria con los backups reales**, incluyendo: intervinientes 26→5 · sección ausente → `[]` ·
  centinela de vacío → `[]` (no 1 elemento) · sección con más de 15 → recorta a 15 · **control
  negativo**: si el normalizador nunca puede fallar, no prueba nada.
- **Medición de tamaño**: que un caso con las 6 secciones entre en el presupuesto, y que el umbral
  de lote elegido no permita superar 256 KB. **Con número, no con estimación.**
- Cadena completa contra staging, y **no-regresión de procuración** (sus snapshots no deben cambiar).

### F3 — Corrida real (con el operador)
Un informe real **tildando todas las secciones** (es lo que hoy nadie tildó), guardarlo a Bitácora y
confirmar en el portal. ⚠️ Consume **3 usos** de cupo — verificar y recargar antes.

### F4 — Cierre
Documentar en `CLAUDE.md` + regla de cierre de fase (sin procesos huérfanos).

---

## 7. Vector de despliegue y coste

- **Release de Electron** (los 4 archivos de cliente) + **backend** (`scp` + `pm2 restart`, sin
  migración). El portal (`app.js`) va con el backend.
- **No toca scripts cifrados** — es la decisión que mantiene esto fuera de la zona de riesgo de E9.

**Modelo/esfuerzo sugeridos:** **Sonnet, esfuerzo alto.** No toca autenticación, criptografía ni
cobro. La dificultad está en el volumen (7 eslabones) y en la heterogeneidad de las secciones —que es
donde un agente apurado inventa un normalizador genérico y rompe los intervinientes.
**Revisión Fable: no.**

---

## 8. Lo que esta propuesta NO cubre

- **`datosGenerales`** (la 7ª sección del backup) queda afuera: carátula y situación ya viajan por
  otros campos del snapshot.
- **Los adjuntos** (`viewHref`/`archivo` de cada movimiento) no se guardan — son URLs del SCW, y
  ya está decidido desde el módulo Markdown que no se incluyen en material compartible.
- **Los snapshots ya existentes** no se rellenan retroactivamente.
- **El snapshot de procuración** no cambia: el Monitor y la procuración no tienen estas secciones.

---

## 9. Resultado real (2026-09-04)

**Implementado por un agente independiente** (los 7 eslabones + 3 harnesses nuevos), commit `0d13e3f`.

### 🚨 La decisión que estaba mal en esta propuesta, y cómo se corrigió

§4 recomendaba **mandar las secciones extra solo con lotes de ≤ 50 casos**. El agente lo implementó
tal cual, lo midió, y **encontró que no cubría el peor caso**: un expediente con las 6 secciones al
tope de 15 pesa **~9,3 KB**, así que 50 iguales dan **452 KB** — por encima del cap de 256 KB. El
lote se habría rechazado entero (`captura=lote_grande`, sin guardar nada), que es exactamente lo que
el umbral existía para evitar. Lo reportó en vez de taparlo.

**El error de fondo era el criterio, no el número:** un corte por cantidad obliga a elegir un "peso
típico" por caso que no existe — medido, un caso real pesa **3,3 KB** y uno pesado **9,3 KB**, casi
3×. Cualquier constante o desperdicia capacidad en el caso normal, o se pasa del cap en el pesado.

**Corregido (commit `3df4e09`): el corte se mide en bytes.** `accionLote()` arma el lote con las
secciones, lo mide con `TextEncoder` (bytes UTF-8 reales — `.length` daría UTF-16 y subestimaría
justo los acentos que el PJN usa en todo) y, si no entra, lo rearma sin ellas. **Degrada el detalle
extra, nunca los movimientos actuales ni un caso.** Es conservador por diseño: el payload que el
servidor mide es más chico que el medido en el cliente (`normalizarCaso` re-expande los JSON
serializados y elimina los escapes), así que sobreestimar juega a favor.

**Efecto medido:** el punto de corte real con el fixture real pasa de 50 a **entre 110 y 120 casos**
— más del doble de capacidad, y sin riesgo de rechazo.

### Otras decisiones del agente que conviene conocer

- **No aplicó la limpieza de intervinientes a vinculados/recursos/notas.** Correcto: son formatos
  distintos y `testM2.js` tampoco los trata igual. Un normalizador genérico los habría roto.
- **Detectó un bug sutil antes de escribirlo:** `exps.map(campoDeCaso)` habría pasado el **índice**
  como 2º argumento (`incluirSecciones`), dejando el primer caso sin secciones y el resto con ellas,
  en silencio. Usa un wrapper explícito.
- **`MAX_CASOS_LOTE` 200 → 120** en los 2 archivos que lo declaran (el bug preexistente de §4-D).
- Separó `MAX_EXPEDIENTES_EXPORT` (200, sin tocar) del cap de capture-lote: compartían constante por
  conveniencia, no por compartir la razón de fondo — exportar no pasa por `captureDrafts.js`.

### Verificación

| Qué | Resultado |
|---|---|
| Suite completa de Electron (8 archivos, corrida por mí) | **267 PASS, 0 FAIL** |
| 3 harnesses nuevos del backend | **31 PASS, 0 FAIL** |
| `verify-secciones-snapshot-live.js` **contra staging real, Postgres real** | **6 PASS, 0 FAIL** |
| `node --check` + JS inline del template + `npm start` | limpio |

El harness contra staging cierra el gap que el agente reportó explícitamente: `datosSnapshot()` solo
se había probado en aislamiento (función pura) y `capture.js` sobre un Express in-process, ninguno
con Postgres. Prueba el **round-trip real por JSONB** (las 6 secciones se persisten y se leen igual,
el `\n` interno de intervinientes sobrevive) y que un snapshot de **procuración** no gana las claves
nuevas aunque el payload se las mande — control negativo.

### Estado de despliegue

| Pieza | Staging | Producción |
|---|---|---|
| `capture.js` · `bitacora.js` | ✅ desplegado y verificado | ⏳ **pendiente** |
| `public/usuarios/app.js` (render) | ✅ | ✅ (va con la versión visible; inofensivo sin el backend) |
| Cliente Electron | — | ✅ **release `electron-v2.7.58`** |

⚠️ **Con el backend sin desplegar a producción, la feature NO funciona todavía.** Un cliente 2.7.58
manda las 5 secciones y el `capture.js` de prod las ignora (no las conoce) → el snapshot se guarda
como hasta ahora. Degradación limpia, sin error, pero sin la feature.

**Release:** el bug crónico de assets se repitió (**22ª vez seguida desde v2.7.38**) — el release
quedó con solo el `.blockmap` **y `releases/latest` ya resolvía a v2.7.58**, así que durante unos
minutos la descarga del instalador apuntó a un `.exe` inexistente. Corregido sin rebuild: SHA512
recalculado, `latest.yml` a mano sin BOM (el de `dist/` había quedado **stale apuntando a 2.7.57**,
la trampa de siempre), `.exe` de 134 MB subido con `HttpClient`. Verificado: 3 assets, `latest.yml`
servido == SHA512 local, y `/client/download/electron` → **302** al `.exe` correcto.

### Lo que falta

1. **Deploy de backend a producción** (`capture.js` + `bitacora.js`, `scp` + `pm2 restart`).
2. **F3** — un informe real **tildando todas las secciones** (ninguna corrida existente las tiene),
   guardarlo a Bitácora y confirmar el modal. Consume **3 usos** de cupo.
3. **F4** — cierre en `CLAUDE.md` (esta entrada ya lo cubre en parte).


---

## 10. F3 — corrida real (2026-09-04 23:05)

Ejecutada por el operador con la app **2.7.58** ya instalada, informe de `FCR 18745/2017` contra el
PJN real, tildando las secciones.

**Resultado, verificado por SQL en producción** — el contraste con el snapshot de esa misma tarde es
lo que prueba la feature:

| Snapshot | Hora | movs | históricos | intervinientes | vinculados | recursos | notas | pdf |
|---|---|---|---|---|---|---|---|---|
| **45** (antes del cambio) | 17:31 | 15 | 0 | 0 | 0 | 0 | 0 | ✅ |
| **46** (después) | 23:05 | 15 | **15** | **6** | **2** | **2** | **1** | ✅ |

Los históricos llegaron al **tope de 15**, así que el recorte se ejercitó de verdad.

**Corrida real confirmada por los contadores del servidor**, no por impresión: `informe_usage`
63→64 y una fila en `usage_logs` a las 23:04 con `subsystem='informe'` y `success=true`.

### 🎯 Lo más importante del resultado: los intervinientes salieron limpios

```
"ACTOR|NOMBRE :
AFIP-DGI (BD 7570/10/2017)||"
"LETRADO APODERADO|JONATHAN ANDRES BERGER|Tomo: 122 Folio: 68 - Federal|27320694359"
"LETRADO APODERADO|FLORENCIA DE DIOS|Tomo: 122 Folio: 15 - Federal|27327439192"
"DEMANDADO|NOMBRE :
PARDO MONTOYA SHIRLEY LICET||"
"FISCALIA|FISCAL|I.E.J."
"FISCALIA DE CAMARA DE COMODORO RIVADAVIA|DRA. VERONICA RAQUEL ESCRIBANO|23213552554"
```

6 entradas reales: **sin la fila de encabezado `TIPO|NOMBRE|TOMO/FOLIO :`, sin filas vacías y sin la
duplicación completa de la tabla** que trae el backup crudo. Confirma con datos reales del PJN que la
réplica de `testM2.js:2156-2177` hace lo mismo que el original — que era el riesgo principal de haber
tenido que duplicar esa lógica.

### ⚠️ Observación honesta, NO corregida

En **`vinculados` y `recursos` la fila de encabezado de la tabla del PJN se guarda como un item más**:

```
"EXPEDIENTE|DEPENDENCIA|SITUACION|CARATULA|ULT. ACT.|"      ← encabezado, se cuenta como vinculado
"FCR 018745/2017/1|JUZGADO FEDERAL DE RIO GALLEGOS - ...|"  ← el vinculado real
```

Así que el modal muestra **"Vinculados (2)"** donde solo **1** es real.

**No es un bug del fix ni un descuido:** la limpieza de encabezados existe solo para intervinientes,
y aplicarle esa misma heurística a las otras 3 secciones se descartó a propósito en F1 (formatos
distintos, y `testM2.js` tampoco lo hace — **el PDF muestra exactamente lo mismo**). Es un detalle de
calidad de dato, no de integridad: el contenido real está y es correcto.

**Candidato a pulir** si molesta en el uso real. El arreglo natural sería descartar la primera fila
cuando todas sus celdas son nombres de columna, pero es heurística sobre texto libre del PJN y
merece medirse contra varios expedientes antes de aplicarla — exactamente el error que esta misma
propuesta advertía evitar (§F1: "un normalizador genérico que arregla intervinientes de más").

### Lo que quedó sin verificar

**El modal del portal a ojo, por mí**: la extensión de Chrome se desconectó al final de la sesión.
Está cubierto por 9 tests que extraen las funciones reales del fuente (`mexp-snapshot-render.test.js`)
y el operador confirmó haberlo visto. No se afirma más que eso.
