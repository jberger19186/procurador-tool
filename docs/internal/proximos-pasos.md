# Próximos pasos — Handoff para sesiones nuevas

> **Documento de continuidad.** Después de `/clear`, leer este archivo + CLAUDE.md da el contexto suficiente para retomar.
> Última actualización: 2026-05-27 (Smoke tests 48/48 completo + pendientes unificados con CLAUDE.md)

---

## 📍 ESTADO ACTUAL DEL PROYECTO

- **Fase 1 (Aplicación):** En curso — UI rediseñada, refactor pendiente
- **Fase 2 (Backend):** Pendiente — backups programados, hardening secretos
- **Fase 3 (Comercial):** 🔄 En curso — landing actualizada con precios ARS + branding suite/producto
- **Fase 4 (Soporte):** ✅ **CERRADA** (tag `fase4-completa`, commit `bc0ce2e`)
- **Fase 5 (Cobranza):** **PRÓXIMA** — diseño completo abajo
- **Fase 6 (Staging/Release seguro):** Pendiente

### Versión Electron actual: **v2.7.13** (último release estable)

### Tags Git relevantes (rollback points)
```
bloque1-icono-v2.7.13        ← último estable (FAQs actualizadas + documentación completa)
bloque1-icono-v2.7.12        ← flujo registro + activación completo
bloque1-icono-v2.7.10        ← ícono oficial resuelto
bloque1-branding-ars-toggle  ← branding + pricing + toggle registro
fase4-completa               ← cierre Fase 4 soporte
fase4-item3                  ← cierre Item 3 (visibilidad + AI suggest + ajustes)
fase4-item2                  ← cierre Item 2 (prioridad IA)
fase4-item1                  ← cierre Item 1 (email respuesta)
pre-fase4                    ← snapshot inicial Fase 4
```

### Backups disponibles
```
C:\Users\JONATHAN\Desktop\ProcuradorBackups\
├── procurador_db_FASE4_COMPLETA_*.sql       ← USAR ESTE para restore reciente
├── procurador_db_post_item3_migration_*.sql
├── procurador_db_post_migration_*.sql
├── procurador_db_20260522_0946.sql           (pre-Fase 4)
└── server_files_20260522_0946/
    ├── .env                                   (secrets backend)
    └── keys/ (private.pem + public.pem)
```
Live snapshot DigitalOcean: `pre-fase4-20260522` (en panel DO)

---

## 📋 PENDIENTES POR BLOQUE (extraídos de CLAUDE.md)

### 🥇 BLOQUE 1 — Identidad de Marca & Landing ✅ CERRADO (tag `bloque1-completo`)
- ✅ Jerarquía marca: "Procurador TOOL" (suite) + sublabel "Procurador SCW" en landing
- ✅ Landing portada a archivo nuevo con copy actualizado · versión 2.7.10 en 4 lugares
- ✅ Footer con links Términos y Privacidad
- ✅ Precios promos en ARS: $1.500 / $15.000 · planes permanentes indexados a UMA CSJN
- ✅ DB migrada a `price_ars` · backend refactorizado (auth/users/usuarios/register/dashboard)
- ✅ Toggle registro público reconectado (endpoint + admin endpoints + dashboard UI)
- ✅ Ícono oficial ⚖️ — favicon landing, instalador y app Electron (afterPack + rcedit, v2.7.10)
- ✅ Emails transaccionales: branding unificado (`emailHeader/Footer/Layout` en `mailer.js`)
- ✅ Extensión Chrome Store v1.3.3 — nombre "Procurador SCW – Automatización PJN", ícono balanza, descripción con mención a suite · **en revisión por Google**
- ⏸️ **Paso 3 diferido:** Instalador `.exe` — referencia suite en `installer.nsh` (menor prioridad)

### 🔔 PENDIENTES PRE-LANZAMIENTO (surgidos en Bloque 1)
- ✅ **Extensión Chrome Web Store v1.3.3** — aprobada por Google, visibilidad pública activa. Nombre: "Procurador SCW – Automatización PJN", ícono balanza
- ✅ **Links de descarga en el panel de usuario** (portal web `usuarios/`):
  - ✅ Link directo a Chrome Web Store: `https://chromewebstore.google.com/detail/aodnfemklhciagaglpggnclmbdhnhbme`
  - ✅ Link al instalador: `GET /client/download/electron` → redirect dinámico vía GitHub API (no requiere actualizar en cada release)
