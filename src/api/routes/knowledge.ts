/**
 * Knowledge base routes — per-project CRUD for memory entries.
 * Provides add, list, delete, and bulk import endpoints for the UI.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';

// ─── Schemas ─────────────────────────────────────────────────────

const MemoryCategorySchema = z.enum([
  'fact',
  'decision',
  'preference',
  'task_context',
  'learning',
]);

const AddKnowledgeSchema = z.object({
  content: z.string().min(1).max(10_000),
  category: MemoryCategorySchema.optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ListKnowledgeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: MemoryCategorySchema.optional(),
});

const BulkImportSchema = z.object({
  items: z.array(
    z.object({
      content: z.string().min(1).max(10_000),
      category: MemoryCategorySchema.optional(),
      importance: z.number().min(0).max(1).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ).min(1).max(500),
});

// ─── Route Plugin ────────────────────────────────────────────────

/** Register knowledge base CRUD routes. */
export function knowledgeRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { knowledgeService } = deps;

  // ─── POST /projects/:projectId/knowledge ──────────────────────
  // Add a single knowledge entry

  fastify.post(
    '/projects/:projectId/knowledge',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const body = AddKnowledgeSchema.parse(request.body);

      const entry = await knowledgeService.add({
        projectId,
        content: body.content,
        category: body.category,
        importance: body.importance,
        metadata: body.metadata,
      });

      await sendSuccess(reply, entry, 201);
    },
  );

  // ─── GET /projects/:projectId/knowledge ───────────────────────
  // List knowledge entries with pagination

  fastify.get(
    '/projects/:projectId/knowledge',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const query = ListKnowledgeQuerySchema.parse(request.query);

      const result = await knowledgeService.list({
        projectId,
        page: query.page,
        limit: query.limit,
        category: query.category,
      });

      await sendSuccess(reply, result);
    },
  );

  // ─── DELETE /knowledge/:id ────────────────────────────────────
  // Delete a knowledge entry by ID

  fastify.delete(
    '/knowledge/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const deleted = await knowledgeService.delete(id);
      if (!deleted) {
        return sendNotFound(reply, 'Knowledge entry', id);
      }

      await sendSuccess(reply, { deleted: true, id });
    },
  );

  // ─── POST /projects/:projectId/knowledge/bulk ─────────────────
  // Bulk import knowledge entries from JSON

  fastify.post(
    '/projects/:projectId/knowledge/bulk',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const body = BulkImportSchema.parse(request.body);

      const result = await knowledgeService.bulkImport({
        projectId,
        items: body.items,
      });

      await sendSuccess(reply, result, result.failed > 0 ? 207 : 201);
    },
  );
}
