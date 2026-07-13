# Informe de auditoría de seguridad — SEC-1

> Auditoría interna autónoma · 2026-07-13 · Ejecutada contra `staging` (`procurador_db_staging`, localhost:3444) + revisión white-box del código en `main` + verificación de headers/TLS/puertos contra prod (solo lectura).
> Alcance: backend (Express/PostgreSQL), app Electron, extensión Chrome. Método: black-box (pruebas activas contra staging con usuarios descartables) + white-box (lectura de código).
> **No sustituye** una auditoría externa profesional (pentesting manual, análisis de binario del `.exe`, cadenas de exploits). La reduce a "confirmación independiente".
> Base: plan `docs/internal/plan-seguridad-precomercializacion-2026-07.md` (Parte A), 7 bloques / ~30 pruebas.

---

## 1. Resumen ejecutivo

Se ejecutaron los 7 bloques del plan. **La postura de seguridad es sólida** — no se encontró ninguna vulnerabilidad crítica, ni SQL injection, ni IDOR, ni fuga de credenciales, ni bypass de autorización. Los controles de base (JWT fuerte, blacklist al logout, política de contraseñas, anti-enumeración, rate limiting, headers de seguridad, TLS 1.2+, firma RSA de scripts, permisos mínimos de la extensión) **funcionan correctamente**.

Se identificaron **2 hallazgos accionables nuevos** (no conocidos antes de esta auditoría):

| ID | Severidad | Título | Componente |
|---|---|---|---|
| **XSS-1** | 🔴 **Alta** | Stored XSS en el dashboard admin vía campos de usuario sin escapar (título de ticket, nombre de parte del monitor, emails) | dashboard admin |
| **NET-1** | 🟠 **Media** | Puertos de Express (3443 prod / 3444 staging) accesibles desde internet, salteando Nginx (y el basic-auth de staging) | infraestructura |

Más hallazgos menores (dependencias, device-binding, defensa en profundidad) detallados abajo.

**Veredicto:** **apto para Beta controlada tras corregir XSS-1** (una hora de trabajo, solo frontend del dashboard). NET-1 debería cerrarse antes del público. El resto son mejoras de robustez sin urgencia.

---

## 2. Tabla de hallazgos

| ID | Sev. | Bloque | Estado |
|---|---|---|---|
| **XSS-1** | Alta | 4 (inyección) | Abierto — corregir antes de Beta |
| **NET-1** | Media | 5 (config) | Abierto — corregir antes del público |
| **DEP-1** | Media | 1 (deps) | Abierto — Electron 28 EOL, upgrade planificado |
| **DEP-2** | Baja | 1 (deps) | Abierto — nodemailer <9 (params server-side, bajo riesgo real) |
| **AUTH-1** | Baja/Info | 2 (sesión) | Abierto — JWT no atado a dispositivo (sessionKey/machineId sin usar) |
| **BIZ-1** | Baja | 6 (negocio) | Aceptado — descarga de script no gateada (ejecución sí, SEC-4) |
| **UPL-1** | Baja | 4 (uploads) | Abierto — mimetype declarado por el cliente, no sniffeado |
| **DEP-3** | Info | 1 (deps) | Aceptado — `basic-ftp` crítico vía puppeteer, nunca se ejercita |

---

## 3. Detalle de los hallazgos accionables

### XSS-1 — Stored XSS en el dashboard admin (🔴 Alta)

**Componente:** `backend-server/public/dashboard/dashboard.js` (render de tickets, monitor, usuarios).

**Descripción:** el dashboard admin escapa algunos campos (`escHtml` en `description` de ticket, `message` de comentario) pero **renderiza otros campos controlados por el usuario SIN escapar** dentro de `innerHTML`. Confirmado explotable con el **título del ticket** (`t.title`, líneas 663, 1347, 1394) — el usuario elige el título al crear el ticket (`POST /tickets/`, solo se valida longitud ≤200, sin sanitización). Otros vectores del mismo patrón: **`nombre_parte` del monitor** (líneas 791 y, peor, 797, inyectado en un `onclick` con solo escape de comilla simple) y `email`/`user_email` en varios lugares.

