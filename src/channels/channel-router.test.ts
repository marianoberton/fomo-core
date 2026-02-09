import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@/observability/types.js';
import type { ChannelAdapter, OutboundMessage } from './types.js';
import { createChannelRouter } from './channel-router.js';

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createMockAdapter(channelType: 'telegram' | 'whatsapp' | 'slack'): ChannelAdapter {
  return {
    channelType,
    send: vi.fn().mockResolvedValue({ success: true, channelMessageId: 'msg_123' }),
    parseInbound: vi.fn().mockResolvedValue(null),
    isHealthy: vi.fn().mockResolvedValue(true),
  };
}

describe('ChannelRouter', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    vi.clearAllMocks();
  });

  describe('registerAdapter', () => {
    it('registers an adapter', () => {
      const router = createChannelRouter({ logger });
      const adapter = createMockAdapter('telegram');

      router.registerAdapter(adapter);

      expect(router.getAdapter('telegram')).toBe(adapter);
      expect(logger.info).toHaveBeenCalledWith(
        'Registered channel adapter: telegram',
        { component: 'channel-router' }
      );
    });

    it('lists registered channels', () => {
      const router = createChannelRouter({ logger });
      router.registerAdapter(createMockAdapter('telegram'));
      router.registerAdapter(createMockAdapter('whatsapp'));

      const channels = router.listChannels();

      expect(channels).toContain('telegram');
      expect(channels).toContain('whatsapp');
      expect(channels).toHaveLength(2);
    });
  });

  describe('send', () => {
    it('sends message through correct adapter', async () => {
      const router = createChannelRouter({ logger });
      const adapter = createMockAdapter('telegram');
      router.registerAdapter(adapter);

      const message: OutboundMessage = {
        channel: 'telegram',
        recipientIdentifier: '123456',
        content: 'Hello!',
      };

      const result = await router.send(message);

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('msg_123');
      expect(adapter.send).toHaveBeenCalledWith(message);
    });

    it('returns error when adapter not found', async () => {
      const router = createChannelRouter({ logger });

      const message: OutboundMessage = {
        channel: 'telegram',
        recipientIdentifier: '123456',
        content: 'Hello!',
      };

      const result = await router.send(message);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No adapter registered');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('handles adapter errors gracefully', async () => {
      const router = createChannelRouter({ logger });
      const adapter = createMockAdapter('telegram');
      vi.mocked(adapter.send).mockRejectedValue(new Error('Network error'));
      router.registerAdapter(adapter);

      const message: OutboundMessage = {
        channel: 'telegram',
        recipientIdentifier: '123456',
        content: 'Hello!',
      };

      const result = await router.send(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('parseInbound', () => {
    it('parses inbound message through correct adapter', async () => {
      const router = createChannelRouter({ logger });
      const adapter = createMockAdapter('telegram');
      vi.mocked(adapter.parseInbound).mockResolvedValue({
        id: 'tg-123',
        channel: 'telegram',
        channelMessageId: '123',
        projectId: '',
        senderIdentifier: '456',
        content: 'Hello!',
        rawPayload: {},
        receivedAt: new Date(),
      });
      router.registerAdapter(adapter);

      const result = await router.parseInbound('telegram', { message: {} });

      expect(result).not.toBeNull();
      expect(result?.channel).toBe('telegram');
      expect(adapter.parseInbound).toHaveBeenCalled();
    });

    it('returns null when adapter not found', async () => {
      const router = createChannelRouter({ logger });

      const result = await router.parseInbound('telegram', {});

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('returns health status from adapter', async () => {
      const router = createChannelRouter({ logger });
      const adapter = createMockAdapter('telegram');
      router.registerAdapter(adapter);

      const isHealthy = await router.isHealthy('telegram');

      expect(isHealthy).toBe(true);
      expect(adapter.isHealthy).toHaveBeenCalled();
    });

    it('returns false when adapter not found', async () => {
      const router = createChannelRouter({ logger });

      const isHealthy = await router.isHealthy('telegram');

      expect(isHealthy).toBe(false);
    });

    it('returns false when health check throws', async () => {
      const router = createChannelRouter({ logger });
      const adapter = createMockAdapter('telegram');
      vi.mocked(adapter.isHealthy).mockRejectedValue(new Error('Health check failed'));
      router.registerAdapter(adapter);

      const isHealthy = await router.isHealthy('telegram');

      expect(isHealthy).toBe(false);
    });
  });
});
