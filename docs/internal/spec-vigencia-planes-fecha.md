# Especificación — Vigencia de planes por fecha (retiro de plan) + recuperación de cuentas

> Redactado 2026-06-26. Objetivo: ofrecer planes/promos con **fecha de retiro**, con acceso
> y cobro sincronizados, y eliminar el "callejón sin salida" de las cuentas dadas de baja.
>
> **Estado de implementación:**
> - ✅ **Fase 1 (bajo riesgo, sin tocar cobro) — HECHA** (2026-06-26, commit `678c92b`): botón de "vencimiento real del plan" en el panel, herencia de `plan_expiry_date` en altas nuevas, y `cancelled` retornable desde el portal (re-suscripción por checkout real). Ver §7 puntos 5, 6, 7.
> - ✅ **Fase 2 — NÚCLEO HECHO** (2026-06-27, commit `30c59d6`, **validado E2E en staging**): cron de retiro respeta el período pago + **pausa el cobro en MP**, corte al fin del período → `suspended_plan_expired` con gracia 7d, aviso a 7 días. Ver §7 puntos 1, 2, 4. **Dormido en prod** hasta que un admin setee `plan_expiry_date`.
> - ✅ **Fase 2 — Change 3 (reactivación real) HECHO** (2026-06-27, commit `9939474`): la reactivación de un `suspended_plan_expired` ya **no es gratis** — el usuario elige un plan activo y paga por checkout de MP (`/checkout/init` alinea el plan elegido; el webhook reactiva al cobrar). `change-plan` ya no permite `suspended_plan_expired`. **Fase 2 completa.** Ver §7 punto 3.

---

## 1. Contexto / problema

`plan_expiry_date` existe desde la migración `001_flujo_usuario_v2.1.sql` como el mecanismo de
"plan/promo con fecha de caducidad", pero quedó **a medias** (se diseñó antes de integrar
MercadoPago en Fase 5):

- El cron de suspensión corta **el mismo día** de `plan_expiry_date` (no respeta el período pago en curso).
- La suspensión **no toca MercadoPago** → un usuario suspendido por fecha **sigue siendo cobrado** por el preapproval.
- La "reactivación eligiendo plan" del portal es un **stub** (simula el cobro, no pasa por MP).
- No hay **botón en el panel** para setearlo y **no se hereda** en altas nuevas.
- `cancelled` es **terminal sin retorno**: el portal lo bloquea y el registro rechaza CUIT/email duplicados → para volver hace falta un admin.

---

## 2. Objetivos

1. Plan con **fecha de retiro** que **respeta el período pago en curso** (no corta a mitad de ciclo).
2. **Acceso y cobro sincronizados**: al retirar el plan, frenar el cobro en MP.
3. Ventana de **7 días estricta** para re-elegir: **app/extensión bloqueadas, portal habilitado**.
4. El vencido queda en estado **recuperable** (`suspended_plan_expired`), nunca atrapado.
5. La **baja voluntaria** (`cancelled`) deja de ser callejón sin salida: re-suscripción desde el portal.

---

## 3. Modelo de estados

| Estado | Significado | App / Extensión | Portal | Cobro MP | Cómo vuelve |
|---|---|---|---|---|---|
| `active` | Suscripción vigente | ✅ | ✅ | activo | — |
| `suspended_plan_expired` | Plan vencido/retirado, **recuperable** (no eligió uno nuevo) | ❌ | ✅ | pausado→cancelado | Elige plan vigente en el portal → checkout → `active`. **Sin re-registro.** |
| `cancelled` | **Baja voluntaria** (apretó "Cancelar") | ❌ | ✅ *(cambio nuevo)* | cancelado | Re-suscripción desde el portal → checkout → `active` |

> Regla de oro: **el que se vence sin elegir → `suspended_plan_expired`**; **el que cancela a propósito → `cancelled`**. Ninguno queda atrapado.

---

## 4. Flujo A — Retiro de plan por fecha (timeline)

**Setup (admin):** carga la **fecha de retiro** del plan (`plan_expiry_date`) y, cuando corresponda, marca el plan `active = false` (deja de ofrecerse).

