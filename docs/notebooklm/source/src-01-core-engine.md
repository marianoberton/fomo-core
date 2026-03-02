# Nexus Core — Source: Core Engine

Complete source code for the core agent engine subsystem.

---
## src/core/agent-runner.ts
```typescript
/**
 * AgentRunner — The core agent execution loop.
 *
 * Orchestrates: build prompt → LLM call → parse response → execute tools → repeat
 * until the agent returns a final answer, budget is exceeded, or max turns reached.
 *
 * Integrates all subsystems: PromptBuilder, LLMProvider, ToolRegistry,
 * MemoryManager, CostGuard, and observability via ExecutionTrace.
 */
import type { LLMProvider, Message, TokenUsage } from '@/providers/types.js';
import { calculateCost } from '@/providers/models.js';
import type { ToolRegistry } from '@/tools/registry/index.js';
import type { MemoryManager } from '@/memory/index.js';
import type { CostGuard } from '@/cost/index.js';
import { createLogger, type Logger } from '@/observability/logger.js';
import type { Result } from './result.js';
import { ok, err } from './result.js';
import {
  NexusError,
  BudgetExceededError,
  ProviderError,
  ApprovalRequiredError,
} from './errors.js';
import type {
  AgentConfig,
  ExecutionContext,
  ExecutionTrace,
  PromptSnapshot,
  TraceEvent,
  SessionId,
  TraceId,
} from './types.js';
import type { AgentStreamEvent } from './stream-events.js';
import { randomUUID } from 'node:crypto';

const logger = createLogger({ name: 'agent-runner' });

// ─── Agent Runner Options ───────────────────────────────────────────

export interface AgentRunnerOptions {
  /** Primary LLM provider. */
  provider: LLMProvider;
  /** Fallback LLM provider (optional). */
  fallbackProvider?: LLMProvider;
  /** Tool registry with RBAC enforcement. */
  toolRegistry: ToolRegistry;
  /** Memory manager (4 layers). */
  memoryManager: MemoryManager;
  /** Cost guard middleware. */
  costGuard: CostGuard;
  /** Logger instance (optional, creates new if not provided). */
  logger?: Logger;
}

// ─── Agent Runner ───────────────────────────────────────────────────

export interface AgentRunner {
  /**
   * Run the agent loop for a user message.
   * Returns an ExecutionTrace with full observability.
   */
  run(params: {
    message?: string;
    agentConfig: AgentConfig;
    sessionId: SessionId;
    /** Pre-built system prompt string (assembled by chat-setup from prompt layers). */
    systemPrompt: string;
    /** Snapshot of which prompt layer versions were used. */
    promptSnapshot: PromptSnapshot;
    conversationHistory?: Message[];
    abortSignal?: AbortSignal;
    /** Optional callback for real-time streaming events (used by WebSocket endpoint). */
    onEvent?: (event: AgentStreamEvent) => void;
  }): Promise<Result<ExecutionTrace, NexusError>>;
}

/**
 * Create an AgentRunner instance.
 */
export function createAgentRunner(options: AgentRunnerOptions): AgentRunner {
  const {
    provider,
    fallbackProvider,
    toolRegistry,
    memoryManager,
    costGuard,
    logger: injectedLogger,
  } = options;

  const runLogger = injectedLogger ?? logger;

  return {
    async run(params) {
      const {
        message,
        agentConfig,
        sessionId,
        systemPrompt: preBuiltSystemPrompt,
        promptSnapshot,
        conversationHistory = [],
        abortSignal,
        onEvent,
      } = params;

      const traceId = randomUUID() as TraceId;
      const startTime = Date.now();

      // Initialize execution context
      const context: ExecutionContext = {
        projectId: agentConfig.projectId,
        sessionId,
        traceId,
        agentConfig,
        permissions: {
          allowedTools: new Set(agentConfig.allowedTools),
        },
        abortSignal: abortSignal ?? new AbortController().signal,
      };

      const trace: ExecutionTrace = {
        id: traceId,
        projectId: agentConfig.projectId,
        sessionId,
        promptSnapshot,
        events: [],
        totalDurationMs: 0,
        totalTokensUsed: 0,
        totalCostUSD: 0,
        turnCount: 0,
        status: 'running',
        createdAt: new Date(),
      };

      runLogger.info('Starting agent run', {
        component: 'agent-runner',
        traceId,
        sessionId,
        projectId: agentConfig.projectId,
      });

      onEvent?.({ type: 'agent_start', sessionId, traceId });

      try {
        // Initialize conversation with history + new user message
        const conversation: Message[] = [...conversationHistory];
        if (message) {
          conversation.push({ role: 'user', content: message });
        }

        // Check abort signal before starting
        if (context.abortSignal.aborted) {
          trace.status = 'aborted';
          trace.completedAt = new Date();
          trace.totalDurationMs = Date.now() - startTime;
          return ok(trace);
        }

        // Main agent loop
        let turnCount = 0;
        let shouldContinue = true;

        while (shouldContinue) {
          turnCount++;

          // Check max turns limit
          if (turnCount > agentConfig.maxTurnsPerSession) {
            trace.status = 'max_turns';
            addTraceEvent(trace, {
              type: 'error',
              data: {
                error: 'max_turns_exceeded',
                turnCount,
                limit: agentConfig.maxTurnsPerSession,
              },
            });
            onEvent?.({ type: 'error', code: 'MAX_TURNS_EXCEEDED', message: `Max turns (${agentConfig.maxTurnsPerSession}) exceeded` });
            break;
          }

          // Pre-check cost guard (rate limits + budgets)
          try {
            await costGuard.preCheck(agentConfig.projectId);
          } catch (error) {
            if (error instanceof BudgetExceededError) {
              trace.status = 'budget_exceeded';
              addTraceEvent(trace, {
                type: 'cost_alert',
                data: { error: error.message, code: error.code },
              });
              onEvent?.({ type: 'error', code: 'BUDGET_EXCEEDED', message: error.message });
              break;
            }
            throw error;
          }

          // Retrieve relevant long-term memories
          let retrievedMemories: Awaited<ReturnType<typeof memoryManager.retrieveMemories>> = [];

          if (message) {
            retrievedMemories = await memoryManager.retrieveMemories({
              query: message,
              topK: agentConfig.memoryConfig.longTerm.retrievalTopK,
              sessionScope: sessionId,
            });
          }

          if (retrievedMemories.length > 0) {
            addTraceEvent(trace, {
              type: 'memory_retrieval',
              data: {
                count: retrievedMemories.length,
                memories: retrievedMemories.map((m) => ({
                  category: m.category,
                  similarity: m.similarityScore,
                })),
              },
            });
          }

          // Use pre-built system prompt (assembled by chat-setup from prompt layers)
          const systemPrompt = preBuiltSystemPrompt;

          // Fit conversation to context window (apply pruning if needed)
          let fittedMessages = await memoryManager.fitToContextWindow(conversation);

          // If pruning dropped messages and compaction is enabled, compact for better context
          if (
            fittedMessages.length < conversation.length &&
            agentConfig.memoryConfig.contextWindow.compaction.enabled
          ) {
            try {
              const { messages: compactedMessages, entry } = await memoryManager.compact(
                conversation,
                sessionId,
              );
              if (compactedMessages.length > 0) {
                fittedMessages = compactedMessages;
                addTraceEvent(trace, {
                  type: 'compaction',
                  data: {
                    messagesCompacted: entry.messagesCompacted,
                    tokensRecovered: entry.tokensRecovered,
                  },
                });
              }
            } catch {
              // Compaction failed — proceed with pruned messages
              runLogger.warn('Compaction failed, using pruned messages', {
                component: 'agent-runner',
                traceId,
              });
            }
          }

          // Format tools for provider
          const genericTools = toolRegistry.formatForProvider(context);
          const formattedTools = provider.formatTools(genericTools);

          runLogger.debug('Calling LLM', {
            component: 'agent-runner',
            traceId,
            turn: turnCount,
            provider: provider.id,
            messageCount: fittedMessages.length,
            toolCount: formattedTools.length,
            abortSignalAborted: context.abortSignal.aborted,
          });

          // Call LLM with streaming
          const chatResult = await executeLLMCall({
            provider,
            fallbackProvider,
            systemPrompt,
            messages: fittedMessages,
            tools: formattedTools,
            agentConfig,
            context,
            trace,
            onStreamEvent: onEvent,
            onFallback: () => {
              runLogger.warn('Primary provider failed, using fallback', {
                component: 'agent-runner',
                traceId,
              });
            },
          });

          if (!chatResult.ok) {
            // Special handling for abort — don't mark as failed, mark as aborted
            if (chatResult.error.code === 'ABORTED') {
              trace.status = 'aborted';
              break;
            }

            trace.status = 'failed';
            addTraceEvent(trace, {
              type: 'error',
              data: { error: chatResult.error.message, code: chatResult.error.code },
            });
            onEvent?.({ type: 'error', code: chatResult.error.code, message: chatResult.error.message });
            break;
          }

          const { assistantMessage, usage } = chatResult.value;

          // Record usage in CostGuard
          await costGuard.recordUsage(
            agentConfig.projectId,
            provider.id,
            agentConfig.provider.model,
            usage,
          );

          // Update trace with usage
          trace.totalTokensUsed += usage.inputTokens + usage.outputTokens;
          trace.totalCostUSD += calculateUsageCost(
            agentConfig.provider.provider,
            agentConfig.provider.model,
            usage,
          );

          // Add LLM response to conversation
          conversation.push(assistantMessage);

          // Process tool calls if any
          const toolCalls = extractToolCalls(assistantMessage);

          if (toolCalls.length > 0) {
            // Check max tool calls per turn
            if (toolCalls.length > agentConfig.costConfig.maxToolCallsPerTurn) {
              trace.status = 'failed';
              addTraceEvent(trace, {
                type: 'error',
                data: {
                  error: 'max_tool_calls_exceeded',
                  count: toolCalls.length,
                  limit: agentConfig.costConfig.maxToolCallsPerTurn,
                },
              });
              break;
            }

            // Execute tool calls
            const toolResults: Message[] = [];
            let approvalPending = false;

            for (const toolCall of toolCalls) {
              const toolStart = Date.now();

              addTraceEvent(trace, {
                type: 'tool_call',
                data: {
                  toolCallId: toolCall.id,
                  toolId: toolCall.name,
                  input: toolCall.input,
                },
              });

              onEvent?.({
                type: 'tool_use_start',
                toolCallId: toolCall.id,
                toolId: toolCall.name,
                input: toolCall.input,
              });

              const result = await toolRegistry.resolve(toolCall.name, toolCall.input, context);

              if (!result.ok) {
                // Handle approval required
                if (result.error instanceof ApprovalRequiredError) {
                  approvalPending = true;
                  trace.status = 'human_approval_pending';
                  addTraceEvent(trace, {
                    type: 'approval_requested',
                    data: {
                      toolCallId: toolCall.id,
                      toolId: toolCall.name,
                      approvalId: result.error.context?.['approvalId'],
                    },
                  });
                  onEvent?.({
                    type: 'approval_requested',
                    toolCallId: toolCall.id,
                    toolId: toolCall.name,
                    approvalId: result.error.context?.['approvalId'] as string,
                    input: toolCall.input,
                  });
                  continue;
                }

                // Tool execution failed
                addTraceEvent(trace, {
                  type: 'tool_result',
                  data: {
                    toolCallId: toolCall.id,
                    success: false,
                    error: result.error.message,
                  },
                  durationMs: Date.now() - toolStart,
                });

                onEvent?.({
                  type: 'tool_result',
                  toolCallId: toolCall.id,
                  toolId: toolCall.name,
                  success: false,
                  output: undefined,
                  error: result.error.message,
                });

                toolResults.push({
                  role: 'tool',
                  content: [
                    {
                      type: 'tool_result',
                      toolUseId: toolCall.id,
                      content: `Error: ${result.error.message}`,
                      isError: true,
                    },
                  ],
                });
                continue;
              }

              // Auto-store memory for notable tool executions (fire-and-forget).
              // This lets the agent passively learn from interactions without
              // requiring explicit store-memory calls.
              if (result.value.success) {
                autoStoreToolMemory(
                  memoryManager,
                  toolCall.name,
                  toolCall.input,
                  result.value.output,
                  context,
                ).catch((e: unknown) => {
                  runLogger.debug('Auto-store memory skipped or failed', {
                    component: 'agent-runner',
                    toolId: toolCall.name,
                    error: String(e),
                  });
                });
              }

              // Tool executed successfully
              addTraceEvent(trace, {
                type: 'tool_result',
                data: {
                  toolCallId: toolCall.id,
                  success: result.value.success,
                  output: result.value.output,
                },
                durationMs: result.value.durationMs,
              });

              onEvent?.({
                type: 'tool_result',
                toolCallId: toolCall.id,
                toolId: toolCall.name,
                success: result.value.success,
                output: result.value.output,
              });

              toolResults.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool_result',
                    toolUseId: toolCall.id,
                    content: JSON.stringify(result.value.output),
                    isError: false,
                  },
                ],
              });
            }

            // If approval is pending, stop execution
            if (approvalPending) {
              shouldContinue = false;
              break;
            }

            // Add tool results to conversation
            conversation.push(...toolResults);

            onEvent?.({ type: 'turn_complete', turnNumber: turnCount });

            // Continue loop to get next LLM response
            continue;
          }

          // No tool calls, agent has completed its turn
          shouldContinue = false;
          trace.status = 'completed';
          onEvent?.({ type: 'turn_complete', turnNumber: turnCount });
        }

        trace.turnCount = turnCount;
        trace.completedAt = new Date();
        trace.totalDurationMs = Date.now() - startTime;

        // Emit agent_complete with final response text
        if (onEvent) {
          const responseText = extractFinalResponse(conversation);
          onEvent({
            type: 'agent_complete',
            response: responseText,
            usage: {
              totalTokens: trace.totalTokensUsed,
              costUSD: trace.totalCostUSD,
            },
            status: trace.status,
          });
        }

        runLogger.info('Agent run completed', {
          component: 'agent-runner',
          traceId,
          status: trace.status,
          turns: turnCount,
          tokensUsed: trace.totalTokensUsed,
          costUSD: trace.totalCostUSD.toFixed(4),
        });

        return ok(trace);
      } catch (error) {
        trace.status = 'failed';
        trace.completedAt = new Date();
        trace.totalDurationMs = Date.now() - startTime;

        if (error instanceof NexusError) {
          addTraceEvent(trace, {
            type: 'error',
            data: { error: error.message, code: error.code, context: error.context },
          });
          onEvent?.({ type: 'error', code: error.code, message: error.message });
          runLogger.error('Agent run failed', {
            component: 'agent-runner',
            traceId,
            error: error.message,
            code: error.code,
          });
          return err(error);
        }

        const nexusError = new NexusError({
          message: error instanceof Error ? error.message : String(error),
          code: 'AGENT_RUN_FAILED',
          cause: error instanceof Error ? error : undefined,
        });

        addTraceEvent(trace, {
          type: 'error',
          data: { error: nexusError.message },
        });
        onEvent?.({ type: 'error', code: nexusError.code, message: nexusError.message });

        runLogger.error('Agent run failed with unexpected error', {
          component: 'agent-runner',
          traceId,
          error: nexusError.message,
        });

        return err(nexusError);
      }
    },
  };
}

// ─── Helper Functions ───────────────────────────────────────────────

/**
 * Execute an LLM call with automatic failover support.
 */
async function executeLLMCall(params: {
  provider: LLMProvider;
  fallbackProvider?: LLMProvider;
  systemPrompt: string;
  messages: Message[];
  tools: unknown[];
  agentConfig: AgentConfig;
  context: ExecutionContext;
  trace: ExecutionTrace;
  onStreamEvent?: (event: AgentStreamEvent) => void;
  onFallback?: () => void;
}): Promise<
  Result<
    {
      assistantMessage: Message;
      usage: TokenUsage;
      stopReason: string;
    },
    NexusError
  >
> {
  const { provider, fallbackProvider, systemPrompt, messages, tools, agentConfig, context, trace } =
    params;

  const attemptCall = async (
    currentProvider: LLMProvider,
  ): Promise<
    Result<
      {
        assistantMessage: Message;
        usage: TokenUsage;
        stopReason: string;
      },
      NexusError
    >
  > => {
    try {
      addTraceEvent(trace, {
        type: 'llm_request',
        data: {
          provider: currentProvider.id,
          model: agentConfig.provider.model,
          messageCount: messages.length,
          toolCount: tools.length,
        },
      });

      const chatStream = currentProvider.chat({
        messages,
        systemPrompt,
        tools: currentProvider.supportsToolUse() ? tools : undefined,
        maxTokens: agentConfig.provider.maxOutputTokens ?? 4096,
        temperature: agentConfig.provider.temperature ?? 1.0,
        traceId: context.traceId,
      });

      // Collect streaming events
      const textParts: string[] = [];
      const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
      let finalUsage: TokenUsage | undefined;
      let finalStopReason: string | undefined;

      for await (const event of chatStream) {
        // Check abort signal during streaming
        if (context.abortSignal.aborted) {
          throw new NexusError({
            message: 'Agent run aborted by user',
            code: 'ABORTED',
            statusCode: 499,
          });
        }

        switch (event.type) {
          case 'content_delta':
            textParts.push(event.text);
            params.onStreamEvent?.({ type: 'content_delta', text: event.text });
            break;
          case 'tool_use_end':
            toolUses.push({ id: event.id, name: event.name, input: event.input });
            break;
          case 'message_end':
            finalUsage = event.usage;
            finalStopReason = event.stopReason;
            break;
          case 'error':
            throw event.error;
        }
      }

      if (!finalUsage || !finalStopReason) {
        throw new NexusError({
          message: 'LLM stream ended without usage or stop reason',
          code: 'STREAM_INCOMPLETE',
        });
      }

      addTraceEvent(trace, {
        type: 'llm_response',
        data: {
          provider: currentProvider.id,
          stopReason: finalStopReason,
          usage: finalUsage,
          toolCallCount: toolUses.length,
          text: textParts.join(''),
        },
      });

      // Build assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content:
          toolUses.length > 0
            ? [
              ...(textParts.length > 0 ? [{ type: 'text' as const, text: textParts.join('') }] : []),
              ...toolUses.map((t) => ({ type: 'tool_use' as const, ...t })),
            ]
            : textParts.join(''),
      };

      return ok({
        assistantMessage,
        usage: finalUsage,
        stopReason: finalStopReason,
      });
    } catch (error) {
      if (error instanceof NexusError) {
        return err(error);
      }

      return err(
        new ProviderError(
          currentProvider.id,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined,
        ),
      );
    }
  };

  // Try primary provider
  const primaryResult = await attemptCall(provider);

  // If primary failed and we have failover config, try fallback
  if (
    !primaryResult.ok &&
    fallbackProvider &&
    shouldFailover(primaryResult.error, agentConfig.failover)
  ) {
    params.onFallback?.();

    addTraceEvent(trace, {
      type: 'failover',
      data: {
        from: provider.id,
        to: fallbackProvider.id,
        reason: primaryResult.error.code,
      },
    });

    return attemptCall(fallbackProvider);
  }

  return primaryResult;
}

/**
 * Check if we should failover based on the error and failover config.
 */
function shouldFailover(error: NexusError, failoverConfig: AgentConfig['failover']): boolean {
  if (error.code === 'RATE_LIMIT_EXCEEDED' && failoverConfig.onRateLimit) {
    return true;
  }
  if (error.statusCode >= 500 && failoverConfig.onServerError) {
    return true;
  }
  if (error.code === 'TIMEOUT' && failoverConfig.onTimeout) {
    return true;
  }
  return false;
}

/**
 * Extract tool calls from an assistant message.
 */
function extractToolCalls(
  message: Message,
): { id: string; name: string; input: Record<string, unknown> }[] {
  if (typeof message.content === 'string') {
    return [];
  }

  return message.content
    .filter((part): part is Extract<typeof part, { type: 'tool_use' }> => part.type === 'tool_use')
    .map((part) => ({
      id: part.id,
      name: part.name,
      input: part.input,
    }));
}

/**
 * Add a trace event to the execution trace.
 */
function addTraceEvent(
  trace: ExecutionTrace,
  event: {
    type: TraceEvent['type'];
    data: Record<string, unknown>;
    durationMs?: number;
  },
): void {
  trace.events.push({
    id: randomUUID(),
    traceId: trace.id,
    type: event.type,
    timestamp: new Date(),
    durationMs: event.durationMs,
    data: event.data,
  });
}

/**
 * Extract the final assistant response text from the conversation.
 */
function extractFinalResponse(conversation: Message[]): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    if (msg?.role !== 'assistant') continue;

    if (typeof msg.content === 'string') {
      return msg.content;
    }

    // Content is an array of parts — join text parts
    return msg.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

/**
 * Calculate cost in USD for a given usage.
 * Delegates to the provider's cost calculation.
 */
function calculateUsageCost(
  provider: string,
  model: string,
  usage: TokenUsage,
): number {
  void provider;
  return calculateCost(model, usage.inputTokens, usage.outputTokens);
}

/**
 * Tools that are worth persisting to long-term memory after execution.
 * Notably excludes utility tools (calculator, date-time) and meta-tools (store-memory itself).
 */
const MEMORY_WORTHY_TOOLS = new Set([
  'catalog-search',
  'catalog-order',
  'vehicle-lead-score',
  'vehicle-check-followup',
  'wholesale-order-history',
  'wholesale-update-stock',
  'knowledge-search',
  'web-search',
]);

/**
 * Fire-and-forget: store a compact memory of a notable tool execution.
 * Called after successful tool executions for tools in MEMORY_WORTHY_TOOLS.
 * Failures are silently swallowed — memory auto-store is best-effort.
 */
async function autoStoreToolMemory(
  memoryManager: MemoryManager,
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
  context: ExecutionContext,
): Promise<void> {
  if (!MEMORY_WORTHY_TOOLS.has(toolName)) return;

  const inputSummary = JSON.stringify(input).substring(0, 200);
  const outputSummary = JSON.stringify(output).substring(0, 200);
  const content = `Tool '${toolName}' used. Input: ${inputSummary}. Result: ${outputSummary}`;

  await memoryManager.storeMemory({
    projectId: context.projectId,
    sessionId: context.sessionId,
    category: 'task_context',
    content,
    embedding: [], // auto-generated by prisma-memory-store
    importance: 0.5,
  });
}
```

