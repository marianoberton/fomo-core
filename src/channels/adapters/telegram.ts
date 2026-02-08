/**
 * Telegram Channel Adapter — sends/receives messages via Telegram Bot API.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface TelegramAdapterConfig {
  /** Environment variable name containing the bot token */
  botTokenEnvVar: string;
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
    photo?: Array<{ file_id: string }>;
    document?: { file_id: string };
  };
}

// ─── Adapter Factory ────────────────────────────────────────────

/**
 * Create a Telegram channel adapter.
 */
export function createTelegramAdapter(config: TelegramAdapterConfig): ChannelAdapter {
  const getToken = (): string => {
    const token = process.env[config.botTokenEnvVar];
    if (!token) {
      throw new Error(`Missing env var: ${config.botTokenEnvVar}`);
    }
    return token;
  };

  const baseUrl = (): string => `https://api.telegram.org/bot${getToken()}`;

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

        const response = await fetch(`${baseUrl()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as TelegramSendResponse;

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

    async parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const update = payload as TelegramUpdate;
      const message = update.message;

      if (!message) return null;

      const text = message.text;
      if (!text) return null; // Skip non-text messages for now

      const chat = message.chat;
      const from = message.from;

      // Build sender name
      let senderName: string | undefined;
      if (from) {
        const parts = [from.first_name, from.last_name].filter(Boolean);
        senderName = parts.length > 0 ? parts.join(' ') : from.username;
      }

      return {
        id: `tg-${message.message_id}`,
        channel: 'telegram',
        channelMessageId: String(message.message_id),
        projectId: '', // Will be resolved by inbound processor
        senderIdentifier: String(chat.id),
        senderName,
        content: text,
        replyToChannelMessageId: message.reply_to_message
          ? String(message.reply_to_message.message_id)
          : undefined,
        rawPayload: payload,
        receivedAt: new Date(message.date * 1000),
      };
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl()}/getMe`);
        const data = (await response.json()) as { ok: boolean };
        return data.ok;
      } catch {
        return false;
      }
    },
  };
}
