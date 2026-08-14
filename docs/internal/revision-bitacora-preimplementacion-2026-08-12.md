# Revisión de pre-implementación — Módulo Bitácora

> **Qué es esto.** Una revisión del plan de Bitácora (`propuesta-bitacora-agenda-2026-07.md`, v6.1)
> con un objetivo puntual: **que la implementación no se encuentre sorpresas**. No es una evaluación
> de si conviene hacer el módulo (eso ya está en la propuesta) ni una re-lectura del diseño.
>
> **Por qué ahora y no la revisión anterior alcanza.** La última verificación contra el código fue
> el **2026-07-27** (`revision-bitacora-vs-correcciones-2026-07-27.md`). Desde entonces pasaron: los
> **Bloques A, B, C, D y E** del plan de correcciones, las **3 fases del plan Q6**, y **4 releases**
> (v2.7.44 → v2.7.47). Varios de esos cambios tocan exactamente los archivos que Bitácora modifica.
>
> **Método:** verificación contra el código y la base de producción **hoy**, no lectura del
> documento. Cada afirmación de abajo se comprobó; donde digo "verificado" hay un comando detrás.
>
> **Elaborado:** 2026-08-12, Opus 5. Sin cambios de código — la propuesta **sigue sin aprobar**.

---

## 1. Veredicto

**Buena noticia primero: los 2 prerrequisitos duros que bloqueaban el plan ya están cumplidos.** La
revisión de julio decía "no se puede empezar F1.1 sin regenerar `schema.sql`" y "no se puede hacer
F2.1 sin el fix E4-1". **Las dos condiciones se cumplieron solas**, como efecto de los Bloques B y D
que se ejecutaron el 28/07. El plan pasó de tener dependencias externas a **no tener ninguna**.

**Lo que aporta esta revisión son 2 hallazgos nuevos de riesgo real** que ninguna revisión anterior
detectó, y que de no corregirse **producen bugs concretos, no teóricos**:

| # | Hallazgo | Severidad | Consecuencia si no se corrige |
|---|---|---|---|
| **N1** | La regla de normalización del expediente **no contempla ceros a la izquierda** | 🔴 Alto | Fichas duplicadas del mismo caso, historial partido, marcado de "ya seguido" que nunca matchea. **Es el mismo bug que el proyecto ya sufrió en julio** (`debb503`). |
| **N2** | F2.1: el punto de enganche del post-procesado no está definido y **la inyección propuesta no es idempotente** | 🔴 Alto | Ver un visor N veces inyecta el `<script>` N veces; y se agrega una dependencia de red a un handler que hoy es solo disco. |

Ambos son **baratos de corregir antes de escribir código** y caros de corregir después: N1 afecta el
esquema (F1.1, la primera tarea) y N2 afecta la arquitectura de F2.1.

---

## 2. Los 2 prerrequisitos duros: ✅ ambos cumplidos

| Prerrequisito | Estado en julio | Estado hoy (verificado) |
|---|---|---|
| **Bloque B.1** — regenerar `database/schema.sql` | ❌ 2 meses de drift: 21 de 27 tablas, faltaban `payments`/`invoices`/`commercial_benefits`, sobraba `check_plan_valid` | ✅ **27 tablas**, `check_plan_valid` → **0 apariciones**, las 3 tablas faltantes **presentes**. Archivo del 28/07. **F1.1 desbloqueada.** |
| **Bloque D** — fix E4-1 (escape en `visorModal_template.html`) | ❌ 5 campos del PJN sin escapar, cero mitigación | ✅ El template ya define **`esc()` y `escAttr()`** (líneas 299-300), con **12 usos de `esc()` y 4 de `escAttr()`**. **F2.1/F2.3 desbloqueadas.** |

Y el detalle que más importaba del segundo, verificado en el código real:

```js
// visorModal_template.html:299-300
function esc(s)     { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
```

