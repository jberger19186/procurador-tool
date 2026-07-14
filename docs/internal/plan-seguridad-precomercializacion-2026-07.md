# Plan de Seguridad Pre-Comercialización — SEC-1, SEC-2, SEC-4

> Documento de planificación · 2026-07-06 · **✅ Los 3 pendientes (SEC-1, SEC-2, SEC-4) cerrados al 2026-07-13.** Ver estado final y detalle real de implementación en `runbook-mejoras-menores-seguridad.md` y `informe-seguridad-sec1-2026-07-13.md`. Este documento queda como la especificación original de diseño (algunos detalles, como el uso de Windows Credential Manager en B.2, no se necesitaron finalmente — ver runbook para lo que realmente se implementó).
> Estado original: **planes aprobados para ejecutar** (SEC-1 ejecutable de forma autónoma; SEC-2 y SEC-4 son planes de implementación).
> Cubre los tres pendientes abiertos del bloque 🔵 Seguridad pre-comercialización del CLAUDE.md.
> Regla transversal: **todo se prueba/implementa primero en `staging`** (`staging-api.procuradortool.com`, DB `procurador_db_staging`), con backup previo, antes de tocar producción. Ningún test destructivo contra prod.

---

## Índice

- **Parte A — SEC-1**: Auditoría de seguridad (plan de pruebas ejecutable de forma autónoma).
- **Parte B — SEC-2**: Smoke tests en CI + **Verificación diaria real** (procuración + informe con credenciales reales, panel de configuración, aporte al diagnóstico del dashboard).
- **Parte C — SEC-4**: Enforcement server-side del trial en `/license/execution/start`.

---

# Parte A — SEC-1: Auditoría de seguridad autónoma

## A.0 Objetivo y alcance

Ejecutar una **auditoría de seguridad profesional interna** de forma autónoma (Claude ejecuta las pruebas, documenta hallazgos con severidad y remediación), cubriendo backend, app Electron y extensión. **No reemplaza** una auditoría externa profesional (que sigue recomendada antes del lanzamiento masivo), pero eleva sustancialmente la garantía para la Beta y deja documentado el estado.

**Reglas de ejecución:**
- Pruebas **black-box + white-box** (tenemos el código): se combinan el escaneo del código real con pruebas activas contra **staging**.
- **Nada destructivo ni contra producción.** Los tests activos (fuzzing de auth, IDOR, rate limit) corren contra `staging-api` con usuarios de prueba descartables.
- Cada hallazgo se registra con: **ID · severidad (Crítica/Alta/Media/Baja/Informativa) · componente · descripción · prueba que lo evidencia · remediación sugerida**.
- Entregable: informe `docs/internal/informe-seguridad-sec1-<fecha>.md` + tabla resumen + veredicto (apto/no apto Beta y qué corregir antes del público).

## A.1 Matriz de pruebas

### Bloque 1 — Dependencias y superficie conocida
| # | Prueba | Método | Cómo |
|---|---|---|---|
| S1.1 | `npm audit` backend | white-box | correr en `backend-server/`, clasificar por severidad (relaciona D3/D4) |
| S1.2 | `npm audit` electron | white-box | correr en `electron-app/`, separar deps de runtime vs build/dev |
| S1.3 | Secretos hardcodeados | white-box | escaneo de patrones (tokens, claves, passwords) en todo el repo; verificar `.gitignore` cubre `.env`/keys/certs |
| S1.4 | Historial git de secretos | white-box | buscar secretos filtrados en commits (relaciona el antecedente GitGuardian) |

### Bloque 2 — Autenticación y sesión
| # | Prueba | Método | Cómo |
|---|---|---|---|
| S2.1 | Fuerza de JWT | white+black | verificar `JWT_SECRET` ≥32 chars (ya validado al arrancar); confirmar expiraciones (login 2h/8h admin) |
| S2.2 | Blacklist de tokens al logout | black | logout → reusar el token → esperar 403 (admin **y** usuario); relaciona M-1 ya resuelto, re-verificar |
| S2.3 | Device binding | black | login con `machineId` A, intentar reusar token con `machineId` B en endpoints device-bound |
| S2.4 | Política de contraseñas | black | registrar/cambiar con passwords débiles (corta, sin número, común, = email) → rechazo |
| S2.5 | Anti-enumeración | black | `resend-verification` y reset con email inexistente → respuesta genérica idéntica |
| S2.6 | Rate limit de login/registro | black | ráfaga de intentos fallidos → verificar el limitador (relaciona el rate limit de descarga 150/5min) |
| S2.7 | Refresh/verify-session como capa de sesión | black | con trial 20/20 → `verify-session`/`refresh` devuelven 200 (sesión viva), NO 403 por cuota |

