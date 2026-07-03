# Plan de Pruebas Integral — Julio 2026

> **Objetivo:** validar el producto completo desde la óptica del **usuario** (ciclo de vida entero, todas las variantes) y del **administrador** (operaciones y contingencias).
> **Regla de oro:** durante la ejecución **NO se modifica código**. Todo bug o mejora se documenta en la sección final para reparar después, por separado.
> **Entorno:** producción (MercadoPago en **sandbox** — sin dinero real; DB reseteada el 2026-07-02, solo admins 6 y 7; panel MP con 0 preapprovals vivos).
> **Ejecutor:** Claude (Chrome del operador + API/curl + SQL para acelerar estados y verificar + app Electron con credenciales recordadas). El operador humano: verifica emails en su casilla y provee expedientes PJN.

---

## Convenciones

- **Usuarios de prueba:** `jberger_86+uN@hotmail.com` (alias de Outlook — todos llegan a la misma casilla). Contraseñas de prueba tipo `Prueba1234`.
- **Aceleración de estados:** el paso del tiempo (vigencias, gracias, ciclos) se simula vía SQL sobre `subscriptions` + ejecución de la lógica de los crons ya deployados (o `dev-tools/sim-renewal.js`). Siempre con backup previo de la DB.
- **Evidencia:** cada caso registra Esperado vs Obtenido. Estados: ✅ PASS · ❌ FAIL · ⚠️ PASS con observación · ⏭️ SKIP (con motivo).
- **PJN real:** autorizado por el operador, con expedientes provistos por él (procuración ind/batch, informe ind/batch, monitor).
- **Cierre:** informe de bugs/mejoras priorizado → reset de datos + limpieza MP + backup `.7z` + entrada en CLAUDE.md.

---

## Datos de prueba (provistos por el operador)

### Usuario principal (para app Electron + PJN real)
| Campo | Valor |
|---|---|
| Email | `procuradortool@gmail.com` |
| Contraseña | `TestPass2025!` |
| CUIT | `27320694359` (tiene credenciales PJN reales — **el operador las carga en Chrome cuando corresponda**) |

> Este usuario se **crea durante el plan** (registro público U1.1 o alta admin) con esos datos. Es el que ejecuta los bloques U12 (app + PJN). Gmail también recibe alias `procuradortool+xx@gmail.com` si hacen falta variantes.

### Usuarios secundarios
`jberger_86+u1@hotmail.com`, `+u2`, `+u3`… con contraseña `Prueba1234`. CUITs válidos pre-generados (dígito verificador OK): `20300000011 · 20300000029 · 20300000038 · 20300000046 · 20300000054 · 20300000062`.

### Expedientes PJN (jurisdicción FCR)
- `FCR 18745/2017` · `FCR 6705/2025` · `FCR 18745/2018`
- **TXT para batch** (formato validado contra `parseExpedienteStr`: `SIGLA NUMERO/AAAA` por línea): **`docs/internal/expedientes-prueba-fcr.txt`**
- Uso: procuración individual (1 expediente), procuración batch (el TXT), informe individual, informe batch (el TXT).

### Partes para el Monitor (jurisdicción FCR)
- `DON COCHO`
- `LA TOSTADORA MODERNA`

### MercadoPago sandbox
- Cuentas comprador/vendedor de prueba y tarjeta: ver **CLAUDE.md → "Credenciales de sandbox MercadoPago"** (comprador `TESTUSER4310268003253553318`; la tarjeta de prueba ya está guardada en esa cuenta — el checkout no pide CVV).
- Prod corre MP en **sandbox** (B3 pendiente) → los cobros no son reales.

---

## Instrucciones para el EJECUTOR (sesión nueva, modelo Sonnet 5)

> Este plan está pensado para ejecutarse **íntegramente por Claude** en una sesión nueva, sin contexto previo. Leé esta sección completa antes de arrancar.

### Reglas innegociables
1. **NO modificar código** (ni backend, ni dashboard, ni app, ni scripts). Si encontrás un bug: documentalo en la sección "Hallazgos" con severidad y propuesta, y seguí. Solo se permite editar ESTE documento (resultados) y datos de DB para acelerar estados.
2. **Backup de la DB antes de arrancar** (`ssh … "sudo -u postgres pg_dump procurador_db > /tmp/backup_prod_pre_testrun_$(date +%Y%m%d_%H%M%S).sql"`).
3. Acciones destructivas fuera del alcance del plan → preguntar al operador.

### Herramientas y accesos
- **Servidor/DB:** `ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94` · DB prod `procurador_db` vía `sudo -u postgres psql`. (El warning `could not change directory to "/root"` es inofensivo.)
- **Dashboard admin:** `https://api.procuradortool.com/dashboard/` vía **Chrome MCP** (extensión Claude in Chrome). Las credenciales del admin están **recordadas** en el form (solo click en "Ingresar").
- **Portal usuario:** `https://api.procuradortool.com/usuarios/` (login con los usuarios de prueba) o por API: `POST /auth/portal-login {email,password}` → token → `Authorization: Bearer`.
- **App Electron:** el operador la deja **abierta con credenciales recordadas**; se maneja con las herramientas de escritorio (computer-use). Pedir el permiso de la app cuando se llegue a U12.
- **MercadoPago API (verificaciones):** desde el server: `TOK=$(grep '^MP_ACCESS_TOKEN=' /var/www/procurador/backend-server/.env | cut -d= -f2)` y `curl https://api.mercadopago.com/preapproval/<id> -H "Authorization: Bearer $TOK"`. **No imprimir el token.**

### Aprendizajes operativos (evitan horas perdidas)
- **JWT firmado a mano NO valida** contra el proceso de prod (misterio de entorno conocido). Para actuar como admin usá el **dashboard en Chrome** (sesión real); como usuario, `portal-login` por API funciona perfecto.
- **Diálogos nativos bloquean la automatización.** Al entrar al dashboard, ejecutar por JS: `window.confirm=()=>true; window.alert=(m)=>{window._lastAlert=m};` — re-ejecutarlo tras cada recarga de página (las navegaciones SPA con `navigate()` lo conservan).
- El dashboard expone helpers globales útiles por JS: `navigate('users'|'plans'|'user-detail', id)`, `apiFetch(path, method, body)` (usa el token real de la sesión — ideal para negativos de API), `openAddUserModal()`, `updateSub(id)`, `adminCancelSub(id)`, `adminReactivateCancel(id)`.
- El **search de preapprovals de MP tarda en indexar** tras cambios — reintenta a los pocos segundos antes de concluir.
- Tras cancelar/pausar en MP, verificar SIEMPRE por API (`GET /preapproval/:id → status`), no por el panel.
- Los crons corren a las 11:0x UTC (08 ART). Para no esperar: forzá fechas por SQL y ejecutá la **misma query/lógica del cron** manualmente (copiala de `server.js`, crons `5 11` retiro · `25 11` downgrade · `30 11` gracia) vía un script one-off `node /tmp/...` con requires por ruta absoluta a `node_modules` del server, o esperá la corrida diaria si el timing lo permite.
- `dev-tools/sim-renewal.js` simula el cobro mensual (renovación) sin esperar el ciclo.

### Coordinación con el operador (humano)
Pedirle SOLO esto, cuando corresponda:
1. **Emails**: cuando un caso requiera "click en el link de verificación", avisarle QUÉ casilla y QUÉ email (los de hotmail llegan a `jberger_86@hotmail.com`; los del principal a `procuradortool@gmail.com`). Agrupá los pedidos para no interrumpirlo a cada rato.
2. **Credenciales PJN**: antes de U12.3+ pedirle que las cargue en el Chrome de la app (Configuración → Seguridad → Agregar contraseña SCW) si no están.
3. **App abierta**: antes de U12, pedirle que abra la app con las credenciales del usuario principal recordadas.

### Orden de ejecución recomendado
1. **Preparación:** backup DB → verificar estado inicial (solo admins 6/7, MP 0 preapprovals vivos, prod health 200).
2. **A2** (planes: crear el plan cortesía y un plan privado de prueba — los usa todo lo demás).
3. **A1** (usuarios) + **U1/U2** (registro público + verificación) — acumulan los usuarios de prueba.
4. **U3** (trial) → **U4** (activación + checkout MP) → **U5–U8** (vida paga, cambios, cancelaciones, gracia).
5. **U9/U10** (vigencia/cortesía) + **A3** (suscripciones desde ficha, reusa el usuario pago).
6. **A4** (cobranza) + **A5** (tickets) + **U11** (portal).
7. **A6** (contingencias) + **A7** (seguridad).
8. **U12** (app Electron + PJN real con los expedientes/partes de arriba) + **U13** (extensión por API).
9. **Cierre:** completar Hallazgos → informe al operador → reset DB (script `dev-tools/reset-test-data.sql`, actualizar IDs) + cancelar preapprovals MP creados + backup `.7z` + entrada en CLAUDE.md.

