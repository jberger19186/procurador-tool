# Flujo de Staging y Rollback — Documento maestro (Backend + App Electron)

> **Fecha:** 01 de junio de 2026
> Visión general de cómo se prueban los cambios y cómo se revierten, en los **dos componentes** del sistema.
> **Comandos exactos:** ver `runbook-comandos.md`. **Detalle backend:** `plan-implementacion-staging.md`. **Detalle Electron:** `flujo-release-electron.md`.

---

## 1. Los dos mundos del proyecto

El sistema tiene dos componentes que se actualizan de forma distinta, y por eso tienen flujos de prueba y rollback diferentes:

| Componente | Qué es | Cómo llega al usuario | Dónde se prueba |
|---|---|---|---|
| **Backend** | API + base de datos (servidor) | Deploy al servidor (afecta a todos al instante) | **Staging** (`staging-api.procuradortool.com`) |
| **App Electron** | Cliente de escritorio (Windows) | El usuario actualiza solo cuando vos publicás un Release | **Local** (`npm start` en tu máquina) |

> **Regla de oro común:** nunca tocar producción sin un punto de retorno listo (backup de datos + tag de código).

---

## 2. Backend — flujo de staging y rollback

### Entorno
- **Staging:** copia gemela aislada — `staging-api.procuradortool.com` (puerto 3444), base `procurador_db_staging`, código propio en `/var/www/procurador-staging/`, MercadoPago en sandbox, acceso con usuario/contraseña.
- **Producción:** `api.procuradortool.com` (puerto 3443), base `procurador_db`, código en `/var/www/procurador/`.

### Flujo de cambio
```
   1. Desarrollar local
        ▼
   2. Deploy a STAGING (/var/www/procurador-staging) → probar en staging-api
        ▼  ¿pasa?  ──NO──► corregir → volver a 2
        ▼ SÍ
   3. BACKUP pre-deploy de producción (obligatorio)
        ▼
   4. Deploy a PRODUCCIÓN (/var/www/procurador) + pm2 restart procurador-api
        ▼
   5. Checklist post-deploy
        ▼  ¿OK?  ──NO──► ROLLBACK (abajo)
        ▼ SÍ → listo
```

### Rollback backend (3 capas)
| Capa | Cuándo | Cómo | Tiempo probado |
|---|---|---|---|
| **Datos** | Migración/cambio de DB salió mal | `restore-db.sh prod <backup>` (restaura + respalda lo actual antes) | ~3 s |
| **Código** | Un archivo rompe el server | Restaurar archivo del tag estable + `pm2 restart procurador-api` | ~5 s |
| **Proceso** | Server inestable | `pm2 restart procurador-api` | inmediato |

> Validado con simulacros (`ops/drill-rollback.sh`, `ops/drill-code-rollback.sh`). Producción nunca en riesgo.

---

## 3. App Electron — flujo de prueba y rollback

### Entorno
- **No usa servidor de staging.** Se prueba **localmente** en tu máquina.
- Los usuarios solo se actualizan cuando publicás un **Release en GitHub** (control total del rollout).

### Flujo de cambio
```
   1. Desarrollar local
        ▼
   2. Probar SIN instalar: `npm start` (desde fuente) o `npm run build:dir` (build real)
        ▼  ¿pasa?  ──NO──► corregir → volver a 2
        ▼ SÍ
   3. Subir versión + git tag electron-vX.Y.Z (fija el código de esta versión)
        ▼
   4. `npm run release` → publica el Release (los usuarios reciben la actualización)
        ▼
   5. ¿Bug en producción?  ──SÍ──► ROLLBACK (abajo)
        ▼ NO → listo
```

### Rollback Electron — **fix-forward**
El auto-updater **no degrada** versiones. El "rollback" se hace **hacia adelante**:
```
   Versión mala (v2.7.15)
        ▼
   1. Recuperar código bueno (revertir commit o checkout del tag v2.7.14)
        ▼
   2. Publicar como versión MAYOR nueva (v2.7.16) con el código sano
        ▼
   3. El auto-updater lleva a TODOS los usuarios a v2.7.16
```

### Backup de versiones (automático)
- **Instaladores:** GitHub Releases conserva cada `.exe` publicado (offsite, permanente).
- **Código fuente:** el git tag `vX.Y.Z` / `electron-vX.Y.Z` de cada versión.

---

## 4. Tabla comparativa rápida

| | Backend | App Electron |
|---|---|---|
| Entorno de prueba | Staging (servidor gemelo) | Local (`npm start`) |
| Impacto de un deploy | Inmediato a todos | Solo cuando publicás Release |
| Rollback de datos | `restore-db.sh` + backups pre-deploy | — (no tiene datos propios) |
| Rollback de código | Restaurar archivo + `pm2 restart` | **Fix-forward** (nueva versión con código bueno) |
| Archivo de versiones | Backups DB (DO Spaces 30d + pre-deploy) | GitHub Releases + git tags |
| Punto de retorno | Backup DB + tag git | Git tag por versión + GitHub Release |

---

## 5. Principios compartidos

1. **Probar antes de producción** — staging (backend) o local (Electron).
2. **Punto de retorno antes de cada cambio** — backup de datos + tag de código.
3. **Ante la duda, revertir primero, investigar después.**
4. **El rollback se ensaya** (simulacros backend) — no se confía en que "debería funcionar".
5. **Los backups viven fuera del servidor también** (DO Spaces, GitHub, copia semanal a Desktop).

---

## 6. Documentos relacionados

| Documento | Contenido |
|---|---|
| **`runbook-comandos.md`** | Los comandos exactos (copiar y pegar) para backups, deploys, rollbacks y simulacros |
| `plan-implementacion-staging.md` | Detalle de la implementación del staging del backend (4 fases) |
| `flujo-release-electron.md` | Detalle del ciclo de release y rollback de la app Electron |
| `ops/README.md` | Referencia de los scripts operativos |
