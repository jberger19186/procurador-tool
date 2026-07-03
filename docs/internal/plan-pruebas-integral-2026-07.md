# Plan de Pruebas Integral — Julio 2026

> **Objetivo:** validar el producto completo desde la óptica del **usuario** (ciclo de vida entero, todas las variantes) y del **administrador** (operaciones y contingencias).
> **Regla de oro:** durante la ejecución **NO se modifica código**. Todo bug o mejora se documenta en la sección final para reparar después, por separado.
> **Entorno:** producción (MercadoPago en **sandbox** — sin dinero real; DB reseteada el 2026-07-02, solo admins 6 y 7; panel MP con 0 preapprovals vivos).
> **Ejecutor:** Claude (Chrome del operador + API/curl + SQL para acelerar estados y verificar + app Electron con credenciales recordadas). El operador humano: verifica emails en su casilla y provee expedientes PJN.

---

## Convenciones

- **Usuarios de prueba:** `jberger_86+uN@hotmail.com` (alias de Outlook — todos llegan a la misma casilla). Contraseñas de prueba tipo `Prueba1234`.
- **Aceleración de estados:** el paso del tiempo (vigencias, gracias, ciclos) se simula vía SQL sobre `subscriptions` + ejecución de la lógica de los crons ya deployados (o `dev-tools/sim-renewal.js`). Siempre con backup previo de la DB.
- **Evidencia:** cada caso registra Esperado vs Obtenido. Estados: ✅ PASS · ❌ FAIL · ⚠️ PASS con observación · ⏭️ SKIP (con motivo).
- **PJN real:** autorizado por el operador, con expedientes provistos por él (procuración ind/batch, informe ind/batch, monitor).
- **Cierre:** informe de bugs/mejoras priorizado → reset de datos + limpieza MP + backup `.7z` + entrada en CLAUDE.md.

---

## BLOQUE A — Óptica del ADMINISTRADOR

### A1. Gestión de usuarios

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A1.1 | Alta manual de usuario (＋ Agregar usuario) con plan pago | Usuario `pending_email` + email con credenciales + link verificación | |
| A1.2 | Alta con email duplicado | Rechazo con mensaje claro | |
| A1.3 | Alta con CUIT duplicado | Rechazo con mensaje claro | |
| A1.4 | Alta con CUIT inválido (dígito verificador) | Rechazo | |
| A1.5 | Alta con contraseña débil (sin número / <8) | Rechazo con requisito específico | |
| A1.6 | Reenviar verificación a `pending_email` | Nuevo email llega, token nuevo funciona | |
| A1.7 | Activar usuario en trial | `active`, conserva usos restantes del trial | |
| A1.8 | Suspender usuario activo (con motivo) | `suspended_admin`, no puede loguear app; ve motivo | |
| A1.9 | Reactivar suspendido | Vuelve a `active` | |
| A1.10 | Rechazar usuario (block) | `rejected`, bloqueo total | |
| A1.11 | Rechazar manteniendo trial (keep_trial) | Sigue `pending_activation` con usos | |
| A1.12 | Editar email del usuario | Suspende a `pending_email`, email de verificación al NUEVO correo; al verificar restaura estado previo | |
| A1.13 | Editar email a uno ya tomado | Rechazo | |
| A1.14 | Blanquear contraseña | Usuario puede loguear con la nueva | |
| A1.15 | Historial de la cuenta registra todo lo anterior | Eventos con fecha y autor | |

### A2. Gestión de planes

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A2.1 | Crear plan público pago (precio en el alta) | Aparece en registro y portal; precio persistido | |
| A2.2 | Crear plan privado pago | NO aparece en registro/portal; admin lo ve | |
| A2.3 | Crear plan cortesía ($0 explícito, privado) | Etiqueta [GRATIS]; habilita campo vigencia en alta de usuario | |
| A2.4 | Cambiar visibilidad público→privado en caliente | Desaparece del registro/portal al instante | |
| A2.5 | Editar límites/precio de un plan | Persisten; usuarios del plan ven límites nuevos | |
| A2.6 | Desactivar plan | No elegible; suscripciones existentes intactas | |
| A2.7 | Vigencia real del plan (plan_expiry_date) | Se propaga a suscripciones activas del plan | |
| A2.8 | Usuario intenta autoasignarse plan privado por API | 400/403 — blindaje server-side | |

