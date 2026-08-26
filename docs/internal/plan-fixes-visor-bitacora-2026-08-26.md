# Plan de arreglos — Visor de Procuración/Informe ↔ Bitácora (2026-08-26)

> Origen: 21 hallazgos reportados por el operador tras probar el flujo real de
> captura desde el visor de procuración (botonera F3.2) sobre `FCR 9078/2021`,
> volcados en un comentario de Word (`Si hago clic en la carpeta amarilla al
> lado de FCR 9078.docx`) y refinados en conversación. Ver el chat de la sesión
> 2026-08-26 para el detalle de cada refinamiento.
>
> **Ejecución:** por bloques (B0-B4), cada uno con su propio modelo/esfuerzo
> recomendado. Claude no puede invocar `/model`/`/effort` — al cerrar cada
> bloque, avisa el cambio requerido y espera confirmación del operador antes
> de seguir.

---

## 0. Listado de hallazgos (1-21)

### 🔴 Bugs de navegación
1. Click en "carpeta amarilla" de un caso ya guardado → pantalla en blanco (debería ir a la ficha en Bitácora).
2. "Guardar caso" no lleva a la ficha del expediente — manda al listado general.
3. "Guardar procuración" tiene el mismo problema de destino.
4. "Ver ficha" desde el detalle → pantalla en blanco (mismo síntoma que el 1).
5. El visor no refleja en vivo que un caso quedó guardado (sin recargar no se nota el cambio de estado).

### 🟡 Consistencia de opciones guardado ↔ no guardado
6. Los casos ya guardados no muestran "+ vencimiento / + tarea / + nota" — deberían tener las mismas opciones que los no guardados, y que el link a Bitácora funcione (a la pantalla del caso, no en blanco).
7. En los no guardados, el botón de guardar ya aparece al tildar el checkbox o al entrar al modal — eso funciona. Se complementa con las columnas del punto 8.

### 🟢 Columnas del visor (versión final)
8. **Dos columnas al inicio de cada fila, con propósitos distintos:**
   - **Columna 1 — ícono de estado individual:** no guardado → ícono "guardar" (guarda al presionar); ya guardado → ícono "hoja" que lleva directo a la ficha en Bitácora.
   - **Columna 2 — checkbox de selección múltiple:** exclusiva para acciones masivas (guardar casos, guardar procuración/informe, entradas habilitadas sobre los tildados).
9. El número de expediente como link a la ficha guardada.
10. En todos los casos: "guardar procuración" y "crear entrada"; solo en los no guardados, además, "guardar caso".

### 🟢 Modal "Crear entrada"
11. No respeta el sistema de diseño de la app.
12. **(Vinculado al punto 15, mismo modal)** Debería mostrar arriba expediente/carátula/dependencia/situación/última actividad, debajo el texto+fecha, y los campos completos según el tipo de entrada.

### 🟢 Paginación del modal de detalle
13. Reacomodar: "Anterior" a la izquierda, "N de M" al centro, "Siguiente" a la derecha.

### 🟢 Selección múltiple → entradas
14. Reemplazar el prompt numérico (1/2/3) por un botón por tipo de entrada.
15. **(Vinculado al 12)** Modal único para carga múltiple: datos fijos del caso arriba, campos del tipo de entrada elegido abajo, botones Guardar/Descartar + Anterior/Siguiente para recorrer la selección sin cerrar el modal.

### 🟢 Navegación entre pestañas
16. Cada acceso a Bitácora abre una pestaña nueva — hoy pasa exactamente por esto: no hay reuso de pestaña, se acumulan "infinitas" pestañas. Corregir reutilizando la ya abierta.
17. Una vez unificada la pestaña, "Atrás" necesita **memoria de navegación interna** (pila del historial de pantallas visitadas dentro de esa sesión de pestaña), no un solo paso atrás.

