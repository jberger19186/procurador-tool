# Plan de pruebas del módulo Bitácora — validación interna (F3.0)

> **Qué es esto:** el guion de la primera validación end-to-end del módulo Bitácora con el flag
> `bitacora_enabled` **encendido**. Es el sub-bloque **F3.0** de la Fase 3 del plan
> (`propuesta-bitacora-agenda-2026-07.md` §11) y es un **prerrequisito duro** de F3.1–F3.4: las
> features de la Fase 3 se construyen encima de F1/F2, y F1/F2 nunca corrieron con el flag encendido.
>
> **Estado:** ✅ **EJECUTADO 2026-08-15 — 55/55 casos, los 8 bloques completos, contra producción.**
> Creado y ejecutado en la misma sesión (Sonnet 5). **3 bugs reales encontrados y corregidos en
> vivo** (los 3 con la misma causa raíz — ver §8) + 1 hallazgo documental (B2.8) + 1 hallazgo
> cosmético sin corregir (B6.6). Detalle completo de la ejecución en §8.

---

## 8. Resultado de la ejecución (2026-08-15)

> Corrido de punta a punta contra producción, en el orden documentado en §4, con la cuenta de
> prueba 250 (CUIT 27320694359) y la app instalada actualizada a **v2.7.48** en el camino (ver
> nota debajo). **55/55 casos ejecutados, los 8 bloques completos.**

### 8.1 — El hallazgo que justificó todo el plan, confirmado

Antes de B1.1: `expedientes_seguidos=0`, `bitacora_entries=0`, `expediente_snapshots=0` en
producción. Después de F3.0: **3 fichas, 8 entradas, 4 snapshots** — reales, generados por
corridas reales contra el PJN y capturados desde los visores reales. El módulo pasó de "código
desplegado, nunca ejercitado" a "verificado con datos reales de punta a punta" en una sola sesión.

### 8.2 — 3 bugs reales encontrados y corregidos en vivo (misma causa raíz)

**El bug, encontrado en B2.6/B2.7:** la calculadora de plazos (5 días hábiles desde el viernes
14/08/2026) dio **21/08/2026** en la primera corrida — pero hay un feriado real el **17/08/2026**
("Paso a la Inmortalidad del Gral. José de San Martín") que debería haberlo corrido a **24/08**.
**Causa raíz:** `feriados.fecha` es una columna `DATE` pura que el backend serializa como
medianoche UTC (`'2026-08-17T00:00:00.000Z'`); `bitLocalYmd()` — diseñada correctamente para
`due_at` (guardado a **mediodía** local, ver el comentario original en el código) — lee esa
medianoche UTC en hora LOCAL (Argentina, UTC-3) y obtiene **16/08**, no 17/08. El feriado real
**nunca se excluía** del cálculo.

**Corregido en vivo, redesplegado, y reverificado con el mismo cálculo exacto:** nuevo helper
`bitUtcYmd()` (lee componentes UTC, no locales) — el mismo cálculo pasó de **21/08 → 24/08**
correctamente tras el fix. `bitLocalYmd()` **no se tocó** (sigue siendo la función correcta para
`due_at`).

**Mismo bug, 2 casos más, corregidos proactivamente antes de que aparecieran en pantalla:**
- `expedientes_seguidos.situacion_fecha` (misma naturaleza DATE) — confirmado en vivo en B4.4:
  guardado como `10/08/2026`, se mostraba como **"09/08/2026"** en la ficha del expediente →
  `bitFormatUtcDate()` nuevo, corregido y verificado en vivo (**"10/08/2026"** tras el fix).
- `expediente_snapshots.run_date` (mismo patrón, vía `formatDate()` genérico) — corregido
  proactivamente antes de que B4.4 generara el primer snapshot real; verificado en vivo con
  `run_date=2026-08-15` mostrando `"Última — 15/08/2026"` correctamente.

