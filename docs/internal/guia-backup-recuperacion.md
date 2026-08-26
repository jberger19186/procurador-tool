# Guía de backup y recuperación — Procurador SCW

> Etapa 1, ítem 1.4 del [roadmap de salida a mercado](roadmap-salida-a-mercado-2026-08.md).
> Última actualización: 2026-08-26.

Esta guía documenta **qué se respalda hoy, dónde vive cada copia, cómo bajar
una a una máquina local, cómo restaurar, y cómo verificar que un backup
realmente sirve**. El mecanismo ya existía y estaba probado (dos simulacros
de rollback reales, ver §6) — lo que faltaba era esto: que quedara escrito.

Al escribirla se encontraron y corrigieron **2 huecos reales** (§1.3 y §2):
`storage/invoices/` (los PDF de facturas) nunca estaba en ningún backup, y no
había un procedimiento escrito para bajar una copia a una máquina local.

---

## 1. Qué se respalda, y con qué frecuencia

Hay **dos mecanismos automáticos independientes**, corriendo en paralelo
sobre el mismo servidor (`142.93.64.94`), más uno manual on-demand.

### 1.1 Backup local diario (`backup-db.sh`)

| | |
|---|---|
| **Qué respalda** | La base de datos `procurador_db` completa (`pg_dump`) |
| **Cuándo** | Todos los días a las **03:00** (cron en `/etc/cron.d/procurador-backup`) |
| **Dónde queda** | `/var/backups/procurador/procurador_db_<timestamp>.sql.gz`, **en el propio servidor** |
| **Retención** | 7 días (se borra automáticamente lo más viejo) |
| **Alertas** | Email a `procuradortool@gmail.com` si el `pg_dump` falla o el archivo sale sospechosamente chico (<10 KB) |
| **Script** | [`backend-server/scripts/backup-db.sh`](../../backend-server/scripts/backup-db.sh) |

Es la copia **más rápida de usar** para un rollback urgente (está en el mismo
disco), pero **no sobrevive si se pierde el servidor entero** — para eso está
el siguiente mecanismo.

### 1.2 Backup remoto diario a DigitalOcean Spaces (`backup-db.js`)

| | |
|---|---|
| **Qué respalda** | La base `procurador_db` (`pg_dump` comprimido) **+ `storage/invoices/`** (los PDF de facturas, agregado en esta misma sesión — ver §1.3) **+** un snapshot de `database/schema.sql` |
| **Cuándo** | Todos los días a las **03:00** (mismo cron, otra línea) |
| **Dónde queda** | Bucket S3-compatible **`procurador-backups`** (región `nyc3`), carpeta `backups/`, **fuera del servidor** |
| **Retención** | 30 días (limpieza automática por fecha) |
| **Script** | [`backend-server/scripts/backup-db.js`](../../backend-server/scripts/backup-db.js) |

Es la copia que sobrevive a la pérdida completa del servidor (droplet
borrado, disco corrupto, etc.) — por eso tiene más retención (30 días) y vive
en un servicio de almacenamiento separado.

`database/schema.sql` (el snapshot de la estructura, sin datos) se
sobrescribe en cada corrida, tanto en el repo local del servidor como en
Spaces (`backups/schema-latest.sql`) — así nunca queda desactualizado
respecto de lo que realmente hay en producción.

### 1.3 🚨 Hueco cerrado en esta sesión: `storage/invoices/`

Los backups de arriba **solo cubrían la base de datos** — pero las
facturas emitidas manualmente por el admin (`POST /admin/invoices/manual` y
similares) guardan su **PDF en disco**, no en la DB:
`backend-server/storage/invoices/<archivo>.pdf`.

Esos PDF son **documentos fiscales reales** (nombre, CUIT, domicilio e
importe del cliente) que **el admin sube a mano desde ARCA** — si se pierden,
**no se pueden regenerar**. Antes de esta sesión no estaban en el backup
automático ni en el backup manual completo (`.7z`).

**Corregido:** `backup-db.js` ahora también empaqueta `storage/invoices/` en
un `.tar.gz` y lo sube a Spaces junto con el dump de la base, bajo el mismo
prefijo `backups/` (hereda la misma retención de 30 días, sin lógica nueva de
limpieza). Solo corre contra producción — staging no tiene facturas reales.
Verificado en producción: `backups/invoices_<timestamp>.tar.gz`, 14 archivos
reales empaquetados, subido y confirmado por lectura directa del bucket.

### 1.4 Backup manual on-demand (`ops/backup-now.sh`)

Para usar **antes de un deploy a producción**, no reemplaza a los dos de
arriba — es una red de seguridad local e inmediata.

```bash
# En el servidor:
./ops/backup-now.sh prod      # o "staging"
```