- ✅ **SSL `api.procuradortool.com`** — `certbot.timer` activo, renueva automáticamente. No requiere acción.
- ✅ **Flujo completo de registro/activación** (sesión 2026-05-26):
  - `POST /auth/portal-login` — login portal para todos los estados no terminales
  - `POST /auth/resend-verification` — reenvío email de verificación
  - `GET /client/download/electron` — descarga dinámica instalador
  - Email verificación: ícono real + redirect correcto al portal
  - Electron: banner `pending_email` + bloqueo botón principal
  - Mi Cuenta (Electron) + Mi Plan (portal): card trial con contador X/20 + barra progreso
  - FAQs actualizadas: trial, email verificación, período de prueba

### 🥈 BLOQUE 2 — Planes & Precios ⏸️ DIFERIDO (precios fijados, activación pendiente)
- ✅ Precios fijados en DB y landing, indexados a UMA CSJN:
  - BASIC → $31.875 ARS/mes (1/3 UMA)
  - PRO → $63.751 ARS/mes (2/3 UMA)
  - ENTERPRISE → $95.626 ARS/mes (1 UMA)
- ✅ Promos fijadas: EXTENSION_PROMO $1.500 · COMBO_PROMO $15.000 ARS
- ⏸️ **Activación diferida:** `active=true` en DB para BASIC/PRO/ENTERPRISE → ejecutar cuando se habilite la venta pública
- ⏸️ Habilitar planes permanentes en flujo de registro → ídem

> **Cuándo activar:** antes del lanzamiento público, ejecutar en producción:
> ```sql
> UPDATE plans SET active = true WHERE name IN ('BASIC', 'PRO', 'ENTERPRISE');
> ```

> **Nota UMA:** valor de referencia $95.626 ARS (CSJN vigente a 2026-05-23). Al actualizarse, editar 4 lugares en `landing/index.html` (3 precios + nota UMA) y 2 filas en DB.

### 🥉 BLOQUE 3 — Code Signing ← TIEMPOS EXTERNOS
- ⬜ Cuenta Azure + Azure Trusted Signing (~USD 9/mes)
- ⬜ Firmar instalador `.exe` (elimina warning SmartScreen)
- Docs: https://learn.microsoft.com/en-us/azure/trusted-signing/

### 4️⃣ BLOQUE 4 — Pago & Facturación ← **PRÓXIMA FASE A EJECUTAR**
Ver sección detallada abajo "PLAN FASE 5 — COBRANZA".

### 5️⃣ BLOQUE 5 — Soporte & FAQs & Chat & Tickets ✅ COMPLETADO (Fase 4)
- ✅ FAQs expandidas (34 preguntas, 7 categorías)
- ✅ Endpoint AI chat (Haiku) en Electron y portal web
- ✅ Manual de usuario publicado
- ✅ ANTHROPIC_API_KEY activa
- ✅ Email respuesta admin→usuario
- ✅ Prioridad IA con toggle
- ✅ Visibilidad de comentarios (external/internal)
- ✅ Proyectar con IA + ajustes manuales en tickets
- 📌 KB y borradores masivos → `docs/internal/mejoras-futuras.md`

### 6️⃣ BLOQUE 6 — Seguridad & Backups & Tests ← ANTES DEL LANZAMIENTO
- ✅ Backups programados PostgreSQL — cron 03:00 AM, 7 días retención, alerta email (2026-05-26)
- ✅ Hardening secretos RSA — `RSA_PRIVATE_KEY` + `RSA_PUBLIC_KEY` en `.env` (2026-05-26)
- ✅ Suite QA (159/165 PASS)
- ✅ Tests automatizados (pytest + Playwright)
- ✅ **Smoke tests manual** — `smoke-test-pjn.js` 48/48 ✅ Portal PJN + Extensión Chrome (2026-05-27) · dashboard admin "🧪 Diagnóstico" (3 tarjetas)
- ⬜ Smoke tests CI pre-deploy (GitHub Actions) ← **POST-LANZAMIENTO**
- ⬜ **Diferido:** Análisis de seguridad profundo
- ⬜ **Diferido:** Documentación técnica completa
- ⬜ **Diferido futuro:** Replicar backups a DO Spaces (~USD 5/mes)

