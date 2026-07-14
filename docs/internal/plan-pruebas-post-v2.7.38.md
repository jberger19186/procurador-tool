# Plan de pruebas — post v2.7.38 (AUTH-1 + SEC-2·B.2)

> 2026-07-13 · Verifica en producción real los dos cambios de la última sesión: **AUTH-1**
> (device-binding *soft* del JWT) y **SEC-2·B.2** (verificación diaria real, módulo oculto).
> Ambos tocan/reusan los flujos de ejecución más usados de la app (`run-process`/`run-informe`),
> así que la prueba de mayor valor es una corrida real contra el PJN, no solo revisión estática.

## Por qué hace falta esta prueba

- **AUTH-1** agregó un gate nuevo (`DEVICE_MISMATCH`) en `POST /license/execution/start` —
  el camino caliente por el que pasa TODA ejecución. Un bug ahí bloquearía usuarios legítimos.
- **SEC-2·B.2** requirió extraer `run-process`/`run-informe` de `main.js` a funciones nombradas
  (`runProcessLogic`/`runInformeLogic`) para poder invocarlas desde el módulo de verificación sin
  pasar por un evento de renderer. Es un refactor mecánico, pero toca el código que usa el 100%
  de los usuarios reales para procurar/informar.
- Hasta este plan, ambos cambios solo se habían probado con `curl` (simulando al cliente) y con
  el arranque de la app (`npm start` / `.exe` empaquetado) — nunca con una ejecución real de
  punta a punta después de los cambios.

## Hallazgo de prerequisito (resuelto en esta sesión)

Antes de este plan, **no existía ninguna cuenta con el CUIT de prueba (27320694359) en
producción** — solo los 2 admins. Se creó y activó:

| Campo | Valor |
|---|---|
| user id | 250 |
| email | `procuradortool@gmail.com` |
| CUIT | `27320694359` |
| plan | COMBO_PROMO |
| registration_status | `active` |
| subscription status | `active` |
| usage_limit / usage_count | 20 / 0 (trial — sin `payment_provider`, no hizo falta para esta prueba) |

Creada vía `POST /admin/users` (real, no INSERT manual) → email verificado por SQL (equivalente
al click del link) → `POST /admin/users/:id/activate` (mismo endpoint que usa el botón "Activar"
del dashboard). 20 usos de trial alcanzan de sobra para las 2 ejecuciones de esta prueba
(procuración + informe = 2 usos).

## T0 — Estático (✅ hecho antes de este documento)

- `runProcessLogic`/`runInformeLogic` no referencian el parámetro `event` que dejaron de recibir.
- Un solo `ipcMain.handle('run-process', ...)` y un solo `ipcMain.handle('run-informe', ...)`,
  cada uno delegando a una única definición de función. Sin duplicados, sin código muerto.
- `node -c` limpio en todos los archivos tocados (`main.js`, `preload.js`, `dailyVerification.js`,
  `backendClient.js`, `client.js`, `admin.js`, `dashboard.js`).

**Resultado: el refactor es estructuralmente inocuo.** Esto no reemplaza una corrida real, pero
descarta la clase de bug más obvia (variable no definida, referencia rota).

## T1 — Auditoría de logs prod por `DEVICE_MISMATCH` (✅ hecho)

Se buscó en `pm2 logs procurador-api` (3000 líneas) y en los logs de archivo cualquier ocurrencia
de `DEVICE_MISMATCH` desde el deploy de AUTH-1 (~21:41 del 13/07). **Cero ocurrencias.**

**Salvedad honesta:** `server.js` no tiene un logger de acceso HTTP (no hay `morgan` ni similar),
así que esta búsqueda no habría capturado un 403 igual (la respuesta nunca se loguea, solo se
devuelve al cliente). Pero es irrelevante en la práctica: prod solo tiene los 2 admins (que no
corren scripts PJN) y ningún cliente real pagando todavía — no hay nadie a quien el binding
pudiera haber afectado. Este punto sí importa cuando haya usuarios reales: si en el futuro se
reporta un `DEVICE_MISMATCH` inesperado, **no hay rastro en logs** — conviene agregar logging
puntual a ese branch de `license.js` antes del lanzamiento público.

## T2 — Login real + binding (pendiente, requiere Chrome profile)

**Prerequisito:** el operador debe tener las credenciales del PJN para el CUIT 27320694359
guardadas en el perfil de Chrome dedicado (`%LOCALAPPDATA%\ProcuradorSCW\ChromeProfile`) —
ver diagnóstico rápido en CLAUDE.md ("Diagnóstico rápido: credenciales guardadas").

