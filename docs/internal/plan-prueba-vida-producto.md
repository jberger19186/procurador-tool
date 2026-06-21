# Plan de prueba de vida del producto — Recorrido completo del usuario

> Creado 2026-06-20. Documento maestro **autocontenido** para ejecutar con computer-use
> (incluso con Sonnet, para ahorrar recursos). Cada caso (TC) trae: quién lo ejecuta,
> setup de estado (SQL exacto), pasos literales, resultado esperado **verbatim** y
> restauración. Cubre todo el embudo: **landing → registro → trial → pago → uso diario →
> suscripción → transversales**.
>
> Complementa (no reemplaza) `plan-pruebas-ciclo-vida.md` (centrado en cobranza, PLAN 3 cerrado).
> Para el detalle de la matriz cancelar/reactivar y la renovación, ver ese documento.
>
> **Modelo de ejecución recomendado:** **Sonnet 4.6, esfuerzo medio** (validado en el piloto
> del 2026-06-20). El razonamiento pesado vive en ESTE documento, no en el modelo en runtime.
> Reservar Opus para el análisis consolidado final y auditorías de código/seguridad. Ver §1bis.

---

## 0. Coordenadas estables (no cambian entre corridas)

| Dato | Valor |
|---|---|
| **Usuario de prueba** | `procuradortool@gmail.com` · `user_id = 233` · `sub_id = 214` |
| **CUIT** | `27320694359` (11 dígitos) |
| **Admins** | `admin@procurador.com` (id 6) · `admin@tudominio.com` (id 7) |
| **Plan de prueba** | `COMBO_PROMO` ($15.000) · alterno: `EXTENSION_PROMO` ($1.500) |
| **external_subscription_id** | `test_preapproval_sandbox_214` |
| **Expediente de prueba (real)** | `FCR 018745/2017` (usado en smoke tests grupo E) |
| **Tarjeta MP de prueba** | `5031 7557 3453 0604` · `11/30` · CVV `123` · titular `APRO` · DNI `12345678` |
| **Landing** | https://procuradortool.com |
| **Portal usuario** | https://api.procuradortool.com/usuarios/ |
| **Registro** | https://api.procuradortool.com/register/ |
| **Dashboard admin** | https://api.procuradortool.com/dashboard/ |
| **App Electron (exe)** | `C:\Users\JONATHAN\AppData\Local\Programs\Procurador SCW\Procurador SCW.exe` |

### Límites del plan COMBO_PROMO
`proc 50 · informe 50 · batch 20 · monitor_novedades 50 · monitor_partes 20`

---

## 1. Convenciones de ejecución (LEER antes de empezar)

### Tiers de computer-use
| App | Tier | Qué se puede |
|---|---|---|
| **Procurador SCW** (Electron) | `full` | click, type, screenshot — todo |
| **Chrome** | `read` | **solo screenshot**. Para clicks/typing en web → usar el MCP `claude-in-chrome` **o** pedírselo al usuario (humano) |
| **Terminal / IDE** | `click` | solo click; para comandos usar la tool Bash |

> ⚠️ Todo lo que sea **web** (landing, portal, registro, dashboard admin, checkout MP, flujos de la extensión) **no es clickeable** vía computer-use. Se hace con `claude-in-chrome` MCP o lo ejecuta el **usuario humano**. La **app Electron** sí es controlable por computer-use.

### Re-login de la app (la sesión expira cuando Chrome toma el foco)
1. `open_application "Procurador SCW"` (o `Start-Process` del exe si no aparece).
2. Las credenciales quedan precargadas → click en **"Iniciar Sesión →"**.
3. Esperar "¡Bienvenido! Cargando aplicación…".

### Verificación de estado en DB (refleja al instante, sin re-login)
Los endpoints `/client/verify-session`, `/client/account` y `/client/batch-limits` **no cachean** → cualquier `UPDATE` en `subscriptions` se ve en la próxima lectura de la app (reabrir Mi Cuenta o tocar Procurar/Informe/Monitor).

