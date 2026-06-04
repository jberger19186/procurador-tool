# Procurador SCW — Ciclo de vida del usuario

> Diagrama profesional del recorrido completo del usuario desde el registro hasta la operación recurrente.
> Última actualización: 2026-05-30

---

## 🎯 Camino principal (happy path)

```mermaid
flowchart TD
    A([🌐 Usuario visita<br/>procuradortool.com]) --> B[📝 Completa formulario<br/>de registro]
    B --> C[📧 Recibe email<br/>de verificación]
    C --> D{Verifica<br/>email?}
    D -- Sí --> E[⏳ Trial: <b>20 usos</b><br/>app + extensión<br/>hasta configurar el pago]
    D -- No --> X1[❌ Cuenta sin verificar<br/>no puede operar]

    E --> F{Admin<br/>aprueba?}
    F -- Sí --> G[✅ Cuenta aprobada<br/>sigue con el trial de 20 usos]
    F -- No --> X2[❌ Cuenta rechazada]

    G --> H[💳 Usuario configura<br/>método de pago<br/>en MercadoPago]
    H --> I[💰 Pago configurado / cobro aprobado]
    I --> J[🧹 Se asignan límites del plan<br/>contador a 0 · se elimina el trial]

    J --> K[🚀 Operación normal:<br/>procuración · informes · monitor]
    K --> L[🔄 Renovación automática<br/>mes a mes]
    L --> K

    %% ── Estilos ─────────────────────────────────────────────────────────
    classDef inicio  fill:#1e3a5f,stroke:#0c2547,color:#fff,stroke-width:2px
    classDef accion  fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px
    classDef sistema fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
    classDef admin   fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:2px
    classDef ok      fill:#d1fae5,stroke:#059669,color:#064e3b,stroke-width:2px
    classDef error   fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
    classDef decision fill:#fff,stroke:#6b7280,color:#1f2937,stroke-width:2px

    class A inicio
    class B,C,H accion
    class D,F decision
    class E,I,J,L sistema
    class G,K ok
    class X1,X2 error
```

---

## ⚠️ Caminos alternativos (situaciones especiales)

```mermaid
flowchart LR
    A[✅ Cuenta activa<br/>con suscripción] --> B{Evento}

    B -- Usuario<br/>cancela --> C1[📅 Cancelación programada<br/>al fin del período pago]
    C1 --> C2[Acceso continúa hasta<br/>fin del período]
    C2 --> C3[🔒 Cuenta cancelada]
    C1 -. Usuario<br/>reactiva .-> A

    B -- Pago<br/>rechazado --> D1[⏰ 3 días de gracia<br/>MP reintenta cada 6h]
    D1 -- Pago<br/>recuperado --> A
    D1 -- Sin pago --> D2[🚫 Suspendida por pago]
    D2 -- Usuario actualiza<br/>método de pago --> A

    B -- Plan vence --> E1[⏳ Suspendida por<br/>vencimiento de plan]
    E1 -- Renueva plan --> A

    B -- Admin<br/>suspende --> F1[⛔ Suspendida<br/>por administrador]
    F1 -- Admin revisa<br/>y reactiva --> A

    classDef ok      fill:#d1fae5,stroke:#059669,color:#064e3b,stroke-width:2px
    classDef warning fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px
    classDef error   fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
    classDef decision fill:#fff,stroke:#6b7280,color:#1f2937,stroke-width:2px

    class A ok
    class B decision
    class C1,D1,E1 warning
    class C2 ok
    class C3,D2,F1 error
    class F1 error
```

---

## 📊 Resumen de estados de la cuenta

| Estado | Significado | Acceso al servicio |
|---|---|:---:|
| 📧 **Pendiente verificación** | Usuario se registró pero no clickeó el email | ❌ |
| ⏳ **Pendiente activación / trial** | Email verificado · 20 usos de prueba compartidos por app + extensión, hasta configurar el pago | ✅ (limitado) |
| ✅ **Activa** | Suscripción al día, cobro automático funcionando | ✅ |
| 📅 **Cancelación programada** | El usuario canceló, sigue con acceso hasta fin del período | ✅ (hasta fecha) |
| ⏰ **En período de gracia** | Pago rechazado, MP reintenta 3 días | ✅ |
| 🚫 **Suspendida por pago** | Pago no recuperado en 3 días | ❌ |
| ⏳ **Plan vencido** | Plan caducó | ❌ |
| ⛔ **Suspendida por admin** | Decisión administrativa | ❌ |
| 🔒 **Cancelada** | Período de la cancelación venció | ❌ |
| ❌ **Rechazada** | Trial agotado o rechazo administrativo | ❌ |

---

## 💡 Puntos clave para presentar

1. **Activación manual por admin** — control humano antes de habilitar la cuenta (filtro anti-fraude / cumplimiento)
2. **20 usos de prueba compartidos** (app Electron + extensión de Chrome) hasta configurar el pago — el usuario evalúa el producto completo antes de pagar; al agotar los 20, ambas se bloquean
3. **Al configurar el pago** — se asignan los límites del plan y el contador arranca limpio (se elimina el trial)
4. **Cobro automático mensual** vía MercadoPago — sin intervención manual
5. **Gracia de 3 días** ante pago rechazado — evita perder clientes por errores transitorios
6. **Cancelación amigable** — el usuario puede cancelar y reactivar antes del fin del período
7. **Identificación robusta** — funciona aunque el usuario tenga distinto email en el portal y en MercadoPago

---

## 🖼️ Cómo exportar a imagen para presentación

**Opción 1 — Online (más rápido):**
1. Abrir https://mermaid.live
2. Copiar el código del diagrama (entre los ```mermaid)
3. Click "Actions" → "PNG" o "SVG"

**Opción 2 — GitHub:**
Este archivo se renderiza automáticamente al verlo en GitHub. Captura de pantalla → listo.

**Opción 3 — Notion / Slack:**
Pegar el código Mermaid en un bloque de código tipo `mermaid` y se renderiza automáticamente.

**Opción 4 — VS Code:**
Instalar la extensión "Markdown Preview Mermaid Support" → preview del .md → captura.

---

## 📄 Generar PDF (con los dos diagramas + tabla)

Hay un generador listo que renderiza los diagramas Mermaid y produce
`docs/diagrama-flujo-usuario.pdf` (A4 horizontal, una sección por página):

```powershell
node docs/gen-diagrama-pdf.js
```

- Usa el Chrome del sistema vía puppeteer (de `electron-app`).
- La primera vez descarga `_mermaid.min.js` automáticamente (queda cacheado, está en `.gitignore`).
- Si editás los diagramas de arriba, actualizá también el código embebido en `gen-diagrama-pdf.js` y volvé a correrlo.
