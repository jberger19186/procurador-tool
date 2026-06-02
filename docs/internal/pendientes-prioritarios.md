# Pendientes Prioritarios — Procurador SCW

> **Última actualización:** 02 de junio de 2026
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
| ~~M-1~~ | ~~Logout de admin no invalida el token~~ | ✅ **Resuelto** (01/06) | Chequeo de blacklist en `routes/admin.js`. Validado E2E en producción |
| ~~M-2~~ | ~~Comparación de firma de pagos no es timing-safe~~ | ✅ **Resuelto** (01/06) | `crypto.timingSafeEqual` en `routes/webhooks.js`. Validado en producción |
| ~~B-1, B-3, B-4, B-6, B-8~~ | ~~Grupo seguro de robustez~~ | ✅ **Resueltos** (01/06) | JWT_SECRET validado al arrancar · bcrypt 10→12 · log webhook sin firma · TLS min 1.2 · BOM eliminado. Commit `da1eec6` |
| ~~B-7~~ | ~~IP real tras Cloudflare~~ | ✅ **Verificado** | La API no pasa por Cloudflare; `trust proxy` ya es correcto. Sin cambios |
| ~~B-2~~ | ~~Política de contraseñas~~ | ✅ **Resuelto** (01/06) | Opción A: 8+ chars, letra+número, no común, no = email. Requisitos visibles + mensajes específicos. Commit `548f0e8` |
| ~~B-5~~ | ~~Activar CSP en Helmet~~ | ✅ **Resuelto** (01/06) | CSP activa. Generado en staging → probado (onclick/estilos inline OK, 0 violaciones) → producción. Commit `f034bae` |

---

## 🟡 Bloque 3 — Infraestructura de seguridad operativa (durante la Beta)

> Necesario antes del lanzamiento masivo. Plan completo en `docs/internal/plan-staging-rollback.md`.

| # | Pendiente | Estado | Detalle |
|---|---|---|---|
| ~~ST-1~~ | ~~Montar ambiente de staging~~ | ✅ **Resuelto** (01/06) | Entorno gemelo aislado: `staging-api.procuradortool.com`, puerto 3444, `procurador_db_staging`, código propio. SSL + basic auth |
| ~~ST-2~~ | ~~Definir mecanismo de rollback~~ | ✅ **Resuelto** (01/06) | Scripts `ops/`: `backup-now.sh`, `restore-db.sh` + backups pre-deploy. Rollback de 3 capas documentado |
| ~~ST-3~~ | ~~Simulacro de rollback~~ | ✅ **Resuelto** (01/06) | Drills `ops/drill-rollback.sh` (datos, 3s) y `drill-code-rollback.sh` (código, 5s). Prod intacta. Reutilizables |
| P-1 | **Escaneo automático de dependencias** | 🟡 Pendiente | `npm audit` periódico, idealmente en CI |

> ✅ **Staging y rollback completos y probados.** Entorno gemelo operativo. Estrenado con B-5 (CSP) que recorrió el flujo staging→producción.

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
COBRANZA          ████████████████░░░░  90%  Validada en sandbox, falta MercadoPago real (Bloque 1)
SEGURIDAD         ████████████████████ 100%  M-1/M-2 + B-1..B-8 resueltos · solo queda auditoría externa (opcional)
INFRA. SEGURA     ███████████████████░  95%  Staging + rollback completos y probados · resta solo npm audit (P-1)
LISTO PARA BETA   ██████████████████░░  ~95% Faltan los 3 imprescindibles del Bloque 1
```

---

## ✅ Recomendación de secuencia

1. ~~Toda la seguridad (M-1, M-2, B-1..B-8) + staging y rollback (ST-1/2/3)~~ ✅ **resueltos** (01/06)
2. **Ahora — Bloque 1 (lo único imprescindible para la Beta):** activar MercadoPago real + verificar/renovar SSL + iniciar trámite de firma del `.exe`
3. **Arrancar la Beta** con 5-15 usuarios de confianza
4. **Durante la Beta:** activar `npm audit` (P-1)
5. **Antes del lanzamiento masivo:** auditoría de seguridad externa (SEC-1)

> **Conclusión:** la Beta puede arrancar en **días**. Lo que falta son **3 tareas externas/de gestión** (Bloque 1), no desarrollo. La seguridad y la infraestructura de despliegue seguro están completas.
