# Reporte de Status — Sistema de Agentes (fomo-core + dashboard)

**Fecha:** 2026-04-23
**Scope:** Diagnóstico exhaustivo del sistema de agentes, sin cambios. Base para discusión sobre simplificación y gaps Cardumen.
**Método:** Lectura de schema Prisma, código backend (`src/agents/`, `src/api/routes/`, `src/channels/`, `src/scheduling/`, `src/security/`), seed (`prisma/seed.ts`, `src/agents/fomo-internal/`) y todas las páginas de `dashboard/`.

---

## 1. Taxonomía real de agentes en el código

### 1.1 Modelo `Agent` (Prisma `schema.prisma:364-410`)

22 campos. Los relevantes para "tipo":

| Campo | Tipo | Valores reales encontrados |
|---|---|---|
| `operatingMode` | string (no enum) | `customer-facing`, `internal`, `copilot`, `manager`, `admin` |
| `status` | string (no enum) | `active`, `paused`, `disabled` |
| `modes` | JSON `AgentMode[]` | dual-mode runtime (ej: `whatsapp` + `dashboard` con prompts distintos) |
| `managerAgentId` | string FK Agent → Agent | **definida pero NO usada en seed** |
| `metadata` | JSON libre | Aquí va `archetype`, `vertical`, `skill`, etc. **Sin schema.** |

**No existen enums en Prisma**: todos los "tipos" son strings libres. El conjunto válido se descubre por grep.

### 1.2 Modelos relacionados

| Modelo | Relación con Agent | Notas |
|---|---|---|
| `Session` + `Message` | `Session.agentId` FK | conversación con un contacto |
| `AgentRun` + `AgentRunStep` | **sin FK a Agent**, usa `agentName` string | pipeline cross-project genérico |
| `ExecutionTrace` | por `sessionId`, no por `agentId` | telemetría LLM (prompt snapshot, eventos, costo) |
| `SkillInstance` | N:M vía `Agent.skillIds[]` (array de strings) | composición de prompt + tools requeridas |
| `MCPServerInstance` | scope **proyecto**, agente lo referencia por nombre en `mcpServers` JSON | no hay FK directa |
| `ChannelIntegration` | scope **proyecto**, agente declara canales en `channelConfig.allowedChannels` | resolución por `channel-resolver.ts` en runtime |
| `ScheduledTask` | `taskPayload.agentName` string en JSON | sin FK; cron dispara loop completo |
| `Campaign` / `CampaignSend` / `CampaignReply` | usa el agente del proyecto vía runner | no hay FK directa de Campaign → Agent |

**Patrón:** muchos vínculos son por nombre/string en JSON, no por FK. Esto permite flexibilidad pero rompe integridad referencial: cambiar el nombre de un agente puede romper scheduled tasks, AgentRunSteps históricos, audience filters.

### 1.3 Agentes seedeados

**Demo Project** (`prisma/seed.ts`):
- **Manager** — `operatingMode='manager'`, GPT-4o, 19 tools, scheduled task "Resumen diario" (cron `0 9 * * 1-5`), `metadata.archetype='copilot'`. Tiene scheduled task daily.
- **Manager FOMO (Chief of Staff)** — `operatingMode='internal'`, Sonnet 4.5, 12 tools, `metadata.archetype='chief-of-staff'`, canal WhatsApp directo.
- **Ferre** (mayorista) — `operatingMode='customer-facing'`, Sonnet 4.5, 8 tools, canales `chatwoot` + `whatsapp`.
- Otros verticales seedeados (concesionaria, hotel, manufactura, market paper) — todos `customer-facing`.

**FOMO Internal** (`src/agents/fomo-internal/agents.config.ts`):
- **FAMA-Sales** — `customer-facing`, WhatsApp+Telegram, 5 tools.
- **FAMA-Manager / FAMA-Ops / FAMA-CS** — operativos internos.
- **FOMO-Admin** — `operatingMode='admin'`, MiniMax/Kimi, ~15 tools, ejecutado solo por scheduled task.

### 1.4 Jerarquías manager → subordinados