### Bloque 3 — Autorización (el más importante para IDOR)
| # | Prueba | Método | Cómo |
|---|---|---|---|
| S3.1 | Endpoints admin exigen rol admin | black | llamar `/admin/*` con token de usuario común → 403 |
| S3.2 | IDOR en recursos de usuario | black | usuario A pide datos de usuario B por id (tickets, pagos, facturas, notificaciones, monitor) → 403/404, nunca fuga |
| S3.3 | Auto-asignación de plan privado | black | usuario intenta asignarse un plan `visibility=private` por registro/change-plan/checkout → bloqueado (relaciona blindaje ya hecho) |
| S3.4 | Manipulación de cuota desde el cliente | black | forjar `log-execution` con subsystem falso o counts; verificar que el server no confía en el cliente |
| S3.5 | Checkout/confirm sin pago real | black | disparar `/checkout/confirm` sin preapproval válido → no marca `payment_provider` (relaciona fix ya hecho, re-verificar) |

### Bloque 4 — Inyección y validación de entrada
| # | Prueba | Método | Cómo |
|---|---|---|---|
| S4.1 | SQL injection | white+black | confirmar 100% queries parametrizadas (escaneo) + payloads en campos de búsqueda (admin users search, tickets) |
| S4.2 | XSS almacenado/reflejado | black | payloads en tickets, notas, carátulas, perfil → verificar escape en portal/dashboard (CSP ya activa) |
| S4.3 | Path traversal en uploads | black | subir factura PDF con nombre `../../etc` → verificar multer sanea destino |
| S4.4 | Tipo de archivo en uploads | black | subir no-PDF / PDF con payload → verificar validación de tipo/tamaño |
| S4.5 | Inyección en headers/webhook | black | webhook MP con firma inválida/ausente → rechazo con timing-safe (M-2 resuelto, re-verificar) |

### Bloque 5 — Configuración y transporte
| # | Prueba | Método | Cómo |
|---|---|---|---|
| S5.1 | Headers de seguridad (Helmet/CSP) | black | inspeccionar respuestas: CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| S5.2 | TLS mínimo | black | verificar rechazo de TLS <1.2, negocia 1.3 (B-6 resuelto, re-verificar) |
| S5.3 | Exposición de errores | black | forzar 500 → verificar que no filtra stack trace/SQL/rutas internas al cliente |
| S5.4 | CORS | white+black | revisar config CORS — que no sea `*` en endpoints autenticados |
| S5.5 | Superficie de puertos | black | confirmar que solo Nginx (443) expone; 3443/3444/DB no accesibles desde afuera |

### Bloque 6 — Lógica de negocio (abuso)
| # | Prueba | Método | Cómo |
|---|---|---|---|
| S6.1 | **Bypass del trial (relaciona SEC-4)** | black | cliente adulterado: llamar `/license/execution/start` + descargar script con trial agotado → **hoy pasa** (start no chequea cuota). Documentar como hallazgo hasta que SEC-4 cierre |
| S6.2 | Idempotencia de webhooks | black | reenviar el mismo webhook MP 2× → no duplica pago/factura |
| S6.3 | Concurrencia de ejecución | black | dos `execution/start` para el mismo user desde machines distintas → segundo bloqueado (DEVICE_LOCKED) |
| S6.4 | Descarga de scripts sin licencia | black | descargar script cifrado sin suscripción válida → verificar gate (relaciona SEC-4: hoy la descarga no chequea usos) |

### Bloque 7 — Integridad del cliente (Electron/extensión)
| # | Prueba | Método | Cómo |
|---|---|---|---|
| S7.1 | Verificación de firma RSA de scripts | white | confirmar que la app verifica firma antes de ejecutar; alterar un script → rechazo |
| S7.2 | Autodestrucción de scripts | white | confirmar borrado del script descifrado tras ejecutar |
| S7.3 | Credenciales PJN nunca salen | white | confirmar que las credenciales del gestor de Chrome no viajan al backend (el pitch de privacidad) |
| S7.4 | Permisos de la extensión | white | revisar `manifest.json`: sin `tabs`, sin `content_scripts *://*/*`, host_permissions acotados |

## A.2 Ejecución y entregable

