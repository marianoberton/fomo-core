# Plan de Acción — Sistema de Agentes (fomo-core + dashboard)

**Fecha original:** 2026-04-23
**Última actualización:** 2026-04-24 (post-Track D: A5 + A4 deployados en prod)
**Ventana:** 4 semanas, 3 Claude Code en paralelo (Backend / Dashboard UI / Feature Campañas).
**Restricción crítica (no negociable):** `dashboard/src/app/projects/[projectId]/agents/[agentId]/chat/page.tsx` queda intacto. La QA del equipo lo usa activamente; toda mejora en el detail de agente es **aditiva** (nueva tab o link lateral).

---

## Estado actual (audit 2026-04-24, post-Track D deploy)

| Item | Estado | Notas |
|------|--------|-------|
| A1 — AgentType enum + migración | ✅ LISTO | Enum, migración, `agent-role-shim.ts`, `operatingMode` dropeado |
| A2 — AgentTemplate modelo + endpoints | ✅ LISTO | 5 seeds oficiales, CRUD, `POST /from-template` |
| A3 — RBAC ProjectMember | ❌ PENDIENTE | Enum, modelo, routes y middleware inexistentes |
| A4 — Campaign enriquecido | ✅ LISTO | Commit 4c688a8 — pause/resume/cancel + `delivered`/`unsubscribed` statuses + columnas `paused_at`/`resumed_at`/`cancelled_at`/`delivered_at`/`unsubscribed_at` deployados |
| A5 — ScheduledTask.agentId FK | ✅ LISTO | Commit 06e22dc — migración `20260424000000` aplicada, 4 filas backfilled, endpoint expone `agentId` |
| A6 — GET /agents/:id/traces | ✅ LISTO | Endpoint paginado con filtros operativo |
| B1 — Limpieza duplicados | ✅ LISTO | Páginas globales eliminadas |
| B2 — Agent detail con tabs | ❌ PENDIENTE | Sigue siendo page.tsx monolítico de 35k |
| B3 — Wizard linealizado | ❌ PENDIENTE | Sigue siendo page.tsx de 36k, hardcodeado |
| B4 — UI Campañas | ❌ PENDIENTE | Ruta inexistente; sidebar tiene ítem apuntando a nada. **Desbloqueado por A4 completo.** |
| B5 — ScheduledTask ↔ Agent UI | ❌ PENDIENTE | **Desbloqueado por A5.** Sigue dependiendo de B2 (tabs) para la sección en agent detail |
| B6 — Sidebar + español | ⚠️ PARCIAL | Grupos y etiquetas en español OK; renames de jerga sin verificar |

**Resumen: 6 ítems completos, 1 parcial, 5 pendientes.**

**Crítico para desbloqueo del cliente:** B4 + B3 (backend 100% listo para el flujo de campañas).

### Deploy Track D (2026-04-24)

- **Commits**: A5 `06e22dc`, A4 `4c688a8`, merge `d4071b0` pusheado a `origin/main`.
- **Migraciones aplicadas en prod**: `20260424000000_add_scheduled_task_agent_fk` + `20260424010000_add_campaign_lifecycle_statuses`.
- **Container `fqoeno-app`**: healthy, server listening on 0.0.0.0:3002, 0 errores en logs en 8min.
- **Smoke tests**: 5/5 pass (scheduled_tasks backfill, enums, columnas lifecycle, endpoint agentId, error scan).

### ⚠️ Drift pre-existente (NO Track D — requiere PR separado)

- `prisma/migrations/20260302003327_add_campaigns/migration.sql` declaró el enum `CampaignSendStatus` con sólo `{ queued, sent, failed }`.
- `replied` y `converted` fueron agregados al `schema.prisma` en algún punto sin migración acompañante → **prod nunca los tuvo**.
- Mi migración A4 agregó correctamente `delivered` + `unsubscribed` (sí están en prod).
- **Impacto actual**: cero (`campaign_sends` tiene 0 rows).
- **Riesgo latente**: si el reply-tracker corre en prod, `prisma.campaignSend.update({ status: 'replied' })` falla con invalid enum value.
- **Fix recomendado** (PR separado, 2 líneas SQL): `ALTER TYPE "CampaignSendStatus" ADD VALUE IF NOT EXISTS 'replied'; ... 'converted';`.

