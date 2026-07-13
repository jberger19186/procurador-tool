# Runbook — mejoras menores de seguridad (SEC-1: DEP-1, DEP-2, AUTH-1)

> 2026-07-13 · Instrucciones concretas para cerrar los hallazgos **menores** de la auditoría SEC-1 (`informe-seguridad-sec1-2026-07-13.md`). Ninguno es urgente ni bloquea la Beta (XSS-1 y NET-1, los accionables, ya se corrigieron).
> Regla de oro del proyecto: **staging → probar → prod, con backup previo.**

## Evaluación de esfuerzo/riesgo (resumen honesto)

| Ítem | Modelo + esfuerzo recomendado | ¿Release Electron? | Riesgo |
|---|---|---|---|
| **DEP-2** nodemailer 6→9 | **Sonnet · medio** | No (solo backend) | Medio (email es crítico → confirmar envío real) |
| **DEP-1** Electron 28→actual | **Sonnet · alto** para bump/build/regresión; **Opus** puntual si aparece un breaking sutil (módulo nativo/empaquetado/auto-updater) | **Sí** | Alto |
| **AUTH-1** JWT device-binding | Variante A (limpiar código muerto): **Sonnet · bajo**. Variante B (binding real): **Opus · medio** (correctitud de auth, sensible) | Sí (variante B) | Bajo (Info) |

> **Criterio general de esta sesión:** trabajo mecánico y bien especificado (bumps, YAML de CI, endpoints CRUD, UI) → **Sonnet**. Trabajo con razonamiento fino o correctitud sensible (análisis de seguridad, lógica de cobro, breaking changes ambiguos, device-binding de auth) → **Opus alto**. Es el mismo patrón que funcionó acá: los bugs de cobro y la auditoría se hicieron con Opus; los deploys y docs con Sonnet.

---

## DEP-2 — Actualizar nodemailer (6.10.1 → 9.x) · **el único "ahora" recomendado**

> **Modelo/esfuerzo: Sonnet · medio.** Es un bump de dependencia + verificación operativa; no hay razonamiento fino. Lo único que Sonnet no puede cerrar solo es confirmar que el email **llega a una bandeja** → ese paso lo valida el operador.

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

## DEP-1 — Actualizar Electron (28 → versión soportada) · **proyecto dedicado, NO "ahora"**

> **Modelo/esfuerzo: Sonnet · alto** para el grueso (bump, ajustar `main.js`/`preload.js`, build, correr los flujos), con **Opus** a mano para diagnosticar un breaking sutil (incompatibilidad de módulo nativo, empaquetado NSIS, o auto-updater que deja de detectar). Requiere **sesión dedicada + release** — no mezclar con otras tareas.

**Contexto:** Electron 28 está EOL (Chromium viejo con CVEs). Mitigado (la app no carga contenido web no confiable), pero conviene actualizar antes del público. **Es un upgrade de major con riesgo alto** — planificarlo como una sesión propia con regresión completa.

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

## AUTH-1 — JWT no atado a dispositivo · **Info, bundlear con un release futuro**

> **Modelo/esfuerzo:** camino A (limpieza) → **Sonnet · bajo** (borrar código muerto, sin release). Camino B (binding real) → **Opus · medio** — toca la lógica de autenticación, donde un error abre o cierra acceso de más; conviene el razonamiento fino de Opus, como se usó para los fixes de auth/cobro de esta sesión.

**Contexto:** el token (`{id, role}`, 1h) es bearer estándar sin binding a `machineId`. Al login se emite un `sessionKey` con `machineId` que **nunca se verifica** (`SESSION_KEY_SECRET` solo firma). El anti-sharing real es el lock de ejecución. Severidad Info/Baja.

**Dos caminos:**

**A) Limpieza (bajo esfuerzo, sin release, sin cambio de seguridad):** eliminar el `sessionKey` no usado para no dar falsa sensación de binding.
- Quitar la generación del `sessionKey` en `routes/auth.js` (~622) y `routes/client.js` (~190), y `SESSION_KEY_SECRET` del `.env` si no se usa en otro lado. Verificar que el cliente Electron no lo consuma (grep en `electron-app/`). Solo backend.

**B) Enforcement real (medio-alto, requiere release Electron):** atar el token al dispositivo.
- Server: incluir `machineId` en el `token` (no solo en el `sessionKey`), y en `authenticateToken` (o en los endpoints sensibles: `execution/start`, `scripts/download`) verificar que el `machineId` del body/header coincida con el del token.
- Cliente Electron: enviar el `machineId` en cada request sensible (ya lo tiene, `machineId.js`).
- Probar en staging: token de machine A + machineId B → rechazo.
- **Requiere release** (el cliente cambia). Conviene hacerlo **junto con DEP-1** (que ya requiere release) para no gastar un release solo en esto.

**Recomendación:** hacer (A) o (B) recién cuando haya un release de Electron en agenda (DEP-1). No amerita un release propio.

---

---

## Fase 3 — SEC-2: modelo y esfuerzo recomendado

> Plan completo: `plan-seguridad-precomercializacion-2026-07.md` (Parte B). Son **dos capas** con perfiles distintos.

### SEC-2 · B.1 — Smoke tests en CI (GitHub Actions)
> **Modelo/esfuerzo: Sonnet · medio.**
- Es trabajo mecánico y bien especificado: escribir `.github/workflows/smoke.yml`, cablear los scripts que ya existen (`smoke-test-pjn.js` API + `dev-tools/smoke-payments.js` + `npm audit`), y configurar los GitHub Actions Secrets (`STAGING_ADMIN_TOKEN`, URL).
- Sin razonamiento fino ni riesgo sobre prod (corre contra staging, informativo). Ideal para Sonnet.
- **No requiere release.** Rápido (una sesión corta).

### SEC-2 · B.2 — Verificación diaria real (procuración + informe reales)
> **Modelo/esfuerzo: Sonnet · alto** para el grueso de implementación, con **Opus** puntual para 2 decisiones de diseño (ver abajo). **Requiere release de Electron.**
- Es la pieza más grande: módulo de verificación en la app (reusa los flujos existentes con expedientes fijos), lectura de credenciales desde Windows Credential Manager, panel de configuración, disparador al encender (Task Scheduler / arranque de la app), botón manual, endpoint `POST /admin/diagnostics/verification` y tarjeta en Diagnóstico con semáforo + alerta >7 días.
- **Grueso (Sonnet · alto):** el endpoint + la tarjeta del dashboard (backend, sin release) y el módulo/panel de la app (Electron, con release) son implementación bien acotada.
- **Puntual con Opus:** (1) el diseño del disparador "una vez al día al primer encendido pasada la hora X" sin correr en cada reinicio (lógica de estado con edge cases), y (2) el manejo seguro de credenciales (leer de Credential Manager sin loguearlas ni mandarlas al backend) — ambos se benefician del razonamiento fino.
- **Conviene bundlear el release con DEP-1** (Electron) para no gastar dos releases.

---

## Orden sugerido

1. **SEC-2 · B.1** (CI) — **Sonnet medio**, rápido, sin release, cierra la capa de regresiones nuestras.
2. **DEP-2** (nodemailer) — **Sonnet medio**, backend, cierra el último `high`.
3. **DEP-1 + AUTH-1(B) + SEC-2 · B.2** — **juntos en una sesión dedicada con release de Electron** (Sonnet alto + Opus puntual). Es lo más pesado y lo único que necesita release de la app.
