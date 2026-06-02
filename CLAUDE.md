# CLAUDE.md — Procurador SCW

> Guía maestra del proyecto para sesiones de trabajo con Claude.
> Última actualización: 2026-05-30

---

## 🔄 Estado actual
> Versión app Electron: **2.7.14** — publicada en GitHub Releases (auto-updater activo)
> Versión extensión Chrome: **1.3.4** — ZIP generado, pendiente subir al Chrome Web Store
> Última sesión: 2026-05-30

### Últimas funcionalidades implementadas (listas en producción)

- ✅ **Staging Fase A — backups pre-deploy y restauración** (sesión 2026-06-01):
  - **Hallazgo:** el backup diario ya existía (`backend-server/scripts/backup-db.js`, cron 03:00 → sube a DO Spaces, retención 30 días + copias locales en `/var/backups/procurador/`). Mejor que lo planeado (offsite). No se duplicó.
  - **Nuevo `ops/backup-now.sh [prod|staging]`:** backup local on-demand pre-deploy, con guarda de integridad + rotación (últimos 10). Va a `/var/backups/procurador/predeploy/`. Probado en producción.
  - **Nuevo `ops/restore-db.sh [prod|staging] <archivo> [--force]`:** rollback de la capa de datos. Antes de restaurar hace backup de seguridad de la base destino + confirmación tipeada para prod + recrea limpia preservando owner. **Probado E2E contra base descartable, producción intacta.**
  - `.gitattributes` fuerza LF en `*.sh` (CRLF rompe bash en el servidor)
  - Resguardos: backup Desktop `202606_01062026` + tag `pre-staging-2026-06-01`
  - Plan completo: `docs/internal/plan-implementacion-staging.md`. **Pendiente:** Fase B (DB+config staging), Fase C (Nginx+SSL), Fase D (simulacro)

- ✅ **B-2 — Política de contraseñas** (sesión 2026-06-01):
  - Helper `utils/passwordPolicy.js` (Opción A): mín. 8 chars + al menos una letra y un número + no estar en lista de comunes + no ser igual al email
  - Aplicado en los 4 puntos backend: registro, reset, change-password (`auth.js`) y cambio del portal (`usuarios.js`)
  - UX estándar: requisitos visibles en los formularios + mensajes específicos según el requisito que falla (registro, portal, página de reset)
  - **No afecta login de usuarios existentes** (el login usa `bcrypt.compare` sin política). Sin cambios de DB ni dependencias
  - Resguardo `sec-pre-b2` · commit `548f0e8` · helper 12/12 pruebas, validado en producción

- ✅ **Correcciones de seguridad — grupo B seguro** (sesión 2026-06-01):
  - **B-1** (`server.js`): valida `JWT_SECRET` al arrancar (≥32 chars), si no `process.exit(1)`
  - **B-3** (`auth.js`, `usuarios.js`): bcrypt cost 10→12 (3 ocurrencias). Hashes viejos siguen verificando
  - **B-4** (`webhooks.js`): el log de firma inválida ya no expone la firma esperada
  - **B-6** (`server.js`): `minVersion: TLSv1.2`. Probado: negocia TLS 1.3, rechaza TLS 1.1
  - **B-8** (`checkLicense.js`): BOM inicial eliminado
  - **B-7** verificado sin cambios (la API no pasa por Cloudflare; `trust proxy` ya correcto)
  - Diferido: B-5 (CSP, riesgo de romper UI sin staging). (B-2 resuelto después — ver entrada de arriba)
  - Resguardo `sec-pre-b-group` · commit `da1eec6` · +18/-6 en 5 archivos · pruebas producción OK

- ✅ **Correcciones de seguridad M-1 y M-2** (sesión 2026-06-01):
  - **M-1:** `authenticateAdmin` (`routes/admin.js`) ahora chequea la blacklist de tokens antes de `jwt.verify`. Antes el logout de admin no invalidaba el token hasta su vencimiento (8h). Validado E2E en producción (logout → 403 inmediato).
  - **M-2:** la firma HMAC del webhook MP (`routes/webhooks.js`) se compara con `crypto.timingSafeEqual` (con guarda de longitud) en vez de `!==`. Evita timing attacks.
  - Cambio quirúrgico: +15/-1 líneas en 2 archivos. Resguardo previo: tag `sec-pre-m1-m2`. Commit `58b3163`. 13/13 pruebas OK.

- ✅ **Extensión Chrome v1.3.4 — header con marca Procurador TOOL** (sesión 2026-05-30):
  - Reemplazado el texto "PJN – Automatización" del popup por el logo `icon128` + "Procurador **TOOL**" (amber) + sublabel "Procurador SCW" — idéntico a los logins del portal
  - Solo tocó `popup.html` + versión del manifest (1.3.3 → 1.3.4). Sin cambios en lógica, permisos ni content scripts
  - Backup previo: tag `ext-pre-logo-v1.3.3` · cambio en tag `ext-logo-v1.3.4`
  - ZIP listo: `pjn-extension-1.3.4.zip` (pendiente subir al store con cuenta jberger19186@gmail.com)

- ✅ **Bloque 1 — Ícono oficial balanza dorada** (sesión 2026-05-23):
  - **Ícono:** ⚖️ emoji renderizado con Puppeteer → ICO multi-resolución (16/32/48/256px)
  - **Favicon landing:** `backend-server/public/assets/favicon.png` · `<link rel="icon">` en `index.html`
  - **Electron app:** `afterPack.js` hook usa `rcedit` para embeber el ícono en el `.exe` post-empaquetado
  - **Causa raíz del problema:** electron-builder no llamaba rcedit automáticamente; sin el hook el exe mantenía el ícono default de Electron (átomo azul)
  - **Runtime icon:** `appIcon` en `main.js` — dev: `assets/icon.ico` · prod: `process.resourcesPath/icon.ico` (via `extraResources`)
  - **Archivos clave:** `electron-app/build/icon.ico` (build) · `electron-app/assets/icon.ico` (runtime) · `scripts/generate-icon.js` · `scripts/afterPack.js`
  - Releases: v2.7.6 → v2.7.7 → v2.7.8 → v2.7.9 → **v2.7.10** (fix definitivo)

- ✅ **Extensión Chrome Web Store v1.3.3 aprobada** (sesión 2026-05-26):
  - Nombre actualizado: "Procurador SCW – Automatización PJN" · ícono balanza · descripción con mención a suite
  - Visibilidad pública habilitada · aprobada por Google
  - Portal web → sección Descargas: enlace directo a la store

- ✅ **Flujo de registro y activación completo** (sesión 2026-05-26):
  - **Portal de usuarios** migrado de `/auth/extension-login` a `/auth/portal-login` — permite acceso a usuarios en cualquier estado no terminal (`pending_email`, `pending_activation`, `suspended`)
  - **Nuevo endpoint:** `POST /auth/resend-verification` — reenvía email de verificación de forma segura (respuesta genérica siempre, anti-enumeración)
  - **Nuevo endpoint:** `GET /client/download/electron` (autenticado) — consulta GitHub API en tiempo real y redirige al `.exe` del último release; no requiere actualizar la URL en cada versión
  - **Email verificación:** ícono real (`/assets/icon128.png`) en lugar de emoji · enlace "Ir al portal →" post-verificación apunta a `/usuarios/` en lugar de `/`
  - **Electron — estado `pending_email`:** banner ámbar "Verificá tu email" + `btnMain` deshabilitado
  - **Electron — Mi Cuenta:** card de prueba con contador `X/20 utilizados` + barra de progreso coloreada (verde/naranja/rojo)
  - **Portal — Mi Plan:** card de prueba idéntica cuando `registration_status = 'pending_activation'`
  - **Portal — Descargas:** extensión con enlace directo Chrome Web Store · app usa `/client/download/electron`
  - Releases: v2.7.10 → v2.7.11 → v2.7.12 → v2.7.13 → **v2.7.14** (Fase 5 cobranza: estados de pago/cancelación en banners)

- ✅ **Documentación para evaluación + auditoría de seguridad** (sesión 2026-05-30):
  - **Informe de evaluación del proyecto** (`docs/informe-evaluacion-proyecto.md` + versión Word `docs/Informe-Evaluacion-Procurador-SCW.docx`): documento sin tecnicismos para socios. Conclusión: apto para iniciar Beta controlada.
  - **Diagrama de flujo del ciclo de vida del usuario** (`docs/diagrama-flujo-usuario.md`): formato Mermaid, camino principal + caminos alternativos.
  - **Informe de verificación de seguridad** (`docs/internal/informe-seguridad.md`): revisión del código real. 18 fortalezas, 2 puntos media (M-1: `authenticateAdmin` no chequea blacklist · M-2: comparación de firma webhook no timing-safe), 8 baja, 3 proceso. Veredicto: apto para Beta.
  - **Plan de staging y rollback** (`docs/internal/plan-staging-rollback.md`): diseño de entorno staging (puerto 3444, db_staging, subdominio) + rollback en 3 capas + simulacro de validación.
  - Generador Word reutilizable: `backend-server/dev-tools/gen-informe-word.js`

- ✅ **Branding unificado + reset de datos** (sesión 2026-05-30):
  - Logo `icon128.png` de la extensión copiado a `public/assets/brand-icon.png` (y a `public/landing/brand-icon.png` porque la landing se sirve por Nginx, no por Express)
  - Reemplazados todos los emojis `⚖️` por `<img>` del logo oficial en: landing (navbar/hero/footer), dashboard admin (login + sidebar), portal usuario (login + sidebar + cards de descarga)
  - Marca consistente en logins y sidebars: "Procurador **TOOL**" (acento amber) + sublabel "Procurador SCW" — formato igual al de la landing
  - Versión actualizada en landing (4 refs) y portal usuario: 2.7.6/2.7.13 → 2.7.14
  - Reset completo de datos de prueba (usuarios + transaccionales) — solo quedan los 2 admins. Backup en servidor: `/tmp/backup_pre_reset_*.sql` + `/tmp/backup_pre_delete_user19_*.sql`
  - Usuario `procuradortool@gmail.com` (id 19) eliminado para hacer pruebas desde cero

- ✅ **Fase 5 cobranza — flujo completo + facturación manual** (sesión 2026-05-29):
  - Ciclo de vida de suscripción end-to-end validado en sandbox (alta → cancelación → reactivación → suspensión)
  - Identificación de pagos por `external_reference=user_{id}` (resuelve email distinto portal vs MercadoPago)
  - Módulo de facturación manual en dashboard admin (sube PDF de ARCA) — Facturante automático desactivado hasta contratar
  - Reset de datos de prueba ejecutado (3 usuarios conservados). Ver sección "Reset de datos de prueba"
  - Detalle completo en sección "Estado Fase 5 — Cobranza"

- ✅ **Fix toggle registro público** (sesión 2026-05-23):
  - **Causa raíz:** `register.js` llamaba a `/auth/register-status` que no existía → 404 → formulario siempre cerrado
  - **Fix:** creado `GET /auth/register-status` en `routes/auth.js` — lee `app_settings.allow_public_register` en DB, fallback a env var
  - **Toggle reconectado:** `admin.js` tiene `GET /admin/settings` + `PUT /admin/settings/:key` (whitelist: `allow_public_register`)
  - **Dashboard:** card "⚙️ Configuración rápida" con botón verde/rojo en **Usuarios pendientes** (se quitó de Resumen)
  - `app_settings` en DB es la fuente de verdad; env var `ALLOW_PUBLIC_REGISTER` es fallback
  - Commits: `0b57297` (toggle admin) · `3edf2e5` (register-status + pending)

- ✅ **Bloque 1 — Branding & Pricing landing** (sesión 2026-05-23):
  - **Jerarquía de marca:** "Procurador **TOOL**" (suite) + sublabel "Procurador SCW" en navbar y footer
  - **Precios promos ARS:** EXTENSION_PROMO $1.500/mes · COMBO_PROMO $15.000/mes (antes: USD)
  - **Planes permanentes (Próximamente):** indexados a UMA CSJN $95.626: Básico $31.875 · Pro $63.751 · Enterprise $95.626
  - **DB:** `price_usd → NULL`, `price_ars` seteado · migración `20260522_promo_prices_to_ars.sql`
  - **Backend:** `auth.js`, `users.js`, `usuarios.js` usan `price_ars`; `register.js` y `dashboard.js` muestran ARS
  - Commit: `a614238`

- ✅ **Sección "Ayuda" en portal web** (sesión 2026-05-21) · **v2.7.3** SSO soporte · **v2.7.2** IA Haiku · **v2.7.0** QA 159/165

### Pricing actual en producción
| Plan | price_usd | price_ars | Activo |
|---|---|---|---|
| EXTENSION_PROMO | NULL | $1.500 ARS | ✅ |
| COMBO_PROMO | NULL | $15.000 ARS | ✅ |
| BASIC | NULL | NULL | ❌ Próximamente (≈ 1/3 UMA) |
| PRO | NULL | NULL | ❌ Próximamente (≈ 2/3 UMA) |
| ENTERPRISE | NULL | NULL | ❌ Próximamente (≈ 1 UMA) |

> UMA de referencia: **$95.626 ARS** (CSJN vigente a 2026-05-23)

### Toggle registro público — cómo funciona
```
DB: app_settings WHERE key = 'allow_public_register'  ← fuente de verdad
  ↓ fallback si falla la consulta
Env: ALLOW_PUBLIC_REGISTER=true (en .env del servidor)

Controlar desde: Panel admin → Usuarios pendientes → "⚙️ Configuración rápida"
Endpoint que lee el toggle: GET /auth/register-status → { open: true/false }
```

### Ícono oficial — cómo regenerar
```bash
cd electron-app
node scripts/generate-icon.js
# → genera build/icon.ico (multi-res), build/icon.png, assets/icon.ico, assets/icon.png, backend-server/public/assets/favicon.png
# Luego: npm run release
```
> `afterPack.js` embebe el ícono en el `.exe` vía rcedit automáticamente en cada build.

- ✅ **Smoke tests — dashboard admin + script local PJN** (sesión 2026-05-26 → 2026-05-27):
  - **Dashboard admin "🧪 Diagnóstico":** 3 tarjetas — API Backend · Portal PJN · Extensión Chrome
  - **Endpoints backend:** `GET /admin/smoke-tests/latest` · `POST /admin/smoke-tests/run-api` · `POST /admin/smoke-tests/report-pjn` · `POST /admin/smoke-tests/report-extension`
  - **Persistencia:** resultados en `backend-server/data/smoke-test-results.json`
  - **Script unificado:** `electron-app/scripts/smoke-test-pjn.js` — cubre Portal PJN (grupos D+E, 24 checks) Y Extensión Chrome (grupos F+G+H, 24 checks) → **48 checks totales**, 66 segundos
  - **Último resultado:** 48/48 ✅ (2026-05-27)

### Estado Fase 5 — Cobranza
> Última actualización: 2026-05-29