1. **Aviso — 7 días antes:** notificación in-app + email ("tu plan se discontinúa el DD/MM; vas a tener que elegir uno nuevo").
2. **Llega la fecha de retiro → no corta nada:** se respeta el período pago en curso (si contrató 30 días, los usa completos).
3. **Fin del período pago (su `next_billing_date`/`expires_at` posterior a la fecha):**
   - Se **pausa el cobro** en MP (no se renueva el plan viejo).
   - Cuenta → **`suspended_plan_expired`** (app/extensión ❌, portal ✅).
   - Arranca **ventana de 7 días** (`payment_grace_ends_at = fin_período + 7d`).
   - El plan viejo ya **no es elegible** (`active = false`).
4. **Si elige un plan nuevo (dentro o fuera de los 7 días):** pasa por el **checkout real**, se cobra el **precio del plan nuevo**, se **cancela el preapproval viejo y se crea uno nuevo** (single-active) → `active`, historial intacto.
5. **Si pasan los 7 días sin elegir:** se **cancela el preapproval en MP** (para que no reviva), pero la cuenta **queda en `suspended_plan_expired`** (recuperable). Datos intactos.
6. **Día 10 / 3 meses después:** entra al portal, elige un plan vigente, paga → `active`. Sin re-registro, con todo su historial.

> El flujo A **nunca** llega a `cancelled` automáticamente.

---

## 5. Flujo B — Cancelación voluntaria (con puerta de vuelta)

1. Usuario aprieta **"Cancelar suscripción"** (portal → Facturación, ya existe → `/usuarios/api/checkout/cancel`).
2. Se programa la baja a fin de período (`cancel_at`) y se **pausa** el preapproval (reversible). Conserva acceso hasta `cancel_at`; puede **Reactivar** sin costo.
3. Si llega `cancel_at` **sin** reactivar → cron lo pasa a **`cancelled`** y cancela el preapproval en MP.
4. **CAMBIO NUEVO:** un `cancelled` **puede entrar al portal** y **re-suscribirse** (elige plan vigente → checkout → `active`). "Corte limpio, pero con la puerta abierta."

---

## 6. Piezas que se reutilizan (ya existen y están probadas)

- `cancelSubscription()` (`services/subscriptionService.js`) → **pausa el preapproval en MP**.
- `createPreapproval` / `createReactivationPreapproval` + lógica **single-active** → cobro real del plan nuevo + cancela el viejo.
- `plans.active = false` → el plan retirado **desaparece** de la lista (el endpoint de planes y `/users/change-plan` ya filtran por `active`).
- `payment_grace_ends_at` + patrón de cron de gracia → **ventana de 7 días**.
- `/usuarios/api/checkout/cancel` (botón "Cancelar suscripción") y `/checkout/reactivate` → ya existen.
- Crons de aviso (`server.js`, 08:00/08:05 ART) → reusar para el aviso de 7 días.
- `/users/change-plan` (permite `active` y `suspended_plan_expired`) → base de la re-selección.

---

## 7. Cambios concretos a implementar (acotados)

> Leyenda: ⏳ = pendiente · ✅ = hecho (📅 fecha/commit).

