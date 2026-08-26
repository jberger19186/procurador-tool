# Plan de implementación — MercadoPago a producción (cierre de B3)

> Fecha: 2026-08-24 · Diseñado con Opus 5 · **Solo diseño, no se tocó código**
> Objetivo: dejar el producto en condiciones de **cobrar dinero real** a clientes.
> Reemplaza al ítem suelto «B3 — MercadoPago producción» de la lista de pendientes de `CLAUDE.md`.

---

## §0 — Estado real, medido (no asumido)

Todo lo de esta sección se verificó en vivo el 2026-08-24 contra el servidor y la cuenta de MP,
no se dedujo del código ni de la documentación previa del proyecto.

| Qué | Valor medido | Implicancia |
|---|---|---|
| `PAYMENT_MODULE_ENABLED` en prod | **`true`** | ⚠️ **El módulo de pagos YA está activo en producción.** `.env.example` dice "mantener en false hasta validar credenciales" y varias entradas de `CLAUDE.md` dan a entender que el switch pendiente es encenderlo — **es falso**. Los crons de cobranza corren, el checkout está habilitado y el webhook responde. Lo único que impide un cobro real es que las credenciales son de sandbox. |
| `MP_ENV` en prod | `sandbox` | El guard de `utils/mercadopago.js` no dispara (correcto: la base no es de staging), pero el marcador declara sandbox. |
| `MP_ENV` / `DB_NAME` en staging | `sandbox` / `procurador_db_staging` | Guard fail-closed vigente y consistente. |
| `payments` en prod | **0 filas** | **Nunca hubo un cobro real en la historia del proyecto.** |
| `invoices` en prod | **0 filas** | Ídem — la facturación manual nunca se ejercitó con un cliente real. |
| `subscriptions` con `payment_provider` | **0** | Nadie tiene método de pago configurado. Cero clientes activos que romper. |
| `webhook_events` en prod | 21 filas | Residuo de las pruebas de sandbox. Ver F-C.2 (limpieza). |
| `users` en prod | 3 (2 admins + 1 cuenta de prueba) | Radio de impacto del switch: prácticamente nulo. |
| Planes activos y públicos | `EXTENSION_PROMO` ($1.500) · `COMBO_PROMO` ($15.000) | Coinciden con `PLAN_PRICES` de `.env` y con la landing. |
| `MP_PLAN_*_ID` en prod | Presentes, pero **son IDs de la cuenta sandbox** | 🚨 **Estos IDs no existen en la cuenta productiva.** Al cambiar el token sin recrear los planes, `createPreapproval()` falla en la línea 53 con *"Plan MP no encontrado"* → el checkout se cae para todos. Es el punto más fácil de pasar por alto de todo el switch. |
| `MP_SANDBOX_PAYER_EMAIL` en prod | **Presente** | 🚨 Con credenciales reales, `createUpdatePreapproval` y `createReactivationPreapproval` mandarían un email de test user a MP producción. Ver F-A.2. |
| Webhook registrado en el panel de MP | **Ninguno** (`notifications_history` → *"no webhook notifications configured"*) | 🚨 Sin el webhook dado de alta en el panel productivo, ningún pago se acredita: el código está listo pero no le llega nada. Ver F-C.1. |
| `FACTURANTE_WSDL_URL` | vacío | Facturación manual (admin sube PDF de ARCA). Ver Fase D. |

---

## §1 — Lo que NO falta (para no perseguir un fantasma)

**No existe homologación técnica formal para Suscripciones.** Consultado el 2026-08-24 contra las
herramientas oficiales de MP vía su servidor MCP:

- `quality_checklist` sobre la app `2341542747454000` devuelve **`Product not homologable`**.
- `form_homologation` con `product_id: 28` (Subscription) devuelve `steps: []`.
- La documentación oficial lo confirma: la medición de calidad automática cubre *"Checkout Pro,
  Checkout API, Checkout Bricks y Mercado Pago Point"* — **Suscripciones no está en esa lista**.

O sea: **no hay un puntaje 0-100 que alcanzar ni un checklist certificable que aprobar** para este
producto. Lo que MP sí exige antes de producción (documento *"Requisitos para salir a producción"*)
es más acotado, y el estado actual es:

