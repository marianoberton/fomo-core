/**
 * Session routes — CRUD for conversation sessions and message retrieval.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const createSessionSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'closed', 'expired']),
});

const sessionListQuerySchema = z.object({
  status: z.string().optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register session routes. */
export function sessionRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { sessionRepository, projectRepository } = deps;

  // GET /projects/:projectId/sessions
  fastify.get<{ Params: { projectId: string }; Querystring: { status?: string } }>(
    '/projects/:projectId/sessions',
    async (request, reply) => {
      const query = sessionListQuerySchema.parse(request.query);
      const sessions = await sessionRepository.listByProject(
        request.params.projectId as ProjectId,
        query.status,
      );
      return sendSuccess(reply, sessions);
    },
  );

  // GET /sessions/:id
  fastify.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const session = await sessionRepository.findById(request.params.id as SessionId);
    if (!session) return sendNotFound(reply, 'Session', request.params.id);
    return sendSuccess(reply, session);
  });

  // POST /projects/:projectId/sessions
  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/sessions',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      // Verify project exists
      const project = await projectRepository.findById(projectId);
      if (!project) return sendNotFound(reply, 'Project', request.params.projectId);

      const input = createSessionSchema.parse(request.body);
      const session = await sessionRepository.create({
        projectId,
        metadata: input.metadata,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      });
      return sendSuccess(reply, session, 201);
    },
  );

  // PATCH /sessions/:id/status
  fastify.patch<{ Params: { id: string } }>(
    '/sessions/:id/status',
    async (request, reply) => {
      const { status } = updateStatusSchema.parse(request.body);
      const updated = await sessionRepository.updateStatus(
        request.params.id as SessionId,
        status,
      );
      if (!updated) return sendNotFound(reply, 'Session', request.params.id);
      return sendSuccess(reply, { updated: true });
    },
  );

  // GET /sessions/:id/messages
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id/messages',
    async (request, reply) => {
      const session = await sessionRepository.findById(request.params.id as SessionId);
      if (!session) return sendNotFound(reply, 'Session', request.params.id);

      const messages = await sessionRepository.getMessages(request.params.id as SessionId);
      return sendSuccess(reply, messages);
    },
  );
}
