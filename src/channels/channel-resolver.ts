/**
 * Channel Resolver — resolves the appropriate channel adapter for a given project + provider.
 *
 * In multi-tenant mode, each project has its own channel integrations
 * (e.g. a Telegram bot, a WhatsApp number, a Chatwoot inbox). This resolver
 * creates and caches adapters per project+provider using credentials from SecretService.
 */
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { SecretService } from '@/secrets/types.js';
import type {
  ChannelAdapter,
  ChannelIntegration,
  ChannelIntegrationId,
  ChannelIntegrationRepository,
  ChatwootIntegrationConfig,
  IntegrationProvider,
  OutboundMessage,
  SendResult,
  SlackIntegrationConfig,
  TelegramIntegrationConfig,
  WhatsAppIntegrationConfig,
} from './types.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { createWhatsAppAdapter } from './adapters/whatsapp.js';
import { createSlackAdapter } from './adapters/slack.js';
import { createChatwootAdapter } from './adapters/chatwoot.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ChannelResolver {
  /** Resolve the adapter for a specific provider for a project. Returns null if not configured. */
  resolveAdapter(projectId: ProjectId, provider: IntegrationProvider): Promise<ChannelAdapter | null>;
  /** Resolve a channel integration record by ID. */
  resolveIntegration(integrationId: ChannelIntegrationId): Promise<ChannelIntegration | null>;
  /** Resolve project ID from an integration ID (for webhook routing). */
  resolveProjectByIntegration(integrationId: ChannelIntegrationId): Promise<ProjectId | null>;
  /** Resolve project ID from a Chatwoot account ID (backward compat for Chatwoot webhooks). */
  resolveProjectByAccount(accountId: number): Promise<ProjectId | null>;
  /** Send a message through a project's adapter for a given provider. */
  send(projectId: ProjectId, provider: IntegrationProvider, message: OutboundMessage): Promise<SendResult>;
  /** Invalidate cached adapters for a project (call after integration CRUD). */
  invalidate(projectId: ProjectId): void;
}

export interface ChannelResolverDeps {
  integrationRepository: ChannelIntegrationRepository;
  secretService: SecretService;
  logger: Logger;
}

// ─── Resolver Factory ───────────────────────────────────────────

/**
 * Create a ChannelResolver that resolves adapters per project+provider from DB config + secrets.
 */