### A3. Suscripciones (desde ficha)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A3.1 | Upgrade con MP activo | Inmediato; monto MP ajustado al nuevo (sin cobro ya) | |
| A3.2 | Downgrade con MP activo | Programado a fin de ciclo; límites conservados; evento | |
| A3.3 | Cambio de plan a usuario en trial | Solo cambia plan; conserva cupo 20 | |
| A3.4 | Cortesía $0 a usuario pagando | Aplica ya + vigencia + pausa preapproval MP | |
| A3.5 | Cortesía $0 a usuario trial | Activo con vigencia | |
| A3.6 | Campo días en upgrade | Fija expires_at | |
| A3.7 | Cancelar al fin de ciclo | cancel_at + preapproval paused + banner | |
| A3.8 | Deshacer cancelación | preapproval authorized + cancel_at limpio | |
| A3.9 | Resetear uso | usage_count=0 | |
| A3.10 | Ajuste ±bonus por submódulo | Límite efectivo cambia en app/portal | |
| A3.11 | Usos extra (cortesía ±N) | Suma/resta a usage_limit; visible "(+N)" | |
| A3.12 | Beneficio comercial (con y sin ticket) | Registrado en historial de beneficios | |

### A4. Cobranza (pagos y facturas)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A4.1 | Alta de pago manual | Aparece en Pagos y en historial del usuario | |
| A4.2 | Crear factura desde pago (subir PDF) | Vinculada; visible en portal del usuario | |
| A4.3 | Factura manual sin pago | Registrada; visible para el usuario | |
| A4.4 | Asociar/desasociar pago↔factura | Links cruzados navegan y resaltan | |
| A4.5 | Editar registro manual (pago/factura) | Cambios persisten; no-manuales rechazados | |

### A5. Tickets y soporte

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A5.1 | Usuario crea ticket → admin responde | Email al usuario; estado in_progress | |
| A5.2 | Nota interna | Usuario NO la ve en su portal | |
| A5.3 | Priorizar con IA | Prioridad + razonamiento; badge 🤖 | |
| A5.4 | Proyectar respuesta con IA | Sugerencia editable; no auto-envía | |
| A5.5 | Editar respuesta enviada | Label "editado"; sin nuevo email | |
| A5.6 | Resolver ticket | Usuario lo ve RESUELTO | |

### A6. Contingencias

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A6.1 | Webhook MP duplicado (mismo evento 2×) | Idempotente: no duplica pago | |
| A6.2 | Dos checkouts seguidos (single-active) | 1 solo preapproval vivo; el viejo cancelado | |
| A6.3 | Cancelar preapproval desde MP (lado usuario) | Webhook sincroniza baja programada | |
| A6.4 | Cron cancelación con pago reciente (guard) | NO cancela | |
| A6.5 | Cron vigencia: período pago en curso | Pausa MP + corte al fin de período (no inmediato) | |
| A6.6 | Cron vigencia: período ya vencido | Suspende ya + gracia 7 días | |
| A6.7 | Cron downgrade programado | Aplica plan + baja monto MP + evento | |
| A6.8 | Gracia de pago vencida (cron) | suspended por pago fallido | |

### A7. Seguridad / negativos

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| A7.1 | Endpoint admin sin token | 401 | |
| A7.2 | Endpoint admin con token de usuario común | 403 | |
| A7.3 | Bot IA: pedir info interna (endpoints/DB/admin) | Declina + ofrece ticket | |
| A7.4 | Bot IA: pedir datos de otro usuario | Declina | |
| A7.5 | Rate limit del bot (21ª consulta en 1h) | 429 | |
| A7.6 | Registro con toggle público cerrado | 403 registro no habilitado | |

---

## BLOQUE U — Óptica del USUARIO (ciclo de vida)

### U1. Registro público

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U1.1 | Registro OK por formulario (plan público) | pending_email + email de verificación | |
| U1.2 | CUIT inválido | Error específico | |
| U1.3 | Email ya registrado | Error | |
| U1.4 | CUIT ya registrado | Error | |
| U1.5 | Contraseña débil | Error con requisito | |
| U1.6 | Plan privado NO listado en el form | Ausente | |

### U2. Verificación de email

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U2.1 | Click en link → verificado | pending_activation, trial 20 | |
| U2.2 | Reenvío de verificación desde portal | Nuevo email funciona | |
| U2.3 | Link ya usado | Página "ya verificado" | |
| U2.4 | Token vencido (forzado) | Error claro + camino de reenvío | |

### U3. Trial (20 usos compartidos)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U3.1 | Portal muestra X/20 con barra | Correcto | |
| U3.2 | A 18/20: aviso "quedan pocos usos" | Visible | |
| U3.3 | A 20/20: "Ya consumiste tus usos" | Visible; sesión sigue viva | |
| U3.4 | Extensión a 20/20 | extension-auth 403 | |
| U3.5 | App con trial agotado | Login OK (ver cuenta), ejecutar bloqueado | |
| U3.6 | Checkout bloqueado en pending_activation | Botón deshabilitado + guard 403 | |