Flujo de cobranza **completo y validado en sandbox** en producción con `PAYMENT_MODULE_ENABLED=true`.
Ciclo de vida de suscripción funcionando end-to-end: alta → cobro → cancelación → reactivación → suspensión por pago fallido.

---

### 🧪 Credenciales de sandbox MercadoPago
> Solo para pruebas — NO usar en producción

#### Cuentas de prueba MP
| Rol | Usuario | Contraseña | UserID | Código verificación |
|---|---|---|---|---|
| **Vendedor** (Procurador SCW) | `TESTUSER3208446836555858` | `5pfW4wdMZj` | `3433287066` | `287066` |
| **Comprador** (usuario que paga) | `TESTUSER4310268003253553318` | `zveOQA6aYI` | `3433287076` | `287076` |

> Login vendedor en panel dev: https://www.mercadopago.com.ar/developers/panel/app

#### Credenciales API (cuenta vendedor de prueba)
| Variable | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | `APP_USR-2400427986609750-052810-ae29cea74562fd33adb80b7692f21b08-3433287066` |
| `MP_PUBLIC_KEY` | `APP_USR-346db40a-416e-4073-af44-1e0c130d152d` |
| `MP_WEBHOOK_SECRET` | `a0c3ad4ce054760fc055939928ca6edd2eebd9d1a05faaecad09427ad8597fb5` |

#### Planes MP (sandbox)
| Plan | ID | Precio | init_point |
|---|---|---|---|
| `COMBO_PROMO` | `c4ff98a4b2244828a8be0a6d84085fb8` | $15.000 ARS | `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=c4ff98a4b2244828a8be0a6d84085fb8` |
| `EXTENSION_PROMO` | `f7cea2c32ae94576b254089ebf7371a4` | $1.500 ARS | `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=f7cea2c32ae94576b254089ebf7371a4` |

#### Tarjeta de prueba (para pagar como comprador)
| Campo | Valor |
|---|---|
| Número | `5031 7557 3453 0604` |
| Vencimiento | `11/30` |
| CVV | `123` |
| Nombre titular | `APRO` (aprueba automáticamente) |
| DNI | `12345678` |

---
Para activar el módulo de pagos solo se necesitan las credenciales externas (ver pendientes B1-B3).

**Implementado:**
- DB: tablas `payments`, `invoices`, `usage_extras`, `webhook_events` + columnas nuevas en `subscriptions`
- Backend: `routes/checkout.js`, `routes/webhooks.js`, `services/subscriptionService.js`, `services/invoiceService.js`
- Admin: endpoints refund-preview, extra-usage (GET/POST), payments (GET), invoices (GET)
- Portal usuario: card Método de Pago, historial de pagos, historial de facturas
- Admin dashboard: card Usos Extra + modal, card Historial de Pagos, card Historial de Facturas, modal Suspensión mejorado

**Flujo de suscripción completo (sesión 2026-05-29):**
- **Alta / checkout:** plan-based MP. `init_point` enriquecido con `external_reference=user_{id}` + `payer_email`. Navega en la misma pestaña (no popup). Flag `psc_checkout_pending` en localStorage detecta el retorno aunque MP no agregue `?pago=ok`.
- **Identificación de pagos (clave):** webhook resuelve el usuario por prioridad: (1) `external_reference=user_{id}` → independiente del email de MP, (2) `external_subscription_id` ya vinculado, (3) `payer_email`. Resuelve el caso de email distinto entre portal y MercadoPago.
- **Webhook:** maneja `payment`, `subscription_authorized_payment`, `preapproval` y `subscription_preapproval`. Guarda `external_subscription_id` real para poder cancelar luego en MP.
- **Cancelación:** `cancel_at = next_billing_date`, cancela el preapproval en MP. El cobro del período en curso ya ocurrió; no se cobra la renovación. Acceso hasta fin del período.
- **Reactivación:** botón "↩ Reactivar" en portal antes del vencimiento → `POST /checkout/reactivate` → quita `cancel_at`, reactiva preapproval en MP.
- **Pago rechazado:** gracia 3 días → si no se recupera, `status=suspended` → UI "Actualizar método de pago".
- **Cron cancelaciones:** triple verificación de seguridad (buffer 2h + `auto_renewal=FALSE` + sin pago aprobado reciente) para evitar cancelar cuentas que pagaron.
- **App Electron (v2.7.14):** fix `sub = a.subscription || a` (campos planos), banner de cancelación programada en Mi Cuenta.

**Facturación manual (reemplazo temporal de Facturante):**
- Dashboard admin → sección **🧾 Facturación** con 2 tabs: Pendientes (pagos sin PDF) y Emitidas (con buscador).
- Admin sube PDF generado en ARCA + tipo de comprobante (default Factura C), número (autoformateo `1245`→`0001-00001245`), CAE (opcional).
- Botón **＋ Nueva factura manual**: modal con autocomplete de usuario (navegación teclado + mouse), monto, fecha, plan, notas.
- PDFs en `public/invoices/`, servidos vía `/invoices/`. La factura aparece en el portal del usuario al instante.
- **Facturante automático DESACTIVADO** hasta contratar el servicio (cron comentado en `server.js`, `processInvoice` no-op sin `FACTURANTE_WSDL_URL`). `enqueueInvoice` se mantiene activo: crea el registro pendiente al cobrar.

---

## 📋 Pendientes — Lista consolidada
> Última revisión: 2026-05-30 · Resumen priorizado en `docs/internal/pendientes-prioritarios.md`

### 🔴 Requieren cuentas / contratos externos

| # | Tarea | Detalle |
|---|---|---|
| ~~**B1**~~ | ~~**MercadoPago sandbox**~~ | ✅ Credenciales configuradas. Ver sección "Credenciales de sandbox" arriba. |
| ~~**B2**~~ | ~~**Probar checkout end-to-end**~~ | ✅ Validado: checkout devuelve `init_point`, pago aprobado en sandbox (PayID `160575039911`), webhook llegó con 200, HMAC validado, procesamiento correcto. |
| **B3** | **MercadoPago producción** | Una vez validado en sandbox → credenciales reales → `PAYMENT_MODULE_ENABLED=true` |
| **C1** | **Contrato Facturante** | _No bloqueante._ Mientras tanto la facturación es **manual** (admin sube PDF de ARCA en dashboard → Facturación). Para activar el automático: completar vars `FACTURANTE_*` en `.env` + descomentar cron `invoice-retry` en `server.js`. Ver `backend-server/utils/facturante.js` |
| **AZ** | **Azure Trusted Signing** | Code signing del instalador `.exe`. Pasos: crear Trusted Signing Account → Certificate Profile (Public Trust, 1-3 días hábiles) → App Registration → 5 env vars → configurar electron-builder + GitHub Actions |

---

### 🟡 Infraestructura técnica (pueden hacerse ahora)

| # | Tarea | Detalle | Urgencia |
|---|---|---|---|
| **D1** | **GRANT DEFAULT PRIVILEGES DB** | `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO procurador_user;` — evita grants manuales en futuras migraciones | Baja |
| **D2** | **SSL api.procuradortool.com** | Vence **2026-06-29**. `certbot.timer` activo pero verificar que renueve: `ssh … "certbot renew --dry-run"` | Media |

---

### 🟠 Staging y Rollback (prerequisito antes del análisis de seguridad)

| # | Tarea | Detalle |
|---|---|---|
| **ST-1** | **Entorno staging** | Segunda instancia del backend (mismo servidor, puerto 3444, PM2 proceso `procurador-staging`) apuntando a DB `procurador_db_staging`. Nginx: `staging-api.procuradortool.com` |
| **ST-2** | **Mecanismo de rollback definido** | Documentar y validar el proceso: (1) git tags por release `v*` en producción, (2) `pm2 rollback procurador-api` para rollback de proceso, (3) scripts de migración DB reversibles (`migrations/XXX_rollback.sql`), (4) checklist de validación post-deploy |
| **ST-3** | **Aprobación del procedimiento** | Ejecutar un rollback de prueba completo en staging antes de usar en producción |

---

### 🔵 Seguridad pre-comercialización

> Revisión de seguridad interna realizada el 2026-05-30 (`docs/internal/informe-seguridad.md`).
> Resultado: base sólida, sin vulnerabilidades críticas ni inyección SQL. Apto para Beta.
> Hallazgos correctivos abajo. SEC-1 (auditoría externa) sigue recomendado antes del público.

| # | Tarea | Prioridad | Detalle |
|---|---|---|---|
| ~~**M-1**~~ | ~~`authenticateAdmin` no chequea blacklist~~ | ✅ Resuelto (01/06) | Chequeo `isBlacklisted()` agregado en `routes/admin.js`. Validado E2E: logout admin → token 403 inmediato. Commit `58b3163` |
| ~~**M-2**~~ | ~~Firma webhook no timing-safe~~ | ✅ Resuelto (01/06) | `crypto.timingSafeEqual` en `routes/webhooks.js` (con guarda de longitud). Validado en producción. Commit `58b3163` |
| ~~**B-1,B-3,B-4,B-6,B-8**~~ | ~~Grupo seguro de robustez~~ | ✅ Resuelto (01/06) | JWT_SECRET validado al arrancar · bcrypt 10→12 · log webhook sin firma · TLS min 1.2 · BOM eliminado. Commit `da1eec6` |
| ~~**B-7**~~ | ~~IP real tras Cloudflare~~ | ✅ Verificado | La API no pasa por Cloudflare; `trust proxy` ya correcto. Sin cambios |
| ~~**B-2**~~ | ~~Política de contraseñas~~ | ✅ Resuelto (01/06) | `utils/passwordPolicy.js` (Opción A): 8+ chars, letra+número, no común, no = email. UX con requisitos visibles. Commit `548f0e8` |
| **B-5** | **Activar CSP en Helmet** | 🟡 Diferido | Riesgo de romper UI sin staging. Hacer tras ST-1. Detalle en informe-seguridad.md §3 |
| **SEC-1** | **Auditoría de seguridad externa** | — | Revisión profesional independiente antes del lanzamiento masivo |
| **SEC-2** | **Smoke tests CI en GitHub Actions** | — | Workflow que corre `smoke-test-pjn.js` + `dev-tools/smoke-payments.js` en cada push a `main`, más `npm audit` (P-1) |
| **SEC-3** | **Hardening de secretos** | — | ✅ Verificado: ningún secreto hardcodeado, `.env`/keys/certs correctamente en `.gitignore` |

---

### ⚪ Diferidos al lanzamiento público

| # | Tarea | Detalle |
|---|---|---|
| **L1** | **Activar planes BASIC/PRO/ENTERPRISE** | `UPDATE plans SET active=true WHERE name IN ('BASIC','PRO','ENTERPRISE')` — solo cuando estén los precios y el cobro funcionando |
| **L2** | **Base de Conocimiento IA** | Alimentar el asistente con 20-30 tickets reales cerrados para mejorar respuestas |
| **L3** | **Actualizar imágenes Chrome Web Store** | Screenshots y banner del listing en la store |

---

### SSL api.procuradortool.com
`certbot.timer` activo — renueva automáticamente 2×/día cuando faltan ≤30 días. Vence 2026-06-29. Verificar con `certbot renew --dry-run` antes del 01/06.

---

## ¿Qué es Procurador SCW?

**Procurador SCW** es una plataforma SaaS de automatización judicial para Argentina. Está dirigida exclusivamente a profesionales del derecho (abogados, procuradores) que cuentan con **credenciales propias en el sistema del Poder Judicial de la Nación (PJN)**.

El producto tiene dos componentes de acceso:

### App Electron (cliente desktop)
Automatiza tres operaciones sobre el PJN:
1. **Procuración de expedientes** — accede automáticamente a los expedientes del usuario en el portal SCW del PJN y realiza la procuración.
2. **Generación de informes** — genera informes de estado de expedientes judiciales radicados en el PJN.
3. **Monitor de partes** — controla periódicamente si aparecieron nuevos expedientes vinculados a una parte determinada.

Usa **Puppeteer** con el **Chrome del usuario** (no Chromium empaquetado) y el **gestor de contraseñas de Chrome** para las credenciales del PJN. Las contraseñas del PJN **nunca pasan por los servidores de Procurador**.

### Extensión Chrome (acelerador de data-entry)
Automatiza la **carga del número de expediente** (jurisdicción, número y año) en los módulos del PJN para evitar la escritura manual. Cubre 5 flujos:
- **Consulta SCW** → scw.pjn.gov.ar
- **Escritos 1** → scw.pjn.gov.ar (presentar escrito desde expediente)
- **Escritos 2** → escritos.pjn.gov.ar
- **Notificaciones** → notif.pjn.gov.ar
- **DEOX** → deox.pjn.gov.ar

Distribuida en la **Chrome Web Store** (aprobada por Google):
`https://chromewebstore.google.com/detail/aodnfemklhciagaglpggnclmbdhnhbme`

---

## Mapa de componentes

> Snapshot al 2026-05-22. Para encontrar el "último archivo tocado" usar:
> ```bash
> git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" log --name-only --pretty=format: -20 | sort -u
> # o por carpeta:
> ls -lt electron-app/ | head
> ```

