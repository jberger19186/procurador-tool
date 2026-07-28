# Plan de implementación — correcciones de los hallazgos E1-E6 + extensión

> **Qué es esto.** El plan de ejecución de los ~35 hallazgos documentados en los 6 informes de
> revisión (`revision-E1-2026-07-27.md` … `revision-E6-2026-07-27.md`), más los 3 pendientes
> acumulados de la extensión Chrome.
>
> **Principio de organización: un bloque = un despliegue.** Los bloques NO están agrupados por
> severidad sino por **vector de despliegue**, porque eso es lo que realmente determina el trabajo
> y el riesgo: un fix de backend es `scp` + `pm2 restart`; uno de scripts encriptados necesita
> `reencrypt_scripts.js`; uno de Electron necesita un release completo con bump de versión en 5
> lugares; uno de la extensión necesita un ciclo de revisión de Google. Mezclarlos multiplica los
> despliegues sin ganar nada.
>
> **Elaborado con:** Opus 5, 2026-07-27. **Estado:** propuesta — **requiere las decisiones de §7
> antes de ejecutar los bloques que las necesitan** (marcados con ⚠️).

---

## 1. Resumen de bloques

| # | Bloque | Vector de despliegue | Hallazgos | Modelo/esfuerzo | Orden sugerido |
|---|---|---|---|---|---|
| **A** | Backend + dashboard | `scp` + `pm2 restart` · sin release | E5-1(P-1), E3-1, E3-2, E6-1, E6-2 | Sonnet **MEDIO** | 1º |
| **B** | Base de datos | Migración additiva + regenerar snapshot | E5-2, E3-4 | Sonnet **BAJO-MEDIO** | 2º |
| **C** | Motor de automatización | Editar + `reencrypt_scripts.js` + `pm2 restart` · **sin release de Electron** | E1-1…E1-12, E4-2 | Sonnet **ALTO** | 3º |
| **D** | App Electron | Release completo (bump + tag + 5 lugares de versión) | E4-1(P-2), E2-1, E2-3…E2-9, E4-3 | Sonnet **MEDIO-ALTO** | 4º |
| **E** | Extensión Chrome | Bump manifest + ZIP + revisión de Google | Logo (2 estados), `cs-notif.js`, `checkExtensionVersion()` | Sonnet **MEDIO** | ⚡ **arrancar en paralelo** |
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
**Severidad:** 🟡 Medio · **Archivo:** `backend-server/services/subscriptionService.js`

⚠️ **Este ítem toca la lógica de cambio de plan facturado.** Según la regla del plan de revisión,
**avisar al operador y considerar escalar a Opus para este ítem puntual.** Además, la decisión de
*qué* hacer no es obvia — ver **Q3 en §7**: ¿limpiar el `scheduled_plan` al suspender (se pierde el
downgrade programado), o recalcular su `apply_at` al reactivar (se respeta la intención original)?

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

**⚠️ Decisión pendiente — ver Q1 en §7:** el dashboard con **SSO automático** (el usuario entra ya
logueado) o con **login manual** (se abre el portal y el usuario ingresa sus credenciales). Ambas
son viables; verifiqué que el SSO es técnicamente posible. La recomendación y sus implicancias
están en §7.

**Verificación:**
1. Popup **sin sesión** → click en la imagen → abre `procuradortool.com` en pestaña nueva.
   Repetir clickeando el texto "Procurador TOOL" → mismo resultado.
2. Login en la extensión → popup **con sesión** → click en el logo → abre el dashboard
   (comportamiento según lo que se decida en Q1).
3. Logout → click en el logo → vuelve a llevar a la landing (confirma que lee el estado en vivo,
   no un valor cacheado al abrir la popup).
4. Confirmar que el click **no** rompe ni interfiere con el flujo normal de la popup (login,
   selección de flujo, ejecución).

### E.2 — Jurisdicción en el flujo de Notificaciones
**Archivo:** `extension-app/cs-notif.js` (función `fillFields`, líneas ~88-123)

El operador marcó que el llenado del combobox de jurisdicción en este flujo necesita
revisión/control. **No está especificado el síntoma exacto** (¿selecciona mal? ¿tarda? ¿falla en
casos borde?) — ver **Q2 en §7**.