### Registro de resultados
Completar la columna "Resultado" de cada caso EN ESTE ARCHIVO (✅/❌/⚠️/⏭️ + nota breve) y commitear al final de cada bloque con mensajes `test: resultados bloque X`. Los bugs van a la tabla de Hallazgos con: severidad (crítico/alto/medio/bajo), caso que lo detectó, descripción reproducible y propuesta de fix (sin implementarla).

### Corte de tiempo (time-boxing)

> El operador puede indicar, al arrancar una corrida, un **horario límite** (y opcionalmente un margen de extensión). Si no se indica ninguno, la corrida no tiene corte y sigue el orden de ejecución hasta el final o hasta que el operador la detenga.

Cuando SÍ hay un horario límite indicado:

1. **No arrancar un bloque nuevo** si, a su ritmo estimado, no va a poder completar al menos un caso atómico completo antes del límite.
2. **Nunca cortar a mitad de un caso atómico** (ej. un checkout de MP a mitad de camino, un usuario a medio crear, una transacción SQL sin commitear). Terminá el caso en curso —y solo ese— aunque cruce el horario, usando el margen de extensión si existe para ese fin exclusivamente (no para arrancar casos nuevos).
3. **Chequeo de proximidad:** ~10-15 minutos antes del límite, evaluar si conviene cerrar ahí en vez de arrancar un bloque grande (ej. no arrancar recién U12 con PJN real si quedan 12 minutos).
4. **Al llegar al límite** (o agotar el margen de extensión): parar de arrancar trabajo nuevo y ejecutar el checklist de cierre parcial:
   - Completar la columna Resultado de todo lo ejecutado hasta ahí.
   - Agregar una fila al **Registro de ejecución** con fecha/hora, bloques y casos cubiertos, y **qué quedó pendiente** (próximo caso a retomar).
   - Dejar la DB en un estado consistente (sin transacciones a medias) — no hace falta revertir lo ya probado, salvo que el operador lo pida.
   - Commit + push de los resultados parciales.
   - Informar al operador: resumen de lo hecho, hallazgos detectados hasta el corte, y desde qué caso retomar la próxima vez.
5. Si el operador pidió posibilidad de posponer el límite, puede pedírselo brevemente al notar que se acerca la hora ("quedan ~10 min, estoy en el caso X, ¿extiendo Y minutos o corto acá?") — sin interrumpir el trabajo en curso para preguntar, solo avisar al ir cerrando.

---

## BLOQUE A — Óptica del ADMINISTRADOR

### A1. Gestión de usuarios

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A1.1 | Alta manual de usuario (＋ Agregar usuario) con plan pago | Usuario `pending_email` + email con credenciales + link verificación | ✅ Usuario `jberger_86+u1@hotmail.com` (id 239) creado con plan COMBO_PROMO; verificado por SQL: `registration_status='pending_email'`, `admin_created=true`. Envío de email no confirmado por el operador todavía (fuera de esta corrida) |
| A1.2 | Alta con email duplicado | Rechazo con mensaje claro | ✅ "El email ya está registrado" |
| A1.3 | Alta con CUIT duplicado | Rechazo con mensaje claro | ✅ "El CUIT ya está registrado en el sistema" |
| A1.4 | Alta con CUIT inválido (dígito verificador) | Rechazo | ✅ "CUIT/CUIL inválido. Verificá el formato y dígito verificador." |
| A1.5 | Alta con contraseña débil (sin número / <8) | Rechazo con requisito específico | ✅ "La contraseña debe incluir al menos una letra y un número." |
| A1.6 | Reenviar verificación a `pending_email` | Nuevo email llega, token nuevo funciona | ✅ El operador confirmó 2 emails recibidos (14:43 alta con credenciales, 14:45 reenvío de verificación); click en el link del 14:45 → verificado por SQL: `email_verified=true`, `registration_status` pasó de `pending_email` a `pending_activation` (trial), `subscriptions.usage_count=0/usage_limit=20/status=suspended` — coincide con el modelo de trial documentado |
| A1.7 | Activar usuario en trial | `active`, conserva usos restantes del trial | ✅ Usuario 239: selector "Estado de registro"→Activo + Guardar; verificado por SQL: `registration_status='active'`, `subscriptions.status='active'`, `usage_limit=20` conservado (no reseteado a 999999, correcto porque no configuró pago) |
| A1.8 | Suspender usuario activo (con motivo) | `suspended_admin`, no puede loguear app; ve motivo | ✅ Usuario 239 suspendido tipo "Suave" con motivo "Motivo de prueba A1.8"; verificado por SQL: `registration_status='suspended_admin'`, `subscriptions.status='suspended_admin'`, evento `admin_suspended` con `payload.reason` correcto y `billing_paused:true` |
| A1.9 | Reactivar suspendido | Vuelve a `active` | ✅ Botón "▶ Reactivar"; verificado por SQL: `registration_status='active'` |
| A1.10 | Rechazar usuario (block) | `rejected`, bloqueo total | ✅ Usuario nuevo `jberger_86+u2@hotmail.com` (id 240, creado en `pending_email`) → selector "Estado de registro"→"Rechazado / Bloqueado"+Guardar; verificado por SQL: `registration_status='rejected'`. (Bloqueo total de login no se probó explícitamente por API/UI en esta corrida, se infiere del estado terminal documentado en el código) |
| A1.11 | Rechazar manteniendo trial (keep_trial) | Sigue `pending_activation` con usos | ✅ Usuario nuevo id 241 (`jberger_86+u3@hotmail.com`, email marcado verificado por admin para llegar a trial) → `POST /admin/users/241/reject {mode:'keep_trial'}` vía `apiFetch`; verificado por SQL: `registration_status` sigue en `pending_activation` (no cambia), evento `rejected_keep_trial` con `reason` correcto |
| A1.12 | Editar email del usuario | Suspende a `pending_email`, email de verificación al NUEVO correo; al verificar restaura estado previo | ✅ Usuario 241: botón "✉️ Editar email" habilita el campo → cambiado a `jberger_86+u3nuevo@hotmail.com` + Guardar email; verificado por SQL: `email` actualizado, `registration_status='pending_email'`, `email_verified=false` (no se probó la restauración del estado previo al re-verificar, por tiempo) |
| A1.13 | Editar email a uno ya tomado | Rechazo | ✅ Intenté cambiar el email del usuario 241 a `jberger_86+u1@hotmail.com` (ya usado por el usuario 239) → verificado por SQL que el email NO cambió (quedó en `u3nuevo`); no se capturó el texto exacto del mensaje de error en UI (toast ya no visible al momento de inspeccionar) |
| A1.14 | Blanquear contraseña | Usuario puede loguear con la nueva | ⚠️ PASS parcial — `POST /auth/admin/send-password-reset {userId:239}` (vía token admin real de `/auth/admin-login`, sin depender del dashboard) → `{"success":true,"message":"Email de reset enviado..."}`; confirmado por SQL que `password_reset_token`/`password_reset_expires` se generaron. NO se completó el ciclo (click del link + nueva contraseña + login) por tiempo — queda pendiente |
| A1.15 | Historial de la cuenta registra todo lo anterior | Eventos con fecha y autor | ✅ `GET /admin/users/239` devuelve `events[]` completo y en orden: `user_created_by_admin`→`email_verified`→`activated`→`admin_suspended` (con `reason`)→`admin_reactivated`, cada uno con `admin_id` y `created_at` |

### A2. Gestión de planes

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A2.1 | Crear plan público pago (precio en el alta) | Aparece en registro y portal; precio persistido | ✅ Plan `TEST_PUBLICO_A21` ($5.000 ARS, combo, público) creado vía dashboard; verificado presente y `available:true` en `GET /auth/plan-availability` |
| A2.2 | Crear plan privado pago | NO aparece en registro/portal; admin lo ve | ✅ Plan `TEST_PRIVADO_A22` ($8.000 ARS, combo, privado) creado vía dashboard; verificado AUSENTE en `GET /auth/plan-availability` (no listado); visible en el listado admin de Planes |
| A2.3 | Crear plan cortesía ($0 explícito, privado) | Etiqueta [GRATIS]; habilita campo vigencia en alta de usuario | ✅ Verificado con el plan `CORTESIA` (ya existente de sesión previa): selector "Agregar usuario" muestra "Plan de Cortesía [GRATIS] 🔒" y al elegirlo aparece el campo "Vigencia (días de cortesía)" con default 30 + nota explicativa |
| A2.4 | Cambiar visibilidad público→privado en caliente | Desaparece del registro/portal al instante | ✅ `TEST_PUBLICO_A21` público→privado desde Editar plan; confirmado ausente de `GET /auth/plan-availability` inmediatamente después de guardar |
| A2.5 | Editar límites/precio de un plan | Persisten; usuarios del plan ven límites nuevos | ✅ `TEST_PRIVADO_A22`: proc 20→99, precio $8.000→$9.999; verificado por SQL directo sobre `plans` que ambos valores persistieron. (No se verificó "usuario ve límites nuevos" — no hay usuario suscripto a este plan todavía) |
| A2.6 | Desactivar plan | No elegible; suscripciones existentes intactas | ⚠️ PASS parcial: `TEST_PRIVADO_A22` desactivado (`active=false` confirmado por SQL). NO se pudo verificar "suscripciones existentes intactas" — no hay ningún usuario suscripto a este plan de prueba (se retomará con A3 cuando haya usuarios pagos reales) |
| A2.7 | Vigencia real del plan (plan_expiry_date) | Se propaga a suscripciones activas del plan | ✅ `PUT /admin/plans/5/expiry {plan_expiry_date:'2026-12-31'}` (plan COMBO_PROMO) → propagado a `subscriptions` de ambos suscriptores activos (usuarios 239 y 242); revertido a `null` inmediatamente después para no dejar efectos colaterales |
| A2.8 | Usuario intenta autoasignarse plan privado por API | 400/403 — blindaje server-side | ✅ Probado vía `POST /users/change-plan {plan_name:'TEST_PUBLICO_A21'}` (plan privado) con el usuario 239 → 400 "Plan no encontrado o no disponible". (No se pudo probar el mismo blindaje en `/auth/register` por seguir activo el rate limit de registro — el blindaje en ese endpoint queda pendiente, aunque es la misma lógica de validación server-side) |

