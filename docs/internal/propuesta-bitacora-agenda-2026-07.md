# Propuesta de mejora — Módulo "Bitácora" (agenda, tareas, gestiones y notas por expediente)

> Documento de propuesta · v3 · 2026-07-05 · Estado: **borrador para evaluación** (no aprobado, no en desarrollo)
> Referencia de inspiración funcional: manual Lex-Doctor 11 (Agenda §XIII, Gestiones §XIV) + UX de Google Calendar / Google Tasks.
> Cambios v2: se reemplaza el "historial de procuraciones en la nube" por el modelo **Expediente seguido** (ficha por caso + historial acotado a hasta 2 procuraciones y hasta 2 informes); captura confirmada por deep-link (opción A); avisos solo in-app (sin email); píldora "Establecer como principal" en Mi Plan / Bitácora; gating por plan; integración Google descartada por ahora.
> Cambios v3: **selección múltiple** en la tabla de los visores (captura en lote) + link 📁 a la ficha de casos ya seguidos; **exportación** (Excel legible + JSON restaurable, global y por caso) e **importación/restauración** desde backup con modos reemplazar/combinar, vista previa dry-run y respaldo automático previo.
> Cambios v4: alta **manual** de expedientes explicitada; ficha = vista integral del caso (datos + bitácora + historial) vs. sección Bitácora = vista temporal (calendario); **personalización de la ficha** (orden de secciones, registros visibles, modal "ver todos"); deep-links con **pestaña única reutilizada** (`target` fijo), sesión en uso sin re-login y botón Volver coherente vía History API.
> Cambios v5: sección de **autosuficiencia y fuentes**; **riesgo y complejidad explicados sin tecnicismos** (qué se toca en web y app, qué no se toca, reversibilidad); **estimación de costos** con números reales del servidor; alcance del historial precisado (**2+2 POR CASO**, alimentado por cada corrida); límite del querystring explicado y regla de recorte; **historial con selector última/anteúltima + modal**; botones "💾 Guardar procuración/informe" en visores (selección múltiple y modal del caso); **filtros y agrupación** en la vista global; **campos por tipo de entrada** orientados a la práctica jurídica (ref. Lex-Doctor + Google); vencimientos visibles en la ficha; edición global y por caso con acciones masivas; sección de **preguntas abiertas**.
> Cambios v6: **se desacopla "guardar ficha básica" de "guardar snapshot de procuración/informe"** (dos acciones independientes en vez de una combinada); **se reemplaza el mecanismo de transporte** de GET-por-querystring a **POST por formulario oculto autoenviado** (misma pestaña con nombre fijo, sin CORS, pero sin el límite práctico de ~2.000 caracteres — elimina la restricción de "hasta 10 casos sin movimientos" del modo lote); **el botón de Bitácora se muda del sidebar al topbar** (una sola aparición, en la misma barra que los tabs Procurar/Informe/Monitor/Descargas y el botón de cerrar ventana); **se agrega el paso del tour de onboarding** que faltaba para explicar el botón nuevo.
> Cambios v6.1: se agrega la **evaluación técnica del transporte POST** (§4.1.1) con la cadena de límites reales, tamaños medidos en corridas reales (1 expediente ≈4,2KB, tope `maxMovimientos`=15), tabla de escenarios (individual/lote/corrida grande), la inflación por URL-encoding y su mitigación, y el patrón **Post/Redirect/Get** para que la SPA reciba el payload con URL limpia. Conclusión: tras subir el límite del body, no hay límite práctico para los tamaños reales (corrida de 100 exp. ≈400KB entra con >10× de margen).
> **Revisión 2026-07-19 (Fable/Sonnet):** validada contra el código real. **3 inconsistencias corregidas** — (1) §4.1.1: Nginx **ya está en 20M** (no 1MB); la instrucción de "subir a 5m" era un downgrade → corregida a "no tocar Nginx". (2) §4.1.1 + §11.2: el fix del body-limit de Express estaba mal planteado (los parsers son globales y la captura usa `urlencoded`, no `json`) → corregido con el matiz de orden de parsers. (3) §11 Fase 1.1: decía "2 columnas", el modelo §7 define **3** (`bitacora_enabled`, `home_section`, `bitacora_prefs`) → corregido. **Verificado correcto:** la claim del tour (§11 F2.7, `target:'.tab-nav'` paso 2) coincide con `onboarding/tour.js` real. **Agregado:** §11.1 con **modelo (Sonnet/Opus) y nivel de esfuerzo por sub-bloque**. Sigue siendo propuesta NO aprobada.
> **Revisión 2ª pasada 2026-07-19 (pre-ejecución):** **2 correcciones adicionales que habrían hecho fallar la implementación** — (4) §7: el `UNIQUE(user_id, jurisdiccion, expediente)` con `jurisdiccion` nullable **no deduplica** (los NULL son distintos entre sí en Postgres → fichas duplicadas y el `ON CONFLICT` del upsert nunca matchearía); fix: `jurisdiccion NOT NULL DEFAULT ''` (o índice único con `COALESCE`). (5) §4.1.1: se explicita que `POST /usuarios/capture` llega **sin autenticación** (un form no puede mandar `Authorization`; el diseño "sin tokens en el payload" es correcto) → se especifican las 5 protecciones obligatorias del patrón borrador-anónimo→reclamo-autenticado (id no adivinable, TTL+uso único+tope, rate-limit dedicado, payload no confiable que no persiste hasta confirmar, punto de montaje antes del static con parser propio).
> **Revisión 2026-07-25 (Opus, verificación de cohesión contra el código real y el plan de fases):** **6 hallazgos técnicos.** (6) **§2/§4.4 — la premisa "todos los visores inyectan `DATOS_BATCH` vía `generador_visor.js`" es FALSA**: solo el visor de **informe batch** usa ese mecanismo; los visores de **procuración** (individual, por fecha, lote) los generan los **scripts encriptados** (`procesarNovedadesCompleto.js`, `procesarCustomExpedientes.js`), que inyectan los datos con un placeholder distinto (`datosEmbebidos`/`<!-- DATOS_EMBEBIDOS -->`) — `main.js` no controla ese payload. Corregido: la botonera HTML se agrega igual (vía `visorModal_template.html`, que va como `extraResources`, sin tocar scripts), pero los datos por usuario (`bitacoraEnabled`, marcado de "casos ya seguidos") requieren que **`main.js` post-procese el HTML ya generado** antes de abrirlo (inyectando un `<script>` con la config), no una edición de los scripts encriptados. Sin riesgo de tocarlos, pero es un paso más en F2.1. (7) **Falta ABM de feriados**: Q11 dice "el admin los mantiene" pero ninguna fase lo construye — agregado F1.8. (8) **`capture-lote` sin tope de filas**: el rate-limit (30/5min) limita frecuencia, no volumen por request; agregado cap explícito de 200 casos/lote. (9) **Recorte 2+2 no atómico**: "DELETE del más viejo… lógica de aplicación" puede dejar 3+ snapshots con capturas simultáneas del mismo caso; debe ir en la misma transacción del insert. (10) **Contradicción de gating**: §8 dice "middleware en TODOS los endpoints… es el gate real" pero §5.3/Q6 prometen exportación disponible 90 días tras perder el plan — incompatibles sin un carve-out explícito en el middleware para `/bitacora/export`. (11) Referencias desactualizadas: `server.js:84/87` son hoy `110/113`; la opción (b) del body-limit (subir el `express.urlencoded` global) queda descartada, no como alternativa — reabriría el problema que motivó el cap de C5 (revisión de bugs 2026-07-25); y `/usuarios/capture` **no** debe agregarse a `PUBLIC_OPEN_CORS_PATHS` (array que no existía cuando se escribió esta propuesta, agregado luego para `/analytics/event`) — el capture es una navegación de formulario, no un `fetch`, no necesita esa entrada.
> **6 hallazgos de cohesión del plan de fases** (mismo repaso): (12) §11 Fase 1 (7 puntos) y §11.1 (7 sub-bloques F1.1–F1.7) no mapean 1:1 — el punto 3 de §11 se parte en F1.3+F1.4, los puntos 4-5 se juntan en F1.5 → renumerados los puntos de §11 para que coincidan exactamente con §11.1. (13) El endpoint `capture` (con su parser de 5MB, rate-limit dedicado y PRG) se construía en Fase 1 pero su único consumidor (los visores) es Fase 2 — es además el único endpoint anónimo de todo el sistema: se **movió a Fase 2**, junto a quien lo usa. (14) El deliverable de Fase 2 decía "un release de Electron" pero el punto 3 (`GET /client/bitacora/seguidos`) es un endpoint de backend nuevo — aclarado: Fase 2 = deploy de backend + release de Electron. (15) La salvaguarda de importación (backup automático antes de aplicar, §5.3) depende de que la exportación ya funcione — F1.6 pasa a ser dependencia dura de F1.7, no solo orden sugerido. (16) §9.3 y §11.1 no cerraban entre sí (§11.1 le da a un solo sub-bloque, F1.3, el presupuesto que §9.3 había dado a Fase 1 portal completa) — reconciliado, total realista **~10-14 sesiones**, no 7-10. (17) Nota de producto agregada: la Fase 1 sola no tiene diferencial (la propuesta de valor —"un clic desde la procuración"— es Fase 2) → no anunciar/vender la Bitácora al cerrar Fase 1, esa fase es para validación interna con el flag encendido en un plan de prueba. Detalle en `docs/internal/revision-bugs-2026-07-25c.md`.
> **Revisión de cohesión 2026-07-27 (Opus, contra el plan de correcciones E1-E6):** verificados los 2 prerrequisitos duros (Bloque B.1 → desbloquea F1.1; Bloque D/E4-1 → desbloquea F2.1/F2.3), agregados como recuadros en §4.1 y §7. Detalle en `docs/internal/revision-bitacora-vs-correcciones-2026-07-27.md`.
> **✅ Revisión de pre-implementación 2026-08-12 (Opus):** verificación contra el código y la base **reales** de esa fecha (los 2 prerrequisitos de julio ya estaban cumplidos solos). **2 hallazgos nuevos de riesgo alto, corregidos en el documento:** N1 — la regla de deduplicación del expediente no contemplaba ceros a la izquierda (mismo bug que `debb503`, ya en producción una vez); fix: columna `expediente_key` normalizada (§7), reusando `tokenizar()` de `buscarPdfExpediente.js`. N2 — el punto de enganche del post-procesado de F2.1 no estaba definido y la inyección propuesta no era idempotente; resuelto en §4.4 (enganche una sola vez, al terminar la corrida; reemplazo contra marcador, no `append`). Detalle: `docs/internal/revision-bitacora-preimplementacion-2026-08-12.md`.
> **✅ Las 13 decisiones de diseño CONFIRMADAS 2026-08-12** (las 12 preguntas de §13 + el hallazgo N1/D1, que no era pregunta original pero requería resolución) — el operador aceptó la solución propuesta en cada punto, sin cambios. Volcadas en §4.4, §7, §8, §12 y §13 de este documento. Detalle con justificación completa: `docs/internal/bitacora-decisiones-pendientes-2026-08-12.md`. **No queda ninguna pregunta de diseño abierta para arrancar F1.1.** Sigue siendo propuesta **NO aprobada para implementación** — confirmar las decisiones de diseño es distinto de decidir ejecutar el plan.

---

## 0. Autosuficiencia del documento y fuentes

**Este documento es autosuficiente para evaluar y para implementar la mejora**: todo lo que se tomó como inspiración externa ya está volcado acá adentro (los tipos de agendamiento, el esquema de campos, el mecanismo de avisos y el concepto de gestiones provienen del manual de Lex-Doctor 11 y están adaptados y especificados en §3; los patrones de interacción de calendario y lista de tareas provienen de Google Calendar/Tasks y están descriptos en los mockups y flujos). **No hace falta tener a mano ninguna fuente externa para trabajar con este plan.**

Referencias, por si se quisiera profundizar (opcional, no requerido):
- **Manual de Lex-Doctor 11** (convertido a Markdown): `C:\Users\JONATHAN\Desktop\variete\man_usuario_lex11.md` — útil solo si a futuro se quisiera inspirar OTRO módulo (caja, facturación a clientes, modelos de escritos); para la Bitácora ya no aporta nada que no esté acá. Secciones usadas: Agenda (§XIII), Gestiones (§XIV).
- **Google Calendar / Google Tasks**: conceptos de UX públicos y consultables en internet en cualquier momento; no se usa ninguna API ni servicio de Google (descartado en §12), solo el patrón de interacción.

---

## 1. Resumen ejecutivo

Se propone incorporar a Procurador SCW un módulo de organización del trabajo del abogado —nombre: **Bitácora**— compuesto por dos piezas que se alimentan mutuamente:

1. **Entradas de bitácora**: vencimientos, audiencias, tareas, gestiones y notas, con vista calendario + lista de pendientes estilo Google Calendar/Tasks, gestionadas desde el portal del usuario.
2. **Expedientes seguidos**: una ficha liviana por caso (expediente, jurisdicción, dependencia, carátula, situación actual) que se crea automáticamente la primera vez que el usuario genera una entrada de bitácora sobre ese caso desde un visor, y que acumula las entradas siguientes. Cada ficha guarda un **historial acotado**: **hasta 2 procuraciones y hasta 2 informes** del caso (los más recientes, con qué se obtuvo en cada uno), para no saturar la base. La captura desde el visor funciona en dos niveles: **selección múltiple** en la tabla general (varios casos de una vez) y **captura individual** desde la fila o el modal de cada caso; los casos ya guardados muestran un **link 📁 a su ficha** con todo lo registrado.

**El circuito completo:** el abogado procura → el visor HTML muestra los resultados → con un clic en un expediente crea un vencimiento/tarea/nota → esa acción crea (o actualiza) la ficha del caso en su panel, con la foto de la procuración → desde el portal consulta el calendario, confirma lo realizado con un check, edita la ficha o elimina el seguimiento del caso cuando terminó.

**Diferenciador:** en Lex-Doctor y similares la agenda y los expedientes se cargan 100% a mano. Acá el dato nace de la automatización que ya corre todos los días — el expediente se "sigue solo" a partir del primer uso real.

Puntos fijados en esta versión:
- Captura desde visores por **deep-link al portal** (opción A de la v1) — sin tokens embebidos, sin CORS nuevo.
- Visores que capturan: **procuración individual, procuración batch, informe individual e informe batch** (el informe individual hoy no genera visor — ver §5.3, se propone generar un mini-visor reutilizando el template existente).
- **Avisos solo dentro de la Bitácora** (banner superior al ingresar), sin emails.
- **Check de realización** en vencimientos y tareas; los vencidos sin confirmar se muestran hasta 7 días hacia atrás (con "ver anteriores") y los próximos 7 días hacia adelante (con "ver más").
- **Bitácora habilitable por plan** (gating comercial), lo que activa/oculta las opciones tanto en los visores como en el portal.
- **Sin integración con Google** por ahora.

---

## 2. Contexto actual (qué ya tenemos y se reutiliza)

| Pieza existente | Rol en la propuesta |
|---|---|
| Visores HTML (`visorModal_template.html`, visor de informes) | Punto de captura. Ya inyectan un JSON con expediente, carátula, dependencia, situación y movimientos — todo lo necesario para pre-cargar la ficha del caso y la entrada. ⚠️ **Dos mecanismos distintos** (ver §4.4): el visor de **informe batch** lo genera `generador_visor.js` (Electron) con la variable `DATOS_BATCH`; los visores de **procuración** los generan los **scripts encriptados** con la variable `datosEmbebidos` — `main.js` no controla ese payload directamente. |
| Portal `/usuarios/` (SPA vanilla, secciones por `goto=`, SSO desde Electron) | Casa del módulo: secciones **Bitácora** y **Mis expedientes**. |
| Backend Express + PostgreSQL | 3 tablas nuevas + endpoints CRUD. Sin dependencias nuevas. |
| Notificaciones in-app (`user_notifications`) | No se usan para los avisos de bitácora (los avisos viven en el banner de la propia Bitácora), pero quedan disponibles para hitos puntuales si hiciera falta. |
| Tabla `plans` + `/client/account` | Gating por plan: flag `bitacora_enabled` expuesto a la app y al portal. |
| App Electron (topbar, `openPortalSection`) | Acceso rápido a la Bitácora del portal vía SSO + generación condicional de los botones en los visores. |

---

## 3. Modelo funcional

### 3.1 Expediente seguido (la ficha del caso)

Es la unidad central del módulo. Contiene:

| Campo | Origen | Editable por el usuario |
|---|---|---|
| Expediente (número/año) | del visor (o carga manual) | Sí |
| Jurisdicción | del visor | Sí |
| Dependencia | del visor | Sí |
| Carátula | del visor | Sí |
| Situación actual (última registrada) | del visor — se **actualiza** con cada nueva captura sobre el caso | Sí |
| Fecha de la situación | fecha de la corrida que la registró | — |
| Notas del caso | libre | Sí |

**Reglas de vida de la ficha:**
- **Creación por dos vías**: (a) **automática**, la primera vez que el usuario genera una entrada de bitácora (o guarda el caso) desde un visor; (b) **manual**, desde el botón "＋ Agregar" de Mis expedientes — formulario con los mismos campos de la ficha (expediente, jurisdicción, dependencia, carátula, situación, notas). Un caso creado a mano es idéntico a uno capturado: si después se lo captura desde un visor, el upsert lo reconoce por la clave jurisdicción+expediente y le suma el snapshot (no duplica). Sirve para casos que el abogado quiere agendar antes de haberlos procurado nunca.
- **Acumulación**: si ya existe la ficha (misma jurisdicción + expediente), una nueva captura **no duplica**: agrega la entrada de bitácora a la ficha existente, actualiza la situación actual y suma el snapshot al historial.
- **Historial acotado — hasta 2 de cada tipo, POR CASO (definición precisa)**: el tope es **por expediente seguido**, no global ni por corrida. Cada caso guardado conserva **su propio** historial: como máximo sus últimas 2 procuraciones y sus últimos 2 informes. Lo que se guarda no es "la corrida" entera sino **la porción de esa corrida que corresponde a ese caso** (su situación, sus movimientos): una corrida de lote con 30 expedientes alimenta con un snapshot a cada caso seguido que aparezca en ella, cada uno por separado. Ejemplo: el caso A tiene guardadas sus procuraciones del 05/07 y del 28/06 y un informe del 15/06; el caso B, procurado en las mismas corridas, tiene las suyas propias; el caso C, capturado solo desde informes, tiene 2 informes y ninguna procuración. Es un tope, no una garantía: cada caso tiene 0, 1 o 2 de cada tipo según cómo se lo haya usado. Al entrar un tercer snapshot del mismo tipo **en ese caso**, se elimina el más viejo **de ese caso**. La base queda liviana de forma estructural (máximo 4 snapshots por caso), sin crons de limpieza.
- **Edición**: todos los campos editables desde la ficha en el portal.
- **Eliminación del seguimiento**: botón "Eliminar seguimiento" con confirmación. Al eliminar, el usuario elige si las entradas de bitácora vinculadas **se conservan como sueltas** (default, no pierde sus vencimientos) o **se eliminan también**.

### 3.2 Entradas de bitácora

| Tipo | Color | Fecha | Check de realización |
|---|---|---|---|
| **Vencimiento** | rojo | obligatoria | Sí |
| **Audiencia** | violeta | obligatoria | Sí |
| **Tarea** | azul | opcional | Sí |
| **Gestión** | ámbar | opcional (salida/regreso) | Sí |
| **Nota** | gris | fecha de creación | No (es un registro, no un pendiente) |

- Toda entrada puede estar **vinculada a un expediente seguido** o ser **suelta** (recordatorio general del estudio). Las vinculadas viven en **dos vistas a la vez**: aparecen en la **ficha del caso** (junto con sus datos y su historial — la vista "por caso") y en el **calendario/lista de la Bitácora** (mezcladas con las de todos los casos y las sueltas — la vista "por tiempo"). Son los mismos registros vistos con dos lentes: la ficha responde "¿qué pasa con este expediente?", el calendario responde "¿qué tengo que hacer esta semana?".
- **Check de realización**: un clic marca la entrada como hecha (guarda fecha/hora de confirmación). Se puede deshacer. Es el mecanismo central de control: lo no checkeado sigue reclamando atención en el banner de avisos.
- **Repetición** simple (semanal/mensual/anual) para recordatorios fijos.
- **Calculadora de plazos procesales**: al crear un vencimiento, opción "hoy + N días hábiles" que calcula la fecha salteando fines de semana y feriados (tabla de feriados nacionales AR + ferias judiciales, editable por el admin). Feature de altísimo valor percibido para el destinatario (abogado/operador judicial) y barata de construir.

#### Campos por tipo de entrada (definición)

> Referencias adaptadas: Lex-Doctor 11 define el agendamiento con tipo (Tarea/Audiencia/Compromiso/Vencimiento), estado hecho/no hecho, fecha y hora, repetición, descripción, responsable, proceso vinculado y aviso con anticipación; Google Calendar/Tasks aportan el patrón título + fecha/hora + todo-el-día + repetición + notas. Lo siguiente es la síntesis orientada a la procuración jurídica, para una cuenta de un solo abogado (sin campo "responsable" en v1).

**Campos comunes a todos los tipos:**

| Campo | Detalle |
|---|---|
| Título | obligatorio, corto (ej. "Contestar traslado") |
| Descripción | libre, opcional; al capturar desde un visor viene pre-cargada con el movimiento |
| Expediente vinculado | opcional — autocompletar sobre Mis expedientes, o vacío (entrada suelta) |
| Estado | pendiente / hecho, con fecha-hora de confirmación (el check) — no aplica a Nota |
| Origen | manual / visor de procuración / visor de informe (automático, no editable) |

**Campos específicos por tipo:**

| Tipo | Campos propios | Notas de uso jurídico |
|---|---|---|
| **Vencimiento** | Fecha límite (obligatoria, con calculadora de días hábiles) · Aviso: días de anticipación (default 5) · Carácter: procesal / extraprocesal (opcional) | El tipo central de la práctica: cargas procesales, plazos de recursos, caducidades. La fecha calculada muestra el detalle ("hoy + 5 hábiles = 14/07, saltea feria") |
| **Audiencia** | Fecha **y hora** (no es todo-el-día) · Lugar / sala (texto) · Modalidad: presencial / virtual (con campo para el link) · Aviso (default 3 días) | Testimoniales, conciliaciones, vistas de causa |
| **Tarea** | Fecha opcional (sin fecha = pendiente permanente en el panel de tareas) | Preparar escritos, armar prueba, llamar al cliente — el gesto Google Tasks |
| **Gestión** | Fecha prevista · Organismo / lugar (texto: "Juzgado Federal 2", "Colegio de Abogados") · Estado ampliado: pendiente / realizada / a reintentar | Trámite presencial o extraprocesal (retirar cédula, diligenciar oficio, presentación en mesa de entradas) — tomado de Gestiones de Lex-Doctor, simplificado |
| **Nota** | Solo título + texto (fecha = la de creación; sin check) | Registro de bitácora puro: "hablé con el cliente, acepta el acuerdo" |

- Los campos específicos se guardan en una columna flexible (`meta JSONB`) — agregar un campo futuro a un tipo no requiere migración.
- **Edición global y por caso — mismas entradas, dos puertas**: una entrada se puede editar tanto desde la vista global de la Bitácora (calendario/lista) como desde la ficha de su expediente; es **el mismo registro** — el cambio se ve al instante en ambas vistas. Además, la vista de lista permite **acciones masivas**: tildar varias entradas y marcarlas hechas / eliminarlas / moverlas de fecha en un solo paso.

### 3.3 Avisos y recordatorios (solo in-app, sin email)

Los avisos viven **dentro de la Bitácora**, en un banner superior que se muestra al ingresar a la sección (y por lo tanto al iniciar sesión, si la Bitácora es la pantalla principal):

```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ VENCIDOS SIN CONFIRMAR (3)                    [ver anteriores] │
│  ☐ 01/07 Vencimiento — Contestar traslado · FCR 1234/2021        │
│  ☐ 03/07 Tarea — Retirar cédula · CIV 887/2023                   │
│  ☐ 04/07 Vencimiento — Apelar honorarios · (suelta)              │
├──────────────────────────────────────────────────────────────────┤
│ 📅 PRÓXIMOS 7 DÍAS (2)                                 [ver más] │
│  ☐ 08/07 Audiencia — Testimonial · FCR 1234/2021                 │
│  ☐ 11/07 Vencimiento — Ofrecer prueba · COM 456/2024             │
└──────────────────────────────────────────────────────────────────┘
```

- **Vencidos sin confirmar**: entradas con fecha pasada y sin check, mostrando por defecto **hasta 7 días de antigüedad**; el botón "ver anteriores" expande la ventana (14/30 días/todos). Nada desaparece solo: lo que no se checkeó sigue existiendo, solo que colapsado para no abrumar.
- **Próximos**: ventana default de **7 días hacia adelante**, con "ver más" (14/30 días).
- El **checkbox está en el propio aviso**: confirmar una realización es un clic, sin abrir la entrada.
- Sin emails ni notificaciones push: el abogado ve sus vencimientos al entrar, que es el hábito que el producto quiere construir. (Si más adelante se pide un resumen por email, la infraestructura de `mailer.js` existe — queda explícitamente fuera de esta versión.)