- `Agent.managerAgentId` existe en el schema pero **ningún seed la usa**.
- La "delegación" real ocurre por la tool `delegate-to-agent` (`src/tools/definitions/delegate-to-agent.ts`): cualquier agente con esa tool en su allowlist puede invocar a otro por nombre. **No hay verificación de que el caller sea efectivamente "manager"** del callee — el control es por allowlist, no por jerarquía estructural.
- `agent-comms.ts` es un `EventEmitter` en proceso. No persiste el árbol de delegaciones.

### 1.5 Customer-facing vs backoffice vs batch

No hay un campo único que lo declare. Se infiere por combinación:

| "Tipo" práctico | Cómo se distingue |
|---|---|
| Customer-facing | `operatingMode='customer-facing'` + `channelConfig.allowedChannels` incluye WhatsApp/Telegram/Chatwoot |
| Copilot/Manager interno | `operatingMode='copilot'` o `'manager'` o `'internal'` + canal `dashboard` |
| Batch / scheduled | NO hay campo. Se identifica porque tiene un `ScheduledTask` apuntándole por nombre. `operatingMode='admin'` es el más cercano. |

### 1.6 Tipos vs roles vs verticales — confusión real

Hay **tres dimensiones mezcladas sin estructura**:

1. **`operatingMode`** (schema) — eje técnico de invocación (cómo se dispara).
2. **`metadata.archetype`** (libre) — narrativa UI (`copilot`, `chief-of-staff`, `customer_support`, `manager`).
3. **`metadata.vertical` / tags** (libre) — industria (`ferreteria`, `automotive`, `hotel`).

El wizard del dashboard (`dashboard/src/app/projects/[projectId]/agents/new/page.tsx:102-184`) ofrece 3 archetypes (`customer_support` | `copilot` | `manager`) y los traduce a `operatingMode` con un `if/else`. Resultado: mismo concepto, dos nombres distintos según donde mires.

---

## 2. Ciclo de vida de un agente

### 2.1 Creación vía API

`POST /projects/:projectId/agents` (`src/api/routes/agents.ts:237-287`).

**Schema Zod** (`agents.ts:74-88`):

| Campo | Obligatorio | Default |
|---|---|---|
| `name` | ✅ (1-100 chars, único por proyecto) | — |
| `promptConfig` | ✅ (al menos `identity`) | — |
| `description` | ❌ | — |
| `llmConfig` | ❌ | hereda del proyecto |
| `toolAllowlist` | ❌ | `[]` |
| `mcpServers` | ❌ | `[]` |
| `channelConfig` | ❌ | sin canales |
| `modes` | ❌ | sin override |
| `operatingMode` | ❌ | `customer-facing` |
| `skillIds` | ❌ | `[]` |
| `limits` | ❌ | `maxTurns=10`, `maxTokensPerTurn=4000`, `budgetPerDayUsd=10` |
| `managerAgentId` | ❌ | null |
| `metadata` | ❌ | `{}` |

**Validaciones:** `checkChannelCollision()` impide que dos agentes del mismo proyecto declaren el mismo canal. `[projectId, name]` es UNIQUE.

### 2.2 Asignación de capacidades

| Capacidad | Cómo se asigna |
|---|---|
| **Tools** | `Agent.toolAllowlist[]` (string[]). Sin endpoint específico — se setea en POST/PATCH del agente. |
| **Skills** | Endpoints dedicados (`src/api/routes/skills.ts`): `POST/DELETE /projects/:p/agents/:a/skills`. Compone vía `skillService.composeForAgent(skillIds)` que prepende `instructionsFragment` y enforza `requiredTools`. |
| **MCP** | Scope de proyecto (`MCPServerInstance`). El agente los referencia por nombre en `mcpServers` JSON o `modes[].mcpServerNames`. **No hay endpoint "add MCP to agent"**: hay que editar el JSON del agente. |
| **Channels** | `ChannelIntegration` es project-level. El agente declara intención (`channelConfig.allowedChannels`), `channel-resolver.ts:226-266` hace el match en runtime con cache TTL. Credenciales vía `SecretService`. |

### 2.3 Configuración de prompt (3 layers)

`src/api/routes/prompt-layers.ts` + `prisma/schema.prisma:157-180`.