---

## Sección 1 — Resumen ejecutivo

- **Qué se entrega en 4 semanas**: (a) backend formalizado con enum `AgentType`, modelo `AgentTemplate` persistido y RBAC básico de 3 roles; (b) dashboard limpiado de duplicados/placeholders, con tabs en agent detail, wizard linealizado, sidebar agrupado y UI de Campañas operativa; (c) cliente de reactivación de leads configurado y corriendo sobre esa base.
- **Desbloqueo comercial**: al cerrar la semana 2 ya se puede onboardear al cliente real de reactivación de leads sin hacks manuales (archetype `outbound_campaign`, UI de campañas, cron ↔ agente vinculados en UI).
- **Queda afuera**: jerarquía manager→subordinado operativa (G2), FK rígidas (G4), MCP portables (G5), export/import (G6), knowledge versionado (G7), PromptLayers en UI (G8), métricas de salud (G9), webhooks salientes (G11), flags `readOnly` (G13). Todos documentados como backlog con trigger de activación.
- **Dashboard scope**: fomo-core-dashboard queda como admin interno Fomo. Cardumen es frontend separado (no tocado en este plan) que consume la misma API.
- **Presupuesto total estimado**: ~200h de trabajo neto, distribuido en 3 tracks paralelos, con 4 puntos de sincronización (uno por semana).

---

## Sección 2 — Plan temporal

### Semana 1 — Fundamentos (migraciones + limpieza crítica) ✅ COMPLETADA PARCIALMENTE

**Estado de entregables:**
- ✅ Migraciones Prisma aplicadas: `AgentType` enum, `AgentTemplate`, `ScheduledTask.agentId` FK.
- ✅ Datos existentes migrados a nueva taxonomía (`operatingMode` dropeado).
- ❌ `ProjectMember` — migración NO aplicada.
- ❌ Middleware RBAC y endpoints CRUD de members — NO implementados.
- ✅ Dashboard: duplicados globales eliminados.
- ⚠️ Sidebar agrupado en español — grupos OK, renames de jerga sin terminar.

**Tracks paralelos:**

| Track | Estado | Entregables | Horas restantes |
|---|---|---|---|
| **A — Backend schema & RBAC** | ⚠️ PARCIAL | ~~AgentType + migraciones~~ ✅, ~~ScheduledTask.agentId~~ ✅. Falta: ProjectMember + RBAC middleware | ~18h |
| **B — Dashboard limpieza** | ✅ LISTO | ~~Duplicados eliminados, sidebar agrupado~~ | 0h |
| **C — Backend AgentTemplate** | ✅ LISTO | ~~Modelo + endpoints + 5 seeds~~ | 0h |

**Sync point 1:** ~~merge de migraciones Prisma~~ ✅ parcialmente completado (A5 cerrado en Track D). Pendiente: RBAC antes de continuar con semana 2.

---

### Semana 2 — Campañas UI + wizard fix (desbloqueo del cliente) ⚠️ BACKEND LISTO, UI PENDIENTE

**Entregables al cierre de semana 2:**
- Wizard de creación de agente linealizado en 4 pasos, consumiendo `AgentTemplate` real (ya no hardcodeado).
- Archetype `outbound_campaign` disponible (ya seedeado en backend).
- Campañas: listing + new wizard + detail page con audience, sends, replies, conversiones, controles pausar/reanudar/cancelar.
- ScheduledTask vinculado a Agent via UI (dropdown en create, sección en agent detail).

**Tracks paralelos:**

