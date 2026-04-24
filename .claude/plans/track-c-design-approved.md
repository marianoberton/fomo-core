# Track C — Diseño aprobado (AgentTemplate + Campaigns enrichment)

**Branch**: `feature/track-c-templates-campaigns`
**Worktree**: `C:/Users/Mariano/Documents/fomo-core-track-c`
**Estado**: Diseño aprobado. NO ejecutar hasta que Track A mergee su migración a `main`.

---

## Scope de Track C

**Archivos a crear / modificar (exclusivo de Track C):**
- `src/api/routes/agent-templates.ts` (NUEVO)
- `src/api/routes/agents.ts` (MODIFICAR — agregar endpoint `from-template`)
- `src/api/routes/campaigns.ts` (MODIFICAR)
- `src/campaigns/campaign-runner.ts` (MODIFICAR)
- `src/campaigns/types.ts` (MODIFICAR — `AudienceSource`)
- `src/infrastructure/repositories/agent-template-repository.ts` (NUEVO)
- Sección nueva en `prisma/seed.ts` (5 templates oficiales)

**Prohibido tocar:**
- `prisma/schema.prisma` directamente (Track A lo toca)
- Track B (dashboard)
- `src/api/routes/campaign-templates.ts` (Track 4, ya mergeado — parallel, no reemplazar)

---

## Dependencias bloqueantes con Track A

Track A debe entregar primero (migración única, sin período deprecated):

1. Enum `AgentType { conversational, process, backoffice }` en `schema.prisma`.
2. Columna `type AgentType` en `Agent` (backfill desde `operatingMode` legacy).
3. Drop de `operatingMode` en `Agent` + refactor de los 8 archivos que lo referencian.
4. FK `agentId String` (required, `onDelete: Restrict`) en `Campaign`.
5. FK `scheduledTaskId String?` (optional, `@unique`, `onDelete: SetNull`) en `Campaign`.
6. Columna `audienceSource Json?` en `Campaign`.
7. Columna `audienceCache Json?` en `Campaign`.
8. FK `agentId String?` en `CampaignSend` (trazabilidad histórica de qué agente envió cada mensaje).
9. Relaciones inversas:
   - `Agent { campaigns Campaign[] @relation("CampaignAgent") }`
   - `Agent { campaignSends CampaignSend[] @relation("CampaignSendAgent") }`
   - `ScheduledTask { campaign Campaign? @relation("CampaignScheduledTask") }`
10. Model `AgentTemplate` tal como se detalla en la Sección a) abajo.
11. Prisma client regenerado (`pnpm db:generate`) incluido en el commit de Track A.

Coordinación: recibir ping de Track A → `git fetch && git merge main` en este worktree → empezar a codear.

---

## a) Schema Prisma — `AgentTemplate`

Global (sin `projectId`). Catálogo de arquetipos reutilizables.

```prisma
// ─── Agent Types (enum) ─────────────────────────────────────────

enum AgentType {
  conversational   // Customer-facing sync chat (WhatsApp/Telegram/Slack/Web)
  process          // Outbound / batch / scheduled (campañas, scrapers)
  backoffice       // Internal-only (copilot owner, manager, admin)
}

// ─── Agent Templates (global catalog) ───────────────────────────

model AgentTemplate {
  id                  String    @id @default(cuid())

  // Identity
  slug                String    @unique                        // "customer-support"
  name                String                                   // "Atención al Cliente"
  description         String
  type                AgentType
  icon                String?                                  // shadcn icon name
  tags                String[]                                 // ["support","conversational"]
  isOfficial          Boolean   @default(true)

  // Agent defaults (materialized by POST /projects/:id/agents/from-template)
  // NAMING: sin prefijo "default". Campos "suggested*" o tal cual.
  promptConfig        Json                                     // { identity, instructions, safety }
  suggestedTools      String[]  @map("suggested_tools")
  suggestedLlm        Json?     @map("suggested_llm")          // { provider, model, temperature }
  suggestedModes      Json?     @map("suggested_modes")        // AgentMode[]
  suggestedChannels   String[]  @map("suggested_channels")     // ["whatsapp","telegram"] (flatten)
  suggestedMcps       Json?     @map("suggested_mcps")         // [{ name, templateSlug }]
  suggestedSkillSlugs String[]  @map("suggested_skill_slugs")
  metadata            Json?                                    // { archetype, ... }

  // Limits
  maxTurns            Int       @default(10)  @map("max_turns")
  maxTokensPerTurn    Int       @default(4000) @map("max_tokens_per_turn")
  budgetPerDayUsd     Float     @default(10.0) @map("budget_per_day_usd")

  // Versioning (soft — no mutación in-place; regla del proyecto)
  version             Int       @default(1)

  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt      @map("updated_at")

  @@index([type])
  @@index([isOfficial])
  @@map("agent_templates")
}
```

