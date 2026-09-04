# Propuesta — "Guardar informe" en Bitácora guarda un registro vacío

> **Estado: PROPUESTA, sin aprobar. No se tocó código.**
> Diagnóstico hecho el 2026-09-04 contra la base de producción y el código real.
> Para ejecutar con un agente independiente, una vez aprobada.

---

## 1. El síntoma que reportó el operador

Al guardar un informe desde el visor hacia Bitácora, **el registro se crea pero el modal no muestra
información**.

---

## 2. Diagnóstico — el modal NO está roto

`renderMexpSnapshot()` (`public/usuarios/app.js`) hace exactamente lo que debe:

```js
const movimientos = Array.isArray(s.data?.movimientos) ? s.data.movimientos : [];
if (movimientos.length === 0) {
    html += '<div class="empty-state"><p>Sin movimientos registrados en esta corrida</p></div>';
}
```

Está diciendo la verdad sobre un dato que **llegó vacío**. El problema es 100 % del lado del dato.

### Evidencia en producción

| id | kind | expediente | `data` |
|---|---|---|---|
| 17 | **informe** | FCR 18745/2017 | `{"movimientos": []}` |
| 44 | **informe** | FCR 18745/2017 | `{"movimientos": []}` |
| 19 | procuracion | FCR 12828/2026 | `{"movimientos": []}` |
| 41 | procuracion | FCR 13764/2025 | `{"movimientos": []}` |

**Los 2 de 2 snapshots de informe que existen están vacíos.** Los de procuración normales traen
1.400–1.700 caracteres con los movimientos completos.

🎯 **La prueba que lo cierra:** el snapshot **44** es del mismo expediente y del mismo día en que el
operador generó un PDF de informe **de 6 páginas llenas de movimientos**. El dato existía; el
snapshot quedó vacío igual.

> Los 2 casos de `procuracion` vacíos son **expedientes distintos y probablemente correctos**: una
> procuración sin movimientos nuevos desde la fecha límite legítimamente devuelve lista vacía. No
> hay que asumir que son el mismo bug — el agente debe confirmarlo antes de tocar nada.

---

## 3. Causa raíz

El visor de informes nunca recibe los movimientos. La cadena los pierde en el primer eslabón:

```
informequickscwpjn.js  →  tiene los movimientos (los usa para el PDF)
        ↓ stdout
main.js:2644           →  batchResults.push({ expediente, ok, exitCode, motivo, caratula })
        ↓                                                              ^^^ sin movimientos
generador_visor.js:162 →  { expediente, ok, exitCode, rutaPDF, caratula }
        ↓ DATOS_BATCH
visor de informes      →  no tiene qué mandar
        ↓ POST /usuarios/capture
backend                →  crea el snapshot con {"movimientos": []}
```

El propio template lo documenta (`visor_informes_template.html:437-441`):

> *"Modelo de datos más simple que el de procuración: solo hay `expediente` / `ok` / `exitCode` /
> `rutaPDF`, sin carátula/dependencia/situación ni movimientos — el informe no trae esos campos."*

### 🔑 El precedente que cambia el análisis

Ese mismo comentario **ya fue desmentido una vez**, en el mismo archivo (`generador_visor.js:166`):

> *"B4 (puntos 19/20): antes se descartaba acá aunque `main.js` ya la mandara — el modelo de datos
> del informe **'no tenía' carátula porque este generador la tiraba, no porque el script no la
> supiera**."*

**Con los movimientos pasa lo mismo.** Están disponibles:

- `testM2.js:682` loguea cada uno al stdout con formato estructurado:
  `Página N | Fila N | Oficina: X | Fecha: X | Tipo: X | Detalle: X`
- `main.js` **ya guarda ese stdout** (`expResult.output`) y **ya lo rasca dos veces**:
  `caratulaInformeExitoso(...)` y `motivoInformeSinPDF(...)`, ambos en
  `electron-app/informe/motivoInformeSinPDF.js` — un módulo compartido creado justo para esto.

O sea: **el dato existe y el patrón para recuperarlo ya está probado en el mismo archivo.**

### Un antecedente de diseño que el agente debe conocer

En **F3.2** (visor del Monitor) se detectó este mismo problema y se decidió **no exponer el botón de
snapshot**, con este razonamiento textual: *"el Monitor nunca trae `movimientos` → un snapshot 'de
monitor' quedaría con `data.movimientos` vacío siempre, **engañoso si se mira junto a un snapshot
real**"*.

Para el informe se expuso el botón igual, y produce exactamente el registro engañoso que allá se
evitó. **La decisión de producto acá es la contraria a la de F3.2** — el operador quiere la función,
no que se retire.

---

## 4. Opciones

