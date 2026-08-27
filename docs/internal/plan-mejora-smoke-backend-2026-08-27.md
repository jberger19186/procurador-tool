# Plan — Mejora de la verificación automática del backend

> Escrito: 2026-08-27 · **Estado: ✅ LAS 3 FASES EJECUTADAS, VERIFICADAS Y DESPLEGADAS A PRODUCCIÓN (2026-08-27)**
> Origen: pedido del operador — *"revisá el smoke test de backend API con la finalidad de
> establecer un plan de mejora para anticiparse a fallas, o determiná si conviene dejarlo así"*.
>
> **Fase 1** (`health-check.js`, 7 checks, cron 08:00, alerta por email con dedup, cierra H-1)
> · **Fase 2** (`run-api` de 8 checks triviales a 14, incluido el primer camino feliz autenticado
> de todo el smoke) · **Fase 3** (tarjeta "🩺 Salud automática" en Diagnóstico, con alarma de
> "desactualizado"). Commits `94a756d` (F1) · `9bfc26a` (F2) · `b75bcfa` (F3). Detalle completo
> de la ejecución en `CLAUDE.md`, sesión 2026-08-27.
> Todo lo que dice §1 está **medido en vivo** el 2026-08-27, no estimado.

---

## 1. Qué hay hoy — medido, no supuesto

### 1.1 Las capas de verificación que ya existen

| Capa | Qué corre | Contra | Cuándo | ¿Alerta si falla? |
|---|---|---|---|---|
| **CI GitHub Actions** (`smoke.yml`) | `npm audit` ×2 · `run-api` (8 checks) · `smoke-payments.js` (19 checks) | **staging** | cada push/PR a `main` | ⚠️ email de GitHub al autor |
| **Tarjeta "Backend API"** del dashboard | `run-api` — **los mismos 8 checks** | **producción** | manual | ❌ ninguna |
| `canary-test.js` | selectores del login del PJN | PJN (externo) | diario 07:00 (crontab) | ✅ email |
| `backup-db.js` | dump + subida a Spaces | producción | diario 03:00 (crontab) | ✅ email |
| **Verificación funcional PJN** (Etapa 1.5) | los 5 flujos reales | producción | manual (computer-use) | ✅ email (F4) |

**Hallazgo de apalancamiento:** el CI y la tarjeta del dashboard **llaman al mismo endpoint**
(`POST /admin/smoke-tests/run-api`) — el CI contra `:3444` (staging), la tarjeta contra `:3443`
(prod). Cualquier check que se agregue ahí **mejora las dos capas de una sola vez**. Es el punto
de mayor retorno por línea escrita de todo este plan.

**Estado verificado hoy:** el CI **está corriendo y en verde** — los 5 pushes de hoy dieron
`success`. No está abandonado ni roto.

### 1.2 Qué verifica realmente el smoke actual

Los 8 checks de `run-api`:

| # | Check | Tipo |
|---|---|---|
| 1 | `GET /health` → 200 | positivo (trivial) |
| 2 | `POST /auth/login` sin body → 400 | **negativo** |
| 3 | `POST /auth/login` creds inválidas → 401 | **negativo** |
| 4 | `GET /auth/register-status` → 200 | positivo (trivial) |
| 5 | `GET /client/scripts/available` sin token → 401 | **negativo** |
| 6 | `POST /license/execution/start` sin token → 401 | **negativo** |
| 7 | `POST /auth/portal-login` sin body → 400 | **negativo** |
| 8 | `SELECT 1` en PostgreSQL | positivo (trivial) |

**5 de 8 son caminos negativos** y los 3 positivos son triviales. La pregunta que responde el
smoke es: *"¿el servidor está vivo y rechaza lo que debe rechazar?"*. No responde *"¿hace bien
lo que debe hacer?"* — **ningún check verifica contenido, solo el status code**.

### 1.3 La prueba de que eso no alcanza: fallas reales del proyecto que estos 8 checks NO habrían cazado

Todas están documentadas en `CLAUDE.md` como bugs reales, ya corregidos:

| Bug | Consecuencia real | ¿Lo caza el smoke? |
|---|---|---|
| **B1** (🔴 crítico) | `expires_at` no se renovaba con el pago → cliente **pagando al día quedaba bloqueado a los ~30 días** | ❌ los 8 pasan |
| **B2** | plan fuera de `PLAN_LIMITS` abortaba la transacción del webhook → **pago perdido** | ❌ los 8 pasan |
| **H-1** (SEC-2) | `data-retention.js` **nunca se ejecuta** | ❌ los 8 pasan |
| Preapproval huérfano en MP (2026-07-19) | suscripción viva sin cobro | ❌ los 8 pasan |
| `PayloadTooLargeError` (P-F2.2-b) | error 500 en vez de 413 | ❌ los 8 pasan |

