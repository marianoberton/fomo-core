/**
 * Operations Summary — GET /projects/:projectId/operations-summary
 *
 * Returns a cross-referenced view of agents + channel integrations,
 * showing which channels each agent is connected to and their status.
 */
import type { FastifyInstance } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';
import type { AgentConfig } from '@/agents/types.js';

// ─── Types ────────────────────────────────────────────────────────

interface AgentChannelInfo {
  provider: string;
  integrationId: string | null;
  status: 'connected' | 'not_configured';
}

interface AgentSummary {
  id: string;
  name: string;
  description: string | undefined;
  status: string;
  channels: AgentChannelInfo[];
}

interface OperationsSummaryResponse {
  agents: AgentSummary[];
  integrations: {
    id: string;
    provider: string;
    status: string;
  }[];
  summary: {
    totalAgents: number;
    activeAgents: number;
    totalChannels: number;
    connectedChannels: number;
    notConfigured: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Collect unique channel providers referenced by an agent. */
function getAgentChannelProviders(agent: AgentConfig): string[] {
  const providers = new Set<string>();

  // From channelConfig.allowedChannels
  if (agent.channelConfig?.allowedChannels) {
    for (const ch of agent.channelConfig.allowedChannels) {
      providers.add(ch);
    }
  }

  // From modes[].channelMapping
  if (agent.modes) {
    for (const mode of agent.modes) {
      for (const ch of mode.channelMapping) {
        // channelMapping entries may be "whatsapp", "telegram", or "slack:C05ABCDEF"
        const provider = ch.includes(':') ? ch.split(':')[0] : ch;
        if (provider) providers.add(provider);
      }
    }
  }

  return [...providers];
}

// Normalize channel names to integration providers
// Agent config uses "whatsapp" → could be either "whatsapp" or "whatsapp-waha" integration
function normalizeProvider(agentChannel: string): string[] {
  if (agentChannel === 'whatsapp') {
    return ['whatsapp', 'whatsapp-waha'];
  }
  return [agentChannel];
}

// ─── Route ────────────────────────────────────────────────────────

/** Register operations summary routes. */
export function operationsSummaryRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { agentRepository, channelIntegrationRepository, projectRepository } = deps;

  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/operations-summary',
    async (request, reply) => {
       
      const projectId = request.params.projectId as ProjectId;

      // Verify project exists
      const project = await projectRepository.findById(projectId);
      if (!project) {
        return sendNotFound(reply, 'Project', projectId);
      }

      // Fetch agents and integrations in parallel
      const [agents, integrations] = await Promise.all([
        agentRepository.list(projectId),
        channelIntegrationRepository.findByProject(projectId),
      ]);

      // Build integration lookup: provider → integration record
      const integrationByProvider = new Map<string, { id: string; provider: string; status: string }>();
      for (const integration of integrations) {
        integrationByProvider.set(integration.provider, {
          id: integration.id,
          provider: integration.provider,
          status: integration.status,
        });
      }

      // Cross-reference agents with integrations
      let connectedCount = 0;
      let notConfiguredCount = 0;

      const agentSummaries: AgentSummary[] = agents.map((agent) => {
        const agentProviders = getAgentChannelProviders(agent);
        const channels: AgentChannelInfo[] = [];

        for (const agentChannel of agentProviders) {
          const normalized = normalizeProvider(agentChannel);
          const match = normalized
            .map((p) => integrationByProvider.get(p))
            .find(Boolean);

          if (match) {
            channels.push({
              provider: match.provider,
              integrationId: match.id,
              status: 'connected',
            });
            connectedCount++;
          } else {
            channels.push({
              provider: agentChannel,
              integrationId: null,
              status: 'not_configured',
            });
            notConfiguredCount++;
          }
        }

        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          status: agent.status,
          channels,
        };
      });

      const response: OperationsSummaryResponse = {
        agents: agentSummaries,
        integrations: integrations.map((i) => ({
          id: i.id,
          provider: i.provider,
          status: i.status,
        })),
        summary: {
          totalAgents: agents.length,
          activeAgents: agents.filter((a) => a.status === 'active').length,
          totalChannels: connectedCount + notConfiguredCount,
          connectedChannels: connectedCount,
          notConfigured: notConfiguredCount,
        },
      };

      return sendSuccess(reply, response);
    },
  );
}
