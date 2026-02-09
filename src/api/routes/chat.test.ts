/**
 * Tests for the POST /chat route.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { chatRoutes } from './chat.js';
import { registerErrorHandler } from '../error-handler.js';
import { prepareChatRun } from './chat-setup.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { AgentRunner } from '@/core/agent-runner.js';
import { ok, err } from '@/core/result.js';
import { NexusError } from '@/core/errors.js';
import type { SessionId, TraceId } from '@/core/types.js';
import type { ApiResponse } from '../types.js';
import {
  createMockDeps,
  createSamplePromptSnapshot,
  createSampleTrace,
} from '@/testing/fixtures/routes.js';
import { createTestAgentConfig } from '@/testing/fixtures/context.js';
import type { ChatSetupResult } from './chat-setup.js';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('./chat-setup.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./chat-setup.js')>();
  return {
    ...mod,
    prepareChatRun: vi.fn(),
  };
});

vi.mock('@/core/agent-runner.js', () => ({
  createAgentRunner: vi.fn(),
}));

const mockPrepareChatRun = vi.mocked(prepareChatRun);
const mockCreateAgentRunner = vi.mocked(createAgentRunner);

// ─── Helpers ────────────────────────────────────────────────────

type MockDeps = ReturnType<typeof createMockDeps>;

function createApp(): { app: FastifyInstance; deps: MockDeps } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  chatRoutes(app, deps);
  return { app, deps };
}

function createSetupResult(overrides?: Partial<ChatSetupResult>): ChatSetupResult {
  return {
    sanitizedMessage: 'Hello',
    agentConfig: createTestAgentConfig(),
    sessionId: 'sess-1' as SessionId,
    systemPrompt: 'You are a helpful assistant.',
    promptSnapshot: createSamplePromptSnapshot(),
    conversationHistory: [],
    provider: {
      chat: vi.fn(),
      countTokens: vi.fn(),
      formatTools: vi.fn(),
    } as unknown as ChatSetupResult['provider'],
    memoryManager: {
      fitToContextWindow: vi.fn(),
      retrieveMemories: vi.fn(),
    } as unknown as ChatSetupResult['memoryManager'],
    costGuard: {
      precheck: vi.fn(),
      recordUsage: vi.fn(),
    } as unknown as ChatSetupResult['costGuard'],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('POST /chat', () => {
  let app: FastifyInstance;
  let deps: MockDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    const created = createApp();
    app = created.app;
    deps = created.deps;
  });

  it('returns 200 with response on successful run', async () => {
    const setup = createSetupResult();
    mockPrepareChatRun.mockResolvedValue(ok(setup));

    const trace = createSampleTrace({
      id: 'trace-1' as TraceId,
      sessionId: 'sess-1' as SessionId,
      events: [
        {
          id: 'ev-1',
          traceId: 'trace-1' as TraceId,
          type: 'llm_response',
          timestamp: new Date(),
          durationMs: 100,
          data: { text: 'Hi there!' },
        },
      ],
      totalTokensUsed: 150,
      totalCostUSD: 0.005,
    });

    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApiResponse<{
      sessionId: string;
      traceId: string;
      response: string;
    }>;
    expect(body.success).toBe(true);
    expect(body.data?.sessionId).toBe('sess-1');
    expect(body.data?.traceId).toBe('trace-1');
    expect(body.data?.response).toBe('Hi there!');
  });

  it('returns 400 on invalid request body (missing message)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on invalid request body (missing projectId)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on empty request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns error when prepareChatRun fails (project not found)', async () => {
    mockPrepareChatRun.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Project "proj-1" not found', statusCode: 404 }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns error when prepareChatRun fails (no active prompt)', async () => {
    mockPrepareChatRun.mockResolvedValue(
      err({ code: 'NO_ACTIVE_PROMPT', message: 'No active prompt', statusCode: 400 }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NO_ACTIVE_PROMPT');
  });

  it('returns error when agent run fails', async () => {
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const nexusErr = new NexusError({
      message: 'Budget exceeded',
      code: 'BUDGET_EXCEEDED',
      statusCode: 429,
    });
    const mockRun = vi.fn().mockResolvedValue(err(nexusErr));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('BUDGET_EXCEEDED');
  });

  it('persists user and assistant messages to session', async () => {
    const setup = createSetupResult();
    mockPrepareChatRun.mockResolvedValue(ok(setup));

    const trace = createSampleTrace({
      id: 'trace-1' as TraceId,
      events: [
        {
          id: 'ev-1',
          traceId: 'trace-1' as TraceId,
          type: 'llm_response',
          timestamp: new Date(),
          durationMs: 100,
          data: { text: 'Response text' },
        },
      ],
    });

    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

     
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledTimes(2);

     
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledWith(
      'sess-1',
      { role: 'user', content: 'Hello' },
      'trace-1',
    );

     
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledWith(
      'sess-1',
      { role: 'assistant', content: 'Response text' },
      'trace-1',
    );
  });

  it('extracts tool calls from trace events', async () => {
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const trace = createSampleTrace({
      events: [
        {
          id: 'ev-1',
          traceId: 'trace-1' as TraceId,
          type: 'tool_call',
          timestamp: new Date(),
          durationMs: 0,
          data: { toolCallId: 'tc-1', toolId: 'calculator', input: { expression: '2+2' } },
        },
        {
          id: 'ev-2',
          traceId: 'trace-1' as TraceId,
          type: 'tool_result',
          timestamp: new Date(),
          durationMs: 10,
          data: { toolCallId: 'tc-1', toolId: 'calculator', output: '4' },
        },
        {
          id: 'ev-3',
          traceId: 'trace-1' as TraceId,
          type: 'llm_response',
          timestamp: new Date(),
          durationMs: 100,
          data: { text: 'The answer is 4' },
        },
      ],
    });

    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'What is 2+2?' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApiResponse<{
      toolCalls: { toolId: string; input: Record<string, unknown>; result: unknown }[];
    }>;
    expect(body.data?.toolCalls).toHaveLength(1);
    expect(body.data?.toolCalls[0]?.toolId).toBe('calculator');
    expect(body.data?.toolCalls[0]?.result).toBe('4');
  });

  it('creates agent runner with correct options', async () => {
    const setup = createSetupResult();
    mockPrepareChatRun.mockResolvedValue(ok(setup));

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

    expect(mockCreateAgentRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: setup.provider,
        toolRegistry: deps.toolRegistry,
        memoryManager: setup.memoryManager,
        costGuard: setup.costGuard,
      }),
    );
  });

  it('passes conversation history and sessionId to agent runner', async () => {
    const setup = createSetupResult({
      sessionId: 'sess-42' as SessionId,
      conversationHistory: [{ role: 'user', content: 'Previous message' }],
    });
    mockPrepareChatRun.mockResolvedValue(ok(setup));

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Hello',
        sessionId: 'sess-42',
        conversationHistory: [{ role: 'user', content: 'Previous message' }],
      }),
    );
  });

  it('returns empty response when no llm_response events', async () => {
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const trace = createSampleTrace({ events: [] });
    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { projectId: 'proj-1', message: 'Hello' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApiResponse<{ response: string }>;
    expect(body.data?.response).toBe('');
  });
});
