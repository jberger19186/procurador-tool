// utils/dbIntegrityChecks.js — compartido entre scripts/health-check.js (Fase 1, corre
// solo vía crontab) y routes/admin.js::run-api (Fase 2, corre desde el CI y la tarjeta
// del dashboard) — para no mantener la misma lista de relaciones críticas en 2 lugares
// que se desincronizan con el tiempo.
//
// Las 4 relaciones se verifican por LEFT JOIN (no `information_schema`): esto prueba
// el estado REAL de los datos, no solo que la constraint de FK exista en el schema —
// un check contra information_schema pasaría igual si alguien insertó filas huérfanas
// con una constraint temporalmente deshabilitada (DISABLE TRIGGER, restore parcial, etc.).

const RELACIONES_CRITICAS = [
    { nombre: 'subscriptions.user_id → users', sql: `SELECT count(*) FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE s.user_id IS NOT NULL AND u.id IS NULL` },
    { nombre: 'payments.subscription_id → subscriptions', sql: `SELECT count(*) FROM payments p LEFT JOIN subscriptions s ON s.id = p.subscription_id WHERE p.subscription_id IS NOT NULL AND s.id IS NULL` },
    { nombre: 'invoices.payment_id → payments', sql: `SELECT count(*) FROM invoices i LEFT JOIN payments p ON p.id = i.payment_id WHERE i.payment_id IS NOT NULL AND p.id IS NULL` },
    { nombre: 'monitor_partes.user_id → users', sql: `SELECT count(*) FROM monitor_partes m LEFT JOIN users u ON u.id = m.user_id WHERE m.user_id IS NOT NULL AND u.id IS NULL` },
];

/**
 * @param {import('pg').Pool} db
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function checkIntegridadReferencial(db) {
    const problemas = [];
    for (const r of RELACIONES_CRITICAS) {
        const res = await db.query(r.sql);
        const n = parseInt(res.rows[0].count, 10);
        if (n > 0) problemas.push(`${r.nombre}: ${n} huérfano(s)`);
    }
    if (problemas.length > 0) return { ok: false, message: problemas.join(' · ') };
    return { ok: true, message: '0 huérfanos en las 4 relaciones' };
}

module.exports = { checkIntegridadReferencial, RELACIONES_CRITICAS };
