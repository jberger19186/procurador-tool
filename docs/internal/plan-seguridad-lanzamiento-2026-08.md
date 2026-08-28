# Plan de auditoría de seguridad — Lanzamiento público (SEC-2)

> Fecha: 2026-08-24 · Diseñado con Opus 5 · **Solo diseño, no se tocó código ni producción**
> Sucesor de `informe-seguridad-sec1-2026-07-13.md`, cuyo veredicto fue **"apto para Beta
> controlada"** y explícitamente **no** para lanzamiento masivo.
> Eje: qué cambia en la superficie de riesgo al pasar de *"Beta con 3 cuentas reales y cobro en sandbox"*
> a *"registro público abierto + cobro real + datos personales de clientes reales"*.

---

## §0 — Estado medido el 2026-08-24 (no asumido)

> 🔄 **Revisado el 2026-08-28, al cerrarse la Etapa 1 del roadmap.** Las filas marcadas
> **(actualizado 28/08)** se volvieron a medir contra el servidor y la base de producción; el resto
> se mantiene tal como se midió el 24/08. El motivo del repaso es el que este mismo plan anticipaba
> en el aviso de vigencia de §2: la Etapa 1 construyó superficie que el 24/08 no existía. El cambio
> de mayor consecuencia es que **H-1 dejó de ser un hallazgo pendiente y pasó a ser un control vivo
> sin auditar** — ver §4.

| Qué | Valor | Por qué importa |
|---|---|---|
| `allow_public_register` en prod | **`true`** | 🚨 **El registro público ya está abierto.** El vector de abuso del bloque S4 no es hipotético: está vivo hoy, y sigue sin explotarse porque nadie encontró el producto todavía, no porque haya un control impidiéndolo. |
| `users` en prod | **3** *(re-verificado 28/08 tras la limpieza)* | Llegaron a ser 9: los 6 extra eran **fixtures de QA del 27/08** (`qa-sp-*@test.com`, `qa-n01-trial@test.com`) que quedaron en producción y **no se limpiaban solos** — `data-retention.js` exige `registration_status='pending_email'` **y** `email_verify_expires` no nulo, y los 6 tenían ese campo en `NULL`. Se borraron a mano el 28/08 (backup previo verificado, `DELETE` por ids explícitos, 0 huérfanos). **El dato que hay que retener no es el conteo sino lo que expuso:** la política de retención vigente es tan estrecha que no alcanzó a 6 cuentas de prueba obvias — eso es materia de **S3**. |
| `registerLimiter` | 3/hora **por IP** | Único freno al alta masiva. Nunca probado contra un atacante. |
| `data-retention.js` en crontab | **PRESENTE** — `0 4 * * *` *(actualizado 28/08)* | 🔄 **Cambió respecto del 24/08, cuando estaba ausente.** Lo agregó la mejora del smoke backend (F1, 2026-08-27), que además le corrigió un bug real al correrlo por primera vez: consultaba `usage_logs.created_at`, columna que no existe. Ver **H-1**, que pasa de hallazgo pendiente a **control vivo nunca auditado**. |
| Crontab del servidor, completo | `backup-db` 03:00 · `data-retention` 04:00 · `canary-test` 07:00 · **`health-check` 08:00** *(actualizado 28/08)* | `health-check.js` es código nuevo de la Etapa 1 (295 líneas) que corre desatendido **y manda emails**. Su revisión de código es la fase **F10** de la Etapa 2; acá importa como superficie que no existía. |
| `users.cuit_deleted_at IS NOT NULL` | **0 filas** | El circuito de baja + liberación de CUIT a 90 días nunca se ejerció con datos reales. |
| Almacén de borradores anónimos | Tope **global** de 100, desalojo FIFO, en memoria | Ver **H-2**. |
| `MAX_BACKUP_BYTES` (import Bitácora) | 10 MB, **sin rate limit propio** | Ver **H-3**. |
| Rate limiters totales | 9 (3 agregados **después** de SEC-1) | Los umbrales nuevos nunca se validaron bajo volumen. |
| `showToast`/`showConfirm`/`showPrompt` (dashboard) | **Escapan con `escHtml`/`escAttr`** | ✅ Verificado hoy: la migración de VF-3 (71 sitios, 2026-08-24) **no** reintrodujo XSS-1 en las primitivas. Dato para que S5 no gaste esfuerzo ahí. |

---

## §1 — Qué cambia con el lanzamiento (el eje del plan)

Cada bloque de §3 tiene que justificar por qué importa **más** después del lanzamiento. Los cuatro
cambios estructurales que lo justifican:

| Cambio | Consecuencia de seguridad |
|---|---|
| **De 3 cuentas reales conocidas a N desconocidas** | Todo control cuyo único freno hoy sea "nadie lo intentó" pasa a estar expuesto. Los topes globales compartidos (borradores, rate limits por IP) dejan de ser teóricos. |
| **De cobro sandbox a dinero real** | El fraude de negocio pasa de costar nada a costar plata. Un abuso de cuota ya no es una métrica sucia, es servicio regalado. |
| **De datos de prueba a datos personales reales** | CUIT, domicilio y teléfono de abogados matriculados quedan bajo Ley 25.326. La obligación no depende del volumen: aplica desde el primer cliente. |
| **De uso supervisado a uso desatendido** | Nadie va a estar mirando el log cuando pase. Los controles tienen que fallar cerrado y dejar rastro, no depender de que alguien note la anomalía. |

---

## §2 — Qué NO se re-testea, y qué sí se invalidó

SEC-1 §5 verificó ~30 controles OK. **No se re-testean**, con **cuatro excepciones justificadas**:
no porque el control se haya roto, sino porque **cambió la superficie sobre la que se verificó**.

| Control de SEC-1 | Estado | Justificación de re-test |
|---|---|---|
| **S4.1 — SQL injection** | ⚠️ **Parcialmente invalidado** | Se verificó sobre el código de julio. Bitácora agregó ~15 endpoints y 4 tablas **después**. La inspección de hoy muestra consultas parametrizadas, pero **auditado ≠ leído por encima**. Re-test acotado **solo a la superficie nueva** (S2). |
| **S3.2 — IDOR** | ⚠️ **Parcialmente invalidado** | Ídem. V3 de la campaña `/verify` cubrió 4 combinaciones de IDOR en Bitácora — es cobertura real y cuenta, pero no alcanza a los ~15 endpoints nuevos completos (S2). |
| **S5.4 — CORS** | ⚠️ **Invalidado** | SEC-1 verificó que no hay `Access-Control-Allow-Origin: *` en endpoints autenticados. **Después** se agregó `PUBLIC_OPEN_CORS_PATHS` (D4, 2026-07-25) para `/analytics/event` — un array que **no existía** cuando se hizo esa verificación. Hay que confirmar que solo cubre ese path y que no se ensanchó (S4). |
| **S2.6 — Rate limiting** | ⚠️ **Umbrales nuevos sin validar** | El control existe, pero se agregaron 3 limiters posteriores (`generalAuthLimiter`, `analyticsEventLimiter`, `captureLimiter`). El de `generalAuthLimiter` se fijó con *"el pico medido fue 10 req/min desde una sola IP"* — un dato de **una sesión de testing**, no de tráfico real (S7). |

Todo el resto de SEC-1 §5 (JWT, blacklist, política de contraseñas, anti-enumeración, authz admin,
TLS, headers, firma RSA, autodestrucción, credenciales PJN, permisos de la extensión) **se da por
vigente y no se vuelve a probar.**

