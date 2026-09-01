# Etapa 3 (SEC-2) — Informe unificado de cierre

> Cadena desatendida ejecutada el **2026-09-01** siguiendo
> [`runbook-cadena-etapa3-desatendida.md`](runbook-cadena-etapa3-desatendida.md), sobre
> [`plan-seguridad-lanzamiento-2026-08.md`](plan-seguridad-lanzamiento-2026-08.md). 7 agentes
> secuenciales (`sec-A` a `sec-G`), cada uno arrancando solo si el anterior pasó el gate de §4 del
> runbook. Los 7 pasaron. Este documento consolida los 9 bloques que auditaron.

---

## 0. La frase que tiene que quedar escrita, textual

🚨 **La Etapa 3 cierra con 9 de 11 bloques de SEC-2. S9 (Strix, pentest agéntico en runtime) quedó
diferido por decisión del operador del 2026-08-31 — nunca corre desatendido, exige Docker en el
servidor y neutralizar SMTP/MP_ENV con alguien presente. S8 (fraude con cobro real) no es de esta
etapa — siempre estuvo asignado a la Etapa 4, porque necesita que exista cobro real, y corre después
de la Fase C de B3 (MercadoPago producción).**

**Consecuencia de fondo, no solo de conteo:** sin S9, esta etapa entrega el eje de lectura
(white-box: código leído, hipótesis verificadas una por una, harnesses corridos) pero **no** el eje
de explotación autónoma y no dirigida en runtime. Es la misma partición que ya documenta §8 del plan
de seguridad para la pregunta de si esto reemplaza a una auditoría externa — la respuesta sigue
siendo: cubre el trabajo técnico, no la atestación independiente, y ahora tampoco el eje dinámico
completo mientras S9 no corra.

**"SEC-2 ejecutado" no es sinónimo de "Etapa 3 cerrada al 100%".** Es 9/11 bloques, con S9 pendiente
de una sesión con el operador presente y S8 pendiente de que exista cobro real.

---

## 1. Los 9 bloques

| # | Bloque | Agente | Informe | Veredicto | Hallazgos | Corregidos | Abiertos |
|---|---|---|---|---|---|---|---|
| 1 | **S1** — Superficie anónima de captura | `sec-A` | [`revision-S1-S2-2026-09-01.md`](revision-S1-S2-2026-09-01.md) | OK | 3¹ | 0 | 3 |
| 2 | **S2** — Camino destructivo (import/export Bitácora) | `sec-A` | mismo informe | OK | 1¹ | 1 | 0 |
| 3 | **S3** — Datos personales / retención (Ley 25.326) | `sec-B` | [`revision-S3-S4-2026-09-01.md`](revision-S3-S4-2026-09-01.md) | OK | 6² | 2 | 4 |
| 4 | **S4** — Abuso del registro y farmeo del trial | `sec-B` | mismo informe | OK | 3² | 0 | 3 |
| 5 | **S5** — XSS en el admin no auditado | `sec-C` | [`revision-S5-2026-09-01.md`](revision-S5-2026-09-01.md) | OK | 2 | 2 | 0 |
| 6 | **S6** — Motor Puppeteer / cliente Electron | `sec-D` | [`revision-S6-2026-09-01.md`](revision-S6-2026-09-01.md) | OK | 3 | 3 | 0 |
| 7 | **S7** — Rate limits y DoS | `sec-E` | [`revision-S7-2026-09-01.md`](revision-S7-2026-09-01.md) | OK | 4 | 1 | 3 |
| 8 | **S10** — Módulo Markdown: input hostil | `sec-F` | [`revision-S10-2026-09-01.md`](revision-S10-2026-09-01.md) | OK | 8 | 8 | 0 |
| 9 | **S11** — Landing pública + gate de la demo | `sec-G` | [`revision-S11-2026-09-01.md`](revision-S11-2026-09-01.md) | OK | 2 | 1 | 1 |
| | **TOTAL** | | | **9/9 OK** | **32** | **18** | **14** |

> ¹ El "0. Resultado" de `revision-S1-S2-2026-09-01.md` dice en su encabezado *"3 hallazgos reales,
> los 3 corregidos"*, pero la tabla de hallazgos del mismo informe (§1) lista **4 filas** — 1
> corregida (S2: `checkBitacoraPlan()` sin `registration_status`) y 3 documentadas explícitamente
> como *"no corregido"* (S1: H-2 desalojo FIFO global, IDOR de drafts por diseño, S2: H-3 sin rate
> limit propio del import). Este informe de cierre usa **la tabla por fila** (fuente más granular y
> internamente consistente con el estado que cada fila declara), no el titular del §0 de ese
> informe — de ahí el 3/1/0 en S1 y 1/1/0 en S2 en vez del titular 3/3.
>
> ² Mismo criterio: `revision-S3-S4-2026-09-01.md` tiene 9 filas en su tabla de hallazgos —
> 6 de S3 (2 corregidas: los 2 bugs del cron 5e; 4 documentadas: brecha de borrado completo de PII,
> 3 contradicciones de la Política de Privacidad colapsadas en 2 filas de la tabla más la de
> auditoría de lectura) y 3 de S4 (checksum de CUIT, farmeo sin fricción vía `machine_id`, registro
> abierto — las 3 documentadas, ninguna corregida por ser decisiones de producto o diseño consciente,
> no bugs).

