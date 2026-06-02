# Flujo de Release y Rollback — App Electron

> **Fecha:** 01 de junio de 2026
> Cómo probar, publicar y revertir versiones de la app de escritorio sin riesgo para los usuarios.

---

## 1. Idea central: las actualizaciones están "bajo control"

La app usa **electron-updater**: un usuario **solo recibe una versión nueva cuando vos publicás un Release en GitHub**. Nada se actualiza solo hasta que vos lo decidís. Eso convierte cada publicación en una compuerta que controlás.

> Conclusión: el "staging" de la app Electron no necesita un servidor aparte — la prueba se hace **localmente en tu máquina** antes de publicar, y la publicación es el gate.

---

## 2. Probar la versión nueva SIN instalarla (ejecución rápida por línea de comando)

No hace falta instalar el `.exe` cada vez. Dos formas, ambas desde la terminal en `electron-app/`:

| Comando | Qué hace | Cuándo usarlo |
|---|---|---|
| `npm start` | Corre la app **directo desde el código fuente** (sin compilar ni instalar) | Iteración rápida: cambiás algo y reabrís en segundos |
| `npm run dev` | Igual pero en modo desarrollo (`--dev`) | Para ver logs/devtools |
| `npm run build:dir` | Compila la app **sin instalador** en `dist/win-unpacked/` | Probar el build real (el .exe empaquetado) sin instalar |

Tras `build:dir`, ejecutás directamente:
```
dist\win-unpacked\Procurador SCW.exe
```

**Probar contra un backend específico** (la app lee `BACKEND_URL`, ver `main.js:70`):
```powershell
$env:BACKEND_URL="https://api.procuradortool.com"   # o el que quieras
npm start
```

---

## 3. Flujo completo: desarrollar → probar → publicar → corregir

```
   1. Desarrollar el cambio en local
            │
            ▼
   2. Probar con `npm start` (fuente) y/o `npm run build:dir` (build real)
            │
       ¿Funciona bien?
        ┌───┴───┐
       NO       SÍ
        │        │
   corregir      ▼
   y volver   3. Subir versión en package.json + commit + git tag
   al paso 2     │
                 ▼
              4. `npm run release`  → compila + publica el Release en GitHub
                 │                     (los usuarios reciben la actualización)
                 ▼
              5. ¿Apareció un bug en producción?
                 ┌──────┴──────┐
                NO             SÍ
                 │              │
              listo        ROLLBACK (sección 5)
```

---

## 4. Archivo de versiones (el "backup" de releases) — ya existe

No hay que construir nada: el archivo de versiones ya es automático y durable.

| Qué se guarda | Dónde | Sirve para |
|---|---|---|
| **Instalador `.exe` de cada versión** | GitHub Releases (offsite, permanente) | Descargar/reinstalar cualquier versión pasada |
| **`latest.yml` de cada versión** | GitHub Releases | Lo que lee el auto-updater |
| **Código fuente de cada versión** | Git tag `vX.Y.Z` (creado al publicar) | Recompilar exactamente una versión pasada |
| Últimos 2 instaladores locales | `electron-app/dist/` (rotación automática) | Conveniencia local |

> Verificado: GitHub conserva los instaladores de v2.7.11, 2.7.12, 2.7.13, 2.7.14… Cada release queda archivada.

**Para traer los tags de versión a tu máquina:** `git fetch --tags`

---

## 5. Rollback de la app Electron

⚠️ El auto-updater **no degrada** versiones por defecto: no podés simplemente "borrar" la versión mala y esperar que los usuarios vuelvan a la anterior (los que ya actualizaron se quedan en la mala).

### Estrategia recomendada: **fix-forward** (revertir hacia adelante)
La forma estándar y confiable de "rollback" en Electron:

```
   Versión mala publicada (ej: v2.7.15 con un bug)
            │
            ▼
   1. Recuperar el código bueno:
      - revertir el commit del bug, O
      - git checkout del tag de la versión buena anterior (v2.7.14)
            │
            ▼
   2. Subir versión a una NUEVA mayor (v2.7.16) que contiene el código bueno
            │
            ▼
   3. `npm run release`  → publica v2.7.16
            │
            ▼
   4. El auto-updater lleva a TODOS los usuarios a v2.7.16 (el código sano)
```

Resultado: en una sola publicación, todos los usuarios quedan en una versión que funciona. Es "rollback" logrado yendo hacia adelante.

### Alternativa parcial: despublicar la versión mala
Si el bug se detecta **rápido** (pocos usuarios actualizaron):
1. Borrar el Release malo en GitHub (o marcarlo como draft).
2. El `latest.yml` de la versión anterior vuelve a ser "el último" → los que aún no actualizaron, no lo reciben.
3. Los que **ya** actualizaron a la versión mala **no** vuelven solos → para ellos hace falta el fix-forward.

> Por eso **fix-forward es siempre la opción segura**: cubre a todos.

---

## 6. Checklist al publicar una versión

1. ☐ Probado con `npm start` y/o `npm run build:dir` (sin instalar)
2. ☐ `version` en `electron-app/package.json` subida
3. ☐ Versión visible actualizada en la landing y el portal (texto `vX.Y.Z`)
4. ☐ Commit + push
5. ☐ `git tag electron-vX.Y.Z` (fija el código de esta versión para rollback) + push del tag
6. ☐ `npm run release` (con `GH_TOKEN` seteado)
7. ☐ Verificar en GitHub que la Release y el `.exe` se publicaron
8. ☐ (Opcional) Instalar en una máquina de prueba y confirmar el auto-update

---

## 7. Resumen — los 4 puntos planteados

| Inquietud | Estado |
|---|---|
| Las actualizaciones no llegan al usuario sin que yo publique | ✅ Así es (release-gated) |
| Probar la nueva versión en local antes de publicar | ✅ `npm start` / `npm run build:dir` |
| Si hay error, generar un nuevo release | ✅ Fix-forward (sección 5) |
| Backup de las versiones enviadas a release | ✅ GitHub Releases (binarios) + git tags (fuente) |
| Ejecución rápida sin reinstalar cada vez | ✅ `npm start` corre desde el código, sin instalar |
