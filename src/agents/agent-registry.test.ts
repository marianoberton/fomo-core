/**
 * Agent Registry Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentRegistry } from './agent-registry.js';
import type { AgentConfig, AgentRepository, AgentId, AgentRegistry } from './types.js';
import type { ProjectId } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mock Data ───────────────────────────────────────────────────

const mockAgent: AgentConfig = {
  id: 'agent-1' as AgentId,
  projectId: 'project-1' as ProjectId,
  name: 'test-agent',
  description: 'A test agent',
  promptConfig: {
    identity: 'You are a test agent',
    instructions: 'Do testing things',
    safety: 'Be safe',
  },
  toolAllowlist: ['tool-1', 'tool-2'],
  mcpServers: [],
  channelConfig: {
    allowedChannels: ['whatsapp'],
    defaultChannel: 'whatsapp',
  },
  limits: {
    maxTurns: 10,
    maxTokensPerTurn: 4000,
    budgetPerDayUsd: 10.0,
  },
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ─── Mock Repository ─────────────────────────────────────────────

function createMockRepository(): AgentRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
  };
}

// ─── Mock Logger ─────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('AgentRegistry', () => {
  let mockRepository: AgentRepository;
  let mockLogger: Logger;
  let registry: AgentRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRepository = createMockRepository();
    mockLogger = createMockLogger();
    registry = createAgentRegistry({
      agentRepository: mockRepository,
      logger: mockLogger,
      cacheTtlMs: 1000, // 1 second for testing
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('should fetch from repository on cache miss', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      const result = await registry.get('agent-1' as AgentId);

      expect(result).toEqual(mockAgent);
       
      expect(mockRepository.findById).toHaveBeenCalledWith('agent-1');
       
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Agent cache miss, fetching from repository',
        expect.objectContaining({
          component: 'agent-registry',
          agentId: 'agent-1',
        }),
      );
    });

    it('should return cached value on cache hit', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      // First call - cache miss
      await registry.get('agent-1' as AgentId);

      // Second call - should hit cache
      const result = await registry.get('agent-1' as AgentId);

      expect(result).toEqual(mockAgent);
       
      expect(mockRepository.findById).toHaveBeenCalledTimes(1);
       
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Agent cache hit',
        expect.objectContaining({
          component: 'agent-registry',
          agentId: 'agent-1',
        }),
      );
    });

    it('should refetch after cache expires', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      // First call
      await registry.get('agent-1' as AgentId);

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      // Second call - cache expired
      await registry.get('agent-1' as AgentId);

       
      expect(mockRepository.findById).toHaveBeenCalledTimes(2);
    });

    it('should return null for non-existent agent', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(null);

      const result = await registry.get('non-existent' as AgentId);

      expect(result).toBeNull();
    });
  });

  describe('getByName', () => {
    it('should fetch from repository on cache miss', async () => {
      vi.mocked(mockRepository.findByName).mockResolvedValue(mockAgent);

      const result = await registry.getByName('project-1', 'test-agent');

      expect(result).toEqual(mockAgent);
       
      expect(mockRepository.findByName).toHaveBeenCalledWith('project-1', 'test-agent');
    });

    it('should return cached value when searching by name', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      // First call by ID - populates cache
      await registry.get('agent-1' as AgentId);

      // Second call by name - should find in cache
      const result = await registry.getByName('project-1', 'test-agent');

      expect(result).toEqual(mockAgent);
       
      expect(mockRepository.findByName).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should always call repository (no caching for list)', async () => {
      const agents = [mockAgent];
      vi.mocked(mockRepository.list).mockResolvedValue(agents);

      const result = await registry.list('project-1');

      expect(result).toEqual(agents);
       
      expect(mockRepository.list).toHaveBeenCalledWith('project-1');
    });
  });

  describe('refresh', () => {
    it('should invalidate cache and refetch', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      // Populate cache
      await registry.get('agent-1' as AgentId);

      // Refresh
      await registry.refresh('agent-1' as AgentId);

       
      expect(mockRepository.findById).toHaveBeenCalledTimes(2);
       
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Refreshing agent cache',
        expect.objectContaining({
          component: 'agent-registry',
          agentId: 'agent-1',
        }),
      );
    });
  });

  describe('invalidate', () => {
    it('should remove agent from cache', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      // Populate cache
      await registry.get('agent-1' as AgentId);

      // Invalidate
      registry.invalidate('agent-1' as AgentId);

      // Next get should fetch from repository
      await registry.get('agent-1' as AgentId);

       
      expect(mockRepository.findById).toHaveBeenCalledTimes(2);
       
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Invalidating agent cache',
        expect.objectContaining({
          component: 'agent-registry',
          agentId: 'agent-1',
        }),
      );
    });
  });
});