- 3 layers independientes: `identity`, `instructions`, `safety`.
- Cada layer es **inmutable**: nueva versión = nuevo registro, `UNIQUE [projectId, layerType, version]`.
- Solo una versión activa por `(projectId, layerType)`.
- Endpoint `POST /prompt-layers/:id/activate` desactiva la previa.
- En runtime, `prepareChatRun()` (`src/api/routes/chat-setup.ts`) carga las 3 activas en paralelo.

⚠️ **Pero el agente también tiene `Agent.promptConfig` JSON con `{identity, instructions, safety}`.** Existen dos fuentes de verdad: layers project-wide (versionados) y promptConfig del agente (no versionado). El wizard escribe en `promptConfig` del agente, no en layers. El editor de `/prompts` global está vacío. **Convive el versionado serio con un blob libre — y el dashboard solo expone el blob libre.**

### 2.4 Triggers de ejecución

| Trigger | Camino |
|---|---|
| **Mensaje entrante** | `inbound-processor.ts:101-369` → `agentChannelRouter.resolveAgent(projectId, channel, contactRole)` → `runAgent(...)` → `channelResolver.send()` con retry. |
| **Schedule** | `scheduling/task-executor.ts:78-150` lee `taskPayload.agentName`, llama `prepareChatRun()` con un mensaje sintético. |
| **API directo** | `POST /agents/:id/invoke` con 3 modos: SSE (`stream=true`), async (`callbackUrl`), sync. |
| **Otro agente** | tool `delegate-to-agent` → `agent-comms.ts` (EventEmitter intra-proceso) ejecuta el loop completo del callee. |
| **Campaign** | `src/campaigns/campaign-runner.ts` itera audience, renderiza Mustache, invoca al agente del proyecto. |

### 2.5 Logging

| Modelo | Para qué |
|---|---|
| `Session` + `Message` | conversación end-user ↔ agente |
| `ExecutionTrace` (`promptSnapshot`, `events[]`, `totalTokensUsed`, `totalCostUsd`) | una invocación LLM completa con todos los pasos |
| `AgentRun` + `AgentRunStep` | pipeline cross-project genérico (sin FK a Agent) — uso menor |
| `UsageRecord` | costo por (`projectId`, `agentId`, `clientId`) — eje de cost monitor |

Pieza floja: traces y mensajes están bien instrumentados, pero `AgentRun` es paralelo y poco usado. El dashboard expone `/traces` como **placeholder** y `/agents/[id]/logs` con **mock data hardcodeada**.

### 2.6 Aprobaciones

`src/security/approval-gate.ts` + `ApprovalRequest` (`schema.prisma:235-256`).

- Tools con `riskLevel='high'|'critical'` o `requiresApproval=true` paran la ejecución, crean `ApprovalRequest` con `expiresAt` (5 min default).
- Resolución: `POST` con `approved`/`denied` + `resolvedBy` + nota opcional.
- Timeout configurable: `auto-approve | auto-deny | escalate` (con notifier Telegram).
- WS event `approval.created` para notificación en dashboard.

---

## 3. Flujo de creación de agente en el dashboard

Página: `dashboard/src/app/projects/[projectId]/agents/new/page.tsx`.

### 3.1 Pasos reales (no es un wizard multi-step lineal — es una página única bifurcada)

**Paso 0 — Selección de archetype** (3 cards visibles):
- `customer_support` — preselecciona Sonnet 4.5, canales WhatsApp+Telegram, 2 tools (`escalate-to-human`, `date-time`), prompts genéricos.
- `copilot` — preselecciona dashboard+slack, **TODAS** las tools del registry, prompts de "Owner's Copilot".
- `manager` — preselecciona dashboard, 13 tools (`delegate-to-agent`, `list-project-agents`, `query-sessions`, etc.), prompts de manager. Marcado "Nuevo".

**Paso 1 — "Configuración Básica"** (form único, scroll vertical):
- Nombre (input).
- Description (textarea, opcional).
- Canales (grid clickeable, requerido min 1).
- Toggle condicional **"¿Este agente habla con clientes y con vos?"** (si archetype=`customer_support` y se eligen ≥2 canales mixtos): activa modo dual con prompts distintos por audience.
- Toggle condicional **"Comportamiento personalizado por canal"** (si ≥2 canales sin dual): genera N `AgentMode` con prompt override por canal.
- Sección colapsable **Advanced Settings** con:
  - Provider + model + temperature + maxOutputTokens.
  - Editor de Identity / Instructions / Safety.
  - Tools (checklist).
  - MCP Servers (inline).
  - Escalation Path / Sub-Agents (si manager).

