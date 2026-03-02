# Nexus Core — Source: Tools (Part 2 — Integration/Orchestration/Monitoring/Vertical)

Complete source code for remaining tools.

---
## src/tools/definitions/http-request.ts
```typescript
/**
 * HTTP request tool — make HTTP requests to external APIs.
 *
 * Includes SSRF protection (blocks private/reserved IP ranges),
 * URL validation, response size limits, and timeout support.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'http-request' });

const MAX_RESPONSE_SIZE = 1_048_576; // 1MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

export interface HttpRequestToolOptions {
  /** Glob-like URL patterns to allow. If set, only matching URLs are permitted. */
  allowedUrlPatterns?: string[];
}

const methodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const inputSchema = z.object({
  url: z.string().url(),
  method: methodSchema,
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().default(DEFAULT_TIMEOUT_MS),
});

const outputSchema = z.object({
  status: z.number(),
  headers: z.record(z.string()),
  body: z.unknown(),
  durationMs: z.number(),
});

// ─── SSRF Protection ───────────────────────────────────────────

/**
 * Block private, reserved, and loopback IP ranges.
 * Checks both IPv4 and IPv6 patterns.
 */
const BLOCKED_IPV4_PREFIXES = [
  '10.',          // 10.0.0.0/8
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.', // 172.16.0.0/12
  '192.168.',     // 192.168.0.0/16
  '127.',         // 127.0.0.0/8 (loopback)
  '169.254.',     // 169.254.0.0/16 (link-local)
  '0.',           // 0.0.0.0/8
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  '0.0.0.0',
  '[::1]',
  '[::0]',
  '[0:0:0:0:0:0:0:0]',
  '[0:0:0:0:0:0:0:1]',
];

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Check exact blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(lower)) return true;

  // Check IPv4 prefixes
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }

  // Check IPv6 private ranges (fc00::/7 = ULA, fe80::/10 = link-local)
  if (lower.startsWith('[fc') || lower.startsWith('[fd')) return true;
  if (lower.startsWith('[fe8') || lower.startsWith('[fe9') || lower.startsWith('[fea') || lower.startsWith('[feb')) return true;

  return false;
}

function validateUrl(urlStr: string, allowedPatterns?: string[]): URL {
  const parsed = new URL(urlStr);

  // Only HTTP(S) allowed
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  // SSRF check
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Blocked host: requests to private/reserved IPs are not allowed`);
  }

  // URL allowlist check
  if (allowedPatterns && allowedPatterns.length > 0) {
    const matches = allowedPatterns.some((pattern) => matchUrlPattern(urlStr, pattern));
    if (!matches) {
      throw new Error(`URL not in allowlist: ${urlStr}`);
    }
  }

  return parsed;
}

/** Simple URL pattern matching: supports * as wildcard. */
function matchUrlPattern(url: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return regex.test(url);
}

