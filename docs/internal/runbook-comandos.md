# Runbook de Comandos — Pruebas, Deploys y Recuperos

> **Fecha:** 01 de junio de 2026
> Comandos exactos para copiar y pegar. Visión general: `flujo-staging-rollback.md`.
>
> **Convenciones:**
> - SSH al servidor: `ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94`
> - Repo local: `C:\Users\JONATHAN\source\repos\ProcuradorTool`
> - Producción: `/var/www/procurador/backend-server` · puerto 3443 · base `procurador_db` · PM2 `procurador-api`
> - Staging: `/var/www/procurador-staging/backend-server` · puerto 3444 · base `procurador_db_staging` · PM2 `procurador-staging`
> - Scripts ops en el servidor: `/var/www/procurador/ops/`

---

## A. BACKEND — Backups

### A.1 Backup on-demand (antes de un deploy a producción)
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "/var/www/procurador/ops/backup-now.sh prod"
```
Imprime la ruta del archivo en la última línea. Backups en `/var/backups/procurador/predeploy/`.

### A.2 Backup de staging
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "/var/www/procurador/ops/backup-now.sh staging"
```

### A.3 Ver backups disponibles
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "ls -lt /var/backups/procurador/predeploy/ /var/backups/procurador/"
```

### A.4 Backup completo al Desktop (DB + código + claves + certs)
> Procedimiento detallado en CLAUDE.md → "Backup completo del proyecto". Resumen:
```powershell
$fecha = Get-Date
$carpeta = "C:\Users\JONATHAN\Desktop\$($fecha.ToString('yyyyMM'))_$($fecha.ToString('ddMMyyyy'))_ProcuradorTool"
New-Item -ItemType Directory -Path $carpeta -Force
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "sudo -u postgres pg_dump procurador_db" > "$carpeta\procurador_db_backup.sql"
# + env, keys, certs, zip de código (ver CLAUDE.md)
```

---

## B. BACKEND — Deploy a Staging (probar primero)

### B.1 Subir archivos al staging
```powershell
# Subir uno o varios archivos al DIRECTORIO DE STAGING (no al de prod)
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" `
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/routes/<archivo>.js" `
  root@142.93.64.94:/var/www/procurador-staging/backend-server/routes/
```

### B.2 Reiniciar staging y verificar
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 restart procurador-staging && sleep 3 && curl -sk https://localhost:3444/health"
```

### B.3 Probar desde afuera (con las credenciales de staging)
```bash
curl -u "equipo:<contraseña>" https://staging-api.procuradortool.com/health
```

---

## C. BACKEND — Deploy a Producción (después de validar en staging)

> **SIEMPRE backup primero (A.1). Si el backup falla, no desplegar.**

### C.1 Backup + subir + reiniciar
```powershell
# 1. Backup pre-deploy
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "/var/www/procurador/ops/backup-now.sh prod"

# 2. Subir el/los archivo(s) al directorio de PRODUCCIÓN
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" `
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/routes/<archivo>.js" `
  root@142.93.64.94:/var/www/procurador/backend-server/routes/

# 3. Reiniciar producción
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "pm2 restart procurador-api && sleep 2 && pm2 list | grep online"
```

### C.2 Checklist post-deploy (verificar)
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "curl -sk https://localhost:3443/health"
# + login de prueba, dashboard, portal, logs sin errores nuevos:
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 logs procurador-api --lines 15 --nostream | tail -15"
```

---

## D. BACKEND — Rollback (cuando algo falla en producción)

### D.1 Rollback de DATOS (restaurar la base)
```bash
# Ver backups y elegir el previo al deploy
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "ls -lt /var/backups/procurador/predeploy/prod_predeploy_*.sql.gz"

# Restaurar (pide confirmación tipeada 'RESTAURAR'; hace backup de seguridad antes)
# Recomendado: detener la app primero para una restauración limpia.
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 stop procurador-api"
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "/var/www/procurador/ops/restore-db.sh prod /var/backups/procurador/predeploy/<archivo>.sql.gz"
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 start procurador-api"
```

