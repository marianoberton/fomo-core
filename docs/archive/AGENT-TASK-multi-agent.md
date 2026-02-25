# AGENT-TASK: Multi-Agent System

**Módulo:** `src/agents/`
**Branch:** `feature/multi-agent`
**Prioridad:** ALTA

---

## Objetivo

Implementar el sistema Multi-Agent para que múltiples agentes corran en la misma instancia, cada uno con su configuración.

---

## Scope - Archivos a Crear

```
src/agents/
├── types.ts              # AgentConfig, AgentMessage, AgentLimits
├── agent-registry.ts     # Registry con cache
├── agent-comms.ts        # Comunicación inter-agente
├── index.ts              # Named exports

src/infrastructure/repositories/
├── agent-repository.ts   # CRUD en DB

src/api/routes/
├── agents.ts             # API REST para agents

prisma/schema.prisma      # Agregar modelo Agent
```

---

## 1. Schema Prisma (agregar a schema.prisma)

```prisma
model Agent {
  id          String   @id @default(cuid())
  projectId   String   @map("project_id")
  
  name        String
  description String?
  
  // Config
  promptConfig    Json    @map("prompt_config")     // identity, instructions, safety
  toolAllowlist   String[] @map("tool_allowlist")   // Allowed tool IDs
  mcpServers      Json?   @map("mcp_servers")       // MCP server configs
  channelConfig   Json?   @map("channel_config")    // Which channels this agent uses
  
  // Limits
  maxTurns            Int     @default(10) @map("max_turns")
  maxTokensPerTurn    Int     @default(4000) @map("max_tokens_per_turn")
  budgetPerDayUsd     Float   @default(10.0) @map("budget_per_day_usd")
  
  // Status
  status      String   @default("active")  // active, paused, disabled
  
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  project     Project  @relation(fields: [projectId], references: [id])
  sessions    Session[]
  
  @@unique([projectId, name])
  @@map("agents")
}
```

**IMPORTANTE:** Agregar `agentId` opcional a Session:
```prisma
model Session {
  // ... existing fields
  agentId     String?  @map("agent_id")
  agent       Agent?   @relation(fields: [agentId], references: [id])
}
```

---

## 2. Types (src/agents/types.ts)

```typescript
import type { PromptConfig } from '../prompts/types.js';

export interface AgentLimits {
  maxTurns: number;
  maxTokensPerTurn: number;
  budgetPerDayUsd: number;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ChannelConfig {
  allowedChannels: string[];  // 'whatsapp', 'telegram', 'slack'
  defaultChannel?: string;
}

export interface AgentConfig {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  promptConfig: PromptConfig;
  toolAllowlist: string[];
  mcpServers: MCPServerConfig[];
  channelConfig: ChannelConfig;
  limits: AgentLimits;
  status: 'active' | 'paused' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentInput {
  projectId: string;
  name: string;
  description?: string;
  promptConfig: PromptConfig;
  toolAllowlist?: string[];
  mcpServers?: MCPServerConfig[];
  channelConfig?: ChannelConfig;
  limits?: Partial<AgentLimits>;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  promptConfig?: PromptConfig;
  toolAllowlist?: string[];
  mcpServers?: MCPServerConfig[];
  channelConfig?: ChannelConfig;
  limits?: Partial<AgentLimits>;
  status?: 'active' | 'paused' | 'disabled';
}

// Inter-agent communication
export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  context?: Record<string, unknown>;
  replyToId?: string;
  createdAt: Date;
}

export interface AgentRepository {
  create(input: CreateAgentInput): Promise<AgentConfig>;
  findById(id: string): Promise<AgentConfig | null>;
  findByName(projectId: string, name: string): Promise<AgentConfig | null>;
  update(id: string, input: UpdateAgentInput): Promise<AgentConfig>;
  delete(id: string): Promise<void>;
  list(projectId: string): Promise<AgentConfig[]>;
  listActive(projectId: string): Promise<AgentConfig[]>;
}

export interface AgentRegistry {
  get(agentId: string): Promise<AgentConfig | null>;
  getByName(projectId: string, name: string): Promise<AgentConfig | null>;
  list(projectId: string): Promise<AgentConfig[]>;
  refresh(agentId: string): Promise<void>;
  invalidate(agentId: string): void;
}

export interface AgentComms {
  send(message: Omit<AgentMessage, 'id' | 'createdAt'>): Promise<string>;
  sendAndWait(message: Omit<AgentMessage, 'id' | 'createdAt'>, timeoutMs?: number): Promise<string>;
  subscribe(agentId: string, handler: (message: AgentMessage) => void): () => void;
}
```

---

## 3. Agent Repository (src/infrastructure/repositories/agent-repository.ts)

Implementar CRUD usando Prisma. Seguir el patrón de los otros repositorios:
- `createAgentRepository(deps: { db: PrismaClient, logger: Logger })`
- Mapear entre Prisma model y domain type
- Validar projectId existe

---

## 4. Agent Registry (src/agents/agent-registry.ts)