---
## src/core/types.ts
```typescript
// ─── Branded ID Types ────────────────────────────────────────────
// Branded types prevent accidentally passing a SessionId where a ProjectId is expected.

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type TraceId = Brand<string, 'TraceId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type PromptLayerId = Brand<string, 'PromptLayerId'>;
export type UsageRecordId = Brand<string, 'UsageRecordId'>;
export type ScheduledTaskId = Brand<string, 'ScheduledTaskId'>;
export type ScheduledTaskRunId = Brand<string, 'ScheduledTaskRunId'>;

// ─── LLM Provider Config ────────────────────────────────────────

export interface LLMProviderConfig {
  /** Provider identifier. */
  provider: 'anthropic' | 'openai' | 'google' | 'ollama';
  /** Model identifier (e.g. 'claude-sonnet-4-5-20250929', 'gpt-4o'). */
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** References an env var name, never the raw key. */
  apiKeyEnvVar?: string;
  /** Custom base URL for self-hosted providers (e.g. Ollama). */
  baseUrl?: string;
}

// ─── Failover Config ────────────────────────────────────────────

export interface FailoverConfig {
  onRateLimit: boolean;
  onServerError: boolean;
  onTimeout: boolean;
  timeoutMs: number;
  maxRetries: number;
}

// ─── Memory Config ──────────────────────────────────────────────

export interface MemoryConfig {
  longTerm: {
    enabled: boolean;
    maxEntries: number;
    retrievalTopK: number;
    embeddingProvider: string;
    decayEnabled: boolean;
    decayHalfLifeDays: number;
  };
  contextWindow: {
    reserveTokens: number;
    pruningStrategy: 'turn-based' | 'token-based';
    maxTurnsInContext: number;
    compaction: {
      enabled: boolean;
      memoryFlushBeforeCompaction: boolean;
    };
  };
}

// ─── Cost Config ────────────────────────────────────────────────

export interface CostConfig {
  dailyBudgetUSD: number;
  monthlyBudgetUSD: number;
  maxTokensPerTurn: number;
  maxTurnsPerSession: number;
  maxToolCallsPerTurn: number;
  alertThresholdPercent: number;
  hardLimitPercent: number;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
}

// ─── MCP Server Config ─────────────────────────────────────────

/** Configuration for a single MCP server connection (inline in AgentConfig). */
export interface MCPServerConfigRef {
  /** Unique identifier for this server (e.g. "google-calendar"). */
  name: string;
  /** Transport type: stdio spawns a subprocess, sse connects via HTTP. */
  transport: 'stdio' | 'sse';
  /** For stdio: command to run (e.g. "npx"). */
  command?: string;
  /** For stdio: arguments for the command. */
  args?: string[];
  /** For stdio: env var NAMES to resolve and pass to the subprocess. */
  env?: Record<string, string>;
  /** For sse: URL of the MCP server. */
  url?: string;
  /** Namespace prefix for tool IDs. Defaults to server name. */
  toolPrefix?: string;
}

// ─── Agent Config ───────────────────────────────────────────────

export interface AgentConfig {
  projectId: ProjectId;
  agentRole: string;

  /** Primary LLM provider. */
  provider: LLMProviderConfig;
  /** Failover LLM provider (optional). */
  fallbackProvider?: LLMProviderConfig;
  failover: FailoverConfig;

  /** Whitelist of tool IDs this agent can use. */
  allowedTools: string[];

  /** MCP servers to connect to for external tools. */
  mcpServers?: MCPServerConfigRef[];

  memoryConfig: MemoryConfig;
  costConfig: CostConfig;

  maxTurnsPerSession: number;
  maxConcurrentSessions: number;
}

// ─── Execution Context ──────────────────────────────────────────

export interface ExecutionContext {
  projectId: ProjectId;
  sessionId: SessionId;
  traceId: TraceId;
  agentConfig: AgentConfig;
  permissions: {
    allowedTools: ReadonlySet<string>;
  };
  abortSignal: AbortSignal;
}

// ─── Trace Events ───────────────────────────────────────────────

export type TraceEventType =
  | 'llm_request'
  | 'llm_response'
  | 'tool_call'
  | 'tool_result'
  | 'tool_blocked'
  | 'tool_hallucination'
  | 'approval_requested'
  | 'approval_resolved'
  | 'memory_retrieval'
  | 'memory_store'
  | 'compaction'
  | 'error'
  | 'cost_check'
  | 'cost_alert'
  | 'failover';

export interface TraceEvent {
  id: string;
  traceId: TraceId;
  type: TraceEventType;
  timestamp: Date;
  durationMs?: number;
  data: Record<string, unknown>;
  parentEventId?: string;
}

export type ExecutionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'budget_exceeded'
  | 'max_turns'
  | 'human_approval_pending'
  | 'aborted';

// ─── Prompt Snapshot ───────────────────────────────────────────

/**
 * Records which combination of prompt layers was used in an execution.
 * Stored as JSON in ExecutionTrace for audit & performance correlation.
 */
export interface PromptSnapshot {
  identityLayerId: PromptLayerId;
  identityVersion: number;
  instructionsLayerId: PromptLayerId;
  instructionsVersion: number;
  safetyLayerId: PromptLayerId;
  safetyVersion: number;
  /** SHA-256 hash of the generated tool docs section. */
  toolDocsHash: string;
  /** SHA-256 hash of the runtime context section. */
  runtimeContextHash: string;
}

// ─── Execution Trace ───────────────────────────────────────────

export interface ExecutionTrace {
  id: TraceId;
  projectId: ProjectId;
  sessionId: SessionId;
  /** Snapshot of the prompt layer versions used in this execution. */
  promptSnapshot: PromptSnapshot;
  events: TraceEvent[];
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUSD: number;
  turnCount: number;
  status: ExecutionStatus;
  createdAt: Date;
  completedAt?: Date;
}
```