```bash
# Ver estado actual del usuario de prueba
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
 "sudo -u postgres psql procurador_db -c \"SELECT u.registration_status, s.plan, s.status, s.payment_provider, s.usage_count, s.usage_limit, s.proc_usage, s.informe_usage, s.batch_usage, s.monitor_novedades_usage, s.proc_bonus, s.scheduled_plan, s.cancel_at, s.next_billing_date FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.user_id=233;\""
```
> El warning `could not change directory to "/root"` es inocuo — ignorarlo.

### Snippets SQL reutilizables
```sql
-- A) RESET a PAGO limpio (estado base "uso diario", todo en 0)
UPDATE subscriptions SET plan='COMBO_PROMO', payment_provider='mercadopago',
  external_subscription_id='test_preapproval_sandbox_214', status='active',
  usage_limit=999999, usage_count=0, proc_usage=0, informe_usage=0,
  batch_usage=0, monitor_novedades_usage=0, proc_bonus=0,
  scheduled_plan=NULL, cancel_at=NULL WHERE user_id=233;
UPDATE users SET registration_status='active' WHERE id=233;

-- B) Simular TRIAL (sin pago) con N usos consumidos de 20
UPDATE subscriptions SET payment_provider=NULL, usage_count=<N>, usage_limit=20,
  proc_usage=0, informe_usage=0, batch_usage=0, monitor_novedades_usage=0
  WHERE user_id=233;
UPDATE users SET registration_status='pending_activation' WHERE id=233;

-- C) Agotar UN submódulo (pago)   → <col> ∈ proc_usage|informe_usage|batch_usage|monitor_novedades_usage
UPDATE subscriptions SET <col>=<limite> WHERE user_id=233;

-- D) Limpiar partes del monitor (saltea la regla de 24h/30d)
DELETE FROM monitor_partes WHERE user_id=233;
```

### Leyenda de estado
- ✅ **Validado** (con fecha/sesión)
- ⏸ **Bloqueado** (depende de algo externo)
- 🔲 **Pendiente** (no ejercitado todavía) ← **foco de las próximas corridas**

---

## 1bis. Aprendizajes del piloto + recetas operativas (2026-06-20)

> Piloto de TC-D2 (informe `FCR 018745/2017`) con **Sonnet 4.6**. Conclusión: **Sonnet
> ejecuta la app Electron sin problemas**; el cuello de botella es el **entorno**, no el modelo.

### ⚠️ Pre-check obligatorio antes de cualquier TC que toque el PJN (D1, D2, D3)
El piloto falló 5 reintentos con `Waiting for selector 'h2.form_title' failed`. **Causa real:
el PJN estaba en mantenimiento** ("Sitio en Mantenimiento" en `scw.pjn.gov.ar`, sin ese
selector). El script autenticó OK (CUIT 27320694359) y reintentó solo — el código estaba bien.
- **Antes de correr D1/D2/D3:** abrir `https://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam`
  en Chrome (o pedírselo al usuario). Si dice **"Sitio en Mantenimiento"** → **posponer** los TC
  del PJN y correr los que NO dependen de él (A, F, G, H, E1).
- Síntoma inequívoco de mantenimiento: errores repetidos de `h2.form_title` pese a sesión válida.

### Recetas de computer-use que funcionaron (copiar tal cual)
- **Abrir la app:** `request_access(["Procurador SCW"])` → `open_application("Procurador SCW")`.
  La app **instalada** (v2.7.27) arranca sola; tarda ~5 s en mostrar el login.
- **Login:** credenciales precargadas → click en **"Iniciar Sesión →"** → esperar ~4 s.
- **Re-login (la sesión Electron expira cuando Chrome toma el foco):** `open_application
  ("Procurador SCW")` para traerla al frente → click "Iniciar Sesión →". Pasó varias veces
  en el piloto; es esperable cada vez que se mira el navegador headless.
- **Campo de expediente en el modal Informe:** a veces el texto se ve pero no registra
  (validación "Ingresá el número de expediente"). Solución: `triple_click` en el campo →
  `type "FCR 018745/2017"` → click en zona neutra (blur) → **Ejecutar**.
