# Plan Fase 5 — Cobranza (MercadoPago + Facturante)

## Context

Procurador SCW es un SaaS argentino con backend Express + PostgreSQL en producción. Los usuarios hoy se registran, son activados manualmente por admin y reciben 20 usos de trial. El plan original de Fase 5 en `docs/internal/proximos-pasos.md` tenía varios desajustes respecto al estado real del código (DB ya parcialmente migrada, stub `renderFact()` ya existente, cron jobs ya activos, sin `services/` aún).

Objetivo: integrar **MercadoPago** (suscripción recurrente con tarjeta tokenizada vía `preapproval`) + **Facturante** (emisión de factura tipo C monotributo) para cobrar automáticamente los planes EXTENSION_PROMO ($1.500/mes) y COMBO_PROMO ($15.000/mes), respetando el flujo de activación manual existente.

---

## 🚧 ANTES DE EMPEZAR — Bloqueantes a resolver

> Esta sección se chequea PRIMERO cuando se invoca el plan. Si hay items sin resolver,
> Claude debe listarlos al usuario y pedir confirmación antes de tocar código.

### 🔴 Externos (gestión fuera del código)

| # | Pendiente | Bloqueante para | Acción requerida |
|---|---|---|---|
| P-1 | Cuenta MP Argentina + app developers | Ítem 5.2 | https://mercadopago.com.ar → `ACCESS_TOKEN` sandbox+prod, `PUBLIC_KEY`, `WEBHOOK_SECRET` |
| P-2 | Registrar webhook URL en panel MP | Ítem 5.2 | Panel Developers → Notificaciones → `https://api.procuradortool.com/webhooks/mercadopago` |
| P-3 | Contratar Facturante Pack 50 (~USD 6/mes) | Ítem 5.3 | https://facturante.com → WSDL homol+prod URLs, Usuario, Hash, Empresa ID |
| P-4 | Confirmar nombres exactos campos SOAP de respuesta Facturante | Ítem 5.3 | Onboarding Facturante: `Estado`, `IdComprobante`, `CAE`, `Numero`, `URLPDF` |
| P-5 | Confirmar si Facturante tiene webhooks salientes | Ítem 5.3 | Si no → polling con cron de reintentos (ya diseñado) |
| P-6 | Snapshot DigitalOcean pre-Fase 5 | Pre-Fase 5 | Panel DO → Droplets → Snapshots → "Take Snapshot" |

### 🟡 Internos (decisiones de producto)

| # | Pendiente | Bloqueante para | Decisión a tomar |
|---|---|---|---|
| D-1 | Precio final ARS | Ítem 5.2 `.env` | ✅ Confirmado: EXTENSION_PROMO=$1.500, COMBO_PROMO=$15.000 |
| D-2 | Días de gracia tras pago rechazado | Ítem 5.2 webhook | Actualmente 3 días — ¿confirmar? |
| D-3 | Días mínimos para reembolso proporcional | Ítem 5.5 modal | ¿Reembolsar si quedan menos de N días? (ej. < 1 día → no reembolsar) |
| D-4 | BASIC/PRO/ENTERPRISE durante Fase 5 | Ítem 5.2 | Inactivos en DB durante Fase 5. Activar en lanzamiento público |
| D-5 | `INVOICE_ADMIN_ALERT_EMAIL` | Ítem 5.3 `.env` | ¿`jberger19186@gmail.com`? |
| D-6 | Tope máximo de usos extra por ciclo | Ítem 5.6 | ¿Hay límite? (ej. no más de 2× el plan base) |

### ✅ Ya decididos
- SDK: `mercadopago@3` (no PagoKit)
- SOAP para Facturante: `npm install soap`
- Factura tipo C (monotributista, sin IVA)
- Trial bonus: primer mes = `plan_limit + 20`
- Feature flag `PAYMENT_MODULE_ENABLED=false` durante desarrollo
- Tabla `usage_extras` separada (opción B, más auditable)
- Backup: pg_dump + tag Git + snapshot DO antes de empezar
- Endpoint `/admin/subscriptions/:userId/suspend` ya existe (admin.js:881) — se modifica, no se crea

---

### Decisiones tomadas (con el usuario)

| # | Decisión | Resolución |
|---|---|---|
| 1 | PagoKit como scaffolding | **Saltar.** SDK oficial `mercadopago@3` directo |
| 2 | Planes en MP al inicio | Solo EXTENSION_PROMO + COMBO_PROMO |
| 3 | Condición fiscal | **Monotributista** → Factura tipo C, sin IVA discriminado |
| 4 | Trial vs pago primer mes | **Suman:** primer mes `usage_limit_plan + 20 trial` |
| 5 | Endpoint admin activate | **Ajuste mínimo.** No cambia el flujo del admin; solo deja de resetear `usage_count=0` y `usage_limit=plan_limit` al activar. El plan_limit se aplica recién al webhook del primer pago. |

---

## 📚 Documentación oficial relevada (validada vía WebFetch)

### MercadoPago (Argentina)

- **SDK Node.js oficial:** `mercadopago@3.0.0` (publicada 2026-05-21) · GitHub: https://github.com/mercadopago/sdk-nodejs
- **Endpoint preapproval:** `POST https://api.mercadopago.com/preapproval`
- **Doc preapproval (Suscripción sin plan asociado):** https://www.mercadopago.com.ar/developers/en/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments
- **Doc webhooks:** https://www.mercadopago.com.ar/developers/en/docs/checkout-api-orders/notifications

**JSON body verificado para preapproval (Argentina):**
```json
{
  "back_url": "https://api.procuradortool.com/usuarios/#facturacion?status=ok",
  "reason": "Procurador SCW — COMBO_PROMO",
  "external_reference": "user_<id>_<timestamp>",
  "payer_email": "<user_email>",
  "auto_recurring": {
    "frequency": 1,
    "frequency_type": "months",
    "start_date": "<ISO8601>",
    "end_date": "<ISO8601 opcional>",
    "transaction_amount": 15000,
    "currency_id": "ARS"
  },
  "status": "pending"
}
```
Respuesta incluye `id` (preapproval id) e `init_point` (URL del checkout). El usuario abre `init_point`, ingresa su tarjeta, y MP dispara webhook al volver.

**Webhook x-signature — algoritmo validado:**
- Header: `x-signature: ts=1742505638683,v1=ced36ab6...`
- Manifest template literal: `id:[data.id];request-id:[x-request-id];ts:[ts];`
- Validación: `crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex') === v1`
- `data.id` debe normalizarse a lowercase
- **Timeout webhook: 22 segundos** — nuestro endpoint debe responder 200/201 en menos
- **Reintentos MP:** cada 15 min si no responde 200, hasta entrega exitosa
- ⚠️ El SDK v3 **no incluye helper de validación de firma** — implementarlo manualmente con `crypto`

**Idempotencia client-side:** `MercadoPagoConfig` acepta `{ accessToken, options: { idempotencyKey, timeout: 5000 } }` — útil para evitar dobles creaciones de preapproval en el lado nuestro.

---

### Facturante (Argentina)

