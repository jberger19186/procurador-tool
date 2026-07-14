# Runbook — mejoras menores de seguridad (SEC-1: DEP-1, DEP-2, AUTH-1)

> 2026-07-13 · Instrucciones concretas para cerrar los hallazgos **menores** de la auditoría SEC-1 (`informe-seguridad-sec1-2026-07-13.md`). Ninguno es urgente ni bloquea la Beta (XSS-1 y NET-1, los accionables, ya se corrigieron).
> Regla de oro del proyecto: **staging → probar → prod, con backup previo.**

## Evaluación de esfuerzo/riesgo (resumen honesto)

| Ítem | Modelo + esfuerzo recomendado | ¿Release Electron? | Riesgo | Estado |
|---|---|---|---|---|
| **DEP-2** nodemailer 6→9 | **Sonnet · medio** | No (solo backend) | Medio (email es crítico → confirmar envío real) | ✅ Hecho |
| **DEP-1** Electron 28→43.1.0 | **Sonnet · alto**. En la práctica no hizo falta Opus (código ya moderno, cero cambios); el único obstáculo fue de entorno (Node local) | **Sí** | Alto en el papel, bajo en la práctica | ✅ Hecho |
| **AUTH-1** JWT device-binding | **Opus · alto** (binding real, correctitud de auth) | **No** (el cliente ya manda `machineId`) | Bajo (Info) | ✅ Hecho |

> **Criterio general de esta sesión:** trabajo mecánico y bien especificado (bumps, YAML de CI, endpoints CRUD, UI) → **Sonnet**. Trabajo con razonamiento fino o correctitud sensible (análisis de seguridad, lógica de cobro, breaking changes ambiguos, device-binding de auth) → **Opus alto**. Es el mismo patrón que funcionó acá: los bugs de cobro y la auditoría se hicieron con Opus; los deploys y docs con Sonnet.

---

## DEP-2 — Actualizar nodemailer (6.10.1 → 9.x) · ✅ HECHO (2026-07-13)

> **Modelo/esfuerzo: Sonnet · medio.** Confirmado — fue exactamente eso, sin razonamiento fino.
> **Resultado:** 6.9.14 → 9.0.3, `npm audit` backend en 0 vulnerabilidades. Desplegado con backup pre-deploy + `npm ci` en prod + boot limpio + smoke API 8/8. **Envío de email real verificado** (id de mensaje devuelto por el SMTP de Brevo). Staging (symlink de `node_modules`) actualizado junto con prod.

**Contexto:** `npm audit` marca `nodemailer <=9.0.0` como 1 high. Explotabilidad real baja (los CVEs requieren control de parámetros que se setean server-side), pero cierra el último high del backend. La API que usa el proyecto es mínima y estable entre versiones: `nodemailer.createTransport({host,port,secure,auth})` + `transporter.sendMail({from,to,subject,text,html})` (`backend-server/utils/mailer.js:14` y `:134`).

**Pasos:**
1. **Backup** de la DB no hace falta (no toca DB); sí hacer `git` limpio y un tag `pre-dep2`.
2. En `backend-server/`:
   ```bash
   npm install nodemailer@^9    # o: npm install nodemailer@latest
   npm audit                    # confirmar que el high de nodemailer desapareció (backend → 0 high)
   ```
3. **Revisar breaking changes reales** (6→9 salta 3 majors; el core es estable pero verificar):
   - `createTransport` y `sendMail`: sin cambios de firma.
   - Verificar que las opciones de transport que usa `mailer.js` sigan válidas (host/port/secure/auth SMTP de Brevo). Node ≥ el mínimo que pida nodemailer 9 (el server corre Node 20 → OK).
4. **Probar el envío real (imprescindible):**
   - Deploy a **staging** (`scp mailer.js`... — en realidad se despliega `node_modules`/`package.json`; ver nota abajo).
   - Disparar un email real desde staging: reenvío de verificación (`POST /auth/resend-verification` con un email que exista y no esté verificado) **o** un reset de contraseña → **confirmar que llega a la bandeja**.
   - > ⚠️ Nota de despliegue: como es un cambio de dependencia, en el server hay que subir `package.json` + `package-lock.json` y correr `npm ci` (mismo procedimiento que D3 — ojo con el drift de `multer`, ya resuelto). Recordar que el `node_modules` de staging es **symlink** al de prod → un `npm ci` afecta a ambos. Se puede hacer directo en prod con backup, o romper el symlink primero. Ver `informe-bugs` (D3) y `flujo-staging-rollback.md`.