> ⏳ **Advertencia de vigencia de este propio plan (agregada 2026-08-26).** La tabla de arriba mide la
> superficie **al 2026-08-24**. Este plan se ejecuta en la Etapa 3 del roadmap, es decir **después** de
> que la Etapa 1 construya cosas que hoy no existen. Cuando llegue el momento, verificar contra el
> [roadmap](roadmap-salida-a-mercado-2026-08.md) qué se construyó en el medio, con el mismo criterio
> que se usó acá: **no se re-testea un control porque sí, se re-testea cuando cambió la superficie**.
> Lo ya identificado y absorbido: el módulo Markdown (ítem 1.2) tiene bloque propio, **S10**; el export
> `.ics` de Bitácora F3.4 (ítem 1.1) entra dentro de **S2**, sin bloque propio.
>
> ✅ **Esa revalidación se hizo el 2026-08-28**, al cerrarse la Etapa 1 completa, y produjo tres cambios
> que ya están aplicados en este documento: **(1)** bloque **S11** nuevo — la demo de la Etapa 1.6
> publicó una superficie pública que guarda el JWT del usuario en el origen de la landing, y ningún
> bloque la miraba; **(2) H-1 dejó de ser un hallazgo pendiente** — `data-retention.js` se activó el
> 27/08, así que S3 lo toma como control vivo sin auditar en vez de como algo por decidir; **(3)** §0
> re-medido (9 usuarios, crontab real) y S10 precisado con el código ya construido a la vista. El resto
> del plan quedó sin tocar: la Etapa 1 **no modificó una sola línea de la cadena de cobro**, así que S8
> y todas las premisas de cobranza siguen intactas.

---

## §3 — Los bloques

### 🔴 S1 — Superficie anónima: `/usuarios/capture` y el almacén de borradores

> **Sonnet 5 · esfuerzo ALTO · staging** · ~10 KB de código, consecuencias desproporcionadas

**Por qué importa más después:** es el **único endpoint sin autenticación del sistema**, alcanzable
desde internet por cualquiera. Con 3 cuentas reales nadie lo buscó; publicado, es el primer lugar donde
mira alguien que audite la app desde afuera.

**Qué se prueba:**
- El tope global de borradores como **DoS dirigido** (hipótesis **H-2**): ¿100 POSTs desalojan las
  capturas de usuarios legítimos? Medir el efecto real, no leer el código.
- Que el `Location` del 303 **nunca** refleje input del cliente (open redirect). Ya se probó en F2.2
  con `goto=https://evil.example.com`; re-verificar que ningún campo nuevo se coló al redirect.
- Consumo de memoria del buffer bajo carga sostenida dentro del rate limit.
- Que un `draft` no pueda ser reclamado por un usuario distinto del que lo generó — o determinar
  explícitamente que **no hay forma de saberlo** (el POST es anónimo) y evaluar qué expone eso:
  un id filtrado permite a otro usuario autenticado reclamar una captura ajena.

**Cómo:** harness HTTP contra staging (patrón de `verify-v3-bitacora-api.js`), midiendo `_stats()`
del almacén entre pasos.

---

### 🔴 S2 — Camino destructivo: import/export de Bitácora

> **Sonnet 5 · esfuerzo ALTO · staging** (⚠️ el modo `reemplazar` **borra datos**; nunca contra prod)

**Por qué importa más después:** `POST /bitacora/import?modo=reemplazar` es **el único camino del
sistema que borra datos de un usuario**. Hoy el peor caso es perder fixtures; con clientes reales,
es perder la agenda de vencimientos de un abogado — el tipo de dato cuya pérdida tiene consecuencia
profesional, no solo comercial.

**Qué se prueba:**
- **H-3**: 10 MB por request sin rate limit propio, solo `generalAuthLimiter` (300/5min) → hasta
  ~3 GB de parsing JSON en memoria en 5 minutos, por **un solo usuario autenticado**. Medir el
  impacto real en el proceso.
- Validación de pertenencia del backup: F1.7 la implementa (rechaza `user_id` ajeno) y se verificó
  en su harness. Re-verificar contra un backup **manipulado a mano** (no generado por el export).
- Que `reemplazar` no pueda dispararse por accidente ni por CSRF (¿hay protección de origen en un
  POST multipart autenticado por Bearer? Si el token va en header, CSRF clásico no aplica —
  **confirmarlo**, no asumirlo).
- **Exportación con gracia de 90 días post-baja:** ¿quién puede ejercerla? Un usuario `cancelled`
  o `suspended_admin` ¿puede seguir exportando? ¿Y un usuario **rechazado** (`rejected`)? La gracia
  fue diseñada para el que pierde el plan; hay que verificar que no sea una puerta para el que fue
  expulsado.
- SQLi e IDOR **acotados a los ~15 endpoints nuevos** (re-test justificado en §2).
- **Prototype pollution en el import `combinar`** *(agregado por el cruce con Strix, §S9).* El modo
  `combinar` fusiona el JSON del backup con los datos del usuario. Un backup con claves `__proto__`,
  `constructor` o `prototype` puede contaminar el prototipo de `Object` en el proceso del backend.
  Probar con un backup construido a mano que las incluya, y confirmar que el merge las ignora (o que
  usa un parseo que no las interpreta como claves de asignación).
- **Mass assignment en los endpoints que aceptan objetos del cliente** *(agregado por el cruce con
  Strix, §S9).* `PUT /usuarios/api/profile`, `POST/PUT /admin/plans` y los updates de suscripción
  aceptan campos y varios usan `COALESCE`. Verificar que un payload con campos **no previstos**
  (`role`, `usage_limit`, `registration_status`, `payment_provider`, `bitacora_enabled`) no se
  persista: que exista una whitelist de campos y no un spread del body. Es la vía por la que un usuario
  común se auto-otorgaría plan, cupo o rol admin.

---

### 🟠 S3 — Datos personales y retención (Ley 25.326)

> **Sonnet 5 · esfuerzo MEDIO · lectura de prod (solo lectura) + decisiones del operador**

**Por qué importa más después:** la obligación legal **no depende del volumen** — aplica desde el
primer cliente real. Hoy no hay ninguno, así que el incumplimiento es gratis; el día del lanzamiento
deja de serlo.

**Qué se prueba / decide:**
- **🔄 H-1 — el eje cambió el 2026-08-27, y hay que leerlo así:** cuando este plan se escribió,
  `data-retention.js` **no estaba en el crontab** y la tarea de S3 era decidir si se activaba. **Ya
  se activó** (`0 4 * * *`, agregado por la mejora del smoke backend). Entonces la pregunta pendiente
  ya no es *"¿lo prendemos?"* sino **"¿qué borró?"**, que es más urgente porque para cuando este
  bloque corra el script va a llevar semanas ejecutándose a diario sobre datos reales, sin que nadie
  haya mirado su salida. **Qué hacer:** leer `/var/log/procurador/data-retention.log` completo desde
  el 2026-08-27 y contrastar los conteos borrados contra lo esperado; confirmar que la condición de
  borrado de usuarios (`registration_status='pending_email'` **AND** `email_verify_expires` vencido
  hace >48 h) no puede arrastrar a nadie legítimo — en particular a alguien que verificó tarde; y
  decidir si esa condición es la política que se quiere, porque **hoy es tan estrecha que deja
  afuera a los 6 fixtures de QA del 27/08** (tienen `email_verify_expires` en `NULL` y sobreviven
  indefinidamente). Un script de retención que solo limpia un caso muy particular cumple la
  formalidad y no el principio.
- **Borrado real al dar de baja:** el circuito de liberación de CUIT a 90 días existe en el cron 5e
  pero **nunca se ejerció** (0 filas con `cuit_deleted_at`). ¿Qué queda del usuario después? ¿Los
  `user_events`, `payments`, `invoices` y las entradas de Bitácora sobreviven? ¿Debe ser así?
