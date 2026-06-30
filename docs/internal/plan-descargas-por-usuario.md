# Plan de implementación — Carpeta de descargas por usuario (CUIT)

> Estado: **✅ IMPLEMENTADO y en producción (2026-06-30, release app v2.7.30).**
> Creado: 2026-06-29. Implementado: 2026-06-30.
> Commits: `c4ec0ac` (impl) · `d2f8a3b` (fix informequick) · `87c7112` (release). Validado E2E con CUIT 27320694359.
> **Hallazgo de la implementación:** `informequickscwpjn.js` (§5.3) **sí** requería cambio — su `DOWNLOADS_DIR=__dirname/descargas` resolvía `__dirname`→raíz `userData` en el `fork` (no a la carpeta temporal como se asumía acá), dejando los backups `_temp/<exp>_backup/*.json` en la carpeta compartida. Fix: `DOWNLOADS_DIR = path.join(process.env.PROCURADOR_DATA_DIR || __dirname, 'descargas')`. Lo cazó la prueba E2E en vivo.
> Complejidad estimada: **media** · Riesgo: **bajo-medio** (contenible con prueba E2E de 2 cuentas).
> Componentes afectados: app Electron (`main.js`) + scripts encriptados (`backend-server/scripts/`).
> **Sin cambios de DB.** Sin tocar cobranza, auth ni la zona protegida de cifrado/credenciales.

---

## 1. Problema

La app Electron recuerda varias cuentas (multi-usuario en una misma PC), pero **todas las descargas van a una única carpeta compartida**:

```
%APPDATA%\procurador-electron\descargas\
├── procesos_automaticos\   ← Excel de procuración/informe (proceso_<timestamp>.xlsx)
├── visor_generado.html     ← visor de procuración
├── visor_monitoreo.html    ← visor del monitor
├── ultimo_proceso.json
├── <CUIT>_temp\            ← carpeta temporal de descarga (esto YA usa CUIT)
└── ... PDFs de expedientes
```

Si en la misma máquina trabajan María (CUIT A) y Juan (CUIT B), sus Excel, visores y PDFs se mezclan. Los botones "Abrir descargas", "Último Excel" y los visores muestran lo del **último que ejecutó**, no lo del usuario logueado.

**Objetivo:** que cada usuario tenga su propia carpeta de descargas, identificada por **CUIT** (único, asignado por el admin), y que la app acceda siempre a la carpeta del usuario logueado.

---

## 2. Arquitectura actual (cómo se construye la ruta hoy)

Hay **dos capas** que arman la ruta de descargas y **deben coincidir** o el cliente no encuentra lo que el script descargó.

### Capa 1 — Scripts encriptados (los que *escriben* los archivos)
Son los `.js` de `backend-server/scripts/` que se distribuyen **cifrados** (AES + firma RSA) y corren en el cliente. Construyen la ruta con `getDataPath()` + `'descargas'`.

`getDataPath()` (ej. [`consultarscwpjn.js:21`](../../backend-server/scripts/consultarscwpjn.js), [`testM2.js:38`](../../backend-server/scripts/testM2.js), [`procesarNovedadesCompleto.js:32`](../../backend-server/scripts/procesarNovedadesCompleto.js)):

```js
function getDataPath() {
    // PRIORIDAD 1: si APPDATA incluye 'procurador-electron', usarlo
    if (process.env.APPDATA && process.env.APPDATA.includes('procurador-electron')) {
        return process.env.APPDATA;
    }
    // PRIORIDAD 2: desarrollo → __dirname
    const isPackaged = process.resourcesPath && process.resourcesPath !== __dirname;
    if (!isPackaged) return __dirname;
    // PRIORIDAD 3: fallback empaquetado → %APPDATA%\procurador-electron
    const appDataPath = process.env.APPDATA || process.env.HOME;
    return path.join(appDataPath, 'procurador-electron');
}
```

> En el empaquetado, `getDataPath()` resuelve a `%APPDATA%\procurador-electron` = `app.getPath('userData')`. Coincide con la Capa 2.

