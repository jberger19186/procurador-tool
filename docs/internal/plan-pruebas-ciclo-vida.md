# Plan de pruebas — Ciclo de vida del usuario + prueba real con MercadoPago/Electron

> Creado 2026-06-15. Dos planes: (1) ciclo de vida con renovación de período, (2) prueba
> real end-to-end con la cuenta compradora de MP y la app Electron.
> Usuario de prueba: `procuradortool@gmail.com` (id 230) · CUIT **27320694359** (11 dígitos).

---

## Reparto de tareas (quién hace qué)

- **Asistente (Claude):** reset/preparación de estado en la DB, verificación del estado
  después de cada paso (DB ↔ MP), monitoreo de webhooks/logs, forzar el "nuevo ciclo"
  cuando no se puede esperar 30 días, confirmar mensajes esperados.
- **Usuario (vos):** acciones de GUI en la app Electron (Procurar/Informe/Monitor),
  ingresar la tarjeta en el checkout de MP (cuenta compradora logueada en Chrome),
  cargar la clave del PJN en el gestor de contraseñas de Chrome cuando se indique.

---

## PLAN 1 — Ciclo de vida completo (registro → agotar → nuevo ciclo)

Cubre lo ya verificado hoy (fases 1-14) **más la renovación de período**, que es lo nuevo.

| # | Paso | Quién | Verificación esperada |
|---|------|-------|------------------------|
| 1 | Registro (pending_email) | sim/DB | Login app/extensión 403; checkout bloqueado |
| 2 | Verifica email → pending_activation | DB/real | 20 usos habilitados; `verify-session` 200 remaining 20 |
| 3 | Usa hasta 20/20 | app/DB | Bloqueo + banner "Ya consumiste tus usos" (web + app) |
| 4 | (opcional) Admin asigna +N cortesía | admin | `usage_limit` += N; "(+N de cortesía)" visible |
| 5 | Admin activa la cuenta | admin | `active`, **conserva** los usos (incluida cortesía) |
| 6 | Carga método de pago | usuario+MP | `applyTrialBonus`: `usage_limit=999999`, contadores a 0, factura pendiente |
| 7 | Usa cada subsistema hasta el límite | app/DB | Bloqueo por submódulo: proc 50 · informe 50 · batch 20 · nov 50 · partes 20 |
| 8 | **Nuevo ciclo (renovación mensual)** | ver abajo | Contadores reseteados a 0, nueva fecha de cobro, nueva factura |
| 9 | Vuelve a usar tras la renovación | app/DB | Permite ejecutar de nuevo (contadores en 0) |

### Cómo probar el "nuevo ciclo" sin esperar 30 días
El ciclo es mensual; para no esperar se **acelera** manipulando fechas + disparando el evento:

- **Renovación paga (la importante):**
  1. Estado: usuario pago con `next_billing_date` y algún subsistema agotado.
  2. Adelantar el reloj: `UPDATE subscriptions SET next_billing_date = NOW() - INTERVAL '1 day' WHERE user_id=230;`
  3. Disparar la renovación: simular el webhook mensual de MP (`subscription_authorized_payment`) **o** llamar directo a `applyRenewal(subId, plan, nuevaFecha)`.
  4. Verificar: `usage_count=0`, todos los `*_usage=0`, `next_billing_date` +1 mes, `last_payment_at` actualizado, nueva fila en `payments` + factura pendiente, `auto_renewal=TRUE`, `cancel_at` limpio.
- **Cron de reset mensual** (`server.js`, `0 3 1 * *`): resetea el uso el día 1. Se puede invocar su lógica manualmente para verificar.
- **Downgrade programado**: si había `scheduled_plan`, al cruzar el ciclo el cron lo aplica (plan nuevo + `usage_limit=999999` para pagos + ajuste de monto en MP).

> Nota: el **trial NO renueva** (es "hasta el pago"). El "nuevo ciclo" aplica solo a cuentas pagas.

