# Bitácora — Decisiones tomadas (las 13, con la solución propuesta)

> **Estado: ✅ Las 13 decisiones CONFIRMADAS (2026-08-12)** — el operador aprobó implementar la
> solución propuesta en cada punto, sin cambios respecto de lo recomendado.
>
> **Consolida tres fuentes:** las 12 preguntas abiertas de §13 de la propuesta, las decisiones
> abiertas de §12, y los hallazgos de la revisión de pre-implementación
> (`revision-bitacora-preimplementacion-2026-08-12.md`). Las respuestas quedaron volcadas también en
> el documento madre (`propuesta-bitacora-agenda-2026-07.md`, columna "Respuesta:" de §13 y recuadros
> de decisión en §4.4, §7, §8, §11).
>
> **Lo importante de la ordenación:** solo **4 decisiones** condicionaban el esquema o la
> arquitectura y había que tomarlas antes de escribir código — son las que más importaba cerrar
> primero, y ya están cerradas. Las otras 9 se resuelven en la sub-fase que las usa, sin costo de
> retrabajo por haberlas confirmado ahora en vez de en el momento.
>
> **Esto NO es la aprobación de la propuesta completa para implementar** — es la resolución de las
> preguntas de diseño que la propia propuesta dejaba abiertas. La propuesta como conjunto sigue
> siendo lo que el operador decida ejecutar o no.

---

## Bloque 0 — Antes de escribir la migración (F1.1)

**Estas 4 eran las únicas que costaban caro si se decidían tarde:** afectan el esquema o la
arquitectura, y cambiarlas después de escrito el código implica una segunda migración o
retrabajo.

| # | Qué se definió | Solución confirmada | Por qué era urgente |
|---|---|---|---|
| **D1** | **Clave de deduplicación del expediente** — cómo se evita que `FCR 018745/2017` (forma del PJN) y `FCR 18745/2017` (forma que tipea el usuario) creen dos fichas del mismo caso. *(Hallazgo N1)* | ✅ **Confirmado.** Se agrega columna **`expediente_key`** con el número normalizado, y el `UNIQUE` va sobre ella en vez de sobre el texto visible. La normalización **reusa `tokenizar()`** de `electron-app/informe/buscarPdfExpediente.js` (código ya probado, nacido del bug `debb503`), extraída a un módulo compartido. Se conserva `expediente` con el texto original, que es lo que el usuario reconoce. | Es una columna y una constraint: está en la migración o no está. Descubrirlo después obliga a migrar fichas reales de usuarios y deduplicar a mano las que ya se partieron. |
| **D2** | **Carve-out de exportación** — al bajar a un plan sin Bitácora, ¿la exportación sigue disponible 90 días, o se corta con 403 igual que el resto? *(Q6 / hallazgo H5)* | ✅ **Confirmado: se sostienen los 90 días.** Coherente con la retención de CUIT que el proyecto ya aplica. Implica: columna **`users.bitacora_lost_access_at`** (seteada por el mismo proceso que cambia de plan) + carve-out explícito en el middleware de gate, solo para `/bitacora/export`. | Elegir la ventana implicaba una columna más en F1.1. Decidirlo en F1.6 hubiera sido una segunda migración. |
| **D3** | **Tope de casos seguidos por usuario** — ¿sin tope, tope global, o tope por plan? *(Q5)* | ✅ **Confirmado: sin tope en v1.** El costo por caso es ínfimo (§10) y un tope arbitrario es fricción sin beneficio. Se revisa solo si aparece abuso real. | Solo la variante "por plan" hubiera afectado la migración; al quedar sin tope, no requiere nada especial en el esquema. |
| **D4** | **Alcance del seed de feriados** — qué años se cargan en F1.1. *(Q11, parte no resuelta)* | ✅ **Confirmado: resto de 2026 + todo 2027**, feriados nacionales + ferias judiciales de enero y julio. El mantenimiento año a año lo cubre el ABM de F1.8. | Es el contenido del seed, que va en la misma migración. |

---

## Bloque 1 — Antes de F1.3 (portal: sección Bitácora)

| # | Qué se definió | Solución confirmada |
|---|---|---|
| **D5** | **Campos del tipo "Vencimiento"** — ¿distinguir hecho procesal vs. extraprocesal como Lex-Doctor, o alcanza un check simple? *(Q8)* | ✅ **Check simple + campo "carácter" opcional**, guardado en el `meta` JSONB ya previsto en el modelo. |
| **D6** | **Nombres finales de las secciones** — ¿"Bitácora" y "Mis expedientes" quedan? *(Q9)* | ✅ **Quedan**, sin cambios. |

---

## Bloque 2 — Antes de F1.5 (píldora + checkbox de plan en admin)