### 🔵 Informe (mismos arreglos + 2 propios)
18. Aplicar todo lo de arriba, pero en Informe **solo a la pantalla inicial del visor** — no hay modales de detalle porque cada informe abre directo su PDF.
19. Falta la columna de carátula en la tabla de Informes.
20. La carátula queda vacía al capturar desde el flujo de informe — habría que pasarla también ahí.
21. **(A verificar con prueba real)** Percepción de que los informes no quedan guardados en Bitácora. Revisado el código: el envío sí está definido (`origen:'informe'` → backend guarda `kind='informe'`), sin bug evidente de backend. Probablemente la confirmación pasa desapercibida por los bugs #5 y #16 — confirmar con una prueba antes de descartarlo.

---

## 1. Bloques de ejecución

| # | Bloque | Puntos | Despliegue | Modelo | Esfuerzo |
|---|---|---|---|---|---|
| **B0** | Diagnóstico de causa raíz | 1, 2, 3, 4, 21 | ninguno (solo lectura) | Sonnet | medio |
| **B1** | Navegación del portal: pestaña única + pila de historial + estado "guardado" | 5, 16, 17 | backend (sin release) | Opus | alto |
| **B2** | Modal unificado de entradas (individual + múltiple) | 11, 12, 14, 15 | backend (sin release) | Sonnet | alto |
| **B3** | Rediseño de los visores (columnas, links, botonera) | 6, 7, 8, 9, 10, 13, 18 | release Electron | Sonnet | alto |
| **B4** | Carátula en el flujo de Informe | 19, 20 | reencrypt + release | Sonnet | medio-alto |

**Orden:** `B0 → B1 → B2 → B3 → B4 → release único de Electron`

- **B0 antes que todo** — si los 4 "pantalla en blanco" (1-4) son una sola causa raíz, B1/B3 se simplifican.
- **B3 después de B1/B2** — los visores linkean al portal; si el destino cambia, los botones nuevos hay que retocarlos.
- **B3 y B4 comparten el release** de Electron — no cortarlo hasta tener los dos listos.

### Por qué cada asignación

**B0 — Sonnet/medio.** Los puntos 1-4 son todos "pantalla en blanco", probablemente **la misma causa raíz** (el visor arma `?goto=expediente` sin id del caso). Confirmar antes de diseñar 4 fixes para 1 bug. Incluye el punto 21. Es lectura + prueba dirigida, no requiere Opus.

**B1 — Opus/alto.** Único bloque con Opus: la pila de navegación y el reuso de pestaña tocan el shell del portal completo (~10 secciones), no solo Bitácora. Antecedente: el deep-link SSO ya se rompió una vez por un cambio en esa zona (`a71987b`, 2026-08-16). El punto 5 entra acá porque es comunicación entre dos contextos (`file://` ↔ pestaña del portal) — decisión de arquitectura.

**B2 — Sonnet/alto.** Mayor volumen de código nuevo, pero UI acotada al portal con patrones ya existentes (`openBitacoraModal`, `showConfirm`, la revisión de lote de F2.3). Sin decisiones arquitectónicas abiertas.

**B3 — Sonnet/alto.** Toca los 4 visores y consume el release. Alto por repetición en varios archivos (`visorModal_template.html` + `visor_informes_template.html` + post-procesado de `main.js`).

**B4 — Sonnet/medio-alto.** La carátula no existe en el modelo de datos del informe (`visor_informes_template.html:422-426`, comentado explícitamente). Probablemente exige tocar `informequickscwpjn.js` → editar + `reencrypt_scripts.js` + redeploy, sin release. Único bloque que toca el motor Puppeteer.

**Total estimado: 4-6 sesiones.**

---

## 2. Registro de ejecución

> Se completa a medida que avanza el trabajo. Cada bloque cerrado agrega su
> entrada acá con lo encontrado/corregido y el commit.

### B0 — Diagnóstico (Sonnet/medio) — ✅ CERRADO

