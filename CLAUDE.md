# CLAUDE.md — Procurador SCW

> Guía maestra del proyecto para sesiones de trabajo con Claude.
> Última actualización: 2026-07-05

---

## ⚠️ Directorio de trabajo — LEER PRIMERO

**Trabajá siempre sobre el repo principal:**
```
C:\Users\JONATHAN\source\repos\ProcuradorTool
```

A veces el contexto de la sesión te ubica en un **worktree vinculado** dentro de
`C:\Users\JONATHAN\source\repos\ProcuradorTool\.claude\worktrees\<nombre>\`.
Ese worktree es un checkout aparte (su `.git` es un archivo, no una carpeta) y **no es
la rama `main` que se pushea a producción**. Editar archivos ahí (ej. `CLAUDE.md`,
`docs/`) deja los cambios huérfanos: no llegan al commit que esperás.

**Reglas:**
- Para editar/commitear, usá rutas absolutas al repo principal (la de arriba), **no** la del worktree.
- Antes de commitear, verificá con `git -C "C:\Users\JONATHAN\source\repos\ProcuradorTool" status` que los cambios estén en el repo correcto.
- **Nunca uses `git add -A` / `git add .`** desde la raíz: arrastra el worktree embebido (aparece como submódulo `mode 160000`), configs de `.claude/` y screenshots de `tests/`. Agregá los archivos **explícitamente por nombre**.

---

## 🔄 Estado actual
> Versión app Electron: **2.7.36** — publicada en GitHub Releases (auto-updater activo)
> Versión extensión Chrome: **1.3.5** — subida al Chrome Web Store, ⏳ pendiente de aprobación de Google (en store activa: 1.3.4)
> Sesión 2026-07-06 (cont.) — **📔 Propuesta módulo Bitácora → v6 / v6.1.** Correcciones de diseño tras repaso: (1) se **desacopla** "guardar ficha básica del caso" de "guardar snapshot de procuración/informe" — ahora son 2 botones independientes en visores (📌 Guardar caso / 💾 Guardar procuración) en vez de uno combinado; (2) se **reemplaza el transporte** de GET-por-querystring a **POST por formulario oculto autoenviado** (misma pestaña con nombre fijo, sin CORS por ser navegación y no fetch) — elimina el límite de ~2.000 caracteres y la restricción de "hasta 10 casos" en captura por lote; (3) el botón "📔 Bitácora" en la app Electron se **muda del sidebar al topbar** (confirmado en `index.html`: la misma barra que trae los tabs Procurar/Informe/Monitor/Descargas y los controles de ventana incl. cerrar) — una sola aparición, no duplicado; (4) se agrega al plan el **paso faltante del tour de onboarding** (`onboarding/tour.js`) que explique el botón nuevo, reusando el patrón de spotlight multi-elemento ya usado hoy para agrupar "Ver tour + Asistente IA" en una sola card. **v6.1:** evaluación técnica del transporte POST (§4.1.1) con números reales medidos — cadena de límites (Nginx 1MB / Express 100KB por defecto, ambos config nuestra → subir a 5MB), tamaños reales (1 expediente ≈4,2KB, tope `maxMovimientos`=15, corrida de 3 ≈19KB), tabla de escenarios (individual ✅/lote/corrida grande ~400KB → requiere subir límite), inflación por URL-encoding y patrón **Post/Redirect/Get** para recepción con URL limpia. Conclusión: tras subir el body limit no hay límite práctico para datos reales. Documento actualizado, PDF regenerado (23 págs).
> Sesión 2026-07-05 — **📔 Propuesta de mejora: módulo Bitácora (v5, lista para evaluar/implementar).** v5 agrega: autosuficiencia del doc (no requiere el manual Lex-Doctor), riesgo/complejidad sin tecnicismos, costos con números reales del server (USD 0/mes infra), alcance 2+2 POR CASO precisado, regla de recorte del querystring, historial con selector última/anteúltima + modal, botones 💾 Guardar procuración/informe en visores, filtros/agrupación en vista global, campos por tipo de entrada (jurídicos), edición global+por caso con acciones masivas, y sección de 12 preguntas abiertas (Q1–Q12) con defaults para responder. Sesión de diseño de producto (sin código): a partir de un brainstorm sobre el manual de Lex-Doctor 11 se elaboró la propuesta completa del módulo **Bitácora** — agenda/vencimientos/tareas/gestiones/notas estilo Google Calendar+Tasks, con **expedientes seguidos** (ficha liviana por caso creada automática desde los visores o manual, historial acotado a **hasta 2 procuraciones + hasta 2 informes** por caso), captura desde los 4 visores por **deep-link** (individual `📔+` y **selección múltiple** en la tabla, link 📁 a ficha de casos ya seguidos, pestaña única `target="procurador_portal"` + Volver por History API), **mini-visor nuevo para informe individual** (hoy no genera visor; se genera desde `main.js` sin tocar scripts encriptados), avisos **solo in-app** (banner al entrar: vencidos sin confirmar hasta 7 días atrás + próximos 7 días, con check de realización), píldora "Establecer como principal" (Mi Plan ↔ Bitácora, excluyentes), **gating por plan** (`plans.bitacora_enabled`), personalización de la ficha (orden de secciones, registros visibles, modal "ver todos"), y **export/backup del usuario** (Excel legible + JSON restaurable) con **importación** (modos reemplazar/combinar + vista previa dry-run + respaldo automático previo). Google/emails descartados por ahora. Plan en 2 fases: F1 backend+portal (sin release Electron), F2 visores (release app). **📄 Documento completo: `docs/internal/propuesta-bitacora-agenda-2026-07.md` (+ PDF junto al .md). Para retomar: leer ese doc y pedir "continuar con la implementación de la Bitácora" (arrancar por Fase 1).** Estado: propuesta, NO aprobada, NO en desarrollo.
> Sesión 2026-07-04 (noche) — **🔧 Hallazgo #3 corregido y release v2.7.36 publicado.** Cierre del último hallazgo pendiente del plan de pruebas integral. **Causa raíz confirmada empíricamente** (creando un usuario temporal y comparando los dos estados posibles): `checkSubsystemLimit()` en `electron-app/main.js` tenía un gate `if (!acc.account?.paymentProvider) return { blocked: false }` que **omitía el chequeo de límite por submódulo para cualquier cuenta sin método de pago configurado**. Una cuenta con el submódulo agotado pero `payment_provider=NULL` y el cupo global inflado (ej. cortesía/comp con `usage_limit=999999`) no era frenada por el pre-check ni por el chequeo global → la app abría Chrome y corría la automatización real contra el PJN igual; el servidor (`log-execution`, que sí enforza por submódulo sin mirar `payment_provider`) rechazaba el conteo después, en silencio. **Fix:** se quitó el gate por `payment_provider` para que el pre-check espeje el enforcement del servidor (bloquea antes de abrir Chrome sin importar el método de pago); el trial normal y las cuentas ilimitadas no se ven afectados. Commit `68a431b`. **Release:** siguiendo el checklist del proyecto — probado sin instalar (`npm start`, arranque limpio) → bump `2.7.35→2.7.36` (`a749026`) → tag `electron-v2.7.36` → `npm run release` (token de GitHub recuperado de Windows Credential Manager vía PowerShell/CredRead, sin exponerlo) → publicado en GitHub Releases → versión visible actualizada en el portal (`3d41ae5`, deployado + `pm2 restart`). **Estado final de los 4 hallazgos del plan de pruebas: los 4 corregidos y publicados** (#1 y #4 en backend desde la sesión anterior, #2 backend, #3 Electron esta sesión). **Limpieza:** usuario temporal de verificación (id 248) borrado, prod queda con solo los 2 admins. Backup `.7z` post-fix en automatización (`202607_04072026_ProcuradorTool_v2.7.36-hallazgo3.7z`, distinto del backup del cierre de pruebas de más temprano en el día para no pisarlo).
> Sesión 2026-07-03/04 — **🧪 Plan de pruebas integral ejecutado casi al 100% + 4 hallazgos, 3 corregidos y en prod.** Corrida extensa (múltiples continuaciones a lo largo de 2 días) del `docs/internal/plan-pruebas-integral-2026-07.md`: cubre administración (usuarios, planes, suscripciones, cobranza, tickets, seguridad), ciclo de vida completo del usuario (registro→trial→activación→pago→cambios de plan→cancelación/reactivación→vigencia→pago rechazado), extensión Chrome, y la **app Electron contra el PJN real** (procuración individual/batch, informe individual/batch, monitor de partes — con CUIT y expedientes reales). **Hito:** se completaron **3 checkouts reales en MercadoPago sandbox** (no simulados), validando contra la API real de MP todo el ciclo de upgrade/downgrade/cancelar/reactivar/single-active/idempotencia de webhooks. Bloques cerrados 100%: A2, A4, A5, U1, U2, U3, U10, U13; el resto con cobertura muy alta. Único pendiente real: **U9.3** (pagar una reactivación), bloqueado por una causa aún no identificada en el flujo de reactivación (no es el mismo bug ya corregido). **4 hallazgos, 3 ya corregidos y deployados (commits `bf264a5`, `72a8159`):** (1) verificación de email reusada mostraba error genérico en vez de "ya verificado" — se dejó de nulificar `email_verify_token` al verificar; (2) **el más serio** — `createUpdatePreapproval()`/`createReactivationPreapproval()` (`services/subscriptionService.js`) armaban un `reason` de 62-66 caracteres para MercadoPago, que **rechaza el preapproval** por exceder su límite de 40 — MP devolvía el error crudo y el frontend lo mostraba con un `alert()` nativo que colgaba la página; afectaba a cualquier usuario real cambiando de método de pago o reactivando una suscripción vencida; fix: usar solo el nombre base del plan (28-32 chars) + helper `capReason()` defensivo; (4) activación por cortesía (plan $0 al verificar email) funcionaba bien en los datos pero mostraba el texto genérico de trial ("20 usos de prueba") en vez de reflejar el acceso de cortesía ya activo — se agregó una rama de mensaje específica en los 3 puntos (página, notificación, re-click). **Pendiente de corrección:** hallazgo (3) medio-alto — en la app Electron, el pre-check de límite por submódulo (`checkSubsystemLimit` en `main.js`) no bloquea la ejecución cuando el usuario ya agotó su cupo: abre Chrome y corre la automatización real contra el PJN igual, sin avisar (el servidor sí protege los datos, no cuenta el uso, pero la UX queda confusa) — confirmado con la app real, requiere investigación de por qué el check no frena pese a que el código fuente parece correcto. **Cierre:** DB de prod reseteada (solo quedan los 2 admins), 3 preapprovals residuales del sandbox cancelados, `dev-tools/reset-test-data.sql` actualizado con los IDs reales. Ver el plan completo para el detalle caso por caso.
> Sesión 2026-07-02 (noche) — **🧹 Reset de datos de prueba (prod) + limpieza MP sandbox.** Se resetearon los usuarios de producción para dejar el entorno limpio de cara a nuevas pruebas: **backup previo** (`/tmp/backup_prod_pre_userdelete_20260702_103507.sql`) → se **canceló el preapproval de MP** del usuario 237 (`ed0f8814...`, de las pruebas T11-T13) antes de borrarlo, para no dejarlo huérfano → se actualizó `backend-server/dev-tools/reset-test-data.sql` (estaba con IDs de una sesión vieja de mayo/junio que ya no existían; ahora apunta a los reales) agregando el wipe de `commercial_benefits` (tabla nueva no cubierta antes) → se ejecutó contra prod: **quedan solo los 2 admins** (id 6 `admin@procurador.com`, id 7 `admin@tudominio.com`), con sus suscripciones reseteadas limpias (ENTERPRISE, active, 0/999999, sin `payment_provider`/cancelaciones) y **todo lo transaccional en 0** (pagos, facturas, tickets, logs, notificaciones, webhooks, beneficios). **Limpieza adicional en MercadoPago sandbox:** se encontraron y cancelaron **2 preapprovals residuales** vivos en la cuenta vendedor, huérfanos de sesiones de prueba viejas (14/06 `user_215` ya no existente, y 24/06) — la cuenta comprador de prueba (`TESTUSER431...`) no tiene forma de "resetearse" (son credenciales fijas que provisiona MP), pero se dejó **0 preapprovals vivos** (authorized/pending) en el panel del vendedor. Commit `f5c2ecb`.
> Sesión 2026-07-02 (tarde) — **📚 Documentación actualizada + bot de ayuda pulido (en prod).** **Docs (commits `220b988`/`fc987ae`):** nueva `docs/internal/guia-planes-vigencia-cortesia.md` (comportamiento vigencia por fecha + público/privado + cortesía $0 en los 3 escenarios) · nuevo `docs/internal/manual-administrador.md` (operación del dashboard paso a paso + recetas rápidas) · `proximos-pasos.md` refrescado al estado real julio (Fase 5 histórica, orden sugerido nuevo) · `sistema-estados-flujos.md` actualizado (tabla planes ARS+visibilidad, tabla de crons corregida, nueva sección 9 con flujos de gestión de planes admin) · `manual-de-usuario.md` +2 secciones (cuenta creada por admin, plan vencido→reactivar). **Bot de ayuda (commit `cf004b6`, en prod):** system prompt UNIFICADO en `utils/aiSupportPrompt.js` (antes duplicado en client.js y usuarios.js → drift); enriquecido con conocimiento real user-facing (resolución paso a paso: login PJN/contraseña, about:blank, "proceso activo en otro dispositivo", trial agotado, límites, plan vencido, monitor, updates) + URL real del portal; **REGLA DE ORO reforzada** (nunca divulgar arquitectura/endpoints/DB/infra/cobro/operaciones admin/precios no públicos/datos de otros; declina + ofrece ticket); `max_tokens` 300/400→500. Validado E2E en staging (modelo real) y prod (endpoint real): resuelve con pasos concretos, declina info interna, deriva cuenta a ticket. Manual inline del portal (`getManualHTML`) sincronizado con las 2 secciones nuevas. **Pendiente del bot:** nada; próximo del proyecto: B3 (MP a prod real).
> Sesión 2026-07-02 — **✅ VALIDACIÓN E2E COMPLETA T1–T13 (incluye MP sandbox real) + 2 fixes.** Todas las features de las sesiones 06-30/07-01 quedaron probadas de punta a punta: **T1–T7** (staging/prod por API): gating público/privado, blindaje anti-autoasignación, drop de constraint, activación por cortesía al verificar email, caso negativo precio-null, compatibilidad cron-downgrade, smoke prod. **T8–T10** (dashboard prod vía Chrome): alta de usuario real → email a Hotmail con credenciales → verificación → activación automática con cortesía 7 días (usuario `jberger_86@hotmail.com` id 237); select visibilidad persiste; cancelar fin de ciclo (banner+eventos) y guard de deshacer sin preapproval. **T11–T13 (MP sandbox REAL, comprador TESTUSER431...):** checkout completo por el portal-init → preapproval `ed0f8814...` vinculado (claim por ventana, pago $450 prorrateado registrado) → **T11** upgrade admin EXTENSION→COMBO: `transaction_amount` del preapproval real **1500→15000** (authorized, sin cobro inmediato) → **T13** cancelar fin de ciclo: preapproval **paused** en MP + `cancel_at`; deshacer: **authorized** de nuevo + `cancel_at` limpio → **T12** cortesía $0 × 7 días sobre usuario pagando: aplica ya, `plan_expiry_date=2026-07-09`, preapproval **paused** (corta el cobro), evento `courtesy_plan_assigned_by_admin {was_paying:true}`. **Fixes de la sesión:** `6a9b94c` (cron downgrade con usuario sin pago violaba `check_usage_limit_positive` → conserva cupo con COALESCE; también en `/users/change-plan`) y `865061c` (POST /admin/plans ahora persiste precio/tipo — antes un plan cortesía creado con $0 quedaba precio null sin aviso; etiqueta [GRATIS] solo con precio explícito 0). **Estado vivo en prod:** plan `CORTESIA` ($0, privado, combo) listo para uso real; usuario 237 en cortesía hasta 09/07 con preapproval sandbox pausado → al vencer, el cron valida solo el último eslabón (suspensión + reactivación por portal). **Pendiente:** nada de estas features. 📄 **Guía de comportamiento** (vigencia de planes por fecha + público/privado + cortesía $0 en los 3 escenarios): `docs/internal/guia-planes-vigencia-cortesia.md`.
> Sesión 2026-07-01 — **✅ EN PRODUCCIÓN: Alta de usuarios por admin + Plan de cortesía con vigencia (pausa MP).** Commit `d814f9a`. **Alta de usuario por admin (`POST /admin/users`, botón "＋ Agregar usuario" en Usuarios):** suple el registro público — crea la cuenta con la contraseña que **fija el admin**, asigna plan, y envía email con credenciales + recomendación de cambiarla + enlace de verificación (`sendAdminCreatedUserEmail`). Queda `pending_email` hasta verificar; marca `users.admin_created` (migración additiva `20260701_admin_created_users.sql`). **Plan de cortesía (plan de precio EXPLÍCITO $0):** al asignarlo por admin (`POST /admin/subscriptions`) o al crear el usuario, aplica ya, fija `plan_expiry_date = hoy + días` (campo al lado del selector) y, si el usuario venía pagando, **PAUSA el preapproval en MP** (`pausePreapproval`) para cortar cobros sucesivos. Un usuario `admin_created` con plan $0 queda **ACTIVO al verificar el email** (`verify-email`); el resto sigue el flujo normal (`pending_activation`/trial). Al vencer, el cron de vigencia (`5 11`) lo pasa a `suspended_plan_expired` y el portal ofrece reactivar eligiendo plan público + pago (flujo Fase 2 ya existente). Un plan **sin precio (null: BASIC/PRO/ENTERPRISE) NO** se trata como cortesía. **Fix DB (crítico):** se **elimina la constraint `check_plan_valid`** de `subscriptions` (migración `20260701_drop_check_plan_valid.sql`), que restringía `subscriptions.plan` a una lista HARDCODEADA de 5 nombres y **bloqueaba asignar planes privados/cortesía con nombres nuevos**; la integridad la da `subscriptions.plan_id` (FK a `plans`). **Validado E2E en staging:** activación por cortesía al verificar email (→ `active`/`999999`, vigencia OK), gating público/privado, drop de la constraint. Deployado a prod (2 migraciones + 4 archivos: admin.js, auth.js, mailer.js, dashboard.js). ⚠️ Los endpoints admin (`POST /admin/users`, cortesía) **no se pudieron E2E por curl** (el token firmado a mano no valida contra el `JWT_SECRET` del proceso; el localhost directo tiene un artefacto de proxy) → **se ejercitan desde el dashboard** (probar: crear usuario con plan $0 → verificar email llega → link activa la cuenta; asignar plan $0 a un pago → pausa MP). Sin release de Electron. **Aprendizaje:** staging tenía drift (le faltaban columnas de migraciones viejas, ej. `email_change_prev_status`) — se parchó al vuelo; prod las tenía.
> Sesión 2026-06-30 (madrugada) — **✅ EN PRODUCCIÓN (deployado 2026-07-01):** planes públicos/privados + cambio de plan por admin con cobro MP + cancelar al fin de ciclo. Commits `44b4d36`/`3f8ac23`/`ab92ebf`. **Planes públicos/privados:** migración additiva `plans.visibility` (`public` default / `private`); filtro `visibility='public'` en los endpoints donde el usuario ELIGE plan (`/auth/plan-availability` registro, `/usuarios/api/plans` portal) + blindaje de los 3 puntos que validan plan por nombre (registro, `/users/change-plan`, checkout reactivación) para que un usuario no pueda auto-asignarse un privado; el admin ve todos + select Público/Privado en el form. El usuario con plan privado asignado **ve sus límites normal** (esos endpoints leen su suscripción, no la lista elegible). **Cambio de plan por admin (`POST /admin/subscriptions`):** upgrade → inmediato + `updatePreapprovalAmount` (monto nuevo desde el próximo cobro; MP no prorratea); downgrade → **programado a fin de ciclo** (`scheduled_plan`; el cron `25 11` lo aplica y baja el monto en MP) conservando los límites altos hasta entonces; trial/sin pago → intacto. `updatePreapprovalAmount` ahora lee `price_ars` de la tabla `plans` cuando el plan no está en el map hardcodeado (habilita cobrar planes privados). **Cancelar al fin de ciclo desde admin (reversible):** `POST /admin/subscriptions/:id/cancel` y `/reactivate-cancel` reusan `cancelSubscription`/`reactivateSubscription` (pausa/reanuda MP, sin cobro nuevo); botones en la ficha + nota de cobro; todo en el historial de la cuenta (eventos `*_by_admin`). **Validado en staging:** migración aplicada en `procurador_db_staging` (backup `/tmp/backup_staging_pre_visibility_*.sql`), 7 archivos deployados a `/var/www/procurador-staging`, `GET /auth/plan-availability` → 200, gating E2E (marcar BASIC privado → 5→4 planes visibles → revertido). **Deployado a prod el 2026-07-01** (migración `plans.visibility` + 7 archivos). **Pendiente (no bloqueante):** E2E con MP sandbox real (upgrade/downgrade/cancelar contra preapproval vivo) — no hay usuario MP de prueba en staging, se validará con un caso real. Sin release de Electron (solo backend/dashboard).
> Última sesión: 2026-06-30 (**Fix visor/excel — abrir el último por mtime (v2.7.35):** efecto colateral de la unificación de nombres (v2.7.33): `get-visor-path` ordenaba por **nombre** → `procurar-lote_visor_*` siempre ganaba a `procurar-individual_*` (alfabético `l`>`i`), sin importar el timestamp. Si corrías lote y después procuración individual, "Ver resultados"/auto-open abrían el visor **viejo del lote**. Fix: helper `latestFileBy()` ordena por **`fs.statSync().mtimeMs`** (fecha real), no por nombre — garantiza "el último generado". Aplica a `get-visor-path` (botón Ver resultados + auto-open de procuración) y `get-latest-excel` (botón Ver Excel). El informe batch ya abría su `rutaHTML` exacto. Commit `a88fc64`, tag `electron-v2.7.35` + `pre-visor-mtime-2026-06-30`. **Limpieza de notificaciones de proceso (v2.7.34):** el toast de Windows mostraba título `electron.app.Electron` y cuerpo `Ejecutando: <archivo>.js`. Ahora: título **"Procurador SCW"** (`app.setAppUserModelId('com.procurador.scw')` = build.appId → el instalador NSIS lo resuelve al nombre del acceso directo; se valida en la app **instalada**, no en `npm start`) + cuerpo con el **tipo de proceso** (Procurar · Procurar (por fecha) · Procurar Por Lote · Informe · Informe Por Lote · Monitor (consulta inicial) · Monitor (novedades) · Listado de expedientes). Cada handler pasa `processLabel` a `executeRemoteScriptAsLocal`; `notificationManager` tiene mapeo de respaldo script→etiqueta. **Anti-spam:** el informe batch disparaba 1 notificación por expediente (loop) → ahora 1 sola "Informe Por Lote" (`silentStart` en las individuales). Solo Electron, sin tocar scripts/servidor/DB. Commit `c95937b`, tag `electron-v2.7.34` + `pre-notif-cleanup-2026-06-30`. **Unificación de nombres de archivos por módulo (v2.7.33):** todos los archivos de descargas tienen ahora prefijo de módulo+submodo+ISO uniforme — resuelve 2 colisiones de nombres (`visor_generado.html` pisaba entre procurar individual y lote; `visor_monitoreo.html` entre inicial y novedades). Estructura plana en `descargas/`: `procurar-individual_<ISO>.{xlsx,json,html}`, `procurar-lote_visor_<ISO>.html`, `informe_<exp>_<ISO>.pdf`, `informe-lote_<ISO>.{xlsx,html}`, `monitor-{inicial,novedades}_visor_<ISO>.html`, `monitor-guardado-{expedientes,novedades}.html`. Bonus: `resumen_orquestador_*.json` se autoborra tras generar el batch. Backup `.7z` + tag `pre-nombres-modulos-2026-06-30`. Commit `d842835`. **D6 — carpeta de descargas por usuario (CUIT)** completado y en producción: `main.js` enruta por `getUserDataDir(cuit)` + inyecta `PROCURADOR_DATA_DIR` en los 5 flujos; los 6 scripts encriptados priorizan esa env var en `getDataPath()` (retrocompatible) — re-encriptados y redeployados. La prueba en vivo cazó que `informequickscwpjn.js` resolvía `__dirname`→raíz en el fork (backups a la carpeta compartida); fix con `PROCURADOR_DATA_DIR || __dirname`. Validado E2E con CUIT 27320694359 (procuración+informe+monitor → todo en `usuarios\<CUIT>\descargas`, raíz intacta). **Release v2.7.30**. **Fix carpeta raíz vacía (v2.7.31 + v2.7.32):** aparecía una `descargas\` vacía en la raíz tras cada ejecución. Dos causas: (1) **causa real (v2.7.32, commit `b10e9b7`):** `executeRemoteScriptAsLocal` (paso 10 "COPIAR") hacía `mkdirSync(userData/descargas)` **incondicional** tras cada script — los scripts ya escriben directo en la carpeta del usuario (`tempDir/descargas` nunca existe), así que solo quedaba el mkdir de la raíz; ahora solo copia si hay algo y al destino del usuario (`PROCURADOR_DATA_DIR`); (2) **defensa (v2.7.31, commit `74f8036`):** cache `_lastKnownCuit` para que un `verifySession` con blip no haga caer los handlers pasivos al fallback de la raíz. **Nota monitor:** el visor de novedades (`visor_novedades_guardado.html`) solo se genera si hay novedades pendientes sin confirmar; si no, el botón avisa "Sin novedades" — no es bug del cambio de carpetas. Backup `.7z` + tag `pre-descargas-usuario-2026-06-29`. **Antes (06-29):** editar respuestas de admin en tickets desde el dashboard (✏️, `PUT /admin/tickets/:id/comment/:cid`, col `edited_at`) + banner de cuota excluye `monitor_partes` (release v2.7.29).)
> Sesión 2026-06-27 (**Fase 2 COMPLETA** de vigencia de planes por fecha: núcleo (retiro respeta período + **pausa MP**, fin de período → `suspended_plan_expired` gracia 7d, commit `30c59d6`) + **Change 3 reactivación real** (paga por checkout de MP, commit `9939474`); dormido en prod hasta setear `plan_expiry_date`. **Fix D1** GRANT a `procurador_user`. UX: **editar registros manuales** de Pagos/Facturas (✏️), **banner de cancelación programada** en Mi Plan, **bloqueo de cambio de plan** si hay cancelación pendiente. **Limpieza:** usuario de prueba `procuradortool@gmail.com` eliminado, quedan solo los 2 admins.)
> Sesión 2026-06-26: fix `invoices.payment_id` UNIQUE (`ON CONFLICT` al subir factura), botón "Crear factura" desde Pagos, **Fase 1** de vigencia de planes (botón vencimiento en panel, herencia en altas, `cancelled` retornable). Spec: `docs/internal/spec-vigencia-planes-fecha.md`.
> Sesión previa 2026-06-25: dashboard reorden + menú colapsable, sección Pagos, asociación pago↔factura, RESUELTO, barra Monitor Partes, cancelación en historial, link al portal en login Electron — release **v2.7.28**.

### Últimas funcionalidades implementadas (listas en producción)

- ✅ **Sesión 2026-06-30 (noche) — Fix abrir visor/excel: el último generado por mtime (v2.7.35):**
  - **Bug (regresión de v2.7.33):** al unificar nombres, `get-visor-path` filtraba `procurar-*visor*.html` y ordenaba con `.sort().reverse()` (por **nombre**). Como el nombre incluye el submodo antes del timestamp, `procurar-lote_visor_<ISO>` siempre ordenaba **después** de `procurar-individual_visor_<ISO>` (alfabético: `l` > `i`) → tras el `.reverse()`, el visor de **lote** ganaba aunque fuera más viejo. Síntoma: corrés un lote a las 12:00, después procuración individual a las 13:00, y "Ver resultados"/auto-open abren el visor de las **12:00** (no el de la corrida actual).
  - **Fix:** helper `latestFileBy(descargas, filterFn)` en `main.js` que ordena los candidatos por **`fs.statSync(full).mtimeMs`** (fecha de modificación real), no por nombre → siempre devuelve el último generado. Reescritos `get-visor-path` (filtro `procurar-*visor*.html`) y `get-latest-excel` (filtro `procurar-individual_*.xlsx`) sobre ese helper.
  - **Cobertura:** botón **Ver resultados** (`viewResults`→`getVisorPath`), botón **Ver Excel** (`viewExcel`→`getLatestExcel`) y el **auto-open de procuración** (renderer `getVisorPath` tras `process-finished`). El **informe batch** ya abría su `rutaHTML` exacto (vía `informe-batch-complete`) → no afectado.
  - **Alcance:** solo `main.js`. Sin tocar scripts, servidor ni DB. Commit `a88fc64`, tag `electron-v2.7.35` + recupero `pre-visor-mtime-2026-06-30`.

- ✅ **Sesión 2026-06-30 (noche) — Limpieza de notificaciones de proceso (v2.7.34):**
  - **Problema:** el toast nativo de Windows al iniciar un proceso mostraba título `electron.app.Electron` (AUMID default de Electron, nunca seteado) y cuerpo `Ejecutando: informequickscwpjn.js` (nombre crudo del script).
  - **Fix título:** `app.setAppUserModelId('com.procurador.scw')` al tope de `main.js` (= `build.appId`). En la app **instalada**, el acceso directo NSIS lleva ese AUMID → Windows lo resuelve a **"Procurador SCW"**. ⚠️ En `npm start` puede seguir mostrando el default (no hay shortcut) → **validar en el release instalado**. Beneficia a TODAS las notificaciones (inicio/completado/error).
  - **Fix cuerpo:** muestra el **tipo de proceso**, no el archivo. El mismo script sirve varios procesos (`procesarNovedadesCompleto`=Procurar y por-fecha; `informequickscwpjn`=Informe ind y lote; `procesarMonitoreo`=Monitor inicial y novedades), así que cada handler pasa `processLabel` a `executeRemoteScriptAsLocal({ ..., processLabel })`. `notifyProcessStarted(label)` usa la etiqueta; `friendlyLabel()` tiene mapeo de respaldo `script→etiqueta` si falta. Etiquetas: **Procurar · Procurar (por fecha) · Procurar Por Lote · Informe · Informe Por Lote · Monitor (consulta inicial) · Monitor (novedades) · Listado de expedientes**.
  - **Anti-spam en lote:** `run-informe` batch llamaba `executeRemoteScriptAsLocal` **una vez por expediente** (loop) → N toasts "Proceso Iniciado". Ahora emite **una sola** `notifyProcessStarted('Informe Por Lote')` antes del loop + `silentStart: true` en las llamadas individuales (la opción salta la notificación en `executeRemoteScriptAsLocal`).
  - **Alcance:** solo Electron (`main.js`, `src/auth/authManager.js`, `src/notifications/notificationManager.js`). **Sin tocar scripts encriptados, servidor ni DB.** Commit `c95937b`, tag `electron-v2.7.34` + recupero `pre-notif-cleanup-2026-06-30`.

- ✅ **Sesión 2026-06-30 (tarde) — Unificación de nombres de archivos por módulo (v2.7.33):**
  - **Alternativa liviana (todo en `descargas/` plano, sin subcarpetas):** cada archivo lleva prefijo `módulo-submodo_<ISO>`. Resuelve 2 colisiones históricas (`visor_generado.html` era escrito por procurar individual Y lote → el segundo pisaba al primero; `visor_monitoreo.html` ídem entre inicial y novedades) y elimina la ambigüedad de `expediente_<exp>.pdf` (no decía si era de informe individual o lote). Timestamp unificado a `YYYY-MM-DDTHH-MM-SS` (T en todos). Esquema: `procurar-individual_<ISO>.{xlsx,json}` · `procurar-individual_visor_<ISO>.html` · `procurar-lote_visor_<ISO>.html` · `informe_<exp>_<ISO>.pdf` · `informe-lote_<ISO>.xlsx` · `informe-lote_visor_<ISO>.html` · `monitor-{inicial,novedades}_visor_<ISO>.html` · `monitor-guardado-{expedientes,novedades}.html`. La subcarpeta `procesos_automaticos/` desaparece (archivos directamente en `descargas/`). `ultimo_proceso.json` se conserva (lo lee la UI). Bonus: `resumen_orquestador_*.json` se autoborra tras generar el Excel+visor del batch. `get-visor-path` busca el más reciente `procurar-*visor*.html`; `get-latest-excel` busca `procurar-individual_*.xlsx` directamente en `descargas/`. `clean-folder 'procesos'` elimina archivos `procurar-individual_*` del plano. **3 scripts re-encriptados** (procesarNovedadesCompleto, procesarCustomExpedientes, testM2) + **5 archivos Electron** (main.js, renderer.js, generador_excel.js, generador_visor.js, package.json). Commit `d842835`. Backup `202606_30062026_ProcuradorTool.7z` + tag `pre-nombres-modulos-2026-06-30`. Análisis previo: `docs/internal/analisis-descargas-nombres.md`.

- ✅ **Sesión 2026-06-30 — D6: carpeta de descargas por usuario (CUIT) + editar respuestas de tickets + banner Monitor Partes** :
  - **D6 — descargas por usuario (CUIT) (release v2.7.30, commits `c4ec0ac` impl · `d2f8a3b` fix · `87c7112` release):** las descargas (Excel, visores, PDFs, temp) ahora se aíslan por CUIT bajo `%APPDATA%\procurador-electron\usuarios\<CUIT>\descargas\` (antes todas iban a una carpeta compartida → se mezclaban entre cuentas en una misma PC). **Contrato:** env var `PROCURADOR_DATA_DIR`. `main.js`: helpers `getUserDataDir(cuit)` / `resolveUserDescargasDir()` / `buildRunEnv(cuit)`; inyecta la env var en los 5 flujos (procuración, custom-date, custom-batch, informe ind+batch, monitor) y enruta los ~9 puntos lectores (abrir/limpiar/último Excel/visores). **6 scripts** (`consultarscwpjn`, `testM2`, `procesarNovedadesCompleto`, `procesarCustomExpedientes`, `procesarMonitoreo` con prioridad 0 en `getDataPath()`; `informequickscwpjn` con `DOWNLOADS_DIR = PROCURADOR_DATA_DIR || __dirname`) — re-encriptados y redeployados. **Retrocompatible:** sin la env var (apps viejas) → comportamiento idéntico al anterior. **Sin cambios de DB.** El perfil de Chrome (credenciales PJN) sigue compartido (fuera de alcance). Datos viejos en la raíz quedan como legado (no se migran). **Aprendizaje clave:** la prueba E2E en vivo (CUIT 27320694359) cazó que `informequickscwpjn.js` resolvía `__dirname`→raíz `userData` en el `fork` (no a la carpeta temporal como se asumía) → dejaba los backups `_temp/<exp>_backup/*.json` en la carpeta compartida; el fix con `PROCURADOR_DATA_DIR` lo corrigió. Plan: `docs/internal/plan-descargas-por-usuario.md`. Resguardo: `.7z` en automatización + tag `pre-descargas-usuario-2026-06-29`.
  - **Editar respuestas de admin en tickets (06-29, release backend/dashboard):** botón **✏️ Editar** en cada respuesta de admin del detalle del ticket → editor inline. Backend `PUT /admin/tickets/:ticketId/comment/:commentId` (solo `author_role='admin'`; no re-envía email ni cambia estado), `GET` del ticket expone `edited_at`, migración additiva `20260629_ticket_comments_edited_at.sql`. Label "· editado".
  - **Banner de cuota excluye `monitor_partes` (06-29, app v2.7.29):** `checkQuotaAlert()` en `renderer.js` ya no muestra el aviso rojo *"Agotaste tus ejecuciones de Monitor Partes…"* al llenar las partes (las partes son un *stock*, no ejecuciones por período). La barra de Mi Cuenta sigue mostrando X/20.

- ✅ **Sesión 2026-06-27 — Fase 2 (núcleo) vigencia de planes + fixes facturación/UX** :
  - **Fix `invoices.updated_at`** (migración `20260626b_invoices_updated_at.sql`, aplicada en prod): el endpoint `/upload` (y link/unlink) hacen `SET updated_at=NOW()` pero la columna no existía → *"column updated_at of relation invoices does not exist"* al subir el PDF a una factura con registro (`pending`). El camino `from-payment` no la usaba (por eso ese sí andaba). Additivo. (Junto con el `payment_id` UNIQUE de la sesión previa, cierra las columnas/restricciones que `invoices` tenía faltantes respecto del código.)
  - **Resaltado de fila persistente:** en la navegación cruzada pago↔factura, la fila destino ahora queda **pintada hasta que se hace clic en ella** (antes era un destello de 1.8s). Clase CSS `.row-hl` con `!important` (sobrevive al hover) + listener de clic que la limpia. Una sola fila resaltada a la vez.
  - **Fase 2 — NÚCLEO de vigencia de planes por fecha (commit `30c59d6`, validado E2E en staging, DORMIDO en prod):**
    - **cron 5c (retiro):** si `plan_expiry_date` pasó → **pausa el cobro en MP** (`subscriptionService.pausePreapproval`) y **respeta el período pago**: programa `cancel_at = fin de período`; si el período ya terminó, suspende ya con **gracia 7 días**. Antes cortaba el mismo día y **no tocaba MP** (el gap detectado).
    - **cron 5f:** bifurca por `plan_expiry_date` → retiro de plan termina en **`suspended_plan_expired`** (recuperable), la **cancelación voluntaria** sigue en **`cancelled`**.
    - **cron 5b:** aviso de discontinuación a **7 días** (antes 30).
    - **Validado E2E en staging** (crons forzados a cada minuto, usuario 215): (1) período terminado → suspende+gracia; (2) respeta período → programa `cancel_at`, sigue activo → fin de período → `suspended_plan_expired`; (3) regresión: cancel voluntaria → `cancelled`. Staging restaurado tras la prueba.
    - **Dormido en prod** hasta que un admin setee `plan_expiry_date` (ningún plan lo tiene).
  - **Fase 2 — Change 3 (reactivación real, commit `9939474`) → FASE 2 COMPLETA:** la reactivación de un `suspended_plan_expired` ya **no es gratis**. El vencido elige un plan activo en el portal → `initCheckout(plan)` → `/checkout/init` **alinea la suscripción al plan elegido** (`plan`/`plan_id`/`plan_expiry_date`, limpiando el del plan retirado para que el cron no re-dispare) y cobra por MP; el webhook reactiva (`registration_status='active'`, `applyRenewal`). `change-plan` ya **no** acepta `suspended_plan_expired` (`allowedStatuses=['active']`). Validada en staging la alineación de plan; la cadena pago→webhook→reactivación ya estaba validada E2E.
  - **Fix D1 — `GRANT` a `procurador_user`** (migración `20260627_grant_privileges_procurador_user.sql`, aplicada en prod): la secuencia `commercial_benefits_id_seq` (creada por `postgres`) no tenía grant → *"permission denied for sequence"* al **aplicar un beneficio comercial**. Fix comprensivo: grant en todas las tablas/secuencias + `ALTER DEFAULT PRIVILEGES` para futuras.
  - **Editar registros manuales (commit `7b7a33f`):** botón **✏️** en **Pagos** (solo pagos `payment_method='manual'`) y en **Facturación → Emitidas** (metadata: tipo/número/CAE/monto/fecha). Backend `PUT /admin/payments/:id` (rechaza no-manuales) + `PUT /admin/invoices/:id/meta`; `GET /admin/invoices` ahora expone `invoice_type`/`cae` para precargar. No toca el PDF ni la vinculación.
  - **Banner de cancelación programada en Mi Plan (commit `fbe306d`):** un activo que canceló y sigue con acceso hasta fin de período ahora ve el aviso en el **banner superior** (visible en Mi Plan, no solo en Facturación). Usa `acc.cancelAt` de `/client/account`.
  - **Bloqueo de cambio de plan con cancelación programada (commit `e076d9d`):** una cuenta con `cancel_at` pendiente ya **no puede** hacer downgrade/cambio de plan (era contradictorio). Backend `/users/change-plan` rechaza ("reactivá tu suscripción primero"); el portal avisa y oculta el selector de planes.
  - **Limpieza de datos:** usuario de prueba `procuradortool@gmail.com` **eliminado** (era id 235); quedan solo los 2 admins (id 6, 7). Borrado atómico de tablas hijas con FK `NO ACTION` (invoices, payments, ticket_comments, monitor_consultas_log, user_events, user_notifications, usage_extras) + el resto por CASCADE. Backup en server `/tmp/backup_pre_userdelete_*.sql`. ⚠️ El usuario de prueba ya no existe (el id 215/233/235 de sesiones previas quedó obsoleto).
  - **Resguardos:** `.7z` `202606_27062026_ProcuradorTool.7z` (+ `…_fase2.7z`, `…_fase3.7z` al cierre) + tag `pre-fase2-vigencia-2026-06-27`.

- ✅ **Sesión 2026-06-26 — fix facturación + Fase 1 vigencia de planes por fecha** :
  - **Fix `invoices.payment_id` UNIQUE** (migración `20260626_invoices_payment_id_unique.sql`, aplicada en prod): el endpoint `from-payment` usa `ON CONFLICT (payment_id)` pero la tabla solo tenía FK → al subir el PDF de un pago sin factura aparecía *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*. La restricción formaliza la invariante "1 factura por pago" (NULL permitido para facturas manuales). Como la subida fallaba, el pago quedaba en "Sin factura"; resuelto.
  - **Botón "📎 Crear factura" en Pagos:** en un pago sin factura ahora se puede **subir el PDF directo** desde la sección Pagos (`openInvoiceFromPayment` → `/admin/invoices/from-payment/:id`, queda vinculada al pago). Antes solo se podía "Asociar" una existente o ir a Facturación→Pendientes.
  - **Fase 1 — vigencia de planes por fecha (sin tocar el cobro de MP, commit `678c92b`):**
    - **Panel:** sección "Vencimiento real del plan" en el form de plan (`savePlanExpiry` → `PUT /admin/plans/:id/expiry`), separada del "Tipo de límite" (que es **solo aviso**), con advertencia roja: hoy suspende en la fecha exacta y **no cancela el débito de MP** → no usar en planes con cobro activo hasta la Fase 2.
    - **Registro:** las altas nuevas **heredan `plan_expiry_date`** del plan (`auth.js`; NULL si el plan no tiene).
    - **Portal — `cancelled` retornable:** `portal-login` ya no bloquea `cancelled` (solo `rejected`); el portal ya tenía el camino de re-suscripción (`isCancelledExpired` → "Nueva suscripción" → **checkout real** de MP). La reactivación-stub gratis **no** se usa para `cancelled`; la app/extensión siguen bloqueadas. Banner del portal actualizado para guiar.
  - **Spec de diseño completa:** `docs/internal/spec-vigencia-planes-fecha.md` — flujo de retiro de plan respetando el período pago, sincronización acceso↔cobro, ventana estricta de 7 días, estados (`suspended_plan_expired` recuperable vs `cancelled` retornable). **Fase 2 (crons + cancelación de MP + reactivación real)** queda pendiente para una sesión con **staging + backup + E2E**.
  - **Aclaración del modelo de vigencia** (documentada en la conversación): `plan_expiry_date` (suscripción) = corte real que suspende vía cron; `promo_type='date'`/`promo_end_date` (plan) = **solo alerta**; `period_days` de `plans` está **inerte** salvo en `/users/change-plan`. El cron de suspensión por fecha **no cancela MP** (gap que cubre la Fase 2).
  - **Sin release de Electron** (cambios de backend/dashboard/portal). App sigue en v2.7.28.

- ✅ **Sesión 2026-06-25 — mejoras dashboard admin + portal + Electron (release v2.7.28)** :
  - **Menú lateral del admin reordenado:** Resumen · Usuarios · Tickets · Facturación · **Pagos** · Planes · Monitor · Legal · Métricas · Diagnóstico · Scripts (`public/dashboard/index.html`).
  - **Menú lateral colapsable (hamburger):** botón ☰ en el topbar colapsa el sidebar a **solo íconos** (logo/labels/footer ocultos, íconos centrados, tooltips por sección). **Arranca colapsado por defecto** (si el usuario lo expande/colapsa, se respeta su preferencia en `localStorage` `admin_sidebar_collapsed`). CSS: clase `body.sidebar-collapsed` + `--sidebar-w-collapsed:64px`. JS: `toggleSidebar()`/`_applySidebarState()` en `dashboard.js`.
  - **Nueva sección Pagos** (`pagos-admin` en el nav, debajo de Facturación): listado global de `payments` con búsqueda (email/nombre/cuit) + filtro por estado; **alta manual** de pagos; **asociación pago↔factura** en ambos sentidos. Backend nuevo en `routes/admin.js`: `GET /admin/payments`, `POST /admin/payments/manual`, `POST /admin/payments/:id/link-invoice`, `POST /admin/invoices/:id/link-payment`, `POST /admin/invoices/:id/unlink-payment` (helper `linkInvoiceToPayment` respeta `invoices.payment_id` UNIQUE → 1 factura por pago).
  - **Links cruzados pago↔factura:** en Pagos la columna "Factura #N" es link → abre Facturación→Emitidas prefiltrada y resalta la fila; en Facturación→Emitidas se agregó columna **ID** (id de factura) y el "Pago #N" es link → abre Pagos prefiltrado y resalta la fila. Helpers `gotoInvoiceRecord`/`gotoPaymentRecord`/`_flashRow`.
  - **Factura con registro creado pero SIN PDF contemplada:** el webhook (`enqueueInvoice`) crea la factura `status='pending'` sin PDF ya vinculada al pago → vive en **Pendientes**, no en Emitidas. Fix: `GET /admin/payments` expone `invoice_pdf`/`invoice_status`; en Pagos la celda Factura distingue 🟢 emitida (→ Emitidas) de 🟡 "sin PDF" (→ Pendientes, `gotoPendingInvoice`, resalta la fila para subir el PDF); `GET /admin/invoices?include_no_pdf=1` y el selector "Asociar factura" lista también registros sin PDF (etiqueta "sin PDF").
  - **Selector visual de usuario (👤 Elegir):** en el alta manual de pago/factura (cuando el usuario no es fijo) un botón abre `openUserPicker` — modal (capa z-index 1200) con buscador + lista clickeable de usuarios registrados → evita errores de tipeo. `GET /admin/users/search` admite `q` vacío (lista todos, cap 500); `q` de 1 char sigue devolviendo vacío (autocomplete sin ruido). Callbacks `_payPickUser`/`_invoicePickUser`.
  - **Ficha de usuario reordenada:** Información+Suscripción → Datos de Registro → Tickets → Historial de la cuenta → Ajustes Manuales → Usos Extra → Beneficios → Historial de Pagos → Historial de Facturas → Partes en Monitoreo → Últimas ejecuciones. Botones **"＋ Agregar pago"** / **"＋ Agregar factura"** (modales dinámicos `openPaymentModal`/`openInvoiceModalDynamic`).
  - **Barra de progreso Monitor Partes** en la ficha: reusa `renderSubsystemBar('Monitor Partes', partes.length, monitor_partes_limit, bonus)` (antes era texto plano).
  - **Cancelación programada visible en el Historial de la cuenta:** `cancelSubscription`/`reactivateSubscription` (`services/subscriptionService.js`) ahora insertan `user_events` (`subscription_cancel_scheduled` / `subscription_cancel_reverted`); labels en `eventLabel`/`eventDetail` (muestra la fecha `cancel_at`). Antes no quedaba registro.
  - **Portal:** estado de ticket `resolved` muestra **"RESUELTO"** (faltaba en el map de `app.js`).
  - **Electron — link al portal en login bloqueado:** `/auth/login` ya devolvía `action` (portal/contact_admin/resubscribe/subscribe); `backendClient.login` ahora lo propaga y `renderer/login.js` muestra el link "Abrir el portal de usuarios →" (`showErrorHTML`) en estados bloqueantes (suspendida, rechazada, cancelada, trial agotado, sin suscripción); credenciales/device-bound/conexión siguen como mensaje plano. **Release v2.7.28** (tags `electron-v2.7.28` + GitHub `v2.7.28`), texto de versión actualizado en portal (`app.js`) y **landing** (4 refs).
  - **Sin migraciones de DB** (las tablas `payments`/`invoices`/`user_events` ya existían). Resguardos: `.7z` en `…/z-automatizacion/202606_25062026_ProcuradorTool.7z` (+ `…_mejorado.7z` al cierre) + tag de recupero `pre-mejoras-dashboard-2026-06-25`. Commits `53bc0ea` (8 cambios base), `78ef4f1` (colapsable + links), `20f9d8a` (landing v2.7.28), `9874033` (docs), `ad7c848` (colapsado por defecto), `b482a10` (factura sin PDF), `e18bcbf` (selector de usuario).

- ✅ **Sesión 2026-06-24 — herramientas de admin (beneficios/cortesía) + endurecimiento de estados** :
  - **Beneficios comerciales = tabla de eventos** (migración `20260624_commercial_benefits.sql`): antes el beneficio se guardaba en un único slot de `support_tickets` (1 por ticket, sin historial, no aplicable sin ticket). Ahora `commercial_benefits` (user_id, ticket_id nullable, type, value, applied_by, created_at) permite **N beneficios por usuario**, con o sin ticket. Backfill de los ya aplicados. **Ya NO auto-resuelve el ticket** al aplicar (decisión del usuario). Helper `applyBenefitToUser` compartido. Endpoints: `POST /admin/tickets/:id/apply-benefit`, `POST /admin/users/:id/apply-benefit` (sin ticket), `GET /admin/users/:id/benefits`. UI: card "Beneficios comerciales" en la ficha con botón "+ Aplicar beneficio" + historial; en el ticket el form queda siempre disponible (varios) + historial.
  - **Beneficio "Cambiar plan" removido del menú** (ticket y ficha): dejaba la cuenta en limbo (plan + `usage_limit=999999` pero `pending_activation`/sin pago → "X/999999 usos de prueba"). El cambio/comp de plan se hace con la herramienta propia de la ficha. **Guard de display en el portal:** cuando `usage_limit >= 100000` sin método de pago, NO se muestra "X/999999 usos de prueba" → "acceso asignado por el equipo" (banner, card de trial, Facturación). Tapa también el bug latente del cambio de plan del admin.
  - **Beneficio "Resetear uso" por target:** elige qué resetear (trial global / proc / batch / informe / monitor_novedades). **Beneficio "Cambiar plan"** (donde aplique) usa **planes vigentes** (`active=true`) desde la tabla `plans`, no los hardcodeados.
  - **Usos de cortesía ±N, permanentes (sin vencimiento):** se quitó el campo de fecha (era decorativo, no se enforzaba). Ahora la cantidad acepta **+ (suma) y − (resta)** (−1000..1000, ≠0; `usage_limit` con `GREATEST(0,...)`); notifica al usuario solo al sumar. Card de cortesía también en el detalle del ticket (vinculada al ticket) + historial.
  - **Cambiar plan en TRIAL conserva el cupo:** `POST /admin/subscriptions` ya no salta a `usage_limit=999999` ni resetea contadores en cuentas trial (sin `payment_provider`): solo cambia `plan`/`plan_id` y conserva el cupo de 20 + usos. El 999999 + reset por submódulo aplica solo a cuentas pagas.
  - **"Activo" y "Trial" desde el selector de Datos de Registro hacen acciones reales:** `performActivation` extraído como helper → el botón "Activar" y el selector "Estado de registro = Activo" hacen lo mismo (suscripción active, expiry, notificación, email, eventos). "Trial pendiente" reinicia el cupo (usage_count=0, usage_limit=20, suspended). Confirmaciones en el selector.
  - **Reenviar verificación desde el admin:** `POST /admin/users/:id/resend-verification` + botón "📧 Reenviar verificación" en la ficha cuando el usuario está en `pending_email`. (El portal del usuario ya tenía su propio banner de reenvío — `showEmailVerificationBanner` en `app.js`.)
  - **Endurecimiento de `pending_email` (estado imposible):** un flip crudo del selector dejaba cuentas en `pending_email` con `email_verified=true` + suscripción paga/activa. Fix: (1) el selector del admin ya no ofrece `pending_email` como destino y el backend rechaza la transición manual (usar "Editar email"); (2) `/auth/login` bloquea `pending_email` explícitamente (como la extensión); (3) etiqueta amigable "Email sin verificar" en el portal (antes mostraba "PENDING_EMAIL" crudo).
  - **Tabla de tickets — UX:** fila clickeable (abre el ticket), enlace del usuario y botón Ver como `<a href="#...">` (clic derecho → abrir en nueva pestaña), `navFromHash()` parsea `page/id` del hash para deep-links. El enlace del usuario dentro del ticket también es abrible en nueva pestaña.
  - **Portal — ajustes previos de la sesión:** indicador en vivo de coincidencia de contraseñas en "Cambiar contraseña"; en Mi Plan "Batch" → "Procurar Batch" reubicado bajo Procuración; notificación/email de trial agotado diferenciados por estado (`pending_activation` vs `active` sin pago).
  - **Panel de reset (dev):** `backend-server/dev-tools/reset-panel.ps1` (+ `.exe` via ps2exe, gitignored) — GUI con botones para resetear usuarios/usos, incluye reset por subsistema.
  - **Reset de datos:** usuario de prueba `procuradortool@gmail.com` **eliminado**; quedan solo los 2 admins (id 6, 7). Backup en server `/tmp/backup_pre_userdelete_20260624_*.sql`. ⚠️ El usuario de prueba ya no existe (el id 233/234 de sesiones previas quedó obsoleto).

- ✅ **Sesión 2026-06-20 — testing integral del ciclo de vida (sin modificación de código)** :
  - **Plan maestro de pruebas:** `docs/internal/plan-prueba-vida-producto.md` — bloque D completado al 100%. Commits `64c533a`, `f18a8d7`, `2809d8a`.
  - **TC-D1 — Prueba reina (procuración real):** procuración E2E completada (2 expedientes en 27s). Visor HTML generado y abierto automáticamente. Confirmado: `proc_usage` sube de 0→2, `usage_count` += 2. ✅
  - **TC-D2 — Informe PDF real:** informe generado + Excel producido correctamente con expediente FCR 018745/2021. ✅
  - **TC-D3 — Batch por lote:** 2 expedientes en 1 lote; consola muestra "✅ 2 expedientes procesados". ✅
  - **TC-D5 — Trial compartido app ↔ extensión:** app Mi Cuenta muestra "18/20 usos" con barra roja. `GET /client/extension-auth` a 18/20 → **200** `{success:true, usagePercent:90, flows:[5]}`. Seteo 20/20 → **403** "Agotaste tus 20 usos de prueba. Tu cuenta está pendiente de activación..." ✅ Cupo genuinamente compartido.
  - **TC-D7 — Cortesía admin (+N usos):** `POST /admin/users/233/extra-usage {extra_uses:5}` → `usage_limit` 20→25. App muestra "**(+5 cortesía)**". Post-`POST /admin/users/233/activate` → `usage_limit=25` conservado (`COALESCE(null,25)=25`). ✅
  - **TC-F1–F4 — Bloqueos por submódulo (cuentas pagas):** proc/informe/batch/monitor cada uno bloquea con toast específico antes de abrir Chrome (`checkSubsystemLimit`). ✅
  - **TC-G1–G9 — Suscripción completa:** todo el ciclo de cobranza reconfirmado (pago, webhooks, renovación, gracia, suspensión, recuperación, cancel/reactivar portal+MP). ✅
  - **TC-C4 / TC-H7:** onboarding re-entrada y sesión multiventana. ✅
  - **Usuario de prueba activo:** `procuradortool@gmail.com` **id=233** (sub_id=214), CUIT 27320694359. Estado final restaurado: COMBO_PROMO activo, `payment_provider='mercadopago'`, `usage_limit=999999`, `proc_usage=2`.
  - **Herramienta dev:** `backend-server/dev-tools/` — `sim-renewal.js` (simula cobro mensual) · panel PowerShell de testing de usuarios. Sin cambios de código esta sesión.

- ✅ **Sesión 2026-06-18 (tarde) — ajustes UX registro/portal/admin + flujo cambio de email** :
  - **Registro:** campo **teléfono** nuevo (opcional, debajo de email) que se persiste en `users.telefono`; **card COMBO** aclara los límites reales (proc 50 + **20 por lote** · informes 50 · monitor **20 partes** + **50 consultas de novedades/mes**; antes decía "novedades ilimitadas"); estilo del input `tel` corregido (el CSS no incluía `input[type=tel]`); versión de la landing **2.7.27**.
  - **Portal usuario:** el **CUIT ya no es editable** por el usuario (input `disabled` + se quitó del payload + el backend `/usuarios/api/profile` lo ignora). Lo sigue editando solo el admin.
  - **Cambio de email por admin (flujo nuevo):** botón **"✉️ Editar email"** en Datos de Registro → `POST /admin/users/:id/change-email` cambia el email, **suspende** la cuenta (`pending_email`), guarda el estado previo (columna **`email_change_prev_status`**, migración `20260618_...`), envía verificación al **nuevo** correo + notificación in-app + evento. Al verificar (`/auth/verify-email`), la cuenta **vuelve sola al estado previo** (sin re-activación del admin). Guards: email vacío/igual/tomado por otra cuenta.
  - **Doc:** variante de **backup `.7z` → `OneDrive/.../z-automatizacion`** agregada a CLAUDE.md (junto al backup completo de Desktop).

- ✅ **Sesión 2026-06-17 — E2E real de cobranza (MP comprador + app Electron) + fixes** :
  - **Recuperación/actualización de método con preapproval atribuible:** cuando el usuario YA tiene método (`payment_provider` + `external_subscription_id`), `/checkout/init` usa la nueva `createUpdatePreapproval` (preapproval **custom con `external_reference=user_{id}`, cobro inmediato**) en vez del plan-based. El alta inicial sigue plan-based. **Por qué:** el plan-based no persiste `external_reference` → un preapproval nuevo queda inatribuible y `markPaymentConfigured` matcheaba el VIEJO, dejando 2 suscripciones vivas en MP y sin limpiar la gracia. Con `external_reference`, el webhook lo atribuye, hace single-active y dispara `applyRenewal`.
  - **Single-active robusto (fix de carrera webhook↔confirm):** (1) `markPaymentConfigured` ahora elige el preapproval **más nuevo** atribuible (antes tomaba el primero/viejo) y **cancela TODOS** los demás atribuibles del usuario (autorizados **y pending**); (2) el branch `pending` del webhook ya no pisa un `external_subscription_id` distinto vivo (`COALESCE`), para que el `authorized` pueda superseder el viejo; (3) `cancelSupersededPreapproval` cancela también `pending` (limpia checkouts iniciados y no completados). Resultado: **siempre queda 1 preapproval vivo** por usuario.
  - **Período de gracia VISIBLE (antes era invisible):** el aviso de pago rechazado solo aparecía una vez **suspendido**. Ahora durante la gracia (status active + `payment_grace_ends_at` futuro): banner ámbar en el **banner global del portal** (todas las secciones) + card en **Facturación** + banner/card en la **app Electron** + **notificación in-app** (el webhook `rejected` ahora inserta `notifications`, antes solo email). `/client/account` expone `paymentGraceEndsAt`.
  - **Conteo del monitor por CONSULTA (Opción A):** antes `monitor_novedades_usage` solo subía cuando una consulta de novedades **encontraba** expedientes (en `/monitor/expedientes/bulk`) → consultas sin novedades no consumían. Ahora suma **+1 por consulta de novedades ejecutada** (encuentre o no) en `/monitor/log` (que el script llama siempre por parte); la **consulta inicial / línea base NO consume**. El pre-check `run-monitoreo` (app) solo gatea en `modo='novedades'`.
  - **UI app:** banner ya no se superpone al modal (z-index `.modal` 10000 > banner 9997; se quitó el `_updateBannerVisibility` que restauraba estado stale) · ✕ del modal al margen derecho (`margin-left:auto`) · card de "pago rechazado" en Mi Cuenta.
  - **Trial freno en informe/monitor:** el tope del trial (20 usos compartidos) ahora también frena informe y monitor (antes solo procuración; `checkSubsystemLimit` se saltea en trial).
  - **E2E real validado** (CUIT 27320694359, cuenta compradora MP + automatización PJN real): primer pago · bloqueo por submódulo + ajustes manuales del admin (`*_bonus`) · cancelar/reactivar (portal↔portal pausa/reanuda · MP→portal free_trial sin doble cobro) · nuevo ciclo (renovación) · **pago rechazado → gracia → suspensión por gracia vencida → recuperación** (en gracia y post-suspensión). **Dev tool:** `backend-server/dev-tools/sim-renewal.js` (simula el cobro mensual: pago + `applyRenewal` + factura).
  - **Aprendizaje (para soporte):** el panel de MP **no borra** las suscripciones canceladas (las lista bajo "Suscripciones canceladas") y **tarda en refrescar** las activas. Ante "tengo 2 suscripciones", la verdad está en el estado del preapproval (API `preapproval/search?status=authorized`), no en el render del panel. Single-active deja 1 **autorizada**; el resto quedan **canceladas** (no se pueden eliminar vía API).
  - **Release v2.7.26.**

#### 🧪 Ciclo de test de vida del usuario (flujo validado E2E)
> Plan detallado: `docs/internal/plan-pruebas-ciclo-vida.md`. Resumen del camino validado:
```
REGISTRO (pending_email)
  → verifica email (pending_activation, trial 20 usos compartidos app+extensión)
  → usa hasta 20/20 → bloqueo + "Ya consumiste tus usos" (app + portal)
  → (opcional) admin asigna +N cortesía (suma a usage_limit; visible "(+N)"; sobrevive la activación)
  → admin ACTIVA (active, conserva usos restantes; habilita "Configurar método de pago")
  → CONFIGURA MÉTODO (alta inicial plan-based) → applyTrialBonus: usage_limit=999999, límites por submódulo, pago + factura
  → usa cada submódulo hasta su límite → bloqueo por submódulo (proc50·informe50·batch20·monitor_nov50·partes20)
       (admin puede sumar *_bonus por submódulo → sigue usando hasta agotar de nuevo)
  → NUEVO CICLO (renovación mensual) → contadores a 0, next_billing +1 mes, pago + factura nuevos
  → CANCELAR/REACTIVAR:
       · portal cancela = PAUSA preapproval (reversible) → portal reactiva = REANUDA (sin cobro)
       · MP cancela = TERMINAL → portal reactiva = nuevo checkout free_trial (días ya pagados, sin doble cobro)
  → PAGO RECHAZADO → GRACIA 3 días (sigue activo, banner ámbar + notificación) →
       · paga en gracia → RECUPERADO (createUpdatePreapproval, single-active cancela el viejo)
       · no paga → cron (30 11 * * *) SUSPENDE (status/registration=suspended; ejecutar bloqueado, login permite ver/pagar)
            → paga estando suspendido → RECUPERADO (applyRenewal reactiva)
```
> **Cómo acelerar sin esperar días** (pruebas): gracia/suspensión se fuerzan tocando `payment_grace_ends_at` + corriendo la query del cron de `server.js`; la renovación con `dev-tools/sim-renewal.js`. Estado del usuario de prueba: `procuradortool@gmail.com` (id **233**, sub_id=214), CUIT 27320694359.

#### ✅ Plan 3 (matriz cancelar/reactivar) — CERRADO + 🔲 sueltos pendientes
> Detalle en `docs/internal/plan-pruebas-ciclo-vida.md` (PLAN 3 + escenarios adicionales).
- **Fila A** (portal cancela=pausa → portal reactiva=reanuda, sin cobro): ✅ validada.
- **Fila B** (portal cancela=pausa → reactiva **desde MP**): ✅ validada. **Aprendizaje:** la UI del comprador de MP **no expone "reanudar"** una pausada (solo cancelar); la reanudación-desde-MP se probó por API (PUT `authorized`) → el webhook `subscription_preapproval` sincroniza la cuenta a activa/renovable solo. En la práctica el usuario reactiva desde **nuestro portal** (fila A).
- **Fila C** (MP cancela=terminal → portal reactiva=checkout `free_trial`, sin doble cobro): ✅ validada.
- **Fila D** (MP cancela → re-suscribir **desde MP**): ⚠️ **No es un flujo real.** El comprador en MP no puede auto-suscribirse a nuestro plan (las suscripciones se inician siempre desde un `init_point` que generamos nosotros; un link "pelado" del plan saldría sin `external_reference` → inatribuible). La re-suscripción tras una cancelación terminal **se colapsa en la fila C** (portal "Reactivar").
- **Fila E** (no reactivar → cron `20 11 * * *` pasa a `cancelled` y corta el acceso): ✅ validada — estado terminal, login bloqueado. El cron tiene guard de seguridad (no cancela si hubo pago aprobado reciente cerca de `cancel_at`).
- **✅ Sueltos cerrados:** extensión Chrome con trial agotado (gate `extension-auth`): `extension-auth` 20/20 → 403 "Agotaste tus 20 usos" confirmado (2026-06-20).
- **🔲 Sueltos pendientes:** límite `monitor_partes` (20) → bloqueo al agregar la 21° · cambio de plan (2/ciclo + cancelar downgrade programado) · idempotencia de pagos (mismo webhook 2× no duplica) · `downgrade→upgrade` (requiere 3er plan tarifado activo — L1).

- ✅ **Sesión 2026-06-15 — endurecimiento del ciclo de cobranza + cambio de plan + E2E** :
  - **Cancelar = PAUSAR / Reactivar = REANUDAR (sin cobro nuevo):** `cancelSubscription` pausa el preapproval en MP (reversible, no cobra el próximo período); `reactivateSubscription` lo reanuda (paused→authorized) sin generar pago, el cobro sigue en la fecha original. El cron de vencimiento lo cancela definitivamente si no se reactivó. (Antes cancelaba terminal → reactivar era imposible.)
  - **Reactivación por checkout con `free_trial` (sin doble cobro):** si el preapproval quedó terminal (cancelado desde MP), "Reactivar" crea uno nuevo con free_trial = días ya pagados → el primer cobro cae en el vencimiento original. `MP_SANDBOX_PAYER_EMAIL` en `.env` (quitar en B3).
  - **Single-active:** al vincular un preapproval nuevo se cancela el anterior en MP → un solo preapproval vivo por usuario.
  - **Sync de cancelación/pausa/reactivación desde MercadoPago:** el webhook `subscription_preapproval` ahora refleja el estado (cancelled/paused→baja programada; authorized→activa). Idempotencia: los preapprovals se procesan siempre (no se deduplican por id); fallback de lookup por `external_subscription_id`. Guard anti-pisado (un preapproval viejo no clobberea la suscripción activa).
  - **Usos de cortesía efectivos y visibles:** el admin asigna usos extra → suman al `usage_limit` del trial (antes solo se insertaban en `usage_extras`, tabla que nada leía). "(+N de cortesía)" visible en portal (banner superior + Mi Plan), ficha admin y app Electron. La **activación conserva** la cortesía (antes la pisaba con usage_limit=20).
  - **Cambio de plan ajusta el monto en MercadoPago:** `updatePreapprovalAmount` actualiza `transaction_amount` del preapproval al cambiar de plan (upgrade inmediato + downgrade vía cron). Validado en sandbox (1500↔15000). Antes era un stub que no tocaba MP.
  - **Cambio de plan por admin** desde la ficha (POST `/admin/subscriptions`): usage_limit=999999, registra evento, limpia `scheduled_plan`. **Banner de downgrade programado** + botón "Cancelar cambio" en el portal. **Historial de la cuenta** (user_events) visible en la ficha del admin.
  - **Datos de registro:** domicilio estructurado en el portal (alineado con registro/admin) + **teléfono** en la ficha del admin (display + edición + PUT).
  - **Límites COMBO_PROMO unificados:** proc 50 · batch 20 · informe 50 · monitor_novedades 50 · partes 20 (tabla `plans`, `PLAN_LIMITS`, CLAUDE.md, landing).
  - **Release v2.7.25** (auto-recuperación de sesión, cortesía visible, mensajes). **E2E del ciclo de vida** verificado (registro→trial→tope→cortesía→activación→pago→bloqueo por submódulo→cancelar/reactivar).
  - **Pendientes detectados:** integración cambio de plan↔MP en producción real (B3, ya implementada y probada en sandbox) · renovación mensual y pago-rechazado→gracia→suspensión (no ejercitados en E2E) · downgrade→upgrade requiere 3er plan tarifado activo (L1).

- ✅ **Sesión 2026-06-12 — revisión integral del flujo de habilitación + fixes de portal/dashboard** :
  - **Revisión del flujo completo verificada contra el código** (registro → verificar email → trial 20 → activación admin → pago): las 5 etapas cumplen el modelo. Documentado en "Arquitectura de usage_limit / usage_count" (tabla por etapa)
  - **Fix tope global post-pago (backend, ya en prod):** `applyTrialBonus`/`applyRenewal` ponían `usage_limit` = límite de proc del plan (50 en COMBO) en vez de 999999 → como `usage_count` suma TODAS las ejecuciones, un pago que mezclaba módulos (45 proc + 5 inf = 50) quedaba bloqueado por el pre-check global con mensaje de trial, con submódulos aún disponibles. Ahora ambos setean `usage_limit=999999` (global = contador histórico; rige el submódulo). Validado en staging con `applyTrialBonus` real: 18/20 con usos mezclados → 0/999999 + contadores por submódulo en 0
  - **⚠️ Hallazgo SEC-4:** `middleware/checkLicense.js` es código muerto (no montado en ninguna ruta). El freno server-side del trial son los gates de la extensión; el de la app es el pre-check del cliente. Hardening pendiente pre-lanzamiento (ver tabla seguridad)
  - **Checkout gateado por activación (portal + backend):** el botón "Configurar método de pago" solo se habilita con `registration_status='active'`; en trial muestra mensaje + botón deshabilitado. `/checkout/init` bloquea (403) `pending_activation`/`pending_email` (defensa en profundidad, validado en staging y prod). El estado trial-sin-activar tiene **prioridad** sobre `payment_provider` residual (caso user 230, que además se limpió en DB)
  - **🐛 Fix confirm sin pago (backend + portal, ya en prod):** al volver del checkout de MP **sin pagar** (botón deshabilitado, back, pestaña cerrada), el flag `psc_checkout_pending` disparaba `/checkout/confirm` sin `preapproval_id` → `markPaymentConfigured` seteaba `payment_provider` **a ciegas** → la cuenta quedaba "paga" sin pago (sin reset de contadores, trial desaparecido). Ahora `markPaymentConfigured` **verifica contra MP** que exista un preapproval `authorized` **atribuible al usuario** (por `external_reference=user_{id}` o `payer_email`) antes de marcar; si no → `configured:false`, no se marca nada y el portal muestra banner neutro ("se acreditará automáticamente en unos minutos" — el webhook hace la vinculación real). `linkPreapproval` exige estado `authorized`. ⚠️ Aprendizajes: el **search de MP ignora el query param `external_reference`** (devuelve todos los preapprovals del vendedor → filtrar siempre del lado nuestro) y el checkout plan-based **no persiste el `external_reference`** agregado a la URL del init_point (queda `undefined` → la identificación real recae en el webhook por `payer_email`). Validado en staging (2 usuarios sin pago atribuible → `configured:false`, DB intacta). Limpieza: `payment_provider` fantasma de user 230 reseteado + 2 preapprovals autorizados residuales del sandbox (29/05 y 04/06) cancelados en MP
  - **💳 Atribución del checkout por ventana (backend, ya en prod · validado E2E con pago real):** como MP no persiste identificadores, un pago real quedaba inatribuible (webhook: "Suscripción no encontrada", confirm: `configured:false`). Solución: (1) `/checkout/init` estampa `checkout_initiated_at` (migración `20260612_add_checkout_initiated_at.sql`); (2) `markPaymentConfigured` reclama el preapproval **autorizado**, de **nuestro plan**, **sin identificadores**, **sin dueño** en DB y creado **dentro de la ventana** del checkout del usuario; (3) `reconcileClaimedCheckout` registra el primer pago que el webhook no pudo atribuir (matcheo por `payer_id` de MP + timing) y aplica `applyTrialBonus` + activación + factura pendiente. Validado E2E en prod: pago sandbox real de $15.000 → claim + reconciliación → 0/999999, submódulos en 0, pago registrado, factura pendiente creada, `next_billing_date` +1 mes. Riesgo aceptado (Beta): colisión si 2 usuarios pagan en la misma ventana de minutos. Preapproval duplicado del usuario (pagó 2 veces) cancelado en MP
  - **Dashboard admin:** cards del Resumen navegan a su sección (Usuarios registrados/Suscripciones activas → Usuarios · Tickets abiertos → Tickets)
  - **Ambos dashboards:** el botón Atrás del navegador navega entre secciones en vez de salir (History API con `pushState(estado,'')` — sin tocar la URL → sin riesgo para login/SSO)
  - Backup del día en Desktop (`202606_12062026_ProcuradorTool`)

- ✅ **Sesión 2026-06-11 — acceso del trial agotado + enforcement de límites pagos (release v2.7.23)** :
  - **Login del trial agotado (backend, ya en prod):** `/auth/login` ahora deja entrar a la app a un usuario en trial (`suspended` + `pending_activation`) **aunque haya consumido los 20 usos** — solo para ver el estado de la cuenta. Las ejecuciones siguen bloqueadas server-side por `checkLicense` (403 cuando `usage_count >= usage_limit`). Antes la query exigía `usage_count < usage_limit` → daba 403 "No tenés una suscripción activa". Validado en staging con un trial 20/20 simulado. Commit `c256360`
  - **Mensaje de tope alcanzado (portal `app.js` + app `renderer.js`):** al agotar el cupo, el aviso decía "Quedan pocos usos"; ahora cuando `rem<=0` dice **"Ya consumiste tus usos. Contactá al administrador para activar tu cuenta."** (1–5 usos restantes sigue diciendo "Quedan pocos usos")
  - **Límites por subsistema para cuentas PAGAS (app v2.7.23):** nuevo `checkSubsystemLimit()` en `main.js` — pre-chequea `proc`/`informe`/`monitor_novedades` en `run-process`, `run-process-custom-date`, `run-informe` y `run-monitoreo` vía `/client/account`. **Antes** el único freno era el contador global (`usage_limit=999999` para pagos) que nunca disparaba: el script corría igual y el 403 de `log-execution` se ignoraba. **Ahora** un pago que agotó (ej.) sus 50 procuraciones se frena ANTES de correr con mensaje claro "Alcanzaste el límite de X de tu plan: usados/límite". **El trial NO se ve afectado:** el check se saltea si `payment_provider` es null (el trial se rige por el cupo global de 20 compartidos para cualquier mezcla). `renderer.js`: los avisos `action:'upgrade'` muestran el mensaje real en el toast. Commit `69ed65a`, tag `electron-v2.7.23`
  - **Fix "No autenticado" al agotar usos (backend, ya en prod · release v2.7.24):** `/client/verify-session` y `/auth/refresh` **todavía gateaban por usos** (`usage_count < usage_limit`). Al llegar a 20/20 ambos daban 403 → el heartbeat de la app dejaba `sessionVerified=false` → `isAuthenticated()` false → "No autenticado" al ejecutar, y quedaba **trabado** aun tras liberar usos (nada re-verificaba antes del gate). Ahora son **capa de sesión, no de cuota**: permiten active O trial (`pending_activation`) **sin mirar usos** (el bloqueo de ejecución lo hacen run-process/checkLicense/log-execution; el de la extensión, extension-login/extension-auth, que mantienen su gate). Validado en staging con trial 20/20 → ambos 200. Commit `f53bc6b`. **`authManager.js`:** auto-recuperación del heartbeat — un refresh+heartbeat exitoso restaura `sessionVerified=true` (evita que un parpadeo de red o 403 temporal trabe la app hasta reiniciar). Release v2.7.24, tag `electron-v2.7.24`
  - **Mantenimiento:** limpieza de las 15 partes de prueba del monitor de `procuradortool@gmail.com` (id 230) directo en DB
  - El **acceso a la app nunca se cierra** por agotar ejecuciones (ni trial ni pago): solo los estados terminales (`rejected`, `cancelled`, `suspended_admin`, `suspended_plan_expired`) bloquean el login. La verificación de sesión (login/refresh/verify-session) es capa de sesión; el enforcement de cuota vive en run-process/checkLicense/log-execution (app) y extension-login/extension-auth (extensión)

- ✅ **Sesión 2026-06-10 — incidente de seguridad + mejoras UX + 4 releases** :
  - **🔒 Incidente GitGuardian cerrado:** token MP sandbox removido de CLAUDE.md (`74e6c00`), credenciales **rotadas** (token + webhook secret) en panel MP, `.env.staging` y `.env` prod actualizados, validado E2E (checkout staging HTTP 200). Regla de secretos agregada a "Zonas protegidas" (`0fa0521`)
  - **📋 Revisión integral** (`docs/internal/revision-integral-2026-06-10.md`): auditoría real (npm audit + escaneo SQLi/eval/CORS/TLS), plan de corrección, plan de marketing Beta, pendientes consolidados. Nuevos pendientes D3/D4 (npm audit fix) y D5 (limpiar temporales)
  - **App Electron v2.7.19→2.7.22** (mejoras UX): fecha límite default = hoy en procuración sidebar (batch sin fecha = sin filtro, trae todo) · scrollbars horizontales finas (consola, modales, monitor) · link al portal en mensaje "sin suscripción" del login · botón 👁 mostrar/ocultar contraseña · modal batch sin línea "Ejecuciones restantes" (confundía con el trial) · opciones "Archivos" del modal informe deshabilitadas "(próximamente)"
  - **Backend (activo en prod sin release):** `log-execution` solo computa usos en ejecuciones **exitosas** (errores/detenciones no consumen trial; quedan en `usage_logs`) · rate limit descarga scripts 50→**150**/5min (cuenta por IP; estudios con varios usuarios compartían cupo) · mensajes de trial agotado según estado: `pending_activation` → "pendiente de activación por el equipo" / `active` sin pago → "configurá tu método de pago" (extension-login, refresh, extension-auth)
  - **Extensión v1.3.5:** link "Ir al portal de usuarios →" en errores de suscripción/trial (`action: 'subscribe'`). ZIP `pjn-extension-1.3.5.zip` subido al store, pendiente aprobación
  - Backup completo del día en Desktop (`202606_10062026_ProcuradorTool`)

