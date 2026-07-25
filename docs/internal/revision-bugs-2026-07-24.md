# Revisión de bugs — 2026-07-24

> Revisión de código (white-box) sobre el backend y la app Electron, buscando bugs **no
> detectados** por las revisiones previas (`informe-bugs-2026-07.md`, `revision-integral-2026-07-19.md`,
> Bloque R del plan de pruebas).
> Método: lectura del código real de los flujos de cobranza, cuotas, licencia, monitor y cliente,
> verificando cada hallazgo `archivo:línea` y contra el estado real de producción cuando aplicaba.
> **No se modificó código.** Cada hallazgo trae propuesta de solución + modelo/esfuerzo sugerido.

**Estado de producción al momento de la revisión** (verificado por SSH/SQL):
- PM2 `procurador-api`: `cluster_mode`, `instances: 1`, 699 restarts.
- `subscriptions`: solo 3 filas (admins 6/7 + cuenta de prueba 250). **Ningún usuario pagando** →
  varios de estos bugs todavía **no pudieron manifestarse**; se activarían con el primer cliente real
  (B3 / MercadoPago producción).

---

## Resumen

| # | Severidad | Título | Área |
|---|---|---|---|
| **B1** | 🔴 **Crítico** | `expires_at` nunca se renueva con el pago → el cliente que paga queda bloqueado a los ~30 días | Cobranza / acceso |
| **B2** | 🟠 Alto | `applyTrialBonus`/`applyRenewal` abortan con planes fuera del map hardcodeado → pago perdido | Cobranza / webhooks |
| **B3** | 🟠 Alto | `/checkout/init` no valida el plan → se puede pagar el plan barato y conservar los límites del caro | Cobranza (financiero) |
| **B4** | 🟠 Medio-Alto | `/users/change-plan` infla el cupo del trial (20 → 50 usos gratis) | Cuotas |
| **B5** | 🟡 Medio | Reactivar una parte del Monitor saltea el chequeo de límite | Cuotas |
| **B6** | 🟡 Medio | Webhook de pago `rejected` no idempotente: re-extiende la gracia y re-notifica | Cobranza |
| **B7** | 🟡 Medio | `GET /client/download/electron` puede tumbar el proceso (JSON.parse sin guard, sin `uncaughtException`) | Disponibilidad |
| **B8** | 🔵 Bajo-Medio | Resolución de suscripción en webhooks (`OR` + `ORDER BY s.id`) puede acreditar a la cuenta equivocada | Cobranza |
| **B9** | 🔵 Bajo | Blacklist de tokens solo en memoria del worker → se rompe si se escala a >1 instancia | Seguridad (latente) |
| **B10** | 🔵 Bajo | `expires_at IS NULL` tratado distinto en `verify-session` que en el resto de los endpoints | Consistencia |

---

## B1 🔴 CRÍTICO — `expires_at` nunca se renueva con el pago

**Dónde**
- `backend-server/services/subscriptionService.js:304` (`applyTrialBonus`) y `:352` (`applyRenewal`)
  — actualizan `next_billing_date`, `period_start`, contadores… pero **nunca `expires_at`**.
- Gates que sí usan `expires_at`:
  - `routes/auth.js:587` (login de la app) — `AND s.expires_at > NOW()`
  - `routes/client.js:119, 162, 246, 306, 358, 369, 386, 675, 728` (check/download/available de scripts,
    `log-execution`, `batch-limits`, `extension-auth`)
  - `routes/client.js:77` (`verify-session`) — 403 "Tu suscripción ha expirado"
  - `routes/scripts.js:36`
- Quién fija `expires_at`: `auth.js:221` (registro, +365 días), `admin.js:445` (**activación, +30 días
  por defecto**), `admin.js:1263`/`1357` (cortesía / cambio de plan admin), `admin.js:1974` (extensión
  manual), `users.js:358` (upgrade), `server.js:761` (cron de downgrade).

**Falla concreta**
1. Usuario se registra → `expires_at = hoy + 365 d`.
2. El admin lo activa (flujo oficial §4) → `performActivation` **pisa** `expires_at = NOW() + 30 días`.
3. El usuario configura el pago y paga → el webhook aplica `applyTrialBonus` (contadores a 0,
   `next_billing_date = +1 mes`) pero **deja `expires_at` en activación+30 d**.
4. Cada renovación mensual (`applyRenewal`) tampoco lo mueve.
5. **Al día 30 desde la activación** el usuario que está pagando al día recibe:
   403 en el login de la app ("No tenés una suscripción activa"), 403 en la descarga de scripts,
   403 en `extension-auth` (extensión muerta) y "Tu suscripción ha expirado" en `verify-session`.
   La única salida es que un admin le extienda la fecha a mano.

