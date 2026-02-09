import { describe, it, expect, vi } from 'vitest';
import { createAgentRunner } from './agent-runner.js';
import type { AgentStreamEvent } from './stream-events.js';
import type { LLMProvider, ChatEvent, Message } from '@/providers/types.js';
import type { ToolRegistry } from '@/tools/registry/index.js';
import type { MemoryManager } from '@/memory/index.js';
import type { CostGuard } from '@/cost/index.js';
import type { AgentConfig, SessionId, ProjectId, PromptLayerId, PromptSnapshot } from './types.js';
import { ok, err } from './result.js';
import {
  BudgetExceededError,
  ApprovalRequiredError,
  ToolNotAllowedError,
} from './errors.js';

// ─── Test Fixtures ──────────────────────────────────────────────────

const mockProjectId = 'proj_test' as ProjectId;
const mockSessionId = 'sess_test' as SessionId;

const testSnapshot: PromptSnapshot = {
  identityLayerId: 'id-1' as PromptLayerId,
  identityVersion: 1,
  instructionsLayerId: 'inst-1' as PromptLayerId,
  instructionsVersion: 1,
  safetyLayerId: 'safe-1' as PromptLayerId,
  safetyVersion: 1,
  toolDocsHash: 'abc',
  runtimeContextHash: 'def',
};

const mockAgentConfig: AgentConfig = {
  projectId: mockProjectId,
  agentRole: 'test-agent',
  provider: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    temperature: 1.0,
    maxOutputTokens: 4096,
  },
  failover: {
    onRateLimit: true,
    onServerError: true,
    onTimeout: true,
    timeoutMs: 30000,
    maxRetries: 2,
  },
  allowedTools: ['get_weather', 'search_web'],
  memoryConfig: {
    longTerm: {
      enabled: true,
      maxEntries: 1000,
      retrievalTopK: 3,
      embeddingProvider: 'openai',
      decayEnabled: false,
      decayHalfLifeDays: 30,
    },
    contextWindow: {
      reserveTokens: 1000,
      pruningStrategy: 'token-based',
      maxTurnsInContext: 20,
      compaction: {
        enabled: false,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 100,
    monthlyBudgetUSD: 1000,
    maxTokensPerTurn: 8000,
    maxTurnsPerSession: 10,
    maxToolCallsPerTurn: 5,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 60,
    maxRequestsPerHour: 1000,
  },
  maxTurnsPerSession: 10,
  maxConcurrentSessions: 5,
};


// ─── Mock Implementations ───────────────────────────────────────────

function createMockProvider(
  responses: ChatEvent[][],
): LLMProvider {
  let callIndex = 0;

  return {
    id: 'mock-provider',
    displayName: 'Mock Provider',

    // eslint-disable-next-line @typescript-eslint/require-await
    async *chat() {
      const events = responses[callIndex] ?? [];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },

    countTokens(messages: Message[]) {
      return Promise.resolve(messages.length * 100); // Simple heuristic
    },

    getContextWindow() {
      return 200000;
    },

    supportsToolUse() {
      return true;
    },

    formatTools(tools) {
      return tools;
    },

    formatToolResult(result) {
      return result;
    },
  };
}

function createMockToolRegistry(
  resolveBehavior = new Map<
    string,
    ReturnType<ToolRegistry['resolve']>
  >(),
): ToolRegistry {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    listAll: vi.fn(() => ['get_weather', 'search_web']),
    listForContext: vi.fn(() => []),
    formatForProvider: vi.fn(() => [
      { name: 'get_weather', description: 'Get weather for a location', inputSchema: {} },
      { name: 'search_web', description: 'Search the web', inputSchema: {} },
    ]),
    resolve(toolId, input, context) {
      void context;
      const behavior = resolveBehavior.get(toolId);
      if (behavior) {
        return behavior;
      }
      return Promise.resolve(ok({
        success: true,
        output: { result: `${toolId} executed with ${JSON.stringify(input)}` },
        durationMs: 50,
      }));
    },
    resolveDryRun(toolId, input, context) {
      void toolId;
      void input;
      void context;
      return Promise.resolve(ok({
        success: true,
        output: { result: 'dry run' },
        durationMs: 10,
      }));
    },
  };
}

function createMockMemoryManager(): MemoryManager {
  return {
    fitToContextWindow(messages) {
      return Promise.resolve(messages); // No pruning
    },
    compact(messages, sessionId) {
      return Promise.resolve({
        messages,
        entry: {
          sessionId: sessionId as SessionId,
          summary: 'Compacted',
          messagesCompacted: messages.length,
          tokensRecovered: 1000,
          createdAt: new Date(),
        },
      });
    },
    retrieveMemories() {
      return Promise.resolve([]); // No long-term memories
    },
    storeMemory() {
      return Promise.resolve(null);
    },
  };
}