```
ProcuradorTool/
├── CLAUDE.md                              ← este archivo (guía maestra)
├── .gitignore
├── procurador_db_backup.sql               ← backup histórico (no usar, ver Desktop/ProcuradorBackups)
│
├── electron-app/                          ← cliente desktop (Electron 28)
│   ├── main.js                            (~108 KB) proceso principal + IPC handlers
│   ├── preload.js                         puente seguro Main ↔ Renderer
│   ├── renderer.js                        (~166 KB) UI dashboard — PENDIENTE refactor a módulos ES6
│   ├── index.html                         shell del dashboard
│   ├── styles.css                         (~45 KB) sistema de diseño aplicado
│   ├── package.json                       v2.7.14
│   ├── Monitor-Procurador.ps1             watchdog Windows (legacy)
│   ├── visorModal_template.html           plantilla visor de expediente
│   ├── renderer/                          ventanas auxiliares
│   │   ├── login.html / login.js / login.css
│   │   └── app.html
│   ├── onboarding/                        flujo de primer uso
│   │   ├── onboarding.html / .js / .css
│   │   ├── preload-onboarding.js
│   │   └── tour.js                        tour guiado paso a paso
│   ├── informe/                           generación de informes Excel + visor
│   │   ├── generador_excel.js
│   │   ├── generador_visor.js
│   │   └── visor_informes_template.html
│   ├── src/
│   │   ├── api/backendClient.js           wrapper Axios a /client/* /license/*
│   │   ├── auth/
│   │   │   ├── authManager.js             login, JWT, persistencia sesión
│   │   │   └── machineId.js               hardware ID (binding dispositivo)
│   │   ├── browser/windowManager.js       gestión Chrome+perfil
│   │   ├── scripts/
│   │   │   ├── scriptExecutor.js          orquesta Puppeteer (descarga, descifra, corre)
│   │   │   ├── scriptCache.js             caché local
│   │   │   ├── abrirNavegadorPJN.js       inline: abre Chrome → SCW
│   │   │   └── agregarPasswordSCW.js      inline: inyecta credenciales del gestor Chrome
│   │   ├── security/                      ⛔ NO TOCAR
│   │   │   ├── fileEncryption.js          AES-256-CBC
│   │   │   ├── scriptVerifier.js          verifica firma RSA-2048
│   │   │   ├── scriptAutoDestruct.js      borra script al terminar
│   │   │   ├── secureTempFolder.js        carpeta temporal aislada
│   │   │   ├── codeObfuscator.js
│   │   │   └── public.pem                 clave pública para verificar firmas
│   │   ├── notifications/notificationManager.js   toast Windows
│   │   ├── telemetry/
│   │   │   ├── securityAudit.js
│   │   │   └── securityMetrics.js
│   │   └── preCalentarChrome.js           warm-up del perfil Chrome
│   ├── build/installer.nsh                config instalador NSIS
│   ├── assets/icon.ico + icon.png         ícono runtime (incluido en asar)
│   ├── scripts/cleanup-dist.js            limpieza pre-build
│   ├── scripts/generate-icon.js           genera ICO multi-res desde emoji ⚖️ (Puppeteer)
│   ├── scripts/afterPack.js               hook post-build: embebe ícono en .exe via rcedit
│   ├── demo-visores/                      ejemplos de visor (no se distribuye)
│   ├── dist/                              salida de electron-builder (gitignored)
│   └── node_modules/                      (gitignored)
│
├── backend-server/                        ← API Express 5 + PostgreSQL 14
│   ├── server.js                          (~32 KB) entry point, middlewares, cron
│   ├── package.json
│   ├── ecosystem.config.js                config PM2
│   ├── .env / .env.example                secretos (JWT, DB, ANTHROPIC_API_KEY, etc.)
│   ├── extension-meta.json                metadata versión extensión (legacy CRX)
│   ├── routes/
│   │   ├── auth.js                        login, registro, refresh, extension-login, portal-login, resend-verification
│   │   ├── client.js                      heartbeat, scripts, account, notifications, IA chat, download/electron
│   │   ├── license.js                     lock ejecución (start/heartbeat/end)
│   │   ├── monitor.js                     CRUD partes + novedades
│   │   ├── admin.js                       panel admin
│   │   ├── tickets.js                     soporte (IA priority, visibility)
│   │   ├── extension.js                   ⚠️ DEPRECADO (CRX) — pendiente eliminar
│   │   ├── scripts.js                     gestión de scripts cifrados
│   │   ├── users.js / usuarios.js         portal usuarios + API SSO
│   │   ├── analytics.js                   métricas
│   │   └── legal.js                       T&C, privacidad, aceptación
│   ├── middleware/
│   │   ├── authenticateToken.js
│   │   ├── checkLicense.js                cuotas + estado suscripción
│   │   ├── rateLimiter.js
│   │   └── tokenBlacklist.js
│   ├── utils/
│   │   ├── scriptEncryption.js            ⛔ NO TOCAR (AES + firma RSA server-side)
│   │   ├── mailer.js                      emails transaccionales (Nodemailer)
│   │   ├── cacheManager.js
│   │   └── logger.js                      Winston
│   ├── src/security/
│   │   ├── scriptSigner.js                ⛔ firma RSA-2048
│   │   ├── scriptVerifier.js
│   │   └── signatureCache.js
│   ├── public/                            servido por Express (estáticos)
│   │   ├── landing/                       procuradortool.com (Nginx sirve este)
│   │   │   ├── index.html
│   │   │   ├── terminos.html
│   │   │   └── privacidad.html
│   │   ├── usuarios/                      portal web autoservicio (SSO desde Electron)
│   │   │   ├── index.html / app.js / app.css
│   │   ├── dashboard/                     panel admin
│   │   │   ├── index.html / dashboard.js / dashboard.css
│   │   ├── register/                      registro público
│   │   ├── legal/accept                   aceptación T&C
│   │   ├── terminos/ · privacidad/        copias servidas vía rutas
│   │   └── extension/                     ⚠️ DEPRECADO (descargas CRX)
│   ├── scripts/                           scripts Puppeteer cifrados (se distribuyen al Electron)
│   │   ├── consultarscwpjn.js · listarSCWPJN.js · informequickscwpjn.js
│   │   ├── buscarPorParteScwpjn.js · validarCampoParteScwpjn.js
│   │   ├── monitoreo.js · procesarMonitoreo.js · procesarNovedadesCompleto.js
│   │   ├── procesarCustomExpedientes.js · cerrarNavegador.js
│   │   ├── sessionManager.js · errorHandler.js
│   │   ├── backup-db.js · data-retention.js · canary-test.js
│   │   ├── testM1.js · testM2.js · test_registro.js
│   │   ├── insert_plans.sql
│   │   └── validacion_campo_parte.json
│   ├── database/init.sql · migrations/    bootstrap DB
│   ├── setup/createTestUser.js
│   ├── test/                              tests internos
│   ├── generate-keys.js                   genera par RSA (uso one-shot)
│   ├── create-admin.js · list_users.js · assign_cuit.js · migrate_cuit.js
│   ├── reencrypt_scripts.js               re-cifrar todos los scripts tras rotación de clave
│   ├── seed_legal_tmp.js · test_legal_tmp.js · test_legal_full_tmp.js   (temporales)
│   └── keys/                              ⛔ claves RSA privadas (gitignored)
│
├── extension-app/                         ← extensión Chrome MV3 (Chrome Web Store)
│   ├── manifest.json                      v1.3.4
│   ├── background.js                      service worker
│   ├── popup.html · popup.js              UI principal
│   ├── auth.js                            login + FLOW_ALIASES
│   ├── config.js                          URL backend, versión
│   ├── cs-scw.js                          content script scw.pjn.gov.ar
│   ├── cs-escritos2.js                    escritos.pjn.gov.ar
│   ├── cs-notif.js                        notif.pjn.gov.ar
│   ├── cs-deox.js                         deox.pjn.gov.ar
│   ├── cs-selection.js                    sin uso activo (vestigio)
│   ├── icon16.png · icon48.png · icon128.png
│   └── imagenes/                          assets para store (EXCLUIR del ZIP)
│
├── database/                              ← snapshots y migraciones del esquema
│   ├── schema.sql                         schema actual de producción (pg_dump --schema-only)
│   ├── backup_fase4_inicio.sql            backup pre-Fase 4
│   ├── backup_pre_v2.1.sql                (untracked)
│   └── migrations/
│       ├── 001_flujo_usuario_v2.1.sql
│       ├── 001_registration_gaps.sql
│       ├── 20260522_add_comment_visibility_and_ai_logs.sql
│       └── 20260522_add_ticket_priority_source.sql
│
├── docs/
│   ├── manual-de-usuario.md               guía pública del usuario final
│   └── internal/                          documentación interna
│       ├── proximos-pasos.md              ⭐ handoff de continuidad (leer post-/clear)
│       ├── sistema-estados-flujos.md      flujos técnicos (IA, email, IPC, deploy)
│       ├── mejoras-futuras.md             ideas diferidas (KB, borradores masivos)
│       └── rollback-fase4.md              procedimientos de restore Fase 4
│
├── tests/                                 ← QA pytest + Playwright
│   ├── README.md · QA_RESULTS.md          (159/165 PASS)
│   ├── conftest.py · pytest.ini · requirements.txt · run_tests.py
│   ├── api/                               tests API REST
│   ├── desktop/                           tests Electron (Playwright)
│   ├── web/                               tests portal web
│   ├── helpers/                           fixtures compartidas
│   ├── tests/                             suite principal
│   ├── test_m14_cron.sh · test_m14_cron.sql
│   └── *.png                              screenshots de referencia
│
└── .claude/                               ← worktrees + plans + memoria local (gitignored)
    ├── worktrees/                         worktrees activos
    └── plans/                              planes guardados (cozy-cuddling-badger.md, etc.)
```

### Archivos top-level "no esperados" (revisar antes de borrar)
- `procurador_db_backup.sql` en la raíz — backup histórico, no es la fuente actual
- `backend-server/seed_legal_tmp.js`, `test_legal_tmp.js`, `test_legal_full_tmp.js` — temporales del seed legal, candidatos a limpieza
- `backend-server/routes/extension.js` + `backend-server/public/extension/` — distribución CRX deprecada (Bloque 1.2)
- `electron-app/Monitor-Procurador.ps1` — watchdog Windows legacy, ver si sigue usándose

### Atajos rápidos para localizar archivos
```bash
# Último archivo modificado por carpeta
ls -lt electron-app/src/scripts/ | head
ls -lt backend-server/routes/ | head

# Buscar por nombre
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" ls-files | grep -i <fragmento>

# Archivos cambiados en el último commit
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" show --name-only --pretty=format: HEAD

# Archivos cambiados desde un tag
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" diff --name-only fase4-completa..HEAD
```

> **Nota sobre extensiones:** `extension-app/` es la **única** versión activa (la que se publica en Chrome Web Store).
> El directorio antiguo `extension-app` de desarrollo (con URLs de localhost para pruebas) permanece en `NodejsConsoleApp1/` como backup histórico — no se usa más.
> **Regla de desarrollo:** todos los cambios se hacen directamente en `ProcuradorTool/extension-app/` y desde ahí se genera el ZIP para el store (excluyendo la carpeta `imagenes/`).

---

## Stack tecnológico por componente

| Componente | Lenguaje | Framework | Base de datos | Librerías clave |
|---|---|---|---|---|
| **electron-app** | JavaScript | Electron 28 | — (caché local) | puppeteer, exceljs, axios, electron-updater |
| **backend-server** | JavaScript | Express 5 | PostgreSQL 14 | jsonwebtoken, bcrypt, helmet, winston, nodemailer |
| **extension-app** | JavaScript | MV3 (Chrome) | chrome.storage | vanilla JS, sin build tool |

---

## Servicios y cuentas asociadas al proyecto

| Proveedor | Para qué | Cuenta / Usuario |
|---|---|---|
| **DigitalOcean** | VPS servidor producción (142.93.64.94) | — |
| **Cloudflare** | CDN + WAF + SSL para procuradortool.com (landing) | — |
| **GitHub** | Repositorio privado + GitHub Releases (distribución instalador) | jberger19186@gmail.com |
| **Brevo** (ex Sendinblue) | SMTP transaccional — emails que salen con @procuradortool.com | jberger19186@gmail.com |
| **Chrome Web Store** | Distribución extensión Chrome (store: v1.3.3 ✅ · local: v1.3.4 pendiente subir) | jberger19186@gmail.com / Publisher: Jonathan Berger |
| **Anthropic** | API de Claude Haiku para el chat IA del Asistente — ✅ activa en producción | console.anthropic.com |
| **Let's Encrypt / certbot** | SSL gratuito para api.procuradortool.com — renovación automática cada 90 días (vence 2026-06-29) | sin cuenta — corre en el servidor |
| **Azure Trusted Signing** | Code Signing del instalador .exe — ⬜ pendiente contratar | — |
| **MercadoPago / Stripe** | Pagos y suscripciones recurrentes — ⬜ pendiente integrar | — |

### Emails del proyecto

| Email | Rol |
|---|---|
| `jberger19186@gmail.com` | Cuenta personal — GitHub, Chrome Web Store, Brevo |
| `procuradortool@gmail.com` | Recibe alertas de nuevos usuarios registrados (`ALERT_EMAIL_TO`) |
| `soporte@procuradortool.com` | Remitente de todos los emails transaccionales al usuario (`SMTP_FROM`) |

### Verificar / renovar SSL (certbot)
```bash
# Ver estado del certificado
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "certbot certificates"

# Renovar manualmente si hace falta
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "certbot renew"
```

---

## Checklist al publicar nueva versión Electron

Cuando se genera y publica una nueva release de la app Electron, hacer estos pasos **en orden**:

1. Bumping de versión en `electron-app/package.json` (`"version"` + `"build.buildVersion"` si existe)
2. `npm run release` en `electron-app/` → genera instalador y lo sube a GitHub Releases
3. **Actualizar en `backend-server/public/usuarios/app.js`**: la línea de versión en `download-item-desc` (ej: `v2.7.14`)
   *(el link de descarga es dinámico via `/client/download/electron` → no necesita actualización)*
4. Deploy `app.js` al servidor + `pm2 restart procurador-api`
5. Hacer commit + push

> **Nota sobre el link de descarga**: el portal usa `https://api.procuradortool.com/client/download/electron`
> que consulta la GitHub API en tiempo real y redirige al `.exe` del último release.
> Solo hay que actualizar el texto de versión visible (ej: `v2.7.14`), no la URL.

---

## Acceso al servidor de producción

```bash
# SSH
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94

# SCP (subir archivo)
scp -i C:/Users/JONATHAN/.ssh/do_procurador <archivo_local> root@142.93.64.94:<ruta_remota>
```

| Variable | Valor |
|---|---|
| IP servidor | `142.93.64.94` (usar IP, el dominio puede no resolver) |
| Clave SSH | `C:\Users\JONATHAN\.ssh\do_procurador` |
| Ruta proyecto | `/var/www/procurador/` |
| Proceso PM2 | `procurador-api` |
| Reiniciar API | `pm2 restart procurador-api` |
| Base de datos | `procurador_db` (usuario: `procurador_user`) |

### Nginx — sitios activos
- **`api.procuradortool.com`** → `/etc/nginx/sites-available/procurador` → proxy a Express en `https://localhost:3443` — SSL con certbot (vence 2026-06-29)
- **`procuradortool.com`** → `/etc/nginx/sites-available/procuradortool` → sirve landing estática — SSL vía Cloudflare

### Release de la app Electron

```powershell
# Desde PowerShell, en la carpeta electron-app:
# 1. Bumpar version en package.json (ej: 2.4.14 → 2.4.15)
# 2. Ejecutar:
$env:GH_TOKEN="<token_github>"; Set-Location "C:\Users\JONATHAN\source\repos\ProcuradorTool\electron-app"; npm run release
```

- El token de GitHub está en Windows Credential Manager. Si hay que regenerarlo: https://github.com/settings/tokens (permisos: `repo` + `workflow`)
- El release se publica automáticamente en: https://github.com/jberger19186/procurador-tool/releases
- Los usuarios con la app instalada reciben la actualización vía `electron-updater`

### Deploy landing page
```bash
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" \
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/public/landing/index.html" \
  root@142.93.64.94:/var/www/procurador/backend-server/public/landing/index.html
```

### Actualizar scripts de automatización (re-encriptar y subir)

Cuando se modifica un archivo en `backend-server/scripts/` (ej: `buscarPorParteScwpjn.js`):