**Puntos 1 y 4 ("carpeta amarilla" / "Ver ficha" → pantalla en blanco): causa raíz única, confirmada por lectura de código.**
Los 3 visores (`visorModal_template.html:645,694`, `visor_informes_template.html:446`,
`main.js:2454`) arman el link con `href="https://api.procuradortool.com/usuarios/?goto=expediente"`
— **sin el id ni la clave del caso**, y `'expediente'` **no es una sección válida**
(`navigateTo()` en `app.js:685-696` solo reconoce `perfil/plan/facturacion/soporte/
notificaciones/ia/ayuda/reactivacion/bitacora/mis-expedientes`). Como el `switch`
no matchea nada, ninguna sección se activa (`el.id === 'section-expediente'` no
existe) → el portal queda con **todas las secciones ocultas**, que es exactamente
el síntoma "pantalla en blanco". No hace falta ningún fix de UI acá: hay que
**pasar el id del caso** (la clave o el id de `expedientes_seguidos`) y navegar a
`mis-expedientes` con ese id preseleccionado (`openMexpFicha(id)` ya existe,
`app.js:3652`).

**Puntos 2 y 3 ("guardar caso"/"guardar procuración" → van al listado general, no a la ficha): causa raíz distinta, confirmada.**
`guardarFichasDesdeDraft()` (`app.js:4317`) termina llamando `refrescarTrasCaptura()`
(`app.js:4295`), que **solo re-lee datos de la sección donde el usuario ya estaba**
— nunca navega a ningún lado. Como el servidor siempre redirige al portal con
`?goto=bitacora&draft=...` (`capture.js` → `redirigir()`, que por diseño anti-open-
redirect **ignora cualquier `goto` que mande el cliente** y fuerza `'bitacora'`
salvo que el propio backend arme el redirect), el usuario arranca siempre en
Bitácora — y como nada navega después, se queda ahí viendo el listado general.
**Importante para B1:** el destino post-guardado no se puede resolver cambiando
lo que manda el visor (el endpoint anónimo nunca debe reflejar input del
cliente en el redirect, es una protección de seguridad deliberada, ver el
comentario de cabecera de `capture.js`). Tiene que resolverse **del lado
autenticado**, en el dispatcher que ya procesa el draft (`app.js` ~línea 4277),
agregando una navegación explícita a `mis-expedientes` + `openMexpFicha(id)`
usando el `expediente_id` que YA devuelve `perCaso` en la respuesta de
`/capture-lote` (confirmado en `bitacora.js:1088`, ya viaja en la respuesta,
no hace falta pedir nada nuevo al backend).

**Punto 21 (informes no se guardarían en Bitácora): NO es un bug de backend — reclasificado.**
Confirmado en la sesión anterior que el backend guarda bien el snapshot
`kind='informe'`. La explicación más probable, con el diagnóstico de arriba
ya en mano: el usuario ejecuta "Guardar informe" desde una pestaña nueva
(punto 16), aterriza en el listado general de Bitácora (mismo bug que 2/3,
no en la ficha específica), y con varias pestañas de Bitácora acumuladas el
toast de confirmación queda fuera de foco — parece que "no pasó nada" cuando
sí se guardó. **No se necesita fix de backend para el punto 21** — se resuelve
solo al arreglar 2/3/16.

**Consecuencia sobre el plan de bloques:** los puntos 1-4 y 21 no son 5
problemas — son **2 causas raíz** (routing roto por sección inexistente +
falta de navegación tras guardar), ambas del lado del portal autenticado.
Se resuelven junto con B1 (que ya toca navegación/pila de historial) en vez
de necesitar un bloque aparte — **B1 absorbe los fixes de 1, 2, 3, 4, 21**
además de 5, 16, 17.

---

### B1 — Navegación (Opus/alto) — ✅ CÓDIGO LISTO, sin desplegar

**Cubre 1, 2, 3, 4, 16, 17 y 21.** El punto 5 se movió a B3 (ver abajo).

