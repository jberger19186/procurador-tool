# Guion de la demo — D1 (Etapa 1.6)

> **Origen:** [`plan-demo-producto-2026-08-26.md`](plan-demo-producto-2026-08-26.md), bloque D1.
> **Fecha:** 2026-08-27. **Autor:** sesión D1 (Sonnet, esfuerzo medio).
> **Estado:** guion completo, sin capturas todavía (eso es D3/D4).
>
> ⚠️ **Nota sobre la fuente de referencia del plan:** D1 debía mirar primero "las 36 capturas de
> referencia en `C:\Users\JONATHAN\Desktop\ordenar\imagenes`". **Esa carpeta ya no existe en la
> máquina** — se buscó en todo el Desktop y en OneDrive sin encontrarla (probablemente movida o
> borrada desde el 2026-08-26). Este guion se armó en su lugar a partir de: (a) el copy real de
> `backend-server/public/landing/index.html` (secciones `#features`, `#extension`, `#planes`), que
> ya describe cada módulo con el lenguaje que el operador aprobó para vender el producto, y (b) la
> estructura real de pantallas/modales del código (Electron `index.html`, portal `index.html`),
> confirmada por id, no supuesta. **Si la carpeta de referencia reaparece, revisar el encuadre de
> cada capítulo contra esas capturas antes de D3** — puede haber composiciones puntuales que el
> operador ya había elegido y que este guion no conoce.

---

## 0. Decisión de formato — resuelta

El plan dejaba abierta la pregunta *"¿una sola pieza larga o una por módulo?"*. **Se adopta la
recomendación del plan: por módulo, con un índice.**

Motivo, ya escrito en el propio plan (§D1) y confirmado al relevar la landing: cada tarjeta de
`#features` (Procuración, Monitor, Informes, Bitácora, Markdown) es una unidad de venta propia, con
su tag (`Principal`, `Destacado`, `Nuevo`) y su propio texto. Un capítulo por módulo permite:

- Linkear "ver Bitácora en acción" desde la tarjeta de Bitácora de la landing (deep-link `/demo/#bitacora`).
- Regenerar un capítulo solo cuando cambia ese módulo, sin tocar los demás (la razón de ser de D3).
- Que un visitante entre directo al módulo que le interesa, sin scrollear 7 capítulos.

**7 capítulos, no 6** (el plan decía "6 capítulos" pero listaba 7 — corregido acá): El problema →
Procuración → Informe → Monitor de partes → Bitácora → Markdown → Extensión Chrome.

**Índice / navegación:** capítulos en el orden de abajo, con botones "anterior/siguiente" dentro de
cada uno y un menú superior fijo para saltar a cualquiera. Deep-link por capítulo:
`/demo/#problema`, `/demo/#procuracion`, `/demo/#informe`, `/demo/#monitor`, `/demo/#bitacora`,
`/demo/#markdown`, `/demo/#extension`.

---

## 1. Capítulo — El problema

**Objetivo narrativo:** anclar la demo en el dolor real antes de mostrar la solución. Sin esto, los
capítulos siguientes son una galería de features sin contexto.

| Paso | Pantalla | Fuente | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 1.1 | El portal SCW del PJN, vista de "Actuaciones" de un expediente con varias filas | Sitio real del PJN | **D4** (operador, a mano) | **Sustitución obligatoria**: carátula, número de expediente, dependencia — todo real de un tercero. Ver §5, Estrategia B |
| 1.2 | La misma pantalla, con el mouse "recorriendo" 5-6 expedientes distintos abiertos en pestañas | Sitio real del PJN | **D4** | Mismo tratamiento |

**Copy:**
> "Consultar el estado de tus expedientes significa entrar al SCW, expediente por expediente, y
> repetirlo todos los días. Un estudio con 50 casos activos puede perder más de una hora diaria solo
> en esto."

**Nota:** este capítulo es el único 100% manual del guion completo (D4). Es corto a propósito — una
sola pantalla del PJN alcanza, no hace falta una galería del dolor.

---

## 2. Capítulo — Procuración

**Copy de apertura** (tomado del `feat-desc` real de la landing, adaptado a paso a paso):
> "Consultá todos tus expedientes del SCW con un clic. La app navega el portal en segundo plano,
> extrae los movimientos nuevos y guarda todo organizado."

