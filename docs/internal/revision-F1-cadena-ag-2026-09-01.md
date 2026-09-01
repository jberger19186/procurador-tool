# F1 — Revalidación de A1 y A2 contra las Etapas 2 y 3 ya cerradas

> Fase **F1** de [`runbook-cadena-ag-triage-2026-09.md`](runbook-cadena-ag-triage-2026-09.md).
> Ejecutada 2026-09-01, Sonnet 5, esfuerzo **alto**. Solo lectura — no se tocó código de producto,
> **sí se editaron los 2 prompts** en `instrucciones-implementacion.md` (carpeta externa del carril
> AG, no versionada en este repo).

---

## 0. La pregunta que responde este documento

Los prompts de A1 y A2 se escribieron el **2026-08-28**. Sus 4+3 targets fueron auditados
**después** por las Etapas 2 y 3, que cerraron el 31/08 y el 01/09. **¿Sigue siendo útil correrlos
tal cual, o hay que actualizarlos primero?**

**Método:** barrido exhaustivo de los **16 informes** de las Etapas 2 y 3 (`revision-F1` a
`revision-F10`, `revision-S1-S2` a `revision-S11`) buscando cada archivo/símbolo que los prompts de
A1 y A2 nombran, citando `archivo:línea` real en cada caso — no una impresión de cobertura.

**Resultado en una línea: los 7 targets tienen cobertura real, pero NO uniforme — 2 sub-superficies
quedan genuinamente sin auditar (0 menciones en 16 informes), y varias preguntas de los prompts ya
tienen respuesta escrita.** Recomendación: **correr A1 y A2 igual, con los prompts actualizados** —
no desestimar, no dejar tal cual.

---

## 1. Target por target — A1 (code review)

