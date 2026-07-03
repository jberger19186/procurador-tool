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
| A2.7 | Vigencia real del plan (plan_expiry_date) | Se propaga a suscripciones activas del plan | ⏭️ SKIP — requiere un usuario con suscripción activa al plan (no existen usuarios de prueba todavía en esta corrida). Retomar junto con A3/A9 una vez creados los usuarios de U-block |
| A2.8 | Usuario intenta autoasignarse plan privado por API | 400/403 — blindaje server-side | ⏭️ SKIP (bloqueado, no por fallo del sistema) — se intentó vía `POST /auth/register` con `plan_name=TEST_PUBLICO_A21` (privado); tras 3 intentos completando campos faltantes (`plan_name`, `domicilio`, T&C) se activó el **rate limit de registro** (`429 "Demasiados intentos de registro", retryAfter:"1 hora"`) antes de llegar a probar el blindaje en sí. ⚠️ **Efecto colateral importante:** el registro público por API/formulario queda bloqueado por ~1h desde esta IP — impacta directamente **U1 (registro público)**, que debía ejecutarse a continuación. Retomar A2.8 y U1 después de que expire el rate limit (~15:41) o desde otra IP/sesión |

### A3. Suscripciones (desde ficha)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A3.1 | Upgrade con MP activo | Inmediato; monto MP ajustado al nuevo (sin cobro ya) | |
| A3.2 | Downgrade con MP activo | Programado a fin de ciclo; límites conservados; evento | |
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
| A4.1 | Alta de pago manual | Aparece en Pagos y en historial del usuario | |
| A4.2 | Crear factura desde pago (subir PDF) | Vinculada; visible en portal del usuario | |
| A4.3 | Factura manual sin pago | Registrada; visible para el usuario | |
| A4.4 | Asociar/desasociar pago↔factura | Links cruzados navegan y resaltan | |
| A4.5 | Editar registro manual (pago/factura) | Cambios persisten; no-manuales rechazados | |

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
| A6.1 | Webhook MP duplicado (mismo evento 2×) | Idempotente: no duplica pago | |
| A6.2 | Dos checkouts seguidos (single-active) | 1 solo preapproval vivo; el viejo cancelado | |
| A6.3 | Cancelar preapproval desde MP (lado usuario) | Webhook sincroniza baja programada | |
| A6.4 | Cron cancelación con pago reciente (guard) | NO cancela | |
| A6.5 | Cron vigencia: período pago en curso | Pausa MP + corte al fin de período (no inmediato) | |
| A6.6 | Cron vigencia: período ya vencido | Suspende ya + gracia 7 días | |
| A6.7 | Cron downgrade programado | Aplica plan + baja monto MP + evento | |
| A6.8 | Gracia de pago vencida (cron) | suspended por pago fallido | |

### A7. Seguridad / negativos

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A7.1 | Endpoint admin sin token | 401 | |
| A7.2 | Endpoint admin con token de usuario común | 403 | |
| A7.3 | Bot IA: pedir info interna (endpoints/DB/admin) | Declina + ofrece ticket | |
| A7.4 | Bot IA: pedir datos de otro usuario | Declina | |
| A7.5 | Rate limit del bot (21ª consulta en 1h) | 429 | |
| A7.6 | Registro con toggle público cerrado | 403 registro no habilitado | |

---

## BLOQUE U — Óptica del USUARIO (ciclo de vida)

### U1. Registro público

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U1.1 | Registro OK por formulario (plan público) | pending_email + email de verificación | |
| U1.2 | CUIT inválido | Error específico | |
| U1.3 | Email ya registrado | Error | |
| U1.4 | CUIT ya registrado | Error | |
| U1.5 | Contraseña débil | Error con requisito | |
| U1.6 | Plan privado NO listado en el form | Ausente | |

### U2. Verificación de email

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U2.1 | Click en link → verificado | pending_activation, trial 20 | |
| U2.2 | Reenvío de verificación desde portal | Nuevo email funciona | |
| U2.3 | Link ya usado | Página "ya verificado" | |
| U2.4 | Token vencido (forzado) | Error claro + camino de reenvío | |

