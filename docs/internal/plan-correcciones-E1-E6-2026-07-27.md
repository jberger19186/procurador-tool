# Plan de implementación — correcciones de los hallazgos E1-E6 + extensión

> **Qué es esto.** El plan de ejecución de los ~35 hallazgos documentados en los 6 informes de
> revisión (`revision-E1-2026-07-27.md` … `revision-E6-2026-07-27.md`), más 2 de los 3 pendientes
> acumulados de la extensión Chrome (el tercero, jurisdicción en Notificaciones, se descartó el
> 2026-07-27 — el operador confirmó que ya no era un problema).
>
> **Principio de organización: un bloque = un despliegue.** Los bloques NO están agrupados por
> severidad sino por **vector de despliegue**, porque eso es lo que realmente determina el trabajo
> y el riesgo: un fix de backend es `scp` + `pm2 restart`; uno de scripts encriptados necesita
> `reencrypt_scripts.js`; uno de Electron necesita un release completo con bump de versión en 5
> lugares; uno de la extensión necesita un ciclo de revisión de Google. Mezclarlos multiplica los
> despliegues sin ganar nada.
>
> **Elaborado con:** Opus 5, 2026-07-27. **Estado:** ✅ **plan completo en código y desplegado
> (2026-07-28)** — los 5 bloques (A, B, C.1+C.2, D, E-código) ejecutados. Ver los recuadros en
> §2, §3, §4, §5 y §6. **Q1, Q2, Q3, Q4 y Q5 resueltas** (ver §7); quedan **Q6, Q7** (no
> bloquean nada). **Lo único que sigue pendiente es operativo, no de código:** verificación
> funcional real contra el PJN (Bloque C + E2-8), la extensión en revisión de Google, y el
> click del logo confirmado en Chrome real.

---

## 1. Resumen de bloques

| # | Bloque | Vector de despliegue | Hallazgos | Modelo/esfuerzo | Orden sugerido |
|---|---|---|---|---|---|
| ✅ **A** | Backend + dashboard | `scp` + `pm2 restart` · sin release | E5-1(P-1), E3-1, E3-2, E6-1, E6-2 | Sonnet MEDIO (A.3 en **Opus**) | **HECHO 28/07** |
| ✅ **B** | Base de datos | Migración additiva + regenerar snapshot | E5-2, E3-4 | Sonnet BAJO-MEDIO | **HECHO 28/07** |
| ✅ **C** | Motor de automatización | Editar + `reencrypt_scripts.js` + `pm2 restart` · **sin release de Electron** | E1-1…E1-12, E4-2 | Sonnet ALTO | **C.1 y C.2 HECHOS 28/07** · falta verificación real |
| ✅ **D** | App Electron | Release completo (bump + tag + 5 lugares de versión) | E4-1(P-2), E2-1, E2-3…E2-9, E4-3 | Sonnet MEDIO-ALTO | **HECHO 28/07 · v2.7.44** |
| ✅ **E** | Extensión Chrome | Bump manifest + ZIP + revisión de Google | Logo (2 estados, SSO decidido), `checkExtensionVersion()` — *(el ítem de `cs-notif.js` se descartó, ya no era un problema)* | Sonnet MEDIO-BAJO | **CÓDIGO 28/07** · falta subir ZIP |
| **F** | Decisiones pendientes | — | E2-2, E3-3, E3-5, E1-7 | — | Tras §7 |

**Sobre el orden:** A→B→C→D es de menor a mayor costo de despliegue y de menor a mayor riesgo. **El
bloque E conviene arrancarlo en paralelo desde el día 1**, no porque sea urgente sino porque es el
único que depende de un tercero (el ciclo de revisión de Google, que en el mejor caso fue el mismo
día pero no está garantizado). Si se sube temprano, la aprobación llega mientras se trabaja en el
resto.

**Regla de modelo (heredada del plan de revisión):** Sonnet 5 en todos los bloques. **Escalar a
Opus solo si un hallazgo puntual toca cobro real o movimiento de dinero**, avisando al operador
antes de cambiar de modelo. En este plan eso aplica a **E3-2** (toca `scheduled_plan`, que es
cambio de plan facturado) — ver la nota en el Bloque A.

---

## 2. Bloque A — Backend + dashboard (sin release)

> ## ✅ EJECUTADO Y EN PRODUCCIÓN — 2026-07-28 (commit `03e294d`)
>
> Los 4 ítems (A.1, A.2, A.3, A.4) están desplegados y verificados. Resumen de lo que
> **difirió del plan escrito**, para que quede registrado:
>
> - **A.3 tocó 6 puntos de suspensión, no 1.** El plan apuntaba a
>   `services/subscriptionService.js`, pero al mapear los puntos reales de suspensión resultó
>   que ese archivo **no suspende** (programa `cancel_at`). Las escrituras que sí suspenden
>   están en `server.js` (crons 5c/5f/5h) y `routes/admin.js` (suspensión manual, reset a
>   trial, `POST /subscriptions/:id/suspend`). Se aplicó en los 6 + al pasar a `cancelled`.
> - **A.2 incluyó una mejora no planeada pero pedida por el propio hallazgo E3-1:** los logs
>   de resumen pasaron de `${rowCount}` a `${procesados}/${total}`. La prueba lo dejó a la
>   vista — con 1 fallo de 3, el log seguía diciendo "3 usuarios suspendidos". E3-1 señalaba
>   textualmente que no había forma de saber "cuántos ni cuáles quedaron sin tocar".
> - **A.1 filtró 6 scripts, no 5.** Además de los 5 de operación que P-1 identificaba, quedó
>   fuera `validarCampoParteScwpjn.js` — verificado que es un script de prueba standalone
>   (`node validarCampoParteScwpjn.js`, escribe un JSON local), con **cero referencias** desde
>   el cliente Electron o desde otros scripts. La exclusión es correcta.
> - **Q3 respondida por el operador:** opción 1 — el downgrade programado se **cancela** al
>   suspender. Si se sigue queriendo, se re-programa.
> - **Sin datos legados que limpiar:** 0 filas con `scheduled_plan` en producción al momento
>   del fix.
>
> **Verificación ejecutada** (staging con 4 fixtures + fallo inyectado, luego prod):
> A.1 → 19 scripts en la DB, 13 servidos, operación 404, legítimos 200 · A.2 → el usuario que
> falla queda logueado por `user_id` y los siguientes **sí** se procesan · A.3 → `scheduled_plan`
> NULL al suspender, y al reactivar la cuenta el downgrade **no revive**; regresión OK (un
> downgrade en cuenta nunca suspendida se sigue aplicando) · A.4 → ficha real en el dashboard de
> prod: CUIT renderiza y el input precarga sin cambios. Smoke oficial de prod **8/8**.
> Fixtures borrados sin residuo; parche de prueba removido de staging.
>
> ✅ **Paso 4 de A.1 confirmado por el operador (2026-07-28):** corrió una Procuración real desde
> la app Electron contra la whitelist ya desplegada — funcionó bien. **El Bloque A queda 100%
> cerrado, sin pendientes.**

**Vector:** `scp` de los archivos + `pm2 restart procurador-api`. El dashboard es estático servido
por Express, va en el mismo deploy. **Sin release de Electron, sin tocar la extensión.**

