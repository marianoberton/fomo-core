/**
 * Tests for the TaskExecutor — the bridge between scheduled tasks
 * and the agent execution loop.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTaskExecutor } from './task-executor.js';
import { prepareChatRun, extractAssistantResponse } from '@/api/routes/chat-setup.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { AgentRunner } from '@/core/agent-runner.js';
import { ok, err } from '@/core/result.js';
import { NexusError } from '@/core/errors.js';
import type { TraceId, SessionId } from '@/core/types.js';
import {
  createMockProjectRepository,
  createMockSessionRepository,
  createMockPromptLayerRepository,
  createMockExecutionTraceRepository,
  createMockToolRegistry,
  createMockMCPManager,
  createMockLogger,
  createSampleTrace,
  createSamplePromptSnapshot,
} from '@/testing/fixtures/routes.js';
import { createTestAgentConfig } from '@/testing/fixtures/context.js';
import { createSampleScheduledTask } from '@/testing/fixtures/routes.js';
import type { ChatSetupResult } from '@/api/routes/chat-setup.js';
import type { TaskExecutorOptions } from './task-executor.js';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('@/api/routes/chat-setup.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/routes/chat-setup.js')>();
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

function createSetupResult(overrides?: Partial<ChatSetupResult>): ChatSetupResult {
  return {
    sanitizedMessage: 'Generate the daily report',
    agentConfig: createTestAgentConfig(),
    sessionId: 'sess-task-1' as SessionId,
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

function createExecutorDeps(): {
  projectRepository: ReturnType<typeof createMockProjectRepository>;
  sessionRepository: ReturnType<typeof createMockSessionRepository>;
  promptLayerRepository: ReturnType<typeof createMockPromptLayerRepository>;
  executionTraceRepository: ReturnType<typeof createMockExecutionTraceRepository>;
  toolRegistry: ReturnType<typeof createMockToolRegistry>;
  mcpManager: ReturnType<typeof createMockMCPManager>;
  prisma: TaskExecutorOptions['prisma'];
  logger: ReturnType<typeof createMockLogger>;
} {
  return {
    projectRepository: createMockProjectRepository(),
    sessionRepository: createMockSessionRepository(),
    promptLayerRepository: createMockPromptLayerRepository(),
    executionTraceRepository: createMockExecutionTraceRepository(),
    toolRegistry: createMockToolRegistry(),
    mcpManager: createMockMCPManager(),
    prisma: {} as TaskExecutorOptions['prisma'],
    logger: createMockLogger(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('createTaskExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a function', () => {
    const executor = createTaskExecutor(createExecutorDeps());
    expect(typeof executor).toBe('function');
  });

  it('executes a task successfully and returns trace data', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    const trace = createSampleTrace({
      id: 'trace-task-1' as TraceId,
      totalTokensUsed: 250,
      totalCostUSD: 0.005,
      turnCount: 2,
      status: 'completed',
    });

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('Report generated successfully');

    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const result = await executor(task);

    expect(result.success).toBe(true);
    expect(result.traceId).toBe('trace-task-1');
    expect(result.tokensUsed).toBe(250);
    expect(result.costUsd).toBe(0.005);
    expect(result.result).toEqual(expect.objectContaining({
      response: 'Report generated successfully',
      sessionId: 'sess-task-1',
      status: 'completed',
      turnCount: 2,
    }));
  });

  it('passes task payload to prepareChatRun', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask({
      taskPayload: {
        message: 'Check inventory levels',
        metadata: { source: 'cron' },
      },
    });

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('');

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await executor(task);

    expect(mockPrepareChatRun).toHaveBeenCalledWith(
      {
        projectId: task.projectId,
        message: 'Check inventory levels',
        metadata: { source: 'cron' },
      },
      expect.objectContaining({
        projectRepository: deps.projectRepository,
        sessionRepository: deps.sessionRepository,
        promptLayerRepository: deps.promptLayerRepository,
      }),
    );
  });

  it('returns failure when prepareChatRun fails', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    mockPrepareChatRun.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Project not found', statusCode: 404 }),
    );

    const result = await executor(task);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Project not found');
    expect(result.traceId).toBeUndefined();
  });

  it('returns failure when agent run returns error', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const nexusErr = new NexusError({
      message: 'Budget exceeded',
      code: 'BUDGET_EXCEEDED',
      statusCode: 429,
    });
    const mockRun = vi.fn().mockResolvedValue(err(nexusErr));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const result = await executor(task);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Budget exceeded');
  });

  it('persists user and assistant messages on success', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    const trace = createSampleTrace({ id: 'trace-persist' as TraceId });
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult({
      sanitizedMessage: 'Clean task message',
    })));
    mockExtractAssistantResponse.mockReturnValue('Done');

    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await executor(task);

     
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledTimes(2);

     
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledWith(
      'sess-task-1',
      { role: 'user', content: 'Clean task message' },
      'trace-persist',
    );

     
    expect(deps.sessionRepository.addMessage).toHaveBeenCalledWith(
      'sess-task-1',
      { role: 'assistant', content: 'Done' },
      'trace-persist',
    );
  });

  it('does not persist messages when setup fails', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    mockPrepareChatRun.mockResolvedValue(
      err({ code: 'NO_ACTIVE_PROMPT', message: 'No active layers', statusCode: 400 }),
    );

    await executor(task);

     
    expect(deps.sessionRepository.addMessage).not.toHaveBeenCalled();
  });

  it('does not persist messages when agent run fails', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));

    const mockRun = vi.fn().mockResolvedValue(
      err(new NexusError({ message: 'Failed', code: 'FAILED' })),
    );
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await executor(task);

     
    expect(deps.sessionRepository.addMessage).not.toHaveBeenCalled();
  });

  it('creates agent runner with correct dependencies', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    const setup = createSetupResult();
    mockPrepareChatRun.mockResolvedValue(ok(setup));
    mockExtractAssistantResponse.mockReturnValue('');

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await executor(task);

    expect(mockCreateAgentRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: setup.provider,
        toolRegistry: deps.toolRegistry,
        memoryManager: setup.memoryManager,
        costGuard: setup.costGuard,
        logger: deps.logger,
      }),
    );
  });

  it('passes abort signal to agent runner', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask({ timeoutMs: 60_000 });

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('');

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await executor(task);

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it('reports non-completed status as failure with error message', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    const trace = createSampleTrace({ status: 'max_turns' });
    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('Partial response');

    const mockRun = vi.fn().mockResolvedValue(ok(trace));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    const result = await executor(task);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('max_turns');
    // Still has trace data even on non-completed status
    expect(result.traceId).toBeDefined();
    expect(result.tokensUsed).toBeDefined();
  });

  it('logs task execution start and completion', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    mockPrepareChatRun.mockResolvedValue(ok(createSetupResult()));
    mockExtractAssistantResponse.mockReturnValue('OK');

    const mockRun = vi.fn().mockResolvedValue(ok(createSampleTrace()));
    mockCreateAgentRunner.mockReturnValue({ run: mockRun } as unknown as AgentRunner);

    await executor(task);

     
    expect(deps.logger.info).toHaveBeenCalledWith(
      'Starting scheduled task execution',
      expect.objectContaining({ taskId: task.id }),
    );

     
    expect(deps.logger.info).toHaveBeenCalledWith(
      'Task execution completed',
      expect.objectContaining({ taskId: task.id }),
    );
  });

  it('logs error when setup fails', async () => {
    const deps = createExecutorDeps();
    const executor = createTaskExecutor(deps);
    const task = createSampleScheduledTask();

    mockPrepareChatRun.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Project not found', statusCode: 404 }),
    );

    await executor(task);

     
    expect(deps.logger.error).toHaveBeenCalledWith(
      'Task setup failed',
      expect.objectContaining({
        taskId: task.id,
        error: 'Project not found',
      }),
    );
  });
});