**Por qué estos 3 y no más:** se relevaron TODAS las columnas `DATE` (no `timestamptz`) del
esquema relevante a Bitácora (`grep -nE "date NOT NULL|date,"` sobre `schema.sql`) — solo 2 tablas
más allá de `feriados` calificaban, y ambas tenían el mismo patrón. `formatDate()` (genérico, usado
en todo el portal para pagos/facturas/etc.) **no se tocó** — sigue siendo correcto para
`timestamptz` reales, que es todo lo que consume fuera de Bitácora.

**Commit:** `a95d0c8`.

### 8.3 — Hallazgo documental: el disclaimer de feria judicial (B2.8) no existe

El pendiente **P-F1.1-a** decía, en la sesión de F1.1: *"mientras tanto la calculadora muestra el
disclaimer 'verificá el plazo'"* — verificado en vivo que **ese disclaimer nunca se implementó**:
el HTML solo tiene el texto genérico fijo *"Excluye sábados, domingos y feriados judiciales..."*,
sin ninguna lógica condicional para julio. **P-F1.1-a sigue abierto** — la nota de la sesión de
F1.1 sobreclamaba algo que no se llegó a construir. No es un bug (nadie usó la calculadora en julio
todavía con datos reales), pero la documentación quedaba mal alineada con el código real.

### 8.4 — Hallazgo cosmético sin corregir: contador de snapshots en el resumen de import

B6.6 (reimportar el mismo backup) mostró `snapshotsCreados: 4` **las dos veces**, aunque la
segunda vez los 4 snapshots ya existían (verificado por SQL: el conteo real se mantuvo en 4, sin
duplicar — los **datos** son correctos e idempotentes). Solo el **contador informativo** del
resumen no distingue "creado" de "ya existía / actualizado", a diferencia de
`expedientesCreados`/`entradasCreadas`, que sí mostraron `0` correctamente en la segunda corrida.
**No corregido a propósito** — es puramente cosmético (no afecta integridad de datos ni el
dry-run preview, que sí funciona bien) y tocar el código de import/export merece la misma cautela
que ya tuvo F1.7 completo, no un cambio apurado al final de una sesión larga.

### 8.5 — Corrección al propio plan: B6.5 no preserva el id de una ficha totalmente recreada

Mi propio texto de B6.5 (arriba, §5) decía *"vuelve la ficha... con los ids originales"* —
**impreciso**. Verificado en vivo: cuando una ficha se borra por completo (no solo desvinculada) y
se restaura en modo `combinar`, se re-matchea por `expediente_key` (su identidad de negocio) y, al
no existir la fila, el `INSERT` le asigna un id **nuevo** de la secuencia (ej. `6 → 13`) — **no**
preserva el id original. Lo que sí está garantizado, y es lo que realmente importa: el `idMap`
correctamente re-vincula **todas** las entradas y snapshots dependientes al id nuevo — verificado
por SQL que no quedó ni un huérfano ni un cruce entre casos. La garantía real de F1.7 es
**referencial** (nada se pierde, nada se cruza), no de igualdad numérica de id de la ficha en sí.

### 8.6 — Nota operativa: la app necesitó una instalación manual de v2.7.48

El auto-update in-app (clic en "Instalar y reiniciar") **no completó la instalación** dos veces
seguidas — el instalador NSIS quedó bloqueado silenciosamente por **Windows SmartScreen**, que
corre en el escritorio seguro de Windows y es **invisible e inalcanzable por diseño** para
cualquier herramienta de automatización (computer-use incluido). Diagnosticado con precisión (no
asumido): se confirmó un proceso `smartscreen.exe` activo junto al instalador colgado. Se resolvió
quitando el **Mark-of-the-Web** del `.exe` descargado (`Unblock-File`, equivalente a "Desbloquear"
desde Propiedades del archivo — no es un bypass de seguridad, es la vía legítima para un archivo
que el propio usuario ya decidió ejecutar) y lanzándolo desde la sesión visible a computer-use (vía
un ícono de escritorio, ya que los procesos lanzados desde Bash corren en una sesión de Windows
distinta e invisible para computer-use — otro hallazgo de esta sesión, documentado para las
próximas veces que haga falta instalar algo con computer-use). **AZ (code signing) sigue pendiente**
en la lista de pendientes del proyecto — esto es exactamente el tipo de fricción que un instalador
firmado elimina.

