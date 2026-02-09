import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import { createPrismaUsageStore } from './prisma-usage-store.js';

const PROJECT_ID = 'proj_test' as ProjectId;

function createMockPrisma(): PrismaClient {
  return {
    usageRecord: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('PrismaUsageStore', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('getDailySpend', () => {
    it('returns aggregated daily spend from Prisma', async () => {
      vi.mocked(mockPrisma.usageRecord.aggregate).mockResolvedValue({
        _sum: { costUsd: 42.5 },
        _avg: { costUsd: null },
        _min: { costUsd: null },
        _max: { costUsd: null },
        _count: 0,
      } as never);

      const store = createPrismaUsageStore(mockPrisma);
      const spend = await store.getDailySpend(PROJECT_ID);

      expect(spend).toBe(42.5);
       
      expect(mockPrisma.usageRecord.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: PROJECT_ID,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            timestamp: expect.objectContaining({ gte: expect.any(Date) }) as unknown,
          }) as unknown,
          _sum: { costUsd: true },
        }),
      );
    });

    it('returns 0 when no records exist', async () => {
      vi.mocked(mockPrisma.usageRecord.aggregate).mockResolvedValue({
        _sum: { costUsd: null },
        _avg: { costUsd: null },
        _min: { costUsd: null },
        _max: { costUsd: null },
        _count: 0,
      } as never);

      const store = createPrismaUsageStore(mockPrisma);
      const spend = await store.getDailySpend(PROJECT_ID);

      expect(spend).toBe(0);
    });
  });

  describe('getMonthlySpend', () => {
    it('returns aggregated monthly spend from Prisma', async () => {
      vi.mocked(mockPrisma.usageRecord.aggregate).mockResolvedValue({
        _sum: { costUsd: 150.75 },
        _avg: { costUsd: null },
        _min: { costUsd: null },
        _max: { costUsd: null },
        _count: 0,
      } as never);

      const store = createPrismaUsageStore(mockPrisma);
      const spend = await store.getMonthlySpend(PROJECT_ID);

      expect(spend).toBe(150.75);
    });

    it('returns 0 when no records exist', async () => {
      vi.mocked(mockPrisma.usageRecord.aggregate).mockResolvedValue({
        _sum: { costUsd: null },
        _avg: { costUsd: null },
        _min: { costUsd: null },
        _max: { costUsd: null },
        _count: 0,
      } as never);

      const store = createPrismaUsageStore(mockPrisma);
      const spend = await store.getMonthlySpend(PROJECT_ID);

      expect(spend).toBe(0);
    });
  });

  describe('recordUsage', () => {
    it('creates a usage record via Prisma', async () => {
      vi.mocked(mockPrisma.usageRecord.create).mockResolvedValue({} as never);

      const store = createPrismaUsageStore(mockPrisma);
      await store.recordUsage({
        projectId: PROJECT_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 1000,
        outputTokens: 500,
        costUSD: 0.012,
      });

       
      expect(mockPrisma.usageRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          inputTokens: 1000,
          outputTokens: 500,
          costUsd: 0.012,
          sessionId: 'system',
          traceId: 'system',
        }) as unknown,
      });
    });
  });

  describe('rate limiting (in-memory)', () => {
    it('tracks requests per minute', async () => {
      const store = createPrismaUsageStore(mockPrisma);

      await store.recordRequest(PROJECT_ID);
      await store.recordRequest(PROJECT_ID);
      await store.recordRequest(PROJECT_ID);

      const rpm = await store.getRequestsLastMinute(PROJECT_ID);
      expect(rpm).toBe(3);
    });

    it('tracks requests per hour', async () => {
      const store = createPrismaUsageStore(mockPrisma);

      await store.recordRequest(PROJECT_ID);
      await store.recordRequest(PROJECT_ID);

      const rph = await store.getRequestsLastHour(PROJECT_ID);
      expect(rph).toBe(2);
    });

    it('isolates projects', async () => {
      const store = createPrismaUsageStore(mockPrisma);
      const otherProject = 'proj_other' as ProjectId;

      await store.recordRequest(PROJECT_ID);
      await store.recordRequest(PROJECT_ID);
      await store.recordRequest(otherProject);

      const rpm = await store.getRequestsLastMinute(PROJECT_ID);
      const otherRpm = await store.getRequestsLastMinute(otherProject);
      expect(rpm).toBe(2);
      expect(otherRpm).toBe(1);
    });

    it('returns 0 when no requests recorded', async () => {
      const store = createPrismaUsageStore(mockPrisma);
      const rpm = await store.getRequestsLastMinute(PROJECT_ID);
      const rph = await store.getRequestsLastHour(PROJECT_ID);
      expect(rpm).toBe(0);
      expect(rph).toBe(0);
    });
  });
});