### 7️⃣ BLOQUE 7 — Entorno de Pruebas
- ⬜ Servidor staging (PM2 separado, `procurador_db_staging`, `staging.api.procuradortool.com`)
- ⬜ Smoke tests automatizados pre-deploy
- ⬜ Proceso de release documentado
- ⬜ Rollback definido y probado

---

## 💳 PLAN FASE 5 — COBRANZA (próximo a ejecutar)

**Stack decidido:**
- **Mercado Pago** como pasarela (cobertura local AR: tarjetas, Rapipago, Pago Fácil)
- **Facturante** para facturación AFIP/ARCA electrónica
- **PagoKit** (Hainrixz/agente-pagokit) como aid de scaffolding seguro

### Por qué este stack
- MP es el más usado en Argentina, soporta suscripciones recurrentes con reintentos automáticos
- Facturante tiene API para emisión + integración nativa con MP
- PagoKit es un plugin de Claude Code que genera código seguro de pagos (firma webhooks, idempotencia UUID, sin claves hardcodeadas) — nos ahorra 2-3 días de scaffolding

### Pre-Fase 5: Backup y preparativos externos

```
P-01  Snapshot DigitalOcean completo (manual desde panel DO)
P-02  pg_dump → database/backup_fase5_inicio.sql + copia a escritorio
P-03  git tag pre-fase5 + push
P-04  Crear cuenta vendedor Mercado Pago Argentina (modo producción)
      - DNI/CUIT verificado
      - Datos bancarios cargados
P-05  Crear aplicación en MP Developers Dashboard
      - Obtener ACCESS_TOKEN_SANDBOX y ACCESS_TOKEN_PROD
      - Configurar webhook URL: https://api.procuradortool.com/webhooks/mercadopago
P-06  Contratar Facturante (Plan inicial: Pack 50 ~USD 6/mes)
      - Activar modo homologación (ARCA test environment)
      - Obtener API_KEY de homologación y producción
      - Configurar punto de venta
P-07  Cargar variables en backend-server/.env:
      MP_ACCESS_TOKEN=APP_USR-... (prod)
      MP_ACCESS_TOKEN_TEST=TEST-...
      MP_WEBHOOK_SECRET=...
      FACTURANTE_API_KEY=...
      FACTURANTE_API_KEY_TEST=...
      FACTURANTE_PUNTO_VENTA=...
      PAYMENT_MODE=sandbox  # sandbox | production
```

### Bloque preliminar — Uso de PagoKit

```
0.1  Clonar PagoKit en máquina local:
     git clone https://github.com/Hainrixz/agente-pagokit ~/agente-pagokit
0.2  Crear worktree de Procurador:
     git worktree add ../worktrees/fase5-pagos
0.3  Ejecutar /pagokit:start desde Claude Code
     - País: Argentina
     - Compradores: profesionales del derecho
     - Pagos: recurrentes mensuales (suscripción SaaS)
     - Métodos locales: tarjetas + Rapipago + Pago Fácil
0.4  PagoKit recomendará Mercado Pago Subscriptions y generará código
0.5  Adaptar al stack: Express puro (no Next.js) + PostgreSQL directo (no Prisma)
0.6  Guardar el código generado SIN deployar en branch: pagokit-output
```

### Ítems de implementación

#### Ítem 5.1 — Schema DB (2-3h)
**Punto de resguardo previo:** `git tag pre-fase5-item1`

