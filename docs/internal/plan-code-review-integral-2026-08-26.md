# Plan de campaña `/code-review` integral — ProcuradorTool (2026-08-26)

> **Qué es esto.** El plan de ejecución de una campaña de `/code-review` sobre todo el
> proyecto, más los 3 bloques de `/verify` que quedaron bloqueados por el entorno
> (V4/V5/V6). **No es un informe de hallazgos** — no se revisó código para escribirlo;
> se midieron tamaños y fechas reales para poder priorizar.
>
> **Lugar en el proyecto:** es la **Etapa 2** de `docs/internal/roadmap-salida-a-mercado-2026-08.md`.
> Corre **después** de que las mejoras de producto de la Etapa 1 estén en el árbol
> (Bitácora F3.4 + módulo Markdown), y **antes** de la auditoría de seguridad (Etapa 3).
> Ese orden no es estético: revisar código que está por reescribirse es trabajo tirado,
> y auditar seguridad sobre una superficie que el code-review va a cambiar obliga a
> auditar dos veces.
>
> ✅ **Confirmado el 2026-08-26:** los ítems 1.1 (Bitácora F3.4) y 1.2 (módulo Markdown) de la Etapa 1
> **fueron aprobados por el operador** y se van a construir. Este plan ya lo asumía: **F5 es el módulo
> Markdown** y **F1 declara depender de Etapa 1 cerrada** porque el `.ics` de F3.4 toca
> `routes/bitacora.js`. No hay nada condicional que ajustar acá. (La contraparte de seguridad no
> estaba cubierta — SEC-2 recibió el bloque **S10** el mismo día.)

---

## 0. Resumen ejecutivo

| | |
|---|---|
| **Fases** | 9 (F1–F8 de `/code-review` + F9 de `/verify` en runtime) |
| **Modelo dominante** | Sonnet (6 de 9). **Opus en 2**: cadena de cifrado/firma de scripts (F6) y cobranza (F7). El motor de anonimización dentro de F5 también va en Opus. |
| **Esfuerzo dominante** | `xhigh` en las 3 fases de código grande y nunca revisado (F1, F2, F4); `high` en 4; `medium` en 1 |
| **`ultra` (multi-agente en la nube)** | **Ninguna fase lo justifica hoy.** Ver §5 — se reserva como escalamiento de F7 si el code-review encuentra algo en el camino del dinero |
| **Sesiones estimadas** | **9–13**. Las 3 fases `xhigh` (F1, F2, F4) consumen sesión propia y probablemente más de una; F9 depende del operador |
| **Depende de** | Etapa 1 cerrada (si no, F2/F3/F5 revisan código que va a cambiar) |
| **Habilita** | Etapa 3 (SEC-2, auditoría de seguridad) y — vía F7 — la Etapa 4 (MercadoPago producción) |

---

## 1. Qué ya está revisado y no se re-revisa

Esto existe para que la campaña no repita trabajo hecho. Tres pasadas previas dejaron
cobertura real:

| Campaña | Fecha | Qué cubrió | Estado |
|---|---|---|---|
| **E1–E6** (`plan-revision-integral-2026-07-27.md`) | 2026-07-27 | Motor Puppeteer, Electron `main.js`/`preload`/`src/`, los 11 crons, visores/Excel/onboarding, schema DB + distribución de scripts, frontends (grep dirigido) | ~35 hallazgos, **los ~35 corregidos y desplegados** (`plan-correcciones-E1-E6`, Bloques A–E) |
| **3 revisiones de bugs** | 2026-07-24 / 25 / 25b | Cobranza, cuotas, licencia, monitor · auth/admin/tickets/facturas/rate-limits · extensión Chrome, mailer, legal/analytics | 21 hallazgos, los 21 cerrados |
| **Campaña `/verify`** | 2026-08-23/24 | 7 de 10 bloques **ejecutando** el producto (portal, dashboard, API Bitácora, cobranza) | 4 bugs reales + 5 hallazgos, los 9 cerrados |