### A.1 — E5-1 (P-1): whitelist de scripts distribuibles
**Severidad:** 🔵 Bajo-Medio · **Archivo:** `backend-server/routes/client.js` (2 endpoints)

Agregar una constante con los 13 scripts que el cliente realmente ejecuta y filtrar por ella en
`/scripts/download/:scriptName` (tras normalizar el nombre, línea ~174) y en `/scripts/available`
(al armar el listado, línea ~259). La lista **ya existe** en `electron-app/src/auth/authManager.js`
(el mapa `dependencies` + los scripts principales) — se espeja, no se inventa:

```js
const SCRIPTS_DISTRIBUIBLES = new Set([
  'testM1.js', 'testM2.js', 'consultarscwpjn.js', 'listarSCWPJN.js',
  'procesarNovedadesCompleto.js', 'procesarCustomExpedientes.js',
  'informequickscwpjn.js', 'procesarMonitoreo.js', 'sessionManager.js',
  'errorHandler.js', 'cerrarNavegador.js', 'monitoreo.js', 'buscarPorParteScwpjn.js',
]);
```

**Verificación:**
1. En staging, con un token de usuario real: `GET /client/scripts/available` → devuelve **13**
   scripts, ya no 19.
2. `GET /client/scripts/download/backup-db.js` → **404** (antes: 200 con el contenido descifrado).
3. `GET /client/scripts/download/testM2.js` → **200** con contenido (no romper el flujo real).
4. **Prueba de no-regresión obligatoria:** abrir la app Electron real contra staging y correr una
   Procuración completa — si falta un script en la whitelist, el flujo falla. Esta es la
   verificación que importa; las 3 anteriores son de escritorio.

### A.2 — E3-1: try/catch por iteración en los 7 crons
**Severidad:** 🟡 Medio-Alto · **Archivo:** `backend-server/server.js` (crons 5a, 5b, 5c, 5d, 5f, 5g, 5h)

Envolver el cuerpo de cada `for (const u of ...)` en su propio `try/catch` que loguee el `user_id`
afectado y continúe con el siguiente, en vez de dejar que la excepción aborte el batch del día.

**Verificación:**
1. En staging, insertar deliberadamente una fila que rompa una iteración (ej. un `scheduled_plan`
   apuntando a un `plan_id` inexistente para el cron 5g), con **2 usuarios más después** en el
   mismo batch.
2. Forzar la corrida del cron (el proyecto ya tiene el patrón documentado de forzar crons en
   staging, usado en la validación de la Fase 2 de vigencia de planes).
3. **Esperado:** el log muestra el error del usuario problemático **con su `user_id`**, y los 2
   usuarios siguientes **sí se procesan** (verificar por SQL que su estado cambió). Antes del fix,
   los 2 quedaban sin tocar.
4. Restaurar staging al estado previo.

### A.3 — ⚠️ E3-2: limpiar `scheduled_plan` al suspender/reactivar
**Severidad:** 🟡 Medio · **Archivo (según el plan):** `backend-server/services/subscriptionService.js`
→ **archivos reales:** `server.js` (crons 5c/5f/5h) + `routes/admin.js` (3 caminos). Ver el recuadro
de arriba: `subscriptionService.js` no suspende, sólo programa `cancel_at`.

⚠️ **Este ítem toca la lógica de cambio de plan facturado.** Según la regla del plan de revisión,
**avisar al operador y considerar escalar a Opus para este ítem puntual.** ✅ Hecho: el operador
optó por escalar a Opus y se implementó en ese modelo. **Q3 respondida: opción 1** — se cancela el
downgrade al suspender.

**Verificación (una vez definida la semántica):**
1. Staging: programar un downgrade con `apply_at` a futuro → suspender la cuenta → esperar a que
   `apply_at` venza → reactivar la cuenta.
2. **Esperado:** el downgrade **no** se aplica automáticamente en la corrida siguiente del cron 5g
   (comportamiento actual: sí se aplicaba, sin aviso).
3. Regresión: un downgrade programado en una cuenta que **nunca** se suspende debe seguir
   aplicándose normalmente en su `apply_at`.

### A.4 — E6-1 / E6-2: escapes faltantes en el dashboard
**Severidad:** 🔵 Bajo (ninguno explotable hoy) · **Archivo:** `backend-server/public/dashboard/dashboard.js`

Envolver con los helpers ya existentes en el archivo: `escHtml(u.cuit)` en línea ~490,
`escAttr(u.cuit)` en el `value=""` de la línea ~504, y `escHtml(a.reason)` en la línea ~2826.

**Verificación:** cargar la ficha de un usuario con CUIT en el dashboard de staging y confirmar que
el CUIT se sigue mostrando correctamente y el input se precarga bien (es un fix de defensa en
profundidad — la verificación es de no-regresión visual, no de explotación).

**Modelo/esfuerzo del bloque A:** Sonnet **MEDIO** (A.3 puede requerir Opus, ver arriba).
**Despliegue:** backup de DB → staging → verificar los 4 ítems → backup de prod → prod → smoke.

---

## 3. Bloque B — Base de datos

> ## ✅ EJECUTADO Y EN PRODUCCIÓN — 2026-07-28
>
> Los 2 ítems (B.1, B.2) están hechos y verificados, más la mejora de Q5.
>
> - **B.1:** `database/schema.sql` regenerado — **27** tablas (antes 21), **0** referencias a
>   `check_plan_valid` (antes 1), **32** referencias a las columnas/tablas nuevas. Prueba real de
>   reconstrucción: cargado en una DB descartable (`procurador_db_schematest`) y comparado
>   **tabla por tabla y columna por columna** contra `procurador_db` real — **idénticos**. DB de
>   prueba borrada al terminar. Agregado `database/migrations/README.md` documentando el drift de
>   migraciones sin archivo versionado (mayo-julio 2026) y dejando `schema.sql` como fuente de
>   verdad — no se recrearon esos `.sql` retroactivamente, sería fantasma.
> - **Q5 implementada** (no solo documentada): `backend-server/scripts/backup-db.js` ahora
>   regenera `schema.sql` en cada corrida del cron de las 03:00 — solo cuando corre contra
>   `procurador_db` (prod), escribe la copia local en el servidor **y** sube
>   `backups/schema-latest.sql` a DO Spaces (sobrescrito cada vez, no acumula versiones). Probado
>   en producción real: el archivo generado por el script coincide con el regenerado a mano salvo
>   el token aleatorio `\restrict`/`\unrestrict` que `pg_dump` cambia en cada corrida (contenido
>   idéntico, verificado por diff). Confirmado subido a Spaces (`HeadObjectCommand`, tamaño 79.630
>   bytes). **Aprendizaje del camino:** el primer intento de "probarlo en staging" en realidad
>   corrió contra **prod** — la `.env` base de staging tiene `DB_NAME=procurador_db` (solo
>   `.env.staging`, que `backup-db.js` no lee, lo sobreescribe); sin riesgo real (el paso nuevo
>   solo lee y escribe archivos, no toca datos), pero corregido: el archivo de staging se
>   restauró a su versión original (no hay cron que lo use ahí — el único cron de backup apunta al
>   path de prod) y la prueba real se hizo directamente contra el path de producción.
> - **B.2:** 4 índices parciales creados con `CONCURRENTLY` en staging y prod
>   (`idx_sub_plan_expiry`, `idx_sub_cancel_at`, `idx_sub_payment_grace_ends_at`,
>   `idx_sub_next_billing_date`). Verificado con `EXPLAIN`: sin forzar, el planificador elige
>   `Seq Scan` (correcto con el volumen actual, ~3 filas); con `SET enable_seqscan = off`, las 4
>   queries reales de los crons usan `Index Scan` sobre el índice correspondiente — confirma que
>   existen y son usables para cuando el volumen crezca (B3).
> - Backups previos en ambos entornos antes de cualquier cambio de DB. Smoke final en prod:
>   health/API pública/landing en 200, 27 tablas.

