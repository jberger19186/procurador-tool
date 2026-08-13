# Bitácora — Listado de decisiones pendientes, con solución propuesta

> **Para qué sirve esta hoja.** Es la lista completa de lo que falta definir para poder implementar
> el módulo, **ordenada por el momento en que hace falta la respuesta**, con una solución propuesta
> para cada punto. Está pensada para responderse de una sentada: la mayoría son "sí, dale" al default.
>
> **Consolida tres fuentes:** las 12 preguntas abiertas de §13 de la propuesta, las decisiones
> abiertas de §12, y los hallazgos de la revisión de pre-implementación
> (`revision-bitacora-preimplementacion-2026-08-12.md`).
>
> **Lo importante de la ordenación:** solo **4 decisiones** condicionan el esquema o la arquitectura
> y hay que tomarlas antes de escribir código. Las otras 10 se pueden responder sobre la marcha, en
> la sub-fase que las necesita, sin costo de retrabajo.
>
> **Cómo usarla:** completar la columna "Decisión". Donde dice *"= default"* alcanza con confirmarlo.

---

## Bloque 0 — Antes de escribir la migración (F1.1)

**Estas 4 son las únicas que cuestan caro si se deciden tarde:** afectan el esquema o la
arquitectura, y cambiarlas después implica una segunda migración o reescribir código ya hecho.

| # | Qué hay que definir | Solución propuesta | Por qué ahora | Decisión |
|---|---|---|---|---|
| **D1** | **Clave de deduplicación del expediente** — cómo se evita que `FCR 018745/2017` (forma del PJN) y `FCR 18745/2017` (forma que tipea el usuario) creen dos fichas del mismo caso. *(Hallazgo N1)* | Agregar columna **`expediente_key`** con el número normalizado, y poner el `UNIQUE` sobre ella en vez de sobre el texto visible. La normalización **reusa `tokenizar()`** de `electron-app/informe/buscarPdfExpediente.js` (código ya probado, nacido del bug `debb503`), extraída a un módulo compartido. Se conserva `expediente` con el texto original, que es lo que el usuario reconoce. | Es una columna y una constraint: **está en la migración o no está**. Descubrirlo después obliga a migrar fichas reales de usuarios y deduplicar a mano las que ya se partieron. | |
| **D2** | **Carve-out de exportación** — al bajar a un plan sin Bitácora, ¿la exportación sigue disponible 90 días, o se corta con 403 igual que el resto? *(Q6 / hallazgo H5)* | **Sostener los 90 días.** Es coherente con la retención de CUIT que el proyecto ya aplica, y es la diferencia entre "perdí una feature" y "perdí mis datos". Implica: columna **`users.bitacora_lost_access_at`** (seteada por el mismo proceso que cambia de plan) + carve-out explícito en el middleware de gate, solo para `/bitacora/export`. | Si se elige la ventana, hace falta **una columna más en F1.1**. Decidirlo en F1.6 (cuando se construye el export) = segunda migración. | |
| **D3** | **Tope de casos seguidos por usuario** — ¿sin tope, tope global, o tope por plan? *(Q5)* | **Sin tope en v1.** El costo por caso es ínfimo (§10) y un tope arbitrario es fricción sin beneficio. Revisar solo si aparece abuso real. ⚠️ **Único matiz que toca el esquema:** si se quisiera un tope **por plan**, haría falta una columna en `plans` — por eso está en este bloque y no más abajo. Sin tope o con tope global no requieren nada. | Solo la variante "por plan" afecta la migración. | |
| **D4** | **Alcance del seed de feriados** — qué años se cargan en F1.1. *(Q11, parte no resuelta)* | **Resto de 2026 + todo 2027**, feriados nacionales + ferias judiciales de enero y julio. Estamos en agosto de 2026, así que cargar "2026 completo" sería medio año muerto; y sin 2027 la calculadora de plazos deja de servir en diciembre. El mantenimiento año a año lo cubre el ABM de F1.8. | Es el contenido del seed, que va en la misma migración. | |

---

## Bloque 1 — Antes de F1.3 (portal: sección Bitácora)

| # | Qué hay que definir | Solución propuesta | Decisión |
|---|---|---|---|
| **D5** | **Campos del tipo "Vencimiento"** — ¿distinguir hecho procesal vs. extraprocesal como Lex-Doctor, o alcanza un check simple? *(Q8)* | **Check simple + campo "carácter" opcional.** La distinción de Lex-Doctor arrastra una complejidad de modelo (dos ciclos de vida distintos) que no se justifica en v1; el campo opcional deja registrarlo a quien lo necesite, guardado en el `meta` JSONB que ya está previsto. | |
| **D6** | **Nombres finales de las secciones** — ¿"Bitácora" y "Mis expedientes" quedan? *(Q9)* | **Quedan.** "Bitácora" es distintivo y no colisiona con nada del portal; "Mis expedientes" es literal. Cambiarlos después es tocar UI, rutas `goto=` y el tour. | |