**Paso 2 — Submit y redirección** a `/agents/[agentId]` (detalle, sin tabs, scrolleable).

### 3.2 Decisiones que el usuario debe tomar

Visibles por defecto: **archetype, nombre, canales** (3 decisiones).
Bajo Advanced: **provider, model, temperature, max tokens, tool list, MCP servers, prompts, escalation** (~8 decisiones técnicas).

### 3.3 Decisiones confusas, redundantes o técnicas

| # | Fricción | Detalle |
|---|---|---|
| 1 | **`temperature` y `maxOutputTokens` expuestos** | Jerga LLM. 80% de usuarios ni los toca, pero los ve. |
| 2 | **Provider dropdown sin contexto** | Anthropic / OpenAI / Google / Ollama. No explica costos, latencia, capacidades. |
| 3 | **Identity duplicada** | El usuario escribe "Customer Support Agent" en `name` y luego "Sos un agente de soporte..." en identity. Si después cambia el nombre, identity queda viejo. |
| 4 | **Archetype = template, pero no se feedback** | Si edita tools/prompts en Advanced, pierde toda relación visual con el archetype elegido. No hay "te desviaste del template". |
| 5 | **Dual audience prematuro** | Pide "instrucciones para owner" antes de haber probado cómo responde a clientes. |
| 6 | **MCP en wizard + página separada** | Se pueden agregar MCP inline en el wizard Y en `/projects/[id]/mcp-servers`. ¿Cuál es la fuente de verdad? |
| 7 | **Canales sin credenciales** | El wizard "elige" WhatsApp pero NO pide token/cuenta. Esas viven en `/integrations`. El agente queda creado pero **no recibe nada** hasta visitar otra página. |
| 8 | **`Escalation Path (Sub-Agents)` con copy "Auto-wired"** | No explica qué significa. |

### 3.4 Información pedida múltiples veces

| Campo | Wizard | Agent Settings | `/prompts` |
|---|---|---|---|
| Identity | ✅ (Advanced) | ✅ (editable) | (vacío en UI) |
| Instructions | ✅ (Advanced) | ✅ (editable) | (vacío en UI) |
| Safety | ✅ (Advanced) | ✅ (editable) | (vacío en UI) |

Tres lugares teóricos para editar prompt, dos efectivamente operativos, **ninguno usa el sistema versionado de PromptLayers** del backend.

### 3.5 Falta crítica

- **No hay test/preview en el wizard.** El usuario crea un agente y debe ir a `/agents/[id]/chat` después para ver cómo responde.
- **No hay paso "configurar canal" integrado.** Crear sin canal funcional = agente inerte.
- **No hay "duplicar agente"**, ni siquiera desde el listado.

---

## 4. Análisis crítico del dashboard

### 4.1 Vistas existentes (37 `page.tsx`)

**Globales** (`dashboard/src/app/`): `/`, `/projects`, `/conversations`, `/analytics`, `/cost`, `/templates`, `/approvals`, `/clients`, `/settings`, `/login`.

**Por proyecto** (`/projects/[projectId]/`): `agents`, `agents/new`, `agents/[id]`, `agents/[id]/chat`, `agents/[id]/logs`, `inbox`, `prompts`, `knowledge`, `contacts`, `files`, `catalog`, `skills`, `mcp-servers`, `tasks`, `approvals`, `integrations`, `costs`, `traces`, `webhooks`, `secrets`, `api-keys`.

### 4.2 Útiles vs confusas

**Útiles:**
- `/agents` listing (cards con íconos por tipo, status, play/pause, chat directo).
- `/agents/[id]/chat` test chat con WS real-time, visualiza tool calls + costo.
- `/skills` y `/mcp-servers` con UI completa (templates + instancias + CRUD).
- `/tasks` cards de scheduled tasks con estado y próxima ejecución.
- `/api-keys` page con plaintext-once + revoke.

