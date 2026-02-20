# Plan: Nexus Core — Backend UI-Ready

## Context

Nexus Core tiene un backend sólido (1304 tests, agent loop E2E funcionando), pero la configuración es API-first y compleja. El objetivo es que el backend tenga todas las APIs necesarias para que desde fomo-platform (marketpaperdemo) se pueda:

1. Crear agentes con pocos clicks (templates o desde cero)
2. Toggle tools on/off visualmente (catálogo built-in + MCP)
3. Conectar canales fácilmente (WhatsApp, Telegram, Slack, Chatwoot, web)
4. Manejar secrets por proyecto (tokens encriptados en DB)
5. Gestionar knowledge base del agente

**Decisiones:**
- Canales: Chatwoot como hub + integraciones directas
- Tools nuevos: web-search, send-email, send-channel-message, read-file
- Secrets: DB encriptado por proyecto (AES-256-GCM)
- Prioridad: Backend listo para que el frontend funcione

---

## Estado Actual — Qué Tenemos

### Built-in Tools (14)
| Categoría | Tools | Notas |
|-----------|-------|-------|
| Utility | calculator, date-time, json-transform | OK pero raramente útiles solos |
| Integration | http-request | Genérico, requiere que el agente sepa URLs |
| Memory | knowledge-search | Bueno |
| Communication | send-notification (webhook only) | Muy limitado |
| Scheduling | propose-scheduled-task | Bueno |
| Catalog | catalog-search, catalog-order | Buenos para comercio |
| Vehicles | vehicle-lead-score, vehicle-check-followup | Vertical específico |
| Wholesale | wholesale-update-stock | Vertical específico |
| Hotels | hotel-seasonal-pricing, hotel-detect-language | Vertical específico |

### Tools que FALTAN para ser útil
| Tool | Por qué | Built-in vs MCP |
|------|---------|-----------------|
| **web-search** | Buscar info en internet | Built-in (capacidad core) |
| **send-email** | Email es comunicación universal | Built-in |
| **send-channel-message** | Mensajes proactivos por WhatsApp/Telegram/etc | Built-in (usa channel system) |
| **read-file** | Parsear PDFs, CSVs, docs que envían usuarios | Built-in |
| generate-image | Imágenes de producto, marketing | MCP (opcional, cuesta $) |
| google-sheets | Leer/escribir planillas (SMBs viven en sheets) | MCP (Google ecosystem) |
| google-calendar | Agendar citas, ver disponibilidad | MCP (Google ecosystem) |
| crm-operations | Crear/actualizar leads, contactos, deals | MCP (fomo-platform MCP) |
| task-management | Crear/actualizar tareas | MCP (fomo-platform MCP) |

### Canal System — Problemas Actuales
1. **Global, no per-project**: Telegram/WhatsApp/Slack comparten UN bot (env var al startup)
2. **Sin registro dinámico**: No se puede agregar canal desde UI sin reiniciar server
3. **Sin routing a agent**: Mensajes van al "default project", no a un agente específico
4. **Chatwoot es el único multi-tenant** (config per-project en DB)

### Configuración — Complejidad Actual
Crear un agente funcional hoy requiere:
1. `POST /projects` (con AgentConfig JSON completo)
2. `POST /projects/:id/prompt-layers` × 3 (identity, instructions, safety)
3. `POST /projects/:id/agents` (con promptConfig, toolAllowlist, channelConfig)
4. `POST /projects/:id/channel-integrations` (solo Chatwoot)
5. Knowledge base population (manual)

**Son 6+ API calls con JSON payloads complejos.** UI necesita 1-2 pasos max.

---

## Phase 1: Encrypted Secrets Store

**Por qué primero:** Channels y tools nuevos necesitan credentials per-project.

### Prisma: model `Secret`
```prisma
model Secret {
  id             String   @id @default(cuid())
  projectId      String   @map("project_id")
  key            String                          // "TELEGRAM_BOT_TOKEN", "TAVILY_API_KEY"
  encryptedValue String   @map("encrypted_value") // AES-256-GCM
  iv             String                          // Initialization vector (hex)
  authTag        String   @map("auth_tag")       // GCM auth tag (hex)
  description    String?
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  project        Project  @relation(fields: [projectId], references: [id])
  @@unique([projectId, key])
  @@index([projectId])
  @@map("secrets")
}
```