**Consecuencia práctica:** el motor Puppeteer (`backend-server/scripts/`) — que en julio era
la mayor superficie sin revisar del proyecto — hoy **ya tuvo su pasada (E1) y sus fixes
aplicados (Bloques C.1/C.2)**, y salvo un archivo no cambió desde entonces. Baja de
prioridad; no se omite (ver **F8**).

---

## 2. El hueco real, medido

Medición hecha el 2026-08-26 sobre el árbol real (`du -k` + `git log -1` por archivo),
no estimada:

| Área | Tamaño | Último cambio | ¿Revisión de código previa? |
|---|---|---|---|
| `public/dashboard/dashboard.js` | **324 KB** | 2026-08-24 | ❌ solo grep dirigido (E6) |
| `public/usuarios/app.js` | **236 KB** | **2026-08-26** | ❌ solo grep dirigido (E6) |
| `electron-app/renderer.js` | 180 KB | 2026-08-15 | ⚠️ parcial (solo handlers de lote) |
| `routes/admin.js` | 168 KB | 2026-08-14 | ⚠️ parcial (campos del fix XSS-1) |
| `electron-app/main.js` | 148 KB | **2026-08-26** | ✅ E2 — **pero cambió mucho después** |
| `backend-server/scripts/testM2.js` | 104 KB | 2026-07-28 | ✅ E1, **sin cambios desde entonces** |
| `routes/bitacora.js` | **84 KB** | **2026-08-26** | ❌ **nunca** |
| `services/subscriptionService.js` | 44 KB | 2026-07-24 | ⚠️ revisión de bugs, no code-review |
| `routes/capture.js` + `utils/captureDrafts.js` | 12 KB | 2026-08-26 | ❌ **nunca** — es el **único endpoint anónimo** del sistema |
| `utils/mercadopago.js` | 8 KB | 2026-08-24 | ❌ nunca (el guard de staging es nuevo) |

**El titular:** todo el módulo **Bitácora** (F1.1–F3.3, ~15 sub-bloques, 4 tablas nuevas,
~15 endpoints, el único endpoint anónimo del sistema, y el crecimiento de `usuarios/app.js`
hasta 236 KB) **se construyó entero después de la última revisión integral** y nunca tuvo una
pasada de código. Fue verificado *funcionalmente* (F3.0, 55/55 casos; V1a/V1b/V3 de `/verify`),
que es otra cosa.

**El segundo titular:** los 2 archivos más grandes del proyecto (`dashboard.js` 324 KB y
`usuarios/app.js` 236 KB) nunca tuvieron más que un `grep` dirigido a escapes de HTML, y
entre los dos concentran casi todos los `fix:` de UI que el operador detectó con el producto
ya en producción (5 en agosto, 4 detectados por él).

---

## 3. Zonas protegidas — regla dura para toda la campaña

Estas rutas se revisan **en modo solo lectura**. **Ningún `/code-review` sobre ellas puede
correr con `--fix`**, y ningún hallazgo se aplica sin que el operador lo apruebe línea por
línea:

- `backend-server/keys/` — claves RSA privadas
- `backend-server/certs/` — certificados
- `electron-app/src/security/` — cifrado, verificación de firma, autodestrucción
- Cualquier código de `machineId` / hardware binding (`src/auth/machineId.js`, el binding
  server-side de `routes/license.js`)
- Los campos `usage_count` / `usage_limit` y los `*_bonus` / `*_usage` en DB
- `extension-app/manifest.json` — un cambio de permisos dispara re-revisión de Google y
  puede tumbar la extensión publicada

> El precedente que justifica la regla: el plan Q6 cerró los 9 fail-opens de verificación
> de firmas **sin tocar una línea de `src/security/`** — se resolvió desde los llamadores.
> Esa disciplina se mantiene.

**Además:** las fases que tocan código servido a usuarios (F2, F4) no aplican `--fix` de
forma masiva. Se aplica por hallazgo, con despliegue staging → prod y verificación, igual
que cualquier cambio del proyecto.

---