| Paso | Pantalla | Elemento real | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 2.1 | Ventana principal, tab **Procurar** activo, campo "Fecha límite" con la fecha de hoy | `.tab-nav`, sección `#Procurar` (topbar real) | **D3** | Cuenta demo — sin dato sensible en esta vista |
| 2.2 | El campo "Por lote" con un archivo `.txt` cargado (2-3 expedientes ficticios) | sidebar "Por lote" | **D3** | `demo-fixtures/batch.txt`: `FCR 00001/2024`, `CIV 00002/2024` |
| 2.3 | Consola de actividad corriendo, con las líneas de log reales (`[INICIO]`, `INFO`, `OK`) | `#consoleStatusbar` / log del renderer | **D3** — captura estática del estado "en curso", **no un GIF real de la corrida** (evita gastar cupo) | mismo fixture |
| 2.4 | El **visor de novedades** abierto — tabla de expedientes con movimientos | `visorModal_template.html`, `datosEmbebidos` | **D3**, generado desde el fixture (`generarVisorHTML()` real, no maqueta) | Carátulas `GONZÁLEZ MARÍA C/ ASEGURADORA DEMO S.A. S/DAÑOS Y PERJUICIOS`, `PÉREZ JUAN C/ ESTUDIO EJEMPLO S/COBRO DE PESOS` |
| 2.5 | El modal de detalle de un movimiento (click en una fila del visor) | mismo template, modal interno | **D3** | mismo fixture |

**Pills a reforzar en el copy** (de la landing): *Modo automático diario · Procuración por lote ·
Filtro por sección · Fecha personalizable · Progreso en tiempo real*.

**CTA de cierre:** "Probalo gratis" → `/register/`.

---

## 3. Capítulo — Informe

**Copy de apertura:**
> "Generá informes detallados de uno o múltiples expedientes. El resultado es un visor HTML
> interactivo con búsqueda + una planilla Excel lista para usar."

| Paso | Pantalla | Elemento real | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 3.1 | Modal **Informe**, pestaña Individual, campo de expediente completo | `#modalInforme` (confirmado por id en el spike de §0.1 del plan) | **D3** | `FCR 00001/2024` |
| 3.2 | El selector de secciones (movimientos actuales/históricos, intervinientes, vinculados, recursos, notas) | mismo modal | **D3** | — |
| 3.3 | El **visor de informe** — header sticky, stats row, tabla de expedientes con botón "Abrir PDF" | `visor_informes_template.html`, `DATOS_BATCH` | **D3**, generado desde el fixture (mismo generador real que usa producción) | mismo expediente |
| 3.4 | El PDF final abierto — 2-3 páginas con movimientos | PDF generado por Puppeteer contra el fixture | **D3** | mismo fixture |
| 3.5 | La pestaña Batch (`.txt`) con 2 expedientes → resultado con tasa de éxito 100% | mismo modal, modo lote | **D3** | `demo-fixtures/batch.txt` |

**Pills a reforzar:** *Visor HTML interactivo · Exportación Excel automática · Informe individual o
en lote · Secciones configurables · Links a documentos adjuntos.*

**Nota de coherencia con el hallazgo histórico del proyecto:** el criterio de éxito del visor de
informe exige `ok` **y** `rutaPDF` presentes a la vez (la regresión real que ya rompió producción
dos veces, `822bf0d`/`debb503`) — al generar el fixture, confirmar visualmente que el botón "Abrir
PDF" queda **activo**, no "N/A", porque es justo el detalle que un visitante real notaría raro.

---

## 4. Capítulo — Monitor de partes

**Copy de apertura:**
> "Registrás las partes que querés vigilar y la app rastrea automáticamente si aparecen en nuevos
> expedientes."

| Paso | Pantalla | Elemento real | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 4.1 | Modal **Monitor**, formulario de alta de parte (nombre + jurisdicción) | `#modalMonitor` | **D3** | `"ESTUDIO DEMO S.A."`, jurisdicción `FCR` |
| 4.2 | Listado de partes con badge "Base lista" / "Sin base" | mismo modal | **D3** | 2-3 partes ficticias |
| 4.3 | Resultado de **Consulta Inicial** — "N expedientes en base" (server-rendered, `stat-val`/`stat-label`) | `generarVisorMonitoreo()` en `main.js` | **D3** | N inventado, ej. `18` |
| 4.4 | Resultado de **Buscar Novedades** — "Novedades detectadas: 2" con las filas resaltadas | mismo generador, otra corrida | **D3** | 1-2 expedientes nuevos ficticios |

⚠️ **Trampa ya documentada en el proyecto** (`tests/daily/README.md`): la 3ra tarjeta cambia de
label según el modo — *"Expedientes en base"* en `inicial`, *"Novedades detectadas"* en `novedades`.
Al armar el fixture del visor, generar **los dos estados reales**, no un mismo HTML con el número
cambiado a mano — si no, la captura puede mostrar la combinación label+dato que en producción nunca
ocurre junta.