### 3.4 Pantalla principal configurable (píldora "Establecer como principal")

En el portal, las secciones **Mi Plan** y **Bitácora** llevan arriba una píldora/toggle:

```
Mi Plan      [ ★ Es tu pantalla principal ]        ← estado activo
Bitácora     [ ☆ Establecer como principal ]       ← estado disponible
```

- Son **mutuamente excluyentes**: activar una desactiva la otra (una sola preferencia `home_section` por usuario).
- Efecto: al iniciar sesión en el portal (o al entrar por SSO sin `goto=` explícito), se abre la sección elegida.
- Default para usuarios existentes: Mi Plan (comportamiento actual, sin sorpresas).

---

## 4. Captura desde los visores — diseño técnico

### 4.1 Mecanismo: deep-link al portal, por formulario POST (opción A revisada)

Los visores son HTML estáticos abiertos con `file://`, sin sesión. **Se descartó el link GET con datos en el querystring** (ver el porqué abajo) a favor de un **formulario HTML oculto que se autoenvía por POST** al hacer clic:

```html
<form id="pscBitacoraForm" method="POST"
      action="https://api.procuradortool.com/usuarios/capture"
      target="procurador_portal" style="display:none">
  <input name="goto"     value="bitacora-nueva">
  <input name="tipo"     value="vencimiento">
  <input name="exp"      value="FCR 1234/2021">
  <input name="jur">  <input name="dep">  <input name="car">
  <input name="sit">  <input name="fproc" value="2026-07-05">
  <input name="origen"   value="procuracion">
  <input name="movs">  <!-- JSON de movimientos, sin recortar -->
</form>
<script>document.getElementById('pscBitacoraForm').submit();</script>
```

y el navegador navega la pestaña `procurador_portal` a ese POST. El portal (con sesión activa, o tras login) abre el modal "Nueva entrada" **pre-cargado** con los datos del caso y el snapshot completo de la corrida.

- **Por qué POST-formulario y no GET-link (el cambio de esta versión):** un envío de `<form>` es una **navegación de página completa** —igual que hacer clic en un link—, **no** una llamada `fetch`/AJAX; por eso **no dispara CORS** aunque el origen sea `file://null`, exactamente la misma propiedad que tenía el link GET. La diferencia es dónde viajan los datos: un GET los lleva en la **URL** (limitada a ~2.000 caracteres prácticos); un POST los lleva en el **body de la petición**, sin ese límite (el único tope pasa a ser el `body-parser` del servidor, configurable a varios MB — trivial para cualquier snapshot real). **Resultado: desaparece la necesidad de recortar movimientos o de limitar la selección múltiple a 10 casos** (ver §4.2, corregido más abajo). El único costo es que el botón dispara un formulario invisible en vez de ser un link — imperceptible para el usuario, sigue siendo "un clic".
- **Sin token embebido en el HTML** (que sería compartible por error) — el POST no necesita transportar credenciales, solo los datos del caso ya conocidos por el usuario.

> 🔴 **CORRECCIÓN CRÍTICA (2026-07-27, hallazgo E4-1 de `revision-E4-2026-07-27.md`) — los `value=""` del formulario deben ir ESCAPADOS.** El formulario de arriba inyecta datos crudos del PJN dentro de **atributos HTML** (`value="FCR 1234/2021"`, y sobre todo `<input name="car">` con la carátula y `<input name="movs">` con el JSON de movimientos). La revisión E4 confirmó que `visorModal_template.html` **hoy no escapa nada** (5 campos de texto libre del PJN interpolados vía `innerHTML`, cero mitigación, sin CSP) — si la Bitácora agrega estos `value=""` con el mismo criterio, **suma puntos de inyección nuevos y en un contexto más peligroso**: en atributo, una comilla en la carátula (`RUIZ c/ "LA CAJA" S.A.`) rompe el HTML aunque el texto sea inocente, y una comilla maliciosa cierra el atributo e inyecta markup.
>
> **Qué hacer al implementar F2.1/F2.3:**
> 1. **Prerrequisito:** el fix E4-1 (Bloque D del `plan-correcciones-E1-E6-2026-07-27.md`) debe estar aplicado **antes** — ese fix introduce en el template la función `esc()` que ya existe y funciona en producción en `generarVisorMonitoreo()` (`main.js:2286`).
> 2. **Escape de atributo, no de contenido:** `esc()` (la de `generarVisorMonitoreo`) escapa `&`, `<`, `>` — **no escapa comillas**, así que **no alcanza para un `value=""`**. Para los atributos del formulario usar una variante que además escape `"` y `'`, equivalente al `escAttr()` que el dashboard admin ya tiene (`dashboard.js:2037`, introducido por el fix XSS-1). Es decir: **`esc()` para el contenido de las celdas, `escAttr()` para los `value=""` del form.**
> 3. **Aplica a todos los campos derivados del PJN** que viajen en el formulario: `exp`, `jur`, `dep`, `car`, `sit`, y el JSON de `movs` (que además debe ir serializado con `JSON.stringify` y luego escapado como atributo).
>
> Sin esto, la Fase 2 reintroduciría —ampliándolo— exactamente el hallazgo que el Bloque D corrige.
- Cuando el visor se abre automáticamente desde la app (flujo principal), el formulario puede llevar además el hash SSO como ya hace `openPortalSection` → el usuario cae **logueado, con el modal abierto y los campos completos**: 1 clic + guardar.
- Si el usuario reabre el HTML días después desde la carpeta, pasa por el login del portal y sigue el mismo flujo (aceptable).
- **Enlaces livianos siguen siendo GET simples**: no todo necesita el formulario — un link "Ver ficha" (`goto=expediente&id=…`, sin payload de datos) sigue siendo un `<a>` normal; el POST-formulario se usa solo donde viaja un snapshot o una selección múltiple.

#### 4.1.1 Límites reales, tamaños medidos y patrón de recepción (evaluación técnica)

Como el POST reemplaza el tope de ~2.000 caracteres de la URL por el tope del body del servidor —que es **configuración nuestra**—, conviene dejar los números concretos para quien implemente.

**La cadena de límites (cada capa con su tope por defecto):**

| Capa | Límite actual (verificado 2026-07-19) | ¿Quién lo controla? |
|---|---|---|
| Navegador (form POST) | Sin límite práctico (a diferencia de una URL) | — |
| **Nginx** (`client_max_body_size`) | **20 MB** (ya configurado en prod Y staging — `sites-available/procurador` y `staging-procurador`) | Nosotros (config del server) |
| **Express** (`express.urlencoded` GLOBAL) | **100 KB** (default; sin `limit:` explícito — verificar el número de línea actual en `server.js` al implementar, ver nota 2026-07-25 abajo) | Nosotros |

> ⚠️ **Corrección técnica (2026-07-19).** La versión previa de esta tabla decía "Nginx = 1 MB → subir a 5m". **Es incorrecto:** Nginx ya está en **20 MB** en ambos entornos. Poner `client_max_body_size 5m;` sería un **downgrade** (de 20M a 5M) — **no tocar Nginx**, ya tiene margen de sobra para el peor caso (~400 KB).
>
> **El único tope real a subir es el de Express, y hay un matiz de orden que la versión previa omitía:** los parsers `express.json` (con hook `verify` para el rawBody del webhook de MP) y `express.urlencoded` están montados **globalmente**, **antes** de todos los routers (⚠️ **verificado 2026-07-25: hoy son `server.js:110` y `113`** — las líneas se corrieron respecto de cuando se escribió esta sección; confirmar el número exacto al implementar, no asumir 84/87). La captura llega como **form POST (`x-www-form-urlencoded`)**, así que el que la parsea es el **`express.urlencoded` global**, no un `express.json` de ruta. Por eso un `express.json({ limit: '5mb' })` colgado solo de la ruta de captura **no funcionaría** (parser equivocado + corre después del global, que ya habría rechazado con 413 a los 100 KB). La forma correcta:
>   - **Montar un parser específico ANTES del router en `server.js`** — `app.use('/usuarios/capture', express.urlencoded({ extended: false, limit: '5mb' }))` colocado **arriba** del `express.urlencoded` global (así gana la ruta de captura y el resto del sistema sigue en 100 KB). Preserva intacto el `express.json` global con su `verify` del webhook.
>   - **⚠️ Descartada (no usar): subir el límite del `express.urlencoded` GLOBAL a `5mb`.** No es una alternativa válida — reabriría el mismo problema que motivó el cap de longitud agregado a `POST /tickets` el 2026-07-25 (hallazgo C5, `docs/internal/revision-bugs-2026-07-25.md`): un límite global generoso habilita abuso en cualquier endpoint que hoy depende de esos 100 KB por defecto como techo implícito. El parser de la ruta de captura debe ser **específico y acotado a esa sola ruta**.
>   - **⚠️ No agregar `/usuarios/capture` a `PUBLIC_OPEN_CORS_PATHS`.** Ese array (en `server.js`, agregado el 2026-07-25 para `POST /analytics/event`, ver hallazgo D4 de `revision-bugs-2026-07-25b.md`) abre CORS sin credenciales para beacons cross-origin llamados por `fetch`. El capture **no lo necesita**: es una navegación de `<form>` (POST tradicional, no AJAX), que nunca dispara preflight/CORS sin importar el origen — agregarlo ahí no rompe nada pero es una entrada muerta que puede confundir a quien lea la lista después.

**Tamaños reales medidos** (corridas del CUIT de prueba 27320694359):

| Unidad | Tamaño real |
|---|---|
| 1 movimiento | ~170–380 bytes (mediana ~230) |
| 1 expediente completo (15 movimientos — tope `maxMovimientos` de la config) | **~4,2 KB** |
| Corrida de 3 expedientes (JSON entero) | ~19 KB |

**Escenarios contra los límites:**

| Escenario | Payload estimado | Veredicto |
|---|---|---|
| Captura individual (1 caso) | ~4 KB (peor caso realista con 100 movimientos: ~25 KB) | ✅ Entra incluso con el default de 100 KB |
| Lote ~10 casos con snapshot | ~40 KB | ✅ Entra en 100 KB |
| Lote ~20–25 casos con snapshot | ~80–100 KB | ⚠️ Roza el default → subir el límite |
| Corrida grande (50–100 exp. con snapshot) | ~200–400 KB | ❌ Excede 100 KB → **requiere subir el límite** (a 5 MB entra con >10× de margen) |

**La inflación por URL-encoding (a tener en cuenta):** un `<form>` por defecto codifica en `application/x-www-form-urlencoded`, y como el JSON está lleno de `{ } " : ,` y acentos, el encoding **infla ~2–3×** (cada carácter especial → `%XX`). Un JSON de 40 KB puede viajar como ~100 KB. **Mitigación: subir el límite del `express.urlencoded` de la ruta de captura a 5 MB** (ver el recuadro de corrección arriba — se monta un parser específico antes del router, no se toca Nginx que ya está en 20M). Holgadísimo, sin costo. Alternativa innecesaria: `enctype="text/plain"` para no inflar.

**Patrón de recepción — Post/Redirect/Get (PRG):** el POST aterriza en el portal (una SPA); para que la SPA reciba los datos de forma limpia:
1. El visor hace POST a `/usuarios/capture` con el payload.
2. El servidor guarda el payload un instante (sesión o registro efímero con id) y responde con **303 redirect** a la URL limpia del portal (`/usuarios/?goto=bitacora-nueva&draft=<id>`).
3. La SPA carga, lee `draft=<id>`, pide el payload al backend y abre el modal pre-cargado.

Ventajas del PRG: evita el "¿reenviar formulario?" al refrescar, deja la URL limpia (el payload no queda en el historial del navegador), y el límite es 100% server-side. Es exactamente cómo funcionan los SSO/SAML por POST binding (mandan tokens de varios KB así) — técnica estándar y de bajo riesgo.