- ✅ **B-5 — CSP activada (primer cambio probado en staging→prod)** (sesión 2026-06-01):
  - Content Security Policy en Helmet (`server.js`): defensa en profundidad contra XSS
  - `'unsafe-inline'` + `script-src-attr 'unsafe-inline'` por los onclick/estilos inline; restringe object-src, base-uri, frame-ancestors, form-action, connect-src
  - **Primer cambio que recorrió el flujo completo de staging:** generado → probado en `staging-api` (Playwright: login/portal/dashboard renderizan, onclick inline dispara bajo CSP, 0 violaciones) → desplegado a producción y verificado
  - **🔒 Toda la seguridad cerrada:** M-1, M-2, B-1..B-8 resueltos. Solo queda auditoría externa (opcional, pre-masivo). Resguardo `sec-pre-b5`, commit `f034bae`

- ✅ **Staging Fase D + PLAN COMPLETO — simulacros de rollback** (sesión 2026-06-01):
  - **Fix de aislamiento:** prod y staging compartían directorio de código → staging movido a `/var/www/procurador-staging/backend-server` (código propio, node_modules por symlink). Ahora se pueden probar cambios de código sin tocar prod
  - **Simulacro datos** (`ops/drill-rollback.sh`): corrupción de staging → `restore-db.sh` → 100% recuperado en 3 s, prod intacta
  - **Simulacro código** (`ops/drill-code-rollback.sh`): staging roto (000) → prod sigue 200 → restaurar + reinicio → 5 s
  - **🎉 PLAN DE STAGING COMPLETO (4 fases).** Entorno gemelo aislado, accesible en `staging-api.procuradortool.com`, con backups pre-deploy, restore probado y rollback bidireccional verificado. Uso operativo documentado en `docs/internal/plan-implementacion-staging.md`

