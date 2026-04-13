/**
 * WebSocket protocol adapter for the Nexus Dashboard.
 *
 * The dashboard uses a different WebSocket protocol than the backend's
 * internal /chat/stream endpoint. This adapter translates between the two:
 *
 * Dashboard → Backend:
 *   { type: 'auth', apiKey }         → validates API key via ApiKeyService
 *   { type: 'session.create', ... }  → create session via sessionRepository
 *   { type: 'message.send', content} → agent run via handleChatStreamMessage
 *   { type: 'approval.decide', ... } → resolve approval via approvalGate
 *
 * Backend → Dashboard (AgentStreamEvent → NexusEvent):
 *   agent_start     → session.created
 *   content_delta   → message.content_delta
 *   tool_use_start  → message.tool_start
 *   tool_result     → message.tool_complete
 *   agent_complete  → message.complete
 *   error           → error
 */
import type { FastifyInstance } from 'fastify';
import type { AgentStreamEvent } from '@/core/stream-events.js';
import type { ProjectId, ApprovalId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { handleChatStreamMessage } from './chat-stream.js';

// ─── Dashboard Protocol Types ───────────────────────────────────

interface AuthMessage {
  type: 'auth';
  apiKey: string;
}

interface SessionCreateMessage {
  type: 'session.create';
  agentId?: string;
  sourceChannel?: string;
  contactRole?: string;
  metadata?: Record<string, unknown>;
}

interface MessageSendMessage {
  type: 'message.send';
  content: string;
  sourceChannel?: string;
  contactRole?: string;
}

interface ApprovalDecideMessage {
  type: 'approval.decide';
  approvalId: string;
  approved: boolean;
  note?: string;
}

type DashboardInboundMessage =
  | AuthMessage
  | SessionCreateMessage
  | MessageSendMessage
  | ApprovalDecideMessage;

// ─── NexusEvent (dashboard outbound) ────────────────────────────

type NexusEventBase = Record<string, unknown> & { type: string };

// ─── Event Mapping ──────────────────────────────────────────────

/** Map an AgentStreamEvent to the dashboard's NexusEvent format. */
function mapEvent(event: AgentStreamEvent, traceId: string): NexusEventBase | null {
  switch (event.type) {
    case 'agent_start':
      return {
        type: 'session.created',
        sessionId: event.sessionId,
      };

    case 'content_delta':
      return {
        type: 'message.content_delta',
        text: event.text,
      };

    case 'tool_use_start':
      return {
        type: 'message.tool_start',
        toolCallId: event.toolCallId,
        tool: event.toolId,
        input: event.input,
      };

    case 'tool_result':
      return {
        type: 'message.tool_complete',
        toolCallId: event.toolCallId,
        success: event.success,
        output: event.output,
        durationMs: 0,
      };

    case 'approval_requested':
      return {
        type: 'message.approval_required',
        toolCallId: event.toolCallId,
        tool: event.toolId,
        approvalId: event.approvalId,
        action: event.input,
      };

    case 'message_queued':
      return {
        type: 'message.queued',
        position: event.position,
      };

    case 'turn_complete':
      // No dashboard equivalent — skip
      return null;

    case 'agent_complete':
      return {
        type: 'message.complete',
        messageId: traceId,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: event.usage.costUSD,
        },
        traceId,
      };

    case 'error':
      return {
        type: 'error',
        code: event.code,
        message: event.message,
      };

    default:
      return null;
  }
}

// ─── Socket Interface ───────────────────────────────────────────

/** Minimal WebSocket interface consumed by the route handler. */
interface DashboardSocket {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  removeListener(event: 'close', listener: () => void): void;
}

// ─── Connection Handler ─────────────────────────────────────────

