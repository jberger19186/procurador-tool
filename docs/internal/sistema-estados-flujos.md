# Documentación interna — Estados, errores y flujos del sistema
**Procurador SCW** · Uso interno del equipo  
Última actualización: 2026-05-21

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
