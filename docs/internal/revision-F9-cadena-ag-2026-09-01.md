# F9 — Triage de A2 + cierre del carril AG

> Fase **F9** de [`runbook-cadena-ag-triage-2026-09.md`](docs/internal/runbook-cadena-ag-triage-2026-09.md).
> Ejecutada 2026-09-01, Sonnet 5, esfuerzo **alto**. Informe fuente:
> `C:\Users\JONATHAN\source\repos\proyecto\auditoria pt antigravity\informe-A2-2026-09-01.md`
> (Gemini 3.7 Flash, esfuerzo `High`, 2 hallazgos).

---

## 0. Resultado en una línea

**Los 2 hallazgos de A2 se verificaron: ninguno requiere una decisión ni un fix nuevo.** Los dos
confirman riesgos que la Etapa 3 ya había encontrado y ya había resuelto (uno con un fix, el otro
con una decisión de producto explícita). El auto-comparativo del propio informe (§3) clasificó uno
de los dos como *"nuevo"* — se reclasifica acá, con evidencia, a *"coincide"*.

---

## 1. Tabla de veredictos

| # | Hallazgo | Severidad A2 | Clasificación de A2 (§3) | Veredicto propio | Acción |
|---|---|---|---|---|---|
| H-A2-01 | DoS distribuido por desalojo FIFO en `captureDrafts.js` (4 IPs alcanzan) | 🟠 alto | 🆕 "nuevo" | **RECLASIFICADO a 🔁 coincide** — S1 ya lo encontró, con evidencia más fuerte | Ninguna — ya es una decisión de producto tomada por S1 |
| H-A2-02 | JWT de sesión persistido en el origen público de la demo | 🟡 medio | 🔁 "coincide" | **Confirmado coincide**, tal como el propio informe ya dice | Ninguna — la decisión (opción B) ya se tomó en la PARADA 1 y sigue vigente |

**Además, 2 confirmaciones positivas sin hallazgo** (§3 del informe de A2, sin ID propio): la
superficie de `bitacora.js` modo `reemplazar` se revisó de nuevo y se confirmó sólida (coincide con
S2); los 4 sinks XSS conocidos de `demo/index.html` se re-evaluaron y no se encontró un 5º
(coincide con S11 y con la verificación de F7).

---

## 2. Por qué H-A2-01 se reclasifica

**El propio informe de A2 dice, en "Cómo lo reproduzco":** *"Simular la creación..."*, *"Simular el
envío de 30 requests..."* — es una caminata analítica sobre el código, **no una ejecución real**.

**S1 (Etapa 3, `revision-S1-S2-2026-09-01.md` §2.2) ya lo había hecho, y con más rigor:**
101 POSTs **reales** contra staging, ~20 minutos de corrida real, confirmado por `GET
/capture-draft/:id` devolviendo 404 para el draft desalojado. Y **el propio texto de S1 ya
anticipaba exactamente el escenario que A2 presenta como descubrimiento**, textual: *"Con varias
IPs (o un actor distribuido), el costo baja a segundos."*

La matemática coincide exacta entre los dos informes: `MAX_DRAFTS=100`, `captureLimiter` en
30 req/5min — confirmado leyendo `captureDrafts.js:31` y `rateLimiter.js:190-192` en el código
real, no en la copia sanitizada.

**Por qué esto no es un fallo de A2**, sino el resultado esperado de haber seguido bien el prompt
revalidado en F1: se le pidió explícitamente apuntar al escenario multi-IP que S1 no había podido
*ejecutar* desde su entorno de un solo origen de red — y eso es justo lo que entregó, con una
demostración analítica del mismo mecanismo. La comparación errónea está en su propio §3 (marcó
"nuevo" en vez de "coincide, con demostración adicional"), no en el hallazgo en sí. **Mismo patrón
ya documentado en el proyecto sobre A0/A3**: las clasificaciones de severidad/novedad de
Antigravity no siempre son precisas — se verifican, no se copian.

