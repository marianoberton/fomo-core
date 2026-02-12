/**
 * E2E tests for error scenarios.
 * Verifies that the API returns correct error responses and status codes
 * for various failure conditions.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { ProjectId } from '@/core/types.js';
import type { Prisma } from '@prisma/client';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import { seedE2EProject } from './helpers.js';

// ─── Mock LLM Provider ──────────────────────────────────────────

interface MockResponse {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  usage?: { inputTokens: number; outputTokens: number };
}

const { createProviderMock, configureMock } = vi.hoisted(() => {
  let callResponses: MockResponse[] = [{ text: 'Default response.' }];

  const createMock = vi.fn(() => {
    let localCallIndex = 0;
    return {
      id: 'mock-provider',
      displayName: 'Mock Provider',
      chat: async function* () {
        const idx = Math.min(localCallIndex, callResponses.length - 1);
        const response = callResponses[idx];
        localCallIndex++;

        if (response?.text) {
          yield { type: 'content_delta' as const, text: response.text };
        }

        if (response?.toolCalls) {
          for (const tc of response.toolCalls) {
            yield { type: 'tool_use_start' as const, id: tc.id, name: tc.name };
            yield { type: 'tool_use_end' as const, id: tc.id, name: tc.name, input: tc.input };
          }
        }

        const stopReason = response?.toolCalls?.length ? 'tool_use' : 'end_turn';
        yield {
          type: 'message_end' as const,
          stopReason: stopReason as 'end_turn' | 'tool_use',
          usage: response?.usage ?? { inputTokens: 10, outputTokens: 5 },
        };
      },
      countTokens: async () => 100,
      getContextWindow: () => 200_000,
      supportsToolUse: () => true,
      formatTools: (tools: unknown[]) => tools,
      formatToolResult: (result: unknown) => result,
    };
  });

  return {
    createProviderMock: createMock,
    configureMock: (responses: MockResponse[]) => {
      callResponses = responses;
      createMock.mockClear();
    },
  };
});

vi.mock('@/providers/factory.js', () => ({
  createProvider: createProviderMock,
}));

// ─── Tests ─────────────────────────────────────────────────────

describe('Error Scenarios E2E', () => {
  let testDb: TestDatabase;
  let server: FastifyInstance;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server = await createTestServer({ prisma: testDb.prisma });
  });

  beforeEach(async () => {
    await testDb.reset();
    configureMock([{ text: 'Default response.' }]);
  });

  afterAll(async () => {
    await server.close();
    await testDb.disconnect();
  });

  // ─── API Validation Errors ───────────────────────────────────

  describe('Validation Errors', () => {
    it('returns 400 for invalid JSON body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/chat',
        headers: { 'content-type': 'application/json' },
        payload: 'not-json{',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for missing required fields in project create', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for name exceeding max length', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'x'.repeat(201), // max 200
          owner: 'user',
          config: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for chat with missing message', async () => {
      const { projectId } = await seedE2EProject(testDb);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: {
          projectId,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── Not Found Errors ────────────────────────────────────────

  describe('Not Found Errors', () => {
    it('returns 404 for non-existent project in GET', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/does-not-exist',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('does-not-exist');
    });

    it('returns 404 for non-existent project in PUT', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/projects/does-not-exist',
        payload: { name: 'New Name' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for non-existent session', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions/does-not-exist',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for messages of non-existent session', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions/does-not-exist/messages',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for non-existent project in chat', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: {
          projectId: 'non-existent',
          message: 'Hello',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 for non-existent session in chat', async () => {
      const { projectId } = await seedE2EProject(testDb);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: {
          projectId,
          sessionId: 'non-existent',
          message: 'Hello',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Chat Error Handling ─────────────────────────────────────

  describe('Chat Error Handling', () => {
    it('returns 400 when project has no active prompt layers', async () => {
      // Create project without prompt layers
      const projectId = nanoid() as ProjectId;
      await testDb.prisma.project.create({
        data: {
          id: projectId,
          name: 'No Prompts',
          owner: 'user',
          tags: [],
          configJson: {
            projectId,
            agentRole: 'assistant',
            provider: { provider: 'openai', model: 'gpt-4o-mini', apiKeyEnvVar: 'OPENAI_API_KEY' },
            failover: { onRateLimit: false, onServerError: false, onTimeout: false, timeoutMs: 30000, maxRetries: 0 },
            allowedTools: [],
            memoryConfig: {
              longTerm: { enabled: false, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'openai', decayEnabled: false, decayHalfLifeDays: 7 },
              contextWindow: { reserveTokens: 1000, pruningStrategy: 'turn-based', maxTurnsInContext: 20, compaction: { enabled: false, memoryFlushBeforeCompaction: false } },
            },
            costConfig: {
              dailyBudgetUSD: 100, monthlyBudgetUSD: 1000, maxTokensPerTurn: 4096, maxTurnsPerSession: 10,
              maxToolCallsPerTurn: 5, alertThresholdPercent: 80, hardLimitPercent: 100, maxRequestsPerMinute: 60, maxRequestsPerHour: 1000,
            },
            maxTurnsPerSession: 10,
            maxConcurrentSessions: 5,
          } as Prisma.InputJsonValue,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: {
          projectId,
          message: 'Hello',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload) as { error: { code: string } };
      expect(body.error.code).toBe('NO_ACTIVE_PROMPT');
    });

    it('handles tool that returns an error gracefully', async () => {
      const { projectId } = await seedE2EProject(testDb);

      // Mock provider requests a non-existent tool
      configureMock([
        {
          toolCalls: [{
            id: 'call-1',
            name: 'non-existent-tool',
            input: {},
          }],
        },
        {
          text: 'I could not use that tool.',
        },
      ]);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: {
          projectId,
          message: 'Do something',
        },
      });

      // The agent should handle tool hallucination and continue
      expect(response.statusCode).toBe(200);
    });

    it('respects max turns per session limit', async () => {
      const { projectId } = await seedE2EProject(testDb, {
        maxTurnsPerSession: 1,
        costConfig: {
          dailyBudgetUSD: 100,
          monthlyBudgetUSD: 1000,
          maxTokensPerTurn: 4096,
          maxTurnsPerSession: 1,
          maxToolCallsPerTurn: 5,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 60,
          maxRequestsPerHour: 1000,
        },
      });

      // Mock provider keeps requesting tool calls (forcing multiple turns)
      configureMock([
        {
          toolCalls: [{
            id: 'call-1',
            name: 'calculator',
            input: { expression: '1+1' },
          }],
        },
        {
          toolCalls: [{
            id: 'call-2',
            name: 'calculator',
            input: { expression: '2+2' },
          }],
        },
        {
          text: 'Done.',
        },
      ]);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: {
          projectId,
          message: 'Keep calculating',
        },
      });

      // Should still return 200 (agent completes with max_turns status)
      expect(response.statusCode).toBe(200);
    });
  });

  // ─── Response Envelope Structure ────────────────────────────

  describe('Response Envelope', () => {
    it('success responses have { success: true, data: ... } structure', async () => {
      const { projectId } = await seedE2EProject(testDb);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}`,
      });

      const body = JSON.parse(response.payload) as { success: boolean; data: unknown; error?: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.error).toBeUndefined();
    });

    it('error responses have { success: false, error: { code, message } } structure', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/does-not-exist',
      });

      const body = JSON.parse(response.payload) as {
        success: boolean;
        data?: unknown;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });
  });
});
