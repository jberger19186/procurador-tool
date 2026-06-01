# Pendientes Prioritarios — Procurador SCW

> **Última actualización:** 30 de mayo de 2026
> Resumen ejecutivo de lo más importante. La lista completa y detallada está en `CLAUDE.md → Pendientes`.

---

## 🎯 Objetivo actual: lanzar la Beta con usuarios reales

El proyecto está **construido y validado en sandbox**. Lo que separa al producto de la Beta no es desarrollo, sino **activación de servicios externos** y unas pocas correcciones. Estos son los pendientes ordenados por prioridad.

---

## 🔴 Bloque 1 — Imprescindibles para abrir la Beta

| # | Pendiente | Tipo | Esfuerzo | Notas |
|---|---|---|---|---|
| 1 | **Activar MercadoPago producción** | Gestión | Bajo | Crear cuenta real, cargar credenciales en `.env`, reiniciar. *Posponible si la Beta arranca sin cobro real* |
| 2 | **Verificar renovación del certificado SSL** | Técnico | Muy bajo | Vence **2026-06-29**. Verificar con `certbot renew --dry-run` antes del 01/06 |
| 3 | **Firmar digitalmente el instalador (.exe)** | Trámite | Bajo | Azure Trusted Signing. Elimina advertencias de Windows. 1-3 días de gestión |

---

## 🟠 Bloque 2 — Correcciones de seguridad

> Detalle completo en `docs/internal/informe-seguridad.md`.

| # | Pendiente | Estado | Detalle |
|---|---|---|---|
| ~~M-1~~ | ~~Logout de admin no invalida el token~~ | ✅ **Resuelto** (01/06) | Chequeo de blacklist agregado en `routes/admin.js`. Validado E2E en producción |
| ~~M-2~~ | ~~Comparación de firma de pagos no es timing-safe~~ | ✅ **Resuelto** (01/06) | `crypto.timingSafeEqual` en `routes/webhooks.js`. Validado en producción |
| B-1..B-8 | **Mejoras de robustez varias** | 🟡 Pendiente | Validar `JWT_SECRET` al arrancar, activar CSP, subir bcrypt a 12, etc. (ver informe §3) |

---

## 🟡 Bloque 3 — Infraestructura de seguridad operativa (durante la Beta)

> Necesario antes del lanzamiento masivo. Plan completo en `docs/internal/plan-staging-rollback.md`.

| # | Pendiente | Esfuerzo | Detalle |
|---|---|---|---|
| ST-1 | **Montar ambiente de staging** | Medio | Entorno gemelo: puerto 3444, `procurador_db_staging`, subdominio `staging-api`. Configuración de una vez |
| ST-2 | **Definir mecanismo de rollback** | Bajo | Etiquetas Git + scripts de reversión DB + backup automático pre-deploy. Documentado en el plan |
| ST-3 | **Simulacro de rollback** | Bajo | Romper algo a propósito en staging y validar la vuelta atrás. Medio día |
| P-1 | **Escaneo automático de dependencias** | Bajo | `npm audit` periódico, idealmente en CI |

---

## ⚪ Bloque 4 — Diferidos al lanzamiento público (no urgentes)

| # | Pendiente | Detalle |
|---|---|---|
| C1 | **Contrato Facturante** | Facturación automática AFIP. Hoy es manual y funciona (admin sube PDF de ARCA) |
| L1 | **Activar planes BASIC/PRO/ENTERPRISE** | Cuando estén los precios definidos |
| L2 | **Base de conocimiento IA** | Alimentar el asistente con 20-30 tickets reales cerrados |
| L3 | **Actualizar imágenes Chrome Web Store** | Screenshots y banner del listing |
| SEC-1 | **Auditoría de seguridad externa** | Revisión profesional independiente antes de escala masiva |
| D1 | **Permisos por defecto en DB** | Comodidad para futuras migraciones |

---

## 📊 Estado de un vistazo

```
PRODUCTO          ████████████████████ 100%  Construido y publicado
COBRANZA          ████████████████░░░░  90%  Validada en sandbox, falta MercadoPago real
SEGURIDAD         ██████████████████░░  90%  M-1/M-2 resueltos · faltan mejoras B-* + auditoría externa
INFRA. SEGURA     ████████░░░░░░░░░░░░  40%  Falta staging + rollback operativo
LISTO PARA BETA   ████████████████░░░░  ~90% Faltan los 3 imprescindibles del Bloque 1
```

---

## ✅ Recomendación de secuencia

1. ~~M-1 y M-2~~ ✅ **resueltos** (01/06)
2. **Esta semana:** Bloque 1 completo (MercadoPago real + verificar SSL + iniciar trámite de firma)
3. **Arrancar la Beta** con 5-15 usuarios de confianza
4. **Durante la Beta:** montar staging (ST-1/2/3) + activar `npm audit`
5. **Antes del lanzamiento público:** mejoras B-1..B-8 + auditoría externa (SEC-1)

> **Conclusión:** la Beta puede arrancar en **días**, no meses. El núcleo del producto y del cobro está terminado y probado.