**Pills a reforzar:** *Multi-jurisdicción · Civil, Laboral, Federal y más · Línea base por parte ·
Confirmación masiva · Notificaciones Windows.*

---

## 5. Capítulo — Bitácora

**Copy de apertura** (de la landing, con el diferencial marcado):
> "Con un clic desde cualquier visor de procuración, informe o monitor guardás el caso en tu
> Bitácora, sin tipear nada de nuevo."

| Paso | Pantalla | Elemento real | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 5.1 | El botón **📌 Guardar caso** en la barra de selección de un visor (el "clic" que vende la landing) | botonera de captura de F2.1-F2.2, visible en los visores | **D3** | expediente de §2 |
| 5.2 | La sección **Bitácora** del portal, vista **Mes** — calendario con 2-3 entradas coloreadas por tipo | `#section-bitacora`, `#bitacora-vista-mes` | **D3**, Playwright contra el stub de V0 | Vencimiento `Contestar demanda — FCR 00001/2024`, audiencia, nota |
| 5.3 | La vista **Semana** (F3.4, Bloque A) | `#bitacora-vista-semana` | **D3** | mismo fixture |
| 5.4 | La ficha de un caso en **Mis Expedientes** — historial de entradas + snapshots | `#section-mis-expedientes`, `#mexp-ficha-body` | **D3** | mismo expediente, 2-3 entradas vinculadas |
| 5.5 | El modal de nueva entrada, con la **calculadora de plazos** (fecha + N días hábiles) | `#modal-bitacora-entrada` | **D3** | — |
| 5.6 | El banner de avisos (vencidos + próximos 7 días) | dentro de `#section-bitacora` | **D3** | 1 vencida, 1 próxima |
| 5.7 | **(F3.4, Bloque B)** El modal de exportación con la opción **iCalendar (.ics)** marcada | modal de exportación existente | **D3** | — |

**Pills a reforzar:** *Captura con un clic desde los visores · Historial por expediente ·
Sugerencias automáticas del Monitor · Vencidos y próximos en un vistazo · Exportación e importación
de tu agenda.*

**Nota:** el paso 5.1 es el más importante narrativamente — es el que conecta este capítulo con los
3 anteriores (Procuración/Informe/Monitor) y por eso hay que mostrarlo *dentro* de un visor ya
familiar para el visitante, no como pantalla aislada.

---

## 6. Capítulo — Markdown / Anonimización

**Copy de apertura** (de la landing):
> "Convertí un informe ya generado en un archivo de texto plano que podés pegar en el chat de tu
> asistente de IA preferido — y en una versión anonimizada. Todo el procesamiento ocurre en tu
> computadora."

🚨 **Este capítulo NO puede quedarse en "se generan 2 archivos"** — ver la nota del propio plan
(§D1): tiene que explicar *para qué* sirve la versión anonimizada. Estructura en 2 partes:

**Parte A — el modal real** (`#modalMarkdown`, confirmado por estructura exacta del código):

| Paso | Pantalla | Elemento real | D3/D4 |
|---|---|---|---|
| 6.1 | Pestaña **Procesar**, dropzone vacía ("Arrastrá un informe PDF acá") | `#md-dropzone-idle` | **D3** |
| 6.2 | Dropzone con el archivo cargado (`#md-archivo-nombre`) | `#md-dropzone-archivo` | **D3** |
| 6.3 | Log de progreso corriendo | `#md-progreso-log` | **D3** — captura del estado final del log, no un GIF real |
| 6.4 | Resultado: los 3 botones (`📄 Abrir Markdown completo`, `🔒 Abrir Markdown anonimizado`, `🗂 Abrir mapping.txt`) | `#md-resultado` | **D3** |
| 6.5 | Pestaña **Editor de mapeo**, con el `.txt` de reemplazos cargado en el `<textarea>` | `#md-panel-mapping` | **D3** |

**Parte B — el "para qué"** (los pasos que el operador pidió explícitamente el 2026-08-26, no
inventados en esta sesión):

| Paso | Pantalla | D3/D4 | Detalle |
|---|---|---|---|
| 6.6 | El `.md` anonimizado abierto en un editor de texto — nombres visiblemente enmascarados (`Actor`, `Demandado`, `Jon### Ber###`) | **D3** (screenshot de un editor genérico, o del propio Notepad/VS Code) | Confirma visualmente que el enmascarado es real, no una promesa |
| 6.7 | El contenido del `.md` anonimizado copiado/arrastrado a un chat de IA genérico | **D3**, con un **mock estático de la interfaz de un chat de IA** (no un producto de terceros real, para no implicar afiliación) | Mismo criterio que evitó nombrar Claude/ChatGPT/Gemini en la propia landing — usar un mock neutro tipo "Asistente IA" |
| 6.8 | Ese mock respondiendo sobre el contenido del expediente, **sin ningún nombre de parte visible en la respuesta** | **D3**, texto de respuesta escrito a mano para la demo (no una llamada real a una API de IA) | Este es el paso que cierra la promesa: "podés razonar sobre tu caso sin exponer datos" |