```bash
# 1. Subir el archivo modificado al servidor
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" \
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/scripts/<nombre>.js" \
  root@142.93.64.94:/var/www/procurador/backend-server/scripts/<nombre>.js

# 2. Re-encriptar (lee los .js de /scripts/, los cifra con AES-256 + RSA y los guarda en la BD)
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "cd /var/www/procurador/backend-server && node reencrypt_scripts.js"

# 3. Reiniciar API
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "pm2 restart procurador-api"
```

> **Nota:** los scripts corren en el cliente (Electron), pero se descargan cifrados desde el servidor.
> El archivo fuente local (en `backend-server/scripts/`) es solo referencia — lo que importa es lo que queda en la BD después del reencrypt.

### Reset de datos de prueba
Script: `backend-server/dev-tools/reset-test-data.sql`

Borra todos los datos transaccionales (pagos, facturas, tickets, logs, eventos, notificaciones, webhook_events, monitor) y los usuarios de prueba, **conservando** los admins (id 6, 7) y `procuradortool@gmail.com` (id 19). Resetea las suscripciones de los conservados a estado inicial.

⚠️ **Siempre hacer backup antes** (queda en `/tmp/backup_pre_reset_<fecha>.sql` en el servidor):
```powershell
$f = Get-Date -Format "yyyyMMdd_HHmmss"
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "sudo -u postgres pg_dump procurador_db > /tmp/backup_pre_reset_$f.sql"
# Ejecutar el reset (ON_ERROR_STOP aborta si algo falla — es transaccional):
Get-Content "backend-server/dev-tools/reset-test-data.sql" | ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "sudo -u postgres psql procurador_db -v ON_ERROR_STOP=1"
```
> Si cambian los IDs de usuarios a conservar, editar las listas `IN (...)` del script. Último reset: 2026-05-29 (backup `backup_pre_reset_20260529_154533.sql`).

### Backup completo del proyecto
Cuando el usuario pide un backup, crear una carpeta en el escritorio con el formato:
`YYYYMM_DDMMYYYY_ProcuradorTool`
Ejemplo para el 29 de abril de 2026 → `202604_29042026_ProcuradorTool`

Pasos a ejecutar en orden:

```powershell
# 1. Crear carpeta con nombre dinámico
$fecha = Get-Date
$carpeta = "C:\Users\JONATHAN\Desktop\$($fecha.ToString('yyyyMM'))_$($fecha.ToString('ddMMyyyy'))_ProcuradorTool"
New-Item -ItemType Directory -Path $carpeta -Force

# 2. Base de datos PostgreSQL
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "sudo -u postgres pg_dump procurador_db" > "$carpeta\procurador_db_backup.sql"

# 3. Variables de entorno (.env)
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94:/var/www/procurador/backend-server/.env "$carpeta\env_backend.txt"

# 4. Claves RSA
New-Item -ItemType Directory -Path "$carpeta\keys" -Force
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" -r "root@142.93.64.94:/var/www/procurador/backend-server/keys/" "$carpeta/keys/"

# 5. Certificados SSL
New-Item -ItemType Directory -Path "$carpeta\certs" -Force
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" -r "root@142.93.64.94:/var/www/procurador/backend-server/certs/" "$carpeta/certs/"

# 6. Código fuente (sin node_modules, dist ni .git)
$source = "C:\Users\JONATHAN\source\repos\ProcuradorTool"
$zipDest = "$carpeta\ProcuradorTool_source.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipDest, 'Create')
$files = Get-ChildItem -Path $source -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\.git\\'
}
foreach ($file in $files) {
    $entryName = $file.FullName.Substring($source.Length + 1)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName) | Out-Null
}
$zip.Dispose()
```

Contenido del backup:
| Archivo | Qué cubre |
|---|---|
| `procurador_db_backup.sql` | Base de datos completa (usuarios, suscripciones, historial) |
| `env_backend.txt` | Variables de entorno y secretos del servidor |
| `keys/` | Claves RSA privadas y públicas |
| `certs/` | Certificados SSL |
| `ProcuradorTool_source.zip` | Código fuente completo |

> ⚠️ Guardar la carpeta en lugar seguro — contiene claves privadas. No subir a lugares públicos.

### Backup de schema DB solamente
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres pg_dump --schema-only procurador_db" > database/schema.sql
```

---

## Flujos de comunicación

### Autenticación (Electron ↔ Backend)
```
Usuario ingresa email/password en Electron
  → POST /auth/login {email, password, machineId}
  ← JWT (2h expiry)
  → Todas las requests siguientes: Authorization: Bearer {token}
```

### Descarga y ejecución de scripts
```
AuthManager.loadAllScripts()
  → GET /client/scripts/available
  → GET /client/scripts/check/:name  (versión/hash ligero)
  → GET /client/scripts/download/:name  ← {encrypted, iv, signature}
  → Descifrar AES-256-CBC + verificar firma RSA-2048
  → ScriptExecutor.run() → Puppeteer con Chrome del usuario
  → POST /client/scripts/log-execution
```

### Candado de ejecución (anti-concurrencia)
```
POST /license/execution/start   → adquiere lock por machineId
POST /license/execution/heartbeat  (cada 30s durante ejecución)
POST /license/execution/end     → libera lock
```

### Extensión Chrome ↔ Backend
```
Autenticación: POST /auth/extension-login
Verificar flujos disponibles: canUseFlow() en auth.js (consulta la DB)
FLOW_ALIASES: { 'notif' → 'notificaciones' }  ← importante, las keys internas difieren de la DB
```

### Portal web de usuarios ↔ Backend
```
Login (permite todos los estados no terminales): POST /auth/portal-login {email, password}
  ← token (8h), emailVerified, registrationStatus
  → Bloquea solo: rejected, cancelled

Reenvío email verificación: POST /auth/resend-verification {email}
  ← Respuesta genérica siempre (anti-enumeración)

Descarga instalador: GET /client/download/electron (autenticado)
  → Consulta https://api.github.com/repos/jberger19186/procurador-tool/releases/latest
  ← 302 redirect al .exe del último release
```

### Estados de `registration_status` del usuario
```
pending_email      → email no verificado: puede logear en portal, NO en Electron/extensión
pending_activation → email verificado, esperando activación manual admin: trial activo (20 usos)
active             → cuenta activa, suscripción normal
suspended          → suspendida por admin
rejected           → rechazada (bloqueo total)
cancelled          → cancelada (bloqueo total)
```

### Navegación al portal web con auto-login (SSO)
```javascript
// renderer.js — openPortalSection(section)
// Secciones válidas: 'ia', 'soporte', 'nuevo-ticket', 'perfil', 'plan', 'facturacion', 'ayuda', null
// URL: /usuarios/?goto=<section>#sso=<token>
// El portal lee el hash #sso= → auto-login → navega a ?goto= → abre sección/modal

openPortal()           // home del portal (sin sección)
openPortalSection('ia')           // sección Asistente IA
openPortalSection('soporte')      // sección Soporte
openPortalSection('nuevo-ticket') // sección Soporte + abre modal nuevo ticket
```
Usado por: botón "Abrir chat" del Asistente IA · "Ver mis tickets" · "+ Nuevo ticket" · 🎫 del chat widget · banners de suscripción.

### IPC Electron (Main ↔ Renderer)
Toda comunicación entre el proceso principal y la UI pasa por `preload.js` (context isolation).
El renderer **nunca** accede directamente a módulos de Node.js.

---

## Endpoints críticos del backend

```
POST   /auth/login                       — Autenticación usuario
POST   /auth/register                    — Registro (redirige a /register/)
GET    /auth/plan-availability           — Planes disponibles (público)
POST   /client/verify-session            — Heartbeat de sesión
GET    /client/scripts/available         — Scripts descargables
GET    /client/scripts/check/:name       — Check versión/hash
GET    /client/scripts/download/:name    — Descarga script cifrado
POST   /client/scripts/log-execution     — Registrar ejecución
POST   /license/execution/start          — Adquirir lock
POST   /license/execution/heartbeat      — Refrescar lock
POST   /license/execution/end            — Liberar lock
POST   /auth/extension-login             — Login desde extensión Chrome
POST   /auth/portal-login               — Login desde portal web (permite pending_email, pending_activation, suspended)
POST   /auth/resend-verification        — Reenvío email verificación (público, rate limited, respuesta genérica)
GET    /client/download/electron        — Redirect dinámico al .exe del último release (autenticado)
GET    /client/notifications             — Notificaciones in-app del usuario (últimas 50)
POST   /client/notifications/:id/read    — Marcar notificación como leída (id='all' = todas)
POST   /client/ai/chat                   — Chat con asistente IA desde Electron (fallback Claude Haiku, rate limit 20/hora/usuario)
POST   /usuarios/api/ai-chat             — Chat con asistente IA desde portal web (historial conversacional, mismo rate limit)
```

### Cobranza / suscripciones (Fase 5 — requieren JWT + PAYMENT_MODULE_ENABLED)
```
POST   /usuarios/api/checkout/init        — Genera init_point MP (external_reference=user_{id} + payer_email)
POST   /usuarios/api/checkout/confirm     — Vincula preapproval tras el checkout (o marca provider si MP no devolvió ID)
POST   /usuarios/api/checkout/reactivate  — Deshace cancelación programada (quita cancel_at, reactiva preapproval en MP)
POST   /usuarios/api/checkout/cancel      — Programa cancelación al fin del período (cancel_at = next_billing_date)
GET    /usuarios/api/checkout/status      — Estado de suscripción para la UI
GET    /usuarios/api/subscription/current — Estado enriquecido (hasPaymentMethod, cancelAt, etc.)
GET    /usuarios/api/payments             — Historial de pagos del usuario
GET    /usuarios/api/invoices             — Historial de facturas del usuario (incluye invoice_type, cae)
POST   /webhooks/mercadopago              — Receptor webhooks MP (HMAC-SHA256, idempotente). Maneja payment,
                                            subscription_authorized_payment, preapproval, subscription_preapproval
```

### Facturación manual — admin (requieren JWT admin)
```
GET    /admin/invoices/pending            — Pagos aprobados sin PDF (con datos de facturación del usuario)
GET    /admin/invoices                    — Facturas emitidas (buscador por email/nombre/CUIT)
POST   /admin/invoices/:invoiceId/upload  — Sube PDF a invoice existente (multer, invoice_type, cae, numero)
POST   /admin/invoices/from-payment/:id   — Crea invoice + sube PDF para un pago sin factura
POST   /admin/invoices/manual             — Factura manual sin pago asociado (user_id, amount, issued_at, PDF)
GET    /admin/users/search                — Autocomplete de usuarios (nombre, apellido, cuit, domicilio)
```

---

## Base de datos — tablas principales

| Tabla | Propósito |
|---|---|
| `users` | Email, password hash, machine_id, role |
| `subscriptions` | Plan asignado, cuotas (usage_count / usage_limit), estado, vencimiento |
| `plans` | Tiers: EXTENSION_PROMO, COMBO_PROMO, BASIC, PRO, ENTERPRISE |
| `encrypted_scripts` | Scripts cifrados (AES-256-CBC), IV, hash SHA-256, versión |
| `active_executions` | Lock de ejecución por machineId (anti-concurrencia) |
| `usage_logs` | Historial de ejecuciones por usuario |
| `token_blacklist` | Tokens invalidados al hacer logout |
| `support_tickets` | Sistema de tickets de soporte |
| `ticket_comments` | Comentarios en tickets |
| `payments` | Pagos MP (external_payment_id, amount, status, raw_response). FK a users + subscriptions |
| `invoices` | Facturas (invoice_type, cae, numero, amount, pdf_url, status). payment_id NULL = factura manual |
| `webhook_events` | Idempotencia de webhooks MP (UNIQUE provider+external_id, processed_at) |
| `usage_extras` | Paquetes de usos extra asignados por admin |

### Sistema de cuotas por plan
```
EXTENSION_PROMO  → USD 1/mes  → 5 flujos extensión, sin cuotas app
COMBO_PROMO      → USD 9.99/mes → extensión + app: 50 proc · 10 inf · 3 partes · 10 nov · 20 batch
BASIC            → app: 50 proc · 10 inf · 3 partes activas
PRO              → app: 200 proc · 50 inf · 10 partes activas
ENTERPRISE       → app: ilimitado · 50 partes activas
```
Nuevos usuarios reciben 20 ejecuciones de prueba por 365 días (estado "suspended" hasta activación manual por admin).

### Arquitectura de usage_limit / usage_count

| Estado | usage_limit | Enforcement |
|---|---|---|
| `pending_activation` (trial) | 20 | Global: `usage_count < usage_limit` — compartido entre todos los subsistemas |
| `active` (activado por admin) | 999999 | Por subsistema: `proc_usage`, `informe_usage`, etc. El global no se enforcea |

- **Trial (`suspended`)**: Electron bloquea cuando `remaining = usage_limit - usage_count = 0`. Backend verifica lo mismo. 20 usos compartidos sin distinción de subsistema.
- **Activo**: `usage_limit = 999999` → `remaining` nunca llega a 0 → Electron no interfiere. El backend enforcea cada subsistema independientemente via sus propias columnas.
- `usage_count` siempre se incrementa (trial y activo) — sirve como contador histórico total.
- El admin puede sobreescribir `usage_limit` manualmente desde la ficha de usuario ("Global (límite total)") o usar "🔓 Ilimitado".

---

## Sistema de diseño (UI)

Aplicado tanto en la app Electron como en la landing page:
```css
--bg:          #f7f7f5   /* fondo base cálido */
--surface:     #ffffff
--amber:       #d97706   /* acento principal */
--amber-dk:    #b45309
--amber-lt:    #f59e0b
--text-1:      #1a1a1a
--text-2:      #4a4a4a
--text-3:      #8a8a8a
--font:        'Inter', system-ui
--font-serif:  'Crimson Pro', Georgia  /* headings */
--font-mono:   'Cascadia Code', Consolas
```
**Referencia de diseño:** sesión "Design professional UI for Electron app".

---

## Extensión Chrome — notas técnicas críticas

### 📦 Sistema de distribución ANTERIOR (pre Chrome Web Store) — CÓDIGO MUERTO, NO ELIMINAR

> Este sistema fue reemplazado por la Chrome Web Store (v1.3.2+).
> El código sigue en producción sin eliminar porque podría necesitarse si la extensión
> fuera removida de la store, o si se quisiera volver a distribución privada.

#### Cómo funcionaba — dos capas paralelas

**Capa 1 — CRX con auto-update (Chrome Policy)**

Chrome tiene un mecanismo nativo de auto-update para extensiones fuera de la store.
Se configuraba apuntando Chrome a una URL de actualización (`update_url`) en el manifest:

```json
// extension-app/manifest.json (versión de desarrollo, solo para distribución CRX)
"update_url": "https://api.procuradortool.com/extension/updates.xml"
```

El flujo:
```
Chrome (cada ~5hs) → GET /extension/updates.xml
  ← XML con versión actual + URL del CRX
  → si versión > local: GET /extension/latest.crx
  → Chrome instala/actualiza automáticamente
