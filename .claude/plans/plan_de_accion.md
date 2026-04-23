# Plan de Acción — Sistema de Agentes (fomo-core + dashboard)

**Fecha:** 2026-04-23
**Input:** `reporte_status.md` (diagnóstico) + `plan_de_accion_para_prompt2.md` (decisiones tomadas)
**Ventana:** 4 semanas, 3 Claude Code en paralelo (Backend / Dashboard UI / Feature Campañas).
**Restricción crítica (no negociable):** `dashboard/src/app/projects/[projectId]/agents/[agentId]/chat/page.tsx` queda intacto. La QA del equipo lo usa activamente; toda mejora en el detail de agente es **aditiva** (nueva tab o link lateral).

---

## Sección 1 — Resumen ejecutivo

- **Qué se entrega en 4 semanas**: (a) backend formalizado con enum `AgentType`, modelo `AgentTemplate` persistido y RBAC básico de 3 roles; (b) dashboard limpiado de duplicados/placeholders, con tabs en agent detail, wizard linealizado, sidebar agrupado y UI de Campañas operativa; (c) cliente de reactivación de leads configurado y corriendo sobre esa base.
- **Desbloqueo comercial**: al cerrar la semana 2 ya se puede onboardear al cliente real de reactivación de leads sin hacks manuales (archetype `outbound_campaign`, UI de campañas, cron ↔ agente vinculados en UI).
- **Queda afuera**: jerarquía manager→subordinado operativa (G2), FK rígidas (G4), MCP portables (G5), export/import (G6), knowledge versionado (G7), PromptLayers en UI (G8), métricas de salud (G9), webhooks salientes (G11), flags `readOnly` (G13). Todos documentados como backlog con trigger de activación.
- **Dashboard scope**: fomo-core-dashboard queda como admin interno Fomo. Cardumen es frontend separado (no tocado en este plan) que consume la misma API.
- **Presupuesto total estimado**: ~200h de trabajo neto, distribuido en 3 tracks paralelos, con 4 puntos de sincronización (uno por semana).

---

## Sección 2 — Plan temporal

### Semana 1 — Fundamentos (migraciones + limpieza crítica)

**Entregables al cierre de semana 1 (viernes):**
- Migraciones Prisma aplicadas: `AgentType` enum, `AgentTemplate`, `ProjectMember`, `Campaign.agentId`, `Campaign.scheduledTaskId`, `ScheduledTask.agentId`.
- Datos existentes migrados a la nueva taxonomía sin romper producción.
- Middleware RBAC funcionando; endpoints CRUD de members listos.
- Dashboard: duplicados `/conversations`, `/approvals`, `/cost` globales eliminados (redirects 301). Páginas mock (`/agents/[id]/logs`, `/traces` placeholder) removidas del nav.
- Sidebar agrupado (Configuración / Operación / Observabilidad / Admin) y labels jergosos renombrados.

**Tracks paralelos:**

| Track | Dueño de código | Entregables | Horas |
|---|---|---|---|
| **A — Backend schema & RBAC** | `prisma/`, `src/api/routes/projects.ts`, `src/api/routes/members.ts` (nuevo), `src/api/auth-middleware.ts`, `src/infrastructure/repositories/agent-repository.ts` | Migraciones + RBAC + tests | 20h |
| **B — Dashboard limpieza** | Todo fuera de `agents/new`, `agents/[agentId]`, `campaigns/` | Eliminación de duplicados, sidebar agrupado, renames | 12h |
| **C — Backend AgentTemplate** | `src/api/routes/agent-templates.ts` (nuevo), `src/infrastructure/repositories/agent-template-repository.ts` (nuevo), seed | Modelo + endpoints + seed con 5 templates | 14h |

**Dependencias:** Track A debe mergear su migración Prisma **antes** que C agregue la suya. C depende solo del enum `AgentType` de A (contrato de tipo, no de datos). B es totalmente independiente — vive en otro repo (submodule).

**Sync point 1 (viernes s1):** merge de migraciones Prisma a `main` + `pnpm db:migrate && pnpm db:generate && pnpm db:seed` en dev y prod. Smoke test: crear agente via API, listar templates, crear member, probar middleware RBAC.

---

### Semana 2 — Campañas UI + wizard fix (desbloqueo del cliente)

**Entregables al cierre de semana 2:**
- Wizard de creación de agente linealizado en 4 pasos, consumiendo `AgentTemplate` real (ya no hardcodeado).
- Archetype `outbound_campaign` disponible.
- Campañas: listing + new wizard + detail page con audience, sends, replies, conversiones, controles pausar/reanudar/cancelar.
- ScheduledTask vinculado a Agent via UI (dropdown en create, sección en agent detail).

**Tracks paralelos:**

| Track | Dueño de código | Entregables | Horas |
|---|---|---|---|
| **A — Backend endpoints campañas+scheduled** | `src/api/routes/campaigns.ts`, `src/api/routes/scheduled-tasks.ts` | `GET /campaigns/:id/stats`, filtros agentId, `POST /campaigns/:id/pause\|resume\|cancel` | 12h |
| **B — Dashboard: wizard lineal** | `dashboard/src/app/projects/[projectId]/agents/new/*` | Wizard 4 pasos + consumir `GET /agent-templates` + status `draft` hasta preview | 18h |
| **C — Dashboard: UI Campañas** | `dashboard/src/app/projects/[projectId]/campaigns/*` (nuevo) | Listing + new + detail + hook `useCampaigns`, `useCampaignStats` | 22h |

