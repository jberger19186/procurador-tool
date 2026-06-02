#!/usr/bin/env bash
#
# drill-rollback.sh — Simulacro de recuperación ante desastre (DR drill) sobre STAGING.
#
# Prueba el rollback de la CAPA DE DATOS de forma verificable y segura:
#   1. Backup pre-deploy de staging
#   2. Corrupción intencional y verificable de los datos
#   3. Rollback con restore-db.sh (cronometrado)
#   4. Verificación de recuperación + confirmación de que producción no se tocó
#
# SOLO opera sobre staging. Aborta si se intenta contra producción.
#
set -euo pipefail

DB="procurador_db_staging"
PRD="procurador_db"
OPS="/var/www/procurador/ops"

q()  { sudo -u postgres psql -d "$1" -tAc "$2" 2>/dev/null | tr -d '[:space:]'; }

echo "==================== SIMULACRO ROLLBACK — CAPA DATOS ===================="
ORIG_USERS=$(q "$DB" "SELECT count(*) FROM users;")
PRD_USERS=$(q "$PRD" "SELECT count(*) FROM users;")
HAS_ADMIN=$(q "$DB" "SELECT count(*) FROM users WHERE email='admin@procurador.com';")
echo "Estado inicial:  staging users=$ORIG_USERS (admin@procurador.com presente: $HAS_ADMIN) | prod users=$PRD_USERS"
echo ""

echo "[1] Backup pre-deploy de staging..."
BK=$("$OPS/backup-now.sh" staging 2>/dev/null | tail -1)
echo "    -> $BK"
echo ""

echo "[2] CORRUPCION intencional: reemplazar todos los emails por 'CORRUPTED_<id>'..."
sudo -u postgres psql -d "$DB" -c "UPDATE users SET email = 'CORRUPTED_' || id;" >/dev/null
CORRUPT_ADMIN=$(q "$DB" "SELECT count(*) FROM users WHERE email='admin@procurador.com';")
CORRUPT_MARK=$(q "$DB" "SELECT count(*) FROM users WHERE email LIKE 'CORRUPTED_%';")
echo "    Tras la corrupcion: admin@procurador.com presente=$CORRUPT_ADMIN | emails CORRUPTED_*=$CORRUPT_MARK"
if [ "$CORRUPT_ADMIN" != "0" ]; then echo "    ERROR: la corrupcion no surtio efecto. Abortando."; exit 1; fi
echo "    Desastre confirmado (datos reales destruidos)."
echo ""

echo "[3] ROLLBACK con restore-db.sh (cronometrado)..."
T0=$(date +%s)
"$OPS/restore-db.sh" staging "$BK" --force >/tmp/drill_restore.log 2>&1
T1=$(date +%s)
grep -E 'Backup de seguridad OK|Restauracion completada|completada' /tmp/drill_restore.log | sed 's/^/    /'
echo ""

echo "[4] Verificacion post-rollback:"
REC_USERS=$(q "$DB" "SELECT count(*) FROM users;")
REC_ADMIN=$(q "$DB" "SELECT count(*) FROM users WHERE email='admin@procurador.com';")
REC_CORRUPT=$(q "$DB" "SELECT count(*) FROM users WHERE email LIKE 'CORRUPTED_%';")
PRD_AFTER=$(q "$PRD" "SELECT count(*) FROM users;")
echo "    staging users=$REC_USERS | admin@procurador.com recuperado=$REC_ADMIN | emails CORRUPTED_* restantes=$REC_CORRUPT"
echo "    prod users (debe seguir intacto)=$PRD_AFTER"
echo ""

OK=1
[ "$REC_USERS" = "$ORIG_USERS" ] || { echo "    FALLO: el conteo no coincide ($REC_USERS != $ORIG_USERS)"; OK=0; }
[ "$REC_ADMIN" = "1" ]          || { echo "    FALLO: admin no recuperado"; OK=0; }
[ "$REC_CORRUPT" = "0" ]        || { echo "    FALLO: quedan emails corruptos"; OK=0; }
[ "$PRD_AFTER" = "$PRD_USERS" ] || { echo "    FALLO: produccion fue afectada!"; OK=0; }

echo "  Tiempo de rollback de datos: $((T1-T0)) segundos"
if [ "$OK" = "1" ]; then
  echo "  RESULTADO: EXITO — datos recuperados al 100%, produccion intacta."
else
  echo "  RESULTADO: REVISAR — ver fallos arriba."
fi
echo "========================================================================"
