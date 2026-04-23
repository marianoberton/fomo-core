# Data Quality Findings — Track A Migration Audit

**Fecha:** 2026-04-23
**Origen:** Auditoría de prod previa a la migración A1 (drop de `operatingMode`).
**Status:** Documentado para revisión posterior. **No corregido en este PR.**

---

## Finding #1 — Scheduled tasks con nombre humano que no coincide con el agente ejecutor

### Contexto
La auditoría de prod (proyecto `4SqKBrE3GDwfCRsdxVmYC` — FOMO Workforce) detectó 4 scheduled tasks cuyo `name` y `description` mencionan a un agente, pero cuyo `taskPayload.metadata.agentId` apunta a otro agente distinto.

### Detalle

| Scheduled task name | agentId en payload | Agente real (resuelto vía API) | Match? |
|---|---|---|---|
| Valentina - Alertas licitaciones | `cmmcvw36c0009ns01x5g86brc` | **Nadia** (operatingMode=internal, channels=[whatsapp]) | ❌ name dice "Valentina", ejecuta Nadia |
| Mia - Briefing pre-reunión | `cmmcvw4ad000dns01khy35ed5` | **Mia** (operatingMode=internal, channels=[whatsapp]) | ✅ coincide |
| Lucas - Reporte diario de cobranzas | `cmmcvw2k50007ns01bgpcsz9j` | **Mateo** (operatingMode=customer-facing, channels=[whatsapp]) | ❌ name dice "Lucas", ejecuta Mateo |
| Lucas - Detección de facturas vencidas | `cmmcvw2k50007ns01bgpcsz9j` | **Mateo** (operatingMode=customer-facing, channels=[whatsapp]) | ❌ name dice "Lucas", ejecuta Mateo |

### Hipótesis
1. El equipo creó las tasks usando un nombre comercial/humano (Valentina = personaje de licitaciones, Lucas = personaje de cobranzas) y vinculó a los agentes técnicos que ya existían (Nadia, Mateo).
2. O hubo un rename de agentes (Valentina → Nadia, Lucas → Mateo) sin actualizar los nombres de las tasks.
3. O las tasks se importaron/duplicaron desde otro entorno y los agentIds quedaron desincronizados.

### Impacto
- **Operacional**: Las tasks **siguen ejecutándose correctamente** (el cron resuelve por `agentId`, no por `name`). Sin downtime.
- **UX/observabilidad**: confuso para quien lee el dashboard de scheduled tasks — el nombre sugiere un agente que no existe.
- **Auditoría**: dificulta trazar qué agente generó qué corrida cuando se cruza `scheduled_task_runs` con `agent.name`.

### No bloquea la migración A1
Verificado: la migración A1 (drop `operatingMode`, agregar `type`) **no toca scheduled_tasks ni resuelve referencias por nombre**. El `agentId` en `taskPayload.metadata` se mantiene intacto. Estas 4 tasks van a seguir corriendo igual post-migración.

### Acciones propuestas (fuera de este PR)
1. Confirmar con el equipo si Valentina/Lucas son personajes intencionales (en cuyo caso renombrar los agentes Nadia/Mateo a Valentina/Lucas), o si las tasks tienen el nombre incorrecto.
2. Decidido eso:
   - Opción A: `UPDATE scheduled_tasks SET name = 'Nadia - Alertas licitaciones' WHERE id = 'w--WBpLlEP1ZKWOd0hDem';` (etc.)
   - Opción B: `UPDATE agents SET name = 'Valentina' WHERE id = 'cmmcvw36c0009ns01x5g86brc';` + idem para Mateo→Lucas.
3. Backfill auditado y commiteado por separado.

### Datos crudos
```
GET /api/v1/projects/4SqKBrE3GDwfCRsdxVmYC/scheduled-tasks
→ items: [
    { id: w--WBpLlEP1ZKWOd0hDem, name: "Valentina - Alertas licitaciones", agentId: cmmcvw36c0009ns01x5g86brc },
    { id: c8oKNEu0GiG0c_ngnuTZ1, name: "Mia - Briefing pre-reunión", agentId: cmmcvw4ad000dns01khy35ed5 },
    { id: -TbZwCf3ah0GS6xMo5M5o, name: "Lucas - Reporte diario de cobranzas", agentId: cmmcvw2k50007ns01bgpcsz9j },
    { id: 1wKOvYgeUA1s6xD_Kcjn-, name: "Lucas - Detección de facturas vencidas", agentId: cmmcvw2k50007ns01bgpcsz9j },
  ]

GET /api/v1/agents/cmmcvw36c0009ns01x5g86brc → name: "Nadia"
GET /api/v1/agents/cmmcvw4ad000dns01khy35ed5 → name: "Mia"
GET /api/v1/agents/cmmcvw2k50007ns01bgpcsz9j → name: "Mateo"
```
