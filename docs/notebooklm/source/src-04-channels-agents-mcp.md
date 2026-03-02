# Nexus Core — Source: Channels + Agents + MCP

Complete source code for channel adapters, agent system, and MCP integration.

---
## src/channels/types.ts
```typescript
import { z } from 'zod';
import type { ProjectId } from '@/core/types.js';

// ─── Channel Types ──────────────────────────────────────────────

export type ChannelType = 'whatsapp' | 'whatsapp-waha' | 'telegram' | 'slack' | 'email' | 'chatwoot';

// ─── Inbound Message ────────────────────────────────────────────

export interface InboundMessage {
  id: string;
  channel: ChannelType;
  channelMessageId: string;
  projectId: ProjectId;

  /** Sender identifier (phone, telegram user id, slack user id, etc.) */
  senderIdentifier: string;
  senderName?: string;

  /** Message content */
  content: string;
  mediaUrls?: string[];
  replyToChannelMessageId?: string;

  /** Raw payload for debugging */
  rawPayload: unknown;
  receivedAt: Date;
}

// ─── Outbound Message ───────────────────────────────────────────

export interface OutboundMessage {
  channel: ChannelType;
  /** Recipient identifier (phone, telegram chat id, slack channel, etc.) */
  recipientIdentifier: string;

  content: string;
  mediaUrls?: string[];
  replyToChannelMessageId?: string;

  options?: {
    parseMode?: 'markdown' | 'html';
    silent?: boolean;
  };
}

// ─── Send Result ────────────────────────────────────────────────

export interface SendResult {
  success: boolean;
  channelMessageId?: string;
  error?: string;
}

// ─── Channel Adapter ────────────────────────────────────────────

export interface ChannelAdapter {
  readonly channelType: ChannelType;

  /** Send a message through this channel */
  send(message: OutboundMessage): Promise<SendResult>;

  /** Parse an inbound webhook payload into an InboundMessage */
  parseInbound(payload: unknown): Promise<InboundMessage | null>;

  /** Check if the channel adapter is healthy */
  isHealthy(): Promise<boolean>;
}

// ─── Channel Config (legacy — env-var-based) ────────────────────

export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  /** Env var names, NOT actual tokens */
  accessTokenEnvVar?: string;
  botTokenEnvVar?: string;
  webhookSecretEnvVar?: string;
  /** WhatsApp specific */
  phoneNumberId?: string;
  apiVersion?: string;
}

// ─── Integration Providers ──────────────────────────────────────

export type ChannelIntegrationId = string;
export type IntegrationProvider = 'chatwoot' | 'telegram' | 'whatsapp' | 'whatsapp-waha' | 'slack';

// ─── Per-Provider Integration Configs ───────────────────────────

/** Chatwoot-specific integration config stored in the JSON column. */
export interface ChatwootIntegrationConfig {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  agentBotId: number;
  /** Env var name for the Chatwoot API token (NOT the token itself). */
  apiTokenEnvVar: string;
}

/** Telegram integration config — references secret keys in the secrets table. */
export interface TelegramIntegrationConfig {
  /** Key in the secrets table for the bot token. */
  botTokenSecretKey: string;
}

/** WhatsApp Cloud API integration config. */
export interface WhatsAppIntegrationConfig {
  /** Key in the secrets table for the access token. */
  accessTokenSecretKey: string;
  /** WhatsApp Business Phone Number ID. */
  phoneNumberId: string;
  /** API version (default: v18.0). */
  apiVersion?: string;
  /** Key in the secrets table for the webhook verify token. */
  verifyTokenSecretKey?: string;
}

/** WhatsApp WAHA (QR-based) integration config. */
export interface WhatsAppWahaIntegrationConfig {
  /** Base URL of the WAHA instance (e.g. "http://localhost:3003"). */
  wahaBaseUrl: string;
  /** WAHA session name (default: "default"). */
  sessionName?: string;
}

/** Slack integration config. */
export interface SlackIntegrationConfig {
  /** Key in the secrets table for the bot token (xoxb-...). */
  botTokenSecretKey: string;
  /** Key in the secrets table for the signing secret (webhook verification). */
  signingSecretSecretKey?: string;
}

/** Union of all per-provider integration configs. */
export type IntegrationConfigUnion =
  | ChatwootIntegrationConfig
  | TelegramIntegrationConfig
  | WhatsAppIntegrationConfig
  | WhatsAppWahaIntegrationConfig
  | SlackIntegrationConfig;

/** Map from provider to its config type. */
export interface IntegrationConfigMap {
  chatwoot: ChatwootIntegrationConfig;
  telegram: TelegramIntegrationConfig;
  whatsapp: WhatsAppIntegrationConfig;
  'whatsapp-waha': WhatsAppWahaIntegrationConfig;
  slack: SlackIntegrationConfig;
}

// ─── Zod Schemas for Integration Configs ────────────────────────

export const ChatwootIntegrationConfigSchema = z.object({
  baseUrl: z.string().url(),
  accountId: z.number().int().positive(),
  inboxId: z.number().int().positive(),
  agentBotId: z.number().int().positive(),
  apiTokenEnvVar: z.string().min(1),
});

export const TelegramIntegrationConfigSchema = z.object({
  botTokenSecretKey: z.string().min(1).max(128),
});

export const WhatsAppIntegrationConfigSchema = z.object({
  accessTokenSecretKey: z.string().min(1).max(128),
  phoneNumberId: z.string().min(1),
  apiVersion: z.string().optional(),
  verifyTokenSecretKey: z.string().min(1).max(128).optional(),
});

export const WhatsAppWahaIntegrationConfigSchema = z.object({
  wahaBaseUrl: z.string().url(),
  sessionName: z.string().min(1).max(64).optional(),
});

export const SlackIntegrationConfigSchema = z.object({
  botTokenSecretKey: z.string().min(1).max(128),
  signingSecretSecretKey: z.string().min(1).max(128).optional(),
});

/** Discriminated union for creating integrations via API. */
export const CreateIntegrationConfigSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('chatwoot'), config: ChatwootIntegrationConfigSchema }),
  z.object({ provider: z.literal('telegram'), config: TelegramIntegrationConfigSchema }),
  z.object({ provider: z.literal('whatsapp'), config: WhatsAppIntegrationConfigSchema }),
  z.object({ provider: z.literal('whatsapp-waha'), config: WhatsAppWahaIntegrationConfigSchema }),
  z.object({ provider: z.literal('slack'), config: SlackIntegrationConfigSchema }),
]);

// ─── Channel Integration ───────────────────────────────────────

/** Channel integration record — maps a project to an external channel provider. */
export interface ChannelIntegration {
  id: ChannelIntegrationId;
  projectId: ProjectId;
  provider: IntegrationProvider;
  config: IntegrationConfigUnion;
  status: 'active' | 'paused';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChannelIntegrationInput {
  projectId: ProjectId;
  provider: IntegrationProvider;
  config: IntegrationConfigUnion;
  status?: 'active' | 'paused';
}

export interface UpdateChannelIntegrationInput {
  config?: IntegrationConfigUnion;
  status?: 'active' | 'paused';
}

/** Repository for channel integrations. */
export interface ChannelIntegrationRepository {
  create(input: CreateChannelIntegrationInput): Promise<ChannelIntegration>;
  findById(id: ChannelIntegrationId): Promise<ChannelIntegration | null>;
  findByProject(projectId: ProjectId): Promise<ChannelIntegration[]>;
  findByProjectAndProvider(projectId: ProjectId, provider: IntegrationProvider): Promise<ChannelIntegration | null>;
  findByProviderAccount(provider: IntegrationProvider, accountId: number): Promise<ChannelIntegration | null>;
  update(id: ChannelIntegrationId, input: UpdateChannelIntegrationInput): Promise<ChannelIntegration>;
  delete(id: ChannelIntegrationId): Promise<void>;
  listActive(): Promise<ChannelIntegration[]>;
}
```

---
## src/channels/channel-resolver.ts
```typescript
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
  WhatsAppWahaIntegrationConfig,
} from './types.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { createWhatsAppAdapter } from './adapters/whatsapp.js';
import { createWhatsAppWahaAdapter } from './adapters/whatsapp-waha.js';
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
```

