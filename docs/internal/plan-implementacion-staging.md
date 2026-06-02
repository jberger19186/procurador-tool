# Plan de Implementación de Staging + Rollback Bidireccional

> **Fecha:** 01 de junio de 2026
> **Estado:** PLAN — pendiente de aprobación antes de implementar.
> **Base:** complementa `plan-staging-rollback.md` (diseño conceptual) con pasos concretos y la estrategia de backup/rollback en **ambos entornos**.
> **Resguardos ya tomados:** backup Desktop `202606_01062026_ProcuradorTool` · tag git `pre-staging-2026-06-01`.

---

## 1. Principio rector: el rollback debe funcionar en los DOS entornos

El punto crítico que guía este plan:

> **"Algo que funcionó en pruebas puede fallar en producción."**

Staging reduce el riesgo, pero **no lo elimina**. Por eso el plan no asume que "si pasó en staging, producción es seguro". En cambio, garantiza que **cada entorno tenga su propia red de seguridad**:

- **Staging** puede romperse al probar → se restaura desde su propio backup, sin afectar a nadie.
- **Producción** puede fallar aunque staging haya pasado → se restaura desde un **backup tomado segundos antes del despliegue**.

La regla de oro operativa: **nunca se toca producción sin un backup fresco e inmediato de producción listo para restaurar.**

---

## 2. Arquitectura objetivo

```
              Servidor DigitalOcean (142.93.64.94 · Ubuntu)
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                    │
  │   PRODUCCIÓN (usuarios reales)        STAGING (solo equipo)         │
  │   ┌─────────────────────────┐         ┌──────────────────────────┐ │
  │   │ PM2: procurador-api     │         │ PM2: procurador-staging  │ │
  │   │ Puerto: 3443            │         │ Puerto: 3444             │ │
  │   │ DB: procurador_db       │         │ DB: procurador_db_staging│ │
  │   │ .env (MP producción*)   │         │ .env.staging (MP sandbox)│ │
  │   │ api.procuradortool.com  │         │ staging-api.procurador…  │ │
  │   └───────────┬─────────────┘         └────────────┬─────────────┘ │
  │               │                                    │               │
  │        backups/produccion/                  backups/staging/        │
  │        (automáticos pre-deploy)             (antes de cada prueba)   │
  └──────────────────────────────────────────────────────────────────┘
       * MP producción solo cuando se active B3; hoy ambos en sandbox.
```

**Aislamiento total:** distinto proceso, distinta base de datos, distinto subdominio, distinto archivo de configuración. Un error en staging **no puede** tocar datos ni cobros reales.

---

## 3. Estrategia de backups — el corazón del plan

### 3.1 Tres tipos de backup

| Tipo | Cuándo | Qué cubre | Dónde |
|---|---|---|---|
| **Pre-deploy producción** | Automático, **antes de cada** promoción a producción | DB completa + carpeta de código actual | `/var/backups/procurador/prod/` |
| **Pre-prueba staging** | Antes de cada sesión de pruebas que toque la DB de staging | DB de staging | `/var/backups/procurador/staging/` |
| **Diario programado** | Cron, 1×/día (madrugada) | DB de producción | `/var/backups/procurador/daily/` + copia a Desktop semanal |

### 3.2 Retención
- Pre-deploy: se conservan los **últimos 10** (rotación automática).
- Diarios: se conservan **7 días**.
- Cada backup lleva fecha y hora en el nombre: `prod_db_AAAAMMDD_HHMMSS.sql`.

### 3.3 Regla innegociable
> El script de despliegue a producción **hace el backup primero**. Si el backup falla, **el despliegue se aborta**. No hay deploy sin backup.

---

## 4. Flujo de trabajo seguro (con los puntos de rescate marcados)

