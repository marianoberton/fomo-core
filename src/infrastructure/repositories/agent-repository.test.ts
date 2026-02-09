/**
 * Agent Repository Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentRepository } from './agent-repository.js';
import type { AgentRepository, CreateAgentInput, AgentId } from '@/agents/types.js';

// ─── Mock Prisma ─────────────────────────────────────────────────

const mockPrismaAgent = {
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findMany: vi.fn(),
};

const mockPrisma = {
  agent: mockPrismaAgent,
} as unknown as import('@prisma/client').PrismaClient;

// ─── Mock Data ───────────────────────────────────────────────────

const mockAgentRecord = {
  id: 'agent-1',
  projectId: 'project-1',
  name: 'test-agent',
  description: 'A test agent',
  promptConfig: {
    identity: 'You are a test agent',
    instructions: 'Do testing things',
    safety: 'Be safe',
  },
  toolAllowlist: ['tool-1', 'tool-2'],
  mcpServers: [{ name: 'mcp-1', command: 'run' }],
  channelConfig: {
    allowedChannels: ['whatsapp'],
    defaultChannel: 'whatsapp',
  },
  maxTurns: 10,
  maxTokensPerTurn: 4000,
  budgetPerDayUsd: 10.0,
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const createInput: CreateAgentInput = {
  projectId: 'project-1',
  name: 'test-agent',
  description: 'A test agent',
  promptConfig: {
    identity: 'You are a test agent',
    instructions: 'Do testing things',
    safety: 'Be safe',
  },
  toolAllowlist: ['tool-1', 'tool-2'],
  mcpServers: [{ name: 'mcp-1', command: 'run' }],
  channelConfig: {
    allowedChannels: ['whatsapp'],
    defaultChannel: 'whatsapp',
  },
  limits: {
    maxTurns: 10,
    maxTokensPerTurn: 4000,
    budgetPerDayUsd: 10.0,
  },
};

// ─── Tests ───────────────────────────────────────────────────────

describe('AgentRepository', () => {
  let repository: AgentRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = createAgentRepository(mockPrisma);
  });

  describe('create', () => {
    it('should create an agent with all fields', async () => {
      mockPrismaAgent.create.mockResolvedValue(mockAgentRecord);

      const result = await repository.create(createInput);

      expect(mockPrismaAgent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'project-1',
          name: 'test-agent',
          description: 'A test agent',
          status: 'active',
        }),
      });

      expect(result).toMatchObject({
        id: 'agent-1',
        projectId: 'project-1',
        name: 'test-agent',
        status: 'active',
      });
    });

    it('should use default values when limits not provided', async () => {
      mockPrismaAgent.create.mockResolvedValue(mockAgentRecord);

      const inputWithoutLimits: CreateAgentInput = {
        projectId: 'project-1',
        name: 'minimal-agent',
        promptConfig: {
          identity: 'Test',
          instructions: 'Test',
          safety: 'Test',
        },
      };

      await repository.create(inputWithoutLimits);

      expect(mockPrismaAgent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          maxTurns: 10,
          maxTokensPerTurn: 4000,
          budgetPerDayUsd: 10.0,
        }),
      });
    });
  });

  describe('findById', () => {
    it('should return agent when found', async () => {
      mockPrismaAgent.findUnique.mockResolvedValue(mockAgentRecord);

      const result = await repository.findById('agent-1' as AgentId);

      expect(mockPrismaAgent.findUnique).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
      });
      expect(result).toMatchObject({
        id: 'agent-1',
        name: 'test-agent',
      });
    });

    it('should return null when not found', async () => {
      mockPrismaAgent.findUnique.mockResolvedValue(null);

      const result = await repository.findById('non-existent' as AgentId);

      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('should find agent by project and name', async () => {
      mockPrismaAgent.findUnique.mockResolvedValue(mockAgentRecord);

      const result = await repository.findByName('project-1', 'test-agent');

      expect(mockPrismaAgent.findUnique).toHaveBeenCalledWith({
        where: {
          projectId_name: { projectId: 'project-1', name: 'test-agent' },
        },
      });
      expect(result).toMatchObject({
        name: 'test-agent',
        projectId: 'project-1',
      });
    });
  });

  describe('update', () => {
    it('should update agent with provided fields', async () => {
      mockPrismaAgent.update.mockResolvedValue({
        ...mockAgentRecord,
        name: 'updated-agent',
        status: 'paused',
      });

      const result = await repository.update('agent-1' as AgentId, {
        name: 'updated-agent',
        status: 'paused',
      });

      expect(mockPrismaAgent.update).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
        data: expect.objectContaining({
          name: 'updated-agent',
          status: 'paused',
        }),
      });
      expect(result.name).toBe('updated-agent');
      expect(result.status).toBe('paused');
    });

    it('should update limits individually', async () => {
      mockPrismaAgent.update.mockResolvedValue({
        ...mockAgentRecord,
        maxTurns: 20,
      });

      await repository.update('agent-1' as AgentId, {
        limits: { maxTurns: 20 },
      });

      expect(mockPrismaAgent.update).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
        data: expect.objectContaining({
          maxTurns: 20,
        }),
      });
    });
  });

  describe('delete', () => {
    it('should delete agent', async () => {
      mockPrismaAgent.delete.mockResolvedValue(mockAgentRecord);

      await repository.delete('agent-1' as AgentId);

      expect(mockPrismaAgent.delete).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
      });
    });
  });

  describe('list', () => {
    it('should list all agents in project', async () => {
      mockPrismaAgent.findMany.mockResolvedValue([mockAgentRecord]);

      const result = await repository.list('project-1');

      expect(mockPrismaAgent.findMany).toHaveBeenCalledWith({
        where: { projectId: 'project-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('listActive', () => {
    it('should list only active agents', async () => {
      mockPrismaAgent.findMany.mockResolvedValue([mockAgentRecord]);

      const result = await repository.listActive('project-1');

      expect(mockPrismaAgent.findMany).toHaveBeenCalledWith({
        where: { projectId: 'project-1', status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('mapping', () => {
    it('should map null values to undefined', async () => {
      mockPrismaAgent.findUnique.mockResolvedValue({
        ...mockAgentRecord,
        description: null,
        mcpServers: null,
        channelConfig: null,
      });

      const result = await repository.findById('agent-1' as AgentId);

      expect(result?.description).toBeUndefined();
      expect(result?.mcpServers).toEqual([]);
      expect(result?.channelConfig).toEqual({
        allowedChannels: [],
        defaultChannel: undefined,
      });
    });
  });
});
