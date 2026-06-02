# ops/ — Scripts operativos (backup y rollback)

Scripts de operación del servidor. Versionados en el repo y desplegados en
`/var/www/procurador/ops/` en el servidor de producción.

## Sistema de backups (estado actual)

| Backup | Cómo | Retención | Ubicación |
|---|---|---|---|
| **Diario automático** | cron 03:00 → `backend-server/scripts/backup-db.js` | 30 días | DO Spaces (externo) + local `/var/backups/procurador/` |
| **Pre-deploy on-demand** | `ops/backup-now.sh` | últimos 10 | local `/var/backups/procurador/predeploy/` |
| **Pre-restore (automático)** | lo crea `restore-db.sh` antes de restaurar | últimos 10 | local `/var/backups/procurador/predeploy/` |
| **Semanal a Desktop** | manual (procedimiento en CLAUDE.md) | — | PC del equipo (fuera del servidor) |

## Scripts

### `backup-now.sh [prod|staging]`
Backup local inmediato de la base indicada. Uso principal: **antes de promover un cambio a producción**.
Imprime la ruta del archivo en la última línea. Aborta si el backup sale sospechosamente pequeño.

### `restore-db.sh [prod|staging] <archivo.sql.gz> [--force]`
Restaura un backup sobre la base indicada (**rollback de la capa de datos**).
Red de seguridad: antes de restaurar, hace un backup de seguridad de la base destino.
Para `prod` exige confirmación tipeada (`RESTAURAR`). Recrea la base limpia y restaura el dump.

> ⚠️ Para restaurar producción, detené la app primero: `pm2 stop procurador-api`, restaurá, luego `pm2 start procurador-api`.

## Deploy de estos scripts al servidor

```powershell
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" ops/*.sh root@142.93.64.94:/var/www/procurador/ops/
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 "chmod +x /var/www/procurador/ops/*.sh"
```
