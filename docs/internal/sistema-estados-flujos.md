# Documentación interna — Estados, errores y flujos del sistema
**Procurador SCW** · Uso interno del equipo  
Última actualización: 2026-05-30 (agregada sección — flujos de cobranza Fase 5)

---

## 1. Estados del usuario (`registration_status`)

| Estado | Descripción | Puede iniciar sesión | Puede ejecutar |
|---|---|---|---|
| `pending_email` | Registrado, email sin verificar | No | No |
| `pending_activation` | Email verificado, pendiente de activación por admin | Sí | Sí (hasta agotar trial) |
| `active` | Cuenta activa | Sí | Sí (según plan) |
| `rejected` | Rechazado por admin o trial agotado | No | No |
| `suspended_admin` | Suspendido manualmente por admin | No | No |
| `suspended_plan_expired` | Plan vencido (cron diario) | No | No |
| `cancelled` | Suscripción cancelada y período vencido | No | No |

### Transiciones de estado

```
[Registro]
  pending_email
      │ verifica email
      ▼
  pending_activation ────────────────────────────────────────┐
      │ admin activa                   │ admin rechaza (block) │
      ▼                                ▼                       │
    active                          rejected                  │
      │                                                        │
      │ trial agotado (cron)                                   │
      │ (usage_count >= usage_limit y status="pending_activation")
      └──────────────────────────────────────────────────────▶ rejected
      │
      │ admin suspende
      ▼
  suspended_admin
      │ usuario envía reactivación
      │ admin aprueba
      ▼
    active
      │
      │ plan_expiry_date vence (cron)
      ▼
  suspended_plan_expired
      │ admin extiende fecha / reactiva
      ▼
    active
      │
      │ cancel_at vence (cron)
      ▼
  cancelled
```

---

## 2. Estados de suscripción (`subscriptions.status`)

| Status | Cuándo se asigna |
|---|---|
| `suspended` | Al crear la cuenta (trial, sin activar) |
| `active` | Al activar el usuario |
| `cancelled` | Al cancelar o al vencer cancel_at |
| `suspended_admin` | Al suspender manualmente |
| `expired` | Al vencer plan_expiry_date |

---

## 3. Planes disponibles

| Plan | Tipo | Precio aprox. | Límites app | Extensión |
|---|---|---|---|---|
| `EXTENSION_PROMO` | extension | USD 1/mes | Sin acceso | 5 flujos |
| `COMBO_PROMO` | combo | USD 9.99/mes | 50 proc · 10 inf · 3 partes | Incluida |
| `BASIC` | electron | TBD | 50 proc · 10 inf · 3 partes | No |
| `PRO` | electron | TBD | 200 proc · 50 inf · 10 partes | No |
| `ENTERPRISE` | electron | TBD | Ilimitado · 50 partes | No |

**Trial:** 20 ejecuciones, 365 días, status `pending_activation`. Al agotar → `rejected` vía cron.

---

## 4. Flujos del asistente IA

> **v2.7.3:** El chat y el soporte se redirigen al portal web. El chat widget interno en Electron queda preservado en código pero no accesible desde la UI.

### Flujo 1 — FAQ local (Electron)

```
Usuario abre modal Asistente IA (🤖 en sidebar)
        │
        ▼
Modal con 34 FAQs, filtro por pills (7 categorías) + búsqueda de texto
        │
        ├── Usuario encuentra respuesta ────────────▶ Listo
        │
        └── Presiona "💬 ¿Seguís con dudas? Abrir chat"
                │
                ▼
        openPortalSection('ia')
                │
                ▼
        Abre navegador en /usuarios/?goto=ia#sso=TOKEN
        (auto-login + navega a sección Asistente IA del portal web)
```

### Flujo 2 — Chat IA en portal web (conversacional)

```
Usuario en portal web → sección "Asistente IA"
        │
        ▼
Chat con historial de conversación (últimos 10 mensajes)
        │
        ▼
POST /usuarios/api/ai-chat  { messages: [...] }
        │
        ├── Rate limit: < 20/hora por usuario
        ├── ANTHROPIC_API_KEY: configurada ✅
        │
        ▼
api.anthropic.com/v1/messages
  model: claude-haiku-4-5
  max_tokens: 400
  system: WEB_SYSTEM_PROMPT (idéntico al de Electron)
        │
        ▼
Respuesta con contexto conversacional completo
```

