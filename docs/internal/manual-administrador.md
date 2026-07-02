# Manual del Administrador — Procurador SCW

> Guía de **operación del dashboard admin** (`https://api.procuradortool.com/dashboard/`).
> Orientado a operar, no a programar. Para el detalle técnico ver `sistema-estados-flujos.md`
> y `guia-planes-vigencia-cortesia.md`. Estado: en producción al 2026-07-02.

---

## Índice
1. Acceso y navegación
2. Gestión de usuarios (incl. alta manual)
3. Planes (crear/editar, público/privado, precio, vigencia)
4. Suscripciones (cambiar plan, cortesía, cancelar/reactivar)
5. Cobranza (pagos, facturación, beneficios, usos extra)
6. Soporte (tickets) y Diagnóstico
7. Recetas rápidas (casos frecuentes)

---

## 1. Acceso y navegación

- **URL:** `https://api.procuradortool.com/dashboard/` — acceso restringido (solo cuentas con rol admin).
- **Menú lateral:** Resumen · Usuarios · Tickets · Facturación · Pagos · Planes · Monitor · Legal · Métricas · Diagnóstico · Scripts. Se puede colapsar a íconos con el botón ☰.
- El **Resumen** muestra usuarios registrados, suscripciones activas, pendientes de activación, ejecuciones y tickets abiertos (las cards son clickeables → llevan a su sección).

---

## 2. Gestión de usuarios

Sección **Usuarios**: listado con buscador por email. Click en una fila (o "Ver") abre la **ficha** del usuario.

### 2.1 Agregar usuario (alta manual) — ＋ Agregar usuario
Suple el registro público: **vos** creás la cuenta y le mandás las credenciales.

1. Click **"＋ Agregar usuario"**.
2. Completá: **Nombre, Apellido, Email, Contraseña** (mín. 8, con letra y número — la fija el admin), **CUIT/CUIL**, Teléfono (opcional), **Plan**.
3. Si elegís un plan de **$0 (cortesía)**, aparece el campo **Vigencia (días)** → definís cuántos días de acceso.
4. Click **Crear usuario**.

**Qué pasa:** se crea la cuenta en estado `pending_email` y se le envía un email con las **credenciales + recomendación de cambiar la contraseña + enlace de verificación**. El usuario queda pendiente hasta que verifica su email.

- Al **verificar el email**: si el plan es de **$0 (cortesía)**, la cuenta queda **activa** con la vigencia corriendo. Con cualquier otro plan, queda en **trial** (pending_activation) esperando activación/pago.

### 2.2 Acciones sobre un usuario (ficha)
- **Activar / Suspender**: cambia el estado de la cuenta. "Activar" habilita la cuenta (y la configuración de pago).
- **📧 Reenviar verificación**: si está en `pending_email`.
- **✉️ Editar email**: cambia el email → suspende la cuenta hasta re-verificar el nuevo correo (vuelve sola al estado previo al verificar).
- **🔑 Blanquear contraseña / Asignar CUIT**: utilidades de la ficha.
- **Historial de la cuenta**: registra cada acción (activación, cambio de plan, cortesía, cancelación, etc.) con fecha y admin que la hizo.

### 2.3 Estados de la cuenta
| Estado | Significado |
|---|---|
| `pending_email` | Registrado, email sin verificar |
| `pending_activation` | Email verificado, en trial (20 usos) |
| `active` | Cuenta activa (con plan/pago o cortesía) |
| `suspended_admin` | Suspendida manualmente |
| `suspended_plan_expired` | Plan vencido (recuperable desde el portal) |
| `rejected` / `cancelled` | Terminales |

---

## 3. Planes (sección Planes)

Listado de planes con **＋ Nuevo plan** y **Editar** por fila.

### 3.1 Campos del plan
- **Nombre interno** (MAYÚSCULAS) y **Nombre a mostrar**.
- **Límites**: procuración, batch, informes, monitor partes, monitor novedades, período (días).
- **Flujos de extensión** habilitados.
- **Precio** (USD / ARS) y **Tipo** (electron/extensión/combo).
- **Visibilidad**: **Público** o **Privado** (ver abajo).
- **⏳ Vencimiento real del plan** (solo al editar): fecha que **suspende** a las cuentas activas de ese plan (ver 3.3).

### 3.2 Público vs Privado
- **Público** → el usuario lo ve y lo puede **elegir** (formulario de registro y selector del portal).
- **Privado** → **solo lo asigna el admin**. No aparece en las listas del usuario y el usuario **no puede autoasignárselo**. El usuario que ya lo tiene asignado **ve sus límites con normalidad**.
- Es independiente de Activo/Inactivo. Ejemplo típico: un plan **CORTESIA** ($0, privado, activo).

> ⚠️ **Importante:** al crear un plan, **cargá el precio en el alta** (se guarda desde ＋ Nuevo plan). Un plan de cortesía debe tener **precio ARS = 0 explícito** para que el sistema lo trate como cortesía; si lo dejás vacío queda "sin precio" (como BASIC/PRO) y **no** dispara la cortesía.

### 3.3 Vencimiento real del plan (`plan_expiry_date`)
- Distinto del "Tipo de límite / promoción por fecha", que es **solo un aviso**.
- Esta fecha **corta el acceso**: al llegar, el sistema **pausa el cobro en MercadoPago** y **respeta el período ya pago** (el corte cae al fin del período). La cuenta queda en `suspended_plan_expired` (recuperable) y el portal le ofrece elegir plan + pagar.
- Se setea por plan (afecta a todas las cuentas activas de ese plan). Para una vigencia **por usuario**, usá el plan de cortesía con "días" (ver 4.2).

