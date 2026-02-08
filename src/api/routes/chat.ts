/**
 * Chat route — main agent endpoint.
 * Accepts a user message, runs the agent loop, and returns the response.
 *
 * This is the synchronous MVP. When BullMQ is integrated, the agent run
 * will be enqueued as a job and this endpoint will return 202 with a traceId.
 */
import type { FastifyInstance } from 'fastify';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import {
  chatRequestSchema,
  prepareChatRun,
  extractAssistantResponse,
  extractToolCalls,
} from './chat-setup.js';

// ─── Route Plugin ───────────────────────────────────────────────

/** Register the POST /chat route. */
export function chatRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  fastify.post('/chat', async (request, reply) => {
    // 1. Validate request
    const body = chatRequestSchema.parse(request.body);

    // 2. Run shared setup (sanitize, load project/session/prompt, create services)
    const setupResult = await prepareChatRun(body, deps);
    if (!setupResult.ok) {
      return sendError(
        reply,
        setupResult.error.code,
        setupResult.error.message,
        setupResult.error.statusCode,
      );
    }

    const {
      sanitizedMessage,
      agentConfig,
      sessionId,
      systemPrompt,
      promptSnapshot,
      conversationHistory,
      provider,
      memoryManager,
      costGuard,
    } = setupResult.value;

    // 3. Create abort controller tied to client disconnect
    const abortController = new AbortController();
    request.raw.on('close', () => {
      if (!request.raw.complete) {
        abortController.abort();
      }
    });

    // 4. Create agent runner and execute
    const agentRunner = createAgentRunner({
      provider,
      toolRegistry: deps.toolRegistry,
      memoryManager,
      costGuard,
      logger: deps.logger,
    });

    const result = await agentRunner.run({
      message: sanitizedMessage,
      agentConfig,
      sessionId,
      systemPrompt,
      promptSnapshot,
      conversationHistory,
      abortSignal: abortController.signal,
    });

    if (!result.ok) {
      throw result.error;
    }

    const trace = result.value;

    // 5. Persist messages
    await deps.sessionRepository.addMessage(sessionId, {
      role: 'user',
      content: sanitizedMessage,
    }, trace.id);

    const assistantText = extractAssistantResponse(trace.events);
    const toolCalls = extractToolCalls(trace.events);

    await deps.sessionRepository.addMessage(sessionId, {
      role: 'assistant',
      content: assistantText,
    }, trace.id);

    // 6. Return response
    return sendSuccess(reply, {
      sessionId,
      traceId: trace.id,
      response: assistantText,
      toolCalls,
      usage: {
        inputTokens: trace.totalTokensUsed,
        outputTokens: 0,
        costUSD: trace.totalCostUSD,
      },
    });
  });
}

