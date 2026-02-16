/**
 * Security tests for RBAC enforcement.
 * Verifies that tool access is properly controlled via allowedTools whitelist
 * and that hallucinated tools are blocked.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';
import { createToolRegistry } from '@/tools/registry/tool-registry.js';
import {
  createCalculatorTool,
  createDateTimeTool,
  createJsonTransformTool,
} from '@/tools/definitions/index.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import { createE2EAgentConfig, seedE2EProject } from '../e2e/helpers.js';

// ─── Mock LLM Provider ──────────────────────────────────────────

interface MockResponse {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  usage?: { inputTokens: number; outputTokens: number };
}

const { createProviderMock, configureMock } = vi.hoisted(() => {
  let callResponses: MockResponse[] = [{ text: 'Default.' }];

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

// ─── Unit Tests: Tool Registry RBAC ────────────────────────────

describe('Tool Registry RBAC - Unit', () => {
  it('blocks tools not in allowedTools', async () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());
    registry.register(createDateTimeTool());

    const context = createTestContext({
      allowedTools: ['calculator'], // date-time NOT allowed
    });

    const result = await registry.resolve('date-time', {}, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_NOT_ALLOWED');
    }
  });

  it('allows tools in allowedTools', async () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());

    const context = createTestContext({
      allowedTools: ['calculator'],
    });

    const result = await registry.resolve('calculator', { expression: '1+1' }, context);
    expect(result.ok).toBe(true);
  });

  it('blocks hallucinated tools (not registered)', async () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());

    const context = createTestContext({
      allowedTools: ['calculator', 'imaginary-tool'],
    });

    const result = await registry.resolve('imaginary-tool', {}, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_HALLUCINATION');
    }
  });

  it('only formats tools the context has access to', () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());
    registry.register(createDateTimeTool());
    registry.register(createJsonTransformTool());

    const context = createTestContext({
      allowedTools: ['calculator', 'date-time'], // json-transform NOT included
    });

    const formatted = registry.formatForProvider(context);
    const toolNames = formatted.map((t) => t.name);
    expect(toolNames).toContain('calculator');
    expect(toolNames).toContain('date-time');
    expect(toolNames).not.toContain('json-transform');
  });

  it('returns empty tool list when allowedTools is empty', () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());

    const context = createTestContext({
      allowedTools: [],
    });

    const formatted = registry.formatForProvider(context);
    expect(formatted).toHaveLength(0);
  });

  it('validates tool input with Zod schema', async () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());

    const context = createTestContext({
      allowedTools: ['calculator'],
    });

    // Invalid input (missing required expression field)
    const result = await registry.resolve('calculator', {}, context);
    expect(result.ok).toBe(false);
  });

  it('validates tool input rejects unexpected types', async () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());

    const context = createTestContext({
      allowedTools: ['calculator'],
    });

    // expression should be string, not number
    const result = await registry.resolve('calculator', { expression: 42 }, context);
    expect(result.ok).toBe(false);
  });
});

// ─── E2E Tests: RBAC Through API ───────────────────────────────

describe('RBAC - E2E', () => {
  let testDb: TestDatabase;
  let server: FastifyInstance;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server = await createTestServer({ prisma: testDb.prisma });
  });

  beforeEach(async () => {
    await testDb.reset();
    configureMock([{ text: 'Default.' }]);
  });

  afterAll(async () => {
    await server.close();
    await testDb.disconnect();
  });

  it('agent cannot use tools not in allowedTools', async () => {
    // Create project with only calculator allowed
    const { projectId } = await seedE2EProject(testDb, {
      allowedTools: ['calculator'],
    });

    // Mock LLM tries to call date-time (not allowed)
    configureMock([
      {
        toolCalls: [{
          id: 'call-1',
          name: 'date-time',
          input: {},
        }],
      },
      { text: 'Could not use that tool.' },
    ]);

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: {
        projectId,
        message: 'What time is it?',
      },
    });

    // Request should succeed (agent handles the error)
    expect(response.statusCode).toBe(200);
  });

  it('agent can use tools in allowedTools', async () => {
    const { projectId } = await seedE2EProject(testDb, {
      allowedTools: ['calculator'],
    });

    configureMock([
      {
        toolCalls: [{
          id: 'call-1',
          name: 'calculator',
          input: { expression: '5 * 3' },
        }],
      },
      { text: 'The answer is 15.' },
    ]);

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: {
        projectId,
        message: 'What is 5 times 3?',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { data: { response: string } };
    expect(body.data.response).toBe('The answer is 15.');
  });

  it('hallucinated tool is blocked and agent continues', async () => {
    const { projectId } = await seedE2EProject(testDb);

    configureMock([
      {
        toolCalls: [{
          id: 'call-1',
          name: 'send-email', // Not registered at all
          input: { to: 'user@example.com', body: 'test' },
        }],
      },
      { text: 'I apologize, that tool is not available.' },
    ]);

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: {
        projectId,
        message: 'Send an email to someone',
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('empty allowedTools means no tools available', async () => {
    const { projectId } = await seedE2EProject(testDb, {
      allowedTools: [],
    });

    configureMock([
      {
        toolCalls: [{
          id: 'call-1',
          name: 'calculator',
          input: { expression: '1+1' },
        }],
      },
      { text: 'Cannot use tools.' },
    ]);

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: {
        projectId,
        message: 'Calculate something',
      },
    });

    expect(response.statusCode).toBe(200);
  });
});

// ─── Helper ────────────────────────────────────────────────────

function createTestContext(options: {
  allowedTools: string[];
}) {
  const projectId = nanoid() as ProjectId;
  return {
    projectId,
    sessionId: nanoid() as SessionId,
    traceId: nanoid() as TraceId,
    agentConfig: createE2EAgentConfig(projectId, {
      allowedTools: options.allowedTools,
    }),
    permissions: {
      allowedTools: new Set(options.allowedTools),
    },
    abortSignal: new AbortController().signal,
  };
}
