# Informe de Verificación de Seguridad — Procurador SCW

> **Fecha:** 30 de mayo de 2026 · **Actualizado:** 01 de junio de 2026 (M-1 y M-2 resueltos)
> **Alcance:** backend (API Express + PostgreSQL), autenticación, manejo de secretos, cifrado, pagos.
> **Método:** revisión del código fuente real en producción (no automatizada).
> **Tipo:** evaluación previa a Beta. No reemplaza una auditoría externa profesional antes del lanzamiento masivo.

---

## Resumen ejecutivo

El backend tiene una **base de seguridad sólida** para una Beta controlada. Las prácticas fundamentales están bien implementadas: contraseñas cifradas, consultas a base de datos a prueba de inyección, secretos fuera del código, y autenticación con tokens.

Se identificaron **2 puntos de prioridad media** y **8 de prioridad baja** a corregir. Ninguno es bloqueante para una Beta con usuarios de confianza.

> ✅ **Actualización 01/06/2026:** los **2 puntos de prioridad media (M-1, M-2)** y **6 de prioridad baja (B-1, B-2, B-3, B-4, B-6, B-8)** ya fueron resueltos, probados y desplegados. **B-7 quedó verificado sin cambios** (la API no pasa por Cloudflare). Resta solo **B-5** (CSP, diferido hasta tener staging para probar sin romper la UI).

| Nivel | Cantidad | Estado |
|---|---|---|
| 🟢 Fortalezas confirmadas | 18 | — |
| 🟠 Media | 2 | ✅ **Resueltos** (M-1, M-2) |
| 🟡 Baja | 8 | ✅ 6 resueltos + 1 verificado (B-7) · 1 diferido (B-5) |
| ⚪ Proceso/recomendación | 3 | Pendientes |

---

## 1. Fortalezas confirmadas (lo que está bien hecho)

### Autenticación y contraseñas
- ✅ **Contraseñas cifradas con bcrypt** (no se guardan en texto plano). Imposible recuperar la contraseña original aunque se filtre la base de datos.
- ✅ **Tokens de sesión (JWT) con expiración** automática: entre 1 y 8 horas según el contexto (portal, app, admin).
- ✅ **Lista negra de tokens al cerrar sesión** (logout real): con doble capa — memoria (rápida) + base de datos (sobrevive reinicios). Los tokens se guardan cifrados (SHA-256), nunca completos.
- ✅ **Tokens de recuperación de contraseña seguros**: generados aleatoriamente (256 bits), con vencimiento de 24 horas y de un solo uso (se anulan al usarse).
- ✅ **Verificación de email** con tokens aleatorios antes de habilitar la cuenta.

### Protección de la base de datos
- ✅ **Consultas 100% parametrizadas**: se revisó todo el código y **no existe ningún punto de inyección SQL**. Los datos del usuario nunca se concatenan directamente en las consultas.
- ✅ **Registro transaccional**: si algo falla a mitad del registro, se revierte todo (no quedan datos a medias).

### Manejo de secretos
- ✅ **Ningún secreto está escrito en el código**: todas las claves se leen de variables de entorno.
- ✅ **Archivos sensibles correctamente excluidos del repositorio**: `.env`, claves privadas (`keys/`), certificados (`certs/`) y archivos `.pem` están en `.gitignore`. Solo se versiona la plantilla `.env.example` (sin valores reales).

### Defensa ante abuso
- ✅ **Límites de velocidad (rate limiting) completos**: login (20 intentos/15 min), registro (3/hora), API general (100/min), ejecución y descarga de scripts, y endpoints de administración. Mitiga ataques de fuerza bruta y spam.
- ✅ **Cabeceras de seguridad HTTP** activas (Helmet).
- ✅ **Lista blanca de orígenes (CORS)**: la API solo acepta peticiones de orígenes autorizados.

### Pagos
- ✅ **Validación de firma en los webhooks de MercadoPago** (HMAC-SHA256): se verifica que las notificaciones de pago provengan realmente de MercadoPago.
- ✅ **Idempotencia**: cada evento de pago se procesa una sola vez (no hay cobros ni acreditaciones duplicadas).
- ✅ **Los datos de tarjeta nunca pasan por el servidor** (los maneja MercadoPago).

### Propiedad intelectual y arquitectura
- ✅ **Scripts de automatización cifrados** (AES-256) y **firmados digitalmente** (RSA-2048): protege la lógica del producto y garantiza que no se ejecute código alterado.
- ✅ **Las credenciales del Poder Judicial nunca llegan al servidor** (decisión de arquitectura).
- ✅ **Vinculación por hardware (machine ID)**: dificulta compartir cuentas entre dispositivos.
- ✅ **No se filtran detalles técnicos en los errores**: se revisó y **ningún error expone trazas internas** (stack traces) al usuario final.
- ✅ **HTTPS en producción** (certificado válido + Cloudflare como capa adicional).

---

## 2. Puntos a corregir — Prioridad MEDIA ✅ RESUELTOS

> Ambos corregidos, probados y desplegados el **01/06/2026** (commit `58b3163`, resguardo previo en tag `sec-pre-m1-m2`). Cambio quirúrgico: +15/-1 líneas en 2 archivos, sin alterar el resto del código.

### ✅ M-1 — El cierre de sesión no invalidaba los tokens de administrador
**Qué pasaba:** cuando un usuario común cerraba sesión, su token quedaba inutilizable de inmediato (lista negra). Pero los endpoints de **administración** no consultaban esa lista negra: un token de admin seguía siendo válido hasta su vencimiento natural (8 horas), aunque se hubiera cerrado sesión.