**Archivos tocados:** `backend-server/routes/bitacora.js` (1 endpoint nuevo) ·
`backend-server/public/usuarios/app.js` · `backend-server/dev-tools/stub-portal.js`
(andamio de verificación, no producto). **Sin migración, sin release.**

**Puntos 1 y 4 — el diagnóstico de B0, confirmado en vivo antes de arreglar:**
`navigateTo('expediente')` corrido contra el portal real dejó **0 secciones
activas y 0 visibles** — la pantalla en blanco literal, reproducida. Fix en dos
mitades deliberadamente independientes:
- **Portal (esta sesión, llega sin release):** `?goto=expediente` deja de caer en
  `navigateTo()` y pasa por `abrirFichaPorNumero()`. **Sin `exp` aterriza en el
  listado de Mis Expedientes** — que es lo que mandan los clientes ya instalados
  (≤ v2.7.49), así que **el bug de pantalla en blanco se corrige para ellos hoy,
  sin esperar el release de B3**.
- **Visor (B3):** agregar `&exp=<numero>` al href para que abra la ficha exacta.

**Endpoint nuevo `GET /usuarios/api/expedientes/by-key?exp=`.** Resuelve número →
ficha. **Por qué el servidor y no el portal:** la normalización canónica
(`expedienteKey`) ya vive duplicada a propósito en 2 codebases con un fixture
compartido como red contra la deriva; hacerla en el navegador sería una 3ª copia
sin test, y su modo de falla es silencioso ("ese caso no está en tu Bitácora"
para uno que sí está). Verificado que resuelve **`FCR 018745/2017` (con padding,
como lo devuelve el PJN) contra la ficha guardada como `FCR 18745/2017`** — o sea
que usa la normalización real, no un match de string.

**Puntos 2 y 3 — destino después de guardar.** `refrescarTrasCaptura()` solo
repintaba la sección donde el usuario ya estaba; nunca navegaba. **El destino no
se puede pedir desde el visor:** `/usuarios/capture` construye el redirect
íntegramente del lado del servidor a propósito (anti open-redirect, ver cabecera
de `routes/capture.js`), así que se decide del lado autenticado con el
`expediente_id` que **ya venía** en `perCaso` — sin pedir nada nuevo al backend.
1 caso → su ficha; varios → el listado.

**Punto 16 — pestañas.** Causa raíz: **dos caminos, ninguno reusa pestaña.**
`shell.openExternal()` (botones de la app) entrega la URL al navegador del SO y
**siempre** abre una nueva; `target="procurador_portal"` (visores) solo reusa
dentro del mismo browsing context group, y cada visor es un `file://` distinto.
El único punto donde convergen es el portal → el fix vive ahí.
Mecanismo: `BroadcastChannel`, cada pestaña se anuncia al cargar y las anteriores
se cierran solas. Gana la más nueva porque es la que tiene el foco (traer una de
fondo al frente lo bloquean los navegadores).
**⚠️ Verificado en Chromium antes de diseñarlo, no asumido:** `window.close()`
funciona si la pestaña la abrió un script **o si su historial tiene UNA sola
entrada** — probado en ambas direcciones (len 1 → cerró; len 2 → no). De ahí sale
la protección sola: una pestaña recién abierta e intacta se cierra; una en la que
el usuario ya navegó acumuló `pushState` y el navegador la protege.

**Punto 17 — historial.** La ficha de un expediente no era una entrada de
historial, así que Atrás salía de la sección entera. Ahora `openMexpFicha()`
apila `{_sec, _ficha}` y `popstate` lo restaura. Un **repintado** de la ficha ya
abierta (tildar/editar una entrada) no apila — sin esa distinción habría que
apretar Atrás N veces para salir.

