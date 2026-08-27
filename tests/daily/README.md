# tests/daily/ — Prueba diaria de la app contra el PJN

> Plan de origen: [`docs/internal/propuesta-script-prueba-diaria-2026-08-27.md`](../../docs/internal/propuesta-script-prueba-diaria-2026-08-27.md).
> **Estado: F0, F1, F2 y F3 hechas.** Falta F4 (botón de ayuda en el dashboard).
> F5 (desatendido/programado) sigue sin recomendarse.

## Punto de entrada recomendado: `cli.py` (F3)

```bash
# Doble clic (Windows) — modo automático
tests\daily\correr-diario.ps1

# Doble clic — modo asistido
tests\daily\correr-diario.ps1 -Asistido

# Línea de comandos — equivalentes
python tests/daily/cli.py               # automático (F2)
python tests/daily/cli.py --asistido    # asistido (F1)
```

`cli.py` no duplica la lógica de `ejecutar.py`/`run.py` — los invoca. Ambos
siguen siendo ejecutables por separado si hace falta un modo puntual sin pasar
por el menú de flags.

## ⚠️ Esto no es un test unitario — golpea el PJN real y consume cupo real

Nunca corre por accidente: está marcado `daily` en `pytest.ini` y excluido por
defecto (`addopts = -m "not daily"`). Un `pytest` a secas no lo toca.

## Qué hace hoy

| | Hecho |
|---|---|
| Verificar cupo de la cuenta de verificación | ✅ |
| Recargar cupo automáticamente si hace falta | ✅ (decisión del operador, ver `quota.py`) |
| Verificar partes del Monitor con línea base | ✅ |
| **Correr los 6 flujos contra el PJN por código** | ✅ (`ejecutar.py`, sin clicks ni diálogos nativos) |
| Leer los resultados de `descargas/` y reportar al dashboard | ✅ |
| Cerrar la app | ✅ |
| Enumerar las pestañas de Chrome que quedaron abiertas | ✅ (no se cierran por código, ver §4 de la propuesta) |
| Guard de instancia única antes de lanzar | ✅ (`close_env.assert_no_instance_running`) |

## Dos formas de correrlo

**Automático (F2):** `ejecutar.py` lanza la app real, corre los 6 flujos por
código vía `window.electronAPI` y cierra todo solo. Es el que reemplaza la
corrida manual.

**Asistido (F1):** `run.py` hace el pre-vuelo, **pausa** para que corras los
flujos vos (a mano o con computer-use), y al presionar Enter hace el cierre.
Sigue siendo útil como fallback si `ejecutar.py` falla por algo puntual del
producto (selector movido, IPC nuevo) — el pre-vuelo/cierre no dependen de
cómo se corrieron los flujos.

## Uso

```bash
# Automático: los 6 flujos por código, sin intervención
python tests/daily/ejecutar.py

# Asistido: preflight -> pausa para correr los flujos vos -> cierre
python tests/daily/run.py

# Solo el pre-vuelo (cupo + partes)
python tests/daily/preflight.py

# Solo el cierre (si ya corriste los flujos por tu cuenta)
python tests/daily/cierre.py --notas "lo que quieras aclarar"

# Vía pytest (hoy solo cubre el pre-vuelo)
pytest -m daily tests/daily/
```

## Estructura