export function createChannelResolver(deps: ChannelResolverDeps): ChannelResolver {
  const { integrationRepository, secretService, logger } = deps;

  // Cache adapters by "projectId:provider" composite key
  const adapterCache = new Map<string, ChannelAdapter>();

  function cacheKey(projectId: ProjectId, provider: IntegrationProvider): string {
    return `${projectId}:${provider}`;
  }

  async function createAdapterForIntegration(
    integration: ChannelIntegration,
  ): Promise<ChannelAdapter | null> {
    const { projectId, provider, config } = integration;

    switch (provider) {
      case 'telegram': {
        const tgConfig = config as TelegramIntegrationConfig;
        try {
          const botToken = await secretService.get(projectId, tgConfig.botTokenSecretKey);
          return createTelegramAdapter({ botToken, projectId });
        } catch {
          logger.error(`Failed to resolve Telegram secret: ${tgConfig.botTokenSecretKey}`, {
            component: 'channel-resolver',
            projectId,
          });
          return null;
        }
      }

      case 'whatsapp': {
        const waConfig = config as WhatsAppIntegrationConfig;
        try {
          const accessToken = await secretService.get(projectId, waConfig.accessTokenSecretKey);
          return createWhatsAppAdapter({
            accessToken,
            phoneNumberId: waConfig.phoneNumberId,
            projectId,
            apiVersion: waConfig.apiVersion,
          });
        } catch {
          logger.error(`Failed to resolve WhatsApp secret: ${waConfig.accessTokenSecretKey}`, {
            component: 'channel-resolver',
            projectId,
          });
          return null;
        }
      }

      case 'slack': {
        const slackConfig = config as SlackIntegrationConfig;
        try {
          const botToken = await secretService.get(projectId, slackConfig.botTokenSecretKey);
          let signingSecret: string | undefined;
          if (slackConfig.signingSecretSecretKey) {
            try {
              signingSecret = await secretService.get(projectId, slackConfig.signingSecretSecretKey);
            } catch {
              logger.warn(`Failed to resolve Slack signing secret: ${slackConfig.signingSecretSecretKey}`, {
                component: 'channel-resolver',
                projectId,
              });
            }
          }
          return createSlackAdapter({ botToken, signingSecret, projectId });
        } catch {
          logger.error(`Failed to resolve Slack secret: ${slackConfig.botTokenSecretKey}`, {
            component: 'channel-resolver',
            projectId,
          });
          return null;
        }
      }

      case 'chatwoot': {
        const cwConfig = config as ChatwootIntegrationConfig;
        // Chatwoot still uses env var for backward compat
        const apiToken = process.env[cwConfig.apiTokenEnvVar];
        if (!apiToken) {
          logger.error(`Missing env var for Chatwoot API token: ${cwConfig.apiTokenEnvVar}`, {
            component: 'channel-resolver',
            projectId,
          });
          return null;
        }
        return createChatwootAdapter({
          baseUrl: cwConfig.baseUrl,
          apiToken,
          accountId: cwConfig.accountId,
          agentBotId: cwConfig.agentBotId,
          projectId,
        });
      }

      default:
        logger.error(`Unknown integration provider: ${provider as string}`, {
          component: 'channel-resolver',
        });
        return null;
    }
  }

  return {
    async resolveAdapter(
      projectId: ProjectId,
      provider: IntegrationProvider,
    ): Promise<ChannelAdapter | null> {
      // Check cache first
      const key = cacheKey(projectId, provider);
      const cached = adapterCache.get(key);
      if (cached) return cached;

      const integration = await integrationRepository.findByProjectAndProvider(projectId, provider);
      if (!integration) return null;

      if (integration.status !== 'active') {
        logger.warn('Channel integration is not active', {
          component: 'channel-resolver',
          projectId,
          integrationId: integration.id,
          provider,
          status: integration.status,
        });
        return null;
      }

      const adapter = await createAdapterForIntegration(integration);
      if (adapter) {
        adapterCache.set(key, adapter);
        logger.info(`Created ${provider} adapter for project`, {
          component: 'channel-resolver',
          projectId,
          integrationId: integration.id,
        });
      }

      return adapter;
    },

    async resolveIntegration(
      integrationId: ChannelIntegrationId,
    ): Promise<ChannelIntegration | null> {
      return integrationRepository.findById(integrationId);
    },

    async resolveProjectByIntegration(
      integrationId: ChannelIntegrationId,
    ): Promise<ProjectId | null> {
      const integration = await integrationRepository.findById(integrationId);
      if (!integration) return null;
      return integration.projectId;
    },

    async resolveProjectByAccount(accountId: number): Promise<ProjectId | null> {
      const integration = await integrationRepository.findByProviderAccount('chatwoot', accountId);
      if (!integration) return null;
      return integration.projectId;
    },

    async send(
      projectId: ProjectId,
      provider: IntegrationProvider,
      message: OutboundMessage,
    ): Promise<SendResult> {
      const adapter = await this.resolveAdapter(projectId, provider);
      if (!adapter) {
        return {
          success: false,
          error: `No ${provider} adapter configured for project ${projectId}`,
        };
      }

      try {
        return await adapter.send(message);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error sending message via ${provider}`, {
          component: 'channel-resolver',
          projectId,
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      }
    },

    invalidate(projectId: ProjectId): void {
      // Invalidate all providers for this project
      for (const key of adapterCache.keys()) {
        if (key.startsWith(`${projectId}:`)) {
          adapterCache.delete(key);
        }
      }
      logger.debug('Invalidated channel adapter cache', {
        component: 'channel-resolver',
        projectId,
      });
    },
  };
}