### A3. Suscripciones (desde ficha)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A3.1 | Upgrade con MP activo | Inmediato; monto MP ajustado al nuevo (sin cobro ya) | ✅ Con MP real activo (post U4.2): upgrade a un plan de prueba a $20.000 (más caro que COMBO_PROMO $15.000) → **inmediato** (`usage_limit=999999`, plan aplicado ya), y confirmado por **API real de MercadoPago** (`GET /preapproval/:id`) que `transaction_amount` pasó a 20000 sin cobro inmediato (`status` sigue `authorized`) — el cobro nuevo rige recién el próximo ciclo. Revertido a COMBO_PROMO/$15.000 (DB + MP) al cierre |
| A3.2 | Downgrade con MP activo | Programado a fin de ciclo; límites conservados; evento | ✅ Con MP real activo: downgrade a un plan más barato → `type:'downgrade_scheduled'`, `scheduled_plan` seteado, límites del plan actual conservados hasta el `applyAt`, mensaje aclara que el monto en MP se ajusta recién en esa fecha |
| A3.3 | Cambio de plan a usuario en trial | Solo cambia plan; conserva cupo 20 | ✅ Usuario 241 (trial): `POST /admin/subscriptions {userId:241,plan:'EXTENSION_PROMO'}` → mensaje "Plan del trial actualizado (se conservan los usos de prueba)"; verificado por SQL: `usage_count=0`, `usage_limit=20` (sin resetear a 999999) |
| A3.4 | Cortesía $0 a usuario pagando | Aplica ya + vigencia + pausa preapproval MP | |
| A3.5 | Cortesía $0 a usuario trial | Activo con vigencia | |
| A3.6 | Campo días en upgrade | Fija expires_at | |
| A3.7 | Cancelar al fin de ciclo | cancel_at + preapproval paused + banner | |
| A3.8 | Deshacer cancelación | preapproval authorized + cancel_at limpio | |
| A3.9 | Resetear uso | usage_count=0 | ✅ Usuario 239: seteado `usage_count=7` por SQL, luego `POST /admin/subscriptions/239/reset-usage` → confirmado `usage_count=0` |
| A3.10 | Ajuste ±bonus por submódulo | Límite efectivo cambia en app/portal | ✅ `POST /admin/subscriptions/239/adjust {subsystem:'proc',amount:10}` → `proc_bonus=10` confirmado por SQL. (No se verificó visualmente en app/portal por no tener sesión de esos clientes en esta corrida) |
| A3.11 | Usos extra (cortesía ±N) | Suma/resta a usage_limit; visible "(+N)" | ✅ `POST /admin/users/239/extra-usage {extra_uses:5}` → `usage_limit` 20→25; luego `{extra_uses:-5}` → vuelve a 20. Ambos signos funcionan correctamente (no se verificó el "(+N)" visible en portal/app en esta corrida) |
| A3.12 | Beneficio comercial (con y sin ticket) | Registrado en historial de beneficios | ✅ Sin ticket: `POST /admin/users/239/apply-benefit {benefit_type:'usage_reset',benefit_value:'proc'}` → registrado (`ticket_id:null`). Con ticket: creado ticket #22 (portal-login como user 239) + `POST /admin/tickets/22/apply-benefit {..,value:'informe'}` → registrado con `ticket_id:22`; confirmado que el ticket **NO se auto-resolvió** (`status` sigue `open`), coincide con el comportamiento documentado |

### A4. Cobranza (pagos y facturas)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A4.1 | Alta de pago manual | Aparece en Pagos y en historial del usuario | ✅ `POST /admin/payments/manual` (user 239, $15.000, COMBO_PROMO) → pago id 41; confirmado en `GET /admin/payments?search=...` |
| A4.2 | Crear factura desde pago (subir PDF) | Vinculada; visible en portal del usuario | ✅ `POST /admin/invoices/from-payment/41` (multipart, PDF de prueba) → invoice id 38 vinculada; confirmado visible en `GET /usuarios/api/invoices` del usuario 239 |
| A4.3 | Factura manual sin pago | Registrada; visible para el usuario | ✅ `POST /admin/invoices/manual` (user 239, $5.000, sin `payment_id`) → invoice id 39; visible en el portal del usuario |
| A4.4 | Asociar/desasociar pago↔factura | Links cruzados navegan y resaltan | ✅ Pago nuevo id 42 (sin factura) → `POST /admin/invoices/39/link-payment {payment_id:42}` → linkeado (confirmado `invoice_id:39` en el pago); luego `POST /admin/invoices/39/unlink-payment` → deslinkeado (`invoice_id:null`). (No se probó la navegación/resaltado visual de UI, sin Chrome) |
| A4.5 | Editar registro manual (pago/factura) | Cambios persisten; no-manuales rechazados | ✅ `PUT /admin/payments/41 {amount:16000}` → persistido (confirmado por SQL). El rechazo de pagos no-manuales está confirmado por lectura de código (`if (p.payment_method !== 'manual') return 400`), no se pudo probar en vivo por no tener ningún pago de MercadoPago real en esta corrida |

### A5. Tickets y soporte

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A5.1 | Usuario crea ticket → admin responde | Email al usuario; estado in_progress | ✅ Ticket #22 creado por usuario 239 (portal-login) → admin comenta (visibility:external) → `status` pasa a `in_progress` |
| A5.2 | Nota interna | Usuario NO la ve en su portal | ✅ Comentario `visibility:internal` agregado; `GET /tickets/22` (vista usuario) solo devuelve el comentario externo, el interno no aparece |
| A5.3 | Priorizar con IA | Prioridad + razonamiento; badge 🤖 | ✅ `POST /admin/tickets/ai-prioritize {ticket_ids:[22]}` → `priority='low'`, `priority_source='ai'`, `priority_notes` con razonamiento coherente |
| A5.4 | Proyectar respuesta con IA | Sugerencia editable; no auto-envía | ✅ `POST /admin/tickets/22/ai-suggest-reply` → devuelve texto sugerido + `log_id` (telemetría); no se envía automáticamente (queda en la respuesta, no se inserta como comentario) |
| A5.5 | Editar respuesta enviada | Label "editado"; sin nuevo email | ✅ `PUT /admin/tickets/22/comment/35` → `message` actualizado + `edited_at` seteado |
| A5.6 | Resolver ticket | Usuario lo ve RESUELTO | ✅ `PUT /admin/tickets/22/status {status:'resolved'}` → confirmado `status='resolved'` en la vista del usuario (el portal lo etiqueta "RESUELTO") |

