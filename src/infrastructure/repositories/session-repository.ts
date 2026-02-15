/**
 * Session repository — CRUD for sessions and message persistence.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId } from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface Session {
  id: SessionId;
  projectId: ProjectId;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface SessionCreateInput {
  projectId: ProjectId;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface StoredMessage {
  id: string;
  sessionId: SessionId;
  role: string;
  content: string;
  toolCalls?: unknown;
  usage?: unknown;
  traceId?: string;
  createdAt: Date;
}

// ─── Repository ─────────────────────────────────────────────────

export interface SessionRepository {
  create(input: SessionCreateInput): Promise<Session>;
  findById(id: SessionId): Promise<Session | null>;
  findByContactId(projectId: ProjectId, contactId: string): Promise<Session | null>;
  updateStatus(id: SessionId, status: string): Promise<boolean>;
  listByProject(projectId: ProjectId, status?: string): Promise<Session[]>;
  addMessage(sessionId: SessionId, message: { role: string; content: string; toolCalls?: unknown; usage?: unknown }, traceId?: string): Promise<StoredMessage>;
  getMessages(sessionId: SessionId): Promise<StoredMessage[]>;
}

/** Map a Prisma session record to the app's Session type. */
function toSessionModel(record: {
  id: string;
  projectId: string;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}): Session {
  return {
    id: record.id as SessionId,
    projectId: record.projectId as ProjectId,
    status: record.status,
    metadata: (record.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt ?? undefined,
  };
}

/**
 * Create a SessionRepository backed by Prisma.
 */
export function createSessionRepository(prisma: PrismaClient): SessionRepository {
  return {
    async create(input: SessionCreateInput): Promise<Session> {
      const record = await prisma.session.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          status: 'active',
          metadata: input.metadata as Prisma.InputJsonValue,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return toSessionModel(record);
    },

    async findById(id: SessionId): Promise<Session | null> {
      const record = await prisma.session.findUnique({ where: { id } });
      if (!record) return null;
      return toSessionModel(record);
    },

    async findByContactId(projectId: ProjectId, contactId: string): Promise<Session | null> {
      const record = await prisma.session.findFirst({
        where: {
          projectId,
          status: 'active',
          metadata: {
            path: ['contactId'],
            equals: contactId,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!record) return null;
      return toSessionModel(record);
    },

    async updateStatus(id: SessionId, status: string): Promise<boolean> {
      try {
        await prisma.session.update({
          where: { id },
          data: { status },
        });
        return true;
      } catch {
        return false;
      }
    },

    async listByProject(projectId: ProjectId, status?: string): Promise<Session[]> {
      const records = await prisma.session.findMany({
        where: {
          projectId,
          ...(status && { status }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toSessionModel);
    },

    async addMessage(
      sessionId: SessionId,
      message: { role: string; content: string; toolCalls?: unknown; usage?: unknown },
      traceId?: string,
    ): Promise<StoredMessage> {
      const record = await prisma.message.create({
        data: {
          id: nanoid(),
          sessionId,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls as Prisma.InputJsonValue,
          usage: message.usage as Prisma.InputJsonValue,
          traceId: traceId ?? null,
        },
      });
      return {
        id: record.id,
        sessionId: record.sessionId as SessionId,
        role: record.role,
        content: record.content,
        toolCalls: record.toolCalls ?? undefined,
        usage: record.usage ?? undefined,
        traceId: record.traceId ?? undefined,
        createdAt: record.createdAt,
      };
    },

    async getMessages(sessionId: SessionId): Promise<StoredMessage[]> {
      const records = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });
      return records.map((r) => ({
        id: r.id,
        sessionId: r.sessionId as SessionId,
        role: r.role,
        content: r.content,
        toolCalls: r.toolCalls ?? undefined,
        usage: r.usage ?? undefined,
        traceId: r.traceId ?? undefined,
        createdAt: r.createdAt,
      }));
    },
  };
}