### Variantes a cubrir
- Renovación **exitosa** → contadores a 0, sigue activo.
- Renovación **rechazada** → gracia 3 días (`payment_grace_ends_at`) → si no se recupera, `suspended` + mensaje "Actualizá tu método de pago".
- Con **downgrade programado** activo al cruzar el ciclo → se aplica el plan rebajado.

---

## PLAN 2 — Prueba real E2E con MercadoPago (comprador) + app Electron

Prueba de punta a punta con la automatización real del PJN y el checkout real de MP.

### Prerrequisitos
- App Electron corriendo (`npm start` desde `electron-app/`).
- Chrome con la **cuenta compradora de prueba** de MP logueada (la que ya aparece "en uso").
- Usuario `procuradortool@gmail.com` con **CUIT 27320694359** cargado.
- **Clave del PJN en el gestor de contraseñas de Chrome** del perfil `ProcuradorSCW` — la cargás vos cuando se indique (paso ⚙️), para que la automatización pueda autofill.

### Secuencia
| # | Paso | Quién | Verificación |
|---|------|-------|--------------|
| 0 | Reset de procuradortool a trial limpio (pending_activation, 20/20) | Claude | estado inicial OK |
| ⚙️ | **Cargar la clave del PJN** en el gestor de Chrome (Configuración → Seguridad → "Agregar contraseña SCW") | vos | `Login Data` con entrada `pjn.gov.ar` |
| 1 | En la app: **Procurar** un expediente real | vos | corre la automatización; suma 1 uso; visor abre |
| 2 | Repetir hasta agotar los 20 usos | vos | al llegar a 20/20 → toast/banner "Has alcanzado el límite…"; la extensión también se bloquea |
| 3 | (opcional) Admin +N cortesía | Claude | la app muestra X/(20+N) "(+N cortesía)"; permite N más |
| 4 | Genera ticket de soporte desde la app/portal | vos | ticket creado, visible en admin |
| 5 | Admin activa la cuenta | Claude | `active`, conserva usos; botón de pago habilitado en el portal |
| 6 | **Configurar método de pago** en el portal → checkout MP con la cuenta compradora + tarjeta de prueba (`5031 7557 3453 0604` 11/30 123 APRO) | vos | webhook real → `applyTrialBonus`; 999999 + límites del plan; factura pendiente |
| 7 | En la app: usar **cada subsistema** hasta su límite (proc 50 · informe 50 · batch 20 · monitor 50) | vos | bloqueo por submódulo con "Alcanzaste el límite de X de tu plan" |
| 8 | **Cancelar desde MercadoPago** (cuenta del usuario → Tus suscripciones) | vos | webhook → baja programada; preapproval pausado; portal muestra "Cancelación programada" |
| 9 | **Reactivar desde el portal** | vos | reanuda sin cobro nuevo; `cancel_at` limpio |
| 10 | **Cancelar desde el portal** | vos | pausa + baja programada |
| 11 | **Reactivar desde el portal** | vos | reanuda |
| 12 | **Nuevo ciclo** (forzar, ver Plan 1) | Claude | contadores reseteados; vuelve a poder usar |

### Notas
- El paso 6 (tarjeta) y el 8 (cancelar en MP) requieren la **cuenta compradora** logueada en Chrome.
- En sandbox, `MP_SANDBOX_PAYER_EMAIL` fuerza el pagador de prueba en la reactivación-por-checkout. **Quitar esa env var al pasar a B3 (MP producción real).**
- Tras cada paso de GUI, avisás y Claude verifica el estado en DB/MP + el webhook en los logs.

---

## PLAN 3 — Matriz de cancelación / reactivación (según origen)

Cada combinación toma un camino distinto en MP; hay que probarlas todas. Estado de
partida en cada fila: usuario **pago y activo** (preapproval autorizado en MP).