**Notas:**
- Catálogo global (no `projectId`). Fomo publica oficiales; clientes los instancian.
- No almacena prompt layers concretos: se crean por `projectId` al instanciar (via helper reusable).
- `type` usa el enum `AgentType` de Track A. Bloqueante para migration/endpoints.

---

## b) 5 seed AgentTemplates

Sección nueva en `prisma/seed.ts`, antes del seed de projects/agents. `createMany({ skipDuplicates: true })` con `slug` unique como idempotency guard.

### b1. `customer-support` (conversational)

```ts
{
  slug: 'customer-support',
  name: 'Atención al Cliente',
  description: 'Responde consultas de clientes vía WhatsApp/Telegram/Slack. Escala a humano cuando no sabe.',
  type: 'conversational',
  icon: 'MessageSquare',
  tags: ['support','conversational','whatsapp','telegram'],
  promptConfig: {
    identity: 'Sos un asistente de atención al cliente. Sos empático, claro y conciso. Hablás en el idioma del cliente.',
    instructions: `1. Saludá cordialmente en la primera interacción.
2. Entendé el problema del cliente antes de responder.
3. Si la pregunta es sobre productos/servicios, usá knowledge-search.
4. Si no tenés la respuesta con confianza, escalá con escalate-to-human.
5. Cerrá la conversación confirmando que el problema fue resuelto.`,
    safety: `- Nunca inventes datos (precios, stock, políticas).
- Nunca reveles información de otros clientes.
- Nunca prometas plazos o descuentos sin confirmación humana.
- Si detectás frustración alta, escalá inmediatamente.`,
  },
  suggestedTools: [
    'knowledge-search','store-memory','send-notification',
    'escalate-to-human','date-time','query-sessions','read-session-history',
  ],
  suggestedLlm: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4 },
  suggestedChannels: ['whatsapp','telegram'],
  suggestedModes: [],
  suggestedSkillSlugs: [],
  maxTurns: 15, maxTokensPerTurn: 4000, budgetPerDayUsd: 10.0,
  metadata: { archetype: 'customer-support' },
},
```

### b2. `outbound-campaign` (process)

```ts
{
  slug: 'outbound-campaign',
  name: 'Campañas Outbound',
  description: 'Envía mensajes de reactivación / prospección a una audiencia filtrada. Maneja replies y escala convertidos.',
  type: 'process',
  icon: 'Send',
  tags: ['outbound','campaign','whatsapp','reactivation'],
  promptConfig: {
    identity: 'Sos un agente de campañas outbound. Tu objetivo es calentar leads fríos y derivarlos a un humano cuando muestran interés.',
    instructions: `1. Personalizá el mensaje inicial con los datos del contacto.
2. Si el lead responde, hacé UNA pregunta corta para calificarlo.
3. Si muestra interés (respuesta positiva, pregunta de precio, pedido de demo), ejecutá escalate-to-human.
4. Si no responde en 48h, dejalo estar. No insistas.`,
    safety: `- Respetá las opt-outs: si el contacto pide no ser contactado, actualizá tags con "opted_out" y detené el envío.
