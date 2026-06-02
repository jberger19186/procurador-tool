# Plan de Staging y Rollback — Procurador SCW

> **Fecha:** 30 de mayo de 2026 · **⚠️ Documento conceptual histórico.**
> **✅ Ya implementado (02/06/2026).** Este es el diseño conceptual original. Para el estado real y el uso, ver:
> - **`flujo-staging-rollback.md`** (visión general) · **`runbook-comandos.md`** (comandos) · **`plan-implementacion-staging.md`** (las 4 fases ejecutadas).
>
> **Objetivo:** poder probar cada mejora en un entorno seguro **antes** de aplicarla en producción, y poder **volver atrás rápidamente** si algo falla.
> **Cubrió los pendientes:** ST-1 (entorno staging), ST-2 (mecanismo de rollback), ST-3 (validación del procedimiento) — todos resueltos.

---

## 1. ¿Por qué necesitamos esto? (en palabras simples)

Hoy, cada cambio se sube **directo a producción** — el servidor que usan los usuarios reales. Si un cambio tiene un error, los usuarios lo sufren de inmediato.

Este plan resuelve dos cosas:

1. **Staging (ambiente de pruebas):** una copia del sistema, idéntica pero separada, donde se prueban los cambios sin que ningún usuario real los vea. Si funciona ahí, recién entonces va a producción.
2. **Rollback (vuelta atrás):** un procedimiento claro y rápido para revertir un cambio que salió mal, en cualquiera de sus tres capas (código, base de datos, proceso).

**Analogía:** es como tener un escenario de ensayo antes del estreno, y un botón de "deshacer" confiable durante la función.

---

## 2. Cómo queda la infraestructura

```
                    Servidor DigitalOcean (142.93.64.94)
   ┌─────────────────────────────────────────────────────────────┐
   │                                                               │
   │   PRODUCCIÓN (usuarios reales)      STAGING (pruebas)          │
   │   ┌───────────────────────┐         ┌───────────────────────┐ │
   │   │ Proceso: procurador-api│        │ Proceso: procurador-staging│
   │   │ Puerto: 3443           │         │ Puerto: 3444          │ │
   │   │ Base: procurador_db    │         │ Base: procurador_db_staging│
   │   │ api.procuradortool.com │         │ staging-api.procuradortool.com│
   │   └───────────────────────┘         └───────────────────────┘ │
   │                                                               │
   └─────────────────────────────────────────────────────────────┘

   Los dos entornos viven en el MISMO servidor pero están aislados:
   distinto proceso, distinta base de datos, distinto subdominio.
```

> **Nota de costo:** no requiere un servidor nuevo. Staging convive con producción en la misma máquina (consume poca memoria adicional). Si más adelante la Beta crece, se puede migrar staging a su propio servidor.

---

## 3. Flujo de trabajo seguro (cómo se aplica un cambio de ahora en más)

```
   1. Desarrollar el cambio en la computadora local
              │
              ▼
   2. Subir a la rama de Git + crear etiqueta de versión
              │
              ▼
   3. Desplegar en STAGING ──────► Probar exhaustivamente
              │                          │
              │                  ¿Funciona bien?
              │                    ┌─────┴─────┐
              │                   SÍ           NO
              │                    │            │
              ▼                    ▼            ▼
   4. Hacer BACKUP de producción   │      Corregir y volver
              │                    │      al paso 3
              ▼                    │
   5. Desplegar en PRODUCCIÓN ◄────┘
              │
              ▼
   6. Verificar (checklist post-deploy)
              │
        ¿Todo OK?
         ┌────┴────┐
        SÍ         NO
         │          │
         ▼          ▼
      Listo     ROLLBACK
                (sección 6)
```

**Regla de oro:** nada llega a producción sin haber pasado por staging primero.

---

## 4. Montaje del ambiente de staging (ST-1) — pasos

> Tareas de una sola vez para dejar staging operativo. Se ejecutan en el servidor.

| Paso | Qué se hace |
|---|---|
| 4.1 | **Crear la base de datos de staging**: copia de la estructura de producción (`procurador_db_staging`), con datos de prueba (no datos reales de clientes) |
| 4.2 | **Crear el archivo de configuración de staging** (`.env.staging`): mismas variables que producción pero apuntando a la base de staging, puerto 3444, y **credenciales de MercadoPago en modo sandbox** (nunca cobra de verdad) |
| 4.3 | **Agregar el proceso staging a PM2** (`ecosystem.config.js`): un segundo proceso llamado `procurador-staging` en el puerto 3444 |
| 4.4 | **Configurar el subdominio en Nginx**: `staging-api.procuradortool.com` apuntando al puerto 3444, con su propio certificado SSL |
| 4.5 | **Restringir el acceso a staging**: protegerlo con usuario/contraseña a nivel servidor (Nginx) para que solo el equipo pueda entrar |

**Resultado:** un entorno gemelo, accesible solo por el equipo, que nunca toca datos reales ni cobra dinero real.

---

## 5. Mecanismo de Rollback (ST-2) — las tres capas

Un cambio puede romperse en tres niveles. Cada uno tiene su forma de revertir.

### Capa A — Código (la aplicación)
**Herramienta:** etiquetas de Git + PM2.

Cada despliegue a producción se marca con una **etiqueta de versión** (ej: `prod-2026-05-30`). Si algo falla:

