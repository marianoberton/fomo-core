/**
 * Channel Resolver — resolves the appropriate channel adapter for a given project.
 *
 * In multi-tenant mode, each project has its own channel integration
 * (e.g. a Chatwoot inbox). This resolver creates and caches adapters per project.
 */
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { ChannelIntegrationRepository } from './types.js';
import { createChatwootAdapter } from './adapters/chatwoot.js';
import type { ChatwootAdapter } from './adapters/chatwoot.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ChannelResolver {
  /** Resolve the Chatwoot adapter for a project. Returns null if not configured. */
  resolveAdapter(projectId: ProjectId): Promise<ChatwootAdapter | null>;
  /** Resolve project ID from a Chatwoot account ID (webhook routing). */
  resolveProjectByAccount(accountId: number): Promise<ProjectId | null>;
  /** Invalidate cached adapter for a project. */
  invalidate(projectId: ProjectId): void;
}

export interface ChannelResolverDeps {
  integrationRepository: ChannelIntegrationRepository;
  logger: Logger;
}

// ─── Resolver Factory ───────────────────────────────────────────

/**
 * Create a ChannelResolver that resolves adapters per project from DB config.
 */
export function createChannelResolver(deps: ChannelResolverDeps): ChannelResolver {
  const { integrationRepository, logger } = deps;

  // Cache adapters per project to avoid recreating on every message
  const adapterCache = new Map<string, ChatwootAdapter>();

  return {
    async resolveAdapter(projectId: ProjectId): Promise<ChatwootAdapter | null> {
      // Check cache first
      const cached = adapterCache.get(projectId);
      if (cached) return cached;

      const integration = await integrationRepository.findByProject(projectId);
      if (!integration) return null;

      if (integration.status !== 'active') {
        logger.warn('Channel integration is not active', {
          component: 'channel-resolver',
          projectId,
          integrationId: integration.id,
          status: integration.status,
        });
        return null;
      }

      const config = integration.config;

      // Resolve API token from env var
      const apiToken = process.env[config.apiTokenEnvVar];
      if (!apiToken) {
        logger.error(`Missing env var for Chatwoot API token: ${config.apiTokenEnvVar}`, {
          component: 'channel-resolver',
          projectId,
        });
        return null;
      }

      const adapter = createChatwootAdapter({
        baseUrl: config.baseUrl,
        apiToken,
        accountId: config.accountId,
        agentBotId: config.agentBotId,
        projectId,
      });

      adapterCache.set(projectId, adapter);

      logger.info('Created Chatwoot adapter for project', {
        component: 'channel-resolver',
        projectId,
        accountId: config.accountId,
      });

      return adapter;
    },

    async resolveProjectByAccount(accountId: number): Promise<ProjectId | null> {
      const integration = await integrationRepository.findByProviderAccount('chatwoot', accountId);
      if (!integration) return null;
      return integration.projectId;
    },

    invalidate(projectId: ProjectId): void {
      adapterCache.delete(projectId);
      logger.debug('Invalidated channel adapter cache', {
        component: 'channel-resolver',
        projectId,
      });
    },
  };
}
