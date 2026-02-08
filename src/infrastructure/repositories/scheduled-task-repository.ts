/**
 * ScheduledTask repository — CRUD + scheduling queries for scheduled tasks and runs.
 *
 * Prisma-backed. Supports querying tasks due for execution by checking
 * nextRunAt <= now && status === 'active'.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, ScheduledTaskId, ScheduledTaskRunId, TraceId } from '@/core/types.js';
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskCreateInput,
  ScheduledTaskRunCreateInput,
  ScheduledTaskStatus,
  ScheduledTaskOrigin,
  TaskPayload,
  ScheduledTaskRunStatus,
} from '@/scheduling/types.js';

// ─── Repository Interface ───────────────────────────────────────

export interface ScheduledTaskRepository {
  /** Create a new scheduled task. */
  create(input: ScheduledTaskCreateInput): Promise<ScheduledTask>;
  /** Find a task by ID. */
  findById(id: ScheduledTaskId): Promise<ScheduledTask | null>;
  /** Update task fields. */
  update(id: ScheduledTaskId, data: ScheduledTaskUpdateInput): Promise<ScheduledTask | null>;
  /** List tasks for a project, optionally filtered by status. */
  listByProject(projectId: ProjectId, status?: ScheduledTaskStatus): Promise<ScheduledTask[]>;
  /** Get all active tasks that are due for execution (nextRunAt <= now). */
  getTasksDueForExecution(now: Date): Promise<ScheduledTask[]>;
  /** Create a new run record for a task. */
  createRun(input: ScheduledTaskRunCreateInput): Promise<ScheduledTaskRun>;
  /** Update a run record. */
  updateRun(id: ScheduledTaskRunId, data: ScheduledTaskRunUpdateInput): Promise<ScheduledTaskRun | null>;
  /** List runs for a task, newest first. */
  listRuns(taskId: ScheduledTaskId, limit?: number): Promise<ScheduledTaskRun[]>;
}

// ─── Update Inputs ──────────────────────────────────────────────

export interface ScheduledTaskUpdateInput {
  status?: ScheduledTaskStatus;
  approvedBy?: string;
  lastRunAt?: Date;
  nextRunAt?: Date | null;
  runCount?: number;
}

export interface ScheduledTaskRunUpdateInput {
  status?: ScheduledTaskRunStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  traceId?: TraceId;
  result?: Record<string, unknown>;
  errorMessage?: string;
  retryCount?: number;
}

// ─── Mappers ────────────────────────────────────────────────────