| # | Qué se definió | Solución confirmada |
|---|---|---|
| **D7** | **Qué planes incluyen la Bitácora** *(Q1 / §12 #8)* | ✅ **COMBO sí, EXTENSION no.** |
| **D8** | **¿Habilitada durante el trial?** *(Q2 / §12 #7)* | ✅ **Sí.** |
| **D9** | **En planes sin Bitácora: ¿ítem visible con candado, u oculto?** *(Q3 / §12 #6)* | ✅ **Visible con candado**, con pantalla explicativa. |

---

## Bloque 3 — Antes de F1.6/F1.7 (exportación e importación)

| # | Qué se definió | Solución confirmada |
|---|---|---|
| **D10** | **¿La importación/restauración entra en Fase 1 o se difiere?** *(Q12)* | ✅ **Entra en Fase 1.** Si hiciera falta acortar la fase, **F1.7 es el único candidato razonable a diferir** — nunca F1.6, del que depende. |

---

## Bloque 4 — Antes de F2.1 (botonera en los visores)

| # | Qué se definió | Solución confirmada |
|---|---|---|
| **D11** | **Punto de enganche del post-procesado del visor** — `main.js` tiene que inyectar `bitacoraEnabled` + casos ya seguidos en el HTML que generó el script encriptado. ¿Dónde? *(Hallazgo N2)* | ✅ **Opción B: post-procesar una sola vez, al terminar la corrida, antes del auto-open** (no en `get-visor-path`, que también se usa para abrir visores históricos desde "Ver resultados" y hubiera metido una llamada de red en un handler que hoy funciona sin conexión). **Además: la inyección debe ser reemplazo contra un marcador fijo, no `append` de un `<script>`**, para que sea idempotente ante múltiples aperturas. |

---

## Bloque 5 — Antes de F2.5 (mini-visor del informe individual)

| # | Qué se definió | Solución confirmada |
|---|---|---|
| **D12** | **¿El mini-visor del informe individual se abre siempre, o respeta la config "abrir visor automáticamente"?** *(Q7)* | ✅ **Respeta la config existente.** |

---

## Bloque 6 — No bloquea nada (Fase 3 o después)

| # | Qué se definió | Solución confirmada |
|---|---|---|
| **D13** | **¿El visor del monitor también captura?** *(Q4)* | ✅ **No en v1.** Se evalúa en Fase 3 con datos de uso reales. |

---

## Bloque 7 — Alcance en el dashboard de administración

> Decisión agregada el **2026-08-13**, a partir de la consulta del operador durante la auditoría de
> aislamiento (`auditoria-aislamiento-bitacora-2026-08-13.md`, §6).

| # | Qué se definió | Solución confirmada |
|---|---|---|
| **D14** | **¿El dashboard de administración incorpora algo más de Bitácora?** Concretamente: ¿el admin puede **consultar** los registros de un usuario, **exportar** su backup y **restaurarlo** manualmente? | ✅ **No. Se deja exactamente como estaba previsto.** El dashboard admin incorpora **solo dos cosas**: el checkbox "Incluye Bitácora" en el formulario de planes (F1.5) y el ABM de feriados (F1.8). **El admin NO consulta los registros de Bitácora de un usuario, NO exporta su backup y NO restaura manualmente.** La exportación e importación (F1.6/F1.7) quedan **exclusivamente del lado del usuario**, operadas por el dueño de los datos desde el portal. **Fundamento del operador:** para v1 alcanza con el **backup diario de la base** que ya existe (`backend-server/scripts/backup-db.js`, cron 03:00 → DO Spaces, retención 30 días + copias locales) — cubre la recuperación ante desastre sin construir superficie nueva. **Consecuencia:** el sub-bloque **F1.9** que la auditoría había propuesto **queda descartado**; la Fase 1 se mantiene en sus 8 sub-bloques y ~9-14 sesiones. |

### Por qué esta decisión además simplifica

No es solo "menos trabajo" — descarta de entrada tres cosas que habrían necesitado resolverse:

- **Una discusión de confidencialidad.** La Bitácora contiene la estrategia del caso, las notas y los
  vencimientos del abogado: es el dato más sensible del producto. Al no exponerlo nunca al admin, no
  hay que decidir qué mostrar, ni construir auditoría de accesos, ni justificar nada ante un cliente.
- **La única operación destructiva sobre datos de otro.** Un "restaurar backup en la cuenta de un
  usuario" desde el dashboard es la clase de botón que borra trabajo real por un clic equivocado.
- **Redundancia con lo que ya funciona.** El backup diario ya cubre el escenario de desastre, y su
  restauración es puntual y controlada, no un flujo de UI.

**Si con el uso real aparece la necesidad** (ej. un caso de soporte recurrente de "perdí mis
vencimientos"), se reevalúa entonces con datos concretos — la puerta queda abierta, solo que no se
construye por anticipado.

---

## Resumen

| | Cantidad | Cuándo se necesitaba |
|---|---|---|
| Bloqueaban el inicio (esquema/arquitectura) — **las 4 más importantes** | 4 — D1, D2, D3, D4 | Antes de escribir la migración de F1.1 |
| Se usan durante la Fase 1 | 6 — D5 … D10 | En la sub-fase correspondiente |
| Se usan durante la Fase 2 | 2 — D11, D12 | D11 antes de F2.1; D12 antes de F2.5 |
| No bloquean nada | 1 — D13 | Fase 3 |
| **Alcance del dashboard admin** | **1 — D14** *(agregada 2026-08-13)* | Define qué NO se construye |
| Ya resueltas antes de esta ronda, sin acción | 2 | **Q10** (resuelta en v6: el POST transporta el snapshot completo, sin recorte) · **Q11** (resuelta como F1.8, el ABM de feriados — el alcance del seed quedó como D4) |

**Las 14 decisiones quedan cerradas con la solución propuesta en cada caso.** No hay ninguna
pregunta de diseño pendiente para arrancar F1.1. El único paso que sigue siendo del operador es
decidir **cuándo** arrancar la implementación — la propuesta como conjunto sigue sin comprometerse a
un release ni a fechas.

> 🚨 **Al ejecutar, leer primero §11.0 de la propuesta** — los 3 puntos donde la implementación no
> puede ser descuidada (el gate que rompería el portal, el parser que rompería el cobro, el
> post-procesado que dejaría la procuración sin visor). Son decisiones de *cómo* escribirlo, no de
> *qué* construir, y en los 3 la forma más natural de implementarlo es la que rompe.
