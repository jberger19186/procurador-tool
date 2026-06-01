# Informe de Verificación de Seguridad — Procurador SCW

> **Fecha:** 30 de mayo de 2026
> **Alcance:** backend (API Express + PostgreSQL), autenticación, manejo de secretos, cifrado, pagos.
> **Método:** revisión del código fuente real en producción (no automatizada).
> **Tipo:** evaluación previa a Beta. No reemplaza una auditoría externa profesional antes del lanzamiento masivo.

---

## Resumen ejecutivo

El backend tiene una **base de seguridad sólida** para una Beta controlada. Las prácticas fundamentales están bien implementadas: contraseñas cifradas, consultas a base de datos a prueba de inyección, secretos fuera del código, y autenticación con tokens.

Se identificaron **2 puntos de prioridad media** y **8 de prioridad baja** a corregir. Ninguno es bloqueante para una Beta con usuarios de confianza, pero **los 2 de prioridad media deberían resolverse antes del lanzamiento público**.

| Nivel | Cantidad | ¿Bloquea Beta? |
|---|---|---|
| 🟢 Fortalezas confirmadas | 18 | — |
| 🟠 Media | 2 | No (resolver antes del público) |
| 🟡 Baja | 8 | No |
| ⚪ Proceso/recomendación | 3 | No |

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

## 2. Puntos a corregir — Prioridad MEDIA

> Recomendado resolver **antes del lanzamiento público** (no bloquean la Beta).

### 🟠 M-1 — El cierre de sesión no invalida los tokens de administrador
**Qué pasa:** cuando un usuario común cierra sesión, su token queda inutilizable de inmediato (lista negra). Pero los endpoints de **administración** no consultan esa lista negra: un token de admin sigue siendo válido hasta su vencimiento natural (8 horas), aunque se haya cerrado sesión.

**Riesgo:** si un token de admin se filtra o queda en un dispositivo compartido, el "cerrar sesión" no lo corta realmente durante esas horas.

**Cómo se corrige:** agregar la verificación de lista negra en la función de autenticación de administrador (la misma que ya usan los usuarios comunes). Cambio pequeño y de bajo riesgo.

---

### 🟠 M-2 — Comparación de firma de pagos no es "tiempo-constante"
**Qué pasa:** al validar la firma de un webhook de MercadoPago, la comparación se hace con un operador común (`!==`) en lugar de una comparación de tiempo constante.

**Riesgo:** teóricamente permite un "ataque de temporización" para adivinar la firma midiendo milisegundos de respuesta. En la práctica el riesgo es **muy bajo** (las firmas son cadenas hexadecimales largas), pero es una corrección estándar y trivial.

**Cómo se corrige:** usar la función `crypto.timingSafeEqual` para comparar las firmas. Una línea de cambio.

---

## 3. Puntos a corregir — Prioridad BAJA

> Mejoras de robustez. Pueden hacerse de forma gradual.

| # | Punto | Detalle | Recomendación |
|---|---|---|---|
| B-1 | **Sin validación de la clave secreta al arrancar** | Si faltara la variable `JWT_SECRET`, el servidor arrancaría y fallaría recién al primer login | Validar al inicio que exista y tenga longitud mínima; si no, no arrancar |
| B-2 | **Política de contraseñas básica** | Solo exige 8 caracteres mínimo, sin requisitos de complejidad | Aceptable para Beta; considerar exigir combinación de tipos o chequeo contra contraseñas filtradas |
| B-3 | **Factor de costo de bcrypt en 10** | Es seguro, pero podría subirse a 12 para mayor resistencia | Subir a 12 (impacto mínimo en velocidad de login) |
| B-4 | **El log registra la firma esperada al fallar** | Cuando una firma de webhook no coincide, se escribe la firma esperada en los registros del servidor | Quitar ese dato del log (fuga menor, solo visible internamente) |
| B-5 | **Política de seguridad de contenido (CSP) desactivada** | Helmet está activo pero con CSP apagado | Activar una CSP básica para endurecer las páginas web servidas (dashboard, portal) ante XSS |
| B-6 | **Sin versión mínima de TLS en el servidor directo** | El Express en el puerto interno no fija una versión mínima de cifrado (en producción está detrás de Nginx/Cloudflare que sí la fijan) | Definir versión mínima TLS 1.2 como defensa en profundidad |
| B-7 | **Verificar cadena de IP real tras Cloudflare** | El rate limiting identifica por IP con `trust proxy: 1`; detrás de Cloudflare hay que asegurar que se use la IP real del cliente (no la de Cloudflare) | Confirmar que la IP real llega correctamente, para que los límites no se evadan ni se disparen de más |
| B-8 | **Carácter invisible al inicio de un archivo** | `checkLicense.js` empieza con un carácter BOM (cosmético, sin impacto funcional) | Limpiar (orden de código) |

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

Las bases de seguridad están bien construidas y no se encontraron vulnerabilidades críticas ni de inyección. Los dos puntos de prioridad media (M-1 y M-2) son correcciones pequeñas que conviene aplicar pronto, y el resto son mejoras graduales de robustez.

**Antes del lanzamiento público (no de la Beta)** se recomienda: resolver M-1 y M-2, activar el escaneo de dependencias, montar el ambiente de staging, y considerar una auditoría externa.

---

## Anexo — Plan de remediación sugerido

| Cuándo | Tareas |
|---|---|
| **Antes de la Beta** (opcional pero recomendado) | M-1 (logout admin), M-2 (comparación de firma) — son rápidas |
| **Durante la Beta** | B-1, B-4, B-5, B-7, B-8 · activar `npm audit` |
| **Antes del lanzamiento público** | B-2, B-3, B-6 · auditoría externa · ambiente staging aprobado |

*Informe basado en revisión de código al 30/05/2026. Para el detalle técnico exacto de cada punto, consultar con el equipo de desarrollo.*
