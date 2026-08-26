# M0 — Spike de viabilidad del módulo Markdown / anonimización

> **Fecha:** 2026-08-26 · **Ejecutado con:** Opus 5
> **Gate de:** [`plan-modulo-markdown-anonimizacion-2026-08-26.md`](plan-modulo-markdown-anonimizacion-2026-08-26.md) §2
> **Ítem del roadmap:** Etapa 1.2 de [`roadmap-salida-a-mercado-2026-08.md`](roadmap-salida-a-mercado-2026-08.md)
>
> **Resultado: ✅ GATE SUPERADO — ESCENARIO A**, el más barato de los tres. M3 se implementa con
> `fetch` en Node: **no toca ningún script encriptado, no toca el candado de ejecución, y el módulo
> SÍ puede procesar informes viejos.**
>
> **Todo lo de acá está medido sobre archivos y respuestas reales**, no inferido. Nada se ejecutó
> contra producción ni se instaló nada en el proyecto: `pdfjs-dist` se instaló en un sandbox del
> scratchpad, que es descartable. **Cero cambios en el árbol de dependencias de `electron-app`.**

---

## §1 — Resumen para decidir

| Pregunta del gate | Respuesta | Consecuencia |
|---|---|---|
| **P1** — ¿los PDF tienen capa de texto? | **Sí, mucho más de lo esperado.** Informe principal: **0 % de páginas sin texto**. Adjuntos del SCW: **85,4 % con texto** | ✅ El módulo tiene valor real. **No hace falta OCR en v1** — el marcador descriptivo cubre el 14,6 % restante |
| **P2** — ¿los adjuntos requieren sesión? | **No. Escenario A.** 12/12 descargas sin cookies → `HTTP 200`, `application/pdf` | ✅ M3 es 🟢 bajo, 1 sesión. **No se edita ningún script encriptado** |
| **P3** — ¿cuál es el input? | Carpeta `descargas/` real, patrón `informe_<EXP>_<ISO>.pdf` | ✅ Se confirma **(a) drag & drop + (b) lista de recientes**, con un ajuste (§5) |

**Estimación del módulo: se mantiene en 6–10 sesiones** y **no sube a 9–13** — esa horquilla existía
por si M0 devolvía escenario B o C. Queda descartada.

> 🚨 **Pero el spike encontró algo que ningún documento del módulo contemplaba y que cambia el
> alcance del motor de anonimización: los documentos del SCW se descargan SIN AUTENTICACIÓN.** El
> `.md` generado va a contener esas URLs. Anonimizar los nombres del texto y dejar los enlaces vivos
> produce un archivo que *parece* anonimizado y no lo está. Ver **§4 — el hallazgo**.

---

## §2 — P1: capa de texto

### El informe que genera la app

Muestra: **los 30 informes reales** de `usuarios/27320694359/descargas/`, 4 expedientes distintos
(`FCR 018745/2017`, `FCR 18745/2018`, `FCR 751/2025`, `FCR 9391/2018`).

```
Informes analizados : 30
Páginas totales     : 92
Páginas SIN texto   : 0 (0.0 %)
Páginas con imagen  : 0 (0.0 %)
```

Texto abundante y parejo — entre 283 y 2.248 caracteres por página. Es coherente con que el informe
lo produce Puppeteer: **es texto nativo, no un render**. Extracción directa con `pdfjs-dist`, sin
trucos.

### Los documentos vinculados del SCW

Muestra: **12 adjuntos descargados**, 3 de cada uno de los 4 tipos que aparecen (`despacho`,
`cedula`, `deo`, `sentencia`).

```
Descargas OK (PDF válido) : 12 / 12
Páginas totales           : 41
Páginas SIN texto         : 6 (14.6 %)
Páginas con imagen        : 28 (68.3 %)
```