**Scripts que usan `getDataPath()`** (5):
`consultarscwpjn.js` · `procesarCustomExpedientes.js` · `procesarMonitoreo.js` · `procesarNovedadesCompleto.js` · `testM2.js`

**⚠️ Caso especial — `informequickscwpjn.js`:** NO usa `getDataPath()`. Define
[`informequickscwpjn.js:7`](../../backend-server/scripts/informequickscwpjn.js) `const DOWNLOADS_DIR = path.join(__dirname, 'descargas')` y lo pasa a varias funciones (líneas 612, 699, 950, 1108, 1125). Hay que revisarlo aparte (ver §5.3).

### Capa 2 — `main.js` (el que *lee* esos archivos y escribe el visor del monitor)
Usa `app.getPath('userData')` + `'descargas'` en ~11 puntos:

| Línea | Handler / uso |
|---|---|
| [`main.js:1426`](../../electron-app/main.js) | `open-downloads-folder` |
| [`main.js:1446`](../../electron-app/main.js) | `clean-folder` (temp) |
| [`main.js:1461`](../../electron-app/main.js) | `clean-folder` (procesos) |
| [`main.js:1471`](../../electron-app/main.js) | `clean-folder` (all) |
| [`main.js:1689`](../../electron-app/main.js) | `get-visor-path` |
| [`main.js:1703`](../../electron-app/main.js) | `get-latest-excel` |
| [`main.js:1945`](../../electron-app/main.js) | resumen batch (`writeFileSync`) |
| [`main.js:2302`](../../electron-app/main.js) | visor monitor (descDir) |
| [`main.js:2495`](../../electron-app/main.js) | visor (descDir) |

### Cómo se comunican las capas
- Procuración / informe / monitor corren en un **sandbox VM que comparte `process.env` del proceso principal** ([`scriptExecutor.js:62,110`](../../electron-app/src/scripts/scriptExecutor.js)). Por eso `getDataPath()` puede leer una env var seteada por `main.js`.
- Algunos scripts auxiliares se ejecutan con `fork()` y reciben `env` explícito ([`main.js:2529,2566`](../../electron-app/main.js)) — pero esos (`abrirNavegadorPJN`, `agregarPasswordSCW`) **no descargan archivos**.

### El identificador ya está disponible
El CUIT del usuario logueado se obtiene de forma fiable en `main.js`:
```js
const sessionInfo = await authManager.verifySession();
const cuit = sessionInfo?.user?.cuit;   // asignado por el admin, único
```
Ya se usa así en procuración/informe/monitor ([`main.js:1128,1215,1304,1797`](../../electron-app/main.js)). **No hay que inventar el identificador.**

---

## 3. Diseño propuesto

### Carpeta base por CUIT
Insertar un segmento `usuarios\<CUIT>` entre `procurador-electron` y `descargas`:

```
%APPDATA%\procurador-electron\usuarios\20123456789\descargas\...
%APPDATA%\procurador-electron\usuarios\27320694359\descargas\...
```

Mantener `descargas` adentro **evita reescribir las subrutas** (`procesos_automaticos`, visores, `_temp`): solo cambia la **raíz**.

### Contrato entre capas: env var explícita
Introducir `PROCURADOR_DATA_DIR` como **fuente de verdad** de la base por usuario:
- `main.js` la calcula desde el CUIT de sesión y la setea antes de ejecutar.
- Los scripts la respetan **primero** en `getDataPath()`.

> Se eligió una env var nueva y explícita (no reutilizar `APPDATA`) para evitar mutar un env global compartido y sus efectos colaterales.

### Helper único en `main.js`
```js
// Devuelve la carpeta base de datos del usuario (por CUIT).
// Fallback a la carpeta histórica si no hay CUIT (no rompe sesiones sin CUIT).
function getUserDataDir(cuit) {
    const base = app.getPath('userData'); // %APPDATA%\procurador-electron
    const safe = String(cuit || '').replace(/\D/g, ''); // solo dígitos
    if (!safe) return base;                              // fallback histórico
    return path.join(base, 'usuarios', safe);
}
```

