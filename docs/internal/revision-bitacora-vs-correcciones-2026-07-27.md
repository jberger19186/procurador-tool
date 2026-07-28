# Bitácora vs. correcciones E1-E6 — análisis de impacto + revisión rápida de readiness

> **Dos preguntas del operador, respondidas acá:**
> 1. ¿Las correcciones de `plan-correcciones-E1-E6-2026-07-27.md` alteran el plan de Bitácora?
>    **Sí, en 2 puntos — ambos ya adecuados en la propuesta.**
> 2. ¿El plan de Bitácora está correcto para implementar? **Sí, con 2 prerrequisitos y 3
>    decisiones abiertas que ya estaban en el propio documento.**
>
> **Método:** lectura de las secciones de la propuesta que cruzan con los hallazgos (§4.1 transporte,
> §4.2 visores, §7 modelo de datos + endpoints, §9.1 componentes, §11/§11.1 fases y esfuerzo),
> cruzada contra los 6 informes de revisión. Verificación en el código real de las referencias que
> el propio documento marcaba como "confirmar al implementar".

---

## 1. Veredicto

**El plan de Bitácora sigue siendo válido.** No hay ningún hallazgo de E1-E6 que invalide su diseño,
su modelo de datos, su plan de fases ni su estimación de esfuerzo. Los cruces encontrados son **2**,
y los dos se resuelven con **secuencia** (hacer el fix antes), no con rediseño.

**Lo importante:** uno de los dos cruces no es "un ajuste de coordinación" sino un riesgo real —
sin él, la Fase 2 de Bitácora **habría ampliado** el hallazgo XSS que el Bloque D corrige, en un
contexto más peligroso que el original.

---

## 2. Los cruces encontrados

### 🔴 Cruce 1 (real, requería adecuación) — E4-1 XSS ↔ Bitácora F2.1/F2.3

**Qué pasa.** El fix **E4-1** (Bloque D) escapa los 5 campos de texto libre del PJN que
`visorModal_template.html` hoy inyecta sin sanear. La **Fase 2 de Bitácora modifica ese mismo
archivo** para agregar la botonera de captura — y el formulario POST de §4.1 inyecta datos del PJN
**dentro de atributos HTML**:

```html
<input name="car">   <!-- carátula: texto libre del PJN -->
<input name="movs">  <!-- JSON completo de movimientos -->
```

**Por qué es más grave que el hallazgo original, no solo "lo mismo otra vez":** el hallazgo E4-1 es
en *contenido* (`<td>${caratula}</td>`); esto es en *atributo* (`value="${caratula}"`). En atributo
alcanza con **una comilla** para romper el HTML — y una carátula perfectamente legítima como
`RUIZ c/ "LA CAJA" S.A. s/ DAÑOS` ya la tiene. O sea: además del riesgo de inyección, habría roto
la captura con datos reales y comunes, no solo con datos maliciosos.

Además, el helper que E4-1 introduce **no alcanza por sí solo**: `esc()` (la función que
`generarVisorMonitoreo` ya usa en producción, `main.js:2286`) escapa `&`, `<`, `>` pero **no
comillas** — correcta para contenido, insuficiente para un `value=""`. Hace falta la variante que
también escapa `"` y `'`, equivalente al `escAttr()` que el dashboard admin ya tiene
(`dashboard.js:2037`, del fix XSS-1).

**✅ Adecuación aplicada** — recuadro rojo nuevo en **§4.1** de la propuesta, con: el prerrequisito
(Bloque D primero), la distinción `esc()` para contenido vs `escAttr()` para atributos, y la lista
de los 6 campos que deben escaparse. Y en **§11 / F2.1**, el prerrequisito marcado en la fase.

---

### 🟠 Cruce 2 (real, requería adecuación) — E5-2 drift de schema ↔ Bitácora F1.1

