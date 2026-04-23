/**
 * Agent performance route tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { performanceRoutes } from './performance.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface MockPrismaPerf {
  agent: { findUnique: ReturnType<typeof vi.fn> };
  session: { findMany: ReturnType<typeof vi.fn> };
  usageRecord: { findMany: ReturnType<typeof vi.fn> };
  executionTrace: { findMany: ReturnType<typeof vi.fn> };
}

function createApp(): { app: FastifyInstance; prisma: MockPrismaPerf } {
  const prisma: MockPrismaPerf = {
    agent: { findUnique: vi.fn() },
    session: { findMany: vi.fn() },
    usageRecord: { findMany: vi.fn() },
    executionTrace: { findMany: vi.fn() },
  };
  const deps = { ...createMockDeps(), prisma: prisma as unknown as ReturnType<typeof createMockDeps>['prisma'] };
  const app = Fastify();
  registerErrorHandler(app);
  performanceRoutes(app, deps);
  return { app, prisma };
}

describe('performanceRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when agent not found', async () => {
    const { app, prisma } = createApp();
    prisma.agent.findUnique.mockResolvedValue(null);
    const response = await app.inject({
      method: 'GET',
      url: '/agents/missing/performance',
    });
    expect(response.statusCode).toBe(404);
  });

  it('aggregates KPIs for an agent with sessions and usage', async () => {
    const { app, prisma } = createApp();
    prisma.agent.findUnique.mockResolvedValue({ id: 'a1', projectId: 'p1', name: 'Agent One' });
    prisma.session.findMany.mockResolvedValue([
      { id: 's1', status: 'completed', createdAt: new Date('2026-04-20'), metadata: { channel: 'whatsapp' } },
      { id: 's2', status: 'active', createdAt: new Date('2026-04-21'), metadata: { channel: 'telegram' } },
      { id: 's3', status: 'completed', createdAt: new Date('2026-04-21'), metadata: { channel: 'whatsapp' } },
    ]);
    prisma.usageRecord.findMany.mockResolvedValue([
      { costUsd: 0.01, timestamp: new Date('2026-04-20'), sessionId: 's1' },
      { costUsd: 0.02, timestamp: new Date('2026-04-21'), sessionId: 's2' },
    ]);
    prisma.executionTrace.findMany.mockResolvedValue([
      {
        totalDurationMs: 1000,
        turnCount: 2,
        status: 'completed',
        events: [
          { type: 'tool_call', toolId: 'calculator' },
          { type: 'tool_call', toolId: 'calculator' },
          { type: 'tool_call', toolId: 'web-search' },
        ],
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/agents/a1/performance?range=30d',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        agentId: string;
        totals: { sessions: number; costUsd: number };
        avgResponseMs: number;
        resolutionRate: number;
        sessionsPerDay: { day: string; count: number }[];
        costPerSession: number;
        topTools: { toolId: string; count: number }[];
        byChannel: { channel: string; count: number }[];
      };
    }>();
    expect(body.data.agentId).toBe('a1');
    expect(body.data.totals.sessions).toBe(3);
    expect(body.data.totals.costUsd).toBeCloseTo(0.03);
    expect(body.data.avgResponseMs).toBe(500);
    expect(body.data.resolutionRate).toBeCloseTo(2 / 3);
    expect(body.data.sessionsPerDay).toHaveLength(2);
    expect(body.data.topTools[0]?.toolId).toBe('calculator');
    expect(body.data.topTools[0]?.count).toBe(2);
    expect(body.data.byChannel.find((c) => c.channel === 'whatsapp')?.count).toBe(2);
  });
});