`escAttr()` **sí escapa comillas simples y dobles** — que era exactamente la condición que el
recuadro rojo de §4.1 exigía para los `value=""` del formulario de captura. **El helper que F2.1
necesita ya está escrito y en producción desde v2.7.44.** No hay que crearlo ni portarlo: usarlo.

---

## 3. Hallazgo N1 🔴 — La normalización del expediente reintroduce el bug de los ceros a la izquierda

### Qué dice el plan

§12, riesgo #4:

> *"Duplicados por variaciones del número de expediente (espacios, formato) → **Normalizar la clave
> (uppercase, colapsar espacios)** en el upsert de `capture`."*

### Por qué no alcanza

Esa regla no contempla el caso que **el proyecto ya sufrió en producción**: el PJN devuelve los
números **con padding de ceros** (`FCR 018745/2017`), mientras que el usuario los escribe **sin
padding** (`FCR 18745/2017`). **Son el mismo expediente** — el cero a la izquierda es formato de
presentación del PJN, no parte del identificador.

Esto no es una hipótesis. Es el bug del commit **`debb503`** (2026-07-30), documentado en CLAUDE.md,
que dejó informes sin enlazar durante un día en producción. La lección quedó escrita en el código:

```js
// electron-app/informe/buscarPdfExpediente.js:32-40 — la solución que YA existe
function tokenizar(texto) {
    return texto.toLowerCase()
        .replace(/[\/:"*?<>|_]/g, ' ')
        .split(/\s+/).filter(p => p.length > 0)
        // Los componentes numéricos se normalizan quitando ceros a la izquierda.
        .map(p => /^\d+$/.test(p) ? (p.replace(/^0+/, '') || '0') : p);
}
```

### El daño concreto en Bitácora

La Bitácora es **el peor lugar posible** para este bug, porque las dos formas del número entran por
caminos distintos y se encuentran en la misma tabla:

| Camino de entrada | Forma del número |
|---|---|
| Captura desde un visor (§4.1) | La del PJN, **con padding**: `FCR 018745/2017` |
| Alta manual en el portal (F1.3/F1.4) | La que tipea el usuario, **sin padding**: `FCR 18745/2017` |

Con la regla actual (`uppercase` + `colapsar espacios`), las dos cadenas siguen siendo **distintas**
→ `UNIQUE (user_id, jurisdiccion, expediente)` **no las deduplica** → se crean **dos fichas del
mismo caso**. Y a partir de ahí:

1. **El historial se parte en dos.** El tope "2 procuraciones + 2 informes por caso" (§3.1, base del
   dimensionamiento de §10) deja de valer: el mismo caso real puede acumular 4+4 repartidos en dos
   fichas, y ninguna muestra el historial completo.
2. **El marcado de "casos ya seguidos" (§4.2c) falla en silencio.** `GET /client/bitacora/seguidos`
   devuelve la clave guardada; el visor compara contra la forma del PJN. Si la ficha se creó a mano,
   nunca matchea → el usuario ve `📔+` (como si no lo siguiera) en un caso que sí sigue, y al
   capturarlo crea la segunda ficha. **El bug se retroalimenta.**
3. **La Fase 3 queda bloqueada de origen.** "Sugerencias automáticas a partir de novedades del
   monitor" (§11, Fase 3.3 — el diferencial mayor del módulo) necesita cruzar
   `monitor_expedientes.numero_expediente` contra `expedientes_seguidos.expediente`. Sin clave
   normalizada, ese join no existe.
4. **El upsert idempotente de §4.1 deja de serlo.** El "resultado idempotente ante deep-links
   repetidos" se apoya en que `ON CONFLICT` matchee. Con dos formas del número, no matchea.

### Qué hacer (barato, en F1.1)

Guardar una **clave normalizada** junto al texto que se le muestra al usuario, y poner el `UNIQUE`
sobre la clave, no sobre el texto:

```sql
-- en expedientes_seguidos
expediente      VARCHAR(60) NOT NULL,   -- como lo vio el usuario: "FCR 018745/2017"
expediente_key  VARCHAR(60) NOT NULL,   -- normalizado: "fcr|18745|2017"
UNIQUE (user_id, expediente_key)        -- ← corregido 2026-08-13, ver nota
```

- La normalización debe **reusar la lógica de `tokenizar()`**, no reescribirla — es código ya
  probado contra el caso real. **Dónde vive quedó definido el 2026-08-13** (auditoría externa C3):
  canónica en `backend-server/utils/expedienteKey.js`, Electron conserva la suya, y un fixture de
  casos compartido que ambos tests ejercitan para que no deriven. Ver §7 de la propuesta.
- Conservar el texto original es importante: es lo que el usuario reconoce, y `expediente_key` no es
  legible.

> ⚠️ **Corregido el 2026-08-13 — esta sección proponía `UNIQUE (user_id, jurisdiccion, expediente_key)`
> y decía que `jurisdiccion` seguía necesitando `NOT NULL DEFAULT ''`. Las dos cosas quedaron sin
> efecto.** La auditoría externa (hallazgos B1/B2) llevó a revisar ese punto y la conclusión fue que
> **`jurisdiccion` no debe estar en la clave**: (1) es redundante, porque la sigla de jurisdicción ya
> viaja dentro de `expediente_key` (`tokenizar("FCR 018745/2017")` = `"fcr|18745|2017"` — el primer
> token *es* la jurisdicción); y (2) es peligrosa, porque llega como texto libre con distinta forma
> según el origen (el PJN manda "Justicia Federal de Comodoro Rivadavia", el usuario tipea "FCR") y
> con ella dentro del UNIQUE el mismo caso cargado por los dos caminos genera **dos fichas** — el
> mismo bug que este hallazgo N1 vino a cerrar, entrando por el otro componente. Al salir de la
> clave, `jurisdiccion` queda descriptiva y su nullability deja de importar. **Fuente de verdad: §7
> de la propuesta.**

**Costo:** una columna y una función compartida, decididas antes de escribir la migración.
**Costo si se descubre después:** migración de datos sobre fichas reales de usuarios, con
deduplicación manual de las que ya se hayan partido.

---

## 4. Hallazgo N2 🔴 — F2.1: enganche sin definir y post-procesado no idempotente

### Qué dice el plan

§4.4: `main.js` *"post-procesa el archivo HTML después de que el script lo generó y antes de
abrirlo — **inserta un `<script>` adicional al final del `<body>`** con `bitacoraEnabled` y la lista
de casos ya seguidos"*.

El **qué** está bien resuelto (evita tocar los scripts encriptados, que es lo importante). El
**dónde** y el **cómo** no están especificados, y ahí hay dos problemas concretos.

### Problema A — La inyección propuesta no es idempotente

"Insertar un `<script>` al final del `<body>`" es una operación **acumulativa**: si el mismo archivo
se post-procesa dos veces, queda con dos `<script>`. Y el archivo **sí se abre más de una vez** (ver
problema B). Resultado: variables redeclaradas, listas de "seguidos" contradictorias, y un HTML que
crece en cada apertura.

**Qué hacer:** que la inyección sea **reemplazo, no append** — insertar contra un marcador fijo
(ej. un `<!-- BITACORA_RUNTIME -->` que el template ya traiga, reemplazado con `String.replace`), o
detectar y sustituir el bloque anterior. Es el mismo patrón `replace` de placeholder que ya usan
`generador_visor.js` (`DATOS_BATCH`) y los scripts encriptados (`datosEmbebidos`) — la diferencia es
que acá el reemplazo tiene que tolerar **correr N veces sobre el mismo archivo**.

### Problema B — El punto de enganche natural se usa también para visores históricos

Verificado en el código: el visor de procuración se abre **siempre** a través del handler
`get-visor-path` (`main.js:1768`), que resuelve el archivo más reciente por `mtime`. Y ese handler
se invoca desde **dos lugares distintos** del renderer:

| Origen | Línea | Qué abre |
|---|---|---|
| Auto-open tras la corrida | `renderer.js:1502` | El visor **recién generado** |
| Botón "Ver resultados" (Historial) | `renderer.js:1209` | El último visor, **que puede ser de días atrás** |

Si el post-procesado se engancha en `get-visor-path` (el lugar natural, porque es el único que ya
resuelve la ruta exacta):

- Se ejecuta también al abrir visores **históricos** → de ahí la necesidad del problema A.
- Se le agrega una **llamada de red** (`GET /client/bitacora/seguidos`) a un handler que hoy es
  **solo sistema de archivos**, sincrónico y que no puede fallar. Nuevo modo de falla: ¿si la red
  falla, el visor se abre sin botonera, o no se abre? Hoy "Ver resultados" funciona sin conexión.

**Las dos opciones, con su costo — hay que elegir una explícitamente:**

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A. Enganchar en `get-visor-path`** | Post-procesar en cada apertura | El marcado de "ya seguidos" siempre está fresco | Requiere idempotencia sí o sí; mete red en un handler offline; reescribe archivos históricos |
| **B. Enganchar tras la corrida** | Post-procesar una vez, al terminar el script, antes del auto-open | Una sola vez por corrida; sin red en el camino de "Ver resultados"; el archivo queda listo | Un visor viejo muestra el marcado **del día que se generó** |

**Recomendación: B.** La propia §4.2c ya acepta ese costo — *"el marcado refleja el estado al momento
de generar el visor; si el usuario guarda el caso después, un visor viejo no lo sabe — aceptable (el
upsert del portal resuelve igual sin duplicar)"*. Siendo así, no hay razón para pagar el precio de la
opción A. **Igual conviene hacer la inyección idempotente**, por si el flujo cambia después.

> ⚠️ **Detalle de implementación que conviene no descubrir a mitad de camino:** con la opción B, el
> post-procesado necesita la ruta del archivo recién generado, y hoy `main.js` **no la conoce** — la
> genera el script encriptado y `get-visor-path` la descubre después por `mtime`. Habrá que reusar
> `latestFileBy()` (`main.js:1754`) también en el camino de post-procesado, o hacer que el flujo de
> ejecución la resuelva una sola vez y la comparta.

---

## 5. Hallazgo N3 🟡 — El "patrón ya usado" del post-procesado no existe como tal

§4.4 justifica el post-procesado diciendo que usa *"el mismo patrón de `fs.readFileSync` +
`string.replace` + `fs.writeFileSync` que `main.js` ya usa hoy para otras tareas de post-proceso de
archivos generados"*.

**Verificado: es cierto a medias.** `main.js` tiene 15 usos de `writeFileSync`, pero todos son de
**generación** (arma el contenido y lo escribe) o de **configuración**. El caso más parecido es
`generarVisorMonitoreo` (`main.js:2458-2463`), que **construye el HTML como string y lo escribe** —
no lee un archivo ajeno para modificarlo.

**No hay hoy ningún precedente de `main.js` leyendo y reescribiendo un archivo que produjo un script
encriptado.** Mecánicamente son las mismas llamadas, así que el riesgo sigue siendo bajo; pero la
frase "patrón ya usado" subestima que es un camino nuevo, con casos de borde propios (archivo en uso,
encoding, y la idempotencia de N2). **No cambia el veredicto de F2.1 (Mediano), sí conviene no
tratarlo como copiar-pegar.**

---

## 6. Hallazgo N4 🟡 — Solapamiento con `monitor_expedientes`, sin puente previsto

Verificado contra producción, `monitor_expedientes` ya almacena, por usuario (vía `parte_id`):

```
numero_expediente  VARCHAR(255)   caratula     TEXT
dependencia        TEXT           situacion    VARCHAR(255)
```

Son **los mismos cuatro campos** que `expedientes_seguidos` va a guardar. Es decir: el sistema va a
tener **dos registros paralelos de "expedientes que le importan a este usuario"**, sin relación entre
sí.