- ✅ **Staging Fase C — exposición pública con SSL + acceso restringido** (sesión 2026-06-01):
  - DNS `staging-api.procuradortool.com` → 142.93.64.94 (Cloudflare, DNS only)
  - Nginx: bloque `staging-procurador` proxea a `:3444`, SSL via certbot (vence 2026-08-31, auto-renovación), HTTP→HTTPS
  - **Basic auth** (usuario `equipo`, `/etc/nginx/.htpasswd-staging`) — solo el equipo accede
  - Verificado: sin auth→401, con auth→200, HTTP→301, **producción intacta**
  - Acceso: **https://staging-api.procuradortool.com** · config en `ops/nginx-staging.conf`
  - Pendiente: Fase D (simulacro de rollback)

- ✅ **Staging Fase B — proceso aislado en puerto 3444** (sesión 2026-06-01):
  - Base `procurador_db_staging` creada desde backup de prod (26 tablas)
  - PM2 `procurador-staging` (modo **fork**, puerto 3444 / HTTP 3001) cargando `.env.staging` por preload `-r dotenv/config`. Sin secretos en `ecosystem.config.js`
  - `.env.staging` (server-only, gitignored): overrides DB/puertos/NODE_ENV + **MercadoPago fijado en sandbox** (no cambia aunque prod pase a MP real en B3)
  - **Aislamiento probado:** escritura en staging (users 3→4) no afectó prod (siguió en 3). `pm2 save` persiste ambos procesos
  - Pendiente: Fase C (subdominio público `staging-api` + SSL + acceso restringido), Fase D (simulacro)

- ✅ **Staging Fase A — backups pre-deploy y restauración** (sesión 2026-06-01):
  - **Hallazgo:** el backup diario ya existía (`backend-server/scripts/backup-db.js`, cron 03:00 → sube a DO Spaces, retención 30 días + copias locales en `/var/backups/procurador/`). Mejor que lo planeado (offsite). No se duplicó.
  - **Nuevo `ops/backup-now.sh [prod|staging]`:** backup local on-demand pre-deploy, con guarda de integridad + rotación (últimos 10). Va a `/var/backups/procurador/predeploy/`. Probado en producción.
  - **Nuevo `ops/restore-db.sh [prod|staging] <archivo> [--force]`:** rollback de la capa de datos. Antes de restaurar hace backup de seguridad de la base destino + confirmación tipeada para prod + recrea limpia preservando owner. **Probado E2E contra base descartable, producción intacta.**
  - `.gitattributes` fuerza LF en `*.sh` (CRLF rompe bash en el servidor)
  - Resguardos: backup Desktop `202606_01062026` + tag `pre-staging-2026-06-01`
  - Plan completo: `docs/internal/plan-implementacion-staging.md`. (Fases B/C/D también completadas — ver entradas de arriba)

- ✅ **B-2 — Política de contraseñas** (sesión 2026-06-01):
  - Helper `utils/passwordPolicy.js` (Opción A): mín. 8 chars + al menos una letra y un número + no estar en lista de comunes + no ser igual al email
  - Aplicado en los 4 puntos backend: registro, reset, change-password (`auth.js`) y cambio del portal (`usuarios.js`)
  - UX estándar: requisitos visibles en los formularios + mensajes específicos según el requisito que falla (registro, portal, página de reset)
  - **No afecta login de usuarios existentes** (el login usa `bcrypt.compare` sin política). Sin cambios de DB ni dependencias
  - Resguardo `sec-pre-b2` · commit `548f0e8` · helper 12/12 pruebas, validado en producción

