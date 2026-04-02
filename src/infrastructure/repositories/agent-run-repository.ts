/**
 * AgentRun repository — CRUD operations for generic agent run monitoring.
 * Persists runs and steps in PostgreSQL for cross-project pipeline tracking.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ProjectId, AgentRunId, AgentRunStepId } from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export type AgentRunStatus = 'running' | 'done' | 'failed' | 'killed';
export type AgentRunStepStatus = 'pending' | 'working' | 'done' | 'failed' | 'skipped';

export interface AgentRun {
  id: AgentRunId;
  projectId: ProjectId;
  externalProject?: string;
  runType: string;
  description?: string;
  status: AgentRunStatus;
  totalSteps: number;
  currentStep: number;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  steps?: AgentRunStep[];
}

export interface AgentRunStep {
  id: AgentRunStepId;
  runId: AgentRunId;
  stepIndex: number;
  agentName: string;
  status: AgentRunStepStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  input?: string;
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunCreateInput {
  projectId: string;
  externalProject?: string;
  runType: string;
  description?: string;
  totalSteps: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRunUpdateInput {
  status?: AgentRunStatus;
  currentStep?: number;
  completedAt?: Date;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRunStepCreateInput {
  runId: string;
  stepIndex: number;
  agentName: string;
  input?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunStepUpdateInput {
  status?: AgentRunStepStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunFilters {
  projectId?: string;
  externalProject?: string;
  status?: AgentRunStatus;
}

// ─── Repository Interface ───────────────────────────────────────

export interface AgentRunRepository {
  /** Create a new agent run. */
  create(input: AgentRunCreateInput): Promise<AgentRun>;
  /** Find a run by ID (includes steps). */
  findById(id: AgentRunId): Promise<AgentRun | null>;
  /** Update a run. */
  update(id: AgentRunId, data: AgentRunUpdateInput): Promise<AgentRun | null>;
  /** List runs with optional filters, newest first. */
  list(filters?: AgentRunFilters, limit?: number, offset?: number): Promise<{ items: AgentRun[]; total: number }>;
  /** Create a step for a run. */
  createStep(input: AgentRunStepCreateInput): Promise<AgentRunStep>;
  /** Update a step. */
  updateStep(id: AgentRunStepId, data: AgentRunStepUpdateInput): Promise<AgentRunStep | null>;
  /** List steps for a run, ordered by stepIndex. */
  listSteps(runId: AgentRunId): Promise<AgentRunStep[]>;
}

// ─── Mappers ────────────────────────────────────────────────────

function toRunAppModel(record: {
  id: string;
  projectId: string;
  externalProject: string | null;
  runType: string;
  description: string | null;
  status: string;
  totalSteps: number;
  currentStep: number;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  metadata: unknown;
  steps?: Array<{
    id: string;
    runId: string;
    stepIndex: number;
    agentName: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    durationMs: number | null;
    input: string | null;
    output: string | null;
    metadata: unknown;
  }>;
}): AgentRun {
  const run: AgentRun = {
    id: record.id as AgentRunId,
    projectId: record.projectId as ProjectId,
    externalProject: record.externalProject ?? undefined,
    runType: record.runType,
    description: record.description ?? undefined,
    status: record.status as AgentRunStatus,
    totalSteps: record.totalSteps,
    currentStep: record.currentStep,
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? undefined,
    durationMs: record.durationMs ?? undefined,
    metadata: record.metadata as Record<string, unknown> | undefined,
  };
  if (record.steps) {
    run.steps = record.steps.map(toStepAppModel);
  }
  return run;
}

function toStepAppModel(record: {
  id: string;
  runId: string;
  stepIndex: number;
  agentName: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  input: string | null;
  output: string | null;
  metadata: unknown;
}): AgentRunStep {
  return {
    id: record.id as AgentRunStepId,
    runId: record.runId as AgentRunId,
    stepIndex: record.stepIndex,
    agentName: record.agentName,
    status: record.status as AgentRunStepStatus,
    startedAt: record.startedAt ?? undefined,
    completedAt: record.completedAt ?? undefined,
    durationMs: record.durationMs ?? undefined,
    input: record.input ?? undefined,
    output: record.output ?? undefined,
    metadata: record.metadata as Record<string, unknown> | undefined,
  };
}

