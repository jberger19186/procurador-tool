# Plan de corrección — Hallazgos del Bloque R (#5, #6, #7, #10)

> Generado 2026-07-23 (Opus, tras investigación del código real). **Para ejecutar con Sonnet, esfuerzo medio.**
> **Regla de oro:** fixes **quirúrgicos**. No tocar scripts encriptados, ni `src/security/`, ni la lógica de ejecución/cobro. Backup previo. Probar la app sin instalar (`npm start` + `build:dir`) antes de publicar.
> **#9 (instalador atascado) queda FUERA de este plan** — se deriva a prueba manual del operador (un click humano real puede no toparse con el bloqueo de `computer-use`). No se corrige hasta confirmar que reproduce.

---

## Resumen ejecutivo

| # | Qué es | Tipo de fix | Toca | ¿Release Electron? | Riesgo |
|---|---|---|---|---|---|
| **#5** | Verificación diaria no corre | **Operativo (config)**, NO código | `verificacion_config.json` del operador | No | Nulo |
| **#6** | Batch no valida formato por línea | Código Electron | `main.js` + `renderer.js` | Sí | Bajo |
| **#7** | Campo Fecha Límite acepta fechas imposibles | Código Electron | `renderer.js` | Sí | Muy bajo |
| **#10** | Informe de expediente inexistente consume cuota | Código Electron + **paso previo de descubrimiento** | `authManager.js` + `main.js` | Sí | Medio (ver edge case) |

**#6, #7 y #10 se agrupan en UNA sola release Electron** (ej. `v2.7.42`) — no hacer 3 releases separadas.
**#5 se resuelve aparte, sin release** (cambio de config en la máquina del operador).

---

## ✅ Ejecución 2026-07-23 (Sonnet, esfuerzo medio) — CERRADO

- **#5:** consultado el operador vía pregunta directa → **eligió dejarlo como está** (con confirmación manual). Reclasificado como "no es bug" en el plan de pruebas, sin cambio de código.
- **#6:** ✅ **CORREGIDO.** `select-batch-file` (`main.js`) clasifica cada línea con `parseExpedienteStr` y devuelve `validLines`/`invalidCount`. Los 2 modales (Procurar por Lote, Informe por Lote) muestran "N válidos — M omitidos por formato inválido". Verificado en vivo (`npm start`) con un `.txt` de 5 líneas (2 válidas + 3 basura) en ambos modales → resultado exacto esperado.
- **#7:** ✅ **CORREGIDO.** Helper `esFechaValidaDDMMYYYY()` aplicado en los 5 puntos que leían el campo (más 2 de los que el plan original no había listado, encontrados durante la implementación: `runProcessCustomDate` y `runProcessFromSidebarFecha` tenían el mismo patrón de solo-formato). Verificado en vivo: `32/99/2026` → toast de error, campo revierte al valor válido anterior, no persiste.
- **#10:** **Paso 0 no se pudo completar** — el caso crítico (expediente real sin movimientos) seguía sin candidato conocido, misma limitación que R6.4. Sin poder confirmar ese edge case, **se aplicó la alternativa segura del plan: aceptado como comportamiento intencional, sin cambio de código.** El diseño del fix (`usageSuccessPredicate`) queda documentado arriba para retomar si en el futuro aparece un candidato.

**Release:** `v2.7.42` (tag `electron-v2.7.42`), commits `bdc5d6b` (fixes) + `ce149a1` (versión visible). Probado con `npm start` y `npm run build:dir` (`.exe` empaquetado real) antes de publicar. **Mismo bug de infraestructura de siempre en `npm run release`** (el proceso creó el release con solo el `.blockmap`) — corregido subiendo `.exe` + `latest.yml` manualmente vía API de GitHub (SHA512 verificado contra el `.exe` local antes de subir). Verificado: `releases/latest` resuelve a 2.7.42 con los 3 assets, landing y portal en vivo muestran la versión nueva.

**Hallazgos del Bloque R tras este cierre:** #1-4 (sesiones previas) y #6/#7 corregidos y en producción. #5 y #10 cerrados sin cambio de código (decisión operativa / aceptado como intencional). #9 pendiente de prueba manual del operador (instalación real, fuera de este plan).

---

## #5 — Verificación diaria no corre (NO es bug de código)

### Diagnóstico (confirmado contra el código)
`electron-app/src/verification/dailyVerification.js` funciona correctamente:
- `isDueNow()` (línea 96) devuelve `true` solo si: habilitado + no es modo `manual` + no corrió hoy + la hora actual pasó `horaUmbral`.
- Cuando corresponde, con `requerirConfirmacion:true` (default, línea 27) muestra un diálogo "¿Ejecutar ahora?" (línea 138-152).
- Si el operador clickea **"Posponer"** (o no está para clickear), retorna `'pospuesta'` **sin actualizar `ultimaEjecucion`** → en el próximo chequeo vuelve a preguntar. **Esto es correcto por diseño.**