---
## src/channels/inbound-processor.ts
```typescript
/**
 * Inbound Processor — handles incoming messages from channels.
 *
 * Responsibilities:
 * 1. Resolve or create contact from sender identifier
 * 2. Find or create session for the contact
 * 3. Run the agent with the message
 * 4. Send the response back via the same channel
 */
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { ChannelResolver } from './channel-resolver.js';
import type { ChannelType, InboundMessage, IntegrationProvider, SendResult } from './types.js';
import type { ContactRepository, ChannelIdentifier } from '@/contacts/types.js';
import type { SessionRepository, Session } from '@/infrastructure/repositories/session-repository.js';
import type { AgentChannelRouter } from './agent-channel-router.js';

// ─── Types ──────────────────────────────────────────────────────

export interface InboundProcessorDeps {
  channelResolver: ChannelResolver;
  contactRepository: ContactRepository;
  sessionRepository: SessionRepository;
  logger: Logger;
  /** Optional agent-channel router for mode-aware agent resolution. */
  agentChannelRouter?: AgentChannelRouter;
  /** Function to run the agent and get a response */
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    agentId?: string;
    sourceChannel?: string;
    contactRole?: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

export interface InboundProcessor {
  /** Process an incoming message through the full pipeline */
  process(message: InboundMessage): Promise<SendResult>;
}

// ─── Helper: Channel to Identifier ──────────────────────────────

function channelToIdentifier(channel: ChannelType, value: string): ChannelIdentifier {
  switch (channel) {
    case 'telegram':
      return { type: 'telegramId', value };
    case 'whatsapp':
    case 'whatsapp-waha':
      return { type: 'phone', value };
    case 'slack':
      return { type: 'slackId', value };
    case 'email':
      return { type: 'email', value };
    case 'chatwoot':
      // Chatwoot conversations are identified by conversation ID, stored as phone
      return { type: 'phone', value };
  }
}

/** Check if a ChannelType is a valid IntegrationProvider (i.e. has a channel integration). */
function isIntegrationProvider(channel: ChannelType): channel is IntegrationProvider {
  return channel === 'whatsapp' || channel === 'whatsapp-waha' || channel === 'telegram' || channel === 'slack' || channel === 'chatwoot';
}

// ─── Processor Factory ──────────────────────────────────────────

/**
 * Create an InboundProcessor that handles the full message flow.
 */
export function createInboundProcessor(deps: InboundProcessorDeps): InboundProcessor {
  const {
    channelResolver,
    contactRepository,
    sessionRepository,
    logger,
    agentChannelRouter,
    runAgent,
  } = deps;

  return {
    async process(message: InboundMessage): Promise<SendResult> {
      const startTime = Date.now();

      logger.info('Processing inbound message', {
        component: 'inbound-processor',
        channel: message.channel,
        sender: message.senderIdentifier,
        messageId: message.id,
      });

      try {
        const projectId = message.projectId;

        // Validate channel is a supported integration provider
        if (!isIntegrationProvider(message.channel)) {
          logger.error('Channel cannot be sent via ChannelResolver', {
            component: 'inbound-processor',
            channel: message.channel,
          });
          return { success: false, error: `Channel '${message.channel}' is not a supported integration provider` };
        }

        // 1. Resolve or create contact
        const identifier = channelToIdentifier(message.channel, message.senderIdentifier);
        let contact = await contactRepository.findByChannel(projectId, identifier);

        if (!contact) {
          contact = await contactRepository.create({
            projectId,
            name: message.senderName ?? message.senderIdentifier,
            [identifier.type]: identifier.value,
          });

          logger.info('Created new contact', {
            component: 'inbound-processor',
            contactId: contact.id,
            channel: message.channel,
          });
        }

        // 1b. Resolve agent for this channel (mode-aware routing)
        let resolvedAgentId: string | undefined;
        if (agentChannelRouter) {
          const match = await agentChannelRouter.resolveAgent(
            projectId,
            message.channel,
            contact.role,
          );
          if (match) {
            resolvedAgentId = match.agentId;
            logger.info('Agent resolved for channel', {
              component: 'inbound-processor',
              agentId: match.agentId,
              modeName: match.mode.modeName,
              channel: message.channel,
            });
          }
        }

        // 2. Find or create session for this contact
        const sessions = await sessionRepository.listByProject(projectId, 'active');
        let session: Session | null = null;

        // Try to find an existing active session for this contact
        for (const s of sessions) {
          const metadata = s.metadata;
          if (metadata?.['contactId'] === contact.id) {
            session = s;
            break;
          }
        }

        if (!session) {
          session = await sessionRepository.create({
            projectId,
            metadata: {
              contactId: contact.id,
              channel: message.channel,
              recipientIdentifier: message.senderIdentifier,
              ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
            },
          });

          logger.info('Created new session', {
            component: 'inbound-processor',
            sessionId: session.id,
            contactId: contact.id,
          });
        } else if (!session.metadata?.['recipientIdentifier'] || !session.metadata['channel']) {
          // Backfill channel routing metadata on sessions that were created without it
          // (e.g. from dashboard chat). This is needed for resumeAfterApproval to route responses.
          const updatedMetadata = {
            ...session.metadata,
            channel: session.metadata?.['channel'] ?? message.channel,
            recipientIdentifier: session.metadata?.['recipientIdentifier'] ?? message.senderIdentifier,
          };
          await sessionRepository.updateMetadata(session.id, updatedMetadata);
          session = { ...session, metadata: updatedMetadata };
        }

        // 3. Run the agent (with mode-aware params)
        const agentResult = await runAgent({
          projectId,
          sessionId: session.id,
          agentId: resolvedAgentId,
          sourceChannel: message.channel,
          contactRole: contact.role,
          userMessage: message.content,
        });

        // 4. Send response back via the same channel
        const sendResult = await channelResolver.send(projectId, message.channel, {
          channel: message.channel,
          recipientIdentifier: message.senderIdentifier,
          content: agentResult.response,
          replyToChannelMessageId: message.channelMessageId,
        });

        const durationMs = Date.now() - startTime;

        logger.info('Processed inbound message', {
          component: 'inbound-processor',
          channel: message.channel,
          contactId: contact.id,
          sessionId: session.id,
          success: sendResult.success,
          durationMs,
        });

        return sendResult;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logger.error('Failed to process inbound message', {
          component: 'inbound-processor',
          channel: message.channel,
          sender: message.senderIdentifier,
          error: errorMessage,
        });

        return {
          success: false,
          error: `Failed to process message: ${errorMessage}`,
        };
      }
    },
  };
}
```

---
## src/channels/proactive.ts
```typescript
/**
 * Proactive Messenger — sends messages to contacts without them initiating.
 *
 * Supports:
 * - Immediate sending
 * - Scheduled sending via BullMQ
 */
import type { Queue, Job } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { ContactId } from '@/contacts/types.js';
import type { ChannelResolver } from './channel-resolver.js';
import type { ChannelType, IntegrationProvider, SendResult } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ProactiveMessageRequest {
  /** Project that owns the channel integration */
  projectId: ProjectId;
  /** Contact ID (for tracking) */
  contactId: ContactId;
  /** Channel to send through */
  channel: ChannelType;
  /** Recipient identifier (phone, chat id, etc.) */
  recipientIdentifier: string;
  /** Message content */
  content: string;
  /** Optional: schedule for later */
  scheduledFor?: Date;
  /** Optional: metadata for tracking */
  metadata?: Record<string, unknown>;
}

export interface ProactiveMessenger {
  /** Send a message immediately */
  send(request: ProactiveMessageRequest): Promise<SendResult>;

  /** Schedule a message for later (returns job ID) */
  schedule(request: ProactiveMessageRequest): Promise<string>;

  /** Cancel a scheduled message */
  cancel(jobId: string): Promise<boolean>;
}

// ─── Job Data ───────────────────────────────────────────────────

export interface ProactiveMessageJobData {
  projectId: ProjectId;
  contactId: ContactId;
  channel: ChannelType;
  recipientIdentifier: string;
  content: string;
  metadata?: Record<string, unknown>;
}

// ─── Queue Name ─────────────────────────────────────────────────

export const PROACTIVE_MESSAGE_QUEUE = 'proactive-messages';

// ─── Messenger Factory ──────────────────────────────────────────

/** Type guard: checks if a ChannelType is a supported IntegrationProvider. */
function isIntegrationProvider(channel: ChannelType): channel is IntegrationProvider {
  return channel === 'whatsapp' || channel === 'telegram' || channel === 'slack' || channel === 'chatwoot';
}

export interface ProactiveMessengerDeps {
  channelResolver: ChannelResolver;
  queue: Queue<ProactiveMessageJobData>;
  logger: Logger;
}

/**
 * Create a ProactiveMessenger for sending scheduled/immediate messages.
 */
export function createProactiveMessenger(deps: ProactiveMessengerDeps): ProactiveMessenger {
  const { channelResolver, queue, logger } = deps;

  return {
    async send(request: ProactiveMessageRequest): Promise<SendResult> {
      logger.info('Sending proactive message', {
        component: 'proactive-messenger',
        contactId: request.contactId,
        channel: request.channel,
      });

      if (!isIntegrationProvider(request.channel)) {
        return { success: false, error: `Channel '${request.channel}' is not a supported integration provider` };
      }

      return channelResolver.send(request.projectId, request.channel, {
        channel: request.channel,
        recipientIdentifier: request.recipientIdentifier,
        content: request.content,
      });
    },

    async schedule(request: ProactiveMessageRequest): Promise<string> {
      const delay = request.scheduledFor
        ? Math.max(0, request.scheduledFor.getTime() - Date.now())
        : 0;

      const jobData: ProactiveMessageJobData = {
        projectId: request.projectId,
        contactId: request.contactId,
        channel: request.channel,
        recipientIdentifier: request.recipientIdentifier,
        content: request.content,
        metadata: request.metadata,
      };

      const job = await queue.add('send', jobData, {
        delay,
        removeOnComplete: true,
        removeOnFail: { count: 10 },
      });

      logger.info('Scheduled proactive message', {
        component: 'proactive-messenger',
        jobId: job.id,
        contactId: request.contactId,
        channel: request.channel,
        scheduledFor: request.scheduledFor?.toISOString(),
        delayMs: delay,
      });

      return job.id ?? '';
    },

    async cancel(jobId: string): Promise<boolean> {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          logger.info('Cancelled proactive message', {
            component: 'proactive-messenger',
            jobId,
          });
          return true;
        }
        return false;
      } catch (error) {
        logger.warn('Failed to cancel proactive message', {
          component: 'proactive-messenger',
          jobId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return false;
      }
    },
  };
}

// ─── Worker Handler ─────────────────────────────────────────────

/**
 * Create a job handler for the proactive message queue.
 * Use this with BullMQ Worker.
 */
export function createProactiveMessageHandler(deps: {
  channelResolver: ChannelResolver;
  logger: Logger;
}): (job: Job<ProactiveMessageJobData>) => Promise<SendResult> {
  const { channelResolver, logger } = deps;

  return async (job: Job<ProactiveMessageJobData>): Promise<SendResult> => {
    const { data } = job;

    logger.info('Processing scheduled proactive message', {
      component: 'proactive-message-worker',
      jobId: job.id,
      contactId: data.contactId,
      channel: data.channel,
    });

    if (!isIntegrationProvider(data.channel)) {
      const error = `Channel '${data.channel}' is not a supported integration provider`;
      logger.error(error, { component: 'proactive-message-worker', jobId: job.id });
      return { success: false, error };
    }

    const result = await channelResolver.send(data.projectId, data.channel, {
      channel: data.channel,
      recipientIdentifier: data.recipientIdentifier,
      content: data.content,
    });

    if (result.success) {
      logger.info('Sent scheduled proactive message', {
        component: 'proactive-message-worker',
        jobId: job.id,
        channelMessageId: result.channelMessageId,
      });
    } else {
      logger.error('Failed to send scheduled proactive message', {
        component: 'proactive-message-worker',
        jobId: job.id,
        error: result.error,
      });
    }

    return result;
  };
}
```

