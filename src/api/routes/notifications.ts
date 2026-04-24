/**
 * In-app notification routes.
 *
 * Back the dashboard's notification bell — lists pending notifications
 * (approval requests, future system alerts) and marks them as read.
 * Project-scoped; the existing per-project auth hook applies via the
 * URL's `projectId` param.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'notifications-routes' });

// ─── Schemas ────────────────────────────────────────────────────

const listQuerySchema = paginationSchema.extend({
  unread: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (typeof v === 'boolean') return v;
      return v === 'true';
    }),
  kind: z.string().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────

export function notificationRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma } = deps;

  // GET /projects/:projectId/notifications?unread=true&kind=approval_requested
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/notifications',
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const { limit, offset, unread, kind } = query;

      const where: {
        projectId: string;
        readAt?: null;
        kind?: string;
      } = { projectId: request.params.projectId };
      if (unread === true) where.readAt = null;
      if (kind) where.kind = kind;

      const [total, records] = await Promise.all([
        prisma.inAppNotification.count({ where }),
        prisma.inAppNotification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
      ]);

      const items = records.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        userId: r.userId,
        kind: r.kind,
        payload: r.payload,
        readAt: r.readAt,
        createdAt: r.createdAt,
      }));

      return sendSuccess(reply, { items, total, limit, offset });
    },
  );

  // POST /projects/:projectId/notifications/:id/mark-read
  fastify.post<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/notifications/:id/mark-read',
    async (request, reply) => {
      const { projectId, id } = request.params;

      const existing = await prisma.inAppNotification.findUnique({
        where: { id },
        select: { id: true, projectId: true, readAt: true },
      });

      if (!existing) return sendNotFound(reply, 'InAppNotification', id);
      if (existing.projectId !== projectId) {
        return sendError(
          reply,
          'NOT_IN_PROJECT',
          `InAppNotification "${id}" does not belong to project "${projectId}"`,
          404,
        );
      }

      // Idempotent — don't overwrite readAt if already set.
      if (existing.readAt !== null) {
        const unchanged = await prisma.inAppNotification.findUnique({ where: { id } });
        return sendSuccess(reply, unchanged);
      }

      const updated = await prisma.inAppNotification.update({
        where: { id },
        data: { readAt: new Date() },
      });

      logger.info('Notification marked read', {
        component: 'notifications-routes',
        notificationId: id,
        projectId,
      });

      return sendSuccess(reply, updated);
    },
  );
}