- **Doc oficial:** https://www.facturante.com/Developers/ComoComenzar
- **Endpoint comprobante completo:** https://www.facturante.com/Developers/CrearComprobanteFull
- **Endpoint comprobante simple (recomendado para monotributo):** https://www.facturante.com/Developers/CrearComprobanteSinImpuestos

**⚠️ HALLAZGO CRÍTICO:** Facturante es **SOAP (XML), NO REST/JSON** como asumía el plan original.
- Tecnología: Web Service SOAP — requiere cliente SOAP en Node.js (`soap` npm o `easy-soap-request`)
- **No tienen SDK oficial Node.js** — escribimos el wrapper nosotros
- **URLs de homologación y producción NO son públicas** — se obtienen al contratar el servicio (solicitar al onboarding)
- Soporta webhooks salientes para notificar estado de comprobante — útil para no polling

**Schema mínimo verificado para Factura C (monotributo):**
```
Autenticacion: { Usuario, Hash (password), Empresa (int) }
Cliente:
  - NroDocumento (CUIT del cliente, max 13 chars)
  - RazonSocial (max 500)
  - DireccionFiscal (max 250) REQUIRED
  - CodigoPostal (10 chars) REQUIRED
  - TipoDocumento: 6 (CUIT) o 1 (DNI)
  - TratamientoImpositivo: 3 (CONSUMIDOR FINAL — caso típico para B2C SaaS)
  - CondicionPago: 1 (Contado)
Encabezado:
  - Prefijo: "0001" (punto de venta zero-padded)
  - TipoComprobante: "FC" (Factura C)
  - FechaHora: <datetime>
  - FechaVtoPago: <datetime>
  - Moneda: 2 (PESOS)
  - CondicionVenta: 1 (Contado)
  - Bienes: 2 (Servicios) ← Procurador es SaaS
Items: [{
  Detalle: "Suscripción Procurador SCW — COMBO_PROMO (mes <YYYY-MM>)",
  Cantidad: 1,
  PrecioUnitario: 15000,
  IVA: 0,             ← monotributo no discrimina IVA
  Gravado: false
}]
```

**Respuesta documentada:**
- `Estado` (int) — código de status
- `Mensaje` (string) — descripción
- `IdComprobante` (int) — identificador único
- (CAE, número de comprobante y PDF URL vienen en respuesta full — verificar contra Facturante al obtener credenciales)

**Códigos de error a manejar:** 1 (auth null), 11 (PV inválido), 15 (sin items), 18 (monto inválido), 500/501 (error interno) → reintentar; resto → no reintentar y alertar.

---

## Flujo completo del usuario (registro → plan vigente)

> Referencia canónica del ciclo de vida. Todos los ítems de Fase 5 deben respetar este flujo.

### Paso a paso

1. **Registro** — El usuario completa el formulario público (`/register/`).
   - `users.registration_status = 'pending_email'`
   - `subscriptions.status = 'suspended'`, `usage_limit = 20`, `usage_count = 0`
   - Se envía email de verificación.

2. **Validación de email** — El usuario hace click en el enlace de verificación.
   - `users.registration_status = 'pending_activation'`
   - `subscriptions` **no cambia** — sigue `suspended`, `usage_limit = 20`
   - Notificación in-app: *"Tu email fue verificado. Tenés 20 usos de prueba disponibles."*
   - ✅ **Los 20 usos de prueba se activan aquí — no antes ni después.**

3. **Admin decide** — El admin revisa la cuenta en el panel:

   | Acción admin | `registration_status` | `subscriptions.status` | Usos trial |
   |---|---|---|---|
   | **Activar** | `active` | `active` | ⚠️ ver nota abajo |
   | **Rechazar (block)** | `rejected` | `cancelled` | ❌ cancelados |
   | **Rechazar (keep_trial)** | sin cambio (`pending_activation`) | sin cambio (`suspended`) | ✅ preservados |
   | **Suspender** (post-activación) | sin cambio | `suspended` | ✅ preservados |

   > **⚠️ Cambio requerido en Fase 5 — endpoint `/admin/users/:userId/activate`:**
   > Hoy el endpoint hace `usage_count = 0` y `usage_limit = plan_limit` (ej. 50 usos), otorgando el plan
   > completo sin cobro. En Fase 5 debe hacer **solo** `status = 'active'` y extender `expires_at`, sin
   > tocar `usage_count` ni `usage_limit` (quedan en 20 trial). El salto a `plan_limit + 20` ocurre
   > únicamente cuando el webhook de MP confirma el primer pago. Cambio mínimo de código, sin impacto
   > en el flujo del admin.

4. **Usuario configura medio de pago** — El usuario abre `/usuarios/#facturacion` y completa el checkout MP.
   - `POST /usuarios/api/checkout/init { plan_name }` → devuelve `init_point` (URL de MP).
   - Usuario abre `init_point` y completa el flujo en MP con su tarjeta.
   - MP cobra inmediatamente la primera cuota → dispara webhook `payment.approved` a nuestro servidor.
   - MP redirige al usuario al `back_url` → su navegador hace `POST /usuarios/api/checkout/confirm { preapproval_id }`.
   - **El endpoint confirm solo guarda** `external_subscription_id` + `payment_provider='mercadopago'`. NO aplica trial bonus.

