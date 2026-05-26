#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-db.sh — Backup automático de procurador_db
# Ejecutado por cron diariamente a las 03:00 AM
# Guarda en /var/backups/procurador/ con retención de 7 días
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuración ─────────────────────────────────────────────────────────────
DB_NAME="procurador_db"
DB_USER="procurador_user"
BACKUP_DIR="/var/backups/procurador"
RETENTION_DAYS=7
LOG_FILE="/var/log/procurador-backup.log"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/procurador_db_${TIMESTAMP}.sql.gz"

# Alertas por email (usa sendmail del sistema si está disponible)
ALERT_EMAIL="procuradortool@gmail.com"

# ── Funciones ─────────────────────────────────────────────────────────────────
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

send_alert() {
    local subject="$1"
    local body="$2"
    if command -v sendmail &>/dev/null; then
        echo -e "Subject: $subject\nFrom: soporte@procuradortool.com\nTo: $ALERT_EMAIL\n\n$body" \
            | sendmail -f soporte@procuradortool.com "$ALERT_EMAIL" 2>/dev/null || true
    fi
    log "ALERTA: $subject"
}

# ── Main ──────────────────────────────────────────────────────────────────────
log "━━━ Iniciando backup: $DB_NAME ━━━"

# Crear directorio si no existe
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Ejecutar pg_dump y comprimir
if sudo -u postgres pg_dump "$DB_NAME" | gzip > "$BACKUP_FILE"; then
    SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
    log "✅ Backup completado: $(basename $BACKUP_FILE) ($SIZE)"
else
    send_alert "[Procurador] ❌ Backup fallido $(date '+%Y-%m-%d')" \
        "El backup de $DB_NAME falló a las $(date). Revisar el servidor."
    log "❌ ERROR: pg_dump falló"
    exit 1
fi

# Verificar que el archivo no esté vacío (mínimo 10 KB)
MIN_SIZE=10240
ACTUAL_SIZE=$(stat -c%s "$BACKUP_FILE")
if [ "$ACTUAL_SIZE" -lt "$MIN_SIZE" ]; then
    send_alert "[Procurador] ⚠️ Backup sospechosamente pequeño $(date '+%Y-%m-%d')" \
        "El backup de $DB_NAME pesa solo ${ACTUAL_SIZE} bytes. Verificar integridad."
    log "⚠️ WARNING: backup inusualmente pequeño (${ACTUAL_SIZE} bytes)"
fi

# Rotar backups: borrar archivos con más de RETENTION_DAYS días
DELETED=$(find "$BACKUP_DIR" -name "procurador_db_*.sql.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
    log "🗑️  Eliminados $DELETED backup(s) con más de ${RETENTION_DAYS} días"
fi

# Listar backups actuales
COUNT=$(find "$BACKUP_DIR" -name "procurador_db_*.sql.gz" | wc -l)
log "📦 Backups disponibles en ${BACKUP_DIR}: $COUNT archivo(s)"

log "━━━ Backup finalizado OK ━━━"
exit 0
