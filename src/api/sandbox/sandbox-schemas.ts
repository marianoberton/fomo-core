/**
 * Sandbox Schemas — Zod validation for all WebSocket messages in the
 * OpenClaw optimization sandbox.
 *
 * Client → Server messages are a discriminated union on `type`.
 */
import { z } from 'zod';

// ─── Client → Server Messages ───────────────────────────────────

/** Initialize a sandbox session for a specific agent. */
export const sandboxStartSchema = z.object({
  type: z.literal('sandbox_start'),
  /** The fomo-core agent ID to optimize. */
  agentId: z.string().min(1),
  /** The project this agent belongs to. */
  projectId: z.string().min(1),
  /** If true, tools use dryRun() instead of execute(). */
  testMode: z.boolean().optional().default(false),
});

/** Send a test message to the agent and observe the full response. */
export const sendMessageSchema = z.object({
  type: z.literal('send_message'),
  /** The message to send. */
  message: z.string().min(1).max(100_000),
  /** Optional session ID to continue a conversation. */
  sessionId: z.string().min(1).optional(),
  /** Optional media URLs attached to the message. */
  mediaUrls: z.array(z.string().url()).optional(),
});

/** Hot-swap a prompt layer for this sandbox session only. */
export const updatePromptSchema = z.object({
  type: z.literal('update_prompt'),
  /** Which layer to override. */
  layerType: z.enum(['identity', 'instructions', 'safety']),
  /** The new prompt content. */
  content: z.string().min(1).max(100_000),
});

/** Change agent configuration for this sandbox session only. */
export const updateConfigSchema = z.object({
  type: z.literal('update_config'),
  /** LLM config overrides. */
  llmConfig: z.object({
    provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  }).optional(),
  /** Override the tool allowlist. */
  toolAllowlist: z.array(z.string()).optional(),
});

/** Re-send the last message with current (possibly modified) config. */
export const replayMessageSchema = z.object({
  type: z.literal('replay_message'),
});

/** Get the full sandbox conversation history + config change log. */
export const getHistorySchema = z.object({
  type: z.literal('get_history'),
});

/** Promote sandbox changes to production. */
export const promoteConfigSchema = z.object({
  type: z.literal('promote_config'),
  /** What to promote: prompts, llmConfig, tools, or all. */
  what: z.enum(['prompts', 'llmConfig', 'tools', 'all']),
  /** Reason for the change (stored in prompt layer's changeReason). */
  changeReason: z.string().max(500).optional(),
});

/** Reset sandbox to current production configuration. */
export const resetSchema = z.object({
  type: z.literal('reset'),
});

/** Discriminated union of all client → server messages. */
export const sandboxClientMessage = z.discriminatedUnion('type', [
  sandboxStartSchema,
  sendMessageSchema,
  updatePromptSchema,
  updateConfigSchema,
  replayMessageSchema,
  getHistorySchema,
  promoteConfigSchema,
  resetSchema,
]);

/** Inferred types. */
export type SandboxStartMessage = z.infer<typeof sandboxStartSchema>;
export type SendMessageMessage = z.infer<typeof sendMessageSchema>;
export type UpdatePromptMessage = z.infer<typeof updatePromptSchema>;
export type UpdateConfigMessage = z.infer<typeof updateConfigSchema>;
export type ReplayMessageMessage = z.infer<typeof replayMessageSchema>;
export type PromoteConfigMessage = z.infer<typeof promoteConfigSchema>;
export type SandboxClientMessage = z.infer<typeof sandboxClientMessage>;
