---
name: verify (Procurador SCW — recetario del proyecto)
description: >
  Cómo conducir en runtime el portal de usuarios y el dashboard admin de este
  proyecto sin backend real, y las trampas del entorno de verificación que ya
  costaron un falso negativo. Leer ANTES de arrancar cualquier bloque de
  docs/internal/plan-verificacion-runtime-2026-08-23.md.
---

# Verificar Procurador SCW en runtime

Este documento es el entregable V0 del plan
`docs/internal/plan-verificacion-runtime-2026-08-23.md`. Persiste lo que la
corrida del 2026-08-23 tuvo que descubrir a los golpes, para que los bloques
V1-V7 no vuelvan a pagar ese costo.

## 1. Levantar el andamio

Dos stubs en `backend-server/dev-tools/`, uno por app. Sirven los archivos
**reales** del repo (no una copia) y falsean la API con lo mínimo para que
cada SPA arranque.

```bash
node backend-server/dev-tools/stub-portal.js       # → http://localhost:5188/usuarios/
node backend-server/dev-tools/stub-dashboard.js    # → http://localhost:5189/dashboard/
```

Ambos aceptan un puerto opcional como argumento (`node stub-portal.js 5200`).
Correrlos en paralelo no choca — usan puertos distintos por defecto.

**Qué NO prueban:** el backend real, la DB, los gates por plan, MercadoPago.
Para eso está el bloque V3 del plan (HTTP contra **staging**). Estos stubs son
solo para conducir la UI con un navegador real.

### Portal (`stub-portal.js`)

- Login: cualquier email/password entra (`POST /auth/portal-login` siempre
  200). No hace falta sembrar nada para loguearse.
- `/client/account` devuelve una cuenta fija: `COMBO_PROMO`, activa, con pago,
  `bitacoraEnabled:true`. Editar el objeto `ACCOUNT` en el archivo si un
  bloque necesita otro estado (trial, sin Bitácora, suspendida).
- Catch-all para `/usuarios/api/*`, `/client/*`, `/monitor/*` y `/tickets*`:
  devuelve listas vacías. Si una sección nueva llama a otro prefijo y tira 404
  en la consola, agregarlo a la condición del catch-all (no hace falta un
  `if` por endpoint).

### Dashboard (`stub-dashboard.js`)

- Login: `POST /auth/admin-login` devuelve un **JWT sintácticamente válido**
  (header.payload.firma en base64url, con `role:"admin"` y `exp` a 8h) —
  `dashboard.js` decodifica el payload en el cliente para el auto-restore de
  sesión; sin un JWT bien formado, recargar la página vuelve al login.
- Catch-all para `/admin/*` y `/legal/*` (la sección Legal llama
  `/legal/admin/documents` sin el prefijo `/admin`). Mismo criterio que el
  portal: si algo tira 404, ampliar la condición.

### Sembrar estado en `localStorage`

Ambos stubs no necesitan nada sembrado para loguearse. Para simular estados
específicos (cuentas guardadas del portal, sidebar colapsado, etc.), sembrar
`localStorage` **antes** de navegar a la página (o recargar después de
sembrar):

```js
localStorage.setItem('psc_remembered_users', JSON.stringify([
  { email: 'ana@ejemplo.com', pw: btoa('Secreta123') },
]));
localStorage.setItem('portal_sidebar_collapsed', '1');   // o admin_sidebar_collapsed
```

## 2. Las 5 trampas del entorno — confirmadas empíricamente el 2026-08-23

| # | Trampa | Efecto | Qué hacer |
|---|---|---|---|
| 1 | El Browser pane no compone frames | `computer{action:"screenshot"}` falla siempre ("pane is not displayed") | Usar **Playwright** (`mcp__plugin_playwright_playwright__*`) para cualquier captura |
| 2 | Sin screenshot cacheado, los clicks por coordenada se rechazan | `left_click` con `coordinate` da error | Usar `ref` de `read_page`, o Playwright |
| 3 | `computer{action:"key"}` manda eventos degenerados | Llega `key:""`, `code:""`, `keyCode:0` — **no activa un `<button>`** | **Nunca** probar teclado en el Browser pane. Playwright |
| 4 | Geometría stale tras cambio de clase dinámico | `width`/`margin-left` leídos en el Browser pane siguen con el valor viejo tras un `classList.toggle` | Recargar entre estados, o usar Playwright (ahí `getComputedStyle` se actualiza en vivo sin recargar) |
| 5 | Playwright escribe las capturas en la raíz del repo | `browser_take_screenshot`/`.playwright-mcp/` ensucian el árbol de git | Mover las capturas al scratchpad y `rm -rf .playwright-mcp *.png` al cerrar |

> ⚠️ **La trampa #3 es la más cara, no una molestia menor.** El
> 2026-08-23, un Enter enviado desde el Browser pane sobre un botón "no hizo
> nada" — y por un momento pareció que el bug bajo prueba no existía. Era un
> **falso negativo de la herramienta**: el mismo Enter enviado por Playwright
> reprodujo el bug al instante (`651e58c`, el fix real vino después). Si un
> bloque de verificación prueba cualquier interacción de teclado y usa el
> Browser pane para hacerlo, sus conclusiones son inválidas — hay que rehacer
> esa parte con Playwright antes de reportar nada.

## 3. Patrón de una corrida típica

```
1. node backend-server/dev-tools/stub-portal.js   (o stub-dashboard.js) en background
2. Playwright: browser_navigate al stub
3. Sembrar localStorage si el caso lo necesita (paso 1.4), navegar/recargar
4. Conducir: click / type / press_key / evaluate — SIEMPRE con Playwright
5. Capturar evidencia: browser_evaluate para geometría/estado, 
   browser_take_screenshot para lo visual
6. Repetir contra STAGING o PRODUCCIÓN cuando el bloque lo pida (md5 del
   archivo servido == md5 del archivo verificado, para saber que se probó lo
   que realmente está desplegado)
7. Limpiar: stub detenido, .playwright-mcp/ y *.png borrados del repo,
   localStorage de prueba limpiado si se tocó producción
```

## 4. Regla de despliegue (no específica de verify, pero aplica siempre)

Backup del archivo en el servidor (`/tmp/<archivo>.pre-<lo-que-sea>_<timestamp>`)
→ staging (`scp` + `pm2 restart procurador-staging`) → verificar en staging →
producción (`scp` + `pm2 restart procurador-api`) → verificar md5 servido vs
local → smoke (`/health`, `/usuarios/`, `/dashboard/`, landing) →
`pm2-error.log` sin entradas nuevas. Nunca saltar staging.
