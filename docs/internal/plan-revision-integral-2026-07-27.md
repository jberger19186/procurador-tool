# Plan de revisión integral — terreno no cubierto (2026-07-27)

> **Qué es esto.** Un plan de revisión de bugs sobre la superficie del proyecto que **ninguna
> de las revisiones anteriores tocó**. No re-testea nada ya cerrado.
>
> **Por qué existe.** Las tres pasadas de bugs de julio (B1-B10, C1-C5, D1-D6) encontraron
> **21 hallazgos reales en 21 intentos** — cada pasada sobre terreno nuevo encontró bugs. El
> patrón indica que la superficie sin revisar todavía tiene hallazgos; este plan la mapea y la
> parte en bloques ejecutables.
>
> **Estado:** propuesta lista para ejecutar. **No se modificó código al armarlo** (solo lectura
> + consultas a la DB de producción).
>
> **Elaborado con:** Opus 5. **Para ejecutar con:** ver §5 (modelo y esfuerzo por bloque).

---

## 1. Mapa de cobertura — qué YA está revisado (NO re-testear)

Esta tabla es la que evita repetir trabajo. Si un ítem está acá, **el ejecutor no debe volver
a mirarlo** salvo que un hallazgo nuevo lo toque de refilón.

| Área | Cubierta por | Estado |
|---|---|---|
| Cobranza, suscripciones, webhooks, checkout, `subscriptionService.js` | `revision-bugs-2026-07-24.md` (B1-B10) + `informe-bugs-2026-07.md` (lote 2A) | ✅ 10 hallazgos cerrados |
| Cuotas y límites por submódulo, `license.js`, `monitor.js`, `client.js` | B4/B5/C2 + lote 2B + SEC-4 | ✅ cerrado |
| `auth.js`, `admin.js`, `tickets.js`, `invoiceService.js`, rate limiting, estáticos de `server.js` | `revision-bugs-2026-07-25.md` (C1-C5) | ✅ 5 hallazgos (C4 diferido con fundamento) |
| Extensión Chrome, `utils/mailer.js`, `legal.js`, `analytics.js`, `scripts.js`, `extension.js` | `revision-bugs-2026-07-25b.md` (D1-D6) | ✅ 6 hallazgos cerrados |
| Seguridad: SQLi, IDOR, CORS, TLS, JWT, blacklist, XSS del dashboard, firewall, device-binding | `informe-seguridad-sec1-2026-07-13.md` + M-1/M-2 + B-1..B-8 | ✅ sin críticos; XSS-1 y NET-1 corregidos |
| Infra en vivo: PM2, disco, RAM, certs, backups, huérfanos de DB, logs, crons corriendo | `revision-salud-2026-07-25.md` | ✅ todo verde |
| Funcionalidad end-to-end (37 casos) | `plan-pruebas-integral-2026-07.md` — Bloque R | ✅ 37/37 (solo R9.1/R9.2 pendientes por presencia física) |
| Handlers de lote de Electron | C2 | ✅ cerrado |
| Dependencias (`npm audit`) | D3/D4 + revisión de salud | ✅ 5 restantes, todas aceptadas con fundamento |

**Los 3 pendientes conocidos de la extensión** (logo sin click, jurisdicción en Notificaciones,
`checkExtensionVersion()` huérfano) **quedan fuera de este plan** — ya están documentados y
agrupados para el próximo bump de versión.

---

## 2. Mapa del hueco — qué NUNCA se revisó

Medido sobre el código real del repo (tamaños en bytes, verificados el 2026-07-27).

