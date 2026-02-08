/**
 * Tests for the WebSocket /chat/stream route.
 *
 * Unit tests exercise handleChatStreamMessage directly.
 * Integration tests verify the full WebSocket route wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { handleChatStreamMessage, chatStreamRoutes } from './chat-stream.js';
import { prepareChatRun, extractAssistantResponse } from './chat-setup.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { AgentRunner } from '@/core/agent-runner.js';
import { ok, err } from '@/core/result.js';
import { NexusError } from '@/core/errors.js';
import type { AgentStreamEvent } from '@/core/stream-events.js';
import type { SessionId, TraceId } from '@/core/types.js';
import {
  createMockDeps,
  createSampleTrace,
  createSamplePromptSnapshot,
} from '@/testing/fixtures/routes.js';
import { createTestAgentConfig } from '@/testing/fixtures/context.js';
import type { ChatSetupResult } from './chat-setup.js';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('./chat-setup.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./chat-setup.js')>();
  return {
    ...mod,
    prepareChatRun: vi.fn(),
    extractAssistantResponse: vi.fn().mockReturnValue(''),
  };
});

vi.mock('@/core/agent-runner.js', () => ({
  createAgentRunner: vi.fn(),
}));

const mockPrepareChatRun = vi.mocked(prepareChatRun);
const mockExtractAssistantResponse = vi.mocked(extractAssistantResponse);
const mockCreateAgentRunner = vi.mocked(createAgentRunner);

// ─── Helpers ────────────────────────────────────────────────────

type MockDeps = ReturnType<typeof createMockDeps>;

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

// ─── handleChatStreamMessage — Unit Tests ───────────────────────

describe('handleChatStreamMessage', () => {
  let deps: MockDeps;
  let events: AgentStreamEvent[];
  let send: (event: AgentStreamEvent) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    events = [];
    send = (event: AgentStreamEvent): void => {
      events.push(event);
    };
  });

  it('streams events and persists messages on success', async () => {
    const trace = createSampleTrace({
      id: 'trace-1' as TraceId,
      events: [
        { id: 'ev-1', traceId: 'trace-1' as TraceId, type: 'llm_response', timestamp: new Date(), durationMs: 100, data: { text: 'Hi' } },
      ],
    });

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('Hi');

    const mockRun = vi.fn().mockImplementation(
      (params: { onEvent?: (event: AgentStreamEvent) => void }) => {
        params.onEvent?.({ type: 'agent_start', sessionId: 'sess-1', traceId: 'trace-1' });
        params.onEvent?.({ type: 'content_delta', text: 'Hi' });
        params.onEvent?.({
          type: 'agent_complete',
          response: 'Hi',
          usage: { totalTokens: 100, costUSD: 0.01 },
          status: 'completed',
        });
        return Promise.resolve(ok(trace));
      },
    );
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await handleChatStreamMessage(
      { projectId: 'proj-1', message: 'Hello' },
      deps,
      send,
      AbortSignal.timeout(5000),
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual(expect.objectContaining({ type: 'agent_start' }));
    expect(events[1]).toEqual(expect.objectContaining({ type: 'content_delta', text: 'Hi' }));
    expect(events[2]).toEqual(expect.objectContaining({ type: 'agent_complete' }));

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledTimes(2);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledWith(
      'sess-1',
      { role: 'user', content: 'Hello' },
      'trace-1',
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledWith(
      'sess-1',
      { role: 'assistant', content: 'Hi' },
      'trace-1',
    );
  });

  it('sends error event when setup fails', async () => {
    mockPrepareChatRun.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Project not found', statusCode: 404 }),
    );

    await handleChatStreamMessage(
      { projectId: 'bad', message: 'Hello' },
      deps,
      send,
      AbortSignal.timeout(5000),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      code: 'NOT_FOUND',
      message: 'Project not found',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deps.sessionRepository.addMessage).not.toHaveBeenCalled();
  });

  it('sends error event when agent run fails', async () => {
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const nexusErr = new NexusError({
      message: 'Budget exceeded',
      code: 'BUDGET_EXCEEDED',
      statusCode: 429,
    });
    const mockRun = vi.fn().mockResolvedValue(err(nexusErr));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await handleChatStreamMessage(
      { projectId: 'proj-1', message: 'Hello' },
      deps,
      send,
      AbortSignal.timeout(5000),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      code: 'BUDGET_EXCEEDED',
      message: 'Budget exceeded',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deps.sessionRepository.addMessage).not.toHaveBeenCalled();
  });

  it('creates agent runner with correct dependencies', async () => {
    const setup = createSetupResult();
    mockPrepareChatRun.mockResolvedValue(ok(setup));

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);
    mockExtractAssistantResponse.mockReturnValue('');

    await handleChatStreamMessage(
      { projectId: 'proj-1', message: 'Hello' },
      deps,
      send,
      AbortSignal.timeout(5000),
    );

    expect(mockCreateAgentRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: setup.provider,
        toolRegistry: deps.toolRegistry,
        memoryManager: setup.memoryManager,
        costGuard: setup.costGuard,
      }),
    );
  });

  it('passes abort signal to agent runner', async () => {
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);
    mockExtractAssistantResponse.mockReturnValue('');

    const abortSignal = AbortSignal.timeout(5000);

    await handleChatStreamMessage(
      { projectId: 'proj-1', message: 'Hello' },
      deps,
      send,
      abortSignal,
    );

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal }),
    );
  });
});

// ─── chatStreamRoutes — WebSocket Integration Tests ─────────────

describe('chatStreamRoutes (WebSocket)', () => {
  let app: FastifyInstance;
  let deps: MockDeps;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    app = Fastify();
    await app.register(websocket);
    chatStreamRoutes(app, deps);
    await app.listen({ port: 0 });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  });

  afterEach(async () => {
    await app.close();
  });

  it('streams agent events over WebSocket', async () => {
    const trace = createSampleTrace({ id: 'trace-ws' as TraceId });

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('Hello back');

    const mockRun = vi.fn().mockImplementation(
      (params: { onEvent?: (event: AgentStreamEvent) => void }) => {
        params.onEvent?.({ type: 'agent_start', sessionId: 'sess-1', traceId: 'trace-ws' });
        params.onEvent?.({
          type: 'agent_complete',
          response: 'Hello back',
          usage: { totalTokens: 50, costUSD: 0.001 },
          status: 'completed',
        });
        return Promise.resolve(ok(trace));
      },
    );
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const messages: AgentStreamEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${String(port)}/chat/stream`);

      ws.onopen = () => {
        ws.send(JSON.stringify({ projectId: 'proj-1', message: 'Hello' }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as AgentStreamEvent;
        messages.push(msg);
        if (msg.type === 'agent_complete') {
          ws.close();
        }
      };

      ws.onclose = () => {
        resolve();
      };

      ws.onerror = () => {
        reject(new Error('WebSocket error'));
      };

      setTimeout(() => {
        ws.close();
        reject(new Error('Test timed out'));
      }, 5000);
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(expect.objectContaining({ type: 'agent_start' }));
    expect(messages[1]).toEqual(expect.objectContaining({ type: 'agent_complete' }));
  });

  it('sends validation error for invalid JSON', async () => {
    const messages: AgentStreamEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${String(port)}/chat/stream`);

      ws.onopen = () => {
        ws.send('not valid json');
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as AgentStreamEvent;
        messages.push(msg);
        if (msg.type === 'error') {
          ws.close();
        }
      };

      ws.onclose = () => {
        resolve();
      };

      ws.onerror = () => {
        reject(new Error('WebSocket error'));
      };

      setTimeout(() => {
        ws.close();
        reject(new Error('Test timed out'));
      }, 5000);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Invalid message format',
    });
  });

  it('sends validation error for invalid schema', async () => {
    const messages: AgentStreamEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${String(port)}/chat/stream`);

      ws.onopen = () => {
        ws.send(JSON.stringify({ message: 'Hello' })); // missing projectId
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as AgentStreamEvent;
        messages.push(msg);
        if (msg.type === 'error') {
          ws.close();
        }
      };

      ws.onclose = () => {
        resolve();
      };

      ws.onerror = () => {
        reject(new Error('WebSocket error'));
      };

      setTimeout(() => {
        ws.close();
        reject(new Error('Test timed out'));
      }, 5000);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({ type: 'error', code: 'VALIDATION_ERROR' }),
    );
  });

  it('sends BUSY error when a second message arrives during a run', async () => {
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('');

    // Make the run take some time so we can send a second message
    const mockRun = vi.fn().mockImplementation(
      async (params: { onEvent?: (event: AgentStreamEvent) => void }) => {
        await new Promise((r) => setTimeout(r, 200));
        params.onEvent?.({
          type: 'agent_complete',
          response: '',
          usage: { totalTokens: 10, costUSD: 0 },
          status: 'completed',
        });
        return ok(createSampleTrace());
      },
    );
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const messages: AgentStreamEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${String(port)}/chat/stream`);

      ws.onopen = () => {
        // Send first message
        ws.send(JSON.stringify({ projectId: 'proj-1', message: 'First' }));
        // Send second message immediately (while first is still running)
        setTimeout(() => {
          ws.send(JSON.stringify({ projectId: 'proj-1', message: 'Second' }));
        }, 50);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as AgentStreamEvent;
        messages.push(msg);
        if (msg.type === 'agent_complete') {
          ws.close();
        }
      };

      ws.onclose = () => {
        resolve();
      };

      ws.onerror = () => {
        reject(new Error('WebSocket error'));
      };

      setTimeout(() => {
        ws.close();
        reject(new Error('Test timed out'));
      }, 5000);
    });

    const busyError = messages.find(
      (m) => m.type === 'error' && 'code' in m && m.code === 'BUSY',
    );
    expect(busyError).toBeDefined();
  });
});