```

Archivos en el servidor:
```
backend-server/public/extension/
  ├── meta.json          ← { "id": "ID_DE_LA_EXTENSION", "version": "1.x.x", "crxFile": "extension-1.x.x.crx" }
  └── extension-1.x.x.crx  ← el CRX empaquetado con la clave privada de Chrome
```

Rutas en `server.js` (aún activas, código muerto):
- `GET /extension/updates.xml` — genera el XML de update para Chrome
- `GET /extension/latest.crx` — sirve el archivo `.crx`

**Capa 2 — ZIP descargado desde el onboarding de Electron**

Alternativa al CRX: la app Electron descargaba la extensión como ZIP desde el backend,
la extraía en disco, y el usuario la cargaba manualmente en Chrome como "extensión sin empaquetar".

Flujo en `main.js` (`downloadExtension`):
```
1. GET /api/extension/version  → obtener versión del servidor
2. Comparar con versión local en %LOCALAPPDATA%\ProcuradorSCW\extension_meta.json
3. Si hay versión nueva: GET /api/extension/download → ZIP con scripts ofuscados
4. Extraer ZIP en %LOCALAPPDATA%\ProcuradorSCW\extension\ (carpeta fija)
5. Guardar metadatos locales (version, path, downloadedAt)
```

El usuario luego iba a `chrome://extensions` → "Modo desarrollador" ON → "Cargar sin empaquetar" → seleccionaba esa carpeta.

Protecciones del ZIP (en `routes/extension.js`):
- **Ofuscación JS** con `javascript-obfuscator` (seed determinístico por versión → mismo hash siempre)
- **SHA-256** de cada script (verificados por `background.js` al arrancar)
- **ID-binding**: guardas inyectadas en cada content script
- **JWT**: todos los endpoints requieren autenticación

Scripts ofuscados: `cs-scw.js`, `cs-notif.js`, `cs-escritos2.js`, `cs-deox.js`, `cs-selection.js`
Archivos sin ofuscar: `manifest.json`, `popup.html`, `popup.js`, `config.js`, `auth.js`, `background.js`

Rutas backend activas (código muerto):
- `GET /api/extension/version` — versión actual (requiere JWT)
- `GET /api/extension/download` — ZIP ofuscado (requiere JWT)
- `GET /api/extension/electron-download?token=xxx` — descarga directa por token temporal (para Electron)

#### Cómo se configuraba en el onboarding (configuración inicial)

En el wizard de onboarding, había un paso de instalación de extensión que:
1. Llamaba al IPC `install-extension` → ejecutaba `downloadExtension(token)`
2. Mostraba la ruta de la carpeta extraída
3. Le pedía al usuario abrir `chrome://extensions`, activar modo desarrollador y cargar la carpeta

Código relevante: `main.js` handlers `install-extension` y `check-extension-version`

#### Cómo se configuraba en la configuración de la app

En la sección Configuración → Extensión de la app Electron:
- Botón "Actualizar extensión": llamaba `install-extension` → descargaba nueva versión
- Botón "Verificar versión": llamaba `check-extension-version` → comparaba local vs servidor
- Si había nueva versión: mostraba alerta con instrucciones para recargar en Chrome

#### Para reactivar el sistema viejo

Si hubiera que volver a este sistema:
1. **Generar CRX**: desde `chrome://extensions` en modo developer → "Pack extension" con la clave privada
2. **Subir al servidor**:
   ```bash
   scp -i "C:/Users/JONATHAN/.ssh/do_procurador" extension-1.x.x.crx root@142.93.64.94:/var/www/procurador/backend-server/public/extension/
   # Actualizar meta.json en el servidor con nueva versión y nombre de archivo
   ```
3. **Agregar `update_url` al manifest** de la extensión (la versión de dev, no la de la store)
4. **Configurar Chrome** para aceptar extensiones de URLs externas (requiere Group Policy en Windows o flag de Chrome)

> ⚠️ Nota: desde Chrome 33+, las extensiones CRX externas a la store **solo se pueden instalar
> con Group Policy** en Windows o editando políticas en macOS/Linux. Los usuarios normales
> no pueden instalar CRX de terceros sin esa configuración — por eso se migró a la store.

---

### Versión en store: 1.3.3 (aprobada) · Versión local: 1.3.4 (ZIP listo, pendiente subir)
### Cuenta del store: jberger19186@gmail.com / Publisher: Jonathan Berger

### Permisos (sin `tabs`, sin `content_scripts *://*/*`)
```json
"permissions": ["scripting", "activeTab", "storage", "contextMenus", "alarms"],
"host_permissions": ["https://scw.pjn.gov.ar/*", "https://sso.pjn.gov.ar/*",
  "https://escritos.pjn.gov.ar/*", "https://notif.pjn.gov.ar/*",
  "https://deox.pjn.gov.ar/*", "https://api.procuradortool.com/*"]
```

### FLOW_ALIASES — crítico
```javascript
const FLOW_ALIASES = { 'notif': 'notificaciones' };
// 'notif' es la key interna; 'notificaciones' es como está en la DB
```

### Generar ZIP para el store
```powershell
$source = Resolve-Path 'extension-app'
$dest   = (Resolve-Path '.').Path + '\pjn-extension-X.X.X.zip'
$files  = Get-ChildItem -Path $source -Recurse -File | Where-Object { $_.FullName -notmatch 'imagenes' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($dest, 'Create')
foreach ($file in $files) {
    $entryName = $file.FullName.Substring($source.Path.Length + 1)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName) | Out-Null
}
$zip.Dispose()
# Siempre excluir carpeta imagenes/ (solo para store assets)
```

### Fix clave: setReactVal para inputs MUI
```javascript
function setReactVal(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
// input.value = x directo NO dispara el estado interno de React/MUI
```

### Warning "Procede con cuidado" en Chrome Store
No se puede eliminar por código. Desaparece orgánicamente con ~500-1000 usuarios activos.
Aviso a mostrar al usuario en onboarding:
> "Al instalar, Chrome puede mostrar un aviso de precaución. Es normal para extensiones nuevas y no indica ningún riesgo. Hacé click en 'Continuar a la instalación' para proceder."

---

## Chrome profile — notas técnicas críticas

**Ruta del perfil:** `%LOCALAPPDATA%\ProcuradorSCW\ChromeProfile`
**Contraseñas guardadas:** `...\Default\Login Data` (SQLite, cifrado con DPAPI)

### Flujo de cierre limpio (`closeChromeProfile`)
```
1. wmic → obtener PIDs de chrome.exe con '%ProcuradorSCW%' en commandline
2. taskkill /F /PID <cada pid>
3. await sleep(2000)   ← dar tiempo a Chrome de morir completamente
4. Eliminar: SingletonLock, SingletonCookie, SingletonSocket
   └── taskkill /F deja estos archivos huérfanos
   └── Sin eliminarlos Chrome arranca en crash-recovery (about:blank o diálogo restaurar)
```

### ⚠️ Problema recurrente: `about:blank` — historia y solución definitiva

Este bug rompió la app múltiples veces. Documentado para no volver a introducirlo.

**Síntoma:** Chrome abre en `about:blank` (o en la página de Google) en lugar de ir directo al destino. La automatización falla porque los selectores no encuentran nada.

**Causas que se identificaron:**

1. **`waitForNavigation()` después de que Chrome ya navegó** → espera una navegación que nunca llega → timeout de 30s → falla.
2. **`chrome://` URLs pasadas como arg de launch** → Chrome las ignora silenciosamente en algunos perfiles y abre Google o nueva pestaña.
3. **Lock files huérfanos** (`SingletonLock`, `SingletonCookie`, `SingletonSocket`) → `taskkill /F` mata Chrome pero no limpia estos archivos → al próximo arranque Chrome entra en crash-recovery y muestra `about:blank` o el diálogo "restaurar sesión".

**Solución definitiva por script:**

```javascript
// ✅ abrirNavegadorPJN.js — sitios web externos (https://)
// Pasar la URL como arg de launch evita el flash de about:blank inicial
// page.goto() luego espera los redirects completos de SSO (networkidle2)
puppeteer.launch({ args: [..., 'https://portalpjn.pjn.gov.ar'] })
await page.goto('https://portalpjn.pjn.gov.ar', { waitUntil: 'networkidle2', timeout: 60000 });

// ✅ agregarPasswordSCW.js — URLs chrome:// internas
// NO pasar chrome:// como arg de launch (Chrome lo ignora → abre Google)
// Usar directamente page.goto() después de que Chrome arranque
puppeteer.launch({ args: [...] })  // sin URL en args
await page.goto('chrome://password-manager/passwords', { waitUntil: 'domcontentloaded', timeout: 30000 });

// ❌ NUNCA hacer esto:
await browser.pages()           // obtener page
await waitForNavigation()       // esperar navegación → YA OCURRIÓ → timeout
```

**`closeChromeProfile()` — limpieza obligatoria de lock files:**
```
1. wmic → PIDs de chrome.exe con '%ProcuradorSCW%' en commandline
2. taskkill /F /PID <cada pid>
3. await sleep(2000)   ← Chrome necesita tiempo para morir
4. fs.unlinkSync: SingletonLock, SingletonCookie, SingletonSocket
   └── Sin este paso → próximo arranque entra en crash-recovery → about:blank
```

### Flags de Chrome a NO usar (generan banners en el navegador)
```
--no-sandbox                              ← banner de seguridad naranja
--ignore-certificate-errors               ← banner de seguridad
--disable-blink-features=AutomationControlled  ← detectable, innecesario
```
Sí usar: `ignoreDefaultArgs: ['--enable-automation']` (quita la barra de "controlado por software")

### Diagnóstico rápido: credenciales guardadas
```powershell
# Verificar si hay contraseñas guardadas para pjn.gov.ar
$f = "$env:LOCALAPPDATA\ProcuradorSCW\ChromeProfile\Default\Login Data"
$b = [IO.File]::ReadAllBytes($f)
[Text.Encoding]::UTF8.GetString($b) -match "pjn"
# → True: hay credenciales   False: Login Data vacío → debe correr "Agregar contraseña SCW"
```
Si el resultado es `False`, la automatización **no puede autofill** y el usuario debe guardar la contraseña desde Configuración → Seguridad → "Agregar contraseña SCW".

---

## ⛔ Zonas protegidas — NO modificar sin coordinación

| Zona | Por qué no tocar |
|---|---|
| `backend-server/keys/` | Claves RSA privadas — si se cambian, todos los scripts dejan de verificarse |
| `backend-server/certs/` | Certificados SSL — manejar con certbot en producción |
| `electron-app/src/security/` | Lógica de cifrado, verificación de firma, autodestrucción |
| `machineId` / hardware binding | Cambiar rompe el lock de dispositivo de todos los usuarios |
| Campos `usage_count` / `usage_limit` en DB | Afectan directamente las cuotas de todos los clientes |
| `manifest.json` de la extensión | No sincronizar entre `extension-app/` dev y producción — tienen diferencias intencionales |

---

## 📋 Pendientes — Prioridad actual
> Última actualización: 2026-05-20. Sin usuarios reales en producción — priorizar lo comercial antes que la infraestructura.
> Regla: Bloques 6 y 7 son obligatorios **antes de abrir el registro público**, no antes.

---

### 🥇 BLOQUE 1 — Identidad de Marca & Landing
- ⬜ Identidad de marca consolidada: copy unificado, tono consistente en todos los emails transaccionales
- ⬜ Consistencia de nombre en instalador `.exe`, extensión Chrome Store y emails
- ✅ Landing: sección Planes con precios de promos (Extensión USD 1/mes, Combo Beta USD 9,99/mes) + "Próximamente" para planes permanentes
- ✅ Términos y Condiciones de Uso — `/terminos/index.html` publicado y enlazado desde footer landing y formulario de registro
- ✅ Política de Privacidad — `/privacidad/index.html` publicado y enlazado desde footer landing y formulario de registro
- ✅ Aviso PJN (credenciales nunca pasan por servidores) — sección "Privacidad & seguridad" en landing
- ✅ Planes y precios de promos visibles en landing y en flujo de registro (cards dinámicas)
- ✅ Alertas de promo en Electron: `checkPromoAlert()` muestra banner para usuarios en plan promo (vencimiento, extensión de fecha)

---

### 🥈 BLOQUE 2 — Planes & Precios ⏸️ DIFERIDO (ejecutar al abrir venta pública)
- ✅ Precios fijados en DB y landing (indexados a UMA CSJN): BASIC $31.875 · PRO $63.751 · ENTERPRISE $95.626 ARS/mes
- ✅ Promos: EXTENSION_PROMO $1.500 · COMBO_PROMO $15.000 ARS/mes
- ⏸️ **Activar planes permanentes** → diferido al lanzamiento público (`UPDATE plans SET active=true WHERE name IN ('BASIC','PRO','ENTERPRISE')`)
- ⏸️ **Actualizar precios** en `landing/index.html` (3 precios + nota UMA) + `terminos.html` + 2 filas en DB → diferido; ejecutar solo si el valor UMA cambia antes del lanzamiento

---

### 🥉 BLOQUE 3 — Code Signing ← iniciar trámite ya (tiene tiempos externos)
- ⬜ Crear cuenta Azure + Azure Trusted Signing (~USD 9/mes)
- ⬜ Firmar instalador `.exe` (elimina warning SmartScreen en cada instalación nueva)
- Docs: https://learn.microsoft.com/en-us/azure/trusted-signing/

---

### 4️⃣ BLOQUE 4 — Pago & Facturación
- ⬜ Decidir MercadoPago (recomendado, mercado local) vs Stripe como alternativa secundaria
- ⬜ Portal de pago en Electron: selector de plan + formulario de pago
- ⬜ Integración MercadoPago/Stripe: primer cobro + webhooks de renovación
- ⬜ Campos DB a agregar:
  ```sql
  ALTER TABLE subscriptions ADD COLUMN payment_provider VARCHAR(20);
  ALTER TABLE subscriptions ADD COLUMN external_subscription_id VARCHAR(100);
  ALTER TABLE subscriptions ADD COLUMN next_billing_date TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN cancel_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN payment_grace_until TIMESTAMP WITH TIME ZONE;
  ALTER TABLE users ADD COLUMN cuit_deleted_at TIMESTAMP WITH TIME ZONE;
  ```
- ⬜ Nuevas tablas: `payments` (historial de cobros) y `payment_events` (cargo, reembolso, fallo, disputa)
- ⬜ Banner post-activación en Electron: "Configurá tu método de pago"
- ⬜ Ciclo mensual automático (cron job en backend)
- ⬜ Gracia 3 días en pago fallido + reintentos automáticos + suspensión automática
- ⬜ Flujo de cancelación desde portal de usuario
- ⬜ Retención CUIT 90 días + job de limpieza
- ⬜ Facturación AFIP