**Confusas o rotas:**
- `/agents/[id]` — **400+ líneas en una sola página scrollable, sin tabs**. Settings, prompt, tools, channels, MCP todo apilado.
- `/projects/[id]/prompts` — ruta **vacía**. El usuario espera el editor versionado, encuentra placeholder.
- `/projects/[id]/agents/[id]/logs` — **mock data hardcodeada** (líneas 34-50). UI pulida pero desconectada.
- `/projects/[id]/traces` — banner "Coming Soon", placeholder.
- `/cost` global — banner "Coming Soon".
- `/conversations` global vs `/projects/[id]/inbox` — **dos listas para lo mismo, sin clarificar**.
- `/approvals` global vs `/projects/[id]/approvals` — duplicado idéntico.

### 4.3 Terminología filtrada del backend

| Label en UI | Donde aparece | Debería ser |
|---|---|---|
| **Operating Mode** | agent detail | "Tipo de uso" / "Cómo se usa" |
| **Archetype** | wizard create | "Plantilla" o "Tipo" |
| **MCP Server** | sidebar, agent detail, modal | "Capacidad externa" / "Integración" |
| **Skill Instance** | `/skills` | "Habilidad personalizada" |
| **Tool Allowlist** | agent edit | "Herramientas habilitadas" |
| **Manager Agent** | dropdown en detail | "Agente supervisor" / "Escalación" |
| **Layer Type** | (no UI hoy, pero backend) | N/A |
| **Execution Trace** | `/traces` | "Registro de ejecución" / "Historial" |
| **Approval Gate** | (interno) | OK como "Aprobación" |
| **`projectId` / `agentId`** | URLs y tooltips | OK en URL, ocultar de UI |

### 4.4 Navegación

- **Sidebar global**: 8 items planos, **mezcla español ("Conversaciones", "Costos", "Clientes") e inglés ("Templates", "Approvals", "Analytics", "Dashboard", "Projects")**.
- **Sidebar de proyecto**: 14 items planos sin agrupación. Debería estar agrupado en: **Configuración** (Agents, Channels, Integrations, Knowledge, Files, Catalog) / **Operación** (Inbox, Tasks, Approvals, Webhooks) / **Observabilidad** (Traces, Costs) / **Admin** (Secrets, API Keys, MCP Servers).
- "MCP Servers" es **el único item del sidebar con jerga técnica directa**.

### 4.5 Tareas comunes con fricción

| Tarea | Clicks/saltos |
|---|---|
| Crear agente y dejarlo respondiendo en WhatsApp | 4 pantallas: `/agents/new` → submit → `/integrations` (configurar credencial) → `/agents/[id]/chat` (probar) |
| Cambiar el modelo LLM a un agente | 2 pantallas, scroll dentro de detail page |
| Aprobar una tool de riesgo alto | 1 click si llega notificación, 2-3 si entra desde sidebar — pero **2 paths posibles** (`/approvals` global vs `/projects/[id]/approvals`) |
| Conectar HubSpot vía MCP a un agente | 3 saltos: instanciar template en `/mcp-servers` → editar agente → activar tools de ese MCP |
| Ver runs históricos de un agente | Hoy: imposible con datos reales. La página `/logs` es mock. |

### 4.6 Vistas duplicadas

| Entidad | A | B |
|---|---|---|
| Conversaciones | `/conversations` (global) | `/projects/[id]/inbox` |
| Approvals | `/approvals` (global) | `/projects/[id]/approvals` |
| Costos | `/cost` (global, placeholder) | `/projects/[id]/costs` |
| Capabilidades | `/projects/[id]/skills` + `/projects/[id]/mcp-servers` + Tools allowlist en agent | tres catálogos paralelos sin jerarquía |

### 4.7 Vistas incompletas

- `/projects/[id]/prompts` — vacío.
- `/projects/[id]/agents/[id]/logs` — mock hardcodeado.
- `/projects/[id]/traces` — placeholder "Coming soon".
- `/cost` (global) — placeholder.

---

## 5. Casos concretos

### 5.1 Caso A — Reactivación de leads fríos (HubSpot + WAHA + schedule semanal)

**Lo que el usuario tiene que hacer hoy:**