- **Backups — el alcance creció con la Etapa 1.4:** los dumps diarios van a DO Spaces con retención
  de 30 días, y un usuario que ejerce su derecho de supresión sigue existiendo en 30 backups. Definir
  la postura (es defendible conservarlos; lo que no es defendible es no haberlo pensado). **Nuevo
  desde el 2026-08-26:** `backup-db.js` ahora empaqueta y sube también **`storage/invoices/`** — los
  PDF de facturas reales, que llevan **CUIT y domicilio del cliente** y son documentos fiscales. O sea
  que la pregunta de supresión ya no es solo sobre filas de una base, sino sobre documentos con datos
  personales replicados a un tercero (DigitalOcean). Verificar dónde queda eso frente a la obligación
  fiscal de conservación, que **puede pesar más** que el derecho de supresión y ser la respuesta
  correcta — pero es una decisión, no un olvido.
- **Quién puede exportar datos de quién:** el admin puede ver CUIT/domicilio/teléfono de todos.
  ¿Queda registro de quién los consultó? Hoy `user_events` registra acciones sobre la cuenta, no
  lecturas.
- **Qué se le promete al usuario:** contrastar la Política de Privacidad publicada contra lo que el
  sistema hace de verdad. Una promesa incumplida en el texto legal es peor que no tener el texto.

---

### 🟠 S4 — Abuso del registro público y farmeo del trial

> **Sonnet 5 · esfuerzo MEDIO · staging**

**Por qué importa más después:** con `allow_public_register = true` (**ya activo**), cada cuenta
nueva regala **20 usos de trial** que consumen automatización real contra el PJN — o sea, costo de
infraestructura y de reputación de IP frente al PJN, no solo un número en una tabla.

**Qué se prueba:**
- Alta masiva: `registerLimiter` es 3/hora **por IP**. ¿Cuánto cuesta rotar IPs? ¿El CUIT único es
  freno real (un CUIT válido es un dato público) o solo un inconveniente?
- Farmeo del trial: N cuentas × 20 usos. ¿Hay algún control agregado por CUIT, por email de dominio,
  o por `machine_id`? **AUTH-1** ata la ejecución al dispositivo — evaluar si eso ya limita el farmeo
  en la práctica (una misma máquina con 10 cuentas) o si el binding se re-hace en cada login.
- Verificación de email como freno: ¿cuánto cuesta automatizar un alta completa con un email
  desechable?
- **CORS (re-test justificado):** confirmar que `PUBLIC_OPEN_CORS_PATHS` cubre solo `/analytics/event`.
- **Decisión de producto que sale de acá:** si el registro público queda abierto al lanzar o pasa a
  lista de espera / invitación. Es una palanca de riesgo más efectiva que cualquier control técnico.

---

### 🟡 S5 — Frontend admin: XSS en las secciones que XSS-1 no alcanzó

> **Sonnet 5 · esfuerzo ALTO · staging con stub** (`dashboard.js` = 331 KB)

**Por qué importa más después:** XSS-1 fue **Alta** porque un usuario común robaba la sesión del
admin. Ese vector escala con la cantidad de usuarios: hoy los 3 son de confianza; publicado, cualquiera
puede escribir en los campos que el admin renderiza.

**Qué se prueba:**
- XSS-1 corrigió **tickets, monitor y usuarios**. Las secciones **Pagos, Facturación, Feriados,
  Legal, Métricas, Diagnóstico y Scripts** nunca se auditaron para XSS. Barrer los campos de esas
  secciones que provienen del usuario o del PJN.
- **`legalPreview` — re-examen explícito:** renderiza `html_content` **sin escapar** dentro de un
  `<iframe srcdoc>`, y V2b confirmó que **un `<script>` se ejecuta de verdad**. Se documentó como
  *diseño correcto* porque el autor es siempre un admin. **Esa premisa hay que re-evaluarla para el
  lanzamiento:** ¿va a haber más de un admin? ¿un admin comprometido puede persistir código que
  corre en la sesión de otro admin? Puede seguir siendo aceptable — pero como decisión tomada, no
  heredada.
- **No re-testear** `showToast`/`showConfirm`/`showPrompt`: verificado hoy que escapan (§0).
- El portal de usuarios (`usuarios/app.js`, 222 KB) con el mismo criterio, priorizando lo que
  renderiza datos de **otro** origen (PJN, admin).

---

### 🟡 S6 — Motor Puppeteer y cliente Electron

> **Sonnet 5 · esfuerzo ALTO · local** (`scripts/` 460 KB + `main.js` 147 KB + `renderer.js` 183 KB)

**Por qué importa más después:** corre **en la máquina del cliente**, con su sesión del PJN abierta.
El argumento de venta del producto es *"las credenciales del PJN nunca pasan por nuestros servidores"*
— eso es una promesa comercial explícita, y conviene que esté auditada antes de hacerla a escala.

**Qué se prueba:**
- **Qué escribe a disco y con qué permisos.** Precedente directo: **E2-8** encontró el JWT completo
  del usuario en texto plano en `config_monitoreo.json` (corregido). El bloque E2 lo encontró
  buscando otra cosa; nunca hubo una pasada dedicada.
- Que ningún script filtre credenciales del PJN a logs, archivos temporales o payloads de red.
- Los visores HTML generados: **E4/P-2 corrigió el XSS** del template de procuración; verificar los
  otros generadores (informe, monitor) con el mismo criterio, ahora que los visores se comparten por
  mail (uno de los motivos por los que el token SSO se gateó en F2.6).
- Superficie del `contextBridge` de `preload.js`: qué expone al renderer y si algo de eso permite
  escapar del sandbox.
- **Qué NO se toca:** `electron-app/src/security/` (zona protegida). Se audita **cómo lo usan** los
  llamadores, no su lógica interna — mismo criterio que el plan Q6.

---

### 🟡 S7 — Disponibilidad: rate limits y DoS bajo volumen real

> **Sonnet 5 · esfuerzo MEDIO · staging exclusivamente** (⚠️ jamás contra prod)

**Por qué importa más después:** los 9 rate limiters nunca se probaron contra tráfico adversario.
El más amplio (`generalAuthLimiter`, 300/5min) se calibró con *"el pico medido fue 10 req/min desde
una sola IP"* — un dato de una sesión de testing de un solo usuario, extrapolado a población abierta.

**Qué se prueba:**
- Umbrales reales de los 9 limiters contra tráfico sostenido.
- **El caso del estudio jurídico tras NAT:** varios abogados comparten IP pública. `scriptDownloadLimiter`
  ya lo documenta como problema conocido (150/5min "porque comparten cupo"). Verificar cuántos usuarios
  concurrentes tras una IP hacen que el producto **se auto-deniegue** — un DoS accidental contra un
  cliente que paga es peor que uno malicioso.
- Agotamiento de recursos: el import de 10 MB (**H-3**), el buffer de borradores (**H-2**), y el
  parser de 5 MB del capture.
- Comportamiento con **`instances: 1`**: la blacklist de tokens y el almacén de borradores viven en
  memoria del proceso. Confirmar que sigue documentado como bloqueante para escalar horizontalmente
  — al crecer el tráfico, "subamos instancias" va a ser la reacción natural y **rompería ambos**.

---

### 🔴 S8 — Fraude de negocio con cobro real *(condicionado a B3)*

> **Opus 5 · esfuerzo ALTO** · **solo después** de la Fase C de `plan-mercadopago-produccion-2026-08-24.md`

**Por qué importa más después:** es el único bloque donde un hallazgo se mide en plata. **No se puede
ejecutar antes del switch a producción** — contra sandbox no prueba nada nuevo (V7 ya cubrió 40/40 ahí).

**Qué se prueba:** manipulación del plan pagado vs. aplicado (el guard B3 existe — verificarlo contra
MP real), reuso de un preapproval ajeno (`linkPreapproval` tiene protección anti-IDOR: confirmarla con
dinero real), la ventana de atribución de `markPaymentConfigured` con **dos checkouts concurrentes**
(riesgo de colisión ya documentado y aceptado para Beta — al lanzar deja de ser aceptable), y qué pasa
si un usuario reembolsa vía MP y conserva acceso (**A.4** del plan de MP — desde el 2026-08-26 la
política decidida es **corte inmediato**, así que acá el eje ya no es *"¿qué pasa si conserva
acceso?"* sino **verificar que la rama `refunded` corta de verdad**, y que no se la puede esquivar:
reembolso parcial, reembolso de un pago viejo mientras hay uno nuevo aprobado, o un `refunded` que
llega **después** de una renovación exitosa).