## 4. Las fases

### F1 — Bitácora, backend completo 🔴

| | |
|---|---|
| **Target** | `backend-server/routes/bitacora.js`, `backend-server/routes/capture.js`, `backend-server/utils/captureDrafts.js`, `backend-server/middleware/checkBitacoraPlan.js`, `backend-server/utils/expedienteKey.js` |
| **Modo** | **path completo** (nunca tuvo revisión) |
| **Modelo / esfuerzo** | Sonnet · **`xhigh`** |
| **Depende de** | nada — puede arrancar apenas cierre la Etapa 1 |

**Por qué existe.** ~112 KB de código escrito íntegramente **después** de la campaña E1–E6,
con cero revisiones de código. Contiene las 3 cosas que más caro salen si tienen un bug
silencioso en este módulo:

1. **El único endpoint anónimo del sistema** (`POST /usuarios/capture`) — sin auth por
   diseño, con 5 protecciones documentadas y un almacén efímero en memoria.
2. **El gate de plan por sub-paths** (`checkBitacoraPlan`) — montado sobre el mismo prefijo
   que `routes/usuarios.js`; si el matching se rompe, 8 rutas vivas del portal quedan en 403.
   Ya se verificó funcionalmente (39/39 en F1.2, 29/29 en V3) pero nunca se leyó como código.
3. **`expedienteKey()`** — la normalización canónica que evita fichas duplicadas. Tiene
   **dos implementaciones** (backend + `tokenizar()` en Electron), sincronizadas únicamente por
   un fixture compartido de 15 casos. Un cambio en una sola de las dos es un bug silencioso
   con meses de latencia.

**Qué NO cubre:** el ángulo adversarial del endpoint anónimo (desalojo del almacén FIFO,
abuso de volumen). Eso es **S1 de SEC-2** (Etapa 3), que además ya tiene 2 hallazgos
detectados ahí (H-2, H-3).

**Por qué Sonnet y no Opus:** no toca dinero ni la cadena de integridad de scripts. El riesgo
es de corrección, no de superficie crítica — y el ángulo de seguridad tiene su propia etapa.

---

### F2 — Portal de usuarios (frontend) 🔴

| | |
|---|---|
| **Target** | `backend-server/public/usuarios/app.js` (+ `index.html`, `app.css` como contexto) |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | Sonnet · **`xhigh`** |
| **Depende de** | Etapa 1 cerrada (Bitácora F3.4 toca este archivo) |

**Por qué existe.** 236 KB, modificado hoy, y **el archivo con peor historial de
defectos-detectados-en-producción del proyecto**: de los 5 commits `fix:` que tocaron
`public/usuarios/` en agosto, **4 los encontró el operador con el producto ya en producción**
— ese dato es literalmente lo que motivó la campaña `/verify`. `/verify` encontró después
2 bugs más ahí (doble submit en 6 formularios). La conclusión honesta es que este archivo
falla por debajo del radar de todo lo que se le aplicó hasta ahora.

**Sugerencia de partición** (si el target completo resulta inmanejable): dos pasadas —
(a) Bitácora + Mis Expedientes + captura, (b) el resto (login, plan, facturación, tickets,
notificaciones, perfil, ayuda). No partir por líneas: partir por sección funcional.

**Qué NO cubre:** el render real en navegador. Eso ya lo hicieron V1a/V1b de `/verify`, y
lo que quede se cubre en F9.

---

### F3 — Visores y captura del lado cliente 🟠

| | |
|---|---|
| **Target** | `electron-app/visorModal_template.html`, `electron-app/informe/visor_informes_template.html`, `electron-app/informe/generador_visor.js`, `generador_excel.js`, `buscarPdfExpediente.js`, `motivoInformeSinPDF.js`, y los bloques de post-procesado/captura de `electron-app/main.js` |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | Sonnet · **`high`** |
| **Depende de** | nada |