- **Ver el navegador headless:** toggle **"Navegador"** (arriba a la derecha) lo trae a pantalla.
  Pero Chrome es tier `read` → **no se puede clickear**; solo screenshot. Al traerlo al frente,
  la sesión de la app suele expirar (ver re-login).
- **Esperas:** `sleep` corto (≤15 s) en la tool Bash. El harness **bloquea** sleeps largos o
  encadenados — si hay que esperar más, repetir `sleep 15` en llamadas separadas.

### Lo que el piloto dejó demostrado
- ✅ Sonnet maneja: abrir app, login, navegar, abrir modales, completar campos, leer la consola
  línea por línea, diagnosticar el fallo (hipótesis correctas), consultar la DB por SSH en paralelo.
- ✅ El script de automatización está **sano** (conecta, autentica, reintenta) — el fallo fue 100% PJN.

---

# BLOQUE A — Descubrimiento y alta (frente del embudo)

> Todo web → `claude-in-chrome` MCP o usuario humano. Claude verifica en DB.

### TC-A1 · Landing carga y muestra planes/precios 🔲
- **Quién:** chrome / humano
- **Pasos:** abrir https://procuradortool.com → revisar navbar, hero, sección Planes.
- **Esperado:** carga sin errores; planes visibles: **COMBO_PROMO $15.000** y **EXTENSION_PROMO $1.500**; permanentes (BASIC/PRO/ENTERPRISE) como "Próximamente"; footer con links a Términos y Privacidad; aviso PJN ("las contraseñas nunca pasan por nuestros servidores").
- **Restaurar:** —

### TC-A2 · Registro público — camino feliz 🔲
- **Quién:** chrome / humano + Claude (verifica DB)
- **Setup:** confirmar que el registro está **abierto**: `GET /auth/register-status` → `{open:true}`. Si está cerrado, abrirlo desde Dashboard admin → Usuarios pendientes → "⚙️ Configuración rápida".
- **Pasos:** en /register/ completar email nuevo + contraseña válida + CUIT no usado + **teléfono** (campo nuevo, opcional) → aceptar T&C → Enviar.
- **Esperado:** alta OK; `registration_status='pending_email'`; **teléfono persistido** en `users.telefono`; card COMBO muestra límites reales (proc 50 + 20/lote · informes 50 · monitor 20 partes + 50 novedades/mes).
- **Verif. DB:** `SELECT email, telefono, registration_status FROM users WHERE email='<nuevo>';`
- **Restaurar:** borrar el usuario de prueba creado (o usar la herramienta dev-tools de borrado de usuarios).

### TC-A3 · Registro — validaciones de guarda 🔲
- **Quién:** chrome / humano
- **Sub-casos y esperado:**
  - **CUIT duplicado** (usar 27320694359) → error "CUIT ya registrado", no avanza.
  - **Email duplicado** → error, no avanza.
  - **Contraseña débil** (ej. `1234`) → mensaje de política: mín. 8 chars + letra + número + no común + ≠ email.
  - **Sin aceptar T&C** → no deja enviar.
- **Restaurar:** —

### TC-A4 · Verificación de email 🔲
- **Quién:** humano (abre el mail) + Claude (DB)
- **Pasos:** registrar (TC-A2) → abrir el email de verificación → click en "Verificar" → debe llevar al portal con "Ir al portal →".
- **Esperado:** `registration_status` pasa a `pending_activation`; suscripción `suspended` con `usage_limit=20`; mensaje "Tenés 20 usos de prueba".
- **Sub-caso reenvío:** `POST /auth/resend-verification` con el email → respuesta **genérica siempre** (anti-enumeración); llega un nuevo mail.
- **Sub-caso link vencido/inválido:** abrir un token inválido → mensaje de error claro, ofrece reenviar.
- **Restaurar:** borrar usuario de prueba.

---

# BLOQUE B — Descarga e instalación