**Cómo se corrigió:** se agregó la verificación de lista negra (`isBlacklisted`) en la función de autenticación de administrador (`routes/admin.js`), antes de validar el token — exactamente como ya lo hacían los usuarios comunes.

**Verificación (E2E en producción):** admin opera (200) → logout (token revocado) → el mismo token reintenta → **403 rechazado**. Antes seguía aceptándose durante 8 horas.

---

### ✅ M-2 — Comparación de firma de pagos no era "tiempo-constante"
**Qué pasaba:** al validar la firma de un webhook de MercadoPago, la comparación se hacía con un operador común (`!==`) en lugar de una comparación de tiempo constante, lo que teóricamente permitía un "ataque de temporización".

**Cómo se corrigió:** se reemplazó por `crypto.timingSafeEqual` (con validación previa de longitud para evitar excepciones) en `routes/webhooks.js`.

**Verificación (producción):** firma válida → aceptada (200) · firma inválida → rechazada (401) · firma de longitud distinta → rechazada sin error.

---

## 3. Puntos a corregir — Prioridad BAJA

> **Actualización 01/06/2026:** el "Grupo Seguro" (B-1, B-3, B-4, B-6, B-8) fue resuelto, probado y desplegado (commit `da1eec6`, resguardo `sec-pre-b-group`). Quedan B-2, B-5 y B-7 con la situación indicada abajo.

| # | Punto | Estado | Detalle / cómo se resolvió |
|---|---|---|---|
| ~~B-1~~ | ~~Sin validación de la clave secreta al arrancar~~ | ✅ Resuelto | `server.js` valida que `JWT_SECRET` exista y tenga ≥ 32 caracteres; si no, `process.exit(1)`. Probado: aborta con secret corto, arranca con válido |
| ~~B-2~~ | ~~Política de contraseñas básica~~ | ✅ Resuelto (01/06) | Helper `utils/passwordPolicy.js` (Opción A): mín. 8 chars + letra y número + no común + no igual al email. Aplicado en registro/reset/cambio. UX: requisitos visibles + mensajes específicos. No afecta login de usuarios existentes |
| ~~B-3~~ | ~~Factor de costo de bcrypt en 10~~ | ✅ Resuelto | Subido a 12 en las 3 ocurrencias (`auth.js` ×2, `usuarios.js`). Hashes existentes (cost 10) siguen verificando correctamente |
| ~~B-4~~ | ~~El log registra la firma esperada al fallar~~ | ✅ Resuelto | `webhooks.js` ya no loguea la firma esperada (solo el `requestId`) |
| B-5 | **Política de seguridad de contenido (CSP) desactivada** | 🟡 Diferido (riesgo sin staging) | Activar CSP puede romper la UI (dashboard/portal/landing usan estilos/scripts inline). Se difiere hasta tener ambiente de staging para probar sin riesgo |
| ~~B-6~~ | ~~Sin versión mínima de TLS en el servidor directo~~ | ✅ Resuelto | `minVersion: 'TLSv1.2'` en `sslOptions`. Probado: negocia TLS 1.3, rechaza TLS 1.1 |
| B-7 | **Verificar cadena de IP real tras Cloudflare** | ✅ Verificado (sin cambios) | `api.procuradortool.com` resuelve directo al droplet (142.93.64.94), **no pasa por Cloudflare**. Con Nginx + `trust proxy: 1` la IP real ya llega bien. No requiere cambios |
| ~~B-8~~ | ~~Carácter invisible al inicio de un archivo~~ | ✅ Resuelto | BOM eliminado de `checkLicense.js` (sin alterar contenido) |

---

## 4. Recomendaciones de proceso

| # | Recomendación | Por qué |
|---|---|---|
| P-1 | **Escaneo automático de dependencias** | Correr `npm audit` periódicamente (idealmente en cada cambio) para detectar librerías con vulnerabilidades conocidas |
| P-2 | **Ambiente de pruebas (staging)** | Tener un entorno separado del de producción para probar cambios sin riesgo (ver el plan de Staging y Rollback) |
| P-3 | **Auditoría externa antes del lanzamiento masivo** | Una revisión profesional independiente da respaldo formal antes de abrir a gran escala y manejar pagos de muchos usuarios |

---

## 5. Veredicto

> **El sistema es apto para iniciar una Beta controlada con usuarios de confianza.**

Las bases de seguridad están bien construidas y no se encontraron vulnerabilidades críticas ni de inyección. Los dos puntos de prioridad media (M-1 y M-2) **ya fueron resueltos** (01/06/2026), y el resto son mejoras graduales de robustez.

**Antes del lanzamiento público (no de la Beta)** se recomienda: activar el escaneo de dependencias, montar el ambiente de staging, completar las mejoras de prioridad baja, y considerar una auditoría externa.

---

## Anexo — Plan de remediación sugerido

| Cuándo | Tareas |
|---|---|
| ~~Antes de la Beta~~ | ✅ **M-1, M-2, B-1, B-2, B-3, B-4, B-6, B-8 resueltos** · B-7 verificado (01/06/2026, commits `58b3163`, `da1eec6`, `548f0e8`) |
| **Durante la Beta** | activar `npm audit` · montar staging |
| **Antes del lanzamiento público** | B-5 (CSP, requiere staging) · auditoría externa |

*Informe basado en revisión de código al 30/05/2026. Para el detalle técnico exacto de cada punto, consultar con el equipo de desarrollo.*
