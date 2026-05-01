/**
 * Metrics integration tests — verify SQL aggregation against a real Postgres.
 * Seeds sessions + usage_records and asserts the returned shape.
 *
 * Requires Docker: `pnpm test:integration` brings up Postgres + Redis on 5433/6380.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { Prisma } from '@prisma/client';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import type { ProjectId } from '@/core/types.js';

const API_KEY = 'metrics-integration-test-key';
const AUTH = { authorization: `Bearer ${API_KEY}` } as const;

interface SuccessBody<T> {
  success: boolean;
  data: T;
}

describe('metrics integration', () => {
  let testDb: TestDatabase;
  let server: FastifyInstance;
  let projectId: ProjectId;
  let agentId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server = await createTestServer({ prisma: testDb.prisma, apiKey: API_KEY });
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;

    // Seed an agent for the by-agent usage grouping
    const agent = await testDb.prisma.agent.create({
      data: {
        projectId,
        name: 'Sales Bot',
        promptConfig: { identity: 'x', instructions: 'y', safety: 'z' } as unknown as Prisma.InputJsonValue,
        toolAllowlist: [],
        type: 'conversational',
        status: 'active',
      },
    });
    agentId = agent.id;
  });

  afterAll(async () => {
    await server.close();
    await testDb.disconnect();
  });

  // Helper — insert a session at a specific date with a channel + contact
  async function seedSession(opts: {
    daysAgo: number;
    channel: string | null;
    contactId?: string;
  }): Promise<string> {
    const id = nanoid();
    const ts = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000);
    await testDb.prisma.session.create({
      data: {
        id,
        projectId,
        contactId: opts.contactId ?? null,
        status: 'active',
        metadata: (opts.channel ? { channel: opts.channel } : {}) as unknown as Prisma.InputJsonValue,
        createdAt: ts,
        updatedAt: ts,
      },
    });
    return id;
  }

  async function seedUsage(opts: {
    daysAgo: number;
    sessionId: string;
    agentId: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<void> {
    const ts = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000);
    await testDb.prisma.usageRecord.create({
      data: {
        id: nanoid(),
        projectId,
        sessionId: opts.sessionId,
        agentId: opts.agentId,
        traceId: nanoid(),
        provider: 'openai',
        model: 'gpt-4o-mini',
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        costUsd: opts.costUsd,
        timestamp: ts,
      },
    });
  }

  // ── Conversations ──────────────────────────────────────────────

  it('GET /metrics/conversations groups sessions per day with unique contacts', async () => {
    const c1 = await testDb.prisma.contact.create({
      data: { id: nanoid(), projectId, name: 'Contact 1', phone: '+5491111111111' },
    });
    const c2 = await testDb.prisma.contact.create({
      data: { id: nanoid(), projectId, name: 'Contact 2', phone: '+5492222222222' },
    });

    // Day -2: two sessions, same contact (uniqueContacts = 1)
    await seedSession({ daysAgo: 2, channel: 'whatsapp', contactId: c1.id });
    await seedSession({ daysAgo: 2, channel: 'whatsapp', contactId: c1.id });
    // Day -1: two sessions, two distinct contacts (uniqueContacts = 2)
    await seedSession({ daysAgo: 1, channel: 'whatsapp', contactId: c1.id });
    await seedSession({ daysAgo: 1, channel: 'telegram', contactId: c2.id });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/metrics/conversations`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as SuccessBody<{
      points: { date: string; count: number; uniqueContacts: number }[];
    }>;
    expect(body.success).toBe(true);
    expect(body.data.points).toHaveLength(2);

    const totals = body.data.points.reduce(
      (acc, p) => ({ count: acc.count + p.count, unique: acc.unique + p.uniqueContacts }),
      { count: 0, unique: 0 },
    );
    expect(totals.count).toBe(4);
    // 1 unique on day -2 + 2 uniques on day -1 = 3 (per-day unique aggregation)
    expect(totals.unique).toBe(3);
  });

  // ── Channels ───────────────────────────────────────────────────

  it('GET /metrics/channels returns distribution with percentages summing to 100', async () => {
    await seedSession({ daysAgo: 1, channel: 'whatsapp' });
    await seedSession({ daysAgo: 1, channel: 'whatsapp' });
    await seedSession({ daysAgo: 1, channel: 'whatsapp' });
    await seedSession({ daysAgo: 1, channel: 'telegram' });
    await seedSession({ daysAgo: 1, channel: null });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/metrics/channels`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as SuccessBody<{
      distribution: { channel: string; count: number; percentage: number }[];
    }>;

    const byChannel = Object.fromEntries(
      body.data.distribution.map((d) => [d.channel, d]),
    );
    expect(byChannel['whatsapp']?.count).toBe(3);
    expect(byChannel['telegram']?.count).toBe(1);
    expect(byChannel['unknown']?.count).toBe(1);

    const totalPct = body.data.distribution.reduce((sum, d) => sum + d.percentage, 0);
    // Allow rounding tolerance (each percentage rounded to 2 decimals)
    expect(Math.abs(totalPct - 100)).toBeLessThan(0.5);
  });

  // ── Usage ──────────────────────────────────────────────────────

  it('GET /metrics/usage?groupBy=day sums tokens and cost per day', async () => {
    const s = await seedSession({ daysAgo: 1, channel: 'whatsapp' });
    await seedUsage({ daysAgo: 1, sessionId: s, agentId, inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    await seedUsage({ daysAgo: 1, sessionId: s, agentId, inputTokens: 200, outputTokens: 100, costUsd: 0.02 });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/metrics/usage?groupBy=day`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as SuccessBody<{
      points: { date?: string; totalTokens: number; totalCostUsd: number }[];
    }>;
    expect(body.data.points).toHaveLength(1);
    expect(body.data.points[0]?.totalTokens).toBe(450);
    expect(body.data.points[0]?.totalCostUsd).toBeCloseTo(0.03, 5);
  });

  it('GET /metrics/usage?groupBy=agent sums per agentId with agentName', async () => {
    const s = await seedSession({ daysAgo: 1, channel: 'whatsapp' });
    await seedUsage({ daysAgo: 1, sessionId: s, agentId, inputTokens: 1000, outputTokens: 500, costUsd: 0.05 });
    await seedUsage({ daysAgo: 1, sessionId: s, agentId: null, inputTokens: 100, outputTokens: 50, costUsd: 0.001 });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/metrics/usage?groupBy=agent`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as SuccessBody<{
      points: {
        agentId?: string;
        agentName?: string;
        totalTokens: number;
        totalCostUsd: number;
      }[];
    }>;

    expect(body.data.points).toHaveLength(2);
    const named = body.data.points.find((p) => p.agentId === agentId);
    const unassigned = body.data.points.find((p) => p.agentId === 'unassigned');
    expect(named?.agentName).toBe('Sales Bot');
    expect(named?.totalTokens).toBe(1500);
    expect(unassigned?.agentName).toBe('Unassigned');
    expect(unassigned?.totalTokens).toBe(150);
  });
});
