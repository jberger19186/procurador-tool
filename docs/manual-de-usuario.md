# Manual de usuario — Procurador SCW
**Versión 2.7.14** · Para abogados y procuradores  
Última actualización: 2026-06-02

---

## ¿Qué es Procurador SCW?

Procurador SCW es una herramienta de automatización judicial que te permite procurar expedientes, generar informes y monitorear partes en el Sistema de Consulta Web del Poder Judicial de la Nación (PJN), sin escribir nada a mano.

**Requisito fundamental:** necesitás tener credenciales propias en el SCW del PJN (usuario y contraseña habilitados por el PJN). La herramienta trabaja con tu sesión — nunca modifica ni accede a datos que vos no puedas ver.

---

## Componentes del sistema

| Componente | Qué hace | Cómo se instala |
|---|---|---|
| **App de escritorio** | Procuración automática, informes, monitor de partes | Instalador `.exe` |
| **Extensión de Chrome** | Autocompleta número de expediente en los portales del PJN | Chrome Web Store |
| **Portal web** | Gestión de cuenta, plan y soporte | Navegador — `api.procuradortool.com/usuarios/` |

---

## Instalación de la app de escritorio

### Paso 1 — Descargá el instalador
Iniciá sesión en el **portal web** (`api.procuradortool.com/usuarios/`) y hacé click en **Descargar app** en la sección Descargas. El sistema te redirige automáticamente al instalador más reciente.

### Paso 2 — Instalá
Ejecutá el instalador, aceptá las opciones predeterminadas y hacé click en **Instalar**. Al finalizar, la app se abre automáticamente.

> **Si Windows muestra un aviso de seguridad ("protegió tu PC"):** hacé click en "Más información" y luego en "Ejecutar de todas formas". Es normal para software distribuido fuera de las tiendas de Microsoft.

### Paso 3 — Primer inicio de sesión
Ingresá tu email y contraseña de Procurador (no de tu cuenta PJN). La app te guiará por los pasos de configuración inicial.

> **Si la app muestra "Verificá tu email":** tu cuenta requiere verificación de email antes de poder usar las funciones. Seguí los pasos de la sección siguiente.

---

## Verificación de email y período de prueba

### Verificación de email

Al registrarte, recibís un email de verificación en la casilla con la que te registraste. Ese email contiene un enlace que debés hacer click para activar tu dirección.

**Si no recibiste el email:**
1. Revisá la carpeta de spam/correo no deseado
2. Iniciá sesión en el portal web (`api.procuradortool.com/usuarios/`)
3. Si tu email no está verificado, aparece un botón **"Reenviar email de verificación"** — hacé click para solicitar uno nuevo

**Una vez verificado el email:** tu cuenta pasa a estado "pendiente de activación" y podés acceder al período de prueba.

### Período de prueba

Al verificar tu email recibís **20 usos de prueba** que rigen **hasta que configures tu método de pago**. Esos 20 usos son **compartidos por la app de Electron y la extensión de Chrome**:

- **App de Electron** (procuración, informes, monitor): cada ejecución descuenta de los 20.
- **Extensión de Chrome**: queda habilitada con los flujos de tu plan (COMBO_PROMO y EXTENSION_PROMO incluyen los 5). **Funciona mientras te queden usos de prueba de la app**: cuando se agotan los 20, la extensión también se bloquea.

Cuando **configurás tu método de pago**, se te asignan los **límites de tu plan** y el contador **arranca limpio en 0** (se eliminan los 20 del trial). A partir de ahí la extensión funciona sin tope de usos (según los flujos de tu plan).

El contador de uso aparece en:
- **App Electron → Mi Cuenta**: card con contador `X / 20 usos utilizados` y barra de progreso
- **Portal web → Mi Plan**: misma información

La aprobación de la cuenta es manual — el administrador revisa y aprueba (o rechaza) dentro de las 24-48 horas hábiles. **La aprobación no consume ni resetea tus usos**: seguís con tu trial de 20 hasta configurar el pago.