**Por qué no lo cazó ninguna prueba:** todas las corridas E2E de cobranza ocurrieron en ventanas de
horas/días desde la activación, muy por debajo de los 30 días. Y en producción **todavía no hay
ningún usuario con `payment_provider`** (verificado por SQL) → el bug está latente esperando al
primer cliente real de B3.

**Corolario (mismo origen):** `cancelSubscription` (`subscriptionService.js:806`) hace
`cancel_at = next_billing_date`; si esa columna quedara NULL, la cancelación pausa el cobro en MP
pero **no programa el corte** → acceso indefinido sin cobro. Cubrirlo con el mismo fix.

**Solución propuesta**
- En `applyTrialBonus` y `applyRenewal`, agregar `expires_at = $nextBillingDate` al mismo `UPDATE`
  (`expires_at` pasa a ser "fin del período pago", coherente con `next_billing_date`).
- Defensivo en `cancelSubscription`: `cancel_at = COALESCE(next_billing_date, expires_at, NOW() + INTERVAL '30 days')`.
- Verificación: en staging, simular con `dev-tools/sim-renewal.js` + `UPDATE subscriptions SET
  expires_at = NOW() - INTERVAL '1 day'` antes de la renovación → tras `applyRenewal` el login y
  `scripts/download` deben responder 200.
- Solo backend, sin release de Electron, sin migración.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **medio** (cambio de 2 líneas, pero exige verificación E2E del ciclo pago→renovación en staging antes de prod) |

---

## B2 🟠 ALTO — Los planes fuera del map hardcodeado abortan la transacción del pago

**Dónde**
- `backend-server/utils/mercadopago.js:32` — `PLAN_LIMITS` con **5 planes hardcodeados**
  (EXTENSION_PROMO, COMBO_PROMO, BASIC, PRO, ENTERPRISE).
- `services/subscriptionService.js:305` y `:353`:
  ```js
  const limits = PLAN_LIMITS[planName];
  if (!limits) throw new Error(`Plan desconocido: ${planName}`);
  ```
  `limits` **no se usa para nada más** — el único efecto de esa lectura es el `throw`.
- `routes/webhooks.js:242-246` — esas llamadas están **dentro de la transacción** `BEGIN…COMMIT`.

**Falla concreta**
El proyecto ya soporta planes creados por el admin (privados / cortesía / a medida), y
`updatePreapprovalAmount` (`subscriptionService.js:406-412`) lee `price_ars` de la tabla `plans`
explícitamente **para habilitar cobrar planes privados**. Pero si un usuario pagando queda con un
plan que no está en `PLAN_LIMITS` (p. ej. el admin lo movió a un plan privado tarifado desde
`POST /admin/subscriptions`, `admin.js:1347-1370`), entonces al llegar la renovación de MP:

`handlePaymentEvent` → `BEGIN` → INSERT en `payments` → `applyRenewal('PLAN_PRIVADO')` → **throw** →
`ROLLBACK` → el pago **no queda registrado**, los contadores no se resetean, `next_billing_date` no
avanza y la cuenta no se reactiva. Como el guard `alreadyApproved` solo ve pagos ya committeados,
**cada reintento de MP repite exactamente la misma falla** (no se auto-recupera). Resultado: el
usuario pagó y el sistema lo trata como impago → el cron `30 11` termina suspendiéndolo.

**Solución propuesta**
- Quitar el `throw` y degradar a warning: los límites reales ya salen de la tabla `plans`
  (`log-execution` y `/client/account` leen `plans`, no `PLAN_LIMITS`), así que el map es
  redundante para este camino.
  ```js
  if (!PLAN_LIMITS[planName]) logger.warn('[SubscriptionService] Plan fuera del map de límites — se continúa', { planName });
  ```
- Alternativa más conservadora: mantener el guard pero **fuera** de la transacción y con fallback a
  los límites de la tabla `plans`.
- Verificación: en staging, crear un plan privado tarifado, asignarlo a una cuenta con
  `payment_provider`, y correr `dev-tools/sim-renewal.js` → debe aplicar la renovación sin excepción.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo-medio** (cambio quirúrgico en 2 funciones + prueba en staging) |

---

## B3 🟠 ALTO — `/checkout/init` no valida el plan pagado contra el plan de la suscripción

**Dónde:** `backend-server/routes/checkout.js:37-103`.