- No inventes urgencia artificial.
- No repitas el mensaje si ya fue enviado (usá read-session-history).`,
  },
  suggestedTools: [
    'contact-score','store-memory','send-notification',
    'escalate-to-human','read-session-history','date-time',
  ],
  suggestedLlm: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.5 },
  suggestedChannels: ['whatsapp'],
  suggestedModes: [],
  suggestedSkillSlugs: [],
  maxTurns: 8, maxTokensPerTurn: 3000, budgetPerDayUsd: 15.0,
  metadata: { archetype: 'outbound-campaign', supportedChannels: ['whatsapp'] },
},
```

### b3. `copilot-owner` (backoffice)

```ts
{
  slug: 'copilot-owner',
  name: 'Copilot del Dueño',
  description: 'Chief of Staff del dueño. Reporta estado del negocio, ejecuta comandos, configura alertas. Acceso vía dashboard y WhatsApp.',
  type: 'backoffice',
  icon: 'Briefcase',
  tags: ['copilot','owner','backoffice','internal'],
  promptConfig: {
    identity: 'Sos el Chief of Staff del dueño del negocio. Trabajás directamente para él, no para los clientes.',
    instructions: `1. Reportá estado operativo cuando te lo pidan (get-operations-summary).
2. Alertá proactivamente ante anomalías (costos, errores, escalaciones).
3. Ejecutá comandos del dueño sobre los demás agentes (control-agent).
4. Nunca inventes métricas — siempre usá herramientas.
5. Compará con días anteriores usando memoria.`,
    safety: `- Nunca reveles credenciales ni configuración interna.
- Nunca compartas datos de clientes con terceros.
- No bypasses approvals.
- Si detectás costos fuera de control, alertá inmediatamente.`,
  },
  suggestedTools: [
    'get-operations-summary','get-agent-performance','review-agent-activity',
    'query-sessions','list-project-agents','send-notification',
    'propose-scheduled-task','store-memory','knowledge-search','date-time',
  ],
  suggestedLlm: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.2 },
  suggestedChannels: ['dashboard','whatsapp'],
  suggestedModes: [
    {
      name: 'copilot', label: 'Copilot',
      channelMapping: ['dashboard','whatsapp'],
      promptOverrides: { /* clon de promptConfig */ },
      toolAllowlist: [/* clon de suggestedTools */],
    },
  ],
  suggestedSkillSlugs: ['fomo-manager'],
  maxTurns: 25, maxTokensPerTurn: 8000, budgetPerDayUsd: 20.0,
  metadata: { archetype: 'copilot-owner' },
},
```

### b4. `manager-delegator` (backoffice)

```ts
{
  slug: 'manager-delegator',
  name: 'Manager Delegador',
  description: 'Coordina sub-agentes. Recibe requests complejos y delega al agente especialista correcto.',
  type: 'backoffice',
  icon: 'Users',
  tags: ['manager','delegation','backoffice','orchestrator'],
  promptConfig: {
    identity: 'Sos el manager de un equipo de agentes especializados. Tu función es enrutar cada pedido al agente correcto.',
    instructions: `1. Listá los agentes disponibles del proyecto (list-project-agents).
2. Clasificá el pedido y decidí qué agente debe responder.
3. Delegá con delegate-to-agent pasando contexto claro.
4. Si la respuesta requiere varios agentes, coordiná secuencialmente.
5. Consolidá y devolvé una respuesta unificada al usuario.`,
    safety: `- Nunca intentes responder vos mismo tareas que son de otro agente.
