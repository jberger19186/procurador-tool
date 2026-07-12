# Informe de bugs — Procurador SCW

> Documento de hallazgos · 2026-07-10 · Estado: **relevado y verificado, pendiente de corrección**
> Método: revisión en paralelo de 3 zonas (backend cobranza/auth · backend ejecución/cuotas · app Electron) + verificación manual de cada hallazgo alto/crítico contra el código real (archivo:línea).
> Alcance: solo lectura. No se modificó ningún archivo. Todos los `archivo:línea` refieren al estado del repo en `main` al 2026-07-10 (último commit `b950ba8`).

> **Estado de corrección (actualizado 2026-07-12):**
> ✅ **Lote 2A CERRADO** — C1, C2, A1, M4, A4, A2, A3 corregidos y deployados a prod. C1/C2/A1/M4 verificados **E2E con pago sandbox real** (el E2E cazó además un bug de tipos en `applyTrialBonus` que solo se veía al aplicar un pago real). A4 verificado en prod. A2/A3 por inspección + boot + validación SQL. Commits: `29521f0` (C1), `06e5cb1`+`5ba31e8` (A1), `0ea2bfa` (C2+M4), `9b46a51` (A4), `f9bd833` (A2+A3).
> ✅ **Lote 2B CERRADO** — M1, M2/SEC-4, M3, B2, B4, B5, B8 corregidos y deployados a prod. **M3 (lock atómico) y M2/SEC-4 (gate del trial) verificados E2E en staging** (409 al 2º dispositivo; 403 TRIAL_EXHAUSTED a 20/20). M1 dry-run OK, boot + smoke 8/8, resto por inspección. **SEC-4 queda cerrado acá** (era M2) → en Fase 3 solo restan SEC-1 (auditoría) y SEC-2 (CI). Commits: `b36a9bb` (M2/SEC-4+M3), `4b17376` (M1), `83bc29b` (B4+B8), `b797cd3` (B2), `53dfd6c` (B5).
> **Pendientes:** Lote 2C (Electron: A5, A6, M5, M6, M8, M10, B1, B6 — requiere release), Lote 2D (U9.3). Ver plan `plan-implementacion-integral-2026-07.md`.
> **Hallazgo del E2E (relevante para B3):** el pago plan-based real **no se atribuye solo** (sin `external_reference`, `payer_email` ≠ email del portal, el `payment` de MP no trae `preapproval_id`). A2/A3 acotan el claim/IDOR pero la atribución automática del primer pago plan-based sigue siendo frágil → validar con un pago sandbox real en la prep de B3.

---

## 0. Cómo leer este informe

Cada hallazgo tiene: **id**, ubicación exacta (`archivo:línea`), escenario concreto de fallo, severidad y estado de verificación.

- **Verificado ✓** = leí el código de esa línea (y, cuando aplica, ambos lados cliente/servidor) y confirmé la mecánica.
- **Reportado** = proviene de la revisión, es coherente con el código adyacente que sí leí, pero no releí la línea exacta palabra por palabra. Confianza alta salvo que se indique.

Los ids son estables (C=crítico, A=alto, M=medio, B=bajo) para poder referenciarlos en commits y en CLAUDE.md.

**Cadena de agravamiento del cobro:** C2 + A1 + M4 se potencian entre sí y forman el camino que recorrerá el **primer pago real** cuando se active B3 (MercadoPago producción). Hoy no explotan porque el E2E de sandbox pasó por el claim-por-ventana (`reconcileClaimedCheckout`), no por el webhook atribuible. **Corregir ese paquete es prerequisito de B3.**

---

## 1. Críticos

### C1 — El bonus por submódulo permite ejecución ilimitada sin contar
**`backend-server/routes/client.js:359`** (gate) · `:332` (cálculo) · `:501` (`/client/account`) · `electron-app/main.js:1105-1138` (`checkSubsystemLimit`) — **Verificado ✓ (ambos lados)**

El gate atómico de `log-execution` es:
```sql
WHERE (proc_usage + COALESCE(proc_bonus,0)) < $2   -- $2 = effectiveLimit
```
con `effectiveLimit = limit + bonus` (línea 332). El bonus aparece en ambos lados de la desigualdad y **se cancela algebraicamente**: la condición equivale a `proc_usage < limit`. El gate bloquea en el límite **base**, ignorando el bonus.