**El fondo del hallazgo sigue siendo el mismo que S1 ya dejó como decisión de producto, sin
corregir a propósito:** cambiar la política de desalojo (tope por IP/usuario en vez de global, o
subir el número) es una decisión sobre cuánto volumen real se espera, no un bug con un único fix
correcto. Esa decisión sigue sin tomarse — **no porque esta fase la evada**, sino porque ya estaba
así de S1, y esta fase no encontró nada que cambie el cálculo.

---

## 3. Por qué H-A2-02 no necesita acción nueva

El propio informe ya lo marca "coincide". Verificado: el fix de F7 (fail-closed sobre un JWT sin
`exp`) sigue en la copia auditada — A2 lo vio y no encontró forma de burlarlo. La arquitectura de
fondo (el JWT completo persiste en `localStorage` de un origen sin headers de seguridad) es
exactamente lo que S11 documentó y para lo que el operador ya eligió la **opción B** en la
PARADA 1 — con la condición explícita ya escrita en ese momento: *"alcanza mientras la landing no
incorpore ningún script de terceros; si se agrega uno, la recomendación cambia a A"*. A2 no aportó
ningún dato que cambie esa condición (no encontró un script de terceros nuevo, no encontró un
sink adicional).

---

## 4. El carril AG completo — balance final

| Fase | Modelo/esfuerzo | Resultado |
|---|---|---|
| **A0** (gate) | Gemini 3.1 Pro / High | ✅ Corrida 30/08. Gate pasó — 5 defectos reales en el motor de anonimización, los 5 corregidos |
| **A3** (runtime, opcional) | Gemini 3.7 Flash / Medium | ✅ Corrida 30/08. 1 hallazgo menor + 1 falso positivo descartado midiendo |
| **A1** (code review, Etapa 1) | Gemini 3.7 Flash / High | ✅ Corrida hoy. 8 hallazgos, 6 corregidos (F7) |
| **A2** (security review) | Gemini 3.7 Flash / High | ✅ Corrida hoy. 2 hallazgos, 0 acciones nuevas (ambos ya resueltos por la Etapa 3) |

**Lo que el carril demostró que sirve, con números:** A0 encontró 5 defectos reales sobre un motor
con 0,0% de falsos negativos en su propio corpus — la prueba de que "ya está bien probado" no
predice el resultado de una segunda mirada con otro modelo. A1 replicó exactamente esa lección
sobre una superficie distinta (el módulo Markdown, ya revisado 2 veces por Claude): encontró 2
bugs reales genuinamente nuevos (`STATUS:COMPLETED` inválido en RFC 5545, el desfase de día en
`all_day`) que ninguna de las 2 revisiones previas había visto.

**Lo que el carril demostró que NO aporta más, en este punto:** A2 llegó a una superficie que la
Etapa 3 ya había peinado con harnesses reales y evidencia de ejecución (S1, S2, S11) y no encontró
nada que esas 3 auditorías no hubieran encontrado ya — sus 2 hallazgos coinciden, uno de ellos con
menos rigor que el original. Esto no invalida el carril (A1 el mismo día SÍ aportó valor real), pero
sugiere que **el margen de retorno de correr AG de nuevo sobre la MISMA superficie ya auditada por
Claude, en el estado actual del proyecto, es decreciente** — el valor está en superficies nuevas o
recién escritas (como fue el módulo Markdown para A1), no en re-auditar lo que ya recibió 2-3
pasadas.

---

## 5. Qué queda pendiente — ninguna decisión nueva del operador

A diferencia de F6 (que sí necesitó 4 decisiones), **F9 no tiene ninguna decisión pendiente para
el operador** — los 2 hallazgos de A2 confirman decisiones ya tomadas, no abren ninguna nueva.

---

**VEREDICTO F9: OK — 2 hallazgos de A2 triageados, ninguno requiere acción nueva (0 fixes, 0
decisiones pendientes). Carril AG completo (A0+A1+A2+A3): 4 fases corridas, las 4 con veredicto.**