Queda en `/var/backups/procurador/predeploy/<entorno>_predeploy_<timestamp>.sql.gz`,
con los últimos 10 de cada entorno conservados. Es lo que ya se usa (y se usó
en las sesiones de Bitácora y Markdown) antes de cada migración o cambio de
código.

### 1.5 Lo que NINGÚN backup automático cubre

| Qué falta | Cómo se cubre hoy |
|---|---|
| **Código fuente** | Git (`origin/main`) — no es responsabilidad de estos backups |
| **`.env`, claves RSA, certificados SSL** | Solo en el backup manual completo `.7z` (ver `CLAUDE.md`, sección "Backup completo del proyecto") — **no está automatizado**, se genera a pedido |
| **`storage/invoices/`** | ✅ Cerrado en esta sesión (§1.3), ya automatizado |

Si en el futuro se agrega otro directorio de datos en disco (no en la DB),
hay que sumarlo a `backup-db.js` con el mismo criterio que `storage/invoices/`
— no asumir que "todo lo importante ya está en la base".

---

## 2. Cómo bajar una copia a una máquina local

No hay ningún procedimiento con más de un paso "mágico" — son 3 vías según
de dónde se quiera bajar la copia.

### Vía A — `scp` directo del servidor (la más simple, backup local de 7 días)

```bash
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" \
  root@142.93.64.94:/var/backups/procurador/procurador_db_<timestamp>.sql.gz \
  .
```

Listar qué hay disponible antes de elegir un archivo:

```bash
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
  "ls -la /var/backups/procurador/*.sql.gz"
```

### Vía B — DigitalOcean Spaces (backup remoto de 30 días, incluye `storage/invoices/`)

Spaces es compatible con la API S3 — se puede usar `aws-cli` apuntando al
endpoint de DO en vez del de Amazon. **Las credenciales (`DO_SPACES_KEY`/
`DO_SPACES_SECRET`) viven solo en el `.env` del servidor** (no se versionan,
ver la regla de secretos de `CLAUDE.md`) — pedírselas al operador o leerlas
por SSH antes de configurar el CLI local.

```bash
# Una vez, configurar un profile separado (no el de AWS real):
aws configure --profile do-spaces
# Access Key / Secret Key: los DO_SPACES_KEY/DO_SPACES_SECRET del .env del servidor
# Región: nyc3 · formato de salida: json

# Listar lo que hay:
aws s3 ls s3://procurador-backups/backups/ \
  --profile do-spaces --endpoint-url https://nyc3.digitaloceanspaces.com

# Bajar un archivo puntual:
aws s3 cp s3://procurador-backups/backups/backup_procurador_db_<timestamp>.sql.gz . \
  --profile do-spaces --endpoint-url https://nyc3.digitaloceanspaces.com
```

Bucket: `procurador-backups` · región: `nyc3` · endpoint:
`https://nyc3.digitaloceanspaces.com` (estos 3 datos no son secretos, viven
en `.env` como `DO_SPACES_BUCKET`/`DO_SPACES_REGION`/`DO_SPACES_ENDPOINT`).

### Vía C — Panel web de DigitalOcean (sin instalar nada)

`cloud.digitalocean.com` → **Spaces Object Storage** → `procurador-backups`
→ carpeta `backups/` → clic en el archivo → **Download**. Es la vía más
lenta pero no requiere configurar ninguna herramienta — sirve para una baja
puntual sin preparar el entorno.

---

## 3. Cómo restaurar

### 3.1 Restaurar la base de datos

El script `ops/restore-db.sh` ya hace las 2 capas de seguridad (backup de la
base destino antes de tocar nada + confirmación tipeada para producción) —
**nunca restaurar con `psql` a mano**, usar siempre este script.

```bash
# En el servidor, dentro del repo:
./ops/restore-db.sh prod /ruta/al/backup.sql.gz
# o para staging:
./ops/restore-db.sh staging /ruta/al/backup.sql.gz
```

Qué hace, en orden:
1. Detecta el owner real de la base destino.
2. Hace un backup de seguridad de la base destino **antes de tocar nada**
   (por si el archivo a restaurar fuera el equivocado) — queda en
   `/var/backups/procurador/predeploy/<entorno>_pre-restore_<timestamp>.sql.gz`.
3. Para `prod`, pide escribir literalmente `RESTAURAR` (salvo `--force`, pensado
   para uso encadenado desde otro script, no para uso manual).
4. Termina las conexiones activas a la base destino.
5. Recrea la base vacía con el mismo owner y restaura el dump encima.

**Antes de restaurar sobre producción**, detener la API (`pm2 stop
procurador-api`) para que no reabra conexiones a mitad de la restauración —
el script las termina igual, pero es más prolijo. Reiniciarla al final
(`pm2 start procurador-api` o `restart`).

Si el backup vino de Spaces o de la máquina local (vías B/C de §2), subirlo
primero al servidor con `scp` antes de pasarle la ruta al script — no hace
falta que el `.sql.gz` esté en ninguna carpeta particular.