```
   1. Desarrollo local + commit + tag de versión
            │
            ▼
   2. Deploy a STAGING ──► (backup pre-prueba de staging)
            │
            ▼
   3. Pruebas exhaustivas en staging
            │
      ¿Pasó todo?  ──NO──► corregir → volver a paso 2
            │ SÍ
            ▼
   4. ⚠️ BACKUP PRE-DEPLOY DE PRODUCCIÓN (obligatorio, automático)
            │   └─ si el backup falla → ABORTA, no despliega
            ▼
   5. Deploy a PRODUCCIÓN
            │
            ▼
   6. Checklist post-deploy en producción
            │
      ¿Todo OK?  ──NO──► ROLLBACK DE PRODUCCIÓN (sección 6)
            │ SÍ            usando el backup del paso 4
            ▼
   7. Listo · registrar el deploy
```

El **paso 4** es la respuesta directa a tu inquietud: aunque staging haya pasado, producción tiene su backup inmediato listo para revertir en el paso 6.

---

## 5. Implementación paso a paso (ST-1)

> Tareas de una sola vez para dejar staging operativo. **Nada de esto se ejecuta hasta tu aprobación.**

| # | Tarea | Detalle |
|---|---|---|
| 5.1 | **Crear estructura de backups** | `mkdir -p /var/backups/procurador/{prod,staging,daily}` |
| 5.2 | **Backup base inicial** | Dump de producción como punto cero antes de tocar el servidor |
| 5.3 | **Crear DB de staging** | `procurador_db_staging` con la estructura de producción + datos de prueba (no datos reales de clientes) |
| 5.4 | **Crear `.env.staging`** | Copia del `.env` apuntando a: DB staging, puerto 3444, **MercadoPago sandbox** (nunca cobra real), mismas claves RSA |
| 5.5 | **Ampliar `ecosystem.config.js`** | Agregar el proceso `procurador-staging` (puerto 3444) junto al `procurador-api` existente |
| 5.6 | **Configurar Nginx** | `staging-api.procuradortool.com` → puerto 3444, con certificado SSL propio (certbot) |
| 5.7 | **Proteger staging** | Acceso restringido por usuario/contraseña a nivel Nginx (solo el equipo entra) |
| 5.8 | **Crear scripts operativos** | `deploy-staging.sh`, `deploy-prod.sh` (con backup obligatorio), `rollback-prod.sh`, `backup-now.sh` |
| 5.9 | **Cron de backup diario** | Tarea programada 1×/día de la DB de producción |

---

## 6. Procedimientos de Rollback — para CADA entorno

### 6.1 Rollback en STAGING (bajo, sin urgencia)
Staging es desechable. Si una prueba lo rompe:
```
1. Restaurar DB staging desde backups/staging/
2. Volver el código al tag estable + reiniciar procurador-staging
```
Nadie real se ve afectado. Se puede experimentar con tranquilidad.

### 6.2 Rollback en PRODUCCIÓN (crítico, con urgencia)
Cuando un deploy a producción falla **aunque staging haya pasado** — el escenario que te preocupa:

```
🚨 Falla detectada en producción tras el deploy
        │
        ▼
  Capa A — CÓDIGO:  volver al tag estable + pm2 restart procurador-api   (~2-3 min)
        │
        ▼  ¿el problema era de datos? (migración, corrupción)
  Capa B — DATOS:   restaurar DB desde el backup PRE-DEPLOY del paso 4
        │           (el que se tomó segundos antes de este deploy)
        ▼
  Capa C — PROCESO: pm2 restart / si persiste, volver versión estable
        │
        ▼
  Verificar con checklist post-deploy → sistema recuperado
```

**Principio:** ante la duda, **revertir primero, investigar después**. El backup pre-deploy garantiza que siempre se puede volver al estado exacto previo al cambio.

---

## 7. Validación del procedimiento (ST-3) — simulacro obligatorio

Antes de confiar en el sistema, se ensaya el peor caso **en staging**:

1. Aplicar un cambio que funciona en staging pero **rompe a propósito** algo que solo se manifiesta con datos/configuración de producción.
2. Simular el deploy a un entorno "tipo producción" (puede ser una segunda DB de prueba).
3. Ejecutar el rollback completo de las 3 capas usando el backup pre-deploy.
4. Cronometrar y confirmar recuperación total.
5. Ajustar los scripts según lo aprendido.