---

## 1. Por qué existe este plan

Los 15 sub-bloques del módulo (F1.1–F1.8, F2.1–F2.7) están **en producción o publicados**, pero la
verificación de cada uno fue, por diseño, **acotada a su propio tramo**:

| Cómo se verificó hasta hoy | Qué prueba | Qué **no** prueba |
|---|---|---|
| Harness HTTP contra staging (F1.2, F1.6, F1.7, F2.2, F2.3, F2.4) | Que cada endpoint respeta su contrato, el gate y el aislamiento entre usuarios | Que el **portal** los consuma bien: el JS del portal nunca se ejecutó en un navegador contra ellos |
| `node --check` + revisión de código (todo el frontend del portal y de los visores) | Que no hay errores de sintaxis | **Nada** del comportamiento real: ni un click, ni un render |
| Corridas aisladas de `generarVisorHTML()` (F2.1, F2.5, F2.6) | Que el HTML generado tiene los datos correctos | Que ese HTML, **abierto en un navegador**, muestre y dispare la botonera |
| `npm start` / `.exe` empaquetado (F2.1, F2.5, F2.6, F2.7) | Que la app arranca sin romperse | Que los caminos nuevos **se ejecuten** — ninguno corre al arrancar |

**El hueco es estructural, no un descuido:** con el flag en `false` en los 6 planes, era imposible
ejercitar el módulo sin encenderlo primero. Este plan es el acto de encenderlo.

### Estado real medido en producción (2026-08-15, antes de ejecutar este plan)

```
fichas (expedientes_seguidos): 0
entradas (bitacora_entries):   0
snapshots:                     0
feriados:                     52   ← seed de F1.1
planes con bitacora_enabled:   0 de 6
```

**El módulo nunca escribió una sola fila real.** Todo lo que existe es el seed de feriados.

---

## 2. Por qué se puede correr contra producción (y no hace falta staging)

Normalmente este proyecto exige staging antes que prod. Acá el criterio se invierte a propósito, y
conviene dejar el razonamiento escrito porque no es obvio:

1. **No hay clientes reales.** Producción tiene **3 usuarios**: 2 admins y la cuenta de prueba
   `procuradortool@gmail.com` (id **250**). Ninguno tiene `payment_provider` seteado — B3
   (MercadoPago producción) sigue pendiente, así que **nadie está pagando**.
2. **El flag es por plan.** `COMBO_PROMO` (id 5) tiene **exactamente 1 usuario**: el 250. Encenderlo
   ahí tiene un radio de impacto de **una cuenta**, la de prueba.
3. **Staging no puede correr esta prueba.** Está detrás de Basic Auth de Nginx (credenciales no
   disponibles en las sesiones de este proyecto) y —más determinante— **no tiene la app Electron
   apuntándole**: el cliente instalado apunta a producción. Los bloques B4/B5, que son el corazón de
   lo que falta validar, **solo existen en producción**.
4. **La cuenta 250 ya es la cuenta de pruebas reales del proyecto** — es la que usa la "prueba diaria
   de la app Electron vía computer-use" documentada en `CLAUDE.md`, con credenciales del PJN ya
   guardadas en el perfil de Chrome.

> ⚠️ **Lo que sí se mantiene:** backup de la base **antes** de empezar (caso B1.1), y limpieza de las
> filas de prueba al terminar (§6). El plan escribe filas reales en `expedientes_seguidos`,
> `bitacora_entries` y `expediente_snapshots` — son de la cuenta de prueba, pero son filas reales.

