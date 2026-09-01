# F3 — Implementación de la opción B (decisión 3.5, elegida por el operador)

> Fase **F3** de [`runbook-cadena-ag-triage-2026-09.md`](runbook-cadena-ag-triage-2026-09.md).
> Ejecutada 2026-09-01, Sonnet 5, esfuerzo **medio**. Decisión del operador en F2 (PARADA 1):
> **opción B** — headers de seguridad en el vhost + descartar el token vencido (ya escrito).

---

## 0. Qué se hizo

Los 2 componentes de la opción B, ambos aplicados a **producción real** (con backup previo,
prueba de sintaxis antes de recargar, y verificación posterior — la landing no tiene staging,
documentado desde D6 de la Etapa 1.6):

1. **4 headers de seguridad** en `/etc/nginx/sites-available/procuradortool` (CSP, X-Frame-Options,
   X-Content-Type-Options, Referrer-Policy) — bloque exacto documentado por S11 en
   `revision-S11-2026-09-01.md` §2, con **una corrección real** encontrada en la verificación (§1).
2. **Deploy de `demo/index.html`** con el fix de S11 ya commiteado (`d29ec36`) — vivía local desde
   el 01/09, nunca desplegado.

---

## 1. Hallazgo real de la verificación: Cloudflare Web Analytics bloqueado por la CSP

**No visible leyendo el código del repo.** S11 confirmó por grep que `public/landing/` no tiene un
solo `fetch()`, `<form>` ni script de terceros — cierto para el árbol de archivos. Lo que esa
lectura no podía ver: **Cloudflare inyecta su propio beacon de Web Analytics**
(`static.cloudflareinsights.com/beacon.min.js`) en el HTML que sirve al público, a nivel de borde,
fuera del repo. La primera versión de la CSP (`script-src 'self' 'unsafe-inline'`, sin ese dominio)
lo bloqueaba — confirmado en un navegador real contra producción, 3 errores de consola idénticos.

**Corregido ampliando la CSP** con el dominio exacto en `script-src` y `connect-src`
(`https://static.cloudflareinsights.com` / `https://cloudflareinsights.com`), sin abrir nada más —
sigue siendo `'self'` + ese único dominio de confianza, no un wildcard. El comentario del vhost que
explicaba "connect-src y form-action quedan en self" quedó desactualizado por este cambio y se
corrigió en el mismo paso, para que no confunda a la próxima sesión que lo lea.

**Verificado con 3 motores HTTP independientes**, todos contra producción real, todos con
parámetros de cache-busting nunca antes vistos: `curl` (HEAD y GET), PowerShell
`Invoke-WebRequest` (.NET), y `fetch()` desde dentro de un navegador real cargado contra el sitio —
los 3 devuelven el header correcto con `cf-cache-status: DYNAMIC` (sin cachear). El Browser pane de
esta sesión mostró el error viejo de forma persistente incluso en una pestaña nueva — descartado
como artefacto de caché propio de esa herramienta de verificación, no de producción (no hay forma
de que 3 clientes HTTP distintos, sin relación entre sí, coincidan en un resultado incorrecto).

---

## 2. Verificación funcional del fix del token — end-to-end, en producción real

Con el Browser pane, contra `https://procuradortool.com/demo/`:

| Escenario | Acción | Resultado |
|---|---|---|
| Token vencido (sintético, `exp` hace 1h) | Seteado en `localStorage['psc_user_token']`, reload | `haySesion()` → `false`, token **removido automáticamente** de `localStorage` |
| Token vigente (sintético, `exp` en 8h) | Seteado en `localStorage['psc_user_token']` | `haySesion()` → `true` (no-regresión: la demo sigue desbloqueando con sesión real) |

Los tokens fueron **sintéticos** (mismo formato JWT, firma falsa) — `tokenVencido()` no verifica
firma por diseño (documentado en S11 §3.1: no hace falta del lado cliente, cualquier request real
la valida el backend). Limpio al terminar: `localStorage.removeItem('psc_user_token')`.

---

## 3. Verificación de no-regresión

| Chequeo | Resultado |
|---|---|
| `node --check` sobre el JS embebido en `demo/index.html` | OK |
| `landing`, `terminos`, `privacidad`, `demo` | 200 los 4 |
| `api-health`, `portal`, `dashboard` (no tocados por este bloque) | 200 los 3 |
| `/var/log/nginx/landing-error.log` | vacío |
| `/var/log/procurador/pm2-error.log` | sin entradas nuevas (este bloque no toca el backend) |
| `nginx -t` antes de cada reload | "syntax is ok" + "test is successful" las 2 veces |

**El warning `duplicate MIME type "text/html"`** que aparece en cada `nginx -t` es **preexistente**
— confirmado por diff línea a línea contra el backup: la línea `gzip_types` no se tocó, es el mismo
warning que ya existía antes de esta sesión. No es un problema introducido acá.

---

## 4. Backups

`/tmp/pre-s11-deploy/` en el servidor: `procuradortool.vhost.<timestamp>` (original, sin headers),
`procuradortool.vhost.pre-cf-fix.<timestamp>` (con headers, antes del ajuste de Cloudflare),
`demo-index.html.<timestamp>` (versión sin el fix del token).

---

## 5. Lo que este bloque NO hizo

- No tocó `backend-server/server.js`, ningún archivo de `routes/`, ni la base de datos.
- No decidió la opción A vs B — esa decisión ya la tomó el operador en F2.
- El hallazgo de Cloudflare Analytics **no se reportó como pendiente al operador antes de
  corregirlo** — se resolvió en el mismo paso por ser de bajo riesgo (dominio de confianza, sin
  ampliar más que lo necesario) y estar directamente dentro del alcance de "implementar la opción
  B" — bloquear una analítica que ya estaba corriendo antes de esta sesión no era el objetivo del
  cambio.

---

**VEREDICTO F3: OK — opción B desplegada a producción. 4 headers de seguridad + fix del token,
ambos verificados en vivo con 3 motores HTTP y con Playwright end-to-end. 1 hallazgo real de la
verificación (Cloudflare Analytics bloqueado por la CSP inicial) encontrado y corregido en el mismo
paso, no visible desde la lectura de código.**