### 3.2 Restaurar `storage/invoices/`

No hay script — es una restauración manual, porque no es una operación que
se haga con la misma frecuencia que la de la base:

```bash
# Bajar el tar del backup (vía B o C de §2), ej:
aws s3 cp s3://procurador-backups/backups/invoices_<timestamp>.tar.gz . \
  --profile do-spaces --endpoint-url https://nyc3.digitaloceanspaces.com

# Subirlo al servidor y extraerlo:
scp -i "C:/Users/JONATHAN/.ssh/do_procurador" invoices_<timestamp>.tar.gz \
  root@142.93.64.94:/tmp/
ssh -i "C:/Users/JONATHAN/.ssh/do_procurador" root@142.93.64.94 \
  "tar -xzf /tmp/invoices_<timestamp>.tar.gz -C /var/www/procurador/backend-server/storage/"
```

El `.tar.gz` contiene una carpeta `invoices/` (no los archivos sueltos) —
extraerlo directo en `backend-server/storage/` reconstruye
`backend-server/storage/invoices/` con el contenido del backup.

### 3.3 Restaurar código, `.env`, claves y certificados

Eso no sale de estos backups automáticos — sale del backup manual completo
`.7z` (ver `CLAUDE.md`, "Backup completo del proyecto" / variante `.7z`) o,
para el código, de `git checkout <tag o commit>`. Las claves privadas RSA y
los certificados SSL **nunca deben regenerarse a la ligera**: regenerar la
clave RSA invalida la firma de todos los scripts ya distribuidos a los
clientes (ver "Zonas protegidas" en `CLAUDE.md`).

---

## 4. Cómo verificar que un backup sirve

No alcanza con "el archivo existe y no pesa 0 bytes" — eso ya lo chequean
`backup-db.sh`/`backup-now.sh` solos (guarda de tamaño mínimo). Para una
verificación real:

1. **La más simple — restaurar sobre staging.** Staging es exactamente para
   esto: `./ops/restore-db.sh staging /ruta/al/backup.sql.gz`, después mirar
   que el portal/dashboard de staging levanten con datos reales
   (`https://staging-api.procuradortool.com`, con la basic-auth del equipo).
   Si el backup es de producción, esto valida que el dump es restaurable sin
   arriesgar el dato real.
2. **Sin tocar staging — restaurar en una base descartable.** Mismo patrón
   que usó la Fase B.1 del plan de correcciones de 2026-07-27 para validar
   `schema.sql`: crear una base nueva (`createdb procurador_db_test`),
   restaurar el dump ahí, comparar tablas/filas, y borrarla.
3. **Contenido del `.tar.gz` de facturas** — `tar -tzf archivo.tar.gz` lista
   los nombres sin extraer nada; comparar la cantidad contra lo esperado.

**Ya se hicieron 2 simulacros reales de este tipo** (no son solo teoría):
`ops/drill-rollback.sh` (corrompe datos en staging → restaura → verifica) y
`ops/drill-code-rollback.sh` (rompe el código de staging → revierte),
documentados en `docs/internal/plan-implementacion-staging.md`. Ambos
corrieron en segundos, sin tocar producción.

---

## 5. Checklist rápido

| Necesito... | Comando / procedimiento |
|---|---|
| Ver qué backups locales hay | `ssh ... "ls -la /var/backups/procurador/*.sql.gz"` |
| Bajar el backup de hoy a mi PC | Vía A de §2 (`scp`) |
| Bajar un backup de hace 3 semanas (ya rotado localmente) | Vía B o C de §2 (Spaces, retiene 30 días) |
| Backup manual antes de un deploy | `./ops/backup-now.sh prod` (o `staging`) |
| Restaurar la base sobre staging | `./ops/restore-db.sh staging <archivo>` |
| Restaurar la base sobre producción | `./ops/restore-db.sh prod <archivo>` (pide confirmación tipeada) |
| Recuperar las facturas (PDF) | §3.2 — bajar el `.tar.gz` de Spaces y extraerlo |
| Verificar que un backup de prod sirve sin arriesgar nada | Restaurarlo sobre **staging** primero |

---

## 6. Referencias

- [`plan-implementacion-staging.md`](plan-implementacion-staging.md) — diseño original del staging + los 2 simulacros de rollback.
- [`flujo-staging-rollback.md`](flujo-staging-rollback.md) / [`runbook-comandos.md`](runbook-comandos.md) — comandos de deploy/rollback día a día.
- `ops/README.md` — referencia de los scripts (`backup-now.sh`, `restore-db.sh`, drills).
- `CLAUDE.md`, sección "Backup completo del proyecto" — el backup manual `.7z` (código + `.env` + claves + certs + DB), para lo que los backups automáticos NO cubren.
