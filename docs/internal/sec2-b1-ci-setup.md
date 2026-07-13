# SEC-2 · B.1 — Smoke tests en CI (GitHub Actions)

> 2026-07-13 · Implementado y verificado en vivo. Workflow: `.github/workflows/smoke.yml`.
> Plan de origen: `plan-seguridad-precomercializacion-2026-07.md` (Parte B.1).

## Qué corre

En cada push/PR a `main` (y manualmente vía `workflow_dispatch`):

| Job | Qué hace | ¿Bloquea? |
|---|---|---|
| `audit-backend` | `npm audit --audit-level=high` en `backend-server/` | No (`continue-on-error: true`) |
| `audit-electron` | `npm audit --audit-level=high --omit=dev` en `electron-app/` (solo deps de runtime, no build/dev) | No |
| `api-and-payments-smoke` | Corre **contra staging**, por SSH, el script `ci-smoke.sh`: (1) smoke API (`/admin/smoke-tests/run-api`, 8 checks), (2) smoke de infraestructura de cobranza (`dev-tools/smoke-payments.js`, 19 checks) | Sí (falla si algún check falla) |

Ningún job toca producción. El tercer job nunca pasa por Nginx ni por internet: entra por SSH y pega contra `localhost:3444` (el proceso de staging), evitando el conflicto de headers `Authorization` (Basic de Nginx vs Bearer de la app) que hubiera bloqueado el enfoque HTTP directo.

## Mecanismo de acceso — clave SSH restringida

Se generó un **par de claves ed25519 nuevo, dedicado solo a esto** (no la clave `do_procurador` de uso general). Está instalada en `/root/.ssh/authorized_keys` del servidor con un **forced command**:

```
command="/var/www/procurador/ops/ci-smoke.sh",no-pty,no-agent-forwarding,no-X11-forwarding,no-port-forwarding,no-user-rc ssh-ed25519 AAAA...ci-github-actions-smoke
```

Esto significa: **sin importar qué comando pida el cliente SSH, el servidor siempre ejecuta `ci-smoke.sh` y nada más.** No hay shell, no hay PTY, no hay reenvío de agente ni de puertos. Aunque el secret de GitHub Actions se filtrara, lo máximo que permite es correr ese script — no da acceso root real al servidor.

- **Clave privada:** vive solo como GitHub Actions Secret `STAGING_SMOKE_SSH_KEY` (subida cifrada vía la API de secrets de GitHub, `libsodium` sealed-box). No quedó en ningún archivo del repo ni en disco tras la configuración.
- **Script `ci-smoke.sh`:** vive en `/var/www/procurador/ops/ci-smoke.sh` en el servidor (permisos `750`, solo root). Corre:
  1. Genera un JWT admin de corta vida (5 min) usando el `JWT_SECRET` de staging — nunca sale del servidor.
  2. `POST /admin/smoke-tests/run-api` contra `https://localhost:3444` (self-signed, por eso `-k`).
  3. `DB_NAME=procurador_db_staging node dev-tools/smoke-payments.js --host=https://localhost:3444` — el `DB_NAME` se pasa inline porque el `.env` propio del directorio de staging apunta al nombre de la DB de **prod** (`procurador_db`); solo `.env.staging`, que no es legible por el proceso SSH sin togglear el override completo, tiene el nombre correcto. Pasar `DB_NAME` inline evita depender de eso.
- **`dev-tools/smoke-payments.js`** se desplegó a `/var/www/procurador-staging/backend-server/dev-tools/` (antes no existía ahí — es tooling que normalmente solo corre localmente). Si el script cambia en el repo, hay que re-subirlo a staging manualmente (no forma parte del deploy automático de `backend-server/`).

## Verificado en vivo (2026-07-13)

Con la clave restringida real (no la de administración general):
```
=== [ci-smoke] 1/2: API smoke (run-api) ===
  API smoke: 8/8 OK
=== [ci-smoke] 2/2: Payments smoke (infraestructura de cobranza) ===
  Resultado: 19 ✅  0 ❌  0 ⚠️
=== [ci-smoke] TODO OK ===
```
Y confirmado que un comando arbitrario (`whoami; cat /etc/passwd`) es **ignorado** — el forced command corre igual.

## Mantenimiento / rotación

- **Rotar la clave:** generar un nuevo par, reemplazar la línea en `authorized_keys` (mismo patrón `command=...`), actualizar el secret `STAGING_SMOKE_SSH_KEY` en GitHub (Settings → Secrets → Actions), borrar la línea vieja.
- **Si se agregan más checks al smoke:** editar `ci-smoke.sh` en el servidor directamente (no versionado en el repo — es infraestructura del servidor, como el resto de `ops/`). Considerar en el futuro versionarlo en `ops/ci-smoke.sh` y desplegarlo como el resto de los scripts de `ops/`.
- **Si `dev-tools/smoke-payments.js` cambia:** re-`scp` a `/var/www/procurador-staging/backend-server/dev-tools/`.
- **No requiere el secret `STAGING_ADMIN_TOKEN` que mencionaba el plan original** — se descartó ese diseño (requería exponer el header `Authorization` vía la URL pública de Nginx, que choca con el basic-auth de staging). El JWT se genera fresco en cada corrida, dentro del servidor.

## Habilitar como *required check* (opcional, más adelante)

Hoy el job de smoke **si falla, falla de verdad** (no tiene `continue-on-error`), pero no está marcado como *required status check* en la protección de rama de GitHub — así que hoy no bloquea un merge a `main` por sí solo. Si se quiere que sí bloquee: Settings → Branches → Branch protection rules → `main` → Require status checks → agregar `api-and-payments-smoke`.