function createMockCostGuard(
  shouldThrowOnPreCheck = false,
): CostGuard {
  return {
    preCheck(projectId) {
      if (shouldThrowOnPreCheck) {
        throw new BudgetExceededError(projectId, 'daily', 105, 100);
      }
      return Promise.resolve();
    },
    recordUsage() {
      return Promise.resolve();
    },
    getBudgetStatus(projectId) {
      return Promise.resolve({
        projectId,
        dailySpentUSD: 50,
        dailyBudgetUSD: 100,
        monthlySpentUSD: 500,
        monthlyBudgetUSD: 1000,
        dailyPercentUsed: 50,
        monthlyPercentUsed: 50,
        isOverDailyBudget: false,
        isOverMonthlyBudget: false,
      });
    },
    checkTurnTokens(tokens) {
      return tokens <= mockAgentConfig.costConfig.maxTokensPerTurn;
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentRunner', () => {
  describe('run()', () => {
    it('should complete a simple request without tool calls', async () => {
      const provider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'content_delta', text: 'Hello! ' },
          { type: 'content_delta', text: 'How can I help?' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        ],
      ]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Hello',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('completed');
      expect(trace.turnCount).toBe(1);
      expect(trace.totalTokensUsed).toBe(120);
      expect(trace.events.some((e) => e.type === 'llm_request')).toBe(true);
      expect(trace.events.some((e) => e.type === 'llm_response')).toBe(true);
    });

    it('should execute tool calls and continue conversation', async () => {
      const provider = createMockProvider([
        // First turn: LLM requests tool
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'content_delta', text: "Let me check the weather." },
          { type: 'tool_use_start', id: 'tool_1', name: 'get_weather' },
          { type: 'tool_use_delta', id: 'tool_1', partialInput: '{"location":' },
          {
            type: 'tool_use_end',
            id: 'tool_1',
            name: 'get_weather',
            input: { location: 'San Francisco' },
          },
          {
            type: 'message_end',
            stopReason: 'tool_use',
            usage: { inputTokens: 100, outputTokens: 50 },
          },
        ],
        // Second turn: LLM responds with final answer
        [
          { type: 'message_start', messageId: 'msg_2' },
          { type: 'content_delta', text: 'The weather in San Francisco is sunny, 72°F.' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 150, outputTokens: 30 },
          },
        ],
      ]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(
          new Map([
            [
              'get_weather',
              Promise.resolve(ok({
                success: true,
                output: { weather: 'sunny', temp: 72 },
                durationMs: 100,
              })),
            ],
          ]),
        ),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: "What's the weather in San Francisco?",
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('completed');
      expect(trace.turnCount).toBe(2);
      expect(trace.events.some((e) => e.type === 'tool_call')).toBe(true);
      expect(trace.events.some((e) => e.type === 'tool_result')).toBe(true);
    });

    it('should stop when budget is exceeded', async () => {
      const provider = createMockProvider([]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(true), // Throw on preCheck
      });

      const result = await runner.run({
        message: 'Hello',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('budget_exceeded');
      expect(trace.events.some((e) => e.type === 'cost_alert')).toBe(true);
    });

    it('should stop at max turns limit', async () => {
      // Provider always returns tool_use, creating infinite loop
      const provider = createMockProvider(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        Array(15).fill([
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'tool_use_start', id: 'tool_1', name: 'get_weather' },
          {
            type: 'tool_use_end',
            id: 'tool_1',
            name: 'get_weather',
            input: { location: 'SF' },
          },
          {
            type: 'message_end',
            stopReason: 'tool_use',
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        ]),
      );

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Hello',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('max_turns');
      expect(trace.turnCount).toBeGreaterThan(mockAgentConfig.maxTurnsPerSession);
    });

    it('should handle abort signal', async () => {
      const abortController = new AbortController();
      // Abort before starting the run
      abortController.abort();

      const provider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'content_delta', text: 'This should not be reached' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        ],
      ]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Hello',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
        abortSignal: abortController.signal,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('aborted');
      expect(trace.turnCount).toBe(0); // Should not have completed any turns
    });

    it('should handle tool approval required', async () => {
      const provider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'tool_use_start', id: 'tool_1', name: 'delete_database' },
          {
            type: 'tool_use_end',
            id: 'tool_1',
            name: 'delete_database',
            input: { confirm: true },
          },
          {
            type: 'message_end',
            stopReason: 'tool_use',
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        ],
      ]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(
          new Map([
            [
              'delete_database',
              Promise.resolve(err(new ApprovalRequiredError('delete_database', 'approval_123'))),
            ],
          ]),
        ),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Delete the database',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('human_approval_pending');
      expect(trace.events.some((e) => e.type === 'approval_requested')).toBe(true);
    });

    it('should failover to fallback provider on error', async () => {
      const failingProvider = createMockProvider([
        [
          { type: 'error', error: new Error('Rate limit exceeded') },
        ],
      ]);

      const fallbackProvider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'content_delta', text: 'Fallback response' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        ],
      ]);

      const runner = createAgentRunner({
        provider: failingProvider,
        fallbackProvider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Hello',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('completed');
      // Should have a failover event
      expect(trace.events.some((e) => e.type === 'failover')).toBe(true);
    });

    it('should handle tool execution errors gracefully', async () => {
      const provider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'tool_use_start', id: 'tool_1', name: 'get_weather' },
          {
            type: 'tool_use_end',
            id: 'tool_1',
            name: 'get_weather',
            input: { location: 'Invalid' },
          },
          {
            type: 'message_end',
            stopReason: 'tool_use',
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        ],
        [
          { type: 'message_start', messageId: 'msg_2' },
          { type: 'content_delta', text: 'Sorry, I could not get the weather.' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 150, outputTokens: 30 },
          },
        ],
      ]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(
          new Map([
            [
              'get_weather',
              Promise.resolve(err(new ToolNotAllowedError('get_weather', mockProjectId))),
            ],
          ]),
        ),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Get weather',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('completed');
      // Should have tool_result with error
      const toolResultEvent = trace.events.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent?.data['success']).toBe(false);
    });

    it('should respect max tool calls per turn limit', async () => {
      const provider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' } as const,
          // Request 6 tool calls (exceeds limit of 5)
          ...Array.from({ length: 6 }, (_, i) => [
            { type: 'tool_use_start', id: `tool_${i}`, name: 'get_weather' } as const,
            {
              type: 'tool_use_end',
              id: `tool_${i}`,
              name: 'get_weather',
              input: { location: `City${i}` },
            } as const,
          ]).flat(),
          {
            type: 'message_end',
            stopReason: 'tool_use',
            usage: { inputTokens: 100, outputTokens: 50 },
          } as const,
        ],
      ]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Check weather in multiple cities',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const trace = result.value;
      expect(trace.status).toBe('failed');
      const errorEvent = trace.events.find((e) => e.type === 'error');
      expect(errorEvent?.data['error']).toBe('max_tool_calls_exceeded');
    });
  });

  describe('onEvent streaming callback', () => {
    it('should emit agent_start, content_delta, turn_complete, agent_complete for a simple response', async () => {
      const provider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'content_delta', text: 'Hello ' },
          { type: 'content_delta', text: 'world' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 50, outputTokens: 10 },
          },
        ],
      ]);

      const events: AgentStreamEvent[] = [];
      const onEvent = (event: AgentStreamEvent): void => {
        events.push(event);
      };

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Hi',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
        onEvent,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // First event: agent_start with correct sessionId
      expect(events[0]).toMatchObject({
        type: 'agent_start',
        sessionId: mockSessionId,
      });

      // Next two events: content_delta
      const contentDeltas = events.filter((e) => e.type === 'content_delta');
      expect(contentDeltas).toHaveLength(2);
      expect(contentDeltas[0]).toMatchObject({ type: 'content_delta', text: 'Hello ' });
      expect(contentDeltas[1]).toMatchObject({ type: 'content_delta', text: 'world' });

      // turn_complete with turnNumber 1
      const turnCompletes = events.filter((e) => e.type === 'turn_complete');
      expect(turnCompletes).toHaveLength(1);
      expect(turnCompletes[0]).toMatchObject({ type: 'turn_complete', turnNumber: 1 });

      // agent_complete with response and status
      const agentComplete = events.find((e) => e.type === 'agent_complete');
      expect(agentComplete).toBeDefined();
      expect(agentComplete).toMatchObject({
        type: 'agent_complete',
        response: 'Hello world',
        status: 'completed',
      });
    });

    it('should emit tool_use_start and tool_result events for tool calls', async () => {
      const provider = createMockProvider([
        // First turn: LLM requests tool
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'tool_use_start', id: 'tool_1', name: 'get_weather' },
          {
            type: 'tool_use_end',
            id: 'tool_1',
            name: 'get_weather',
            input: { location: 'NYC' },
          },
          {
            type: 'message_end',
            stopReason: 'tool_use',
            usage: { inputTokens: 80, outputTokens: 30 },
          },
        ],
        // Second turn: LLM responds with text
        [
          { type: 'message_start', messageId: 'msg_2' },
          { type: 'content_delta', text: 'It is sunny in NYC.' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 120, outputTokens: 20 },
          },
        ],
      ]);

      const events: AgentStreamEvent[] = [];
      const onEvent = (event: AgentStreamEvent): void => {
        events.push(event);
      };

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(
          new Map([
            [
              'get_weather',
              Promise.resolve(ok({
                success: true,
                output: { weather: 'sunny' },
                durationMs: 42,
              })),
            ],
          ]),
        ),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Weather in NYC?',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
        onEvent,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // tool_use_start event
      const toolUseStarts = events.filter((e) => e.type === 'tool_use_start');
      expect(toolUseStarts).toHaveLength(1);
      expect(toolUseStarts[0]).toMatchObject({
        type: 'tool_use_start',
        toolCallId: 'tool_1',
        toolId: 'get_weather',
        input: { location: 'NYC' },
      });

      // tool_result event with success
      const toolResults = events.filter((e) => e.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]).toMatchObject({
        type: 'tool_result',
        toolCallId: 'tool_1',
        toolId: 'get_weather',
        success: true,
      });
    });

    it('should emit turn_complete for each turn in multi-turn', async () => {
      const provider = createMockProvider([
        // Turn 1: tool call
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'tool_use_start', id: 'tool_1', name: 'search_web' },
          {
            type: 'tool_use_end',
            id: 'tool_1',
            name: 'search_web',
            input: { query: 'test' },
          },
          {
            type: 'message_end',
            stopReason: 'tool_use',
            usage: { inputTokens: 60, outputTokens: 25 },
          },
        ],
        // Turn 2: final text
        [
          { type: 'message_start', messageId: 'msg_2' },
          { type: 'content_delta', text: 'Done.' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 90, outputTokens: 10 },
          },
        ],
      ]);

      const events: AgentStreamEvent[] = [];
      const onEvent = (event: AgentStreamEvent): void => {
        events.push(event);
      };

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Search something',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
        onEvent,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const turnCompletes = events.filter((e) => e.type === 'turn_complete');
      expect(turnCompletes).toHaveLength(2);
      expect(turnCompletes[0]).toMatchObject({ type: 'turn_complete', turnNumber: 1 });
      expect(turnCompletes[1]).toMatchObject({ type: 'turn_complete', turnNumber: 2 });
    });

    it('should emit error event on budget exceeded', async () => {
      const provider = createMockProvider([]);

      const events: AgentStreamEvent[] = [];
      const onEvent = (event: AgentStreamEvent): void => {
        events.push(event);
      };

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(true),
      });

      const result = await runner.run({
        message: 'Hello',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
        onEvent,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status).toBe('budget_exceeded');

      // Should have agent_start
      expect(events[0]).toMatchObject({ type: 'agent_start' });

      // Should have error event with BUDGET_EXCEEDED code
      const errorEvents = events.filter((e) => e.type === 'error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        type: 'error',
        code: 'BUDGET_EXCEEDED',
      });

      // Should still emit agent_complete at the end
      const agentComplete = events.find((e) => e.type === 'agent_complete');
      expect(agentComplete).toBeDefined();
      expect(agentComplete).toMatchObject({
        type: 'agent_complete',
        status: 'budget_exceeded',
      });
    });

    it('should not throw when onEvent is not provided', async () => {
      const provider = createMockProvider([
        [
          { type: 'message_start', messageId: 'msg_1' },
          { type: 'content_delta', text: 'Works fine' },
          {
            type: 'message_end',
            stopReason: 'end_turn',
            usage: { inputTokens: 40, outputTokens: 8 },
          },
        ],
      ]);

      const runner = createAgentRunner({
        provider,
        toolRegistry: createMockToolRegistry(),
        memoryManager: createMockMemoryManager(),
        costGuard: createMockCostGuard(),
      });

      const result = await runner.run({
        message: 'Hello',
        agentConfig: mockAgentConfig,
        sessionId: mockSessionId,
        systemPrompt: 'Test system prompt',
        promptSnapshot: testSnapshot,
        // onEvent deliberately omitted
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('completed');
    });
  });
});