| Track | Estado | Entregables | Horas |
|---|---|---|---|
| **A — Backend endpoints campañas+scheduled** | ✅ LISTO | ~~pause/resume/cancel + delivered/unsubscribed + ScheduledTask.agentId FK~~ (Track D deployado) | 0h |
| **B — Dashboard: wizard lineal** | ❌ PENDIENTE | Wizard 4 pasos + consumir `GET /agent-templates` + status `draft` hasta preview | 18h |
| **C — Dashboard: UI Campañas** | ❌ PENDIENTE | Listing + new + detail + hooks `useCampaigns`, `useCampaignStats` | 22h |

**Dependencias:**
- Track B depende de A2 ✅ (endpoints `AgentTemplate` ya listos) — puede arrancar.
- Track C depende de A4 ✅ (Track D cerró pause/resume/cancel/stats en prod) — puede arrancar sin mocks.
- **Todo el backend para semana 2 está listo**; la UI puede proceder en paralelo sin bloqueos.

**Sync point 2 (viernes s2):** e2e test manual — crear template "Reactivación Leads" via seed → crear agente desde wizard usando ese template → crear campaña → encolar sends → verificar replies tracking.

---

### Semana 3 — Simplificaciones UI restantes ❌ PENDIENTE

**Entregables al cierre de semana 3:**
- Agent detail con tabs (Overview / Prompt / Tools & MCP / Channels / Runs / Chat). Chat testing intacto como tab separada.
- Tab "Runs" conectada a `ExecutionTrace` real (A6 ya está listo).
- Idioma único español aplicado a todo el dashboard.
- Preview + test rápido en wizard antes de activar (status `draft` → `active`).

**Tracks paralelos:**

| Track | Estado | Entregables | Horas |
|---|---|---|---|
| **A — Backend: exponer ExecutionTrace por agente** | ✅ LISTO | ~~GET /agents/:id/traces paginado~~ | 0h |
| **B — Dashboard: Agent detail con tabs** | ❌ PENDIENTE | Split en tabs sin tocar `chat/` | 16h |
| **C — Dashboard: wizard preview + idioma** | ❌ PENDIENTE | Paso 4 preview, status draft, labels en español | 12h |

**Dependencias:** B depende de A6 (endpoint traces ✅ ya listo) — puede arrancar directamente. C es independiente.

**Sync point 3 (viernes s3):** review de UI completa con el equipo Fomo (consultores). Validar que el wizard se entiende sin entrenamiento. Lock de cambios cosméticos.

---

### Semana 4 — Cliente real + docs + loose ends ❌ PENDIENTE

**Entregables al cierre de semana 4:**
- Cliente de reactivación de leads corriendo en producción (proyecto real creado, agente configurado via template `outbound_campaign`, MCP HubSpot conectado, WAHA conectado, campaña encolada y tracking activo).
- Documentación `CLAUDE.md` actualizada con nuevo enum + flow de templates + RBAC.
- Tests de integración agregados para Campaign + AgentTemplate + RBAC.

**Tracks paralelos:**

| Track | Estado | Entregables | Horas |
|---|---|---|---|
| **A — Backend: tests integración + fixes** | ❌ PENDIENTE | Tests end-to-end + bug fixes del sync point 3 | 16h |
| **B — Onboarding del cliente real** | ❌ PENDIENTE | Cliente en prod respondiendo | 14h |
| **C — Docs + polish** | ❌ PENDIENTE | `CLAUDE.md`, `README.md`, `dashboard/CLAUDE.md`, copys finales | 10h |

**Sync point 4 (viernes s4):** demo interno Fomo. Cliente funcionando en prod. Backlog archivado. Retrospectiva.

---

## Sección 3 — Frente A: Backend fomo-core

### A1 — G1: Enum `AgentType` + migración de datos ✅ LISTO

**Implementado:**
- Enum `AgentType { conversational process backoffice }` en `prisma/schema.prisma`.
- Migración `20260423000000_add_agent_type_and_campaign_links` aplicada con backfill desde `operatingMode`.
- `operatingMode` dropeado en la misma migración.
- `src/core/agent-role-shim.ts` — mapea `(type, metadata.archetype)` → legacy role para fomo-platform.
- Índice `agents_project_id_type_idx` creado.

