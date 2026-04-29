/**
 * CRUD over `research_turns`.
 *
 * Turns are append-only: once created they are never updated.
 * `wahaMessageId` is a UNIQUE constraint — the DB enforces idempotency
 * at INSERT time, so the webhook handler can INSERT without a prior check
 * when the unique violation signals "already processed".
 */
import type { PrismaClient, ResearchTurn, TurnDirection } from '@prisma/client';
import type { ResearchTurnId } from '../types.js';

// ─── Input types ──────────────────────────────────────────────────

export interface CreateTurnInput {
  sessionId: string;
  turnOrder: number;
  direction: TurnDirection;
  message: string;
  rawMessage?: string;
  sanitized?: boolean;
  redactionsCount?: number;
  latencyMs?: number;
  wahaMessageId?: string;
  isTimeout?: boolean;
  notes?: string;
}

// ─── Interface ───────────────────────────────────────────────────

export interface ResearchTurnRepository {
  create(data: CreateTurnInput): Promise<ResearchTurn>;
  findById(id: ResearchTurnId): Promise<ResearchTurn | null>;
  /**
   * Idempotency lookup for the WAHA webhook handler.
   * Returns the existing turn if this message was already processed.
   */
  findByWahaMessageId(wahaMessageId: string): Promise<ResearchTurn | null>;
  /** Ordered by turnOrder asc, then direction asc (outbound before inbound). */
  listBySession(sessionId: string): Promise<ResearchTurn[]>;
  /** Used by the runner to compute latency of the next inbound turn. */
  findLastOutbound(sessionId: string): Promise<ResearchTurn | null>;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createResearchTurnRepository(prisma: PrismaClient): ResearchTurnRepository {
  return {
    async create(data) {
      return await prisma.researchTurn.create({
        data: {
          sessionId: data.sessionId,
          turnOrder: data.turnOrder,
          direction: data.direction,
          message: data.message,
          rawMessage: data.rawMessage,
          sanitized: data.sanitized ?? false,
          redactionsCount: data.redactionsCount ?? 0,
          latencyMs: data.latencyMs,
          wahaMessageId: data.wahaMessageId,
          isTimeout: data.isTimeout ?? false,
          notes: data.notes,
        },
      });
    },

    async findById(id) {
      return await prisma.researchTurn.findUnique({ where: { id } });
    },

    async findByWahaMessageId(wahaMessageId) {
      return await prisma.researchTurn.findUnique({ where: { wahaMessageId } });
    },

    async listBySession(sessionId) {
      return await prisma.researchTurn.findMany({
        where: { sessionId },
        orderBy: [{ turnOrder: 'asc' }, { direction: 'asc' }],
      });
    },

    async findLastOutbound(sessionId) {
      return await prisma.researchTurn.findFirst({
        where: { sessionId, direction: 'outbound' },
        orderBy: { turnOrder: 'desc' },
      });
    },
  };
}
