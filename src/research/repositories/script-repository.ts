/**
 * ProbeScript repository — CRUD with clone + version bump.
 *
 * clone() creates an unofficial copy with version = source.version + 1,
 * allowing teams to customise official scripts without touching the originals.
 */
import type { PrismaClient, ProbeScript } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { $Enums } from '@prisma/client';
import type { ProbeTurn } from '@/research/types.js';
import { ResearchError } from '@/research/errors.js';
import { ok, err, type Result } from '@/core/result.js';

// ─── Input / Filter types ─────────────────────────────────────────

export interface ScriptFilters {
  verticalSlug?: string;
  level?: $Enums.ProbeLevel;
  isOfficial?: boolean;
  isActive?: boolean;
}

export interface CreateScriptInput {
  name: string;
  verticalSlug: string;
  level: $Enums.ProbeLevel;
  objective: string;
  estimatedMinutes: number;
  turns: ProbeTurn[];
  waitMinMs?: number;
  waitMaxMs?: number;
  isOfficial?: boolean;
  createdBy?: string;
}

export interface UpdateScriptInput {
  name?: string;
  objective?: string;
  estimatedMinutes?: number;
  turns?: ProbeTurn[];
  waitMinMs?: number;
  waitMaxMs?: number;
  isActive?: boolean;
  updatedBy?: string;
}

export interface CloneScriptOptions {
  /** Override the cloned script's name. Defaults to "<source.name> (copy)". */
  name?: string;
  createdBy?: string;
}

// ─── Repository interface ─────────────────────────────────────────

export interface ScriptRepository {
  /** List scripts with optional filters. Universal scripts (verticalSlug='universal') are always included. */
  findAll(filters?: ScriptFilters): Promise<ProbeScript[]>;
  findById(id: string): Promise<ProbeScript | null>;
  create(data: CreateScriptInput): Promise<ProbeScript>;
  /** Bump version on update; fails if not found. */
  update(id: string, data: UpdateScriptInput): Promise<Result<ProbeScript, ResearchError>>;
  /** Fails with SCRIPT_INVALID when the script has linked sessions. */
  delete(id: string): Promise<Result<void, ResearchError>>;
  /** Creates an unofficial copy with version bumped; fails if source not found. */
  clone(id: string, options?: CloneScriptOptions): Promise<Result<ProbeScript, ResearchError>>;
  hasActiveSessions(id: string): Promise<boolean>;
}

// ─── Prisma factory ───────────────────────────────────────────────

/** Create a Prisma-backed ScriptRepository. */
export function createScriptRepository(prisma: PrismaClient): ScriptRepository {
  return {
    async findAll(filters?: ScriptFilters): Promise<ProbeScript[]> {
      const where: Prisma.ProbeScriptWhereInput = {};

      if (filters?.level !== undefined) where.level = filters.level;
      if (filters?.isOfficial !== undefined) where.isOfficial = filters.isOfficial;
      if (filters?.isActive !== undefined) where.isActive = filters.isActive;

      // When filtering by vertical: also include 'universal' scripts so they
      // show up regardless of which vertical tab the user is on.
      if (filters?.verticalSlug !== undefined) {
        where.OR = [
          { verticalSlug: filters.verticalSlug },
          { verticalSlug: 'universal' },
        ];
      }

      return prisma.probeScript.findMany({
        where,
        orderBy: [{ level: 'asc' }, { isOfficial: 'desc' }, { name: 'asc' }],
      });
    },

    async findById(id: string): Promise<ProbeScript | null> {
      return prisma.probeScript.findUnique({ where: { id } });
    },

    async create(data: CreateScriptInput): Promise<ProbeScript> {
      return prisma.probeScript.create({
        data: {
          name: data.name,
          verticalSlug: data.verticalSlug,
          level: data.level,
          objective: data.objective,
          estimatedMinutes: data.estimatedMinutes,
          turns: data.turns as unknown as Prisma.InputJsonValue,
          waitMinMs: data.waitMinMs ?? 3000,
          waitMaxMs: data.waitMaxMs ?? 8000,
          isOfficial: data.isOfficial ?? false,
          createdBy: data.createdBy,
          version: 1,
        },
      });
    },

    async update(
      id: string,
      data: UpdateScriptInput,
    ): Promise<Result<ProbeScript, ResearchError>> {
      const existing = await prisma.probeScript.findUnique({ where: { id } });
      if (!existing) {
        return err(
          new ResearchError({
            message: `ProbeScript not found: ${id}`,
            code: 'SCRIPT_INVALID',
          }),
        );
      }

      const updated = await prisma.probeScript.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.objective !== undefined && { objective: data.objective }),
          ...(data.estimatedMinutes !== undefined && { estimatedMinutes: data.estimatedMinutes }),
          ...(data.turns !== undefined && {
            turns: data.turns as unknown as Prisma.InputJsonValue,
          }),
          ...(data.waitMinMs !== undefined && { waitMinMs: data.waitMinMs }),
          ...(data.waitMaxMs !== undefined && { waitMaxMs: data.waitMaxMs }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy }),
          version: { increment: 1 },
        },
      });

      return ok(updated);
    },

    async delete(id: string): Promise<Result<void, ResearchError>> {
      const hasSessions = await this.hasActiveSessions(id);
      if (hasSessions) {
        return err(
          new ResearchError({
            message: 'Cannot delete a script that has linked sessions',
            code: 'SCRIPT_INVALID',
          }),
        );
      }

      try {
        await prisma.probeScript.delete({ where: { id } });
        return ok(undefined);
      } catch {
        return err(
          new ResearchError({
            message: `ProbeScript not found: ${id}`,
            code: 'SCRIPT_INVALID',
          }),
        );
      }
    },

    async clone(
      id: string,
      options?: CloneScriptOptions,
    ): Promise<Result<ProbeScript, ResearchError>> {
      const source = await prisma.probeScript.findUnique({ where: { id } });
      if (!source) {
        return err(
          new ResearchError({
            message: `ProbeScript not found: ${id}`,
            code: 'SCRIPT_INVALID',
          }),
        );
      }

      const clonedName = options?.name ?? `${source.name} (copy)`;

      const cloned = await prisma.probeScript.create({
        data: {
          name: clonedName,
          verticalSlug: source.verticalSlug,
          level: source.level,
          objective: source.objective,
          estimatedMinutes: source.estimatedMinutes,
          turns: source.turns as unknown as Prisma.InputJsonValue,
          waitMinMs: source.waitMinMs,
          waitMaxMs: source.waitMaxMs,
          isOfficial: false,
          isActive: true,
          version: source.version + 1,
          createdBy: options?.createdBy,
        },
      });

      return ok(cloned);
    },

    async hasActiveSessions(id: string): Promise<boolean> {
      const count = await prisma.researchSession.count({
        where: { scriptId: id },
      });
      return count > 0;
    },
  };
}
