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
y caro. El camino real es otro: **los 5 flujos son invocables directamente desde
el renderer**, sin tocar un solo modal, diálogo nativo ni coordenada.

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
| 5 | Monitor | `runMonitoreo({ modo: 'novedades', partes })` | `preload.js:152` · `renderer.js:3967` |

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
| Recargar cupo si falta | ídem | ✅ automático (**con flag explícito**, ver §6.1) |
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
- 🚨 **Guard obligatorio:** un `pytest` a secas **nunca** debe dispararlo. Marker
  propio (`daily`) + `addopts = -m "not daily"` en `pytest.ini`, o directorio
  excluido por defecto. Sin esto, alguien corre la suite y quema cupo real contra
  el PJN sin saberlo.
- Entrada de una línea: `python tests/daily/run.py` (o
  `pytest -m daily`), para que el operador no tenga que recordar flags.

---

## 6. Riesgos y decisiones abiertas

### 6.1 🚨 ¿El script recarga cupo solo? — **decisión del operador**

Acabamos de subir el tope a **5 recargas por 24 h**. Un script que recargue
automáticamente en cada corrida puede consumirlas sin que nadie lo note.

**Recomendación:** por defecto **verifica y aborta con un mensaje claro** si no
alcanza; recarga solo con `--recargar-cupo` explícito. Así el cupo sigue siendo
una decisión consciente, que es para lo que se diseñaron las 7 protecciones.

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

### F0 — Spike / gate técnico
**Modelo: Sonnet · Esfuerzo: bajo · ~0,5 sesión · No escribe código de producto**

Responde 4 preguntas contra la app real. Si alguna falla, el plan cambia de forma:

1. ¿`window.electronAPI` es alcanzable desde `page.evaluate()` por CDP?
   (Debería: `contextBridge.exposeInMainWorld` publica en el main world, que es
   donde corre `evaluate` — pero se confirma, no se asume.)
2. ¿`runProcessCustomDate(...)` devuelve el resultado a `evaluate` o solo emite
   eventos? Define cómo se espera cada flujo.
3. ¿El `.exe` instalado acepta `--remote-debugging-port`? (§6.4)
4. ¿Conviven dos instancias o hay colisión de `userData`? (§6.2)

**Entregable:** nota corta con las 4 respuestas medidas. **Gate:** si (1) falla,
el enfoque entero se cae y hay que volver a computer-use.

---

### F1 — Pre-vuelo, reporte y cierre (sin GUI)
**Modelo: Sonnet · Esfuerzo: bajo-medio · ~1 sesión**

Todo lo que hoy son ~6 llamadas manuales con `scp` de scripts temporales:

- verificar cupo contra los 4 submódulos + global, con el costo real por flujo
- `--recargar-cupo` opcional (§6.1)
- verificar partes activas con línea base
- leer los resultados desde `descargas/` (los visores traen el resumen embebido —
  ⚠️ **por `grep` del JSON, nunca contando las palabras "Exitoso"/"Error", que
  son clases CSS y dan un conteo falso**)
- postear el reporte a `/admin/diagnostics/verification/report`
- cerrar la app y enumerar las pestañas que quedaron abiertas

**Valor solo:** convierte el ceremonial de pre-vuelo y cierre en un comando,
incluso si los flujos se siguen corriendo a mano. **Es la fase con mejor relación
valor/riesgo de todo el plan.**

---

### F2 — Conducción de los 5 flujos
**Modelo: Sonnet · Esfuerzo: medio-alto · ~1-2 sesiones**

El corazón. Reusa el fixture `electron_app`, agrega:

- espera por estado real de cada flujo, con timeout duro (§6.5)
- los 5 flujos vía `window.electronAPI` (§2)
- criterios de resultado por flujo — incluido el que **caza regresiones reales**:
  en los 2 flujos de informe, verificar que **"Abrir PDF" quede activo**, no solo
  que el PDF exista (es el criterio que detecta `822bf0d`/`debb503`)
- clasificación `ok` / `error` / `omitido` con la señal de red de §6.3

---

### F3 — Orquestador + CLI
**Modelo: Sonnet · Esfuerzo: medio · ~1 sesión**

- un comando que encadena F1 → F2 → F1(reporte)
- guard de instancia única (§6.2) y guard de `pytest` (§5)
- salida legible: tabla de los 5 flujos, consumo de cupo real vs. esperado,
  pestañas abiertas
- **una corrida real completa** contra el PJN, comparada contra la corrida manual
  del 2026-08-27 (mismos expedientes, mismo consumo esperado:
  `proc +1 · batch +1 · informe +3 · monitor +3 · global +6`)

---

### F4 — Desatendido *(opcional, solo si se pide)*
**Modelo: Sonnet · Esfuerzo: bajo · ~0,5 sesión**

Tarea programada de Windows + alerta por email reusando el mecanismo de
deduplicación por episodio que ya existe (`utils/verificationAlertCheck.js`).

⚠️ **No recomendado todavía.** Conviene acumular varias corridas asistidas antes
de soltarlo: un script desatendido que falla a mitad de camino **quema cupo real**
y deja la cuenta sin poder correr.

---

## 8. Resumen de esfuerzo

| Fase | Modelo | Esfuerzo | Sesiones | Entrega valor sola |
|---|---|---|---|---|
| F0 — Spike | Sonnet | bajo | ~0,5 | gate |
| F1 — Pre-vuelo y reporte | Sonnet | bajo-medio | ~1 | ✅ sí |
| F2 — Los 5 flujos | Sonnet | medio-alto | ~1-2 | parcial |
| F3 — Orquestador + CLI | Sonnet | medio | ~1 | ✅ sí |
| F4 — Desatendido *(opcional)* | Sonnet | bajo | ~0,5 | ✅ sí |
| **Total** | | | **~3,5-5** | |

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
- **No cubre el flujo "Monitor — Consulta Inicial"**, que sigue sin ejercitarse
  desde el 2026-07-23 y es **el que usa un cliente nuevo en su onboarding**
  (anotado en §9 del plan de la Etapa 1.5, sigue abierto).
- **No crea el perfil de Chrome con credenciales del PJN.**

---

## 10. Cómo arrancar

Sesión nueva, Sonnet, esfuerzo bajo:

> «Ejecutá la F0 (spike) de
> `docs/internal/propuesta-script-prueba-diaria-2026-08-27.md`.»

Si el gate pasa, seguir por F1 — que es la que más ahorra por sí sola.
