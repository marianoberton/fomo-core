/**
 * SessionBroadcaster — Lightweight pub/sub for broadcasting session events
 * from any context (REST, webhook, Telegram) to connected WebSocket clients.
 *
 * Used to bridge the gap between external approval resolution (e.g. Telegram
 * webhook calling `resumeAfterApproval`) and the dashboard WebSocket that
 * needs real-time updates for the same session.
 */
import { EventEmitter } from 'node:events';

// ─── Types ───────────────────────────────────────────────────────

/** A message broadcast to all subscribers of a session. */
export interface SessionMessage {
  type: string;
  [key: string]: unknown;
}

/** Pub/sub interface for cross-context session event delivery. */
export interface SessionBroadcaster {
  /** Subscribe to events for a session. Returns an unsubscribe function. */
  subscribe(sessionId: string, callback: (msg: SessionMessage) => void): () => void;
  /** Broadcast a message to all subscribers of a session. */
  broadcast(sessionId: string, msg: SessionMessage): void;
}

// ─── Factory ─────────────────────────────────────────────────────

/** Create an in-process SessionBroadcaster backed by Node's EventEmitter. */
export function createSessionBroadcaster(): SessionBroadcaster {
  const emitter = new EventEmitter();

  return {
    subscribe(sessionId, callback) {
      const event = `session:${sessionId}`;
      emitter.on(event, callback);
      return () => {
        emitter.off(event, callback);
      };
    },

    broadcast(sessionId, msg) {
      emitter.emit(`session:${sessionId}`, msg);
    },
  };
}
