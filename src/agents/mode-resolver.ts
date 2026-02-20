/**
 * Agent Mode Resolver
 *
 * Resolves which operating mode an agent should use based on the source
 * channel and (optionally) the contact's role. This is a pure function
 * with no side effects — all inputs are passed explicitly.
 */
import type { AgentConfig, AgentMode, AgentPromptConfig } from './types.js';

// ─── Resolved Mode ──────────────────────────────────────────────

/** The result of resolving an agent's operating mode. */
export interface ResolvedMode {
  /** The mode name (e.g., "public", "internal"), or "base" if no mode matched. */
  modeName: string;
  /** The effective tool allowlist for this mode. */
  toolAllowlist: string[];
  /** Prompt overrides to layer on top of the agent's base promptConfig. */
  promptOverrides: Partial<AgentPromptConfig> | undefined;
  /** MCP server names active in this mode. Empty means use all agent MCP servers. */
  mcpServerNames: string[];
}

// ─── Resolution Logic ───────────────────────────────────────────

/**
 * Resolve which mode an agent should operate in based on the source channel.
 *
 * Resolution priority:
 * 1. Role-qualified match (e.g., `"telegram:owner"` when contactRole is `"owner"`) — most specific
 * 2. Exact/broad channel match (e.g., `"slack:C05ABCDEF"` or `"whatsapp"`)
 * 3. Fallback to base agent config (no mode matched)
 *
 * @param agent - The agent configuration with modes.
 * @param sourceChannel - The channel the message arrived on (e.g., "whatsapp", "dashboard", "slack").
 * @param contactRole - Optional contact role (e.g., "owner", "customer").
 * @returns The resolved mode configuration.
 */
export function resolveAgentMode(
  agent: AgentConfig,
  sourceChannel: string,
  contactRole?: string,
): ResolvedMode {
  // If no modes defined, return base config
  if (agent.modes.length === 0) {
    return {
      modeName: 'base',
      toolAllowlist: agent.toolAllowlist,
      promptOverrides: undefined,
      mcpServerNames: [],
    };
  }

  // Priority 1: Role-qualified match (e.g., "telegram:owner") — most specific
  if (contactRole) {
    const roleKey = `${sourceChannel}:${contactRole}`;
    for (const mode of agent.modes) {
      if (mode.channelMapping.includes(roleKey)) {
        return modeToResolved(mode, agent);
      }
    }
  }

  // Priority 2: Exact channel match (e.g., "slack:C05ABCDEF" or "whatsapp")
  for (const mode of agent.modes) {
    if (mode.channelMapping.includes(sourceChannel)) {
      return modeToResolved(mode, agent);
    }
  }

  // Priority 3: No match — return base config
  return {
    modeName: 'base',
    toolAllowlist: agent.toolAllowlist,
    promptOverrides: undefined,
    mcpServerNames: [],
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/** Convert an AgentMode to a ResolvedMode, inheriting from agent base config where needed. */
function modeToResolved(mode: AgentMode, agent: AgentConfig): ResolvedMode {
  return {
    modeName: mode.name,
    toolAllowlist: mode.toolAllowlist && mode.toolAllowlist.length > 0
      ? mode.toolAllowlist
      : agent.toolAllowlist,
    promptOverrides: mode.promptOverrides,
    mcpServerNames: mode.mcpServerNames ?? [],
  };
}
