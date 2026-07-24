# Propuesta de corrección — Hallazgo #11 (notificaciones "SnoreToast")

> Generado 2026-07-23 (Opus, tras investigación del código real). **Para ejecutar con Sonnet, esfuerzo medio.**
> **Regla de oro:** fix **quirúrgico**, sin cambiar qué notificaciones aparecen ni tocar el resto del proyecto. Backup previo.

---

## Diagnóstico (confirmado contra el código)

**Síntoma (R2.3, instalación real de v2.7.42):** en el Centro de Notificaciones de Windows (Win+N), el remitente/grupo de las notificaciones del flujo "Procurar" aparece como **"SnoreToast"**, no "Procurador SCW". El contenido de la notificación es correcto — es solo la identidad de app que Windows usa para agrupar.

**Causa raíz:** el script `backend-server/scripts/procesarNovedadesCompleto.js` (el que corre el flujo **"Procurar"**) emite notificaciones vía **`node-notifier` directamente**, en **4 call sites**, **sin pasar `appID`**:

| Línea | Contexto |
|---|---|
| 252 | "Procurar Expedientes" — sin expedientes para procesar |
| 501 | "Procurar Expedientes - Completado" |
| 541 | "Procurar Expedientes - Error" |
| 960 | "Procurar Expedientes - Error Fatal" (tras agotar reintentos) |

`node-notifier` en Windows usa **SnoreToast.exe** como backend. Sin un `appID`, SnoreToast registra el toast bajo su propio AUMID → el Centro de Notificaciones muestra **"SnoreToast"**.

**Por qué las notificaciones del proceso principal SÍ están bien:** `electron-app/src/notifications/notificationManager.js` usa `electron.Notification` (nativa), que respeta el AUMID configurado con `app.setAppUserModelId('com.procurador.scw')` (main.js) → esas muestran "Procurador SCW". **El bug original de v2.7.34 (`electron.app.Electron`) está resuelto; este #11 es distinto y más sutil.**

**Alcance acotado:** el problema **solo afecta al flujo "Procurar"** (`procesarNovedadesCompleto.js`). Los otros scripts (`informequickscwpjn.js` Informe, `procesarMonitoreo.js` Monitor, `procesarCustomExpedientes.js` Batch) **NO** tienen llamadas propias a `node-notifier` (verificado por grep) → no tienen este problema (solo emiten las notificaciones del proceso principal, correctamente marcadas).

---

## Fix recomendado (mínimo, preserva el comportamiento exacto)

Agregar `appID: 'com.procurador.scw'` a cada uno de los **4** `notifier.notify({...})` de `procesarNovedadesCompleto.js`. Ejemplo (call site de la línea 541):

```js
notifier.notify({
    appID: 'com.procurador.scw',   // ← NUEVO: SnoreToast usa el AUMID de la app instalada
    title: 'Procurar Expedientes - Error',
    message: `❌ Error: ${error.message}`,
    sound: config.notificaciones.sonido
});
```

Aplicar la **misma línea** `appID: 'com.procurador.scw',` como primer campo en los 4 objetos (líneas 252, 501, 541, 960). No cambiar nada más de cada objeto.

**Por qué `com.procurador.scw`:** es exactamente el mismo valor en los 3 lugares que ya lo usan — `build.appId` (`package.json:52`), el AUMID de `app.setAppUserModelId('com.procurador.scw')` (main.js), y el AUMID que el instalador NSIS le pone al acceso directo del menú Inicio. SnoreToast, al recibir ese `appID`, encuentra el acceso directo con ese AUMID y registra el toast bajo la identidad de la app → "Procurador SCW".

**Soporte confirmado:** `node-notifier` v10.0.1 acepta `appID` en las opciones de `notify()` — mapea al argumento `-appID <App.ID>` de SnoreToast ("use the provided app id"). Verificado en `node_modules/node-notifier/lib/utils.js` (línea 362, `appID` está en la lista de opciones permitidas del toaster).

