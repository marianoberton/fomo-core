import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjectId, PromptLayerId } from '@/core/types.js';
import { createPromptLayerRepository, type PromptLayerRepository } from './prompt-layer-repository.js';

// ─── Mock Prisma ─────────────────────────────────────────────────

const createMockPrisma = (): {
  promptLayer: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
} => {
  return {
    promptLayer: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
};

// ─── Tests ──────────────────────────────────────────────────────

describe('PromptLayerRepository', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let repo: PromptLayerRepository;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
     
    repo = createPromptLayerRepository(mockPrisma as never);
  });

  describe('create', () => {
    it('auto-increments version for the same project+layerType', async () => {
      mockPrisma.promptLayer.findFirst.mockResolvedValue({ version: 3 });
      mockPrisma.promptLayer.create.mockResolvedValue({
        id: 'pl-1',
        projectId: 'proj-1',
        layerType: 'identity',
        version: 4,
        content: 'Test content',
        isActive: false,
        createdAt: new Date(),
        createdBy: 'user',
        changeReason: 'test',
        performanceNotes: null,
        metadata: null,
      });

      const result = await repo.create({
        projectId: 'proj-1' as ProjectId,
        layerType: 'identity',
        content: 'Test content',
        createdBy: 'user',
        changeReason: 'test',
      });

      expect(result.version).toBe(4);
      expect(result.isActive).toBe(false);
    });

    it('starts at version 1 when no layers exist', async () => {
      mockPrisma.promptLayer.findFirst.mockResolvedValue(null);
      mockPrisma.promptLayer.create.mockResolvedValue({
        id: 'pl-1',
        projectId: 'proj-1',
        layerType: 'safety',
        version: 1,
        content: 'Safety rules',
        isActive: false,
        createdAt: new Date(),
        createdBy: 'user',
        changeReason: 'initial',
        performanceNotes: null,
        metadata: null,
      });

      const result = await repo.create({
        projectId: 'proj-1' as ProjectId,
        layerType: 'safety',
        content: 'Safety rules',
        createdBy: 'user',
        changeReason: 'initial',
      });

      expect(result.version).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns a layer when found', async () => {
      mockPrisma.promptLayer.findUnique.mockResolvedValue({
        id: 'pl-1',
        projectId: 'proj-1',
        layerType: 'identity',
        version: 1,
        content: 'content',
        isActive: true,
        createdAt: new Date(),
        createdBy: 'user',
        changeReason: 'test',
        performanceNotes: null,
        metadata: null,
      });

      const result = await repo.findById('pl-1' as PromptLayerId);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('pl-1');
    });

    it('returns null when not found', async () => {
      mockPrisma.promptLayer.findUnique.mockResolvedValue(null);

      const result = await repo.findById('missing' as PromptLayerId);
      expect(result).toBeNull();
    });
  });

  describe('getActiveLayer', () => {
    it('returns the active layer for a project+type', async () => {
      mockPrisma.promptLayer.findFirst.mockResolvedValue({
        id: 'pl-1',
        projectId: 'proj-1',
        layerType: 'instructions',
        version: 2,
        content: 'instructions content',
        isActive: true,
        createdAt: new Date(),
        createdBy: 'user',
        changeReason: 'update',
        performanceNotes: null,
        metadata: null,
      });

      const result = await repo.getActiveLayer('proj-1' as ProjectId, 'instructions');
      expect(result).not.toBeNull();
      expect(result?.isActive).toBe(true);
      expect(result?.layerType).toBe('instructions');
    });

    it('returns null when no active layer exists', async () => {
      mockPrisma.promptLayer.findFirst.mockResolvedValue(null);

      const result = await repo.getActiveLayer('proj-1' as ProjectId, 'identity');
      expect(result).toBeNull();
    });
  });

  describe('activate', () => {
    it('deactivates others and activates target in a transaction', async () => {
      mockPrisma.promptLayer.findUnique.mockResolvedValue({
        projectId: 'proj-1',
        layerType: 'identity',
      });
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);

      const result = await repo.activate('pl-1' as PromptLayerId);
      expect(result).toBe(true);
       
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('returns false when layer not found', async () => {
      mockPrisma.promptLayer.findUnique.mockResolvedValue(null);

      const result = await repo.activate('missing' as PromptLayerId);
      expect(result).toBe(false);
    });

    it('returns false on transaction error', async () => {
      mockPrisma.promptLayer.findUnique.mockResolvedValue({
        projectId: 'proj-1',
        layerType: 'identity',
      });
      mockPrisma.$transaction.mockRejectedValue(new Error('DB error'));

      const result = await repo.activate('pl-1' as PromptLayerId);
      expect(result).toBe(false);
    });
  });

  describe('listByProject', () => {
    it('lists all layers for a project', async () => {
      mockPrisma.promptLayer.findMany.mockResolvedValue([
        {
          id: 'pl-1',
          projectId: 'proj-1',
          layerType: 'identity',
          version: 1,
          content: 'v1',
          isActive: false,
          createdAt: new Date(),
          createdBy: 'user',
          changeReason: 'first',
          performanceNotes: null,
          metadata: null,
        },
      ]);

      const result = await repo.listByProject('proj-1' as ProjectId);
      expect(result).toHaveLength(1);
    });

    it('filters by layerType when provided', async () => {
      mockPrisma.promptLayer.findMany.mockResolvedValue([]);

      await repo.listByProject('proj-1' as ProjectId, 'safety');

       
      expect(mockPrisma.promptLayer.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', layerType: 'safety' },
        orderBy: { version: 'desc' },
      });
    });

    it('does not filter by layerType when omitted', async () => {
      mockPrisma.promptLayer.findMany.mockResolvedValue([]);

      await repo.listByProject('proj-1' as ProjectId);

       
      expect(mockPrisma.promptLayer.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        orderBy: { version: 'desc' },
      });
    });
  });
});