**Pendiente de este item:** filtro explícito `type='conversational'` en `src/channels/inbound-processor.ts` (el shim cubre compatibilidad pero el filtro no fue verificado).

---

### A2 — G3: Modelo `AgentTemplate` + endpoints CRUD ✅ LISTO

**Implementado:**
- Modelo `AgentTemplate` en schema con todos los campos del plan.
- `src/api/routes/agent-templates.ts` — `GET /agent-templates`, `GET /agent-templates/:slug`.
- `src/infrastructure/repositories/agent-template-repository.ts`.
- 5 seeds oficiales en `prisma/seed.ts`: `customer-support`, `outbound-campaign`, `copilot-owner`, `manager-delegator`, `knowledge-bot`.
- `POST /projects/:projectId/agents/from-template` en `src/api/routes/agents.ts` con validación de 12 pasos.

**Nota:** los campos usan naming sin prefijo `default` — es `promptConfig` no `defaultPromptConfig`. Ya documentado en CLAUDE.md.

---

### A3 — G12: RBAC básico (owner / operator / viewer) ❌ PENDIENTE

**DDL a implementar:**

```prisma
enum ProjectRole {
  owner      // full access: crea/borra agentes, members, cobranza
  operator   // crea/edita agentes, responde chats, resuelve approvals. No toca members ni billing.
  viewer     // read-only: lista, inbox, traces, cost. No crea nada.
}

model ProjectMember {
  id         String      @id @default(cuid())
  projectId  String      @map("project_id")
  userId     String      @map("user_id")
  email      String
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
export function requireProjectRole(minRole: ProjectRole): preHandler;
// owner > operator > viewer. operator también incluye viewer. owner incluye todo.
```

Semántica: Master API key (sin `projectId`) bypasea todo. Project API keys se tratan como `owner` por compatibilidad. RBAC nuevo aplica cuando el request viene con `x-user-email` header (trusted, detrás del master key).

**Endpoints nuevos (`src/api/routes/members.ts`):**

| Método | Path | Requiere |
|---|---|---|
| `GET` | `/projects/:projectId/members` | `viewer+` |
| `POST` | `/projects/:projectId/members` | `owner` |
| `PATCH` | `/projects/:projectId/members/:id` | `owner` |
| `DELETE` | `/projects/:projectId/members/:id` | `owner` |

**Archivos a crear/modificar:**
- `prisma/schema.prisma` — agregar enum + modelo.
- `pnpm db:migrate` — nueva migración.
- `src/api/auth-middleware.ts` — agregar `requireProjectRole`.
- `src/api/routes/members.ts` (nuevo) + registro en `src/api/index.ts`.
- `src/infrastructure/repositories/member-repository.ts` (nuevo).

**Tests nuevos:**
- `src/api/auth-middleware.test.ts` — 3 roles × 4 operaciones.
- `src/api/routes/members.test.ts` — CRUD + idempotencia de invitación.

**Horas:** 18h. **Depende de:** nada (schema independiente de A1/A2).

---

### A4 — Campaign enriquecido para caso reactivación de leads ✅ LISTO

**Implementado (pre-Track D):**
- Campos `agentId`, `scheduledTaskId`, `audienceSource` en modelo `Campaign`.
- `resolveAudience()` en `src/campaigns/campaign-runner.ts` — cache hit/miss, upsert contacts, MCP audience source.
- Endpoint `POST /projects/:projectId/campaigns/:id/refresh-audience`.
- Discriminated union `AudienceSource` con `kind: 'contacts' | 'mcp'`.