---

## Bloque 2 — Antes de F1.5 (píldora + checkbox de plan en admin)

| # | Qué hay que definir | Solución propuesta | Decisión |
|---|---|---|---|
| **D7** | **Qué planes incluyen la Bitácora** *(Q1 / §12 #8)* | **COMBO sí, EXTENSION no.** COMBO es el plan de la app (donde nacen los datos que la Bitácora organiza); EXTENSION es solo el acelerador de carga del PJN, sin flujo de procuración que capturar. Es dato en `plans.bitacora_enabled`, sin costo técnico cambiarlo después. | |
| **D8** | **¿Habilitada durante el trial?** *(Q2 / §12 #7)* | **Sí.** Es el gancho de conversión más visual que tiene el producto: el usuario de prueba ve sus vencimientos organizados desde el día uno. El riesgo es nulo (el trial ya está topeado por usos). | |
| **D9** | **En planes sin Bitácora: ¿ítem visible con candado, u oculto?** *(Q3 / §12 #6)* | **Visible con candado**, con pantalla explicativa. Es upsell gratis; ocultarlo desperdicia la única superficie donde el usuario descubre que la feature existe. | |

---

## Bloque 3 — Antes de F1.6/F1.7 (exportación e importación)

| # | Qué hay que definir | Solución propuesta | Decisión |
|---|---|---|---|
| **D10** | **¿La importación/restauración entra en Fase 1 o se difiere?** *(Q12)* | **Entra en Fase 1.** Es la contraparte del export y lo que convierte el backup en algo real (un archivo que no se puede restaurar no es un backup). ⚠️ Si hubiera que acortar la fase, **F1.7 es el único candidato razonable a diferir** — nunca F1.6, del que depende. | |

---

## Bloque 4 — Antes de F2.1 (botonera en los visores)

| # | Qué hay que definir | Solución propuesta | Decisión |
|---|---|---|---|
| **D11** | **Punto de enganche del post-procesado del visor** — `main.js` tiene que inyectar `bitacoraEnabled` + casos ya seguidos en el HTML que generó el script encriptado. ¿Dónde? *(Hallazgo N2)* | **Opción B: post-procesar una sola vez, al terminar la corrida, antes del auto-open.** La alternativa (enganchar en `get-visor-path`) se ejecutaría también al abrir visores históricos desde "Ver resultados", metiendo una llamada de red en un handler que hoy funciona sin conexión. El costo de B —que un visor viejo muestre el marcado del día que se generó— **ya está aceptado explícitamente en §4.2c** de la propuesta. **Además, en cualquiera de las dos opciones: la inyección debe ser reemplazo contra un marcador fijo, no `append` de un `<script>`**, para que sea idempotente. | |

---

## Bloque 5 — Antes de F2.5 (mini-visor del informe individual)

| # | Qué hay que definir | Solución propuesta | Decisión |
|---|---|---|---|
| **D12** | **¿El mini-visor del informe individual se abre siempre, o respeta la config "abrir visor automáticamente"?** *(Q7)* | **Respeta la config existente.** Introducir una excepción sería un comportamiento sorpresa para quien ya desactivó la apertura automática. | |

---

## Bloque 6 — No bloquea nada (Fase 3 o después)

| # | Qué hay que definir | Solución propuesta | Decisión |
|---|---|---|---|
| **D13** | **¿El visor del monitor también captura?** *(Q4)* | **No en v1.** Evaluar en Fase 3 con datos de uso reales. El monitor tiene un flujo distinto (descubrimiento de expedientes nuevos, no trabajo sobre casos elegidos) y sumarlo ahora amplía la superficie de F2 sin validación previa. | |

---

## Resumen

| | Cantidad | Cuándo hay que responderlas |
|---|---|---|
| **Bloquean el inicio** (esquema/arquitectura) | **4** — D1, D2, D3, D4 | Antes de escribir la migración de F1.1 |
| Se responden durante la Fase 1 | 6 — D5 … D10 | En la sub-fase que las usa |
| Se responden durante la Fase 2 | 2 — D11, D12 | D11 antes de F2.1; D12 antes de F2.5 |
| No bloquean nada | 1 — D13 | Fase 3 |
| **Ya resueltas, sin acción** | 2 | **Q10** (resuelta en v6: el POST transporta el snapshot completo, sin recorte) · **Q11** (resuelta como F1.8, el ABM de feriados — salvo el alcance del seed, que es D4) |

**Las 4 del Bloque 0 son las únicas urgentes.** Tres de ellas (D2, D3, D4) son "confirmar el default";
la única que requiere leer un poco es **D1**, y es también la más importante: es la que evita el bug
de fichas duplicadas que el proyecto ya sufrió una vez en otra forma.

**Ninguna de las 13 requiere trabajo de investigación previo** — todas tienen la información
necesaria para decidirse ya, y los defaults propuestos son los que recomiendo en todos los casos.