function toTaskAppModel(record: {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  cronExpression: string;
  taskPayload: unknown;
  origin: string;
  status: string;
  proposedBy: string | null;
  approvedBy: string | null;
  maxRetries: number;
  timeoutMs: number;
  budgetPerRunUsd: number;
  maxDurationMinutes: number;
  maxTurns: number;
  maxRuns: number | null;
  runCount: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ScheduledTask {
  return {
    id: record.id as ScheduledTaskId,
    projectId: record.projectId as ProjectId,
    name: record.name,
    description: record.description ?? undefined,
    cronExpression: record.cronExpression,
    taskPayload: record.taskPayload as TaskPayload,
    origin: record.origin as ScheduledTaskOrigin,
    status: record.status as ScheduledTaskStatus,
    proposedBy: record.proposedBy ?? undefined,
    approvedBy: record.approvedBy ?? undefined,
    maxRetries: record.maxRetries,
    timeoutMs: record.timeoutMs,
    budgetPerRunUSD: record.budgetPerRunUsd,
    maxDurationMinutes: record.maxDurationMinutes,
    maxTurns: record.maxTurns,
    maxRuns: record.maxRuns ?? undefined,
    runCount: record.runCount,
    lastRunAt: record.lastRunAt ?? undefined,
    nextRunAt: record.nextRunAt ?? undefined,
    expiresAt: record.expiresAt ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRunAppModel(record: {
  id: string;
  taskId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  traceId: string | null;
  result: unknown;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date;
}): ScheduledTaskRun {
  return {
    id: record.id as ScheduledTaskRunId,
    taskId: record.taskId as ScheduledTaskId,
    status: record.status as ScheduledTaskRunStatus,
    startedAt: record.startedAt ?? undefined,
    completedAt: record.completedAt ?? undefined,
    durationMs: record.durationMs ?? undefined,
    tokensUsed: record.tokensUsed ?? undefined,
    costUsd: record.costUsd ?? undefined,
    traceId: record.traceId ? (record.traceId as TraceId) : undefined,
    result: record.result as Record<string, unknown> | undefined,
    errorMessage: record.errorMessage ?? undefined,
    retryCount: record.retryCount,
    createdAt: record.createdAt,
  };
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a ScheduledTaskRepository backed by Prisma. */
export function createScheduledTaskRepository(prisma: PrismaClient): ScheduledTaskRepository {
  return {
    async create(input: ScheduledTaskCreateInput): Promise<ScheduledTask> {
      const record = await prisma.scheduledTask.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? null,
          cronExpression: input.cronExpression,
          taskPayload: input.taskPayload as unknown as Prisma.InputJsonValue,
          origin: input.origin,
          status: input.origin === 'agent_proposed' ? 'proposed' : 'active',
          proposedBy: input.proposedBy ?? null,
          maxRetries: input.maxRetries ?? 2,
          timeoutMs: input.timeoutMs ?? 300_000,
          budgetPerRunUsd: input.budgetPerRunUSD ?? 1.0,
          maxDurationMinutes: input.maxDurationMinutes ?? 30,
          maxTurns: input.maxTurns ?? 10,
          maxRuns: input.maxRuns ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return toTaskAppModel(record);
    },

    async findById(id: ScheduledTaskId): Promise<ScheduledTask | null> {
      const record = await prisma.scheduledTask.findUnique({ where: { id } });
      if (!record) return null;
      return toTaskAppModel(record);
    },

    async update(id: ScheduledTaskId, data: ScheduledTaskUpdateInput): Promise<ScheduledTask | null> {
      try {
        const record = await prisma.scheduledTask.update({
          where: { id },
          data: {
            status: data.status,
            approvedBy: data.approvedBy,
            lastRunAt: data.lastRunAt,
            nextRunAt: data.nextRunAt,
            runCount: data.runCount,
          },
        });
        return toTaskAppModel(record);
      } catch {
        return null;
      }
    },

    async listByProject(
      projectId: ProjectId,
      status?: ScheduledTaskStatus,
    ): Promise<ScheduledTask[]> {
      const where: Prisma.ScheduledTaskWhereInput = { projectId };
      if (status) {
        where.status = status;
      }

      const records = await prisma.scheduledTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toTaskAppModel);
    },

    async getTasksDueForExecution(now: Date): Promise<ScheduledTask[]> {
      const records = await prisma.scheduledTask.findMany({
        where: {
          status: 'active',
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: 'asc' },
      });
      return records.map(toTaskAppModel);
    },

    async createRun(input: ScheduledTaskRunCreateInput): Promise<ScheduledTaskRun> {
      const record = await prisma.scheduledTaskRun.create({
        data: {
          id: nanoid(),
          taskId: input.taskId,
          traceId: input.traceId ?? null,
          status: 'pending',
        },
      });
      return toRunAppModel(record);
    },

    async updateRun(
      id: ScheduledTaskRunId,
      data: ScheduledTaskRunUpdateInput,
    ): Promise<ScheduledTaskRun | null> {
      try {
        const record = await prisma.scheduledTaskRun.update({
          where: { id },
          data: {
            status: data.status,
            startedAt: data.startedAt,
            completedAt: data.completedAt,
            durationMs: data.durationMs,
            tokensUsed: data.tokensUsed,
            costUsd: data.costUsd,
            traceId: data.traceId,
            result: data.result as unknown as Prisma.InputJsonValue,
            errorMessage: data.errorMessage,
            retryCount: data.retryCount,
          },
        });
        return toRunAppModel(record);
      } catch {
        return null;
      }
    },

    async listRuns(taskId: ScheduledTaskId, limit = 50): Promise<ScheduledTaskRun[]> {
      const records = await prisma.scheduledTaskRun.findMany({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return records.map(toRunAppModel);
    },
  };
}