```
1. Volver el código a la última etiqueta estable
2. Reiniciar el proceso
3. El sistema vuelve exactamente al estado anterior
```

> **Tiempo estimado de rollback de código: 2-3 minutos.**

### Capa B — Base de datos (los datos)
**Herramienta:** backup previo + scripts de reversión.

**Antes de cada despliegue** se hace una copia de seguridad automática de la base. Si un cambio en la base sale mal:

- **Cambios menores** (agregar una columna, etc.): se revierten con un script de "deshacer" preparado de antemano (`XXX_rollback.sql`).
- **Cambios mayores o corrupción**: se restaura el backup completo previo al despliegue.

> **Regla:** toda modificación de base de datos debe tener su script de reversión escrito **antes** de aplicarse.

### Capa C — Proceso (el servidor corriendo)
**Herramienta:** PM2.

PM2 guarda las versiones anteriores del proceso. Si el servidor queda inestable tras un reinicio:

```
1. pm2 restart procurador-api    (reinicio simple)
2. Si persiste: volver a la versión de código estable (Capa A) y reiniciar
```

PM2 además **reinicia automáticamente** el proceso si se cae, y lo limita en memoria (400 MB) para evitar que consuma todo el servidor.

---

## 6. Procedimiento de Rollback paso a paso (qué hacer cuando algo falla en producción)

```
   🚨 Se detecta una falla en producción tras un despliegue
              │
              ▼
   PASO 1 — Evaluar gravedad (¿afecta a los usuarios?)
              │
        ┌─────┴─────┐
      Grave       Menor
        │            │
        ▼            ▼
   ROLLBACK     ¿Se puede arreglar
   inmediato     con un parche rápido?
        │          ┌──┴──┐
        │         SÍ     NO
        │          │      │
        │          ▼      ▼
        │       Parchear  ROLLBACK
        │       y verificar
        ▼
   PASO 2 — Identificar la capa afectada
        │
        ├── ¿Código? ────► Volver a etiqueta estable + reiniciar (Capa A)
        ├── ¿Datos?  ────► Script de reversión o restaurar backup (Capa B)
        └── ¿Proceso?────► Reiniciar / volver versión estable (Capa C)
        │
        ▼
   PASO 3 — Verificar que el sistema volvió a la normalidad
        │   (checklist post-deploy de la sección 7)
        ▼
   PASO 4 — Registrar qué pasó (para no repetirlo)
```

**Principio clave:** ante la duda, **revertir primero, investigar después**. Es preferible volver a un estado que funcionaba y analizar con calma, que dejar a los usuarios con un sistema roto mientras se busca la causa.

---

## 7. Checklist de validación post-despliegue

> Verificar estos puntos después de **cada** despliegue a producción. Si alguno falla → considerar rollback.

| ✓ | Verificación |
|---|---|
| ☐ | El servidor responde (health check OK) |
| ☐ | Se puede iniciar sesión (usuario de prueba) |
| ☐ | El panel de administración carga |
| ☐ | El portal de usuario carga |
| ☐ | Una operación clave funciona (ej: ver expedientes / consultar cuenta) |
| ☐ | Los registros del servidor no muestran errores nuevos |
| ☐ | (Si tocó pagos) El flujo de cobro responde en sandbox |
| ☐ | El certificado de seguridad sigue válido |

---

## 8. Validación del procedimiento (ST-3) — el "simulacro"

Antes de confiar en este plan, hay que **probarlo en staging** con un simulacro controlado:

1. Aplicar un cambio **intencionalmente roto** en staging
2. Ejecutar el procedimiento de rollback completo (las tres capas)
3. Confirmar que el sistema vuelve al estado anterior correctamente
4. Cronometrar cuánto tardó cada tipo de rollback
5. Ajustar el procedimiento según lo aprendido

> Solo después de un simulacro exitoso se considera el procedimiento "aprobado" para usar en producción.

---

## 9. Resumen de beneficios para presentar

| Antes (situación actual) | Después (con este plan) |
|---|---|
| Los cambios van directo a producción | Se prueban en staging primero |
| Un error afecta a usuarios reales de inmediato | Los errores se detectan antes, sin impacto real |
| No hay forma rápida y definida de volver atrás | Rollback en minutos, procedimiento claro |
| Los cambios de base de datos son riesgosos | Backup automático + scripts de reversión |
| Las pruebas de pago usan el sistema real | Staging usa MercadoPago en modo prueba (nunca cobra) |

---

## 10. Esfuerzo y orden sugerido

| Fase | Tarea | Esfuerzo |
|---|---|---|
| 1 | Montar staging (sección 4) | Medio — configuración de una vez |
| 2 | Definir etiquetas Git + scripts de reversión + backup automático (sección 5) | Bajo |
| 3 | Documentar el procedimiento de rollback para el equipo (secciones 6-7) | Bajo — ya está en este documento |
| 4 | Simulacro de validación (sección 8) | Bajo — medio día |

> **Recomendación:** completar este plan **durante la Beta** (no es bloqueante para iniciarla con pocos usuarios), y tenerlo **obligatoriamente operativo antes del lanzamiento público**, cuando el costo de una falla es mucho mayor.

---

*Plan basado en la infraestructura real al 30/05/2026 (servidor DigitalOcean, PM2, PostgreSQL, Nginx). Para la implementación técnica detallada, coordinar con el equipo de desarrollo.*