1. Preparar staging con 2–3 usuarios de prueba descartables (trial, activo-sin-pago, activo-con-pago).
2. Correr los bloques 1→7 (los white-box no necesitan staging; los black-box van contra `staging-api`).
3. Registrar cada hallazgo en la tabla de severidad.
4. Producir `docs/internal/informe-seguridad-sec1-<fecha>.md` con: resumen ejecutivo, tabla de hallazgos, detalle por hallazgo, y **veredicto** (qué es apto para Beta / qué corregir antes del público).
5. Los hallazgos accionables se agregan a la lista de pendientes del CLAUDE.md con su ID.

> **Nota honesta de alcance:** una auditoría autónoma cubre muy bien lo verificable por código y por prueba de endpoints; **no** sustituye pentesting manual profundo (cadenas de exploits, ingeniería social, análisis de binario del `.exe`). SEC-1 externo sigue recomendado antes del lanzamiento masivo — este plan lo reduce a "confirmación independiente", no a "descubrimiento desde cero".

---

# Parte B — SEC-2: Smoke tests en CI + Verificación diaria real

Son **dos capas complementarias** con objetivos distintos:

- **B.1 — CI en GitHub Actions**: cazar regresiones **nuestras** (que un cambio de código rompa un endpoint o el flujo de pagos) en cada push. Rápido, sin PJN, sin Chrome.
- **B.2 — Verificación diaria real**: cazar rupturas **externas** (que el PJN cambie su sitio, o que un script deje de funcionar contra el portal real) corriendo una **procuración + informe reales** con credenciales reales, de forma automática y supervisada, en la PC del operador. Es la idea nueva de esta sesión.

## B.1 — Smoke tests automatizados en CI (GitHub Actions)

### Qué corre en cada push a `main`
| Suite | Qué prueba | Requiere |
|---|---|---|
| **API smoke** (`smoke-test-results` / `run-api`) | endpoints críticos responden con el status esperado (login inválido→401, health, etc.) | solo HTTP contra staging |
| **Pagos smoke** (`dev-tools/smoke-payments.js`) | el flujo de checkout/webhook no se rompió | sandbox MP (staging) |
| **`npm audit`** | no entraron dependencias con CVEs nuevos (relaciona D3) | — |

### Diseño
- Workflow `.github/workflows/smoke.yml`, disparado en `push`/`pull_request` a `main`.
- Corre contra **staging** (nunca prod): secretos (`STAGING_ADMIN_TOKEN`, URL) en **GitHub Actions Secrets**, jamás en el repo.
- Job falla → notifica (email de GitHub / badge en el README). No bloquea el deploy automáticamente en v1 (es informativo); se puede endurecer a `required check` más adelante.
- **No incluye** los grupos D–H de `smoke-test-pjn.js` (requieren Chrome + login SSO real al PJN → no corren en un runner headless de CI). Esos van en la capa B.2.

### Entregable
- `smoke.yml` + documentación del setup de secrets + primer run verde.

## B.2 — Verificación diaria real (procuración + informe con credenciales reales)

### Concepto

Una rutina que, **con aprobación del usuario**, corre periódicamente en la PC del operador una **procuración real + un informe real** contra el PJN usando la cuenta de prueba (CUIT **27320694359**), y reporta el resultado (fecha + estado + detalle) a la sección **Diagnóstico** del dashboard admin. Es el canario definitivo: si el PJN cambió algo que rompe los scripts, o si un script dejó de andar, esto lo detecta ejecutando el camino real de punta a punta — no solo verificando selectores.

### Por qué en la PC del operador y no en CI

La automatización necesita **Chrome real con el perfil del usuario** y **las credenciales del PJN en el gestor de contraseñas de Chrome** (así funciona el producto — las credenciales nunca van al backend). Un runner de CI en la nube no tiene ese perfil ni debe tenerlo. Por eso la verificación real vive donde vive el producto: en la máquina del operador.

### Manejo de credenciales — Windows Credential Manager

- Las credenciales de la cuenta de verificación (login del portal + lo necesario) se guardan en **Windows Credential Manager** (`cmdkey`/CredRead vía PowerShell), **no** en archivos del repo ni en texto plano — misma disciplina que el token de GitHub del proyecto.
- La rutina las lee de ahí al momento de correr. El CUIT `27320694359` y su credencial del PJN ya viven en el perfil de Chrome dedicado (`ProcuradorSCW`) que el producto usa.
- Nunca se loguean ni se reportan al backend: al dashboard solo viaja **resultado** (ok/error + detalle técnico), jamás credenciales.

