/**
 * WebSocket chat streaming route.
 *
 * Accepts a WebSocket connection at /chat/stream, receives chat request
 * messages, and streams AgentStreamEvent objects back to the client in
 * real time via the agent runner's onEvent callback.
 *
 * Protocol:
 *   Client → Server: JSON matching chatRequestSchema { projectId, sessionId?, message, metadata? }
 *   Server → Client: JSON AgentStreamEvent objects (agent_start, content_delta, tool_use_start, ...)
 *
 * Only one agent run may be active per connection at a time. A second
 * message while a run is in progress receives an error event.
 */
import type { FastifyInstance } from 'fastify';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { AgentStreamEvent } from '@/core/stream-events.js';
import type { RouteDependencies } from '../types.js';
import {
  chatRequestSchema,
  prepareChatRun,
  extractAssistantResponse,
  type ChatRequestBody,
} from './chat-setup.js';

// ─── Core Handler ───────────────────────────────────────────────

/**
 * Process a single chat stream message.
 *
 * Extracted from the WebSocket route for testability. Runs the full
 * agent loop, streaming events via `send`, and persists messages on
 * completion.
 */
export async function handleChatStreamMessage(
  body: ChatRequestBody,
  deps: RouteDependencies,
  send: (event: AgentStreamEvent) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  // 1. Run shared setup
  const setupResult = await prepareChatRun(body, deps);
  if (!setupResult.ok) {
    send({
      type: 'error',
      code: setupResult.error.code,
      message: setupResult.error.message,
    });
    return;
  }

  const setup = setupResult.value;

  // 2. Create agent runner and execute with streaming callback
  const agentRunner = createAgentRunner({
    provider: setup.provider,
    fallbackProvider: setup.fallbackProvider,
    toolRegistry: deps.toolRegistry,
    memoryManager: setup.memoryManager,
    costGuard: setup.costGuard,
    logger: deps.logger,
  });

  const result = await agentRunner.run({
    message: setup.sanitizedMessage,
    agentConfig: setup.agentConfig,
    sessionId: setup.sessionId,
    systemPrompt: setup.systemPrompt,
    promptSnapshot: setup.promptSnapshot,
    conversationHistory: setup.conversationHistory,
    abortSignal,
    onEvent: send,
  });

  if (!result.ok) {
    send({
      type: 'error',
      code: result.error.code,
      message: result.error.message,
    });
    return;
  }

  // 3. Persist execution trace and messages
  const trace = result.value;

  await deps.executionTraceRepository.save(trace);

  await deps.sessionRepository.addMessage(
    setup.sessionId,
    { role: 'user', content: setup.sanitizedMessage },
    trace.id,
  );

  const assistantText = extractAssistantResponse(trace.events);

  await deps.sessionRepository.addMessage(
    setup.sessionId,
    { role: 'assistant', content: assistantText },
    trace.id,
  );
}

// ─── Socket Interface ───────────────────────────────────────────

/** Minimal WebSocket interface consumed by the route handler. */
interface ChatSocket {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  removeListener(event: 'close', listener: () => void): void;
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Set up event handlers on a single WebSocket connection. */
function setupSocket(socket: ChatSocket, deps: RouteDependencies): void {
  let running = false;

  const send = (event: AgentStreamEvent): void => {
    // 1 === WebSocket.OPEN
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(event));
    }
  };

  socket.on('message', (data: Buffer) => {
    if (running) {
      send({ type: 'error', code: 'BUSY', message: 'Agent run already in progress' });
      return;
    }

    let body: ChatRequestBody;
    try {
      const text = data.toString('utf-8');
      const parsed: unknown = JSON.parse(text);
      body = chatRequestSchema.parse(parsed);
    } catch {
      send({ type: 'error', code: 'VALIDATION_ERROR', message: 'Invalid message format' });
      return;
    }

    running = true;
    const messageAbort = new AbortController();
    const onClose = (): void => {
      messageAbort.abort();
    };
    socket.on('close', onClose);

    handleChatStreamMessage(body, deps, send, messageAbort.signal)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unexpected error';
        send({ type: 'error', code: 'INTERNAL_ERROR', message: msg });
      })
      .finally(() => {
        running = false;
        socket.removeListener('close', onClose);
      });
  });

  socket.on('error', (err: Error) => {
    deps.logger.error('WebSocket error', {
      component: 'chat-stream',
      error: err.message,
    });
  });
}

/** Register the WebSocket /chat/stream route. */
export function chatStreamRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  fastify.get('/chat/stream', { websocket: true }, (socket) => {
    setupSocket(socket as unknown as ChatSocket, deps);
  });
}