---

### 5️⃣ BLOQUE 5 — Soporte & FAQs & Chat & Tickets
- ✅ FAQs expandidas: 10 → 34 preguntas en 7 categorías con filtro por pills (v2.7.2)
- ✅ Endpoint `POST /client/ai/chat` activo con Claude Haiku + rate limit + system prompt (v2.7.2)
- ✅ `docs/manual-de-usuario.md` publicado en el repo
- ✅ `ANTHROPIC_API_KEY` configurada en servidor — fallback IA activo en producción (Claude Haiku)
- ⬜ Sistema de tickets mejorado: notificaciones email al usuario cuando admin responde, plantillas, filtros y prioridades

---

### 6️⃣ BLOQUE 6 — Seguridad & Backups & Tests & Documentación ← antes del lanzamiento público
- ✅ Backups automáticos PostgreSQL — cron diario 03:00 AM, retención 7 días, log + alerta email (2026-05-26)
  - Script: `/var/www/procurador/backend-server/scripts/backup-db.sh`
  - Destino: `/var/backups/procurador/` en el servidor
  - ⬜ **Pendiente futuro:** replicar backups a **DigitalOcean Spaces** (~USD 5/mes) para tener copia fuera del servidor — integrar con `s3cmd` en el mismo script
- ✅ Hardening secretos RSA (2026-05-26): `RSA_PRIVATE_KEY` + `RSA_PUBLIC_KEY` movidas a `.env`
  - `scriptSigner.js` lee env vars primero, fallback a archivos PEM solo en desarrollo
  - `ENCRYPTION_KEY` (AES) ya estaba en `.env` desde el inicio
  - Archivos `keys/private.pem` y `keys/public.pem` se mantienen en servidor como backup, pero el proceso no depende de ellos
- ⬜ Smoke tests / canary tests para endpoints críticos (CI pre-deploy) ← PRE-LANZAMIENTO
- ✅ Suite QA completa ejecutada (2026-05-20): 159/165 PASS, 0 FAIL — ver `tests/QA_RESULTS.md`
- ✅ Suite de tests automatizados en `tests/` (pytest + Playwright) con módulos M1–M14
- ⬜ **Diferido:** Verificar descarga de scripts en PC de usuario real (firma RSA + auto-destrucción)
- ⬜ **Diferido:** Análisis de seguridad profundo (Electron + backend)
- ⬜ **Diferido:** Documentación técnica completa (endpoints, esquema DB, runbook de operaciones)

---

### 7️⃣ BLOQUE 7 — Entorno de Pruebas
- ⬜ Servidor staging (proceso PM2 separado, BD `procurador_db_staging`, subdominio `staging.api.procuradortool.com`)
- ⬜ Smoke tests automatizados pre-deploy
- ⬜ Proceso de release documentado paso a paso
- ⬜ Mecanismo de rollback definido y probado

### Flujo oficial de usuario (aprobado 2026-04-28)
```
1. REGISTRO
   → Email + contraseña + CUIT (obligatorio, único en el sistema)
   → Si CUIT ya existe → error, no permite continuar
   → registration_status: pending_email
   → Email de verificación

2. VERIFICACIÓN DE EMAIL
   → registration_status: pending_activation
   → subscription: suspended, usage_limit = 20
   → Email: "Tenés 20 usos de prueba. Para continuar necesitarás un medio de pago."

3. PERÍODO DE PRUEBA (0 a 20 usos)
   → Admin puede activar en cualquier momento → full plan (sin pago, caso especial)
   → Admin puede rechazar en cualquier momento:
      - Bloquear: acceso revocado + notificación con motivo
      - Mantener trial: conserva usos restantes + notificación
   → Electron muestra en Mi Cuenta: "X/20 usos — Para continuar configurá tu suscripción"

4. USUARIO QUIERE CONTINUAR (agotó usos o decidió antes)
   → Elige plan y paga en el portal
   → registration_status: pending_payment
   → Admin recibe notificación con datos del usuario + pago confirmado
      - ✅ Aprueba → active, email bienvenida, ciclo mensual inicia
      - ❌ Bloquea → reembolso automático + notificación con motivo
      - ⏸ Mantiene trial → conserva usos restantes + notificación

5. ACTIVO
   → Renovación mensual automática vía webhook
   → Pago fallido → gracia 3 días → suspensión → notificación in-app + email
   → Admin puede suspender manualmente en cualquier momento con notificación

6. CANCELACIÓN / BAJA
   → Usuario cancela → acceso hasta fin del período pagado
   → Baja definitiva → CUIT liberado, datos retenidos 90 días
   → Reactivación futura → nuevo registro con mismo CUIT, historial preservado
```

---

## Plan de comercialización — 6 fases

### FASE 1 — APLICACIÓN (en curso)
**Objetivo:** producto terminado y pulido para el usuario final.

#### 1.0 Estabilización, UX y estilos del onboarding ✅ COMPLETADO (v2.4.x → v2.4.14)
Sesión 2026-04-24 — fixes acumulados en versiones 2.4.2 → 2.4.10:
- ✅ Eliminados banners Chrome: `--no-sandbox`, `--ignore-certificate-errors`, `--disable-blink-features=AutomationControlled`
- ✅ Tour paso 10: card se posiciona correctamente a la derecha de los botones spotlight (getBoundingBox + `right` property + 350ms delay para transición CSS)
- ✅ Onboarding completo: ventana principal ya no se duplica al finalizar wizard
- ✅ Credenciales en onboarding: lee `psc_accounts` (formato multi-cuenta) en lugar de `psc_remember` obsoleto
- ✅ Visor automático: corregido selector de toggle (`tgl-abrirVisor` + `.cfg-toggle.on`)
- ✅ `closeChromeProfile()`: mata Chrome por PID, espera 2s, elimina lock files (SingletonLock/Cookie/Socket) para evitar crash recovery
- ✅ `abrirNavegadorPJN.js`: Chrome abre directamente en `portalpjn.pjn.gov.ar` (URL como arg de launch); `page.goto()` espera la cadena completa de redirects SSO; completa CUIT y busca credenciales
- ✅ `agregarPasswordSCW.js`: usa `page.goto('chrome://password-manager/passwords')` directamente después de lanzar Chrome (arg de launch no funcionaba — Chrome abría Google primero); overlay mostrado inmediatamente tras goto, antes del sleep
- ✅ `preCalentarChrome.js`: corregido profilePath (`APPDATA` → `LOCALAPPDATA\ProcuradorSCW\ChromeProfile`) — script orphaned, no se llama desde main.js
- ✅ **Estilos onboarding unificados con la app** (v2.4.11, rama `visual-onboarding-fixes`):
  - `onboarding.css`: logo/botones/inputs/info-box migrados de azul/violeta → amber (`#d97706`), fondo `#f7f7f5`
  - Botones: tamaño igual al tour card (`padding:6px 14px; font-size:12px; border-radius:7px`)
  - Modal "Nueva versión" (`index.html`): rediseñado igual que tour card (amber border, icono `#422006`, botón `#eab308`)
  - Modal "Acción requerida" (`renderer.js`): misma estructura tour card + texto fijo hardcodeado ("Chrome está esperando que ingreses tu contraseña del PJN...") — ya no depende del mensaje del script encriptado
- ✅ **v2.4.13 → v2.4.14** (sesión 2026-04-24, rama `fix/agregar-password-overlay`):
  - `agregarPasswordSCW.js`: eliminada la `chrome://` URL del arg de launch (Chrome la ignoraba y abría Google); reemplazada por `page.goto()` directo tras el arranque
  - Overlay mostrado inmediatamente después de `page.goto()`, antes del sleep — queda visible durante todo el llenado del formulario
  - Re-inyección del overlay tras clic en "Agregar" (la navegación SPA de Chrome lo borraba)
  - Nota: el dialog nativo "Agregar contraseña" usa el top-layer del browser — ningún overlay web puede renderizarse encima; es una limitación de Chrome, no un bug

#### 1.1 Sistema de diseño de la App Electron ✅ COMPLETADO
- Estilos amber (`#d97706`), Inter, Crimson Pro aplicados consistentemente en toda la app
- Onboarding, modales, tour cards y configuración ya son visualmente coherentes
- No se requieren cambios adicionales de presentación

#### 1.1b Refactor técnico `renderer.js` ✅ COMPLETADO (decisión 2026-04-27)
- `renderer.js` permanece monolítico — funciona correctamente y no hay problemas de mantenimiento actuales
- Se decidió no dividir en módulos por ahora: el costo de refactor supera el beneficio en esta etapa
- Revisitar solo si el archivo crece significativamente o aparecen conflictos reales

#### 1.2 Migración extensión → Chrome Web Store ✅ COMPLETADO
- Extensión publicada y aprobada en Chrome Web Store (v1.3.3 — branding actualizado)
- Onboarding actualizado con enlace directo a la store
- Aviso sobre warning de Chrome al instalar incluido en onboarding
- ⏸️ **Actualizar imágenes en Chrome Web Store** — las capturas del listing deben reflejar la UI actual (diferido)
- ⏸️ **Limpiar distribución CRX del backend** — diferido: `main.js` sigue llamando a `/api/extension/version` y `/api/extension/download`; para limpiar hay que migrar esos handlers. No urgente — la ruta sigue funcionando.

#### 1.3b Rediseño visual de los visores HTML ✅ COMPLETADO (sesión 2026-04-24)
- `visorModal_template.html` (procuración): rediseñado — tabla plana con modal de movimientos, amber/Inter
- `informe/visor_informes_template.html`: rediseñado — header sticky, stats row, tabla de expedientes
- Monitor de partes (`generarVisorMonitoreo` en `main.js`): rediseñado — cards por parte con accordion, sistema de diseño unificado

#### 1.4 Unificación "Procurar hoy" + "Por fecha" — ✅ COMPLETADO (v2.4.16)

- Botón "Por fecha" eliminado del sidebar
- Campo `Fecha límite` (DD/MM/YYYY) agregado debajo del botón Procurar
- Sin fecha → procura hoy; con fecha → procura desde esa fecha (`runProcessCustomDate`)
- Sincronización bidireccional con el campo "Fecha límite" del modal de Configuración
- Guarda en `config.general.fechaLimite` automáticamente al cambiar
- Nueva función `runProcessFromSidebarFecha()` en `renderer.js`
- Tour actualizado: paso 4 resalta Procurar + campo + Por lote con spotlight conjunto

---

#### 1.5 Tour accesible + Asistente IA en sección Sistema — ✅ COMPLETADO (v2.4.16)

Sección Sistema del sidebar:
```
⚙  Configuración
🧩  Extensión PJN
❓  Ver tour              → llama window.startAppTour()
🤖  Asistente IA          → abre #modalAsistente (FAQ accordion)
```

**Ver tour** (`#btnSidebarTour`): llama directamente `window.startAppTour()`. No interfiere con el sistema de active state del sidebar (usa `id` en lugar de `data-action`).

**Asistente IA** (`#btnSidebarAsistente`): abre `#modalAsistente` con 7 FAQs en accordion expandible + campo de búsqueda en vivo. Al pie: botón "Abrir chat" → abre el chat widget flotante.

**Tour** actualizado: nuevo paso 13 resalta ambos botones; paso 10 y paso 4 ahora centran el card respecto al bounding box de los elementos (no al viewport).

---

#### 1.6 Chat widget flotante + búsqueda FAQ — ✅ COMPLETADO (v2.4.17)

**Chat widget** (`#chatWidget`, body-level, `position:fixed` bottom-right):
- Dos estados: burbuja minimizada (🤖 naranja, 52px) y ventana expandida (340×440px)
- Header amber con botones: 🎫 escala a tickets · — minimiza · ✕ cierra completamente
- Burbujas diferenciadas: usuario (derecha, amber) · bot (izquierda, gris con borde)
- Indicador de typing animado (3 dots bounce) antes de la respuesta del bot
- Respuesta placeholder hasta configurar IA real
- Posicionamiento dinámico vía `getBoundingClientRect(#consoleStatusbar)` — garantiza igual gap visual que `right: 24px`
- Rama: `feature/asistente-chat` mergeada a `main`

**Búsqueda en vivo en FAQ** (`#faqSearch`):
- Input con lupa encima del listado
- Filtra por título Y contenido de respuesta en tiempo real
- Muestra "Sin resultados para X" si no hay coincidencias
- Se resetea y enfoca automáticamente al abrir el modal

**IA real conectada:** `POST /client/ai/chat` → Claude Haiku (ANTHROPIC_API_KEY activa). ✅

---

#### 1.7 Rediseño modales Mi Cuenta y Estadísticas — ✅ COMPLETADO (v2.4.21–v2.4.22)

**Mi Cuenta — cuenta suspendida (pendiente de activación):**
- Estado muestra "⏳ Pendiente de activación" en lugar de "⚫ Suspendido"
- Banner amber con barra de progreso y contador **X / 20 usos globales** del período de prueba
- Sección subsistema muestra aviso: "Los usos individuales se habilitarán al activar tu cuenta"

**Mi Cuenta — cuenta activa:**
- Sección "Uso por subsistema" reemplaza barras horizontales por **cards** (mismo estilo que Estadísticas)
- Cada card: ícono + `usado / límite` + mini barra de progreso + restantes en color

**Estadísticas — todas las cuentas:**
- Eliminadas las 3 cards antiguas (Procuraciones / Informes / Monitoreo) sin límites — redundantes
- Sección "Uso por subsistema": **5 cards** con uso + límite + restantes por módulo (solo activos)
- Card "Tasa de éxito" → **"Usos en el período"** (`usage_count` real de la DB)
- Para trial: muestra `X / 20 — Usos de prueba`
- `get-stats` en `main.js` ahora pasa datos de cuenta (`status`, `registrationStatus`, `usage`) al renderer

**Archivos modificados:** `index.html`, `renderer.js`, `main.js`, `styles.css`

---

#### 1.3 Code Signing — ⏸️ DIFERIDO (iniciar en paralelo a Fase 5 — tiene tiempos externos)
- Firmar el instalador `.exe` de Electron con **Microsoft Azure Trusted Signing**
- Objetivo: eliminar el warning "Editor desconocido" de Windows SmartScreen al instalar la app
- Sin firma: SmartScreen bloquea o advierte la instalación en Windows; con firma: instalación fluida
- Requiere cuenta Azure + certificado EV o Azure Trusted Signing (~USD 9/mes)
- Docs: https://learn.microsoft.com/en-us/azure/trusted-signing/

---

### FASE 2 — BACKEND (parcialmente completada)
**Objetivo:** infraestructura robusta, segura y documentada.

