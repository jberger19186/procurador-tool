/**
 * backup-db.js — Backup automático de PostgreSQL a DigitalOcean Spaces
 *
 * Qué hace:
 *   1. Ejecuta pg_dump y comprime el resultado
 *   2. Sube el archivo a DO Spaces (S3-compatible)
 *   3. Elimina backups en Spaces con más de 30 días
 *   4. Elimina archivos locales temporales
 *   5. (Bloque B.1/Q5, 2026-07-28) Regenera database/schema.sql y sube una copia
 *      "schema-latest" a Spaces — solo cuando corre contra procurador_db (prod).
 *      Antes había que acordarse de correr `pg_dump --schema-only` a mano cada vez
 *      que se auditaba o migraba la DB; el archivo llegó a tener ~2 meses de drift
 *      (ver docs/internal/revision-E5-2026-07-27.md, hallazgo E5-2). Con esto el
 *      snapshot se mantiene solo — igual hay que traerlo al repo con `scp` cuando
 *      se lo necesite (el servidor no es un checkout git), pero ya no depende de
 *      que alguien se acuerde de correr el pg_dump manualmente.
 *
 * Uso manual:   node backup-db.js
 * Cron diario:  0 3 * * * node /ruta/backup-db.js >> /var/log/procurador/backup.log 2>&1
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { exec }  = require('child_process');
const fs        = require('fs');
const path      = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);

const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// ── Configuración ───────────────────────────────────────────
const DB_USER     = process.env.DB_USER     || 'procurador_user';
const DB_HOST     = process.env.DB_HOST     || 'localhost';
const DB_NAME     = process.env.DB_NAME     || 'procurador_db';
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_PORT     = process.env.DB_PORT     || '5432';

const SPACES_KEY      = process.env.DO_SPACES_KEY;
const SPACES_SECRET   = process.env.DO_SPACES_SECRET;
const SPACES_BUCKET   = process.env.DO_SPACES_BUCKET   || 'procurador-backups';
const SPACES_REGION   = process.env.DO_SPACES_REGION   || 'nyc3';
const SPACES_ENDPOINT = process.env.DO_SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com';

const RETENTION_DAYS = 30;
const TMP_DIR = '/tmp';

// ── Cliente S3 (DO Spaces) ──────────────────────────────────
const s3 = new S3Client({
    endpoint: SPACES_ENDPOINT,
    region: SPACES_REGION,
    credentials: {
        accessKeyId: SPACES_KEY,
        secretAccessKey: SPACES_SECRET
    },
    forcePathStyle: false
});

// ── Helpers ─────────────────────────────────────────────────
function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ── Main ─────────────────────────────────────────────────────
async function runBackup() {
    const timestamp  = getTimestamp();
    const filename   = `backup_${DB_NAME}_${timestamp}.sql.gz`;
    const localPath  = path.join(TMP_DIR, filename);

    log(`🚀 Iniciando backup de ${DB_NAME}...`);

    // 1. pg_dump + gzip
    const pgDumpCmd = `PGPASSWORD="${DB_PASSWORD}" pg_dump -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} ${DB_NAME} | gzip > ${localPath}`;
    try {
        await execAsync(pgDumpCmd);
        const sizeKB = Math.round(fs.statSync(localPath).size / 1024);
        log(`✅ pg_dump completado: ${filename} (${sizeKB} KB)`);
    } catch (err) {
        log(`❌ Error en pg_dump: ${err.message}`);
        process.exit(1);
    }

    // 2. Subir a DO Spaces
    const key = `backups/${filename}`;
    try {
        const fileStream = fs.createReadStream(localPath);
        await s3.send(new PutObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: key,
            Body: fileStream,
            ContentType: 'application/gzip'
        }));
        log(`☁️  Subido a Spaces: ${SPACES_BUCKET}/${key}`);
    } catch (err) {
        log(`❌ Error subiendo a Spaces: ${err.message}`);
        fs.unlinkSync(localPath);
        process.exit(1);
    }

    // 3. Limpiar archivo local
    fs.unlinkSync(localPath);
    log(`🗑️  Archivo local eliminado: ${localPath}`);

    // 4. Eliminar backups viejos (> RETENTION_DAYS días)
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

        const listed = await s3.send(new ListObjectsV2Command({
            Bucket: SPACES_BUCKET,
            Prefix: 'backups/'
        }));

        const toDelete = (listed.Contents || []).filter(obj => new Date(obj.LastModified) < cutoff);

        for (const obj of toDelete) {
            await s3.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: obj.Key }));
            log(`🗑️  Backup antiguo eliminado: ${obj.Key}`);
        }

        if (toDelete.length === 0) log(`✅ Sin backups viejos para eliminar`);
    } catch (err) {
        log(`⚠️  Error limpiando backups viejos: ${err.message}`);
    }

    // 5. Regenerar el snapshot de schema (solo contra la DB de producción — no tiene
    //    sentido que staging pise el snapshot con su propio schema, que es el mismo).
    if (DB_NAME === 'procurador_db') {
        const schemaLocalPath = path.join(TMP_DIR, 'schema-latest.sql');
        try {
            const schemaDumpCmd = `PGPASSWORD="${DB_PASSWORD}" pg_dump -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} --schema-only ${DB_NAME} > ${schemaLocalPath}`;
            await execAsync(schemaDumpCmd);

            // Repo local en el servidor (si existe la carpeta database/, se actualiza directo)
            const repoSchemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
            if (fs.existsSync(path.dirname(repoSchemaPath))) {
                fs.copyFileSync(schemaLocalPath, repoSchemaPath);
            }

            // Copia off-server en Spaces, sobrescrita cada corrida (no acumula versiones)
            const schemaStream = fs.createReadStream(schemaLocalPath);
            await s3.send(new PutObjectCommand({
                Bucket: SPACES_BUCKET,
                Key: 'backups/schema-latest.sql',
                Body: schemaStream,
                ContentType: 'text/plain'
            }));

            fs.unlinkSync(schemaLocalPath);
            log(`✅ schema.sql regenerado (repo local + Spaces:backups/schema-latest.sql)`);
        } catch (err) {
            // No bloqueante: un fallo acá no debe hacer fallar el backup real de datos.
            log(`⚠️  Error regenerando schema.sql: ${err.message}`);
            if (fs.existsSync(schemaLocalPath)) fs.unlinkSync(schemaLocalPath);
        }
    }

    log(`✅ Backup completado exitosamente: ${filename}`);
}

runBackup().catch(err => {
    console.error(`❌ Error fatal en backup:`, err.message);
    process.exit(1);
});
