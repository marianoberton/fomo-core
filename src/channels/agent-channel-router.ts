/**
 * Agent-Channel Router
 *
 * Resolves which agent should handle an inbound message based on the
 * source channel and (optionally) the contact's role. This bridges
 * the channel system with the agent mode system.
 */
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { AgentId, AgentConfig, AgentRepository } from '@/agents/types.js';
import { resolveAgentMode } from '@/agents/mode-resolver.js';
import type { ResolvedMode } from '@/agents/mode-resolver.js';

// ─── Types ──────────────────────────────────────────────────────

/** Dependencies for the agent-channel router. */
export interface AgentChannelRouterDeps {
  agentRepository: AgentRepository;
  logger: Logger;
}

/** Result of resolving an agent for a channel. */
export interface AgentChannelMatch {
  agentId: AgentId;
  mode: ResolvedMode;
}

/** Interface for the agent-channel router. */
export interface AgentChannelRouter {
  /**
   * Given a project and source channel, find the agent whose modes
   * include this channel in their channelMapping.
   *
   * @param projectId - The project to search in.
   * @param sourceChannel - The channel the message arrived on.
   * @param contactRole - Optional contact role (e.g., "owner").
   * @returns The matching agent and resolved mode, or null if no agent claims this channel.
   */
  resolveAgent(
    projectId: ProjectId,
    sourceChannel: string,
    contactRole?: string,
  ): Promise<AgentChannelMatch | null>;
}

// ─── Factory ────────────────────────────────────────────────────

/**
 * Create an AgentChannelRouter that resolves agents by channel.
 */
export function createAgentChannelRouter(
  deps: AgentChannelRouterDeps,
): AgentChannelRouter {
  const { agentRepository, logger } = deps;

  return {
    async resolveAgent(
      projectId: ProjectId,
      sourceChannel: string,
      contactRole?: string,
    ): Promise<AgentChannelMatch | null> {
      const agents = await agentRepository.listActive(projectId);

      for (const agent of agents) {
        // Skip agents with no modes — they don't participate in channel routing
        if (agent.modes.length === 0) continue;

        const mode = resolveAgentMode(agent, sourceChannel, contactRole);

        // If the mode is not "base", it means a real mode matched
        if (mode.modeName !== 'base') {
          logger.debug('Agent resolved for channel', {
            component: 'agent-channel-router',
            agentId: agent.id,
            agentName: agent.name,
            sourceChannel,
            modeName: mode.modeName,
          });
          return { agentId: agent.id, mode };
        }
      }

      // No agent claims this channel — fall back to project-level config
      logger.debug('No agent found for channel, using project config', {
        component: 'agent-channel-router',
        projectId,
        sourceChannel,
      });
      return null;
    },
  };
}

// ─── Validation ─────────────────────────────────────────────────

/**
 * Check if a new agent's mode channel mappings collide with existing agents.
 * Returns the conflicting agent name and channel if found, null otherwise.
 */
export async function checkChannelCollision(
  agentRepository: AgentRepository,
  projectId: string,
  agentId: string | undefined,
  modes: AgentConfig['modes'],
): Promise<{ agentName: string; channel: string } | null> {
  if (modes.length === 0) return null;

  const agents = await agentRepository.listActive(projectId);
  const newChannels = modes.flatMap((m) => m.channelMapping);

  for (const existing of agents) {
    // Skip the agent being updated
    if (existing.id === agentId) continue;

    const existingChannels = existing.modes.flatMap((m) => m.channelMapping);

    for (const ch of newChannels) {
      if (existingChannels.includes(ch)) {
        return { agentName: existing.name, channel: ch };
      }
    }
  }

  return null;
}
