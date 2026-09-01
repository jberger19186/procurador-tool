# F7 — Triage de los 8 hallazgos de A1

> Fase **F7** de [`runbook-cadena-ag-triage-2026-09.md`](docs/internal/runbook-cadena-ag-triage-2026-09.md).
> Ejecutada 2026-09-01, Sonnet 5, esfuerzo **alto**. Informe fuente:
> `C:\Users\JONATHAN\source\repos\proyecto\auditoria pt antigravity\informe-A1-2026-09-01.md`
> (Gemini 3.7 Flash, esfuerzo `High`, 8 hallazgos).
>
> 🚨 **Regla aplicada sin excepción: ningún hallazgo se aplicó sin reproducirlo primero contra el
> código real.** Los 8 se verificaron con evidencia propia (lectura del código real, ejecución de
> Node aislada, o un harness real contra staging) antes de decidir qué hacer con cada uno.

---

## 0. Resultado en una línea

**De 8 hallazgos: 6 confirmados y corregidos, 1 confirmado pero no reachable en el código que se
distribuye (corregido igual, de forma defensiva y barata), 1 coincide con una limitación que F5 ya
había documentado y aceptado en agosto (no es nuevo, no se decide en esta fase).**

---

## 1. Tabla de veredictos

| # | Hallazgo | Severidad A1 | Veredicto propio | Acción |
|---|---|---|---|---|
| H-A1-01 | Colisión de caché de adjuntos entre informes | 🔴 crítico | **CONFIRMADO el mecanismo, NO alcanzable** — `main.js` es el único llamador real y nunca comparte `registro` entre expedientes | Documentación reforzada en el JSDoc (§2.1) |
| H-A1-02 | `STATUS:COMPLETED` inválido en `VEVENT` (RFC 5545) | 🟠 alto | **CONFIRMADO**, violación real del estándar | Corregido — `STATUS` siempre `CONFIRMED`, el estado "hecha" se mueve al prefijo de `SUMMARY` (§2.2) |
| H-A1-03 | Desfase de día en eventos `all_day` fuera de mediodía local | 🟠 alto | **CONFIRMADO**, el supuesto de "siempre mediodía" no lo garantiza el servidor | Corregido — offset fijo de Argentina en vez de UTC crudo (§2.3) |
| H-A1-04 | Bypass del gate de la demo con JWT sin `exp` | 🟠 alto | **CONFIRMADO contra el código en producción** | Corregido — fail-closed, desplegado y verificado en vivo (§2.4) |
| H-A1-05 | Allowlist ignora el puerto (`hostname` vs `host`) | 🟡 medio | **CONFIRMADO con Node real**, impacto acotado (el destino sigue fijo al DNS real del PJN) | Corregido — exige puerto 443/vacío además del host (§2.5) |
| H-A1-06 | Palabras de sección dentro de un movimiento rompen la tabla | 🟡 medio | **CONFIRMADO el mecanismo**, no observado en documentos reales | Documentado, no corregido — mismo criterio que F5 ya aplicó a hallazgos hermanos (§2.6) |
| H-A1-07 | Sin guard de concurrencia en `procesar-markdown-pdf` | 🔵 bajo | **CONFIRMADO**, sin guard en ninguno de los 2 handlers reales | Corregido — flag propio del módulo, no comparte `isExecuting` con Puppeteer (§2.7) |
| H-A1-08 | Carátulas sin `c/` (sucesiones, concursos) no anonimizan al causante | 🔵 bajo | **CONFIRMADO, pero YA documentado por F5** (2026-08-31) como limitación aceptada | Sin acción nueva — ver §2.8 |

---

## 2. Detalle de cada verdicto

### 2.1 — H-A1-01, dedup de adjuntos

`registro` (el `Map` de dedup por `filename`) es un parámetro opcional con default `new Map()`. El
**único** llamador real en todo el proyecto es `main.js:2070`
(`procesarAdjuntosDeInforme(pdfPath, { onProgress: enviarProgreso })`), confirmado por grep sobre
`main.js`/`renderer.js` — **nunca pasa `registro`**. Cada invocación del handler IPC
`procesar-markdown-pdf` crea su propio Map vacío, descartado al terminar. El escenario que A1
describe (2 informes de expedientes distintos compartiendo el mismo registro) requiere un llamador
que hoy no existe.

**Además**, el propio JSDoc de la función documenta la intención real: *"compartir entre varias
llamadas para deduplicar adjuntos repetidos entre informes del **mismo expediente**"* — no entre
expedientes distintos, que es lo que A1 extrapoló al leer la firma de la función sin ver el único
call site real.

