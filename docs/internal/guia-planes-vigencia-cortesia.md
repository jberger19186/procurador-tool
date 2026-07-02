# Guía de comportamiento — Vigencia de planes, Público/Privado y Cortesía $0

> Estado: **en producción** al 2026-07-02. Validado E2E (T1–T13, incluye ciclo MercadoPago sandbox real).
> Referencias de código: `routes/admin.js` (POST /admin/subscriptions, POST /admin/users, CRUD planes),
> `routes/auth.js` (verify-email, plan-availability), `routes/usuarios.js` (/plans), `routes/users.js`
> (/change-plan), `routes/checkout.js` (reactivación), `services/subscriptionService.js`
> (updatePreapprovalAmount, pausePreapproval, cancel/reactivate), `server.js` (crons `5 11` retiro y
> `25 11` downgrade). Spec original de vigencia: `docs/internal/spec-vigencia-planes-fecha.md`.

---

## 1. Vigencia de planes por fecha — ¿se respetan los días pagos?

**Sí.** En el formulario del plan (dashboard → Planes) hay DOS fechas que NO hay que confundir:

| Campo | Qué hace |
|---|---|
| **"Tipo de límite" (promoción por fecha)** | **Solo aviso.** Muestra un banner al usuario ("tu promo vence el…"). No corta acceso ni cobro. |
| **"⏳ Vencimiento real del plan"** (`plans.plan_expiry_date`) | **Corte real.** Al guardarlo se propaga a las suscripciones **activas** de ese plan (`subscriptions.plan_expiry_date`) y lo enforcea el cron. |

### Flujo con el ejemplo: contrató 01/07, plan vence 10/07, período de 30 días

1. **El 10/07** el cron de retiro (`5 11 * * *`, `server.js`) detecta `plan_expiry_date < NOW()` y:
   - **Pausa el cobro en MercadoPago** (`pausePreapproval`) → no se cobra la renovación del plan discontinuado.
   - **Respeta el período ya pago**: como el período va hasta el 31/07 (01/07 + 30 días), programa `cancel_at = 31/07`. El usuario **sigue usando todo con normalidad** hasta esa fecha; ve un aviso de que el plan se discontinúa.
2. **Al terminar los 30 días** (31/07): el cron `25 11`/`5f` pasa la cuenta a **`suspended_plan_expired`** (estado **recuperable**, no terminal):
   - No puede **ejecutar** (app/extensión bloqueadas).
   - **Sí puede entrar al portal**, donde se le ofrece **reactivar eligiendo un plan público vigente + configurar pago** (checkout real de MP). Al pagar, la cuenta se reactiva con el plan elegido y se limpia el `plan_expiry_date` del plan retirado.
3. **Caso borde**: si al llegar `plan_expiry_date` el período pago **ya había terminado**, no hay nada que respetar → suspende de inmediato con **ventana de gracia de 7 días**.

> Resumen: `plan_expiry_date` marca **cuándo se retira el plan**, pero el **corte de acceso respeta el período pago en curso** (`next_billing_date`/`expires_at`). El cobro en MP se pausa apenas se dispara el retiro.

---

## 2. Planes públicos vs privados — alcance

El campo **Visibilidad** (`plans.visibility`, valores `public` / `private`) controla **una sola cosa**: **dónde el usuario puede ELEGIR el plan**.

Un plan **privado**:
- ❌ **No aparece** en el formulario de **registro público** (`GET /auth/plan-availability`).
- ❌ **No aparece** en el **selector del portal** (cambio de plan, checkout, reactivación) (`GET /usuarios/api/plans`).
- 🔒 **No puede autoasignárselo** el usuario ni manipulando la request: blindado server-side en los 3 puntos que validan plan por nombre (`/auth/register`, `/users/change-plan`, `/checkout/init` reactivación) con `AND visibility = 'public'`.
- ✅ **El admin lo ve y lo asigna** con normalidad (ficha → Cambiar plan, alta de usuario, form de Planes — `GET /admin/plans` NO filtra por visibilidad).
- ✅ El usuario que **ya tiene asignado** un plan privado **ve sus límites y su plan con total normalidad** en la app, Mi Cuenta y Mi Plan — esos endpoints leen **su suscripción**, no la lista de planes elegibles. La visibilidad no le oculta nada de lo suyo.