**⚠️ Nota de orden agregada el 2026-08-26 (resuelve una contradicción real del plan):** S8 exige que
B3 esté cerrado, pero el roadmap ubica la auditoría de seguridad (Etapa 3) **antes** de MercadoPago
producción (Etapa 4). No es un conflicto sino una partición: **S1–S7 + S9 + S10 + S11 se ejecutan en la
Etapa 3; S8 se ejecuta dentro de la Etapa 4**, después de la Fase C. Decirlo explícito evita el error de dar
"SEC-2 ejecutado" por cerrado con un bloque sin correr — que es exactamente el tipo de omisión que
este documento existe para prevenir.

---

### 🟠 S9 — Validación dinámica con Strix (pentest agéntico en runtime) *(agregado 2026-08-26)*

> **Sonnet 5 para la conducción · esfuerzo MEDIO** · **solo contra staging** · corre **último de la
> Etapa 3**, después de S1–S7 y de S10 — nunca antes

**Qué es Strix.** Un agente open-source de pentesting autónomo (`github.com/usestrix`, Apache 2.0).
Su toolkit combina **SAST + DAST**: puede tomar como target un repositorio o directorio (análisis
estático), una URL (caja negra), o una spec OpenAPI/Postman. **En este bloque se lo usa en su modo
dinámico** — atacar la aplicación corriendo — a propósito: el análisis estático de código ya es la
Etapa 2 (`plan-code-review-integral-2026-08-26.md`), y correr el SAST de Strix acá sería duplicarla.
Lo que aporta y no se solapa es el eje dinámico: navegador automatizado, shell, proxy HTTP de
intercepción (Caido), un runtime de exploits en Python, y **validación de cada hallazgo con una
prueba de concepto real** (no un warning estático). Se instala por script, corre en **Docker**, se
maneja por CLI (`strix --target <url|dir|repo|openapi>`) y consume una API key de LLM (soporta
Claude, entre otros).

**Por qué suma algo que los demás bloques no dan.** Todos los otros bloques son búsqueda dirigida:
Claude parte de hipótesis escritas y las confirma. Eso encuentra lo que se sospecha. Strix aporta el
eje contrario — **exploración no dirigida y explotación efectiva**: encadena pasos que nadie
hipotetizó y **demuestra** el hallazgo en vez de razonarlo. Es la diferencia entre *"este endpoint
parece vulnerable a IDOR"* y *"acá está el ID ajeno que devolvió 200"*.

Es también la mitad que el propio proyecto viene señalando sin nombrarla: los 4 bugs que rindió la
campaña `/verify` **no eran visibles leyendo el código**. Este bloque aplica el mismo principio al
eje de seguridad.

#### Cobertura: las clases que ataca Strix vs. los bloques de esta etapa

Strix cubre el OWASP Top 10 y más. La tabla mapea **cada clase que Strix explota** contra el bloque
dirigido de este plan que ya la mira desde una hipótesis escrita — para dejar explícito que S9 no
introduce un eje sin red, sino que **valida en runtime lo que el resto audita por lectura**, y para
marcar las clases donde S9 es la **única** cobertura no dirigida.

| Clase que ataca Strix | Bloque dirigido que la cubre | Nota |
|---|---|---|
| **IDOR / control de acceso roto** | S1 (reclamo de draft ajeno), S2 (endpoints nuevos), SEC-1 (baseline) | S9 encadena y demuestra |
| **Escalada de privilegios / auth bypass** | SEC-1 (authz admin, no re-testeado en §2) | S9 lo ataca sin hipótesis previa |
| **SQL injection** | S2 (superficie nueva de Bitácora), SEC-1 | — |
| **XSS (stored/reflected/DOM)** | S5 (admin), S6 (visores), S10 (módulo Markdown) | — |
| **SSRF** | S10 (URLs que salen del PDF) | ⚠️ SSRF **general** (webhooks, `fetch` a MP) solo lo cubre S9 |
| **Business logic / manipulación de pago** | S8 (cobro real, Etapa 4), S4 (farmeo del trial) | — |
| **Race conditions** | S8 (atribución por ventana), S1 (almacén de drafts) | S9 las provoca en runtime |
| **JWT / sesión / credential stuffing** | SEC-1 (JWT, blacklist) + S4/S7 (rate limits) | baseline no re-testeado |
| **Misconfig / servicios expuestos** | SEC-1 NET-1 (`ufw`) | S9 re-mapea desde afuera |
| **API: broken auth / rate-limit bypass** | S1/S2 (auth), S7 (umbrales) | ⚠️ el *bypass* del rate limit (spoofing de `X-Forwarded-For` con `trust proxy`) solo lo mira S9 |
| **Prototype pollution** | S2 (merge de JSON en el import `combinar`) — *hipótesis agregada por este cruce* | única cobertura dirigida: S2 |
| **Mass assignment** | S2 (endpoints con `COALESCE` que aceptan campos del cliente) — *hipótesis agregada por este cruce* | única cobertura dirigida: S2 |
| **XXE / deserialización insegura** | S2 (parseo del backup), S10 (`pdfjs-dist` sobre XFA) | superficie chica; S9 la explora |
| **OS command injection / SSTI** | — | N/A dirigido (sin template engine ni `exec` de input en el server); **S9 confirma la ausencia** |

**Consecuencia de la tabla:** las dos clases que **ningún bloque dirigido nombraba** (prototype
pollution y mass assignment) quedaron agregadas como hipótesis explícitas de **S2** (ver ese bloque),
así que ahora tienen cobertura por lectura *además* de la exploración de S9. El resto ya estaba
cubierto; S9 le agrega la demostración en runtime.

**Alcance:** `https://localhost:3444` **desde dentro del servidor** (bypassa Nginx y el basic-auth de
staging, exactamente como hizo el harness de V3), sobre la superficie autenticada y la anónima.

#### 🚨 Precondiciones de seguridad — sin estas, no se corre

Un agente autónomo con permiso de atacar va a **crear usuarios, disparar emails, subir archivos y
llamar a APIs externas**. Staging comparte credenciales con producción en dos servicios, así que hay
que cortar ambas salidas **antes** de arrancar:

1. **SMTP.** El `.env.staging` hereda el `.env` base → **Brevo real**. Un agente registrando cuentas
   dispara emails de verificación reales a direcciones inventadas, lo que quema reputación del
   dominio y puede costar el bloqueo de la cuenta. **Neutralizar el SMTP de staging antes de la
   corrida** (credenciales inválidas o un catch-all local) y confirmarlo con un envío de prueba que
   falle.
2. **MercadoPago.** Reusar el guard construido en agosto: poner `MP_ENV` en un valor distinto de
   `sandbox` en `.env.staging` hace que `utils/mercadopago.js` **anule el token al arrancar** — el
   entorno queda sin capacidad de cobro pero sigue sirviendo todo lo demás. Es exactamente el
   comportamiento que se quiere acá, y ya está verificado en las dos direcciones.
3. **Backup previo de `procurador_db_staging`** (`ops/backup-now.sh staging`) y **restauración al
   cerrar** (`ops/restore-db.sh`). La corrida va a dejar basura; eso es esperado, no un problema.
4. **Nunca contra producción.** Ni en modo lectura. No hay ninguna versión de este bloque que apunte
   a `procurador_db`.

#### Prerrequisitos a verificar antes de planificar la sesión