**Punto 21 — cerrado, no era bug de backend.** Verificado que un guardado con
`origen:'informe'` adjunta el snapshot con `kind:'informe'`. Era un problema de
visibilidad: el usuario aterrizaba en el listado general (bug 2/3) con pestañas
acumuladas (bug 16), y no veía la confirmación. Se resuelve con los otros fixes.

**Verificación (stub + Playwright, `node --check` en los 3 archivos):**
- `?goto=expediente&exp=FCR 018745/2017` → abre la ficha correcta (`fichaId:1`,
  encabezado real), historial `{_sec:'mis-expedientes',_ficha:1}`.
- `?goto=expediente` sin `exp` → listado, 1 fila. **No** pantalla en blanco.
- Pila completa: plan → bitacora → mis-expedientes → ficha, y 3 Atrás recorren
  exactamente el camino inverso (ficha → listado → bitacora → plan).
- Anti-ruido del historial: abrir = +1, **3 repintados = +0**, reabrir la misma
  ficha = +0 (replace, para que Atrás no parezca "no hacer nada").
- Guardar 1 caso (`FCR 9078/2021`, el del reporte original) → aterriza en **su
  ficha**; lote de 2 → aterriza en el listado.
- Pestañas: con 5 aperturas seguidas el total se estabiliza en 2 — la que tenía
  trabajo real (historial 16, ficha abierta) **sobrevivió**, las ociosas se
  cerraron. Una ociosa **con un modal abierto también sobrevivió** (guard).

**Desplegado y verificado en producción (2026-08-26).** Backup previo en ambos
entornos (`/tmp/bitacora.js.pre-B1nav-*`, `/tmp/app.js.pre-B1nav-*`). Staging
primero (401 sin token en `by-key`, sin regresión en `plans`/`subscription/current`,
sin usuario de prueba con Bitácora habilitada disponible para un E2E completo —
la lógica es la misma query/`expedienteKey` ya probada en el resto del router).
Prod: md5 servido = md5 local en los 2 archivos, `pm2-api` reinició sin loop
(`↺` 744→745), health/usuarios/dashboard/landing 200, `by-key` 401 sin token,
`pm2-error.log` sin entradas nuevas (la única reciente es del 2026-08-15,
`PayloadTooLargeError` ya documentado como preexistente).

---

### B2 — Modal unificado de entradas (Sonnet/alto) — ✅ CÓDIGO LISTO, sin desplegar

**Cubre 11, 12, 14, 15.** Archivos: `index.html`, `app.js`, `app.css`
(`backend-server/public/usuarios/`) + `routes/capture.js` (1 línea). **Sin
migración, sin release.**

**Punto 11 — causa raíz real, no una impresión.** Confirmado leyendo el CSS: el
estilo de inputs de la app está scopeado a `.form-group input` (`app.css:492`);
la pantalla de revisión del lote (`#modal-bitacora-lote`, F2.3) renderizaba sus
campos como `<input class="lote-titulo">`/`<input class="lote-fecha">` **fuera**
de cualquier `.form-group` — inputs 100% sin estilo, browser default, dentro de
un modal por lo demás con el sistema de diseño de la app. No era una cuestión
de "se ve raro", es que la regla de CSS literalmente no los alcanzaba.

**Puntos 12 y 14 se resuelven juntos con un wizard de 2 pantallas** que
reemplaza esa pantalla de revisión:
1. **Selector de tipo por botones** (Vencimiento/Audiencia/Tarea/Nota) — la
   pantalla nueva del wizard. Reemplaza el `prompt()` nativo del visor, pero
   **el prompt en sí sigue vivo hoy** (vive en `visorModal_template.html` /
   `visor_informes_template.html`, Electron, requiere release → es tarea de
   B3). Para no bloquear B2 en eso, el wizard soporta los dos casos: si el
   draft ya trae un `tipo` (como manda el visor de HOY), salta directo al
   paso 2; si no lo trae (lo que hará el visor una vez B3 elimine el prompt),
   muestra los botones primero. **Backend:** `capture.js` ya no exige `tipo`
   para `entrada-lote` (solo para `entrada`, la acción individual que sí nace
   de un botón que ya sabe su tipo) — 1 línea, para que el camino sin-tipo sea
   válido cuando corresponda.
