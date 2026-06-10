# Revisión integral — Procurador SCW

> **Fecha:** 2026-06-10
> **Alcance:** seguridad + funcionamiento, plan de corrección, plan de marketing (salida Beta con COMBO_PROMO + EXTENSION_PROMO) y pendientes.
> **Método:** auditoría real del código y dependencias (no solo lectura de docs) — `npm audit`, escaneo de patrones (SQLi, eval, uploads, CORS, TLS), revisión de configuración de servidores.
> **Veredicto:** **Apto para Beta controlada.** La base es sólida (auth, cifrado, pagos). Los hallazgos son de robustez/mantenimiento, no vulnerabilidades críticas explotables en el flujo real.

---

## 1. Resumen ejecutivo (para socios)

El producto está **funcional y vendible** para una Beta acotada. No hay agujeros de seguridad críticos en la lógica propia (sin inyección SQL, sin `eval`, credenciales del PJN nunca tocan el servidor, scripts cifrados con AES+RSA, pagos con webhook HMAC timing-safe). La seguridad interna del código está cerrada (M-1, M-2, B-1..B-8 resueltos en sesiones previas).

Lo que falta para un **lanzamiento masivo** (no Beta) es: firma del instalador, actualización de dependencias con CVEs conocidos, smoke tests automáticos en CI, y una auditoría externa. Nada de eso bloquea arrancar con **clientes Beta seleccionados** de la red cercana.

---

## 2. Hallazgos de seguridad

### 🟢 Lo que está bien (fortalezas verificadas)
- **Sin inyección SQL:** el escaneo de queries con template literals dio limpio — todo usa parámetros (`$1, $2`).
- **Sin `eval` / `new Function` / `child_process`** en rutas, servicios ni middleware.
- **Uploads de facturas seguros:** `multer` con límite 5 MB, filtro de MIME (`application/pdf`), nombre de archivo **generado** (`factura_<id>_<ts>.pdf`) — no usa el nombre del usuario → sin path traversal.
- **CORS con allowlist** + excepción explícita para `chrome-extension://` (la extensión).
- **CSP activa** en Helmet (defensa en profundidad XSS).
- **TLS ≥ 1.2**, `rejectUnauthorized:false` solo en llamadas a `localhost` con cert auto-firmado (correcto).
- **Secretos fuera del repo** (incidente GitGuardian del 2026-06-08 resuelto y rotado).

### 🔴 Vulnerabilidades de dependencias (CVEs conocidos)
`npm audit` reporta paquetes con vulnerabilidades. La mayoría son **transitivas** o de **dev**, pero hay que tratarlas antes del público.

**Backend (14: 7 high, 7 moderate)** — las relevantes en runtime:
| Paquete | Severidad | Riesgo | Vía |
|---|---|---|---|
| `lodash` | High | Code injection vía `_.template` | transitiva |
| `nodemailer` | High | Email a dominio no intencional (interpretation confusion) | **directa** (emails) |
| `path-to-regexp` | High | DoS por grupos opcionales secuenciales | Express |
| `express-rate-limit` | High | Bypass de rate-limit con IPv6-mapped IPv4 | **directa** |
| `mercadopago` → `uuid` | Moderate | Buffer bounds en uuid v3/v5/v6 | **directa** (pagos) |
| `qs` | High | DoS en `qs.stringify` | Express |
| `fast-xml-builder`, `fast-uri`, `minimatch` | High | Quote bypass / path traversal / ReDoS | transitivas |

**Electron (14: 1 critical, 5 high, 8 moderate)** — mayormente **dev/build**:
| Paquete | Severidad | Riesgo | Contexto |
|---|---|---|---|
| `basic-ftp` | **Critical** | Path traversal en `downloadToDir()` | transitiva (electron-builder, **dev**) |
| `axios` | High | SSRF por bypass de NO_PROXY | runtime — revisar |
| `undici` | High | Crash de parser por WebSocket length overflow | transitiva |
| `tmp`, `minimatch`, `fast-uri` | High | Path traversal / ReDoS | dev/build |

> **Lectura realista:** ninguna es trivialmente explotable en el flujo actual (la mayoría requieren input atacante que no llega a esos paquetes). Pero `nodemailer`, `express-rate-limit`, `axios` y `mercadopago→uuid` están en runtime y conviene actualizarlas.

### 🟡 Debilidades menores
- **Archivos temporales en el repo:** `backend-server/test_legal_tmp.js`, `test_legal_full_tmp.js`, `seed_legal_tmp.js` — código muerto con llamadas HTTPS a localhost. Limpiar.
- **Código CRX deprecado:** `routes/extension.js` + `public/extension/` siguen montados (documentado como "código muerto, no eliminar"). No es riesgo, pero amplía superficie.
- **CSP con `'unsafe-inline'`:** tradeoff conocido por los `onclick`/estilos inline. Aceptable para Beta; ideal migrar a handlers externos a futuro.