```sql
-- Ampliación subscriptions
ALTER TABLE subscriptions
  ADD COLUMN external_subscription_id VARCHAR(100),
  ADD COLUMN payment_provider VARCHAR(20),
  ADD COLUMN payment_method_id VARCHAR(100),
  ADD COLUMN next_billing_date TIMESTAMP,
  ADD COLUMN last_payment_at TIMESTAMP,
  ADD COLUMN payment_grace_ends_at TIMESTAMP,
  ADD COLUMN auto_renewal BOOLEAN DEFAULT true,
  ADD COLUMN cancel_at TIMESTAMP;

-- Pagos individuales
CREATE TABLE payments (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  subscription_id INTEGER REFERENCES subscriptions(id),
  external_payment_id VARCHAR(100) UNIQUE,
  amount          DECIMAL(10,2),
  currency        VARCHAR(3),
  status          VARCHAR(20),
  payment_method  VARCHAR(50),
  invoice_id      INTEGER,
  paid_at         TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  raw_response    JSONB
);

-- Facturas Facturante
CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  payment_id      INTEGER REFERENCES payments(id),
  external_invoice_id VARCHAR(100),
  invoice_number  VARCHAR(50),
  invoice_type    VARCHAR(5),
  cae             VARCHAR(20),
  pdf_url         TEXT,
  total           DECIMAL(10,2),
  status          VARCHAR(20),
  issued_at       TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  raw_response    JSONB
);

-- Idempotencia de webhooks
CREATE TABLE webhook_events (
  id              SERIAL PRIMARY KEY,
  provider        VARCHAR(20),
  event_id        VARCHAR(200) UNIQUE,
  event_type      VARCHAR(50),
  payload         JSONB,
  processed       BOOLEAN DEFAULT false,
  error_message   TEXT,
  received_at     TIMESTAMP DEFAULT NOW(),
  processed_at    TIMESTAMP
);

-- Retención CUIT (90 días)
ALTER TABLE users ADD COLUMN cuit_deleted_at TIMESTAMP;

CREATE INDEX idx_payments_user ON payments(user_id, created_at);
CREATE INDEX idx_invoices_user ON invoices(user_id, created_at);
CREATE INDEX idx_webhook_events_provider ON webhook_events(provider, processed);
```

#### Ítem 5.2 — Integración Mercado Pago sandbox (2-3 días)
**Punto de resguardo previo:** `git tag pre-fase5-item2`

**Backend:**
```
backend-server/utils/mercadopagoClient.js
backend-server/services/subscriptionService.js
backend-server/routes/webhooks.js (POST /webhooks/mercadopago)

Endpoints públicos:
POST /usuarios/api/checkout/initiate { plan_name }
POST /usuarios/api/checkout/confirm
POST /usuarios/api/checkout/cancel-subscription

Feature flag: PAYMENT_MODULE_ENABLED en .env (false hasta listo)
```

**Webhook handler eventos clave:**
- `payment.created` → insert payments
- `payment.updated` → update status
- `preapproval.updated` → update subscription
- `subscription.payment.*` → cobros recurrentes

**Tarjetas de prueba MP Argentina:**
```
VISA aprueba:    4509 9535 6623 3704  CVV 123  Exp 11/30
MASTER rechaza:  5031 7557 3453 0604  CVV 123  Exp 11/30
DNI prueba:      12345678
```

**Frontend portal web:**
- Sección Facturación rediseñada (método pago, próxima fecha, historial, cancelar)
- Modal "Configurá tu método de pago" → redirect a init_point
- Banner según status (pago vencido, método faltante)

#### Ítem 5.3 — Integración Facturante homologación (1-2 días)
**Punto de resguardo previo:** `git tag pre-fase5-item3`

**Backend:**
```
backend-server/utils/facturanteClient.js
backend-server/services/invoiceService.js

Trigger: en webhook MP payment.approved → service.emitInvoice()
Si falla → reintento async + alerta admin

Endpoints:
GET /usuarios/api/invoices → lista
GET /usuarios/api/invoices/:id/pdf → descarga
```

**Frontend:**
- Tabla de facturas en sección Facturación (fecha, número, tipo A/B/C, monto, CAE, PDF)
- Email automático con factura adjunta (opcional)

#### Ítem 5.4 — Migración a producción (1 semana monitoreo)
**Punto de resguardo previo:** `git tag pre-fase5-item4`

```
1. Validar en sandbox 100% del flujo durante 5-7 días
2. Cambiar PAYMENT_MODE=production
3. Activar feature flag solo para 1 admin
4. Cobrar mes real a cuenta propia (smoke test)
5. Activar para 5 usuarios beta con descuento total
6. Monitoreo 7 días
7. Activación general
```

#### Ítem 5.5 — UI completa y comunicación (1-2 días)
**Punto de resguardo previo:** `git tag pre-fase5-item5`

- Electron: banner "Configurar método de pago" + notificación in-app post-cobro
- Portal web: sección Facturación completa
- Emails transaccionales: "Suscripción activa", "Pago procesado - Factura adjunta", "Pago fallido", "Cancelación"
- Docs: actualizar manual + FAQs (categoría "Facturación") + términos legales

### Post-Fase 5: Cierre