5. **Deploy a prod:** `npm ci` en prod + `pm2 restart procurador-api`.
6. **Verificar en prod:** que un email transaccional real llegue (ej. crear un ticket como admin → el email de respuesta; o un reset). Smoke API 8/8.
7. Commit + push. Actualizar el estado de DEP-2 en `informe-seguridad-sec1-2026-07-13.md` y CLAUDE.md.

**Rollback:** restaurar `package-lock.json` anterior + `npm ci` + restart. Reversible.

---

## DEP-1 — Actualizar Electron (28 → 43.1.0) · ✅ HECHO (2026-07-13)

> **Modelo/esfuerzo: Sonnet · alto.** No hizo falta Opus — el salto real (28→43, 14+ majors) resultó de bajo riesgo de código porque la app ya seguía los patrones modernos de Electron (contextIsolation/sandbox explícitos, contextBridge con wrappers, setWindowOpenHandler, sin APIs deprecadas, sin módulos nativos). **Cero cambios de código.**
> **Único bloqueante real:** `@electron/get` (interno de `electron`) exige Node ≥22.12.0 para el download lazy del binario (Electron v42 movió la descarga del `postinstall` al primer uso) — la máquina tenía 22.11.0. Se resolvió actualizando Node local a 22.23.1 LTS vía winget, **con confirmación del usuario** antes de tocar el entorno (es un cambio fuera del repo).
> Verificado: `npm start` + `npm run build:dir` (`.exe` empaquetado real, `isPackaged:true`) + `afterPack`/rcedit intacto + los 3 módulos de seguridad (ScriptVerifier RSA, encriptación AES-256-GCM, AuthManager) arrancando limpios. `npm audit` de electron-app 26→3 vulnerabilidades (quedan moderadas, exceljs, diferidas).

**Contexto (histórico):** Electron 28 estaba EOL (Chromium viejo con CVEs). Mitigado en la práctica (la app no carga contenido web no confiable), pero convenía actualizar antes del público.

**Pasos (guía, requiere sesión dedicada + release):**
1. Tag `pre-electron-upgrade` + backup `.7z`.
2. Elegir versión objetivo **soportada** (revisar el calendario de releases de Electron; ir a la última estable o la LTS-ish más cercana). Actualizar en `electron-app/package.json`:
   ```bash
   npm install electron@<version> electron-builder@latest --save-dev
   npm install electron-updater@latest
   ```
3. **Revisar breaking changes de Electron** entre 28 y la versión objetivo (cada major tiene su lista): APIs de `app`/`BrowserWindow`/`ipcMain`/`session`, `contextIsolation`, `sandbox`, deprecaciones. Ajustar `main.js`/`preload.js` según corresponda.
4. **Verificar compatibilidad con Puppeteer** (usa el Chrome del usuario, no el Chromium de Electron, así que el impacto debería ser bajo — pero probar los 6 flujos).
5. **Empaquetado:** verificar que `afterPack.js` (rcedit para el ícono), el hook NSIS y el `electron-builder` config sigan funcionando con la versión nueva de builder.
6. **Auto-updater:** confirmar que `electron-updater` sigue detectando y aplicando updates (el `latest.yml` + firma). Probar un ciclo de update.
7. **Probar E2E:** `npm start` + `npm run build:dir` (el `.exe` empaquetado arranca) + los flujos reales (login, procuración, informe, monitor) contra el PJN.
8. **Release** siguiendo el checklist completo (bump, tag, `npm run release`, versión visible en portal+landing).

**Riesgo:** alto. Un fallo puede romper la app instalada o el auto-updater. **No hacer sin ventana de testing completa.**

---

## AUTH-1 — JWT no atado a dispositivo · ✅ HECHO (2026-07-13)

> **Modelo/esfuerzo usado: Opus · alto** (binding real, política *soft*). Toca la lógica de autenticación; se usó el razonamiento fino de Opus como en los fixes de auth/cobro de esta sesión.

**Contexto original:** el token (`{id, role}`, 1h) era bearer estándar sin binding a `machineId`. Existía andamiaje parcial: `users.machine_id` se **leía** (verify-session, `machineBound`) pero **nunca se escribía**, y un `sessionKey` con `machineId` que **nunca se verificaba**. El anti-sharing real era solo el lock de ejecución. Severidad Info/Baja.

