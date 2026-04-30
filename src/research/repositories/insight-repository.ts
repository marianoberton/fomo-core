/**
 * CRUD over `intelligence_insights`.
 */
import type { PrismaClient, IntelligenceInsight, InsightStatus } from '@prisma/client';
import type { IntelligenceInsightId } from '../types.js';

// ─── Input types ─────────────────────────────────────────────────

export interface CreateInsightInput {
  verticalSlug: string;
  category: string;
  title: string;
  content: string;
  evidence?: string;
  seenInCount?: number;
  /** Analysis IDs that sourced this insight. */
  sourceAnalysisIds?: string[];
}

export interface ListInsightsFilter {
  verticalSlug?: string;
  category?: string;
  /** If provided, only return insights with this status. */
  status?: InsightStatus;
}

// ─── Interface ───────────────────────────────────────────────────

export interface InsightRepository {
  create(data: CreateInsightInput): Promise<IntelligenceInsight>;
  findById(id: IntelligenceInsightId): Promise<IntelligenceInsight | null>;
  listByVertical(verticalSlug: string, filter?: { status?: InsightStatus }): Promise<IntelligenceInsight[]>;
  list(filter?: ListInsightsFilter): Promise<IntelligenceInsight[]>;
  markApproved(id: IntelligenceInsightId, approvedBy: string): Promise<IntelligenceInsight>;
  markRejected(id: IntelligenceInsightId, rejectedBy: string, reason?: string): Promise<IntelligenceInsight>;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createInsightRepository(prisma: PrismaClient): InsightRepository {
  return {
    async create(data) {
      const insight = await prisma.intelligenceInsight.create({
        data: {
          verticalSlug: data.verticalSlug,
          category: data.category,
          title: data.title,
          content: data.content,
          evidence: data.evidence,
          seenInCount: data.seenInCount ?? 1,
          status: 'pending',
          sources: data.sourceAnalysisIds?.length
            ? {
                create: data.sourceAnalysisIds.map((analysisId) => ({ analysisId })),
              }
            : undefined,
        },
      });
      return insight;
    },

    async findById(id) {
      return await prisma.intelligenceInsight.findUnique({ where: { id } });
    },

    async listByVertical(verticalSlug, filter = {}) {
      return await prisma.intelligenceInsight.findMany({
        where: {
          verticalSlug,
          ...(filter.status !== undefined && { status: filter.status }),
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    async list(filter = {}) {
      return await prisma.intelligenceInsight.findMany({
        where: {
          ...(filter.verticalSlug !== undefined && { verticalSlug: filter.verticalSlug }),
          ...(filter.category !== undefined && { category: filter.category }),
          ...(filter.status !== undefined && { status: filter.status }),
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    async markApproved(id, approvedBy) {
      return await prisma.intelligenceInsight.update({
        where: { id },
        data: {
          status: 'approved',
          approvedBy,
          approvedAt: new Date(),
        },
      });
    },

    async markRejected(id, rejectedBy, reason) {
      return await prisma.intelligenceInsight.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectedBy,
          rejectedAt: new Date(),
          ...(reason !== undefined && { rejectedReason: reason }),
        },
      });
    },
  };
}
