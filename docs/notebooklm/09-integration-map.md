# Nexus Core — Integration Map & Improvement Areas

## How Subsystems Connect

This document maps the actual dependency graph between subsystems, showing how data flows at runtime and where integration points exist. Use this to understand what touches what, and where there are opportunities to make the system more powerful.

## Dependency Graph (Runtime)

```
main.ts (bootstrap)
  ├── PrismaClient (database.ts)
  ├── ToolRegistry ← all 28 tool factories injected with:
  │     ├── prisma (DB access)
  │     ├── secretService (credential decryption)
  │     ├── channelResolver (send messages)
  │     ├── fileService (file storage)
  │     ├── knowledgeService (semantic search)
  │     ├── memoryManager (agent memory)
  │     ├── agentRegistry (inter-agent ops)
  │     └── embeddingProvider (vector generation)
  ├── AgentRegistry ← prisma (reads Agent table)
  ├── MemoryManager ← prismaMemoryStore + embeddingProvider
  ├── PromptLayerManager ← prisma (reads PromptLayer table)
  ├── CostGuard ← prismaUsageStore
  ├── ApprovalGate ← prismaApprovalStore + telegramNotifier
  ├── InputSanitizer (stateless)
  ├── ChannelResolver ← prisma + secretService
  ├── InboundProcessor ← agentRegistry + channelResolver + sessionRepo + contactRepo + chatSetup
  ├── ProactiveMessenger ← BullMQ + channelResolver
  ├── MCPManager ← mcpClient + toolRegistry
  ├── TaskRunner ← BullMQ + taskExecutor
  ├── TaskExecutor ← prepareChatRun (reuses full agent pipeline)
  ├── SecretService ← prisma + SECRETS_ENCRYPTION_KEY
  ├── KnowledgeService ← prisma + embeddingProvider
  ├── FileService ← prisma + localStorage
  └── Fastify server
        ├── REST routes (all inject RouteDependencies)
        ├── WebSocket /chat/stream
        └── Channel webhook routes → InboundProcessor
```

## Message Lifecycle (Complete Flow)

```
1. WhatsApp user sends message
     ↓
2. WAHA/Meta forwards webhook to POST /api/v1/webhooks/channels/:provider/:projectId
     ↓
3. Channel webhook route → ChannelAdapter.parseInbound() → normalized InboundMessage
     ↓
4. InboundProcessor.process(message, projectId):
   a. ContactRepository.findOrCreate(phone/telegramId/slackId)
   b. SessionRepository.findActiveOrCreate(contactId, agentId)
   c. AgentRegistry.getDefaultForChannel(projectId, channel)
   d. ModeResolver.resolveMode(agent, channel, contact.role)
     ↓
5. prepareChatRun(projectId, agentId, sessionId, message):
   a. Load agent config from registry
   b. Apply mode overrides (prompts, tools, MCP)
   c. PromptBuilder builds 5-layer prompt
   d. SkillComposer merges skill instructions + tools
   e. MCPManager discovers external tools
   f. CostGuard.preCheck(budgetRemaining)
   g. MemoryManager.retrieve(query, context) → relevant memories
   h. InputSanitizer.sanitize(message)
     ↓
6. AgentRunner.run(chatRunConfig):
   a. For each turn (up to maxTurns):
      - Build messages array (system + history + memories + user)
      - CostGuard.preCheck()
      - LLMProvider.chat(messages, tools) → response
      - CostGuard.record(usage)
      - If tool_calls in response:
        - For each tool call:
          - ToolRegistry.resolve(toolId) → check RBAC
          - If high/critical risk → ApprovalGate.requestApproval()
          - Execute tool → result
          - Auto-store memory for worthy tools
        - Continue loop (LLM sees tool results)
      - If no tool_calls → final response
   b. MemoryManager.updateShortTerm(sessionMessages)
   c. ExecutionTrace saved to DB
     ↓
7. Response sent back via ChannelAdapter.send(to, message)
     ↓
8. WhatsApp user sees response
```

## Subsystem Integration Points

### Agent Runner ↔ Tool Registry
- Runner calls `toolRegistry.getToolsForAgent(allowedTools)` to build LLM's available tools
- Runner calls `toolRegistry.resolve(toolId, input, context)` to execute tools
- ToolRegistry enforces RBAC (checks `context.permissions.allowedTools`)
- If tool not in allowlist → `ToolNotAllowedError` (agent never sees the tool in the first place)

### Agent Runner ↔ Memory Manager
- At chat start: `memoryManager.retrieve(query, projectId, agentId)` → relevant long-term memories
- During execution: `memoryManager.addToContext(sessionMessages)` → context window fitting
- After execution: `autoStoreToolMemory(toolResult)` → persists facts from worthy tools
- Memory Manager uses `prismaMemoryStore.search()` with pgvector cosine similarity + temporal decay

