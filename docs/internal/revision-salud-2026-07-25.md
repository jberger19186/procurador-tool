# Revisión de salud del proyecto — 2026-07-25

> Revisión de **estado en vivo** (no una caza de bugs) hecha al cierre de una jornada con
> muchos despliegues: tres revisiones de bugs (B1-B10, C1-C5, D1-D6, 21 hallazgos), el
> release `v2.7.43` de Electron y la subida de la extensión v1.3.6 a revisión de Google.
> Objetivo: confirmar que todo lo desplegado quedó realmente funcionando y que la
> infraestructura está sana.

**Resultado: todo en orden.** Sin regresiones ni incidentes. Un fix aplicado (`axios`), dos
ítems aceptados como pendientes con fundamento.

---

## 1. Verificado en verde

### Infraestructura
| Chequeo | Resultado |
|---|---|
| PM2 | `procurador-api` y `procurador-staging` **online**, 31/38 min de uptime, **sin reinicios espontáneos** tras los deploys (87 MB c/u) |
| Disco | 13% usado (43 GB libres de 49 GB) |
| RAM | 1,3 GB disponibles de 1,9 GB |
| Firewall | `ufw` activo, solo 22/80/443 — el fix **NET-1** sigue vigente |
| SSL | api: vence 2026-08-28 (33 días) · staging: 2026-08-31 (36 días), renovación automática OK |

### Backups
- Diario de las 03:00 **corriendo sin saltos** (verificados 5 días consecutivos: 21→25/07).
- Los backups pre-deploy de la jornada quedaron registrados (6 en total).

### Fixes del día, vivos en producción
| Fix | Verificación |
|---|---|
| **C1** (PDFs de facturas sin auth) | La URL que antes filtraba el PDF completo → **404** |
| **D3** (blacklist en `legal.js`) | `/legal/admin/documents` sin token → **401** |
| **D4** (analytics activado) | `POST /analytics/event` → **200** · `GET /analytics/data` sin auth → **401** |
| Superficies públicas | Landing, portal, dashboard, registro y `plan-availability` → **200** |

### Datos e integridad
- **Cero huérfanos** en las 4 relaciones críticas (suscripciones / pagos / facturas / tickets sin usuario).
- 3 usuarios / 3 suscripciones, todas coherentes, `expires_at` a futuro.
- **Cero errores** en el log desde los deploys — el último registro del `error.log` es del **4 de julio**.
- Crons ejecutándose cada 6 h, con evidencia en los logs.
- **MercadoPago: 0 preapprovals vivos** en cualquier estado (`authorized`/`pending`/`paused`).
- Sin drift de dependencias: todas las declaradas en `package.json` están instaladas.
- Versión **2.7.43** consistente en release (3 assets), landing, portal y `package.json`.

---

## 2. Corregido en esta revisión — `axios` (🟠 alto)

**Situación:** `npm audit` había pasado de 2 vulnerabilidades (documentadas el 2026-07-22 y
no corregidas por estar fuera de alcance) a **6**. Analizadas una por una:

`axios` acumulaba **10 advisories** (prototype pollution, DoS por recursión en
`formDataToJSON`, bypass de `maxBodyLength`, bypass de `NO_PROXY`, entre otros), todos
corregidos en `>=1.18.0`. La versión instalada era 1.16.1 y el rango declarado (`^1.13.4`)
ya admitía la versión parchada.

**Exposición real:** baja — `axios` se usa en **un solo lugar**
(`POST /admin/smoke-tests/run-api`, `routes/admin.js:2851`), un endpoint de admin que
consulta nuestra propia API en `localhost`. Los advisories requieren respuestas controladas
por un atacante. Aun así, el fix era limpio y sin costo, así que se aplicó.

**Cómo se aplicó (y por qué así):** un primer intento con `overrides` en `package.json`
disparó una **re-resolución completa del árbol** que dejó staging con versiones *más viejas*
que producción (lodash 4.18.1→4.17.23, mercadopago 3.2.0→3.0.0, morgan 1.11.0→1.10.1) y
subió el conteo a 14. Se descartó ese camino y se hizo un **cambio quirúrgico**:
`npm install axios@^1.18.1`, que toca únicamente esa dependencia.

**Resultado:** `npm audit --omit=dev` pasó de **6 → 5**, `axios` desapareció de la lista, y
el resto del árbol quedó **idéntico a producción** (verificado paquete por paquete). El
`package-lock.json` cambió solo 4 líneas (la versión de axios).

**Verificación:** staging primero — carga del módulo, `axios.create()` con la misma
configuración del código real, y el endpoint consumidor ejercitado end-to-end
(`POST /admin/smoke-tests/run-api` → **8/8 checks OK**). Luego producción, con backup de DB
y del `package-lock.json` previo (`/tmp/prod_lock_backup_20260725.json`) para rollback
inmediato. Post-deploy: todos los endpoints públicos en 200, cero errores nuevos.