**Vector:** una migración additiva + regeneración de un archivo versionado. **Sin tocar código de
aplicación.**

### B.1 — E5-2: regenerar `database/schema.sql`
**Severidad:** 🟠 Alto (higiene/disaster recovery, no afecta producción hoy)

El archivo tiene ~2 meses de drift: 21 de las 27 tablas reales, `check_plan_valid` presente pese a
estar eliminada en producción, y sin `payments`/`invoices`/`commercial_benefits`.

```bash
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
  "sudo -u postgres pg_dump --schema-only procurador_db" > database/schema.sql
```
(procedimiento ya documentado en CLAUDE.md → "Backup de schema DB solamente")

**Además — la parte que evita que vuelva a pasar:** agregar la regeneración del snapshot al
checklist de cualquier sesión que aplique una migración, **o** (más robusto, recomendado)
incorporarla al script de backup diario que ya corre en el servidor a las 03:00, de modo que el
snapshot se mantenga solo. Ver **Q5 en §7**.

**Sobre las 6+ migraciones sin archivo versionado:** no tiene sentido "recrearlas" retroactivamente
(ya están aplicadas en prod y el snapshot regenerado las refleja). Lo que sí conviene es dejar una
nota en `database/migrations/README` o similar aclarando que el snapshot es la fuente de verdad y
que el directorio de migraciones es incompleto para el período mayo-julio 2026.

**Verificación:**
1. `grep -c '^CREATE TABLE public\.' database/schema.sql` → **27** (antes: 21).
2. `grep -c 'check_plan_valid' database/schema.sql` → **0** (antes: 1).
3. `grep -c 'admin_created\|commercial_benefits\|checkout_initiated_at' database/schema.sql` → >0.
4. **Prueba real de reconstrucción (la que de verdad valida el fix):** crear una base descartable
   en el servidor, cargarle el `schema.sql` regenerado, y comparar su lista de tablas/columnas
   contra `procurador_db` con una query de `information_schema`. Debe coincidir. Borrar la base de
   prueba al terminar.

### B.2 — E3-4: índices sobre las columnas de fecha de los crons
**Severidad:** 🔵 Bajo-Medio (invisible hoy, relevante post-B3)

Migración additiva con 4 índices parciales:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sub_plan_expiry
  ON subscriptions (plan_expiry_date) WHERE plan_expiry_date IS NOT NULL;