### Agent Runner ↔ Cost Guard
- Before every LLM call: `costGuard.preCheck(estimatedCost)` → `BudgetExceededError` if over limit
- After every LLM call: `costGuard.record(actualUsage)` → saves to `UsageRecord` table
- Cost Guard checks both daily AND monthly budgets

### Agent Runner ↔ Approval Gate
- After tool resolution, if `tool.riskLevel === 'high' || 'critical'`:
  - Creates `ApprovalRequest` in DB
  - Sends Telegram notification
  - Returns `ApprovalRequiredError` → runner pauses, session status = `human_approval_pending`
- When approval comes in (via API/Telegram):
  - Session resumes, tool executes, runner continues

### Inbound Processor ↔ Channel System
- InboundProcessor is the glue between channels and the agent pipeline
- It resolves: contact → session → agent → mode → executes chat → sends response
- It handles errors with fallback messages via the same channel adapter

### MCP Manager ↔ Tool Registry
- MCPManager discovers tools from external MCP servers
- MCPToolAdapter wraps each MCP tool as an `ExecutableTool`
- Wrapped tools are registered in ToolRegistry alongside built-in tools
- The agent sees no difference between built-in and MCP tools

### Scheduling ↔ Agent Pipeline
- TaskExecutor reuses `prepareChatRun()` — same prompt, cost, memory setup as regular chat
- Tasks run in their own budget context (`budgetPerRunUsd`)
- Task results stored in `ScheduledTaskRun` with execution trace
- Tasks can trigger any tool the assigned agent has access to

### Skills ↔ Agent Config
- At chat time, `SkillComposer.compose(agentId, projectId)` fetches active skill instances
- Skill instructions are appended to the agent's system prompt
- Skill tools are added to the agent's allowedTools
- Skills don't override base config — they extend it

## Current Integration Gaps & Improvement Areas