**Prueba que lo evidencia (staging):**
1. Como usuario común (id 215) → `POST /tickets/` con `title = <img src=x onerror=alert(document.domain)>` → **201, guardado crudo**.
2. `GET /admin/tickets` (token admin) → devuelve el título **crudo, sin escapar**.
3. Cuando el admin abre la lista/detalle de tickets en el dashboard, `${t.title}` se inyecta en `innerHTML` → el `onerror` ejecuta en el contexto del dashboard.

**Impacto:** un usuario de bajo privilegio (cualquier registrado) logra **ejecución de JS en el navegador del administrador** → robo del token admin (está en `localStorage`), o acciones administrativas ejecutadas como el admin. La CSP vigente **no lo frena**: usa `script-src 'unsafe-inline'` + `script-src-attr 'unsafe-inline'`, que permite handlers inline como `onerror`.

**Remediación:**
1. **Escapar todos los campos controlados por el usuario** en `dashboard.js` con `escHtml()` — mínimo: `t.title` (663, 1347, 1394), `t.user_email` (1345, 1396), `p.nombre_parte` (791, 797), `u.email` (343, 478, 488). Es consistente con cómo ya se escapan `description`/`message`. Barrer TODO el archivo para no dejar ninguno.
2. Para el caso del `onclick` con `nombre_parte` (797): pasar el dato por `data-*` atributo escapado o por un handler que lo tome del DOM, en vez de interpolarlo en el string del `onclick`.
3. **Defensa en profundidad (opcional):** endurecer la CSP quitando `'unsafe-inline'` de `script-src-attr` (requiere migrar los `onclick` inline del dashboard a listeners — trabajo mayor, no urgente si se escapa la entrada).

**Riesgo del fix:** bajo (solo escapa strings al renderizar; no cambia lógica). Frontend del dashboard, sin release de Electron, sin cambios de DB.

---

### NET-1 — Puertos de Express expuestos a internet (🟠 Media)

**Componente:** infraestructura del servidor (142.93.64.94).

**Descripción:** Express escucha en `*:3443` (prod) y `*:3444` (staging) — es decir, en **todas las interfaces**, no solo localhost. El host **no tiene firewall** (`ufw` inactivo). Resultado: ambos puertos son **accesibles directamente desde internet**, salteando Nginx.

**Prueba que lo evidencia:**
- `https://142.93.64.94:3443/health` → **200** con el JSON de health completo (uptime, memoria, latencia de DB, stats de caché) → Express de prod directamente alcanzable.
- `https://142.93.64.94:3444/auth/plan-availability` → **200 sin basic-auth**, mientras que `https://staging-api.procuradortool.com/...` (por Nginx) correctamente da **401**. → **el basic-auth de staging es bypasseable** por el puerto directo.
- `ss -tlnp` confirma `*:3443`/`*:3444` (Express en 0.0.0.0); Postgres sí está bien acotado (`127.0.0.1:5432`).

**Impacto:**
- **Staging:** el control de acceso (basic-auth "equipo") queda anulado — cualquiera con la IP puede acceder a staging (datos de prueba, MP sandbox).
- **Prod:** se saltea la capa Nginx. La app igual exige JWT en los endpoints protegidos (no es fuga directa de datos), pero: (a) se pierde cualquier protección a nivel Nginx; (b) `/health` expone métricas internas sin auth; (c) si Express confía en headers de proxy (`trust proxy`) para el rate-limit por IP, alcanzar Express directo permitiría spoofear `X-Forwarded-For` y evadir el rate limiting por IP.

