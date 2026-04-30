/**
 * CRUD over `prompt_pattern_versions`.
 *
 * Version creation is atomic: bumps versionNumber, sets isCurrent=true on
 * the new row, sets isCurrent=false on all previous versions — in a single
 * Prisma transaction.
 */
import type { PrismaClient, PromptPatternVersion } from '@prisma/client';
import type { PromptPatternId, PromptPatternVersionId } from '../types.js';

// ─── Input types ─────────────────────────────────────────────────

export interface CreatePatternVersionInput {
  patternId: PromptPatternId;
  patternText: string;
  patternVariables?: string[];
  seenInCount?: number;
  avgScoreWhen?: number;
  notes?: string;
  editedBy?: string;
}

// ─── Interface ───────────────────────────────────────────────────

export interface PatternVersionRepository {
  /**
   * Create a new version for a pattern.
   *
   * Auto-computes `versionNumber = max(existing) + 1`.
   * Sets `isCurrent=true` on the new version and `isCurrent=false` on all
   * previous versions — atomically via Prisma transaction.
   */
  create(data: CreatePatternVersionInput): Promise<PromptPatternVersion>;

  findById(id: PromptPatternVersionId): Promise<PromptPatternVersion | null>;

  /** Return the version with `isCurrent=true` for a pattern (or null). */
  findCurrent(patternId: PromptPatternId): Promise<PromptPatternVersion | null>;

  /** All versions for a pattern ordered by versionNumber asc. */
  listByPattern(patternId: PromptPatternId): Promise<PromptPatternVersion[]>;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createPatternVersionRepository(prisma: PrismaClient): PatternVersionRepository {
  return {
    async create(data) {
      return await prisma.$transaction(async (tx) => {
        // Compute next version number
        const agg = await tx.promptPatternVersion.aggregate({
          where: { patternId: data.patternId },
          _max: { versionNumber: true },
        });
        const nextVersion = (agg._max.versionNumber ?? 0) + 1;

        // Unset isCurrent on all previous versions
        await tx.promptPatternVersion.updateMany({
          where: { patternId: data.patternId, isCurrent: true },
          data: { isCurrent: false },
        });

        // Create the new current version
        return await tx.promptPatternVersion.create({
          data: {
            patternId: data.patternId,
            versionNumber: nextVersion,
            patternText: data.patternText,
            patternVariables: data.patternVariables ?? [],
            seenInCount: data.seenInCount ?? 1,
            avgScoreWhen: data.avgScoreWhen,
            notes: data.notes,
            editedBy: data.editedBy,
            isCurrent: true,
          },
        });
      });
    },

    async findById(id) {
      return await prisma.promptPatternVersion.findUnique({ where: { id } });
    },

    async findCurrent(patternId) {
      return await prisma.promptPatternVersion.findFirst({
        where: { patternId, isCurrent: true },
      });
    },

    async listByPattern(patternId) {
      return await prisma.promptPatternVersion.findMany({
        where: { patternId },
        orderBy: { versionNumber: 'asc' },
      });
    },
  };
}