**Dependencias:**
- Track B depende de Track C de Semana 1 (endpoints `AgentTemplate` listos).
- Track C depende de Track A (stats endpoint) pero puede desarrollarse contra mocks React Query.
- Track A debe mergear primero en semana 2 para desbloquear C.

**Sync point 2 (viernes s2):** e2e test manual — crear template "Reactivación Leads" via seed → crear agente desde wizard usando ese template → crear campaña → encolar sends → verificar replies tracking.

---

### Semana 3 — Simplificaciones UI restantes

**Entregables al cierre de semana 3:**
- Agent detail con tabs (Overview / Prompt / Tools & MCP / Channels / Runs / Chat). Chat testing intacto como tab separada.
- Tab "Runs" conectada a `ExecutionTrace` real (reemplaza logs mock).
- `/projects/[id]/prompts` eliminado del sidebar (backlog: si se decide exponer PromptLayers, va como pestaña en Agent detail).
- Idioma único español aplicado a todo el dashboard.
- Preview + test rápido en wizard antes de activar (status `draft` → `active`).

**Tracks paralelos:**

| Track | Dueño de código | Entregables | Horas |
|---|---|---|---|
| **A — Backend: exponer ExecutionTrace por agente** | `src/api/routes/traces.ts` | `GET /agents/:id/traces` paginado con filtros fecha/status | 6h |
| **B — Dashboard: Agent detail con tabs** | `dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx` + `tabs/` (nuevo) | Split en tabs sin tocar `chat/` | 16h |
| **C — Dashboard: wizard preview + idioma** | `dashboard/src/app/projects/[projectId]/agents/new/*` + i18n pass global | Paso 4 preview, status draft, labels en español | 12h |

**Dependencias:** B depende de A (endpoint traces) pero puede mockear mientras A termina. C es independiente.

**Sync point 3 (viernes s3):** review de UI completa con el equipo Fomo (consultores). Validar que el wizard se entiende sin entrenamiento. Lock de cambios cosméticos.

---

### Semana 4 — Cliente real + docs + loose ends

**Entregables al cierre de semana 4:**
- Cliente de reactivación de leads corriendo en producción (proyecto real creado, agente configurado via template `outbound_campaign`, MCP HubSpot conectado, WAHA conectado, campaña encolada y tracking activo).
- Documentación `CLAUDE.md` actualizada con nuevo enum + flow de templates + RBAC.
- Documentación `.claude/plans/backlog.md` (este archivo sección 5) firmado y archivado.
- Tests de integración agregados para Campaign + AgentTemplate + RBAC.

**Tracks paralelos:**

| Track | Dueño de código | Entregables | Horas |
|---|---|---|---|
| **A — Backend: tests integración + fixes** | `src/api/routes/*.test.ts` (nuevos integration), `src/campaigns/` | Tests end-to-end + bug fixes del sync point 3 | 16h |
| **B — Onboarding del cliente real** | Seed específico del cliente + configuración de HubSpot MCP + WAHA | Cliente en prod respondiendo | 14h |
| **C — Docs + polish** | `CLAUDE.md`, `README.md`, `dashboard/CLAUDE.md`, copys finales | Docs + mensajes de error claros + empty states | 10h |

**Sync point 4 (viernes s4):** demo interno Fomo. Cliente funcionando en prod. Backlog archivado. Retrospectiva.

---

## Sección 3 — Frente A: Backend fomo-core

### A1 — G1: Enum `AgentType` + migración de datos

**Propuesta de taxonomía (3 tipos):**

```prisma
enum AgentType {
  conversational    // customer-facing: atiende mensajes entrantes end-users en canales (WhatsApp/Telegram/Chatwoot)
  process           // scheduled/batch: ejecutado por cron o trigger, produce output y termina (campañas, resúmenes, scraping)
  backoffice        // internal: copilot/manager/admin que opera para el equipo Fomo o el dueño (consume dashboard/slack)
}
```

**Por qué 3 y no las 5 actuales:** `operatingMode` hoy tiene `customer-facing | internal | copilot | manager | admin` — son **ejes mezclados**. "Manager" es una función (delegar a otros), no un tipo. "Admin" es elevación de permisos (RBAC, no tipo). Los 3 propuestos separan limpio **quién dispara** al agente:
- `conversational` → mensaje entrante (channel adapter).
- `process` → cron o API call batch.
- `backoffice` → humano desde UI (dashboard copilot, slack interno).

Tipo formal va en enum. Rol narrativo (`chief-of-staff`, `customer-support`) va en `metadata.archetype`. Función (manager delega, admin eleva) va en `capabilities` (tools allowlist + RBAC).

**Archivos tocados:**
- `prisma/schema.prisma:364-410` — Agregar enum `AgentType`, agregar `type AgentType @default(conversational)`, dejar `operatingMode String` como columna legacy deprecated (drop en semana 5+).
- `prisma/migrations/<ts>_add_agent_type_enum/migration.sql` — DDL + backfill.
- `src/api/routes/agents.ts:74-88` — Zod schema acepta `type` (nuevo) y `operatingMode` (deprecated, mapeo interno).
- `src/core/types.ts` — exportar `AgentType` type alias.
- `src/channels/inbound-processor.ts:101-369` — filtrar por `type='conversational'` al resolver agente por canal.
- `src/scheduling/task-executor.ts:78-150` — validar que el agente apuntado tiene `type='process'`.

**DDL concreto:**