### Disparadores (todos configurables)
1. **Al encender el equipo** (opción "primera vez que se enciende después de las HH:MM"): una tarea de Windows (Task Scheduler) o el arranque de la propia app dispara la verificación **una vez al día**, la primera vez que la PC arranca pasada la hora configurada. Evita correr en cada reinicio.
2. **Manual**: botón "▶ Verificar ahora" en la app (y/o en el dashboard admin → Diagnóstico).
3. **Horario fijo** (alternativa): correr a una hora determinada si el equipo está encendido.

### Aprobación del usuario (requisito)
- La verificación **abre Chrome y corre automatización real** → nunca debe sorprender al operador. Antes de correr, un **aviso**: "Se va a ejecutar la verificación diaria (1 procuración + 1 informe de prueba). ¿Ejecutar ahora / Posponer / Configurar?".
- Preferencia "no volver a preguntar hoy" / "correr siempre en silencio a las HH:MM" para el que ya confía.

### Panel de configuración (en la app Electron)
Sección nueva "Verificación automática" con:
- Activar/desactivar la verificación automática.
- Modo de disparo: al encender (con hora umbral) / horario fijo / solo manual.
- Hora umbral / hora fija.
- Qué corre: procuración (sí/no) + informe (sí/no) — default ambos, con 1–2 expedientes de prueba fijos.
- Pedir confirmación antes de correr (sí/no).
- Botón "▶ Verificar ahora" + resultado de la última corrida local.

### Aporte al Diagnóstico del dashboard admin
- La rutina reporta a un endpoint nuevo `POST /admin/diagnostics/verification` (o extiende el smoke existente) con: `timestamp`, `estado` (ok/parcial/error), `procuracion` (ok/error + tiempo + nº expedientes), `informe` (ok/error), `detalle` de errores.
- En **Diagnóstico** aparece una tarjeta nueva **"Verificación funcional (PJN real)"** con: **fecha y estado de la última verificación**, historial de las últimas N, y semáforo (verde reciente ok / amarillo hace >7 días / rojo último resultado con error).
- **Alerta de antigüedad (no bloqueante):** si pasaron **más de 7 días** sin una verificación exitosa, la tarjeta de Diagnóstico muestra un aviso "Hace más de 7 días que no se verifica el funcionamiento — te recomendamos correr una verificación". **Solo aparece en Diagnóstico**, no bloquea nada, no molesta al usuario final, no manda emails.

### Relación con `smoke-test-pjn.js` existente
- El script actual (48 checks de DOM/selectores) **se conserva** como verificación liviana y rápida.
- La verificación diaria real es **la capa pesada** (corre los scripts de verdad). Pueden compartir el reporte al dashboard (misma tarjeta o dos tarjetas hermanas en Diagnóstico).

### Entregables B.2
1. Módulo de verificación en la app (reusa los flujos de procuración/informe existentes con expedientes de prueba fijos).
2. Lectura de credenciales desde Windows Credential Manager.
3. Panel de configuración + disparador de arranque (Task Scheduler o lógica de arranque de la app) + botón manual.
4. Endpoint `POST /admin/diagnostics/verification` + tarjeta en Diagnóstico con fecha/estado/semáforo + alerta de >7 días.
5. Requiere **release de Electron** (toca la app). El endpoint + dashboard es backend (sin release de app).

---

# Parte C — SEC-4: Enforcement server-side del trial

## C.1 El problema (confirmado en el código)

- **`/license/execution/start`** (`routes/license.js:11`) hoy **solo adquiere el lock de dispositivo** — no mira cuota ni estado de suscripción. Cualquier cliente que pase el `machineId` obtiene el lock.
- **`middleware/checkLicense.js`** tiene la lógica correcta escrita (permite `active` o trial con `usage_count < usage_limit` + extras de cortesía) pero **no está montado en ninguna ruta** → es código muerto.
- El freno real del trial agotado hoy son: (a) el **pre-check del cliente Electron** (`run-process`) y (b) los **gates de la extensión** (server-side). La **descarga de scripts** (`/client/scripts/download`) y **`execution/start`** NO chequean usos.
- **Riesgo:** un cliente Electron adulterado (o un reemplazo del cliente) podría descargar el script y/o adquirir el lock y ejecutar **más allá del trial de 20**. Mitigado parcialmente (scripts cifrados/firmados, la app es el único cliente conocido), pero es el hallazgo de seguridad concreto más claro sin cerrar.

## C.2 La solución

