# Nexus Core — API & Dashboard

## API Overview

Nexus Core exposes a RESTful API via Fastify on port 3002, plus WebSocket endpoints for real-time chat streaming. All routes are under `/api/v1/`. Authentication is via Bearer token (`Authorization: Bearer <API_KEY>`).

## Response Envelope

All successful responses follow this envelope:
```json
{
  "success": true,
  "data": { /* actual response data */ }
}
```

Error responses:
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Agent not found",
    "statusCode": 404
  }
}
```

## Complete API Route Map

### Chat (Core Agent Loop)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/chat` | Synchronous chat — send message, wait for full response |
| WS | `/chat/stream` | WebSocket streaming chat — real-time events |
| POST | `/chat-setup` | Prepare a chat session (validate, load config, build prompt) |

**POST `/chat` request:**
```json
{
  "projectId": "proj-1",
  "agentId": "agent-1",
  "sessionId": "session-1",  // optional, auto-created if missing
  "message": "Hola, necesito información",
  "channel": "whatsapp",
  "contactRole": "customer"   // optional, for mode resolution
}
```

**WebSocket `/chat/stream` protocol:**
```
Client → Server:
  { "type": "create-session", "agentId": "agent-1", "projectId": "proj-1" }
  { "type": "chat", "sessionId": "session-1", "message": "Hola" }

Server → Client:
  { "type": "session-created", "sessionId": "session-1" }
  { "type": "message-chunk", "content": "¡Hola! ¿En qué..." }  // streaming
  { "type": "tool-call", "tool": "knowledge-search", "input": {...}, "status": "started" }
  { "type": "tool-result", "tool": "knowledge-search", "result": {...}, "success": true }
  { "type": "message-chunk", "content": "Según nuestra base..." }
  { "type": "message-complete", "fullContent": "¡Hola! ¿En qué puedo ayudarte?..." }
  { "type": "approval", "approvalId": "...", "tool": "send-email", "status": "pending" }
```

### Projects

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/projects` | List all projects |
| GET | `/projects/:id` | Get project details |
| POST | `/projects` | Create project |
| PATCH | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |
| GET | `/projects/:id/operations` | Project operations summary (agents, channels, sessions) |

### Agents

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/agents` | List agents (filter by `?projectId=`) |
| GET | `/agents/:id` | Get agent details |
| POST | `/agents` | Create agent |
| PATCH | `/agents/:id` | Update agent (including pause/resume) |
| DELETE | `/agents/:id` | Delete agent |
| GET | `/agents/:id/modes` | Get agent's operating modes |

### Sessions

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/sessions` | List sessions (filter by projectId, status, agentId, channel) |
| GET | `/sessions/:id` | Get session with messages and traces |
| PATCH | `/sessions/:id` | Update session (close, etc.) |

### Contacts

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/contacts` | List contacts (filter by projectId, search) |
| GET | `/contacts/:id` | Get contact details |
| POST | `/contacts` | Create contact |
| PATCH | `/contacts/:id` | Update contact (name, tags, role) |
| DELETE | `/contacts/:id` | Delete contact |

### Tools

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/tools` | List all registered tools |
| POST | `/tools/:id/dry-run` | Run a tool in dry-run mode (preview without side effects) |

### Approvals

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/approvals` | List approval requests (filter by projectId, status) |
| PATCH | `/approvals/:id` | Approve or reject a request |

### Prompt Layers

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/prompt-layers` | List layers (filter by projectId, layerType) |
| POST | `/prompt-layers` | Create new layer version |
| PATCH | `/prompt-layers/:id` | Activate/deactivate a layer |

### Execution Traces

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/traces` | List traces (filter by projectId, sessionId, status) |
| GET | `/traces/:id` | Get trace with all events |

### Scheduled Tasks

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/scheduled-tasks` | List tasks (filter by projectId, status) |
| POST | `/scheduled-tasks` | Create task |
| PATCH | `/scheduled-tasks/:id` | Update task (approve, pause, resume) |
| DELETE | `/scheduled-tasks/:id` | Delete task |

### Channel Integrations

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/integrations` | List integrations (filter by projectId) |
| POST | `/integrations` | Create integration |
| PATCH | `/integrations/:id` | Update integration |
| DELETE | `/integrations/:id` | Delete integration |

### MCP Servers

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/mcp-servers` | List instances (filter by projectId) |
| GET | `/mcp-server-templates` | List available templates |
| POST | `/mcp-servers` | Create instance |
| PATCH | `/mcp-servers/:id` | Update instance |
| DELETE | `/mcp-servers/:id` | Delete instance |

### Skills

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/skill-templates` | List skill catalog |
| GET | `/skill-instances` | List project instances (filter by projectId) |
| POST | `/skill-instances` | Create instance (from template or custom) |
| PATCH | `/skill-instances/:id` | Update instance |
| DELETE | `/skill-instances/:id` | Delete instance |

