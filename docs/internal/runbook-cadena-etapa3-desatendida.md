# Runbook — Etapa 3 (SEC-2) en cadena desatendida

> Diseñado el **2026-08-31** a pedido del operador. Ejecuta los bloques de
> [`plan-seguridad-lanzamiento-2026-08.md`](plan-seguridad-lanzamiento-2026-08.md) como una cadena
> secuencial de subagentes, **sin nadie presente**, y **apaga la máquina al terminar** — tanto si
> termina bien como si se frena por un error.
>
> Este documento es la fuente de verdad de CÓMO se corre. El plan de seguridad sigue siendo la fuente
> de verdad de QUÉ se audita en cada bloque.

---

## §1 — La grilla

**7 agentes / 9 bloques.** Secuencial: cada fase arranca **solo si la anterior pasó el gate**.

| # | Agente | Bloques | Descripción | Modelo | Esfuerzo | Entorno |
|---|---|---|---|---|---|---|
| 1 | `sec-A` | **S1 + S2** | Superficie anónima (`/usuarios/capture`, almacén de borradores) + camino destructivo (import/export de Bitácora, modo `reemplazar`) | Sonnet | 🔴 **Alto** | staging |
| 2 | `sec-B` | **S3 + S4** | Datos personales y retención (Ley 25.326, `data-retention.js` vivo desde el 27/08) + abuso del registro público y farmeo del trial | Sonnet | 🟡 **Medio** | prod **solo lectura** + staging |
| 3 | `sec-C` | **S5** | XSS en las secciones del dashboard admin que XSS-1 no alcanzó (`dashboard.js`, 331 KB) | Sonnet | 🔴 **Alto** | staging + stub |
| 4 | `sec-D` | **S6** | Motor Puppeteer y cliente Electron (`scripts/` 460 KB + `main.js` 147 KB + `renderer.js` 183 KB) | Sonnet | 🔴 **Alto** | local |
| 5 | `sec-E` | **S7** | Rate limits y DoS bajo volumen real ⚠️ *checkpoint de salud de staging después* | Sonnet | 🟡 **Medio** | **staging exclusivamente** |
| 6 | `sec-F` | **S10** | Módulo Markdown: input hostil (SSRF, path traversal, límites de recursos) + corpus adversarial con **tasa medida** | Sonnet | 🔴 **Alto** | local + staging (gate) |
| 7 | `sec-G` | **S11** | Landing pública + gate de la demo (el JWT de 8 h en un origen sin CSP) | Sonnet | 🟡 **Medio** | lectura + local |
| 8 | *(orquestador)* | **cierre** | Informe unificado de la Etapa 3 | — | — | local |

**Fuera de la cadena, por decisión del operador (2026-08-31):**

| Bloque | Estado | Por qué |
|---|---|---|
| **S9** — Strix | ⏸️ **DIFERIDO** | Agente autónomo de ataque, presupuesto de tokens sin techo, exige Docker en el servidor (decisión del operador según el propio plan) + neutralizar SMTP real + `MP_ENV` + backup/restore. **Nunca desatendido.** |
| **S8** — Fraude con cobro real | ➡️ **Etapa 4** | Siempre estuvo asignado ahí: necesita cobro real, corre después de la Fase C de B3. Es el único bloque **Opus** de SEC-2. |

🚨 **Consecuencia que hay que decir con todas las letras: la Etapa 3 va a cerrar con 9 de 11 bloques.**
El informe de cierre tiene que decirlo así. Sin eso, alguien lee *"SEC-2 ejecutado"* y da por auditado
lo que nadie corrió. Y hay una consecuencia de fondo, no solo de conteo: **sin S9, la etapa entrega el
eje de lectura (white-box) pero no el de explotación demostrada en runtime** — ver §8 del plan de
seguridad, que quedó actualizado con esto.

---

## §2 — Modelo y esfuerzo: qué es real y qué no

### Modelo — ✅ sí es configurable, y en esta etapa es uniforme

La herramienta de agentes acepta el modelo por invocación. **Los 9 bloques de la Etapa 3 son Sonnet**
— no es una simplificación: el plan asigna Opus a **un solo** bloque de todo SEC-2 (S8), y S8 no
corre acá. El criterio del plan es explícito: *"la auditoría es búsqueda dirigida con hipótesis ya
escritas, no diseño"*, el mismo con el que se ejecutaron SEC-1, E1-E6 y Q6.

Queda una excepción ya resuelta, anotada para que nadie la reabra: **S10 tenía el modelo
condicionado** (*"Opus si M0 = B/C"*). **M0 devolvió escenario A** → Sonnet, confirmado.

### Esfuerzo — ⚠️ NO es una perilla del sistema. Se implementa como contrato de salida.

**Lo que se verificó el 2026-08-31, y lo que no se pudo:**

