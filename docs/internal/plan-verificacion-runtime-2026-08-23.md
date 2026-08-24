# Plan de verificación en runtime — campaña `/verify` (2026-08-23)

> **Qué es esto.** Un plan para verificar el producto **ejecutándolo**, superficie por superficie,
> con `/verify`. No es una revisión de código: acá nadie lee archivos buscando bugs, se abre la
> app, se la conduce y se captura lo que hace.
>
> **Qué NO es.** No reemplaza a `plan-revision-integral-2026-07-27.md` (revisión de código, E1-E6),
> ni a `informe-seguridad-sec1-2026-07-13.md` (seguridad), ni al Bloque R de
> `plan-pruebas-integral-2026-07.md` (funcional end-to-end, ya cerrado 37/37). Es el eje que
> **ninguno de esos tres cubre**: que el código que se despliega efectivamente corra en un
> navegador o en la app real.
>
> **Estado:** propuesta lista para ejecutar. **No se modificó código al armarlo.**
>
> **Elaborado con:** Opus 5. **Para ejecutar con:** ver §4 (modelo y esfuerzo por bloque).

---

## 1. Por qué existe — el hueco, medido

`/verify` está atado a un alcance (un diff, o un "¿anda X?" concreto). No existe una corrida que
"verifique el proyecto". Lo integral se arma como **campaña**: varias corridas, una por superficie,
ordenadas. Este documento es esa campaña.

### El dato que la justifica

Commits que tocaron `backend-server/public/usuarios/` en agosto de 2026:

| Commit | Qué arreglaba | Cómo se detectó |
|---|---|---|
| `a71987b` | Botones de Bitácora/Mis Expedientes sin wiring al entrar por SSO desde Electron | **Operador, en producción** |
| `72759b8` | Radios descalzados del texto + botón de archivo nativo sin estilar | **Operador, con capturas** |
| `e9a5571` | Botón "Guardar" sin efecto en 2 modales (form/botón desasociados) | **Operador, en producción** |
| `246bea6` | ✕ de "olvidar cuenta" renderizada fuera de la card | **Operador, con capturas** |
| `651e58c` | Enter/Espacio sobre la ✕ logueaba en vez de olvidar la cuenta | `/verify` (2026-08-23) |

**Cinco bugs de frontend en tres semanas, cuatro encontrados por el operador con el producto ya en
producción.** Ninguno lo cazó `node --check`, ni la revisión de código, ni el Bloque R.

