/**
 * Unit tests for metrics routes — prisma `$queryRaw` mocked per call.
 * Covers happy path for each of the 3 endpoints + bad query rejection +
 * 60s in-memory cache hit on a second identical request.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { metricsRoutes } from './metrics.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface SuccessBody<T> {
  success: boolean;
  data: T;
}

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

function createApp(): {
  app: FastifyInstance;
  deps: ReturnType<typeof createMockDeps>;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const deps = createMockDeps();
  // Override prisma.$queryRaw — metrics routes call it directly.
  const queryRaw = vi.fn();
  (deps.prisma as unknown as { $queryRaw: typeof queryRaw }).$queryRaw = queryRaw;

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.apiKeyProjectId = null; // master key bypasses guard
  });
  registerErrorHandler(app);
  metricsRoutes(app, deps);
  return { app, deps, queryRaw };
}

describe('metricsRoutes', () => {
  describe('GET /projects/:projectId/metrics/conversations', () => {
    it('returns daily session points with unique contacts', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([
        { date: '2026-04-01', count: 5n, unique_contacts: 3n },
        { date: '2026-04-02', count: 7n, unique_contacts: 6n },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-conv/metrics/conversations',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<
        SuccessBody<{ points: { date: string; count: number; uniqueContacts: number }[] }>
      >();
      expect(body.success).toBe(true);
      expect(body.data.points).toEqual([
        { date: '2026-04-01', count: 5, uniqueContacts: 3 },
        { date: '2026-04-02', count: 7, uniqueContacts: 6 },
      ]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('serves a second identical request from the in-memory cache', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([{ date: '2026-04-01', count: 1n, unique_contacts: 1n }]);

      const url =
        '/projects/proj-cache/metrics/conversations?from=2026-04-01T00:00:00Z&to=2026-04-02T00:00:00Z';
      const a = await app.inject({ method: 'GET', url });
      const b = await app.inject({ method: 'GET', url });

      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed `from` ISO datetime', async () => {
      const { app } = createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-bad/metrics/conversations?from=not-a-date',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<ErrorBody>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_QUERY');
    });
  });

  describe('GET /projects/:projectId/metrics/channels', () => {
    it('computes per-channel percentages from session counts', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([
        { channel: 'whatsapp', count: 60n },
        { channel: 'telegram', count: 30n },
        { channel: 'unknown', count: 10n },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-chan/metrics/channels',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<
        SuccessBody<{ distribution: { channel: string; count: number; percentage: number }[] }>
      >();
      expect(body.data.distribution).toEqual([
        { channel: 'whatsapp', count: 60, percentage: 60 },
        { channel: 'telegram', count: 30, percentage: 30 },
        { channel: 'unknown', count: 10, percentage: 10 },
      ]);
    });

    it('returns empty distribution and 0% when no sessions exist', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-empty/metrics/channels',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<SuccessBody<{ distribution: unknown[] }>>();
      expect(body.data.distribution).toEqual([]);
    });
  });

  describe('GET /projects/:projectId/metrics/usage', () => {
    it('groups by day by default', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([
        { date: '2026-04-01', total_tokens: 1000n, total_cost_usd: 0.012 },
        { date: '2026-04-02', total_tokens: 2500n, total_cost_usd: 0.031 },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-usage/metrics/usage',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<
        SuccessBody<{
          points: { date?: string; totalTokens: number; totalCostUsd: number }[];
        }>
      >();
      expect(body.data.points).toEqual([
        { date: '2026-04-01', totalTokens: 1000, totalCostUsd: 0.012 },
        { date: '2026-04-02', totalTokens: 2500, totalCostUsd: 0.031 },
      ]);
    });

    it('groups by agent when groupBy=agent', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([
        {
          agent_id: 'agent-1',
          agent_name: 'Sales Bot',
          total_tokens: 5000n,
          total_cost_usd: 0.08,
        },
        {
          agent_id: null,
          agent_name: null,
          total_tokens: 200n,
          total_cost_usd: 0.001,
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-usage/metrics/usage?groupBy=agent',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<
        SuccessBody<{
          points: {
            agentId?: string;
            agentName?: string;
            totalTokens: number;
            totalCostUsd: number;
          }[];
        }>
      >();
      expect(body.data.points).toEqual([
        {
          agentId: 'agent-1',
          agentName: 'Sales Bot',
          totalTokens: 5000,
          totalCostUsd: 0.08,
        },
        {
          agentId: 'unassigned',
          agentName: 'Unassigned',
          totalTokens: 200,
          totalCostUsd: 0.001,
        },
      ]);
    });

    it('rejects invalid groupBy values', async () => {
      const { app } = createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-x/metrics/usage?groupBy=hour',
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<ErrorBody>();
      expect(body.error.code).toBe('INVALID_QUERY');
    });
  });

  describe('GET /projects/:projectId/metrics/overview', () => {
    it('returns KPI snapshot from 4 parallel aggregation queries', async () => {
      const { app, queryRaw } = createApp();
      // Order matches Promise.all in the route:
      //   conversationsToday, activeClients, messagesProcessed, avgResponseTimeMs
      queryRaw
        .mockResolvedValueOnce([{ count: 12n }])
        .mockResolvedValueOnce([{ count: 7n }])
        .mockResolvedValueOnce([{ count: 348n }])
        .mockResolvedValueOnce([{ avg_ms: 1450.6 }]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-overview/metrics/overview',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<
        SuccessBody<{
          conversationsToday: number;
          activeClients: number;
          messagesProcessed: number;
          avgResponseTimeMs: number | null;
        }>
      >();
      expect(body.data).toEqual({
        conversationsToday: 12,
        activeClients: 7,
        messagesProcessed: 348,
        avgResponseTimeMs: 1451, // rounded
      });
      expect(queryRaw).toHaveBeenCalledTimes(4);
    });

    it('returns null avgResponseTimeMs when no user→assistant pairs exist', async () => {
      const { app, queryRaw } = createApp();
      queryRaw
        .mockResolvedValueOnce([{ count: 0n }])
        .mockResolvedValueOnce([{ count: 0n }])
        .mockResolvedValueOnce([{ count: 0n }])
        .mockResolvedValueOnce([{ avg_ms: null }]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-empty/metrics/overview',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<SuccessBody<{ avgResponseTimeMs: number | null }>>();
      expect(body.data.avgResponseTimeMs).toBeNull();
    });
  });

  describe('GET /projects/:projectId/metrics/top-clients', () => {
    it('returns top contacts ordered by conversation count', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([
        { contact_id: 'c-1', contact_name: 'Cartones del Sur', conversations: 87n, messages: 542n },
        { contact_id: 'c-2', contact_name: 'TechFlow', conversations: 63n, messages: 418n },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-top/metrics/top-clients',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<
        SuccessBody<{
          clients: { clientId: string; clientName: string; conversations: number; messages: number }[];
        }>
      >();
      expect(body.data.clients).toEqual([
        { clientId: 'c-1', clientName: 'Cartones del Sur', conversations: 87, messages: 542 },
        { clientId: 'c-2', clientName: 'TechFlow', conversations: 63, messages: 418 },
      ]);
    });

    it('uses "Unknown" when contact has no name (orphaned join)', async () => {
      const { app, queryRaw } = createApp();
      queryRaw.mockResolvedValueOnce([
        { contact_id: 'c-orphan', contact_name: null, conversations: 5n, messages: 12n },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-x/metrics/top-clients?limit=5',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<SuccessBody<{ clients: { clientName: string }[] }>>();
      expect(body.data.clients[0]?.clientName).toBe('Unknown');
    });

    it('rejects negative limit', async () => {
      const { app } = createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/projects/proj-x/metrics/top-clients?limit=-3',
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<ErrorBody>();
      expect(body.error.code).toBe('INVALID_QUERY');
    });
  });
});