| Hecho | Estado |
|---|---|
| La herramienta de agentes acepta `model` por invocación, **pero no un parámetro de esfuerzo** | ✅ verificado (esquema de la herramienta) |
| `.claude/agents/` **no existe** en este proyecto ni en `~/.claude/` | ✅ verificado |
| Las ~15 definiciones de agente reales de los plugins oficiales instalados usan solo `name`, `description`, `model`, `color`, `tools` — **ninguna usa una clave de esfuerzo** | ✅ verificado, leídas una por una |
| La skill oficial `agent-development` documenta el formato completo de frontmatter y **no incluye ninguna clave de esfuerzo** | ✅ verificado (grep de `effort`/`thinking`/`reasoning` → 0 coincidencias relevantes) |
| La descripción de la herramienta menciona que el *"reasoning effort"* sale de la definición del agente | ⚠️ **enunciado, no corroborado** — no se encontró la clave por ningún lado |

**Conclusión honesta: no se puede garantizar que un subagente corra a un esfuerzo distinto por
configuración.** Inventar una clave de frontmatter que el sistema ignore en silencio sería peor que no
poner nada: la cadena parecería correr en "alto" y correría en el default, sin que nadie se entere.

**Por eso el esfuerzo se implementa donde SÍ se puede medir: en la salida exigida.** Un bloque 🔴 Alto
no se declara — **se demuestra** con artefactos que una pasada superficial no puede fabricar:

| Esfuerzo | Contrato de salida — el gate lo verifica |
|---|---|
| 🔴 **Alto** | (a) **Un harness ejecutable corrido**, con resultado numérico (`N/N PASS`), versionado en `backend-server/dev-tools/` · (b) **cada hipótesis del bloque probada una por una**, con evidencia reproducible por hallazgo — no una lectura general · (c) el informe cita `archivo:línea` **reales** (se verifican por muestreo) · (d) para S10: la tasa de falsos negativos del corpus **como número**, no como impresión |
| 🟡 **Medio** | (a) revisión documentada de las hipótesis del bloque · (b) verificación puntual de lo que se afirma (consulta real, `curl` real, `grep` real — no razonamiento solo) · (c) informe con `archivo:línea` |

Si un agente entrega menos que su contrato, **el gate lo caza y la cadena para**. Eso es más fuerte
que una perilla de configuración, porque es *medido* y no *declarado*.

> **Decisión de diseño derivada:** **no se crean definiciones en `.claude/agents/`.** Lo único que
> comprarían por sobre un prompt bien escrito es la clave de esfuerzo, que no se pudo confirmar que
> exista. Las reglas comunes viven en §3 de este documento —versionado, legible por el operador— y
> cada prompt lo referencia. Menos maquinaria, sin dependencia de un mecanismo no verificado.

---

## §3 — Reglas comunes a los 7 agentes

Todo prompt de la cadena las lleva. Son las que hacen que "desatendido" no signifique "sin frenos".

1. **La cadena llega hasta staging. Producción NO se toca para escribir.** Los fixes se escriben, se
   prueban y se despliegan **a staging**; el deploy a producción es una pasada supervisada aparte, con
   el operador. *Fundamento, no cautela genérica:* el bug de `dotenv` que hace que
   `reencrypt_scripts.js` apunte a producción **disparó dos veces, la última en F8 el 2026-08-31** —
   las dos con un humano mirando. Sumado al incidente del `DELETE` de A4.5. Y acá los fixes tocan
   rate limits y el endpoint anónimo de captura: un parche mal calibrado desplegado sin nadie mirando
   **deja afuera a usuarios reales**. S3 lee producción y **solo lee**.
2. **Ningún agente decide por el operador.** S3 (política de retención / postura frente a la Ley
   25.326) y S11 (cuál de las dos soluciones para el JWT en la landing) **producen las opciones y una
   recomendación fundada; no eligen**. El plan lo pide explícito para S3: *"listalas explícitamente en
   vez de decidirlas solo"*.
3. **Ningún bloque corre un flujo real contra el PJN ni consume cupo.** Ninguno lo necesita. Así una
   corrida desatendida no puede dejar sin cupo la prueba diaria.
4. **Ninguna migración de base de datos.** Si un hallazgo la necesita, se documenta y se para.
5. **Leer §2 del plan antes de empezar** — dice qué NO re-testear de SEC-1 y cuáles 4 controles sí se
   invalidaron. Y leer los informes `revision-S*` de las fases anteriores, para no re-derivar.
6. **Al terminar, dejar el entorno como estaba:** staging sin fixtures, app Electron cerrada, sin
   procesos huérfanos, sin archivos sueltos en el repo.
