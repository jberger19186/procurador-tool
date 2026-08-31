# Plan de campaña `/code-review` integral — ProcuradorTool (2026-08-26)

> **Qué es esto.** El plan de ejecución de una campaña de `/code-review` sobre todo el
> proyecto, más los 3 bloques de `/verify` que quedaron bloqueados por el entorno
> (V4/V5/V6). **No es un informe de hallazgos** — no se revisó código para escribirlo;
> se midieron tamaños y fechas reales para poder priorizar.
>
> **Lugar en el proyecto:** es la **Etapa 2** de `docs/internal/roadmap-salida-a-mercado-2026-08.md`.
> Corre **después** de que las mejoras de producto de la Etapa 1 estén en el árbol
> (Bitácora F3.4 + módulo Markdown), y **antes** de la auditoría de seguridad (Etapa 3).
> Ese orden no es estético: revisar código que está por reescribirse es trabajo tirado,
> y auditar seguridad sobre una superficie que el code-review va a cambiar obliga a
> auditar dos veces.
>
> ✅ **Confirmado el 2026-08-26:** los ítems 1.1 (Bitácora F3.4) y 1.2 (módulo Markdown) de la Etapa 1
> **fueron aprobados por el operador** y se van a construir. Este plan ya lo asumía: **F5 es el módulo
> Markdown** y **F1 declara depender de Etapa 1 cerrada** porque el `.ics` de F3.4 toca
> `routes/bitacora.js`. No hay nada condicional que ajustar acá. (La contraparte de seguridad no
> estaba cubierta — SEC-2 recibió el bloque **S10** el mismo día.)
>
> 🔄 **Revisado el 2026-08-28, con la Etapa 1 ya cerrada.** Se midió el delta real (`git diff` desde el
> 2026-08-25: **136 archivos, +12.833 líneas**) contra los targets escritos acá. **Los que ya estaban
> apuntados bien no se tocaron** — F1, F2 y F4 cubren los tres archivos que más creció la Etapa 1
> (`bitacora.js` +238, `usuarios/app.js` +870, `dashboard.js` +458), y **la cadena de cobro no se
> modificó en una sola línea**, así que F7 queda exactamente como estaba. Lo que sí cambió: apareció
> código de servidor nuevo que **ningún target incluía** → fase **F10** nueva; F3 se quedó corta por un
> archivo que nació durante la Etapa 1; y F1/F5 se pudieron precisar ahora que el código existe.

---

## 0. Resumen ejecutivo

| | |
|---|---|
| **Fases** | **10** (F1–F8 + **F10** de `/code-review` + F9 de `/verify` en runtime) |
| **Modelo dominante** | Sonnet (6 de 9). **Opus en 2**: cadena de cifrado/firma de scripts (F6) y cobranza (F7). El motor de anonimización dentro de F5 también va en Opus. |
| **Esfuerzo dominante** | `xhigh` en las 4 fases de código grande y nunca revisado (F1, F2, F4, F10); `high` en 4; `medium` en 1 |
| **`ultra` (multi-agente en la nube)** | **Ninguna fase lo justifica hoy.** Ver §5 — se reserva como escalamiento de F7 si el code-review encuentra algo en el camino del dinero |
| **Sesiones estimadas** | **10–15**. Las 4 fases `xhigh` (F1, F2, F4, **F10**) consumen sesión propia y probablemente más de una; F9 depende del operador |
| **Depende de** | Etapa 1 cerrada (si no, F2/F3/F5 revisan código que va a cambiar) |
| **Habilita** | Etapa 3 (SEC-2, auditoría de seguridad) y — vía F7 — la Etapa 4 (MercadoPago producción) |

---

## 1. Qué ya está revisado y no se re-revisa

Esto existe para que la campaña no repita trabajo hecho. Tres pasadas previas dejaron
cobertura real:

| Campaña | Fecha | Qué cubrió | Estado |
|---|---|---|---|
| **E1–E6** (`plan-revision-integral-2026-07-27.md`) | 2026-07-27 | Motor Puppeteer, Electron `main.js`/`preload`/`src/`, los 11 crons, visores/Excel/onboarding, schema DB + distribución de scripts, frontends (grep dirigido) | ~35 hallazgos, **los ~35 corregidos y desplegados** (`plan-correcciones-E1-E6`, Bloques A–E) |
| **3 revisiones de bugs** | 2026-07-24 / 25 / 25b | Cobranza, cuotas, licencia, monitor · auth/admin/tickets/facturas/rate-limits · extensión Chrome, mailer, legal/analytics | 21 hallazgos, los 21 cerrados |
| **Campaña `/verify`** | 2026-08-23/24 | 7 de 10 bloques **ejecutando** el producto (portal, dashboard, API Bitácora, cobranza) | 4 bugs reales + 5 hallazgos, los 9 cerrados |

**Consecuencia práctica:** el motor Puppeteer (`backend-server/scripts/`) — que en julio era
la mayor superficie sin revisar del proyecto — hoy **ya tuvo su pasada (E1) y sus fixes
aplicados (Bloques C.1/C.2)**, y salvo un archivo no cambió desde entonces. Baja de
prioridad; no se omite (ver **F8**).

---

## 2. El hueco real, medido

Medición hecha el 2026-08-26 sobre el árbol real (`du -k` + `git log -1` por archivo),
no estimada:

| Área | Tamaño | Último cambio | ¿Revisión de código previa? |
|---|---|---|---|
| `public/dashboard/dashboard.js` | **348 KB** | 2026-08-27 | ❌ solo grep dirigido (E6) |
| `public/usuarios/app.js` | **256 KB** | **2026-08-28** | ❌ solo grep dirigido (E6) |
| `electron-app/renderer.js` | 180 KB | 2026-08-15 | ⚠️ parcial (solo handlers de lote) |
| `routes/admin.js` | **200 KB** | **2026-08-27** | ❌ **ninguna fase lo tenía como target hasta F10** — ver abajo |
| `electron-app/main.js` | 148 KB | **2026-08-26** | ✅ E2 — **pero cambió mucho después** |
| `backend-server/scripts/testM2.js` | 104 KB | 2026-07-28 | ✅ E1, **sin cambios desde entonces** |
| `routes/bitacora.js` | **92 KB** | **2026-08-26** | ❌ **nunca** |
| `services/subscriptionService.js` | 44 KB | 2026-07-24 | ⚠️ revisión de bugs, no code-review |
| `routes/capture.js` + `utils/captureDrafts.js` | 12 KB | 2026-08-26 | ❌ **nunca** — es el **único endpoint anónimo** del sistema |
| `utils/mercadopago.js` | 8 KB | 2026-08-24 | ❌ nunca (el guard de staging es nuevo) |
| `scripts/health-check.js` + `utils/healthAlertCheck.js` + `utils/dbIntegrityChecks.js` + `utils/verificationAlertCheck.js` | 28 KB | **2026-08-27** | ❌ **nunca — no existían** al escribirse este plan |
| `electron-app/monitor/generarVisorMonitoreo.js` | 20 KB | **2026-08-27** | ❌ **nunca — no existía** (extraído de `main.js` durante la Etapa 1.6) |

