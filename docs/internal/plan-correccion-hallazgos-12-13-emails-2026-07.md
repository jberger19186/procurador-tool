# Plan de corrección — Hallazgos #12 y #13 (emails, de R8.1)

> Generado 2026-07-24 (Opus, tras investigación del código real). **Para ejecutar con Sonnet, esfuerzo medio.**
> **Regla de oro:** fixes **quirúrgicos**, sin cambiar otros emails ni la lógica de negocio. Backup DB previo (aunque estos cambios no tocan datos). **Solo backend** — no requiere release de Electron ni re-encriptar scripts.

---

## Resumen

| # | Qué es | Archivos | Deploy | Riesgo |
|---|---|---|---|---|
| **#12** | Email de activación saluda con el email, no el nombre | `routes/admin.js` (2 líneas) | scp + `pm2 restart` | Muy bajo |
| **#13** | Email de reset de contraseña con marca inconsistente | `utils/mailer.js` (+1 función) + `routes/auth.js` (2 call sites) | scp + `pm2 restart` | Bajo |

Ambos se deployan juntos (mismo `pm2 restart`). Verificables re-disparando los emails (el "Plan de disparo R8.1" del plan de pruebas ya documenta cómo).

---

## #12 — El email de activación saluda con el email en vez del nombre

### Diagnóstico (confirmado en código)
`sendActivationEmail(email, nombre)` (`mailer.js:263`) usa el 2º argumento como nombre: `Hola <strong>${nombre}</strong>`. Pero **los 2 call sites** le pasan `email` en ambos argumentos:
- **`admin.js:479`** (endpoint `POST /users/:userId/activate`, botón "Activar" del panel de pendientes): `mailer.sendActivationEmail(u.email, u.email)`.
- **`admin.js:985`** (selector "Estado de registro" → "Activo"): `mailer.sendActivationEmail(activatedUser.email, activatedUser.email)`.

Ambos objetos (`u` y `activatedUser`) vienen de `performActivation()` (`admin.js:413`), cuyo SELECT incluye `u.nombre` (`admin.js:415`) → **`.nombre` está disponible en ambos**. `nombre` es campo requerido (validado en registro y en alta por admin) → no es null en la práctica.

### Fix (2 líneas)
- **`admin.js:479`**: `sendActivationEmail(u.email, u.email)` → `sendActivationEmail(u.email, u.nombre)`
- **`admin.js:985`**: `sendActivationEmail(activatedUser.email, activatedUser.email)` → `sendActivationEmail(activatedUser.email, activatedUser.nombre)`

### Hardening opcional (recomendado, 1 línea, defensivo)
Para que un `nombre` null nunca muestre "Hola null," (no debería pasar, pero por consistencia con otros emails que tienen fallback como `sendTicketReplyEmail` → `${nombre || 'usuario'}`): en `mailer.js:268`, cambiar `Hola <strong>${nombre}</strong>` → `Hola <strong>${nombre || 'usuario'}</strong>`. **Opcional** — el fix de los call sites ya resuelve el bug reportado.

### Alcance / riesgo
- Solo `admin.js` (2 líneas) + opcionalmente `mailer.js` (1 línea). No toca la lógica de activación, ni otros emails, ni la DB.
- Riesgo **muy bajo**: solo cambia qué se muestra en el saludo.

### Verificación
- Re-disparar una activación (crear un usuario fixture + activarlo, como en el Plan de disparo R8.1) → el email debe decir **"Hola {Nombre},"** (ej. "Hola Test,"), no el email.
- Probar los 2 caminos: el botón "Activar" y el selector de estado "Activo".

---

## #13 — El email de reset de contraseña rompe la consistencia de marca

### Diagnóstico (confirmado en código)
Hay **2 call sites** que arman el HTML del email de reset a mano (los únicos del sistema que no usan los helpers de marca `emailLayout`/`p`/`btnPrimary`/`infoBox`):
- **`auth.js:1016-1031`** (`POST /auth/admin/send-password-reset`, reset por admin): tiene un `<h2 style="color:#1e40af">Procurador SCW</h2>` **redundante** (duplica el wordmark que ya pone el wrapper `emailLayout`) + botón azul (`#1e40af`).
- **`auth.js:1104-1111`** (`POST /auth/forgot-password`, reset público): mismo botón azul (`#1e40af`), sin estructura de marca.

`sendEmail()` (`mailer.js:127`) envuelve cualquier HTML que no empiece con `<!DOCTYPE` en `emailLayout()` → ambos SÍ tienen el header/footer de marca, pero el cuerpo usa botón azul en vez del ámbar (`#d97706`) del resto y (el de admin) un heading redundante.