**Por qué existe.** Criterio de "código frágil señalado por el operador": el 2026-08-26 el
operador reportó **21 hallazgos** probando el flujo real de captura desde el visor
(`plan-fixes-visor-bitacora-2026-08-26.md`) — navegación rota, estado "guardado" no reflejado,
pestañas acumulándose, carátula vacía en el flujo de informe. Los 21 se corrigieron (B0–B4,
release v2.7.50), **pero un volumen así de hallazgos en una sola sesión de uso es la señal más
fuerte de código frágil que dio el proyecto este mes**, y el rediseño que los corrigió todavía
no tuvo ninguna pasada de revisión.

Incluye además la superficie que E4 marcó como confirmada: la interpolación de datos del PJN en
los visores. El fix de escape (`esc()`/`escAttr()`) se aplicó en el Bloque D de julio, pero los
visores se rediseñaron enteros después.

---

### F4 — Dashboard admin 🟠

| | |
|---|---|
| **Target** | `backend-server/public/dashboard/dashboard.js` (+ `dashboard.css` como contexto) |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | Sonnet · **`xhigh`** |
| **Depende de** | nada |

**Por qué existe.** 324 KB, el archivo más grande del proyecto, y **una migración masiva muy
reciente sin revisión de código**: VF-3 reemplazó **71 diálogos nativos en 30 funciones** el
2026-08-24. Esa migración se verificó por script (0 sitios nativos restantes) y navegando las
12 secciones, pero la clase de bug que introduce es exactamente la que un script no ve: **un
`await` faltante convierte un `confirm()` migrado en un no-op silencioso que sigue de largo**.
El informe de esa sesión dice que las 30 funciones ya eran `async` — eso reduce el riesgo, no
lo elimina (el riesgo que queda es un `showConfirm()` cuyo resultado no se mira).

Segundo motivo: es el panel donde un admin **suspende cuentas, aplica beneficios, edita pagos
y publica documentos legales**. Un bug acá no lo sufre el admin, lo sufre un cliente.

---

### F5 — Módulo Markdown / Anonimización (código nuevo) 🟠

| | |
|---|---|
| **Target** | los archivos nuevos de la Etapa 1.2 — ver `plan-modulo-markdown-anonimizacion-2026-08-26.md` |
| **Modo** | **diff / branch** (código nuevo, no hay historia que revisar) |
| **Modelo / esfuerzo** | **partido**: motor de anonimización → **Opus · `high`** · resto del módulo (UI, ingesta, descargas, gating) → Sonnet · `high` |
| **Depende de** | Etapa 1.2 terminada |

**Por qué el motor va en Opus.** Es el caso de libro de "bug silencioso con alto radio de
impacto": el usuario va a **confiar** en que el `.md` anonimizado no tiene datos personales y
lo va a compartir. Un nombre que el motor no detecta no produce ningún error visible — produce
una fuga que el usuario descubre después de haber mandado el archivo. Eso pesa más que el
tamaño del código.

**Qué debe mirar sí o sí:** falsos negativos del regex de nombres (acentos, nombres compuestos,
apellidos con partículas, mayúsculas/minúsculas, nombres embebidos en otras palabras), el orden
de aplicación de reglas (una regla que corre después de otra puede no encontrar nada porque la
primera ya reemplazó), y que el reprocesamiento en memoria parta siempre del **original** y no
del ya anonimizado (aplicar dos veces = enmascarar el enmascarado).

---

### F6 — Cadena de cifrado y distribución de scripts 🔴 **Opus** — *pedido explícito del operador*

| | |
|---|---|
| **Target (revisión)** | `backend-server/utils/scriptEncryption.js`, `backend-server/reencrypt_scripts.js`, `backend-server/routes/client.js` (`/scripts/download`, `/check`, `/available`), `electron-app/src/auth/authManager.js` (las 3 etapas de verificación) |
| **Target (SOLO LECTURA, sin `--fix`)** | `backend-server/src/security/scriptSigner.js`, `signatureCache.js`, `electron-app/src/security/*` |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | **Opus** · `high` |
| **Depende de** | nada — pero conviene correrla temprano (ver §5) |