---

## 3. Hallazgos de funcionamiento / infraestructura

| # | Debilidad | Impacto | Severidad |
|---|---|---|---|
| F-1 | **Sin firma de código** (Azure Trusted Signing) | SmartScreen advierte en cada instalación → fricción y desconfianza en la venta | **Alta** (comercial) |
| F-2 | **SSL prod vence 2026-06-29** | Si certbot no renueva, la API cae | **Alta** (3 semanas) |
| F-3 | **VPS único** (prod + staging + DB en 142.93.64.94) | Sin redundancia: una caída del droplet = servicio caído. Single point of failure | Media |
| F-4 | **Sin CI / smoke tests en cada push** | Un deploy puede romper prod sin que se detecte automáticamente | Media |
| F-5 | **Sin auditoría de seguridad externa** | Recomendada antes del público masivo | Media (pre-masivo) |
| F-6 | `renderer.js` monolítico (~166 KB) | Mantenibilidad; decisión consciente de no refactorizar aún | Baja |
| F-7 | **Sin contrato Facturante** | Facturación es manual (admin sube PDF de ARCA) | Baja (operativa) |

> **Lo que SÍ está bien a nivel infra:** backups diarios automáticos (03:00 → DO Spaces offsite + local, retención 30 días), staging aislado con rollback bidireccional probado, restore validado E2E.

---

## 4. Plan de corrección (priorizado)

### 🔴 Antes de sumar clientes Beta (esta semana)
1. **F-2 — Verificar renovación SSL:** `certbot renew --dry-run` en el server. Si falla, resolver antes del 29/06. *(15 min)*
2. **Dependencias runtime:** correr `npm audit fix` (sin `--force`) en `backend-server/` y `electron-app/`, probar en **staging** primero, luego prod. Atiende lodash, qs, express-rate-limit sin breaking changes. *(1-2 h con prueba en staging)*

### 🟠 Durante la Beta (primeras 2-4 semanas)
3. **F-1 — Iniciar Azure Trusted Signing:** tiene tiempos externos (perfil de certificado 1-3 días hábiles). Arrancar el trámite ya aunque la firma se aplique después. *(trámite + ~USD 9/mes)*
4. **Limpiar código muerto:** borrar `test_legal_tmp.js`, `test_legal_full_tmp.js`, `seed_legal_tmp.js`. *(20 min)*
5. **F-4 — Smoke tests en CI:** workflow GitHub Actions que corra `smoke-test-pjn.js` + `npm audit` en cada push a `main`. *(medio día)*

### 🟡 Antes del lanzamiento público (post-Beta)
6. **`npm audit fix --force` controlado:** atacar mercadopago/uuid, axios, undici evaluando breaking changes en staging.
7. **F-5 — Auditoría de seguridad externa** (SEC-1).
8. **F-3 — Evaluar redundancia:** snapshot automático del droplet o segunda instancia. Recién relevante con volumen.
9. **CSP sin `'unsafe-inline'`:** migrar handlers inline a archivos JS externos.

---

## 5. Plan de marketing — salida Beta (COMBO_PROMO + EXTENSION_PROMO)

> Base: `docs/plan-captacion-clientes.md` (ya existente). Acá se adapta a la salida con **los dos planes**.

### 5.1 Posicionamiento de los dos planes
| Plan | Precio | A quién apunta | Gancho |
|---|---|---|---|
| **EXTENSION_PROMO** | $1.500/mes | Entrada / prueba de bajo riesgo: cualquier abogado que carga expedientes en el PJN | "Dejá de tipear jurisdicción/número/año a mano en los 5 módulos del PJN. $1.500/mes." |
| **COMBO_PROMO** | $15.000/mes | Procuradores que litigan en volumen | "Procuración, informes y monitoreo **en automático**. Recuperá horas por semana." |

**Estrategia de embudo:** la **extensión ($1.500)** es el caballo de Troya — barata, sin fricción, demuestra valor en 1 día. El **combo ($15.000)** es el upsell natural cuando el cliente confía. Vendé la extensión a todos; convertí a combo a los que litigan en volumen.

### 5.2 El activo #1: el video "antes/después"
Sin esto, todo cuesta el triple. Grabar **dos** videos cortos (60-90 s):
- **Video A (extensión):** carga manual de un expediente vs. con la extensión.
- **Video B (combo):** procuración de un expediente real a mano (mostrar el tiempo) vs. la app haciéndolo sola + el informe generado.