```sql
-- UP
CREATE TYPE "AgentType" AS ENUM ('conversational', 'process', 'backoffice');

ALTER TABLE "agents" ADD COLUMN "type" "AgentType";

-- Backfill determinístico desde operating_mode
UPDATE "agents" SET "type" = 'conversational' WHERE "operating_mode" = 'customer-facing';
UPDATE "agents" SET "type" = 'backoffice'     WHERE "operating_mode" IN ('internal', 'copilot', 'manager', 'admin');
UPDATE "agents" SET "type" = 'process'        WHERE "id" IN (
  SELECT DISTINCT (task_payload->>'agentId')::text FROM "scheduled_tasks"
  WHERE task_payload ? 'agentId'
) OR "operating_mode" = 'admin';  -- admin seeds suelen ser batch

UPDATE "agents" SET "type" = 'conversational' WHERE "type" IS NULL; -- safety net

ALTER TABLE "agents" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "agents" ALTER COLUMN "type" SET DEFAULT 'conversational';

CREATE INDEX "agents_project_id_type_idx" ON "agents"("project_id", "type");
```

**Tests nuevos:**
- `src/api/routes/agents.test.ts` — crear agente con `type: 'process'` y validar que no se resuelve por inbound.
- `src/channels/inbound-processor.test.ts` — agente `process` nunca se selecciona para mensaje entrante.

**Horas:** 10h. **Depende de:** nada.

---

### A2 — G3: Modelo `AgentTemplate` + endpoints CRUD

**DDL:**

```prisma
model AgentTemplate {
  id              String    @id @default(cuid())
  slug            String    @unique                       // "customer-support", "outbound-campaign", "copilot-manager"
  name            String
  description     String
  type            AgentType                               // conversational | process | backoffice
  icon            String?                                 // "MessageCircle", "Zap", "Sparkles" (lucide)
  category        String                                  // "sales", "support", "ops", "marketing"
  isOfficial      Boolean   @default(false) @map("is_official")   // curados por Fomo vs creados por usuarios
  version         Int       @default(1)

  // Suggestions (lo que se pre-llena en el wizard — editable)
  promptConfig    Json      @map("prompt_config")         // { identity, instructions, safety }
  suggestedTools  String[]  @map("suggested_tools")       // tool IDs
  suggestedMcps   String[]  @map("suggested_mcps")        // slugs de MCP templates
  suggestedChannels String[] @map("suggested_channels")   // ["whatsapp", "telegram"]
  suggestedLlm    Json?     @map("suggested_llm")         // { provider, model, temperature }

  // Opcional: scheduled task baseline (para type=process)
  scheduledTaskTemplate Json? @map("scheduled_task_template") // { cronExpression, description }

  metadata        Json?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([category, isOfficial])
  @@map("agent_templates")
}
```

**Endpoints nuevos (`src/api/routes/agent-templates.ts`):**

| Método | Path | Scope | Descripción |
|---|---|---|---|
| `GET` | `/agent-templates` | Master o cualquier miembro | Lista todos (oficiales + del tenant). Filtros `?type=`, `?category=` |
| `GET` | `/agent-templates/:slug` | Cualquier miembro | Detail |
| `POST` | `/projects/:projectId/agents/from-template` | `operator+` | Body: `{ templateSlug, name, overrides }` → crea Agent aplicando defaults del template + overrides |
| `POST` | `/agent-templates` | Master only | Crear template (admin Fomo) |
| `PATCH` | `/agent-templates/:slug` | Master only | Edit |
| `DELETE` | `/agent-templates/:slug` | Master only | Delete si `isOfficial=false` |

**Seed inicial (5 templates oficiales):**
1. `customer-support` (conversational) — identity genérica atención al cliente, tools: `escalate-to-human`, `date-time`, `knowledge-search`, canales sugeridos: WhatsApp.
2. `outbound-campaign` (process) — identity reactivación, tools: `send-channel-message`, `store-memory`, scheduled task baseline `0 10 * * 1`.
3. `copilot-owner` (backoffice) — identity Owner's Copilot, todas las tools de management.
4. `manager-delegator` (backoffice) — identity manager, tools: `delegate-to-agent`, `list-project-agents`, `query-sessions`.
5. `knowledge-bot` (conversational) — identity FAQ, tools: `knowledge-search`, `escalate-to-human`.

**Archivos:**
- `prisma/schema.prisma` — agregar model.
- `prisma/seed.ts` — seedear los 5.
- `src/api/routes/agent-templates.ts` (nuevo) + registrar en `src/api/routes/index.ts`.
- `src/infrastructure/repositories/agent-template-repository.ts` (nuevo).
- `src/api/routes/agents.ts` — endpoint `POST /projects/:p/agents/from-template`.

**Tests nuevos:**
- Schema/handler/integration para cada endpoint.
- `src/api/routes/agents.test.ts` — crear agente desde template + overrides, verificar que suggestedTools se aplicaron.

**Horas:** 14h. **Depende de:** A1 (enum `AgentType`).

---

### A3 — G12: RBAC básico (owner / operator / viewer)

**DDL:**

```prisma
enum ProjectRole {
  owner      // full access: crea/borra agentes, members, cobranza
  operator   // crea/edita agentes, responde chats, resuelve approvals. No toca members ni billing.
  viewer     // read-only: lista, inbox, traces, cost. No crea nada.
}

model ProjectMember {
  id         String      @id @default(cuid())
  projectId  String      @map("project_id")
  userId     String      @map("user_id")                  // string libre por ahora; integración con Auth viene después
  email      String                                        // índice para invitar por mail
  role       ProjectRole
  invitedBy  String?     @map("invited_by")
  acceptedAt DateTime?   @map("accepted_at")
  createdAt  DateTime    @default(now()) @map("created_at")
  updatedAt  DateTime    @updatedAt @map("updated_at")

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@unique([projectId, email])
  @@index([userId])
  @@map("project_members")
}
```