**Independiente de Activo/Inactivo:** un plan puede ser público-inactivo (los "Próximamente": BASIC/PRO/ENTERPRISE) o privado-activo (ej. CORTESIA). Migración: `20260630_plan_visibility.sql` (default `public` → sin cambio para planes preexistentes).

---

## 3. Plan de costo $0 (cortesía) — los tres escenarios

**Regla:** un plan con **precio EXPLÍCITO $0** (`price_ars = 0`, **no** null) dispara el modo **cortesía**. El campo **"días"** (al lado del selector de plan) define la **vigencia** (`plan_expiry_date = hoy + días`). Un plan **sin precio (null**, ej. BASIC/PRO/ENTERPRISE) **NO** es cortesía — sigue la lógica normal.

### a) Usuario que YA pagó el mes ✅ (validado E2E contra MP sandbox real — T12)
- Al asignar el plan $0 (ficha → Cambiar plan): **aplica de inmediato**, fija la vigencia y **PAUSA el preapproval en MercadoPago** (`pausePreapproval`) → no se le cobra más mientras dure la cortesía.
- ⚠️ **Matiz importante:** la cortesía **empieza HOY**, no espera a que terminen los 30 días ya pagos. En la práctica el usuario no pierde nada (deja de pagar ya y conserva acceso), pero si querés que la ventana "gratis" corra **después** de sus días pagos, poné en el campo días = **días pagos restantes + días de regalo** (ej. le quedan 20 pagos y querés regalar 30 → poné **50**).

### b) Usuario en TRIAL ✅
- Mismo mecanismo: plan $0 + días → **aplica ya**, la cuenta sale del trial y queda **activa** con la vigencia. No hay preapproval de MP que pausar.

### c) Usuario creado por el ADMIN ✅ (validado con `jberger_86@hotmail.com`, id 237)
- En el alta (botón "＋ Agregar usuario") se le asigna el plan $0 + días → recibe email con credenciales + link de verificación → **al verificar el email queda directamente ACTIVO** con la cortesía corriendo hasta la fecha (lógica en `verify-email`: `admin_created && precio explícito 0 → active`).

### Final común a los tres casos
Al vencer la vigencia (`plan_expiry_date`): → cron → **`suspended_plan_expired`** → el portal ofrece **elegir un plan público + configurar pago** para continuar. Todo queda en el **Historial de la cuenta** (`user_events`: `courtesy_plan_assigned_by_admin` con `{plan, dias, expiry, was_paying, admin_id}`, `user_created_by_admin`, etc.).

---

## Notas operativas

- **Cambio de plan por admin (planes pagos):** upgrade → inmediato + `updatePreapprovalAmount` ajusta el monto en MP desde el próximo cobro (no cobra diferencia ni reembolsa). Downgrade → **programado a fin de ciclo** (`scheduled_plan`, cron `25 11`), conserva límites altos hasta entonces.
- **Cancelar al fin de ciclo (admin):** botón en la ficha → pausa el preapproval en MP + `cancel_at`; **reversible** con "Deshacer cancelación" (reanuda el preapproval, sin cobro nuevo). Ambos quedan en el historial.
- **Precio del plan y MP:** `updatePreapprovalAmount` lee `price_ars` de la tabla `plans` (habilita cobrar planes privados con precio propio). Precio 0/null → no ajusta MP (no hay cobro).
- **Constraint eliminada:** `check_plan_valid` (que restringía `subscriptions.plan` a 5 nombres hardcodeados) fue removida (`20260701_drop_check_plan_valid.sql`); la integridad la da el FK `plan_id`.