| Requisito oficial | Estado |
|---|---|
| Credenciales de producción activadas | ⬜ **Es exactamente lo que este plan resuelve** |
| Certificado SSL en el dominio | ✅ Vigente (certbot, `api.procuradortool.com`) |
| Notificaciones (Webhooks) operativas | ⚠️ Código listo, **URL no registrada en el panel** |
| Reportes de conciliación | ⬜ No implementado — es *recomendación*, no requisito |

También quedan **descartados** de la revisión anterior dos puntos que no aplican:

- **Contracargos (`charged_back`)**: el topic `topic_chargebacks_wh` solo existe para Checkout
  Pro/API/Bricks. No hay que programar una rama para eso.
- **`MP_PUBLIC_KEY` sin uso**: correcto que no se use — es para Checkout Bricks/JS en el frontend.
  Suscripciones redirige al checkout alojado por MP. No es un hueco.

---

## §2 — Las fases

Ordenadas por **dependencia dura** y agrupadas por **actor y vector de despliegue**. Las fases A y B
corren **en paralelo** (A es código, B es un trámite externo con tiempos propios).

---

### 🔵 FASE A — Endurecimiento del código (antes de que haya plata de por medio)

> **Modelo: Sonnet 5 · Esfuerzo: ALTO · ~1 sesión · Riesgo: 🟢 bajo (nada observable cambia)**
> Se puede ejecutar **hoy**, sin depender de MP ni del operador. Sigue todo en sandbox.

El esfuerzo es alto no por volumen —son ~40 líneas— sino porque **cada una de las tres tareas tiene
una trampa que produce un bug de plata si se implementa de la forma obvia**.

#### A.1 — `Idempotency-Key` en las creaciones de preapproval 🚨

`utils/mercadopago.js:56` declara `idempotencyKey: undefined // se setea por request en cada llamada`
— pero **ningún `.create()` la pasa**. Los 3 call sites descubiertos:

| Función | Archivo | Qué crea |
|---|---|---|
| `createReactivationPreapproval` | `subscriptionService.js:161` | Preapproval con `free_trial` |
| `createUpdatePreapproval` | `subscriptionService.js:220` | Preapproval con cobro inmediato |
| `createPreapproval` | `subscriptionService.js:39` | *(No crea — solo lee el plan y arma la URL. **No necesita key**.)* |

Sintaxis oficial confirmada en la doc de MP:
`client.create({ body, requestOptions: { idempotencyKey: '<VALOR>' } })`.

> ⚠️ **La trampa, y el motivo del esfuerzo alto:** la implementación obvia —`crypto.randomUUID()`
> generado dentro de la función— **no protege de nada**. Una key nueva por invocación significa que
> un usuario que hace click dos veces (o vuelve del checkout y reintenta) genera dos preapprovals
> igual. El propósito de la key es que **el mismo intento lógico reuse la misma clave**.
>
> **Diseño recomendado:** persistir la clave junto al checkout. Ya existe
> `subscriptions.checkout_initiated_at` estampado en el init — agregar
> `subscriptions.checkout_idempotency_key` (migración aditiva de 1 columna) y reusarla mientras el
> checkout esté dentro de su ventana (los mismos 30 min que ya usa el claim de `markPaymentConfigured`),
> regenerándola al iniciar un checkout nuevo.
>
> ⚠️ **Segunda trampa:** la clave **jamás** puede derivarse solo del plan o de un valor compartido
> entre usuarios — MP cachea la respuesta por clave, así que dos usuarios con la misma key recibirían
> el preapproval del otro. Debe incluir el `user_id`.

#### A.2 — Convertir `MP_SANDBOX_PAYER_EMAIL` en un mecanismo, no en un recordatorio

Hoy en `subscriptionService.js:137` y `:200`:
```js
const payerEmail = process.env.MP_SANDBOX_PAYER_EMAIL || sub.email || '';
```
El comentario dice *"Quitar esa env var al pasar a MP producción (B3)"*. **Es exactamente el mismo
patrón que ya falló una vez en este proyecto**: `.env.staging` tenía escrito desde junio *"MercadoPago
FIJADO EN SANDBOX — no cambiar"* y aun así compartía el token con producción, porque un comentario no
detiene un `cp`. Ese hallazgo (V7, 2026-08-24) se resolvió con el guard de `utils/mercadopago.js`.

**Aplicar la misma lección acá:** que el override sea ignorado cuando `MP_ENV === 'production'`, en
vez de depender de que alguien se acuerde de borrar la variable.

#### A.3 — Guard de arranque: coherencia entre `MP_ENV` y el token