**Coordinación de copy pendiente, ya señalada por el plan:** el texto exacto de 6.6-6.8 debe decir
lo mismo que el paso 2/14 del tour de onboarding (`electron-app/onboarding/tour.js`) y que la
leyenda de Términos y Condiciones §6 (*"ayuda automática, no garantía"* — Etapa 1.3, ya en
producción). **Verificar contra esos 2 textos al escribir el copy final de D5**, no reinventar el
matiz de "ayuda, no garantía" acá.

**Pills a reforzar:** *Genera un .md completo y uno anonimizado · Diccionario de reemplazos
editable · 100% local, sin subir el expediente · Solo texto — sin OCR de páginas escaneadas.*

**Gate real, ya cerrado:** este capítulo requiere `markdown_enabled=true` — **ya está encendido en
COMBO_PROMO** desde el 2026-08-27 (ver `CLAUDE.md`), y el build de captura debe ser **2.7.51 o
posterior** (ver Riesgo R6 del plan, ya resuelto).

---

## 7. Capítulo — Extensión Chrome

**Copy de apertura** (de la landing):
> "Cinco flujos del PJN, automatizados desde tu navegador."

| Paso | Pantalla | Fuente | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 7.1 | El popup de la extensión, con los 5 flujos listados (SCW, Escritos ×2, Notificaciones, DEOX) | Extensión real en Chrome | **D4** (operador) | — |
| 7.2 | El autocompletado en acción en **Consulta SCW** — jurisdicción/número/año cargados solos | Sitio real del PJN | **D4** | **Sustitución**: expediente real → sintético en la redacción de D4 |
| 7.3 | El autocompletado en **Escritos** (`escritos.pjn.gov.ar`) | Sitio real del PJN | **D4** | mismo tratamiento |
| 7.4 | El menú contextual "Enviar expediente a PJN" desde cualquier página de Chrome | Extensión real | **D4** | — |

**Pills a reforzar:** *Consulta de expedientes · Presentación de escritos · Notificaciones y DEOX ·
Lanzá flujos desde cualquier página de Chrome.*

**Motivo de que sea 100% D4** (confirmado, no supuesto, en §0.1/§4 del plan): `list_connected_browsers`
da `[]` — no hay Chrome conectado por Claude-in-Chrome — y aunque computer-use *vea* un navegador,
lo otorga en tier "read" (no clickeable). No hay curva de mejora acá salvo que se conecte la
extensión Claude-in-Chrome a una sesión con la extensión del PJN cargada, lo cual es una decisión
del operador, no una limitación técnica a resolver en D1-D6.

---

## 8. Resumen de dependencias D3 vs. D4

| Capítulo | D3 (automatizado) | D4 (operador, manual) |
|---|---|---|
| 1. El problema | — | 1.1, 1.2 |
| 2. Procuración | 2.1–2.5 | — |
| 3. Informe | 3.1–3.5 | — |
| 4. Monitor | 4.1–4.4 | — |
| 5. Bitácora | 5.1–5.7 | — |
| 6. Markdown | 6.1–6.8 | — |
| 7. Extensión | — | 7.1–7.4 |

**26 pasos automatizables (D3), 6 manuales (D4)** — coincide con la cifra de §0.1 del plan
(~90% automatizable). Los 6 de D4 son ~15 minutos de captura real, siguiendo esta tabla como
checklist.

---

## 9. Qué falta para pasar a D2

- **Confirmar el set de expedientes ficticios** que atraviesa toda la demo (D2 los construye, pero
  el nombre/carátula exacta puede ajustarse — ver §2-§6, todos reusan los mismos 1-2 expedientes
  para dar coherencia).
- **Decidir el mock de IA del paso 6.7-6.8**: ¿una interfaz neutra genérica, o directamente una
  captura de texto plano sin chrome de ventana? Recomiendo la segunda opción — es más barata de
  mantener y no corre riesgo de parecerse a la UI real de un producto de terceros que cambie de
  diseño.
- **Confirmar si la carpeta `Desktop\ordenar\imagenes` reaparece** — si sí, pasar una revisión de
  encuadre contra este guion antes de que D3 arranque a capturar en serio.