**Por qué existe.** El operador pidió explícitamente *"verificar que los scripts se encripten
correctamente"*. Es la cadena que protege el activo central del producto (la automatización) y
la que decide si un script adulterado llega a ejecutarse en la máquina del cliente. El plan Q6
cerró 9 fail-opens ahí en agosto — este es el primer ojo sobre el resultado.

**Esta fase no es solo lectura: incluye una verificación ejecutable.** Un review que diga "el
código parece correcto" no responde la pregunta del operador. El entregable incluye un harness
que, **contra staging**:

1. Descarga los **13 scripts de la whitelist** con un JWT real.
2. Descifra cada uno con la clave real y **verifica la firma RSA**.
3. Compara el hash del descifrado contra `encrypted_scripts.hash` en la DB.
4. Compara el descifrado contra el `.js` fuente del repo → detecta **drift entre lo desplegado
   y lo versionado** (riesgo real y con antecedente: el `reencrypt_scripts.js` tocó producción
   por error el 2026-07-28 por el bug de `dotenv` sin path).
5. Confirma que los **6 scripts filtrados por la whitelist siguen dando 404** (`backup-db.js`,
   `reset-admin-password.js`, `data-retention.js`, `canary-test.js`, `test_registro.js`,
   `validarCampoParteScwpjn.js`) — el hallazgo P-1 de E5.
6. Confirma que **ningún script se sirve sin bloque `security`** (el fix C1/F9 de Q6, Fase 1).

**Regla de la fase:** cualquier hallazgo dentro de `src/security/` se documenta y se corrige
**desde el llamador**, como hizo Q6. Nada de `--fix` ahí.

---

### F7 — Cobranza 🔴 **Opus** — *gate duro de la Etapa 4*

| | |
|---|---|
| **Target** | `backend-server/routes/checkout.js`, `routes/webhooks.js`, `services/subscriptionService.js`, `services/invoiceService.js`, `utils/mercadopago.js`, y los crons de cobro/vencimiento de `server.js` |
| **Modo** | **path completo** |
| **Modelo / esfuerzo** | **Opus** · `high` |
| **Depende de** | nada, pero **debe estar cerrada antes de la Fase C de B3** |

**Por qué existe y por qué Opus.** Único criterio que aplica sin discusión: dinero real. Hoy
todo apunta al sandbox, así que un bug no cuesta nada; el día que B3 cambie las credenciales,
el mismo bug cobra o deja de cobrar de verdad.

**Lo que ya está cubierto y NO hay que rehacer:** V7 de `/verify` ejercitó 40/40 aserciones en
runtime contra staging el 2026-08-24 (gate de activación, guard B3 de mismatch de plan, HMAC en
5 variantes incluida la positiva, idempotencia de `webhook_events`, fixes B1/B2 vigentes, los 3
guards de reactivación, la doble protección de los crons de corte).

**Lo que V7 declaró explícitamente NO cubierto — y que es exactamente lo que esta fase debe
mirar como código, porque no se puede ejercitar sin una persona pagando:**

- La **transacción atómica de `handlePaymentEvent`** (fix M4): sus piezas se verificaron, su
  composición dentro del `BEGIN/COMMIT` no. El `ROLLBACK` ante fallo intermedio nunca se ejerció.
- **`markPaymentConfigured` / `reconcileClaimedCheckout`** — la atribución del preapproval **por
  ventana de tiempo**. Es lo más delicado de toda la cadena y tiene un riesgo aceptado y
  documentado desde junio: *colisión si dos usuarios pagan en la misma ventana de minutos*.
  Con 0 clientes eso es teórico; con clientes reales es una acreditación cruzada.
- **`updatePreapprovalAmount`** (cambio de plan → monto en MP).

**Escalamiento posible:** si esta fase encuentra algo real en la atribución por ventana, es la
única candidata razonable a repetirse en `ultra`. Ver §5.

---

### F8 — Motor Puppeteer, solo el delta 🟢