---

## 4. Suscripciones (desde la ficha del usuario → "Cambiar plan")

En la ficha, la sección **Cambiar plan** tiene: selector de plan + campo **días** + botón **Aplicar**, y los botones de suspensión/cancelación.

### 4.1 Cambiar plan (planes pagos)
- **Upgrade** (a un plan más caro): se aplica **de inmediato**. Si el usuario paga por MercadoPago, el **nuevo monto se cobra desde el próximo vencimiento** (MP no prorratea: **no** se cobra diferencia ahora ni se reembolsa el período actual).
- **Downgrade** (a un plan más barato): se **programa para el fin del ciclo**. El usuario **conserva sus límites actuales** hasta esa fecha; ahí un cron aplica el plan y baja el monto en MP.
- El botón muestra una nota explicando esto según el usuario tenga MP o no.

### 4.2 Asignar plan de cortesía ($0)
Elegí un plan de **precio $0** en el selector, poné los **días** de vigencia y **Aplicar**. Efecto (aplica **de inmediato** en los tres casos):

| Situación del usuario | Qué pasa |
|---|---|
| **Ya pagaba (MP)** | Aplica la cortesía, fija la vigencia y **pausa el cobro en MP** (no se le cobra más mientras dure). ⚠️ La cortesía **empieza hoy**, no al terminar sus días pagos. Si querés que corra *después*, poné días = días pagos restantes + días de regalo. |
| **En trial** | Sale del trial y queda **activo** con la vigencia. |
| **Creado por admin (sin verificar)** | Queda listo para que, al **verificar el email**, arranque activo con la cortesía. |

Al vencer la vigencia → la cuenta pasa a `suspended_plan_expired` y el portal le ofrece elegir plan + pagar.

### 4.3 Cancelar al fin de ciclo (reversible)
- **🚫 Cancelar al fin de ciclo** (solo aparece si el usuario paga por MP): pausa el cobro en MercadoPago y programa el corte al fin del período pago. El usuario mantiene acceso hasta esa fecha. Aparece un banner con la fecha.
- **↩ Deshacer cancelación**: reanuda el cobro (sin generar un pago nuevo) y limpia la cancelación. Válido mientras no venció.
- Ambas quedan en el Historial de la cuenta.

---

## 5. Cobranza

- **Pagos**: listado global, alta manual de pagos, asociación pago↔factura. Editar pagos manuales (✏️).
- **Facturación**: tab **Pendientes** (pagos aprobados sin PDF) y **Emitidas**. El admin sube el **PDF de ARCA** + tipo/número/CAE. También "＋ Nueva factura manual" sin pago asociado. *(Facturante automático está desactivado; la facturación es manual.)*
- **Beneficios comerciales** (ficha): aplicar descuentos/beneficios (N por usuario, con o sin ticket).
- **Usos extra / cortesía de usos** (ficha o ticket): sumar/restar usos por subsistema (`±N`), permanentes.

> **MercadoPago está en modo sandbox en producción** hasta ejecutar B3 (pasar a MP real). Los cobros no son reales todavía.

---

## 6. Soporte y Diagnóstico

- **Tickets**: bandeja con prioridad (manual o por IA 🤖), respuestas al usuario (con email automático), notas internas (🔒, no visibles al usuario), "Proyectar con IA" una respuesta, y ajuste manual de usos desde el ticket.
- **Diagnóstico (🧪)**: 3 tarjetas de smoke tests — Backend API (se ejecuta desde el server), Portal PJN y Extensión Chrome (se reportan desde el script `smoke-test-pjn.js`).

---

## 7. Recetas rápidas

| Quiero… | Cómo |
|---|---|
| Dar de alta un cliente yo mismo | Usuarios → ＋ Agregar usuario → completar + plan → el usuario recibe email y verifica |
| Regalar acceso por N días a un cliente que paga | Crear/usar un plan **$0 privado** → ficha → Cambiar plan → ese plan + días → Aplicar (pausa su cobro en MP) |
| Regalar acceso a un usuario en trial | Ficha → Cambiar plan → plan $0 + días → Aplicar |
| Subir a un cliente de EXTENSION a COMBO | Ficha → Cambiar plan → COMBO → Aplicar (upgrade inmediato, cobra el nuevo monto el próximo vencimiento) |
| Bajar a un cliente de plan (sin perjudicarlo) | Ficha → Cambiar plan → plan menor → Aplicar (se programa a fin de ciclo, conserva límites hasta entonces) |
| Cortar el cobro de un cliente sin darlo de baja ya | Ficha → 🚫 Cancelar al fin de ciclo (reversible con ↩ Deshacer) |
| Un plan solo para asignar yo, que el cliente no pueda elegir | Planes → crear/editar con **Visibilidad = Privado** |
| Cortar el acceso de todos los de un plan en una fecha | Planes → editar plan → ⏳ Vencimiento real del plan |

---

## Documentos relacionados
- `guia-planes-vigencia-cortesia.md` — comportamiento detallado (vigencia + público/privado + cortesía).
- `sistema-estados-flujos.md` — flujos técnicos, estados, crons, endpoints.
- `CLAUDE.md` — guía maestra del proyecto.