---
## src/core/errors.ts
```typescript
/**
 * Base error class for all Nexus Core errors.
 * Extends Error with a machine-readable code, HTTP status, and structured context.
 */
export class NexusError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(params: {
    message: string;
    code: string;
    statusCode?: number;
    cause?: Error;
    context?: Record<string, unknown>;
    isOperational?: boolean;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'NexusError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.context = params.context;
    this.isOperational = params.isOperational ?? true;
  }
}

/** Thrown when a project exceeds its daily or monthly LLM budget. */
export class BudgetExceededError extends NexusError {
  constructor(projectId: string, budgetType: 'daily' | 'monthly', current: number, limit: number) {
    super({
      message: `${budgetType} budget exceeded for project ${projectId}: $${current.toFixed(2)}/$${limit.toFixed(2)}`,
      code: 'BUDGET_EXCEEDED',
      statusCode: 429,
      context: { projectId, budgetType, current, limit },
    });
    this.name = 'BudgetExceededError';
  }
}

/** Thrown when the agent tries to use a tool not in the project's whitelist. */
export class ToolNotAllowedError extends NexusError {
  constructor(toolId: string, projectId: string) {
    super({
      message: `Tool "${toolId}" is not in the allowed list for project "${projectId}"`,
      code: 'TOOL_NOT_ALLOWED',
      statusCode: 403,
      context: { toolId, projectId },
    });
    this.name = 'ToolNotAllowedError';
  }
}

/** Thrown when the LLM requests a tool that does not exist in the registry. */
export class ToolHallucinationError extends NexusError {
  constructor(toolId: string, availableTools: string[]) {
    super({
      message: `LLM requested non-existent tool "${toolId}"`,
      code: 'TOOL_HALLUCINATION',
      statusCode: 400,
      context: { toolId, availableTools },
    });
    this.name = 'ToolHallucinationError';
  }
}

/** Thrown when a tool requires human approval before execution. */
export class ApprovalRequiredError extends NexusError {
  constructor(toolId: string, approvalId: string) {
    super({
      message: `Tool "${toolId}" requires human approval (${approvalId})`,
      code: 'APPROVAL_REQUIRED',
      statusCode: 202,
      context: { toolId, approvalId },
    });
    this.name = 'ApprovalRequiredError';
  }
}

/** Thrown when an LLM provider call fails. */
export class ProviderError extends NexusError {
  constructor(provider: string, message: string, cause?: Error) {
    super({
      message: `LLM provider "${provider}" error: ${message}`,
      code: 'PROVIDER_ERROR',
      statusCode: 502,
      cause,
      context: { provider },
    });
    this.name = 'ProviderError';
  }
}

/** Thrown when input validation (Zod) fails. */
export class ValidationError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      context,
    });
    this.name = 'ValidationError';
  }
}

/** Thrown when a session-level error occurs (max turns, expired, etc.). */
export class SessionError extends NexusError {
  constructor(message: string, sessionId: string) {
    super({
      message,
      code: 'SESSION_ERROR',
      statusCode: 400,
      context: { sessionId },
    });
    this.name = 'SessionError';
  }
}

/** Thrown when rate limits are exceeded. */
export class RateLimitError extends NexusError {
  constructor(projectId: string, limitType: 'rpm' | 'rph', current: number, limit: number) {
    super({
      message: `Rate limit (${limitType}) exceeded for project ${projectId}: ${current}/${limit}`,
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      context: { projectId, limitType, current, limit },
    });
    this.name = 'RateLimitError';
  }
}

/** Thrown when a requested secret key does not exist for the project. */
export class SecretNotFoundError extends NexusError {
  constructor(projectId: string, key: string) {
    super({
      message: `Secret "${key}" not found for project "${projectId}"`,
      code: 'SECRET_NOT_FOUND',
      statusCode: 404,
      context: { projectId, key },
    });
    this.name = 'SecretNotFoundError';
  }
}

/** Thrown when a tool's execute() or dryRun() fails at runtime. */
export class ToolExecutionError extends NexusError {
  constructor(toolId: string, message: string, cause?: Error) {
    super({
      message: `Tool "${toolId}" execution failed: ${message}`,
      code: 'TOOL_EXECUTION_ERROR',
      statusCode: 500,
      cause,
      context: { toolId },
    });
    this.name = 'ToolExecutionError';
  }
}
```

