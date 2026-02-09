import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { traceRoutes } from './traces.js';
import { createMockDeps, createSampleTrace } from '@/testing/fixtures/routes.js';
import type { SessionId, TraceId } from '@/core/types.js';

function createApp(): { app: FastifyInstance; deps: ReturnType<typeof createMockDeps> } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  traceRoutes(app, deps);
  return { app, deps };
}

describe('traceRoutes', () => {
  describe('GET /sessions/:sessionId/traces', () => {
    it('returns traces for a session', async () => {
      const { app, deps } = createApp();
      const trace = createSampleTrace();

      deps.executionTraceRepository.listBySession.mockResolvedValue([trace]);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/sess-1/traces',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: unknown[] }>();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);

       
      expect(deps.executionTraceRepository.listBySession).toHaveBeenCalledWith(
        'sess-1' as SessionId,
      );
    });
  });

  describe('GET /traces/:id', () => {
    it('returns a trace by id', async () => {
      const { app, deps } = createApp();
      const trace = createSampleTrace();

      deps.executionTraceRepository.findById.mockResolvedValue(trace);

      const response = await app.inject({
        method: 'GET',
        url: '/traces/trace-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { id: string } }>();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('trace-1');

       
      expect(deps.executionTraceRepository.findById).toHaveBeenCalledWith(
        'trace-1' as TraceId,
      );
    });

    it('returns 404 when trace is not found', async () => {
      const { app, deps } = createApp();

      deps.executionTraceRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/traces/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ success: boolean; error: { code: string; message: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('nonexistent');
    });
  });
});