### Flujo 3 — Chat IA fallback en Electron (interno, no accesible)

```
[Preservado en código para uso futuro]
getBotResponse(input) → null → getAIResponse() → POST /client/ai/chat → Claude Haiku
El chat widget (#chatWidget) existe en el DOM pero openChatWindow() no se llama desde la UI
```

### Flujo 4 — Escalada a ticket

```
Usuario presiona 🎫 en chat widget  ─OR─  "+ Nuevo ticket" en tab Soporte
        │
        ▼
openPortalSection('nuevo-ticket')
        │
        ▼
Abre navegador en /usuarios/?goto=nuevo-ticket#sso=TOKEN
        │
        ▼
Portal: auto-login → navigateTo('soporte') → openNewTicketModal() (setTimeout 300ms)
        │
        ▼
Usuario completa formulario → POST /tickets
        │
        ▼
Admin responde en /dashboard/ → notificación in-app al usuario
```

### Flujo 5 — Notificación email cuando admin responde un ticket

> Implementado en Fase 4 Ítem 1 (sesión 2026-05-22). Feature flag `EMAIL_TICKET_REPLY_ENABLED=true`.

```
Admin escribe respuesta en /dashboard/ → ticket #N
        │
        ▼
POST /admin/tickets/:id/comment { message }
        │
        ├── INSERT en ticket_comments (author_role='admin')
        ├── UPDATE support_tickets SET status='in_progress' (si estaba 'open')
        ├── Log: "💬 Admin X respondió ticket #N"
        │
        ▼
[ASYNC fire-and-forget — no bloquea respuesta HTTP]
sendTicketReplyEmail(email, nombre, ticketId, title, preview)
        │
        ├── Si EMAIL_TICKET_REPLY_ENABLED != 'true' → log [skip], return
        │
        ├── Construye HTML con:
        │     - Wrapper <!DOCTYPE><meta charset="utf-8"> (auto en sendEmail)
        │     - Preview de 200 chars (HTML-escaped, con ellipsis)
        │     - Botón → https://api.procuradortool.com/usuarios/?goto=soporte
        │
        ▼
nodemailer.sendMail (subject con textEncoding: 'base64')
        │
        ▼
SMTP → email entregado al usuario
        │
        ▼
Usuario hace click en "Ver respuesta completa"
        │
        ▼
Browser navega a /usuarios/?goto=soporte
        │
        ├── app.js DOMContentLoaded:
        │     - Lee ?goto=soporte → sessionStorage.pending_goto = 'soporte'
        │     - history.replaceState para limpiar URL
        │     - Si tiene token → initDashboard()
        │     - Si NO tiene token → muestra login-page
        │
        ▼
Usuario hace login normal (email + password)
        │
        ▼
doLogin success → initDashboard()
        │
        ├── loadAccount() → carga datos
        ├── refreshNotifBadge()
        ├── Lee sessionStorage.pending_goto = 'soporte'
        ├── sessionStorage.removeItem('pending_goto') (consume)
        │
        ▼
navigateTo('soporte') → renderSoporte() → ve el ticket #N actualizado
```

**Diseño anti-forward del email:**
- No usa SSO token (decisión 2026-05-22): si el email se reenvía/intercepta, nadie puede acceder a la cuenta
- El usuario siempre debe loguearse con su contraseña
- El `?goto=` no es sensible — solo indica destino, no autentica

### Flujo 6 — Prioridad IA en tickets

> Implementado en Fase 4 Ítem 2 (sesión 2026-05-22). Modelo: Claude Haiku 4.5.

#### Estados de `priority_source`

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ NULL         │ Sin clasificar — ticket recién creado o reseteado.           │
│              │ priority='medium' es placeholder. IA puede procesarlo.       │
├──────────────┼──────────────────────────────────────────────────────────────┤
│ 'ai'         │ IA lo clasificó. Razonamiento en priority_notes.             │
│              │ IA puede re-procesarlo en batches futuros (refresh).         │
├──────────────┼──────────────────────────────────────────────────────────────┤
│ 'manual'     │ Admin lo fijó manualmente (toggle OFF).                      │
│              │ IA NUNCA lo toca. Único cambio: admin edita o tildea toggle. │
├──────────────┼──────────────────────────────────────────────────────────────┤
│'ai_overridden│ Legacy — admin editó prioridad puesta por IA antes del       │
│              │ refactor del toggle. Funcionalmente equivalente a 'manual'.  │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

