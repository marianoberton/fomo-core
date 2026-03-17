/**
 * Provisioning types — Zod schemas and inferred types for client container provisioning.
 */
import { z } from 'zod';

// ─── Channel Enum ───────────────────────────────────────────────

export const ChannelSchema = z.enum(['whatsapp', 'telegram', 'slack']);
export type Channel = z.infer<typeof ChannelSchema>;

// ─── Agent Config ───────────────────────────────────────────────

/** Schema for per-client agent configuration passed during provisioning. */
export const AgentConfigSchema = z.object({
  /** LLM provider identifier. */
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
  /** Model identifier (e.g. 'gpt-4o', 'claude-sonnet-4-5-20250929'). */
  model: z.string().min(1).max(200),
  /** System prompt for the agent. */
  systemPrompt: z.string().max(10_000).optional(),
  /** Max tokens per response. */
  maxTokens: z.number().int().positive().optional(),
  /** Temperature setting (0–2). */
  temperature: z.number().min(0).max(2).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ─── Create Client Request ──────────────────────────────────────

/** Supported client verticals for template selection. */
export const VerticalSchema = z.enum(['ventas', 'atencion', 'operaciones']);
export type Vertical = z.infer<typeof VerticalSchema>;

/** Schema for creating a new client container. */
export const CreateClientRequestSchema = z.object({
  /** Unique identifier for the client. */
  clientId: z.string().min(1).max(128),
  /** Human-readable client name. */
  clientName: z.string().min(1).max(256),
  /** Communication channels to enable. */
  channels: z.array(ChannelSchema).min(1),
  /** Agent configuration for the client's container. */
  agentConfig: AgentConfigSchema,
  /** Client vertical for template selection. */
  vertical: VerticalSchema.optional(),
  /** Company name used in templates. */
  companyName: z.string().min(1).max(256).optional(),
  /** Owner name used in templates. */
  ownerName: z.string().min(1).max(256).optional(),
  /** Manager agent name. */
  managerName: z.string().min(1).max(128).optional(),
});
export type CreateClientRequest = z.infer<typeof CreateClientRequestSchema>;

// ─── Provisioning Result ────────────────────────────────────────

/** Schema for the result of a provisioning operation. */
export const ProvisioningResultSchema = z.object({
  /** Whether provisioning succeeded. */
  success: z.boolean(),
  /** Docker container ID (present on success). */
  containerId: z.string().optional(),
  /** Container name (always present). */
  containerName: z.string(),
  /** Error message (present on failure). */
  error: z.string().optional(),
});
export type ProvisioningResult = z.infer<typeof ProvisioningResultSchema>;

// ─── Container Status ───────────────────────────────────────────

export const ContainerStatusEnum = z.enum(['running', 'stopped', 'error']);

/** Schema for client container status. */
export const ClientContainerStatusSchema = z.object({
  /** Client identifier. */
  clientId: z.string(),
  /** Docker container ID. */
  containerId: z.string(),
  /** Current container status. */
  status: ContainerStatusEnum,
  /** Uptime in seconds (present when running). */
  uptime: z.number().optional(),
});
export type ClientContainerStatus = z.infer<typeof ClientContainerStatusSchema>;