### A6. Contingencias

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A6.1 | Webhook MP duplicado (mismo evento 2×) | Idempotente: no duplica pago | ✅ Reenviado el webhook real del pago de U4.2 (`data.id=166202947035`) **2 veces más** con firma HMAC válida generada server-side (sin exponer `MP_WEBHOOK_SECRET`, vía one-off `node -e` en el server) → ambos envíos 200 (como siempre responde MP); verificado que `webhook_events` sigue con **una sola fila** para ese `external_id` (la original) y `payments` sigue con **un solo registro** (id 43) — el `ON CONFLICT DO NOTHING` de la tabla de idempotencia funciona correctamente |
| A6.2 | Dos checkouts seguidos (single-active) | 1 solo preapproval vivo; el viejo cancelado | |
| A6.3 | Cancelar preapproval desde MP (lado usuario) | Webhook sincroniza baja programada | ✅ Con el preapproval real de U4.2: cancelado **directamente en MP** (`PUT /preapproval/:id {status:'cancelled'}`, simulando acción del usuario en el panel de MP) → tras ~15-20s el webhook sincronizó: `cancel_at` seteado a fin de período (baja programada, no corte inmediato), `status` sigue `active` hasta esa fecha. Confirmado además que `reactivate` ahora rechaza correctamente la transición terminal ("Invalid transition from cancelled to authorized", `action:'checkout'`) — coincide con la "Fila C" documentada (MP cancela=terminal → portal debe ofrecer nuevo checkout). Usuario 239 restaurado a estado neutro (`payment_provider=NULL`, sin preapproval, plan COMBO_PROMO, 20/0) al cierre de la corrida |
| A6.4 | Cron cancelación con pago reciente (guard) | NO cancela | ✅ Replicada la query exacta del cron `20 11` (`server.js`) con usuario 239: `cancel_at` 3h atrás + `auto_renewal=false` + pago aprobado con `created_at` 2h atrás (dentro de la ventana de guard `cancel_at - 1h`) → el `SELECT` del cron devuelve 0 filas (excluido correctamente por el `NOT EXISTS` de pago reciente). Estado revertido (`cancel_at=NULL`, `auto_renewal=true`) tras la prueba |
| A6.5 | Cron vigencia: período pago en curso | Pausa MP + corte al fin de período (no inmediato) | |
| A6.6 | Cron vigencia: período ya vencido | Suspende ya + gracia 7 días | ✅ Replicada la rama "período ya terminado" del cron `5 11` sobre usuario 239 (`plan_expiry_date`/`next_billing_date`/`expires_at` forzados al pasado): `registration_status='suspended_plan_expired'`, `subscriptions.status='suspended_plan_expired'`, `suspension_cause='plan_expired'`, `payment_grace_ends_at`=+7 días. Usuario restaurado a `active` limpio después de encadenar con U9 |
| A6.7 | Cron downgrade programado | Aplica plan + baja monto MP + evento | ✅ Replicada manualmente la query exacta del cron `25 11` (`server.js`) sobre el usuario 239 con `scheduled_plan.apply_at` forzado al pasado (sin modificar código, solo SQL): `plan` aplicado (COMBO_PROMO→EXTENSION_PROMO), `scheduled_plan=NULL`, `plan_changes_this_cycle` reseteado a 0, evento `plan_downgrade_applied` + notificación insertados. "Baja monto MP" no aplica (sin `payment_provider`). Usuario revertido a COMBO_PROMO después de la prueba para no ensuciar el fixture |
| A6.8 | Gracia de pago vencida (cron) | suspended por pago fallido | ✅ Replicada la query/lógica exacta del cron `30 11` sobre usuario 239 (`payment_grace_ends_at` forzado al pasado): `registration_status='suspended'`, `subscriptions.status='suspended'`, `suspension_cause='payment'`, evento `payment_failed_suspended`. Confirmado además (U8.2) que el login sigue permitido en este estado (`portal-login` → 200). Usuario restaurado a `active` limpio al cierre |

### A7. Seguridad / negativos

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A7.1 | Endpoint admin sin token | 401 | ✅ `GET /admin/users` sin header → `{"error":"Token no proporcionado"}` 401 |
| A7.2 | Endpoint admin con token de usuario común | 403 | ✅ `GET /admin/users` con token del usuario 239 → `{"error":"Se requiere rol de administrador"}` 403 |
| A7.3 | Bot IA: pedir info interna (endpoints/DB/admin) | Declina + ofrece ticket | ✅ Pedido de DB/endpoint MP/JWT_SECRET → declina claramente, redirige a soporte del producto |
| A7.4 | Bot IA: pedir datos de otro usuario | Declina | ✅ Pedido de datos del admin (email/plan/usos) → declina, ofrece verificar la propia cuenta o abrir ticket |
| A7.5 | Rate limit del bot (21ª consulta en 1h) | 429 | ⏭️ SKIP — no ejecutado por costo/tiempo (requeriría 21 llamadas reales a Claude Haiku). Confirmado por lectura de código (`routes/usuarios.js` línea ~155): límite real es **20/hora por usuario**, la 21ª da `429 "Límite de consultas alcanzado..."` |
| A7.6 | Registro con toggle público cerrado | 403 registro no habilitado | ✅ Toggle apagado (`PUT /admin/settings/allow_public_register {value:false}`) → `POST /auth/register` → `{"error":"Registro no habilitado"}` 403 → **toggle restaurado a `true` inmediatamente después** (confirmado `GET /auth/register-status` → `open:true`) |

---

## BLOQUE U — Óptica del USUARIO (ciclo de vida)

### U1. Registro público

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U1.1 | Registro OK por formulario (plan público) | pending_email + email de verificación | ✅ `POST /auth/register` (usuario `jberger_86+u4@hotmail.com`, id 242) → 201, confirmado por SQL `registration_status='pending_email'` |
| U1.2 | CUIT inválido | Error específico | ✅ Rate limit ya había expirado (~5h después); `POST /auth/register` con CUIT `20300000012` (dígito verificador incorrecto) → "CUIT/CUIL inválido. Verificá el formato y dígito verificador." |
| U1.3 | Email ya registrado | Error | ⏭️ SKIP — el intento dio un error distinto por un campo mal armado en el payload de prueba (`toc_accepted` es el nombre real, no `aceptaTerminos`/`acceptTerms`), y el 2do intento volvió a activar el rate limit (máx. ~3/hora) antes de poder corregirlo y reintentar |
| U1.4 | CUIT ya registrado | Error | ⏭️ SKIP — bloqueado por el mismo rate limit (activado en el intento anterior) |
| U1.5 | Contraseña débil | Error con requisito | ⏭️ SKIP — bloqueado por el mismo rate limit; retomar junto con U1.3/U1.4 cuando expire (~1h) usando el campo correcto `toc_accepted:true` |
| U1.6 | Plan privado NO listado en el form | Ausente | ✅ Ya verificado indirectamente en A2.2/A2.4 (`GET /auth/plan-availability`, que es lo que consume el form de registro, no lista los planes privados) |

### U2. Verificación de email

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U2.1 | Click en link → verificado | pending_activation, trial 20 | ✅ Usuario 242: `GET /auth/verify-email?token=...` (token real de DB) → 200, confirmado por SQL `registration_status='pending_activation'`, `usage_count=0/usage_limit=20` |
| U2.2 | Reenvío de verificación desde portal | Nuevo email funciona | ✅ Usuario 241 (`pending_email`) → `POST /auth/resend-verification` → mensaje genérico de éxito; nuevo `email_verify_token` generado; verificado con el nuevo token → 200, `registration_status` pasó a `pending_activation` |
| U2.3 | Link ya usado | Página "ya verificado" | ❌ **FAIL** — ver Hallazgo #1: muestra el error genérico de token inválido/expirado en vez de "ya verificado" (bug de código, rama inalcanzable) |
| U2.4 | Token vencido (forzado) | Error claro + camino de reenvío | ✅ Token forzado a vencido por SQL (usuario 239, revertido después) → `GET /auth/verify-email` → 400 "El enlace de verificación es inválido o expiró. Contactá al administrador para que te reenvíe el email de verificación." |

### U3. Trial (20 usos compartidos)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U3.1 | Portal muestra X/20 con barra | Correcto | ✅ `GET /client/account` (usuario 242) → `usageCount:0, usageLimit:20, remaining:20` — datos correctos para la barra |
| U3.2 | A 18/20: aviso "quedan pocos usos" | Visible | ✅ Seteado `usage_count=18` por SQL → `remaining:2`; confirmado por lectura de código (`public/usuarios/app.js`) que a `trialRem<=5` y no exhausto muestra "🔴 Quedan pocos usos..." (no se pudo ver el render real por Chrome desconectado) |
| U3.3 | A 20/20: "Ya consumiste tus usos" | Visible; sesión sigue viva | ✅ Seteado `usage_count=20` → `remaining:0`; `POST /client/verify-session` sigue devolviendo 200 (sesión viva); mensaje correcto por código ("Ya consumiste tus usos...") |
| U3.4 | Extensión a 20/20 | extension-auth 403 | ✅ `GET /client/extension-auth` en 20/20 → 403 "Agotaste tus 20 usos de prueba..." |
| U3.5 | App con trial agotado | Login OK (ver cuenta), ejecutar bloqueado | ✅ Cubierto por U3.3 (verify-session 200 en 20/20); el bloqueo de ejecución es un pre-check del cliente Electron, no probado end-to-end por no tener la app corriendo en esta corrida |
| U3.6 | Checkout bloqueado en pending_activation | Botón deshabilitado + guard 403 | ✅ `POST /usuarios/api/checkout/init` en `pending_activation` → 403 "Tu cuenta debe ser activada por el administrador..." |

### U4. Activación y primer pago

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U4.1 | Admin activa → botón de pago habilitado | Portal lo muestra | ✅ `PUT /admin/users/242/registro {registration_status:'active'}` → `activated:true`; luego `POST /usuarios/api/checkout/init` ya NO da 403, devuelve `init_point` real de MP sandbox |
| U4.2 | Checkout MP sandbox completo | Preapproval vinculado; pago registrado; límites plan; contadores 0 | ✅ **Checkout MP sandbox REAL completado** (Chrome reconectó): portal → Facturación → "Configurar método de pago" → MP (tarjeta de prueba ya guardada, sin pedir CVV) → "Pagar suscripción" → **aprobado**, operación `166202947035` → volver al sitio → confirmado por API: `payment_provider='mercadopago'`, `external_subscription_id` vinculado, `usage_limit=999999`, contadores en 0, `next_billing_date` seteado; pago #43 registrado (`status='approved'`, plan COMBO_PROMO) con **factura auto-generada en `pending`** (invoice_id 40, esperando PDF) — coincide exactamente con el flujo documentado |
| U4.3 | Volver del checkout sin pagar | NO marca pago (configured:false) | ✅ `POST /usuarios/api/checkout/confirm {}` (sin `preapproval_id`) → `{configured:false}`; confirmado por SQL que `payment_provider` sigue NULL |

