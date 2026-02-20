/**
 * Multi-Agent System Types
 *
 * Types for agent configuration, registry, and inter-agent communication.
 */
import type { ProjectId } from '@/core/types.js';

// ─── Branded ID Types ────────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type AgentId = Brand<string, 'AgentId'>;
export type AgentMessageId = Brand<string, 'AgentMessageId'>;

// ─── Agent Status ────────────────────────────────────────────────

export type AgentStatus = 'active' | 'paused' | 'disabled';

// ─── Agent Limits ────────────────────────────────────────────────

/** Resource limits for an agent. */
export interface AgentLimits {
  maxTurns: number;
  maxTokensPerTurn: number;
  budgetPerDayUsd: number;
}

// ─── Agent LLM Config ───────────────────────────────────────────

/** Optional per-agent LLM override. When set, overrides project-level LLM config. */
export interface AgentLLMConfig {
  provider?: 'anthropic' | 'openai' | 'google' | 'ollama';
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

// ─── MCP Server Config ───────────────────────────────────────────

/** Configuration for an MCP (Model Context Protocol) server. */
export interface MCPServerConfig {
  name: string;
  transport?: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  toolPrefix?: string;
}

// ─── Channel Config ──────────────────────────────────────────────

/** Configuration for which channels an agent can use. */
export interface ChannelConfig {
  allowedChannels: string[]; // 'whatsapp', 'telegram', 'slack'
  defaultChannel?: string;
}

// ─── Prompt Config ───────────────────────────────────────────────

/** Agent-specific prompt configuration. */
export interface AgentPromptConfig {
  identity: string;
  instructions: string;
  safety: string;
}

// ─── Agent Mode ──────────────────────────────────────────────────

/**
 * A single operating mode for a dual-mode agent.
 *
 * An agent can have multiple modes (e.g., "public" for customers and
 * "internal" for the business owner). The active mode is resolved at
 * runtime based on the source channel of the inbound message.
 */
export interface AgentMode {
  /** Mode identifier (e.g., "public", "internal"). */
  name: string;
  /** Human-readable label for the dashboard UI. */
  label?: string;
  /** Prompt overrides layered on top of the agent's base promptConfig. */
  promptOverrides?: Partial<AgentPromptConfig>;
  /** Tool allowlist for this mode. If empty/undefined, inherits from agent.toolAllowlist. */
  toolAllowlist?: string[];
  /** MCP server names active in this mode (references agent-level mcpServers by name). */
  mcpServerNames?: string[];
  /** Which channels trigger this mode (e.g., ["whatsapp", "telegram", "slack:C05ABCDEF", "dashboard"]). */
  channelMapping: string[];
}

// ─── Agent Config ────────────────────────────────────────────────

/** Full agent configuration. */
export interface AgentConfig {
  id: AgentId;
  projectId: ProjectId;
  name: string;
  description?: string;
  promptConfig: AgentPromptConfig;
  llmConfig?: AgentLLMConfig;
  toolAllowlist: string[];
  mcpServers: MCPServerConfig[];
  channelConfig: ChannelConfig;
  /** Operating modes. Empty array means single-mode (legacy) agent using base config. */
  modes: AgentMode[];
  limits: AgentLimits;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Create Agent Input ──────────────────────────────────────────

/** Input for creating a new agent. */
export interface CreateAgentInput {
  projectId: string;
  name: string;
  description?: string;
  promptConfig: AgentPromptConfig;
  llmConfig?: AgentLLMConfig;
  toolAllowlist?: string[];
  mcpServers?: MCPServerConfig[];
  channelConfig?: ChannelConfig;
  modes?: AgentMode[];
  limits?: Partial<AgentLimits>;
}

// ─── Update Agent Input ──────────────────────────────────────────

/** Input for updating an existing agent. */
export interface UpdateAgentInput {
  name?: string;
  description?: string;
  promptConfig?: AgentPromptConfig;
  llmConfig?: AgentLLMConfig;
  toolAllowlist?: string[];
  mcpServers?: MCPServerConfig[];
  channelConfig?: ChannelConfig;
  modes?: AgentMode[];
  limits?: Partial<AgentLimits>;
  status?: AgentStatus;
}

// ─── Agent Message ───────────────────────────────────────────────

/** Message sent between agents. */
export interface AgentMessage {
  id: AgentMessageId;
  fromAgentId: AgentId;
  toAgentId: AgentId;
  content: string;
  context?: Record<string, unknown>;
  replyToId?: AgentMessageId;
  createdAt: Date;
}

// ─── Agent Repository Interface ──────────────────────────────────

/** Repository interface for agent CRUD operations. */
export interface AgentRepository {
  /** Create a new agent. */
  create(input: CreateAgentInput): Promise<AgentConfig>;
  /** Find an agent by ID. */
  findById(id: AgentId): Promise<AgentConfig | null>;
  /** Find an agent by name within a project. */
  findByName(projectId: string, name: string): Promise<AgentConfig | null>;
  /** Update an existing agent. */
  update(id: AgentId, input: UpdateAgentInput): Promise<AgentConfig>;
  /** Delete an agent. */
  delete(id: AgentId): Promise<void>;
  /** List all agents in a project. */
  list(projectId: string): Promise<AgentConfig[]>;
  /** List only active agents in a project. */
  listActive(projectId: string): Promise<AgentConfig[]>;
  /** List all agents across all projects. */
  listAll(): Promise<AgentConfig[]>;
}

// ─── Agent Registry Interface ────────────────────────────────────

/** Registry interface for cached agent access. */
export interface AgentRegistry {
  /** Get an agent by ID (cached). */
  get(agentId: AgentId): Promise<AgentConfig | null>;
  /** Get an agent by name within a project (cached). */
  getByName(projectId: string, name: string): Promise<AgentConfig | null>;
  /** List all agents in a project. */
  list(projectId: string): Promise<AgentConfig[]>;
  /** Refresh the cache for a specific agent. */
  refresh(agentId: AgentId): Promise<void>;
  /** Invalidate the cache for a specific agent. */
  invalidate(agentId: AgentId): void;
}

// ─── Agent Comms Interface ───────────────────────────────────────

/** Interface for inter-agent communication. */
export interface AgentComms {
  /** Send a message to another agent. Returns the message ID. */
  send(message: Omit<AgentMessage, 'id' | 'createdAt'>): Promise<AgentMessageId>;
  /** Send a message and wait for a reply. Returns the reply content. */
  sendAndWait(
    message: Omit<AgentMessage, 'id' | 'createdAt'>,
    timeoutMs?: number,
  ): Promise<string>;
  /** Subscribe to messages for an agent. Returns an unsubscribe function. */
  subscribe(
    agentId: AgentId,
    handler: (message: AgentMessage) => void,
  ): () => void;
}