1. `/projects/[id]/mcp-servers` → instanciar template de HubSpot → pegar API key → test connection.
2. `/projects/[id]/integrations` → conectar WAHA con sesión activa (escanear QR fuera del dashboard).
3. `/projects/[id]/agents/new` → elegir archetype `copilot` (no calza con "campaign"; el más cercano).
4. Abrir Advanced → editar identity ("Sos el agente de reactivación..."), instructions ("Cada lunes ejecutá la siguiente lógica..."), safety.
5. En Advanced agregar tools: `search-deals` (HubSpot MCP), `send-channel-message`, `store-memory`.
6. Submit → ir a `/agents/[id]/chat` → probar manualmente con un input "ejecutá reactivación".
7. **Crear scheduled task**: `/projects/[id]/tasks` → new → escribir cron `0 10 * * 1` y un `prompt` mensaje sintético — **no hay UI que conecte directamente "este agente, este cron"**, hay que escribir JSON-style payload.
8. Para tracking de respuestas: el modelo `CampaignReply` existe en backend, pero **no hay sección "Campañas" en el dashboard** (la lógica está, la UI no).

**Fricciones graves:**
- No hay archetype "campaña / outbound batch" en el wizard.
- Scheduled tasks no se vinculan visualmente a un agente.
- Sin UI de campañas: tracking de replies queda invisible.
- WAHA QR fuera del dashboard.

### 5.2 Caso B — Conversacional FAQ + Google Calendar + escalación humana

**Pasos:**

1. `/projects/[id]/knowledge` → cargar PDFs/markdown con FAQs.
2. `/projects/[id]/integrations` → conectar WhatsApp (WAHA o Meta).
3. `/projects/[id]/mcp-servers` → instanciar Google Calendar (no hay template seedeado, hay que crearlo manualmente con stdio/sse + secretos).
4. `/projects/[id]/agents/new` → archetype `customer_support` → canales WhatsApp.
5. Advanced: agregar tools `knowledge-search`, `escalate-to-human`, herramientas Calendar.
6. Editar instructions: "Si no sabés, llamá `escalate-to-human`. Para agendar, usá Google Calendar..."
7. Test en chat. Si el agente NO escala bien, no hay forma simple de ver por qué (logs son mock).
8. La cola de escalaciones llega a `/projects/[id]/approvals` (riesgo) o queda en sesión sin destino claro — **el flujo de "humano toma la conversación" está implementado en backend (`channels/handoff.ts`) pero la UI lo expone solo en `/inbox` con drawer**.

**Fricciones graves:**
- No hay catálogo de MCP populares (Calendar, Sheets) — todo manual.
- "Escalación a humano" no es un toggle visible en el wizard; depende de saber que existe la tool `escalate-to-human`.
- No hay manera de previsualizar si el knowledge base tiene cobertura suficiente.

### 5.3 Caso C — Duplicar agente para cliente nuevo

**Pasos:**

1. `/projects/new` → crear nuevo proyecto (cliente).
2. **No existe botón "duplicar agente"** ni en el listado ni en el detalle.
3. Workaround: abrir el agente fuente, copiar manualmente nombre, prompt, tools, MCP, channels al nuevo proyecto via `/agents/new`.
4. Recrear knowledge base manualmente (no hay export/import).
5. Reconfigurar canales y MCP (son project-scoped, no portables).
6. Re-escribir scheduled tasks.

**Fricciones graves:**
- Cero soporte de clonación. Todo manual.
- MCPServerInstance y ChannelIntegration son scope-proyecto: hay que rehacer credenciales.
- Knowledge base no tiene export.
- Templates de agente (`/templates` global) **existen como ruta** pero no hay flow "crear desde template" claro en el wizard de agente nuevo.

---

## 6. Recomendaciones de simplificación

### Alta impacto, bajo esfuerzo