2. **Paso por caso** (Anterior · Descartar · Guardar/Actualizar · Siguiente):
   header con expediente/carátula/dependencia/situación/última actividad
   (punto 12) + los mismos campos que el modal individual, incluida la
   calculadora de plazo para `vencimiento`. Guardar/Descartar son decisiones
   explícitas por caso, no atadas a la navegación — Anterior/Siguiente se
   puede usar libremente sin crear ni perder nada; los valores editados de
   cada caso quedan en memoria mientras se navega.

**Se agregó el campo "Repetir"** (semanal/mensual/anual) a ambos modales — el
backend ya validaba `repeat_rule` desde F1.2 pero **ningún formulario lo
exponía**; el "algo más según el tipo" del punto 12 apuntaba a esto. Bug de
signo encontrado al cablearlo: el backend rechaza cualquier `repeat_rule` que
no sea `undefined`/`null`/uno de `REPEAT_RULES` — un string vacío (`''`, lo
que manda un `<select>` en su opción por defecto) **no pasa ese chequeo**;
hay que convertirlo a `null` explícito antes de enviarlo.

**El header de contexto (`#bit-caso-header`) también quedó en el modal
individual**, no solo en el wizard — se generalizó: aparece cuando la entrada
tiene un caso vinculado (preset desde una ficha, desde la captura, o elegido a
mano en el `<select>` de expediente), resuelto contra `state.bitacora.expedientes`
(ya poblado siempre antes de abrir el modal) — sin pedir nada nuevo al backend.

**Verificado con el stub del portal y Playwright:**
- Modal individual: header completo (expediente/carátula/dependencia/
  situación/última actividad), `kind`/`title`/`description` precargados desde
  el caso capturado, bloque de plazo visible solo para `vencimiento`, opciones
  de "Repetir" presentes.
- Guardado con `repeat_rule='monthly'` → confirmado en la entrada creada
  (`GET /usuarios/api/bitacora`).
- Editar una entrada con `repeat_rule` guardado → el `<select>` la precarga.
- Wizard con `tipo` preseteado (como manda el visor de hoy): salta el selector,
  título default se arma del primer movimiento del caso.
- Guardar caso 1 → botón pasa a "Actualizar", banner "✓ Se creó una entrada",
  "Descartar" se deshabilita. Siguiente → caso 2 sin movimientos usa el título
  default genérico. Descartar caso 2 → banner de descarte, footer cambia a
  "Finalizar". Anterior → caso 1 conserva los valores editados intactos.
  Finalizar → **1 sola entrada creada** (el descarte no generó nada), con
  `expediente_id` verificado igual al id real de la ficha del caso 1.
- Wizard sin `tipo`: selector de 4 botones, elegir "Vencimiento" muestra el
  bloque de plazo; la calculadora reusada (`calcularPlazoBitacora` con ids
  parametrizados) da el mismo resultado en el wizard que en el modal
  individual (10 días hábiles desde 14/08 → 31/08 en ambos).
- Bug encontrado y corregido en el camino: el texto del selector de tipo decía
  "1 caso seleccionados" (concordancia rota) — corregido a singular/plural.
- 0 errores de consola nuevos.

**Desplegado y verificado en producción (2026-08-26).** Backup previo en ambos
entornos (`/tmp/*.pre-B2-*`). Staging: reinició sin loop (`↺`111→112), la
relajación de `capture.js` probada en las dos direcciones —
`accion=entrada-lote` sin `tipo` → `303` con `draft=...` (aceptado);
`accion=entrada` sin `tipo` → `303` con `captura=error` (sigue rechazando,
como debe) — sin regresión en `plans`/`by-key`. Prod: md5 servido = md5 local
en los 4 archivos, PM2 `↺`745→746 sin loop, health/usuarios/dashboard/landing
200, la misma prueba de `capture.js` repetida con el mismo resultado,
`pm2-error.log` sin cambios de tamaño/fecha desde el 15/08 (sin entradas
nuevas).