### TC-B1 · Descarga del instalador desde el portal 🔲
- **Quién:** humano (login portal) + Claude (verifica redirect)
- **Pasos:** login en /usuarios/ → sección **Descargas** → click "Descargar app".
- **Esperado:** `GET /client/download/electron` consulta GitHub API y hace **302** al `.exe` del último release; descarga el instalador. Texto de versión visible coincide con el release (ej. v2.7.27).
- **Restaurar:** —

### TC-B2 · Instalación (warning SmartScreen) 🔲
- **Quién:** humano
- **Pasos:** ejecutar el `.exe`.
- **Esperado:** Windows muestra **"Editor desconocido"** (el exe **no está firmado** — Azure Trusted Signing pendiente, AZ). El usuario hace "Más información → Ejecutar de todas formas". Instala OK.
- **Nota:** este warning desaparece sólo al cerrar el pendiente **AZ** (code signing). Documentar para el onboarding.
- **Restaurar:** —

### TC-B3 · Primer login en la app 🔲
- **Quién:** computer-use (app, full)
- **Pasos:** abrir la app → ingresar credenciales → "Iniciar Sesión".
- **Esperado:** login OK incluso en `pending_activation`; arranca el onboarding (ver Bloque C).
- **Restaurar:** —

---

# BLOQUE C — Onboarding de primer uso (alto riesgo histórico)

> Es la primera impresión del usuario y donde más fricción hubo (about:blank, lock files).
> Para forzar el onboarding desde cero ver "Reset de la app Electron" en CLAUDE.md (Opción A: borrar `onboarding_complete.json`).

### TC-C1 · Tour guiado 🔲
- **Quién:** computer-use (app, full)
- **Setup:** `Remove-Item "$env:LOCALAPPDATA\procurador-electron-updater\onboarding_complete.json" -Force`
- **Pasos:** abrir la app → recorrer el tour paso a paso (Next en cada card).
- **Esperado:** los 13 pasos se posicionan bien (sin cards fuera de pantalla); el paso 4 resalta Procurar + fecha + Por lote; el paso 10 y 13 centran bien.
- **Restaurar:** —

### TC-C2 · Configurar Chrome dedicado 🔲
- **Quién:** computer-use (app, full)
- **Pasos:** en el onboarding/Configuración, abrir el navegador PJN.
- **Esperado:** Chrome abre **directo en portalpjn.pjn.gov.ar** (sin pasar por about:blank ni Google); espera los redirects de SSO. Sin banners de seguridad ("controlado por software automatizado" no aparece).
- **Restaurar:** `closeChromeProfile()` limpia lock files al cerrar.

### TC-C3 · Agregar contraseña SCW al gestor de Chrome 🔲
- **Quién:** humano (escribe la clave PJN) + computer-use (dispara el flujo)
- **Pasos:** Configuración → Seguridad → "Agregar contraseña SCW" → se abre `chrome://password-manager` con overlay de instrucciones → el usuario guarda la clave del PJN.
- **Esperado:** overlay visible durante todo el llenado; al terminar, el gestor tiene la entrada `pjn.gov.ar`.
- **Verif:** `Login Data` contiene "pjn" (snippet en CLAUDE.md "Diagnóstico rápido: credenciales guardadas").
- **Restaurar:** —

### TC-C4 · Verificar credenciales guardadas (precondición de las ejecuciones) ✅ 2026-06-20
- **Quién:** Claude (PowerShell)
- **Pasos:**
```powershell
$f = "$env:LOCALAPPDATA\ProcuradorSCW\ChromeProfile\Default\Login Data"
$b = [IO.File]::ReadAllBytes($f); [Text.Encoding]::UTF8.GetString($b) -match "pjn"
```
- **Esperado:** `True`. Si `False` → la automatización no puede autofill → repetir TC-C3.
- **Nota (2026-06-20):** Chrome bloquea el archivo `Login Data` mientras está corriendo (IOException). Workaround: copiar a `$env:TEMP\LoginData_check.db` y leer la copia — retorna `True`.

---

# BLOQUE D — Trial: primeras ejecuciones reales (20 usos compartidos)