- ✅ Backups programados PostgreSQL — cron 03:00 AM, retención 7 días, alerta email (2026-05-26)
- ✅ Hardening secretos RSA — `RSA_PRIVATE_KEY` + `RSA_PUBLIC_KEY` movidos a `.env` (2026-05-26)
- ✅ Smoke tests endpoints críticos — `smoke-test-pjn.js` 48/48 ✅ (2026-05-27)
- ⏸️ Análisis de seguridad profundo (app Electron + backend) — diferido post-Fase 5
- ⏸️ Documentación técnica completa del backend — diferido

---

### FASE 3 — COMERCIAL (en curso, paralela a Fase 1)
**Objetivo:** presencia pública y capacidad de vender.

#### 3.1 Página Web / Landing Page ✅ COMPLETADO
- Archivo fuente: `backend-server/public/landing/index.html`
- URL: https://procuradortool.com
- Sistema de diseño aplicado (amber, Inter, Crimson Pro)
- Estructura: Navbar · Hero · Problema · App Showcase · Funciones · Extensión · Cómo funciona · Seguridad/Privacidad · Planes · CTA · Footer
- Planes permanentes visibles como "Próximamente" — se activan al lanzamiento público (ver 3.3)

#### 3.2 Términos Legales ✅ COMPLETADO (2026-05-20)
- ✅ Términos y Condiciones de Uso — `/terminos/index.html` publicado
- ✅ Política de Privacidad — `/privacidad/index.html` publicado
- ✅ Aviso PJN (credenciales nunca pasan por servidores) — en sección "Privacidad & seguridad" de la landing
- ✅ Links desde footer de la landing y desde checkbox en formulario de registro

#### 3.3 Estrategia de Venta y Planes ✅ COMPLETADO (activación diferida al lanzamiento)
- ✅ Promos: EXTENSION_PROMO $1.500 ARS/mes · COMBO_PROMO $15.000 ARS/mes — activas en DB y landing
- ✅ Permanentes fijados en DB indexados a UMA CSJN: BASIC $31.875 · PRO $63.751 · ENTERPRISE $95.626 ARS/mes
- ✅ Planes permanentes visibles en landing como "Próximamente"
- ⏸️ **Activar BASIC/PRO/ENTERPRISE** — diferido al lanzamiento público: `UPDATE plans SET active=true WHERE name IN ('BASIC','PRO','ENTERPRISE')`
- Registro en: `https://api.procuradortool.com/register/`

#### 3.4 Registro y Recolección de Datos ✅ COMPLETADO
- ✅ Registro público con verificación de email
- ✅ Flujo de activación manual por admin
- ✅ Alertas de promo en Electron: `checkPromoAlert()` muestra banner de promo (vencimiento, extensión de fecha)

#### 3.5 Identidad de Marca ✅ COMPLETADO
- Nombre: **Procurador SCW** / **ProcuradorTool**
- Dominio: procuradortool.com
- Publisher Chrome Store: Jonathan Berger

---

### FASE 4 — SOPORTE ✅ CERRADA (sesión 2026-05-22, tag `fase4-completa`)
**Objetivo:** atención al usuario eficiente con asistencia IA.

> Items 1+2+3 completados cubren el 80% del valor de soporte.
> Items 4 (KB) + 3.5 (borradores masivos) diferidos a iteración futura — diseño guardado en `docs/internal/mejoras-futuras.md`.

- ✅ Sistema de tickets básico (crear, responder, estados)
- ✅ Notificaciones in-app admin → usuario (v2.5.x)
- ✅ **Asistente IA — App Electron** (v2.7.2): 34 FAQs con filtro por categoría + chat widget async con fallback `POST /client/ai/chat` → Claude Haiku
- ✅ **Asistente IA — Portal web** (`/usuarios/`): chat con historial de conversación → `POST /usuarios/api/ai-chat` → Claude Haiku (mismo system prompt, rate limit 20/hora, historial últimos 10 mensajes)
  - ✅ `ANTHROPIC_API_KEY` activa en el servidor — ambos endpoints en producción
  - Diferencia: Electron usa FAQ local como primera línea (gratis, sin latencia); portal web va directo a la API (chat conversacional con historial)
  - Costo estimado: ~USD 1.60/mes para 200 usuarios × 20 queries/mes (Claude Haiku)
- ✅ **Sección "Ayuda" — Portal web** (`/usuarios/`): FAQ accordion + manual inline, sin requerir app Electron
  - 34 preguntas en 7 categorías con pills de filtro y buscador por texto (mismo contenido que app Electron)
  - Manual de usuario completo renderizado como HTML inline dentro del portal (toggle, scrollable, tablas, código)
  - Funciones: `renderAyuda()`, `renderAyudaFaq()`, `getManualHTML()`, `AYUDA_FAQ_ITEMS`, `AYUDA_FAQ_CATS`
  - `goto=ayuda` soportado vía el handler SSO genérico existente
- ✅ Documentación de ayuda publicada: `docs/manual-de-usuario.md` + `docs/internal/sistema-estados-flujos.md`
- ✅ **Email de respuesta admin→usuario** (Fase 4 Ítem 1 — sesión 2026-05-22, tag `fase4-item1`):
  - Cuando un admin agrega comentario en `POST /admin/tickets/:id/comment` → email automático al usuario
  - **Asunto**: `Procurador SCW — Respuesta a tu ticket #X`
  - **Contenido**: preview de 200 chars + botón "Ver respuesta completa" hacia el portal
  - **Login**: el botón lleva al login normal del portal (`?goto=soporte`) — sin SSO por seguridad anti-forward
  - **Persistencia post-login**: `sessionStorage.pending_goto` sobrevive al ciclo de login y `initDashboard()` lo consume para navegar a la sección correcta
  - **Feature flag**: `EMAIL_TICKET_REPLY_ENABLED=true` en `.env` del server
  - **Función**: `sendTicketReplyEmail()` en `utils/mailer.js`
  - **No bloqueante**: envío async fire-and-forget con catch (no rompe el flujo HTTP)
  - **UTF-8 garantizado**: wrapper automático de `<!DOCTYPE><meta charset>` en `sendEmail()` + `textEncoding: 'base64'` en nodemailer — beneficia todos los emails del sistema
  - **PORTAL_URL** corregido a `https://api.procuradortool.com/usuarios/` (antes apuntaba mal a la landing)
  - **UX**: badge `#ID` ahora visible en la lista y detalle de tickets del portal (consistencia con el email)
- ✅ **Prioridad IA en tickets** (Fase 4 Ítem 2 — sesión 2026-05-22, tag `fase4-item2`):
  - **Modelo**: `support_tickets` +`priority_source`, +`priority_notes`, +`priority_set_at`, +`priority_set_by` (migración `20260522_add_ticket_priority_source.sql`)
  - **Estados de source**: `NULL` (sin clasif, IA puede procesarlo) · `'ai'` (IA clasificó) · `'manual'` (admin bloqueó) · `'ai_overridden'` (legacy, equivalente a manual)
  - **Endpoint nuevo**: `POST /admin/tickets/ai-prioritize { ticket_ids?: [] }` — clasifica con Claude Haiku (rate limit 100/h/admin, paralelismo 5)
  - **Endpoint actualizado**: `PUT /admin/tickets/:id/priority` ahora acepta `ai_managed: boolean`
    * `ai_managed=true` + priority cambió → source=NULL
    * `ai_managed=true` + prevSource era manual/ai_overridden → source=NULL (transición)
    * `ai_managed=true` + ya era ai/NULL sin cambios → preservar (noop)
    * `ai_managed=false` → source='manual'
  - **Endpoint helper**: `POST /admin/tickets/:id/reset-priority` (limpia source, accesible vía API)
  - **UI**:
    * Tabla: badge con ícono 🤖 (IA) / 👤 (admin) / borde punteado "sin clasif." (NULL)
    * Detalle: toggle "🤖 IA gestiona esta prioridad" + mini-badge dinámico + razonamiento IA visible si existe
    * Botón global "🤖 Establecer prioridad por IA (N)" en header de Tickets
  - **System prompt**: `AI_PRIORITY_SYSTEM_PROMPT` con contexto Procurador SCW y criterios L/M/H/U conservadores
  - **Modelo**: `claude-haiku-4-5`, max_tokens 300
- ✅ **Visibilidad + IA suggest + Ajustes manuales en tickets** (Fase 4 Ítem 3 — sesión 2026-05-22, tag `fase4-item3`):
  - **DB**: `ticket_comments` +`visibility` (`'external'` default | `'internal'`) · tabla nueva `ai_assistance_logs` (telemetría)
  - **Visibilidad de comentarios**:
    * `POST /admin/tickets/:id/comment` acepta `visibility: 'external'|'internal'`
    * Internas: NO envían email, NO cambian status del ticket, NO se devuelven en `GET /tickets/:id` (endpoint user)
    * Admin endpoint sí las devuelve con campo `visibility`
    * UI: hilo con fondo amarillo + label "🔒 NOTA INTERNA" para internas
    * Compositor con dropdown "Externa / Interna" (default externa)
  - **Proyectar con IA**: `POST /admin/tickets/:id/ai-suggest-reply`
    * Modelo: Claude Haiku 4.5, max_tokens 600
    * Rate limit: 30 sugerencias/hora/admin
    * Contexto: ticket + plan + historial completo (internas + externas) — la IA ve notas internas como contexto privado pero genera respuesta externa
    * AI_REPLY_SYSTEM_PROMPT con tono rioplatense + reglas anti-hallucination
    * Solo habilitado en modo Externa (deshabilitado si tipo=Interna)
    * Pre-carga la sugerencia en el textarea — admin edita y envía manualmente (nunca auto-envía)
    * Telemetría: `PATCH /admin/ai-suggest-logs/:id` registra `action` ('sent_as_is'/'sent_edited'/'discarded') + `edit_distance`
  - **Ajuste manual de usos desde ticket**: card nueva en detalle del ticket
    * Reusa endpoint existente `POST /admin/subscriptions/:userId/adjust` con `ticket_id` auto-rellenado
    * Diferente de "Beneficio comercial": múltiples ajustes permitidos, reversibles, granular por subsistema
    * Muestra historial reciente de ajustes del usuario (últimos 5)
- 📌 **Diferidos a iteración futura** (diseño completo en `docs/internal/mejoras-futuras.md`):
  - **Base de Conocimiento (Ítem 4)** — postergado hasta tener 20-30 tickets cerrados reales
  - **Borradores masivos con IA (Ítem 3.5)** — postergado hasta tener KB poblada + volumen > 20 tickets/día
  - Decisión 2026-05-22: cerrar Fase 4 con Items 1+2+3 que cubren el 80% del valor

---

### FASE 5 — COBRANZA (pendiente)
**Objetivo:** cobro automático de suscripciones.
**Plan detallado:** `docs/internal/plan-fase5-cobranza.md`

---

#### Flujo completo — Registro, Trial y Suscripción

##### 1. REGISTRO
```
Email + contraseña + CUIT
  ├── CUIT duplicado → error
  ├── Email duplicado → error
  └── OK → registration_status: pending_email
           → Email de verificación
```

##### 2. VERIFICACIÓN DE EMAIL
```
Usuario hace click en el link
  └── registration_status: pending_activation
      subscription: { status: suspended, usage_limit: 20 }
      → Email: "Tenés 20 usos de prueba. El equipo revisará tu cuenta
                y te avisará cuando puedas continuar."
```

##### 3. TRIAL (0 → 20 usos) — Admin decide
```
Admin recibe alerta de nuevo usuario pendiente.
Puede decidir en cualquier momento durante el trial:

  ✅ ACTIVA
     → registration_status: active
     → subscription: { status: active, plan asignado }
     → user_event: activated
     → user_notification + email: "Tu cuenta fue activada.
                                    Configurá tu método de pago para continuar."
     → Electron muestra banner → "Configurar suscripción"
     → Usuario elige plan + carga método de pago (paso 4)

  🚫 RECHAZA + BLOQUEA
     → registration_status: rejected
     → subscription: status: cancelled
     → Acceso revocado inmediatamente, sin opción de pago
     → user_event: rejected_blocked { reason }
     → user_notification + email: "Acceso denegado. Motivo: ..."

  ⏸ RECHAZA + MANTIENE TRIAL
     → registration_status: pending_activation (sin cambio)
     → subscription: sin cambio (sigue con los usos restantes)
     → Puede seguir usando hasta agotar sus 20 usos
     → No hay opción de pago — necesita aprobación del admin para convertir
     → user_event: rejected_keep_trial { reason }
     → user_notification: "Tu solicitud está en espera. Motivo: ..."
     → Al agotar los 20 usos: acceso suspendido automáticamente
```

##### 4. CONFIGURACIÓN DE PAGO *(solo usuarios activados por admin)*
```
Usuario accede al portal de pago (desde Electron o web):
  ├── Elige plan: BASIC / PRO / ENTERPRISE
  ├── Carga método de pago (MercadoPago / Stripe)
  └── Confirma → primer cobro ejecutado
        ├── ✅ Cobro exitoso
        │     → subscription: { status: active, payment_provider, next_billing_date }
        │     → Ciclo mensual comienza
        │     → user_event: payment_setup { plan, provider }
        └── ❌ Cobro fallido
              → Error en pantalla, invita a reintentar
              → Acceso del trial activado se mantiene mientras resuelve
```

##### 5. ACTIVO — Ciclo mensual
```
Renovación automática cada 30 días:
  ├── ✅ Cobro exitoso → next_billing_date += 30 días
  └── ❌ Cobro fallido → 3 días de gracia
        → user_notification + email: "Actualizá tu método antes del DD/MM."
        → Sin resolución en 3 días → status: suspended
        → user_event: payment_failed_suspended

Admin puede suspender manualmente en cualquier momento:
  → subscription: status: suspended
  → user_event: suspended { reason }
  → user_notification + email
```

##### 6. CANCELACIÓN
```
Usuario cancela desde el portal:
  ├── Acceso hasta fin del período pago (sin reembolso parcial)
  ├── subscription: cancel_at: fin_período
  └── Al vencer → registration_status: cancelled

Retención de datos: 90 días
  └── CUIT liberado a los 90 días (campo nullificado en users)
      user_events se preserva permanentemente

Retorno después del CUIT liberado:
  └── Nuevo registro con mismo CUIT — admin ve historial en user_events
```

##### Estados registration_status

| Estado | Quién lo asigna | Descripción |
|---|---|---|
| `pending_email` | sistema | Registrado, email no verificado |
| `pending_activation` | sistema / admin rechaza suave | Email verificado, en trial |
| `active` | admin | Aprobado — puede configurar pago |
| `rejected` | admin | Bloqueado, sin acceso |
| `cancelled` | usuario | Baja voluntaria |

---

#### Items pendientes de implementar (Fase 5)