| Superficie | Tamaño | ¿Revisada? |
|---|---|---|
| **Scripts de automatización Puppeteer** (`backend-server/scripts/`) | **~370 KB / 19 scripts** | ❌ **Nunca, en ninguna pasada** |
| `electron-app/renderer.js` | 180 KB | ⚠️ Solo los modales de lote (C2) |
| `electron-app/main.js` | 126 KB | ⚠️ Solo `checkSubsystemLimit` + handlers de lote |
| `public/dashboard/dashboard.js` | 313 KB | ⚠️ Solo los campos del fix XSS-1 |
| `public/usuarios/app.js` | 132 KB | ⚠️ Solo `doLogout()` (RI-5) y avisos de cuota |
| `electron-app/src/auth/authManager.js` | 44 KB | ❌ Nunca |
| Los **11 crons** de `server.js` | — | ⚠️ Solo la lógica interna de 3 de ellos (B1/B5/B6) |
| `onboarding/tour.js` + `onboarding.js` | 48 KB | ❌ Nunca |
| `informe/generador_excel.js` + `generador_visor.js` + `visorModal_template.html` | 24 KB + template | ❌ Nunca |
| Schema de DB (índices, constraints, tipos) | 27 tablas | ⚠️ Solo huérfanos en 4 relaciones |

> **Lectura del cuadro:** el motor que el cliente efectivamente paga — la automatización contra
> el PJN — es la única parte grande del producto **sin una sola pasada de revisión de código**.

---

## 3. Hallazgos ya detectados al armar este plan

Dos cosas aparecieron durante el escaneo. **No se corrigieron** (esto es un plan, no una
ejecución), pero quedan documentadas acá para que el ejecutor arranque con ventaja.

### P-1 — Cualquier usuario con trial puede descargar los scripts de operación del servidor
**Severidad estimada:** 🔵 Bajo-Medio · **Área:** superficie de distribución

`GET /client/scripts/download/:scriptName` (`routes/client.js:153`) solo valida que el usuario
tenga suscripción viva — **no filtra por nombre de script ni por plan**. `GET /scripts/available`
(línea 238) directamente lista `SELECT ... FROM encrypted_scripts WHERE active = true`, con el
comentario `-- puedes filtrar por plan si quieres` sin implementar.

La tabla `encrypted_scripts` de producción tiene **19 scripts**, y 5 de ellos **no tienen nada
que ver con el cliente** — son scripts de operación del servidor que el `reencrypt_scripts.js`
barre indiscriminadamente desde el directorio `scripts/`:

| Script | Qué es |
|---|---|
| `backup-db.js` | Backup de la DB + subida a DigitalOcean Spaces |
| `reset-admin-password.js` | Reset de contraseña de admin (**ni siquiera está en el repo** — vive solo en el server) |
| `data-retention.js` | Job de retención de datos |
| `canary-test.js` | Canary con envío de email |
| `test_registro.js` | Script de prueba |

**Severidad acotada con honestidad:** los scripts **no contienen secretos hardcodeados**
(verificado — leen todo de `process.env`, que no existe en la máquina del cliente). Lo que se
expone es **arquitectura interna**: nombres de base y usuario por defecto (`procurador_db` /
`procurador_user`), el bucket y la región de Spaces (`procurador-backups` / `nyc3`), el host SMTP,
la lógica de retención y la existencia misma de un reset de contraseña de admin. Están cifrados y
firmados, pero **la app cliente tiene la capacidad de descifrarlos por diseño** — es lo que hace
en cada ejecución.

**Fix probable (a validar en la revisión):** whitelist de los ~10 scripts que el cliente realmente
ejecuta, aplicada en los dos endpoints; y que `reencrypt_scripts.js` deje de barrer el directorio
entero. Ninguna de las dos cosas rompe nada existente.

### P-2 — Los visores HTML embeben datos del PJN sin escapar
**Severidad estimada:** 🟡 Medio (a confirmar) · **Área:** XSS local

`visorModal_template.html` usa `innerHTML` en **6 lugares** y **no existe ningún helper de
escapado** — ni en ese template, ni en `generador_visor.js`, ni en `procesarNovedadesCompleto.js`
(que es el que genera el HTML del visor con los datos embebidos). Verificado por grep:
`escapeHtml|sanitiz` → **cero coincidencias**.

Los datos que se embeben (carátulas, nombres de partes, texto de movimientos) vienen del PJN.
El vector es acotado — el atacante tendría que lograr meter HTML en un campo de un expediente
judicial, y el visor abre en el navegador local del usuario, no en un origen con sesión — pero
**es exactamente el mismo patrón de clase que XSS-1 (dashboard) y D2 (mailer)**, y los dos
resultaron ser hallazgos reales. Merece una pasada seria antes de descartarlo.

