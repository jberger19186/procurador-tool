# Guion de la demo — D1 (Etapa 1.6)

> **Origen:** [`plan-demo-producto-2026-08-26.md`](plan-demo-producto-2026-08-26.md), bloque D1.
> **Fecha:** 2026-08-27. **Autor:** sesión D1 (Sonnet, esfuerzo medio).
> **Estado:** guion completo, **revisado contra 34 capturas de referencia reales**. Sin capturas de
> producción todavía (eso es D3/D4).
>
> **La carpeta de referencia apareció en una ubicación distinta a la del plan** —
> `C:\Users\JONATHAN\Pictures\Screenshots\imagenes_pt` (no `Desktop\ordenar\imagenes`), 34 capturas
> del 2026-08-25, un recorrido real y coherente del operador por la app + el portal + el sitio del
> PJN + la extensión. **Las 34 se revisaron una por una** contra el borrador inicial de este guion.
> Resultado: **confirma la estructura de 7 capítulos punto por punto**, y agrega hallazgos reales
> que el borrador (armado solo desde código y landing) no podía anticipar — documentados capítulo
> por capítulo abajo, marcados **🔍 hallazgo de la revisión**.
>
> 🚨 **Ninguna de las 34 capturas es reutilizable tal cual en la demo** — todas tienen datos reales
> sensibles (CUIT `27320694359` visible en al menos 6 pantallas distintas: login, SSO ×2, gestor de
> contraseñas ×2, topbar del SCW ×2; email real; carátulas y nombres de partes reales de expedientes
> reales; el nombre de usuario de Windows `JONATHAN` en una ruta de archivo). Sirven **solo como
> referencia de encuadre y composición** para D2/D3/D4 — nunca como asset final.

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

## 0.5. Onboarding — material real disponible, decisión pendiente

**🔍 Hallazgo de la revisión:** las capturas incluyen la secuencia completa del **wizard de
configuración inicial** (`#modalOnboarding` o equivalente) — 4 pasos con progreso visual: (1)
*Verificando conexión al servidor* → (2) *Iniciar sesión* → (3) *Configurar perfil de Chrome* → (4)
*Configurar acceso al portal PJN* → pantalla de cierre *"¡Configuración completada!"* con botones
"Ver tour rápido" / "Entrar a la aplicación".

Es una secuencia limpia y vendible (transmite "en 4 pasos estás usando la app"), pero **no estaba en
el guion original** porque no es un módulo de la landing — es onboarding puro. **Decisión pendiente
para D1→D2:** ¿se agrega como un capítulo 0 corto ("Así de fácil es empezar") antes de "El
problema", o se deja fuera para no diluir el foco en valor de producto? **Recomendación: dejarlo
fuera del tour principal** — el wizard vende "fácil de instalar", no "resuelve tu problema", y el
plan ya prioriza mostrar valor rápido. Si se quiere igual, es material de bajo costo para un capítulo
opcional corto al final, no al principio.

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

