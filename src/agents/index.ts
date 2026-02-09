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
  MCPServerConfig,
  ChannelConfig,
  AgentPromptConfig,
  AgentConfig,
  CreateAgentInput,
  UpdateAgentInput,
  AgentMessage,
  AgentRepository,
  AgentRegistry,
  AgentComms,
} from './types.js';

// ─── Factory Functions ───────────────────────────────────────────

export { createAgentRegistry } from './agent-registry.js';
export { createAgentComms } from './agent-comms.js';