> **Nota:** el período de prueba se inicia automáticamente al verificar tu email. No necesitás configurar un método de pago para empezar a usarlo — pero al configurarlo accedés a los límites completos de tu plan.

---

## Configuración inicial (Onboarding)

Al iniciar por primera vez, el sistema te guía por estos pasos:

### 1. Verificar conexión al servidor
La app verifica que puede comunicarse con el servidor de Procurador. Si falla, revisá tu conexión a Internet.

### 2. Login
Ingresá el email y contraseña de tu cuenta de Procurador (los que usaste para registrarte en `api.procuradortool.com/register/`).

### 3. Configurar Chrome con perfil dedicado
Procurador usa Chrome con un perfil separado para no interferir con tu navegación habitual. El sistema lo configura automáticamente.

### 4. Conectar al SCW del PJN
La app abre Chrome y te lleva al portal del PJN. Iniciá sesión con tus credenciales del PJN **manualmente, una única vez**. Chrome recordará tu contraseña para las ejecuciones futuras.

### 5. Verificar contraseña guardada
El sistema confirma que Chrome tiene guardadas las credenciales. Si Chrome no las recuerda, usá el botón **"Agregar contraseña SCW"** en la sección Configuración > Seguridad.

---

## Secciones de la app

### Procuración
Accede automáticamente al SCW del PJN y procura todos tus expedientes.

**Cómo usar:**
1. Hacé click en **▶ Procurar** en el sidebar
2. El sistema abre Chrome en segundo plano e inicia el proceso
3. Ves el progreso en tiempo real en el panel de logs
4. Al finalizar, los resultados quedan en la carpeta de descargas

**Opciones disponibles:**
- **Procurar todos:** procura el rango de fechas configurado por defecto
- **Procurar seleccionados:** elegí expedientes específicos de la lista antes de ejecutar
- **Procurar con fecha personalizada:** seleccioná un rango de fechas distinto

**Fecha límite de procuración:** es la fecha **hasta la cual se buscan expedientes** para agregar al informe de procuración. La primera vez, la app la fija en la **fecha de hoy**; si la cambiás, se respeta la tuya. Para que puedas confirmar que se consultó hasta el límite, por **cada sección incluida** en la procuración (letrado, parte, autorizado, favoritos) vas a ver **al menos 1 expediente con fecha anterior** a la fecha límite: eso indica que se revisó hasta el último expediente que cumple la condición de la fecha y se verificó el expediente inmediato anterior a esa fecha para la sección consultada.

> **Importante:** no uses Chrome manualmente mientras el sistema está ejecutando. Podés seguir trabajando en otras aplicaciones sin problema.

---

### Informe
Genera un informe detallado del estado de uno o varios expedientes.

**Informe individual:**
1. Ingresá el número de expediente en el campo de búsqueda
2. Hacé click en **Generar informe**
3. El resultado se descarga como archivo Excel

**Informe en lote:**
1. Preparar un archivo Excel con una columna llamada `expediente` y los números en cada fila
2. Hacé click en **Cargar archivo** y seleccioná tu Excel
3. Hacé click en **Procesar lote**
4. El sistema genera un Excel con el estado de todos los expedientes

> Podés descargar una **plantilla de ejemplo** desde el botón correspondiente en la sección Informe.

---

### Monitor de partes
Vigila automáticamente si aparecen nuevos expedientes vinculados a personas o empresas determinadas.

**Cómo agregar una parte:**
1. Hacé click en **+ Agregar parte**
2. Ingresá el nombre o CUIT/CUIL de la parte
3. Hacé click en **Guardar**

**Cómo ejecutar el monitor:**
1. Hacé click en **▶ Ejecutar monitor**
2. El sistema busca en el PJN nuevos expedientes para cada parte configurada
3. Las novedades aparecen en el panel de resultados

**Límite de partes según plan:**
- COMBO_PROMO: 3 partes activas
- PRO: 10 partes activas
- ENTERPRISE: ilimitadas

---

### Mi Cuenta
Muestra el estado de tu suscripción: plan activo, ejecuciones usadas, ejecuciones restantes y fecha de vencimiento.

