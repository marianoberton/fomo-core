/**
 * Tests for the agent mode resolver.
 */
import { describe, it, expect } from 'vitest';
import type { AgentConfig, AgentMode, AgentId } from './types.js';
import type { ProjectId } from '@/core/types.js';
import { resolveAgentMode } from './mode-resolver.js';

// ─── Helpers ────────────────────────────────────────────────────

function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1' as AgentId,
    projectId: 'project-1' as ProjectId,
    name: 'test-agent',
    promptConfig: {
      identity: 'You are a test agent',
      instructions: 'Do things',
      safety: 'Be safe',
    },
    toolAllowlist: ['calculator', 'date-time'],
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

function createMode(overrides: Partial<AgentMode> = {}): AgentMode {
  return {
    name: 'public',
    channelMapping: ['whatsapp', 'telegram'],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('resolveAgentMode', () => {
  describe('when agent has no modes', () => {
    it('returns base config with modeName "base"', () => {
      const agent = createAgent({ modes: [] });
      const result = resolveAgentMode(agent, 'whatsapp');

      expect(result.modeName).toBe('base');
      expect(result.toolAllowlist).toEqual(['calculator', 'date-time']);
      expect(result.promptOverrides).toBeUndefined();
      expect(result.mcpServerNames).toEqual([]);
    });
  });

  describe('when source channel matches a mode', () => {
    it('returns the matching mode', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp', 'telegram'],
            toolAllowlist: ['calculator'],
          }),
          createMode({
            name: 'internal',
            channelMapping: ['dashboard', 'slack'],
            toolAllowlist: ['calculator', 'date-time', 'http-request'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'whatsapp');
      expect(result.modeName).toBe('public');
      expect(result.toolAllowlist).toEqual(['calculator']);
    });

    it('returns internal mode for dashboard channel', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp'],
          }),
          createMode({
            name: 'internal',
            channelMapping: ['dashboard'],
            toolAllowlist: ['http-request', 'web-search'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'dashboard');
      expect(result.modeName).toBe('internal');
      expect(result.toolAllowlist).toEqual(['http-request', 'web-search']);
    });
  });

  describe('when mode has no toolAllowlist', () => {
    it('inherits from agent base toolAllowlist', () => {
      const agent = createAgent({
        toolAllowlist: ['calculator', 'date-time'],
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp'],
            // No toolAllowlist — should inherit
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'whatsapp');
      expect(result.modeName).toBe('public');
      expect(result.toolAllowlist).toEqual(['calculator', 'date-time']);
    });

    it('inherits when toolAllowlist is empty array', () => {
      const agent = createAgent({
        toolAllowlist: ['calculator'],
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp'],
            toolAllowlist: [],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'whatsapp');
      expect(result.toolAllowlist).toEqual(['calculator']);
    });
  });

  describe('when no mode matches the channel', () => {
    it('returns base config', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'email');
      expect(result.modeName).toBe('base');
      expect(result.toolAllowlist).toEqual(['calculator', 'date-time']);
    });
  });

  describe('role-qualified channel matching', () => {
    it('matches "telegram:owner" when contactRole is "owner"', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['telegram'],
            toolAllowlist: ['calculator'],
          }),
          createMode({
            name: 'internal',
            channelMapping: ['telegram:owner', 'dashboard'],
            toolAllowlist: ['calculator', 'http-request', 'web-search'],
          }),
        ],
      });

      // Regular customer on telegram → public mode (broad "telegram" match)
      const resultCustomer = resolveAgentMode(agent, 'telegram');
      expect(resultCustomer.modeName).toBe('public');

      // Owner on telegram → internal mode (role-qualified "telegram:owner" beats broad "telegram")
      const resultOwner = resolveAgentMode(agent, 'telegram', 'owner');
      expect(resultOwner.modeName).toBe('internal');
    });

    it('does not match role-qualified when no contactRole provided', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'internal',
            channelMapping: ['telegram:owner'],
            toolAllowlist: ['http-request'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'telegram');
      expect(result.modeName).toBe('base');
    });
  });

  describe('exact channel ID matching', () => {
    it('matches specific Slack channel IDs', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['slack'],
            toolAllowlist: ['calculator'],
          }),
          createMode({
            name: 'internal',
            channelMapping: ['slack:C05ABCDEF'],
            toolAllowlist: ['http-request', 'web-search'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'slack:C05ABCDEF');
      expect(result.modeName).toBe('internal');
    });
  });

  describe('prompt overrides', () => {
    it('returns prompt overrides from the matched mode', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp'],
            promptOverrides: {
              instructions: 'Only answer customer questions. Be polite.',
            },
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'whatsapp');
      expect(result.promptOverrides).toEqual({
        instructions: 'Only answer customer questions. Be polite.',
      });
    });

    it('returns undefined promptOverrides when mode has none', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'whatsapp');
      expect(result.promptOverrides).toBeUndefined();
    });
  });

  describe('MCP server names', () => {
    it('returns mcpServerNames from matched mode', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'internal',
            channelMapping: ['dashboard'],
            mcpServerNames: ['odoo-erp', 'google-workspace'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'dashboard');
      expect(result.mcpServerNames).toEqual(['odoo-erp', 'google-workspace']);
    });

    it('returns empty mcpServerNames when mode has none', () => {
      const agent = createAgent({
        modes: [
          createMode({
            name: 'public',
            channelMapping: ['whatsapp'],
          }),
        ],
      });

      const result = resolveAgentMode(agent, 'whatsapp');
      expect(result.mcpServerNames).toEqual([]);
    });
  });
});
