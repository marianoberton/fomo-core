/**
 * Tests for POST /agents/:agentId/invoke endpoint.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { agentRoutes } from '@/api/routes/agents.js';
import { registerErrorHandler } from '@/api/error-handler.js';
import { prepareChatRun } from '@/api/routes/chat-setup.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { AgentRunner } from '@/core/agent-runner.js';
import { ok, err } from '@/core/result.js';
import { NexusError } from '@/core/errors.js';
import type { SessionId, TraceId } from '@/core/types.js';
import type { ApiResponse } from '@/api/types.js';
import type { AgentConfig, AgentId } from '@/agents/types.js';
import {
  createMockDeps,
  createSampleTrace,
} from '@/testing/fixtures/routes.js';
import type { ChatSetupResult } from '@/api/routes/chat-setup.js';
import { createTestAgentConfig } from '@/testing/fixtures/context.js';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('@/api/routes/chat-setup.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/routes/chat-setup.js')>();
  return {
    ...mod,
    prepareChatRun: vi.fn(),
  };
});

vi.mock('@/core/agent-runner.js', () => ({
  createAgentRunner: vi.fn(),
}));

vi.mock('@/channels/agent-channel-router.js', () => ({
  checkChannelCollision: vi.fn().mockResolvedValue(null),
}));

const mockPrepareChatRun = vi.mocked(prepareChatRun);
const mockCreateAgentRunner = vi.mocked(createAgentRunner);

// ─── Helpers ────────────────────────────────────────────────────

type MockDeps = ReturnType<typeof createMockDeps>;

function createApp(): { app: FastifyInstance; deps: MockDeps } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  agentRoutes(app, deps);
  return { app, deps };
}

function createMockAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'agent-1' as AgentId,
    projectId: 'proj-1' as unknown as AgentConfig['projectId'],
    name: 'Test Agent',
    promptConfig: { identity: 'You are helpful', instructions: 'Help', safety: 'Be safe' },
    toolAllowlist: [],
    mcpServers: [],
    channelConfig: { allowedChannels: [] },
    modes: [],
    type: 'conversational',
    skillIds: [],
    limits: { maxTurns: 10, maxTokensPerTurn: 4096, budgetPerDayUsd: 10 },
    status: 'active',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as AgentConfig;
}

function createSetupResult(overrides?: Partial<ChatSetupResult>): ChatSetupResult {
  return {
    sanitizedMessage: 'Hello',
    agentConfig: createTestAgentConfig(),
    sessionId: 'sess-1' as SessionId,
    systemPrompt: 'You are a helpful assistant.',
    promptSnapshot: {
      identityLayerId: 'pl-1' as never,
      identityVersion: 1,
      instructionsLayerId: 'pl-2' as never,
      instructionsVersion: 1,
      safetyLayerId: 'pl-3' as never,
      safetyVersion: 1,
      toolDocsHash: 'abc',
      runtimeContextHash: 'def',
    },
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

describe('POST /agents/:agentId/invoke', () => {
  let app: FastifyInstance;
  let deps: MockDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    const created = createApp();
    app = created.app;
    deps = created.deps;
  });

  it('returns 200 with response on successful invoke', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

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
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApiResponse<{
      agentId: string;
      sessionId: string;
      traceId: string;
      response: string;
      timestamp: string;
    }>;
    expect(body.success).toBe(true);
    expect(body.data?.agentId).toBe('agent-1');
    expect(body.data?.sessionId).toBe('sess-1');
    expect(body.data?.traceId).toBe('trace-1');
    expect(body.data?.response).toBe('Hi there!');
    expect(body.data?.timestamp).toBeDefined();
    expect(new Date(body.data!.timestamp).toISOString()).toBe(body.data!.timestamp);
  });

  it('returns 400 when message is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when message is empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: { message: '' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when agent does not exist', async () => {
    deps.agentRegistry.get.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/agents/nonexistent/invoke',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 409 when agent is paused', async () => {
    const agent = createMockAgent({ status: 'paused' });
    deps.agentRegistry.get.mockResolvedValue(agent);

    const response = await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AGENT_NOT_ACTIVE');
  });

  it('returns 409 when agent is disabled', async () => {
    const agent = createMockAgent({ status: 'disabled' });
    deps.agentRegistry.get.mockResolvedValue(agent);

    const response = await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AGENT_NOT_ACTIVE');
  });

  it('returns error when prepareChatRun fails', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

    mockPrepareChatRun.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Project not found', statusCode: 404 }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns error when agent run fails with NexusError', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

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
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body) as ApiResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('BUDGET_EXCEEDED');
  });

  it('persists user and assistant messages to session', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

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
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
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

  it('persists execution trace', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const trace = createSampleTrace();
    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
    });

    expect(deps.executionTraceRepository.save).toHaveBeenCalledWith(trace);
  });

  it('passes agentId and optional fields to prepareChatRun', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: {
        message: 'Hello',
        sessionId: 'sess-existing',
        sourceChannel: 'whatsapp',
        contactRole: 'owner',
        metadata: { key: 'value' },
      },
    });

    expect(mockPrepareChatRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        agentId: 'agent-1',
        sessionId: 'sess-existing',
        sourceChannel: 'whatsapp',
        contactRole: 'owner',
        message: 'Hello',
        metadata: { key: 'value' },
      }),
      expect.anything(),
    );
  });

  it('extracts tool calls from trace events', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

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
      url: '/agents/agent-1/invoke',
      payload: { message: 'What is 2+2?' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApiResponse<{
      toolCalls: { toolId: string; input: Record<string, unknown>; result: unknown }[];
    }>;
    expect(body.data?.toolCalls).toHaveLength(1);
    expect(body.data?.toolCalls[0]?.toolId).toBe('calculator');
    expect(body.data?.toolCalls[0]?.result).toBe('4');
  });

  it('includes usage info in response', async () => {
    const agent = createMockAgent();
    deps.agentRegistry.get.mockResolvedValue(agent);

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const trace = createSampleTrace({
      totalTokensUsed: 250,
      totalCostUSD: 0.012,
      events: [
        {
          id: 'ev-1',
          traceId: 'trace-1' as TraceId,
          type: 'llm_response',
          timestamp: new Date(),
          durationMs: 100,
          data: { text: 'Done' },
        },
      ],
    });

    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const response = await app.inject({
      method: 'POST',
      url: '/agents/agent-1/invoke',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ApiResponse<{
      usage: { inputTokens: number; outputTokens: number; costUSD: number };
    }>;
    expect(body.data?.usage.inputTokens).toBe(250);
    expect(body.data?.usage.costUSD).toBe(0.012);
  });
});
