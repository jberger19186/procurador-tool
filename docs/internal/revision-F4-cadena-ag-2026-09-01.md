# F4 — Copia sanitizada generada y verificada

> Fase **F4** de [`runbook-cadena-ag-triage-2026-09.md`](runbook-cadena-ag-triage-2026-09.md).
> Ejecutada 2026-09-01, Sonnet 5, esfuerzo **bajo**.

---

## 0. Qué se hizo

Corrida de `preparar-copia-auditoria.ps1` (carpeta externa del carril AG) — genera
`repo-auditoria/` al lado del script, con las exclusiones documentadas: `.env*`, `.git`,
`node_modules`, `dist`, `.claude`, `storage/`, `docs/internal/`, `CLAUDE.md` y (decisión D1)
`backend-server/scripts/`.

**No existía copia previa** — confirmado antes de correr el script (se había borrado al cerrar A3,
por diseño). Resultado: **455 archivos, 18,9 MB**.

---

## 1. Verificación — no se confió solo en el reporte del propio script

El script termina con *"OK - copia limpia"*, pero el archivo de instrucciones exige verificación
manual antes de seguir (Paso 0: *"conviene mirarla"*). Se corrieron 6 chequeos independientes:

| # | Chequeo | Resultado |
|---|---|---|
| 1 | `.env*`, `*.pem`, `*.key`, `.git` en todo el árbol | 0 coincidencias |
| 2 | `docs/internal/` (contaminación de criterio para A2 — las hipótesis S1-S11 ya escritas) | No existe en la copia |
| 3 | `CLAUDE.md` (730 KB de historial completo) | No existe en la copia |
| 4 | `backend-server/scripts/` (decisión D1, activo central del producto) | No existe en la copia |
| 5 | `backend-server/keys/` | No existe en la copia |
| 6 | Los **7 targets** de A1+A2 (`markdown/`, `bitacora.js`, `demo/index.html`, los 3 handlers IPC, `capture.js`, `captureDrafts.js`) | Los 7 presentes |

**Chequeo adicional, específico de esta corrida (no genérico):** confirmado que la copia incluye el
fix del token de S11 desplegado en **F3** (`grep "function tokenVencido"` → 1 coincidencia en
`demo/index.html`). Esto importa porque **A2 va a auditar el código YA corregido**, no el estado
anterior que describía el prompt original — consistente con la revalidación de F1.

---

## 2. Lo que este bloque NO hizo

- No instaló ni abrió Antigravity — eso es F5 (PARADA 2), con el operador presente.
- No corrió ningún prompt.
- Solo tocó la carpeta `repo-auditoria/`, fuera de este repo — sin cambios de código de producto.

---

**VEREDICTO F4: OK — copia sanitizada generada, verificada con 6 chequeos independientes del
reporte del propio script, y confirmado que refleja el estado post-deploy de F3 (el fix del token
ya está adentro). Lista para F5.**
