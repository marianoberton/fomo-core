import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId, AgentConfig } from '@/core/types.js';
import { createProjectRepository } from './project-repository.js';

function makeConfig(): AgentConfig {
  return {
    projectId: 'proj_test' as ProjectId,
    agentRole: 'assistant',
    provider: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    failover: { onRateLimit: true, onServerError: true, onTimeout: true, timeoutMs: 30000, maxRetries: 2 },
    allowedTools: [],
    memoryConfig: {
      longTerm: { enabled: false, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'anthropic', decayEnabled: false, decayHalfLifeDays: 30 },
      contextWindow: { reserveTokens: 1000, pruningStrategy: 'turn-based', maxTurnsInContext: 20, compaction: { enabled: false, memoryFlushBeforeCompaction: false } },
    },
    costConfig: {
      dailyBudgetUSD: 10, monthlyBudgetUSD: 100, maxTokensPerTurn: 4096, maxTurnsPerSession: 50,
      maxToolCallsPerTurn: 5, alertThresholdPercent: 80, hardLimitPercent: 100,
      maxRequestsPerMinute: 60, maxRequestsPerHour: 1000,
    },
    maxTurnsPerSession: 50,
    maxConcurrentSessions: 5,
  };
}

const makePrismaRecord = (overrides?: Record<string, unknown>): Record<string, unknown> => {
  return {
    id: 'proj_abc',
    name: 'Test Project',
    description: 'A test project',
    environment: 'development',
    owner: 'admin',
    tags: ['test'],
    configJson: makeConfig(),
    status: 'active',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
};

function createMockPrisma(): PrismaClient {
  return {
    project: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('ProjectRepository', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a project and returns typed model', async () => {
      vi.mocked(mockPrisma.project.create).mockResolvedValue(makePrismaRecord() as never);

      const repo = createProjectRepository(mockPrisma);
      const project = await repo.create({
        name: 'Test Project',
        owner: 'admin',
        config: makeConfig(),
      });

      expect(project.id).toBe('proj_abc');
      expect(project.name).toBe('Test Project');
      expect(project.owner).toBe('admin');
      expect(project.status).toBe('active');
       
      expect(mockPrisma.project.create).toHaveBeenCalledOnce();
    });
  });

  describe('findById', () => {
    it('returns project when found', async () => {
      vi.mocked(mockPrisma.project.findUnique).mockResolvedValue(makePrismaRecord() as never);

      const repo = createProjectRepository(mockPrisma);
      const project = await repo.findById('proj_abc' as ProjectId);

      expect(project).not.toBeNull();
      expect(project?.name).toBe('Test Project');
    });

    it('returns null when not found', async () => {
      vi.mocked(mockPrisma.project.findUnique).mockResolvedValue(null as never);

      const repo = createProjectRepository(mockPrisma);
      const project = await repo.findById('nope' as ProjectId);

      expect(project).toBeNull();
    });
  });

  describe('update', () => {
    it('updates and returns the project', async () => {
      vi.mocked(mockPrisma.project.update).mockResolvedValue(
        makePrismaRecord({ name: 'Updated' }) as never,
      );

      const repo = createProjectRepository(mockPrisma);
      const result = await repo.update('proj_abc' as ProjectId, { name: 'Updated' });

      expect(result?.name).toBe('Updated');
    });

    it('returns null on error', async () => {
      vi.mocked(mockPrisma.project.update).mockRejectedValue(new Error('Not found'));

      const repo = createProjectRepository(mockPrisma);
      const result = await repo.update('nope' as ProjectId, { name: 'x' });

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true on success', async () => {
      vi.mocked(mockPrisma.project.delete).mockResolvedValue({} as never);

      const repo = createProjectRepository(mockPrisma);
      expect(await repo.delete('proj_abc' as ProjectId)).toBe(true);
    });

    it('returns false on error', async () => {
      vi.mocked(mockPrisma.project.delete).mockRejectedValue(new Error('Not found'));

      const repo = createProjectRepository(mockPrisma);
      expect(await repo.delete('nope' as ProjectId)).toBe(false);
    });
  });

  describe('list', () => {
    it('returns all projects', async () => {
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue([makePrismaRecord()] as never);

      const repo = createProjectRepository(mockPrisma);
      const projects = await repo.list();

      expect(projects).toHaveLength(1);
      expect(projects[0]?.name).toBe('Test Project');
    });

    it('applies filters', async () => {
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue([] as never);

      const repo = createProjectRepository(mockPrisma);
      await repo.list({ owner: 'admin', status: 'active' });

       
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ owner: 'admin', status: 'active' }) as unknown,
        }),
      );
    });
  });
});
