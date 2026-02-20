/**
 * WebSocket protocol adapter for the Nexus Dashboard.
 *
 * The dashboard uses a different WebSocket protocol than the backend's
 * internal /chat/stream endpoint. This adapter translates between the two:
 *
 * Dashboard → Backend:
 *   { type: 'auth', apiKey }         → auth validation (skipped for now)
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
  metadata?: Record<string, unknown>;
}

interface MessageSendMessage {
  type: 'message.send';
  content: string;
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
  let running = false;
  let traceId = '';

  const sendEvent = (event: NexusEventBase): void => {
    // 1 === WebSocket.OPEN
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(event));
    }
  };

  const sendError = (code: string, message: string): void => {
    sendEvent({ type: 'error', code, message });
  };

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
        // TODO: Validate API key against project config
        // For now, accept any key and mark as authenticated
        authenticated = true;
        sendEvent({ type: 'auth.success' });
        break;
      }

      case 'session.create': {
        if (!authenticated) {
          sendError('AUTH_REQUIRED', 'Must authenticate before creating a session');
          return;
        }

        // Store agentId for subsequent message.send calls
        agentId = msg.agentId ?? null;

        deps.sessionRepository
          .create({
            projectId: projectId as ProjectId,
            metadata: msg.metadata,
          })
          .then((session) => {
            sessionId = session.id;
            sendEvent({
              type: 'session.created',
              sessionId: session.id,
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
          sendError('BUSY', 'Agent run already in progress');
          return;
        }

        running = true;
        traceId = `trace-${Date.now()}`;
        const messageAbort = new AbortController();
        const onClose = (): void => {
          messageAbort.abort();
        };
        socket.on('close', onClose);

        const wrappedSend = (event: AgentStreamEvent): void => {
          // Capture traceId from agent_start
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
            sessionId,
            agentId: agentId ?? undefined,
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
          });
        break;
      }

      case 'approval.decide': {
        if (!authenticated) {
          sendError('AUTH_REQUIRED', 'Must authenticate first');
          return;
        }

        const decision = msg.approved ? 'approved' : 'denied';
        deps.approvalGate
          .resolve(msg.approvalId as ApprovalId, decision, 'dashboard', msg.note)
          .then((resolved) => {
            if (!resolved) {
              sendError('NOT_FOUND', `Approval ${msg.approvalId} not found`);
              return;
            }
            sendEvent({
              type: 'approval.decided',
              approvalId: msg.approvalId,
              decision,
            });
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
