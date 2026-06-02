# Informe de Evaluación del Proyecto — Procurador SCW
### Preparación para lanzamiento de prueba (Beta) con usuarios reales

> **Fecha:** 30 de mayo de 2026 · **Actualizado:** 02 de junio de 2026
> **Destinatarios:** Socios y dirección
> **Objetivo del informe:** evaluar el estado real del proyecto y determinar si está listo para iniciar una etapa de prueba controlada con usuarios reales.

> ✅ **Actualización (02/06/2026) — avances desde la versión original del informe:**
> Dos puntos que figuraban como "preparación post-Beta" ya fueron **completados anticipadamente**, lo que refuerza la posición del proyecto:
> 1. **Endurecimiento de seguridad completo** — se revisó y corrigió la totalidad de los puntos de seguridad detectados (autenticación, contraseñas, cifrado de comunicaciones, política anti-XSS, etc.). Solo resta una auditoría externa opcional antes de la escala masiva.
> 2. **Ambiente de pruebas (staging) + recuperación ante fallas** — se montó un entorno gemelo aislado del de producción para probar cambios sin riesgo, con respaldos automáticos y un procedimiento de "vuelta atrás" probado. Esto reduce significativamente el riesgo operativo de la Beta.
>
> Con esto, **los únicos pendientes para abrir la Beta son trámites externos** (activar cobros reales y firmar digitalmente el instalador). El resto está listo.

---

## 1. Resumen ejecutivo

Procurador SCW es una plataforma de software que **automatiza tareas judiciales repetitivas** para abogados y procuradores en Argentina. Su desarrollo está **muy avanzado**: el producto funciona, se vende solo a profesionales con credenciales válidas del Poder Judicial, y ya tiene resueltos los tres pilares de un negocio digital: el **producto**, el **cobro automático** y la **facturación**.

**Conclusión principal:** el proyecto está **listo para iniciar una Beta con un grupo reducido de usuarios reales**, con la salvedad de completar **tres tareas de bajo esfuerzo** antes de abrir las puertas (detalladas en la sección 6).

---

## 2. ¿Qué hace el producto? (en palabras simples)

El profesional del derecho pierde muchas horas en tareas mecánicas dentro del sistema del Poder Judicial. Procurador SCW automatiza esas tareas con dos herramientas:

| Herramienta | Qué hace | Dónde corre |
|---|---|---|
| **Aplicación de escritorio** | Procura expedientes, genera informes de estado y monitorea si aparecen causas nuevas — todo automático | En la computadora del usuario (Windows) |
| **Extensión de Chrome** | Acelera la carga de números de expediente en 5 sistemas distintos del Poder Judicial | En el navegador del usuario |

**Dato clave de confianza:** las contraseñas del Poder Judicial del usuario **nunca pasan por nuestros servidores**. Se manejan localmente en su propia computadora. Esto es un diferenciador fuerte en materia de seguridad y privacidad.

---

## 3. Estado del proyecto por etapas

El proyecto se organizó en 5 fases. Este es el estado real de cada una:

| Fase | Qué abarca | Estado |
|---|---|---|
| **Fase 1 — Producto** | La aplicación y la extensión funcionando y pulidas | 🟢 **Operativa** (queda una mejora interna de código, sin impacto para el usuario) |
| **Fase 2 — Infraestructura** | Servidores, base de datos, copias de seguridad | 🟢 **Operativa** (en producción y funcionando) |
| **Fase 3 — Comercial** | Página web, planes, identidad de marca | 🟢 **Operativa** (sitio publicado, marca unificada) |
| **Fase 4 — Soporte** | Sistema de tickets y asistente con inteligencia artificial | 🟢 **Cerrada y funcionando** |
| **Fase 5 — Cobranza** | Cobro automático mensual + facturación | 🟢 **Validada en entorno de prueba** (falta activar las cuentas reales) |

**En síntesis: las 5 fases están construidas.** Lo que resta no es desarrollo, sino **activación de servicios externos** y **validación final**.

---

## 4. Lo que ya funciona (verificado)

### ✅ El producto completo
- Aplicación de escritorio publicada, con actualización automática (los usuarios reciben las mejoras sin reinstalar)
- Extensión de Chrome **aprobada y publicada por Google** en la Chrome Web Store
- Página web pública con planes, precios y explicación del producto

### ✅ El recorrido completo del usuario
Desde que una persona se registra hasta que opera mes a mes, todo el circuito está implementado y probado:
- Registro con verificación por email
- Período de prueba de 20 usos gratuitos en la app + extensión de Chrome habilitada
- Activación con control administrativo (filtro de seguridad)
- Configuración del medio de pago
- Cobro automático mensual
- Cancelación y reactivación de la suscripción
- Manejo de pagos rechazados con período de gracia

*(El detalle visual de este recorrido está en el documento "Diagrama de flujo del usuario").*