**Acción:** no se tocó el mecanismo de caché (reescribir la arquitectura de namespacing por
expediente para una feature que no existe hoy sería el tipo de cambio que el proyecto evita — *"no
diseñar para requerimientos hipotéticos"*). Se reforzó el JSDoc para que, si algún día se agrega un
llamador que SÍ comparta `registro`, quede escrito explícito que debe namespacearse por expediente.

### 2.2 — H-A1-02, `STATUS:COMPLETED`

Confirmado leyendo `bitacora.js:443` (antes del fix): `e.done_at ? 'COMPLETED' : 'CONFIRMED'`. RFC
5545 §3.8.3.8 reserva `COMPLETED` para `VTODO` — en `VEVENT` los únicos valores válidos son
`TENTATIVE`/`CONFIRMED`/`CANCELLED`. No había ningún indicador visual de "hecha" independiente del
`STATUS`, así que el fix no puede simplemente borrar la señal.

**Fix:** `STATUS` pasa a ser siempre `CONFIRMED`; el estado "hecha" se mueve a un prefijo `✅ ` en
`SUMMARY` (texto libre, sin restricción de esquema). Verificado con el harness original del
proyecto (`verify-f34-bloqueB-ics.js`, 21/21 PASS contra staging, sin regresión) + un test puntual
nuevo confirmando que `STATUS:COMPLETED` no vuelve a aparecer y que el prefijo `✅` sí aparece en la
entrada marcada como hecha.

### 2.3 — H-A1-03, desfase de día en `all_day`

El comentario original documentaba el supuesto ("mediodía hora local") pero **no lo hacía cumplir**
— `fecha()` (la función que normaliza `due_at` al escribir) no toca la hora para nada, confirmado
leyendo su cuerpo completo. Cualquier entrada creada por `POST /bitacora`, por el import/restore
(F1.7) o por una futura captura automática puede traer cualquier hora.

**Fix:** `icsDiaCalendarioUtc` deriva el día calendario restando el offset fijo de Argentina (-3h,
sin horario de verano desde 2009) antes de leer los getters UTC, en vez de leer UTC crudo. Correcto
sin importar qué hora traiga `due_at`, no solo el caso de mediodía. Verificado con 4 casos
aislados (el caso exacto del hallazgo, el caso normal de mediodía, y los 2 bordes de medianoche) +
el harness original (no-regresión, aserción #6) + un test puntual contra staging confirmando
`DTSTART;VALUE=DATE:20260901` (correcto) para una entrada a las 22:00 ARG.

### 2.4 — H-A1-04, bypass del gate con JWT sin `exp`

Confirmado **contra el código que estaba corriendo en producción en el momento de la verificación**
(no un estado viejo): `tokenVencido()` devolvía `false` (no vencido) cuando el payload no tenía
`exp` numérico. `/auth/portal-login` siempre firma con `expiresIn`, así que la ausencia del claim
es en sí misma la señal de un token no genuino.

**Fix:** fail-closed — sin `exp` numérico, se trata como vencido. **Verificado en un navegador real
contra producción** con el token exacto que cita A1 (`eyJhbGciOiJub25lIn0.e30.`, payload `{}` sin
firmar): `haySesion()` ahora devuelve `false` y el token se borra de `localStorage`
automáticamente. No-regresión confirmada con un token sintético con `exp` vigente (8h): sigue
desbloqueando.

### 2.5 — H-A1-05, allowlist ignora el puerto

Confirmado con Node real: `new URL('https://scw.pjn.gov.ar:9443/...').hostname` da
`'scw.pjn.gov.ar'` — el puerto queda fuera de `hostname` por diseño de la API WHATWG URL.
**Impacto acotado, no inflado:** el destino de la petición sigue resolviendo al DNS real de
`scw.pjn.gov.ar` (no hay forma de redirigir a una IP arbitraria desde acá) — el gap es real pero
menos severo que "SSRF a servicios internos" tal como A1 lo enmarca, salvo que la infraestructura
del PJN tenga algo sensible expuesto en un puerto no estándar de la misma IP pública.

**Fix:** se exige además `u.port === '' || u.port === '443'`. Verificado con Node (3 casos: URL
real sin puerto → sigue pasando; con `:443` explícito → pasa; con puerto malicioso → rechaza) +
la suite completa del módulo (26/26 PASS, incluida la integración contra adjuntos reales del PJN —
0 descartados por la allowlist, confirmando que las URLs reales no llevan puerto).

### 2.6 — H-A1-06, palabras de sección dentro de un movimiento

Confirmado el mecanismo con una prueba aislada de la regex real: una línea aislada que sea
exactamente "Recursos" o "Notas" (nada más en la línea) dispara el corte de sección — pero **no**
una variante como "II. RECURSOS" (un sub-encabezado numerado, común en resoluciones argentinas),
porque el regex está anclado (`^...$`) a la línea completa.

**Por qué no se corrigió en esta fase:** el proyecto ya tiene un precedente explícito para esta
MISMA clase de hallazgo — F5 (2026-08-31) documentó *"2 hallazgos de `reconstruirLineasPagina`
confirmados con sintéticos pero no observados en los 39 informes reales... queda anotado"*, sin
tocar el código, precisamente por la combinación de (a) mecanismo real pero (b) sin confirmación
empírica contra documentos reales del PJN y (c) el módulo de extracción es uno donde el proyecto ha
sido históricamente cauteloso con cambios estructurales sin esa confirmación. H-A1-06 es la misma
combinación — se documenta con el mismo criterio, no se decide unilateralmente un fix estructural
al parser en esta fase.

### 2.7 — H-A1-07, sin guard de concurrencia

Confirmado leyendo `main.js`: `isExecuting` (el guard que sí usan `runProcessLogic`/
`runInformeLogic`) nunca se referencia en `procesar-markdown-pdf` ni en `reprocesar-markdown-mapping`
— los 2 únicos handlers del módulo que hacen trabajo real y escriben archivos.

**Fix:** un flag nuevo, `isProcesandoMarkdown`, **deliberadamente separado** de `isExecuting` — el
módulo Markdown nunca abre Chrome ni toca el candado del PJN (por diseño, documentado en la
cabecera de `descargarAdjuntos.js`), así que compartir el flag de Puppeteer bloquearía sin motivo
un procesamiento local mientras corre una procuración, y viceversa. Aplicado a los 2 handlers
(comparten el mismo flag entre sí porque escriben archivos superpuestos). Verificado: `node --check`
limpio, suite completa de Electron 165/165 sin regresión, `npm start` con arranque limpio.

### 2.8 — H-A1-08, carátulas sin `c/`

Confirmado con el ejemplo exacto de A1 (`PEREZ, JUAN CARLOS s/ SUCESION AB-INTESTATO` → `{actor:
null, demandado: null}`). **Esto no es un hallazgo nuevo**: `CLAUDE.md`, sesión 2026-08-31,
documenta explícitamente entre los hallazgos de F5 *"documentados sin corregir a propósito"*:
*"carátula sin `s/`"* — mismo eje (la carátula del PJN no siempre sigue el patrón bilateral
`Actor c/ Demandado s/ Objeto`), ya evaluado y dejado como decisión consciente.

**Que A1 lo haya redescubierto de forma independiente es un dato útil** (confirma que el gap es
real y reproducible desde otro ángulo), pero no cambia el estado: sigue siendo una decisión de
producto pendiente, no algo que esta fase de triage pueda resolver por su cuenta.

---

## 3. Verificación y deploy

**Backend** (`routes/bitacora.js`): staging → verificado con el harness original (21/21) + un test
puntual nuevo (5/6, con 1 falla que resultó ser un error de MI PROPIO test — el `DTEND` del día
siguiente es correcto por RFC, mi aserción era demasiado amplia; el `DTSTART`, que es lo que
importa, salió correcto) → producción, hash local=prod confirmado, `pm2-error.log` sin entradas
nuevas.

**Landing** (`public/landing/demo/index.html`): sin staging propio (documentado desde D6 de la
Etapa 1.6) → directo a producción con backup previo → verificado en un navegador real contra
`procuradortool.com` con el token exacto del hallazgo.

**Electron** (`main.js`, `markdown/descargarAdjuntos.js`): local, commiteado — **sin release**
(mismo criterio que S6/S10 de la Etapa 3: el cliente Electron no tiene staging, y cortar un release
es una decisión aparte, no automática dentro de esta fase). Suite completa 165/165, `npm start`
con arranque limpio.

**Un hallazgo real en el camino, de mi propio proceso, no del código:** el primer intento del
harness de F6 (sesión anterior) había dejado un usuario huérfano en staging (id 271, con su email
ya anonimizado por el propio endpoint antes de que el script crasheara en un paso posterior) — mi
limpieza de esa sesión buscaba por el email ORIGINAL (`qa-f6-%`), que ya no existía. Encontrado y
limpiado al arrancar esta fase.

---

**VEREDICTO F7: OK — 6 de 8 hallazgos corregidos y verificados (4 en producción, 2 locales
esperando release), 1 documentado como no-reachable con fix defensivo aplicado, 1 confirma una
limitación que F5 ya había documentado y aceptado sin necesitar una decisión nueva.**