### D.2 Rollback de CÓDIGO (volver al tag estable)
```powershell
# En local: recuperar el archivo del tag estable y re-desplegarlo
git -C "C:\Users\JONATHAN\source\repos\ProcuradorTool" checkout <tag-estable> -- backend-server/routes/<archivo>.js
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" `
  "C:/Users/JONATHAN/source/repos/ProcuradorTool/backend-server/routes/<archivo>.js" `
  root@142.93.64.94:/var/www/procurador/backend-server/routes/
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "pm2 restart procurador-api"
# Restaurar el working tree local: git checkout HEAD -- backend-server/routes/<archivo>.js
```

### D.3 Rollback de PROCESO
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 restart procurador-api"
```

---

## E. BACKEND — Simulacros de recuperación (DR drills, solo staging)

### E.1 Simulacro de rollback de DATOS
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "/var/www/procurador/ops/drill-rollback.sh"
```
Corrompe datos de staging y los recupera; verifica que producción queda intacta.

### E.2 Simulacro de rollback de CÓDIGO
```bash
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "/var/www/procurador/ops/drill-code-rollback.sh"
```
Rompe el código de staging y lo restaura; confirma que producción no se afecta.

---

## F. APP ELECTRON — Probar, publicar y revertir

> Todo se corre en local, en `electron-app/`.

### F.1 Probar SIN instalar
```powershell
cd "C:\Users\JONATHAN\source\repos\ProcuradorTool\electron-app"
npm start                 # corre desde el código fuente (más rápido)
# o probar el build real sin instalador:
npm run build:dir
& ".\dist\win-unpacked\Procurador SCW.exe"
```

### F.2 Probar contra un backend específico
```powershell
$env:BACKEND_URL="https://api.procuradortool.com"   # o el que quieras
npm start
```

### F.3 Publicar una versión nueva
```powershell
cd "C:\Users\JONATHAN\source\repos\ProcuradorTool\electron-app"
# 1. Subir "version" en package.json
# 2. Tag del código de esta versión:
git -C "C:\Users\JONATHAN\source\repos\ProcuradorTool" tag electron-v<X.Y.Z>
git -C "C:\Users\JONATHAN\source\repos\ProcuradorTool" push origin electron-v<X.Y.Z>
# 3. Publicar (requiere GH_TOKEN; ver CLAUDE.md para recuperarlo del Credential Manager)
$env:GH_TOKEN="<token>"
npm run release
```

### F.4 Rollback de la app (fix-forward)
```powershell
# 1. Recuperar el código bueno (revertir el commit malo o checkout del tag bueno)
git -C "C:\Users\JONATHAN\source\repos\ProcuradorTool" checkout electron-v<version-buena> -- electron-app/
# 2. Subir "version" a una MAYOR nueva (ej: la mala fue 2.7.15 → nueva 2.7.16)
# 3. Publicar la versión sana:
cd "C:\Users\JONATHAN\source\repos\ProcuradorTool\electron-app"
$env:GH_TOKEN="<token>"; npm run release
# El auto-updater lleva a todos los usuarios a la versión sana.
```

### F.5 Descargar un instalador pasado (desde GitHub)
```
https://github.com/jberger19186/procurador-tool/releases
```
Cada release tiene su `.exe`. Sirve como archivo de versiones para reinstalar manualmente.

---

## G. Verificaciones útiles

```bash
# Estado de ambos procesos
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 list"

# Health de los dos entornos
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "echo prod:; curl -sk https://localhost:3443/health | head -c 40; echo; echo staging:; curl -sk https://localhost:3444/health | head -c 40"

# Conteo de una tabla en cada base (verificar aislamiento)
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "sudo -u postgres psql -d procurador_db -tAc 'SELECT count(*) FROM users;'; sudo -u postgres psql -d procurador_db_staging -tAc 'SELECT count(*) FROM users;'"
```