---

## 4. Los bloques de revisión

Seis bloques, independientes entre sí. Cada uno es **una sesión propia con contexto fresco** —
no intentar dos en la misma sesión: los archivos son grandes y el contexto se degrada.

Orden recomendado por rendimiento esperado (impacto × probabilidad ÷ costo).

---

### 🔴 Bloque E1 — Motor de automatización Puppeteer
**El más importante. Nunca revisado. Es lo que el cliente paga.**

**Alcance (~370 KB, 13 scripts vivos):**
- `testM2.js` (101 KB) — **la librería núcleo**: sesión, `configuracionesGenerales`,
  `iniciarSesion`, `nuevaConsultaPublica`, `iterarTablaActuaciones`. La usan *todos* los demás.
  Empezar por acá.
- `consultarscwpjn.js` · `procesarNovedadesCompleto.js` · `procesarCustomExpedientes.js`
- `informequickscwpjn.js` (48 KB) · `listarSCWPJN.js` (39 KB)
- `procesarMonitoreo.js` · `monitoreo.js` · `buscarPorParteScwpjn.js` · `validarCampoParteScwpjn.js`
- `sessionManager.js` · `errorHandler.js` · `cerrarNavegador.js`

**Qué buscar (checklist):**
1. **Chrome huérfano** — rutas de error que salen sin llamar a `cerrarNavegador()` → procesos
   `chrome.exe` zombis que traban la próxima ejecución (síntoma histórico conocido del producto).
2. **Lock files** — el patrón documentado `SingletonLock/Cookie/Socket` que causa el `about:blank`.
   Verificar que toda salida por error lo respete, no solo el camino feliz.
3. **Retries y timeouts** — bucles de reintento sin tope, `waitForSelector` sin `timeout`,
   reintentos que re-loguean en loop.
4. **Aislamiento por usuario** — que **todo** camino de escritura respete `PROCURADOR_DATA_DIR`
   (el fix D6 encontró uno que se escapaba vía `__dirname`; buscar si quedan más).
5. **Credenciales en logs** — que ni el CUIT ni nada del PJN termine en `console.log` que el
   `scriptExecutor` capture y suba al servidor.
6. **Parsing frágil del DOM** — selectores del PJN sin guarda de "no encontrado" → excepción
   opaca en vez de mensaje claro.
