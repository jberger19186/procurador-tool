# Plan — Demo reproducible del producto para la landing (2026-08-26)

> **Pedido del operador (2026-08-26):** una presentación *que pueda reproducirse*, armada con
> capturas reales de la aplicación y de las pantallas web, **con los datos de usuarios y
> expedientes esfumados**, accesible desde la landing page, que muestre las funciones incluyendo
> **Bitácora, Markdown y la extensión de Chrome**. Referencia de encuadre: las 36 capturas de
> `C:\Users\JONATHAN\Desktop\ordenar\imagenes`.
>
> **Lugar en el proyecto:** **Etapa 1.6** de `docs/internal/roadmap-salida-a-mercado-2026-08.md` —
> el último bloque de la etapa de producto, porque necesita que Bitácora F3.4 y el módulo Markdown
> ya existan para poder mostrarlos.
>
> **Estado:** plan. No se produjo ninguna captura ni código todavía.

---

## 0. Resumen ejecutivo

| | |
|---|---|
| **Formato recomendado** | **Tour guiado en HTML estático** servido desde la landing (`/demo/`), con capturas + texto + navegación por pasos, y GIF/MP4 cortos solo donde el movimiento aporte |
| **Por qué no un video** | Ver §1 — un video no se regenera, no se indexa, no se traduce, y queda obsoleto en el primer release |
| **Superficies a mostrar** | App Electron (procuración, informe, monitor) · Visores · Bitácora (app + portal) · Módulo Markdown · Extensión Chrome · Portal de usuarios |
| **Anonimización** | **Dos estrategias, y la buena es la primera**: datos sintéticos *antes* de capturar (sin redacción) · redacción irreversible *después* solo donde no haya alternativa |
| **Automatizable hoy** | Portal, dashboard y landing: **sí, 100%** (Playwright contra los stubs de V0 — que ya traen datos falsos por construcción) |
| **Automatizable con el operador presente** | App Electron y visores: **sí** — mismo handle que V4 (ver §4) |
| **NO automatizable** | **Extensión Chrome y sitio del PJN** — el operador tiene que capturarlas. Ver §4 |
| **Bloques** | 5 (D1–D5) |
| **Modelo / esfuerzo** | Sonnet en todos. `medio` salvo D3 (captura, `alto` por volumen de conducción) |
| **Sesiones estimadas** | 4–6, más una sesión con el operador presente para D3 |

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

### D1 — Guion y selección de flujos 🟢

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** |
| **Entregable** | `docs/internal/demo-guion.md` — la lista ordenada de pantallas, con el texto de cada paso y qué dato sintético lleva cada una |

Un guion, no una galería. La demo tiene que contar el recorrido de un usuario, no enumerar
pantallas. Estructura propuesta (6 capítulos, ~20 pasos):

1. **El problema** — 1 pantalla del SCW real (redactada) mostrando el trabajo manual.
2. **Procuración** — cargar expedientes → correr → el visor con las novedades.
3. **Informe** — individual y por lote → el PDF.
4. **Monitor de partes** — alta de una parte, consulta inicial, novedades detectadas.
5. **Bitácora** — captura desde el visor con un clic → la ficha del caso → la agenda con
   vencimientos → (F3.4) la vista Semana y el export `.ics`.
6. **Markdown / anonimización** — informe → `.md` completo → `.md` anonimizado + mapping editable.
7. **Extensión Chrome** — el data-entry automático en los 5 flujos del PJN.

**Decisión que hay que tomar acá:** ¿la demo es **una sola pieza larga** o **una por módulo**?
Recomiendo **por módulo, con un índice** — así la landing puede linkear "ver Bitácora en acción"
desde la tarjeta de Bitácora, y cada módulo se regenera solo cuando cambia.

---

### D2 — Fixtures sintéticos y siembra 🟢

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** |
| **Depende de** | D1 |
| **Entregable** | `backend-server/dev-tools/demo-fixtures/` — expedientes, carátulas, partes, entradas de bitácora y un informe PDF de ejemplo, todos inventados |

- Un set coherente: los mismos 4–5 expedientes ficticios atraviesan toda la demo (procuración →
  informe → bitácora → markdown). La coherencia es lo que hace que se vea real.
- Carátulas con la forma real del PJN pero con partes obviamente ficticias.
- **Extensión de los stubs de V0** para que sirvan estos fixtures (hoy sirven un set mínimo para
  que la SPA arranque; acá hacen falta datos que se vean bien en una captura).
- Un generador que produzca los visores desde el fixture, reusando `generarVisorHTML()` /
  `generarVisorMonitoreo()` reales — no una maqueta.

---

### D3 — Captura 🟠 *requiere al operador para una parte*

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **alto** (volumen de conducción, no dificultad) |
| **Depende de** | D2, y de que Etapa 1.1 + 1.2 estén terminadas |
| **Entregable** | `backend-server/public/landing/demo/assets/` + el script que las regenera |

Tres pipelines, según la superficie. **Ver §4 para qué se puede y qué no.**

| Superficie | Herramienta | Datos | Automatizable |
|---|---|---|---|
| Portal de usuarios, dashboard, landing | **Playwright** contra los stubs | sintéticos | ✅ **totalmente** |
| Visores (procuración / informe / monitor) | **Playwright** sobre el HTML generado del fixture | sintéticos | ✅ **totalmente** |
| App Electron (ventanas, modales, consola) | **computer-use** | cuenta demo sembrada | ⚠️ con el operador (ver §4) |
| Extensión Chrome + sitio del PJN | **operador, a mano** | reales → redacción B | ❌ ver §4 |

