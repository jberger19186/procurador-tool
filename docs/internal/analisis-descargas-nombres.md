# Análisis de descargas: archivos por módulo, unificación de nombres y limpieza

> Generado: 2026-06-30. App v2.7.32 (descargas por usuario/CUIT — D6).
> Carpeta raíz analizada: `%APPDATA%\procurador-electron\usuarios\<CUIT>\descargas\`.
> Es un **informe de diagnóstico + propuesta**. No implementa cambios (requiere tocar
> scripts encriptados + re-encrypt/redeploy + release; ver §6).

---

## 1. Inventario de archivos generados POR MÓDULO

Leyenda: 🟢 entregable (conservar) · 🟡 estado/cache leído (conservar) · 🔴 temporal/debris (borrable tras éxito).

### A) Procurar (individual) — `procesarNovedadesCompleto.js` (+ `testM2.js`)
| Archivo | Tipo | Escrito por |
|---|---|---|
| `procesos_automaticos/proceso_<YYYY-MM-DD_HH-MM-SS>.xlsx` | 🟢 | procesarNovedadesCompleto:754 |
| `procesos_automaticos/proceso_<ts>.json` | 🟡 (registro) | procesarNovedadesCompleto:470 |
| `ultimo_proceso.json` | 🟡 (lo lee la UI / "último proceso") | procesarNovedadesCompleto:475 |
| `visor_generado.html` | 🟢 | procesarNovedadesCompleto:859 |
| `<CUIT>_temp/<exp>_actuales/` (PDFs crudos descargados de PJN) | 🔴 | testM2:563 (setDownloadBehavior) |

### B) Procurar Por Lote — `procesarCustomExpedientes.js` (+ `testM2.js`)
| Archivo | Tipo | Escrito por |
|---|---|---|
| `visor_generado.html` ⚠️ **mismo nombre que A → lo pisa** | 🟢 | procesarCustomExpedientes:100 |
| `<CUIT>_temp/<exp>_actuales\|_historicas/` | 🔴 | testM2 |
| *(no genera Excel — inconsistencia con Procurar individual)* | — | — |

### C) Informe (individual) — `informequickscwpjn.js` (+ `testM2.js`)
| Archivo | Tipo | Escrito por |
|---|---|---|
| `expediente_<exp>.pdf` | 🟢 | testM2:2146 |
| `<CUIT>_temp/<exp>_backup/estado_secciones.json` | 🔴 (checkpoint para reanudar) | informequick:1020/1045 |
| `<CUIT>_temp/<exp>_backup/datosGenerales.json` | 🔴 | informequick:1116 |
| `<CUIT>_temp/<exp>_backup/intervinientes.json` | 🔴 | informequick:1116 |
| `<CUIT>_temp/<exp>_backup/listaMovimientos.json` | 🔴 | informequick:1116 |
| `<CUIT>_temp/<exp>_backup/notas.json` | 🔴 | informequick:618 |
| `<CUIT>_temp/<exp>_actuales\|_historicas/` | 🔴 | testM2 |
| *(PID file + FLAG de control)* | 🔴 (✅ se autoborran, informequick:173/788) | informequick |

### D) Informe Por Lote — `informequickscwpjn.js` (por expediente) + `main.js` (post-lote)
| Archivo | Tipo | Escrito por |
|---|---|---|
| `expediente_<exp>.pdf` (uno por expediente) | 🟢 | testM2:2146 |
| `informe_batch_<YYYY-MM-DDTHH-MM-SS>.xlsx` | 🟢 | generador_excel:57 |
| `visor_batch_<YYYY-MM-DDTHH-MM-SS>.html` | 🟢 | generador_visor:69 |
| `resumen_orquestador_<epoch_ms>.json` | 🔴 (input a los 2 de arriba; debris luego) | main.js:1989 |
| `<CUIT>_temp/<exp>_backup/*` (por expediente) | 🔴 | informequick |

### E) Monitor — consulta inicial — `procesarMonitoreo.js` + `main.js`
| Archivo | Tipo | Escrito por |
|---|---|---|
| `visor_monitoreo.html` ⚠️ **mismo nombre que F → se pisan** | 🟢 | main.js:2342 |
| *(el script no escribe en descargas; devuelve RESULT por stdout)* | — | — |

### F) Monitor — consulta novedades — `procesarMonitoreo.js` + `main.js`
| Archivo | Tipo | Escrito por |
|---|---|---|
| `visor_monitoreo.html` ⚠️ (pisa al de inicial) | 🟢 | main.js:2342 |

### G) Monitor — "ver visor guardado de expedientes" — `main.js`
| Archivo | Tipo | Escrito por |
|---|---|---|
| `visor_expedientes_guardado.html` | 🟢 | main.js:2535 |

### H) Monitor — "ver visor guardado de novedades" — `main.js`
| Archivo | Tipo | Escrito por |
|---|---|---|
| `visor_novedades_guardado.html` (solo si hay novedades pendientes) | 🟢 | main.js:2535 |

### Archivos de estado/config (base `usuarios/<CUIT>/`, NO en `descargas/`)
| Archivo | Tipo | Notas |
|---|---|---|
| `backup_expedientes.json` | 🔴 | checkpoint de procuración; ✅ se borra al final (consultarscwpjn:491) |
| `config_informe_resumen.json` | 🟡 | config que lee testM2:1788 |
| *(config_proceso.json, config_*_custom/informe/monitoreo.json viven en el tempDir de ejecución, no en descargas)* | — | — |

---

## 2. Problemas detectados

1. **Colisión `visor_generado.html`** — Procurar **individual** y **Por Lote** escriben el mismo archivo → el segundo pisa al primero. Imposible saber de cuál es.
2. **Colisión `visor_monitoreo.html`** — Monitor **inicial** y **novedades** escriben el mismo → se pisan entre sí.
3. **Prefijos inconsistentes** — `proceso_*` (procurar), `visor_generado` (procurar), `informe_batch_*`/`visor_batch_*` (informe lote), `visor_monitoreo`/`visor_*_guardado` (monitor). No hay un prefijo de módulo uniforme.
4. **Formatos de timestamp distintos** — `YYYY-MM-DD_HH-MM-SS` (proceso) · `YYYY-MM-DDTHH-MM-SS` (informe/visor batch) · epoch ms (`resumen_orquestador`). Dificultan ordenar/leer.
5. **`expediente_<exp>.pdf` sin módulo ni timestamp** — no se distingue si salió de Informe individual o de un lote, ni cuándo.
6. **`<CUIT>_temp/` no se limpia** — los `_actuales/_historicas` (PDFs crudos) y los `_backup/*.json` (checkpoints de informe) **quedan para siempre**: ningún script los borra al terminar. Es la principal fuente de confusión/acumulación.
7. **Paridad funcional** — Procurar individual genera Excel; Procurar Por Lote no (solo visor).

---

## 3. Propuesta de unificación de nombres (carpeta por módulo + submodo + prefijo + ISO)

```
usuarios/<CUIT>/descargas/
├── procurar/
│   ├── individual/
│   │   ├── procurar-individual_<ISO>.xlsx
│   │   ├── procurar-individual_<ISO>.json
│   │   └── procurar-individual_visor_<ISO>.html
│   └── lote/
│       ├── procurar-lote_<ISO>.xlsx            ← NUEVO (paridad con individual)
│       └── procurar-lote_visor_<ISO>.html
├── informe/
│   ├── individual/
│   │   └── informe-individual_<exp>_<ISO>.pdf
│   └── lote/
│       ├── informe-lote_<ISO>.xlsx
│       ├── informe-lote_visor_<ISO>.html
│       └── informe-lote_<exp>_<ISO>.pdf        ← un PDF por expediente
├── monitor/
│   ├── inicial/   monitor-inicial_visor_<ISO>.html
│   ├── novedades/ monitor-novedades_visor_<ISO>.html
│   └── guardados/
│       ├── monitor-guardado-expedientes.html
│       └── monitor-guardado-novedades.html
├── ultimo_proceso.json          ← estado fijo de UI (se mantiene)
└── _temp/                        ← TODO lo efímero, borrable sin riesgo
    └── <exp>/{actuales, historicas, backup}/...
```

Reglas:
- **Prefijo de módulo y submodo en cada nombre** (`procurar-individual`, `procurar-lote`, `informe-individual`, `informe-lote`, `monitor-inicial`, `monitor-novedades`). Resuelve las colisiones (1) y (2) y la ambigüedad (3)/(5).
- **Timestamp ISO uniforme** `YYYY-MM-DDTHH-MM-SS` en todos (4).
- **Carpeta `_temp/` única** para todo lo efímero (renombrar el actual `<CUIT>_temp` → `_temp`; el CUIT ya está en la ruta del usuario) (6).
- (Opcional) **Procurar Por Lote también genera Excel** (7).

> Alternativa más liviana (si no se quiere reestructurar carpetas): mantener todo en `descargas/` plano pero **renombrar con prefijo de módulo+submodo+ISO** (mismo criterio de nombres, sin subcarpetas). Resuelve colisiones y ambigüedad; no separa temporales tan claro.

---

## 4. Propuesta de limpieza de temporales (qué borrar, qué conservar)

### Conservar siempre 🟢🟡
- Entregables: `*.xlsx`, `*.html` (visores), `expediente_*.pdf`.
- `ultimo_proceso.json` — lo lee la UI para mostrar el último proceso.
- `proceso_<ts>.json` — registro por corrida (histórico; redundante con el xlsx pero barato).
- `config_informe_resumen.json` — config que lee testM2.

### Borrar tras una ejecución EXITOSA 🔴
- `<exp>_backup/` completo (estado_secciones, datosGenerales, intervinientes, listaMovimientos, notas): solo sirven para **reanudar un informe interrumpido**; tras completarlo no se usan. **Conservar solo si el run falló** (para poder reanudar).
- `<exp>_actuales/` y `<exp>_historicas/`: PDFs crudos intermedios que ya quedaron consolidados en el `expediente_*.pdf` final.
- `resumen_orquestador_*.json`: input para generar el `informe_batch` xlsx + visor; **descartable una vez generados**.

### Acción recomendada
1. **Auto-limpieza al cierre exitoso**: que `informequick` borre el `<exp>_backup/` y `<exp>_actuales|_historicas/` cuando el informe se completa OK (hoy NO lo hace). Que `main.js` borre el `resumen_orquestador_*.json` tras generar el Excel/visor del lote.
2. **Botón "Limpiar temporales"** en la app que borre `_temp/` completo (seguro: nunca toca entregables). Ya existe `clean-folder` con `temp` — adaptarlo a la carpeta `_temp/`.
3. **NO** borrar automáticamente nada de un run que falló (los checkpoints permiten reanudar).

> ⚠️ Sobre `estado_secciones.json`: es un **checkpoint de reanudación**, no debug. Si se borra a mitad de un informe interrumpido, se pierde el progreso y hay que re-scrapear desde cero. Por eso la limpieza debe dispararse **solo al éxito**.

---

## 5. JSON: análisis explícito (lo que pediste)

| JSON | ¿Conservar? | Por qué |
|---|---|---|
| `ultimo_proceso.json` | ✅ SÍ | Lo lee la UI/visor para "último proceso". |
| `proceso_<ts>.json` | ✅ SÍ (histórico) | Registro de cada corrida. Redundante con el `.xlsx` pero útil como dato crudo. |
| `config_informe_resumen.json` | ✅ SÍ | Config leída por testM2. |
| `resumen_orquestador_<ts>.json` | 🟡 transitorio | Necesario solo hasta generar el `informe_batch` xlsx+visor; luego borrable. |
| `<exp>_backup/estado_secciones.json` | 🔴 borrable al éxito | Checkpoint de reanudación; inútil tras completar. |
| `<exp>_backup/{datosGenerales,intervinientes,listaMovimientos,notas}.json` | 🔴 borrable al éxito | Backups de sección para reanudar; consolidados en el PDF final. |
| `backup_expedientes.json` | ✅ ya gestionado | Se autoborra al final de la procuración (consultarscwpjn:491). |

---

## 6. Notas de implementación (alcance / riesgo)

- **Capas a tocar (igual que D6):** scripts encriptados (`procesarNovedadesCompleto`, `procesarCustomExpedientes`, `informequickscwpjn`, `testM2`, `procesarMonitoreo`) que **escriben** ↔ `main.js` + `generador_excel/visor.js` que **leen/abren** los visores y Excel. Las dos capas deben quedar sincronizadas o los botones ("último Excel", "abrir visor") apuntan a nombres viejos.
- **Flujo:** editar fuentes → `reencrypt_scripts.js` + redeploy → **release Electron** (bump + tag) → **prueba E2E** de cada módulo (los 8 caminos) verificando nombres y limpieza.
- **Riesgo:** medio (muchos puntos de lectura de nombres en `main.js`: `get-visor-path`, `get-latest-excel`, auto-open de visores, etc., que hoy buscan `visor_generado.html` / `procesos_automaticos/*.xlsx`). Recomendado por fases: (1) carpetas+nombres por módulo, (2) auto-limpieza de temporales.
- **Compatibilidad:** lo viejo en `descargas/` plano quedaría como legado (igual que en D6, no se migra).
