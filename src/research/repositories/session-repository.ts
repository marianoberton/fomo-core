/**
 * CRUD over `research_sessions`.
 *
 * All status-mutating methods go through `$transaction` to guarantee
 * atomicity. Terminal states (completed/failed/aborted) are idempotent —
 * calling any transition on a session already in a terminal state is a no-op.
 */
import type { PrismaClient, ResearchSession, ResearchSessionStatus } from '@prisma/client';
import { $Enums } from '@prisma/client';
import type { ResearchSessionId } from '../types.js';

// ─── Input / Filter types ─────────────────────────────────────────

export interface CreateSessionInput {
  targetId: string;
  phoneId: string;
  scriptId: string;
  scheduleId?: string;
  triggeredBy?: string;
  notes?: string;
}

export interface SessionFilters {
  targetId?: string;
  phoneId?: string;
  status?: ResearchSessionStatus;
  /** Filter by the related ProbeScript's level. */
  scriptLevel?: $Enums.ProbeLevel;
  limit?: number;
  offset?: number;
}

// ─── Interface ────────────────────────────────────────────────────

export interface ResearchSessionRepository {
  create(data: CreateSessionInput): Promise<ResearchSession>;
  findById(id: ResearchSessionId): Promise<ResearchSession | null>;
  /** Find the active session for a phone+target pair, if any. */
  findActive(phoneId: string, targetId: string): Promise<ResearchSession | null>;
  findAll(filters?: SessionFilters): Promise<ResearchSession[]>;
  listByStatus(status: ResearchSessionStatus, limit?: number): Promise<ResearchSession[]>;
  listByTarget(targetId: string, limit?: number): Promise<ResearchSession[]>;
  listByPhone(phoneId: string, limit?: number): Promise<ResearchSession[]>;
  /**
   * Transition to a new status (atomic). Sets `startedAt` when transitioning
   * to `running` for the first time. No-ops if the session is in a terminal state.
   */
  updateStatus(id: ResearchSessionId, status: ResearchSessionStatus): Promise<ResearchSession>;
  updateCurrentTurn(id: ResearchSessionId, turn: number): Promise<ResearchSession>;
  /** Sets `completedAt` + `retentionEligibleAt` (completedAt + 18 months). */
  markCompleted(id: ResearchSessionId): Promise<ResearchSession>;
  /** Sets `failedAt`, `failReason`, and optional `failCode`. */
  markFailed(id: ResearchSessionId, failReason: string, failCode?: string): Promise<ResearchSession>;
  /** Transitions to `aborted` with a failCode. Used by opt-out and manual cancel. */
  abort(id: ResearchSessionId, failCode: string): Promise<ResearchSession>;
  /** Increment retryCount (called when creating a retry clone). */
  incrementRetryCount(id: ResearchSessionId): Promise<ResearchSession>;
}

// ─── Constants ───────────────────────────────────────────────────

const ACTIVE_STATUSES: ResearchSessionStatus[] = ['queued', 'running', 'waiting_response'];
const TERMINAL_STATUSES: ResearchSessionStatus[] = ['completed', 'failed', 'aborted'];

// ─── Factory ─────────────────────────────────────────────────────

export function createResearchSessionRepository(prisma: PrismaClient): ResearchSessionRepository {
  return {
    async create(data) {
      return await prisma.researchSession.create({
        data: {
          targetId: data.targetId,
          phoneId: data.phoneId,
          scriptId: data.scriptId,
          scheduleId: data.scheduleId,
          triggeredBy: data.triggeredBy,
          notes: data.notes,
        },
      });
    },

    async findById(id) {
      return await prisma.researchSession.findUnique({ where: { id } });
    },

    async findActive(phoneId, targetId) {
      return await prisma.researchSession.findFirst({
        where: {
          phoneId,
          targetId,
          status: { in: ACTIVE_STATUSES },
        },
      });
    },

    async findAll(filters = {}) {
      const { targetId, phoneId, status, scriptLevel, limit = 100, offset = 0 } = filters;
      return await prisma.researchSession.findMany({
        where: {
          ...(targetId !== undefined && { targetId }),
          ...(phoneId !== undefined && { phoneId }),
          ...(status !== undefined && { status }),
          ...(scriptLevel !== undefined && { script: { level: scriptLevel } }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });
    },

    async listByStatus(status, limit = 100) {
      return await prisma.researchSession.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    async listByTarget(targetId, limit = 100) {
      return await prisma.researchSession.findMany({
        where: { targetId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    async listByPhone(phoneId, limit = 100) {
      return await prisma.researchSession.findMany({
        where: { phoneId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    async updateStatus(id, status) {
      return await prisma.$transaction(async (tx) => {
        const session = await tx.researchSession.findUniqueOrThrow({ where: { id } });
        if (TERMINAL_STATUSES.includes(session.status)) {
          return session;
        }
        return await tx.researchSession.update({
          where: { id },
          data: {
            status,
            ...(status === 'running' && session.startedAt === null && {
              startedAt: new Date(),
            }),
          },
        });
      });
    },

    async updateCurrentTurn(id, turn) {
      return await prisma.researchSession.update({
        where: { id },
        data: { currentTurn: turn },
      });
    },

    async markCompleted(id) {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const retentionEligibleAt = new Date(now);
        retentionEligibleAt.setMonth(retentionEligibleAt.getMonth() + 18);
        return await tx.researchSession.update({
          where: { id },
          data: {
            status: 'completed',
            completedAt: now,
            retentionEligibleAt,
          },
        });
      });
    },

    async markFailed(id, failReason, failCode) {
      return await prisma.$transaction(async (tx) => {
        return await tx.researchSession.update({
          where: { id },
          data: {
            status: 'failed',
            failedAt: new Date(),
            failReason,
            ...(failCode !== undefined && { failCode }),
          },
        });
      });
    },

    async abort(id, failCode) {
      return await prisma.$transaction(async (tx) => {
        return await tx.researchSession.update({
          where: { id },
          data: {
            status: 'aborted',
            failedAt: new Date(),
            failCode,
          },
        });
      });
    },

    async incrementRetryCount(id) {
      return await prisma.researchSession.update({
        where: { id },
        data: { retryCount: { increment: 1 } },
      });
    },
  };
}
