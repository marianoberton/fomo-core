/**
 * TaskExecutor — bridges scheduled tasks to the agent execution loop.
 *
 * Reuses `prepareChatRun` from chat-setup so the same prompt-layer
 * resolution, tool formatting, and cost guard wiring that powers the
 * REST/WebSocket endpoints also drives scheduled task execution.
 *
 * Returns a callback suitable for `TaskRunnerOptions.onExecuteTask`.
 */
import { createAgentRunner } from '@/core/agent-runner.js';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { PromptLayerRepository } from '@/infrastructure/repositories/prompt-layer-repository.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { MCPManager } from '@/mcp/mcp-manager.js';
import type { Logger } from '@/observability/logger.js';
import {
  prepareChatRun,
  extractAssistantResponse,
} from '@/api/routes/chat-setup.js';
import type { ScheduledTask } from './types.js';
import type { TaskExecutionResult } from './task-runner.js';

// ─── Options ────────────────────────────────────────────────────

/** Dependencies required to create a task executor. */
export interface TaskExecutorOptions {
  projectRepository: ProjectRepository;
  sessionRepository: SessionRepository;
  promptLayerRepository: PromptLayerRepository;
  toolRegistry: ToolRegistry;
  mcpManager: MCPManager;
  logger: Logger;
}

// ─── Factory ────────────────────────────────────────────────────

/**
 * Create a task execution callback for the TaskRunner.
 *
 * The returned function resolves the task's project, builds the
 * system prompt from active prompt layers, creates an agent runner,
 * and executes the task payload as a one-shot agent run.
 */
export function createTaskExecutor(
  options: TaskExecutorOptions,
): (task: ScheduledTask) => Promise<TaskExecutionResult> {
  const {
    projectRepository,
    sessionRepository,
    promptLayerRepository,
    toolRegistry,
    mcpManager,
    logger,
  } = options;

  const chatSetupDeps = {
    projectRepository,
    sessionRepository,
    promptLayerRepository,
    toolRegistry,
    mcpManager,
    logger,
  };

  return async (task: ScheduledTask): Promise<TaskExecutionResult> => {
    logger.info('Starting scheduled task execution', {
      component: 'task-executor',
      taskId: task.id,
      taskName: task.name,
      projectId: task.projectId,
    });

    // 1. Prepare the agent run via shared chat setup
    const setupResult = await prepareChatRun(
      {
        projectId: task.projectId,
        message: task.taskPayload.message,
        metadata: task.taskPayload.metadata,
      },
      chatSetupDeps,
    );

    if (!setupResult.ok) {
      logger.error('Task setup failed', {
        component: 'task-executor',
        taskId: task.id,
        error: setupResult.error.message,
        code: setupResult.error.code,
      });
      return {
        success: false,
        errorMessage: `Setup failed: ${setupResult.error.message}`,
      };
    }

    const setup = setupResult.value;

    // 2. Create agent runner
    const agentRunner = createAgentRunner({
      provider: setup.provider,
      toolRegistry,
      memoryManager: setup.memoryManager,
      costGuard: setup.costGuard,
      logger,
    });

    // 3. Execute the agent run with abort signal based on task timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => { abortController.abort(); },
      task.timeoutMs,
    );

    try {
      const result = await agentRunner.run({
        message: setup.sanitizedMessage,
        agentConfig: setup.agentConfig,
        sessionId: setup.sessionId,
        systemPrompt: setup.systemPrompt,
        promptSnapshot: setup.promptSnapshot,
        conversationHistory: setup.conversationHistory,
        abortSignal: abortController.signal,
      });

      if (!result.ok) {
        logger.error('Task agent run failed', {
          component: 'task-executor',
          taskId: task.id,
          error: result.error.message,
          code: result.error.code,
        });
        return {
          success: false,
          errorMessage: result.error.message,
        };
      }

      const trace = result.value;

      // 4. Persist messages to the session
      await sessionRepository.addMessage(
        setup.sessionId,
        { role: 'user', content: setup.sanitizedMessage },
        trace.id,
      );

      const assistantText = extractAssistantResponse(trace.events);

      await sessionRepository.addMessage(
        setup.sessionId,
        { role: 'assistant', content: assistantText },
        trace.id,
      );

      logger.info('Task execution completed', {
        component: 'task-executor',
        taskId: task.id,
        traceId: trace.id,
        status: trace.status,
        tokensUsed: trace.totalTokensUsed,
        costUSD: trace.totalCostUSD.toFixed(4),
      });

      return {
        success: trace.status === 'completed',
        traceId: trace.id,
        tokensUsed: trace.totalTokensUsed,
        costUsd: trace.totalCostUSD,
        result: {
          response: assistantText,
          sessionId: setup.sessionId,
          status: trace.status,
          turnCount: trace.turnCount,
        },
        errorMessage: trace.status !== 'completed'
          ? `Agent run ended with status: ${trace.status}`
          : undefined,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