**El titular:** todo el módulo **Bitácora** (F1.1–F3.3, ~15 sub-bloques, 4 tablas nuevas,
~15 endpoints, el único endpoint anónimo del sistema, y el crecimiento de `usuarios/app.js`
hasta 256 KB) **se construyó entero después de la última revisión integral** y nunca tuvo una
pasada de código. Fue verificado *funcionalmente* (F3.0, 55/55 casos; V1a/V1b/V3 de `/verify`),
que es otra cosa.

**El segundo titular:** los 2 archivos más grandes del proyecto (`dashboard.js` 348 KB y
`usuarios/app.js` 256 KB) nunca tuvieron más que un `grep` dirigido a escapes de HTML, y
entre los dos concentran casi todos los `fix:` de UI que el operador detectó con el producto
ya en producción (5 en agosto, 4 detectados por él).

---

## 3. Zonas protegidas — regla dura para toda la campaña

Estas rutas se revisan **en modo solo lectura**. **Ningún `/code-review` sobre ellas puede
correr con `--fix`**, y ningún hallazgo se aplica sin que el operador lo apruebe línea por
línea:

- `backend-server/keys/` — claves RSA privadas
- `backend-server/certs/` — certificados
- `electron-app/src/security/` — cifrado, verificación de firma, autodestrucción
- Cualquier código de `machineId` / hardware binding (`src/auth/machineId.js`, el binding
  server-side de `routes/license.js`)
- Los campos `usage_count` / `usage_limit` y los `*_bonus` / `*_usage` en DB
- `extension-app/manifest.json` — un cambio de permisos dispara re-revisión de Google y
  puede tumbar la extensión publicada

> El precedente que justifica la regla: el plan Q6 cerró los 9 fail-opens de verificación
> de firmas **sin tocar una línea de `src/security/`** — se resolvió desde los llamadores.
> Esa disciplina se mantiene.

**Además:** las fases que tocan código servido a usuarios (F2, F4) no aplican `--fix` de
forma masiva. Se aplica por hallazgo, con despliegue staging → prod y verificación, igual
que cualquier cambio del proyecto.

---

## 4. Las fases

### F1 — Bitácora, backend completo 🔴

> ✅ **EJECUTADA 2026-08-31.** Informe: [`revision-F1-2026-08-31.md`](revision-F1-2026-08-31.md).
> **9 hallazgos, 7 corregidos y en producción, 2 documentados sin aplicar.** El más serio:
> `aplicarImport()` (el restore de un backup de Bitácora) ignoraba el parámetro `modo` en
> el bloque de historial — un import en modo **"combinar"** (el que la propia UI promete
> como no-destructivo) **borraba snapshots capturados después de exportar el backup**.
> Reproducido y confirmado con datos reales contra staging (capturar → exportar → capturar
> de nuevo → importar el backup viejo → el snapshot nuevo desaparecía), corregido para
> fusionar en vez de reemplazar, y reverificado con el mismo escenario (30/30 PASS). Otros
> 6: ids duplicados en un backup crasheaban el import (500) en vez de un 400 · 2 de 3
> queries de `recolectarDatosExport` sin filtro `user_id` (latente, no explotable hoy) ·
> N+1 de hasta 200 queries validando una lista de ids en el export por lote ·
> `POST`/`PUT` de entradas tratan `expediente_id:0` distinto entre sí · el helper `entero()`
> clampeaba ids/años en vez de rechazarlos. Documentados sin aplicar: la transacción de
> `aplicarImport` hace hasta 20.000 queries secuenciales (arquitectónico, bajo impacto real)
> y `checkBitacoraPlan` no re-chequea el status de la cuenta (mismo patrón que el resto del
> portal, no específico de Bitácora).

| | |
|---|---|
| **Target** | `backend-server/routes/bitacora.js`, `backend-server/routes/capture.js`, `backend-server/utils/captureDrafts.js`, `backend-server/middleware/checkBitacoraPlan.js`, `backend-server/utils/expedienteKey.js` |
| **Modo** | **path completo** (nunca tuvo revisión) |
| **Modelo / esfuerzo** | Sonnet · **`xhigh`** |
| **Depende de** | nada — puede arrancar apenas cierre la Etapa 1 |

**Por qué existe.** ~120 KB de código escrito íntegramente **después** de la campaña E1–E6,
con cero revisiones de código. Contiene las 3 cosas que más caro salen si tienen un bug
silencioso en este módulo:

1. **El único endpoint anónimo del sistema** (`POST /usuarios/capture`) — sin auth por
   diseño, con 5 protecciones documentadas y un almacén efímero en memoria.
2. **El gate de plan por sub-paths** (`checkBitacoraPlan`) — montado sobre el mismo prefijo
   que `routes/usuarios.js`; si el matching se rompe, 8 rutas vivas del portal quedan en 403.
   Ya se verificó funcionalmente (39/39 en F1.2, 29/29 en V3) pero nunca se leyó como código.
3. **`expedienteKey()`** — la normalización canónica que evita fichas duplicadas. Tiene
   **dos implementaciones** (backend + `tokenizar()` en Electron), sincronizadas únicamente por
   un fixture compartido de 15 casos. Un cambio en una sola de las dos es un bug silencioso
   con meses de latencia.