Durante el Bloque R el diálogo apareció 5/5 veces y se pospuso siempre a propósito (el testing no debía gastar ~2 min en una verificación ajena al caso en curso). **Por eso nunca corrió y el semáforo del dashboard quedó amarillo — no hay ningún bug.**

### Corrección primaria (operativa, sin código, cero riesgo)
Si se quiere que la verificación corra **desatendida** (semáforo verde), el operador edita, en su máquina, el archivo:
```
%APPDATA%\procurador-electron\verificacion_config.json
```
y pone:
```json
"requerirConfirmacion": false
```
Con eso, `checkAndMaybeRun()` la corre sin diálogo apenas pasa la `horaUmbral` (con la app abierta y logueada con la cuenta de prueba, CUIT 27320694359). Consume cuota real de esa cuenta a diario — es el objetivo de SEC-2·B.2. **Esta es la decisión operativa recomendada.**

### Corrección opcional (código, baja prioridad — NO recomendada salvo pedido)
Si se prefiere conservar la confirmación pero dejar de "acumular" diálogos: agregar en `dailyVerification.js` un contador de posposiciones del día que, tras N (ej. 2), deje de preguntar hasta el día siguiente. **Ojo: esto NO hace que corra — solo reduce el diálogo.** No aporta al objetivo real (que corra), así que por defecto **no se implementa**.

### Acción para este plan
Reclasificar #5 como **"no es bug — decisión operativa"**. Confirmar con el operador si quiere `requerirConfirmacion:false` (desatendido) o dejarlo como está (requiere su click). No entra en la release de código.

---

## #6 — El batch no valida el formato de cada línea del `.txt`

### Diagnóstico (confirmado)
- `select-batch-file` (`main.js:1864-1881`) lee el `.txt` y devuelve `lines` = líneas no vacías **sin validar formato**.
- Los **dos** modales que lo consumen muestran el conteo crudo `lines.length`:
  - **Procurar por Lote** (`renderer.js:2866-2876`, `setupProcurarCustomModal`).
  - **Informe por Lote** (`renderer.js:2767-2775`).
- Ya existe la función validadora `parseExpedienteStr` (`main.js:1855-1862`): valida formato `^(\w+)\s+(\d+)\/(\d{4})$` **y** que la sigla de jurisdicción exista en `JURISDICCION_MAP`. El batch de informe ya la usa en ejecución (`main.js:1953`), pero el conteo previo que ve el usuario no.

### Fix (quirúrgico, reutiliza la validación que ya existe)
**Paso 1 — `main.js`, handler `select-batch-file` (línea 1874-1877):** clasificar las líneas con `parseExpedienteStr` y devolver campos **adicionales** (sin quitar `lines`, para no romper nada):
```js
const rawLines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
const validLines   = rawLines.filter(l => parseExpedienteStr(l) !== null);
const invalidLines = rawLines.filter(l => parseExpedienteStr(l) === null);
return {
    success: true,
    path: result.filePaths[0],
    lines: rawLines,                 // se conserva (retrocompat)
    validLines,
    invalidLines,
    validCount: validLines.length,
    invalidCount: invalidLines.length
};
```

**Paso 2 — `renderer.js`, Procurar por Lote (`setupProcurarCustomModal`, ~línea 2866):**
- Usar `res.validLines` (no `res.lines`) para `_procurarCustomLines`.
- Pasar `res.validLines.length` a `_actualizarAvisoBatchLimits`.
- Si `res.invalidCount > 0`, mostrar en `resumenCustom` un aviso: `N válido(s), M omitido(s) por formato inválido`. Si `res.validCount === 0`, dejar el botón deshabilitado con "Ningún expediente válido en el archivo".

**Paso 3 — `renderer.js`, Informe por Lote (~línea 2767-2775):**
- `informeBatchLines = result.validLines;`
- Preview: `${result.validCount} expediente(s) válido(s)${result.invalidCount ? ` — ${result.invalidCount} omitido(s) por formato` : ''}`.
- Si `validCount === 0`, no habilitar la ejecución (mensaje claro).

### Alcance / riesgo
- Toca: `main.js` (1 handler, cambio **additivo**) + `renderer.js` (2 handlers de carga).
- **No toca** scripts encriptados, backend, ni la lógica de ejecución (que ya filtraba inválidos con `parseExpedienteStr`). Al enviar ahora solo `validLines`, la ejecución recibe entradas ya saneadas → más seguro que antes, no menos.
- Riesgo **bajo**. Confirmar de paso que `runProcurarCustom`/`run-process-custom` toleran recibir la lista ya pre-filtrada (deberían — es un subconjunto de lo que antes recibían).