---

### B3 — Visores (Sonnet/alto) — ✅ CÓDIGO LISTO, sin release

**Cubre 5, 6, 7, 8, 9, 10, 13, 18** + los 2 pendientes que B1/B2 dejaron
anotados (href `&exp=` y sacar el `prompt()`). Archivos: `visorModal_template.html`
(procuración), `informe/visor_informes_template.html` (informe), `main.js`
(2 líneas de paridad en el visor del Monitor — no incluido en los 21 puntos
originales, ver nota más abajo). **Requiere release de Electron** — es el único
bloque que lo necesita; no desplegado todavía a propósito (ver B4).

**Puntos 8/10 — dos columnas, con una regla que cambia el punto 10 respecto de
la lectura literal inicial:** columna 1 = ícono de estado individual (💾 si no
está guardado, clic = guarda al toque; 📁 si ya está, link a la ficha). Columna
2 = checkbox de selección múltiple, **ahora SIEMPRE presente** — antes
desaparecía en cuanto el caso quedaba guardado, así que un caso ya seguido no
se podía incluir en una acción masiva (ej. re-capturar su procuración). Punto
10 en su lectura literal ("guardar caso" exclusivo de los no guardados) se
aplicó al **menú del modal**, no al checkbox de la tabla — un caso guardado
puede tildarse para "Guardar procuración"/"Crear entradas" en lote sin problema.

**Puntos 6/10 en el modal:** los 5 botones (venc/tarea/nota/proc/caso) pasan a
mostrarse para TODOS los casos salvo "📌 Guardar caso" (redundante si el caso
ya existe) — y si ya está guardado, se agrega el link "📁 Ver ficha" arriba de
los botones, no en su lugar. Guardar/crear entrada desde el modal marca el
caso como guardado y **refresca el modal en el lugar** (no lo cierra) — pasa
de 5 a 4 botones + aparece el link, verificado en vivo.

**Punto 9:** el número de expediente es ahora un `<a>` cuando el caso está
seguido (mismo destino que el ícono de columna 1) — antes era texto plano
siempre.

**Punto 13:** el footer del modal pasó de `[Anterior][Siguiente] ····· [N de M]`
(un solo grupo a la izquierda + contador a la derecha) a 3 hijos directos del
flex `space-between`: `[Anterior] ····· [N de M] ····· [Siguiente]`.

**Punto 18 (alcance del bloque en Informe):** el visor de informe **no tiene
modal de detalle** (cada fila abre su PDF directo) — así que ahí solo aplican
los puntos con equivalente real: 8 (dos columnas), 9 (link), 5 (optimista) y
sacar el `prompt()`. Los puntos 6/10/13 no tienen contraparte en Informe
(dependen de un modal que ese visor nunca tuvo) — no es un recorte, es que no
hay nada que arreglar ahí.

**Punto 5 (movido de B1) — mecanismo confirmado, no solo diseñado:** el visor
es `file://`, el portal `https://` — no comparten `localStorage` ni
`BroadcastChannel`, y el POST de captura nunca vuelve una respuesta a este
documento (otra pestaña, otro origen). **Actualización optimista**: el click
agrega la clave a `seguidosSet` en memoria y repinta — la tabla completa
siempre, y el modal también si está abierto sobre ese mismo caso. Es
deliberadamente optimista (si el guardado real falla, el error queda en la
pestaña del portal, el visor no se entera) — mejor que el estado anterior,
donde la fila jamás se actualizaba ni siquiera cuando el guardado SÍ funcionaba.

