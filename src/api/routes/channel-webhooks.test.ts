/**
 * Tests for dynamic channel webhook routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { channelWebhookRoutes } from './channel-webhooks.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';
import type { ProjectId } from '@/core/types.js';

// ─── App Factory ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createApp() {
  const deps = createMockDeps();

  const app = Fastify();
  registerErrorHandler(app);
  channelWebhookRoutes(app, deps);
  return { app, deps };
}

// ─── Fixtures ──────────────────────────────────────────────────

const sampleIntegration = {
  id: 'int-tg-1',
  projectId: 'proj-1' as ProjectId,
  provider: 'telegram' as const,
  config: { botTokenSecretKey: 'tg-token' },
  status: 'active' as const,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────

describe('channelWebhookRoutes', () => {
  let app: FastifyInstance;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    ({ app, deps } = createApp());
  });

  describe('POST /webhooks/:provider/:integrationId', () => {
    it('rejects unknown provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/discord/int-1',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toContain('Unknown provider');
    });

    it('returns 404 when integration not found', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/telegram/nonexistent',
        payload: { message: { text: 'hi', chat: { id: 1 } } },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when provider does not match integration', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue({
        ...sampleIntegration,
        provider: 'whatsapp',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/telegram/int-tg-1',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toContain('Provider mismatch');
    });

    it('returns 200 with ignored=true when integration is paused', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue({
        ...sampleIntegration,
        status: 'paused',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/telegram/int-tg-1',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean; ignored: boolean; reason: string }>();
      expect(body.ignored).toBe(true);
      expect(body.reason).toBe('integration_paused');
    });

    it('returns 200 when adapter resolves and processes message', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue(sampleIntegration);
      const mockAdapter = {
        channelType: 'telegram',
        send: vi.fn(),
        parseInbound: vi.fn(() => Promise.resolve({
          id: 'tg-123',
          channel: 'telegram',
          channelMessageId: '123',
          projectId: 'proj-1',
          senderIdentifier: '999',
          content: 'Hello',
          rawPayload: {},
          receivedAt: new Date(),
        })),
        isHealthy: vi.fn(),
      };
      deps.channelResolver.resolveAdapter.mockResolvedValue(mockAdapter);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/telegram/int-tg-1',
        payload: { message: { message_id: 123, text: 'Hello', chat: { id: 999 }, date: 123 } },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean }>();
      expect(body.ok).toBe(true);
    });

    it('returns 200 even when adapter returns null message (non-message event)', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue(sampleIntegration);
      const mockAdapter = {
        channelType: 'telegram',
        send: vi.fn(),
        parseInbound: vi.fn(() => Promise.resolve(null)),
        isHealthy: vi.fn(),
      };
      deps.channelResolver.resolveAdapter.mockResolvedValue(mockAdapter);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/telegram/int-tg-1',
        payload: { callback_query: {} },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean }>();
      expect(body.ok).toBe(true);
    });

    it('handles Slack URL verification challenge', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/slack/int-slack-1',
        payload: {
          type: 'url_verification',
          challenge: 'test_challenge_123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ challenge: string }>();
      expect(body.challenge).toBe('test_challenge_123');
    });

    it('returns 200 with ignored=true when adapter unavailable', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue(sampleIntegration);
      deps.channelResolver.resolveAdapter.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/telegram/int-tg-1',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean; ignored: boolean; reason: string }>();
      expect(body.ignored).toBe(true);
      expect(body.reason).toBe('adapter_unavailable');
    });
  });

  describe('GET /webhooks/:provider/:integrationId/verify', () => {
    it('rejects non-whatsapp providers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/telegram/int-1/verify',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when missing verification params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp/int-wa-1/verify',
      });

      expect(response.statusCode).toBe(400);
    });

    it('verifies WhatsApp webhook when token matches', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue({
        ...sampleIntegration,
        provider: 'whatsapp',
        config: {
          accessTokenSecretKey: 'wa-token',
          phoneNumberId: 'phone-1',
          verifyTokenSecretKey: 'wa-verify-token',
        },
      });
      deps.secretService.get.mockResolvedValue('my-verify-token');

      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp/int-wa-1/verify?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=challenge_abc',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('challenge_abc');
    });

    it('returns 403 when verify token does not match', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue({
        ...sampleIntegration,
        provider: 'whatsapp',
        config: {
          accessTokenSecretKey: 'wa-token',
          phoneNumberId: 'phone-1',
          verifyTokenSecretKey: 'wa-verify-token',
        },
      });
      deps.secretService.get.mockResolvedValue('my-verify-token');

      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp/int-wa-1/verify?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=abc',
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 404 when integration not found', async () => {
      deps.channelResolver.resolveIntegration.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp/int-wa-1/verify?hub.mode=subscribe&hub.verify_token=t&hub.challenge=c',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
