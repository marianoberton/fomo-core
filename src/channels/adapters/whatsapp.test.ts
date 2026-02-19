/**
 * WhatsApp Adapter Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWhatsAppAdapter } from './whatsapp.js';
import type { OutboundMessage } from '../types.js';
import type { ProjectId } from '@/core/types.js';

describe('WhatsAppAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultConfig = {
    accessToken: 'test-token-123',
    phoneNumberId: 'test-phone-id',
    projectId: 'test-project' as ProjectId,
  };

  describe('parseInbound', () => {
    it('parses text message', async () => {
      const adapter = createWhatsAppAdapter(defaultConfig);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'test-phone-id',
                  },
                  contacts: [
                    {
                      profile: { name: 'John Doe' },
                      wa_id: '5491132766709',
                    },
                  ],
                  messages: [
                    {
                      from: '5491132766709',
                      id: 'msg_123',
                      timestamp: '1633036800',
                      type: 'text',
                      text: {
                        body: 'Hello, agent!',
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.channel).toBe('whatsapp');
      expect(result?.projectId).toBe('test-project');
      expect(result?.senderIdentifier).toBe('5491132766709');
      expect(result?.senderName).toBe('John Doe');
      expect(result?.content).toBe('Hello, agent!');
      expect(result?.channelMessageId).toBe('msg_123');
    });

    it('parses image message', async () => {
      const adapter = createWhatsAppAdapter(defaultConfig);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'test-phone-id',
                  },
                  contacts: [
                    {
                      profile: { name: 'Jane Doe' },
                      wa_id: '5491132766710',
                    },
                  ],
                  messages: [
                    {
                      from: '5491132766710',
                      id: 'msg_456',
                      timestamp: '1633036900',
                      type: 'image',
                      image: {
                        id: 'media_abc123',
                        mime_type: 'image/jpeg',
                        caption: 'Check this out!',
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.channel).toBe('whatsapp');
      expect(result?.senderIdentifier).toBe('5491132766710');
      expect(result?.content).toBe('Check this out!');
      expect(result?.mediaUrls).toEqual(['media_abc123']);
    });

    it('parses image message without caption', async () => {
      const adapter = createWhatsAppAdapter(defaultConfig);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'test-phone-id',
                  },
                  contacts: [
                    {
                      profile: { name: 'Jane Doe' },
                      wa_id: '5491132766710',
                    },
                  ],
                  messages: [
                    {
                      from: '5491132766710',
                      id: 'msg_789',
                      timestamp: '1633037000',
                      type: 'image',
                      image: {
                        id: 'media_xyz789',
                        mime_type: 'image/png',
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.content).toBe('[Image received]');
      expect(result?.mediaUrls).toEqual(['media_xyz789']);
    });

    it('returns null for non-whatsapp payload', async () => {
      const adapter = createWhatsAppAdapter(defaultConfig);

      const payload = { object: 'telegram' };
      const result = await adapter.parseInbound(payload);

      expect(result).toBeNull();
    });

    it('returns null for empty messages', async () => {
      const adapter = createWhatsAppAdapter(defaultConfig);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'test-phone-id',
                  },
                  messages: [],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('returns null for unsupported message types', async () => {
      const adapter = createWhatsAppAdapter(defaultConfig);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'test-phone-id',
                  },
                  messages: [
                    {
                      from: '5491132766709',
                      id: 'msg_audio',
                      timestamp: '1633036800',
                      type: 'audio',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('includes reply context when present', async () => {
      const adapter = createWhatsAppAdapter(defaultConfig);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'test-phone-id',
                  },
                  contacts: [
                    {
                      profile: { name: 'John Doe' },
                      wa_id: '5491132766709',
                    },
                  ],
                  messages: [
                    {
                      from: '5491132766709',
                      id: 'msg_reply',
                      timestamp: '1633036800',
                      type: 'text',
                      text: {
                        body: 'This is a reply',
                      },
                      context: {
                        from: '5491132766709',
                        id: 'msg_original',
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.replyToChannelMessageId).toBe('msg_original');
    });
  });

  describe('send', () => {
    it('sends text message successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          messaging_product: 'whatsapp',
          messages: [{ id: 'sent_msg_123' }],
        }),
      } as Response);

      const adapter = createWhatsAppAdapter(defaultConfig);

      const message: OutboundMessage = {
        channel: 'whatsapp',
        recipientIdentifier: '5491132766709',
        content: 'Hello from agent!',
      };

      const result = await adapter.send(message);

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('sent_msg_123');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const expectedHeaders = expect.objectContaining({
        'Authorization': 'Bearer test-token-123',
      });
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/test-phone-id/messages'),
        expect.objectContaining({
          method: 'POST',
          headers: expectedHeaders,
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('handles API errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          error: {
            message: 'Invalid phone number',
            type: 'OAuthException',
            code: 100,
          },
        }),
      } as Response);

      const adapter = createWhatsAppAdapter(defaultConfig);

      const message: OutboundMessage = {
        channel: 'whatsapp',
        recipientIdentifier: 'invalid',
        content: 'Test',
      };

      const result = await adapter.send(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid phone number');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network timeout'));

      const adapter = createWhatsAppAdapter(defaultConfig);

      const message: OutboundMessage = {
        channel: 'whatsapp',
        recipientIdentifier: '5491132766709',
        content: 'Test',
      };

      const result = await adapter.send(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
    });
  });

  describe('isHealthy', () => {
    it('returns true when API is accessible', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const adapter = createWhatsAppAdapter(defaultConfig);

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });

    it('returns false when API is not accessible', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection failed'));

      const adapter = createWhatsAppAdapter(defaultConfig);

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(false);
    });
  });
});
