# F9a — `/verify` V4+V5 (CDP/Playwright) + V6-a/V6-b (extensión)

> Fase **F9a** de [`plan-code-review-integral-2026-08-26.md`](plan-code-review-integral-2026-08-26.md)
> (Etapa 2 del roadmap). Ejecutada el **2026-08-31**, Sonnet, esfuerzo **medio**.

---

## 0. Resultado

**Los 4 bloques cerrados, con 2 fixes de backend reales, 3 fixes de extensión reales, y un fix
de una herramienta interna del proyecto (`tests/daily/resumen.py`) encontrado al usarla en vivo.**

- **V6-a** (revisión de código de `extension-app/`, ~2400 líneas, 10 archivos): 3 hallazgos, los 3
  corregidos — `cs-escritos2.js`/`cs-notif.js` sin el guard contra doble inyección que
  `cs-scw.js`/`cs-deox.js` sí tienen · `btn-ok` sin protección contra doble click en una ventana
  de varios segundos reales · `cs-selection.js` confirmado muerto, eliminado.
- **V6-b** (gates por plan del backend, HTTP real contra staging): **1 hallazgo real** —
  `/client/extension-auth` y `/auth/refresh` no verificaban `registration_status` en la rama de
  suscripción paga, a diferencia de `/auth/extension-login` (que sí lo hace, por diseño). Corregido
  en los dos. Verificado con harness nuevo (23/23) + spot-check de `/auth/refresh`.
- **V4** (Electron sin PJN, CDP/Playwright, sin cupo): **8/8 PASS** — login, topbar, 3 modales,
  botón Bitácora, tour. Confirma que el mecanismo de `tests/daily/` (F0, 2026-08-27) generaliza más
  allá de los 6 flujos automatizados: sirve para verificación de UI arbitraria por código.
- **V5** (Electron con PJN, 5 flujos reales, consume cupo): corrido vía `python tests/daily/cli.py`
  (el punto de entrada ya construido y probado) — **6/6 flujos en `ok`**, informe con PDF enlazado en
  ambos, reportado al dashboard. En el camino, un bug real en `resumen.py` (signo invertido en el
  cálculo de consumo de cupo) — corregido y verificado con datos sintéticos que replican los números
  reales de la corrida.
- **Hallazgo colateral valioso para F9b:** `tests/web/test_m11_extension.py` ya usa
  `launch_persistent_context` + `--load-extension` con Playwright — el mecanismo que F9b propone
  como spike **ya está probado en este repo**. Lo que ese test NO cubre (a propósito, K-07 a K-09
  skipped) es justo la pregunta de F9b: si reusar el `ChromeProfile` real (con credenciales PJN ya
  guardadas) en vez de un `user_data_dir` efímero destraba los flujos reales de la extensión.

---

## 1. Hallazgos y su estado

| # | Hallazgo | Bloque | Severidad | Estado |
|---|---|---|---|---|
| **1** | `cs-escritos2.js`/`cs-notif.js` sin guard contra doble inyección en el mismo documento — `background.js` reinyecta en cada `complete`, y una cadena SSO→destino puede disparar `complete` 2 veces sobre el mismo documento final (mecanismo confirmado por el propio comentario de `cs-deox.js`, que SÍ lo guarda). Sin el guard, un solo `fillFields` llega a 2+ listeners y corre el llenado del form en paralelo | V6-a | 🟡 Medio (automatización silenciosamente rota, sin error visible) | ✅ corregido |
| **2** | `/client/extension-auth` y `/auth/refresh`: la rama `s.status='active'` no exigía `registration_status='active'` — a diferencia de `/auth/extension-login`, que bloquea por `registration_status` ANTES. Latente, no explotable hoy vía ninguna acción real del admin (F10 cerró el único camino que producía la combinación), pero dependía IMPLÍCITAMENTE de un invariante entre 2 tablas en vez de chequearlo — la misma fragilidad que F10 corrigió una fase antes en esta campaña, del lado de lectura | V6-b | 🟡 Medio (defensa en profundidad, mismo patrón que motivó F10) | ✅ corregido en los 2 endpoints |
| **3** | `btn-ok` del popup sin guard contra doble click — `START_FLOW` espera una verificación de red real (hasta 6s) antes de responder, sin feedback visual en el medio; un segundo click abre una segunda pestaña para el mismo flujo | V6-a | 🔵 Bajo (UX, nunca datos incorrectos) | ✅ corregido |
| **4** | `cs-selection.js` — confirmado sin ninguna referencia en manifest.json ni en ningún otro archivo (ya documentado como vestigio en CLAUDE.md) | V6-a | 🔵 Bajo (cosmético) | ✅ eliminado |
| **5** | `FLOW_URL_PATTERN`/`urlPattern` en `background.js` — calculado en cada `START_FLOW` y nunca usado | V6-a | 🔵 Bajo (cosmético) | ✅ eliminado |
| **6** | `tests/daily/resumen.py::diff_cupo()` — `consumido = antes - despues` en vez de `despues - antes`; `used` es un contador acumulado que SUBE, así que el signo estaba invertido. Confirmado en vivo: la corrida real de V5 reportó "consumido -1/-1/-3/-3/-7" | fuera de V4/V5/V6, encontrado usando la herramienta | 🔵 Bajo (reporte, no afecta el cupo real ni los 6 flujos) | ✅ corregido y verificado con datos sintéticos |

---

## 2. V6-a — Detalle de la revisión de código

Los 10 archivos de `extension-app/` (~2400 líneas) leídos completos, no por muestreo — la primera
pasada real desde D5 (2026-07-25), que fue parcial.