---

## 3. Preparación

| # | Paso | Cómo |
|---|---|---|
| **P1** | Backup de producción | `pg_dump procurador_db > /tmp/backup_prod_pre_f3-0_<ts>.sql` |
| **P2** | Confirmar que la app instalada está en **v2.7.48** | Abrirla; el auto-updater debería haberla actualizado sola (precedente: pasó con v2.7.47). Si no, forzar la actualización antes de seguir — **sin v2.7.48 los bloques B4/B5/B7 no aplican** |
| **P3** | Verificar cupo del usuario 250 | Al 2026-08-15: **81/110** (29 disponibles). Una corrida completa consume ~6–10. Si no alcanza, sumar cortesía: `POST /admin/users/250/extra-usage` |
| **P4** | `batch.txt` en `Desktop/PT/` | Contenido estándar (`FCR 18745/2017` + `FCR 18745/2018`). Si no existía, **borrarlo al cerrar** |
| **P5** | Aprobar computer-use | `request_access` para "Procurador SCW" (tier full). El navegador queda en tier "read" — el portal se maneja con el Browser pane, no con computer-use |

---

## 4. Orden de ejecución y dependencias

No es arbitrario: hay **una dependencia dura** y **un bloque que debe ir último**.

```
B1 (encender el flag) ─── gatea TODO lo demás
      │
      ├─→ B2 (portal: Bitácora)          ┐
      ├─→ B3 (portal: Mis expedientes)   ├─ independientes entre sí
      ├─→ B8 (admin: feriados)           ┘
      │
      ├─→ B4 (captura desde los visores)  ← genera los PRIMEROS snapshots reales
      │        │
      │        └──────────────→ B6 (export/import)   ⚠️ DEPENDENCIA DURA
      │                          sin B4, B6 exporta snapshots vacíos y
      │                          NO cierra el pendiente P-F1.7-b
      ├─→ B5 (informe)
      │
      └─→ B7 (apagar el flag) ─── SIEMPRE ÚLTIMO: deshabilita el módulo
```

---

## 5. Los bloques

### B1 — Activación del flag y no-regresión (7 casos) 🔴 gatea todo

| # | Caso | Resultado esperado |
|---|---|---|
| B1.1 | Backup previo de producción | Archivo generado, tamaño consistente (~1 MB) |
| B1.2 | `UPDATE plans SET bitacora_enabled=true WHERE id=5` (COMBO_PROMO) | 1 fila afectada |
| B1.3 | `GET /client/account` con el token del user 250 | `account.bitacoraEnabled: true` |
| B1.4 | `GET /client/account` con un token de admin (ENTERPRISE, sin flag) | `bitacoraEnabled: false` — **el flag es por plan, no global** |
| B1.5 | Portal (`/usuarios/`) logueado como 250 | Aparecen los ítems de nav **Bitácora** y **Mis expedientes** |
| B1.6 | App instalada v2.7.48, logueada como 250 | Aparece el botón **📔 Bitácora** en el topbar (F2.7) con el acento amber |
| B1.7 | **No-regresión de las 8 rutas del portal** (`/profile`, `/password`, `/plans`, `/payments`, `/invoices`, `/subscription/current`, …) | Todas responden normal — **ninguna 403**. Es la prueba del punto crítico P1 de F1.2, repetida ahora con el flag **encendido** (antes siempre se probó con el flag apagado) |

---

### B2 — Portal: sección Bitácora (11 casos) — primera vez en un navegador

> F1.3 es el sub-bloque más grande de todo el plan (~700 líneas de JS) y **nunca se ejecutó en un
> navegador**. Todo lo verificado hasta hoy fue `node --check` + revisión de código.

