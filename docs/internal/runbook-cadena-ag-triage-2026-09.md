# Runbook — Cadena post-Etapa 3: carril AG + triage de las 14 decisiones

> **Creado:** 2026-09-01 · **Estado:** listo para ejecutar
> **Qué ejecuta:** el carril **AG** (auditoría independiente con Antigravity, fases A1 y A2) y el
> **triage de las 14 decisiones de producto** que dejó la Etapa 3.
> **Antecesor:** [`runbook-cadena-etapa3-desatendida.md`](runbook-cadena-etapa3-desatendida.md) —
> mismo patrón de gate entre fases, con **una diferencia estructural: esta cadena NO es desatendida.**
> Tiene 3 paradas obligatorias donde el agente no puede continuar solo.

---

## §0 — Alcance: qué entra y qué NO

### ✅ Entra

| | |
|---|---|
| **Carril AG** | Revalidar A1/A2 → generar la copia sanitizada → correr A1 → correr A2 → triage de los hallazgos |
| **Triage** | Las **14 decisiones** de §3 de [`revision-etapa3-cierre-2026-09-01.md`](revision-etapa3-cierre-2026-09-01.md), en 5 familias |

### ❌ NO entra — **diferido por decisión del operador (2026-09-01)**

**La Etapa 4 (MercadoPago / B3), incluida su primera fase F7 (code-review de cobranza) y el bloque
S8 (fraude con cobro real).** Es el **camino crítico** al lanzamiento, y queda para después de esta
cadena.

> ⚠️ **Consecuencia que se asume, escrita para que nadie la redescubra:** mientras la Etapa 4 no
> corra, **el producto no puede cobrar.** `PAYMENT_MODULE_ENABLED` está en `true` pero las
> credenciales son de sandbox, no hay webhook registrado en el panel de MP, y los `MP_PLAN_*_ID` de
> producción apuntan a la cuenta sandbox. Esta cadena **mejora la calidad del producto, no lo acerca
> a facturar.** Es una decisión legítima —el carril AG cubre el sesgo del auto-auditor, que es un
> hueco real— pero no hay que confundirla con avance del camino crítico.

---

## §1 — Grilla de fases

| Fase | Descripción | Modelo | Esfuerzo | Quién | Tipo |
|---|---|---|---|---|---|
| **F1** | **Revalidar A1 y A2** contra lo que las Etapas 2 y 3 realmente dejaron. Los 4 targets de A1 fueron auditados **después** de que A1 se escribiera | Sonnet 5 | 🔴 **Alto** | Claude | auto |
| **F2** | ⏸️ **PARADA 1 — decisión 3.5**: cómo cerrar el gate de la demo (opción **A** o **B**) | — | — | **Operador** | **PARADA** |
| **F3** | Implementar y desplegar la decisión de F2 | **B** → Sonnet 5 · **A** → 🔴 **Opus** | B → 🟡 Medio · A → 🔴 Alto | Claude | auto |
| **F4** | Generar y **verificar** la copia sanitizada | Sonnet 5 | 🟢 Bajo | Claude | auto |
| **F5** | ⏸️ **PARADA 2 — el operador corre A1** en Antigravity | Gemini 3.7 Flash · `High` | — | **Operador** | **PARADA** |
| **F6** | Triage de las **otras 4 familias** (3.1 a 3.4) + implementación de lo que se decida | 🔴 **Opus** | 🟡 Medio | Claude + operador | semi |
| **F7** | Triage de los hallazgos de **A1** — ninguno se aplica sin reproducirlo | Sonnet 5 | 🔴 **Alto** | Claude | auto |
| **F8** | ⏸️ **PARADA 3 — el operador corre A2** en Antigravity | Gemini 3.7 Flash · `High` | — | **Operador** | **PARADA** |
| **F9** | Triage de **A2** + **informe unificado de cierre del carril AG** | Sonnet 5 | 🔴 **Alto** | Claude | auto |

**Estimación:** ~4–6 sesiones de Claude + 3–5 sesiones de Antigravity (que corren solas).