**Lo que la Etapa 1 le sumó, y conviene mirar con atención** *(agregado el 2026-08-28)*: `bitacora.js`
creció **+238 líneas** con el Bloque B de F3.4 — la **serialización `.ics`**, que es 100 % manejo de
fechas **en el único módulo del proyecto que ya produjo 3 bugs reales de timezone en producción**
(P-F3.0-a). Su plan (`plan-f3-4-semana-e-ics-2026-08.md` §B.2) enumera las 6 trampas y todas se
atendieron; esta fase es el primer ojo externo sobre esa implementación. Se sumó también el **export
por lista de ids** (`?expediente_id=3,7,12`), que amplía la superficie de IDOR de ese endpoint: cada id
se valida por separado y los ajenos se descartan en silencio — verificar que ese "en silencio" no
esconda un caso donde un id ajeno sí pase.

**Qué NO cubre:** el ángulo adversarial del endpoint anónimo (desalojo del almacén FIFO,
abuso de volumen). Eso es **S1 de SEC-2** (Etapa 3), que además ya tiene 2 hallazgos
detectados ahí (H-2, H-3).

**Por qué Sonnet y no Opus:** no toca dinero ni la cadena de integridad de scripts. El riesgo
es de corrección, no de superficie crítica — y el ángulo de seguridad tiene su propia etapa.

---

### F2 — Portal de usuarios (frontend) 🔴

| | |
|---|---|
| **Target** | `backend-server/public/usuarios/app.js` (+ `index.html`, `app.css` como contexto) |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | Sonnet · **`xhigh`** |
| **Depende de** | Etapa 1 cerrada (Bitácora F3.4 toca este archivo) |

**Por qué existe.** 256 KB, modificado hoy, y **el archivo con peor historial de
defectos-detectados-en-producción del proyecto**: de los 5 commits `fix:` que tocaron
`public/usuarios/` en agosto, **4 los encontró el operador con el producto ya en producción**
— ese dato es literalmente lo que motivó la campaña `/verify`. `/verify` encontró después
2 bugs más ahí (doble submit en 6 formularios). La conclusión honesta es que este archivo
falla por debajo del radar de todo lo que se le aplicó hasta ahora.

**Sugerencia de partición** (si el target completo resulta inmanejable): dos pasadas —
(a) Bitácora + Mis Expedientes + captura, (b) el resto (login, plan, facturación, tickets,
notificaciones, perfil, ayuda). No partir por líneas: partir por sección funcional.

**Qué NO cubre:** el render real en navegador. Eso ya lo hicieron V1a/V1b de `/verify`, y
lo que quede se cubre en F9.

---

### F3 — Visores y captura del lado cliente 🟠

> ✅ **EJECUTADA 2026-08-31.** Informe: [`revision-F3-2026-08-31.md`](revision-F3-2026-08-31.md).
> **9 hallazgos, los 9 corregidos — 6 son XSS reales**, confirmados no leyendo el código
> sino ejecutando las funciones generadoras reales con datos adversariales y parseando
> el HTML resultante con **parse5** (motor real de HTML5). **2 disparan sin ningún
> click, solo con abrir el visor**: `</script>` breakout vía `JSON.stringify()` sin
> escapar (en `generador_visor.js` y `generarVisorMonitoreo.js` — vector que
> `esc()`/`escAttr()` no cubren, porque actúan sobre contexto HTML, no sobre el límite
> del propio `<script>`) y `exp.ultimaAct` sin ningún escape en la tabla principal del
> visor de procuración. Otros 3: el `title` de carátula usa `esc()` en vez de
> `escAttr()` en **2 de los 4 generadores de visor** (`visor_informes_template.html`,
> que ni definía `escAttr()`; `generarVisorMonitoreo.js`, que la define y usa
> correctamente 10 líneas más arriba pero se olvidó acá — el mismo archivo que la
> revisión de julio había señalado como "ya escapaba correctamente", con el concepto
> `escAttr()` introducido en esa misma sesión y nunca reaplicado retroactivamente) ·
> `exp.error` sin escapar en el modal · `mov.viewHref` sin ningún escape en un `href`.
> Más 1 hallazgo de inyección de fórmulas Excel (sin `sanitizeExcelCell()`, patrón que
> el proyecto ya tiene en otro generador) y 1 crash (`expediente.toLowerCase()` sin
> guard, deja el visor entero sin buscador/filtros ante una sola fila malformada).
> **Sin verificación de staging posible** (son archivos de cliente) — verificado con
> 16/16 en un harness que ejecuta las funciones reales + parse5, incluida no-regresión.
> ⚠️ El informe recomienda **priorizar el próximo release** dado que, a diferencia de
> F6, varios de estos son explotación activa confirmada, no solo defensa en profundidad.

| | |
|---|---|
| **Target** | `electron-app/visorModal_template.html`, `electron-app/informe/visor_informes_template.html`, `electron-app/informe/generador_visor.js`, `generador_excel.js`, `buscarPdfExpediente.js`, `motivoInformeSinPDF.js`, **`electron-app/monitor/generarVisorMonitoreo.js`** *(agregado 2026-08-28)*, y los bloques de post-procesado/captura de `electron-app/main.js` |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | Sonnet · **`high`** |
| **Depende de** | nada |

**Por qué existe.** Criterio de "código frágil señalado por el operador": el 2026-08-26 el
operador reportó **21 hallazgos** probando el flujo real de captura desde el visor
(`plan-fixes-visor-bitacora-2026-08-26.md`) — navegación rota, estado "guardado" no reflejado,
pestañas acumulándose, carátula vacía en el flujo de informe. Los 21 se corrigieron (B0–B4,
release v2.7.50), **pero un volumen así de hallazgos en una sola sesión de uso es la señal más
fuerte de código frágil que dio el proyecto este mes**, y el rediseño que los corrigió todavía
no tuvo ninguna pasada de revisión.

Incluye además la superficie que E4 marcó como confirmada: la interpolación de datos del PJN en
los visores. El fix de escape (`esc()`/`escAttr()`) se aplicó en el Bloque D de julio, pero los
visores se rediseñaron enteros después.