**Pasos:**
1. Abrir la app v2.7.38 (`npm start` o el instalador) y loguearse con `procuradortool@gmail.com`
   / `Verificacion2026#`.
2. Verificar en DB que `users.machine_id` (id 250) quedó seteado al `machineId` de esta PC.
3. Verificar que una acción cualquiera (Mi Cuenta, Procurar) no dispara `DEVICE_MISMATCH`.

**Pass:** `machine_id` no-NULL tras el login, ninguna acción da 403 `DEVICE_MISMATCH`.
**Fail:** `machine_id` sigue NULL, o cualquier acción legítima da `DEVICE_MISMATCH`.

## T3 — Prueba reina: disparo manual del módulo de verificación (pendiente)

La prueba de mayor valor: una sola corrida real ejercita **a la vez** el refactor de
`run-process`/`run-informe`, el módulo `dailyVerification.js`, el endpoint de reporte, y la
tarjeta del dashboard.

**Pasos:**
1. Con la app abierta y logueada (post-T2), abrir DevTools (F12) en la ventana principal.
2. En la consola, ejecutar: `window.electronAPI.runVerificationNow()`
3. Como `requerirConfirmacion` es `true` por defecto, aparece el diálogo nativo
   "Verificación diaria (PJN real)" → click **"Ejecutar ahora"**.
4. Esperar a que termine (procuración real + informe real, expediente por defecto
   `FCR 018745/2017` — confirmar que ese expediente es consultable por este CUIT, o ajustarlo
   en `verificacion_config.json` en userData antes de correr).
5. Revisar:
   - Consola/UI de la app: ambos procesos terminan sin error (visor HTML / PDF generados).
   - `verificacion_config.json` (userData): `ultimaEjecucion` con `estado` y `detalle` poblados.
   - Dashboard admin → Diagnóstico: tarjeta "🔎 Verificación funcional (PJN real)" en verde,
     con tiempos y sin el aviso de +7 días.

**Pass:** `estado: "ok"`, ambos flujos `ok:true`, tarjeta del dashboard refleja el resultado.
**Fail:** cualquier error en procuración/informe que antes no ocurría, o el reporte no llega
al dashboard (revisar `authManager.backendClient.reportVerification` / logs de prod).

## T4 — Procuración/informe por la UI normal (refuerzo, opcional)

Mismo código que T3 (ambos llaman a `runProcessLogic`/`runInformeLogic`), así que es refuerzo,
no un test independiente. Si T3 pasa limpio, T4 es opcional — hacerlo solo si querés doble
confirmación por el camino exacto que usan los usuarios reales (botones Procurar/Informe en
vez del disparo oculto).

## T5 — Caso negativo AUTH-1 (ya cubierto, no repetir)

Ya validado por `curl` en staging (user 215) y prod (admin id 6): `machineId` distinto al
vinculado → 403 `DEVICE_MISMATCH`; `machineId` NULL → bind-on-first-use. No hace falta repetir
desde la app salvo curiosidad — simularía forzar un `machineId` falso en el request, que ya se
probó exhaustivamente por API directa.

## Criterio de éxito global

**T3 en verde retira ~80% del riesgo real** (refactor + módulo nuevo + reporte + tarjeta, todo
en una sola corrida real). T1+T2 cubren el riesgo específico de AUTH-1. Cualquier fail en T2/T3
debe investigarse antes de considerar el release v2.7.38 completamente verificado.

## Limpieza post-prueba

- Cuenta 250 puede quedar activa como cuenta de prueba permanente de la verificación diaria
  (es justamente su propósito futuro — no hace falta borrarla).
- Si se corre varias veces en el día, recordar que `dailyVerification` no vuelve a disparar
  automáticamente el mismo día (`ultimaEjecucion.fecha === hoy`) — el disparo manual
  (`runVerificationNow()`) sí lo permite siempre (usa `manual:true`, salta esa guarda solo
  para la confirmación, no el guardado de `ultimaEjecucion`... revisar si se quiere permitir
  múltiples corridas manuales el mismo día sin pisar el histórico, ya que si se corre 2 veces
  en un día ambas escriben en `history` (backend) pero el registro local `ultimaEjecucion.fecha`
  del segundo disparo también actualiza igual — no hay bloqueo, es intencional para pruebas.