| # | Target del prompt (28/08) | Quién lo auditó desde entonces | Cobertura real |
|---|---|---|---|
| **1** | `electron-app/markdown/` (3 archivos) | **F5** (20 hallazgos, `revision-F5-2026-08-31.md`) + **S10** (8 hallazgos, `revision-S10-2026-09-01.md`) | 🟢 **Alta.** Motor de anonimización, extracción de PDF y descarga de adjuntos revisados dos veces, por dos campañas distintas |
| **2a** | `bitacora.js` — export multi-id (`?expediente_id=3,7,12`) | **F1** de `/code-review`, `revision-F1-2026-08-31.md:105-113` | 🟢 **Alta y cerrada.** IDOR probado en vivo: lista mixta (id propio + ajeno + inexistente) → devuelve solo el propio; N+1 corregido a `WHERE id=ANY($1) AND user_id=$2` |
| **2b** | `bitacora.js` — generación **.ics** (`icsLine`, líneas **321–465**) | **Ninguno de los 16 informes la menciona** (`grep` de `icsLine\|iCalendar\|VCALENDAR` en los 16 → 0 resultados) | 🔴 **Cero.** Solo tuvo la verificación funcional del propio autor al implementarla (harness 21/21, agosto) — nunca una auditoría adversarial independiente |
| **3** | `landing/demo/index.html` (703 líneas) | **S11** (`revision-S11-2026-09-01.md`, íntegro — mismo archivo, misma cifra de líneas citada) | 🟡 **Alta, pero a esfuerzo Medio.** S11 confirmó 0 sinks XSS alcanzables por input externo (grep exhaustivo de los 4 sinks), y corrigió el ciclo de vida del token — **local, sin desplegar** |
| **4** | 3 handlers IPC de `main.js` (`select-markdown-pdf`, `procesar-markdown-pdf`, `reprocesar-markdown-mapping`) | **F5** (#16, bypass del gate por plan) + **S10** (#3 path traversal cerrado, #4 crash EISDIR) | 🟢 **Alta.** Los 3 handlers tienen al menos un hallazgo real encontrado y corregido cada uno |

**Corrección menor al propio prompt, sin impacto de fondo:** describe los handlers como *"cuyo
nombre empieza con 'markdown' o 'reprocesar-markdown'"* — ninguno empieza literalmente así
(`select-markdown-pdf`, `procesar-markdown-pdf`, `reprocesar-markdown-mapping`). Corregido a la
lista exacta.

---

## 2. Superficie por superficie — A2 (security review)

| # | Superficie del prompt (28/08) | Quién la auditó | Preguntas del prompt YA respondidas | Residual real |
|---|---|---|---|---|
| **1** | `routes/capture.js` + `captureDrafts.js` | **S1** (`revision-S1-S2-2026-09-01.md` §2) | *"¿puede un tercero reclamar el borrador de otro?"* → IDOR confirmado **por diseño**, mitigado por espacio de ids (§2.3). *"¿Qué pasa con el tope bajo volumen?"* → H-2 confirmado con **flood real de 101 POSTs** (§2.2). *"¿La respuesta refleja datos del cliente?"* → open redirect verificado sano (§2.1) | 🟡 **DoS distribuido real (multi-IP)** — S1 lo dice explícito en su §5: *"no se pudo probar desde este entorno de un solo origen de red"* |
| **2** | `bitacora.js` modo `reemplazar` | **S2** (mismo informe, §3) | *"¿se puede disparar por accidente?"* → validación de pertenencia confirmada sana (§3.3). *"¿resiste un archivo a mano?"* → sí, confirmado. *"¿`__proto__`/`constructor`?"* → prototype pollution **no explotable, confirmado en 2 niveles** (§3.5); mass assignment sano (§3.6); CSRF no aplica (§3.4) | 🟡 **Bajo.** Las 4 preguntas literales del prompt tienen respuesta escrita y verificada. Vale como 2ª opinión (mismo patrón que A0), no como descubrimiento |
| **3** | JWT en `localStorage` de `landing/demo/` | **S11** (informe íntegro) | *"¿se borra alguna vez?"* → **corregido localmente** (commit `d29ec36`, NO desplegado). *"¿qué alcance tiene?"* → enumerado exacto: PII, pagos, facturas, suscripción, cupo IA; NO password ni CUIT (§0 punto 4) | 🟠 **Medio-alto, pero distinto al que describe el prompt.** Lo no cubierto no es el código — es la **infraestructura**: 0 headers en el vhost (documentados, no aplicados) y el fix sigue sin desplegar. Un pentester de código puro puede repetir el hallazgo de S11 sin aportar nada, o puede encontrar el 5º sink que S11 no vio (el patrón exacto de A0) |

---

## 3. Por qué la recomendación es CORRER, no desestimar

**El precedente directo es A0.** Auditó un motor con corpus adversarial propio en **0,0% de falsos
negativos** — la medida más alta de confianza que este proyecto produce — y encontró **5 defectos
reales** que ese mismo corpus no cubría. *"Ya está bien auditado"* no predijo el resultado ahí, y no
hay motivo estructural para que prediga distinto acá: A1 y A2 corren con un modelo distinto
(Gemini 3.7 Flash) sobre el mismo código, exactamente la condición que hizo valioso a A0.

**Lo que sí cambia, y es lo que este documento corrige:** sin actualizar los prompts, una parte
sustancial del esfuerzo de AG se habría ido en **re-derivar preguntas que ya tienen respuesta
escrita** (superficie 2 de A2 en particular, con sus 4 preguntas ya cerradas), y el prompt de A2
sobre la superficie 3 describe un **estado que ya cambió** — pegarlo tal cual arriesga que AG
"descubra" un problema (el token no se borra) que el propio proyecto ya corrigió, inflando el
informe con un hallazgo obsoleto en vez de dirigir el esfuerzo a lo genuinamente abierto.

---

## 4. Los cambios aplicados a los prompts

Archivo editado: `C:\Users\JONATHAN\source\repos\proyecto\auditoria pt antigravity\instrucciones-implementacion.md`

### A1 — Paso 3

- Agregado un bloque **"CONTEXTO — qué ya se revisó"** antes de la lista de targets, con la tabla
  de §1 resumida: qué cubrió cada informe, en qué archivo:línea.
- Target 2 dividido explícitamente en **2a (cerrado, no repetir)** y **2b (.ics, líneas 321–465,
  CERO cobertura previa — foco principal de este target)**.
- Corregida la descripción de los 3 handlers IPC (nombres exactos, no el patrón impreciso).
- Instrucción explícita: *"si tu hallazgo coincide con uno de los ya documentados abajo, decilo y
  seguí — no hace falta el mismo detalle que un hallazgo nuevo"*.

### A2 — Paso 4

- Mismo bloque de contexto, con las respuestas ya conocidas de S1/S2/S11 resumidas.
- Superficie 1: agregada la instrucción de intentar **específicamente** el escenario multi-IP que
  S1 no pudo probar (aunque sea simulado/documentado como limitación, igual que hizo S1).
- Superficie 2: recalibrada a **"2ª opinión, no descubrimiento esperado"** — sigue en el target
  list (fresh eyes tienen valor demostrado por A0) pero sin las 4 preguntas ya cerradas.
- Superficie 3: **reescrita para reflejar el estado real** — token no se borra en PRODUCCIÓN
  (el fix vive local, sin desplegar) pero SÍ en el código que audita (la copia sanitizada sale del
  git local); headers del vhost en 0; y la pregunta se redirige a *"¿hay un 5º sink de XSS que S11
  no haya visto?"*, que es el eje donde AG puede aportar algo que la revisión anterior no.

---

## 5. Contrato de salida — verificación

| Afirmación | Evidencia |
|---|---|
| 0 informes mencionan la generación `.ics` | `grep -c "icsLine\|iCalendar\|VCALENDAR" docs/internal/revision-*.md` → 0 en los 16 |
| F5 encontró el bypass del gate en `select-markdown-pdf`/`reprocesar-markdown-mapping` | `revision-F5-2026-08-31.md:150` (#16) |
| S10 cerró el path traversal de `reprocesar-markdown-mapping` | `revision-S10-2026-09-01.md:126-134` (#3) |
| F1 (code-review) cerró el IDOR del export multi-id | `revision-F1-2026-08-31.md:105-113` |
| S1 documenta explícitamente que no pudo probar DoS multi-IP | `revision-S1-S2-2026-09-01.md` §5 |
| S11 corrigió el ciclo de vida del token localmente, sin desplegar | `revision-S11-2026-09-01.md:20` (punto 3 de la tabla §0) |
| El commit del fix de S11 existe en el repo | `git log --oneline -1 -- backend-server/public/landing/demo/index.html` → `d29ec36` |

---

## 6. Lo que este bloque NO hizo

- No corrió A1 ni A2 — eso es F5 y F8 del runbook, con el operador presente.
- No decidió si correr AG o no — la decisión ya estaba tomada (roadmap §7b); esto solo afina el
  *cómo*.
- No tocó código de producto, solo los 2 prompts de la carpeta externa del carril AG.

---

**VEREDICTO F1: OK — 2 prompts revalidados y actualizados. Recomendación: correr A1 y A2 con los
prompts nuevos. La generación `.ics` de Bitácora (líneas 321–465 de `bitacora.js`) queda como la
única superficie con cobertura CERO entre los 7 targets combinados de A1+A2 — prioridad real de la
corrida.**
