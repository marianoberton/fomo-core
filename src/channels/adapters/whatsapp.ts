/**
 * WhatsApp Channel Adapter — sends/receives messages via WhatsApp Cloud API.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface WhatsAppAdapterConfig {
  /** Environment variable name containing the access token */
  accessTokenEnvVar: string;
  /** WhatsApp Business Phone Number ID */
  phoneNumberId: string;
  /** API version (default: v18.0) */
  apiVersion?: string;
}

// ─── WhatsApp API Types ─────────────────────────────────────────

interface WhatsAppSendResponse {
  messaging_product: string;
  contacts?: { wa_id: string }[];
  messages?: { id: string }[];
  error?: {
    message: string;
    type: string;
    code: number;
  };
}

interface WhatsAppWebhookPayload {
  object: string;
  entry?: {
    id: string;
    changes?: {
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: {
          profile: { name: string };
          wa_id: string;
        }[];
        messages?: {
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: {
            id: string;
            mime_type?: string;
            sha256?: string;
            caption?: string;
          };
          context?: {
            from: string;
            id: string;
          };
        }[];
      };
      field: string;
    }[];
  }[];
}

// ─── Adapter Factory ────────────────────────────────────────────

/**
 * Create a WhatsApp Cloud API channel adapter.
 */
export function createWhatsAppAdapter(config: WhatsAppAdapterConfig): ChannelAdapter {
  const getToken = (): string => {
    const token = process.env[config.accessTokenEnvVar];
    if (!token) {
      throw new Error(`Missing env var: ${config.accessTokenEnvVar}`);
    }
    return token;
  };

  const apiVersion = config.apiVersion ?? 'v18.0';
  const baseUrl = `https://graph.facebook.com/${apiVersion}/${config.phoneNumberId}`;

  return {
    channelType: 'whatsapp',

    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: message.recipientIdentifier,
          type: 'text',
          text: {
            preview_url: false,
            body: message.content,
          },
        };

        const response = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getToken()}`,
          },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as unknown as WhatsAppSendResponse;

        if (data.messages && data.messages.length > 0) {
          return {
            success: true,
            channelMessageId: data.messages[0]?.id,
          };
        }

        return {
          success: false,
          error: data.error?.message ?? 'Unknown WhatsApp error',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },

    parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const webhook = payload as WhatsAppWebhookPayload;

      if (webhook.object !== 'whatsapp_business_account') return Promise.resolve(null);

      const entry = webhook.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value?.messages || value.messages.length === 0) return Promise.resolve(null);

      const message = value.messages[0];
      const contact = value.contacts?.[0];

      if (!message) return Promise.resolve(null);

      // Handle text messages
      if (message.type === 'text' && message.text?.body) {
        return Promise.resolve({
          id: `wa-${message.id}`,
          channel: 'whatsapp' as const,
          channelMessageId: message.id,
          projectId: '' as ProjectId, // Will be resolved by inbound processor
          senderIdentifier: message.from,
          senderName: contact?.profile.name,
          content: message.text.body,
          replyToChannelMessageId: message.context?.id,
          rawPayload: payload,
          receivedAt: new Date(Number(message.timestamp) * 1000),
        });
      }

      // Handle image messages
      if (message.type === 'image' && message.image?.id) {
        const caption = message.image.caption ?? '[Image received]';
        // Store the media ID in rawPayload for later retrieval
        return Promise.resolve({
          id: `wa-${message.id}`,
          channel: 'whatsapp' as const,
          channelMessageId: message.id,
          projectId: '' as ProjectId,
          senderIdentifier: message.from,
          senderName: contact?.profile.name,
          content: caption,
          mediaUrls: [message.image.id], // Store media ID, will be converted to URL later
          replyToChannelMessageId: message.context?.id,
          rawPayload: payload,
          receivedAt: new Date(Number(message.timestamp) * 1000),
        });
      }

      // Ignore other message types for now (audio, video, document, sticker, etc.)
      return Promise.resolve(null);
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch(baseUrl, {
          headers: {
            'Authorization': `Bearer ${getToken()}`,
          },
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
