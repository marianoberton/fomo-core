/**
 * ExecutionTrace repository — trace lifecycle and event persistence.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type {
  ExecutionStatus,
  ExecutionTrace,
  ProjectId,
  PromptSnapshot,
  SessionId,
  TraceEvent,
  TraceId,
} from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TraceCreateInput {
  projectId: ProjectId;
  sessionId: SessionId;
  promptSnapshot: PromptSnapshot;
}

export interface TraceUpdateInput {
  totalDurationMs?: number;
  totalTokensUsed?: number;
  totalCostUsd?: number;
  turnCount?: number;
  status?: ExecutionStatus;
  completedAt?: Date;
}

// ─── Repository ─────────────────────────────────────────────────

export interface ExecutionTraceRepository {
  create(input: TraceCreateInput): Promise<ExecutionTrace>;
  /** Persist a completed trace (with its existing ID, events, and totals). */
  save(trace: ExecutionTrace): Promise<void>;
  findById(id: TraceId): Promise<ExecutionTrace | null>;
  update(id: TraceId, input: TraceUpdateInput): Promise<boolean>;
  /** Append events to an existing trace's event array. */
  addEvents(id: TraceId, events: TraceEvent[]): Promise<boolean>;
  listBySession(sessionId: SessionId): Promise<ExecutionTrace[]>;
}

/** Map a Prisma record to the app type. */
function toAppModel(record: {
  id: string;
  projectId: string;
  sessionId: string;
  promptSnapshot: unknown;
  events: unknown;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  turnCount: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
}): ExecutionTrace {
  return {
    id: record.id as TraceId,
    projectId: record.projectId as ProjectId,
    sessionId: record.sessionId as SessionId,
    promptSnapshot: record.promptSnapshot as PromptSnapshot,
    events: record.events as TraceEvent[],
    totalDurationMs: record.totalDurationMs,
    totalTokensUsed: record.totalTokensUsed,
    totalCostUSD: record.totalCostUsd,
    turnCount: record.turnCount,
    status: record.status as ExecutionStatus,
    createdAt: record.createdAt,
    completedAt: record.completedAt ?? undefined,
  };
}

/**
 * Create an ExecutionTraceRepository backed by Prisma.
 */
export function createExecutionTraceRepository(prisma: PrismaClient): ExecutionTraceRepository {
  return {
    async create(input: TraceCreateInput): Promise<ExecutionTrace> {
      const record = await prisma.executionTrace.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          sessionId: input.sessionId,
          promptSnapshot: input.promptSnapshot as unknown as Prisma.InputJsonValue,
          events: [] as Prisma.InputJsonValue,
          totalDurationMs: 0,
          totalTokensUsed: 0,
          totalCostUsd: 0,
          turnCount: 0,
          status: 'running',
        },
      });
      return toAppModel(record);
    },

    async save(trace: ExecutionTrace): Promise<void> {
      await prisma.executionTrace.upsert({
        where: { id: trace.id },
        create: {
          id: trace.id,
          projectId: trace.projectId,
          sessionId: trace.sessionId,
          promptSnapshot: trace.promptSnapshot as unknown as Prisma.InputJsonValue,
          events: trace.events as unknown as Prisma.InputJsonValue,
          totalDurationMs: trace.totalDurationMs,
          totalTokensUsed: trace.totalTokensUsed,
          totalCostUsd: trace.totalCostUSD,
          turnCount: trace.turnCount,
          status: trace.status,
          createdAt: trace.createdAt,
          completedAt: trace.completedAt ?? null,
        },
        update: {
          events: trace.events as unknown as Prisma.InputJsonValue,
          totalDurationMs: trace.totalDurationMs,
          totalTokensUsed: trace.totalTokensUsed,
          totalCostUsd: trace.totalCostUSD,
          turnCount: trace.turnCount,
          status: trace.status,
          completedAt: trace.completedAt ?? null,
        },
      });
    },

    async findById(id: TraceId): Promise<ExecutionTrace | null> {
      const record = await prisma.executionTrace.findUnique({ where: { id } });
      if (!record) return null;
      return toAppModel(record);
    },

    async update(id: TraceId, input: TraceUpdateInput): Promise<boolean> {
      try {
        await prisma.executionTrace.update({
          where: { id },
          data: {
            ...(input.totalDurationMs !== undefined && { totalDurationMs: input.totalDurationMs }),
            ...(input.totalTokensUsed !== undefined && { totalTokensUsed: input.totalTokensUsed }),
            ...(input.totalCostUsd !== undefined && { totalCostUsd: input.totalCostUsd }),
            ...(input.turnCount !== undefined && { turnCount: input.turnCount }),
            ...(input.status !== undefined && { status: input.status }),
            ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
          },
        });
        return true;
      } catch {
        return false;
      }
    },

    async addEvents(id: TraceId, events: TraceEvent[]): Promise<boolean> {
      try {
        const trace = await prisma.executionTrace.findUnique({
          where: { id },
          select: { events: true },
        });
        if (!trace) return false;

        const existingEvents = trace.events as unknown[];
        const mergedEvents = [...existingEvents, ...events] as Prisma.InputJsonValue;

        await prisma.executionTrace.update({
          where: { id },
          data: { events: mergedEvents },
        });

        return true;
      } catch {
        return false;
      }
    },

    async listBySession(sessionId: SessionId): Promise<ExecutionTrace[]> {
      const records = await prisma.executionTrace.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