> **El corazón de la experiencia del usuario nuevo.** Requiere TC-C4 = True.
> Setup de estado base trial: snippet **B** con `<N>=0`.

### TC-D1 · ⭐ Primera PROCURACIÓN exitosa de punta a punta ✅ 2026-06-20 (PRUEBA REINA)
- **Quién:** computer-use (app, full) + humano disponible si Chrome pide algo
- **Setup:** trial con usos disponibles (snippet B, N=0).
- **Pasos:** sidebar **Procurar** → (fecha límite = hoy por defecto) → botón **Procurar**.
- **Esperado:** Chrome abre, login SSO con CUIT 27320694359, recorre expedientes, **termina sin error**, suma 1 a `usage_count`, **el visor HTML se abre automáticamente** al finalizar.
- **Verif. DB:** `usage_count` +1.
- **Restaurar:** snippet B (N=0).
- **Resultado (2026-06-20, cuenta pago activa, fecha límite 19/06/2026):** 2 expedientes procesados en 27 s. Visor HTML abierto automáticamente. `usage_count` 4→5, `proc_usage` 1→2. 0 fallidos.
  - FCR 9078/2021 — AFIP c/ QUISPE — Juzgado Federal Caleta Olivia — 15 movs. ✅
  - FCR 6705/2025 — ARCA c/ BRISAS SUREÑAS — Cámara Federal Comodoro — 15 movs. ✅

### TC-D2 · INFORME individual exitoso ✅ 2026-06-20
- **Quién:** computer-use (app, full)
- **Pasos:** sidebar **Informe** → tab Individual → expediente `FCR 018745/2017` → (blur) → Ejecutar.
- **Esperado:** genera el informe, abre el visor HTML, suma 1 uso.
- **Restaurar:** snippet B (N=0).
- **Resultado (2026-06-20):** informe corrió headless (~30 s), PDF abierto automáticamente en Chrome (4 páginas, FCR 018745/2017). DB: `informe_usage` +1 confirmado. El PJN estaba operativo al ejecutar.

### TC-D3 · MONITOR — consulta inicial + buscar novedades ✅ 2026-06-20
- **Quién:** computer-use (app, full)
- **Pasos:** Monitor → **+ Agregar parte** (una parte real) → **Consulta Inicial** (crea línea base) → luego **Buscar Novedades**.
- **Esperado:** consulta inicial NO consume `monitor_novedades_usage`; cada "Buscar Novedades" suma +1 (encuentre o no).
- **Restaurar:** snippet D + snippet B (N=0).
- **Resultado (2026-06-20):** parte QUISPE (FCR) agregada. Consulta Inicial: 290 expedientes, 20 páginas (~7 min). `usage_count` +1 pero `monitor_novedades_usage` = 0 (confirma que consulta inicial NO consume). Buscar Novedades: 0 novedades encontradas (correcto: base recién creada). `monitor_novedades_usage` = 1 confirmado en DB.

### TC-D4 · EXTENSIÓN — los 5 flujos cargan el expediente 🔲 (cubierto por smoke tests)
- **Quién:** humano / claude-in-chrome
- **Flujos:** Consulta SCW · Escritos 1 (scw) · Escritos 2 (escritos.pjn) · Notificaciones (notif.pjn) · DEOX (deox.pjn).
- **Esperado:** la extensión rellena jurisdicción + número + año en cada portal.
- **Estado:** ✅ por **smoke tests** (48/48, último 2026-05-27). 🔲 manual no re-corrido.
- **Restaurar:** —

### TC-D5 · Trial compartido app ↔ extensión 🔲
- **Setup:** trial N=18 (snippet B).
- **Esperado:** la app muestra 18/20; usar 1 en la app → 19/20; la **extensión** ve el mismo cupo (queda 1).
- **Restaurar:** snippet B (N=0).