| Archivo | Qué hace |
|---|---|
| `config.py` | Constantes: endpoints, rutas, nombres de archivo, costos, fixtures de expedientes/parte descartable |
| `quota.py` | Cupo — lectura + recarga automática |
| `partes.py` | Estado de las partes del Monitor (línea base) |
| `results.py` | Localiza y parsea el visor HTML más reciente de cada flujo |
| `report.py` | Arma el payload y postea a `/admin/diagnostics/verification/report` |
| `close_env.py` | Guard de instancia única, cierre de la app, listado de pestañas de Chrome |
| `electron_driver.py` | Lanza el `.exe` real, conecta por CDP, resuelve el login |
| `flujos.py` | Los 6 flujos reales vía `window.electronAPI` |
| `ejecutar.py` | CLI — F2 completo: preflight + los 6 flujos + cierre, automático |
| `preflight.py` | CLI — pre-vuelo solo |
| `cierre.py` | CLI — cierre solo |
| `run.py` | CLI — pre-vuelo + pausa manual + cierre (modo asistido, F1) |
| `resumen.py` | Tabla final: flujos ok/error, cupo real vs. esperado, recargas restantes, pestañas abiertas (F3) |
| `cli.py` | **Punto de entrada único** (F3) — `--asistido` alterna entre `run.py` y `ejecutar.py` |
| `correr-diario.ps1` | Ejecutable de doble clic (F3) — invoca `cli.py`, mismo patrón que `dev-tools/reset-panel.ps1` |
| `test_daily_preflight.py` | Wrapper pytest del pre-vuelo, marcado `daily` |

## Reusa, no duplica

- **Autenticación:** `tests/helpers/auth.py` (`get_admin_token`,
  `get_token_for_user_id`) — login HTTP normal con fallback a generación por
  SSH, mismo patrón que usa el resto de la suite.
- **Endpoints:** los mismos que usa el dashboard admin y que se usaron a mano
  en la corrida manual del 2026-08-27 (`CLAUDE.md`, sesión "cont. 18").

## `electron_driver.py` — por qué API async, no sync

Playwright Python ofrece dos APIs: `sync_api` (simula sincronía con
greenlets) y `async_api`. Un primer intento con la sync API + un timeout
manual vía `ThreadPoolExecutor` rompió con
`greenlet.error: Cannot switch to a different thread` — la sync API está
atada al hilo que abrió la conexión y no admite invocarse desde un hilo
worker distinto. Se migró a `async_api` + `asyncio.wait_for()`, que resuelve
el timeout sin cruzar threads.

## Timeouts — no son un valor arbitrario

`flujos.py` usa timeouts de 600-900s, no los 180-240s "razonables" de la
primera versión. La corrida real del 2026-08-27 mostró por qué: un solo
expediente del lote disparó el sistema de reintentos propio del producto
("hard 1": cierra Chrome, relanza, reintenta) porque el PJN respondió lento
— el lote completo terminó **exitoso** a los 241s, pero el timeout de 180s ya
había cortado la espera de Python antes. El histórico del proyecto documenta
hasta 5 reintentos por expediente en el peor caso.

## Parsers de `results.py` — 2 trampas que ya costaron bugs reales

Los 3 tipos de visor embeben sus datos de forma distinta:

- **Procuración** (individual/lote): `const datosEmbebidos = {...}`, con
  `expedientes[].movimientos[]` — **3+ niveles de anidamiento reales**. Una
  regex con tope fijo de 1 nivel (la primera versión de este parser) corta ahí
  y `json.loads` falla en silencio. El extractor cuenta llaves balanceadas
  carácter por carácter, no usa regex para el cuerpo del objeto.
- **Informe** (individual/lote): `const DATOS_BATCH = {...}`, con
  `expedientes[].ok` + `.rutaPDF`. El criterio de éxito exige **ambos** — un
  PDF que se generó pero no quedó enlazado es el mismo bug que ya rompió
  producción dos veces (`822bf0d`, `debb503`).
- **Monitor**: el HTML es **server-rendered** por `main.js` (sin objeto JS).
  Se leen los 3 `<div class="stat-val">` por su label adyacente, nunca
  contando las palabras "Exitoso"/"Error" del HTML — son clases CSS de los
  badges y dan un conteo falso. **La 3ra tarjeta cambia de nombre según el
  modo:** "Novedades detectadas" en `novedades`, "Expedientes en base" en
  `inicial` — no es el mismo dato, y una primera versión que solo buscaba el
  primer label daba `"? novedades"` en los visores de consulta inicial.

## La parte descartable (§6.6) — DON COCHO

