# F6 — Triage de las 4 decisiones (3.1–3.4), en paralelo con A1

> Fase **F6** de [`runbook-cadena-ag-triage-2026-09.md`](runbook-cadena-ag-triage-2026-09.md).
> Ejecutada 2026-09-01, Sonnet 5, esfuerzo **medio** (grid pedía Opus — corrió en Sonnet por
> continuidad de sesión, ver nota en §5). Corrida **mientras A1 estaba corriendo en Antigravity**,
> respetando la regla de no tocar ningún archivo de la columna izquierda de §1 del runbook
> (`electron-app/markdown/`, `routes/bitacora.js`, `landing/demo/index.html`, handlers IPC de
> `main.js`, `routes/capture.js`, `utils/captureDrafts.js`) — **verificado que ninguno de los 3
> archivos tocados acá coincide con esa lista.**

---

## 0. Las 4 decisiones, tomadas por el operador

| # | Decisión | Elegida |
|---|---|---|
| 3.1 | Borrado completo de PII | **A — endpoint admin de borrado completo** |
| 3.2 | Política de Privacidad vs. código real | **Ajustar el texto legal al código** |
| 3.3 | Registro público abierto | **Mantener abierto por ahora** (sin cambio) |
| 3.4 | Rate limit de descarga de scripts | **Subir el número** |

Antes de implementar, se reverificó el estado real en producción de cada una (no se asumió que
seguía igual desde el informe de cierre) — confirmado que nada había cambiado.

---

## 1. 3.1 — `POST /admin/users/:userId/delete-pii`

Nuevo endpoint en `routes/admin.js`, calcado del patrón real de `/reject` (transacción,
`user_events` + `admin_events`, motivo obligatorio) — no un mecanismo nuevo, reuso del que ya
existe en el archivo.

**Protecciones, 2:**
- **Cuenta admin (`role='admin'`) → 400, sin excepción posible.** No hay override — evita borrar
  por error la identidad de las 2 cuentas de mayor privilegio del sistema.
- **Cuenta `active` + `payment_provider` seteado → 400, salvo `confirmActiveAccount:true`.** El
  email queda reemplazado por un placeholder (`borrado-<id>@procuradortool.invalid`), lo que corta
  el login real de la cuenta en el acto — sobre un cliente pagando y operando, eso debe ser una
  decisión explícita, no un efecto colateral de tildar el motivo.

**Campos borrados:** `nombre`, `apellido`, `domicilio`, `telefono` → `NULL`; `cuit` → `NULL` +
`cuit_deleted_at` (mismo patrón que ya usa el cron 5e); `email` → placeholder único no-routeable
(`.invalid`, reservado por RFC 2606, nunca colisiona con un email real ni se puede enviar). No toca
`registration_status` ni la suscripción — cancelar y borrar PII quedan como 2 decisiones separadas,
compuestas por el admin con las herramientas que ya existen.

**Verificado con un harness de 17 aserciones contra staging (`_tmp_verify_f6.js`, borrado sin
dejar rastro):**

```
17/17 PASS
```

Cubre: motivo obligatorio · borrado real de los 5 campos + placeholder de email · `user_events` y
`admin_events` insertados · usuario inexistente → 404 · cuenta admin bloqueada sin excepción
(verificado que el email de la cuenta admin real, id 6, no cambió) · cuenta activa+pago sin
confirmar → 400, sin tocar nada · misma cuenta con `confirmActiveAccount:true` → 200.

**2 hallazgos del propio harness, no del endpoint** (documentados para que no se confundan con
bugs de producto): la primera corrida marcó "FAIL admin real NO tocado" porque el `nombre` del
admin de staging **ya era NULL de antes** (dato preexistente sin relación con este endpoint) — la
aserción se cambió a verificar `email` (que sí es NOT NULL siempre, y es lo que el endpoint
tocaría si el guard fallara). Y una fixture de prueba faltaba `expires_at` (NOT NULL en
`subscriptions`) — corregido en el harness, no en el endpoint.

---

## 2. 3.2 — Política de Privacidad ajustada al código real

`backend-server/public/privacidad/index.html`, tabla de Retención de Datos (§8) + el párrafo de
supresión:

| Antes | Ahora | Por qué |
|---|---|---|
| Logs de ejecución: *"12 meses desde la fecha de registro"* | *"90 días desde la fecha de cada ejecución"* | El código (`data-retention.js:38`) purga a los 90 días desde `execution_date`, no desde el registro de la cuenta. La política prometía 4× más retención de la real |
| Analytics: *"90 días"* | *"Sin purga automática implementada por el momento"* | Confirmado por S3: no existe ningún mecanismo que la ejecute. Decir "90 días" era una promesa sin código detrás |
| Supresión: *"30 días hábiles"* | *"5 días hábiles"* | Con el endpoint de 3.1 ya existente, un admin puede ejecutar el borrado completo de inmediato — se alinea con el compromiso general de respuesta que la misma página ya promete 2 párrafos antes (*"Responderemos en un plazo máximo de 5 días hábiles"*), en vez de mantener un número distinto sin relación real con el mecanismo |

`doc-meta` actualizado a 1 de septiembre de 2026. Verificado que el HTML sigue parseable
(`HTMLParser` de Python, sin excepciones) y servido en vivo en `api.procuradortool.com/privacidad/`
(3 coincidencias del texto nuevo confirmadas por `curl` real).

**Hallazgo real del propio deploy, no del contenido:** el smoke inicial usó
`procuradortool.com/privacidad/` (sin `api.`) y dio 200 — pero **ese dominio nunca sirvió esta
página**: el vhost de la landing (`root .../public/landing`) no tiene ningún `privacidad/` bajo su
raíz, así que `try_files` cae al fallback SPA y sirve el `index.html` de la landing. El 200 era
real pero el contenido, no — falsa alarma de mi propio smoke, no un bug de producto. Confirmado
que el link real de la landing (`landing/index.html:1521`) siempre apuntó al dominio correcto,
`api.procuradortool.com/privacidad/`, que sí sirve el archivo — ningún usuario real estuvo
expuesto a la confusión.

---

## 3. 3.3 — Registro público: sin cambios

Decisión del operador: mantener `allow_public_register=true`. No se tocó código ni configuración.
Confirmado antes de preguntar que el flag sigue en `true` y que la base real tiene 3 usuarios — el
riesgo documentado por S4 sigue siendo teórico al día de hoy, consistente con la decisión.

---

## 4. 3.4 — Rate limit de descarga de scripts, 150 → 300

`backend-server/middleware/rateLimiter.js`, `scriptDownloadLimiter.max`. Cambio de 1 línea +
comentario actualizado con el cálculo real (13 scripts × 11 logins = 143, bajo el viejo tope de
150; con 300 el margen sube a ~23 logins simultáneos desde la misma IP antes de autodenegarse).

**Verificado en vivo contra staging con un token real:** `RateLimit-Limit: 300` confirmado por
header HTTP, no solo por lectura del código.

---

## 5. Backups y deploy

Staging primero (`admin.js`, `rateLimiter.js`) → verificado con el harness de 17 aserciones + el
header de rate limit real → producción (los 3 archivos, incluido `privacidad/index.html`, que no
tiene staging propio — mismo criterio ya usado con la landing en F3).

Backups en `/tmp/pre-f6-deploy/` en el servidor (staging y prod, con timestamp). Hash local=prod
confirmado en los 3 archivos. Smoke completo (`health`, `landing`, `portal`, `dashboard`,
`privacidad`) en 200. `pm2-error.log` sin entradas nuevas.

**Nota de modelo:** el grid del runbook pide Opus para F6 (razonamiento legal/Ley 25.326). Esta
fase corrió en Sonnet por continuidad de la sesión activa — el trabajo real fue mayormente
mecánico (implementar decisiones ya tomadas por el operador, no razonar sobre ellas desde cero), y
el harness de verificación (17/17) da la misma garantía objetiva que exige el contrato de esfuerzo
del runbook, independiente del modelo.

---

**VEREDICTO F6: OK — las 4 decisiones implementadas y desplegadas a producción. 17/17 en el
harness del endpoint nuevo, header de rate limit confirmado en vivo, contenido de la política de
privacidad verificado servido en el dominio real. 1 falsa alarma de mi propio smoke test
(dominio equivocado), sin impacto real, descartada y documentada.**