**Escenario de fallo (bonus > 0):**
1. Admin asigna `proc_bonus = 10` a un COMBO (límite base 50). Límite efectivo esperado = 60.
2. `proc_usage` sube normal hasta 50.
3. En `proc_usage = 50`: el pre-check de la ruta (`currentUsage >= effectiveLimit` → `50 >= 60`) pasa; el UPDATE evalúa `(50+10) < 60` → falso → **0 filas** → 403 "Límite alcanzado". **El contador NO se incrementa.**
4. `/client/account` (línea 501) devuelve `procEffective = 50 + 10 = 60`, `used = 50` → `remaining = 10 > 0`.
5. El pre-check del cliente (`checkSubsystemLimit`) ve `remaining = 10 > 0` → **no bloquea** → la app abre Chrome y corre la automatización real contra el PJN.
6. Al terminar, `log-execution` devuelve 403, pero el cliente lo ignora (logging "no-crítico", `authManager.js:861`). `proc_usage` sigue clavado en 50.
7. **Loop infinito:** cada ejecución siguiente repite 5–6. El usuario ejecuta automatizaciones reales sin límite y **sin que se cuenten**.

**Impacto:** cualquier usuario con `*_bonus > 0` (asignados por admin/soporte como cortesía) obtiene uso ilimitado gratis al pasar el límite base. Socava la monetización y carga trabajo real contra el PJN sin registro.

**Fix:** en el UPDATE, usar `WHERE ${usageCol} < $2` con `$2 = effectiveLimit` (comparar el uso crudo contra el límite ya-con-bonus), en vez de sumar el bonus de nuevo a la izquierda. Una línea. Solo backend, sin release.

---

### C2 — El webhook pierde el pago cuando MP envía `pending` → `approved`
**`backend-server/routes/webhooks.js:87,102,110`** — **Verificado ✓**

La deduplicación usa `externalId = data.id` (el payment id, línea 87). MercadoPago emite **varios** webhooks para el mismo `payment.id` a medida que el pago cambia de estado (`pending`/`in_process` → `approved`).

**Escenario de fallo:**
1. Llega el webhook `pending`. `INSERT ... ON CONFLICT DO NOTHING` inserta el row → `isNew = true`. `handlePaymentEvent` consulta MP, ve `status='pending'`, hace upsert en `payments` y **no aplica bonus ni renovación**.
2. Llega el webhook `approved` (mismo `payment.id`). El INSERT choca con el UNIQUE → `rowCount = 0` → `isNew = false`. Como `type='payment'` (no preapproval), cae en `if (!isNew && !isPreapproval) return` (línea 110) → **se descarta**.
3. `applyTrialBonus`/`applyRenewal` nunca corren. El usuario pagó, MP cobró, y la cuenta queda bloqueada / en gracia con el dinero adentro.

Además (variante b): si `handlePaymentEvent` lanza una excepción (timeout de la API de MP, deadlock), el `catch` (línea 134) solo loguea, pero el row de `webhook_events` **ya quedó insertado** con `processed_at = NULL`. El reintento de MP cae en `isNew = false` → ignorado. **El código nunca consulta `processed_at`** para distinguir "visto" de "procesado".

**Por qué no se detectó:** el E2E de sandbox se atribuyó por el claim-por-ventana (`reconcileClaimedCheckout`), no por este camino.

**Fix:** deduplicar por "procesado con éxito", no por mera existencia del id. Ej.: solo cortar si existe un row con `processed_at IS NOT NULL`; para pagos, permitir reprocesar mientras `processed_at IS NULL` o el estado cambió. Combinar con M4 (transacción).

---

## 2. Altos

### A1 — El primer pago no setea `next_billing_date`, `last_payment_at` ni `status`
**`backend-server/services/subscriptionService.js:274-302`** (`applyTrialBonus`) + `routes/webhooks.js:208-233` — **Verificado ✓**