---
## src/channels/handoff.ts
```typescript
/**
 * Handoff Manager — detects when AI should escalate to a human agent.
 *
 * Signals for escalation:
 * - Agent response contains a handoff marker (e.g. [HANDOFF])
 * - Customer sends escalation keywords (e.g. "hablar con humano")
 * - Configurable turn limit exceeded without resolution
 */
import type { Logger } from '@/observability/logger.js';
import type { ChatwootAdapter } from './adapters/chatwoot.js';

// ─── Types ──────────────────────────────────────────────────────

export interface HandoffConfig {
  /** Marker string the AI includes in response to trigger handoff. */
  handoffMarker: string;
  /** Keywords the customer can send to request a human. */
  escalationKeywords: string[];
  /** Max conversation turns before auto-escalation (0 = disabled). */
  maxTurnsBeforeEscalation: number;
}

export interface HandoffManager {
  /** Check if an AI response signals handoff. */
  shouldEscalateFromResponse(response: string): boolean;
  /** Check if a customer message requests human escalation. */
  shouldEscalateFromMessage(message: string): boolean;
  /** Execute handoff: transfer conversation to human agent in Chatwoot. */
  escalate(conversationId: number, adapter: ChatwootAdapter, reason: string): Promise<void>;
  /** Resume bot handling after human resolves. */
  resume(conversationId: number, adapter: ChatwootAdapter): Promise<void>;
  /** Strip the handoff marker from the response (so customer doesn't see it). */
  stripHandoffMarker(response: string): string;
}

export interface HandoffManagerDeps {
  config: HandoffConfig;
  logger: Logger;
}

// ─── Default Config ─────────────────────────────────────────────

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  handoffMarker: '[HANDOFF]',
  escalationKeywords: [
    'hablar con humano',
    'agente humano',
    'quiero hablar con una persona',
    'operador',
    'talk to human',
    'speak to agent',
    'human agent',
  ],
  maxTurnsBeforeEscalation: 0, // disabled by default
};

// ─── Handoff Factory ────────────────────────────────────────────

/**
 * Create a HandoffManager that detects escalation signals and transfers
 * conversations to human agents via Chatwoot.
 */
export function createHandoffManager(deps: HandoffManagerDeps): HandoffManager {
  const { config, logger } = deps;

  const keywordsLower = config.escalationKeywords.map(k => k.toLowerCase());

  return {
    shouldEscalateFromResponse(response: string): boolean {
      return response.includes(config.handoffMarker);
    },

    shouldEscalateFromMessage(message: string): boolean {
      const messageLower = message.toLowerCase().trim();
      return keywordsLower.some(keyword => messageLower.includes(keyword));
    },

    async escalate(
      conversationId: number,
      adapter: ChatwootAdapter,
      reason: string,
    ): Promise<void> {
      logger.info('Escalating conversation to human agent', {
        component: 'handoff',
        conversationId,
        reason,
      });

      const note = `Escalacion automatica: ${reason}\n\nEl agente AI ha transferido esta conversacion a un agente humano.`;

      await adapter.handoffToHuman(conversationId, note);

      logger.info('Conversation escalated to human', {
        component: 'handoff',
        conversationId,
      });
    },

    async resume(conversationId: number, adapter: ChatwootAdapter): Promise<void> {
      logger.info('Resuming bot for conversation', {
        component: 'handoff',
        conversationId,
      });

      await adapter.resumeBot(conversationId);

      logger.info('Bot resumed for conversation', {
        component: 'handoff',
        conversationId,
      });
    },

    stripHandoffMarker(response: string): string {
      return response.replace(config.handoffMarker, '').trim();
    },
  };
}
```

---
## src/channels/webhook-queue.ts
```typescript
/**
 * Webhook Queue — BullMQ queue for async webhook processing with retry.
 *
 * Flow:
 * 1. Webhook endpoint validates HMAC, resolves project, enqueues job → 200 OK
 * 2. Worker picks up job, processes via InboundProcessor → sends response
 * 3. On failure: automatic retry (3 attempts, exponential backoff)
 *
 * Conditional startup: only starts if REDIS_URL is set.
 */
import { Queue, Worker } from 'bullmq';
import type { ProjectId } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';
import type { InboundProcessor } from './inbound-processor.js';
import type { ChatwootAdapter } from './adapters/chatwoot.js';
import type { HandoffManager } from './handoff.js';
import type { WebhookJobData, WebhookJobResult } from './webhook-queue-types.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface WebhookQueueOptions {
  logger: Logger;
  /** Redis connection URL. */
  redisUrl: string;
  /** Callback to resolve Chatwoot adapter for a project. */
  resolveAdapter: (projectId: ProjectId | string) => Promise<ChatwootAdapter | null>;
  /** InboundProcessor for handling messages. */
  inboundProcessor: InboundProcessor;
  /** HandoffManager for escalations. */
  handoffManager: HandoffManager;
  /** Callback to run agent and get response. */
  runAgent: (params: {
    projectId: ProjectId | string;
    sessionId: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

export interface WebhookQueue {
  /** Enqueue a webhook job for async processing. */
  enqueue(data: WebhookJobData): Promise<void>;
  /** Start the worker. */
  start(): Promise<void>;
  /** Stop the worker and close queue. */
  stop(): Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Parse Redis URL into host/port/password for BullMQ connection. */
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password ? parsed.password : undefined,
  };
}

// ─── Factory ────────────────────────────────────────────────────────

const QUEUE_NAME = 'webhook-processing';

/** Create a WebhookQueue backed by BullMQ. */
export function createWebhookQueue(options: WebhookQueueOptions): WebhookQueue {
  const {
    logger,
    redisUrl,
    resolveAdapter,
    handoffManager,
    runAgent,
  } = options;

  const connection = parseRedisUrl(redisUrl);

  let queue: Queue<WebhookJobData, WebhookJobResult> | null = null;
  let worker: Worker<WebhookJobData, WebhookJobResult> | null = null;

  return {
    async enqueue(data: WebhookJobData): Promise<void> {
      if (!queue) {
        throw new Error('WebhookQueue not started');
      }

      await queue.add(
        `webhook-${data.webhookId}`,
        data,
        {
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 2000, // Start with 2s, then 4s, then 8s
          },
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 100, // Keep last 100 failed jobs
        },
      );

      logger.debug('Webhook job enqueued', {
        component: 'webhook-queue',
        webhookId: data.webhookId,
        projectId: data.projectId,
        conversationId: data.conversationId,
      });
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async start(): Promise<void> {
      queue = new Queue<WebhookJobData, WebhookJobResult>(QUEUE_NAME, { connection });

      worker = new Worker<WebhookJobData, WebhookJobResult>(
        QUEUE_NAME,
        async (job) => {
          const startTime = Date.now();
          const { projectId, event, conversationId, webhookId } = job.data;

          logger.info('Processing webhook job', {
            component: 'webhook-queue',
            webhookId,
            projectId,
            conversationId,
            attempt: job.attemptsMade + 1,
          });

          try {
            // Resolve adapter
            const adapter = await resolveAdapter(projectId);
            if (!adapter) {
              throw new Error(`No adapter found for project ${projectId}`);
            }

            // Check for escalation keywords in message
            if (event.content && handoffManager.shouldEscalateFromMessage(event.content)) {
              if (conversationId !== undefined) {
                await handoffManager.escalate(
                  conversationId,
                  adapter,
                  'Cliente solicito agente humano',
                );
              }

              const durationMs = Date.now() - startTime;
              logger.info('Webhook escalated to human', {
                component: 'webhook-queue',
                webhookId,
                conversationId,
                durationMs,
              });

              return {
                success: true,
                escalated: true,
                durationMs,
              };
            }

            // Parse message from event
            const message = await adapter.parseInbound(event);
            if (!message) {
              logger.warn('No message parsed from webhook', {
                component: 'webhook-queue',
                webhookId,
                eventType: event.event,
              });
              return {
                success: true, // Not an error, just nothing to process
                durationMs: Date.now() - startTime,
              };
            }

            // Run agent
            const result = await runAgent({
              projectId,
              sessionId: `cw-${String(conversationId ?? 'unknown')}`,
              userMessage: message.content,
            });

            let responseText = result.response;

            // Check if agent wants to hand off
            if (handoffManager.shouldEscalateFromResponse(responseText)) {
              responseText = handoffManager.stripHandoffMarker(responseText);

              // Send response before escalating (if any)
              if (responseText && conversationId !== undefined) {
                await adapter.send({
                  channel: 'chatwoot',
                  recipientIdentifier: String(conversationId),
                  content: responseText,
                });
              }

              // Escalate
              if (conversationId !== undefined) {
                await handoffManager.escalate(
                  conversationId,
                  adapter,
                  'El agente AI determino que se requiere asistencia humana',
                );
              }

              const durationMs = Date.now() - startTime;
              logger.info('Webhook processed with escalation', {
                component: 'webhook-queue',
                webhookId,
                conversationId,
                durationMs,
              });

              return {
                success: true,
                response: responseText,
                escalated: true,
                durationMs,
              };
            }

            // Send response
            if (conversationId !== undefined) {
              await adapter.send({
                channel: 'chatwoot',
                recipientIdentifier: String(conversationId),
                content: responseText,
              });
            }

            const durationMs = Date.now() - startTime;
            logger.info('Webhook processed successfully', {
              component: 'webhook-queue',
              webhookId,
              conversationId,
              durationMs,
            });

            return {
              success: true,
              response: responseText,
              durationMs,
            };
          } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error('Webhook processing failed', {
              component: 'webhook-queue',
              webhookId,
              conversationId,
              attempt: job.attemptsMade + 1,
              error: errorMessage,
              durationMs,
            });

            // Re-throw to trigger BullMQ retry
            throw error;
          }
        },
        {
          connection,
          concurrency: 5, // Process up to 5 webhooks concurrently
        },
      );

      worker.on('error', (error) => {
        logger.error('BullMQ worker error', {
          component: 'webhook-queue',
          error: error.message,
        });
      });

      worker.on('failed', (job, error) => {
        if (job) {
          logger.error('Webhook job failed permanently', {
            component: 'webhook-queue',
            webhookId: job.data.webhookId,
            conversationId: job.data.conversationId,
            attempts: job.attemptsMade,
            error: error.message,
          });
        }
      });

      logger.info('Webhook queue started', {
        component: 'webhook-queue',
        queueName: QUEUE_NAME,
        concurrency: 5,
      });
    },

    async stop(): Promise<void> {
      if (worker) {
        await worker.close();
        worker = null;
      }

      if (queue) {
        await queue.close();
        queue = null;
      }

      logger.info('Webhook queue stopped', { component: 'webhook-queue' });
    },
  };
}
```

---
## src/channels/agent-channel-router.ts
```typescript
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
```

---
## src/channels/index.ts
```typescript
// Types
export * from './types.js';

// Router
export { createChannelRouter } from './channel-router.js';
export type { ChannelRouter, ChannelRouterDeps } from './channel-router.js';

// Channel Resolver
export { createChannelResolver } from './channel-resolver.js';
export type { ChannelResolver, ChannelResolverDeps } from './channel-resolver.js';

// Inbound Processor
export { createInboundProcessor } from './inbound-processor.js';
export type { InboundProcessor, InboundProcessorDeps } from './inbound-processor.js';

// Agent-Channel Router
export { createAgentChannelRouter, checkChannelCollision } from './agent-channel-router.js';
export type {
  AgentChannelRouter,
  AgentChannelRouterDeps,
  AgentChannelMatch,
} from './agent-channel-router.js';

// Handoff
export { createHandoffManager, DEFAULT_HANDOFF_CONFIG } from './handoff.js';
export type { HandoffManager, HandoffManagerDeps, HandoffConfig } from './handoff.js';

// Proactive Messenger
export {
  createProactiveMessenger,
  createProactiveMessageHandler,
  PROACTIVE_MESSAGE_QUEUE,
} from './proactive.js';
export type {
  ProactiveMessenger,
  ProactiveMessengerDeps,
  ProactiveMessageRequest,
  ProactiveMessageJobData,
} from './proactive.js';

// Webhook Queue
export { createWebhookQueue } from './webhook-queue.js';
export type { WebhookQueue, WebhookQueueOptions } from './webhook-queue.js';
export type { WebhookJobData, WebhookJobResult } from './webhook-queue-types.js';

// Adapters
export {
  createTelegramAdapter,
  createWhatsAppAdapter,
  createSlackAdapter,
  getSlackUrlChallenge,
  createChatwootAdapter,
} from './adapters/index.js';
export type {
  TelegramAdapterConfig,
  WhatsAppAdapterConfig,
  SlackAdapterConfig,
  ChatwootAdapterConfig,
  ChatwootAdapter,
  ChatwootWebhookEvent,
} from './adapters/index.js';
```

