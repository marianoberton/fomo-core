import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTelegramAdapter } from './telegram.js';
import type { ProjectId } from '@/core/types.js';

describe('TelegramAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultConfig = {
    botToken: 'test_bot_token',
    projectId: 'test-project' as ProjectId,
  };

  describe('channelType', () => {
    it('returns telegram', () => {
      const adapter = createTelegramAdapter(defaultConfig);
      expect(adapter.channelType).toBe('telegram');
    });
  });

  describe('send', () => {
    it('sends a message successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: { message_id: 12345 },
        }),
      } as Response);

      const adapter = createTelegramAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'telegram',
        recipientIdentifier: '987654321',
        content: 'Hello, World!',
      });

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('12345');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest_bot_token/sendMessage',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('handles reply_to_message_id', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: { message_id: 12345 },
        }),
      } as Response);

      const adapter = createTelegramAdapter(defaultConfig);
      await adapter.send({
        channel: 'telegram',
        recipientIdentifier: '987654321',
        content: 'Reply message',
        replyToChannelMessageId: '999',
      });

      const callArgs = vi.mocked(fetch).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(callArgs?.[1]?.body as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.reply_to_message_id).toBe(999);
    });

    it('handles HTML parse mode', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: { message_id: 12345 },
        }),
      } as Response);

      const adapter = createTelegramAdapter(defaultConfig);
      await adapter.send({
        channel: 'telegram',
        recipientIdentifier: '987654321',
        content: '<b>Bold</b>',
        options: { parseMode: 'html' },
      });

      const callArgs = vi.mocked(fetch).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(callArgs?.[1]?.body as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.parse_mode).toBe('HTML');
    });

    it('handles API errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: false,
          description: 'Bad Request: chat not found',
        }),
      } as Response);

      const adapter = createTelegramAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'telegram',
        recipientIdentifier: 'invalid',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bad Request: chat not found');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const adapter = createTelegramAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'telegram',
        recipientIdentifier: '123',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('parseInbound', () => {
    it('parses a text message', async () => {
      const adapter = createTelegramAdapter(defaultConfig);
      const payload = {
        message: {
          message_id: 123,
          date: 1704067200,
          text: 'Hello from Telegram',
          chat: {
            id: 987654321,
            type: 'private',
          },
          from: {
            id: 111222333,
            first_name: 'John',
            last_name: 'Doe',
          },
        },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('tg-123');
      expect(result?.channel).toBe('telegram');
      expect(result?.channelMessageId).toBe('123');
      expect(result?.projectId).toBe('test-project');
      expect(result?.senderIdentifier).toBe('987654321');
      expect(result?.senderName).toBe('John Doe');
      expect(result?.content).toBe('Hello from Telegram');
    });

    it('returns null for non-message updates', async () => {
      const adapter = createTelegramAdapter(defaultConfig);
      const payload = {
        callback_query: { id: '123' },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).toBeNull();
    });

    it('returns null for non-text messages', async () => {
      const adapter = createTelegramAdapter(defaultConfig);
      const payload = {
        message: {
          message_id: 123,
          date: 1704067200,
          photo: [{ file_id: 'abc' }],
          chat: { id: 987654321, type: 'private' },
        },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).toBeNull();
    });

    it('handles reply messages', async () => {
      const adapter = createTelegramAdapter(defaultConfig);
      const payload = {
        message: {
          message_id: 123,
          date: 1704067200,
          text: 'This is a reply',
          chat: { id: 987654321, type: 'private' },
          reply_to_message: { message_id: 100 },
        },
      };

      const result = await adapter.parseInbound(payload);

      expect(result?.replyToChannelMessageId).toBe('100');
    });
  });

  describe('isHealthy', () => {
    it('returns true when API responds ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      } as Response);

      const adapter = createTelegramAdapter(defaultConfig);
      const isHealthy = await adapter.isHealthy();

      expect(isHealthy).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest_bot_token/getMe',
      );
    });

    it('returns false when API responds not ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({ ok: false }),
      } as Response);

      const adapter = createTelegramAdapter(defaultConfig);
      const isHealthy = await adapter.isHealthy();

      expect(isHealthy).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const adapter = createTelegramAdapter(defaultConfig);
      const isHealthy = await adapter.isHealthy();

      expect(isHealthy).toBe(false);
    });
  });
});
