# Manual de usuario — Procurador SCW
**Versión 2.7** · Para abogados y procuradores  
Última actualización: 2026-05-21

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
Bajá el archivo `Procurador-SCW-Setup-X.X.X.exe` desde el enlace que te enviamos al activar tu cuenta.

### Paso 2 — Instalá
Ejecutá el instalador, aceptá las opciones predeterminadas y hacé click en **Instalar**. Al finalizar, la app se abre automáticamente.

> **Si Windows muestra un aviso de seguridad ("protegió tu PC"):** hacé click en "Más información" y luego en "Ejecutar de todas formas". Es normal para software distribuido fuera de las tiendas de Microsoft.

### Paso 3 — Primer inicio de sesión
Ingresá tu email y contraseña de Procurador (no de tu cuenta PJN). La app te guiará por los pasos de configuración inicial.

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
Creá consultas de soporte directamente desde la app.

**Cómo abrir un ticket:**
1. Hacé click en **Soporte** en el sidebar
2. Hacé click en **+ Nuevo ticket**
3. Completá el asunto y la descripción
4. Hacé click en **Enviar**

El equipo de soporte responde dentro de las 24 horas hábiles. Las respuestas aparecen en la misma sección.

---

### Asistente IA 🤖
Respondé dudas frecuentes sin abrir un ticket.

**Cómo usar:**
1. Hacé click en el ícono 🤖 en el sidebar
2. Buscá tu pregunta usando las categorías (Procuración, Informe, Monitor, etc.) o el buscador de texto
3. Si no encontrás la respuesta, hacé click en **💬 Abrir chat** para consultar al asistente en tiempo real

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
| **Reactivar cuenta** | Solo visible si tu cuenta está suspendida |

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
