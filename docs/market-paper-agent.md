# Market Paper — Agente Reactivador de Leads

## Resumen

Agente que recontacta leads fríos de Market Paper (fabricante de papel cartón a medida, B2B) por WhatsApp. Busca deals sin respuesta en HubSpot, envía mensajes personalizados, conversa con contexto del deal, y hace handoff a vendedora cuando hay interés.

## Arquitectura

```
┌──────────────────────────────────────────────────────┐
│           SCHEDULED TASK (cron: 0 9-17 * * 1-5)      │
│           L-V cada hora de 9am a 5pm                  │
│           9 runs/día × 3 msgs = 27 msgs/día máx      │
└────────────────────────┬─────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────┐
│              AGENTE REACTIVADORA                      │
│                                                       │
│  1. search-deals → Seguimiento -14, 3+ días inactivo │
│  2. get-deal-detail → producto, monto, PDF, contacto │
│  3. send-channel-message → WhatsApp vía WAHA         │
│  4. add-deal-note → log en HubSpot                   │
│  5. store-memory → contexto para futuras respuestas  │
└────────────────────────┬─────────────────────────────┘
                         ▼
              LEAD RECIBE WHATSAPP
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
      RESPONDE                   NO RESPONDE
            │                         │
   AgentChannelRouter           3 días después
   → misma agente               → siguiente run
   → conversa con contexto      → 2do intento
   → califica interés           → 3er intento
            │                    → Cierre perdido
     ┌──────┴──────┐
     ▼             ▼
 INTERESADO    NO INTERESA
     │              │
 escalate-to-   update-deal-stage
 human + tarea   → Cierre perdido
 para vendedora  + nota con motivo
```

## Configuración del Agente

| Campo | Valor |
|-------|-------|
| **Nombre** | Reactivadora Market Paper |
| **Modelo** | OpenAI GPT-4o-mini (temperature 0.5) |
| **Modo** | `customer-facing` (whatsapp-waha) |
| **maxTurns** | 50 |
| **Memory** | Long-term enabled, decay 60 días, topK 5 |
| **Budget** | $15/día, $300/mes, $2/run |

### Tools (13)

| Tool | Uso |
|------|-----|
| `mcp:hubspot-crm:search-deals` | Buscar deals fríos por stage + inactividad |
| `mcp:hubspot-crm:search-contacts` | Buscar contacto por teléfono/email |
| `mcp:hubspot-crm:get-deal-detail` | Detalle del deal (producto, monto, PDF) |
| `mcp:hubspot-crm:get-contact-deals` | Deals de un contacto |
| `mcp:hubspot-crm:get-company-detail` | Info de la empresa |
| `mcp:hubspot-crm:update-deal-stage` | Mover a Cierre perdido |
| `mcp:hubspot-crm:add-deal-note` | Loguear cada interacción |
| `mcp:hubspot-crm:create-deal-task` | Tarea para vendedora en handoff |
| `send-channel-message` | Enviar WhatsApp vía WAHA |
| `store-memory` | Persistir contexto del deal |
| `escalate-to-human` | Pasar a vendedora (HITL) |
| `propose-scheduled-task` | Agendar re-contacto futuro |
| `date-time` | Fecha/hora actual |

### Prompt Layers

**Identity:**
- Asistente comercial de Market Paper (papel cartón a medida)
- Español rioplatense, profesional y cercano
- Nunca revela que es IA
- Se presenta como "Market Paper" o con nombre propio

**Instructions — Modo Campaña:**
1. Buscar deals en stage "Seguimiento -14" (3+ días sin actividad)
2. Seleccionar hasta 3 deals (los más antiguos primero)
3. Para cada deal: get-deal-detail → componer mensaje → send WhatsApp → nota HubSpot → store-memory
4. Reglas: máx 3/corrida, no recontactar si hay nota <3 días, skipear sin teléfono

**Instructions — Modo Conversación:**
1. Buscar contexto en memoria (producto, monto, PDF)
2. Responder referenciando el pedido específico
3. Si interesado → escalate-to-human + tarea vendedora
4. Si objeción → recabar info, guardar en memoria + HubSpot
5. Si no interesa → Cierre perdido + nota
6. Si "ahora no" → propose-scheduled-task para re-contacto

**Safety:**
- No descuentos sin vendedora
- No inventar precios/plazos/specs
- No compartir info de otros clientes
- Derivar preguntas técnicas a vendedora

## Tarea Programada

| Campo | Valor |
|-------|-------|
| **Nombre** | Reactivación horaria — Market Paper |
| **Cron** | `0 9-17 * * 1-5` (cada hora, 9am–5pm, L-V) |
| **Runs/día** | 9 (máx 27 msgs/día) |
| **Budget/run** | $2.00 USD |
| **Timeout** | 10 min |
| **maxTurns** | 50 |
| **Mensaje** | "Ejecutar campaña de reactivación. Buscá deals en HubSpot stage Seguimiento -14..." |

