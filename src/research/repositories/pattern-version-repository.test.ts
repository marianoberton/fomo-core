import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptPatternVersion } from '@prisma/client';
import { createPatternVersionRepository } from './pattern-version-repository.js';

function mockVersion(overrides?: Partial<PromptPatternVersion>): PromptPatternVersion {
  const base: PromptPatternVersion = {
    id: 'ppv-1',
    patternId: 'pattern-1',
    versionNumber: 1,
    patternText: '¡Hola {{nombre}}!',
    patternVariables: ['nombre'],
    seenInCount: 3,
    avgScoreWhen: 8.1,
    notes: null,
    isCurrent: true,
    editedBy: null,
    createdAt: new Date('2026-01-01'),
  };
  return { ...base, ...overrides };
}

function buildMockPrisma() {
  const txFns = {
    promptPatternVersion: {
      aggregate: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  };

  return {
    promptPatternVersion: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: typeof txFns) => Promise<unknown>) => fn(txFns)),
    _txFns: txFns,
  };
}

describe('PatternVersionRepository — create', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternVersionRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternVersionRepository(prisma as never);
  });

  it('auto-bumps versionNumber from max existing', async () => {
    prisma._txFns.promptPatternVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 2 } });
    prisma._txFns.promptPatternVersion.updateMany.mockResolvedValue({ count: 1 });
    const v3 = mockVersion({ versionNumber: 3, isCurrent: true });
    prisma._txFns.promptPatternVersion.create.mockResolvedValue(v3);

    const result = await repo.create({
      patternId: 'pattern-1' as never,
      patternText: 'Updated text',
    });

    expect(result.versionNumber).toBe(3);
    expect(prisma._txFns.promptPatternVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNumber: 3, isCurrent: true }),
      }),
    );
  });

  it('starts at v1 when no previous versions exist', async () => {
    prisma._txFns.promptPatternVersion.aggregate.mockResolvedValue({ _max: { versionNumber: null } });
    prisma._txFns.promptPatternVersion.updateMany.mockResolvedValue({ count: 0 });
    const v1 = mockVersion({ versionNumber: 1 });
    prisma._txFns.promptPatternVersion.create.mockResolvedValue(v1);

    const result = await repo.create({
      patternId: 'pattern-1' as never,
      patternText: 'Initial text',
    });

    expect(result.versionNumber).toBe(1);
  });

  it('marks previous current version as not-current', async () => {
    prisma._txFns.promptPatternVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 1 } });
    prisma._txFns.promptPatternVersion.updateMany.mockResolvedValue({ count: 1 });
    prisma._txFns.promptPatternVersion.create.mockResolvedValue(mockVersion({ versionNumber: 2 }));

    await repo.create({ patternId: 'pattern-1' as never, patternText: 'v2 text' });

    expect(prisma._txFns.promptPatternVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patternId: 'pattern-1', isCurrent: true },
        data: { isCurrent: false },
      }),
    );
  });
});

describe('PatternVersionRepository — findCurrent', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternVersionRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternVersionRepository(prisma as never);
  });

  it('queries with isCurrent=true', async () => {
    const v = mockVersion();
    prisma.promptPatternVersion.findFirst.mockResolvedValue(v);

    const result = await repo.findCurrent('pattern-1' as never);

    expect(result).toBe(v);
    expect(prisma.promptPatternVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patternId: 'pattern-1', isCurrent: true } }),
    );
  });
});
