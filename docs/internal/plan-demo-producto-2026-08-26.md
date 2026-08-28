# Plan — Demo reproducible del producto para la landing (2026-08-26)

> **Pedido del operador (2026-08-26):** una presentación *que pueda reproducirse*, armada con
> capturas reales de la aplicación y de las pantallas web, **con los datos de usuarios y
> expedientes esfumados**, accesible desde la landing page, que muestre las funciones incluyendo
> **Bitácora, Markdown y la extensión de Chrome**. Referencia de encuadre: las capturas del operador.
> ⚠️ **Corrección (2026-08-27):** la ruta que citaba este pedido (`Desktop\ordenar\imagenes`) **no
> existía** — se buscó en Desktop y OneDrive completos sin resultado. El operador ubicó la carpeta real
> en `C:\Users\JONATHAN\Pictures\Screenshots\imagenes_pt` (**34 capturas**, no 36) y se revisaron una
> por una contra el guion. 🚨 **Ninguna resultó reutilizable tal cual**: tienen el CUIT real del
> operador visible en al menos 6 pantallas, su email, y carátulas con nombres de partes reales.
> Sirvieron de referencia de encuadre, **nunca como asset final**.
>
> **Lugar en el proyecto:** **Etapa 1.6** de `docs/internal/roadmap-salida-a-mercado-2026-08.md` —
> el último bloque de la etapa de producto, porque necesita que Bitácora F3.4 y el módulo Markdown
> ya existan para poder mostrarlos.
>
> **Estado:** plan **revisado el 2026-08-27** con un spike ejecutado (§0.1), que cambió la premisa
> más cara del plan original. **D1 ejecutada y revisada contra 34 capturas reales** (guion completo,
> ver [`demo-guion.md`](demo-guion.md)). **D2 EJECUTADA el mismo día** — fixtures + generador +
> capa de sustitución, los 6 visores generados con las funciones reales del producto y verificados
> con Playwright (0 errores de consola, stats correctos, "Abrir PDF" activo). Detalle completo en
> [`demo-guion.md` §11](demo-guion.md#11-d2-ejecutado-2026-08-27--fixtures--capa-de-sustitución-verificados).
> **Hallazgo real de D2, fuera del alcance previsto por el plan:** `generarVisorMonitoreo()` no era
> reusable como estaba (privada, atrapada en `main.js`, que requiere Electron) — se extrajo a
> `electron-app/monitor/generarVisorMonitoreo.js`, un cambio real de código de producto (verificado,
> sin cambio de comportamiento).
> **D3 EJECUTADA el mismo día** — 3 pipelines de captura (`backend-server/dev-tools/demo-capture/`),
> 32/36 pasos automatizables capturados con Playwright real (visores, portal, y la app Electron viva
> por CDP) y versionados en `backend-server/public/landing/demo/assets/`. Detalle completo en
> [`demo-guion.md` §12](demo-guion.md#12-d3-ejecutado-2026-08-27--3236-pasos-capturados-3-pipelines-verificados).
> **D5 EJECUTADA el mismo día, saltando D4** (el operador pidió adelantarla — D5 solo depende de D3,
> no de D4). El tour vive en `backend-server/public/landing/demo/index.html`, con los 32 pasos reales
> + 6.6-6.8 resueltos como mocks HTML/CSS en vivo (sin imagen) + placeholders explícitos para los 8
> pasos de D4. Verificado en 375/768/1280 con Playwright real. Detalle en
> [`demo-guion.md` §13](demo-guion.md#13-d5-ejecutado-2026-08-27--el-tour-publicado-en-backend-serverpubliclandingdemo).
> **D6 EJECUTADA Y DESPLEGADA el mismo día, saltando D4 también** (D6 solo depende de D5 y de la
> Etapa 1.3, no de D4). Ampliado respecto del alcance original a pedido del operador: navbar + hero +
> 6 tarjetas de `landing/index.html` (como preveía el plan) **+ un gate de sesión en `/demo/` para
> clientes ya registrados + 2 entradas nuevas en el portal** (`usuarios/index.html`, ítem de sidebar +
> ícono de topbar). Desplegado a producción con confirmación explícita del operador — backup, `scp`,
> `md5sum` y verificación en vivo contra `https://procuradortool.com/` (200 en landing/demo/assets,
> gate funcionando, 0 errores de consola). Detalle completo en
> [`demo-guion.md` §14](demo-guion.md#14-d6-implementado-2026-08-27--integración-en-landing--portal-con-gate-para-clientes).
> **D4 EJECUTADA PARCIALMENTE el mismo día (5/7 pasos): el operador aportó material real, ninguno
> se usó tal cual — los 7 archivos tenían datos reales de terceros (CUIT, nombres de deudores)
> imposibles de publicar directo.** Reconstruidos como mocks HTML/CSS con datos sintéticos (mismo
> criterio que los pasos 6.6-6.8), reusando los fixtures ya establecidos del proyecto — cero bytes
> reales en el archivo final. Resueltos: **1.1, 1.2** (El problema) y **8.1, 8.2, 8.5** (Extensión).
> **8.3 y 8.4 (autocompletado en el sitio real del PJN — Consulta SCW y Escritos) DESCARTADOS por
> decisión explícita del operador** — no quedan pendientes, la Etapa 1.6 cierra en 41/43 pasos.
> Detalle completo, incluida la corrección de qué archivo real mapea a qué paso del guion, en
> [`demo-guion.md` §15-16](demo-guion.md#15-d4-ejecutada-parcialmente-2026-08-27--57-pasos-resueltos-como-mocks-no-como-screenshots-reales).
> **✅ ETAPA 1.6 CERRADA.** Además, 4 hallazgos reales del operador tras el despliegue, los 4
> corregidos y desplegados: link "Ver demo" del portal con URL relativa rota (404), 2 aclaraciones
> de copy en el registro (extensión/Bitácora/Markdown) y una cláusula unificada de beta en los TyC —
> ver [`demo-guion.md` §17](demo-guion.md#17-4-hallazgos-reales-encontrados-en-una-revisión-del-operador-tras-el-despliegue-de-d4).
> **Un 5to hallazgo, el 2026-08-28: "Ver demo" desde el portal LOGUEADO seguía mostrando el gate de
> bloqueo**, igual que un visitante anónimo. Causa raíz: el gate leía el token del portal asumiendo
> mismo origen, y **son orígenes distintos** (`api.procuradortool.com` vs `procuradortool.com`) — era
> estructuralmente imposible de desbloquear desde un click real. Corregido con el mismo patrón `#sso=`
> que el proyecto ya usa para que Electron entre logueado al portal. Detalle en
> [`demo-guion.md` §18](demo-guion.md). ⚠️ **Ese fix arrastró una consecuencia de seguridad, detectada
> el mismo día, que NO es alcance de este plan:** el JWT del usuario pasa a persistir en el
> `localStorage` del origen de la landing, que no tiene ningún header de seguridad. Es el bloque
> **S11** de [`plan-seguridad-lanzamiento-2026-08.md`](plan-seguridad-lanzamiento-2026-08.md),
> Etapa 3 — no un pendiente de este documento.

---

## 0. Resumen ejecutivo

| | |
|---|---|
| **Formato recomendado** | **Tour guiado en HTML estático** servido desde la landing (`/demo/`), con capturas + texto + navegación por pasos, y GIF/MP4 cortos solo donde el movimiento aporte |
| **Por qué no un video** | Ver §1 — un video no se regenera, no se indexa, no se traduce, y queda obsoleto en el primer release |
| **Superficies a mostrar** | App Electron (procuración, informe, monitor) · Visores · Bitácora (app + portal) · Módulo Markdown · Extensión Chrome · Portal de usuarios |
| **Anonimización** | **Sustitución por datos sintéticos, no redacción.** Verificado que funciona *también en la app Electron* (§0.1) — no hace falta tapar nada con barras negras |
| **Automatizable hoy, sin el operador** | **Portal, dashboard, landing, visores, Y LA APP ELECTRON** — todo con Playwright. ~90% de la demo. Ver §0.1 y §4 |
| **NO automatizable** | **Solo extensión Chrome y sitio del PJN** — el operador las captura a mano (~15 min). Ver §4 |
| **Bloques** | 6 (D1–D6) |
| **Modelo / esfuerzo** | Sonnet en los 6. Ver la grilla de §3.0 |
| **Sesiones estimadas** | **4–6**, más ~15 min del operador para las capturas de extensión/PJN (ya no una sesión completa con él) |

---

## 0.1. Spike de capacidad (2026-08-27) — invalida el supuesto más caro del plan original

El plan se escribió el **2026-08-26**. Al día siguiente, las fases F0–F5 del script de prueba diaria
([`propuesta-script-prueba-diaria-2026-08-27.md`](propuesta-script-prueba-diaria-2026-08-27.md))
descubrieron un camino que este plan no contemplaba: **el `.exe` instalado acepta
`--remote-debugging-port` y Playwright se conecta por CDP**. Eso convierte a la app Electron en una
superficie web más, conducible con la misma herramienta que el portal.

La versión original de §4 afirmaba que las pantallas de la app **solo se podían capturar con el
operador presente**, porque `request_access` de computer-use devuelve `notInstalled`. **Eso ya no es
cierto — y no por un cambio de prioridad, sino porque apareció un mecanismo mejor.**

**Verificado empíricamente el 2026-08-27, sin consumir cupo** (solo lanzar, loguear y capturar —
ningún flujo real contra el PJN, mismo criterio que el spike F0):

| # | Pregunta | Resultado |
|---|---|---|
| 1 | ¿`page.screenshot()` funciona sobre la app vía CDP? | ✅ **Sí** — PNG real de 43–65 KB, nítido, con contenido completo |
| 2 | ¿Se puede fijar el viewport para capturas reproducibles? | ✅ **Sí** — `set_viewport_size({1280, 800})` respetado |
| 3 | ¿Se puede manipular el DOM antes de capturar? | ✅ **Sí** — `evaluate()` funciona igual que en un navegador |
| 4 | ¿Se puede **sustituir datos sensibles** antes de capturar? | ✅ **Sí** — email real e **ID del dispositivo** reemplazados por sintéticos; captura publicable, sin blur ni barras |
| 5 | ¿Se llega a la ventana principal automáticamente? | ✅ **Sí** — login resuelto, ventana principal a los ~4 s |
| 6 | ¿Se pueden abrir los modales por código? | ✅ **Sí** — 9 modales detectados por id (`modalConfig`, `modalStats`, `modalAsistente`, `modalCustomDate`, `modalProcurarCustom`, `modalNotificaciones`, `modalCuenta`, `modalInforme`, `modalMonitor`), abribles con `classList.remove('hidden')` |
| 7 | ¿Captura a nivel de elemento (recortes limpios)? | ✅ **Sí** — `locator.screenshot()` disponible |

**Consecuencia para el plan:** el bloque de captura deja de ser *"alto esfuerzo + requiere una sesión
con el operador"* y pasa a ser **un solo script de Playwright que cubre app + web + visores**. La
propiedad que el plan declaraba más valiosa —que la demo se **regenere** en vez de pudrirse— pasa de
cubrir ~60% de las pantallas a cubrir **~90%**.

**Lo que el spike NO cambia (sigue igual):** la extensión Chrome y el sitio del PJN. Ahí los motivos
son duros y no dependen de computer-use: `list_connected_browsers` devuelve `[]`, y los navegadores
se otorgan en tier *"read"*. Ver §4.

### Dos hallazgos secundarios, ambos accionables

1. **🚨 El botón de Markdown NO aparece en la app instalada.** La captura de la ventana principal
   muestra el topbar con `Procurar · Informe · Monitor · Descargas · Bitácora` — **sin Markdown**.
   No es un bug: **M2–M5 están commiteados sin release** (ver el encabezado de estado de
   `CLAUDE.md`), así que el binario instalado (v2.7.50) no tiene el módulo. **D3 no puede capturar
   el capítulo de Markdown hasta que se corte el release de Electron** — es una dependencia dura,
   no un detalle. Y además la cuenta de demo necesitará `markdown_enabled=true`.
2. **Lección de método, aprendida rompiéndolo:** el primer intento del spike falló porque **sustituí
   el email *antes* de clickear "Iniciar Sesión"** — la app intentó loguearse con una cuenta
   inexistente y no abrió la ventana principal. No era un límite del mecanismo, era mi propia
   instrumentación. **Regla para D3: la sustitución de datos va SIEMPRE después de llegar a la
   pantalla y justo antes del `screenshot()`, nunca antes de una acción que dependa del valor real.**

---

## 1. Decisión de formato: tour HTML, no video

El pedido dice *"que pueda reproducirse"*, y esa palabra es un requisito técnico, no una comodidad.
La razón es concreta y verificable en el propio historial del proyecto: **entre el 2026-08-15 y el
2026-08-26 se publicaron 3 releases de Electron que cambiaron la UI de los visores y del topbar**
(v2.7.48, v2.7.49, v2.7.50 — este último rediseñó los visores enteros). Cualquier set de capturas
tomado en agosto habría quedado desactualizado tres veces en once días.

Y hay más cambio de UI garantizado por delante: las Etapas 2 y 3 del roadmap (code-review y
seguridad) van a producir fixes visuales **después** de que la demo esté armada.

| | Tour HTML estático | Video / screencast |
|---|---|---|
| Regenerar tras un release | ✅ correr el pipeline de nuevo | ❌ volver a grabar y editar |
| Costo de hosting | ✅ cero — Nginx ya sirve la landing estática | ⚠️ peso, o embeber YouTube (dependencia externa) |
| SEO / indexable | ✅ texto real | ❌ |
| Funciona sin sonido, en el celular, en 20 segundos | ✅ | ⚠️ |
| Muestra movimiento (un flujo corriendo) | ⚠️ solo con GIF/MP4 embebido | ✅ |

**Recomendación: tour HTML como base + 3 o 4 clips cortos** (procuración corriendo, captura desde
el visor a Bitácora, la extensión completando un expediente) embebidos como `<video>` mudo con
autoplay-loop, que es donde el movimiento realmente comunica algo. Lo demás, capturas.

---

## 2. El problema de los datos sensibles, y la forma barata de resolverlo

Las capturas de referencia muestran exactamente lo que **no** puede publicarse. Muestreadas:

| Captura | Qué expone |
|---|---|
| Login de la app | Email real del operador, **ID del dispositivo** (hardware binding) |
| Visor de novedades + modal de detalle | **`AFIP C/ QUISPE EDUARDO CARLOS S/EJECUCION FISCAL`**, números de cédula, juzgado, fechas — datos de un tercero real en un proceso real |
| Monitor de Partes | Nombres de partes monitoreadas (`DON COCHO`, `LA TOSTADORA MODERNA`) |
| Sitio del PJN (SCW) | **CUIT del operador** en la barra superior, número de expediente, carátula completa, dependencia |
| Login SSO del PJN | Campo de contraseña del PJN + la URL de autenticación |

**La estrategia correcta no es esfumar: es no capturar el dato.**

### Estrategia A — datos sintéticos antes de capturar ✅ *preferida*

Es la que resuelve el problema de raíz, y **el proyecto ya tiene la mitad construida**:

- **Portal de usuarios y dashboard admin:** los stubs de V0 (`backend-server/dev-tools/stub-portal.js`
  y `stub-dashboard.js`) sirven **los archivos reales** de `public/usuarios/` y `public/dashboard/`
  contra una API falsa con una cuenta ficticia. **No hay ni un dato real que esfumar** — la captura
  sale limpia por construcción. Ese es probablemente el mayor ahorro de todo este plan.
- **Visores (procuración / informe / monitor):** se generan a partir de un objeto de datos
  (`DATOS_BATCH` / `datosEmbebidos`). Alcanza con **generarlos desde un fixture sintético** —
  expedientes inventados, carátulas del tipo `GONZÁLEZ MARÍA C/ ASEGURADORA DEMO S.A. S/DAÑOS`.
  Se rendrean idénticos a los reales.
- **App Electron:** una cuenta de demo dedicada, con partes de monitoreo inventadas y la carpeta
  de descargas sembrada con los archivos sintéticos de arriba.

Con esto queda cubierto todo salvo lo que ocurre **dentro del sitio del PJN**, que no controlamos.

### Estrategia B — redacción irreversible ⚠️ *solo para lo que no admite A*

Para el sitio del PJN y la extensión, donde el contenido lo pone un tercero:

> 🚨 **Nunca usar desenfoque gaussiano sobre texto.** Un blur suave sobre texto de tamaño conocido
> es parcialmente reversible y hay herramientas públicas que lo hacen. Lo mismo vale para el
> pixelado con bloque chico y para bajar la opacidad.
>
> **Lo aceptable:** **rectángulo opaco sólido** (color plano, sin transparencia) o **mosaico con
> bloque grande** (≥ 1/6 de la altura del texto). Y siempre aplicado **sobre el archivo final
> rasterizado**, no como una capa CSS ni un `<div>` encima — un overlay en HTML se quita con el
> inspector en dos clics.

**Mejor todavía para el sitio del PJN:** en vez de tapar, **sustituir**. Un rectángulo del color de
fondo con texto sintético encima (`FCR 12345/2020`, `DEMO S.A. C/ EJEMPLO S/PROCESO`) queda mucho
mejor como material comercial que una barra negra, que transmite "acá hay algo que ocultar".

---

## 3. Bloques

### 3.0. Grilla de fases — modelo, esfuerzo y dependencias

| # | Fase | Modelo | Esfuerzo | Sesiones | Superficie | Depende de | ¿Vale sola? |
|---|---|---|---|---|---|---|---|
| **D1** | Guion y selección de flujos | Sonnet | **medio** | ~1 | `docs/internal/` | — | ✅ sí — ordena el pedido aunque no se capture nada |
| **D2** | Fixtures sintéticos + capa de sustitución | Sonnet | **medio-alto** | ~1 | `dev-tools/demo-fixtures/` | D1 | parcial |
| **D3** | Pipeline de captura automatizado | Sonnet | **alto** | ~1,5 | script + `assets/` | D2 · **release de Electron** (ver §0.1) | ✅ sí — el activo reutilizable |
| **D4** | Capturas manuales (extensión + PJN) | Sonnet | **bajo** | ~0,5 | `assets/` | D1 · **~15 min del operador** | ✅ cerrado (5/7, 8.3/8.4 descartados) |
| **D5** | Construcción del tour | Sonnet | **medio** | ~1 | `landing/demo/` | D3 (D4 puede llegar después) | ✅ sí |
| **D6** | Integración en la landing + despliegue | Sonnet | **bajo** | ~0,5 | `landing/` | D5 · Etapa **1.3** | ✅ sí |
| | **Total** | | | **~5,5** | | | |

**Sin Opus en ninguna fase.** No toca cobranza, criptografía, ni código de producto: produce
material estático a partir de superficies que ya existen. El único tramo con esfuerzo `alto` es
**D3**, y es por **volumen** (~40 pantallas, 3 pipelines), no por dificultad conceptual.

**Cambios respecto de la versión del 2026-08-26** (a raíz del spike de §0.1):
- El bloque de captura se **partió en dos** (D3 automatizado / D4 manual) porque ahora son trabajos
  de naturaleza distinta: uno es un script reproducible, el otro es una pasada corta del operador.
- **D3 dejó de necesitar una sesión con el operador presente.** Antes era el motivo principal por el
  que este plan aparecía en la lista de "4 trabajos que necesitan al operador" del roadmap §9.
- **D4 bajó de `alto` a `bajo`**: solo extensión + PJN, y el operador aporta ~15 min, no una sesión.
- Apareció una **dependencia dura nueva**: D3 no puede capturar Markdown hasta el release de Electron.

> ⚠️ **Orden recomendado y por qué.** D1 → D2 → D3 es secuencial de verdad (no se captura sin
> fixtures, no hay fixtures sin guion). **D4 se puede lanzar en paralelo apenas D1 esté listo** — el
> operador necesita el guion para saber qué sacar, pero no depende de D2/D3. **D5 puede arrancar con
> las capturas de D3 y sumar las de D4 después**, así que un retraso del operador no bloquea el tour.

---

### D1 — Guion y selección de flujos ✅ EJECUTADO (2026-08-27)

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** |
| **Entregable** | [`demo-guion.md`](demo-guion.md) — 8 capítulos, 43 pasos (36 automatizables en D3, 7 manuales de D4), tabla de dependencias D3/D4 al cierre |

> ✅ **La carpeta de referencia apareció** en `Pictures\Screenshots\imagenes_pt` (34 capturas del
> 2026-08-25, no en `Desktop\ordenar\imagenes` como decía este plan) y **ya se revisó completa**
> contra el guion. Confirmó la estructura punto por punto y agregó hallazgos reales: 2 pasos nuevos
> en el capítulo Monitor (pestaña "Expedientes" con selección masiva, `📌 Guardar casos`), la
> composición exacta del capítulo Extensión (menú contextual "Enviar expediente a PJN" sobre el
> texto seleccionado), el set exacto de 5 botones del puente Procuración→Bitácora, y confirmó con
> evidencia directa por qué excluir la pantalla de login SSO del PJN (CUIT real precargado, visible
> en 2 capturas distintas). También reveló material real de onboarding (4-5 pantallas) no
> contemplado en el guion original — decisión de dejarlo fuera del tour principal, ver §0.5 del
> guion. Ninguna de las 34 capturas es reutilizable tal cual (todas con datos reales sensibles).

Un guion, no una galería. La demo tiene que contar el recorrido de un usuario, no enumerar
pantallas. Estructura propuesta (6 capítulos, ~20 pasos):

1. **El problema** — 1 pantalla del SCW real (redactada) mostrando el trabajo manual.
2. **Procuración** — cargar expedientes → correr → el visor con las novedades.
3. **Informe** — individual y por lote → el PDF.
4. **Monitor de partes** — alta de una parte, consulta inicial, novedades detectadas.
5. **Bitácora** — captura desde el visor con un clic → la ficha del caso → la agenda con
   vencimientos → (F3.4) la vista Semana y el export `.ics`.
6. **Markdown / anonimización** — informe → `.md` completo → `.md` anonimizado + mapping editable.
   **⚠️ Nota agregada 2026-08-26, a pedido del operador:** este capítulo no puede quedarse en
   "mostrar que se generan los 2 archivos" — tiene que explicar **para qué sirve el `.md`
   anonimizado**, que es lo que un usuario nuevo no adivina solo mirando el modal: pasos extra
   sugeridos — (a) abrir el `.md` anonimizado, (b) copiarlo o arrastrarlo al chat de la IA que el
   usuario ya usa (ChatGPT, Claude, Gemini), (c) un pantallazo o mock de esa IA respondiendo sobre
   el contenido del expediente **sin nombres de partes visibles**, para que quede claro en la propia
   demo qué problema resuelve el módulo (compartir un expediente para razonar sobre él sin exponer
   datos). Coordinar el texto exacto con el copy de `electron-app/onboarding/tour.js` paso 2/14
   (ver `plan-modulo-markdown-anonimizacion-2026-08-26.md`, sección M5) — misma promesa, dicha una
   vez en el producto y otra vez en la landing, sin contradecirse.
7. **Extensión Chrome** — el data-entry automático en los 5 flujos del PJN.

**Decisión que hay que tomar acá:** ¿la demo es **una sola pieza larga** o **una por módulo**?
Recomiendo **por módulo, con un índice** — así la landing puede linkear "ver Bitácora en acción"
desde la tarjeta de Bitácora, y cada módulo se regenera solo cuando cambia.

---

### D2 — Fixtures sintéticos + capa de sustitución ✅ EJECUTADA (2026-08-27)

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio-alto** |
| **Depende de** | D1 |
| **Entregable** | `backend-server/dev-tools/demo-fixtures/` (datos + generador) + `demo-anonimizar.js` (la capa de sustitución por DOM), los 2 ejecutados y verificados con Playwright — detalle completo en [`demo-guion.md` §11](demo-guion.md#11-d2-ejecutado-2026-08-27--fixtures--capa-de-sustitución-verificados) |

**Parte A — fixtures de datos** (como en la versión original):
- Un set coherente: los mismos 4–5 expedientes ficticios atraviesan toda la demo (procuración →
  informe → bitácora → markdown). La coherencia es lo que hace que se vea real.
- Carátulas con la forma real del PJN pero con partes obviamente ficticias.
- **Extensión de los stubs de V0** para que sirvan estos fixtures (hoy sirven un set mínimo para
  que la SPA arranque; acá hacen falta datos que se vean bien en una captura).
- Un generador que produzca los visores desde el fixture, reusando `generarVisorHTML()` /
  `generarVisorMonitoreo()` reales — no una maqueta.

**Parte B — capa de sustitución por DOM** (nueva, habilitada por el spike de §0.1):

Un módulo con **un mapa de sustituciones declarativo** (`dato real → dato sintético`) que se inyecta
con `page.evaluate()` inmediatamente antes de cada `screenshot()`. Ya está **probado que funciona en
la app Electron**, no solo en el navegador.

Lo que el spike identificó como sustituible en la app, mirando las capturas reales:

| Pantalla | Dato a sustituir | Verificado |
|---|---|---|
| Login | email real del operador | ✅ probado |
| Login | **ID del dispositivo** (hardware binding) | ✅ probado |
| Ventana principal | chip de usuario (`procuradortool` / `COMBO_PROMO`) | pendiente, mismo mecanismo |
| Ventana principal | banner de cupo (`116/128 (incluye +90 de cortesía)`) | pendiente, mismo mecanismo |
| Ventana principal | badge de pendientes de Bitácora | decidir en D1 si se muestra o se normaliza |

🚨 **Regla de oro del bloque, aprendida rompiéndola en el spike:** la sustitución se aplica **después
de llegar a la pantalla y justo antes de capturar** — nunca antes de una acción que dependa del
valor real. Sustituir el email antes del login hizo que la app intentara autenticarse con una cuenta
inexistente. Ver §0.1, hallazgo 2.

---

### D3 — Pipeline de captura automatizado ✅ EJECUTADA (2026-08-27, 32/36) *sin el operador*

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **alto** (volumen: ~40 pantallas en 3 pipelines) |
| **Depende de** | D2 · Etapa **1.1** ✅ (ya cerrada) · Etapa **1.2** ⏳ **y su release de Electron** (ver §0.1) |
| **Entregable** | `backend-server/public/landing/demo/assets/` + **el script que las regenera** |

**Un solo mecanismo — Playwright — para las 3 superficies.** Ésa es la simplificación que trajo el
spike: antes eran dos herramientas distintas (Playwright para web, computer-use para la app), con
dos conjuntos de convenciones y una de ellas bloqueada.

| Superficie | Cómo | Datos | Automatizable |
|---|---|---|---|
| Portal de usuarios, dashboard, landing | Playwright contra los **stubs de V0** | sintéticos por construcción | ✅ **totalmente** |
| Visores (procuración / informe / monitor) | Playwright sobre el HTML generado del fixture | sintéticos | ✅ **totalmente** |
| **App Electron** (ventanas, modales, consola, tour) | **Playwright vía CDP** — `electron_driver.launch_and_connect()` de `tests/daily/` | cuenta demo + sustitución de D2 | ✅ **totalmente** *(cambio del 2026-08-27)* |
| Extensión Chrome + sitio del PJN | — | — | ❌ **es D4** |

**Reusa `tests/daily/electron_driver.py`, no lo reimplementa.** Ese módulo ya resuelve el guard de
instancia única, el lanzamiento del `.exe` con `--remote-debugging-port`, la espera de CDP y el
login — todo verificado en la corrida real 6/6 de F2. La demo solo necesita agregarle
`screenshot()`. **Duplicar esa lógica sería el mismo error que el proyecto ya documentó dos veces**
(la búsqueda de PDF duplicada en `generador_visor.js`/`generador_excel.js`, y `VERIF_FLUJOS_ORDEN`
duplicado entre backend y dashboard — los dos produjeron bugs reales).

**Los modales son la mitad de la demo, y se abren por código.** El spike detectó **9 modales por id**
(`modalConfig`, `modalStats`, `modalAsistente`, `modalCustomDate`, `modalProcurarCustom`,
`modalNotificaciones`, `modalCuenta`, `modalInforme`, `modalMonitor`), todos abribles con
`classList.remove('hidden')` — sin clicks, sin timing frágil, sin diálogos nativos de por medio.

**Requisito de reproducibilidad (no negociable):** viewport fijo (1280×800 verificado), sin
dependencias del entorno, y **una sola invocación regenera todo**. Ese script es el entregable más
valioso del bloque — es lo que hace que la demo no se pudra en el próximo release.

**Higiene, con antecedente:** las capturas de Playwright **no se dejan sueltas en el repo**. Es una
de las 5 trampas documentadas en `.claude/skills/verify/SKILL.md`. Salida a una carpeta dedicada y
versionada a propósito, y limpieza de `.playwright-mcp/` al cerrar.

---

### D4 — Capturas manuales: extensión Chrome + sitio del PJN 🟠 *~15 min del operador*

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **bajo** (el trabajo de captura es del operador; acá se procesa) |
| **Depende de** | D1 (el operador necesita el guion para saber qué sacar) |
| **Entregable** | Las capturas del operador, ya redactadas por sustitución, en `assets/` |

**Es lo único que el spike NO destrabó**, y por motivos que no dependen de computer-use — ver §4.

- El operador saca las capturas siguiendo la lista del guion de D1 (popup de la extensión,
  autocompletado en Escritos/Notificaciones/DEOX, SCW).
- Este bloque hace la **redacción por sustitución** (§2, estrategia B) sobre esos archivos:
  rectángulo del color de fondo + texto sintético encima, **nunca blur**.
- Queda documentado en el guion **cuáles capturas son manuales**, para que quien regenere la demo
  dentro de seis meses sepa exactamente cuáles tiene que volver a pedir.

**Se puede lanzar en paralelo con D2/D3** — no depende de los fixtures.

---

### D5 — Construcción del tour ✅ EJECUTADA (2026-08-27)

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** |
| **Depende de** | D3 (puede arrancar sin D4 y sumar esas capturas después) |
| **Entregable** | `backend-server/public/landing/demo/index.html` (+ CSS/JS propios) — hecho, verificado con Playwright en 375/768/1280 — [`demo-guion.md` §13](demo-guion.md#13-d5-ejecutado-2026-08-27--el-tour-publicado-en-backend-serverpubliclandingdemo) |

- HTML estático, **sistema de diseño de la landing** (ámbar `#d97706`, Inter, Crimson Pro).
- Navegación por pasos con teclado y con botones; deep-link por capítulo (`/demo/#bitacora`) para
  poder linkear desde cada tarjeta de la landing.
- Responsive real (375 / 768 / 1280) — la landing ya se verifica en esos tres anchos.
- **Sin dependencias externas**: nada de CDN. La landing la sirve Nginx como estático y así debe
  seguir.
- Enlaces a la acción: cada capítulo termina con "Probalo" → registro.

---

### D6 — Integración en la landing + despliegue ✅ EJECUTADA Y DESPLEGADA (2026-08-27)

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** (subió de "bajo" — el operador amplió el alcance a 3 superficies: landing + `/demo/` + portal, ver `demo-guion.md` §14) |
| **Depende de** | D5, y de la **Etapa 1.3** ✅ (ya cerrada el 2026-08-26 — sin conflicto de archivo) |

- Entrada en el navbar ("Ver demo") + botón en el hero + link desde cada tarjeta de "Funciones" al
  capítulo correspondiente.
- Despliegue: `scp` a `/var/www/procurador/backend-server/public/landing/demo/` — **sin
  `pm2 restart`**, la landing es estática vía Nginx.
- Verificación en vivo con `curl` + una pasada de navegador, igual que cualquier cambio de landing.

---

## 4. Qué se puede capturar automáticamente y qué no — respuesta directa

El operador preguntó explícitamente cuáles no se pueden obtener automáticamente. **Actualizado el
2026-08-27 con el spike de §0.1**, que cambió la respuesta para la superficie más grande.

### ✅ Sí, sin el operador y sin anonimización manual

**Portal de usuarios, dashboard admin, landing, los 4 visores, Y LA APP ELECTRON COMPLETA** (login,
ventana principal, los 9 modales, consola, Mi Cuenta, tour).

- Web y visores: Playwright contra los stubs de V0 / HTML de fixtures — datos falsos por
  construcción.
- **App Electron: Playwright vía CDP**, reusando `tests/daily/electron_driver.py`. Los datos reales
  que sí aparecen (email, ID de dispositivo, cupo, chip de usuario) se **sustituyen por sintéticos
  con `evaluate()` antes de capturar** — verificado funcionando, resultado publicable sin blur.

> **Corrección respecto de la versión del 2026-08-26.** Esta sección afirmaba que la app Electron
> requería al operador presente, porque `request_access` de computer-use devuelve `notInstalled` por
> el aislamiento de sesiones de Windows. **Ese diagnóstico sigue siendo correcto sobre computer-use
> — lo que cambió es que ya no hace falta computer-use.** El camino CDP+Playwright que descubrió F0
> del script de prueba diaria no tiene ese problema: no depende del índice de aplicaciones de
> Windows ni de qué sesión ve la herramienta, porque habla con el proceso por un puerto de depuración
> que la propia app abre.
>
> **Efecto en el roadmap §9:** este plan sale de la lista de "4 trabajos que necesitan el mismo
> handle de escritorio con el operador presente". Lo que queda del operador acá son ~15 min de
> capturas (D4), no una sesión conjunta.

### ❌ No — las tiene que sacar el operador

1. **Cualquier pantalla de la extensión Chrome en acción** (popup, autocompletado en Escritos,
   Notificaciones, DEOX, el menú contextual "Enviar expediente a PJN"). Dos motivos, ambos duros:
   - `list_connected_browsers` devuelve `[]` — no hay Chrome conectado por la extensión
     Claude-in-Chrome, que es el único camino a un navegador real con la extensión del PJN cargada.
   - Aunque computer-use *vea* Chrome, los navegadores se otorgan en **tier "read"**: se pueden
     leer en pantalla, pero **no se pueden clickear ni tipear**. No se puede conducir un flujo.
2. **El sitio del PJN (SCW, SSO, Escritos, Notificaciones, DEOX).** Requiere credenciales reales
   del operador, y son pantallas de un tercero.
3. **El login SSO del PJN con el overlay de la app** (la captura de las 11:40 de la referencia).
   Muestra el campo de contraseña del PJN. **Recomiendo directamente no incluirla en la demo** —
   aporta poco comercialmente y es la pantalla más delicada del set.

**Cómo se resuelve:** el operador saca esas capturas (una pasada de ~15 min siguiendo el guion de
D1), y el bloque **D4** se encarga de la **redacción por sustitución** (§2, estrategia B) sobre esos
archivos. Es la única parte de la demo que no es reproducible por script — y hay que asumirlo:
quedará documentado en el guion qué capturas son manuales, para que quien regenere la demo dentro
de seis meses sepa cuáles tiene que volver a pedir.

---

## 5. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| **R1** | Una captura se publica con un dato real que se pasó por alto | Estrategia A (sustitución sintética) elimina la clase entera, **y ahora también en la app Electron** (§0.1). Para lo manual de D4: **revisión explícita del operador antes de publicar**, sobre el archivo final, no sobre el proceso |
| **R2** | La demo queda obsoleta al siguiente release | Es la razón del pipeline reproducible (D3), que tras el spike cubre **~90% de las pantallas** en vez de ~60%. Agregar la regeneración al **checklist de release de Electron** |
| **R3** | Se muestra una feature que el plan del visitante no incluye | Cada capítulo indica el plan que la incluye. Bitácora y Markdown son gateados por plan |
| **R4** | La demo promete un resultado que el producto no garantiza (anonimización) | La leyenda de "ayuda automática, no garantía" del módulo Markdown va también en su capítulo |
| **R5** | Las capturas del PJN muestran una versión vieja del sitio del PJN | Fuera de nuestro control. Fecharlas en el guion |
| **R6** | **D3 se ejecuta antes del release de Electron y el capítulo de Markdown sale vacío** | Dependencia dura detectada en el spike (§0.1, hallazgo 1): la app instalada **no tiene el botón de Markdown** porque M2–M5 están commiteados sin release. **Verificar la versión instalada antes de arrancar D3**, y que la cuenta de demo tenga `markdown_enabled=true` |
| **R7** | La sustitución de datos rompe el flujo en vez de solo la captura | Regla de D2: sustituir **después** de llegar a la pantalla, nunca antes de una acción que dependa del valor. Ya pasó una vez en el spike (§0.1, hallazgo 2) |

---

## 6. Prompts de arranque

**D1 (arrancar por acá):**

> Ejecutá el bloque **D1** de `docs/internal/plan-demo-producto-2026-08-26.md` — guion de la demo.
> **Sonnet, esfuerzo medio.** Mirá primero las 36 capturas de referencia en
> `C:\Users\JONATHAN\Desktop\ordenar\imagenes` para entender el encuadre que quiere el operador, y
> las secciones "Funciones" y "Planes" de `backend-server/public/landing/index.html` para que el
> guion hable el mismo idioma que la landing. Entregable: `docs/internal/demo-guion.md`, que debe
> marcar explícitamente **qué capturas son automatizables (D3) y cuáles las tiene que sacar el
> operador (D4)**. **No saques capturas todavía** — eso es D3 y necesita los fixtures de D2.

**D3 (cuando D2 esté listo):**

> Ejecutá el bloque **D3** de `docs/internal/plan-demo-producto-2026-08-26.md` — pipeline de
> captura. **Sonnet, esfuerzo alto.** Leé primero **§0.1** (el spike que habilitó capturar la app
> Electron con Playwright vía CDP) y `tests/daily/electron_driver.py`, que ya resuelve lanzamiento,
> guard de instancia única y login — **reusalo, no lo reimplementes**. 🚨 Antes de arrancar,
> verificá que la app instalada tenga el módulo Markdown (ver R6) y que la cuenta de demo tenga el
> flag encendido. Regla de oro: sustituir datos sintéticos **después** de llegar a cada pantalla,
> nunca antes de una acción que dependa del valor real (R7).
