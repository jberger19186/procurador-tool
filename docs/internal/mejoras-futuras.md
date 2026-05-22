# Mejoras futuras — Registro de features diferidas

> Backlog de features que tienen diseño completo pero se postergan a una iteración futura.
> Última actualización: 2026-05-22

---

## 1. Base de Conocimiento (KB) — diferido Fase 4

**Estado:** diseño completo, postergado para cuando haya volumen real de tickets resueltos.

### Concepto
Sistema de aprendizaje compuesto que registra problemas + soluciones de tickets cerrados y los reutiliza para:
- Mejorar las sugerencias del "🤖 Proyectar con IA" (más contexto = respuestas más precisas)
- Sugerir soluciones al admin cuando abre tickets nuevos similares
- Alimentar dinámicamente las FAQs públicas (Electron + portal web)

### Diseño guardado

**Nueva tabla:**
```sql
CREATE TABLE knowledge_base (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  problem_summary TEXT NOT NULL,
  solution_summary TEXT NOT NULL,
  source_ticket_ids INTEGER[],
  tags            TEXT[],
  times_used      INTEGER DEFAULT 0,
  created_by      VARCHAR(20),          -- 'ai' | 'admin'
  created_by_user_id INTEGER,
  is_published    BOOLEAN DEFAULT false,
  is_archived     BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_kb_tags ON knowledge_base USING GIN(tags);
CREATE INDEX idx_kb_published ON knowledge_base(is_published, is_archived);
```

### Flujos

**A. Generación al cerrar ticket:**
```
Admin marca ticket como "Cerrado"
  → Modal: "¿Generar entrada en KB?"
  → Opción 1: 🤖 Con IA → Claude genera problem/solution
  → Opción 2: ✏️ Manual
  → Opción 3: ✕ No, solo cerrar
  → INSERT en knowledge_base con is_published=false (review pendiente)
```

**B. Sugerencias al abrir ticket nuevo:**
```
Admin abre detalle de ticket nuevo
  → Backend busca KB por tags + keywords del título/descripción
  → Panel lateral "Problemas similares encontrados:"
      - "Login PJN falla" → solución resumida + link al ticket origen
      - Click → copia solución al textarea, times_used++
```

**C. Integración con "Proyectar con IA" (Ítem 3 ya existente):**
```
POST /admin/tickets/:id/ai-suggest-reply
  → Antes de llamar a Claude, busca KB por tags
  → Las incluye en el contexto: "Soluciones documentadas similares: ..."
  → Sugerencias más precisas y alineadas con respuestas previas
```

**D. KB pública (a futuro):**
```
Admin marca entrada como is_published=true
  → Aparece en /usuarios/ (sección Ayuda) y en Electron (Asistente IA)
  → Reemplaza al FAQ_ITEMS hardcodeado (dinámico desde DB)
```

### Esfuerzo estimado
- 4a (DB + CRUD básico): 3h
- 4b (Generación al cerrar ticket): 4h
- 4c (Sugerencias al abrir ticket): 3h
- 4d (Integración Proyectar IA): 2h
- 4e (KB → FAQs dinámicas): 4h
- **Total: 1-2 días**

### Cuándo retomar
Tener al menos **20-30 tickets cerrados con soluciones reales** para que la KB inicial tenga densidad útil. Antes de eso, la generación masiva da entradas muy pobres o duplicadas.

---

## 2. Borradores masivos con IA — diferido Fase 4 (Ítem 3.5)

**Estado:** diseño completo, postergado porque requiere KB poblada para ser útil.

### Concepto
Desde la tabla general de tickets, botón "📝 Generar borradores IA" procesa todos los tickets pendientes en batch. Los borradores quedan como `pending` y el admin los revisa uno a uno en una vista dedicada con atajos de teclado (J/K/Enter/E/D).

### Diseño guardado

**Nueva tabla:**
```sql
CREATE TABLE ticket_ai_drafts (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE,
  draft_text      TEXT NOT NULL,
  draft_source    VARCHAR(20),       -- 'batch' | 'individual'
  status          VARCHAR(20),       -- 'pending' | 'sent' | 'edited_and_sent' | 'discarded'
  generated_at    TIMESTAMP DEFAULT NOW(),
  reviewed_at     TIMESTAMP,
  reviewed_by     INTEGER,
  final_text      TEXT,
  edit_distance   INTEGER,
  kb_entries_used INTEGER[]
);
```

### Endpoints
- `POST /admin/tickets/batch-ai-drafts { ticket_ids?: [] }` — genera en paralelo (5 concurrent)
- `GET /admin/tickets/ai-drafts/pending` — lista para revisar
- `POST /admin/tickets/ai-drafts/:id/approve { action, final_text }` — envía o descarta
- `POST /admin/tickets/ai-drafts/:id/regenerate` — vuelve a generar
- `DELETE /admin/tickets/ai-drafts/:id` — descarta

### Vista "Revisar borradores IA"
Split view: lista izquierda + editor derecha. Atajos: J/K (siguiente/anterior), Enter (enviar), E (editar), D (descartar). Permite procesar 30 borradores en 10-15 min.

### Salvaguardas críticas
1. NUNCA auto-envía — siempre requiere acción manual
2. Si usuario agrega comment después de generar draft → marca 'stale' y fuerza regeneración
3. Rate limit: 50 borradores/hora por admin
4. Telemetría `edit_distance`: si > 60% promedio → revisar prompt
5. Logs detallados para auditoría
6. Auto-archive si draft > 7 días sin revisar

### Esfuerzo estimado
- DB + endpoints: 4h
- Vista de revisión: 3h
- Atajos de teclado + UX: 2h
- Tests + telemetría: 2h
- **Total: ~1 día**

### Cuándo retomar
Cuando se cumplan **ambas** condiciones:
1. KB poblada con 30+ entradas (para que los borradores tengan contexto real)
2. Volumen de tickets > 20/día (sin volumen no se justifica el batch)

---

## 3. Mejoras adicionales menores (registradas)

- **Notificaciones email**: opt-out por usuario (checkbox "Recibir emails de respuesta a tickets" en Mi Perfil)
- **Templates de respuesta predefinidos**: snippets reutilizables para casos frecuentes (alternativa rápida a KB para soporte básico)
- **Filtros avanzados en panel admin tickets**: por fecha, por palabra clave, por usuario
- **Exportación de tickets a CSV**: para análisis externo
- **Métricas IA**: dashboard que muestre tasa de aprobación sin edición, tiempo promedio de respuesta, tickets por categoría

---

## Cómo retomar una mejora futura

1. Reactivar este doc al planificar nueva sesión de mejoras
2. Crear tag `pre-mejora-<nombre>` antes de implementar
3. Mover la sección de aquí al CLAUDE.md cuando esté completada
