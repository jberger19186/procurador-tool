# Plan de implementación — Módulo Markdown / Anonimización judicial (2026-08-26)

> **Origen:** `brief_modulo_anonimizacion_electron.md` (operador, 2026-08-26).
> **Lugar en el proyecto:** **Etapa 1.2** de `docs/internal/roadmap-salida-a-mercado-2026-08.md`.
> **Estado:** plan de implementación. **No se escribió código.** El módulo no existe todavía.
>
> **Advertencia de arranque:** este plan tiene un **bloque gate (M0)** cuyo resultado puede
> cambiar el tamaño del módulo entero — de "una sesión de parsing" a "tocar un script encriptado
> y cortar release". **No empezar por M1 ni por la UI.** Ver §2.

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
| **Sesiones estimadas** | **6–10**, más 1 release de Electron. **M0 puede subir el rango a 9–13** si la descarga de adjuntos necesita sesión autenticada |
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

## 2. M0 — Spike de viabilidad 🔴 **GATE — nada arranca antes de esto**

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** |
| **Duración** | 1 sesión |
| **Entregable** | Un documento corto (`docs/internal/spike-markdown-M0-<fecha>.md`) que responde 3 preguntas con evidencia, no con suposiciones, y **fija la arquitectura de M3** |
| **Riesgo si se saltea** | Alto. Las dos primeras preguntas pueden convertir M3 de "descargar URLs" en "conducir una sesión de Puppeteer autenticada", que es 3× el trabajo y además **toca un script encriptado** |

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

### M1 — Habilitación por plan (backend) 🟢

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

**Decisión abierta (no bloqueante):** ¿este módulo **consume cupo**? Bitácora no consume. Propongo
**que tampoco consuma en la v1** — no toca el PJN ni gasta recursos del servidor, es procesamiento
local. Si más adelante se ve abuso, se agrega. Anotarlo en el plan comercial, no en el código.

---

### M2 — Extracción del PDF principal a Markdown 🟡

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

---

### M3 — Descarga y unificación de adjuntos 🟡 / 🔴 *(el tamaño lo fija M0)*

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **alto** (escenarios A/B) — **subir a Opus/alto si M0 devuelve el escenario C** |
| **Depende de** | **M0 pregunta 2** — no arrancar antes |

- Detección de anotaciones `Link` en el PDF principal, deduplicadas por URL.
- Descarga a directorio temporal seguro, con **límite explícito de cantidad y tamaño total** (un
  informe con 200 adjuntos no puede colgar la app ni llenar el disco) y **timeout por archivo**.
- Extracción de cada adjunto con el mismo motor de M2 y **concatenación ordenada** con separadores
  legibles (`## Anexo 3 — <nombre del documento>`), respetando el orden en que aparecen en el
  original.
- **Progreso en consola**, como pide el brief: la app ya tiene el panel de consola y el streaming
  de eventos — se reusa, no se inventa nada.
- Limpieza del temporal al terminar, **incluso ante error** (el patrón `try/finally` que el
  proyecto ya aplica en los flujos de Puppeteer).

**Si M0 devuelve escenario B o C:** el candado de ejecución (`active_executions`) entra en juego —
si el módulo abre Chrome, no puede hacerlo mientras corre una procuración. Hay que respetar el
mismo pre-chequeo que usan los demás flujos, o el usuario recibirá el error "proceso activo en
otro dispositivo" sin entender por qué.

---

### M4 — Motor de anonimización + `mapping.txt` 🔴 **Opus**

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

---

### M5 — UI: modal de 2 solapas + botón en el topbar 🟡

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
   M0 (GATE) ──┬──► M2 ──┬──► M4 (Opus) ──┐
               │         │                │
               └──► M3 ──┘                ├──► M5 ──► M6 ──► release Electron
                                          │
   M1 (backend, en paralelo) ─────────────┘
```

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
| **R1** | Los adjuntos requieren sesión autenticada (escenario B/C de M0) | **Media-alta** | Es la razón de existir de M0. Si es C, replantear alcance con el operador **antes** de M2 |
| **R2** | El motor de anonimización deja pasar nombres | **Alta** (es inherente) | Sesgo al falso positivo + Solapa 2 editable + leyenda de "no es garantía" + **F5 del code-review en Opus** |
| **R3** | Buena parte de los adjuntos son escaneos sin texto | Media | Marcador descriptivo (ya en el brief). **No meter OCR en v1** |
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