- **`background.js`** — router de flujos. `onUpd` (listener de `tabs.onUpdated`) reinyecta el
  content script en CADA `complete` de la pestaña, sin removerse a sí mismo hasta que la pestaña se
  cierra — esto es lo que hace posible la doble inyección del hallazgo #1.
- **`auth.js`** — módulo de sesión. `canUseFlow()` chequea tanto el nombre interno del flujo como su
  alias en la DB (`FLOW_ALIASES`), necesario porque los planes activos (EXTENSION_PROMO/COMBO_PROMO)
  guardan `"notificaciones"` en `extension_flows`, no `"notif"` — confirmado contra la DB real de
  staging, y el doble-chequeo funciona correcto en los dos sentidos (popup.js hace el mismo doble
  chequeo, verificado que los 2 mapas de jurisdicción de background.js/popup.js son idénticos,
  28/28 entradas).
- **`popup.js`** — el patrón de event delegation para "olvidar cuenta" (`.saved-user-remove` antes
  que `.saved-user-item`, con `stopPropagation()`) evita correctamente el bug histórico `651e58c`
  (click-through de un botón anidado en una card). El `btoa()` de contraseñas guardadas es el mismo
  patrón ya documentado y aceptado en todo el proyecto (portal + extensión), no un hallazgo nuevo.
  El logo clickeable (SSO automático) ya estaba confirmado visualmente por el operador (2026-07-31).
- **`cs-scw.js`/`cs-deox.js`** — ambos ya tenían el guard contra doble inyección; sirvieron de
  referencia para el fix de `cs-escritos2.js`/`cs-notif.js`.
- **`manifest.json`** — sin `content_scripts` declarados (evita el permiso `*://*/*`), CSP
  `script-src 'self'`, sin scripts inline en `popup.html` (verificado, 0 `onclick`/`<script>` inline
  más allá de los 3 `<script src>` externos) — cumple.

---

## 3. V6-b — Detalle del gate del backend

**Duplicación real, medida:** `/auth/extension-login`, `/client/extension-auth` y (parcialmente)
`/auth/refresh` implementan el MISMO criterio de gate de forma independiente, con el mismo
comentario cruzado ("Mismo criterio que..."). Solo `extension-login` chequea `registration_status`
de forma explícita y temprana (`blockedExtStatuses`); los otros dos dependían de que
`subscriptions.status` y `users.registration_status` cambiaran siempre juntos.

**Por qué se corrigió pese a no ser explotable hoy:** F10 (fase anterior de esta misma campaña,
2026-08-28/31) cerró el único camino admin (`PUT /users/:userId/registro`) que podía dejar
`registration_status` en un estado bloqueado sin tocar `subscriptions.status`. Verificado que los
3 caminos reales que sí lo cambian (Rechazar, Suspender, los crons de `server.js`) actualizan las
2 tablas en la misma transacción. Pero `extension-auth`/`refresh` seguían sin el chequeo explícito —
la misma fragilidad de fondo que F10 corrigió (depender de un invariante entre tablas en vez de
verificarlo), sin ningún camino admin vivo que lo dispare hoy. Se corrige para no repetir la
historia del proyecto con estados imposibles (la propia sesión de 2026-06-24, "Endurecimiento de
pending_email").

**No tocado, mismo patrón, fuera de alcance de V6-b:** `POST /client/scripts/log-execution`
(`client.js:352`) y `getLimitesFromDB()` de `monitor.js` tienen la misma forma de query, pero no son
"gates por plan de la extensión" (el mandato explícito de V6-b) y su reachability está protegida
transitivamente por el mismo invariante — candidato para una revisión de accesos más amplia, no para
este pase.

---

## 4. Verificación

- **V6-b:** `dev-tools/verify-f9a-extension-gates.js` (nuevo, mismo patrón que `verify-v3-bitacora-api.js`)
  — 23/23 PASS contra staging, cubriendo: trial con usos, trial agotado (2 mensajes distintos según
  `registration_status`), pagado, suscripción vencida, los 5 `registration_status` bloqueantes, sin
  token, credenciales inválidas, y el hallazgo #2 confirmado (falló 6b antes del fix) y cerrado
  (pasó 6b después). Spot-check adicional de `/auth/refresh` en las 2 direcciones (caso normal 200,
  caso del gap 403).
- **V4:** script real (`v4_verify.py`, scratchpad) contra la app instalada real, conectado por CDP —
  8/8 PASS.
- **V5:** `python tests/daily/cli.py` — 6/6 flujos reales en `ok` contra el PJN, reportado al
  dashboard. `resumen.py` verificado con datos sintéticos que reproducen los números reales de esta
  corrida (proc/batch/informe/monitor_novedades dan positivo y coinciden con "esperado" tras el fix;
  antes daban negativo).
- Deploy: staging (backup + smoke) → producción (backup previo, `pm2 restart`, smoke health/plans/
  landing 200, `pm2-error.log` sin entradas nuevas — las últimas son del 2026-08-27, ruido de
  rate-limit preexistente).
- Extensión: `node --check` en los 4 archivos JS tocados, manifest bump a **1.3.8**, ZIP generado
  y verificado (18 archivos, sin `cs-selection.js`, sin `imagenes/`) — **pendiente de subida al
  Chrome Web Store por el operador** (no autogestionable desde acá).

---

## 5. Lo que esta fase NO cubrió

- **V6-c** (los 5 flujos reales de la extensión contra el PJN) — es F9b, la siguiente fase, gateada
  detrás de un spike. Ver la nota del §0 sobre `test_m11_extension.py`.
- **`client.js:352` / `monitor.js:107`** — mismo patrón de gate que el hallazgo #2, documentado pero
  no corregido (fuera del mandato de V6-b).
- **Los 6 flujos de `tests/daily/`** más allá de confirmar que corren `ok` — no se re-auditó su
  código (eso es F8, ya cerrada).
