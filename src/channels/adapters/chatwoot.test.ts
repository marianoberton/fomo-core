import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChatwootAdapter } from './chatwoot.js';
import type { ProjectId } from '@/core/types.js';

describe('ChatwootAdapter', () => {
  const config = {
    baseUrl: 'https://chatwoot.test.io',
    apiToken: 'test_token_123',
    accountId: 1,
    agentBotId: 5,
    projectId: 'proj-001' as ProjectId,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('channelType', () => {
    it('returns chatwoot', () => {
      const adapter = createChatwootAdapter(config);
      expect(adapter.channelType).toBe('chatwoot');
    });
  });

  describe('accountId', () => {
    it('exposes the account ID', () => {
      const adapter = createChatwootAdapter(config);
      expect(adapter.accountId).toBe(1);
    });
  });

  describe('projectId', () => {
    it('exposes the project ID', () => {
      const adapter = createChatwootAdapter(config);
      expect(adapter.projectId).toBe('proj-001');
    });
  });

  describe('send', () => {
    it('sends a message successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42, content: 'Hello', message_type: 'outgoing', created_at: 1234567890 }),
      } as Response);

      const adapter = createChatwootAdapter(config);
      const result = await adapter.send({
        channel: 'chatwoot',
        recipientIdentifier: '99',
        content: 'Hello from Nexus',
      });

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('42');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(fetch).toHaveBeenCalledWith(
        'https://chatwoot.test.io/api/v1/accounts/1/conversations/99/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'api_access_token': 'test_token_123',
          }) as Record<string, string>,
        }),
      );
    });

    it('handles API errors gracefully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as Response);

      const adapter = createChatwootAdapter(config);
      const result = await adapter.send({
        channel: 'chatwoot',
        recipientIdentifier: '99',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Chatwoot API error 500');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));

      const adapter = createChatwootAdapter(config);
      const result = await adapter.send({
        channel: 'chatwoot',
        recipientIdentifier: '99',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('parseInbound', () => {
    it('parses an incoming text message from a contact', async () => {
      const adapter = createChatwootAdapter(config);
      const payload = {
        event: 'message_created',
        id: 'msg-123',
        message_type: 'incoming',
        content_type: 'text',
        content: 'Hola, necesito ayuda',
        account: { id: 1, name: 'Acme' },
        conversation: { id: 42, status: 'open' },
        sender: { id: 10, name: 'Juan Perez', type: 'contact' },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('cw-msg-123');
      expect(result?.channel).toBe('chatwoot');
      expect(result?.senderIdentifier).toBe('42');
      expect(result?.senderName).toBe('Juan Perez');
      expect(result?.content).toBe('Hola, necesito ayuda');
      expect(result?.projectId).toBe('proj-001');
    });

    it('ignores outgoing messages', async () => {
      const adapter = createChatwootAdapter(config);
      const payload = {
        event: 'message_created',
        id: 'msg-124',
        message_type: 'outgoing',
        content: 'Bot response',
        account: { id: 1 },
        conversation: { id: 42 },
        sender: { id: 1, type: 'user' },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('ignores non-message events', async () => {
      const adapter = createChatwootAdapter(config);
      const payload = {
        event: 'conversation_created',
        account: { id: 1 },
        conversation: { id: 42 },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('ignores messages from users (agents)', async () => {
      const adapter = createChatwootAdapter(config);
      const payload = {
        event: 'message_created',
        id: 'msg-125',
        message_type: 'incoming',
        content: 'Agent message',
        account: { id: 1 },
        conversation: { id: 42 },
        sender: { id: 5, name: 'Agent Smith', type: 'user' },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('ignores empty content', async () => {
      const adapter = createChatwootAdapter(config);
      const payload = {
        event: 'message_created',
        message_type: 'incoming',
        content: '',
        account: { id: 1 },
        conversation: { id: 42 },
        sender: { id: 10, type: 'contact' },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });
  });

  describe('isHealthy', () => {
    it('returns true when API is accessible', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      } as Response);

      const adapter = createChatwootAdapter(config);
      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(true);
    });

    it('returns false on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const adapter = createChatwootAdapter(config);
      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('handoffToHuman', () => {
    it('unassigns bot and adds internal note', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42 }),
      } as Response);

      const adapter = createChatwootAdapter(config);
      await adapter.handoffToHuman(42, 'Cliente necesita ayuda humana');

      // Should call: assignments, toggle_status, messages (note)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(fetch).toHaveBeenCalledTimes(3);

      const calls = vi.mocked(fetch).mock.calls;

      // First call: assignment
      expect(calls[0]?.[0]).toContain('/conversations/42/assignments');

      // Second call: toggle_status
      expect(calls[1]?.[0]).toContain('/conversations/42/toggle_status');

      // Third call: internal note
      expect(calls[2]?.[0]).toContain('/conversations/42/messages');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const noteBody = JSON.parse(calls[2]?.[1]?.body as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(noteBody.private).toBe(true);
    });

    it('skips note when no message provided', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42 }),
      } as Response);

      const adapter = createChatwootAdapter(config);
      await adapter.handoffToHuman(42);

      // Only 2 calls: assignment + toggle_status (no note)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('resumeBot', () => {
    it('reassigns and sets status to pending', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42 }),
      } as Response);

      const adapter = createChatwootAdapter(config);
      await adapter.resumeBot(42);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(fetch).toHaveBeenCalledTimes(2);

      const calls = vi.mocked(fetch).mock.calls;
      expect(calls[0]?.[0]).toContain('/conversations/42/assignments');
      expect(calls[1]?.[0]).toContain('/conversations/42/toggle_status');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const statusBody = JSON.parse(calls[1]?.[1]?.body as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(statusBody.status).toBe('pending');
    });
  });
});