- No delegues tareas con credenciales o PII sensible a agentes sin permiso para manejarlos.
- Si ningún agente es adecuado, escalá.`,
  },
  suggestedTools: [
    'list-project-agents','delegate-to-agent','review-agent-activity',
    'escalate-to-human','store-memory','date-time',
  ],
  suggestedLlm: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.3 },
  suggestedChannels: ['dashboard'],
  suggestedModes: [],
  suggestedSkillSlugs: [],
  maxTurns: 20, maxTokensPerTurn: 6000, budgetPerDayUsd: 15.0,
  metadata: { archetype: 'manager-delegator' },
},
```

### b5. `knowledge-bot` (conversational)

```ts
{
  slug: 'knowledge-bot',
  name: 'Bot de Conocimiento',
  description: 'Responde preguntas basándose exclusivamente en la knowledge base del proyecto. No improvisa.',
  type: 'conversational',
  icon: 'BookOpen',
  tags: ['knowledge','faq','conversational','rag'],
  promptConfig: {
    identity: 'Sos un asistente que responde preguntas basándose exclusivamente en la base de conocimiento provista.',
    instructions: `1. Para TODA pregunta, primero ejecutá knowledge-search.
2. Si hay resultados relevantes (score > 0.7), respondé citando las fuentes.
3. Si NO hay resultados relevantes, decí "No tengo esa información en mi base de conocimiento" y ofrecé escalar.
4. Nunca completes con conocimiento general del LLM — solo con lo que hay en la KB.
5. Citá los archivos fuente entre paréntesis al final de cada afirmación.`,
    safety: `- Nunca inventes datos que no estén en la KB.
- Si la pregunta es sobre precios/stock/personal/contrato, usá la KB o escalá — nunca respondas de memoria.
- Marcá tu nivel de confianza en la respuesta.`,
  },
  suggestedTools: [
    'knowledge-search','read-file','store-memory',
    'escalate-to-human','date-time',
  ],
  suggestedLlm: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1 },
  suggestedChannels: ['whatsapp','telegram','slack'],
  suggestedModes: [],
  suggestedSkillSlugs: [],
  maxTurns: 10, maxTokensPerTurn: 5000, budgetPerDayUsd: 8.0,
  metadata: { archetype: 'knowledge-bot' },
},
```

---

## c) Endpoints `/agent-templates` — CRUD

**Archivo**: `src/api/routes/agent-templates.ts` (NUEVO).
**Registro**: bajo `/api/v1` en `src/api/index.ts` (sin `/projects/:projectId` — catálogo global).

**En esta iteración**: solo **GET**. Los `POST/PUT/DELETE` quedan como stub 501 con `TODO(v2)` para templates non-official.

```ts
const agentTypeEnum = z.enum(['conversational','process','backoffice']);

const listQuery = z.object({
  type: agentTypeEnum.optional(),
  tag: z.string().optional(),
  q: z.string().max(100).optional(),          // search in name/description/slug
  isOfficial: z.coerce.boolean().optional(),
});

// Rutas MVP
GET  /api/v1/agent-templates              → { items: AgentTemplate[], total }
GET  /api/v1/agent-templates/:slug        → AgentTemplate  (404 si no existe)

// v2 (stub 501 por ahora)
POST   /api/v1/agent-templates            → create custom (non-official)
PUT    /api/v1/agent-templates/:slug      → update (only !isOfficial)
DELETE /api/v1/agent-templates/:slug      → delete (only !isOfficial)
```

- Orden: `isOfficial DESC, type ASC, name ASC`.
- Sin paginación (≤20 items).
- Export: `agentTemplateRoutes` (distinto de `campaignTemplateRoutes`).
- DI: usa `prisma` y `logger` del `RouteDependencies`. No agrega deps nuevas.

**Repository**: `src/infrastructure/repositories/agent-template-repository.ts`
- `findAll(filter)`, `findBySlug(slug)`, `createCustom(...)`, `updateIfCustom(...)`, `deleteIfCustom(...)`.
- Guard en update/delete: `isOfficial === false`.

---

## d) Endpoint `from-template` — VIVE EN `agents.ts`

`POST /projects/:projectId/agents/from-template`