7. **Conteo de usos** — que el resultado que reporta el script coincida con lo que `log-execution`
   cuenta (raíz del hallazgo #10 del Bloque R, aceptado como intencional pero sin auditar el resto).
8. **Concurrencia en `fork`** — estado compartido entre procesos hijos del informe por lote.

**Notas de ejecución:**
- Los scripts se distribuyen **cifrados**: un fix acá **no requiere release de Electron** — es
  editar + `reencrypt_scripts.js` + `pm2 restart`. Barato de corregir, caro de no revisar.
- La verificación empírica requiere el PJN real → dejar los casos que la necesiten marcados
  para una corrida asistida por el operador; el resto se verifica por lectura de código.

**Modelo/esfuerzo:** **Sonnet 5, esfuerzo ALTO.** Ver §5 para la justificación.
**Sesiones estimadas:** 2 (una para `testM2.js` + los 3 de procuración; otra para informe,
monitor y utilitarios).

---

### 🟠 Bloque E2 — Electron: `main.js`, `preload.js` y `src/`
**Alcance:** `main.js` (126 KB, ~60 handlers IPC), `preload.js`, `src/auth/authManager.js`
(44 KB), `src/api/backendClient.js`, `src/scripts/scriptExecutor.js` + `scriptCache.js`,
`src/browser/windowManager.js`, `src/notifications/notificationManager.js`,
`src/verification/dailyVerification.js`.

**Excluir:** `src/security/` — zona protegida (`⛔ NO TOCAR` en CLAUDE.md). Se puede **leer para
entender**, pero cualquier hallazgo ahí se reporta y **no se corrige** sin decisión explícita.

**Qué buscar:**
1. **Handlers IPC sin validación** del payload que llega del renderer (el renderer es el límite
   de confianza más débil de la app).
2. **Path traversal** en los handlers que abren/limpian/copian archivos (`get-visor-path`,
   `get-latest-excel`, `clean-folder`, `select-batch-file`).
3. **Referencias huérfanas** — el mismo patrón que causó la regresión de v2.7.40/41. Grep
   sistemático de funciones eliminadas.
4. **Manejo de sesión** en `authManager` (44 KB, nunca revisado): refresh, heartbeat,
   `sessionVerified`, multi-cuenta por CUIT, la caché `_lastKnownCuit`.
5. **Secretos en disco** — `psc_accounts.enc`: qué se guarda, con qué clave, y si el token queda
   en claro en algún log.
6. **`dailyVerification.js`** — corre solo y llama flujos reales; nunca fue revisado como código.

**Modelo/esfuerzo:** **Sonnet 5, esfuerzo ALTO.**
**Sesiones estimadas:** 2 (una `main.js` + `preload.js`; otra `src/`).

---

### 🟠 Bloque E3 — Los 11 crons y la máquina de estados
**Alcance:** `server.js:524-875`. Los crons corren en cadena cada día entre las 11:00 y las 11:30
(`:00 :05 :10 :15 :20 :25 :30`), más el mensual (`0 3 1 * *`), el horario y el de cobranza (cada 6 h).

**Acotar explícitamente:** la **lógica interna** de los crons de cobranza ya fue revisada y
corregida (B1, B5, B6). Este bloque va por lo que **nadie miró: la interacción entre ellos**.

**Qué buscar:**
1. **Solapamiento y orden** — un cron a las 11:05 que cambia un estado que el de 11:10 asume
   estable. ¿El espaciado de 5 minutos alcanza si la DB crece?
2. **Idempotencia del conjunto** — si un cron falla a mitad y PM2 reinicia, ¿qué pasa al
   reejecutarse? (B6 arregló uno; ¿los otros 10?)
3. **Transiciones de estado imposibles** — combinaciones de `registration_status` × `status` ×
   `cancel_at` × `plan_expiry_date` × `payment_grace_ends_at` que ningún cron contempla.
4. **Queries sin índice** — full scans diarios sobre `subscriptions`/`users` que hoy no se notan
   con 3 filas y sí con 500.
5. **Errores silenciosos** — crons cuyo `catch` loguea y sigue, dejando datos a medio migrar.
6. **El cron comentado** (`invoice-retry`, línea 875) — confirmar que sigue siendo correcto
   tenerlo apagado.

**Modelo/esfuerzo:** **Sonnet 5, esfuerzo ALTO** (es razonamiento cross-estado, no lectura lineal).
**Sesiones estimadas:** 1.

---

### 🟡 Bloque E4 — Generadores de salida y onboarding
**Alcance:** `informe/generador_visor.js`, `informe/generador_excel.js`,
`visorModal_template.html`, y la generación de visores embebida en los scripts encriptados
(el `datosEmbebidos` de `procesarNovedadesCompleto.js` / `procesarCustomExpedientes.js`);
`onboarding/onboarding.js` + `tour.js`.

**Qué buscar:**
1. **P-2 (ya detectado): XSS en los visores.** Confirmar o descartar con rigor. Es el hallazgo
   más concreto que tiene este plan de arranque.
2. **Excel** — fórmulas inyectables (`=`, `+`, `-`, `@` al inicio de celda → CSV/formula injection
   al abrir en Excel con datos del PJN).
3. **Tour roto** — pasos que apuntan a selectores que cambiaron (el botón de Bitácora del topbar,
   los cambios de v2.7.33-43). Un tour que falla en el primer uso es la peor primera impresión.
4. **Onboarding** — el camino de re-entrada y el estado si el usuario lo abandona a la mitad.

**Modelo/esfuerzo:** **Sonnet 5, esfuerzo MEDIO.** Autocontenido y con patrón conocido.
**Sesiones estimadas:** 1.

---

### 🟡 Bloque E5 — Schema de DB + superficie de distribución de scripts
**Alcance:** las 27 tablas de producción; `reencrypt_scripts.js`; los 2 endpoints de scripts de
`client.js`.

**Qué buscar:**
1. **P-1 (ya detectado)** — el filtrado de scripts. Diseñar y validar la whitelist.
2. **Índices faltantes** — `EXPLAIN` sobre las queries calientes reales (heartbeat, `/client/account`,
   los crons, el listado de usuarios del dashboard).
3. **Constraints ausentes** — invariantes que hoy sostiene solo el código (el caso `payment_id`
   UNIQUE de junio y el `check_plan_valid` de julio muestran que este terreno da hallazgos).
4. **Drift de migraciones** — que `database/migrations/` esté aplicado por completo en prod **y**
   en staging (ya hubo drift documentado en staging).
5. **Tipos** — columnas de dinero, fechas con/sin timezone, `VARCHAR` sin límite.

**Modelo/esfuerzo:** **Sonnet 5, esfuerzo MEDIO.**
**Sesiones estimadas:** 1.

---

### 🔵 Bloque E6 — Frontends (dashboard + portal)
**Alcance:** `public/dashboard/dashboard.js` (313 KB) y `public/usuarios/app.js` (132 KB).

**Acotar por riesgo, NO leer completo.** 445 KB de DOM repetitivo no se revisan linealmente; se
revisan por patrón. Método: grep dirigido + lectura de las zonas que el grep marque.

**Qué buscar:**
1. **XSS residual** — el fix XSS-1 escapó los campos que la auditoría señaló, no todos.
   Grep de `innerHTML` con interpolación de datos de usuario y auditar cada uno.
2. **Token en `localStorage`** — cómo se guarda, cuándo se limpia, si se filtra a la URL.
3. **Llamadas a endpoints muertos** — mismo patrón que `checkExtensionVersion()`: grep de cada
   `fetch(` contra las rutas realmente montadas.
4. **UI que miente sobre el estado** — el caso "999999 usos de prueba" y el de la cortesía
   muestran que este es un patrón recurrente del proyecto.

**Modelo/esfuerzo:** **Sonnet 5, esfuerzo MEDIO.**
**Sesiones estimadas:** 1-2.

---

## 5. Modelo y esfuerzo — recomendación

Consultado explícitamente. Mi recomendación, con el razonamiento:

### Modelo: **Sonnet 5 para los 6 bloques.** No hace falta Opus.
Las tres pasadas de julio se hicieron con Sonnet y encontraron 21 hallazgos reales, varios de
severidad alta (C1, B1, B3). Esto es lectura de código y verificación empírica, no diseño novedoso
— es exactamente donde Sonnet rinde. Opus se justifica para *diseñar* planes (como éste) y para
decisiones de arquitectura, no para ejecutarlos.

**Excepción, misma regla que el Bloque R:** si un hallazgo toca **MercadoPago, cobro real o
movimiento de dinero**, escalar a Opus para el análisis de ese hallazgo puntual — y **avisar al
operador antes de cambiar de modelo, esperando confirmación**.

### Esfuerzo: **mixto, no uniforme.** Es donde te recomiendo apartarte del "medio" por defecto.

| Bloque | Esfuerzo | Por qué |
|---|---|---|
| **E1** Motor Puppeteer | **ALTO** | 370 KB de lógica async, con estado, reintentos y recuperación de errores, sin tests. Esfuerzo medio **va a skimear** y va a reportar lo obvio del camino feliz. Es además el bloque de mayor impacto. |
| **E2** Electron main/src | **ALTO** | `main.js` son 126 KB y los bugs vivos están en la **interacción** entre handlers (la regresión de v2.7.41 fue exactamente eso: una referencia huérfana que ni `npm start` cazó). Requiere sostener contexto cruzado. |
| **E3** Crons | **ALTO** | Razonamiento sobre una máquina de estados con 5 variables y 11 procesos que la tocan en cadena. El costo de un error acá es un cliente pagando bloqueado (que es literalmente lo que fue B1). |
| **E4** Visores/onboarding | **MEDIO** | Autocontenido, patrón conocido (XSS/escape), archivos chicos. |
| **E5** Schema/distribución | **MEDIO** | Mecánico y verificable por SQL. |
| **E6** Frontends | **MEDIO** | Volumen alto pero patrón repetitivo; el método es grep dirigido, no lectura profunda. |

**Por qué "medio" alcanzó en las pasadas anteriores y acá no del todo:** aquellas trabajaron sobre
archivos **chicos y autocontenidos** (`tickets.js` 6 KB, `mailer.js` 27 KB, `legal.js` 15 KB) donde
un archivo entra completo en contexto y el razonamiento es local. E1/E2/E3 son lo contrario:
archivos de 100-180 KB con lógica distribuida entre ellos.

**Si preferís medio igual** (por costo), mi recomendación de compromiso: **E1 y E3 en alto**
(máximo impacto: el motor del producto y el cobro), **E2, E4, E5, E6 en medio**. Perdés
profundidad en E2, que es el bloque donde más probable es que quede algo sin ver — pero es una
concesión defendible.

---

## 6. Reglas de ejecución

Las mismas que funcionaron en las tres pasadas de julio. No improvisar sobre esto.

1. **Una sesión por bloque, contexto fresco.** No encadenar bloques.
2. **Verificar cada hallazgo `archivo:línea`** contra el código real. Nada de hallazgos "por
   patrón" sin confirmar que el código efectivamente lo hace.
3. **Verificar contra el estado real** (prod por SQL/SSH de solo lectura, o staging) cuando el
   hallazgo lo permita. Varios hallazgos de julio se descartaron así (B10) y otros se confirmaron
   con más gravedad de la reportada (C1, D2).
4. **La pasada de revisión NO modifica código.** Produce el informe con severidad, `archivo:línea`,
   solución propuesta y modelo/esfuerzo sugerido para el fix. **El operador decide qué se corrige.**
   (Este fue el método explícito de D1-D6 y funcionó bien.)
5. **Para los fixes, después:** backup de DB → staging → verificación empírica → backup de prod →
   prod. Sin saltos.
6. **Nunca `git add -A`.** Archivos explícitos por nombre.
7. **Antes de escribir a cualquier DB, verificar `DB_NAME`.** (Regla nacida del incidente del
   2026-07-24, donde una prueba apuntó por un instante a producción.)
8. **Si el ejecutor quiere cambiar de modelo o esfuerzo a mitad, avisa y espera confirmación.**
9. **Sin cortes por tiempo.** Los bloques se cierran cuando están cerrados.
10. **Un informe por bloque:** `docs/internal/revision-E<N>-<fecha>.md`, con el mismo formato que
    `revision-bugs-2026-07-25b.md` (resumen en tabla + detalle por hallazgo + qué se verificó sano).

---

## 7. Cómo arrancar

Sesión nueva, y el pedido:

> «Ejecutá el **Bloque E1** del plan `docs/internal/plan-revision-integral-2026-07-27.md`.»

El ejecutor debe leer **este documento completo** primero (§1 le dice qué NO mirar, §3 le da dos
hallazgos de arranque, §6 le da el método).

**Orden sugerido:** E1 → E2 → E3 → E4 → E5 → E6.
Si querés el mayor retorno con el menor gasto: **E1 y E4** solos ya cubren el motor del producto
y el hallazgo de XSS concreto.

---

## 8. Qué NO cubre este plan

Para que quede explícito y no se confunda con "el proyecto quedó 100% revisado":

- **R9.1/R9.2** — la extensión real contra el PJN con credenciales tuyas. Requiere tu presencia.
- **Los 3 pendientes de la extensión** — ya documentados, agrupados para el próximo bump.
- **Auditoría de seguridad externa profesional** — sigue recomendada antes del lanzamiento público
  (SEC-1 fue interna).
- **Pruebas de carga / concurrencia real** — nunca se hicieron. Con 3 usuarios en la DB no es
  urgente, pero es un hueco real de cara a B3.
- **`electron-app/src/security/`** — zona protegida; se lee, no se toca.
