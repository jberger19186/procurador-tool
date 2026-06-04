# Plan de prueba — App Electron (test integral)

**Procurador SCW** · Uso interno del equipo
Última actualización: 2026-06-04

> Este documento es a la vez **plan de pruebas** y **prompt reutilizable**: el bloque
> de abajo está pensado para pegarse tal cual en una sesión de trabajo cuando se
> quieran ejecutar las pruebas E2E de la app Electron. Es autosuficiente (no depende
> de contexto previo). La cuenta de prueba de referencia es `procuradortool@gmail.com`.

---

```
Ejecutá pruebas end-to-end integrales de la app Electron de "Procurador SCW" usando
la cuenta de prueba procuradortool@gmail.com. Regla: solo testear y observar — no
modificar código de la app. Sí podés editar filas SQL del usuario de prueba y
leer logs/estado/tráfico de red.

════════════════════════════════════════════════════════════
QUÉ ES LA APP
Cliente desktop (Electron) que automatiza 3 operaciones sobre el portal del Poder
Judicial de la Nación (PJN) de Argentina, con Puppeteer + el Chrome del usuario:
1) Procuración de expedientes, 2) Generación de informes, 3) Monitor de partes.
Se autentica contra un backend (Express + PostgreSQL) que controla cuotas por plan.
Los scripts de automatización se descargan cifrados (AES-256) y firmados (RSA-2048).
Las credenciales del PJN viven solo en el gestor de contraseñas de Chrome y NUNCA
deben pasar por los servidores de Procurador. También gestiona una extensión de
Chrome y un auto-updater.

════════════════════════════════════════════════════════════
CUENTA DE PRUEBA
- Email: procuradortool@gmail.com   (user_id = 226 en la BD de producción)
- Plan: COMBO_PROMO (plan_id 5)     CUIT: 27320694359
- Estado inicial: registration_status='pending_email', subscription 'suspended',
  trial 0/20 usos, suscripción vigente.
- Límites COMBO_PROMO: 50 procuración · 50 informe · 20 partes activas ·
  novedades ilimitado.

════════════════════════════════════════════════════════════
MODELO DE ACCESO (qué se puede probar en cada estado)
Dos niveles con criterios distintos:
- NIVEL A — sesión/identidad (login, verify-session): permite 'active' o trial
  ('suspended' con usos), incluido pending_email. Acá funciona el onboarding y el
  autocompletado del CUIT (no consume cupo).
- NIVEL B — ejecución/cupo (checkLicense, log-execution): exige email verificado
  ('active' o 'suspended'+'pending_activation' con usos). En pending_email NO se
  pueden correr automatizaciones.
⇒ Para probar contadores/límites de ejecución, primero llevá la cuenta a
  registration_status='active' (o 'pending_activation') por SQL. Para probar solo
  onboarding/CUIT, pending_email alcanza.

════════════════════════════════════════════════════════════
ENTORNO
- Backend + BD: PRODUCCIÓN, con este usuario de prueba dedicado.
  SSH:  ssh -i C:/Users/JONATHAN/.ssh/do_procurador root@142.93.64.94
  BD:   sudo -u postgres psql procurador_db     (proyecto en /var/www/procurador/)
  Tablas clave: users, subscriptions (usage_count/usage_limit, proc_usage,
  batch_usage, informe_usage, monitor_novedades_usage y sus *_bonus, period_start,
  payment_provider), plans, monitor_partes, usage_logs, usage_adjustments,
  token_blacklist, active_executions, support_tickets.
- Automatizaciones: ejecución REAL contra el PJN con credenciales propias,
  cargadas en el gestor de contraseñas del Chrome del perfil dedicado.
- Lanzar la app apuntando a prod y depurable por puerto (CDP):
    $env:BACKEND_URL="https://api.procuradortool.com"
    cd electron-app ; npx electron . --remote-debugging-port=9222
  Renderer accesible en http://localhost:9222. Para automatizar la UI usá un driver
  en carpeta scratch (test-harness/, fuera de electron-app/) con
  puppeteer.connect({ browserURL:'http://localhost:9222' }). En DevTools existe el
  helper window.__testQuota(pct, subsystem) para forzar el banner de cuota.
- Contadores: los incrementa el backend en POST /client/scripts/log-execution según
  el subsistema; estado actual con GET /client/account.

════════════════════════════════════════════════════════════
SEGURIDAD DE LA PRUEBA (no negociable)
1. Backup antes de cualquier cambio: pg_dump completo + SELECT de users/subscriptions
   del user_id=226.
2. Todo UPDATE/DELETE lleva WHERE user_id = 226. Nunca correr
   setup/createTestUser.js contra producción (borra usuarios reales).
3. Un cambio → un SELECT de verificación → tené listo el SQL de restauración antes.
4. Al terminar: restaurar registration_status, status y contadores originales de 226
   y confirmar contra el backup que nada fuera del usuario 226 cambió.

════════════════════════════════════════════════════════════
CASOS A PROBAR (ordenados por prioridad)

── P1. SEGURIDAD Y PRIVACIDAD (críticos) ──
1.1 Privacidad de credenciales PJN: capturar el tráfico de red durante una ejecución
    y CONFIRMAR que la contraseña del PJN nunca sale hacia api.procuradortool.com.
    Revisar que logs/telemetría (securityAudit) no filtren credenciales ni datos
    sensibles.
1.2 Scripts cifrados: validar descarga → descifrado AES-256 → verificación de firma
    RSA-2048 antes de ejecutar. Tamper test: alterar un script cifrado o su firma →
    debe RECHAZAR la ejecución.
1.3 Autodestrucción: el script se borra del disco (carpeta temporal aislada) al
    terminar, y también si la app crashea a mitad.
1.4 Sesión/tokens: expiración del JWT (1h) + refresh automático (heartbeat 5 min);
    logout invalida el token (token_blacklist) → reusar el token viejo debe fallar;
    sesión persistente entre reinicios.
1.5 machineId/hardware binding: login desde otro machineId; que alterar el hardware
    ID no permita saltear el lock de dispositivo.

── P2. RESILIENCIA Y CONCURRENCIA ──
2.1 Fallos de red: backend caído o timeout al iniciar → mensaje claro, sin crash.
2.2 Corte de internet a mitad de una procuración: el lock de ejecución (heartbeat
    30s, TTL 5 min) debe liberarse; la app no debe quedar colgada; reintentar al
    recuperar.
2.3 Lock de ejecución: start adquiere, heartbeat renueva, end libera, lock expirado
    se limpia solo. Cerrar la app abruptamente durante una ejecución no debe dejar el
    lock bloqueando innecesariamente.
2.4 Procesos Chrome zombie: que no queden instancias colgadas tras cerrar.
2.5 Casos borde del PJN: expediente inexistente / sin permisos (no debe descontar
    cuota), PJN en mantenimiento o DOM cambiado (error controlado), credenciales PJN
    incorrectas, sesión PJN que expira en un batch largo.
2.6 Lock de dispositivo: abrir 2ª instancia o usar otro machineId → conflicto
    (HTTP 409, ejecución en otro dispositivo).

── P3. SESIÓN, ONBOARDING E IDENTIDAD (sirve en pending_email) ──
3.1 Login con la cuenta → llega al dashboard.
3.2 Onboarding: detección de Chrome / perfil dedicado, sin crash; recorrer el tour
    (cada paso, skip, reanudar; primera vez vs ya completado por
    onboarding_complete.json).
3.3 Display de cuenta: la UI y GET /client/account coinciden con la BD (usage_count
    y barras por subsistema).
3.4 Autocompletado de CUIT: en "agregar contraseña SCW" (onboarding Y configuración)
    debe completar el campo Sitio (sso.pjn.gov.ar) Y el campo Usuario con el CUIT
    (27320694359), no solo el sitio.
3.5 Multi-cuenta: logout + login con otra cuenta → limpieza de datos de la sesión
    anterior (no se mezclan expedientes/config).

── P4. EJECUCIÓN REAL CONTRA EL PJN (requiere estado con Nivel B) ──
Para cada módulo leer GET /client/account + la fila subscriptions ANTES y DESPUÉS y
verificar que sube el contador correcto:
4.1 Procuración (1 expediente) → proc_usage +1
4.2 Procurar batch (archivo) → batch_usage +1
4.3 Informe (1 expediente) → informe_usage +1
4.4 Monitor: alta de parte → crea fila en monitor_partes (NO consume novedades)
4.5 Monitor: novedades → monitor_novedades_usage +1
4.6 Corrida fallida (sin éxito) → NO descuenta cuota.

── P5. CONFIGURACIÓN ──
5.1 Informe sin una sección: apagar un toggle (tgl-seccionLetrado / tgl-seccionParte /
    tgl-seccionAutorizado / tgl-seccionFavoritos) y generar → la salida OMITE esa
    sección y conserva las demás.
5.2 Persistencia: apagar toggles, cerrar y reabrir → la config se relee igual.
5.3 Combinaciones varias y el caso de todas apagadas (sin crash).

── P6. LÍMITES Y CUOTAS (editar contadores por SQL; restaurar a 0 entre casos) ──
6.1 Aviso: contador al ~85% del límite → banner de advertencia.
6.2 Tope: contador al límite (ej. proc_usage=50) → la operación se bloquea (HTTP 403,
    action:'upgrade') con banner de cuota agotada; el resto de los módulos sigue
    funcionando (aislamiento).
6.3 Partes: insertar partes activas hasta el límite (20) → rechaza la siguiente alta.
6.4 Bonus: con contador al tope, subir el *_bonus → vuelve a permitir hasta
    límite+bonus.
6.5 Reset de período (period_start) y cruce trial → plan pagado (payment_provider
    no-null: contador a 0, límites del plan); ajustes manuales de admin
    (usage_adjustments); contador global vs por subsistema.

── P7. ESTADOS DE SUSCRIPCIÓN (negativos) ──
7.1 status='suspended_admin' → acceso bloqueado.
7.2 expires_at en el pasado → bloqueo por vencimiento.
7.3 trial ('suspended' + 'pending_activation' con usos) → la app permite (los 20).
7.4 usage_count >= usage_limit global → bloqueo (403, action:'upgrade').

── P8. MÓDULOS COMPLEMENTARIOS ──
8.1 Extensión Chrome: instalación desde la app, detección de versión, habilitación
    según plan; probar los 5 flujos (Consulta SCW, Escritos 1, Escritos 2,
    Notificaciones, DEOX) y la generación de PDF.
8.2 Tickets de soporte: crear, comentar, listar; notificación cuando el admin
    responde.
8.3 Notificaciones: toasts del SO (Windows), in-app, y alerta de nueva versión de la
    extensión.
8.4 Auto-updater: detección/descarga/instalación de nueva versión (requiere un
    release de prueba en GitHub).
8.5 Monitor profundo: línea base inicial, detección de novedades nuevas vs ya vistas,
    editar/eliminar partes, persistencia, corrido programado (Monitor-Procurador.ps1).

── P9. CALIDAD, DATOS Y ENTORNO ──
9.1 Salidas: Excel (exceljs) y PDF con contenido correcto, batch grande, expedientes
    con caracteres especiales/acentos, archivos pesados, carpeta de descargas.
9.2 Persistencia local y corrupción: scriptCache, config_proceso.json,
    onboarding_complete.json corruptos o faltantes → recuperación graciosa.
9.3 Ciclo de instalación: instalador NSIS, primer arranque, actualización sobre
    versión previa (conserva datos), desinstalación (no borra appdata).
9.4 Compatibilidad: Chrome en ruta no estándar, Chrome no instalado, Windows 10 vs
    11, distintas versiones de Chrome (el autofill del gestor de contraseñas es
    sensible a la versión).
9.5 UI/UX y rendimiento: minimizar/maximizar/cerrar/resize, navegación entre
    secciones, estados de loading, mensajes de error claros; tiempo de arranque, uso
    de memoria en ejecuciones largas, sin fugas.

── P10. BACKEND (si entra en alcance) ──
10.1 Rate limiting (login, registro, descarga de scripts), validación de inputs,
     headers de seguridad (helmet).
10.2 Flujo de registro + verificación de email + recuperación de contraseña.

════════════════════════════════════════════════════════════
ENTREGABLE
Una tabla caso → esperado → obtenido → ✅/❌, con capturas para los bloqueos, el
autocompletado del CUIT y la configuración de informe; y, para P1, evidencia del
tráfico de red. Empezá confirmando el alcance conmigo y haciendo el backup; después
arrancá por P1. Pará y consultá si algo no coincide con lo esperado.
```