1. **Tabs en `/agents/[id]`** — partir el detail page (400+ líneas) en 5 tabs: `Overview`, `Prompt`, `Tools & MCP`, `Channels`, `Runs/Logs`. Cero cambios en backend.
2. **Eliminar duplicación `/conversations` vs `/inbox`** — quedarse con `/inbox` por proyecto y matar la global, o invertir. Decisión binaria.
3. **Eliminar duplicación `/approvals` global vs por-proyecto** — idem.
4. **Renombrar labels jergosos** en sidebar y agent detail: "MCP Server" → "Integraciones externas"; "Operating Mode" → "Tipo de uso"; "Archetype" → "Plantilla" (y unificar con `operatingMode`).
5. **Botón "Duplicar agente"** en `/agents` listing — copia el JSON del agente al wizard pre-rellenado.
6. **Eliminar el `/projects/[id]/prompts` vacío o llenarlo** — hoy es trampa cognitiva.

### Alta impacto, esfuerzo medio

7. **Wizard linealizado**: paso 1 plantilla, paso 2 nombre+canales, paso 3 conexiones (alertando "configurá WhatsApp ahora"), paso 4 preview/test antes de activar. Status = `draft` hasta que el usuario apruebe en preview.
8. **Catálogo unificado de capacidades**: una sola página `/capabilities` que liste Tools (built-in) + Skills (custom) + MCP (externo) con filtros y badges, en vez de tres catálogos paralelos.
9. **Vincular ScheduledTask ↔ Agent en UI** — al crear task, dropdown de agentes del proyecto. Mostrar tasks dentro del agent detail tab.
10. **UI de Campañas** — el backend existe (`Campaign`, `CampaignSend`, `CampaignReply`, runner). Falta la página. Es el único path razonable para Caso A.

### Media impacto, bajo esfuerzo

11. **Esconder `temperature`/`maxOutputTokens`/`provider` detrás de un "Ajustes avanzados"** colapsado por default y con copy explicativo.
12. **Sidebar agrupado** con secciones: Configuración / Operación / Observabilidad / Admin.
13. **Idioma único** — decidir español o inglés y aplicar a todo el dashboard.
14. **Sincronizar `archetype` con `operatingMode`** — un solo concepto, una sola fuente, ya sea string o enum real en Prisma.

### Media impacto, esfuerzo medio

15. **Logs/Traces reales** — conectar `/agents/[id]/logs` y `/traces` a `ExecutionTrace` real (datos ya existen, falta solo el front).
16. **Preview/test desde el wizard** — botón "Probar" antes del submit definitivo.
17. **Templates de MCP populares seedeados** — Google Calendar, Sheets, Notion, Gmail. Ya hay 12 seedeados (HubSpot, Fomo Platform, etc.); ampliar.

### Baja impacto

18. **Limpiar placeholders** ("Coming Soon" en `/cost` y `/traces`) — o terminarlos o quitarlos.
19. **Mostrar canal asociado** en cards de `/agents` listing.

---

## 7. Gaps para Cardumen

Cardumen = agentes admin-ops para PyMEs, UI propia separada, **backend compartido con fomo-core**. Lo que el backend actual ya soporta vs. lo que falta:

### Lo que ya existe y sirve

- API REST completa con auth (Bearer + ApiKey por proyecto + master).
- Multi-proyecto (un Cardumen tenant = un Project).
- Channels dinámicos por proyecto (WhatsApp, Telegram, Slack).
- ScheduledTask para automatizaciones recurrentes.
- ApprovalGate para acciones sensibles.
- Tools admin-ops ya implementadas: `send-email`, `send-channel-message`, `query-sessions`, `propose-scheduled-task`, `delegate-to-agent`, `web-search`, `scrape-webpage`.
- MCP para conectar HubSpot, Sheets, Calendar, etc.

### Gaps de modelo / backend