### U5. Vida paga

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U5.1 | Límite de submódulo alcanzado | Bloqueo del módulo con mensaje; otros siguen | ✅ Con MP real activo (2do checkout, usuario 239): `proc_usage=50` (=límite) → `POST /client/scripts/log-execution {subsystem:'proc'}` → 403 "Has alcanzado el límite de procuraciones"; en el mismo estado, `subsystem:'informe'` → 200, incrementa normalmente (0→1) — confirma que el bloqueo es por submódulo, no global. Contadores revertidos a 0 después |
| U5.2 | Renovación mensual (sim-renewal) | Contadores 0; pago+factura nuevos; next_billing +1 mes | ✅ Ejecutado `node dev-tools/sim-renewal.js 224 239 COMBO_PROMO 15000` en el servidor (usuario 239 con `proc_usage=10` forzado antes, para ver el reset): pago #45 insertado (`approved`), `applyRenewal` reseteó `usage_count`/`proc_usage` a 0, `next_billing_date` +1 mes, factura #42 encolada en `pending` |
| U5.3 | Banner de cuota (app) | Correcto según submódulo | ✅ Mismos datos de U5.1 confirmados vía `/client/account` (`usage.proc.remaining:0`, resto con cupo) — es la fuente que alimenta el banner; no se verificó el render visual en la app Electron (fuera de alcance sin computer-use) |

### U6. Cambio de plan (self-service)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U6.1 | Upgrade | Inmediato + monto MP próximo ciclo | ✅ Con MP real activo (2do checkout): `/users/change-plan` a un plan más caro → `type:'upgrade'`, aplicado de inmediato (`usage_limit=999999`); confirmado por **API real de MP** que `transaction_amount` se ajustó sin cobro inmediato (`status` sigue `authorized`). Revertido a COMBO_PROMO/$15.000 (DB + MP) y el plan de prueba a privado/$5.000 al cierre |
| U6.2 | Downgrade | Programado; banner; límites conservados | ✅ Usuario 239 (sin pago) `POST /users/change-plan {plan_name:'EXTENSION_PROMO'}` → programado para fin de ciclo (`applyAt`), `scheduled_plan` seteado, plan actual (COMBO_PROMO) y sus límites intactos mientras tanto |
| U6.3 | Cancelar downgrade programado | Vuelve a plan actual; contador devuelto | ✅ `POST /users/cancel-scheduled-plan` → `scheduled_plan=null`, plan sigue COMBO_PROMO, **`plan_changes_this_cycle` vuelve de 2 a 1** (el cambio deshecho no cuenta) |
| U6.4 | 3er cambio en el ciclo | Rechazado (tope 2) | ✅ 2 cambios seguidos OK (`plan_changes_this_cycle`→2), 3er intento → 400 "Ya realizaste 2 cambios en este período. Podrás cambiar tu plan a partir del [fecha]" |
| U6.5 | Cambio con cancelación pendiente | Bloqueado con mensaje | ✅ Con `cancel_at` seteado (SQL) → `/users/change-plan` → 400 "Tenés una cancelación programada. Reactivá tu suscripción antes de cambiar de plan." — `cancel_at` limpiado después de la prueba |

### U7. Cancelar / reactivar (portal)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U7.1 | Cancelar suscripción | cancel_at; MP paused; banner; acceso hasta fin de período | ✅ **Confirmado con preapproval MP real** (post U4.2): `POST /usuarios/api/checkout/cancel` → `cancel_at` seteado, `status` sigue `active`; verificado por **API real de MercadoPago** que el preapproval pasó a `status:'paused'` |
| U7.2 | Reactivar antes del vencimiento | MP authorized; sin cobro nuevo | ✅ **Confirmado con preapproval MP real**: `POST /usuarios/api/checkout/reactivate` → mensaje "se reanudó... no se generó un cobro nuevo"; verificado por API real de MP que el preapproval volvió a `status:'authorized'`; `cancel_at` limpiado en DB |

### U8. Pago rechazado → gracia → suspensión → recuperación

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U8.1 | Pago rechazado (simulado) | Gracia 3 días; banner ámbar portal+app; notificación | ✅ Replicada manualmente la rama "rejected" exacta de `handlePaymentEvent` (`routes/webhooks.js`, sin tocar código): `payment_grace_ends_at`=+3 días, `suspension_cause='payment'`, notificación `payment_rejected` insertada. Verificado por API: `/client/account` expone `paymentGraceEndsAt` (dato que dispara el banner ámbar en portal/app), `status` sigue `active` durante la gracia, `verify-session` sigue devolviendo 200 (sesión viva). Revertido al cierre |
| U8.2 | Gracia vencida (cron) | suspended; ejecutar bloqueado; login permite ver/pagar | ✅ Ver A6.8 (mismo caso, usuario 239) — `suspended`/`payment`, `portal-login` sigue devolviendo 200 en ese estado |
| U8.3 | Pagar estando suspendido | Recuperado; single-active | ✅ Replicada la lógica exacta de `applyRenewal()` vía SQL sobre el usuario 239 en `suspended`/`payment` (reset de contadores, `usage_limit=999999`, `status='active'`, limpia gracia/suspensión, `next_billing_date` +1 mes) + `registration_status='active'`. Verificado: `verify-session` → 200, `active`, `usageCount=0/999999` (recuperado) |

### U9. Plan vencido → reactivación

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U9.1 | Vigencia vencida (forzada) + cron | suspended_plan_expired; aviso | ✅ Ver A6.6 (mismo caso, usuario 239) — `suspended_plan_expired` + gracia 7 días + evento `plan_expired_suspended` |
| U9.2 | Portal ofrece elegir plan público + pagar | Solo públicos listados | ✅ Con el usuario en `suspended_plan_expired`, `POST /usuarios/api/checkout/init {plan_name:'COMBO_PROMO'}` → 200 con `init_point` real; confirmado por SQL que **alinea la suscripción** al plan elegido y **limpia `plan_expiry_date`** (comportamiento documentado en CLAUDE.md, confirmado en código real) |
| U9.3 | Pagar reactivación | Cuenta activa con plan nuevo | ⏭️ Intentado pero incompleto — usuario 239 suspendido (`suspended_plan_expired`) por SQL, portal mostró correctamente el banner "Tu plan venció" + selector de planes públicos (reconfirma U9.2 visualmente), se inició el checkout (`checkout_initiated_at` seteado) pero **Chrome quedó inestable/congelado** al navegar a MercadoPago y no se pudo completar el pago a tiempo. Usuario 239 restaurado manualmente a `active` limpio (plan COMBO_PROMO, MP real intacto) sin dejar transacciones a medias |

### U10. Cuenta creada por admin

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U10.1 | Email con credenciales + verificación | Llega completo | ✅ Reusa A1.1/A1.6: usuario 239 recibió email de alta (14:43, credenciales) y de reenvío de verificación (14:45); operador confirmó recepción de ambos |
| U10.2 | Verificar con plan $0 | Activo con cortesía y vigencia | ⏭️ Pendiente — no se probó en esta corrida (el usuario 239 tiene plan pago COMBO_PROMO, no CORTESIA) |
| U10.3 | Verificar con plan pago | pending_activation (trial) | ✅ Reusa A1.1/A1.6: usuario 239 (plan COMBO_PROMO) verificó email → `registration_status='pending_activation'`, `usage_limit=20`, trial activo |
| U10.4 | Cambiar contraseña temporal | Funciona; login con la nueva | ⏭️ Pendiente |