**Middleware (`src/api/auth-middleware.ts` — extender):**

```ts
// Nueva utility
export function requireProjectRole(minRole: ProjectRole): preHandler;
// owner > operator > viewer. operator también incluye viewer. owner incluye todo.
```

Semántica: Master API key (sin `projectId`) sigue bypaseando todo. Project API keys ya tienen `projectId` — se tratan como `owner` por compatibilidad (sin cambios). RBAC nuevo solo aplica cuando el request viene con **user session** (futuro: Auth real). Para esta iteración: sin Auth de usuarios, solo dejamos el middleware + endpoints listos y los consume el dashboard autenticado con un `x-user-email` header trusteado (behind master key).

**Endpoints nuevos (`src/api/routes/members.ts`):**

| Método | Path | Requiere | Descripción |
|---|---|---|---|
| `GET` | `/projects/:projectId/members` | `viewer+` | Listar members |
| `POST` | `/projects/:projectId/members` | `owner` | Invitar por email + rol |
| `PATCH` | `/projects/:projectId/members/:id` | `owner` | Cambiar rol |
| `DELETE` | `/projects/:projectId/members/:id` | `owner` | Remover |

**Aplicación del middleware a rutas existentes:**
- `POST/PATCH/DELETE /projects/:projectId/agents/*` → `operator+`
- `GET /projects/:projectId/**` (read) → `viewer+`
- `POST /projects/:projectId/members/*` → `owner`
- `POST /projects/:projectId/api-keys` → `owner`

**Archivos:**
- `prisma/schema.prisma`.
- `src/api/auth-middleware.ts:1-182` — agregar `requireProjectRole`.
- `src/api/routes/members.ts` (nuevo) + registro.
- `src/infrastructure/repositories/member-repository.ts` (nuevo).
- Aplicar middleware a ~15 rutas (buscar todos los `projects/:projectId/*`).

**Tests nuevos:**
- `src/api/auth-middleware.test.ts` — 3 roles × 4 operaciones = 12 casos.
- `src/api/routes/members.test.ts` — CRUD + idempotencia de invitación.

**Horas:** 18h. **Depende de:** nada (schema independiente de A1/A2).

---

### A4 — Campaign enriquecido para caso reactivación de leads

**Cambios al schema actual (`prisma/schema.prisma:632-670`):**

```prisma
model Campaign {
  // ... campos existentes ...
  agentId          String?   @map("agent_id")              // NUEVO: qué agente ejecuta
  scheduledTaskId  String?   @unique @map("scheduled_task_id")  // NUEVO: si es recurrente
  audienceSource   Json?     @map("audience_source")       // NUEVO: { type: 'contacts' | 'mcp', mcpTool?, mcpArgs? }
  // audienceFilter queda para backcompat de filtros sobre contactos locales

  agent            Agent?         @relation(fields: [agentId], references: [id])
  scheduledTask    ScheduledTask? @relation(fields: [scheduledTaskId], references: [id])

  @@index([projectId, agentId])
}

enum CampaignSendStatus {
  queued
  sent
  failed
  delivered       // NUEVO
  replied
  converted
  unsubscribed    // NUEVO
}
```

**Audience source ampliada:** hoy `audienceFilter` solo filtra `Contact` locales. El caso reactivación viene **desde HubSpot via MCP**. Nueva shape:

```ts
type AudienceSource =
  | { type: 'contacts'; filter: { tags?: string[]; role?: string } }
  | { type: 'mcp'; mcpInstanceId: string; tool: string; args: Record<string, unknown> }; // ej: { tool: 'search-deals', args: { stage: 'cold', inactiveDays: 30 } }
```

**Endpoints nuevos/modificados (`src/api/routes/campaigns.ts:1-416`):**

| Método | Path | Descripción |
|---|---|---|
| `POST` | `/campaigns/:id/pause` | Status → paused |
| `POST` | `/campaigns/:id/resume` | Status → running |
| `POST` | `/campaigns/:id/cancel` | Status → cancelled |
| `GET` | `/campaigns/:id/stats` | `{ totalSends, sentCount, repliedCount, convertedCount, replyRate, conversionRate }` |
| `POST` | `/campaigns` (modificado) | Acepta `agentId`, `scheduledTaskId`, `audienceSource` |

**Runner (`src/campaigns/campaign-runner.ts`):**
- Cuando `audienceSource.type === 'mcp'`, invocar el MCP tool y mapear resultado a contactos sintéticos (crear `Contact` si no existen basado en teléfono/email).
- Respetar `status === 'paused'` en el loop de envío.

**Tests nuevos:**
- `src/campaigns/campaign-runner.test.ts` — MCP audience source.
- `src/api/routes/campaigns.test.ts` — pause/resume/cancel/stats.

**Horas:** 12h. **Depende de:** A1 (para validar que `Campaign.agentId` apunta a agente `type='process'` o `conversational`).

---

### A5 — ScheduledTask ↔ Agent FK

**Cambio:**

```prisma
model ScheduledTask {
  // ... existentes ...
  agentId  String? @map("agent_id")  // NUEVO
  agent    Agent?  @relation(fields: [agentId], references: [id])
  // taskPayload queda; `agentName` se deprecia
}
```

**Migración de datos:**
```sql
UPDATE "scheduled_tasks"
SET "agent_id" = (
  SELECT "id" FROM "agents"
  WHERE "project_id" = "scheduled_tasks"."project_id"
    AND "name" = "scheduled_tasks"."task_payload"->>'agentName'
  LIMIT 1
);
```

