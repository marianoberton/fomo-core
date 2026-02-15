import type { ProjectId } from '@/core/types.js';

// ─── Channel Types ──────────────────────────────────────────────

export type ChannelType = 'whatsapp' | 'telegram' | 'slack' | 'email' | 'chatwoot';

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

// ─── Channel Config ─────────────────────────────────────────────

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

// ─── Channel Integration ───────────────────────────────────────

export type ChannelIntegrationId = string;
export type IntegrationProvider = 'chatwoot';

/** Chatwoot-specific integration config stored in the JSON column. */
export interface ChatwootIntegrationConfig {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  agentBotId: number;
  /** Env var name for the Chatwoot API token (NOT the token itself). */
  apiTokenEnvVar: string;
}

/** Channel integration record — maps a project to an external channel provider. */
export interface ChannelIntegration {
  id: ChannelIntegrationId;
  projectId: ProjectId;
  provider: IntegrationProvider;
  config: ChatwootIntegrationConfig;
  status: 'active' | 'paused';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChannelIntegrationInput {
  projectId: ProjectId;
  provider: IntegrationProvider;
  config: ChatwootIntegrationConfig;
  status?: 'active' | 'paused';
}

export interface UpdateChannelIntegrationInput {
  config?: ChatwootIntegrationConfig;
  status?: 'active' | 'paused';
}

/** Repository for channel integrations. */
export interface ChannelIntegrationRepository {
  create(input: CreateChannelIntegrationInput): Promise<ChannelIntegration>;
  findById(id: ChannelIntegrationId): Promise<ChannelIntegration | null>;
  findByProject(projectId: ProjectId): Promise<ChannelIntegration | null>;
  findByProviderAccount(provider: IntegrationProvider, accountId: number): Promise<ChannelIntegration | null>;
  update(id: ChannelIntegrationId, input: UpdateChannelIntegrationInput): Promise<ChannelIntegration>;
  delete(id: ChannelIntegrationId): Promise<void>;
  listActive(): Promise<ChannelIntegration[]>;
}