**Esto contradice —para bien— lo que anticipaba el plan** (*"lo esperable es que buena parte sean
escaneos sin capa de texto"*). El dato que lo explica: **68,3 % de las páginas tienen imagen pero
85,4 % tienen texto**, o sea que la mayoría son **PDF híbridos** — una imagen de fondo o el sello de
firma digital, *más* una capa de texto real por debajo. No son escaneos puros.

Las 6 páginas sin texto están **concentradas en las cédulas de 7 páginas** (páginas 4, 6 y 7), que
es donde se adjuntan anexos escaneados. El resto extrae limpio.

**Decisión que esto confirma:** el marcador descriptivo del brief
(`> [Página 4 — imagen sin texto extraíble]`) es la respuesta correcta y suficiente. **OCR sigue
fuera de la v1**, ahora con un número detrás y no por precaución.

---

## §3 — P2: los enlaces y su acceso — **escenario A**

### Forma de los enlaces

Son anotaciones **`Link` con URI real** (no `action`, no JavaScript). Formato único y uniforme:

```
https://scw.pjn.gov.ar/scw/viewer.seam?id=<token-base64-urlencoded>&tipoDoc=<tipo>
```

**706 URLs distintas** en los 30 informes. Distribución por tipo:

| `tipoDoc` | Apariciones |
|---|---|
| `despacho` | 454 |
| `cedula` | 149 |
| `deo` | 85 |
| `sentencia` | 18 |

**Volumen por informe: entre 1 y 37 adjuntos.** Distribución real: 18 informes con 35 links, 9 con 1,
y uno de 37, 25 y 5 respectivamente. **Es el número sobre el que hay que dimensionar los límites de
M3** — no sobre los 200 hipotéticos que menciona el plan.

### Acceso sin sesión — la prueba

`GET` sin cookies, sin cabeceras de auth, sobre una URL sacada de un informe:

```
HTTP:200  bytes:86830  tipo:application/pdf
Content-Disposition: inline; filename="doc1673032631.pdf"
```

Repetido sobre **los 4 tipos de documento, 3 de cada uno: 12/12 con `HTTP 200` y PDF válido**
(verificado por magic bytes `%PDF-` y parseo real con `pdfjs-dist`, no solo por el status code).

El servidor emite cookies de sesión *en la respuesta* (`JSESSIONID`, `TS0166…`), pero **no las exige
en la petición**: el token de la URL es la única credencial.

> **→ ESCENARIO A.** M3 se implementa con `fetch` en Node, como proponía el brief.
> **No hay que editar `informequickscwpjn.js`, no hay `reencrypt_scripts.js`, no entra en juego el
> candado `active_executions`, y no se pierde la capacidad de procesar informes viejos.**

### Dos hallazgos sobre los tokens que el plan no anticipaba

Comparando el informe más viejo (**30/07**) contra el más nuevo (**25/08**) del **mismo expediente**,
ambos con 35 links y contenido de texto idéntico:

**(1) Los tokens NO son estables entre corridas.** **0 de 35** URLs coinciden. El SCW genera un token
nuevo cada vez que se arma el informe.

**(2) Los tokens viejos NO expiran.** Las URLs del informe del 30/07 —**27 días después**— siguen
devolviendo `HTTP 200` con el PDF correcto.

**(3) Sí existe un identificador estable, y está en la respuesta:** el `filename` del
`Content-Disposition`. Descargando los 5 primeros adjuntos de cada informe:

```
idx | VIEJO 30/07                        | NUEVO 25/08                        | ¿igual?
 0  | doc1673032631.pdf  f80bbda0396d     | doc1673032631.pdf  f80bbda0396d     | nombre ✔  hash ✔
 1  | doc1611117678.pdf  d3088d2cc96e     | doc1611117678.pdf  d3088d2cc96e     | nombre ✔  hash ✔
 2  | doc1276714975.pdf  54755520a246     | doc1276714975.pdf  54755520a246     | nombre ✔  hash ✔
 3  | doc1276714974.pdf  36506d50ff97     | doc1276714974.pdf  36506d50ff97     | nombre ✔  hash ✔
 4  | doc1276714858.pdf  c631a78d6346     | doc1276714858.pdf  c631a78d6346     | nombre ✔  hash ✔
```

Mismo nombre **y contenido byte-idéntico** (md5 igual) pese a URLs distintas.

**Consecuencia directa para M3 — la regla de deduplicación:**
- **Dentro de un mismo informe** → deduplicar por URL (funciona, cada documento aparece 1 vez).
- **Entre informes distintos** → deduplicar por URL **no funciona** y produciría descargas repetidas
  del mismo documento. Hay que usar el `filename` del `Content-Disposition` (`docNNNNNNNNN.pdf`), que
  es el id real del documento en el SCW.

---

## §4 — 🚨 El hallazgo: la anonimización tiene que alcanzar a los enlaces

**Ni el brief ni el plan del módulo lo contemplan, y es lo más importante que salió de este spike.**

El encadenamiento es directo:

1. Los documentos del SCW se abren **sin autenticación** — el token de la URL alcanza (§3).
2. Esos tokens **no expiran** — siguen vivos al menos 27 días, probablemente más.
3. El `.md` que produce el módulo **va a contener esas URLs**, porque salen del informe.
4. El usuario va a **compartir el `.md` anonimizado** — es literalmente para lo que existe el módulo.

**→ Un `.md` con los nombres enmascarados pero los enlaces intactos entrega acceso directo a los
documentos judiciales originales, sin anonimizar y sin login.** Es una anonimización teatral: el
archivo *parece* seguro y no lo es, que es exactamente el modo de falla de mayor consecuencia que el
plan ya identificaba para este módulo (riesgo **R6**), pero por una vía que no estaba en la lista.

**Esto no es un problema del PJN que haya que reportar** — es una decisión de diseño de su visor. Es
un problema **nuestro**, porque nuestro producto promete algo que ese comportamiento rompe.

**Qué hay que decidir en M4** (es decisión de producto del operador, no de implementación). Las tres
opciones, con su costo:

| Opción | Qué hace con el enlace en la versión anonimizada | Costo |
|---|---|---|
| **A — eliminar** | El texto del enlace queda, la URL se borra: `[Despacho 12/03/2026]` | Trivial. **Pierde** trazabilidad al original |
| **B — reemplazar por referencia local** | Apunta al adjunto ya descargado y anonimizado: `[Despacho 12/03/2026](anexos/anexo-03.md)` | Bajo. **Es el más coherente con el módulo**: el adjunto ya se bajó y se anonimizó |
| **C — dejar la URL** | Tal cual viene | Cero. **Rompe la promesa del módulo** — no debería ser el default |

**Recomendación: B como default, A como opción.** **C no debería ser posible sin una advertencia
explícita en pantalla.** La versión *no anonimizada* sí conserva las URLs — ahí no hay problema,
porque es para uso propio.

**Consecuencia para la Etapa 3:** esto entra en el bloque **S10** de SEC-2 como caso de verificación
concreto — *"un `.md` anonimizado no debe contener ninguna URL de `viewer.seam` viva"* es una
aserción binaria y fácil de comprobar, mucho más barata de verificar que la tasa de falsos negativos
del regex de nombres.

---

## §5 — P3: el input del módulo

La carpeta existe y el patrón es el esperado:

```
%APPDATA%\procurador-electron\usuarios\<CUIT>\descargas\informe_<EXPEDIENTE>_<ISO>.pdf
```

**30 archivos, 4 expedientes distintos.** Se confirma la recomendación del plan —
**(a) drag & drop como camino principal + (b) lista de informes recientes como atajo** — con **un
ajuste que sale del dato real**:

**Hay muchísimos duplicados.** De los 30 informes, **18 son del mismo expediente** (`FCR 018745/2017`,
regenerado una y otra vez en las pruebas diarias), con contenido idéntico. Una lista cruda de 30
entradas, casi todas iguales salvo el timestamp, es peor que útil.

**→ La lista (b) debe agrupar por expediente y ofrecer el más reciente de cada uno**, con la fecha
visible. En esta carpeta eso convierte 30 entradas en 4.

---

## §6 — Qué queda fijado para M1–M6

| | Decisión, ya no supuesto |
|---|---|
| **M2** — extracción | `pdfjs-dist` (probado, v6.2.108). El informe principal extrae 100 % del texto |
| **M3** — adjuntos | **`fetch` en Node, escenario A.** Sin Puppeteer, sin sesión, sin candado de ejecución |
| **M3** — límites | Dimensionar sobre **1–37 adjuntos por informe**, no sobre 200 |
| **M3** — dedup | Por URL dentro del informe; por `Content-Disposition filename` entre informes |
| **M3** — páginas sin texto | Marcador descriptivo. Afecta al **14,6 %** de las páginas de adjuntos, **0 %** del informe |
| **M4** — anonimización | **Debe alcanzar a las URLs** (§4). Default recomendado: referencia local |
| **M5** — input | Drag & drop + lista de recientes **agrupada por expediente** |
| **Alcance** | **6–10 sesiones.** La horquilla alta de 9–13 queda descartada |

---

## §7 — Lo que este spike NO responde

Para que "M0 cerrado" no se lea como "el módulo está resuelto":

- **No se probó un expediente con adjuntos escaneados en volumen.** La muestra son 4 expedientes de
  una sola cuenta de prueba. El 14,6 % de páginas sin texto podría ser mayor en un fuero o un juzgado
  que digitalice distinto. **No cambia la arquitectura** — solo la proporción de marcadores.
- **No se midió cuánto tarda** descargar 37 adjuntos ni cuánto pesan en total. Es dimensionamiento de
  M3, con datos que ya se pueden obtener.
- **No se evaluó la calidad del texto extraído** (orden de lectura, tablas, columnas). Solo se contó
  que hay caracteres. Es trabajo de M2.
- **No se probó ningún caso hostil** — PDF corrupto, enlace a un host que no es el PJN, adjunto
  enorme. Es deliberado: eso es el bloque **S10** de la Etapa 3, no M0.
- **Los tokens no expiran "al menos 27 días"** — es el máximo que la muestra permite afirmar. No es
  lo mismo que "no expiran nunca".

---

## §8 — Reproducibilidad

Los tres scripts del spike quedaron en el scratchpad de la sesión (descartable, fuera del repo):
`analizar.mjs` (P1 + P2 sobre los informes), `descargar.mjs` (adjuntos por tipo),
`estabilidad.mjs` / `identidad.mjs` (expiración y id estable). Se rehacen en minutos con lo descrito
acá; no se versionan porque dependen de PDFs reales del operador que no van al repo.

**Sin residuos:** no se instaló nada en `electron-app` ni en `backend-server`, no se tocó
`package.json` ni ningún lockfile, no se escribió en la carpeta de descargas del operador, y no se
ejecutó nada contra el servidor de producción. Las únicas peticiones de red fueron **~30 `GET` de
lectura al visor del SCW**, con URLs provenientes de los informes del propio operador.