Desde acá también accedés al portal web de usuario para gestionar facturación y soporte.

---

### Soporte / Tickets
Los tickets de soporte se gestionan desde el **portal web de usuario**, que se abre automáticamente con tu sesión activa.

**Cómo abrir un ticket:**
1. Hacé click en **Soporte** en la barra superior de Mi Cuenta
2. Hacé click en **+ Nuevo ticket** — el portal web se abre directo al formulario de nuevo ticket
3. Completá categoría, título y descripción en el portal web
4. Hacé click en **Enviar ticket**

**Cómo ver tus tickets:**
1. En Mi Cuenta, tab Soporte, hacé click en **🌐 Ver mis tickets**
2. Se abre el portal web en la sección Soporte con el historial completo

El equipo de soporte responde dentro de las 24 horas hábiles. Las respuestas aparecen en el portal web.

### Notificaciones por email

Cada vez que el equipo de soporte responde tu ticket, vas a recibir un **email automático** en la casilla con la que te registraste. El email contiene:
- El número del ticket (`#16`, `#17`, etc.)
- El título del ticket
- Un preview de la respuesta (primeros 200 caracteres)
- Un botón **"Ver respuesta completa"** que te lleva al portal web

Al hacer click en ese botón:
1. Se abre el portal web (`api.procuradortool.com/usuarios/`)
2. Ingresás con tu email y contraseña
3. Sos redirigido automáticamente a la sección **Soporte** donde podés ver el ticket completo

> **Identificación de tickets:** cada ticket tiene un número único (ejemplo: `#16`) que se muestra tanto en el email como en la lista del portal. Ese número es la forma de identificar tu ticket en comunicaciones con soporte.

---

### Asistente IA 🤖
Respondé dudas frecuentes sin abrir un ticket.

**Cómo usar:**
1. Hacé click en el ícono 🤖 en el sidebar
2. Buscá tu pregunta usando las categorías (Procuración, Informe, Monitor, etc.) o el buscador de texto
3. Si no encontrás la respuesta, hacé click en **💬 ¿Seguís con dudas? Abrir chat** — el portal web se abre automáticamente en la sección Asistente IA con tu sesión activa

**Categorías disponibles:**
- **Procuración** — cómo procurar, opciones disponibles
- **Informe** — formatos, lotes, resultados
- **Monitor** — partes, frecuencia, novedades
- **Extensión** — instalación, funcionamiento, flujos
- **Cuenta** — plan, cambios, cancelación
- **Errores** — problemas frecuentes y soluciones
- **Privacidad** — seguridad de datos, credenciales PJN

---

## Extensión de Chrome

