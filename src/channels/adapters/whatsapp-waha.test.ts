/**
 * WhatsApp WAHA Adapter Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWhatsAppWahaAdapter } from './whatsapp-waha.js';
import type { OutboundMessage } from '../types.js';
import type { ProjectId } from '@/core/types.js';

describe('WhatsAppWahaAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultConfig = {
    wahaBaseUrl: 'http://localhost:3003',
    sessionName: 'default',
    projectId: 'test-project' as ProjectId,
  };

  describe('parseInbound', () => {
    it('parses text message from WAHA webhook', async () => {
      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const payload = {
        event: 'message',
        session: 'default',
        engine: 'NOWEB',
        payload: {
          id: 'true_5491132766709@c.us_AAA',
          timestamp: 1633036800,
          from: '5491132766709@c.us',
          fromMe: false,
          to: '5491155559999@c.us',
          body: 'Hola!',
          hasMedia: false,
          _data: {
            notifyName: 'Juan Perez',
          },
        },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.channel).toBe('whatsapp-waha');
      expect(result?.projectId).toBe('test-project');
      expect(result?.senderIdentifier).toBe('5491132766709');
      expect(result?.senderName).toBe('Juan Perez');
      expect(result?.content).toBe('Hola!');
      expect(result?.channelMessageId).toBe('true_5491132766709@c.us_AAA');
    });

    it('ignores messages sent by the bot (fromMe)', async () => {
      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const payload = {
        event: 'message',
        session: 'default',
        payload: {
          id: 'msg_123',
          from: '5491132766709@c.us',
          fromMe: true,
          body: 'Bot reply',
        },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('ignores non-message events', async () => {
      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const payload = {
        event: 'session.status',
        session: 'default',
        payload: { status: 'WORKING' },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('ignores empty body messages', async () => {
      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const payload = {
        event: 'message',
        session: 'default',
        payload: {
          id: 'msg_123',
          from: '5491132766709@c.us',
          fromMe: false,
          body: '',
        },
      };

      const result = await adapter.parseInbound(payload);
      expect(result).toBeNull();
    });

    it('includes media URL when present', async () => {
      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const payload = {
        event: 'message',
        session: 'default',
        payload: {
          id: 'msg_media',
          timestamp: 1633036800,
          from: '5491132766709@c.us',
          fromMe: false,
          body: 'Check this image',
          hasMedia: true,
          mediaUrl: 'http://localhost:3003/api/files/media_abc',
        },
      };

      const result = await adapter.parseInbound(payload);

      expect(result).not.toBeNull();
      expect(result?.mediaUrls).toEqual(['http://localhost:3003/api/files/media_abc']);
    });

    it('strips @c.us and @s.whatsapp.net from sender', async () => {
      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const payload1 = {
        event: 'message',
        session: 'default',
        payload: {
          id: 'msg_1',
          from: '5491132766709@s.whatsapp.net',
          fromMe: false,
          body: 'Hello',
        },
      };

      const result = await adapter.parseInbound(payload1);
      expect(result?.senderIdentifier).toBe('5491132766709');
    });
  });

  describe('send', () => {
    it('sends text message successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sent_msg_123' }),
      } as Response);

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const message: OutboundMessage = {
        channel: 'whatsapp-waha',
        recipientIdentifier: '5491132766709',
        content: 'Hello from agent!',
      };

      const result = await adapter.send(message);

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('sent_msg_123');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3003/api/sendText',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: '5491132766709@c.us',
            text: 'Hello from agent!',
            session: 'default',
          }),
        }),
      );
    });

    it('formats phone number correctly (strips non-digits)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sent_msg_456' }),
      } as Response);

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const message: OutboundMessage = {
        channel: 'whatsapp-waha',
        recipientIdentifier: '+54-911-3276-6709',
        content: 'Test',
      };

      await adapter.send(message);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3003/api/sendText',
        expect.objectContaining({
          body: JSON.stringify({
            chatId: '5491132766709@c.us',
            text: 'Test',
            session: 'default',
          }),
        }),
      );
    });

    it('handles WAHA API errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Session not connected' }),
      } as unknown as Response);

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const message: OutboundMessage = {
        channel: 'whatsapp-waha',
        recipientIdentifier: '5491132766709',
        content: 'Test',
      };

      const result = await adapter.send(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not connected');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const message: OutboundMessage = {
        channel: 'whatsapp-waha',
        recipientIdentifier: '5491132766709',
        content: 'Test',
      };

      const result = await adapter.send(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });
  });

  describe('isHealthy', () => {
    it('returns true when session is WORKING', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'WORKING' }),
      } as Response);

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3003/api/sessions/default',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
    });

    it('returns true when session is waiting for QR scan', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'SCAN_QR_CODE' }),
      } as Response);

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(true);
    });

    it('returns false when session is stopped', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'STOPPED' }),
      } as Response);

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(false);
    });

    it('returns false when WAHA is not reachable', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(false);
    });

    it('returns false when API returns error status', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const adapter = createWhatsAppWahaAdapter(defaultConfig);

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('channelType', () => {
    it('reports whatsapp-waha as channel type', () => {
      const adapter = createWhatsAppWahaAdapter(defaultConfig);
      expect(adapter.channelType).toBe('whatsapp-waha');
    });
  });
});