**Falla concreta**
`plan_name` llega del body y solo se usa para elegir el `init_point` de MP
(`createPreapproval(userId, plan_name)`). Fuera de la rama de reactivación
(`suspended_plan_expired` / `cancelled`, líneas 64-75), **la suscripción nunca se alinea al plan
pagado**. Después, el webhook aplica los límites usando `sub.plan` (el de la DB), no el pagado:

- Usuario con `subscriptions.plan = 'COMBO_PROMO'` (límites 50/50/20/50) llama a
  `POST /usuarios/api/checkout/init {"plan_name":"EXTENSION_PROMO"}` → MP le cobra **$1.500** →
  el webhook corre `applyTrialBonus(sub.plan = 'COMBO_PROMO')` → **paga $1.500/mes y usa el plan de
  $15.000**, de forma recurrente.
- El caso inverso (paga COMBO y queda con límites de EXTENSION) perjudica al usuario y genera un
  reclamo de soporte.

No requiere vulnerar nada: basta un request al endpoint autenticado con otro `plan_name`.

**Solución propuesta**
- En `/init`, resolver el plan **desde la DB** y rechazar el mismatch:
  ```js
  const { rows:[cur] } = await db.query('SELECT plan FROM subscriptions WHERE user_id=$1',[userId]);
  if (!yaTieneMetodo && cur.plan !== plan_name) return res.status(400).json({ error:'El plan solicitado no coincide con tu suscripción.' });
  ```
  (o bien alinear la suscripción al plan elegido, como ya hace la rama de reactivación — decidir cuál
  de las dos semánticas se quiere; recomiendo **rechazar**, porque el cambio de plan tiene su propio
  endpoint con control de 2 cambios por ciclo).
- Verificación: staging, dos requests cruzados (COMBO↔EXTENSION) → 400.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (guard de 4 líneas; decidir semántica con el operador antes de codificar) |

---

## B4 🟠 MEDIO-ALTO — `/users/change-plan` infla el cupo del trial

**Dónde:** `backend-server/routes/users.js:345-368`.

```js
const newUsageLimit = (u.payment_provider || newPlan.proc_executions_limit === -1)
    ? 999999
    : (newPlan.proc_executions_limit > 0 ? newPlan.proc_executions_limit : null);
...
usage_limit = COALESCE($3, usage_limit),
```