```typescript
import type { AgentConfig, AgentRegistry, AgentRepository } from './types.js';
import type { Logger } from 'pino';

interface RegistryDeps {
  agentRepository: AgentRepository;
  logger: Logger;
  cacheTtlMs?: number;  // Default: 60000 (1 min)
}

interface CacheEntry {
  config: AgentConfig;
  expiresAt: number;
}

export function createAgentRegistry(deps: RegistryDeps): AgentRegistry {
  const cache = new Map<string, CacheEntry>();
  const cacheTtlMs = deps.cacheTtlMs ?? 60000;
  
  function isValid(entry: CacheEntry | undefined): entry is CacheEntry {
    return entry !== undefined && entry.expiresAt > Date.now();
  }
  
  return {
    async get(agentId: string): Promise<AgentConfig | null> {
      const cached = cache.get(agentId);
      if (isValid(cached)) {
        return cached.config;
      }
      
      const config = await deps.agentRepository.findById(agentId);
      if (config) {
        cache.set(agentId, {
          config,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
      return config;
    },
    
    async getByName(projectId: string, name: string): Promise<AgentConfig | null> {
      // Check cache first
      for (const entry of cache.values()) {
        if (isValid(entry) && 
            entry.config.projectId === projectId && 
            entry.config.name === name) {
          return entry.config;
        }
      }
      
      const config = await deps.agentRepository.findByName(projectId, name);
      if (config) {
        cache.set(config.id, {
          config,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
      return config;
    },
    
    async list(projectId: string): Promise<AgentConfig[]> {
      return deps.agentRepository.list(projectId);
    },
    
    async refresh(agentId: string): Promise<void> {
      cache.delete(agentId);
      await this.get(agentId);
    },
    
    invalidate(agentId: string): void {
      cache.delete(agentId);
    },
  };
}
```

---

## 5. Agent Comms (src/agents/agent-comms.ts)

Comunicación inter-agente usando EventEmitter o Redis pub/sub.

```typescript
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { AgentMessage, AgentComms } from './types.js';
import type { Logger } from 'pino';

interface CommsDeps {
  logger: Logger;
}

export function createAgentComms(deps: CommsDeps): AgentComms {
  const emitter = new EventEmitter();
  const pendingReplies = new Map<string, {
    resolve: (content: string) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }>();
  
  return {
    async send(message): Promise<string> {
      const id = randomUUID();
      const fullMessage: AgentMessage = {
        ...message,
        id,
        createdAt: new Date(),
      };
      
      deps.logger.info({ 
        messageId: id,
        from: message.fromAgentId,
        to: message.toAgentId,
      }, 'Agent message sent');
      
      emitter.emit(`agent:${message.toAgentId}`, fullMessage);
      return id;
    },
    
    async sendAndWait(message, timeoutMs = 30000): Promise<string> {
      const id = await this.send(message);
      
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingReplies.delete(id);
          reject(new Error(`Agent response timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        
        pendingReplies.set(id, { resolve, reject, timeoutId });
        
        // Listen for reply
        const handler = (reply: AgentMessage) => {
          if (reply.replyToId === id) {
            const pending = pendingReplies.get(id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingReplies.delete(id);
              pending.resolve(reply.content);
            }
            emitter.off(`agent:${message.fromAgentId}`, handler);
          }
        };
        
        emitter.on(`agent:${message.fromAgentId}`, handler);
      });
    },
    
    subscribe(agentId, handler): () => void {
      emitter.on(`agent:${agentId}`, handler);
      return () => emitter.off(`agent:${agentId}`, handler);
    },
  };
}
```

---

## 6. API Routes (src/api/routes/agents.ts)

Endpoints:
- `GET /api/projects/:projectId/agents` - List agents
- `POST /api/projects/:projectId/agents` - Create agent
- `GET /api/projects/:projectId/agents/:agentId` - Get agent
- `PATCH /api/projects/:projectId/agents/:agentId` - Update agent
- `DELETE /api/projects/:projectId/agents/:agentId` - Delete agent
- `POST /api/projects/:projectId/agents/:agentId/message` - Send message to agent

Usar Zod para validar inputs.

---

## 7. Index Export (src/agents/index.ts)

```typescript
export * from './types.js';
export { createAgentRegistry } from './agent-registry.js';
export { createAgentComms } from './agent-comms.js';
```

---

## 8. Actualizar RouteDependencies

En `src/api/types.ts`, agregar:
```typescript
agentRepository: AgentRepository;
agentRegistry: AgentRegistry;
agentComms: AgentComms;
```

---

## 9. Tests

Crear tests para:
- `src/agents/agent-registry.test.ts` - Cache, get, invalidate
- `src/agents/agent-comms.test.ts` - Send, subscribe, sendAndWait timeout
- `src/infrastructure/repositories/agent-repository.test.ts` - CRUD

---

## Convenciones (de CLAUDE.md)

- Factory functions, no clases
- Named exports only
- `.js` extension en imports
- Zod validation en API inputs
- `import type` para type-only imports
- Escribir tests para cada módulo nuevo

---

## Checklist

- [ ] Agregar modelo Agent a prisma/schema.prisma
- [ ] Agregar agentId a Session
- [ ] Crear src/agents/types.ts
- [ ] Crear src/infrastructure/repositories/agent-repository.ts
- [ ] Crear src/agents/agent-registry.ts
- [ ] Crear src/agents/agent-comms.ts
- [ ] Crear src/agents/index.ts
- [ ] Crear src/api/routes/agents.ts
- [ ] Actualizar src/api/types.ts (RouteDependencies)
- [ ] Actualizar src/api/routes/index.ts
- [ ] Actualizar src/infrastructure/repositories/index.ts
- [ ] Crear tests
- [ ] Correr npm test - todo verde
- [ ] Commit y push a feature/multi-agent

---

## Notas

Este módulo es la base para que FOMO-COS y otros agentes puedan correr en paralelo, cada uno con su personalidad, herramientas y límites.