> **Importante:** la env var `PROCURADOR_DATA_DIR` debe apuntar a la carpeta que `getDataPath()` usa como raíz **antes** de agregar `'descargas'`. Como hoy `getDataPath()` retorna la carpeta que ya contiene `descargas`, hay que setear `PROCURADOR_DATA_DIR = getUserDataDir(cuit)` (sin `descargas`), y los scripts harán `path.join(getDataPath(), 'descargas', …)` igual que ahora.

---

## 4. Plan por fases (orden de menor a mayor riesgo)

### Fase 1 — Helper + Capa 2 en `main.js` (riesgo casi nulo)
No cambia dónde escriben los scripts todavía → con fallback, nada se rompe.

1. Agregar `getUserDataDir(cuit)` en `main.js`.
2. En cada handler que hoy usa `app.getPath('userData')/descargas`, obtener el CUIT de sesión y pasar por el helper.
   - Para handlers que ya resuelven la sesión (procuración/informe/monitor): reutilizar el `cuit` que ya leen.
   - Para handlers "pasivos" (`open-downloads-folder`, `get-visor-path`, `get-latest-excel`, `clean-folder`): agregar un `await authManager.verifySession()` para obtener el CUIT, con fallback a la base si falla.
3. **`clean-folder` debe limpiar solo la carpeta del usuario actual**, no la global.
4. Mientras la Fase 2 no esté, mantener el fallback de modo que la lectura siga apuntando a `descargas\` raíz (compatibilidad con lo ya descargado).

> Resultado de Fase 1: `main.js` ya enruta por usuario, pero como los scripts siguen escribiendo en la raíz, conviene activar el ruteo real recién con la Fase 2. Se puede mergear y publicar Fase 1 sin efecto visible (queda "armada").

### Fase 2 — Capa 1 en los scripts + activación (riesgo medio: sincronización)
1. Modificar `getDataPath()` para dar **prioridad 0 a `PROCURADOR_DATA_DIR`**:
   ```js
   function getDataPath() {
       if (process.env.PROCURADOR_DATA_DIR) return process.env.PROCURADOR_DATA_DIR;
       // ... resto igual (APPDATA, __dirname, fallback)
   }
   ```
   Aplicar en: `consultarscwpjn.js`, `procesarCustomExpedientes.js`, `procesarMonitoreo.js`, `procesarNovedadesCompleto.js`, `testM2.js`.
2. Resolver el **caso especial `informequickscwpjn.js`** (ver §5.3).
3. En `main.js`, **setear `process.env.PROCURADOR_DATA_DIR = getUserDataDir(cuit)`** justo antes de ejecutar cada flujo (procuración, informe, monitor) — y para los `fork()`, agregarla al objeto `env`.
4. **Re-encriptar y redeployar** los scripts (ver §6).
5. Quitar el fallback "a la raíz" de la Fase 1: ahora la lectura apunta a la carpeta del usuario.

### Fase 3 — Migración de datos existentes (opcional)
Al primer arranque con la versión nueva, si existe `descargas\` en la raíz vieja:
- **Opción conservadora:** dejarla como "legado" y empezar limpio (no migrar).
- **Opción completa:** mover `descargas\` → `usuarios\<CUIT actual>\descargas\`. Riesgo: no se sabe de qué usuario era lo viejo. **Recomendado: no migrar automáticamente**; a lo sumo ofrecer un botón manual.

---

## 5. Puntos delicados

### 5.1 Sincronización de las dos capas (riesgo #1)
Si la env var no llega al script, o `main.js` mira otra carpeta, los botones de descargas quedan vacíos. **Síntoma molesto, no peligroso.** Se neutraliza con la prueba E2E de §7.

### 5.2 Sesión sin CUIT
Algunos usuarios podrían no tener CUIT en la sesión. El **fallback** a la carpeta histórica evita que se rompa.

### 5.3 `informequickscwpjn.js` (caso especial)
Usa `path.join(__dirname, 'descargas')`. En el sandbox VM, `__dirname` = carpeta real de `scriptExecutor.js` ([`scriptExecutor.js:67,117`](../../electron-app/src/scripts/scriptExecutor.js)), no `userData`. Antes de tocarlo:
- Verificar **qué escribe realmente** ahí y si el Excel final del informe lo genera este script o el generador de `electron-app/informe/`.
- Si efectivamente escribe descargas del usuario, migrarlo a `getDataPath()` + `PROCURADOR_DATA_DIR` como los demás.

### 5.4 CUIT como nombre de carpeta
Sanitizar a solo dígitos (`replace(/\D/g, '')`) para evitar caracteres inválidos en rutas de Windows.

### 5.5 Perfil de Chrome — fuera de alcance
El perfil de Chrome (`%LOCALAPPDATA%\ProcuradorSCW\ChromeProfile`) **sigue siendo compartido** entre cuentas. Aislar también las credenciales del PJN por usuario es **otro proyecto** (toca la zona protegida de credenciales) y NO es parte de esta mejora.

---

## 6. Re-encriptar y redeployar scripts (Fase 2)

Según el runbook del CLAUDE.md ("Actualizar scripts de automatización"):

```bash
# 1. Subir cada script modificado al servidor
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" \
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/scripts/<nombre>.js" \
  root@142.93.64.94:/var/www/procurador/backend-server/scripts/<nombre>.js