> Solo tras un simulacro exitoso el procedimiento se considera "aprobado" para uso real.

---

## 8. Esfuerzo y orden

| Fase | Tarea | Esfuerzo | Estado |
|---|---|---|---|
| A | Estructura de backups + scripts operativos (5.1, 5.2, 5.8, 5.9) | Bajo | ✅ **Completada (01/06)** |
| B | DB y configuración de staging (5.3–5.5) | Medio | ✅ **Completada (01/06)** |
| C | Nginx + SSL + protección de acceso (5.6, 5.7) | Medio | ✅ **Completada (01/06)** |
| D | Simulacro de rollback (ST-3) | Bajo (medio día) | Pendiente |

**Tiempo estimado restante:** ~medio día (Fase C + D).

### Nota Fase A (completada)
- El **backup diario ya existía** y es offsite (DO Spaces, 30 días) — mejor que lo planeado. No se duplicó.
- Se agregaron `ops/backup-now.sh` (pre-deploy on-demand) y `ops/restore-db.sh` (restauración con red de seguridad), ambos **probados** (backup en prod real; restore E2E contra base descartable sin tocar producción).
- Carpeta `/var/backups/procurador/predeploy/` para backups pre-deploy y pre-restore.

### Nota Fase B (completada)
- Base `procurador_db_staging` creada desde backup de producción (26 tablas).
- Proceso PM2 `procurador-staging` en **modo fork, puerto 3444** (HTTP 3001), cargando `.env.staging` por preload (`-r dotenv/config`). Sin secretos en `ecosystem.config.js`.
- `.env.staging` (server-only): overrides de DB/puertos/NODE_ENV + **MercadoPago fijado en sandbox** (no cambia aunque prod pase a MP real en B3).
- **Aislamiento probado:** una escritura en staging (users 3→4) no afectó producción (siguió en 3). `pm2 save` para persistir ante reinicios.
- **Pendiente Fase C:** staging hoy solo es accesible internamente (`localhost:3444` en el servidor). Falta el subdominio público `staging-api.procuradortool.com` + SSL + acceso restringido.

---

## 9. Lo que este plan garantiza

| Riesgo | Cómo lo cubre el plan |
|---|---|
| Romper la UI/lógica al probar un cambio | Se prueba en staging, no en producción |
| Un cambio pasa en staging pero falla en producción | **Backup pre-deploy obligatorio** + rollback de 3 capas en producción |
| Corrupción o error en la base de datos | Backup pre-deploy + diarios + restauración por capa |
| Perder el backup junto con el sistema | Backups en el servidor + copia semanal al Desktop (fuera del servidor) |
| Pruebas de pago afectando dinero real | Staging usa MercadoPago en modo sandbox |
| No saber si un deploy quedó bien | Checklist post-deploy obligatorio |

---

## 10. Próximo paso

> **Fases A, B y C completadas (01/06/2026).** Staging accesible públicamente, protegido y aislado.
> Siguiente y último: **Fase D** (simulacro de rollback).

### Nota Fase C (completada)
- DNS `staging-api.procuradortool.com` → 142.93.64.94 (Cloudflare, DNS only). Creado por el usuario.
- Bloque Nginx habilitado (`ops/nginx-staging.conf`), SSL emitido por certbot (vence 2026-08-31, renovación automática), HTTP→HTTPS 301.
- **Protección de acceso (basic auth):** usuario `equipo`, archivo `/etc/nginx/.htpasswd-staging`.
- **Verificado:** sin credenciales → 401 · con credenciales → 200 · HTTP→HTTPS → 301 · producción intacta (200 sin auth).

### Acceso a staging
- URL: **https://staging-api.procuradortool.com** (usuario/contraseña — credenciales con el equipo).
- Internamente en el servidor: `https://localhost:3444`.
