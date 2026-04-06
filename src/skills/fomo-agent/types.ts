/**
 * Fomo-Agent Skill Types — Zod schemas for OpenClaw → fomo-core agent invocation.
 *
 * This skill is installed on OpenClaw Manager instances so the Manager can
 * delegate tasks to specialized fomo-core agents (Elena, Mateo, etc.) via
 * the POST /api/v1/agents/:agentId/invoke endpoint.
 */
import { z } from 'zod';

// ─── Invoke Request ──────────────────────────────────────────────

/** Structured task packet for OpenClaw orchestration. */
export const TaskPacketSchema = z.object({
  /** Unique task ID from OpenClaw for correlation. */
  taskId: z.string().min(1).max(128),
  /** What the agent should accomplish. */
  objective: z.string().min(1).max(10_000),
  /** Boundaries — what is in/out of scope. */
  scope: z.string().max(10_000).optional(),
  /** How to determine if the task succeeded. */
  acceptanceCriteria: z.array(z.string().max(2_000)).optional(),
  /** Priority hint for the agent. */
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  /** Deadline hint (ISO datetime string). */
  deadline: z.string().datetime().optional(),
  /** Structured context key-value pairs from OpenClaw. */
  context: z.record(z.string(), z.unknown()).optional(),
});
export type TaskPacket = z.infer<typeof TaskPacketSchema>;

/** Schema for the input the OpenClaw skill sends to fomo-core. */
export const FomoAgentInvokeInputSchema = z.object({
  /** The fomo-core agent ID to invoke. */
  agentId: z.string().min(1).max(128),
  /** Plain text message (optional when task is provided). */
  message: z.string().min(1).max(100_000).optional(),
  /** Structured task packet (optional when message is provided). */
  task: TaskPacketSchema.optional(),
  /** Optional session ID to continue an existing conversation. */
  sessionId: z.string().min(1).optional(),
  /** Source channel identifier (defaults to 'openclaw'). */
  sourceChannel: z.string().min(1).default('openclaw'),
  /** Optional contact role hint. */
  contactRole: z.string().min(1).optional(),
  /** Optional metadata forwarded to the agent. */
  metadata: z.record(z.unknown()).optional(),
  /** If true, stream SSE events instead of returning JSON. */
  stream: z.boolean().optional(),
  /** Callback URL for async webhook delivery. */
  callbackUrl: z.string().url().optional(),
}).refine(
  (data) => data.message ?? data.task,
  { message: 'Either message or task must be provided' },
);
export type FomoAgentInvokeInput = z.infer<typeof FomoAgentInvokeInputSchema>;

// ─── Invoke Response ─────────────────────────────────────────────

/** Schema for the fomo-core invoke response payload (inside ApiResponse.data). */
export const FomoAgentInvokeOutputSchema = z.object({
  /** Agent that handled the request. */
  agentId: z.string(),
  /** Session used (created or reused). */
  sessionId: z.string(),
  /** Execution trace ID for observability. */
  traceId: z.string(),
  /** The agent's text response. */
  response: z.string(),
  /** Tool calls executed during the run. */
  toolCalls: z.array(z.object({
    toolId: z.string(),
    input: z.record(z.unknown()),
    result: z.unknown(),
  })).optional(),
  /** Correlated task ID from the original task packet. */
  taskId: z.string().optional(),
  /** ISO timestamp of the response. */
  timestamp: z.string(),
  /** Token usage and cost. */
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUSD: z.number(),
  }).optional(),
});
export type FomoAgentInvokeOutput = z.infer<typeof FomoAgentInvokeOutputSchema>;

/** Schema for async invoke acceptance (202 response). */
export const FomoAgentAsyncAcceptedSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  status: z.literal('running'),
  sessionId: z.string(),
});
export type FomoAgentAsyncAccepted = z.infer<typeof FomoAgentAsyncAcceptedSchema>;

// ─── Skill Config ────────────────────────────────────────────────

/** Schema for the skill's environment / connection configuration. */
export const FomoAgentSkillConfigSchema = z.object({
  /** Base URL of the fomo-core API (e.g. "http://localhost:3002"). */
  fomoCorBaseUrl: z.string().url(),
  /** API key for authenticating with fomo-core (Bearer token). */
  fomoApiKey: z.string().min(1),
  /** Request timeout in milliseconds (default: 60000). */
  timeoutMs: z.number().int().positive().default(60_000),
});
export type FomoAgentSkillConfig = z.infer<typeof FomoAgentSkillConfigSchema>;