**Qué pasa.** La Bitácora crea 4 tablas + 3 columnas (F1.1). La revisión de cohesión del 2026-07-25
ya había verificado que **no colisionan con las 27 tablas de producción** — esa verificación se hizo
contra la base real y **sigue siendo válida**. El problema es otro: la revisión **E5** descubrió que
`database/schema.sql` (el archivo versionado que un implementador consultaría naturalmente) tiene
~2 meses de drift — 21 de las 27 tablas, sin `payments`/`invoices`/`commercial_benefits`, y con una
constraint que en producción ya no existe.

**Riesgo concreto:** quien escriba la migración de F1.1 mirando el archivo versionado estaría
validando contra una foto vieja. No es que la migración vaya a fallar (es additiva), pero sí puede
llevar a conclusiones equivocadas sobre el estado real de la base.

**✅ Adecuación aplicada** — nota (b) en **§7** + prerrequisito en **§11 / F1.1**: correr el Bloque
B.1 (regenerar el snapshot, minutos) antes de escribir la migración.

---

### 🟡 Mejora incorporada (no era un cruce, es una lección aplicable) — E3-4 índices

La revisión E3 encontró que `subscriptions` no tiene índices sobre las 4 columnas de fecha que 6
crons diarios consultan. El modelo de datos de Bitácora **repetía el mismo patrón**: define la
constraint `UNIQUE` de deduplicación pero **ningún índice** para las consultas reales — y el banner
de avisos + la vista mes del calendario filtran exactamente por `user_id` + rango de `due_at`.