- **¿Hay Docker en el servidor?** No está confirmado — hay que mirarlo. Si no lo hay, la alternativa
  es correr Strix desde la máquina del operador contra el staging público (con las credenciales de
  basic-auth), que es más lento pero evita instalar Docker en el VPS de producción. **Instalar Docker
  en el servidor de producción para correr una herramienta de ataque es una decisión del operador,
  no un detalle de implementación.**
- 🚨 **Provisión de sesión autenticada — sin esto, Strix solo ataca la superficie anónima.** La app no
  publica una spec OpenAPI/Postman, y la mayor parte de la superficie (Bitácora, cobranza, admin,
  perfil) está **detrás de login**. Strix soporta escenarios autenticados, pero hay que **dárselos**:
  crear en staging una cuenta de prueba desechable (rol usuario) y una admin, y pasarle a Strix o bien
  el JWT vigente, o bien el flujo de login (`POST /auth/login` → `Authorization: Bearer`) para que
  renueve la sesión solo. Sin este paso, la tabla de cobertura de arriba se cae a la mitad —
  toda la fila autenticada queda sin ejercitar y el resultado se lee, falsamente, como "superficie
  limpia". Confirmar **después de la corrida** que Strix efectivamente tocó rutas autenticadas
  (revisar su log de requests), no asumirlo.
- **Costo.** Es un agente autónomo: consume tokens sin techo natural. Fijar un presupuesto y un
  límite de tiempo de corrida antes de lanzarlo.

#### Qué se hace con el resultado

Los hallazgos de Strix **no se aplican directo**. El circuito es: Strix encuentra y demuestra →
Claude lee el código, confirma la causa raíz y escribe el fix → se despliega staging → prod → **se
vuelve a correr Strix sobre el mismo hallazgo** para confirmar que el parche resiste. Ese último paso
es el que justifica tener las dos herramientas: una escribe el parche, la otra verifica que sirve.

---

### 🟠 S10 — Módulo Markdown / anonimización *(agregado 2026-08-26)*

> **Sonnet 5 · esfuerzo ALTO · local (Electron) + staging para el gate** · **⏳ solo si el módulo 1.2 se construyó**

**Por qué no estaba en la versión original de este plan.** Se escribió el 2026-08-24, cuando el
módulo Markdown era una decisión de negocio sin resolver. El **2026-08-26 el operador lo confirmó
como ítem 1.2 de la Etapa 1** del roadmap, lo que significa que **va a existir cuando esta etapa
corra**. Sin este bloque, la Etapa 3 se cierra dejando sin auditar un módulo entero — y encima el
único del producto que le hace al usuario una promesa de privacidad explícita.

**Lo primero, para no inflar la severidad:** el módulo es **100% local** por diseño (§1 de su plan) —
no expone ningún endpoint nuevo a internet; lo único que toca el servidor es el flag de plan
`markdown_enabled`. Eso acota la superficie a un atacante que ya controla el **contenido del PDF de
entrada**, que en el caso de uso real viene del PJN. Es un escenario menos probable que S1, pero no
hipotético: un expediente lo redacta una contraparte.

**El eje que aporta, y que F5 del code-review NO da.** Son preguntas distintas sobre el mismo código:

| | F5 (Etapa 2, code-review) | S10 (Etapa 3, seguridad) |
|---|---|---|
| Pregunta | ¿el motor está bien escrito? | ¿qué pasa si el input es hostil? |
| Input asumido | un informe normal | un PDF construido para romper el módulo |
| Hallazgo típico | un regex que no matchea acentos | una URL de adjunto que apunta a `127.0.0.1:3443` |

**Qué se prueba:**

- **🚨 El destino de las descargas sale del documento, no de nuestro código.** M3 extrae anotaciones
  `Link` del PDF y descarga esas URLs — y **M0 confirmó que lo hace con `fetch` directo en Node**
  (escenario A), sin navegador de por medio, así que el pedido sale del proceso de Electron con la red
  local del usuario por detrás. Un PDF con un enlace a `http://127.0.0.1:3443/`, a
  `http://169.254.169.254/` o a un `file://` convierte al módulo en un **SSRF que corre en la máquina
  del abogado**. Verificar que hay allowlist de esquema (`https` únicamente) y de host, no solo un
  `try/catch`. **Y no hay excusa para que falte:** M0 midió 706 URLs reales y **todas** tienen la misma
  forma (`https://scw.pjn.gov.ar/scw/viewer.seam?id=…&tipoDoc=…`), así que la allowlist es una
  constante, no una heurística.
- **Path traversal — dos vectores, y el segundo está confirmado en el código** *(precisado el
  2026-08-28, ya con el módulo construido)*. **(a)** El nombre del archivo temporal: si se deriva de
  la URL o del título del enlace, un `../../` escribe fuera del temporal. **(b) 🚨 El que
  efectivamente existe:** el handler `reprocesar-markdown-mapping` de `electron-app/main.js` recibe
  `mdAnonimizadoPath` y `mappingPath` **del renderer** y hace `fs.writeFileSync()` sobre ellos sin
  validar que resuelvan dentro de la carpeta del usuario. Es el mismo patrón que el proyecto ya
  corrigió dos veces —`open-file` (E2-3) y `safe-storage-*` (E2-1)—, así que la lección existe y acá
  no se aplicó. **Matiz honesto sobre la severidad:** hoy el renderer es código propio, así que
  explotarlo exige comprometerlo antes; el valor de cerrarlo es que elimina la clase entera en vez de
  depender de que ningún XSS llegue nunca al renderer. Verificar y proponer el fix desde el llamador,
  con el mismo criterio de E2-3.
- **Límites de recursos, medidos y no leídos.** M3 declara "límite explícito de cantidad y tamaño
  total + timeout por archivo" (riesgo R5 de su plan). Ejercitarlos: un PDF con 500 enlaces, un
  adjunto de 2 GB, un servidor que responde 1 byte por segundo. Confirmar que la app no se cuelga ni
  llena el disco, y que el `try/finally` de limpieza corre **también** en el camino de error.
- **`pdfjs-dist` sobre archivos de terceros.** Es un parser complejo procesando input no confiable.
  Revisar CVEs de la versión instalada y confirmar que corre sin acceso a `eval` ni a APIs de Node
  desde el contexto de parseo.
- **🚨 Que el `.md` anonimizado no conserve enlaces vivos al SCW — la verificación más barata y más
  importante del bloque.** Hallazgo de **M0** (§4 de [`spike-markdown-M0-2026-08-26.md`](spike-markdown-M0-2026-08-26.md),
  medido, no supuesto): los `viewer.seam` que el informe embebe **abren el documento original sin
  ninguna autenticación** — basta el token de la URL — y **esos tokens no expiran** (siguen vivos 27
  días después, que es el máximo que la muestra permitió medir). Entonces un `.md` con los nombres
  enmascarados pero los enlaces intactos **entrega el expediente original sin anonimizar a quien lo
  reciba**. Es anonimización teatral. **La aserción es binaria y se comprueba con un grep:** un
  archivo anonimizado no debe contener **ninguna** URL de `viewer.seam`. **✅ M4 ya lo implementó** *(confirmado el
  2026-08-28 en `electron-app/markdown/anonimizar.js`: la regla 4 reemplaza toda URL de `viewer.seam`
  por el literal `(enlace al expediente omitido)`)*, así que **este punto es verificación, no diseño**:
  correr el grep sobre una salida real y confirmar que no queda rastro de la URL, que la versión *no*
  anonimizada sí la conserve —ahí es correcto, es para uso propio— y que la regla no se pueda esquivar
  con una URL partida por un salto de línea, que es exactamente el modo de falla que ya apareció una
  vez en este motor (la fuga de un nombre partido por el salto de línea de la cita, corregida en M4).
