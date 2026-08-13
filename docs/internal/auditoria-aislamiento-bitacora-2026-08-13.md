# Auditoría de aislamiento — Módulo Bitácora

> **La pregunta que responde este informe:** más allá de lo que la Bitácora *agrega* visiblemente
> (botón en la app, opciones en los visores, secciones nuevas en el portal del usuario), **¿puede su
> implementación romper algo que hoy funciona?** Y si puede, **¿qué hay que hacer para que no?**
>
> **Método:** no es una lectura del plan. Es un relevamiento de **cada punto donde la Bitácora toca
> código, datos o configuración que ya existe y ya está en producción**, verificado contra el código
> real. Para cada uno: qué podría romperse, qué lo protege hoy, y qué falta.
>
> **Elaborado:** 2026-08-13, Opus 5. Sin cambios de código. La propuesta sigue sin aprobar.
>
> **Complementa:** `revision-bitacora-preimplementacion-2026-08-12.md` (que auditó si el plan es
> *correcto*). Este audita si el plan es *aislado* — son preguntas distintas.

---

## 1. Veredicto

**El plan tiene un diseño de aislamiento genuinamente bueno**, y su propiedad más fuerte es
estructural, no disciplinaria: **la Fase 1 completa (≈70% del trabajo) no toca la app Electron en
absoluto** — es backend + portal, con migraciones additivas y un flag que nace apagado. Eso quiere
decir que el grueso del módulo se puede construir, desplegar y probar **sin poner en riesgo el
producto que el cliente usa todos los días**.

Pero el aislamiento **no es automático**: depende de decisiones de implementación que el plan
menciona de pasada o no menciona. Encontré **3 puntos donde una implementación razonable pero
descuidada rompe funcionalidad viva**, y en dos de ellos el daño sería serio:

| # | Punto de contacto | Qué se rompe si se hace mal | Severidad |
|---|---|---|---|
| **A1** | El gate de plan montado en `routes/usuarios.js` | **Las 8 rutas del portal que ya existen** (perfil, contraseña, pagos, facturas, suscripción, chat IA) quedan en 403 para todo usuario sin el flag | 🔴 Alto |
| **A2** | El parser de 5 MB del `capture` | Si se monta mal, **rompe la verificación HMAC de los webhooks de MercadoPago** → pagos que no se acreditan | 🔴 Alto |
| **A3** | El post-procesado del visor (F2.1) | Un fallo de red deja **sin abrir el visor de procuración**, un flujo que hoy es 100% confiable y no depende de internet | 🟠 Medio |

Los tres se resuelven con decisiones de diseño concretas, **todas más baratas que el bug que evitan**.

---

## 2. Mapa completo de puntos de contacto

Todo lo que la Bitácora toca de lo que **ya existe**. Lo que solo *agrega* (tablas nuevas, secciones
nuevas, endpoints nuevos) no está acá — por definición no puede romper nada.

| # | Qué toca | Fase | ¿Puede romper algo vivo? | Verificado |
|---|---|---|---|---|
| 1 | `routes/usuarios.js` — endpoints nuevos + gate | F1.2 | **Sí** — ver A1 | 8 rutas existentes en ese archivo |
| 2 | `server.js` — parser del capture | F2.2 | **Sí** — ver A2 | `express.json:110` tiene el hook `verify` del webhook |
| 3 | `main.js` — post-procesado del visor | F2.1 | **Sí** — ver A3 | El auto-open hoy es puro disco, sin red |
| 4 | `public/usuarios/app.js` — landing por `home_section` | F1.5 | **Sí, acotado** — ver A4 | `navigateTo('plan')` fijo en la línea 340 |
| 5 | `routes/client.js` — `/client/account` + endpoint nuevo | F2.4 | Bajo — es agregar una columna al `SELECT` | Ya hace `LEFT JOIN plans p` con 8 columnas |
| 6 | `visorModal_template.html` — botonera | F2.1 | Bajo — HTML aditivo | Placeholder en la línea 285, `</body>` en 487 |
| 7 | `onboarding/tour.js` — paso nuevo | F2.7 | **No** — ver A5 (verificado) | Completitud = flag booleano, no índice |
| 8 | Tablas `users` / `plans` — 4 columnas nuevas | F1.1 | Bajo — ver A6 | Sin `INSERT` sin lista de columnas (verificado) |
| 9 | `generador_visor.js` — visor de informe batch | F2.1 | Bajo — mismo patrón `DATOS_BATCH` ya usado | — |
| 10 | Release de Electron | F2 | Riesgo inherente a cualquier release | — |