Convertir `/license/execution/start` en el **gate autoritativo server-side**: toda ejecución pasa por ahí antes de correr, así que es el punto correcto para enforzar la cuota, espejo del enforcement que ya hace `log-execution` (pero **antes** de ejecutar, no después).

### Lógica a agregar en `execution/start` (antes de otorgar el lock)

Reusar/inline la lógica de `checkLicense.js`, adaptada al modelo trial-vs-pago vigente:

1. **Traer la suscripción del usuario** (join con `users` para `registration_status`).
2. **Estados bloqueantes** → 403 `action:'renew'`: sin suscripción vigente, o estado terminal (`rejected`, `cancelled`, `suspended_admin`, `suspended_plan_expired`, `suspended` por pago fallido).
3. **Trial** (`payment_provider IS NULL`): bloquear si `usage_count >= usage_limit + extras_de_cortesía` → 403 `action:'upgrade'` con el mensaje de trial agotado. Es la cuota global de 20 compartida.
4. **Pago** (`payment_provider` seteado): chequeo **por submódulo** espejando `log-execution` — mapear `scriptName` → subsistema (`proc`/`informe`/`batch`/`monitor_novedades`) y bloquear si `<subsistema>_usage >= <límite del plan> + <bonus>` → 403 `action:'upgrade'` con el mensaje del submódulo. (El `scriptName` ya se recibe en el body de `start`.)
5. Si pasa → otorga el lock como hoy.

### Refuerzo opcional (defensa en profundidad)
- **Descarga de scripts** (`/client/scripts/download/:name`): agregar el mismo chequeo de cuota, para que ni siquiera se pueda bajar el script cifrado con el trial agotado. Evaluar impacto en el caché del cliente (que re-descarga por versión) — quizás alcanza con gatear `execution/start` y dejar la descarga como está (el script cifrado no sirve sin poder ejecutar). **Decidir en implementación**; `execution/start` es el mínimo imprescindible.

### Qué NO se rompe
- **Trial normal**: el pre-check del cliente sigue funcionando igual (UX buena); el server ahora además lo respalda (si el cliente miente, el server frena).
- **Cuentas ilimitadas / activas**: `usage_limit=999999` global → el trial-check no las toca; el per-submódulo respeta sus límites reales (idéntico a `log-execution`).
- **`verify-session`/`refresh`**: siguen siendo capa de sesión (no de cuota) — no se tocan. El gate de cuota es `execution/start`, no la verificación de sesión (que debe permitir ver la cuenta aunque el trial esté agotado).

## C.3 Plan de implementación

1. **Escribir la lógica** de cuota como función reutilizable (extraer de `checkLicense.js` o crear `utils/quotaGate.js`) que devuelva `{ allowed, code, action, message }`.
2. **Montarla en `execution/start`** antes del upsert del lock.
3. **Alinear mensajes** con los que ya muestra el cliente (trial agotado vs límite de submódulo) para UX consistente.
4. **Probar en staging** con los 3 perfiles: trial 20/20 (→403 upgrade), activo con submódulo agotado (→403 upgrade del submódulo), activo con cupo (→200 lock). Incluir el caso "cliente que saltea el pre-check" simulando la llamada directa a `execution/start`.
5. **Deploy a prod** (solo backend, sin release de Electron — el cliente ya llama a `execution/start`; ahora ese endpoint además valida).
6. **Marcar `checkLicense.js`**: o se elimina (si la lógica se movió a `quotaGate.js`) o se documenta que quedó reemplazado. No dejar dos fuentes de verdad.
7. **Re-verificar S6.1/S6.4 de SEC-1** tras el fix → deben pasar a "bloqueado".

## C.4 Riesgo del cambio
🟡 Medio-bajo: toca un endpoint del camino caliente (toda ejecución pasa por `start`). Un error acá podría bloquear ejecuciones legítimas → por eso **staging + los 3 perfiles + un caso ilimitado** antes de prod. Reversible (revertir el endpoint). Sin cambios de DB.

---

## Orden sugerido de ejecución

1. **SEC-4 primero** (cierra un hallazgo real, es chico, solo backend, y hace que S6.1/S6.4 de SEC-1 den verde).
2. **SEC-1 después** (audita todo, ya con el trial cerrado; deja el informe de estado).
3. **SEC-2 en paralelo/después**: B.1 (CI) es rápido; B.2 (verificación diaria real) es el más grande (release de Electron) y se puede encarar cuando haya ventana para un release.

Ninguno bloquea a B3 (MercadoPago producción) ni a la Bitácora; son trabajo de robustez independiente.