**No es un error de diseño** — los propósitos son distintos (el Monitor descubre expedientes nuevos
de una parte; la Bitácora sigue casos elegidos). Pero tiene dos consecuencias prácticas:

1. **La Fase 3.3 ("sugerencias a partir de novedades del monitor") depende de un join que hoy no
   sería posible.** Es el diferencial mayor del módulo según la propia §11. La clave normalizada del
   hallazgo N1 es justamente lo que lo habilitaría — **una razón más para hacer N1 en F1.1**, aunque
   la Fase 3 esté lejos.
2. **Inconsistencia de tipos:** `monitor_expedientes.numero_expediente` es `VARCHAR(255)` y la
   propuesta define `expedientes_seguidos.expediente` como `VARCHAR(60)`. 60 alcanza de sobra para un
   número de expediente real, pero si algún día se cruzan o se migran datos, la asimetría molesta.
   Barato alinearlos ahora.

---

## 7. Hallazgo N5 🟡 — Q6 sigue sin decidir y afecta F1.1, que es la primera tarea

Ya estaba señalado en la revisión de julio; lo repito porque **no se decidió** y porque es la única
pregunta abierta que **toca el esquema**:

- **Q6:** al bajar a un plan sin Bitácora, ¿la exportación sigue disponible 90 días?
- Si la respuesta es **sí** → hace falta una columna nueva (`users.bitacora_lost_access_at`) **en
  F1.1** + el carve-out del middleware de gate (hallazgo H5, §8).
- Si la respuesta es **no** → 403 duro también para export, sin columna.

**Decidirlo después de F1.1 significa una segunda migración.** Las otras 11 preguntas abiertas
(Q1-Q12) son comerciales o de UI y pueden responderse sobre la marcha; **esta no.**

---

## 8. Verificado sin problemas (lo que NO hay que revisar de nuevo)

Todo esto se comprobó hoy contra el código y la base reales:

| Supuesto del plan | Estado |
|---|---|
| `server.js:110` (`express.json`) y `:113` (`express.urlencoded`) | ✅ **Los números siguen exactos** (el plan advertía "no asumir, verificar") |
| `POST /usuarios/capture` debe montarse antes del static | ✅ `/usuarios/api` está en `server.js:384` y el `express.static` de `/usuarios` en `:385` — montar la captura antes de 384 |
| `PUBLIC_OPEN_CORS_PATHS` existe y **no** hay que agregar capture | ✅ `server.js:84`, contiene solo `['/analytics/event']` |
| Nginx `client_max_body_size` en 20M — **no tocar** | ✅ 20M en **prod y staging** (`sites-available/procurador:16` y `staging-procurador:29`) |
| Las 4 tablas y 3 columnas nuevas no colisionan | ✅ 27 tablas en prod, **cero colisiones** (consultado `information_schema`) |
| `visorModal_template.html` va como `extraResources` | ✅ `package.json:130-134` |
| Dos arquitecturas de visor (hallazgo H1) | ✅ Confirmado: `DATOS_BATCH` en `generador_visor.js` + `visor_informes_template.html`; `datosEmbebidos` en `visorModal_template.html` + los 2 scripts encriptados |
| `tour.js` tiene `.tab-nav` y el patrón `targets:[]` | ✅ `target:'.tab-nav'` en la línea 25; `targets:[...]` en 38, 90, 132 |
| `pending_goto` en el portal | ✅ `usuarios/app.js:327-330` (consumo) y `:2497` (persistencia) |
| `/client/account` puede exponer `bitacora_enabled` | ✅ Ya hace `LEFT JOIN plans p` y selecciona 8 columnas de `p` — agregar una es trivial |
| La whitelist de scripts no afecta endpoints nuevos | ✅ `SCRIPTS_DISTRIBUIBLES` solo filtra en `client.js:194` (download) y `:295` (available) |
| `open-file` (endurecido por E2-3) no bloquea el visor | ✅ Valida que resuelva dentro de `userData`; el visor vive en `userData/usuarios/<CUIT>/descargas/` → pasa |