---
## src/core/result.ts
```typescript
/**
 * Discriminated union for operations that can fail expectedly.
 * Forces callers to handle both success and failure paths.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Create a successful Result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Create a failed Result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Type guard for successful Result. */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

/** Type guard for failed Result. */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/**
 * Unwrap a Result, throwing if it's an error.
 * Only use in tests or truly unrecoverable situations.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}
```

---
## src/core/stream-events.ts
```typescript
/**
 * AgentStreamEvent — Events streamed from the agent runner to clients.
 *
 * Used by the WebSocket `/chat/stream` endpoint to provide real-time
 * feedback during agent execution. These are client-facing events,
 * distinct from the internal TraceEvent types used for observability.
 */

/** Events streamed from server to client during an agent run. */
export type AgentStreamEvent =
  | AgentStartEvent
  | ContentDeltaEvent
  | ToolUseStartEvent
  | ToolResultEvent
  | TurnCompleteEvent
  | AgentCompleteEvent
  | ApprovalRequestedEvent
  | StreamErrorEvent;

/** An approval is requested by a tool. */
export interface ApprovalRequestedEvent {
  readonly type: 'approval_requested';
  readonly toolCallId: string;
  readonly toolId: string;
  readonly approvalId: string;
  readonly input: unknown;
}

/** Agent run has been initiated. */
export interface AgentStartEvent {
  readonly type: 'agent_start';
  readonly sessionId: string;
  readonly traceId: string;
}

/** Streaming text chunk from the LLM. */
export interface ContentDeltaEvent {
  readonly type: 'content_delta';
  readonly text: string;
}

/** A tool call is about to be executed. */
export interface ToolUseStartEvent {
  readonly type: 'tool_use_start';
  readonly toolCallId: string;
  readonly toolId: string;
  readonly input: Record<string, unknown>;
}

/** A tool call has completed (success or failure). */
export interface ToolResultEvent {
  readonly type: 'tool_result';
  readonly toolCallId: string;
  readonly toolId: string;
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string;
}

/** One agent turn has completed (LLM call + tool executions). */
export interface TurnCompleteEvent {
  readonly type: 'turn_complete';
  readonly turnNumber: number;
}

/** The full agent run has completed. */
export interface AgentCompleteEvent {
  readonly type: 'agent_complete';
  readonly response: string;
  readonly usage: {
    readonly totalTokens: number;
    readonly costUSD: number;
  };
  readonly status: string;
}

/** An error occurred during the agent run. */
export interface StreamErrorEvent {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}
```