- ✅ **Correcciones de seguridad — grupo B seguro** (sesión 2026-06-01):
  - **B-1** (`server.js`): valida `JWT_SECRET` al arrancar (≥32 chars), si no `process.exit(1)`
  - **B-3** (`auth.js`, `usuarios.js`): bcrypt cost 10→12 (3 ocurrencias). Hashes viejos siguen verificando
  - **B-4** (`webhooks.js`): el log de firma inválida ya no expone la firma esperada
  - **B-6** (`server.js`): `minVersion: TLSv1.2`. Probado: negocia TLS 1.3, rechaza TLS 1.1
  - **B-8** (`checkLicense.js`): BOM inicial eliminado
  - **B-7** verificado sin cambios (la API no pasa por Cloudflare; `trust proxy` ya correcto)
  - (B-2 y B-5 resueltos después en sus propias entradas — ver arriba. Seguridad: 100%)
  - Resguardo `sec-pre-b-group` · commit `da1eec6` · +18/-6 en 5 archivos · pruebas producción OK

- ✅ **Correcciones de seguridad M-1 y M-2** (sesión 2026-06-01):
  - **M-1:** `authenticateAdmin` (`routes/admin.js`) ahora chequea la blacklist de tokens antes de `jwt.verify`. Antes el logout de admin no invalidaba el token hasta su vencimiento (8h). Validado E2E en producción (logout → 403 inmediato).
  - **M-2:** la firma HMAC del webhook MP (`routes/webhooks.js`) se compara con `crypto.timingSafeEqual` (con guarda de longitud) en vez de `!==`. Evita timing attacks.
  - Cambio quirúrgico: +15/-1 líneas en 2 archivos. Resguardo previo: tag `sec-pre-m1-m2`. Commit `58b3163`. 13/13 pruebas OK.

- ✅ **Extensión Chrome v1.3.4 — header con marca Procurador TOOL** (sesión 2026-05-30):
  - Reemplazado el texto "PJN – Automatización" del popup por el logo `icon128` + "Procurador **TOOL**" (amber) + sublabel "Procurador SCW" — idéntico a los logins del portal
  - Solo tocó `popup.html` + versión del manifest (1.3.3 → 1.3.4). Sin cambios en lógica, permisos ni content scripts
  - Backup previo: tag `ext-pre-logo-v1.3.3` · cambio en tag `ext-logo-v1.3.4`
  - ✅ Subida al Chrome Web Store (2026-06-10) junto con las imágenes nuevas del listing

- ✅ **Bloque 1 — Ícono oficial balanza dorada** (sesión 2026-05-23):
  - **Ícono:** ⚖️ emoji renderizado con Puppeteer → ICO multi-resolución (16/32/48/256px)
  - **Favicon landing:** `backend-server/public/assets/favicon.png` · `<link rel="icon">` en `index.html`
  - **Electron app:** `afterPack.js` hook usa `rcedit` para embeber el ícono en el `.exe` post-empaquetado
  - **Causa raíz del problema:** electron-builder no llamaba rcedit automáticamente; sin el hook el exe mantenía el ícono default de Electron (átomo azul)
  - **Runtime icon:** `appIcon` en `main.js` — dev: `assets/icon.ico` · prod: `process.resourcesPath/icon.ico` (via `extraResources`)
  - **Archivos clave:** `electron-app/build/icon.ico` (build) · `electron-app/assets/icon.ico` (runtime) · `scripts/generate-icon.js` · `scripts/afterPack.js`
  - Releases: v2.7.6 → v2.7.7 → v2.7.8 → v2.7.9 → **v2.7.10** (fix definitivo)

- ✅ **Extensión Chrome Web Store v1.3.3 aprobada** (sesión 2026-05-26):
  - Nombre actualizado: "Procurador SCW – Automatización PJN" · ícono balanza · descripción con mención a suite
  - Visibilidad pública habilitada · aprobada por Google
  - Portal web → sección Descargas: enlace directo a la store

- ✅ **Flujo de registro y activación completo** (sesión 2026-05-26):
  - **Portal de usuarios** migrado de `/auth/extension-login` a `/auth/portal-login` — permite acceso a usuarios en cualquier estado no terminal (`pending_email`, `pending_activation`, `suspended`)
  - **Nuevo endpoint:** `POST /auth/resend-verification` — reenvía email de verificación de forma segura (respuesta genérica siempre, anti-enumeración)
  - **Nuevo endpoint:** `GET /client/download/electron` (autenticado) — consulta GitHub API en tiempo real y redirige al `.exe` del último release; no requiere actualizar la URL en cada versión
  - **Email verificación:** ícono real (`/assets/icon128.png`) en lugar de emoji · enlace "Ir al portal →" post-verificación apunta a `/usuarios/` en lugar de `/`
  - **Electron — estado `pending_email`:** banner ámbar "Verificá tu email" + `btnMain` deshabilitado
  - **Electron — Mi Cuenta:** card de prueba con contador `X/20 utilizados` + barra de progreso coloreada (verde/naranja/rojo)
  - **Portal — Mi Plan:** card de prueba idéntica cuando `registration_status = 'pending_activation'`
  - **Portal — Descargas:** extensión con enlace directo Chrome Web Store · app usa `/client/download/electron`
  - Releases: … → v2.7.16 → v2.7.17 (tour paso 10) → **v2.7.18** (headless por defecto, fecha límite=hoy, visor auto-abre proc+informe, mensajes X/20)
  - Backend (sin release, ya en prod): **modelo trial-hasta-pago** — 20 usos compartidos app+extensión hasta configurar el pago; admin solo aprueba; al pagar plan + contador a 0. Extensión atada al cupo del trial. Cron de trial agotado ya no rechaza (notifica).

- ✅ **Documentación para evaluación + auditoría de seguridad** (sesión 2026-05-30):
  - **Informe de evaluación del proyecto** (`docs/informe-evaluacion-proyecto.md` + versión Word `docs/Informe-Evaluacion-Procurador-SCW.docx`): documento sin tecnicismos para socios. Conclusión: apto para iniciar Beta controlada.
  - **Diagrama de flujo del ciclo de vida del usuario** (`docs/diagrama-flujo-usuario.md`): formato Mermaid, camino principal + caminos alternativos.
  - **Informe de verificación de seguridad** (`docs/internal/informe-seguridad.md`): revisión del código real. 18 fortalezas, 2 puntos media (M-1: `authenticateAdmin` no chequea blacklist · M-2: comparación de firma webhook no timing-safe), 8 baja, 3 proceso. Veredicto: apto para Beta.
  - **Plan de staging y rollback** (`docs/internal/plan-staging-rollback.md`): diseño de entorno staging (puerto 3444, db_staging, subdominio) + rollback en 3 capas + simulacro de validación.
  - Generador Word reutilizable: `backend-server/dev-tools/gen-informe-word.js`

- ✅ **Branding unificado + reset de datos** (sesión 2026-05-30):
  - Logo `icon128.png` de la extensión copiado a `public/assets/brand-icon.png` (y a `public/landing/brand-icon.png` porque la landing se sirve por Nginx, no por Express)
  - Reemplazados todos los emojis `⚖️` por `<img>` del logo oficial en: landing (navbar/hero/footer), dashboard admin (login + sidebar), portal usuario (login + sidebar + cards de descarga)
  - Marca consistente en logins y sidebars: "Procurador **TOOL**" (acento amber) + sublabel "Procurador SCW" — formato igual al de la landing
  - Versión actualizada en landing (4 refs) y portal usuario: 2.7.6/2.7.13 → 2.7.14
  - Reset completo de datos de prueba (usuarios + transaccionales) — solo quedan los 2 admins. Backup en servidor: `/tmp/backup_pre_reset_*.sql` + `/tmp/backup_pre_delete_user19_*.sql`
  - Usuario `procuradortool@gmail.com` (id 19) eliminado para hacer pruebas desde cero

- ✅ **Fase 5 cobranza — flujo completo + facturación manual** (sesión 2026-05-29):
  - Ciclo de vida de suscripción end-to-end validado en sandbox (alta → cancelación → reactivación → suspensión)
  - Identificación de pagos por `external_reference=user_{id}` (resuelve email distinto portal vs MercadoPago)
  - Módulo de facturación manual en dashboard admin (sube PDF de ARCA) — Facturante automático desactivado hasta contratar
  - Reset de datos de prueba ejecutado (3 usuarios conservados). Ver sección "Reset de datos de prueba"
  - Detalle completo en sección "Estado Fase 5 — Cobranza"

- ✅ **Fix toggle registro público** (sesión 2026-05-23):
  - **Causa raíz:** `register.js` llamaba a `/auth/register-status` que no existía → 404 → formulario siempre cerrado
  - **Fix:** creado `GET /auth/register-status` en `routes/auth.js` — lee `app_settings.allow_public_register` en DB, fallback a env var
  - **Toggle reconectado:** `admin.js` tiene `GET /admin/settings` + `PUT /admin/settings/:key` (whitelist: `allow_public_register`)
  - **Dashboard:** card "⚙️ Configuración rápida" con botón verde/rojo en **Usuarios pendientes** (se quitó de Resumen)
  - `app_settings` en DB es la fuente de verdad; env var `ALLOW_PUBLIC_REGISTER` es fallback
  - Commits: `0b57297` (toggle admin) · `3edf2e5` (register-status + pending)

- ✅ **Bloque 1 — Branding & Pricing landing** (sesión 2026-05-23):
  - **Jerarquía de marca:** "Procurador **TOOL**" (suite) + sublabel "Procurador SCW" en navbar y footer
  - **Precios promos ARS:** EXTENSION_PROMO $1.500/mes · COMBO_PROMO $15.000/mes (antes: USD)
  - **Planes permanentes (Próximamente):** indexados a UMA CSJN $95.626: Básico $31.875 · Pro $63.751 · Enterprise $95.626
  - **DB:** `price_usd → NULL`, `price_ars` seteado · migración `20260522_promo_prices_to_ars.sql`
  - **Backend:** `auth.js`, `users.js`, `usuarios.js` usan `price_ars`; `register.js` y `dashboard.js` muestran ARS
  - Commit: `a614238`

- ✅ **Sección "Ayuda" en portal web** (sesión 2026-05-21) · **v2.7.3** SSO soporte · **v2.7.2** IA Haiku · **v2.7.0** QA 159/165

### Pricing actual en producción
| Plan | price_usd | price_ars | Activo |
|---|---|---|---|
| EXTENSION_PROMO | NULL | $1.500 ARS | ✅ |
| COMBO_PROMO | NULL | $15.000 ARS | ✅ |
| BASIC | NULL | NULL | ❌ Próximamente (≈ 1/3 UMA) |
| PRO | NULL | NULL | ❌ Próximamente (≈ 2/3 UMA) |
| ENTERPRISE | NULL | NULL | ❌ Próximamente (≈ 1 UMA) |

> UMA de referencia: **$95.626 ARS** (CSJN vigente a 2026-05-23)

### Captación de clientes (Beta)
> Plan para conseguir los primeros 50 clientes con el precio fundador ($15.000/mes): **`docs/plan-captacion-clientes.md`**.
> Enfoque: red cercana → Instagram (credibilidad) → colegios/asociaciones → referidos. Prueba clave: video "antes/después". Objeción de confianza = argumento de venta ("las contraseñas del PJN nunca pasan por nuestros servidores").

### Toggle registro público — cómo funciona
```
DB: app_settings WHERE key = 'allow_public_register'  ← fuente de verdad
  ↓ fallback si falla la consulta
Env: ALLOW_PUBLIC_REGISTER=true (en .env del servidor)

Controlar desde: Panel admin → Usuarios pendientes → "⚙️ Configuración rápida"
Endpoint que lee el toggle: GET /auth/register-status → { open: true/false }
```

### Ícono oficial — cómo regenerar
```bash
cd electron-app
node scripts/generate-icon.js
# → genera build/icon.ico (multi-res), build/icon.png, assets/icon.ico, assets/icon.png, backend-server/public/assets/favicon.png
# Luego: npm run release
```
> `afterPack.js` embebe el ícono en el `.exe` vía rcedit automáticamente en cada build.

- ✅ **Smoke tests — dashboard admin + script local PJN** (sesión 2026-05-26 → 2026-05-27):
  - **Dashboard admin "🧪 Diagnóstico":** 3 tarjetas — API Backend · Portal PJN · Extensión Chrome
  - **Endpoints backend:** `GET /admin/smoke-tests/latest` · `POST /admin/smoke-tests/run-api` · `POST /admin/smoke-tests/report-pjn` · `POST /admin/smoke-tests/report-extension`
  - **Persistencia:** resultados en `backend-server/data/smoke-test-results.json`
  - **Script unificado:** `electron-app/scripts/smoke-test-pjn.js` — cubre Portal PJN (grupos D+E, 24 checks) Y Extensión Chrome (grupos F+G+H, 24 checks) → **48 checks totales**, 66 segundos
  - **Último resultado:** 48/48 ✅ (2026-05-27)

### Estado Fase 5 — Cobranza
> Última actualización: 2026-05-29

Flujo de cobranza **completo y validado en sandbox** en producción con `PAYMENT_MODULE_ENABLED=true`.
Ciclo de vida de suscripción funcionando end-to-end: alta → cobro → cancelación → reactivación → suspensión por pago fallido.

---

### 🧪 Credenciales de sandbox MercadoPago
> Solo para pruebas — NO usar en producción

#### Cuentas de prueba MP
| Rol | Usuario | Contraseña | UserID | Código verificación |
|---|---|---|---|---|
| **Vendedor** (Procurador SCW) | `TESTUSER3208446836555858` | `5pfW4wdMZj` | `3433287066` | `287066` |
| **Comprador** (usuario que paga) | `TESTUSER4310268003253553318` | `zveOQA6aYI` | `3433287076` | `287076` |

> Login vendedor en panel dev: https://www.mercadopago.com.ar/developers/panel/app

#### Credenciales API (cuenta vendedor de prueba)
> ⚠️ **No pegar las credenciales reales acá.** Los valores vivos viven solo en `backend-server/.env.staging` (server, gitignored). Para verlos: `ssh … "grep MP_ /var/www/procurador-staging/backend-server/.env.staging"`. Histórico: el token sandbox que estuvo acá fue rotado tras la alerta de GitGuardian (2026-06-08).

| Variable | Dónde está el valor |
|---|---|
| `MP_ACCESS_TOKEN` | `.env.staging` (server) — token sandbox del vendedor de prueba |
| `MP_PUBLIC_KEY` | `.env.staging` (server) — clave pública sandbox |
| `MP_WEBHOOK_SECRET` | `.env.staging` (server) — secreto del webhook sandbox |

#### Planes MP (sandbox)
| Plan | ID | Precio | init_point |
|---|---|---|---|
| `COMBO_PROMO` | `c4ff98a4b2244828a8be0a6d84085fb8` | $15.000 ARS | `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=c4ff98a4b2244828a8be0a6d84085fb8` |
| `EXTENSION_PROMO` | `f7cea2c32ae94576b254089ebf7371a4` | $1.500 ARS | `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=f7cea2c32ae94576b254089ebf7371a4` |

#### Tarjeta de prueba (para pagar como comprador)
| Campo | Valor |
|---|---|
| Número | `5031 7557 3453 0604` |
| Vencimiento | `11/30` |
| CVV | `123` |
| Nombre titular | `APRO` (aprueba automáticamente) |
| DNI | `12345678` |

---
Para activar el módulo de pagos solo se necesitan las credenciales externas (ver pendientes B1-B3).

**Implementado:**
- DB: tablas `payments`, `invoices`, `usage_extras`, `webhook_events` + columnas nuevas en `subscriptions`
- Backend: `routes/checkout.js`, `routes/webhooks.js`, `services/subscriptionService.js`, `services/invoiceService.js`
- Admin: endpoints refund-preview, extra-usage (GET/POST), payments (GET), invoices (GET)
- Portal usuario: card Método de Pago, historial de pagos, historial de facturas
- Admin dashboard: card Usos Extra + modal, card Historial de Pagos, card Historial de Facturas, modal Suspensión mejorado

**Flujo de suscripción completo (sesión 2026-05-29):**
- **Alta / checkout:** plan-based MP. `init_point` enriquecido con `external_reference=user_{id}` + `payer_email`. Navega en la misma pestaña (no popup). Flag `psc_checkout_pending` en localStorage detecta el retorno aunque MP no agregue `?pago=ok`.
- **Identificación de pagos (clave):** webhook resuelve el usuario por prioridad: (1) `external_reference=user_{id}` → independiente del email de MP, (2) `external_subscription_id` ya vinculado, (3) `payer_email`. Resuelve el caso de email distinto entre portal y MercadoPago.
- **Webhook:** maneja `payment`, `subscription_authorized_payment`, `preapproval` y `subscription_preapproval`. Guarda `external_subscription_id` real para poder cancelar luego en MP.
- **Cancelación:** `cancel_at = next_billing_date`, cancela el preapproval en MP. El cobro del período en curso ya ocurrió; no se cobra la renovación. Acceso hasta fin del período.
- **Reactivación:** botón "↩ Reactivar" en portal antes del vencimiento → `POST /checkout/reactivate` → quita `cancel_at`, reactiva preapproval en MP.
- **Pago rechazado:** gracia 3 días → si no se recupera, `status=suspended` → UI "Actualizar método de pago".
- **Cron cancelaciones:** triple verificación de seguridad (buffer 2h + `auto_renewal=FALSE` + sin pago aprobado reciente) para evitar cancelar cuentas que pagaron.
- **App Electron (v2.7.14):** fix `sub = a.subscription || a` (campos planos), banner de cancelación programada en Mi Cuenta.

**Facturación manual (reemplazo temporal de Facturante):**
- Dashboard admin → sección **🧾 Facturación** con 2 tabs: Pendientes (pagos sin PDF) y Emitidas (con buscador).
- Admin sube PDF generado en ARCA + tipo de comprobante (default Factura C), número (autoformateo `1245`→`0001-00001245`), CAE (opcional).
- Botón **＋ Nueva factura manual**: modal con autocomplete de usuario (navegación teclado + mouse), monto, fecha, plan, notas.
- PDFs en `public/invoices/`, servidos vía `/invoices/`. La factura aparece en el portal del usuario al instante.
- **Facturante automático DESACTIVADO** hasta contratar el servicio (cron comentado en `server.js`, `processInvoice` no-op sin `FACTURANTE_WSDL_URL`). `enqueueInvoice` se mantiene activo: crea el registro pendiente al cobrar.

---

## 📋 Pendientes — Lista consolidada
> Última revisión: 2026-06-10 · Resumen priorizado en `docs/internal/pendientes-prioritarios.md`
> ⭐ **Revisión integral 2026-06-10:** `docs/internal/revision-integral-2026-06-10.md` — auditoría real (npm audit + escaneo de código), plan de corrección priorizado, plan de marketing para la salida Beta (COMBO_PROMO + EXTENSION_PROMO) y pendientes consolidados (sección 6). **Consultar ese doc junto con esta lista al revisar pendientes.**
> 🧪 **Flecos del plan de pruebas integral (2026-07-03/04):** `docs/internal/plan-pruebas-integral-2026-07.md` — sección "Hallazgos" (los 4 ya corregidos, ver historial) y casos con ⚠️ PASS parcial / ⏭️ SKIP sin resolver: **U9.3** (pagar una reactivación, bloqueado por causa no identificada), A1.14 (ciclo completo de reset de contraseña), A7.5 (rate limit del bot IA, no ejecutado por costo), A2.6/A2.8, A4.4/A4.5, A3.10/A3.11, U5.3, U11.7 (confirmaciones visuales pendientes, no bugs). **Consultar ese doc si preguntan por el estado de las pruebas o pendientes de QA.**
> 📔 **Propuesta módulo Bitácora (2026-07-06, pendiente de aprobación/implementación):** `docs/internal/propuesta-bitacora-agenda-2026-07.md` (v6.1) — agenda/vencimientos/tareas/notas + expedientes seguidos con captura desde los visores, gating por plan y backup/restore del usuario. Diseño funcional y técnico completo (pantallas, flujos F1–F9, modelo de datos, endpoints, transporte POST-form con PRG y límites reales evaluados, 2 fases: F1 backend+portal / F2 visores+release Electron). **Para retomarla: leer ese doc y bajar la Fase 1 a plan de implementación.**
> 🔵 **Planes de Seguridad pre-comercialización (2026-07-06):** `docs/internal/plan-seguridad-precomercializacion-2026-07.md` — cubre los 3 pendientes abiertos del bloque de seguridad: **SEC-1** (plan de auditoría ejecutable de forma autónoma por Claude, 7 bloques de pruebas white+black-box contra staging, con entregable de informe), **SEC-2** (CI en GitHub Actions + **verificación diaria real**: corre procuración+informe reales con el CUIT 27320694359, credenciales en Windows Credential Manager, disparador al encender/manual/horario, panel de config en la app, aporta fecha/estado a Diagnóstico del dashboard + alerta no bloqueante si pasan >7 días) y **SEC-4** (mover el enforcement del trial a `/license/execution/start`). **Para retomar cualquiera: leer ese doc; orden sugerido SEC-4 → SEC-1 → SEC-2.**
> 🐛 **Informe de bugs (2026-07-10, relevado y verificado, pendiente de corrección):** `docs/internal/informe-bugs-2026-07.md` — revisión en paralelo de 3 zonas (backend cobranza/auth · backend ejecución/cuotas · app Electron) con verificación manual `archivo:línea` de cada hallazgo alto/crítico. **2 críticos:** C1 (el `*_bonus` por submódulo se cancela algebraicamente en `client.js:359` → uso ilimitado sin contar para cualquier cuenta con bonus) · C2 (el webhook descarta el `approved` cuando MP reenvía el mismo `payment.id` tras el `pending` → pago perdido, `webhooks.js:110`). **6 altos:** A1 (`applyTrialBonus` no setea `next_billing_date`/`status` → rompe cancelar/pausar/reactivar en el primer período) · A2 (claim-por-ventana sin techo + `checkout_initiated_at` nunca se limpia → robar el pago de otro) · A3 (`linkPreapproval` sin check de dueño → IDOR) · A4 (`/auth/forgot-password` XSS reflejado + enumeración + sin rate limit) · A5 (`currentProcess` es código muerto → no bloquea ejecuciones concurrentes) · A6 (`shutdown()` nunca se llama → script+Chrome huérfanos al cerrar la app). Más 10 medios (incl. M1 reset mensual global, M2 = SEC-4 agravado) y 8 bajos. **⚠️ C2+A1+M4 forman el camino del primer pago real → corregirlos es prerequisito de B3 (MercadoPago producción).** **Para retomar: leer ese doc; orden sugerido C1 → (C2+A1+M4) → A4 → (A2+A3) → (A5+A6, requiere release Electron) → (M1+M2). Los pasos backend son deployables sin tocar la app.**

### 🔴 Requieren cuentas / contratos externos

| # | Tarea | Detalle |
|---|---|---|
| ~~**B1**~~ | ~~**MercadoPago sandbox**~~ | ✅ Credenciales configuradas. Ver sección "Credenciales de sandbox" arriba. |
| ~~**B2**~~ | ~~**Probar checkout end-to-end**~~ | ✅ Validado: checkout devuelve `init_point`, pago aprobado en sandbox (PayID `160575039911`), webhook llegó con 200, HMAC validado, procesamiento correcto. |
| **B3** | **MercadoPago producción** | Una vez validado en sandbox → credenciales reales → `PAYMENT_MODULE_ENABLED=true` |
| **C1** | **Contrato Facturante** | _No bloqueante._ Mientras tanto la facturación es **manual** (admin sube PDF de ARCA en dashboard → Facturación). Para activar el automático: completar vars `FACTURANTE_*` en `.env` + descomentar cron `invoice-retry` en `server.js`. Ver `backend-server/utils/facturante.js` |
| **AZ** | **Azure Trusted Signing** | Code signing del instalador `.exe`. Pasos: crear Trusted Signing Account → Certificate Profile (Public Trust, 1-3 días hábiles) → App Registration → 5 env vars → configurar electron-builder + GitHub Actions |

---

### 🟡 Infraestructura técnica (pueden hacerse ahora)