---
## src/channels/adapters/telegram.ts
```typescript
/**
 * Telegram Channel Adapter — sends/receives messages via Telegram Bot API.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface TelegramAdapterConfig {
  /** Direct bot token (resolved by caller from secrets). */
  botToken: string;
  /** Project ID for tagging inbound messages. */
  projectId: ProjectId;
}

// ─── Telegram API Types ─────────────────────────────────────────

interface TelegramSendResponse {
  ok: boolean;
  result?: {
    message_id: number;
  };
  description?: string;
}

interface TelegramUpdate {
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: {
      id: number;
      type: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    from?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    reply_to_message?: {
      message_id: number;
    };
    photo?: { file_id: string }[];
    document?: { file_id: string };
  };
}

// ─── Adapter Factory ────────────────────────────────────────────

/**
 * Create a Telegram channel adapter.
 */
export function createTelegramAdapter(config: TelegramAdapterConfig): ChannelAdapter {
  const baseUrl = `https://api.telegram.org/bot${config.botToken}`;

  return {
    channelType: 'telegram',

    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const parseMode = message.options?.parseMode === 'html' ? 'HTML' : 'Markdown';

        const body: Record<string, unknown> = {
          chat_id: message.recipientIdentifier,
          text: message.content,
          parse_mode: parseMode,
          disable_notification: message.options?.silent ?? false,
        };

        if (message.replyToChannelMessageId) {
          body['reply_to_message_id'] = Number(message.replyToChannelMessageId);
        }

        const response = await fetch(`${baseUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as unknown as TelegramSendResponse;

        if (data.ok && data.result) {
          return {
            success: true,
            channelMessageId: String(data.result.message_id),
          };
        }

        return {
          success: false,
          error: data.description ?? 'Unknown Telegram error',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },

    parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const update = payload as TelegramUpdate;
      const message = update.message;

      if (!message) return Promise.resolve(null);

      const text = message.text;
      if (!text) return Promise.resolve(null); // Skip non-text messages for now

      const chat = message.chat;
      const from = message.from;

      // Build sender name
      let senderName: string | undefined;
      if (from) {
        const parts = [from.first_name, from.last_name].filter(Boolean);
        senderName = parts.length > 0 ? parts.join(' ') : from.username;
      }

      return Promise.resolve({
        id: `tg-${message.message_id}`,
        channel: 'telegram' as const,
        channelMessageId: String(message.message_id),
        projectId: config.projectId,
        senderIdentifier: String(chat.id),
        senderName,
        content: text,
        replyToChannelMessageId: message.reply_to_message
          ? String(message.reply_to_message.message_id)
          : undefined,
        rawPayload: payload,
        receivedAt: new Date(message.date * 1000),
      });
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl}/getMe`);
        const data = (await response.json()) as unknown as { ok: boolean };
        return data.ok;
      } catch {
        return false;
      }
    },
  };
}
```

---
## src/channels/adapters/slack.ts
```typescript
/**
 * Slack Channel Adapter — sends/receives messages via Slack Web API.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface SlackAdapterConfig {
  /** Direct bot token (resolved by caller from secrets). */
  botToken: string;
  /** Signing secret for webhook verification (resolved by caller). */
  signingSecret?: string;
  /** Project ID for tagging inbound messages. */
  projectId: ProjectId;
}

// ─── Slack API Types ────────────────────────────────────────────

interface SlackSendResponse {
  ok: boolean;
  channel?: string;
  ts?: string;
  message?: {
    text: string;
    ts: string;
  };
  error?: string;
}

interface SlackEventPayload {
  type: string;
  challenge?: string;
  event?: {
    type: string;
    channel: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
    event_ts: string;
  };
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
}

// ─── Adapter Factory ────────────────────────────────────────────

/**
 * Create a Slack channel adapter.
 */
export function createSlackAdapter(config: SlackAdapterConfig): ChannelAdapter {
  return {
    channelType: 'slack',

    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const body: Record<string, unknown> = {
          channel: message.recipientIdentifier,
          text: message.content,
        };

        if (message.replyToChannelMessageId) {
          body['thread_ts'] = message.replyToChannelMessageId;
        }

        // Use mrkdwn for markdown support
        if (message.options?.parseMode === 'markdown') {
          body['mrkdwn'] = true;
        }

        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${config.botToken}`,
          },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as unknown as SlackSendResponse;

        if (data.ok && data.ts) {
          return {
            success: true,
            channelMessageId: data.ts,
          };
        }

        return {
          success: false,
          error: data.error ?? 'Unknown Slack error',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },

    parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const event = payload as SlackEventPayload;

      // Handle URL verification challenge
      if (event.type === 'url_verification') {
        // This should be handled at the route level, not here
        return Promise.resolve(null);
      }

      // Handle message events
      if (event.event?.type !== 'message') return Promise.resolve(null);

      const messageEvent = event.event;

      // Skip bot messages to avoid loops
      if (!messageEvent.user) return Promise.resolve(null);

      return Promise.resolve({
        id: `slack-${messageEvent.ts}`,
        channel: 'slack' as const,
        channelMessageId: messageEvent.ts,
        projectId: config.projectId,
        senderIdentifier: messageEvent.channel,
        senderName: messageEvent.user, // This is user ID, would need API call for name
        content: messageEvent.text,
        replyToChannelMessageId: messageEvent.thread_ts,
        rawPayload: payload,
        receivedAt: new Date(Number(messageEvent.event_ts) * 1000),
      });
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch('https://slack.com/api/auth.test', {
          headers: {
            'Authorization': `Bearer ${config.botToken}`,
          },
        });
        const data = (await response.json()) as unknown as { ok: boolean };
        return data.ok;
      } catch {
        return false;
      }
    },
  };
}

// ─── URL Verification Helper ────────────────────────────────────

/**
 * Check if a Slack webhook payload is a URL verification challenge.
 * Returns the challenge string if so, null otherwise.
 */
export function getSlackUrlChallenge(payload: unknown): string | null {
  const event = payload as SlackEventPayload;
  if (event.type === 'url_verification' && event.challenge) {
    return event.challenge;
  }
  return null;
}
```

---
## src/channels/adapters/chatwoot.ts
```typescript
/**
 * Chatwoot Channel Adapter — sends/receives messages via Chatwoot Agent Bot API.
 *
 * Chatwoot acts as the channel hub (handles WhatsApp, Telegram, etc.)
 * and forwards messages to Nexus via the Agent Bot webhook.
 * Nexus responds back via the Chatwoot API.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface ChatwootAdapterConfig {
  /** Chatwoot instance base URL (e.g. https://chatwoot.fomo.ai) */
  baseUrl: string;
  /** Chatwoot API access token */
  apiToken: string;
  /** Chatwoot account ID */
  accountId: number;
  /** Agent Bot ID assigned to this project */
  agentBotId: number;
  /** Project ID in Nexus for this integration */
  projectId: ProjectId;
}

// ─── Chatwoot API Types ─────────────────────────────────────────

/** Chatwoot webhook event payload for Agent Bot. */
export interface ChatwootWebhookEvent {
  event: 'message_created' | 'message_updated' | 'conversation_created' |
    'conversation_status_changed' | 'conversation_updated';
  id?: string;
  account?: {
    id: number;
    name?: string;
  };
  conversation?: {
    id: number;
    status?: string;
    inbox_id?: number;
    contact_inbox?: {
      source_id?: string;
    };
    additional_attributes?: Record<string, unknown>;
  };
  message_type?: 'incoming' | 'outgoing' | 'activity' | 'template';
  content_type?: string;
  content?: string;
  sender?: {
    id: number;
    name?: string;
    email?: string;
    phone_number?: string;
    type?: 'contact' | 'user';
  };
}

interface ChatwootSendMessageResponse {
  id: number;
  content: string;
  message_type: string;
  created_at: number;
  error?: string;
}

interface ChatwootAssignmentResponse {
  id: number;
  error?: string;
}

// ─── Extended Adapter Interface ─────────────────────────────────

export interface ChatwootAdapter extends ChannelAdapter {
  /** Hand off conversation to a human agent in Chatwoot. */
  handoffToHuman(conversationId: number, note?: string): Promise<void>;
  /** Resume bot handling for a conversation. */
  resumeBot(conversationId: number): Promise<void>;
  /** Get the account ID for this adapter. */
  readonly accountId: number;
  /** Get the project ID for this adapter. */
  readonly projectId: ProjectId;
}

// ─── Adapter Factory ────────────────────────────────────────────

/**
 * Create a Chatwoot channel adapter that communicates via the Chatwoot API.
 */
export function createChatwootAdapter(config: ChatwootAdapterConfig): ChatwootAdapter {
  const { baseUrl, apiToken, accountId, projectId } = config;
  const apiBase = `${baseUrl}/api/v1/accounts/${String(accountId)}`;

  async function apiCall<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'api_access_token': apiToken,
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Chatwoot API error ${String(response.status)}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    channelType: 'chatwoot',
    accountId,
    projectId,

    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        // The recipientIdentifier for Chatwoot is the conversation ID
        const conversationId = message.recipientIdentifier;

        const data = await apiCall<ChatwootSendMessageResponse>(
          `/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            body: {
              content: message.content,
              message_type: 'outgoing',
              content_type: 'text',
            },
          },
        );

        return {
          success: true,
          channelMessageId: String(data.id),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown Chatwoot error',
        };
      }
    },

    parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const event = payload as ChatwootWebhookEvent;

      // Only process incoming text messages from contacts
      if (event.event !== 'message_created') return Promise.resolve(null);
      if (event.message_type !== 'incoming') return Promise.resolve(null);
      if (!event.content) return Promise.resolve(null);
      if (event.sender?.type !== 'contact') return Promise.resolve(null);

      const conversationId = event.conversation?.id;
      if (conversationId === undefined) return Promise.resolve(null);

      return Promise.resolve({
        id: `cw-${event.id ?? String(Date.now())}`,
        channel: 'chatwoot' as const,
        channelMessageId: event.id ?? String(Date.now()),
        projectId,
        senderIdentifier: String(conversationId),
        senderName: event.sender.name,
        content: event.content,
        rawPayload: payload,
        receivedAt: new Date(),
      });
    },

    async isHealthy(): Promise<boolean> {
      try {
        // Ping the account endpoint to check connectivity
        await apiCall('/');
        return true;
      } catch {
        return false;
      }
    },

    async handoffToHuman(conversationId: number, note?: string): Promise<void> {
      // Remove agent bot assignment → conversation goes to human agents
      await apiCall<ChatwootAssignmentResponse>(
        `/conversations/${String(conversationId)}/assignments`,
        {
          method: 'POST',
          body: { assignee_id: null },
        },
      );

      // Toggle status to open so human agents see it
      await apiCall(
        `/conversations/${String(conversationId)}/toggle_status`,
        {
          method: 'POST',
          body: { status: 'open' },
        },
      );

      // Add an internal note with context for the human agent
      if (note) {
        await apiCall(
          `/conversations/${String(conversationId)}/messages`,
          {
            method: 'POST',
            body: {
              content: note,
              message_type: 'outgoing',
              content_type: 'text',
              private: true,
            },
          },
        );
      }
    },

    async resumeBot(conversationId: number): Promise<void> {
      // Re-assign the agent bot to this conversation
      await apiCall(
        `/conversations/${String(conversationId)}/assignments`,
        {
          method: 'POST',
          body: { team_id: null },
        },
      );

      // Set the agent bot back on the conversation
      // Note: Agent bots are typically assigned at inbox level in Chatwoot,
      // so re-opening the conversation should re-trigger the bot.
      await apiCall(
        `/conversations/${String(conversationId)}/toggle_status`,
        {
          method: 'POST',
          body: { status: 'pending' },
        },
      );
    },
  };
}
```

---
## src/channels/adapters/index.ts
```typescript
export { createTelegramAdapter } from './telegram.js';
export type { TelegramAdapterConfig } from './telegram.js';

