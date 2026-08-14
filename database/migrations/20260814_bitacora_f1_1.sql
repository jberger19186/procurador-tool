-- 20260814_bitacora_f1_1.sql
-- ═══════════════════════════════════════════════════════════════════════════
--  Bitácora — F1.1: fundación del modelo de datos
-- ═══════════════════════════════════════════════════════════════════════════
-- Plan: docs/internal/propuesta-bitacora-agenda-2026-07.md §7 y §11 (F1.1)
-- Decisiones aplicadas: D1 (clave normalizada), D2/Q6 (ventana de export de 90
-- días), D3 (sin tope de casos), D4 (alcance del seed de feriados).
--
-- 100% ADITIVA: crea 4 tablas nuevas y agrega 4 columnas. NO modifica ni la
-- estructura ni los datos de ninguna tabla existente. Revertir = DROP de lo
-- creado acá (ver el bloque de rollback al final).
--
-- 🔒 NADA queda visible para ningún usuario al aplicarla: `plans.bitacora_enabled`
--    nace en FALSE para todos los planes. El módulo se enciende recién cuando un
--    admin marca el flag en un plan.
--
-- Idempotente (IF NOT EXISTS en todo) — se puede reaplicar sin efecto.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Ficha del caso seguido
-- ───────────────────────────────────────────────────────────────────────────
-- `expediente`      = tal como lo vio el usuario/PJN, para MOSTRAR ("FCR 018745/2017")
-- `expediente_key`  = normalizado, para DEDUPLICAR          ("fcr|18745|2017")
--
-- La clave única va sobre `expediente_key` y NO incluye `jurisdiccion`:
--   · Sería redundante: la sigla de jurisdicción ya es el primer token de la
--     clave (tokenizar("FCR 018745/2017") = "fcr|18745|2017").
--   · Sería peligrosa: `jurisdiccion` llega como texto libre y con distinta
--     forma según el origen (el PJN manda "Justicia Federal de Comodoro
--     Rivadavia"; el usuario tipea "FCR"), así que el MISMO caso cargado por
--     los dos caminos generaría DOS fichas.
-- La clave la calcula backend-server/utils/expedienteKey.js (canónica).
CREATE TABLE IF NOT EXISTS expedientes_seguidos (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expediente       VARCHAR(60)  NOT NULL,
  expediente_key   VARCHAR(60)  NOT NULL,
  jurisdiccion     VARCHAR(100),
  dependencia      VARCHAR(200),
  caratula         VARCHAR(300),
  situacion_actual VARCHAR(200),
  situacion_fecha  DATE,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT expedientes_seguidos_user_key_uniq UNIQUE (user_id, expediente_key)
);

COMMENT ON COLUMN expedientes_seguidos.expediente     IS 'Identificador tal como se muestra al usuario (forma original del PJN o tipeada)';
COMMENT ON COLUMN expedientes_seguidos.expediente_key IS 'Clave normalizada para deduplicar. La calcula backend-server/utils/expedienteKey.js — NO escribir a mano';
COMMENT ON COLUMN expedientes_seguidos.jurisdiccion   IS 'Descriptivo. NO forma parte de la clave única (la sigla ya viaja dentro de expediente_key)';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Historial acotado del caso: hasta 2 procuraciones + 2 informes
-- ───────────────────────────────────────────────────────────────────────────
-- El recorte (borrar el más viejo del mismo kind) va en la MISMA transacción
-- del INSERT, con una sentencia atómica — si no, dos capturas simultáneas del
-- mismo caso dejan 3+ filas y se rompe la invariante de máx. 4 por caso sobre
-- la que se apoya el dimensionamiento (§10). Ver hallazgo H4 del plan.
CREATE TABLE IF NOT EXISTS expediente_snapshots (
  id             SERIAL PRIMARY KEY,
  expediente_id  INTEGER NOT NULL REFERENCES expedientes_seguidos(id) ON DELETE CASCADE,
  kind           VARCHAR(15) NOT NULL,
  run_date       DATE NOT NULL,
  situacion      VARCHAR(200),
  data           JSONB NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT expediente_snapshots_kind_chk CHECK (kind IN ('procuracion', 'informe'))
);

COMMENT ON TABLE expediente_snapshots IS 'Máx. 2 filas por (expediente_id, kind) — el recorte lo hace el endpoint en la misma transacción del insert';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Entradas de bitácora (vencimientos, audiencias, tareas, gestiones, notas)
-- ───────────────────────────────────────────────────────────────────────────
-- expediente_id es NULLABLE y ON DELETE SET NULL a propósito: al borrar la ficha
-- de un caso, sus entradas quedan "sueltas" en vez de desaparecer. Si el usuario
-- elige "eliminar también las entradas", la app las borra explícitamente antes.
CREATE TABLE IF NOT EXISTS bitacora_entries (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expediente_id  INTEGER REFERENCES expedientes_seguidos(id) ON DELETE SET NULL,
  kind           VARCHAR(20) NOT NULL,
  title          VARCHAR(300) NOT NULL,
  description    TEXT,
  due_at         TIMESTAMPTZ,
  all_day        BOOLEAN DEFAULT true,
  done_at        TIMESTAMPTZ,
  repeat_rule    VARCHAR(20),
  meta           JSONB,
  source         VARCHAR(20) DEFAULT 'manual',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bitacora_entries_kind_chk CHECK (kind IN ('vencimiento','audiencia','tarea','gestion','nota')),
  CONSTRAINT bitacora_entries_source_chk CHECK (source IN ('manual','visor_procuracion','visor_informe')),
  CONSTRAINT bitacora_entries_repeat_chk CHECK (repeat_rule IS NULL OR repeat_rule IN ('weekly','monthly','yearly'))
);

COMMENT ON COLUMN bitacora_entries.done_at IS 'NULL = pendiente. Con valor = confirmada la realización (el check del banner de avisos)';
COMMENT ON COLUMN bitacora_entries.due_at  IS 'NULL = tarea/gestión sin fecha, o nota';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Feriados / inhábiles — insumo de la calculadora de plazos
-- ───────────────────────────────────────────────────────────────────────────
-- Config GLOBAL del sistema (no por usuario). La mantiene el admin desde el
-- dashboard (F1.8). El seed de abajo cubre hasta fin de 2027.
CREATE TABLE IF NOT EXISTS feriados (
  id      SERIAL PRIMARY KEY,
  fecha   DATE NOT NULL UNIQUE,
  motivo  VARCHAR(200)
);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Índices (4, no 5 — ver nota)
-- ───────────────────────────────────────────────────────────────────────────
-- Se crean junto con las tablas y no después: con 3 usuarios no se nota, pero
-- es exactamente el descuido que la revisión E3-4 encontró en `subscriptions`
-- (6 crons diarios filtrando por 4 columnas de fecha sin un solo índice).
--
-- NO se crea `idx_exp_seguidos_user ON expedientes_seguidos (user_id)`: la
-- constraint UNIQUE (user_id, expediente_key) ya crea un índice cuya primera
-- columna es user_id, así que las consultas "todos los casos de este usuario"
-- ya están cubiertas. Agregarlo sería duplicar el mismo trabajo.
CREATE INDEX IF NOT EXISTS idx_bitacora_user_due
  ON bitacora_entries (user_id, due_at);

-- Parcial: el banner de avisos (vencidos sin confirmar + próximos) solo mira
-- las pendientes, que son una fracción del total con el tiempo.
CREATE INDEX IF NOT EXISTS idx_bitacora_pendientes
  ON bitacora_entries (user_id, due_at) WHERE done_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bitacora_expediente
  ON bitacora_entries (expediente_id);

-- Sostiene además el DELETE del recorte 2+2 (ORDER BY created_at DESC LIMIT 1).
CREATE INDEX IF NOT EXISTS idx_snapshots_exp_kind
  ON expediente_snapshots (expediente_id, kind, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Columnas additivas sobre tablas existentes
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ FALSE para todos los planes: es el interruptor maestro. Aunque todo el
--    código esté desplegado, ningún usuario ve la Bitácora hasta que un admin
--    encienda el flag en algún plan.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS bitacora_enabled BOOLEAN DEFAULT false;

-- 'plan' preserva el comportamiento actual para todos los usuarios existentes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_section VARCHAR(20) DEFAULT 'plan';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bitacora_prefs JSONB;

-- Decisión D2/Q6: sostiene la ventana de 90 días de exportación después de
-- perder el plan. NULL mientras el plan incluye Bitácora; se estampa al perder
-- el flag; se limpia si vuelve a un plan que la incluya.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bitacora_lost_access_at TIMESTAMPTZ;

COMMENT ON COLUMN plans.bitacora_enabled          IS 'Gate por plan. FALSE por defecto — el módulo se enciende plan por plan desde el dashboard admin';
COMMENT ON COLUMN users.home_section              IS 'Pantalla de inicio del portal: plan | bitacora. Validar contra bitacora_enabled en el punto de uso';
COMMENT ON COLUMN users.bitacora_lost_access_at   IS 'Momento en que perdió el flag de Bitácora. Sostiene la ventana de exportación de 90 días (D2/Q6)';

-- Postgres no tiene ADD CONSTRAINT IF NOT EXISTS, así que se envuelve para que
-- la migración siga siendo reaplicable sin error.
-- (Se valida contra las filas existentes sin riesgo: todas quedan en 'plan' por
--  el DEFAULT de la columna recién agregada.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_home_section_chk'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_home_section_chk
      CHECK (home_section IN ('plan','bitacora'));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Permisos para el usuario de la aplicación
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ NO es redundante aunque exista ALTER DEFAULT PRIVILEGES. Verificado el
--    2026-08-14: producción tiene privilegios por defecto para TABLE y SEQUENCE,
--    pero STAGING solo para TABLE. Como las 4 tablas usan SERIAL (y por lo tanto
--    crean secuencias), sin este GRANT explícito la app fallaría en staging con
--    "permission denied for sequence" en el primer INSERT — que es exactamente
--    el bug que ya ocurrió con commercial_benefits_id_seq en junio de 2026.
--    Estos GRANT también hacen la migración autosuficiente si algún día se
--    restaura en un entorno nuevo.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  expedientes_seguidos, expediente_snapshots, bitacora_entries, feriados
  TO procurador_user;

GRANT USAGE, SELECT ON SEQUENCE
  expedientes_seguidos_id_seq, expediente_snapshots_id_seq,
  bitacora_entries_id_seq, feriados_id_seq
  TO procurador_user;

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Seed de feriados — resto de 2026 + todo 2027 (decisión D4)
-- ───────────────────────────────────────────────────────────────────────────
-- Alcance: feriados nacionales de Argentina + ferias judiciales (enero completo
-- y la de invierno). Se cargó "resto de 2026" y no el año completo porque esta
-- migración se aplica en agosto de 2026 — cargar enero-julio 2026 sería ruido.
-- El mantenimiento año a año lo hace el admin desde el ABM (F1.8).
--
-- ON CONFLICT DO NOTHING: reaplicar la migración no duplica ni pisa ediciones
-- que el admin haya hecho sobre una fecha ya cargada.
INSERT INTO feriados (fecha, motivo) VALUES
  -- ── Resto de 2026 ────────────────────────────────────────────────────────
  ('2026-08-17', 'Paso a la Inmortalidad del Gral. José de San Martín'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2026-11-23', 'Día de la Soberanía Nacional'),
  ('2026-12-08', 'Inmaculada Concepción de María'),
  ('2026-12-25', 'Navidad'),
  -- ── Feria judicial de verano 2027 (enero completo) ───────────────────────
  ('2027-01-01', 'Año Nuevo — feria judicial de enero'),
  ('2027-01-02', 'Feria judicial de enero'), ('2027-01-03', 'Feria judicial de enero'),
  ('2027-01-04', 'Feria judicial de enero'), ('2027-01-05', 'Feria judicial de enero'),
  ('2027-01-06', 'Feria judicial de enero'), ('2027-01-07', 'Feria judicial de enero'),
  ('2027-01-08', 'Feria judicial de enero'), ('2027-01-09', 'Feria judicial de enero'),
  ('2027-01-10', 'Feria judicial de enero'), ('2027-01-11', 'Feria judicial de enero'),
  ('2027-01-12', 'Feria judicial de enero'), ('2027-01-13', 'Feria judicial de enero'),
  ('2027-01-14', 'Feria judicial de enero'), ('2027-01-15', 'Feria judicial de enero'),
  ('2027-01-16', 'Feria judicial de enero'), ('2027-01-17', 'Feria judicial de enero'),
  ('2027-01-18', 'Feria judicial de enero'), ('2027-01-19', 'Feria judicial de enero'),
  ('2027-01-20', 'Feria judicial de enero'), ('2027-01-21', 'Feria judicial de enero'),
  ('2027-01-22', 'Feria judicial de enero'), ('2027-01-23', 'Feria judicial de enero'),
  ('2027-01-24', 'Feria judicial de enero'), ('2027-01-25', 'Feria judicial de enero'),
  ('2027-01-26', 'Feria judicial de enero'), ('2027-01-27', 'Feria judicial de enero'),
  ('2027-01-28', 'Feria judicial de enero'), ('2027-01-29', 'Feria judicial de enero'),
  ('2027-01-30', 'Feria judicial de enero'), ('2027-01-31', 'Feria judicial de enero'),
  -- ── Feriados nacionales 2027 ─────────────────────────────────────────────
  ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'),
  ('2027-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'),
  ('2027-03-25', 'Jueves Santo'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'),
  ('2027-05-01', 'Día del Trabajador'),
  ('2027-05-25', 'Día de la Revolución de Mayo'),
  ('2027-06-17', 'Paso a la Inmortalidad del Gral. Martín Miguel de Güemes'),
  ('2027-06-20', 'Paso a la Inmortalidad del Gral. Manuel Belgrano'),
  ('2027-07-09', 'Día de la Independencia'),
  ('2027-08-17', 'Paso a la Inmortalidad del Gral. José de San Martín'),
  ('2027-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2027-11-22', 'Día de la Soberanía Nacional'),
  ('2027-12-08', 'Inmaculada Concepción de María'),
  ('2027-12-25', 'Navidad')
ON CONFLICT (fecha) DO NOTHING;

-- ⚠️ La feria judicial de invierno (julio) NO se cargó: su fecha exacta la fija
--    la CSJN/cada cámara cada año por acordada y no es predecible. El admin la
--    carga desde el ABM (F1.8) cuando se publica. La calculadora de plazos
--    muestra el disclaimer "verificá el plazo" junto al resultado (§12, riesgo 5).

-- ═══════════════════════════════════════════════════════════════════════════
--  ROLLBACK (si hiciera falta revertir)
-- ═══════════════════════════════════════════════════════════════════════════
--  BEGIN;
--    DROP TABLE IF EXISTS expediente_snapshots;   -- FK a expedientes_seguidos
--    DROP TABLE IF EXISTS bitacora_entries;       -- FK a expedientes_seguidos
--    DROP TABLE IF EXISTS expedientes_seguidos;
--    DROP TABLE IF EXISTS feriados;
--    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_home_section_chk;
--    ALTER TABLE users DROP COLUMN IF EXISTS bitacora_lost_access_at;
--    ALTER TABLE users DROP COLUMN IF EXISTS bitacora_prefs;
--    ALTER TABLE users DROP COLUMN IF EXISTS home_section;
--    ALTER TABLE plans DROP COLUMN IF EXISTS bitacora_enabled;
--  COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