1. ✅ (2026-06-27 `30c59d6`) **Cron de retiro a fin de período (no mismo día):** cron 5c — si `plan_expiry_date` pasó, **pausa el cobro en MP** (`pausePreapproval`) y programa `cancel_at = fin de período`; si el período ya terminó, suspende ya con gracia 7d. El paso a `suspended_plan_expired` al vencer `cancel_at` lo hace 5f.
2. ✅ (2026-06-27 `30c59d6`) **Aviso a 7 días antes** (cron 5b: 30→7 días).
3. ✅ (2026-06-27 `9939474`) **Reactivación real (stub eliminado):** el vencido elige un plan activo → `/checkout/init` **alinea la suscripción al plan elegido** (`plan`/`plan_id`/`plan_expiry_date`) y cobra por MP; el webhook reactiva (`registration_status='active'`, `applyRenewal`). `change-plan` ya **no** acepta `suspended_plan_expired` (era stub gratis). El portal enruta el vencido a `initCheckout(plan)`.
4. ✅ (2026-06-27 `30c59d6`) **Fin del período → estado recuperable:** cron 5f bifurca por `plan_expiry_date` → retiro de plan = `suspended_plan_expired` + gracia 7d (NO `cancelled`). *Decisión:* el preapproval queda **pausado** (no cobra); no se cancela terminal a los 7 días — al reactivarse con plan nuevo, single-active limpia el viejo. La gracia 7d es informativa (el acceso ya se cortó al fin del período).
5. ✅ **`cancelled` retornable:** `portal-login` ya permite `cancelled` (solo bloquea `rejected`); el portal ya tenía el camino de re-suscripción (`isCancelledExpired` → "Nueva suscripción" → checkout real). La reactivación-stub gratis **no** se usa para `cancelled`. App/extensión siguen bloqueadas.
6. ✅ **Heredar `plan_expiry_date` en altas nuevas:** el INSERT de registro (`auth.js`) copia `plan.plan_expiry_date` (NULL si el plan no tiene).
7. ✅ **Botón en el panel admin** para `PUT /admin/plans/:id/expiry` (form de plan → "Vencimiento real del plan", con advertencia de que aún no cancela MP).

---

## 8. Decisiones tomadas (cerradas)

- Vencimiento de plan → `suspended_plan_expired` (recuperable, sin re-registro).
- Baja voluntaria → `cancelled` (terminal **pero retornable** desde el portal).
- Ventana de 7 días **estricta**: durante esos días **solo entra a la web**, la app **no** se puede usar.
- **Aviso 7 días antes** del corte.
- Al elegir plan nuevo: **cancelar la suscripción/preapproval anterior y generar uno nuevo** con el **precio del plan nuevo** (puede o no coincidir).
- El flujo A nunca cae en `cancelled` automáticamente.

---

## 9. Decisiones pendientes (a confirmar antes de implementar)

- **Retención de datos** del que nunca vuelve: hoy es **indefinida** (no hay borrado ni liberación de CUIT — el job de 90 días está sin construir). ¿Definir un cierre/borrado a X días? ¿Liberar CUIT para permitir re-registro "desde cero"? *(Con `cancelled` retornable esto deja de ser urgente.)*
- ¿El vencido que nunca vuelve permanece **para siempre** en `suspended_plan_expired`, o a los N días pasa a un estado "dormido"? (Default sugerido: permanece, es lo más simple y amable.)

---

## 10. Verificación / pruebas E2E (cuando se implemente)

Usando el usuario de prueba y forzando fechas en DB:

1. **Retiro respeta período:** setear `plan_expiry_date` en el medio del período → confirmar que **NO** suspende hasta el fin del período.
2. **Corte + MP:** al fin del período → cuenta `suspended_plan_expired`, app bloqueada, portal OK, **preapproval pausado en MP**, `payment_grace_ends_at = +7d`, plan viejo no elegible.
3. **Reactivación real:** elegir plan nuevo → **cobro real** en MP por el precio nuevo, preapproval viejo cancelado, cuenta `active`, historial intacto.
4. **Post-7-días:** dejar vencer la ventana → preapproval **cancelado** en MP, cuenta **sigue** en `suspended_plan_expired` (recuperable).
5. **Baja voluntaria:** "Cancelar suscripción" → reversible hasta fin de período → cron → `cancelled` + MP cancelado → **re-suscribir desde el portal** → `active`.

---

## 11. Riesgos / cuidados

- **No romper el cobro mensual existente** (el flujo recurrente normal). Probar en **staging** + backup `.7z` + tag de recupero antes de tocar prod.
- **Idempotencia** de los crons (no doble-procesar ni doble-cobrar).
- Cancelar el preapproval en MP solo cuando corresponde (guardas como en el cron de cancelaciones vencidas, que ya verifica pagos recientes).
- Mantener separado **acceso** (login) de **cobro** (MP), pero que **se muevan juntos** en estos eventos.