- **⭐ Fuga por anonimización incompleta — el de mayor consecuencia.** Esto es **S3 aplicado al módulo**:
  datos personales de terceros (Ley 25.326) que el usuario cree anonimizados y comparte. A diferencia
  de F5 —que lee el motor buscando errores—, acá se construye un **corpus adversarial**: nombres con
  partículas (`de la Torre`), compuestos, con acentos y sin, en mayúsculas, partidos por salto de
  línea o guión de corte, dentro de tablas, y **datos personales que no son nombres** (CUIT, DNI,
  domicilios, teléfonos, emails, números de cuenta). Se mide la **tasa de falsos negativos** y se
  reporta como número, no como impresión. Verificar además que el `mapping.txt` editable no permita
  una entrada que rompa el reprocesamiento, y que reprocesar parta siempre del original.
- **Coherencia entre la promesa y el resultado.** Confirmar que la leyenda de "ayuda automática, no
  garantía" está en la UI **y** en los TyC (ítem 1.3 de la Etapa 1). Si el número de falsos negativos
  del punto anterior es alto, la leyenda es lo único que separa al producto de una promesa incumplida.

**Cómo:** corpus de PDFs sintéticos construidos para el bloque + un PDF real del operador para el
caso base. Local, contra la app en dev — **nada de esto toca staging ni producción**, salvo la
verificación del gate `markdown_enabled` (que un plan sin el flag no pueda abrir el módulo), que sí va
por HTTP contra staging.

**Escalar a Opus si M0 devolvió escenario B o C** — en ese caso el módulo deja de ser un parser puro y
pasa a abrir Chrome o a tocar un script encriptado, lo que arrastra el candado de ejecución y la zona
protegida de `src/security/` a la superficie de este bloque.

> **Relación con S6.** S6 cubre el motor Puppeteer y el cliente Electron *actuales*. S10 no lo
> reemplaza ni se solapa: es código que en ese momento no existía. Si se ejecutan en la misma sesión,
> correr S6 primero — establece la línea base del cliente sobre la que S10 mide el delta.

> **Relación con 1.1 (Bitácora F3.4).** El otro ítem confirmado de la Etapa 1 **no** necesita bloque
> propio: el export `.ics` agrega un formato al endpoint de exportación que **S2 ya audita**. Lo que sí
> hay que hacer es ejercitarlo dentro de S2, con dos casos que el `.ics` introduce y el Excel/JSON no:
> una entrada sin `due_at` (que invalida el archivo entero) y una descripción con saltos de línea y
> caracteres de control sin escapar.

### 🟠 S11 — Superficie pública de la landing y el gate de la demo *(agregado 2026-08-28)*

> **Sonnet 5 · esfuerzo MEDIO · lectura de la landing real (sin tocarla) + pruebas locales** ·
> **⏳ solo si la demo de la Etapa 1.6 está publicada** (lo está desde el 2026-08-27)

**Por qué no estaba en la versión original de este plan.** El 2026-08-24, `procuradortool.com` era una
landing estática que **no guardaba nada**: sin sesión, sin credenciales, sin `localStorage`. Auditarla
habría sido auditar HTML de marketing. La Etapa 1.6 cambió eso: publicó `/demo/` — **703 líneas de JS
inline nuevas** — y, para que un cliente logueado no viera el gate de bloqueo, hizo que **el portal le
pase su JWT a ese origen**. Ningún bloque de S1–S10 mira esa superficie: S5 audita el dashboard y el
portal, S1 el endpoint anónimo, S6 el cliente Electron. La landing no le tocaba a nadie.

**Lo que cambió, medido el 2026-08-28 (no supuesto):**

| Qué | Dónde | Estado |
|---|---|---|
| El portal reescribe "Ver demo" a `https://procuradortool.com/demo/#sso=<JWT>` | `public/usuarios/app.js`, `wireVerDemoLinks()` | Confirmado |
| `/demo/` consume el fragmento y guarda el token en el `localStorage` **de ese origen** | `public/landing/demo/index.html`, `consumirTokenDesdeHash()` | Confirmado |
| El token **nunca se borra** de ahí: no hay logout ni chequeo de expiración | ídem — el gate solo evalúa `!!localStorage.getItem(...)` | Confirmado |
| Vigencia del JWT del portal | `routes/auth.js`, `/auth/portal-login` | **8 h** |
| Headers de seguridad del vhost `procuradortool.com` | `/etc/nginx/sites-available/procuradortool` | **Ninguno** — cero `add_header`. La CSP de B-5 vive en Helmet, es decir **solo en Express** |

**El eje del bloque, dicho sin inflarlo.** No es que el gate sea débil — el gate es de UX y está bien
así: detrás no hay nada sensible, son capturas que igual son públicas, y el propio código lo declara.
**El problema es dónde quedó guardada la credencial.** Una sesión con acceso completo a
`/usuarios/api/*` y `/client/*` pasó a persistir en un origen que (a) no tiene CSP ni ningún otro
header, (b) es el que más probable es que reciba un script de terceros mañana —un pixel de analytics,
un tag de marketing, un chat de ventas—, y (c) no tiene ningún mecanismo que la expire ni la limpie.
Hasta la Etapa 1, un XSS en la landing era un defacement; hoy es un robo de sesión.

**Lo que sí quedó bien resuelto y no hay que tocar** (para que el bloque no gaste esfuerzo ahí): el
fragmento **no viaja al servidor** (los `#` no se mandan en la request ni en el `Referer`), y
`history.replaceState()` lo borra de la barra de direcciones apenas se consume, así que no queda en el
historial del navegador. Esa parte del diseño es correcta.

**Qué se prueba:**

- **XSS en `/demo/index.html`.** 703 líneas de JS inline que renderizan captions con HTML embebido
  (`<b>`, etc.) y arman los mocks 6.6-6.8 por concatenación de strings. Hoy todo el contenido es
  literal del propio archivo — o sea que **no hay input externo**, y el hallazgo esperable es
  "ninguno". El valor del check no es encontrar un XSS hoy: es dejar establecido que **cualquier
  contenido dinámico que se agregue después a ese archivo se convierte en un vector directo al token**,
  cosa que hoy no está escrita en ningún lado y es exactamente el tipo de cosa que se rompe en la
  quinta iteración de la demo.
- **Headers del vhost.** Verificar qué se puede agregar a `procuradortool.com` sin romper la landing
  (CSP con el mismo criterio del B-5 de Express, `X-Frame-Options`/`frame-ancestors`,
  `Referrer-Policy`). Es la mitigación más barata y la que sirve aunque no se cambie nada más.
- **Ciclo de vida del token en ese origen.** Que la demo lo descarte cuando venció (hoy no puede
  distinguirlo: solo mira si existe) y que exista alguna forma de limpiarlo. Un `logout` del portal
  **no** lo borra de ahí: son orígenes distintos.
- **Alcance real de lo que ese token abre.** Confirmar contra `routes/usuarios.js` y `routes/client.js`
  qué puede hacer alguien que lo obtenga — no asumirlo. Es lo que decide si esto es 🟠 o 🔵.
- **Que ningún otro dato del usuario haya cruzado a ese origen** junto con el token (grep de la demo
  por lecturas de `localStorage`/`sessionStorage` más allá de `psc_user_token`).

**La decisión de producto que sale de acá** (planteársela al operador, no resolverla solo): el gate
podría funcionar igual con **un token propio, efímero y sin privilegios** —un valor opaco que el portal
firma solo para desbloquear la demo, con vencimiento corto y sin acceso a ninguna API— en vez del JWT
de sesión. Cuesta poco y elimina el bloque entero como clase de riesgo. La alternativa mínima, si se
prefiere no tocar el mecanismo, es agregar los headers al vhost y hacer que la demo descarte el token
vencido.

**Cómo:** lectura del código de los dos extremos + verificación del vhost en el servidor (solo lectura)
+ pruebas en un navegador contra la landing **de producción tal como está publicada** (navegar y leer;
no se escribe nada). Nada de este bloque toca la base de datos.

