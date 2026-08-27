# Roadmap de salida a mercado — ProcuradorTool (2026-08-26)

> **Para qué existe este documento.** Hasta hoy los pendientes del proyecto vivían como planes
> independientes, cada uno correcto por su cuenta pero sin un orden entre sí: el plan de MercadoPago
> no sabía que la auditoría de seguridad depende de él, la campaña de code-review no sabía que dos
> de sus bloques necesitan al operador presente igual que la demo, y la lista de pendientes de
> `CLAUDE.md` mezclaba trabajo ejecutable con trámites externos y con decisiones de negocio.
>
> **Esto es un solo proyecto con un solo objetivo: sacar el producto a mercado.** Este documento es
> la única fuente de verdad sobre **el orden**. Cada etapa remite a su plan de detalle; ninguno de
> esos planes se duplica acá.
>
> **Regla de uso:** cuando se pregunte "¿qué sigue?", se responde desde acá — no reconstruyendo la
> lista desde `CLAUDE.md` ni desde los planes sueltos.

---

## §1 — El mapa

```
  ETAPA 1 — MEJORAS DE PRODUCTO            ┌── CARRIL PARALELO ──────────────┐
  (lo que se muestra y se vende)           │  AZ — Azure Trusted Signing     │
    1.1 Bitácora F3.4                  ✅  │  (trámite externo, 1-3 días      │
    1.2 Módulo Markdown / anonimiz.    ✅  │   hábiles — ARRANCA EL DÍA 0)   │
    1.3 Landing + TyC (beta, límites)  ✅  └─────────────────────────────────┘
    1.4 Guía de backup y recuperación  ✅
    1.5 Control periódico contra PJN   ✅
    1.6 Demo reproducible en landing   🔄  (D1 guion ✅, sigue D2)
              │
              ▼
  ETAPA 2 — CODE REVIEW INTEGRAL  (incluye /verify V4+V5+V6)
    F6 cifrado → F1/F2/F3/F4 → F5 → F8 → F7 cobranza (gate) → F9 verify
              │
              ▼
  ETAPA 3 — SECURITY REVIEW  (SEC-2: S1–S7 + S9 Strix + S10 Markdown)
              │
              ▼
  ETAPA 4 — MERCADOPAGO PRODUCCIÓN (B3)
    Fase A/B → Fase C (primer cobro real) → S8 (fraude con cobro real)
    → code-review y security-review focalizados del delta
              │
              ▼
  LANZAMIENTO  →  post-lanzamiento: L1 planes · C1 Facturante · L2 KB IA
```

---

## §2 — Por qué este orden y no otro

Cuatro razones, todas económicas — ninguna estética:

1. **Producto antes que revisión.** Revisar código que está por reescribirse es trabajo tirado. La
   Etapa 1 agrega superficie nueva (el módulo Markdown es un módulo entero) y toca los dos archivos
   más grandes del proyecto. Si el code-review corre primero, hay que repetirlo.
2. **Code review antes que seguridad.** Los fixes del code-review cambian la superficie que audita
   SEC-2. Auditar primero obliga a auditar dos veces.
3. **Todo antes que MercadoPago.** El día que las credenciales de MP sean reales, cada bug del camino
   del pago cuesta dinero. B3 debe entrar sobre código ya revisado y auditado, no al revés. Por eso
   la fase **F7 (cobranza) del code-review es un gate duro** de la Etapa 4.
4. **AZ arranca el día 0.** Es lo único cuyo tiempo no lo controlamos (Certificate Profile: 1-3 días
   hábiles). No bloquea nada, pero si se deja para el final, el lanzamiento queda esperando un
   trámite. Arranca en paralelo con la Etapa 1 y se olvida hasta que llegue.

---

## §3 — Etapa 1 — Mejoras de producto

> ✅ **Gate de negocio — RESUELTO el 2026-08-26.** Los ítems 1.1 y 1.2 son **features nuevas**: entran
> al roadmap porque el operador quiere venderlas, no porque el producto las necesite para funcionar.
> Nacieron condicionados a un go/no-go, y **el operador dio el visto bueno**: los seis ítems de esta
> etapa están confirmados y ninguno espera una decisión. Ya **no** figuran en "Diferidos a decisión de
> negocio" de `CLAUDE.md` — esa sección quedó solo con lo genuinamente post-lanzamiento (L1 · C1 · L2).
>
> **Lo que esa confirmación arrastra hacia las etapas siguientes** (por eso no era un cambio cosmético):
> el módulo Markdown es un módulo entero de código nuevo, así que **existirá cuando corran las Etapas
> 2 y 3 y ambas tienen que cubrirlo**. La Etapa 2 ya lo contemplaba (fase **F5** del plan de
> code-review). La Etapa 3 **no** — se le agregó el bloque **S10** el mismo día (ver §5). El único
> condicionamiento que sigue vivo dentro de la etapa es **M0**, el gate técnico interno de 1.2, que no
> decide *si* se hace sino *de qué tamaño*.

