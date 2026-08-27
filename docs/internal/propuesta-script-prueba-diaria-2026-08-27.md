# Propuesta — llevar la prueba diaria a un script

> **Estado:** propuesta, NO aprobada, sin código escrito.
> **Fecha:** 2026-08-27 · **Autor:** sesión de diseño (Opus, solo análisis).
> **Origen:** pedido del operador tras la corrida manual del 2026-08-27, para
> aprovechar la experiencia de esa corrida (documentada en `CLAUDE.md`, entrada
> "cont. 18") en vez de repetirla a mano cada vez.

---

## 1. Veredicto

**Es viable, y bastante más de lo que parecía** — pero no por el camino obvio.

El camino obvio (automatizar los clicks que hoy hace computer-use) sería frágil
y caro. El camino real es otro: **los flujos son invocables directamente desde
el renderer**, sin tocar un solo modal, diálogo nativo ni coordenada.

Y de paso permite **sumar un 6to flujo que hoy no se corre**: la consulta inicial
del Monitor, el camino de onboarding de un cliente nuevo (§6.6).

La consecuencia práctica es grande: **las 3 trampas operativas que hoy dominan la
corrida manual desaparecen por completo**, porque ninguna aplica cuando no hay
clicks por coordenada:

| Trampa documentada hoy | ¿Sigue aplicando con el script? |
|---|---|
| `request_access` devuelve `notInstalled` (índice de apps congelado) | **No** — no se usa computer-use |
| Todo comando `Bash` roba el foreground y el click siguiente cae en la ventana equivocada | **No** — no hay clicks |
| Chrome roba el frente en cada visor/PDF y su tier "read" rechaza los clicks | **No** — los visores pueden abrirse y no molestan |

---

## 2. El hallazgo que lo hace viable

`preload.js` expone el bridge IPC en `window.electronAPI`, y **ese objeto es
alcanzable desde `page.evaluate()` por CDP**. Los 5 flujos tienen entrada directa
con argumentos:

| # | Flujo | Llamada | Verificado en |
|---|---|---|---|
| 1 | Procuración | `runProcessCustomDate(fecha)` | `preload.js:24` |
| 2 | Procuración por lote | `runProcessCustom({ lines, fechaLimite })` | `preload.js:25` · `renderer.js:3348` |
| 3 | Informe individual | `runInforme({ expediente, configInforme })` | `preload.js:108` · `renderer.js:2949` |
| 4 | Informe por lote | `runInforme({ batchLines, configInforme })` | `preload.js:108` · `renderer.js:2940` |
| 5 | Monitor — novedades | `runMonitoreo({ modo: 'novedades', partes })` | `preload.js:152` · `renderer.js:3967` |
| **6** | **Monitor — consulta inicial** *(nuevo, §6.6)* | `runMonitoreo({ modo: 'inicial', partes })` | `preload.js:152` · `renderer.js:3934` |

**Por qué esto importa tanto:** el diálogo nativo de archivos era el bloqueante
aparente de los 2 flujos por lote. Pero `select-batch-file` (`main.js:1963`) solo
sirve para **llenar una variable del renderer** (`informeBatchLines`,
`renderer.js:2865`) que después se le pasa a `runInforme`. Si le pasamos las
líneas nosotros, **el diálogo nunca se abre**. Lo mismo para `runProcessCustom`,
que ya recibe `lines` directamente.

> Esto también evita el otro camino posible, que era mucho peor: stubear
> `dialog.showOpenDialog` desde el proceso principal. Eso exige la API
> `playwright.electron` de **JS**, que **no existe en Python** — y el propio
> `tests/conftest.py:167` ya lo dice textualmente. Con este enfoque no hace falta.

---

### ✅ Sí — el script reporta a "Verificación funcional (PJN real)"

Pregunta del operador, confirmada: el script **postea al mismo endpoint que se usó
a mano hoy**, `POST /admin/diagnostics/verification/report`, con los 6 flujos y su
estado (`ok` / `error` / `omitido`). O sea, **la tarjeta del dashboard se
actualiza igual que en una corrida manual** — cambia cómo se corre, no qué se
informa ni dónde se ve. Eso es parte de **F1**, y por eso F1 entrega valor incluso
si los flujos se siguen corriendo a mano.

También sigue alimentando el historial de la tarjeta y `ultimaVezOk` por flujo, y
por lo tanto la alerta por email con deduplicación por episodio (Etapa 1.5 F4).

---

## 3. Lo que ya existe y se reusa (no se parte de cero)

Este es el segundo motivo por el que la propuesta es barata:

- **`tests/conftest.py::electron_app`** — fixture que ya lanza la app con
  `--remote-debugging-port=9222`, espera el puerto, conecta Playwright por
  `chromium.connect_over_cdp()` y **hace auto-login**. Funciona hoy.
- **`tests/desktop/test_m10_electron.py`** — 13 casos (J-01 a J-13) que ya
  conducen la app por ese fixture. O sea: la parte difícil está resuelta y
  probada desde el Módulo 10.