**Implementado en Track D (commit 4c688a8, migración `20260424010000_add_campaign_lifecycle_statuses`):**
- `CampaignSendStatus` enum en prod: `{ queued, sent, failed, delivered, unsubscribed }` (ver drift abajo).
- `POST /projects/:projectId/campaigns/:id/pause` — status → `paused`, set `paused_at`.
- `POST /projects/:projectId/campaigns/:id/resume` — status → `active`, set `resumed_at`.
- `POST /projects/:projectId/campaigns/:id/cancel` — status → `cancelled`, set `cancelled_at`.
- `GET /projects/:projectId/campaigns/:id/stats` — métricas agregadas.
- Columnas timestamp agregadas: `paused_at`, `resumed_at`, `cancelled_at`, `delivered_at`, `unsubscribed_at`.
- Runner respeta `status === 'paused'` en el loop de envío.

**⚠️ Drift pre-existente** (ver sección "Estado actual" al tope): `replied` y `converted` faltan en el enum de prod. PR separado necesario — `ALTER TYPE "CampaignSendStatus" ADD VALUE IF NOT EXISTS 'replied'; ... 'converted';`. Impacto hoy: cero (0 rows); riesgo si reply-tracker corre.

---

### A5 — ScheduledTask ↔ Agent FK ✅ LISTO

**Implementado (commit 06e22dc, migración `20260424000000_add_scheduled_task_agent_fk`):**
- Campo `agentId String?` + relación `agent Agent?` en `ScheduledTask`.
- Backfill via `task_payload->>'agentName'` → match por `project_id + name` en prod: 4 filas migradas (Valentina→Nadia, Lucas×2→Mateo, Mia→Mia).
- `src/scheduling/task-executor.ts` prioriza `task.agentId` sobre `taskPayload.agentName`.
- `src/api/routes/scheduled-tasks.ts` acepta `agentId` en Zod y expone el campo en la response.
- Smoke test en prod: `GET /scheduled-tasks` retorna `agentId` poblado.

---

### A6 — Endpoint `GET /agents/:id/traces` paginado ✅ LISTO

**Implementado:** `src/api/routes/traces.ts` — filtros por `agentId`, `status`, `from`, `to`; paginación con cursor.

---

### Resumen estimaciones backend

| # | Cambio | Horas originales | Estado | Horas restantes |
|---|---|---|---|---|
| A1 | Enum AgentType + migración | 10 | ✅ LISTO | 0 |
| A2 | AgentTemplate + endpoints | 14 | ✅ LISTO | 0 |
| A3 | RBAC ProjectMember + middleware | 18 | ❌ PENDIENTE | 18 |
| A4 | Campaign enriquecido | 12 | ✅ LISTO | 0 |
| A5 | ScheduledTask.agentId FK | 6 | ✅ LISTO | 0 |
| A6 | GET /agents/:id/traces | 6 | ✅ LISTO | 0 |
| — | Fix drift `replied`/`converted` | — | ⚠️ PR separado | ~1h |
| — | Tests integración | 10 | ❌ PENDIENTE | 10 |
| | **TOTAL backend** | **76h** | | **29h restantes** |

---

## Sección 4 — Frente B: Dashboard UI

> **Todo lo dashboard vive en el submodule `dashboard/`**. Commits van al repo separado.
> **Regla de oro:** `dashboard/src/app/projects/[projectId]/agents/[agentId]/chat/page.tsx` **no se toca** excepto para cambiar el link del sidebar.

### B1 — Limpieza de duplicados y páginas muertas ✅ LISTO

**Implementado:** páginas globales `/conversations`, `/cost`, `/prompts`, `/traces`, `/logs` eliminadas. Sidebar sin esas entradas.

---

### B2 — Agent detail con tabs (preservando chat) ❌ PENDIENTE

**Antes:** `dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx` — ~35k bytes, scroll vertical.
**Después:** misma URL, ahora con tabs shadcn `<Tabs>`:

```
/projects/[p]/agents/[a]
  ├─ Overview (resumen, estado, métricas, tasks asociadas)
  ├─ Prompt (identity / instructions / safety editables)
  ├─ Tools & MCP (allowlist + MCP referenciados)
  ├─ Channels (allowedChannels + credenciales conectadas)
  ├─ Runs (ExecutionTrace paginado — conecta con A6 ✅)
  └─ [Chat testing] → link externo a /chat (NO se refactoriza)
```

