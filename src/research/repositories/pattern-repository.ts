/**
 * CRUD over `prompt_patterns`.
 *
 * Patterns hold metadata only — the actual text lives in `PromptPatternVersion`.
 * Creating a pattern atomically creates its first version (delegated to the
 * caller via patternVersionRepository, or inline via the `createWithVersion`
 * helper exported here).
 */
import type { PrismaClient, PromptPattern, PatternStatus } from '@prisma/client';
import type { PromptPatternId } from '../types.js';

// ─── Input types ─────────────────────────────────────────────────

export interface CreatePatternInput {
  verticalSlug: string;
  category: string;
  /** Initial version text — creates PromptPatternVersion v1 inline. */
  patternText: string;
  patternVariables?: string[];
  seenInCount?: number;
  avgScoreWhen?: number;
  notes?: string;
  /** Analysis IDs that sourced this pattern. */
  sourceAnalysisIds?: string[];
}

export interface ListPatternsFilter {
  verticalSlug?: string;
  category?: string;
  status?: PatternStatus;
}

// ─── Interface ───────────────────────────────────────────────────

export interface PatternRepository {
  /** Create pattern + first version (v1, isCurrent=true) atomically. */
  create(data: CreatePatternInput): Promise<PromptPattern>;
  findById(id: PromptPatternId): Promise<PromptPattern | null>;
  listByVertical(verticalSlug: string, filter?: { category?: string; status?: PatternStatus }): Promise<PromptPattern[]>;
  list(filter?: ListPatternsFilter): Promise<PromptPattern[]>;
  markApproved(id: PromptPatternId, approvedBy: string): Promise<PromptPattern>;
  markRejected(id: PromptPatternId, rejectedBy: string, reason?: string): Promise<PromptPattern>;
  markSuperseded(id: PromptPatternId): Promise<PromptPattern>;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createPatternRepository(prisma: PrismaClient): PatternRepository {
  return {
    async create(data) {
      return await prisma.$transaction(async (tx) => {
        const pattern = await tx.promptPattern.create({
          data: {
            verticalSlug: data.verticalSlug,
            category: data.category,
            status: 'pending',
            versions: {
              create: {
                versionNumber: 1,
                patternText: data.patternText,
                patternVariables: data.patternVariables ?? [],
                seenInCount: data.seenInCount ?? 1,
                avgScoreWhen: data.avgScoreWhen,
                notes: data.notes,
                isCurrent: true,
              },
            },
            sources: data.sourceAnalysisIds?.length
              ? {
                  create: data.sourceAnalysisIds.map((analysisId) => ({ analysisId })),
                }
              : undefined,
          },
        });
        return pattern;
      });
    },

    async findById(id) {
      return await prisma.promptPattern.findUnique({ where: { id } });
    },

    async listByVertical(verticalSlug, filter = {}) {
      return await prisma.promptPattern.findMany({
        where: {
          verticalSlug,
          ...(filter.category !== undefined && { category: filter.category }),
          ...(filter.status !== undefined && { status: filter.status }),
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    async list(filter = {}) {
      return await prisma.promptPattern.findMany({
        where: {
          ...(filter.verticalSlug !== undefined && { verticalSlug: filter.verticalSlug }),
          ...(filter.category !== undefined && { category: filter.category }),
          ...(filter.status !== undefined && { status: filter.status }),
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    async markApproved(id, approvedBy) {
      return await prisma.promptPattern.update({
        where: { id },
        data: {
          status: 'approved',
          approvedBy,
          approvedAt: new Date(),
        },
      });
    },

    async markRejected(id, rejectedBy, reason) {
      return await prisma.promptPattern.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectedBy,
          rejectedAt: new Date(),
          ...(reason !== undefined && { rejectedReason: reason }),
        },
      });
    },

    async markSuperseded(id) {
      return await prisma.promptPattern.update({
        where: { id },
        data: { status: 'superseded' },
      });
    },
  };
}