No es casualidad: según el propio `CLAUDE.md`, **todo el frontend del portal se validó
históricamente con `node --check` + lectura de código**, con la justificación recurrente de que
staging está detrás de Basic Auth ("mismo patrón que toda sesión anterior de este proyecto que tocó
`public/usuarios/`"). Los 4 bugs del operador son exactamente la clase de defecto que un linter no
puede ver y un click sí.

El quinto es el más ilustrativo: `246bea6` **arregló** un bug de la ✕ e **introdujo otro peor en la
misma línea** —el botón de olvidar cuenta logueaba al usuario en esa cuenta— y estuvo vivo en
producción 3 días. Lo encontró la primera corrida de `/verify` que se hizo sobre ese archivo.

### Cobertura actual de runtime

| Superficie | Tamaño | ¿Conducida en runtime alguna vez? |
|---|---|---|
| `public/usuarios/app.js` (10 secciones) | **213 KB** | ⚠️ Solo login + Bitácora/Mis Exp. parcial (F3.0, y con stub) |
| `public/dashboard/dashboard.js` (12 secciones) | **314 KB** | ⚠️ Solo C1 (PDF de facturas) y el fix XSS-1 |
| `electron-app/renderer.js` | 179 KB | ⚠️ Solo por Bloque R / pruebas diarias |
| `electron-app/main.js` | 143 KB | ⚠️ Ídem |
| `onboarding/tour.js` | 25 KB | ⚠️ Una vez (R2.2), hace un mes |
| Extensión Chrome (5 flujos) | — | ❌ **Nunca** (R9.1/R9.2 abiertos) |
| Landing | — | ⚠️ Una vez (2026-08-16) |

---

## 2. Criterio de orden

Tres ejes, en este orden:

1. **Costo del handle** — ¿se levanta la superficie sola, o hace falta credenciales del PJN, cupo
   y presencia del operador?
2. **Radio de impacto** — ¿toca datos reales, cobro, o consume cupo del PJN?
3. **Dependencias** — nada que dependa de datos que otro bloque genera va antes que ese bloque
   (la lección B4→B6 del plan de Bitácora).

**Barato y aislado primero; caro, irreversible y con operador presente al final.**

---

## 3. Los bloques

| # | Bloque | Handle | ¿Operador? | Riesgo |
|---|---|---|---|---|
| **V0** | Andamio: `SKILL.md` + stub server | — | no | 🟢 |
| **V1a** | Portal — Bitácora + Mis Expedientes | stub + Playwright | no | 🟢 |
| **V1b** | Portal — las otras 8 secciones | stub + Playwright | no | 🟢 |
| **V2a** | Dashboard — Usuarios, Tickets, Planes | stub + Playwright | no | 🟢 |
| **V2b** | Dashboard — las otras 9 secciones | stub + Playwright | no | 🟢 |
| **V3** | API backend + gates por plan | HTTP a staging | no | 🟡 |
| **V4** | Electron **sin** PJN | computer-use | sí (sin cupo) | 🟡 |
| **V5** | Electron **con** PJN (5 flujos) | computer-use + credenciales | **sí** | 🔴 |
| **V6** | Extensión Chrome (5 flujos) | Chrome real + credenciales | **sí** | 🔴 |
| **V7** | Cobranza / MercadoPago sandbox | checkout real sandbox | **sí** | 🔴 |

**Grafo de dependencias:** `V0 → todo lo demás`. `V1a/V1b/V2a/V2b/V3` son independientes entre sí
(paralelizables en sesiones distintas). `V5` depende de `V4` (no tiene sentido gastar cupo del PJN
si la app ni siquiera abre bien). `V7` último siempre.

---

### V0 — Andamio (hacer una vez, antes que nada) ✅ EJECUTADO (2026-08-24)

> `backend-server/dev-tools/stub-portal.js` + `stub-dashboard.js` + `.claude/skills/verify/SKILL.md`,
> commit `aa4621a`. Verificado conduciendo ambos stubs con Playwright (login end-to-end, 9 secciones
> del portal + 12 del dashboard, 0 errores de consola). Ver la entrada de sesión 2026-08-24 en
> `CLAUDE.md` para el detalle completo. **Siguiente bloque: V1a.**

**Por qué primero.** Hoy no existe `.claude/skills/verify/SKILL.md`. La corrida del 2026-08-23
arrancó en frío y perdió tiempo descubriendo a los golpes las trampas del entorno. Sin persistirlas,
**cada bloque siguiente vuelve a pagar ese costo**.

**Entregables:**

1. **`backend-server/dev-tools/stub-portal.js`** — servidor que sirve los archivos **reales** de
   `public/usuarios/` y falsea la API (`/auth/portal-login`, `/client/account`, `/usuarios/api/*`).
   Va a `dev-tools/` porque es la convención ya establecida del proyecto (`sim-renewal.js`,
   `reset-test-data.sql`, `reset-panel.ps1`), **no** al scratchpad, que se borra entre sesiones.
   Un `stub-dashboard.js` equivalente para V2.
2. **`.claude/skills/verify/SKILL.md`** con el recetario y, sobre todo, las trampas de abajo.

**Trampas del entorno — confirmadas empíricamente el 2026-08-23. Esto es el corazón de V0:**

| Trampa | Efecto | Qué hacer |
|---|---|---|
| El Browser pane no compone frames | `screenshot` falla siempre ("pane is not displayed") | Usar **Playwright** para capturas |
| Sin screenshot cacheado, los clicks por coordenada se rechazan | `left_click` con `coordinate` da error | Usar `ref` de `read_page`, o Playwright |
| `computer{action:"key"}` manda eventos degenerados | Llega `key:""`, `keyCode:0` — **no activa un `<button>`** | **Nunca** probar teclado en el pane. Playwright |
| Geometría stale tras cambio de clase dinámico | `width`/`margin-left` siguen con el valor viejo | Recargar entre estados, o usar Playwright (ahí sí actualiza en vivo) |
| Playwright escribe las capturas en la raíz del repo | Ensucia el árbol de git | Moverlas al scratchpad y `rm -rf .playwright-mcp` al cerrar |

> ⚠️ **La trampa del teclado es la más cara.** En la corrida del 23/08, un Enter enviado desde el
> pane "no hizo nada" y por un momento pareció que el bug no existía — **falso negativo**. El bug
> era real y Playwright lo reprodujo al instante. Cualquier bloque que pruebe teclado y use el pane
> va a producir conclusiones inválidas.

**Modelo/esfuerzo:** Sonnet 5 · **bajo**. Es transcribir un recetario ya conocido.

---

### V1a — Portal: Bitácora + Mis Expedientes 🟢 ✅ EJECUTADO (2026-08-24)

> Informe completo: `docs/internal/verify-V1a-2026-08-24.md`. **1 bug real confirmado y CORREGIDO
> el mismo día (commit `354fbcc`, desplegado):** ni `saveBitacoraEntrada()` ni `saveMexpFicha()`
> tenían bandera de "ya está guardando" — un doble `submit` antes de que el primer `POST` resuelva
> creaba 2 filas duplicadas (el botón `disabled` bloquea un segundo click de mouse, pero no un
> segundo `submit` disparado por Enter/programático). Fix: `if (btn.disabled) return;` al tope de
> ambas funciones. **1 hallazgo de UX, sin corregir**: Escape no cierra
> ningún modal del portal. El resto del bloque (CRUD, vistas, calculadora de plazos cruzando un
> feriado, export 3×2, import dry-run sin confirmar `reemplazar`, F3.3, borrado 3 vías) — sano.
> `backend-server/dev-tools/stub-portal.js` quedó con estado real en memoria (commit `f4a0cf3`).
> **Siguiente bloque: V1b.**

**Por qué separado del resto:** son las 2 secciones más nuevas, más grandes y con **4 de los 5 bugs
de agosto**. Es el bloque de mayor rendimiento esperado de toda la campaña.

**Qué conducir:**
- Bitácora: crear/editar/borrar entrada de cada `kind`; vista Mes ↔ Lista; panel del día;
  navegación entre meses; chips de filtro; buscador; banner de avisos; marcar hecho/pendiente;
  **Ctrl+Z** para deshacer; calculadora de plazos (incluyendo un plazo que cruce un feriado del
  seed); modal de exportación (3 alcances × 2 formatos) y de importación (`dry_run`, y **sin
  confirmar** el `reemplazar`).
- Mis Expedientes: listado, buscador, alta/edición de ficha, ficha completa, "Entradas de este
  caso", historial/snapshots, y el modal de borrado con las **3 vías** (cancelar / conservar
  entradas / borrar entradas).