**Remediación (elegir una):**
1. **Firewall (recomendado, simple):** activar `ufw` permitiendo solo 22 (SSH), 80, 443 → bloquea 3443/3444 desde afuera; Nginx (localhost) los sigue alcanzando. Protege además cualquier otro puerto futuro.
2. **Bind a localhost:** que Express escuche en `127.0.0.1:3443`/`:3444` en vez de `0.0.0.0` (Nginx proxea desde localhost, no se afecta).
> Verificar después: `curl https://142.93.64.94:3443/health` debe dar timeout/refused, y `staging-api` seguir pidiendo basic-auth.

**Riesgo del fix:** bajo, pero **probar que Nginx sigue llegando** al backend tras el cambio (no romper prod). Reversible.

---

## 4. Hallazgos menores

- **DEP-1 (Media) — Electron 28.3.3 (EOL):** la app empaqueta Electron 28, que está fuera de soporte (Chromium viejo con CVEs conocidos). Mitigado en la práctica: la app **no carga contenido web no confiable** (usa el Chrome del usuario vía Puppeteer, no renderiza sitios arbitrarios en la ventana de Electron). Aun así, conviene planificar un upgrade de Electron a una versión soportada (breaking, requiere pruebas + release). Ubicación: `electron-app/package.json`.
- **DEP-2 (Baja) — nodemailer <9 (1 high en `npm audit` backend):** los CVEs de nodemailer requieren control de parámetros (`envelope.size`, nombre del transport, opción `raw`) que se setean **server-side**, no por el usuario → explotabilidad real baja. Upgrade a 9.x pendiente (breaking, requiere probar el envío de emails). Relaciona D4.
- **AUTH-1 (Baja/Info) — JWT no atado a dispositivo:** el token de sesión (`{id, role}`, 1h) es un bearer token estándar sin binding al `machineId`. Al login se emite un `sessionKey` que **sí** incluye `machineId`, pero **nunca se verifica** server-side (`SESSION_KEY_SECRET` solo se usa para firmar). El anti-account-sharing real es el lock de ejecución (un dispositivo a la vez). Mitigantes: expiry 1h + blacklist al logout. Un token robado funcionaría desde otro dispositivo hasta 1h. Considerar: verificar el `machineId` del `sessionKey` en endpoints sensibles, o eliminar el `sessionKey` no usado para no dar falsa sensación de binding.
- **BIZ-1 (Baja, aceptado) — descarga de script con trial agotado:** `GET /client/scripts/download/:name` devuelve 200 aunque el trial esté 20/20 (SEC-4 gatea `execution/start`, no la descarga). Aceptado por el plan (§C.2): el script cifrado no sirve sin poder ejecutarlo (bloqueado en `start`). Defensa en profundidad opcional: gatear también la descarga.
- **UPL-1 (Baja) — mimetype de upload declarado por el cliente:** el `fileFilter` de multer valida `file.mimetype === 'application/pdf'`, que viene del `Content-Type` que envía el cliente (spoofeable). Bajo impacto: el filename se fuerza a `factura_<id>_<ts>.pdf` (server-generado, sin path traversal) y el destino es fijo. Un archivo con mimetype falso sería solo un "PDF" roto. Considerar sniffear los magic bytes si se quiere endurecer.
- **DEP-3 (Info, aceptado) — `basic-ftp` crítico:** viene transitivo de `puppeteer` (`@puppeteer/browsers` → get-uri → basic-ftp). Su path traversal solo se ejercita al descargar Chromium por FTP — el producto usa el Chrome del usuario, **nunca** lo descarga. No se ejercita en runtime.

---

## 5. Controles verificados OK (sin hallazgos)