**Por qué se sumó `generarVisorMonitoreo.js`** *(2026-08-28)*: es el **cuarto generador de visor** y
hasta la Etapa 1 no era un archivo — vivía inline dentro de `main.js`, y se extrajo (323 líneas,
copiadas byte a byte) durante D2 de la demo, porque `main.js` hace `require('electron')` en su primera
línea y eso hacía imposible reusar la función desde un script Node plano. El target original de esta
fase nombraba los otros tres generadores; este quedó afuera solo porque no existía como archivo cuando
se escribió el plan. **Atención puntual:** es el único de los cuatro que ya escapaba correctamente
antes del fix de julio (E4 lo señaló como el contraejemplo positivo) — confirmar que la extracción no
perdió eso por el camino.

---

### F4 — Dashboard admin 🟠

> ✅ **EJECUTADA 2026-08-31.** Informe: [`revision-F4-2026-08-31.md`](revision-F4-2026-08-31.md).
> **El hallazgo que motivó la fase se descartó** (los 37 `showConfirm`/`showPrompt` del
> archivo usan `await` correctamente). En su lugar, **13 hallazgos reales, los 13
> corregidos y en producción** (1 mitigado sin tocar el backend, fuera de alcance). El más
> serio: **XSS almacenado en 16 `onclick`** — un email autoregistrable con un apóstrofe
> (válido por RFC 5322, sin validación de formato en el registro público) rompía un
> string-literal JS embebido en el atributo y ejecutaba con la sesión del admin. Verificado
> con `parse5` que **ni `escAttr()` alcanza** para este contexto — el navegador decodifica
> las entidades HTML antes de compilar el atributo como JS, así que hace falta escapar
> primero para sintaxis JS y recién después para HTML (`escJsAttr()` nueva). Otros 2 de
> peso: 22 sitios con el mismo error en `value=""` (ahí sí `escAttr()` es la función
> correcta) y un `<textarea>` de edición de Términos/Privacidad que corrompía cada salto de
> línea real del documento legal en cada edición (`escHtml()` usado en un contexto RCDATA).

| | |
|---|---|
| **Target** | `backend-server/public/dashboard/dashboard.js` (+ `dashboard.css` como contexto) |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | Sonnet · **`xhigh`** |
| **Depende de** | nada |

**Por qué existe.** 348 KB, el archivo más grande del proyecto, y **una migración masiva muy
reciente sin revisión de código**: VF-3 reemplazó **71 diálogos nativos en 30 funciones** el
2026-08-24. Esa migración se verificó por script (0 sitios nativos restantes) y navegando las
12 secciones, pero la clase de bug que introduce es exactamente la que un script no ve: **un
`await` faltante convierte un `confirm()` migrado en un no-op silencioso que sigue de largo**.
El informe de esa sesión dice que las 30 funciones ya eran `async` — eso reduce el riesgo, no
lo elimina (el riesgo que queda es un `showConfirm()` cuyo resultado no se mira).

Segundo motivo: es el panel donde un admin **suspende cuentas, aplica beneficios, edita pagos
y publica documentos legales**. Un bug acá no lo sufre el admin, lo sufre un cliente.

📌 **Hallazgo ya identificado, para arrancar la fase con algo concreto** *(AG · A3, 2026-08-30)*:
**`submitAddUser` dispara el `POST /admin/users` con todos los campos vacíos** y sin mostrar ningún
error del lado del cliente. Medido: `{"nombre":"","apellido":"","email":"","password":"","cuit":""}`.
El servidor valida y devuelve 400, así que no es un problema de corrección ni de seguridad — es una
llamada innecesaria y un admin que no ve por qué no pasó nada. 🔵 bajo. La pregunta que la fase debe
responder no es esa sola, sino **cuántos de los ~30 handlers de guardado del dashboard comparten el
patrón**: `submitAddUser` construye el body, deshabilita el botón y llama a la API, sin ninguna
validación previa en el medio.

⚠️ **Y un falso positivo ya descartado, para no gastar la fase en él:** la misma auditoría reportó
falta de protección contra **doble envío** en el dashboard. **No es cierto, y se midió** — corriendo
su propio script de reproducción (`btn.click(); btn.click();`) sale **1 POST, no 2**: el botón queda
`disabled` de forma síncrona antes del `await`, y un `<button disabled>` no dispara `click`. Además
el dashboard **no tiene un solo `<form>` ni un listener de `submit`** (todo es `onclick`), así que
no existe la segunda vía por la que ese bug sí era real en el portal (fixes `354fbcc` y `f5d1348`).

---

### F5 — Módulo Markdown / Anonimización (código nuevo) 🟠

| | |
|---|---|
| **Target** | *(fijado el 2026-08-28, con el módulo ya construido)* `electron-app/markdown/anonimizar.js` (541 líneas) · `extraerPdfAMarkdown.js` (312) · `descargarAdjuntos.js` (358) · los **3 handlers IPC** de `electron-app/main.js` (`select-markdown-pdf`, `procesar-markdown-pdf`, `reprocesar-markdown-mapping`) · el modal y su lógica en `index.html`/`renderer.js`/`preload.js` · y el gate de plan (`plans.markdown_enabled` → `GET /client/account`) |
| **Modo** | **diff / branch** (código nuevo, no hay historia que revisar) |
| **Modelo / esfuerzo** | **partido**: motor de anonimización → **Opus · `high`** · resto del módulo (UI, ingesta, descargas, gating) → Sonnet · `high` |
| **Depende de** | Etapa 1.2 terminada |

**Por qué el motor va en Opus.** Es el caso de libro de "bug silencioso con alto radio de
impacto": el usuario va a **confiar** en que el `.md` anonimizado no tiene datos personales y
lo va a compartir. Un nombre que el motor no detecta no produce ningún error visible — produce
una fuga que el usuario descubre después de haber mandado el archivo. Eso pesa más que el
tamaño del código.

**Qué debe mirar sí o sí:** falsos negativos del regex de nombres (acentos, nombres compuestos,
apellidos con partículas, mayúsculas/minúsculas, nombres embebidos en otras palabras), el orden
de aplicación de reglas (una regla que corre después de otra puede no encontrar nada porque la
primera ya reemplazó), y que el reprocesamiento en memoria parta siempre del **original** y no
del ya anonimizado (aplicar dos veces = enmascarar el enmascarado).