Un smoke cuyo valor se mide por lo que caza, y que no habría cazado **ninguna** de las fallas
reales del proyecto, tiene margen de mejora real.

### 1.4 🚨 Los 2 problemas estructurales — más importantes que la falta de checks

**(a) La tarjeta del dashboard no se corre.** La captura del operador muestra
*"Última ejecución: hace 29 días"*. Un chequeo manual que nadie ejecuta vale **cero**, por más
checks que tenga. Agregar cobertura sin resolver esto es trabajo perdido.

**(b) El smoke vive dentro de lo que monitorea.** `run-api` es un endpoint del propio backend:
si el backend está caído, el smoke **no puede correr ni avisar**. Es un punto ciego por diseño —
justamente el escenario que más importa detectar es el único que no puede detectar.

### 1.5 Qué NO vigila nadie hoy, en producción

Medido en vivo el 2026-08-27:

| Área | Estado hoy | ¿Vigilado? |
|---|---|---|
| **Crons in-process** (11 activos) | dejan rastro en `pm2-out.log` (`[CRON] cobranza-retry: ...`) → **verificable** | ❌ nadie mira si corrieron |
| **`data-retention.js`** | 🚨 **sigue sin estar en el crontab** (confirmado hoy: solo hay `backup-db` y `canary-test`) | ❌ hallazgo H-1, abierto |
| **Backups** | ✅ 4 días consecutivos, 03:00 | ⚠️ solo alerta si el script falla, nadie verifica que el archivo exista y pese |
| **Cert SSL** | ✅ válido 60 días | ❌ la fecha en `CLAUDE.md` ya quedó stale antes y alarmó de más |
| **Disco / RAM** | ✅ 15% usado | ❌ nadie |
| **Restarts de PM2** | 760 (deploys manuales) | ❌ nadie distingue un deploy de un crash-loop |
| **Integridad referencial** | verificada a mano en julio | ❌ nadie automáticamente |
| **Camino feliz autenticado** | — | ❌ **nada** verifica que un usuario real pueda hacer algo |

---

## 2. Veredicto: conviene mejorarlo, pero **no** de la forma obvia

**Sí conviene**, con dos precisiones que cambian el diseño:

**No conviene inflar `run-api` con checks de infraestructura.** Ese endpoint lo corre el CI
contra **staging** y hace fallar el build (`curl -f` + `process.exit(1)`). Un check de "el cert
de prod vence en N días" o "el cron de las 11:00 corrió" **rompería el CI en cada push**:
staging no tiene el cert de prod ni le corresponden los mismos crons. Son dos preguntas
distintas y deben vivir separadas:

- **CI → `run-api`**: *"¿este commit rompió algo?"* — determinista, mismo resultado en cualquier
  entorno, debe fallar el build.
- **Producción → chequeo nuevo**: *"¿producción está sana ahora mismo?"* — depende del estado
  del host, no del código.

**El mayor valor no está en más checks, sino en que corra solo y avise.** Por eso la Fase 1 es
la de automatización, no la de cobertura.

---

## 3. Plan por fases

Ordenadas por **valor/costo**, no por comodidad de implementación.

### Fase 1 — Salud de producción, automática y con alerta 🥇

> **Modelo: Sonnet · Esfuerzo: medio · ~1 sesión**
> Cierra el hueco real: hoy **nada vigila nuestro backend en producción de forma automática**
> (el canary vigila el PJN, que es externo).

Script nuevo `backend-server/scripts/health-check.js` + entrada de crontab + alerta por email.
**Reusa el patrón ya construido y probado**: `decideVerificationAlert()` de F4 (deduplicación
por episodio, para no spamear el mismo problema todos los días) y `sendVerificationAlert()` del
mailer.

Checks propuestos, todos de **solo lectura**:

| # | Check | Por qué |
|---|---|---|
| 1 | Los crons del día corrieron (parseo de `pm2-out.log` por `[CRON]`) | un cron caído es invisible hoy |
| 2 | El backup de anoche existe y pesa > umbral | hoy solo se avisa si el script falla, no si produjo un archivo vacío |
| 3 | Cert SSL: días restantes < 20 → alerta | evita el dato stale de `CLAUDE.md` |
| 4 | Disco > 80% / RAM libre < umbral | prevención básica |
| 5 | Restarts de PM2 desde el último chequeo (distinguir deploy de crash-loop) | 760 restarts hoy, nadie sabe cuáles fueron crashes |
| 6 | Integridad: 0 huérfanos en las 4 relaciones críticas | se verificó a mano una sola vez, en julio |
| 7 | `pm2-error.log` sin entradas nuevas desde el último chequeo | ya se revisa a mano en cada deploy |