### 5.3 Fases de captación
1. **Red cercana (semana 1-2):** lista de todos los abogados/procuradores que conocés. Mensaje 1-a-1, no masivo. Ofrecé demo de 5 min con **su** expediente. Meta: 10-15 clientes.
2. **Testimonios (continuo):** a cada cliente Beta pedile testimonio en video + feedback. Tres testimonios de colegas reales > cualquier anuncio.
3. **Instagram como credibilidad (semana 2+):** cuenta profesional "Procurador SCW / TOOL", bio con frase de valor + link de registro. Publicar 2-3 veces/semana: demos, tips para procuradores, prueba social. Vender por **DM**, no por feed.
4. **Alcance dirigido (semana 4+):** Colegios de Abogados/Procuradores (una recomendación institucional = 10-20 clientes), grupos de WhatsApp/Telegram de litigantes, LinkedIn. DMs personalizados con el video, 10 buenos por día > 200 genéricos.

### 5.4 Manejo de la objeción de confianza (clave en B2B legal)
La objeción será *"¿es seguro darles acceso al PJN?"*. **Convertila en argumento de venta:**
> "Las contraseñas del PJN **nunca pasan por nuestros servidores**. La app usa tu propio Chrome y el gestor de contraseñas de Google. Nosotros nunca las vemos."

### 5.5 Métricas de la Beta
- **Meta:** 50 clientes con precio fundador.
- **Seguir:** registros → activaciones → conversión a pago → retención mensual.
- **Señal de oro:** % de clientes de extensión que suben a combo.

### 5.6 Pre-requisitos comerciales antes de empujar fuerte
- **Firma del .exe (F-1):** el SmartScreen asusta a abogados. Para la red cercana se puede explicar ("es normal, hacé click en Continuar"); para alcance frío conviene tenerlo firmado.
- **MercadoPago producción (B3):** hoy los pagos están en sandbox. **Para cobrar de verdad hay que activar B3.** Es el bloqueante #1 para vender.

---

## 6. Listado de tareas pendientes (consolidado)

### 🔴 Bloqueantes para cobrar / vender
- [ ] **B3 — MercadoPago producción:** credenciales reales al `.env` por SSH (nunca al repo) + validar 1 cobro real. **Sin esto no se cobra.**
- [ ] **F-2 — Verificar SSL** (vence 29/06): `certbot renew --dry-run`.

### 🟠 Antes / durante la Beta
- [ ] **AZ / F-1 — Azure Trusted Signing:** iniciar trámite (tiempos externos).
- [ ] **Dependencias:** `npm audit fix` en backend + electron, probado en staging.
- [ ] **Marketing:** grabar los 2 videos antes/después.
- [ ] **Marketing:** armar lista de red cercana + primeros 10 DMs.
- [ ] **Subir extensión v1.3.4** al Chrome Web Store (ZIP listo).
- [ ] **Limpiar temporales:** `test_legal_tmp.js`, `test_legal_full_tmp.js`, `seed_legal_tmp.js`.

### 🟡 Pre-lanzamiento público
- [ ] **SEC-2 / F-4 — Smoke tests en CI** (GitHub Actions).
- [ ] **SEC-1 / F-5 — Auditoría de seguridad externa.**
- [ ] **`npm audit fix --force`** controlado (mercadopago/uuid, axios, undici).
- [ ] **C1 — Contrato Facturante** (activar facturación automática AFIP/ARCA).
- [ ] **L1 — Activar planes BASIC/PRO/ENTERPRISE** (`UPDATE plans SET active=true`).

### ⚪ Infra / diferidos
- [ ] **D1 — GRANT DEFAULT PRIVILEGES** en DB.
- [ ] **F-3 — Redundancia / snapshot** del droplet.
- [ ] **L2 — Base de Conocimiento IA** (20-30 tickets reales).
- [ ] **L3 — Actualizar imágenes del listing** en Chrome Web Store.
- [ ] **GitGuardian:** marcar alerta del 2026-06-08 como *Resolved*.

---

## 7. Conclusión

**Para arrancar la Beta con red cercana: estás listo**, con una sola salvedad dura — **activar MercadoPago producción (B3)** para poder cobrar. Todo lo demás (firma, dependencias, CI, auditoría) es mejora incremental que se puede hacer **en paralelo** mientras conseguís los primeros clientes, no antes.

El orden recomendado de las próximas 2 semanas:
1. Activar B3 (cobrar) + verificar SSL.
2. `npm audit fix` en staging→prod.
3. Iniciar trámite de firma de código.
4. Grabar los 2 videos y empezar la red cercana.