**Punto de partida, para no re-descubrir lo ya resuelto** *(2026-08-28)*: los tres primeros puntos de
arriba **ya se atacaron durante M4** y tienen tests — el orden de aplicación es por longitud
descendente (con el caso `DAMIAN HORACIO Isl### Mat###` documentado como el que lo motivó), y la suite
del módulo da **94/94** con una tasa de falsos negativos medida de **0,0 %** sobre su corpus. Lo que
esta fase aporta no es repetir eso: es el ojo externo sobre **el corpus mismo** (¿mide lo que dice
medir, o está construido a la medida del motor?) y sobre las dos limitaciones que M4 dejó escritas y
sin corregir a propósito — el número de boleta de deuda que sobrevive, y la dependencia de que el
usuario revise el `mapping.txt`. El ángulo de **input hostil** no es de esta fase: es **S10** de SEC-2.

🔄 **REVISADO EL 2026-08-30 — la pregunta central de esta fase YA SE RESPONDIÓ, y la respuesta fue
que sí.** El carril paralelo **AG** corrió su fase A0 (Gemini 3.1 Pro / High) justamente sobre el
corpus, y encontró que **estaba construido a la medida del motor**: el corpus original sí probaba
un apellido con partícula (`MARIA DE LA FUENTE`), pero **solo por el camino de la carátula**, que lo
toma entero y funciona bien. Por el camino del **marcador de rol**, el mismo nombre se filtraba.
Mismo dato, dos caminos, resultados opuestos.

**5 defectos reales encontrados, los 5 corregidos el mismo día** — todos con la misma dirección de
falla, y era la peor posible: **el motor enmascaraba los nombres de pila y dejaba pasar el
apellido**, que es la parte que identifica.

| # | Defecto | Causa raíz |
|---|---|---|
| 1 | Apellido con partícula en un **tercero** | El conector (`DE`/`DEL`/`LA`) cortaba la captura tras el marcador de rol |
| 2 | Apellido tras 2+ nombres de pila | El honorífico `DR.` consumía uno de los 4 lugares del presupuesto de tokens |
| 3 | **Parte** escrita sin tildes en el cuerpo | El reemplazo era sensible a acentos, y el PJN a veces las omite |
| 4 | Apellido partido por guión de corte | No se rejuntaban los fragmentos entre líneas |
| 5 | Tercero **fantasma** en el `mapping.txt` | Sin límite de palabra, `DR` matcheaba dentro de `ADRIAN` |

Los 5 quedaron **fijados como tests de regresión**: el corpus pasó de 18 a **22** datos que deben
desaparecer y de 8 a **10** textos que deben sobrevivir, ambas tasas en 0,0 %. La suite del módulo
sigue en **94/94**.

**Consecuencia para esta fase — el eje se corre, no desaparece.** Ya no tiene sentido plantearla
como *"auditar el corpus"*: eso se hizo y se corrigió. Lo que queda es:

1. **Verificar los 5 fixes, no re-derivarlos.** En particular el más delicado: permitir que los
   conectores no corten el nombre **quitó un freno accidental** contra la captura desbocada en
   prosa, y hubo que reponerlo con otra regla (un token que arranca en minúscula cierra el nombre).
   Esa interacción merece un ojo fresco.
2. **El resto del módulo, que A0 no tocó** — ingesta de PDF, descarga de adjuntos, los 3 handlers
   IPC, el modal y el gate de plan. Sigue sin revisión externa.
3. Las 2 limitaciones que M4 dejó escritas a propósito (boleta de deuda, dependencia de que el
   usuario revise el `mapping.txt`), que siguen abiertas.

**Y una lección de método que vale para toda la Etapa 2:** de los 5 defectos, **2 los encontró la
inspección manual de la salida real, no un test** — el sobre-enmascarado de `dijo algo` y el tercero
fantasma. Es el mismo patrón que M4 ya había documentado. Los tests confirman lo que uno ya sabe
buscar; leer la salida es lo que muestra lo que no.

---

### F6 — Cadena de cifrado y distribución de scripts 🔴 **Opus** — *pedido explícito del operador*

> ✅ **EJECUTADA 2026-08-31.** Informe: [`revision-F6-2026-08-31.md`](revision-F6-2026-08-31.md).
> Harness versionado en [`backend-server/dev-tools/verify-f6-cadena-cifrado.js`](../../backend-server/dev-tools/verify-f6-cadena-cifrado.js)
> — **144 PASS / 0 FAIL** contra staging tras corregir el único punto que fallaba.
> **La respuesta a la pregunta del operador es sí**: los 13 scripts se cifran, se firman y se
> verifican correctamente, y hay **cero drift** entre repo, staging y producción.
> **5 hallazgos**, ninguno en el cifrado en sí: **F6-1** (`/scripts/check` quedó fuera de la
> whitelist de P-1 y exponía el hash de los 7 no distribuibles — corregido y **en producción**)
> · **F6-2** (la etapa 2 se auto-certificaba desde la 2ª ejecución de cada sesión, confirmado
> con el verifier real) · **F6-3** (la etapa 3 verificaba el `.enc` y dejaba sin verificar el
> **wrapper**, que es lo que `fork()` ejecuta) · **F6-4** (el 3er call site que C6/F5 de Q6 no
> alcanzó: una dependencia con firma rechazada se salteaba en silencio) · **F6-5** (P-1 es
> estructural: `processScripts` ingesta todo `.js` como activo — apareció `health-check.js`, así
> que ya no son "los 6 filtrados" sino 7; documentado, sin aplicar). Los 3 del cliente
> **esperan release de Electron**. **Cero líneas tocadas en `src/security/`.**

| | |
|---|---|
| **Target (revisión)** | `backend-server/utils/scriptEncryption.js`, `backend-server/reencrypt_scripts.js`, `backend-server/routes/client.js` (`/scripts/download`, `/check`, `/available`), `electron-app/src/auth/authManager.js` (las 3 etapas de verificación) |
| **Target (SOLO LECTURA, sin `--fix`)** | `backend-server/src/security/scriptSigner.js`, `signatureCache.js`, `electron-app/src/security/*` |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | **Opus** · `high` |
| **Depende de** | nada — pero conviene correrla temprano (ver §5) |