**Archivo**: `src/api/routes/agents.ts` (modificar — agregar este handler). Cohesión: crea un `Agent`, pertenece a agents.

```ts
const fromTemplateSchema = z.object({
  templateSlug: z.string().min(1).max(100),
  name: z.string().min(1).max(100),                   // nombre del agente nuevo (unique por project)

  overrides: z.object({
    description: z.string().max(500).optional(),
    promptConfig: z.object({
      identity: z.string().min(1).optional(),
      instructions: z.string().min(1).optional(),
      safety: z.string().min(1).optional(),
    }).optional(),
    llmConfig: z.object({
      provider: z.enum(['anthropic','openai','google','openrouter','ollama']),
      model: z.string().min(1),
      temperature: z.number().min(0).max(2).optional(),
    }).optional(),
    toolAllowlist: z.array(z.string()).optional(),
    channelConfig: z.object({ channels: z.array(z.string()) }).optional(),
    maxTurns: z.number().int().min(1).max(100).optional(),
    maxTokensPerTurn: z.number().int().min(100).max(32000).optional(),
    budgetPerDayUsd: z.number().min(0).max(1000).optional(),
    metadata: z.record(z.unknown()).optional(),
    managerAgentId: z.string().optional(),
  }).optional(),
});
```

### Validaciones pre-create

1. Template existe (`AgentTemplate.findUnique({ slug })`) → 404.
2. Project existe (`ProjectRepository.findById(projectId)`) → 404.
3. Name collision (`agent.findUnique({ projectId_name })`) → 409.
4. Tools whitelist: cada tool del merged `toolAllowlist` debe existir en `toolRegistry.list()` → 400 si no.
5. `managerAgentId` (si se pasa): debe existir en mismo `projectId` y tener `type = backoffice` → 400 si no.
6. Channel availability: los channels deben tener `ChannelIntegration` activo. Si no → **warning**, no error (agente queda "disconnected").

### Merge strategy

```ts
const merged = {
  name: body.name,
  description: body.overrides?.description ?? template.description,
  promptConfig: {
    identity: body.overrides?.promptConfig?.identity ?? template.promptConfig.identity,
    instructions: body.overrides?.promptConfig?.instructions ?? template.promptConfig.instructions,
    safety: body.overrides?.promptConfig?.safety ?? template.promptConfig.safety,
  },
  llmConfig: body.overrides?.llmConfig ?? template.suggestedLlm,
  toolAllowlist: body.overrides?.toolAllowlist ?? template.suggestedTools,
  channelConfig: body.overrides?.channelConfig ?? { channels: template.suggestedChannels },
  modes: template.suggestedModes ?? [],
  type: template.type,                           // ← enum AgentType de Track A
  maxTurns: body.overrides?.maxTurns ?? template.maxTurns,
  maxTokensPerTurn: body.overrides?.maxTokensPerTurn ?? template.maxTokensPerTurn,
  budgetPerDayUsd: body.overrides?.budgetPerDayUsd ?? template.budgetPerDayUsd,
  status: 'active',
  metadata: {
    ...template.metadata,
    ...body.overrides?.metadata,
    createdFromTemplate: template.slug,
    templateVersion: template.version,
  },
  ...(body.overrides?.managerAgentId && { managerAgentId: body.overrides.managerAgentId }),
};
```

### Side effects (en `prisma.$transaction`)

1. `agent.create({ data: merged })`.
2. Crear `PromptLayer`s (identity/instructions/safety) en `projectId` con `createdBy: 'template:<slug>'`. Si ya hay layers activos, usamos los existentes (regla "no mutable PromptLayers").
3. Instanciar `SkillInstance` por cada slug en `template.suggestedSkillSlugs` (via `skillService.instantiateFromTemplate`).
4. Conectar MCP servers declarados en `template.suggestedMcps` (via `mcpServerRepository.createInstanceFromTemplate`).
5. Log info + 201 con el agente creado.