### Módulo `src/secrets/`
- `types.ts` — SecretMetadata, SecretRepository interface
- `crypto.ts` — encrypt/decrypt (Node.js `crypto`, AES-256-GCM), getMasterKey (from `SECRETS_ENCRYPTION_KEY` env)
- `secret-service.ts` — createSecretService(deps): set, get (decrypt), list (metadata only), delete, exists
- `index.ts` — barrel
- Tests: `crypto.test.ts`, `secret-service.test.ts`

### Repository
- `src/infrastructure/repositories/secret-repository.ts` — Prisma CRUD

### API Routes
```
GET    /projects/:projectId/secrets              → list keys (NO values nunca)
POST   /projects/:projectId/secrets              → { key, value, description? }
PUT    /projects/:projectId/secrets/:key         → update value
DELETE /projects/:projectId/secrets/:key         → delete
GET    /projects/:projectId/secrets/:key/exists  → boolean
```

### Modificaciones
- `prisma/schema.prisma` — add Secret model + Project relation
- `src/core/errors.ts` — add SecretNotFoundError
- `src/api/types.ts` — add `secretService: SecretService` to RouteDependencies
- `src/api/routes/index.ts` — register
- `src/main.ts` — wire up

---

## Phase 2: Dynamic Channel Integrations (All Providers)

**Depende de:** Phase 1 (secrets para credentials)

### Extender tipos en `src/channels/types.ts`
```typescript
export type IntegrationProvider = 'chatwoot' | 'telegram' | 'whatsapp' | 'slack';

// Configs per provider (referencian secrets por key name, no el valor)
interface TelegramIntegrationConfig {
  botTokenSecretKey: string;  // key en secrets table
}

interface WhatsAppIntegrationConfig {
  accessTokenSecretKey: string;
  phoneNumberId: string;
  verifyToken?: string;
}

interface SlackIntegrationConfig {
  botTokenSecretKey: string;
  signingSecretSecretKey?: string;
}

// ChatwootIntegrationConfig ya existe (se mantiene)
```

### Modificar adapters: tokens resueltos, no env vars
| Adapter | Antes | Después |
|---------|-------|---------|
| telegram.ts | `createTelegramAdapter({ botTokenEnvVar })` | `createTelegramAdapter({ botToken })` |
| whatsapp.ts | `createWhatsAppAdapter({ accessTokenEnvVar, phoneNumberId })` | `createWhatsAppAdapter({ accessToken, phoneNumberId })` |
| slack.ts | `createSlackAdapter({ botTokenEnvVar })` | `createSlackAdapter({ botToken, signingSecret? })` |
| chatwoot.ts | Ya recibe token directo | Sin cambios |

### Generalizar `src/channels/channel-resolver.ts`
- Hoy: solo Chatwoot + `process.env[]` para token
- Nuevo: todos los providers + `secretService.get()` para resolver credentials
- Cache por `projectId:provider` tuple
- `resolveAdapter(projectId, provider)` → ChannelAdapter | null
- `resolveProjectByIntegration(integrationId)` → ProjectId | null

### Dynamic webhook routes (`src/api/routes/channel-webhooks.ts`)
```
POST /webhooks/:provider/:integrationId        → inbound webhook
GET  /webhooks/:provider/:integrationId/verify  → verification challenges (Slack, WhatsApp)
```

Flujo:
1. Look up integration by ID → resolve projectId
2. Resolve adapter via channel resolver (creates lazily, caches)
3. `adapter.parseInbound(payload)` → InboundMessage
4. Feed into InboundProcessor