- Bandeja de sugerencias (F3.3) si hay filas.

**Probes obligatorios** (la parte que encuentra bugs, no la que confirma el camino feliz):
teclado en cada modal (Tab, Enter, Escape, y **Enter sobre botones anidados** — la clase de bug de
`651e58c`); doble submit; campos vacíos y con `<script>`/comillas; cerrar modal a mitad; fechas
inválidas y fechas límite (29/02, cambio de mes).

**⚠️ No confirmar nunca el `modo=reemplazar` de la importación** — es el único camino destructivo
del módulo. Llegar hasta el dry-run y frenar.

**Modelo/esfuerzo:** Sonnet 5 · **alto**. No por dificultad conceptual sino por volumen: son ~10
pantallas con estado compartido, y con esfuerzo medio se va a conducir el camino feliz y cortar.

---

### V1b — Portal: las otras 8 secciones 🟢 ✅ EJECUTADO (2026-08-24)

> Informe completo: `docs/internal/verify-V1b-2026-08-24.md`. **Hallazgo #1 CORREGIDO Y DESPLEGADO
> el mismo día (commit `f5d1348`):** `submitNewTicket()` tenía el mismo gap de doble submit que
> `354fbcc` ya había arreglado en Bitácora/Mis Expedientes — confirmado con el mismo probe (2
> tickets duplicados creados). Por lectura de código el mismo gap estaba también en
> `saveProfile`, `savePassword` y `doLogin` — **los 4 arreglados y verificados** (reproduciendo el
> probe en cada uno con la página recargada entre pasos). **Hallazgo #2, sin corregir:**
> `deleteMonitorParte()` en
> Mi Plan usa `confirm()` **nativo** en vez del `showConfirm()` custom del resto de la app — anda
> bien, pero es la clase de diálogo que trabó la automatización en el hallazgo histórico U9.3;
> mismo patrón en 2 `alert()` cercanos. **El deep-link SSO (`a71987b`) verificado sano** en los 2
> casos (`goto` simple y `nuevo-ticket`, que además abre el modal). Cancelar/reactivar suscripción,
> reactivación de cuenta suspendida (con escape de HTML confirmado en el motivo), notificaciones,
> Shift+Enter vs Enter en el chat, y el responsive 375/768/1280 — todo sano.
>
> Perfil, Mi Plan, Facturación, Soporte, Notificaciones, Asistente IA, Ayuda, y el estado
> `reactivacion`. Más: login (cuentas guardadas, "usar otra cuenta", mostrar/ocultar contraseña,
> banner de email sin verificar), logout, y el **deep-link por SSO** (`?goto=<seccion>#sso=<token>`),
> que es el camino por el que entra todo usuario de Electron y el que rompió `a71987b`.
>
> Incluye el **responsive** (375 / 768 / 1280) — Bloque R12, nunca ejecutado.
>
> **Modelo/esfuerzo:** Sonnet 5 · **medio**. Secciones más chicas y de solo lectura en su mayoría.
> **Siguiente bloque: V2a.**