**Archivos a crear/modificar:**
- `dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx` — reescrito como shell + tabs.
- `dashboard/src/app/projects/[projectId]/agents/[agentId]/_tabs/` (nuevo): `overview.tsx`, `prompt.tsx`, `tools.tsx`, `channels.tsx`, `runs.tsx`.
- **NO tocar** `chat/page.tsx`.
- Hook `useAgentTraces(agentId)` — consume `GET /agents/:id/traces` (A6 ✅ listo).

**Horas:** 16h. **Depende de:** A6 ✅ (ya listo, puede arrancar).

---

### B3 — Wizard de creación linealizado (4 pasos) ❌ PENDIENTE

**Antes:** `dashboard/src/app/projects/[projectId]/agents/new/page.tsx` — ~36k bytes, 3 archetypes hardcoded.

**Después:** wizard de 4 pasos con state machine:

1. **Paso 1 — Plantilla**: grid de `AgentTemplate` (fetch desde `GET /agent-templates` ✅). Filtro por `type` y `category`.
2. **Paso 2 — Básico**: nombre + `type` (auto desde template, editable) + canales sugeridos.
3. **Paso 3 — Conexiones**: warnings si canales no tienen credenciales. Link para configurar sin salir del flow.
4. **Paso 4 — Preview & test**: chat mock ~3 mensajes. Botón "Activar" → `status: 'draft' → 'active'`.

**Status `draft`:** agente se crea al cerrar paso 3, no resuelve por inbound hasta activación en paso 4.

**Archivos a crear/modificar:**
- `dashboard/src/app/projects/[projectId]/agents/new/page.tsx` — reescrito como shell.
- `dashboard/src/app/projects/[projectId]/agents/new/_steps/` (nuevo): `step-template.tsx`, `step-basic.tsx`, `step-connections.tsx`, `step-preview.tsx`.
- Hook `useCreateAgentFromTemplate` (consume `POST /projects/:p/agents/from-template` ✅).

**Horas:** 24h. **Depende de:** A2 ✅ (ya listo, puede arrancar).

---

### B4 — UI de Campañas (nueva sección completa) ❌ PENDIENTE

**Nota:** el sidebar ya tiene el ítem "Campañas" en grupo "Operación" pero apunta a ruta inexistente. Backend 100% listo post-Track D: pause/resume/cancel/stats endpoints + lifecycle timestamps disponibles.

**Rutas nuevas:**

| URL | Archivo | Contenido |
|---|---|---|
| `/projects/[p]/campaigns` | `campaigns/page.tsx` | Listing: status badge, agente asociado, próxima ejecución, métricas |
| `/projects/[p]/campaigns/new` | `campaigns/new/page.tsx` | Wizard: nombre + agente + template mensaje + audiencia (contactos O MCP) + cron opcional |
| `/projects/[p]/campaigns/[id]` | `campaigns/[campaignId]/page.tsx` | Detail: audience, sends, replies, stats, controles pausar/reanudar/cancelar |

**Componentes nuevos:**
- `dashboard/src/components/campaigns/campaign-card.tsx`.
- `dashboard/src/components/campaigns/audience-source-picker.tsx` (toggle contactos / MCP tool).
- `dashboard/src/components/campaigns/campaign-stats.tsx` (cards + chart Recharts).

**Hooks nuevos:** `useCampaigns`, `useCampaign`, `useCampaignStats`, `useCampaignMutations` (pause/resume/cancel).

**Horas:** 22h. **Depende de:** A4 ✅ (cerrado en Track D) — puede arrancar sin bloqueos.

---

### B5 — Vincular ScheduledTask ↔ Agent en UI ❌ PENDIENTE

**Cambios:**
- `dashboard/src/app/projects/[projectId]/tasks/page.tsx` — agregar dropdown "Agente" (consume `GET /projects/:p/agents?type=process`). Backend ya expone `agentId` en `GET /scheduled-tasks` post-Track D.
- `dashboard/src/app/projects/[projectId]/agents/[agentId]/_tabs/overview.tsx` (de B2) — sección "Tareas programadas".

