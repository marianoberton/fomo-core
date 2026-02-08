/**
 * Project repository — CRUD operations for the projects table.
 * Maps between Prisma records and typed application models.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { AgentConfig, ProjectId } from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface Project {
  id: ProjectId;
  name: string;
  description?: string;
  environment: string;
  owner: string;
  tags: string[];
  config: AgentConfig;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  environment?: string;
  owner: string;
  tags?: string[];
  config: AgentConfig;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  environment?: string;
  tags?: string[];
  config?: AgentConfig;
  status?: string;
}

export interface ProjectFilters {
  owner?: string;
  status?: string;
  tags?: string[];
}

// ─── Repository ─────────────────────────────────────────────────

export interface ProjectRepository {
  create(input: ProjectCreateInput): Promise<Project>;
  findById(id: ProjectId): Promise<Project | null>;
  update(id: ProjectId, input: ProjectUpdateInput): Promise<Project | null>;
  delete(id: ProjectId): Promise<boolean>;
  list(filters?: ProjectFilters): Promise<Project[]>;
}

/** Map a Prisma project record to the app's Project type. */
function toAppModel(record: {
  id: string;
  name: string;
  description: string | null;
  environment: string;
  owner: string;
  tags: string[];
  configJson: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Project {
  return {
    id: record.id as ProjectId,
    name: record.name,
    description: record.description ?? undefined,
    environment: record.environment,
    owner: record.owner,
    tags: record.tags,
    config: record.configJson as AgentConfig,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Create a ProjectRepository backed by Prisma.
 */
export function createProjectRepository(prisma: PrismaClient): ProjectRepository {
  return {
    async create(input: ProjectCreateInput): Promise<Project> {
      const record = await prisma.project.create({
        data: {
          id: nanoid(),
          name: input.name,
          description: input.description ?? null,
          environment: input.environment ?? 'development',
          owner: input.owner,
          tags: input.tags ?? [],
          configJson: input.config as unknown as Prisma.InputJsonValue,
          status: 'active',
        },
      });
      return toAppModel(record);
    },

    async findById(id: ProjectId): Promise<Project | null> {
      const record = await prisma.project.findUnique({ where: { id } });
      if (!record) return null;
      return toAppModel(record);
    },

    async update(id: ProjectId, input: ProjectUpdateInput): Promise<Project | null> {
      try {
        const record = await prisma.project.update({
          where: { id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.environment !== undefined && { environment: input.environment }),
            ...(input.tags !== undefined && { tags: input.tags }),
            ...(input.config !== undefined && {
              configJson: input.config as unknown as Prisma.InputJsonValue,
            }),
            ...(input.status !== undefined && { status: input.status }),
          },
        });
        return toAppModel(record);
      } catch {
        return null;
      }
    },

    async delete(id: ProjectId): Promise<boolean> {
      try {
        await prisma.project.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    },

    async list(filters?: ProjectFilters): Promise<Project[]> {
      const records = await prisma.project.findMany({
        where: {
          ...(filters?.owner && { owner: filters.owner }),
          ...(filters?.status && { status: filters.status }),
          ...(filters?.tags && { tags: { hasSome: filters.tags } }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
