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
  VapiIntegrationConfig,
  WhatsAppIntegrationConfig,
  WhatsAppWahaIntegrationConfig,
} from './types.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { createWhatsAppAdapter } from './adapters/whatsapp.js';
import { createWhatsAppWahaAdapter } from './adapters/whatsapp-waha.js';
import { createSlackAdapter } from './adapters/slack.js';
import { createChatwootAdapter } from './adapters/chatwoot.js';
import { createVapiAdapter } from './adapters/vapi.js';

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
  /** TTL for cached adapters in milliseconds (default: 10 minutes). */
  cacheTtlMs?: number;
}

// ─── Resolver Factory ───────────────────────────────────────────

/**
 * Create a ChannelResolver that resolves adapters per project+provider from DB config + secrets.
 */
export function createChannelResolver(deps: ChannelResolverDeps): ChannelResolver {
  const { integrationRepository, secretService, logger } = deps;
  const cacheTtlMs = deps.cacheTtlMs ?? 10 * 60 * 1000; // 10 minutes

  // Cache adapters by "projectId:provider" composite key with TTL.
  // If credentials are rotated, the old adapter is evicted after the TTL
  // expires — no need to wait for a manual invalidate() call or a restart.
  const adapterCache = new Map<string, { adapter: ChannelAdapter; expiresAt: number }>();

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

      case 'whatsapp-waha': {
        const wahaConfig = config as WhatsAppWahaIntegrationConfig;
        return createWhatsAppWahaAdapter({
          wahaBaseUrl: wahaConfig.wahaBaseUrl,
          sessionName: wahaConfig.sessionName ?? 'default',
          projectId,
          apiKey: process.env['WAHA_API_KEY'],
        });
      }

      case 'chatwoot': {
        const cwConfig = config as ChatwootIntegrationConfig;
        let apiToken: string | undefined;

        // Preferred path: SecretService (per-project encrypted storage).
        if (cwConfig.apiTokenSecretKey) {
          try {
            apiToken = await secretService.get(projectId, cwConfig.apiTokenSecretKey);
          } catch {
            logger.error(`Failed to resolve Chatwoot secret: ${cwConfig.apiTokenSecretKey}`, {
              component: 'channel-resolver',
              projectId,
            });
            return null;
          }
        } else if (cwConfig.apiTokenEnvVar) {
          // Legacy fallback: process env var. Logged at warn level so we can
          // migrate remaining integrations off the global-env-var path.
          apiToken = process.env[cwConfig.apiTokenEnvVar];
          if (!apiToken) {
            logger.error(`Missing env var for Chatwoot API token: ${cwConfig.apiTokenEnvVar}`, {
              component: 'channel-resolver',
              projectId,
            });
            return null;
          }
          logger.warn('Chatwoot using legacy env var fallback — migrate to SecretService', {
            component: 'channel-resolver',
            projectId,
            apiTokenEnvVar: cwConfig.apiTokenEnvVar,
          });
        } else {
          logger.error('Chatwoot integration has no apiTokenSecretKey or apiTokenEnvVar', {
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

      case 'vapi': {
        const vapiConfig = config as VapiIntegrationConfig;
        try {
          const vapiApiKey = await secretService.get(projectId, vapiConfig.vapiApiKeySecretKey);
          return createVapiAdapter({
            vapiApiKey,
            assistantId: vapiConfig.assistantId,
            phoneNumberId: vapiConfig.phoneNumberId,
            projectId,
          });
        } catch {
          logger.error(`Failed to resolve VAPI secret: ${vapiConfig.vapiApiKeySecretKey}`, {
            component: 'channel-resolver',
            projectId,
          });
          return null;
        }
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
      // Check cache first (with TTL)
      const key = cacheKey(projectId, provider);
      const cached = adapterCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.adapter;
      }
      // Expired or missing — evict stale entry
      if (cached) {
        adapterCache.delete(key);
      }

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
        adapterCache.set(key, { adapter, expiresAt: Date.now() + cacheTtlMs });
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

      // Retry outbound sends to handle transient channel API failures.
      // Without retry, the agent's response is lost if the channel is
      // temporarily unavailable (e.g. WhatsApp 503 during maintenance).
      const MAX_SEND_RETRIES = 2;
      let lastError = '';

      for (let attempt = 0; attempt <= MAX_SEND_RETRIES; attempt++) {
        try {
          const result = await adapter.send(message);
          if (result.success) return result;

          // Non-exception failure (e.g. API returned error status)
          lastError = result.error ?? 'Unknown send error';

          if (attempt < MAX_SEND_RETRIES) {
            const delayMs = 1000 * 2 ** attempt; // 1s, 2s
            logger.warn(`Outbound send failed — retrying in ${delayMs}ms`, {
              component: 'channel-resolver',
              projectId,
              provider,
              attempt: attempt + 1,
              error: lastError,
            });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';

          if (attempt < MAX_SEND_RETRIES) {
            const delayMs = 1000 * 2 ** attempt;
            logger.warn(`Outbound send threw — retrying in ${delayMs}ms`, {
              component: 'channel-resolver',
              projectId,
              provider,
              attempt: attempt + 1,
              error: lastError,
            });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      logger.error(`Outbound send failed after ${MAX_SEND_RETRIES + 1} attempts`, {
        component: 'channel-resolver',
        projectId,
        provider,
        error: lastError,
      });
      return { success: false, error: lastError };
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