| # | Cancela desde | Reactiva desde | Resultado esperado |
|---|---------------|----------------|--------------------|
| A | **Portal** | **Portal** | Cancelar PAUSA el preapproval (reversible) + baja programada. Reactivar lo REANUDA (paused→authorized) **sin cobro nuevo**; próximo débito en la fecha original. `cancel_at` limpio. |
| B | **Portal** | **MercadoPago** | Cancelar pausa. El usuario lo reanuda en MP (de pausado → activo) → el webhook `subscription_preapproval` sincroniza la cuenta a activa/renovable. |
| C | **MercadoPago** | **Portal** | Cancelar en MP = TERMINAL. El webhook refleja la baja programada. "Reactivar" en el portal cae a **nuevo checkout con `free_trial`** = días ya pagados → **sin doble cobro**, primer débito en el vencimiento original. |
| D | **MercadoPago** | **MercadoPago** | Cancelar terminal. El usuario re-suscribe en MP (nuevo preapproval) → webhook lo vincula y reactiva. Single-active cancela el viejo. |
| E | **Portal o MP** | **(no reactiva)** | Al cruzar `cancel_at`, el cron pasa la cuenta a `cancelled`, corta el acceso y cancela el preapproval en MP definitivamente. Verificar acceso bloqueado + estado terminal. |

**Verificaciones transversales en cada fila:** coherencia DB ↔ MP (estado del preapproval),
banner correcto en el portal, que **no haya doble cobro**, y que el botón se comporte
(reanudar vs. nuevo checkout) según el caso.

---

## Escenarios adicionales sugeridos (qué más probar)

Más allá del camino feliz, conviene cubrir:

**Cobranza / suscripción**
1. **Pago rechazado** → gracia 3 días (`payment_grace_ends_at`) → si no se recupera, `suspended` + "Actualizá tu método de pago"; y la **recuperación** (paga de nuevo → reactiva).
2. **Idempotencia de pagos**: el mismo webhook de pago dos veces → no duplica factura ni reaplica.
3. **Vencimiento sin reactivar** (fila E) → `cancelled` + acceso cortado.
4. **Reactivación tardía** (después de `cancel_at`) → ya no se puede reanudar; debe re-suscribirse.

**Cambio de plan**
5. **2 cambios/ciclo** y bloqueo del 3°.
6. **Cancelar un downgrade programado** (botón "Cancelar cambio") → vuelve el cambio al contador.
7. **Upgrade/downgrade ajustan el monto en MP** (validado en sandbox; confirmar en real).
8. **downgrade → upgrade** (requiere un 3er plan tarifado activo — L1).
9. Cambio de plan **estando no-activo** (debe rechazar).

**Trial / usos**
10. **Trial compartido app ↔ extensión**: usos consumidos en la app reducen el cupo de la extensión.
11. **Extensión a 20/20** → bloqueada (`extension-auth`) con mensaje + link al portal.
12. **Cortesía**: que sume al trial, se vea "(+N)", y **sobreviva la activación**.
13. **SEC-4** (hardening pendiente): cliente adulterado intentando exceder los 20 usos.

**Monitor**
14. **Límite de partes** (20 en COMBO) → bloqueo al agregar la 21°.
15. **Regla de borrado** de partes (borrable dentro de 24 h o pasados 30 días; bloqueado en el medio).

**Cuenta / admin / sesión**
16. **Admin**: rechazar+bloquear, rechazar+mantener trial, suspender, reactivar, ajuste manual de usos por submódulo, cambiar plan desde la ficha.
17. **Verificación de email**: link vencido + reenvío.
18. **Machine binding**: login desde otro `machineId` (lock de dispositivo).
19. **Sesión**: expiración del token + refresh + auto-recuperación del "No autenticado".
20. **Lock de ejecución multi-dispositivo**: correr en paralelo desde 2 instancias → la 2ª se bloquea.
21. **Facturación**: el admin sube el PDF → aparece en el portal del usuario.

---

## Pendientes que estas pruebas ayudan a cerrar
- Renovación mensual (no ejercitada en E2E automatizado).
- Pago rechazado → gracia → suspensión.
- `downgrade → upgrade` (requiere un 3er plan tarifado activo — L1).
- Validación real (no simulada) del checkout MP + automatización PJN end-to-end.
