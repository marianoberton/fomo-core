/**
 * Multi-Agent System
 *
 * Provides agent configuration, registry, and inter-agent communication.
 */

// ─── Types ───────────────────────────────────────────────────────

export type {
  AgentId,
  AgentMessageId,
  AgentStatus,
  AgentLimits,
  AgentLLMConfig,
  MCPServerConfig,
  ChannelConfig,
  AgentPromptConfig,
  AgentMode,
  AgentConfig,
  CreateAgentInput,
  UpdateAgentInput,
  AgentMessage,
  AgentRepository,
  AgentRegistry,
  AgentComms,
} from './types.js';

// ─── Mode Resolver ──────────────────────────────────────────────

export type { ResolvedMode } from './mode-resolver.js';
export { resolveAgentMode } from './mode-resolver.js';

// ─── Factory Functions ───────────────────────────────────────────

export { createAgentRegistry } from './agent-registry.js';
export { createAgentComms } from './agent-comms.js';