### TC-D6 · Agotar 20/20 → bloqueo app + extensión + mensajes ✅
- **Estado:** ✅ validado.
  - App 1–5 restantes: banner 🔴 *"Quedan pocos usos. Contactá al administrador para activar tu cuenta."*
  - App 20/20: 🔴 *"Ya consumiste tus usos…"* + al ejecutar *"Has alcanzado el límite…"* (sesión NO se cae).
  - Extensión 20/20 (`extension-auth` 403): *"Agotaste tus 20 usos de prueba. Configurá tu método de pago desde el portal para seguir usando la extensión."* `action:subscribe` — **validado 2026-06-20**.
- **Restaurar:** snippet A.

### TC-D7 · Cortesía del admin (+N usos) 🔲
- **Quién:** humano (dashboard) + Claude (DB)
- **Pasos:** admin asigna +N usos de cortesía a la cuenta en trial.
- **Esperado:** `usage_limit` += N; "(+N de cortesía)" visible en portal (banner + Mi Plan), ficha admin y app; la **activación posterior conserva** la cortesía.
- **Restaurar:** snippet B (N=0).

---

# BLOQUE E — Activación y pago (medio del embudo)

### TC-E1 · Admin activa la cuenta 🔲
- **Quién:** humano (dashboard) + Claude (DB)
- **Setup:** usuario en trial (snippet B).
- **Pasos:** dashboard → ficha del usuario → **Activar**.
- **Esperado:** `registration_status='active'`, `status='active'`; **conserva** los usos restantes del trial (no resetea); el botón **"Configurar método de pago"** se habilita en el portal (en trial estaba deshabilitado).
- **Verif:** intentar `/checkout/init` en `pending_activation` → **403** (guard); en `active` → permite.
- **Restaurar:** snippet A.

### TC-E2 · Checkout real de MercadoPago 🔲 (✅ en sesiones previas, no re-corrido)
- **Quién:** humano (cuenta compradora MP logueada en Chrome) + Claude (webhook/DB)
- **Pasos:** portal → "Configurar método de pago" → init_point MP → pagar con la tarjeta `APRO`.
- **Esperado:** webhook real llega (HMAC válido, 200); `applyTrialBonus`: `usage_limit=999999`, todos los contadores a 0, límites por submódulo del plan, **factura pendiente** creada, `next_billing_date` +1 mes.
- **Estado:** ✅ validado E2E con pago sandbox real (CLAUDE.md 2026-06-12 / 2026-06-17).
- **Restaurar:** snippet A.

### TC-E3 · Guard "confirm sin pago" 🔲 (✅ backend en prod)
- **Esperado:** volver del checkout **sin pagar** (back/cerrar) → `markPaymentConfigured` verifica contra MP que exista un preapproval `authorized` atribuible; si no → `configured:false`, **no marca** `payment_provider`, portal muestra banner neutro.
- **Estado:** ✅ validado en staging (CLAUDE.md 2026-06-12).

---

# BLOQUE F — Uso diario pago: límites por submódulo (MAYORMENTE VALIDADO)

> Estado base: snippet A. Tras cada caso, restaurar con snippet A.

| TC | Caso | Esperado (verbatim) | Estado |
|---|---|---|---|
| **F1** | Agotar **proc** (50), resto disponible | Procurar bloquea en pre-check (antes de abrir Chrome): *"Alcanzaste el límite de procuraciones de tu plan (COMBO_PROMO): 50/50 usados en este período. El acceso a la app sigue disponible; los usos se renuevan al inicio del próximo período o podés pedir un ajuste a soporte."* Informe/Monitor/Batch siguen funcionando | ✅ 2026-06-20 |
| **F2** | **Todos** los módulos al límite | Cada módulo bloquea independiente con su mensaje; banner rojo global *"Agotaste tus ejecuciones de Procurar para este período. Contactá soporte o actualizá tu plan."* + "Ver mi plan"; **la app nunca se bloquea globalmente** ("El acceso a la app sigue disponible"). Informe: *"Informe falló: Alcanzaste el límite de informes…"* · Monitor: *"Alcanzaste el límite de consultas de monitoreo de tu plan: 50/50…"* | ✅ 2026-06-20 |
| **F3** | **Admin bonus** `proc_bonus=10` | Límite efectivo 60; Mi Cuenta "0/60 (+10 extra)"; banner rojo→ámbar; ejecuta dentro del bonus | ✅ 2026-06-20 |
| **F4** | **Renovación mensual** (`sim-renewal.js 214 233 COMBO_PROMO 15000`) | Contadores a 0, `proc_bonus` conservado, `next_billing_date` +1 mes, pago + factura nuevos | ✅ 2026-06-20 |

