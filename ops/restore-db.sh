#!/usr/bin/env bash
#
# restore-db.sh — Restaura un backup .sql.gz sobre una base (rollback de la capa de DATOS).
#
# SEGURIDAD (red doble):
#   1. Antes de tocar nada, hace un backup de seguridad de la base destino
#      (por si el backup que se va a restaurar fuese el equivocado).
#   2. Para 'prod' exige confirmación tipeada.
#
# Estrategia: como los dumps son SQL plano (sin DROP), se recrea la base vacía
#   y se restaura encima. Preserva el owner actual de la base.
#
# Uso:   ./restore-db.sh [prod|staging] <archivo.sql.gz> [--force]
#        --force omite la confirmación (para uso desde otros scripts).
#
# IMPORTANTE: para 'prod', detené la app primero (pm2 stop procurador-api) para
#   evitar que reabra conexiones durante la restauración. El script termina las
#   conexiones activas igualmente, pero detener la app es lo más prolijo.
#
set -euo pipefail

ENV="${1:-}"
FILE="${2:-}"
FORCE="${3:-}"

case "$ENV" in
  prod)    DB="procurador_db" ;;
  staging) DB="procurador_db_staging" ;;
  *) echo "Uso: $0 [prod|staging] <archivo.sql.gz> [--force]"; exit 1 ;;
esac

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "ERROR: archivo de backup no encontrado: '$FILE'"; exit 1
fi

# Detectar el owner actual de la base destino (para recrearla igual).
OWNER=$(sudo -u postgres psql -tAc "SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname='$DB';")
if [ -z "$OWNER" ]; then
  echo "ERROR: la base '$DB' no existe. Abortando."; exit 1
fi
echo "[restore] Base destino: '$DB' (owner: $OWNER)"

# 1. Backup de seguridad de la base destino ANTES de tocar nada.
SAFEDIR="/var/backups/procurador/predeploy"
mkdir -p "$SAFEDIR"
SAFETY="$SAFEDIR/${ENV}_pre-restore_$(date +%Y%m%d_%H%M%S).sql.gz"
echo "[restore] Backup de seguridad de '$DB' → $SAFETY"
sudo -u postgres pg_dump "$DB" | gzip > "$SAFETY"
SS=$(stat -c%s "$SAFETY")
if [ "$SS" -lt 1000 ]; then echo "[restore] ERROR: backup de seguridad inválido. Abortando."; rm -f "$SAFETY"; exit 1; fi
echo "[restore] Backup de seguridad OK ($SS bytes)"

# 2. Confirmación (salvo --force).
if [ "$FORCE" != "--force" ]; then
  echo ""
  echo "  Vas a RESTAURAR:   $FILE"
  echo "  SOBRE la base:     $DB"
  echo "  Esto REEMPLAZA el contenido actual (ya respaldado en $SAFETY)."
  printf "  Escribí 'RESTAURAR' para confirmar: "
  read ANS
  if [ "$ANS" != "RESTAURAR" ]; then echo "Cancelado por el usuario."; exit 1; fi
fi

# 3. Terminar conexiones activas a la base destino.
echo "[restore] Terminando conexiones activas a '$DB'..."
sudo -u postgres psql -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid <> pg_backend_pid();" >/dev/null

# 4. Recrear la base vacía con el mismo owner.
echo "[restore] Recreando base '$DB' (vacía)..."
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\" OWNER \"$OWNER\";" >/dev/null

# 5. Restaurar el dump.
echo "[restore] Restaurando $FILE → '$DB'..."
gunzip -c "$FILE" | sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 >/dev/null

echo "[restore] ✅ Restauración completada."
echo "[restore] El estado PREVIO a esta restauración quedó respaldado en:"
echo "          $SAFETY"
echo "[restore] Recordá reiniciar la app si la detuviste (pm2 start/restart)."
