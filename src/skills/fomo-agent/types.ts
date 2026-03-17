/**
 * Fomo-Agent Skill Types — Zod schemas for OpenClaw → fomo-core agent invocation.
 *
 * This skill is installed on OpenClaw Manager instances so the Manager can
 * delegate tasks to specialized fomo-core agents (Elena, Mateo, etc.) via
 * the POST /api/v1/agents/:agentId/invoke endpoint.
 */
import { z } from 'zod';

// ─── Invoke Request ──────────────────────────────────────────────

/** Schema for the input the OpenClaw skill sends to fomo-core. */
export const FomoAgentInvokeInputSchema = z.object({
  /** The fomo-core agent ID to invoke. */
  agentId: z.string().min(1).max(128),
  /** The message / task for the agent. */
  message: z.string().min(1).max(100_000),
  /** Optional session ID to continue an existing conversation. */
  sessionId: z.string().min(1).optional(),
  /** Source channel identifier (defaults to 'openclaw'). */
  sourceChannel: z.string().min(1).default('openclaw'),
  /** Optional contact role hint. */
  contactRole: z.string().min(1).optional(),
  /** Optional metadata forwarded to the agent. */
  metadata: z.record(z.unknown()).optional(),
});
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