| # | Tarea | Detalle | Urgencia |
|---|---|---|---|
| **D1** | **GRANT DEFAULT PRIVILEGES DB** | `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO procurador_user;` — evita grants manuales en futuras migraciones | Baja |
| ~~**D2**~~ | ~~**SSL api.procuradortool.com**~~ | ✅ Verificado (2026-07-04): `certbot.timer` renovó solo, ahora vence **2026-08-28**. Sin acción pendiente | — |
| **D3** | **`npm audit fix` (sin --force)** | Backend + Electron tienen deps con CVEs (backend: 7 high · electron: 1 critical en dev/build + 5 high). Correr `npm audit fix` en staging → probar → prod. Detalle en revisión integral §2 | Media |
| **D4** | **`npm audit fix --force` controlado** | Deps con breaking changes (mercadopago/uuid, axios, undici). Probar flujo de pagos completo en staging después de actualizar. Pre-lanzamiento público | Baja |
| **D5** | **Limpiar temporales del repo** | Borrar `backend-server/test_legal_tmp.js`, `test_legal_full_tmp.js`, `seed_legal_tmp.js` (código muerto del seed legal) | Baja |
| ~~**D6**~~ | ~~**Carpeta de descargas por usuario (CUIT)**~~ | ✅ **Hecho (2026-06-30, release v2.7.30).** Descargas aisladas en `usuarios\<CUIT>\descargas\` vía env var `PROCURADOR_DATA_DIR` (helper `getUserDataDir(cuit)` en `main.js` + prioridad en `getDataPath()` de los 6 scripts, re-encriptados). Retrocompatible, sin cambios de DB. Validado E2E con CUIT 27320694359. Commits `c4ec0ac`/`d2f8a3b`/`87c7112`. Plan: `docs/internal/plan-descargas-por-usuario.md` | — |

---

### 🟠 Staging y Rollback (prerequisito antes del análisis de seguridad)

| # | Tarea | Detalle |
|---|---|---|
| **ST-1** | **Entorno staging** | Segunda instancia del backend (mismo servidor, puerto 3444, PM2 proceso `procurador-staging`) apuntando a DB `procurador_db_staging`. Nginx: `staging-api.procuradortool.com` |
| **ST-2** | **Mecanismo de rollback definido** | Documentar y validar el proceso: (1) git tags por release `v*` en producción, (2) `pm2 rollback procurador-api` para rollback de proceso, (3) scripts de migración DB reversibles (`migrations/XXX_rollback.sql`), (4) checklist de validación post-deploy |
| **ST-3** | **Aprobación del procedimiento** | Ejecutar un rollback de prueba completo en staging antes de usar en producción |

---

### 🔵 Seguridad pre-comercialización

> Revisión de seguridad interna realizada el 2026-05-30 (`docs/internal/informe-seguridad.md`).
> Resultado: base sólida, sin vulnerabilidades críticas ni inyección SQL. Apto para Beta.
> Hallazgos correctivos abajo. SEC-1 (auditoría externa) sigue recomendado antes del público.

| # | Tarea | Prioridad | Detalle |
|---|---|---|---|
| ~~**M-1**~~ | ~~`authenticateAdmin` no chequea blacklist~~ | ✅ Resuelto (01/06) | Chequeo `isBlacklisted()` agregado en `routes/admin.js`. Validado E2E: logout admin → token 403 inmediato. Commit `58b3163` |
| ~~**M-2**~~ | ~~Firma webhook no timing-safe~~ | ✅ Resuelto (01/06) | `crypto.timingSafeEqual` en `routes/webhooks.js` (con guarda de longitud). Validado en producción. Commit `58b3163` |
| ~~**B-1,B-3,B-4,B-6,B-8**~~ | ~~Grupo seguro de robustez~~ | ✅ Resuelto (01/06) | JWT_SECRET validado al arrancar · bcrypt 10→12 · log webhook sin firma · TLS min 1.2 · BOM eliminado. Commit `da1eec6` |
| ~~**B-7**~~ | ~~IP real tras Cloudflare~~ | ✅ Verificado | La API no pasa por Cloudflare; `trust proxy` ya correcto. Sin cambios |
| ~~**B-2**~~ | ~~Política de contraseñas~~ | ✅ Resuelto (01/06) | `utils/passwordPolicy.js` (Opción A): 8+ chars, letra+número, no común, no = email. UX con requisitos visibles. Commit `548f0e8` |
| ~~**B-5**~~ | ~~Activar CSP en Helmet~~ | ✅ Resuelto (01/06) | CSP activa. Probado en staging (onclick/estilos inline OK, 0 violaciones) → producción. Commit `f034bae`. Tradeoff: `'unsafe-inline'` por handlers/estilos inline |
| **SEC-1** | **Auditoría de seguridad** | — | 📄 **Plan ejecutable autónomo:** `docs/internal/plan-seguridad-precomercializacion-2026-07.md` (Parte A) — 7 bloques de pruebas white+black-box contra staging (deps, auth/sesión, autorización/IDOR, inyección, config/transporte, lógica de negocio, integridad del cliente) con entregable de informe de hallazgos. La externa profesional sigue recomendada antes del público (este plan la reduce a confirmación, no descubrimiento) |
| **SEC-2** | **Smoke tests CI + verificación diaria real** | — | 📄 **Plan:** `docs/internal/plan-seguridad-precomercializacion-2026-07.md` (Parte B). B.1 = workflow GitHub Actions (`smoke-test-pjn.js` API + `dev-tools/smoke-payments.js` + `npm audit`) en cada push. B.2 = **verificación diaria real** (procuración+informe reales con CUIT 27320694359, credenciales en Windows Credential Manager, disparador al encender/manual/horario, panel de config en la app, aporta fecha+estado a Diagnóstico + alerta no bloqueante >7 días). B.2 requiere release Electron |
| **SEC-3** | **Hardening de secretos** | — | ✅ Verificado: ningún secreto hardcodeado, `.env`/keys/certs correctamente en `.gitignore` |
| **SEC-4** | **Enforcement server-side del trial** | Pre-lanzamiento | 📄 **Plan:** `docs/internal/plan-seguridad-precomercializacion-2026-07.md` (Parte C). `middleware/checkLicense.js` es código muerto (no montado). El freno del trial agotado es el pre-check del cliente Electron + gates de la extensión; un cliente adulterado podría ejecutar más allá de 20. Fix: mover el chequeo de cuota a `/license/execution/start` (toda ejecución pasa por ahí), espejando el enforcement de `log-execution`. Solo backend, sin release. Detectado 2026-06-12 |

---

### ⚪ Diferidos al lanzamiento público

| # | Tarea | Detalle |
|---|---|---|
| **L1** | **Activar planes BASIC/PRO/ENTERPRISE** | `UPDATE plans SET active=true WHERE name IN ('BASIC','PRO','ENTERPRISE')` — solo cuando estén los precios y el cobro funcionando |
| **L2** | **Base de Conocimiento IA** | Alimentar el asistente con 20-30 tickets reales cerrados para mejorar respuestas |
| ~~**L3**~~ | ~~**Actualizar imágenes Chrome Web Store**~~ | ✅ Hecho (2026-06-10): imágenes del listing actualizadas junto con la subida de la v1.3.4 |

---

### SSL api.procuradortool.com
`certbot.timer` activo — renueva automáticamente 2×/día cuando faltan ≤30 días. Vence **2026-08-28** (verificado 2026-07-04, renovó solo desde el vencimiento anterior sin intervención).

---

## ¿Qué es Procurador SCW?

**Procurador SCW** es una plataforma SaaS de automatización judicial para Argentina. Está dirigida exclusivamente a profesionales del derecho (abogados, procuradores) que cuentan con **credenciales propias en el sistema del Poder Judicial de la Nación (PJN)**.

El producto tiene dos componentes de acceso:

### App Electron (cliente desktop)
Automatiza tres operaciones sobre el PJN:
1. **Procuración de expedientes** — accede automáticamente a los expedientes del usuario en el portal SCW del PJN y realiza la procuración.
2. **Generación de informes** — genera informes de estado de expedientes judiciales radicados en el PJN.
3. **Monitor de partes** — controla periódicamente si aparecieron nuevos expedientes vinculados a una parte determinada.

Usa **Puppeteer** con el **Chrome del usuario** (no Chromium empaquetado) y el **gestor de contraseñas de Chrome** para las credenciales del PJN. Las contraseñas del PJN **nunca pasan por los servidores de Procurador**.

### Extensión Chrome (acelerador de data-entry)
Automatiza la **carga del número de expediente** (jurisdicción, número y año) en los módulos del PJN para evitar la escritura manual. Cubre 5 flujos:
- **Consulta SCW** → scw.pjn.gov.ar
- **Escritos 1** → scw.pjn.gov.ar (presentar escrito desde expediente)
- **Escritos 2** → escritos.pjn.gov.ar
- **Notificaciones** → notif.pjn.gov.ar
- **DEOX** → deox.pjn.gov.ar

Distribuida en la **Chrome Web Store** (aprobada por Google):
`https://chromewebstore.google.com/detail/aodnfemklhciagaglpggnclmbdhnhbme`

---

## Mapa de componentes

> Snapshot al 2026-05-22. Para encontrar el "último archivo tocado" usar:
> ```bash
> git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" log --name-only --pretty=format: -20 | sort -u
> # o por carpeta:
> ls -lt electron-app/ | head
> ```

```
ProcuradorTool/
├── CLAUDE.md                              ← este archivo (guía maestra)
├── .gitignore
├── procurador_db_backup.sql               ← backup histórico (no usar, ver Desktop/ProcuradorBackups)
│
├── electron-app/                          ← cliente desktop (Electron 28)
│   ├── main.js                            (~108 KB) proceso principal + IPC handlers
│   ├── preload.js                         puente seguro Main ↔ Renderer
│   ├── renderer.js                        (~166 KB) UI dashboard — PENDIENTE refactor a módulos ES6
│   ├── index.html                         shell del dashboard
│   ├── styles.css                         (~45 KB) sistema de diseño aplicado
│   ├── package.json                       v2.7.14
│   ├── Monitor-Procurador.ps1             watchdog Windows (legacy)
│   ├── visorModal_template.html           plantilla visor de expediente
│   ├── renderer/                          ventanas auxiliares
│   │   ├── login.html / login.js / login.css
│   │   └── app.html
│   ├── onboarding/                        flujo de primer uso
│   │   ├── onboarding.html / .js / .css
│   │   ├── preload-onboarding.js
│   │   └── tour.js                        tour guiado paso a paso
│   ├── informe/                           generación de informes Excel + visor
│   │   ├── generador_excel.js
│   │   ├── generador_visor.js
│   │   └── visor_informes_template.html
│   ├── src/
│   │   ├── api/backendClient.js           wrapper Axios a /client/* /license/*
│   │   ├── auth/
│   │   │   ├── authManager.js             login, JWT, persistencia sesión
│   │   │   └── machineId.js               hardware ID (binding dispositivo)
│   │   ├── browser/windowManager.js       gestión Chrome+perfil
│   │   ├── scripts/
│   │   │   ├── scriptExecutor.js          orquesta Puppeteer (descarga, descifra, corre)
│   │   │   ├── scriptCache.js             caché local
│   │   │   ├── abrirNavegadorPJN.js       inline: abre Chrome → SCW
│   │   │   └── agregarPasswordSCW.js      inline: inyecta credenciales del gestor Chrome
│   │   ├── security/                      ⛔ NO TOCAR
│   │   │   ├── fileEncryption.js          AES-256-CBC
│   │   │   ├── scriptVerifier.js          verifica firma RSA-2048
│   │   │   ├── scriptAutoDestruct.js      borra script al terminar
│   │   │   ├── secureTempFolder.js        carpeta temporal aislada
│   │   │   ├── codeObfuscator.js
│   │   │   └── public.pem                 clave pública para verificar firmas
│   │   ├── notifications/notificationManager.js   toast Windows
│   │   ├── telemetry/
│   │   │   ├── securityAudit.js
│   │   │   └── securityMetrics.js
│   │   └── preCalentarChrome.js           warm-up del perfil Chrome
│   ├── build/installer.nsh                config instalador NSIS
│   ├── assets/icon.ico + icon.png         ícono runtime (incluido en asar)
│   ├── scripts/cleanup-dist.js            limpieza pre-build
│   ├── scripts/generate-icon.js           genera ICO multi-res desde emoji ⚖️ (Puppeteer)
│   ├── scripts/afterPack.js               hook post-build: embebe ícono en .exe via rcedit
│   ├── demo-visores/                      ejemplos de visor (no se distribuye)
│   ├── dist/                              salida de electron-builder (gitignored)
│   └── node_modules/                      (gitignored)
│
├── backend-server/                        ← API Express 5 + PostgreSQL 14
│   ├── server.js                          (~32 KB) entry point, middlewares, cron
│   ├── package.json
│   ├── ecosystem.config.js                config PM2
│   ├── .env / .env.example                secretos (JWT, DB, ANTHROPIC_API_KEY, etc.)
│   ├── extension-meta.json                metadata versión extensión (legacy CRX)
│   ├── routes/
│   │   ├── auth.js                        login, registro, refresh, extension-login, portal-login, resend-verification
│   │   ├── client.js                      heartbeat, scripts, account, notifications, IA chat, download/electron
│   │   ├── license.js                     lock ejecución (start/heartbeat/end)
│   │   ├── monitor.js                     CRUD partes + novedades
│   │   ├── admin.js                       panel admin
│   │   ├── tickets.js                     soporte (IA priority, visibility)
│   │   ├── extension.js                   ⚠️ DEPRECADO (CRX) — pendiente eliminar
│   │   ├── scripts.js                     gestión de scripts cifrados
│   │   ├── users.js / usuarios.js         portal usuarios + API SSO
│   │   ├── analytics.js                   métricas
│   │   └── legal.js                       T&C, privacidad, aceptación
│   ├── middleware/
│   │   ├── authenticateToken.js
│   │   ├── checkLicense.js                cuotas + estado suscripción
│   │   ├── rateLimiter.js
│   │   └── tokenBlacklist.js
│   ├── utils/
│   │   ├── scriptEncryption.js            ⛔ NO TOCAR (AES + firma RSA server-side)
│   │   ├── mailer.js                      emails transaccionales (Nodemailer)
│   │   ├── cacheManager.js
│   │   └── logger.js                      Winston
│   ├── src/security/
│   │   ├── scriptSigner.js                ⛔ firma RSA-2048
│   │   ├── scriptVerifier.js
│   │   └── signatureCache.js
│   ├── public/                            servido por Express (estáticos)
│   │   ├── landing/                       procuradortool.com (Nginx sirve este)
│   │   │   ├── index.html
│   │   │   ├── terminos.html
│   │   │   └── privacidad.html
│   │   ├── usuarios/                      portal web autoservicio (SSO desde Electron)
│   │   │   ├── index.html / app.js / app.css
│   │   ├── dashboard/                     panel admin
│   │   │   ├── index.html / dashboard.js / dashboard.css
│   │   ├── register/                      registro público
│   │   ├── legal/accept                   aceptación T&C
│   │   ├── terminos/ · privacidad/        copias servidas vía rutas
│   │   └── extension/                     ⚠️ DEPRECADO (descargas CRX)
│   ├── scripts/                           scripts Puppeteer cifrados (se distribuyen al Electron)
│   │   ├── consultarscwpjn.js · listarSCWPJN.js · informequickscwpjn.js
│   │   ├── buscarPorParteScwpjn.js · validarCampoParteScwpjn.js
│   │   ├── monitoreo.js · procesarMonitoreo.js · procesarNovedadesCompleto.js
│   │   ├── procesarCustomExpedientes.js · cerrarNavegador.js
│   │   ├── sessionManager.js · errorHandler.js
│   │   ├── backup-db.js · data-retention.js · canary-test.js
│   │   ├── testM1.js · testM2.js · test_registro.js
│   │   ├── insert_plans.sql
│   │   └── validacion_campo_parte.json
│   ├── database/init.sql · migrations/    bootstrap DB
│   ├── setup/createTestUser.js
│   ├── test/                              tests internos
│   ├── generate-keys.js                   genera par RSA (uso one-shot)
│   ├── create-admin.js · list_users.js · assign_cuit.js · migrate_cuit.js
│   ├── reencrypt_scripts.js               re-cifrar todos los scripts tras rotación de clave
│   ├── seed_legal_tmp.js · test_legal_tmp.js · test_legal_full_tmp.js   (temporales)
│   └── keys/                              ⛔ claves RSA privadas (gitignored)
│
├── extension-app/                         ← extensión Chrome MV3 (Chrome Web Store)
│   ├── manifest.json                      v1.3.5
│   ├── background.js                      service worker
│   ├── popup.html · popup.js              UI principal
│   ├── auth.js                            login + FLOW_ALIASES
│   ├── config.js                          URL backend, versión
│   ├── cs-scw.js                          content script scw.pjn.gov.ar
│   ├── cs-escritos2.js                    escritos.pjn.gov.ar
│   ├── cs-notif.js                        notif.pjn.gov.ar
│   ├── cs-deox.js                         deox.pjn.gov.ar
│   ├── cs-selection.js                    sin uso activo (vestigio)
│   ├── icon16.png · icon48.png · icon128.png
│   └── imagenes/                          assets para store (EXCLUIR del ZIP)
│
├── database/                              ← snapshots y migraciones del esquema
│   ├── schema.sql                         schema actual de producción (pg_dump --schema-only)
│   ├── backup_fase4_inicio.sql            backup pre-Fase 4
│   ├── backup_pre_v2.1.sql                (untracked)
│   └── migrations/
│       ├── 001_flujo_usuario_v2.1.sql
│       ├── 001_registration_gaps.sql
│       ├── 20260522_add_comment_visibility_and_ai_logs.sql
│       └── 20260522_add_ticket_priority_source.sql
│
├── docs/
│   ├── manual-de-usuario.md               guía pública del usuario final
│   └── internal/                          documentación interna
│       ├── proximos-pasos.md              ⭐ handoff de continuidad (leer post-/clear)
│       ├── sistema-estados-flujos.md      flujos técnicos (IA, email, IPC, deploy)
│       ├── plan-pruebas-app-electron.md   plan de prueba app Electron (test integral + prompt)
│       ├── mejoras-futuras.md             ideas diferidas (KB, borradores masivos)
│       └── rollback-fase4.md              procedimientos de restore Fase 4
│
├── tests/                                 ← QA pytest + Playwright
│   ├── README.md · QA_RESULTS.md          (159/165 PASS)
│   ├── conftest.py · pytest.ini · requirements.txt · run_tests.py
│   ├── api/                               tests API REST
│   ├── desktop/                           tests Electron (Playwright)
│   ├── web/                               tests portal web
│   ├── helpers/                           fixtures compartidas
│   ├── tests/                             suite principal
│   ├── test_m14_cron.sh · test_m14_cron.sql
│   └── *.png                              screenshots de referencia
│
└── .claude/                               ← worktrees + plans + memoria local (gitignored)
    ├── worktrees/                         worktrees activos
    └── plans/                              planes guardados (cozy-cuddling-badger.md, etc.)
```

### Archivos top-level "no esperados" (revisar antes de borrar)
- `procurador_db_backup.sql` en la raíz — backup histórico, no es la fuente actual
- `backend-server/seed_legal_tmp.js`, `test_legal_tmp.js`, `test_legal_full_tmp.js` — temporales del seed legal, candidatos a limpieza
- `backend-server/routes/extension.js` + `backend-server/public/extension/` — distribución CRX deprecada (Bloque 1.2)
- `electron-app/Monitor-Procurador.ps1` — watchdog Windows legacy, ver si sigue usándose

### Atajos rápidos para localizar archivos
```bash
# Último archivo modificado por carpeta
ls -lt electron-app/src/scripts/ | head
ls -lt backend-server/routes/ | head

# Buscar por nombre
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" ls-files | grep -i <fragmento>

# Archivos cambiados en el último commit
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" show --name-only --pretty=format: HEAD

# Archivos cambiados desde un tag
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" diff --name-only fase4-completa..HEAD
```

> **Nota sobre extensiones:** `extension-app/` es la **única** versión activa (la que se publica en Chrome Web Store).
> El directorio antiguo `extension-app` de desarrollo (con URLs de localhost para pruebas) permanece en `NodejsConsoleApp1/` como backup histórico — no se usa más.
> **Regla de desarrollo:** todos los cambios se hacen directamente en `ProcuradorTool/extension-app/` y desde ahí se genera el ZIP para el store (excluyendo la carpeta `imagenes/`).

---

## Stack tecnológico por componente

| Componente | Lenguaje | Framework | Base de datos | Librerías clave |
|---|---|---|---|---|
| **electron-app** | JavaScript | Electron 28 | — (caché local) | puppeteer, exceljs, axios, electron-updater |
| **backend-server** | JavaScript | Express 5 | PostgreSQL 14 | jsonwebtoken, bcrypt, helmet, winston, nodemailer |
| **extension-app** | JavaScript | MV3 (Chrome) | chrome.storage | vanilla JS, sin build tool |

---

## Servicios y cuentas asociadas al proyecto

| Proveedor | Para qué | Cuenta / Usuario |
|---|---|---|
| **DigitalOcean** | VPS servidor producción (142.93.64.94) | — |
| **Cloudflare** | CDN + WAF + SSL para procuradortool.com (landing) | — |
| **GitHub** | Repositorio privado + GitHub Releases (distribución instalador) | jberger19186@gmail.com |
| **Brevo** (ex Sendinblue) | SMTP transaccional — emails que salen con @procuradortool.com | jberger19186@gmail.com |
| **Chrome Web Store** | Distribución extensión Chrome (store: v1.3.4 ✅ · v1.3.5 ⏳ en revisión de Google) | jberger19186@gmail.com / Publisher: Jonathan Berger |
| **Anthropic** | API de Claude Haiku para el chat IA del Asistente — ✅ activa en producción | console.anthropic.com |
| **Let's Encrypt / certbot** | SSL gratuito para api.procuradortool.com — renovación automática cada 90 días (vence 2026-08-28, verificado 2026-07-04) | sin cuenta — corre en el servidor |
| **Azure Trusted Signing** | Code Signing del instalador .exe — ⬜ pendiente contratar | — |
| **MercadoPago / Stripe** | Pagos y suscripciones recurrentes — ⬜ pendiente integrar | — |

### Emails del proyecto

| Email | Rol |
|---|---|
| `jberger19186@gmail.com` | Cuenta personal — GitHub, Chrome Web Store, Brevo |
| `procuradortool@gmail.com` | Recibe alertas de nuevos usuarios registrados (`ALERT_EMAIL_TO`) |
| `soporte@procuradortool.com` | Remitente de todos los emails transaccionales al usuario (`SMTP_FROM`) |

### Verificar / renovar SSL (certbot)
```bash
# Ver estado del certificado
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "certbot certificates"

# Renovar manualmente si hace falta
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "certbot renew"
```

---

## 📐 Operación — Staging y Rollback (documentos maestros)

### Coordenadas de los entornos (datos estables)

| | Producción | Staging |
|---|---|---|
| **URL pública** | `api.procuradortool.com` | `staging-api.procuradortool.com` |
| **Puerto HTTPS** | 3443 | 3444 |
| **Puerto HTTP** | 3000 (redirige) | 3001 |
| **Base de datos** | `procurador_db` | `procurador_db_staging` |
| **Proceso PM2** | `procurador-api` (cluster) | `procurador-staging` (fork) |
| **Directorio código** | `/var/www/procurador/backend-server` | `/var/www/procurador-staging/backend-server` |
| **Archivo entorno** | `.env` | `.env.staging` (overrides + MP sandbox fijo) |
| **Acceso** | público | basic auth — usuario `equipo`, `/etc/nginx/.htpasswd-staging` |
| **MercadoPago** | sandbox (real al activar B3) | **sandbox fijo** (nunca real) |
| **SSL** | certbot (vence 2026-08-28) | certbot (vence 2026-08-31) |

> **Backups:** diario automático 03:00 → DO Spaces (30d) + local `/var/backups/procurador/`. On-demand pre-deploy: `ops/backup-now.sh`. Restauración: `ops/restore-db.sh`.
> **Scripts ops en el servidor:** `/var/www/procurador/ops/` (`backup-now.sh`, `restore-db.sh`, `drill-rollback.sh`, `drill-code-rollback.sh`).

### Documentos de detalle

| Documento | Para qué |
|---|---|
| **`docs/internal/flujo-staging-rollback.md`** | **Visión general** (entrada): cómo se prueba y revierte cada componente (backend + Electron) |
| **`docs/internal/runbook-comandos.md`** | **Comandos exactos** (copiar/pegar): backups, deploys, rollbacks y simulacros |
| `docs/internal/plan-implementacion-staging.md` | Detalle del staging del backend (4 fases) |
| `docs/internal/flujo-release-electron.md` | Detalle del release/rollback de la app Electron |
| `ops/README.md` | Referencia de los scripts operativos (`backup-now.sh`, `restore-db.sh`, drills) |

**Resumen operativo:**
- **Backend:** desarrollar → probar en `staging-api.procuradortool.com` → backup pre-deploy → producción → rollback de 3 capas si falla.
- **Electron:** desarrollar → probar local (`npm start`) → publicar Release → fix-forward si falla.

---

## Checklist al publicar nueva versión Electron

> Flujo completo (probar local, fix-forward, rollback, archivo de versiones): `docs/internal/flujo-release-electron.md`.

Cuando se genera y publica una nueva release de la app Electron, hacer estos pasos **en orden**:

0. **Probar la versión sin instalar:** `npm start` (corre desde el código) y/o `npm run build:dir` (build real sin instalador). No publicar sin probar.
1. Bumping de versión en `electron-app/package.json` (`"version"` + `"build.buildVersion"` si existe)
2. **`git tag electron-vX.Y.Z` + push del tag** (fija el código fuente de esta versión, necesario para rollback / fix-forward)
3. `npm run release` en `electron-app/` → genera instalador y lo sube a GitHub Releases
4. **Actualizar en `backend-server/public/usuarios/app.js`**: la línea de versión en `download-item-desc` (ej: `v2.7.14`)
   *(el link de descarga es dinámico via `/client/download/electron` → no necesita actualización)*
5. Deploy `app.js` al servidor + `pm2 restart procurador-api`
6. Hacer commit + push

> **Rollback de la app:** estrategia **fix-forward** — re-publicar el código bueno con una versión mayor nueva (el auto-updater no degrada). Detalle en `docs/internal/flujo-release-electron.md` §5.
> **Backup de versiones:** automático — GitHub Releases conserva cada `.exe` publicado + el git tag conserva el código fuente.

> **Nota sobre el link de descarga**: el portal usa `https://api.procuradortool.com/client/download/electron`
> que consulta la GitHub API en tiempo real y redirige al `.exe` del último release.
> Solo hay que actualizar el texto de versión visible (ej: `v2.7.14`), no la URL.

---

## Acceso al servidor de producción

```bash
# SSH
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94

# SCP (subir archivo)
scp -i C:/Users/JONATHAN/.ssh/do_procurador <archivo_local> root@142.93.64.94:<ruta_remota>
```

| Variable | Valor |
|---|---|
| IP servidor | `142.93.64.94` (usar IP, el dominio puede no resolver) |
| Clave SSH | `C:\Users\JONATHAN\.ssh\do_procurador` |
| Ruta proyecto | `/var/www/procurador/` |
| Proceso PM2 | `procurador-api` |
| Reiniciar API | `pm2 restart procurador-api` |
| Base de datos | `procurador_db` (usuario: `procurador_user`) |

### Nginx — sitios activos
- **`api.procuradortool.com`** → `/etc/nginx/sites-available/procurador` → proxy a Express en `https://localhost:3443` — SSL con certbot (vence 2026-08-28)
- **`procuradortool.com`** → `/etc/nginx/sites-available/procuradortool` → sirve landing estática — SSL vía Cloudflare

### Release de la app Electron

```powershell
# Desde PowerShell, en la carpeta electron-app:
# 1. Bumpar version en package.json (ej: 2.4.14 → 2.4.15)
# 2. Ejecutar:
$env:GH_TOKEN="<token_github>"; Set-Location "C:\Users\JONATHAN\source\repos\ProcuradorTool\electron-app"; npm run release
```

- El token de GitHub está en Windows Credential Manager. Si hay que regenerarlo: https://github.com/settings/tokens (permisos: `repo` + `workflow`)
- El release se publica automáticamente en: https://github.com/jberger19186/procurador-tool/releases
- Los usuarios con la app instalada reciben la actualización vía `electron-updater`

### Deploy landing page
```bash
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" \
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/public/landing/index.html" \
  root@142.93.64.94:/var/www/procurador/backend-server/public/landing/index.html
```

### Actualizar scripts de automatización (re-encriptar y subir)

Cuando se modifica un archivo en `backend-server/scripts/` (ej: `buscarPorParteScwpjn.js`):

```bash
# 1. Subir el archivo modificado al servidor
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" \
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/scripts/<nombre>.js" \
  root@142.93.64.94:/var/www/procurador/backend-server/scripts/<nombre>.js

# 2. Re-encriptar (lee los .js de /scripts/, los cifra con AES-256 + RSA y los guarda en la BD)
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "cd /var/www/procurador/backend-server && node reencrypt_scripts.js"

# 3. Reiniciar API
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "pm2 restart procurador-api"
```

> **Nota:** los scripts corren en el cliente (Electron), pero se descargan cifrados desde el servidor.
> El archivo fuente local (en `backend-server/scripts/`) es solo referencia — lo que importa es lo que queda en la BD después del reencrypt.

### Reset de datos de prueba
Script: `backend-server/dev-tools/reset-test-data.sql`

Borra todos los datos transaccionales (pagos, facturas, tickets, logs, eventos, notificaciones, webhook_events, monitor) y los usuarios de prueba, **conservando** los admins (id 6, 7) y `procuradortool@gmail.com` (id 19). Resetea las suscripciones de los conservados a estado inicial.

⚠️ **Siempre hacer backup antes** (queda en `/tmp/backup_pre_reset_<fecha>.sql` en el servidor):
```powershell
$f = Get-Date -Format "yyyyMMdd_HHmmss"
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "sudo -u postgres pg_dump procurador_db > /tmp/backup_pre_reset_$f.sql"
# Ejecutar el reset (ON_ERROR_STOP aborta si algo falla — es transaccional):
Get-Content "backend-server/dev-tools/reset-test-data.sql" | ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "sudo -u postgres psql procurador_db -v ON_ERROR_STOP=1"
```
> Si cambian los IDs de usuarios a conservar, editar las listas `IN (...)` del script. Último reset: 2026-05-29 (backup `backup_pre_reset_20260529_154533.sql`).

### Reset de la app Electron (onboarding / datos de usuario)

> **Contexto importante:** la app se ejecuta desde el código fuente (`npm start` en `electron-app/`), **no está instalada como ejecutable en el sistema** (no hay entrada en el registro de Windows ni desinstalador NSIS). Los datos de usuario viven en tres carpetas de AppData.

**Directorios de datos de la app:**
| Carpeta | Contenido |
|---|---|
| `%LOCALAPPDATA%\procurador-electron-updater` | `onboarding_complete.json`, `psc_accounts.enc`, `config_proceso.json`, perfil Chrome dedicado (`ChromeProfile/`), caché, logs, updater |
| `%APPDATA%\procurador-electron` | datos Roaming de Electron |
| `%LOCALAPPDATA%\ProcuradorSCW` | caché local de la app |

#### Opción A — Solo resetear el onboarding (más rápido)
Conserva la sesión activa y todos los demás datos. Solo borra el flag de onboarding completado:
```powershell
Remove-Item "$env:LOCALAPPDATA\procurador-electron-updater\onboarding_complete.json" -Force
```
Al abrir la app arranca el onboarding, con la sesión ya iniciada.

#### Opción B — Reset completo de datos (sin reinstalar)
Borra sesión, caché, accounts, perfil Chrome dedicado y onboarding. La app queda como la primera vez que se abrió:
```powershell
Remove-Item "$env:LOCALAPPDATA\procurador-electron-updater" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\procurador-electron"              -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\ProcuradorSCW"               -Recurse -Force -ErrorAction SilentlyContinue
```
Al abrir la app: login → onboarding desde cero.