### 🔀 El paralelismo que hace que esto no sea una fila

**F6 se ejecuta MIENTRAS A1 corre.** El agente no espera a que A1 termine para seguir: en F5 el
operador lanza A1 y avisa *"está corriendo"*, y ahí el agente arranca F6. F7 espera el informe.

**Está verificado que es seguro:** los targets de A1/A2 y los archivos que toca el triage 3.1–3.4
**no se solapan en ningún archivo**.

| A1 / A2 miran | El triage 3.1–3.4 toca |
|---|---|
| `electron-app/markdown/` · `routes/bitacora.js` · `landing/demo/index.html` · handlers IPC de `main.js` · `routes/capture.js` · `utils/captureDrafts.js` | `server.js` (cron 5e) · `public/privacidad/` (texto legal) · `routes/auth.js` (registro) · `middleware/rateLimiter.js` |

🚨 **Regla derivada, no negociable:** durante F6, **no se toca ningún archivo de la columna
izquierda.** Si una decisión del triage lo exigiera, se para y se consulta — cambiar el código que
Antigravity está mirando en ese momento invalida sus hallazgos.

---

## §2 — Las 3 paradas, en detalle

### ⏸️ PARADA 1 (F2) — Decisión 3.5: el gate de la demo

**Por qué es la primera y no una más del triage:** es la **única** de las 14 decisiones que toca una
superficie que A1 y A2 van a auditar — `landing/demo/index.html` es **target #3 de A1** y
**superficie #3 de A2**.

| Opción | Qué implica | Efecto sobre AG |
|---|---|---|
| **B** *(recomendada por el bloque S11)* | Headers de seguridad en el vhost + descartar el token vencido (**ya escrito, sin desplegar**) | 🟢 La superficie no cambia sustancialmente — A2 audita lo mismo |
| **A** | Token propio efímero sin privilegios, que reemplace el JWT de sesión en ese origen | 🟠 **El bloque desaparece como clase de riesgo.** A2 auditaría o algo que ya no existe, o código recién escrito que nadie revisó |

**Recomendación del bloque S11, textual:** *"B alcanza mientras la landing no incorpore ningún script
de terceros (hoy no tiene ninguno); si algún día se agrega un pixel de analytics, un chat de ventas,
o cualquier tag externo, la recomendación cambia a A sin ambigüedad"*.

⚠️ **Si se elige A**, hay que decidir además una segunda cosa: si A2 corre igual (auditando el
mecanismo nuevo) o si su superficie #3 se reemplaza. **Preguntarlo explícitamente, no asumirlo.**

---

### ⏸️ PARADA 2 (F5) — El operador corre **A1** en Antigravity

**Prerrequisitos que el agente debe confirmar ANTES de parar:**

- [ ] F1 concluyó que A1 sigue valiendo la pena (o el operador lo confirmó pese al veredicto)
- [ ] F3 desplegado y verificado
- [ ] F4: copia sanitizada generada y verificada — **sin** `.env`, `.git`, `keys/`, `certs/`,
      `docs/internal/`, `CLAUDE.md`
- [ ] El repo está commiteado y pusheado

**Modelo y esfuerzo en Antigravity:** **Gemini 3.7 Flash · esfuerzo `High`** · 2–3 sesiones.

**El prompt está escrito y no hay que reescribirlo:**
`C:\Users\JONATHAN\source\repos\proyecto\auditoria pt antigravity\instrucciones-implementacion.md`
→ **Paso 3, "Prompt A1 — pegar tal cual"**.

> ⚠️ **F1 puede proponer ajustarlo.** El prompt se escribió el 28/08 y describe targets que las
> Etapas 2 y 3 auditaron después. Si F1 recomienda un cambio, **aplicarlo al archivo de
> instrucciones antes de esta parada**, no improvisarlo al pegar.

**Qué hace el agente mientras A1 corre:** arranca **F6** (triage 3.1–3.4), respetando la regla de no
tocar archivos de la columna izquierda de §1.

**Qué hacer cuando A1 devuelve el resultado:**