- ⬜ Portal de pago en Electron: selector de plan + formulario MercadoPago/Stripe
- ⬜ Integración MercadoPago / Stripe (primer cobro + webhooks de renovación)
- ⬜ Banner post-activación en Electron: "Configurá tu método de pago"
- ⬜ Ciclo mensual automático (cron job en backend)
- ⬜ Gracia 3 días en pago fallido + suspensión automática
- ⬜ Flujo de cancelación desde portal de usuario
- ⬜ Retención CUIT 90 días + job de limpieza
- ⬜ Facturación AFIP
- ⬜ Campos DB a agregar:
  ```sql
  ALTER TABLE subscriptions ADD COLUMN payment_provider VARCHAR(20);
  ALTER TABLE subscriptions ADD COLUMN external_subscription_id VARCHAR(100);
  ALTER TABLE subscriptions ADD COLUMN next_billing_date TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN cancel_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE subscriptions ADD COLUMN payment_grace_until TIMESTAMP WITH TIME ZONE;
  ALTER TABLE users ADD COLUMN cuit_deleted_at TIMESTAMP WITH TIME ZONE;
  ```

---

### FASE 6 — ENTORNO DE PRUEBAS Y RELEASE SEGURO (pendiente)
**Objetivo:** mecanismo controlado para desarrollar, probar y desplegar sin arriesgar producción.

#### 6.1 Entorno staging
- Proceso PM2 separado en mismo VPS (puerto `3444`), DB `procurador_db_staging`
- Subdominio `staging.api.procuradortool.com` (Nginx proxy)
- App Electron en modo staging apunta a staging (variable de entorno al compilar)

#### 6.2 Smoke tests automatizados
- `POST /auth/login` · `GET /client/scripts/available` · `GET /client/scripts/download/:name` · `POST /license/execution/start`
- Ejecutar antes de cada deploy: `node test/smoke.js`

#### 6.3 Proceso de release seguro
```
1. Desarrollar en rama feature/fix
2. Probar en staging (build local apuntando a staging)
3. Smoke tests ✅
4. Merge a main + bump version
5. npm run release → GitHub Releases
6. Verificar auto-update en instalación de prueba antes de comunicar a usuarios
```

#### 6.4 Rollback
- GitHub Releases conserva versiones anteriores → usuarios pueden bajar manualmente
- Backend: `git checkout <hash-anterior> && pm2 restart procurador-api`
- Los scripts en BD tienen `version` — si hay rollback de código, reencriptar con la versión anterior

---

## Decisiones de arquitectura registradas

| Decisión | Motivo |
|---|---|
| Chrome del usuario (no Chromium empaquetado) | PJN recomienda Chrome; gestor de contraseñas de Chrome maneja las credenciales |
| Scripts distribuidos cifrados (AES-256 + RSA) | Proteger propiedad intelectual de la automatización |
| Machine ID binding | Prevenir sharing de cuentas |
| Extensión en Chrome Web Store (no CRX propio) | Aprobada por Google, distribución oficial, sin warning de instalación insegura |
| Extensión sin permiso `tabs` | Evitaba warning "Leer historial de navegación" |
| Extensión sin `content_scripts *://*/*` | Evitaba warning "Lee datos en todos los sitios" |
| Renderer.js monolítico → refactorizar incremental | No introducir bundler complejo; mantener vanilla JS con módulos ES6 |
| Landing servida por Nginx estático | Sin carga al servidor Node.js |
| SSL en api: certbot / SSL en landing: Cloudflare | Separación de responsabilidades, Cloudflare como CDN y WAF |
| URL como arg en Puppeteer launch | Solo `abrirNavegadorPJN.js` usa URL como arg (sitios web externos). `agregarPasswordSCW.js` usa directamente `page.goto('chrome://')` porque Chrome ignora las `chrome://` URLs pasadas como arg de launch (termina en Google/nueva pestaña) |
| `closeChromeProfile()` elimina lock files | `taskkill /F` deja SingletonLock/Cookie/Socket huérfanos; eliminarlos evita que Chrome entre en crash-recovery al próximo arranque |
| `ignoreDefaultArgs: ['--enable-automation']` | Sin este flag Chrome muestra barra "controlado por software automatizado"; sin --no-sandbox ni --ignore-certificate-errors para evitar banners de seguridad |

---

## Infraestructura

```
Usuario final (Windows)
  ├── Electron App → HTTPS → api.procuradortool.com → Express 3443
  └── Chrome + Extensión → HTTPS → portales PJN (directo)
                         → HTTPS → api.procuradortool.com

Servidor DigitalOcean (142.93.64.94 — Ubuntu)
  ├── Nginx: api.procuradortool.com → Express 3443 (SSL certbot, vence 2026-06-29)
  ├── Nginx: procuradortool.com → landing estática (SSL Cloudflare)
  ├── PM2: procurador-api (proceso Node.js)
  └── PostgreSQL 14: procurador_db (usuario: procurador_user)
```

---

## Git y GitHub

### Repositorio remoto
- **URL:** https://github.com/jberger19186/procurador-tool
- **Visibilidad:** privado
- **Rama principal:** `main`
- **Tracking configurado:** `main` ↔ `origin/main`
- **Credenciales:** guardadas en Windows Credential Manager (no hay que reingresar token)

### Workflow diario

```bash
# Ver qué cambió
git status

# Ver el detalle de los cambios (opcional)
git diff

# Guardar cambios en el historial local
git add .
git commit -m "descripción del cambio"

# Subir a GitHub (respaldo en la nube)
git push

# Ver historial
git log --oneline
```

### Trabajar en una rama separada (recomendado para cambios grandes)

```bash
# Crear y cambiar a rama nueva (ej: rediseño UI)
git checkout -b redesign-ui

# ... hacer cambios, commits ...

# Subir la rama a GitHub
git push -u origin redesign-ui

# Cuando esté listo, volver a main y fusionar
git checkout main
git merge redesign-ui
git push
```

### Token de GitHub
- El token está guardado de forma cifrada en el Windows Credential Manager
- Si hay que reconfigurarlo, ir a: https://github.com/settings/tokens
- Permisos mínimos necesarios: `repo` + `workflow`
- El mismo token sirve para `git push` y para `npm run release` de la app Electron

---

## Smoke Tests

Un script unificado que verifica que los portales del PJN y los flujos de la extensión siguen respondiendo con los selectores DOM correctos. **48 checks · ~70 segundos · usa Chrome con el perfil ProcuradorSCW.**

### Cómo pedirle a Claude que ejecute los tests

> "ejecutá los smoke tests" o "corré el diagnóstico completo"

Claude necesita un token JWT de admin para subir los resultados al dashboard. El token se genera en el servidor con la clave privada del `.env` y dura 24h. Claude puede generarlo automáticamente via SSH.

### Ejecutar manualmente desde `electron-app/`

```powershell
# ── Opción A: con token JWT pre-generado (recomendada para Claude / CI) ──
$env:ADMIN_TOKEN = "<token>"
$env:API_URL = "https://api.procuradortool.com"
node scripts/smoke-test-pjn.js

# ── Opción B: con email + contraseña ──
$env:ADMIN_EMAIL = "admin@procurador.com"
$env:ADMIN_PASSWORD = "<password>"
node scripts/smoke-test-pjn.js

# ── Sin subir al dashboard (solo local) ──
node scripts/smoke-test-pjn.js
```

### Generar token JWT para Claude (cuando no hay contraseña a mano)

```bash
# En el servidor (la clave JWT_SECRET está en /var/www/procurador/backend-server/.env)
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
  "cd /var/www/procurador/backend-server && node -e \"const jwt=require('jsonwebtoken'); console.log(jwt.sign({id:6,role:'admin'},process.env.JWT_SECRET,{expiresIn:'24h'}));\""
# id=6 → admin@procurador.com (usuario admin en DB)
```

### Backend API — desde el dashboard
El check de la API se ejecuta **desde el servidor** (no requiere Chrome):
- Dashboard → sección 🧪 Diagnóstico → **Backend API** → botón **▶ Ejecutar**
- O por cURL: `POST https://api.procuradortool.com/admin/smoke-tests/run-api` (requiere Bearer token admin)

### Resultados y logs
| Tipo | Dónde |
|------|-------|
| Tiempo real | Consola del terminal |
| Dashboard | Portal admin → 🧪 Diagnóstico (3 tarjetas: Backend API · Portal PJN · Extensión Chrome) |
| JSON persistido | `backend-server/data/smoke-test-results.json` en el servidor |
| Log local | `electron-app/logs/smoke-pjn-YYYYMMDD-HHMMSS.log` |

### Grupos de checks (48 total)
| Grupos | Solapa dashboard | ¿Qué verifica? |
|--------|-----------------|----------------|
| **D** — SCW consulta + 4 secciones (D1–D10) | → "Portal PJN" | Login SSO · LETRADO/PARTE/FAVORITOS · formulario búsqueda |
| **E** — Escritos 1 + informe completo (E1–E14) | → "Portal PJN" | Expediente FCR 18745/2017 · actuaciones · pestañas · click "Presentar escrito" → nueva pestaña |
| **F** — Escritos 2 `escritos.pjn.gov.ar/nuevo` (F1–F8) | → "Extensión Chrome" | Formulario MUI · selección FCR · relleno número/año |
| **G** — Notificaciones `notif.pjn.gov.ar/nueva` (G1–G8) | → "Extensión Chrome" | Ídem Escritos 2 |
| **H** — DEOX `deox.pjn.gov.ar/nuevo` (H1–H8) | → "Extensión Chrome" | `input[name="camara"]` · selección FCR · relleno número/año |

---

## 📘 Guía simple de Git y GitHub (explicado sin tecnicismos)

### ¿Qué es Git?
Pensá en Git como un "**Guardar con historial**" para todo el proyecto. Cada vez que hacés cambios importantes, sacás una **"foto"** del estado del proyecto. Si algo se rompe, volvés a cualquier foto anterior. Las "fotos" se llaman **commits**.

### ¿Qué es GitHub?
GitHub es el **lugar en la nube** donde se guardan esas fotos. Es como Google Drive pero para código. El repo privado asegura que nadie más que vos lo vea.

### ¿Qué es una rama (branch)?
Una rama es una **"realidad paralela"** del proyecto. Imaginá que estás trabajando en un libro y querés probar un final alternativo sin borrar el actual: hacés una copia ("rama"), experimentás ahí, y si te gusta lo fusionás con el libro original.

En nuestro caso: la rama principal (`main`) siempre tiene el código que funciona. Si querés probar un rediseño UI sin romper la app actual, creás una rama `redesign-ui`, trabajás ahí, y cuando esté listo la fusionás a `main`.

---

### Diccionario rápido de comandos

| Lo que querés hacer | Comando | Qué pasa |
|---|---|---|
| Ver si hay cambios sin guardar | `git status` | Lista archivos modificados |
| Ver detalle de los cambios | `git diff` | Muestra línea por línea qué cambió |
| Sacar una "foto" del estado actual | `git add .` + `git commit -m "texto"` | Guarda todos los cambios localmente |
| Subir las fotos a GitHub | `git push` | Respaldo en la nube |
| Bajar cambios desde GitHub | `git pull` | Trae lo que esté más nuevo en GitHub |
| Ver historial de fotos | `git log --oneline` | Lista todos los commits |
| Crear una realidad paralela | `git checkout -b nombre-rama` | Nueva rama, te movés a ella |
| Volver a la rama principal | `git checkout main` | Volvés al código estable |
| Fusionar una rama en main | `git merge nombre-rama` | Trae los cambios a main |
| Ver qué rama estoy usando | `git branch --show-current` | Muestra el nombre |
| Listar todas las ramas | `git branch -a` | Locales + remotas |

---

### Escenarios comunes explicados

#### 🟢 Escenario 1: Hice un cambio chico, quiero guardarlo
```bash
git status                           # ver qué cambió
git add .                            # marcar todos los cambios para guardar
git commit -m "corregir texto login" # sacar la foto con un nombre
git push                             # subir a GitHub
```

#### 🟢 Escenario 2: Voy a arrancar un cambio grande (ej: rediseño UI)
```bash
git checkout -b redesign-ui          # crear rama nueva
# ... hago cambios y pruebas ...
git add .
git commit -m "aplicar nueva paleta"
git push -u origin redesign-ui       # subir la rama a GitHub (primera vez)

# cuando todo funciona bien y quiero fusionar:
git checkout main                    # volver a main
git merge redesign-ui                # traer los cambios
git push                             # subir main actualizado
```

#### 🟡 Escenario 3: La cagué, quiero deshacer el último cambio SIN guardar
```bash
git checkout -- archivo.js           # descarta cambios en un archivo
git checkout -- .                    # descarta TODOS los cambios sin commitear
```

#### 🟡 Escenario 4: Ya guardé una foto mala, quiero deshacerla
```bash
git log --oneline                    # ver las fotos, copiar el hash de la buena
git reset --hard <hash-de-la-buena>  # volver a esa foto (CUIDADO: pierde todo lo posterior)
```

#### 🟢 Escenario 5: Quiero ver cómo estaba el proyecto hace 3 commits
```bash
git log --oneline                    # ver la lista
git checkout <hash>                  # moverse a esa foto (modo "solo lectura")
git checkout main                    # volver al presente
```

---

### Reglas de oro para no arruinar nada

1. **Antes de empezar a trabajar**, hacé `git pull` → así traés lo último de GitHub
2. **Antes de cambiar de rama**, hacé `git status` → si hay cambios sin guardar, commiteá o descartá primero
3. **Nunca hagas `git push --force`** — puede borrar el trabajo de GitHub. Si alguna vez te digo de usarlo, te aviso primero
4. **Commiteá seguido**, no esperes a terminar toda una feature. Mejor 10 commits chicos que 1 gigante
5. **Los mensajes de commit** deben describir **qué** cambió, no **cómo**. Ej: `corregir login falla en Safari` ✅ vs `cambiar línea 42 de login.js` ❌

---

### Cómo escribir un buen mensaje de commit

Formato recomendado (convencional):
```
tipo: descripción corta en minúscula

- detalle adicional si hace falta
- otro detalle
```

**Tipos comunes:**
| Tipo | Cuándo usarlo |
|---|---|
| `feat:` | Nueva funcionalidad |
| `fix:` | Corrección de bug |
| `docs:` | Cambios en documentación |
| `style:` | Cambios de estilo/formato (no lógica) |
| `refactor:` | Reorganización de código sin cambiar comportamiento |
| `chore:` | Tareas de mantenimiento, configs |
| `test:` | Agregar o corregir tests |

**Ejemplos reales de este proyecto:**
- `feat: agregar alerta de actualizacion de extension en Electron`
- `fix: corregir FLOW_ALIASES en notif de extension`
- `docs: actualizar seccion Git del CLAUDE.md`
- `refactor: dividir renderer.js en modulos separados`

---

### ¿Dónde veo mis commits en la web?

En cualquier momento podés abrir: https://github.com/jberger19186/procurador-tool/commits/main

Ahí ves el historial completo con fecha, autor, mensaje y qué archivos cambiaron. Es como el "undo/redo" de Word pero muchísimo más potente.
