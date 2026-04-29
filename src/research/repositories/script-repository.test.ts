/**
 * ProbeScript repository — unit tests with a mocked PrismaClient.
 *
 * Three levels:
 *   1. Logic — CRUD, clone, delete-with-sessions guard
 *   2. Filters — findAll with verticalSlug includes 'universal' scripts
 *   3. Integration — skipped (requires live DB)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProbeScript } from '@prisma/client';
import { $Enums } from '@prisma/client';
import { createScriptRepository } from './script-repository.js';
import type { CreateScriptInput, UpdateScriptInput } from './script-repository.js';

// ─── Mock helpers ─────────────────────────────────────────────────

function mockScript(overrides?: Partial<ProbeScript>): ProbeScript {
  const base: ProbeScript = {
    id: 'script-1',
    name: 'l1-onboarding-baseline',
    verticalSlug: 'universal',
    level: $Enums.ProbeLevel.L1_SURFACE,
    objective: 'Test onboarding flow',
    estimatedMinutes: 5,
    turns: [],
    waitMinMs: 3000,
    waitMaxMs: 8000,
    isOfficial: true,
    isActive: true,
    version: 1,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
  return { ...base, ...overrides };
}

function buildMockPrisma() {
  return {
    probeScript: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    researchSession: {
      count: vi.fn(),
    },
  };
}

// ─── Level 1: Logic ───────────────────────────────────────────────

describe('ScriptRepository — logic', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let repo: ReturnType<typeof createScriptRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createScriptRepository(prisma as unknown as Parameters<typeof createScriptRepository>[0]);
  });

  describe('findAll', () => {
    it('returns all scripts when no filter supplied', async () => {
      const scripts = [mockScript()];
      prisma.probeScript.findMany.mockResolvedValue(scripts);

      const result = await repo.findAll();

      expect(result).toEqual(scripts);
      expect(prisma.probeScript.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('injects OR clause to include universal scripts when verticalSlug is set', async () => {
      prisma.probeScript.findMany.mockResolvedValue([]);

      await repo.findAll({ verticalSlug: 'automotriz' });

      const calls = prisma.probeScript.findMany.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const call = (calls[0] as [Record<string, unknown>])[0];
      const where = call['where'] as Record<string, unknown>;
      expect(where['OR']).toEqual([
        { verticalSlug: 'automotriz' },
        { verticalSlug: 'universal' },
      ]);
    });

    it('applies level and isOfficial filters directly', async () => {
      prisma.probeScript.findMany.mockResolvedValue([]);

      await repo.findAll({ level: $Enums.ProbeLevel.L4_ADVERSARIAL, isOfficial: true });

      const levelCalls = prisma.probeScript.findMany.mock.calls;
      expect(levelCalls.length).toBeGreaterThan(0);
      const levelCall = (levelCalls[0] as [Record<string, unknown>])[0];
      const levelWhere = levelCall['where'] as Record<string, unknown>;
      expect(levelWhere['level']).toBe($Enums.ProbeLevel.L4_ADVERSARIAL);
      expect(levelWhere['isOfficial']).toBe(true);
    });
  });

  describe('findById', () => {
    it('returns the script when found', async () => {
      const script = mockScript();
      prisma.probeScript.findUnique.mockResolvedValue(script);

      const result = await repo.findById('script-1');

      expect(result).toEqual(script);
    });

    it('returns null when not found', async () => {
      prisma.probeScript.findUnique.mockResolvedValue(null);

      const result = await repo.findById('not-found');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('creates a script with defaults', async () => {
      const input: CreateScriptInput = {
        name: 'l2-auto-catalog',
        verticalSlug: 'automotriz',
        level: $Enums.ProbeLevel.L2_CAPABILITIES,
        objective: 'Test catalog navigation',
        estimatedMinutes: 10,
        turns: [{ order: 1, message: 'hola', waitForResponseMs: 15000, notes: 'onboarding' }],
      };
      const created = mockScript({ name: input.name, verticalSlug: input.verticalSlug, level: input.level as $Enums.ProbeLevel, id: 'new-id', isOfficial: false, version: 1 });
      prisma.probeScript.create.mockResolvedValue(created);

      const result = await repo.create(input);

      expect(result.isOfficial).toBe(false);
      expect(result.version).toBe(1);
      expect(prisma.probeScript.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            waitMinMs: 3000,
            waitMaxMs: 8000,
            version: 1,
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('returns ok with the updated script', async () => {
      const existing = mockScript({ version: 1 });
      const updated = mockScript({ version: 2, objective: 'Updated' });
      prisma.probeScript.findUnique.mockResolvedValue(existing);
      prisma.probeScript.update.mockResolvedValue(updated);

      const input: UpdateScriptInput = { objective: 'Updated' };
      const result = await repo.update('script-1', input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.version).toBe(2);
      }
    });

    it('returns err SCRIPT_INVALID when script not found', async () => {
      prisma.probeScript.findUnique.mockResolvedValue(null);

      const result = await repo.update('not-found', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('SCRIPT_INVALID');
      }
    });
  });

  describe('delete', () => {
    it('returns ok and deletes the script when no sessions', async () => {
      prisma.researchSession.count.mockResolvedValue(0);
      prisma.probeScript.delete.mockResolvedValue(mockScript());

      const result = await repo.delete('script-1');

      expect(result.ok).toBe(true);
      expect(prisma.probeScript.delete).toHaveBeenCalledWith({ where: { id: 'script-1' } });
    });

    it('returns err SCRIPT_INVALID when script has sessions', async () => {
      prisma.researchSession.count.mockResolvedValue(3);

      const result = await repo.delete('script-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('SCRIPT_INVALID');
      }
      expect(prisma.probeScript.delete).not.toHaveBeenCalled();
    });
  });

  describe('clone', () => {
    it('creates a copy with bumped version and isOfficial=false', async () => {
      const source = mockScript({ version: 2, isOfficial: true, name: 'l1-onboarding-baseline' });
      const cloned = mockScript({
        id: 'clone-id',
        name: 'l1-onboarding-baseline (copy)',
        version: 3,
        isOfficial: false,
      });
      prisma.probeScript.findUnique.mockResolvedValue(source);
      prisma.probeScript.create.mockResolvedValue(cloned);

      const result = await repo.clone('script-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.isOfficial).toBe(false);
        expect(result.value.version).toBe(3);
      }
      expect(prisma.probeScript.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'l1-onboarding-baseline (copy)',
            version: 3,
            isOfficial: false,
          }),
        }),
      );
    });

    it('uses overridden name when provided', async () => {
      const source = mockScript();
      prisma.probeScript.findUnique.mockResolvedValue(source);
      prisma.probeScript.create.mockResolvedValue(mockScript({ name: 'my-custom-script' }));

      await repo.clone('script-1', { name: 'my-custom-script' });

      expect(prisma.probeScript.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'my-custom-script' }),
        }),
      );
    });

    it('returns err SCRIPT_INVALID when source not found', async () => {
      prisma.probeScript.findUnique.mockResolvedValue(null);

      const result = await repo.clone('not-found');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('SCRIPT_INVALID');
      }
    });
  });

  describe('hasActiveSessions', () => {
    it('returns true when sessions exist', async () => {
      prisma.researchSession.count.mockResolvedValue(1);
      expect(await repo.hasActiveSessions('script-1')).toBe(true);
    });

    it('returns false when no sessions', async () => {
      prisma.researchSession.count.mockResolvedValue(0);
      expect(await repo.hasActiveSessions('script-1')).toBe(false);
    });
  });
});

// ─── Level 3: Integration (skipped without DB) ────────────────────

describe.skip('ScriptRepository — integration (requires DB)', () => {
  it('full CRUD + clone round-trip', () => {
    // Start a real Prisma client pointing to TEST_DATABASE_URL and run the
    // full create → update → clone → delete cycle. Skip in CI unless
    // DATABASE_URL points to the research-test schema.
  });
});