### Knowledge Base

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/knowledge` | List entries (filter by projectId) |
| POST | `/knowledge` | Create entry (with optional file upload) |
| DELETE | `/knowledge/:id` | Delete entry |

### Files

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/files` | List files (filter by projectId) |
| POST | `/files` | Upload file (multipart) |
| GET | `/files/:id/download` | Download file |
| DELETE | `/files/:id` | Delete file |

### Secrets

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/secrets` | List secret keys (no values!) for a project |
| PATCH | `/secrets` | Set/update a secret |
| DELETE | `/secrets/:key` | Delete a secret |

### Webhooks

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/webhooks` | List webhooks (filter by projectId) |
| POST | `/webhooks` | Create webhook |
| PATCH | `/webhooks/:id` | Update webhook |
| DELETE | `/webhooks/:id` | Delete webhook |
| POST | `/webhooks/inbound/:id` | Inbound webhook handler |

### Channel Webhooks

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/webhooks/channels/:provider/:projectId` | Channel webhook handler (WhatsApp, Telegram, etc.) |

### Costs

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/costs/dashboard-overview` | Global stats (agents, sessions, cost) |
| GET | `/costs` | Usage records (filter by projectId, date range) |

### Templates

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/templates` | Agent templates library |

### Catalog

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/catalog` | Search product catalog |

---

## Dashboard (Next.js Frontend)

### Architecture

The dashboard is a Next.js 16 App Router application. It lives in `dashboard/` as a git submodule with its own repo. It connects to the Nexus Core API via `NEXT_PUBLIC_API_URL` (default `http://localhost:3002`).

### Authentication

Simple API key authentication:
1. User enters API key on `/login` page
2. Key stored in `localStorage.fomo_api_key`
3. All API calls include `Authorization: Bearer <key>` header
4. No server-side sessions — purely client-side auth

### API Client Pattern

```typescript
// src/lib/api/client.ts
function createApiClient(config: { apiKey: string }): ApiClient {
  return {
    get: <T>(path: string) => request<T>(path, { method: 'GET' }),
    post: <T>(path: string, body?) => request<T>(path, { method: 'POST', body }),
    patch: <T>(path: string, body) => request<T>(path, { method: 'PATCH', body }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    upload: <T>(path: string, file: File) => { /* multipart */ },
  };
}

// Envelope unwrapping happens automatically:
// { success: true, data: T } → returns T
```

### React Query Hook Pattern

Every API entity has a corresponding hook file:

```typescript
// src/lib/hooks/use-agents.ts
export function useAgents({ projectId }) {
  return useQuery({
    queryKey: ['agents', projectId],
    queryFn: () => client.get(`/agents?projectId=${projectId}`),
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => client.post('/agents', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}
```

### All Dashboard Pages (29)

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Home | Global stats, pending approvals, recent projects |
| `/login` | Login | API key input |
| `/projects` | Projects List | Grid with search, filter, delete |
| `/projects/new` | New Project | Creation wizard (name, description, config) |
| `/projects/[id]` | Project Overview | Health dashboard, agent list, channels, config grid |
| `/projects/[id]/agents` | Agents List | Agent cards with status, pause/resume, test/configure |
| `/projects/[id]/agents/new` | Create Agent | 3-archetype wizard (Support/Copilot/Manager) → full config form |
| `/projects/[id]/agents/[agentId]` | Agent Detail | Full config with collapsible sections |
| `/projects/[id]/agents/[agentId]/chat` | Test Chat | WebSocket real-time chat with tool call display |
| `/projects/[id]/agents/[agentId]/logs` | Agent Logs | Execution logs timeline |
| `/projects/[id]/copilot` | Copilot | Manager agent chat + sidebar (approvals, subagents, inbox) |
| `/projects/[id]/inbox` | Inbox | WhatsApp Web-style (session list + message detail) |
| `/projects/[id]/integrations` | Integrations | Channel setup wizard |
| `/projects/[id]/skills` | Skills | Catalog tab + project instances tab |
| `/projects/[id]/mcp-servers` | MCP Servers | Template catalog + project instances |
| `/projects/[id]/approvals` | Approvals | Approval queue (approve/reject) |
| `/projects/[id]/prompts` | Prompts | Layer editor (identity/instructions/safety) with Monaco |
| `/projects/[id]/costs` | Costs | Usage charts and breakdown |
| `/projects/[id]/traces` | Traces | Execution timeline with event detail |
| `/projects/[id]/knowledge` | Knowledge | CRUD for knowledge base entries |
| `/projects/[id]/files` | Files | File upload and management |
| `/projects/[id]/tasks` | Tasks | Scheduled tasks (view, approve, pause) |
| `/projects/[id]/webhooks` | Webhooks | Custom webhook endpoints |
| `/projects/[id]/secrets` | Secrets | Credential management (no plaintext shown) |
| `/projects/[id]/contacts` | Contacts | Contact list with tags, role, search |
| `/projects/[id]/catalog` | Catalog | Product catalog browser |
| `/approvals` | Global Approvals | All pending approvals across projects |
| `/settings` | Settings | App-level configuration |
| `/templates` | Templates | Agent templates library |

