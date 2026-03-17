# fomo-agent Skill

OpenClaw skill that allows the Manager agent to invoke fomo-core specialized agents (Elena, Mateo, Nadia, etc.) via HTTP.

## How it works

```
OpenClaw Manager ──(skill call)──► fomo-agent skill ──(HTTP POST)──► fomo-core /api/v1/agents/:agentId/invoke
```

The Manager decides which agent should handle a task, then calls this skill with the agent ID and message. The skill POSTs to fomo-core's invoke endpoint and returns the agent's response.

## Setup in OpenClaw

### 1. Environment variables

Add these to your OpenClaw Manager instance:

```env
FOMO_CORE_API_URL=http://localhost:3002
FOMO_CORE_API_KEY=your-fomo-core-api-key
```

### 2. Register the skill

In your OpenClaw `AGENTS.md` or skill configuration, register the skill:

```yaml
skills:
  - id: fomo-agent
    name: Invoke FOMO Agent
    description: |
      Delegates a task to a specialized FOMO agent (e.g., Elena for sales,
      Mateo for customer support). Use this when a task requires a specialist.
    input:
      agentId: string    # ID of the fomo-core agent to invoke
      message: string    # The task or message for the agent
      sessionId?: string # Optional — continue an existing conversation
    output:
      response: string   # The agent's text response
      sessionId: string  # Session ID for follow-ups
      traceId: string    # Trace ID for observability
```

### 3. Usage in code

```typescript
import { createFomoAgentSkill } from './skill.js';

const skill = createFomoAgentSkill({
  fomoCorBaseUrl: process.env.FOMO_CORE_API_URL,
  fomoApiKey: process.env.FOMO_CORE_API_KEY,
  timeoutMs: 60_000,
});

// Invoke a specialized agent
const result = await skill.invoke({
  agentId: 'agent_elena_sales',
  message: 'Qualify this lead: Juan Perez, juan@acme.com, interested in Plan Enterprise',
  sourceChannel: 'openclaw',
});

console.log(result.response);
// → "Lead qualified: Juan Perez is a high-priority prospect..."
```

## Authentication

The skill authenticates with fomo-core using a Bearer token (`FOMO_CORE_API_KEY`). This key must be a valid API key registered in fomo-core — either the master `NEXUS_API_KEY` or a project-scoped key created via `POST /api/v1/api-keys`.

## Available agents

| Agent | Specialty | Model |
|-------|-----------|-------|
| Elena | Sales / Lead qualification | MiniMax |
| Mateo | Customer support | Kimi |
| Nadia | Operations | Qwen |
| Franco | General tasks | Qwen Flash |
| Marcos | General tasks | Qwen Flash |

Agent IDs are project-specific. Query `GET /api/v1/projects/:projectId/agents` to list available agents.
