import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { toolRoutes } from './tools.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

const mockTool = {
  id: 'calculator',
  name: 'Calculator',
  description: 'Performs math',
  category: 'utility',
  riskLevel: 'low' as const,
  requiresApproval: false,
  sideEffects: false,
  supportsDryRun: true,
  inputSchema: z.object({ expression: z.string() }),
  outputSchema: z.object({ result: z.number() }),
};

function createApp(): { app: FastifyInstance; deps: ReturnType<typeof createMockDeps> } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  toolRoutes(app, deps);
  return { app, deps };
}

describe('toolRoutes', () => {
  describe('GET /tools', () => {
    it('returns tool catalog with JSON schemas', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.listAll.mockReturnValue(['calculator']);
      deps.toolRegistry.get.mockReturnValue(mockTool);

      const response = await app.inject({ method: 'GET', url: '/tools' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: unknown[] }>();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);

      const entry = body.data[0] as Record<string, unknown>;
      expect(entry['id']).toBe('calculator');
      expect(entry['name']).toBe('Calculator');
      expect(entry['category']).toBe('utility');
      expect(entry['riskLevel']).toBe('low');
      expect(entry['requiresApproval']).toBe(false);
      expect(entry['sideEffects']).toBe(false);
      expect(entry['supportsDryRun']).toBe(true);
      expect(entry).toHaveProperty('inputSchema');
      expect(entry).toHaveProperty('outputSchema');
    });

    it('returns empty array when no tools are registered', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.listAll.mockReturnValue([]);

      const response = await app.inject({ method: 'GET', url: '/tools' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: unknown[] }>();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('GET /tools/categories', () => {
    it('groups tools by category', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.listAll.mockReturnValue(['calculator']);
      deps.toolRegistry.get.mockReturnValue(mockTool);

      const response = await app.inject({ method: 'GET', url: '/tools/categories' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { category: string; tools: unknown[] }[] }>();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.category).toBe('utility');
      expect(body.data[0]?.tools).toHaveLength(1);
    });

    it('sorts categories alphabetically', async () => {
      const { app, deps } = createApp();
      const searchTool = { ...mockTool, id: 'search', category: 'search' };

      deps.toolRegistry.listAll.mockReturnValue(['calculator', 'search']);
      deps.toolRegistry.get
        .mockReturnValueOnce(mockTool)
        .mockReturnValueOnce(searchTool);

      const response = await app.inject({ method: 'GET', url: '/tools/categories' });
      const body = response.json<{ success: boolean; data: { category: string }[] }>();

      expect(body.data.map((c) => c.category)).toEqual(['search', 'utility']);
    });
  });

  describe('GET /tools/:id', () => {
    it('returns tool info with schemas', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.get.mockReturnValue(mockTool);

      const response = await app.inject({ method: 'GET', url: '/tools/calculator' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
      expect(body.success).toBe(true);
      expect(body.data['id']).toBe('calculator');
      expect(body.data['name']).toBe('Calculator');
      expect(body.data).toHaveProperty('inputSchema');
      expect(body.data).toHaveProperty('outputSchema');
    });

    it('returns 404 when tool is not found', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.get.mockReturnValue(undefined);

      const response = await app.inject({ method: 'GET', url: '/tools/nonexistent' });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ success: boolean; error: { code: string; message: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('nonexistent');
    });
  });

  describe('GET /agents/:agentId/tools', () => {
    it('returns enabled and disabled tool IDs for an agent', async () => {
      const { app, deps } = createApp();
      const mockAgent = {
        id: 'agent1',
        projectId: 'proj1',
        name: 'Test Agent',
        toolAllowlist: ['calculator'],
        promptConfig: { identity: '', instructions: '', safety: '' },
        mcpServers: [],
        channelConfig: { allowedChannels: [], defaultChannel: undefined },
        limits: { maxTurns: 10, maxTokensPerTurn: 4000, budgetPerDayUsd: 10 },
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      deps.agentRepository.findById.mockResolvedValue(mockAgent);
      deps.toolRegistry.listAll.mockReturnValue(['calculator', 'search']);
      deps.toolRegistry.get.mockImplementation((id: string) =>
        id === 'calculator' ? mockTool : undefined,
      );

      const response = await app.inject({ method: 'GET', url: '/agents/agent1/tools' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        data: { agentId: string; enabledTools: unknown[]; disabledToolIds: string[] };
      }>();
      expect(body.success).toBe(true);
      expect(body.data.agentId).toBe('agent1');
      expect(body.data.enabledTools).toHaveLength(1);
      expect(body.data.disabledToolIds).toEqual(['search']);
    });

    it('returns 404 when agent not found', async () => {
      const { app, deps } = createApp();
      deps.agentRepository.findById.mockResolvedValue(null);

      const response = await app.inject({ method: 'GET', url: '/agents/unknown/tools' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /agents/:agentId/tools', () => {
    it('updates tool allowlist for an agent', async () => {
      const { app, deps } = createApp();
      const mockAgent = {
        id: 'agent1',
        projectId: 'proj1',
        name: 'Test Agent',
        toolAllowlist: ['calculator'],
        promptConfig: { identity: '', instructions: '', safety: '' },
        mcpServers: [],
        channelConfig: { allowedChannels: [], defaultChannel: undefined },
        limits: { maxTurns: 10, maxTokensPerTurn: 4000, budgetPerDayUsd: 10 },
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      deps.agentRepository.findById.mockResolvedValue(mockAgent);
      deps.agentRepository.update.mockResolvedValue({
        ...mockAgent,
        toolAllowlist: ['calculator'],
      });
      deps.toolRegistry.has.mockImplementation((id: string) => id === 'calculator');

      const response = await app.inject({
        method: 'PUT',
        url: '/agents/agent1/tools',
        payload: { tools: ['calculator'] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        data: { agentId: string; toolAllowlist: string[] };
      }>();
      expect(body.success).toBe(true);
      expect(body.data.toolAllowlist).toEqual(['calculator']);
    });

    it('rejects unknown tool IDs', async () => {
      const { app, deps } = createApp();
      const mockAgent = {
        id: 'agent1',
        projectId: 'proj1',
        name: 'Test Agent',
        toolAllowlist: [],
        promptConfig: { identity: '', instructions: '', safety: '' },
        mcpServers: [],
        channelConfig: { allowedChannels: [], defaultChannel: undefined },
        limits: { maxTurns: 10, maxTokensPerTurn: 4000, budgetPerDayUsd: 10 },
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      deps.agentRepository.findById.mockResolvedValue(mockAgent);
      deps.toolRegistry.has.mockReturnValue(false);

      const response = await app.inject({
        method: 'PUT',
        url: '/agents/agent1/tools',
        payload: { tools: ['nonexistent-tool'] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { error: string } }>();
      expect(body.data.error).toBe('UNKNOWN_TOOLS');
    });

    it('returns 404 when agent not found', async () => {
      const { app, deps } = createApp();
      deps.agentRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PUT',
        url: '/agents/agent1/tools',
        payload: { tools: [] },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});

// Suppress unused import
void vi;
