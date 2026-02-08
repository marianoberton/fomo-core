/**
 * WhatsApp Channel Adapter — sends/receives messages via WhatsApp Cloud API.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

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
  contacts?: Array<{ wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
  };
}

interface WhatsAppWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          context?: {
            from: string;
            id: string;
          };
        }>;
      };
      field: string;
    }>;
  }>;
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

        const data = (await response.json()) as WhatsAppSendResponse;

        if (data.messages && data.messages.length > 0) {
          return {
            success: true,
            channelMessageId: data.messages[0].id,
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

    async parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const webhook = payload as WhatsAppWebhookPayload;

      if (webhook.object !== 'whatsapp_business_account') return null;

      const entry = webhook.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value?.messages || value.messages.length === 0) return null;

      const message = value.messages[0];
      const contact = value.contacts?.[0];

      // Only handle text messages for now
      if (message.type !== 'text' || !message.text?.body) return null;

      return {
        id: `wa-${message.id}`,
        channel: 'whatsapp',
        channelMessageId: message.id,
        projectId: '', // Will be resolved by inbound processor
        senderIdentifier: message.from,
        senderName: contact?.profile?.name,
        content: message.text.body,
        replyToChannelMessageId: message.context?.id,
        rawPayload: payload,
        receivedAt: new Date(Number(message.timestamp) * 1000),
      };
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
