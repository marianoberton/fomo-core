import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptPattern } from '@prisma/client';
import { createPatternRepository } from './pattern-repository.js';

function mockPattern(overrides?: Partial<PromptPattern>): PromptPattern {
  const base: PromptPattern = {
    id: 'pattern-1',
    verticalSlug: 'automotriz',
    category: 'onboarding',
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
  const txFns = {
    promptPattern: {
      create: vi.fn(),
    },
    promptPatternVersion: {
      aggregate: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  };

  return {
    promptPattern: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: typeof txFns) => Promise<unknown>) => fn(txFns)),
    _txFns: txFns,
  };
}

describe('PatternRepository — create', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternRepository(prisma as never);
  });

  it('creates pattern with initial version v1 via transaction', async () => {
    const pattern = mockPattern();
    prisma._txFns.promptPattern.create.mockResolvedValue(pattern);

    const result = await repo.create({
      verticalSlug: 'automotriz',
      category: 'onboarding',
      patternText: '¡Hola {{nombre}}! Soy {{agente_name}}.',
      patternVariables: ['nombre', 'agente_name'],
      seenInCount: 5,
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.status).toBe('pending');
    const createCall = prisma._txFns.promptPattern.create.mock.calls[0]?.[0] as {
      data: { versions: { create: { versionNumber: number; isCurrent: boolean } } };
    };
    expect(createCall.data.versions.create.versionNumber).toBe(1);
    expect(createCall.data.versions.create.isCurrent).toBe(true);
  });
});

describe('PatternRepository — approval flow', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternRepository(prisma as never);
  });

  it('markApproved sets status=approved', async () => {
    const pattern = mockPattern({ status: 'approved', approvedBy: 'admin@fomo.com' });
    prisma.promptPattern.update.mockResolvedValue(pattern);

    const result = await repo.markApproved('pattern-1' as never, 'admin@fomo.com');

    expect(result.status).toBe('approved');
    expect(prisma.promptPattern.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pattern-1' },
        data: expect.objectContaining({ status: 'approved', approvedBy: 'admin@fomo.com' }),
      }),
    );
  });

  it('markSuperseded sets status=superseded', async () => {
    const pattern = mockPattern({ status: 'superseded' });
    prisma.promptPattern.update.mockResolvedValue(pattern);

    const result = await repo.markSuperseded('pattern-1' as never);

    expect(result.status).toBe('superseded');
    expect(prisma.promptPattern.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'superseded' },
      }),
    );
  });
});

describe('PatternRepository — listByVertical', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createPatternRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createPatternRepository(prisma as never);
  });

  it('passes verticalSlug + optional filters to findMany', async () => {
    prisma.promptPattern.findMany.mockResolvedValue([]);

    await repo.listByVertical('automotriz', { category: 'onboarding', status: 'approved' });

    expect(prisma.promptPattern.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verticalSlug: 'automotriz',
          category: 'onboarding',
          status: 'approved',
        }),
      }),
    );
  });
});