---

### V2a — Usuarios, Tickets, Planes 🟢 ✅ EJECUTADO (2026-08-24)

> Informe completo: `docs/internal/verify-V2a-2026-08-24.md`. **1 hallazgo nuevo, sin corregir:**
> `submitAddUser()` dispara un `alert()` **nativo** en el éxito ("Usuario … creado correctamente"),
> distinto del `showAlert()` inline que usa el resto del dashboard — traba automatización/QA que
> no maneje el diálogo. **Confirmación empírica extensa de un patrón ya señalado en el hallazgo #2
> de V1b:** el dashboard admin disparó **9 diálogos nativos distintos** en esta corrida (cambio de
> plan, reactivar, editar email, activar cuenta, vencimiento de plan ×2, desactivar/activar plan
> ×2) — todos funcionan bien, pero es la norma en esta sección, no la excepción; solo
> `adminSuspendUser` usa un modal custom. El resto del bloque, sano: ficha completa con ajustes
> manuales/usos extra/beneficios, escape de HTML confirmado con `<img onerror>` y `<script>` en 2
> campos nuevos, hilo de tickets con nota interna vs externa, editar respuesta, toggle de
> prioridad IA↔manual, alta/edición de plan con visibilidad y checkbox Bitácora, vencimiento de
> plan aplicado y quitado. `stub-dashboard.js` ganó almacén en memoria para
> Usuarios/Tickets/Planes — reusable para V2b. **Siguiente bloque: V2b.**

### V2b — Pagos, Facturación, Feriados, Monitor, Legal, Métricas, Diagnóstico, Scripts 🟢 ✅ EJECUTADO (2026-08-24)

> Informe completo: `docs/internal/verify-V2b-2026-08-24.md`. **1 hallazgo nuevo, real, CORREGIDO Y
> DESPLEGADO el mismo día: regresión de responsive en el sidebar admin.** `showApp()` fijaba
> `sidebar.style.display='flex'` inline en cada login/restauración de sesión, sin mirar el ancho de
> pantalla — como es inline, le gana a la media query `@media(max-width:768px){#sidebar{display:
> none}}` que el fix `86351c4` (2026-08-23) asumía vigente. Confirmado a 375px: el sidebar completo
> (230px, 12 ítems) queda visible y el documento mide 744px de ancho — overflow horizontal real en
> las 12 secciones del panel (es el shell, no una sección puntual), más severo que el "64px
> desperdiciados" que corrigió esa sesión. **Confirmación extensa (3ra corrida seguida) del patrón
> de diálogos nativos** ya señalado en V1b/V2a: `deleteFeriado`, `legalPublish`, `legalDelete`,
> `clearCache`, `reencryptScripts` — todos funcionan, ninguno es la excepción. **1 hallazgo curioso,
> no un bug:** `legalPreview` renderiza `html_content` sin escapar dentro de un `<iframe srcdoc>` —
> un `<script>alert(1)</script>` en el contenido de un documento legal se ejecuta de verdad
> (confirmado, disparó el alert real) — por diseño: el contenido lo escribe siempre un admin
> autenticado, es un editor de HTML crudo para T&C/PyP, no un campo de usuario. El resto del
> bloque, sano: Pagos (alta manual, factura desde pago con subida real de PDF, cross-links
> pago↔factura con `_flashRow`), Feriados (ABM completo por primera vez en el proyecto, con 409 por
> fecha duplicada y escape de `<img onerror>` confirmado), Monitor (stats + tabla), Legal (alta,
> auto-incremento de versión, publicar con intercambio atómico de `is_current`, estadísticas —
> corrigió el shape del propio stub para matchear `routes/legal.js` real), Métricas (overview +
> analytics de la landing), Diagnóstico (corrida real del smoke de API), Scripts (toggle). `stub-
> dashboard.js` queda con las 12 secciones completas del dashboard admin. **Con esto, V2a+V2b
> (dashboard admin) quedan cerrados. Siguiente bloque: V3.**

