/**
 * Handoff Manager — detects when AI should escalate to a human agent.
 *
 * Signals for escalation:
 * - Agent response contains a handoff marker (e.g. [HANDOFF])
 * - Customer sends escalation keywords (e.g. "hablar con humano")
 * - Configurable turn limit exceeded without resolution
 */
import type { Logger } from '@/observability/logger.js';
import type { ChatwootAdapter } from './adapters/chatwoot.js';
import type { ProjectEventBus } from '@/api/events/event-bus.js';
import type { ProjectId, SessionId } from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface HandoffConfig {
  /** Marker string the AI includes in response to trigger handoff. */
  handoffMarker: string;
  /** Keywords the customer can send to request a human. */
  escalationKeywords: string[];
  /** Max conversation turns before auto-escalation (0 = disabled). */
  maxTurnsBeforeEscalation: number;
}

/** Optional session context used to emit live events. */
export interface HandoffSessionContext {
  projectId: ProjectId;
  sessionId: SessionId;
}

export interface HandoffManager {
  /** Check if an AI response signals handoff. */
  shouldEscalateFromResponse(response: string): boolean;
  /** Check if a customer message requests human escalation. */
  shouldEscalateFromMessage(message: string): boolean;
  /**
   * Execute handoff: transfer conversation to human agent in Chatwoot.
   * When `session` is provided, a `handoff.requested` event is emitted on the bus.
   */
  escalate(
    conversationId: number,
    adapter: ChatwootAdapter,
    reason: string,
    session?: HandoffSessionContext,
  ): Promise<void>;
  /**
   * Resume bot handling after human resolves.
   * When `session` is provided, a `handoff.resumed` event is emitted on the bus.
   */
  resume(
    conversationId: number,
    adapter: ChatwootAdapter,
    session?: HandoffSessionContext,
  ): Promise<void>;
  /** Strip the handoff marker from the response (so customer doesn't see it). */
  stripHandoffMarker(response: string): string;
}

export interface HandoffManagerDeps {
  config: HandoffConfig;
  logger: Logger;
  /** Optional event bus for live fan-out of handoff events. */
  eventBus?: ProjectEventBus;
}

// ─── Default Config ─────────────────────────────────────────────

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  handoffMarker: '[HANDOFF]',
  escalationKeywords: [
    'hablar con humano',
    'agente humano',
    'quiero hablar con una persona',
    'operador',
    'talk to human',
    'speak to agent',
    'human agent',
  ],
  maxTurnsBeforeEscalation: 0, // disabled by default
};

// ─── Handoff Factory ────────────────────────────────────────────

/**
 * Create a HandoffManager that detects escalation signals and transfers
 * conversations to human agents via Chatwoot.
 */
export function createHandoffManager(deps: HandoffManagerDeps): HandoffManager {
  const { config, logger, eventBus } = deps;

  const keywordsLower = config.escalationKeywords.map(k => k.toLowerCase());

  return {
    shouldEscalateFromResponse(response: string): boolean {
      return response.includes(config.handoffMarker);
    },

    shouldEscalateFromMessage(message: string): boolean {
      const messageLower = message.toLowerCase().trim();
      return keywordsLower.some(keyword => messageLower.includes(keyword));
    },

    async escalate(
      conversationId: number,
      adapter: ChatwootAdapter,
      reason: string,
      session?: HandoffSessionContext,
    ): Promise<void> {
      logger.info('Escalating conversation to human agent', {
        component: 'handoff',
        conversationId,
        reason,
      });

      const note = `Escalacion automatica: ${reason}\n\nEl agente AI ha transferido esta conversacion a un agente humano.`;

      await adapter.handoffToHuman(conversationId, note);

      if (eventBus && session) {
        eventBus.emit({
          kind: 'handoff.requested',
          projectId: session.projectId,
          sessionId: session.sessionId,
          reason,
          ts: Date.now(),
        });
      }

      logger.info('Conversation escalated to human', {
        component: 'handoff',
        conversationId,
      });
    },

    async resume(
      conversationId: number,
      adapter: ChatwootAdapter,
      session?: HandoffSessionContext,
    ): Promise<void> {
      logger.info('Resuming bot for conversation', {
        component: 'handoff',
        conversationId,
      });

      await adapter.resumeBot(conversationId);

      if (eventBus && session) {
        eventBus.emit({
          kind: 'handoff.resumed',
          projectId: session.projectId,
          sessionId: session.sessionId,
          ts: Date.now(),
        });
      }

      logger.info('Bot resumed for conversation', {
        component: 'handoff',
        conversationId,
      });
    },

    stripHandoffMarker(response: string): string {
      return response.replace(config.handoffMarker, '').trim();
    },
  };
}