| # | Gap | Por qué importa para Cardumen |
|---|---|---|
| G1 | **No hay enum formal de "tipo/rol de agente"**. Todo string libre + metadata. | Cardumen necesita un catálogo presentable: "Agente de cobranza", "Agente de seguimiento de turnos", etc. Hoy esto se diferencia por convención libre. |
| G2 | **`managerAgentId` declarado pero no operativo**. `delegate-to-agent` no valida jerarquía. | Cardumen para PyMEs probablemente quiere "el dueño tiene un manager + 3 sub-agentes" — necesita árbol real. |
| G3 | **Sin modelo `AgentTemplate` reutilizable cross-tenant**. Hoy "template" se simula con archetype hardcoded en el wizard. | Cardumen vende plantillas. Necesita un catálogo persistido y versionado, no en código del frontend. |
| G4 | **Vínculos por nombre/string** (ScheduledTask → Agent, Campaign → Agent) rompen al renombrar. | En manos de PyMEs sin operador FOMO, esto es bomba de tiempo. |
| G5 | **MCPServerInstance scope = proyecto**, no portable entre tenants/clientes. | Onboarding de cliente nuevo = reconectar todas las integraciones a mano. |
| G6 | **Sin export/import de agente** (definición JSON portable). | Imposible "venderle a un nuevo cliente la misma config". |
| G7 | **Knowledge base sin versionado/export**. | Idem — onboarding es manual. |
| G8 | **PromptLayers versionados existen pero el dashboard no los usa**. | Cardumen puede aprovecharlos para "publicar nueva versión del prompt sin romper la actual". Hay que decidir: usarlos o eliminarlos del schema. |
| G9 | **Sin métricas de "salud del agente"** agregadas (% mensajes contestados, % escalaciones, latencia, satisfacción). Hay traces y costos, no KPIs. | Cardumen necesita un dashboard de "está funcionando bien tu agente" para el dueño de PyME. |
| G10 | **Campaign UI inexistente**. Modelo y runner sí. | Caso de uso obvio para PyMEs (reactivación, recordatorios, encuestas). |
| G11 | **Sin webhooks salientes hacia el cliente** (notificaciones). El backend tiene `Webhook` inbound pero no hay outbound suscribible. | Cardumen quiere notificarle al dueño "tu agente escaló X" en su propio Slack/email. |
| G12 | **Sin RBAC granular**. Hoy auth es Bearer all-or-nothing por proyecto. | PyMEs reales tienen "dueño" (full), "operador" (chat + approvals), "auditor" (solo lectura). |
| G13 | **Sin "modo dueño no técnico"** en el modelo: cualquier campo se puede editar. | Cardumen necesita locking: "esto lo configuró Fomo, no lo cambies". Falta concept de `readOnly`/`managedByPlatform` flags. |

### Gaps de UX / dashboard (que afectan a Cardumen porque comparten backend)

- **Falta API de "templates de agente"** que Cardumen pueda consumir directamente. Hoy los archetypes están hardcodeados en `dashboard/src/app/.../new/page.tsx`.
- **Falta "preview/test sandbox"** desacoplado de un agente real, para que Cardumen muestre "probá este template antes de comprarlo".
- **Falta documentación API de los endpoints** que Cardumen va a consumir (no hay OpenAPI/Swagger expuesto).

### Recomendación de orden para no bloquear Cardumen

1. **G3 + G6**: modelo `AgentTemplate` + export/import de agente. Sin esto, Cardumen no puede vender plantillas.
2. **G12**: RBAC granular básico (3 roles: owner/operator/viewer). Sin esto, no podés dejar a un cliente PyME entrar al dashboard.
3. **G9**: métricas agregadas básicas (volumen, escalaciones, latencia). Sin esto, el cliente no entiende si funciona.
4. **G10**: UI de Campañas. Es 60% del valor para PyMEs admin-ops.
5. **G1 + G2**: formalizar tipos y jerarquía. Refactor bigger pero alimenta toda la UX.
6. Lo demás (G4, G5, G7, G8, G11, G13) puede ir después — todos importantes pero no bloqueantes para un MVP de Cardumen.

---

## Apéndice — Lo que está bien

Para no ser solo críticos:

- El **modelo de tools con `dryRun()` + risk levels + ApprovalGate** está sólido y bien separado.
- La **inyección de secretos** (`SecretService`) y la prohibición de pasarlos al LLM están bien enforced.
- El **versionado de PromptLayers** está bien diseñado (aunque no se use en UI).
- El **CostGuard** + `UsageRecord` con breakdown por proyecto/agente/cliente es buena base para Cardumen.
- La **API de invoke** con 3 modos (sync/SSE/async-callback) es flexible y produce-grade.
- El **channel-resolver dinámico con cache** y el seed de `ChannelIntegration` separado del agente permite multi-tenant real.
- El **registry de tools (29 built-ins)** cubre la mayoría de casos de uso PyME sin escribir código nuevo.

El esqueleto está. El problema es la presentación, la coherencia conceptual y los huecos de portabilidad.