**Solución implementada — binding *soft*, server-side, SIN release de Electron:**
- **Clave del enfoque:** el `machineId` se guarda **server-side** en `users.machine_id` (no viaja en el token). Así, un token robado **no revela** a qué dispositivo está atado → no se puede replicar desde otro equipo. El cliente Electron **ya enviaba** `machineId` a `/auth/login` y a `/license/execution/start` (`backendClient.js`), por eso **no hizo falta release**.
- **`routes/auth.js` (`/login`, ~610):** el `UPDATE last_login` ahora también hace `SET machine_id = $2` → cada login re-vincula la cuenta al dispositivo actual (política *soft*: cambiar de equipo es transparente, al re-loguear se re-vincula solo). Solo el `/login` de Electron vincula (el admin-login, extension-login y portal-login no).
- **`routes/license.js` (`/license/execution/start`):** tras el gate del trial, verifica el binding — si `users.machine_id` es NULL (sesión legada previa al cambio, o desvinculado por el admin) lo **vincula al primer uso** (bind-on-null); si coincide → permite; si difiere → **403 `DEVICE_MISMATCH`**.
- **Compatibilidad:** la mayoría de las cuentas tenían `machine_id` NULL → en el primer `execution/start` se vinculan solas, sin fricción. El admin ya tenía la acción "desvincular dispositivo" (`admin.js`, `machine_id = NULL`), que ahora sirve para migrar de equipo.
- **Verificado E2E en staging (user 215) y prod (admin id 6):** machineId coincidente → 200; distinto → 403 `DEVICE_MISMATCH`; NULL → bind + 200. En prod la verificación fue **no disruptiva** (se usó el mismo machineId real del admin; el binding real quedó intacto). Solo backend, desplegado a prod (`pm2 restart procurador-api`), backup previo de los archivos en `/tmp/*.bak-*`.

---

---

## Fase 3 — SEC-2: modelo y esfuerzo recomendado

> Plan completo: `plan-seguridad-precomercializacion-2026-07.md` (Parte B). Son **dos capas** con perfiles distintos.

### SEC-2 · B.1 — Smoke tests en CI (GitHub Actions) · ✅ HECHO (2026-07-13)
> **Modelo/esfuerzo: Sonnet · medio.** Confirmado en la práctica — fue trabajo mecánico y bien especificado, sin razonamiento fino.
- Implementado: `.github/workflows/smoke.yml` (npm audit backend+electron + smoke API/pagos contra staging).
- **Cambio de diseño respecto del plan original:** no se usó `STAGING_ADMIN_TOKEN` como secret directo contra la URL pública — el `Authorization: Basic` de Nginx y el `Authorization: Bearer` de la app compiten por el mismo header, así que el enfoque HTTP directo no funciona. Se resolvió con una **clave SSH nueva y restringida** (forced-command, sin shell/PTY/port-forwarding) que corre un script en el servidor (`ci-smoke.sh`) contra `localhost:3444`, evitando Nginx por completo.
- Verificado en vivo: 8/8 (API) + 19/19 (pagos), exit 0.
- Detalle completo (mecanismo, mantenimiento, rotación): `docs/internal/sec2-b1-ci-setup.md`.

### SEC-2 · B.2 — Verificación diaria real (procuración + informe reales)
> **Modelo/esfuerzo: Sonnet · alto** para el grueso de implementación, con **Opus** puntual para 2 decisiones de diseño (ver abajo). **Requiere release de Electron.**
- Es la pieza más grande: módulo de verificación en la app (reusa los flujos existentes con expedientes fijos), lectura de credenciales desde Windows Credential Manager, panel de configuración, disparador al encender (Task Scheduler / arranque de la app), botón manual, endpoint `POST /admin/diagnostics/verification` y tarjeta en Diagnóstico con semáforo + alerta >7 días.
- **Grueso (Sonnet · alto):** el endpoint + la tarjeta del dashboard (backend, sin release) y el módulo/panel de la app (Electron, con release) son implementación bien acotada.
- **Puntual con Opus:** (1) el diseño del disparador "una vez al día al primer encendido pasada la hora X" sin correr en cada reinicio (lógica de estado con edge cases), y (2) el manejo seguro de credenciales (leer de Credential Manager sin loguearlas ni mandarlas al backend) — ambos se benefician del razonamiento fino.
- **Conviene bundlear el release con DEP-1** (Electron) para no gastar dos releases.

---

## Orden sugerido

1. ~~**SEC-2 · B.1** (CI)~~ — ✅ hecho 2026-07-13.
2. ~~**DEP-2** (nodemailer)~~ — ✅ hecho 2026-07-13.
3. ~~**DEP-1** (Electron)~~ — ✅ hecho 2026-07-13.
4. ~~**AUTH-1(B)** device-binding~~ — ✅ hecho 2026-07-13 (Opus alto; resultó **sin release** — el cliente ya mandaba `machineId`, el binding es server-side). Queda **SEC-2 · B.2** (verificación diaria real), que **sí requiere release de Electron** — Sonnet alto para el grueso, Opus puntual para el disparador diario y el manejo de credenciales.