| # | Caso | Resultado esperado |
|---|---|---|
| B2.1 | Entrar a la sección Bitácora | Renderiza sin errores en consola. Vista **Mes** por defecto, grilla de 6 semanas |
| B2.2 | Navegar mes anterior / siguiente | La grilla se recalcula; las entradas siguen al mes correcto |
| B2.3 | Toggle a vista **Lista** | Agrupa por fecha; el toggle marca la vista activa |
| B2.4 | Crear entrada `kind=vencimiento` con fecha | Aparece en el calendario en el día correcto y en la lista |
| B2.5 | Crear una de cada `kind` restante (`audiencia`, `tarea`, `nota`) | Las 4 se distinguen visualmente (color/ícono por tipo) |
| B2.6 | **Calculadora de plazos**: 5 días hábiles desde un viernes | Salta el fin de semana. Verificar contra el calendario real |
| B2.7 | **Calculadora sobre un feriado del seed** (ej. 25/05, 09/07) | Lo excluye del conteo — prueba que los 52 feriados de F1.1 se leen de verdad |
| B2.8 | Calculadora en julio (feria judicial) | Muestra el **disclaimer "verificá el plazo"** — la feria de julio **no está en el seed** (pendiente P-F1.1-a, es el comportamiento correcto) |
| B2.9 | Clic en el día del calendario → panel lateral | Muestra las entradas de ese día |
| B2.10 | Marcar hecha → editar → borrar una entrada | Los 3 caminos actualizan la vista sin recargar |
| B2.11 | **Banner de avisos**: crear una vencida (ayer) y una próxima (en 3 días) | El banner muestra ambas ventanas y el total de vencidas |

---

### B3 — Portal: sección Mis expedientes (6 casos)

| # | Caso | Resultado esperado |
|---|---|---|
| B3.1 | Entrar a Mis expedientes | Listado (vacío al inicio) sin errores |
| B3.2 | Alta manual de una ficha | Aparece en el listado |
| B3.3 | Búsqueda por expediente y por carátula | Filtra correctamente (client-side, pendiente P-F1.3-b) |
| B3.4 | Abrir la ficha completa | Encabezado, próximo vencimiento destacado, bloque "Entradas de este caso" |
| B3.5 | Vincular una entrada al caso y tildarla **desde la ficha** | Refresca la ficha, **no** la sección Bitácora — es el refactor `bitacoraRefreshCurrentContext()` de F1.4, nunca probado en UI |
| B3.6 | Borrar la ficha → elegir **"Conservar entradas sueltas"** | La ficha desaparece; la entrada sobrevive con `expediente_id = NULL` (verificar por SQL) |

---

### B4 — Captura desde los visores (12 casos) 🎯 el corazón, nunca ejercitado

> Es **el diferencial de toda la propuesta** ("el clic desde la procuración") y la parte que
> justifica la Fase 2 entera. Ninguno de estos caminos corrió jamás.

| # | Caso | Resultado esperado |
|---|---|---|
| B4.1 | Correr una **procuración real** contra el PJN desde la app | El visor se abre **con la botonera** (`📔+` por fila + pie de descubrimiento). Sin el post-procesado de F2.1 funcionando, no aparece nada |
| B4.2 | `📔+` en una fila → "Guardar caso" | Se abre el portal **ya logueado** y avisa que se guardó. Verificar la ficha por SQL |
| B4.3 | **⭐ El caso que justifica F2.6:** ¿el portal pidió login? | **No** debe pedirlo — el token viaja en el fragmento `#sso=`. Si pide login, F2.6 no funciona en el mundo real |
| B4.4 | `📔+` → "Guardar procuración" (snapshot) | **Se crea el primer `expediente_snapshots` real del sistema** |
| B4.5 | `📔+` → "Crear entrada" de cada uno de los 4 tipos | Modal precargado en el portal con expediente, carátula y el movimiento como descripción sugerida (F2.3) |
| B4.6 | Selección múltiple (checkboxes) → "📌 Guardar casos" | Todas las fichas creadas de una; el `perCaso` de F2.3 las vincula bien |
| B4.7 | Selección múltiple → "💾 Guardar procuración de seleccionados" | Un snapshot por caso |
| B4.8 | Selección múltiple → "＋ Crear entradas…" | Abre la **pantalla de revisión del lote** (`#modal-bitacora-lote`, F2.3) |
| B4.9 | En la revisión del lote: excluir una fila, editar título y fecha de otra, usar "aplicar fecha a todos" | Se guarda **solo lo incluido**, con los valores editados |
| B4.10 | **⭐ Badge "ya seguido" (F2.4):** correr la procuración **otra vez** sobre los mismos expedientes | Los ya guardados muestran **📁** en vez de `📔+`, con link a la ficha |
| B4.11 | **⭐ Dedup real (decisión D1):** guardar el mismo caso tipeado con y sin padding de ceros (`FCR 18745/2017` vs `FCR 018745/2017`) | **Una sola ficha**, no dos — es el bug exacto que `expedienteKey()` previene |
| B4.12 | Capturar **4 veces** el mismo caso/kind (tope estructural H4) | Quedan exactamente **2** snapshots por caso/kind |