#### Transiciones (PUT /admin/tickets/:id/priority)

```
INPUT: priority (low/medium/high/urgent) + ai_managed (boolean)

Si ai_managed === true:
  ├── prevSource es 'manual' o 'ai_overridden' → newSource = NULL (admin destildó)
  ├── priorityChanged → newSource = NULL (admin puso nuevo valor, IA lo re-procesa)
  └── ya era 'ai' o NULL sin cambios → preservar (noop, sin escritura)

Si ai_managed === false:
  └── newSource = 'manual' (admin gestiona, lockea de IA)

Si ai_managed no se envía (legacy):
  ├── prevSource === 'ai' → newSource = 'ai_overridden'
  └── otro → newSource = 'manual'
```

#### Batch IA (POST /admin/tickets/ai-prioritize)

```
Admin click "🤖 Establecer prioridad por IA (N)" en tabla
        │
        ▼
POST /admin/tickets/ai-prioritize  { ticket_ids?: [] }
        │
        ├── Query: WHERE (source IS NULL OR source = 'ai') AND status != 'closed'
        ├── Rate limit: 100 tickets/hora/admin (in-memory Map)
        ├── Paralelismo: 5 concurrent calls a Anthropic
        │
        ▼
Por cada ticket:
        │
        ├── Construye contexto: category + plan_name + title + description
        ├── POST api.anthropic.com/v1/messages
        │     model: claude-haiku-4-5
        │     max_tokens: 300
        │     system: AI_PRIORITY_SYSTEM_PROMPT (criterios L/M/H/U conservadores)
        │
        ├── Parse JSON estricto: { priority: 'low'|'medium'|'high'|'urgent', notes: '...' }
        │
        └── UPDATE support_tickets
              SET priority = $1, priority_source = 'ai',
                  priority_notes = $2, priority_set_at = NOW(),
                  priority_set_by = NULL
              WHERE id = $3
        │
        ▼
Response: { processed: N, failed: M, errors: [...] }
```

#### UI: ciclo de vida visual del badge

```
┌─ Estado ─────────────────┬─ Badge en tabla ─────────────────────┬─ Detalle ────────────┐
│ Recién creado (NULL)     │ Media · sin clasif.  (gris punteado) │ Toggle ON + aviso ⏳ │
│ IA clasificó ('ai')      │ 🤖 Alta              (color sólido)  │ Toggle ON + 💬 notes │
│ Admin destildó ('manual')│ 👤 Urgente           (color sólido)  │ Toggle OFF           │
└──────────────────────────┴──────────────────────────────────────┴──────────────────────┘
```

### Flujo 7 — Visibilidad de comentarios + IA suggest + Ajustes manuales

> Implementado en Fase 4 Ítem 3 (sesión 2026-05-22). Tres features integradas en el detalle del ticket admin.

#### A. Visibilidad de comentarios (external | internal)

```
COMPOSITOR EN DETALLE TICKET ADMIN:
┌─────────────────────────────────────────┐
│ Tipo: [▼ 📤 Externa | 🔒 Interna]      │  ← default: external
│ [textarea]                              │
│ [🤖 Proyectar IA*] [Responder]         │  *deshabilitado si interna
└─────────────────────────────────────────┘

ADMIN ENVÍA con visibility='external':
  POST /admin/tickets/:id/comment { message, visibility: 'external' }
    ├── INSERT con visibility='external'
    ├── UPDATE status='in_progress' si estaba 'open'
    ├── sendTicketReplyEmail() (si EMAIL_TICKET_REPLY_ENABLED)
    └── Visible para user en GET /tickets/:id

ADMIN ENVÍA con visibility='internal':
  POST /admin/tickets/:id/comment { message, visibility: 'internal' }
    ├── INSERT con visibility='internal'
    ├── status NO cambia (notas internas son discusión, no respuesta)
    ├── Email NO se envía (log: "📝 Nota interna en ticket #N")
    └── INVISIBLE en GET /tickets/:id (filtro WHERE visibility='external')

VISUALIZACIÓN EN EL HILO:
  📤 Externa: fondo blanco, badge azul/amarillo según rol
  🔒 Interna: fondo amarillo (#fef9c3), borde izquierdo amber, label "🔒 NOTA INTERNA"
             + texto "Solo visible para administradores"
```

#### B. Proyectar respuesta con IA

