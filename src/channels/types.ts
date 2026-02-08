import type { ProjectId } from '@/core/types.js';

// ─── Channel Types ──────────────────────────────────────────────

export type ChannelType = 'whatsapp' | 'telegram' | 'slack' | 'email';

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
