/**
 * VAPI channel adapter — voice AI via vapi.ai.
 *
 * Responsibilities:
 *  - send()       — trigger outbound calls via VAPI API
 *  - parseInbound() — returns null (inbound turns handled by the custom-llm route)
 *  - isHealthy()  — verify VAPI API is reachable
 *
 * Inbound voice conversations are driven by the custom LLM server pattern:
 * VAPI calls POST /api/v1/vapi/custom-llm/:integrationId for each conversation turn.
 * This adapter is used only for outbound calling and health checks.
 */
import type { ProjectId } from '@/core/types.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface VapiAdapterConfig {
  vapiApiKey: string;
  assistantId: string;
  phoneNumberId: string;
  projectId: ProjectId;
}

// ─── VAPI API Types ──────────────────────────────────────────────

interface VapiCallResponse {
  id?: string;
  status?: string;
  error?: string;
}

// ─── Adapter Factory ─────────────────────────────────────────────

/** Create a VAPI channel adapter for outbound calls and health checks. */
export function createVapiAdapter(config: VapiAdapterConfig): ChannelAdapter {
  const { vapiApiKey, assistantId, phoneNumberId, projectId } = config;

  const VAPI_BASE = 'https://api.vapi.ai';

  function authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${vapiApiKey}`,
      'Content-Type': 'application/json',
    };
  }

  return {
    channelType: 'vapi',

    /**
     * Trigger an outbound call via VAPI API.
     * message.recipientIdentifier = customer phone number (e.g. "+15551234567")
     * message.content = unused (VAPI uses the assistant's configured prompt)
     */
    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const res = await fetch(`${VAPI_BASE}/call`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            assistantId,
            phoneNumberId,
            customer: { number: message.recipientIdentifier },
          }),
        });

        const data = (await res.json()) as VapiCallResponse;

        if (!res.ok) {
          return {
            success: false,
            error: data.error ?? `VAPI returned ${String(res.status)}`,
          };
        }

        return { success: true, channelMessageId: data.id };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to trigger VAPI call',
        };
      }
    },

    /**
     * VAPI inbound turns are handled directly by the custom-llm route.
     * This method always returns null.
     */
    async parseInbound(_payload: unknown): Promise<InboundMessage | null> {
      void _payload;
      void projectId;
      return null;
    },

    /** Check VAPI API reachability. */
    async isHealthy(): Promise<boolean> {
      try {
        const res = await fetch(`${VAPI_BASE}/call?limit=1`, {
          headers: authHeaders(),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