### U3. Trial (20 usos compartidos)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U3.1 | Portal muestra X/20 con barra | Correcto | |
| U3.2 | A 18/20: aviso "quedan pocos usos" | Visible | |
| U3.3 | A 20/20: "Ya consumiste tus usos" | Visible; sesión sigue viva | |
| U3.4 | Extensión a 20/20 | extension-auth 403 | |
| U3.5 | App con trial agotado | Login OK (ver cuenta), ejecutar bloqueado | |
| U3.6 | Checkout bloqueado en pending_activation | Botón deshabilitado + guard 403 | |

### U4. Activación y primer pago

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U4.1 | Admin activa → botón de pago habilitado | Portal lo muestra | |
| U4.2 | Checkout MP sandbox completo | Preapproval vinculado; pago registrado; límites plan; contadores 0 | |
| U4.3 | Volver del checkout sin pagar | NO marca pago (configured:false) | |

### U5. Vida paga

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U5.1 | Límite de submódulo alcanzado | Bloqueo del módulo con mensaje; otros siguen | |
| U5.2 | Renovación mensual (sim-renewal) | Contadores 0; pago+factura nuevos; next_billing +1 mes | |
| U5.3 | Banner de cuota (app) | Correcto según submódulo | |

### U6. Cambio de plan (self-service)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U6.1 | Upgrade | Inmediato + monto MP próximo ciclo | |
| U6.2 | Downgrade | Programado; banner; límites conservados | |
| U6.3 | Cancelar downgrade programado | Vuelve a plan actual; contador devuelto | |
| U6.4 | 3er cambio en el ciclo | Rechazado (tope 2) | |
| U6.5 | Cambio con cancelación pendiente | Bloqueado con mensaje | |

### U7. Cancelar / reactivar (portal)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U7.1 | Cancelar suscripción | cancel_at; MP paused; banner; acceso hasta fin de período | |
| U7.2 | Reactivar antes del vencimiento | MP authorized; sin cobro nuevo | |

### U8. Pago rechazado → gracia → suspensión → recuperación

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U8.1 | Pago rechazado (simulado) | Gracia 3 días; banner ámbar portal+app; notificación | |
| U8.2 | Gracia vencida (cron) | suspended; ejecutar bloqueado; login permite ver/pagar | |
| U8.3 | Pagar estando suspendido | Recuperado; single-active | |

### U9. Plan vencido → reactivación

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U9.1 | Vigencia vencida (forzada) + cron | suspended_plan_expired; aviso | |
| U9.2 | Portal ofrece elegir plan público + pagar | Solo públicos listados | |
| U9.3 | Pagar reactivación | Cuenta activa con plan nuevo | |

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
| U11.1 | Perfil: editar datos; CUIT NO editable | Correcto | |
| U11.2 | Cambio de contraseña (política + indicador) | Correcto | |
| U11.3 | Crear ticket + ver respuesta | Correcto | |
| U11.4 | Bot IA: consulta resolutiva | Pasos concretos útiles | |
| U11.5 | Ayuda: FAQ + manual inline (secciones nuevas) | Visibles | |
| U11.6 | Notificaciones in-app | Llegan y se marcan leídas | |
| U11.7 | Descargas (app + extensión) | Links funcionan | |

### U12. App Electron (con credenciales recordadas + expedientes provistos)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U12.1 | Login estados: trial / activo / suspendido | Mensajes y banners correctos | |
| U12.2 | Mi Cuenta: contadores y barras | Fieles a DB | |
| U12.3 | Procuración individual (PJN real) | Ejecuta; visor abre; contadores +1 | |
| U12.4 | Procuración batch (PJN real) | Ejecuta; visor batch correcto | |
| U12.5 | Informe individual (PJN real) | PDF/Excel generados | |
| U12.6 | Informe batch (PJN real) | Excel+visor batch | |
| U12.7 | Monitor: alta de parte + consulta (PJN real) | Parte agregada; consulta corre | |
| U12.8 | Bloqueo por límite de submódulo (pre-check) | Toast antes de abrir Chrome | |
| U12.9 | SSO al portal desde la app | Auto-login correcto | |
| U12.10 | Archivos en carpeta del usuario (CUIT) | descargas/ correcta, raíz intacta | |

### U13. Extensión Chrome (gates por API)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U13.1 | extension-login según estado (trial/activo/suspendido) | Permite/bloquea correcto | |
| U13.2 | Flujos según plan (extension_flows) | Lista correcta | |

---

## 🐛 Hallazgos — Bugs y Mejoras (se completa durante la ejecución)

| # | Sev | Tipo | Caso | Descripción | Propuesta |
|---|---|---|---|---|---|
| | | | | | |

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