**Por qué existe.** El operador pidió explícitamente *"verificar que los scripts se encripten
correctamente"*. Es la cadena que protege el activo central del producto (la automatización) y
la que decide si un script adulterado llega a ejecutarse en la máquina del cliente. El plan Q6
cerró 9 fail-opens ahí en agosto — este es el primer ojo sobre el resultado.

**Esta fase no es solo lectura: incluye una verificación ejecutable.** Un review que diga "el
código parece correcto" no responde la pregunta del operador. El entregable incluye un harness
que, **contra staging**:

1. Descarga los **13 scripts de la whitelist** con un JWT real.
2. Descifra cada uno con la clave real y **verifica la firma RSA**.
3. Compara el hash del descifrado contra `encrypted_scripts.hash` en la DB.
4. Compara el descifrado contra el `.js` fuente del repo → detecta **drift entre lo desplegado
   y lo versionado** (riesgo real y con antecedente: el `reencrypt_scripts.js` tocó producción
   por error el 2026-07-28 por el bug de `dotenv` sin path).
5. Confirma que los **6 scripts filtrados por la whitelist siguen dando 404** (`backup-db.js`,
   `reset-admin-password.js`, `data-retention.js`, `canary-test.js`, `test_registro.js`,
   `validarCampoParteScwpjn.js`) — el hallazgo P-1 de E5.
6. Confirma que **ningún script se sirve sin bloque `security`** (el fix C1/F9 de Q6, Fase 1).

**Regla de la fase:** cualquier hallazgo dentro de `src/security/` se documenta y se corrige
**desde el llamador**, como hizo Q6. Nada de `--fix` ahí.

---

### F7 — Cobranza 🔴 **Opus** — *gate duro de la Etapa 4*

| | |
|---|---|
| **Target** | `backend-server/routes/checkout.js`, `routes/webhooks.js`, `services/subscriptionService.js`, `services/invoiceService.js`, `utils/mercadopago.js`, y los crons de cobro/vencimiento de `server.js` |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | **Opus** · `high` |
| **Depende de** | nada, pero **debe estar cerrada antes de la Fase C de B3** |

**Por qué existe y por qué Opus.** Único criterio que aplica sin discusión: dinero real. Hoy
todo apunta al sandbox, así que un bug no cuesta nada; el día que B3 cambie las credenciales,
el mismo bug cobra o deja de cobrar de verdad.

**Lo que ya está cubierto y NO hay que rehacer:** V7 de `/verify` ejercitó 40/40 aserciones en
runtime contra staging el 2026-08-24 (gate de activación, guard B3 de mismatch de plan, HMAC en
5 variantes incluida la positiva, idempotencia de `webhook_events`, fixes B1/B2 vigentes, los 3
guards de reactivación, la doble protección de los crons de corte).

**Lo que V7 declaró explícitamente NO cubierto — y que es exactamente lo que esta fase debe
mirar como código, porque no se puede ejercitar sin una persona pagando:**

- La **transacción atómica de `handlePaymentEvent`** (fix M4): sus piezas se verificaron, su
  composición dentro del `BEGIN/COMMIT` no. El `ROLLBACK` ante fallo intermedio nunca se ejerció.
- **`markPaymentConfigured` / `reconcileClaimedCheckout`** — la atribución del preapproval **por
  ventana de tiempo**. Es lo más delicado de toda la cadena y tiene un riesgo aceptado y
  documentado desde junio: *colisión si dos usuarios pagan en la misma ventana de minutos*.
  Con 0 clientes eso es teórico; con clientes reales es una acreditación cruzada.
- **`updatePreapprovalAmount`** (cambio de plan → monto en MP).

**Escalamiento posible:** si esta fase encuentra algo real en la atribución por ventana, es la
única candidata razonable a repetirse en `ultra`. Ver §5.

---

### F8 — Motor Puppeteer, solo el delta 🟢

| | |
|---|---|
| **Target** | `backend-server/scripts/informequickscwpjn.js` — y cualquier otro `scripts/*.js` con cambios posteriores al 2026-07-28 |
| **Modo** | **diff** contra el estado revisado por E1 (2026-07-27) + Bloques C.1/C.2 |
| **Modelo / esfuerzo** | Sonnet · **`medium`** |
| **Depende de** | nada |

**Por qué existe (y por qué es de las últimas).** Aplica el criterio de *superficie ya cubierta
por una revisión reciente y sin cambios desde entonces → bajar de prioridad, no omitir*. Medido:
de los 18 archivos de `backend-server/scripts/`, **17 no cambiaron desde el 2026-07-28** (la
fecha de los fixes de E1). El único que sí cambió es `informequickscwpjn.js` (2026-08-26, el fix
B4 de carátula del flujo de informe).

Revisar de nuevo `testM2.js` (104 KB) o `procesarNovedadesCompleto.js` (48 KB) sin que hayan
cambiado sería repetir E1 — el error que este plan existe para evitar.

---

### F10 — Backend admin y observabilidad 🔴 *(fase nueva, agregada 2026-08-28)*

> ✅ **EJECUTADA 2026-08-31.** Informe: [`revision-F10-2026-08-31.md`](revision-F10-2026-08-31.md).
> **Los 4 módulos de observabilidad y el cron de `server.js` están bien diseñados, sin
> hallazgos.** El trabajo real estuvo en `admin.js`. **19 hallazgos, los 19 corregidos.** El
> más consecuente, encontrado en la revisión manual (no por los agentes): **el JWT del admin
> nunca tuvo `email`** — confirmado en producción que `verification-results.json` tenía
> `reportedBy: null` en TODAS las entradas, y que `usage_adjustments.admin_email` (varchar)
> recibía el ID numérico del admin en 3 sitios, no su email. El segundo, de mayor impacto de
> negocio: **suspender o rechazar un usuario pago nunca pausaba el cobro real en
> MercadoPago** — confirmado grepeando todo el backend que `pausePreapproval()` nunca se
> llamaba desde `/suspend` ni `/reject`; un cliente suspendido seguía siendo cobrado
> indefinidamente. Su contraparte simétrica también estaba rota: reactivar nunca reanudaba
> el preapproval pausado (se agregó `resumePreapproval()`, función nueva en
> `subscriptionService.js`). Otros de peso: **path traversal** al subir el PDF de una
> factura (`req.params.invoiceId` sin sanitizar en el nombre de archivo de multer) · **XSS
> almacenado** en el visor de logs de diagnóstico · un `PUT /plans/:planId` que borraba la
> promo de un plan en cualquier update parcial · una reasignación silenciosa de facturas ya
> vinculadas a otro pago · el selector "Estado de registro" del dashboard, que flipeaba 5 de
> sus 7 destinos sin ningún efecto secundario (ni MP, ni email, ni auditoría). **Verificado
> con un harness E2E real contra staging (25/25 aserciones, HTTP real + estado real de la
> DB)** para los hallazgos más complejos, y tests standalone de la lógica extraída del
> archivo real para los 2 de seguridad. Desplegado a staging→prod, md5 verificado en los 4
> archivos, smoke 200, sin errores nuevos.

