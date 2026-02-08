/**
 * PromptLayer repository — independently-versioned prompt layers with activation control.
 *
 * Each project has 3 layer types (identity, instructions, safety).
 * Layers are immutable. Rollback = deactivate current, activate previous.
 * Only one layer per (project, layerType) can be active at a time.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, PromptLayerId } from '@/core/types.js';
import type { PromptLayer, PromptLayerType } from '@/prompts/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface PromptLayerCreateInput {
  projectId: ProjectId;
  layerType: PromptLayerType;
  content: string;
  createdBy: string;
  changeReason: string;
  performanceNotes?: string;
  metadata?: Record<string, unknown>;
}

// ─── Repository ─────────────────────────────────────────────────

export interface PromptLayerRepository {
  /** Create a new immutable prompt layer. Auto-increments version per (project, layerType). */
  create(input: PromptLayerCreateInput): Promise<PromptLayer>;
  /** Find a layer by ID. */
  findById(id: PromptLayerId): Promise<PromptLayer | null>;
  /** Get the currently active layer for a project + layer type. */
  getActiveLayer(projectId: ProjectId, layerType: PromptLayerType): Promise<PromptLayer | null>;
  /** Activate a layer (deactivates others of the same project + layerType). */
  activate(id: PromptLayerId): Promise<boolean>;
  /** List all layers for a project, optionally filtered by layer type, newest first. */
  listByProject(projectId: ProjectId, layerType?: PromptLayerType): Promise<PromptLayer[]>;
}

/** Map a Prisma record to the app type. */
function toAppModel(record: {
  id: string;
  projectId: string;
  layerType: string;
  version: number;
  content: string;
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  changeReason: string;
  performanceNotes: string | null;
  metadata: unknown;
}): PromptLayer {
  return {
    id: record.id as PromptLayerId,
    projectId: record.projectId as ProjectId,
    layerType: record.layerType as PromptLayerType,
    version: record.version,
    content: record.content,
    isActive: record.isActive,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    changeReason: record.changeReason,
    performanceNotes: record.performanceNotes ?? undefined,
    metadata: record.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Create a PromptLayerRepository backed by Prisma.
 */
export function createPromptLayerRepository(prisma: PrismaClient): PromptLayerRepository {
  return {
    async create(input: PromptLayerCreateInput): Promise<PromptLayer> {
      // Get next version number for this (project, layerType)
      const latest = await prisma.promptLayer.findFirst({
        where: { projectId: input.projectId, layerType: input.layerType },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      const record = await prisma.promptLayer.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          layerType: input.layerType,
          version: nextVersion,
          content: input.content,
          isActive: false,
          createdBy: input.createdBy,
          changeReason: input.changeReason,
          performanceNotes: input.performanceNotes ?? null,
          metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
        },
      });
      return toAppModel(record);
    },

    async findById(id: PromptLayerId): Promise<PromptLayer | null> {
      const record = await prisma.promptLayer.findUnique({ where: { id } });
      if (!record) return null;
      return toAppModel(record);
    },

    async getActiveLayer(
      projectId: ProjectId,
      layerType: PromptLayerType,
    ): Promise<PromptLayer | null> {
      const record = await prisma.promptLayer.findFirst({
        where: { projectId, layerType, isActive: true },
      });
      if (!record) return null;
      return toAppModel(record);
    },

    async activate(id: PromptLayerId): Promise<boolean> {
      try {
        const layer = await prisma.promptLayer.findUnique({
          where: { id },
          select: { projectId: true, layerType: true },
        });
        if (!layer) return false;

        // Transaction: deactivate same (project, layerType) → activate target
        await prisma.$transaction([
          prisma.promptLayer.updateMany({
            where: {
              projectId: layer.projectId,
              layerType: layer.layerType,
            },
            data: { isActive: false },
          }),
          prisma.promptLayer.update({
            where: { id },
            data: { isActive: true },
          }),
        ]);

        return true;
      } catch {
        return false;
      }
    },

    async listByProject(
      projectId: ProjectId,
      layerType?: PromptLayerType,
    ): Promise<PromptLayer[]> {
      const where: Prisma.PromptLayerWhereInput = { projectId };
      if (layerType) {
        where.layerType = layerType;
      }

      const records = await prisma.promptLayer.findMany({
        where,
        orderBy: { version: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