-- ídem para cancel_at, payment_grace_ends_at, next_billing_date
```
`CONCURRENTLY` para no bloquear la tabla (irrelevante con 3 filas, pero es la práctica correcta y
no cuesta nada adoptarla ahora).

**Verificación:** `EXPLAIN` de la query real de uno de los crons (ej. el de 5c) antes y después →
debe pasar de `Seq Scan` a `Index Scan` / `Bitmap Index Scan`. Con 3 filas el planificador puede
seguir eligiendo `Seq Scan` por costo (es lo correcto a ese volumen) — en ese caso, validar con
`SET enable_seqscan = off;` que el índice **existe y es usable**, que es lo que se está
verificando.

**Modelo/esfuerzo del bloque B:** Sonnet **BAJO-MEDIO**. Mecánico, pero toca la DB → backup previo
obligatorio, staging antes que prod.

---

## 4. Bloque C — Motor de automatización Puppeteer

> ## ✅ C.1 Y C.2 EJECUTADOS Y EN PRODUCCIÓN — 2026-07-28
>
> Los 5 ítems de C.1 y los 8 de C.2 están implementados, verificados por escritorio y
> desplegados en producción. **Todo el Bloque C está en código** — solo falta la verificación
> funcional real contra el PJN (ver §8), que necesita al operador.
>
> ### C.2 — lo que se hizo
>
> - **E1-7 (Q4 investigada y resuelta):** se verificó en `routes/license.js` que el candado
>   server-side (`active_executions`, `ON CONFLICT (user_id)`) es por **cuenta**, no por
>   **máquina** — dos CUITs distintos en la misma PC obtienen filas separadas, sin chocar entre
>   sí. Esto confirma que **el escenario de E1-7 es real** (no lo prevenía nada más). Se movieron
>   los 4 archivos de control a `PROCURADOR_DATA_DIR`: `execution.lock` (`consultarscwpjn.js`,
>   `listarSCWPJN.js`), `pid_quickscw.txt`/`stop_quickscw.flag` (`informequickscwpjn.js`),
>   `backup_exp_*.json`/`estado_secciones.json`/`acumulador_resultados.json` (`listarSCWPJN.js`),
>   `<identificador>.txt` (`testM1.guardarListaExpedientes`). Los `config_*.json` se dejaron
>   deliberadamente en `__dirname` — son el contrato de `main.js` con el proceso hijo, no datos
>   de usuario.
> - **E1-5:** `monitoreo.js` reescrito — el log vive ahora en
>   `PROCURADOR_DATA_DIR/logs/monitoring.log` (aislado por cuenta), con rotación por tamaño
>   (5 MB, se renombra a `.old` al iniciar una sesión de monitoreo si lo excede) y
>   `fs.appendFileSync` envuelto en try/catch silencioso.
> - **E4-2:** helper `sanitizeExcelCell()` en `procesarNovedadesCompleto.js` — antepone `'` a
>   los 4 campos de texto libre del PJN (`tipo`, `detalle`, `oficina`, `caratula`) en la hoja
>   "Movimientos" si empiezan con `=`, `+`, `-`, `@`. **✅ Corregido también en la hoja
>   "Expedientes" (2026-07-28, mismo día):** `caratula`/`dependencia`/`situacion` de esa hoja
>   repetían la misma clase de texto libre del PJN sin sanear — quedaba fuera del alcance
>   original de E4-2 (limitado a Movimientos), corregido con el mismo helper.
> - **E1-9:** `testM2.iterarTablaActuacionesHistoricas` comparaba `resultado.movimientos`
>   cuando la función subyacente devuelve `movimientosHistoricos` — corregido (código sin
>   consumidores hoy, verificado por grep).
> - **E1-8:** el `Math.min(options.startPage, /* comentario */)` (equivalente a
>   `Math.min(options.startPage)`, sin acotar nada) se reemplazó por `options.startPage`
>   directo, con un comentario honesto de por qué no hay total-de-páginas contra qué acotar
>   todavía. Dormido: ningún llamador pasa `startPage`.
> - **E1-10:** `txtPath` (referenciado sin declarar en `procesarNovedadesCompleto.js`, su
>   generación estaba comentada) reemplazado por `null` explícito — `enviarEmail` ya maneja
>   `null` correctamente. Código muerto en la práctica (el email está desactivado por defecto).
> - **E1-11:** eliminadas ~95 líneas inalcanzables en `listarSCWPJN.js` (la rama `else` de
>   `modoReintento === "seccion"`, constante hardcodeada a `"seccion"` — nunca podía ejecutarse).
>   Verificado por grep que las 4 funciones que solo usaba ese bloque muerto
>   (`verificarPagina`, `navegarDirectamenteAPagina`, `iterarListaExpedientesConSimulacion`,
>   `paginasConErrorGlobal`) se siguen usando en el camino real — nada quedó huérfano.
> - **E1-12:** en `consultarscwpjn.js`, `modoSeleccionado` comparaba contra `'quick5'` cuando el
>   modo real es `'quick5mam'` — corregido sin cambio de comportamiento hoy (el otro guard de
>   la misma condición, `mov.archivo !== "nn"`, ya cubría el caso).
>
> **Verificación:** `node -c` en los 7 archivos tocados, sin sintaxis rota; grep de referencias
> huérfanas tras la eliminación de E1-11, limpio. Desplegado en staging y prod (mismo
> procedimiento correcto del incidente de C.1 — ver arriba: reencrypt desde el propio directorio
> de cada entorno, con su propio `.env`, sin ambigüedad). Verificado en prod: 13 scripts en la
> whitelist, `listarSCWPJN.js` descarga 200, `backup-db.js` sigue en 404, health/API/landing 200.
>
> - **E1-1:** `process.on('uncaughtException'/'unhandledRejection')` (solo loguea, sin `exit`)
>   agregado a `consultarscwpjn.js`, `procesarMonitoreo.js` y `procesarCustomExpedientes.js` —
>   mismo patrón que `listarSCWPJN.js`/`procesarNovedadesCompleto.js`.
> - **E1-2:** en `informequickscwpjn.js`, el handler global ahora cierra el browser
>   (`cerrarNavegadorSeguro`, vía una referencia sincronizada `browserActivo`) **antes** de
>   `process.exit(1)` — este script sí necesita salir (el proceso padre en Electron parsea
>   `RESULT: {...}` de stdout), a diferencia de sus hermanos con reintentos.
> - **E1-3:** `testM1.iterarListaExpedientes` ya no traga los errores de página en silencio —
>   cuelga un array `paginasFallidas` como propiedad del resultado (no rompe `.length`/spread en
>   los llamadores existentes) y `procesarNovedadesCompleto.js` lo loguea si hay páginas
>   incompletas, en vez de reportar éxito ciego.
> - **E1-4:** el bloque de verificación de consistencia del backup en `consultarscwpjn.js` ahora
>   tiene su propio try/catch — antes un error ahí escapaba hasta el catch de la IIFE completa,
>   abortando **todos** los expedientes restantes por un problema de uno solo. Degrada al mismo
>   comportamiento que ya existía para "verificación fallida": reinicia ese expediente desde la
>   página 1.
> - **E1-6:** `testM2.iniciarSesion` no tenía **ningún** try/catch (a diferencia de
>   `testM1.iniciarSesion`, su función hermana) — se espeja el mismo patrón: restaura la ventana
>   en el escenario headless simulado y cierra el browser proactivamente antes de relanzar el
>   error.
>
> **Los 5 fixes son aditivos sobre el camino de error — cero cambio de comportamiento en el
> camino feliz** (el que corre casi siempre). Verificado por escritorio: `node -c` en los 7
> archivos tocados, sin sintaxis rota; grep de `browserActivo`/nombres nuevos sin colisiones ni
> huérfanos.
>
> **⚠️ Hallazgo nuevo detectado en el camino (mismo patrón que Q5/backup-db.js):**
> `reencrypt_scripts.js` también hace `require('dotenv').config()` sin `path` — cargar staging
> "a mano" desde su propio directorio termina apuntando a la base de **producción** (la `.env`
> base de staging tiene `DB_NAME=procurador_db`; solo `.env.staging` lo corrige, y el script no
> lo lee). Esto causó que la primera prueba de C.1 en staging re-encriptara directamente la base
> de producción sin pasar por una verificación previa — sin daño real (el contenido pushed era
> exactamente el que se iba a desplegar de todos modos, y los 5 fixes son aditivos sin riesgo en
> el camino feliz), pero es un patrón de riesgo real que ya apareció dos veces. **Forma correcta
> de invocar cualquier script de este directorio contra staging:**
> ```bash
> cd /var/www/procurador-staging/backend-server && \
>   node -r dotenv/config reencrypt_scripts.js dotenv_config_path=.env.staging
> ```
> (el preload carga `.env.staging` ANTES de que el script haga su propio `require('dotenv').config()`
> — dotenv no sobreescribe variables ya seteadas, así que `DB_NAME` queda correcto). Recuperado
> desplegando el mismo contenido correctamente en ambos entornos (prod desde su propio directorio
> con su propio `.env`, sin ambigüedad; staging con el preload de arriba) — backups previos en
> ambos, ambos reiniciados y verificados sanos (health 200, whitelist de A.1 intacta: 13 scripts,
> `backup-db.js` sigue en 404).
>
> **✅ Corregido en una sesión posterior (2026-07-28, mismo día):** se relevaron los scripts de
> mantenimiento que comparten el patrón (`reencrypt_scripts.js`, `scripts/backup-db.js`,
> `list_users.js`, `assign_cuit.js`, `migrate_cuit.js`) y se les agregó un `console.log` bien
> visible con la base de datos objetivo (`DB_NAME @ DB_HOST`) justo antes de cualquier
> operación — **no se rediseñó la resolución del entorno** (el cron real de prod y el
> `pm2 + -r dotenv/config` de staging ya funcionan bien; tocar eso es más riesgo del que vale
> este hallazgo de severidad baja), solo se hizo imposible no notar contra qué base se está por
> escribir cuando alguien corre uno de estos scripts a mano. Verificado en vivo: el reencrypt de
> este mismo fix mostró `procurador_db_staging` en staging y `procurador_db` en prod,
> correctamente. Ver la sesión de CLAUDE.md del 2026-07-28 (cont. 5).
>
> **⏳ Pendiente real, requiere al operador:** los puntos 2 y 3 de la verificación de abajo — correr
> los 3 flujos reales contra el PJN (Procuración, Informe, Monitor) con la app apuntando a
> producción (donde ya está el fix), y forzar un error de red a mitad de ejecución para confirmar
> que E1-1 deja Chrome limpio (sin huérfanos). El código ya está en producción; falta la
> confirmación funcional real.

**Vector:** editar los `.js` en `backend-server/scripts/` → `scp` al servidor →
`node reencrypt_scripts.js` → `pm2 restart procurador-api`. **No requiere release de Electron** (los
scripts se distribuyen cifrados y el cliente los baja en cada ejecución) — esta es la razón por la
que este bloque, siendo el de mayor valor, es más barato de desplegar que el D.

**⚠️ Es el bloque de mayor riesgo del plan:** es el motor que el cliente paga. Un error acá rompe
Procuración/Informe/Monitor para todos los usuarios en la próxima ejecución.

