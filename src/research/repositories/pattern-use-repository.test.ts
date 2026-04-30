import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptPatternUse } from '@prisma/client';
import { createPatternUseRepository } from './pattern-use-repository.js';

function mockUse(overrides?: Partial<PromptPatternUse>): PromptPatternUse {
  const base: PromptPatternUse = {
    id: 'use-1',
    patternId: 'pattern-1',
    patternVersionId: 'ppv-1',
    agentTemplateSlug: 'customer-support',
    insertedAt: new Date('2026-01-01'),
    insertedBy: 'admin@fomo.com',
    scoreAtInsertion: 7.2,
    scoreAfter: null,
    outcome: null,
  };
  return { ...base, ...overrides };
}

function buildMockPrisma() {
  return {
    promptPatternUse: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe('PatternUseRepository — create', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternUseRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternUseRepository(prisma as never);
  });

  it('creates use with expected fields', async () => {
    const use = mockUse();
    prisma.promptPatternUse.create.mockResolvedValue(use);

    const result = await repo.create({
      patternId: 'pattern-1' as never,
      patternVersionId: 'ppv-1',
      agentTemplateSlug: 'customer-support',
      insertedBy: 'admin@fomo.com',
      scoreAtInsertion: 7.2,
    });

    expect(result.patternId).toBe('pattern-1');
    expect(prisma.promptPatternUse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patternId: 'pattern-1',
          patternVersionId: 'ppv-1',
          agentTemplateSlug: 'customer-support',
        }),
      }),
    );
  });
});

describe('PatternUseRepository — updateOutcome', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternUseRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternUseRepository(prisma as never);
  });

  it('sets scoreAfter and outcome', async () => {
    const use = mockUse({ scoreAfter: 8.5, outcome: 'improved' });
    prisma.promptPatternUse.update.mockResolvedValue(use);

    const result = await repo.updateOutcome('use-1' as never, { scoreAfter: 8.5, outcome: 'improved' });

    expect(result.outcome).toBe('improved');
    expect(prisma.promptPatternUse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { scoreAfter: 8.5, outcome: 'improved' },
      }),
    );
  });
});

describe('PatternUseRepository — countByOutcome', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternUseRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternUseRepository(prisma as never);
  });

  it('counts outcomes correctly', async () => {
    prisma.promptPatternUse.findMany.mockResolvedValue([
      { outcome: 'improved' },
      { outcome: 'improved' },
      { outcome: 'regressed' },
    ]);

    const counts = await repo.countByOutcome('pattern-1' as never);

    const improved = counts.find((c) => c.outcome === 'improved');
    const regressed = counts.find((c) => c.outcome === 'regressed');
    const neutral = counts.find((c) => c.outcome === 'neutral');

    expect(improved?.count).toBe(2);
    expect(regressed?.count).toBe(1);
    expect(neutral?.count).toBe(0);
  });
});