function setupDashboardSocket(
  socket: DashboardSocket,
  projectId: string,
  deps: RouteDependencies,
): void {
  let authenticated = false;
  let sessionId: string | null = null;
  let agentId: string | null = null;
  let sourceChannel: string | null = null;
  let contactRole: string | null = null;
  let running = false;
  let traceId = '';
  let unsubscribeBroadcast: (() => void) | null = null;
  // Track approval IDs resolved by THIS WS connection to avoid broadcast duplicates
  let dashboardResolvedApprovalId: string | null = null;
  // FIFO queue for messages that arrive while a run is in progress
  const messageQueue: MessageSendMessage[] = [];

  const sendEvent = (event: NexusEventBase): void => {
    // 1 === WebSocket.OPEN
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(event));
    }
  };

  const sendError = (code: string, message: string): void => {
    sendEvent({ type: 'error', code, message });
  };

  /** Execute a single message.send and drain the queue on completion. */
  function runMessage(msg: MessageSendMessage): void {
    if (!sessionId) {
      sendError('NO_SESSION', 'No active session');
      return;
    }
    const currentSessionId = sessionId;
    running = true;
    traceId = `trace-${Date.now()}`;
    const messageAbort = new AbortController();
    const onClose = (): void => {
      messageAbort.abort();
    };
    socket.on('close', onClose);

    const wrappedSend = (event: AgentStreamEvent): void => {
      if (event.type === 'agent_start') {
        traceId = event.traceId;
      }
      const mapped = mapEvent(event, traceId);
      if (mapped) {
        sendEvent(mapped);
      }
    };

    handleChatStreamMessage(
      {
        projectId,
        sessionId: currentSessionId,
        agentId: agentId ?? undefined,
        sourceChannel: msg.sourceChannel ?? sourceChannel ?? undefined,
        contactRole: msg.contactRole ?? contactRole ?? undefined,
        message: msg.content,
      },
      deps,
      wrappedSend,
      messageAbort.signal,
    )
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : 'Unexpected error';
        sendError('INTERNAL_ERROR', errMsg);
      })
      .finally(() => {
        running = false;
        socket.removeListener('close', onClose);
        drainQueue();
      });
  }

  /** Process the next queued message, if any. */
  function drainQueue(): void {
    const next = messageQueue.shift();
    if (next && sessionId) {
      runMessage(next);
    }
  }

  socket.on('message', (data: Buffer) => {
    let msg: DashboardInboundMessage;
    try {
      const text = data.toString('utf-8');
      msg = JSON.parse(text) as DashboardInboundMessage;
    } catch {
      sendError('PARSE_ERROR', 'Invalid JSON');
      return;
    }

    switch (msg.type) {
      case 'auth': {
        if (!msg.apiKey) {
          sendError('AUTH_FAILED', 'API key is required');
          return;
        }

        deps.apiKeyService
          .validateApiKey(msg.apiKey)
          .then((result) => {
            if (!result.valid) {
              sendError('AUTH_FAILED', 'Invalid or revoked API key');
              return;
            }
            // If the key is scoped to a project, verify it matches this connection's project
            if (result.projectId && result.projectId !== projectId) {
              sendError('AUTH_FAILED', 'API key does not have access to this project');
              return;
            }
            authenticated = true;
            sendEvent({ type: 'auth.success' });
          })
          .catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : 'Authentication failed';
            sendError('AUTH_FAILED', errMsg);
          });
        break;
      }

      case 'session.create': {
        if (!authenticated) {
          sendError('AUTH_REQUIRED', 'Must authenticate before creating a session');
          return;
        }

        // Store agentId + channel info for subsequent message.send calls
        agentId = msg.agentId ?? null;
        sourceChannel = msg.sourceChannel ?? null;
        contactRole = msg.contactRole ?? null;

        deps.sessionRepository
          .create({
            projectId: projectId as ProjectId,
            metadata: { ...msg.metadata, agentId: agentId ?? undefined },
          })
          .then((session) => {
            sessionId = session.id;
            sendEvent({
              type: 'session.created',
              sessionId: session.id,
            });

            // Subscribe to session broadcasts (external approval resolutions, e.g. Telegram)
            unsubscribeBroadcast = deps.sessionBroadcaster.subscribe(session.id, (broadcastMsg) => {
              // Skip events for approvals resolved by THIS dashboard connection
              if (broadcastMsg['approvalId'] === dashboardResolvedApprovalId) return;

              if (broadcastMsg.type === 'approval.resolved') {
                sendEvent({
                  type: 'approval.decided',
                  approvalId: broadcastMsg['approvalId'] as string,
                  decision: broadcastMsg['decision'] as string,
                  resolvedBy: broadcastMsg['resolvedBy'] as string,
                });
              }

              if (broadcastMsg.type === 'message.new') {
                sendEvent({
                  type: 'message.content_delta',
                  text: broadcastMsg['content'] as string,
                });
                sendEvent({
                  type: 'message.complete',
                  messageId: `external-${Date.now()}`,
                  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
                  traceId: '',
                });
              }
            });
          })
          .catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : 'Failed to create session';
            sendError('SESSION_ERROR', errMsg);
          });
        break;
      }

      case 'message.send': {
        if (!authenticated) {
          sendError('AUTH_REQUIRED', 'Must authenticate first');
          return;
        }
        if (!sessionId) {
          sendError('NO_SESSION', 'Must create a session before sending messages');
          return;
        }
        if (running) {
          // Queue the message instead of rejecting it
          messageQueue.push(msg);
          sendEvent({ type: 'message.queued', position: messageQueue.length });
          return;
        }

        runMessage(msg);
        break;
      }

      case 'approval.decide': {
        if (!authenticated) {
          sendError('AUTH_REQUIRED', 'Must authenticate first');
          return;
        }

        // Mark this approval as resolved by THIS connection to skip broadcast duplicates
        dashboardResolvedApprovalId = msg.approvalId;

        const decision = msg.approved ? 'approved' : 'denied';
        deps.approvalGate
          .resolve(msg.approvalId as ApprovalId, decision, 'dashboard', msg.note)
          .then(async (resolved) => {
            if (!resolved) {
              sendError('NOT_FOUND', `Approval ${msg.approvalId} not found`);
              return;
            }
            sendEvent({
              type: 'approval.decided',
              approvalId: msg.approvalId,
              decision,
            });

            // Resume agent loop and stream output to frontend
            try {
              const approval = await deps.approvalGate.get(msg.approvalId as ApprovalId);
              if (approval && approval.sessionId && approval.toolCallId) {
                await deps.sessionRepository.addMessage(
                  approval.sessionId,
                  {
                    role: 'tool',
                    content: JSON.stringify({ approved: msg.approved, note: msg.note }),
                  },
                  `trace-resume-${Date.now()}` as import('@/core/types.js').TraceId
                );

                if (running) {
                  sendError('BUSY', 'Agent run already in progress');
                  return;
                }

                running = true;
                traceId = `trace-resume-${Date.now()}`;
                const messageAbort = new AbortController();
                const onClose = (): void => {
                  messageAbort.abort();
                };
                socket.on('close', onClose);

                const wrappedSend = (event: AgentStreamEvent): void => {
                  if (event.type === 'agent_start') {
                    traceId = event.traceId;
                  }
                  const mapped = mapEvent(event, traceId);
                  if (mapped) sendEvent(mapped);
                };

                await handleChatStreamMessage(
                  {
                    projectId,
                    sessionId: approval.sessionId,
                    agentId: agentId ?? undefined,
                    sourceChannel: sourceChannel ?? undefined,
                    contactRole: contactRole ?? undefined,
                    message: undefined,
                  },
                  deps,
                  wrappedSend,
                  messageAbort.signal
                ).finally(() => {
                  running = false;
                  socket.removeListener('close', onClose);
                });
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : 'Failed to resume agent';
              sendError('RESUME_ERROR', errMsg);
            }
          })
          .catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : 'Failed to decide approval';
            sendError('APPROVAL_ERROR', errMsg);
          });
        break;
      }

      default: {
        sendError('UNKNOWN_TYPE', `Unknown message type: ${(msg as { type: string }).type}`);
      }
    }
  });

  // Log socket close with code/reason for diagnostics + clean up broadcast subscription
  (socket as unknown as {
    on(event: 'close', listener: (code: number, reason: Buffer) => void): void;
  }).on('close', (code, reason) => {
    unsubscribeBroadcast?.();
    deps.logger.info('Dashboard WebSocket closed', {
      component: 'ws-dashboard',
      projectId,
      code,
      reason: reason.toString(),
      wasRunning: running,
    });
  });

  socket.on('error', (err: Error) => {
    deps.logger.error('Dashboard WebSocket error', {
      component: 'ws-dashboard',
      error: err.message,
    });
  });
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register the dashboard WebSocket route at /ws. */
export function wsDashboardRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    const query = request.query as Record<string, string>;
    const projectId = query['projectId'] ?? '';

    if (!projectId) {
      const s = socket as unknown as DashboardSocket;
      if (s.readyState === 1) {
        s.send(JSON.stringify({
          type: 'error',
          code: 'MISSING_PROJECT',
          message: 'projectId query parameter is required',
        }));
      }
      return;
    }

    setupDashboardSocket(socket as unknown as DashboardSocket, projectId, deps);
  });
}