```
C-01  pg_dump → database/backup_fase5_completa.sql + escritorio
C-02  git tag fase5-completa + GitHub release Electron
C-03  Snapshot DigitalOcean
C-04  CLAUDE.md: Fase 5 → ✅ CERRADA
C-05  docs/internal/fase5-cierre.md con métricas
C-06  Actualizar landing con info de cobranza
C-07  Anuncio in-app a usuarios existentes sobre cambio a cobro automático
```

### Tiempos estimados Fase 5

| Bloque | Esfuerzo |
|---|---|
| Preparativos + cuentas externas | 1 día (con esperas) |
| Schema DB | 2-3 h |
| MP sandbox | 2-3 días |
| Facturante homologación | 1-2 días |
| UI + emails + docs | 1-2 días |
| Validación producción | 1 semana monitoreo |
| **Total calendario** | **2-3 semanas** |

### Costos Fase 5

| Recurso | Costo aprox. |
|---|---|
| Cuenta MP vendedor | Gratis (comisión por venta) |
| Aplicación MP Developers | Gratis |
| Plan Facturante Pack 50 | ~USD 6/mes |
| Snapshots DigitalOcean | ~USD 0.05/GB/mes |
| Anthropic API (existente) | ~USD 1-3/mes |

---

## 🎯 ORDEN SUGERIDO (actualizado 2026-05-26)

```
1. ✅ BLOQUE 1 (branding completo)
2. ✅ PRE-LANZAMIENTO: links descarga + flujo registro/activación completo
3. ✅ BLOQUE 6 (backups automáticos + hardening RSA a env vars)
     ↓
4. ✅ PRE-LANZAMIENTO: smoke tests manual 48/48 (dashboard + script PJN + extensión Chrome) + extensión Chrome Store v1.3.3
     ↓
5. FASE 5 / BLOQUE 4 (cobranza + facturación) ← detalle abajo
     ↓
5. BLOQUE 7 (staging)
     ↓
6. BLOQUE 3 (code signing — paralelo, tiene tiempos externos)
     ↓
LANZAMIENTO PÚBLICO
  → extensión Chrome pública en store
  → activar BASIC/PRO/ENTERPRISE en DB (Bloque 2 ⏸️)
```

---

## 🔗 DOCS RELACIONADOS

- `CLAUDE.md` — guía maestra del proyecto
- `docs/manual-de-usuario.md` — manual de usuario final (público)
- `docs/internal/sistema-estados-flujos.md` — flujos técnicos del sistema (incl. flujos IA y email Fase 4)
- `docs/internal/mejoras-futuras.md` — KB + borradores masivos (diferidos)
- `docs/internal/rollback-fase4.md` — procedimientos restore Fase 4
- Plan QA: `C:\Users\JONATHAN\.claude\plans\foamy-giggling-badger.md`

---

## ⚙️ COMANDOS RÁPIDOS PARA RESUMIR LA SESIÓN

```bash
# Estado del repo
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" log --oneline -10
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" tag -l "fase*" --sort=-creatordate | head

# Health server
curl -sk https://api.procuradortool.com/health

# Backup actual antes de empezar
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres pg_dump procurador_db" \
  > "C:/Users/JONATHAN/Desktop/ProcuradorBackups/procurador_db_pre_session_$(date +%Y%m%d_%H%M).sql"

# Tag de resguardo nuevo
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" tag pre-fase5 -m "Pre-Fase 5: arranque Cobranza"
git -C "C:/Users/JONATHAN/source/repos/ProcuradorTool" push origin pre-fase5
```

---

## 📝 NOTA SOBRE METODOLOGÍA (mantener para Fase 5)

Política aplicada en Fase 4, mantener para Fase 5:

```
1. Pre-fase: tag pre-faseN + pg_dump + snapshot DO + doc rollback
2. Por cada Ítem:
   - tag pre-faseN-itemM antes de tocar código
   - Implementación en worktree si afecta archivos críticos
   - Feature flag para activación gradual
   - Smoke tests aislados con curl ANTES de UI testing
   - Commit + push + deploy
   - Tag faseN-itemM al cerrar
3. Por cada feature IA:
   - Rate limit obligatorio
   - System prompt con contexto del producto
   - Telemetría opcional pero recomendada
4. Cierre de fase:
   - pg_dump post-fase a escritorio
   - Tag faseN-completa
   - Documentación consolidada en docs/internal/
   - Actualización plan QA
```