**Archivos:**
- `prisma/schema.prisma`.
- `src/scheduling/task-executor.ts:78-150` — preferir `task.agentId` sobre `taskPayload.agentName`.
- `src/api/routes/scheduled-tasks.ts` — aceptar `agentId` en Zod; mantener `agentName` deprecated.

**Horas:** 6h. **Depende de:** A1 (index de agents).

---

### A6 — Endpoint `GET /agents/:id/traces` paginado

**Archivo:** `src/api/routes/traces.ts` — agregar handler.

**Schema:**
```
GET /projects/:projectId/agents/:agentId/traces?status=&from=&to=&limit=20&cursor=
→ { items: ExecutionTrace[], nextCursor?: string }
```

**Horas:** 6h. **Depende de:** A3 (middleware `viewer+`).

---

### Resumen estimaciones backend

| # | Cambio | Horas | Semana | Track |
|---|---|---|---|---|
| A1 | Enum AgentType + migración | 10 | 1 | A |
| A2 | AgentTemplate + endpoints | 14 | 1 | C |
| A3 | RBAC ProjectMember + middleware | 18 | 1 | A |
| A4 | Campaign enriquecido | 12 | 2 | A |
| A5 | ScheduledTask.agentId FK | 6 | 2 | A |
| A6 | GET /agents/:id/traces | 6 | 3 | A |
| — | Tests integración | 10 | 4 | A |
| | **TOTAL backend** | **76h** | | |

---

## Sección 4 — Frente B: Dashboard UI

> **Todo lo dashboard vive en el submodule `dashboard/`**. Commits van al repo separado.
> **Regla de oro:** `dashboard/src/app/projects/[projectId]/agents/[agentId]/chat/page.tsx` **no se toca** excepto para cambiar el link del sidebar.

### B1 — Limpieza de duplicados y páginas muertas

**Antes → Después:**

| Página actual | Acción | Razón |
|---|---|---|
| `dashboard/src/app/conversations/page.tsx` + `[sessionId]/` | **Redirect 301 → primer proyecto `/projects/:id/inbox`** | Duplicado de `/projects/[id]/inbox`. Decisión: mantener versión por-proyecto (es el contexto natural). |
| `dashboard/src/app/approvals/page.tsx` | **Redirect 301 → `/projects/:id/approvals`** | Idem. |
| `dashboard/src/app/cost/page.tsx` | **Borrar** + remover del nav | Es "Coming Soon" placeholder. Cost real ya está en `/projects/[id]/costs`. |
| `dashboard/src/app/projects/[projectId]/prompts/page.tsx` | **Borrar** + remover del nav | Página vacía. PromptLayers como feature queda en backlog (G8). |
| `dashboard/src/app/projects/[projectId]/traces/page.tsx` | **Borrar** + remover del nav | Placeholder. Traces reales van en tab Runs del agent detail (B2). |
| `dashboard/src/app/projects/[projectId]/agents/[agentId]/logs/page.tsx` | **Borrar** + remover del nav | Mock data. Reemplazado por tab Runs del agent detail (B2). |

**Archivos tocados:** `dashboard/src/components/sidebar-*.tsx` (quitar entradas), los 6 archivos arriba.

**Horas:** 6h. **Depende de:** nada.

---

### B2 — Agent detail con tabs (preservando chat)

**Antes:** `dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx` — 805 líneas en scroll vertical.
**Después:** misma URL, ahora con tabs shadcn `<Tabs>`:

```
/projects/[p]/agents/[a]
  ├─ Overview (resumen, estado, métricas, tasks asociadas)
  ├─ Prompt (identity / instructions / safety editables)
  ├─ Tools & MCP (allowlist + MCP referenciados)
  ├─ Channels (allowedChannels + credenciales conectadas)
  ├─ Runs (ExecutionTrace paginado — conecta con A6)
  └─ [Chat testing] → link externo a /chat (NO se refactoriza)
```

**Archivos:**
- `dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx` — reescrito como shell + tabs.
- `dashboard/src/app/projects/[projectId]/agents/[agentId]/_tabs/` (nuevo): `overview.tsx`, `prompt.tsx`, `tools.tsx`, `channels.tsx`, `runs.tsx`.
- **NO tocar** `chat/page.tsx`.

**Nuevo hook:** `useAgentTraces(agentId)` consume `GET /agents/:id/traces` (A6).

**Horas:** 16h. **Depende de:** A6 (para tab Runs real).

---

### B3 — Wizard de creación linealizado (4 pasos)

**Antes:** `dashboard/src/app/projects/[projectId]/agents/new/page.tsx` — 834 líneas, 3 archetypes hardcoded + form único bifurcado.

**Después:** wizard de 4 pasos con state machine:

1. **Paso 1 — Plantilla**: grid de `AgentTemplate` (fetch desde `GET /agent-templates`). Filtro por `type` y `category`. Incluye `outbound_campaign`.
2. **Paso 2 — Básico**: nombre + `type` (auto-seleccionado desde template, editable) + canales sugeridos.
3. **Paso 3 — Conexiones**: muestra warnings si canales elegidos no tienen credenciales en `/integrations`. Link directo para configurarlas sin salir del flow (modal o slide-over).
4. **Paso 4 — Preview & test**: chat de prueba mock con ~3 mensajes de ejemplo (NO es el chat real). Botón "Activar" cambia `status: 'draft' → 'active'`.

**Status `draft`:** el agente se crea al cerrar paso 3 con `status='draft'` y no se resuelve por inbound hasta que el usuario active en paso 4.