En la rama `approved` del primer pago, el webhook llama `applyTrialBonus(sub.sub_id, sub.plan, nextBillingDate)`, pero `applyTrialBonus` guarda `nextBillingDate` **solo en `trial_bonus_until`**. No toca `next_billing_date`, `last_payment_at` ni `status`. Los UPDATE posteriores del webhook (226-243) tampoco. Comparar con `reconcileClaimedCheckout` (`:627-632`), que SÍ hace el `SET status='active', next_billing_date=$1, last_payment_at=NOW()` — por eso el sandbox (que pasó por ese camino) no lo mostró.

**Consecuencias durante el primer período pago (`next_billing_date = NULL`):**
- `cancelSubscription` (`:755-762`) hace `SET cancel_at = next_billing_date` → **`cancel_at = NULL`**: la baja pausa el preapproval en MP pero nunca se programa; el cron no cierra la cuenta y la UI no muestra fecha.
- `handlePreapprovalEvent` rama cancelled/paused (`webhooks.js:385`): `COALESCE(cancel_at, next_billing_date, NOW())` → cae en **`NOW()`** → un pause desde MP en el primer mes corta el acceso **inmediato** en vez de al fin del período pagado.
- `createReactivationPreapproval` (`:129-132`): `refDate = NULL` → `freeTrialDays = 0` → **cobro inmediato duplicado** al reactivar dentro del período ya pagado.

**Fix:** que `applyTrialBonus`/`applyRenewal` (o el UPDATE del webhook) seteen explícitamente `status='active'`, `next_billing_date`, `last_payment_at`.

---

### A2 — Claim de pago ajeno: la ventana de checkout no tiene techo
**`backend-server/services/subscriptionService.js:479-502`** (línea 487) — **Verificado ✓**

El claim-por-ventana filtra `if (new Date(p.date_created) < windowStart) continue;` — solo **piso** (`windowStart = checkout_initiated_at − 2min`), sin techo. Y `checkout_initiated_at` se estampa en cada `/checkout/init` pero **nunca se limpia**.

**Escenario de fallo:**
1. Usuario A inicia un checkout en mayo y no paga → queda su `checkout_initiated_at` de mayo.
2. Usuario B paga en julio por checkout plan-based (el preapproval de MP no persiste `external_reference` ni `payer_email` → inatribuible; su webhook loguea "Suscripción no encontrada").
3. A entra al portal y dispara `/checkout/confirm` (su flag `psc_checkout_pending` puede seguir vivo en localStorage). `markPaymentConfigured` busca preapprovals autorizados, de nuestro plan, sin identificadores, sin dueño, creados **después** de mayo−2min → el pago de B (julio) califica.
4. A **reclama el preapproval de B**; `reconcileClaimedCheckout` le registra el pago y aplica el bonus. Cuando B confirma, ya no hay candidato → **B pagó y no recibe nada**.

El comentario del código acepta "colisión en la misma ventana de minutos", pero el timestamp rancio convierte esa ventana en meses.

**Fix:** agregar techo (`date_created <= checkout_initiated_at + N min`) y limpiar `checkout_initiated_at` al vincular exitosamente.

---

### A3 — `linkPreapproval` no valida que el preapproval sea del usuario (IDOR)
**`backend-server/services/subscriptionService.js:241-263`** + `routes/checkout.js:120-121` — **Verificado ✓ (confianza media en explotabilidad)**

`POST /checkout/confirm` toma `preapproval_id` del body. `linkPreapproval` verifica que exista en MP y esté `authorized`, pero **no chequea `external_reference === 'user_{id}'` ni `payer_email`** (a diferencia de `markPaymentConfigured`, que sí filtra con `belongsToUser`). Un usuario autenticado que conozca un `preapproval_id` autorizado ajeno —viaja en el redirect `back_url?preapproval_id=...` (historial del navegador, link reenviado, PC compartida de estudio)— puede vinculárselo: queda con el `external_subscription_id` del pagador real. Como los lookups del webhook ordenan `ORDER BY s.id DESC LIMIT 1`, las renovaciones futuras del pagador podrían aplicarse a la suscripción del atacante. Los IDs no son adivinables por fuerza bruta (de ahí la confianza media), pero la ausencia del check es un hecho.

**Fix:** en `linkPreapproval`, exigir que el preapproval sea atribuible al `userId` (por `external_reference` o `payer_email`) antes del UPDATE.