| Prueba | Resultado |
|---|---|
| S1.3 Secretos hardcodeados | ✅ Ninguno; `.gitignore` cubre `.env`/keys/certs; nada sensible trackeado |
| S1.4 Secretos en historial git | ✅ Sin claves privadas en el historial; el token MP sandbox del incidente GitGuardian fue rotado (muerto) |
| S2.1 Fuerza de JWT | ✅ `JWT_SECRET` de 64 chars; expiraciones 1h token / 8h admin / 24h sessionKey |
| S2.2 Blacklist al logout | ✅ Token rechazado (403) inmediatamente tras `/auth/logout` (M-1) |
| S2.4 Política de contraseñas | ✅ 8+ chars, letra+número, no-común, no=email; aplicada en register/reset/change |
| S2.5 Anti-enumeración | ✅ `forgot-password` y `resend-verification` responden genérico idéntico exista o no el email |
| S2.6 Rate limiting | ✅ login 20/15min, **register 3/hora (confirmado en vivo)**, descarga 150/5min |
| S2.7 Sesión ≠ cuota | ✅ `verify-session` con trial 20/20 → 200 (no bloquea por cuota) |
| S3.1 Authz admin | ✅ `/admin/*` con token de usuario → 403 |
| S3.2 IDOR | ✅ Usuario A no accede a tickets/monitor de B (404, check `user_id` en cada query) |
| S3.3 Auto-asignación de plan | ✅ change-plan a plan inactivo/inexistente → "no disponible", sin cambio |
| S3.4 Confianza en el cliente | ✅ `log-execution` con subsystem/counts forjados → ignorados (whitelist), cuota es server-side |
| S3.5 Checkout sin pago | ✅ `/checkout/confirm` sin preapproval → `configured:false`, no marca pago |
| S4.1 SQL injection | ✅ Payloads en admin search → literales (parametrizado); tabla `users` intacta |
| S4.3 Path traversal uploads | ✅ Filename server-generado, destino fijo |
| S4.5 Firma de webhook | ✅ Sin firma / firma inválida → 401 (timing-safe, M-2) |
| S5.1 Security headers | ✅ CSP, HSTS (180d, includeSubDomains), nosniff, X-Frame SAMEORIGIN, Referrer no-referrer, sin X-Powered-By |
| S5.2 TLS | ✅ Rechaza TLS 1.1, negocia 1.3 |
| S5.3 Exposición de errores | ✅ Body malformado → "Error interno del servidor" genérico, sin stack/SQL |
| S5.4 CORS | ✅ Sin `Access-Control-Allow-Origin: *` en endpoints autenticados |
| S6.1 Enforcement del trial (SEC-4) | ✅ `execution/start` con 20/20 → 403 `TRIAL_EXHAUSTED` (antes de ejecutar) |
| S6.2 Idempotencia de webhooks | ✅ Verificado E2E en Lote 2A (C2): reprocesar un pago no duplica |
| S6.3 Concurrencia de ejecución | ✅ Verificado E2E en Lote 2B (M3): 2º dispositivo → 409 DEVICE_LOCKED (atómico) |
| S7.1 Firma RSA de scripts | ✅ `scriptVerifier` verifica RSA-2048 con clave pública embebida antes de ejecutar |
| S7.2 Autodestrucción | ✅ `scriptAutoDestruct` borra el script descifrado tras ejecutar |
| S7.3 Credenciales PJN | ✅ Solo el password del portal viaja al backend; las credenciales del PJN quedan en el gestor de Chrome, nunca salen |
| S7.4 Permisos de la extensión | ✅ Mínimos: `scripting/activeTab/storage/contextMenus/alarms`, host_permissions acotados a dominios PJN + API; sin `tabs`, sin `<all_urls>` |

---

## 6. Veredicto y próximos pasos

- **Apto para Beta controlada** tras corregir **XSS-1** (rápido, alto impacto, frontend del dashboard).
- **Antes del lanzamiento público:** cerrar **NET-1** (firewall/bind localhost) y planificar **DEP-1** (upgrade de Electron).
- El resto (DEP-2, AUTH-1, BIZ-1, UPL-1) son mejoras de robustez sin urgencia.
- **SEC-1 externo** (pentesting profesional) sigue recomendado antes del lanzamiento masivo — esta auditoría lo reduce a confirmación, no a descubrimiento.

Los hallazgos accionables (XSS-1, NET-1, DEP-1) se agregan a la lista de pendientes del `CLAUDE.md` con su ID.