/** Strip sensitive headers for logging. */
function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie') {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create an HTTP request tool for making external API calls. */
export function createHttpRequestTool(options?: HttpRequestToolOptions): ExecutableTool {
  const allowedPatterns = options?.allowedUrlPatterns;

  return {
    id: 'http-request',
    name: 'HTTP Request',
    description:
      'Make HTTP requests to external APIs. Supports GET, POST, PUT, PATCH, DELETE methods. ' +
      'Includes SSRF protection (blocks private IPs) and response size limits (1MB). ' +
      'Returns status code, headers, and response body.',
    category: 'integration',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // Validate URL + SSRF check
        validateUrl(parsed.url, allowedPatterns);

        // Build fetch options
        const fetchOptions: RequestInit = {
          method: parsed.method,
          headers: parsed.headers,
          signal: AbortSignal.any([
                context.abortSignal,
                AbortSignal.timeout(parsed.timeout),
              ]),
        };

        if (parsed.body !== undefined && parsed.method !== 'GET') {
          fetchOptions.body = typeof parsed.body === 'string'
            ? parsed.body
            : JSON.stringify(parsed.body);
        }

        logger.info('Making HTTP request', {
          component: 'http-request',
          projectId: context.projectId,
          traceId: context.traceId,
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers ? sanitizeHeadersForLog(parsed.headers) : undefined,
        });

        const response = await fetch(parsed.url, fetchOptions);

        // Read response with size limit
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        if (reader) {
          let done = false;
          while (!done) {
            const readResult = await reader.read();
            done = readResult.done;
            if (readResult.value) {
              totalSize += readResult.value.length;
              if (totalSize > MAX_RESPONSE_SIZE) {
                reader.cancel().catch(() => { /* intentionally ignored */ });
                throw new Error(`Response body exceeds ${String(MAX_RESPONSE_SIZE)} bytes limit`);
              }
              chunks.push(readResult.value);
            }
          }
        }

        const bodyBuffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          bodyBuffer.set(chunk, offset);
          offset += chunk.length;
        }
        const bodyText = new TextDecoder().decode(bodyBuffer);

        // Try to parse as JSON, fall back to text
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(bodyText) as unknown;
        } catch {
          responseBody = bodyText;
        }

        // Extract response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const durationMs = Date.now() - startTime;

        logger.info('HTTP request completed', {
          component: 'http-request',
          projectId: context.projectId,
          traceId: context.traceId,
          method: parsed.method,
          url: parsed.url,
          status: response.status,
          durationMs,
        });

        return ok({
          success: true,
          output: {
            status: response.status,
            headers: responseHeaders,
            body: responseBody,
            durationMs,
          },
          durationMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('HTTP request failed', {
          component: 'http-request',
          projectId: context.projectId,
          traceId: context.traceId,
          method: parsed.method,
          url: parsed.url,
          error: message,
        });
        return err(new ToolExecutionError('http-request', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      try {
        // Validate URL + SSRF check without making the request
        validateUrl(parsed.url, allowedPatterns);

        return Promise.resolve(ok({
          success: true,
          output: {
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers ?? {},
            hasBody: parsed.body !== undefined,
            timeout: parsed.timeout,
            dryRun: true,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('http-request', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/propose-scheduled-task.ts
```typescript
/**
 * propose-scheduled-task — internal tool for agents to propose scheduled tasks.
 *
 * Proposing is safe (riskLevel: 'low') — the proposed task requires human
 * approval before activation. This enforces the "agent proposes, human disposes" pattern.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { TaskManager } from '@/scheduling/task-manager.js';

const inputSchema = z.object({
  name: z.string().min(1).max(100).describe('A short, descriptive name for the task'),
  description: z.string().max(500).optional().describe('Optional detailed description'),
  cronExpression: z.string().min(9).max(100).describe('Cron expression (5-field)'),
  taskMessage: z.string().min(1).max(2000).describe('The message/instruction the agent should execute'),
  suggestedDurationMinutes: z.number().int().min(1).max(120).optional().describe('Suggested max duration in minutes'),
});

const outputSchema = z.object({
  taskId: z.string(),
  name: z.string(),
  cronExpression: z.string(),
  status: z.string(),
  nextRuns: z.array(z.string()).optional(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ProposeScheduledTaskToolOptions {
  taskManager: TaskManager;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a tool that allows agents to propose scheduled tasks for human approval. */
export function createProposeScheduledTaskTool(
  options: ProposeScheduledTaskToolOptions,
): ExecutableTool {
  const { taskManager } = options;

  return {
    id: 'propose-scheduled-task',
    name: 'Propose Scheduled Task',
    description:
      'Proposes a new scheduled task for human review. The task will NOT execute until ' +
      'a human approves it. Use this when the user needs recurring automated actions.',
    category: 'scheduling',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      return taskManager
        .proposeTask({
          projectId: context.projectId,
          name: parsed.name,
          description: parsed.description,
          cronExpression: parsed.cronExpression,
          taskPayload: {
            message: parsed.taskMessage,
          },
          origin: 'agent_proposed',
          proposedBy: `session:${context.sessionId}`,
          maxDurationMinutes: parsed.suggestedDurationMinutes,
        })
        .then((result) => {
          if (!result.ok) {
            return err(new ToolExecutionError(
              'propose-scheduled-task',
              result.error.message,
            ));
          }

          const task = result.value;

          // Also compute next runs for informational purposes
          const cronResult = taskManager.validateCron(task.cronExpression);
          const nextRuns = cronResult.ok
            ? cronResult.value.map((d) => d.toISOString())
            : undefined;

          return ok({
            success: true,
            output: {
              taskId: task.id,
              name: task.name,
              cronExpression: task.cronExpression,
              status: task.status,
              nextRuns,
            },
            durationMs: Date.now() - startTime,
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          return err(new ToolExecutionError('propose-scheduled-task', message));
        });
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      // Validate cron expression without creating anything
      const cronResult = taskManager.validateCron(parsed.cronExpression);
      if (!cronResult.ok) {
        return Promise.resolve(err(new ToolExecutionError(
          'propose-scheduled-task',
          cronResult.error.message,
        )));
      }

      const nextRuns = cronResult.value.map((d) => d.toISOString());

      return Promise.resolve(ok({
        success: true,
        output: {
          valid: true,
          name: parsed.name,
          cronExpression: parsed.cronExpression,
          nextRuns,
          dryRun: true,
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/delegate-to-agent.ts
```typescript
/**
 * Delegate-to-Agent tool — allows a manager agent to dispatch a task to a subagent.
 *
 * The manager LLM calls this tool with an agent name and task description.
 * The tool runs the target subagent's full agent loop and returns its response.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'delegate-to-agent' });

const inputSchema = z.object({
  agentName: z
    .string()
    .min(1)
    .describe('The name of the subagent to delegate this task to.'),
  task: z
    .string()
    .min(1)
    .describe('A clear description of the task for the subagent to complete.'),
  context: z
    .string()
    .optional()
    .describe(
      'Optional background context or data the subagent needs to complete the task.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .optional()
    .default(60_000)
    .describe('Maximum time to wait for the subagent, in milliseconds.'),
});

const outputSchema = z.object({
  agentName: z.string(),
  response: z.string(),
  success: z.boolean(),
});

/**
 * Function that runs a subagent and returns its text response.
 * Implemented in main.ts and injected at startup.
 */
export type RunSubAgentFn = (params: {
  projectId: string;
  agentName: string;
  task: string;
  context?: string;
  timeoutMs?: number;
}) => Promise<{ response: string }>;

/** Options for createDelegateToAgentTool. */
export interface DelegateToAgentToolOptions {
  /** Registry used in dryRun to validate the agent exists. */
  agentRegistry: AgentRegistry;
  /** Factory that runs the subagent loop and returns its response. */
  runSubAgent: RunSubAgentFn;
}

/**
 * Create the delegate-to-agent tool.
 *
 * Allows a manager agent to dispatch a task to a specialized subagent and receive
 * its response. The subagent runs its full agent loop (with its own tools, prompts,
 * and session) and returns the final assistant text.
 */
export function createDelegateToAgentTool(
  options: DelegateToAgentToolOptions,
): ExecutableTool {
  const { agentRegistry, runSubAgent } = options;

  return {
    id: 'delegate-to-agent',
    name: 'Delegate to Agent',
    description:
      'Delegate a task to a specialized subagent and receive their response. ' +
      'Use this to route specialized work (e.g. "resolve this sales query", ' +
      '"check stock for product X", "score this lead") to the appropriate agent. ' +
      'The subagent runs its full capabilities and returns a result.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        agentName: string;
        task: string;
        context?: string;
        timeoutMs: number;
      };

      logger.info('Delegating task to subagent', {
        component: 'delegate-to-agent',
        projectId: context.projectId,
        traceId: context.traceId,
        agentName: data.agentName,
        taskPreview: data.task.slice(0, 80),
      });

      try {
        const result = await runSubAgent({
          projectId: context.projectId,
          agentName: data.agentName,
          task: data.task,
          context: data.context,
          timeoutMs: data.timeoutMs,
        });

        logger.info('Subagent delegation completed', {
          component: 'delegate-to-agent',
          projectId: context.projectId,
          traceId: context.traceId,
          agentName: data.agentName,
          durationMs: Date.now() - startTime,
        });

        return ok({
          success: true,
          output: {
            agentName: data.agentName,
            response: result.response,
            success: true,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Subagent delegation failed', {
          component: 'delegate-to-agent',
          projectId: context.projectId,
          traceId: context.traceId,
          agentName: data.agentName,
          error: message,
        });
        // Return structured failure — the manager LLM decides how to handle it.
        return ok({
          success: false,
          output: {
            agentName: data.agentName,
            response: '',
            success: false,
          },
          error: message,
          durationMs: Date.now() - startTime,
        });
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const data = inputSchema.parse(input) as {
        agentName: string;
        task: string;
        context?: string;
        timeoutMs: number;
      };

      // Validate the target agent exists without running it
      const agent = await agentRegistry.getByName(context.projectId, data.agentName);
      if (!agent) {
        return ok({
          success: false,
          output: {
            agentName: data.agentName,
            response: '',
            success: false,
          },
          error: `Agent "${data.agentName}" not found in project`,
          durationMs: 0,
        });
      }

      return ok({
        success: true,
        output: {
          agentName: data.agentName,
          response: '[dry-run] Task would be delegated to agent',
          success: true,
          dryRun: true,
        },
        durationMs: 0,
      });
    },
  };
}
```

---
## src/tools/definitions/list-project-agents.ts
```typescript
/**
 * List-Project-Agents tool — returns all agents in the current project.
 *
 * Used by the manager agent to discover which subagents are available
 * before deciding how to delegate a task.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'list-project-agents' });

const inputSchema = z.object({});

const outputSchema = z.object({
  agents: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      operatingMode: z.string(),
      status: z.string(),
      toolCount: z.number(),
    }),
  ),
});

/** Options for createListProjectAgentsTool. */
export interface ListProjectAgentsToolOptions {
  agentRegistry: AgentRegistry;
}

/**
 * Create the list-project-agents tool.
 *
 * Returns the name, description, operating mode, and status of every agent
 * in the current project. Intended for manager agents that need to know
 * which subagents to delegate work to.
 */
export function createListProjectAgentsTool(
  options: ListProjectAgentsToolOptions,
): ExecutableTool {
  const { agentRegistry } = options;

  return {
    id: 'list-project-agents',
    name: 'List Project Agents',
    description:
      'List all agents in this project with their names, descriptions, and current status. ' +
      'Use this to discover which specialized agents are available before delegating tasks.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void input;
      logger.info('Listing project agents', {
        component: 'list-project-agents',
        projectId: context.projectId,
      });

      const agents = await agentRegistry.list(context.projectId);

      return ok({
        success: true,
        output: {
          agents: agents.map((a) => ({
            name: a.name,
            description: a.description,
            operatingMode: a.operatingMode,
            status: a.status,
            toolCount: a.toolAllowlist.length,
          })),
        },
        durationMs: 0,
      });
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}
```

---
## src/tools/definitions/get-operations-summary.ts
```typescript
/**
 * Get Operations Summary Tool — aggregate overview of the entire project.
 * Returns agent statuses, session counts, message volumes, pending approvals,
 * costs, and recent escalations.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({});

const outputSchema = z.object({
  agents: z.object({
    total: z.number(),
    active: z.number(),
    paused: z.number(),
    disabled: z.number(),
    list: z.array(z.object({
      name: z.string(),
      status: z.string(),
      operatingMode: z.string(),
      activeSessions: z.number(),
    })),
  }),
  sessions: z.object({
    active: z.number(),
    total: z.number(),
  }),
  messages: z.object({
    today: z.number(),
    thisWeek: z.number(),
  }),
  approvals: z.object({
    pending: z.number(),
  }),
  cost: z.object({
    todayUsd: z.number(),
    thisWeekUsd: z.number(),
  }),
  escalations: z.object({
    recent: z.array(z.object({
      sessionId: z.string(),
      toolId: z.string(),
      status: z.string(),
      requestedAt: z.string(),
    })),
    totalPending: z.number(),
  }),
});

// ─── Options ────────────────────────────────────────────────────

/** Dependencies for the get-operations-summary tool. */
export interface GetOperationsSummaryToolOptions {
  prisma: PrismaClient;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Get start of today (UTC). */
function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Get start of this week (Monday, UTC). */
function startOfThisWeek(): Date {
  const today = startOfToday();
  const day = today.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
  today.setUTCDate(today.getUTCDate() - diff);
  return today;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a get-operations-summary tool for project-wide operational overview. */
export function createGetOperationsSummaryTool(
  options: GetOperationsSummaryToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'get-operations-summary',
    name: 'Get Operations Summary',
    description:
      'Get a high-level overview of the entire project: active agents, session counts, message volumes, pending approvals, costs, and recent escalations. Use this for daily reports and status checks.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      inputSchema.parse(input);
      const projectId = context.projectId as string;

      try {
        const todayStart = startOfToday();
        const weekStart = startOfThisWeek();

        // 1. Agents
        const agents = await prisma.agent.findMany({
          where: { projectId },
          select: { id: true, name: true, status: true, operatingMode: true },
        });

        // 2. Active sessions grouped by agent
        const sessionCounts = await prisma.session.groupBy({
          by: ['agentId'],
          where: { projectId, status: 'active', agentId: { not: null } },
          _count: true,
        });
        const sessionCountMap = new Map(
          sessionCounts.map((s) => [s.agentId, s._count]),
        );

        const agentList = agents.map((a) => ({
          name: a.name,
          status: a.status,
          operatingMode: a.operatingMode,
          activeSessions: sessionCountMap.get(a.id) ?? 0,
        }));

        const activeCount = agents.filter((a) => a.status === 'active').length;
        const pausedCount = agents.filter((a) => a.status === 'paused').length;
        const disabledCount = agents.filter((a) => a.status === 'disabled').length;

        // 3. Sessions
        const [activeSessions, totalSessions] = await Promise.all([
          prisma.session.count({ where: { projectId, status: 'active' } }),
          prisma.session.count({ where: { projectId } }),
        ]);

        // 4. Messages today/week
        const [messagesToday, messagesThisWeek] = await Promise.all([
          prisma.message.count({
            where: { session: { projectId }, createdAt: { gte: todayStart } },
          }),
          prisma.message.count({
            where: { session: { projectId }, createdAt: { gte: weekStart } },
          }),
        ]);

        // 5. Pending approvals
        const pendingApprovals = await prisma.approvalRequest.count({
          where: { projectId, status: 'pending' },
        });

        // 6. Cost today/week
        const [costToday, costThisWeek] = await Promise.all([
          prisma.usageRecord.aggregate({
            where: { projectId, timestamp: { gte: todayStart } },
            _sum: { costUsd: true },
          }),
          prisma.usageRecord.aggregate({
            where: { projectId, timestamp: { gte: weekStart } },
            _sum: { costUsd: true },
          }),
        ]);

        // 7. Recent escalations
        const recentEscalations = await prisma.approvalRequest.findMany({
          where: { projectId, toolId: 'escalate-to-human' },
          orderBy: { requestedAt: 'desc' },
          take: 10,
          select: { sessionId: true, toolId: true, status: true, requestedAt: true },
        });

        const pendingEscalations = recentEscalations.filter(
          (e) => e.status === 'pending',
        ).length;

        const output = {
          agents: {
            total: agents.length,
            active: activeCount,
            paused: pausedCount,
            disabled: disabledCount,
            list: agentList,
          },
          sessions: {
            active: activeSessions,
            total: totalSessions,
          },
          messages: {
            today: messagesToday,
            thisWeek: messagesThisWeek,
          },
          approvals: {
            pending: pendingApprovals,
          },
          cost: {
            todayUsd: costToday._sum.costUsd ?? 0,
            thisWeekUsd: costThisWeek._sum.costUsd ?? 0,
          },
          escalations: {
            recent: recentEscalations.map((e) => ({
              sessionId: e.sessionId,
              toolId: e.toolId,
              status: e.status,
              requestedAt: e.requestedAt.toISOString(),
            })),
            totalPending: pendingEscalations,
          },
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'get-operations-summary',
          error instanceof Error ? error.message : 'Unknown error querying operations summary',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      inputSchema.parse(input);

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: 'Would query operations summary for the project',
          sections: ['agents', 'sessions', 'messages', 'approvals', 'cost', 'escalations'],
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
```

---
## src/tools/definitions/get-agent-performance.ts
```typescript
/**
 * Get Agent Performance Tool — detailed metrics for a specific agent.
 * Returns sessions handled, message counts, tool call success rates,
 * costs, and escalation counts over a configurable time range.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  agentName: z.string().min(1)
    .describe('The name of the agent to get performance metrics for.'),
  timeRange: z.enum(['today', 'week', 'month', 'custom']).default('week')
    .describe('Time range for the metrics. Default: week.'),
  customStartDate: z.string().optional()
    .describe('ISO 8601 date string for custom range start (required if timeRange is "custom").'),
  customEndDate: z.string().optional()
    .describe('ISO 8601 date string for custom range end (required if timeRange is "custom").'),
});

const outputSchema = z.object({
  agentName: z.string(),
  agentId: z.string(),
  operatingMode: z.string(),
  status: z.string(),
  timeRange: z.object({
    label: z.string(),
    start: z.string(),
    end: z.string(),
  }),
  sessions: z.object({
    total: z.number(),
    active: z.number(),
    closed: z.number(),
  }),
  messages: z.object({
    total: z.number(),
    fromUser: z.number(),
    fromAssistant: z.number(),
  }),
  toolCalls: z.object({
    total: z.number(),
    successful: z.number(),
    failed: z.number(),
    byTool: z.array(z.object({
      toolName: z.string(),
      count: z.number(),
    })),
  }),
  cost: z.object({
    totalUsd: z.number(),
    avgPerSessionUsd: z.number(),
  }),
  escalations: z.number(),
});

// ─── Options ────────────────────────────────────────────────────

/** Dependencies for the get-agent-performance tool. */
export interface GetAgentPerformanceToolOptions {
  prisma: PrismaClient;
  agentRegistry: AgentRegistry;
}

// ─── Helpers ────────────────────────────────────────────────────

interface TimeRange {
  label: string;
  start: Date;
  end: Date;
}

/** Resolve a named time range to concrete dates. */
function resolveTimeRange(
  range: 'today' | 'week' | 'month' | 'custom',
  customStart?: string,
  customEnd?: string,
): TimeRange {
  const now = new Date();

  switch (range) {
    case 'today': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { start, end: now, label: 'Today' };
    }
    case 'week': {
      const start = new Date(now.getTime() - 7 * 86_400_000);
      return { start, end: now, label: 'Last 7 days' };
    }
    case 'month': {
      const start = new Date(now.getTime() - 30 * 86_400_000);
      return { start, end: now, label: 'Last 30 days' };
    }
    case 'custom': {
      const start = customStart ? new Date(customStart) : new Date(now.getTime() - 7 * 86_400_000);
      const end = customEnd ? new Date(customEnd) : now;
      return {
        start,
        end,
        label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
      };
    }
  }
}

/** Trace event shape from ExecutionTrace.events JSON. */
interface TraceEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a get-agent-performance tool for per-agent metrics analysis. */
export function createGetAgentPerformanceTool(
  options: GetAgentPerformanceToolOptions,
): ExecutableTool {
  const { prisma, agentRegistry } = options;

  return {
    id: 'get-agent-performance',
    name: 'Get Agent Performance',
    description:
      'Get detailed performance metrics for a specific agent: sessions handled, messages processed, tool call success rates, costs, and escalation counts over a time range.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        agentName: string;
        timeRange: 'today' | 'week' | 'month' | 'custom';
        customStartDate?: string;
        customEndDate?: string;
      };
      const projectId = context.projectId as string;

      try {
        // 1. Resolve agent
        const agent = await agentRegistry.getByName(projectId, data.agentName);
        if (!agent) {
          return err(new ToolExecutionError(
            'get-agent-performance',
            `Agent "${data.agentName}" not found in project`,
          ));
        }

        const range = resolveTimeRange(data.timeRange, data.customStartDate, data.customEndDate);
        const agentId = agent.id as string;

        // 2. Sessions in range
        const sessions = await prisma.session.findMany({
          where: {
            projectId,
            agentId,
            createdAt: { gte: range.start, lte: range.end },
          },
          select: { id: true, status: true },
        });

        const sessionIds = sessions.map((s) => s.id);
        const activeSessions = sessions.filter((s) => s.status === 'active').length;
        const closedSessions = sessions.filter((s) => s.status === 'closed').length;

        // 3. Messages (grouped by role)
        let userMessages = 0;
        let assistantMessages = 0;

        if (sessionIds.length > 0) {
          const msgGroups = await prisma.message.groupBy({
            by: ['role'],
            where: { sessionId: { in: sessionIds } },
            _count: true,
          });

          for (const group of msgGroups) {
            if (group.role === 'user') userMessages = group._count;
            else if (group.role === 'assistant') assistantMessages = group._count;
          }
        }

        // 4. Execution traces — parse tool calls from events JSON
        let totalToolCalls = 0;
        let successfulToolCalls = 0;
        let failedToolCalls = 0;
        const toolCallCounts = new Map<string, number>();

        if (sessionIds.length > 0) {
          const traces = await prisma.executionTrace.findMany({
            where: { sessionId: { in: sessionIds } },
            select: { events: true },
          });

          for (const trace of traces) {
            const events = trace.events as unknown as TraceEvent[];
            if (!Array.isArray(events)) continue;

            for (const event of events) {
              if (event.type === 'tool_call') {
                totalToolCalls++;
                const toolId = event.data['toolId'] as string | undefined;
                if (toolId) {
                  toolCallCounts.set(toolId, (toolCallCounts.get(toolId) ?? 0) + 1);
                }
              }
              if (event.type === 'tool_result') {
                const success = event.data['success'];
                if (success === false) failedToolCalls++;
                else successfulToolCalls++;
              }
            }
          }
        }

        const byTool = Array.from(toolCallCounts.entries())
          .map(([toolName, count]) => ({ toolName, count }))
          .sort((a, b) => b.count - a.count);

        // 5. Cost
        let totalCostUsd = 0;
        if (sessionIds.length > 0) {
          const costResult = await prisma.usageRecord.aggregate({
            where: { sessionId: { in: sessionIds } },
            _sum: { costUsd: true },
          });
          totalCostUsd = costResult._sum.costUsd ?? 0;
        }

        const avgPerSession = sessionIds.length > 0
          ? totalCostUsd / sessionIds.length
          : 0;

        // 6. Escalations
        let escalationCount = 0;
        if (sessionIds.length > 0) {
          escalationCount = await prisma.approvalRequest.count({
            where: { sessionId: { in: sessionIds }, toolId: 'escalate-to-human' },
          });
        }

        const output = {
          agentName: agent.name,
          agentId: agentId,
          operatingMode: agent.operatingMode,
          status: agent.status,
          timeRange: {
            label: range.label,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          },
          sessions: {
            total: sessionIds.length,
            active: activeSessions,
            closed: closedSessions,
          },
          messages: {
            total: userMessages + assistantMessages,
            fromUser: userMessages,
            fromAssistant: assistantMessages,
          },
          toolCalls: {
            total: totalToolCalls,
            successful: successfulToolCalls,
            failed: failedToolCalls,
            byTool,
          },
          cost: {
            totalUsd: Math.round(totalCostUsd * 10000) / 10000,
            avgPerSessionUsd: Math.round(avgPerSession * 10000) / 10000,
          },
          escalations: escalationCount,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'get-agent-performance',
          error instanceof Error ? error.message : 'Unknown error querying agent performance',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        agentName: string;
        timeRange: 'today' | 'week' | 'month' | 'custom';
        customStartDate?: string;
        customEndDate?: string;
      };

      const range = resolveTimeRange(data.timeRange, data.customStartDate, data.customEndDate);

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would query performance metrics for agent "${data.agentName}"`,
          timeRange: range.label,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
```

---
## src/tools/definitions/review-agent-activity.ts
```typescript
/**
 * Review Agent Activity Tool — recent activity feed for a specific agent.
 * Returns last sessions, tool executions with previews, and errors.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  agentName: z.string().min(1)
    .describe('The name of the agent to review recent activity for.'),
  limit: z.number().int().min(1).max(50).default(20)
    .describe('Maximum number of recent items to return. Default: 20.'),
});

const outputSchema = z.object({
  agentName: z.string(),
  agentId: z.string(),
  recentSessions: z.array(z.object({
    sessionId: z.string(),
    contactName: z.string().optional(),
    channel: z.string().optional(),
    status: z.string(),
    messageCount: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })),
  recentToolExecutions: z.array(z.object({
    traceId: z.string(),
    sessionId: z.string(),
    toolName: z.string(),
    success: z.boolean(),
    durationMs: z.number().optional(),
    timestamp: z.string(),
    inputPreview: z.string().optional(),
    outputPreview: z.string().optional(),
    error: z.string().optional(),
  })),
  errors: z.array(z.object({
    traceId: z.string(),
    sessionId: z.string(),
    type: z.string(),
    message: z.string(),
    timestamp: z.string(),
  })),
});

// ─── Options ────────────────────────────────────────────────────

/** Dependencies for the review-agent-activity tool. */
export interface ReviewAgentActivityToolOptions {
  prisma: PrismaClient;
  agentRegistry: AgentRegistry;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Trace event shape from ExecutionTrace.events JSON. */
interface TraceEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

/** Truncate a string to maxLen characters, appending '...' if trimmed. */
function truncate(value: unknown, maxLen: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a review-agent-activity tool for inspecting recent agent behavior. */
export function createReviewAgentActivityTool(
  options: ReviewAgentActivityToolOptions,
): ExecutableTool {
  const { prisma, agentRegistry } = options;

  return {
    id: 'review-agent-activity',
    name: 'Review Agent Activity',
    description:
      'Review an agent\'s recent activity: last sessions with contacts, tool executions with inputs/outputs, and any errors. Use this to investigate what an agent has been doing or debug issues.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const data = inputSchema.parse(input) as { agentName: string; limit: number };
      const projectId = context.projectId as string;

      try {
        // 1. Resolve agent
        const agent = await agentRegistry.getByName(projectId, data.agentName);
        if (!agent) {
          return err(new ToolExecutionError(
            'review-agent-activity',
            `Agent "${data.agentName}" not found in project`,
          ));
        }

        const agentId = agent.id as string;

        // 2. Recent sessions
        const sessions = await prisma.session.findMany({
          where: { projectId, agentId },
          orderBy: { updatedAt: 'desc' },
          take: data.limit,
          include: {
            _count: { select: { messages: true } },
            contact: { select: { name: true } },
          },
        });

        const recentSessions = sessions.map((s) => {
          const metadata = s.metadata as Record<string, unknown> | null;
          return {
            sessionId: s.id,
            contactName: (s.contact as { name: string } | null)?.name,
            channel: metadata?.['channel'] as string | undefined,
            status: s.status,
            messageCount: s._count.messages,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          };
        });

        // 3. Recent execution traces
        const sessionIds = sessions.map((s) => s.id);
        const toolExecutions: Array<{
          traceId: string;
          sessionId: string;
          toolName: string;
          success: boolean;
          durationMs?: number;
          timestamp: string;
          inputPreview?: string;
          outputPreview?: string;
          error?: string;
        }> = [];

        const errors: Array<{
          traceId: string;
          sessionId: string;
          type: string;
          message: string;
          timestamp: string;
        }> = [];

        if (sessionIds.length > 0) {
          const traces = await prisma.executionTrace.findMany({
            where: { sessionId: { in: sessionIds } },
            orderBy: { createdAt: 'desc' },
            take: data.limit,
            select: { id: true, sessionId: true, events: true, createdAt: true },
          });

          for (const trace of traces) {
            const events = trace.events as unknown as TraceEvent[];
            if (!Array.isArray(events)) continue;

            // Build a map of tool_call -> tool_result by toolCallId
            const resultMap = new Map<string, TraceEvent>();
            for (const event of events) {
              if (event.type === 'tool_result' && event.data['toolCallId']) {
                resultMap.set(event.data['toolCallId'] as string, event);
              }
            }

            for (const event of events) {
              if (event.type === 'tool_call') {
                const toolCallId = event.data['toolCallId'] as string | undefined;
                const resultEvent = toolCallId ? resultMap.get(toolCallId) : undefined;

                toolExecutions.push({
                  traceId: trace.id,
                  sessionId: trace.sessionId,
                  toolName: (event.data['toolId'] as string) ?? 'unknown',
                  success: resultEvent ? (resultEvent.data['success'] as boolean) !== false : true,
                  durationMs: resultEvent?.data['durationMs'] as number | undefined,
                  timestamp: event.timestamp ?? trace.createdAt.toISOString(),
                  inputPreview: truncate(event.data['input'], 200),
                  outputPreview: resultEvent ? truncate(resultEvent.data['output'], 200) : undefined,
                  error: resultEvent?.data['error'] as string | undefined,
                });
              }

              if (event.type === 'error') {
                errors.push({
                  traceId: trace.id,
                  sessionId: trace.sessionId,
                  type: 'error',
                  message: (event.data['message'] as string) ?? 'Unknown error',
                  timestamp: event.timestamp ?? trace.createdAt.toISOString(),
                });
              }
            }
          }
        }

        // Trim to limit
        toolExecutions.splice(data.limit);
        errors.splice(data.limit);

        const output = {
          agentName: agent.name,
          agentId,
          recentSessions,
          recentToolExecutions: toolExecutions,
          errors,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'review-agent-activity',
          error instanceof Error ? error.message : 'Unknown error reviewing agent activity',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as { agentName: string; limit: number };

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would review recent activity for agent "${data.agentName}"`,
          limit: data.limit,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
```

---
## src/tools/definitions/query-sessions.ts
```typescript
/**
 * Query Sessions Tool — lists sessions with optional filtering.
 * Intended for "internal" mode so the agent can review customer conversations.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext, ProjectId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().min(1).optional()
    .describe('Filter by contact ID'),
  contactName: z.string().min(1).optional()
    .describe('Search contacts by name (partial match)'),
  channel: z.string().min(1).optional()
    .describe('Filter by channel (e.g. "whatsapp", "telegram")'),
  status: z.enum(['active', 'closed', 'expired']).optional()
    .describe('Filter by session status (default: all)'),
  limit: z.number().int().min(1).max(50).optional()
    .describe('Maximum number of sessions to return (default: 20)'),
});

const outputSchema = z.object({
  sessions: z.array(z.object({
    sessionId: z.string(),
    contactId: z.string().optional(),
    contactName: z.string().optional(),
    channel: z.string().optional(),
    status: z.string(),
    messageCount: z.number(),
    lastMessageAt: z.string().optional(),
    createdAt: z.string(),
  })),
  total: z.number(),
});

// ─── Options ────────────────────────────────────────────────────

export interface QuerySessionsToolOptions {
  prisma: PrismaClient;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a query-sessions tool for browsing conversation sessions. */
export function createQuerySessionsTool(
  options: QuerySessionsToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'query-sessions',
    name: 'Query Sessions',
    description: 'Lists conversation sessions for the current project with optional filters (contact, channel, status). Use this to find and review customer conversations. Returns session summaries with message counts.',
    category: 'memory',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);
      const projectId = context.projectId as string;
      const limit = parsed.limit ?? 20;

      try {
        // Build where clause
        const where: Record<string, unknown> = { projectId };
        if (parsed.status) {
          where['status'] = parsed.status;
        }

        // Channel/contactId are stored in session metadata
        const sessions = await prisma.session.findMany({
          where: where as Parameters<typeof prisma.session.findMany>[0] extends { where?: infer W } ? W : never,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          include: {
            _count: { select: { messages: true } },
          },
        });

        // Post-filter by metadata fields and enrich with contact info
        const results: {
          sessionId: string;
          contactId?: string;
          contactName?: string;
          channel?: string;
          status: string;
          messageCount: number;
          lastMessageAt?: string;
          createdAt: string;
        }[] = [];

        for (const session of sessions) {
          const metadata = session.metadata as Record<string, unknown> | null;
          const sessionChannel = metadata?.['channel'] as string | undefined;
          const sessionContactId = metadata?.['contactId'] as string | undefined;

          // Apply channel filter
          if (parsed.channel && sessionChannel !== parsed.channel) continue;

          // Apply contactId filter
          if (parsed.contactId && sessionContactId !== parsed.contactId) continue;

          // Look up contact name if we have a contactId
          let contactName: string | undefined;
          if (sessionContactId) {
            const contact = await prisma.contact.findUnique({
              where: { id: sessionContactId },
              select: { name: true },
            });
            contactName = contact?.name;

            // Apply contactName filter (partial match)
            if (parsed.contactName && contactName && !contactName.toLowerCase().includes(parsed.contactName.toLowerCase())) {
              continue;
            }
            if (parsed.contactName && !contactName) continue;
          } else if (parsed.contactName) {
            continue; // No contact to match
          }

          // Get last message timestamp
          const lastMessage = await prisma.message.findFirst({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });

          results.push({
            sessionId: session.id,
            contactId: sessionContactId,
            contactName,
            channel: sessionChannel,
            status: session.status,
            messageCount: session._count.messages,
            lastMessageAt: lastMessage?.createdAt.toISOString(),
            createdAt: session.createdAt.toISOString(),
          });
        }

        const output = { sessions: results, total: results.length };

        return ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        return err(new ToolExecutionError(
          'query-sessions',
          error instanceof Error ? error.message : 'Unknown error querying sessions',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      return ok({
        success: true,
        output: {
          dryRun: true,
          description: 'Would query sessions',
          filters: {
            contactId: parsed.contactId,
            contactName: parsed.contactName,
            channel: parsed.channel,
            status: parsed.status,
            limit: parsed.limit ?? 20,
          },
        },
        durationMs: Date.now() - startTime,
      });
    },
  };
}
```

---
## src/tools/definitions/read-session-history.ts
```typescript
/**
 * Read Session History Tool — retrieves message history for a session.
 * Intended for "internal" mode so the agent can review a specific conversation.
 */
import { z } from 'zod';
import type { SessionId } from '@/core/types.js';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  sessionId: z.string().min(1)
    .describe('The session ID to read messages from'),
  limit: z.number().int().min(1).max(100).optional()
    .describe('Maximum number of messages to return (default: 50, from most recent)'),
});

const outputSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  contactId: z.string().optional(),
  channel: z.string().optional(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
    createdAt: z.string(),
  })),
  totalMessages: z.number(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ReadSessionHistoryToolOptions {
  sessionRepository: SessionRepository;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a read-session-history tool for reading conversation messages. */
export function createReadSessionHistoryTool(
  options: ReadSessionHistoryToolOptions,
): ExecutableTool {
  const { sessionRepository } = options;

  return {
    id: 'read-session-history',
    name: 'Read Session History',
    description: 'Reads the message history of a specific conversation session. Returns messages with role (user/assistant), content, and timestamps. Use query-sessions first to find the session ID.',
    category: 'memory',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);
      const limit = parsed.limit ?? 50;

      try {
        // Verify session exists and belongs to this project
        const session = await sessionRepository.findById(parsed.sessionId as SessionId);
        if (!session) {
          return err(new ToolExecutionError(
            'read-session-history',
            `Session "${parsed.sessionId}" not found`,
          ));
        }

        if (session.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'read-session-history',
            'Session does not belong to this project',
          ));
        }

        // Get all messages, then slice to limit (from the end for most recent)
        const allMessages = await sessionRepository.getMessages(parsed.sessionId as SessionId);
        const messages = allMessages.slice(-limit);

        const metadata = session.metadata as Record<string, unknown> | undefined;

        const output = {
          sessionId: session.id,
          status: session.status,
          contactId: metadata?.['contactId'] as string | undefined,
          channel: metadata?.['channel'] as string | undefined,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          })),
          totalMessages: allMessages.length,
        };

        return ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        return err(new ToolExecutionError(
          'read-session-history',
          error instanceof Error ? error.message : 'Unknown error reading session history',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      return ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would read up to ${parsed.limit ?? 50} messages from session "${parsed.sessionId}"`,
        },
        durationMs: Date.now() - startTime,
      });
    },
  };
}
```

---
## src/tools/definitions/catalog-search.ts
```typescript
/**
 * Catalog Search Tool
 * Searches for products/items in a catalog using semantic and keyword search.
 * Used for helping customers find products in inventory.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'catalog-search' });

// ─── Catalog Search Options ────────────────────────────────────

export interface CatalogSearchToolOptions {
  /** Custom catalog search provider. If not provided, uses mock data. */
  searchProvider?: (query: string, filters?: unknown) => Promise<unknown[]>;
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  query: z.string().min(1).max(500).describe('Search query - product name, category, features, or description'),
  filters: z.object({
    category: z.string().optional().describe('Filter by category (e.g., "sedan", "suv", "herramientas")'),
    minPrice: z.number().positive().optional().describe('Minimum price filter'),
    maxPrice: z.number().positive().optional().describe('Maximum price filter'),
    inStock: z.boolean().optional().describe('Filter to only show items in stock'),
    brand: z.string().optional().describe('Filter by brand or manufacturer'),
  }).optional().describe('Optional filters to narrow down search results'),
  limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of results to return (default: 5)'),
});

const outputSchema = z.object({
  results: z.array(z.object({
    id: z.string().describe('Product/item ID'),
    name: z.string().describe('Product name'),
    description: z.string().describe('Product description'),
    category: z.string().describe('Product category'),
    price: z.number().describe('Price in local currency'),
    currency: z.string().default('ARS').describe('Currency code'),
    inStock: z.boolean().describe('Whether the item is in stock'),
    quantity: z.number().optional().describe('Available quantity if in stock'),
    specifications: z.record(z.string(), z.unknown()).optional().describe('Product specifications'),
    imageUrl: z.string().url().optional().describe('Product image URL'),
    brand: z.string().optional().describe('Brand or manufacturer'),
  })),
  totalCount: z.number().describe('Total number of matching items in catalog'),
  searchTime: z.number().describe('Search execution time in milliseconds'),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createCatalogSearchTool(options: CatalogSearchToolOptions = {}): ExecutableTool {
  return {
    id: 'catalog-search',
    name: 'catalog_search',
    description: 'Search for products or services in the catalog. Use this to help customers find items, check availability, get pricing, and view specifications.',
    category: 'data',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    // ─── Execution ────────────────────────────────────────────────

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('catalog-search', 'Invalid input', parsed.error));
      }
      const validated = parsed.data;

      logger.debug('Executing catalog search', {
        component: 'catalog-search',
        projectId: context.projectId,
        sessionId: context.sessionId,
        query: validated.query,
        filters: validated.filters,
      });

      try {
        let results;
        
        if (options.searchProvider) {
          results = await options.searchProvider(validated.query, validated.filters);
        } else {
          // Default mock implementation
          results = [
            {
              id: 'DEMO-001',
              name: `Demo Product matching "${validated.query}"`,
              description: 'This is a placeholder. Configure your catalog in the project settings.',
              category: validated.filters?.category ?? 'general',
              price: 0,
              currency: 'ARS',
              inStock: true,
              quantity: 0,
              specifications: {},
            },
          ];
        }

        const searchTime = Date.now() - startTime;

        return ok({
          success: true,
          output: {
            results: results.slice(0, validated.limit),
            totalCount: results.length,
            searchTime,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Catalog search failed', {
          component: 'catalog-search',
          projectId: context.projectId,
          error,
        });
        return err(new ToolExecutionError('catalog-search', 'Catalog search failed', error instanceof Error ? error : undefined));
      }
    },

    // ─── Dry Run ──────────────────────────────────────────────────

    dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('catalog-search', 'Invalid input', parsed.error)));
      }

      logger.debug('Dry run: catalog search', {
        component: 'catalog-search',
        mode: 'dry-run',
        projectId: context.projectId,
        query: parsed.data.query,
      });

      return Promise.resolve(ok({
        success: true,
        output: {
          results: [],
          totalCount: 0,
          searchTime: 0,
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/catalog-order.ts
```typescript
/**
 * Catalog Order Tool
 * Creates draft orders from catalog items.
 * Agents can prepare orders but cannot finalize without human approval.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'catalog-order' });

// ─── Catalog Order Options ─────────────────────────────────────

export interface CatalogOrderToolOptions {
  /** Custom order creator. If not provided, uses mock implementation. */
  orderCreator?: (orderData: unknown) => Promise<{ orderId: string; status: string }>;
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  customerId: z.string().optional().describe('Customer ID or identifier'),
  customerName: z.string().min(1).max(200).describe('Customer name'),
  customerContact: z.object({
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
  }).describe('Customer contact information'),
  items: z.array(z.object({
    productId: z.string().describe('Product ID from catalog'),
    productName: z.string().describe('Product name'),
    quantity: z.number().int().positive().describe('Quantity to order'),
    unitPrice: z.number().positive().describe('Unit price'),
    currency: z.string().default('ARS').describe('Currency code'),
  })).min(1).describe('List of items to order'),
  notes: z.string().max(1000).optional().describe('Order notes or special requests'),
  deliveryDate: z.string().optional().describe('Requested delivery date (ISO 8601 format)'),
});

const outputSchema = z.object({
  orderId: z.string().describe('Generated order ID'),
  status: z.enum(['draft', 'pending_approval', 'confirmed', 'rejected']).describe('Order status'),
  totalAmount: z.number().describe('Total order amount'),
  currency: z.string().describe('Currency code'),
  itemCount: z.number().describe('Number of items in order'),
  createdAt: z.string().describe('Order creation timestamp (ISO 8601)'),
  approvalRequired: z.boolean().describe('Whether the order requires human approval'),
  message: z.string().describe('Message to show the customer'),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createCatalogOrderTool(options: CatalogOrderToolOptions = {}): ExecutableTool {
  return {
    id: 'catalog-order',
    name: 'catalog_order',
    description: 'Create a draft order from catalog items. The order is saved as a draft and requires human approval to finalize. Use this when a customer wants to place an order.',
    category: 'data',
    riskLevel: 'medium',
    requiresApproval: false, // Creating draft is safe, finalizing requires approval
    sideEffects: true, // Creates records in database
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    // ─── Execution ────────────────────────────────────────────────

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('catalog-order', 'Invalid input', parsed.error));
      }
      const validated = parsed.data;

      logger.debug('Creating draft order', {
        component: 'catalog-order',
        projectId: context.projectId,
        sessionId: context.sessionId,
        customerName: validated.customerName,
        itemCount: validated.items.length,
      });

      try {
        // Calculate total
        const totalAmount = validated.items.reduce((sum, item) => {
          return sum + (item.quantity * item.unitPrice);
        }, 0);

        // Generate order ID
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        if (options.orderCreator) {
          const result = await options.orderCreator({
            ...validated,
            totalAmount,
            orderId,
          });
          
          logger.debug('Order created via custom creator', {
            component: 'catalog-order',
            projectId: context.projectId,
            orderId: result.orderId,
          });
          
          return ok({
            success: true,
            output: {
              orderId: result.orderId,
              status: result.status as 'draft' | 'pending_approval' | 'confirmed' | 'rejected',
              totalAmount,
              currency: validated.items[0]?.currency ?? 'ARS',
              itemCount: validated.items.length,
              createdAt: new Date().toISOString(),
              approvalRequired: true,
              message: `Pedido ${result.orderId} creado exitosamente.`,
            },
            durationMs: Date.now() - startTime,
          });
        } else {
          // Default mock implementation
          logger.debug('Draft order created (mock)', {
            component: 'catalog-order',
            projectId: context.projectId,
            orderId,
            totalAmount,
            currency: validated.items[0]?.currency ?? 'ARS',
          });

          return ok({
            success: true,
            output: {
              orderId,
              status: 'draft' as const,
              totalAmount,
              currency: validated.items[0]?.currency ?? 'ARS',
              itemCount: validated.items.length,
              createdAt: new Date().toISOString(),
              approvalRequired: true,
              message: `Pedido ${orderId} creado como borrador. Total: ${totalAmount} ${validated.items[0]?.currency ?? 'ARS'}. Un representante se contactará para confirmar.`,
            },
            durationMs: Date.now() - startTime,
          });
        }
      } catch (error) {
        logger.error('Order creation failed', {
          component: 'catalog-order',
          projectId: context.projectId,
          error,
        });
        return err(new ToolExecutionError('catalog-order', 'Order creation failed', error instanceof Error ? error : undefined));
      }
    },

    // ─── Dry Run ──────────────────────────────────────────────────

    dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('catalog-order', 'Invalid input', parsed.error)));
      }

      logger.debug('Dry run: catalog order', {
        component: 'catalog-order',
        mode: 'dry-run',
        projectId: context.projectId,
        customerName: parsed.data.customerName,
      });

      const totalAmount = parsed.data.items.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice);
      }, 0);

      return Promise.resolve(ok({
        success: true,
        output: {
          orderId: 'DRY-RUN-ORDER',
          status: 'draft' as const,
          totalAmount,
          currency: parsed.data.items[0]?.currency ?? 'ARS',
          itemCount: parsed.data.items.length,
          createdAt: new Date().toISOString(),
          approvalRequired: true,
          message: 'Dry run - no order created',
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/vehicle-lead-score.ts
```typescript
/**
 * Vehicle Lead Score Tool
 *
 * Calculates and stores lead quality score for vehicle sales prospects
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { Prisma } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  LeadDataSchema,
  calculateLeadScore,
  buildLeadMetadata,
} from '@/verticals/vehicles/lead-scoring.js';

const logger = createLogger({ name: 'vehicle-lead-score' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to score'),
  budget: z.number().optional().describe('Budget in ARS'),
  budgetRange: z
    .enum(['low', 'medium', 'high', 'premium'])
    .optional()
    .describe('Budget range category'),
  urgency: z
    .enum(['browsing', 'considering', 'ready', 'urgent'])
    .describe('Purchase urgency level'),
  vehicleType: z
    .enum(['sedan', 'suv', 'truck', 'sports', 'electric', 'hybrid', 'other'])
    .optional()
    .describe('Preferred vehicle type'),
  hasTradeIn: z.boolean().optional().describe('Has vehicle to trade in'),
  financingNeeded: z.boolean().optional().describe('Needs financing'),
  preferredContact: z
    .enum(['phone', 'whatsapp', 'email', 'any'])
    .optional()
    .describe('Preferred contact method'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  score: z.number(),
  tier: z.enum(['cold', 'warm', 'hot', 'urgent']),
  reasoning: z.string(),
  suggestedActions: z.array(z.string()),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createVehicleLeadScoreTool(): ExecutableTool {
  return {
    id: 'vehicle-lead-score',
    name: 'Score Vehicle Lead',
    description:
      'Calculate and store lead quality score for vehicle sales. Scores are based on budget, urgency, and vehicle preferences.',
    category: 'vehicles',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('vehicle-lead-score', 'Invalid input', parsed.error));
      }
      const { contactId, ...leadData } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('vehicle-lead-score', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'vehicle-lead-score',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const validatedLeadData = LeadDataSchema.parse(leadData);
        const score = calculateLeadScore(validatedLeadData);
        const updatedMetadata = buildLeadMetadata(contact.metadata, validatedLeadData, score);

        await getDatabase().client.contact.update({
          where: { id: contactId },
          data: { metadata: updatedMetadata as Prisma.InputJsonValue },
        });

        logger.info('Lead score calculated and stored', {
          component: 'vehicle-lead-score',
          contactId,
          score: score.score,
          tier: score.tier,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            score: score.score,
            tier: score.tier,
            reasoning: score.reasoning,
            suggestedActions: score.suggestedActions,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Lead scoring failed', {
          component: 'vehicle-lead-score',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'vehicle-lead-score',
          'Lead scoring failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('vehicle-lead-score', 'Invalid input', parsed.error)));
      }
      const { contactId, ...leadData } = parsed.data;
      const validatedLeadData = LeadDataSchema.parse(leadData);
      const score = calculateLeadScore(validatedLeadData);

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId,
          score: score.score,
          tier: score.tier,
          reasoning: score.reasoning,
          suggestedActions: score.suggestedActions,
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/vehicle-check-followup.ts
```typescript
/**
 * Vehicle Check Follow-up Tool
 *
 * Determines if a vehicle lead needs follow-up based on tier and last interaction
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { Prisma } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  FollowUpConfigSchema,
  calculateFollowUp,
  buildFollowUpMetadata,
} from '@/verticals/vehicles/follow-up.js';

const logger = createLogger({ name: 'vehicle-check-followup' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to check'),
  updateMetadata: z
    .boolean()
    .optional()
    .default(true)
    .describe('Update contact metadata with follow-up schedule'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  shouldFollowUp: z.boolean(),
  reason: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  suggestedMessage: z.string(),
  nextCheckHours: z.number(),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createVehicleCheckFollowupTool(): ExecutableTool {
  return {
    id: 'vehicle-check-followup',
    name: 'Check Vehicle Follow-up',
    description:
      'Determine if a vehicle lead needs follow-up based on lead tier, last interaction time, and previous follow-ups. Returns suggested message and timing.',
    category: 'vehicles',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('vehicle-check-followup', 'Invalid input', parsed.error));
      }
      const { contactId, updateMetadata } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('vehicle-check-followup', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'vehicle-check-followup',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const metadata = (contact.metadata ?? {}) as Record<string, unknown>;
        const leadScore = (metadata['leadScore'] ?? {}) as Record<string, unknown>;

        if (!leadScore['tier']) {
          return err(new ToolExecutionError(
            'vehicle-check-followup',
            `Contact ${contactId} has no lead score. Run vehicle-lead-score first.`
          ));
        }

        const followUpConfig = FollowUpConfigSchema.parse({
          tier: leadScore['tier'],
          lastInteractionAt: (metadata['lastInteraction'] ?? contact.updatedAt.toISOString()) as string,
          lastFollowUpAt: (leadScore['lastFollowUpAt'] ?? undefined) as string | undefined,
          followUpCount: (leadScore['followUpCount'] ?? 0) as number,
        });

        const schedule = calculateFollowUp(followUpConfig);

        if (updateMetadata) {
          const updatedMetadata = buildFollowUpMetadata(metadata, schedule);
          await getDatabase().client.contact.update({
            where: { id: contactId },
            data: { metadata: updatedMetadata as Prisma.InputJsonValue },
          });
        }

        logger.info('Follow-up check completed', {
          component: 'vehicle-check-followup',
          contactId,
          shouldFollowUp: schedule.shouldFollowUp,
          priority: schedule.priority,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            shouldFollowUp: schedule.shouldFollowUp,
            reason: schedule.reason,
            priority: schedule.priority,
            suggestedMessage: schedule.suggestedMessage,
            nextCheckHours: schedule.delayHours,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Follow-up check failed', {
          component: 'vehicle-check-followup',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'vehicle-check-followup',
          'Follow-up check failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('vehicle-check-followup', 'Invalid input', parsed.error)));
      }

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId: parsed.data.contactId,
          shouldFollowUp: true,
          reason: 'Dry run - simulated follow-up needed',
          priority: 'medium',
          suggestedMessage: 'Hola! ¿Cómo va todo con la búsqueda del vehículo?',
          nextCheckHours: 24,
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/wholesale-update-stock.ts
```typescript
/**
 * Wholesale Update Stock Tool
 *
 * Updates inventory from CSV data
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  parseStockCSV,
  applyStockUpdates,
  ProductSchema,
} from '@/verticals/wholesale/stock-manager.js';

const logger = createLogger({ name: 'wholesale-update-stock' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  csvContent: z.string().describe('CSV content with columns: sku,stock,price (optional)'),
  projectId: z.string().describe('Project ID to update stock for'),
});

const outputSchema = z.object({
  success: z.boolean(),
  updatedCount: z.number(),
  notFoundCount: z.number(),
  notFoundSkus: z.array(z.string()),
  message: z.string(),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createWholesaleUpdateStockTool(): ExecutableTool {
  return {
    id: 'wholesale-update-stock',
    name: 'Update Wholesale Stock',
    description:
      'Update inventory from CSV data. CSV must contain SKU and STOCK columns. Optional PRICE column to update prices.',
    category: 'wholesale',
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('wholesale-update-stock', 'Invalid input', parsed.error));
      }
      const { csvContent, projectId } = parsed.data;

      try {
        if (projectId !== context.projectId) {
          return err(new ToolExecutionError('wholesale-update-stock', 'Cannot update stock for different project'));
        }

        let updates;
        try {
          updates = parseStockCSV(csvContent);
        } catch (parseError) {
          return err(new ToolExecutionError(
            'wholesale-update-stock',
            `Failed to parse CSV: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
          ));
        }

        if (updates.length === 0) {
          return ok({
            success: false,
            output: {
              success: false,
              updatedCount: 0,
              notFoundCount: 0,
              notFoundSkus: [],
              message: 'No valid stock updates found in CSV',
            },
            durationMs: Date.now() - startTime,
          });
        }

        const project = await getDatabase().client.project.findUnique({
          where: { id: projectId },
        });

        if (!project) {
          return err(new ToolExecutionError('wholesale-update-stock', `Project ${projectId} not found`));
        }

        const config = project.configJson as Record<string, unknown>;
        const catalog = (config['catalog'] ?? {}) as Record<string, unknown>;
        const existingProducts = ((catalog['products'] ?? []) as unknown[]).map((p) =>
          ProductSchema.parse(p)
        );

        const result = applyStockUpdates(existingProducts, updates);

        const updatedProductMap = new Map(existingProducts.map((p) => [p.sku, p]));
        for (const updated of result.updated) {
          updatedProductMap.set(updated.sku, updated);
        }

        const updatedProducts = Array.from(updatedProductMap.values());

        const updatedConfig = {
          ...config,
          catalog: {
            ...catalog,
            products: updatedProducts,
            lastStockUpdate: new Date().toISOString(),
          },
        };

        await getDatabase().client.project.update({
          where: { id: projectId },
          data: { configJson: updatedConfig },
        });

        logger.info('Stock updated from CSV', {
          component: 'wholesale-update-stock',
          projectId,
          updatedCount: result.updated.length,
          notFoundCount: result.notFound.length,
        });

        return ok({
          success: true,
          output: {
            success: true,
            updatedCount: result.updated.length,
            notFoundCount: result.notFound.length,
            notFoundSkus: result.notFound,
            message: `Stock updated: ${result.updated.length} products updated${result.notFound.length > 0 ? `, ${result.notFound.length} SKUs not found` : ''}`,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Stock update failed', {
          component: 'wholesale-update-stock',
          error,
        });
        return err(new ToolExecutionError(
          'wholesale-update-stock',
          'Stock update failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('wholesale-update-stock', 'Invalid input', parsed.error)));
      }

      const updates = parseStockCSV(parsed.data.csvContent);

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          updatedCount: updates.length,
          notFoundCount: 0,
          notFoundSkus: [],
          message: `Dry run: would update ${updates.length} products`,
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/wholesale-order-history.ts
```typescript
/**
 * Wholesale Order History Tool
 *
 * Retrieves customer order history for personalized recommendations
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  OrderSchema,
  buildOrderHistory,
  getRecentOrders,
  calculateLTV,
} from '@/verticals/wholesale/order-history.js';

const logger = createLogger({ name: 'wholesale-order-history' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to get order history for'),
  limit: z.number().optional().default(10).describe('Max orders to return'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  totalOrders: z.number(),
  totalSpent: z.number(),
  averageOrderValue: z.number(),
  lastOrderDate: z.string().nullable(),
  recentOrders: z.array(
    z.object({
      orderId: z.string(),
      date: z.string(),
      total: z.number(),
      itemCount: z.number(),
      status: z.string(),
    })
  ),
  topProducts: z.array(
    z.object({
      sku: z.string(),
      productName: z.string(),
      totalQuantity: z.number(),
      totalSpent: z.number(),
    })
  ),
  ltv: z.object({
    totalValue: z.number(),
    orderCount: z.number(),
    averageDaysBetweenOrders: z.number(),
  }),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createWholesaleOrderHistoryTool(): ExecutableTool {
  return {
    id: 'wholesale-order-history',
    name: 'Get Wholesale Order History',
    description:
      'Retrieve customer order history including total spent, recent orders, top products, and lifetime value metrics.',
    category: 'wholesale',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('wholesale-order-history', 'Invalid input', parsed.error));
      }
      const { contactId, limit } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('wholesale-order-history', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'wholesale-order-history',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const metadata = (contact.metadata ?? {}) as Record<string, unknown>;
        const ordersData = (metadata['orders'] ?? []) as unknown[];
        const orders = ordersData.map((o) => OrderSchema.parse(o));

        const history = buildOrderHistory(orders);
        const recent = getRecentOrders(orders, limit);
        const ltv = calculateLTV(orders);

        logger.info('Order history retrieved', {
          component: 'wholesale-order-history',
          contactId,
          orderCount: orders.length,
          totalSpent: history.totalSpent,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            totalOrders: history.totalOrders,
            totalSpent: history.totalSpent,
            averageOrderValue: history.averageOrderValue,
            lastOrderDate: history.lastOrderDate,
            recentOrders: recent.map((order) => ({
              orderId: order.orderId,
              date: order.date,
              total: order.total,
              itemCount: order.items.length,
              status: order.status,
            })),
            topProducts: history.topProducts.slice(0, 5),
            ltv: {
              totalValue: ltv.totalValue,
              orderCount: ltv.orderCount,
              averageDaysBetweenOrders: ltv.averageDaysBetweenOrders,
            },
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Order history retrieval failed', {
          component: 'wholesale-order-history',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'wholesale-order-history',
          'Order history retrieval failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('wholesale-order-history', 'Invalid input', parsed.error)));
      }

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId: parsed.data.contactId,
          totalOrders: 5,
          totalSpent: 250000,
          averageOrderValue: 50000,
          lastOrderDate: new Date().toISOString(),
          recentOrders: [{
            orderId: 'ORD-001',
            date: new Date().toISOString(),
            total: 50000,
            itemCount: 3,
            status: 'delivered',
          }],
          topProducts: [{
            sku: 'PROD-001',
            productName: 'Sample Product',
            totalQuantity: 10,
            totalSpent: 100000,
          }],
          ltv: {
            totalValue: 250000,
            orderCount: 5,
            averageDaysBetweenOrders: 30,
          },
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/hotel-detect-language.ts
```typescript
/**
 * Hotel Detect Language Tool
 *
 * Detects and stores customer's preferred language for consistent responses
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { Prisma } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  detectLanguage,
  buildLanguageMetadata,
  getLanguageInstructions,
  SupportedLanguageSchema,
} from '@/verticals/hotels/multi-language.js';

const logger = createLogger({ name: 'hotel-detect-language' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to set language for'),
  text: z.string().describe('Text sample to detect language from'),
  forceLanguage: SupportedLanguageSchema.optional().describe(
    'Force a specific language instead of auto-detection'
  ),
  updateContact: z.boolean().optional().default(true).describe('Update contact metadata'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  language: SupportedLanguageSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  fallback: z.boolean(),
  instructions: z.string(),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createHotelDetectLanguageTool(): ExecutableTool {
  return {
    id: 'hotel-detect-language',
    name: 'Detect Hotel Guest Language',
    description:
      'Auto-detect customer language from text or manually set it. Stores preference in contact metadata for consistent multi-language responses.',
    category: 'hotels',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('hotel-detect-language', 'Invalid input', parsed.error));
      }
      const { contactId, text, forceLanguage, updateContact } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('hotel-detect-language', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'hotel-detect-language',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const detection = forceLanguage
          ? { language: forceLanguage, confidence: 'high' as const, fallback: false }
          : detectLanguage(text);

        if (updateContact) {
          const updatedMetadata = buildLanguageMetadata(
            contact.metadata,
            detection.language,
            detection.confidence
          );

          await getDatabase().client.contact.update({
            where: { id: contactId },
            data: {
              language: detection.language,
              metadata: updatedMetadata as Prisma.InputJsonValue,
            },
          });
        }

        const instructions = getLanguageInstructions(detection.language);

        logger.info('Language detected and set', {
          component: 'hotel-detect-language',
          contactId,
          language: detection.language,
          confidence: detection.confidence,
          forced: !!forceLanguage,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            language: detection.language,
            confidence: detection.confidence,
            fallback: detection.fallback,
            instructions,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Language detection failed', {
          component: 'hotel-detect-language',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'hotel-detect-language',
          'Language detection failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('hotel-detect-language', 'Invalid input', parsed.error)));
      }

      const detection = parsed.data.forceLanguage
        ? { language: parsed.data.forceLanguage, confidence: 'high' as const, fallback: false }
        : detectLanguage(parsed.data.text);

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId: parsed.data.contactId,
          language: detection.language,
          confidence: detection.confidence,
          fallback: detection.fallback,
          instructions: getLanguageInstructions(detection.language),
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/hotel-seasonal-pricing.ts
```typescript
/**
 * Hotel Seasonal Pricing Tool
 *
 * Calculates room prices based on seasonal rates
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  SeasonalPriceSchema,
  RoomTypeSchema,
  getSeasonForDate,
  calculateStayPrice,
} from '@/verticals/hotels/seasonal-pricing.js';

const logger = createLogger({ name: 'hotel-seasonal-pricing' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  projectId: z.string().describe('Project ID (hotel)'),
  checkIn: z.string().datetime().describe('Check-in date (ISO 8601)'),
  checkOut: z.string().datetime().describe('Check-out date (ISO 8601)'),
  roomTypeId: z.string().optional().describe('Specific room type ID (optional)'),
});

const outputSchema = z.object({
  success: z.boolean(),
  season: z.enum(['low', 'medium', 'high']),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  rooms: z.array(
    z.object({
      roomTypeId: z.string(),
      roomName: z.string(),
      pricePerNight: z.number(),
      totalPrice: z.number(),
      minStay: z.number(),
      meetsMinStay: z.boolean(),
    })
  ),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createHotelSeasonalPricingTool(): ExecutableTool {
  return {
    id: 'hotel-seasonal-pricing',
    name: 'Calculate Hotel Seasonal Pricing',
    description:
      'Calculate room prices based on check-in/check-out dates and seasonal rates (low/medium/high season). Returns price per night and total for all or specific room types.',
    category: 'hotels',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('hotel-seasonal-pricing', 'Invalid input', parsed.error));
      }
      const { projectId, checkIn, checkOut, roomTypeId } = parsed.data;

      try {
        if (projectId !== context.projectId) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', 'Cannot get pricing for different project'));
        }

        const project = await getDatabase().client.project.findUnique({
          where: { id: projectId },
        });

        if (!project) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', `Project ${projectId} not found`));
        }

        const config = project.configJson as Record<string, unknown>;
        const hotelConfig = (config['hotel'] ?? {}) as Record<string, unknown>;

        const roomTypes = ((hotelConfig['roomTypes'] ?? []) as unknown[]).map((r) =>
          RoomTypeSchema.parse(r)
        );
        const prices = ((hotelConfig['seasonalPrices'] ?? []) as unknown[]).map((p) =>
          SeasonalPriceSchema.parse(p)
        );

        if (roomTypes.length === 0) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', 'No room types configured for this hotel'));
        }

        const season = getSeasonForDate(new Date(checkIn));
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const nights = Math.ceil(
          (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (nights <= 0) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', 'Check-out must be after check-in'));
        }

        const relevantRooms = roomTypeId
          ? roomTypes.filter((r) => r.id === roomTypeId)
          : roomTypes;

        if (relevantRooms.length === 0) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', `Room type ${roomTypeId ?? 'unknown'} not found`));
        }

        const rooms = relevantRooms.map((room) => {
          const pricing = calculateStayPrice(prices, room.id, checkIn, checkOut);

          if (!pricing) {
            return {
              roomTypeId: room.id,
              roomName: room.name,
              pricePerNight: 0,
              totalPrice: 0,
              minStay: 1,
              meetsMinStay: false,
            };
          }

          return {
            roomTypeId: room.id,
            roomName: room.name,
            pricePerNight: pricing.pricePerNight,
            totalPrice: pricing.total,
            minStay: pricing.minStay,
            meetsMinStay: pricing.meetsMinStay,
          };
        });

        logger.info('Seasonal pricing calculated', {
          component: 'hotel-seasonal-pricing',
          projectId,
          season,
          nights,
          roomCount: rooms.length,
        });

        return ok({
          success: true,
          output: { success: true, season, checkIn, checkOut, nights, rooms },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Seasonal pricing failed', {
          component: 'hotel-seasonal-pricing',
          error,
        });
        return err(new ToolExecutionError(
          'hotel-seasonal-pricing',
          'Pricing calculation failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('hotel-seasonal-pricing', 'Invalid input', parsed.error)));
      }

      const season = getSeasonForDate(new Date(parsed.data.checkIn));
      const checkInDate = new Date(parsed.data.checkIn);
      const checkOutDate = new Date(parsed.data.checkOut);
      const nights = Math.ceil(
        (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          season,
          checkIn: parsed.data.checkIn,
          checkOut: parsed.data.checkOut,
          nights,
          rooms: [{
            roomTypeId: 'standard',
            roomName: 'Standard Room',
            pricePerNight: 5000,
            totalPrice: 5000 * nights,
            minStay: 1,
            meetsMinStay: true,
          }],
        },
        durationMs: 0,
      }));
    },
  };
}
```

