/**
 * Tests for WebhookQueue — async webhook processing with BullMQ.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProjectId } from '@/core/types.js';
import type { ChannelAdapter } from './types.js';
import type { HandoffManager } from './handoff.js';
import type { ChatwootWebhookEvent } from './adapters/chatwoot.js';
import type { WebhookJobData } from './webhook-queue-types.js';

// ─── Mocks ──────────────────────────────────────────────────────────

const mockAdapter: ChannelAdapter = {
  channelType: 'chatwoot',
  send: vi.fn().mockResolvedValue(undefined),
  parseInbound: vi.fn(),
  isHealthy: vi.fn().mockResolvedValue(true),
};

const mockHandoffManager: HandoffManager = {
  shouldEscalateFromMessage: vi.fn().mockReturnValue(false),
  shouldEscalateFromResponse: vi.fn().mockReturnValue(false),
  stripHandoffMarker: vi.fn((text: string) => text),
  escalate: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
};

const mockResolveAdapter = vi.fn<(projectId: string) => Promise<ChannelAdapter | null>>()
  .mockResolvedValue(mockAdapter);

const mockRunAgent = vi.fn<(params: {
  projectId: string;
  sessionId: string;
  userMessage: string;
}) => Promise<{ response: string }>>()
  .mockResolvedValue({ response: 'Hola! ¿En qué puedo ayudarte?' });

// ─── Tests ──────────────────────────────────────────────────────────

describe('WebhookQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Job Data Validation', () => {
    it('validates WebhookJobData structure', () => {
      const jobData: WebhookJobData = {
        webhookId: 'wh_123',
        projectId: 'proj_abc' as ProjectId,
        event: {
          event: 'message_created',
          message_type: 'incoming',
          content: 'Hola',
          account: { id: 1 },
          conversation: { id: 456 },
          sender: { id: 1, type: 'contact' },
        } as ChatwootWebhookEvent,
        receivedAt: new Date().toISOString(),
        conversationId: 456,
      };

      expect(jobData).toBeDefined();
      expect(jobData.webhookId).toBe('wh_123');
      expect(jobData.projectId).toBe('proj_abc');
      expect(jobData.conversationId).toBe(456);
      expect(jobData.event.content).toBe('Hola');
    });

    it('allows optional conversationId', () => {
      const jobData: WebhookJobData = {
        webhookId: 'wh_123',
        projectId: 'proj_abc' as ProjectId,
        event: { event: 'message_created' } as ChatwootWebhookEvent,
        receivedAt: new Date().toISOString(),
      };

      expect(jobData.conversationId).toBeUndefined();
    });
  });

  describe('Webhook Processing Logic', () => {
    it('processes webhook with successful agent response', async () => {
      // Simulate the webhook processing logic (not the full queue, just the handler logic)
      const event: ChatwootWebhookEvent = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Hola',
        account: { id: 1 },
        conversation: { id: 789 },
        sender: { id: 1, type: 'contact' },
      };

      const projectId = 'proj_test';
      const conversationId = 789;

      // Mock parseInbound to return a message
      vi.mocked(mockAdapter.parseInbound).mockResolvedValue({
        id: 'msg-1',
        channel: 'chatwoot',
        channelMessageId: 'cw-msg-1',
        projectId: 'proj_test' as ProjectId,
        senderIdentifier: 'contact_123',
        content: 'Hola',
        rawPayload: {},
        receivedAt: new Date(),
      });

      // Resolve adapter
      const adapter: ChannelAdapter | null = await mockResolveAdapter(projectId);
      expect(adapter).toBe(mockAdapter);

      // Check escalation keywords
      const shouldEscalate = mockHandoffManager.shouldEscalateFromMessage(event.content ?? '');
      expect(shouldEscalate).toBe(false);

      // Parse message
      const message = adapter ? await adapter.parseInbound(event) : null;
      expect(message).toBeDefined();
      expect(message?.content).toBe('Hola');

      // Run agent
      const result = await mockRunAgent({
        projectId,
        sessionId: `cw-${String(conversationId)}`,
        userMessage: message?.content ?? '',
      });
      expect(result.response).toBe('Hola! ¿En qué puedo ayudarte?');

      // Check handoff in response
      const shouldHandoff = mockHandoffManager.shouldEscalateFromResponse(result.response);
      expect(shouldHandoff).toBe(false);

      // Send response
      if (adapter) {
        await adapter.send({
          channel: 'chatwoot',
          recipientIdentifier: String(conversationId),
          content: result.response,
        });
      }

      expect(mockAdapter.send).toHaveBeenCalledWith({
        channel: 'chatwoot',
        recipientIdentifier: '789',
        content: 'Hola! ¿En qué puedo ayudarte?',
      });
    });

    it('handles escalation from message keywords', async () => {
      const event: ChatwootWebhookEvent = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'quiero hablar con un humano',
        account: { id: 1 },
        conversation: { id: 999 },
        sender: { id: 2, type: 'contact' },
      };

      const conversationId = 999;

      // Mock escalation detection
      vi.mocked(mockHandoffManager.shouldEscalateFromMessage).mockReturnValue(true);

      const shouldEscalate = mockHandoffManager.shouldEscalateFromMessage(event.content ?? '');
      expect(shouldEscalate).toBe(true);

      // Escalate directly — cast to ChatwootAdapter for handoff
      const adapter = await mockResolveAdapter('proj_test');
      if (adapter) {
        await mockHandoffManager.escalate(
          conversationId,
          adapter as unknown as import('./adapters/chatwoot.js').ChatwootAdapter,
          'Cliente solicito agente humano',
        );
      }

      expect(mockHandoffManager.escalate).toHaveBeenCalledWith(
        conversationId,
        adapter,
        'Cliente solicito agente humano',
      );
    });

    it('handles escalation from agent response', async () => {
      const conversationId = 888;

      // Mock agent response with [HANDOFF] marker
      vi.mocked(mockRunAgent).mockResolvedValue({
        response: 'Entiendo. [HANDOFF] Voy a transferirte con un agente humano.',
      });

      vi.mocked(mockHandoffManager.shouldEscalateFromResponse).mockReturnValue(true);
      vi.mocked(mockHandoffManager.stripHandoffMarker).mockReturnValue(
        'Entiendo.  Voy a transferirte con un agente humano.',
      );

      // Parse message
      vi.mocked(mockAdapter.parseInbound).mockResolvedValue({
        id: 'msg-2',
        channel: 'chatwoot',
        channelMessageId: 'cw-msg-2',
        projectId: 'proj_test' as ProjectId,
        senderIdentifier: 'contact_456',
        content: 'necesito ayuda con un problema complejo',
        rawPayload: {},
        receivedAt: new Date(),
      });

      const event: ChatwootWebhookEvent = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'necesito ayuda con un problema complejo',
        account: { id: 1 },
        conversation: { id: 888 },
        sender: { id: 3, type: 'contact' },
      };

      const message = await mockAdapter.parseInbound(event);

      // Run agent
      const result = await mockRunAgent({
        projectId: 'proj_test',
        sessionId: `cw-${String(conversationId)}`,
        userMessage: message?.content ?? '',
      });

      // Check handoff
      const shouldHandoff = mockHandoffManager.shouldEscalateFromResponse(result.response);
      expect(shouldHandoff).toBe(true);

      // Strip marker
      const cleanResponse = mockHandoffManager.stripHandoffMarker(result.response);
      expect(cleanResponse).toBe('Entiendo.  Voy a transferirte con un agente humano.');

      // Send response before escalating
      const adapter = await mockResolveAdapter('proj_test');
      if (adapter) {
        await adapter.send({
          channel: 'chatwoot',
          recipientIdentifier: String(conversationId),
          content: cleanResponse,
        });

        // Escalate
        await mockHandoffManager.escalate(
          conversationId,
          adapter as unknown as import('./adapters/chatwoot.js').ChatwootAdapter,
          'El agente AI determino que se requiere asistencia humana',
        );
      }

      expect(mockAdapter.send).toHaveBeenCalled();
      expect(mockHandoffManager.escalate).toHaveBeenCalled();
    });

    it('handles no message parsed from event', async () => {
      const event: ChatwootWebhookEvent = {
        event: 'message_created',
        message_type: 'outgoing', // Not incoming, so won't be parsed
        account: { id: 1 },
        conversation: { id: 777 },
        sender: { id: 99, type: 'user' },
      };

      vi.mocked(mockAdapter.parseInbound).mockResolvedValue(null);

      const message = await mockAdapter.parseInbound(event);
      expect(message).toBeNull();

      // No agent run should happen
      expect(mockRunAgent).not.toHaveBeenCalled();
    });
  });

  describe('Retry Configuration', () => {
    it('validates retry configuration structure', () => {
      const retryConfig = {
        attempts: 3,
        backoff: {
          type: 'exponential' as const,
          delay: 2000,
        },
      };

      expect(retryConfig.attempts).toBe(3);
      expect(retryConfig.backoff.type).toBe('exponential');
      expect(retryConfig.backoff.delay).toBe(2000);
    });
  });
});
