/**
 * INSERT-only tracking table for `prompt_pattern_uses`.
 *
 * Records when a PromptPattern version was inserted into an AgentTemplate
 * and tracks the outcome after 30-day evaluation.
 */
import type { PrismaClient, PromptPatternUse } from '@prisma/client';
import type { PromptPatternId, PromptPatternUseId } from '../types.js';

// ─── Input types ─────────────────────────────────────────────────

export type PatternOutcome = 'improved' | 'neutral' | 'regressed';

export interface CreatePatternUseInput {
  patternId: PromptPatternId;
  patternVersionId: string;
  agentTemplateSlug: string;
  insertedBy?: string;
  scoreAtInsertion?: number;
}

export interface UpdatePatternUseOutcomeInput {
  scoreAfter: number;
  outcome: PatternOutcome;
}

export interface OutcomeCount {
  outcome: PatternOutcome;
  count: number;
}

// ─── Interface ───────────────────────────────────────────────────

export interface PatternUseRepository {
  create(data: CreatePatternUseInput): Promise<PromptPatternUse>;
  findById(id: PromptPatternUseId): Promise<PromptPatternUse | null>;
  listByPattern(patternId: PromptPatternId): Promise<PromptPatternUse[]>;
  /** Update outcome after 30-day evaluation. */
  updateOutcome(id: PromptPatternUseId, data: UpdatePatternUseOutcomeInput): Promise<PromptPatternUse>;
  /** Count uses by outcome for a given pattern (for auto-supersede logic). */
  countByOutcome(patternId: PromptPatternId): Promise<OutcomeCount[]>;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createPatternUseRepository(prisma: PrismaClient): PatternUseRepository {
  return {
    async create(data) {
      return await prisma.promptPatternUse.create({
        data: {
          patternId: data.patternId,
          patternVersionId: data.patternVersionId,
          agentTemplateSlug: data.agentTemplateSlug,
          insertedBy: data.insertedBy,
          scoreAtInsertion: data.scoreAtInsertion,
        },
      });
    },

    async findById(id) {
      return await prisma.promptPatternUse.findUnique({ where: { id } });
    },

    async listByPattern(patternId) {
      return await prisma.promptPatternUse.findMany({
        where: { patternId },
        orderBy: { insertedAt: 'desc' },
      });
    },

    async updateOutcome(id, data) {
      return await prisma.promptPatternUse.update({
        where: { id },
        data: {
          scoreAfter: data.scoreAfter,
          outcome: data.outcome,
        },
      });
    },

    async countByOutcome(patternId) {
      const uses = await prisma.promptPatternUse.findMany({
        where: {
          patternId,
          outcome: { not: null },
        },
        select: { outcome: true },
      });

      const counts: Record<string, number> = {};
      for (const u of uses) {
        if (u.outcome) {
          counts[u.outcome] = (counts[u.outcome] ?? 0) + 1;
        }
      }

      return (['improved', 'neutral', 'regressed'] as PatternOutcome[]).map((outcome) => ({
        outcome,
        count: counts[outcome] ?? 0,
      }));
    },
  };
}
