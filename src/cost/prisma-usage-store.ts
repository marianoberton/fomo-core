/**
 * Prisma-backed UsageStore for persistent cost tracking.
 * Rate limiting (RPM/RPH) stays in-memory — ephemeral and latency-sensitive.
 * Spend aggregation (daily/monthly) uses Prisma aggregate queries.
 */
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import type { UsageStore } from './cost-guard.js';

const logger = createLogger({ name: 'prisma-usage-store' });

/**
 * Create a UsageStore backed by Prisma for spend tracking,
 * with in-memory rate limiting for low-latency RPM/RPH checks.
 */
export function createPrismaUsageStore(prisma: PrismaClient): UsageStore {
  // In-memory rate limiting (ephemeral — acceptable to lose on restart)
  const requestTimestamps: { projectId: string; timestamp: Date }[] = [];

  /** Prune timestamps older than 2 hours to prevent unbounded growth. */
  function pruneTimestamps(): void {
    const cutoff = new Date(Date.now() - 7_200_000);
    const idx = requestTimestamps.findIndex((r) => r.timestamp >= cutoff);
    if (idx > 0) {
      requestTimestamps.splice(0, idx);
    }
  }

  return {
    async getDailySpend(projectId: ProjectId): Promise<number> {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await prisma.usageRecord.aggregate({
        where: {
          projectId,
          timestamp: { gte: today },
        },
        _sum: { costUsd: true },
      });

      return result._sum.costUsd ?? 0;
    },

    async getMonthlySpend(projectId: ProjectId): Promise<number> {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const result = await prisma.usageRecord.aggregate({
        where: {
          projectId,
          timestamp: { gte: monthStart },
        },
        _sum: { costUsd: true },
      });

      return result._sum.costUsd ?? 0;
    },

    async recordUsage(entry: {
      projectId: ProjectId;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
    }): Promise<void> {
      await prisma.usageRecord.create({
        data: {
          id: nanoid(),
          projectId: entry.projectId,
          sessionId: 'system',
          traceId: 'system',
          provider: entry.provider,
          model: entry.model,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          costUsd: entry.costUSD,
        },
      });

      logger.debug('Recorded usage', {
        component: 'prisma-usage-store',
        projectId: entry.projectId,
        costUSD: entry.costUSD,
      });
    },

    getRequestsLastMinute(projectId: ProjectId): Promise<number> {
      const oneMinuteAgo = new Date(Date.now() - 60_000);
      return Promise.resolve(
        requestTimestamps.filter(
          (r) => r.projectId === projectId && r.timestamp >= oneMinuteAgo,
        ).length,
      );
    },

    getRequestsLastHour(projectId: ProjectId): Promise<number> {
      const oneHourAgo = new Date(Date.now() - 3_600_000);
      return Promise.resolve(
        requestTimestamps.filter(
          (r) => r.projectId === projectId && r.timestamp >= oneHourAgo,
        ).length,
      );
    },

    recordRequest(projectId: ProjectId): Promise<void> {
      requestTimestamps.push({ projectId, timestamp: new Date() });
      pruneTimestamps();
      return Promise.resolve();
    },
  };
}
