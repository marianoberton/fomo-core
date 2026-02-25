/**
 * WhatsApp WAHA Adapter — sends/receives messages via WAHA (WhatsApp HTTP API).
 *
 * WAHA is a self-hosted Docker container that wraps the WhatsApp Web protocol
 * into a REST API. This adapter communicates with WAHA over HTTP — no new npm
 * dependencies required.
 *
 * @see https://waha.devlike.pro/docs/
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface WhatsAppWahaAdapterConfig {
  /** Base URL of the WAHA instance (e.g. "http://localhost:3003"). */
  wahaBaseUrl: string;
  /** WAHA session name (default: "default"). */
  sessionName: string;
  /** Project ID for tagging inbound messages. */
  projectId: ProjectId;
  /** Optional API key for WAHA authentication (WAHA_API_KEY env var). */
  apiKey?: string;
}

// ─── WAHA API Types ─────────────────────────────────────────────

interface WahaSendResponse {
  id?: string;
  status?: string;
  error?: string;
}

interface WahaWebhookPayload {
  event: string;
  session: string;
  engine?: string;
  payload?: {
    id?: string;
    timestamp?: number;
    from?: string;
    fromMe?: boolean;
    to?: string;
    body?: string;
    hasMedia?: boolean;
    mediaUrl?: string;
    /** Participant info for contact name */
    _data?: {
      notifyName?: string;
    };
  };
}

// ─── Adapter Factory ────────────────────────────────────────────

/**
 * Create a WAHA-backed WhatsApp channel adapter.
 */
export function createWhatsAppWahaAdapter(config: WhatsAppWahaAdapterConfig): ChannelAdapter {
  const { wahaBaseUrl, sessionName, projectId, apiKey } = config;
  const baseApi = `${wahaBaseUrl.replace(/\/$/, '')}/api`;
  const wahaHeaders = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
  };

  /** Convert phone number to WAHA chat ID format. */
  function toChatId(phone: string): string {
    // Remove any non-digit characters and add @c.us suffix
    const digits = phone.replace(/\D/g, '');
    return `${digits}@c.us`;
  }

  /** Extract phone number from WAHA chat ID. */
  function fromChatId(chatId: string): string {
    return chatId.replace(/@c\.us$/, '').replace(/@s\.whatsapp\.net$/, '');
  }

  return {
    channelType: 'whatsapp-waha',

    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const chatId = toChatId(message.recipientIdentifier);

        const response = await fetch(`${baseApi}/sendText`, {
          method: 'POST',
          headers: wahaHeaders,
          body: JSON.stringify({
            chatId,
            text: message.content,
            session: sessionName,
          }),
        });

        const data = (await response.json()) as unknown as WahaSendResponse;

        if (response.ok && data.id) {
          return { success: true, channelMessageId: data.id };
        }

        return {
          success: false,
          error: data.error ?? `WAHA send failed with status ${String(response.status)}`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown WAHA send error',
        };
      }
    },

    parseInbound(payload: unknown): Promise<InboundMessage | null> {
      const webhook = payload as WahaWebhookPayload;

      // Only process incoming message events
      if (webhook.event !== 'message') return Promise.resolve(null);

      const msg = webhook.payload;
      if (!msg || msg.fromMe || !msg.body || !msg.from) return Promise.resolve(null);

      const phone = fromChatId(msg.from);
      const senderName = msg._data?.notifyName;

      return Promise.resolve({
        id: `waha-${msg.id ?? Date.now()}`,
        channel: 'whatsapp-waha',
        channelMessageId: msg.id ?? `waha-${Date.now()}`,
        projectId,
        senderIdentifier: phone,
        senderName,
        content: msg.body,
        mediaUrls: msg.mediaUrl ? [msg.mediaUrl] : undefined,
        rawPayload: payload,
        receivedAt: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
      });
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch(`${baseApi}/sessions/${sessionName}`, {
          method: 'GET',
          headers: wahaHeaders,
        });

        if (!response.ok) return false;

        const data = (await response.json()) as unknown as { status?: string };
        return data.status === 'WORKING' || data.status === 'SCAN_QR_CODE';
      } catch {
        return false;
      }
    },
  };
}