### 1.1 — Bitácora F3.4 ✅ CERRADO (2026-08-26)

| | |
|---|---|
| **Plan** | [`plan-f3-4-semana-e-ics-2026-08.md`](plan-f3-4-semana-e-ics-2026-08.md) (ya escrito, listo para ejecutar) |
| **Qué es** | **Bloque A — vista "Semana"**: un tercer modo de calendario entre Mes y Lista. Cierra el pendiente P-F1.3-a (la vista se mencionaba en el diseño original y quedó afuera). Solo portal, riesgo 🟢. **Bloque B — export `.ics`**: exportar los vencimientos y tareas al calendario del usuario (Google Calendar, Outlook). Backend + portal, riesgo 🟡 |
| **Modelo / esfuerzo** | A: Sonnet · **bajo** · B: Sonnet · **medio** |
| **Sesiones** | 1–2 (los bloques son independientes; recomendado A primero) |
| **Despliegue** | Backend/portal. **Sin migración, sin release de Electron, sin tocar scripts encriptados** |
| **Fuera de alcance** | **Tipos de entrada personalizados** — el único de los 3 ítems de F3.4 que toca el modelo de datos, y no hay pedido concreto. Queda diferido |

> El valor del plan está en su §B.2: el `.ics` es 100% serialización de fechas **en el único módulo
> del proyecto que ya produjo 3 bugs reales de timezone en producción**. Enumera las 6 trampas
> concretas, cada una de las cuales produce un archivo que *parece* funcionar.

### 1.2 — Módulo Markdown / anonimización judicial ✅ CERRADO (release + flag encendidos el 2026-08-27)

| | |
|---|---|
| **Plan** | [`plan-modulo-markdown-anonimizacion-2026-08-26.md`](plan-modulo-markdown-anonimizacion-2026-08-26.md) |
| **Qué es** | Toma un informe PDF generado por la app, descarga los PDF vinculados, extrae todo a Markdown, y produce además una versión **anonimizada** (expediente → `Expediente`, partes → `Actor`/`Demandado`, terceros → `Jon### Ber###`) con un diccionario de reemplazos editable y reprocesable |
| **Dónde** | Botón propio en el topbar, al lado de 📔 Bitácora. Gateado por plan (`markdown_enabled`) |
| **Modelo / esfuerzo** | Sonnet en 6 de 7 bloques. **Opus solo en M4** (motor de anonimización) |
| **✅ Release** | `electron-v2.7.51`, publicado y confirmado en vivo el 2026-08-27 (`GET /client/download/electron` → 302 al `.exe` correcto) |
| **✅ Flag** | `markdown_enabled=true` en **COMBO_PROMO** (decisión del operador, 2026-08-27) — radio de impacto real: 1 cuenta activa, las otras 5 suscripciones del plan son fixtures de QA bloqueados. Verificado end-to-end: `GET /client/account` → `markdownEnabled:true`, y el botón **Markdown** aparece en el topbar del build 2.7.51 |
| **✅ Gate propio — CERRADO el 2026-08-26** | **M0 devolvió ESCENARIO A**, el más barato: los documentos del SCW se descargan **sin sesión** (12/12 `HTTP 200`, verificado sobre los 4 tipos). **M3 es `fetch` en Node** — no se toca ningún script encriptado, no entra el candado de ejecución, y **el módulo SÍ procesa informes viejos**. La capa de texto salió mejor de lo previsto: **0 %** de páginas sin texto en el informe, **14,6 %** en los adjuntos (sin OCR en v1). 📄 [`spike-markdown-M0-2026-08-26.md`](spike-markdown-M0-2026-08-26.md) |

> 🚨 **Lo que M0 encontró y ningún documento del módulo contemplaba:** los `viewer.seam` que el
> informe embebe **abren el documento original sin autenticación**, y sus tokens **no expiran**
> (≥27 días medidos). Un `.md` con los nombres enmascarados pero los **enlaces vivos entrega el
> expediente sin anonimizar** a quien lo reciba. **La anonimización tiene que alcanzar a las URLs, no
> solo al texto** — es la regla 4 de M4, con una decisión de producto pendiente del operador
> (eliminar / referencia local / dejarlas). **✅ Decidido por el operador (2026-08-26): eliminar** —
> en la versión anonimizada, el enlace se borra y solo queda el texto del anexo. Su verificación es
> binaria y ya está incorporada al bloque **S10** de la Etapa 3.