**🔍 Hallazgo de la revisión — confirma una exclusión ya recomendada por el plan:** las capturas
incluyen la pantalla de login SSO del PJN (`sso.pjn.gov.ar`) **con el CUIT real precargado en el
campo Usuario**, en dos instantes distintos del recorrido. Es la prueba visual directa de por qué el
plan (§4, punto 3) ya recomendaba **no incluirla en la demo**: el campo autocompletado no se puede
"vaciar" en una captura real sin herramientas de edición, y aporta poco valor comercial frente al
riesgo. **Confirmado: esta pantalla queda fuera del guion**, en el problema y en cualquier otro
capítulo.

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
| 4.1 | Modal **Monitor**, pestaña **Partes** — formulario de alta (jurisdicción + nombre, con placeholder `EJ: PEREZ JUAN CARLOS`) | `#modalMonitor`, pestaña `Partes` | **D3** | `"ESTUDIO DEMO S.A."`, jurisdicción `FCR` |
| 4.2 | Listado de partes con badge "Base lista" / "Sin base", cupo `N de 20 parte(s)` | mismo modal, pestaña `Partes` | **D3** | 2-3 partes ficticias |
| 4.3 | **🔍 Pestaña Expedientes** — tabla real con columnas Expediente/Dependencia/Carátula/Situación/Últ. actuación, filtrable por parte, con checkboxes de selección | `#modalMonitor`, pestaña `Expedientes` (3ra pestaña, no estaba en el guion original) | **D3** | carátulas ficticias, misma forma que §2 |
| 4.4 | **🔍 Barra de selección masiva** al tildar filas: `"N seleccionado(s)"` + botones **`📌 Guardar casos`** y **`+ Crear entradas...`** | misma pestaña `Expedientes` | **D3** | — |
| 4.5 | Resultado de **Consulta Inicial** — "N expedientes en base" (server-rendered, 3 tarjetas: Partes procesadas / Exitosas / Expedientes en base) | `generarVisorMonitoreo()` en `main.js` | **D3** | N inventado, ej. `18` |
| 4.6 | Resultado de **Buscar Novedades** — "Novedades detectadas: N" con las filas resaltadas | mismo generador, otra corrida | **D3** | 1-2 expedientes nuevos ficticios |

⚠️ **Trampa ya documentada en el proyecto** (`tests/daily/README.md`): la 3ra tarjeta del visor de
Monitor cambia de label según el modo — *"Expedientes en base"* en `inicial`, *"Novedades
detectadas"* en `novedades`. Al armar el fixture del visor, generar **los dos estados reales**, no
un mismo HTML con el número cambiado a mano — si no, la captura puede mostrar la combinación
label+dato que en producción nunca ocurre junta.

**🔍 Hallazgo de la revisión, no anticipado en el borrador original:** el modal Monitor tiene **3
pestañas**, no 2 como asumía la primera versión de este guion — `Partes` / `Expedientes` /
`Novedades`. La pestaña `Expedientes` (4.3-4.4) es en sí misma una demostración fuerte del puente
hacia Bitácora (botón `📌 Guardar casos` con selección múltiple) — más contundente que mostrar el
puente solo desde el visor de procuración del capítulo 5. Vale la pena mostrarla acá o en el
capítulo 5, pero **no en los dos** (redundante) — decisión para D5: se deja en el capítulo 5 (§5.1),
que ya conecta narrativamente los 4 módulos previos.

**Pills a reforzar:** *Multi-jurisdicción · Civil, Laboral, Federal y más · Línea base por parte ·
Confirmación masiva · Notificaciones Windows.*

---

## 5. Capítulo — Bitácora

**Copy de apertura** (de la landing, con el diferencial marcado):
> "Con un clic desde cualquier visor de procuración, informe o monitor guardás el caso en tu
> Bitácora, sin tipear nada de nuevo."

| Paso | Pantalla | Elemento real | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 5.1 | **🔍 La barra de 5 acciones al pie del modal de detalle** de un movimiento (dentro del visor de procuración): **`+ Vencimiento`**, **`+ Tarea`**, **`+ Nota`**, **`📌 Guardar caso`**, **`💾 Guardar procuración`** — confirmado el set exacto en la captura real, no solo "un botón guardar" como asumía el borrador | modal de detalle del visor de novedades, footer de acciones | **D3** | expediente de §2 |
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
| 7.1 | El popup de la extensión — header **"Procurador TOOL v1.3.x"** + chip de cuenta (email · plan · "Salir") + grilla de **5 flujos** (Consulta / Escritos 1 / Escritos 2 / Notificaciones / DEOX) + campo "Ingresá el expediente" con placeholder `Ej.: FCR 18745/2017` | Extensión real en Chrome | **D4** (operador) | Email/plan de la cuenta demo en el chip |
| 7.2 | El mismo popup con el campo **ya completado** (ej. tras usar el menú contextual) — confirma que el flujo funciona de punta a punta | Extensión real | **D4** | **Sustitución**: expediente real → sintético en la redacción de D4 |
| 7.3 | El autocompletado en acción en **Consulta SCW** — jurisdicción/número/año cargados solos en el sitio real | Sitio real del PJN | **D4** | mismo tratamiento |
| 7.4 | El autocompletado en **Escritos** (`escritos.pjn.gov.ar`) | Sitio real del PJN | **D4** | mismo tratamiento |
| 7.5 | **🔍 El menú contextual "Enviar expediente a PJN"** — click derecho sobre el número de expediente **seleccionado** en la página real del SCW, con el menú nativo de Chrome desplegado y la opción de la extensión (ícono propio) resaltada | Sitio real del PJN + extensión | **D4** | mismo tratamiento — confirma exactamente la composición: expediente resaltado en azul + menú contextual con "Copiar / Copiar el vínculo / Preguntale a Gemini / ... / Enviar expediente a PJN / Inspeccionar" |