#### Opción C — Reset total (equivale a primera instalación)
Como la app corre desde el repo (no instalada), "reinstalar" = borrar datos + volver a `npm start`:
```powershell
# 1. Borrar todos los datos
Remove-Item "$env:LOCALAPPDATA\procurador-electron-updater" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\procurador-electron"              -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\ProcuradorSCW"               -Recurse -Force -ErrorAction SilentlyContinue

# 2. "Reinstalar" = correr la app de nuevo
cd C:\Users\JONATHAN\source\repos\ProcuradorTool\electron-app
npm start
```
Si en el futuro la app se distribuye como instalador `.exe` (NSIS), agregar como paso 0:
```powershell
# Solo si hay instalador en el sistema:
& "$env:LOCALAPPDATA\Programs\Procurador SCW\Uninstall Procurador SCW.exe" /S
```

### Backup completo del proyecto
Cuando el usuario pide un backup, crear una carpeta en el escritorio con el formato:
`YYYYMM_DDMMYYYY_ProcuradorTool`
Ejemplo para el 29 de abril de 2026 → `202604_29042026_ProcuradorTool`

Pasos a ejecutar en orden:

```powershell
# 1. Crear carpeta con nombre dinámico
$fecha = Get-Date
$carpeta = "C:\Users\JONATHAN\Desktop\$($fecha.ToString('yyyyMM'))_$($fecha.ToString('ddMMyyyy'))_ProcuradorTool"
New-Item -ItemType Directory -Path $carpeta -Force

# 2. Base de datos PostgreSQL
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "sudo -u postgres pg_dump procurador_db" > "$carpeta\procurador_db_backup.sql"

# 3. Variables de entorno (.env)
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94:/var/www/procurador/backend-server/.env "$carpeta\env_backend.txt"

# 4. Claves RSA
New-Item -ItemType Directory -Path "$carpeta\keys" -Force
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" -r "root@142.93.64.94:/var/www/procurador/backend-server/keys/" "$carpeta/keys/"

# 5. Certificados SSL
New-Item -ItemType Directory -Path "$carpeta\certs" -Force
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" -r "root@142.93.64.94:/var/www/procurador/backend-server/certs/" "$carpeta/certs/"

# 6. Código fuente (sin node_modules, dist ni .git)
$source = "C:\Users\JONATHAN\source\repos\ProcuradorTool"
$zipDest = "$carpeta\ProcuradorTool_source.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipDest, 'Create')
$files = Get-ChildItem -Path $source -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\.git\\'
}
foreach ($file in $files) {
    $entryName = $file.FullName.Substring($source.Length + 1)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName) | Out-Null
}
$zip.Dispose()
```

Contenido del backup:
| Archivo | Qué cubre |
|---|---|
| `procurador_db_backup.sql` | Base de datos completa (usuarios, suscripciones, historial) |
| `env_backend.txt` | Variables de entorno y secretos del servidor |
| `keys/` | Claves RSA privadas y públicas |
| `certs/` | Certificados SSL |
| `ProcuradorTool_source.zip` | Código fuente completo |

> ⚠️ Guardar la carpeta en lugar seguro — contiene claves privadas. No subir a lugares públicos.

### Variante: backup comprimido `.7z` → carpeta de automatización
> Mismo contenido que el backup completo (DB + env + keys + certs + código fuente), pero **comprimido en `.7z`** y **movido a OneDrive** en vez de quedar suelto en el Desktop. Usa 7-Zip (`C:\Program Files\7-Zip\7z.exe`).
> **Destino:** `C:\Users\JONATHAN\OneDrive\Documentos\z-noc files\z-automatizacion\`
> **Correr desde Git Bash** (no PowerShell: el `>` de PowerShell escribe UTF-16 y corrompe el dump; Git Bash escribe bytes limpios).

```bash
SEVENZ="/c/Program Files/7-Zip/7z.exe"; KEY="C:/Users/JONATHAN/.ssh/do_procurador"
FOLDER="/c/Users/JONATHAN/Desktop/$(date +%Y%m)_$(date +%d%m%Y)_ProcuradorTool"
DEST="/c/Users/JONATHAN/OneDrive/Documentos/z-noc files/z-automatizacion"
mkdir -p "$FOLDER/keys" "$FOLDER/certs" "$DEST"
# 1) DB
ssh -i "$KEY" root@142.93.64.94 "sudo -u postgres pg_dump procurador_db" > "$FOLDER/procurador_db_backup.sql"
# 2) env + keys + certs
scp -i "$KEY" root@142.93.64.94:/var/www/procurador/backend-server/.env "$FOLDER/env_backend.txt"
scp -i "$KEY" -r root@142.93.64.94:/var/www/procurador/backend-server/keys/.  "$FOLDER/keys/"
scp -i "$KEY" -r root@142.93.64.94:/var/www/procurador/backend-server/certs/. "$FOLDER/certs/"
# 3) código fuente → .7z (excluye node_modules/dist/.git/.claude)
"$SEVENZ" a "$FOLDER/ProcuradorTool_source.7z" "C:/Users/JONATHAN/source/repos/ProcuradorTool/*" '-xr!node_modules' '-xr!dist' '-xr!.git' '-xr!.claude' -bso0 -bsp0
# 4) comprimir la carpeta entera, borrarla y mover el .7z a automatización
"$SEVENZ" a "$FOLDER.7z" "$FOLDER" -bso0 -bsp0
rm -rf "$FOLDER" && mv "$FOLDER.7z" "$DEST/"
```
> Resultado: solo queda `<YYYYMM_DDMMYYYY>_ProcuradorTool.7z` en la carpeta de automatización (Desktop limpio).

### Backup de schema DB solamente
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres pg_dump --schema-only procurador_db" > database/schema.sql
```

---

## Flujos de comunicación

### Autenticación (Electron ↔ Backend)
```
Usuario ingresa email/password en Electron
  → POST /auth/login {email, password, machineId}
  ← JWT (2h expiry)
  → Todas las requests siguientes: Authorization: Bearer {token}
```

### Descarga y ejecución de scripts
```
AuthManager.loadAllScripts()
  → GET /client/scripts/available
  → GET /client/scripts/check/:name  (versión/hash ligero)
  → GET /client/scripts/download/:name  ← {encrypted, iv, signature}
  → Descifrar AES-256-CBC + verificar firma RSA-2048
  → ScriptExecutor.run() → Puppeteer con Chrome del usuario
  → POST /client/scripts/log-execution
```

### Candado de ejecución (anti-concurrencia)
```
POST /license/execution/start   → adquiere lock por machineId
POST /license/execution/heartbeat  (cada 30s durante ejecución)
POST /license/execution/end     → libera lock
```

### Extensión Chrome ↔ Backend
```
Autenticación: POST /auth/extension-login
Verificar flujos disponibles: canUseFlow() en auth.js (consulta la DB)
FLOW_ALIASES: { 'notif' → 'notificaciones' }  ← importante, las keys internas difieren de la DB
```

### Portal web de usuarios ↔ Backend
```
Login (permite todos los estados no terminales): POST /auth/portal-login {email, password}
  ← token (8h), emailVerified, registrationStatus
  → Bloquea solo: rejected, cancelled

Reenvío email verificación: POST /auth/resend-verification {email}
  ← Respuesta genérica siempre (anti-enumeración)

Descarga instalador: GET /client/download/electron (autenticado)
  → Consulta https://api.github.com/repos/jberger19186/procurador-tool/releases/latest
  ← 302 redirect al .exe del último release
```

### Estados de `registration_status` del usuario
```
pending_email      → email no verificado: puede logear en portal, NO en Electron/extensión
pending_activation → email verificado, esperando activación manual admin: trial activo (20 usos)
active             → cuenta activa, suscripción normal
suspended          → suspendida por admin
rejected           → rechazada (bloqueo total)
cancelled          → cancelada (bloqueo total)
```

### Navegación al portal web con auto-login (SSO)
```javascript
// renderer.js — openPortalSection(section)
// Secciones válidas: 'ia', 'soporte', 'nuevo-ticket', 'perfil', 'plan', 'facturacion', 'ayuda', null
// URL: /usuarios/?goto=<section>#sso=<token>
// El portal lee el hash #sso= → auto-login → navega a ?goto= → abre sección/modal

openPortal()           // home del portal (sin sección)
openPortalSection('ia')           // sección Asistente IA
openPortalSection('soporte')      // sección Soporte
openPortalSection('nuevo-ticket') // sección Soporte + abre modal nuevo ticket
```
Usado por: botón "Abrir chat" del Asistente IA · "Ver mis tickets" · "+ Nuevo ticket" · 🎫 del chat widget · banners de suscripción.

### IPC Electron (Main ↔ Renderer)
Toda comunicación entre el proceso principal y la UI pasa por `preload.js` (context isolation).
El renderer **nunca** accede directamente a módulos de Node.js.

---

## Endpoints críticos del backend

```
POST   /auth/login                       — Autenticación usuario
POST   /auth/register                    — Registro (redirige a /register/)
GET    /auth/plan-availability           — Planes disponibles (público)
POST   /client/verify-session            — Heartbeat de sesión
GET    /client/scripts/available         — Scripts descargables
GET    /client/scripts/check/:name       — Check versión/hash
GET    /client/scripts/download/:name    — Descarga script cifrado
POST   /client/scripts/log-execution     — Registrar ejecución
POST   /license/execution/start          — Adquirir lock
POST   /license/execution/heartbeat      — Refrescar lock
POST   /license/execution/end            — Liberar lock
POST   /auth/extension-login             — Login desde extensión Chrome
POST   /auth/portal-login               — Login desde portal web (permite pending_email, pending_activation, suspended)
POST   /auth/resend-verification        — Reenvío email verificación (público, rate limited, respuesta genérica)
GET    /client/download/electron        — Redirect dinámico al .exe del último release (autenticado)
GET    /client/notifications             — Notificaciones in-app del usuario (últimas 50)
POST   /client/notifications/:id/read    — Marcar notificación como leída (id='all' = todas)
POST   /client/ai/chat                   — Chat con asistente IA desde Electron (fallback Claude Haiku, rate limit 20/hora/usuario)
POST   /usuarios/api/ai-chat             — Chat con asistente IA desde portal web (historial conversacional, mismo rate limit)
```

### Cobranza / suscripciones (Fase 5 — requieren JWT + PAYMENT_MODULE_ENABLED)
```
POST   /usuarios/api/checkout/init        — Genera init_point MP (external_reference=user_{id} + payer_email)
POST   /usuarios/api/checkout/confirm     — Vincula preapproval tras el checkout (o marca provider si MP no devolvió ID)
POST   /usuarios/api/checkout/reactivate  — Deshace cancelación programada (quita cancel_at, reactiva preapproval en MP)
POST   /usuarios/api/checkout/cancel      — Programa cancelación al fin del período (cancel_at = next_billing_date)
GET    /usuarios/api/checkout/status      — Estado de suscripción para la UI
GET    /usuarios/api/subscription/current — Estado enriquecido (hasPaymentMethod, cancelAt, etc.)
GET    /usuarios/api/payments             — Historial de pagos del usuario
GET    /usuarios/api/invoices             — Historial de facturas del usuario (incluye invoice_type, cae)
POST   /webhooks/mercadopago              — Receptor webhooks MP (HMAC-SHA256, idempotente). Maneja payment,
                                            subscription_authorized_payment, preapproval, subscription_preapproval
```

### Facturación manual — admin (requieren JWT admin)
```
GET    /admin/invoices/pending            — Pagos aprobados sin PDF (con datos de facturación del usuario)
GET    /admin/invoices                    — Facturas emitidas (buscador por email/nombre/CUIT)
POST   /admin/invoices/:invoiceId/upload  — Sube PDF a invoice existente (multer, invoice_type, cae, numero)
POST   /admin/invoices/from-payment/:id   — Crea invoice + sube PDF para un pago sin factura
POST   /admin/invoices/manual             — Factura manual sin pago asociado (user_id, amount, issued_at, PDF)
GET    /admin/users/search                — Autocomplete de usuarios (nombre, apellido, cuit, domicilio)
```

---

## Base de datos — tablas principales

| Tabla | Propósito |
|---|---|
| `users` | Email, password hash, machine_id, role |
| `subscriptions` | Plan asignado, cuotas (usage_count / usage_limit), estado, vencimiento |
| `plans` | Tiers: EXTENSION_PROMO, COMBO_PROMO, BASIC, PRO, ENTERPRISE |
| `encrypted_scripts` | Scripts cifrados (AES-256-CBC), IV, hash SHA-256, versión |
| `active_executions` | Lock de ejecución por machineId (anti-concurrencia) |
| `usage_logs` | Historial de ejecuciones por usuario |
| `token_blacklist` | Tokens invalidados al hacer logout |
| `support_tickets` | Sistema de tickets de soporte |
| `ticket_comments` | Comentarios en tickets |
| `payments` | Pagos MP (external_payment_id, amount, status, raw_response). FK a users + subscriptions |
| `invoices` | Facturas (invoice_type, cae, numero, amount, pdf_url, status). payment_id NULL = factura manual |
| `webhook_events` | Idempotencia de webhooks MP (UNIQUE provider+external_id, processed_at) |
| `usage_extras` | Paquetes de usos extra asignados por admin |

### Sistema de cuotas por plan
```
EXTENSION_PROMO  → USD 1/mes  → 5 flujos extensión, sin cuotas app
COMBO_PROMO      → $15.000 ARS/mes → extensión + app: 50 proc · 50 inf · 20 partes · 50 nov · 20 batch
BASIC            → app: 50 proc · 10 inf · 3 partes activas
PRO              → app: 200 proc · 50 inf · 10 partes activas
ENTERPRISE       → app: ilimitado · 50 partes activas
```
**Modelo de trial — "hasta configurar el método de pago" (desde 2026-06-04):**
Al verificar el email, el usuario recibe **20 usos de prueba** (`usage_limit=20`) que rigen **mientras `payment_provider IS NULL`** (no configuró el pago), sin importar el `status`. Esos 20 usos son **compartidos por la app Electron y la extensión**:
- **App Electron:** cada ejecución suma a `usage_count`. Bloquea al llegar a 20 (`remaining<=0` en `run-process`).
- **Extensión Chrome:** habilitada con los flujos del plan, pero **atada al cupo**: mientras no haya pago, sólo funciona si `usage_count < usage_limit`. Al agotar los 20, la extensión **también se bloquea** (403). Gateado en `extension-login`, `/auth/refresh` y `/client/extension-auth`: `(payment_provider IS NOT NULL OR usage_count < usage_limit)`.
- **Activación por admin:** SOLO aprueba (`status='active'`); **no** asigna el plan ni resetea usos (sigue el trial de 20 hasta el pago).
- **Configurar método de pago** (`applyTrialBonus`): asigna los **límites del plan** (sin +20 de bienvenida), `usage_count=0`, se elimina el trial. La extensión pasa a funcionar sin tope de usos.
- Estados bloqueados (app+extensión): `pending_email`, `rejected`, `suspended_admin`, `suspended_plan_expired`, `cancelled`, y `suspended` por pago fallido.

### Arquitectura de usage_limit / usage_count
> Verificado contra el código el 2026-06-12. Flujo completo: registro → verificar email → trial 20 → activación admin (conserva usos restantes, habilita pago) → pago (límites del plan por submódulo).

| Etapa | usage_limit | Enforcement |
|---|---|---|
| `pending_email` (registrado, sin verificar) | 20 (nace con la suscripción) | Sin acceso: login Electron/extensión 403; checkout bloqueado (botón + guard) |
| `pending_activation` (email verificado, trial) | 20 | Global: `usage_count < usage_limit` — compartido entre todos los subsistemas. Checkout bloqueado |
| `active` SIN pago (activado por admin) | 20 (se conservan los usos restantes del trial) | Sigue el global de 20. Checkout HABILITADO (botón portal + guard `/checkout/init`) |
| `active` CON pago (primer pago aprobado) | 999999 (`applyTrialBonus`/`applyRenewal`) | Por subsistema: `proc_usage`, `informe_usage`, etc. El global no se enforcea |

- **Trial**: Electron bloquea cuando `remaining = usage_limit - usage_count = 0` (pre-check de `run-process`); la extensión bloquea server-side (`extension-login`/`extension-auth`). 20 usos compartidos sin distinción de subsistema.
- **Pago** (`payment_provider` seteado): `applyTrialBonus` resetea `usage_count` y TODOS los contadores por submódulo a 0 y pone `usage_limit=999999` → el global queda como contador histórico; rige el submódulo (`checkSubsystemLimit` en la app + `log-execution` 403 en backend). ⚠️ Fix 2026-06-12: antes `applyTrialBonus`/`applyRenewal` ponían `usage_limit` = límite de proc (50 en COMBO) → un pago que mezclaba módulos (ej. 45 proc + 5 inf = 50 global) quedaba bloqueado por el pre-check global con mensaje de trial, aunque tuviera submódulos disponibles.
- `usage_count` siempre se incrementa (trial y pago) — sirve como contador histórico total.
- El admin puede sobreescribir `usage_limit` manualmente desde la ficha de usuario ("Global (límite total)") o usar "🔓 Ilimitado".
- ⚠️ **`middleware/checkLicense.js` es CÓDIGO MUERTO** (no está montado en ninguna ruta — verificado 2026-06-12). El freno real del trial agotado es el pre-check de la app (cliente) + los gates de la extensión (server). La descarga de scripts y `/license/execution/start` NO chequean usos server-side → un cliente adulterado podría ejecutar más allá del trial (mitigado: scripts cifrados/firmados, la app es el único cliente). **Hardening pendiente (pre-lanzamiento):** agregar chequeo de usos del trial en `/license/execution/start` — ver pendiente SEC-4.

### Probar cuotas/límites tocando la DB (refleja en la app sin re-login)

Los endpoints que la app usa para leer usos/límites **no cachean** (consultan la DB en vivo en cada request): `/client/verify-session` (global), `/client/account` (por subsistema), `/client/batch-limits`. Por eso **cualquier cambio en la DB se refleja en la app Electron en la próxima lectura, sin reiniciar ni cerrar sesión** (el token JWT no depende de los usos).

**Cuándo re-lee la app:** al abrir **Mi Cuenta** o **Estadísticas** (`/client/account`), y al tocar **Procurar/Informe/Monitor** (`verifySession` + `checkSubsystemLimit` corren *antes* de ejecutar → permiten o bloquean según la DB del momento). Basta con reabrir la vista o disparar la acción.

**Qué columna tocar** (tabla `subscriptions`, salvo aclaración):

| Escenario | SQL |
|---|---|
| Trial — usos consumidos | `UPDATE subscriptions SET usage_count=<N> WHERE user_id=<id>;` |
| Trial — tope | `UPDATE subscriptions SET usage_limit=<N> WHERE user_id=<id>;` |
| Pago — usos de un subsistema | `UPDATE subscriptions SET proc_usage=<N> WHERE user_id=<id>;` (`proc_usage`/`batch_usage`/`informe_usage`/`monitor_novedades_usage`) |
| Pago — límite SOLO de un usuario | `UPDATE subscriptions SET proc_bonus=<N> WHERE user_id=<id>;` (se suma al límite del plan; `*_bonus`) |

> ⚠️ Los límites base (`proc_executions_limit`, `informe_limit`, `monitor_novedades_limit`, etc.) viven en la tabla **`plans`** y son **compartidos por todos los usuarios del plan**. Para tunear un solo usuario usá las columnas `*_bonus` de su `subscription`, **nunca** edites `plans` (afecta a todos).

**Mensajes esperables según el estado** (para validar visualmente):
- Trial `usage_count < usage_limit`, faltando 1–5: banner 🔴 *"Quedan pocos usos. Contactá al administrador para activar tu cuenta."*
- Trial `usage_count = usage_limit` (ej. 20/20): banner 🔴 *"Ya consumiste tus usos…"* + al ejecutar, *"Has alcanzado el límite de ejecuciones de tu plan…"* (la sesión **sigue viva**, no da "No autenticado")
- Pago con un subsistema agotado: al ejecutar ese módulo, *"Alcanzaste el límite de procuraciones/informes/… de tu plan: usados/límite"* (el trial NO ve este check — se rige por el global)

```bash
# Atajo: ver el estado actual de un usuario
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres psql procurador_db -c \"SELECT s.user_id, s.status, u.registration_status, s.payment_provider, s.usage_count, s.usage_limit, s.proc_usage, s.informe_usage FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.user_id=<id>;\""
```

### Quitar partes del Monitor de un usuario (limpiar para probar)

La app **no deja borrar una parte entre las 24 h y los 30 días** desde su creación (regla anti-abuso en `routes/monitor.js`: borrable dentro de las 24 h de gracia **o** pasados 30 días). El mensaje de error incluye la fecha exacta de habilitación. Para **pruebas** se borra directo en la DB, que **saltea esa regla** (aplica solo al endpoint).

Borrado **limpio** (las FK lo resuelven solas): `monitor_expedientes` cae por `ON DELETE CASCADE`, `monitor_consultas_log` queda en `SET NULL` (el log histórico se conserva sin huérfanos). La cuenta de partes se refleja en el límite `monitor_partes` de la app en la próxima lectura.

```bash
# Ver las partes de un usuario
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres psql procurador_db -c \"SELECT id, nombre_parte, activo, fecha_creacion FROM monitor_partes WHERE user_id=<id> ORDER BY id;\""

# Borrar UNA parte por id
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres psql procurador_db -c \"DELETE FROM monitor_partes WHERE id=<parteId> AND user_id=<id>;\""

# Borrar VARIAS por id
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres psql procurador_db -c \"DELETE FROM monitor_partes WHERE user_id=<id> AND id IN (<id1>,<id2>,<id3>);\""

# Limpiar TODAS las partes de un usuario
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres psql procurador_db -c \"DELETE FROM monitor_partes WHERE user_id=<id>;\""
```

> Alternativa sin tocar SQL: marcar `activo=false` (`UPDATE monitor_partes SET activo=false WHERE id=<parteId>;`) libera el cupo de `monitor_partes` sin borrar el historial — útil si querés conservar los expedientes ya detectados.

---

## Sistema de diseño (UI)

Aplicado tanto en la app Electron como en la landing page:
```css
--bg:          #f7f7f5   /* fondo base cálido */
--surface:     #ffffff
--amber:       #d97706   /* acento principal */
--amber-dk:    #b45309
--amber-lt:    #f59e0b
--text-1:      #1a1a1a
--text-2:      #4a4a4a
--text-3:      #8a8a8a
--font:        'Inter', system-ui
--font-serif:  'Crimson Pro', Georgia  /* headings */
--font-mono:   'Cascadia Code', Consolas
```
**Referencia de diseño:** sesión "Design professional UI for Electron app".

---

## Extensión Chrome — notas técnicas críticas

### 📦 Sistema de distribución ANTERIOR (pre Chrome Web Store) — CÓDIGO MUERTO, NO ELIMINAR

> Este sistema fue reemplazado por la Chrome Web Store (v1.3.2+).
> El código sigue en producción sin eliminar porque podría necesitarse si la extensión
> fuera removida de la store, o si se quisiera volver a distribución privada.

#### Cómo funcionaba — dos capas paralelas

**Capa 1 — CRX con auto-update (Chrome Policy)**

Chrome tiene un mecanismo nativo de auto-update para extensiones fuera de la store.
Se configuraba apuntando Chrome a una URL de actualización (`update_url`) en el manifest:

```json
// extension-app/manifest.json (versión de desarrollo, solo para distribución CRX)
"update_url": "https://api.procuradortool.com/extension/updates.xml"
```

El flujo:
```
Chrome (cada ~5hs) → GET /extension/updates.xml
  ← XML con versión actual + URL del CRX
  → si versión > local: GET /extension/latest.crx
  → Chrome instala/actualiza automáticamente
```

Archivos en el servidor:
```
backend-server/public/extension/
  ├── meta.json          ← { "id": "ID_DE_LA_EXTENSION", "version": "1.x.x", "crxFile": "extension-1.x.x.crx" }
  └── extension-1.x.x.crx  ← el CRX empaquetado con la clave privada de Chrome
```

Rutas en `server.js` (aún activas, código muerto):
- `GET /extension/updates.xml` — genera el XML de update para Chrome
- `GET /extension/latest.crx` — sirve el archivo `.crx`

**Capa 2 — ZIP descargado desde el onboarding de Electron**

Alternativa al CRX: la app Electron descargaba la extensión como ZIP desde el backend,
la extraía en disco, y el usuario la cargaba manualmente en Chrome como "extensión sin empaquetar".

Flujo en `main.js` (`downloadExtension`):
```
1. GET /api/extension/version  → obtener versión del servidor
2. Comparar con versión local en %LOCALAPPDATA%\ProcuradorSCW\extension_meta.json
3. Si hay versión nueva: GET /api/extension/download → ZIP con scripts ofuscados
4. Extraer ZIP en %LOCALAPPDATA%\ProcuradorSCW\extension\ (carpeta fija)
5. Guardar metadatos locales (version, path, downloadedAt)
```

El usuario luego iba a `chrome://extensions` → "Modo desarrollador" ON → "Cargar sin empaquetar" → seleccionaba esa carpeta.

Protecciones del ZIP (en `routes/extension.js`):
- **Ofuscación JS** con `javascript-obfuscator` (seed determinístico por versión → mismo hash siempre)
- **SHA-256** de cada script (verificados por `background.js` al arrancar)
- **ID-binding**: guardas inyectadas en cada content script
- **JWT**: todos los endpoints requieren autenticación

Scripts ofuscados: `cs-scw.js`, `cs-notif.js`, `cs-escritos2.js`, `cs-deox.js`, `cs-selection.js`
Archivos sin ofuscar: `manifest.json`, `popup.html`, `popup.js`, `config.js`, `auth.js`, `background.js`

Rutas backend activas (código muerto):
- `GET /api/extension/version` — versión actual (requiere JWT)
- `GET /api/extension/download` — ZIP ofuscado (requiere JWT)
- `GET /api/extension/electron-download?token=xxx` — descarga directa por token temporal (para Electron)

#### Cómo se configuraba en el onboarding (configuración inicial)

En el wizard de onboarding, había un paso de instalación de extensión que:
1. Llamaba al IPC `install-extension` → ejecutaba `downloadExtension(token)`
2. Mostraba la ruta de la carpeta extraída
3. Le pedía al usuario abrir `chrome://extensions`, activar modo desarrollador y cargar la carpeta

Código relevante: `main.js` handlers `install-extension` y `check-extension-version`

#### Cómo se configuraba en la configuración de la app

En la sección Configuración → Extensión de la app Electron:
- Botón "Actualizar extensión": llamaba `install-extension` → descargaba nueva versión
- Botón "Verificar versión": llamaba `check-extension-version` → comparaba local vs servidor
- Si había nueva versión: mostraba alerta con instrucciones para recargar en Chrome

#### Para reactivar el sistema viejo

Si hubiera que volver a este sistema:
1. **Generar CRX**: desde `chrome://extensions` en modo developer → "Pack extension" con la clave privada
2. **Subir al servidor**:
   ```bash
   scp -i "C:/Users/JONATHAN/.ssh/do_procurador" extension-1.x.x.crx root@142.93.64.94:/var/www/procurador/backend-server/public/extension/
   # Actualizar meta.json en el servidor con nueva versión y nombre de archivo
   ```
3. **Agregar `update_url` al manifest** de la extensión (la versión de dev, no la de la store)
4. **Configurar Chrome** para aceptar extensiones de URLs externas (requiere Group Policy en Windows o flag de Chrome)

> ⚠️ Nota: desde Chrome 33+, las extensiones CRX externas a la store **solo se pueden instalar
> con Group Policy** en Windows o editando políticas en macOS/Linux. Los usuarios normales
> no pueden instalar CRX de terceros sin esa configuración — por eso se migró a la store.

---

### Versión en store: 1.3.4 ✅ · v1.3.5 subida 2026-06-10, ⏳ en revisión de Google · Versión local: 1.3.5 (link al portal en errores de suscripción)
### Cuenta del store: jberger19186@gmail.com / Publisher: Jonathan Berger