# 2. Re-encriptar (cifra los .js y los guarda en la BD)
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "cd /var/www/procurador/backend-server && node reencrypt_scripts.js"

# 3. Reiniciar API
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 restart procurador-api"
```

> Lo que rige es lo que queda **cifrado en la BD** tras el `reencrypt`, no el archivo fuente local.

---

## 7. Prueba E2E obligatoria antes de publicar (elimina ~80% del riesgo)

Con **dos cuentas de CUIT distinto** en la misma PC, para **cada una**:
1. Procurar → confirmar Excel en `usuarios\<CUIT>\descargas\procesos_automaticos\`.
2. "Último Excel" → abre el del usuario correcto.
3. Visor de procuración → es el del usuario correcto.
4. Informe → Excel y visor del usuario correcto.
5. Monitor → `visor_monitoreo.html` del usuario correcto.
6. "Abrir descargas" → abre **su** carpeta, no la del otro.
7. "Limpiar carpeta" → limpia solo lo suyo.
8. Cambiar de cuenta y repetir: confirmar que **no se mezclan**.

Probar primero en local (`npm start`) o staging. Recién después: release Electron (checklist del CLAUDE.md) + redeploy de scripts.

---

## 8. Rollback
- **Electron:** fix-forward (re-publicar la versión buena con número mayor; el auto-updater no degrada).
- **Scripts:** volver al fuente anterior + `reencrypt_scripts.js` + `pm2 restart`.
- **Datos:** no se borran archivos viejos (la migración Fase 3 es opcional), así que no hay pérdida.

---

## 9. Checklist de implementación

- [x] **Fase 1** — `getUserDataDir(cuit)` en `main.js` (+ `resolveUserDescargasDir()` / `buildRunEnv(cuit)`)
- [x] **Fase 1** — migrar los usos de `app.getPath('userData')/descargas` al helper (con fallback)
- [x] **Fase 1** — `clean-folder` limpia solo la carpeta del usuario
- [x] **Fase 2** — `PROCURADOR_DATA_DIR` con prioridad 0 en `getDataPath()` (5 scripts)
- [x] **Fase 2** — resolver caso `informequickscwpjn.js` (sí requirió fix — ver header)
- [x] **Fase 2** — setear `PROCURADOR_DATA_DIR` en `main.js` antes de cada flujo (vía `extraEnv`/`buildRunEnv`)
- [x] **Fase 2** — re-encriptar + redeploy scripts (`reencrypt_scripts.js` + `pm2 restart`)
- [x] **Prueba E2E** — validada con 1 CUIT real (27320694359) en vivo + harness automático (21/21) que simula 2 CUIT y la retrocompatibilidad. Las 3 vías (procuración/informe/monitor) escriben en `usuarios\<CUIT>\descargas`, raíz intacta
- [x] **Release** Electron v2.7.30 + tag `electron-v2.7.30`
- [ ] **Fase 3** (opcional, NO hecho) — migración de datos viejos: se dejó la raíz `descargas\` como legado (no se migra, según lo recomendado)
