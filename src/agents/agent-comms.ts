/**
 * Agent Communications — inter-agent messaging system.
 *
 * Provides a pub/sub mechanism for agents to communicate with each other.
 * Uses EventEmitter for in-process communication. Can be extended to use
 * Redis pub/sub for distributed deployments.
 */
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Logger } from '@/observability/logger.js';
import type { AgentId, AgentMessage, AgentMessageId, AgentComms } from './types.js';

// ─── Pending Reply Tracking ──────────────────────────────────────

interface PendingReply {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

// ─── Comms Dependencies ──────────────────────────────────────────

interface CommsDeps {
  logger: Logger;
}

// ─── Factory Function ────────────────────────────────────────────

/**
 * Create an inter-agent communication system.
 */
export function createAgentComms(deps: CommsDeps): AgentComms {
  const emitter = new EventEmitter();
  const pendingReplies = new Map<string, PendingReply>();

  // Set a higher limit for event listeners (one per agent subscription)
  emitter.setMaxListeners(100);

  const comms: AgentComms = {
    send(message): Promise<AgentMessageId> {
      const id = randomUUID() as AgentMessageId;
      const fullMessage: AgentMessage = {
        ...message,
        id,
        createdAt: new Date(),
      };

      deps.logger.info('Agent message sent', {
        component: 'agent-comms',
        messageId: id,
        from: message.fromAgentId,
        to: message.toAgentId,
        hasReplyTo: !!message.replyToId,
      });

      // Emit to the target agent's channel
      emitter.emit(`agent:${message.toAgentId}`, fullMessage);

      return Promise.resolve(id);
    },

    async sendAndWait(message, timeoutMs = 30000): Promise<string> {
      const id = await comms.send(message);

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingReplies.delete(id);
          deps.logger.warn('Agent message timed out waiting for reply', {
            component: 'agent-comms',
            messageId: id,
            timeoutMs,
          });
          reject(new Error(`Agent response timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingReplies.set(id, { resolve, reject, timeoutId });

        // Listen for reply on the sender's channel
        const handler = (reply: AgentMessage): void => {
          if (reply.replyToId === id) {
            const pending = pendingReplies.get(id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingReplies.delete(id);
              deps.logger.debug('Agent received reply', {
                component: 'agent-comms',
                originalMessageId: id,
                replyMessageId: reply.id,
              });
              pending.resolve(reply.content);
            }
            emitter.off(`agent:${message.fromAgentId}`, handler);
          }
        };

        emitter.on(`agent:${message.fromAgentId}`, handler);
      });
    },

    subscribe(agentId: AgentId, handler: (message: AgentMessage) => void): () => void {
      const eventName = `agent:${agentId}`;

      deps.logger.debug('Agent subscribed to messages', {
        component: 'agent-comms',
        agentId,
      });
      emitter.on(eventName, handler);

      // Return unsubscribe function
      return () => {
        deps.logger.debug('Agent unsubscribed from messages', {
          component: 'agent-comms',
          agentId,
        });
        emitter.off(eventName, handler);
      };
    },
  };

  return comms;
}
