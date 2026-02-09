/**
 * Zod schemas for validating project configuration files.
 * These schemas mirror the TypeScript interfaces in core/types.ts
 * and config/types.ts, providing runtime validation.
 */
import { z } from 'zod';

// ─── LLM Provider Config ────────────────────────────────────────

/**
 * Schema for LLM provider configuration.
 * Validates provider type, model, and optional settings.
 */
export const llmProviderConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama']),
  model: z.string().min(1, 'Model identifier cannot be empty'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  baseUrl: z.string().url('Invalid base URL format').optional(),
});

// ─── Failover Config ────────────────────────────────────────────

/**
 * Schema for failover behavior configuration.
 * Controls when and how the system switches to fallback providers.
 */
export const failoverConfigSchema = z.object({
  onRateLimit: z.boolean(),
  onServerError: z.boolean(),
  onTimeout: z.boolean(),
  timeoutMs: z.number().int().positive('Timeout must be a positive integer'),
  maxRetries: z.number().int().min(0).max(10, 'Max retries cannot exceed 10'),
});

// ─── Memory Config ──────────────────────────────────────────────

/**
 * Schema for memory configuration including long-term storage
 * and context window management.
 */
export const memoryConfigSchema = z.object({
  longTerm: z.object({
    enabled: z.boolean(),
    maxEntries: z.number().int().positive('Max entries must be a positive integer'),
    retrievalTopK: z.number().int().positive('Retrieval top-k must be a positive integer'),
    embeddingProvider: z.string().min(1, 'Embedding provider cannot be empty'),
    decayEnabled: z.boolean(),
    decayHalfLifeDays: z.number().positive('Decay half-life must be positive'),
  }),
  contextWindow: z.object({
    reserveTokens: z.number().int().positive('Reserve tokens must be a positive integer'),
    pruningStrategy: z.enum(['turn-based', 'token-based']),
    maxTurnsInContext: z.number().int().positive('Max turns in context must be a positive integer'),
    compaction: z.object({
      enabled: z.boolean(),
      memoryFlushBeforeCompaction: z.boolean(),
    }),
  }),
});

// ─── Cost Config ────────────────────────────────────────────────

/**
 * Schema for cost and rate limiting configuration.
 * Enforces budget limits and request throttling.
 */
export const costConfigSchema = z.object({
  dailyBudgetUSD: z.number().positive('Daily budget must be positive'),
  monthlyBudgetUSD: z.number().positive('Monthly budget must be positive'),
  maxTokensPerTurn: z.number().int().positive('Max tokens per turn must be a positive integer'),
  maxTurnsPerSession: z.number().int().positive('Max turns per session must be a positive integer'),
  maxToolCallsPerTurn: z.number().int().positive('Max tool calls per turn must be a positive integer'),
  alertThresholdPercent: z.number().min(0).max(100, 'Alert threshold must be between 0 and 100'),
  hardLimitPercent: z.number().min(0).max(200, 'Hard limit must be between 0 and 200'),
  maxRequestsPerMinute: z.number().int().positive('Max requests per minute must be a positive integer'),
  maxRequestsPerHour: z.number().int().positive('Max requests per hour must be a positive integer'),
});

// ─── MCP Server Config ─────────────────────────────────────────

/**
 * Schema for a single MCP server connection configuration.
 * Validates transport-specific required fields via refinement.
 */
export const mcpServerConfigSchema = z
  .object({
    name: z.string().min(1, 'MCP server name cannot be empty'),
    transport: z.enum(['stdio', 'sse']),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url('Invalid MCP server URL').optional(),
    toolPrefix: z.string().min(1).optional(),
  })
  .refine(
    (data) => data.transport !== 'stdio' || data.command !== undefined,
    { message: 'stdio transport requires a "command" field', path: ['command'] },
  )
  .refine(
    (data) => data.transport !== 'sse' || data.url !== undefined,
    { message: 'sse transport requires a "url" field', path: ['url'] },
  );

// ─── Agent Config ───────────────────────────────────────────────

/**
 * Schema for agent configuration.
 * Includes provider settings, failover, memory, and cost controls.
 */
export const agentConfigSchema = z.object({
  projectId: z.string().min(1, 'Project ID cannot be empty'),
  agentRole: z.string().min(1, 'Agent role cannot be empty'),
  provider: llmProviderConfigSchema,
  fallbackProvider: llmProviderConfigSchema.optional(),
  failover: failoverConfigSchema,
  allowedTools: z.array(z.string().min(1, 'Tool ID cannot be empty')),
  mcpServers: z.array(mcpServerConfigSchema).optional(),
  memoryConfig: memoryConfigSchema,
  costConfig: costConfigSchema,
  maxTurnsPerSession: z.number().int().positive('Max turns per session must be a positive integer'),
  maxConcurrentSessions: z.number().int().positive('Max concurrent sessions must be a positive integer'),
});

// ─── Project Config File ────────────────────────────────────────

/**
 * Schema for project configuration files (JSON).
 * Note: `status`, `createdAt`, and `updatedAt` are added by the system,
 * not included in the config file.
 */
export const projectConfigFileSchema = z
  .object({
    id: z.string().min(1, 'Project ID cannot be empty'),
    name: z.string().min(1, 'Project name cannot be empty').max(100, 'Project name cannot exceed 100 characters'),
    description: z.string().max(500, 'Description cannot exceed 500 characters').optional(),
    environment: z.enum(['production', 'staging', 'development']),
    owner: z.string().min(1, 'Owner cannot be empty'),
    tags: z.array(z.string()),
    agentConfig: agentConfigSchema,
  })
  .refine((data) => data.id === data.agentConfig.projectId, {
    message: 'Project ID must match agentConfig.projectId',
    path: ['agentConfig', 'projectId'],
  });

// ─── Inferred Types ─────────────────────────────────────────────

/** Inferred type from llmProviderConfigSchema */
export type LLMProviderConfigInput = z.infer<typeof llmProviderConfigSchema>;

/** Inferred type from failoverConfigSchema */
export type FailoverConfigInput = z.infer<typeof failoverConfigSchema>;

/** Inferred type from memoryConfigSchema */
export type MemoryConfigInput = z.infer<typeof memoryConfigSchema>;

/** Inferred type from costConfigSchema */
export type CostConfigInput = z.infer<typeof costConfigSchema>;

/** Inferred type from mcpServerConfigSchema */
export type MCPServerConfigInput = z.infer<typeof mcpServerConfigSchema>;

/** Inferred type from agentConfigSchema */
export type AgentConfigInput = z.infer<typeof agentConfigSchema>;

/** Inferred type from projectConfigFileSchema (before refinement) */
export type ProjectConfigFileInput = z.infer<typeof projectConfigFileSchema>;