> `sim-renewal` se corre en el server: `cd /var/www/procurador/backend-server && node dev-tools/sim-renewal.js 214 233 COMBO_PROMO 15000`.

---

# BLOQUE G — Suscripción: cancelar / reactivar / cambio de plan (VALIDADO)

> Detalle completo en `plan-pruebas-ciclo-vida.md` (PLAN 3, cerrado).

| TC | Caso | Estado |
|---|---|---|
| **G1** | Fila A: cancelar portal (pausa) → reactivar portal (reanuda, sin cobro) | ✅ |
| **G2** | Fila B: cancelar portal → reactivar desde MP | ✅ |
| **G3** | Fila C: cancelar MP (terminal) → reactivar portal (checkout free_trial, sin doble cobro) | ✅ |
| **G4** | Fila E: no reactivar → cron pasa a `cancelled`, corta acceso | ✅ |
| **G5** | **Upgrade** EXTENSION→COMBO (inmediato): Chrome lanza, ejecución arranca, acceso restaurado | ✅ 2026-06-20 |
| **G6** | **Downgrade** COMBO→EXTENSION: programado (scheduled_plan, Mi Cuenta sigue COMBO) + efectivo (ERR: *"Tu plan (EXTENSION_PROMO) solo incluye la extensión Chrome y no permite ejecuciones en la aplicación de escritorio…"*) | ✅ 2026-06-20 |
| **G7** | Pago rechazado → gracia 3d (banner ámbar + notificación) → suspensión → recuperación | ✅ (CLAUDE.md 2026-06-17) |
| **G8** | `monitor_partes` 21° → *"Límite de 20 partes alcanzado para el plan COMBO_PROMO. Actualizá tu plan para agregar más."* | ✅ 2026-06-20 |
| **G9** | Idempotencia de webhooks: 2ª llamada → *"Evento duplicado ignorado"*, 0 registros extra | ✅ 2026-06-20 |
| **G10** | Fila D: re-suscribir desde MP | ⏸ No es flujo real (se colapsa en C) |
| **G11** | Cambio entre 3+ planes (downgrade→upgrade, 2/ciclo, cancelar downgrade) | ⏸ Requiere BASIC/PRO/ENTERPRISE activos (L1) |

---

# BLOQUE H — Transversales (funcionan en paralelo · NO ejercitados)

### TC-H1 · Notificaciones in-app 🔲
- **Quién:** computer-use (app) + humano (admin dispara una)
- **Pasos:** admin genera notificación (activación, ajuste, etc.) → en la app aparece badge → abrir → marcar como leída.
- **Esperado:** `GET /client/notifications` lista; `POST /client/notifications/:id/read` (o `all`) baja el badge.
- **Restaurar:** —

### TC-H2 · Soporte: ticket + asistente IA + respuesta admin→email 🔲
- **Quién:** computer-use (app) + humano (admin) + Claude (verifica email)
- **Pasos:** (a) abrir el chat widget IA en la app → preguntar → respuesta (Claude Haiku). (b) crear ticket desde la app/portal. (c) admin responde el ticket. (d) verificar email al usuario.
- **Esperado:** IA responde; ticket visible en admin con `#ID`; al responder el admin → email "Procurador SCW — Respuesta a tu ticket #X" con botón al portal; el badge `#ID` consistente.
- **Restaurar:** cerrar/borrar ticket de prueba.

### TC-H3 · Recuperación de contraseña 🔲
- **Quién:** humano + Claude
- **Pasos:** portal login → "Olvidé mi contraseña" → ingresar email → abrir mail → link reset → nueva contraseña (cumple política).
- **Esperado:** email llega; reset aplica; login con la nueva clave OK; la vieja deja de servir.
- **Restaurar:** volver a la contraseña de prueba conocida.