Simétrico al guard de staging que ya existe, pero en la otra dirección: si `MP_ENV=production` pero
el `MP_ACCESS_TOKEN` sigue siendo de prueba (los tokens de test de Suscripciones llevan prefijo
`TEST-`), o si `MP_SANDBOX_PAYER_EMAIL` sigue seteado, **fallar de forma visible al bootear** en vez
de operar en un estado híbrido silencioso.

Mismo criterio de proporcionalidad que el guard existente: anular la capacidad de cobro y loguear en
`console.error` de forma greppeable, **sin tirar abajo el resto de la aplicación**.

#### A.4 — Rama `refunded` en `handlePaymentEvent` — ✅ **DECIDIDO: corte inmediato**

**Hueco detectado el 2026-08-24 al revisar la cobertura de este plan, no listado antes.**
`handlePaymentEvent` tiene ramas para `approved` y `rejected`; cualquier otro estado cae al `else`
genérico que **solo registra el pago en `payments` para auditoría**. Confirmado por grep: no hay
ninguna referencia a `refunded` en `routes/webhooks.js`.

Consecuencia concreta: **si se reembolsa un pago desde el panel de MP, el usuario conserva el acceso.**
MP envía el webhook, el pago queda con `status='refunded'` en la base, y `subscriptions`/`users` no se
tocan. Importa ahora porque el reembolso manual es el flujo vigente (E.1 no está implementado) y
aparece en C.3.7.

**✅ Política elegida por el operador (2026-08-26): reembolso = corte inmediato** — lo habitual en
SaaS. La alternativa evaluada y descartada era *"acceso hasta fin del período"*, que no requería
código porque es el comportamiento actual.

**Qué implica implementarlo** (~10 líneas, pero con tres detalles que no son obvios):

1. **Agregar la rama `refunded` en `handlePaymentEvent`**, junto a `approved` y `rejected`, que
   suspenda la cuenta: `subscriptions.status` y `users.registration_status` a `suspended`.
   ⚠️ **No reusar `suspended_plan_expired`** — ese estado tiene su propio circuito de recuperación
   por vencimiento de plan (cron 5f + reactivación por checkout). Un reembolso no es un vencimiento;
   conviene que el motivo quede distinguible en `user_events` para que el admin entienda por qué la
   cuenta se cortó.
2. **Idempotencia**, igual que ya tienen `approved` y `rejected`: MP reenvía webhooks. Un segundo
   `refunded` del mismo `external_payment_id` no debe volver a suspender ni duplicar el evento
   (el guard de `webhook_events` ya cubre el reenvío exacto; verificar que la rama nueva pase por él).
3. **Cancelar el preapproval en MP**, si sigue vivo. Reembolsar un pago **no cancela la suscripción
   recurrente**: sin este paso, el usuario queda suspendido pero MP le vuelve a cobrar el mes
   siguiente — el peor de los dos mundos. Reusar `cancelSubscription` / `pausePreapproval`, que ya
   existen y están verificados.

**Verificación:** contra staging (sandbox), simular el webhook `refunded` sobre un pago de fixture y
confirmar los 4 efectos: cuenta suspendida · evento registrado con el motivo · preapproval
cancelado/pausado en MP · reenvío del mismo webhook sin efecto adicional. Se apoya en el harness de
V7 (`verify-v7-cobranza.js`), que ya sabe disparar webhooks firmados sin escribir en MP.

**Sigue sin bloquear la comercialización:** si por algún motivo esta rama no llegara a la Fase A, el
admin puede suspender a mano desde el dashboard. Pero al estar decidido, **entra en la Fase A** y se
prueba con el resto del endurecimiento, antes de que haya dinero real.

#### Verificación de la Fase A
- Harness contra **staging** (sandbox, sin riesgo): dos llamadas consecutivas con la misma clave
  devuelven el **mismo** `preapproval.id`; con claves distintas, ids distintos.
- Las 3 ramas del guard de A.3 probadas explícitamente (como se hizo con el guard de V7: encendido,
  forzado a la condición de error, y restaurado).
- **A.4**: webhook `refunded` simulado sobre un pago de fixture → los 4 efectos verificados (cuenta
  suspendida · evento con motivo · preapproval cancelado/pausado · reenvío idempotente).
- No-regresión: el smoke de cobranza (`dev-tools/smoke-payments.js`, 19/19) y el harness de V7
  (`verify-v7-cobranza.js`, 40/40) siguen pasando.

