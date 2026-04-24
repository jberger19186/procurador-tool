# CLAUDE.md — Procurador SCW

> Guía maestra del proyecto para sesiones de trabajo con Claude.
> Última actualización: 2026-04-24 (v2.4.14)

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

```
ProcuradorTool/
├── CLAUDE.md                  ← este archivo
├── electron-app/              ← cliente desktop (Electron 28)
├── backend-server/            ← API central (Express 5 + PostgreSQL)
├── extension-app/             ← extensión Chrome (MV3) — distribución Chrome Web Store
├── database/
│   └── schema.sql             ← schema completo de producción (pg_dump --schema-only)
└── docs/                      ← documentación del proyecto
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

### Deploy landing page
```bash
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" \
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/public/landing/index.html" \
  root@142.93.64.94:/var/www/procurador/backend-server/public/landing/index.html
```

### Backup de base de datos
```bash
# Schema solamente
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres pg_dump --schema-only procurador_db" > database/schema.sql

# Backup completo
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres pg_dump procurador_db" > database/backup_$(date +%Y%m%d).sql
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

### IPC Electron (Main ↔ Renderer)
Toda comunicación entre el proceso principal y la UI pasa por `preload.js` (context isolation).
El renderer **nunca** accede directamente a módulos de Node.js.

---

## Endpoints críticos del backend

```
POST   /auth/login                     — Autenticación usuario
POST   /auth/register                  — Registro (redirige a /register/)
GET    /auth/plan-availability         — Planes disponibles (público)
POST   /client/verify-session          — Heartbeat de sesión
GET    /client/scripts/available       — Scripts descargables
GET    /client/scripts/check/:name     — Check versión/hash
GET    /client/scripts/download/:name  — Descarga script cifrado
POST   /client/scripts/log-execution   — Registrar ejecución
POST   /license/execution/start        — Adquirir lock
POST   /license/execution/heartbeat    — Refrescar lock
POST   /license/execution/end          — Liberar lock
POST   /auth/extension-login           — Login desde extensión
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

### Sistema de cuotas por plan
```
EXTENSION_PROMO  → USD 1/mes  → 5 flujos extensión, sin cuotas app
COMBO_PROMO      → USD 9.99/mes → extensión + app: 50 proc · 10 inf · 3 partes · 10 nov · 20 batch
BASIC            → app: 50 proc · 10 inf · 3 partes activas
PRO              → app: 200 proc · 50 inf · 10 partes activas
ENTERPRISE       → app: ilimitado · 50 partes activas
```
Nuevos usuarios reciben 20 ejecuciones de prueba por 365 días (estado "suspended" hasta activación manual por admin).

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

### Versión actual en store: 1.3.2
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

## Plan de comercialización — 5 fases

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

#### 1.1b Refactor técnico `renderer.js` — PENDIENTE (baja urgencia)
- `renderer.js` es monolítico (131 KB) — dividir en módulos ES6 por sección
- Secciones: login · dashboard · modales de ejecución · logs · tickets · configuración
- **Regla:** solo reorganización de código, sin cambiar funcionalidad ni estilos
- No es urgente mientras no haya problemas de mantenimiento

#### 1.2 Migración extensión → Chrome Web Store ✅ COMPLETADO
- Extensión publicada y aprobada en Chrome Web Store (v1.3.2)
- Onboarding actualizado con enlace directo a la store
- Aviso sobre warning de Chrome al instalar incluido en onboarding
- Distribución CRX vieja del backend pendiente de limpiar (baja urgencia)

#### 1.3b Rediseño visual de los visores HTML — PENDIENTE ← PRÓXIMA PRIORIDAD
Los visores son ventanas HTML que muestran resultados de expedientes/informes.
Necesitan aplicar el sistema de diseño de la app (amber, Inter, Crimson Pro, fondo `#f7f7f5`).

#### 1.3 Code Signing — DIFERIDO (implementar en Fase 2-5)
Evaluar Microsoft Azure Trusted Signing para firmar el instalador `.exe` de Electron.

---

### FASE 3 — COMERCIAL (en curso, paralela a Fase 1)
**Objetivo:** presencia pública y capacidad de vender.

#### 3.1 Página Web / Landing Page
- Archivo fuente: `backend-server/public/landing/index.html`
- URL: https://procuradortool.com
- **Aclarar en toda la comunicación:** la app está dirigida solo a usuarios con credenciales del PJN
- Sistema de diseño ya aplicado (amber, Inter, Crimson Pro)
- Estructura: Navbar · Hero · Problema · App Showcase · Funciones · Extensión · Cómo funciona · Seguridad/Privacidad · Planes · CTA · Footer

#### 3.2 Términos Legales
- Términos y Condiciones de Uso
- Política de Privacidad
- Aviso de que las credenciales del PJN nunca pasan por los servidores

#### 3.3 Estrategia de Venta y Planes
- Promos de lanzamiento: EXTENSION_PROMO (USD 1/mes) y COMBO_PROMO (USD 9.99/mes)
- Planes futuros: BASIC · PRO · ENTERPRISE (precios por definir)
- Registro en: `https://api.procuradortool.com/register/`

#### 3.4 Registro y Recolección de Datos
- Registro público con verificación de email
- Flujo de activación manual por admin
- Alertas de promo en Electron al registrarse
- Ver plan pendiente: `C:\Users\JONATHAN\.claude\plans\cozy-cuddling-badger.md`

#### 3.5 Identidad de Marca
- Nombre: **Procurador SCW** / **ProcuradorTool**
- Dominio: procuradortool.com
- Publisher Chrome Store: Jonathan Berger

---

### FASE 2 — BACKEND (pendiente)
- Backups programados de PostgreSQL y procedimiento de restauración
- Canary tests / smoke tests para endpoints críticos
- Hardening de secretos: mover claves RSA y de cifrado a variables de entorno
- Code Signing del instalador Electron (Azure Trusted Signing)
- **Documentación técnica completa** del backend (endpoints, esquema DB, flujos)
- **Análisis de seguridad profundo** (app Electron + backend)

---

### FASE 4 — SOPORTE (pendiente)
- Comunicación masiva con usuarios
- Chat de soporte con IA / sistema de tickets con IA
- Documentación de ayuda para usuarios finales

---

### FASE 5 — COBRANZA (pendiente)
- Integración MercadoPago / Stripe (suscripciones recurrentes)
- Facturación AFIP
- Soporte post-compra
- Agregar a `subscriptions`: `external_subscription_id`, `payment_provider`, `next_billing_date`

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