---

## 3. Los hallazgos

### A1 🔴 — El gate de plan puede dejar el portal inutilizable

**Lo que dice el plan.** §8: *"Backend (`routes/usuarios.js`) — Middleware en **todos** los endpoints
de bitácora/expedientes: 403 si el plan no la incluye. **Es el gate real.**"*

**El problema.** `routes/usuarios.js` **no es un archivo vacío esperando la Bitácora**. Hoy tiene
**8 rutas en producción**, verificadas:

```
router.put('/profile')            router.get('/payments')
router.put('/password')           router.get('/invoices')
router.get('/plans')              router.get('/invoices/:id/pdf')
router.post('/ai-chat')           router.get('/subscription/current')
```

Si el gate se implementa de la forma más natural al leer esa frase —`router.use(gateBitacora)` al
tope del archivo— **las 8 quedan detrás del gate**. Un usuario del plan EXTENSION (que por decisión
D7 **no** tiene Bitácora) no podría ver sus facturas, cambiar su contraseña ni usar el chat de
soporte. Y el síntoma sería confuso: "403 — tu plan no incluye la Bitácora" al intentar cambiar la
contraseña.

**Solución propuesta: aislamiento estructural, no por disciplina.** En vez de agregar rutas al
archivo existente y confiar en aplicar el gate ruta por ruta:

```js
// routes/bitacora.js — archivo NUEVO, nada existente adentro
router.use(gateBitacora);   // seguro: este router SOLO tiene rutas de Bitácora

// server.js — montaje propio, sin tocar el de /usuarios/api
app.use('/usuarios/api/bitacora',     generalAuthLimiter, require('./routes/bitacora'));
app.use('/usuarios/api/expedientes',  generalAuthLimiter, require('./routes/bitacora-expedientes'));
```

Con eso, **es imposible que el gate afecte una ruta existente** — no por cuidado del implementador,
sino porque no comparten router. Beneficio adicional: si algún día hay que apagar la Bitácora de
urgencia, se comenta **una línea de montaje** y el resto del portal sigue intacto.

> ⚠️ **Excepción a tener presente:** el carve-out de exportación (decisión D2 — 90 días tras perder
> el plan) vive **dentro** de ese gate. Al aislarlo en su propio router, el carve-out queda también
> contenido ahí, que es lo correcto.

---

### A2 🔴 — El parser de 5 MB puede romper el cobro

**Lo que dice el plan.** §4.1.1: montar
`app.use('/usuarios/capture', express.urlencoded({ extended:false, limit:'5mb' }))` **arriba** del
`express.urlencoded` global.

**Lo que el plan no dice, y es lo que importa.** Verificado en `server.js`:

```js
// server.js:109-113
// Capturar rawBody para verificar firma de webhooks MercadoPago (HMAC-SHA256)
app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; }   // ← de esto depende el cobro
}));
app.use(express.urlencoded({ extended: false }));
```

El `express.json` de la línea 110 **no es un parser cualquiera**: su hook `verify` captura el
`rawBody` que usa `routes/webhooks.js` para validar la firma HMAC-SHA256 de MercadoPago. **Si ese
hook deja de correr o el body se consume antes, los webhooks de pago fallan la verificación de firma
y los pagos no se acreditan.**

"Arriba del `urlencoded` global" es ambiguo: admite montarlo **antes de la línea 110** (antes del
`json`) o **entre la 112 y la 113**. Las dos "funcionan" para el capture, pero solo una no toca el
camino del webhook.

**Solución propuesta:**

1. **Montar inmediatamente antes de la línea 113** (el `urlencoded` global), **nunca antes de la
   110**. Así el camino `express.json` + `verify` queda **exactamente como está hoy** para todas las
   demás rutas, incluido el webhook.
2. **Siempre path-scoped** (`app.use('/usuarios/capture', ...)`), **jamás** subir el límite del
   parser global — ya descartado explícitamente en §4.1.1 por el hallazgo C5, y esto lo refuerza.
3. **Prueba de no-regresión obligatoria antes de ir a prod:** disparar un webhook de MercadoPago en
   **staging** (con `dev-tools/smoke-payments.js`, que ya existe y corre 19 checks) y confirmar que
   la firma sigue validando. Es la única forma de comprobar que el `rawBody` no se rompió.

---

### A3 🟠 — El post-procesado puede dejar sin visor a la procuración

**El riesgo.** F2.1 agrega un paso nuevo entre "el script generó el visor" y "se abre el visor":
`main.js` lee el HTML, consulta `GET /client/bitacora/seguidos` (**red**) e inyecta los datos.