| Resultado | Acción |
|---|---|
| **≥1 hallazgo** | Guardar como `informe-A1-<fecha>.md` en la carpeta de AG → **F7** (triage). 🚨 **Ninguno se aplica sin reproducirlo primero** — las citas `archivo:línea` de Antigravity fueron **erróneas en 3 de 3** casos verificados en A0/A3, y ese carril **infla la severidad** (A0: 7 "críticos" declarados → 4 reales) |
| **0 hallazgos** | **No es un fracaso ni una confirmación automática.** Documentarlo como resultado con evidencia (igual que se hizo con A3) y pasar a F8. Un cero puede significar "el código está limpio" o "este modelo no vio lo que había" |
| **El informe no cita archivo:línea, o no trae evidencia reproducible** | ⛔ **PARAR y consultar.** El propio prompt exige evidencia por hallazgo; un informe sin ella no se puede triagear |

---

### ⏸️ PARADA 3 (F8) — El operador corre **A2** en Antigravity

**Prerrequisitos que el agente debe confirmar ANTES de parar:**

- [ ] F7 cerrada (los hallazgos de A1 triageados; los fixes que se hayan aplicado, desplegados)
- [ ] 🚨 **¿Cambió algún archivo que A2 va a mirar desde que se generó la copia?**
      (`routes/capture.js`, `utils/captureDrafts.js`, `routes/bitacora.js`,
      `landing/demo/index.html`, `public/usuarios/app.js`) → **si sí, regenerar la copia sanitizada**
- [ ] Si en F2 se eligió la **opción A**: confirmado con el operador qué hace A2 con su superficie #3

**Modelo y esfuerzo:** **Gemini 3.7 Flash · esfuerzo `High`** · 1–2 sesiones.

**Prompt:** mismo archivo, **Paso 4, "Prompt A2 — pegar tal cual"**.

> ⚠️ **Su superficie #3 describe el estado ANTERIOR al fix de S11** — dice *"Esa página lo guarda en
> localStorage. ¿Se borra alguna vez?"*, y S11 ya corrigió justamente eso (sin desplegar, hasta F3).
> **F1 tiene que revisar este párrafo** y actualizarlo si corresponde. Dejarlo como está haría que A2
> "descubra" un problema ya resuelto.

**Qué hacer con el resultado:** igual que A1 → **F9**. Y en F9, además del triage, se compara cada
hallazgo contra los 32 de la Etapa 3 marcándolo como **`nuevo` / `coincide` / `descartado`** — es lo
que mide si el carril aportó algo que Claude no vio, que es la única pregunta que este carril existe
para responder.

---

## §3 — Reglas comunes (aplican a todas las fases)

1. 🚨 **Ningún hallazgo de Antigravity se aplica directo.** El circuito es: AG reporta → Claude lee el
   código real y **reproduce** → recién ahí escribe el fix. Fundamento medido, no cautela: **3 de 3
   citas erróneas** en las fases ya corridas.
2. **Ningún agente decide por el operador.** Las 14 decisiones producen **opciones y recomendación**,
   nunca una elección tomada. Si una fase necesita una decisión para continuar, **para y pregunta**.
3. **Producción se puede tocar en esta cadena** — a diferencia de la cadena de la Etapa 3, acá hay un
   humano presente. Pero con el procedimiento estándar, sin excepciones: **backup previo** (DB +
   archivo con timestamp) → `node --check` → deploy → **verificación por hash local=prod** → smoke
   health/landing/portal/dashboard → `pm2-error.log` sin entradas nuevas.
4. **La copia sanitizada nunca incluye `docs/internal/` ni `CLAUDE.md`.** No es por secretos: es
   **contaminación del criterio** — esa carpeta tiene ahora los 8 informes de la Etapa 3 con los 32
   hallazgos ya encontrados. Si A2 los lee, confirma nuestros supuestos en vez de aportar los
   propios, que es exactamente lo contrario de para qué existe el carril.
5. **La copia se regenera fresca**, nunca se reusa una vieja (la de A3 se borró a propósito).
6. **Ningún bloque consume cupo del PJN.**
7. **Cada fase cierra con un veredicto en formato fijo**, como última línea:
   ```
   VEREDICTO F{n}: OK|PARCIAL|FALLO — <resumen en una línea>
   ```