### Response

```json
{
  "agent": { /* Agent object */ },
  "warnings": ["channel 'whatsapp' not configured"]
}
```

---

## e) Cambios a Campaign (schema + Zod)

**Track A aplica el diff al schema**. Diseño:

```prisma
model Campaign {
  id               String         @id @default(cuid())
  projectId        String         @map("project_id")
  name             String
  status           CampaignStatus @default(draft)
  template         String
  channel          String
  audienceFilter   Json           @map("audience_filter")

  // ── NUEVO (Track A) ──────────────────────────────────────────
  agentId          String   @map("agent_id")                        // REQUIRED
  scheduledTaskId  String?  @unique @map("scheduled_task_id")        // optional FK
  audienceSource   Json?    @map("audience_source")
  audienceCache    Json?    @map("audience_cache")
  // ─────────────────────────────────────────────────────────────

  scheduledFor     DateTime?      @map("scheduled_for")
  completedAt      DateTime?      @map("completed_at")
  metadata         Json?
  createdAt        DateTime       @default(now()) @map("created_at")
  updatedAt        DateTime       @updatedAt      @map("updated_at")

  project       Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  agent         Agent          @relation("CampaignAgent", fields: [agentId], references: [id], onDelete: Restrict)
  scheduledTask ScheduledTask? @relation("CampaignScheduledTask", fields: [scheduledTaskId], references: [id], onDelete: SetNull)
  sends         CampaignSend[]

  @@index([projectId, status])
  @@index([agentId])
  @@map("campaigns")
}

model CampaignSend {
  id         String             @id @default(cuid())
  campaignId String             @map("campaign_id")
  contactId  String             @map("contact_id")
  agentId    String?            @map("agent_id")     // ← NUEVO (Track A): snapshot del agente al momento del envío
  status     CampaignSendStatus @default(queued)
  variantId  String?            @map("variant_id")
  error      String?
  sentAt     DateTime?          @map("sent_at")
  createdAt  DateTime           @default(now()) @map("created_at")

  campaign Campaign        @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  agent    Agent?          @relation("CampaignSendAgent", fields: [agentId], references: [id], onDelete: SetNull)
  reply    CampaignReply?

  @@index([campaignId, status])
  @@index([campaignId, variantId])
  @@index([contactId])
  @@index([agentId])
  @@map("campaign_sends")
}
```

Relaciones inversas adicionales que Track A debe añadir:
- `Agent { campaigns Campaign[] @relation("CampaignAgent") }`
- `Agent { campaignSends CampaignSend[] @relation("CampaignSendAgent") }`
- `ScheduledTask { campaign Campaign? @relation("CampaignScheduledTask") }`

### `AudienceSource` (discriminated union, en `src/campaigns/types.ts`)

```ts
export type AudienceSource =
  | {
      kind: 'contacts';               // legacy — filtra Contact table local
      filter: AudienceFilter;          // { tags, role }
    }
  | {
      kind: 'mcp';                     // via MCP tool (reactivación HubSpot)
      serverName: string;              // e.g. "hubspot"
      toolName: string;                // e.g. "search-deals"
      args: Record<string, unknown>;   // { pipelineId, stageId, inactiveDays }
      mapping: {
        contactIdField: string;        // "contact.id"
        phoneField?: string;           // "contact.properties.phone"
        emailField?: string;           // "contact.properties.email"
        nameField?: string;            // "contact.properties.firstname"
      };
      ttlHours: number;                // cache TTL. Default 24, configurable por campaña (D4).
    };

export interface AudienceCache {
  contactIds: string[];
  resolvedAt: string;                   // ISO
  expiresAt: string;                    // ISO (= resolvedAt + ttlHours)
  sourceHash: string;                   // sha1(AudienceSource) — invalida al cambiar
  count: number;
}
```

### Cambios a `src/api/routes/campaigns.ts`