### C.1 — Robustez de errores (el núcleo del bloque)
| Ítem | Archivo | Fix |
|---|---|---|
| **E1-1** 🟠 | `consultarscwpjn.js`, `procesarMonitoreo.js`, `procesarCustomExpedientes.js` | Agregar `process.on('uncaughtException'/'unhandledRejection')` que **solo loguea, sin `exit`** — el patrón que `listarSCWPJN.js`/`procesarNovedadesCompleto.js` ya usan y documentan en un comentario |
| **E1-2** 🟡 | `informequickscwpjn.js:87-94` | Que el handler global cierre el browser (`cerrarNavegadorSeguro`) antes de salir, o adopte el patrón "loguear sin exit" de sus archivos hermanos |
| **E1-3** 🟡 | `testM1.js:714-716` | Que `iterarListaExpedientes` relance el error (o devuelva `completo: false`) en vez de tragarlo — hoy el flujo "Procurar" puede reportar éxito con expedientes faltantes |
| **E1-4** 🟡 | `consultarscwpjn.js:214-254` | Envolver el bloque de verificación de backup en su propio try/catch, degradando solo ese expediente |
| **E1-6** 🟡 | `testM2.js:257-409` | Espejar el cierre proactivo del browser que `testM1.iniciarSesion` ya hace en su catch |

### C.2 — Aislamiento y limpieza
| Ítem | Archivo | Fix |
|---|---|---|
| **E1-5** 🟡 | `monitoreo.js` | Mover `monitoring.log` a `getDataPath()` (aislado por CUIT), agregar rotación, y envolver el `appendFileSync` en try/catch |
| **E4-2** 🟡 | `procesarNovedadesCompleto.js:704-724` | Helper que antepone `'` a valores de celda que empiecen con `=`, `+`, `-`, `@`, aplicado a los 4 campos de texto libre del PJN |
| **E1-7** 🔵 | varios | ⚠️ Ver **Q4 en §7** — depende de si el lock server-side ya previene el escenario |
| **E1-8…E1-12** 🔵 | varios | Limpieza: `startPage` sin acotar, función exportada rota, `txtPath` no declarado, ~95 líneas inalcanzables, variable hardcodeada |

### Verificación del bloque C
Este bloque **no se puede verificar solo por código** — su verificación real requiere ejecutar
contra el PJN real, lo que **necesita la presencia del operador** (credenciales PJN):

1. **Verificación de escritorio (previa, hace el ejecutor):** `node -c` sobre cada script editado
   (sintaxis), y un `grep` de referencias huérfanas tras las eliminaciones de C.2 — **el checklist
   que CLAUDE.md ya documenta como aprendizaje de la regresión de v2.7.41**, donde eliminar una
   función dejó una llamada huérfana que ni `npm start` cazó.
2. **Verificación funcional (requiere operador):** correr los 3 flujos reales contra el PJN desde
   la app instalada, apuntando al backend con los scripts nuevos:
   - Procuración (individual + por lote)
   - Informe (individual + por lote)
   - Monitor (consulta inicial + novedades)
3. **Verificación específica de E1-1** (la más importante y la más difícil): forzar un error de red
   a mitad de una ejecución (ej. desconectar la red, o cerrar Chrome a mano) y confirmar que **el
   proceso termina limpio, sin dejar `chrome.exe` huérfano** en el Task Manager y sin lock
   colgado. Antes del fix, ese escenario podía dejar ambos.
4. **Rollback preparado:** tag de git previo + los scripts anteriores respaldados, de modo que
   revertir sea `scp` del backup + `reencrypt` + `restart` (minutos, sin release).

**Modelo/esfuerzo del bloque C:** Sonnet **ALTO**, 2 sesiones (C.1 y C.2 por separado). Es el
mismo criterio con el que se revisó (E1 se hizo en esfuerzo alto por la misma razón: lógica async
con estado, distribuida entre archivos, sin tests).

---

## 5. Bloque D — App Electron (release)

> ## ✅ EJECUTADO Y PUBLICADO — 2026-07-28 (release `electron-v2.7.44`, commits `0783ea6`/`5625943`/`c456c6f`)
>
> Los 7 ítems (E4-1/P-2, E2-8, E2-1, E2-3, E2-4, E2-5, E2-6, E2-7 — 8 en total) están
> implementados, verificados y publicados. **E4-3 revisado, sin acción**: el visor de informes
> no interpola ningún campo de texto libre del PJN (solo expediente/estado/exitCode/link a PDF).
>
> - **E4-1 (P-2):** portados `esc()`/`escAttr()` a `visorModal_template.html`, aplicados a los 5
>   campos señalados **más un 6º uso encontrado en el camino** (`modal-info`, fuera de la
>   enumeración original). **Mejora deliberada sobre la recomendación literal:** el hallazgo decía
>   "portar esc()" sin más, pero `esc()` no escapa comillas — insuficiente para los usos dentro de
>   `title="..."` (misma lección que motivó el hallazgo H1 de la revisión de cohesión de
>   Bitácora). Se usó `escAttr()` para esos casos. Verificado con un payload real
>   (`<img src=x onerror=alert(1)>`) simulando las funciones extraídas del archivo: queda
>   literal, no se ejecutaría. No-regresión verificada con una carátula real con comillas
>   (`RUIZ c/ "LA CAJA" S.A. s/ DAÑOS`) — se ve bien en contenido y el atributo escapa la
>   comilla correctamente (sin `escAttr()`, esa comilla habría roto el atributo). Sin
>   despliegue de backend: el template viaja como `extraResource` del instalador.
> - **E2-8:** implementado en ambos lados — `procesarMonitoreo.js` (Bloque C ya desplegado,
>   tolera `process.env.MONITOR_TOKEN || config.token`) y `main.js` (ya no escribe `token` en
>   `config_monitoreo.json`, lo pasa por `extraEnv.MONITOR_TOKEN`). Verificado por code review
>   que `configMonitoreo` ya no incluye la clave `token`; la verificación funcional real (correr
>   el Monitor e inspeccionar la carpeta temporal) queda para el operador, mismo patrón que el
>   resto de la verificación funcional del Bloque C.
> - **E2-1:** `path.basename(key)` en los 3 handlers `safe-storage-*`.
> - **E2-3:** `open-file` valida que la ruta resuelva dentro de `userData` y rechaza extensiones
>   ejecutables.
> - **E2-4:** eliminado `scriptExecutor.js` completo + el método `executeScript()` de
>   `AuthManager` + su instanciación + la referencia huérfana en `getStats()`.
> - **E2-5:** eliminado el handler `generate-extension-pdf` (~95 líneas) + el bridge en ambos
>   preloads + el import ahora huérfano de `pdf-lib` en `main.js`. *(Nota: `pdf-lib` queda sin
>   uso en `package.json` — no se desinstaló la dependencia, cambio de bajo valor que requeriría
>   su propio ciclo de `npm install`/prueba.)*
> - **E2-6:** eliminado el lookup muerto de `procesos_automaticos/` — se deja el comportamiento
>   que efectivamente corría (notificación sin detalles), `updateRunStats()` en `main.js` ya
>   lleva las estadísticas reales.
> - **E2-7:** optional chaining (`mainWindow?.webContents.send`) en los 6 puntos de
>   `runProcessLogic`.
> - **También eliminado:** `src/browser/windowManager.js` completo (E2-9, cero consumidores en
>   todo el repo, ni siquiera un `require()`).
>
> **Verificación:** `node -c` en los 4 `.js` tocados + validación del JS embebido del template,
> sin sintaxis rota. Grep de referencias huérfanas tras las 3 eliminaciones (ScriptExecutor,
> windowManager, generate-extension-pdf) — limpio. `npm start` con arranque limpio (sin
> `uncaughtException`) + `npm run build:dir` (`isDev:false isPackaged:true` confirmado).
>
> **⚠️ Mismo bug de infraestructura recurrente de `npm run release`** (documentado en v2.7.38-43,
> ahora también en v2.7.44): electron-builder creó el release con tag `v2.7.44` pero un reintento
> disparó un 422 ("Published releases must have a valid tag") — el release quedó con **solo el
> `.exe`**, sin `.blockmap` ni `latest.yml`. Corregido sin rebuild: `.blockmap` local subido tal
> cual + `latest.yml` regenerado a mano (SHA512 real del `.exe` calculado con `crypto` de Node,
> `latest.yml` local del build había quedado *stale* apuntando a 2.7.42). Verificado:
> `releases/latest` resuelve a 2.7.44 con los 3 assets, `GET /client/download/electron` → 302 al
> `.exe` correcto. Versión visible actualizada en los 5 lugares, desplegada (scp + `pm2 restart`
> para `app.js`; landing estática vía Nginx, sin restart) y confirmada en vivo: `curl` a
> `procuradortool.com` y `.../usuarios/app.js` devuelven únicamente `v2.7.44`.
>
> **⏳ Pendiente real, requiere al operador:** verificar E2-8 con una corrida real del Monitor
> (confirmar por inspección de la carpeta temporal que `config_monitoreo.json` ya no contiene el
> token, y que el flujo sigue funcionando) — parte de la misma verificación funcional pendiente
> del Bloque C.