**Trabajo previo obligatorio:** investigar contra el DOM real de `notif.pjn.gov.ar/nueva` antes de
tocar el código. Los flujos de Escritos 2 y DEOX comparten un patrón similar (`reactSet()` +
búsqueda de opción por `innerText` o sigla + `Enter`) y **no** fueron señalados, así que la
comparación entre los tres es el punto de partida natural para aislar la diferencia.

**Verificación:** requiere el PJN real y credenciales → **presencia del operador**. Probar el flujo
de Notificaciones con al menos 3 jurisdicciones distintas, incluyendo una cuyo nombre sea prefijo
de otra (el caso borde más probable con una búsqueda por `includes`).

### E.3 — `checkExtensionVersion()` huérfano
**Archivo:** `extension-app/background.js`

Llama a `GET /api/extension/version`, endpoint **eliminado en RI-4** (2026-07-22). Falla en
silencio (`if (!res.ok) return`), no rompe nada. Eliminar la función y sus llamadas.

**Verificación:** cargar la extensión desempaquetada, abrir la consola del service worker, y
confirmar que ya no aparece el request fallido a `/api/extension/version`.

**Modelo/esfuerzo del bloque E:** Sonnet **MEDIO** (E.1 y E.3 son chicos; E.2 sube el esfuerzo por
la investigación contra el DOM real). **Dependencia dura del operador** para subir el ZIP y para
verificar E.1 y E.2 contra el PJN real.

---

## 7. ⚠️ Preguntas y pendientes por definir

**Estas decisiones bloquean partes del plan. Las que tienen recomendación pueden ejecutarse con el
default si preferís no decidir en detalle.**

### Q1 — Extensión: el logo con sesión, ¿SSO automático o login manual? (bloquea E.1)

**Verificado como técnicamente viable:** la extensión guarda un JWT en `chrome.storage.local`
(`pjn_ext_auth`), el portal ya soporta auto-login por `#sso=<token>` (`app.js:2528`), ambos tokens
se firman con el mismo `JWT_SECRET`, y **ningún endpoint valida el claim `client`** (confirmado por
grep) — así que el token de la extensión funcionaría contra el portal sin cambios de backend.

| Opción | A favor | En contra |
|---|---|---|
| **A. SSO automático** (recomendada) | El usuario entra directo a su panel, sin re-loguearse. Es el mismo patrón que ya usa la app Electron (`openPortalSection`), o sea que no inventa nada | El token de extensión dura **2 h** (vs 8 h del portal) → la sesión del portal hereda esa duración más corta. El token viaja en el hash de la URL (no se envía al servidor y el portal lo limpia del historial con `history.replaceState`, pero queda un instante en la barra de direcciones) |
| **B. Login manual** | Cero exposición del token; sesión del portal con su duración normal de 8 h | Peor UX: el usuario ya está logueado en la extensión y le pedimos las credenciales otra vez |

**Mi recomendación: opción A (SSO).** El patrón ya existe y está probado en producción desde la app
Electron, el hash no llega al servidor, y el portal ya limpia la URL. La duración de 2 h es
aceptable para el caso de uso (mirar el panel), y si molesta se puede resolver después haciendo que
el portal renueve el token con `/auth/refresh` al entrar por SSO.

**Sub-pregunta:** ¿a qué sección del portal debería llevar? El portal soporta `?goto=` (`plan`,
`facturacion`, `soporte`, `ayuda`, etc.). **Default propuesto: la home del panel** (sin `goto`),
que es lo que "dashboard del usuario" sugiere. Decime si preferís que caiga directo en "Mi Plan".

### Q2 — Extensión: ¿cuál es el síntoma exacto del problema de jurisdicción? (bloquea E.2)
El pendiente registrado dice que "necesita control/revisión" sin especificar qué falla. Para
poder arreglarlo hace falta saber: ¿selecciona una jurisdicción **incorrecta**? ¿**no** selecciona
nada? ¿tarda demasiado y el formulario sigue sin llenarse? ¿falla solo con jurisdicciones
específicas? Si tenés un caso concreto (jurisdicción + qué pasó), acelera mucho el diagnóstico.

### Q3 — E3-2: semántica del `scheduled_plan` tras una suspensión (bloquea A.3)
Cuando una cuenta con un downgrade programado se suspende y luego se reactiva, ¿qué debería pasar?

