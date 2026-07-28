# Migraciones — estado real (leer antes de asumir que este directorio está completo)

**Este directorio NO refleja todas las migraciones aplicadas en producción.** La última migración
con archivo versionado acá es del 2026-06-24 (`20260624_commercial_benefits.sql`), pero CLAUDE.md
documenta varias más aplicadas después de esa fecha sin que su `.sql` haya quedado en el repo —
entre otras: `20260625_grant_privileges_procurador_user.sql`, `20260626_invoices_payment_id_unique.sql`,
`20260626b_invoices_updated_at.sql`, `20260627_grant_privileges_procurador_user.sql`,
`20260629_ticket_comments_edited_at.sql`, `20260701_admin_created_users.sql`,
`20260701_drop_check_plan_valid.sql`.

**No tiene sentido "recrear" retroactivamente esos archivos** — ya están aplicados en producción y
el snapshot de abajo ya las refleja. Recrearlos como si fueran a aplicarse de nuevo generaría
migraciones fantasma que nadie va a correr.

**La fuente de verdad es `database/schema.sql`** (`pg_dump --schema-only` contra `procurador_db`),
no la suma de los archivos de este directorio. Antes de diseñar una migración nueva, regenerarlo:

```bash
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
  "sudo -u postgres pg_dump --schema-only procurador_db" > database/schema.sql
```

Desde 2026-07-28 esto ya no depende de acordarse manualmente: el script de backup diario
(`backend-server/scripts/backup-db.js`, cron 03:00) genera este mismo snapshot automáticamente en
cada corrida (ver `docs/internal/revision-E5-2026-07-27.md`, hallazgo E5-2, y
`plan-correcciones-E1-E6-2026-07-27.md`, Bloque B.1 / Q5).

**A partir de ahora, sí:** toda migración nueva debe agregar su `.sql` versionado acá, con el mismo
criterio de nombrado (`YYYYMMDD_descripcion.sql`) que ya se usa desde mayo 2026.
