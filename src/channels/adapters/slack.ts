/**
 * Slack Channel Adapter — sends/receives messages via Slack Web API.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface SlackAdapterConfig {
  /** Environment variable name containing the bot token (xoxb-...) */
  botTokenEnvVar: string;
  /** Environment variable name containing the signing secret (for webhook verification) */
  signingSecretEnvVar?: string;
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
  const getToken = (): string => {
    const token = process.env[config.botTokenEnvVar];
    if (!token) {
      throw new Error(`Missing env var: ${config.botTokenEnvVar}`);
    }
    return token;
  };

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
            'Authorization': `Bearer ${getToken()}`,
          },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as SlackSendResponse;

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

    async parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const event = payload as SlackEventPayload;

      // Handle URL verification challenge
      if (event.type === 'url_verification') {
        // This should be handled at the route level, not here
        return null;
      }

      // Handle message events
      if (event.event?.type !== 'message') return null;

      const messageEvent = event.event;

      // Skip bot messages to avoid loops
      if (!messageEvent.user) return null;

      return {
        id: `slack-${messageEvent.ts}`,
        channel: 'slack',
        channelMessageId: messageEvent.ts,
        projectId: '', // Will be resolved by inbound processor
        senderIdentifier: messageEvent.channel,
        senderName: messageEvent.user, // This is user ID, would need API call for name
        content: messageEvent.text,
        replyToChannelMessageId: messageEvent.thread_ts,
        rawPayload: payload,
        receivedAt: new Date(Number(messageEvent.event_ts) * 1000),
      };
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch('https://slack.com/api/auth.test', {
          headers: {
            'Authorization': `Bearer ${getToken()}`,
          },
        });
        const data = (await response.json()) as { ok: boolean };
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