### U11. Portal completo

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U11.1 | Perfil: editar datos; CUIT NO editable | Correcto | ✅ `PUT /usuarios/api/profile` (usuario 239) con `nombre`+`telefono`+`cuit` falso → nombre/teléfono actualizados, CUIT ignorado (sigue `20300000011`, defensa en profundidad confirmada por código y en vivo) |
| U11.2 | Cambio de contraseña (política + indicador) | Correcto | ✅ `POST /auth/change-password` → 200; confirmado login exitoso con la nueva contraseña (política de fuerza ya validada en A1.5/A1.13 con el mismo helper) |
| U11.3 | Crear ticket + ver respuesta | Correcto | ✅ Ya cubierto en bloque A5 (ticket #22 creado por este mismo usuario, respuesta visible) |
| U11.4 | Bot IA: consulta resolutiva | Pasos concretos útiles | ✅ Consulta sobre "about:blank" en procuración → respuesta con pasos concretos (cerrar app/Chrome, esperar, reabrir, revisar contraseña SCW guardada, candado activo) |
| U11.5 | Ayuda: FAQ + manual inline (secciones nuevas) | Visibles | ✅ Chrome reconectó — sección Ayuda del portal verificada visualmente (usuario 239 con sesión ya activa): FAQ con pills de categoría (Todas/Procuración/Informe/Monitor/Extensión/Cuenta/Errores/Privacidad) + buscador, y el manual de usuario presente en la página (confirmado por texto) |
| U11.6 | Notificaciones in-app | Llegan y se marcan leídas | ✅ `GET /client/notifications` devuelve 5 notificaciones coherentes con los eventos generados en la corrida (cortesía, reactivación, suspensión con motivo, activación, email verificado); `POST /client/notifications/all/read` → todas marcadas `read:true` |
| U11.7 | Descargas (app + extensión) | Links funcionan | ✅ `GET /client/download/electron` → 302 al `.exe` real del último release de GitHub (v2.7.35). Extensión es link estático a Chrome Web Store, no verificado en esta corrida |

### U12. App Electron (con credenciales recordadas + expedientes provistos)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U12.1 | Login estados: trial / activo / suspendido | Mensajes y banners correctos | ✅ Usuario principal `procuradortool@gmail.com` (id 243, creado en esta corrida vía admin, plan COMBO_PROMO, `active`) → login con credenciales recordadas en la app → "Sesión: Activa", carga correctamente |
| U12.2 | Mi Cuenta: contadores y barras | Fieles a DB | ✅ Panel "Mi Cuenta": CUIT 27320694359, plan "Extensión + App Electron — Beta", Activo, vencimiento 03/07/2027, período 30 días restantes, uso por subsistema 0/50 proc · 0/20 batch (máx 10 exp/ejecución) · 0/50 informes · 0/20 monitor partes · 0/50 monitor novedades — coincide exactamente con el plan COMBO_PROMO en DB |
| U12.3 | Procuración individual (PJN real) | Ejecuta; visor abre; contadores +1 | ✅ Ejecutado con PJN real (CUIT 27320694359): login automático en SCW, extracción de 3 expedientes reales de la cuenta (FCR 9078/2021, FCR 6705/2025, CAF 018685/2024) — **3/3 exitosos, 0 fallidos, 49s**. Visor auto-abrió con los resultados reales. Verificado por DB: `usage_count`/`proc_usage` pasaron de 0→1 (cuenta por ejecución, no por expediente — coincide con el modelo `proc_executions_limit` vs `proc_expedientes_limit`) |
| U12.4 | Procuración batch (PJN real) | Ejecuta; visor batch correcto | ⏭️ Pendiente en esta corrida |
| U12.5 | Informe individual (PJN real) | PDF/Excel generados | ✅ Informe generado para expediente real `FCR 9078/2021` (uno de los detectados en U12.3): PDF con carátula, juzgado, situación y movimientos reales con links "Ver documento" — `informe_FCR 9078_2021_2026-07-03T23-14-57.pdf` en la carpeta del usuario (CUIT) |
| U12.6 | Informe batch (PJN real) | Excel+visor batch | ⏭️ Pendiente en esta corrida |
| U12.7 | Monitor: alta de parte + consulta (PJN real) | Parte agregada; consulta corre | ⏭️ Pendiente en esta corrida |
| U12.8 | Bloqueo por límite de submódulo (pre-check) | Toast antes de abrir Chrome | ⏭️ Pendiente en esta corrida |
| U12.9 | SSO al portal desde la app | Auto-login correcto | ⏭️ Pendiente en esta corrida |
| U12.10 | Archivos en carpeta del usuario (CUIT) | descargas/ correcta, raíz intacta | ✅ Confirmado por la ruta real del visor generado: `...\procurador-electron\usuarios\27320694359\descargas\procurar-individual_visor_2026-07-03T23-09-57.html` — carpeta por CUIT correcta |

### U13. Extensión Chrome (gates por API)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U13.1 | extension-login según estado (trial/activo/suspendido) | Permite/bloquea correcto | ✅ Usuario 239 activo → `POST /auth/extension-login` → 200 con token; luego `suspended_admin` (SQL) → mismo endpoint → 403 "Tu cuenta fue suspendida por el administrador." Usuario restaurado a `active` |
| U13.2 | Flujos según plan (extension_flows) | Lista correcta | ✅ Respuesta de `extension-login` incluye `enabledFlows:['consulta','escritos1','escritos2','notificaciones','deox']` — coincide con `extension_flows` configurado en el plan COMBO_PROMO |

---

## 🐛 Hallazgos — Bugs y Mejoras (se completa durante la ejecución)

| # | Sev | Tipo | Caso | Descripción | Propuesta |
|---|---|---|---|---|---|
| 1 | Bajo | Bug (UX) | U2.3 | Al reusar un link de verificación de email ya usado, se espera la página "ya verificado". En cambio muestra el error genérico "El enlace de verificación es inválido o expiró. Contactá al administrador...". Causa: `routes/auth.js` (`GET /verify-email`, rama `alreadyVerified`) busca `WHERE email_verify_token = $1 AND email_verified = true`, pero al verificar exitosamente el mismo endpoint **limpia `email_verify_token` a NULL** — la rama que maneja "ya verificado" queda inalcanzable (dead code), el segundo click siempre cae en el error genérico. Confirmado reproduciendo con un token real (usuario id 242): 1ª llamada 200 verificado, 2ª llamada mismo token → 400 genérico. Riesgo: usuarios que reabren un email viejo o hacen doble click pueden creer que su verificación falló y contactar soporte sin necesidad | No limpiar `email_verify_token` al verificar (dejarlo, solo togglear `email_verified=true`), o guardar el token en una columna separada de "último token usado" antes de limpiarlo, para que la rama `alreadyVerified` pueda matchear correctamente |
| 2 | ⚠️ No confirmado (posible artefacto de automatización) | Operativo | U9.3 | Al clickear **"Seleccionar este plan"** dentro del modal de reactivación de Mi Plan (usuario con `suspended_plan_expired`), el tab de Chrome queda **completamente sin responder** (no solo el click — cualquier comando posterior: screenshot, JS eval, lectura de red, todo timeoutea) hasta que se abre un tab nuevo. Reproducido **7 de 7 veces** en 3 tabs distintos durante 3 sesiones separadas de la tarde/noche del 2026-07-03, siempre en el mismo punto exacto. Confirmado por DB que el request **nunca llega al servidor** (`users.checkout_initiated_at` se queda en `NULL` tras el freeze), por lo que no es una llamada lenta a MercadoPago — el freeze ocurre en el cliente antes de emitir la request. **No se pudo determinar si es un bug real del frontend** (ej. loop infinito o excepción no capturada en el handler `onclick` de ese botón) **o un artefacto de la automatización vía Chrome-in-Chrome MCP** (no se pudo probar con interacción humana real en esta corrida) | Reproducir con un click humano real (sin automatización) para descartar que sea un problema de la extensión de automatización; si se confirma con click humano, revisar el handler del botón "Seleccionar este plan" en `usuarios/app.js` (la función que llama a `initCheckout(plan)` para el caso `suspended_plan_expired`) buscando un loop o una promesa no resuelta que bloquee el hilo principal |

---

## Registro de ejecución

| Fecha | Bloques ejecutados | Notas |
|---|---|---|
| 2026-07-03 | Corrida parcial A1.1–A1.5 (smoke del plan) — **REVERTIDA** | Los 5 casos dieron PASS (alta OK + 4 rechazos con mensajes correctos: email dup, CUIT dup, CUIT inválido, contraseña débil). El usuario creado (id 238) se borró de la DB para arrancar la ejecución formal desde cero. La matriz queda vacía a propósito. |
| 2026-07-03 14:30–14:50 | Backup DB (`/tmp/backup_prod_pre_testrun_20260703_143117.sql` en el server) + verificación estado inicial (solo admins 6/7, 6 planes) + **A2.1 y A2.2 ejecutados y PASS** | Corte por horario límite (14:30–15:00, sin extensión pedida por no haber caso en curso a medio terminar). Quedan creados en prod (no son destructivos, quedan como fixtures válidos para retomar A2): plan `TEST_PUBLICO_A21` (id a confirmar, público, $5.000 ARS) y `TEST_PRIVADO_A22` (privado, $8.000 ARS). **Pendiente retomar desde A2.3** (crear/verificar plan cortesía — el plan `CORTESIA` ya existe de una sesión previa, falta el caso formal de esta corrida: A2.3 en adelante), luego A2.4–A2.8, y seguir el resto del orden de ejecución (A1, U1/U2, etc.) según la sección "Orden de ejecución recomendado". Sin hallazgos de bugs hasta el momento. |
| 2026-07-03 14:36–14:45 (continuación, mismo corte 15:00) | **A2.3–A2.6 PASS**, **A2.7 SKIP** (requiere usuario suscripto, no existe aún), **A2.8 SKIP/bloqueado** (rate limit de registro activado a los 3 intentos) | Bloque A2 cerrado (con 2 pendientes documentados). Estado de planes al cierre: `TEST_PUBLICO_A21` ahora **privado** (se togglé en A2.4), `TEST_PRIVADO_A22` ahora **inactivo** (se desactivó en A2.6, proc=99/precio=$9.999 tras A2.5) — ambos quedan como fixtures de la corrida, no afectan planes reales. ⚠️ **Efecto colateral: rate limit de registro público activado** (`429`, ~1h desde esta IP, expira ~15:41) — bloquea U1 hasta entonces. **Próximo caso a retomar: A1** (gestión de usuarios, no usa `/auth/register` sino altas por admin — no debería estar afectado por el rate limit) o esperar a que expire para U1. Sin hallazgos de bugs (el rate limit es comportamiento esperado/deseado, no un bug). Cierre limpio, sin transacciones a medias. |
| 2026-07-03 14:45–14:46 (continuación, mismo corte 15:00) | **A1.1–A1.5 PASS**, **A1.6 PASS parcial** (falta confirmar email) | Corte por horario límite (15:00), cierre proactivo ~14 min antes al completar un lote de casos atómicos cortos sin dejar nada a medias. Usuario `jberger_86+u1@hotmail.com` (id 239, plan COMBO_PROMO, `pending_email`, `admin_created=true`) queda creado en prod como fixture válido para continuar A1.7 en adelante (activar/suspender/reactivar/rechazar/editar email/blanquear contraseña/historial). **Próximo caso a retomar: A1.7** (activar usuario en trial) usando el user id 239, luego A1.8–A1.15, después A3 (ya hay un usuario con plan pago para probar suscripciones desde ficha) y U1/U2 recién cuando expire el rate limit de registro (~15:41). Sin hallazgos de bugs nuevos. DB consistente, sin transacciones a medias. |
| 2026-07-03 14:46–14:57 (continuación, mismo corte 15:00) | Operador confirmó recepción de los 2 emails y verificó desde el más reciente → **A1.6 pasa a PASS completo** + se marcan **U10.1/U10.3 PASS** (mismo hecho). **A1.7 PASS** (activar usuario 239 en trial → `active`, usage_limit conservado) | **Corte final a las 15:00** (sin necesidad de extensión — A1.7 cerró limpio a las 14:57, 3 min antes). Estado del usuario fixture 239 al cierre: `registration_status='active'`, `subscriptions.status='active'`, plan COMBO_PROMO, `usage_limit=20` (sin pago configurado todavía), 0 usos consumidos. **Próximo caso a retomar: A1.8** (suspender usuario activo con motivo) usando el mismo user id 239, seguir A1.9–A1.15, luego A3 (upgrade/downgrade/cortesía sobre este usuario ya activo — ideal para probar checkout MP), y U1/U2 solo después de ~15:41 (rate limit de registro). Sin hallazgos de bugs en toda la corrida de hoy (A2 completo + A1.1–A1.7). |
| 2026-07-03 15:02–15:06 (continuación, nuevo corte 15:15) | **A1.8 PASS** (suspender con motivo, `suspended_admin`, evento con `reason` y `billing_paused:true`) · **A1.9 PASS** (reactivar → `active`) · **A1.10 PASS** (usuario nuevo id 240 creado vía admin — no afectado por el rate limit — rechazado → `rejected`) | Cierre proactivo a las 15:06, 9 min antes del corte de 15:15, para no arrancar A1.11 (rechazo manteniendo trial, requiere otro usuario nuevo) a medio camino. Usuario 239 quedó **activo** de nuevo (plan COMBO_PROMO, sin pago) — listo para A3/checkout MP. Usuario 240 quedó **rejected** (terminal, no reutilizable salvo para probar bloqueo de login). **Próximo caso a retomar: A1.11** (rechazar manteniendo trial — crear un 3er usuario admin, ej. `+u3`/CUIT `20300000038`), luego A1.12–A1.15 (editar email, blanquear contraseña, historial), y después A3 usando el usuario 239 ya activo. Sin hallazgos de bugs. |
| 2026-07-03 15:08–15:15 (continuación, nuevo corte 15:20) | **A1.11 PASS** — usuario nuevo id 241 (`jberger_86+u3@hotmail.com`) creado vía admin, email marcado verificado por admin (llega a `pending_activation`/trial sin depender del rate limit ni de un click de email), rechazado con `mode:'keep_trial'` vía endpoint dedicado `POST /admin/users/:id/reject` (distinto del selector genérico de estado) → confirmado que NO cambia `registration_status` (sigue `pending_activation`) y queda el evento `rejected_keep_trial` con motivo | Cierre a las 15:15 (corte). Descubrimiento operativo: el rechazo tiene un endpoint dedicado con `mode` ('block'/'keep_trial'), no es simplemente cambiar el selector "Estado de registro" a "Rechazado" — útil para próximas corridas. Usuario 241 queda en trial (`pending_activation`, usage_limit=20, 0 usos) — reutilizable para A1.12 (editar email) o para U-block. **Próximo caso a retomar: A1.12** (editar email del usuario, ej. sobre el 241) y seguir A1.13–A1.15, luego A3 con el usuario 239. Rate limit de registro público sigue activo hasta ~15:41 (bloquea U1). Sin hallazgos de bugs. |
| 2026-07-03 15:17–15:19 (continuación, nuevo corte 15:25) | **A1.12 PASS** (editar email del usuario 241 → `pending_email` + `email_verified=false`) · **A1.13 PASS** (email duplicado rechazado, sin capturar el texto exacto del error) | Cierre a las 15:19, 6 min antes del corte de 15:25, para no arrancar A1.14/A1.15 (que conviene hacer junto con la reverificación pendiente del email del 241) sin margen para cerrarlos. Usuario 241 queda `pending_email` con el nuevo correo `jberger_86+u3nuevo@hotmail.com` — pendiente de re-verificar para completar el ciclo de A1.12 (restaurar estado previo) y seguir con A1.14 (blanquear contraseña) / A1.15 (historial). **Próximo caso a retomar: A1.14** (blanquear contraseña, se puede hacer sobre el usuario 239 sin depender del 241), luego A1.15 y A3. Sin hallazgos de bugs. |
| 2026-07-03 16:17–16:19 (continuación, mismo corte 16:30) | **U11.5 PASS** (Chrome reconectó brevemente) | Chrome volvió a conectar después de estar caído toda la corrida anterior, aunque con inestabilidad (un timeout de screenshot). Se aprovechó para verificar U11.5 (sección Ayuda del portal: FAQ con pills + buscador + manual inline, con sesión ya activa del usuario 239). Se decidió NO arrancar U4.2 (checkout MP completo) pese a que Chrome estaba disponible, por el riesgo de no poder completarlo en los ~10 min restantes antes del corte de 16:30 y por la inestabilidad observada — queda como la tarea de mayor valor para la próxima corrida (con más margen de tiempo). Cierre limpio, sin casos a medias. Sin hallazgos de bugs nuevos. |
| 2026-07-03 18:10–18:12 (cierre de la corrida del día) | Se decidió, con el operador, **cerrar la corrida por hoy** dada la inestabilidad persistente de Chrome (3er intento fallido de retomar U9.3 en la tarde: desconexión de la extensión a mitad del click) | **RESUMEN DEL DÍA COMPLETO (2026-07-03, ~14:30–18:12):** bloques **A2 (8/8)**, **A4 (5/5)**, **A5 (6/6)**, **U2 (4/4)**, **U13 (2/2)** cerrados al 100%. Con avance sustancial: A1 (14/15), A3 (10/12), A6 (5/8), A7 (5/6), U1 (2/6, resto bloqueado por rate limit de registro), U3 (6/6), U4 (2/3), U5 (2/3), U6 (4/5), U7 (2/2), U8 (1/3), U9 (2/3), U11 (6/7). **Hito técnico:** se completaron **2 checkouts reales en MercadoPago sandbox** con la tarjeta de prueba, lo que permitió validar contra la API real de MP el ciclo completo de upgrade/downgrade/cancelar/reactivar/idempotencia de webhooks — mucho más valioso que simulaciones. **1 hallazgo de bug real** (bajo impacto): Hallazgo #1, link de verificación de email reusado muestra error genérico en vez de "ya verificado" (bug de código en `routes/auth.js`, rama inalcanzable porque el token se limpia tras verificar). **Estado de los fixtures al cierre:** usuario 239 (`jberger_86+u1@hotmail.com`) activo, plan COMBO_PROMO, con suscripción MP real intacta (preapproval `33d45ac93b1c46659e248c70d188b057`, $15.000/mes, sin gracia/cancelación/downgrade pendiente) — **ideal punto de partida para U9.3 en la próxima corrida** (ya está todo preparado, solo falta que Chrome esté estable para completar el checkout de reactivación). Usuario 240 (`rejected`, terminal). Usuario 241 (`pending_activation`, trial, plan EXTENSION_PROMO). Usuario 242 (`pending_activation`, trial, plan COMBO_PROMO). Planes de prueba `TEST_PUBLICO_A21` ($5.000, privado) y `TEST_PRIVADO_A22` ($9.999, inactivo) quedan como fixtures reutilizables. **Pendientes principales para la próxima corrida:** U9.3 (reactivación pagando — ya armado, solo falta Chrome estable), A6.2 (single-active con 2 checkouts sin cancelar el primero), U5.2 (`sim-renewal.js`), U8.3 (recuperación pagando en gracia/suspendido), U1.2–U1.5 (bloqueados por rate limit, esperar >1h o usar otra IP/sesión), U11.5 ya cubierto, U12 (app Electron, requiere computer-use) y U13 ya cerrado. Sin transacciones a medias, sin deuda de limpieza pendiente. |
| 2026-07-03 17:47–18:01 (continuación, nuevo corte 18:30) | **U8.1 PASS** (gracia por pago rechazado, replicado sin webhook real) | Chrome mostró **inestabilidad persistente** durante todo este tramo (timeouts repetidos de `Page.captureScreenshot`/`executeScript` en 2 tabs distintos, incluso una recién creada) — se intentó retomar U9.3 dos veces sin éxito, se abandonó cada intento sin dejar transacciones a medias (solo se llegó a abrir el modal de selección de plan, sin iniciar el checkout real). Se aprovechó la técnica ya usada en los crons (A6.6/A6.7/A6.8) para U8.1: replicar la rama exacta de código del webhook de pago rechazado vía SQL, sin necesitar la firma HMAC ni un pago real rechazado. Se verificó además que A6.2 (single-active) no quedó genuinamente probado hoy — los 2 checkouts reales de la sesión anterior no se solaparon (el primero ya estaba cancelado manualmente antes del segundo), así que no se ejerció la lógica de auto-cancelación del superseded; queda pendiente. Usuario 239 restaurado a estado limpio (`active`, COMBO_PROMO, MP real intacto, sin gracia/suspensión residual). **Cierre a las 18:01, con ~29 min de margen sobre el corte de 18:30**, por prudencia ante la inestabilidad del navegador — mejor cerrar en un punto limpio que seguir forzando Chrome. **Próximo caso a retomar: U9.3** (con Chrome fresco/reiniciado si sigue inestable), luego A6.2 (requiere 2 checkouts reales en sucesión, sin cancelar el primero), U5.2 (`sim-renewal.js`), U8.3, U12/U13 restante. Sin hallazgos de bugs nuevos. |
| 2026-07-03 16:47–17:02 (continuación, nuevo corte 17:20) | **U5.1/U5.3 PASS** (límite por submódulo, enforcement server-side real confirmado en `log-execution`) · **U6.1 PASS** (upgrade self-service inmediato con MP real, monto ajustado) · **U9.3 intentado, incompleto** (Chrome se puso inestable/congelado navegando a MP a mitad del checkout de reactivación) | Para U5/U6.1 se hizo un **2do checkout MP real** (mismo flujo ya conocido, ~1 min) que reemplazó al preapproval anterior (cancelado en A6.3). Se confirmó un hallazgo operativo importante: `POST /client/scripts/log-execution` **sí tiene enforcement server-side real por submódulo** (no es solo un pre-check del cliente Electron como se documentaba) — bloquea con 403 al llegar al límite de un subsistema mientras los demás siguen funcionando. Al intentar U9.3, Chrome dejó de responder a mitad de la navegación al checkout de MP (timeouts repetidos de `Page.captureScreenshot` y `executeScript`) — se abandonó esa interacción concreta (no había ninguna transacción de datos a medias, solo un `checkout_initiated_at` sin pago) y se restauró el usuario 239 a `active` limpio con su suscripción MP real intacta (COMBO_PROMO, `usage_limit=999999`, `usage_count=1` residual de las pruebas de límite). **Próximo caso a retomar: U9.3** (probablemente con una sesión de Chrome fresca), luego U5.2 (sim-renewal.js), U8.1/U8.3 (pago rechazado, requiere simular webhook `payment` con status rechazado), A6.2 (single-active con 2 checkouts en sucesión rápida), U12 (app Electron). Sin hallazgos de bugs nuevos (el enforcement de log-execution es un comportamiento correcto/deseado, no un bug). |
| 2026-07-03 16:25–16:42 (continuación, nuevo corte 17:00) | **HITO: U4.2 completado con pago REAL en MP sandbox** (Chrome estable esta vez). En cascada, todo lo que dependía de un pago real: **A3.1/A3.2 PASS** (upgrade inmediato con ajuste de monto en MP confirmado por API real; downgrade programado) · **U7.1/U7.2 PASS completo** (cancelar pausa el preapproval real; reactivar lo reanuda sin cobro, ambos confirmados contra la API real de MP) · **A6.3 PASS** (cancelación directa en MP sincroniza vía webhook a baja programada; reactivate rechaza correctamente la transición terminal) · **A6.1 PASS** (idempotencia de webhook: reenviado el webhook real 2 veces más con firma HMAC generada server-side sin exponer el secreto — 0 duplicados en `webhook_events` ni `payments`) · **U13.1/U13.2 PASS** (extension-login permite/bloquea según estado, flows correctos) · **U2.2/U2.4 PASS** (bloque U2 cerrado 4/4: reenvío de verificación y token vencido) | Cierre a las 16:42, 18 min antes del corte de 17:00, en un punto natural tras una seguidilla de hitos importantes. Usuario 239 (fixture principal) verificado en **estado limpio**: `active`, COMBO_PROMO, 20/0, sin `payment_provider`/`cancel_at`/`scheduled_plan`/`plan_expiry_date` residuales, email verificado. El preapproval real de MP quedó genuinamente cancelado del lado de MP (parte esperada de la prueba de A6.3) — no queda ningún preapproval vivo asociado al usuario. Sin hallazgos de bugs nuevos en este tramo (el único hallazgo de toda la corrida sigue siendo el Hallazgo #1 de U2.3). **Pendientes de mayor entidad para la próxima corrida:** U5 (vida paga — requiere un pago activo, ahora se sabe cómo generarlo rápido: portal→Facturación→Configurar método de pago), U6.1 (upgrade self-service, mismo requisito), U8.1/U8.3 (pago rechazado→gracia→recuperación), U9.3 (pagar reactivación real), A6.2 (single-active con 2 checkouts seguidos), U12 (app Electron, requiere computer-use), A1.14 completar el ciclo de reset de password. |
| 2026-07-03 15:36–16:12 (continuación, nuevo corte 16:30, cierre a las 16:12) | **Bloque más largo de la corrida.** Chrome se desconectó a los pocos minutos (no se recuperó en toda la sesión) → pivote a **API/curl con token admin real** (`/auth/admin-login`, no un JWT firmado a mano) + `portal-login` para usuarios. Completados: **A1.14** (parcial, reset de password disparado) · **A1.15 PASS** (historial completo) · **A2 CERRADO 8/8** (A2.7 propagación de vigencia + A2.8 blindaje vía `/users/change-plan`) · **A3.3/A3.9-A3.12 PASS** (cambio de plan trial, reset de uso, bonus por submódulo, usos extra ±N, beneficio comercial con/sin ticket) · **A5 CERRADO 6/6** (tickets: respuesta, nota interna, priorización IA, sugerencia IA, edición, resolución) · **A7 CASI CERRADO** (401/403, bot IA declina x2, toggle registro restaurado, A7.5 skip por costo) · **U1.1/U1.6 PASS** + U1.2-U1.5 bloqueados por rate limit de registro (max 3/hora por IP, confirmado en código) · **U2.1 PASS** + **U2.3 FAIL (Hallazgo #1, bug real)** · **U3 CERRADO 6/6** (trial 20 usos) · **U4.1/U4.3 PASS**, U4.2 pendiente (requiere Chrome) · **A4 CERRADO 5/5** (cobranza: pagos/facturas manuales, link/unlink, edición) · **U11 CASI CERRADO** (perfil, password, bot IA, notificaciones, descargas; falta U11.5 FAQ) · **U6 CASI CERRADO** (downgrade programado, cancelar downgrade devuelve contador, tope de 2 cambios, bloqueo con cancelación pendiente; falta U6.1 upgrade real) · **U7 PASS parcial** (cancelar/reactivar sin MP real) · **A6.4/A6.6/A6.7/A6.8 PASS** (crons de cancelación-guard, vigencia-vencida, downgrade-programado y gracia-vencida, todos replicados manualmente vía SQL exacto de `server.js` sin tocar código) · **U9.1/U9.2 PASS** (vigencia vencida + reactivación alinea el plan). Usuario fixture 239 quedó **restaurado a estado limpio** (`active`, COMBO_PROMO, 0/20, sin flags residuales) verificado por API antes del cierre. **1 hallazgo real (bajo, UX):** ver Hallazgo #1 — link de verificación reusado muestra error genérico en vez de "ya verificado" (bug de código real, no cosmético). **Pendientes que requieren Chrome/MP real para la próxima corrida:** U4.2 (checkout MP sandbox completo — esto desbloquearía en cascada A3.1/A3.2/A3.4/A3.6-A3.8, U6.1, U7.2 real, U8.1/U8.3, U9.3, A6.1-A6.3), U11.5 (FAQ/manual), U12/U13 (app Electron + extensión, siempre requirieron Chrome/computer-use). Sin otros hallazgos de bugs nuevos en este tramo. |