**Vector:** release completo siguiendo el checklist de CLAUDE.md — `npm start` de prueba → bump
`2.7.43 → 2.7.44` → tag `electron-v2.7.44` → `npm run release` → **actualizar la versión visible en
los 5 lugares** (portal `app.js` + landing ×4) → deploy → verificar en vivo.

> ⚠️ **Recordatorio del checklist:** `npm run release` tiene un bug de infraestructura recurrente
> (documentado en v2.7.38/39/40/41/42/43 — 6 releases seguidos) donde el release queda incompleto
> o duplicado. El procedimiento de corrección manual (subir `.exe` + `latest.yml` regenerado vía
> API de GitHub) ya está documentado. **Presupuestar ese paso, no es una sorpresa.**

| Ítem | Archivo | Fix |
|---|---|---|
| **E4-1 (P-2)** 🟡 | `electron-app/visorModal_template.html` | Portar la función `esc()` que `generarVisorMonitoreo` (`main.js:2286`) **ya usa en producción**, y envolver los 5 campos: `caratula` (×2, contenido + atributo `title`), `dependencia` (×2), `situacion`, `mov.tipo`, `mov.detalle`. **No requiere re-encriptar scripts** — el escape es 100% client-side en el template |
| **E2-8** 🟡 | `main.js:2453-2456` | Pasar el JWT del Monitor por `extraEnv` (como ya se hace con `DECRYPT_KEY`/`DECRYPT_IV`) en vez de escribirlo en `config_monitoreo.json`. **Requiere tocar también `procesarMonitoreo.js`** para leerlo de `process.env` → coordinar con el Bloque C o hacerlo acá y re-encriptar |
| **E2-1** 🟡 | `main.js:766-802` | `path.basename(key)` o whitelist en los 3 handlers `safe-storage-*` |
| **E2-3** 🔵 | `main.js:1534` | Validar que `filePath` resuelva dentro de la carpeta de descargas del usuario, o rechazar extensiones ejecutables |
| **E2-4, E2-5, E2-9** 🔵 | `scriptExecutor.js`, `main.js:629-723`, `windowManager.js` | Eliminar ~490 líneas de código muerto (con el grep de referencias huérfanas después) |
| **E2-6** 🔵 | `authManager.js:811-834` | Corregir la ruta de stats (`procesos_automaticos/` no existe desde v2.7.33) |
| **E2-7** ℹ️ | `main.js:1196-1233` | Optional chaining en los 6 `mainWindow.webContents.send` de `runProcessLogic` |
| **E4-3** 🔵 | `visor_informes_template.html` | Opcional — mismo patrón, riesgo casi nulo (dato validado por regex) |

**Nota de dependencia cruzada:** **E2-8 cruza los bloques C y D** (necesita cambio en `main.js` Y
en `procesarMonitoreo.js`). Recomendación: hacer la parte del script en el Bloque C y la de
`main.js` en el D, **desplegando C primero** — el script nuevo debe tolerar ambas fuentes
(`process.env.MONITOR_TOKEN || config.token`) durante la transición, para que las apps viejas
(que siguen mandando el token por archivo) no se rompan mientras los usuarios actualizan.

### Verificación del bloque D
1. **Antes de empaquetar:** `npm start` con arranque limpio (sin `uncaughtException`) + `npm run
   build:dir` (`.exe` empaquetado real, `isPackaged:true`).
2. **E4-1 (el fix de XSS):** generar un visor con un expediente cuyo campo `detalle` contenga
   `<img src=x onerror=alert(1)>` (inyectable en staging manipulando el JSON de resultados) →
   abrir el visor → **el texto debe verse literal, sin ejecutarse**. Esta es la verificación que
   prueba el fix; lo demás es no-regresión.
3. **No-regresión de los visores:** abrir un visor real de Procuración con datos normales
   (acentos, ñ, comillas en carátulas) y confirmar que se ven bien — el escape no debe romper el
   renderizado de texto legítimo.
4. **E2-8:** correr el Monitor y confirmar por inspección de la carpeta temporal que
   `config_monitoreo.json` **ya no contiene el token**, y que el flujo sigue funcionando (el
   script llama al backend correctamente).
5. **Referencias huérfanas:** grep tras eliminar el código muerto (E2-4/5/9) — el mismo checklist
   que cazó la regresión de v2.7.41.
6. **Post-release:** verificar que `releases/latest` resuelve a 2.7.44 con los 3 assets, y que
   `GET /client/download/electron` devuelve un 302 al `.exe` correcto.

**Modelo/esfuerzo del bloque D:** Sonnet **MEDIO-ALTO**. El release en sí es mecánico y está bien
documentado; lo que sube el esfuerzo es la cantidad de archivos tocados + el grep de huérfanas.

---

## 6. Bloque E — Extensión Chrome ⚡ (arrancar en paralelo)

