/**
 * CRUD over `research_session_schedules`.
 *
 * Schedules drive the longitudinal research loop. The BullMQ tick job
 * calls `listDue()` every minute to find schedules ready to fire, then
 * creates sessions and calls `recordRun()` to advance state.
 */
import type { PrismaClient, ResearchSessionSchedule } from '@prisma/client';
import type { ResearchSessionScheduleId } from '../types.js';

// ─── Input types ──────────────────────────────────────────────────

export interface CreateScheduleInput {
  targetId: string;
  scriptId: string;
  phoneId: string;
  nextRunAt: Date;
  cronExpr?: string;
  /** Milliseconds between runs (alternative to cronExpr). Stored as BigInt. */
  intervalMs?: number | bigint;
  jitterMs?: number;
  createdBy?: string;
}

export interface UpdateScheduleInput {
  cronExpr?: string;
  intervalMs?: number | bigint;
  jitterMs?: number;
  nextRunAt?: Date;
  isActive?: boolean;
  phoneId?: string;
  scriptId?: string;
}

// ─── Interface ───────────────────────────────────────────────────

export interface ResearchSessionScheduleRepository {
  create(data: CreateScheduleInput): Promise<ResearchSessionSchedule>;
  findById(id: ResearchSessionScheduleId): Promise<ResearchSessionSchedule | null>;
  listByTarget(targetId: string): Promise<ResearchSessionSchedule[]>;
  /** Active schedules whose `nextRunAt` is in the past — ready to fire. */
  listDue(now?: Date): Promise<ResearchSessionSchedule[]>;
  listActive(): Promise<ResearchSessionSchedule[]>;
  /**
   * Advance state after a run fires.
   * Increments `runCount` (or `failCount`), sets `lastRunAt = now`, and
   * advances `nextRunAt` to the provided value.
   */
  recordRun(
    id: ResearchSessionScheduleId,
    success: boolean,
    nextRunAt: Date,
  ): Promise<ResearchSessionSchedule>;
  update(id: ResearchSessionScheduleId, data: UpdateScheduleInput): Promise<ResearchSessionSchedule>;
  deactivate(id: ResearchSessionScheduleId): Promise<ResearchSessionSchedule>;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createResearchScheduleRepository(
  prisma: PrismaClient,
): ResearchSessionScheduleRepository {
  return {
    async create(data) {
      return await prisma.researchSessionSchedule.create({
        data: {
          targetId: data.targetId,
          scriptId: data.scriptId,
          phoneId: data.phoneId,
          nextRunAt: data.nextRunAt,
          cronExpr: data.cronExpr,
          intervalMs: data.intervalMs !== undefined ? BigInt(data.intervalMs) : undefined,
          jitterMs: data.jitterMs,
          createdBy: data.createdBy,
        },
      });
    },

    async findById(id) {
      return await prisma.researchSessionSchedule.findUnique({ where: { id } });
    },

    async listByTarget(targetId) {
      return await prisma.researchSessionSchedule.findMany({
        where: { targetId },
        orderBy: { createdAt: 'asc' },
      });
    },

    async listDue(now = new Date()) {
      return await prisma.researchSessionSchedule.findMany({
        where: {
          isActive: true,
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: 'asc' },
      });
    },

    async listActive() {
      return await prisma.researchSessionSchedule.findMany({
        where: { isActive: true },
        orderBy: { nextRunAt: 'asc' },
      });
    },

    async recordRun(id, success, nextRunAt) {
      return await prisma.researchSessionSchedule.update({
        where: { id },
        data: {
          lastRunAt: new Date(),
          nextRunAt,
          ...(success ? { runCount: { increment: 1 } } : { failCount: { increment: 1 } }),
        },
      });
    },

    async update(id, data) {
      return await prisma.researchSessionSchedule.update({
        where: { id },
        data: {
          ...(data.cronExpr !== undefined && { cronExpr: data.cronExpr }),
          ...(data.intervalMs !== undefined && {
            intervalMs: BigInt(data.intervalMs),
          }),
          ...(data.jitterMs !== undefined && { jitterMs: data.jitterMs }),
          ...(data.nextRunAt !== undefined && { nextRunAt: data.nextRunAt }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          ...(data.phoneId !== undefined && { phoneId: data.phoneId }),
          ...(data.scriptId !== undefined && { scriptId: data.scriptId }),
        },
      });
    },

    async deactivate(id) {
      return await prisma.researchSessionSchedule.update({
        where: { id },
        data: { isActive: false },
      });
    },
  };
}
