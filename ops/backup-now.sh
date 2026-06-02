#!/usr/bin/env bash
#
# backup-now.sh — Backup on-demand de una base (uso principal: ANTES de un deploy a producción).
#
# Complementa al backup diario automático (backend-server/scripts/backup-db.js → DO Spaces).
# Este es un respaldo LOCAL e inmediato, pensado como red de seguridad pre-deploy.
#
# Uso:   ./backup-now.sh [prod|staging]   (default: prod)
# Salida: imprime la ruta del archivo creado en la última línea (para usar en scripts).
#
set -euo pipefail

ENV="${1:-prod}"
case "$ENV" in
  prod)    DB="procurador_db" ;;
  staging) DB="procurador_db_staging" ;;
  *) echo "Uso: $0 [prod|staging]"; exit 1 ;;
esac

DIR="/var/backups/procurador/predeploy"
mkdir -p "$DIR"
TS=$(date +%Y%m%d_%H%M%S)
FILE="$DIR/${ENV}_predeploy_${TS}.sql.gz"

echo "[backup-now] Respaldando '$DB' → $FILE"
sudo -u postgres pg_dump "$DB" | gzip > "$FILE"

# Guarda de integridad: un backup válido nunca pesa unos pocos bytes.
SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 1000 ]; then
  echo "[backup-now] ERROR: backup sospechosamente pequeño ($SIZE bytes). Abortando y borrando."
  rm -f "$FILE"
  exit 1
fi
echo "[backup-now] OK ($SIZE bytes)"

# Rotación: conservar solo los últimos 10 backups pre-deploy de este entorno.
ls -1t "$DIR/${ENV}_predeploy_"*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
echo "[backup-now] Rotación OK (se conservan los últimos 10 de '$ENV')"

# Última línea = ruta del archivo (para encadenar con deploy-prod).
echo "$FILE"