---

### A4 — `/auth/forgot-password`: XSS reflejado + enumeración + sin rate limit
**`backend-server/routes/auth.js:1061-1096`** (interpolación en `:1083`) — **Verificado ✓**

Tres problemas en el mismo endpoint:
- **XSS reflejado:** `notFoundPage(email)` inyecta el email del body **sin escapar**: `<strong>${emailVal}</strong>` (línea 1083), servido como `text/html`. Un form auto-submit desde un sitio del atacante hacia `POST /auth/forgot-password` con `email=<img src=x onerror=...>` ejecuta JS en el origen `api.procuradortool.com` — donde viven el portal y el dashboard admin con tokens en localStorage. El `'unsafe-inline'` de la CSP no lo frena.
- **Enumeración de emails:** responde distinto si el email existe ("No encontramos ninguna cuenta...") vs si no. El `resend-verification` de este mismo archivo usa respuesta genérica; acá no.
- **Sin rate limit:** a diferencia de `/login` y `/resend-verification` (que usan `loginLimiter`), este POST no tiene limiter → spam ilimitado de emails de reset por IP.

**Fix:** escapar el email (o no reflejarlo), respuesta genérica idéntica exista o no la cuenta, y aplicar `loginLimiter`.

---

### A5 — Concurrencia rota: `currentProcess` es código muerto
**`electron-app/main.js:22`** (declaración) · `:1144,1231,1424` (guards) · `:1406` (comentario que lo admite) — **Verificado ✓**

La variable `currentProcess` se declara pero **nunca se asigna** (confirmado por grep: solo aparece la declaración, los guards, el comentario y un `.kill()`). Los guards `if (currentProcess)` de `run-process`, `run-process-custom-date` y `list-expedientes` son **siempre falsos** → esos handlers no bloquean ejecuciones simultáneas. Los handlers que sí usan `authManager.activeChild` como guard (`run-informe`, `run-monitoreo`, `run-process-custom`) tampoco están protegidos contra `run-process`, y `activeChild` recién se setea **después** de varios `await` largos (verifySession + getAccount + lock + closeChromeProfile ≈ 3-5 s de ventana).

**Escenario de fallo:** el usuario dispara Procurar y, mientras corre, dispara Procurar de nuevo (o Por fecha, o Listado). El segundo fork pisa `authManager.activeChild`; dos Puppeteer pelean por el mismo perfil Chrome (el `closeChromeProfile` del segundo **mata el Chrome del primero** en plena automatización); `executionLockTimer` se sobreescribe sin `clearInterval` → el heartbeat del primer lock queda corriendo para siempre.

**Fix (junto con A6):** usar `authManager.activeChild` como guard único, seteando un flag "ejecutando" **antes** de los awaits.

---

### A6 — Al cerrar la app con un proceso corriendo, el script hijo y Chrome quedan huérfanos
**`electron-app/main.js:238-248`** (handler `closed`, código muerto) · `:278-282` (`before-quit`) · `src/auth/authManager.js:986` (`shutdown`, nunca llamado) — **Verificado ✓**

`before-quit` (línea 278) solo llama `authManager.logout()`, que **no** mata `activeChild` ni limpia temporales. `authManager.shutdown()` **no se invoca desde ningún lado** (grep vacío). El `if (currentProcess) currentProcess.kill()` del handler `closed` es código muerto por A5 (siempre null).

**Escenario de fallo:** el usuario cierra la app en media procuración → el fork sigue vivo ejecutando la automatización contra el PJN sin UI; Chrome queda abierto; el lock de ejecución del servidor queda tomado hasta que expire el TTL; la carpeta temporal segura (con los `.enc` y wrappers) nunca se borra (la auto-limpieza de huérfanas corre cada 5 min **solo mientras la app está abierta**, y `cleanupAll` nunca corre porque `shutdown()` no se llama).

**Fix:** en `before-quit`, matar `authManager.activeChild` y llamar `authManager.shutdown()`. Comparte causa raíz con A5 (la ejecución migró a `activeChild` y `currentProcess` quedó vestigial). **Requiere release de Electron.**

---

## 3. Medios

