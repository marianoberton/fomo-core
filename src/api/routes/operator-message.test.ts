/**
 * Tests for operator message routes — human operator sends message to customer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { operatorMessageRoutes } from './operator-message.js';
import { registerErrorHandler } from '../error-handler.js';
import {
  createMockDeps,
  createSampleSession,
  createSampleMessage,
} from '@/testing/fixtures/routes.js';
import type { ApiResponse } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

type MockDeps = ReturnType<typeof createMockDeps>;

function createApp(): { app: FastifyInstance; deps: MockDeps } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  operatorMessageRoutes(app, deps);
  return { app, deps };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('operator message routes', () => {
  let app: FastifyInstance;
  let deps: MockDeps;

  beforeEach(() => {
    const created = createApp();
    app = created.app;
    deps = created.deps;
  });

  describe('POST /projects/:projectId/sessions/:sessionId/operator-message', () => {
    const url = '/projects/proj-1/sessions/sess-1/operator-message';

    it('sends operator message on a paused session', async () => {
      const session = createSampleSession({
        status: 'paused',
        metadata: { channel: 'whatsapp', recipientIdentifier: '+5491155001234' },
      });
      deps.sessionRepository.findById.mockResolvedValue(session);

      const stored = createSampleMessage({ id: 'msg-op-1' });
      deps.sessionRepository.addMessage.mockResolvedValue(stored);
      deps.channelResolver.send.mockResolvedValue({ success: true, channelMessageId: 'ch-123' });

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: 'Hello from the operator' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<{ messageId: string; delivered: boolean }>;
      expect(body.success).toBe(true);
      expect(body.data?.messageId).toBe('msg-op-1');
      expect(body.data?.delivered).toBe(true);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.sessionRepository.addMessage).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({ role: 'assistant', content: 'Hello from the operator' }),
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.channelResolver.send).toHaveBeenCalledWith(
        'proj-1',
        'whatsapp',
        expect.objectContaining({
          channel: 'whatsapp',
          recipientIdentifier: '+5491155001234',
          content: 'Hello from the operator',
        }),
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.sessionBroadcaster.broadcast).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({ type: 'message.new', fromOperator: true }),
      );
    });

    it('rejects when session is not paused', async () => {
      const session = createSampleSession({ status: 'active' });
      deps.sessionRepository.findById.mockResolvedValue(session);

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: 'Hello' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as ApiResponse<never>;
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('SESSION_NOT_PAUSED');
    });

    it('rejects when session not found', async () => {
      deps.sessionRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: 'Hello' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects when session belongs to different project', async () => {
      const session = createSampleSession({ projectId: 'proj-other' as never, status: 'paused' });
      deps.sessionRepository.findById.mockResolvedValue(session);

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: 'Hello' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('rejects empty content', async () => {
      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('stores message even when channel delivery fails', async () => {
      const session = createSampleSession({
        status: 'paused',
        metadata: { channel: 'whatsapp', recipientIdentifier: '+5491155001234' },
      });
      deps.sessionRepository.findById.mockResolvedValue(session);

      const stored = createSampleMessage({ id: 'msg-op-2' });
      deps.sessionRepository.addMessage.mockResolvedValue(stored);
      deps.channelResolver.send.mockResolvedValue({ success: false, error: 'Connection failed' });

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: 'Test message' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<{ messageId: string; delivered: boolean }>;
      expect(body.data?.delivered).toBe(false);
    });

    it('handles session without channel metadata (test/dashboard session)', async () => {
      const session = createSampleSession({
        status: 'paused',
        metadata: {},
      });
      deps.sessionRepository.findById.mockResolvedValue(session);

      const stored = createSampleMessage({ id: 'msg-op-3' });
      deps.sessionRepository.addMessage.mockResolvedValue(stored);

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: 'Dashboard-only message' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<{ messageId: string; delivered: boolean; channel: string | null }>;
      expect(body.data?.delivered).toBe(false);
      expect(body.data?.channel).toBeNull();

      // Channel resolver should NOT be called
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.channelResolver.send).not.toHaveBeenCalled();
    });

    it('uses custom operatorName when provided', async () => {
      const session = createSampleSession({
        status: 'paused',
        metadata: { channel: 'telegram', recipientIdentifier: '12345' },
      });
      deps.sessionRepository.findById.mockResolvedValue(session);

      const stored = createSampleMessage({ id: 'msg-op-4' });
      deps.sessionRepository.addMessage.mockResolvedValue(stored);
      deps.channelResolver.send.mockResolvedValue({ success: true });

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { content: 'Hello', operatorName: 'Maria' },
      });

      expect(response.statusCode).toBe(200);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.sessionBroadcaster.broadcast).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({ operatorName: 'Maria' }),
      );
    });
  });
});
