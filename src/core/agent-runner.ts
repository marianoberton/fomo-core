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
    message: string;
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
        const conversation: Message[] = [
          ...conversationHistory,
          { role: 'user', content: message },
        ];

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

          // Check abort signal
          if (context.abortSignal.aborted) {
            trace.status = 'aborted';
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
          const retrievedMemories = await memoryManager.retrieveMemories({
            query: message,
            topK: agentConfig.memoryConfig.longTerm.retrievalTopK,
            sessionScope: sessionId,
          });

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
          const fittedMessages = await memoryManager.fitToContextWindow(conversation);

          // Format tools for provider
          const genericTools = toolRegistry.formatForProvider(context);
          const formattedTools = provider.formatTools(genericTools);

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
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
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
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  if (typeof message.content === 'string') {
    return [];
  }

  return message.content
    .filter((part) => part.type === 'tool_use')
    .map((part) => {
      if (part.type !== 'tool_use') return null;
      return {
        id: part.id,
        name: part.name,
        input: part.input,
      };
    })
    .filter((t): t is { id: string; name: string; input: Record<string, unknown> } => t !== null);
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
    if (!msg || msg.role !== 'assistant') continue;

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
  _provider: string,
  _model: string,
  usage: TokenUsage,
): number {
  // This will be imported from @/providers/models.js when implemented
  // For now, return a placeholder
  const inputCostPer1M = 0.003; // $3 per 1M tokens (Claude Sonnet default)
  const outputCostPer1M = 0.015; // $15 per 1M tokens

  const inputCost = (usage.inputTokens / 1_000_000) * inputCostPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * outputCostPer1M;

  return inputCost + outputCost;
}
