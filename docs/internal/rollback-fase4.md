# Rollback — Fase 4 (Soporte)

> Procedimientos de restauración del sistema en caso de necesidad durante la implementación de Fase 4.
> Última actualización: 2026-05-22

---

## Punto de resguardo registrado

| Recurso | Estado | Ubicación |
|---|---|---|
| **Git tag** | `pre-fase4` (commit `0f0d43e`) | GitHub: `git checkout pre-fase4` |
| **DB completa** | `procurador_db_20260522_0946.sql` (952 KB, 21 tablas) | `C:\Users\JONATHAN\Desktop\ProcuradorBackups\` |
| **DB copia en repo** | `database/backup_fase4_inicio.sql` (gitignored) | Repo local |
| **`.env` del servidor** | `server_files_20260522_0946/.env` | `C:\Users\JONATHAN\Desktop\ProcuradorBackups\` |
| **Claves RSA** | `private.pem` + `public.pem` | `C:\Users\JONATHAN\Desktop\ProcuradorBackups\server_files_20260522_0946\keys\` |
| **Versión Electron** | v2.7.5 en GitHub Releases | https://github.com/jberger19186/procurador-tool/releases/tag/v2.7.5 |
| **DigitalOcean Snapshot** | ⚠️ A crear manualmente desde la UI antes de comenzar | https://cloud.digitalocean.com/droplets |

---

## Procedimiento de rollback completo

### Caso 1 — Revertir solo código del backend o frontend

```bash
# 1. Volver al commit pre-fase4 (LOCAL)
cd "C:/Users/JONATHAN/source/repos/ProcuradorTool"
git checkout pre-fase4

# 2. Deploy archivos del backend al servidor
scp -i C:/Users/JONATHAN/.ssh/do_procurador <archivo_modificado> root@142.93.64.94:/var/www/procurador/backend-server/<ruta>

# 3. Reiniciar PM2
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 "pm2 restart procurador-api"

# 4. Volver a main si todo OK
git checkout main
```

### Caso 2 — Revertir base de datos completa

```bash
# 1. Subir el dump al servidor
scp -i C:/Users/JONATHAN/.ssh/do_procurador "C:/Users/JONATHAN/Desktop/ProcuradorBackups/procurador_db_20260522_0946.sql" root@142.93.64.94:/tmp/restore.sql

# 2. SSH al servidor y restaurar
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94
sudo -u postgres psql -c "DROP DATABASE IF EXISTS procurador_db_old;"
sudo -u postgres psql -c "ALTER DATABASE procurador_db RENAME TO procurador_db_old;"
sudo -u postgres psql -c "CREATE DATABASE procurador_db OWNER procurador_user;"
sudo -u postgres psql procurador_db < /tmp/restore.sql

# 3. Reiniciar API
pm2 restart procurador-api

# 4. Verificar health check
curl -sk https://api.procuradortool.com/health
```

### Caso 3 — Revertir migración específica

```bash
# Cada migración debe tener su script DOWN correspondiente
# Ejemplo: deshacer 20260522_add_ticket_priority.sql

ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94
sudo -u postgres psql procurador_db <<'EOF'
ALTER TABLE support_tickets
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS priority_source,
  DROP COLUMN IF EXISTS priority_notes,
  DROP COLUMN IF EXISTS priority_set_at,
  DROP COLUMN IF EXISTS priority_set_by;
DROP INDEX IF EXISTS idx_tickets_priority;
EOF
```

### Caso 4 — Restore completo desde DigitalOcean Snapshot

> ⚠️ Solo en caso de catástrofe total (servidor inaccesible o DB corrupta sin backup local)

1. Ir a https://cloud.digitalocean.com/droplets
2. Seleccionar la droplet del proyecto
3. Tab "Snapshots" → seleccionar el snapshot `pre-fase4-YYYYMMDD`
4. Click "Restore Droplet"
5. ⚠️ Esto **reinicia la droplet** y restaura **todo el estado** (DB + archivos + configuración)
6. Tiempo estimado: 5-10 minutos

### Caso 5 — Revertir versión Electron (usuarios)

Si una nueva versión de Electron rompe algo:

```powershell
# 1. Marcar la versión rota como pre-release en GitHub Releases (UI)
# 2. Eliminar latest.yml correspondiente para que auto-updater no la sirva
# 3. Bumpear a una nueva versión patch que sea idéntica a la previa estable
cd C:\Users\JONATHAN\source\repos\ProcuradorTool\electron-app
git checkout v2.7.5  # o la versión estable anterior
# editar package.json: version a 2.7.X+1
$env:GH_TOKEN = "..."
npm run release
```

---

## Verificación post-rollback

Después de cualquier rollback ejecutar:

```bash
# 1. Backend responde
curl -sk https://api.procuradortool.com/health

# 2. Login funciona
curl -sk -X POST https://api.procuradortool.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"procuradortool@gmail.com","password":"TestPass2025!","machineId":"TEST"}' | head -c 200

# 3. Cantidad de usuarios coincide con backup
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "sudo -u postgres psql procurador_db -c 'SELECT COUNT(*) FROM users;'"

# 4. Portal web carga
curl -sk -o /dev/null -w "%{http_code}\n" https://api.procuradortool.com/usuarios/

# 5. Logs sin errores fatales
ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94 \
  "pm2 logs procurador-api --lines 30 --nostream"
```

---

## Contactos de emergencia

- **Hosting**: DigitalOcean Support (dashboard → Help)
- **Dominio**: Cloudflare DNS (procuradortool.com)
- **SSL**: certbot (vence 2026-06-29) — `certbot renew` en el servidor
- **GitHub**: jberger19186 (cuenta del repo)

---

## Notas

- El backup de la DB se hizo **antes** de cualquier cambio de Fase 4 — refleja el estado de v2.7.5 + sección Ayuda en portal web.
- Las claves RSA del backup deben mantenerse offline y cifradas (contienen la clave privada de firma de scripts).
- El `.env` contiene `ANTHROPIC_API_KEY` y secrets de DB — **nunca subirlo a git ni compartirlo**.
- Después de Fase 4 completa, generar un nuevo punto de resguardo: `pre-fase5`.
