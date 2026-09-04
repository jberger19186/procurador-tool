-- ============================================================================
-- 20260903_execution_quota_at_start.sql
-- B.8 (fase E7) — el cupo lo cuenta el SERVIDOR al entregar el permiso de
-- ejecución, no cuando el cliente reporta "ejecuté con éxito".
--
-- Hasta hoy `POST /client/scripts/log-execution` era el único lugar que
-- descontaba cupo por subsistema, y lo hacía a partir de dos campos del cuerpo
-- del request (`success` y `subsystem`) que los manda la aplicación instalada
-- en la máquina del usuario. Un cliente modificado que no reporta, o que
-- reporta `success:false`, no consume cupo.
--
-- Estas 4 columnas son la infraestructura mínima para mover el descuento a
-- `POST /license/execution/start`:
--
--   active_executions.subsystem      qué subsistema resolvió el SERVIDOR a
--                                    partir del nombre del script (nunca del
--                                    cuerpo del request). NULL = el script no
--                                    consume cupo por subsistema, solo global.
--   active_executions.quota_counted  true = este permiso YA descontó cupo.
--                                    Es la única fuente de verdad para que
--                                    `log-execution` y `/monitor/log` no
--                                    vuelvan a descontar lo mismo.
--   active_executions.outcome        reservado. El diseño elegido borra la
--                                    fila en `execution/end` y deja el
--                                    historial en `usage_logs` (spec § B.8,
--                                    "recomendado borrar como hoy"), así que
--                                    hoy NADIE escribe esta columna. Se crea
--                                    porque la ficha la fija como parte del
--                                    esquema acordado y porque habilita, sin
--                                    otra migración, la variante de cierre
--                                    blando (marcar `ended_at` en vez de
--                                    borrar) si alguna vez se quiere historial
--                                    de permisos.
--   usage_logs.execution_id          correlaciona la bitácora con el permiso
--                                    que la habilitó. Sin FK a propósito: la
--                                    fila de `active_executions` se borra en
--                                    `end`, y una FK dejaría el log colgado o
--                                    forzaría un ON DELETE SET NULL que
--                                    borraría justamente el dato de auditoría.
--
-- IDEMPOTENTE: reaplicable sin efecto (todos los ADD COLUMN llevan IF NOT
-- EXISTS). ADITIVA: no altera ninguna columna ni fila existente.
--
-- `subsystem` va SIN NOT NULL a propósito: durante el deploy conviven filas
-- vivas creadas por el código anterior, que no tienen subsistema. Ponerle
-- NOT NULL abortaría la migración con locks vivos en la tabla.
-- ============================================================================

ALTER TABLE active_executions
  ADD COLUMN IF NOT EXISTS subsystem     VARCHAR(30),
  ADD COLUMN IF NOT EXISTS quota_counted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outcome       VARCHAR(20);

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS execution_id  INTEGER;

-- Sostiene la búsqueda de compatibilidad de `log-execution` para clientes
-- viejos (los que todavía no mandan `executionId`): "¿este usuario tiene un
-- permiso reciente para este script que YA descontó cupo?".
CREATE INDEX IF NOT EXISTS idx_active_executions_quota_lookup
  ON active_executions (user_id, script_name, quota_counted);

COMMENT ON COLUMN active_executions.subsystem IS
  'B.8/E7: subsistema resuelto por el servidor desde script_name (utils/subsystems.js). NULL = sin cupo por subsistema.';
COMMENT ON COLUMN active_executions.quota_counted IS
  'B.8/E7: true = el permiso ya descontó cupo en execution/start. Evita el doble conteo en log-execution y /monitor/log.';
COMMENT ON COLUMN active_executions.outcome IS
  'B.8/E7: reservado (hoy nadie lo escribe: execution/end borra la fila). Ver encabezado de la migración.';
COMMENT ON COLUMN usage_logs.execution_id IS
  'B.8/E7: id de active_executions que habilitó esta ejecución. Sin FK: la fila del permiso se borra al terminar.';