---

## §4 — El gate entre fases

Antes de arrancar la fase siguiente, verificar **los 6 puntos**. Si alguno falla, **la cadena para y
se consulta al operador** — no se improvisa una salida.

| # | Chequeo | Cómo se verifica |
|---|---|---|
| 1 | **La fase anterior emitió su veredicto** en el formato de §3.7 | Leer la última línea de su salida |
| 2 | **El veredicto es `OK`** (o `PARCIAL` con el operador avisado y de acuerdo) | — |
| 3 | **Contrato de esfuerzo cumplido** — una fase 🔴 Alto entrega evidencia reproducible por afirmación, no un resumen | Muestreo de 2–3 citas `archivo:línea` |
| 4 | **Producción sana** si la fase desplegó | `/health` 200 + hash local=prod + `pm2-error.log` sin entradas nuevas |
| 5 | **Repo limpio** — todo commiteado y pusheado, `git status` sin cambios sueltos | `git status --short` vacío · `git rev-list --count origin/main...HEAD` = `0 0` |
| 6 | **Si la fase siguiente es una PARADA**, sus prerrequisitos están todos tildados | Checklist de §2 |

---

## §5 — Qué queda pendiente al terminar esta cadena

Para que "cadena ejecutada" no se lea como "proyecto terminado":

### 🚧 En el camino crítico — lo que bloquea el lanzamiento

| # | Qué | Estado |
|---|---|---|
| **1** | **Etapa 4 — MercadoPago (B3)**, con **F7 (cobranza)** como primer paso y **S8** al cierre | ⏸️ **Diferida por decisión del operador (2026-09-01).** 4–6 sesiones. Sin esto **el producto no puede cobrar** |
| **2** | **AZ — Azure Trusted Signing** | 🔚 Al final del roadmap por decisión del operador. Trámite externo de **1–3 días hábiles** que el lanzamiento va a esperar |

### 🔓 Fuera del camino crítico

| Qué | Estado |
|---|---|
| **S9 — Strix** (pentest agéntico en runtime) | ⛔ **Gate bloqueante**: no hay Docker ni en el VPS ni en la máquina del operador. Plan propio: [`plan-strix-pentest-runtime-2026-09.md`](plan-strix-pentest-runtime-2026-09.md) |
| **EXT** — auditoría externa profesional | Cierra el **mismo eje** que S9, y además da la atestación firmada. Recomendada para el lanzamiento masivo, no para el Beta |
| **F9b** — V6-c, los 5 flujos de la extensión contra el PJN | Gateada tras un spike (Playwright `--load-extension` + `ChromeProfile` real) |
| **D4** — 2 capturas de la demo (pasos 8.3 / 8.4) | Descartadas por el operador el 27/08 — **no son pendientes**, quedan listadas para que nadie las reabra |
| **Pruebas de carga / concurrencia** | Nunca hechas. Cobran importancia real recién con la Etapa 4 |
| **~5 hallazgos menores de la Etapa 2** | F4 #13 · F5 (carátula sin `s/`, CUIT con puntos, 2 de `reconstruirLineasPagina`) · F9a (`client.js:352`, `monitor.js:107`). Documentados y no corregidos **a propósito** |

### ⏸️ Post-lanzamiento

**L1** (activar BASIC/PRO/ENTERPRISE) · **C1** (contrato Facturante) · **L2** (base de conocimiento
del bot con tickets reales).

---

## §6 — Prompt de arranque

```
Ejecutá la cadena de docs/internal/runbook-cadena-ag-triage-2026-09.md desde la F1,
con el gate de §4 entre fases y las reglas de §3. Respetá las 3 paradas de §2: en
cada una, parás y me decís exactamente qué tengo que hacer. Si algún gate falla, no
improvises una salida: parás y me consultás cómo seguir.
```

---

*La Etapa 4 (MercadoPago) queda deliberadamente fuera de esta cadena — ver §0 y §5.*