> **Relación con S5 y con F2 del code-review.** S5 audita XSS en el dashboard y el portal — **otros dos
> orígenes**. F2 (Etapa 2) revisa `usuarios/app.js`, que es el **emisor** del token, pero su target no
> incluye `/demo/index.html`, que es el receptor. Este bloque es el único que mira el origen de la
> landing como un todo.

---

## §4 — Hallazgos ya detectados al armar este plan

Detectados hoy, verificando en vivo. **No corregidos** — quedan documentados para que el operador
decida. Mismo criterio que P-1/P-2 en el plan de revisión E1-E6.

| ID | Sev. | Hallazgo |
|---|---|---|
| **H-1** | ✅ **RESUELTO el 2026-08-27 — con una consecuencia nueva** *(actualizado 28/08)* | Se agregó al crontab (`0 4 * * *`) durante la mejora del smoke backend, y al correrlo por primera vez apareció y se corrigió un bug real: consultaba `usage_logs.created_at`, columna inexistente. **Lo que queda no es el hallazgo original sino su reverso:** el script ahora borra datos de producción todos los días y **nadie miró todavía qué borró**. S3 lo toma desde ahí. *Texto original del hallazgo (24/08), conservado como contexto: «la política de retención existe escrita, define borrar `usage_logs` >90 días, usuarios no verificados >48 h y `token_blacklist` vencida — pero no está en el crontab; con clientes reales es incumplimiento del principio de conservación limitada de la Ley 25.326, y además una promesa escrita que el sistema no cumple».* |
| **H-2** | 🟡 Medio-bajo *(escala con volumen)* | **El almacén de borradores anónimos tiene un tope GLOBAL de 100 con desalojo FIFO.** `captureDrafts.js` desaloja el más viejo al llegar al tope — decisión razonable y comentada ("preferible a rechazar la captura del usuario que llega último"), pero el tope es **compartido por todos los usuarios**. Un atacante dentro del rate limit, o simplemente volumen legítimo, **desaloja capturas de usuarios legítimos** antes de que las reclamen. Con 3 cuentas reales es imposible de notar; con 200 clientes capturando desde visores, es pérdida silenciosa de trabajo del usuario. |
| **H-3** | 🟡 Medio-bajo | **El import de Bitácora (10 MB) no tiene rate limit propio.** Solo lo cubre `generalAuthLimiter` (300 req/5 min) → un usuario autenticado puede forzar ~3 GB de parsing JSON en memoria en 5 minutos. Requiere cuenta, pero **el registro público está abierto**, así que obtener una cuesta 1 email. |
| **H-4** | 🔵 Informativo | **El registro público ya está abierto en producción** (`allow_public_register = true`). El bloque S4 no audita un riesgo futuro sino uno **vigente**: hoy nadie abusó porque nadie conoce el producto, no porque haya un control impidiéndolo. |

**Control verificado OK (no es hallazgo, pero evita trabajo):** las 3 primitivas nuevas del dashboard
(`showToast`, `showConfirm`, `showPrompt`, escritas el 2026-08-24 para VF-3) **escapan correctamente**
con `escHtml`/`escAttr`. La migración de los 71 sitios **no** reintrodujo XSS-1 por esa vía.

---

## §5 — Resumen: modelo, esfuerzo y orden

| # | Bloque | Modelo | Esfuerzo | Entorno | Prioridad |
|---|---|---|---|---|---|
| **S1** | Superficie anónima (capture) | Sonnet 5 | 🔴 Alto | staging | **1** |
| **S2** | Camino destructivo (import/export) | Sonnet 5 | 🔴 Alto | staging | **2** |
| **S3** | Datos personales / retención | Sonnet 5 | 🟡 Medio | prod solo lectura | **3** |
| **S4** | Abuso del registro y del trial | Sonnet 5 | 🟡 Medio | staging | **4** |
| **S5** | XSS en el admin no auditado | Sonnet 5 | 🔴 Alto | staging + stub | 5 |
| **S6** | Motor Puppeteer / Electron | Sonnet 5 | 🔴 Alto | local | 6 |
| **S7** | Rate limits y DoS | Sonnet 5 | 🟡 Medio | **solo staging** | 7 |
| **S10** | **Módulo Markdown / anonimización** | Sonnet 5 (Opus si M0 = B/C) | 🟠 Medio-alto | local + staging (gate) | 8 |
| **S11** | **Landing pública + gate de la demo** | Sonnet 5 | 🟡 Medio | landing (lectura) + local | 9 |
| **S9** | **Strix — pentest agéntico en runtime** | Sonnet 5 (conducción) | 🟡 Medio | **solo staging** | 10 (último de la Etapa 3) |
| **S8** | Fraude con cobro real | **Opus 5** | 🔴 Alto | prod (post-B3) | **condicional — se ejecuta en la Etapa 4** |

**Orden por relación riesgo/costo:** S1 y S2 primero — son la superficie más expuesta (anónima) y la
más destructiva, y ambas son código chico y acotado, así que rinden rápido. S3 y S4 después porque son
los que **ya están vivos** en producción (`allow_public_register=true`, retención sin correr). S5-S7
son barridos grandes, valiosos pero de menor densidad de hallazgos por hora. S8 **no se puede ejecutar
hasta que exista cobro real**.

**Agrupables en una sesión:** S1+S2 (misma superficie: el backend de Bitácora, mismo harness), S3+S4
(ambos son más decisión que código, y comparten el eje "qué pasa cuando el público entra") y
**S10+S11** (los dos salen de lo que construyó la Etapa 1 y ninguno toca la base de datos).

**Por qué Sonnet en 10 de 11:** la auditoría es búsqueda dirigida con hipótesis ya escritas, no diseño.
Es el mismo criterio con el que se ejecutaron SEC-1, E1-E6 y Q6 (*"Ejecutar con Sonnet ALTO"*). **Opus
solo en S8**, por la regla del proyecto: dinero real de por medio.

---

## §6 — Qué NO cubre este plan

Explícito, para que **"plan ejecutado" no se confunda con "producto auditado"**:

- **Pentesting profesional externo.** Sigue siendo el pendiente de siempre y **ninguno de estos
  bloques lo reemplaza**. SEC-1 ya lo decía: una auditoría interna reduce el externo a *confirmación*,
  no a *descubrimiento*. Para lanzamiento masivo con cobro real es donde más pesa.
  **→ Con el agregado de S9 (Strix) esta afirmación cambia de grado, no de naturaleza: ver §8, que
  responde explícitamente qué reemplaza y qué no.**
- **Cumplimiento legal formal.** S3 evalúa la postura técnica frente a la Ley 25.326; **no es
  asesoramiento legal** ni reemplaza la revisión de un profesional. La inscripción de la base de
  datos ante la autoridad de aplicación, si corresponde, es un trámite fuera de este plan.
- **PCI-DSS.** No aplica: las tarjetas las maneja MercadoPago en su propio checkout, el sistema nunca
  ve un número de tarjeta. Se menciona para que nadie lo agregue después "por las dudas".
- **Seguridad de la infraestructura más allá de lo ya cubierto.** SEC-1 cerró NET-1 con `ufw`.
  Endurecimiento del SO, gestión de parches del servidor y respuesta a incidentes quedan afuera.
- **La lógica interna de `electron-app/src/security/`** (zona protegida). S6 audita a sus llamadores.
- **Pruebas de carga como ingeniería de performance.** S7 prueba límites de seguridad y disponibilidad,
  no capacidad ni tuning.
- **La extensión Chrome más allá de sus permisos.** SEC-1 verificó permisos mínimos; el
  comportamiento en runtime sigue sin auditar y **R9.1/R9.2 siguen abiertos desde julio** por falta
  de handle de navegador real en el entorno.
- **Revisión de dependencias como proceso continuo.** DEP-1/2/3 se resolvieron puntualmente; no hay
  monitoreo automatizado de advisories nuevos (el CI de SEC-2·B.1 corre `npm audit` como informativo).

---

## §7 — Prompts de arranque