**Archivos:**
- `dashboard/src/app/projects/[projectId]/agents/new/page.tsx` — reescrito como shell.
- `dashboard/src/app/projects/[projectId]/agents/new/_steps/` (nuevo): `step-template.tsx`, `step-basic.tsx`, `step-connections.tsx`, `step-preview.tsx`.
- Hook `useCreateAgentFromTemplate` (consume `POST /projects/:p/agents/from-template`).

**Horas:** 18h (paso 1-3) + 6h (paso 4 preview). Total 24h divididos entre sem 2 y 3.

**Depende de:** A2 (`AgentTemplate` endpoints), A1 (enum `AgentType`).

---

### B4 — UI de Campañas (nueva sección completa)

**Rutas nuevas:**

| URL | Archivo | Contenido |
|---|---|---|
| `/projects/[p]/campaigns` | `dashboard/src/app/projects/[projectId]/campaigns/page.tsx` | Listing con cards: status badge, agente asociado, próxima ejecución, métricas (% replied, % converted) |
| `/projects/[p]/campaigns/new` | `dashboard/src/app/projects/[projectId]/campaigns/new/page.tsx` | Wizard: nombre + agente (dropdown) + template de mensaje + audiencia (contactos locales **O** MCP tool) + cron opcional |
| `/projects/[p]/campaigns/[id]` | `dashboard/src/app/projects/[projectId]/campaigns/[campaignId]/page.tsx` | Detail: audiencia, sends, replies, stats, controles pausar/reanudar/cancelar |

**Componentes nuevos:**
- `dashboard/src/components/campaigns/campaign-card.tsx`.
- `dashboard/src/components/campaigns/audience-source-picker.tsx` (toggle: contactos filtro tags / MCP tool).
- `dashboard/src/components/campaigns/campaign-stats.tsx` (cards con números + chart simple Recharts).

**Hooks nuevos:** `useCampaigns`, `useCampaign`, `useCampaignStats`, `useCampaignMutations` (pause/resume/cancel).

**Sidebar:** agregar item "Campañas" en grupo "Operación".

**Horas:** 22h. **Depende de:** A4 (endpoints + audiencia MCP).

---

### B5 — Vincular ScheduledTask ↔ Agent en UI

**Cambios:**
- `dashboard/src/app/projects/[projectId]/tasks/page.tsx` (existente) — agregar dropdown "Agente" al crear task (consume `GET /projects/:p/agents?type=process`).
- `dashboard/src/app/projects/[projectId]/agents/[agentId]/_tabs/overview.tsx` (nuevo de B2) — sección "Tareas programadas" con lista de `ScheduledTask.agentId === agentId`.

**Archivos:**
- Tasks page + nueva query `?agentId=`.
- Hook `useAgentScheduledTasks(agentId)`.

**Horas:** 6h. **Depende de:** A5 (FK `ScheduledTask.agentId`), B2 (tabs).

---

### B6 — Sidebar agrupado + idioma único + renombrar jerga

**Sidebar groups (antes: 14 items planos → después: 4 grupos):**

```
Configuración
  ├─ Agentes
  ├─ Conocimiento
  ├─ Catálogo
  ├─ Archivos
  └─ Integraciones

Operación
  ├─ Bandeja
  ├─ Contactos
  ├─ Campañas (nueva)
  ├─ Tareas programadas
  └─ Aprobaciones

Observabilidad
  └─ Costos

Admin
  ├─ Habilidades
  ├─ Integraciones externas (era MCP Servers)
  ├─ Webhooks
  ├─ Secretos
  └─ Claves API
```

**Renames aplicados globalmente:**

| Antes | Después |
|---|---|
| Operating Mode | Tipo de uso |
| Archetype | Plantilla |
| MCP Server | Integración externa |
| Skill Instance | Habilidad personalizada |
| Tool Allowlist | Herramientas habilitadas |
| Manager Agent | Agente supervisor |
| Execution Trace | Registro de ejecución |

**Idioma:** todo a español. Se mantienen términos técnicos en inglés cuando son nombres propios (WhatsApp, Webhook, API Key, Bearer).

**Archivos:**
- `dashboard/src/components/sidebar-*.tsx`.
- Pass global de strings — script grep + review manual.

**Horas:** 12h. **Depende de:** B1 (limpieza), B4 (nuevo item campañas).

---

### Resumen estimaciones dashboard

| # | Cambio | Horas | Semana | Track |
|---|---|---|---|---|
| B1 | Limpieza duplicados | 6 | 1 | B |
| B2 | Agent detail tabs | 16 | 3 | B |
| B3 | Wizard lineal (4 pasos) | 24 | 2-3 | B/C |
| B4 | UI Campañas | 22 | 2 | C |
| B5 | ScheduledTask ↔ Agent | 6 | 2 | C |
| B6 | Sidebar + i18n + renames | 12 | 1-3 | B |
| | **TOTAL dashboard** | **86h** | | |

---

## Sección 5 — Backlog documentado

Gaps que no se abordan en este plan, con trigger de activación y esfuerzo estimado:

| Gap | Por qué queda afuera ahora | Trigger de re-priorización | Esfuerzo |
|---|---|---|---|
| **G2 — `managerAgentId` operativo** (valida jerarquía en `delegate-to-agent`) | No hay casos de uso reales pidiendo jerarquía estricta. `delegate-to-agent` vía allowlist funciona. | Cliente real pide "el dueño no debe poder llamar agentes operativos directamente" O Cardumen quiere visualizar árbol. | 12h |
| **G4 — FK en vez de strings** (ScheduledTask.agentName, AgentRunStep.agentName, audience filters por tag) | A5 ya cubre ScheduledTask; el resto son modelos con uso marginal. | Incidente real por rename que rompe datos históricos. | 16h |
| **G5 — MCPServerInstance portable cross-tenant** | Cada cliente es onboarding ~2h; no es bottleneck con 1-3 clientes. | >5 clientes activos O Cardumen quiere "copiá tu setup a otro tenant". | 24h |
| **G6 — Export/import de agente (JSON portable)** | Solapa con G3 (AgentTemplate) — templates cubren ~80% del caso "crear parecido a X". | Cliente con >10 proyectos pide clonar configs custom que no viven en templates. | 18h |
| **G7 — Knowledge base versionado/export** | Base actual sirve para MVP; nadie versionó RAG aún. | Cliente modifica knowledge y se rompe producción; necesita rollback. | 20h |
| **G8 — PromptLayers versionados en UI** | El schema está, pero `Agent.promptConfig` como blob cubre todos los casos actuales. | Cliente enterprise pide "publicar prompt nuevo sin romper la versión vieva para A/B". | 24h |
| **G9 — Métricas de salud agregadas** (% respondidos, latencia, satisfacción) | Hay traces + costo → suficiente para debugging. No hay cliente pidiendo KPIs aún. | Cardumen integración avanzada O cliente enterprise que exige SLA reports. | 28h |
| **G11 — Webhooks salientes (outbound)** | Notificaciones internas Slack/Telegram ya existen via tools. | Cliente pide "suscribirse a eventos del agente desde su propio sistema". | 14h |
| **G13 — Flags `readOnly` / `managedByPlatform`** | Hasta que clientes PyME entren al dashboard directo (decisión 2: Cardumen es separado). | Cardumen en producción con clientes reales editando. | 12h |

**Total backlog estimado:** ~168h — aproximadamente 4 semanas adicionales de trabajo si se aborda completo.

---

## Sección 6 — Coordinación de 3 agentes paralelos

### División de propiedad por carpeta

**Track A — Backend core (fomo-core)**
- **Propiedad exclusiva:** `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`, `src/api/auth-middleware.ts`, `src/api/routes/members.ts` (nuevo), `src/api/routes/agents.ts`, `src/api/routes/scheduled-tasks.ts`, `src/api/routes/traces.ts`, `src/infrastructure/repositories/**`, `src/channels/inbound-processor.ts`, `src/scheduling/task-executor.ts`, `src/core/types.ts`.
- **Lead de migraciones Prisma** (único track que las crea).
- Prohibido tocar: dashboard submodule, rutas de campaigns/templates (son de C).

**Track B — Dashboard limpieza/UX (dashboard submodule)**
- **Propiedad exclusiva:** `dashboard/src/components/sidebar-*.tsx`, `dashboard/src/app/conversations/**` (borra), `dashboard/src/app/approvals/**` (borra), `dashboard/src/app/cost/**` (borra), `dashboard/src/app/projects/[projectId]/prompts/**` (borra), `dashboard/src/app/projects/[projectId]/traces/**` (borra), `dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx` y `_tabs/`, `dashboard/src/app/projects/[projectId]/agents/[agentId]/logs/**` (borra). Pass de i18n/renames.
- Prohibido tocar: `dashboard/src/app/projects/[projectId]/agents/[agentId]/chat/**` (QA activo), `dashboard/src/app/projects/[projectId]/agents/new/**` (es de C), `dashboard/src/app/projects/[projectId]/campaigns/**` (es de C).

**Track C — Feature nueva (campañas + templates + wizard)**
- **Propiedad exclusiva:** backend `src/api/routes/campaigns.ts`, `src/api/routes/agent-templates.ts` (nuevo), `src/campaigns/campaign-runner.ts`, `src/infrastructure/repositories/agent-template-repository.ts` (nuevo). Dashboard: `dashboard/src/app/projects/[projectId]/campaigns/**` (nuevo), `dashboard/src/app/projects/[projectId]/agents/new/**`, `dashboard/src/app/projects/[projectId]/tasks/page.tsx`, `dashboard/src/components/campaigns/**` (nuevo).
- Prohibido tocar: schema.prisma (pide cambios a A por PR).

### Puntos de sincronización (4 total — uno por viernes)

| Sync | Qué se valida | Bloquea continuar si falla |
|---|---|---|
| **S1 (viernes sem 1)** | Migraciones Prisma aplicadas en dev + prod. Tests backend pasando. Dashboard limpiado mergeado. | Sí — sem 2 depende de `AgentTemplate` + enum. |
| **S2 (viernes sem 2)** | E2e manual: template → agente → campaña → send → reply. | Sí — sem 3 polisa UI sobre esto. |
| **S3 (viernes sem 3)** | Review UX con consultores Fomo. Lock cosmético. | No — permite seguir a sem 4 con fixes menores. |
| **S4 (viernes sem 4)** | Cliente real en prod respondiendo. Docs mergeadas. | Cierre del proyecto. |

### Orden de mergeo al final de cada semana

**Semana 1:**
1. Track A merge primero (`main` de fomo-core): schema.prisma + migraciones + RBAC + enum AgentType. `pnpm db:migrate && db:generate && db:seed` en dev.
2. Track C merge segundo (`main` de fomo-core): AgentTemplate endpoints + seed (depende de enum de A).
3. Track B merge tercero (`main` de dashboard submodule): limpieza + sidebar base. Update submodule pointer en fomo-core.

**Semana 2:**
1. Track A merge primero: Campaign FK + ScheduledTask FK + endpoints pause/resume/cancel/stats.
2. Track C merge segundo (backend campaigns): audiencia MCP + runner.
3. Track B/C paralelo (dashboard submodule): wizard + campaigns UI + scheduled-task ↔ agent.
4. Update submodule pointer.