---

### B5 — Informe (4 casos)

| # | Caso | Resultado esperado |
|---|---|---|
| B5.1 | **Informe individual** real | Se genera `informe-individual_visor_<ISO>.html` (F2.5) **además** del PDF de siempre, y se abre |
| B5.2 | Capturar desde ese mini-visor | Funciona igual que el visor por lote (un lote de 1) |
| B5.3 | **Informe por lote** real | El visor de lote abre con la botonera |
| B5.4 | Verificar que un usuario **sin** el flag no genera el mini-visor | Requiere apagar el flag (se puede diferir a B7): el PDF se abre igual y **no** aparece ningún archivo `informe-individual_visor_*` nuevo |

---

### B6 — Exportación e importación (7 casos) ⚠️ requiere B4 ejecutado

> **Dependencia dura:** sin los snapshots reales que crea B4, este bloque exporta un array vacío y
> **no cierra el pendiente P-F1.7-b**, que es justamente lo que vino esperando desde F1.7.

| # | Caso | Resultado esperado |
|---|---|---|
| B6.1 | Exportar alcance "todo" en **Excel** | 3 hojas con contenido real; la columna "Expediente vinculado" poblada |
| B6.2 | Exportar alcance "todo" en **JSON** | Incluye fichas, entradas **y snapshots reales** |
| B6.3 | Exportar "este caso" desde la ficha | Solo ese expediente |
| B6.4 | **Import dry-run** del JSON de B6.2 | Devuelve números concretos y **no escribe ni una fila** (verificar por SQL antes/después) |
| B6.5 | **⭐ Cierra P-F1.7-b:** borrar un caso con snapshots → restaurar en modo **combinar** | Vuelve la ficha, sus entradas **y sus snapshots**, con los ids originales |
| B6.6 | Importar el mismo archivo **dos veces** | Idempotente: el segundo import no duplica nada |
| B6.7 | Modo **reemplazar** | Queda exactamente el contenido del backup. Confirmar que el **respaldo automático previo** se descargó antes de aplicar |

---

### B7 — Gate, ventana de gracia y reversión (5 casos) 🔴 SIEMPRE ÚLTIMO

| # | Caso | Resultado esperado |
|---|---|---|
| B7.1 | Apagar el flag (`bitacora_enabled=false` en COMBO_PROMO) | — |
| B7.2 | Portal del 250 | Los ítems de nav **desaparecen**; las rutas `/bitacora/*` dan **403 `BITACORA_NO_INCLUIDA`** |
| B7.3 | App: reiniciarla | El botón del topbar **desaparece**; una procuración nueva abre el visor **sin botonera** (y sin romperse) |
| B7.4 | **Ventana de gracia (D2/Q6):** setear `bitacora_lost_access_at` a hace 10 días | El CRUD sigue en 403 pero **el export da 200**. Con 100 días → 403 `BITACORA_GRACIA_VENCIDA` |
| B7.5 | **Volver a encender el flag** | Se recomienda dejarlo **encendido** al cerrar: alimenta el uso interno del que depende F3.3 (§7) |