### 1. Agent-to-Agent Communication (Partial)
**What exists:** `delegate-to-agent` tool, `AgentComms` EventEmitter, `list-project-agents` tool
**What's missing:**
- No conversation threading between agents (delegation is fire-and-forget with a single response)
- No way for a delegated agent to ask clarifying questions back to the delegator
- No shared context passing (delegated agent starts fresh, no access to delegator's conversation)
- Manager sees delegation results but can't provide real-time guidance during execution

**Improvement:** Add a `delegationContext` parameter that passes relevant conversation summary to the delegated agent. Consider a request-response pattern where the delegated agent can return intermediate results.

### 2. Memory Cross-Agent Visibility (Gap)
**What exists:** Each agent has its own memory namespace (filtered by agentId)
**What's missing:**
- Manager can't read other agents' stored memories (no cross-agent memory search)
- No "project-level" memory shared across all agents
- No memory deduplication (two agents might store contradictory facts about the same entity)

**Improvement:** Add a `projectMemory` scope alongside `agentMemory`. Manager tools should be able to query any agent's memory space. Add entity-level deduplication in `store-memory`.

### 3. Contact Intelligence (Minimal)
**What exists:** Contact CRUD with tags, role, basic metadata, language
**What's missing:**
- No conversation history aggregation per contact (across sessions)
- No contact scoring or engagement metrics
- No automatic tagging based on conversation content
- No contact segments or groups for campaign targeting
- No contact merge (same person on WhatsApp and Telegram = two contacts)

**Improvement:** Add a `contact-intelligence` service that aggregates conversation data, auto-tags based on topics, calculates engagement scores, and supports cross-channel contact merging.

### 4. Conversation Analytics (Missing)
**What exists:** Raw execution traces, session counts, message counts, cost tracking
**What's missing:**
- No sentiment analysis per conversation
- No topic clustering (what are customers asking about?)
- No resolution rate tracking (was the issue resolved?)
- No response quality metrics
- No conversation classification (support/sales/complaint/inquiry)
- No CSAT or satisfaction proxies

**Improvement:** Build an `analyze-conversations` tool for the manager that processes recent sessions, classifies them, and generates insights. This is listed in the roadmap but not implemented.

### 5. Knowledge Base Integration (Basic)
**What exists:** `knowledge-search` tool with pgvector, `KnowledgeService` with CRUD
**What's missing:**
- No automatic knowledge extraction from successful conversations
- No knowledge freshness tracking (entries may become outdated)
- No knowledge usage analytics (which entries are most helpful?)
- No document chunking pipeline (uploading a PDF doesn't auto-chunk into searchable entries)
- No web source monitoring (scrape a URL periodically and update knowledge)

**Improvement:** Add a knowledge pipeline: PDF/URL → chunk → embed → store. Add freshness metadata and auto-extraction from agent conversations.

### 6. Campaign System (Conceptual)
**What exists:** Proactive messenger (BullMQ queue), scheduled tasks, `send-channel-message` tool
**What's missing:**
- No campaign entity (define target audience, message template, schedule)
- No campaign tracking (delivered/read/responded)
- No template system for campaign messages
- No rate limiting per channel (WhatsApp limits outbound)
- No opt-out management
- No A/B testing for messages

**Improvement:** This is critical for Market Paper and similar clients. A `Campaign` model with status tracking, delivery queues, and template interpolation would tie together existing scheduling + proactive messaging + contact management.

### 7. Reporting & Export (Missing)
**What exists:** `get-operations-summary` and `get-agent-performance` tools (JSON output)
**What's missing:**
- No PDF/HTML report generation
- No scheduled reports (daily/weekly email to owner)
- No export to spreadsheet (CSV/Excel)
- No dashboard widgets for custom date ranges
- No comparison view (this week vs last week)

**Improvement:** Add a `generate-report` tool that creates formatted reports. Combine with scheduled tasks for automated weekly summaries sent via email.

### 8. Error Recovery (Partial)
**What exists:** LLM failover (primary → fallback provider), NexusError hierarchy, Result type
**What's missing:**
- No automatic session recovery after server restart (in-flight sessions are lost)
- No retry strategy for transient tool failures (e.g., HTTP timeout)
- No circuit breaker for repeatedly failing external services
- No dead letter queue for failed webhook deliveries
- No alerting when error rates spike

**Improvement:** Add retry policies per tool, circuit breaker pattern for external APIs, and a monitoring service that alerts on anomalies.

### 9. Multi-Tenant Isolation (Soft)
**What exists:** All queries filtered by `projectId`, separate agent allowlists
**What's missing:**
- No row-level security in PostgreSQL (relies on application-level filtering)
- No per-project rate limiting
- No resource quotas (storage, API calls, concurrent sessions)
- No project-level feature flags
- Shared Redis namespace (BullMQ queues not isolated per project)

**Improvement:** For shared hosting, add Redis key prefixes per project, per-project rate limiters, and PostgreSQL RLS policies.

### 10. Developer Experience (Good, Could Be Better)
**What exists:** scaffoldTool(), vitest, fixtures, test server helpers, branded types
**What's missing:**
- No E2E test that runs a full conversation through the API
- No load testing setup
- No dev CLI for common operations (create project, add tool, connect channel)
- No documentation beyond CLAUDE.md and the notebooklm docs
- No Swagger/OpenAPI spec auto-generation from Zod schemas

**Improvement:** Auto-generate OpenAPI from Zod route schemas. Add a `fomo-cli` for rapid project/agent setup. Add E2E test scenarios.

## Subsystem Maturity Matrix

| Subsystem | Implementation | Testing | Integration | Polish |
|-----------|---------------|---------|-------------|--------|
| Agent Runner | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★☆ |
| LLM Providers | ★★★★★ | ★★★☆☆ | ★★★★☆ | ★★★★☆ |
| Tool System | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ |
| Memory System | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★☆☆ |
| Prompt System | ★★★★★ | ★★★☆☆ | ★★★★☆ | ★★★★☆ |
| Cost Guard | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★☆ |
| Channel System | ★★★★☆ | ★★★☆☆ | ★★★★☆ | ★★★☆☆ |
| Security | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| Scheduling | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★☆☆ |
| MCP System | ★★★★☆ | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ |
| Skills System | ★★★★☆ | ★★☆☆☆ | ★★★☆☆ | ★★★☆☆ |
| Knowledge Base | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★☆☆☆ |
| Contact System | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★☆☆☆ |
| Webhooks | ★★★★☆ | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ |
| API Routes | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★☆ |
| Dashboard | ★★★★☆ | ☆☆☆☆☆ | ★★★★☆ | ★★★☆☆ |

**Legend:** ★ = maturity level (5 = complete, 1 = basic, 0 = missing)

## Highest-Impact Improvements (Prioritized)

1. **Campaign system** — Directly enables revenue (Market Paper, future clients). Ties together 4 existing subsystems.
2. **Conversation analytics** — Manager becomes truly intelligent. `analyze-conversations` tool transforms the copilot experience.
3. **Contact intelligence** — Auto-tagging, scoring, cross-channel merge. Foundation for campaigns and analytics.
4. **Knowledge pipeline** — PDF → chunk → embed. Dramatically reduces setup time for new projects.
5. **Cross-agent memory** — Manager needs visibility into what agents learn. Project-level shared memory.
6. **Report generation** — Automated PDF/email weekly summaries. Tangible deliverable for business owners.
7. **E2E test suite** — One full conversation flow test prevents regressions across the entire pipeline.
8. **Error recovery** — Retry policies + circuit breaker. Production reliability.
9. **OpenAPI auto-generation** — Better API documentation, enables code generation for clients.
10. **Dev CLI** — Faster development cycles for the Fomo team.
