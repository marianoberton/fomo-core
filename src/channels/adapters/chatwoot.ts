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
  const { baseUrl, apiToken, accountId, agentBotId, projectId } = config;
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