**Pills a reforzar:** *Consulta de expedientes · Presentación de escritos · Notificaciones y DEOX ·
Lanzá flujos desde cualquier página de Chrome.*

**🔍 Hallazgo de la revisión:** las capturas confirman la composición exacta de 7.1/7.2/7.5 con
detalle que el borrador no podía tener (versión de la extensión visible en el header, el orden de
las 5 tarjetas de flujo, el texto exacto del placeholder, las opciones del menú contextual nativo
alrededor de la propia). **7.5 es el paso más fuerte de todo el capítulo** — muestra en una sola
imagen la promesa completa ("seleccioná el número, click derecho, listo") sin necesitar abrir nada
manualmente.

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
| 4. Monitor | 4.1–4.6 | — |
| 5. Bitácora | 5.1–5.7 | — |
| 6. Markdown | 6.1–6.8 | — |
| 7. Extensión | — | 7.1–7.5 |

**31 pasos automatizables (D3), 7 manuales (D4) — 38 pasos totales.** Subió respecto de la primera
versión de este guion (26/6/32) al incorporar 2 hallazgos reales de la revisión de capturas: la
pestaña "Expedientes" del Monitor con su barra de selección masiva (4.3-4.4, nuevos) y el desglose
más preciso del capítulo Extensión (7.2 y 7.5, antes uno solo). Sigue siendo **~82% automatizable**
— los 7 de D4 son ~15-20 minutos de captura real, siguiendo esta tabla como checklist.

---

## 9. Qué falta para pasar a D2

✅ **Resuelto por la revisión de capturas del 2026-08-27:**
- ~~Confirmar si la carpeta de referencia reaparece~~ — apareció (`Pictures\Screenshots\imagenes_pt`)
  y ya se revisó completa contra este guion. No hay una segunda ronda de revisión pendiente.
- ~~La pantalla de SSO del PJN, ¿se incluye?~~ — confirmado que no, con evidencia directa del
  problema (CUIT real precargado en dos capturas distintas).

**Sigue abierto:**
- **Confirmar el set de expedientes ficticios** que atraviesa toda la demo (D2 los construye, pero
  el nombre/carátula exacta puede ajustarse — ver §2-§6, todos reusan los mismos 1-2 expedientes
  para dar coherencia). Los nombres que aparecen en las capturas de referencia (`DON COCHO`, `LA
  TOSTADORA MODERNA`, `ALVAREZ MARTA FABIANA`) **no se reusan** — son datos de fixtures/pruebas del
  proyecto real, no inventados a propósito para una demo pública.
- **Decidir el mock de IA del paso 6.7-6.8**: ¿una interfaz neutra genérica, o directamente una
  captura de texto plano sin chrome de ventana? Recomiendo la segunda opción — es más barata de
  mantener y no corre riesgo de parecerse a la UI real de un producto de terceros que cambie de
  diseño.
- **Decidir si el capítulo 0 de onboarding (§0.5) se incluye** — hay material real disponible, pero
  la recomendación de esta revisión es dejarlo fuera del tour principal (ver §0.5).
