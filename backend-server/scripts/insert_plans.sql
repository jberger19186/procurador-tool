SELECT setval(pg_get_serial_sequence('plans', 'id'), (SELECT MAX(id) FROM plans));

INSERT INTO plans (
    name, display_name, description, plan_type, price_usd,
    proc_executions_limit, informe_limit, monitor_partes_limit,
    monitor_novedades_limit, batch_executions_limit, extension_flows,
    promo_type
) VALUES
(
    'EXTENSION_PROMO',
    'Solo Extensión — Promo Lanzamiento',
    'Acceso completo a los 5 flujos de la extensión Chrome. Precio promocional de lanzamiento.',
    'extension', 1.00,
    0, 0, 0, 0, 0,
    '["consulta","escritos1","escritos2","notificaciones","deox"]'::jsonb,
    NULL
),
(
    'COMBO_PROMO',
    'Extensión + App Electron — Beta',
    'Extensión Chrome completa más aplicación Electron. Precio promocional versión Beta.',
    'combo', 9.99,
    50, 10, 3, 10, 20,
    '["consulta","escritos1","escritos2","notificaciones","deox"]'::jsonb,
    NULL
)
ON CONFLICT (name) DO NOTHING;

SELECT id, name, plan_type, price_usd FROM plans ORDER BY id;