**Horas:** 6h. **Depende de:** A5 ✅ (cerrado en Track D) y B2 ❌ (tabs pendientes para la sección en agent detail).

---

### B6 — Sidebar agrupado + idioma único + renombrar jerga ⚠️ PARCIAL

**Ya implementado:**
- 4 grupos: Configuración / Operación / Observabilidad / Admin.
- Etiquetas en español: Agentes, Bandeja, Contactos, Tareas programadas, Costos, etc.

**Pendiente — renames de jerga a verificar y aplicar globalmente:**

| Antes | Después |
|---|---|
| Operating Mode | Tipo de uso |
| Archetype | Plantilla |
| MCP Server | Integración externa |
| Skill Instance | Habilidad personalizada |
| Tool Allowlist | Herramientas habilitadas |
| Manager Agent | Agente supervisor |
| Execution Trace | Registro de ejecución |

**Archivos:** pass global de strings en `dashboard/src/` — grep + review manual.

**Horas restantes:** ~6h. **Depende de:** B4 (para que "Campañas" en sidebar apunte a página real).

---

### Resumen estimaciones dashboard

| # | Cambio | Horas originales | Estado | Horas restantes |
|---|---|---|---|---|
| B1 | Limpieza duplicados | 6 | ✅ LISTO | 0 |
| B2 | Agent detail tabs | 16 | ❌ PENDIENTE | 16 |
| B3 | Wizard lineal (4 pasos) | 24 | ❌ PENDIENTE | 24 |
| B4 | UI Campañas | 22 | ❌ PENDIENTE | 22 |
| B5 | ScheduledTask ↔ Agent | 6 | ❌ PENDIENTE | 6 |
| B6 | Sidebar + i18n + renames | 12 | ⚠️ PARCIAL | 6 |
| | **TOTAL dashboard** | **86h** | | **74h restantes** |

---

## Sección 5 — Backlog documentado

Gaps que no se abordan en este plan, con trigger de activación y esfuerzo estimado:

| Gap | Por qué queda afuera ahora | Trigger de re-priorización | Esfuerzo |
|---|---|---|---|
| **G2 — `managerAgentId` operativo** | No hay casos de uso reales pidiendo jerarquía estricta. | Cliente pide restricción estricta O Cardumen quiere árbol visual. | 12h |
| **G4 — FK en vez de strings** | A5 ya cubre ScheduledTask; resto son modelos con uso marginal. | Incidente real por rename que rompe datos históricos. | 16h |
| **G5 — MCPServerInstance portable cross-tenant** | Onboarding ~2h por cliente; no es bottleneck con 1-3 clientes. | >5 clientes activos O Cardumen quiere clonar setup. | 24h |
| **G6 — Export/import de agente (JSON portable)** | Templates cubren ~80% del caso. | Cliente con >10 proyectos pide clonar configs custom. | 18h |
| **G7 — Knowledge base versionado/export** | Base actual sirve para MVP. | Cliente modifica knowledge, se rompe prod, necesita rollback. | 20h |
| **G8 — PromptLayers versionados en UI** | `Agent.promptConfig` como blob cubre todos los casos actuales. | Cliente enterprise pide A/B de prompts. | 24h |
| **G9 — Métricas de salud agregadas** | Traces + costo → suficiente para debugging. | Cardumen avanzado O cliente enterprise exige SLA reports. | 28h |
| **G11 — Webhooks salientes (outbound)** | Notificaciones internas Slack/Telegram ya existen via tools. | Cliente pide suscribirse a eventos desde su propio sistema. | 14h |
| **G13 — Flags `readOnly` / `managedByPlatform`** | Cardumen es separado; dashboard es solo Fomo team. | Cardumen en producción con clientes editando. | 12h |

**Total backlog estimado:** ~168h.

---