**Requisito de reproducibilidad:** todo lo de las dos primeras filas tiene que quedar como **un
script que se corre y regenera las imágenes**, con tamaño de viewport fijo y sin dependencias del
entorno. Ese script es el entregable más valioso del bloque — es lo que hace que la demo no se
pudra en el próximo release.

**Higiene, con antecedente:** las capturas de Playwright **no se dejan sueltas en el repo**. Ya es
una de las 5 trampas documentadas en `.claude/skills/verify/SKILL.md` ("capturas que ensucian el
repo"). Salida a una carpeta dedicada y versionada a propósito, o `.gitignore` + build.

---

### D4 — Construcción del tour 🟢

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **medio** |
| **Depende de** | D3 |
| **Entregable** | `backend-server/public/landing/demo/index.html` (+ CSS/JS propios) |

- HTML estático, **sistema de diseño de la landing** (ámbar `#d97706`, Inter, Crimson Pro).
- Navegación por pasos con teclado y con botones; deep-link por capítulo (`/demo/#bitacora`) para
  poder linkear desde cada tarjeta de la landing.
- Responsive real (375 / 768 / 1280) — la landing ya se verifica en esos tres anchos.
- **Sin dependencias externas**: nada de CDN. La landing la sirve Nginx como estático y así debe
  seguir.
- Enlaces a la acción: cada capítulo termina con "Probalo" → registro.

---

### D5 — Integración en la landing + despliegue 🟢

| | |
|---|---|
| **Modelo / esfuerzo** | Sonnet · **bajo** |
| **Depende de** | D4, y de la **Etapa 1.3** (TyC/landing) para no tocar el mismo archivo dos veces |

- Entrada en el navbar ("Ver demo") + botón en el hero + link desde cada tarjeta de "Funciones" al
  capítulo correspondiente.
- Despliegue: `scp` a `/var/www/procurador/backend-server/public/landing/demo/` — **sin
  `pm2 restart`**, la landing es estática vía Nginx.
- Verificación en vivo con `curl` + una pasada de navegador, igual que cualquier cambio de landing.

---

## 4. Qué se puede capturar automáticamente y qué no — respuesta directa

El operador preguntó explícitamente cuáles no se pueden obtener con computer-use. Con el estado
del entorno **medido el 2026-08-24**:

### ✅ Sí, y sin ninguna anonimización necesaria

**Portal de usuarios, dashboard admin, landing, y los 4 visores.** Playwright contra los stubs de
V0 y contra HTML generado de fixtures. Datos falsos por construcción. Esto cubre, mirando las 36
capturas de referencia, **buena parte de las pantallas web**.

### ⚠️ Sí, pero solo con el operador presente en la máquina

**La app Electron** (login, dashboard, modales de Procurar/Informe/Monitor, consola, Mi Cuenta,
tour). Es el mismo handle que bloquea **V4** de la campaña `/verify`: `request_access` de
computer-use devuelve `notInstalled` para "Procurador SCW" **incluso con la app abierta**, por el
aislamiento de sesiones de Windows — una app lanzada desde la shell vive en una sesión que la
herramienta no ve.

**No es un límite permanente:** el 2026-07-23 una sesión condujo la instalación NSIS completa con
computer-use sin problema. La condición se reproduce lanzando la app **desde la sesión visible al
agente**. Por eso D3 y V4 **deben ejecutarse en la misma sesión con el operador** (ver el roadmap,
§ sesiones con operador).

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
D1), y el bloque D3 se encarga de la **redacción por sustitución** (§2, estrategia B) sobre esos
archivos. Es la única parte de la demo que no es reproducible por script — y hay que asumirlo:
quedará documentado en el guion qué capturas son manuales, para que quien regenere la demo dentro
de seis meses sepa cuáles tiene que volver a pedir.

---

## 5. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| **R1** | Una captura se publica con un dato real que se pasó por alto | Estrategia A (datos sintéticos) elimina la clase entera. Para lo manual: **revisión explícita del operador antes de publicar**, sobre el archivo final, no sobre el proceso |
| **R2** | La demo queda obsoleta al siguiente release | Es la razón del pipeline reproducible (D3). Agregar la regeneración al **checklist de release de Electron** |
| **R3** | Se muestra una feature que el plan del visitante no incluye | Cada capítulo indica el plan que la incluye. Bitácora y Markdown son gateados por plan |
| **R4** | La demo promete un resultado que el producto no garantiza (anonimización) | La leyenda de "ayuda automática, no garantía" del módulo Markdown va también en su capítulo |
| **R5** | Las capturas del PJN muestran una versión vieja del sitio del PJN | Fuera de nuestro control. Fecharlas en el guion |

---

## 6. Prompt de arranque

> Ejecutá el bloque **D1** de `docs/internal/plan-demo-producto-2026-08-26.md` — guion de la demo.
> **Sonnet, esfuerzo medio.** Mirá primero las 36 capturas de referencia en
> `C:\Users\JONATHAN\Desktop\ordenar\imagenes` para entender el encuadre que quiere el operador, y
> las secciones "Funciones" y "Planes" de `backend-server/public/landing/index.html` para que el
> guion hable el mismo idioma que la landing. Entregable: `docs/internal/demo-guion.md`. **No
> saques capturas todavía** — eso es D3 y necesita los fixtures de D2.