### Verificación
- Cargar `r62_malformado.txt` (2 válidos + 3 basura: texto libre, `FCR/2018`, `12345`) en **ambos** modales → debe mostrar **"2 válidos, 3 omitidos"**, no "5 cargados".
- Cargar un `.txt` 100% válido → sin aviso de omitidos, conteo correcto.
- Ejecutar un batch de los válidos → corre igual que antes.

---

## #7 — El campo "Fecha Límite" acepta fechas imposibles

### Diagnóstico (confirmado)
- Sidebar `sidebarFechaLimite`, handler `change` (`renderer.js:421-430`): persiste `this.value.trim()` a `config.general.fechaLimite` **sin validar nada**.
- `procurar-hoy` (`renderer.js:333`) lo lee con solo chequeo de vacío.
- El modal Procurar por Lote (`renderer.js:2884`) valida **formato** con `/^\d{2}\/\d{2}\/\d{4}$/` pero **no rango** → `32/99/2026` igual pasa (mismo bug latente).

### Fix (solo `renderer.js`, agrega un validador de calendario)
**Paso 1 — helper nuevo** (cerca de `hoyDDMMYYYY`, ~línea 324):
```js
function esFechaValidaDDMMYYYY(str) {
    const m = String(str || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return false;
    const dia = +m[1], mes = +m[2], anio = +m[3];
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
    const d = new Date(anio, mes - 1, dia);
    // Reconstruir descarta fechas imposibles (31/02, 32/xx, etc.)
    return d.getFullYear() === anio && d.getMonth() === mes - 1 && d.getDate() === dia;
}
```

**Paso 2 — sidebar change handler (línea 421):** si el valor no está vacío y `!esFechaValidaDDMMYYYY(fecha)` → notificar ("Fecha inválida, usá DD/MM/YYYY"), marcar el campo (ej. borde rojo temporal) y **no persistir** el valor inválido (no escribir en `config.general.fechaLimite`).

**Paso 3 — `procurar-hoy` (línea 333):** si hay valor y no es válido → `showNotification(...)` y **abortar** (no ejecutar con fecha basura). Si está vacío, se conserva el comportamiento actual (autocompletar hoy).

**Paso 4 — modal Procurar por Lote (línea 2884):** reemplazar el regex de solo-formato por `esFechaValidaDDMMYYYY(fecha)` (cierra el mismo bug de rango de paso, mismo mensaje de error).

### Alcance / riesgo
- Solo `renderer.js`. No toca `main.js`, backend ni scripts.
- Riesgo **muy bajo**: solo agrega validación. El caso feliz (DD/MM/YYYY válido) queda idéntico — verificar que el helper acepta exactamente lo que hoy funciona.

### Verificación
- `32/99/2026` → rechazado con aviso, **no** persiste en `config_proceso.json`.
- `31/02/2026` → rechazado.
- `23/07/2026` (válida) → aceptada, persiste, procura normal.
- Campo vacío → sigue autocompletando hoy (sin regresión).

---

## #10 — El informe de un expediente inexistente consume `informe_usage`

### Diagnóstico (confirmado)
- `logExecution` (`authManager.js:853-859`) reporta `success = (code === 0)`; el subsistema sale de `getSubsystemForScript('informequickscwpjn.js')` → `'informe'`.
- El backend `log-execution` (`client.js:320`, `if (usageCol && success)`) incrementa `informe_usage` cuando `success` es `true`.
- El script `informequickscwpjn.js` sale con **code 0** aun cuando el expediente no existe → se cuenta el uso. Confirmado en el Bloque R: `informe_usage` 1→2 tras informar `FCR 999999/2099`.
- **Señal confiable ya presente en el código:** el path individual (`main.js:1932-1944`) ya detecta si se generó PDF buscando en `output` los marcadores `Archivo PDF generado en:` / `PDF generado exitosamente:`. "Hubo PDF" = "hubo un informe real que reportar".

### ⚠️ PASO 0 OBLIGATORIO — descubrimiento antes de tocar código
Antes de aplicar el fix, correr la app (computer-use o el operador) y **capturar el `output` real** de estos 3 casos, para confirmar los marcadores y descartar falsos negativos:
1. **Expediente inexistente** (ej. `FCR 999999/2099`) → esperado: el output **NO** contiene el marcador de PDF.
2. **Expediente válido con movimientos** → esperado: el output **SÍ** contiene el marcador de PDF.
3. **Expediente válido SIN movimientos** (si se consigue un candidato, ver R6.4) → **verificar si genera PDF igual.** Este es el caso crítico: si un informe legítimo sin movimientos NO produce PDF, el predicate lo dejaría sin contar (falso negativo).