**S1 + S2** (agrupados, Sonnet 5, esfuerzo alto):
> Ejecutá los bloques **S1 y S2** de `docs/internal/plan-seguridad-lanzamiento-2026-08.md` (superficie
> anónima de captura + camino destructivo de import/export de Bitácora). Trabajá **solo contra
> staging** — el modo `reemplazar` borra datos. Empezá por las hipótesis H-2 y H-3 de §4, que ya
> están acotadas. No re-testees los controles de `informe-seguridad-sec1-2026-07-13.md` §5 salvo los
> 4 marcados como invalidados en §2 del plan.

**S3 + S4** (agrupados, Sonnet 5, esfuerzo medio):
> Ejecutá los bloques **S3 y S4** de `docs/internal/plan-seguridad-lanzamiento-2026-08.md` (datos
> personales/retención + abuso del registro público). Producción **solo lectura**; las pruebas
> activas van contra staging. Arrancá por H-1 (data-retention.js no está en el crontab) y H-4 (el
> registro ya está abierto). Varios puntos son decisiones del operador, no código: listalas
> explícitamente en vez de decidirlas solo.

**S5 / S6 / S7** (individuales, Sonnet 5):
> Ejecutá el bloque **S<n>** de `docs/internal/plan-seguridad-lanzamiento-2026-08.md`. Leé §2 antes
> de empezar para no re-testear lo que SEC-1 ya cubrió.

**S10** (Sonnet 5, esfuerzo alto — **solo si el módulo Markdown de la Etapa 1.2 se construyó**):
> Ejecutá el bloque **S10** de `docs/internal/plan-seguridad-lanzamiento-2026-08.md` — módulo
> Markdown / anonimización. Confirmá primero que el módulo existe y leé qué escenario devolvió su
> gate M0 (`plan-modulo-markdown-anonimizacion-2026-08-26.md`): **si fue B o C, subí a Opus**, porque
> el módulo pasa a tocar el candado de ejecución y la zona protegida. Es un bloque **local**: nada
> toca staging ni producción salvo la verificación del gate `markdown_enabled`. No repitas F5 del
> code-review (que revisa si el motor está bien escrito): acá el eje es **input hostil** — SSRF por
> las URLs que salen del PDF, path traversal, límites de recursos, y el corpus adversarial de
> anonimización, cuyo resultado se reporta como **tasa de falsos negativos medida**, no como
> impresión.

**S11** (Sonnet 5, esfuerzo medio — **solo si la demo de la Etapa 1.6 está publicada**):
> Ejecutá el bloque **S11** de `docs/internal/plan-seguridad-lanzamiento-2026-08.md` — superficie
> pública de la landing y gate de la demo. Es un bloque **de lectura**: no se escribe nada en la
> landing, en staging ni en la base. Arrancá confirmando los 5 datos de la tabla del bloque contra el
> código y el vhost real (no los des por ciertos porque estén escritos acá). El eje **no** es que el
> gate sea débil —es de UX y está bien así—, sino que un JWT de sesión de 8 h pasó a persistir en un
> origen sin CSP y sin forma de limpiarlo. La salida esperada incluye **una recomendación concreta al
> operador** entre las dos opciones del bloque: token propio efímero, o headers en el vhost + descarte
> del token vencido.

**S9** (Sonnet 5, esfuerzo medio, **último bloque de la Etapa 3**):
> Ejecutá el bloque **S9** de `docs/internal/plan-seguridad-lanzamiento-2026-08.md` — Strix contra
> staging. **Antes de lanzar nada**, ejecutá y confirmá las 4 precondiciones de seguridad del bloque
> (SMTP neutralizado, `MP_ENV` fuera de `sandbox` para que el guard anule el token, backup de
> `procurador_db_staging`, y confirmación de que el target no es producción). Verificá si hay Docker
> en el servidor; si no lo hay, **no lo instales** — planteale la alternativa al operador. Los
> hallazgos no se aplican directo: se confirman contra el código, se parchean, y se re-corre Strix
> sobre el mismo hallazgo.

**S8** (Opus 5, **solo después del switch a MP producción — ya dentro de la Etapa 4**):
> Ejecutá el bloque **S8** de `docs/internal/plan-seguridad-lanzamiento-2026-08.md`. Confirmá primero
> que la Fase C de `plan-mercadopago-produccion-2026-08-24.md` está cerrada. Hay dinero real: ninguna
> prueba puede generar un cobro a un tercero.

---

## §8 — ¿SEC-2 + Strix reemplazan a la auditoría de seguridad externa?

> Pregunta explícita del operador (2026-08-26). La respuesta honesta es **"cubren el trabajo técnico,
> no la función que cumple una auditoría externa"** — y esas son dos cosas distintas que conviene no
> mezclar.

### Lo que SÍ queda cubierto

Un pentest profesional hace, en esencia, cuatro cosas. Tres las cubre esta combinación:

| Lo que hace un pentest | ¿Lo cubre SEC-2 + Strix? |
|---|---|
| **Revisión de código / white-box** (auth, IDOR, inyección, validación) | ✅ **Mejor que un pentest típico.** Un auditor externo trabaja con horas contadas y rara vez lee 300 KB de frontend; S1–S7 sí, y con contexto histórico del proyecto que un externo no tiene |
| **Explotación dinámica / black-box** | ✅ Es exactamente lo que aporta S9 |
| **Verificación de que el parche resiste** | ✅ El circuito parche → re-corrida de Strix del bloque S9 |
| **Atestación independiente** | ❌ **Nada de esto la da** |

### Lo que NO reemplaza, y por qué importa comercialmente

1. **La independencia.** Un informe de auditoría vale porque lo firma alguien que no escribió el
   código. Acá el mismo agente que construyó el módulo lo audita — con todo el sesgo de ángulo muerto
   que eso implica. Ningún nivel de esfuerzo lo corrige.
2. **El papel.** Un estudio jurídico institucional, un colegio de abogados o una aseguradora que
   pregunte "¿tienen auditoría de seguridad?" quiere un informe firmado con fecha y alcance, no un
   repositorio de markdown. **Esto es un argumento de venta, no un requisito técnico** — pero en el
   mercado al que apunta el producto (profesionales del derecho, datos de terceros) pesa.
3. **La transferencia de responsabilidad.** Si algo sale mal, un informe externo es parte de la
   diligencia demostrable. Una auditoría propia no.
4. **La creatividad de negocio.** Las cadenas de abuso que mezclan reglas comerciales (cortesía +
   cambio de plan + reactivación + reembolso) son donde un humano con experiencia todavía gana. S8
   apunta ahí, pero desde hipótesis nuestras.

### Recomendación

**Para el lanzamiento Beta: alcanza con SEC-2 completo (S1–S7 + S9 + S10 + S11).** Con pocos clientes, sin
tarjetas tocando nuestro sistema (las maneja MP) y con la superficie ya endurecida por SEC-1, el
riesgo residual es aceptable y el costo de un pentest externo no se justifica todavía.

**Para el lanzamiento masivo con cobro real: contratarla igual, pero después.** Correrla *después* de
SEC-2 + Strix es lo que la vuelve barata: el externo llega a un producto ya limpio y su trabajo pasa
de *descubrimiento* a *confirmación*, que es un encargo más corto y por lo tanto más barato. Al revés
—contratarlo primero— se paga tarifa profesional por encontrar los mismos hallazgos que los bloques
de este plan encuentran solos.

**Y una cosa que sí conviene hacer aunque no se contrate nada:** un **informe de cierre unificado**
al terminar la Etapa 3 (los 11 bloques + los hallazgos + los parches + las re-corridas), en un solo
documento con fecha y alcance. Ese documento es el que se le muestra a un cliente que pregunta, y es
también el punto de partida del auditor externo el día que se contrate. Sin él, la evidencia queda
dispersa en 9 informes y no sirve para ninguna de las dos cosas.