| | |
|---|---|
| **Target** | `backend-server/routes/admin.js` (200 KB) · `backend-server/scripts/health-check.js` · `backend-server/utils/healthAlertCheck.js` · `backend-server/utils/dbIntegrityChecks.js` · `backend-server/utils/verificationAlertCheck.js` · el cron nuevo de `server.js` (`0 12 * * *`, alerta de verificación) |
| **Modo** | **path completo** en `admin.js`; los otros son archivos chicos y nuevos |
| **Modelo / esfuerzo** | Sonnet · **`xhigh`** (por el tamaño de `admin.js`) |
| **Depende de** | nada |

**Por qué existe, y por qué no estaba.** Son dos huecos que se destaparon al revisar este plan contra
lo que construyó la Etapa 1:

1. **`routes/admin.js` no era target de ninguna de las 9 fases originales.** Es el archivo backend más grande del
   proyecto (200 KB) y la tabla de §2 lo listaba como "revisión parcial", pero ninguna fase lo tomaba:
   F4 cubre `dashboard.js`, que es el **frontend** del panel, no su backend. Era un hueco preexistente
   —no lo creó la Etapa 1—, pero la Etapa 1 le sumó **+553 líneas** y lo volvió imposible de seguir
   difiriendo.
2. **Hay código de servidor nuevo que no existía cuando se escribió este plan:** `health-check.js`
   (295 líneas) corre **desatendido por crontab a las 08:00**, hace 7 chequeos de solo lectura sobre
   producción y **manda emails**; sus dos helpers deciden cuándo alertar y cuándo callarse; y el cron
   nuevo de `server.js` hace lo mismo para la verificación contra el PJN.

**Lo que hay que mirar con más atención dentro de `admin.js`:**

- 🚨 **La vía nueva de otorgar cupo.** `POST /admin/diagnostics/verification/quota/top-up` (Etapa 1.5,
  F2) es lo único que se construyó en agosto que **crea usos de la nada**. Está diseñado con cuidado —
  el `user_id` no se toma del cliente sino que se resuelve server-side por CUIT, hay techo duro por
  submódulo, cooldown de 5 recargas por ventana móvil de 24 h, y auditoría en `admin_events` — pero
  **esas 7 protecciones nunca se leyeron como código**, solo se verificaron por harness (18/18). Un
  bug ahí no es un bug de diagnóstico: es una vía de cupo gratis dentro del panel más privilegiado.
- **Los otros 3 endpoints de diagnóstico** (`verification/report`, `verification/latest`,
  `health-check/latest`), que escriben y leen archivos JSON en `data/` desde un router HTTP.
- **El resto del panel**, que es donde un admin suspende cuentas, aplica beneficios comerciales, edita
  pagos y publica documentos legales. Vale el mismo argumento que justifica F4: **un bug acá no lo
  sufre el admin, lo sufre un cliente.**

**Lo que hay que mirar en el código de observabilidad:**

- Que un chequeo que falla **no pueda tumbar el proceso ni el cron** (corre sin nadie mirando).
- La **deduplicación de alertas por episodio** — el mecanismo que evita que un mismo error mande 21
  emails idénticos. Si se rompe hacia el lado silencioso, la alerta deja de existir sin que nadie lo
  note, que es peor que no tenerla.
- Que los chequeos de integridad referencial y de disco/RAM sean **estrictamente de solo lectura**.
- Que ningún dato de cliente termine en el cuerpo de un email de alerta.

**Qué NO cubre:** el ángulo adversarial (¿puede un no-admin llegar acá?) — eso es SEC-1 (authz admin,
verificado y no re-testeado) y el barrido de S9. Y el **frontend** del panel, que es F4.

---

### F9 — `/verify` V4 + V5 + V6 (runtime, con el operador) 🟠 **no es un `/code-review`**

| | |
|---|---|
| **Qué es** | Los 3 bloques de `docs/internal/plan-verificacion-runtime-2026-08-23.md` que quedaron **bloqueados por el entorno, no por prioridad**. Los playbooks ya están escritos ahí — esto es ejecución, no diseño. |
| **V4** | Electron **sin** PJN — computer-use, no consume cupo · 🟡 |
| **V5** | Electron **con** PJN (5 flujos reales) — computer-use + credenciales · **consume cupo** · 🔴 |
| **V6** | Extensión Chrome (5 flujos) — Chrome real + credenciales · **consume cupo** · 🔴 |
| **Modelo / esfuerzo** | Sonnet · medio (V4/V6) — **Opus no hace falta**: ningún bloque toca cobro |
| **Depende de** | **el handle del entorno** (ver abajo) y de que F1–F5 hayan aplicado sus fixes |

**Por qué siguen abiertos, con la causa acotada (no es prioridad ni tiempo):**

- **V4/V5** — `request_access` de computer-use devuelve `notInstalled` para "Procurador SCW"
  **incluso con la app abierta**; es el aislamiento de sesiones de Windows ya documentado en la
  sesión de F3.1 (un proceso lanzado desde la shell vive en una sesión que la herramienta no ve).
  **Precedente de que sí se puede:** el 2026-07-23 la sesión de R2.1 condujo la instalación NSIS
  completa con computer-use sin problema — la condición existe, hay que reproducirla (app lanzada
  desde la sesión visible al agente, no desde la shell).
- **V6** — `list_connected_browsers` devuelve `[]`: no hay Chrome conectado por la extensión
  Claude-in-Chrome, así que no hay camino a un navegador real con la extensión del PJN cargada.