**Si el caso 3 genera PDF → el fix es seguro. Si NO lo genera (o el marcador no es confiable) → NO aplicar el fix de código; usar la alternativa de abajo.**

### Fix (Electron, quirúrgico — NO toca script encriptado ni backend)
**Paso 1 — `authManager.js`, `executeRemoteScriptAsLocal` (~línea 851-859):** agregar una opción `usageSuccessPredicate` que **solo** sobreescribe la señal de conteo de uso, dejando `resolve/reject` (línea 866) intactos (basados en `code === 0` → el flujo de UI no cambia):
```js
const usageSuccess = (typeof opts.usageSuccessPredicate === 'function')
    ? !!opts.usageSuccessPredicate(output, code)
    : (code === 0);
await this.backendClient.logExecution(
    scriptName,
    usageSuccess,                                   // ← antes: code === 0
    code !== 0 ? `Proceso terminó con código ${code}` : null,
    totalTime,
    subsystem
);
```
> Confirmar el nombre exacto del parámetro de opciones que recibe `executeRemoteScriptAsLocal` (el objeto donde ya viven `extraFiles`/`extraEnv`/`processLabel`/`silentStart`) y leer `usageSuccessPredicate` de ahí.

**Paso 2 — `main.js`, informe individual (línea 1925) y batch (línea 1991):** pasar el predicate en las opciones:
```js
usageSuccessPredicate: (out) => /Archivo PDF generado en:|PDF generado exitosamente:/.test(out || '')
```

### Alcance / riesgo
- Toca: `authManager.js` (1 punto, con **default retrocompatible**: sin predicate → `code === 0`, idéntico a hoy) + `main.js` (las 2 llamadas de informe).
- **Ningún otro script pasa el predicate** → procuración, monitor y procurar-lote quedan 100% idénticos.
- Riesgo **medio**, concentrado en el edge case del PASO 0 (informe legítimo sin PDF). Por eso el descubrimiento es obligatorio.

### Alternativa (si el PASO 0 es ambiguo) — aceptar como intencional, cero código
Documentar que **cualquier consulta real al PJN cuenta como uso** (el costo de la consulta ya se ejecutó, independiente de si el expediente existía). Es una postura defendible. En ese caso #10 se cierra **sin cambio de código**, solo actualizando la fila del hallazgo y la expectativa del caso R6.1. **El operador decide entre el fix o esta alternativa según el resultado del PASO 0.**

### Verificación (si se aplica el fix)
- Informe a `FCR 999999/2099` → `informe_usage` **NO** sube (SQL antes/después).
- Informe a un expediente real con movimientos → `informe_usage` **+1** (no romper el caso feliz).
- Batch con 1 inexistente + 1 válido → sube solo 1.

---

## Orden de ejecución sugerido (Sonnet, esfuerzo medio)

1. **#5** — confirmar con el operador la decisión de config (`requerirConfirmacion:false` o dejar como está). Sin código, sin release. Actualizar la fila del hallazgo.
2. **Backup** DB + tag de recupero (`pre-fix-hallazgos-r-2026-07-23`).
3. **#7** — el más simple y contenido (solo `renderer.js`). Implementar + `npm start` para probar los 4 casos.
4. **#6** — `main.js` + `renderer.js`. Implementar + probar con `r62_malformado.txt` en ambos modales.
5. **#10 PASO 0** — capturar los 3 outputs reales (computer-use/operador). **Decidir fix vs. aceptar-como-intencional según el caso 3.**
6. **#10** — si se aplica: `authManager.js` + `main.js`. Verificar por SQL que el caso feliz sigue contando y el inexistente no.
7. **Probar la build sin instalar:** `npm run build:dir` (`.exe` empaquetado real, arranque limpio).
8. **Release Electron** (`v2.7.42` con #6+#7+#10) siguiendo el checklist del proyecto: bump versión, `git tag electron-v2.7.42` + push, `npm run release`, actualizar los **5 lugares de versión visible** (portal `app.js` + landing `index.html` ×4), deploy + verificar en vivo.
9. **Commit** por hallazgo o agrupado, push, actualizar CLAUDE.md + las filas de hallazgos del plan de pruebas (#6/#7/#10 → corregidos; #5 → reclasificado; #9 → pendiente de prueba manual del operador).

### Regla de modelo
Todo el plan es ejecutable con **Sonnet, esfuerzo medio**. Ningún paso toca MercadoPago/cobro. Si el ejecutor cree necesario cambiar de modelo, **informa y espera confirmación del operador antes de seguir** (misma regla del Bloque R).