### Permisos (sin `tabs`, sin `content_scripts *://*/*`)
```json
"permissions": ["scripting", "activeTab", "storage", "contextMenus", "alarms"],
"host_permissions": ["https://scw.pjn.gov.ar/*", "https://sso.pjn.gov.ar/*",
  "https://escritos.pjn.gov.ar/*", "https://notif.pjn.gov.ar/*",
  "https://deox.pjn.gov.ar/*", "https://api.procuradortool.com/*"]
```

### FLOW_ALIASES — crítico
```javascript
const FLOW_ALIASES = { 'notif': 'notificaciones' };
// 'notif' es la key interna; 'notificaciones' es como está en la DB
```

### Generar ZIP para el store
```powershell
$source = Resolve-Path 'extension-app'
$dest   = (Resolve-Path '.').Path + '\pjn-extension-X.X.X.zip'
$files  = Get-ChildItem -Path $source -Recurse -File | Where-Object { $_.FullName -notmatch 'imagenes' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($dest, 'Create')
foreach ($file in $files) {
    $entryName = $file.FullName.Substring($source.Path.Length + 1)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName) | Out-Null
}
$zip.Dispose()
# Siempre excluir carpeta imagenes/ (solo para store assets)
```

### Fix clave: setReactVal para inputs MUI
```javascript
function setReactVal(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
// input.value = x directo NO dispara el estado interno de React/MUI
```

### Warning "Procede con cuidado" en Chrome Store
No se puede eliminar por código. Desaparece orgánicamente con ~500-1000 usuarios activos.
Aviso a mostrar al usuario en onboarding:
> "Al instalar, Chrome puede mostrar un aviso de precaución. Es normal para extensiones nuevas y no indica ningún riesgo. Hacé click en 'Continuar a la instalación' para proceder."

---

## Chrome profile — notas técnicas críticas

**Ruta del perfil:** `%LOCALAPPDATA%\ProcuradorSCW\ChromeProfile`
**Contraseñas guardadas:** `...\Default\Login Data` (SQLite, cifrado con DPAPI)

### Flujo de cierre limpio (`closeChromeProfile`)
```
1. wmic → obtener PIDs de chrome.exe con '%ProcuradorSCW%' en commandline
2. taskkill /F /PID <cada pid>
3. await sleep(2000)   ← dar tiempo a Chrome de morir completamente
4. Eliminar: SingletonLock, SingletonCookie, SingletonSocket
   └── taskkill /F deja estos archivos huérfanos
   └── Sin eliminarlos Chrome arranca en crash-recovery (about:blank o diálogo restaurar)
```

### ⚠️ Problema recurrente: `about:blank` — historia y solución definitiva

Este bug rompió la app múltiples veces. Documentado para no volver a introducirlo.

**Síntoma:** Chrome abre en `about:blank` (o en la página de Google) en lugar de ir directo al destino. La automatización falla porque los selectores no encuentran nada.

**Causas que se identificaron:**

1. **`waitForNavigation()` después de que Chrome ya navegó** → espera una navegación que nunca llega → timeout de 30s → falla.
2. **`chrome://` URLs pasadas como arg de launch** → Chrome las ignora silenciosamente en algunos perfiles y abre Google o nueva pestaña.
3. **Lock files huérfanos** (`SingletonLock`, `SingletonCookie`, `SingletonSocket`) → `taskkill /F` mata Chrome pero no limpia estos archivos → al próximo arranque Chrome entra en crash-recovery y muestra `about:blank` o el diálogo "restaurar sesión".

**Solución definitiva por script:**

```javascript
// ✅ abrirNavegadorPJN.js — sitios web externos (https://)
// Pasar la URL como arg de launch evita el flash de about:blank inicial
// page.goto() luego espera los redirects completos de SSO (networkidle2)
puppeteer.launch({ args: [..., 'https://portalpjn.pjn.gov.ar'] })
await page.goto('https://portalpjn.pjn.gov.ar', { waitUntil: 'networkidle2', timeout: 60000 });

// ✅ agregarPasswordSCW.js — URLs chrome:// internas
// NO pasar chrome:// como arg de launch (Chrome lo ignora → abre Google)
// Usar directamente page.goto() después de que Chrome arranque
puppeteer.launch({ args: [...] })  // sin URL en args
await page.goto('chrome://password-manager/passwords', { waitUntil: 'domcontentloaded', timeout: 30000 });

// ❌ NUNCA hacer esto:
await browser.pages()           // obtener page
await waitForNavigation()       // esperar navegación → YA OCURRIÓ → timeout
```

**`closeChromeProfile()` — limpieza obligatoria de lock files:**
```
1. wmic → PIDs de chrome.exe con '%ProcuradorSCW%' en commandline
2. taskkill /F /PID <cada pid>
3. await sleep(2000)   ← Chrome necesita tiempo para morir
4. fs.unlinkSync: SingletonLock, SingletonCookie, SingletonSocket
   └── Sin este paso → próximo arranque entra en crash-recovery → about:blank
```

### Flags de Chrome a NO usar (generan banners en el navegador)
```
--no-sandbox                              ← banner de seguridad naranja
--ignore-certificate-errors               ← banner de seguridad
--disable-blink-features=AutomationControlled  ← detectable, innecesario
```
Sí usar: `ignoreDefaultArgs: ['--enable-automation']` (quita la barra de "controlado por software")

### Diagnóstico rápido: credenciales guardadas
```powershell
# Verificar si hay contraseñas guardadas para pjn.gov.ar
$f = "$env:LOCALAPPDATA\ProcuradorSCW\ChromeProfile\Default\Login Data"
$b = [IO.File]::ReadAllBytes($f)
[Text.Encoding]::UTF8.GetString($b) -match "pjn"
# → True: hay credenciales   False: Login Data vacío → debe correr "Agregar contraseña SCW"
```
Si el resultado es `False`, la automatización **no puede autofill** y el usuario debe guardar la contraseña desde Configuración → Seguridad → "Agregar contraseña SCW".

---

## ⛔ Zonas protegidas — NO modificar sin coordinación

| Zona | Por qué no tocar |
|---|---|
| `backend-server/keys/` | Claves RSA privadas — si se cambian, todos los scripts dejan de verificarse |
| `backend-server/certs/` | Certificados SSL — manejar con certbot en producción |
| `electron-app/src/security/` | Lógica de cifrado, verificación de firma, autodestrucción |
| `machineId` / hardware binding | Cambiar rompe el lock de dispositivo de todos los usuarios |
| Campos `usage_count` / `usage_limit` en DB | Afectan directamente las cuotas de todos los clientes |
| `manifest.json` de la extensión | No sincronizar entre `extension-app/` dev y producción — tienen diferencias intencionales |

### 🔑 Regla de secretos — NUNCA versionar credenciales
> **Ningún secreto va en archivos versionados** (CLAUDE.md, docs, código). Esto incluye: tokens MercadoPago (sandbox **y** producción), `MP_WEBHOOK_SECRET`, `JWT_SECRET`, claves RSA/AES, API keys (Anthropic, Brevo), passwords de DB.
> - Los valores vivos viven **solo** en el `.env` del server (gitignored): prod `/var/www/procurador/backend-server/.env` · staging `.env.staging`.
> - En la documentación se referencia **dónde** está el valor, nunca el valor en sí (ej: "ver `.env.staging` en el server").
> - ⚠️ **Al activar B3 (MercadoPago producción):** el token real va directo al `.env` del server por SSH — **jamás** en CLAUDE.md ni en ningún commit.
> - Antecedente: el 2026-06-08 GitGuardian detectó el token MP **sandbox** que estuvo en CLAUDE.md (commit `cb305d4`, 29/05). Se removió (commit `74e6c00`) y se **rotó** el token + webhook secret. Por eso esta regla.

---

## 📋 Pendientes — Prioridad actual
> Última actualización: 2026-05-20. Sin usuarios reales en producción — priorizar lo comercial antes que la infraestructura.
> Regla: Bloques 6 y 7 son obligatorios **antes de abrir el registro público**, no antes.

---

### 🥇 BLOQUE 1 — Identidad de Marca & Landing
- ⬜ Identidad de marca consolidada: copy unificado, tono consistente en todos los emails transaccionales
- ⬜ Consistencia de nombre en instalador `.exe`, extensión Chrome Store y emails
- ✅ Landing: sección Planes con precios de promos (Extensión USD 1/mes, Combo Beta USD 9,99/mes) + "Próximamente" para planes permanentes
- ✅ Términos y Condiciones de Uso — `/terminos/index.html` publicado y enlazado desde footer landing y formulario de registro
- ✅ Política de Privacidad — `/privacidad/index.html` publicado y enlazado desde footer landing y formulario de registro
- ✅ Aviso PJN (credenciales nunca pasan por servidores) — sección "Privacidad & seguridad" en landing
- ✅ Planes y precios de promos visibles en landing y en flujo de registro (cards dinámicas)
- ✅ Alertas de promo en Electron: `checkPromoAlert()` muestra banner para usuarios en plan promo (vencimiento, extensión de fecha)

---

### 🥈 BLOQUE 2 — Planes & Precios ⏸️ DIFERIDO (ejecutar al abrir venta pública)
- ✅ Precios fijados en DB y landing (indexados a UMA CSJN): BASIC $31.875 · PRO $63.751 · ENTERPRISE $95.626 ARS/mes
- ✅ Promos: EXTENSION_PROMO $1.500 · COMBO_PROMO $15.000 ARS/mes
- ⏸️ **Activar planes permanentes** → diferido al lanzamiento público (`UPDATE plans SET active=true WHERE name IN ('BASIC','PRO','ENTERPRISE')`)
- ⏸️ **Actualizar precios** en `landing/index.html` (3 precios + nota UMA) + `terminos.html` + 2 filas en DB → diferido; ejecutar solo si el valor UMA cambia antes del lanzamiento

---

### 🥉 BLOQUE 3 — Code Signing ← iniciar trámite ya (tiene tiempos externos)
- ⬜ Crear cuenta Azure + Azure Trusted Signing (~USD 9/mes)
- ⬜ Firmar instalador `.exe` (elimina warning SmartScreen en cada instalación nueva)
- Docs: https://learn.microsoft.com/en-us/azure/trusted-signing/

---

### 4️⃣ BLOQUE 4 — Pago & Facturación
- ⬜ Decidir MercadoPago (recomendado, mercado local) vs Stripe como alternativa secundaria
- ⬜ Portal de pago en Electron: selector de plan + formulario de pago
- ⬜ Integración MercadoPago/Stripe: primer cobro + webhooks de renovación
- ⬜ Campos DB a agregar:
  ```sql
  ALTER TABLE subscriptions ADD COLUMN payment_provider VARCHAR(20);
  ALTER TABLE subscriptions ADD COLUMN external_subscription_id VARCHAR(100);
  ALTER TABLE subscriptions ADD COLUMN next_billing_date TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN cancel_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN payment_grace_until TIMESTAMP WITH TIME ZONE;
  ALTER TABLE users ADD COLUMN cuit_deleted_at TIMESTAMP WITH TIME ZONE;
  ```
- ⬜ Nuevas tablas: `payments` (historial de cobros) y `payment_events` (cargo, reembolso, fallo, disputa)
- ⬜ Banner post-activación en Electron: "Configurá tu método de pago"
- ⬜ Ciclo mensual automático (cron job en backend)
- ⬜ Gracia 3 días en pago fallido + reintentos automáticos + suspensión automática
- ⬜ Flujo de cancelación desde portal de usuario
- ⬜ Retención CUIT 90 días + job de limpieza
- ⬜ Facturación AFIP

---

### 5️⃣ BLOQUE 5 — Soporte & FAQs & Chat & Tickets
- ✅ FAQs expandidas: 10 → 34 preguntas en 7 categorías con filtro por pills (v2.7.2)
- ✅ Endpoint `POST /client/ai/chat` activo con Claude Haiku + rate limit + system prompt (v2.7.2)
- ✅ `docs/manual-de-usuario.md` publicado en el repo
- ✅ `ANTHROPIC_API_KEY` configurada en servidor — fallback IA activo en producción (Claude Haiku)
- ⬜ Sistema de tickets mejorado: notificaciones email al usuario cuando admin responde, plantillas, filtros y prioridades

---

### 6️⃣ BLOQUE 6 — Seguridad & Backups & Tests & Documentación ← antes del lanzamiento público
- ✅ Backups automáticos PostgreSQL — cron diario 03:00 AM, retención 7 días, log + alerta email (2026-05-26)
  - Script: `/var/www/procurador/backend-server/scripts/backup-db.sh`
  - Destino: `/var/backups/procurador/` en el servidor
  - ⬜ **Pendiente futuro:** replicar backups a **DigitalOcean Spaces** (~USD 5/mes) para tener copia fuera del servidor — integrar con `s3cmd` en el mismo script
- ✅ Hardening secretos RSA (2026-05-26): `RSA_PRIVATE_KEY` + `RSA_PUBLIC_KEY` movidas a `.env`
  - `scriptSigner.js` lee env vars primero, fallback a archivos PEM solo en desarrollo
  - `ENCRYPTION_KEY` (AES) ya estaba en `.env` desde el inicio
  - Archivos `keys/private.pem` y `keys/public.pem` se mantienen en servidor como backup, pero el proceso no depende de ellos
- ⬜ Smoke tests / canary tests para endpoints críticos (CI pre-deploy) ← PRE-LANZAMIENTO
- ✅ Suite QA completa ejecutada (2026-05-20): 159/165 PASS, 0 FAIL — ver `tests/QA_RESULTS.md`
- ✅ Suite de tests automatizados en `tests/` (pytest + Playwright) con módulos M1–M14
- ⬜ **Diferido:** Verificar descarga de scripts en PC de usuario real (firma RSA + auto-destrucción)
- ⬜ **Diferido:** Análisis de seguridad profundo (Electron + backend)
- ⬜ **Diferido:** Documentación técnica completa (endpoints, esquema DB, runbook de operaciones)

---

### 7️⃣ BLOQUE 7 — Entorno de Pruebas
- ⬜ Servidor staging (proceso PM2 separado, BD `procurador_db_staging`, subdominio `staging.api.procuradortool.com`)
- ⬜ Smoke tests automatizados pre-deploy
- ⬜ Proceso de release documentado paso a paso
- ⬜ Mecanismo de rollback definido y probado

### Flujo oficial de usuario (aprobado 2026-04-28)
```
1. REGISTRO
   → Email + contraseña + CUIT (obligatorio, único en el sistema)
   → Si CUIT ya existe → error, no permite continuar
   → registration_status: pending_email
   → Email de verificación

2. VERIFICACIÓN DE EMAIL
   → registration_status: pending_activation
   → subscription: suspended, usage_limit = 20
   → Email: "Tenés 20 usos de prueba. Para continuar necesitarás un medio de pago."

3. PERÍODO DE PRUEBA (0 a 20 usos)
   → Admin puede activar en cualquier momento → full plan (sin pago, caso especial)
   → Admin puede rechazar en cualquier momento:
      - Bloquear: acceso revocado + notificación con motivo
      - Mantener trial: conserva usos restantes + notificación
   → Electron muestra en Mi Cuenta: "X/20 usos — Para continuar configurá tu suscripción"

4. USUARIO QUIERE CONTINUAR (agotó usos o decidió antes)
   → Elige plan y paga en el portal
   → registration_status: pending_payment
   → Admin recibe notificación con datos del usuario + pago confirmado
      - ✅ Aprueba → active, email bienvenida, ciclo mensual inicia
      - ❌ Bloquea → reembolso automático + notificación con motivo
      - ⏸ Mantiene trial → conserva usos restantes + notificación

5. ACTIVO
   → Renovación mensual automática vía webhook
   → Pago fallido → gracia 3 días → suspensión → notificación in-app + email
   → Admin puede suspender manualmente en cualquier momento con notificación

6. CANCELACIÓN / BAJA
   → Usuario cancela → acceso hasta fin del período pagado
   → Baja definitiva → CUIT liberado, datos retenidos 90 días
   → Reactivación futura → nuevo registro con mismo CUIT, historial preservado
```

---

## Plan de comercialización — 6 fases

### FASE 1 — APLICACIÓN (en curso)
**Objetivo:** producto terminado y pulido para el usuario final.

#### 1.0 Estabilización, UX y estilos del onboarding ✅ COMPLETADO (v2.4.x → v2.4.14)
Sesión 2026-04-24 — fixes acumulados en versiones 2.4.2 → 2.4.10:
- ✅ Eliminados banners Chrome: `--no-sandbox`, `--ignore-certificate-errors`, `--disable-blink-features=AutomationControlled`
- ✅ Tour paso 10: card se posiciona correctamente a la derecha de los botones spotlight (getBoundingBox + `right` property + 350ms delay para transición CSS)
- ✅ Onboarding completo: ventana principal ya no se duplica al finalizar wizard
- ✅ Credenciales en onboarding: lee `psc_accounts` (formato multi-cuenta) en lugar de `psc_remember` obsoleto
- ✅ Visor automático: corregido selector de toggle (`tgl-abrirVisor` + `.cfg-toggle.on`)
- ✅ `closeChromeProfile()`: mata Chrome por PID, espera 2s, elimina lock files (SingletonLock/Cookie/Socket) para evitar crash recovery
- ✅ `abrirNavegadorPJN.js`: Chrome abre directamente en `portalpjn.pjn.gov.ar` (URL como arg de launch); `page.goto()` espera la cadena completa de redirects SSO; completa CUIT y busca credenciales
- ✅ `agregarPasswordSCW.js`: usa `page.goto('chrome://password-manager/passwords')` directamente después de lanzar Chrome (arg de launch no funcionaba — Chrome abría Google primero); overlay mostrado inmediatamente tras goto, antes del sleep
- ✅ `preCalentarChrome.js`: corregido profilePath (`APPDATA` → `LOCALAPPDATA\ProcuradorSCW\ChromeProfile`) — script orphaned, no se llama desde main.js
- ✅ **Estilos onboarding unificados con la app** (v2.4.11, rama `visual-onboarding-fixes`):
  - `onboarding.css`: logo/botones/inputs/info-box migrados de azul/violeta → amber (`#d97706`), fondo `#f7f7f5`
  - Botones: tamaño igual al tour card (`padding:6px 14px; font-size:12px; border-radius:7px`)
  - Modal "Nueva versión" (`index.html`): rediseñado igual que tour card (amber border, icono `#422006`, botón `#eab308`)
  - Modal "Acción requerida" (`renderer.js`): misma estructura tour card + texto fijo hardcodeado ("Chrome está esperando que ingreses tu contraseña del PJN...") — ya no depende del mensaje del script encriptado
- ✅ **v2.4.13 → v2.4.14** (sesión 2026-04-24, rama `fix/agregar-password-overlay`):
  - `agregarPasswordSCW.js`: eliminada la `chrome://` URL del arg de launch (Chrome la ignoraba y abría Google); reemplazada por `page.goto()` directo tras el arranque
  - Overlay mostrado inmediatamente después de `page.goto()`, antes del sleep — queda visible durante todo el llenado del formulario
  - Re-inyección del overlay tras clic en "Agregar" (la navegación SPA de Chrome lo borraba)
  - Nota: el dialog nativo "Agregar contraseña" usa el top-layer del browser — ningún overlay web puede renderizarse encima; es una limitación de Chrome, no un bug

#### 1.1 Sistema de diseño de la App Electron ✅ COMPLETADO
- Estilos amber (`#d97706`), Inter, Crimson Pro aplicados consistentemente en toda la app
- Onboarding, modales, tour cards y configuración ya son visualmente coherentes
- No se requieren cambios adicionales de presentación

#### 1.1b Refactor técnico `renderer.js` ✅ COMPLETADO (decisión 2026-04-27)
- `renderer.js` permanece monolítico — funciona correctamente y no hay problemas de mantenimiento actuales
- Se decidió no dividir en módulos por ahora: el costo de refactor supera el beneficio en esta etapa
- Revisitar solo si el archivo crece significativamente o aparecen conflictos reales

#### 1.2 Migración extensión → Chrome Web Store ✅ COMPLETADO
- Extensión publicada y aprobada en Chrome Web Store (v1.3.3 — branding actualizado)
- Onboarding actualizado con enlace directo a la store
- Aviso sobre warning de Chrome al instalar incluido en onboarding
- ✅ **Actualizar imágenes en Chrome Web Store** — hecho (2026-06-10) junto con la subida de la v1.3.4
- ⏸️ **Limpiar distribución CRX del backend** — diferido: `main.js` sigue llamando a `/api/extension/version` y `/api/extension/download`; para limpiar hay que migrar esos handlers. No urgente — la ruta sigue funcionando.

#### 1.3b Rediseño visual de los visores HTML ✅ COMPLETADO (sesión 2026-04-24)
- `visorModal_template.html` (procuración): rediseñado — tabla plana con modal de movimientos, amber/Inter
- `informe/visor_informes_template.html`: rediseñado — header sticky, stats row, tabla de expedientes
- Monitor de partes (`generarVisorMonitoreo` en `main.js`): rediseñado — cards por parte con accordion, sistema de diseño unificado

#### 1.4 Unificación "Procurar hoy" + "Por fecha" — ✅ COMPLETADO (v2.4.16)

- Botón "Por fecha" eliminado del sidebar
- Campo `Fecha límite` (DD/MM/YYYY) agregado debajo del botón Procurar
- Sin fecha → procura hoy; con fecha → procura desde esa fecha (`runProcessCustomDate`)
- Sincronización bidireccional con el campo "Fecha límite" del modal de Configuración
- Guarda en `config.general.fechaLimite` automáticamente al cambiar
- **v2.7.18:** `fechaLimite` por defecto = **fecha de hoy** dinámica (antes estaba hardcodeada a `01/11/2025`)
- **v2.7.18:** config inicial incluye `seguridad: { modoHeadless: true }` → headless **activo por defecto** al instalar
- **v2.7.18:** visor auto-abre al terminar procuración (bug fix: usaba `getElementById('abrirVisor')` inexistente; ahora usa `config.visor.abrirAutomaticamente`). Informe batch también auto-abre el visor HTML.
- Nueva función `runProcessFromSidebarFecha()` en `renderer.js`
- Tour actualizado: paso 4 resalta Procurar + campo + Por lote con spotlight conjunto

---

#### 1.5 Tour accesible + Asistente IA en sección Sistema — ✅ COMPLETADO (v2.4.16)

Sección Sistema del sidebar:
```
⚙  Configuración
🧩  Extensión PJN
❓  Ver tour              → llama window.startAppTour()
🤖  Asistente IA          → abre #modalAsistente (FAQ accordion)
```

**Ver tour** (`#btnSidebarTour`): llama directamente `window.startAppTour()`. No interfiere con el sistema de active state del sidebar (usa `id` en lugar de `data-action`).

**Asistente IA** (`#btnSidebarAsistente`): abre `#modalAsistente` con 7 FAQs en accordion expandible + campo de búsqueda en vivo. Al pie: botón "Abrir chat" → abre el chat widget flotante.

**Tour** actualizado: nuevo paso 13 resalta ambos botones; paso 10 y paso 4 ahora centran el card respecto al bounding box de los elementos (no al viewport).

---

#### 1.6 Chat widget flotante + búsqueda FAQ — ✅ COMPLETADO (v2.4.17)

**Chat widget** (`#chatWidget`, body-level, `position:fixed` bottom-right):
- Dos estados: burbuja minimizada (🤖 naranja, 52px) y ventana expandida (340×440px)
- Header amber con botones: 🎫 escala a tickets · — minimiza · ✕ cierra completamente
- Burbujas diferenciadas: usuario (derecha, amber) · bot (izquierda, gris con borde)
- Indicador de typing animado (3 dots bounce) antes de la respuesta del bot
- Respuesta placeholder hasta configurar IA real
- Posicionamiento dinámico vía `getBoundingClientRect(#consoleStatusbar)` — garantiza igual gap visual que `right: 24px`
- Rama: `feature/asistente-chat` mergeada a `main`

**Búsqueda en vivo en FAQ** (`#faqSearch`):
- Input con lupa encima del listado
- Filtra por título Y contenido de respuesta en tiempo real
- Muestra "Sin resultados para X" si no hay coincidencias
- Se resetea y enfoca automáticamente al abrir el modal

**IA real conectada:** `POST /client/ai/chat` → Claude Haiku (ANTHROPIC_API_KEY activa). ✅

---

#### 1.7 Rediseño modales Mi Cuenta y Estadísticas — ✅ COMPLETADO (v2.4.21–v2.4.22)

**Mi Cuenta — cuenta suspendida (pendiente de activación):**
- Estado muestra "⏳ Pendiente de activación" en lugar de "⚫ Suspendido"
- Banner amber con barra de progreso y contador **X / 20 usos globales** del período de prueba
- Sección subsistema muestra aviso: "Los usos individuales se habilitarán al activar tu cuenta"

**Mi Cuenta — cuenta activa:**
- Sección "Uso por subsistema" reemplaza barras horizontales por **cards** (mismo estilo que Estadísticas)
- Cada card: ícono + `usado / límite` + mini barra de progreso + restantes en color

**Estadísticas — todas las cuentas:**
- Eliminadas las 3 cards antiguas (Procuraciones / Informes / Monitoreo) sin límites — redundantes
- Sección "Uso por subsistema": **5 cards** con uso + límite + restantes por módulo (solo activos)
- Card "Tasa de éxito" → **"Usos en el período"** (`usage_count` real de la DB)
- Para trial: muestra `X / 20 — Usos de prueba`
- `get-stats` en `main.js` ahora pasa datos de cuenta (`status`, `registrationStatus`, `usage`) al renderer

**Archivos modificados:** `index.html`, `renderer.js`, `main.js`, `styles.css`

---

#### 1.3 Code Signing — ⏸️ DIFERIDO (iniciar en paralelo a Fase 5 — tiene tiempos externos)
- Firmar el instalador `.exe` de Electron con **Microsoft Azure Trusted Signing**
- Objetivo: eliminar el warning "Editor desconocido" de Windows SmartScreen al instalar la app
- Sin firma: SmartScreen bloquea o advierte la instalación en Windows; con firma: instalación fluida
- Requiere cuenta Azure + certificado EV o Azure Trusted Signing (~USD 9/mes)
- Docs: https://learn.microsoft.com/en-us/azure/trusted-signing/

---

### FASE 2 — BACKEND (parcialmente completada)
**Objetivo:** infraestructura robusta, segura y documentada.

- ✅ Backups programados PostgreSQL — cron 03:00 AM, retención 7 días, alerta email (2026-05-26)
- ✅ Hardening secretos RSA — `RSA_PRIVATE_KEY` + `RSA_PUBLIC_KEY` movidos a `.env` (2026-05-26)
- ✅ Smoke tests endpoints críticos — `smoke-test-pjn.js` 48/48 ✅ (2026-05-27)
- ⏸️ Análisis de seguridad profundo (app Electron + backend) — diferido post-Fase 5
- ⏸️ Documentación técnica completa del backend — diferido

---

### FASE 3 — COMERCIAL (en curso, paralela a Fase 1)
**Objetivo:** presencia pública y capacidad de vender.

#### 3.1 Página Web / Landing Page ✅ COMPLETADO
- Archivo fuente: `backend-server/public/landing/index.html`
- URL: https://procuradortool.com
- Sistema de diseño aplicado (amber, Inter, Crimson Pro)
- Estructura: Navbar · Hero · Problema · App Showcase · Funciones · Extensión · Cómo funciona · Seguridad/Privacidad · Planes · CTA · Footer
- Planes permanentes visibles como "Próximamente" — se activan al lanzamiento público (ver 3.3)

#### 3.2 Términos Legales ✅ COMPLETADO (2026-05-20)
- ✅ Términos y Condiciones de Uso — `/terminos/index.html` publicado
- ✅ Política de Privacidad — `/privacidad/index.html` publicado
- ✅ Aviso PJN (credenciales nunca pasan por servidores) — en sección "Privacidad & seguridad" de la landing
- ✅ Links desde footer de la landing y desde checkbox en formulario de registro