314 KB, 12 secciones, y la única verificación en navegador que tuvo fue el fix XSS-1 y el botón de
PDF de facturas (C1).

- **V2a:** Usuarios (ficha completa, ajustes manuales, usos extra, beneficios, cambio de plan,
  activar/suspender, editar email), Tickets (hilo, respuesta interna vs externa, prioridad IA,
  editar respuesta), Planes (alta/edición, visibilidad, checkbox Bitácora, vencimiento).
- **V2b:** Pagos, Facturación (pendientes/emitidas, links cruzados), Feriados (ABM de F1.8, nunca
  conducido), Monitor, Legal, Métricas, Diagnóstico, Scripts.

**⚠️ Contra stub, no contra el dashboard real de producción.** Estas pantallas ejecutan acciones
sobre usuarios reales (suspender, cambiar plan, aplicar beneficios). Si se quisiera conducir contra
un backend de verdad, **solo staging**, y con backup previo.

**Modelo/esfuerzo:** Sonnet 5 · **alto** V2a (formularios con muchas ramas y efectos), **medio** V2b.

---

### V3 — API backend + gates por plan 🟡 ✅ EJECUTADO (2026-08-24)

> Informe completo: `docs/internal/verify-V3-2026-08-24.md`. **29/29 aserciones, sin hallazgos
> nuevos.** Harness Node (`backend-server/dev-tools/verify-v3-bitacora-api.js`) corrido en el
> servidor contra `https://localhost:3444` (bypassa nginx/basic-auth). Cubrió `checkBitacoraPlan`
> con/sin flag en los 4 sub-paths gateados (`/bitacora`,`/expedientes`,`/feriados`,`/sugerencias`) ·
> **P1 confirmado en vivo**: `/plans` y `/subscription/current` (router `usuarios.js`, mismo
> prefijo) nunca reciben el 403 del gate de Bitácora, incluso sin el flag · las 3 ramas de la
> ventana de gracia de 90 días en `/bitacora/export` (sin `lost_access_at` → 403 duro · 10 días →
> 200 · 100 días → 403 vencida) + confirmado que la gracia **no se filtra** al resto del módulo ·
> **4 combinaciones de IDOR** (`PUT`/`DELETE` de entrada, `GET` de ficha y de snapshot) con un
> usuario B efímero real (mismo plan que A, para que el bloqueo sea por el filtro `user_id` de la
> query y no por el gate) → 404 en las 4, con la confirmación positiva de que A sigue pudiendo
> editar/borrar lo suyo · 4 validaciones de entrada (`kind`/`title`/`repeat_rule`/`due_at`
> inválidos → 400) · 1 hallazgo de comportamiento, no un bug: `description` de 6000 chars da
> **201** (se trunca a 5000, no rechaza) — así está diseñado (`texto()`), documentado para que no
> se confunda con un bug de validación faltante. **Regla dura respetada**: guard de `DB_NAME` en
> el propio script + limpieza automática al final, verificada por consulta directa — staging quedó
> exactamente como antes de la corrida (3 usuarios, flag apagado, 0 filas de fixture). **Siguiente
> bloque: V4** (Electron sin PJN).

La superficie es el socket. Conducir con HTTP real contra **staging**: gates de
`checkBitacoraPlan` (con y sin flag, y las 3 ramas de la gracia de 90 días), IDOR entre usuarios,
validaciones de entrada, rate limiters, y los caminos de error que el frontend nunca dispara.

**Regla dura:** verificar `DB_NAME` antes de cualquier escritura (regla nacida del incidente del
2026-07-24). Y recordar el bug de `dotenv` documentado: correr scripts de mantenimiento con
`node -r dotenv/config <script> dotenv_config_path=.env.staging`, si no apuntan a **producción**.

**Modelo/esfuerzo:** Sonnet 5 · **medio**.

---

### V4 — Electron sin PJN 🟡 ⛔ INTENTADO Y BLOQUEADO (2026-08-24)