**Los 9 informes, sin excepción, terminan en `VEREDICTO S{n}: OK`.** Ninguno paró la cadena.

---

## 2. Dónde viven los fixes — ninguno en producción *(al momento de esta corrida)*

> ✅ **ACTUALIZACIÓN 2026-09-01 (mismo día, más tarde): los 18 fixes YA ESTÁN EN PRODUCCIÓN.**
> La pasada supervisada que esta sección anticipa **se ejecutó**: los 6 archivos de backend
> desplegados staging→prod y verificados byte-idénticos por hash (local = staging = prod), y los de
> Electron publicados en el release **`electron-v2.7.53`** junto con los de F3/F5/F6 (~40 fixes de
> cliente en total). El de la landing (S11) fue directo a producción porque **la landing no tiene
> entorno de staging** — documentado desde D6 de la Etapa 1.6.
>
> **Verificación de daño real del gate de Bitácora** (consulta de solo lectura, sin fixtures):
> **0 usuarios reales** estuvieron alguna vez en un estado bloqueado con `bitacora_enabled=true`
> mientras el gate no miraba `registration_status` — la ventana estuvo abierta pero nadie la cruzó
> (solo 3 cuentas en toda la base: los 2 admins + la de verificación).
>
> **La tabla de abajo se conserva sin editar** porque describe el estado real *al cerrar la cadena*,
> que es lo que este informe documenta.


| Bloque | Los fixes de código quedaron en… |
|---|---|
| S1+S2 | **Staging** (`middleware/checkBitacoraPlan.js`) |
| S3+S4 | **Staging** (`server.js`, cron 5e) |
| S5 | **Staging** (`public/dashboard/dashboard.js`, verificado con Playwright contra la app real de staging) |
| S6 | **Local, commiteado** (Electron no tiene entorno de staging — es código cliente que sale recién con un release) |
| S7 | **Staging** (`routes/extension.js`, `ecosystem.config.js`) |
| S10 | **Local, commiteado** (`electron-app/main.js`, `markdown/*.js` — mismo motivo que S6) |
| S11 | **Local, commiteado, ni siquiera en staging** (la landing no tiene entorno de staging — `procuradortool.com` no tiene equivalente en `staging-api`, documentado desde la sesión de D6 de la Etapa 1.6) |

**Cero escrituras a producción en toda la cadena.** Cada informe individual lo confirma con
`/health` 200 en `api.procuradortool.com` al cerrar, sin reinicios ni errores nuevos atribuibles a
la sesión. **Desplegar staging→producción es una pasada supervisada aparte**, con el operador
presente — exactamente la regla #1 de §3 del runbook, sostenida en los 7 agentes sin excepción.

---

## 3. Decisiones de producto pendientes para el operador

Ningún agente de la cadena decidió por el operador — es la regla #2 del runbook. Se listan juntas
acá, con la recomendación de cada bloque, para que no queden dispersas en 9 informes distintos.

### 3.1 S3 — Qué hacer con la brecha de borrado completo de PII

El cron corregido de esta sesión (cron 5e) solo anula el CUIT a los 90 días de una baja. Nombre,
apellido, domicilio, teléfono y email **nunca se borran de ninguna forma automatizada**, pese a que
la Política de Privacidad promete "supresión" en 5 días hábiles. 3 opciones (§2.3 del informe
S3+S4):

- **A** — endpoint admin de borrado completo (mayor costo, la solución estructural).
- **B** — extender el cron 5e para anonimizar también el resto de los campos (menor costo, sigue
  atado a 90 días, no da respuesta inmediata).
- **C** — formalizar el proceso manual actual con un script versionado y probado (mínimo viable,
  no toca código de producto).

**Recomendación del bloque:** C ahora (cierra la brecha operativa con 0 clientes reales hoy), A o B
antes del lanzamiento masivo.

### 3.2 S3 — Las 3 contradicciones entre la Política de Privacidad y el código real

- Logs de ejecución: la política promete 12 meses, el código retiene 90 días (retiene *menos* de lo
  prometido — no es riesgo de privacidad, es inexactitud legal).