| id | Bug | Ubicación | Estado |
|---|---|---|---|
| **M1** | Cron de reset mensual (`0 3 1 * *`) resetea **todas** las suscripciones `active` el día 1 sin mirar ciclo de facturación ni `payment_provider`. Efecto (a): un usuario activado por admin sin pago (active + `payment_provider IS NULL`) recibe `usage_count=0` cada mes → trial de 20 usos renovable para siempre. Efecto (b): una cuenta paga facturada el día 20 ya se resetea en su fecha de cobro (`applyRenewal`) → el reset del día 1 le da un **segundo reset gratis** → hasta ~2× cuota por ciclo. | `server.js:484-503` (WHERE en `:496`) | Verificado ✓ |
| **M2** | El tope del trial (20 usos globales) no se enforza server-side cuando llega `subsystem`: `getSubsystemForScript` (`authManager.js:19-34`) devuelve `proc`/`batch`/`informe` para los scripts principales → un trial entra por la rama de submódulo (`client.js:317-379`), que gatea contra los límites del **plan** (COMBO 50/50/20), no contra `usage_count < usage_limit` (20). El UPDATE de esa rama tampoco incluye la condición `usage_count < usage_limit`. Un cliente adulterado (o con el pre-check global bypasseado) ejecuta 50+50+20 usos server-aceptados en trial. **Es exactamente SEC-4, agravado:** incluso `log-execution` —citado como "el enforcement del servidor"— no frena el trial en esta rama. | `client.js:317-379` | Verificado ✓ |
| **M3** | TOCTOU en el lock de ejecución: el SELECT de chequeo y el `INSERT ... ON CONFLICT DO UPDATE` no son atómicos y el upsert **pisa `machine_id` incondicional**. Dos dispositivos del mismo usuario que llaman `/execution/start` casi simultáneo pasan ambos el SELECT (sin fila), ambos upsertean, el segundo sobreescribe → **ambos corren la automatización a la vez** (rompe el anti-concurrencia) y los heartbeats del primero devuelven 404. Nota: el TTL real es 5 min pero el mensaje de error dice "aguardá 30 minutos" (`:34`). | `license.js:25-50` | Reportado |
| **M4** | El flujo de pago aprobado (insert en `payments` → `applyTrialBonus`/`applyRenewal` → UPDATE `subscriptions` → UPDATE `users`) son 4+ statements **sin transacción**. Si el proceso muere entre el insert del pago y el apply (deploy con `pm2 restart`, crash), queda el pago registrado pero los contadores sin resetear y la cuenta sin reactivar. Normalmente el reintento del webhook lo curaría, pero **C2(b) bloquea el reintento** → la inconsistencia es permanente. | `webhooks.js:194-250` | Verificado ✓ (parcial) |
| **M5** | `_lastKnownCuit` (cache anti-blip) no se limpia en el handler `logout` (`main.js:923-939`). Usuario A (CUIT X) cierra sesión; B inicia sesión en la misma PC; si su primer `verifySession` pasivo tiene un blip de red, `resolveUserDescargasDir()` cae a `_lastKnownCuit = X` → "Abrir descargas"/"Ver Excel"/"Ver resultados"/`clean-folder 'all'` operan sobre la carpeta de A (con `clean-folder 'all'` **se vacía la carpeta de otro usuario**). Contradice el aislamiento por CUIT de D6. | `main.js:996,1000-1006` | Verificado ✓ |
| **M6** | `list-expedientes` llama `executeRemoteScriptAsLocal('listarSCWPJN.js', ...)` sin `extraEnv: buildRunEnv(cuit)`, sin `cuitOverride`, sin `acquireExecutionLock` y con el guard muerto de A5. Resultado: el script resuelve `getDataPath()` sin `PROCURADOR_DATA_DIR` → escribe en la carpeta raíz compartida (rompe el aislamiento por CUIT), ignora el modo headless configurado y puede correr en paralelo con otro dispositivo. | `main.js:1423-1452` | Reportado |
| **M7** | Reactivar una parte inactiva del Monitor saltea el límite de partes del plan: el chequeo `usadas >= limite.maxPartes` (`:211`) solo corre en el camino de INSERT nuevo; el de reactivación (parte con `activo=false`) reactiva sin contar. Un COMBO con 20/20 partes activas + 5 borradas re-agrega esas 5 → 25 partes monitoreadas. Además la reactivación resetea `fecha_creacion=NOW()` → nueva gracia de borrado de 24 h. | `monitor.js:179-211` | Reportado |
| **M8** | El JWT del usuario se escribe en texto plano en `config_monitoreo.json` (`main.js:2343-2346`), pasado al fork del monitor vía `extraFiles`. El token (válido ~1-2 h) queda en la carpeta temporal durante toda la corrida; si la app se cierra/crashea antes del `close` del child (ver A6), el archivo persiste en disco (la auto-limpieza no corre con la app cerrada). | `main.js:2343` | Reportado |
| **M9** | `/checkout/init` muta el plan en DB (`plan`/`plan_id`/`plan_expiry_date`) al **generar** el init_point para `suspended_plan_expired`/`cancelled`, no al confirmar el pago. Si el usuario abre el checkout y lo abandona, la suscripción ya quedó mutada (plan nuevo persistido, `plan_expiry_date` del plan retirado pisado). Probar `/init` con plan A y luego B sin pagar deja el estado del último intento. | `checkout.js:64-75` | Reportado |
| **M10** | Detener un proceso manualmente se reporta como error/fallo: `stopCurrentProcess()` manda SIGTERM → el child cierra con `code=null` → `reject({ error: 'Código null' })`; `isSigtermError()` (`main.js:1399-1402`) busca "killed/sigterm/señal" y **"Código null" no matchea** → `stopped=false`, `updateRunStats(tipo, false)` cuenta un fallo, el renderer muestra flujo de error y salta un toast de error por una detención voluntaria. (El batch de informes se salva porque además chequea `stopRequested`.) | `authManager.js:876-883,936` | Reportado |