> **No se pudo ejecutar: computer-use no ve la app en este entorno.** `request_access` devolvió
> `notInstalled` para "Procurador SCW" en 3 intentos — incluso con la app **ya abierta por el
> operador** y tras confirmar por shell que la instalación existe
> (`%LOCALAPPDATA%\Programs\Procurador SCW\`) y que el acceso directo del menú Inicio se llama
> exactamente así (`…\Start Menu\Programs\Procurador SCW.lnk`). Pedir "Procurador" a secas devolvió
> como única sugerencia **"SnoreToast"** (el proceso de notificaciones que la app usa, no la app).
> Es el mismo aislamiento de sesiones de Windows ya documentado en `CLAUDE.md` (sesión de F3.1,
> 2026-08-15): los procesos de la sesión visible del operador y los que ve computer-use viven en
> sesiones distintas. **No es un defecto del producto** — es una limitación del entorno de esta
> sesión. Para desbloquearlo hace falta una sesión con acceso de escritorio real, como las de la
> "prueba diaria" que sí funcionaron en julio/agosto.

Todo lo que no lanza Puppeteer: login (y sus estados bloqueantes), Mi Cuenta, Estadísticas,
banners de cuota/gracia/cancelación, modales de configuración, tabs del topbar, botón 📔 Bitácora,
**tour de onboarding completo** (14 pasos, conducido una sola vez hace un mes), y el flujo de
"Ver resultados" sobre archivos ya existentes.

**Recordar el hallazgo operativo de F3.1:** un proceso lanzado desde la herramienta de shell vive en
una sesión de Windows invisible para computer-use. Lanzar la app **desde la sesión visible**.

**Modelo/esfuerzo:** Sonnet 5 · **medio**. Requiere operador presente para aprobar computer-use,
pero **no consume cupo**.

---

### V5 — Electron con PJN 🔴

Los 5 flujos reales. **Esto ya está escrito**: seguir el playbook "Prueba diaria de la app Electron
vía computer-use" del `CLAUDE.md`, que tiene el orden, los expedientes, el `batch.txt` y la
advertencia de correr `Consulta Inicial` antes de `Buscar Novedades`.

**Prerrequisitos:** cupo suficiente (sumar cortesía si hace falta), credenciales, operador presente.
**Depende de V4.**

**Modelo/esfuerzo:** Sonnet 5 · **medio**.

---

### V6 — Extensión Chrome 🔴 ⛔ INTENTADO Y BLOQUEADO (2026-08-24)

> **Lo digo explícitamente, como pide el propio bloque más abajo: sigue trabado.**
> `list_connected_browsers` devolvió `[]` — no hay ninguna instancia de Chrome conectada por la
> extensión Claude for Chrome, así que no hay forma de conducir el navegador real donde está
> cargada la extensión del PJN. computer-use tampoco sirve acá, por el mismo aislamiento de sesión
> que bloqueó V4. **R9.1/R9.2 siguen abiertos desde julio, ahora con la causa acotada:** no es
> falta de tiempo ni de prioridad, es que este entorno no tiene un camino a un Chrome real.
> Para desbloquearlo: conectar la extensión Claude for Chrome en el Chrome del operador (el que
> tiene cargada la extensión PJN), o ejecutarlo de forma manual guiada.

R9.1/R9.2, abiertos desde julio. Los 5 flujos (Consulta SCW, Escritos 1, Escritos 2, Notificaciones,
DEOX) contra los portales reales, más el login del popup y el click del logo con y sin sesión.

Requiere Chrome real con la extensión cargada y credenciales del PJN. **Es el bloque con menos
probabilidad de ejecutarse** — si sigue trabado, decirlo explícitamente en vez de dejarlo abierto
otro trimestre.

**Modelo/esfuerzo:** Sonnet 5 · **medio**.

---

### V7 — Cobranza / MercadoPago 🔴 ✅ EJECUTADO (2026-08-24)

> Informe completo: `docs/internal/verify-V7-2026-08-24.md`. **40/40 aserciones. 1 hallazgo real de
> configuración, sin corregir.** Harness `backend-server/dev-tools/verify-v7-cobranza.js` corrido en
> el servidor contra staging, con **regla de seguridad central: ninguna aserción puede alcanzar un
> camino que ESCRIBA en MercadoPago** — sostenida por 3 mecanismos (solo casos negativos de
> `/checkout/init`, fixture con `external_subscription_id` placeholder `pay-*` verificado por una
> aserción propia antes de cada cancel/reactivate, y webhooks con ids de pago inexistentes que solo
> disparan lecturas). **Comprobado después, no asumido:** 0 preapprovals en los 3 estados vivos de
> MP — el harness no creó ni tocó nada. **Cubierto:** gate de activación del checkout (403 en
> `pending_activation`/`pending_email`) · **guard B3** de mismatch de plan (400 antes de crear el
> preapproval) · firma HMAC del webhook en 5 variantes, **incluida la prueba positiva que el smoke
> oficial no hace** (cierra P-F2.2-a) · idempotencia de `webhook_events` · **fix B1** (`expires_at`
> avanza en `applyTrialBonus` y `applyRenewal` — el bug crítico que bloqueaba a un cliente al día) ·
> **fix B2** (plan fuera de `PLAN_LIMITS` ya no lanza dentro de la transacción del webhook → ya no
> pierde el pago) · `cancelSubscription` incluido su fallback defensivo B1 · los 3 guards de
> `reactivateSubscription` · y la selección de los 2 crons de corte, con la doble protección que
> evita cancelarle la cuenta a quien acaba de pagar. **⚠️ Hallazgo:** `.env.staging` y la `.env` de
> producción tienen el **mismo** token de MP (byte-idéntico, misma cuenta sandbox), pese a que
> `CLAUDE.md` documenta el de staging como independiente — inocuo hoy (prod también es sandbox,
> B3 pendiente), pero sin ningún mecanismo que lo mantenga separado cuando B3 cargue credenciales
> reales. **No cubierto, explícito en el informe:** el camino feliz de un pago real end-to-end, la
> transacción atómica de `handlePaymentEvent` (M4), `markPaymentConfigured`/`reconcileClaimedCheckout`
> y `updatePreapprovalAmount` — todos exigen escrituras a MP o una persona completando un checkout.

Checkout, upgrade/downgrade, cancelar/reactivar, pago rechazado → gracia → suspensión → recuperación.
**Sandbox únicamente.** Va último por radio de impacto.

**Modelo/esfuerzo:** **Opus 5** · **alto** — por la regla ya establecida del proyecto: todo lo que
toca cobro real o movimiento de dinero se analiza con Opus.

---

## 4. Modelo y esfuerzo — resumen

| Bloque | Modelo | Esfuerzo |
|---|---|---|
| V0 Andamio | Sonnet 5 | bajo |
| V1a Portal Bitácora/Mis Exp. | Sonnet 5 | **alto** |
| V1b Portal resto | Sonnet 5 | medio |
| V2a Dashboard Usuarios/Tickets/Planes | Sonnet 5 | **alto** |
| V2b Dashboard resto | Sonnet 5 | medio |
| V3 API/gates | Sonnet 5 | medio |
| V4 Electron sin PJN | Sonnet 5 | medio |
| V5 Electron con PJN | Sonnet 5 | medio |
| V6 Extensión | Sonnet 5 | medio |
| V7 Cobranza | **Opus 5** | **alto** |

**Por qué Sonnet en casi todo:** conducir una interfaz y capturar lo que hace es trabajo mecánico y
observable, no diseño. Opus se justifica para *diseñar* planes (como éste) y para lo que toca plata.

**Los dos "alto" no son por dificultad, son por volumen:** V1a y V2a tienen ~10 pantallas cada uno
con estado compartido entre ellas. Con esfuerzo medio se conduce el camino feliz y se corta, que es
justamente lo que ya hacen `node --check` y la revisión de código.

**Si hay que recortar por costo:** dejar **V1a en alto** y bajar V2a a medio. V1a es donde la
evidencia dice que están los bugs.

---

## 5. Reglas de ejecución

1. **Una sesión por bloque, contexto fresco.** No encadenar. Cada bloque tiene handle distinto.
2. **V0 primero, siempre.** Sin el andamio los demás repiten el arranque en frío.
3. **Playwright para cualquier cosa que involucre teclado o capturas.** Ver la tabla de trampas de
   V0. Un Enter desde el Browser pane produce falsos negativos.
4. **El bloque de verificación NO corrige código.** Produce el informe con veredicto, pasos,
   evidencia y hallazgos. **El operador decide qué se corrige** — mismo método que E1-E6, que
   funcionó bien.
5. **Contra stub o staging, nunca contra el dashboard/API de producción** salvo lectura. Las
   pantallas de admin ejecutan acciones sobre usuarios reales.
6. **Verificar `DB_NAME` antes de cualquier escritura.**
7. **Ningún camino destructivo se confirma:** el `modo=reemplazar` de la importación, borrados
   masivos, suspensiones. Llegar hasta la confirmación y frenar.
8. **Limpiar al cerrar:** capturas fuera del repo, `.playwright-mcp` borrado, stubs apagados,
   `localStorage` de prueba limpiado, `git status` como al inicio.
9. **Nunca `git add -A`.** Archivos explícitos por nombre.
10. **Sin cortes por tiempo.** El bloque se cierra cuando está cerrado.
11. **Un informe por bloque:** `docs/internal/verify-V<N>-<fecha>.md`.

---

## 6. Prompts de arranque

Literales, para pegar en una sesión nueva. `/verify` sin diff necesita alcance explícito: el patrón
es **"conducí X y confirmá Y"**, nunca "revisá X" (eso devuelve lectura de código).

**V0**
```
Leé docs/internal/plan-verificacion-runtime-2026-08-23.md y ejecutá el bloque V0:
creá backend-server/dev-tools/stub-portal.js y stub-dashboard.js, y escribí
.claude/skills/verify/SKILL.md con el recetario de arranque y la tabla de trampas
del entorno de §V0. Verificá que ambos stubs levantan y sirven las páginas reales.
```

**V1a**
```
/verify Conducí en un navegador real (Playwright, contra dev-tools/stub-portal.js)
las secciones Bitácora y Mis Expedientes del portal, según el bloque V1a de
docs/internal/plan-verificacion-runtime-2026-08-23.md. Incluí los probes de teclado
en cada modal. NO confirmes el modo=reemplazar de la importación.
```

**V1b / V2a / V2b** — mismo molde, cambiando bloque y secciones.

**V3**
```
/verify Conducí la API de Bitácora contra STAGING por HTTP real según el bloque V3
de docs/internal/plan-verificacion-runtime-2026-08-23.md: gates de plan (con flag,
sin flag, y las 3 ramas de la gracia de 90 días), IDOR entre usuarios y validaciones
de entrada. Verificá DB_NAME antes de cualquier escritura.
```

**V4**
```
/verify Conducí la app Electron con computer-use según el bloque V4 de
docs/internal/plan-verificacion-runtime-2026-08-23.md — solo lo que NO lanza
Puppeteer. Lanzá la app desde la sesión visible, no desde la shell.
```

**V5** — usar el playbook "Prueba diaria" del `CLAUDE.md`, no reinventarlo.

**V7** (Opus)
```
/verify Conducí el ciclo de cobranza en MercadoPago SANDBOX según el bloque V7 de
docs/internal/plan-verificacion-runtime-2026-08-23.md. Sandbox únicamente, jamás
credenciales de producción.
```

---

## 7. Qué NO cubre este plan

Explícito, para que "campaña terminada" no se lea como "proyecto verificado":

- **Revisión de código.** Es `plan-revision-integral-2026-07-27.md` (E1-E6, ya ejecutado).
- **Seguridad.** Es `informe-seguridad-sec1-2026-07-13.md`. La auditoría **externa** sigue sin
  contratarse.
- **Pruebas de carga/concurrencia.** Nunca hechas. Cobran importancia real recién con B3
  (MercadoPago producción).
- **Un solo motor de navegador.** Playwright usa Chromium. Ni Firefox ni Safari.
- **Mobile es viewport, no dispositivo.** Se redimensiona; no se emula touch ni se prueba en un
  teléfono real.
- **No deja regresión automatizada.** Cada bloque es una corrida manual. Nada queda corriendo para
  la próxima vez que alguien toque `renderRememberedUsers()`. Si eso importa, es un proyecto aparte
  (y `sec2-b1-ci-setup.md` ya tiene el CI donde colgarlo).

---

## 8. Estimación

10 bloques ≈ **10 sesiones**. Los 5 primeros (V0–V2b) no necesitan al operador más que para
arrancarlos; los 4 últimos sí, y V6 puede quedar trabado por las mismas razones que mantienen
R9.1/R9.2 abiertos desde julio.

**Orden mínimo recomendado si no se hace la campaña completa:** `V0 → V1a → V1b`. Son tres sesiones,
no requieren al operador, y cubren la superficie donde 4 de los 5 bugs de agosto aparecieron en
producción.
