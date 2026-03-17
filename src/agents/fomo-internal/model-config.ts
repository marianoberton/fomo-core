/**
 * Per-agent model configuration for FOMO internal agents.
 *
 * Centralizes model selection so each agent uses the most cost-effective
 * model for its role. Models are routed through OpenRouter (MiniMax, Kimi)
 * or directly through Anthropic (Sonnet).
 */
import { z } from 'zod';
import type { AgentLLMConfig } from '../types.js';

// ─── Schema ──────────────────────────────────────────────────────

/** Zod schema for a single agent model entry. */
const agentModelEntrySchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

/** Zod schema for the full model config map. */
const modelConfigSchema = z.record(z.string(), agentModelEntrySchema);

export type AgentModelEntry = z.infer<typeof agentModelEntrySchema>;

// ─── Config ──────────────────────────────────────────────────────

/**
 * Per-agent model configuration.
 *
 * Keys are agent names (as used in agents.config.ts).
 * OpenRouter model IDs use `provider/model-name` format.
 */
const MODEL_CONFIG_RAW = {
  /** CS agent — cheap, conversational, high-volume support queries. */
  'FAMA-CS': {
    provider: 'openrouter' as const,
    model: 'minimax/minimax-m2.5',
    temperature: 0.4,
  },
  /** Sales agent — strong reasoning for lead qualification. */
  'FAMA-Sales': {
    provider: 'openrouter' as const,
    model: 'moonshotai/kimi-k2.5',
    temperature: 0.4,
  },
  /** Manager — most capable model for orchestration and decisions. */
  'FAMA-Manager': {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
  },
  /** Ops — same as Manager, needs reliable task execution. */
  'FAMA-Ops': {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    temperature: 0.2,
  },
} satisfies Record<string, AgentModelEntry>;

/** Validated and exported model config. */
export const MODEL_CONFIG: Record<string, AgentModelEntry> = modelConfigSchema.parse(MODEL_CONFIG_RAW);

/** Default model used when an agent has no specific config. */
const DEFAULT_MODEL: AgentModelEntry = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  temperature: 0.3,
};

// ─── Lookup ──────────────────────────────────────────────────────

/**
 * Get the configured model identifier for an agent.
 *
 * Looks up the agent name in MODEL_CONFIG. Falls back to the default
 * (claude-sonnet-4-6) for unknown agents.
 *
 * @param agentName - Agent name (e.g. "FAMA-Sales", "FAMA-CS")
 * @returns Full model identifier string
 */
export function getAgentModel(agentName: string): string {
  const entry = MODEL_CONFIG[agentName];
  return entry?.model ?? DEFAULT_MODEL.model;
}

/**
 * Get the full LLM config for an agent, suitable for use as AgentLLMConfig.
 *
 * @param agentName - Agent name (e.g. "FAMA-Sales", "FAMA-CS")
 * @returns AgentLLMConfig with provider, model, and temperature
 */
export function getAgentLLMConfig(agentName: string): AgentLLMConfig {
  const entry = MODEL_CONFIG[agentName] ?? DEFAULT_MODEL;
  return {
    provider: entry.provider,
    model: entry.model,
    temperature: entry.temperature,
  };
}