5. **Primer pago aprobado** — Webhook MP `payment.approved` (puede llegar antes o después del confirm).
   - `subscriptions.usage_limit = plan_limit + 20` (trial bonus, decisión #4)
   - `subscriptions.trial_bonus_until = next_billing_date` (fin del primer período pago)
   - `subscriptions.usage_count = 0` (nuevo ciclo de plan)
   - `subscriptions.last_payment_at = NOW()`, `next_billing_date = NOW() + 30d`
   - Encola factura Facturante.
   - ✅ **El plan queda vigente aquí.** El usuario tiene `plan_limit + 20` usos durante el primer mes.
   - Idempotencia garantizada por `webhook_events(provider, external_id) UNIQUE`.

6. **Renovación mensual (segundo pago y siguientes)** — Webhook MP `payment.approved` en ciclo normal.
   - Si `trial_bonus_until < NOW()`: `usage_limit = plan_limit` (sin bonus)
   - `usage_count` se resetea a 0 por período.

---

### Flujos adicionales durante la vida del plan

#### Cancelación voluntaria (usuario)
- El usuario hace clic en "Cancelar suscripción" en `/usuarios/#facturacion`.
- `POST /usuarios/api/checkout/cancel` ejecuta inmediatamente:
  1. **Cancelar preapproval en MP** (`PATCH /preapproval/{id} { "status": "cancelled" }`) → el próximo período **no se cobra**.
  2. `subscriptions.cancel_at = next_billing_date` — el acceso sigue activo hasta esa fecha.
  3. Email al usuario: "Acceso hasta DD/MM/YYYY. No se realizarán cobros adicionales."
- `registration_status` sigue `active` hasta que el cron `cron-cancelacion-cumplida` (00:30 diario) detecte `cancel_at < NOW()` → `status = 'cancelled'`, `registration_status = 'cancelled'` → acceso revocado.
- **No hay reembolso** en cancelación voluntaria — el usuario usa el período ya pago hasta su vencimiento.
- **UI ya existe** en portal (botón "Cancelar suscripción") y muestra "Cancelación programada: acceso hasta DD/MM".

#### Suspensión por pago fallido (automática vía MP)
- Webhook `payment.rejected` → `status = 'past_due'`, `payment_grace_ends_at = NOW + 3d`, email aviso.
- Cron `cron-gracia-vencida` (cada 1h): si `payment_grace_ends_at < NOW()` → `status = 'suspended'`, `registration_status = 'suspended_plan_expired'`, email suspensión.
- Usuario puede reactivar actualizando método de pago en portal → `POST /usuarios/api/checkout/init` con nuevo preapproval.

#### Suspensión por admin (dos modos)

> ⚠️ **Regla invariable:** en AMBOS modos de suspensión, el preapproval de MP se cancela SIEMPRE
> (`PATCH /preapproval/{id} { "status": "cancelled" }`). El próximo período **nunca se cobra**,
> independientemente de la opción de reembolso que elija el admin. La decisión del admin es
> exclusivamente sobre el período ya pagado y vigente.

**Modo A — Hard suspend** (bloqueo total): `/admin/users/:userId/suspend`
- `registration_status = 'suspended_admin'`, `subscriptions.status = 'suspended_admin'`
- Preapproval MP cancelado → no hay cobro siguiente.
- El usuario queda bloqueado completamente — no puede loguearse.
- Email automático al usuario con motivo.
- El usuario puede solicitar revisión desde el portal → admin reactiva → nuevo preapproval MP requerido.
- Usar para: incumplimiento de ToS, fraude, deuda de pago.

**Política sobre período vigente en hard suspend** (admin elige una de dos):
  - **Reembolsar proporcional** (opción por defecto): calcular monto a devolver del período vigente.
    ```sql
    -- Obtener último pago aprobado del usuario:
    SELECT external_payment_id, amount_ars AS last_payment_amount
    FROM payments
    WHERE user_id = $1 AND status = 'approved'
    ORDER BY paid_at DESC LIMIT 1;
    
    -- Calcular:
    días_restantes = DATE_PART('day', expires_at - NOW())
    monto_reembolso = ROUND((días_restantes / 30.0) * last_payment_amount, 2)
    
    -- Llamar MP:
    POST /v1/payments/{external_payment_id}/refunds { "amount": monto_reembolso }
    ```
  - **No reembolsar**: documentar motivo (ej. fraude). No se llama a MP refund. El usuario pierde el período restante.
- El modal admin muestra el monto calculado de reembolso y las dos opciones con checkbox.
- Registrar decisión en `payments` (`refund_amount`, `refunded_at`, `refund_reason`) y en `admin_events`.

**Modo B — Soft suspend** (el usuario consume lo que ya pagó): `/admin/subscriptions/:userId/suspend`
- Solo cambia `subscriptions.status = 'suspended'`. **No toca `registration_status`**.
- Preapproval MP cancelado → no hay cobro siguiente.
- El auth.js permite login mientras `usage_count < usage_limit` AND `expires_at > NOW()`.
- El usuario sigue usando hasta agotar usos o vencer el período. `usage_count`/`usage_limit` intactos.
- Usar para: suspensión preventiva, deuda menor, dar tiempo para regularizar sin cortar el servicio pagado.

**Política sobre período vigente en soft suspend** (admin elige una de dos):
  - **Mantener** (opción por defecto): el usuario ya pagó, consume lo que le queda. Sin reembolso.
  - **Reembolsar proporcional**: mismo cálculo que Modo A. Raro pero posible (ej. usuario pidió la baja).
- El modal admin muestra ambas opciones con el monto calculado.

> ℹ️ **UX panel admin (Ítem 5.5):** reemplazar el botón "⏸ Suspender" actual por uno que abre modal con las dos opciones claras. El modal calcula y muestra el monto de reembolso posible en tiempo real.

---

#### Cobros adicionales / usos extra (cargo manual)

**Caso de uso:** usuario solicita usos extra vía ticket de soporte → admin los habilita y cobra el adicional.

**Flujo:**
1. Admin abre ticket del usuario → hace clic en "Agregar usos extra".
2. Admin define: cantidad de usos adicionales + precio unitario (o precio total fijo).
3. El sistema crea un **pago único** en MP (independiente del preapproval) por el monto del extra.
   - Usa `POST /v1/payments` con el token de tarjeta guardado del usuario (si tiene preapproval activo, MP mantiene el token asociado al pagador — se puede reutilizar para cobros únicos).
   - Si no hay tarjeta guardada → enviar `init_point` al usuario por email para que autorice el cobro.
4. Al confirmar el pago (webhook `payment.approved` con `external_reference = "extra_<userId>_<timestamp>"`):
   - `subscriptions.usage_limit += usos_extra`
   - Registrar en tabla `payments` con `payment_method = 'manual_extra'`.
   - Emitir factura Facturante por el monto del extra (igual que pago normal).
   - Notificación in-app y email al usuario: "Se agregaron N usos extra a tu plan."
5. Los usos extra no vencen al fin del período — persisten hasta consumirse (o hasta el `expires_at` de la suscripción).

**Tabla `usage_extras` (opción B — tabla separada, más auditable):**
```sql
CREATE TABLE IF NOT EXISTS usage_extras (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  subscription_id INT REFERENCES subscriptions(id),
  payment_id INT REFERENCES payments(id),  -- NULL si es cortesía sin cobro
  extra_uses INT NOT NULL,
  remaining_uses INT NOT NULL,
  reason TEXT,                             -- "Ticket #123 — solicitud extra"
  created_by_admin_id INT REFERENCES users(id),
  expires_at TIMESTAMPTZ,                  -- NULL = no vence
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Consideración:** si el usuario no tiene tarjeta guardada, el admin puede agregarlo **sin cobro** (gratis). En ese caso se inserta en `usage_extras` con `payment_id = NULL` y `reason = "cortesía admin"`.

#### Cambio de plan (upgrade / downgrade)
- Endpoint existente: `POST /users/change-plan { plan_name }` en `routes/users.js`.
- **Upgrade (plan más caro):** hoy es un stub — aplica en DB sin cobrar. Flujo:
  1. Cancela el preapproval viejo en MP.
  2. Crea nuevo preapproval con el monto del plan superior.
  3. Redirige al usuario al nuevo `init_point` para completar el checkout.
  4. Al confirmar pago: `plan = nuevo`, `usage_limit = nuevo_plan_limit`, `usage_count = 0`, `expires_at = NOW + 30d`.
- **Downgrade (plan más barato):** no requiere nuevo preapproval inmediato.
  - Guarda en `subscriptions.scheduled_plan` el nuevo plan + fecha.
  - El próximo webhook `payment.approved` de MP cobra el monto viejo (el preapproval viejo sigue activo).
  - Luego actualiza el preapproval en MP al nuevo monto y aplica el downgrade en DB.
- **Reactivación desde `suspended_plan_expired`:** se trata como upgrade inmediato (nuevo preapproval MP).
- Límite: 2 cambios de plan por ciclo (`plan_changes_this_cycle`).
- **En Fase 5**, el upgrade necesita gestionar la transición de preapproval en MP — agregar lógica a `subscriptionService.js`.

---

### Alertas actuales en portal y Electron (estado real del código)

| Estado | Electron `renderer.js` | Portal `app.js` |
|---|---|---|
| `pending_email` | 📧 "Verificá tu email para activar el período de prueba" | Banner naranja genérico |
| `pending_activation` | 🟡 Barra de progreso trial (X/20 usos, rojo si ≤5) | 🟡 Barra de progreso trial idéntica |
| `active` + sin `paymentProvider` | ⚠️ "Sin método de pago configurado" + botón "Ir al portal" | 🟠 Banner "Configurá tu método de pago en Facturación" |
| `active` + con `paymentProvider` | (sin banner) | (sin banner) |

**Conclusión:** las alertas de "sin pago configurado" ya existen en Electron y portal. ✅ Solo requieren que el backend devuelva `paymentProvider` en el endpoint de cuenta — actualmente la columna existe en DB pero siempre es `NULL` porque nunca se popula. Ítem 5.2 la popula al confirmar checkout (`linkPreapproval` setea `payment_provider='mercadopago'`) → banner desaparece automáticamente.

---

## Pre-Fase 5 — Preparativos

### ⚠️ Regla general de implementación
> **No romper lo que ya funciona.** Toda nueva funcionalidad se agrega detrás del feature flag
> `PAYMENT_MODULE_ENABLED` o como extensión de flujos existentes. Los flujos actuales
> (activación manual, suspensión admin, cambio de plan stub) siguen operativos sin cambios mientras
> el flag está en `false`. Antes de cualquier ítem: correr `node scripts/smoke-test-pjn.js` (48/48) y
> verificar que sigue en verde.

### Backup obligatorio antes de comenzar

**Paso 1 — Backup completo en servidor + descarga local:**
```bash
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
  "sudo -u postgres pg_dump procurador_db" \
  > "C:/Users/JONATHAN/Desktop/ProcuradorBackups/procurador_db_pre_fase5_$(Get-Date -Format yyyyMMdd).sql"
```

**Paso 2 — Tag Git:**
```bash
git tag pre-fase-5-baseline && git push --tags
```

**Paso 3 — Snapshot DigitalOcean (panel web):**
- Ingresar a https://cloud.digitalocean.com → Droplets → procurador → Snapshots
- "Take Snapshot" → nombre: `pre-fase5-YYYYMMDD`
- ✅ Permite restaurar el servidor completo si algo sale muy mal

**Paso 4 — Cuentas externas (solo necesario antes del Ítem 5.2):**
```
# MercadoPago Argentina
# Crear cuenta vendedor en https://www.mercadopago.com.ar
# Crear app en https://www.mercadopago.com.ar/developers/panel/app
#   → obtener ACCESS_TOKEN sandbox + producción, PUBLIC_KEY, WEBHOOK_SECRET

# Facturante
# Contratar Pack 50 en https://www.facturante.com (~USD 6/mes)
#   → onboarding provee: URL WSDL homologación + producción
#   → obtener: Usuario + Hash + Empresa ID
#   → confirmar nombres exactos campos respuesta SOAP (CAE/Numero/URLPDF)
#   → confirmar si soportan webhooks salientes de estado de comprobante
```

---

## Ítem 5.1 — Schema DB (1h)

**Pre:** `git tag pre-5.1-schema`

**Archivo nuevo:** `backend-server/migrations/005_fase5_payments.sql`

```sql
BEGIN;

-- Columnas ya existentes en subscriptions (no agregar):
--   next_billing_date, payment_provider, cancel_at, payment_grace_ends_at,
--   scheduled_plan, plan_changes_this_cycle, billing_paused
-- Nota: billing_paused existente queda obsoleto en Fase 5 — no se usa más,
--   se reemplaza por cancelación efectiva del preapproval en MP.

-- Columnas NUEVAS en subscriptions:
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS external_subscription_id VARCHAR(120),  -- preapproval_id de MP
  ADD COLUMN IF NOT EXISTS payment_method_id VARCHAR(120),         -- card_id de MP (últimos 4 dígitos para mostrar en UI)
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ,            -- último pago aprobado, populado por webhook
  ADD COLUMN IF NOT EXISTS auto_renewal BOOLEAN DEFAULT TRUE,      -- si false: tras cancel_at, no se crea nuevo preapproval automáticamente
  ADD COLUMN IF NOT EXISTS trial_bonus_until TIMESTAMPTZ;          -- fin del primer mes pago (controla cuando expira el bonus +20)

-- Agregar 'past_due' al check constraint existente:
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS check_status_valid;
ALTER TABLE subscriptions ADD CONSTRAINT check_status_valid
  CHECK (status IN ('active','suspended','suspended_admin','suspended_plan_expired','cancelled','past_due'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_subs_external
  ON subscriptions(external_subscription_id) WHERE external_subscription_id IS NOT NULL;

-- cuit_deleted_at es nueva (no existe en schema actual):
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cuit_deleted_at TIMESTAMPTZ;

-- admin_events ya existe en producción (Owner: postgres) — no recrear.

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  subscription_id INT REFERENCES subscriptions(id),
  external_payment_id VARCHAR(120) UNIQUE,
  amount_ars NUMERIC(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL,           -- approved, rejected, refunded, in_process
  status_detail VARCHAR(120),
  payment_method VARCHAR(40),            -- recurring, manual_extra, upgrade
  paid_at TIMESTAMPTZ,
  refund_amount NUMERIC(12,2),
  refunded_at TIMESTAMPTZ,
  refund_reason TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_payments_user ON payments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_extras (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  subscription_id INT REFERENCES subscriptions(id),
  payment_id INT REFERENCES payments(id),
  extra_uses INT NOT NULL,
  remaining_uses INT NOT NULL,
  reason TEXT,
  created_by_admin_id INT REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_extras_user ON usage_extras(user_id) WHERE remaining_uses > 0;

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  payment_id INT REFERENCES payments(id),
  user_id INT NOT NULL REFERENCES users(id),
  facturante_id VARCHAR(80),
  invoice_type VARCHAR(5) DEFAULT 'C',
  cae VARCHAR(40),
  numero VARCHAR(40),
  pdf_url TEXT,
  total_ars NUMERIC(12,2),
  status VARCHAR(20) DEFAULT 'pending',  -- pending, issued, failed
  retry_count INT DEFAULT 0,
  last_error TEXT,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_invoices_user ON invoices(user_id, created_at DESC);
CREATE INDEX idx_invoices_retry ON invoices(status) WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(20) NOT NULL,
  external_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(60),
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, external_id)
);

COMMIT;
```

**Aceptación:** `\d+ payments` `\d+ invoices` `\d+ webhook_events` muestran las tablas. Migración corre en staging + rollback probado.

---

## Ítem 5.2 — Integración Mercado Pago sandbox (8-10h)

**Pre:** `git tag pre-5.2-mp`

**Variables `.env` nuevas:**
```
PAYMENT_MODULE_ENABLED=false           # gate global: false = rutas checkout/webhook devuelven 404
PAYMENT_BETA_USER_IDS=                 # CSV de user_id habilitados durante beta (ej. "6,12,18"); vacío = nadie
MP_ACCESS_TOKEN=APP_USR-xxx
MP_PUBLIC_KEY=APP_USR-xxx
MP_WEBHOOK_SECRET=xxx
MP_PLAN_EXTENSION_PROMO_PRICE=1500
MP_PLAN_COMBO_PROMO_PRICE=15000
APP_BASE_URL=https://api.procuradortool.com
```

**Gating de beta** (middleware en `routes/checkout.js`):
```js
// Si PAYMENT_MODULE_ENABLED=false → todas las rutas devuelven 404 (middleware global)
// Si PAYMENT_MODULE_ENABLED=true y PAYMENT_BETA_USER_IDS está seteado → solo esos IDs pueden checkout
const betaIds = (process.env.PAYMENT_BETA_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (betaIds.length > 0 && !betaIds.includes(String(req.user.id))) {
  return res.status(403).json({ error: 'Módulo de pagos en beta privada' });
}
```
> El webhook (`POST /webhooks/mercadopago`) NO chequea beta IDs — debe procesar todos los webhooks de MP independientemente del flag de beta, porque vienen de MP, no del usuario. Sí debe respetar `PAYMENT_MODULE_ENABLED` (si está `false`, devuelve 404).

**Archivos a crear:**
- `backend-server/services/` (crear carpeta)
- `backend-server/services/mpClient.js` — wrapper `MercadoPagoConfig` + `PreApproval` + `Payment`
- `backend-server/services/subscriptionService.js`:
  - `createPreapproval(userId, planName)` → devuelve `init_point`
  - `linkPreapproval(userId, preapprovalId)` → guarda `external_subscription_id` + `payment_provider='mercadopago'`
  - `cancelSubscription(userId)` → cancela preapproval MP + setea `cancel_at = next_billing_date`
  - `applyTrialBonus(subscriptionId, planUsageLimit)` → `usage_limit = plan + 20`, `trial_bonus_until` ← llamado SOLO desde webhook handler, nunca desde confirm
  - `cancelPreapproval(externalSubscriptionId)` → `PATCH /preapproval/{id} { status: 'cancelled' }`
  - `createOneTimePayment(userId, amountArs, description)` → `POST /v1/payments`
  - `refundPayment(externalPaymentId, amountArs, reason)` → `POST /v1/payments/{id}/refunds`
- `backend-server/routes/checkout.js`:
  - `POST /usuarios/api/checkout/init { plan_name }` → `init_point`
  - `POST /usuarios/api/checkout/confirm { preapproval_id }` → solo vincula sub (guarda `external_subscription_id`); el trial bonus ya fue aplicado por el webhook que disparó MP al cobrar. Si el webhook aún no llegó, se aplicará cuando llegue (no hay riesgo de doble aplicación por idempotencia en `webhook_events`).
  - `POST /usuarios/api/checkout/cancel` → cancela preapproval + setea `cancel_at`
  - `GET /usuarios/api/checkout/status`
- `backend-server/routes/webhooks.js` — `POST /webhooks/mercadopago`:
  1. **Responder 200 al inicio** (< 22s)
  2. Validar firma `x-signature`:
     ```js
     const manifest = `id:${data.id.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
     const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
     if (expected !== v1) return res.status(401).end();
     ```
  3. `INSERT INTO webhook_events ... ON CONFLICT (provider, external_id) DO NOTHING`
  4. Switch por `type` (MP envía `type="payment"` o `type="subscription_preapproval"`, NO `"payment.approved"`):
     - `"payment"` → fetch via SDK `new Payment(client).get({id: data.id})` → verificar `payment.status`:
       - `'approved'` → upsert `payments` → `last_payment_at`, `next_billing_date += 30d`, encolar invoice
       - `'rejected'` → upsert `payments` → `status='past_due'`, `payment_grace_ends_at = now + 3d`, email aviso
     - `"subscription_preapproval"` → actualizar `subscriptions.status` según evento
  5. `UPDATE webhook_events SET processed_at = NOW()`
- `backend-server/server.js`:
  - Registrar rutas detrás del flag `PAYMENT_MODULE_ENABLED`
  - Cron `cobranza-retry` (cada 6h): reintenta subs `past_due` no expiradas
  - Cron `cron-gracia-vencida` (cada 1h): `payment_grace_ends_at < NOW()` → `suspended_plan_expired`
  - Cron `cron-cancelacion-cumplida` (00:30 diario): `cancel_at < NOW()` → `cancelled`
  - Cron `cron-cuit-retention` (semanal, domingos 02:00): subs `cancelled` hace > 90 días → `UPDATE users SET cuit = SHA256(cuit)::text, cuit_deleted_at = NOW()` (cumplimiento de retención de datos)
- `backend-server/package.json` → `npm i mercadopago@3`

**Lógica de trial-bonus (decisión #4):**
```
Al confirmar primer pago aprobado:
  - subscriptions.usage_limit = plan_limit + 20
  - subscriptions.trial_bonus_until = next_billing_date
  - Al renovar (segundo pago): usage_limit = plan_limit (sin bonus)
```

**Aceptación:** webhook sandbox crea registros; doble POST mismo `external_id` → no duplica; flag `false` → 404 en `/usuarios/api/checkout/*`.

---

## Ítem 5.3 — Integración Facturante homologación (6-8h)

**Pre:** `git tag pre-5.3-facturante`

⚠️ **Facturante es SOAP/XML, no REST.** URLs de WSDL no son públicas — se obtienen al contratar Pack 50.

**Dependencia nueva:** `npm i soap`

**Variables `.env` nuevas:**
```
FACTURANTE_WSDL_URL=
FACTURANTE_WSDL_URL_PROD=
FACTURANTE_EMPRESA=
FACTURANTE_USUARIO=
FACTURANTE_HASH=
FACTURANTE_PUNTO_VENTA=0001
INVOICE_ADMIN_ALERT_EMAIL=admin@procuradortool.com
```

**Archivos a crear:**
- `backend-server/services/facturanteClient.js` — SOAP client + método `crearFacturaC({ cliente, monto, periodoMes, paymentId })` (en `services/` por coherencia con `mpClient.js`)
  - `Autenticacion`: Usuario, Hash, Empresa
  - `Cliente`: NroDocumento (CUIT), RazonSocial, DireccionFiscal, CodigoPostal, TipoDocumento=6, TratamientoImpositivo=3, CondicionPago=1
  - `Encabezado`: Prefijo, TipoComprobante="FC", FechaHora, Moneda=2, CondicionVenta=1, Bienes=2
  - `Items`: Detalle, Cantidad=1, PrecioUnitario, IVA=0, Gravado=false
  - Parse respuesta: Estado, Mensaje, IdComprobante, CAE, Numero, URLPDF *(verificar nombres exactos contra WSDL real)*
- `backend-server/services/invoiceService.js`:
  - `enqueueInvoice(paymentId)` → inserta `invoices(status='pending')`
  - `processInvoice(invoiceId)` → llama Facturante:
    - OK → `status='issued'`, guarda CAE, numero, pdf_url + dispara email
    - Errores 500/501/timeout → `retry_count++`, backoff 1m → 5m → 30m
    - Errores 1/11/15/18 (datos inválidos) → `status='failed'` inmediato, email admin
    - 3 fallos → `status='failed'`, email a `INVOICE_ADMIN_ALERT_EMAIL`
- Cron `cron-invoice-retry` (cada 1h): `status='pending' AND retry_count<3 AND created_at < NOW() - 30min`
- Email nuevo: `sendInvoiceEmail(userId, pdfUrl, numero)` en `utils/mailer.js`

**Tarea pre-código:** contactar onboarding Facturante para WSDL URL, credenciales, nombres de campos respuesta, webhooks salientes.

**Aceptación:** pago aprobado → invoice con CAE válido en homologación AFIP; mock 500 → 3 reintentos + email admin; reinicio PM2 → cron continúa; error 18 → alerta inmediata sin reintentos.

---

## Ítem 5.4 — Migración a producción (1 semana monitoreo)

**Pre:** `git tag pre-5.4-deploy`

1. Deploy con `PAYMENT_MODULE_ENABLED=false` → smoke test 48/48 en verde
2. Migración SQL 005 en producción (transacción atómica)
3. Script `backend-server/scripts/smoke-payments.js`: conectividad MP + Facturante, tablas accesibles, webhook responde 401 sin firma
4. Credenciales MP producción en `.env` del servidor
5. `PAYMENT_BETA_USER_IDS=6` (admin propio) + cobro real $1 ARS → verificar `payments`, `invoices`, email con PDF
6. Restaurar precios reales ($1.500 y $15.000)
7. 5 usuarios beta → monitoreo 72h
8. `PAYMENT_MODULE_ENABLED=true`

**Rollback:** `PAYMENT_MODULE_ENABLED=false` + revert PM2. Las tablas nuevas se conservan (no destructivo).

---

## Ítem 5.5 — UI portal + Electron + emails + dashboard admin (6-8h)

**Pre:** `git tag pre-5.5-ui`

**Portal** — `backend-server/public/usuarios/app.js` línea 1186, reemplazar `renderFact()`:
- Card "Método de pago" (últimos 4 dígitos + marca, botón "Cambiar")
- Card "Próximo cobro" (`next_billing_date`, monto, estado)
- Card "Bonus de bienvenida" (solo si `trial_bonus_until > NOW()`)
- Tabla historial pagos (últimos 12) → `GET /usuarios/api/payments`
- Tabla historial facturas con link PDF → `GET /usuarios/api/invoices`
- Botón "Cancelar suscripción" → modal confirmación → `POST /checkout/cancel`

**Endpoints nuevos** — `backend-server/routes/usuarios.js`:
- `GET /usuarios/api/payments`
- `GET /usuarios/api/invoices`
- `GET /usuarios/api/subscription/current`

**Electron** — `electron-app/renderer.js`:
- Banner `cuenta-trial-banner` **ya existe y no requiere cambios de lógica**
- La columna `subscriptions.payment_provider` ya existe en DB (siempre `NULL` hoy). Ítem 5.2 la popula en `linkPreapproval` con `'mercadopago'` → el banner desaparece automáticamente. ✅

**Emails** — `backend-server/utils/mailer.js` — 7 plantillas nuevas (incluye la de invoice definida en Ítem 5.3):
- `sendPaymentSuccessEmail` — "Pago confirmado" con link al PDF
- `sendPaymentFailedEmail` — "Actualizá tu método antes del DD/MM"
- `sendSubscriptionCancelledEmail` — "Acceso hasta DD/MM"
- `sendTrialBonusActivatedEmail` — primer pago + bonus
- `sendRefundEmail` — "Reembolso de $X ARS procesado"
- `sendExtraUsesEmail` — "+N usos agregados a tu plan"
- `sendInvoiceEmail` — "Tu factura #NNN" con link PDF (definida en Ítem 5.3)

**Dashboard admin** — `backend-server/public/dashboard/dashboard.js`:

*Lo que ya existe (no tocar):* botón "⏸ Suspender", "▶ Reactivar", "🔄 Resetear uso", dropdown estado.

*Lo que hay que agregar:*
1. **Modal suspensión ampliado** — reemplazar modal actual:
   - "🔒 Hard suspend" → motivo + ¿reembolsar? (muestra monto proporcional calculado)
   - "⏸ Soft suspend" → usuario sigue hasta agotar usos → ¿reembolsar?
   - Cálculo en tiempo real: `(días_restantes / 30) × monto_último_pago`
2. **Botón "Usos extra"** → cantidad, precio (0 = cortesía), motivo/ticket → `POST /admin/users/:userId/extra-usage`
3. **Historial de pagos** por usuario: fecha, monto, estado, ¿reembolsado?
4. **Historial de usos extra** por usuario: otorgados, restantes, origen

**Aceptación:** usuario beta ve pagos/facturas; descarga PDF OK; cancelación muestra "acceso hasta DD/MM"; banner Electron desaparece al confirmar pago; modal suspensión con dos opciones y monto calculado; botón "Usos extra" funcional.

---

## Ítem 5.6 — Usos extra, reembolsos y checkLicense (3-4h)

**Pre:** `git tag pre-5.6-extras`

**`backend-server/routes/admin.js`** — nuevos endpoints:
- `POST /admin/users/:userId/extra-usage { extra_uses, price_total, reason, ticket_id }`
- `GET /admin/users/:userId/extra-usage`
- `DELETE /admin/users/:userId/extra-usage/:extraId` — anular extra (`remaining_uses = 0`)
- `POST /admin/users/:userId/refund { payment_id, amount, reason }` → `POST /v1/payments/{id}/refunds`

**`backend-server/middleware/checkLicense.js`** — actualizar lógica de cuota:
```js
// Antes:
if (sub.usage_count >= sub.usage_limit) return 403;

// Después (Fase 5):
const extrasResult = await db.query(
  `SELECT COALESCE(SUM(remaining_uses), 0) AS extra_total
   FROM usage_extras WHERE user_id = $1 AND remaining_uses > 0
   AND (expires_at IS NULL OR expires_at > NOW())`, [userId]
);
const extraTotal = parseInt(extrasResult.rows[0].extra_total);
const effectiveLimit = sub.usage_limit + extraTotal;
if (sub.usage_count >= effectiveLimit) return 403;
// Al aprobar uso: si usage_count >= sub.usage_limit → descontar de usage_extras
```

**Aceptación:** tests #15-#17 del listado de aceptación.

> 📌 **Nota sobre modelo de cuotas**: la tabla `plans` tiene límites por feature
> (`proc_executions_limit`, `informe_limit`, `monitor_partes_limit`, `monitor_novedades_limit`,
> `batch_executions_limit`) y `subscriptions` tiene contadores correspondientes (`proc_usage`,
> `informe_usage`, etc.). Sin embargo, `checkLicense.js` actualmente solo chequea el contador
> legacy `usage_count` vs `usage_limit`. Fase 5 mantiene esa simplificación — el bonus de
> trial y los `usage_extras` se aplican al contador legacy. La granularización por feature
> queda como deuda técnica futura (no es Fase 5).
>
> 📌 **Nota sobre `usage_extras` vs columnas `*_bonus` existentes**: la DB ya tiene `proc_bonus`,
> `informe_bonus`, `monitor_novedades_bonus`, `monitor_partes_bonus`, `batch_bonus` en `subscriptions`.
> Fase 5 introduce `usage_extras` como tabla separada porque permite auditoría completa
> (fecha, admin que lo cargó, motivo, ticket asociado, pago vinculado, fecha de expiración).
> Las columnas `*_bonus` quedan sin uso en Fase 5 — su limpieza queda como deuda técnica futura.

---

## Matriz de transiciones de estado

| Evento | users.registration_status | subscriptions.status | Acción extra |
|---|---|---|---|
| Admin activa (Fase 5) | `pending_activation` → `active` | `suspended` → `active`, **usage_limit queda en 20** | Email "configurá pago" |
| Usuario confirma checkout MP (`/checkout/confirm`) | `active` | `external_subscription_id`, `payment_provider='mercadopago'` guardados. **NO toca usage_limit ni trial_bonus_until** | — |
| Webhook `payment.approved` — **primer pago** | sin cambio | `usage_limit = plan + 20`, `trial_bonus_until = next_billing_date`, `usage_count = 0`, `last_payment_at`, `next_billing_date += 30d` | Email "bonus activado" + trigger factura |
| Webhook `payment.approved` — renovación | sin cambio | `last_payment_at=NOW`, `next_billing_date += 30d`, si `trial_bonus_until < NOW()`: `usage_limit = plan_limit`, `usage_count = 0` | Trigger factura Facturante |
| Webhook `payment.approved` (pago extra) | sin cambio | `usage_extras.remaining_uses += extra_uses` | Factura extra, email "+N usos" |
| Webhook `payment.rejected` | sin cambio | `active` → `past_due`, `payment_grace_ends_at = NOW + 3d` | Email aviso |
| Cron gracia vencida | `active` → `suspended_plan_expired` | `past_due` → `suspended` | Email suspensión |
| Reintento OK en gracia | `active` | `past_due` → `active` | — |
| Usuario cancela | `active` (hasta `cancel_at`) | `cancel_at = next_billing_date`, preapproval MP cancelado | Email "acceso hasta DD/MM" |
| Cron `cancel_at` vencido | `active` → `cancelled` | `cancelled` (acceso revocado) | — |
| Admin hard suspend + reembolso | `active` → `suspended_admin` | `suspended_admin` | Reembolso proporcional MP, email, log en `payments` |
| Admin hard suspend sin reembolso | `active` → `suspended_admin` | `suspended_admin` | Solo log `refund_reason = motivo`, email, no llama MP |
| Admin soft suspend + mantener | sin cambio | `suspended` (acceso hasta usos/período) | Cancelar preapproval MP, no reembolso |
| Admin soft suspend + reembolso | sin cambio | `suspended` | Cancelar preapproval MP + reembolso proporcional |
| Admin agrega usos extra (gratis) | sin cambio | `usage_extras` nueva fila sin `payment_id` | Email "+N usos cortesía" |
| Upgrade plan | sin cambio | nuevo preapproval MP, `plan = nuevo`, `usage_limit = nuevo_plan_limit` | Factura cobro diferencial |
| Downgrade programado | sin cambio | `scheduled_plan` guardado, aplica al próximo `payment.approved` | Email "cambio programado" |
| 90 días post `cancelled` | sin cambio | — | `users.cuit_deleted_at = NOW`, CUIT hasheado |

---

## Tests de aceptación (manuales + curl)

1. **Idempotencia webhook**: POST duplicado mismo `external_id` → segunda llamada `200`, no duplica en `payments`
2. **Flujo feliz**: crear preapproval sandbox + simular `payment.approved` → row en `payments`, row en `invoices` con CAE
3. **Pago rechazado**: simular `payment.rejected` → sub pasa a `past_due`, `payment_grace_ends_at = NOW + 3d`, email aviso
4. **Suspensión por gracia**: forzar `payment_grace_ends_at` en pasado + correr cron → user `suspended_plan_expired`
5. **Cancelación voluntaria**: `POST /checkout/cancel` → preapproval cancelado en MP + `cancel_at = next_billing_date`, usuario sigue `active` hasta esa fecha
6. **Facturante falla**: mock 500 → 3 reintentos con backoff 1m/5m/30m, email a `INVOICE_ADMIN_ALERT_EMAIL` tras último fallo
7. **Feature flag off**: `PAYMENT_MODULE_ENABLED=false` → `/usuarios/api/checkout/init` y `/webhooks/mercadopago` retornan 404. Con flag `true` + `PAYMENT_BETA_USER_IDS=6` → user_id=6 OK, user_id=12 → 403 "beta privada"
8. **Trial bonus**: confirmar primer pago COMBO_PROMO → `usage_limit = 50 + 20 = 70`; tras segundo pago: `usage_limit = 50`
9. **Reintento Facturante post-reinicio PM2**: dejar invoice `pending` + reiniciar PM2 → cron 1h la procesa
10. **Retención CUIT**: forzar `cancelled_at = NOW - 91d` + correr cron 90d → `cuit_deleted_at` seteado
11. **Hard suspend con reembolso**: admin suspende con reembolso → MP recibe `POST /v1/payments/{id}/refunds { amount: X }`, `payments.refund_amount = X`, email al usuario
12. **Hard suspend sin reembolso**: admin suspende sin reembolso → NO llama a MP, `payments.refund_reason = motivo`, email al usuario
13. **Soft suspend mantener**: usuario sigue hasta agotar usos o vencer `expires_at`; siguiente período no se cobra (preapproval cancelado)
14. **Soft suspend con reembolso**: igual que #13 + MP recibe reembolso proporcional
15. **Usos extra con cobro**: admin agrega 10 extras + cobra → MP cobra pago único → webhook `payment.approved` → `usage_extras.remaining_uses = 10`, factura emitida, email usuario
16. **Usos extra sin cobro (cortesía)**: admin agrega extras sin pago → `usage_extras.payment_id = NULL`, `remaining_uses = N`, email usuario
17. **checkLicense con extras**: usuario con `usage_count = usage_limit` pero `usage_extras.remaining_uses > 0` → puede seguir ejecutando; `remaining_uses--` al consumir
18. **Smoke test pagos**: `node backend-server/scripts/smoke-payments.js` → todas las verificaciones en verde antes de activar beta

---

## Medios de prueba (sandbox / homologación)

### MercadoPago sandbox

**Tarjetas de prueba para Argentina:**
```
VISA (pago aprobado):    4509 9535 6623 3704  CVV 123  Exp 11/30
MASTER (pago rechazado): 5031 7557 3453 0604  CVV 123  Exp 11/30
DNI de prueba:           12345678
Nombre titular:          APRO (para aprobar) / OTHE (para rechazar)
```

**Credenciales sandbox:**
- `MP_ACCESS_TOKEN`: token `TEST-` (panel developers → modo test)
- `MP_PUBLIC_KEY`: clave pública `TEST-`
- `MP_WEBHOOK_SECRET`: configurar en panel MP al registrar URL
- URL webhook: `https://api.procuradortool.com/webhooks/mercadopago` (o ngrok en local)

**Flujo de prueba:**
1. Crear preapproval con tarjeta VISA de prueba → obtener `init_point`
2. Completar checkout en MP → webhook `payment.approved`
3. Verificar row en `payments`, `invoices` (homologación), email

**Simular rechazo:** usar tarjeta MASTER → `payment.rejected` → `past_due` + email aviso

**Simular reembolso:** `POST /v1/payments/{id}/refunds { "amount": X }` con token TEST

---

### Facturante homologación (AFIP test)

**Ambiente:** WSDL URL provista por Facturante al contratar. CAE válido en homologación pero sin efecto fiscal real.

**Datos de prueba:**
- CUIT: usar CUIT propio o el que indique Facturante
- `DireccionFiscal`: "Av. Corrientes 1234, CABA" (si usuario no tiene)
- `CodigoPostal`: "1043"

**Flujo:**
1. SOAP client con WSDL homologación → `CrearComprobanteSinImpuestos`
2. Verificar `Estado = 0`, `IdComprobante` no nulo, `CAE` presente, `pdf_url` accesible
3. Simular error 500 → 3 reintentos + email `INVOICE_ADMIN_ALERT_EMAIL`

**Preguntas a confirmar con onboarding Facturante:**
- Nombres exactos de campos respuesta: ¿`CAE` o `Cae`? ¿`URLPDF` o `UrlPdf`?
- ¿PDF disponible inmediatamente o requiere polling?
- ¿Soportan webhooks salientes?
- ¿CUIT de prueba recomendado?

---

## Post-Fase 5 — Cierre

```bash
git tag fase-5-completa && git push --tags
ssh root@142.93.64.94 "sudo -u postgres pg_dump procurador_db" \
  > "C:/Users/JONATHAN/Desktop/ProcuradorBackups/procurador_db_post_fase5_$(date +%Y%m%d).sql"
```

- Actualizar `CLAUDE.md`: Fase 5 ✅ CERRADA + runbook Facturante + endpoints nuevos
- Actualizar `docs/internal/proximos-pasos.md`: mover Fase 5 a ✅
- Dashboard admin: agregar KPIs — `payments` últimos 30d + `invoices` con `status='failed'`
- Documentar en `docs/internal/cobranza-runbook.md`: cómo verificar cobro fallido, reemitir factura, cancelar suscripción desde admin

---

## Tiempos calendario

| Bloque | Esfuerzo |
|---|---|
| Pre-Fase + cuentas externas (MP + Facturante) | 1-2 días |
| Ítem 5.1 Schema DB | 1h |
| Ítem 5.2 Integración MP sandbox | 8-10h (~1.5 días) |
| Ítem 5.3 Integración Facturante SOAP | 6-8h (~1 día) |
| Ítem 5.4 Migración producción + smoke test | 1 día + 1 semana monitoreo |
| Ítem 5.5 UI + emails + dashboard admin | 6-8h (~1 día) |
| Ítem 5.6 Usos extra + reembolsos + checkLicense | 3-4h (~0.5 días) |
| **Total calendario** | **~3 semanas** |

---

## Archivos críticos

**Crear:**
- `backend-server/migrations/005_fase5_payments.sql`
- `backend-server/services/mpClient.js`
- `backend-server/services/subscriptionService.js`
- `backend-server/services/invoiceService.js`
- `backend-server/services/facturanteClient.js`
- `backend-server/routes/checkout.js`
- `backend-server/routes/webhooks.js`
- `backend-server/scripts/smoke-payments.js`
- `docs/internal/cobranza-runbook.md`

**Modificar:**
- `backend-server/server.js` — rutas + 4 crons nuevos detrás del flag
- `backend-server/package.json` — `mercadopago@3` + `soap`
- `backend-server/public/usuarios/app.js` — reemplazar `renderFact()` (línea 1186)
- `backend-server/routes/usuarios.js` — endpoints GET pagos/facturas/subscription
- `backend-server/utils/mailer.js` — 6 plantillas nuevas
- `electron-app/renderer.js` — banner ya existe, no requiere cambios de lógica
- `CLAUDE.md` + `docs/internal/proximos-pasos.md` — post-cierre

**Modificar con cuidado (cambio mínimo):**
- `backend-server/routes/admin.js`:
  - `/users/:userId/activate` (línea ~218): eliminar `usage_count = 0` y `usage_limit = $1` del UPDATE (líneas 254-255). El resto queda igual.
  - `/subscriptions/:userId/suspend` (línea ~881, **ya existe** con un solo `UPDATE status='suspended'`): ampliar para que reciba `{ refund: boolean, reason }` y, si `refund=true`, calcule el monto proporcional y llame a `subscriptionService.refundPayment()`. Además, agregar llamada a `subscriptionService.cancelPreapproval()` siempre (regla invariable).
  - `/users/:userId/suspend` (línea ~378, hard suspend existente): igual ampliación con `refund/reason` + cancelPreapproval siempre.
  - Endpoints nuevos (Ítem 5.6): `/users/:userId/extra-usage` (POST, GET, DELETE), `/users/:userId/refund` (POST).
- `backend-server/middleware/checkLicense.js` → sumar `usage_extras.remaining_uses` al límite efectivo (ver Ítem 5.6 para el snippet exacto).

**NO TOCAR:**
- Lógica de smoke tests existente
- Endpoint `/admin/users/:userId/reject` (block y keep_trial ya funcionan)
- Endpoint `/admin/users/:userId/suspend` (hard suspend existente, solo se amplía el modal UI en Ítem 5.5)
- Columna `billing_paused` (queda en DB por compatibilidad, ignorada en Fase 5 — el preapproval cancel en MP la reemplaza funcionalmente)

---

## Fuentes oficiales consultadas

**MercadoPago:**
- SDK Node.js v3.0.0: https://github.com/mercadopago/sdk-nodejs
- Doc preapproval: https://www.mercadopago.com.ar/developers/en/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments
- Doc webhooks: https://www.mercadopago.com.ar/developers/en/docs/checkout-api-orders/notifications

**Facturante:**
- Cómo comenzar: https://www.facturante.com/Developers/ComoComenzar
- CrearComprobanteSinImpuestos: https://www.facturante.com/Developers/CrearComprobanteSinImpuestos
- ConsideracionesIniciales: https://www.facturante.com/Developers/ConsideracionesIniciales

**Hallazgos clave:**
1. Facturante es SOAP/XML, no REST/JSON (+2-3h esfuerzo Ítem 5.3)
2. MP SDK actualizado a v3.0.0
3. Webhook MP exige respuesta 200 en <22 segundos
4. SDK MP no tiene helper de validación de firma — implementar con `crypto.createHmac`
5. URLs WSDL Facturante no son públicas — requieren onboarding