## Sección 6 — Coordinación de 3 agentes paralelos

### División de propiedad por carpeta

**Track A — Backend core (fomo-core)**
- **Propiedad exclusiva:** `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`, `src/api/auth-middleware.ts`, `src/api/routes/members.ts` (nuevo), `src/api/routes/agents.ts`, `src/api/routes/scheduled-tasks.ts`, `src/api/routes/traces.ts`, `src/infrastructure/repositories/**`, `src/channels/inbound-processor.ts`, `src/scheduling/task-executor.ts`, `src/core/types.ts`.
- **Lead de migraciones Prisma** (único track que las crea).
- Prohibido tocar: dashboard submodule, rutas de campaigns/templates.

**Track B — Dashboard limpieza/UX (dashboard submodule)**
- **Propiedad exclusiva:** `dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx` y `_tabs/`, pass de i18n/renames.
- Prohibido tocar: `chat/**` (QA activo), `agents/new/**` (es de C), `campaigns/**` (es de C).

**Track C — Feature nueva (campañas + wizard)**
- **Propiedad exclusiva:** backend `src/api/routes/campaigns.ts`. Dashboard: `campaigns/**` (nuevo), `agents/new/**`, `tasks/page.tsx`, `src/components/campaigns/**` (nuevo).
- Prohibido tocar: `schema.prisma` (pide cambios a A por PR).

### Puntos de sincronización

| Sync | Estado | Qué se valida |
|---|---|---|
| **S1 (viernes sem 1)** | ⚠️ PARCIAL — falta RBAC | Migraciones completas + tests + dashboard limpio |
| **S2 (viernes sem 2)** | ⚠️ BACKEND LISTO | Backend Track D deployado; falta UI (wizard + campaigns) |
| **S3 (viernes sem 3)** | ❌ PENDIENTE | Review UX con consultores Fomo |
| **S4 (viernes sem 4)** | ❌ PENDIENTE | Demo + cliente en prod + docs |

### Orden de mergeo (semanas pendientes)

**Para cerrar semana 1 (pendiente):**
1. Track A: `ProjectMember` + RBAC middleware. Migrar dev + prod. (ScheduledTask.agentId ya cerrado en Track D.)
2. PR separado: fix drift `CampaignSendStatus` — agregar `replied` + `converted` en prod.

**Semana 2 (backend cerrado, solo UI):**
1. Track B/C paralelo (dashboard submodule): wizard lineal + campaigns UI + tasks dropdown.
2. Update submodule pointer en fomo-core.

**Semana 3:**
1. Track B merge (dashboard): tabs en agent detail + wizard paso preview + renames B6.
2. Update submodule pointer.

**Semana 4:**
1. Track A merge: tests integración.
2. Track B: onboarding cliente real.
3. Track C: docs + polish (`CLAUDE.md`, `README.md`).

### Reglas de oro de coordinación

1. **Schema Prisma lo toca solo Track A.** C solicita cambios via issue/PR.
2. **Nunca dos tracks editan el mismo archivo el mismo día.**
3. **Dashboard submodule commits SOLO desde adentro de `dashboard/`.**
4. **Cada track corre `pnpm typecheck && pnpm test:unit` antes de mergear.**
5. **Tests nuevos en el mismo PR que el código.** No se mergea feature sin al menos 1 test.

---

## Sección 7 — Decisiones pendientes

Las decisiones D1-D5 originales fueron resueltas por los defaults del plan (verificado en implementación):

- **D1** ✅ — `conversational | process | backoffice` implementado.
- **D2** — Pendiente de decisión explícita; el wizard no existe aún, aplicar Opción A (draft en DB desde paso 3).
- **D3** — Pendiente de decisión explícita; aplicar Opción A (trusted `x-user-email` header) al implementar A3.
- **D4** ✅ — Opción B implementada: `resolveAudience()` re-ejecuta MCP en cada run con cache TTL.
- **D5** ✅ — `operatingMode` ya fue dropeado en la migración (Opción B tomada en la práctica).