- Analytics: la política promete purga a 90 días, **no existe ningún mecanismo** que la ejecute
  nunca (hoy sin impacto real — los datos más viejos tienen 34 días).
- Supresión ante baja: la política promete 30 días hábiles, el mecanismo real (cron 5e, corregido)
  tarda 90 días calendario y solo toca 1 de 5 campos — mismo eje que 3.1, en el texto legal.

**Decisión pendiente:** para cada una, ¿se ajusta el código a lo que dice la política, o se ajusta
el texto legal a lo que hace el código?

### 3.3 S4 — Registro público abierto sin fricción

`allow_public_register=true` está activo en producción hoy. El bloque confirmó 3 hechos que, juntos,
hacen que cada registro regale 20 usos reales contra el PJN casi sin costo para quien quiera
abusarlo en volumen: el checksum de CUIT es un algoritmo público sin verificación contra ningún
padrón real, `machine_id` no limita cuántas cuentas comparten un mismo dispositivo (es
anti-robo-de-token por diseño, no anti-multi-cuenta), y no hay verificación de dominio de email.
Con 3 usuarios reales hoy el riesgo es teórico; publicado, deja de serlo.

**2 opciones, sin decidir:** mantener el registro abierto (aceptando el riesgo mientras el volumen
sea bajo, con la opción de agregar fricción después — CAPTCHA, verificación de dominio, límite de
cuentas por `machine_id`) o pasar a lista de espera/invitación para el lanzamiento inicial.

### 3.4 S7 — Política del rate limit de descarga de scripts

`scriptDownloadLimiter` (150 req/5min) autodeniega a un estudio jurídico de 12+ abogados logueados
desde la misma ventana de 5 minutos (11 caben, el 12° falla) — es un falso positivo de
disponibilidad contra clientes que pagan, no un hallazgo de seguridad. **Decisión pendiente:** ¿tope
por usuario en vez de por IP, o simplemente subir el número?

### 3.5 S11 — Cómo cerrar el gate de la demo (esta misma sesión)

Detallado en [`revision-S11-2026-09-01.md`](revision-S11-2026-09-01.md) §6. Dos opciones:

- **A** — token propio, efímero, sin privilegios, que reemplace el JWT de sesión completo en ese
  origen. Elimina el bloque entero como clase de riesgo, mayor esfuerzo.
- **B** — mínima: headers de seguridad en el vhost (documentados en el informe, no aplicados) + que
  la demo descarte un token vencido (ya corregido localmente, no desplegado).

**Recomendación del bloque:** B alcanza mientras la landing no incorpore ningún script de terceros
(hoy no tiene ninguno); si algún día se agrega un pixel de analytics, un chat de ventas, o cualquier
tag externo, la recomendación cambia a A sin ambigüedad — en ese momento la superficie de XSS deja
de ser hipotética.

---

## 4. Lo que NO cubre esta etapa (explícito, para no confundir "auditado" con "invulnerable")

- **S9 (Strix)** — el eje de explotación autónoma en runtime. Diferido, no ejecutado.
- **S8 (fraude con cobro real)** — no es de esta etapa. Se ejecuta en la Etapa 4, después de la
  Fase C de B3.
- **Auditoría externa profesional** — ninguno de los 9 bloques la reemplaza. Cubre el trabajo
  técnico (lectura white-box, explotación puntual dirigida por hipótesis, verificación de que el
  parche resiste); no da la atestación independiente que pide un cliente institucional o una
  aseguradora.
- **Pentest de infraestructura del VPS** (fuera del alcance de código de aplicación) — no auditado
  en ningún bloque de SEC-2.
- **`electron-app/src/security/`** (zona protegida) — se leyó lo mínimo para entender interacciones
  en S6/S10, no se auditó su lógica criptográfica interna en profundidad.

---

## 5. Verificación del cierre

- Los 7 informes de bloque existen, no son triviales, y terminan en `VEREDICTO S{n}: OK`.
- `git log origin/main..HEAD` — se pushea junto con este informe, sin dejar commits locales sin
  subir.
- Staging: `/health` 200 en `:3444`, sin fixtures residuales (confirmado por cada informe
  individual al cerrar).
- Producción: `/health` 200 en `api.procuradortool.com`, sin reinicios ni errores nuevos en ningún
  punto de la cadena.
- Ningún proceso Electron/Node quedó corriendo en ninguno de los 9 bloques.
- Ninguna migración de base de datos en toda la cadena.
- Ningún flujo real contra el PJN, cero cupo consumido.

**CADENA COMPLETA: OK — 9/9 bloques en OK, 32 hallazgos totales, 18 corregidos (staging o local,
ninguno en producción), 14 documentados como decisiones de producto o riesgos de bajo impacto
pendientes del operador.**