### 1.3 — Landing + Términos y Condiciones + Privacidad ✅ CERRADO (2026-08-26)

| | |
|---|---|
| **Plan** | no requiere documento propio — el alcance está acá |
| **Modelo / esfuerzo** | Sonnet · **medio** (el contenido legal lo revisa el operador, no Claude) |
| **Sesiones** | 1 |
| **Depende de** | que el alcance de 1.1 y 1.2 esté **congelado** (no terminado — congelado) |

Cuatro cambios, todos pedidos explícitamente por el operador:

1. **Estado de Beta, remarcado.** Hoy la landing habla de "promo" y "precio fundador", pero **no dice
   en ningún lado que el producto está en fase de prueba**. Debe decirlo — en la landing y en los TyC.
2. **Limitación de responsabilidad.** Es lo más importante de todo el bloque y hoy está flojo:
   el producto **automatiza actos con consecuencias procesales** (plazos, vencimientos, informes que
   un abogado usa para decidir). Los TyC tienen que decir que las salidas son una **ayuda** que el
   profesional debe **supervisar y verificar**, y que la responsabilidad del acto procesal es suya.
3. **Ampliar Bitácora, Markdown y extensión.** Bitácora hoy tiene una línea en la landing (agregada
   en agosto); Markdown no existe todavía; la extensión está mencionada pero no explicada.
   Cada una con su cláusula de "en prueba, supervisado por el usuario".
4. **La leyenda del anonimizador**, textual: *la anonimización es una ayuda automática, no una
   garantía; el usuario es responsable de revisar el resultado antes de compartirlo*. Sin esto, el
   módulo promete algo que ningún motor de regex puede cumplir sobre documentos judiciales reales.

**Archivos:** `public/landing/index.html`, `public/terminos/index.html`, `public/privacidad/index.html`
(estos dos últimos **no se tocan desde el 2026-06-02** — anteriores a Bitácora, al módulo Markdown y a
todo lo de agosto). Despliegue estático vía Nginx, **sin `pm2 restart`**.

> ⚖️ **Recomendación:** el texto de limitación de responsabilidad debería mirarlo un abogado antes de
> publicarse. Claude puede redactar el borrador y explicar qué cubre cada cláusula; no es asesoramiento
> legal. El operador es abogado — esto es un recordatorio de que el borrador es un punto de partida.

### 1.4 — Guía de backup y recuperación (operativa, para el administrador) ✅ CERRADO (2026-08-26)

| | |
|---|---|
| **Plan** | no requiere documento propio — el alcance está acá. **Entregable: [`guia-backup-recuperacion.md`](guia-backup-recuperacion.md)** |
| **Modelo / esfuerzo** | Sonnet · **medio** |
| **Sesiones** | 1 |
| **Depende de** | nada — se puede hacer cuando sea |

El operador pidió *"una guía de cómo se realizan los backup en el servidor y una guía de recuperación,
determinando cómo el administrador puede obtener dichos backups para hacer copias locales y
resguardarlas"*. Hoy **existe el mecanismo pero no la guía**, y al relevarlo aparecieron dos huecos
reales:

**Lo que ya existe y funciona:**
- Cron diario 03:00 → `backend-server/scripts/backup-db.js` → `pg_dump` comprimido → **DO Spaces**
  (bucket `procurador-backups`, región `nyc3`), retención 30 días + copia local en
  `/var/backups/procurador/`. Regenera además `database/schema.sql` y sube `schema-latest`.
- `ops/backup-now.sh [prod|staging]` — backup on-demand pre-deploy, últimos 10.
- `ops/restore-db.sh [prod|staging] <archivo>` — restauración, con backup de seguridad previo del
  destino y confirmación tipeada para prod. **Probado end-to-end** contra una base descartable.
- Dos simulacros de rollback escritos y corridos (`ops/drill-rollback.sh`, `drill-code-rollback.sh`).

**🚨 Hueco 1 — el backup automático solo cubre la base de datos.** Verificado leyendo el script: hace
`pg_dump` y nada más. **No** cubre:
- **`backend-server/storage/invoices/`** — los PDF de facturas reales, con CUIT y domicilio de
  clientes. Son documentos fiscales que **no se pueden regenerar** (los sube el admin desde ARCA a
  mano) y **no están en ningún backup automático**. Tampoco en el `.7z` manual, que copia DB + env +
  keys + certs + código, pero no `storage/`. **Es el hallazgo más serio de este bloque.**
- `.env` / `.env.staging`, `keys/` (RSA), `certs/` — sí están en el `.7z` manual, pero eso es una
  rutina que se ejecuta a mano y a discreción, no un backup.