**Semana 3:**
1. Track A merge: `GET /agents/:id/traces`.
2. Track B merge (dashboard): tabs en agent detail + wizard paso preview.
3. Track C merge (dashboard): polish campaigns + i18n final.
4. Update submodule pointer.

**Semana 4:**
1. Track A merge: tests integración.
2. Track B: onboarding cliente real (rama separada, no toca código).
3. Track C: docs + polish (CLAUDE.md, README).

### Reglas de oro de coordinación

1. **Schema Prisma lo toca solo Track A.** C solicita cambios via issue/PR chico; A los aplica o escribe la migración.
2. **Nunca dos tracks editan el mismo archivo el mismo día.** Si hace falta, uno espera o se coordina explícitamente.
3. **Dashboard submodule commits SOLO desde adentro de `dashboard/`**. Update de pointer en fomo-core ocurre al final de cada mergeo.
4. **Cada track corre `pnpm typecheck && pnpm test:unit` antes de mergear**. La checklist pre-push del CLAUDE.md es obligatoria para backend.
5. **Tests nuevos en el mismo PR que el código.** No se mergea feature sin al menos 1 test (schema Zod + dry run como mínimo).

---

## Sección 7 — Decisiones pendientes (antes de ejecutar)

Las 5 decisiones que necesito que tomes. Todas tienen impacto real en el plan; ninguna es cosmética.

### Decisión D1 — Segmentación del enum `AgentType`

**Opción propuesta:** 3 tipos — `conversational | process | backoffice`.
**Alternativa:** mantener tus 3 originales sugeridos con otros nombres — `customer_facing | scheduled | internal`.
**Trade-off:** "process" es más general que "scheduled" (cubre también batch disparado por API, no solo cron). "Backoffice" incluye copilot + manager + admin; si querés que "manager" sea tipo propio, pasamos a 4.
**Por qué importa:** afecta el DDL y la migración de datos (A1). Cambios post-deploy son pesados.
**Default si no respondés:** `conversational | process | backoffice`.

### Decisión D2 — Status `draft` vs `active` en agente

**Pregunta:** cuando el wizard crea un agente en paso 3 con `draft`, ¿debe el agente existir en DB (no resolver por inbound hasta activación) o NO crearse hasta paso 4?
**Opción A (en DB desde paso 3):** tolera cerrar el browser a mitad del wizard. Ocupa una fila "muerta" si nunca activan.
**Opción B (crear solo en paso 4):** state del wizard vive en localStorage hasta submit. Si cierran browser, pierden todo.
**Por qué importa:** cambia el flow del wizard y el status schema del `Agent`.
**Default si no respondés:** Opción A + job nocturno que elimina drafts >7 días.

### Decisión D3 — RBAC sin Auth real

**Contexto:** G12 (RBAC) necesita identidad de usuario. El dashboard hoy usa Bearer token solamente (sin sesiones de usuario).
**Opción A:** implementar RBAC completo pero trusted via header `x-user-email` detrás del master key. Queda "listo para cuando llegue Auth".
**Opción B:** aplazar RBAC a semana 5+ cuando haya Auth real.
**Por qué importa:** Opción A agrega 18h de trabajo que no se activan hasta tener Auth. Opción B deja G12 en backlog.
**Default si no respondés:** Opción A (la inversión rinde cuando Auth llegue).

### Decisión D4 — Audience source desde MCP en Campaign

**Contexto:** el caso reactivación requiere audiencia desde HubSpot (no contactos locales).
**Opción A:** `audienceSource.type='mcp'` dispara el MCP tool **una vez al crear la campaña** y snapshotea la audiencia como `CampaignSend` rows.
**Opción B:** re-ejecuta el MCP tool en cada run (para cron recurrente que quiere "leads cold cada lunes").
**Por qué importa:** cambia diseño del runner y de `CampaignSend` creation.
**Default si no respondés:** Opción B (más flexible, necesario para el caso real).

### Decisión D5 — Consolidar `operatingMode` deprecated o dropearlo ya

**Opción A:** mantener `operatingMode` como columna durante 1 mes después del deploy por si hay que rollback.
**Opción B:** droppear en la misma migración de A1.
**Por qué importa:** A impacta seeds + código que todavía lee `operatingMode`. Si dropeás, hay que refactorear 8 archivos en el mismo PR.
**Default si no respondés:** Opción A (riesgo menor).

---

## Apéndice — Qué me falta saber del código si quiere ir más profundo

Para planificar mejor estos puntos necesitaría leer más:

1. **Dashboard sidebar actual** — No leí `dashboard/src/components/sidebar-*.tsx`. Asumí estructura por el reporte; si hay comportamientos específicos (nested items, route guards), el rework de sidebar puede ser más chico o más grande.
2. **Chat testing WS protocol** — Para garantizar "no se toca" necesitaría confirmar que la WS connection en `/chat` no depende de estados que el tabs wrapper pueda romper (ej. si el wrapper re-monta el componente).
3. **Campaign runner actual** — Leí el schema pero no `src/campaigns/campaign-runner.ts`. Si ya soporta audience MCP parcial, A4 puede ser menos horas.
4. **ProjectMember vs Auth real** — No hay Auth de usuarios; cómo se define "userId" hoy. Hay endpoints `/auth` o solo Bearer?
5. **Configuración de HubSpot MCP del cliente real** — Qué campos de `search-deals` querés filtrar (pipeline, owner, stage específicos). Afecta el UI de audience picker en B4.

Si D1-D5 vuelven con decisión y los puntos 1-5 de arriba están OK con "default/asumir lo razonable", puedo empezar a ejecutar.
