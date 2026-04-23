/**
 * Project Event Bus — in-process fan-out of project-scoped events.
 *
 * Subscribers register per projectId and receive only events whose
 * `projectId` matches. Used by the /ws/project/:projectId WebSocket
 * endpoint (live push) and the /platform/events SSE fallback.
 *
 * TODO: When scaling to multiple Node workers, back this with Redis pub/sub
 * (keep the same type surface — only the transport changes).
 */
import { EventEmitter } from 'node:events';
import type {
  ApprovalId,
  ProjectId,
  SessionId,
  TraceId,
} from '@/core/types.js';
import type { ContactId } from '@/contacts/types.js';

// ─── Event Types ─────────────────────────────────────────────────

/**
 * All live events emitted per project. Discriminated by `kind`.
 *
 * Producers call `bus.emit(event)`. Subscribers receive only events
 * whose `projectId` matches their subscription.
 */
export type ProjectEvent =
  | {
      kind: 'message.inbound';
      projectId: ProjectId;
      sessionId: SessionId;
      contactId?: ContactId;
      agentId?: string;
      text: string;
      channel: string;
      ts: number;
    }
  | {
      kind: 'message.outbound';
      projectId: ProjectId;
      sessionId: SessionId;
      agentId?: string;
      text: string;
      channel: string;
      ts: number;
    }
  | {
      kind: 'approval.created';
      projectId: ProjectId;
      approvalId: ApprovalId;
      tool: string;
      sessionId: SessionId;
      ts: number;
    }
  | {
      kind: 'approval.resolved';
      projectId: ProjectId;
      approvalId: ApprovalId;
      decision: 'approved' | 'denied';
      ts: number;
    }
  | {
      kind: 'trace.created';
      projectId: ProjectId;
      traceId: TraceId;
      sessionId: SessionId;
      ts: number;
    }
  | {
      kind: 'handoff.requested';
      projectId: ProjectId;
      sessionId: SessionId;
      reason: string;
      ts: number;
    }
  | {
      kind: 'handoff.resumed';
      projectId: ProjectId;
      sessionId: SessionId;
      ts: number;
    }
  | {
      kind: 'session.status_changed';
      projectId: ProjectId;
      sessionId: SessionId;
      from: string;
      to: string;
      ts: number;
    }
  | {
      kind: 'campaign.progress';
      projectId: ProjectId;
      campaignId: string;
      sent: number;
      failed: number;
      replied: number;
      ts: number;
    };

/** Kinds of events emitted by the bus. */
export type ProjectEventKind = ProjectEvent['kind'];

// ─── Bus Interface ───────────────────────────────────────────────

export type ProjectEventListener = (event: ProjectEvent) => void;

export interface ProjectEventBus {
  /** Emit an event. Fans out to listeners subscribed to this projectId. */
  emit(event: ProjectEvent): void;
  /**
   * Subscribe to events for a given projectId.
   * Returns an unsubscribe function.
   */
  subscribe(projectId: ProjectId, listener: ProjectEventListener): () => void;
  /**
   * Subscribe to every event across all projects.
   * Useful for cross-project listeners (e.g. campaign reply tracker).
   * Returns an unsubscribe function.
   */
  subscribeAll(listener: ProjectEventListener): () => void;
  /** Current listener count for a project (for diagnostics). */
  listenerCount(projectId: ProjectId): number;
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create an in-process project event bus.
 *
 * Internally uses Node's EventEmitter with one named channel per projectId.
 * maxListeners is raised to 1000 to support many concurrent dashboard
 * tabs + SSE clients per project.
 */
export function createProjectEventBus(): ProjectEventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(1000);

  // Separate channel for subscribeAll — avoids colliding with per-project channels.
  const ALL_CHANNEL = '__all__';

  return {
    emit(event: ProjectEvent): void {
      emitter.emit(event.projectId, event);
      emitter.emit(ALL_CHANNEL, event);
    },
    subscribe(projectId: ProjectId, listener: ProjectEventListener): () => void {
      emitter.on(projectId, listener);
      return () => {
        emitter.off(projectId, listener);
      };
    },
    subscribeAll(listener: ProjectEventListener): () => void {
      emitter.on(ALL_CHANNEL, listener);
      return () => {
        emitter.off(ALL_CHANNEL, listener);
      };
    },
    listenerCount(projectId: ProjectId): number {
      return emitter.listenerCount(projectId);
    },
  };
}