### Key Page Details

#### Create Agent Wizard (`agents/new/page.tsx`)

The agent creation flow:

1. **Choose Archetype** — 3 visual cards:
   - Customer Support (Headset icon) — pre-fills for customer-facing agent
   - Owner's Copilot (Briefcase icon) — pre-fills for dashboard + Slack copilot
   - Manager (Crown icon) — pre-fills for orchestration agent

2. **Basic Info** — Name, description (pre-filled from archetype)

3. **Channels** — Visual grid of channel cards (WhatsApp, Telegram, Slack, Dashboard Chat)
   - Toggle to select/deselect
   - Optional "Dual audience" mode (different behavior for owner vs customers)
   - Optional per-channel customization (instructions, tools per channel)

4. **Prompts** — Identity, Instructions, Safety (pre-filled from archetype)

5. **Advanced** (collapsible):
   - Model selection (provider + model + temperature)
   - Tool selection (checkbox grid with risk badges)
   - MCP server configuration
   - Escalation path (manager agent dropdown)
   - Limits (max turns, tokens/turn, budget/day)

6. **Create** — Submits to `POST /api/v1/agents`

#### Copilot Page (`copilot/page.tsx`)

Split layout:
- **Left panel (flex-1):** Chat interface with the manager agent (WebSocket)
  - Manager icon (Crown), streaming messages, tool calls visible
  - Empty state with CTA to create manager if none exists
- **Right sidebar (w-72):** Three sections:
  - Pending approvals count + link
  - Subagent list with status dots + quick chat buttons
  - Recent conversations preview

#### Inbox Page (`inbox/page.tsx`)

WhatsApp Web-style layout:
- **Left panel (w-1/3):** Session list with:
  - Search by contact name
  - Channel filter (All/WhatsApp/Telegram/Slack/Dashboard)
  - Status filter (All/Active/Closed)
  - Session rows: contact name, channel badge, time, preview, message count
- **Right panel (flex-1):** Message thread:
  - Messages: user (left/gray), bot (right/green)
  - Timestamps, tool call displays
  - Trace summary (token count, cost)

#### Test Chat Page (`agents/[agentId]/chat/page.tsx`)

Real-time WebSocket chat for testing:
- Message thread with user/bot messages
- Tool call displays (expandable, show input/output)
- Approval request indicators
- Streaming indicator (bouncing dots)
- Stats bar: Session ID, turn count, cost, connection status
- Clear chat button

### WebSocket Chat Hook

```typescript
// src/lib/hooks/use-websocket.ts
function useChat({ projectId, apiKey, autoConnect }) {
  return {
    state: 'connecting' | 'connected' | 'disconnected' | 'error',
    messages: ChatMessage[],
    sessionId: string | null,
    currentMessage: string,    // Streamed content being assembled
    isStreaming: boolean,
    usage: { costUsd: number },
    lastError: { code, message } | null,
    createSession: (agentId) => void,
    send: (message) => void,
    clearChat: () => void,
  };
}
```

### Design System

**Brand colors (CSS variables):**
- `brand-lime` — Primary action color (lime green)
- `lime-hover` — Hover state
- `lime-muted` — Light background
- `lime-border` — Border color
- `brand-dark` — Dark text

**Status colors:**
- Emerald (green) → success, active
- Amber (yellow) → warning, pending
- Red → error, critical
- Blue → info, links

**Layout components:**
- `DashboardLayout` — Sidebar + header wrapper
- `PageShell` — Title + description + actions header
- `CollapsibleSection` — Expandable content sections

### Zod Schemas (`src/lib/schemas.ts`)

The dashboard mirrors all backend types as Zod schemas:
- `ProjectSchema`, `AgentSchema`, `SessionSchema`, `MessageSchema`
- `CreateAgent`, `UpdateAgent`, `MCPServerConfigSchema`, etc.
- TypeScript types inferred: `type Agent = z.infer<typeof AgentSchema>`

This ensures frontend and backend stay in sync — any schema mismatch is caught at build time.

### Key Dependencies

```json
{
  "next": "16.1.6",
  "react": "19.2.3",
  "tailwindcss": "^4",
  "@tanstack/react-query": "^5.90.20",
  "react-hook-form": "^7.71.1",
  "@hookform/resolvers": "^5.2.2",
  "zod": "^4.3.6",
  "recharts": "^3.7.0",
  "@monaco-editor/react": "^4.7.0",
  "sonner": "^2.0.7",
  "lucide-react": "^0.563.0"
}
```