**🚨 Hueco 2 — no hay procedimiento documentado para bajar un backup a una máquina local.** El
operador puede hacerlo (`scp` desde `/var/backups/procurador/`, o desde DO Spaces con las credenciales
del `.env`, o desde el panel web de DigitalOcean), pero no está escrito en ningún lado, y "puedo
deducirlo" no es un plan de recuperación.

**La guía debe cubrir, en este orden:**
1. Qué se respalda hoy, dónde queda, con qué retención, y **qué NO se respalda** (los dos huecos).
2. **Cómo el administrador baja una copia local**, con los comandos exactos, por las tres vías
   (local del servidor por `scp` · DO Spaces por CLI · panel web).
3. Con qué frecuencia conviene bajarla y dónde guardarla (el `.7z` a OneDrive ya es la rutina — hay
   que integrarla, no reemplazarla).
4. **Cómo se restaura**, con el árbol de decisión: ¿es un problema de datos, de código, o de ambos?
   (los tres caminos ya existen: `restore-db.sh`, tags de git, fix-forward de Electron).
5. **Cómo se verifica que un backup sirve** — restaurarlo contra una base descartable, que es lo que
   ya hace el simulacro. Un backup que nunca se restauró no es un backup.
6. Cerrar el hueco 1: extender `backup-db.js` para incluir `storage/invoices/`, o justificar por
   escrito por qué no.

### 1.5 — Control periódico de funcionamiento contra el PJN ✅ CERRADO (2026-08-27)

| | |
|---|---|
| **Plan** | [`plan-verificacion-pjn-dashboard-2026-08-26.md`](plan-verificacion-pjn-dashboard-2026-08-26.md) |
| **Estado** | ✅ **Cerrado** — 5 fases ejecutadas + primera corrida real reportada |

**Se resolvió con un enfoque distinto al que describía este roadmap.** El plan original era
reactivar `dailyVerification.js` (el módulo oculto de SEC-2·B.2, apagado desde el 2026-07-14) y
extenderlo al Monitor. **El operador propuso otra cosa y es mejor en casi todo:** reportar al
dashboard la *prueba diaria vía computer-use*, que ya se corría 6 veces por mes cubriendo **los 5
flujos reales** — y cuyo resultado se perdía en la prosa de `CLAUDE.md` sin llegar nunca a
Diagnóstico. Cubre 5 flujos en vez de 3, no necesita release de Electron, y **no agrega ni un solo
endpoint en `/client/*`** (el router que usan las apps de todos los usuarios).

`dailyVerification.js` **quedó sin tocar, apagado** — si algún día se prende, reporta a la misma
tarjeta con `origen:'app-automatica'`.

