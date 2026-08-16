-- 20260815_bitacora_f3_3.sql
-- ═══════════════════════════════════════════════════════════════════════════
--  Bitácora — F3.3: sugerencias automáticas desde novedades del Monitor
-- ═══════════════════════════════════════════════════════════════════════════
-- Plan: docs/internal/propuesta-bitacora-agenda-2026-07.md §11 (F3.3)
--
-- 100% ADITIVA: crea 1 tabla nueva. NO modifica estructura ni datos de ninguna
-- tabla existente. Revertir = DROP de lo creado acá (ver rollback al final).
--
-- 🔒 NADA queda visible para ningún usuario al aplicarla: las sugerencias solo
--    se generan para usuarios cuyo plan tenga `bitacora_enabled = true`.
--
-- Idempotente (IF NOT EXISTS en todo) — se puede reaplicar sin efecto.
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ UNA TABLA Y NO UNA VISTA DERIVADA (la decisión de diseño del bloque)
-- ───────────────────────────────────────────────────────────────────────────
-- La lectura natural sería derivar la bandeja al vuelo:
--     "novedades del monitor (confirmado=false AND es_linea_base=false)
--      que todavía no son ficha en expedientes_seguidos"
-- y no persistir nada. Es incorrecto, y la razón está en el código real del
-- Monitor (verificado en routes/monitor.js, no asumido):
--
--   · POST /monitor/expedientes/:id/confirmar  → SET confirmado=true,
--                                                    es_linea_base=true
--   · POST /monitor/expedientes/:id/rechazar   → DELETE de la fila
--
-- Es decir: **el estado "novedad" es transitorio por diseño**. En cuanto el
-- usuario confirma la novedad desde la app (el flujo natural del Monitor, que
-- vive en otro subsistema), la fila se funde con la línea base y deja de ser
-- distinguible de un expediente que estuvo ahí desde el día uno. Una bandeja
-- derivada se vaciaría sola por una acción del usuario en OTRA pantalla, antes
-- de que llegara a abrir el portal. Por eso la sugerencia se persiste en el
-- momento de la detección, que es el único instante en que el evento existe.
--
-- ───────────────────────────────────────────────────────────────────────────
-- QUÉ SUGIERE, EXACTAMENTE (y por qué es más simple de lo que el plan temía)
-- ───────────────────────────────────────────────────────────────────────────
-- §11.1 anticipaba que lo difícil de F3.3 sería el matching
--     "¿qué movimiento del PJN merece un vencimiento? ¿con qué fecha?"
-- Ese problema NO existe acá: el Monitor de Partes no emite movimientos, emite
-- "apareció un expediente NUEVO en el que figura tu parte". Es un evento de
-- significado único y sin ninguna fecha que inferir. La sugerencia es siempre
-- la misma y no requiere heurística legal:
--     "El Monitor encontró un caso nuevo de <parte>. ¿Lo seguís en tu Bitácora?"
-- Aceptar = crear la ficha (expedientes_seguidos), opcionalmente con una
-- entrada de revisión. Descartar = no volver a ofrecerlo.
--
-- Esto NO duplica la bandeja de novedades que el Monitor ya tiene: esa responde
-- "¿este expediente es realmente de mi parte?" (mantenimiento de la línea base);
-- esta responde "¿lo quiero en mi agenda?". Son dos decisiones distintas sobre
-- el mismo evento, y un usuario puede querer una sin la otra.

BEGIN;

CREATE TABLE IF NOT EXISTS bitacora_sugerencias (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Origen del evento. Hoy solo 'monitor'; el CHECK se amplía si algún día
  -- otra fuente genera sugerencias (no inventar orígenes sin consumidor).
  origen                VARCHAR(20)  NOT NULL DEFAULT 'monitor',

  -- ON DELETE CASCADE es deliberado y semántico, no comodidad: si el usuario
  -- RECHAZA la novedad en el Monitor ("este expediente no es de mi parte"),
  -- `rechazar` borra la fila de monitor_expedientes y esta sugerencia deja de
  -- tener sentido — sugerir seguir un caso que el propio usuario declaró ajeno
  -- sería un bug de producto. Las sugerencias ya ACEPTADAS no corren riesgo:
  -- `rechazar` exige confirmado=false, y una novedad aceptada en Bitácora
  -- normalmente ya fue confirmada en el Monitor; y aunque se perdiera la fila
  -- de auditoría, la ficha real en expedientes_seguidos es independiente.
  monitor_expediente_id INTEGER      REFERENCES monitor_expedientes(id) ON DELETE CASCADE,

  -- Snapshot de lo que la bandeja necesita mostrar. Se copia en vez de
  -- resolverse por JOIN para que la lectura sea de una sola tabla y, sobre
  -- todo, para que `expediente_key` quede calculado UNA vez con la
  -- normalización canónica del servidor (utils/expedienteKey.js) — la misma
  -- que usa expedientes_seguidos, que es lo que hace posible el anti-join
  -- "no sugerir un caso que ya es ficha".
  expediente            VARCHAR(60)  NOT NULL,   -- como lo muestra el PJN: "FCR 13764/2025"
  expediente_key        VARCHAR(60)  NOT NULL,   -- normalizado: "fcr|13764|2025"
  caratula              TEXT,
  dependencia           TEXT,
  situacion             VARCHAR(200),
  nombre_parte          VARCHAR(255),
  jurisdiccion_sigla    VARCHAR(20),

  status                VARCHAR(15)  NOT NULL DEFAULT 'pendiente',

  -- Ficha creada al aceptar. SET NULL (no CASCADE): si el usuario después
  -- borra la ficha desde Mis Expedientes, la sugerencia sigue siendo un hecho
  -- histórico ("esto se sugirió y se aceptó"), no debe desaparecer con ella.
  expediente_id         INTEGER      REFERENCES expedientes_seguidos(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ  DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,

  CONSTRAINT bitacora_sugerencias_status_chk CHECK (status IN ('pendiente','aceptada','descartada')),
  CONSTRAINT bitacora_sugerencias_origen_chk CHECK (origen IN ('monitor'))
);

-- Una sola sugerencia VIVA por caso y usuario. Parcial a propósito: permite
-- que un caso descartado hoy vuelva a sugerirse si el Monitor lo redetecta
-- más adelante (p. ej. tras rechazarlo y que reaparezca), sin permitir dos
-- pendientes simultáneas del mismo expediente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sugerencias_pendiente_unica
  ON bitacora_sugerencias (user_id, expediente_key)
  WHERE status = 'pendiente';

-- Lectura de la bandeja: pendientes de un usuario, más recientes primero.
CREATE INDEX IF NOT EXISTS idx_sugerencias_user_status
  ON bitacora_sugerencias (user_id, status, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- Permisos para el usuario de la aplicación
-- ───────────────────────────────────────────────────────────────────────────
-- Mismo motivo que en F1.1: staging NO tiene ALTER DEFAULT PRIVILEGES para
-- SEQUENCE, así que sin el GRANT explícito el primer INSERT fallaría ahí con
-- "permission denied for sequence" (el bug de commercial_benefits_id_seq de
-- junio de 2026). También hace la migración autosuficiente en un entorno nuevo.
GRANT SELECT, INSERT, UPDATE, DELETE ON bitacora_sugerencias TO procurador_user;
GRANT USAGE, SELECT ON SEQUENCE bitacora_sugerencias_id_seq TO procurador_user;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
--  ROLLBACK (si hiciera falta revertir)
-- ═══════════════════════════════════════════════════════════════════════════
--  BEGIN;
--    DROP TABLE IF EXISTS bitacora_sugerencias;
--  COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