```
Admin en compositor (modo Externa) click "🤖 Proyectar con IA"
        │
        ▼
POST /admin/tickets/:id/ai-suggest-reply
        │
        ├── Rate limit: 30 sugerencias/hora por admin
        ├── Contexto enviado a Claude Haiku:
        │     - Ticket: id, category, priority, title, description
        │     - Usuario: nombre + plan (display_name)
        │     - Historial COMPLETO (externas + internas marcadas como tal)
        │       → la IA "ve" notas internas como contexto privado
        │       pero genera respuesta externa
        │     - AI_REPLY_SYSTEM_PROMPT: rioplatense, conciso, anti-hallucination
        │
        ▼
Claude Haiku genera sugerencia
        │
        ├── INSERT ai_assistance_logs (action='suggested')
        └── Response: { suggestion, log_id }
        │
        ▼
Frontend pre-carga textarea + muestra hint azul
        │
        ▼
Admin edita (o no) y click "Responder"
        │
        ├── POST comment normal (con visibility='external')
        │
        ├── Telemetría async: PATCH /admin/ai-suggest-logs/:log_id
        │     { action: 'sent_as_is' | 'sent_edited', final_text }
        │     → calcula edit_distance (chars distintos)
        │
        └── Permite medir si el prompt funciona (si edit_distance promedio alto → ajustar)
```

#### C. Ajuste manual de usos desde ticket

```
CARD EN COLUMNA DERECHA DEL DETALLE TICKET:
┌──────────────────────────────────────────┐
│ 🎯 Ajuste manual de usos                 │
│ Subsistema: [▼ proc/batch/inf/...]      │
│ Cantidad: [+10 / -5]                     │
│ Motivo: [...]                            │
│ [Aplicar ajuste]                         │
│                                          │
│ Historial reciente del usuario:          │
│  +10 proc · 22/05 · "Compensación X"    │
│  -5 inf   · 18/05 · "Error operativo"   │
└──────────────────────────────────────────┘

Admin completa form → click "Aplicar ajuste"
        │
        ▼
POST /admin/subscriptions/:userId/adjust
  body: { subsystem, amount, reason, ticket_id: currentTicketId }
        │
        ├── UPDATE subscriptions SET <subsystem>_bonus += amount
        ├── INSERT usage_adjustments (con ticket_id vinculado)
        │
        ▼
Refresca historial reciente en el card (últimos 5 ajustes del usuario)
```

**Diferencia con "🎁 Beneficio comercial"** (que ya existía):
- Beneficio: 1 por ticket, lockea el ticket, tipos discount/plan_upgrade/usage_reset
- Ajuste manual: múltiples permitidos, reversibles, granular por subsistema

---

## 5. Errores frecuentes y resolución

### Errores de ejecución (Electron → PJN)

| Error | Causa | Resolución |
|---|---|---|
| `LOGIN_FAILED` | Chrome no tiene contraseña PJN guardada | Usuario: botón "Agregar contraseña SCW" en Configuración |
| `TIMEOUT_NAVIGATION` | PJN lento o caído | Reintentar en 5 min; verificar status del PJN |
| `EXECUTION_LOCK` | Otra instancia activa (mismo machineId) | Cerrar otras ventanas de la app; esperar 2 min |
| `CHROME_NOT_FOUND` | Chrome no instalado o path incorrecto | Configurar path de Chrome en Configuración > General |
| `SCRIPT_SIGNATURE_INVALID` | Script descargado corrupto | Limpiar caché de scripts en Configuración > Seguridad |

### Errores de API (Backend)