**⚠️ Precisión de seguridad agregada 2026-07-19 — el POST de captura llega SIN autenticación (diseñarlo así a propósito, con estas protecciones):** un `<form>` HTML no puede mandar el header `Authorization`, y la decisión de diseño (riesgo #3 de §12) es correcta: **sin tokens en el payload** (el visor es un archivo local que podría compartirse). Consecuencia que el implementador debe tener explícita: `POST /usuarios/capture` **no puede llevar `authenticateToken`** — es un endpoint público que recibe un borrador **anónimo**, y la autenticación ocurre recién en el paso 3 del PRG, cuando la SPA logueada **reclama** el draft (`GET /usuarios/api/capture-draft/:id`, ese SÍ con JWT). Para que eso no sea un agujero, el endpoint público necesita, como mínimo:
1. **Id de draft no adivinable** (`crypto.randomBytes(32)` — mismo patrón que los tokens de verificación de email ya usados en `auth.js`), devuelto SOLO en el redirect.
2. **TTL corto** (ej. 10 minutos) + borrado al reclamar (uso único) + límite de drafts simultáneos en memoria/tabla (ej. 100) para que no sea un sumidero de memoria.
3. **Rate-limit** dedicado (patrón `rateLimiter.js`, ej. 30/5min por IP) — es el único endpoint anónimo nuevo que agrega la Bitácora.
4. **Payload tratado como entrada NO confiable**: se valida estructura/tamaño al reclamar y **nada se persiste en tablas reales hasta que el usuario autenticado confirma** en el modal (el draft es un buffer, no un insert).
5. **Punto de montaje:** la ruta se monta en `server.js` (ej. `app.post('/usuarios/capture', ...)`) **antes** del `express.static` de `/usuarios` (los estáticos solo atienden GET, pero el orden explícito evita sorpresas), y con su parser `urlencoded({ limit:'5mb' })` propio (ver corrección de límites arriba).

**Veredicto:** complejidad baja (form oculto + `.submit()` en el visor; una línea de límite en Express y Nginx; PRG en el endpoint). Tras el ajuste de límite, **no hay límite práctico** para los tamaños de datos reales — una corrida de 100 expedientes (~400 KB) entra con margen enorme en 5 MB. El único límite que queda es de **usabilidad** (revisar decenas de filas antes de guardar), no técnico → por eso la pantalla de revisión del lote pagina/agrupa (§4.2), pero el transporte ya no impone tope.

**Una sola pestaña del portal + botón Volver coherente.** El caso típico es trabajar el visor y disparar varias capturas seguidas — no puede ser que cada clic abra una pestaña nueva del portal. Diseño:

- **Pestaña con nombre fijo**: todos los links de bitácora del visor llevan `target="procurador_portal"` (nombre de ventana fijo). El navegador **reutiliza la misma pestaña** en cada clic: el primer deep-link la abre, los siguientes navegan en ella y le dan foco. Solo si el usuario la cerró se abre una nueva.
- **Sesión en uso, no re-login**: si la pestaña del portal ya tiene sesión activa, el deep-link **no vuelve a loguear** — el hash SSO se consume solo cuando no hay sesión; con sesión viva, el portal simplemente navega al destino (`goto=`) con los datos pre-cargados.
- **Volver = pantalla anterior de la Bitácora**: el portal ya navega entre secciones con la History API (patrón implementado en ambos dashboards para el botón Atrás). Cada pantalla del flujo de bitácora (modal de nueva entrada, ficha, lote) **apila su estado en el historial del navegador** → después de guardar la segunda entrada, "Volver" regresa a la pantalla de bitácora anterior (ej. la confirmación o ficha del caso previo), no expulsa al login ni pierde el contexto.
- **Deep-links repetidos, resultado idempotente**: si el usuario dispara dos veces el mismo link (doble clic, impaciencia), el upsert por clave del caso y el formulario pre-cargado (que no guarda hasta confirmar) evitan duplicados.

### 4.2 Visores alcanzados y qué se agrega en cada uno

Los cuatro visores que capturan son: **procuración individual, procuración batch, informe individual, informe batch**. (El visor del monitor queda fuera de esta versión — evaluable después.)

La captura tiene **dos niveles**, pensados para los dos momentos de trabajo sobre el visor:

#### a) Tabla general — selección múltiple (trabajo en lote)

La tabla del visor suma una **columna de checkboxes** y una barra de acciones que aparece al seleccionar:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ☑ 3 seleccionados  [📌 Guardar casos]  [💾 Guardar procuración]           │
│                    [＋ Crear entradas…]                        [✕ limpiar] │
├───┬──────────────┬──────────────────────┬──────────────┬─────────┬─────────┤
│ ☑ │ FCR 1234/21  │ PEREZ c/ GOMEZ s/…   │ Juzg. Fed. 2 │ DESPACHO│ 📁 ficha│
│ ☑ │ CIV 887/23   │ RUIZ c/ BANCO s/…    │ Juzg. Civ. 4 │ SENTEN. │  [📔+]  │
│ ☐ │ COM 456/24   │ ACME SA s/ CONCURSO  │ Juzg. Com. 1 │ TRASLADO│  [📔+]  │
│ ☑ │ FCR 555/22   │ LOPEZ c/ ESTADO s/…  │ Juzg. Fed. 2 │ DESPACHO│  [📔+]  │
└───┴──────────────┴──────────────────────┴──────────────┴─────────┴─────────┘
```

Tres acciones independientes sobre la selección (**ficha básica** y **snapshot** ya no van pegados — corrección de esta versión):

- **"📌 Guardar casos"**: crea/actualiza **solo la ficha** (expediente, jurisdicción, dependencia, carátula, situación actual) de todos los seleccionados — **sin** tocar el historial de snapshots. Para el que quiere empezar a seguir varios casos sin comprometerse a nada más.
- **"💾 Guardar procuración de seleccionados"** (en visores de informe: **"💾 Guardar informe de seleccionados"**): crea/actualiza la ficha **y además** guarda el snapshot de esta corrida (con sus movimientos) en el historial de cada seleccionado. Es "Guardar casos" + adjuntar el snapshot en un solo paso, para el que ya sabe que quiere ambas cosas.
- **"＋ Crear entradas…"**: elige un tipo (Vencimiento/Tarea/Nota) y abre en el portal una **pantalla de revisión del lote**: una fila editable por caso (título pre-cargado, fecha con la calculadora de plazos aplicable a todos o por fila) → "Guardar todo". Sirve al caso real de "estos 5 tienen traslado, les pongo vencimiento a todos".
- **Sin límite artificial de selección**: al viajar por POST (§4.1) y no por querystring, ya no hace falta topear la selección a 10 casos ni recortar los movimientos del lote — el usuario puede tildar todos los expedientes de un batch grande. El único límite razonable es de **usabilidad**, no de transporte: la pantalla de revisión de "Crear entradas…" pagina o agrupa si el lote es muy largo (ej. >30 filas), para que siga siendo cómoda de revisar antes de guardar.
- **⚠️ Cap técnico obligatorio en el backend (revisión 2026-07-25, hallazgo H3):** "sin límite" es correcto para la experiencia de usuario, pero `POST /usuarios/api/expedientes/capture-lote` necesita un **tope explícito de filas por request** independiente del límite de bytes (5 MB). El rate-limit propuesto en §4.1.1 (30/5min) limita *frecuencia*, no *volumen*: un solo POST bien armado dentro del límite de bytes podría intentar crear miles de fichas en una sola transacción. Tope sugerido: **200 casos por request**, con 400 claro si se excede ("Máximo 200 casos por lote; dividí la selección"). 200 filas de snapshot completo (~4,2 KB c/u) son ~840 KB — cómodo dentro de los 5 MB, y muy por encima de cualquier lote real de trabajo.

#### b) Fila / modal del caso — captura individual (trabajo caso por caso)

En cada fila, el botón compacto `📔+` despliega el mini-menú:

```
┌───────────────────────────┐
│ ＋ Vencimiento             │
│ ＋ Tarea                   │
│ ＋ Nota                    │
│ ───────────────────────── │
│ 📌 Guardar caso            │   ← solo ficha, sin snapshot
│ 💾 Guardar procuración     │   ← ficha + snapshot · en informes: "💾 Guardar informe"
└───────────────────────────┘
```

- Las tres primeras opciones abren el formulario POST con `tipo=` correspondiente → modal de entrada pre-cargado (viaja el snapshot completo con movimientos, §4.1, sin recorte). Al guardar la entrada, el snapshot también se suma al historial del caso — capturar una entrada ya implica guardar la procuración/informe de ese momento.
- **"📌 Guardar caso"** crea/actualiza **solo la ficha** del expediente (datos básicos, sin snapshot) — para el que quiere empezar a seguirlo sin comprometer todavía el historial. Toast de confirmación, sin más fricción.
- **"💾 Guardar procuración"** (o "💾 Guardar informe", según el visor) hace lo mismo que "Guardar caso" **y además** adjunta el snapshot de esta corrida al historial — para el que ya sabe que quiere conservar el resultado, aunque hoy no tenga nada que agendar.
- **En el modal de movimientos** del visor se repite la misma botonera, incluidos ambos botones de guardado para ese caso puntual; en ese contexto, el movimiento que se está mirando viaja pre-cargado como descripción de la entrada ("Nuevo despacho del 04/07: 'Traslado a la actora…' → vencimiento").

#### c) Casos ya seguidos — link a la ficha

Al generar el visor, la app consulta un endpoint liviano (`GET /client/bitacora/seguidos` → lista de claves expediente+jurisdicción del usuario) y marca en `DATOS_BATCH` los casos que **ya están guardados**. En el visor:

- La fila muestra **📁 ficha** en lugar de (o junto a) `📔+` — un link directo a la ficha del caso en el portal (`goto=expediente&id=…`), donde está todo lo ya registrado: entradas, historial de snapshots, notas.
- En el modal del caso, un encabezado sutil: "📁 Este caso está en tu Bitácora — Ver ficha".
- El `📔+` sigue disponible igualmente (agregar una nueva entrada a un caso seguido es el flujo de acumulación normal).
- **Nota de vigencia**: el marcado refleja el estado al momento de generar el visor; si el usuario guarda el caso después, un visor viejo no lo sabe — aceptable (el upsert del portal resuelve igual sin duplicar).

Un pie discreto en el visor: "📔 Bitácora — tus vencimientos y casos en el portal" con link directo a la sección, que sirve de descubrimiento de la feature.

### 4.3 El caso especial: informe individual (hoy sin visor)

El informe individual genera un PDF directamente (script encriptado `informequickscwpjn.js`) y no produce visor. Dos alternativas evaluadas:

| Alternativa | Evaluación |
|---|---|
| **A. Mini-visor para el informe individual (recomendada)** | Reutilizar `generador_visor.js` + template con un array de 1 expediente. Se genera **desde `main.js` (Electron)** con los datos que el flujo de informe ya tiene — **sin tocar el script encriptado**. El mini-visor muestra la ficha del expediente + botonera de bitácora + link "Abrir PDF". Respeta la config `visor.abrirAutomaticamente` existente. Consistencia total: los 4 flujos terminan igual (visor → captura). |
| B. Link dentro del PDF | Insertar un hyperlink en el PDF requiere tocar el script encriptado que lo genera (re-encriptar y redeployar), el link en PDF es menos visible/accionable, y no puede desplegar el mini-menú de tipos. Además el PDF suele imprimirse/enviarse al cliente — un link interno del estudio ahí es ruido. |

**Recomendación: A.** Costo bajo (el generador y el template ya existen), cero riesgo sobre los scripts encriptados, y unifica la experiencia. El PDF queda como el entregable "para afuera" y el visor como la superficie de trabajo "para adentro".

### 4.4 Gating por plan en los visores

⚠️ **Corrección de arquitectura (revisión 2026-07-25, hallazgo H1) — leer antes de implementar F2.1.** Esta sección (y el resto del documento hasta esta revisión) asumía que **todos** los visores comparten el mismo mecanismo de inyección de datos (`DATOS_BATCH`, controlado por `main.js`). **Es falso.** Verificado contra el código real: hay **dos arquitecturas de visor distintas**:

| Visor | Quién lo genera | Variable / placeholder |
|---|---|---|
| **Informe batch** | `generador_visor.js` (Electron), invocado desde `main.js` | `DATOS_BATCH` — `main.js` controla el payload directamente |
| **Procuración** (individual, por fecha, lote) | **Scripts encriptados** (`procesarNovedadesCompleto.js`, `procesarCustomExpedientes.js`) | `datosEmbebidos`, inyectado con `template.replace('<!-- DATOS_EMBEBIDOS -->', ...)` dentro del propio script — `main.js` **no** controla este payload |

**Consecuencia:** la botonera HTML/JS de la Bitácora (los botones `📔+`, el mini-menú, la barra de selección múltiple) se agrega igual en los cuatro visores, editando `visorModal_template.html` y el template del informe — ambos son archivos planos del repo Electron (`visorModal_template.html` va como `extraResources` del build, confirmado en `package.json`), **sin tocar ningún script encriptado**. Eso sigue siendo cierto y de riesgo bajo.

Lo que **no** puede hacerse como estaba planteado es que `main.js` inyecte `bitacoraEnabled` (o cualquier dato dependiente del usuario, como el marcado de "casos ya seguidos" de §4.2c) **dentro** del payload de los visores de procuración, porque ese payload lo arma el script encriptado, no `main.js`.

**Solución adoptada — post-procesado del HTML ya generado:** para los visores de procuración, en vez de inyectar datos *durante* la generación (que ocurre dentro del script encriptado), `main.js` **post-procesa el archivo HTML después de que el script lo generó y antes de abrirlo** — inserta un `<script>` adicional con `bitacoraEnabled` y la lista de casos ya seguidos (obtenida de `GET /client/bitacora/seguidos`, §4.2c). El script del visor (JS estático de `visorModal_template.html`) lee esa variable igual que leería `DATOS_BATCH`. **Cero cambios en los scripts encriptados, cero re-encriptado, cero redeploy de scripts** — el costo es un paso adicional (post-procesado) en el flujo de `main.js` para los 3 visores de procuración, que sí es trabajo nuevo respecto de lo que decía la versión anterior de este documento (afecta la estimación de F2.1, ver §11.1).

> ✅ **CONFIRMADO 2026-08-12 (revisión de pre-implementación, hallazgo N2 / decisión D11) — dos precisiones que la versión anterior dejaba sin resolver:**
> 1. **Punto de enganche: se post-procesa UNA SOLA VEZ, al terminar la corrida, inmediatamente antes del auto-open** — no dentro de `get-visor-path` (`main.js:1768`). Ese handler se usa también para reabrir el **último visor generado** desde el botón "Ver resultados" del Historial (`renderer.js:1209`), potencialmente días después: engancharlo ahí reescribiría archivos históricos en cada apertura y metería una llamada de red (`GET /client/bitacora/seguidos`) en un handler que hoy es puramente de disco y funciona sin conexión. El costo aceptado — que un visor viejo reabierto muestre el marcado de "ya seguido" tal como estaba el día que se generó — ya está reconocido explícitamente en §4.2c ("aceptable").
> 2. **La inyección debe ser un REEMPLAZO contra un marcador fijo, no un `append`.** "Insertar un `<script>` al final del `<body>`" tal como estaba escrito es acumulativo: si por algún motivo el mismo archivo se post-procesa más de una vez, quedan variables/scripts duplicados. El template debe traer un marcador (ej. `<!-- BITACORA_RUNTIME -->`) que el post-procesado reemplaza con `String.replace`, nunca concatena — mismo patrón defensivo que ya usan `DATOS_BATCH` y `datosEmbebidos`, pero tolerando re-ejecución.
>
> Detalle completo en `docs/internal/bitacora-decisiones-pendientes-2026-08-12.md` (D11).

Con esa corrección, el resto de esta sección se mantiene:

- **Habilitado** → botonera visible.
- **Deshabilitado** → sin botones; opcionalmente un pie sutil "📔 Bitácora disponible en planes superiores" (palanca de upsell, a decidir comercialmente).
- El gate real está **en el backend** (los endpoints de bitácora rechazan con 403 si el plan no la incluye); lo del visor es solo presentación. Un visor viejo generado cuando el plan la incluía muestra botones, pero el portal responde correctamente según el plan vigente.

---

## 5. El panel del usuario — qué ve y cómo se navega

### 5.1 Sección "Bitácora" (nueva)

```
┌────────────────────────────────────────────────────────────────────────┐
│ 📔 Bitácora                          [ ☆ Establecer como principal ]   │
├────────────────────────────────────────────────────────────────────────┤
│ ⚠ Vencidos sin confirmar (3)  ·  📅 Próximos 7 días (2)   ← banner §3.3│
├────────────────────────────────────────────────────────────────────────┤
│ [Mes] [Semana] [Lista]        ◂ Julio 2026 ▸          [＋ Nueva entrada]│
│ ┌─────────────────────────────────────────────┐  ┌───────────────────┐ │
│ │  L   M   M   J   V   S   D                  │  │ ☑ TAREAS          │ │
│ │           1   2   3   4   5                 │  │ ☐ Preparar oficio │ │
│ │  6  [7]  8•  9  10  11  12                  │  │ ☐ Llamar cliente  │ │
│ │      ●audiencia  ●venc.                     │  │ ☑ Retirar cédula  │ │
│ │ 13  14  15  16  17  18  19                  │  │   (hecha 04/07)   │ │
│ │ ...                                         │  │ [+ nueva tarea]   │ │
│ └─────────────────────────────────────────────┘  └───────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

- **Barra de filtros** (arriba de las vistas, persistente entre visitas):
  - **Chips por tipo** con su color: `[Todos] [🔴 Venc.] [🟣 Aud.] [🔵 Tareas] [🟠 Gest.] [⚪ Notas]` — prender/apagar tipos con un clic (en el calendario, apaga los puntos de ese color; en la lista, oculta la sección).
  - **Estado**: `Pendientes | Hechas | Todas` (default: Pendientes).
  - **Expediente**: autocompletar sobre Mis expedientes → deja la vista mostrando solo ese caso (equivale a mirar su ficha, pero en clave calendario).
  - **Búsqueda de texto** libre sobre título/descripción/carátula.
- **Vista Lista agrupada por secciones** (la separación pedida — el usuario nunca ve una sopa de entradas mezcladas):
  - `⚠ Vencidas sin confirmar` → `Hoy` → `Esta semana` → `Próximas` → `Sin fecha (tareas/gestiones)` → `Notas` (aparte, al final: son registro, no pendientes).
  - Dentro de cada sección, orden cronológico y el color/ícono del tipo siempre visible en cada fila.
- **Grilla mensual** con puntos de color por tipo (+ leyenda de colores fija al pie); clic en un día → lista de sus entradas; clic en una entrada → detalle/edición.
- **Panel lateral de tareas** (las sin fecha + las de la semana), con checkboxes — el gesto Google Tasks.
- **"＋ Nueva entrada"**: modal con tipo, título, fecha (con la calculadora de días hábiles al lado: `[hoy + [5] días hábiles ▸ 14/07/2026]`), expediente (autocompletar sobre Mis expedientes, o vacío = suelta), descripción, repetición, aviso.
- Cada entrada vinculada muestra la carátula como chip clickeable → abre la ficha del caso.

### 5.2 Sección "Mis expedientes" (nueva, subsección de Bitácora o hermana en el menú)

**Listado:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 📁 Mis expedientes (8)              [buscar…] [⬇ Exportar] [＋ Agregar]  │
├──────────────┬──────────────────────┬────────────────┬─────────┬─────────┤
│ Expediente   │ Carátula             │ Situación      │ Pendien.│ Últ.act.│
├──────────────┼──────────────────────┼────────────────┼─────────┼─────────┤
│ FCR 1234/21  │ PEREZ c/ GOMEZ s/…   │ EN DESPACHO    │ 🔴 2    │ 05/07   │
│ CIV 887/23   │ RUIZ c/ BANCO s/…    │ A SENTENCIA    │ —       │ 28/06   │
└──────────────┴──────────────────────┴────────────────┴─────────┴─────────┘
```

**Ficha del expediente** (al abrir una fila):

```
┌──────────────────────────────────────────────────────────────────────┐
│ FCR 1234/2021 — PEREZ c/ GOMEZ s/ DAÑOS            [✏ Editar] [🗑]    │
│ Juzgado Federal 2 · Comodoro Rivadavia                                │
│ Situación actual: EN DESPACHO (05/07/2026)                            │
├──────────────────────────────────────────────────────────────────────┤
│ ⏰ Próximo vencimiento: 12/08 — Contestar traslado                    │
├──────────────────────────────────────────────────────────────────────┤
│ 📔 ENTRADAS DE ESTE CASO (4)                        [＋ Nueva entrada]│
│  ☐ 12/08 🔴 Vencimiento — Contestar traslado                          │
│  ☐ 20/08 🟣 Audiencia — Testimonial (10:00, Sala 3)                   │
│  ☑ 04/07 🔵 Tarea — Revisar despacho (hecha)                          │
│  📝 03/07 ⚪ Nota — Cliente avisado del estado                        │
├──────────────────────────────────────────────────────────────────────┤
│ 📜 HISTORIAL DEL CASO                                                 │
│  Procuraciones guardadas:  [ Última — 05/07/2026 ▾ ]      [ 👁 Ver ]  │
│                              · Última — 05/07/2026                    │
│                              · Anteúltima — 28/06/2026                │
│  Informes guardados:       — No hay informes guardados —              │
└──────────────────────────────────────────────────────────────────────┘
```

**El historial se consulta por modal:** el usuario elige en el selector cuál snapshot quiere ver — solo se ofrecen los que existen: "Última — {fecha}" y, si hay una segunda, "Anteúltima — {fecha}"; si no hay ninguno del tipo, la línea dice "No hay procuraciones/informes guardados" (sin selector ni botón). Al presionar **👁 Ver** se abre un **modal** con el contenido guardado de ese snapshot: fecha de la corrida, situación registrada en ese momento, la lista de movimientos capturados (y, si el recorte del deep-link omitió movimientos, la leyenda "+N más en el visor local de esa fecha"). El modal es de solo lectura — el historial no se edita, se reemplaza solo con nuevas corridas.

La ficha es la **vista integral del caso**: reúne en una sola pantalla los datos del expediente, las entradas de bitácora vinculadas y el historial de procuraciones/informes. (La sección Bitácora, en cambio, es la vista temporal: el calendario de todo.)

- **Los vencimientos del caso están siempre a la vista**: la ficha muestra una línea destacada "⏰ Próximo vencimiento" en el encabezado (el pendiente con fecha más cercana) y el bloque de Entradas lista primero los pendientes ordenados por fecha (vencimientos y audiencias arriba), después lo hecho y las notas. La posición del bloque de Entradas dentro de la ficha es configurable (personalización, abajo).
- **Editar**: todos los campos de la ficha (§3.1). Las entradas del caso se editan acá mismo o desde la vista global — es el mismo registro (§3.2).
- **🗑 Eliminar seguimiento**: confirmación + elección sobre las entradas vinculadas (conservar como sueltas / eliminar). Borra ficha + snapshots.
- El **historial** es de solo lectura y acotado por diseño (hasta 2+2 por caso); se consulta con el selector última/anteúltima + modal (mockup de arriba).

**Personalización de la ficha (para no colapsar la pantalla):**
- **Orden de las secciones**: el usuario puede reordenar los bloques de la ficha (Entradas / Historial / Notas) con flechas ▲▼ o arrastre simple — el que vive de los vencimientos pone Entradas arriba; el que la usa como carpeta de consulta pone el Historial primero.
- **Cantidad de registros visibles por sección**: selector por bloque (mostrar 3 / 5 / 10), con default 5. Cada bloque muestra los más recientes hasta ese tope.
- **"Ver todos" en modal**: si hay más registros que el tope, el pie del bloque muestra "Ver todos (N) →" que abre un **modal a pantalla completa** con la lista íntegra, buscador y los mismos checks/acciones — se trabaja ahí sin perder la ficha de fondo.
- La preferencia se guarda **por usuario y aplica a todas sus fichas** (una configuración, no una por caso — evita el laberinto), como JSON de preferencias junto a `home_section`.

### 5.3 Exportación e importación — backup y restauración del usuario

El usuario es dueño de su información y tiene que poder llevársela. Botón **"⬇ Exportar"** visible en Bitácora y en Mis expedientes, que abre un modal simple:

```
┌──────────────────────────────────────────────┐
│ ⬇ Exportar mi información                    │
│                                              │
│ Qué exportar:                                │
│  (•) Todo (expedientes + bitácora)           │
│  ( ) Solo entradas de bitácora  [rango 📅]   │
│  ( ) Solo un expediente  [elegir ▾]          │
│                                              │
│ Formato:                                     │
│  (•) Excel — para leer y trabajar            │
│  ( ) JSON — backup completo                  │
│                                              │
│              [Cancelar]  [Descargar]         │
└──────────────────────────────────────────────┘
```

- **Excel (legible)**: un archivo con hojas separadas — *Expedientes* (una fila por caso con todos sus campos), *Entradas* (fecha, tipo, título, estado hecho/pendiente, expediente vinculado), *Historial* (snapshots: caso, tipo de corrida, fecha, situación, movimientos). Es el formato que el abogado abre, imprime o archiva. **Solo lectura**: no sirve para restaurar.
- **JSON (backup completo)**: volcado íntegro y fiel de fichas + entradas + snapshots, **restaurable** desde el propio portal (ver abajo). Incluye `backup_version`, fecha de exportación y los identificadores internos de cada registro — eso permite que una re-importación reconozca sus propios datos sin duplicarlos.
- También **por ficha**: en la ficha de un expediente, "⬇ Exportar este caso" (Excel de sus entradas + historial) — útil para adjuntar al legajo físico o pasarle el estado a un colega.
- Técnica: endpoint `GET /usuarios/api/bitacora/export` con parámetros de alcance y formato; generación en el momento (los volúmenes son chicos por diseño — tope 2+2 por caso), descarga directa, nada se almacena en el servidor. Rate limit suave para evitar abuso.
- Nota comercial: la exportación **acompaña al gating del plan** — si el plan pierde la Bitácora, el acceso se bloquea pero (recomendación) **la exportación queda disponible** un tiempo razonable: nunca reteniendo los datos del usuario como rehén, que además es coherente con el discurso de confianza del producto.

#### Importación / restauración desde un backup JSON

Botón **"⬆ Restaurar backup"** junto al de exportar. El usuario sube su archivo JSON y elige el modo:

```
┌───────────────────────────────────────────────────────────────┐
│ ⬆ Restaurar backup                                            │
│                                                               │
│ Archivo: backup-bitacora-2026-06-30.json  ✓ válido            │
│ (exportado el 30/06/2026 · 42 casos · 118 entradas)           │
│                                                               │
│ Cómo restaurar:                                               │
│  ( ) Reemplazar todo — queda SOLO lo del backup               │
│      (se elimina lo actual; se descarga un respaldo antes)    │
│  (•) Combinar — el backup pisa los casos coincidentes,        │
│      se conserva lo que está en tu Bitácora y no en el backup │
│                                                               │
│                              [Cancelar]  [Ver vista previa →] │
└───────────────────────────────────────────────────────────────┘
```

**Los dos modos:**

| Modo | Qué hace | Cuándo se usa |
|---|---|---|
| **Reemplazar todo** | Borra el contenido actual de la Bitácora del usuario y carga exactamente lo del backup. | Volver a un estado anterior conocido ("me equivoqué en algo grande, quiero mi Bitácora del mes pasado"). |
| **Combinar** (default) | Por cada caso del backup: si existe en la base (misma clave jurisdicción+expediente), **el backup lo pisa** (ficha, entradas y snapshots de ese caso); si no existe, se crea. Los casos que están en la base y **no** figuran en el backup **se conservan intactos**. | Recuperar casos borrados por error o mezclar el backup con el trabajo posterior. |

**Dos salvaguardas propuestas (la mejora sobre el pedido):**

1. **Vista previa obligatoria antes de aplicar** (dry-run): el servidor analiza el archivo y muestra el impacto exacto antes de tocar nada — *"Se crearán 3 casos · se sobrescribirán 12 casos (con sus 31 entradas) · se conservarán 27 casos que no están en el backup"* (o, en modo reemplazo: *"se eliminarán 8 casos y 22 entradas actuales"*). El usuario confirma viendo números concretos, no una advertencia genérica. Elimina el 90% de los accidentes.
2. **Respaldo automático previo**: al confirmar cualquier importación, el sistema **genera y descarga automáticamente un export JSON del estado actual** antes de aplicar los cambios. Resultado: ninguna restauración es irreversible — si el resultado no era lo esperado, se restaura el respaldo automático y se vuelve al estado anterior. Es la misma disciplina de "backup antes de tocar" que el proyecto ya usa en operaciones (restore-db, resets), llevada al usuario final.

**Detalles de comportamiento:**
- **Deduplicación de entradas**: en modo combinar, las entradas del backup que ya existen (mismo identificador interno, porque el backup salió de esta misma cuenta) se actualizan en lugar de duplicarse; las entradas creadas después del backup en casos no pisados no se tocan.
- **Entradas sueltas** (sin expediente): en combinar se aplica el mismo criterio por identificador (actualiza las conocidas, crea las nuevas, conserva las locales que no están en el backup).
- **Validación del archivo**: `backup_version` + estructura verificada al subir; archivo ajeno (de otra cuenta), corrupto o editado a mano de forma inválida → rechazo con mensaje claro antes de la vista previa. Tope de tamaño razonable.
- **Todo o nada**: la importación corre en una transacción — si algo falla a mitad de camino, no queda un estado intermedio.
- Gate de plan: mismo criterio que el resto del módulo (y la restauración respeta los topes estructurales: máx. 2+2 snapshots por caso).

### 5.4 Ajustes en secciones existentes

- **Mi Plan**: píldora "★ Es tu pantalla principal / ☆ Establecer como principal" (§3.4). Si la Bitácora está deshabilitada por plan, la píldora de Bitácora no aparece y `home_section` vuelve a Mi Plan.
- **Menú lateral del portal**: ítem "📔 Bitácora" (con sub-ítem o tab interna "Mis expedientes"). Si el plan no la incluye: ítem visible pero con candado + landing de upsell, o directamente oculto — **a decidir comercialmente** (recomendación: visible con candado, es marketing gratis).
- **App Electron — botón en el topbar (única aparición)**: la barra superior de la app (`index.html`, `.topbar`) hoy trae en una sola fila el logo, los tabs Procurar/Informe/Monitor/Descargas, y — al margen derecho, después de un spacer — los controles de ventana (minimizar/maximizar/**cerrar**). El botón **"📔 Bitácora"** se agrega **ahí**, entre los tabs y el spacer, como un botón propio (no un tab más: los tabs cambian la vista interna de la app, este abre el portal externo vía SSO) → `openPortalSection('bitacora')`. **Vive en un solo lugar** — no se duplica en el sidebar. Fase 3 (opcional): badge rojo con el conteo de vencidos-sin-confirmar, mismo patrón visual que el badge de "novedades" que ya existe en el ítem Monitor del sidebar.

---

## 6. Flujos de usuario (end-to-end)

**F1 — Capturar desde una procuración (el flujo estrella):**
1. El abogado procura (individual o lote) → el visor se abre automáticamente.
2. Ve que en FCR 1234/2021 hay un traslado → clic en `📔+` → "＋ Vencimiento".
3. Se abre el portal (ya logueado por SSO): modal pre-cargado con expediente, carátula, dependencia, situación y el movimiento como descripción.
4. Usa la calculadora: "hoy + 5 días hábiles" → fecha calculada → Guardar.
5. Resultado: entrada creada + ficha del caso creada/actualizada + snapshot de la procuración sumado al historial (si había 2, se descarta el más viejo). Toast de confirmación con link "Ver en Bitácora".

**F1b — Captura en lote desde una procuración batch:**
1. Corre un lote de 30 expedientes → visor batch.
2. Filtra/revisa, tilda los 5 que tuvieron despacho relevante → "＋ Crear entradas… → Vencimiento".
3. El portal abre la pantalla de revisión del lote: 5 filas pre-cargadas; ajusta el título de una, aplica "hoy + 5 días hábiles" a todas → "Guardar todo".
4. Resultado: 5 entradas + 5 fichas creadas/actualizadas en una sola pasada.

**F1c — Reencuentro con un caso ya seguido:**
1. Procura de nuevo; en el visor, FCR 1234/2021 aparece con **📁 ficha** (ya estaba guardado).
2. Clic en 📁 → portal → ficha del caso con sus entradas previas y el historial.
3. Si además quiere agendar algo nuevo, usa el `📔+` de siempre: la entrada se **acumula** en la misma ficha y el snapshot nuevo actualiza el historial (si ya había 2 procuraciones, sale la más vieja).

**F2 — Informe individual:**
1. Genera el informe → PDF + **mini-visor** (nuevo) del expediente.
2. Misma botonera → mismo flujo que F1, con `origen=informe` (el snapshot va al cupo de informes del historial).

**F3 — Solo seguir un caso:**
1. En cualquier visor → `📔+` → "📌 Guardar caso" → ficha creada sin entrada. Toast y listo (cero fricción).

**F4 — El ritual de entrada (la pantalla principal):**
1. El abogado configuró Bitácora como principal → inicia sesión → banner de avisos arriba.
2. Checkea lo hecho ayer directamente en el banner (un clic por ítem) → revisa los próximos 7 días → si necesita ver más atrás, "ver anteriores".
3. Todo sin abrir ningún modal: el 90% de las visitas diarias son este flujo de 30 segundos.

**F5 — Gestión del caso:**
1. En Mis expedientes abre la ficha → corrige la carátula (el PJN a veces la trae truncada) → agrega una nota.
2. Meses después, el caso termina → "🗑 Eliminar seguimiento" → elige conservar las entradas históricas como sueltas → ficha eliminada.

**F6 — Entrada manual (sin visor):**
1. Desde el portal (quizás desde el celular), "＋ Nueva entrada" → audiencia para la semana próxima, vinculada a un caso ya seguido (autocompletar) o suelta.

**F7 — Usuario con plan sin Bitácora:**
1. Sus visores no muestran la botonera (solo el pie de upsell, si se decide).
2. En el portal, el ítem con candado explica qué es y qué plan la incluye.

**F8 — Backup periódico:**
1. Fin de mes: en Mis expedientes → "⬇ Exportar" → Todo + Excel → descarga un archivo con sus casos, entradas e historial.
2. Una vez por trimestre baja también el JSON completo y lo guarda con sus resguardos del estudio.
3. Si algún día baja de plan o deja el servicio, ya tiene su información afuera — nada quedó cautivo.

**F9 — Recuperación desde un backup:**
1. Borró por error el seguimiento de dos casos importantes (o quiere volver al estado del mes pasado).
2. "⬆ Restaurar backup" → sube su JSON del 30/06 → elige **Combinar** (recuperar lo borrado sin perder el trabajo posterior).
3. La vista previa le muestra: "se crearán 2 casos (los borrados) · se sobrescribirán 12 · se conservarán 27 que no están en el backup" → confirma.
4. Antes de aplicar, el sistema le descarga automáticamente un respaldo del estado actual — si el resultado no lo convence, restaura ese respaldo con **Reemplazar todo** y queda como estaba.

---

## 7. Modelo de datos propuesto (borrador)

```sql
-- Ficha del caso seguido
CREATE TABLE expedientes_seguidos (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expediente       VARCHAR(60)  NOT NULL,     -- como lo vio el usuario/PJN: "FCR 018745/2017"
  expediente_key   VARCHAR(60)  NOT NULL,     -- normalizado para deduplicar: "fcr|18745|2017"
  jurisdiccion     VARCHAR(100),              -- descriptivo, NO forma parte de la clave (ver nota)
  dependencia      VARCHAR(200),
  caratula         VARCHAR(300),
  situacion_actual VARCHAR(200),              -- última situación registrada
  situacion_fecha  DATE,                      -- fecha de la corrida que la registró
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, expediente_key)            -- clave de acumulación (no duplica)
);
-- ✅ CONFIRMADO 2026-08-12 (revisión de pre-implementación, hallazgo N1 / decisión D1) —
-- columna `expediente_key`: el `UNIQUE` original sobre `expediente` (texto tal cual) NO
-- deduplica cuando el PJN devuelve el número con ceros a la izquierda (`FCR 018745/2017`) y
-- el usuario lo tipea sin ellos (`FCR 18745/2017`) — son el MISMO expediente. Es el mismo bug
-- que ya rompió el enlace de PDFs en producción (commit `debb503`, 2026-07-30).
-- `expediente` conserva el texto original para mostrarlo al usuario; `expediente_key` es la
-- clave real.
--
-- 🧩 DÓNDE VIVE LA NORMALIZACIÓN (definido 2026-08-13, auditoría externa C3). La decisión D1
-- decía "extraída a un módulo compartido entre backend y Electron" sin definir dónde — y el
-- proyecto NO es un monorepo (backend-server/ y electron-app/ tienen package.json y
-- node_modules separados). Hoy `tokenizar()` existe SOLO en electron-app/informe/
-- buscarPdfExpediente.js. Definición:
--   · CANÓNICA en el backend: `backend-server/utils/expedienteKey.js` — el backend es quien
--     escribe las fichas, así que es quien define qué cuenta como "el mismo expediente".
--   · Electron CONSERVA la suya en buscarPdfExpediente.js (ya existe y la usa para enlazar
--     PDFs, que es otro propósito) — no se toca.
--   · CONTRA LA DERIVA, que es el riesgo real: un archivo de casos de prueba compartido
--     (input → salida esperada: "FCR 018745/2017" → "fcr|18745|2017", con y sin ceros, con
--     separadores raros, etc.) que los tests de AMBOS lados ejercitan. Si alguien toca una
--     implementación y no la otra, la prueba falla y se entera enseguida.
--   · DESCARTADO: paquete npm local vía `file:../shared`. Agregaría complejidad de packaging
--     a una app que se empaqueta con electron-builder (asar + extraResources), con riesgo de
--     sorpresas en el build, para compartir una función de 8 líneas sin dependencias.
-- ⚠️ Por qué importa que no deriven: si backend y app normalizan distinto, la app diría "este
-- caso ya está en tu Bitácora" y el backend crearía una ficha nueva (o al revés) — un error
-- silencioso y confuso de diagnosticar.
--
-- ✅ CORRECCIÓN 2026-08-13 (auditoría externa B1/B2 + verificación contra la base real) —
-- `jurisdiccion` SALE de la clave única. Antes era `UNIQUE (user_id, jurisdiccion, expediente_key)`.
-- Dos razones:
--   (1) Es REDUNDANTE. La sigla de jurisdicción ya viaja DENTRO del expediente y por lo tanto
--       dentro de la clave normalizada: tokenizar("FCR 018745/2017") = "fcr|18745|2017" — el
--       primer token ES la jurisdicción, ya normalizada. Agregarla aparte no discrimina nada.
--   (2) Es PELIGROSA. `jurisdiccion` llega como texto libre y con distinta forma según el
--       origen: la captura desde un visor trae lo que manda el PJN ("Justicia Federal de
--       Comodoro Rivadavia") y el alta manual trae lo que tipee el usuario ("FCR", "Comodoro
--       Rivadavia"…). Con ese campo dentro del UNIQUE, el MISMO caso cargado por los dos
--       caminos genera DOS fichas — exactamente el bug que la decisión D1 vino a cerrar,
--       entrando por el otro componente de la clave.
-- Al salir de la clave, `jurisdiccion` queda como columna puramente descriptiva y su
-- nullability deja de importar. Esto DEROGA la corrección del 2026-07-19 que exigía
-- `jurisdiccion NOT NULL DEFAULT ''` (y su variante con índice por expresión sobre
-- COALESCE): esa nota resolvía un problema que con esta clave ya no existe.
--
-- 📌 Consecuencia sobre los índices (ver más abajo): el `UNIQUE (user_id, expediente_key)`
-- crea un índice cuya primera columna es `user_id`, así que ya sirve para las consultas que
-- filtran solo por usuario. `idx_exp_seguidos_user` queda REDUNDANTE — son 4 índices, no 5.
--
-- 🔗 CÓMO SE CRUZA CON EL MONITOR (Fase 3.3) — verificado contra la base real el 2026-08-13.
-- La Fase 3.3 ("sugerencias automáticas a partir de novedades del monitor", el diferencial
-- mayor del módulo) necesita cruzar los casos seguidos contra lo que el Monitor descubre.
-- Ese cruce es MÁS SIMPLE de lo que parecía, porque los dos sistemas guardan el expediente
-- con la sigla adentro y en el mismo formato `SIGLA NUMERO/AÑO`:
--     monitor_expedientes.numero_expediente  →  "FCR 13764/2025", "FCR 034000485/2010"
--     expedientes_seguidos.expediente        →  "FCR 018745/2017"
-- Verificado sobre los 261 registros reales de monitor_expedientes: 261/261 traen la sigla
-- adelante, y esa sigla coincide siempre con monitor_partes.jurisdiccion_sigla.
-- Por lo tanto NO hace falta usar monitor_partes.jurisdiccion_codigo ('14') ni reconciliar
-- formatos de jurisdicción: alcanza con aplicar la MISMA normalización a los dos lados.
--     tokenizar("FCR 034000485/2010")  →  "fcr|34000485|2010"   (ambos sistemas)
-- El caso con ceros a la izquierda de arriba muestra por qué la normalización es imprescindible:
-- comparando los textos crudos ese expediente nunca matchearía. El join queda:
--     FROM expedientes_seguidos es
--     JOIN monitor_partes mp       ON mp.user_id  = es.user_id
--     JOIN monitor_expedientes me  ON me.parte_id = mp.id
--     WHERE normalizar(me.numero_expediente) = es.expediente_key
-- Lo único pendiente para F3.3 es aplicar esa normalización del lado del Monitor al consultar
-- (o materializarla en una columna indexada si el volumen lo pidiera — con unos cientos de
-- expedientes por usuario no hace falta). NO hay que migrar datos ni cambiar cómo el Monitor
-- guarda las cosas.
-- ⚠️ Salvedad honesta: los 261 registros verificados son todos de una jurisdicción (FCR),
-- porque la cuenta de prueba tiene 2 partes y ambas son FCR. El formato `SIGLA NUMERO/AÑO` es
-- el estándar del PJN (el mismo que valida `parseExpedienteStr` y el que muestran los visores:
-- "CAF 018685/2024", "CIV 887/23"), pero conviene reconfirmarlo cuando haya partes de otra
-- jurisdicción cargadas.

-- Historial acotado del caso: últimas 2 procuraciones + últimos 2 informes
CREATE TABLE expediente_snapshots (
  id             SERIAL PRIMARY KEY,
  expediente_id  INTEGER NOT NULL REFERENCES expedientes_seguidos(id) ON DELETE CASCADE,
  kind           VARCHAR(15) NOT NULL,        -- 'procuracion' | 'informe'
  run_date       DATE NOT NULL,               -- fecha de la corrida
  situacion      VARCHAR(200),
  data           JSONB NOT NULL,              -- snapshot compacto (movimientos truncados, resumen)
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
-- Al insertar: DELETE del más viejo si ya hay 2 del mismo kind para ese expediente
-- (la base queda acotada por diseño: máx. 4 filas/caso).
-- ⚠️ Hallazgo H4 (revisión 2026-07-25): "lógica de aplicación en el endpoint" es
-- AMBIGUO y riesgoso tal como estaba escrito — si el INSERT y el DELETE del más viejo
-- son dos statements separados (SELECT para decidir, luego INSERT, luego DELETE),
-- dos capturas simultáneas del mismo caso (doble clic, o un lote que incluye un caso
-- que también se capturó individual en paralelo) pueden dejar 3+ snapshots, rompiendo
-- la invariante "máx. 4 filas/caso" en la que se apoya el dimensionamiento de §10.
-- CORRECTO: el recorte debe ir en la MISMA transacción del insert, con una sola
-- sentencia atómica tipo:
--   DELETE FROM expediente_snapshots WHERE expediente_id=$1 AND kind=$2
--     AND id NOT IN (SELECT id FROM expediente_snapshots WHERE expediente_id=$1
--                     AND kind=$2 ORDER BY created_at DESC LIMIT 1)
--   -- (el INSERT nuevo ya corrió antes en la misma transacción; este DELETE dejando
--   -- el más reciente + el nuevo = 2 filas, sin condición de carrera entre requests)

-- Entradas de bitácora
CREATE TABLE bitacora_entries (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expediente_id  INTEGER REFERENCES expedientes_seguidos(id) ON DELETE SET NULL,
                                               -- SET NULL: al borrar el caso, la entrada queda suelta
                                               -- (si el usuario elige "eliminar también", la app las borra antes)
  kind           VARCHAR(20) NOT NULL,         -- 'vencimiento'|'audiencia'|'tarea'|'gestion'|'nota'
  title          VARCHAR(300) NOT NULL,
  description    TEXT,
  due_at         TIMESTAMPTZ,                  -- NULL = tarea/gestión sin fecha, nota
  all_day        BOOLEAN DEFAULT true,
  done_at        TIMESTAMPTZ,                  -- NULL = pendiente · con valor = check de realización
  repeat_rule    VARCHAR(20),                  -- NULL|'weekly'|'monthly'|'yearly'
  meta           JSONB,                        -- campos específicos del tipo (§3.2): lugar/sala,
                                               -- modalidad+link, carácter, organismo, aviso, etc.
  source         VARCHAR(20) DEFAULT 'manual', -- 'manual'|'visor_procuracion'|'visor_informe'
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Feriados / inhábiles (calculadora de plazos)
CREATE TABLE feriados (
  id      SERIAL PRIMARY KEY,
  fecha   DATE NOT NULL UNIQUE,
  motivo  VARCHAR(200)
);
-- ⚠️ Hallazgo H2 (revisión 2026-07-25): la tabla nace vacía y necesita seed inicial +
-- mantenimiento anual (feriados cambian cada año); Q11 responde "el admin los mantiene"
-- pero ninguna fase de §11 construía un ABM. Se agrega F1.8 (ABM de feriados en el
-- dashboard admin) — ver endpoints abajo y §11/§11.1 corregidos.

-- Gating por plan + preferencia de pantalla principal (columnas additivas)
ALTER TABLE plans ADD COLUMN bitacora_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN home_section VARCHAR(20) DEFAULT 'plan';  -- 'plan'|'bitacora'
ALTER TABLE users ADD COLUMN bitacora_prefs JSONB;  -- personalización: orden de secciones de la ficha,
                                                    -- registros visibles por sección, etc.
ALTER TABLE users ADD COLUMN bitacora_lost_access_at TIMESTAMPTZ;  -- ✅ decisión D2/Q6 (2026-08-12):
                                                    -- NULL mientras el plan incluye Bitácora; se
                                                    -- estampa al perder el flag; sostiene la ventana
                                                    -- de exportación de 90 días — ver §8.
```

Migraciones 100% additivas. Dimensionamiento: con el tope 2+2 por caso, un usuario intensivo con 200 casos seguidos son ~800 snapshots compactos (JSONB de pocos KB) — despreciable para el VPS actual.

> ⚠️ **AGREGADO 2026-07-27 (hallazgos E3-4 y E5-2 de la revisión integral) — dos ajustes a F1.1:**
>
> **(a) Crear los índices desde el día uno, no después.** El modelo de arriba solo define la
> constraint `UNIQUE` de deduplicación; no hay ningún índice para las consultas reales. La revisión
> E3 encontró que ese mismo descuido ya existe en `subscriptions` (6 crons diarios filtrando por 4
> columnas de fecha **sin un solo índice** — invisible con 3 filas, problema real al escalar). La
> Bitácora repetiría el patrón: el banner de avisos y la vista mes del calendario filtran
> exactamente por `user_id` + rango de `due_at`, y la ficha del caso por `expediente_id`. Crearlos
> junto con las tablas cuesta nada; agregarlos después es otra migración:
> ```sql
> CREATE INDEX idx_bitacora_user_due    ON bitacora_entries (user_id, due_at);
> CREATE INDEX idx_bitacora_pendientes  ON bitacora_entries (user_id, due_at) WHERE done_at IS NULL;
> CREATE INDEX idx_bitacora_expediente  ON bitacora_entries (expediente_id);
> CREATE INDEX idx_snapshots_exp_kind   ON expediente_snapshots (expediente_id, kind, created_at DESC);
> ```
> (el último es además el que sostiene el `DELETE … ORDER BY created_at DESC LIMIT 1` del recorte
> atómico 2+2 del hallazgo H4).
>
> ⚠️ **Corrección 2026-08-13: son 4 índices, no 5.** La lista original incluía
> `CREATE INDEX idx_exp_seguidos_user ON expedientes_seguidos (user_id)`. Con la clave única
> corregida a `UNIQUE (user_id, expediente_key)` (ver §7), Postgres ya crea un índice único cuya
> **primera columna es `user_id`** — y un índice compuesto sirve para las consultas que filtran por
> su prefijo. O sea que las consultas "todos los casos seguidos de este usuario" ya están cubiertas.
> Crear el índice suelto además sería **duplicar el mismo trabajo**: ocupa espacio y encarece cada
> escritura sin acelerar ninguna lectura.
>
> 📌 **Sobre `idx_snapshots_exp_kind` (auditoría externa B3, evaluado y sin acción):** es correcto
> que ese índice no optimiza el `ORDER BY created_at DESC` de la consulta *sin* filtro de `kind`
> (con `kind` en el medio, Postgres necesita ordenar). **No se agrega un índice adicional para ese
> caso**: por diseño hay **máximo 4 filas por expediente** (tope 2+2), y ordenar 4 filas en memoria
> es instantáneo. Un segundo índice costaría escrituras y espacio para no ganar nada medible.
>
> **(b) Prerrequisito: regenerar `database/schema.sql` ANTES de escribir la migración.** La revisión
> E5 encontró que ese archivo **no se actualiza desde el 2026-05-22**: tiene 21 de las 27 tablas
> reales, le faltan `payments`/`invoices`/`commercial_benefits` completas, y conserva una constraint
> (`check_plan_valid`) que en producción ya no existe. La verificación de "las 4 tablas nuevas no
> colisionan" hecha en la revisión de cohesión del 2026-07-25 se hizo **contra producción** (correcta),
> pero quien implemente F1.1 consultando el archivo versionado estaría mirando una foto vieja. Correr
> el Bloque B.1 del `plan-correcciones-E1-E6-2026-07-27.md` primero (es un `pg_dump --schema-only`,
> minutos) y validar la migración contra el snapshot regenerado.

### Endpoints (patrón existente del portal, todos con gate de plan salvo aclaración)

> ⚠️ **Reorganizado por fase (revisión 2026-07-25, hallazgo C2).** Los endpoints de
> `capture` se movieron a **Fase 2** (marcados abajo): se construyen junto a su único
> consumidor (los visores), en vez de desplegarse a producción sin uso durante toda la
> Fase 1 — son además el único endpoint anónimo de todo el sistema (§4.1.1), así que
> minimizar el tiempo que está en producción sin ejercitarse es preferible.

```
── FASE 1 ──
GET/POST/PUT/DELETE  /usuarios/api/bitacora              — CRUD de entradas (filtros: rango, kind, pendientes, expediente)
POST                 /usuarios/api/bitacora/:id/done      — check / uncheck de realización
GET                  /usuarios/api/bitacora/avisos        — banner: vencidos sin confirmar (ventana N días) + próximos (N días)
GET/POST/PUT/DELETE  /usuarios/api/expedientes            — CRUD de fichas (DELETE con flag ?entries=keep|delete)
GET                  /usuarios/api/expedientes/:id        — ficha + entradas + snapshots
GET                  /usuarios/api/bitacora/export        — exportación (params: alcance=todo|entradas|expediente, formato=xlsx|json, rango)
POST                 /usuarios/api/bitacora/import        — restauración desde backup JSON (params: modo=reemplazar|combinar, dry_run=1 para la vista previa; transaccional)
GET                  /usuarios/api/feriados?year=         — lectura, para date-picker y calculadora (gate de plan)
POST/PUT/DELETE      /admin/feriados                      — ABM de feriados (F1.8, hallazgo H2) — auth admin, NO gate de plan (es config global del sistema, no por usuario)
PUT                  /usuarios/api/profile (extendido)    — home_section

── FASE 2 (junto a los visores, ver hallazgo C2) ──
POST                 /usuarios/capture                    — recibe el POST-form del visor (body hasta 5MB): stashea el payload y hace 303 redirect al portal (PRG, §4.1.1). Upsert de ficha; snapshot solo si la acción lo incluye (§4.2). SIN auth (§4.1.1) — rate-limit dedicado + TTL corto + id no adivinable.
GET                  /usuarios/api/capture-draft/:id       — la SPA recupera el payload stasheado tras el redirect (Post/Redirect/Get). Con auth: recién acá se identifica al usuario.
POST                 /usuarios/api/expedientes/capture-lote — lote: upsert de fichas (+ snapshots si aplica), tope 200 casos/request (hallazgo H3); creación de entradas revisadas
GET                  /client/bitacora/seguidos            — (app Electron, JWT de app) claves de casos ya seguidos, para marcar el visor
```

---

## 8. Gating por plan — detalle

| Punto de control | Comportamiento |
|---|---|
| `plans.bitacora_enabled` | Flag por plan, editable desde el form de planes del dashboard admin (checkbox "Incluye Bitácora"). |
| Backend (`routes/usuarios.js`) | Middleware en todos los endpoints de bitácora/expedientes: 403 con mensaje claro si el plan no la incluye. **Es el gate real.** ⚠️ **Excepción explícita (revisión 2026-07-25, hallazgo H5):** la versión anterior de este documento decía "middleware en TODOS los endpoints… es el gate real" en esta fila, y en §5.3/Q6 prometía que `GET /usuarios/api/bitacora/export` siguiera disponible **90 días** después de perder el plan — **las dos afirmaciones son incompatibles** tal como estaban escritas (un middleware sin excepciones daría 403 inmediato, sin ventana). El middleware de gate debe tener un **carve-out explícito para `/bitacora/export`**: en vez de 403 duro, valida `bitacora_enabled` del plan actual **O** que hayan pasado menos de 90 días desde que el usuario perdió el flag. ✅ **CONFIRMADO 2026-08-12 (decisión D2/Q6): se sostienen los 90 días.** Columna a agregar en F1.1: `users.bitacora_lost_access_at TIMESTAMPTZ`, seteada por el mismo proceso que cambia de plan (nula mientras el plan incluya Bitácora; se estampa al perder el flag; se limpia si el usuario vuelve a un plan que la incluya). |
| Portal | Con flag off: ítem de menú con candado + pantalla explicativa (o oculto, a decidir); píldora "principal" no disponible; `home_section` forzado a `plan`. |
| App Electron / visores | `main.js` lee el flag de `/client/account` al generar cada visor e inyecta `bitacoraEnabled` → botonera presente o ausente. Botón del topbar de la app: mismo criterio (oculto si el plan no la incluye, salvo que se decida mostrarlo con candado como upsell — mismo criterio que el ítem del menú del portal). |
| Cambio de plan | Al bajar a un plan sin Bitácora los **datos no se borran** (fichas y entradas quedan en la base); solo se bloquea el acceso. Al volver a subir, todo reaparece. Evita destrucción de datos por decisiones comerciales. |
| Trial | A decidir: recomendación — **Bitácora habilitada durante el trial** (es el gancho de conversión más visual del producto), se corta si el plan pago elegido no la incluye. |

---

## 9. Riesgo y complejidad de la implementación — explicado sin tecnicismos

> Para decidir implementar o no: qué se toca, qué no se toca, qué puede salir mal y cómo se contiene.

### 9.1 Qué se modifica, componente por componente

| Componente | Qué se hace | Qué NO se toca | Riesgo |
|---|---|---|---|
| **Base de datos** (servidor) | Se **agregan** 4 tablas nuevas y 4 columnas nuevas (una más que la versión previa: `users.bitacora_lost_access_at`, decisión D2/Q6, ver §8). Es como sumar cajones nuevos a un mueble: los cajones existentes (usuarios, suscripciones, pagos) no se mueven ni se abren. | Ninguna tabla existente se modifica en su estructura ni en sus datos. | 🟢 Muy bajo |
| **Servidor web** (backend) | Se agregan los endpoints nuevos de la Bitácora (código nuevo, al costado del existente) + una consulta liviana para la app. | Login, cobro MercadoPago, webhooks, emails, la automatización contra el PJN, la extensión Chrome. | 🟢 Bajo — si algo falla, falla la Bitácora; el resto del sistema ni se entera. |
| **Portal web** (lo que ve el usuario en el navegador) | Se agregan 2 secciones nuevas (Bitácora y Mis expedientes) + la píldora en Mi Plan. Es la parte con más pantallas nuevas de todo el proyecto. | Las secciones existentes (Mi Plan, Facturación, Soporte, Ayuda) quedan como están. | 🟡 Bajo-medio — "medio" por cantidad de horas, no por peligro: un error queda contenido dentro de la sección nueva. |
| **App Electron** (la app de escritorio) | Se modifican las **plantillas** de los visores (checkboxes + botonera 📔), se crea el mini-visor del informe individual, y se agrega un ítem al menú. Requiere publicar una versión nueva de la app. | ⛔ **Los scripts encriptados NO se tocan** (la automatización que corre contra el PJN queda intacta), las credenciales del PJN, el flujo de ejecución, el candado de dispositivo. | 🟡 Medio — el riesgo normal de cualquier release de app, con el checklist de siempre (probar con `npm start` antes de publicar; fix-forward si algo falla). |

### 9.2 Cómo se contiene el riesgo (las redes de seguridad)

1. **Dos fases independientes**: la Fase 1 (backend + portal) se prueba y publica **sin tocar la app** — si algo no convence, se ajusta sin haber emitido ningún release de Electron.
2. **El flag por plan es un interruptor de apagado**: la Bitácora nace desactivada (`bitacora_enabled=false` en todos los planes). Se enciende para un plan de prueba, se valida con uso real, y recién ahí se abre. Si algo sale mal → se apaga el flag y **ningún usuario la ve**, sin deploy ni rollback.
3. **Staging antes de producción**: el flujo ya existente del proyecto (probar en `staging-api` → backup pre-deploy → prod).
4. **Migraciones solo-agregar**: como no se modifica nada existente, deshacer la Fase 1 a nivel base es eliminar las tablas nuevas — lo viejo nunca estuvo en riesgo.
5. **Backups**: la disciplina actual (backup `.7z` + tag de recupero antes de cada bloque de trabajo) aplica igual.

### 9.3 Complejidad y esfuerzo (orientativo)

> ⚠️ **Reconciliado con §11.1 (revisión 2026-07-25, hallazgo C5).** La versión anterior de
> esta tabla y la tabla de §11.1 (agregada el 2026-07-19) no cerraban entre sí: §11.1 le
> asignaba a un solo sub-bloque (F1.3, el calendario) el mismo presupuesto "4–6 sesiones"
> que esta tabla le había dado a **toda** la Fase 1 - portal (calendario + ficha + filtros +
> export + import juntos). Sumando lo que §11.1 detalla sub-bloque por sub-bloque, el total
> real es mayor. Tabla corregida:

| Bloque | Tamaño | Nota |
|---|---|---|
| Fase 1 — backend + base (F1.1, F1.2, F1.5, F1.8) | Chico-mediano | Migraciones, CRUD de bitácora/expedientes, gate de plan, píldora+checkbox admin, ABM de feriados. Patrones ya usados en el proyecto. ~2–3 sesiones. |
| Fase 1 — portal: Bitácora (F1.3) | **El sub-bloque más grande** | Calendario mes+lista, banner de avisos, modal con calculadora de plazos. UI nueva y densa. 4–6 sesiones (estimación de §11.1, sin cambios). |
| Fase 1 — portal: Mis expedientes (F1.4) | Mediano | Listado, ficha, edición, borrado con elección sobre entradas. ~1–2 sesiones. |
| Fase 1 — export + import (F1.6 + F1.7) | Mediano-grande | F1.6 (Sonnet, chico-mediano) es dependencia dura de F1.7 (Opus, alto — hallazgo C4): la salvaguarda de "respaldo automático antes de importar" no puede existir sin exportación funcionando. Import es el único tramo que puede destruir datos reales del usuario — el más lento de razonar bien, no de tipear. ~2–3 sesiones combinadas. |
| **Subtotal Fase 1** | | **~9–14 sesiones** |
| Fase 2 — visores + capture + mini-visor + release | Mediano-grande | Incluye ahora los endpoints de `capture` (movidos de Fase 1, hallazgo C2) + el post-procesado de `main.js` para los visores de procuración (hallazgo H1, trabajo nuevo no contemplado en la versión anterior) + el mini-visor de informe + el release. ~4–6 sesiones + 1 release de Electron con su checklist. |
| **Total orientativo** | | **~13–20 sesiones de trabajo**, repartibles en semanas, sin bloquear otros pendientes (B3, flecos de QA). Rango más ancho que la estimación original porque incorpora el trabajo real de H1 (post-procesado) y C2 (capture en F2) que antes no estaba contado. |

**En una frase:** es una mejora de riesgo técnico bajo (no toca dinero, credenciales ni automatización; nace apagada por flag) cuyo costo real es tiempo de desarrollo, concentrado en las pantallas nuevas del portal.

---

## 10. Costos estimados (infraestructura)

> Medición real del servidor al 2026-07-05: disco total 49 GB, usados 5,1 GB → **44 GB libres**; base de datos de producción completa: **13 MB**; droplet DigitalOcean actual de 2 GB RAM.

### 10.1 Cuánto pesa la Bitácora por usuario

| Elemento | Peso estimado | Tope estructural |
|---|---|---|
| Ficha de expediente seguido | ~1 KB | — |
| Snapshot (procuración o informe, recortado) | ~4 KB | máx. 4 por caso (2+2) → máx. ~17 KB por caso |
| Entrada de bitácora | ~0,5 KB | sin tope, pero son texto corto |

**Usuario intensivo** (escenario cargado a propósito): 300 casos seguidos con historial lleno + 1.000 entradas/año → 300 × 17 KB + 1.000 × 0,5 KB ≈ **~6 MB por usuario por año**. Un usuario típico va a estar muy por debajo (30–80 casos → menos de 2 MB).

### 10.2 Escenarios de crecimiento

| Escenario | Usuarios con Bitácora | Espacio estimado | ¿Entra en los 44 GB libres? |
|---|---|---|---|
| Beta actual | 50 | ~0,3 GB | Sobra (menos del 1% del disco libre) |
| Crecimiento medio | 200 | ~1,2 GB | Sobra |
| Éxito comercial | 500 (todos intensivos — sobreestimado) | ~3 GB | Sobra |

### 10.3 Conclusión de costos

- **Costo de infraestructura adicional: USD 0/mes.** El servidor actual absorbe cualquier escenario realista de la Beta y bastante más allá; el tope 2+2 por caso hace que el crecimiento sea lineal y acotado por diseño (no hay "archivo histórico infinito" que se acumule).
- **Backups**: el dump diario crece en proporción (hoy ~1 MB; con cientos de usuarios activos podría llegar a decenas de MB) — el esquema actual (DO Spaces + copias locales) lo absorbe sin cambio de plan.
- **CPU/RAM**: consultas simples e indexadas por usuario; sin procesos pesados ni crons nuevos de limpieza (el tope se mantiene solo). El droplet de 2 GB no se ve exigido por esta mejora.
- **El único escenario de gasto futuro**: si el producto escala a miles de usuarios, un upgrade de droplet (+USD 6–12/mes) — decisión lejana y que llegaría por el crecimiento general del negocio, no por la Bitácora en particular.
- **El costo real de la mejora es tiempo de desarrollo** (§9.3) + un release de Electron. Sin servicios externos nuevos, sin licencias, sin APIs pagas.

---

## 11. Plan de implementación por fases

---

### 🚨 11.0 — LOS 3 PUNTOS DONDE NO SE PUEDE SER DESCUIDADO

> **Leer antes de escribir la primera línea de código de cualquier fase.**
>
> La auditoría de aislamiento del 2026-08-13
> (`docs/internal/auditoria-aislamiento-bitacora-2026-08-13.md`) encontró que la Bitácora **puede
> romper funcionalidad que hoy está en producción** en exactamente 3 lugares. No son riesgos
> teóricos ni de diseño: en los 3, **la forma más natural de implementarlo es la que rompe**. Por eso
> están acá arriba y repetidos en el sub-bloque que les corresponde.
>
> Ninguno cuesta trabajo extra evitarlo. Los tres son decisiones de *cómo* escribirlo, no de *cuánto*.

#### 🔴 P1 — El gate de plan NO va en `routes/usuarios.js` · afecta a **F1.2**

**Lo que rompe:** ese archivo **no está vacío esperando la Bitácora** — tiene **8 rutas vivas en
producción**: `/profile`, `/password`, `/plans`, `/ai-chat`, `/payments`, `/invoices`,
`/invoices/:id/pdf`, `/subscription/current`. Un `router.use(gateBitacora)` al tope (la lectura
natural de "middleware en todos los endpoints de bitácora") deja a **todo usuario sin el flag** sin
poder ver sus facturas, cambiar su contraseña ni escribirle a soporte — con un mensaje que además
confunde ("tu plan no incluye la Bitácora" al cambiar la contraseña).

**Cómo se hace bien — aislamiento por estructura, no por disciplina:**

```js
// routes/bitacora.js — archivo NUEVO. Nada preexistente adentro.
router.use(gateBitacora);            // seguro: este router SOLO tiene rutas de Bitácora

// server.js — montaje propio, SIN tocar el de /usuarios/api
app.use('/usuarios/api/bitacora',    generalAuthLimiter, require('./routes/bitacora'));
app.use('/usuarios/api/expedientes', generalAuthLimiter, require('./routes/bitacora-expedientes'));
```

Así es **imposible** que el gate alcance una ruta existente. Beneficio extra: apagar la Bitácora de
urgencia = comentar una línea de montaje, sin tocar el resto del portal.

**Prueba de no-regresión obligatoria al cerrar F1.2:** entrar al portal con un usuario **sin** el
flag y verificar que **las 8 rutas siguen funcionando**.

#### 🔴 P2 — El parser de 5 MB puede romper el cobro · afecta a **F2.2**

**Lo que rompe:** `server.js:110` no es un parser cualquiera — su hook `verify` captura el `rawBody`
que `routes/webhooks.js` usa para validar la **firma HMAC-SHA256 de MercadoPago**:

```js
// server.js:109-113  ← el orden de estas líneas sostiene el cobro
app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; }   // ← de esto depende que los pagos se acrediten
}));
app.use(express.urlencoded({ extended: false }));
```

La instrucción de §4.1.1 ("montar arriba del `urlencoded` global") **es ambigua**: admite montarlo
antes de la línea 110, y ahí se interfiere con el camino del webhook. **Un webhook cuya firma no
valida = un pago que no se acredita.**

**Cómo se hace bien:**
1. Montar **inmediatamente antes del `express.urlencoded` GLOBAL** — el que no tiene path y
   parsea formularios para toda la app (hoy en la línea 113). **Nunca** antes del `express.json`
   con el hook `verify` (hoy línea 110): así ese camino queda **exactamente como está hoy** para
   todo lo demás, incluido el webhook.
   > ⚠️ **Identificar los parsers por lo que son, no por el número de línea.** `server.js` tiene
   > 943 líneas y se modifica; cualquier agregado más arriba corre la numeración y deja esta
   > instrucción apuntando al lugar equivocado — con la consecuencia de romper el cobro. Los
   > números de línea de acá son la foto del 2026-08-13: **verificarlos antes de tocar, no
   > asumirlos.**
2. **Siempre** path-scoped: `app.use('/usuarios/capture', express.urlencoded({ extended:false, limit:'5mb' }))`. **Jamás** subir el límite del parser global (ya descartado en §4.1.1 por el hallazgo C5).
3. **Antes de ir a prod:** correr `dev-tools/smoke-payments.js` en **staging** (19 checks, ya existe) y confirmar que la firma del webhook sigue validando. Es la única forma de comprobar que el `rawBody` no se rompió.

#### 🟠 P3 — El post-procesado del visor nunca puede cancelar la apertura · afecta a **F2.1**

**Lo que rompe:** F2.1 mete un paso nuevo entre "el script generó el visor" y "se abre el visor", y
ese paso **consulta la red** (`GET /client/bitacora/seguidos`). Hoy ese camino es **puramente de
disco y no puede fallar por conexión**.

No es hipotético: la corrida del **2026-08-12** atravesó una ventana de degradación de red en la que
hasta el backend propio daba timeouts de 30 s. Con el post-procesado desprotegido, esa tarde la
procuración habría terminado bien **pero el visor no se habría abierto** — proceso "exitoso" sin
resultado a la vista.

**Cómo se hace bien:**
1. **Todo el bloque en `try/catch`, y el `catch` NO propaga.** Si falla lo que sea (red, permisos,
   archivo en uso) → **se abre el visor sin botonera**. Jamás se cancela la apertura.
2. **Timeout corto y explícito** (2-3 s) en la consulta de seguidos, no el default.
3. **La red es opcional, el flag no:** `bitacoraEnabled` sale de `/client/account`, que la app ya
   tiene de la sesión — sin red nueva. Si solo falla la lista de seguidos, se inyecta la botonera
   igual con lista vacía (peor caso: aparece `📔+` en un caso ya seguido, y el upsert lo resuelve sin
   duplicar — ya aceptado en §4.2c).

> **Además, de severidad menor pero mismo espíritu (hallazgo A4 de la auditoría):** al implementar
> **F1.5**, `home_section` debe validarse **en el punto de uso** (`public/usuarios/app.js:340`, hoy
> `navigateTo('plan')` fijo), no solo al escribirlo. Si un usuario quedó con `home_section='bitacora'`
> y perdió el plan, sin esa guarda **aterriza en una sección gateada en cada login**.
> Forma correcta: `const destino = (homeSection === 'bitacora' && account.bitacoraEnabled) ? 'bitacora' : 'plan';`

---

> ⚠️ **Reescrita 2026-07-25 (hallazgos C1-C4, C6).** La numeración de esta sección ahora
> mapea **1:1** con los sub-bloques F1.1–F1.8/F2.1–F2.7 de §11.1 (antes el punto 3 de Fase 1
> se partía en dos sub-bloques y los puntos 4-5 se juntaban en uno solo, generando confusión
> entre "el punto 3 del plan" y "F1.3 de la tabla de esfuerzo"). Los endpoints de `capture`
> se movieron de Fase 1 a Fase 2 (hallazgo C2, ver también §7). El deliverable de Fase 2
> ahora aclara que incluye deploy de backend, no solo el release de Electron (hallazgo C3).

> 🔗 **Dependencias con el plan de correcciones (agregado 2026-07-27).** La revisión integral
> E1-E6 produjo `docs/internal/plan-correcciones-E1-E6-2026-07-27.md`, cuyos bloques **B** y **D**
> tocan terreno compartido con esta propuesta. **Dos prerrequisitos duros, ninguno bloqueante a
> largo plazo (ambos son trabajo chico):**
>
> | Prerrequisito | Bloquea | Por qué |
> |---|---|---|
> | **Bloque B.1** — regenerar `database/schema.sql` | **F1.1** | El schema versionado tiene 2 meses de drift (21 de 27 tablas); escribir la migración contra esa foto vieja es arriesgado. Ver la nota (b) de §7. |
> | **Bloque D** — fix E4-1 (escape en `visorModal_template.html`) | **F2.1 / F2.3** | La Fase 2 inyecta datos del PJN en atributos `value=""` del formulario de captura. Sin el escape del Bloque D como base, la Fase 2 **amplía** el hallazgo XSS en vez de heredarlo resuelto. Ver el recuadro rojo de §4.1. |
>
> **No hay conflicto con los demás bloques:** el Bloque C (motor Puppeteer) toca los scripts
> encriptados, que esta propuesta explícitamente **no** toca (H1 ya movió el trabajo a un
> post-procesado en `main.js`); el Bloque A (backend/crons) no cruza con los endpoints nuevos; la
> whitelist de scripts del Bloque A.1 filtra **scripts**, no endpoints, así que
> `GET /client/bitacora/seguidos` no se ve afectado. **Nota menor de coordinación:** el Bloque A
> edita `server.js` (los crons) y F2.2 también lo edita (el parser de 5 MB montado antes del
> router) — son zonas distintas del archivo, pero conviene no ejecutarlos en paralelo para evitar
> un conflicto de merge trivial.

### Fase 1 — Núcleo (backend + portal, sin release de Electron)

> ✅ **F1.1 EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** Migración
> `database/migrations/20260814_bitacora_f1_1.sql` aplicada a staging → prod (backup previo en
> ambos). 4 tablas + 4 columnas + 4 índices + 52 feriados. `backend-server/utils/expedienteKey.js`
> (normalización canónica) con **21/21** tests, y el fixture compartido
> `tests/fixtures/expediente-key-cases.json` verificado desde **ambos** codebases (**15/15** de cada
> lado — las dos implementaciones coinciden hoy). **Nada visible para ningún usuario:** 0 de 6 planes
> con el flag encendido. Verificado en staging con datos reales: la deduplicación **rechaza** el
> mismo caso escrito distinto, y las cascadas (`CASCADE` en snapshots, `SET NULL` en entradas)
> funcionan. **Hallazgo del camino:** staging tenía privilegios por defecto para tablas pero **no
> para secuencias** (prod sí), así que sin los `GRANT` explícitos que la migración incluye la app
> habría fallado ahí con *"permission denied for sequence"* en el primer INSERT — el mismo bug que
> ya ocurrió con `commercial_benefits_id_seq` en junio. Ver §11.2 por los 2 pendientes que dejó.
>
> ✅ **F1.2 y F1.3 EJECUTADAS Y EN PRODUCCIÓN (2026-08-14, misma sesión).** F1.2: CRUD completo +
> gate de plan, verificado con 39/39 aserciones en staging y repetido contra prod (no-regresión de
> las 8 rutas de `usuarios.js`, gate 403 correcto). F1.3: la sección Bitácora del portal — banner de
> avisos, vista Mes (calendario + panel del día) y vista Lista (agrupada por fecha), filtros (tipo,
> estado, expediente, búsqueda), modal de alta/edición con la calculadora de plazos en días hábiles
> (usa `GET /usuarios/api/feriados`). El campo `account.bitacoraEnabled` (nuevo en
> `GET /client/account`, `routes/client.js`) gatea el ítem "📔 Bitácora" del sidebar — verificado en
> staging y prod que devuelve `false` para cuentas sin el flag y `true` tras activarlo a mano en un
> plan de prueba, sin afectar ningún otro campo de la respuesta. **Verificación E2E real en staging**
> (flag encendido temporalmente en `COMBO_PROMO`, revertido al cerrar, 0 filas residuales): crear
> entrada → aparece en el rango de fechas del mes → aparece en `/avisos` → marcar hecha → borrar,
> los 5 pasos contra los endpoints reales, no mockeados. **Nada visible para ningún usuario real**
> (el flag sigue en `false` en los 6 planes de producción).
>
> ✅ **F1.4 EJECUTADA Y EN PRODUCCIÓN (2026-08-14, misma sesión).** Portal: sección **Mis
> expedientes** — listado con búsqueda, ficha completa (datos + próximo vencimiento + entradas del
> caso, reusando `bitEntryRowHtml()` de Bitácora + historial acotado 2+2 con selector
> Última/Anteúltima), edición, y eliminación con elección sobre las entradas (conservar sueltas /
> eliminar también). **1 endpoint nuevo:** `GET /usuarios/api/expedientes/:id/snapshots/:snapshotId`
> (el contenido completo del `data` JSONB de un snapshot, separado del listado resumido de `GET /:id`
> para no cargar la ficha con datos que el usuario no pidió ver) — mismo patrón IDOR que el resto de
> F1.2 (`fichaDelUsuario()` antes de tocar nada). **Nada puede escribir en `expediente_snapshots`
> todavía** (eso lo construye la captura desde los visores, Fase 2, sin implementar) — el bloque
> "Historial del caso" siempre muestra "No hay guardados" en producción hoy; se probó insertando una
> fila de prueba a mano en staging (borrada al cerrar) para validar el camino feliz del modal "👁 Ver"
> antes de que exista una forma real de generarlas. **Verificado en staging con el flag encendido a
> mano:** crear ficha → vincular una entrada → editar carátula → `GET /:id` la refleja → `GET
> .../snapshots/999` (inexistente) → 404 → insertar snapshot de prueba → `GET
> .../snapshots/<id>` → contenido correcto → `DELETE ?entries=delete` → `entradasBorradas:1` y 0
> filas residuales. **No-regresión repetida en staging y prod** (rutas de `usuarios.js` en 200, gate
> sigue en 403 con el flag apagado). Comparte el listado de fichas con Bitácora (`loadBitacoraExpedientes()`,
> sin duplicar la llamada de red) y el módulo de entradas (`bitEntryRowHtml`, `bitacoraRefreshCurrentContext()`
> — nueva función despachadora que decide si repintar la vista de Bitácora o la ficha abierta de Mis
> Expedientes según la sección activa, para que tildar/borrar una entrada desde cualquiera de los dos
> lugares refresque el contexto correcto).
>
> ✅ **F1.5 EJECUTADA Y EN PRODUCCIÓN (2026-08-14, misma sesión).** Píldora "Establecer como
> principal" en Mi Plan y Bitácora (mutuamente excluyentes, `users.home_section`), checkbox
> "📔 Incluye Bitácora" en el form de planes del admin (`plans.bitacora_enabled`, mismo patrón que
> el select de Visibilidad ya existente), y el **aterrizaje del login/SSO validado contra
> `bitacoraEnabled` en el punto de uso** (hallazgo A4 del plan) — `initDashboard()` ya no hace
> `navigateTo('plan')` fijo, calcula `home = (homeSection==='bitacora' && bitacoraEnabled) ? 'bitacora' : 'plan'`
> antes de navegar, así que un usuario que dejó Bitácora como principal y después perdió el plan NO
> aterriza en una sección con candado en cada login. **3 endpoints tocados:** `GET /client/account`
> (nuevo campo `homeSection`), `PUT /usuarios/api/profile` (acepta `home_section`, valida el enum
> `'plan'|'bitacora'`, 400 si no), `POST/PUT /admin/plans` (aceptan `bitacora_enabled`, mismo patrón
> `COALESCE` que el resto de los campos del form). **Verificado en staging:** escribir
> `home_section=bitacora` → se refleja en `GET /account` → valor inválido → 400 → no-regresión de
> un `PUT /profile` sin `home_section` (solo `nombre`) → 200 · admin: `bitacora_enabled=true` en un
> plan → se conserva tras un `PUT` posterior que no lo toca (mismo `COALESCE` que ya usan
> `visibility`/`price_ars`) → revertido a `false` al cerrar. **No-regresión repetida en prod:** las
> 6 planes de producción muestran `bitacora_enabled:false` sin excepción, `plans`/`subscription`
> siguen en 200, `pm2-error.log` sin entradas nuevas. **Nada visible para ningún usuario real** — el
> flag sigue apagado en los 6 planes, y sin él la píldora de Bitácora ni siquiera se renderiza
> (`display:none` en `renderHomePills()`). **Con esto, la Fase 1 lleva 5 de 8 sub-bloques cerrados**
> (F1.1–F1.5).
>
> ✅ **F1.6 EJECUTADA Y EN PRODUCCIÓN (2026-08-14, misma sesión).** Exportación: botón "⬇ Exportar"
> en Bitácora y en Mis Expedientes (listado), "⬇ Exportar este caso" en la ficha — un modal
> compartido con los 3 alcances × 2 formatos del mockup de §5.3. **1 endpoint nuevo:**
> `GET /usuarios/api/bitacora/export` (`alcance=todo|entradas|expediente`, `formato=xlsx|json`,
> `expediente_id=`, `desde=`/`hasta=` para el rango de "entradas"). **Gate DISTINTO al resto de
> `/bitacora/*`, a propósito:** usa `checkBitacoraPlan({ conGracia: true })` (la opción que F1.2
> dejó lista sin usar) — sostiene los 90 días de acceso a la exportación tras perder el plan
> (decisión D2/Q6, §8). Para que conviva con el gate estricto del resto sin tocarlo, la ruta se
> registra directamente en el router raíz **antes** del `router.use('/bitacora', ..., entradas)`:
> Express matchea por orden de registro, así que `/bitacora/export` (más específica) gana la carrera
> antes de llegar al `.use()` genérico — mismo principio de sub-paths que ya sostenía el punto
> crítico P1 de F1.2, aplicado una vez más. **Nueva dependencia: `exceljs` en `backend-server`**
> (no estaba — el backend nunca había generado Excel, a diferencia de Electron) — instalada con
> `npm install`, diff de `package-lock.json` verificado limpio (solo agrega el árbol de `exceljs`,
> ninguna versión de una dependencia existente cambió). **3 hojas en el Excel** (Expedientes,
> Entradas, Historial) según el alcance — "todo" trae las 3, "entradas" solo Entradas, "expediente"
> trae Entradas + Historial sin la hoja de Expedientes (ya se sabe de qué caso se trata). El JSON es
> un volcado fiel con `backup_version:1`, pensado para que F1.7 lo sepa leer. **2 bugs reales
> encontrados y corregidos durante la verificación en staging, no en el diseño:** (1) la validación
> de rango de fechas invertía el contrato de `fecha()` (que devuelve `undefined` tanto para "no vino"
> como para "inválida") — un `GET` sin `desde`/`hasta` (el caso normal para "todo"/"expediente") daba
> 400 en vez de exportar sin filtro; corregido siguiendo el mismo criterio permisivo que ya usa
> `GET /bitacora`. (2) en el Excel de alcance "todo", la columna "Expediente vinculado" de la hoja
> Entradas quedaba vacía porque esa consulta no hace `JOIN` con `expedientes_seguidos` (a diferencia
> de "entradas", que sí) — corregido resolviendo el nombre por un `Map` construido desde
> `datos.expedientes`, con el valor ya unido teniendo prioridad. **Verificado en staging con datos
> reales:** las 6 combinaciones alcance×formato devuelven 200 con contenido correcto (el JSON
> descargado y el Excel re-parseado con `exceljs` localmente, no solo el status code) · IDOR
> (`expediente_id` inexistente → 404) · no-regresión de `/bitacora` y `/bitacora/avisos` (no quedaron
> tapadas por la ruta nueva) · **las 3 ramas del gate de gracia**, una por una: flag apagado sin
> gracia → 403 en CRUD normal pero el propio export también 403 sin `bitacora_lost_access_at` seteado
> · flag apagado con `bitacora_lost_access_at` de hace 10 días → CRUD sigue en 403, **export en 200**
> (la gracia funcionando) · `bitacora_lost_access_at` de hace 100 días (>90) → export vuelve a 403
> con `BITACORA_GRACIA_VENCIDA`. **No-regresión repetida en prod** tras el deploy (incluyendo el
> `npm install` de la dependencia nueva): `/bitacora`/`/bitacora/avisos` en 403 con el flag apagado
> (como siempre), `/usuarios/api/plans` en 200, `pm2-error.log` sin entradas nuevas. **Nada visible
> para ningún usuario real** — el flag sigue en `false` en los 6 planes. **Con esto, la Fase 1 lleva
> 6 de 8 sub-bloques cerrados** (F1.1–F1.6).
>
> ✅ **F1.7 EJECUTADA Y EN PRODUCCIÓN (2026-08-14, Opus).** La restauración desde backup JSON — el
> único tramo del módulo que puede destruir datos reales. **1 endpoint nuevo:**
> `POST /usuarios/api/bitacora/import` (`modo=combinar|reemplazar`, `dry_run=1`), montado dentro del
> router `entradas` para heredar el gate **estricto** (la gracia de 90 días de D2/Q6 es solo para
> SACAR los datos, nunca para escribir). **Transporte por multipart (multer + memoryStorage), no por
> `express.json`** — el parser global tiene el límite de 100 KB y, sobre todo, lleva el hook `verify`
> del que depende la firma HMAC de los webhooks de MercadoPago (punto crítico P2): multer parsea
> **solo** esta ruta, sin agregar ni reordenar nada en la cadena global. **Las 3 salvaguardas de §5.3,
> implementadas y verificadas una por una:** (1) validación completa ANTES de abrir la transacción —
> versión, estructura, **pertenencia a la cuenta** y cada fila contra los CHECK reales del esquema;
> (2) dry-run obligatorio desde el portal, con los números concretos del impacto; (3) transacción
> única, todo o nada. La 4ª (respaldo automático previo) la dispara el portal descargando el export
> de F1.6 antes de confirmar — **y si ese respaldo falla, la restauración se aborta**, porque sin él
> la operación dejaría de ser reversible, que es la garantía que sostiene toda la pantalla.
> **Decisiones de identidad:** las fichas se reconocen por `expediente_key` (la UNIQUE del esquema),
> las entradas por su id interno — y los ids se **preservan** al insertar, lo que hace la restauración
> **idempotente**: importar el mismo archivo dos veces deja exactamente el mismo estado en vez de
> duplicar lo recreado. Un `idMap` traduce los ids de fichas del backup a los reales, así que las
> entradas quedan re-vinculadas al caso correcto aunque haya cambiado de id.
> **1 bug encontrado y corregido en staging:** la primera versión ajustaba la secuencia de
> `bitacora_entries` con `setval` tras preservar ids — y falló con *"permission denied for sequence"*,
> porque `procurador_user` tiene `USAGE, SELECT` sobre las secuencias (lo que concedió F1.1) y
> `setval` exige `UPDATE`. **Se eliminó la llamada en vez de ampliar privilegios:** todo id de un
> backup fue emitido por esa misma secuencia, así que es ≤ su valor actual y el próximo `nextval()`
> siempre devuelve uno mayor — la colisión que el `setval` pretendía evitar no puede ocurrir
> (verificado: crear una entrada nueva justo después de un import con ids preservados funciona).
> **Verificado en staging con un harness de 38 aserciones — 38/38 PASS**, sobre un escenario realista:
> se crean 2 casos + 3 entradas, se exporta el backup **con el endpoint real de F1.6**, se diverge a
> propósito (borrar un caso, editar otro, crear un tercero local) y se restaura. Confirmado que
> combinar **recrea** el borrado con sus entradas y sus ids originales, **pisa** el editado, y
> **conserva intacto** el local que no está en el backup; que el dry-run no escribe una sola fila; que
> un segundo import del mismo archivo no cambia nada (idempotencia); que reemplazar deja
> exactamente el contenido del backup y elimina el local; y las 7 validaciones de rechazo, incluida
> la de **pertenencia** (un backup con otro `user_id` → 400 sin tocar nada). **La garantía
> transaccional quedó demostrada sobre un fallo REAL, no simulado:** en la corrida previa al fix, el
> error de `setval` ocurrió en modo `reemplazar` **después** de haber ejecutado los dos `DELETE` del
> usuario y todos los inserts — y al verificar la base, el caso local seguía presente con su carátula
> intacta. Es la prueba más valiosa de la sesión, porque ejercita exactamente el camino que importa.
> **No-regresión repetida en prod:** las rutas existentes intactas, `pm2-error.log` sin una sola
> entrada nueva (la última sigue siendo del 30/07), y los 6 planes con el flag en `false`.
> **Con esto la Fase 1 llegó a 7 de 8 sub-bloques.**
>
> ✅ **F1.8 EJECUTADA Y EN PRODUCCIÓN (2026-08-14, misma sesión) — CIERRA LA FASE 1 COMPLETA (8/8).**
> ABM de feriados en el dashboard admin. **3 endpoints nuevos** en `routes/admin.js` (no en
> `routes/bitacora.js`: es config **global** del sistema, sin `user_id`, así que va con auth de admin
> y **sin** el gate de plan): `POST/PUT/DELETE /admin/feriados`, más un `GET` con filtro opcional por
> año (el `GET` de F1.2 en `routes/bitacora.js` sigue siendo el de lectura para el portal — no se
> tocó). Nueva sección "📔 Feriados" en el sidebar del dashboard: tabla ordenada por fecha con filtro
> por año, alta/edición por modal (`_injectModal`, el patrón ya usado en Pagos), borrado con
> confirmación. **1 detalle de escape corregido antes de desplegar** (no llegó a producción con el
> bug): la primera versión pasaba el feriado completo como JSON embebido en un atributo `onclick`
> entre comillas simples — un `motivo` con un apóstrofe (ej. *"Feria de invierno (d'Elia)"*) habría
> roto el atributo. Se simplificó a pasar solo el `id` y buscar el feriado en la caché en memoria
> (`_feriadosCache`), que es más simple que escapar JSON dentro de un atributo y elimina la clase de
> bug entera. **Verificado en staging con datos reales:** alta con un motivo que contiene un
> apóstrofe (guardado y leído sin corromperse) · duplicado en la misma fecha → 409 · edición →
> refleja el cambio · filtro `?year=2027` incluye el registro de prueba · fecha inválida → 400 ·
> borrado → limpio · sin token admin → 401. **No-regresión repetida en staging y prod:**
> `/admin/plans`, `/admin/users/search`, `/usuarios/api/plans` intactos; el `GET` público de F1.2
> (con su propio gate de plan) sigue devolviendo 403 para un usuario sin el flag, confirmando que los
> dos endpoints de lectura (admin y portal) conviven sin pisarse. **Prod arrancó con los 52 feriados
> exactos del seed de F1.1** (staging quedó igual tras la limpieza de las pruebas), `pm2-error.log`
> sin una entrada nueva tras el restart. **Nada visible para ningún usuario real** — el ABM es
> exclusivamente del dashboard admin, y el flag de Bitácora sigue en `false` en los 6 planes.
>
> **🎉 Con esto, la Fase 1 completa del plan (F1.1–F1.8, los 8 sub-bloques) queda en producción.**
> El módulo es operable de punta a punta desde el portal —agenda, expedientes seguidos, backup y
> restauración, todo gateado por plan y sin ningún cambio visible mientras el flag siga apagado—
> salvo la captura automática desde los visores de procuración/informe, que es la **Fase 2**
> (F2.1–F2.7, requiere backend + un release de Electron) y queda pendiente para cuando se decida
> avanzar. Recordatorio del hallazgo C6 (§11): la Fase 1 sola no tiene el diferencial de la
> propuesta — no anunciar ni vender la feature todavía; usarla para validación interna encendiendo el
> flag en un plan de prueba.

1. **(F1.1)** Migraciones (**4 tablas** — `expedientes_seguidos`, `expediente_snapshots`, `bitacora_entries`, `feriados` — + **4 columnas**: `plans.bitacora_enabled`, `users.home_section`, `users.bitacora_prefs`, `users.bitacora_lost_access_at` [agregada 2026-08-12, decisión D2/Q6, ver §8]) **+ la columna `expediente_key` en `expedientes_seguidos`** con `UNIQUE (user_id, expediente_key)` — **sin `jurisdiccion` en la clave** (decisión D1 + corrección 2026-08-13, ver §7) **+ los 4 índices de §7** *(eran 5; `idx_exp_seguidos_user` quedó redundante al corregir la clave única)* + seed de feriados **resto de 2026 + todo 2027** (alcance confirmado 2026-08-12, decisión D4). **Incluye crear `backend-server/utils/expedienteKey.js`** (normalización canónica) **+ el fixture de casos compartido** con Electron — ver la nota "DÓNDE VIVE LA NORMALIZACIÓN" de §7. ⚠️ **Prerrequisito Bloque B.1 (regenerar `schema.sql`): ✅ ya cumplido** (schema regenerado el 28/07, 27 tablas verificadas — ver `revision-bitacora-preimplementacion-2026-08-12.md`).
2. **(F1.2)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** Endpoints CRUD de bitácora/expedientes + avisos + gate de plan (con el carve-out de export, hallazgo H5, §8). *(Los endpoints de `capture` YA NO van acá — se movieron a Fase 2, punto 2, hallazgo C2.)* 🚨 **PUNTO CRÍTICO P1 (§11.0): el gate NO va en `routes/usuarios.js`** — ese archivo tiene 8 rutas vivas del portal que quedarían en 403. **Resuelto así:** `routes/bitacora.js` se monta en `/usuarios/api` (mismo prefijo que `usuarios.js`) pero aplica el gate sobre **sub-paths** (`router.use('/bitacora', auth, gate, …)`), no sobre el router — una petición a `/usuarios/api/profile` entra, no matchea ningún sub-path y cae al router de usuarios **sin tocar el gate**. **Prueba de no-regresión hecha y pasada**, en staging (39/39) y repetida en prod: con el flag apagado, las 8 rutas existentes responden normal (200/400/404, **ninguna 403**) y las 3 de Bitácora dan 403 con mensaje claro. Archivos: `routes/bitacora.js`, `middleware/checkBitacoraPlan.js` (con la opción `conGracia` lista para el export de F1.6).
3. **(F1.3)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** Portal: sección Bitácora (banner de avisos con checks, vista mes + lista, panel de tareas, modal de entrada con calculadora de plazos). Archivos: `public/usuarios/index.html` (`#section-bitacora`, `#modal-bitacora-entrada`, nav item `#nav-bitacora`), `app.js` (~700 líneas nuevas: estado `state.bitacora`, calendario, lista agrupada, CRUD, calculadora de plazos en días hábiles), `app.css` (clases `.bitacora-*`). Reutiliza `showToast`/`showConfirm`/`escapeHtml` existentes — sin diálogos nativos ni HTML sin escapar. **Semana** del toggle Mes/Lista quedó fuera de esta implementación (el plan la mencionaba de forma ambigua en §5.1); se dejó Mes + Lista, que cubren el mismo caso de uso — candidato a agregar después si se pide explícitamente.
4. **(F1.4)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** Portal: sección Mis expedientes (listado, ficha, edición, eliminación con elección sobre entradas). El bloque "Historial del caso" (§5.2) queda construido y funcional pero sin datos posibles hasta la Fase 2 (nada escribe en `expediente_snapshots` todavía).
5. **(F1.5)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** Píldoras "Establecer como principal" en Mi Plan y Bitácora + `home_section` en el login del portal + checkbox "Incluye Bitácora" en el form de planes del admin. La guarda del hallazgo A4 (`home_section` validado contra `bitacoraEnabled` en el punto de uso, no solo al escribirlo) quedó implementada en `initDashboard()`.
6. **(F1.6)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** **Exportación** (Excel + JSON, global y por ficha) — el backup del usuario desde el día uno. Queda cumplida la **dependencia dura de F1.7** (hallazgo C4): la salvaguarda de importación (§5.3, "respaldo automático antes de aplicar") va a poder descargar un export real del estado actual.
7. **(F1.7)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** **Importación/restauración** desde backup JSON (modos reemplazar/combinar, vista previa dry-run, respaldo automático previo, transaccional). Requiere F1.6 completo (ver punto 6) — cumplido. ⚠️ **Ambigüedad de §5.3 resuelta hacia el lado menos destructivo, ver P-F1.7-a en §11.2.**
8. **(F1.8)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-14).** ABM de feriados en el dashboard admin (hallazgo H2) — sin esto, la calculadora de plazos de F1.3 no tiene cómo mantenerse actualizada año a año.
- **Entregable**: módulo completo operable a mano desde el portal (entrada manual, sin captura desde visores todavía), con backup y restauración, gateado por plan. Deployable a staging→prod sin release de Electron. (Si hiciera falta acortar la fase, F1.7 es el único candidato razonable a diferir — nunca F1.6, del que depende.)
- **⚠️ Nota de producto (hallazgo C6):** al cerrar esta fase, la Bitácora **no tiene el diferencial** que motiva la propuesta (§1/§14: *"el dato nace de la automatización que ya corre todos los días"*) — sin Fase 2 es una agenda manual sin ventaja sobre papel o Google Calendar. **No anunciar ni vender la feature al cerrar la Fase 1**; usarla para validación interna con el flag `bitacora_enabled` encendido en un plan de prueba únicamente.

### Fase 2 — Captura desde los visores (backend + release de Electron)
> **Requiere DOS despliegues, no uno** (hallazgo C3): un deploy de backend (los endpoints de `capture` + `GET /client/bitacora/seguidos`) **y** un release de Electron. Planificar ambos.

> ✅ **F2.1 EJECUTADA (2026-08-15) — código listo, SIN release todavía.** La botonera y el
> post-procesado están construidos y verificados, pero deliberadamente **no se desplegó nada**:
> F2.1 es trabajo 100% cliente de Electron, y per el "Entregable" de esta fase (más abajo), el
> release se corta **una sola vez, al final**, cuando F2.2/F2.4 (backend) también estén listos —
> cortar un release ahora dejaría botones que envían un POST a un endpoint que todavía no existe
> (`/usuarios/capture`, F2.2) y una consulta de "ya seguidos" que siempre da 404
> (`GET /client/bitacora/seguidos`, F2.4). El diseño de F2.1 ya asume ambos ausentes — ver P3 más
> abajo — así que esto no bloquea nada: el código queda esperando a F2.2/F2.4 sin volver a tocarse.
> Detalle completo en la entrada de sesión de CLAUDE.md (2026-08-15).
>
> ✅ **F2.2 EJECUTADA Y EN PRODUCCIÓN (2026-08-15, Opus).** Los 3 endpoints de captura, con el
> **punto crítico P2** resuelto y verificado. **El parser de 5 MB va path-scoped a
> `/usuarios/capture`, entre el `express.json` (el del hook `verify`) y el `express.urlencoded`
> GLOBAL** — las dos posiciones importan por razones distintas: después del json para no tocar el
> camino del cobro, antes del urlencoded global porque si ese corriera primero rechazaría con 413 a
> los 100 KB y el parser específico nunca vería el body. Subir el límite global a 5 MB estaba
> descartado en §4.1.1 (reabriría el problema del hallazgo C5) y se respetó. **Verificado que el
> límite global sigue intacto:** un urlencoded de 200 KB contra otra ruta se sigue rechazando
> (`limit: 102400` en el log). **La verificación de P2 cambió respecto de lo que el plan asumía, y
> ese fue el hallazgo de la sesión (P-F2.2-a):** el check del smoke oficial solo prueba que una
> petición SIN firma se rechaza — eso pasaría igual con el body roto. Al leer `verifyMPSignature()`
> se descubrió que **la validación no usa `req.rawBody`** (arma el manifest con `req.body.data.id` +
> headers; el `rawBody` que captura el hook no lo lee nadie en todo el repo). Así que se agregó la
> prueba **positiva**: firma HMAC válida → aceptada (200), firma inválida → rechazada (401), corrida
> en staging y **repetida en prod tras el deploy**. Más el smoke oficial de cobranza, **19/19 en
> staging y 19/19 en prod**. **El endpoint anónimo, con las 5 protecciones de §4.1.1:** id de
> borrador de 32 bytes aleatorios · TTL 10 min + uso único + tope de 100 simultáneos
> (`utils/captureDrafts.js`) · rate-limit dedicado 30/5min · payload tratado como entrada no
> confiable (se valida y acota, nada toca las tablas reales hasta que un usuario autenticado lo
> reclama) · y una protección que el plan no enumeraba pero es imprescindible en un endpoint anónimo
> que responde con `Location`: **el redirect se arma íntegramente del lado del servidor**. El campo
> `goto` que manda el visor **no se refleja nunca** en el header — si se reflejara, esto sería un
> open redirect abierto a internet. Verificado con un `goto=https://evil.example.com` real, en
> staging y en prod: el `Location` sigue siendo `/usuarios/?goto=bitacora&draft=…`. **Harness de 36
> aserciones en staging — 36/36 PASS**, cubriendo el PRG completo (POST anónimo → 303 → reclamo
> autenticado → uso único), el cap H3 de 200 filas (en los DOS lugares: al recibir y al aplicar), el
> tope estructural 2+2 del hallazgo H4 verificado con **4 capturas seguidas del mismo caso** (quedan
> exactamente 2 por caso/kind), la dedup por `expediente_key` (una segunda captura actualiza, no
> duplica), y que un expediente irreconocible se **omite sin abortar el lote**. **1 aserción propia
> mal formulada, corregida tras un control contra producción:** esperaba 413 para un body sobre el
> límite y llegó 500 — el control (mismo request contra prod **sin F2.2 desplegado**) devolvió
> idéntico 500, confirmando que es preexistente y no una regresión (P-F2.2-b). **Cero errores nuevos
> en el log de prod atribuibles al deploy** — la única entrada del día es la de ese propio control,
> con timestamp anterior al restart. **Nada visible para ningún usuario real:** el flag sigue en
> `false` en los 6 planes, y el endpoint anónimo solo se alcanza desde un visor con la botonera, que
> requiere un release que todavía no se cortó.
>
> ✅ **F2.3 EJECUTADA Y EN PRODUCCIÓN (2026-08-15, Sonnet 5).** El consumidor del borrador de F2.2:
> el portal reclama `GET /capture-draft/:id` y despacha por `accion` a 3 tratamientos distintos —
> aplicar-y-avisar para `ficha`/`snapshot`(-lote), modal precargado para `entrada` individual, y una
> **pantalla nueva de revisión del lote** (`#modal-bitacora-lote`) para `entrada-lote`: una fila
> editable por caso (checkbox de inclusión, expediente de solo lectura, título y fecha editables) más
> un campo "aplicar fecha a todos". **1 pieza de contrato nueva, del lado del backend, que F2.2 no
> había necesitado todavía:** `POST /usuarios/api/expedientes/capture-lote` ahora devuelve, además
> del `resumen` agregado que ya tenía, un array `perCaso: [{expediente, expediente_id, creado}]` —
> el portal lo necesita para saber el `expediente_id` REAL de cada caso (tras el upsert por
> `expediente_key`, que puede pisar una ficha ya existente) y así vincular las `bitacora_entries` que
> crea después a la ficha correcta, sin un segundo round-trip por caso. **Guardado del lote en 2
> fases, no N:** primero un único `POST .../capture-lote` (accion='snapshot-lote') sobre todos los
> casos incluidos, para obtener el mapa de ids; después un loop **secuencial** (no `Promise.all`)
> creando una entrada por fila vía `POST /usuarios/api/bitacora` — secuencial a propósito: son como
> mucho unas pocas decenas de filas (revisión manual, no un hot path) y así un fallo puntual no aborta
> las que ya se crearon. **`openBitacoraModal()` extendida de forma retrocompatible:** gana un segundo
> parámetro opcional `overrides` (`{kind, title, description}`) — todos los call sites existentes de
> F1.3/F1.4 (un solo argumento) siguen funcionando sin cambios; solo el flujo de captura individual
> lo usa, con un título sugerido a partir del primer movimiento del caso (`tituloSugeridoDesdeCaso()`,
> corta a 80 chars, o cae a "{Tipo} — {expediente}" si no hay movimientos). **El deep-link sobrevive
> al login igual que `pending_goto`:** un nuevo par `pending_capture_draft`/`pending_capture_error`
> en `sessionStorage`, capturado del `?draft=`/`?captura=` de la URL y consumido en `initDashboard()`
> — necesario porque el form del visor todavía no manda SSO (eso es F2.6, sin implementar), así que
> si el usuario no tenía sesión abierta en la pestaña `procurador_portal`, el draft debe sobrevivir el
> ciclo de login normal. **Verificado con un harness de 24 aserciones en staging — 24/24 PASS:** el
> `perCaso` trae ids numéricos correctos y coincide con las fichas reales de la base · una segunda
> captura del mismo expediente da `creado:false` con el mismo id (no duplica) · el ciclo completo
> `accion=entrada` (form→draft→reclamo→upsert→entrada vinculada) · el ciclo completo
> `accion=entrada-lote` con 2 casos, confirmando que las entradas quedan vinculadas al caso correcto
> y no cruzadas entre sí · no-regresión de `/usuarios/api/plans`, el estático del portal y
> `/usuarios/api/subscription/current` (P1 de F1.2 sigue intacto). **No-regresión repetida en
> producción:** `pm2-error.log` sin entradas nuevas atribuibles al deploy (la única del día es de
> horas antes, ya documentada como P-F2.2-b) y los 6 planes con `bitacora_enabled=false` sin
> excepción. **Nada visible para ningún usuario real** — igual que F2.1/F2.2, esto solo se alcanza
> desde un visor con la botonera, que requiere el release de Electron que todavía no se cortó.
>
> ✅ **F2.4 EJECUTADA Y EN PRODUCCIÓN (2026-08-15, Sonnet 5). El último eslabón de backend que
> le faltaba al post-procesado de F2.1: `GET /client/bitacora/seguidos`.** 1 endpoint nuevo en
> `routes/client.js` (junto a `/account`, mismo router — no en `routes/bitacora.js`, porque lo
> consume `main.js` con el prefijo `/client` que ya usa para todo lo demás). **Contrato deliberadamente
> plano, dictado por el consumidor:** `{ seguidos: ["FCR 18745/2017", ...] }` — un array de strings,
> no de objetos, porque `visorModal_template.html`/`visor_informes_template.html` (F2.1) hacen
> `.map(claveLigera)` directo sobre cada elemento del array; envolver en `{expediente: "..."}` habría
> roto ese contrato sin que ningún test lo cazara hasta abrir un visor real. **Gate de plan estricto**
> (`checkBitacoraPlan()`, sin `conGracia` — esto no es exportación), aplicado solo a esta ruta
> puntual (no a nivel de router), siguiendo el mismo patrón de sub-paths de P1/F1.2. **Por qué el 403
> del gate nunca rompe nada en la práctica:** `fetchBitacoraRuntimeInfo()` en `main.js` (F2.1) llama
> este endpoint con `axios` dentro de un `Promise.allSettled` — un 403 hace que la promesa quede
> `rejected` (axios rechaza fuera de 2xx por default), exactamente el mismo camino que un timeout o
> un error de red: `seguidos` cae a `[]`, sin excepción especial que programar. **Verificado con un
> harness de 9 aserciones en staging — 9/9 PASS:** sin el flag → 403 `BITACORA_NO_INCLUIDA` · con el
> flag y sin fichas → `200` con `seguidos:[]` · con 2 fichas → los 2 expedientes, cada uno un string
> plano (no objeto) · sin token → 401 · no-regresión de `/client/account` y `/usuarios/api/plans`.
> (El check de aislamiento entre usuarios se dejó documentado como informativo, sin otro usuario del
> plan de prueba disponible en staging para ejercitarlo — el query en sí es un `WHERE user_id=$1`
> parametrizado desde el JWT, el mismo patrón ya probado exhaustivamente contra IDOR en F1.2/F1.4
> sobre esta misma tabla.) **No-regresión repetida en producción:** `pm2-error.log` sin entradas
> nuevas atribuibles al deploy, los 6 planes con `bitacora_enabled=false` sin excepción, `/client/bitacora/seguidos`
> sin token → 401 confirmado en vivo. **Nada visible para ningún usuario real** — el flag sigue
> apagado y el endpoint solo lo llama el post-procesado de un visor que todavía no llegó a ningún
> usuario (sin release). **Con esto, el backend de la Fase 2 queda completo** (F2.2 + F2.4).
>
> ✅ **F2.5 CÓDIGO LISTO (2026-08-15, Sonnet 5), sin release. El informe individual gana su mini-visor
> — reusando el generador del informe por lote, no un template nuevo.** El informe individual nunca
> generó HTML (solo abre el PDF), así que no había dónde exponer la botonera de captura para ese
> flujo. En vez de escribir un template propio, se llama `generarVisorHTML()` (el mismo generador que
> ya usa el informe por lote desde F2.1, con la botonera de checkbox+barra de acciones completa) con
> un resumen sintético de **1 solo elemento** — misma pantalla, un solo renglón. **`generarVisorHTML()`
> gana un 5º parámetro opcional `nombrePrefijo` (default `'informe-lote'`, retrocompatible con el call
> site del batch sin tocarlo):** sin esto, el mini-visor individual se habría llamado
> `informe-lote_visor_*.html`, un nombre engañoso para un solo expediente — ahora usa
> `informe-individual_visor_<ISO>.html`, coherente con la convención de nombres de v2.7.33.
> **Cero cambios en `visor_informes_template.html`:** la botonera del informe por lote ya funciona por
> checkbox-y-barra-flotante disparando acciones `-lote` (`ficha-lote`/`snapshot-lote`/`entrada-lote`)
> — con un solo checkbox tildado, un lote de 1 elemento es exactamente el mismo camino que ya
> verificaron 24/24 el harness de F2.3 y las 36 del harness de F2.2; no hacía falta un botón "individual"
> aparte. **Gateado en `bitacoraInfo.enabled`, no solo en `result.success`:** sin el flag no se escribe
> ningún archivo nuevo en cada corrida de informe — el PDF se sigue abriendo exactamente igual que
> hoy, sin ningún cambio de comportamiento para los usuarios sin el módulo (mismo criterio que ya
> aplicaron F2.1/F2.4 para no introducir trabajo o archivos invisibles-pero-presentes en el disco de
> cuentas sin el flag). **Reusa `fetchBitacoraRuntimeInfo()` de F2.1 tal cual** (mismo fail-safe:
> `try/catch` que nunca propaga, timeout de 3s, `Promise.allSettled` con `/client/bitacora/seguidos`
> de F2.4) — si la consulta de red falla, simplemente no se genera el mini-visor esa corrida, el PDF
> se abre igual. **3 archivos tocados:** `informe/generador_visor.js` (parámetro nuevo, retrocompatible)
> · `main.js` (el bloque nuevo en `runInformeLogic()`, modo individual, justo después de abrir el PDF)
> · `preload.js`/`renderer.js` (bridge + auto-apertura `onInformeIndividualVisorReady`, mismo criterio
> `config.visor.abrirAutomaticamente` que ya usa el informe por lote). **Verificado sin necesitar el
> PJN real:** una corrida real de `generarVisorHTML()` con un resumen sintético de 1 expediente y
> `bitacoraInfo` real — confirma el nombre de archivo (`informe-individual_visor_*`), el contenido de
> `DATOS_BATCH` (1 expediente, `bitacora.enabled:true`, `seguidos` con el valor pasado) reparseado con
> `JSON.parse` sobre el bloque completo · `node --check` en los 4 archivos · `npm start` con arranque
> limpio (sin `uncaughtException`, mismos mensajes de inicialización de seguridad que toda sesión
> anterior). **Sin backend tocado, sin deploy, sin release** — mismo patrón que F2.1: el flag sigue en
> `false` en los 6 planes y esto no es observable para ningún usuario real hasta que se corte un
> release.
>
> ✅ **F2.6 CÓDIGO LISTO (2026-08-15, Sonnet 5), sin release. El visor deja de exigir un login manual
> cuando se abre desde la app con sesión activa — el token viaja en el fragmento de la URL, nunca lo
> ve el servidor.** El diseño original de la propuesta ya apuntaba a esto (§4.1: "el formulario puede
> llevar además el hash SSO como ya hace `openPortalSection`" — "técnica estándar y de bajo riesgo",
> comparado explícitamente con el POST binding de SSO/SAML), pero **antes de tocar código se verificó
> el supuesto en vez de asumirlo:** ¿el fragmento de una request realmente sobrevive un 303 cuyo
> `Location` no trae fragmento propio? Se armó un servidor Node mínimo (2 endpoints: uno que responde
> 303 sin fragmento, otro que solo imprime `location.hash` sin ningún JS que lo toque) y se navegó con
> el Browser pane real — **confirmado**: `http://localhost:5175/target?draft=abc123#sso=TEST_TOKEN_ABC123`,
> el navegador reaplicó el fragmento original de la request al redirect. Sin este chequeo empírico,
> el diseño se habría apoyado en un comportamiento de navegador citado de memoria en un plan de julio,
> nunca antes probado en este proyecto. **Implementación, 4 archivos:** `fetchBitacoraRuntimeInfo()`
> (main.js, ya existía desde F2.1) gana el JWT actual (`authManager.backendClient.token`, la misma
> fuente que usa `openPortalSection`) — **gateado en `enabled`, no incondicional:** sin esto, todo
> visor de procuración/informe por lote (se generan siempre, tengan o no el flag) habría quedado con
> un JWT vivo embebido en el HTML aunque la botonera ni se renderice, exposición sin ninguna función
> para el 100% de las cuentas sin Bitácora. `generador_visor.js` propaga `ssoToken` en `DATOS_BATCH.bitacora`
> (F2.5, el mini-visor del informe individual, lo hereda gratis por compartir el mismo generador). Los
> 2 templates (`visorModal_template.html`, `visor_informes_template.html`) arman
> `form.action = '.../usuarios/capture' + (ssoToken ? '#sso='+encodeURIComponent(ssoToken) : '')` —
> sin token, el `form.action` queda exactamente igual que hoy (sin cambio de comportamiento). **Fallback
> ya cubierto sin código nuevo:** un token vencido (visor reabierto días después) hace que
> `loadAccount()` del portal reciba 401 → `doLogout()` limpia el token pero **nunca toca
> `sessionStorage`** → `pending_capture_draft` (F2.3) sobrevive intacto → el usuario cae en el login
> normal y, tras loguearse a mano, el draft se consume igual — confirmado leyendo el código real de
> `doLogout()`/`loadAccount()`/`initDashboard()`, no asumido. **Verificado sin necesitar el PJN real:**
> el test del fragmento contra un servidor propio (arriba) · una corrida real de `generarVisorHTML()`
> con `ssoToken` presente y ausente, confirmando por `JSON.parse` sobre `DATOS_BATCH` completo que
> viaja cuando corresponde y es `null` cuando `bitacoraInfo` falta · `node --check` en los 4 archivos
> (incluido el JS inline de ambos templates, extraído y validado por separado) · `npm start` con
> arranque limpio. **Sin backend tocado, sin deploy, sin release** — mismo patrón que F2.1/F2.5: el
> flag sigue en `false` en los 6 planes, nada de esto es observable para ningún usuario real.
>
> ✅ **F2.7 CÓDIGO LISTO (2026-08-15, Sonnet 5), sin release. 🎉 CIERRA LA FASE 2 COMPLETA (7/7
> sub-bloques). Botón "📔 Bitácora" en el topbar de la app + tour de onboarding actualizado.** Botón
> nuevo (`#btnTopbarBitacora`) entre `.tab-nav` y `.topbar-spacer`, estilo `.tab-btn` con acento amber
> (`--accent-muted`/`--accent-dark`, los mismos tokens que ya usa `.tab-btn.active`) para distinguirlo
> visualmente de un tab más — abre el portal externo vía SSO (`openPortalSection('bitacora')`), no
> cambia la vista interna de la app. **Arranca oculto en el HTML** (`style="display:none"`) — la
> visibilidad la decide `updateUserChip()` en el mismo punto donde ya se lee `/client/account` al
> iniciar la app, leyendo el campo `account.bitacoraEnabled` que F1.3/F1.5 ya exponían (mismo campo
> que usa el propio portal para ocultar su ítem de sidebar). **El tour se extiende, no se duplica:** el
> paso 2 (antes `target: '.tab-nav'`) pasa a `targets: ['.tab-nav', '#btnTopbarBitacora']` — el motor
> del tour (`getBoundingBox()`) **ya ignoraba elementos de tamaño cero** al calcular el bounding box
> de un `targets:[...]` (confirmado leyendo el código, no asumido), así que con el botón oculto
> (el caso del 100% de las cuentas hoy) el spotlight se sigue calculando exactamente igual que antes,
> solo sobre `.tab-nav` — **cero regresión visual en el tour para nadie hasta que algún plan tenga el
> flag**. ⚠️ **Detalle que evitó un bug silencioso:** un `target` singular (no `targets` array) NO
> tiene esa misma protección — `getBoundingClientRect()` de un elemento `display:none` devuelve un
> rect de `{width:0,height:0}`, **no `null`**, así que la lógica de "saltar el paso si no se encuentra"
> (`hasTarget && !firstRect`) nunca se dispara para un target singular oculto; un paso NUEVO y
> DEDICADO con `target: '#btnTopbarBitacora'` habría mostrado un spotlight roto (apuntando a
> `top:0,left:0`) para el 100% de los usuarios de hoy — por eso se extendió el paso existente con
> `targets:[...]`, no se agregó un paso nuevo (la alternativa que el plan también contemplaba).
> **Copy del paso 2 redactado para ambos casos** ("Si tu plan incluye el módulo 📔 Bitácora, vas a ver
> un botón extra ahí mismo…") — no afirma que el botón existe, así que sigue siendo correcto para
> quien no lo tiene. **Verificado:** estructura y JS confirmados en el Browser pane (el botón se
> renderiza con el id, label e ícono correctos — el sandbox de esta sesión no carga hojas de estilo
> externas para archivos locales, así que el color exacto no se pudo confirmar ahí; los tokens CSS
> usados son los mismos ya verificados visualmente en `.tab-btn.active` desde sesiones anteriores) ·
> `node --check` en `renderer.js` y `tour.js` · `npm start` con arranque limpio. **Sin backend tocado,
> sin deploy, sin release** — el flag sigue en `false` en los 6 planes. **🎉 Con esto, los 7 sub-bloques
> de la Fase 2 (F2.1–F2.7) tienen código listo** — F2.2 y F2.4 ya en producción (backend), los otros 5
> esperando el único release de Electron que activa todo el circuito a la vez (deploy de backend
> primero, después el release, según define el propio "Entregable" de la Fase 2 — ver arriba).

1. **(F2.1)** ✅ **CÓDIGO LISTO (2026-08-15), sin release.** Botonera `📔+` (mini-menú) + pie de descubrimiento en los 4 visores. 🔴 **Prerrequisito: el fix E4-1 del Bloque D** (escape en `visorModal_template.html`) debe estar aplicado y publicado — sin él esta fase amplía el hallazgo XSS; ver el recuadro rojo de §4.1 para el detalle de `esc()` vs `escAttr()`. ✅ **Ya estaba aplicado** (confirmado: `esc()`/`escAttr()` presentes en el template antes de tocarlo). ⚠️ **Dos mecanismos distintos** (hallazgo H1, ver §4.4 corregido): en el visor de informe batch se edita `generador_visor.js` + template (`main.js` controla `DATOS_BATCH` directamente); en los 3 visores de procuración se edita `visorModal_template.html` (la botonera) **y además** `main.js` debe post-procesar el HTML ya generado por el script encriptado para inyectar los datos por usuario (`bitacoraEnabled`, casos ya seguidos) — sin tocar los scripts encriptados, pero es un paso de implementación adicional respecto de lo que decía la versión anterior de este plan. 🚨 **PUNTO CRÍTICO P3 (§11.0): el post-procesado NUNCA puede cancelar la apertura del visor** — va en `try/catch` que no propaga, con timeout corto en la consulta de seguidos. Si falla, se abre el visor sin botonera. Hoy ese camino no depende de la red y no puede empezar a depender.
2. **(F2.2)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-15).** Backend: endpoints de `capture` (`POST /usuarios/capture`, `GET /usuarios/api/capture-draft/:id`, `POST /usuarios/api/expedientes/capture-lote` con el tope de 200 casos/request del hallazgo H3) + el parser específico de 5MB montado antes del router (§4.1.1) + PRG. **P2 verificado con la prueba POSITIVA** (firma HMAC válida sigue siendo aceptada), no solo con el rechazo de una inválida — ver P-F2.2-a. Archivos: `routes/capture.js`, `utils/captureDrafts.js`, + `captureLimiter` en `middleware/rateLimiter.js`. **Movido acá desde Fase 1** (hallazgo C2) — se construye junto a su único consumidor. 🚨 **PUNTO CRÍTICO P2 (§11.0): el parser va inmediatamente antes del `express.urlencoded` GLOBAL, NUNCA antes del `express.json` que tiene el hook `verify`** — de ese hook depende la firma HMAC de los webhooks de MercadoPago. **Identificar los parsers por lo que son, no por número de línea** (hoy 113 y 110, pero el archivo se modifica). **Antes de prod: correr `dev-tools/smoke-payments.js` en staging.**
3. **(F2.3)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-15).** El consumidor del borrador de F2.2 en el portal: dispatcher por `accion` + pantalla de revisión del lote (`#modal-bitacora-lote`) para `entrada-lote`. Detalle completo en el párrafo de estado más abajo (junto a F2.2).
4. **(F2.4)** ✅ **EJECUTADA Y EN PRODUCCIÓN (2026-08-15).** Endpoint `GET /client/bitacora/seguidos` (backend, contrato de array plano de strings) — consumido por el post-procesado de F2.1, que ya traía el link 📁 a la ficha desde fila y modal (ese lado quedó resuelto en F2.1, solo faltaba este endpoint del que dependía). Detalle en el párrafo de estado más abajo.
5. **(F2.5)** ✅ **CÓDIGO LISTO (2026-08-15), sin release.** Mini-visor del informe individual — reusa `generarVisorHTML()` (el mismo generador del informe por lote, con su botonera de captura ya completa desde F2.1) con un resumen sintético de 1 elemento, en vez de un template nuevo. Gateado en `bitacoraInfo.enabled`: sin el flag no se genera ningún archivo extra, cero cambio de UX para el resto de los usuarios. Detalle en el párrafo de estado más abajo.
6. **(F2.6)** ✅ **CÓDIGO LISTO (2026-08-15), sin release.** Deep-links con SSO cuando el visor se abre desde la app — el token viaja en el **fragmento** de la URL del POST de captura (`#sso=`), nunca en el body ni en la query, así que el endpoint anónimo de captura nunca lo ve. Verificado empíricamente con un servidor de prueba (no asumido) que el fragmento sobrevive intacto al 303 del servidor. Detalle en el párrafo de estado más abajo.
7. **(F2.7)** ✅ **CÓDIGO LISTO (2026-08-15), sin release. CIERRA LA FASE 2 COMPLETA (7/7 sub-bloques).** Botón "📔 Bitácora" en el **topbar** de la app + actualización del tour de onboarding. Detalle en el párrafo de estado más abajo.
- **Entregable**: el circuito completo F1/F1b/F1c/F2/F3 (§6). **Deploy de backend** (F2.2, F2.4, ya en producción) **+ un release de Electron** (vX.Y.Z, único, siguiendo el checklist del proyecto) — pendiente, es lo único que falta para que F2.1/F2.3/F2.5/F2.6/F2.7 (todos con "código listo, sin release") lleguen a un usuario real.

### Fase 3 — Validación y palancas

> **Renumerada y formalizada el 2026-08-15**, al cerrar la Fase 2 con el release `electron-v2.7.48`.
> Los 4 ítems originales pasan a ser **F3.1–F3.4** y se antepone un **F3.0** que antes no existía como
> sub-bloque, aunque el propio plan ya lo exigía implícitamente: dos de los ítems estaban condicionados
> a *"si el uso de fases 1-2 lo valida"* y *"recién cuando el hábito de uso exista"* — sin un tramo que
> produzca esa validación y ese uso, esas condiciones no se pueden evaluar nunca.

0. **(F3.0)** ✅ **EJECUTADO 2026-08-15 (Sonnet 5) — 55/55 casos, los 8 bloques completos, contra
   producción.** 📄 Documento propio: **`plan-pruebas-bitacora-2026-08.md`** (§8 tiene el resultado
   completo). **3 bugs reales encontrados y corregidos en vivo, misma causa raíz:** `feriados.fecha`,
   `expedientes_seguidos.situacion_fecha` y `expediente_snapshots.run_date` son columnas `DATE`
   puras que el backend serializa como medianoche UTC — leerlas con `bitLocalYmd()`/`formatDate()`
   (correctas para `timestamptz` reales, pero no para esto) las corría **un día hacia atrás** en
   Argentina (UTC-3). El más serio: la calculadora de plazos **nunca excluía un feriado real** del
   cómputo (verificado: el feriado del 17/08 se calculaba como 16/08). Corregido con `bitUtcYmd()`/
   `bitFormatUtcDate()`, verificado antes/después en vivo, commit `a95d0c8`. **Cierra P-F1.7-b**
   (el bloque de restauración de snapshots, nunca ejercitable hasta que algo generara snapshots
   reales — B4.4 los generó, B6.5 los restauró, con `idMap` re-vinculando todo sin huérfanos).
   **1 hallazgo documental:** el disclaimer de feria judicial que P-F1.1-a decía que ya existía
   **nunca se construyó** — corregido el estado de ese pendiente. **1 hallazgo cosmético sin
   corregir a propósito:** el contador `snapshotsCreados` del resumen de import no distingue
   creado de reprocesado (P-F3.0-b, bajo, no afecta integridad de datos).
1. **(F3.1)** ✅ **CÓDIGO LISTO (2026-08-15), backend ya en producción, cliente sin release.**
   Badge de pendientes en la app (conteo al abrir) — sobre el botón del topbar que ya construyó
   F2.7. `GET /client/bitacora/pendientes` (gateado por `checkBitacoraPlan()`) cuenta
   `bitacora_entries` con `due_at < NOW()` y `done_at IS NULL`; verificado con un harness de 8
   aserciones en staging y confirmado en vivo contra producción con datos reales (usuario 250,
   count=2). Hereda el **punto crítico P3** tal como estaba previsto: el IPC handler nuevo
   (`get-bitacora-pendientes-count`) reusa el mismo `BITACORA_TIMEOUT_MS`/`try-catch` que nunca
   propaga de F2.1/F2.5/F2.6, y solo se dispara desde `updateUserChip()` cuando
   `bitacoraEnabled===true`. El badge (`.badge-novedad-topbar`) reusa el patrón visual ya probado
   en producción de `.badge-novedad` del sidebar. `node --check` en los 4 JS tocados + `npm start`
   con arranque limpio. **La confirmación visual del badge quedó bloqueada por una limitación del
   entorno de esta sesión** (aislamiento de sesión de Windows entre el proceso que lanza la app y
   la sesión que ve la herramienta de control remoto — no una duda sobre el código, que sigue el
   mismo patrón ya verificado visualmente en producción para F2.7) — pendiente de una confirmación
   visual liviana en una sesión futura, no bloqueante para seguir con F3.2.
2. **(F3.2)** Visor del monitor con captura — **gateado en F3.0**: el plan siempre dijo *"si el uso de
   fases 1-2 lo valida"*, y B4 del plan de pruebas **es** esa validación. ✅ **Buena noticia
   verificada:** `generarVisorMonitoreo` vive en `main.js` y ya escapa correctamente los datos del PJN
   (contraste positivo del hallazgo E4/P-2), así que este visor usa el mecanismo **fácil** de
   inyección — `main.js` controla su payload directamente, como el visor de informe por lote, **sin**
   el post-procesado que F2.1 necesitó para los 3 visores de procuración.
3. **(F3.3)** Sugerencias automáticas a partir de novedades del monitor (bandeja de aceptar/descartar)
   — **el diferencial mayor**, pero **gateado en el uso real**, no solo en F3.0: la propuesta siempre
   dijo *"recién cuando el hábito de uso exista"*. Dejar el flag encendido tras F3.0 es lo que produce
   ese hábito; **no debería arrancar el mismo día que termina F3.0**.
4. **(F3.4)** Tipos de entrada personalizados, export .ics — **solo si hay demanda real**. Acá también
   entraría la vista "Semana" que F1.3 recortó a propósito (pendiente P-F1.3-a).

**Dependencias con el roadmap vigente:** no pisa B3 (MP producción) ni los flecos del plan de pruebas (U9.3). La fase 1 es solo backend+portal (deploy estándar, sin release de Electron); la fase 2 requiere deploy de backend **y** release de app (ver nota arriba).

### 11.1 Modelo y nivel de esfuerzo por sub-bloque (agregado 2026-07-19, corregido 2026-07-25)

> Guía para ejecutar cada tramo. Criterio: **Opus** para diseño de esquema, lógica de negocio del gating/cobro y decisiones que afectan datos del usuario (import/restauración destructiva); **Sonnet** para CRUD mecánico, UI y trabajo repetitivo con patrones ya establecidos. El esfuerzo es orientativo y asume las reglas del proyecto (staging → backup → prod; sin tocar scripts encriptados; migraciones additivas).
>
> **¿Y Haiku? — evaluado explícitamente (2026-08-12), y la respuesta es "casi nunca".** No por capacidad del modelo, sino por el **contexto implícito del proyecto**: cada sub-bloque termina en un deploy a producción con usuarios que pagan, y este repo tiene una densidad alta de convenciones que no están en el código sino en `CLAUDE.md` (nunca `git add -A` porque arrastra el worktree; el bug de `dotenv` que hace que un script "de staging" toque producción; el `npm run release` que falla desde v2.7.38 y exige subir assets a mano; staging antes que prod, siempre). El riesgo no es que Haiku escriba mal el código — es que **se saltee una de esas convenciones en la parte de deploy/verificación de la sesión**, que es donde se rompe producción. El ahorro no compensa.
>
> **La excepción concreta donde sí conviene:** generar el **seed de feriados** de F1.1 (lista de feriados nacionales argentinos + ferias judiciales de enero y julio para el resto de 2026 y todo 2027, como `INSERT`s). Es generación de datos pura — sin convenciones del proyecto en juego, tedioso de tipear, y **trivialmente verificable** contra el calendario oficial. Es una **sub-tarea dentro de F1.1**, no un sub-bloque propio; por eso no tiene fila en la tabla.
>
> ⚠️ **Correcciones 2026-07-25:** F1.2 ya no incluye `capture` (movido a F2.2, hallazgo C2) — su esfuerzo baja de Mediano a Chico-mediano. F2.1 se separa de "F2.1–F2.6" en una fila propia porque ahora incluye el post-procesado de `main.js` para los visores de procuración (hallazgo H1) — sube de esfuerzo. Se agrega F1.8 (hallazgo H2). La fila "F2.1–F2.6" se abre en F2.1 (propia) + F2.2–F2.6 (grupo restante).
>
> ✅ **Actualización 2026-08-12 (tras confirmar las 13 decisiones):** **F1.1 sube de alcance sin subir de esfuerzo** — la decisión D1 le agrega la extracción de `tokenizar()` a un **módulo compartido entre `backend-server/` y `electron-app/`** (hoy vive solo en `electron-app/informe/buscarPdfExpediente.js`). Sigue siendo "Chico", pero conviene saber de antemano que **toca dos codebases**, que es la clase de detalle que sorprende a mitad de tarea. **F2.1 baja de incertidumbre** — la decisión D11 fija el punto de enganche del post-procesado (una sola vez al terminar la corrida, no en `get-visor-path`) y exige inyección idempotente; el esfuerzo se mantiene en Mediano pero ya no hay que resolver ese diseño durante la implementación.

#### Resumen por fase (vista de planificación)

| Fase | Modelo predominante | Tramos que exigen Opus | Esfuerzo total | Deploy que produce |
|---|---|---|---|---|
| **Fase 1** — núcleo backend + portal | **Sonnet** (5 de 8 sub-bloques) | **3**: F1.1 (esquema), F1.2 (gate + carve-out), **F1.7 (importación destructiva — el más delicado de todo el plan)** | ~9–14 sesiones | Deploy de backend + portal. **Sin release de Electron.** |
| **Fase 2** — captura desde los visores | **Sonnet** (6 de 7 sub-bloques) | **1**: F2.2 (único endpoint anónimo del sistema) | ✅ **Real: 7 sesiones + 1 release** (estimado: ~4–6) | **Dos despliegues:** backend primero, después release de Electron |
| **Fase 3** — validación y palancas | **Sonnet** (4 de 5 sub-bloques) | **1**: F3.3, sugerencias automáticas por novedades del monitor (matching no trivial) | F3.0: 2–3 sesiones · el resto, variable | **F3.0 no despliega nada** (solo enciende el flag). F3.1/F3.2 requieren release de Electron |

> **Lectura rápida:** el plan es **mayormente Sonnet** — 16 de las 21 filas de la tabla de abajo, unas
> 3 de cada 4. Opus se reserva para **5 tramos puntuales** (F1.1, F1.2, F1.7, F2.2 y **F3.3**, las
> sugerencias automáticas), y de esos el que más importa es **F1.7** — es el único que puede destruir
> datos reales de un usuario. *(Actualizado 2026-08-15 al abrir la Fase 3 en F3.0–F3.4: la tabla pasó
> de 14 a 21 filas y los tramos Opus siguen siendo exactamente 5.)*

| Sub-bloque | Modelo | Esfuerzo | Por qué |
|---|---|---|---|
| **F1.1** — Migraciones (4 tablas + 4 columnas + `expediente_key`) + seed feriados | **Opus, medio** | Chico | El esquema es la fundación: definirlo bien (claves de acumulación **normalizadas** — hallazgo N1/D1 —, `ON DELETE` correctos, tope 2+2 por diseño **atómico** — hallazgo H4) evita retrabajos caros. Es additivo pero conviene razonarlo con cuidado una sola vez. |
| **F1.2** — Endpoints CRUD de bitácora/expedientes + avisos + gate de plan (con carve-out de export, H5) | **Opus, medio** | Chico-mediano *(bajó: sin `capture`, movido a F2.2)* | El gate de plan es **el freno real** (403 server-side); el carve-out de exportación (§8) necesita razonarse junto con él para no dejarlo inconsistente. |
| **F1.3** — Portal: Bitácora (calendario mes+lista, banner de avisos, modal con calculadora de plazos) | **Sonnet, medio** | **Grande** (el mayor de todo) | UI nueva, laboriosa pero de patrón conocido. El calculador de plazos (feriados) y la vista mes son lo más denso; nada de lógica de negocio riesgosa. 4–6 sesiones. |
| **F1.4** — Portal: Mis expedientes (listado, ficha, edición, borrado con elección sobre entradas) | **Sonnet, medio** | Mediano | CRUD visual + la decisión de "borrar entradas o dejarlas sueltas" (ya resuelta en el modelo con `ON DELETE SET NULL`). |
| **F1.5** — Píldora "principal" (`home_section`) + checkbox "Incluye Bitácora" en admin | **Sonnet, bajo** | Chico | Dos toggles con patrón ya usado (visibility de planes, settings). |
| **F1.6** — Exportación (Excel + JSON) | **Sonnet, bajo-medio** | Chico-mediano | Serialización directa; el Excel reusa `exceljs` (ya en el stack). **Debe terminar y probarse antes de F1.7** (dependencia dura, hallazgo C4), no solo antes en la numeración. |
| **F1.7** — Importación/restauración (dry-run + respaldo previo + transaccional) | **Opus, alto** | Mediano | **El único tramo que destruye datos del usuario.** La validación de pertenencia/estructura, el dry-run obligatorio, el respaldo automático previo (requiere F1.6 funcionando) y la transacción "todo o nada" exigen el máximo cuidado — un error acá borra la bitácora real de alguien. |
| **F1.8** — ABM de feriados (dashboard admin) *(nuevo, hallazgo H2)* | **Sonnet, bajo** | Chico | CRUD simple (fecha + motivo) con patrón ya usado en el admin. Sin esto, F1.3 (calculadora de plazos) queda sin forma de mantenerse año a año. |
| **F2.1** — Botonera en los 4 visores + post-procesado de `main.js` para procuración *(hallazgo H1, esfuerzo corregido)* | **Sonnet, medio** ✅ | Mediano *(subió: incluye el post-procesado, no solo templates)* | ✅ **Ejecutada 2026-08-15.** Dos mecanismos distintos por visor (§4.4): templates estáticos (bajo riesgo, patrón conocido) + un paso nuevo de post-procesado de HTML en `main.js` para los 3 visores de procuración, que no estaba contemplado en la estimación original. Sigue sin tocar scripts encriptados. |
| **F2.2** — Backend: endpoints de `capture` (PRG, tope 200 filas H3, parser 5MB) *(movido desde F1.2, hallazgo C2)* | **Opus, medio** ✅ | Mediano | ✅ **Ejecutada 2026-08-15.** Es el único endpoint anónimo de todo el sistema (§4.1.1) — el PRG, el upsert idempotente y las 5 protecciones del borrador-anónimo quieren el mismo cuidado que ya tenían en la F1.2 original. |
| **F2.3** — Consumo del borrador en el portal (dispatcher por `accion` + pantalla de revisión del lote) | **Sonnet, medio** ✅ | Mediano | ✅ **Ejecutada 2026-08-15.** Solo backend (`perCaso` en `capture-lote`) + portal — no toca templates de visores (eso ya lo hizo F2.1) ni scripts encriptados. |
| **F2.4** — Marcado de seguidos: `GET /client/bitacora/seguidos` | **Sonnet, medio** ✅ | Chico | ✅ **Ejecutada 2026-08-15.** Solo backend — el consumo (badge 📁, link a la ficha) ya lo había implementado F2.1 sobre un endpoint que todavía no existía; esta sesión lo puso a existir. |
| **F2.5** — Mini-visor del informe individual | **Sonnet, medio** ✅ | Chico *(bajó: reusa `generarVisorHTML()` en vez de un template nuevo)* | ✅ **Código listo 2026-08-15, sin release.** Cero cambios en `visor_informes_template.html` — la botonera de captura por checkbox ya soporta n=1 sin adaptación. |
| **F2.6** — Deep-links con SSO cuando el visor se abre desde la app | **Sonnet, medio** ✅ | Mediano | ✅ **Código listo 2026-08-15, sin release.** El punto delicado no era la edición de plantillas en sí, sino confirmar el comportamiento del navegador (fragmento a través de un 303) antes de construir sobre un supuesto — se verificó con un servidor local antes de tocar los templates. |
| **F2.7** — Botón topbar + actualización del tour (`onboarding/tour.js`) | **Sonnet, bajo** ✅ | Chico | ✅ **Código listo 2026-08-15, sin release.** El tour ya tenía el patrón multi-elemento (`targets:[]`); el paso 2 (`target:'.tab-nav'`) existe y se extendió, exactamente como preveía esta fila. |
| **F2 — Deploy de backend + release Electron** *(aclarado, hallazgo C3)* | **Sonnet, medio** | — | Deploy de F2.2/F2.4 a staging→prod **primero**, después el release de Electron siguiendo el checklist del proyecto (probar `npm start` → bump → tag → `npm run release` → 5 lugares de versión visible → deploy portal/landing). |
| **F3.0** — Validación interna con el flag encendido (plan de pruebas E2E) | **Sonnet, medio** ✅ | **Grande** — ✅ **1 sesión** (más rápido de lo estimado: 2–3) | ✅ **Ejecutado 2026-08-15, 55/55 casos.** 3 bugs reales de timezone encontrados y corregidos en vivo (misma causa raíz), incluido el paso por `modo=reemplazar` de F1.7 (el único camino destructivo del módulo) con backup fresco previo — salió limpio, sin necesitar una sesión Opus aparte. |
| **F3.1** — Badge de pendientes en la app | **Sonnet, bajo** | Chico | ✅ **Código listo (2026-08-15).** Backend ya en producción; cliente pendiente de release. Ver detalle arriba. |
| **F3.2** — Visor del monitor con captura | **Sonnet, medio** | Chico-mediano *(más bajo de lo que parecía)* | **Gateado en F3.0** (el plan siempre dijo "si el uso de fases 1-2 lo valida"). ✅ **Verificado:** `generarVisorMonitoreo` vive en `main.js` y ya escapa los datos del PJN → usa el mecanismo **fácil** (payload controlado directamente, como el informe por lote), **sin** el post-procesado que encareció F2.1. Requiere release de Electron. |
| **F3.3** — Sugerencias automáticas desde novedades del monitor (bandeja aceptar/descartar) | **Opus, alto** | **Grande** | **El diferencial mayor de toda la propuesta.** Es el único tramo de la Fase 3 con diseño de datos y lógica no trivial: el **matching novedad→entrada sugerida** (¿qué movimiento del PJN merece un vencimiento? ¿con qué fecha?), un estado nuevo para entradas sugeridas-no-confirmadas, y una bandeja de revisión. **Gateado en el uso real, no solo en F3.0** — arrancarlo sin hábito de uso es diseñar el matching a ciegas. |
| **F3.4** — Tipos de entrada personalizados · export `.ics` · vista "Semana" (P-F1.3-a) | **Sonnet, bajo-medio** | Variable | **Solo si hay demanda real.** Nada acá es estructural; son las palancas que se agregan cuando un usuario las pide, no antes. |

> **Regla transversal (crítica para no romper nada):** cada sub-bloque se valida en **staging** antes de prod, y el flag `bitacora_enabled` nace en `false` en **todos** los planes → aunque algo salga mal, ningún usuario ve la Bitácora hasta encender el flag en un plan de prueba. La Fase 1 completa se prueba y publica **sin emitir ningún release de Electron**. Ver también §11 "Nota de producto" (hallazgo C6): la Fase 1 sola no debe anunciarse ni venderse — es para validación interna.

---

### 11.2 Pendientes abiertos durante la implementación

> Decisiones tomadas **al ejecutar** un sub-bloque que dejan algo pendiente para más
> adelante. No son bugs ni deuda técnica urgente — son cabos sueltos conscientes, anotados acá
> para que no se pierdan entre sesiones. Se van agregando a medida que cada fase se ejecuta.
>
> 🎯 **Actualización 2026-08-15 — 4 de estos los cierra F3.0** (el plan de pruebas con el flag
> encendido, `plan-pruebas-bitacora-2026-08.md`), que es justamente lo que estaban esperando:
> **P-F1.7-b** (el bloque de restauración de snapshots no se podía ejercitar porque nada generaba
> snapshots → los genera el bloque B4, y B6.5 los restaura) · **P-F2.1-a** (el contrato del form POST
> se ejercita de punta a punta por primera vez en B4) · **P-F2.1-b** (si el falso negativo de
> `claveLigera()` aparece con datos reales, se ve en B4.10/B4.11) · **P-F1.1-a** (la feria judicial de
> julio se carga desde el ABM en B8.2, si la CSJN ya la publicó). Los otros —P-F1.3-a/b, P-F1.7-a,
> P-F2.2-a/b— **no** los cierra: son recortes de alcance o hallazgos informativos, no verificaciones
> pendientes.

| # | Pendiente | Surgió en | Cuándo se cierra | Estado |
|---|---|---|---|---|
| **P-F1.1-a** | **La feria judicial de julio no está en el seed de feriados.** Se cargaron los feriados nacionales del resto de 2026 y todo 2027, más la feria de enero completa (que es fija). La **feria de invierno NO**: su fecha exacta la fija la CSJN (y cada cámara) por acordada cada año y no es predecible — cargarla inventada sería peor que no cargarla, porque la calculadora de plazos daría un resultado incorrecto con apariencia de correcto. ⚠️ **Corrección 2026-08-15 (F3.0, caso B2.8):** la nota original decía que la calculadora "ya muestra el disclaimer" — **verificado en vivo que no es así**: el HTML solo tiene el texto genérico fijo "Excluye sábados, domingos y feriados judiciales...", sin ninguna lógica condicional para julio. Ese disclaimer nunca se implementó. | F1.1 (2026-08-14) | Al construir **F1.8** (ABM de feriados): el admin la carga cuando se publica la acordada. El disclaimer condicional para julio **sigue sin construirse** — es trabajo pendiente real, no algo ya hecho. | 🟡 Abierto (corregido el estado) |
| **P-F1.1-b** | **El test de Electron extrae `tokenizar()` del fuente en vez de importarla.** `tokenizar` es interna a `electron-app/informe/buscarPdfExpediente.js` (el módulo solo exporta `buscarPdfExpediente`). Para no cambiar la superficie pública de un archivo que hoy está en producción enlazando PDFs, `electron-app/test/tokenizar-fixture.test.js` la extrae del código fuente con una regex y la evalúa. Funciona, pero es más frágil que un `require`: si la función se renombra o se reescribe con otra forma, el test falla con un mensaje de "no la encontré" en vez de comparar. | F1.1 (2026-08-14) | Cuando haya otra razón para tocar `buscarPdfExpediente.js`: exportar `tokenizar` y simplificar el test a un `require`. **No vale un cambio propio** — el archivo funciona y tocarlo sin necesidad es el riesgo mayor. | 🟡 Abierto |
| **P-F1.3-a** | **Vista "Semana" del toggle no se construyó.** §5.1 mencionaba un toggle [Mes][Semana][Lista] pero sin mockup propio para Semana (a diferencia de Mes y Lista, que sí tenían diseño concreto) — se interpretó como redundante con Mes+Lista para el volumen de datos esperado (una agenda de 1 abogado, no un estudio grande) y se dejó afuera para no inflar el sub-bloque ya marcado como "el más grande del plan". | F1.3 (2026-08-14) | Si el uso real muestra que hace falta una vista semanal (mucho volumen de entradas por día que la vista Mes no puede mostrar bien con solo 4 puntos por celda): agregar un tercer botón de toggle + una grilla de 7 columnas × horas. No es un fix, es una feature nueva a demanda. | 🟡 Abierto (bajo prioridad) |
| **P-F1.7-a** | **Ambigüedad de §5.3 sobre qué hace "combinar" con las entradas, resuelta hacia el lado menos destructivo.** La tabla de modos dice que el backup "pisa" el caso coincidente *"(ficha, entradas y snapshots de ese caso)"*, lo que se puede leer como "borrar las entradas actuales del caso y reemplazarlas por las del backup". Pero el texto del propio modal, en esa misma sección, dice *"se conserva lo que está en tu Bitácora y no en el backup"*. **Implementado así: combinar NUNCA borra entradas** — actualiza las que coinciden por id y crea las que faltan; una entrada agregada después del backup, aunque sea de un caso pisado, sobrevive. Ante una ambigüedad en la única operación destructiva del módulo, se eligió la lectura que no destruye. El usuario que quiere el estado exacto del backup tiene "Reemplazar todo". | F1.7 (2026-08-14) | Solo si el operador prefiere la otra lectura: sería un `DELETE` de las entradas del caso pisado dentro de la misma transacción. **No cambiar sin decisión explícita** — hoy el comportamiento coincide con lo que el modal le promete al usuario. | 🟢 Cerrado por decisión |
| **P-F1.7-b** | **El bloque de historial del import no se puede ejercitar de punta a punta todavía.** La restauración de `expediente_snapshots` está implementada completa (respeta el tope 2+2 y remapea el `expediente_id`), pero **nada escribe snapshots en producción** hasta la Fase 2, así que en la práctica hoy siempre restaura un array vacío. En staging se probó con filas insertadas a mano. | F1.7 (2026-08-14) | ✅ **Cerrado en F3.0 (2026-08-15, caso B6.5).** Con snapshots reales generados por B4.4, se borró un caso completo (ficha + entrada + 2 snapshots) y se restauró en modo `combinar` — volvieron los 3, correctamente re-vinculados (verificado por SQL, 0 huérfanos). | 🟢 Cerrado |
| **P-F3.0-a** | **3 bugs reales de timezone en fechas `DATE` puras** (`feriados.fecha`, `expedientes_seguidos.situacion_fecha`, `expediente_snapshots.run_date`) — se mostraban/calculaban un día antes en Argentina (UTC-3) porque `bitLocalYmd()`/`formatDate()` leen esas fechas en hora LOCAL, pero el backend las serializa como medianoche UTC. El caso más serio: la calculadora de plazos **nunca excluía un feriado real** del cómputo. | F3.0 (2026-08-15) | ✅ **Corregido y desplegado en la misma sesión** (`bitUtcYmd()`/`bitFormatUtcDate()`, commit `a95d0c8`). Verificado en vivo antes/después contra producción, en los 3 puntos. | 🟢 Cerrado |
| **P-F3.0-b** | **El contador `snapshotsCreados` del resumen de `POST .../bitacora/import` no distingue "creado" de "ya existía/actualizado"** — al reimportar el mismo backup dos veces, muestra `4` las dos veces, aunque la segunda vez no crea nada realmente (verificado por SQL: la cuenta real de filas no cambia, sin duplicar). Es puramente cosmético — no afecta integridad de datos ni el `dry_run` (que sí calcula bien el preview). | F3.0 (2026-08-15, caso B6.6) | Corregir el contador para distinguir `snapshotsCreados` de `snapshotsActualizados`, igual que ya hacen `expedientesCreados`/`entradasCreadas`. Deliberadamente **no corregido** en la misma sesión que se ejercitó por primera vez el camino destructivo de F1.7 — merece su propia revisión con cuidado, no un cambio apurado al cierre de una sesión larga. | 🟡 Abierto (bajo, cosmético) |
| **P-F2.2-a** | **⚠️ El `rawBody` que captura el hook `verify` de `express.json` NO lo lee nadie.** Descubierto al preparar la verificación de P2: el comentario de `routes/webhooks.js` dice *"aquí recalculamos la firma sobre el contenido raw… se requiere que server.js pase rawBody"*, pero `verifyMPSignature()` **no usa `req.rawBody`** — arma el manifest con `req.body?.data?.id` + los headers `x-request-id`/`ts`. Un `grep` confirma que `req.rawBody` no se lee en ningún lado del repo. **Consecuencia práctica:** el acoplamiento real del cobro es a `req.body` (el body YA PARSEADO), no al raw. La regla de P2 ("no meter parsers antes del `express.json` con `verify`") sigue siendo correcta como defensa, pero el riesgo concreto que enunciaba estaba mal caracterizado — y eso **cambió cómo se verificó**: el check del smoke oficial (una petición SIN firma → 401) habría pasado igual con el body roto, así que se agregó la prueba **positiva** (firma válida → aceptada), corrida en staging y repetida en prod. | F2.2 (2026-08-15) | **Sin acción — deliberadamente no se tocó.** Modificar código de validación de firma de webhooks de cobro para "limpiar" un hook sin uso es alto riesgo y cero beneficio funcional. Si algún día MP exige firmar sobre el cuerpo crudo, el hook ya está puesto. Lo que sí conviene: corregir el comentario engañoso de `webhooks.js` la próxima vez que se toque ese archivo por otra razón. | 🟡 Abierto (informativo) |
| **P-F2.2-b** | **Un body que excede el límite del parser devuelve 500, no 413.** El `PayloadTooLargeError` de body-parser cae al handler de errores genérico de `server.js` ("Error no manejado") en vez de traducirse a un 413 con motivo. **Verificado que es PREEXISTENTE, no introducido por F2.2:** el mismo request de 200 KB contra **producción sin F2.2 desplegado** devolvió idéntico 500. Es la misma familia del hallazgo RI-1 (un rechazo de multer caía como 500 genérico en vez de 400 con motivo, corregido en su momento con un wrapper). | F2.2 (2026-08-15) | Cuando se quiera: un handler que traduzca `err.type === 'entity.too.large'` a 413 con mensaje accionable. **No se hizo acá a propósito** — tocar el manejo global de errores en la misma sesión que el parser adyacente al cobro haría ambiguo un eventual rollback. | 🟡 Abierto (bajo) |
| **P-F2.1-a** | **Contrato del formulario POST hacia `/usuarios/capture` es una PROPUESTA de F2.1, no algo que F2.2 ya haya confirmado** (F2.2 todavía no existe). Campos usados: `goto`, `origen` ('procuracion'\|'informe'), `accion` ('ficha'\|'snapshot'\|'entrada'\|'ficha-lote'\|'snapshot-lote'\|'entrada-lote'), `tipo` (solo si `accion` incluye 'entrada': 'vencimiento'\|'audiencia'\|'tarea'\|'nota'), individual: `exp,jur,dep,car,sit,fproc,movs` (JSON), lote: `lote` (JSON de array de esos mismos campos por caso). Quien implemente F2.2 puede ajustar nombres/forma si conviene — esto es el contrato que F2.1 asumió para poder construir la botonera sin esperar a que F2.2 exista. | F2.1 (2026-08-15) | Al implementar F2.2: mantener este contrato (recomendado, cero retrabajo en los 4 visores) o, si se decide otro, actualizar `enviarCaptura()`/`campoDeCaso()` en `visorModal_template.html` y `visor_informes_template.html` (2 lugares, sin lógica compartida entre ambos archivos por diseño — son visores estáticos independientes). | 🟡 Abierto |
| **P-F2.1-b** | **El badge "📁 ya seguido" usa una clave cosmética, no la autoritativa.** `expedienteKey()` (backend, decisión D1) es la normalización real que dedupe fichas; duplicarla dentro del JS estático de un visor sería una 3ª copia de esa lógica (ya hay 2: backend y `buscarPdfExpediente.js` de Electron, con un fixture compartido para no divergir — F1.1). En su lugar, el visor usa `claveLigera()`, una aproximación (lowercase + solo alfanuméricos) **solo para decidir si mostrar 📁 en vez de 📔+** — nunca para deduplicar de verdad, eso lo sigue haciendo el backend en el POST real (`ON CONFLICT (user_id, expediente_key)`, ya construido en F1.2). Peor caso de un falso negativo/positivo acá: aparece `📔+` en un caso ya seguido, el upsert del backend lo resuelve sin duplicar (aceptado en el diseño original, §4.2c). | F2.1 (2026-08-15) | Sin acción necesaria — es una limitación aceptada por diseño, no un bug. Si en el futuro se quiere que el badge sea exacto, requeriría que `GET /client/bitacora/seguidos` (F2.4) devuelva ya la clave canónica y no haga falta ninguna normalización del lado del visor (comparación directa por string). | 🟢 Cerrado por decisión |
| **P-F1.3-b** | **Sin búsqueda de texto server-side.** El filtro de búsqueda (`#bitacora-search`) y el filtro de estado "Hechos" se resuelven client-side sobre el listado ya traído (`bitacoraApplyClientFilters`), porque `GET /usuarios/api/bitacora` (F1.2) no expone un parámetro `q=` ni `pendientes=0`. Funciona bien para el volumen esperado (rango de la vista Mes = 42 días, vista Lista = 240 días, LIMITE_LISTADO=500 filas), pero no escalaría si un usuario acumulara miles de entradas en un rango. | F1.3 (2026-08-14) | Si hace falta: agregar `q`/`hecho` a los filtros de `routes/bitacora.js` (F1.2) y quitar el filtrado client-side. No urgente — el límite del servidor (500 filas) ya protege contra una respuesta desmedida. | 🟡 Abierto (bajo prioridad) |

---

## 12. Riesgos y decisiones de diseño

| # | Riesgo / decisión abierta | Mitigación / a decidir |
|---|---|---|
| 1 | Alcance del calendario puede inflar la fase 1 (drag&drop, vista horaria) | v1: vista mes + lista, entradas all-day por defecto, repetición simple. Sin drag&drop. |
| 2 | Deep-link sin sesión (visor reabierto días después) → pasa por login | Aceptable; el flujo principal (visor auto-abierto) lleva SSO. Los parámetros del deep-link sobreviven al ciclo de login (patrón `pending_goto` ya existente en el portal). |
| 3 | Datos del caso viajan por POST desde un HTML `file://` | Solo datos que ya son del usuario, por HTTPS hacia nuestro propio dominio (`target` fijo, sin CORS por ser navegación, no fetch). Sin credenciales ni tokens en el payload. Sin límite de tamaño artificial (§4.1) |
| 4 | Duplicados por variaciones del número de expediente (espacios, formato) | ⚠️ **Corregido (revisión de pre-implementación, 2026-08-12, hallazgo N1).** "Normalizar uppercase + colapsar espacios" **no alcanza**: no contempla que el PJN devuelve el número con ceros a la izquierda (`FCR 018745/2017`) mientras el usuario lo tipea sin ellos (`FCR 18745/2017`) — el mismo bug que ya rompió el enlace de PDFs en julio (commit `debb503`). **Solución confirmada:** columna `expediente_key` con el número normalizado reusando `tokenizar()` de `electron-app/informe/buscarPdfExpediente.js` (código ya probado), `UNIQUE` sobre esa columna. Ver el modelo actualizado en §7 y el detalle en `docs/internal/bitacora-decisiones-pendientes-2026-08-12.md` (D1). |
| 5 | Feriados/inhábiles varían por jurisdicción | v1: feriados nacionales + ferias, editables por admin; disclaimer "verificá el plazo" junto a la calculadora. Jurisdicciones por usuario: futuro. |
| 6 | ¿Ítem de Bitácora visible con candado u oculto en planes sin la feature? | ✅ **Confirmado (2026-08-12): visible con candado** — ver Q3/§13. |
| 7 | ¿Bitácora en el trial? | ✅ **Confirmado (2026-08-12): sí** — ver Q2/§13. |
| 8 | ¿Qué plan la incluye? (¿COMBO sí, EXTENSION no? ¿solo planes futuros PRO+?) | ✅ **Confirmado (2026-08-12): COMBO sí, EXTENSION no** — ver Q1/§13. |
| 9 | Multi-miembro (estudios con varios usuarios) | Fuera de alcance (el modelo actual es 1 cuenta = 1 abogado); el esquema no lo bloquea (un futuro `responsable` es una columna más). |
| 10 | Restauración destructiva (usuario elige "Reemplazar todo" sin entender el alcance) | Vista previa dry-run obligatoria con números concretos + respaldo automático del estado actual descargado antes de aplicar → toda importación es reversible. |
| 11 | Backup JSON editado a mano, corrupto o de otra cuenta | Validación de `backup_version` + estructura + pertenencia al subir; rechazo con mensaje claro antes de la vista previa. Importación transaccional (todo o nada). |

### Descartado en esta versión (registrado para el futuro)
- **Integración con Google** (Calendar/Tasks API u OAuth): descartada por ahora — fricción de permisos y verificación de app desproporcionadas para el beneficio. Si a futuro se pide "verlo en el calendario del teléfono", el primer paso sería un feed .ics de solo lectura (sin OAuth), no la API.
- **Emails de recordatorio**: descartados — el aviso vive en el banner de la Bitácora al ingresar.
- **Historial completo de corridas en la nube**: descartado — reemplazado por el snapshot acotado 2+2 por caso, que da el valor de consulta sin acumular datos.

---

## 13. Preguntas abiertas — para responder antes o durante la implementación

> ✅ **Las 12 CONFIRMADAS (2026-08-12).** Detalle completo, con justificación de cada una y el orden
> en que hay que tenerlas en cuenta durante la implementación, en
> `docs/internal/bitacora-decisiones-pendientes-2026-08-12.md`. Todas se resolvieron aceptando el
> default sugerido, sin cambios.

| # | Pregunta | Default sugerido | Respuesta |
|---|---|---|---|
| Q1 | ¿Qué planes incluyen la Bitácora? (¿COMBO sí / EXTENSION no? ¿Solo los futuros PRO+?) | COMBO la incluye; EXTENSION no | ✅ **COMBO sí, EXTENSION no.** |
| Q2 | ¿Se habilita durante el trial (20 usos)? | Sí — es el gancho de conversión más visual | ✅ **Sí.** |
| Q3 | En planes sin Bitácora: ¿ítem visible con candado (upsell) u oculto? | Visible con candado | ✅ **Visible con candado.** |
| Q4 | ¿El visor del monitor también captura? | No en v1; evaluar en Fase 3 con datos de uso | ✅ **No en v1** — se evalúa en Fase 3. |
| Q5 | ¿Tope de casos seguidos por usuario o por plan (ej. 200)? ¿O sin tope? | Sin tope en v1 (el costo por caso es ínfimo); revisar si aparece abuso | ✅ **Sin tope.** |
| Q6 | Al bajar a un plan sin Bitácora, ¿cuánto tiempo queda disponible la exportación? | 90 días (coherente con la retención de CUIT) | ✅ **90 días.** Requiere columna `users.bitacora_lost_access_at` + carve-out en el gate — ver §8. |
| Q7 | ¿El mini-visor del informe individual se abre siempre, o se respeta la config "abrir visor automáticamente"? | Respeta la config existente | ✅ **Respeta la config existente.** |
| Q8 | ¿Distinguir "hecho procesal" vs "extraprocesal" en el check (como Lex-Doctor), o alcanza el check simple + campo carácter opcional? | Check simple + carácter opcional en Vencimiento | ✅ **Check simple + carácter opcional.** |
| Q9 | Nombres finales de las secciones: ¿"Bitácora" y "Mis expedientes" quedan? | Quedan | ✅ **Quedan.** |
| Q10 | ~~¿Subida del snapshot completo por la app (sin el recorte del querystring) como evolución?~~ | **Resuelta en v6**: el cambio a POST-formulario (§4.1) transporta el snapshot completo desde el primer momento, sin recorte ni evolución pendiente | ✅ Resuelta en v6, sin acción. |
| Q11 | Feriados: ¿los mantiene el admin desde el dashboard? ¿Se cargan ferias judiciales por jurisdicción o solo la nacional? | Admin los mantiene; v1 solo nacional + ferias de enero/julio. **Implementado como F1.8** (ABM en el dashboard admin, agregado 2026-07-25 — antes esta respuesta no tenía sub-bloque que la construyera) | ✅ Admin los mantiene (F1.8). **Alcance del seed inicial confirmado (2026-08-12): resto de 2026 + todo 2027** — ver §11, F1.1. |
| Q12 | ¿La importación/restauración entra en Fase 1 o se difiere? (§11, nota de la Fase 1) | Entra en Fase 1 (la propuesta la incluye completa) | ✅ **Entra en Fase 1.** Si hiciera falta acortar la fase, F1.7 es el único candidato razonable a diferir. |

## 14. Conclusión

El módulo convierte el resultado de cada procuración e informe en material de trabajo organizable con un clic, y le da al abogado el ritual de entrada que estos sistemas necesitan para volverse hábito: entrar → ver vencidos sin confirmar → checkear → ver la semana. El modelo de expediente seguido con historial acotado (2 procuraciones + 2 informes por caso) da la sensación de "carpeta del caso" sin el costo de un archivo histórico en la nube, y el gating por plan lo deja listo como palanca comercial desde el día uno. La fase 1 es autocontenida (backend + portal, sin release de app) y la fase 2 cierra el circuito con los cuatro visores, incluyendo el mini-visor nuevo para el informe individual que unifica la experiencia sin tocar los scripts encriptados.