---

### 🟡 FASE B — Trámite externo en la cuenta de MercadoPago

> **Modelo: n/a (acción del operador) · Esfuerzo: BAJO · Tiempo: incierto (depende de MP)**
> **Arrancar en paralelo con la Fase A** — mismo criterio que el Bloque E de la extensión, que
> dependía de los tiempos de Google.

1. Activar **credenciales de producción** en el panel de MP (`Tus integraciones → Producción`).
   Puede requerir validación de identidad de la cuenta vendedor — es el paso con demora impredecible
   y por eso va primero.
2. Confirmar que la cuenta vendedor está habilitada para **cobros recurrentes reales** en ARS.
3. No copiar todavía ninguna credencial al servidor — eso es la Fase C.

---

### 🔴 FASE C — Activación y primer cobro real

> **Modelo: Opus 5 · Esfuerzo: ALTO · 1 sesión · Riesgo: 🔴 alto — hay dinero real**
> **Requiere al operador presente** (una persona con una tarjeta real completando un checkout).
> ⚠️ **Punto de no retorno del proyecto:** al terminar esta fase el sistema puede cobrarle a terceros.

Agrupa provisión + switch + verificación E2E en una sola sesión a propósito: el operador tiene que
estar presente para las tres, y separarlas obligaría a reconstruir contexto sin ninguna ganancia.

#### C.1 — Provisión en la cuenta productiva (antes de tocar el `.env`)

| # | Tarea | Por qué importa |
|---|---|---|
| C.1.1 | **Crear los 2 `preapproval_plan` en la cuenta productiva** (`COMBO_PROMO` $15.000 · `EXTENSION_PROMO` $1.500) y anotar los IDs nuevos | Los IDs actuales son de sandbox. **Sin esto el checkout devuelve 500 para todos los usuarios.** No existe script en el repo — los de sandbox se crearon a mano. Conviene dejar el script versionado en `dev-tools/` para poder reproducirlo. |
| C.1.2 | **Registrar el webhook productivo** apuntando a `https://api.procuradortool.com/webhooks/mercadopago`, con los topics de suscripciones (`payment`, `subscription_preapproval`, `subscription_authorized_payment`) | Hoy no hay ninguno registrado. Sin esto **ningún pago se acredita**: el usuario paga, MP cobra, y la cuenta nunca se activa. |
| C.1.3 | Obtener el **`MP_WEBHOOK_SECRET` de producción** | Es distinto del de sandbox. Con el secreto viejo, toda firma da inválida → 401 → MP reintenta 3 veces y desiste. |
| C.1.4 | **Verificar que los 3 precios coinciden**: tabla `plans.price_ars` = `MP_PLAN_*_PRICE` del `.env` = `transaction_amount` del plan recién creado en MP | Si difieren, el usuario ve un precio en la landing y se le cobra otro. Es el error más caro de explicar a un cliente. |

#### C.2 — El switch (con respaldo previo, como todo deploy del proyecto)