| | |
|---|---|
| **Target** | `backend-server/scripts/informequickscwpjn.js` — y cualquier otro `scripts/*.js` con cambios posteriores al 2026-07-28 |
| **Modo** | **diff** contra el estado revisado por E1 (2026-07-27) + Bloques C.1/C.2 |
| **Modelo / esfuerzo** | Sonnet · **`medium`** |
| **Depende de** | nada |

**Por qué existe (y por qué es de las últimas).** Aplica el criterio de *superficie ya cubierta
por una revisión reciente y sin cambios desde entonces → bajar de prioridad, no omitir*. Medido:
de los 18 archivos de `backend-server/scripts/`, **17 no cambiaron desde el 2026-07-28** (la
fecha de los fixes de E1). El único que sí cambió es `informequickscwpjn.js` (2026-08-26, el fix
B4 de carátula del flujo de informe).

Revisar de nuevo `testM2.js` (104 KB) o `procesarNovedadesCompleto.js` (48 KB) sin que hayan
cambiado sería repetir E1 — el error que este plan existe para evitar.

---

### F9 — `/verify` V4 + V5 + V6 (runtime, con el operador) 🟠 **no es un `/code-review`**

| | |
|---|---|
| **Qué es** | Los 3 bloques de `docs/internal/plan-verificacion-runtime-2026-08-23.md` que quedaron **bloqueados por el entorno, no por prioridad**. Los playbooks ya están escritos ahí — esto es ejecución, no diseño. |
| **V4** | Electron **sin** PJN — computer-use, no consume cupo · 🟡 |
| **V5** | Electron **con** PJN (5 flujos reales) — computer-use + credenciales · **consume cupo** · 🔴 |
| **V6** | Extensión Chrome (5 flujos) — Chrome real + credenciales · **consume cupo** · 🔴 |
| **Modelo / esfuerzo** | Sonnet · medio (V4/V6) — **Opus no hace falta**: ningún bloque toca cobro |
| **Depende de** | **el handle del entorno** (ver abajo) y de que F1–F5 hayan aplicado sus fixes |

**Por qué siguen abiertos, con la causa acotada (no es prioridad ni tiempo):**

- **V4/V5** — `request_access` de computer-use devuelve `notInstalled` para "Procurador SCW"
  **incluso con la app abierta**; es el aislamiento de sesiones de Windows ya documentado en la
  sesión de F3.1 (un proceso lanzado desde la shell vive en una sesión que la herramienta no ve).
  **Precedente de que sí se puede:** el 2026-07-23 la sesión de R2.1 condujo la instalación NSIS
  completa con computer-use sin problema — la condición existe, hay que reproducirla (app lanzada
  desde la sesión visible al agente, no desde la shell).
- **V6** — `list_connected_browsers` devuelve `[]`: no hay Chrome conectado por la extensión
  Claude-in-Chrome, así que no hay camino a un navegador real con la extensión del PJN cargada.

**Ajuste de alcance de V6 respecto del plan original:** **R9.1 / R9.2 ya están cerrados** — el
operador confirmó el 2026-08-26 el login del popup y un flujo completo contra el PJN real. Eso
era la mitad *funcional* de V6. Lo que queda es la parte estructurada: los 5 flujos con
aserciones, los gates por plan desde la extensión, y el manejo de errores — más una **revisión
de código de `extension-app/`** (~10 archivos chicos; solo tuvo la pasada parcial de D5 en julio),
que conviene hacer en la misma sesión.

---

## 5. Orden de ejecución y por qué

```
   F6 ─┐  cifrado de scripts (Opus) — temprano: si algo está roto acá,
       │  cambia la prioridad del proyecto entero
       │
   F1 ─┤  Bitácora backend        ─┐
   F3 ─┤  visores / captura        │  paralelizables entre sí:
   F4 ─┤  dashboard admin          │  tocan archivos distintos
   F2 ─┘  portal de usuarios      ─┘
       │
   F5 ─┤  módulo Markdown (cuando exista el código)
       │
   F8 ─┤  delta del motor Puppeteer (barato, cierra el círculo)
       │
   F7 ─┤  COBRANZA — Opus ── gate duro ──► habilita Etapa 4 (B3)
       │
   F9 ─┘  /verify V4+V5+V6 ── requiere operador ── DESPUÉS de que
          los fixes de F1–F5 estén desplegados
```