#### 3.3 Estrategia de Venta y Planes ✅ COMPLETADO (activación diferida al lanzamiento)
- ✅ Promos: EXTENSION_PROMO $1.500 ARS/mes · COMBO_PROMO $15.000 ARS/mes — activas en DB y landing
- ✅ Permanentes fijados en DB indexados a UMA CSJN: BASIC $31.875 · PRO $63.751 · ENTERPRISE $95.626 ARS/mes
- ✅ Planes permanentes visibles en landing como "Próximamente"
- ⏸️ **Activar BASIC/PRO/ENTERPRISE** — diferido al lanzamiento público: `UPDATE plans SET active=true WHERE name IN ('BASIC','PRO','ENTERPRISE')`
- Registro en: `https://api.procuradortool.com/register/`

#### 3.4 Registro y Recolección de Datos ✅ COMPLETADO
- ✅ Registro público con verificación de email
- ✅ Flujo de activación manual por admin
- ✅ Alertas de promo en Electron: `checkPromoAlert()` muestra banner de promo (vencimiento, extensión de fecha)

#### 3.5 Identidad de Marca ✅ COMPLETADO
- Nombre: **Procurador SCW** / **ProcuradorTool**
- Dominio: procuradortool.com
- Publisher Chrome Store: Jonathan Berger

---

### FASE 4 — SOPORTE ✅ CERRADA (sesión 2026-05-22, tag `fase4-completa`)
**Objetivo:** atención al usuario eficiente con asistencia IA.

> Items 1+2+3 completados cubren el 80% del valor de soporte.
> Items 4 (KB) + 3.5 (borradores masivos) diferidos a iteración futura — diseño guardado en `docs/internal/mejoras-futuras.md`.

- ✅ Sistema de tickets básico (crear, responder, estados)
- ✅ Notificaciones in-app admin → usuario (v2.5.x)
- ✅ **Asistente IA — App Electron** (v2.7.2): 34 FAQs con filtro por categoría + chat widget async con fallback `POST /client/ai/chat` → Claude Haiku
- ✅ **Asistente IA — Portal web** (`/usuarios/`): chat con historial de conversación → `POST /usuarios/api/ai-chat` → Claude Haiku (mismo system prompt, rate limit 20/hora, historial últimos 10 mensajes)
  - ✅ `ANTHROPIC_API_KEY` activa en el servidor — ambos endpoints en producción
  - Diferencia: Electron usa FAQ local como primera línea (gratis, sin latencia); portal web va directo a la API (chat conversacional con historial)
  - Costo estimado: ~USD 1.60/mes para 200 usuarios × 20 queries/mes (Claude Haiku)
- ✅ **Sección "Ayuda" — Portal web** (`/usuarios/`): FAQ accordion + manual inline, sin requerir app Electron
  - 34 preguntas en 7 categorías con pills de filtro y buscador por texto (mismo contenido que app Electron)
  - Manual de usuario completo renderizado como HTML inline dentro del portal (toggle, scrollable, tablas, código)
  - Funciones: `renderAyuda()`, `renderAyudaFaq()`, `getManualHTML()`, `AYUDA_FAQ_ITEMS`, `AYUDA_FAQ_CATS`
  - `goto=ayuda` soportado vía el handler SSO genérico existente
- ✅ Documentación de ayuda publicada: `docs/manual-de-usuario.md` + `docs/internal/sistema-estados-flujos.md`
- ✅ **Email de respuesta admin→usuario** (Fase 4 Ítem 1 — sesión 2026-05-22, tag `fase4-item1`):
  - Cuando un admin agrega comentario en `POST /admin/tickets/:id/comment` → email automático al usuario
  - **Asunto**: `Procurador SCW — Respuesta a tu ticket #X`
  - **Contenido**: preview de 200 chars + botón "Ver respuesta completa" hacia el portal
  - **Login**: el botón lleva al login normal del portal (`?goto=soporte`) — sin SSO por seguridad anti-forward
  - **Persistencia post-login**: `sessionStorage.pending_goto` sobrevive al ciclo de login y `initDashboard()` lo consume para navegar a la sección correcta
  - **Feature flag**: `EMAIL_TICKET_REPLY_ENABLED=true` en `.env` del server
  - **Función**: `sendTicketReplyEmail()` en `utils/mailer.js`
  - **No bloqueante**: envío async fire-and-forget con catch (no rompe el flujo HTTP)
  - **UTF-8 garantizado**: wrapper automático de `<!DOCTYPE><meta charset>` en `sendEmail()` + `textEncoding: 'base64'` en nodemailer — beneficia todos los emails del sistema
  - **PORTAL_URL** corregido a `https://api.procuradortool.com/usuarios/` (antes apuntaba mal a la landing)
  - **UX**: badge `#ID` ahora visible en la lista y detalle de tickets del portal (consistencia con el email)
- ✅ **Prioridad IA en tickets** (Fase 4 Ítem 2 — sesión 2026-05-22, tag `fase4-item2`):
  - **Modelo**: `support_tickets` +`priority_source`, +`priority_notes`, +`priority_set_at`, +`priority_set_by` (migración `20260522_add_ticket_priority_source.sql`)
  - **Estados de source**: `NULL` (sin clasif, IA puede procesarlo) · `'ai'` (IA clasificó) · `'manual'` (admin bloqueó) · `'ai_overridden'` (legacy, equivalente a manual)
  - **Endpoint nuevo**: `POST /admin/tickets/ai-prioritize { ticket_ids?: [] }` — clasifica con Claude Haiku (rate limit 100/h/admin, paralelismo 5)
  - **Endpoint actualizado**: `PUT /admin/tickets/:id/priority` ahora acepta `ai_managed: boolean`
    * `ai_managed=true` + priority cambió → source=NULL
    * `ai_managed=true` + prevSource era manual/ai_overridden → source=NULL (transición)
    * `ai_managed=true` + ya era ai/NULL sin cambios → preservar (noop)
    * `ai_managed=false` → source='manual'
  - **Endpoint helper**: `POST /admin/tickets/:id/reset-priority` (limpia source, accesible vía API)
  - **UI**:
    * Tabla: badge con ícono 🤖 (IA) / 👤 (admin) / borde punteado "sin clasif." (NULL)
    * Detalle: toggle "🤖 IA gestiona esta prioridad" + mini-badge dinámico + razonamiento IA visible si existe
    * Botón global "🤖 Establecer prioridad por IA (N)" en header de Tickets
  - **System prompt**: `AI_PRIORITY_SYSTEM_PROMPT` con contexto Procurador SCW y criterios L/M/H/U conservadores
  - **Modelo**: `claude-haiku-4-5`, max_tokens 300
- ✅ **Visibilidad + IA suggest + Ajustes manuales en tickets** (Fase 4 Ítem 3 — sesión 2026-05-22, tag `fase4-item3`):
  - **DB**: `ticket_comments` +`visibility` (`'external'` default | `'internal'`) · tabla nueva `ai_assistance_logs` (telemetría)
  - **Visibilidad de comentarios**:
    * `POST /admin/tickets/:id/comment` acepta `visibility: 'external'|'internal'`
    * Internas: NO envían email, NO cambian status del ticket, NO se devuelven en `GET /tickets/:id` (endpoint user)
    * Admin endpoint sí las devuelve con campo `visibility`
    * UI: hilo con fondo amarillo + label "🔒 NOTA INTERNA" para internas
    * Compositor con dropdown "Externa / Interna" (default externa)
  - **Proyectar con IA**: `POST /admin/tickets/:id/ai-suggest-reply`
    * Modelo: Claude Haiku 4.5, max_tokens 600
    * Rate limit: 30 sugerencias/hora/admin
    * Contexto: ticket + plan + historial completo (internas + externas) — la IA ve notas internas como contexto privado pero genera respuesta externa
    * AI_REPLY_SYSTEM_PROMPT con tono rioplatense + reglas anti-hallucination
    * Solo habilitado en modo Externa (deshabilitado si tipo=Interna)
    * Pre-carga la sugerencia en el textarea — admin edita y envía manualmente (nunca auto-envía)
    * Telemetría: `PATCH /admin/ai-suggest-logs/:id` registra `action` ('sent_as_is'/'sent_edited'/'discarded') + `edit_distance`
  - **Ajuste manual de usos desde ticket**: card nueva en detalle del ticket
    * Reusa endpoint existente `POST /admin/subscriptions/:userId/adjust` con `ticket_id` auto-rellenado
    * Diferente de "Beneficio comercial": múltiples ajustes permitidos, reversibles, granular por subsistema
    * Muestra historial reciente de ajustes del usuario (últimos 5)
- 📌 **Diferidos a iteración futura** (diseño completo en `docs/internal/mejoras-futuras.md`):
  - **Base de Conocimiento (Ítem 4)** — postergado hasta tener 20-30 tickets cerrados reales
  - **Borradores masivos con IA (Ítem 3.5)** — postergado hasta tener KB poblada + volumen > 20 tickets/día
  - Decisión 2026-05-22: cerrar Fase 4 con Items 1+2+3 que cubren el 80% del valor

---

### FASE 5 — COBRANZA (pendiente)
**Objetivo:** cobro automático de suscripciones.
**Plan detallado:** `docs/internal/plan-fase5-cobranza.md`

---

#### Flujo completo — Registro, Trial y Suscripción

##### 1. REGISTRO
```
Email + contraseña + CUIT
  ├── CUIT duplicado → error
  ├── Email duplicado → error
  └── OK → registration_status: pending_email
           → Email de verificación
```

##### 2. VERIFICACIÓN DE EMAIL
```
Usuario hace click en el link
  └── registration_status: pending_activation
      subscription: { status: suspended, usage_limit: 20 }
      → Email: "Tenés 20 usos de prueba. El equipo revisará tu cuenta
                y te avisará cuando puedas continuar."
```

##### 3. TRIAL (0 → 20 usos) — Admin decide
```
Admin recibe alerta de nuevo usuario pendiente.
Puede decidir en cualquier momento durante el trial:

  ✅ ACTIVA
     → registration_status: active
     → subscription: { status: active, plan asignado }
     → user_event: activated
     → user_notification + email: "Tu cuenta fue activada.
                                    Configurá tu método de pago para continuar."
     → Electron muestra banner → "Configurar suscripción"
     → Usuario elige plan + carga método de pago (paso 4)

  🚫 RECHAZA + BLOQUEA
     → registration_status: rejected
     → subscription: status: cancelled
     → Acceso revocado inmediatamente, sin opción de pago
     → user_event: rejected_blocked { reason }
     → user_notification + email: "Acceso denegado. Motivo: ..."

  ⏸ RECHAZA + MANTIENE TRIAL
     → registration_status: pending_activation (sin cambio)
     → subscription: sin cambio (sigue con los usos restantes)
     → Puede seguir usando hasta agotar sus 20 usos
     → No hay opción de pago — necesita aprobación del admin para convertir
     → user_event: rejected_keep_trial { reason }
     → user_notification: "Tu solicitud está en espera. Motivo: ..."
     → Al agotar los 20 usos: acceso suspendido automáticamente
```

##### 4. CONFIGURACIÓN DE PAGO *(solo usuarios activados por admin)*
```
Usuario accede al portal de pago (desde Electron o web):
  ├── Elige plan: BASIC / PRO / ENTERPRISE
  ├── Carga método de pago (MercadoPago / Stripe)
  └── Confirma → primer cobro ejecutado
        ├── ✅ Cobro exitoso
        │     → subscription: { status: active, payment_provider, next_billing_date }
        │     → Ciclo mensual comienza
        │     → user_event: payment_setup { plan, provider }
        └── ❌ Cobro fallido
              → Error en pantalla, invita a reintentar
              → Acceso del trial activado se mantiene mientras resuelve
```

##### 5. ACTIVO — Ciclo mensual
```
Renovación automática cada 30 días:
  ├── ✅ Cobro exitoso → next_billing_date += 30 días
  └── ❌ Cobro fallido → 3 días de gracia
        → user_notification + email: "Actualizá tu método antes del DD/MM."
        → Sin resolución en 3 días → status: suspended
        → user_event: payment_failed_suspended

Admin puede suspender manualmente en cualquier momento:
  → subscription: status: suspended
  → user_event: suspended { reason }
  → user_notification + email
```

##### 6. CANCELACIÓN
```
Usuario cancela desde el portal:
  ├── Acceso hasta fin del período pago (sin reembolso parcial)
  ├── subscription: cancel_at: fin_período
  └── Al vencer → registration_status: cancelled

Retención de datos: 90 días
  └── CUIT liberado a los 90 días (campo nullificado en users)
      user_events se preserva permanentemente

Retorno después del CUIT liberado:
  └── Nuevo registro con mismo CUIT — admin ve historial en user_events
```

##### Estados registration_status

| Estado | Quién lo asigna | Descripción |
|---|---|---|
| `pending_email` | sistema | Registrado, email no verificado |
| `pending_activation` | sistema / admin rechaza suave | Email verificado, en trial |
| `active` | admin | Aprobado — puede configurar pago |
| `rejected` | admin | Bloqueado, sin acceso |
| `cancelled` | usuario | Baja voluntaria |

---

#### Items pendientes de implementar (Fase 5)

- ⬜ Portal de pago en Electron: selector de plan + formulario MercadoPago/Stripe
- ⬜ Integración MercadoPago / Stripe (primer cobro + webhooks de renovación)
- ⬜ Banner post-activación en Electron: "Configurá tu método de pago"
- ⬜ Ciclo mensual automático (cron job en backend)
- ⬜ Gracia 3 días en pago fallido + suspensión automática
- ⬜ Flujo de cancelación desde portal de usuario
- ⬜ Retención CUIT 90 días + job de limpieza
- ⬜ Facturación AFIP
- ⬜ Campos DB a agregar:
  ```sql
  ALTER TABLE subscriptions ADD COLUMN payment_provider VARCHAR(20);
  ALTER TABLE subscriptions ADD COLUMN external_subscription_id VARCHAR(100);
  ALTER TABLE subscriptions ADD COLUMN next_billing_date TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN cancel_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN payment_grace_until TIMESTAMP WITH TIME ZONE;
  ALTER TABLE users ADD COLUMN cuit_deleted_at TIMESTAMP WITH TIME ZONE;
  ```

---

### FASE 6 — ENTORNO DE PRUEBAS Y RELEASE SEGURO (pendiente)
**Objetivo:** mecanismo controlado para desarrollar, probar y desplegar sin arriesgar producción.

#### 6.1 Entorno staging
- Proceso PM2 separado en mismo VPS (puerto `3444`), DB `procurador_db_staging`
- Subdominio `staging.api.procuradortool.com` (Nginx proxy)
- App Electron en modo staging apunta a staging (variable de entorno al compilar)

#### 6.2 Smoke tests automatizados
- `POST /auth/login` · `GET /client/scripts/available` · `GET /client/scripts/download/:name` · `POST /license/execution/start`
- Ejecutar antes de cada deploy: `node test/smoke.js`

#### 6.3 Proceso de release seguro
```
1. Desarrollar en rama feature/fix
2. Probar en staging (build local apuntando a staging)
3. Smoke tests ✅
4. Merge a main + bump version
5. npm run release → GitHub Releases
6. Verificar auto-update en instalación de prueba antes de comunicar a usuarios
```

#### 6.4 Rollback
- GitHub Releases conserva versiones anteriores → usuarios pueden bajar manualmente
- Backend: `git checkout <hash-anterior> && pm2 restart procurador-api`
- Los scripts en BD tienen `version` — si hay rollback de código, reencriptar con la versión anterior

---

## Decisiones de arquitectura registradas

| Decisión | Motivo |
|---|---|
| Chrome del usuario (no Chromium empaquetado) | PJN recomienda Chrome; gestor de contraseñas de Chrome maneja las credenciales |
| Scripts distribuidos cifrados (AES-256 + RSA) | Proteger propiedad intelectual de la automatización |
| Machine ID binding | Prevenir sharing de cuentas |
| Extensión en Chrome Web Store (no CRX propio) | Aprobada por Google, distribución oficial, sin warning de instalación insegura |
| Extensión sin permiso `tabs` | Evitaba warning "Leer historial de navegación" |
| Extensión sin `content_scripts *://*/*` | Evitaba warning "Lee datos en todos los sitios" |
| Renderer.js monolítico → refactorizar incremental | No introducir bundler complejo; mantener vanilla JS con módulos ES6 |
| Landing servida por Nginx estático | Sin carga al servidor Node.js |
| SSL en api: certbot / SSL en landing: Cloudflare | Separación de responsabilidades, Cloudflare como CDN y WAF |
| URL como arg en Puppeteer launch | Solo `abrirNavegadorPJN.js` usa URL como arg (sitios web externos). `agregarPasswordSCW.js` usa directamente `page.goto('chrome://')` porque Chrome ignora las `chrome://` URLs pasadas como arg de launch (termina en Google/nueva pestaña) |
| `closeChromeProfile()` elimina lock files | `taskkill /F` deja SingletonLock/Cookie/Socket huérfanos; eliminarlos evita que Chrome entre en crash-recovery al próximo arranque |
| `ignoreDefaultArgs: ['--enable-automation']` | Sin este flag Chrome muestra barra "controlado por software automatizado"; sin --no-sandbox ni --ignore-certificate-errors para evitar banners de seguridad |

---

## Infraestructura

```
Usuario final (Windows)
  ├── Electron App → HTTPS → api.procuradortool.com → Express 3443
  └── Chrome + Extensión → HTTPS → portales PJN (directo)
                         → HTTPS → api.procuradortool.com

Servidor DigitalOcean (142.93.64.94 — Ubuntu)
  ├── Nginx: api.procuradortool.com → Express 3443 (SSL certbot, vence 2026-08-28)
  ├── Nginx: procuradortool.com → landing estática (SSL Cloudflare)
  ├── PM2: procurador-api (proceso Node.js)
  └── PostgreSQL 14: procurador_db (usuario: procurador_user)
```

---

## Git y GitHub

### Repositorio remoto
- **URL:** https://github.com/jberger19186/procurador-tool
- **Visibilidad:** privado
- **Rama principal:** `main`
- **Tracking configurado:** `main` ↔ `origin/main`
- **Credenciales:** guardadas en Windows Credential Manager (no hay que reingresar token)

### Workflow diario

```bash
# Ver qué cambió
git status

# Ver el detalle de los cambios (opcional)
git diff

# Guardar cambios en el historial local
git add .
git commit -m "descripción del cambio"

# Subir a GitHub (respaldo en la nube)
git push

# Ver historial
git log --oneline
```

### Trabajar en una rama separada (recomendado para cambios grandes)

```bash
# Crear y cambiar a rama nueva (ej: rediseño UI)
git checkout -b redesign-ui

# ... hacer cambios, commits ...

# Subir la rama a GitHub
git push -u origin redesign-ui

# Cuando esté listo, volver a main y fusionar
git checkout main
git merge redesign-ui
git push
```

### Token de GitHub
- El token está guardado de forma cifrada en el Windows Credential Manager
- Si hay que reconfigurarlo, ir a: https://github.com/settings/tokens
- Permisos mínimos necesarios: `repo` + `workflow`
- El mismo token sirve para `git push` y para `npm run release` de la app Electron

---

## Smoke Tests

Un script unificado que verifica que los portales del PJN y los flujos de la extensión siguen respondiendo con los selectores DOM correctos. **48 checks · ~70 segundos · usa Chrome con el perfil ProcuradorSCW.**

### Cómo pedirle a Claude que ejecute los tests

> "ejecutá los smoke tests" o "corré el diagnóstico completo"

Claude necesita un token JWT de admin para subir los resultados al dashboard. El token se genera en el servidor con la clave privada del `.env` y dura 24h. Claude puede generarlo automáticamente via SSH.

### Ejecutar manualmente desde `electron-app/`

```powershell
# ── Opción A: con token JWT pre-generado (recomendada para Claude / CI) ──
$env:ADMIN_TOKEN = "<token>"
$env:API_URL = "https://api.procuradortool.com"
node scripts/smoke-test-pjn.js

# ── Opción B: con email + contraseña ──
$env:ADMIN_EMAIL = "admin@procurador.com"
$env:ADMIN_PASSWORD = "<password>"
node scripts/smoke-test-pjn.js

# ── Sin subir al dashboard (solo local) ──
node scripts/smoke-test-pjn.js
```

### Generar token JWT para Claude (cuando no hay contraseña a mano)

```bash
# En el servidor (la clave JWT_SECRET está en /var/www/procurador/backend-server/.env)
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
  "cd /var/www/procurador/backend-server && node -e \"const jwt=require('jsonwebtoken'); console.log(jwt.sign({id:6,role:'admin'},process.env.JWT_SECRET,{expiresIn:'24h'}));\""
# id=6 → admin@procurador.com (usuario admin en DB)
```

### Backend API — desde el dashboard
El check de la API se ejecuta **desde el servidor** (no requiere Chrome):
- Dashboard → sección 🧪 Diagnóstico → **Backend API** → botón **▶ Ejecutar**
- O por cURL: `POST https://api.procuradortool.com/admin/smoke-tests/run-api` (requiere Bearer token admin)

### Resultados y logs
| Tipo | Dónde |
|------|-------|
| Tiempo real | Consola del terminal |
| Dashboard | Portal admin → 🧪 Diagnóstico (3 tarjetas: Backend API · Portal PJN · Extensión Chrome) |
| JSON persistido | `backend-server/data/smoke-test-results.json` en el servidor |
| Log local | `electron-app/logs/smoke-pjn-YYYYMMDD-HHMMSS.log` |

### Grupos de checks (48 total)
| Grupos | Solapa dashboard | ¿Qué verifica? |
|--------|-----------------|----------------|
| **D** — SCW consulta + 4 secciones (D1–D10) | → "Portal PJN" | Login SSO · LETRADO/PARTE/FAVORITOS · formulario búsqueda |
| **E** — Escritos 1 + informe completo (E1–E14) | → "Portal PJN" | Expediente FCR 18745/2017 · actuaciones · pestañas · click "Presentar escrito" → nueva pestaña |
| **F** — Escritos 2 `escritos.pjn.gov.ar/nuevo` (F1–F8) | → "Extensión Chrome" | Formulario MUI · selección FCR · relleno número/año |
| **G** — Notificaciones `notif.pjn.gov.ar/nueva` (G1–G8) | → "Extensión Chrome" | Ídem Escritos 2 |
| **H** — DEOX `deox.pjn.gov.ar/nuevo` (H1–H8) | → "Extensión Chrome" | `input[name="camara"]` · selección FCR · relleno número/año |

---

## 📘 Guía simple de Git y GitHub (explicado sin tecnicismos)

### ¿Qué es Git?
Pensá en Git como un "**Guardar con historial**" para todo el proyecto. Cada vez que hacés cambios importantes, sacás una **"foto"** del estado del proyecto. Si algo se rompe, volvés a cualquier foto anterior. Las "fotos" se llaman **commits**.

### ¿Qué es GitHub?
GitHub es el **lugar en la nube** donde se guardan esas fotos. Es como Google Drive pero para código. El repo privado asegura que nadie más que vos lo vea.

### ¿Qué es una rama (branch)?
Una rama es una **"realidad paralela"** del proyecto. Imaginá que estás trabajando en un libro y querés probar un final alternativo sin borrar el actual: hacés una copia ("rama"), experimentás ahí, y si te gusta lo fusionás con el libro original.

En nuestro caso: la rama principal (`main`) siempre tiene el código que funciona. Si querés probar un rediseño UI sin romper la app actual, creás una rama `redesign-ui`, trabajás ahí, y cuando esté listo la fusionás a `main`.

---

### Diccionario rápido de comandos

| Lo que querés hacer | Comando | Qué pasa |
|---|---|---|
| Ver si hay cambios sin guardar | `git status` | Lista archivos modificados |
| Ver detalle de los cambios | `git diff` | Muestra línea por línea qué cambió |
| Sacar una "foto" del estado actual | `git add .` + `git commit -m "texto"` | Guarda todos los cambios localmente |
| Subir las fotos a GitHub | `git push` | Respaldo en la nube |
| Bajar cambios desde GitHub | `git pull` | Trae lo que esté más nuevo en GitHub |
| Ver historial de fotos | `git log --oneline` | Lista todos los commits |
| Crear una realidad paralela | `git checkout -b nombre-rama` | Nueva rama, te movés a ella |
| Volver a la rama principal | `git checkout main` | Volvés al código estable |
| Fusionar una rama en main | `git merge nombre-rama` | Trae los cambios a main |
| Ver qué rama estoy usando | `git branch --show-current` | Muestra el nombre |
| Listar todas las ramas | `git branch -a` | Locales + remotas |

---

### Escenarios comunes explicados

#### 🟢 Escenario 1: Hice un cambio chico, quiero guardarlo
```bash
git status                           # ver qué cambió
git add .                            # marcar todos los cambios para guardar
git commit -m "corregir texto login" # sacar la foto con un nombre
git push                             # subir a GitHub
```

#### 🟢 Escenario 2: Voy a arrancar un cambio grande (ej: rediseño UI)
```bash
git checkout -b redesign-ui          # crear rama nueva
# ... hago cambios y pruebas ...
git add .
git commit -m "aplicar nueva paleta"
git push -u origin redesign-ui       # subir la rama a GitHub (primera vez)

# cuando todo funciona bien y quiero fusionar:
git checkout main                    # volver a main
git merge redesign-ui                # traer los cambios
git push                             # subir main actualizado
```

#### 🟡 Escenario 3: La cagué, quiero deshacer el último cambio SIN guardar
```bash
git checkout -- archivo.js           # descarta cambios en un archivo
git checkout -- .                    # descarta TODOS los cambios sin commitear
```

#### 🟡 Escenario 4: Ya guardé una foto mala, quiero deshacerla
```bash
git log --oneline                    # ver las fotos, copiar el hash de la buena
git reset --hard <hash-de-la-buena>  # volver a esa foto (CUIDADO: pierde todo lo posterior)
```

#### 🟢 Escenario 5: Quiero ver cómo estaba el proyecto hace 3 commits
```bash
git log --oneline                    # ver la lista
git checkout <hash>                  # moverse a esa foto (modo "solo lectura")
git checkout main                    # volver al presente
```

---

### Reglas de oro para no arruinar nada

1. **Antes de empezar a trabajar**, hacé `git pull` → así traés lo último de GitHub
2. **Antes de cambiar de rama**, hacé `git status` → si hay cambios sin guardar, commiteá o descartá primero
3. **Nunca hagas `git push --force`** — puede borrar el trabajo de GitHub. Si alguna vez te digo de usarlo, te aviso primero
4. **Commiteá seguido**, no esperes a terminar toda una feature. Mejor 10 commits chicos que 1 gigante
5. **Los mensajes de commit** deben describir **qué** cambió, no **cómo**. Ej: `corregir login falla en Safari` ✅ vs `cambiar línea 42 de login.js` ❌

---

### Cómo escribir un buen mensaje de commit

Formato recomendado (convencional):
```
tipo: descripción corta en minúscula

- detalle adicional si hace falta
- otro detalle
```

**Tipos comunes:**
| Tipo | Cuándo usarlo |
|---|---|
| `feat:` | Nueva funcionalidad |
| `fix:` | Corrección de bug |
| `docs:` | Cambios en documentación |
| `style:` | Cambios de estilo/formato (no lógica) |
| `refactor:` | Reorganización de código sin cambiar comportamiento |
| `chore:` | Tareas de mantenimiento, configs |
| `test:` | Agregar o corregir tests |

**Ejemplos reales de este proyecto:**
- `feat: agregar alerta de actualizacion de extension en Electron`
- `fix: corregir FLOW_ALIASES en notif de extension`
- `docs: actualizar seccion Git del CLAUDE.md`
- `refactor: dividir renderer.js en modulos separados`

---

### ¿Dónde veo mis commits en la web?

En cualquier momento podés abrir: https://github.com/jberger19186/procurador-tool/commits/main

Ahí ves el historial completo con fecha, autor, mensaje y qué archivos cambiaron. Es como el "undo/redo" de Word pero muchísimo más potente.
