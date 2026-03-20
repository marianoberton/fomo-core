/**
 * Verticals routes — list and detail for industry vertical configs.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';
import { getAllVerticals, getVertical } from '@/verticals/index.js';

// ─── Route Registration ─────────────────────────────────────────

export function verticalRoutes(
  fastify: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deps: RouteDependencies,
): void {
  /**
   * GET /api/v1/verticals
   * Returns all available verticals (JSON-defined + TypeScript adapters).
   */
  fastify.get(
    '/verticals',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const verticals = getAllVerticals().map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        industry: v.industry,
        toolCount: v.tools.length,
        recommendedSkillTags: v.recommendedSkillTags,
      }));

      await sendSuccess(reply, verticals);
      return;
    },
  );

  /**
   * GET /api/v1/verticals/:id
   * Returns full vertical config including parametersSchema and tools.
   */
  fastify.get(
    '/verticals/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const vertical = getVertical(id);

      if (!vertical) {
        return sendNotFound(reply, 'Vertical', id);
      }

      await sendSuccess(reply, vertical);
      return;
    },
  );
}