### ✅ El cobro automático
- Integrado con **MercadoPago** (la pasarela más usada en Argentina)
- Probado de punta a punta en el entorno de pruebas de MercadoPago: alta, cobro, cancelación, reactivación y recuperación de pagos fallidos funcionan correctamente
- **Los datos de tarjeta nunca tocan nuestros servidores** — se manejan en la plataforma segura de MercadoPago

### ✅ La facturación
- Panel de administración con sección de facturación
- Sistema de emisión de facturas operativo (modo manual: se sube la factura generada en ARCA y el usuario la recibe al instante en su portal)

### ✅ El soporte al cliente
- Sistema de tickets
- Asistente con inteligencia artificial para responder consultas frecuentes

---

## 5. Lo que falta (y por qué no es desarrollo)

Es importante entender que **lo pendiente NO es construir cosas nuevas**, sino **activar y validar**. Se divide en tres grupos:

### 🔴 Grupo 1 — Activación de cuentas externas (gestión, no programación)
| Pendiente | Qué implica | Quién lo resuelve |
|---|---|---|
| **MercadoPago producción** | Pasar de la cuenta de prueba a la cuenta real para cobrar dinero de verdad | Gestión administrativa (crear cuenta y cargar credenciales) |
| **Firma digital del instalador** | Certificado que elimina advertencias de seguridad de Windows al instalar | Trámite con Microsoft (1-3 días) |
| **Servicio de facturación automática** | Opcional — hoy la facturación es manual y funciona | Contrato con proveedor (no urgente) |

### 🟡 Grupo 2 — Verificaciones técnicas rápidas
- Confirmar la renovación automática del certificado de seguridad del sitio (vence el 29 de junio)
- Un ajuste menor de permisos en la base de datos

### 🟠 Grupo 3 — Preparación para escala (post-Beta)
- Ambiente de pruebas separado del de producción
- Auditoría de seguridad profunda
- Estos puntos son **recomendables antes de un lanzamiento masivo**, pero **no bloquean una Beta controlada** con pocos usuarios.

---

## 6. Requisitos mínimos para iniciar la Beta

Para abrir el producto a un grupo reducido de usuarios reales, recomendamos completar estos **tres puntos**, todos de bajo esfuerzo:

| # | Tarea | Esfuerzo | Por qué |
|---|---|---|---|
| 1 | **Activar MercadoPago real** | Bajo (gestión) | Para poder cobrar de verdad durante la Beta |
| 2 | **Verificar renovación del certificado de seguridad** | Muy bajo | Evitar que el sitio muestre advertencias |
| 3 | **Firmar digitalmente el instalador** | Bajo (trámite) | Mejora drásticamente la confianza al instalar la app |

> **Nota:** si la Beta se hace con cobro simbólico o sin cobro inicial, incluso el punto 1 podría posponerse, permitiendo arrancar la prueba **de inmediato**.

---

## 7. Evaluación de riesgos para la Beta

| Riesgo | Nivel | Mitigación |
|---|---|---|
| Falla en el cobro automático | 🟢 Bajo | Ya validado de punta a punta; MercadoPago reintenta automáticamente |
| Pérdida de datos de usuarios | 🟢 Bajo | Copias de seguridad funcionando; datos en servidor profesional |
| Filtración de credenciales judiciales | 🟢 Muy bajo | Por diseño, nunca pasan por nuestros servidores |
| Sobrecarga del servidor con muchos usuarios | 🟡 Medio | Adecuado para una Beta reducida; escalar antes del lanzamiento masivo |
| Advertencia de Windows al instalar | 🟡 Medio | Se resuelve con la firma digital (punto 3) |

**El perfil de riesgo para una Beta controlada es bajo.**

---

## 8. Recomendación final

> **El proyecto está en condiciones de iniciar una Beta con usuarios reales.**

Las 5 fases de desarrollo están construidas y el circuito completo —desde el registro hasta el cobro recurrente— fue probado exitosamente en entorno de pruebas. Lo que separa al proyecto de la Beta no es desarrollo de software, sino **trámites de activación** que se resuelven en días.

**Camino sugerido:**
1. **Semana 1:** activar MercadoPago real + verificar certificado + iniciar trámite de firma digital
2. **Semana 1-2:** seleccionar entre 5 y 15 usuarios de confianza (abogados/procuradores conocidos)
3. **Beta:** acompañamiento cercano, recolección de feedback y métricas de uso real
4. **Post-Beta:** auditoría de seguridad y preparación de infraestructura para apertura masiva

---

## 9. Conclusión para inversores

Procurador SCW no es un prototipo ni una idea: es un **producto terminado, en producción, con monetización resuelta**. La inversión de desarrollo ya rindió sus frutos principales. La etapa actual es de **validación de mercado**, que es exactamente lo que una Beta busca: confirmar que usuarios reales pagan por el producto y lo usan de forma recurrente.

El próximo hito —pasar de "producto listo" a "primeros clientes pagando"— está a **días de distancia**, no meses.

---

*Documento preparado para evaluación interna. Para detalle técnico, consultar la documentación del proyecto.*