export { createWhatsAppAdapter } from './whatsapp.js';
export type { WhatsAppAdapterConfig } from './whatsapp.js';

export { createSlackAdapter, getSlackUrlChallenge } from './slack.js';
export type { SlackAdapterConfig } from './slack.js';

export { createChatwootAdapter } from './chatwoot.js';
export type { ChatwootAdapterConfig, ChatwootAdapter, ChatwootWebhookEvent } from './chatwoot.js';
```

---
## src/agents/types.ts
```typescript
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

// ─── Agent Operating Mode ────────────────────────────────────────

/** The operating mode determines the agent's role in the system. */
export type AgentOperatingMode =
  | 'customer-facing' // Talks directly to end customers via channels
  | 'internal'        // Background worker (scheduled tasks, data processing)
  | 'copilot'         // Assists the Fomo team via dashboard chat
  | 'manager';        // Orchestrates other agents; can use delegate-to-agent tool

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
  /** The agent's role in the system. Defaults to 'customer-facing'. */
  operatingMode: AgentOperatingMode;
  /** Assigned SkillInstance IDs. Skills compose instructions + tools at chat time. */
  skillIds: string[];
  limits: AgentLimits;
  managerAgentId?: string | null;
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
  operatingMode?: AgentOperatingMode;
  skillIds?: string[];
  limits?: Partial<AgentLimits>;
  managerAgentId?: string | null;
  metadata?: Record<string, unknown>;
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
  operatingMode?: AgentOperatingMode;
  skillIds?: string[];
  limits?: Partial<AgentLimits>;
  managerAgentId?: string | null;
  metadata?: Record<string, unknown>;
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
```

---
## src/agents/agent-registry.ts
```typescript
/**
 * Agent Registry — cached access to agent configurations.
 *
 * Provides a caching layer over the agent repository with configurable TTL.
 */
import type { Logger } from '@/observability/logger.js';
import type {
  AgentId,
  AgentConfig,
  AgentRegistry,
  AgentRepository,
} from './types.js';

// ─── Cache Entry ─────────────────────────────────────────────────

interface CacheEntry {
  config: AgentConfig;
  expiresAt: number;
}

// ─── Registry Dependencies ───────────────────────────────────────

interface RegistryDeps {
  agentRepository: AgentRepository;
  logger: Logger;
  /** Cache TTL in milliseconds. Default: 60000 (1 minute). */
  cacheTtlMs?: number;
}

// ─── Factory Function ────────────────────────────────────────────

/**
 * Create an agent registry with caching.
 */
export function createAgentRegistry(deps: RegistryDeps): AgentRegistry {
  const cache = new Map<string, CacheEntry>();
  const cacheTtlMs = deps.cacheTtlMs ?? 60000;

  function isValid(entry: CacheEntry | undefined): entry is CacheEntry {
    return entry !== undefined && entry.expiresAt > Date.now();
  }

  function setCached(config: AgentConfig): void {
    cache.set(config.id, {
      config,
      expiresAt: Date.now() + cacheTtlMs,
    });
  }

  const registry: AgentRegistry = {
    async get(agentId: AgentId): Promise<AgentConfig | null> {
      const cached = cache.get(agentId);
      if (isValid(cached)) {
        deps.logger.debug('Agent cache hit', { component: 'agent-registry', agentId });
        return cached.config;
      }

      deps.logger.debug('Agent cache miss, fetching from repository', {
        component: 'agent-registry',
        agentId,
      });
      const config = await deps.agentRepository.findById(agentId);

      if (config) {
        setCached(config);
      }

      return config;
    },

    async getByName(projectId: string, name: string): Promise<AgentConfig | null> {
      // Check cache first by iterating
      for (const entry of cache.values()) {
        if (
          isValid(entry) &&
          entry.config.projectId === projectId &&
          entry.config.name === name
        ) {
          deps.logger.debug('Agent cache hit by name', {
            component: 'agent-registry',
            projectId,
            name,
          });
          return entry.config;
        }
      }

      deps.logger.debug('Agent cache miss by name, fetching from repository', {
        component: 'agent-registry',
        projectId,
        name,
      });
      const config = await deps.agentRepository.findByName(projectId, name);

      if (config) {
        setCached(config);
      }

      return config;
    },

    async list(projectId: string): Promise<AgentConfig[]> {
      // List always goes to repository to ensure fresh data
      return deps.agentRepository.list(projectId);
    },

    async refresh(agentId: AgentId): Promise<void> {
      deps.logger.debug('Refreshing agent cache', {
        component: 'agent-registry',
        agentId,
      });
      cache.delete(agentId);
      await registry.get(agentId);
    },

    invalidate(agentId: AgentId): void {
      deps.logger.debug('Invalidating agent cache', {
        component: 'agent-registry',
        agentId,
      });
      cache.delete(agentId);
    },
  };

  return registry;
}
```

---
## src/agents/agent-comms.ts
```typescript
/**
 * Agent Communications — inter-agent messaging system.
 *
 * Provides a pub/sub mechanism for agents to communicate with each other.
 * Uses EventEmitter for in-process communication. Can be extended to use
 * Redis pub/sub for distributed deployments.
 */
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Logger } from '@/observability/logger.js';
import type { AgentId, AgentMessage, AgentMessageId, AgentComms } from './types.js';

// ─── Pending Reply Tracking ──────────────────────────────────────