**Ajuste de alcance de V6 respecto del plan original:** **R9.1 / R9.2 ya están cerrados** — el
operador confirmó el 2026-08-26 el login del popup y un flujo completo contra el PJN real. Eso
era la mitad *funcional* de V6. Lo que queda es la parte estructurada: los 5 flujos con
aserciones, los gates por plan desde la extensión, y el manejo de errores — más una **revisión
de código de `extension-app/`** (~10 archivos chicos; solo tuvo la pasada parcial de D5 en julio),
que conviene hacer en la misma sesión.

---

## 5. Orden de ejecución y por qué

```
   F6 ─┐  cifrado de scripts (Opus) — temprano: si algo está roto acá,
       │  cambia la prioridad del proyecto entero
       │
   F1 ──┤  Bitácora backend         ─┐
   F3 ──┤  visores / captura         │
   F4 ──┤  dashboard admin (front)   │  paralelizables entre sí:
   F10 ─┤  admin backend + salud     │  tocan archivos distintos
   F2 ──┘  portal de usuarios       ─┘
       │
   F5 ─┤  módulo Markdown (código ya existente desde el 2026-08-27)
       │
   F8 ─┤  delta del motor Puppeteer (barato, cierra el círculo)
       │
   F7 ─┤  COBRANZA — Opus ── gate duro ──► habilita Etapa 4 (B3)
       │
   F9 ─┘  /verify V4+V5+V6 ── requiere operador ── DESPUÉS de que
          los fixes de F1–F5 y F10 estén desplegados
```

**Las tres decisiones de orden que importan:**

1. **F6 va primero aunque no sea la más grande.** Si la cadena de cifrado tiene un problema real,
   deja de tener sentido revisar features: cambia la prioridad del proyecto entero. Además es la
   más barata de las dos fases Opus.
2. **F7 va al final de la campaña, no al principio.** No porque sea menos importante — es la más
   importante — sino porque su valor es servir de **gate inmediato a B3**: si se corre primero y
   después pasan 8 sesiones de campaña, hay que revalidarla. Correrla último la deja fresca al
   entrar a la Etapa 4.
3. **F9 va después de los fixes, no antes.** Verificar en runtime un producto al que le faltan los
   arreglos de F1–F5 y F10 produce hallazgos que se corrigen solos al aplicar esos fixes.

**Dónde entra F10** *(2026-08-28)*: es paralelizable con el grupo del medio —no comparte un solo
archivo con F1/F2/F3/F4— así que no altera el orden ni suma tiempo al camino crítico salvo por su
propio esfuerzo. Si hubiera que priorizar dentro del grupo, va **después de F1** (comparten el criterio
de "backend nunca revisado" y F1 es la superficie más expuesta) y **antes de F2/F4**, que son los dos
barridos más largos.

**Sobre `ultra`:** ninguna fase lo justifica de entrada. Es una revisión multi-agente en la nube,
es cara, y **la enciende el operador** (no se puede lanzar desde una sesión). El único caso donde
lo recomendaría es **una segunda pasada de F7** si la primera encuentra algo concreto en la
atribución de pagos por ventana de tiempo — ahí el radio de impacto (acreditar el pago de un
cliente a la cuenta de otro) paga el costo.

---

## 6. Lo que esta campaña NO cubre

Dicho explícitamente para que "campaña ejecutada" no se confunda con "proyecto revisado":

- **Seguridad adversarial** — es la Etapa 3 (`plan-seguridad-lanzamiento-2026-08.md`, SEC-2 +
  Strix). Un `/code-review` busca bugs; una auditoría busca a alguien atacando.
- **Pruebas de carga / concurrencia real** — nunca se hicieron en todo el proyecto. Cobran
  importancia real recién con MercadoPago en producción.
- **`electron-app/src/security/`** — se lee, no se audita su lógica interna (zona protegida).
- **El primer pago real de punta a punta** — requiere una persona en el checkout. Es la Fase C de
  B3, no esto.
- **Otros navegadores / mobile real** — sigue sin cubrirse, igual que declaraba §7 del plan de
  `/verify`.

---

## 7. Prompts de arranque

**F1** (adaptar el target por fase):

```
/code-review xhigh backend-server/routes/bitacora.js backend-server/routes/capture.js backend-server/utils/captureDrafts.js backend-server/middleware/checkBitacoraPlan.js backend-server/utils/expedienteKey.js
```

> Contexto para la sesión: leer §4/F1 de `docs/internal/plan-code-review-integral-2026-08-26.md`
> y §3 (zonas protegidas). Este código nunca tuvo revisión. Atención especial al gate por
> sub-paths y a que `expedienteKey()` tiene una segunda implementación en Electron
> (`tokenizar()` en `buscarPdfExpediente.js`) sincronizada solo por
> `tests/fixtures/expediente-key-cases.json`.

**F6** (la que además ejecuta):

> Ejecutá la fase F6 de `docs/internal/plan-code-review-integral-2026-08-26.md` — cadena de
> cifrado y distribución de scripts. **Opus, esfuerzo alto.** Incluye el harness de verificación
> ejecutable de los 6 puntos de la fase, corrido **contra staging** (nunca prod).
> `electron-app/src/security/` y `backend-server/src/security/` son solo lectura: los hallazgos
> ahí se corrigen desde el llamador o se documentan, jamás con `--fix`.

**F10** (Sonnet, `xhigh`):

> Ejecutá la fase **F10** de `docs/internal/plan-code-review-integral-2026-08-26.md` — backend admin y
> observabilidad. Empezá por `POST /admin/diagnostics/verification/quota/top-up` y sus 7 protecciones:
> es lo único del panel que **crea cupo de la nada** y nunca se leyó como código, solo se verificó por
> harness. Después el resto de `admin.js` con el criterio de F4 (un bug acá lo sufre un cliente, no el
> admin), y al final el código de observabilidad, donde lo que más importa es que la deduplicación de
> alertas no se rompa hacia el lado silencioso.

**F7:**

> Ejecutá la fase F7 de `docs/internal/plan-code-review-integral-2026-08-26.md` — cobranza.
> **Opus, esfuerzo alto.** Leé primero `docs/internal/verify-V7-2026-08-24.md` para no repetir lo
> ya verificado en runtime, y concentrate en los 3 puntos que V7 declaró NO cubiertos.