## Canal WhatsApp (WAHA)

- **ChannelIntegration** seeded con provider `whatsapp-waha`
- **WAHA** incluido en docker-compose.yml (puerto 3003, engine NOWEB)
- **Webhook** en `/api/v1/channels/whatsapp-waha/{projectId}/webhook`
- **Routing**: `AgentChannelRouter` resuelve "Reactivadora Market Paper" para mensajes whatsapp-waha del proyecto

## HubSpot MCP Server

- **8 tools** expuestas vía MCP stdio
- **`search-deals`** (nuevo): filtra por stage, pipeline, inactiveDays, ownerId
- **Conexión**: lazy per-session via `chat-setup.ts` → `MCPManager`
- **Auth**: `HUBSPOT_ACCESS_TOKEN` resuelto via SecretService en runtime

## Stages HubSpot del Cliente

| Stage | Significado |
|-------|-------------|
| Seguimiento -14 | Presupuesto enviado, <14 días sin actividad — **target de campaña** |
| Seguimiento +14 | >14 días sin actividad |
| Cierre ganado | Deal cerrado exitosamente |
| Cierre perdido | Deal perdido — destino después de 3 intentos sin respuesta |

## Flujo de Handoff

1. Agente detecta interés del lead
2. `add-deal-note` → "Lead interesado en: [resumen]"
3. `create-deal-task` → Tarea para vendedora (hubspot_owner_id del deal), prioridad alta, due hoy
4. `escalate-to-human` → Conversación pausada esperando respuesta humana
5. Vendedora toma control (WhatsApp directo o otro medio)

## Decisiones del Cliente

| # | Decisión | Valor |
|---|----------|-------|
| 1 | Empresa | Market Paper |
| 2 | Stages | Seguimiento +14, Seguimiento -14, Cierre ganado, Cierre perdido |
| 3 | Vendedora | 1, asignada por hubspot_owner_id |
| 4 | Info en deal | amount, productos, contacto, empresa, URL PDF, nota envío |
| 5 | Throttling | 3 msgs/hora, progresivo |
| 6 | Intervalo follow-up | 3 días |
| 7 | Después de 3 intentos | Auto → Cierre perdido |
| 8 | Tono | Rioplatense, profesional, cercano |
| 9 | Presentación | Con nombre ("Soy [Nombre] de Market Paper") |

## Tests

| Archivo | Tests | Cobertura |
|---------|-------|-----------|
| `src/mcp/servers/hubspot-crm/hubspot-crm-server.test.ts` | 40 (11 search-deals) | Schema, API calls, filters, sorting, limits |
| `src/tools/definitions/store-memory.test.ts` | 18 | Schema, metadata, dryRun, execute, error handling |
| `src/tools/definitions/delegate-to-agent.test.ts` | 14 | Schema, dryRun, execute, error cases |
| `src/tools/definitions/list-project-agents.test.ts` | 7 | Schema, dryRun, execute |

## Pendiente (requiere acción del cliente)

- [ ] **HUBSPOT_ACCESS_TOKEN** — Crear Private App en HubSpot y setear via API de Secrets
- [ ] **WAHA** — Escanear QR con el número outbound de WhatsApp
- [ ] **Nombre del agente** — Definir nombre propio ("Soy Laura de Market Paper" vs genérico)
- [ ] **Test E2E** — Trigger manual de tarea → verificar WhatsApp + nota HubSpot
- [ ] **Aprobar tarea programada** — Cambiar status de `proposed` → `active` desde dashboard

## Archivos Clave

| Archivo | Qué hace |
|---------|----------|
| `prisma/seed.ts` | Project, agent, prompt layers, scheduled task, channel integration |
| `src/mcp/servers/hubspot-crm/api-client.ts` | HubSpot API client (8 methods incl. searchDeals) |
| `src/mcp/servers/hubspot-crm/index.ts` | MCP server con 8 tool definitions |
| `src/tools/definitions/store-memory.ts` | Tool para persistir facts a memoria semántica |
| `src/tools/definitions/escalate-to-human.ts` | HITL — pausa conversación para vendedora |
| `src/scheduling/task-executor.ts` | Ejecuta scheduled tasks via agent-runner |
| `src/channels/inbound-processor.ts` | Rutea WhatsApp inbound al agente correcto |
| `src/channels/agent-channel-router.ts` | Resuelve agente por canal + modo |
| `src/api/routes/chat-setup.ts` | Inicializa MCP servers + tools + memory per-session |
| `docker-compose.yml` | PostgreSQL, Redis, WAHA, Nexus app |