- **Opción 1 — Cancelar el downgrade** (`scheduled_plan = NULL` al suspender): el más simple y
  predecible. El admin tendría que re-programarlo si sigue queriéndolo.
- **Opción 2 — Recalcular `apply_at` al reactivar**: respeta la intención original (el usuario
  igual va a bajar de plan) pero corre la fecha al nuevo fin de ciclo.
- **Opción 3 — Dejarlo como está** y solo agregar una notificación cuando se aplique tarde.

**Mi recomendación: opción 1.** Es la que menos sorprende al usuario: un downgrade programado hace
meses, aplicado automáticamente tras una reactivación, es un cambio de plan que nadie pidió *en ese
momento*. Si el admin lo sigue queriendo, re-programarlo es un clic.

### Q4 — E1-7: ¿vale la pena aislar los archivos de control por CUIT? (afecta C.2)
Varios archivos de control (`execution.lock`, `pid_quickscw.txt`, `stop_quickscw.flag`, los backups
de `listarSCWPJN.js`) usan `__dirname` en vez de `PROCURADOR_DATA_DIR`, así que se comparten entre
cuentas en la misma PC. **El impacto real depende de algo que no verifiqué:** si el candado
server-side (`active_executions`) ya impide que dos CUITs distintos ejecuten en paralelo en la
misma máquina, el escenario problemático no puede darse y esto es cosmético.

**Propuesta:** verificar primero eso (es una lectura de `license.js` + una prueba en staging, ~30
min). Si el lock ya lo previene → bajar el ítem a "cosmético, opcional". Si no → incluirlo en C.2.

### Q5 — E5-2: ¿cómo evitamos que el schema se vuelva a desactualizar? (afecta B.1)
- **Opción 1 — Manual:** agregar "regenerar `schema.sql`" al checklist de sesiones con migración.
  Barato, pero depende de que nadie se olvide (y ya se olvidó durante 2 meses).
- **Opción 2 — Automático** (recomendada): que el script de backup diario que ya corre a las 03:00
  también escriba el `--schema-only` a un archivo, y revisar/commitear ese archivo periódicamente.
  Requiere un cambio chico en `backend-server/scripts/backup-db.js`.

**Mi recomendación: opción 2**, porque el problema de fondo es justamente que el paso manual no se
hizo. Pero implica tocar el script de backup (que hoy funciona bien), así que decime si preferís
la opción 1 por prudencia.

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
| Correr los 3 flujos contra el PJN real | **C** (crítico) | La verificación funcional del motor necesita credenciales PJN reales |
| Forzar un error de red a mitad de ejecución | **C** | Verificar E1-1 (Chrome huérfano) requiere provocar el fallo a mano |
| Subir el ZIP al Chrome Web Store | **E** | Solo el operador tiene acceso al dashboard de publicación |
| Probar el flujo de Notificaciones en el PJN | **E.2** | Requiere credenciales PJN reales |
| Responder Q1-Q7 | varios | Decisiones de producto/diseño |

---

## 9. Cómo arrancar

**Si querés máximo valor con mínimo riesgo, en este orden:**

1. **Responder Q1 y Q5** (las dos que bloquean trabajo inmediato y tienen recomendación clara).
2. **Bloque E** — arrancar ya, para que el ciclo de revisión de Google corra en paralelo.
3. **Bloque A** — el más barato de desplegar, y cierra P-1.
4. **Bloque B** — cierra el hallazgo más silencioso (el drift de schema).
5. **Bloque C** — el de mayor valor real, cuando haya una ventana con el operador disponible para
   la verificación contra el PJN.
6. **Bloque D** — el release, al final, agrupando todo lo de Electron en una sola versión.

**Para ejecutar un bloque:** sesión nueva, contexto fresco, y el pedido:
> «Ejecutá el **Bloque A** del plan `docs/internal/plan-correcciones-E1-E6-2026-07-27.md`.»

**Reglas de ejecución (heredadas del plan de revisión, siguen vigentes):** backup de DB antes de
cualquier cambio · staging antes que prod, siempre · verificar `DB_NAME` antes de cualquier
escritura · nunca `git add -A` (archivos explícitos por nombre) · si el ejecutor quiere cambiar de
modelo o esfuerzo a mitad, avisa y espera confirmación.