### TC-H4 · Cambio de email por admin (re-verificación) 🔲
- **Quién:** humano (admin) + Claude (DB)
- **Pasos:** dashboard → ficha → "✉️ Editar email" → nuevo email.
- **Esperado:** `POST /admin/users/:id/change-email` cambia el email, **suspende** (`pending_email`), guarda estado previo en `email_change_prev_status`, envía verificación al **nuevo** correo + notificación + evento. Al verificar → la cuenta **vuelve sola** al estado previo. Guards: email vacío/igual/tomado → error.
- **Restaurar:** volver el email a `procuradortool@gmail.com` + `registration_status='active'`.

### TC-H5 · Machine binding (lock de dispositivo) 🔲
- **Esperado:** login desde un `machineId` distinto al registrado → comportamiento del lock de dispositivo (verificar política actual).
- **Restaurar:** —

### TC-H6 · Lock de ejecución multi-dispositivo 🔲
- **Esperado:** correr una ejecución y, en paralelo, intentar otra desde una 2ª instancia/dispositivo → la 2ª se bloquea (`/license/execution/start` no concede el lock).
- **Restaurar:** `POST /license/execution/end` o esperar el timeout del heartbeat.

### TC-H7 · Sesión: expiración + refresh + auto-recuperación ✅ 2026-06-20
- **Esperado:** al expirar el token, el heartbeat refresca solo; un 403 temporal no deja "No autenticado" trabado (auto-recuperación de `authManager.js`). Trial 20/20 → `verify-session`/`refresh` siguen 200 (capa de sesión, no de cuota).
- **Restaurar:** —
- **Resultado (2026-06-20):** la sesión de la app Electron **expira cada vez que Chrome toma el foco** (comportamiento observado en D2, D3 y F1-F3: al volver a la app se muestra la pantalla de login). Re-login: pantalla de login con email precargado + contraseña precargada → click "Iniciar Sesión →" → sesión restaurada en ~4 s. La app **no queda trabada** (no muestra "No autenticado") — el heartbeat logra un re-login limpio. Workaround operativo documentado en §1bis.

### TC-H8 · Facturación manual (admin sube PDF) 🔲
- **Quién:** humano (admin) + Claude (verifica portal)
- **Pasos:** dashboard → Facturación → Pendientes → subir PDF (tipo C, número, CAE opcional).
- **Esperado:** la factura aparece **al instante** en el portal del usuario (Facturación).
- **Restaurar:** borrar la factura de prueba.

---

## 2. Orden de ejecución recomendado (por valor para el usuario nuevo)

1. **Bloque D1–D3** (primeras ejecuciones exitosas) — *la prueba reina; si esto falla, nada importa.*
2. **Bloque A + B + C** (registro → verificación → descarga → onboarding) — *primera impresión.*
3. **Bloque E** (activación + pago visto por el usuario).
4. **Bloque H** (transversales: notif, soporte, reset pass).
5. **Bloques F/G** — ya validados; solo re-correr si hay cambios de código.

## 3. Estado consolidado

| Bloque | Validado | Pendiente |
|---|---|---|
| A — Registro/verificación | — | A1, A2, A3, A4 |
| B — Descarga/instalación | — | B1, B2, B3 |
| C — Onboarding | C4 | C1, C2, C3 |
| D — Trial/primeras ejecuciones | **D1**, D2, D3, D4 (smoke), D6 | D5, D7 |
| E — Activación/pago | E2, E3 (prev.) | E1 |
| F — Límites pagos | F1, F2, F3, F4 | — |
| G — Suscripción | G1–G9 | G10/G11 (L1) |
| H — Transversales | H7 | H1–H6, H8 |

> **Foco inmediato:** onboarding (C) + registro/verificación (A) + TC-D5 (trial compartido app↔extensión).
> **Último testeo:** 2026-06-20 (sesión completa; **D1 validado** — prueba reina completada; D2, D3, C4, H7 nuevos; F1–F4 + G1–G9 reconfirmados).