### Fix recomendado (centralizar en el mailer, cubre los 2 call sites)
Crear una función dedicada en `mailer.js` (donde los helpers `p`/`btnPrimary`/`infoBox`/`emailLayout` están en scope — **no** hace falta exportarlos), y llamarla desde los 2 lugares de `auth.js`. Es la opción más limpia y **espeja la arquitectura** (todo email vive como `sendXxx` en `mailer.js`).

**Paso 1 — `mailer.js`**, agregar (cerca de los otros `sendXxx`) y exportarla en `module.exports`:
```js
async function sendPasswordResetEmail(email, nombre, resetLink, { byAdmin = false } = {}) {
    const intro = byAdmin
        ? 'El administrador solicitó el restablecimiento de tu contraseña. Hacé clic en el botón para crear una nueva:'
        : 'Recibimos una solicitud para restablecer tu contraseña. Hacé clic en el botón para crear una nueva:';
    await sendEmail(
        email,
        'Restablecer tu contraseña — Procurador SCW',
        emailLayout(`
          ${p(`Hola <strong>${nombre || 'usuario'}</strong>,`)}
          ${p(intro)}
          ${btnPrimary(resetLink, 'Restablecer contraseña')}
          <p style="font-size:12px;color:#6b7280;margin:0 0 8px">Este enlace vence en 24 horas. Si no solicitaste este cambio, ignorá este mensaje.</p>
          <p style="font-size:12px;color:#9ca3af;margin:0">Si el botón no funciona, copiá este enlace:<br>
            <a href="${resetLink}" style="color:#d97706;word-break:break-all">${resetLink}</a></p>
        `)
    );
}
```
> Usa `btnPrimary` (ámbar) y `p`, sin `<h2>` redundante. El link de respaldo queda igual que en los demás emails (ámbar, `word-break`).

**Paso 2 — `auth.js:1016-1031`** (reset por admin): reemplazar el bloque `await mailer.sendEmail(u.email, 'Restablecer...', \`<div>...\`)` por:
```js
await mailer.sendPasswordResetEmail(u.email, u.nombre, link, { byAdmin: true });
```
(el `link` ya está construido en `auth.js:1014`).

**Paso 3 — `auth.js:1104-1111`** (reset público): reemplazar el bloque `await mailer.sendEmail(u.email, 'Restablecer...', \`<p>...\`)` por:
```js
await mailer.sendPasswordResetEmail(u.email, u.nombre, resetLink, { byAdmin: false });
```
(el `resetLink` ya está construido en `auth.js:1103`).

### Alcance / riesgo
- `mailer.js` (+1 función, +1 export) + `auth.js` (2 bloques reemplazados por 1 línea c/u). No toca la lógica del token/reset (generación, guardado, expiración) — solo el HTML del email.
- Riesgo **bajo**: los links (`link`/`resetLink`) y el flujo quedan idénticos; solo cambia la presentación. Se elimina HTML duplicado.
- **Nota de consistencia:** verificar que el color/ante del `emailLayout` por defecto (`#d97706` ámbar) es el deseado para reset — sí, es el mismo de credenciales/activación exitosa. (Si se prefiriera un acento distinto para "seguridad", se puede pasar como 2º arg de `emailLayout`, pero lo consistente es el ámbar.)

### Verificación
- Re-disparar ambos resets: admin (`POST /auth/admin/send-password-reset`) y público (`POST /auth/forgot-password`) → ambos emails deben verse con el **botón ámbar**, sin el `<h2>` azul redundante, marca consistente con el resto.
- Confirmar que el link del botón sigue abriendo `/auth/reset-password?token=...` y el flujo de reset funciona (el token no cambió).

---

## Deploy y cierre

1. **Backup** DB (por convención, aunque no se toca estado) + confirmar working tree limpio.
2. Editar `admin.js` (#12), `mailer.js` + `auth.js` (#13). Probar sintaxis (`node --check`).
3. **Deploy:** `scp` de `routes/admin.js`, `routes/auth.js`, `utils/mailer.js` al servidor + `pm2 restart procurador-api`. **No** re-encriptar (no son scripts), **no** release de Electron.
4. **Verificar** re-disparando los 3 emails afectados (activación por los 2 caminos + reset admin + reset público) hacia un alias `+` de la casilla del operador, y que el operador confirme el render.
5. **Limpieza:** borrar el/los usuario(s) fixture usados para verificar.
6. Actualizar las filas de hallazgos #12 y #13 (→ corregido y verificado) + la fila R8.1 + CLAUDE.md. Commit + push.

### Modelo / esfuerzo
**Sonnet, esfuerzo medio.** Cambios mecánicos y acotados, solo backend, sin tocar MercadoPago/cobro ni la lógica de negocio. Si el ejecutor cree necesario cambiar de modelo, informa y espera confirmación del operador.