interface PendingReply {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

// ─── Comms Dependencies ──────────────────────────────────────────

interface CommsDeps {
  logger: Logger;
}

// ─── Factory Function ────────────────────────────────────────────

/**
 * Create an inter-agent communication system.
 */
export function createAgentComms(deps: CommsDeps): AgentComms {
  const emitter = new EventEmitter();
  const pendingReplies = new Map<string, PendingReply>();

  // Set a higher limit for event listeners (one per agent subscription)
  emitter.setMaxListeners(100);

  const comms: AgentComms = {
    send(message): Promise<AgentMessageId> {
      const id = randomUUID() as AgentMessageId;
      const fullMessage: AgentMessage = {
        ...message,
        id,
        createdAt: new Date(),
      };

      deps.logger.info('Agent message sent', {
        component: 'agent-comms',
        messageId: id,
        from: message.fromAgentId,
        to: message.toAgentId,
        hasReplyTo: !!message.replyToId,
      });

      // Emit to the target agent's channel
      emitter.emit(`agent:${message.toAgentId}`, fullMessage);

      return Promise.resolve(id);
    },

    async sendAndWait(message, timeoutMs = 30000): Promise<string> {
      const id = await comms.send(message);

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingReplies.delete(id);
          deps.logger.warn('Agent message timed out waiting for reply', {
            component: 'agent-comms',
            messageId: id,
            timeoutMs,
          });
          reject(new Error(`Agent response timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingReplies.set(id, { resolve, reject, timeoutId });

        // Listen for reply on the sender's channel
        const handler = (reply: AgentMessage): void => {
          if (reply.replyToId === id) {
            const pending = pendingReplies.get(id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingReplies.delete(id);
              deps.logger.debug('Agent received reply', {
                component: 'agent-comms',
                originalMessageId: id,
                replyMessageId: reply.id,
              });
              pending.resolve(reply.content);
            }
            emitter.off(`agent:${message.fromAgentId}`, handler);
          }
        };

        emitter.on(`agent:${message.fromAgentId}`, handler);
      });
    },

    subscribe(agentId: AgentId, handler: (message: AgentMessage) => void): () => void {
      const eventName = `agent:${agentId}`;

      deps.logger.debug('Agent subscribed to messages', {
        component: 'agent-comms',
        agentId,
      });
      emitter.on(eventName, handler);

      // Return unsubscribe function
      return () => {
        deps.logger.debug('Agent unsubscribed from messages', {
          component: 'agent-comms',
          agentId,
        });
        emitter.off(eventName, handler);
      };
    },
  };

  return comms;
}
```

---
## src/agents/mode-resolver.ts
```typescript
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
```

---
## src/agents/index.ts
```typescript
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
```

---
## src/mcp/types.ts
```typescript
/**
 * MCP (Model Context Protocol) types for connecting external tool servers.
 * MCP servers expose tools that the agent can discover and use dynamically.
 */

// ─── Server Configuration ──────────────────────────────────────

/** Configuration for a single MCP server connection. */
export interface MCPServerConfig {
  /** Unique identifier for this server (e.g. "google-calendar"). */
  name: string;
  /** Transport type: stdio spawns a subprocess, sse connects via HTTP. */
  transport: 'stdio' | 'sse';
  /** For stdio: command to run (e.g. "npx"). */
  command?: string;
  /** For stdio: arguments for the command (e.g. ["-y", "@anthropic/mcp-google-calendar"]). */
  args?: string[];
  /** For stdio: env var NAMES to resolve and pass to the subprocess. */
  env?: Record<string, string>;
  /** For sse: URL of the MCP server (e.g. "http://localhost:8080/mcp"). */
  url?: string;
  /** Namespace prefix for tool IDs. Defaults to server name. */
  toolPrefix?: string;
}

// ─── Connection ────────────────────────────────────────────────

/** Status of an MCP server connection. */
export type MCPConnectionStatus = 'connected' | 'disconnected' | 'error';

/** Represents a live connection to an MCP server. */
export interface MCPConnection {
  /** The server name from config. */
  readonly serverName: string;
  /** Current connection status. */
  readonly status: MCPConnectionStatus;
  /** List tools available on this server. */
  listTools(): Promise<MCPToolInfo[]>;
  /** Call a tool on this server. */
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;
  /** Close the connection and clean up resources. */
  close(): Promise<void>;
}

// ─── Tool Info ─────────────────────────────────────────────────

/** Tool information as reported by an MCP server. */
export interface MCPToolInfo {
  /** Tool name as defined by the MCP server. */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
}

/** Result of calling a tool on an MCP server. */
export interface MCPToolResult {
  /** Array of content items returned by the tool. */
  content: MCPToolResultContent[];
  /** Whether the tool call resulted in an error. */
  isError?: boolean;
}

/** A single content item in an MCP tool result. */
export interface MCPToolResultContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}
```

---
## src/mcp/errors.ts
```typescript
/**
 * MCP-specific error classes.
 * All extend NexusError for consistent error handling across the system.
 */
import { NexusError } from '@/core/errors.js';

/** Thrown when connecting to an MCP server fails. */
export class MCPConnectionError extends NexusError {
  constructor(serverName: string, message: string, cause?: Error) {
    super({
      message: `MCP server "${serverName}" connection failed: ${message}`,
      code: 'MCP_CONNECTION_ERROR',
      statusCode: 503,
      cause,
      context: { serverName },
    });
    this.name = 'MCPConnectionError';
  }
}

/** Thrown when calling a tool on an MCP server fails. */
export class MCPToolExecutionError extends NexusError {
  constructor(serverName: string, toolName: string, message: string, cause?: Error) {
    super({
      message: `MCP tool "${toolName}" on "${serverName}" failed: ${message}`,
      code: 'MCP_TOOL_EXECUTION_ERROR',
      statusCode: 502,
      cause,
      context: { serverName, toolName },
    });
    this.name = 'MCPToolExecutionError';
  }
}

/** Thrown when an MCP operation exceeds its timeout. */
export class MCPTimeoutError extends NexusError {
  constructor(serverName: string, operation: string, timeoutMs: number) {
    super({
      message: `MCP server "${serverName}" timed out during ${operation} after ${timeoutMs}ms`,
      code: 'MCP_TIMEOUT',
      statusCode: 504,
      context: { serverName, operation, timeoutMs },
    });
    this.name = 'MCPTimeoutError';
  }
}
```

---
## src/mcp/mcp-client.ts
```typescript
/**
 * Creates MCP connections using the @modelcontextprotocol/sdk.
 * Supports stdio (subprocess) and SSE (HTTP) transports.
 * Returns our MCPConnection interface, hiding SDK details from the rest of the system.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createLogger } from '@/observability/logger.js';
import type {
  MCPServerConfig,
  MCPConnection,
  MCPConnectionStatus,
  MCPToolInfo,
  MCPToolResult,
} from './types.js';
import { MCPConnectionError } from './errors.js';

const logger = createLogger({ name: 'mcp-client' });

/** Options for creating an MCP connection. */
export interface CreateMCPConnectionOptions {
  /** Server configuration. */
  config: MCPServerConfig;
  /** Connection timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

/**
 * Creates a live connection to an MCP server.
 * Handles transport creation, env var resolution, and SDK initialization.
 */
export async function createMCPConnection(
  options: CreateMCPConnectionOptions,
): Promise<MCPConnection> {
  const { config, timeoutMs = 30_000 } = options;

  logger.info('Connecting to MCP server', {
    component: 'mcp-client',
    serverName: config.name,
    transport: config.transport,
  });

  const client = new Client(
    { name: 'nexus-core', version: '1.0.0' },
    { capabilities: {} },
  );

  const transport = createTransport(config);

  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MCPConnectionError(
      config.name,
      message,
      error instanceof Error ? error : undefined,
    );
  }

  logger.info('MCP server connected', {
    component: 'mcp-client',
    serverName: config.name,
  });

  let status: MCPConnectionStatus = 'connected';

  // Track disconnection
  transport.onclose = () => {
    status = 'disconnected';
    logger.info('MCP server disconnected', {
      component: 'mcp-client',
      serverName: config.name,
    });
  };

  transport.onerror = (error: Error) => {
    status = 'error';
    logger.error('MCP server transport error', {
      component: 'mcp-client',
      serverName: config.name,
      error: error.message,
    });
  };

  return {
    get serverName() {
      return config.name;
    },

    get status() {
      return status;
    },

    async listTools(): Promise<MCPToolInfo[]> {
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
    },

    async callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<MCPToolResult> {
      const result = await client.callTool({ name, arguments: args });

      // The SDK returns a union type — we only handle the content-based result
      if (!('content' in result)) {
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      const content = result.content as MCPToolResult['content'];
      return {
        content: content.map((c) => {
          const item: MCPToolResult['content'][number] = {
            type: c.type,
          };
          if ('text' in c && typeof c.text === 'string') item.text = c.text;
          if ('data' in c && typeof c.data === 'string') item.data = c.data;
          if ('mimeType' in c && typeof c.mimeType === 'string') item.mimeType = c.mimeType;
          return item;
        }),
        isError: 'isError' in result ? (result.isError === true) : undefined,
      };
    },

    async close(): Promise<void> {
      status = 'disconnected';
      await transport.close();
      logger.info('MCP connection closed', {
        component: 'mcp-client',
        serverName: config.name,
      });
    },
  };
}

/**
 * Creates the appropriate transport based on server config.
 * Resolves env var names to actual values from process.env.
 */
// eslint-disable-next-line @typescript-eslint/no-deprecated -- SSE support intentional
function createTransport(config: MCPServerConfig): StdioClientTransport | SSEClientTransport {
  switch (config.transport) {
    case 'stdio': {
      if (!config.command) {
        throw new MCPConnectionError(
          config.name,
          'stdio transport requires a "command" field',
        );
      }

      const env = resolveEnvVars(config.env);

      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env as Record<string, string>, ...env },
        stderr: 'pipe',
      });
    }
    case 'sse': {
      if (!config.url) {
        throw new MCPConnectionError(
          config.name,
          'sse transport requires a "url" field',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-deprecated -- SSE support intentional
      return new SSEClientTransport(new URL(config.url));
    }
  }
}

/**
 * Resolves environment variable references.
 * Config values are env var NAMES (e.g. { GOOGLE_TOKEN: "GOOGLE_API_KEY" }),
 * and we resolve them to actual values from process.env.
 */
function resolveEnvVars(
  envConfig: Record<string, string> | undefined,
): Record<string, string> {
  if (!envConfig) return {};

  const resolved: Record<string, string> = {};
  for (const [key, envVarName] of Object.entries(envConfig)) {
    const value = process.env[envVarName];
    if (value !== undefined) {
      resolved[key] = value;
    } else {
      logger.warn('MCP env var not found', {
        component: 'mcp-client',
        key,
        envVarName,
      });
    }
  }
  return resolved;
}
```

---
## src/mcp/mcp-tool-adapter.ts
```typescript
/**
 * Adapts MCP server tools into Nexus ExecutableTool instances.
 * Once adapted, MCP tools are indistinguishable from native tools
 * in the ToolRegistry and agent loop.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import type { MCPConnection, MCPToolInfo } from './types.js';
import { MCPToolExecutionError } from './errors.js';

const logger = createLogger({ name: 'mcp-tool-adapter' });

/** Options for creating an MCP executable tool. */
export interface MCPToolAdapterOptions {
  /** The MCP server name (for logging and error context). */
  serverName: string;
  /** Tool info as reported by the MCP server. */
  toolInfo: MCPToolInfo;
  /** Live connection to the MCP server. */
  connection: MCPConnection;
  /** Namespace prefix for the tool ID. Defaults to serverName. */
  prefix?: string;
}

/**
 * Creates a Nexus ExecutableTool that delegates execution to an MCP server.
 * The tool ID is namespaced as `mcp:{prefix}:{toolName}` to avoid collisions.
 */
export function createMCPExecutableTool(options: MCPToolAdapterOptions): ExecutableTool {
  const { serverName, toolInfo, connection, prefix } = options;
  const toolPrefix = prefix ?? serverName;
  const toolId = `mcp:${toolPrefix}:${toolInfo.name}`;

  // Build a Zod schema that passes through validation to the MCP server.
  // MCP servers define their own JSON Schema — we accept any object here
  // and let the server reject invalid input with a meaningful error.
  const inputSchema = z.record(z.string(), z.unknown()).optional().default({});

  return {
    id: toolId,
    name: toolInfo.name,
    description: toolInfo.description ? toolInfo.description : `MCP tool from ${serverName}`,
    category: 'mcp',
    inputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const startTime = Date.now();

      try {
        logger.info('Executing MCP tool', {
          component: 'mcp-tool-adapter',
          toolId,
          serverName,
          mcpToolName: toolInfo.name,
        });

        const toolInput = (input ?? {}) as Record<string, unknown>;
        const mcpResult = await connection.callTool(toolInfo.name, toolInput);

        const durationMs = Date.now() - startTime;

        // Extract text content from MCP result
        const textParts = mcpResult.content
          .filter((c): c is typeof c & { text: string } => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text);
        const output = textParts.length === 1 ? (textParts[0] ?? '') : textParts.join('\n');

        if (mcpResult.isError) {
          logger.warn('MCP tool returned error', {
            component: 'mcp-tool-adapter',
            toolId,
            serverName,
            output,
            durationMs,
          });

          return ok({
            success: false,
            output,
            error: output !== '' ? output : 'MCP tool returned an error',
            durationMs,
            metadata: { serverName, mcpToolName: toolInfo.name },
          });
        }

        logger.debug('MCP tool executed successfully', {
          component: 'mcp-tool-adapter',
          toolId,
          serverName,
          durationMs,
        });

        return ok({
          success: true,
          output,
          durationMs,
          metadata: { serverName, mcpToolName: toolInfo.name },
        });
      } catch (error: unknown) {
        const durationMs = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);

        logger.error('MCP tool execution failed', {
          component: 'mcp-tool-adapter',
          toolId,
          serverName,
          error: message,
          durationMs,
        });

        return err(
          new MCPToolExecutionError(serverName, toolInfo.name, message,
            error instanceof Error ? error : undefined),
        );
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const startTime = Date.now();

      // Validate input shape (basic check — the MCP server defines the real schema)
      const parseResult = inputSchema.safeParse(input);
      if (!parseResult.success) {
        return err(
          new MCPToolExecutionError(
            serverName,
            toolInfo.name,
            `Input validation failed: ${parseResult.error.message}`,
          ),
        );
      }

      return Promise.resolve(ok({
        success: true,
        output: `[dry-run] Would call MCP tool "${toolInfo.name}" on server "${serverName}"`,
        durationMs: Date.now() - startTime,
        metadata: { serverName, mcpToolName: toolInfo.name, dryRun: true },
      }));
    },

    healthCheck(): Promise<boolean> {
      return Promise.resolve(connection.status === 'connected');
    },
  };
}

/**
 * Get the JSON Schema for an MCP tool's input, suitable for LLM providers.
 * Falls back to an empty object schema if the MCP server doesn't provide one.
 */
export function getMCPToolInputSchema(toolInfo: MCPToolInfo): Record<string, unknown> {
  const schema = toolInfo.inputSchema as Record<string, unknown> | undefined;
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  // Ensure it has type: "object" at the top level (required by OpenAI)
  if (!('type' in schema)) {
    return { type: 'object', properties: {}, ...schema };
  }
  return schema;
}
```

---
## src/mcp/mcp-manager.ts
```typescript
/**
 * Manages multiple MCP server connections for a project.
 * Discovers tools from all connected servers and exposes them as ExecutableTool instances.
 */
import { createLogger } from '@/observability/logger.js';
import type { ExecutableTool } from '@/tools/types.js';
import type { MCPServerConfig, MCPConnection } from './types.js';
import { createMCPConnection } from './mcp-client.js';
import { createMCPExecutableTool, getMCPToolInputSchema } from './mcp-tool-adapter.js';

const logger = createLogger({ name: 'mcp-manager' });

/** Status of a managed MCP server connection. */
export interface MCPServerStatus {
  name: string;
  status: string;
  toolCount: number;
}

/** Public interface for the MCP manager. */
export interface MCPManager {
  /** Connect to all configured MCP servers. Failures are logged and skipped. */
  connectAll(configs: MCPServerConfig[]): Promise<void>;
  /** Disconnect a specific server by name. */
  disconnect(serverName: string): Promise<void>;
  /** Disconnect all servers and clean up resources. */
  disconnectAll(): Promise<void>;
  /** Get a connection by server name. */
  getConnection(serverName: string): MCPConnection | undefined;
  /** List status of all managed connections. */
  listConnections(): MCPServerStatus[];
  /** Get all MCP tools as ExecutableTool instances (ready for ToolRegistry). */
  getTools(): ExecutableTool[];
  /** Get JSON Schemas for all MCP tools (for LLM provider formatting). */
  getToolSchemas(): Map<string, Record<string, unknown>>;
}

/** Options for creating an MCP manager. */
export interface MCPManagerOptions {
  /** Connection timeout per server in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

/**
 * Creates a manager that handles multiple MCP server connections.
 * Failed connections are logged and skipped — the agent continues without those tools.
 */
export function createMCPManager(options?: MCPManagerOptions): MCPManager {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const connections = new Map<string, MCPConnection>();
  const tools = new Map<string, ExecutableTool>();
  const toolSchemas = new Map<string, Record<string, unknown>>();
  /** Maps server name → set of tool IDs belonging to that server. */
  const serverToolIds = new Map<string, Set<string>>();

  return {
    async connectAll(configs: MCPServerConfig[]): Promise<void> {
      const results = await Promise.allSettled(
        configs.map(async (config) => {
          try {
            logger.info('Connecting to MCP server', {
              component: 'mcp-manager',
              serverName: config.name,
            });

            const connection = await createMCPConnection({ config, timeoutMs });
            connections.set(config.name, connection);

            // Discover tools
            const serverTools = await connection.listTools();
            logger.info('Discovered MCP tools', {
              component: 'mcp-manager',
              serverName: config.name,
              toolCount: serverTools.length,
              tools: serverTools.map((t) => t.name),
            });

            // Wrap each tool as an ExecutableTool
            const toolIds = new Set<string>();
            for (const toolInfo of serverTools) {
              const executableTool = createMCPExecutableTool({
                serverName: config.name,
                toolInfo,
                connection,
                prefix: config.toolPrefix,
              });
              tools.set(executableTool.id, executableTool);
              toolSchemas.set(executableTool.id, getMCPToolInputSchema(toolInfo));
              toolIds.add(executableTool.id);
            }
            serverToolIds.set(config.name, toolIds);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('Failed to connect to MCP server', {
              component: 'mcp-manager',
              serverName: config.name,
              error: message,
            });
            // Don't rethrow — graceful degradation
          }
        }),
      );

      const connected = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      logger.info('MCP manager initialization complete', {
        component: 'mcp-manager',
        connected,
        failed,
        totalTools: tools.size,
      });
    },

    async disconnect(serverName: string): Promise<void> {
      const connection = connections.get(serverName);
      if (!connection) return;

      // Remove tools for this server
      const ids = serverToolIds.get(serverName);
      if (ids) {
        for (const toolId of ids) {
          tools.delete(toolId);
          toolSchemas.delete(toolId);
        }
        serverToolIds.delete(serverName);
      }

      await connection.close();
      connections.delete(serverName);

      logger.info('MCP server disconnected', {
        component: 'mcp-manager',
        serverName,
      });
    },

    async disconnectAll(): Promise<void> {
      const closePromises = [...connections.values()].map((c) => c.close());
      await Promise.allSettled(closePromises);
      connections.clear();
      tools.clear();
      toolSchemas.clear();
      serverToolIds.clear();

      logger.info('All MCP servers disconnected', {
        component: 'mcp-manager',
      });
    },

    getConnection(serverName: string): MCPConnection | undefined {
      return connections.get(serverName);
    },

    listConnections(): MCPServerStatus[] {
      return [...connections.entries()].map(([name, conn]) => ({
        name,
        status: conn.status,
        toolCount: serverToolIds.get(name)?.size ?? 0,
      }));
    },

    getTools(): ExecutableTool[] {
      return [...tools.values()];
    },

    getToolSchemas(): Map<string, Record<string, unknown>> {
      return new Map(toolSchemas);
    },
  };
}
```

---
## src/mcp/index.ts
```typescript
/**
 * MCP (Model Context Protocol) client integration.
 * Connects to external MCP servers, discovers tools, and adapts them
 * as Nexus ExecutableTool instances for the ToolRegistry.
 */
export type {
  MCPServerConfig,
  MCPConnection,
  MCPConnectionStatus,
  MCPToolInfo,
  MCPToolResult,
  MCPToolResultContent,
} from './types.js';
export { MCPConnectionError, MCPToolExecutionError, MCPTimeoutError } from './errors.js';
export { createMCPConnection } from './mcp-client.js';
export type { CreateMCPConnectionOptions } from './mcp-client.js';
export { createMCPExecutableTool, getMCPToolInputSchema } from './mcp-tool-adapter.js';
export type { MCPToolAdapterOptions } from './mcp-tool-adapter.js';
export { createMCPManager } from './mcp-manager.js';
export type { MCPManager, MCPManagerOptions, MCPServerStatus } from './mcp-manager.js';
```

---
## src/mcp/servers/hubspot-crm/index.ts
```typescript
#!/usr/bin/env node
/**
 * HubSpot CRM MCP Server
 *
 * Exposes HubSpot CRM data (contacts, deals, companies) to Nexus Core agents via MCP (stdio).
 * Supports read (search, get) and write (update stage, add note, create task) operations.
 *
 * Required environment variables:
 *   HUBSPOT_ACCESS_TOKEN — HubSpot Private App access token
 *
 * Usage:
 *   node dist/mcp/servers/hubspot-crm/index.js
 *
 * In Nexus Core MCPServerConfig:
 *   {
 *     name: 'hubspot-crm',
 *     transport: 'stdio',
 *     command: 'node',
 *     args: ['dist/mcp/servers/hubspot-crm/index.js'],
 *     env: { HUBSPOT_ACCESS_TOKEN: 'HUBSPOT_ACCESS_TOKEN' },
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createHubSpotApiClient } from './api-client.js';

// ─── Validate Environment ────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Missing required environment variable: ${name}\n`);
    process.exit(1);
  }
  return value;
}

const accessToken = requireEnv('HUBSPOT_ACCESS_TOKEN');

// ─── API Client ──────────────────────────────────────────────────────

const api = createHubSpotApiClient({ accessToken });

// ─── MCP Server ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-deprecated
const server = new Server(
  { name: 'hubspot-crm', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'search-contacts',
    description:
      'Search HubSpot contacts by phone number, email address, or name. Use this to find a customer in the CRM.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'General search term (matches first name, last name, or email)',
        },
        email: {
          type: 'string',
          description: 'Exact email address to look up',
        },
        phone: {
          type: 'string',
          description: 'Phone number to search (partial match, ignores formatting)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10, max: 100)',
        },
      },
    },
  },
  {
    name: 'search-deals',
    description:
      'Search HubSpot deals by pipeline stage, inactivity period, pipeline, or owner. ' +
      'Use this to find deals matching specific criteria (e.g. cold leads with no activity in 3+ days). ' +
      'Results are sorted oldest-first so you can prioritize stale deals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stage: {
          type: 'string',
          description: 'Deal stage ID to filter by (e.g. "quotationsent", "negotiation", "closedlost")',
        },
        pipeline: {
          type: 'string',
          description: 'Pipeline ID to filter by (omit for all pipelines)',
        },
        inactiveDays: {
          type: 'number',
          description: 'Only return deals with no notes/activity in this many days (e.g. 3 = inactive for 3+ days)',
        },
        ownerId: {
          type: 'string',
          description: 'HubSpot owner ID — only deals assigned to this owner',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20, max: 100)',
        },
      },
    },
  },
  {
    name: 'get-contact-deals',
    description:
      'Get all deals associated with a HubSpot contact. Returns deal name, stage, amount, and close date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contactId: {
          type: 'string',
          description: 'HubSpot contact ID (from search-contacts results)',
        },
        limit: {
          type: 'number',
          description: 'Max deals to return (default: 10)',
        },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'get-deal-detail',
    description:
      'Get full details of a HubSpot deal, including associated contacts and companies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID',
        },
      },
      required: ['dealId'],
    },
  },
  {
    name: 'get-company-detail',
    description:
      'Get company details from HubSpot by company ID. Returns name, domain, industry, and location.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        companyId: {
          type: 'string',
          description: 'HubSpot company ID (from deal associations)',
        },
      },
      required: ['companyId'],
    },
  },
  {
    name: 'update-deal-stage',
    description:
      'Move a deal to a new pipeline stage in HubSpot. Use this to track deal progression.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID',
        },
        stage: {
          type: 'string',
          description: 'Target pipeline stage ID (e.g. "appointmentscheduled", "qualifiedtobuy", "closedwon")',
        },
        pipeline: {
          type: 'string',
          description: 'Pipeline ID (only needed if the deal could be in multiple pipelines)',
        },
      },
      required: ['dealId', 'stage'],
    },
  },
  {
    name: 'add-deal-note',
    description:
      'Add a note/engagement to a HubSpot deal. Use this to log important conversation details or decisions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID to attach the note to',
        },
        body: {
          type: 'string',
          description: 'Note content (plain text or HTML)',
        },
      },
      required: ['dealId', 'body'],
    },
  },
  {
    name: 'create-deal-task',
    description:
      'Create a follow-up task linked to a HubSpot deal. Use this to schedule actions like callbacks or meetings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID to link the task to',
        },
        subject: {
          type: 'string',
          description: 'Task title/subject',
        },
        body: {
          type: 'string',
          description: 'Task description or details',
        },
        priority: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH'],
          description: 'Task priority (default: MEDIUM)',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO 8601 format (e.g. "2026-03-01T10:00:00Z")',
        },
        ownerId: {
          type: 'string',
          description: 'HubSpot owner ID to assign the task to',
        },
      },
      required: ['dealId', 'subject'],
    },
  },
] as const;

