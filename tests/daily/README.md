# tests/daily/ — Prueba diaria de la app contra el PJN

> Plan de origen: [`docs/internal/propuesta-script-prueba-diaria-2026-08-27.md`](../../docs/internal/propuesta-script-prueba-diaria-2026-08-27.md).
> **Estado: F1 hecha.** F2 (correr los 6 flujos por código) todavía no existe.

## ⚠️ Esto no es un test unitario — golpea el PJN real y consume cupo real

Nunca corre por accidente: está marcado `daily` en `pytest.ini` y excluido por
defecto (`addopts = -m "not daily"`). Un `pytest` a secas no lo toca.

## Qué hace hoy (F1) y qué no (todavía)

| | Hecho |
|---|---|
| Verificar cupo de la cuenta de verificación | ✅ |
| Recargar cupo automáticamente si hace falta | ✅ (decisión del operador, ver `quota.py`) |
| Verificar partes del Monitor con línea base | ✅ |
| **Correr los 6 flujos contra el PJN** | ❌ — es F2, no existe todavía |
| Leer los resultados de `descargas/` y reportar al dashboard | ✅ |
| Cerrar la app | ✅ |
| Enumerar las pestañas de Chrome que quedaron abiertas | ✅ (no se cierran por código, ver §4 de la propuesta) |

**Hoy el script asiste una corrida MANUAL** (a mano o con computer-use): antes
de arrancar, corré el pre-vuelo; corré los flujos vos; al terminar, corré el
cierre — que lee lo que quedó en `descargas/`, reporta y cierra todo.

## Uso

```bash
# Todo en uno: preflight -> pausa para que corras los flujos -> cierre
python tests/daily/run.py

# Solo el pre-vuelo (cupo + partes)
python tests/daily/preflight.py

# Solo el cierre (si ya corriste los flujos por tu cuenta)
python tests/daily/cierre.py --notas "lo que quieras aclarar"

# Vía pytest
pytest -m daily tests/daily/
```

## Estructura

| Archivo | Qué hace |
|---|---|
| `config.py` | Constantes: endpoints, rutas, nombres de archivo, costos por flujo |
| `quota.py` | Cupo — lectura + recarga automática |
| `partes.py` | Estado de las partes del Monitor (línea base) |
| `results.py` | Localiza y parsea el visor HTML más reciente de cada flujo |
| `report.py` | Arma el payload y postea a `/admin/diagnostics/verification/report` |
| `close_env.py` | Guard de instancia única, cierre de la app, listado de pestañas de Chrome |
| `preflight.py` | CLI — pre-vuelo solo |
| `cierre.py` | CLI — cierre solo |
| `run.py` | CLI — los dos anteriores encadenados con una pausa en el medio |
| `test_daily_preflight.py` | Wrapper pytest del pre-vuelo, marcado `daily` |

## Reusa, no duplica

- **Autenticación:** `tests/helpers/auth.py` (`get_admin_token`,
  `get_token_for_user_id`) — login HTTP normal con fallback a generación por
  SSH, mismo patrón que usa el resto de la suite.
- **Endpoints:** los mismos que usa el dashboard admin y que se usaron a mano
  en la corrida manual del 2026-08-27 (`CLAUDE.md`, sesión "cont. 18").

## Parsers de `results.py` — la trampa que ya costó un bug real

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
  badges y dan un conteo falso.

## Hallazgo de F1 (documentado, no bloqueante)

El backend (`routes/admin.js`) solo distingue 2 valores de `origen` en el
reporte: `'app-automatica'` (F5, desatendido) y cualquier otra cosa cae a
`'computer-use'`. El `'script-daily'` que manda este módulo se pisa en
silencio — pero las `notas` sí quedan tal cual, así que el origen real sigue
siendo legible en el detalle del reporte. Ampliar la whitelist del backend
queda como candidato de F3 si se quiere distinguir en la propia tarjeta.

## Próximo paso

**F2** — correr los 6 flujos por código (vía `window.electronAPI`, confirmado
viable en el spike F0). Ver la propuesta para el detalle completo.