---

## 4. Bajos

| id | Bug | Ubicación |
|---|---|---|
| **B1** | `run-process-custom-date` modifica `config_proceso.json` con la fecha custom y restaura en el `finally`. Si la app muere a mitad (crash, update de electron-updater, apagón), la config queda con la fecha custom **para siempre** → todas las procuraciones "de hoy" futuras procuran desde esa fecha vieja sin aviso. El `.backup` queda en disco pero nada lo consume al arrancar. | `main.js:1274-1301` |
| **B2** | `PUT /usuarios/api/profile`: el guard usa falsy (`!nombre && !apellido...`) pero las ramas usan `!== undefined`. Un body `{ nombre: null, apellido: "X" }` pasa el guard y ejecuta `nombre.trim()` → `TypeError` → 500. No corrompe datos (el UPDATE no llega a correr), pero es un crash trivial de disparar. | `usuarios.js:16-31` |
| **B3** | Blacklist de tokens efectiva solo en memoria del proceso: `isBlacklisted()` mira solo el Map local; la BD se lee únicamente en `init()`, y el INSERT async es fire-and-forget (catch silencioso). Con `instances: 1` funciona, pero cualquier escalado a **cluster** rompe el fix M-1 (el logout solo invalida en el worker que lo atendió) y un restart tras un INSERT fallido revive el token deslogueado. | `tokenBlacklist.js:69-103` |
| **B4** | `verify-session` hace `new Date(user.expires_at)` con NULL → `1970-01-01` → `expiresAt < now` → 403 "Tu suscripción ha expirado" para cualquier suscripción activa con `expires_at NULL` (p. ej. admins reseteados). Mensaje engañoso. | `client.js:71-79` |
| **B5** | `POST /monitor/log` inserta `parte_id` del body en `monitor_consultas_log` sin verificar que la parte sea del usuario → IDOR de escritura menor (contamina el historial por parte que ve el admin). Además el incremento de `monitor_novedades_usage` no chequea tope server-side (solo lo frena el pre-check del cliente). | `monitor.js:648-673` |
| **B6** | `open-url-in-chrome` hace `spawn(chromePath, [url])` con `url` del renderer sin validar → un string tipo `--load-extension=...` se pasa como flag de Chrome, no como URL. `open-external-url` hace `shell.openExternal(url)` sin validar esquema (acepta `file://`, `ms-settings:`, etc.). Requiere renderer comprometido (XSS en la UI), por eso bajo. | `main.js:617-645` |
| **B7** | El "sandbox" VM de `scriptExecutor.js` pasa `process.env` real por referencia al contexto y `customRequire` delega en el `require` real para módulos no relativos (`fs`, `child_process`). El aislamiento es cosmético. Los scripts vienen firmados por el propio servidor (RSA), así que es defensa-en-profundidad rota, no vulnerabilidad explotable hoy. | `scriptExecutor.js:29-31,62-66,109-116` |
| **B8** | Rate-limit del chat IA en un Map en memoria que nunca se poda y se reinicia con cada restart de PM2 (`max_memory_restart: 400M`) → un abusador supera el cupo 20/h tras cada reinicio. Costo Haiku bajo → impacto económico chico. | `client.js:789-811` |

