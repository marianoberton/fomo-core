import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSlackAdapter, getSlackUrlChallenge } from './slack.js';
import type { ProjectId } from '@/core/types.js';

describe('SlackAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultConfig = {
    botToken: 'xoxb-test-token',
    projectId: 'test-project' as ProjectId,
  };

  describe('channelType', () => {
    it('returns slack', () => {
      const adapter = createSlackAdapter(defaultConfig);
      expect(adapter.channelType).toBe('slack');
    });
  });

  describe('send', () => {
    it('sends a message successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          channel: 'C12345',
          ts: '1234567890.123456',
          message: { text: 'Hello!', ts: '1234567890.123456' },
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: 'Hello!',
      });

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('1234567890.123456');

      expect(fetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': 'Bearer xoxb-test-token',
          },
        }),
      );
    });

    it('sends message body with correct channel and text', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          ts: '1234567890.123456',
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C99999',
        content: 'Test message',
      });

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string) as Record<string, unknown>;
      expect(body['channel']).toBe('C99999');
      expect(body['text']).toBe('Test message');
    });

    it('handles thread replies with thread_ts', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          ts: '1234567890.999999',
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: 'Thread reply',
        replyToChannelMessageId: '1234567890.000001',
      });

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string) as Record<string, unknown>;
      expect(body['thread_ts']).toBe('1234567890.000001');
    });

    it('sends with mrkdwn when markdown parse mode is set', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          ts: '1234567890.123456',
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: '*bold text*',
        options: { parseMode: 'markdown' },
      });

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string) as Record<string, unknown>;
      expect(body['mrkdwn']).toBe(true);
    });

    it('does not set mrkdwn when no parse mode specified', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          ts: '1234567890.123456',
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: 'Plain text',
      });

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string) as Record<string, unknown>;
      expect(body['mrkdwn']).toBeUndefined();
    });

    it('handles Slack API errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: false,
          error: 'channel_not_found',
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C_INVALID',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('channel_not_found');
    });

    it('handles unknown Slack API error (no error field)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: false,
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown Slack error');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const adapter = createSlackAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('handles non-Error thrown objects', async () => {
      vi.mocked(fetch).mockRejectedValue('string error');

      const adapter = createSlackAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('returns false when ok is true but ts is missing', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          // no ts field
        }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      const result = await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C12345',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown Slack error');
    });
  });

  describe('parseInbound', () => {
    it('parses a text message event', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'C12345',
          user: 'U67890',
          text: 'Hello from Slack',
          ts: '1234567890.123456',
          event_ts: '1234567890.123456',
        },
        team_id: 'T11111',
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('slack-1234567890.123456');
      expect(result?.channel).toBe('slack');
      expect(result?.channelMessageId).toBe('1234567890.123456');
      expect(result?.projectId).toBe('test-project');
      expect(result?.senderIdentifier).toBe('C12345');
      expect(result?.senderName).toBe('U67890');
      expect(result?.content).toBe('Hello from Slack');
    });

    it('includes thread_ts as replyToChannelMessageId', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'C12345',
          user: 'U67890',
          text: 'Thread reply',
          ts: '1234567890.999999',
          thread_ts: '1234567890.000001',
          event_ts: '1234567890.999999',
        },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.replyToChannelMessageId).toBe('1234567890.000001');
    });

    it('converts event_ts to receivedAt Date', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'C12345',
          user: 'U67890',
          text: 'Hello',
          ts: '1704067200.000000',
          event_ts: '1704067200.000000',
        },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.receivedAt).toBeInstanceOf(Date);
      // 1704067200 = 2024-01-01T00:00:00.000Z
      expect(result?.receivedAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('returns null for url_verification events', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'url_verification',
        challenge: 'test_challenge_token',
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('returns null for non-message events', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'event_callback',
        event: {
          type: 'reaction_added',
          channel: 'C12345',
          user: 'U67890',
          ts: '1234567890.123456',
          event_ts: '1234567890.123456',
        },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('returns null for bot messages (no user field)', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'C12345',
          // no user field (bot message)
          text: 'Bot message',
          ts: '1234567890.123456',
          event_ts: '1234567890.123456',
          bot_id: 'B12345',
        },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('returns null when no event object', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'event_callback',
        // no event object
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('preserves raw payload', async () => {
      const adapter = createSlackAdapter(defaultConfig);
      const payload = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'C12345',
          user: 'U67890',
          text: 'Hello',
          ts: '1234567890.123456',
          event_ts: '1234567890.123456',
        },
        team_id: 'T11111',
        api_app_id: 'A22222',
      };

      const result = await adapter.parseInbound(payload);

      expect(result?.rawPayload).toBe(payload);
    });
  });

  describe('isHealthy', () => {
    it('returns true when auth.test responds ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      const isHealthy = await adapter.isHealthy();

      expect(isHealthy).toBe(true);

      expect(fetch).toHaveBeenCalledWith(
        'https://slack.com/api/auth.test',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer xoxb-test-token',
          },
        }),
      );
    });

    it('returns false when auth.test responds not ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({ ok: false }),
      } as Response);

      const adapter = createSlackAdapter(defaultConfig);
      const isHealthy = await adapter.isHealthy();

      expect(isHealthy).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const adapter = createSlackAdapter(defaultConfig);
      const isHealthy = await adapter.isHealthy();

      expect(isHealthy).toBe(false);
    });
  });

  describe('getSlackUrlChallenge', () => {
    it('returns challenge string for url_verification events', () => {
      const payload = {
        type: 'url_verification',
        challenge: 'test_challenge_abc123',
      };

      const result = getSlackUrlChallenge(payload);
      expect(result).toBe('test_challenge_abc123');
    });

    it('returns null for non-verification events', () => {
      const payload = {
        type: 'event_callback',
        event: { type: 'message' },
      };

      const result = getSlackUrlChallenge(payload);
      expect(result).toBeNull();
    });

    it('returns null when type is url_verification but no challenge', () => {
      const payload = {
        type: 'url_verification',
      };

      const result = getSlackUrlChallenge(payload);
      expect(result).toBeNull();
    });

    it('returns null for empty payload', () => {
      const result = getSlackUrlChallenge({});
      expect(result).toBeNull();
    });
  });
});