// ─── Factory ────────────────────────────────────────────────────

/** Create an AgentRunRepository backed by Prisma. */
export function createAgentRunRepository(prisma: PrismaClient): AgentRunRepository {
  return {
    async create(input: AgentRunCreateInput): Promise<AgentRun> {
      const record = await prisma.agentRun.create({
        data: {
          projectId: input.projectId,
          externalProject: input.externalProject ?? null,
          runType: input.runType,
          description: input.description ?? null,
          totalSteps: input.totalSteps,
          status: 'running',
          currentStep: 0,
          metadata: input.metadata as unknown as Prisma.InputJsonValue ?? null,
        },
      });
      return toRunAppModel(record);
    },

    async findById(id: AgentRunId): Promise<AgentRun | null> {
      const record = await prisma.agentRun.findUnique({
        where: { id },
        include: { steps: { orderBy: { stepIndex: 'asc' } } },
      });
      if (!record) return null;
      return toRunAppModel(record);
    },

    async update(id: AgentRunId, data: AgentRunUpdateInput): Promise<AgentRun | null> {
      try {
        const record = await prisma.agentRun.update({
          where: { id },
          data: {
            ...(data.status !== undefined && { status: data.status }),
            ...(data.currentStep !== undefined && { currentStep: data.currentStep }),
            ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
            ...(data.durationMs !== undefined && { durationMs: data.durationMs }),
            ...(data.metadata !== undefined && { metadata: data.metadata as unknown as Prisma.InputJsonValue }),
          },
          include: { steps: { orderBy: { stepIndex: 'asc' } } },
        });
        return toRunAppModel(record);
      } catch {
        return null;
      }
    },

    async list(
      filters?: AgentRunFilters,
      limit = 20,
      offset = 0,
    ): Promise<{ items: AgentRun[]; total: number }> {
      const where: Prisma.AgentRunWhereInput = {};
      if (filters?.projectId) where.projectId = filters.projectId;
      if (filters?.externalProject) where.externalProject = filters.externalProject;
      if (filters?.status) where.status = filters.status;

      const [records, total] = await Promise.all([
        prisma.agentRun.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          take: limit,
          skip: offset,
          include: { steps: { orderBy: { stepIndex: 'asc' } } },
        }),
        prisma.agentRun.count({ where }),
      ]);

      return {
        items: records.map(toRunAppModel),
        total,
      };
    },

    async createStep(input: AgentRunStepCreateInput): Promise<AgentRunStep> {
      const record = await prisma.agentRunStep.create({
        data: {
          runId: input.runId,
          stepIndex: input.stepIndex,
          agentName: input.agentName,
          status: 'pending',
          input: input.input ?? null,
          metadata: input.metadata as unknown as Prisma.InputJsonValue ?? null,
        },
      });
      return toStepAppModel(record);
    },

    async updateStep(id: AgentRunStepId, data: AgentRunStepUpdateInput): Promise<AgentRunStep | null> {
      try {
        const record = await prisma.agentRunStep.update({
          where: { id },
          data: {
            ...(data.status !== undefined && { status: data.status }),
            ...(data.startedAt !== undefined && { startedAt: data.startedAt }),
            ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
            ...(data.durationMs !== undefined && { durationMs: data.durationMs }),
            ...(data.output !== undefined && { output: data.output }),
            ...(data.metadata !== undefined && { metadata: data.metadata as unknown as Prisma.InputJsonValue }),
          },
        });
        return toStepAppModel(record);
      } catch {
        return null;
      }
    },

    async listSteps(runId: AgentRunId): Promise<AgentRunStep[]> {
      const records = await prisma.agentRunStep.findMany({
        where: { runId },
        orderBy: { stepIndex: 'asc' },
      });
      return records.map(toStepAppModel);
    },
  };
}