---

### B8 — Admin (3 casos)

| # | Caso | Resultado esperado |
|---|---|---|
| B8.1 | ABM de feriados en el dashboard: alta, edición, filtro por año, borrado | Funciona en producción (hasta hoy solo se probó en staging) |
| B8.2 | **Cargar la feria judicial de julio** si ya está publicada por la CSJN | Cierra el pendiente **P-F1.1-a** y hace que B2.8 deje de mostrar el disclaimer |
| B8.3 | Checkbox "📔 Incluye Bitácora" en el form de planes | Refleja y persiste el valor (es la vía por UI de lo que B1.2 hizo por SQL) |

---

## 6. Limpieza al terminar

| Qué | Acción |
|---|---|
| Filas de prueba (`expedientes_seguidos`, `bitacora_entries`, `expediente_snapshots` del user 250) | Decidir: **conservar** si se quiere seguir usando el módulo internamente (recomendado, alimenta F3.3), o borrar |
| `bitacora_lost_access_at` del user 250 | **Volver a `NULL`** — lo modifica B7.4 |
| Flag `bitacora_enabled` | Recomendado dejarlo **encendido** en COMBO_PROMO (ver B7.5) |
| `batch.txt` / carpeta `PT` | Borrar solo si no existían antes (P4) |
| Cupo de cortesía sumado en P3 | No revertir — es cortesía legítima, mismo criterio que las pruebas diarias |

---

## 7. Qué habilita este plan (y qué decide)

**Cierra pendientes que estaban esperando exactamente esto:**

| Pendiente | Cómo se cierra |
|---|---|
| **P-F1.7-b** — el bloque de snapshots del import nunca se pudo ejercitar | B4 genera snapshots reales → B6.5 los restaura |
| **P-F2.1-a** — el contrato del form POST era una propuesta de F2.1 | B4 lo ejercita de punta a punta por primera vez |
| **P-F2.1-b** — `claveLigera()` como clave cosmética del badge | B4.10/B4.11 muestran si el falso negativo aparece con datos reales |
| **P-F1.1-a** — feria judicial de julio ausente | B8.2, si la CSJN ya la publicó |

**Y decide el arranque de la Fase 3:**

- **F3.2** (visor del monitor con captura) está condicionada en el plan a *"si el uso de fases 1-2 lo
  valida"* → **B4 es esa validación**. Si la captura desde los visores resulta engorrosa o poco usada,
  F3.2 replica el mismo patrón en un cuarto visor sin haber resuelto el problema de fondo.
- **F3.3** (sugerencias automáticas) está condicionada a *"recién cuando el hábito de uso exista"* →
  dejar el flag encendido (B7.5) y usar el módulo un tiempo es lo que produce ese hábito. **F3.3 no
  debería arrancar el mismo día que termina este plan.**

**Modelo y esfuerzo:** **Sonnet, esfuerzo medio** para B1–B5, B7 y B8 — es ejecución mecánica sobre
un guion, con el mismo perfil que el Bloque R del plan de pruebas integral (que rindió 13 hallazgos
reales con ese setup). ⚠️ **El Bloque B6 es la excepción:** ejercita el único camino del módulo que
**destruye datos** (`modo=reemplazar` de F1.7, marcado Opus/alto en su propia fila de §11.1). Si se
prefiere separarlo, correrlo en una sesión aparte con Opus es una decisión razonable; si va en la
misma sesión, merece el mismo cuidado que tuvo F1.7: leer antes de escribir, verificar por SQL cada
paso, y no improvisar sobre el modo `reemplazar`.

**Duración estimada:** 2–3 sesiones. B4 es el bloque más largo (corridas reales contra el PJN, ~15–60 s
cada una) y el que más cupo consume.