1. Backup del `.env` de producción y de la base (`ops/backup-now.sh prod`).
2. Reemplazar: `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, los 2 `MP_PLAN_*_ID`.
3. `MP_ENV=production` **solo en el `.env` de prod**.
4. **Eliminar `MP_SANDBOX_PAYER_EMAIL`** (tras A.2 ya sería inocuo, pero no dejar basura).
5. 🚨 **No tocar `.env.staging`** — se queda en `MP_ENV=sandbox` con sus credenciales de prueba.
6. Limpiar `webhook_events` (21 filas de sandbox): el UNIQUE es `(provider, external_id)` y una
   colisión de id entre espacios haría que un webhook real se descarte como duplicado. Improbable,
   pero el costo de limpiar es cero y el de la colisión es un pago perdido.
7. `pm2 restart procurador-api` + confirmar en el log que **el guard de A.3 no disparó**.

#### C.3 — Verificación E2E con dinero real (lo que V7 no pudo cubrir)

V7 (2026-08-24) validó 40/40 aserciones de cobranza, pero **su regla de seguridad central era que
ninguna aserción alcanzara un camino que escribiera en MP**. Por eso quedaron sin ejercitar
exactamente las piezas más delicadas, y son las que esta fase tiene que cubrir:

| # | Qué probar | Por qué solo se puede acá |
|---|---|---|
| C.3.1 | **Pago real de punta a punta**: checkout → tarjeta real → webhook → cuenta activada | Requiere una persona completando el formulario de MP. Es el único camino feliz nunca verificado end-to-end en producción. |
| C.3.2 | **Transacción atómica de `handlePaymentEvent`** (fix M4) | V7 verificó sus piezas por separado, **nunca su composición dentro del `BEGIN/COMMIT`**. El ROLLBACK ante fallo intermedio sigue sin ejercitarse. |
| C.3.3 | **`markPaymentConfigured` / `reconcileClaimedCheckout`** | La atribución del preapproval **por ventana de tiempo** es lo más frágil de toda la cadena (riesgo documentado: dos usuarios pagando en la misma ventana de minutos). |
| C.3.4 | **`updatePreapprovalAmount`** (cambio de plan con monto real) | Validado en sandbox, nunca contra un preapproval que cobra de verdad. |
| C.3.5 | Firma HMAC con el **secreto productivo** → webhook aceptado (200) | La prueba positiva de firma solo vale contra el secreto real. |
| C.3.6 | Factura pendiente creada, límites del plan aplicados, `expires_at` avanzado | Confirma los fixes B1/B2 con datos reales. |
| C.3.7 | **Cancelar y reembolsar** la suscripción de prueba, y **confirmar que la rama `refunded` de A.4 corta el acceso de verdad** | Cierra el ciclo y deja la cuenta limpia. El reembolso se hace **manual en el panel de MP** (ver Fase E.1). Es además la única oportunidad de ver la rama nueva ejercitada por un webhook **real** de MP y no simulado: verificar los 4 efectos de A.4 (cuenta suspendida · evento con motivo · preapproval cancelado · sin cobro al mes siguiente). |

**Criterio de corte:** si C.3.1 o C.3.3 no pasan, **revertir al `.env` de sandbox** (el backup del
paso C.2.1) antes de anunciar nada. El rollback es un `cp` + `pm2 restart`, segundos.

---

### 🟢 FASE D — Facturación: decisión, no desarrollo

> **Modelo: n/a (decisión del operador) · Esfuerzo: NULO en código**

Hoy la facturación es **manual**: el admin emite en ARCA y sube el PDF desde el dashboard. El código
del automático (Facturante) ya existe en `utils/facturante.js` y su cron está comentado en
`server.js:963`, esperando `FACTURANTE_WSDL_URL`.

| Opción | Cuándo conviene |
|---|---|
| **A — Seguir manual** *(recomendada para arrancar)* | Costo cero, cero código. Cuello operativo de ~5 min por cliente por mes. Razonable hasta ~20-30 clientes. |
| **B — Contratar Facturante** | Cuando el volumen haga insostenible la opción A. Es completar 5 variables de entorno y descomentar el cron — el código ya está escrito y no requiere una fase de desarrollo. |

**No bloquea la comercialización.** La obligación fiscal se cumple igual emitiendo en ARCA.

---

### ⚪ FASE E — Mejoras post-lanzamiento (no bloquean)

> **Modelo: Sonnet 5 · Esfuerzo: MEDIO · Diferible**

| # | Tema | Nota |
|---|---|---|
| E.1 | **Reembolso vía API** | Hoy `GET /admin/users/:id/refund-preview` solo **calcula** el prorrateo; el reembolso se ejecuta a mano en el panel de MP. Automatizarlo tiene sentido recién con volumen. |
| E.2 | **Reportes de conciliación** | Recomendación oficial de MP para cerrar el circuito financiero contra la contabilidad propia. |
| E.3 | **Retry/backoff en las 2 llamadas `fetch` crudas** | `markPaymentConfigured` y `resolveRealPreapprovalId` llaman a `/preapproval/search` con `fetch()` directo (fuera del SDK), con try/catch pero sin manejo de 429. Suficiente a bajo volumen. |
| E.4 | **Pruebas de carga/concurrencia** | Nunca hechas en el proyecto. Cobran relevancia real recién con clientes concurrentes. |

---

## §3 — Resumen: fases, modelo y esfuerzo

| Fase | Qué es | Actor | Modelo | Esfuerzo | Riesgo | Bloquea comercializar |
|---|---|---|---|---|---|---|
| **A** | Endurecimiento del código | Claude | **Sonnet 5** | 🔴 Alto | 🟢 Bajo | ✅ Sí |
| **B** | Credenciales de producción | Operador | — | 🟢 Bajo | 🟢 Bajo | ✅ Sí |
| **C** | Provisión + switch + E2E real | Claude + **operador presente** | **Opus 5** | 🔴 Alto | 🔴 Alto | ✅ Sí |
| **D** | Decisión de facturación | Operador | — | — | 🟢 Bajo | ❌ No |
| **E** | Mejoras post-lanzamiento | Claude | Sonnet 5 | 🟡 Medio | 🟢 Bajo | ❌ No |

**Camino crítico: A + B (en paralelo) → C.** Son 2 sesiones de trabajo más un trámite externo.

**Por qué Opus solo en C:** es la regla que el proyecto ya viene aplicando (Opus en F2.2 de Bitácora,
en el punto crítico P2 del parser adyacente al cobro, y en A.3 del plan de correcciones). C es el
único tramo donde un error se mide en dinero real cobrado a un tercero, y el único sin vuelta atrás
limpia una vez que hay un cliente pagando.

**Por qué A es "alto" pese a ser ~40 líneas:** las tres tareas tienen trampas que producen bugs de
plata si se implementan de la forma obvia — una `Idempotency-Key` mal derivada es peor que no tenerla
(puede devolverle a un usuario el preapproval de otro).

---

## §4 — Puntos de no retorno y rollback

| Momento | ¿Reversible? | Cómo |
|---|---|---|
| Fin de Fase A | ✅ Totalmente | Commit revertible, sigue todo en sandbox. |
| Fin de C.2 (switch), **sin cobros aún** | ✅ Sí, en segundos | Restaurar el `.env` de backup + `pm2 restart`. |
| Después de C.3.1 (**primer cobro real**) | ⚠️ Parcial | El cobro existe. Se puede reembolsar desde el panel de MP, pero ya hubo movimiento de dinero. |
| Primer cliente real pagando | ❌ No | A partir de acá cualquier cambio en el módulo de cobro afecta a alguien que pagó. |

---

## §5 — Checklist de corte antes de anunciar

Todo verificado en vivo, no asumido:

- [ ] **Certificado SSL vigente** en `api.procuradortool.com` (requisito oficial de MP y condición
      para que el webhook reciba: MP no entrega sobre un cert inválido). Verificado el 2026-08-24:
      vence **2026-10-27**, `certbot.timer` activo. ⚠️ El dato de `CLAUDE.md` que decía *"vence
      2026-08-28"* estaba stale — certbot ya había renovado solo.
- [ ] `MP_ENV=production` en prod · `MP_ENV=sandbox` en staging (**los dos**, confirmados por separado)
- [ ] Guard de A.3 no dispara en prod y **sí** dispara si se fuerza la inconsistencia
- [ ] Los 2 `preapproval_plan` existen en la cuenta productiva con los montos correctos
- [ ] Precio idéntico en los 3 lugares: `plans.price_ars` = `.env` = plan en MP = landing
- [ ] Webhook registrado en el panel, con firma productiva validada por una prueba **positiva**
- [ ] Un pago real acreditado: `payments` con `status='approved'`, cuenta activada, límites aplicados
- [ ] `expires_at` y `next_billing_date` avanzados (fix B1 vigente con datos reales)
- [ ] Factura pendiente generada para ese pago
- [ ] Suscripción de prueba cancelada y reembolsada; sin preapprovals vivos huérfanos
- [ ] `pm2-error.log` sin entradas nuevas atribuibles al switch
- [ ] Backup del `.env` anterior guardado y su ruta anotada

---

## §6 — Prompts de arranque

**Fase A** (sesión nueva, Sonnet 5, esfuerzo alto):
> Ejecutá la **Fase A** de `docs/internal/plan-mercadopago-produccion-2026-08-24.md` (endurecimiento
> del código de MercadoPago: `Idempotency-Key`, `MP_SANDBOX_PAYER_EMAIL` y guard de coherencia).
> Leé §2/Fase A completa antes de escribir código — las tres tareas tienen trampas documentadas ahí.
> Verificá contra staging, no toques producción.

**Fase C** (sesión nueva, Opus 5, esfuerzo alto, **con el operador presente**):
> Ejecutá la **Fase C** de `docs/internal/plan-mercadopago-produccion-2026-08-24.md` (activación de
> MercadoPago producción). Confirmá primero que la Fase A está desplegada y que las credenciales de
> producción ya existen. Hay dinero real de por medio: backup previo obligatorio y criterio de corte
> según §2/C.3.