### Instalación
1. Abrí Chrome y buscá **"Procurador SCW"** en la [Chrome Web Store](https://chromewebstore.google.com/detail/aodnfemklhciagaglpggnclmbdhnhbme)
2. Hacé click en **Agregar a Chrome**
3. Si Chrome muestra un aviso de precaución, hacé click en **Continuar a la instalación** — es normal para extensiones nuevas y no representa ningún riesgo

### Uso
La extensión se activa automáticamente cuando navegás a los portales del PJN. Al detectar un campo de expediente, aparece un botón para autocompletar el número sin tener que escribirlo.

**Portales compatibles:**
- scw.pjn.gov.ar (Consulta SCW y escritos desde expediente)
- escritos.pjn.gov.ar (Escritos digitales)
- notif.pjn.gov.ar (Notificaciones)
- deox.pjn.gov.ar (DEOX)

### Inicio de sesión en la extensión
Hacé click en el ícono de la extensión en Chrome, ingresá el mismo email y contraseña de tu cuenta de Procurador.

---

## Portal web de usuario

Accedé en: **`https://api.procuradortool.com/usuarios/`**

| Sección | Qué encontrás |
|---|---|
| **Mi Perfil** | Nombre, apellido, CUIT, teléfono, domicilio |
| **Mi Plan** | Plan activo, días restantes, uso por subsistema |
| **Facturación** | Fecha de próximo cobro, método de pago, cancelación |
| **Soporte** | Tus tickets de soporte con historial de respuestas |
| **Asistente IA** | Chat conversacional con historial de mensajes |
| **Ayuda** | Preguntas frecuentes y manual de usuario completo |
| **Reactivar cuenta** | Solo visible si tu cuenta está suspendida |

### Sección Ayuda
La sección **Ayuda** del portal web incluye las mismas 34 preguntas frecuentes de la app Electron, con filtro por categorías (Procuración, Informe, Monitor, Extensión, Cuenta, Errores, Privacidad) y buscador por texto. También podés acceder al **Manual de usuario completo** en línea haciendo click en "📖 Ver manual" — se despliega directamente en la página sin necesidad de descargar ningún archivo.

---

## Preguntas frecuentes

### ¿Mis contraseñas del PJN están seguras?
Sí. Las contraseñas del PJN se guardan exclusivamente en el gestor de contraseñas de tu Chrome y **nunca** pasan por los servidores de Procurador. El sistema solo coordina la automatización; vos sos el único que tiene acceso a tus credenciales.

### ¿Necesito dejar Chrome abierto mientras procura?
No. El sistema abre y cierra Chrome automáticamente en segundo plano. Podés usar otras aplicaciones normalmente.

### ¿Qué hago si el login al PJN falla?
1. Abrí la app y andá a **Configuración > Seguridad**
2. Hacé click en **Agregar contraseña SCW**
3. En la ventana de Chrome que se abre, iniciá sesión manualmente en el SCW
4. Chrome preguntará si querés guardar la contraseña — decí que sí
5. Volvé a la app y reintentá

### ¿Por qué dice "proceso activo en otro dispositivo"?
El sistema previene que dos instancias corran al mismo tiempo. Asegurate de haber cerrado todas las ventanas de la app. Si el error persiste después de 2 minutos, cerrá la app completamente y volvé a abrirla.

### ¿Qué pasa si no recibí el email de verificación?
Iniciá sesión en el portal web. Si tu email no está verificado, aparece el botón "Reenviar email de verificación". Revisá también la carpeta de spam.

### ¿Qué es el período de prueba?
Al verificar tu email recibís 20 ejecuciones gratuitas válidas por 365 días. Podés usar toda la funcionalidad de la app sin restricciones. El contador aparece en "Mi Cuenta" (app) y "Mi Plan" (portal web).

### ¿Qué pasa cuando se agotan los usos de prueba?
Al llegar a 20 ejecuciones, la cuenta queda en espera de activación. El administrador revisa y activa manualmente. Si necesitás continuar antes de que se active tu cuenta, contactá al soporte.

### ¿Cómo actualizo la app?
La app se actualiza automáticamente. Cuando haya una nueva versión, aparecerá una notificación en la barra superior. Hacé click en **Actualizar** y la app se reinicia con la versión nueva.

### ¿Cómo actualizo la extensión?
Chrome actualiza la extensión automáticamente. También podés forzar la actualización yendo a `chrome://extensions` y haciendo click en el ícono de actualizar.

---

## Soporte

Si tenés algún problema que no está cubierto en este manual:

1. **Asistente IA:** consultá en la app (ícono 🤖) para respuestas inmediatas
2. **Ticket de soporte:** abrí un ticket desde la app o el portal web — respondemos en menos de 24 horas hábiles
3. **Email:** soporte@procuradortool.com

---

## Privacidad y seguridad

- **Credenciales PJN:** se almacenan solo en tu Chrome, nunca en servidores de Procurador
- **Scripts de automatización:** cifrados con AES-256 y firmados digitalmente; el cliente los verifica antes de ejecutar
- **Comunicaciones:** todas las comunicaciones usan HTTPS/TLS
- **Datos de expedientes:** los resultados quedan únicamente en tu equipo; no se guardan en servidores
- **Sesión:** tu sesión en la app tiene duración de 2 horas y se renueva automáticamente mientras estés activo

Para conocer nuestra política de privacidad completa, visitá `https://api.procuradortool.com/privacidad`.