> ## ✅ CÓDIGO EJECUTADO — 2026-07-28 (commit `1f9d1c4`) — ⏳ falta el paso del operador
>
> Los 2 ítems (E.1, E.2) están implementados, verificados y el manifest en **1.3.7**. El ZIP
> (`pjn-extension-1.3.7.zip`, generado junto al repo, excluye `imagenes/`) está listo.
> **✅ Subido por el operador al dashboard de Chrome Web Store (2026-07-28)** — ⏳ en revisión de
> Google, el store todavía sirve 1.3.6.
>
> **Verificación de E.1 (sin Chrome real disponible en el entorno):** no se pudo cargar la
> extensión desempaquetada (el sandbox no permite `chrome://extensions`). Se verificó en su
> lugar simulando `handleHeaderLogoClick()` con stubs de `chrome`/`document`/`PJNAuth` para los
> 3 escenarios del plan — los 3 dieron la URL exacta esperada:
> - Sin sesión → `https://procuradortool.com`
> - Con sesión + token → `https://api.procuradortool.com/usuarios/#sso=<token>`
> - Con sesión sin token (borde) → `https://api.procuradortool.com/usuarios/` (sin romper)
>
> **E.2:** grep confirma cero referencias residuales a `checkExtensionVersion`,
> `/api/extension/version` o el alarm `pjn-version-check`.
>
> ⚠️ **Pendiente real de verificación (requiere Chrome real, ya sea el operador o una sesión con
> computer-use):** cargar la extensión desempaquetada y confirmar visualmente el click del logo
> en los 2 estados, y que la consola del service worker ya no muestra el request fallido.

**Vector:** editar → bump `manifest.json` `1.3.6 → 1.3.7` → generar ZIP (excluyendo `imagenes/`)
→ el **operador** lo sube al dashboard de Chrome Web Store → esperar aprobación de Google.

**Por qué arrancarlo primero pese a ser el de menor severidad:** es el único bloque que depende de
un tercero. Los 3 fixes están agrupados a propósito (documentado en CLAUDE.md) para no gastar un
ciclo de revisión por cada uno.

### E.1 — Logo clickeable con comportamiento por estado (el pedido nuevo)

**Comportamiento pedido:**
- **Sin sesión** (`#view-login` activo) → click en el logo → abre `https://procuradortool.com`
- **Con sesión** (`#view-main` activo) → click en el logo → abre **el dashboard del usuario**

**"Logo" = la imagen + el texto "Procurador TOOL"** (ambos, según la aclaración del operador).

**Detalle técnico verificado:** el bloque `.header` (`popup.html:412`) vive **fuera** de
`#view-login` (425) y `#view-main` (478) — es un header compartido, con un solo DOM. Por lo tanto
**un solo listener alcanza**, pero debe decidir el destino **en el momento del click**, leyendo qué
vista está activa (`document.getElementById('view-main').classList.contains('active')`), no al
cargar la popup.

**Alcance del área clickeable:** envolver `img.header-logo` + `.header-text` (que contiene
`.header-name` "Procurador TOOL" y `.header-sub` "Procurador SCW") — **sin** incluir
`#ext-version`, que es un dato informativo, no parte del logo. Agregar `cursor:pointer` y un
`title` que anticipe el destino ("Ir a procuradortool.com" / "Abrir mi panel").

**✅ Decisión tomada (2026-07-27) — ver Q1 en §7:** SSO automático, cae en la home del panel.

**Verificación:**
1. Popup **sin sesión** → click en la imagen → abre `procuradortool.com` en pestaña nueva.
   Repetir clickeando el texto "Procurador TOOL" → mismo resultado.
2. Login en la extensión → popup **con sesión** → click en el logo → abre el dashboard **ya
   logueado** (vía `#sso=<token>`), en la home del panel.
3. Logout → click en el logo → vuelve a llevar a la landing (confirma que lee el estado en vivo,
   no un valor cacheado al abrir la popup).
4. Confirmar que el click **no** rompe ni interfiere con el flujo normal de la popup (login,
   selección de flujo, ejecución).

### ~~E.2~~ — Jurisdicción en Notificaciones — **eliminado (2026-07-27)**

El operador confirmó que el problema ya no existe — se descarta este ítem sin corrección.

### E.2 — `checkExtensionVersion()` huérfano *(renumerado, era E.3)*
**Archivo:** `extension-app/background.js`

Llama a `GET /api/extension/version`, endpoint **eliminado en RI-4** (2026-07-22). Falla en
silencio (`if (!res.ok) return`), no rompe nada. Eliminar la función y sus llamadas.

**Verificación:** cargar la extensión desempaquetada, abrir la consola del service worker, y
confirmar que ya no aparece el request fallido a `/api/extension/version`.

**Modelo/esfuerzo del bloque E:** Sonnet **MEDIO-BAJO** (bajó de MEDIO: ambos ítems son chicos y
sin las incógnitas de la investigación contra el PJN que E.2 original tenía). **Dependencia del
operador** para subir el ZIP; la verificación de E.1 puede hacerse contra staging sin PJN real
(el SSO no depende del PJN).

---

## 7. ⚠️ Preguntas y pendientes por definir

**Estas decisiones bloquean partes del plan. Las que tienen recomendación pueden ejecutarse con el
default si preferís no decidir en detalle.**

### Q1 — Extensión: el logo con sesión, ¿SSO automático o login manual? (bloquea E.1)

**✅ DECIDIDO (2026-07-27): opción A, SSO automático.** El logo con sesión activa lleva a la home
del panel (sin `goto=`) vía `#sso=<token>`, mismo patrón que `openPortalSection` de la app Electron.

<details>
<summary>Contexto de la decisión (verificación técnica + opciones evaluadas)</summary>

**Verificado como técnicamente viable:** la extensión guarda un JWT en `chrome.storage.local`
(`pjn_ext_auth`), el portal ya soporta auto-login por `#sso=<token>` (`app.js:2528`), ambos tokens
se firman con el mismo `JWT_SECRET`, y **ningún endpoint valida el claim `client`** (confirmado por
grep) — así que el token de la extensión funcionaría contra el portal sin cambios de backend.

| Opción | A favor | En contra |
|---|---|---|
| **A. SSO automático** (elegida) | El usuario entra directo a su panel, sin re-loguearse. Es el mismo patrón que ya usa la app Electron (`openPortalSection`), o sea que no inventa nada | El token de extensión dura **2 h** (vs 8 h del portal) → la sesión del portal hereda esa duración más corta. El token viaja en el hash de la URL (no se envía al servidor y el portal lo limpia del historial con `history.replaceState`, pero queda un instante en la barra de direcciones) |
| **B. Login manual** | Cero exposición del token; sesión del portal con su duración normal de 8 h | Peor UX: el usuario ya está logueado en la extensión y le pedimos las credenciales otra vez |

**Destino:** la home del panel (sin `goto=`), no una sección específica como "Mi Plan".

</details>

### ~~Q2~~ — Extensión: problema de jurisdicción en Notificaciones — **YA NO APLICA (2026-07-27)**

El operador confirmó que este problema **ya no existe** (probablemente un cambio del propio SCW o
un falso positivo de la observación original). **Se elimina el ítem E.2 del Bloque E** — ver la
nota en §6.

### ~~Q3~~ — E3-2: semántica del `scheduled_plan` tras una suspensión — ✅ RESUELTA (2026-07-28)

**Decisión del operador: opción 1 — cancelar el downgrade al suspender** (`scheduled_plan = NULL`).
Si se sigue queriendo, se re-programa (es un clic). Razón: un downgrade programado meses atrás,
aplicado automáticamente tras una reactivación, es un cambio de plan que nadie pidió *en ese
momento*.