**Las tres decisiones de orden que importan:**

1. **F6 va primero aunque no sea la más grande.** Si la cadena de cifrado tiene un problema real,
   deja de tener sentido revisar features: cambia la prioridad del proyecto entero. Además es la
   más barata de las dos fases Opus.
2. **F7 va al final de la campaña, no al principio.** No porque sea menos importante — es la más
   importante — sino porque su valor es servir de **gate inmediato a B3**: si se corre primero y
   después pasan 8 sesiones de campaña, hay que revalidarla. Correrla último la deja fresca al
   entrar a la Etapa 4.
3. **F9 va después de los fixes, no antes.** Verificar en runtime un producto al que le faltan los
   arreglos de F1–F5 produce hallazgos que se corrigen solos al aplicar esos fixes.

**Sobre `ultra`:** ninguna fase lo justifica de entrada. Es una revisión multi-agente en la nube,
es cara, y **la enciende el operador** (no se puede lanzar desde una sesión). El único caso donde
lo recomendaría es **una segunda pasada de F7** si la primera encuentra algo concreto en la
atribución de pagos por ventana de tiempo — ahí el radio de impacto (acreditar el pago de un
cliente a la cuenta de otro) paga el costo.

---

## 6. Lo que esta campaña NO cubre

Dicho explícitamente para que "campaña ejecutada" no se confunda con "proyecto revisado":

- **Seguridad adversarial** — es la Etapa 3 (`plan-seguridad-lanzamiento-2026-08.md`, SEC-2 +
  Strix). Un `/code-review` busca bugs; una auditoría busca a alguien atacando.
- **Pruebas de carga / concurrencia real** — nunca se hicieron en todo el proyecto. Cobran
  importancia real recién con MercadoPago en producción.
- **`electron-app/src/security/`** — se lee, no se audita su lógica interna (zona protegida).
- **El primer pago real de punta a punta** — requiere una persona en el checkout. Es la Fase C de
  B3, no esto.
- **Otros navegadores / mobile real** — sigue sin cubrirse, igual que declaraba §7 del plan de
  `/verify`.

---

## 7. Prompts de arranque

**F1** (adaptar el target por fase):

```
/code-review xhigh backend-server/routes/bitacora.js backend-server/routes/capture.js backend-server/utils/captureDrafts.js backend-server/middleware/checkBitacoraPlan.js backend-server/utils/expedienteKey.js
```

> Contexto para la sesión: leer §4/F1 de `docs/internal/plan-code-review-integral-2026-08-26.md`
> y §3 (zonas protegidas). Este código nunca tuvo revisión. Atención especial al gate por
> sub-paths y a que `expedienteKey()` tiene una segunda implementación en Electron
> (`tokenizar()` en `buscarPdfExpediente.js`) sincronizada solo por
> `tests/fixtures/expediente-key-cases.json`.

**F6** (la que además ejecuta):

> Ejecutá la fase F6 de `docs/internal/plan-code-review-integral-2026-08-26.md` — cadena de
> cifrado y distribución de scripts. **Opus, esfuerzo alto.** Incluye el harness de verificación
> ejecutable de los 6 puntos de la fase, corrido **contra staging** (nunca prod).
> `electron-app/src/security/` y `backend-server/src/security/` son solo lectura: los hallazgos
> ahí se corrigen desde el llamador o se documentan, jamás con `--fix`.

**F7:**

> Ejecutá la fase F7 de `docs/internal/plan-code-review-integral-2026-08-26.md` — cobranza.
> **Opus, esfuerzo alto.** Leé primero `docs/internal/verify-V7-2026-08-24.md` para no repetir lo
> ya verificado en runtime, y concentrate en los 3 puntos que V7 declaró NO cubiertos.
