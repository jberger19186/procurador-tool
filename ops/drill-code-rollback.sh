#!/usr/bin/env bash
#
# drill-code-rollback.sh — Simulacro de rollback de la CAPA DE CODIGO sobre STAGING.
#
# Demuestra que un cambio de codigo roto en staging:
#   (a) tumba SOLO a staging, no a produccion (aislamiento de directorios)
#   (b) se revierte restaurando el archivo bueno + reiniciar
#
# SOLO toca el directorio de staging. Produccion (/var/www/procurador) no se modifica.
#
set -euo pipefail

STG_DIR="/var/www/procurador-staging/backend-server"
PRD_DIR="/var/www/procurador/backend-server"
TARGET="routes/client.js"   # archivo a romper/restaurar (no critico para el arranque)

code()  { curl -sk -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo "000"; }

echo "==================== SIMULACRO ROLLBACK — CAPA CODIGO ===================="
echo "Estado inicial:"
echo "    staging (3444): $(code https://localhost:3444/health) | prod (3443): $(code https://localhost:3443/health)"
echo ""

echo "[1] Respaldo del archivo bueno de staging ($TARGET)..."
cp -a "$STG_DIR/$TARGET" "/tmp/drill_$(basename $TARGET).good"
echo "    respaldado en /tmp/drill_$(basename $TARGET).good"
echo ""

echo "[2] ROTURA intencional: introducir error de sintaxis en staging/$TARGET..."
echo "this is not valid javascript @@@ }{" >> "$STG_DIR/$TARGET"
echo "    Verificando sintaxis: $(node --check "$STG_DIR/$TARGET" 2>&1 | head -1 || echo 'ERROR de sintaxis (esperado)')"
echo "    Reiniciando staging con el codigo roto..."
pm2 restart procurador-staging >/dev/null 2>&1 || true
sleep 4
ST_BROKEN=$(code https://localhost:3444/health)
PR_DURING=$(code https://localhost:3443/health)
echo "    staging tras la rotura: $ST_BROKEN (esperado 000/errores) | prod: $PR_DURING (debe seguir 200)"
echo ""

echo "[3] ROLLBACK de codigo: restaurar el archivo bueno + reiniciar (cronometrado)..."
T0=$(date +%s)
cp -a "/tmp/drill_$(basename $TARGET).good" "$STG_DIR/$TARGET"
pm2 restart procurador-staging >/dev/null 2>&1
sleep 4
T1=$(date +%s)
echo ""

echo "[4] Verificacion post-rollback:"
ST_REC=$(code https://localhost:3444/health)
PR_AFTER=$(code https://localhost:3443/health)
echo "    staging recuperado: $ST_REC (esperado 200) | prod: $PR_AFTER (esperado 200)"
echo ""

OK=1
[ "$PR_DURING" = "200" ] || { echo "    FALLO: produccion se afecto durante la rotura de staging!"; OK=0; }
[ "$ST_REC" = "200" ]    || { echo "    FALLO: staging no se recupero"; OK=0; }
[ "$PR_AFTER" = "200" ]  || { echo "    FALLO: produccion afectada tras el rollback"; OK=0; }

rm -f "/tmp/drill_$(basename $TARGET).good"
echo "  Tiempo de rollback de codigo: $((T1-T0)) segundos"
if [ "$OK" = "1" ]; then
  echo "  RESULTADO: EXITO — staging roto y recuperado; produccion nunca se afecto."
else
  echo "  RESULTADO: REVISAR — ver fallos arriba."
fi
echo "========================================================================"