### Channel Integration CRUD
```
GET    /projects/:projectId/integrations                         → list all
POST   /projects/:projectId/integrations                         → create { provider, config }
GET    /projects/:projectId/integrations/:integrationId          → get
PUT    /projects/:projectId/integrations/:integrationId          → update
DELETE /projects/:projectId/integrations/:integrationId          → delete
GET    /projects/:projectId/integrations/:integrationId/health   → health check
```

### Remover static channel registration de `main.ts`
- Eliminar bloques `if (process.env['TELEGRAM_BOT_TOKEN'])` (líneas ~131-152)
- Adapters ahora se crean lazy por el resolver desde DB + secrets

---

## Phase 3: Tool Catalog API (para UI tool picker)

**Independiente** — puede ir en paralelo con Phase 2.

### Mejorar `src/api/routes/tools.ts`

Hoy devuelve solo metadata básica (id, name, description, riskLevel). Agregar JSON Schema para inputs/outputs (ya tenemos `zodToJsonSchema` importado en el tool-registry).

### API endpoints
```
GET  /tools                      → full metadata + JSON schemas
GET  /tools/categories           → agrupado por categoría
GET  /agents/:agentId/tools      → tools habilitados del agente (con metadata)
PUT  /agents/:agentId/tools      → toggle on/off { tools: string[] }
```

### Tipo de respuesta enriquecido
```typescript
interface ToolCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  sideEffects: boolean;
  inputSchema: Record<string, unknown>;   // JSON Schema from Zod
  outputSchema?: Record<string, unknown>;
}
```

La UI puede:
1. Mostrar catálogo completo (`GET /tools`)
2. Filtrar por categoría (`GET /tools/categories`)
3. Ver qué tiene el agente (`GET /agents/:id/tools`)
4. Toggle on/off (`PUT /agents/:id/tools`)

---

## Phase 4: Template Routes + Knowledge Base API

### 4A: Template API Routes

El `TemplateManager` ya existe en `src/templates/template-manager.ts` con `createProjectFromTemplate()` pero NO está expuesto por API.

```
GET  /templates                         → list templates con preview
GET  /templates/:id                     → template detail (prompts, tools, sample data)
POST /templates/:id/create-project      → creación atómica
```

Payload mínimo de creación:
```json
{
  "name": "Mi Ferretería",
  "owner": "user@email.com",
  "provider": { "type": "openai", "model": "gpt-4o-mini" }
}
```

Crea atómicamente:
- Project con config
- 3 PromptLayers (identity, instructions, safety)
- Agent con toolAllowlist del template
- Default channelConfig

Extender `TemplateManager` para también crear Agent (hoy solo crea Project + PromptLayers).

### 4B: Knowledge Base Management API

Memory entries ya existen (`memory_entries` table + pgvector). El tool `knowledge-search` ya lee de ahí. Falta API de gestión para la UI.

```
POST   /projects/:projectId/knowledge         → add { content, category?, importance? }
GET    /projects/:projectId/knowledge          → list con paginación + filtro por categoría
DELETE /knowledge/:id                          → delete
POST   /projects/:projectId/knowledge/upload   → bulk import JSON/CSV
```

Nuevo servicio `src/knowledge/knowledge-service.ts`:
- `add()` — genera embedding via provider, almacena con pgvector
- `list()` — paginación estándar (sin embeddings en respuesta)
- `delete()` — borra entry
- `bulkImport()` — batches de 20, genera embeddings en batch

---

## Phase 5: 4 New Built-in Tools

### 5.1 `web-search` — Tavily/Serper API
| Propiedad | Valor |
|-----------|-------|
| **id** | `web-search` |
| **riskLevel** | low |
| **requiresApproval** | false |
| **sideEffects** | false |
| **category** | search |
| **input** | `{ query: string, maxResults?: number (1-10, default 5) }` |
| **API key** | From project secrets: `TAVILY_API_KEY` or `SERPER_API_KEY` |
| **output** | `{ results: [{ title, url, content, score }] }` |

### 5.2 `send-email` — Resend API
| Propiedad | Valor |
|-----------|-------|
| **id** | `send-email` |
| **riskLevel** | high |
| **requiresApproval** | true |
| **sideEffects** | true |
| **category** | communication |
| **input** | `{ to: string, subject: string, body: string, replyTo?: string }` |
| **API key** | From project secrets: `RESEND_API_KEY` |
| **output** | `{ sent: true, messageId: string }` |