---

## 5. Descartados tras verificación (para no re-investigar)

- El pre-check de límites de **batch** sí existe (`renderer.js:2905` llama `getBatchLimits` antes de `runProcessCustom`).
- `checkSubsystemLimit` fallando "open" ante error de red es **diseño documentado** (el server frena en `log-execution`; salvo por C1).
- `latestFileBy` es correcto (ordena por `mtime`, no por nombre — fix de v2.7.35).
- El doble `releaseExecutionLock` (stop-process + `finally`) es inofensivo (idempotente).
- No hay **SQL injection**: todas las interpolaciones `${col}` en queries usan whitelists internas (verificado en `admin.js` y `client.js`).
- Todos los endpoints admin revisados tienen `authenticateAdmin`.

---

## 6. Plan de arreglo sugerido (orden de ataque)

| Paso | Ítems | Alcance | Racional |
|---|---|---|---|
| 1 | **C1** | Backend, 1 línea, sin release | Grave y de fix trivial: `WHERE ${usageCol} < $2`. |
| 2 | **C2 + A1 + M4** | Backend, sin release | Camino del primer pago real. **Prerequisito de B3 (MercadoPago producción).** Dedup por `processed_at`, transacción en el flujo de pago, `applyTrialBonus` setea `next_billing_date`/`status`. |
| 3 | **A4** | Backend, sin release | Seguridad rápida: escapar email + respuesta genérica + `loginLimiter`. |
| 4 | **A2 + A3** | Backend, sin release | Integridad de cobro: techo de ventana + limpiar `checkout_initiated_at`; validar dueño en `linkPreapproval`. |
| 5 | **A5 + A6** | Electron, **requiere release** | Comparten causa raíz: guard único por `activeChild` seteado antes de los awaits + matar `activeChild` y `shutdown()` en `before-quit`. |
| 6 | **M1, M2** | Backend, sin release | Monetización: condicionar el reset mensual al ciclo/`payment_provider`; mover el enforcement del trial a `/license/execution/start` (= SEC-4 del backlog de seguridad). |
| 7 | **M3, M5–M10, B1–B8** | Mixto | Lote posterior, priorizar M3/M5 (integridad) y B2 (crash trivial). |

> Los pasos 1–4 y 6 son solo backend (deployables sin tocar la app). El paso 5 necesita release de Electron (bump de versión + tag + `npm run release`, ver checklist en CLAUDE.md).

---

## 7. Cómo se relevó

Tres revisores en paralelo, cada uno con foco acotado y consigna de reportar solo bugs reales (no estilo), con `archivo:línea`, escenario concreto, severidad y confianza:
1. **Backend cobranza/auth** — `auth.js`, `checkout.js`, `webhooks.js`, `subscriptionService.js`, `invoiceService.js`, parte de `usuarios.js`.
2. **Backend ejecución/cuotas** — `server.js` (crons), `client.js`, `license.js`, `monitor.js`, `admin.js` (suscripciones/beneficios), middlewares.
3. **App Electron** — `main.js`, `authManager.js`, `backendClient.js`, `scriptExecutor.js`, `preload.js`.

Cada hallazgo alto/crítico se verificó manualmente leyendo la línea exacta y, cuando aplica, el otro lado del flujo (cliente ↔ servidor). Los medios/bajos marcados "Reportado" son coherentes con el código adyacente leído pero no se releyeron línea por línea.