**El `&exp=<numero>` en los 4 hrefs (`main.js:2454`, `visorModal_template.html`
×2, `visor_informes_template.html:446`)** ya estaba anotado como pendiente de
B1 — hecho acá. Sin él, el endpoint nuevo de B1 (`GET .../expedientes/by-key`)
nunca recibía el número a resolver.

**El `prompt()` de "＋ Crear entradas…" eliminado en los 3 sitios** (los 2
templates + el visor del Monitor en `main.js`, agregado por consistencia — no
estaba en los 21 puntos pero es el mismo bug de 1 línea, con la misma
infraestructura de B2 ya lista para recibirlo). `accionLote('entrada-lote', null)`
directo; el selector de tipo por botones (punto 14) ya vive en el portal.

**Monitor — alcance explícitamente NO ampliado:** el visor del Monitor
(`generarVisorMonitoreo` en `main.js`) recibió solo los 2 fixes de paridad de
arriba (href + prompt). El rediseño de columnas/modal de los puntos 6-13 **no**
se aplicó ahí — nunca se probó ni se reportó como problema en la sesión
original (los 21 puntos hablan de "el visor" y de "informe" explícitamente,
nunca de Monitor), y su estructura es distinta (acordeón de tarjetas por
parte, no una tabla+modal). Ampliar el alcance sin que nadie lo haya pedido
ni probado habría sido la clase de scope creep que este plan viene evitando
bloque a bloque.

**Verificado con un arnés standalone servido por HTTP** (no `file://`: Playwright
lo bloquea) **contra los 2 templates reales**, con datos sintéticos representativos
(un caso ya seguido, uno nuevo, uno fallido):
- Header de 2 columnas confirmado en ambos archivos: 📁+link en el caso
  seguido, 💾+checkbox en los no seguidos.
- Clic en 💾 (columna 1) → la fila se repinta a 📁 sin recargar, el número de
  expediente pasa a link — sin esperar respuesta del servidor (confirma el
  diseño optimista).
- Modal: caso no guardado → 5 botones, sin link de ficha; "Guardar procuración"
  → el modal se refresca EN EL LUGAR (sigue abierto) → 4 botones + link de
  ficha aparece.
- Footer del modal: `Anterior | 3 de 3 | Siguiente` — orden confirmado.
- Checkbox de selección múltiple sigue funcionando sobre casos YA guardados
  (el punto que este bloque tenía que garantizar para el punto 10) — la barra
  de acciones masivas se activa igual.
- `prompt()` interceptado y confirmado que **no se dispara** al clickear "＋
  Crear entradas…" en ninguno de los 2 templates.
- 0 errores de consola nuevos en ambos.
- **Hallazgo del propio arnés de prueba, no del producto:** el primer intento
  de armar los datos de prueba usó `str.replace()` de Python (reemplaza TODAS
  las ocurrencias) sobre el marcador `<!-- BITACORA_RUNTIME -->`, que también
  aparece una segunda vez dentro de un comentario de código que lo describe —
  el reemplazo global inyectó un `</script>` literal ahí adentro y el parser
  HTML cortó el `<script>` real a la mitad, dejando toda la lógica de Bitácora
  sin ejecutar (sin ningún error de consola, porque no es un error de JS, es
  el HTML nunca llegando a ejecutarse). **Se verificó que el mecanismo real en
  `main.js` no tiene este problema**: usa `html.replace(marcador, script)` de
  JavaScript, que reemplaza solo la primera coincidencia — confirmado leyendo
  el código antes de descartar la hipótesis de bug real. Corregido el arnés
  (reemplazo acotado a la primera ocurrencia) y repetida la verificación.
- `node --check` sobre los 3 archivos (`main.js` completo + los 2 `<script>`
  extraídos de los templates).

**Pendiente de B3:** no se despliega solo — comparte el release de Electron
con B4 (ver abajo). Falta B4 antes de cortarlo.

### B4 — Carátula en Informe (Sonnet/medio-alto) — PENDIENTE