Con 3 usuarios no se nota; con uso real (el escenario "usuario intensivo, 300 casos, 1.000
entradas/año" que la propia §10 dimensiona) sí. **Crear los índices junto con las tablas cuesta
cero; agregarlos después es otra migración.**

**✅ Adecuación aplicada** — nota (a) en **§7** con los 5 índices concretos, incorporados a F1.1.
Uno de ellos (`idx_snapshots_exp_kind`) además sostiene el `DELETE … ORDER BY created_at DESC` del
recorte atómico 2+2 del hallazgo H4.

---

### 🟢 Verificado sin conflicto (los revisé y no requieren cambios)

| Bloque de correcciones | ¿Cruza con Bitácora? | Conclusión |
|---|---|---|
| **Bloque C** (motor Puppeteer, 13 hallazgos de E1) | No | La propuesta **explícitamente no toca los scripts encriptados** (H1 movió ese trabajo a un post-procesado en `main.js`). El Bloque C sí los toca, pero en la lógica de errores/aislamiento, no en la generación del visor ni en el placeholder `datosEmbebidos` que F2.1 necesita. |
| **Bloque A.1** (whitelist de scripts, P-1) | No | Filtra **scripts descargables**, no endpoints. `GET /client/bitacora/seguidos` es un endpoint nuevo, no se ve afectado. |
| **Bloque A.2** (try/catch en los 7 crons, E3-1) | No | Bitácora **no agrega ningún cron**: los avisos se calculan on-demand vía `GET /usuarios/api/bitacora/avisos`. Confirmado en §7. |
| **E2-8** (JWT del Monitor por env var) | No, pero es coherente | Bitácora §4.1 ya decide **no** embeber tokens en el HTML del visor — la misma filosofía que motiva E2-8. Los deep-links SSO de F2.6 usan el hash `#sso=`, mecanismo distinto y ya probado en producción. |
| **Bloque D** (resto: código muerto, path traversal, etc.) | No | Zonas de `main.js` que F2.1 no toca. |

**⚠️ Única nota de coordinación (menor):** el Bloque A edita `server.js` (los loops de los crons) y
F2.2 también lo edita (el parser de 5 MB antes del router). Son zonas distintas del archivo, pero
conviene no ejecutarlos en paralelo — conflicto de merge trivial pero evitable.

---

## 3. Revisión rápida de readiness del plan de Bitácora

Más allá de los cruces, ¿el plan está listo para implementar? Verifiqué lo siguiente:

### ✅ Lo que está sólido

- **Las referencias técnicas siguen vigentes.** El documento advertía "verificar el número de línea
  al implementar, no asumir 84/87" para los parsers de Express. **Verificado hoy: `server.js:110`
  (`express.json`) y `113` (`express.urlencoded`) — los números del documento son correctos.**
- **Ningún cambio de código desde la revisión de cohesión.** `git log --since=2026-07-25` sobre
  `*.js`/`*.html`/`*.sql` → **vacío**. Todos los supuestos verificados el 25/07 (Nginx en 20M,
  `visorModal_template.html` como `extraResources`, `pending_goto` en el portal, el patrón
  `targets:[]` del tour, las 27 tablas) **siguen siendo ciertos**.
- **El tour existe y funciona** — F2.7 asume que el paso 2 (`target: '.tab-nav'`) está ahí para
  extenderlo. La revisión **E4-4** lo verificó independientemente: los 18 selectores de los 14 pasos
  existen hoy, el tour **no** está roto. F2.7 puede darse por viable sin re-verificar.
- **Las 17 correcciones de la revisión de cohesión (v6.1) están aplicadas** al documento y siguen
  siendo coherentes con el código actual.
- **El diseño de riesgo es correcto:** flag `bitacora_enabled=false` por defecto (interruptor de
  apagado sin deploy), migraciones additivas, Fase 1 sin release de Electron.

### ⚠️ Lo que sigue abierto (ya estaba en el documento, no es nuevo)

Estas **no** son objeciones al plan — son decisiones que el propio documento deja explícitas y que
hay que responder antes o durante la implementación:

1. **§13 — las 12 preguntas abiertas (Q1-Q12)** con sus defaults propuestos. La que más condiciona
   el esfuerzo es **Q11** (mantenimiento de feriados), que ya generó F1.8.
2. **§8 / hallazgo H5 — el carve-out de exportación.** El documento plantea correctamente la
   contradicción (gate duro vs. ventana de 90 días post-pérdida del plan) y **exige elegir una**.
   Sigue sin elegirse. Requiere además una columna nueva (`users.bitacora_lost_access_at`) si se
   opta por la ventana — o sea que **afecta a F1.1**, la primera tarea.
3. **La propuesta sigue sin aprobar.** Es una propuesta, no un compromiso.

### 📌 Observación de producto (del propio documento, vale repetirla)

§11 / hallazgo C6: **la Fase 1 sola no tiene el diferencial de la propuesta.** Sin la Fase 2, es una
agenda manual sin ventaja sobre papel o Google Calendar — el valor está en que "el dato nace de la
automatización que ya corre". El documento es explícito en **no anunciar ni vender la feature al
cerrar la Fase 1**, y usarla solo para validación interna con el flag encendido en un plan de
prueba. Vale tenerlo presente al planificar: **~9-14 sesiones de Fase 1 antes de tener algo
mostrable al cliente.**

---

## 4. Secuencia recomendada

Integrando ambos planes, el orden que minimiza retrabajo:

```
1. Bloque B.1  (regenerar schema.sql)          ← minutos · desbloquea F1.1
2. Bloque A    (backend: P-1, crons, escapes)  ← cierra P-1
3. Bloque E    (extensión, en paralelo desde el día 1)
4. Bloque C    (motor Puppeteer)               ← mayor valor · requiere operador
5. Bloque D    (release Electron, incluye E4-1) ← desbloquea F2.1
   ─────────────────────────────────────────────
6. Bitácora Fase 1 (F1.1 … F1.8)               ← ~9-14 sesiones
7. Bitácora Fase 2 (F2.1 … F2.7)               ← requiere el paso 5 hecho
```

**El punto clave de la secuencia:** el **Bloque D antes de la Fase 2 de Bitácora**. No es una
preferencia de orden — si se hace al revés, la Fase 2 introduce los `value=""` sin escapar y después
hay que volver sobre el mismo archivo a corregir lo que se acaba de escribir.

**Se pueden solapar:** los bloques de correcciones (1-5) y la Fase 1 de Bitácora (6) son
independientes salvo por B.1→F1.1. Si hay ganas de arrancar Bitácora ya, **B.1 + F1.1 se pueden
hacer primero** y el resto de las correcciones seguir en paralelo — el único cruce duro que queda es
D→F2.1, y F2.1 está a ~9-14 sesiones de distancia.
