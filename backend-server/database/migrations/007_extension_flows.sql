-- =====================================================
-- MIGRACIÓN 007: FLUJOS DE EXTENSIÓN DE CHROME POR PLAN
-- =====================================================
-- Agrega columna extension_flows (JSONB) a la tabla plans.
-- Controla qué flujos de la extensión están disponibles
-- según el tier contratado.
-- Flujos disponibles: consulta | escritos1 | escritos2 | notificaciones | deox

ALTER TABLE plans ADD COLUMN IF NOT EXISTS extension_flows JSONB DEFAULT '[]'::jsonb;

-- Configuración inicial por plan
UPDATE plans SET extension_flows = '["consulta","escritos2"]'::jsonb              WHERE name = 'BASIC';
UPDATE plans SET extension_flows = '["consulta","escritos1","escritos2"]'::jsonb   WHERE name = 'PRO';
UPDATE plans SET extension_flows = '["consulta","escritos1","escritos2","notificaciones","deox"]'::jsonb
                                                                                   WHERE name = 'ENTERPRISE';

-- Índice GIN para consultas sobre el array JSONB (útil si se hacen filtros por flujo)
CREATE INDEX IF NOT EXISTS idx_plans_extension_flows ON plans USING GIN (extension_flows);

-- Verificar resultado
SELECT name, display_name, extension_flows FROM plans ORDER BY id;