⚠️ **Nota de infraestructura corregida:** el `CLAUDE.md` afirmaba que staging usa
`node_modules` **por symlink** a producción. **Ya no es así** — se verificó que son dos
directorios reales e independientes (`ls -ld` en ambos, y prod conservó sus versiones
mientras staging cambiaba). De haber sido cierto, el `npm install` en staging habría
modificado producción. La nota del CLAUDE.md quedó desactualizada respecto de la realidad
del servidor.

---

## 3. Aceptados como pendientes (con fundamento)

### 3.1 Cadena `@logtail` → `minimatch` → `brace-expansion` (🟠 alto × 4)

**No hay corrección disponible upstream.** Verificado exhaustivamente:
- `npm audit` reporta `fixAvailable: false` para las cuatro entradas.
- `@logtail/node@0.5.8` (la última) sigue dependiendo de `minimatch@^9`, que **también** está
  en el rango vulnerable (`2.0.0 - 10.0.2`) → actualizar Logtail no resuelve nada.
- No existen backports parchados en las líneas legadas: `brace-expansion` 1.x termina en
  **1.1.16** (la que tenemos) y `minimatch` 3.x en **3.1.5** (la que tenemos). El parche solo
  existe en `brace-expansion@5.0.8` / `minimatch@10.2.5`, majors con API incompatible.
- Forzar esos majors por `overrides` rompería a `@logtail`, que espera la API de 3.x/9.x.

**Exposición real: nula en la práctica.** La vulnerabilidad es un DoS por expansión de llaves
sin límite (`{a,b}{c,d}...`) en patrones glob. `@logtail` se usa exclusivamente para enviar
telemetría del servidor a Better Stack (`LOGTAIL_TOKEN` está configurado, el transport está
activo) — **ningún patrón glob proviene de entrada de un atacante**.

**Decisión:** aceptado, a la espera de que upstream publique una versión parchada. Es el
mismo criterio ya aplicado a **DEP-3** (`basic-ftp` crítico vía puppeteer) en la auditoría
SEC-1: *"no se ejercita en runtime"*. **Revisar en la próxima revisión de dependencias.**

### 3.2 `body-parser` (🔵 bajo)

Vulnerable `2.0.0 - 2.2.2` (tenemos 2.2.2), parchado en `>=2.3.0`. Llega como transitiva de
Express. El advisory describe un DoS **cuando se pasa un `limit` inválido** que desactiva
silenciosamente el control de tamaño — el código usa `express.json()` con la configuración
por defecto y **nunca pasa un `limit` propio** (`server.js:103`), así que la condición no se
da. Corregirlo requiere un `overrides`, que ya se comprobó que dispara la re-resolución
completa del árbol (ver §2) — desproporcionado para una severidad baja no explotable.

**Decisión:** aceptado. Se resolverá solo cuando Express actualice su dependencia, o en una
sesión dedicada de actualización de dependencias donde se pueda validar el árbol completo.

### 3.3 Lock de ejecución huérfano

Hay 1 fila en `active_executions` del **2026-07-24 02:03** (usuario 250, script
`procesarNovedadesCompleto.js`), vencida a las 02:11 de ese mismo día — quedó de las pruebas
del Bloque R, cuando una ejecución se interrumpió sin llegar a llamar a `execution/end`.

**No es dañina y se corrige sola:** `routes/license.js:66` ejecuta
`DELETE FROM active_executions WHERE expires_at < NOW()` al inicio de **cada**
`POST /license/execution/start`, y además el upsert atómico del lock solo respeta locks
**vivos** del mismo usuario. Persiste únicamente porque no hubo ninguna ejecución real desde
entonces (producción no tiene usuarios activos todavía). No se tocó: borrar datos de
producción para algo que la propia aplicación limpia en la siguiente ejecución sería un
riesgo innecesario sin beneficio.

---

## 4. Pendiente externo

- **Extensión v1.3.6** — subida al dashboard de Chrome Web Store el 2026-07-25, ⏳ en revisión
  de Google. El store sigue sirviendo 1.3.5 hasta la aprobación.

---

## Conclusión

El sistema está **sano y consistente** tras una jornada de cambios intensos: 21 hallazgos
corregidos en tres revisiones, un release publicado y una actualización de dependencia, sin
un solo error en los logs ni regresiones detectadas. Los tres ítems que quedan abiertos
(`@logtail`, `body-parser`, lock huérfano) están **documentados con su fundamento** y
ninguno representa un riesgo operativo real.