- **La cuenta ya es la correcta:** `tests/helpers/auth.py:35` usa
  `procuradortool@gmail.com` con la contraseña desde `QA_TEST_USER_PASSWORD`
  (env var, tras la limpieza de seguridad del 2026-08-27) — **exactamente la
  cuenta de verificación** que usa la prueba diaria.
- **Marker `electron` en `pytest.ini`** — ya separa estos tests del resto.
- **`dev-tools/batch-verificacion.txt`** — el fixture de expedientes ya está
  versionado.
- **Los endpoints de cupo y reporte** ya existen y están probados (Etapa 1.5).

---

## 4. Mapa honesto: qué se automatiza y qué no

| Paso de la corrida | Hoy | Con el script |
|---|---|---|
| Verificar cupo | 1 script Node subido por `scp` | ✅ automático |
| Recargar cupo si falta | ídem | ✅ **automático** (decisión del operador, ver §6.1) |
| Verificar partes con línea base | consulta SQL a mano | ✅ automático |
| Lanzar la app + login | computer-use, ~6 round-trips | ✅ fixture existente |
| Correr los 5 flujos | ~25 clicks + 2 diálogos nativos | ✅ 5 llamadas |
| Esperar cada flujo | `wait` de duración adivinada | ✅ espera por estado real |
| Leer resultados | screenshots + zoom | ✅ lectura de `descargas/` |
| Reportar al dashboard | script Node subido por `scp` | ✅ automático |
| Cerrar la app | PowerShell | ✅ automático |
| **Cerrar las pestañas de Chrome** | ❌ imposible (tier "read") | ❌ **sigue siendo del operador** |

**Lo que el script NO puede resolver, y hay que decirlo:**

1. **El perfil de Chrome con las credenciales del PJN.** Es estado de la máquina,
   creado a mano una vez. El script lo consume, no lo puede fabricar.
2. **Las pestañas de los visores.** Se abren (decisión del operador del
   2026-08-27) y las cierra él. El script las **enumera** al terminar.
3. **Distinguir "falló el producto" de "falló el PJN".** El 2026-08-12 un
   expediente agotó sus 5 reintentos por **degradación de red**, no por un bug —
   y se diagnosticó porque el backend propio también daba timeouts. El script
   puede recolectar esa señal (§6.3), pero el juicio final sigue siendo humano.

---

## 5. Dónde vive

**Recomendación: `tests/daily/`**, en Python, reusando el fixture existente.

El razonamiento, porque el operador propuso `tests/` y conviene explicitar por
qué encaja:

- `tests/` es **100% Python** (21 archivos `.py`, 0 `.js`) y ahí está el fixture
  de Electron que resuelve la parte difícil. Ponerlo en `electron-app/test/` (que
  es JS) obligaría a reescribir ese fixture desde cero en otro lenguaje.
- Un subdirectorio propio (`tests/daily/`) lo separa de los tests de regresión:
  **esto no es un test unitario, es un procedimiento operativo** que consume cupo
  real y golpea el PJN.
- Entrada de una línea: `python tests/daily/run.py` (o `pytest -m daily`), para
  que el operador no tenga que recordar flags.

#### 🚨 El guard, en criollo

`pytest` es el corredor de tests del proyecto: al ejecutarlo **busca solos todos
los archivos que parezcan un test y los corre**. Hoy eso es inofensivo — son
tests que no tocan nada real.

Si metemos la prueba diaria ahí sin protección, pasa esto: alguien (o el CI)
corre `pytest` para verificar cualquier otra cosa, y **sin querer dispara la
prueba diaria completa**: abre la app, entra al PJN, corre los 5 flujos y **gasta
cupo real** — que es escaso y acotado. Peor: reporta al dashboard una corrida que
nadie pidió.

**El guard es simplemente marcar esta prueba como "no correr salvo que te la
pidan explícitamente".** En pytest eso se hace con un *marker* (una etiqueta) más
una línea en `pytest.ini` que dice "por defecto, todo menos lo etiquetado
`daily`":

```ini
markers =
    daily: prueba diaria REAL contra el PJN — consume cupo, solo bajo pedido
addopts = -m "not daily"
```

Con eso: `pytest` a secas **la saltea siempre**, y solo corre si la pedís por su
nombre (`pytest -m daily` o el script de entrada). Es una red de seguridad de dos
líneas contra un error que costaría cupo real y un reporte falso.

---

## 6. Riesgos y decisiones abiertas

### 6.1 ✅ RESUELTO — el script recarga cupo solo

**Decisión del operador (2026-08-27): sí, automático.** El razonamiento: el
administrador pide la prueba diaria y el código se ejecuta; pedirle además que
apruebe la recarga es fricción sin valor, porque ya decidió correr la prueba.

**Por qué es seguro dejarlo automático** — la recarga no es una vía libre, sigue
acotada por las protecciones que ya existen:

- **`VERIF_TECHO_BONUS = 200`** acumulado por submódulo, **no se resetea nunca**.
  Es el techo real y el script no lo mueve.
- **Tope por llamada** (`VERIF_MAX_SUMA_POR_LLAMADA`), y cada recarga suma **solo
  lo que falta** para la reserva de 2 corridas — no un monto fijo.
- **5 recargas por ventana móvil de 24 h.** Una corrida diaria usa como mucho 1.
- **`ya_alcanza` no consume lugar**, así que correr el script con el cupo sano no
  gasta nada.
- **Auditoría en `admin_events`** en cada recarga efectiva.
- El endpoint **resuelve la cuenta server-side por CUIT** — el script no puede
  apuntarlo a otro usuario ni aunque quisiera.

**Lo único que el script sí debe hacer:** **informar** en la salida cuándo recargó
y cuántas recargas quedan (`recargasRestantes`, que el endpoint ya devuelve). Que
sea automático no significa que sea invisible.

⚠️ **Consecuencia a tener presente:** si el script queda desatendido (F4) y falla
en loop, podría consumir las 5 recargas del día. Es otra razón para **no arrancar
F4 hasta tener varias corridas asistidas** (ver §7).

### 6.2 🚨 No hay lock de instancia única — y `CLAUDE.md` dice que sí