### Novedades desde julio que **no** generan conflicto (verificadas)

- **Q6 Fases 1-3 (verificación de firmas).** No cruzan con Bitácora: el visor se escribe **fuera** de
  `tempDir`, después de que el `fork` terminó, así que la verificación de integridad del `.enc` (que
  ahora lee del disco real) no interactúa con el post-procesado de F2.1.
- **`generalAuthLimiter` sobre `/usuarios/api`** (RI-3, 22/07): los endpoints de Fase 1 **heredan
  gratis** un límite de 300/5min. A favor. Solo tenerlo presente: la navegación intensiva del
  calendario comparte ese presupuesto (300/5min ≈ 1 req/s sostenido — no debería alcanzarse).

### Coordinación de merge — ampliada respecto de julio

La revisión anterior anotaba un solo cruce (`server.js`: crons del Bloque A vs. el parser de F2.2).
**Ese ya no aplica** (el Bloque A está hecho). Pero aparece otro:

- **`routes/client.js`** — Q6 Fase 1 lo modificó (el firmado fail-closed) y **F2.4** agrega ahí
  `GET /client/bitacora/seguidos`. Mismo archivo, zonas distintas. Trivial, pero conviene saberlo.

---

## 9. Secuencia recomendada (actualizada)

La secuencia de la revisión de julio tenía 5 pasos previos a Bitácora. **Los 5 están hechos.** Lo que
queda:

```
0. Decidir Q6 (carve-out de exportación)        ← 5 minutos · condiciona el esquema de F1.1
1. Aplicar N1 al esquema (clave normalizada)     ← parte de F1.1, no una tarea aparte
2. Bitácora Fase 1 (F1.1 … F1.8)                 ← ~9-14 sesiones · sin release de Electron
3. Decidir el enganche de N2 (opción A o B)      ← antes de escribir F2.1
4. Bitácora Fase 2 (F2.1 … F2.7)                 ← deploy de backend + release de Electron
```

**El momento es favorable por una razón que no es del plan:** el proyecto **no tiene ningún plan
interno pendiente de ejecución** por primera vez en meses (E1-E6, Bloque R, Q6 y los de seguridad
están todos cerrados). No hay trabajo compitiendo por los mismos archivos — el riesgo de conflicto
de merge, que era real en julio, hoy es prácticamente nulo.

**Lo que no cambia:** la estimación de **~13-20 sesiones** para F1+F2 sigue vigente (los hallazgos de
esta revisión no agregan trabajo, redirigen el que ya estaba), y la **nota de producto del hallazgo
C6 sigue siendo la advertencia más importante del plan**: al cerrar la Fase 1 hay ~9-14 sesiones
invertidas y **todavía nada que mostrarle al cliente** — sin la Fase 2, es una agenda manual sin
diferencial. No anunciarla ni venderla hasta cerrar F2.

---

## 10. Resumen para decidir

| Pregunta | Respuesta |
|---|---|
| ¿El plan está listo para implementar? | **Sí.** Los 2 bloqueos externos se resolvieron solos; no queda ninguna dependencia. |
| ¿Hay que rediseñar algo? | **No.** N1 y N2 son ajustes puntuales (una columna, una decisión de enganche), no cambios de arquitectura. |
| ¿Qué hay que decidir antes de la primera línea de código? | **Dos cosas:** Q6 (carve-out de export, afecta el esquema) y el enganche de N2 (afecta F2.1, pero se puede decidir más tarde — antes de F2.1, no antes de F1.1). |
| ¿Cuál es el riesgo más caro si se ignora esta revisión? | **N1.** Se descubre recién cuando un usuario real tenga fichas duplicadas, y ahí ya hay que migrar datos suyos. |
| ¿La propuesta está aprobada? | **No.** Sigue siendo una propuesta. Esta revisión no la aprueba, la deja lista. |
