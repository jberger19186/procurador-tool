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
> por capítulo abajo, marcados **🔍 hallazgo de la revisión**. Tras esa revisión, 2 aclaraciones del
> operador sumaron: la regla de higiene de banners informativos (§0.6) y un **8vo capítulo de
> Portal** (§0.7) — el guion final queda en **8 capítulos, 43 pasos**.
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
- Que un visitante entre directo al módulo que le interesa, sin scrollear 8 capítulos.

**8 capítulos** (el plan decía "6" y la primera versión de este guion tenía 7 — ver el cambio en
§0.7): El problema → Procuración → Informe → Monitor de partes → Bitácora → Markdown → **Portal de
usuarios (Dashboard y Gestión)** → Extensión Chrome.

**Índice / navegación:** capítulos en el orden de abajo, con botones "anterior/siguiente" dentro de
cada uno y un menú superior fijo para saltar a cualquiera. Deep-link por capítulo:
`/demo/#problema`, `/demo/#procuracion`, `/demo/#informe`, `/demo/#monitor`, `/demo/#bitacora`,
`/demo/#markdown`, `/demo/#portal`, `/demo/#extension`.

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

## 0.6. Higiene de captura — banners informativos dinámicos

**Pedido del operador (2026-08-27), sobre una captura real de referencia** (banner de cupo:
*"Usás tus usos de prueba: 116/128 (incluye +90 de cortesía) — configurá tu método de pago para
acceder a los límites de tu plan"*, con botón `Ver en portal` + `✕`).

**Regla para D3: cualquier banner de este tipo se cierra (`✕`) antes de capturar, en cualquier
pantalla donde aparezca.** No es exclusivo de la ventana principal de la app — la misma familia de
avisos puede aparecer en distintos lugares según el estado de la cuenta:

| Dónde puede aparecer | Qué banner |
|---|---|
| Ventana principal de la app (topbar) | Cupo de trial/cortesía (`Usás tus usos de prueba: N/M...`) |
| Ventana principal de la app | Pago rechazado / período de gracia |
| Ventana principal de la app | Cancelación programada de la suscripción |
| Portal — banner superior global | Los mismos 3 casos de arriba, versión web |
| Bitácora | Banner de avisos (vencidos/próximos) — **este NO se cierra**, es contenido del módulo, no un aviso de cuenta (ver §5.6) |

**Por qué cerrarlo y no solo evitarlo:** estos banners reflejan el **estado real** de la cuenta demo
en el momento exacto de la captura (cupo consumido, días de gracia, etc.) — es contenido dinámico y
específico de una cuenta de prueba, no una decisión de diseño de la demo. Mostrarlo sin querer
comunica algo que no es el mensaje ("mirá, se te puede acabar el cupo") y además **cambia entre
corridas** del pipeline de D3, rompiendo la reproducibilidad que es el objetivo central del bloque.

**Qué queda documentado, no borrado:** esta sección funciona como la referencia de "acá puede
aparecer un banner de este tipo, ciérralo" para quien regenere la demo — el detalle vive acá, no
repetido en cada capítulo. Los capítulos de abajo no vuelven a mencionarlo salvo que un paso
puntual dependa de tenerlo cerrado (ninguno depende de lo contrario).

---

## 0.7. Cambio de alcance — se agrega el portal como capítulo propio

**Pregunta del operador (2026-08-27):** el guion cubría Bitácora y Mis Expedientes (dentro del
capítulo 5), pero no el resto del portal — Mi Plan, Facturación, Soporte, Ayuda. ¿Estaba
contemplado?

**No lo estaba**, con el mismo criterio que excluyó Configuración/onboarding (§0.5): son pantallas
de gestión de cuenta, no de valor de producto. **Decisión del operador: agregar un capítulo corto**
mostrando la navegación general del portal — no como una lista de pantallas de cuenta, sino
apoyado en una tarjeta real de la landing que hasta ahora no tenía capítulo propio: **"📊 Dashboard
y Gestión"** (`#features`, la 4ta tarjeta, sin tag — ver el capítulo 7 abajo). Esa tarjeta ya
promete exactamente lo que el portal muestra (cuotas, tickets, actualizaciones), así que el
capítulo nuevo no es una idea nueva — es la puesta en pantalla de una promesa que la landing ya
hace y que el guion original había dejado sin capítulo.

**El guion pasa de 7 a 8 capítulos.**

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

## 7. Capítulo — Dashboard y Gestión (Portal de usuarios)

> **Nuevo en esta revisión** (§0.7, pedido del operador). Antes el portal solo aparecía a través de
> Bitácora/Mis Expedientes (capítulo 5). Este capítulo muestra el resto: la gestión de cuenta.

**Copy de apertura** (de la landing, tarjeta real `#features` sin tag — la única de las 6 que no
tiene `Principal`/`Destacado`/`Nuevo`, porque no es un módulo que se activa, es el panel que ya
viene con cualquier cuenta):
> "Todo el control de tu operación en un solo panel: estadísticas por subsistema, tasa de éxito en
> tiempo real, gestión de cuotas del plan, soporte integrado con tickets y chat, y actualizaciones
> automáticas de la app."

| Paso | Pantalla | Elemento real | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 7.1 | Sección **Mi Plan** — nombre del plan, badge de estado, días restantes del período con barra de progreso | `#section-plan`, `#plan-name-display`/`#plan-status-badge`/`#plan-days-fill` | **D3**, Playwright contra el stub de V0 | Plan `COMBO_PROMO`, estado `Activo`, `18 días restantes` (número inventado, sin banner de cupo — ver §0.6) |
| 7.2 | Misma sección, tarjeta **Descargas** — enlaces al instalador de la app y a la extensión | `#downloads-card` | **D3** | — |
| 7.3 | Sección **Facturación** — historial de pagos/facturas | `#section-facturacion` | **D3** | 2-3 filas ficticias, montos redondos (`$15.000`, no un monto real) |
| 7.4 | Sección **Soporte** — listado de tickets propios + botón nuevo ticket | `#section-soporte` | **D3** | 1 ticket de ejemplo, ya resuelto (evita mostrar un problema sin resolver en la demo) |
| 7.5 | Sección **Ayuda** — buscador de FAQ con 2-3 resultados | `#section-ayuda` | **D3** | — |

**Pills a reforzar** (de la landing, textuales): *Estadísticas por subsistema · Tasa de éxito en
tiempo real · Gestión de cuotas del plan · Soporte con tickets y chat · Actualizaciones
automáticas.*

**Nota de tono, distinta a la de los otros capítulos:** este NO es un capítulo de "mirá lo que hace
por vos" (como Procuración/Informe/Monitor) ni de "mirá el diferencial" (como Bitácora/Markdown) —
es un capítulo de **tranquilidad**: "tenés un panel para administrar todo esto sin depender de la
app de escritorio". Corto a propósito (5 pasos, el más chico después de "El problema"), sin
necesidad de una narrativa de flujo — es una galería breve, no un recorrido.

**Recordatorio del §0.6:** el banner de cupo/pago puede aparecer también en el banner superior
global del portal, no solo en Mi Plan — cerrarlo en cualquier captura de este capítulo.

---

## 8. Capítulo — Extensión Chrome

**Copy de apertura** (de la landing):
> "Cinco flujos del PJN, automatizados desde tu navegador."

| Paso | Pantalla | Fuente | D3/D4 | Dato sintético |
|---|---|---|---|---|
| 8.1 | El popup de la extensión — header **"Procurador TOOL v1.3.x"** + chip de cuenta (email · plan · "Salir") + grilla de **5 flujos** (Consulta / Escritos 1 / Escritos 2 / Notificaciones / DEOX) + campo "Ingresá el expediente" con placeholder `Ej.: FCR 18745/2017` | Extensión real en Chrome | **D4** (operador) | Email/plan de la cuenta demo en el chip |
| 8.2 | El mismo popup con el campo **ya completado** (ej. tras usar el menú contextual) — confirma que el flujo funciona de punta a punta | Extensión real | **D4** | **Sustitución**: expediente real → sintético en la redacción de D4 |
| 8.3 | El autocompletado en acción en **Consulta SCW** — jurisdicción/número/año cargados solos en el sitio real | Sitio real del PJN | **D4** | mismo tratamiento |
| 8.4 | El autocompletado en **Escritos** (`escritos.pjn.gov.ar`) | Sitio real del PJN | **D4** | mismo tratamiento |
| 8.5 | **🔍 El menú contextual "Enviar expediente a PJN"** — click derecho sobre el número de expediente **seleccionado** en la página real del SCW, con el menú nativo de Chrome desplegado y la opción de la extensión (ícono propio) resaltada | Sitio real del PJN + extensión | **D4** | mismo tratamiento — confirma exactamente la composición: expediente resaltado en azul + menú contextual con "Copiar / Copiar el vínculo / Preguntale a Gemini / ... / Enviar expediente a PJN / Inspeccionar" |

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

## 9. Resumen de dependencias D3 vs. D4

| Capítulo | D3 (automatizado) | D4 (operador, manual) |
|---|---|---|
| 1. El problema | — | 1.1, 1.2 |
| 2. Procuración | 2.1–2.5 | — |
| 3. Informe | 3.1–3.5 | — |
| 4. Monitor | 4.1–4.6 | — |
| 5. Bitácora | 5.1–5.7 | — |
| 6. Markdown | 6.1–6.8 | — |
| 7. Portal (Dashboard y Gestión) | 7.1–7.5 | — |
| 8. Extensión | — | 8.1–8.5 |

**36 pasos automatizables (D3), 7 manuales (D4) — 43 pasos totales.** Sube respecto de la versión
anterior (31/7/38) por el capítulo de Portal (7, nuevo, 5 pasos), agregado a pedido del operador
(§0.7). Sigue siendo **~84% automatizable** — los 7 de D4 (capítulos 1 y 8, sin cambios) son ~15-20
minutos de captura real, siguiendo esta tabla como checklist.

---

## 10. Qué falta para pasar a D2

✅ **Resuelto por la revisión de capturas del 2026-08-27 y por las 2 aclaraciones del operador
sobre esa misma revisión:**
- ~~Confirmar si la carpeta de referencia reaparece~~ — apareció (`Pictures\Screenshots\imagenes_pt`)
  y ya se revisó completa contra este guion. No hay una segunda ronda de revisión pendiente.
- ~~La pantalla de SSO del PJN, ¿se incluye?~~ — confirmado que no, con evidencia directa del
  problema (CUIT real precargado en dos capturas distintas).
- ~~¿Qué hacer con los banners de cupo/pago que aparecen en las capturas reales?~~ — regla
  documentada en §0.6: se cierran antes de capturar, en cualquier pantalla donde aparezcan.
- ~~¿El resto del portal (Mi Plan, Facturación, Soporte, Ayuda) está contemplado?~~ — no lo estaba;
  se agregó como capítulo 7 nuevo (§0.7), apoyado en la tarjeta real "Dashboard y Gestión" de la
  landing.

✅ **Resuelto por D2 (2026-08-27) — ver §11:**
- ~~Confirmar el set de expedientes ficticios~~ — construido en
  `backend-server/dev-tools/demo-fixtures/expedientes.js`: 4 casos + 1 "novedad", con nombres
  deliberadamente distintos de `DON COCHO`/`LA TOSTADORA MODERNA`/`ALVAREZ MARTA FABIANA` (fixtures
  del propio proyecto, no pensados para exhibición pública).

**Sigue abierto (no bloquea D2, son decisiones de D3/D5):**
- **Decidir el mock de IA del paso 6.7-6.8**: ¿una interfaz neutra genérica, o directamente una
  captura de texto plano sin chrome de ventana? Recomiendo la segunda opción — es más barata de
  mantener y no corre riesgo de parecerse a la UI real de un producto de terceros que cambie de
  diseño.
- **Decidir si el capítulo 0 de onboarding (§0.5) se incluye** — hay material real disponible, pero
  la recomendación de esta revisión es dejarlo fuera del tour principal (ver §0.5).

---

## 11. D2 ejecutado (2026-08-27) — fixtures + capa de sustitución, verificados

**Entregable real, en `backend-server/dev-tools/demo-fixtures/`:**
- `expedientes.js` — el set coherente de 4 expedientes ficticios (+ 1 "novedad" para el capítulo de
  Monitor) que atraviesa Procuración → Informe → Monitor → Bitácora.
- `procuracion.js`, `informe.js`, `monitor.js` — los mismos 4 casos, adaptados a la forma exacta de
  dato que espera cada generador real (`datosEmbebidos` del visor de Procuración, `resumenJSON` de
  `generarVisorHTML()`, `resultados` de `generarVisorMonitoreo()` — las 3 formas confirmadas por
  lectura directa del código real, no supuestas).
- `bitacora.js` — 3 fichas de "Expedientes seguidos" + 5 entradas de agenda con fechas CALCULADAS
  relativas a "hoy" (no hardcodeadas), para que la vista Mes/Semana muestre una vencida/una de
  hoy/una próxima sin importar qué día se regenere la demo.
- `cuenta.js` — cuenta sintética con cupo deliberadamente lejos de cualquier umbral de aviso (§0.6):
  las 3 barras de progreso quedan en verde, para que ningún banner aparezca sin querer en medio de
  una captura.
- `portal.js` — 2 facturas emitidas + 1 ticket resuelto con hilo real, para el capítulo 7.
- `generar-visores.js` — genera los 6 visores (Procuración ind./lote, Informe ind./lote, Monitor
  inicial/novedades) invocando las funciones REALES del producto, no maquetando HTML.
- `demo-anonimizar.js` — la capa de sustitución por DOM (Parte B), con los entry points
  `aplicarSustitucionLoginElectron`/`aplicarSustitucionPrincipalElectron`/`aplicarSustitucionPortal`.

**Hallazgo real, no anticipado por el plan: `generarVisorMonitoreo()` NO era reusable como estaba.**
El plan asumía que "reusar `generarVisorHTML()`/`generarVisorMonitoreo()` reales" era simétrico para
las dos funciones — no lo era. `generarVisorHTML()` (`electron-app/informe/generador_visor.js`) ya
era una función exportada, sin dependencia de Electron. `generarVisorMonitoreo()` en cambio era una
función PRIVADA, sin exportar, definida adentro de `electron-app/main.js` — que en su primera línea
hace `require('electron')`, así que ni siquiera se podía `require()` ese archivo desde un script Node
plano. Se extrajo a su propio módulo, **`electron-app/monitor/generarVisorMonitoreo.js`** (301 líneas,
copiadas byte a byte, verificadas antes de tocar `main.js`), siguiendo el mismo patrón que el proyecto
ya usa en `electron-app/informe/motivoInformeSinPDF.js` — y por la misma razón que el propio historial
del proyecto documenta dos veces como causa de bugs reales: la búsqueda de PDF duplicada entre
`generador_visor.js`/`generador_excel.js`, y `VERIF_FLUJOS_ORDEN` duplicado entre backend y dashboard.
`main.js` quedó con un `require()` a ese módulo nuevo en vez de la definición inline — verificado que
los 2 call sites no cambiaron, que `node --check` pasa en ambos archivos, y que `npm start` arranca
limpio 20s sin `uncaughtException`/`Cannot find module`.

**Bug real encontrado en la propia verificación de D2, corregido antes de seguir:** el visor de
Procuración usa un marcador `<!-- DATOS_EMBEBIDOS -->` que en el template queda ANTES del `<script>`
que define `cargarDatosEmbebidos()` (línea 345 vs. 348). El primer intento de `generar-visores.js`
llamaba a esa función inmediatamente dentro del bloque inyectado — reventaba con
`cargarDatosEmbebidos is not defined`, confirmado con un error real de consola en Playwright, no
supuesto. Fix: diferir la llamada con `document.addEventListener('DOMContentLoaded', ...)`, que
garantiza que el resto del documento (incluida la función) ya corrió. Como el template no tiene
NINGÚN otro call site de esa función (grep completo, cero coincidencias), esto es probablemente
también cómo lo resuelve el script encriptado real que arma este HTML en producción — no se pudo
confirmar contra ese código (zona protegida), pero es la única forma consistente con lo que el
template realmente expone.

**Verificado end-to-end con Playwright real, no solo por lectura de código:**
- `generar-visores.js` corrido de punta a punta: genera 6 visores + 2 PDFs de placeholder (armados a
  mano con sintaxis PDF mínima, sin depender de ninguna librería — `backend-server` no tiene
  `pdfkit`/`puppeteer` como dependencia).
- **Informe por lote:** navegado en un navegador real — 2/2 exitosos, 0 fallidos, **los 2 botones
  "📄 Abrir PDF" activos y con el href correcto** (el criterio exacto que ya cazó 2 regresiones reales
  en producción — `822bf0d`/`debb503` — confirmado que no se repite acá).
- **Procuración por lote:** navegado real, 0 errores de consola tras el fix de `DOMContentLoaded`,
  stats correctos (2/2/0/38s), tabla con los datos reales del fixture.
- **Monitor — Consulta Inicial:** navegado real, stats correctos (1 parte/1 exitosa/4 expedientes en
  base — el label "Expedientes en base" y no "Novedades detectadas", el hallazgo de la sesión
  2026-08-27 cont. 21, confirmado vigente), badge "📁 ya seguido" presente para el expediente marcado
  como seguido en `BITACORA_INFO_MONITOR`.
- **`demo-anonimizar.js`:** un primer diseño componía `aplicarSustitucionElectron()` llamando a
  funciones hermanas del mismo módulo — se descartó al confirmar que ni `page.evaluate(fn, args)`
  (Playwright JS) ni el `.toString()` que consume un driver Python arrastran funciones hermanas al
  inyectar una función sola. Los 2 entry points reales (`aplicarSustitucionLoginElectron`,
  `aplicarSustitucionPrincipalElectron`) quedaron autocontenidos. Verificado el de login contra el
  HTML REAL de `electron-app/renderer/login.html` (servido tal cual, sin mocks): sustituye
  `#email.value` y `#machineIdDisplay` (texto truncado + `title` completo) correctamente.

**Extensión de `stub-portal.js` (V0), con flag opcional `--demo`:** `node stub-portal.js [puerto]
--demo` reemplaza el seed de la campaña `/verify` por el dataset de la demo (cuenta, fichas,
entradas de Bitácora, facturas, ticket). **Sin el flag, el archivo queda exactamente como estaba**
— verificado explícitamente corriendo ambos modos y comparando la cuenta/expedientes servidos, para
no introducir una regresión en el andamio que ya usa la campaña `/verify`. `stub-dashboard.js`
**no se tocó** — ninguno de los 8 capítulos de la demo pasa por el panel de administración.

**Pendiente real para D3, ninguno bloqueante de lo ya hecho:** el pipeline de captura automatizada en
sí (reusar `tests/daily/electron_driver.py` para conectar por CDP a la app real, recorrer los pasos
del guion, aplicar la sustitución en el momento correcto — regla de oro §0.6 — y sacar los
screenshots), más el driver equivalente para los stubs del portal.

---

## 12. D3 ejecutado (2026-08-27) — 32/36 pasos capturados, 3 pipelines verificados

**Entregable real, en `backend-server/dev-tools/demo-capture/`:**
- `capture_common.py` — constantes compartidas (viewport 1280×800 fijo, resolución de rutas de
  salida a `backend-server/public/landing/demo/assets/<capítulo>/<paso>.png`).
- `capture_visores.py` — pipeline 1: abre los visores YA generados por D2 (regenerándolos primero,
  para que la captura siempre refleje el fixture actual) servidos por un HTTP simple local, sin
  Electron ni cuenta real. Cubre 2.4-2.5, 3.3-3.4, 4.5-4.6, y **5.1** (la barra de 5 acciones del
  modal de detalle vive DENTRO de este visor, no en el portal — hallazgo real: el primer intento de
  D2 la había dejado con `BITACORA_RUNTIME.enabled=false`, corregido acá).
- `capture_portal.py` — pipeline 2: conduce `stub-portal.js --demo` (D2). Cubre 5.2-5.7 y 7.1-7.5.
- `capture_electron.py` — pipeline 3: la app Electron VIVA por CDP. Cubre 2.1-2.3, 3.1-3.2, 3.5,
  4.1-4.3, 6.1-6.5.

**32 de 36 pasos automatizables capturados.** Los 4 que faltan: 4.4 (deliberadamente NO se captura
por separado — el propio §4 ya había decidido dejar esa demostración en 5.1, ver la nota "no en los
dos, redundante") y **6.6-6.8, que no dependen de ningún sistema** (son mockups: un editor de texto
genérico + una interfaz de chat de IA neutra) — quedan para D5, no son un pendiente de D3.

**Decisión del operador, vía pregunta explícita:** no existe todavía una cuenta de demo dedicada en
producción — D3 necesitaba loguearse de verdad contra el backend real para la mitad de la app
Electron (no hay stub para el desktop). Ante la elección entre usar la cuenta de verificación ya
logueada en esta máquina (con el riesgo de que sus partes/expedientes reales aparecieran en
pantalla) o pausar a esperar una cuenta nueva, **el operador eligió la cuenta de verificación**,
asumiendo que la sustitución por DOM cubriera lo que haga falta.

**Hallazgo real, no cubierto por el spike de §0.1:** el spike había probado sustituir el chip de
usuario y el login, pero el modal de Monitor de Partes muestra el estado REAL de la cuenta al
abrirse — la pestaña Partes trae las partes que la cuenta de verificación tenga guardadas de verdad
(potencialmente `DON COCHO`/`LA TOSTADORA MODERNA`, los mismos nombres que este guion ya había
decidido no usar en material público — ver §10). `demo-anonimizar.js` no cubría este caso.
**Resuelto reasignando la variable de caché `_monitorPartes` del propio `renderer.js` y llamando a
la función REAL `renderizarListaPartes()`** — no una tabla hecha a mano, el mismo código que pinta
en producción, con datos falsos — inmediatamente después de que el fetch real termina y ANTES de
capturar (misma regla de oro del §0.1: sustituir después de llegar a la pantalla, nunca antes).
Mismo mecanismo para la pestaña Expedientes, sobreescribiendo `#monitor-exp-tbody` directamente (acá
sin variable de caché reasignable — el dato va derecho del IPC al DOM — así que se reconstruye el
`<tr>` exacto que arma `verExpedientesMonitor()` en `renderer.js`, columna por columna).
**Verificado visualmente que funcionó:** la captura de 4.2 muestra únicamente "FCR · LÓPEZ CARLOS",
ningún nombre de la cuenta de verificación.

**Segundo hallazgo real: ningún paso de "estado en curso" o "resultado" dispara nada real.** El
guion ya pedía esto explícitamente para 2.3/6.3/6.4 ("evita gastar cupo", "no un GIF real de la
corrida") — se extendió el mismo criterio a 2.2, 3.5 y 6.2 (archivo "cargado" sin diálogo nativo) y
se aplicó de la forma más fiel posible: en vez de maquetar HTML a mano, se llama a las funciones
reales del renderer con datos falsos — `addLog()` para las líneas de consola (la misma función que
usa la app para cualquier log real), `markdownSetArchivo()` para el estado de dropzone cargado. Cero
click en "▶ Procurar", "Confirmar", "▶ Ejecutar", "📥 Consulta Inicial", "🔍 Buscar Novedades", "▶
Procesar" ni "📁 Seleccionar .txt/PDF" en todo el pipeline — confirmado por lectura del propio script
antes de correrlo, no solo por resultado.

**Detalle técnico: por qué el build usado es el LOCAL (`electron-app/dist/win-unpacked/`), no el
instalado.** `tests/daily/electron_driver.py` lanza el `.exe` instalado (2.7.50, sin Markdown — ver
§0.1 del plan). `capture_electron.py` reusa las piezas sueltas de ese módulo (`_esperar_cdp`,
`_login_si_hace_falta`, `assert_no_instance_running`, `close_app`) pero lanza el build local 2.7.51
en su lugar — la única forma de capturar el capítulo 6 (Markdown), que depende de ese release. Cero
duplicación de la lógica de CDP/login en sí.

**Verificado end-to-end, corrida real, primera vez sin iterar:** las 14 capturas de
`capture_electron.py` salieron bien en la primera corrida completa (arranque del build local, login
con la cuenta recordada, sustitución de chip aplicada, los 5 pasos de Procuración/Informe/Monitor/
Markdown, cierre limpio de la app confirmado por `close_app()`). Las 18 de
`capture_visores.py`/`capture_portal.py` necesitaron 2 rondas de fixes reales, encontrados
verificando cada imagen (no solo corriendo el script):
- El PDF placeholder de D2 salía en blanco en el Chromium que trae Playwright — **no tiene el visor
  de PDF integrado** (confirmado con un PDF mínimo de referencia conocido-funcional, no solo con el
  propio placeholder). Fix: `channel="chrome"` (el Chrome real instalado) en vez del Chromium por
  defecto.
- El mismo placeholder, ya con más contenido (carátula + movimientos, agregado en esta misma
  verificación para que la captura 3.4 no fuera un ".pdf" de una sola línea), salía con las tildes
  corrompidas (`GONZ\`LEZ` en vez de `GONZÁLEZ`) — el PDF no declaraba `/Encoding
  /WinAnsiEncoding`, así que el visor interpretaba los bytes con la codificación propia de Helvetica
  (sin acentos). Un em dash (fuera del rango Latin-1 con el que se escribe el archivo) se corrompía
  igual — normalizado a un guion simple antes de escribir.
- `stub-portal.js --demo` dejaba pasar el `SUGERENCIAS`/`PARTES` del seed de `/verify` sin vaciar
  (`FCR 99999/2026 DEMO c/ TEST s/ VERIFY`, visible en la primera captura real de Bitácora) — D2 no
  lo había cubierto porque esos 2 arrays no tienen fixture propio en la demo. Vaciados explícitamente
  en el bloque `--demo`.
- La ficha de "Mis Expedientes" mostraba "Situación actual: EN LETRA ()" con paréntesis vacíos — el
  fixture pasaba `situacion_fecha` como el string de display `"20/08/2026"`, no como fecha ISO
  parseable, y el portal la descarta silenciosamente. Agregado un conversor `DD/MM/AAAA → ISO` en
  `bitacora.js`.
- Un toast de "Vencimiento calculado" (de la calculadora de plazos, que sí funcionó correctamente en
  vivo) quedaba colado encima de la siguiente captura (Mi Plan) por no esperar a que se fuera solo.

**Higiene:** `.playwright-mcp/` y las capturas de diagnóstico (`_diag*.png`, PDFs/HTML de prueba)
limpiadas del repo en cada verificación — ninguna quedó commiteada. `backend-server/public/landing/
demo/assets/` **SÍ se versiona** (a diferencia de `demo-fixtures/output/`) — es el entregable final
del bloque, no un scratch regenerable sin costo (regenerarlo requiere la app Electron real + la
cuenta de verificación, no es gratis).

**Pendiente real para D5 (no bloquea nada de D3):** los 3 mockups de 6.6-6.8, y la decisión de qué
cuenta usar si se regenera esto más adelante (la de verificación sigue siendo la única disponible
hasta que exista una cuenta de demo dedicada).

---

## 13. D5 ejecutado (2026-08-27) — el tour, publicado en `backend-server/public/landing/demo/`

**Entregable real:** `backend-server/public/landing/demo/index.html`, un único archivo estático
(HTML + CSS + JS embebidos, sin `<link>`/`<script src>` externos salvo Google Fonts — mismo patrón
que ya usa `landing/index.html`, no una inconsistencia nueva), servido tal cual por Nginx.

**Sistema de diseño copiado literal del `:root` de `landing/index.html`** (ámbar `#d97706`, Inter +
Crimson Pro, las mismas sombras/radios) — no un `<link>` compartido, porque la landing tampoco expone
su CSS como archivo aparte. El marco de cada captura reusa el mismo patrón visual de ventana con
semáforo (●●●) que ya existía en el mockup del hero de la landing real, aplicado acá sobre capturas
REALES en vez de HTML de mentira.

**Navegación:** 8 pestañas de capítulo en el header (con scroll horizontal en mobile, todas visibles
en desktop) + un stepper por capítulo (flechas, puntos, contador "Paso N de M") + flechas de teclado
(← → avanzan de paso, y en el borde de un capítulo pasan al siguiente/anterior) + deep-link por
capítulo vía `location.hash` (`/demo/#bitacora`, etc., tal como pedía el plan) + paginador
capítulo-a-capítulo al pie de cada uno, con un botón "Probalo gratis" → `/register/` en cada uno.

**Los 32 pasos reales de D3 están integrados**, más:
- **6.6-6.8, resueltos como HTML/CSS en vivo, no como imágenes**: un mock de editor de código (línea
  numerada, tema oscuro, entidades enmascaradas resaltadas) para 6.6, y 2 mocks de chat neutro
  ("Asistente IA", sin nombrar ningún producto de terceros — mismo criterio que ya evitó nombrar
  ChatGPT/Claude/Gemini en la landing real) para 6.7-6.8. Cero dependencia de ningún sistema — se
  regeneran solas cada vez que se abre la página, no hace falta volver a capturar nada.
- **Los 8 pasos de D4** (1.1, 1.2, 8.1-8.5) quedan con una tarjeta de placeholder explícita
  ("📸 Captura pendiente — D4, captura manual del operador") en vez de una imagen rota — la página
  queda presentable y honesta mientras esas capturas no existan, y el reemplazo es mecánico: alcanza
  con agregar el archivo a `assets/<capítulo>/` y cambiar `placeholder:true` por `img:'...'` en el
  array `CHAPTERS` del script — no hace falta tocar la estructura del HTML.

**Bug real encontrado y corregido verificando en vivo, no solo leyendo el CSS:** en mobile (375px),
las pestañas de capítulo quedaban comprimidas a ~1.5px de ancho en vez de bajar a su propia fila.
Causa: `.chapter-nav { flex:1 }` tiene `flex-basis:0%` por el shorthand, así que a flexbox le
"alcanzaba" con ese resto mínimo de espacio en la primera fila y nunca las forzaba a la segunda,
pese a `flex-wrap:wrap` en el contenedor. Fix: `flex:1 1 100%` en el breakpoint de 960px, que le pide
el 100% del ancho como preferido y garantiza el salto de línea. Verificado con Playwright real en
375/768/1280 — los 3 anchos que pide el plan — no solo el desktop.

**No incluido a propósito (no era parte del alcance de D5):** el sistema de analytics/tracking
(`track()`, `session_id`) que sí tiene `landing/index.html` — el plan solo pedía el link a
`/register/`, no instrumentación de funnel. Se puede agregar después si se decide medir el tour por
separado, sin tocar la estructura actual.

---

## 14. D6 implementado (2026-08-27) — integración en landing + portal, con gate para clientes

**Ampliado respecto del alcance original del plan** (que era solo: navbar + hero + tarjetas +
despliegue), a pedido del operador — 2 decisiones nuevas, ninguna anticipada por D1-D5:

**A. Integración en `landing/index.html`** (lo que sí preveía el plan):
- Navbar: agregado `El problema` (→ `#problema`, no tenía link propio hasta ahora). `Ver demo`
  pasó POR el navbar en una iteración intermedia y se sacó de ahí en la definitiva — queda solo en
  el hero-adyacente (ver abajo), no duplicado en la barra superior.
- Hero: pasa de 2 a **3 botones** — `Empezar ahora` (primario, sin cambios) · `El problema`
  (→ `#problema`) · `La solución` (→ `#solucion`, el mockup estático que antes usaba
  `Ver cómo funciona`). `Ver demo` NO queda acá — 3 iteraciones hasta llegar a esta distribución:
  1ra, lo mové al navbar solo, sin confirmarlo explícitamente (el operador lo notó: "no quedó como
  se había propuesto"); 2da, lo puse como 4to botón del hero (lo que sí se había pedido
  originalmente); 3ra, el operador pidió sacarlo del hero (que quedó en 3) y ponerlo debajo del
  mockup de `#solucion` en su lugar — dejándolo TAMBIÉN en el navbar en ese momento; 4ta y
  definitiva, el operador pidió sacarlo del navbar también — queda en un solo lugar (debajo del
  mockup), no repetido en 2.
- Debajo del `app-frame` (el mockup falso) en `#solucion`: botón `Ver demo` (→ `/demo/`), como
  siguiente paso natural después de ver la ventana de mentira — "esto es un mockup, la demo real
  está acá".
- Las 6 tarjetas de función (`#features`) ganaron un link `Ver en la demo →` al pie, con deep-link
  directo a su capítulo (`.feat-demo-link`, nueva clase CSS).
- **Bug real encontrado de paso, no buscado:** el mockup de la app en `#solucion` (la ventana falsa
  del hero showcase) listaba los tabs `Procurar · Informe · Monitor · Descargas · Bitácora` — sin
  **Markdown**, quedado desactualizado desde que ese módulo salió a producción (2.7.51). Corregido
  agregando el tab `📝 Markdown` al mockup — mismo criterio que ya aplicó la sesión 2026-08-27 al
  encontrar el mismo gap en el propio guion original de D1.

**B. Gate de sesión en `/demo/index.html`** (nuevo, no estaba en el plan de D1-D5):
Decisión del operador, con el motivo explícito confirmado antes de tocar código (vía
`AskUserQuestion`): el resto de la demo (más allá de "El problema" y "Procuración") es **una guía
para clientes ya registrados**, no un gancho de venta — así que el gate es de UX, no de seguridad
real. Mecanismo: lee `localStorage.getItem('psc_user_token')` — el mismo token que ya usa el portal
(`usuarios/app.js`, `TOKEN_KEY='psc_user_token'`), legible directo porque `/demo/` vive en el mismo
origen que `/usuarios/`. Si no hay token: los 2 capítulos libres quedan como siempre, el resto
muestra 🔒 en la pestaña y, al entrar, una pantalla de "Iniciá sesión para ver el resto" con link al
portal — nunca un error ni una pantalla rota. **Deliberadamente no verificado contra el backend**
(no hay llamada a ningún endpoint protegido): si el token está vencido igual desbloquea, y lo peor
que pasa es que se ven 2 capítulos más de screenshots ya públicos — no hay nada sensible detrás.

**Bug real encontrado y corregido verificando en vivo, no solo leyendo el código:** con el gate
activo, las teclas ← → en un capítulo bloqueado llamaban a `stepBy()`, que intenta actualizar
elementos del stepper (`#stepDots`, `#prevStepBtn`, etc.) que **no existen en el DOM** cuando el
capítulo está bloqueado (la pantalla de "Iniciá sesión" no tiene stepper) — hubiera roto con un
`TypeError` en el primer ← → de un visitante sin sesión. Corregido: el handler de teclado detecta el
capítulo bloqueado primero y solo permite saltar de capítulo entero, nunca de paso.

**C. Entradas en el portal** (`usuarios/index.html`, código YA en producción — Etapa 1.3 cerrada):
- Ítem **"🎬 Ver demo"** en el sidebar, antes de "Ayuda" — un `<a href="/demo/" target="_blank">`
  simple, no un `data-section` más (la demo no es una sección de la SPA del portal, así que no puede
  usar `navigateTo()`).
- Ícono ▶ junto a "Enviar comentario" en el topbar, mismo destino, misma clase `.btn-feedback` que
  ya existía — reusa el estilo, no inventa uno nuevo.
- Verificado en vivo contra `stub-portal.js --demo` (login real con el flujo del stub, no solo
  lectura de HTML): ambos links aparecen con `href="/demo/"` y `target="_blank"` correctos, sin
  romper el resto de la navegación de la SPA (`navigateTo()` ignora el `<a>` nuevo porque no tiene
  `data-section`, confirmado leyendo el código antes de asumirlo).

**D. Despliegue — EJECUTADO (2026-08-27), verificado en vivo.**

🔍 **Hallazgo real de infraestructura, no anticipado por el plan:** `staging-api.procuradortool.com`
**no puede servir nunca la landing ni `/demo/`** — no es un bug del deploy, es cómo está armado el
servidor. Los 3 vhosts de Nginx relevantes:
- `api.procuradortool.com` (prod) y `staging-api.procuradortool.com` (staging): **puro proxy** a
  Express (`localhost:3443`/`:3444`), sin ningún bloque estático.
- La landing la sirve un **4to vhost separado**, `procuradortool.com` (`root
  /var/www/procurador/backend-server/public/landing` fijo) — apunta solo al directorio de
  **producción**. No existe un `staging.procuradortool.com` equivalente.

Consecuencia: la verificación en staging quedó acotada a lo que SÍ se puede probar ahí — integridad
de archivo (`md5sum` servidor = local, confirmado en los 3 HTML + las 32 capturas) y que `/usuarios/`
(que sí pasa por Express) responde 200. El comportamiento real de `/demo/` en un navegador solo se
pudo confirmar en producción — cubierto por la verificación live de abajo, con el mismo criterio de
"nunca romper nada real" que ya tenía todo lo anterior (cero flujo real disparado, solo lectura).

**Secuencia real ejecutada** (`runbook-comandos.md`, adaptada a archivos estáticos — sin
`pm2 restart`, ninguno de estos 3 archivos pasa por Express):
1. Backup de `landing/index.html` y `usuarios/index.html` en staging Y en producción, a
   `/tmp/<archivo>.pre-D6-{staging,prod}_<timestamp>` (patrón ya usado en despliegues anteriores del
   proyecto).
2. `scp` a staging → verificado por `md5sum` (100% coincidencia) → **a producción recién con
   confirmación explícita del operador** ("dale, seguimos con producción").
3. `scp` a producción → mismo `md5sum` (100% coincidencia, los 3 HTML + 32 PNGs).
4. Verificación real contra el sitio en vivo:
   - `curl` a `https://procuradortool.com/`, `/demo/`, `/demo/index.html` y una captura de
     `/demo/assets/...` → **200 en los 4**.
   - Contenido confirmado por `grep` sobre la respuesta real: "Ver demo" presente, tab "Markdown"
     presente en el mockup.
   - `/usuarios/` → 200, "Ver demo" aparece 5 veces en el HTML servido (sidebar + ícono, título +
     aria-label).
   - `pm2 list`: ambos procesos (`procurador-api`, `procurador-staging`) `online`, sin reinicios.
   - `pm2 logs procurador-api` (últimas 15 líneas): sin errores nuevos — solo actividad rutinaria
     (rate-limit de un login ajeno, cacheo de scripts firmados).
   - **Pasada de navegador real con Playwright contra `https://procuradortool.com/` y
     `https://procuradortool.com/demo/#markdown`**: 0 errores de consola en ambas, el gate de sesión
     mostrando correctamente la pantalla de bloqueo (sin token real en ese navegador — el
     comportamiento esperado y diseñado).

Con esto, **D6 queda completo — landing, `/demo/`, y las entradas del portal, todo en producción y
verificado**. Lo único que sigue pendiente de la Etapa 1.6 completa es **D4** (las 7 capturas
manuales del operador — extensión + PJN), sin fecha ni dependencia técnica.
