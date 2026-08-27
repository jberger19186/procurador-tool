# Plan — Verificación funcional contra el PJN, reportada al dashboard

> Etapa 1, ítem **1.5** del [roadmap de salida a mercado](roadmap-salida-a-mercado-2026-08.md).
> Escrito: 2026-08-26 (Opus, solo diseño — no se tocó código).
> Estado: **listo para ejecutar**, sin código escrito.

---

## 1. El problema, medido

El dashboard admin ya tiene una tarjeta **"🔎 Verificación funcional (PJN real)"** en
Diagnóstico. Hoy muestra esto:

```
⚠️ Desactualizado          Última verificación: hace 43 días
⚠️ Hace más de 7 días que no se verifica el funcionamiento contra el PJN real
   Procuración   ✅ OK · 41.2s
   Informe       ✅ OK · 71.3s
   Historial reciente:  hace 43 días — ✅ ok
```

**Ese "hace 43 días" es literal.** El archivo `data/verification-results.json` en producción
tiene **un solo registro**, del `2026-07-14` — el día que se implementó SEC-2·B.2. Nunca más
entró nada.

**Y mientras tanto, la verificación sí se hizo — 6 veces.** Según el registro de sesiones,
la *prueba diaria de la app vía computer-use* se corrió el **31/07, 03/08, 05/08, 09/08 y
12/08 (×2)**, cubriendo **5 flujos reales contra el PJN** en cada corrida. Ese resultado
quedó escrito en prosa dentro de `CLAUDE.md` y **no llegó nunca al dashboard**.

O sea: el dato se produce, es de buena calidad, y se pierde.

---

## 2. Decisión de enfoque

Se evaluaron dos caminos y **se eligió el B**.

| | **A — automatizar `dailyVerification.js`** | **B — reportar la prueba de computer-use** ✅ |
|---|---|---|
| Flujos cubiertos | 3 | **5** |
| Disparo | automático al abrir la app | manual, en un chat |
| ¿Se usa en la práctica? | **no — apagado hace 43 días** | **sí — 6 corridas en 6 semanas** |
| Release de Electron | necesario | **no** |
| Superficie nueva en `/client/*` | sí | **ninguna** |
| Guard por CUIT + 3 capas de defensa | necesarias | innecesarias (todo admin-only) |

**Por qué B:** cubre más, cuesta menos, no toca la app, y sobre todo **documenta lo que
realmente pasa** en vez de lo que teóricamente debería pasar. El enfoque A abría un endpoint
nuevo en `/client/*` — el router que usan las apps de **todos** los usuarios — para leer una
config remota; eso exigía guard por CUIT, fail-closed en el cliente y defensa en profundidad.
El enfoque B no agrega **ni un solo endpoint** en `/client/*`.

**`dailyVerification.js` no se toca.** Queda como está, apagado. Si algún día se prende,
reporta con `origen: 'app-automatica'` y la misma tarjeta lo muestra sin cambios.

**El patrón ya existe y está probado:** `POST /admin/smoke-tests/report-pjn` y
`report-extension` hacen exactamente esto — un proceso corre *fuera* del servidor y reporta
el resultado al dashboard con un token admin.

---

## 3. Los 5 flujos que se verifican

