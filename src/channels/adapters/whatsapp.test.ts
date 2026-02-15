/**
 * WhatsApp Adapter Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWhatsAppAdapter } from './whatsapp.js';
import type { OutboundMessage } from '../types.js';

describe('WhatsAppAdapter', () => {
  const mockEnv = {
    WHATSAPP_ACCESS_TOKEN: 'test-token-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['WHATSAPP_ACCESS_TOKEN'] = mockEnv.WHATSAPP_ACCESS_TOKEN;
  });

  describe('parseInbound', () => {
    it('parses text message', async () => {
      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      expect(result?.senderIdentifier).toBe('5491132766709');
      expect(result?.senderName).toBe('John Doe');
      expect(result?.content).toBe('Hello, agent!');
      expect(result?.channelMessageId).toBe('msg_123');
    });

    it('parses image message', async () => {
      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

      const payload = { object: 'telegram' };
      const result = await adapter.parseInbound(payload);

      expect(result).toBeNull();
    });

    it('returns null for empty messages', async () => {
      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          messaging_product: 'whatsapp',
          messages: [{ id: 'sent_msg_123' }],
        }),
      });
      global.fetch = mockFetch;

      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

      const message: OutboundMessage = {
        channel: 'whatsapp',
        recipientIdentifier: '5491132766709',
        content: 'Hello from agent!',
      };

      const result = await adapter.send(message);

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('sent_msg_123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test-phone-id/messages'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token-123',
          }),
        }),
      );
    });

    it('handles API errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          error: {
            message: 'Invalid phone number',
            type: 'OAuthException',
            code: 100,
          },
        }),
      });
      global.fetch = mockFetch;

      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
      global.fetch = mockFetch;

      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

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
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('returns false when API is not accessible', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection failed'));
      global.fetch = mockFetch;

      const adapter = createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: 'test-phone-id',
      });

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(false);
    });
  });
});