```ts
const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  agentId: z.string().min(1),                               // ← NUEVO, required
  template: z.string().min(1).max(10_000),
  channel: z.enum(['whatsapp','telegram','slack']),
  audienceFilter: audienceFilterSchema.optional(),          // ← ahora opcional
  audienceSource: audienceSourceSchema.optional(),          // ← NUEVO
  scheduledTaskId: z.string().optional(),                   // ← NUEVO
  scheduledFor: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine(
  (d) => !!d.audienceFilter || !!d.audienceSource,
  { message: 'Either audienceFilter or audienceSource is required' },
);
```

Validaciones extra en `POST`:
- Agent existe, mismo `projectId`, `status === 'active'`. 400 si no.
- Si `audienceSource.kind === 'mcp'`: `mcpServerRepository` debe tener instancia activa del `serverName` en el project. 400 si no.
- `scheduledTaskId`: existe, mismo project, sin otra campaign vinculada (unique enforce).

Mismas reglas en `updateCampaignSchema`.

**Endpoint nuevo** (soporte Track B):
```
POST /projects/:projectId/campaigns/:id/refresh-audience
→ fuerza re-resolución, ignora cache
→ 200 { contactIds, count, resolvedAt, expiresAt }
```

---

## f) Cambios a `src/campaigns/campaign-runner.ts`

Objetivo: resolver audiencia vía MCP con TTL cache, loggear `agentId`, popular `CampaignSend.agentId`.

### 1) Nuevo `resolveAudience`

Antes del `contact.findMany`:

```ts
async function resolveAudience(
  deps: CampaignRunnerDeps,
  campaign: Campaign,
): Promise<{ contacts: Contact[]; fromCache: boolean }> {
  const source = (campaign.audienceSource as AudienceSource | null);

  // Legacy path — sigue usando audienceFilter (Contact local)
  if (!source || source.kind === 'contacts') {
    const filter = (source?.filter ?? campaign.audienceFilter) as AudienceFilter;
    const contacts = await findContactsByFilter(deps.prisma, campaign.projectId, filter);
    return { contacts, fromCache: false };
  }

  // MCP path — con TTL cache
  const cache = campaign.audienceCache as AudienceCache | null;
  const nowMs = Date.now();
  const sourceHash = sha1(JSON.stringify(source));

  if (cache && cache.sourceHash === sourceHash && new Date(cache.expiresAt).getTime() > nowMs) {
    const contacts = await deps.prisma.contact.findMany({
      where: { id: { in: cache.contactIds }, projectId: campaign.projectId },
    });
    return { contacts, fromCache: true };
  }

  // Miss — llamar MCP, upsert Contacts, guardar cache
  const conn = deps.mcpManager.getConnection(source.serverName);
  if (!conn) throw new CampaignExecutionError(campaign.id, `MCP server '${source.serverName}' not connected`);
  const result = await conn.callTool(source.toolName, source.args);
  if (result.isError) throw new CampaignExecutionError(campaign.id, `MCP tool failed: ${asText(result)}`);

  const rows = extractRows(result);
  const contacts = await upsertContactsFromMcp(deps.prisma, campaign.projectId, rows, source.mapping);
  const expiresAt = new Date(nowMs + source.ttlHours * 3600_000);

  await deps.prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      audienceCache: {
        contactIds: contacts.map((c) => c.id),
        resolvedAt: new Date(nowMs).toISOString(),
        expiresAt: expiresAt.toISOString(),
        sourceHash,
        count: contacts.length,
      } as Prisma.InputJsonValue,
    },
  });

  return { contacts, fromCache: false };
}
```

`CampaignRunnerDeps` suma `mcpManager: MCPManager`. Ajustar wiring en `src/main.ts`.

### 2) Popular `CampaignSend.agentId`

En el bucle de envío:

```ts
const sendRecord = await prisma.campaignSend.create({
  data: {
    campaignId,
    contactId: contact.id,
    agentId: campaign.agentId,               // ← NUEVO
    status: 'queued',
    ...(chosenVariantId !== null && { variantId: chosenVariantId }),
  },
});
```

