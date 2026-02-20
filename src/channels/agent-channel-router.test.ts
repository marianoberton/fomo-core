/**
 * Tests for the Agent-Channel Router.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentChannelRouter, checkChannelCollision } from './agent-channel-router.js';
import type { AgentConfig, AgentRepository, AgentId } from '@/agents/types.js';
import type { ProjectId } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mocks ──────────────────────────────────────────────────────

const mockLogger: { [K in keyof Logger]: ReturnType<typeof vi.fn> } = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

function createMockAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1' as AgentId,
    projectId: 'project-1' as ProjectId,
    name: 'test-agent',
    promptConfig: { identity: 'test', instructions: '', safety: '' },
    toolAllowlist: ['calculator'],
    mcpServers: [],
    channelConfig: { allowedChannels: [], defaultChannel: undefined },
    modes: [],
    limits: { maxTurns: 10, maxTokensPerTurn: 4000, budgetPerDayUsd: 10 },
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockRepository(agents: AgentConfig[]): { [K in keyof AgentRepository]: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn().mockResolvedValue(agents),
    listAll: vi.fn(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('createAgentChannelRouter', () => {
  describe('resolveAgent', () => {
    it('returns null when no agents exist', async () => {
      const repo = createMockRepository([]);
      const router = createAgentChannelRouter({ agentRepository: repo, logger: mockLogger });

      const result = await router.resolveAgent('project-1' as ProjectId, 'whatsapp');
      expect(result).toBeNull();
    });

    it('returns null when no agent has modes', async () => {
      const repo = createMockRepository([createMockAgent({ modes: [] })]);
      const router = createAgentChannelRouter({ agentRepository: repo, logger: mockLogger });

      const result = await router.resolveAgent('project-1' as ProjectId, 'whatsapp');
      expect(result).toBeNull();
    });

    it('resolves agent by broad channel match', async () => {
      const agent = createMockAgent({
        modes: [{
          name: 'public',
          channelMapping: ['whatsapp', 'telegram'],
          toolAllowlist: ['calculator'],
        }],
      });
      const repo = createMockRepository([agent]);
      const router = createAgentChannelRouter({ agentRepository: repo, logger: mockLogger });

      const result = await router.resolveAgent('project-1' as ProjectId, 'whatsapp');
      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('agent-1');
      expect(result?.mode.modeName).toBe('public');
    });

    it('resolves correct mode for dashboard channel', async () => {
      const agent = createMockAgent({
        modes: [
          { name: 'public', channelMapping: ['whatsapp'], toolAllowlist: ['calculator'] },
          { name: 'internal', channelMapping: ['dashboard', 'slack'], toolAllowlist: ['calculator', 'http-request'] },
        ],
      });
      const repo = createMockRepository([agent]);
      const router = createAgentChannelRouter({ agentRepository: repo, logger: mockLogger });

      const result = await router.resolveAgent('project-1' as ProjectId, 'dashboard');
      expect(result).not.toBeNull();
      expect(result?.mode.modeName).toBe('internal');
    });

    it('resolves agent with role-qualified channel', async () => {
      const agent = createMockAgent({
        modes: [
          { name: 'public', channelMapping: ['telegram'], toolAllowlist: ['calculator'] },
          { name: 'internal', channelMapping: ['telegram:owner', 'dashboard'], toolAllowlist: ['http-request'] },
        ],
      });
      const repo = createMockRepository([agent]);
      const router = createAgentChannelRouter({ agentRepository: repo, logger: mockLogger });

      // Owner on telegram → internal
      const result = await router.resolveAgent('project-1' as ProjectId, 'telegram', 'owner');
      expect(result).not.toBeNull();
      expect(result?.mode.modeName).toBe('internal');
    });

    it('returns null when channel is not claimed by any agent', async () => {
      const agent = createMockAgent({
        modes: [{ name: 'public', channelMapping: ['whatsapp'] }],
      });
      const repo = createMockRepository([agent]);
      const router = createAgentChannelRouter({ agentRepository: repo, logger: mockLogger });

      const result = await router.resolveAgent('project-1' as ProjectId, 'email');
      expect(result).toBeNull();
    });

    it('returns first matching agent when multiple agents exist', async () => {
      const agent1 = createMockAgent({
        id: 'agent-1' as AgentId,
        name: 'sales-agent',
        modes: [{ name: 'public', channelMapping: ['whatsapp'] }],
      });
      const agent2 = createMockAgent({
        id: 'agent-2' as AgentId,
        name: 'support-agent',
        modes: [{ name: 'public', channelMapping: ['telegram'] }],
      });
      const repo = createMockRepository([agent1, agent2]);
      const router = createAgentChannelRouter({ agentRepository: repo, logger: mockLogger });

      const result = await router.resolveAgent('project-1' as ProjectId, 'telegram');
      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('agent-2');
    });
  });
});

describe('checkChannelCollision', () => {
  let repo: { [K in keyof AgentRepository]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no collision', async () => {
    const existing = createMockAgent({
      id: 'agent-1' as AgentId,
      modes: [{ name: 'public', channelMapping: ['whatsapp'] }],
    });
    repo = createMockRepository([existing]);

    const result = await checkChannelCollision(
      repo, 'project-1', 'agent-2',
      [{ name: 'public', channelMapping: ['telegram'] }],
    );
    expect(result).toBeNull();
  });

  it('detects collision with existing agent', async () => {
    const existing = createMockAgent({
      id: 'agent-1' as AgentId,
      name: 'existing-agent',
      modes: [{ name: 'public', channelMapping: ['whatsapp', 'telegram'] }],
    });
    repo = createMockRepository([existing]);

    const result = await checkChannelCollision(
      repo, 'project-1', 'agent-2',
      [{ name: 'public', channelMapping: ['telegram'] }],
    );
    expect(result).not.toBeNull();
    expect(result?.agentName).toBe('existing-agent');
    expect(result?.channel).toBe('telegram');
  });

  it('skips self when updating', async () => {
    const self = createMockAgent({
      id: 'agent-1' as AgentId,
      modes: [{ name: 'public', channelMapping: ['whatsapp'] }],
    });
    repo = createMockRepository([self]);

    const result = await checkChannelCollision(
      repo, 'project-1', 'agent-1',
      [{ name: 'public', channelMapping: ['whatsapp'] }],
    );
    expect(result).toBeNull();
  });

  it('returns null when no modes', async () => {
    repo = createMockRepository([]);
    const result = await checkChannelCollision(repo, 'project-1', undefined, []);
    expect(result).toBeNull();
  });
});
