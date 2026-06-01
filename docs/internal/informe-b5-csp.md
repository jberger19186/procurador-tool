# Informe breve — B-5: Política de Seguridad de Contenido (CSP)

> **Fecha:** 01 de junio de 2026
> **Estado:** único punto de seguridad pendiente. Diferido hasta tener ambiente de staging.

---

**Qué es.** La CSP (Content Security Policy) es una instrucción de seguridad que el servidor le envía al navegador indicándole **de qué fuentes tiene permitido cargar y ejecutar contenido** (scripts, estilos, imágenes). En pocas palabras, es una "lista blanca": el navegador solo ejecuta lo que viene de orígenes autorizados y bloquea todo lo demás. Hoy esta protección está **desactivada** en nuestro sistema (la librería de seguridad Helmet está activa, pero con la CSP apagada).

**Para qué sirve.** Su función principal es **frenar ataques de inyección de código (XSS)**: el escenario donde un atacante logra insertar un script malicioso en una página —por ejemplo a través de un campo de texto— para robar datos o sesiones de otros usuarios. Con una CSP bien configurada, aunque ese script malicioso llegue a la página, el navegador **se niega a ejecutarlo** porque no está en la lista de fuentes autorizadas. Es una capa de defensa adicional, no un reemplazo de las validaciones que ya tenemos.

**Por qué no se activó todavía.** Nuestras páginas (panel de administración, portal de usuario y landing) usan **muchos estilos y algunos scripts "en línea"** —es decir, escritos directamente dentro del HTML en lugar de en archivos separados—. Una CSP estricta bloquea exactamente ese tipo de contenido en línea. Si la activáramos hoy sin preparación, es muy probable que **partes de la interfaz dejen de verse o funcionar correctamente** (botones, estilos, ciertas acciones). Por eso no es un cambio que se pueda hacer "a ciegas" en producción.

**Qué se necesita para hacerlo bien.** Activar la CSP requiere **probarla página por página antes de aplicarla a los usuarios reales**, y ahí es donde entra el ambiente de **staging** (la copia de pruebas del sistema). El procedimiento recomendado es: primero activar la CSP en "modo reporte" —donde el navegador no bloquea nada pero **avisa** qué cosas violarían la política—, recolectar esos avisos, ajustar el código (mover los estilos/scripts en línea a archivos o autorizarlos explícitamente), y recién cuando todo esté limpio, activar la CSP en modo bloqueo. Sin staging, este proceso de prueba y error se haría sobre los usuarios reales, con riesgo de romper la interfaz.

**Conclusión y recomendación.** B-5 es la única tarea de seguridad que queda, y es de **prioridad baja**: su ausencia no representa una vulnerabilidad activa (las protecciones contra inyección que ya tenemos —validación de entradas, consultas parametrizadas, escape de datos— siguen vigentes). La CSP es una capa **adicional** de robustez. Por eso la secuencia lógica es: **montar staging primero** (que de todos modos necesitamos para crecer de forma segura) y, una vez disponible, cerrar B-5 con el método de "modo reporte" sin riesgo para los usuarios. No bloquea la Beta.