### 3) Logging con `agentId`

```ts
logger.info('Audience resolved', {
  component: 'campaign-runner',
  campaignId, agentId: campaign.agentId,
  matchingContacts: contacts.length, fromCache,
});
```

Y en cada `eventBus.emit({ kind: 'campaign.progress', ... agentId })`.

### 4) Export helper

Exportar `resolveAudience` (o wrapper `refreshAudience(campaignId, { force: true })`) para que la route `POST /refresh-audience` pueda forzar invalidación.

### 5) No se toca

- A/B testing (`abConfig` dentro de `metadata`).
- `checkAndMarkReply`.
- `interpolateTemplate`.
- `resolveRecipient`.
- ProactiveMessenger dispatch.

---

## g) Análisis de conflicto con `campaign-templates.ts`

**Conclusión: sin conflicto**. Conceptos ortogonales.

| Dimensión | `CampaignTemplate` (Track 4, ya mergeado) | `AgentTemplate` (Track C, nuevo) |
|---|---|---|
| **Qué define** | Plantillas de **texto de mensaje** para campañas | **Arquetipos de agente** |
| **Scope** | Por-proyecto (`projectId` FK) | Global |
| **Tabla** | `campaign_templates` | `agent_templates` |
| **Ruta HTTP** | `/projects/:projectId/campaign-templates` | `/agent-templates` |
| **Archivo** | `src/api/routes/campaign-templates.ts` (NO TOCAR) | `src/api/routes/agent-templates.ts` |
| **Export fn** | `campaignTemplateRoutes` | `agentTemplateRoutes` |
| **Imports cruzados** | Ninguno | Ninguno |
| **Materializer** | N/A — se copia body al crear campaign | `POST /projects/:id/agents/from-template` (vive en `agents.ts`) |
| **Versionado** | No | Campo `version` (soft) |
| **Permisos** | CRUD por project | Read-only (oficial) |

**Disciplina de naming:**
- Export `campaignTemplateRoutes` vs `agentTemplateRoutes` — nunca se colisionan.
- Imports en `src/api/index.ts`: dos líneas distintas con comentario de sección.
- Zod schemas en sus archivos respectivos (no barrel compartido).
- Prisma `@@map` explícito → no hay colisión SQL.

**UI del Track B (para confirmación del user):**
- Label: **"Plantillas de Agente"** vs **"Plantillas de Mensaje"**.
- Navegación separada (ítems de menú distintos).

---

## Orden de trabajo

1. **Ahora**: diseño guardado acá. **No commits. No código.**
2. **Esperar** a que Track A mergee su migración a `main` (enum + columnas + FKs de arriba).
3. Cuando Track A avise → `git fetch && git merge main` en este worktree.
4. Recién ahí: crear repository, endpoints, modificar runner, sumar seed. Con tests por cada capa.

---

## Dependencias con Track A (lista consolidada para coordinación)

Track A incorpora en su migración:
- [ ] Enum `AgentType { conversational, process, backoffice }`
- [ ] Column `Agent.type AgentType` (backfill desde `operatingMode`)
- [ ] Drop `Agent.operatingMode` + refactor de 8 referencias
- [ ] Model `AgentTemplate` completo (Sección a)
- [ ] `Campaign.agentId` FK required (onDelete: Restrict)
- [ ] `Campaign.scheduledTaskId` FK optional unique (onDelete: SetNull)
- [ ] `Campaign.audienceSource Json?`
- [ ] `Campaign.audienceCache Json?`
- [ ] `CampaignSend.agentId` FK optional (onDelete: SetNull) + índice
- [ ] Relaciones inversas en `Agent`, `ScheduledTask`
- [ ] `pnpm db:generate` + commit del cliente Prisma regenerado

Track C (yo) no hace commits hasta ver esto en `main`.