// ─── Request Handlers ────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, () =>
  Promise.resolve({ tools: [...TOOL_DEFINITIONS] }),
);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {});

  try {
    let result: unknown;

    switch (name) {
      case 'search-contacts':
        result = await api.searchContacts({
          query: args['query'] as string | undefined,
          email: args['email'] as string | undefined,
          phone: args['phone'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'search-deals':
        result = await api.searchDeals({
          stage: args['stage'] as string | undefined,
          pipeline: args['pipeline'] as string | undefined,
          inactiveDays: args['inactiveDays'] as number | undefined,
          ownerId: args['ownerId'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'get-contact-deals':
        result = await api.getContactDeals({
          contactId: args['contactId'] as string,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'get-deal-detail':
        result = await api.getDealDetail({
          dealId: args['dealId'] as string,
        });
        break;

      case 'get-company-detail':
        result = await api.getCompanyDetail({
          companyId: args['companyId'] as string,
        });
        break;

      case 'update-deal-stage':
        result = await api.updateDealStage({
          dealId: args['dealId'] as string,
          stage: args['stage'] as string,
          pipeline: args['pipeline'] as string | undefined,
        });
        break;

      case 'add-deal-note':
        result = await api.addDealNote({
          dealId: args['dealId'] as string,
          body: args['body'] as string,
        });
        break;

      case 'create-deal-task':
        result = await api.createDealTask({
          dealId: args['dealId'] as string,
          subject: args['subject'] as string,
          body: args['body'] as string | undefined,
          priority: args['priority'] as string | undefined,
          dueDate: args['dueDate'] as string | undefined,
          ownerId: args['ownerId'] as string | undefined,
        });
        break;

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
```

---
## src/mcp/servers/hubspot-crm/api-client.ts
```typescript
/**
 * HubSpot CRM API v3 client.
 *
 * Calls HubSpot REST API directly via fetch — no SDK needed.
 * Uses a Private App access token for authentication.
 *
 * Required env vars:
 *   HUBSPOT_ACCESS_TOKEN — HubSpot Private App token
 */

// ─── Response Types ──────────────────────────────────────────────────

export interface HSContact {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSDeal {
  id: string;
  properties: Record<string, string | null>;
  associations?: {
    contacts?: { results: HSAssociation[] };
    companies?: { results: HSAssociation[] };
  };
}

export interface HSCompany {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSAssociation {
  id: string;
  type: string;
}

export interface HSNote {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSTask {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSSearchResponse<T> {
  total: number;
  results: T[];
  paging?: { next?: { after: string } };
}

export interface HSBatchReadResponse<T> {
  results: T[];
  status: string;
}

// ─── Config ──────────────────────────────────────────────────────────

export interface HubSpotApiConfig {
  accessToken: string;
}

// ─── Client Interface ────────────────────────────────────────────────

export interface HubSpotApiClient {
  searchContacts(params: { query?: string; email?: string; phone?: string; limit?: number }): Promise<HSSearchResponse<HSContact>>;
  searchDeals(params: { stage?: string; pipeline?: string; inactiveDays?: number; ownerId?: string; limit?: number }): Promise<HSSearchResponse<HSDeal>>;
  getContactDeals(params: { contactId: string; limit?: number }): Promise<HSDeal[]>;
  getDealDetail(params: { dealId: string }): Promise<HSDeal>;
  getCompanyDetail(params: { companyId: string }): Promise<HSCompany>;
  updateDealStage(params: { dealId: string; stage: string; pipeline?: string }): Promise<HSDeal>;
  addDealNote(params: { dealId: string; body: string }): Promise<HSNote>;
  createDealTask(params: { dealId: string; subject: string; body?: string; priority?: string; dueDate?: string; ownerId?: string }): Promise<HSTask>;
}

// ─── Client Factory ──────────────────────────────────────────────────

const BASE_URL = 'https://api.hubapi.com';

const CONTACT_PROPERTIES = [
  'firstname', 'lastname', 'email', 'phone', 'company',
  'lifecyclestage', 'createdate', 'lastmodifieddate',
];

const DEAL_PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'amount', 'closedate',
  'createdate', 'lastmodifieddate', 'hubspot_owner_id', 'description',
];

const COMPANY_PROPERTIES = [
  'name', 'domain', 'industry', 'phone', 'city', 'state', 'country',
  'numberofemployees', 'annualrevenue', 'createdate', 'lastmodifieddate',
];

/** Create a HubSpot API client for accessing CRM data. */
export function createHubSpotApiClient(config: HubSpotApiConfig): HubSpotApiClient {
  const { accessToken } = config;

  function makeHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...makeHeaders(),
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HubSpot API error (${String(res.status)}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  /** Strip non-digit characters for phone comparison. */
  function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  return {
    /**
     * Search HubSpot contacts by phone, email, or name.
     */
    async searchContacts(params: {
      query?: string;
      email?: string;
      phone?: string;
      limit?: number;
    }): Promise<HSSearchResponse<HSContact>> {
      const filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }> = [];

      if (params.email) {
        filterGroups.push({
          filters: [{ propertyName: 'email', operator: 'EQ', value: params.email }],
        });
      }

      if (params.phone) {
        const normalized = normalizePhone(params.phone);
        filterGroups.push({
          filters: [{ propertyName: 'phone', operator: 'CONTAINS_TOKEN', value: `*${normalized}` }],
        });
      }

      if (params.query) {
        // Search across name and email
        filterGroups.push({
          filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
        });
        filterGroups.push({
          filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
        });
        filterGroups.push({
          filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
        });
      }

      const body = {
        ...(filterGroups.length > 0 ? { filterGroups } : {}),
        properties: CONTACT_PROPERTIES,
        limit: Math.min(params.limit ?? 10, 100),
      };

      return fetchJson<HSSearchResponse<HSContact>>(
        `${BASE_URL}/crm/v3/objects/contacts/search`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },

    /**
     * Search HubSpot deals by stage, pipeline, inactivity, or owner.
     * Filters within a single call are ANDed. Results sorted by last modified (oldest first).
     */
    async searchDeals(params: {
      stage?: string;
      pipeline?: string;
      inactiveDays?: number;
      ownerId?: string;
      limit?: number;
    }): Promise<HSSearchResponse<HSDeal>> {
      const filters: Array<{ propertyName: string; operator: string; value: string }> = [];

      if (params.stage) {
        filters.push({ propertyName: 'dealstage', operator: 'EQ', value: params.stage });
      }

      if (params.pipeline) {
        filters.push({ propertyName: 'pipeline', operator: 'EQ', value: params.pipeline });
      }

      if (params.inactiveDays !== undefined && params.inactiveDays > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - params.inactiveDays);
        filters.push({
          propertyName: 'notes_last_updated',
          operator: 'LT',
          value: cutoff.getTime().toString(),
        });
      }

      if (params.ownerId) {
        filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: params.ownerId });
      }

      const body: Record<string, unknown> = {
        properties: DEAL_PROPERTIES,
        limit: Math.min(params.limit ?? 20, 100),
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
      };

      if (filters.length > 0) {
        body['filterGroups'] = [{ filters }];
      }

      return fetchJson<HSSearchResponse<HSDeal>>(
        `${BASE_URL}/crm/v3/objects/deals/search`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },

    /**
     * Get all deals associated with a HubSpot contact.
     */
    async getContactDeals(params: {
      contactId: string;
      limit?: number;
    }): Promise<HSDeal[]> {
      // Step 1: Get associated deal IDs
      const assocResponse = await fetchJson<{ results: HSAssociation[] }>(
        `${BASE_URL}/crm/v3/objects/contacts/${params.contactId}/associations/deals`,
      );

      if (assocResponse.results.length === 0) return [];

      const dealIds = assocResponse.results
        .slice(0, params.limit ?? 10)
        .map((a) => ({ id: a.id }));

      // Step 2: Batch read deal details
      const batchResponse = await fetchJson<HSBatchReadResponse<HSDeal>>(
        `${BASE_URL}/crm/v3/objects/deals/batch/read`,
        {
          method: 'POST',
          body: JSON.stringify({
            inputs: dealIds,
            properties: DEAL_PROPERTIES,
          }),
        },
      );

      return batchResponse.results;
    },

    /**
     * Get full deal details with associated contacts and companies.
     */
    async getDealDetail(params: { dealId: string }): Promise<HSDeal> {
      const properties = DEAL_PROPERTIES.join(',');
      return fetchJson<HSDeal>(
        `${BASE_URL}/crm/v3/objects/deals/${params.dealId}?properties=${properties}&associations=contacts,companies`,
      );
    },

    /**
     * Get company info by ID.
     */
    async getCompanyDetail(params: { companyId: string }): Promise<HSCompany> {
      const properties = COMPANY_PROPERTIES.join(',');
      return fetchJson<HSCompany>(
        `${BASE_URL}/crm/v3/objects/companies/${params.companyId}?properties=${properties}`,
      );
    },

    /**
     * Move a deal to a new pipeline stage.
     */
    async updateDealStage(params: {
      dealId: string;
      stage: string;
      pipeline?: string;
    }): Promise<HSDeal> {
      const properties: Record<string, string> = { dealstage: params.stage };
      if (params.pipeline) {
        properties['pipeline'] = params.pipeline;
      }

      return fetchJson<HSDeal>(
        `${BASE_URL}/crm/v3/objects/deals/${params.dealId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ properties }),
        },
      );
    },

    /**
     * Add a note/engagement to a deal.
     */
    async addDealNote(params: { dealId: string; body: string }): Promise<HSNote> {
      // Step 1: Create the note
      const note = await fetchJson<HSNote>(
        `${BASE_URL}/crm/v3/objects/notes`,
        {
          method: 'POST',
          body: JSON.stringify({
            properties: {
              hs_note_body: params.body,
              hs_timestamp: new Date().toISOString(),
            },
          }),
        },
      );

      // Step 2: Associate with the deal (note_to_deal = 202)
      await fetchJson<unknown>(
        `${BASE_URL}/crm/v3/objects/notes/${note.id}/associations/deals/${params.dealId}/note_to_deal/202`,
        { method: 'PUT' },
      );

      return note;
    },

    /**
     * Create a task linked to a deal.
     */
    async createDealTask(params: {
      dealId: string;
      subject: string;
      body?: string;
      priority?: string;
      dueDate?: string;
      ownerId?: string;
    }): Promise<HSTask> {
      const properties: Record<string, string> = {
        hs_task_subject: params.subject,
        hs_task_body: params.body ?? '',
        hs_task_status: 'NOT_STARTED',
        hs_task_priority: params.priority ?? 'MEDIUM',
        hs_timestamp: params.dueDate ?? new Date().toISOString(),
      };
      if (params.ownerId) {
        properties['hubspot_owner_id'] = params.ownerId;
      }

      // Step 1: Create the task
      const task = await fetchJson<HSTask>(
        `${BASE_URL}/crm/v3/objects/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({ properties }),
        },
      );

      // Step 2: Associate with the deal (task_to_deal = 216)
      await fetchJson<unknown>(
        `${BASE_URL}/crm/v3/objects/tasks/${task.id}/associations/deals/${params.dealId}/task_to_deal/216`,
        { method: 'PUT' },
      );

      return task;
    },
  };
}
```

