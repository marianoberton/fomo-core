import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntelligenceInsight } from '@prisma/client';
import { createInsightRepository } from './insight-repository.js';

function mockInsight(overrides?: Partial<IntelligenceInsight>): IntelligenceInsight {
  const base: IntelligenceInsight = {
    id: 'insight-1',
    verticalSlug: 'automotriz',
    category: 'onboarding',
    title: 'Los mejores saludan con nombre',
    content: 'El 70% de los agentes con score > 7 incluyen el nombre del asesor.',
    evidence: null,
    seenInCount: 5,
    status: 'pending',
    rejectedReason: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
  return { ...base, ...overrides };
}

function buildMockPrisma() {
  return {
    intelligenceInsight: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe('InsightRepository — create', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createInsightRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createInsightRepository(prisma as never);
  });

  it('creates insight with default status=pending', async () => {
    const insight = mockInsight();
    prisma.intelligenceInsight.create.mockResolvedValue(insight);

    const result = await repo.create({
      verticalSlug: 'automotriz',
      category: 'onboarding',
      title: 'Los mejores saludan con nombre',
      content: 'El 70% de los agentes con score > 7 incluyen el nombre del asesor.',
    });

    expect(result.status).toBe('pending');
    expect(prisma.intelligenceInsight.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', verticalSlug: 'automotriz' }),
      }),
    );
  });

  it('passes sourceAnalysisIds as nested create', async () => {
    const insight = mockInsight();
    prisma.intelligenceInsight.create.mockResolvedValue(insight);

    await repo.create({
      verticalSlug: 'automotriz',
      category: 'onboarding',
      title: 'Test',
      content: 'Content',
      sourceAnalysisIds: ['analysis-1', 'analysis-2'],
    });

    const call = prisma.intelligenceInsight.create.mock.calls[0]?.[0] as { data: { sources?: unknown } };
    expect(call.data.sources).toBeDefined();
  });
});

describe('InsightRepository — approval flow', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createInsightRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createInsightRepository(prisma as never);
  });

  it('markApproved sets status=approved + approvedBy', async () => {
    const insight = mockInsight({ status: 'approved', approvedBy: 'admin@fomo.com' });
    prisma.intelligenceInsight.update.mockResolvedValue(insight);

    const result = await repo.markApproved('insight-1' as never, 'admin@fomo.com');

    expect(result.status).toBe('approved');
    expect(prisma.intelligenceInsight.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'insight-1' },
        data: expect.objectContaining({ status: 'approved', approvedBy: 'admin@fomo.com' }),
      }),
    );
  });

  it('markRejected sets status=rejected + rejectedBy + reason', async () => {
    const insight = mockInsight({ status: 'rejected', rejectedBy: 'admin@fomo.com', rejectedReason: 'not actionable' });
    prisma.intelligenceInsight.update.mockResolvedValue(insight);

    const result = await repo.markRejected('insight-1' as never, 'admin@fomo.com', 'not actionable');

    expect(result.status).toBe('rejected');
    expect(prisma.intelligenceInsight.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          rejectedBy: 'admin@fomo.com',
          rejectedReason: 'not actionable',
        }),
      }),
    );
  });
});

describe('InsightRepository — listByVertical', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createInsightRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createInsightRepository(prisma as never);
  });

  it('filters by verticalSlug and status', async () => {
    prisma.intelligenceInsight.findMany.mockResolvedValue([]);

    await repo.listByVertical('automotriz', { status: 'approved' });

    expect(prisma.intelligenceInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ verticalSlug: 'automotriz', status: 'approved' }),
      }),
    );
  });

  it('omits status filter when not provided', async () => {
    prisma.intelligenceInsight.findMany.mockResolvedValue([]);

    await repo.listByVertical('automotriz');

    const call = prisma.intelligenceInsight.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where['status']).toBeUndefined();
  });
});
