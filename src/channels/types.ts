import { z } from 'zod';
import type { ProjectId } from '@/core/types.js';

// ─── Channel Types ──────────────────────────────────────────────

export type ChannelType = 'whatsapp' | 'whatsapp-waha' | 'telegram' | 'slack' | 'email' | 'chatwoot' | 'vapi';

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

  /** If true, the inbound-processor should close the existing session and start a new one */
  resetSession?: boolean;
}

// ─── Outbound Message ───────────────────────────────────────────

export interface OutboundMessage {
  channel: ChannelType;
  /** Recipient identifier (phone, telegram chat id, slack channel, etc.) */
  recipientIdentifier: string;

  content: string;
  mediaUrls?: string[];
  replyToChannelMessageId?: string;

  /**
   * WhatsApp Meta template config — when set, sends a template message instead of text.
   * Only used by the WhatsApp Cloud API adapter (provider: 'whatsapp').
   */
  template?: {
    name: string;
    language: string;
    components?: object[];
  };

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
export type IntegrationProvider = 'chatwoot' | 'telegram' | 'whatsapp' | 'whatsapp-waha' | 'slack' | 'vapi';

// ─── Per-Provider Integration Configs ───────────────────────────

/** Chatwoot-specific integration config stored in the JSON column. */
export interface ChatwootIntegrationConfig {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  agentBotId: number;
  /**
   * Nexus agent that handles inbound messages on this Chatwoot inbox.
   * Required for routing — without it, runAgent has no agent to invoke.
   * Optional in the type only so older JSON rows still parse; webhook
   * dispatch logs and rejects the delivery when missing.
   */
  agentId?: string;
  /**
   * High-entropy random token (32–128 hex chars) generated server-side at
   * creation time. Embedded in the public webhook URL
   * (`/webhooks/chatwoot/{pathToken}`) and used to identify the integration
   * for inbound deliveries — Chatwoot v4.12.x Agent Bots do not sign their
   * outgoing webhooks, so the token in the URL is the auth mechanism.
   */
  pathToken: string;
  /**
   * Preferred: key in the secrets table for the Chatwoot API token.
   * When present, the adapter resolves the token from SecretService.
   */
  apiTokenSecretKey?: string;
  /**
   * Legacy: env var name holding the Chatwoot API token.
   * Kept for backward compatibility with instances seeded before SecretService
   * support. A deprecation warning is logged whenever this fallback is used.
   */
  apiTokenEnvVar?: string;
  /**
   * @deprecated No longer used — Chatwoot Agent Bots do not sign outbound
   * webhooks in v4.12.x. Auth is via the path token. Kept optional in the
   * type so deserialising older JSON rows does not error.
   */
  webhookSecretKey?: string;
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

/** VAPI (voice AI) integration config. */
export interface VapiIntegrationConfig {
  /** Key in the secrets table for the VAPI API key. */
  vapiApiKeySecretKey: string;
  /** VAPI assistant ID (pre-created in VAPI dashboard with custom LLM server URL). */
  assistantId: string;
  /** VAPI phone number ID (assigned to the assistant). */
  phoneNumberId: string;
  /** Human-readable phone number (e.g. "+15551234567"). */
  phoneNumber: string;
  /**
   * Optional agentId to use for this voice integration.
   * If not set, the first active agent in the project is used.
   */
  agentId?: string;
  /** Key in the secrets table for the VAPI webhook secret (x-vapi-secret header). */
  vapiWebhookSecretKey?: string;
}

/** Union of all per-provider integration configs. */
export type IntegrationConfigUnion =
  | ChatwootIntegrationConfig
  | TelegramIntegrationConfig
  | WhatsAppIntegrationConfig
  | WhatsAppWahaIntegrationConfig
  | SlackIntegrationConfig
  | VapiIntegrationConfig;

/** Map from provider to its config type. */
export interface IntegrationConfigMap {
  chatwoot: ChatwootIntegrationConfig;
  telegram: TelegramIntegrationConfig;
  whatsapp: WhatsAppIntegrationConfig;
  'whatsapp-waha': WhatsAppWahaIntegrationConfig;
  slack: SlackIntegrationConfig;
  vapi: VapiIntegrationConfig;
}

// ─── Zod Schemas for Integration Configs ────────────────────────

/** Path-token format: 32–128 lowercase hex chars (16–64 random bytes). */
export const ChatwootPathTokenSchema = z.string().regex(/^[a-f0-9]{32,128}$/, {
  message: 'pathToken must be 32–128 lowercase hex characters',
});

export const ChatwootIntegrationConfigSchema = z
  .object({
    baseUrl: z.string().url(),
    accountId: z.number().int().positive(),
    inboxId: z.number().int().positive(),
    agentBotId: z.number().int().positive(),
    agentId: z.string().min(1).optional(),
    pathToken: ChatwootPathTokenSchema,
    apiTokenSecretKey: z.string().min(1).max(128).optional(),
    apiTokenEnvVar: z.string().min(1).optional(),
    /** @deprecated kept only so older JSON rows still parse; no longer used. */
    webhookSecretKey: z.string().min(1).max(128).optional(),
  })
  .refine(
    (c) => c.apiTokenSecretKey !== undefined || c.apiTokenEnvVar !== undefined,
    { message: 'Either apiTokenSecretKey (preferred) or apiTokenEnvVar must be set' },
  );

/**
 * Subset of the chatwoot config accepted from API callers when *creating*
 * an integration — the server generates the pathToken and adds it to the
 * config before persisting.
 */
export const ChatwootIntegrationConfigCreateInputSchema = z
  .object({
    baseUrl: z.string().url(),
    accountId: z.number().int().positive(),
    inboxId: z.number().int().positive(),
    agentBotId: z.number().int().positive(),
    agentId: z.string().min(1).optional(),
    apiTokenSecretKey: z.string().min(1).max(128).optional(),
    apiTokenEnvVar: z.string().min(1).optional(),
  })
  .refine(
    (c) => c.apiTokenSecretKey !== undefined || c.apiTokenEnvVar !== undefined,
    { message: 'Either apiTokenSecretKey (preferred) or apiTokenEnvVar must be set' },
  );

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

export const VapiIntegrationConfigSchema = z.object({
  vapiApiKeySecretKey: z.string().min(1).max(128),
  assistantId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  phoneNumber: z.string().min(1),
  agentId: z.string().optional(),
  vapiWebhookSecretKey: z.string().min(1).max(128).optional(),
});

/** Discriminated union for creating integrations via API. */
export const CreateIntegrationConfigSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('chatwoot'), config: ChatwootIntegrationConfigSchema }),
  z.object({ provider: z.literal('telegram'), config: TelegramIntegrationConfigSchema }),
  z.object({ provider: z.literal('whatsapp'), config: WhatsAppIntegrationConfigSchema }),
  z.object({ provider: z.literal('whatsapp-waha'), config: WhatsAppWahaIntegrationConfigSchema }),
  z.object({ provider: z.literal('slack'), config: SlackIntegrationConfigSchema }),
  z.object({ provider: z.literal('vapi'), config: VapiIntegrationConfigSchema }),
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
  /**
   * Look up an *active* Chatwoot integration by its `config.pathToken`. Used
   * by the webhook handler to authenticate inbound deliveries without HMAC.
   */
  findActiveChatwootByPathToken(pathToken: string): Promise<ChannelIntegration | null>;
  update(id: ChannelIntegrationId, input: UpdateChannelIntegrationInput): Promise<ChannelIntegration>;
  delete(id: ChannelIntegrationId): Promise<void>;
  listActive(): Promise<ChannelIntegration[]>;
}