| Código | Mensaje | Causa |
|---|---|---|
| 401 | Token no proporcionado | Request sin header Authorization |
| 403 | Token inválido o expirado | JWT vencido (2h) o en blacklist post-logout |
| 403 | Se requiere rol de administrador | Usuario normal accediendo a /admin/* |
| 403 | checkLicense | Suscripción inactiva o cuota agotada |
| 429 | Rate limit alcanzado | Demasiados intentos en la ventana de tiempo |
| 503 | Servicio de IA no disponible | ANTHROPIC_API_KEY no configurada en .env |

### Errores de cron jobs

| Cron | Frecuencia | Acción |
|---|---|---|
| Trial agotado | Cada hora | usage_count >= usage_limit → `rejected` |
| Plan vencido | Diario 02:00 UTC | plan_expiry_date < NOW() → `suspended_plan_expired` |
| Cancel_at vencido | Diario 02:00 UTC | cancel_at < NOW() → `cancelled` |
| Scheduled plan | Diario 02:00 UTC | apply_at < NOW() → aplica nuevo plan |
| Heartbeat lock | Cada 5 min | Limpia active_executions sin heartbeat en 3 min |

---

## 6. Arquitectura de scripts cifrados

```
[Servidor]
  DB: encrypted_scripts
    ├── name (ej: "procuracion")
    ├── content_encrypted (AES-256-CBC)
    ├── iv (vector de inicialización)
    ├── signature (RSA-2048, firmado con clave privada del servidor)
    ├── hash (SHA-256 del contenido en claro)
    └── version (semver)

[Cliente Electron]
  GET /client/scripts/check/:name → { version, hash, needsUpdate }
  GET /client/scripts/download/:name → { encrypted, iv, signature }
      │
      ▼
  fileEncryption.js → descifra con ENCRYPTION_KEY del servidor (env)
      │
      ▼
  scriptVerifier.js → verifica firma RSA con clave pública embebida
      │
      ├── VÁLIDO → ScriptExecutor.run() → Puppeteer
      └── INVÁLIDO → error, no ejecuta
```

**Zona protegida:** `backend-server/keys/` contiene la clave privada RSA. Cambiarla invalida todos los scripts en producción.

---

## 7. IPC channels — Electron (Main ↔ Renderer)

| Canal | Dirección | Descripción |
|---|---|---|
| `login` | R→M | Autenticación con email/password |
| `logout` | R→M | Cierra sesión, blacklistea token |
| `get-user-info` | R→M | Datos de cuenta y suscripción |
| `run-process` | R→M | Inicia procuración automática |
| `stop-process` | R→M | Detiene proceso en curso |
| `run-informe` | R→M | Inicia generación de informe |
| `run-monitoreo` | R→M | Ejecuta monitor de partes |
| `monitor-get-partes` | R→M | Lista partes configuradas |
| `monitor-agregar-parte` | R→M | Agrega parte al monitor |
| `get-notifications` | R→M | Obtiene notificaciones in-app |
| `mark-notification-read` | R→M | Marca notificación como leída |
| `ai-chat` | R→M | Consulta al asistente IA (fallback Claude) |
| `log-message` | M→R | Envía línea al console de la UI |
| `process-progress` | M→R | Progreso de ejecución (%) |
| `update-available` | M→R | Nueva versión detectada |

---

## 8. Deploy checklist

### Backend
```bash
# 1. Subir archivos modificados
scp -i C:/Users/JONATHAN/.ssh/do_procurador <archivo> root@142.93.64.94:/var/www/procurador/backend-server/<ruta>

# 2. Reiniciar
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 restart procurador-api"

# 3. Verificar
curl -s https://api.procuradortool.com/health
```

### Electron (nueva versión)
```powershell
# 1. Bumper versión en package.json
# 2. Commit + push a main
# 3. Build y release
cd electron-app
$env:GH_TOKEN = "<token>"
npm run release
# → sube .exe + .yml a GitHub Releases → auto-updater lo detecta
```

### Extensión Chrome
```powershell
# 1. Actualizar version en manifest.json
# 2. Generar ZIP (excluir imagenes/)
# 3. Subir manualmente a Chrome Web Store > Developer Dashboard
```

---

## Flujos de cobranza (Fase 5)

> Implementación validada en sandbox MercadoPago el 2026-05-29. Ver `CLAUDE.md → Estado Fase 5` para detalle técnico.

### Estados de suscripción relevantes para pagos

| Campo en `subscriptions` | Significado |
|---|---|
| `payment_provider` | `'mercadopago'` cuando hay método de pago configurado, NULL si no |
| `external_subscription_id` | ID real del preapproval en MP (necesario para cancelar vía API) |
| `cancel_at` | Fecha de fin de período cuando hay cancelación programada |
| `auto_renewal` | `TRUE` por default, `FALSE` cuando el usuario canceló |
| `payment_grace_ends_at` | Fin del período de gracia (3 días) tras pago rechazado |
| `last_payment_at` | Timestamp del último pago aprobado |
| `trial_bonus_until` | Fin del período con bonus de bienvenida (+20 usos) |

### Flujo de alta de suscripción

```
Usuario en portal → click "Configurar método de pago"
  → POST /usuarios/api/checkout/init
  → backend genera URL: mercadopago.com.ar/.../checkout?
       preapproval_plan_id=...&external_reference=user_{id}&payer_email=...
  → portal navega a esa URL (misma pestaña)
  → usuario completa checkout en MP → MP redirige a back_url ?pago=ok
  → portal detecta retorno (URL param o localStorage flag psc_checkout_pending)
  → POST /usuarios/api/checkout/confirm
  → markPaymentConfigured(userId) → payment_provider='mercadopago'
  → webhook subscription_preapproval llega después → guarda external_subscription_id real
  → webhook payment llega → applyTrialBonus() o applyRenewal() → usage_limit actualizado
```

### Identificación de usuario en webhooks (orden de prioridad)

1. **`external_reference="user_{id}"`** — extraído del URL del checkout. Independiente del email de MP.
2. **`external_subscription_id`** ya vinculado en DB — para renovaciones.
3. **`payer_email`** del pagador ↔ email del portal — fallback cuando coinciden.
4. Timing heuristic (preapproval reciente sin vincular) — último recurso, usado en `markPaymentConfigured`.

> ⚠️ Esto resuelve el caso donde el usuario tiene distinto email en MP y en el portal.

### Flujo de cancelación por el usuario

```
Usuario → "Cancelar suscripción" → POST /usuarios/api/checkout/cancel
  → cancel_at = next_billing_date
  → auto_renewal = FALSE
  → preApprovalClient.update({ status: 'cancelled' }) en MP (solo si external_subscription_id es ID real, no placeholder pay-*)
  → UI muestra banner rojo "Cancelación programada" + botón ↩ Reactivar

Día = cancel_at (cron 08:20 ART):
  → triple verificación: NOW() > cancel_at + 2h · auto_renewal=FALSE · NOT EXISTS pago aprobado reciente
  → status='cancelled', registration_status='cancelled', acceso revocado
```

> El cobro del período en curso ya ocurrió al suscribirse. La cancelación solo afecta la **renovación**. El usuario conserva acceso hasta `cancel_at`.

### Flujo de reactivación (deshacer cancelación)

```
Usuario antes de cancel_at → click "↩ Reactivar"
  → POST /usuarios/api/checkout/reactivate
  → reactivateSubscription(userId)
       valida cancel_at NO NULL y NO vencido
       preApprovalClient.update({ status: 'authorized' }) en MP
  → cancel_at = NULL, auto_renewal = TRUE
  → renovación automática continúa normal
```

### Flujo de pago rechazado → suspensión → recuperación

```
Renovación → MP rechaza el pago
  → webhook payment status='rejected'
  → payment_grace_ends_at = NOW() + 3 días
  → suspension_cause = 'payment'
  → email a usuario, banner en portal/app
  → MP reintenta cobro cada 6h dentro del período de gracia

Cobro recuperado dentro de gracia:
  → webhook payment status='approved'
  → applyRenewal(): limpia payment_grace_ends_at, restaura cancel_at=NULL, auto_renewal=TRUE
  → users.registration_status = 'active' (si estaba suspendido por pago)

Gracia vencida sin pago (cron 08:30 ART):
  → status='suspended', registration_status='suspended'
  → UI portal/app: "Pago fallido — Actualizá tu método de pago"
  → usuario carga nuevo método → checkout MP → al pagar, cuenta se reactiva
```

### Facturación (modo manual actual)

```
Webhook payment status='approved'
  → enqueueInvoice(paymentId) crea row en invoices con status='pending', pdf_url=NULL
  → aparece en dashboard admin → 🧾 Facturación → tab "Pendientes"

Admin genera factura en ARCA → descarga PDF →
  → en dashboard sube PDF + número (autoformateo 1245→0001-00001245) + CAE (opcional)
  → POST /admin/invoices/:id/upload o /admin/invoices/from-payment/:paymentId
  → invoice pasa a status='issued', pdf_url=/invoices/factura_*.pdf
  → portal del usuario muestra la factura instantáneamente
```

> **Facturas manuales** (sin pago asociado): admin → tab "Emitidas" → "＋ Nueva factura manual" → POST `/admin/invoices/manual` con `user_id`, `amount`, `issued_at`, PDF.

> **Facturante automático:** desactivado (cron comentado, `processInvoice()` no-op si `FACTURANTE_WSDL_URL` vacío). Para activar: completar vars `FACTURANTE_*` en `.env`, descomentar cron en `server.js`, reiniciar con `--update-env`.