**Falla concreta**
Una cuenta **activada por el admin pero sin método de pago** (`registration_status='active'`,
`payment_provider IS NULL`) — que es el estado por el que pasa *todo* usuario real entre la
activación y el primer pago — pasa el guard `allowedStatuses = ['active']` y puede hacer un
"upgrade" que se aplica **inmediatamente y gratis** (el propio código lo comenta: *"stub: simula
cobro OK"*). Con EXTENSION_PROMO → COMBO_PROMO, `usage_limit` salta de **20 a 50**: el trial se
amplía 2,5× sin pagar, y se puede repetir hasta 2 veces por ciclo (`plan_changes_this_cycle`).

Es exactamente el bug que **ya se corrigió del lado del admin** (`admin.js:1238-1246`, "Cambiar plan
en TRIAL conserva el cupo") y que quedó sin corregir en el camino del portal.

**Solución propuesta**
- Espejar la lógica del admin: si `!u.payment_provider`, cambiar solo `plan`/`plan_id` y **conservar**
  `usage_limit`, `usage_count` y el estado del trial (no tocar `expires_at`/`next_billing_date`).
- Opcionalmente, bloquear el cambio de plan directamente mientras no haya método de pago
  (mensaje: "configurá tu método de pago para cambiar de plan"), que es más simple de razonar.
- Verificación: staging con una cuenta `active` sin pago → `POST /users/change-plan` a un plan más
  caro → `usage_limit` debe seguir en 20.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo-medio** (el fix es chico; conviene revisar de paso que el selector de planes del portal no se muestre en ese estado) |

---

## B5 🟡 MEDIO — Reactivar una parte del Monitor saltea el chequeo de límite

**Dónde:** `backend-server/routes/monitor.js:186-199` (rama de reactivación) vs. `:201-215` (chequeo
de límite, **posterior** y por lo tanto inalcanzable en esa rama).

**Falla concreta**
`POST /monitor/partes` reactiva una parte previamente eliminada (`activo=false`) y hace `return`
**antes** de contar las partes activas contra `monitor_partes_limit + bonus`. Un usuario que llegó al
tope (20 en COMBO) y que tiene partes viejas desactivadas puede volver a agregarlas una por una y
superar el límite indefinidamente (cada parte reactivada además resetea `fecha_creacion`, con lo que
vuelve a arrancar la ventana anti-abuso de borrado de 24 h / 30 días).

**Solución propuesta**
- Mover el bloque de límite (líneas 201-215) **antes** de las dos ramas (activa/inactiva), o repetir
  el chequeo dentro de la rama de reactivación.
- Verificación: staging, poner `monitor_partes_limit` en 2, crear 2 partes, borrar 1, re-agregarla →
  debe pasar (vuelve a 2); intentar una tercera nueva → 403; borrar y re-agregar teniendo 2 activas
  distintas → 403.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (reordenar el chequeo + prueba puntual) |

---

## B6 🟡 MEDIO — El webhook de pago `rejected` no es idempotente

**Dónde:** `backend-server/routes/webhooks.js:282-318`.

**Falla concreta**
Por el fix C2, **los pagos se reprocesan siempre** (no se deduplican por `webhook_events`), y el
guard de idempotencia (`alreadyApproved`, línea 210) solo cubre `approved`. Para un pago `rejected`,
cada reenvío del mismo `payment.id` por parte de MP vuelve a:
- fijar `payment_grace_ends_at = NOW() + 3 días` → **la gracia se extiende** en cada reenvío (un
  usuario con pago fallido puede quedar meses "en gracia" si MP reenvía el evento);
- insertar otra notificación in-app;
- enviar otro email "pago rechazado" (spam al cliente).

**Solución propuesta**
- Guard simétrico al de `approved`: si `prevPay && prevPay.status === status`, actualizar el registro
  del pago para auditoría pero **saltear** los efectos (gracia, notificación, email).
- Opcional: fijar la gracia con `COALESCE(payment_grace_ends_at, $1)` para que nunca se extienda.
- Verificación: staging, reenviar dos veces el mismo webhook `rejected` → una sola notificación, un
  solo email, `payment_grace_ends_at` sin cambios en el segundo envío.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** |

---

## B7 🟡 MEDIO — `GET /client/download/electron` puede tumbar el proceso de la API

**Dónde:** `backend-server/routes/client.js:938-961`; ausencia de handlers globales en `server.js`.

**Falla concreta**
```js
r.on('end', () => resolve(JSON.parse(body)));   // línea 948
```
El `JSON.parse` corre **dentro del callback del evento `end`**, fuera del alcance del `try/catch` que
envuelve al `await`. Si GitHub responde algo que no es JSON (página HTML de error 5xx, corte de
respuesta, bloqueo intermedio), el `throw` es una **excepción no capturada**. Y se verificó que
`server.js` **no registra** `process.on('uncaughtException')` ni `unhandledRejection` → el proceso
muere y PM2 lo reinicia, cortando todas las requests en vuelo. Además la llamada **no tiene timeout**:
si GitHub no responde, la request del usuario queda colgada indefinidamente.

(Este endpoint es el que usa el botón "Descargar la app" del portal → es tráfico real de usuarios.)

**Solución propuesta**
1. Envolver el parse: `r.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } })`.
2. Agregar `req2.setTimeout(8000, () => req2.destroy(new Error('timeout')))`.
3. **Independientemente**, agregar en `server.js` handlers de `uncaughtException` /
   `unhandledRejection` que logueen con Winston antes de salir (red de seguridad para todo el
   proceso, no solo este endpoint).

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (1 y 2). El punto 3 conviene tratarlo aparte y probar el arranque en staging antes de prod |

---

## B8 🔵 BAJO-MEDIO — La resolución de suscripción en los webhooks puede elegir la fila equivocada

**Dónde:** `backend-server/routes/webhooks.js:170-180` (pagos) y `:355-366` (preapprovals).

```sql
WHERE u.id = $1 OR s.external_subscription_id = $2
ORDER BY s.id DESC LIMIT 1
```

**Falla concreta**
El comentario dice que `external_reference` (`user_{id}`) es la fuente **prioritaria**, pero la query
la pone en un `OR` y desempata por `s.id DESC`. Si el `preapproval_id` del pago quedara asociado en
la DB a la suscripción de **otro** usuario con `id` mayor (dato cruzado tras un supersede, una
migración o una reconciliación manual), el pago se acredita a la cuenta equivocada: se le aplica el
bono/renovación a un tercero y el pagador real queda sin acreditar.

Probabilidad baja hoy (poco volumen, single-active funcionando), pero el impacto es de los peores
posibles (dinero cruzado entre cuentas) y el fix es trivial.

**Solución propuesta**
- Consultas secuenciales estrictas por prioridad: (1) `WHERE u.id = $1`; si no hay fila, (2)
  `WHERE s.external_subscription_id = $2`; si no, (3) email. O bien conservar el `OR` con un
  desempate explícito: `ORDER BY (u.id = $1) DESC, s.id DESC`.
- Verificación: unitaria/SQL, con dos suscripciones cruzadas a propósito en staging.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** |

---

## B9 🔵 BAJO (latente) — La blacklist de tokens es por proceso

**Dónde:** `backend-server/middleware/tokenBlacklist.js:100-103` — `isBlacklisted()` consulta **solo
el `Map` en memoria**; la escritura en la tabla `token_blacklist` es fire-and-forget y solo se lee al
arrancar (`init`).

**Estado real:** PM2 corre `procurador-api` en `cluster_mode` con **`instances: 1`** (verificado) →
hoy **no hay bug observable**. Pero `ecosystem.config.js` no fija `exec_mode: 'fork'`, y un
`pm2 scale procurador-api 2` (o cambiar `instances` a `max`, que es lo natural al crecer) rompe
**silenciosamente** el logout: el token invalidado en el worker A sigue siendo válido en el worker B
hasta su expiración. Eso anula los fixes **M-1** (logout de admin) y **RI-5** (logout del portal).

**Solución propuesta**
- Mínima y suficiente hoy: dejar constancia en `ecosystem.config.js` (`exec_mode: 'fork'` explícito +
  comentario "no escalar `instances` sin resolver la blacklist compartida").
- Definitiva (para cuando se escale): read-through a la tabla `token_blacklist` ante un miss del Map,
  o mover la blacklist a Redis.

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (la nota + `exec_mode` explícito). La solución definitiva es **medio** y no hace falta hasta escalar |

---

## B10 🔵 BAJO — `expires_at IS NULL` se interpreta distinto según el endpoint

**Dónde:** `routes/client.js:71-77` (fix B4: `NULL` = sin vencimiento) contra
`routes/client.js:119, 162, 246, 306, 675, 728`, `routes/auth.js:587`, `routes/scripts.js:36`
(`AND s.expires_at > NOW()`, donde `NULL` evalúa a falso → excluye la fila).

**Falla concreta**
Una suscripción con `expires_at` en NULL (cuentas reseteadas a mano, altas por script, el propio caso
que motivó el fix B4) **pasa** `verify-session` pero recibe 403 en login, descarga de scripts,
`log-execution`, `batch-limits` y `extension-auth`. Diagnóstico confuso: la sesión "está bien" pero
nada funciona. Hoy ninguna fila de producción está en ese estado, pero el fix B4 se hizo justamente
porque el caso ocurrió.

**Solución propuesta**
- Unificar el criterio en las 8 queries: `AND (s.expires_at IS NULL OR s.expires_at > NOW())`
  (el mismo patrón ya usado en `admin.js:889` y `client.js:526`).
- Ojo: hacerlo **junto con B1**, porque B1 puede cambiar la decisión de fondo (si `expires_at` pasa a
  ser siempre el fin del período pago, quizá convenga lo contrario: no permitir NULL).

| | |
|---|---|
| **Modelo** | Sonnet 5 |
| **Esfuerzo** | **bajo** (cambio mecánico, pero decidir la semántica junto con B1) |

---

## Orden de ejecución sugerido

1. **B1** — bloqueante para B3 (MercadoPago producción). Sin esto, el primer cliente real queda
   afuera al mes. Resolver junto con **B10**, que toca las mismas queries.
2. **B2** y **B3** — cobranza: pérdida de pago y pérdida de ingreso. Ambos son fixes chicos.
3. **B4** y **B5** — bypass de cuotas.
4. **B6**, **B7**, **B8** — robustez / disponibilidad.
5. **B9** — dejar la nota ahora; implementar cuando se escale.

**Sugerencia de agrupación para una sesión de corrección:** un solo lote *backend* con B1+B10+B2+B3
(todos tocan el ciclo de cobranza y se prueban con la misma corrida E2E en staging: activar → pagar →
renovar → cancelar), y un segundo lote con B4+B5+B6+B8. **B7** puede ir con cualquiera de los dos.
Ningún hallazgo requiere release de Electron ni migración de base de datos.

**Modelo/esfuerzo global de la corrección:** Sonnet 5, esfuerzo **medio** — el código de los fixes es
simple, el trabajo real está en la verificación en staging (backup previo, ciclo de cobranza completo,
confirmar que no se rompe la renovación ya validada). Si se decide cambiar la **semántica** de
`expires_at` (B1/B10) en vez de aplicar el fix mínimo, conviene bajar el diseño con Opus antes de
codificar.