Hoy ese camino es **puramente de disco y no puede fallar por red**. La corrida del 12/08 mostró
exactamente por qué importa: hubo una ventana de degradación de red en la que hasta nuestro propio
backend daba timeouts de 30 s. Con el post-procesado sin protección, esa misma tarde **la
procuración habría terminado bien pero el visor no se habría abierto** — el usuario habría visto un
proceso "exitoso" sin resultado a la vista.

**Solución propuesta — que el post-procesado sea siempre opcional:**

1. **Todo el bloque va en `try/catch`, y el `catch` no propaga**: si algo falla (red, permisos,
   archivo en uso), se abre **el visor sin botonera**. Nunca se cancela la apertura.
2. **Timeout corto y explícito** en `GET /client/bitacora/seguidos` (2-3 s, no el default). El
   marcado de "casos ya seguidos" es un adorno; el visor es el entregable.
3. **La consulta de red es opcional, el flag no.** `bitacoraEnabled` sale de `/client/account`, que
   la app ya tiene cacheado de la sesión — no requiere red nueva. Si falla solo la lista de
   seguidos, se inyecta la botonera igual, con la lista vacía (peor caso: el usuario ve `📔+` en un
   caso que ya seguía, y el upsert lo resuelve sin duplicar — comportamiento ya aceptado en §4.2c).

---

### A4 🟠 — `home_section` puede dejar a un usuario aterrizando en una sección que no puede ver

**Verificado:** el portal hoy termina su login con `navigateTo('plan')` fijo
(`public/usuarios/app.js:340`). Con `home_section`, esa línea pasa a depender de una preferencia
guardada del usuario.

**El caso que rompe:** un usuario con COMBO pone la Bitácora como pantalla principal
(`home_section='bitacora'`). Baja a EXTENSION (que por D7 no la incluye). **En cada login aterriza
en una sección gateada.** §8 dice *"`home_section` forzado a `plan`"*, pero si ese forzado ocurre
solo **al momento de cambiar de plan** (un `UPDATE`), cualquier fila que quede desincronizada —un
cambio de plan por un camino que no lo contemple, un dato migrado, una edición manual del admin—
deja al usuario con el portal inutilizable en su pantalla de entrada.

**Solución propuesta: forzarlo en el punto de uso, no solo al escribir.** La línea 340 queda:

```js
// Defensivo: la preferencia solo se respeta si el plan vigente la habilita.
const destino = (homeSection === 'bitacora' && account.bitacoraEnabled) ? 'bitacora' : 'plan';
navigateTo(destino);
```

Así, **aunque el dato quede inconsistente por cualquier motivo, el usuario siempre entra a un lugar
válido.** El `UPDATE` al cambiar de plan sigue siendo correcto; esto es el cinturón además de los
tirantes.

---

### A5 🟢 — El tour NO se rompe (verificado, no asumido)

F2.7 agrega un paso al tour de onboarding. Pregunta obligada: **¿se rompe el tour de quien ya lo
completó, o de quien lo dejó por la mitad?**

**No.** Verificado en `onboarding/tour.js`:

- `currentStep` es una variable **de runtime**, inicializada en `0` en cada corrida (líneas 190, 223).
- La completitud se guarda como **un flag booleano**: `localStorage.setItem(TOUR_KEY, '1')`
  (línea 428) — **no** se guarda ningún índice de paso.
- El fin del tour se detecta por `currentStep >= STEPS.length` (línea 419), que se recalcula solo.

Agregar un paso simplemente hace que quien corra el tour de nuevo vea uno más. **Sin migración, sin
estado que arreglar, sin usuarios a mitad de camino.** Este punto queda cerrado.

---

### A6 🟡 — Las columnas nuevas y los `SELECT *`

**Verificado:** hay **11 lugares** que hacen `SELECT * FROM users` o `SELECT * FROM plans`
(`auth.js` ×4, `admin.js` ×5, `users.js` ×1, `auth.js` planes ×1). Y —lo importante— **no hay ni un
solo `INSERT INTO users/plans VALUES (...)` sin lista explícita de columnas**, que es el patrón que
sí se rompe al agregar columnas.

**Conclusión: agregar las 4 columnas no rompe nada funcional.** El único efecto es que esas consultas
devuelven campos de más, que en JavaScript son propiedades ignoradas.

**Recomendación (higiene, no corrección):** revisar que ninguna de esas 11 consultas devuelva la fila
cruda al cliente con `res.json(row)`. No es un riesgo de seguridad —`bitacora_lost_access_at` y
`home_section` no son secretos— pero es buena práctica no ampliar payloads sin querer.