7. **Cerrar con el veredicto en formato fijo**, una línea por bloque:
   `VEREDICTO S{n}: OK|PARCIAL|FALLO — N hallazgos, N corregidos, N abiertos`
   - `OK` — bloque auditado completo, contrato de salida cumplido
   - `PARCIAL` — auditado, pero algo quedó sin cubrir (se dice qué y por qué). **La cadena sigue.**
   - `FALLO` — no se pudo auditar, o el entorno quedó inconsistente. **La cadena para.**

---

## §4 — El gate entre fases

Después de cada agente, el orquestador corre un chequeo **mecánico**, no un juicio:

| # | Chequeo | Corta la cadena si… |
|---|---|---|
| 1 | El/los informe(s) `docs/internal/revision-S{n}-YYYY-MM-DD.md` existen y no son triviales | falta alguno |
| 2 | El veredicto está presente y en formato | dice `FALLO`, o falta |
| 3 | **Contrato de salida del esfuerzo** (§2): harness corrido + números en los bloques 🔴 Alto | el bloque 🔴 no tiene harness ni resultado numérico |
| 4 | Staging: `/health` → 200 y sin fixtures residuales | no responde, o quedó basura |
| 5 | `git status` sin archivos inesperados; `node --check` verde en lo tocado | hay sintaxis rota o basura |
| 6 | Producción intacta: nada se desplegó ahí | se tocó prod |
| 7 | Tope de reloj: ningún agente pasa de ~2 h | se excede |

**Los agrupados (`sec-A`, `sec-B`) emiten un veredicto por bloque**, así la granularidad no se pierde
por compartir agente.

Después de **`sec-E` (S7)** va un checkpoint extra: es el único bloque que puede dejar staging
degradado o rate-limiteado, y eso rompería las fases siguientes.

---

## §5 — Apagado al terminar

**Se apaga la máquina en los dos estados terminales:** cadena completa con éxito, o parada por error.

### Checklist previo — obligatorio, todo tiene que pasar antes del apagado

Una vez apagada la máquina no hay a quién avisarle: el operador se entera recién al volver. Por eso
lo que quede mal escrito o sin commitear **se pierde o queda invisible**.

1. **Todo commiteado y pusheado** — `git status` limpio y `git log origin/main..HEAD` vacío.
2. **Informe final escrito a archivo** (no solo al chat, que nadie va a ver con la máquina apagada):
   - éxito → `docs/internal/revision-etapa3-cierre-YYYY-MM-DD.md` (el informe unificado)
   - parada → `docs/internal/revision-etapa3-PARADA-YYYY-MM-DD.md`, diciendo **en qué fase paró, por
     qué chequeo del gate, y qué quedó a medio hacer**
3. **Staging sano y limpio** — `/health` 200, sin fixtures.
4. **Producción intacta y sana** — smoke health/landing/portal 200. Nada desplegado.
5. **Sin procesos huérfanos** — app Electron cerrada, sin Node colgado.

### El apagado

```
shutdown /s /t 120 /c "Cadena SEC-2 finalizada — ver docs/internal/revision-etapa3-*.md"
```

**120 segundos de gracia a propósito**, no `/t 0`: si el operador está frente a la máquina cuando
dispara, tiene ventana para abortar con `shutdown /a`. No cuesta nada y evita un apagado sorpresa.

---

## §6 — La instrucción para ejecutar

Una sola frase. El orquestador (esta sesión) lee este runbook y arma los 7 prompts desde el plan.

```
Ejecutá la Etapa 3 en cadena desatendida siguiendo
docs/internal/runbook-cadena-etapa3-desatendida.md — los 7 agentes en orden, con el
gate de §4 entre fases, las reglas de §3, y el apagado de §5 al terminar (tanto si
termina bien como si para por error).
```

**Qué hace el orquestador, en orden:**

1. Verifica el estado de partida: árbol limpio, staging sano, producción sana.
2. Spawnea `sec-A`, espera, corre el gate.
3. Si pasa → `sec-B`. Si no → salta al paso 6 con estado `PARADA`.
4. …así hasta `sec-G`.
5. Escribe el informe unificado de cierre.
6. Corre el checklist previo de §5, commitea, pushea.
7. Dispara el apagado.

---

## §7 — Lo que este runbook NO hace

Explícito, para que "cadena ejecutada" no se confunda con "Etapa 3 cerrada":

- **No corre S9 ni S8** — ver §1. La etapa cierra con 9 de 11.
- **No despliega a producción.** Los fixes quedan en staging esperando la pasada supervisada.
- **No toma las decisiones de producto** de S3 y S11.
- **No reemplaza la auditoría externa** — §8 del plan de seguridad explica qué cubre y qué no, ahora
  con la corrección de que sin S9 el eje dinámico queda abierto.
- **No tiene presupuesto de tokens acotado por el sistema.** Son 7 agentes, 4 de ellos en esfuerzo
  alto sobre archivos grandes. El tope de reloj de §4 acota cada fase, no el costo total.