---

## Por qué NO se recomienda eliminar las notificaciones del script (alternativa descartada)

Una alternativa sería borrar los 4 `notifier.notify()` del script y dejar que solo notifique el proceso principal de Electron (que ya está bien marcado, como en los otros 3 scripts). **No se recomienda** por un riesgo concreto:

- La notificación de **éxito** del proceso principal (`authManager.js:813`) lee las estadísticas de `descargas/procesos_automaticos/` — **subcarpeta que fue ELIMINADA en v2.7.33** (los archivos ahora van directo en `descargas/`). Si esa ruta ya no existe, el `if (fs.existsSync(procesosPath))` es falso y **no dispara ninguna notificación de completado** desde el proceso principal.
- En ese caso, la notificación del script (`notifier.notify` "Completado") sería la **única** que ve el usuario al terminar una procuración. Borrarla dejaría al flujo "Procurar" **sin aviso de completado**.

El fix recomendado (agregar `appID`) **no toca este comportamiento** — solo corrige la etiqueta del remitente, sin cambiar qué notificaciones aparecen. Es la opción de menor riesgo.

> **Nota lateral (no forma parte de este fix, solo para tener registrado):** ese `procesos_automaticos/` stale en `authManager.js:813` es un posible bug latente propio (la notificación de completado del proceso principal quizás no dispara nunca desde v2.7.33). No se investiga acá para no ampliar el alcance; queda anotado como candidato a revisar por separado.

---

## Alcance / distribución

- **NO requiere release de Electron.** El script se distribuye **cifrado desde el servidor** (no está bundleado en la app). Flujo (ya documentado en CLAUDE.md, sección "Actualizar scripts de automatización"):
  1. Editar el fuente local `backend-server/scripts/procesarNovedadesCompleto.js` (4 líneas).
  2. `scp` del archivo al servidor.
  3. `node reencrypt_scripts.js` en el servidor (re-cifra y guarda en la BD).
  4. `pm2 restart procurador-api`.
  5. Los clientes instalados re-descargan el script en el próximo check (`GET /client/scripts/check/:name` detecta el hash nuevo).
- **Solo toca `backend-server/scripts/procesarNovedadesCompleto.js`** (4 líneas). No toca `src/security/`, ni `utils/scriptEncryption.js`, ni el resto de scripts, ni el backend de rutas, ni el frontend, ni la DB.

---

## Verificación

- **Solo verificable en la app INSTALADA** (igual que el fix v2.7.34): SnoreToast necesita el acceso directo NSIS con el AUMID `com.procurador.scw`, que **solo existe en la app instalada**, no en `npm start`. **Ventaja:** la instalación real de v2.7.42 que quedó en el sistema del operador (tras R2.1) sirve directamente para probar.
- **Pasos:** con la app instalada, forzar una notificación del flujo "Procurar" (una corrida que complete o falle) → abrir el Centro de Notificaciones (Win+N) → el remitente debe decir **"Procurador SCW"**, no "SnoreToast".
- **Confirmar la re-descarga:** verificar que un cliente instalado toma el script actualizado (revisar el hash/versión del script en la BD vs. el que tiene el cliente, o forzar una re-descarga). Si el flujo de check por hash no dispara la re-descarga sola, evaluar bumpear la versión del script en la BD.
- **Chequeo de no-regresión:** el resto de las notificaciones (Informe, Monitor, Batch, y las del proceso principal) deben seguir igual — este cambio no las toca.

---

## Modelo / esfuerzo

**Sonnet, esfuerzo medio.** Cambio mecánico (4 líneas idénticas) + el flujo de reencrypt/redeploy ya está documentado en CLAUDE.md. Backup previo (`.7z` o al menos tag). No toca MercadoPago/cobro ni lógica de negocio. Si el ejecutor cree necesario cambiar de modelo, informa y espera confirmación del operador (misma regla del Bloque R).