---

## 4. Las redes de seguridad que el plan YA tiene (verificadas)

En favor del plan, esto ya está bien pensado y lo confirmé:

| Red de seguridad | Estado |
|---|---|
| **`bitacora_enabled` nace en `false` en todos los planes** | ✅ Es el interruptor maestro: aunque todo el código esté desplegado, **ningún usuario ve nada** hasta encenderlo en un plan. Permite desplegar sin exponer. |
| **La Fase 1 completa no toca la app Electron** | ✅ Verificado contra el plan de fases: F1.1-F1.8 son backend + portal. **Sin release, sin auto-updater, sin riesgo sobre el cliente instalado.** Es la propiedad de aislamiento más fuerte que tiene el plan. |
| **Migraciones 100% additivas** | ✅ 4 tablas nuevas + 4 columnas. Cero `ALTER` destructivo, cero cambio de estructura existente. Verificado: sin colisiones con las 27 tablas de producción. |
| **Los scripts encriptados no se tocan** | ✅ Decisión H1/D11: el post-procesado ocurre en `main.js`, después de que el script corrió. **Cero re-encriptado, cero redeploy de scripts** — que es donde vive el motor que el cliente paga. |
| **Sin crons nuevos** | ✅ Los avisos se calculan on-demand. No se suma nada a los 11 crons existentes, así que no puede afectar el procesamiento diario de suscripciones/cobros. |
| **Staging antes que prod en cada sub-bloque** | ✅ Regla transversal explícita en §11.1. |

---

## 5. Lo que falta para que el aislamiento sea completo

Recomendaciones concretas, ordenadas por lo que más protege:

| # | Recomendación | Cuándo | Costo |
|---|---|---|---|
| **R1** | **Router propio para la Bitácora** (`routes/bitacora.js`), montado aparte — no agregar rutas a `routes/usuarios.js` | F1.2 | Ninguno (es dónde poner el archivo) |
| **R2** | **Parser del capture inmediatamente antes de la línea 113**, path-scoped, + smoke de webhooks de MP en staging antes de prod | F2.2 | 1 corrida de `smoke-payments.js` |
| **R3** | **Post-procesado en `try/catch` que nunca cancele la apertura del visor**, con timeout corto en la consulta de seguidos | F2.1 | Ninguno (es cómo escribirlo) |
| **R4** | **`home_section` validado en el punto de uso**, no solo al escribir | F1.5 | Una condición |
| **R5** | **Prueba de no-regresión del portal al cerrar F1.2**: entrar con un usuario **sin** el flag y verificar que las 8 rutas existentes siguen funcionando | F1.2 | 10 minutos |
| **R6** | **Prueba de no-regresión de los 3 flujos reales al cerrar F2**, con el flag **apagado** — confirma que un usuario sin Bitácora no nota ningún cambio | F2 | La prueba diaria que ya se hace |

**R5 y R6 son las que convierten el aislamiento de intención en hecho comprobado.** Son baratas y son
exactamente el tipo de verificación que este proyecto ya sabe hacer.

---

## 6. Consulta: ¿el dashboard de administración va a tener algo de Bitácora?

**Respuesta corta: hoy el plan prevé muy poco, y nada de lo que estás preguntando.**

**Lo que SÍ está previsto** (verificado en la propuesta, es todo):

| Qué | Dónde | Fase |
|---|---|---|
| Checkbox **"Incluye Bitácora"** en el formulario de planes | Dashboard admin → Planes | F1.5 |
| **ABM de feriados** (fecha + motivo) para la calculadora de plazos | Dashboard admin → sección nueva | F1.8 |

**Lo que NO está previsto — exactamente lo que preguntás:**

- ❌ Ver los registros de Bitácora **de un usuario** desde su ficha
- ❌ Que el admin **exporte/respalde** la Bitácora de un usuario
- ❌ Que el admin **cargue/restaure** un backup en la cuenta de un usuario

La exportación e importación del plan (F1.6/F1.7) son **exclusivamente del lado del usuario**:
endpoints bajo `/usuarios/api/bitacora/export` e `/import`, operados desde el portal por el dueño de
los datos.

### Mi recomendación, punto por punto

No es una sola respuesta — las tres cosas tienen perfiles de riesgo muy distintos:

| Función | Recomendación | Por qué |
|---|---|---|
| **Consultar** los registros de un usuario | ⚠️ **Sí, pero acotado** | Encaja con lo que la ficha del admin ya hace (Partes en Monitoreo, Últimas ejecuciones, Pagos, Facturas). **Pero la Bitácora no es como esos datos:** contiene la estrategia del caso, notas y vencimientos del abogado — es lo más sensible del producto. Recomiendo mostrar **conteos y metadata** (cuántas entradas, cuántos casos seguidos, última actividad, si tiene vencidos), **no el contenido de las notas**. Alcanza para soporte ("¿el usuario tiene datos?", "¿se le borró todo?") sin convertir al admin en lector del trabajo de su cliente. |
| **Exportar/respaldar** la Bitácora de un usuario | ✅ **Sí, tiene valor real** | Es una operación de **lectura**, y resuelve el caso de soporte concreto: el usuario dice "perdí mis vencimientos" y hoy el admin no tiene forma de darle su propio backup. Reusa el mismo generador de F1.6, cambiando de quién son los datos. |
| **Cargar/restaurar** un backup en la cuenta de un usuario | ❌ **No en v1** | Es la única operación **destructiva sobre datos de otro**. Y es **parcialmente redundante**: el backup diario de la base (`backup-db.js`, cron 03:00 → DO Spaces, retención 30 días) ya cubre la recuperación ante desastre. Si un usuario se autodestruye la Bitácora, la restauración correcta es puntual desde ese backup, no un flujo de UI que puede pisar datos buenos. Si con el uso aparece que hace falta, se agrega después con el cuidado de F1.7 (Opus, alto). |

### ✅ DECISIÓN DEL OPERADOR (2026-08-13): se deja como estaba previsto — **no se agrega nada**

**El operador resolvió que el administrador NO consulte los registros de Bitácora desde el
dashboard, y que NO exporte ni restaure manualmente.** El sub-bloque F1.9 propuesto arriba **queda
descartado**; el dashboard admin incorpora únicamente lo que ya estaba en el plan (checkbox de plan
en F1.5 + ABM de feriados en F1.8).

**Fundamento:** para v1 alcanza con el **backup diario de la base** que ya está en producción
(`backend-server/scripts/backup-db.js`, cron 03:00 → DO Spaces, retención 30 días + copias locales
en `/var/backups/procurador/`). Cubre la recuperación ante desastre sin construir superficie nueva.

**Registrado como decisión D14** en `bitacora-decisiones-pendientes-2026-08-12.md`.

**Lo que esta decisión evita, además del trabajo:**

- **La discusión de confidencialidad.** Al no exponer nunca la Bitácora al admin, no hay que decidir
  qué mostrar, ni construir auditoría de accesos, ni justificar nada ante un cliente. La estrategia
  del caso y las notas del abogado quedan solo con su dueño.
- **La única operación destructiva sobre datos de otro.** Un "restaurar backup en la cuenta de un
  usuario" desde el dashboard es la clase de botón que borra trabajo real por un clic equivocado.
- **Redundancia.** El backup diario ya cubre el desastre, y su restauración es puntual y controlada.

**La puerta queda abierta:** si con el uso real aparece un caso de soporte recurrente ("perdí mis
vencimientos"), se reevalúa entonces con datos concretos — pero no se construye por anticipado.
**Efecto en el plan: ninguno.** La Fase 1 se mantiene en 8 sub-bloques y ~9-14 sesiones.

---

## 7. Resumen

| Pregunta | Respuesta |
|---|---|
| ¿La Bitácora puede romper el resto del proyecto? | **Puede, en 3 puntos concretos** (A1, A2, A3) — todos evitables con decisiones de diseño que no cuestan trabajo extra. |
| ¿El plan ya está bien aislado? | **En lo estructural, sí** — Fase 1 sin Electron, flag apagado por defecto, migraciones additivas, sin tocar scripts encriptados, sin crons nuevos. Lo que falta son 4 precauciones de implementación (R1-R4) y 2 pruebas de no-regresión (R5-R6). |
| ¿Cuál es el riesgo más grave? | **A2** — un parser mal montado rompe la firma HMAC de los webhooks de MercadoPago. No es el más probable, pero es el único que toca el cobro. |
| ¿Va a haber algo de Bitácora en el dashboard admin? | **No — decisión tomada (D14, 2026-08-13):** solo el checkbox del plan (F1.5) y el ABM de feriados (F1.8). El admin **no consulta, no exporta y no restaura**. Alcanza con el backup diario de la base. F1.9 descartado. |
| ¿Cambia esto la viabilidad del plan? | **No.** Ninguno de los hallazgos toca el diseño del módulo — son todas precauciones de implementación. |