### U4. Activación y primer pago

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U4.1 | Admin activa → botón de pago habilitado | Portal lo muestra | |
| U4.2 | Checkout MP sandbox completo | Preapproval vinculado; pago registrado; límites plan; contadores 0 | |
| U4.3 | Volver del checkout sin pagar | NO marca pago (configured:false) | |

### U5. Vida paga

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U5.1 | Límite de submódulo alcanzado | Bloqueo del módulo con mensaje; otros siguen | |
| U5.2 | Renovación mensual (sim-renewal) | Contadores 0; pago+factura nuevos; next_billing +1 mes | |
| U5.3 | Banner de cuota (app) | Correcto según submódulo | |

### U6. Cambio de plan (self-service)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U6.1 | Upgrade | Inmediato + monto MP próximo ciclo | |
| U6.2 | Downgrade | Programado; banner; límites conservados | |
| U6.3 | Cancelar downgrade programado | Vuelve a plan actual; contador devuelto | |
| U6.4 | 3er cambio en el ciclo | Rechazado (tope 2) | |
| U6.5 | Cambio con cancelación pendiente | Bloqueado con mensaje | |

### U7. Cancelar / reactivar (portal)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U7.1 | Cancelar suscripción | cancel_at; MP paused; banner; acceso hasta fin de período | |
| U7.2 | Reactivar antes del vencimiento | MP authorized; sin cobro nuevo | |

### U8. Pago rechazado → gracia → suspensión → recuperación

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U8.1 | Pago rechazado (simulado) | Gracia 3 días; banner ámbar portal+app; notificación | |
| U8.2 | Gracia vencida (cron) | suspended; ejecutar bloqueado; login permite ver/pagar | |
| U8.3 | Pagar estando suspendido | Recuperado; single-active | |

### U9. Plan vencido → reactivación

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U9.1 | Vigencia vencida (forzada) + cron | suspended_plan_expired; aviso | |
| U9.2 | Portal ofrece elegir plan público + pagar | Solo públicos listados | |
| U9.3 | Pagar reactivación | Cuenta activa con plan nuevo | |

### U10. Cuenta creada por admin

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U10.1 | Email con credenciales + verificación | Llega completo | |
| U10.2 | Verificar con plan $0 | Activo con cortesía y vigencia | |
| U10.3 | Verificar con plan pago | pending_activation (trial) | |
| U10.4 | Cambiar contraseña temporal | Funciona; login con la nueva | |

### U11. Portal completo

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U11.1 | Perfil: editar datos; CUIT NO editable | Correcto | |
| U11.2 | Cambio de contraseña (política + indicador) | Correcto | |
| U11.3 | Crear ticket + ver respuesta | Correcto | |
| U11.4 | Bot IA: consulta resolutiva | Pasos concretos útiles | |
| U11.5 | Ayuda: FAQ + manual inline (secciones nuevas) | Visibles | |
| U11.6 | Notificaciones in-app | Llegan y se marcan leídas | |
| U11.7 | Descargas (app + extensión) | Links funcionan | |

### U12. App Electron (con credenciales recordadas + expedientes provistos)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U12.1 | Login estados: trial / activo / suspendido | Mensajes y banners correctos | |
| U12.2 | Mi Cuenta: contadores y barras | Fieles a DB | |
| U12.3 | Procuración individual (PJN real) | Ejecuta; visor abre; contadores +1 | |
| U12.4 | Procuración batch (PJN real) | Ejecuta; visor batch correcto | |
| U12.5 | Informe individual (PJN real) | PDF/Excel generados | |
| U12.6 | Informe batch (PJN real) | Excel+visor batch | |
| U12.7 | Monitor: alta de parte + consulta (PJN real) | Parte agregada; consulta corre | |
| U12.8 | Bloqueo por límite de submódulo (pre-check) | Toast antes de abrir Chrome | |
| U12.9 | SSO al portal desde la app | Auto-login correcto | |
| U12.10 | Archivos en carpeta del usuario (CUIT) | descargas/ correcta, raíz intacta | |

### U13. Extensión Chrome (gates por API)

| ID | Caso | Esperado | Resultado |
|---|---|---|---|
| U13.1 | extension-login según estado (trial/activo/suspendido) | Permite/bloquea correcto | |
| U13.2 | Flujos según plan (extension_flows) | Lista correcta | |

---

## 🐛 Hallazgos — Bugs y Mejoras (se completa durante la ejecución)

| # | Sev | Tipo | Caso | Descripción | Propuesta |
|---|---|---|---|---|---|
| | | | | | |

---

## Registro de ejecución

| Fecha | Bloques ejecutados | Notas |
|---|---|---|
| | | |