| | Qué hace | Vector | Riesgo |
|---|---|---|---|
| **A** | Extraer los movimientos del stdout, como ya se hace con carátula y motivo | Electron → **release** | Raspar texto es frágil ante cambios de formato del log |
| **B** | Que `informequickscwpjn.js` los emita en su payload `RESULT` | script cifrado **+** Electron → **release igual** (main.js debe leerlo) | Toca zona de scripts cifrados; el payload crece |
| **C** | Retirar el botón, como en el Monitor | Electron → release | **Descartada**: el operador quiere la función |
| **D** | Guardar lo que el informe **sí** tiene de valor propio (el PDF) y mostrarlo en el modal | Electron + portal → release | Complementa, no reemplaza |

### Recomendación: **A + D**

**A** porque reusa un patrón ya probado **en el mismo archivo**, para el mismo problema, con el
mismo módulo (`motivoInformeSinPDF.js`) — y no toca scripts cifrados, que es la zona de mayor
riesgo operativo del proyecto.

**D** porque el informe tiene algo que la procuración no: **el PDF generado**. Un snapshot de
informe que muestre "Informe generado — Abrir PDF" además de los movimientos es más útil que uno
que solo replique lo que ya da la procuración.

> **B queda como alternativa** si al implementar A se descubre que el stdout no es confiable (por
> ejemplo, que el formato cambie entre modos de informe). El agente debe **medirlo antes de
> elegir**, no asumirlo.

---

## 5. Plan de ejecución (para el agente independiente)

### F0 — Confirmar el diagnóstico antes de tocar nada

- Reproducir el snapshot vacío con datos reales, no sintéticos.
- **Verificar que el stdout de un informe real contiene los movimientos** en el formato esperado y
  que se pueden extraer de forma no ambigua. Si no es así → replantear con B y avisar.
- Confirmar si los 2 snapshots de `procuracion` vacíos son correctos o un segundo caso.

**Gate:** si el stdout no alcanza, **parar y reportar** en vez de improvisar.

### F1 — Implementación

- Extractor de movimientos en `electron-app/informe/motivoInformeSinPDF.js` (o módulo hermano),
  con el mismo estilo que `caratulaInformeExitoso`.
- Propagar: `main.js` (los 2 call sites: informe individual **y** por lote) → `generador_visor.js`
  → `DATOS_BATCH` → payload de captura del visor.
- (D) Que el snapshot de informe conserve la referencia al PDF y el modal la muestre.

### F2 — Verificación

- **Unitaria del extractor**, con stdout real de un informe (no fabricado), incluyendo:
  - informe con muchos movimientos y **varias páginas**
  - informe **sin** movimientos (debe dar `[]`, no romper)
  - informe fallido / expediente inexistente
  - **control negativo**: que el extractor pueda fallar (si nunca falla, no prueba nada)
- Cadena completa contra staging: visor → `/usuarios/capture` → draft → reclamo → fila en
  `expediente_snapshots` con `data` **no vacío**.
- **No-regresión de procuración**: sus snapshots deben seguir exactamente igual.

### F3 — Corrida real (con el operador)

Con **computer-use**, y **solo lo necesario** — no la prueba diaria completa:

1. Generar **un informe real** desde la app.
2. Guardarlo a Bitácora desde el visor.
3. Abrir el portal y **verificar que el modal muestra los movimientos**.
4. Confirmar por SQL que `data` tiene contenido real.

⚠️ **Costo:** un informe consume **3 usos** de cupo. Verificar y recargar antes (ver §A del
procedimiento de prueba diaria en `CLAUDE.md`).

### F4 — Cierre

- Documentar en `CLAUDE.md`.
- Aplicar la regla de cierre de fase: sin ejecuciones en segundo plano, sin temporales, repo limpio.

---

## 6. Vector de despliegue y coste

- **Requiere release de Electron** (v2.7.57) — es código de cliente, no llega por backend.
- Si se elige **B**, además: `scp` del script + `pm2 restart` (con **dry-run del ofuscador antes**,
  por E9).
- Portal (`app.js`) si se implementa **D**: `scp` + restart, sin release.

**Modelo/esfuerzo sugeridos:** Sonnet, esfuerzo alto. No toca autenticación, criptografía ni cobro;
la dificultad está en el volumen de la cadena (5 eslabones) y en que la verificación sea real.
**Revisión Fable: no** — salvo que se termine eligiendo B, que sí toca la zona de scripts cifrados.

---

## 7. Lo que esta propuesta NO cubre

- **El snapshot del Monitor** sigue deliberadamente sin botón (decisión de F3.2). Si se quiere
  también, es otra discusión: el Monitor genuinamente no tiene movimientos que mostrar.
- **Los 2 snapshots vacíos ya existentes** (ids 17 y 44) no se pueden rellenar retroactivamente —
  el dato de esas corridas ya no está. Se pueden dejar o borrar; es decisión del operador.
- **El CHECK de `expediente_snapshots.kind`** (`'procuracion'|'informe'`) no se toca.