**Ya implementado y en producción** (ver el recuadro del Bloque A). Se aplicó en los **6 puntos de
suspensión reales** — no solo en `subscriptionService.js` como asumía el plan — más el paso a
`cancelled`.

<details><summary>Opciones que se descartaron</summary>

- **Opción 2 — Recalcular `apply_at` al reactivar**: respeta la intención original pero corre la
  fecha al nuevo fin de ciclo.
- **Opción 3 — Dejarlo como está** y solo agregar una notificación cuando se aplique tarde.
</details>

### ~~Q4~~ — E1-7: ¿vale la pena aislar los archivos de control por CUIT? — ✅ INVESTIGADA Y RESUELTA (2026-07-28)

**Verificado en `routes/license.js`:** el candado server-side (`active_executions`) hace
`INSERT ... ON CONFLICT (user_id) DO UPDATE ... WHERE active_executions.machine_id = EXCLUDED.machine_id`
— la clave única es **`user_id`**, no `machine_id`. Dos cuentas (CUIT) distintas en la misma PC
obtienen filas **separadas** en `active_executions` (no hay conflicto entre ellas), así que el
lock **no previene** que corran en paralelo compartiendo archivos de control. **El escenario de
E1-7 es real**, no cosmético.

**Implementado:** los 4 archivos de control movidos a `PROCURADOR_DATA_DIR` — ver el recuadro del
Bloque C arriba.

### Q5 — E5-2: ¿cómo evitamos que el schema se vuelva a desactualizar? (afecta B.1)

**✅ DECIDIDO (2026-07-27): opción 2, automatizar.** El script de backup diario
(`backend-server/scripts/backup-db.js`, cron 03:00) se extiende para que además escriba un
`pg_dump --schema-only` a un archivo — el commit/revisión periódica de ese archivo queda como
paso manual liviano (ya no depende de acordarse de *generarlo*, solo de mirarlo de vez en cuando).
Este cambio es parte del **Bloque B.1**, no de A.

### Q6 — E2-2: el fail-open de la verificación de firma, ¿es intencional? (bloquea el ítem)
Las 3 etapas de verificación de integridad de scripts (`authManager.js`) solo bloquean ante
`SignatureVerificationError`/`ChecksumMismatchError`; **cualquier otra excepción del verificador
deja pasar el script**. Esto **toca la interacción con `electron-app/src/security/`, que es zona
protegida** (`⛔ NO TOCAR` en CLAUDE.md), por eso no lo incluí en ningún bloque.

**La pregunta es de diseño, no técnica:** ¿el fail-open fue una decisión consciente (priorizar que
el usuario pueda trabajar aunque el verificador tenga un bug transitorio) o es un patrón heredado
que nadie revisó? Si es lo segundo, vale la pena cambiarlo a fail-closed. Si es lo primero,
conviene **documentarlo con un comentario** para que la próxima revisión no lo vuelva a marcar.

### Q7 — Ítems de severidad baja que propongo NO hacer (confirmar)
Para no inflar el plan, propongo **aceptar sin corregir** (documentándolo):
- **E3-5** (`suspension_cause` incorrecto en un caso de borde): la cuenta ya está bloqueada en
  ambos casos, no hay brecha de acceso — solo higiene de datos en un escenario poco probable.
- **E3-3** (`cancel_at` sin campo de motivo): agregar una columna + migrar la lógica de 2 crons
  para un caso de borde de baja probabilidad no se justifica hoy. Reconsiderar si aparece el caso.
- **E1-13** (script de testing distribuido): queda resuelto de hecho por la whitelist de A.1 — el
  script sigue en la tabla pero deja de ser descargable. Sacarlo del directorio es un cambio mayor
  (ver la nota del informe E5) que no propongo ahora.

---

## 8. Resumen de dependencias del operador

Cosas que **no puede hacer un agente solo** y que conviene agendar:

| Qué | Para qué bloque | Por qué |
|---|---|---|
| ~~Correr una Procuración real desde la app~~ | ~~A.1~~ | ✅ Confirmado por el operador (2026-07-28) — funcionó bien |
| ⏳ **Correr los 3 flujos contra el PJN real** (Procuración, Informe, Monitor) | **C.1/C.2** (ya en prod) | El código ya está desplegado en producción — falta la confirmación funcional real, que necesita credenciales PJN |
| ⏳ **Forzar un error de red a mitad de ejecución** | **C.1** | Verificar E1-1 (Chrome huérfano) requiere provocar el fallo a mano, con la app real |
| ⏳ **Verificar E2-8 con el Monitor real** | **D** (ya en prod) | Confirmar por inspección de la carpeta temporal que `config_monitoreo.json` ya no tiene el token — se solapa con el punto de arriba |
| ~~Subir `pjn-extension-1.3.7.zip` al Chrome Web Store~~ | ~~E~~ | ✅ Subido por el operador (2026-07-28) — en revisión de Google |
| ⏳ **Verificar el logo en Chrome real** (extensión desempaquetada) | **E** | El sandbox no puede abrir `chrome://extensions`; la lógica ya está verificada por simulación, falta el click real en los 2 estados |
| Responder Q6, Q7 | —, — | Decisiones de diseño aún abiertas (Q1, Q2, Q3, Q4, Q5 ya resueltas) |

---

## 9. Cómo arrancar

**Si querés máximo valor con mínimo riesgo, en este orden:**

1. ~~**Responder Q1 y Q5**~~ — ✅ hechas (2026-07-27), junto con Q2 y Q3.
2. ~~**Bloque A**~~ — ✅ **ejecutado y en producción** (2026-07-28, commit `03e294d`). P-1 cerrado.
3. ~~**Bloque E**~~ — ✅ **código listo** (2026-07-28, commit `1f9d1c4`), manifest en 1.3.7.
   ✅ Subido por el operador al Chrome Web Store — ⏳ en revisión de Google.
4. ~~**Bloque B**~~ — ✅ **ejecutado y en producción** (2026-07-28). Drift de schema cerrado +
   regeneración automatizada en el backup diario (Q5) + los 4 índices.
5. ~~**Bloque C (C.1 + C.2)**~~ — ✅ **ejecutado y en producción** (2026-07-28). Los 13 fixes de
   código están hechos; solo queda la verificación funcional real contra el PJN, para cuando el
   operador tenga ventana (no bloquea seguir con el resto del plan).
6. ~~**Bloque D**~~ — ✅ **publicado** (2026-07-28, release `electron-v2.7.44`). El plan de
   correcciones E1-E6 completo **queda 100% en código y desplegado** — solo quedan las
   verificaciones funcionales reales contra el PJN (Bloque C + E2-8 del D) pendientes del
   operador, y Q6/Q7 sin responder (no bloquean nada).

**Para ejecutar un bloque:** sesión nueva, contexto fresco, y el pedido:
> «Ejecutá el **Bloque A** del plan `docs/internal/plan-correcciones-E1-E6-2026-07-27.md`.»

**Reglas de ejecución (heredadas del plan de revisión, siguen vigentes):** backup de DB antes de
cualquier cambio · staging antes que prod, siempre · verificar `DB_NAME` antes de cualquier
escritura · nunca `git add -A` (archivos explícitos por nombre) · si el ejecutor quiere cambiar de
modelo o esfuerzo a mitad, avisa y espera confirmación.