---
## src/core/index.ts
```typescript
// Core module — agent loop, execution engine, shared types
export type {
  AgentConfig,
  ApprovalId,
  CostConfig,
  ExecutionContext,
  ExecutionStatus,
  ExecutionTrace,
  FailoverConfig,
  LLMProviderConfig,
  MemoryConfig,
  MessageId,
  ProjectId,
  PromptLayerId,
  PromptSnapshot,
  ScheduledTaskId,
  ScheduledTaskRunId,
  SessionId,
  ToolCallId,
  TraceEvent,
  TraceEventType,
  TraceId,
  UsageRecordId,
} from './types.js';

export type { Result } from './result.js';
export { ok, err, isOk, isErr, unwrap } from './result.js';

export {
  NexusError,
  BudgetExceededError,
  ToolNotAllowedError,
  ToolHallucinationError,
  ApprovalRequiredError,
  ProviderError,
  ValidationError,
  SessionError,
  RateLimitError,
} from './errors.js';

export { createAgentRunner } from './agent-runner.js';
export type { AgentRunner, AgentRunnerOptions } from './agent-runner.js';

export type {
  AgentStreamEvent,
  AgentStartEvent,
  ContentDeltaEvent,
  ToolUseStartEvent,
  ToolResultEvent,
  TurnCompleteEvent,
  AgentCompleteEvent,
  StreamErrorEvent,
} from './stream-events.js';
```

