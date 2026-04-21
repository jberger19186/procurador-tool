-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 003: Sistema de Monitoreo de Expedientes por Parte
-- ─────────────────────────────────────────────────────────────────────────────

-- Partes configuradas por usuario para monitoreo
CREATE TABLE IF NOT EXISTS monitor_partes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    nombre_parte VARCHAR(255) NOT NULL,
    jurisdiccion_codigo VARCHAR(5) NOT NULL,       -- código numérico SCW ('0'-'27')
    jurisdiccion_sigla VARCHAR(10) NOT NULL,        -- sigla legible (ej: 'FCR')
    tiene_linea_base BOOLEAN DEFAULT FALSE,         -- false = pendiente consulta inicial
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_ultima_modificacion TIMESTAMP DEFAULT NOW(),
    fecha_proxima_modificacion TIMESTAMP,           -- NOW() + 30 días al confirmar
    UNIQUE(user_id, nombre_parte, jurisdiccion_codigo)
);

-- Expedientes detectados: línea base (confirmados) + novedades (pendientes)
CREATE TABLE IF NOT EXISTS monitor_expedientes (
    id SERIAL PRIMARY KEY,
    parte_id INTEGER REFERENCES monitor_partes(id) ON DELETE CASCADE,
    numero_expediente VARCHAR(255) NOT NULL,
    caratula TEXT,
    dependencia TEXT,
    situacion VARCHAR(255),
    ultima_actuacion VARCHAR(50),
    es_linea_base BOOLEAN DEFAULT FALSE,            -- true = cargado en consulta inicial
    fecha_primera_deteccion TIMESTAMP DEFAULT NOW(),
    fecha_confirmacion TIMESTAMP,
    confirmado BOOLEAN DEFAULT FALSE,               -- novedades: false hasta que el usuario confirme
    metadata_json JSONB,
    UNIQUE(parte_id, numero_expediente)
);

-- Log de cada ejecución de monitoreo (inicial o novedades)
CREATE TABLE IF NOT EXISTS monitor_consultas_log (
    id SERIAL PRIMARY KEY,
    parte_id INTEGER REFERENCES monitor_partes(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id),
    modo VARCHAR(20),                               -- 'inicial' o 'novedades'
    fecha_ejecucion TIMESTAMP DEFAULT NOW(),
    total_encontrados INTEGER DEFAULT 0,
    nuevos_detectados INTEGER DEFAULT 0,
    tiempo_ejecucion_ms INTEGER,
    error TEXT
);

-- Índices de búsqueda frecuente
CREATE INDEX IF NOT EXISTS idx_monitor_partes_user   ON monitor_partes(user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_partes_activo ON monitor_partes(user_id, activo);
CREATE INDEX IF NOT EXISTS idx_monitor_exp_parte     ON monitor_expedientes(parte_id);
CREATE INDEX IF NOT EXISTS idx_monitor_exp_confirmado ON monitor_expedientes(parte_id, confirmado);
CREATE INDEX IF NOT EXISTS idx_monitor_log_user      ON monitor_consultas_log(user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_log_parte     ON monitor_consultas_log(parte_id);