Son los que el procedimiento de `CLAUDE.md` ("Prueba diaria de la app Electron vía
computer-use") ya corre, sin cambios:

| # | Flujo | Qué produce |
|---|---|---|
| 1 | Procuración común (fecha límite del día) | Visor de Novedades |
| 2 | Procuración por lote (`batch.txt`, 2 expedientes) | Visor de Novedades |
| 3 | Informe individual | PDF |
| 4 | Informe por lote | Visor de Informes + Excel |
| 5 | Monitor — Buscar Novedades | Visor Monitor — Novedades |

**Decisión explícita del operador (2026-08-26): los flujos quedan como están.** No se suma
"Monitor — Consulta Inicial", aunque se dejó constancia de que no se ejercita desde el
2026-07-23 (34 días) — ver §9.

**No cubiertos por este mecanismo, a propósito:**
- **Extensión Chrome** — computer-use no puede clickear en Chrome (tier "read"). Ya la cubre
  `smoke-test-pjn.js` (48 checks) con su propia tarjeta en Diagnóstico.
- **Markdown** — descarga PDFs del SCW, así que sí toca el PJN, pero todavía no está en
  producción (falta el release). Prematuro.

---

## 4. Presupuesto de cupo (medido, no estimado)

Una prueba completa consume **exactamente** esto (verificado por SQL sobre `usage_logs` el
2026-06-20 y reconfirmado el 12/08):

| Contador | Consumo por prueba |
|---|---|
| `proc_usage` | **+1** (por ejecución, no por expediente) |
| `batch_usage` | **+1** |
| `informe_usage` | **+3** (1 individual + 2 del lote) |
| `monitor_novedades_usage` | **+1 por parte** (hoy hay 3 partes activas → +3) |
| `usage_count` (global) | **+6 / +7** |

**Estado real de la cuenta de prueba (id 250, CUIT `27320694359`) al 2026-08-26:**

```
global    97/110  → quedan 13
proc      24/50   → quedan 26
batch     10/20   → quedan 10
informe   46/50   → quedan  4   ← cuello de botella
monitor   26/50   → quedan 24
```

Los 4 `*_bonus` están en **0**. **Alcanza para una sola prueba más**; la siguiente choca con
el límite de informes.

🚨 **Hallazgo que condiciona el diseño de la recarga:** `checkSubsystemLimit` (main.js)
**no mira `payment_provider`** — enforza por submódulo para cualquier cuenta con límite
finito. Y la cuenta 250 tiene `payment_provider = NULL`. Por eso la recarga necesita
**dos mecanismos distintos**:

- **Cupo global** (`subscriptions.usage_limit`) → el camino de `extra-usage`, cuyo `UPDATE`
  lleva `WHERE payment_provider IS NULL` (funciona para esta cuenta, y por eso las cortesías
  de +20 y +30 sí surtieron efecto).
- **Cupo por submódulo** (`proc_bonus`, `batch_bonus`, `informe_bonus`,
  `monitor_novedades_bonus`) → el camino de `POST /admin/subscriptions/:userId/adjust`.

Tocar solo uno de los dos **no** destraba la prueba.

---

## 5. Qué pasa si falta cupo (y por qué importa)

El pre-check `checkSubsystemLimit` bloquea **antes de abrir Chrome**: muestra
*"Alcanzaste el límite de X de tu plan"*, no ejecuta, no gasta, no toca el PJN. **Falla
limpio.**

Pero ese ❌ **no significa "el PJN se rompió"** — significa "se acabó el cupo". Es un falso
positivo que envenena exactamente la señal que la tarjeta debe dar.

**Ventaja del enfoque B:** como el reporte lo escribe una persona (o Claude) *después* de
correr la prueba, distingue *"Informe: omitido, sin cupo"* de *"Informe: error, el PJN
devolvió X"*. No hace falta programar esa detección — es juicio directo al reportar. El
modelo de datos de §6 lo soporta con un estado `omitido` por flujo.

---

## 6. Modelo de datos

Hoy `verification-results.json` tiene **dos campos fijos** (`procuracion`, `informe`) y el
renderer del dashboard los tiene **hardcodeados**. Con 5 flujos eso no escala.

Se generaliza a un array:

```jsonc
{
  "latest": {
    "timestamp": "2026-08-26T22:40:00.000Z",
    "origen": "computer-use",            // | "app-automatica"
    "estado": "ok",                       // ok | parcial | error
    "tiempoTotalMs": 640000,
    "flujos": [
      { "clave": "proc",     "nombre": "Procuración",          "estado": "ok",      "tiempoMs": 41200, "detalle": "2/2 exitosos" },
      { "clave": "batch",    "nombre": "Procuración por lote", "estado": "ok",      "detalle": "2/2 exitosos" },
      { "clave": "informe",  "nombre": "Informe individual",   "estado": "ok",      "detalle": "PDF 4 páginas" },
      { "clave": "informe_lote", "nombre": "Informe por lote", "estado": "omitido", "detalle": "sin cupo de informes" },
      { "clave": "monitor",  "nombre": "Monitor — novedades",  "estado": "ok",      "detalle": "3/3 partes, 0 novedades" }
    ],
    "notas": "Texto libre del operador o de Claude.",
    "reportedBy": "admin@procurador.com"
  },
  "history": [ /* ídem, últimos 30 */ ]
}
```

**Compatibilidad:** el registro viejo del 14/07 (con `procuracion`/`informe` y sin `flujos`)
se **convierte al vuelo en la lectura**, no se migra el archivo. Así no se pierde el
historial ni hace falta tocar el `POST /client/verification-report` existente.

`estado` por flujo tiene **3 valores**, no 2: `ok` · `error` · `omitido`. El tercero es el
que evita el falso positivo de §5.

---

## 7. Fases

### F1 — Backend: modelo + endpoint de reporte · Sonnet · **medio**

- Generalizar el modelo a `flujos[]` (§6) con conversión de lectura para el registro viejo.
- `POST /admin/diagnostics/verification/report` — `authenticateAdmin`, calcado de
  `report-pjn`. Valida `estado`, `flujos[]` y las claves permitidas.
- Extender `GET /admin/diagnostics/verification/latest` para devolver además, por cada flujo,
  **cuándo fue la última vez que estuvo `ok`** (se calcula del historial ya guardado, sin
  costo extra). Eso hace visible un flujo que hace mucho no se verifica sin obligar a
  correrlo siempre.
- Sin migración de DB (el estado vive en un JSON, igual que los smoke tests).

### F2 — Backend: cupo (lectura + recarga segura) · 🔴 **Opus** · **medio**

**Es la única fase que crea una vía nueva de otorgar cupo.** Va en Opus por eso, no por
volumen — equivocarse acá es caro.

- `GET /admin/diagnostics/verification/quota` → estado de los 5 contadores de la cuenta de
  prueba + un booleano `alcanzaParaUnaPrueba` calculado contra el presupuesto de §4.
- `POST /admin/diagnostics/verification/quota/top-up` → suma **solo lo faltante** para dejar
  reserva de **2 pruebas**, tocando los dos mecanismos de §4.

**Las 7 protecciones, todas obligatorias:**

| # | Protección | Por qué |
|---|---|---|
| 1 | `authenticateAdmin` | Un usuario normal no llega al endpoint |
| 2 | **Solo la cuenta de verificación** — `user_id` fijo, resuelto server-side por `VERIFICATION_TEST_CUIT`; **no acepta un `user_id` del cliente** | Que ni un admin pueda usarlo como atajo genérico para recargar a un cliente. Para eso ya existe `extra-usage`, con su motivo obligatorio y su auditoría |
| 3 | **Solo suma lo faltante** (idempotente) | Llamarlo 10 veces seguidas no acumula 10 recargas |
| 4 | **Tope duro por submódulo** (p. ej. ≤20 por llamada) y **techo absoluto** de bonus acumulado | Un bug de cálculo no puede inflar la cuenta sin límite |
| 5 | **Cooldown**: máximo 1 recarga efectiva por día | Una prueba diaria = una recarga diaria como mucho |
| 6 | **Auditoría** en `admin_events` con `action:'verification_quota_topup'` y el detalle de lo sumado | Queda rastro de cada recarga, quién y cuánto |
| 7 | **Nunca resta ni resetea contadores** — solo sube `*_bonus` y `usage_limit` | No puede usarse para borrar el uso real de nadie |

**Por qué esto no es explotable** (respuesta directa a la pregunta del operador): el
mecanismo **solo escribe diagnóstico y recarga una cuenta fija de prueba**. No existe ninguna
ruta que convierta "reportar un test" en "más usos" para otra cuenta: el endpoint de reporte
no toca `subscriptions`; el de recarga ignora cualquier `user_id` que venga del cliente; y el
CUIT de la cuenta de prueba **no es editable por el usuario** (se le quitó esa capacidad en
junio de 2026 — solo el admin lo cambia).

### F3 — Dashboard: la tarjeta completa · Sonnet · **medio**

Reescribir `diagRenderVerification()` para:

- Iterar `flujos[]` (5 filas en vez de 2 hardcodeadas), con ícono por estado
  (✅ ok · ❌ error · ⏭️ omitido) y el `detalle` de cada uno.
- Mostrar el **origen** (`computer-use` / `app-automática`) y las `notas`.
- Mostrar, por flujo, **"última vez OK: hace N días"**.
- **Bloque de cupo**: los 5 contadores + aviso si no alcanza para una prueba +
  botón **"🔋 Recargar cupo"** (llama a F2, con `showConfirm` y `showToast`, las primitivas
  que el dashboard ya tiene desde el fix de VF-3).
- **Bloque "cómo pedir la verificación" — siempre visible**, en dos tonos:

  ```
  ── Vencido (>7 días o estado error) — destacado en ámbar ──
  ⚠️ Hace más de 7 días que no se verifica contra el PJN real.
     Para correrla, pedile esto a Claude:
     ┌────────────────────────────────────┐
     │ corré la prueba diaria de la app   │  [📋 Copiar]
     └────────────────────────────────────┘
     Requisitos: la app Electron abierta y logueada con la cuenta de
     prueba, y aprobar el acceso de computer-use cuando lo pida.

  ── Al día — discreto, en gris ──
  Para volver a verificar:  «corré la prueba diaria de la app»  [📋 Copiar]
  ```

  El comando es el que el procedimiento de `CLAUDE.md` ya reconoce literalmente.

### F4 — Alerta por email · Sonnet · **bajo**

- Función nueva en `utils/mailer.js` (patrón de `sendAdminNewUserAlert`, que ya escribe a
  `ALERT_EMAIL_TO`).
- Cron diario en `server.js` con `node-cron`, junto a los 11 que ya corren: dispara si el
  último reporte vino en `error`, **o** si pasaron más de 7 días sin ninguno.
- **Con deduplicación**: no reenvía el mismo aviso todos los días mientras el estado no
  cambie. Sin esto, un silencio de 3 semanas produce 21 emails idénticos y el aviso se vuelve
  ruido que se ignora.

### F5 — Documentación + primera corrida real · Sonnet · **bajo**

- Agregar al procedimiento de `CLAUDE.md` el **paso final**: al terminar los 5 flujos,
  postear el resultado al endpoint de F1 (con el token admin, cuyo procedimiento de
  generación ya está documentado).
- Agregar el **paso 0 bis**: llamar a la recarga de cupo de F2 antes de arrancar.
- **Correr una prueba real y reportarla**, para que la tarjeta deje de decir "hace 43 días" y
  quede validado el circuito completo de punta a punta.

---

## 8. Verificación

- **F1/F2**: harness contra **staging** (mismo patrón `pg`+`jwt`+`https` con guard `DB_NAME`
  que los 5 harnesses ya existentes). Casos mínimos: reporte con 5 flujos → se persiste ·
  conversión del registro viejo sin `flujos[]` · `top-up` idempotente (2 llamadas seguidas
  no acumulan) · `top-up` con `user_id` ajeno en el body → **ignorado**, recarga la de
  prueba · cooldown · tope por submódulo · auditoría escrita.
- **F3**: Playwright contra `stub-dashboard.js`, con los 3 estados de la tarjeta (al día /
  vencida / con error) y el botón de recarga en sus 2 caminos.
- **F4**: forzar los 2 disparadores en staging y confirmar que el email sale una sola vez.
- **F5**: la corrida real es la verificación.

**Deploy:** todo es backend + dashboard. **Sin migración de DB, sin release de Electron,
sin tocar `/client/*`.** Staging → prod con el procedimiento estándar.

---

## 9. Lo que este plan NO resuelve

- **"Monitor — Consulta Inicial" sigue sin verificarse.** Es un modo distinto del script
  (guarda la línea base en vez de compararla) y es **el flujo que usa un cliente nuevo en su
  onboarding**. No se ejercita desde el 2026-07-23. Queda afuera por decisión explícita del
  operador. Si algún día se suma: correrlo exige una parte sin línea base, y la vía viable es
  borrarla por SQL (crear una parte nueva cada vez choca con la regla anti-abuso que impide
  borrarla entre las 24 h y los 30 días). En cupo es gratis — está confirmado que la consulta
  inicial no consume `monitor_novedades_usage`.
- **No es automático.** computer-use exige aprobar el acceso a la app en cada corrida, así
  que **no puede programarse desatendido**. Sigue dependiendo de que alguien lo pida en un
  chat — igual que hoy, pero ahora con el resultado quedando registrado y con un aviso por
  email cuando pasa demasiado tiempo.
- **Higiene de métricas, no seguridad:** la cuenta de prueba usa el plan COMBO_PROMO real y
  recibe recargas repetidas, así que en las métricas es indistinguible de un cliente real. El
  día que se quiera medir "uso real de clientes", va a contaminar el número. No se aborda acá.
- `VERIFICATION_TEST_CUIT` **no está en el `.env` de producción** — funciona por el fallback
  hardcodeado `'27320694359'`. Conviene agregarla al `.env` como parte de F2 (2 minutos, sin
  riesgo) para que la cuenta de prueba sea configurable sin tocar código.

---

## 10. Resumen

| Fase | Qué | Modelo | Esfuerzo |
|---|---|---|---|
| **F1** | Modelo `flujos[]` + endpoint de reporte | Sonnet | medio |
| **F2** | Cupo: lectura + recarga segura (7 protecciones) | 🔴 **Opus** | medio |
| **F3** | Tarjeta del dashboard (flujos, cupo, comando) | Sonnet | medio |
| **F4** | Alerta por email (cron + dedup) | Sonnet | bajo |
| **F5** | Documentación + primera corrida real | Sonnet | bajo |

**Total estimado: ~2 sesiones.** Orden obligatorio F1 → F2 → F3 (F3 consume los dos
endpoints anteriores); F4 y F5 pueden ir en cualquier momento después de F1.

**Prompt de arranque sugerido:**
> *Ejecutá la F1 del plan `docs/internal/plan-verificacion-pjn-dashboard-2026-08-26.md`.*