### 5.3 `send-channel-message` — Via channel adapters
| Propiedad | Valor |
|-----------|-------|
| **id** | `send-channel-message` |
| **riskLevel** | medium |
| **requiresApproval** | true |
| **sideEffects** | true |
| **category** | communication |
| **input** | `{ channel: ChannelType, recipientIdentifier: string, message: string }` |
| **dependency** | `channelResolver.resolveAdapter(projectId, channel)` |
| **output** | `SendResult` |

### 5.4 `read-file` — Parse uploaded files
| Propiedad | Valor |
|-----------|-------|
| **id** | `read-file` |
| **riskLevel** | low |
| **requiresApproval** | false |
| **sideEffects** | false |
| **category** | data |
| **input** | `{ fileId: string, extractionMode?: 'text' \| 'structured' }` |
| **dependency** | `fileService` |
| **formats** | CSV, PDF, JSON, plain text |
| **new dep** | `pdf-parse` |

### Tests: 3 niveles por tool (como CLAUDE.md requiere)
1. **Schema** — Zod rechaza inputs malformados
2. **Dry-run** — valida sin side effects, verifica que secret existe
3. **Integration** — mock API externa, verifica ejecución real

---

## Phase 6: Final Wiring

- Actualizar templates con `defaultTools` incluyendo nuevos tools
- Actualizar `prisma/seed.ts` con sample secrets + integrations para todos los providers
- Run `pnpm typecheck` + `pnpm test` + `pnpm lint` → all green

---

## Dependency Graph

```
Phase 1 (Secrets)     ──┬──→ Phase 2 (Channels) ──→ Phase 5.3 (send-channel-message)
                        ├──→ Phase 5.1 (web-search)
                        ├──→ Phase 5.2 (send-email)
                        └──→ Phase 4 (Templates + Knowledge)
Phase 3 (Tool Catalog) ──→ (independiente, arranca ya)
Phase 5.4 (read-file) ──→ (independiente, arranca ya)
Phase 6 (Wiring)      ──→ (después de todo)
```

---

## Resumen de Archivos

| Phase | Nuevos | Modificados |
|-------|--------|-------------|
| 1. Secrets | ~10 (módulo + migration + routes + tests) | ~6 |
| 2. Channels | ~4 (webhook routes + tests) | ~10 |
| 3. Tool Catalog | 0 | ~2 |
| 4. Templates + Knowledge | ~6 (knowledge module + routes + tests) | ~7 |
| 5. New Tools | ~8 (4 tools + 4 test files) | ~3 |
| 6. Final Wiring | 0 | ~5 |
| **Total** | **~28** | **~33** |

---

## Built-in vs MCP — Framework de Decisión

**Built-in cuando:**
- Core para todo agente (search, email, channels)
- Integrado con internals de Nexus (catalog, knowledge, scheduling)
- Security-sensitive (necesita RBAC, approval gates)
- Debe funcionar offline/self-hosted

**MCP cuando:**
- Integración con servicios externos (Google, Salesforce, etc.)
- Client-specific (cada cliente tiene tools diferentes)
- APIs que cambian rápido (MCP server se actualiza independiente)
- Community/ecosystem tools (leverage MCP servers existentes)

**El MCP de fomo-platform es el de mayor valor** — CRM + Tareas consumible por cualquier agente Nexus.

---

## Verificación

1. `pnpm typecheck` — 0 errors
2. `pnpm test` — all tests pass (existing + new)
3. `pnpm lint` — clean
4. Manual: Create project from template via `POST /templates/wholesale-hardware/create-project`
5. Manual: Toggle tools via `PUT /agents/:id/tools`
6. Manual: Add WhatsApp integration via `POST /projects/:id/integrations`
7. Manual: Set secret via `POST /projects/:id/secrets`
8. Manual: Knowledge CRUD cycle