🚨 **Requisito de diseño, no negociable:** el script **corre fuera del proceso del backend**
(crontab, como el canary) — así puede alertar aunque el backend esté caído, que es exactamente
el punto ciego de §1.4(b).

**De paso, cierra H-1:** agregar `data-retention.js` al crontab (el hallazgo abierto de SEC-2,
confirmado hoy que sigue sin correr). Es una línea, y este es el momento natural de hacerlo.

---

### Fase 2 — Enriquecer `run-api` con checks de valor real 🥈

> **Modelo: Sonnet · Esfuerzo: medio · ~1 sesión**
> Mejora **las dos capas a la vez** (CI y tarjeta), por el hallazgo de apalancamiento de §1.1.

Checks nuevos, todos deterministas y válidos **en staging y en prod** (para no romper el CI):

| # | Check | Qué caza que hoy se escapa |
|---|---|---|
| 1 | **Camino feliz autenticado**: firmar un token server-side y verificar que `GET /client/account` devuelve la forma esperada (no solo 200) | hoy **nada** verifica el comportamiento con sesión |
| 2 | Contenido de `/health` (no solo el 200) | un `/health` que responde 200 con el cuerpo roto pasa igual |
| 3 | Headers de seguridad presentes (Helmet/CSP activo) | B-5 se implementó y nadie verifica que siga activo |
| 4 | Rate limiter responde con `RateLimit-*` en los routers con límite | RI-3 se implementó y nadie verifica que siga activo |
| 5 | Las tablas críticas existen y responden (patrón de `smoke-payments.js`, extendido a Bitácora/Monitor) | una migración a medio aplicar pasa desapercibida |
| 6 | Integridad referencial (mismo check que Fase 1, acá contra el entorno del CI) | caza el bug **antes** del merge |

⚠️ **Restricción de diseño:** los checks deben ser **de solo lectura** — este endpoint se ejecuta
contra **producción** desde la tarjeta. Nada de crear/borrar fixtures. Si un check necesita
escribir, va a la Fase 1 (que corre solo en prod, controlada) o no va.

---

### Fase 3 — Cerrar el bucle de la tarjeta 🥉

> **Modelo: Sonnet · Esfuerzo: bajo · ~0,5 sesión**

Con la Fase 1 corriendo, la tarjeta "Backend API" del dashboard pasa de ser el único registro
(manual, hace 29 días) a ser una **vista** de algo que ya se ejecuta solo. Cambios chicos:

- Mostrar el resultado del `health-check.js` de la Fase 1 en Diagnóstico (misma mecánica que la
  tarjeta de verificación funcional que se acaba de construir).
- Señal de "desactualizado" en la tarjeta cuando la última corrida tiene más de N días — hoy
  dice *"hace 29 días"* en gris, sin ninguna alarma visual.

---

## 4. Resumen para decidir

| Fase | Qué resuelve | Modelo | Esfuerzo | Sesiones |
|---|---|---|---|---|
| **1** | Nada vigila prod automáticamente + cierra H-1 | Sonnet | medio | ~1 |
| **2** | El smoke no caza fallas reales (mejora CI + tarjeta) | Sonnet | medio | ~1 |
| **3** | La tarjeta no se mira / no avisa | Sonnet | bajo | ~0,5 |

**Total: ~2,5 sesiones, todo Sonnet.**

**Por qué ninguna fase lleva Opus:** la regla del proyecto reserva Opus para lo que toca cobro
real o lógica de negocio facturada. Estas 3 fases son verificación de **solo lectura** — no
tocan `subscriptions`, ni MercadoPago, ni otorgan cupo. Marcarlas Opus sería gasto sin
contrapartida.

**Si hay que hacer una sola: la Fase 1.** Es la única que cambia la situación de fondo — que hoy
nadie se entera si producción se degrada hasta que alguien lo nota a mano.

---

## 5. Qué NO cubre este plan (explícito, para no confundir "ejecutado" con "backend monitoreado")

- **No es observabilidad/APM.** No hay métricas de latencia por endpoint, ni trazas, ni
  histórico. Para eso haría falta una herramienta dedicada, y es una decisión aparte.
- **No cubre el PJN externo** — eso ya lo hace `canary-test.js` y la verificación funcional de
  la Etapa 1.5.
- **No reemplaza a SEC-2** (auditoría de seguridad, Etapa 3 del roadmap): esto verifica que el
  sistema *funcione*, no que *resista a un atacante*.
- **No cubre la app Electron ni la extensión** — otras superficies, otros planes.
- **No hace pruebas de carga.** Sigue siendo el hueco documentado de cara a B3.