`grep` sobre `electron-app/*.js` **no encuentra `requestSingleInstanceLock`**.
`CLAUDE.md` afirma lo contrario ("el single-instance lock de Electron mantuvo una
sola sesión real corriendo") — esa frase es una **inferencia de una sesión previa,
no un hecho verificado**, y conviene corregirla.

**La consecuencia es real:** si el operador tiene la app instalada abierta y el
script lanza otra instancia desde código, **las dos comparten
`%APPDATA%\procurador-electron`** — misma config, misma sesión, misma carpeta de
descargas. Eso puede producir resultados cruzados o pisados.

**Mitigación:** el script verifica que no haya ningún proceso `Procurador SCW`
corriendo y aborta si lo hay, con instrucción de cerrarlo. Barato y elimina la
clase entera de problema.

### 6.3 Distinguir fallo del PJN de fallo del producto

Antes de marcar `error`, el script debería recolectar la misma evidencia que se
usó a mano el 2026-08-12: latencia de `api.procuradortool.com/health` y de
`scw.pjn.gov.ar`. Si el backend propio también está lento, es red — y el flujo va
como `omitido` con nota, no como `error`. **El tercer estado `omitido` ya existe
en el modelo de datos** (Etapa 1.5 F1), justamente para esto.

### 6.6 ✅ APROBADO — sumar "Monitor — consulta inicial" como 6to flujo

**Pedido del operador (2026-08-27), y cierra un hueco real.** Hoy la prueba diaria
**no ejercita la consulta inicial**, que es **el flujo que usa un cliente nuevo en
su onboarding** — anotado como no cubierto en §9 del plan de la Etapa 1.5 y sin
correrse desde el **2026-07-23** (más de un mes).

**Es barato:** verificado en `routes/monitor.js:788` que la consulta inicial
**NO consume cupo** (`if (modo === 'novedades' && !error)`, con el comentario
explícito *"La consulta inicial (línea base) NO consume"*).

#### ⚠️ Pero borrar DON COCHO no es el camino — solo funcionaría una vez al mes

La idea del operador era: borrar la parte "FCR DON COCHO", correr la consulta
inicial para reconstruirla, y después buscar novedades. **La intuición sobre cuál
parte es correcta** — medido hoy, DON COCHO es la **única** de las 3 que el
endpoint deja borrar:

| Parte | Edad | ¿Borrable por el endpoint? |
|---|---|---|
| DON COCHO | 1 mes 4 días | ✅ sí (pasó los 30 días) |
| LA TOSTADORA MODERNA | 29 días | ❌ no |
| ALVAREZ MARTA FABIANA | 2 días | ❌ no |

El problema aparece en la **segunda** corrida. La regla de `routes/monitor.js` es:
se puede borrar **dentro de las primeras 24 h** o **después de 30 días**; en el
medio está bloqueado. Al recrear DON COCHO hoy, la parte nueva nace con edad 0 →
mañana ya tiene 24 h + y **queda bloqueada 29 días más**. O sea: el truco anda
hoy y después **no anda hasta dentro de un mes**, salvo forzando por SQL.

Además tiene 2 efectos colaterales: destruye la línea base real de una parte que
el operador usa (si la consulta inicial falla a mitad, queda sin base), y deja la
búsqueda de novedades de esa parte en **0 por construcción**.

#### ✅ La alternativa: una parte descartable, creada y borrada en la misma corrida

1. Crear una parte de prueba (nombre distinto de las 3 reales — hay un **409 si se
   repite nombre+jurisdicción entre partes activas**, `routes/monitor.js:243`).
2. Correr **consulta inicial** sobre ella → ejercita exactamente el camino de
   onboarding: login → búsqueda por parte → paginado → línea base escrita.
3. **Borrarla por el endpoint** — permitido, porque tiene minutos de vida y cae
   dentro de la **gracia de 24 h**.

Ventajas sobre borrar DON COCHO, todas concretas:

- **Repetible todos los días**, no una vez al mes.
- **No toca las 3 partes reales** ni sus líneas base.
- **Usa solo endpoints legítimos** — no hace falta forzar nada por SQL.
- **Cupo: 0** (la inicial no consume).
- **Residuo: 0** — ocupa 1 de 20 slots de `monitor_partes` por ~2 minutos.

#### ✅ RESUELTO — la parte descartable es DON COCHO

**Decisión del operador (2026-08-27).** Y encaja mejor de lo que parecía: el
problema de repetibilidad que describí arriba **desaparece si la parte se borra al
final de la misma corrida**, porque así nunca envejece. Cada corrida es
`crear → inicial → (novedades) → borrar`, siempre dentro de la gracia de 24 h.

**Setup, una sola vez:** borrar la DON COCHO real que existe hoy (id 118, creada
el 2026-07-23, con línea base de 115 expedientes). El endpoint lo permite —
justamente porque pasó los 30 días.

**Secuencia recomendada dentro de la corrida** (importa el orden):

1. **Crear** la parte `FCR / DON COCHO`
2. **Flujo 6 — consulta inicial** sobre ella → construye la línea base
3. **Flujo 5 — buscar novedades** sobre **las 3** (incluida la recién creada)
4. **Borrar** DON COCHO

> 💡 **Por qué novedades va DESPUÉS y sobre las 3, y no sobre las 2 estables:**
> una parte recién baselineada debe dar **0 novedades**. Si diera 115, significa
> que la consulta inicial **no escribió la línea base** — o sea, el paso 3 es una
> **verificación de integridad gratis del paso 2**, no solo un flujo más. Y de
> paso mantiene el consumo en el modelo ya documentado (`monitor +3`), sin tener
> que recalibrar el chequeo de consumo esperado.

**Lo que hay que aceptar, dicho explícito:**

- **DON COCHO deja de ser una parte monitoreada de verdad.** Su línea base se
  reconstruye y se descarta en cada corrida. Es una cuenta de prueba, así que el
  costo real es nulo — pero conviene saberlo.
- **La corrida se alarga ~1-1,5 min**: la consulta inicial de DON COCHO recorre
  **115 expedientes**. No consume cupo, pero sí tiempo.
- Ocupa 1 de los 20 slots de `monitor_partes` durante esos minutos.

#### 💡 Hallazgo relacionado: hoy el flujo de novedades siempre da 0

No es parte del pedido, pero surge del mismo análisis y conviene decirlo: como las
3 partes tienen su línea base al día, **"Buscar Novedades" reporta `0 novedades`
en todas las corridas**. Eso confirma que el flujo *corre*, pero **nunca ejercita
la detección de novedades ni la generación de sugerencias de F3.3** — que es el
diferencial mayor de Bitácora.

La técnica para ejercitarlo ya está documentada (sesión de F3.3): **borrar 1-2
filas de la línea base** hace que la próxima corrida las redetecte como novedades,
con datos genuinos del PJN. Queda como **candidato opcional para F2**, no incluido
por defecto: es más invasivo y merece decisión aparte.

### 6.7 ✅ Los 2 caminos conviven — el manual NO se elimina

**Decisión del operador (2026-08-27).** Dos frases de disparo distintas:

| Lo que pide el operador | Qué corre |
|---|---|
| «**corré la prueba diaria de la app**» | El **script** (`tests/daily/`) |
| «**corré la prueba diaria de la app con computer use**» | El **procedimiento manual** de `CLAUDE.md` |

**No es redundancia, el manual sigue siendo necesario por 3 razones concretas:**

1. **Es el único que verifica el `.exe` empaquetado.** El script lanza desde
   código (§6.4), así que no ejercita rutas de `resources/` ni `isPackaged`.
2. **Es el fallback cuando el script se rompe.** Si un cambio de la app mueve un
   selector o una firma de IPC, el manual sigue andando mientras se arregla.
3. **Ya está escrito y probado.** Borrarlo para "limpiar" sería tirar la red de
   seguridad justo cuando se estrena la automatización.

El paso 6.a de `CLAUDE.md` (procedimiento manual) queda **tal cual**, y se le
agrega arriba una nota de una línea aclarando cuál de las dos frases lo dispara.

### 6.4 Desde código vs. el `.exe` instalado

El fixture existente lanza **desde código** (`node_modules/.bin/electron.cmd`).
Eso ejercita los mismos scripts encriptados y el mismo PJN, así que **para el
propósito de la prueba diaria es equivalente** — lo que no verifica es el
empaquetado (rutas de `resources/`, `isPackaged`), que se valida en el release.

El spike debe probar si `"Procurador SCW.exe" --remote-debugging-port=9222`
funciona: si sí, es estrictamente mejor y se usa eso.

### 6.5 Esperas

Nada de `sleep` de duración adivinada. El renderer ya emite eventos de proceso
(`process-finished`, `informe-batch-complete`) y `setProcessRunning()` mantiene
estado. El script espera por **esa** señal, con un timeout duro por flujo.

---

## 7. Plan por fases

> Las fases están ordenadas para que **cada una entregue valor sola**. Si el
> proyecto se detiene después de F1, F1 ya ahorra trabajo real.

### F0 — Spike / gate técnico ✅ EJECUTADO (2026-08-27) — las 4 preguntas responden GO

**Modelo: Sonnet · Esfuerzo: bajo · Sin escribir código de producto.** Corrido
contra el `.exe` instalado (v2.7.50), conectando por CDP con Playwright (Python
`sync_api`, el mismo motor que ya usa `tests/conftest.py`). **No se disparó
ningún flujo real** — solo llamadas IPC de solo lectura (`getAppVersion`,
`verifySession`), así que no consumió cupo.

**1. ¿`window.electronAPI` es alcanzable desde `page.evaluate()` por CDP?**
**✅ SÍ, confirmado.** `contextBridge` lo publica incluso en `login.html` (antes
de loguearse) — se listaron los **85 métodos** expuestos, incluidos los 5 de
ejecución (`runProcess`, `runProcessCustomDate`, `runProcessCustom`, `runInforme`,
`runMonitoreo`) más los de Monitor (`monitorAgregarParte`, `monitorEliminarParte`,
etc., que hacen falta para el flujo 6 de §6.6).

**2. ¿Una llamada IPC devuelve la promesa resuelta a `evaluate()`?**
**✅ SÍ.** `await window.electronAPI.getAppVersion()` devolvió `"2.7.50"` limpio
dentro del propio `evaluate()` — confirma que el patrón `await ipc(...)` funciona
igual desde Playwright que desde el renderer real, sin necesitar `onXxx` como
único mecanismo de espera.

**3. ¿El `.exe` instalado acepta `--remote-debugging-port`?**
**✅ SÍ.** `Procurador SCW.exe --remote-debugging-port=9222` respondió CDP real
(`Electron/43.1.0`, `Chrome/150.0.7871.47`) en ~4 segundos. **Se usa el `.exe`
instalado, no el lanzamiento desde código** — verifica lo que el usuario final
corre, no una aproximación (cierra §6.4 a favor de la opción más fuerte).

**4. ¿Conviven dos instancias o hay colisión de `userData`?**
**⚠️ CONFIRMADO EL RIESGO — conviven, y colisionan en silencio.** Se lanzó una
segunda instancia (`--remote-debugging-port=9223`) con la primera todavía
arriba: **no hubo lock, arrancó sin error**, los procesos pasaron de 4 a 8
(el modelo multiproceso de Electron ×2 ventanas), y **ambos puertos CDP
respondieron de forma independiente** — coincide exacto con el `grep` de código
del 2026-08-27 (`requestSingleInstanceLock` no existe en `electron-app/*.js`).

Lo nuevo que aportó el spike: **el mecanismo exacto de la colisión.** Un
marcador escrito en `localStorage` de la instancia 1 **no apareció** en la
instancia 2 — a primera vista parecería "perfiles aislados", pero **no lo son**:
en disco hay un solo directorio `procurador-electron/` (no se creó un perfil
alternativo) y **sin ningún `SingletonLock`**. La explicación real: Chromium no
pudo tomar el lock exclusivo de LevelDB que la instancia 1 ya tenía abierto sobre
`Local Storage/`, así que la instancia 2 **cayó a almacenamiento en memoria sin
avisar** — sus escrituras nunca llegan a disco y se pierden al cerrarla. **Es un
modo de falla más peligroso que un choque limpio**, porque no da ningún error:
si el script corriera con la app real ya abierta, podría operar sobre un estado
que jamás se persiste, sin que nada lo señale.

**Entorno cerrado limpio:** ambas instancias cerradas con `CloseMainWindow()`,
0 procesos residuales, `config_proceso.json` sin tocar (mismo timestamp de la
sesión anterior — confirma que el spike no escribió nada).

**Gate: PASA — F1 puede arrancar.** El único punto que exige diseño (no cambia
el veredicto) es la pregunta 4: **F3 debe llevar el guard de instancia única de
§6.2 como control de entrada obligatorio**, verificado ahora con evidencia real
del modo de falla que previene, no solo por lectura de código.

---

### F1 — Pre-vuelo, reporte y cierre (sin GUI) ✅ EJECUTADA (2026-08-27)

**Modelo: Sonnet · Esfuerzo: bajo-medio.** Código real en `tests/daily/` (no
diseño — 9 archivos, ver el `README.md` del propio directorio para el mapa
completo). Reemplaza las ~6 llamadas manuales con `scp` de scripts temporales
de la corrida de hoy por 3 comandos: `preflight.py` (cupo + partes),
`cierre.py` (leer resultados + reportar + cerrar), `run.py` (los dos
encadenados con una pausa para la corrida manual en el medio).

**Simplificación real encontrada al construirla, no anticipada en el diseño:**
el token que arma `tests/helpers/auth.py::get_admin_token()` (ya existente,
reusado tal cual) **funciona directo contra `https://api.procuradortool.com`
desde la máquina local** — sin túnel SSH por cada llamada. Solo hace falta SSH
una vez, para mintear el token; todo lo demás (`GET quota`, `POST top-up`,
`GET /monitor/partes`, `POST report`) es `requests` normal. Esto tira abajo el
80% del baile de subir-y-borrar scripts temporales que documentaba el
procedimiento manual — la limitación de "no se puede mandar por curl desde la
máquina local" no era del token, era de cómo se firmaba antes.

**Verificado de punta a punta contra producción real** (sin correr ningún
flujo — cupo consumido: 0):
- `preflight.py`: cupo real leído (`alcanzaParaUnaPrueba=True`,
  `alcanzaParaReserva=True`, sin necesitar recarga) + las 3 partes con línea
  base listadas correctamente.
- `cierre.py`: **reusó los visores reales de la corrida manual de esta misma
  mañana** (sesión "cont. 18") para probar el parseo + reporte end-to-end sin
  gastar cupo de nuevo. El reporte posteado coincidió **exacto** con lo que se
  reportó a mano esa mañana (proc 2/2, batch 2/2, informe individual OK,
  informe por lote 2/2, monitor 3/3 con 0 novedades) — confirmado leyendo
  `GET /admin/diagnostics/verification/latest` después.
- Guard de instancia única (§6.2): probado con una instancia real corriendo —
  `assert_no_instance_running()` la detectó y abortó con el mensaje correcto;
  y pasó limpio con 0 procesos.
- `list_chrome_tab_titles()`: probado con una pestaña real de Chrome abierta —
  la detectó por título; y con Chrome sin ventanas visibles, devolvió vacío
  sin romper.
- `pytest -m daily tests/daily/` → **1 passed**. `pytest` sin filtro →
  **0 selected, 1 deselected** (el guard de `pytest.ini` funciona). El resto
  de la suite sigue colectando igual: **154/155**, sin romper nada.

**🐛 1 bug real encontrado y corregido en el camino — no en una prueba
sintética, en el primer visor real que se intentó parsear:** el extractor de
`const datosEmbebidos = {...}` usaba una regex que tolera 1 nivel de objetos
anidados (mismo criterio simplificado que usa `generador_visor.js` del lado
de Electron, para SU propio problema más chico). El visor real de Procuración
tiene **3+ niveles** (`expedientes[].movimientos[].{...}`), así que la regex
cortaba a mitad de camino y `json.loads` fallaba en silencio — los flujos
`proc`/`batch` se reportaban como `omitido` con cupo real ya consumido en la
corrida de esta mañana. Corregido con un extractor que cuenta llaves
balanceadas carácter por carácter (respetando strings/escapes), no una regex
con tope fijo. Verificado contra los 5 archivos reales tras el fix: los 5
parsean `ok` con el detalle exacto.

**Hallazgo menor, documentado y no bloqueante:** el backend
(`routes/admin.js`) solo distingue `origen: 'app-automatica'` vs. cualquier
otra cosa, que cae a `'computer-use'` — el `'script-daily'` que manda este
módulo se pisa en silencio. Las `notas` sí quedan tal cual, así que el origen
real sigue siendo legible en el detalle. Ampliar la whitelist queda como
candidato de F3, no de F1.

**Valor solo, confirmado:** convierte el ceremonial de pre-vuelo y cierre en
un comando, incluso si los flujos se siguen corriendo a mano. **Sigue siendo
la fase con mejor relación valor/riesgo de todo el plan — y ya está en el
repo, funcionando.**

---

### F2 — Conducción de los 6 flujos ✅ EJECUTADA (2026-08-27), con corrida real 6/6 OK

**Modelo: Sonnet · Esfuerzo: medio-alto.** Código real: `electron_driver.py`
(lanza el `.exe`, conecta CDP, resuelve login), `flujos.py` (los 6 flujos vía
`window.electronAPI`, con los shapes exactos de cada IPC handler leídos de
`main.js`/`renderer.js` antes de escribir una línea, no adivinados), y
`ejecutar.py` (el orquestador: preflight → los 6 flujos → cierre/reporte de
F1). No reusa `tests/conftest.py::electron_app` tal cual — ese fixture lanza
desde `node_modules` (código), y F0 concluyó que corresponde usar el `.exe`
real acá.

**🐛 2 bugs reales de arquitectura encontrados y corregidos ANTES de gastar
cupo, en el smoke de conexión:**

1. **`greenlet.error: Cannot switch to a different thread`.** El primer
   diseño usaba la Playwright **sync API** con un timeout manual vía
   `ThreadPoolExecutor` (mismo patrón usado sin problemas en scripts sueltos
   de esta sesión). Rompió: la sync API de Playwright simula sincronía con
   greenlets atados al hilo que abrió la conexión — no admite invocarse desde
   un hilo worker distinto. Se migró todo el driver a la **async API** de
   Playwright + `asyncio.wait_for()`, que resuelve el timeout sin cruzar
   threads.
2. Encoding de consola (mismo problema ya visto en F0/F1, repetido en los 2
   scripts de diagnóstico ad-hoc que se usaron para reconectar a mitad de
   la corrida).

**🐛 1 bug real de calibración, encontrado a mitad de una corrida real (no en
una prueba sintética) — y NO fue un fallo del producto:** el flujo 2
(Procuración por lote) excedió el timeout de 180s que se le puso inicialmente
y Python se desconectó reportando error. **La app, mientras tanto, siguió
corriendo sola y terminó bien**: un expediente disparó el sistema de
reintentos propio del producto (`"hard 1"`: cierra Chrome, relanza, reintenta)
porque un selector del PJN tardó en aparecer — el lote completo dio **2/2
exitosos a los 241s**, 61s más que el timeout que lo cortó. Se reconectó por
CDP a la sesión ya viva (sin relanzar — el guard de instancia única lo habría
impedido, y no hacía falta: la app seguía corriendo normal) para confirmar el
estado real antes de seguir. **Los timeouts se subieron a 600-900s**, con el
razonamiento documentado en el propio código: el histórico del proyecto
registra hasta 5 reintentos por expediente en el peor caso.

**🐛 1 bug real de contrato, encontrado en el primer POST del 6to flujo:**
`POST /admin/diagnostics/verification/report` devolvió **400** — el backend
(`VERIFICATION_FLUJOS_VALIDOS`) solo conocía 5 claves; `monitor_inicial` nunca
se había mandado antes porque hasta ahora la prueba diaria (manual o F1) solo
reportaba 5 flujos. Corregido en 2 lugares (aditivo, no rompe reportes
viejos): la whitelist del backend, **y** una copia duplicada del lado del
dashboard (`VERIF_FLUJOS_ORDEN`/`VERIF_FLUJO_NOMBRES` en `dashboard.js`) que
define qué se renderiza en la tarjeta — sin ese segundo fix, el reporte se
habría guardado bien pero el 6to flujo nunca habría aparecido en pantalla.
Verificado en staging antes de producción, md5 servido = md5 local en los 2
archivos.

**🐛 1 bug cosmético, encontrado leyendo el resultado real:** el detalle de
`monitor_inicial` mostraba `"? novedades"` — el parser de `results.py`
buscaba siempre el label `"Novedades detectadas"`, pero la 3ra tarjeta del
visor cambia de nombre según el modo: en `inicial` se llama **"Expedientes en
base"** (la línea base recién escrita). Corregido buscando ambos labels y
usando el que exista.

**Verificado con una corrida real completa contra el PJN, sin código de
producto tocado — los 6 flujos `ok`:** proc 2/2 (35s) · batch 2/2 (241s, con 1
reintento real) · informe individual 1/1 con PDF enlazado · informe por lote
2/2 con PDF enlazado · monitor novedades 3/3 partes, 0 novedades (esperado,
las 2 partes reales ya tenían línea base) · monitor consulta inicial 1/1,
**115 expedientes en base** (DON COCHO, creada id 118 — mismo id liberado por
el setup — y borrada limpia al final, confirmado por SQL: 0 residuo). **El
consumo de cupo coincidió exacto con el modelo documentado**: proc +1, batch
+1, informe +3, monitor_novedades +3 (3 partes activas en el momento de
"novedades"), global +6. Confirmado leyendo `GET .../latest` y `GET
.../quota` contra producción después de la corrida. Entorno cerrado limpio:
0 procesos de la app, config sin tocar; **1 pestaña de Chrome quedó abierta**
("Monitor - Consulta Inicial") — esperado, no se puede cerrar por código
(§4).

---

### F3 — Orquestador + CLI + ejecutable
**Modelo: Sonnet · Esfuerzo: medio · ~1 sesión**

- un comando que encadena F1 → F2 → F1(reporte)
- guard de instancia única (§6.2) y guard de `pytest` (§5)
- salida legible: tabla de los 6 flujos, consumo de cupo real vs. esperado,
  recargas restantes si hubo recarga, y **las pestañas que quedaron abiertas**
- **ejecutable para doble clic** (pedido del operador): un `.ps1`/`.bat`
  versionado en `tests/daily/` que activa el entorno y dispara la corrida — mismo
  patrón que `dev-tools/reset-panel.ps1`, que ya existe. El `.exe` vía `ps2exe`
  queda opcional y **gitignored**, igual que el del panel de reset.
- **doble disparador documentado** en `CLAUDE.md` (§6.7): la frase con «con
  computer use» sigue llevando al procedimiento manual
- **una corrida real completa** contra el PJN, comparada contra la corrida manual
  del 2026-08-27 (mismos expedientes, mismo consumo esperado:
  `proc +1 · batch +1 · informe +3 · monitor +3 · global +6`)

---

### F4 — Botón de ayuda en la tarjeta del dashboard
**Modelo: Sonnet · Esfuerzo: bajo · ~0,5 sesión · Superficie: dashboard admin**

Pedido del operador: un **`?`** al lado del `📋` que ya copia el comando
(`dashboard.js:4219`, dentro de `.diag-verif-cmd-line`), que abra un modal chico
con las instrucciones.

- botón `?` en la misma línea del comando, mismo estilo `.diag-btn secondary`
- modal reusando la infraestructura que el dashboard ya tiene (`_injectModal`,
  el mismo patrón de Pagos)
- **contenido:** las 2 frases de disparo y qué hace cada una · los prerequisitos
  (app cerrada — §6.2; perfil de Chrome con credenciales del PJN) · qué hace el
  script paso a paso · que **recarga cupo solo** · y que **al terminar quedan
  pestañas de Chrome para cerrar a mano**

**Va después de F3 a propósito:** el modal documenta el script, así que primero
tiene que existir. Es independiente del resto — se puede hacer en cualquier
momento posterior, o saltear.

---

### F5 — Desatendido *(opcional, solo si se pide)*
**Modelo: Sonnet · Esfuerzo: bajo · ~0,5 sesión**

Tarea programada de Windows + alerta por email reusando el mecanismo de
deduplicación por episodio que ya existe (`utils/verificationAlertCheck.js`).

⚠️ **No recomendado todavía.** Conviene acumular varias corridas asistidas antes
de soltarlo: un script desatendido que falla a mitad de camino **quema cupo real**
y deja la cuenta sin poder correr.

---

## 8. Resumen de esfuerzo

| # | Fase | Modelo | Esfuerzo | Sesiones | Superficie | ¿Vale sola? |
|---|---|---|---|---|---|---|
| **F0** | ✅ Spike / gate técnico (4 preguntas) | Sonnet | bajo | ~0,5 | — | gate |
| **F1** | ✅ Pre-vuelo, reporte y cierre (sin GUI) | Sonnet | bajo-medio | ~1 | `tests/daily/` | ✅ sí |
| **F2** | ✅ Conducción de los 6 flujos — **corrida real 6/6 OK** | Sonnet | medio-alto | ~2 | `tests/daily/` | parcial |
| **F3** | Orquestador + CLI + ejecutable | Sonnet | **medio** | ~1 | `tests/daily/` + `CLAUDE.md` | ✅ sí |
| **F4** | Botón de ayuda + modal | Sonnet | **bajo** | ~0,5 | dashboard admin | ✅ sí |
| **F5** | Desatendido *(opcional)* | Sonnet | **bajo** | ~0,5 | crontab / tarea | ✅ sí |
| | **Total** | | | **~5-5,5** | | |

**Orden y dependencias:** F0 es gate de todo. F1 → F2 → F3 es secuencial. **F4
depende de F3** (el modal documenta el script). **F5 es opcional y no se
recomienda todavía** (§7). **F0, F1 y F2 quedaron ejecutadas el 2026-08-27** —
código real en `tests/daily/`, no diseño. Quedan F3 y F4.

**Sin Opus en ninguna fase.** No toca cobranza, ni criptografía, ni código de
producto: es un consumidor de APIs que ya existen y están probadas. El único
tramo con algo de riesgo es F2, y el riesgo es *desperdiciar cupo en una corrida
fallida*, no romper nada.

---

## 9. Qué NO cubre esta propuesta

Para que "script hecho" no se confunda con "verificación resuelta":

- **No reemplaza la verificación del build empaquetado** en cada release (§6.4).
- **No cierra las pestañas de Chrome** — sigue siendo del operador (§4).
- **No decide si un fallo es del PJN o nuestro** — recolecta evidencia, el juicio
  es humano (§6.3).
- **No crea el perfil de Chrome con credenciales del PJN.**
- **No ejercita la detección de novedades reales** — el flujo corre pero reporta
  `0` porque las líneas base están al día (§6.6, hallazgo relacionado). Se puede
  cubrir, pero es una decisión aparte.
- **No fusiona el modo automático (F2) con el asistido (F1) en un solo CLI
  pulido** — hoy son `ejecutar.py` y `run.py` separados. Es tarea de F3.

> ✅ **Cubierto desde F2:** los 6 flujos se corren por código, sin clicks ni
> diálogos nativos — incluida "Monitor — Consulta Inicial", que era el hueco
> más viejo (sin correrse desde el 2026-07-23). Ver §6.6 y la entrada de F2.

---

## 10. Cómo arrancar

**F0, F1 y F2 ya están ejecutadas y en el repo** (`tests/daily/`). Para seguir
con F3:

> «Ejecutá la F3 del plan de
> `docs/internal/propuesta-script-prueba-diaria-2026-08-27.md`.»

Sonnet, esfuerzo medio.