`flujos.py::crear_parte_descartable()` crea "DON COCHO" cada corrida y la
borra al final, dentro de la gracia de 24h (nunca envejece, la regla de 30
días de `routes/monitor.js` nunca se activa). **Requiere un setup de una sola
vez**, ya hecho el 2026-08-27: la DON COCHO histórica (id 118, con línea base
real de 115 expedientes) se borró vía el endpoint real — posible porque tenía
más de 30 días. Sin ese setup, `crear_parte_descartable()` da 409 (nombre ya
activo). Si algún día vuelve a existir una parte real con ese nombre+jurisdicción, hay que repetir el setup antes de la siguiente corrida.

Orden de la secuencia (importa): crear → consulta inicial (construye la línea
base) → novedades **sobre las 3 partes activas** (la recién creada incluida —
debe dar 0, así se verifica gratis que la inicial escribió bien la base) →
borrar.

## Hallazgos de F1/F2 (documentados, ya corregidos salvo el de `origen`)

- **`origen` del reporte** (F1, no bloqueante): el backend solo distingue
  `'app-automatica'` vs. cualquier otra cosa (cae a `'computer-use'`). El
  `'script-daily'` que manda este módulo se pisa en silencio, pero las
  `notas` sí quedan tal cual. Candidato de F3 si se quiere distinguir en la
  propia tarjeta.
- **Whitelist de `monitor_inicial`** (F2, corregido y desplegado): el backend
  (`VERIFICATION_FLUJOS_VALIDOS`) y el dashboard (`VERIF_FLUJOS_ORDEN`, copia
  duplicada del lado del frontend) solo conocían 5 claves — el primer POST
  real con el 6to flujo dio 400. Se amplió en los dos lugares (aditivo, no
  rompe reportes viejos) y se verificó en staging antes de producción.

## F3 — qué agregó exactamente

`cli.py` fusiona `ejecutar.py` (automático) y `run.py` (asistido) detrás de
un solo comando con `--asistido`. `resumen.py` es nuevo: compara el cupo
real consumido contra el modelo documentado (`proc +1 · batch +1 ·
informe +3 · monitor +N partes · global +6`) submódulo por submódulo, y
arma la tabla final (flujos, cupo, recargas restantes, pestañas abiertas)
que antes solo vivía como texto suelto en la consola de `cierre.py`.
`preflight.run()` ganó un parámetro opcional `retornar_detalle=True`
(retrocompatible — sin el flag el contrato es exactamente el de antes,
verificado con `pytest -m daily`) para que `cli.py`/`ejecutar.py`/`run.py`
puedan capturar el snapshot de cupo *antes* de correr y comparar contra el
de *después*. `correr-diario.ps1` es el ejecutable de doble clic pedido por
el operador, ASCII puro, mismo patrón que `dev-tools/reset-panel.ps1`
(resuelve su propio directorio con fallback para un futuro `.exe` vía
`ps2exe`, gitignored si se genera).

**No se corrió una corrida real nueva para verificar F3.** La lógica de
ejecución de los 6 flujos (`flujos.py`, `electron_driver.py`) no cambió — es
exactamente la misma que F2 ya verificó de punta a punta contra el PJN real
el 2026-08-27 (6/6 ok, consumo de cupo exacto al modelo). F3 solo cambia el
punto de entrada (fusión de 2 comandos en 1) y el formato de salida — se
verificó con `python -m py_compile` en los 5 archivos tocados y con
`pytest -m daily` confirmando que el cambio de firma de `preflight.run()`
no rompe el test existente. Repetir la corrida real habría gastado cupo sin
ejercitar código nuevo.

## Próximo paso

**F4** — botón `?` en la tarjeta "Verificación funcional (PJN real)" del
dashboard, al lado del botón que copia el comando, con un modal de
instrucciones (frases disparadoras, qué hace el script, que recarga cupo
solo, que deja pestañas de Chrome abiertas). Depende de F3 (ya hecho) porque
el modal documenta exactamente este script. Ver la propuesta para el
detalle completo.
