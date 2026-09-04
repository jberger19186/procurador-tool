# Propuesta — el snapshot de informe guarda solo movimientos actuales

> **Estado: PROPUESTA, sin aprobar. No se tocó código.**
> Diagnóstico hecho el 2026-09-04 contra los backups reales de corridas del operador y el código real.
> Para ejecutar con un agente independiente, una vez aprobada.
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