**Lo entregado:** modelo `flujos[]` con 3 estados (`ok`/`error`/**`omitido`**, para no confundir
"sin cupo" con "el PJN se rompió") · recarga acotada del cupo de la cuenta de prueba con 7
protecciones · tarjeta reescrita en Diagnóstico con el comando de computer-use siempre visible ·
**alerta por email con deduplicación por episodio** · y el procedimiento completo documentado en
`CLAUDE.md` con las 3 trampas operativas del entorno ya medidas.

**La primera corrida real** (app v2.7.50 contra el PJN) dio **los 5 flujos en `ok`**, con el
consumo de cupo cuadrando exacto con el modelo documentado.

### 1.6 — Demo reproducible del producto en la landing ⏳ D1 EJECUTADA, EN CURSO

| | |
|---|---|
| **Plan** | [`plan-demo-producto-2026-08-26.md`](plan-demo-producto-2026-08-26.md) — revisado el 2026-08-27 con un spike de capacidad |
| **Guion** | ✅ **[`demo-guion.md`](demo-guion.md)** (D1, 2026-08-27, revisado contra 34 capturas reales + capítulo de Portal agregado) — 8 capítulos, 43 pasos (36 D3 / 7 D4) |
| **Qué es** | Tour guiado en HTML estático servido desde `/demo/`, con capturas reales anonimizadas + clips cortos, un capítulo por módulo, linkeable desde cada tarjeta de la landing |
| **Fases** | **6 (D1–D6)** · **D1 ✅** · sigue **D2** (fixtures + capa de sustitución) |
| **Modelo / esfuerzo** | Sonnet en las 6 · `alto` solo en D3 (volumen: ~40 pantallas) |
| **Sesiones** | **~5,5** + **~15 min del operador** (ya no una sesión conjunta) |
| **Depende de** | 1.1 ✅ · 1.2 ✅ (con su release, `electron-v2.7.51`) · 1.3 ✅ — **sin dependencias pendientes** para arrancar D2 |
| **🎯 El hallazgo que reduce el costo, verificado el 2026-08-27** | **Playwright captura la app Electron vía CDP**, reusando `tests/daily/electron_driver.py`: screenshot, viewport fijo, los 9 modales abribles por código, y **sustitución de datos sensibles antes de capturar**. La superficie más grande pasó de *"requiere al operador"* a **totalmente automatizable**, y el pipeline reproducible cubre **~90%** de las pantallas en vez de ~60% |
| **El otro hallazgo (sigue vigente)** | Los **stubs de V0** sirven los archivos reales del portal y el dashboard contra una API falsa → esas capturas salen **sin un solo dato real que esfumar** |
| **Lo único que el operador captura a mano** | **Extensión Chrome y sitio del PJN** (bloque D4, ~15 min). No hay Chrome conectado por Claude-in-Chrome, y computer-use otorga los navegadores en tier "read" |

---

## §4 — Etapa 2 — Code review integral

| | |
|---|---|
| **Plan** | [`plan-code-review-integral-2026-08-26.md`](plan-code-review-integral-2026-08-26.md) ⭐ **nuevo** |
| **Fases** | 9 — F1 a F8 de `/code-review` + **F9 = los bloques V4/V5/V6 de `/verify`** que quedaron bloqueados por el entorno |
| **Modelo** | Sonnet en 6. **Opus en 2**: F6 (cadena de cifrado de scripts) y F7 (cobranza) |
| **Esfuerzo** | `xhigh` en las 3 áreas grandes nunca revisadas · `high` en 4 · `medium` en 1 |
| **Sesiones** | 9–13 |
| **Depende de** | Etapa 1 cerrada |
| **Habilita** | Etapa 3, y vía F7 la Etapa 4 |

**El hueco que justifica la campaña, medido el 2026-08-26:** todo el módulo Bitácora
(`routes/bitacora.js` **84 KB**, el único endpoint anónimo del sistema, y el crecimiento de
`public/usuarios/app.js` hasta **236 KB**) se construyó **después** de la última revisión integral y
**nunca tuvo una pasada de código**. Y los dos archivos más grandes del proyecto (`dashboard.js`
324 KB y `usuarios/app.js` 236 KB) nunca tuvieron más que un `grep` dirigido.

**Dos pedidos del operador ya incorporados:**
- **Verificar que los scripts se encripten correctamente** → es la fase **F6**, en Opus, y no es solo
  lectura: incluye un harness ejecutable que descarga los 13 scripts de la whitelist, verifica firma
  y hash contra la DB, compara contra el fuente del repo (detecta drift entre lo desplegado y lo
  versionado) y confirma que los 6 scripts filtrados siguen dando 404.
- **Incluir V4/V5/V6** → es la fase **F9**, y corre **después** de que los fixes de F1–F5 estén
  desplegados (verificar en runtime un producto al que le faltan los arreglos produce hallazgos que
  se corrigen solos).

---

## §5 — Etapa 3 — Security review

| | |
|---|---|
| **Plan** | [`plan-seguridad-lanzamiento-2026-08.md`](plan-seguridad-lanzamiento-2026-08.md) (SEC-2, **actualizado el 2026-08-26** con los bloques S9 y S10) |
| **Bloques en esta etapa** | **S1–S7 + S9 + S10**. **S8 NO** — ver abajo |
| **Modelo** | Sonnet en todos los de esta etapa |
| **Sesiones** | 7–11 (S1+S2 y S3+S4 son agrupables) |
| **Depende de** | Etapa 2 cerrada y sus fixes desplegados |

**Lo nuevo: S9 — Strix.** Pentest agéntico en runtime (`github.com/usestrix`, Apache 2.0, Docker + CLI).
Aporta el eje que S1–S8 no tienen: **exploración no dirigida y explotación demostrada**, en vez de
confirmación de hipótesis escritas. Corre **solo contra staging**, y **antes hay que cortar dos
salidas reales**: el SMTP de staging (hereda Brevo real → un agente registrando cuentas dispara emails
reales) y MercadoPago (se resuelve poniendo `MP_ENV` fuera de `sandbox`, lo que hace que el guard de
agosto anule el token). Backup y restauración de `procurador_db_staging` obligatorios.

**Lo otro nuevo: S10 — módulo Markdown / anonimización.** Se agregó el 2026-08-26 al confirmarse que
1.2 se construye en la Etapa 1: cuando esta etapa corra, el módulo **va a existir**, y ningún bloque de
S1–S9 lo cubría. No es un descuido del plan SEC-2 original — se escribió el 24/08, cuando el módulo era
una decisión de negocio sin resolver. **El eje que aporta y que F5 del code-review no da:** F5 pregunta
*"¿el motor de anonimización está bien escrito?"*; S10 pregunta *"¿qué pasa si el PDF de entrada es
hostil?"* — el módulo descarga archivos desde URLs que salen del **documento**, no de nuestro código.

**🚨 Resolución de una contradicción real entre planes:** el bloque **S8 (fraude con cobro real)** del
plan SEC-2 exige que B3 esté cerrado, pero este roadmap pone la seguridad **antes** que MercadoPago.
No es un conflicto: es una partición. **S1–S7 + S9 + S10 corren en la Etapa 3; S8 corre dentro de la Etapa
4**, después del primer cobro real. Sin decirlo explícito, alguien da "SEC-2 ejecutado" por cerrado
con un bloque sin correr.

**Entregable de cierre de la etapa (no está en el plan original, se agrega acá):** un **informe
unificado** con los 10 bloques, sus hallazgos, los parches y las re-corridas de verificación, con fecha
y alcance. Es lo que se le muestra a un cliente institucional que pregunte por la auditoría, y el
punto de partida del auditor externo el día que se contrate.

---

## §6 — Etapa 4 — MercadoPago producción (B3)

| | |
|---|---|
| **Plan** | [`plan-mercadopago-produccion-2026-08-24.md`](plan-mercadopago-produccion-2026-08-24.md) (ya escrito, con datos medidos en vivo) |
| **Fases** | A (endurecimiento del código, Sonnet/alto) + B (trámite del operador, en paralelo) → **C (Opus/alto, con el operador presente — el switch y el primer cobro real)** → D (facturación, no bloqueante) → E (post-lanzamiento) |
| **Sesiones** | 3–5 |
| **Gate duro de entrada** | **F7 del code-review cerrada.** Es la fase que revisa la transacción atómica de `handlePaymentEvent` y la atribución de preapprovals por ventana de tiempo — lo único de la cadena de cobro que V7 no pudo verificar en runtime |
| **Después de la Fase C** | **S8 de SEC-2** (fraude con cobro real, Opus) + un code-review y un security-review **focalizados en el delta** que introdujo la Fase A |

**Lo que hay que tener presente al llegar acá** (medido el 2026-08-24, corrige creencias previas):
- `PAYMENT_MODULE_ENABLED` **ya está en `true`** en producción. El switch pendiente es reemplazar
  credenciales sandbox por reales, no encender el módulo.
- Los `MP_PLAN_*_ID` de producción **son de la cuenta sandbox**: sin recrearlos en la cuenta real, el
  checkout devuelve 500 para todos los planes apenas se cambie el token.
- **No hay ningún webhook registrado** en el panel de MP. Sin darlo de alta, ningún pago se acredita.
- **0 pagos, 0 facturas, 0 suscripciones con método de pago** en la base real. El radio de impacto del
  switch es nulo: no hay ningún cliente que se pueda romper.
- 🚨 **`.env.staging` va en el checklist:** `MP_ENV=production` **solo** en producción; staging queda
  en `sandbox`. Desde agosto hay un guard que falla cerrado si alguien sincroniza los dos archivos —
  pero no conviene depender de él.

**Un requisito de orden que no es técnico:** los TyC de la Etapa 1.3 (estado de beta + limitación de
responsabilidad) **tienen que estar publicados antes del primer cobro real**. Cobrarle a alguien con
términos que no reflejan que el producto está en prueba es exposición innecesaria y gratuita de evitar.

---

## §7 — Carril paralelo — AZ (Azure Trusted Signing)

| | |
|---|---|
| **Qué es** | Firma del instalador `.exe`. Sin esto, Windows SmartScreen advierte en **cada instalación nueva** |
| **Por qué arranca el día 0** | Certificate Profile demora **1-3 días hábiles**. No lo controlamos |
| **Pasos** | Cuenta Azure → Trusted Signing Account → Certificate Profile (Public Trust) → App Registration → 5 variables de entorno → configurar `electron-builder` |
| **Quién** | El trámite es del operador. La configuración de `electron-builder` es 1 sesión, Sonnet/bajo |
| **Beneficio colateral ya documentado** | El bloqueo de SmartScreen fue exactamente lo que trabó dos veces la instalación del auto-update durante las pruebas de F3.0 (el instalador quedaba en el escritorio seguro, invisible para cualquier automatización). Un instalador firmado elimina esa fricción también para el testing |

---

## §8 — Dependencias cruzadas que no son obvias

Las que este roadmap existe para hacer visibles. Cada una es un error concreto que se evita:

| # | Dependencia | Qué pasa si se ignora |
|---|---|---|
| **1** | **S8 de SEC-2 se ejecuta en la Etapa 4, no en la 3** | Se da "SEC-2 ejecutado" por cerrado con el bloque de fraude con dinero real sin correr |
| **2** | **La demo debe ser regenerable por script, no un set de PNG** | Las Etapas 2 y 3 cambian la UI **después** de armar la demo. En 11 días de agosto se publicaron 3 releases que cambiaron los visores y el topbar |
| **3** | **Todo lo que necesita escritorio real se agrupa en las mismas sesiones** | Ver §9. Eran 4 trabajos en 3 planes distintos; **desde el 2026-08-27 son 3** — las capturas de la demo se automatizaron con Playwright vía CDP y salieron de la lista |
| **4** | **F7 (cobranza) es el gate de B3, y va al final de la Etapa 2** | Correrla al principio y entrar a B3 ocho sesiones después obliga a revalidarla |
| **5** | **Los TyC de beta se publican antes del primer cobro real** | Se cobra con términos que no dicen que el producto está en prueba |
| **6** | ~~**1.3 (landing) y 1.6 (demo) tocan el mismo archivo**~~ — ✅ **resuelto**: 1.3 se cerró el 2026-08-26, así que 1.6 ya no compite con nadie por `landing/index.html` | (era: dos sesiones editando el mismo archivo en paralelo = conflicto) |
| **7** | **AZ arranca el día 0** | El lanzamiento queda esperando un trámite de 3 días que podría haber corrido en paralelo desde el principio |
| **8** | ~~**El módulo Markdown tiene su propio gate (M0) antes de M1**~~ ✅ **resuelto 2026-08-26** | Se construían 6 sesiones de módulo para descubrir recién ahí que los adjuntos necesitan sesión del PJN. **M0 se ejecutó y devolvió escenario A** — el riesgo no se materializó, y el arranque de 1.2 pasa a ser M1. En el camino apareció **una dependencia nueva hacia la Etapa 3**: la anonimización debe alcanzar a las URLs (fila 10) |
| **9** | **Lo que la Etapa 1 construye, las Etapas 2 y 3 tienen que revisarlo** | Es la dependencia que se destapó el 2026-08-26 al confirmar 1.1 y 1.2. El code-review ya la tenía cubierta (**F5** = módulo Markdown; **F1** declara depender de Etapa 1 porque F3.4 toca `routes/bitacora.js`). La seguridad **no**: SEC-2 se escribió el 24/08, cuando 1.2 todavía era una decisión de negocio sin resolver → se le agregó el bloque **S10**. Sin eso, se cierra la Etapa 3 con un módulo entero sin auditar, y encima el que más promete al usuario (*"esto no tiene datos personales"*) |
| **10** | **Un `.md` "anonimizado" con enlaces del SCW vivos entrega el original sin anonimizar** | Hallazgo de **M0** (2026-08-26): esos enlaces **no requieren login** y **no expiran** (≥27 días medidos). Si M4 no los trata, el módulo cumple su promesa solo en apariencia — y el usuario se entera después de mandar el archivo. La verificación es binaria (un grep de `viewer.seam`) y vive en **S10**, Etapa 3 |
| **11** | ~~**1.6 (demo) no puede capturar el capítulo de Markdown hasta que se corte el release de Electron**~~ — ✅ **resuelto el 2026-08-27**: release `electron-v2.7.51` publicado y `markdown_enabled=true` en COMBO_PROMO | (era: el binario instalado no tenía el botón). **Sigue habiendo un paso operativo para D3**: usar el build **2.7.51+**, no el `.exe` instalado del operador (que sigue en 2.7.50 hasta que el auto-updater lo alcance) — el `dist/win-unpacked/` local ya sirve |

---

## §9 — Las sesiones que necesitan al operador presente

**Cuatro trabajos distintos, en tres planes distintos, necesitan exactamente el mismo handle:** una
máquina con la app Electron lanzada desde la sesión de Windows que computer-use ve, y —para lo de
Chrome— un navegador real con la extensión cargada.

| Trabajo | De dónde viene | Qué necesita |
|---|---|---|
| **V4 + V5** (Electron sin/con PJN) | Etapa 2, fase F9 | computer-use con handle real de la app · V5 consume cupo del PJN |
| **V6** (extensión Chrome) | Etapa 2, fase F9 | Chrome real con la extensión + credenciales PJN |
| ~~**Capturas de la demo** (app Electron)~~ | ~~Etapa 1.6, bloque D3~~ | ✅ **YA NO** — ver la nota de abajo |
| **Capturas de la demo** (extensión + PJN) | Etapa 1.6, bloque **D4** | el operador saca las capturas a mano (~15 min) — **no es automatizable** |
| **Fase C de B3** (primer cobro real) | Etapa 4 | el operador completando un checkout real |

> ✅ **Actualización 2026-08-27 — las capturas de la app Electron salieron de esta lista.** Un spike
> verificó que **Playwright captura la app vía CDP**, reusando `tests/daily/electron_driver.py` (el
> driver que construyó el script de prueba diaria): `screenshot()`, viewport fijo, apertura de los 9
> modales por código y **sustitución de datos sensibles por sintéticos antes de capturar** — todo
> funcionando, sin computer-use y sin el operador. El diagnóstico de `notInstalled` de abajo sigue
> siendo correcto **sobre computer-use**; lo que cambió es que para este trabajo ya no hace falta.
> Detalle en §0.1 de [`plan-demo-producto-2026-08-26.md`](plan-demo-producto-2026-08-26.md).
>
> **V4/V5/V6 NO se destraban con esto** — son verificación *conducida* (clicks reales, diálogos
> nativos, la extensión en un Chrome real), no captura de pantallas. Siguen necesitando al operador.

**La causa del bloqueo, acotada (no es prioridad ni tiempo):** `request_access` de computer-use
devuelve `notInstalled` para "Procurador SCW" **incluso con la app abierta** — aislamiento de sesiones
de Windows: un proceso lanzado desde la shell vive en una sesión que la herramienta no ve. **Hay
precedente de que funciona**: el 2026-07-23 una sesión condujo la instalación NSIS completa con
computer-use. La condición se reproduce lanzando la app desde la sesión visible al agente.

**Recomendación:** agrupar V4 + V5 + las capturas de la app en **una sola sesión de operador**, con
la app ya abierta por él antes de empezar. V6 y las capturas de la extensión, en otra (necesitan
Chrome, no la app). Es la diferencia entre 2 sesiones coordinadas y 5 intentos sueltos que fallan por
el mismo motivo.

**Ya cerrado y no vuelve a pedirse:** **R9.1 / R9.2** — el operador confirmó el 2026-08-26 el login
del popup de la extensión y un flujo completo contra el PJN real. Con eso el Bloque R del plan de
pruebas integral queda **37/37, sin ningún caso abierto**.

---

## §10 — Estimación y qué queda para después del lanzamiento

| Etapa | Sesiones | Notas |
|---|---|---|
| **1** — Producto | ~~13–21~~ → **4–7 restantes** | ✅ 1.1, 1.3, 1.4 y 1.5 **cerrados** (2026-08-26/27). ⏳ **1.2 con el código M1-M6 completo — solo falta el release de Electron** (≈0,5 sesión, no las 6–10 originales). ⬜ Queda **1.6** (4–6) |
| **2** — Code review | **9–13** | 3 fases `xhigh` consumen sesión propia o más |
| **3** — Security review | **7–11** | S1+S2 y S3+S4 agrupables. Incluye **S10** (+1–2), agregado el 26/08 |
| **4** — MercadoPago | **3–5** | + S8 + los reviews del delta |
| **AZ** — paralelo | 1 + trámite | No suma al camino crítico |
| **Total aproximado** | ~~32–50~~ → **23–36 restantes** | Más las sesiones con operador presente de §9. Actualizado 2026-08-27 tras cerrar 1.1/1.3/1.4/1.5 |

**Después del lanzamiento** — son **exactamente estos tres** (sección "⚪ Post-lanzamiento" de
`CLAUDE.md`, que hasta el 2026-08-26 se llamaba "Diferidos a decisión de negocio" y tenía además a
1.1 y 1.2, hoy promovidos a la Etapa 1):

1. **L1 — Activar planes BASIC / PRO / ENTERPRISE.** Un `UPDATE` de una línea. Depende de que el
   cobro funcione y de decidir los precios finales.
2. **C1 — Contrato Facturante.** Facturación automática. El código ya existe (`utils/facturante.js`);
   falta contratar el servicio. **No bloqueante** — hoy el admin sube el PDF de ARCA a mano y funciona.
3. **L2 — Base de Conocimiento IA.** Alimentar el asistente con 20-30 tickets reales cerrados. Por
   definición no se puede hacer antes de tener clientes.

**Lo que ningún plan de este roadmap cubre**, dicho para que "roadmap ejecutado" no se confunda con
"producto terminado":

- **Pruebas de carga y concurrencia real** — nunca se hicieron. Cobran importancia con clientes reales.
- **Auditoría de seguridad externa profesional** — ver §8 del plan SEC-2 para qué reemplaza y qué no.
- **Soporte de otros navegadores y mobile real.**
- **La captación de clientes en sí** — hay un plan aparte (`docs/plan-captacion-clientes.md`) que este
  roadmap no toca.
